/**
 * Setup.js - 初期化・メンテナンス・プロンプト検証モジュール
 * スプレッドシート全6タブの自動初期化、深夜タイマートリガー設定、および汎用ドライラン検証関数群
 */

// =============================================================================
// 1. 初期構築・メンテナンス用関数
// =============================================================================

/**
 * スプレッドシートの全6タブとヘッダー行を自動作成・初期化
 */
function setupSpreadsheet() {
  const ss = getSpreadsheet();

  // 1. logs タブ（全16列対応）
  const logHeaders = [
    '時刻', '発言者', 'メッセージ', '画像URL', 'AI返答',
    'Lite入力', 'Lite出力', 'Liteキャッシュ',
    'Flash入力', 'Flash出力', 'Flashキャッシュ',
    '新総トークン', '判定タグ/フェーズ',
    '旧AI返答（比較用）', '旧Flash総トークン', 'トークン削減差分'
  ];
  let logsSheet = ss.getSheetByName(SYSTEM_CONSTANTS.SHEET_NAMES.LOGS);
  if (!logsSheet) logsSheet = ss.insertSheet(SYSTEM_CONSTANTS.SHEET_NAMES.LOGS);
  if (logsSheet.getLastRow() === 0) {
    logsSheet.appendRow(logHeaders);
    formatHeaderRow_(logsSheet);
  } else {
    logsSheet.getRange(1, 1, 1, logHeaders.length).setValues([logHeaders]);
    formatHeaderRow_(logsSheet);
  }

  // 2. tasks タブ（全9列対応: リマインド目安・関連URL追加）
  const taskHeaders = ['タスクID', 'タスク名', '期限', 'ステータス(未完了/完了/破棄)', '登録日', '完了日', 'メモ', 'リマインド目安', '関連URL'];
  let tasksSheet = ss.getSheetByName(SYSTEM_CONSTANTS.SHEET_NAMES.TASKS);
  if (!tasksSheet) tasksSheet = ss.insertSheet(SYSTEM_CONSTANTS.SHEET_NAMES.TASKS);
  if (tasksSheet.getLastRow() === 0) {
    tasksSheet.appendRow(taskHeaders);
    formatHeaderRow_(tasksSheet);
  } else if (tasksSheet.getLastColumn() < 9) {
    if (tasksSheet.getLastColumn() < 8) {
      tasksSheet.getRange(1, 8).setValue('リマインド目安');
    }
    tasksSheet.getRange(1, 9).setValue('関連URL');
    formatHeaderRow_(tasksSheet);
  }

  // 3. routines タブ（全7列対応: ステータス・完了日追加）
  let routinesSheet = ss.getSheetByName(SYSTEM_CONSTANTS.SHEET_NAMES.ROUTINES);
  if (!routinesSheet) routinesSheet = ss.insertSheet(SYSTEM_CONSTANTS.SHEET_NAMES.ROUTINES);
  if (routinesSheet.getLastRow() === 0) {
    routinesSheet.appendRow(['ルール名', 'タイプ(day_of_week/day_of_month/interval_days)', '設定値', '最終生成日', 'メモ', 'ステータス(有効/完了/期間満了)', '完了日']);
    formatHeaderRow_(routinesSheet);
    routinesSheet.appendRow(['[制作・創作] ギター基礎運指・クロマチック', 'day_of_week', 'MON,WED,FRI', '', '指先の感覚維持', '有効', '']);
    routinesSheet.appendRow(['[身体・ケア] モニタースピーカーイヤーケア & 無音時間', 'day_of_week', 'SUN', '', '耳のリセット', '有効', '']);
    routinesSheet.appendRow(['[制作・創作] ギター弦交換・機材メンテナンス', 'interval_days', '21', '', '3週間周期メンテ', '有効', '']);
  } else if (routinesSheet.getLastColumn() < 7) {
    ensureRoutinesSchema7Cols_(routinesSheet);
    formatHeaderRow_(routinesSheet);
  }

  // 4. shopping タブ
  let shoppingSheet = ss.getSheetByName(SYSTEM_CONSTANTS.SHEET_NAMES.SHOPPING);
  if (!shoppingSheet) shoppingSheet = ss.insertSheet(SYSTEM_CONSTANTS.SHEET_NAMES.SHOPPING);
  if (shoppingSheet.getLastRow() === 0) {
    shoppingSheet.appendRow(['品名', 'カテゴリ', 'ステータス(未買/購入済)', '登録日']);
    formatHeaderRow_(shoppingSheet);
  }

  // 5. input_stock タブ
  let inputStockSheet = ss.getSheetByName(SYSTEM_CONSTANTS.SHEET_NAMES.INPUT_STOCK);
  if (!inputStockSheet) inputStockSheet = ss.insertSheet(SYSTEM_CONSTANTS.SHEET_NAMES.INPUT_STOCK);
  if (inputStockSheet.getLastRow() === 0) {
    inputStockSheet.appendRow(['種別', 'タイトル', 'メモ', 'ステータス(未/完)', '消化日']);
    formatHeaderRow_(inputStockSheet);
    inputStockSheet.appendRow(['音楽', 'Ludwig Göransson - Oppenheimer OST', '音響設計の分析', '未', '']);
    inputStockSheet.appendRow(['映画', 'Dune: Part Two', 'サウンドデザイン視聴', '未', '']);
  }

  // 6. memory タブ
  let memorySheet = ss.getSheetByName(SYSTEM_CONSTANTS.SHEET_NAMES.MEMORY);
  if (!memorySheet) memorySheet = ss.insertSheet(SYSTEM_CONSTANTS.SHEET_NAMES.MEMORY);
  if (memorySheet.getLastRow() === 0) {
    memorySheet.appendRow(['キー', '値']);
    formatHeaderRow_(memorySheet);
    memorySheet.appendRow(['profile', 'サウンドディレクター / ゲーム・映像音響制作。自宅(横浜市磯子区)と職場(渋谷)。DTM・ギター演奏が日課。']);
    memorySheet.appendRow(['backend_model', '3.5-lite']);
    memorySheet.appendRow(['thinking_level', 'minimal']);
    memorySheet.appendRow(['weather_info', '自宅(磯子): 晴れ 最高22℃ 降水10% ｜ 職場(渋谷): 晴れ 最高23℃ 降水10%']);
    memorySheet.appendRow(['pressure_alert', 'FALSE']);
    memorySheet.appendRow(['cycle_stamps', '美容院: 2026-09-20, 機材メンテ: 2026-09-25']);
    memorySheet.appendRow(['weekly_summary', '睡眠時間は安定。中盤に肩こり・集中力低下の兆候あり。']);
    memorySheet.appendRow(['briefing_delivered_date', '']);
    memorySheet.appendRow(['monthly_report_ready', 'FALSE']);
    memorySheet.appendRow(['prompt_lite', '']);
    memorySheet.appendRow(['prompt_core', '']);
    memorySheet.appendRow(['prompt_phase_a', '']);
    memorySheet.appendRow(['prompt_phase_b', '']);
    memorySheet.appendRow(['prompt_phase_c', '']);
    memorySheet.appendRow(['prompt_phase_d', '']);
    memorySheet.appendRow(['prompt_schedule', '']);
    memorySheet.appendRow(['prompt_db', '']);
    memorySheet.appendRow(['prompt_relief', '']);
    memorySheet.appendRow(['custom_system_prompt', '']);
    memorySheet.appendRow(['dictionary', '・ぽこあポケモン（ぽこあ）: Nintendo Switch 2用ゲーム（2026年3月5日発売予定）。スローライフ・サンドボックス作品。※スマホの「ポケポケ」とは全くの別物。\n・ぱずぎり: パズルアクションゲーム。\n・残響フラクタル: ユーザーが執筆・制作しているオリジナルの創作作品。']);
    memorySheet.appendRow(['ideal_self', '健やかな心身と社会性のある繋がりを保ちつつ、罪悪感のない休息とメリハリのある活動を両立し、専門性（サウンドディレクション等）・創作・大切な人との繋がりを自然に前進させる生活']);
  }

  const defaultSheet = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    try {
      ss.deleteSheet(defaultSheet);
    } catch (e) {}
  }

  Logger.log('スプレッドシートの初期設定が完了しました！');
}

