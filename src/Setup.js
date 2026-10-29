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

  // 2. tasks タブ（全8列対応: リマインド目安追加）
  const taskHeaders = ['タスクID', 'タスク名', '期限', 'ステータス(未完了/完了/破棄)', '登録日', '完了日', 'メモ', 'リマインド目安'];
  let tasksSheet = ss.getSheetByName(SYSTEM_CONSTANTS.SHEET_NAMES.TASKS);
  if (!tasksSheet) tasksSheet = ss.insertSheet(SYSTEM_CONSTANTS.SHEET_NAMES.TASKS);
  if (tasksSheet.getLastRow() === 0) {
    tasksSheet.appendRow(taskHeaders);
    formatHeaderRow_(tasksSheet);
  } else if (tasksSheet.getLastColumn() < 8) {
    tasksSheet.getRange(1, 8).setValue('リマインド目安');
    formatHeaderRow_(tasksSheet);
  }

  // 3. routines タブ
  let routinesSheet = ss.getSheetByName(SYSTEM_CONSTANTS.SHEET_NAMES.ROUTINES);
  if (!routinesSheet) routinesSheet = ss.insertSheet(SYSTEM_CONSTANTS.SHEET_NAMES.ROUTINES);
  if (routinesSheet.getLastRow() === 0) {
    routinesSheet.appendRow(['ルール名', 'タイプ(day_of_week/day_of_month/interval_days)', '設定値', '最終生成日', 'メモ']);
    formatHeaderRow_(routinesSheet);
    routinesSheet.appendRow(['ギター基礎運指・クロマチック', 'day_of_week', 'MON,WED,FRI', '', '指先の感覚維持']);
    routinesSheet.appendRow(['モニタースピーカーイヤーケア & 無音時間', 'day_of_week', 'SUN', '', '耳のリセット']);
    routinesSheet.appendRow(['ギター弦交換・機材メンテナンス', 'interval_days', '21', '', '3週間周期メンテ']);
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
    memorySheet.appendRow(['weather_info', '自宅(磯子): 晴れ 最高22℃ 降水10% ｜ 職場(渋谷): 晴れ 最高23℃ 降水10%']);
    memorySheet.appendRow(['pressure_alert', 'FALSE']);
    memorySheet.appendRow(['cycle_stamps', '美容院: 2026-09-20, 機材メンテ: 2026-09-25']);
    memorySheet.appendRow(['weekly_summary', '睡眠時間は安定。中盤に肩こり・集中力低下の兆候あり。']);
    memorySheet.appendRow(['briefing_delivered_date', '']);
    memorySheet.appendRow(['monthly_report_ready', 'FALSE']);
    memorySheet.appendRow(['system_prompt', '']);
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
 * 手動実行用: コード上の最新システムプロンプト（旧システム用）および
 * 2モデル体制の全モジュールプロンプト群をスプレッドシートの memory シートに一括反映
 */
function syncSystemPromptToSpreadsheet() {
  setMemoryValue('system_prompt', getDefaultSystemPrompt());
  setMemoryValue('prompt_lite', getDefaultPromptLite());
  setMemoryValue('prompt_core', getDefaultPromptCore());
  setMemoryValue('prompt_phase_a', getDefaultPromptPhaseA());
  setMemoryValue('prompt_phase_b', getDefaultPromptPhaseB());
  setMemoryValue('prompt_phase_c', getDefaultPromptPhaseC());
  setMemoryValue('prompt_phase_d', getDefaultPromptPhaseD());
  setMemoryValue('prompt_db', getDefaultPromptDb());
  setMemoryValue('prompt_relief', getDefaultPromptRelief());
  Logger.log('✅ スプレッドシートの memory シートに全プロンプトモジュールを保存しました！');
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
  // 2026-10-29 の実測ログをベースにした新旧比較ドライラン
  const todayMorningLogs = [
    '07:41 User: おはよう　寒くて布団出たくない',
    'AI: おはようございます！朝の冷え込みが一段と強くなってきましたね。今日はリモートワークで10:00始業なので、ゆっくり身体を起こしていきましょう。',
    '08:13 User: メダル受け取り完了　そういえば昨日禁忌の獄もクリアした　禁忌の獄深淵は土日に家族とやるけどそれもタスク化しといて　朝ごはん食べ始めた',
    'AI: メダル受け取りと禁忌の獄クリアお疲れさまでした！「禁忌の獄〜深淵〜」は今週末のタスクとして登録しておきました。温かい朝ごはんをゆっくり楽しんでください！',
    '10:02 User: ✅ 「[生活伴走システム] Anthropicシステムプロンプトの参考検討」を完了したよ',
    'AI: Anthropicシステムプロンプトの参考検討、完了ですね！お仕事応援しています！',
    '11:45 User: ✅ 「マネージャーからのアドバイスのメモ・整理」を完了したよ',
    'AI: アドバイスの整理完了ですね！お疲れさまでした。お昼休憩で一息入れてください！',
    '12:24 User: ✅ 「Notion連携カレンダーの追加対応」を完了したよ',
    'AI: Notion連携カレンダーの追加対応完了ですね！お疲れさまでした。午後に向けてひと息ついてくださいね。',
    '15:58 User: 明日以降、派遣元から年末調整の案内が来るからSmartHRで対応が必要らしい',
    'AI: 年末調整の案内ですね、タスクに登録しておきました。落ち着いたタイミングで確認できるようにしておきますね。'
  ].join('\n');

  const scenario = {
    name: '本日実測検証: 非提案時のトークン削減 ＆ 目標表明への寄り添い（Row 80 ＆ Row 81）',
    initialLogs: todayMorningLogs,
    turns: [
      {
        time: '2026-10-29 20:38:14',
        user: '夕飯食べてモンストニュース見終えた　さっさと風呂入らねば'
      },
      {
        time: '2026-10-29 22:03:13',
        user: '風呂上がったー、色々やることもある気がするけどちょっとシステム改善したい'
      }
    ]
  };

  runPromptScenario(scenario);
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
 * 汎用プロンプト検証ランナー（単発 ＆ 複数ターン動的連鎖・新旧AB比較対応）
 * スプレッドシートやLINEを一切変更せず、新システム（Lite + 動的アセンブルFlash）と
 * 旧システム（単一Flash）の出力・トークン消費・DBアクションを並列比較します。
 *
 * @param {{
 *   name: string,
 *   initialLogs?: string,
 *   turns: Array<{ time: string, user: string }>
 * }} scenario
 */
function runPromptScenario(scenario) {
  const memory = getMemory();
  // ドライランでは強制的に AB_TEST モードとして新旧両方を並列実行して比較
  const testMemory = Object.assign({}, memory, { system_mode: 'AB_TEST' });

  let runningLogs = scenario.initialLogs || '';

  Logger.log('============================================================');
  Logger.log(`🧪 【${scenario.name}】 (${scenario.turns.length}ターン / 新旧AB並列ドライラン)`);
  Logger.log('============================================================');

  for (let i = 0; i < scenario.turns.length; i++) {
    const turn = scenario.turns[i];
    const simulatedDate = new Date(turn.time.replace(' ', 'T') + '+09:00');
    const timeLabel = Utilities.formatDate(simulatedDate, 'Asia/Tokyo', 'yyyy-MM-dd(E) HH:mm');
    const hhmm = Utilities.formatDate(simulatedDate, 'Asia/Tokyo', 'HH:mm');

    Logger.log(`\n--- 💬 Turn ${i + 1} [${timeLabel}] ---`);
    Logger.log(`User: ${turn.user}`);

    const outcome = executeCompanionTurn(turn.user, [], runningLogs, testMemory, simulatedDate);
    const meta = outcome.logMeta || {};
    const newReply = (outcome.primaryResult && outcome.primaryResult.reply_text) || '';
    const oldReply = (outcome.oldResult && outcome.oldResult.reply_text) || '';

    Logger.log(`\n🧭 [Lite判定]: ${meta.phaseAndTags || ''}`);
    Logger.log(`📊 [トークン]: 新合計 ${meta.newTotalTokens} tok (Lite:${(meta.litePromptTokens || 0) + (meta.liteCandidatesTokens || 0)} + Flash:${(meta.flashPromptTokens || 0) + (meta.flashCandidatesTokens || 0)}) vs 旧合計 ${meta.oldTotalTokens} tok ➡️ 差分: ${meta.tokenReductionDiff}`);
    Logger.log(`\n🆕 【新システム (${outcome.phaseLabel})】:\n${newReply}${formatActionSummary_(outcome.primaryResult)}`);
    Logger.log(`\n🕰️ 【旧システム】:\n${oldReply}${formatActionSummary_(outcome.oldResult || {})}`);
    if (outcome.missedActionsNote) {
      Logger.log(`\n${outcome.missedActionsNote}`);
    }

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
 */
function testMemoryLifecycleSimulation() {
  Logger.log('=== 記憶新陳代謝テスト開始 ===');
  const logs = getLogs();
  const memory = getMemory();
  const todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

  Logger.log(`対象ログ件数: ${logs.length} 件`);
  const updates = analyzeMemoryUpdates(
    logs,
    memory.cycle_stamps,
    memory.weekly_summary,
    memory.rolling_memory,
    memory.profile,
    memory.dictionary,
    todayStr
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
