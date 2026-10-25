/**
 * Setup.js - 初期化およびセットアップ自動化モジュール
 * スプレッドシート全6タブの自動初期化、深夜タイマートリガー自動作成、動作テスト用関数
 */

/**
 * スプレッドシートの全6タブとヘッダー行を自動作成・初期化
 */
function setupSpreadsheet() {
  const ss = getSpreadsheet();

  // 1. logs タブ
  let logsSheet = ss.getSheetByName(SYSTEM_CONSTANTS.SHEET_NAMES.LOGS);
  if (!logsSheet) logsSheet = ss.insertSheet(SYSTEM_CONSTANTS.SHEET_NAMES.LOGS);
  if (logsSheet.getLastRow() === 0) {
    logsSheet.appendRow(['時刻', '発言者', 'メッセージ', '画像URL', 'AI返答']);
    formatHeaderRow(logsSheet);
  }

  // 2. tasks タブ
  let tasksSheet = ss.getSheetByName(SYSTEM_CONSTANTS.SHEET_NAMES.TASKS);
  if (!tasksSheet) tasksSheet = ss.insertSheet(SYSTEM_CONSTANTS.SHEET_NAMES.TASKS);
  if (tasksSheet.getLastRow() === 0) {
    tasksSheet.appendRow(['タスクID', 'タスク名', '期限', 'ステータス(未完了/完了/破棄)', '登録日', '完了日', 'メモ']);
    formatHeaderRow(tasksSheet);
  }

  // 3. routines タブ
  let routinesSheet = ss.getSheetByName(SYSTEM_CONSTANTS.SHEET_NAMES.ROUTINES);
  if (!routinesSheet) routinesSheet = ss.insertSheet(SYSTEM_CONSTANTS.SHEET_NAMES.ROUTINES);
  if (routinesSheet.getLastRow() === 0) {
    routinesSheet.appendRow(['ルール名', 'タイプ(day_of_week/day_of_month/interval_days)', '設定値', '最終生成日', 'メモ']);
    formatHeaderRow(routinesSheet);
    // サンプル初期データ
    routinesSheet.appendRow(['ギター基礎運指・クロマチック', 'day_of_week', 'MON,WED,FRI', '', '指先の感覚維持']);
    routinesSheet.appendRow(['モニタースピーカーイヤーケア & 無音時間', 'day_of_week', 'SUN', '', '耳のリセット']);
    routinesSheet.appendRow(['ギター弦交換・機材メンテナンス', 'interval_days', '21', '', '3週間周期メンテ']);
  }

  // 4. shopping タブ
  let shoppingSheet = ss.getSheetByName(SYSTEM_CONSTANTS.SHEET_NAMES.SHOPPING);
  if (!shoppingSheet) shoppingSheet = ss.insertSheet(SYSTEM_CONSTANTS.SHEET_NAMES.SHOPPING);
  if (shoppingSheet.getLastRow() === 0) {
    shoppingSheet.appendRow(['品名', 'カテゴリ', 'ステータス(未買/購入済)', '登録日']);
    formatHeaderRow(shoppingSheet);
  }

  // 5. input_stock タブ
  let inputStockSheet = ss.getSheetByName(SYSTEM_CONSTANTS.SHEET_NAMES.INPUT_STOCK);
  if (!inputStockSheet) inputStockSheet = ss.insertSheet(SYSTEM_CONSTANTS.SHEET_NAMES.INPUT_STOCK);
  if (inputStockSheet.getLastRow() === 0) {
    inputStockSheet.appendRow(['種別', 'タイトル', 'メモ', 'ステータス(未/完)', '消化日']);
    formatHeaderRow(inputStockSheet);
    inputStockSheet.appendRow(['音楽', 'Ludwig Göransson - Oppenheimer OST', '音響設計の分析', '未', '']);
    inputStockSheet.appendRow(['映画', 'Dune: Part Two', 'サウンドデザイン視聴', '未', '']);
  }

  // 6. memory タブ
  let memorySheet = ss.getSheetByName(SYSTEM_CONSTANTS.SHEET_NAMES.MEMORY);
  if (!memorySheet) memorySheet = ss.insertSheet(SYSTEM_CONSTANTS.SHEET_NAMES.MEMORY);
  if (memorySheet.getLastRow() === 0) {
    memorySheet.appendRow(['キー', '値']);
    formatHeaderRow(memorySheet);
    memorySheet.appendRow(['profile', 'サウンドディレクター / ゲーム・映像音響制作。自宅(横浜市磯子区)と職場(渋谷)。DTM・ギター演奏が日課。']);
    memorySheet.appendRow(['weather_info', '自宅(磯子): 晴れ 最高22℃ 降水10% ｜ 職場(渋谷): 晴れ 最高23℃ 降水10%']);
    memorySheet.appendRow(['pressure_alert', 'FALSE']);
    memorySheet.appendRow(['cycle_stamps', '美容院: 2026-09-20, 機材メンテ: 2026-09-25']);
    memorySheet.appendRow(['weekly_summary', '睡眠時間は安定。中盤に肩こり・集中力低下の兆候あり。']);
    memorySheet.appendRow(['briefing_delivered_date', '']);
    memorySheet.appendRow(['monthly_report_ready', 'FALSE']);
    memorySheet.appendRow(['system_prompt', '']);
    memorySheet.appendRow(['dictionary', '・ぽこあポケモン（ぽこあ）: Nintendo Switch 2用ゲーム（2026年3月5日発売予定）。スローライフ・サンドボックス作品。※スマホの「ポケポケ」とは全くの別物。\n・ぱずぎり: パズルアクションゲーム。\n・残響フラクタル: ユーザーが執筆・制作しているオリジナルの創作作品。']);
  }

  // デフォルトの「シート1」があれば削除
  const defaultSheet = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    try {
      ss.deleteSheet(defaultSheet);
    } catch (e) {}
  }

  Logger.log('スプレッドシートの初期設定が完了しました！');
}

