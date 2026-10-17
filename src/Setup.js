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