/**
 * 深夜統合バッチ（毎日午前3:00〜4:00）のタイマートリガーを自動作成
 */
function setupTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'dailyMidnightBatch') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger('dailyMidnightBatch')
    .timeBased()
    .atHour(3)
    .everyDays(1)
    .create();

  Logger.log('深夜03:00統合バッチトリガー（dailyMidnightBatch）を正常に登録しました！');
}

/**
 * 手動実行用: LINEリッチメニュー（画面下部固定メニュー）の自動登録・有効化
 */
function setupLineRichMenuFromSetup() {
  setupLineRichMenu();
}

/**
 * 手動実行用: コード上の2モデル体制の全モジュールプロンプト群をスプレッドシートの memory シートに一括反映
 */
function syncDefaultPromptsToSpreadsheet() {
  setMemoryValue('prompt_lite', getDefaultPromptLite());
  setMemoryValue('prompt_core', getDefaultPromptCore());
  setMemoryValue('prompt_phase_a', getDefaultPromptPhaseA());
  setMemoryValue('prompt_phase_b', getDefaultPromptPhaseB());
  setMemoryValue('prompt_phase_c', getDefaultPromptPhaseC());
  setMemoryValue('prompt_phase_d', getDefaultPromptPhaseD());
  setMemoryValue('prompt_schedule', getDefaultPromptSchedule());
  setMemoryValue('prompt_db', getDefaultPromptDb());
  setMemoryValue('prompt_relief', getDefaultPromptRelief());
  Logger.log('✅ スプレッドシートの memory シートに全プロンプトモジュールを保存しました！');
}

/**
 * 互換エイリアス
 */
function syncSystemPromptToSpreadsheet() {
  syncDefaultPromptsToSpreadsheet();
}

// =============================================================================
// 2. プロンプト比較・連続対話検証テスト（完全ドライラン・2モデルAB比較対応）
// =============================================================================

/**
 * ★スポット検証用: 任意の単発または連続対話シナリオをテスト実行
 * プロンプト改善時はこの関数内の scenario を書き換えて実行してください。
 * - turns が1件なら単発テスト、複数件なら前のターンのAI回答を自動的に次ターンのログへ引き継ぐ連鎖テストになります。
 * - 新システム（2モデル体制: Lite + Flash）と旧システム（単一Flash 6,400文字）の応答・トークン・アクションを並列比較します。
 */
