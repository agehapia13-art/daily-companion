/**
 * Tests.js - 手動実行テスト・ドライランシナリオ・モデル疎通確認スイート
 */

/**
 * 手動テスト用: v2 FastState・アンカー合成・AIデッキ生成のドライラン確認
 */
function testV2DeckDryRun() {
  const now = new Date();
  const memory = getMemory();
  const wb = getWorkModeAndBoundary(now, memory.profile);
  const fastState = loadFastState(now);
  const aiDeck = generateAiDeck({
    reason: 'dry_run',
    now: now,
    memory: memory,
    fastState: fastState,
    workMode: wb.workMode,
    todayEvents: wb.todayEvents,
    boundaryInfo: wb.boundaryInfo,
    useFlashModel: false
  });
  Logger.log('=== v2 AI Deck Dry Run ===');
  Logger.log('workMode: ' + wb.workMode + ' / dayKey: ' + fastState.dayKey);
  Logger.log('cards: ' + JSON.stringify(aiDeck.cards, null, 2));
  Logger.log('lowCards: ' + JSON.stringify(aiDeck.lowCards, null, 2));
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
  const customStylePrompt = '【口調・話し方】\n丁寧な敬体（です・ます調）で、落ち着いた頼れる伴走者として自然に応答する。\n情緒的な慰めや定型の労い・前置きは最小限にとどめ、さっぱりとした等身大の距離感で、要点へ端的に入る。';

  // 0. 決定論的ユニット確認（v2 1段構成・Prefix Cache順序・3.5-lite解決・サニタイズ・動的カレンダー・JSON/Web検索分離）
  const calMarch = getCalendarAndHolidayContext(new Date(2026, 10, 13, 10, 22, 0), '', '2027-03-01', '2027-03-31');
  const calClamped = getCalendarAndHolidayContext(new Date(2026, 10, 13, 10, 22, 0), '', '2026-11-13', '2027-11-13');
  const upcomingHolidays = getUpcomingHolidaysSummary_(new Date(2026, 10, 13, 10, 22, 0));
  const unitCandidateTasks = [
    { id: 'T_done', title: '[趣味・文化] モンスト周回', dueDate: '2026-11-14', remindContext: '' },
    { id: 'T_later', title: '[趣味・文化] いつかやる', dueDate: '', remindContext: '' },
    { id: 'T_prio', title: '⭐[優先] [家事・環境] パスワード移行', dueDate: '', remindContext: '最優先' }
  ];
  const unitHabitsMemory = {
    backend_model: '3.5-lite',
    thinking_level: 'low',
    profile: 'リモートワーク中心の生活者',
    lifestyle_habits: '[運動・身体ケア] ストレッチ / フィットネス\n[余白・趣味] 読書 / 創作',
    cycle_stamps: 'ゲーム: 2026-11-10',
    custom_system_prompt: customStylePrompt
  };
  const basePrecomputed = {
    now: new Date(2026, 10, 13, 10, 0, 0),
    nowStr: '2026-11-13(Fri) 10:00',
    todayDate: new Date(2026, 10, 13),
    elapsedStr: '初回',
    boundaryInfo: { summaryText: 'なし' },
    todayEvents: [],
    allUncompletedTasks: unitCandidateTasks
  };
  const dummyPass1Payload = buildChatPayload_(
    'テスト雑談',
    [],
    '',
    unitHabitsMemory,
    basePrecomputed,
    { isSecondPass: false }
  );
  const dummyPass2Payload = buildChatPayload_(
    'テスト事実質問',
    [],
    '',
    unitHabitsMemory,
    basePrecomputed,
    {
      isSecondPass: true,
      extendedCalendarContext: '=== 追加取得: 2027-03-15 予定 ===',
      webSearchContext: {
        summaryText: 'テスト施設は10:00〜18:00開館です。',
        queries: ['テスト施設 開館時間'],
        chunksCount: 1,
        sources: [{ title: '公式サイト', uri: 'https://example.com' }],
        failed: false
      }
    }
  );
  const dummyWsPayload = buildGeminiWebSearchPayload_(
    '旧前田家本邸洋館の11月の開館日・休館日・開館時間',
    { nowStr: '2026-11-13(Fri) 20:45' },
    '激しい腹痛アリ。あと買物メモに柔軟剤追加と開館日調べて'
  );
  const dummyWsFallbackPayload = buildGeminiWebSearchPayload_(
    '',
    { nowStr: '2026-11-13(Fri) 20:45' },
    '明日の東京の天気は？'
  );
  const sanitizedUpdate = sanitizeChatActionResult_({
    reaction_emoji: '📝',
    reply_mode: 'reply',
    reply_text: '更新しました',
    need_web_search_query: '',
    need_calendar_range: { start: '', end: '' },
    task_actions: [{ action: 'update', task_id: 'T_1', due_date: '2026-11-20', memo: '', remind_context: null, estimated_mins: 0 }]
  });
  const relaxedJsonParsed = parseGeminiActionJson_(
    '{\n  "reply_text": \'読了お疲れ様！次は "ストレッチ" か本でも。\',\n  "task_actions": [{ "action": "complete", "task_id": "T_done" }],\n  "memory_updates": { "cycle_stamps_updates": "読書（本・漫画）: 2026-11-14" }\n}',
    {}
  );

  const unitChecks = [
    ['isUmbrellaEventTitle("自由時間")', isUmbrellaEventTitle('自由時間') === true],
    ['isUmbrellaEventTitle("休息")', isUmbrellaEventTitle('休息') === true],
    ['isUmbrellaEventTitle("休憩")', isUmbrellaEventTitle('休憩') === true],
    ['isUmbrellaEventTitle("リモートワーク")', isUmbrellaEventTitle('リモートワーク') === false],
    [
      'resolveBackendModel_(デフォルト未指定 -> 3.5-lite)',
      resolveBackendModel_({}).model === 'gemini-3.5-flash-lite'
    ],
    [
      'resolveBackendModel_("3.5-lite")',
      resolveBackendModel_({ backend_model: '3.5-lite' }).model === 'gemini-3.5-flash-lite'
    ],
    [
      'resolveBackendModel_("hydrogen")',
      resolveBackendModel_({ backend_model: 'hydrogen' }).model === 'gemini-4-hydrogen'
    ],
    [
      'resolveThinkingConfig_("low")',
      resolveThinkingConfig_('gemini-3.5-flash-lite', { thinking_level: 'low' }).thinkingLevel === 'low'
    ],
    [
      'resolveThinkingConfig_("gemini-3.8-flash", minimal->low安全フォールバック)',
      resolveThinkingConfig_('gemini-3.8-flash', { thinking_level: 'minimal' }).thinkingLevel === 'low'
    ],
    [
      'resolveThinkingConfig_("gemini-4-hydrogen", minimal->low安全フォールバック)',
      resolveThinkingConfig_('gemini-4-hydrogen', { thinking_level: 'minimal' }).thinkingLevel === 'low'
    ],
    [
      'resolveThinkingConfig_("gemini-4-hydrogen", "xhigh")',
      resolveThinkingConfig_('gemini-4-hydrogen', { thinking_level: 'xhigh' }).thinkingLevel === 'xhigh'
    ],
    [
      'getCalendarAndHolidayContext(2027-03-01..2027-03-31)',
      calMarch.indexOf('2027-03-01') !== -1 && calMarch.indexOf('2027-03-31') !== -1
    ],
    [
      'getCalendarAndHolidayContext(62日安全クランプ)',
      calClamped.indexOf('2027-01-14') !== -1 && calClamped.indexOf('2027-11-13') === -1
    ],
    [
      'getUpcomingHolidaysSummary_(2026-11-23勤労感謝の日)',
      upcomingHolidays.indexOf('2026-11-23') !== -1
    ],
    [
      'buildChatPayload_(JSON専念・CHAT_RESPONSE_SCHEMA・Static Prefix Cache構造)',
      !dummyPass1Payload.tools &&
      dummyPass1Payload.generationConfig.responseMimeType === 'application/json' &&
      dummyPass1Payload.generationConfig.responseSchema === CHAT_RESPONSE_SCHEMA &&
      dummyPass1Payload.contents[0].parts[0].text.indexOf('【プロファイル（恒久生活基盤）】') <
      dummyPass1Payload.contents[0].parts[0].text.indexOf('=== ユーザーの最新発言 ===') &&
      dummyPass2Payload.contents[0].parts[0].text.indexOf('【追加取得カレンダー予定（2段目取得結果）】') !== -1 &&
      dummyPass2Payload.contents[0].parts[0].text.indexOf('【外部Web検索結果（一次情報）') !== -1
    ],
    [
      'buildGeminiWebSearchPayload_(search_query純粋化＆私的情報遮断)',
      dummyWsPayload.contents[0].parts[0].text.indexOf('旧前田家本邸洋館の11月の開館日・休館日・開館時間') !== -1 &&
      dummyWsPayload.contents[0].parts[0].text.indexOf('腹痛') === -1 &&
      dummyWsPayload.contents[0].parts[0].text.indexOf('柔軟剤') === -1 &&
      Boolean(dummyWsPayload.tools && dummyWsPayload.tools[0] && dummyWsPayload.tools[0].googleSearch) &&
      dummyWsPayload.generationConfig.responseMimeType === undefined &&
      dummyWsPayload.generationConfig.thinkingConfig.thinkingLevel === 'medium' &&
      dummyWsFallbackPayload.contents[0].parts[0].text.indexOf('明日の東京の天気は？') !== -1
    ],
    [
      'sanitizeChatActionResult_(update空キー保護 & 空レンジ除去)',
      sanitizedUpdate.task_actions[0].due_date === '2026-11-20' &&
      !('memo' in sanitizedUpdate.task_actions[0]) &&
      !('remind_context' in sanitizedUpdate.task_actions[0]) &&
      !('estimated_mins' in sanitizedUpdate.task_actions[0]) &&
      !('need_calendar_range' in sanitizedUpdate)
    ],
    [
      'parseGeminiActionJson_(シングルクォート準JSON救済 & アクション保持)',
      relaxedJsonParsed.reply_text === '読了お疲れ様！次は "ストレッチ" か本でも。' &&
      Array.isArray(relaxedJsonParsed.task_actions) &&
      relaxedJsonParsed.task_actions.length === 1 &&
      relaxedJsonParsed.memory_updates &&
      relaxedJsonParsed.memory_updates.cycle_stamps_updates === '読書（本・漫画）: 2026-11-14'
    ]
  ];
  Logger.log('============================================================');
  Logger.log('🧪 【検証0: ロジック単体チェック (完全ドライラン)】');
  unitChecks.forEach(([label, ok]) => Logger.log(`${ok ? '✅' : '❌'} ${label}`));

  const mockTasksTurn1 = [
    {
      id: 'T_20261103_200621_731',
      title: '[家事・環境] 私物の整理',
      dueDate: '2026-11-14',
      status: '未完了',
      memo: '',
      remindContext: '週末のまとまった時間',
      docUrl: ''
    },
    {
      id: 'T_20261113_190000_002',
      title: '[実務・手続] Amazonアカウント：早希ちゃんに相談する（〜21:00まで）',
      dueDate: '2026-11-14',
      status: '未完了',
      memo: '',
      remindContext: '〜21:00まで',
      docUrl: ''
    },
    {
      id: 'T_20261107_100000_003',
      title: '[趣味・文化] 読書：天使1/2方程式を読む',
      dueDate: '',
      status: '未完了',
      memo: '',
      remindContext: '余白時間・リラックス',
      docUrl: ''
    },
    {
      id: 'T_20261113_090000_004',
      title: '[趣味・文化] モンスト：超究極・兵のミザリー周回',
      dueDate: '2026-11-14',
      status: '未完了',
      memo: '毎日ルーティン',
      remindContext: '日課・隙間時間',
      docUrl: ''
    },
    {
      id: 'T_20261110_180000_005',
      title: '⭐[優先] [家事・環境] Chrome・iCloud・Notionのパスワードを1Passwordへ順次移行',
      dueDate: '',
      status: '未完了',
      memo: '最優先で少しずつ進める',
      remindContext: 'PC作業できる時間',
      docUrl: ''
    }
  ];

  // Turn2ではTurn1で完了したミザリー周回を除いた残存タスク状態を模擬
  const mockTasksAfterMisery = mockTasksTurn1.filter(t => t.id !== 'T_20261113_090000_004');

  const holidayInitialLogs = [
    '11:38 User: おはよう',
    'AI: おはようございます。今日は特に時間指定の予定はない休日ですね。自分のペースで過ごしつつ、気になるところから進めていきましょう。'
  ].join('\n');

  // シナリオ1: 固定予定のない休日（終日家族予定のみ）における完了トランジション（PHASE_C）＆就寝前安全境界
  runPromptScenario({
    name: '休日空き時間完了トランジション検証 (11/14 再現)',
    mockMemory: {
      backend_model: '3.5-lite',
      thinking_level: 'low',
      custom_system_prompt: customStylePrompt
    },
    initialLogs: holidayInitialLogs,
    turns: [
      {
        time: '2026-11-14 11:46:55',
        user: '「モンスト：超究極・兵のミザリー周回」 完了',
        mockTasks: mockTasksTurn1
      },
      {
        time: '2026-11-14 11:53:01',
        user: '「読書：天使1/2方程式を読む」 完了',
        mockTasks: mockTasksAfterMisery
      },
      {
        time: '2026-11-14 23:45:00',
        user: 'もう歯磨きも終わったし、そろそろおやすみ',
        mockTasks: mockTasksAfterMisery.filter(t => t.id !== 'T_20261107_100000_003')
      }
    ]
  });

  // シナリオ2: 本業勤務中の完了報告に対する境界保護検証（PHASE_D維持・提案非介入確認）
  runPromptScenario({
    name: '境界保護検証 (平日リモートワーク中の完了報告 -> PHASE_D)',
    mockMemory: {
      backend_model: '3.5-lite',
      thinking_level: 'low',
      custom_system_prompt: customStylePrompt
    },
    mockTasks: [
      {
        id: 'T_20261113_110000_001',
        title: '[家事・環境] MacBook：手入れ・清掃',
        dueDate: '2026-11-13',
        status: '未完了',
        memo: '',
        remindContext: 'デスク作業時',
        docUrl: ''
      },
      ...mockTasksAfterMisery
    ],
    initialLogs: '',
    turns: [
      {
        time: '2026-11-13 10:07:08',
        user: '「MacBook：手入れ・清掃」 を完了'
      }
    ]
  });

  // シナリオ3: 休日余白時間の非タスク含む提案（挨拶/DB依頼 -> PHASE_C）と突発トラブル保護（-> PHASE_D）
  runPromptScenario({
    name: '休日余白提案(挨拶/DB依頼->PHASE_C非タスク併用) ＆ トラブル保護(->PHASE_D)',
    mockMemory: {
      backend_model: '3.5-lite',
      thinking_level: 'low',
      custom_system_prompt: customStylePrompt
    },
    mockTasks: [...mockTasksAfterMisery],
    initialLogs: '',
    turns: [
      {
        time: '2026-11-14 11:38:08',
        user: 'おはよう'
      },
      {
        time: '2026-11-14 12:03:26',
        user: 'パソコンのモニターからパチパチと異音が😱 寿命か……'
      },
      {
        time: '2026-11-14 15:10:00',
        user: '牛乳を買い物メモに追加して'
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
 *   turns: Array<{ time: string, user: string, mockMemory?: Object, mockTasks?: Array<Object> }>,
 *   compareModels?: Array<{ label: string, backend_model: string, thinking_level?: string, isBaselineForHistory?: boolean }>
 * }} scenario
 */
function runPromptScenario(scenario) {
  const memory = getMemory();
  // v2 単独ドライランモード（コード内最新の4モジュールデフォルトプロンプトを直接評価）
  const testMemory = Object.assign({}, memory, scenario.mockMemory || {}, {
    prompt_core: '',
    prompt_schedule: '',
    prompt_db: '',
    prompt_deck: '',
    _testCalendarExcludeDate: scenario.excludeCalendarDate || ''
  });
  if (typeof scenario.useLiteForBackend === 'boolean') {
    testMemory._testUseLiteForBackend = scenario.useLiteForBackend;
  }

  let runningLogs = scenario.initialLogs || '';

  const hasCompareModels = Array.isArray(scenario.compareModels) && scenario.compareModels.length > 0;
  const modelSpecs = hasCompareModels
    ? scenario.compareModels
    : [{ label: '', backend_model: testMemory.backend_model, thinking_level: testMemory.thinking_level, isBaselineForHistory: true }];
  const isMultiCompare = modelSpecs.length > 1;

  const backendLabel = (typeof resolveBackendModel_ === 'function')
    ? resolveBackendModel_(testMemory).model
    : SYSTEM_CONSTANTS.GEMINI_35_LITE_MODEL;
  const headerBackend = isMultiCompare
    ? `比較モデル: ${modelSpecs.map(s => s.backend_model).join(' / ')}`
    : `モデル: ${backendLabel}`;
  Logger.log('============================================================');
  Logger.log(`🧪 【${scenario.name}】 [${headerBackend}] (${scenario.turns.length}ターン / v2 ドライラン)`);
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

    let baselineReply = '';
    for (let m = 0; m < modelSpecs.length; m++) {
      const spec = modelSpecs[m];
      const specMemory = Object.assign({}, turnMemory);
      if (spec.backend_model) specMemory.backend_model = spec.backend_model;
      if (spec.thinking_level) specMemory.thinking_level = spec.thinking_level;

      const outcome = executeCompanionTurn(turn.user, [], runningLogs, specMemory, simulatedDate);
      const replyText = logTurnBackendOutcome_(outcome, spec, isMultiCompare, backendLabel);
      if (spec.isBaselineForHistory || (m === 0 && !baselineReply)) {
        baselineReply = replyText;
      }
    }

    const logLine = `${hhmm} User: ${turn.user}\nAI: ${baselineReply.replace(/\n/g, ' ')}`;
    runningLogs = runningLogs ? `${runningLogs}\n${logLine}` : logLine;
  }
  Logger.log('\n============================================================\n');
}

/**
 * モデルの検索・速度・トークン・応答内容をログ出力するヘルパー
 * @return {string} reply_text
 * @private
 */
function logTurnBackendOutcome_(outcome, spec, isMultiCompare, defaultBackendLabel) {
  const meta = outcome.logMeta || {};
  const primary = outcome.primaryResult || {};
  const newReply = primary.reply_text || `[スタンプ: ${primary.reaction_emoji || '👍'}]`;
  const actualBackend = meta.backendModel || defaultBackendLabel;

  if (isMultiCompare && spec.label) {
    Logger.log(`\n── 🤖 [${spec.label}] ──`);
  }

  Logger.log(`🧭 [v2判定]: ${meta.phaseAndTags || ''} / emoji:${primary.reaction_emoji || '👍'} / mode:${primary.reply_mode || 'reply'}`);
  if (meta.webSearchUsed) {
    const queries = Array.isArray(meta.webSearchQueries) ? meta.webSearchQueries : [];
    const chunksCount = meta.groundingChunksCount || 0;
    Logger.log(`🔍 [Web検索 (${meta.webSearchModel || '3.5-lite'})]: ${queries.join(' / ') || '(クエリなし)'} (chunks:${chunksCount}, failed:${Boolean(meta.webSearchFailed)})`);
  }

  const p1OrWsMs = meta.liteLatencyMs || 0;
  const mainMs = meta.flashLatencyMs || 0;
  Logger.log(`⏱️ [応答時間]: 計 ${((p1OrWsMs + mainMs) / 1000).toFixed(2)}s / 📊 [トークン合計]: ${meta.newTotalTokens || 0} tok (Pass1+WS=${(meta.litePromptTokens || 0) + (meta.liteCandidatesTokens || 0) + (meta.liteThinkingTokens || 0)}, Final[${actualBackend}]=in:${meta.flashPromptTokens || 0}, out:${meta.flashCandidatesTokens || 0}, think:${meta.flashThinkingTokens || 0})`);
  Logger.log(`\n🆕 【v2 応答 (${actualBackend})】:\n${newReply}${formatActionSummary_(primary)}`);
  return newReply;
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
