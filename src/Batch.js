/**
 * Batch.js - 深夜03:00統合バッチ処理モジュール
 * タイマートリガー（毎日 午前3:00〜4:00）により完全サイレントで実行（Push通知なし）
 * データ保護付きログクリア、ルーティン重複防止ガード、Open-Meteo & Notion連携
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

  const logs = getLogs();
  const tasks = getTasks();
  const inputStock = getInputStockList();
  const memory = getMemory();

  let isDailyReportSuccess = false;

  // ----------------------------------------------------
  // 1. 日報生成 & Notion投稿 (データ保護付き)
  // ----------------------------------------------------
  try {
    Logger.log('1. 日報生成 & Notion投稿処理開始');
    // 前日および日付変更後〜午前3時までに完了したタスク・消化したインプットを抽出
    const completedTasks = tasks.filter(t => t.status === '完了' && (t.completedDate === targetDateStr || t.completedDate === todayStr));
    const consumedInputs = inputStock.filter(inp => inp.status === '完' && (inp.consumedDate === targetDateStr || inp.consumedDate === todayStr));

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
    if (logs.length > 0) {
      const memoryUpdates = analyzeMemoryUpdates(
        logs,
        memory.cycle_stamps,
        memory.weekly_summary,
        memory.rolling_memory,
        memory.profile,
        memory.dictionary,
        targetDateStr
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
  // 3. 天気・気圧急降下検知 (Open-Meteo API)
  // ----------------------------------------------------
  try {
    Logger.log('3. 天気・気圧急降下検知処理開始');
    const weatherResult = fetchWeatherAndPressure();
    setMemoryValue('weather_info', weatherResult.weatherInfo);
    setMemoryValue('pressure_alert', weatherResult.pressureAlert);
    Logger.log(`天気情報更新: ${weatherResult.weatherInfo}, 気圧アラート: ${weatherResult.pressureAlert}`);
  } catch (weatherErr) {
    Logger.log('天気・気圧更新エラー: ' + weatherErr.message);
  }

  // ----------------------------------------------------
  // 4. ルーティンタスク自動投入 (重複ガード付き)
  // ----------------------------------------------------
  try {
    Logger.log('4. ルーティンタスク自動投入処理開始');
    const routines = getRoutines();
    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const currentDayName = dayNames[now.getDay()];
    const currentDayOfMonth = now.getDate();
    const taskSheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.TASKS);

    // 既存の未完了タスク名一覧を取得（重複ガード用）
    const existingUncompletedTasks = tasks.filter(t => t.status === '未完了');
    const existingTitles = existingUncompletedTasks.map(t => t.title);

    for (let i = 0; i < routines.length; i++) {
      const r = routines[i];
      let shouldGenerate = false;

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
        taskSheet.appendRow([
          taskId,
          r.ruleName,
          todayStr,
          '未完了',
          todayStr,
          '',
          r.memo || '定期ルーティン自動投入'
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
      const monthlyJournal = generateMonthlyJournalMarkdown(monthlyDataText, prevMonthStr);
      createMonthlyReport(monthlyJournal, prevMonthStr);

      setMemoryValue('monthly_report_ready', 'TRUE');
      Logger.log('月報生成・Notion投稿・フラグ設定完了: ' + prevMonthStr);
    }
  } catch (monthlyErr) {
    Logger.log('毎月1日処理エラー: ' + monthlyErr.message);
  }

  // ----------------------------------------------------
  // 6. ログ整理 (Notion日報成功時のみ安全にクリア)
  // ----------------------------------------------------
  try {
    if (isDailyReportSuccess) {
      Logger.log('6. 当日ログクリア処理開始 (日報投稿成功確認済み)');
      clearDailyLogs();
      Logger.log('当日ログクリア完了');
    } else {
      Logger.log('⚠️ Notion日報投稿が完了していないため、ログクリアを保留しました (データ保護)');
    }
  } catch (clearErr) {
    Logger.log('ログクリアエラー: ' + clearErr.message);
  }

  Logger.log('=== 深夜統合バッチ終了 ===');
}