/**
 * 見出し行の書式整形ヘルパー
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 */
function formatHeaderRow(sheet) {
  const headerRange = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1);
  headerRange.setBackground('#2E3B4E');
  headerRange.setFontColor('#FFFFFF');
  headerRange.setFontWeight('bold');
  sheet.setFrozenRows(1);
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
 * 手動テスト用: LINEテキスト受信時の挙動をエミュレート
 */
function testWebhookSimulation() {
  const config = getConfig();
  const dummyEvent = {
    postData: {
      contents: JSON.stringify({
        events: [
          {
            type: 'message',
            replyToken: '00000000000000000000000000000000',
            source: {
              userId: config.ownerUserId
            },
            message: {
              type: 'text',
              text: '作業終わった！これから帰宅するよ'
            }
          }
        ]
      })
    }
  };

  const output = doPost(dummyEvent);
  Logger.log('テスト実行結果: ' + output.getContent());
}

/**
 * 手動テスト用: Web検索時の挙動をエミュレート（タスク自動追加されないことの検証）
 */
function testWebSearchSimulation() {
  const config = getConfig();
  const dummyEvent = {
    postData: {
      contents: JSON.stringify({
        events: [
          {
            type: 'message',
            replyToken: '00000000000000000000000000000000',
            source: {
              userId: config.ownerUserId
            },
            message: {
              type: 'text',
              text: 'Inter BEE 2026の開催日程っていつからいつまで？'
            }
          }
        ]
      })
    }
  };

  const output = doPost(dummyEvent);
  Logger.log('Web検索テスト実行結果: ' + output.getContent());
}

/**
 * 手動テスト用: 深夜統合バッチを手動実行して動作確認
 */
function testMidnightBatchSimulation() {
  dailyMidnightBatch();
}

/**
 * 開発・検証用: 中期記憶(rolling_memory)および長期記憶(profile)の代謝テスト
 * ログ消去やNotion投稿を行わず、現在のログから中長期記憶がどう解析・更新されるかをテストします。
 */