function testCustomScenario() {
  // 0. 決定論的ユニット確認（境界イベント・Phase D分離・3.5-lite＆thinking_level解決）
  const unitChecks = [
    ['isUmbrellaEventTitle("自由時間")', isUmbrellaEventTitle('自由時間') === true],
    ['isUmbrellaEventTitle("休息")', isUmbrellaEventTitle('休息') === true],
    ['isUmbrellaEventTitle("休憩")', isUmbrellaEventTitle('休憩') === true],
    ['isUmbrellaEventTitle("リモートワーク")', isUmbrellaEventTitle('リモートワーク') === false],
    [
      'determineActionPhase(pureDbOp -> PHASE_D)',
      determineActionPhase({
        action_intent: 'db_operation',
        tags: ['DB依頼', '活動目標の表明'],
        need_schedule_plan: false,
        focused_task_ids: []
      }, { isUmbrellaEvent: false }) === 'PHASE_D'
    ],
    [
      'determineActionPhase(need_schedule_plan -> PHASE_C)',
      determineActionPhase({
        action_intent: 'db_operation',
        tags: ['DB依頼'],
        need_schedule_plan: true,
        focused_task_ids: []
      }, { isUmbrellaEvent: false }) === 'PHASE_C'
    ],
    [
      'resolveBackendModel_("3.5-lite")',
      resolveBackendModel_({ backend_model: '3.5-lite' }).model === 'gemini-3.5-flash-lite'
    ],
    [
      'resolveThinkingConfig_("minimal")',
      resolveThinkingConfig_('gemini-3.5-flash-lite', { thinking_level: 'minimal' }).thinkingLevel === 'minimal'
    ]
  ];
  Logger.log('============================================================');
  Logger.log('🧪 【検証0: ロジック単体チェック (完全ドライラン)】');
  unitChecks.forEach(([label, ok]) => Logger.log(`${ok ? '✅' : '❌'} ${label}`));

  const mockTasks = [
    {
      id: 'T_20261112_090000_001',
      title: '[家事・環境] MacBook内部の清掃',
      dueDate: '',
      status: '未完了',
      memo: 'エアダスターを使う',
      remindContext: '休日・自室',
      docUrl: ''
    },
    {
      id: 'T_20261112_090000_002',
      title: '[実務・手続] 生活伴走システム：同期スクリプト反映',
      dueDate: '',
      status: '未完了',
      memo: '',
      remindContext: '隙間時間・PC作業時',
      docUrl: ''
    },
    {
      id: 'T_20261112_090000_003',
      title: '[趣味・文化] モンスト：超究極・兵のミザリー周回',
      dueDate: '2026-11-12',
      status: '未完了',
      memo: '毎日ルーティン',
      remindContext: '日課・隙間時間',
      docUrl: ''
    }
  ];

  // 1. 本業勤務中の休憩・疲労連鎖（11/12 14:24 -> 15:39 再現テスト / 3.5-lite + minimal）
  runPromptScenario({
    name: '検証1: 本業勤務中の休憩・一息連鎖（私生活タスク提案ゼロ＆反復抑止）',
    mockMemory: {
      backend_model: '3.5-lite',
      thinking_level: 'minimal'
    },
    mockTasks: mockTasks,
    initialLogs: '12:55 User: お昼はサバ缶とご飯食べたよ\nAI: 栄養たっぷりで良いですね！午後のリモートワークも応援しています。',
    turns: [
      {
        time: '2026-11-12 14:24:00',
        user: 'あー、リモートワークでちょっと疲れた。小休憩中'
      },
      {
        time: '2026-11-12 15:39:00',
        user: 'ちょっと集中切れてきたから少し息抜き中〜'
      }
    ]
  });

  // 2. 純粋DB操作の PHASE_D 分離 ＆ ルーティン完了アクション検証
  runPromptScenario({
    name: '検証2: 純粋DB操作のPHASE_D分離 ＆ ルーティン完了',
    mockMemory: {
      backend_model: '3.5-lite',
      thinking_level: 'minimal'
    },
    mockTasks: mockTasks,
    initialLogs: '',
    turns: [
      {
        time: '2026-11-12 20:00:00',
        user: 'ハーゲンダッツ買いたいから買い物メモに入れといて'
      },
      {
        time: '2026-11-12 20:05:00',
        user: 'モンストの兵のミザリー、今日で期間終了したから定期ルーティンの方も完了にしといて'
      }
    ]
  });

  // 3. 部分時間帯の段取り要求（帰宅後・夜） -> need_schedule_plan: true ＆ prompt_schedule 直交注入
  runPromptScenario({
    name: '検証3: 部分時間帯（帰宅後〜就寝）の段取り設計 (need_schedule_plan + prompt_schedule)',
    mockMemory: {
      backend_model: '3.5-lite',
      thinking_level: 'minimal'
    },
    mockTasks: mockTasks,
    initialLogs: '',
    turns: [
      {
        time: '2026-11-12 19:20:00',
        user: '仕事終わった！今日これから寝るまでのタイスケ（段取り）組んで。ゲームも少し遊びたいしご飯とお風呂も済ませたい'
      }
    ]
  });

  Logger.log('💡 完全ドライランのため、スプレッドシートの書き換えは行っていません。');
}

/**
 * ★標準回帰テスト用: 代表的な4大シナリオを一括検証
 * プロンプトの全体構造を変更した際、主要機能（多様性・送り出し・体調配慮・連続対話）に退行がないかを確認します。
 */
function testAllStandardScenarios() {
  const scenarios = getStandardTestScenarios_();
  Logger.log(`🚀 >>> 標準回帰テスト（全 ${scenarios.length} シナリオ）を開始します <<< 🚀`);
  for (let i = 0; i < scenarios.length; i++) {
    runPromptScenario(scenarios[i]);
  }
  Logger.log('🏁 >>> 標準回帰テストが完了しました <<< 🏁');
}

