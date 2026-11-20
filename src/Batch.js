/**
 * Batch.js - v2 定時バッチ処理モジュール (03:00 / 05:00 / 17:00 JST)
 * - dailyMidnightBatch (03:00): 日報・メモリー代謝・ルーティン投入・月報・Drive同期・30日整理・v2論理日境界リセット＆朝デッキ初期化
 * - morningWeatherBatch (05:00): 起床直前の新鮮な天気・気圧急降下取得 ＆ ブリーフィング反映
 * - eveningDeckBatch (17:00): 退勤〜夜間に向けた aiDeck 先読み再編成
 */

/**
 * 深夜統合バッチメイン処理
 */
function dailyMidnightBatch() {
  Logger.log('=== 深夜統合バッチ開始 ===');
  const now = new Date();
  const todayStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
  
  // 深夜3時のため、集計対象日は「前日（昨日）」
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const targetDateStr = Utilities.formatDate(yesterday, 'Asia/Tokyo', 'yyyy-MM-dd');

  // 前日03:00〜当日02:59の1日境界でログ・完了タスク・消化ストック・対象日カレンダー予定を抽出
  const tasks = getTasks();
  const windowData = getDailyReportWindowData_(targetDateStr, tasks);
  const logs = windowData.logs;
  const completedTasks = windowData.completedTasks;
  const consumedInputs = windowData.consumedInputs;
  const memory = getMemory();
  const targetDateEvents = (typeof getTodayEventsList === 'function') ? getTodayEventsList(yesterday) : [];

  let isDailyReportSuccess = false;

  // ----------------------------------------------------
  // 1. 日報生成 & Notion投稿 (データ保護付き)
  // ----------------------------------------------------
  try {
    Logger.log('1. 日報生成 & Notion投稿処理開始');

    if (logs.length > 0 || completedTasks.length > 0 || consumedInputs.length > 0) {
      const dailyMarkdown = generateDailyReportMarkdown(logs, completedTasks, memory, targetDateStr, consumedInputs);
      const reportResult = createDailyReport(dailyMarkdown, targetDateStr);
      if (reportResult && reportResult.id) {
        isDailyReportSuccess = true;
        Logger.log('Notion日報投稿成功: ' + targetDateStr);
      }
    } else {
      Logger.log('当日ログ・完了タスク・消化ストックがないため、日報作成をスキップしました');
      isDailyReportSuccess = true; // ログがないのでクリアしても問題なし
    }
  } catch (notionErr) {
    Logger.log('日報生成・Notion投稿エラー: ' + notionErr.message);
    isDailyReportSuccess = false; // 失敗時はログをクリアしない
  }

  // ----------------------------------------------------
  // 2. 中長期メモリー自動更新 (rolling_memory, profile新陳代謝, cycle_stamps, weekly_summary)
  // ----------------------------------------------------
  try {
    Logger.log('2. 中長期メモリー更新処理開始');
    if (logs.length > 0 || completedTasks.length > 0) {
      const memoryUpdates = analyzeMemoryUpdates(
        logs,
        memory.cycle_stamps,
        memory.weekly_summary,
        memory.rolling_memory,
        memory.profile,
        memory.dictionary,
        targetDateStr,
        {
          lifestyleHabits: memory.lifestyle_habits || '',
          targetEvents: targetDateEvents,
          completedTasks: completedTasks
        }
      );
      if (memoryUpdates.rolling_memory) {
        setMemoryValue('rolling_memory', memoryUpdates.rolling_memory);
      }
      if (memoryUpdates.profile) {
        updateProfileSafely(memoryUpdates.profile);
      }
      if (memoryUpdates.cycle_stamps) {
        setMemoryValue('cycle_stamps', memoryUpdates.cycle_stamps);
      }
      if (memoryUpdates.weekly_summary) {
        setMemoryValue('weekly_summary', memoryUpdates.weekly_summary);
      }
      if (memoryUpdates.dictionary) {
        updateDictionarySafely(memoryUpdates.dictionary);
      }
      Logger.log('中長期メモリー・直近活動バッファ・用語辞書更新完了');
    }
  } catch (memErr) {
    Logger.log('中長期メモリー更新エラー: ' + memErr.message);
  }

  // ----------------------------------------------------
  // 3. （※天気・気圧取得は 05:00 morningWeatherBatch へ分離。未設定時の保険のみ実施）
  // ----------------------------------------------------
  if (!memory.weather_info) {
    try {
      Logger.log('3. 初回天気・気圧フォールバック取得');
      const weatherResult = fetchWeatherAndPressure();
      setMemoryValue('weather_info', weatherResult.weatherInfo);
      setMemoryValue('pressure_alert', weatherResult.pressureAlert);
      memory.weather_info = weatherResult.weatherInfo;
      memory.pressure_alert = weatherResult.pressureAlert;
    } catch (weatherErr) {
      Logger.log('天気・気圧フォールバックエラー: ' + weatherErr.message);
    }
  }

  // ----------------------------------------------------
  // 4. ルーティンタスク自動投入 (重複ガード ＆ 期間限定ルーティン自動満了ガード付き)
  // ----------------------------------------------------
  try {
    Logger.log('4. ルーティンタスク自動投入処理開始');
    const routines = getRoutines();
    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const currentDayName = dayNames[now.getDay()];
    const currentDayOfMonth = now.getDate();
    const taskSheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.TASKS);
    const routineSheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.ROUTINES);
    if (typeof ensureRoutinesSchema7Cols_ === 'function') {
      ensureRoutinesSchema7Cols_(routineSheet);
    }

    // 既存の未完了タスク名一覧を取得（重複ガード用）
    const existingUncompletedTasks = tasks.filter(t => t.status === '未完了');
    const existingTitles = existingUncompletedTasks.map(t => t.title);

    for (let i = 0; i < routines.length; i++) {
      const r = routines[i];
      let shouldGenerate = false;

      // すでに完了・満了ステータスになっているルーティンはスキップ
      if (r.status === '完了' || r.status === '期間満了' || r.type === 'expired' || (r.memo && r.memo.includes('[期間満了'))) {
        continue;
      }

      // 【期間限定ルーティンの自動満了ガード】（例: "〜11/07まで" 等）
      if (isRoutineExpired_(r, now, todayStr)) {
        routineSheet.getRange(r.rowIndex, 6).setValue('期間満了');
        routineSheet.getRange(r.rowIndex, 7).setValue(todayStr);
        Logger.log(`期間限定ルーティンが満了日を過ぎたため自動停止しました: ${r.ruleName}`);
        continue;
      }

      // 本日すでに生成済みの場合はスキップ
      if (r.lastGeneratedDate === todayStr) {
        continue;
      }

      // 【重複ガード】すでに同名タスクの「未完了」が存在する場合は二重投入をスキップ
      const isAlreadyPending = existingTitles.some(title => title.includes(r.ruleName) || r.ruleName.includes(title));
      if (isAlreadyPending) {
        Logger.log(`未完了タスクがすでに存在するためルーティン重複投入をスキップ: ${r.ruleName}`);
        continue;
      }

      if (r.type === 'day_of_week') {
        const valUpper = r.value.toUpperCase();
        if (valUpper.includes(currentDayName)) {
          shouldGenerate = true;
        }
      } else if (r.type === 'day_of_month') {
        const days = r.value.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
        if (days.includes(currentDayOfMonth)) {
          shouldGenerate = true;
        }
      } else if (r.type === 'interval_days') {
        const interval = parseInt(r.value, 10);
        if (!isNaN(interval) && interval > 0) {
          if (!r.lastGeneratedDate) {
            shouldGenerate = true;
          } else {
            // JSTの日付ベースで経過日数を厳密計算
            const lastDateParts = r.lastGeneratedDate.split('-');
            if (lastDateParts.length === 3) {
              const lastDate = new Date(parseInt(lastDateParts[0], 10), parseInt(lastDateParts[1], 10) - 1, parseInt(lastDateParts[2], 10));
              const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
              const diffDays = Math.floor((todayDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
              if (diffDays >= interval) {
                shouldGenerate = true;
              }
            }
          }
        }
      }

      if (shouldGenerate) {
        const taskId = 'R_' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd') + '_' + (i + 1);
        const remindCtx = (typeof normalizeTaskRemindContext_ === 'function')
          ? normalizeTaskRemindContext_(r.ruleName, '日課・隙間時間')
          : '日課・隙間時間';
        appendRowSafely_(taskSheet, [
          taskId,
          r.ruleName,
          todayStr,
          '未完了',
          todayStr,
          '',
          r.memo || '定期ルーティン自動投入',
          remindCtx,
          '',
          ''
        ]);
        updateRoutineLastGenerated(r.rowIndex, todayStr);
        Logger.log(`ルーティンタスク投入成功: ${r.ruleName}`);
      }
    }
  } catch (routineErr) {
    Logger.log('ルーティン投入エラー: ' + routineErr.message);
  }

  // ----------------------------------------------------
  // 5. 毎月1日限定処理 (前月月報生成 & Notion投稿)
  // ----------------------------------------------------
  try {
    if (now.getDate() === 1) {
      Logger.log('5. 毎月1日限定処理開始: 前月月報生成');

      const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevYear = prevMonthDate.getFullYear();
      const prevMonth = prevMonthDate.getMonth() + 1;
      const prevMonthStr = `${prevYear}-${('0' + prevMonth).slice(-2)}`;

      const lastDayOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
      const startDateStr = `${prevMonthStr}-01`;
      const endDateStr = `${prevMonthStr}-${('0' + lastDayOfPrevMonth).slice(-2)}`;

      const monthlyDataText = queryMonthlyReports(startDateStr, endDateStr);
      const monthlyJournal = generateMonthlyJournalMarkdown(monthlyDataText, prevMonthStr, memory.dictionary);
      createMonthlyReport(monthlyJournal, prevMonthStr);

      setMemoryValue('monthly_report_ready', 'TRUE');
      Logger.log('月報生成・Notion投稿・フラグ設定完了: ' + prevMonthStr);
    }
  } catch (monthlyErr) {
    Logger.log('毎月1日処理エラー: ' + monthlyErr.message);
  }

  // ----------------------------------------------------
  // 5.5. プロジェクトフォルダ台帳の最新同期 (Drive手動整理にも自動追従)
  // ----------------------------------------------------
  try {
    if (typeof syncProjectFoldersIndex === 'function') {
      Logger.log('5.5. Google Drive プロジェクトフォルダ台帳同期開始');
      syncProjectFoldersIndex();
    }
  } catch (projSyncErr) {
    Logger.log('プロジェクトフォルダ同期エラー: ' + projSyncErr.message);
  }

  // ----------------------------------------------------
  // 6. ローリング整理 (直近30日分は保持し、30日を超えた古いログ・完了/破棄タスク・完了/満了ルーティンのみ安全に整理)
  // ----------------------------------------------------
  try {
    if (isDailyReportSuccess) {
      Logger.log('6. ローリング整理処理開始 (直近30日保持・日報投稿成功確認済み)');
      cleanOldLogs(30);
      if (typeof cleanOldTasks === 'function') {
        cleanOldTasks(30);
      }
      if (typeof cleanOldRoutines === 'function') {
        cleanOldRoutines(30);
      }
      Logger.log('ローリング整理完了');
    } else {
      Logger.log('⚠️ Notion日報投稿が完了していないため、ローリング整理を保留しました (データ保護)');
    }
  } catch (clearErr) {
    Logger.log('ローリング整理エラー: ' + clearErr.message);
  }

  // ----------------------------------------------------
  // 7. v2 論理日リセット・朝ブリーフィング・初期 aiDeck 生成 (就寝中セッション保護)
  // ----------------------------------------------------
  try {
    Logger.log('7. v2 03:00論理日リセット ＆ 朝ブリーフィング・初期デッキ構築開始');
    const fastState = loadFastState(now);
    const freshMemory = getMemory();
    const workBoundary = getWorkModeAndBoundary(now, freshMemory.profile);
    const latestUncompletedTasks = getTasks('未完了');

    fastState.dailyBriefing = buildDailyBriefingObj(
      freshMemory.weather_info,
      freshMemory.pressure_alert,
      workBoundary.workMode,
      workBoundary.todayEvents,
      latestUncompletedTasks,
      todayStr
    );
    fastState.aiDeck = generateAiDeck({
      reason: 'midnight_init',
      now: now,
      memory: freshMemory,
      fastState: fastState,
      workMode: workBoundary.workMode,
      todayEvents: workBoundary.todayEvents,
      boundaryInfo: workBoundary.boundaryInfo,
      useFlashModel: true
    });
    fastState.listCache = buildListsSnapshot(freshMemory, now);
    saveFastState(fastState, true);
    Logger.log(`v2 初期化完了 (dayKey: ${fastState.dayKey}, cards: ${fastState.aiDeck.cards.length}, lowCards: ${fastState.aiDeck.lowCards.length})`);
  } catch (v2Err) {
    Logger.log('v2 初期化エラー: ' + v2Err.message);
  }

  Logger.log('=== 深夜統合バッチ終了 ===');
}