function testMemoryLifecycleSimulation() {
  Logger.log('=== 記憶新陳代謝テスト開始 ===');
  const logs = getLogs();
  const memory = getMemory();
  const todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

  Logger.log(`対象ログ件数: ${logs.length} 件`);
  Logger.log(`現在の rolling_memory:\n${memory.rolling_memory || '（空）'}`);
  Logger.log(`現在の profile:\n${memory.profile}`);
  Logger.log(`現在の dictionary:\n${memory.dictionary || '（空）'}`);

  const updates = analyzeMemoryUpdates(
    logs,
    memory.cycle_stamps,
    memory.weekly_summary,
    memory.rolling_memory,
    memory.profile,
    memory.dictionary,
    todayStr
  );

  Logger.log('------------------------------------------');
  Logger.log('【解析結果】更新された rolling_memory（直近バッファ全体）:\n' + (updates.rolling_memory || '（なし）'));
  Logger.log('------------------------------------------');
  Logger.log('【解析結果】更新された profile（長期記憶）:\n' + (updates.profile || '（なし）'));
  Logger.log('------------------------------------------');
  Logger.log('【解析結果】更新された dictionary（用語辞書）:\n' + (updates.dictionary || '（なし）'));
  Logger.log('------------------------------------------');
  Logger.log('【解析結果】更新された weekly_summary（直近サマリー）:\n' + (updates.weekly_summary || '（なし）'));
  Logger.log('------------------------------------------');
  Logger.log('【解析結果】更新された cycle_stamps（周期記録）:\n' + (updates.cycle_stamps || '（なし）'));
  Logger.log('------------------------------------------');
  Logger.log('💡 完全ドライラン（検証モード）のため、スプレッドシートの書き換えは行っていません。');
}

/**
 * 手動実行用: LINEリッチメニュー（画面下部固定メニュー）の自動登録・有効化
 * スクリプトプロパティ WEBAPP_URL を使用してLINE公式アカウントの画面下に4分割メニューを自動構築します
 */
function setupLineRichMenuFromSetup() {
  setupLineRichMenu();
}

/**
 * 手動テスト用: デイリーブリーフィングの生成結果をログ出力して確認
 * 本日の天気・気圧・予定（カレンダー）・タスクが正しく組み立てられるかをテストします
 */
function testDailyBriefingOutput() {
  Logger.log('=== デイリーブリーフィング生成テスト開始 ===');
  const briefing = buildDailyBriefingText();
  Logger.log('\n' + briefing);
  Logger.log('=== デイリーブリーフィング生成テスト完了 ===');
}

/**
 * 手動実行用: デフォルトの最新システムプロンプトをスプレッドシートの memory シート (system_prompt) に同期保存
 * ※GASエディタから実行すると、現在のコード上の最新プロンプトがスプレッドシートへ書き込まれます。
 */
function syncSystemPromptToSpreadsheet() {
  const promptText = getDefaultSystemPrompt();
  setMemoryValue('system_prompt', promptText);
  Logger.log('✅ スプレッドシートの memory シートに最新の system_prompt を保存しました！');
}

/**
 * 共通ヘルパー: シーン別の新旧プロンプト比較実行
 */
function runPromptComparisonCase(sceneName, simulatedDateStr, simulatedLogsText, userMessage) {
  const simulatedDate = new Date(simulatedDateStr.replace(' ', 'T') + '+09:00');
  const sheetContext = getSpreadsheetContext(userMessage, simulatedLogsText, simulatedDate);
  const calendarContext = getCalendarAndHolidayContext();
  const combinedContext = `${sheetContext}\n\n${calendarContext}`;

  const memory = getMemory();
  const customSuffix = (memory.custom_system_prompt && memory.custom_system_prompt.trim() !== '')
    ? `\n\n【追加カスタム指示（最優先フォーマット・ルール）】\n${memory.custom_system_prompt.trim()}`
    : '';

  const oldPrompt = (memory.system_prompt || '').trim() + customSuffix;
  const newPrompt = getDefaultSystemPrompt().trim() + customSuffix;

  Logger.log('============================================================');
  Logger.log(`🧪 【${sceneName}】`);
  Logger.log('⏰ シミュレーション日時: ' + Utilities.formatDate(simulatedDate, 'Asia/Tokyo', 'yyyy-MM-dd(E) HH:mm'));
  Logger.log('💬 ユーザー発言: ' + userMessage);
  Logger.log('============================================================');

  const oldResult = callGeminiFlash(userMessage, [], combinedContext, simulatedLogsText, oldPrompt);
  const newResult = callGeminiFlash(userMessage, [], combinedContext, simulatedLogsText, newPrompt);

  Logger.log('\n--- 1. 旧プロンプト（当時スプシ版） ---\n' + (oldResult.reply_text || ''));
  Logger.log('\n--- 2. 新プロンプト（今回再構築版） ---\n' + (newResult.reply_text || ''));
  Logger.log('============================================================\n');
}