/**
 * 互換エイリアス（単数形）
 */
function testAllStandardScenario() {
  testAllStandardScenarios();
}

/**
 * 汎用プロンプト検証ランナー（単発 ＆ 複数ターン動的連鎖・新旧AB比較対応）
 * スプレッドシートやLINEを一切変更せず、新システム（Lite + 動的アセンブルFlash）と
 * 旧システム（単一Flash）の出力・トークン消費・DBアクションを並列比較します。
 *
 * @param {{
 *   name: string,
 *   initialLogs?: string,
 *   mockMemory?: Object,
 *   mockTasks?: Array<Object>,
 *   turns: Array<{ time: string, user: string, mockMemory?: Object, mockTasks?: Array<Object> }>
 * }} scenario
 */
function runPromptScenario(scenario) {
  const memory = getMemory();
  // 新システム単独ドライランモード（コード内最新のデフォルトプロンプトを直接評価）
  const testMemory = Object.assign({}, memory, scenario.mockMemory || {}, {
    prompt_lite: '', // コード最新の getDefaultPromptLite() を確実に評価
    prompt_core: '', // コード最新の getDefaultPromptCore() を確実に評価
    prompt_phase_a: '', // コード最新の getDefaultPromptPhaseA() を確実に評価
    prompt_phase_b: '', // コード最新の getDefaultPromptPhaseB() を確実に評価
    prompt_phase_c: '', // コード最新の getDefaultPromptPhaseC() を確実に評価
    prompt_phase_d: '', // コード最新の getDefaultPromptPhaseD() を確実に評価
    prompt_schedule: '', // コード最新の getDefaultPromptSchedule() を確実に評価
    prompt_relief: '', // コード最新の getDefaultPromptRelief() を確実に評価
    prompt_db: '', // コード最新の getDefaultPromptDb() を確実に評価
    _testCalendarExcludeDate: scenario.excludeCalendarDate || ''
  });
  if (typeof scenario.useLiteForBackend === 'boolean') {
    testMemory._testUseLiteForBackend = scenario.useLiteForBackend;
  }

  let runningLogs = scenario.initialLogs || '';
  let cachedSheetTasks = null;

  const backendLabel = (typeof resolveBackendModel_ === 'function')
    ? resolveBackendModel_(testMemory).model
    : SYSTEM_CONSTANTS.GEMINI_MODEL;
  Logger.log('============================================================');
  Logger.log(`🧪 【${scenario.name}】 [後段: ${backendLabel}] (${scenario.turns.length}ターン / 新システム単独ドライラン)`);
  Logger.log('============================================================');

  for (let i = 0; i < scenario.turns.length; i++) {
    const turn = scenario.turns[i];
    const simulatedDate = new Date(turn.time.replace(' ', 'T') + '+09:00');
    const timeLabel = Utilities.formatDate(simulatedDate, 'Asia/Tokyo', 'yyyy-MM-dd(E) HH:mm');
    const hhmm = Utilities.formatDate(simulatedDate, 'Asia/Tokyo', 'HH:mm');

    Logger.log(`\n--- 💬 Turn ${i + 1} [${timeLabel}] ---`);
    Logger.log(`User: ${turn.user}`);

    const turnMemory = Object.assign({}, testMemory, turn.mockMemory || {});
    if (turn.mockTasks || scenario.mockTasks) {
      turnMemory._testMockTasks = turn.mockTasks || scenario.mockTasks;
    }

    const outcome = executeCompanionTurn(turn.user, [], runningLogs, turnMemory, simulatedDate);
    const meta = outcome.logMeta || {};
    const newReply = (outcome.primaryResult && outcome.primaryResult.reply_text) || '';

    const focusedIds = (outcome.liteResult && Array.isArray(outcome.liteResult.focused_task_ids))
      ? outcome.liteResult.focused_task_ids
      : [];
    let focusedDisplay = 'なし (0件)';
    if (focusedIds.length > 0) {
      if (!turnMemory._testMockTasks && !cachedSheetTasks) {
        cachedSheetTasks = getTasks('未完了');
      }
      const refTasks = turnMemory._testMockTasks || cachedSheetTasks || [];
      const titleById = {};
      refTasks.forEach(t => { if (t && t.id) titleById[t.id] = t.title; });
      focusedDisplay = `${focusedIds.length}件 -> ` + focusedIds.map(id => titleById[id] ? `[${id}] ${titleById[id]}` : id).join(' / ');
    }

    Logger.log(`\n🧭 [Lite判定]: ${meta.phaseAndTags || ''}`);
    Logger.log(`🎯 [Lite選出タスク (focused_task_ids)]: ${focusedDisplay}`);
    const matchedStamps = (outcome.liteResult && Array.isArray(outcome.liteResult.matched_cycle_stamps) && outcome.liteResult.matched_cycle_stamps.length > 0)
      ? outcome.liteResult.matched_cycle_stamps.join(', ')
      : 'なし';
    Logger.log(`📌 [Lite検出スタンプ (matched_cycle_stamps)]: ${matchedStamps}`);
    const actualBackend = meta.backendModel || backendLabel;
    Logger.log(`📊 [トークン]: 合計 ${meta.newTotalTokens} tok (前段Lite: ${(meta.litePromptTokens || 0) + (meta.liteCandidatesTokens || 0)} + 後段[${actualBackend}]: ${(meta.flashPromptTokens || 0) + (meta.flashCandidatesTokens || 0)})`);
    Logger.log(`\n🆕 【新システム応答 (${outcome.phaseLabel} / ${actualBackend})】:\n${newReply}${formatActionSummary_(outcome.primaryResult)}`);

    const logLine = `${hhmm} User: ${turn.user}\nAI: ${newReply.replace(/\n/g, ' ')}`;
    runningLogs = runningLogs ? `${runningLogs}\n${logLine}` : logLine;
  }
  Logger.log('\n============================================================\n');
}

