/**
 * Setup.js - 初期化・メンテナンス・プロンプト検証モジュール (v2)
 * スプレッドシート全6タブの自動初期化（10列tasks / 6列input_stock / prompt_deck）、
 * 03:00 / 05:00 / 17:00 トリガー設定、および汎用ドライラン検証関数群
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

  // 2. tasks タブ（全10列対応: 見込み所要時間(分)追加）
  const taskHeaders = ['タスクID', 'タスク名', '期限', 'ステータス(未完了/完了/破棄)', '登録日', '完了日', 'メモ', 'リマインド目安', '関連URL', '見込み所要時間(分)'];
  let tasksSheet = ss.getSheetByName(SYSTEM_CONSTANTS.SHEET_NAMES.TASKS);
  if (!tasksSheet) tasksSheet = ss.insertSheet(SYSTEM_CONSTANTS.SHEET_NAMES.TASKS);
  if (tasksSheet.getLastRow() === 0) {
    tasksSheet.appendRow(taskHeaders);
    formatHeaderRow_(tasksSheet);
  } else if (tasksSheet.getLastColumn() < 10) {
    if (tasksSheet.getLastColumn() < 8) {
      tasksSheet.getRange(1, 8).setValue('リマインド目安');
    }
    if (tasksSheet.getLastColumn() < 9) {
      tasksSheet.getRange(1, 9).setValue('関連URL');
    }
    tasksSheet.getRange(1, 10).setValue('見込み所要時間(分)');
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

  // 5. input_stock タブ（全6列対応: 見込み所要時間(分)追加）
  let inputStockSheet = ss.getSheetByName(SYSTEM_CONSTANTS.SHEET_NAMES.INPUT_STOCK);
  if (!inputStockSheet) inputStockSheet = ss.insertSheet(SYSTEM_CONSTANTS.SHEET_NAMES.INPUT_STOCK);
  if (inputStockSheet.getLastRow() === 0) {
    inputStockSheet.appendRow(['種別', 'タイトル', 'メモ', 'ステータス(未/完)', '消化日', '見込み所要時間(分)']);
    formatHeaderRow_(inputStockSheet);
    inputStockSheet.appendRow(['音楽', 'Ludwig Göransson - Oppenheimer OST', '音響設計の分析', '未', '', 45]);
    inputStockSheet.appendRow(['映画', 'Dune: Part Two', 'サウンドデザイン視聴', '未', '', 120]);
  } else if (inputStockSheet.getLastColumn() < 6) {
    inputStockSheet.getRange(1, 6).setValue('見込み所要時間(分)');
    formatHeaderRow_(inputStockSheet);
  }

  // 6. memory タブ
  let memorySheet = ss.getSheetByName(SYSTEM_CONSTANTS.SHEET_NAMES.MEMORY);
  if (!memorySheet) memorySheet = ss.insertSheet(SYSTEM_CONSTANTS.SHEET_NAMES.MEMORY);
  if (memorySheet.getLastRow() === 0) {
    memorySheet.appendRow(['キー', '値']);
    formatHeaderRow_(memorySheet);
    memorySheet.appendRow(['profile', '']);
    memorySheet.appendRow(['backend_model', '3.5-lite']);
    memorySheet.appendRow(['thinking_level', 'low']);
    memorySheet.appendRow(['weather_info', '']);
    memorySheet.appendRow(['pressure_alert', 'FALSE']);
    memorySheet.appendRow(['cycle_stamps', '']);
    memorySheet.appendRow(['weekly_summary', '']);
    memorySheet.appendRow(['briefing_delivered_date', '']);
    memorySheet.appendRow(['monthly_report_ready', 'FALSE']);
    memorySheet.appendRow(['prompt_core', '']);
    memorySheet.appendRow(['prompt_schedule', '']);
    memorySheet.appendRow(['prompt_db', '']);
    memorySheet.appendRow(['prompt_deck', '']);
    memorySheet.appendRow(['V2_FAST_STATE', '']);
    memorySheet.appendRow(['custom_system_prompt', '']);
    memorySheet.appendRow(['dictionary', '']);
    memorySheet.appendRow(['ideal_self', '']);
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
 * v2 定期トリガー（03:00 深夜統合 / 05:00 朝天気 / 17:00 夜デッキ再編成）を自動作成
 */
function setupTriggers() {
  const targetHandlers = {
    dailyMidnightBatch: true,
    morningWeatherBatch: true,
    eveningDeckBatch: true
  };
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (targetHandlers[triggers[i].getHandlerFunction()]) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger('dailyMidnightBatch')
    .timeBased()
    .atHour(3)
    .everyDays(1)
    .create();

  ScriptApp.newTrigger('morningWeatherBatch')
    .timeBased()
    .atHour(5)
    .everyDays(1)
    .create();

  ScriptApp.newTrigger('eveningDeckBatch')
    .timeBased()
    .atHour(17)
    .everyDays(1)
    .create();

  Logger.log('v2 トリガー（03:00 dailyMidnightBatch / 05:00 morningWeatherBatch / 17:00 eveningDeckBatch）を登録しました！');
}

/**
 * 手動テスト用: コード上の全モジュールプロンプト群（prompt_deck含む）をスプレッドシート memory シートに一括反映
 */
function syncDefaultPromptsToSpreadsheet() {
  setMemoryValue('prompt_core', getDefaultPromptCore());
  setMemoryValue('prompt_schedule', getDefaultPromptSchedule());
  setMemoryValue('prompt_db', getDefaultPromptDb());
  if (typeof getDefaultPromptDeck === 'function') {
    setMemoryValue('prompt_deck', getDefaultPromptDeck());
  }
  Logger.log('✅ スプレッドシートの memory シートに全4モジュールプロンプト（prompt_core / prompt_schedule / prompt_db / prompt_deck）を保存しました！');
}

/**
 * 互換エイリアス
 */
function syncSystemPromptToSpreadsheet() {
  syncDefaultPromptsToSpreadsheet();
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