/**
 * 手動テスト用: 主要シーンを一括比較テスト（Scene 1 〜 3）
 */
function testPromptComparisonSimulation() {
  testScene1_EveningSnackWaiting();
  testScene2_AfternoonPostGaming();
  testScene3_NightWindDown();
}

/**
 * シーン1: 日曜 20:46（食後・お菓子待ちの隙間時間 ※昼に『漱石』『音楽』提案済みの状態）
 * 検証点: 重複の回避、放置タスク（ヘアブラシ掃除等）や手軽な手入れが拾えるか
 */
function testScene1_EveningSnackWaiting() {
  const logs = getCondensedTodayLogs('2026-10-25 20:46:00');
  runPromptComparisonCase(
    'シーン1: 日曜夜20:46 お菓子待ち（昼に漱石・音楽提案済み）',
    '2026-10-25 20:46:00',
    logs,
    'ご飯食べ終えてだいぶ経ったけど、今何して過ごすかちょっと悩んでる　家族が一緒に食べたいお菓子あるみたいだからすぐには寝ない'
  );
}

/**
 * シーン2: 日曜 14:30（午前中にぽこポケを満喫済・昼食後の1時間半の余白）
 * 検証点: ゲーム充足後のクイックなスキルアップ（30分スケッチ・運指等）や前倒しタスクの自然な提案
 */
function testScene2_AfternoonPostGaming() {
  const logs = '09:00 User: おはよう、朝ごはん食べた！\nAI: おはようございます！\n09:30 User: ぽこポケやってくるね\nAI: ぽこポケ、いってらっしゃい！\n12:00 User: ぽこポケ楽しかった〜！お昼ごはん食べる\nAI: たっぷり楽しめて良かったです！お昼ごはんいってらっしゃい！\n13:30 User: ごちそうさま！少しゴロゴロしたよ\nAI: お疲れさまでした！';
  runPromptComparisonCase(
    'シーン2: 休日午後14:30 ゲーム充足後の余白（16時風呂沸かしまで）',
    '2026-10-25 14:30:00',
    logs,
    '16時にお風呂沸かすまで1時間半くらいあるんだけど、何して過ごそうかな'
  );
}

/**
 * シーン3: 平日 21:45（入浴・ドライヤー後の就寝前クールダウン時間）
 * 検証点: 21:30以降のルール遵守（高覚醒タスク・ゲーム周回の除外、静かなクールダウン）
 */
function testScene3_NightWindDown() {
  const logs = '19:30 User: 退勤したよ\nAI: 今日もお疲れさまでした！\n20:30 User: ご飯食べ終わった！\nAI: 夕食お疲れさまでした！\n21:15 User: お風呂入ってくる\nAI: ゆっくり温まってきてくださいね！';
  runPromptComparisonCase(
    'シーン3: 平日夜21:45 入浴後の就寝前クールダウン',
    '2026-10-29 21:45:00',
    logs,
    'お風呂から上がって髪も乾かした！23時には寝たいけど、それまで何して過ごそうかな'
  );
}

/**
 * シーン4: 平日 08:00（朝食後の始業前ゆとり時間）
 * 検証点: 「ごちそうさまでした」等の視点混同禁止、惰性の助長禁止、爽やかな朝時間活用の後押し
 */