// =============================================================================
// 3. 個別サブシステム検証用関数（ブリーフィング・記憶代謝・深夜バッチ）
// =============================================================================

/**
 * 手動テスト用: APIキーで利用可能なGeminiモデル（特にFlash/Lite系）を一覧表示
 */
function testListGeminiModels() {
  const config = getConfig();
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${config.geminiApiKey}`;
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const data = JSON.parse(res.getContentText());
  Logger.log('=== 利用可能なGeminiモデル一覧 ===');
  if (data.models) {
    const flashModels = data.models
      .map(m => m.name.replace('models/', ''))
      .filter(name => name.includes('flash') || name.includes('lite'));
    Logger.log('Flash/Lite系モデル:\n' + flashModels.join('\n'));
  } else {
    Logger.log('エラーまたはモデル取得失敗: ' + JSON.stringify(data));
  }

  // 404の理由を特定するための直接テスト
  const testModels = ['gemini-2.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'];
  for (const m of testModels) {
    const testUrl = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${config.geminiApiKey}`;
    const testRes = UrlFetchApp.fetch(testUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ contents: [{ parts: [{ text: 'ping' }] }] }),
      muteHttpExceptions: true
    });
    Logger.log(`[テスト ${m}]: status=${testRes.getResponseCode()} body=${testRes.getContentText().substring(0, 150)}`);
  }
}

/**
 * 手動テスト用: デイリーブリーフィングの生成結果をログ出力して確認（ドライラン）
 */
function testDailyBriefingOutput() {
  Logger.log('=== デイリーブリーフィング生成テスト開始 ===');
  const briefing = buildDailyBriefingText();
  Logger.log('\n' + briefing);
  Logger.log('=== デイリーブリーフィング生成テスト完了 ===');
}

/**
 * 手動テスト用: 中期記憶(rolling_memory)および長期記憶(profile)の代謝テスト（ドライラン）
 * @param {string=} targetDateStrOpt 指定日付の例: '2026-11-10'（省略時は当日全ログ対象）
 */
function testMemoryLifecycleSimulation(targetDateStrOpt) {
  Logger.log('=== 記憶新陳代謝テスト開始 ===');
  const now = new Date();
  const targetDateStr = targetDateStrOpt || Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
  const targetDate = targetDateStrOpt ? new Date(`${targetDateStr}T12:00:00+09:00`) : now;
  const logs = targetDateStrOpt ? getLogs(targetDateStr) : getLogs();
  const memory = getMemory();
  const targetEvents = (typeof getTodayEventsList === 'function') ? getTodayEventsList(targetDate) : [];
  const completedTasks = getTasks('完了').filter(t => t.completedDate === targetDateStr);

  Logger.log(`対象日: ${targetDateStr} / 対象ログ件数: ${logs.length} 件 / 完了タスク: ${completedTasks.length} 件`);
  const updates = analyzeMemoryUpdates(
    logs,
    memory.cycle_stamps,
    memory.weekly_summary,
    memory.rolling_memory,
    memory.profile,
    memory.dictionary,
    targetDateStr,
    {
      lifestyleHabits: memory.lifestyle_habits || '',
      targetEvents: targetEvents,
      completedTasks: completedTasks
    }
  );

  Logger.log('【解析結果】rolling_memory:\n' + (updates.rolling_memory || '（なし）'));
  Logger.log('【解析結果】profile:\n' + (updates.profile || '（なし）'));
  Logger.log('【解析結果】dictionary:\n' + (updates.dictionary || '（なし）'));
  Logger.log('【解析結果】weekly_summary:\n' + (updates.weekly_summary || '（なし）'));
  Logger.log('【解析結果】cycle_stamps:\n' + (updates.cycle_stamps || '（なし）'));
  Logger.log('💡 完全ドライランのため、スプレッドシートの書き換えは行っていません。');
}

/**
 * 手動テスト用: 深夜統合バッチ（Notion日報投稿＆ログクリア）の本番手動実行
 */
function testMidnightBatchSimulation() {
  dailyMidnightBatch();
}

/**
 * 手動テスト用: 日報生成の完全ドライラン検証（Notion投稿なし・プレーンテキスト出力）
 * - スプレッドシートから指定日付（デフォルト: '2026-11-01'）のログ・完了タスク・消化ストックを取得
 * - 該当データが空の場合は、11/1のリアルな検証用サンプルログを用いてGemini 3.8 Flashで生成
 * - Notion APIへのPOSTは行わず、生成されたMarkdown、所要時間、文字数、概算トークン数を Logger.log に出力
 * @param {string=} targetDateStrOpt 例: '2026-11-01' (省略時は '2026-11-01')
 */