/**
 * 朝05:00 天気・気圧定期更新バッチ（毎日 午前5:00〜6:00 JST トリガー）
 */
function morningWeatherBatch() {
  Logger.log('=== 朝05:00 天気・気圧更新バッチ開始 ===');
  const now = new Date();
  try {
    const weatherResult = fetchWeatherAndPressure();
    setMemoryValue('weather_info', weatherResult.weatherInfo);
    setMemoryValue('pressure_alert', weatherResult.pressureAlert);

    const fastState = loadFastState(now);
    const memory = getMemory();
    const workBoundary = getWorkModeAndBoundary(now, memory.profile);
    fastState.weatherFetchedAt = Utilities.formatDate(now, 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss+09:00");
    refreshBriefingWeatherLine(fastState, weatherResult.weatherInfo, weatherResult.pressureAlert, workBoundary.workMode);
    saveFastState(fastState, true);

    Logger.log(`朝05:00 天気更新完了: ${weatherResult.weatherInfo} (気圧アラート: ${weatherResult.pressureAlert})`);
  } catch (err) {
    Logger.log('朝05:00 天気更新エラー: ' + err.message);
  }
}

/**
 * 夕方17:00 夜シフト定期再編成バッチ（毎日 午後17:00〜18:00 JST トリガー）
 * 午後の勤務中に長時間の空白があっても、終業〜夜間帯に最適化した手札を先読み準備する
 */
function eveningDeckBatch() {
  Logger.log('=== 夕方17:00 夜デッキ再編成バッチ開始 ===');
  const now = new Date();
  try {
    const fastState = loadFastState(now);
    const memory = getMemory();
    const workBoundary = getWorkModeAndBoundary(now, memory.profile);

    fastState.aiDeck = generateAiDeck({
      reason: 'evening_batch',
      now: now,
      memory: memory,
      fastState: fastState,
      workMode: workBoundary.workMode,
      todayEvents: workBoundary.todayEvents,
      boundaryInfo: workBoundary.boundaryInfo,
      useFlashModel: false
    });
    fastState.listCache = buildListsSnapshot(memory, now);
    saveFastState(fastState, true);

    Logger.log(`夕方17:00 夜デッキ更新完了 (cards: ${fastState.aiDeck.cards.length}, lowCards: ${fastState.aiDeck.lowCards.length})`);
  } catch (err) {
    Logger.log('夕方17:00 夜デッキ更新エラー: ' + err.message);
  }
}

/**
 * ルーティン名またはメモに含まれる期日（例: "〜11/07まで" / "2026-11-07まで"）を解析し、
 * 本日時点で期間満了しているかを判定する
 * @param {Object} r ルーティンオブジェクト
 * @param {Date} now 現在日時
 * @param {string} todayStr 'yyyy-MM-dd'
 * @return {boolean}
 * @private
 */
function isRoutineExpired_(r, now, todayStr) {
  const text = `${r.ruleName || ''} ${r.memo || ''}`;

  // 1. YYYY-MM-DDまで / YYYY/MM/DDまで のパターン
  const ymdMatch = text.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})\s*まで/);
  if (ymdMatch) {
    const y = ymdMatch[1];
    const m = ('0' + parseInt(ymdMatch[2], 10)).slice(-2);
    const d = ('0' + parseInt(ymdMatch[3], 10)).slice(-2);
    const expStr = `${y}-${m}-${d}`;
    return todayStr > expStr;
  }

  // 2. MM/DDまで のパターン（例: "〜11/07まで"）
  const mdMatch = text.match(/[〜~\-（\(]?\s*(\d{1,2})\/(\d{1,2})\s*まで/);
  if (mdMatch) {
    const expMonth = parseInt(mdMatch[1], 10);
    const expDay = parseInt(mdMatch[2], 10);
    let expYear = now.getFullYear();
    // 現在が10〜12月で期限が1〜3月の場合は翌年とみなす
    if (now.getMonth() + 1 >= 10 && expMonth <= 3) {
      expYear += 1;
    }
    const m = ('0' + expMonth).slice(-2);
    const d = ('0' + expDay).slice(-2);
    const expStr = `${expYear}-${m}-${d}`;
    return todayStr > expStr;
  }

  return false;
}