function testScene4_MorningBuffer() {
  const logs = '07:00 User: おはよう、起きた！\nAI: おはようございます！朝日を浴びて白湯を飲んでいきましょう。';
  runPromptComparisonCase(
    'シーン4: 平日朝08:00 始業前のゆとり時間（10時リモート始業まで）',
    '2026-10-30 08:00:00',
    logs,
    '朝ごはん食べ終わった！10時のリモート始業までまだ2時間弱あるな'
  );
}

/**
 * シーン5: 準備行動の宣言（風呂掃除・お湯張り）
 * 検証点: 「準備ができたら温まって〜」等の条件付き先回りの完全排除、1文での軽快な送り出し
 */
function testScene5_ActionSendOff() {
  runPromptComparisonCase(
    'シーン5: 準備行動の宣言（風呂掃除とお湯張り）',
    '2026-10-25 17:00:00',
    '',
    'そろそろお風呂洗ってお湯張ってくるね'
  );
}

/**
 * シーン6: 体調不良・安静中だが暇を持て余している場面（日曜 11:20）
 * 検証点: 立ち作業を除外しつつ、「寝てください」一辺倒や『漱石＋音楽』の固定化に陥らず、
 *         横になったままできる複数チャンネル（スマホ手元タスク・映像/本・感覚休息等）を提案できるか
 */
function testScene6_SickAndBored() {
  const logs = '09:00 User: おはよう、朝ごはん食べたよ\nAI: おはようございます！しっかり朝食が摂れて良かったです。';
  runPromptComparisonCase(
    'シーン6: 体調不良×暇（お腹が重く横になっているが眠くはなく手持ち無沙汰）',
    '2026-10-25 11:20:00',
    logs,
    'お腹が重たくて横になってるんだけど、全然眠くはなくて暇なんだよね。13時のお昼まで何して過ごそう'
  );
}

/**
 * 手動テスト用: シーン4・5・6を一括比較テスト
 */
function testScene4to6() {
  testScene4_MorningBuffer();
  testScene5_ActionSendOff();
  testScene6_SickAndBored();
}

/**
 * シーン7: 平日朝 07:01 起床直後の活動目標宣言（10時リモート始業前・3時間の可処分時間）
 * 検証点:
 * 1. 起床直後の低覚醒状態を踏まえ、いきなり作業に入らせず極小負荷のウォームアップ（身体覚醒・水分・身支度等）を促せているか
 * 2. 単なる応援相槌で終わらず、10時始業から逆算した「ウォームアップ → 主活動（集中枠） → 始業前バッファ」のタイムラインを提案できているか
 */
function testScene7_MorningWakeUpAndGoal() {
  runPromptComparisonCase(
    'シーン7: 平日朝07:01 起床直後の活動目標宣言（10時リモート始業前）',
    '2026-10-26 07:01:44',
    '',
    'おはよう。今日は仕事前に生活伴走システムの改善をやりたいんだよね'
  );
}

/**
 * シーン8: 平日朝 07:09 ルーティン完了報告（始業まで2時間50分の可処分時間）
 * 検証点:
 * 1. タスク完了の労い（聞き手視点）とタスク更新
 * 2. 単に文を閉じて会話を終了させず、事前のスケジュールに沿って次のネクストアクション（身支度や改善作業）へ自然にバトンを渡せているか
 */
function testScene8_RoutineCompleteWithBuffer() {
  const logs = '07:01 User: おはよう。今日は仕事前に生活伴走システムの改善をやりたいんだよね\nAI: おはようございます！10時の始業まで約3時間ありますね。まずは水分補給や身支度で身体のエンジンをかけつつ、07:45〜09:45あたりでガッツリ改善作業の集中時間を取るスケジュールはいかがでしょうか？';
  runPromptComparisonCase(
    'シーン8: 平日朝07:09 ルーティン完了報告（始業まで2時間50分余白）',
    '2026-10-26 07:09:26',
    logs,
    '今日のメダル受け取り完了'
  );
}

/**
 * 手動テスト用: シーン7・8を一括テスト
 */
function testScene7and8() {
  testScene7_MorningWakeUpAndGoal();
  testScene8_RoutineCompleteWithBuffer();
}