function testDailyReportDryRun(targetDateStrOpt) {
  const targetDateStr = targetDateStrOpt || '2026-11-01';

  Logger.log('============================================================');
  Logger.log(`📊 【日報生成ドライラン検証】 対象日: ${targetDateStr}`);
  Logger.log('============================================================');

  // 1. スプレッドシートから該当日のログ・タスク・消化ストックを取得
  let logsTarget = [];
  let completedTasks = [];
  let consumedInputs = [];

  try {
    const windowData = getDailyReportWindowData_(targetDateStr);
    logsTarget = windowData.logs;
    completedTasks = windowData.completedTasks;
    consumedInputs = windowData.consumedInputs;

    Logger.log(`📥 スプレッドシート取得結果: ログ ${logsTarget.length}件 / 完了タスク ${completedTasks.length}件 / 消化ストック ${consumedInputs.length}件`);
  } catch (err) {
    Logger.log(`⚠️ スプレッドシート取得エラー: ${err.message}`);
  }

  // もしスプレッドシートからログが取得できなかった場合のフォールバック（11/1のリアルな検証用サンプルログ）
  if (logsTarget.length === 0) {
    Logger.log('ℹ️ 該当日のログがスプレッドシートから取得できなかったため、11/1検証用サンプルデータを使用してドライランを実行します。');
    logsTarget = [
      { timestamp: '2026-11-01 07:15:00', sender: 'user', message: 'おはよう！今日は11月の始まりだね。月初のタスク整理と制作作業を進めたいな' },
      { timestamp: '2026-11-01 07:45:00', sender: 'user', message: '朝ごはん食べて、昨日のチェアの高さ微調整した。腰がかなり楽' },
      { timestamp: '2026-11-01 10:30:00', sender: 'user', message: '生活伴走システムの日報プロンプトの改修案を整理中。重要度の反映とトークン削減の方向性が固まった' },
      { timestamp: '2026-11-01 13:00:00', sender: 'user', message: 'お昼にうどん食べた。午後はReaper立ち上げて新曲のベースライン打ち込みに入る' },
      { timestamp: '2026-11-01 16:45:00', sender: 'user', message: 'ベースラインの仮組み完了！グルーヴ感かなり良くなった。ちょっと休憩でぱずぎりのイベント触る' },
      { timestamp: '2026-11-01 17:30:00', sender: 'user', message: 'ぱずぎりイベントで限定報酬ゲットできた。妹からLINE来て、夕飯の買い物頼まれたのでスーパー行ってくる' },
      { timestamp: '2026-11-01 19:15:00', sender: 'user', message: '買い物から帰宅。夕飯は家族で鍋食べた。温まる' },
      { timestamp: '2026-11-01 21:00:00', sender: 'user', message: 'シーツ洗濯物取り込んで、ストレッチ動画15分やった。明日は制作の続きと、ギターの基礎運指をしっかりやりたい' },
      { timestamp: '2026-11-01 23:45:00', sender: 'user', message: 'そろそろ歯磨きしてお風呂入って寝る準備するね。おやすみ！' }
    ];
    completedTasks = [
      { id: 'T_20261101_01', title: '生活伴走システム：日報プロンプト改修案の策定', memo: '重要度反映とトークン半減設計' },
      { id: 'T_20261101_02', title: '夕飯の食材買い出し', memo: '鍋の具材（妹からの頼まれもの）' }
    ];
    consumedInputs = [
      { type: 'ゲーム', title: '刀剣乱舞 ぱずぎり', memo: '11月限定イベント完走・報酬獲得' }
    ];
  }

  // 2. memory を取得
  const memory = getMemory();

  // 3. Gemini 3.8 Flash で新プロンプトによる日報Markdownを生成
  Logger.log('\n🤖 Gemini 3.8 Flash で新設計日報（Markdown）を生成中...');
  const startTime = new Date().getTime();
  const dailyReportMarkdown = generateDailyReportMarkdown(logsTarget, completedTasks, memory, targetDateStr, consumedInputs);
  const elapsedSec = ((new Date().getTime() - startTime) / 1000).toFixed(1);

  const charCount = dailyReportMarkdown.length;
  // 日本語＋Markdownのおおよそのトークン換算（1文字あたり約1〜1.2トークン）
  const estimatedTokens = Math.round(charCount * 1.15);

  const { metadata, markdown } = extractReportMetadata_(dailyReportMarkdown);

  Logger.log(`✅ 日報生成完了 (${elapsedSec}秒)`);
  Logger.log(`📊 出力文字数: ${charCount.toLocaleString()} 文字（概算: 約 ${estimatedTokens} トークン）`);
  Logger.log(`🏷️ 【抽出されたNotionプロパティ】:\n${JSON.stringify(metadata, null, 2)}\n`);
  Logger.log('==================== 【生成された日報（Notion本文）】 ====================\n');
  Logger.log(markdown);
  Logger.log('\n================================================================================');
  Logger.log('💡 完全ドライランのため、Notion APIへの送信およびスプレッドシートの更新は一切行っていません。');

  return dailyReportMarkdown;
}

/**
 * 手動テスト用: 温度シグナルと水増し排除の挙動を複数実ログ日で一括ドライラン検証
 * GASエディタ上で引数なしで実行し、11/04・11/05・11/06・11/11 の4日分を続けてログ出力します。
 */
function testDailyReportSamplesDryRun() {
  const sampleDates = ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-11'];
  for (let i = 0; i < sampleDates.length; i++) {
    testDailyReportDryRun(sampleDates[i]);
  }
}

/**
 * 手動テスト用: 月報生成の完全ドライラン検証（Notion投稿なし・プレーンテキスト出力）
 * - Notion日報DBから指定月（未指定時は直近月、例: 2026-10）の日報データを集約
 * - Gemini 3.8 Flash で月間ジャーナル（Markdown）を生成
 * - Notion APIへのPOSTは行わず、純粋なプレーンテキストとして Logger.log に出力
 * @param {string=} targetMonthStrOpt 例: '2026-10' (省略時は直近月を自動算出)
 */
function testMonthlyReportDryRun(targetMonthStrOpt) {
  const now = new Date();
  let targetMonthStr = targetMonthStrOpt;
  if (!targetMonthStr) {
    // 1日なら前月、それ以外なら当月（10月31日なら2026-10、11月1日なら2026-10）
    const d = (now.getDate() === 1)
      ? new Date(now.getFullYear(), now.getMonth() - 1, 1)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    targetMonthStr = `${y}-${('0' + m).slice(-2)}`;
  }

  const [yearStr, monthNumStr] = targetMonthStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthNumStr, 10);
  const lastDay = new Date(year, month, 0).getDate();
  const startDateStr = `${targetMonthStr}-01`;
  const endDateStr = `${targetMonthStr}-${('0' + lastDay).slice(-2)}`;

  Logger.log('============================================================');
  Logger.log(`📊 【月報生成ドライラン検証】 対象月: ${targetMonthStr}`);
  Logger.log(`・集約期間: ${startDateStr} 〜 ${endDateStr}`);
  Logger.log('============================================================');

  // 1. Notion日報DBから該当期間の日報データを集約
  let monthlyDataText = '';
  try {
    Logger.log('📥 Notion日報DBから日報データを取得中...');
    monthlyDataText = queryMonthlyReports(startDateStr, endDateStr);
    const charCount = monthlyDataText ? monthlyDataText.length : 0;
    Logger.log(`✅ Notion日報集約完了: 約 ${charCount.toLocaleString()} 文字`);
  } catch (err) {
    Logger.log(`⚠️ Notion日報取得エラー: ${err.message}`);
  }

  // もしNotionから取得できなかった場合のフォールバック（テスト用サンプル日報）
  if (!monthlyDataText || monthlyDataText.trim() === '') {
    Logger.log('ℹ️ Notionから該当月の日報が取得できなかったため、テスト用サンプル日報を使用して生成をテストします。');
    monthlyDataText = `【2026-10-15】
## 今日のハイライト
- 生活伴走システムの新アーキテクチャ設計に着手
- Reaperでのサウンドトラック制作を進めた
## 完了タスク
- [x] 年末調整書類の確認
## 秘書からのひとこと
制作作業お疲れさまでした！

【2026-10-31】
## 今日のハイライト
- システムの大掃除と2段階ハイブリッド構成への一本化を完了
- 家族とモンストの深淵クエストをクリア
## 完了タスク
- [x] 生活伴走システム：Gemini 3.1 Flash-Lite & 3.8 Flash ハイブリッド化
## 秘書からのひとこと
大改修本当にお疲れさまでした！`;
  }

  // 2. スプレッドシート memory から用語辞書を取得
  const memory = getMemory();

  // 3. Gemini 3.8 Flash で月報ジャーナルMarkdownを生成
  Logger.log('\n🤖 Gemini 3.8 Flash で月間ジャーナルを生成中...');
  const startTime = new Date().getTime();
  const monthlyJournalMarkdown = generateMonthlyJournalMarkdown(monthlyDataText, targetMonthStr, memory.dictionary);
  const elapsedSec = ((new Date().getTime() - startTime) / 1000).toFixed(1);

  const { metadata, markdown } = extractReportMetadata_(monthlyJournalMarkdown);

  Logger.log(`✅ 月報生成完了 (${elapsedSec}秒)\n`);
  Logger.log(`🏷️ 【抽出されたNotionプロパティ】:\n${JSON.stringify(metadata, null, 2)}\n`);
  Logger.log('==================== 【生成された月報（Notion本文）】 ====================\n');
  Logger.log(markdown);
  Logger.log('\n================================================================================');
  Logger.log('💡 完全ドライランのため、Notion APIへの送信およびスプレッドシートの更新は一切行っていません。');
}

/**
 * 手動実行用: 指定月の月報をNotion月報DBへ再生成・新規投稿
 * - Notion日報DBから指定月（デフォルト: '2026-10'）の日報データを集約
 * - 新プロンプト（等身大アーカイブ）でGemini 3.8 Flashにより月報Markdownを生成
 * - Notion月報DB（NOTION_MONTHLY_DB_ID）へ実際に新規ページとして作成
 * @param {string=} targetMonthStrOpt 例: '2026-10' (省略時は '2026-10')
 * @return {Object} 作成されたNotionページ情報
 */
function recreateMonthlyReport(targetMonthStrOpt) {
  const targetMonthStr = targetMonthStrOpt || '2026-10';

  const [yearStr, monthNumStr] = targetMonthStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthNumStr, 10);
  const lastDay = new Date(year, month, 0).getDate();
  const startDateStr = `${targetMonthStr}-01`;
  const endDateStr = `${targetMonthStr}-${('0' + lastDay).slice(-2)}`;

  Logger.log('============================================================');
  Logger.log(`📝 【月報再作成・Notion本番投稿】 対象月: ${targetMonthStr}`);
  Logger.log(`・集約期間: ${startDateStr} 〜 ${endDateStr}`);
  Logger.log('============================================================');

  // 1. Notion日報DBから該当期間の日報データを集約
  Logger.log('📥 Notion日報DBから日報データを取得中...');
  const monthlyDataText = queryMonthlyReports(startDateStr, endDateStr);
  const charCount = monthlyDataText ? monthlyDataText.length : 0;
  Logger.log(`✅ Notion日報集約完了: 約 ${charCount.toLocaleString()} 文字`);

  if (!monthlyDataText || monthlyDataText.trim() === '' || monthlyDataText.includes('見つかりませんでした')) {
    throw new Error(`対象期間（${startDateStr}〜${endDateStr}）の日報データがNotionから取得できませんでした。`);
  }

  // 2. 用語辞書取得
  const memory = getMemory();

  // 3. Gemini 3.8 Flash で月報Markdown生成
  Logger.log('🤖 新プロンプトでGemini 3.8 Flashにより月間ジャーナルを生成中...');
  const startTime = new Date().getTime();
  const monthlyJournalMarkdown = generateMonthlyJournalMarkdown(monthlyDataText, targetMonthStr, memory.dictionary);
  const elapsedSec = ((new Date().getTime() - startTime) / 1000).toFixed(1);
  Logger.log(`✅ 月報生成完了 (${elapsedSec}秒)`);

  // 4. Notion月報DBへ投稿
  Logger.log('🚀 Notion月報データベースへ作成中...');
  const result = createMonthlyReport(monthlyJournalMarkdown, targetMonthStr);
  Logger.log(`🎉 Notion月報作成成功！ ページID: ${result.id}`);
  Logger.log('==================== 【作成された月報】 ====================\n');
  Logger.log(monthlyJournalMarkdown);
  Logger.log('\n============================================================');

  return result;
}

// =============================================================================
// 内部ヘルパー関数（プライベート）
// =============================================================================

/**
 * 標準回帰テスト用の4大基本シナリオ定義
 * @private
 */
function getStandardTestScenarios_() {
  return [
    {
      name: '標準1 [多様性・重複排除]: 食後の隙間時間相談（同日に既出の提案がある場合）',
      initialLogs: '11:19 User: 今何して過ごそうかな\nAI: 『漱石と倫敦ミイラ殺人事件』を少し読み進めるか、穏やかな音楽を聴いてゆっくり過ごすのはいかがでしょうか。',
      turns: [
        {
          time: '2026-10-25 20:46:00',
          user: 'ご飯食べ終えてだいぶ経ったけど、今何して過ごすかちょっと悩んでる　家族が一緒に食べたいお菓子あるみたいだからすぐには寝ない'
        }
      ]
    },
    {
      name: '標準2 [直前物理行動の送り出し]: 準備行動の宣言（先回り・過保護の排除検証）',
      initialLogs: '',
      turns: [
        {
          time: '2026-10-25 17:00:00',
          user: 'そろそろお風呂洗ってお湯張ってくるね'
        }
      ]
    },
    {
      name: '標準3 [状態属性フィルタ]: 体調不良×手持ち無沙汰（安静姿勢で可能な複数プール提案）',
      initialLogs: '09:00 User: おはよう、朝ごはん食べたよ\nAI: おはようございます！しっかり朝食が摂れて良かったです。',
      turns: [
        {
          time: '2026-10-25 11:20:00',
          user: 'お腹が重たくて横になってるんだけど、全然眠くはなくて暇なんだよね。13時のお昼まで何して過ごそう'
        }
      ]
    },
    {
      name: '標準4 [見通し段取り＆文脈引き継ぎ]: 起床時の目標宣言 → ルーティン完了報告（2ターン連鎖）',
      initialLogs: '',
      turns: [
        {
          time: '2026-10-26 07:01:44',
          user: 'おはよう。今日は仕事前に生活伴走システムの改善をやりたいんだよね'
        },
        {
          time: '2026-10-26 07:09:26',
          user: '今日のメダル受け取り完了'
        }
      ]
    }
  ];
}

/**
 * AI応答に含まれるDB/カレンダー操作アクションをログ表示用に整形
 * @private
 */
function formatActionSummary_(res) {
  const actions = [];
  if (res.task_actions && res.task_actions.length > 0) {
    actions.push('task_actions: ' + JSON.stringify(res.task_actions));
  }
  if (res.calendar_actions && res.calendar_actions.length > 0) {
    actions.push('calendar_actions: ' + JSON.stringify(res.calendar_actions));
  }
  if (res.shopping_actions && res.shopping_actions.length > 0) {
    actions.push('shopping_actions: ' + JSON.stringify(res.shopping_actions));
  }
  if (res.input_stock_actions && res.input_stock_actions.length > 0) {
    actions.push('input_stock_actions: ' + JSON.stringify(res.input_stock_actions));
  }
  if (res.routine_actions && res.routine_actions.length > 0) {
    actions.push('routine_actions: ' + JSON.stringify(res.routine_actions));
  }
  if (res.project_actions && res.project_actions.length > 0) {
    actions.push('project_actions: ' + JSON.stringify(res.project_actions));
  }
  if (res.memory_updates && Object.keys(res.memory_updates).length > 0) {
    actions.push('memory_updates: ' + JSON.stringify(res.memory_updates));
  }
  return actions.length > 0 ? '\n📋 [出力アクション]: ' + actions.join(' | ') : '';
}

/**
 * 見出し行の書式整形ヘルパー
 * @private
 */
function formatHeaderRow_(sheet) {
  const headerRange = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1);
  headerRange.setBackground('#2E3B4E');
  headerRange.setFontColor('#FFFFFF');
  headerRange.setFontWeight('bold');
  sheet.setFrozenRows(1);
}
