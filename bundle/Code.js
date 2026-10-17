/**
 * Code.js - Life Secretary System All-in-One Bundle
 * Generated automatically
 */

// ==========================================
// FILE: src/Config.js
// ==========================================

/**
 * Config.js - 生活秘書システム 設定およびスクリプトプロパティ管理
 */

/**
 * スクリプトプロパティの基本必須キー一覧
 */
const REQUIRED_PROPERTIES = [
  'OWNER_USER_ID',
  'LINE_CHANNEL_ACCESS_TOKEN',
  'GEMINI_API_KEY',
  'SPREADSHEET_ID',
  'DRIVE_FOLDER_ID',
  'NOTION_API_KEY',
  'NOTION_DAILY_DB_ID',
  'NOTION_MONTHLY_DB_ID'
];

/**
 * システム定数
 */
const SYSTEM_CONSTANTS = {
  GEMINI_MODEL: 'gemini-3.8-flash',
  GEMINI_ENDPOINT_BASE: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
  LINE_REPLY_ENDPOINT: 'https://api.line.me/v2/bot/message/reply',
  LINE_CONTENT_ENDPOINT_BASE: 'https://api-data.line.me/v2/bot/message',
  NOTION_API_BASE: 'https://api.notion.com/v1',
  NOTION_VERSION: '2022-06-28',
  JAPAN_HOLIDAY_CALENDAR_ID: 'ja.japanese#holiday@group.v.calendar.google.com',
  OPEN_METEO_BASE: 'https://api.open-meteo.com/v1/forecast',
  IMAGE_BUFFER_PROP_KEY: 'BUFFERED_IMAGE_METAS',
  IMAGE_BUFFER_TTL_MS: 30 * 60 * 1000, // 30分
  RECENT_LOGS_TURNS_LIMIT: 4, // マルチターンに含める直近会話往復数 (最大8メッセージ)
  SHEET_NAMES: {
    LOGS: 'logs',
    TASKS: 'tasks',
    ROUTINES: 'routines',
    SHOPPING: 'shopping',
    INPUT_STOCK: 'input_stock',
    MEMORY: 'memory'
  },
  // デフォルト座標
  DEFAULT_COORDINATES: {
    HOME: { lat: 35.3970, lon: 139.6179, name: '自宅(横浜市磯子区)' },
    WORK: { lat: 35.6580, lon: 139.7016, name: '職場(渋谷)' }
  }
};

/**
 * スクリプトプロパティを取得・検証してオブジェクトとして返却
 * @return {Object} 各種設定値
 */
function getConfig() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const missing = [];

  for (let i = 0; i < REQUIRED_PROPERTIES.length; i++) {
    const key = REQUIRED_PROPERTIES[i];
    if (!props[key] || props[key].trim() === '') {
      missing.push(key);
    }
  }

  // 座標設定のチェック（HOME_LATITUDE または LOCATION_LATITUDE）
  const hasHomeCoord = (props.HOME_LATITUDE && props.HOME_LONGITUDE) || (props.LOCATION_LATITUDE && props.LOCATION_LONGITUDE);
  if (!hasHomeCoord) {
    missing.push('HOME_LATITUDE (または LOCATION_LATITUDE)');
    missing.push('HOME_LONGITUDE (または LOCATION_LONGITUDE)');
  }

  if (missing.length > 0) {
    throw new Error(`必要なスクリプトプロパティが設定されていません: ${missing.join(', ')}`);
  }

  // 自宅座標の確定
  const homeLat = props.HOME_LATITUDE ? parseFloat(props.HOME_LATITUDE.trim()) : (props.LOCATION_LATITUDE ? parseFloat(props.LOCATION_LATITUDE.trim()) : SYSTEM_CONSTANTS.DEFAULT_COORDINATES.HOME.lat);
  const homeLon = props.HOME_LONGITUDE ? parseFloat(props.HOME_LONGITUDE.trim()) : (props.LOCATION_LONGITUDE ? parseFloat(props.LOCATION_LONGITUDE.trim()) : SYSTEM_CONSTANTS.DEFAULT_COORDINATES.HOME.lon);

  // 職場座標の確定
  const workLat = props.WORK_LATITUDE ? parseFloat(props.WORK_LATITUDE.trim()) : SYSTEM_CONSTANTS.DEFAULT_COORDINATES.WORK.lat;
  const workLon = props.WORK_LONGITUDE ? parseFloat(props.WORK_LONGITUDE.trim()) : SYSTEM_CONSTANTS.DEFAULT_COORDINATES.WORK.lon;

  return {
    ownerUserId: props.OWNER_USER_ID.trim(),
    lineChannelAccessToken: props.LINE_CHANNEL_ACCESS_TOKEN.trim(),
    geminiApiKey: props.GEMINI_API_KEY.trim(),
    spreadsheetId: props.SPREADSHEET_ID.trim(),
    driveFolderId: props.DRIVE_FOLDER_ID.trim(),
    notionApiKey: props.NOTION_API_KEY.trim(),
    notionDailyDbId: props.NOTION_DAILY_DB_ID.trim(),
    notionMonthlyDbId: props.NOTION_MONTHLY_DB_ID.trim(),
    home: {
      latitude: homeLat,
      longitude: homeLon,
      name: '自宅(磯子)'
    },
    work: {
      latitude: workLat,
      longitude: workLon,
      name: '職場(渋谷)'
    },
    familyCalendarId: props.FAMILY_CALENDAR_ID ? props.FAMILY_CALENDAR_ID.trim() : ''
  };
}

// ==========================================
// FILE: src/Spreadsheet.js
// ==========================================

/**
 * Spreadsheet.js - スプレッドシート操作モジュール
 * 全6タブ（logs, tasks, routines, shopping, input_stock, memory）の厳密な読み書きとデータ変換
 */

/**
 * スプレッドシートオブジェクトを取得
 * @return {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getSpreadsheet() {
  const config = getConfig();
  return SpreadsheetApp.openById(config.spreadsheetId);
}

/**
 * シート名を指定して取得。存在しない場合は自動作成
 * @param {string} sheetName
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getOrCreateSheet(sheetName) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  return sheet;
}

// ==========================================
// 1. logs (当日ログ) 操作
// ヘッダー: [時刻, 発言者, メッセージ, 画像URL, AI返答]
// ==========================================

/**
 * 当日の会話ログを全件取得
 * @return {Array<Object>} ログ一覧
 */
function getLogs() {
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.LOGS);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  return values.map(row => ({
    timestamp: row[0],
    sender: row[1],
    message: String(row[2] || ''),
    imageUrl: String(row[3] || ''),
    aiReply: String(row[4] || '')
  }));
}

/**
  * 当日の会話ログを全件取得し、極小高密度の会話テキスト（HH:mm User: ... / AI: ...）に圧縮変換
  * 日時・秒・空列・重複を除去し、朝から夜までの全伏線を最小トークンで保持
  * @return {string}
  */
function getCondensedTodayLogs() {
  const allLogs = getLogs();
  if (allLogs.length === 0) return '';

  const validPairs = allLogs.filter(log => log.message && log.message.trim() !== '');
  if (validPairs.length === 0) return '';

  const lines = [];
  for (let i = 0; i < validPairs.length; i++) {
    const log = validPairs[i];
    let timeStr = '';
    if (log.timestamp) {
      // 2026-10-13 08:29:04 や Dateオブジェクトから HH:mm だけを抽出
      if (log.timestamp instanceof Date) {
        timeStr = Utilities.formatDate(log.timestamp, 'Asia/Tokyo', 'HH:mm');
      } else {
        const match = String(log.timestamp).match(/(\d{1,2}:\d{2})/);
        timeStr = match ? match[1] : '';
      }
    }
    const prefix = timeStr ? `${timeStr} ` : '';
    lines.push(`${prefix}User: ${log.message.trim()}`);
    if (log.aiReply && log.aiReply.trim()) {
      lines.push(`AI: ${log.aiReply.trim()}`);
    }
  }

  return lines.join('\n');
}

/**
 * ログを追加
 * @param {string} timestamp 日時文字列
 * @param {string} sender 発言者（user / ai）
 * @param {string} message メッセージ本文
 * @param {string} imageUrl 関連画像URL
 * @param {string} aiReply AIの返答内容
 */
function appendLog(timestamp, sender, message, imageUrl, aiReply) {
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.LOGS);
  sheet.appendRow([
    timestamp || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss'),
    sender || 'user',
    message || '',
    imageUrl || '',
    aiReply || ''
  ]);
}

/**
 * ログシートをクリア（ヘッダー行は残す）
 */
function clearDailyLogs() {
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.LOGS);
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
  }
}

// ==========================================
// 2. tasks (単発タスク) 操作
// ヘッダー: [タスクID, タスク名, 期限, ステータス(未完了/完了/破棄), 登録日, 完了日, メモ]
// ==========================================

/**
 * タスク一覧を取得
 * @param {string} filterStatus オプション（未完了 / 完了 / 破棄）
 * @return {Array<Object>}
 */
function getTasks(filterStatus) {
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.TASKS);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  const tasks = values.map((row, index) => ({
    rowIndex: index + 2,
    id: String(row[0]),
    title: String(row[1]),
    dueDate: row[2] ? Utilities.formatDate(new Date(row[2]), 'Asia/Tokyo', 'yyyy-MM-dd') : '',
    status: String(row[3]),
    createdDate: row[4] ? Utilities.formatDate(new Date(row[4]), 'Asia/Tokyo', 'yyyy-MM-dd') : '',
    completedDate: row[5] ? Utilities.formatDate(new Date(row[5]), 'Asia/Tokyo', 'yyyy-MM-dd') : '',
    memo: String(row[6])
  }));

  if (filterStatus) {
    return tasks.filter(t => t.status === filterStatus);
  }
  return tasks;
}

/**
 * Geminiレスポンスに基づくタスク操作を適用
 * @param {Array<Object>} actions
 * @return {Array<string>} 適用結果のメッセージリスト
 */
function applyTaskActions(actions) {
  if (!actions || !Array.isArray(actions) || actions.length === 0) return [];
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.TASKS);
  const todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const results = [];

  for (let i = 0; i < actions.length; i++) {
    const act = actions[i];
    if (!act || !act.action) continue;

    if (act.action === 'add' && act.title) {
      const taskId = 'T_' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss') + '_' + Math.floor(Math.random() * 1000);
      const dueDate = act.due_date || '';
      sheet.appendRow([taskId, act.title, dueDate, '未完了', todayStr, '', '']);
      results.push(`📝 タスク追加: ${act.title}${dueDate ? ` (期限: ${dueDate})` : ''}`);
    } else if (act.action === 'complete') {
      const tasks = getTasks();
      for (let j = 0; j < tasks.length; j++) {
        const t = tasks[j];
        if (t.status === '未完了') {
          const matchById = act.task_id && t.id === act.task_id;
          const matchByTitle = act.title && t.title.includes(act.title);
          if (matchById || matchByTitle) {
            sheet.getRange(t.rowIndex, 4).setValue('完了');
            sheet.getRange(t.rowIndex, 6).setValue(todayStr);
            results.push(`✅ タスク完了: ${t.title}`);
            break;
          }
        }
      }
    } else if (act.action === 'delete') {
      const tasks = getTasks();
      for (let j = 0; j < tasks.length; j++) {
        const t = tasks[j];
        const matchById = act.task_id && t.id === act.task_id;
        const matchByTitle = act.title && t.title.includes(act.title);
        if (matchById || matchByTitle) {
          sheet.getRange(t.rowIndex, 4).setValue('破棄');
          results.push(`🗑️ タスク破棄: ${t.title}`);
          break;
        }
      }
    }
  }
  return results;
}

// ==========================================
// 3. routines (繰り返し定義) 操作
// ヘッダー: [ルール名, タイプ(day_of_week/day_of_month/interval_days), 設定値, 最終生成日, メモ]
// ==========================================

/**
 * ルーティン一覧を取得
 * @return {Array<Object>}
 */
function getRoutines() {
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.ROUTINES);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  return values.map((row, index) => ({
    rowIndex: index + 2,
    ruleName: String(row[0]),
    type: String(row[1]),
    value: String(row[2]),
    lastGeneratedDate: row[3] ? Utilities.formatDate(new Date(row[3]), 'Asia/Tokyo', 'yyyy-MM-dd') : '',
    memo: String(row[4])
  }));
}

/**
 * ルーティン追加アクションを適用
 * @param {Array<Object>} actions
 * @return {Array<string>}
 */
function applyRoutineActions(actions) {
  if (!actions || !Array.isArray(actions) || actions.length === 0) return [];
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.ROUTINES);
  const results = [];

  for (let i = 0; i < actions.length; i++) {
    const act = actions[i];
    if (act.action === 'add' && act.title) {
      const type = act.type || 'day_of_week';
      const value = act.value || 'MON';
      sheet.appendRow([act.title, type, value, '', '']);
      results.push(`🔄 ルーティン追加: ${act.title} (${value})`);
    }
  }
  return results;
}

/**
 * ルーティンの最終生成日を更新
 * @param {number} rowIndex
 * @param {string} dateStr YYYY-MM-DD
 */
function updateRoutineLastGenerated(rowIndex, dateStr) {
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.ROUTINES);
  sheet.getRange(rowIndex, 4).setValue(dateStr);
}

// ==========================================
// 4. shopping (買い物リスト) 操作
// ヘッダー: [品名, カテゴリ, ステータス(未買/購入済), 登録日]
// ==========================================

/**
 * 買い物リスト一覧を取得
 * @param {string} filterStatus 未買 / 購入済
 * @return {Array<Object>}
 */
function getShoppingList(filterStatus) {
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.SHOPPING);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  const list = values.map((row, index) => ({
    rowIndex: index + 2,
    item: String(row[0]),
    category: String(row[1]),
    status: String(row[2]),
    createdDate: row[3] ? Utilities.formatDate(new Date(row[3]), 'Asia/Tokyo', 'yyyy-MM-dd') : ''
  }));

  if (filterStatus) {
    return list.filter(item => item.status === filterStatus);
  }
  return list;
}

/**
 * 買い物アクションを適用
 * @param {Array<Object>} actions
 * @return {Array<string>}
 */
function applyShoppingActions(actions) {
  if (!actions || !Array.isArray(actions) || actions.length === 0) return [];
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.SHOPPING);
  const todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const results = [];

  for (let i = 0; i < actions.length; i++) {
    const act = actions[i];
    if (!act || !act.action) continue;

    if (act.action === 'add' && act.item) {
      sheet.appendRow([act.item, act.category || '日用品', '未買', todayStr]);
      results.push(`🛒 買物リスト追加: ${act.item}`);
    } else if (act.action === 'complete' && act.item) {
      const items = getShoppingList();
      for (let j = 0; j < items.length; j++) {
        const it = items[j];
        if (it.status === '未買' && it.item.includes(act.item)) {
          sheet.getRange(it.rowIndex, 3).setValue('購入済');
          results.push(`🛒 買物完了: ${it.item}`);
          break;
        }
      }
    }
  }
  return results;
}

// ==========================================
// 5. input_stock (映画・音楽・本のストック) 操作
// ヘッダー: [種別, タイトル, メモ, ステータス(未/完), 消化日]
// ==========================================

/**
 * インプットストック一覧を取得
 * @param {string} filterStatus 未 / 完
 * @return {Array<Object>}
 */
function getInputStockList(filterStatus) {
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.INPUT_STOCK);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  const list = values.map((row, index) => ({
    rowIndex: index + 2,
    type: String(row[0]),
    title: String(row[1]),
    memo: String(row[2]),
    status: String(row[3]),
    consumedDate: row[4] ? Utilities.formatDate(new Date(row[4]), 'Asia/Tokyo', 'yyyy-MM-dd') : ''
  }));

  if (filterStatus) {
    return list.filter(item => item.status === filterStatus);
  }
  return list;
}

/**
 * インプットストックアクションを適用
 * @param {Array<Object>} actions
 * @return {Array<string>}
 */
function applyInputStockActions(actions) {
  if (!actions || !Array.isArray(actions) || actions.length === 0) return [];
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.INPUT_STOCK);
  const todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const results = [];

  for (let i = 0; i < actions.length; i++) {
    const act = actions[i];
    if (!act || !act.action) continue;

    if (act.action === 'add' && act.title) {
      sheet.appendRow([act.type || '映画', act.title, act.memo || '', '未', '']);
      results.push(`🎬 インプット追加: ${act.title}`);
    } else if (act.action === 'complete' && act.title) {
      const list = getInputStockList();
      for (let j = 0; j < list.length; j++) {
        const item = list[j];
        if (item.status === '未' && item.title.includes(act.title)) {
          sheet.getRange(item.rowIndex, 4).setValue('完');
          sheet.getRange(item.rowIndex, 5).setValue(todayStr);
          results.push(`🎬 インプット完了: ${item.title}`);
          break;
        }
      }
    }
  }
  return results;
}

// ==========================================
// 6. memory (プロファイル・中長期記憶・システム制御) 操作
// ヘッダー: [キー, 値]
// 保持キー: profile, weather_info, pressure_alert, cycle_stamps, weekly_summary, briefing_delivered_date, monthly_report_ready
// ==========================================

/**
 * メモリテーブルをオブジェクト形式で全取得（ブール値およびDate型の正規化を含む）
 * @return {Object}
 */
function getMemory() {
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.MEMORY);
  const lastRow = sheet.getLastRow();
  const memoryObj = {
    profile: '',
    weather_info: '',
    pressure_alert: 'FALSE',
    cycle_stamps: '',
    weekly_summary: '',
    briefing_delivered_date: '',
    monthly_report_ready: 'FALSE',
    custom_system_prompt: '',
    rolling_memory: '',
    dictionary: ''
  };

  if (lastRow <= 1) return memoryObj;

  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  for (let i = 0; i < values.length; i++) {
    const key = String(values[i][0]).trim();
    const rawVal = values[i][1];
    let val = '';
    if (rawVal instanceof Date) {
      // スプレッドシートが YYYY-MM-DD を自動で Date 型に変換した場合でも正確に文字列へ戻す
      val = Utilities.formatDate(rawVal, 'Asia/Tokyo', 'yyyy-MM-dd');
    } else if (rawVal != null) {
      val = String(rawVal).trim();
    }

    if (key) {
      if (key === 'pressure_alert' || key === 'monthly_report_ready') {
        // 真偽値の文字列表現を大文字 'TRUE' / 'FALSE' に正規化
        memoryObj[key] = val.toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE';
      } else {
        memoryObj[key] = val;
      }
    }
  }
  return memoryObj;
}

/**
 * 特定のメモリキーの値を更新（存在しなければ追加）
 * @param {string} key
 * @param {string} value
 */
function setMemoryValue(key, value) {
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.MEMORY);
  const lastRow = sheet.getLastRow();

  if (lastRow > 1) {
    const range = sheet.getRange(2, 1, lastRow - 1, 2);
    const rows = range.getValues();
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).trim() === key) {
        sheet.getRange(i + 2, 2).setValue(String(value));
        return;
      }
    }
  }

  // 見つからなかった場合のみ新規行として追加
  sheet.appendRow([key, String(value)]);
}

/**
 * プロファイルの安全な新陳代謝・更新（既存データの全消し・破壊的短縮を物理ガード）
 * @param {string} newProfileCandidate AIが提案した新しいプロファイル
 */
function updateProfileSafely(newProfileCandidate) {
  if (!newProfileCandidate || typeof newProfileCandidate !== 'string') return;
  const candidate = newProfileCandidate.trim();
  if (!candidate) return;

  const currentMemory = getMemory();
  const existingProfile = (currentMemory.profile || '').trim();

  if (!existingProfile) {
    setMemoryValue('profile', candidate);
    return;
  }

  // 1. もしAIの提案文の中にすでに既存のキーワード（ぽこあポケモン、サウンドディレクター等）が十分残っていれば、そのまま採用
  const hasKeyContext = candidate.includes('サウンドディレクター') || candidate.includes('ぽこあポケモン') || candidate.length >= existingProfile.length * 0.7;

  if (hasKeyContext) {
    setMemoryValue('profile', candidate);
    Logger.log('プロファイルを安全に新陳代謝・更新しました');
  } else {
    // 2. AIが差分だけを出力して既存を全消ししようとした場合：既存プロファイルの後ろに自然に結合（マージ）
    const mergedProfile = `${existingProfile}\n・${candidate.replace(/^[・\-\s]+/, '')}`;
    setMemoryValue('profile', mergedProfile);
    Logger.log('既存プロファイルを保護し、新しい情報を追記結合（マージ）しました');
  }
}

/**
 * 用語辞書の安全な追記・更新（既存定義の消失を防ぎ、重複なくマージ）
 * @param {string} newDictionaryCandidate AIが提案した新しい辞書テキストまたは単一エントリー
 */
function updateDictionarySafely(newDictionaryCandidate) {
  if (!newDictionaryCandidate || typeof newDictionaryCandidate !== 'string') return;
  const candidate = newDictionaryCandidate.trim();
  if (!candidate) return;

  const currentMemory = getMemory();
  const existingDictionary = (currentMemory.dictionary || '').trim();

  if (!existingDictionary) {
    setMemoryValue('dictionary', candidate);
    return;
  }

  // 1行ずつチェックして既存にない用語のみ末尾に結合
  const newLines = candidate.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  let updated = existingDictionary;
  for (let i = 0; i < newLines.length; i++) {
    const line = newLines[i];
    const term = line.split(':')[0].replace(/^[・\-\s]+/, '').trim();
    if (term && !updated.includes(term)) {
      const cleanLine = line.replace(/^[・\-\s]+/, '');
      updated += `\n・${cleanLine}`;
    }
  }

  if (updated !== existingDictionary) {
    setMemoryValue('dictionary', updated);
    Logger.log('用語辞書に新しい前提知識を追記しました');
  }
}

/**
 * 本日のデイリーブリーフィングが配信済みかどうか判定
 * スクリプトプロパティとスプレッドシートmemoryの両方で二重判定し、Date型変換や連投による重複配信を完全遮断
 * @return {boolean}
 */
function isBriefingDeliveredToday() {
  const todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const propDelivered = PropertiesService.getScriptProperties().getProperty('BRIEFING_DELIVERED_DATE');
  if (propDelivered === todayStr) {
    return true;
  }
  const memory = getMemory();
  return memory.briefing_delivered_date === todayStr;
}

/**
 * 本日のデイリーブリーフィング配信完了を記録
 */
function markBriefingDeliveredToday() {
  const todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  PropertiesService.getScriptProperties().setProperty('BRIEFING_DELIVERED_DATE', todayStr);
  setMemoryValue('briefing_delivered_date', todayStr);
}

/**
 * 用語辞書から、指定されたテキスト（ユーザー発言等）に含まれるキーワードに関連するエントリーのみを抽出
 * @param {string} dictionaryText 辞書全体（改行区切り）
 * @param {string} queryText 判定対象のテキスト（ユーザー発言など）
 * @return {string} 関連する辞書エントリー（改行区切り）
 */
function filterRelevantDictionaryEntries(dictionaryText, queryText) {
  if (!dictionaryText || !queryText) return '';
  const lines = dictionaryText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const matched = [];
  const queryLower = queryText.toLowerCase();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    // コロンより前の単語名・別名（例: "ぽこあポケモン（ぽこあ）"）を取り出し、キーワード配列化
    const rawTerm = line.substring(0, colonIndex).replace(/^[・\-\s]+/, '').trim().toLowerCase();
    const keywords = rawTerm.split(/[（\(\)）\/\,\s]+/).filter(k => k.length >= 2);

    // キーワードのいずれか、または単語名そのものが発言に含まれているかチェック
    const isHit = keywords.some(k => queryLower.includes(k)) || (rawTerm.length >= 2 && queryLower.includes(rawTerm));
    if (isHit) {
      matched.push(line);
    }
  }
  return matched.join('\n');
}

/**
 * Geminiへ送信用にスプレッドシートの現在状態を高密度テキスト（トークン最小化）として抽出
 * @param {string=} queryText ユーザー発言等の判定対象テキスト（渡された場合は関連辞書のみオンデマンド抽出）
 * @return {string}
 */
function getSpreadsheetContext(queryText) {
  const now = new Date();
  const nowStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd(E) HH:mm');
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const memory = getMemory();
  const uncompletedTasks = getTasks('未完了');
  const unboughtShopping = getShoppingList('未買');
  const pendingInput = getInputStockList('未');

  let context = `【現在日時】: ${nowStr}\n`;
  context += `【プロファイル】: ${memory.profile || '未設定'}\n`;
  context += `【天気・気温】: ${memory.weather_info || '情報なし'}\n`;
  context += `【気圧急降下】: ${memory.pressure_alert === 'TRUE' ? '急降下中(注意)' : '安定'}\n`;

  // 用語辞書: ユーザー発言だけでなく、プロファイルや直近バッファ（rolling_memory）内の独自用語・作品名を
  // AIが一般的な一般名詞と誤認・混同しないよう、客観的前提知識として常時コンテキストに注入
  if (memory.dictionary && memory.dictionary.trim() !== '') {
    if (memory.dictionary.length < 1500) {
      context += `【用語辞書（客観的前提知識・誤認防止）】:\n${memory.dictionary.trim()}\n`;
    } else {
      const searchTarget = `${queryText || ''}\n${memory.profile || ''}\n${memory.rolling_memory || ''}`;
      const relevantDict = filterRelevantDictionaryEntries(memory.dictionary, searchTarget);
      if (relevantDict) {
        context += `【用語辞書（客観的前提知識・誤認防止）】:\n${relevantDict}\n`;
      }
    }
  }
  if (memory.rolling_memory) {
    context += `【直近活動・関心バッファ】:\n${memory.rolling_memory}\n`;
  }
  if (memory.weekly_summary) {
    context += `【直近サマリー】: ${memory.weekly_summary}\n`;
  }
  if (memory.monthly_report_ready === 'TRUE') {
    context += `【月報通知フラグ】: TRUE\n`;
  }

  // 1. 未完了タスクのみを超圧縮 (完了・破棄は完全除外)
  if (uncompletedTasks.length > 0) {
    const taskLines = uncompletedTasks.map(t => {
      let warningTag = '';
      if (t.createdDate) {
        const parts = t.createdDate.split('-');
        if (parts.length === 3) {
          const cDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
          const diffDays = Math.floor((todayDate.getTime() - cDate.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays >= 7) {
            warningTag = ' [⚠️登録後7日以上経過]';
          }
        }
      }
      return `[${t.id}] ${t.title}${t.dueDate ? ' (期限:' + t.dueDate + ')' : ''}${warningTag}`;
    });
    context += `未完了タスク: ${taskLines.join(' / ')}\n`;
  } else {
    context += `未完了タスク: なし\n`;
  }

  // 2. 買い物リストを1行に圧縮
  if (unboughtShopping.length > 0) {
    const shopItems = unboughtShopping.map(s => s.item);
    context += `買物(未買): ${shopItems.join(', ')}\n`;
  }

  // 3. インプットストックを1行に圧縮
  if (pendingInput.length > 0) {
    const inputItems = pendingInput.map(inp => `[${inp.type}]${inp.title}`);
    context += `インプット未消化: ${inputItems.join(', ')}\n`;
  }

  // ※ routines（ルーティン設定マスタ）は日中会話では不要なため完全除外

  return context.trim();
}

// ==========================================
// FILE: src/Calendar.js
// ==========================================

/**
 * Calendar.js - Googleカレンダーおよび日本の祝日取得モジュール（動的ウィンドウ対応）
 */

/**
 * 曜日と時間帯に応じた動的ウィンドウでカレンダー予定と日本の祝日を取得し、コンテキスト文字列として整形
 * - 日曜 18:00以降: 今日〜翌週日曜 23:59:59 (来週1週間全体)
 * - それ以外 (月〜土、日曜18時前): 今日〜翌週月曜 23:59:59 (今週 + 直近週末 + 週明け月曜)
 * @return {string}
 */
function getCalendarAndHolidayContext() {
  const now = new Date();
  const startTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

  const dayOfWeek = now.getDay(); // 0: 日, 1: 月, 2: 火, 3: 水, 4: 木, 5: 金, 6: 土
  const currentHour = now.getHours();
  let endTime;

  if (dayOfWeek === 0 && currentHour >= 18) {
    // 日曜日の夕方18時以降: 来週1週間全体（翌週の日曜日23:59:59まで = +7日）
    endTime = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 23, 59, 59);
  } else {
    // 通常（月〜土、または日曜18時前）: 直近の翌週月曜日23:59:59まで
    // 月曜(1)なら+7日、火曜(2)なら+6日、...土曜(6)なら+2日、日曜(0)昼なら+1日
    const daysUntilNextMonday = ((8 - dayOfWeek) % 7) || 7;
    endTime = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilNextMonday, 23, 59, 59);
  }

  const startStrLabel = Utilities.formatDate(startTime, 'Asia/Tokyo', 'yyyy-MM-dd(E)');
  const endStrLabel = Utilities.formatDate(endTime, 'Asia/Tokyo', 'yyyy-MM-dd(E)');
  let calendarText = `=== Googleカレンダー予定（期間: ${startStrLabel} 〜 ${endStrLabel}） ===\n`;

  const config = getConfig();

  // 1. デフォルトカレンダー（個人メイン）のイベント取得
  try {
    const defaultCal = CalendarApp.getDefaultCalendar();
    if (defaultCal) {
      const events = defaultCal.getEvents(startTime, endTime);
      if (events.length === 0) {
        calendarText += '・[メインカレンダー] 登録された予定はありません。\n';
      } else {
        events.forEach(ev => {
          const title = ev.getTitle();
          if (ev.isAllDayEvent()) {
            const dateStr = Utilities.formatDate(ev.getStartTime(), 'Asia/Tokyo', 'yyyy-MM-dd(E)');
            calendarText += `・[メイン終日] ${dateStr}: ${title}\n`;
          } else {
            const startStr = Utilities.formatDate(ev.getStartTime(), 'Asia/Tokyo', 'yyyy-MM-dd(E) HH:mm');
            const endStr = Utilities.formatDate(ev.getEndTime(), 'Asia/Tokyo', 'HH:mm');
            calendarText += `・[メイン予定] ${startStr}〜${endStr}: ${title}\n`;
          }
        });
      }
    } else {
      calendarText += '・デフォルトカレンダーを取得できませんでした。\n';
    }
  } catch (e) {
    calendarText += `・メインカレンダー取得エラー: ${e.message}\n`;
  }

  // 2. 家族共用カレンダーのイベント取得（完全読み取り専用・「♪」記号フィルタ付き）
  if (config.familyCalendarId) {
    try {
      const familyCal = CalendarApp.getCalendarById(config.familyCalendarId);
      if (familyCal) {
        const familyEvents = familyCal.getEvents(startTime, endTime);
        // 「♪」が含まれるユーザー自身の予定のみを抽出
        const myFamilyEvents = familyEvents.filter(ev => ev.getTitle().includes('♪'));
        if (myFamilyEvents.length > 0) {
          calendarText += `\n=== 家族共用カレンダー（ユーザー担当分: ♪付きのみ） ===\n`;
          myFamilyEvents.forEach(ev => {
            const title = ev.getTitle();
            if (ev.isAllDayEvent()) {
              const dateStr = Utilities.formatDate(ev.getStartTime(), 'Asia/Tokyo', 'yyyy-MM-dd(E)');
              calendarText += `・[共用終日] ${dateStr}: ${title}\n`;
            } else {
              const startStr = Utilities.formatDate(ev.getStartTime(), 'Asia/Tokyo', 'yyyy-MM-dd(E) HH:mm');
              const endStr = Utilities.formatDate(ev.getEndTime(), 'Asia/Tokyo', 'HH:mm');
              calendarText += `・[共用予定] ${startStr}〜${endStr}: ${title}\n`;
            }
          });
        }
      }
    } catch (fErr) {
      calendarText += `・家族共用カレンダー取得エラー: ${fErr.message}\n`;
    }
  }

  // 3. 日本の祝日カレンダーのイベント取得
  calendarText += `\n=== 日本の祝日情報（期間内） ===\n`;
  try {
    const holidayCal = CalendarApp.getCalendarById(SYSTEM_CONSTANTS.JAPAN_HOLIDAY_CALENDAR_ID);
    if (holidayCal) {
      const holidays = holidayCal.getEvents(startTime, endTime);
      if (holidays.length === 0) {
        calendarText += '・期間中に祝日はありません。\n';
      } else {
        holidays.forEach(h => {
          const dateStr = Utilities.formatDate(h.getStartTime(), 'Asia/Tokyo', 'yyyy-MM-dd(E)');
          calendarText += `・${dateStr}: ${h.getTitle()}\n`;
        });
      }
    } else {
      calendarText += '・祝日カレンダーが見つかりませんでした。\n';
    }
  } catch (e) {
    calendarText += `・祝日カレンダー取得エラー: ${e.message}\n`;
  }

  return calendarText;
}

/**
 * 本日の予定一覧を高密度サマリー配列として取得（デイリーブリーフィング用）
 * メインカレンダー ＋ 家族共用カレンダー（♪付きのみ）
 * @return {Array<string>} 今日の予定文字列一覧
 */
function getTodayEventsList() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const eventStrings = [];
  const config = getConfig();

  // 1. メインカレンダー
  try {
    const defaultCal = CalendarApp.getDefaultCalendar();
    if (defaultCal) {
      const events = defaultCal.getEvents(todayStart, todayEnd);
      events.forEach(ev => {
        const title = ev.getTitle();
        if (ev.isAllDayEvent()) {
          eventStrings.push(`[終日] ${title}`);
        } else {
          const s = Utilities.formatDate(ev.getStartTime(), 'Asia/Tokyo', 'HH:mm');
          const e = Utilities.formatDate(ev.getEndTime(), 'Asia/Tokyo', 'HH:mm');
          eventStrings.push(`${s}〜${e} ${title}`);
        }
      });
    }
  } catch (e) {
    Logger.log('メインカレンダー本日予定取得失敗: ' + e.message);
  }

  // 2. 家族共用カレンダー（♪付きのみ）
  if (config.familyCalendarId) {
    try {
      const familyCal = CalendarApp.getCalendarById(config.familyCalendarId);
      if (familyCal) {
        const fEvents = familyCal.getEvents(todayStart, todayEnd);
        fEvents.filter(ev => ev.getTitle().includes('♪')).forEach(ev => {
          const title = ev.getTitle();
          if (ev.isAllDayEvent()) {
            eventStrings.push(`[共用終日] ${title}`);
          } else {
            const s = Utilities.formatDate(ev.getStartTime(), 'Asia/Tokyo', 'HH:mm');
            const e = Utilities.formatDate(ev.getEndTime(), 'Asia/Tokyo', 'HH:mm');
            eventStrings.push(`[共用] ${s}〜${e} ${title}`);
          }
        });
      }
    } catch (e) {
      Logger.log('家族カレンダー本日予定取得失敗: ' + e.message);
    }
  }

  return eventStrings;
}

/**
 * カレンダー操作アクションを適用（メインカレンダーのみ対象。家族カレンダーは絶対に変更しない）
 * 単発予定（createEvent）および毎週の曜日指定定期予定（createEventSeries）に対応
 * @param {Array<Object>} actions
 * @return {Array<string>} 適用結果メッセージ一覧
 */
function applyCalendarActions(actions) {
  if (!actions || !Array.isArray(actions) || actions.length === 0) return [];
  const defaultCal = CalendarApp.getDefaultCalendar();
  if (!defaultCal) {
    Logger.log('カレンダー操作エラー: デフォルトカレンダーが取得できません');
    return [];
  }

  const weekdayMap = {
    'MON': { enumVal: CalendarApp.Weekday.MONDAY, label: '月' },
    'MONDAY': { enumVal: CalendarApp.Weekday.MONDAY, label: '月' },
    '月': { enumVal: CalendarApp.Weekday.MONDAY, label: '月' },
    'TUE': { enumVal: CalendarApp.Weekday.TUESDAY, label: '火' },
    'TUESDAY': { enumVal: CalendarApp.Weekday.TUESDAY, label: '火' },
    '火': { enumVal: CalendarApp.Weekday.TUESDAY, label: '火' },
    'WED': { enumVal: CalendarApp.Weekday.WEDNESDAY, label: '水' },
    'WEDNESDAY': { enumVal: CalendarApp.Weekday.WEDNESDAY, label: '水' },
    '水': { enumVal: CalendarApp.Weekday.WEDNESDAY, label: '水' },
    'THU': { enumVal: CalendarApp.Weekday.THURSDAY, label: '木' },
    'THURSDAY': { enumVal: CalendarApp.Weekday.THURSDAY, label: '木' },
    '木': { enumVal: CalendarApp.Weekday.THURSDAY, label: '木' },
    'FRI': { enumVal: CalendarApp.Weekday.FRIDAY, label: '金' },
    'FRIDAY': { enumVal: CalendarApp.Weekday.FRIDAY, label: '金' },
    '金': { enumVal: CalendarApp.Weekday.FRIDAY, label: '金' },
    'SAT': { enumVal: CalendarApp.Weekday.SATURDAY, label: '土' },
    'SATURDAY': { enumVal: CalendarApp.Weekday.SATURDAY, label: '土' },
    '土': { enumVal: CalendarApp.Weekday.SATURDAY, label: '土' },
    'SUN': { enumVal: CalendarApp.Weekday.SUNDAY, label: '日' },
    'SUNDAY': { enumVal: CalendarApp.Weekday.SUNDAY, label: '日' },
    '日': { enumVal: CalendarApp.Weekday.SUNDAY, label: '日' }
  };

  const results = [];

  for (let i = 0; i < actions.length; i++) {
    const act = actions[i];
    if (!act || !act.action) continue;

    try {
      if (act.action === 'add' && act.title) {
        // 曜日指定の定期繰り返し設定（recurrence_days）の解析
        let rawDays = [];
        if (Array.isArray(act.recurrence_days)) {
          rawDays = act.recurrence_days;
        } else if (typeof act.recurrence_days === 'string' && act.recurrence_days.trim() !== '') {
          rawDays = act.recurrence_days.split(/[,\s・]+/);
        }

        const weekdayEnums = [];
        const weekdayLabels = [];
        for (let dIdx = 0; dIdx < rawDays.length; dIdx++) {
          const key = String(rawDays[dIdx]).trim().toUpperCase();
          if (weekdayMap[key] && weekdayEnums.indexOf(weekdayMap[key].enumVal) === -1) {
            weekdayEnums.push(weekdayMap[key].enumVal);
            weekdayLabels.push(weekdayMap[key].label);
          }
        }

        if (weekdayEnums.length > 0) {
          // 毎週の定期予定（EventSeries）として登録
          const recurrence = CalendarApp.newRecurrence().addWeeklyRule().onlyOnWeekdays(weekdayEnums);
          const sDate = act.start_time ? new Date(act.start_time) : new Date();

          // 既存の単発重複予定（同タイトル）が直近14日内にあれば事前クリーンアップして二重登録を防止
          const cleanupStart = new Date(sDate.getFullYear(), sDate.getMonth(), sDate.getDate(), 0, 0, 0);
          const cleanupEnd = new Date(sDate.getFullYear(), sDate.getMonth(), sDate.getDate() + 14, 23, 59, 59);
          const existingEvents = defaultCal.getEvents(cleanupStart, cleanupEnd);
          for (let k = 0; k < existingEvents.length; k++) {
            if (existingEvents[k].getTitle() === act.title && !existingEvents[k].isRecurringEvent()) {
              existingEvents[k].deleteEvent();
            }
          }

          if (act.is_all_day) {
            defaultCal.createAllDayEventSeries(act.title, sDate, recurrence);
            results.push(`📅 カレンダー定期追加: ${act.title} (毎週${weekdayLabels.join('・')} / 終日)`);
          } else {
            const eDate = act.end_time ? new Date(act.end_time) : new Date(sDate.getTime() + 60 * 60 * 1000);
            defaultCal.createEventSeries(act.title, sDate, eDate, recurrence);
            const sTimeStr = Utilities.formatDate(sDate, 'Asia/Tokyo', 'HH:mm');
            const eTimeStr = Utilities.formatDate(eDate, 'Asia/Tokyo', 'HH:mm');
            results.push(`📅 カレンダー定期追加: ${act.title} (毎週${weekdayLabels.join('・')} ${sTimeStr}〜${eTimeStr})`);
          }
        } else if (act.is_all_day) {
          const d = act.start_time ? new Date(act.start_time) : new Date();
          defaultCal.createAllDayEvent(act.title, d);
          const dateStr = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
          results.push(`📅 カレンダー終日追加: ${act.title} (${dateStr})`);
        } else {
          const sDate = act.start_time ? new Date(act.start_time) : new Date();
          // end_timeが指定されていない場合は1時間後に設定
          const eDate = act.end_time ? new Date(act.end_time) : new Date(sDate.getTime() + 60 * 60 * 1000);
          defaultCal.createEvent(act.title, sDate, eDate);
          const sStr = Utilities.formatDate(sDate, 'Asia/Tokyo', 'MM/dd HH:mm');
          const eStr = Utilities.formatDate(eDate, 'Asia/Tokyo', 'HH:mm');
          results.push(`📅 カレンダー追加: ${act.title} (${sStr}〜${eStr})`);
        }
      } else if (act.action === 'delete' && act.title) {
        // 指定タイトルの予定を検索して削除
        const targetDate = act.date ? new Date(act.date) : new Date();
        const startDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0);
        const endDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59);
        const events = defaultCal.getEvents(startDay, endDay);
        for (let j = 0; j < events.length; j++) {
          if (events[j].getTitle().includes(act.title)) {
            const evTitle = events[j].getTitle();
            if (act.delete_series && events[j].isRecurringEvent()) {
              events[j].getEventSeries().deleteEventSeries();
              results.push(`📅 カレンダー定期削除: ${evTitle}`);
            } else {
              events[j].deleteEvent();
              results.push(`📅 カレンダー削除: ${evTitle}`);
            }
            break;
          }
        }
      }
    } catch (actErr) {
      Logger.log(`カレンダーアクション実行エラー [${act.title}]: ` + actErr.message);
    }
  }

  return results;
}

// ==========================================
// FILE: src/Weather.js
// ==========================================

/**
 * Weather.js - Open-Meteo API連携モジュール
 * 自宅（横浜市磯子区）および職場（渋谷）の天気予報・気温・降水確率取得と気圧急降下判定
 */

/**
 * WMO Weather interpretation codes (WW) を日本語の天気に変換
 * @param {number} code
 * @return {string}
 */
function interpretWeatherCode(code) {
  if (code === 0) return '快晴';
  if (code === 1) return '概ね晴れ';
  if (code === 2) return '時々曇り';
  if (code === 3) return '曇り';
  if (code === 45 || code === 48) return '霧';
  if (code >= 51 && code <= 55) return '霧雨';
  if (code >= 61 && code <= 65) return '雨';
  if (code >= 66 && code <= 67) return '凍雨';
  if (code >= 71 && code <= 77) return '雪';
  if (code >= 80 && code <= 82) return 'にわか雨';
  if (code >= 85 && code <= 86) return '雪';
  if (code >= 95 && code <= 99) return '雷雨';
  return '不明';
}

/**
 * 単一地点の天気・気温・降水確率および気圧急降下を取得
 * @param {number} latitude
 * @param {number} longitude
 * @param {string} label 地点名
 * @return {Object}
 */
function fetchSingleLocationWeather(latitude, longitude, label) {
  const url = `${SYSTEM_CONSTANTS.OPEN_METEO_BASE}?latitude=${latitude}&longitude=${longitude}&hourly=surface_pressure&daily=weather_code,temperature_2m_max,precipitation_probability_max&timezone=Asia%2FTokyo`;

  let response;
  let statusCode = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
      statusCode = response.getResponseCode();
      if (statusCode === 200) break;
      if (statusCode === 429 && attempt === 0) {
        Utilities.sleep(1500); // 1.5秒待機して再試行
      }
    } catch (netErr) {
      if (attempt === 0) Utilities.sleep(1500);
    }
  }

  try {
    if (!response || response.getResponseCode() !== 200) {
      throw new Error(`HTTP ${statusCode} ${response ? response.getContentText() : 'No response'}`);
    }

    const data = JSON.parse(response.getContentText());

    let desc = '不明';
    let maxTemp = '-';
    let precipProb = 0;

    if (data.daily && data.daily.weather_code && data.daily.weather_code.length > 0) {
      desc = interpretWeatherCode(data.daily.weather_code[0]);
      maxTemp = data.daily.temperature_2m_max ? String(data.daily.temperature_2m_max[0]) : '-';
      precipProb = data.daily.precipitation_probability_max ? Number(data.daily.precipitation_probability_max[0]) : 0;
    }

    // 気圧急降下判定 (6時間以内に5hPa以上の低下)
    let hasDrop = false;
    if (data.hourly && data.hourly.surface_pressure && Array.isArray(data.hourly.surface_pressure)) {
      const pressures = data.hourly.surface_pressure;
      const scanLimit = Math.min(pressures.length, 36);

      for (let i = 0; i < scanLimit; i++) {
        const pCurrent = pressures[i];
        if (typeof pCurrent !== 'number') continue;

        for (let step = 1; step <= 6; step++) {
          if (i + step < pressures.length) {
            const pFuture = pressures[i + step];
            if (typeof pFuture === 'number' && pCurrent - pFuture >= 5.0) {
              hasDrop = true;
              break;
            }
          }
        }
        if (hasDrop) break;
      }
    }

    const umbrellaMark = precipProb >= 40 ? '（傘推奨☔）' : '';
    const summary = `${label}: ${desc} 最高${maxTemp}℃ / 降水確率${precipProb}%${umbrellaMark}`;

    return {
      success: true,
      label: label,
      summary: summary,
      hasDrop: hasDrop,
      precipProb: precipProb,
      maxTemp: maxTemp,
      desc: desc
    };

  } catch (e) {
    Logger.log(`[${label}] 天気取得エラー: ${e.message}`);
    return {
      success: false,
      label: label,
      summary: `${label}: 天気取得エラー`,
      hasDrop: false,
      precipProb: 0,
      maxTemp: '-',
      desc: 'エラー'
    };
  }
}

/**
 * 自宅（横浜市磯子区）および職場（渋谷）の両地点の天気を取得し統合解析
 * @return {Object} { weatherInfo: string, pressureAlert: string, home: Object, work: Object }
 */
function fetchWeatherAndPressure() {
  const config = getConfig();

  const homeResult = fetchSingleLocationWeather(config.home.latitude, config.home.longitude, config.home.name);
  const workResult = fetchSingleLocationWeather(config.work.latitude, config.work.longitude, config.work.name);

  // どちらかの地点で急降下があればアラートTRUE
  const overallPressureAlert = (homeResult.hasDrop || workResult.hasDrop) ? 'TRUE' : 'FALSE';

  // 2地点の天気を結合したサマリー文字列
  const combinedWeatherInfo = `${homeResult.summary} ｜ ${workResult.summary}`;

  return {
    weatherInfo: combinedWeatherInfo,
    pressureAlert: overallPressureAlert,
    home: homeResult,
    work: workResult
  };
}

// ==========================================
// FILE: src/Notion.js
// ==========================================

/**
 * Notion.js - Notion API連携モジュール
 * 日報ページ作成、月報ページ作成、前月日報データクエリ
 */

/**
 * Notion APIリクエスト実行共通関数
 * @param {string} endpoint
 * @param {string} method GET / POST / PATCH
 * @param {Object} payload リクエストボディ
 * @return {Object} レスポンスJSON
 */
function callNotionApi(endpoint, method, payload) {
  const config = getConfig();
  const options = {
    method: method || 'get',
    headers: {
      'Authorization': `Bearer ${config.notionApiKey}`,
      'Notion-Version': SYSTEM_CONSTANTS.NOTION_VERSION,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };

  if (payload && (method === 'post' || method === 'patch')) {
    options.payload = JSON.stringify(payload);
  }

  const response = UrlFetchApp.fetch(`${SYSTEM_CONSTANTS.NOTION_API_BASE}${endpoint}`, options);
  const code = response.getResponseCode();
  const text = response.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error(`Notion APIエラー [${code}] ${endpoint}: ${text}`);
  }

  return JSON.parse(text);
}

/**
 * データベースのプロパティ定義から title型 および date型 のプロパティ名を動的特定
 * @param {string} databaseId
 * @return {Object} { titleKey: string, dateKey: string|null }
 */
function getDatabaseSchemaKeys(databaseId) {
  try {
    const dbInfo = callNotionApi(`/databases/${databaseId}`, 'get');
    let titleKey = 'Name';
    let dateKey = null;

    if (dbInfo && dbInfo.properties) {
      const propKeys = Object.keys(dbInfo.properties);
      for (let i = 0; i < propKeys.length; i++) {
        const k = propKeys[i];
        const prop = dbInfo.properties[k];
        if (prop.type === 'title') {
          titleKey = k;
        } else if (prop.type === 'date' && !dateKey) {
          dateKey = k;
        }
      }
    }
    return { titleKey, dateKey };
  } catch (e) {
    Logger.log(`DBスキーマ取得失敗 (${databaseId}): ${e.message}。デフォルトキーを使用します。`);
    return { titleKey: 'Name', dateKey: 'Date' };
  }
}

/**
 * インラインMarkdown（**太字**など）をNotionのrich_text配列に変換
 * @param {string} text
 * @return {Array<Object>} Notion rich_text array
 */
function parseRichTextWithAnnotations(text) {
  if (!text) return [];
  const richText = [];
  // **太字** パターンを分割抽出
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const normalPart = text.substring(lastIndex, match.index);
      if (normalPart) {
        richText.push({
          type: 'text',
          text: { content: normalPart }
        });
      }
    }
    const boldPart = match[1];
    if (boldPart) {
      richText.push({
        type: 'text',
        text: { content: boldPart },
        annotations: { bold: true }
      });
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    const remaining = text.substring(lastIndex);
    if (remaining) {
      richText.push({
        type: 'text',
        text: { content: remaining }
      });
    }
  }

  if (richText.length === 0) {
    richText.push({
      type: 'text',
      text: { content: text }
    });
  }

  return richText;
}

/**
 * Google Driveの閲覧URL等をNotion埋め込み可能な直接画像URLに変換し、必要に応じて共有権限を付与
 * @param {string} rawUrl
 * @return {string}
 */
function normalizeImageUrlForNotion(rawUrl) {
  if (!rawUrl) return '';
  let url = rawUrl.trim();

  // Google DriveのファイルID抽出（/file/d/<ID>/view または /d/<ID> または id=<ID>）
  const driveIdMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
                       url.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/) ||
                       url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (driveIdMatch && driveIdMatch[1]) {
    const fileId = driveIdMatch[1];
    try {
      const file = DriveApp.getFileById(fileId);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) {
      // 既に共有済みまたは権限外の場合は無視
    }
    return `https://lh3.googleusercontent.com/d/${fileId}`;
  }

  return url;
}

/**
 * MarkdownテキストをNotionブロック配列に変換（太字、区切り線、画像埋め込み対応）
 * @param {string} markdown
 * @return {Array<Object>} Notion blocks
 */
function markdownToNotionBlocks(markdown) {
  if (!markdown) return [];
  const lines = markdown.split('\n');
  const blocks = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line) continue;

    // 1. 区切り線 (---, ***, ___)
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      blocks.push({
        object: 'block',
        type: 'divider',
        divider: {}
      });
      if (blocks.length >= 95) break;
      continue;
    }

    // 2. 画像ブロック (![キャプション](https://...))
    const imgMatch = line.match(/^!\[([^\]]*)\]\((https?:\/\/[^)]+)\)$/);
    if (imgMatch) {
      const captionText = (imgMatch[1] || '').trim();
      const imageUrl = normalizeImageUrlForNotion(imgMatch[2]);
      if (imageUrl) {
        const imageBlock = {
          object: 'block',
          type: 'image',
          image: {
            type: 'external',
            external: { url: imageUrl }
          }
        };
        if (captionText) {
          imageBlock.image.caption = [{ type: 'text', text: { content: captionText } }];
        }
        blocks.push(imageBlock);
        if (blocks.length >= 95) break;
        continue;
      }
    }

    // 2000文字上限ガード
    const safeContent = line.length > 1900 ? line.substring(0, 1900) + '...' : line;

    if (safeContent.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: parseRichTextWithAnnotations(safeContent.replace(/^###\s+/, ''))
        }
      });
    } else if (safeContent.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: parseRichTextWithAnnotations(safeContent.replace(/^##\s+/, ''))
        }
      });
    } else if (safeContent.startsWith('# ')) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: parseRichTextWithAnnotations(safeContent.replace(/^#\s+/, ''))
        }
      });
    } else if (safeContent.startsWith('- ') || safeContent.startsWith('* ')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: parseRichTextWithAnnotations(safeContent.replace(/^[-*]\s+/, ''))
        }
      });
    } else if (/^\d+\.\s+/.test(safeContent)) {
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: parseRichTextWithAnnotations(safeContent.replace(/^\d+\.\s+/, ''))
        }
      });
    } else if (safeContent.startsWith('> ')) {
      blocks.push({
        object: 'block',
        type: 'quote',
        quote: {
          rich_text: parseRichTextWithAnnotations(safeContent.replace(/^>\s+/, ''))
        }
      });
    } else {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: parseRichTextWithAnnotations(safeContent)
        }
      });
    }

    if (blocks.length >= 95) break;
  }

  return blocks;
}

/**
 * 日報をNotion日報データベースに作成
 * @param {string} markdownContent 生成されたMarkdown日報
 * @param {string} dateStr YYYY-MM-DD
 * @return {Object} 作成されたページ情報
 */
function createDailyReport(markdownContent, dateStr) {
  const config = getConfig();
  const schema = getDatabaseSchemaKeys(config.notionDailyDbId);
  const blocks = markdownToNotionBlocks(markdownContent);

  const titleText = `${dateStr} 日報・生活記録`;
  const properties = {};

  properties[schema.titleKey] = {
    title: [{ text: { content: titleText } }]
  };

  if (schema.dateKey) {
    properties[schema.dateKey] = {
      date: { start: dateStr }
    };
  }

  const payload = {
    parent: { database_id: config.notionDailyDbId },
    properties: properties,
    children: blocks
  };

  return callNotionApi('/pages', 'post', payload);
}

/**
 * 前月の日報一覧を取得してテキストとして要約（埋め込み画像URLも保持）
 * @param {string} startDateStr YYYY-MM-DD (前月初日)
 * @param {string} endDateStr YYYY-MM-DD (前月末日)
 * @return {string} 前月日報の集約テキスト
 */
function queryMonthlyReports(startDateStr, endDateStr) {
  const config = getConfig();
  const schema = getDatabaseSchemaKeys(config.notionDailyDbId);

  const queryPayload = {
    page_size: 50
  };

  if (schema.dateKey) {
    queryPayload.filter = {
      and: [
        {
          property: schema.dateKey,
          date: { on_or_after: startDateStr }
        },
        {
          property: schema.dateKey,
          date: { on_or_before: endDateStr }
        }
      ]
    };
  }

  let aggregatedText = '';

  try {
    const result = callNotionApi(`/databases/${config.notionDailyDbId}/query`, 'post', queryPayload);
    const pages = result.results || [];

    if (pages.length === 0) {
      return '（前月の日報データは見つかりませんでした）';
    }

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      let pageTitle = '無題';
      const titleProp = page.properties[schema.titleKey];
      if (titleProp && titleProp.title && titleProp.title.length > 0) {
        pageTitle = titleProp.title.map(t => t.plain_text).join('');
      }

      aggregatedText += `\n=== [${pageTitle}] ===\n`;

      try {
        const blocksData = callNotionApi(`/blocks/${page.id}/children?page_size=50`, 'get');
        const childBlocks = blocksData.results || [];
        childBlocks.forEach(b => {
          const type = b.type;
          if (type === 'image' && b.image) {
            const imgUrl = (b.image.external && b.image.external.url)
              ? b.image.external.url
              : (b.image.file && b.image.file.url ? b.image.file.url : '');
            const caption = (b.image.caption && b.image.caption.length > 0)
              ? b.image.caption.map(c => c.plain_text).join('')
              : '思い出の写真';
            if (imgUrl) {
              aggregatedText += `![${caption}](${imgUrl})\n`;
            }
          } else if (b[type] && b[type].rich_text) {
            const blockText = b[type].rich_text.map(rt => rt.plain_text).join('');
            if (blockText) {
              aggregatedText += `${blockText}\n`;
            }
          }
        });
      } catch (blockErr) {
        Logger.log(`ブロック取得スキップ: ${blockErr.message}`);
      }
    }
  } catch (e) {
    Logger.log(`前月日報クエリエラー: ${e.message}`);
    aggregatedText = '（日報クエリ中にエラーが発生しました）';
  }

  return aggregatedText;
}

/**
 * 月報カードをNotion月報データベースに作成
 * @param {string} markdownContent 生成されたMarkdown月報
 * @param {string} monthStr YYYY-MM
 * @return {Object} 作成されたページ情報
 */
function createMonthlyReport(markdownContent, monthStr) {
  const config = getConfig();
  const schema = getDatabaseSchemaKeys(config.notionMonthlyDbId);
  const blocks = markdownToNotionBlocks(markdownContent);

  const titleText = `${monthStr} 月間ハイライト＆思い出ジャーナル`;
  const properties = {};

  properties[schema.titleKey] = {
    title: [{ text: { content: titleText } }]
  };

  if (schema.dateKey) {
    properties[schema.dateKey] = {
      date: { start: `${monthStr}-01` }
    };
  }

  const payload = {
    parent: { database_id: config.notionMonthlyDbId },
    properties: properties,
    children: blocks
  };

  return callNotionApi('/pages', 'post', payload);
}

/**
 * 開発・動作確認用: Notion日報データベースへのテスト投稿
 * GASエディタでこの関数を選択して実行すると、ダミーの日報ページをNotionに即時作成します。
 */
function testDailyReportNotion() {
  const config = getConfig();
  Logger.log('Notion API Key 確認: ' + (config.notionApiKey ? config.notionApiKey.substring(0, 8) + '...' : '未設定'));
  Logger.log('日報DB ID 確認: ' + config.notionDailyDbId);

  const testDateStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const dummyMarkdown = `# ${testDateStr} デイリージャーナル（動作テスト）
## 今日のハイライト・総括
- 生活管理秘書システムの初期セットアップが完了しました！
- LINEとの双方向連携およびGemini 3.8 Flashによる思考エンジンが正常に稼働しています。

## 完了タスク
- [x] LINE Bot チャンネル作成 & Webhook設定
- [x] GASプロジェクト作成 & スクリプトプロパティ設定
- [x] Notion API連携テスト

## 秘書からのひとこと
セットアップ大変お疲れ様でした！明日からの毎日の制作・生活管理をしっかり伴走させていただきます。`;

  try {
    const res = createDailyReport(dummyMarkdown, testDateStr);
    Logger.log('✅ Notion日報DBへの作成に成功しました！');
    Logger.log('作成ページURL: ' + (res.url || 'Notion側で確認してください'));
  } catch (err) {
    Logger.log('❌ Notion日報DBへの作成に失敗しました: ' + err.message);
  }
}

// ==========================================
// FILE: src/Gemini.js
// ==========================================

/**
 * Gemini.js - Gemini 3.8 Flash API連携モジュール
 * 低レイテンシ（thinkingBudget: 0）、Web検索グラウンディング、JSONスキーマ、マルチターン会話対応
 */

/**
 * 生活秘書システムの基本システムプロンプトを取得
 * @param {boolean} isFirstHello 本日最初の発言（ブリーフィング合流が必要）か
 * @return {string}
 */
function getSystemPrompt(isFirstHello) {
  const memory = getMemory();
  const basePrompt = `あなたは、ユーザー（サウンドディレクター）のために構築された完全個人専用の『生活伴走システム』の対話エージェント（生活管理秘書兼伴走者）です。
ユーザーの日々の生活・健康・仕事・インプット活動を誰よりも親身かつ客観的にサポートします。

【システム自己定義】
ユーザーが「このシステム」「生活伴走システム」「秘書」と言った場合、それはあなた自身および背後で稼働しているGAS、スプレッドシート、Notion日報、Googleカレンダー、天気連携などのデータ基盤全体を指しています。
自身の仕組み（タスク管理、買い物リスト、インプット管理、天気・気圧急降下検知、深夜Notion日報、記憶の3層管理、Googleカレンダー連携など）を熟知した上で、ユーザーの質問や相談に答えてください。

【最重要ミッション: 無理なく健康的で文化的な生活の推奨】
ユーザーが心身ともに健やかに、かつ創造的に暮らせるよう、以下の生活哲学を最優先の行動指針として伴走してください：
1. 早寝早起きのリズム（23:00就寝・07:00起床目安）:
   - 夜更かしや遅起きの習慣化を防ぎ、体内時計のリズムを整えることを強く推奨します。
   - 【仕事からの逆算思考の撤廃】: 「始業が10:00だから8:30起きでOK、だから深夜0:30就寝で足りる」といった、仕事開始時間から逆算した遅寝・遅起きの提案は絶対にしないでください。
   - 始業前に2〜3時間のゆとり（朝食、軽運動、文化的インプット、身支度）を持てる「7:00起き」を健康の標準とし、それに合わせて「23:00就寝（7〜8時間睡眠）」を生活の軸としてサポートしてください。
   - 【朝のゆとり時間の積極活用（惰性の助長禁止）】: 起床後や始業前の時間帯に「10時始業までまだ時間があるからのんびり座って待っていましょう」「無理に動かずゆっくりしましょう」と惰性やダラダラを助長する発言は禁止です。眠気やだるさには共感しつつも、せっかく確保した朝の時間を「カーテンを開けて光を浴びる」「軽い肩甲骨ストレッチ」「やりたかった趣味（『ぽこあポケモン』等）を時間を決めて楽しむ」「身支度」などに有意義に使えるよう、爽やかに背中を押してください。
2. 運動不足の防止と身体ケア（デスクワーク対策）:
   - サウンドディレクターとしての長時間の座り作業・耳の酷使を考慮し、こまめな肩甲骨・首・股関節のストレッチ、水分補給、無音でのイヤーケアを適切なタイミングで促してください。
3. 文化的インプット（音楽・ゲーム・作品・創作活動）の尊重:
   - ゲームや音楽鑑賞、映画、創作活動はユーザーにとって大切な「文化的生活」の一部であり、単なる時間の浪費ではありません。頭ごなしに制限するのではなく、メリハリをつけて楽しめるよう時間管理やクールダウンを伴走してください。

【トーン＆マナー】
- 理屈っぽくならず、小難しい理屈や詩的な比喩表現は一切使わないでください。
- 簡潔で親身な口調（メイン返答は2〜3文程度）。
- 敬体（です・ます調）をベースとしつつ、頼れる秘書のような柔らかく落ち着いた雰囲気。

【行動提案の5大思考規範（※最重要）】
1. 直近性（即時着手性）の原則:
   - 行動提案は常に「今この瞬間〜直近数分以内」にユーザー自身が着手できる事柄に限定してください。
   - まだ状況が到達していない未来のフェーズ（移動中の帰宅後アクション、暇宣言直後の午後予定など）を先走って予約・提案してはいけません。現在時刻と次の予定から逆算し、今動くべきことだけを扱ってください。
2. 行動宣言に対する「見送りファースト」（余計な割り込み・オウム返し提案の禁止）:
   - ユーザーが「お風呂入る」「さっさと風呂入らないと」「もう寝る」「作業始める」などの行動宣言をした場合、余計なタスク提案や「〜しますか？」というオウム返しを挟まず、まず快く送り出してください（「温まってきてくださいね」「おやすみなさい」「集中していきましょう」等）。
   - 行動に移ろうとしているユーザーの腰を折るような割り込み提案は厳禁です。
3. タイミングの妥当性とクールダウン（夜間の提案制限）:
   - 21:30以降は、ゲーム周回（モンスト等）や高難易度タスク、激しい運動など脳や身体を興奮させるアクションの提案は厳禁です。
   - 23:00の就寝に向け、夜はぬるめの入浴、ストレッチ、穏やかな音楽、明日の準備など、自然なクールダウンと就寝準備へ誘導してください。
4. 生活順序（物理的タイムライン）の論理的遵守:
   - 人間の身体動作や生活導線に反する提案をしないでください（例: お風呂に入る直前に洗濯機を回すよう促すなど、まだ脱いでいない服を洗わせるようなチグハグな提案は禁止）。
5. 同一提案のしつこさ排除（1日最大1回・タイミング重視）:
   - 当日の会話ログで一度提案したタスクやアクションは、ユーザーがそれに反応するかその状況に到達するまで、絶対に再提案しないでください（直前のターンで「お茶を飲んでゆっくり」と言った直後にまた同じことを言うような反復も厳禁です）。

【状況・コンテキスト適応型アテンド】
- 出社中・勤務時間中:
  * 業務の邪魔になるプライベートな話題は控えめにし、必要に応じて「今日は何時ごろ退勤の予定ですか？」など、その後のスケジュールを先回りして気遣う質問を自然に投げかける。
- 移動中（電車・歩行など）:
  * 歩行中は安全第一。電車内なら音楽を聴いて目を休めるなど、スキマ時間に合わせた自然な過ごし方を考慮する。
- 帰宅後・夕方〜夜（21:30まで）:
  * 仕事モードから解放し、ゲームや温浴、ストレッチなど、オフの時間をゆったり提案。
- 夜間（21:30以降）:
  * 就寝準備・クールダウンモード。興奮するタスクは避け、早めの就寝をサポート。
- 体調不良の継続的フォロー（経過観察モード）:
  * 本日のログに腹痛・頭痛・下痢などの不調があった場合、その後の会話の冒頭で「そういえば、お腹の痛みはその後少し落ち着きましたか？」などと自然に経過を気遣う。

【Googleカレンダー連携】
- コンテキストには、ユーザー自身のメインカレンダーおよび家族共用カレンダー（ユーザー担当の「♪」付き予定のみ抽出）の予定が含まれています。
- 家族共用カレンダーは安全のため【完全読み取り専用】です。
- ユーザーからカレンダー予定の追加・変更・削除を頼まれた場合、メインカレンダーに対して実行するアクションを calendar_actions に出力してください（ユーザーからの依頼をスルーすることは厳禁です）。会話本文（reply_text）では親身な相槌や了解の旨を自然に返答してください。
- 「毎週月・木・金」のような毎週の曜日繰り返し予定を依頼された場合は、calendar_actions の \`recurrence_days\` に \`["MON", "THU", "FRI"]\` のように曜日コード配列を指定してください（単発予定の場合は空配列 \`[]\` にすること）。

【独自用語・作品名の厳密な定義遵守（誤認・勝手な省略の禁止）】
- コンテキストの【用語辞書】に登録されている用語・作品（例: 『ぽこあポケモン』『残響フラクタル』『ぱずぎり』等）は、辞書に記載された定義・プラットフォーム・発売状況・属性を必ず厳守してください。
- 世間一般の一般名詞や別作品（例: スマホのポケポケ、一般的なポケモン等）と混同してはなりません。また、「ぽこあポケモン」を勝手に「ポケモン」と省略・変形して呼ぶなど、作品の性質を取り違えた不自然な提案は厳禁です。

【デイリーブリーフィングに関する絶対禁止ルール】
- 【厳格禁止】返信文内（reply_text）に「☀️ 本日のデイリーブリーフィング」や枠線（━━━━━━━━━━━━━━）を出力してはなりません。
- 朝ブリーフィングは背後のシステムプログラムが自動で組み立てて付加するため、AI側でブリーフィングを生成すると二重表示になってしまいます。あなたは純粋にユーザーへの親身な返信文（2〜3文程度）のみを出力してください。

【発言別スタンス】
1. 作業宣言（「〜しようかな」「作業始める」等）: 肯定 ＋ 目安時間や取り組む順序のアドバイス。
2. 完了報告（「〜終わった」「帰宅した」等）: 労い ＋ 胃腸や身体のケア、または「夕飯前に少し息抜きしますか？」等の習慣・休息の提案。
3. 外出・退勤報告（「出かける」「退勤した」「駅に着いた」等）: 傘リマインド ＋ 帰り道に買えそうな未買リストがあれば1行添える。「〇〇買ってきた」「〇〇買えた」等の発言があれば買い物リストから自動で購入済みにする。
4. 息抜き（「ゲームしたい」「休憩する」等）: 全肯定 ＋ 時間を区切る枠組みの提案（「〜分タイマーかけますか？」等）。ユーザーが現在プレイ可能な好みのゲームや趣味に寄り添う（※21:30以降は就寝を考慮した提案にする）。
5. 不調（「頭痛」「集中できない」「お腹痛い」等）: 気圧や飲食歴を踏まえた客観的フォロー＆温めや消化ケアの具体的提案。
6. 相談（「次何する？」「時間空いた」等）: カレンダー空き時間、未完了タスク、インプット候補、あるいはユーザーの好きな趣味・息抜きから具体提案。
7. 好み・趣味・近況の共有（「〜にハマってる」「〜が良い」等）:
   - 【タスク化禁止】「タスクに追加して」と明示されない限りタスクやルーティンには追加しないこと。
   - 【日中チャットでのmemory_updates出力節約】:
     * プロファイルや活動履歴の統合・新陳代謝は深夜3時の日次バッチが自動で行うため、日中の通常会話では \`memory_updates\` を出力しないでください（キーごと省略）。
     * 例外として、ユーザーが明示的に「辞書に登録して」「プロファイルに覚えておいて」と指示した場合、または未知の独自用語の意味を説明した場合のみ \`memory_updates\`（\`dictionary\` または \`profile\`）を出力してください。
8. 質問・調べ物（「〇〇のイベントいつまで？」「〇〇のチケット発売日いつ？」「〇〇の仕様教えて」等）:
   - 最新・正確な期日や事実を取得して回答してください。
   - 【タスク化の絶対ルール】この質問への返答ターンでは、自動でタスク追加（task_actionsのadd）は絶対に行わないでください（task_actionsは省略すること）。
   - 具体的な終了日・発売日・締切が存在する場合は、回答の末尾に「タスクに追加しておきましょうか？」と軽く確認を1文添えるにとどめてください。
   - ユーザーが次のターンで「追加して」「お願い」「はい」等と同意・肯定した場合に初めて、期限付きタスク（due_dateを指定）として登録してください。

【運動・ケア提案の定義】
- レベル1（1分）: 肩甲骨ほぐし、巻き肩リセット、首ストレッチ、かかと上げ。
- レベル2（3〜5分）: スクワット（15回程度）、プランク（30〜60秒）、股関節ストレッチ、ラジオ体操。
- レベル3（15〜30分）: 散歩、室内自重トレーニング。

【サウンドディレクター向け専門提案】
- 受動的: 映画・新譜・サントラ（input_stockの未消化作品を参照）。
- 能動的: ギター等の楽器練習・運指、音作り研究、DAWスケッチ。
- 自発的: 環境音観察、無音でのイヤーケア（耳の休息）、スタジオ機材チェック。

【人間生活・オフの提案】
- 週末や祝日の空き時間に対して、友人との交流や外出を提案（疲労蓄積サマリーがある場合は完全休養を提案）。

【3大ガードレール】
1. 1日1回・1テーマの原則: 直近の会話ログを参照し、同日内に同じ運動やインプットを何度も重複提案しない。
2. キャパシティ考慮: 疲労や多忙時はタスクを増やさず、引き算の提案をする。
3. メイン返答＋1行添えの構成: メインの会話は2〜3文で簡潔にまとめ、運動や買い物・アクション提案などは末尾に1行だけ添える。

【タスク登録時の命名原則（文脈プレフィックス付与 ＆ 締切時刻の明記）】
- タスク一覧を見たときに「何の話・どのプロジェクトか」「いつまでか」が一目でわかるよう、必ず会話の文脈から【対象・プロジェクト名・領域】をプレフィックスとして冠した自己完結するタイトルにしてください。
- 形式: 「対象/プロジェクト：具体的なタスク内容（※時間指定がある場合は末尾に付与）」
  * 例: 「このシステムの重複表示防止実装したい」 → 「生活伴走システム：デイリーブリーフィング重複表示防止機能実装」
  * 例: 「明日12時までに未開の大地やらなきゃ」 → 「モンスト：未開の大地クリア（〜12:00まで）」
  * 例: 「今日の夕方18時までにBGMのミックス見直す」 → 「〇〇案件：BGMミックス調整（〜18:00まで）」
  * 例: 「第3章のプロット書く」 → 「残響フラクタル：第3章プロット執筆」
  * 例: 「シーツ洗う」 → 「家事：シーツ洗濯」
- 【締切時刻のタイトル明記ルール】: 「〇時までに」「午前中（12時まで）に」「18時締切」など、時間まで決まっているタスクの場合は、必ずタスクタイトルの末尾に \`（〜HH:mmまで）\` や \`（HH:mm締切）\` と時刻を付与して命名してください（期限列は日付のみ管理のため）。
- 「この機能」「あれを直す」のような指示語・代名詞はそのまま使わず、文脈から対象を具体的に補ってください。

【放置タスクの棚卸しルール】
- 未完了タスク一覧の中に「[⚠️登録後7日以上経過]」のタグが付いているものがある場合、夜間や作業の区切りなど落ち着いたタイミングで「このタスクはまだ残しておきますか？不要なら整理しましょうか」と1件だけ確認を促してください。

【月報通知の特別指示】
- コンテキスト内の「月報通知フラグ」が「TRUE」の場合、返答の最末尾に必ず次の1文を添えてください：
  「先月の振り返りまとめをNotionにまとめておきました！」`;

  let prompt = basePrompt;

  // スプレッドシートの custom_system_prompt がある場合は基本プロンプトを上書きせず末尾に追加指示として結合
  if (memory.custom_system_prompt && memory.custom_system_prompt.trim() !== '') {
    prompt += `\n\n【追加カスタム指示（最優先フォーマット・ルール）】\n${memory.custom_system_prompt.trim()}`;
  }

  prompt += `\n\n【出力形式（★トークン節約のためのキー省略ルール）】
必ず純粋なJSON文字列のみを出力してください（余計な解説文やMarkdownコードブロックは含めないこと）。
- **必須キーは \`"reply_text"\` のみ**です。
- **\`"reply_text"\` 以外のすべてのキー（\`image_summary\`, \`task_actions\`, \`calendar_actions\`, \`shopping_actions\`, \`input_stock_actions\`, \`routine_actions\`, \`memory_updates\`）は、実際に実行・記録すべき値が存在する時だけJSONに含めてください。**
- 空文字 \`""\`、空配列 \`[]\`、\`null\` になるキーは**一切出力せず、キーごと省略**してください（通常の雑談・相談ターンでは \`{"reply_text": "..."}\` の1キーのみで出力完了とすること）。

{
  "reply_text": "【必須】ユーザーへの返信文（親身な労い・回答など2〜3文 ＋ 直近の状況に応じたアクション提案や気遣い1行。※ブリーフィング枠は出力厳禁）",
  "image_summary": "（※画像添付時のみ出力）画像の客観的な内容要約",
  "task_actions": [
    { "action": "add", "title": "対象/プロジェクト：具体的なタスク内容", "due_date": "YYYY-MM-DD" },
    { "action": "complete", "task_id": "T_...", "title": "完了する既存タスク名" },
    { "action": "delete", "task_id": "T_...", "title": "破棄するタスク名" }
  ],
  "calendar_actions": [
    { "action": "add", "title": "予定タイトル", "start_time": "YYYY-MM-DDTHH:mm:ss", "end_time": "YYYY-MM-DDTHH:mm:ss", "is_all_day": false, "recurrence_days": [] },
    { "action": "delete", "title": "予定タイトル", "date": "YYYY-MM-DD", "delete_series": false }
  ],
  "shopping_actions": [
    { "action": "add", "item": "品名", "category": "カテゴリ" },
    { "action": "complete", "item": "品名" }
  ],
  "input_stock_actions": [
    { "action": "add", "type": "映画/音楽/本", "title": "タイトル", "memo": "メモ" },
    { "action": "complete", "title": "タイトル" }
  ],
  "routine_actions": [
    { "action": "add", "title": "ルール名", "type": "day_of_week/day_of_month/interval_days", "value": "設定値" }
  ],
  "memory_updates": {
    "dictionary": "（※新出用語の説明があった時のみ出力）単語名: 客観的な定義",
    "profile": "（※明示的にプロファイル変更を指示された時のみ出力）更新後のプロファイル全文"
  }
}`;

  return prompt;
}

/**
 * Gemini 3.8 Flash APIへ低レイテンシ・グラウンディング呼び出しを実行（マルチターン対応）
 * @param {string} userText ユーザーの入力テキスト
 * @param {Array<GoogleAppsScript.Base.Blob>} imageBlobs 添付画像Blob一覧
 * @param {string} contextText スプレッドシートやカレンダー等のコンテキスト情報
 * @param {Array<Object>} recentTurns 直近の会話ログターン配列
 * @param {boolean} isFirstHello 本日初回の発言か
 * @return {Object} 解析されたJSONオブジェクト
 */
function callGeminiFlash(userText, imageBlobs, contextText, recentTurns, isFirstHello) {
  const config = getConfig();
  const url = `${SYSTEM_CONSTANTS.GEMINI_ENDPOINT_BASE}?key=${config.geminiApiKey}`;

  // 1. マルチターン履歴の構築
  const contents = [];
  if (recentTurns && Array.isArray(recentTurns) && recentTurns.length > 0) {
    for (let i = 0; i < recentTurns.length; i++) {
      contents.push(recentTurns[i]);
    }
  }

  // 2. 最新のユーザー発言ターンの構築 (画像 parts + コンテキスト/プロンプト parts)
  const currentTurnParts = [];

  // 画像入力の追加
  if (imageBlobs && Array.isArray(imageBlobs)) {
    for (let i = 0; i < imageBlobs.length; i++) {
      const blob = imageBlobs[i];
      if (blob) {
        const mimeType = blob.getContentType() || 'image/jpeg';
        const base64Data = Utilities.base64Encode(blob.getBytes());
        currentTurnParts.push({
          inlineData: {
            mimeType: mimeType,
            data: base64Data
          }
        });
      }
    }
  }

  // 最新のテキスト
  let promptBody = `${contextText}\n\n`;
  if (recentTurns && typeof recentTurns === 'string' && recentTurns.trim() !== '') {
    promptBody += `=== 本日の会話履歴 (時系列) ===\n${recentTurns}\n\n`;
  }
  promptBody += `=== ユーザーの最新発言 ===\n${userText || '（画像を受信しました。内容を確認してください）'}`;
  currentTurnParts.push({ text: promptBody });

  contents.push({
    role: 'user',
    parts: currentTurnParts
  });

  const requestPayload = {
    systemInstruction: {
      parts: [{ text: getSystemPrompt(isFirstHello) }]
    },
    contents: contents,
    generationConfig: {
      temperature: 0.7,
      thinkingConfig: {
        thinkingBudget: 0
      }
    },
    tools: [
      {
        googleSearch: {}
      }
    ]
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestPayload),
    muteHttpExceptions: true
  };

  let response;
  let statusCode = 0;
  let responseText = '';
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      response = UrlFetchApp.fetch(url, options);
      statusCode = response.getResponseCode();
      responseText = response.getContentText();

      if (statusCode >= 200 && statusCode < 300) {
        break; // 成功
      }

      // 503 (一時混雑) や 429 等のリトライ可能な一時エラー
      if ((statusCode === 503 || statusCode === 429 || statusCode >= 500) && attempt < maxRetries) {
        const delayMs = (attempt + 1) * 1200; // 1.2秒, 2.4秒 待機
        Logger.log(`[Gemini API リトライ] ステータス ${statusCode} のため ${delayMs}ms 後に再試行します (試行 ${attempt + 1}/${maxRetries})`);
        Utilities.sleep(delayMs);
        continue;
      }

      throw new Error(`Gemini APIエラー [${statusCode}]: ${responseText}`);
    } catch (err) {
      if (attempt >= maxRetries) {
        throw err;
      }
      const delayMs = (attempt + 1) * 1200;
      Logger.log(`[Gemini API ネットワークエラー] ${err.message} のため ${delayMs}ms 後に再試行します`);
      Utilities.sleep(delayMs);
    }
  }

  const jsonResponse = JSON.parse(responseText);

  // 全パートからテキストを安全に連結抽出（思考パートの混入を防ぐ）
  let contentText = '';
  if (jsonResponse.candidates && jsonResponse.candidates.length > 0 && jsonResponse.candidates[0].content && jsonResponse.candidates[0].content.parts) {
    const parts = jsonResponse.candidates[0].content.parts;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].text && !parts[i].thought) {
        contentText += parts[i].text;
      }
    }
  }

  if (!contentText) {
    throw new Error('Gemini APIからテキスト返答が得られませんでした。');
  }

  // Markdownコードフェンス (```json ... ```) を除去してパース
  let cleaned = contentText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    Logger.log('JSONパース失敗: ' + cleaned);
    return {
      reply_text: cleaned,
      system_notification: '',
      task_actions: [],
      calendar_actions: [],
      shopping_actions: [],
      input_stock_actions: [],
      routine_actions: []
    };
  }
}

/**
 * 深夜バッチ用: 1日のログと完了タスクからNotion投稿用Markdown日報を生成
 * @param {Array<Object>} logs
 * @param {Array<Object>} completedTasks
 * @param {Object} memory
 * @param {string} dateStr
 * @return {string} Markdown日報
 */
function generateDailyReportMarkdown(logs, completedTasks, memory, dateStr) {
  const config = getConfig();
  const url = `${SYSTEM_CONSTANTS.GEMINI_ENDPOINT_BASE}?key=${config.geminiApiKey}`;

  let logsSummary = logs.map(l => {
    const imgInfo = (l.imageUrl && String(l.imageUrl).trim() !== '')
      ? `\n  [投稿画像URL: ${String(l.imageUrl).trim().replace(/\n/g, ', ')}]`
      : '';
    return `[${l.timestamp}] ${l.sender}: ${l.message}${imgInfo} (AI: ${l.aiReply})`;
  }).join('\n');
  let tasksSummary = completedTasks.map(t => `- [ID:${t.id}] ${t.title} (${t.memo || ''})`).join('\n');

  const prompt = `あなたは生活秘書です。本日（${dateStr}）の会話ログおよび完了タスクに基づき、ユーザーが後から自分の1日を楽しく具体的に振り返るためのNotion日報（Markdown形式）を作成してください。

【本日の会話ログ】
${logsSummary || 'ログなし'}

【本日完了したタスク】
${tasksSummary || '完了タスクなし'}

【現在の体調・環境コンテキスト】
- 天気・気温: ${memory.weather_info}
- 気圧アラート: ${memory.pressure_alert}
- 直近サマリー: ${memory.weekly_summary}

【日報作成の4大ルール（※厳守）】
1. ユーザー自身の体験・出来事・考えごとの記録に特化（AIへのダメ出し・仕様指摘は除外）:
   - 日報は「ユーザーがその日何を体験し、何を感じ、何を考えたか」を振り返るためのジャーナルです。
   - ユーザーがAI（秘書システム）の振る舞い・プロンプト・仕様に対して行った指摘・修正指示・ダメ出し（例: 「仕事から逆算するのではなく早寝早起きを推奨してほしい」「ブリーフィングが重複している」等のAI指導）を、「ユーザー自身が今日気づきを得た・原点に立ち返った」かのように美談化して振り返りに含めることは厳禁です。AIの仕様改善に関するやり取りは、もし触れるとしても「生活伴走システムの調整を行った」程度の客観的事実にとどめてください。
2. エピソードの具体性維持（過度な抽象化・意味不明な造語への要約禁止）:
   - 出来事や面白いハプニング、ゲームのガチャ結果、作品の感想などは、数ヶ月〜数年後に読み返しても「何が起きたのか」が具体的に思い出せるように書いてください。
   - ❌ 悪い例（要約しすぎ）: 「アプリ『ぱずぎり』のアプデ導線トラップにクスッと笑いつつガチャ挑戦（今剣は出ず）」
   - ⭕ 良い例（具体性が残る記述）: 「『刀剣乱舞 ぱずぎり』でアップデートボタンを押したところ、ぱずぎりではなく『刀剣乱舞』本家のストアページに飛ばされるというまさかの導線ミスに遭遇しつつ、ガチャでは今剣を狙うも今回はお預け」
3. 写真の選別と埋め込み（任意・特筆すべき画像のみ）:
   - ログ内に \`[投稿画像URL: https://...]\` が含まれており、その中に「食事・料理の写真」「お出かけ先の風景」「購入したアイテム・ジャケット写真」「記念になるスクリーンショット」など、日記の思い出として残す価値がある画像があれば、該当する話題の直下に **独立した1行** として \`![写真の簡潔なキャプション](画像URL)\` の形式で埋め込んでください。
   - 単なるシステム確認用のスクショなど、振り返りに不要な画像は埋め込まなくて構いません（毎回必ず埋め込む必要はありません）。
4. 「明日への引き継ぎメモ」は出力しない:
   - この日報は月末に月報として振り返るためのアーカイブであり、翌日のAIコンテキストには読み込まれないため、「明日への引き継ぎメモ」セクションは作らないでください。

【日報フォーマット要件】
- # ${dateStr} デイリージャーナル & サマリー
- ## 今日のハイライト・総括（2〜3行の親身で自然なまとめ）
- ## 達成したこと・完了タスク
- ## 主な出来事・活動の流れ（具体的なエピソードやユーザーの考えごと。必要に応じて \`![キャプション](URL)\` で写真を挿入）
- ## 体調・ケア・気づき
※見出し、箇条書き（\`- \`）、太字（\`**強調**\`）、区切り線（独立行の \`---\`）を活用して見やすく記述してください。`;

  const requestPayload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestPayload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const statusCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`日報生成用Gemini APIエラー [${statusCode}]: ${responseText}`);
  }

  const resJson = JSON.parse(responseText);
  if (resJson.candidates && resJson.candidates.length > 0 && resJson.candidates[0].content && resJson.candidates[0].content.parts) {
    const text = resJson.candidates[0].content.parts.map(p => p.text || '').join('').trim();
    if (text) {
      return text;
    }
  }
  throw new Error('日報生成用Gemini APIから本文が取得できませんでした。');
}

/**
 * 深夜バッチ用: 当日ログから中長期記憶（直近活動バッファ、周期イベント、生活サマリー、プロファイル代謝、用語辞書）を更新
 * @param {Array<Object>} logs
 * @param {string} currentCycleStamps
 * @param {string} currentWeeklySummary
 * @param {string} currentRollingMemory
 * @param {string} currentProfile
 * @param {string} currentDictionary
 * @param {string} targetDateStr
 * @return {Object} { cycle_stamps: string, weekly_summary: string, rolling_memory: string, profile: string, dictionary: string }
 */
function analyzeMemoryUpdates(logs, currentCycleStamps, currentWeeklySummary, currentRollingMemory, currentProfile, currentDictionary, targetDateStr) {
  const config = getConfig();
  const url = `${SYSTEM_CONSTANTS.GEMINI_ENDPOINT_BASE}?key=${config.geminiApiKey}`;

  let logsSummary = logs.map(l => `${l.sender}: ${l.message}`).join('\n');

  const prompt = `あなたは生活秘書です。本日（${targetDateStr}）の会話ログを分析し、中長期記憶（直近活動バッファ、周期イベント、生活サマリー、プロファイル代謝、用語辞書）を更新してください。

【既存の直近活動バッファ (rolling_memory: 最大10日分)】
${currentRollingMemory || 'なし'}

【既存のプロファイル】
${currentProfile || '未設定'}

【既存の用語辞書・前提知識】
${currentDictionary || 'なし'}

【既存の周期イベント記録】
${currentCycleStamps || 'なし'}

【既存の直近サマリー】
${currentWeeklySummary || 'なし'}

【本日の会話ログ】
${logsSummary || 'ログなし'}

【更新ルール】
1. rolling_memory（超重要・活動関心バッファ）:
   - 本日の日付（${targetDateStr}）で、本日の活動・出来事・関心を漏らさず記録してください。
   - 【記録すべき2大要素】:
     ① 生活・体調・食事・買い物・生活タスク（睡眠や体調の波、購入品、翌日予定など）
     ② 触れたエンタメ・作品・音楽・ゲーム・趣味（作品名・アーティスト名・ゲームタイトル等の固有名詞、ゲームタスク、プレイや視聴時の感想・評価など）
   - 【過度な圧縮の禁止】: ここに記録された関心は将来プロファイルへ昇格するかどうかの重要な判定材料となるため、文字数制限を理由に作品名や感想を削ぎ落とさないでください（1行に無理に収めず、2〜3文や複数行になっても構いません）。
   - 既存のrolling_memoryの末尾に追加し、全体で直近7〜10日分を超えた古い日付のブロックは自動で押し出し削除（忘却）してください。
2. profile（長期記憶・支援前提条件）の格上げ・新陳代謝ルール（★厳格かつ保守的に運用すること）:
   - 目的: プロファイルは「生活基盤（住居・家族・勤務）と、日々のタイムマネジメント・行動支援に必要な前提条件」を保持する場所です。
   - 【格上げ（昇格）の3大条件】以下のいずれかを満たした場合のみ、プロファイルへの追記・反映を許可します：
     ① 恒久的な生活基盤・住まいに関する客観的事実: 住居・家族構成・最寄り駅・勤務形態などの恒久的事実（1回の言及でも即反映）。
     ② rolling_memory内での定着（習慣・体質・ルーティン・趣味）: 直近7〜10日分のrolling_memoryの中で「3日以上言及されている」行動・体質・ルーティン・趣味関心（例: 慢性的な体質対策、一定期間継続してプレイしているゲームや趣味など）。7〜10日の中で1〜2日触れただけのものは一過性のものとして格上げせず、rolling_memoryに留めてください。
     ③ ユーザーによる明示的な宣言: 「これを日課にする」「ライフワークとして続ける」「プロファイルに覚えておいて」と本人が明言した場合。
   - 【具体的数値・支援前提の保護】: 移動所要時間や身支度・メイク時間のようなスケジュール支援に直結する具体的数値・条件を、性格表現（「〜なタイプ」等）のように勝手に要約・抽象化・削除することは固く禁じます。
   - 【原則維持】上記①〜③の条件を満たす明確な事実がない限り、既存プロファイルの文章・数値をそのまま一字一句維持して返してください。
3. cycle_stamps（数週間〜数ヶ月単位の周期メンテナンス記録）:
   - 目的: 次回のお手入れ時期（数週間〜数ヶ月後）を正しくリマインドするための日付スタンプです。
   - 対象: 「爪切り」「美容院・ヘアカット」「歯科健診・定期通院」「シーツ等寝具の洗濯」「楽器弦の全交換」など、身体・生活環境・機材の【全体的・本格的な定期メンテナンス】のみを記録してください。
   - 【絶対除外ルール】:
     ① 日常の軽微なお手入れや部分ケア（例: 引っ掛かりがあった爪1本だけを削った、気になる枝毛を切った）は cycle_stamps には絶対に記録しないでください。
     ② このような局所的ケアや応急処置はすべて 1 の rolling_memory のみに記録し、cycle_stamps には追記せず既存の記録をそのまま維持してください。
4. weekly_summary: 直近数日間の疲労・睡眠・メンタル状況の推移を100文字程度で簡潔にまとめてください。
5. dictionary（用語辞書・客観的前提知識）:
   - 既存の用語辞書の内容を基本として維持してください。
   - 【客観的事実・定義に限定】: 百科事典や用語集のように、客観的事実・作品定義・属性・誤認防止の注意点のみを記述してください。「ユーザーが好んでいる」「楽しみにしている」等の主観的感情や評価は辞書に含めてはなりません。
   - 会話ログの中で、ユーザーが独自の用語、新出ゲーム・作品、オリジナル創作の設定・意味などを説明・定義していた場合、または明示的に「覚えておいて」と伝えた場合、「単語名（別名）: 客観的な定義・属性」の形式で辞書に追記してください。
   - 単にタイトル名が会話に出ただけのものは追加せず、ユーザーがその意味・内容・属性を説明した場合のみを追加してください。

【出力形式】JSONのみ
{
  "rolling_memory": "更新された直近7〜10日分の活動バッファ（改行区切り箇条書き）",
  "profile": "新陳代謝・更新されたプロファイル文字列",
  "cycle_stamps": "更新された周期イベント文字列",
  "weekly_summary": "100文字程度の直近生活サマリー",
  "dictionary": "更新された用語辞書文字列（改行区切り）"
}`;

  const requestPayload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestPayload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`Gemini API HTTP ${statusCode}: ${response.getContentText()}`);
    }
    const resJson = JSON.parse(response.getContentText());
    if (!resJson.candidates || resJson.candidates.length === 0 || !resJson.candidates[0].content || !resJson.candidates[0].content.parts) {
      throw new Error('Gemini APIから有効な候補が返されませんでした');
    }
    const text = resJson.candidates[0].content.parts.map(p => p.text || '').join('').trim();
    let cleaned = text.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    return JSON.parse(cleaned);
  } catch (e) {
    Logger.log('メモリー更新解析失敗: ' + e.message);
    return {
      rolling_memory: currentRollingMemory,
      profile: currentProfile,
      cycle_stamps: currentCycleStamps,
      weekly_summary: currentWeeklySummary,
      dictionary: currentDictionary
    };
  }
}

/**
 * 毎月1日用: 前月の日報集約テキストから月間ハイライト・思い出ジャーナルを生成
 * @param {string} monthlyDataText 前月日報の集約テキスト
 * @param {string} monthStr YYYY-MM
 * @return {string} Markdown月報
 */
function generateMonthlyJournalMarkdown(monthlyDataText, monthStr) {
  const config = getConfig();
  const url = `${SYSTEM_CONSTANTS.GEMINI_ENDPOINT_BASE}?key=${config.geminiApiKey}`;

  const prompt = `あなたはサウンドディレクター専属の生活秘書です。前月（${monthStr}）の日報記録をもとに、Notionに保存する「月間ハイライト＆思い出ジャーナル」を作成してください。

【前月の日報集約データ】
${monthlyDataText}

【月報作成ルール】
1. 具体的なエピソードの保持:
   - 抽象的なまとめだけでなく、その月にあった印象的な出来事、楽しんだ作品・ゲーム、食事や暮らしの具体的なエピソードが生き生きと思い出せるように記述してください。
2. 思い出の写真の選別と埋め込み（任意）:
   - 日報集約データの中に \`![キャプション](https://...)\` 形式の画像が含まれており、その月のハイライトや思い出として象徴的なものがあれば、該当する話題の直下に **独立した1行** として \`![キャプション](画像URL)\` の形式で適宜埋め込んでください（無理にすべて埋め込む必要はなく、印象的なものを厳選してください）。

【ジャーナル構成要件】
# ${monthStr} 月間ハイライト＆思い出ジャーナル
- ## 🌙 今月の総括・ストーリー（親身で温かい振り返り）
- ## 🏆 大きな成果・完了した主要プロジェクト・タスク
- ## 🎨 クリエイティブ＆インプット（音楽・映画・読書・ゲーム・制作の具体的な記録）
- ## 🌿 心身・健康・生活のリズム（休息や体調管理の傾向）
- ## 🚀 来月への展望・メッセージ
※見出し、箇条書き（\`- \`）、太字（\`**強調**\`）、区切り線（独立行の \`---\`）を活用し、読みやすく温かみのあるMarkdown形式で記述してください。`;

  const requestPayload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestPayload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const resJson = JSON.parse(response.getContentText());
  if (resJson.candidates && resJson.candidates[0].content && resJson.candidates[0].content.parts) {
    return resJson.candidates[0].content.parts[0].text;
  }
  return `# ${monthStr} 月間ハイライト\n今月もお疲れ様でした。`;
}

/**
 * 開発・デバッグ用: Gemini APIの接続テスト
 * GASエディタでこの関数を選択して実行すると、APIキーやエンドポイントの疎通確認が可能です。
 */
function testGeminiConnection() {
  const config = getConfig();
  Logger.log('Gemini API Key 確認: ' + (config.geminiApiKey ? config.geminiApiKey.substring(0, 6) + '...' : '未設定'));
  
  try {
    const res = callGeminiFlash('こんにちは！テストです。', [], '【コンテキスト】\nテスト実行中', [], false);
    Logger.log('Gemini API 呼び出し成功！');
    Logger.log('AI返答: ' + JSON.stringify(res, null, 2));
  } catch (e) {
    Logger.log('Gemini API 呼び出し失敗: ' + e.message);
  }
}

// ==========================================
// FILE: src/Line.js
// ==========================================

/**
 * Line.js - LINE Messaging API 連携モジュール
 * Reply API専用（コストゼロ運用）、画像バイナリ取得・Google Drive保存、排他制御付き画像バッファ管理
 */

/**
 * LINE Reply APIを使用してユーザーへ即時返答
 * ※コストゼロ運用の制約に従い、Push APIは一切使用しません
 * @param {string} replyToken
 * @param {string} textMessage 返信テキスト
 */
function replyLineMessage(replyToken, textMessage) {
  if (!replyToken || replyToken === '00000000000000000000000000000000') {
    Logger.log('テストまたはダミーのreplyTokenのためLINE返信をスキップしました');
    return;
  }

  const config = getConfig();
  const url = SYSTEM_CONSTANTS.LINE_REPLY_ENDPOINT;

  const payload = {
    replyToken: replyToken,
    messages: [
      {
        type: 'text',
        text: textMessage || '承知いたしました。'
      }
    ]
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': `Bearer ${config.lineChannelAccessToken}`
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    Logger.log(`LINE Reply APIエラー [${code}]: ${response.getContentText()}`);
  }
}

/**
 * LINEの画像メッセージバイナリを取得し、Google Driveの指定フォルダへ保存
 * @param {string} messageId LINEメッセージID
 * @return {Object} { fileId: string, url: string }
 */
function downloadLineImageAndSaveToDrive(messageId) {
  const config = getConfig();
  const contentUrl = `${SYSTEM_CONSTANTS.LINE_CONTENT_ENDPOINT_BASE}/${messageId}/content`;

  const options = {
    method: 'get',
    headers: {
      'Authorization': `Bearer ${config.lineChannelAccessToken}`
    },
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(contentUrl, options);
  const statusCode = response.getResponseCode();

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`LINE画像取得エラー [${statusCode}]: ${response.getContentText()}`);
  }

  const blob = response.getBlob();
  const fileName = `line_img_${Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss')}_${messageId}.jpg`;
  blob.setName(fileName);

  const folder = DriveApp.getFolderById(config.driveFolderId);
  const file = folder.createFile(blob);

  // Notionの画像ブロック（external URL）として直接表示できるようリンク共有（閲覧のみ）を設定
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (shareErr) {
    Logger.log('Drive画像共有設定警告: ' + shareErr.message);
  }

  const fileId = file.getId();
  return {
    fileId: fileId,
    url: `https://lh3.googleusercontent.com/d/${fileId}`
  };
}

/**
 * スクリプトプロパティの画像バッファにFile IDと保存時刻を追加 (LockService排他制御付き)
 * @param {string} fileId
 */
function addImageIdToBuffer(fileId) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    const props = PropertiesService.getScriptProperties();
    const key = SYSTEM_CONSTANTS.IMAGE_BUFFER_PROP_KEY;
    const raw = props.getProperty(key);
    let buffer = [];

    if (raw) {
      try {
        buffer = JSON.parse(raw);
        if (!Array.isArray(buffer)) buffer = [];
      } catch (e) {
        buffer = [];
      }
    }

    buffer.push({
      fileId: fileId,
      timestamp: Date.now()
    });

    props.setProperty(key, JSON.stringify(buffer));
  } catch (err) {
    Logger.log('画像バッファ保存エラー: ' + err.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * スクリプトプロパティから有効な画像バッファを取得し、DriveからBlobオブジェクトを取得 (TTLチェック)
 * @return {Object} { blobs: Array<GoogleAppsScript.Base.Blob>, urls: Array<string> }
 */
function getBufferedImages() {
  const props = PropertiesService.getScriptProperties();
  const key = SYSTEM_CONSTANTS.IMAGE_BUFFER_PROP_KEY;
  const raw = props.getProperty(key);
  if (!raw) return { blobs: [], urls: [] };

  let entries = [];
  try {
    entries = JSON.parse(raw);
    if (!Array.isArray(entries)) entries = [];
  } catch (e) {
    return { blobs: [], urls: [] };
  }

  const now = Date.now();
  const ttl = SYSTEM_CONSTANTS.IMAGE_BUFFER_TTL_MS;
  const blobs = [];
  const urls = [];

  for (let i = 0; i < entries.length; i++) {
    const item = entries[i];
    // 単純文字列の過去データとの後方互換対応
    const fileId = typeof item === 'string' ? item : item.fileId;
    const itemTime = (typeof item === 'object' && item.timestamp) ? item.timestamp : now;

    // TTLチェック (30分以内)
    if (now - itemTime <= ttl && fileId) {
      try {
        const file = DriveApp.getFileById(fileId);
        blobs.push(file.getBlob());
        urls.push(`https://lh3.googleusercontent.com/d/${fileId}`);
      } catch (err) {
        Logger.log(`バッファ画像読み込み失敗 (${fileId}): ${err.message}`);
      }
    }
  }

  return { blobs, urls };
}

/**
 * スクリプトプロパティの画像バッファをクリア
 */
function clearImageBuffer() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    PropertiesService.getScriptProperties().deleteProperty(SYSTEM_CONSTANTS.IMAGE_BUFFER_PROP_KEY);
  } catch (e) {
    Logger.log('画像バッファクリアエラー: ' + e.message);
  } finally {
    lock.releaseLock();
  }
}

// ==========================================
// FILE: src/Batch.js
// ==========================================

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
  const memory = getMemory();

  let isDailyReportSuccess = false;

  // ----------------------------------------------------
  // 1. 日報生成 & Notion投稿 (データ保護付き)
  // ----------------------------------------------------
  try {
    Logger.log('1. 日報生成 & Notion投稿処理開始');
    // 前日および日付変更後〜午前3時までに完了したタスクを抽出
    const completedTasks = tasks.filter(t => t.status === '完了' && (t.completedDate === targetDateStr || t.completedDate === todayStr));

    if (logs.length > 0 || completedTasks.length > 0) {
      const dailyMarkdown = generateDailyReportMarkdown(logs, completedTasks, memory, targetDateStr);
      const reportResult = createDailyReport(dailyMarkdown, targetDateStr);
      if (reportResult && reportResult.id) {
        isDailyReportSuccess = true;
        Logger.log('Notion日報投稿成功: ' + targetDateStr);
      }
    } else {
      Logger.log('当日ログおよび完了タスクがないため、日報作成をスキップしました');
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

// ==========================================
// FILE: src/Dashboard.js
// ==========================================

/**
 * Dashboard.js - 生活伴走システム Webダッシュボード (GAS HTML Service & LINE Rich Menu)
 * スプレッドシートの logs 以外（tasks, shopping, input_stock, routines, memory）を
 * 人間がスマホ（LINE内ブラウザ）から直感的に確認・操作できるナチュラル＆オーガニックUI
 */

/**
 * オーナー専用のダッシュボード認証キーを生成（SHA-256先頭16文字）
 * URLパラメータ ?key=... に付与することで、他者のアクセスを遮断しつつオーナーは自動認証
 * @return {string}
 */
function getDashboardAccessKey() {
  const props = PropertiesService.getScriptProperties();
  const customKey = props.getProperty('DASHBOARD_ACCESS_KEY');
  if (customKey && customKey.trim() !== '') {
    return customKey.trim();
  }
  const config = getConfig();
  const raw = 'companion_salt_' + config.ownerUserId;
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
  let hex = '';
  for (let i = 0; i < digest.length; i++) {
    const byte = (digest[i] < 0 ? digest[i] + 256 : digest[i]);
    hex += ('0' + byte.toString(16)).slice(-2);
  }
  return hex.substring(0, 16);
}

/**
 * クライアントから渡された認証キーを検証
 * （生成キー、またはオーナーのLINE User IDそのもの、または末尾6文字以上の照合を許可）
 * @param {string} clientKey
 * @return {boolean}
 */
function verifyDashboardAccess(clientKey) {
  if (!clientKey || typeof clientKey !== 'string') return false;
  const trimmed = clientKey.trim();
  if (!trimmed) return false;

  const validKey = getDashboardAccessKey();
  if (trimmed === validKey) return true;

  const config = getConfig();
  if (trimmed === config.ownerUserId) return true;
  if (trimmed.length >= 6 && config.ownerUserId.endsWith(trimmed)) return true;

  return false;
}

/**
 * ダッシュボードのWebアプリURL（認証キー付き）を取得
 * @param {string=} defaultTab 初期表示タブ (tasks / shopping / input / routines / memory)
 * @return {string}
 */
function getDashboardUrl(defaultTab) {
  const props = PropertiesService.getScriptProperties();
  let baseUrl = props.getProperty('WEBAPP_URL') || '';
  if (!baseUrl) {
    try {
      baseUrl = ScriptApp.getService().getUrl() || '';
    } catch (e) {
      baseUrl = '';
    }
  }
  if (!baseUrl) return '';
  const key = getDashboardAccessKey();
  const tabParam = defaultTab ? `tab=${encodeURIComponent(defaultTab)}&` : '';
  return `${baseUrl}?${tabParam}key=${encodeURIComponent(key)}`;
}

/**
 * スクリプトプロパティ LIFF_ID を正規化して取得（URL全体が貼られていてもID部分のみ抽出）
 * @return {string}
 */
function getNormalizedLiffId() {
  const raw = (PropertiesService.getScriptProperties().getProperty('LIFF_ID') || '').trim();
  if (!raw) return '';
  return raw
    .replace(/^https?:\/\/liff\.line\.me\//i, '')
    .replace(/^https?:\/\/miniapp\.line\.me\//i, '')
    .split('?')[0]
    .replace(/\/+$/, '');
}

/**
 * doGet から呼び出されるダッシュボードHTMLレンダリング関数
 * @param {Object} e イベントオブジェクト
 * @return {GoogleAppsScript.HTML.HtmlOutput}
 */
function renderDashboardHtml(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  const initialTab = params.tab || 'tasks';
  const urlKey = params.key || '';
  const isPreAuthorized = verifyDashboardAccess(urlKey);
  const validKey = isPreAuthorized ? getDashboardAccessKey() : '';
  const liffId = getNormalizedLiffId();

  const html = buildDashboardTemplate(initialTab, validKey, liffId);
  return HtmlService.createHtmlOutput(html)
    .setTitle('Daily Companion - 生活伴走ダッシュボード')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ==========================================
// サーバーサイドAPI（GitHub Pages fetch & google.script.run 両対応）
// ==========================================

/**
 * 外部ホスティング（GitHub Pages等）からのJSON APIリクエストをディスパッチ
 * @param {Object} payload { apiAction: string, args: Array }
 * @return {Object}
 */
function handleDashboardApiRequest(payload) {
  try {
    const action = payload ? payload.apiAction : '';
    const args = (payload && Array.isArray(payload.args)) ? payload.args : [];
    const handlers = {
      apiGetDashboardData: apiGetDashboardData,
      apiUpdateTaskStatus: apiUpdateTaskStatus,
      apiAddTask: apiAddTask,
      apiEditTask: apiEditTask,
      apiUpdateShoppingStatus: apiUpdateShoppingStatus,
      apiAddShoppingItem: apiAddShoppingItem,
      apiUpdateInputStatus: apiUpdateInputStatus,
      apiAddInputStock: apiAddInputStock,
      apiStampCycleItem: apiStampCycleItem,
      apiAddRoutine: apiAddRoutine,
      apiUpdateMemoryField: apiUpdateMemoryField
    };
    if (!handlers[action]) {
      return { ok: false, error: 'Unknown apiAction: ' + action };
    }
    const data = handlers[action].apply(null, args);
    return { ok: true, data: data };
  } catch (err) {
    return { ok: false, error: (err && err.message) ? err.message : String(err) };
  }
}

/**
 * ダッシュボード表示用の全データを一括取得（logs以外の全5タブ）
 * @param {string} authKey
 * @return {Object}
 */
function apiGetDashboardData(authKey) {
  if (!verifyDashboardAccess(authKey)) {
    return { authorized: false, error: '認証キーが正しくありません。LINEのリッチメニューから開くか、LINE User IDの末尾6文字を入力してください。' };
  }

  const now = new Date();
  const todayStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // 1. タスク（未完了を全件 ＋ 本日完了したタスクも確認用に取得）
  const allTasks = getTasks();
  const rawTasks = allTasks.filter(t => t.status === '未完了' || (t.status === '完了' && t.completedDate === todayStr));

  const enrichedTasks = rawTasks.map(t => {
    // プレフィックス抽出（「対象/プロジェクト：内容」形式）
    let prefix = 'その他';
    let cleanTitle = t.title || '';
    const colonMatch = cleanTitle.match(/^([^：:]{1,20})[：:]\s*(.+)$/);
    if (colonMatch) {
      prefix = colonMatch[1].trim();
      cleanTitle = colonMatch[2].trim();
    }

    // 締切時刻の抽出（例: （〜12:00まで） / (18:00締切) など）
    let timeHint = '';
    const timeMatch = cleanTitle.match(/[（\(]([^）\)]*(?:\d{1,2}:\d{2}|時|午前|午後|まで|締切)[^）\)]*)[）\)]$/);
    if (timeMatch) {
      timeHint = timeMatch[1].trim();
      cleanTitle = cleanTitle.substring(0, cleanTitle.length - timeMatch[0].length).trim();
    }

    // 登録からの経過日数計算
    let elapsedDays = 0;
    if (t.createdDate) {
      const cParts = t.createdDate.split('-');
      if (cParts.length === 3) {
        const cDate = new Date(parseInt(cParts[0], 10), parseInt(cParts[1], 10) - 1, parseInt(cParts[2], 10));
        elapsedDays = Math.max(0, Math.floor((todayDate.getTime() - cDate.getTime()) / (1000 * 60 * 60 * 24)));
      }
    }

    // 締切までの残り日数計算
    let daysUntilDue = null;
    if (t.dueDate) {
      const dParts = t.dueDate.split('-');
      if (dParts.length === 3) {
        const dDate = new Date(parseInt(dParts[0], 10), parseInt(dParts[1], 10) - 1, parseInt(dParts[2], 10));
        daysUntilDue = Math.floor((dDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
      }
    }

    return {
      rowIndex: t.rowIndex,
      id: t.id,
      fullTitle: t.title,
      prefix: prefix,
      cleanTitle: cleanTitle,
      timeHint: timeHint,
      dueDate: t.dueDate,
      daysUntilDue: daysUntilDue,
      status: t.status,
      createdDate: t.createdDate,
      completedDate: t.completedDate,
      elapsedDays: elapsedDays,
      memo: t.memo || ''
    };
  });

  // 2. 買い物リスト（未買 ＋ 本日購入済）
  const allShopping = getShoppingList();
  const shopping = allShopping.filter(s => s.status === '未買');

  // 3. インプットストック（未消化 ＋ 本日消化済）
  const allInput = getInputStockList();
  const inputStock = allInput.filter(i => i.status === '未' || (i.status === '完' && i.consumedDate === todayStr));

  // 4. ルーティン定義
  const routines = getRoutines();

  // 5. メモリー（プロファイル、辞書、周期スタンプ等）
  const memory = getMemory();
  const parsedStamps = parseCycleStamps(memory.cycle_stamps || '', todayDate);

  return {
    authorized: true,
    validKey: getDashboardAccessKey(),
    liffId: getNormalizedLiffId(),
    todayStr: todayStr,
    tasks: enrichedTasks,
    shopping: shopping,
    inputStock: inputStock,
    routines: routines,
    memory: {
      profile: memory.profile || '',
      dictionary: memory.dictionary || '',
      rolling_memory: memory.rolling_memory || '',
      weekly_summary: memory.weekly_summary || '',
      cycle_stamps_raw: memory.cycle_stamps || '',
      cycle_stamps: parsedStamps,
      weather_info: memory.weather_info || '',
      pressure_alert: memory.pressure_alert || 'FALSE'
    }
  };
}

/**
 * cycle_stamps 文字列（例: "美容院: 2026-09-20, 機材メンテ: 2026-09-25"）を配列にパースして経過日数を算出
 * @param {string} rawStamps
 * @param {Date} todayDate
 * @return {Array<Object>}
 */
function parseCycleStamps(rawStamps, todayDate) {
  if (!rawStamps || !rawStamps.trim()) return [];
  const entries = rawStamps.split(/[,\n、]+/).map(s => s.trim()).filter(s => s.length > 0);
  const result = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const match = entry.match(/^([^:：]+)[：:]\s*(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/);
    if (match) {
      const label = match[1].replace(/^[・\-\s]+/, '').trim();
      const dateStr = match[2].replace(/\//g, '-');
      const parts = dateStr.split('-');
      let elapsedDays = null;
      if (parts.length === 3) {
        const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        if (!isNaN(d.getTime())) {
          elapsedDays = Math.max(0, Math.floor((todayDate.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)));
        }
      }
      result.push({
        label: label,
        date: dateStr,
        elapsedDays: elapsedDays
      });
    } else {
      result.push({
        label: entry.replace(/^[・\-\s]+/, ''),
        date: '',
        elapsedDays: null
      });
    }
  }
  return result;
}

/**
 * タスクのステータスを変更（完了 / 未完了に戻す / 破棄）
 * @param {string} authKey
 * @param {string} taskId
 * @param {string} newStatus '完了' | '未完了' | '破棄'
 * @return {Object}
 */
function apiUpdateTaskStatus(authKey, taskId, newStatus) {
  if (!verifyDashboardAccess(authKey)) throw new Error('Unauthorized');
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.TASKS);
  const tasks = getTasks();
  const todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i].id === taskId) {
      const row = tasks[i].rowIndex;
      sheet.getRange(row, 4).setValue(newStatus);
      sheet.getRange(row, 6).setValue(newStatus === '完了' ? todayStr : '');
      return { success: true, taskId: taskId, status: newStatus };
    }
  }
  throw new Error('対象のタスクが見つかりませんでした');
}

/**
 * ダッシュボードから新規タスクを追加
 * @param {string} authKey
 * @param {Object} payload { prefix, title, dueDate, memo }
 * @return {Object}
 */
function apiAddTask(authKey, payload) {
  if (!verifyDashboardAccess(authKey)) throw new Error('Unauthorized');
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.TASKS);
  const todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const taskId = 'T_' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss') + '_' + Math.floor(Math.random() * 1000);

  let fullTitle = (payload.title || '').trim();
  if (!fullTitle) throw new Error('タスク名を入力してください');

  const prefix = (payload.prefix || '').trim();
  if (prefix && !fullTitle.includes('：') && !fullTitle.includes(':')) {
    fullTitle = `${prefix}：${fullTitle}`;
  }

  const dueDate = (payload.dueDate || '').trim();
  const memo = (payload.memo || '').trim();

  sheet.appendRow([taskId, fullTitle, dueDate, '未完了', todayStr, '', memo]);
  return { success: true, taskId: taskId };
}

/**
 * タスクの内容（タイトル・期限・メモ）を編集
 * @param {string} authKey
 * @param {Object} payload { taskId, fullTitle, dueDate, memo }
 * @return {Object}
 */
function apiEditTask(authKey, payload) {
  if (!verifyDashboardAccess(authKey)) throw new Error('Unauthorized');
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.TASKS);
  const tasks = getTasks();

  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i].id === payload.taskId) {
      const row = tasks[i].rowIndex;
      if (payload.fullTitle) sheet.getRange(row, 2).setValue(payload.fullTitle.trim());
      sheet.getRange(row, 3).setValue((payload.dueDate || '').trim());
      if (payload.memo !== undefined) sheet.getRange(row, 7).setValue((payload.memo || '').trim());
      return { success: true };
    }
  }
  throw new Error('対象のタスクが見つかりませんでした');
}

/**
 * 買い物アイテムのステータスを更新（購入済 / 未買）
 * @param {string} authKey
 * @param {number} rowIndex
 * @param {string} newStatus '購入済' | '未買'
 * @return {Object}
 */
function apiUpdateShoppingStatus(authKey, rowIndex, newStatus) {
  if (!verifyDashboardAccess(authKey)) throw new Error('Unauthorized');
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.SHOPPING);
  sheet.getRange(Number(rowIndex), 3).setValue(newStatus);
  return { success: true };
}

/**
 * 買い物アイテムを新規追加
 * @param {string} authKey
 * @param {string} item
 * @param {string} category
 * @return {Object}
 */
function apiAddShoppingItem(authKey, item, category) {
  if (!verifyDashboardAccess(authKey)) throw new Error('Unauthorized');
  if (!item || !item.trim()) throw new Error('品名を入力してください');
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.SHOPPING);
  const todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  sheet.appendRow([item.trim(), (category || '日用品').trim(), '未買', todayStr]);
  return { success: true };
}

/**
 * インプットストックのステータスを更新（完 / 未）
 * @param {string} authKey
 * @param {number} rowIndex
 * @param {string} newStatus '完' | '未'
 * @return {Object}
 */
function apiUpdateInputStatus(authKey, rowIndex, newStatus) {
  if (!verifyDashboardAccess(authKey)) throw new Error('Unauthorized');
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.INPUT_STOCK);
  const todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  sheet.getRange(Number(rowIndex), 4).setValue(newStatus);
  sheet.getRange(Number(rowIndex), 5).setValue(newStatus === '完' ? todayStr : '');
  return { success: true };
}

/**
 * インプットストックを新規追加
 * @param {string} authKey
 * @param {Object} payload { type, title, memo }
 * @return {Object}
 */
function apiAddInputStock(authKey, payload) {
  if (!verifyDashboardAccess(authKey)) throw new Error('Unauthorized');
  if (!payload || !payload.title || !payload.title.trim()) throw new Error('タイトルを入力してください');
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.INPUT_STOCK);
  sheet.appendRow([
    (payload.type || '映画').trim(),
    payload.title.trim(),
    (payload.memo || '').trim(),
    '未',
    ''
  ]);
  return { success: true };
}

/**
 * 周期スタンプ（美容院、弦交換など）の日付を「今日（または指定日）」で記録・更新
 * @param {string} authKey
 * @param {string} label 項目名
 * @param {string=} customDate YYYY-MM-DD（省略時は今日）
 * @return {Object}
 */
function apiStampCycleItem(authKey, label, customDate) {
  if (!verifyDashboardAccess(authKey)) throw new Error('Unauthorized');
  if (!label || !label.trim()) throw new Error('項目名を指定してください');

  const targetLabel = label.trim();
  const dateStr = (customDate && customDate.trim())
    ? customDate.trim()
    : Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

  const memory = getMemory();
  const todayDate = new Date();
  const stamps = parseCycleStamps(memory.cycle_stamps || '', todayDate);

  let found = false;
  for (let i = 0; i < stamps.length; i++) {
    if (stamps[i].label === targetLabel) {
      stamps[i].date = dateStr;
      found = true;
      break;
    }
  }
  if (!found) {
    stamps.push({ label: targetLabel, date: dateStr });
  }

  const serialized = stamps.map(s => s.date ? `${s.label}: ${s.date}` : s.label).join(', ');
  setMemoryValue('cycle_stamps', serialized);
  return { success: true, cycle_stamps: serialized };
}

/**
 * ルーティン定義を新規追加
 * @param {string} authKey
 * @param {Object} payload { ruleName, type, value, memo }
 * @return {Object}
 */
function apiAddRoutine(authKey, payload) {
  if (!verifyDashboardAccess(authKey)) throw new Error('Unauthorized');
  if (!payload || !payload.ruleName || !payload.ruleName.trim()) throw new Error('ルール名を入力してください');
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.ROUTINES);
  sheet.appendRow([
    payload.ruleName.trim(),
    (payload.type || 'day_of_week').trim(),
    (payload.value || 'MON').trim(),
    '',
    (payload.memo || '').trim()
  ]);
  return { success: true };
}

/**
 * メモリー項目（profile / dictionary / rolling_memory / cycle_stamps）の手動保存
 * @param {string} authKey
 * @param {string} key
 * @param {string} value
 * @return {Object}
 */
function apiUpdateMemoryField(authKey, key, value) {
  if (!verifyDashboardAccess(authKey)) throw new Error('Unauthorized');
  const allowedKeys = ['profile', 'dictionary', 'rolling_memory', 'weekly_summary', 'cycle_stamps', 'custom_system_prompt'];
  if (!allowedKeys.includes(key)) {
    throw new Error('変更が許可されていないキーです');
  }
  setMemoryValue(key, String(value || '').trim());
  return { success: true };
}

// ==========================================
// LINE リッチメニュー自動生成・連携機能
// ==========================================

/**
 * LINE公式アカウントのトーク画面下部に「生活伴走ダッシュボード」リッチメニューを自動登録
 * ※LINE Developers / Official Account Manager での手作業なしでメニューを構築します
 * @param {string=} customWebAppUrl デプロイされたGASのWebアプリURL（省略時は自動取得）
 */
function setupLineRichMenu(customWebAppUrl) {
  const config = getConfig();
  const props = PropertiesService.getScriptProperties();

  let webAppUrl = customWebAppUrl || props.getProperty('WEBAPP_URL') || '';
  if (!webAppUrl) {
    try {
      webAppUrl = ScriptApp.getService().getUrl() || '';
    } catch (e) {}
  }

  if (!webAppUrl) {
    throw new Error('WebアプリのURLが取得できませんでした。GASを「ウェブアプリ」としてデプロイした上で、スクリプトプロパティ WEBAPP_URL にURLを設定するか、setupLineRichMenu("https://script.google.com/macros/s/.../exec") のようにURLを引数に渡して実行してください。');
  }

  // スクリプトプロパティにも保存しておく
  props.setProperty('WEBAPP_URL', webAppUrl);
  const authKey = getDashboardAccessKey();
  const liffId = getNormalizedLiffId();

  // LIFF IDが設定されている場合はLIFF URLを使用（GitHub Pagesへ liffId と api URL も自動引き渡し）
  const getMenuUri = (tab) => {
    if (liffId) {
      return `https://liff.line.me/${liffId}?tab=${tab}&key=${encodeURIComponent(authKey)}&liffId=${encodeURIComponent(liffId)}&api=${encodeURIComponent(webAppUrl)}`;
    }
    return `${webAppUrl}?tab=${tab}&key=${encodeURIComponent(authKey)}`;
  };

  // 1. リッチメニューオブジェクトの作成 (1200x405 コンパクトサイズ・4分割)
  const richMenuPayload = {
    size: {
      width: 1200,
      height: 405
    },
    selected: true,
    name: 'Daily Companion Organic Menu',
    chatBarText: '🌿 メニューを開く',
    areas: [
      {
        bounds: { x: 0, y: 0, width: 300, height: 405 },
        action: {
          type: 'uri',
          label: 'タスク一覧',
          uri: getMenuUri('tasks')
        }
      },
      {
        bounds: { x: 300, y: 0, width: 300, height: 405 },
        action: {
          type: 'uri',
          label: '買い物リスト',
          uri: getMenuUri('shopping')
        }
      },
      {
        bounds: { x: 600, y: 0, width: 300, height: 405 },
        action: {
          type: 'uri',
          label: 'ストック・習慣',
          uri: getMenuUri('input')
        }
      },
      {
        bounds: { x: 900, y: 0, width: 300, height: 405 },
        action: {
          type: 'uri',
          label: '周期・AI記憶',
          uri: getMenuUri('memory')
        }
      }
    ]
  };

  const createRes = UrlFetchApp.fetch('https://api.line.me/v2/bot/richmenu', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${config.lineChannelAccessToken}` },
    payload: JSON.stringify(richMenuPayload),
    muteHttpExceptions: true
  });

  if (createRes.getResponseCode() < 200 || createRes.getResponseCode() >= 300) {
    throw new Error(`リッチメニュー作成失敗 [${createRes.getResponseCode()}]: ${createRes.getContentText()}`);
  }

  const richMenuId = JSON.parse(createRes.getContentText()).richMenuId;
  Logger.log('リッチメニュー作成成功 ID: ' + richMenuId);

  // 2. リッチメニュー背景画像（ナチュラル＆オーガニックな4分割バー）を生成してアップロード
  const imageBlob = generateRichMenuImageBlob();
  const uploadRes = UrlFetchApp.fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
    method: 'post',
    contentType: 'image/png',
    headers: { Authorization: `Bearer ${config.lineChannelAccessToken}` },
    payload: imageBlob.getBytes(),
    muteHttpExceptions: true
  });

  if (uploadRes.getResponseCode() < 200 || uploadRes.getResponseCode() >= 300) {
    throw new Error(`リッチメニュー画像アップロード失敗 [${uploadRes.getResponseCode()}]: ${uploadRes.getContentText()}`);
  }
  Logger.log('リッチメニュー画像アップロード成功');

  // 3. デフォルトのリッチメニューとして適用 & オーナーユーザーへ即時リンク
  UrlFetchApp.fetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {
    method: 'post',
    headers: { Authorization: `Bearer ${config.lineChannelAccessToken}` },
    muteHttpExceptions: true
  });

  UrlFetchApp.fetch(`https://api.line.me/v2/bot/user/${config.ownerUserId}/richmenu/${richMenuId}`, {
    method: 'post',
    headers: { Authorization: `Bearer ${config.lineChannelAccessToken}` },
    muteHttpExceptions: true
  });

  Logger.log('✅ LINEリッチメニューの登録・有効化が完了しました！');
  Logger.log('ダッシュボード直接URL: ' + `${webAppUrl}?key=${authKey}`);
  return richMenuId;
}

/**
 * リッチメニュー用の1200x405 PNG画像を生成（QuickChartのSVG/Canvasレンダラまたは内蔵PNGを利用）
 * @return {GoogleAppsScript.Base.Blob}
 */
function generateRichMenuImageBlob() {
  const b64 = "iVBORw0KGgoAAAANSUhEUgAABLAAAAGVCAMAAADZpvjfAAAAHlBMVEX08Oj8+/ji3dJSaFbn7+jCa1H56+amf0727+Q7ODRHqY7JAAARY0lEQVR42u3d23bjNhJA0dCiKM7///DcMivdE4kCbygUsOstbbmXvLtwItsS9cePMcYkmT8QGGMEyxhjrg6WMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjTPPjOtGkSJFq/yrtrm9PihSpHN3662+dupzr1EiRIhUl9RvY1P2cRyNFilSU1K9i0yBzzowUKVJRUgOCnUMjRYpUdLIGA/sTjRQpUpmkBhY7aEaKFKnoYg0pdsiMFClS0cUaVOyAGSlSpKKLNazYbjNSpEhFF2tgsZ1mpEiRCi/WyGL/NiNFilT7UsT2mpEiRSq6WD/IfkiRIpXkm8LRxcojT4oUqeiHWD/ICiNPihSp8IdYxEojT4oUqfCHWMgsFylSWYLlMWnpo1JSpEiFf09IrDTypEiRCn+IhcxykSIlWJaLFClSgmW5SJESLGSkSJESLMtFihSpa4JFrNSMFClS4cVCZrlIkRIsy0WKFCnBslykSAkWMlKkSAmW5SJFipRgWS5SpAQLGSlSpATLcpEiRUqwLBcpUoKFjBQpUoJluUiRIiVYlosUKcFCRooUKcGyXKRIGcGyXKRICZblMqRICZblIkWKlGBZLlKkBMtykSJFSrAsFylSpJBZLlKkBMtykSJFSrAsFylSpJBZLlKkBMtykSJFSrAsFylSgoXMcpEiJViWixQpUoJluUiREixklosUKcGyXKRIkRIsy0WKlGAhI0WKlGBZLlKkSAmW5SJFSrCQkSJFSrAsFylSpPIHa7ZchbOQKpyVVE+nrwWy+d1YrneZejek3mXq3ZDKf/qiyeatsVzfYhUZrWal1q0hlfv0hZLN38dyfa9VULPalFq/D6nEpy+ObC6d4ZdrKZ3hpdbSGV4q7emLIpv3zNDLteyZoaXWPTO0VOLTF0M2751hl2vZO8NKrXtnWKnUpy+CbD4yQy7XcmSGlFqPzJBSyU9ffbL56Ay3XMvRGU5qPTrDSaU/fdXJ5rlts3aWa1naLlY7UuvadrHakcp/+iqTzedmoOVazs1AUuu5GUiqh9NXl2yemzdrZLmWpfliNSK1rs0XqxGpLk5fVbJ5bt+sjeValvaL1YbUurZfrDak+jh9Fcnma2aA5VqumQGk1mtmAKleTl89snlOYdbAci1LimI1ILWuKYrVgFQ3p68a2TznMItfrmXJUax4qXXNUax4qX5OXy2yeU5iFr5cy5KkWOFS65qkWOFSHZ2+SmTznMUsermWJUuxoqXWNUuxoqV6On11yOY5jVnwci1LmmIFS61rmmIFS3V1+qqQzXMes9jlWpY8xYqVWtc8xYqV6uv0IRMswRIswbpX7D6z0OValkTFCpVa10TFCpXq7PRVIJvnTGaRy7UsmYoVKbWumYoVKdXb6bufbJ5TmQUu17KkKlag1LqmKlagVHenD5lgCZZgCdbtYjeZxS3XsuQqVpzUuuYqVpxUf6fvbrJ9CI94s7Dl2pegZ3yxwqT2JegVX6wwqQ5PXyNkj99HsD6X6vcRrM+l+n0Eq4vTdzPZEa8dah0t15Fa7WhWR1JHarWjWR1J9Xj64sken0awSnJVmKyxgvX6NIKV/fTdS3YCrAytm+U6kauyZHUjdSJXZcnqRqrL0xdM9nicMxsnWM/nuWKNE6zX61yxxglWxtN3K9lJsBK0TpbrZK5KktWJ1MlclSSrE6k+T18k2eNx3myMYD2f54s1RrBer/PFGiNYSU/fnWRXiFU3C1muK3pVvVghUlf0qnqxQqQ6PX1xZBswe8wGCNZGlvYUa4BgbWRpT7EGCFba0xdGtq1SbtZ/sLabVF6s/oO13aTyYvUfrLyn70ayYrFjN7jJLGK5int17AY3FStCqrhXx25wU7EipHo9fQ2QHb7FcME6fIvhgnX4FsMFK9vpCyIr4igz6zxYRTEqK1bnwSqKUVmxOg9W5tN3H9lpsRizgOU63auYYgVIne5VTLECpLo9fcFkpb97FazSZz4IVukzHwQr4+kLIXvsJnsMGqzn7mA9Bw3Wa3ewXoMGK/fpiyUrf7XT6MEqf63h6MEqf63h6MFKefpuI7tELMCs/nJd0quAYtWXuqRXAcWqL9Xv6UMmWIIlWIJVwFB0VWnBetug554bDxSsomu6C1be0xdA9inbm3+6ZdZtsD49aNr8061idRusTw+aNv90q1jdBiv76QskK3xqrWA9C5/YLlivwie2C1ba09cK2fcXjwvWt1c7C9ar8NXOgpX29CETLMESLMHaR7Zx2TDBeha+L6FgvQrfl1Cw0p4+ZIIlWIIlWIIlWIIlWFmCte/3qluXkq78m9Xqy7XvWQ1bF3Kv/LyG6lL7ntWwdSH3ys9rqC7V8enTeI+wPMLyCMu3hIIlWIIlWIIlWIIlWILlmSA5guV5WJ6HNfLpQyZYgiVYguW1hDcFy2sJvZZw4NPn9eIJguVqDaXBcrWG3k+fK/I0HCzXwyoNluthjXL6XPMwQ7BccbQ0WK442vnpQyZYgiVYguVdc+oWy7vmeNecEU6fd0bLESzvS1gaLO9L2PXp896zTQfLOz+XBss7P49x+oLJHucTP0iwnucfYA0SrNf5B1iDBCvj6buP7LxZhFjEcp0vVkSvQqROpyiiVyFSvZ6+ILLPT63dcYshgvX5ie07bjFEsD4/sX3HLYYIVubT1wDZ49gNBgzW89gNBgzW69gNBgxWttN3I1m52WPnR28UC1mu8mI9d370xl7FSBUX67Xzozf2Kkaq09MXRjY/vr9EvOR3Gf0Ha3l+v0BDyW8S+w/W+vp+gYaS3yT2H6y8py+O7O+Xkn4/8/DB+vuF3N/PMnyw/n4h9/ezDh+stKfvTrJLzCqLxSzXJcWq3KsgqSuKVblXQVJ9nr5Isvm82CDBWs73apBgred7NUiwkp6+W8m+ms0nwa4XC1quaTmZrKV6r6Kk1pPJWqv3Kkqqy9MXTDafExsoWMu5Xg0UrPVcrwYKVsbTdy9Zgdl8AuwGsajlKijWciJXS0dS64lkrRG9CpPq8fTFk31AK/rMsYL1IVlFnzlWsD4kq+gzxwpWutN3M1mZ2eY7o9UVC1uusmJtvi9h3V7FSa3rkWYVflZXUh2evkbIPl9VWrDed2vfzUcM1udrugtW3tN3N9lOs3CxuOXaWazwXgVKrfdNZ1L9nb7byaZcYoHLNeXqVaRUrl5FSnV3+pAJlmAJlmDdbjZ1t1xTql6FSqXqVahUb6evAtmUSSx0uaZMvYqVytSrWKnOTl8NsimRWOxyTYl6FSyVqFfBUn2dPmSCJViCJVj3mk2dLteUp1fRUnl6FS3V1emrQzalEYterilNr8Kl0vQqXKqn01eJbMoiFr5cU5ZexUtl6VW8VEenrxbZlEQsfrmmJL1qQCpJrxqQ6uf0VSObcog1sFxTjl61IJWjVy1IdXP66pFNKcRaWK4pRa+akErRqyakejl9FckuQbv9PrawXJckaxCp9nPVilQfp68q2dS+WCPLNbXfq1ak2u9VK1JdnL66ZFPzYq0s19R8r5qRar5XzUj1cPoqk51Cq3L/WlmuU8kaTKrtXLUklf/0VSeb2hZraLmmtnvVklTbvWpJKv3pq092EK3WnWtouQ4ma0iphnPVmFTy0xdBdgCt3l1rarkOJGtYqWZz1ZxU6tMXQ7YTreYda2y5diZraKlGc9WgVOLTF0W2A63u3WpuuXYka3ipJnPVpFTa0xdHVqZW/T41uFxlzSJV2ixSiU9fKNk3tYg71OZyfWsWqdJmkcp9+qLJPrJF3Zlml+tjtEiVRotU/tPXAtkvePF3oenl+iVdpErTRaqn09cW2WS5SJEiJViWixQpwbJcpEiREizLRYoUKWSWixQpwbJcpEiREizLRYoUKWSWixQpwbJcpEiREizLRYqUYCGzXKRICZblIkWKlGBZLlKkBAuZ5SJFSrAsFylSpATLcpEiJVjISJEiJViWixQpUoJluUiREixkpEiREizLRYoUKcGyXKRICRYyUqRICZblIkWKlGBZLlKkBAsZKVKkBMtykSJlBMtykSIlWJbLkCIlWJaLFClSgmW5SJESLMtFihQpwbJcpEiRQma5SJESLMtFihQpwbJcpEiRQma5SJESLMtFihQpwbJcpEgJFjLLRYqUYFkuUpRICZblIkVKsHBZLlKkBMtykSJFSrAsFylSgoWMFClSgmW5SJEiJViWixQpwUJGihQpwbJcpEiRCg7WP97Mp49/+9xf//z/b1fyeZHLdcXXUvo17vW+0LPaMdzyrL1vLQVr675u2dy1hxe4CZZgCZZgCZZgCZZgCZZgCZZgCZZgVf2h+6cF2cIt+btuWaaLl6v0a9nztR392NYy7v13iApWyX2qtW8tBut/9/FblI5+3lV7KFiCJViCJViCJViCJViCJViCJViCNUqwSv5OwSr/73eugrW9b63+0H3vv+WezzuyayfsBEuwBEuwBEuwBEuwBEuwBEuwBEuwmgjWkSf5fXsC46VPGr1ouUqfeLdnUY48ma/07323cK0+cbRGsC7/H2FQsL49yfNIsI78WwiWYAmWYAmWYAmWYAmWYAmWYAmWYPXyQ/et2+75QV6LL1S94wfre77mPT+U3/nkv5DL0pX+8mWkH7qf3Zm9e3hmHwVLsARLsARLsARLsARLsARLsARLsHoP1pHDKViCdcYzw4ufI4K19fcLlmAJlmAJlmAJlmAJlmAJlmAJlmD1HKyjF7e//A0oLliuMxfqL/28PR+76g0IooJ15smK3oTi+jehOPI/D8ESLMESLMESLMESLMESLMESLMESrFaDlXpCfpRMipQRLMtFipRgWS5DipRgWS5SpEgJluUiRUqwLBcpUqQEy3KRIkUKmeUiRUqwLBcpUqQEy3KRIkUKmeUiRUqwLBcpUqQEy3KRIkUKmeUiRUqwLBcpUqQEy3KRIiVYyCwXKVKCZblIkSIlWJaLFCnBQkaKFCnBslykSJESLMtFipRgISNFipRgWS5SpEgJluUiRUqwkJEiRUqwLBcpUqQEy3KRIiVYyEiRIiVYlosUKSNYlosUKcGyXIYUKcGyXKRIkRIsy0WKlGBZLlKkSAmW5SJFihQyy0WKlGBZLlKkSAmW5SJFihQyy0WKlGBZLlKkSAmW5SJFihQyy0WKlGBZLlKkSAmW5SJFSrCQWS5SpATLcpEiRUqwLBcpUoKFjBQpUoJluUiRIiVYlosUKcFCRooUKcGyXKRIkRIsy0WKlGAhI0WKlGBZLlKkSAmW5SJFSrCQkSJFSrAsFylSRrAsFylSgmW5DClSgmW5SJEiJViWixQpwbJcpEiREizLRYoUKWSWixQpwbJcpEiREizLRYoUKWSWixQpwbJcpEiREizLRYqUYCGzXKRICZblIkWKlGBZLlKkBAuZ5SJFSrAsFylSpATLcpEiJVjISJEiJViWixQpUoJluUiREixkpEiREizLRYoUKcGyXKRIjREsZsVipEiRiu4VMstFipRgWS5SpEgJluUiRUqwkJEiRUqwLBcpUqSuCxazf4n9kCJFql0pkd+feFKkSAU/wEJmuUiRShWsH2I/pEiRyvAdociXJ54UKVLBD7BEvjzxpEiRin6AJfLlYqRIkQp+gDW8mZeKkyKVqVdjPyz92bdcpEiRivyGcHCz3c9aI0WKVGyvBjY78DtVUqRIxfZqWLNDv6IgRYpUbK8GNfs59isKUqRIxfZqSDM/8SNFKmmv/mP2MxjYDylSpHJJDYr2c/YbaFKkSEXm6k+zEdT++3WSIkUqo9Tf0PqF++vrI0WKVFap92r9DilSpHJLjSFHihSpvkpljDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHGGGPMQPNPmIcyVgAUGgMAAAAASUVORK5CYII=";
  const bytes = Utilities.base64Decode(b64);
  return Utilities.newBlob(bytes, "image/png", "richmenu.png");
}

// ==========================================
// フロントエンドHTMLテンプレート（ナチュラル＆オーガニックUI）
// ==========================================

/**
 * ダッシュボードの単一ページアプリケーション（SPA）HTMLを生成
 * @param {string} initialTab
 * @param {string} validKey
 * @return {string}
 */
function buildDashboardTemplate(initialTab, validKey, liffId) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
  <title>Daily Companion</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@400;500;700&family=Noto+Sans+JP:wght@400;500;600&display=swap" rel="stylesheet">
  <script charset="utf-8" src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
  <style>
    :root {
      --bg-base: #F6F3EC;
      --bg-elevated: #FCFBF8;
      --bg-subtle: #EDE8DF;
      --bg-pill: #E8E2D7;
      --border-soft: #E2DDD2;
      --border-strong: #CFC8B9;
      --text-main: #2E2C29;
      --text-sub: #6E6A63;
      --text-muted: #9A948A;
      --sage-main: #526856;
      --sage-light: #E7EFE8;
      --sage-border: #C3D4C6;
      --terracotta: #C26B51;
      --terracotta-light: #F9EBE6;
      --amber: #A67F4E;
      --amber-light: #F6EFE4;
      --shadow-sm: 0 2px 8px rgba(46, 44, 41, 0.04);
      --shadow-md: 0 6px 20px rgba(46, 44, 41, 0.07);
      --radius-lg: 18px;
      --radius-md: 12px;
      --radius-pill: 999px;
    }

    * {
      box-sizing: border-box;
      -webkit-tap-highlight-color: transparent;
    }

    body {
      margin: 0;
      padding: 0;
      background-color: var(--bg-base);
      color: var(--text-main);
      font-family: 'Zen Maru Gothic', 'Noto Sans JP', -apple-system, BlinkMacSystemFont, sans-serif;
      line-height: 1.55;
      padding-bottom: 92px;
      min-height: 100vh;
    }

    /* ヘッダー */
    .app-header {
      position: sticky;
      top: 0;
      z-index: 30;
      background: rgba(246, 243, 236, 0.92);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border-soft);
      padding: 14px 18px 10px;
    }

    .header-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .brand-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 1.15rem;
      font-weight: 700;
      color: var(--sage-main);
      letter-spacing: 0.02em;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .icon-btn {
      background: var(--bg-elevated);
      border: 1px solid var(--border-soft);
      color: var(--text-sub);
      border-radius: var(--radius-pill);
      padding: 6px 12px;
      font-size: 0.8rem;
      font-family: inherit;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      box-shadow: var(--shadow-sm);
      transition: all 0.2s ease;
    }

    .icon-btn:active {
      transform: scale(0.96);
      background: var(--bg-subtle);
    }

    /* コンテナ */
    .container {
      max-width: 640px;
      margin: 0 auto;
      padding: 14px 16px 24px;
    }

    /* サブコントロール・フィルターピル */
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
      gap: 8px;
    }

    .section-summary {
      font-size: 0.88rem;
      color: var(--text-sub);
      font-weight: 500;
    }

    .view-toggle {
      display: inline-flex;
      background: var(--bg-subtle);
      border-radius: var(--radius-pill);
      padding: 3px;
      border: 1px solid var(--border-soft);
    }

    .view-toggle button {
      border: none;
      background: transparent;
      color: var(--text-sub);
      font-family: inherit;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: var(--radius-pill);
      cursor: pointer;
      transition: all 0.2s;
    }

    .view-toggle button.active {
      background: var(--bg-elevated);
      color: var(--sage-main);
      box-shadow: var(--shadow-sm);
    }

    /* 横スクロールピルバー */
    .pill-bar {
      display: flex;
      gap: 7px;
      overflow-x: auto;
      padding: 4px 2px 12px;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    .pill-bar::-webkit-scrollbar {
      display: none;
    }

    .filter-pill {
      border: 1px solid var(--border-soft);
      background: var(--bg-elevated);
      color: var(--text-sub);
      padding: 6px 13px;
      border-radius: var(--radius-pill);
      font-family: inherit;
      font-size: 0.8rem;
      font-weight: 500;
      white-space: nowrap;
      cursor: pointer;
      transition: all 0.2s ease;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }

    .filter-pill .count {
      font-size: 0.72rem;
      background: var(--bg-subtle);
      color: var(--text-sub);
      padding: 1px 6px;
      border-radius: var(--radius-pill);
    }

    .filter-pill.active {
      background: var(--sage-main);
      border-color: var(--sage-main);
      color: #FFFFFF;
    }

    .filter-pill.active .count {
      background: rgba(255, 255, 255, 0.22);
      color: #FFFFFF;
    }

    /* グループセクション */
    .group-section {
      margin-bottom: 20px;
    }

    .group-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 6px 8px;
      cursor: pointer;
      user-select: none;
    }

    .group-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.95rem;
      font-weight: 700;
      color: var(--text-main);
    }

    .group-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--sage-main);
      display: inline-block;
    }

    .group-badge {
      font-size: 0.75rem;
      color: var(--text-sub);
      background: var(--bg-subtle);
      padding: 2px 9px;
      border-radius: var(--radius-pill);
      font-weight: 500;
    }

    /* カードリスト */
    .card-list {
      display: flex;
      flex-direction: column;
      gap: 9px;
    }

    .item-card {
      background: var(--bg-elevated);
      border: 1px solid var(--border-soft);
      border-radius: var(--radius-lg);
      padding: 13px 14px;
      display: flex;
      align-items: flex-start;
      gap: 12px;
      box-shadow: var(--shadow-sm);
      transition: all 0.3s ease;
      position: relative;
    }

    .item-card.urgent {
      border-left: 4px solid var(--terracotta);
    }

    .item-card.soon {
      border-left: 4px solid var(--amber);
    }

    .item-card.completed-card {
      opacity: 0.58;
      background: var(--bg-base);
    }

    .item-card.completing {
      background: var(--sage-light);
      border-color: var(--sage-border);
      transform: scale(0.985);
      opacity: 0.7;
    }

    /* オーガニックなサークルチェックボックス */
    .circle-check {
      width: 24px;
      height: 24px;
      min-width: 24px;
      border-radius: 50%;
      border: 2px solid var(--border-strong);
      background: #FFFFFF;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-top: 1px;
      transition: all 0.2s ease;
      color: transparent;
      font-size: 0.82rem;
    }

    .circle-check:hover {
      border-color: var(--sage-main);
    }

    .circle-check.checked {
      background: var(--sage-main);
      border-color: var(--sage-main);
      color: #FFFFFF;
    }

    .card-body {
      flex: 1;
      min-width: 0;
    }

    .card-title-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
    }

    .card-title {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--text-main);
      word-break: break-word;
      line-height: 1.45;
    }

    .completed-card .card-title,
    .completing .card-title {
      text-decoration: line-through;
      color: var(--text-sub);
    }

    .card-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-top: 7px;
    }

    .badge {
      font-size: 0.73rem;
      padding: 2px 8px;
      border-radius: 8px;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .badge-prefix {
      background: var(--sage-light);
      color: var(--sage-main);
      font-weight: 600;
    }

    .badge-urgent {
      background: var(--terracotta-light);
      color: var(--terracotta);
      font-weight: 600;
    }

    .badge-soon {
      background: var(--amber-light);
      color: var(--amber);
      font-weight: 600;
    }

    .badge-normal {
      background: var(--bg-subtle);
      color: var(--text-sub);
    }

    .badge-aged {
      background: #EFECE4;
      color: #7D6B52;
      border: 1px dashed #D5CBB8;
    }

    .card-memo {
      margin-top: 6px;
      font-size: 0.78rem;
      color: var(--text-sub);
      background: var(--bg-base);
      padding: 5px 9px;
      border-radius: 8px;
    }

    /* クイック追加フォーム（インライン） */
    .quick-add-box {
      background: var(--bg-elevated);
      border: 1px solid var(--border-soft);
      border-radius: var(--radius-lg);
      padding: 12px 14px;
      margin-bottom: 16px;
      box-shadow: var(--shadow-sm);
    }

    .quick-add-row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }

    .organic-input, .organic-select, .organic-textarea {
      background: var(--bg-base);
      border: 1px solid var(--border-soft);
      border-radius: 10px;
      padding: 9px 12px;
      font-family: inherit;
      font-size: 0.88rem;
      color: var(--text-main);
      outline: none;
      transition: border-color 0.2s;
    }

    .organic-input:focus, .organic-select:focus, .organic-textarea:focus {
      border-color: var(--sage-main);
      background: #FFFFFF;
    }

    .btn-primary {
      background: var(--sage-main);
      color: #FFFFFF;
      border: none;
      border-radius: 10px;
      padding: 9px 16px;
      font-family: inherit;
      font-size: 0.86rem;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: opacity 0.2s, transform 0.1s;
    }

    .btn-primary:active {
      transform: scale(0.97);
    }

    .btn-secondary {
      background: var(--bg-subtle);
      color: var(--text-main);
      border: 1px solid var(--border-soft);
      border-radius: 10px;
      padding: 8px 14px;
      font-family: inherit;
      font-size: 0.84rem;
      font-weight: 500;
      cursor: pointer;
    }

    /* 周期スタンプカード */
    .stamp-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 10px;
      margin-bottom: 22px;
    }

    .stamp-card {
      background: var(--bg-elevated);
      border: 1px solid var(--border-soft);
      border-radius: var(--radius-lg);
      padding: 14px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-shadow: var(--shadow-sm);
    }

    .stamp-info h4 {
      margin: 0 0 4px 0;
      font-size: 0.95rem;
      color: var(--text-main);
    }

    .stamp-days {
      font-size: 0.8rem;
      color: var(--sage-main);
      font-weight: 600;
    }

    .stamp-date {
      font-size: 0.74rem;
      color: var(--text-muted);
    }

    /* メモリーセクション */
    .memory-card {
      background: var(--bg-elevated);
      border: 1px solid var(--border-soft);
      border-radius: var(--radius-lg);
      padding: 16px;
      margin-bottom: 14px;
      box-shadow: var(--shadow-sm);
    }

    .memory-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .memory-title {
      font-size: 0.95rem;
      font-weight: 700;
      color: var(--sage-main);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .memory-content {
      font-size: 0.86rem;
      color: var(--text-main);
      white-space: pre-wrap;
      background: var(--bg-base);
      padding: 12px;
      border-radius: 10px;
      border: 1px solid var(--border-soft);
      max-height: 280px;
      overflow-y: auto;
    }

    /* フローティング追加ボタン (FAB) */
    .fab-btn {
      position: fixed;
      right: 18px;
      bottom: 82px;
      z-index: 35;
      background: var(--sage-main);
      color: #FFFFFF;
      border: none;
      border-radius: var(--radius-pill);
      padding: 12px 18px;
      font-family: inherit;
      font-size: 0.9rem;
      font-weight: 700;
      box-shadow: 0 6px 18px rgba(82, 104, 86, 0.32);
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
    }

    /* 下部ナビゲーションバー */
    .bottom-nav {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 40;
      background: rgba(252, 251, 248, 0.95);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-top: 1px solid var(--border-soft);
      display: flex;
      justify-content: space-around;
      padding: 6px 8px calc(8px + env(safe-area-inset-bottom, 0px));
    }

    .nav-item {
      flex: 1;
      border: none;
      background: transparent;
      color: var(--text-muted);
      font-family: inherit;
      padding: 6px 4px;
      border-radius: 12px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      transition: all 0.2s;
      position: relative;
    }

    .nav-item .nav-icon {
      font-size: 1.2rem;
      line-height: 1.1;
    }

    .nav-item .nav-label {
      font-size: 0.7rem;
      font-weight: 600;
    }

    .nav-item.active {
      color: var(--sage-main);
      background: var(--sage-light);
    }

    .nav-badge {
      position: absolute;
      top: 3px;
      right: 18%;
      background: var(--sage-main);
      color: #FFFFFF;
      font-size: 0.64rem;
      padding: 0 5px;
      border-radius: var(--radius-pill);
      font-weight: 700;
    }

    /* トースト通知 */
    .toast-bar {
      position: fixed;
      bottom: 78px;
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      background: #2E2C29;
      color: #FCFBF8;
      padding: 10px 16px;
      border-radius: var(--radius-pill);
      font-size: 0.84rem;
      display: flex;
      align-items: center;
      gap: 12px;
      box-shadow: var(--shadow-md);
      z-index: 60;
      opacity: 0;
      pointer-events: none;
      transition: all 0.25s ease;
      white-space: nowrap;
    }

    .toast-bar.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
      pointer-events: auto;
    }

    .toast-undo {
      background: transparent;
      border: 1px solid rgba(255,255,255,0.4);
      color: #A9C7AE;
      border-radius: var(--radius-pill);
      padding: 3px 10px;
      font-family: inherit;
      font-size: 0.78rem;
      font-weight: 700;
      cursor: pointer;
    }

    /* モーダル */
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(46, 44, 41, 0.45);
      backdrop-filter: blur(3px);
      z-index: 50;
      display: none;
      align-items: flex-end;
      justify-content: center;
    }

    .modal-backdrop.open {
      display: flex;
    }

    .modal-sheet {
      background: var(--bg-elevated);
      width: 100%;
      max-width: 600px;
      border-radius: 24px 24px 0 0;
      padding: 20px 20px calc(24px + env(safe-area-inset-bottom, 0px));
      box-shadow: var(--shadow-md);
      max-height: 88vh;
      overflow-y: auto;
    }

    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 14px;
    }

    .modal-title {
      font-size: 1.05rem;
      font-weight: 700;
      color: var(--text-main);
    }

    .form-group {
      margin-bottom: 12px;
    }

    .form-label {
      display: block;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--text-sub);
      margin-bottom: 5px;
    }

    .empty-state {
      text-align: center;
      padding: 42px 20px;
      color: var(--text-muted);
      background: var(--bg-elevated);
      border: 1px dashed var(--border-soft);
      border-radius: var(--radius-lg);
    }

    .loading-spinner {
      text-align: center;
      padding: 50px 20px;
      color: var(--text-sub);
      font-size: 0.9rem;
    }
  </style>
</head>
<body>

  <!-- 上部ヘッダー（スリム固定） -->
  <header class="app-header">
    <div class="header-top">
      <div class="brand-title">
        <span>🌿</span>
        <span>Daily Companion</span>
      </div>
      <div class="header-actions">
        <button class="icon-btn" onclick="loadData()" title="最新状態に更新">↻ 更新</button>
      </div>
    </div>
  </header>

  <!-- メインコンテンツ領域 -->
  <main class="container">
    <!-- 認証・初期接続画面（未設定時のみ表示） -->
    <div id="authSection" style="display:none; margin-top: 24px;">
      <div class="memory-card">
        <div class="memory-title" style="margin-bottom:8px;">🔒 オーナー接続確認</div>
        <p style="font-size:0.84rem; color:var(--text-sub); margin-top:0; line-height:1.5;">
          LINEのリッチメニューから開くと自動で接続されます。<br>
          手動で接続する場合は以下を入力してください（一度入力するとこの端末に記憶されます）。
        </p>
        <div id="apiUrlGroup" class="form-group" style="display:none; margin-bottom:10px;">
          <label class="form-label">GAS ウェブアプリURL（/exec）</label>
          <input type="url" id="apiUrlInput" class="organic-input" style="width:100%;" placeholder="https://script.google.com/macros/s/.../exec">
        </div>
        <div class="form-group" style="margin-bottom:10px;">
          <label class="form-label">アクセスキー（またはLINE User IDの末尾6文字）</label>
          <div class="quick-add-row">
            <input type="password" id="authKeyInput" class="organic-input" style="flex:1;" placeholder="LINE User IDの末尾6文字...">
            <button class="btn-primary" onclick="submitAuthKey()">接続して開く</button>
          </div>
        </div>
        <p id="authErrorMsg" style="color:var(--terracotta); font-size:0.8rem; margin-bottom:0; display:none;"></p>
      </div>
    </div>

    <!-- ロード中表示 -->
    <div id="loadingView" class="loading-spinner">
      🌱 スプレッドシートからデータを読み込んでいます...
    </div>

    <!-- 1. タスクタブ -->
    <section id="tab-tasks" class="tab-panel" style="display:none;">
      <div class="toolbar">
        <div class="section-summary" id="taskSummaryText">未完了タスク</div>
        <div class="view-toggle">
          <button id="btnViewGroup" class="active" onclick="setTaskViewMode('group')">📂 グループ別</button>
          <button id="btnViewFlat" onclick="setTaskViewMode('flat')">📅 締切順</button>
        </div>
      </div>

      <!-- プレフィックス絞り込みピルバー -->
      <div id="prefixPillBar" class="pill-bar"></div>

      <!-- タスク一覧描画先 -->
      <div id="taskListContainer"></div>

      <!-- 本日完了したタスク（控えめに下部表示） -->
      <div id="completedTodayContainer" style="margin-top:24px;"></div>

      <button class="fab-btn" onclick="openTaskModal()">＋ タスク追加</button>
    </section>

    <!-- 2. 買い物タブ -->
    <section id="tab-shopping" class="tab-panel" style="display:none;">
      <div class="quick-add-box">
        <div class="form-label">🛒 買い物リストにサッと追加</div>
        <div class="quick-add-row">
          <input type="text" id="shopItemInput" class="organic-input" style="flex:2; min-width:140px;" placeholder="品名（例：牛乳、コーヒー豆）">
          <select id="shopCategorySelect" class="organic-select" style="flex:1; min-width:95px;">
            <option value="食品">🥦 食品</option>
            <option value="日用品">🧻 日用品</option>
            <option value="機材・音楽">🎸 機材・音楽</option>
            <option value="その他">📦 その他</option>
          </select>
          <button class="btn-primary" onclick="addShoppingItem()">追加</button>
        </div>
      </div>
      <div id="shoppingListContainer"></div>
    </section>

    <!-- 3. インプットストックタブ -->
    <section id="tab-input" class="tab-panel" style="display:none;">
      <div class="quick-add-box">
        <div class="form-label">💡 気になる作品をストック</div>
        <div class="quick-add-row" style="margin-bottom:8px;">
          <select id="inputTypeSelect" class="organic-select" style="width:110px;">
            <option value="映画">🎬 映画</option>
            <option value="音楽">🎵 音楽</option>
            <option value="本">📚 本</option>
            <option value="ゲーム">🎮 ゲーム</option>
            <option value="その他">✨ その他</option>
          </select>
          <input type="text" id="inputTitleInput" class="organic-input" style="flex:1;" placeholder="作品タイトル...">
        </div>
        <div class="quick-add-row">
          <input type="text" id="inputMemoInput" class="organic-input" style="flex:1;" placeholder="メモ（気になっている理由・おすすめ元など）">
          <button class="btn-primary" onclick="addInputItem()">追加</button>
        </div>
      </div>

      <div id="inputTypePillBar" class="pill-bar"></div>
      <div id="inputListContainer"></div>
    </section>

    <!-- 4. 周期・記憶タブ -->
    <section id="tab-memory" class="tab-panel" style="display:none;">
      <!-- 周期メンテナンススタンプ -->
      <div class="toolbar">
        <div class="section-summary">🔄 周期メンテナンス</div>
      </div>
      <div id="stampGridContainer" class="stamp-grid"></div>

      <div class="quick-add-box" style="margin-bottom:24px;">
        <div class="form-label">＋ 新しい周期記録を追加・更新</div>
        <div class="quick-add-row">
          <input type="text" id="newStampLabel" class="organic-input" style="flex:1;" placeholder="例：ギター弦交換、美容院、シーツ洗濯">
          <button class="btn-primary" onclick="addNewCycleStamp()">今日実施で記録</button>
        </div>
      </div>

      <!-- 定期ルーティン一覧 -->
      <div class="memory-card">
        <div class="memory-header">
          <div class="memory-title">🌱 登録済み定期ルーティン</div>
        </div>
        <div id="routineListContainer"></div>
      </div>

      <!-- 用語辞書 -->
      <div class="memory-card">
        <div class="memory-header">
          <div class="memory-title">📚 用語辞書</div>
          <button class="icon-btn" onclick="openMemoryEditModal('dictionary', '用語辞書')">✎ 編集</button>
        </div>
        <div id="memDictionary" class="memory-content"></div>
      </div>

      <!-- プロフィール -->
      <div class="memory-card">
        <div class="memory-header">
          <div class="memory-title">👤 プロフィール</div>
          <button class="icon-btn" onclick="openMemoryEditModal('profile', 'プロフィール')">✎ 編集</button>
        </div>
        <div id="memProfile" class="memory-content"></div>
      </div>

      <!-- 最近の関心・ログ -->
      <div class="memory-card">
        <div class="memory-header">
          <div class="memory-title">🌊 最近の関心・ログ</div>
          <button class="icon-btn" onclick="openMemoryEditModal('rolling_memory', '最近の関心・ログ')">✎ 編集</button>
        </div>
        <div id="memRolling" class="memory-content"></div>
      </div>

      <!-- 週間サマリー -->
      <div class="memory-card">
        <div class="memory-header">
          <div class="memory-title">🍵 体調・睡眠サマリー</div>
        </div>
        <div id="memWeekly" class="memory-content"></div>
      </div>
    </section>
  </main>

  <!-- 下部タブナビゲーション -->
  <nav class="bottom-nav">
    <button class="nav-item" id="nav-tasks" onclick="switchTab('tasks')">
      <span class="nav-icon">🌿</span>
      <span class="nav-label">タスク</span>
      <span class="nav-badge" id="badge-tasks" style="display:none;">0</span>
    </button>
    <button class="nav-item" id="nav-shopping" onclick="switchTab('shopping')">
      <span class="nav-icon">🛒</span>
      <span class="nav-label">買い物</span>
      <span class="nav-badge" id="badge-shopping" style="display:none;">0</span>
    </button>
    <button class="nav-item" id="nav-input" onclick="switchTab('input')">
      <span class="nav-icon">💡</span>
      <span class="nav-label">ストック</span>
      <span class="nav-badge" id="badge-input" style="display:none;">0</span>
    </button>
    <button class="nav-item" id="nav-memory" onclick="switchTab('memory')">
      <span class="nav-icon">📖</span>
      <span class="nav-label">周期・記憶</span>
    </button>
  </nav>

  <!-- トースト通知 -->
  <div id="toastBar" class="toast-bar">
    <span id="toastText">完了しました</span>
    <button id="toastUndoBtn" class="toast-undo" style="display:none;">元に戻す</button>
  </div>

  <!-- タスク追加モーダル -->
  <div id="taskModal" class="modal-backdrop" onclick="if(event.target===this) closeTaskModal()">
    <div class="modal-sheet">
      <div class="modal-header">
        <div class="modal-title">🌿 新しいタスクを追加</div>
        <button class="icon-btn" onclick="closeTaskModal()">✕ 閉じる</button>
      </div>
      <div class="form-group">
        <label class="form-label">プロジェクト / プレフィックス</label>
        <div id="modalPrefixSuggestions" class="pill-bar" style="padding-bottom:6px;"></div>
        <input type="text" id="newTaskPrefix" class="organic-input" style="width:100%;" placeholder="例：生活伴走システム、音楽制作、プライベート">
      </div>
      <div class="form-group">
        <label class="form-label">タスク内容 *</label>
        <input type="text" id="newTaskTitle" class="organic-input" style="width:100%;" placeholder="具体的なタスク内容（時間指定は末尾に（〜18:00）など）">
      </div>
      <div class="form-group">
        <label class="form-label">期限（任意・長期や期限なしなら空欄でOK）</label>
        <input type="date" id="newTaskDueDate" class="organic-input" style="width:100%;">
      </div>
      <div class="form-group">
        <label class="form-label">メモ（任意）</label>
        <input type="text" id="newTaskMemo" class="organic-input" style="width:100%;" placeholder="補足メモ...">
      </div>
      <button class="btn-primary" style="width:100%; padding:12px; font-size:0.95rem;" onclick="submitNewTask()">タスクを登録する</button>
    </div>
  </div>

  <!-- メモリー編集モーダル -->
  <div id="memoryEditModal" class="modal-backdrop" onclick="if(event.target===this) closeMemoryEditModal()">
    <div class="modal-sheet">
      <div class="modal-header">
        <div class="modal-title" id="memoryModalTitle">編集</div>
        <button class="icon-btn" onclick="closeMemoryEditModal()">✕ 閉じる</button>
      </div>
      <div class="form-group">
        <textarea id="memoryModalTextarea" class="organic-textarea" style="width:100%; height:260px; line-height:1.6;"></textarea>
      </div>
      <button class="btn-primary" style="width:100%; padding:12px;" onclick="saveMemoryField()">保存する</button>
    </div>
  </div>

  <script>
    const INITIAL_TAB = ${JSON.stringify(initialTab || 'tasks')};
    const SERVER_PRE_KEY = ${JSON.stringify(validKey || '')};
    const SERVER_LIFF_ID = ${JSON.stringify(liffId || '')};

    function normalizeLiffId(raw) {
      if (!raw) return '';
      var s = String(raw).trim();
      var liffPrefix = 'https://liff.line.me/';
      var miniPrefix = 'https://miniapp.line.me/';
      if (s.indexOf(liffPrefix) === 0) s = s.substring(liffPrefix.length);
      if (s.indexOf(miniPrefix) === 0) s = s.substring(miniPrefix.length);
      s = s.split('?')[0];
      while (s.charAt(s.length - 1) === '/') s = s.slice(0, -1);
      return s;
    }

    function getEffectiveParams() {
      var result = {};
      var parseQuery = function(qStr) {
        if (!qStr) return;
        var clean = qStr;
        while (clean.charAt(0) === '?' || clean.charAt(0) === '/' || clean.charAt(0) === '#') {
          clean = clean.substring(1);
        }
        var sp = new URLSearchParams(clean);
        var entries = Array.from(sp.entries());
        for (var i = 0; i < entries.length; i++) {
          var k = entries[i][0];
          var v = entries[i][1];
          if (v && !result[k]) {
            result[k] = v;
          }
        }
        var nested = sp.get('liff.state');
        if (nested) {
          var qIdx = nested.indexOf('?');
          if (qIdx >= 0) {
            parseQuery(nested.substring(qIdx + 1));
          } else {
            parseQuery(nested);
          }
        }
      };

      parseQuery(window.location.search);
      if (window.location.hash && window.location.hash.indexOf('=') >= 0) {
        parseQuery(window.location.hash);
      }
      return result;
    }

    const urlParams = getEffectiveParams();

    let state = {
      authKey: urlParams.key || SERVER_PRE_KEY || localStorage.getItem('companion_auth_key') || '',
      apiUrl: urlParams.api || localStorage.getItem('companion_api_url') || '',
      liffId: normalizeLiffId(urlParams.liffId || SERVER_LIFF_ID || localStorage.getItem('companion_liff_id') || ''),
      activeTab: urlParams.tab || INITIAL_TAB || 'tasks',
      taskViewMode: 'group', // 'group' | 'flat'
      selectedPrefix: 'ALL',
      selectedInputType: 'ALL',
      data: null,
      editingMemoryKey: null,
      toastTimer: null
    };

    function isGasEnvironment() {
      return Boolean(window.google && google.script && google.script.run);
    }

    function syncParamsFromUrl() {
      const p = getEffectiveParams();
      if (p.key) {
        state.authKey = p.key.trim();
        localStorage.setItem('companion_auth_key', state.authKey);
      }
      if (p.api) {
        state.apiUrl = p.api.trim();
        localStorage.setItem('companion_api_url', state.apiUrl);
      }
      if (p.liffId) {
        state.liffId = normalizeLiffId(p.liffId);
        if (state.liffId) localStorage.setItem('companion_liff_id', state.liffId);
      }
      if (p.tab && ['tasks', 'shopping', 'input', 'memory'].includes(p.tab)) {
        state.activeTab = p.tab;
      }
    }

    window.addEventListener('DOMContentLoaded', () => {
      syncParamsFromUrl();
      if (state.authKey) localStorage.setItem('companion_auth_key', state.authKey);
      if (state.apiUrl) localStorage.setItem('companion_api_url', state.apiUrl);
      if (state.liffId) localStorage.setItem('companion_liff_id', state.liffId);

      const p = initLiff();
      if (p) p.catch(() => {});

      switchTab(state.activeTab, true);

      const needsApiUrl = !isGasEnvironment() && !state.apiUrl;
      const needsAuthKey = !state.authKey;

      if (needsApiUrl || needsAuthKey) {
        document.getElementById('loadingView').style.display = 'none';
        showAuthForm();
      } else {
        loadData();
      }
    });

    function showAuthForm(errorMessage) {
      document.getElementById('authSection').style.display = 'block';
      const apiGroup = document.getElementById('apiUrlGroup');
      const apiInput = document.getElementById('apiUrlInput');
      const keyInput = document.getElementById('authKeyInput');

      if (!isGasEnvironment()) {
        apiGroup.style.display = 'block';
        if (state.apiUrl && !apiInput.value) apiInput.value = state.apiUrl;
      } else {
        apiGroup.style.display = 'none';
      }
      if (state.authKey && !keyInput.value) {
        keyInput.value = state.authKey;
      }

      const errEl = document.getElementById('authErrorMsg');
      if (errorMessage) {
        errEl.textContent = errorMessage;
        errEl.style.display = 'block';
      } else {
        errEl.style.display = 'none';
      }
    }

    let isLiffReady = false;
    let liffInitPromise = null;

    function initLiff() {
      if (!window.liff || !state.liffId) return null;
      if (!liffInitPromise) {
        liffInitPromise = liff.init({ liffId: state.liffId })
          .then(() => {
            isLiffReady = true;
            syncParamsFromUrl();
            console.log('LIFF initialized. isInClient:', liff.isInClient(), 'isLoggedIn:', liff.isLoggedIn());
          })
          .catch(err => {
            liffInitPromise = null;
            console.warn('LIFF initialization error:', err);
            throw err;
          });
      }
      return liffInitPromise;
    }

    function sendLiffMessage(text) {
      if (!text) return;
      if (!window.liff || !state.liffId) {
        console.log('LIFF is not configured or not loaded.');
        return;
      }

      const p = initLiff();
      if (!p) return;

      p.then(() => {
        if (!liff.isInClient()) {
          console.log('Not in LINE client (opened in external browser). Skipping chat message.');
          return;
        }
        return liff.sendMessages([{ type: 'text', text: text }]);
      })
        .then(() => {
          console.log('LIFF message sent to talk room:', text);
        })
        .catch(err => {
          console.error('LIFF sendMessages error:', err);
          showToast('LINE送信エラー: ' + (err && err.message ? err.message : '権限不足'));
        });
    }

    function callServerApi(funcName, ...args) {
      return new Promise((resolve, reject) => {
        if (isGasEnvironment()) {
          google.script.run
            .withSuccessHandler(res => resolve(res))
            .withFailureHandler(err => reject(err))
            [funcName](...args);
          return;
        }

        if (!state.apiUrl) {
          reject(new Error('GAS ウェブアプリURLが設定されていません'));
          return;
        }

        fetch(state.apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain;charset=utf-8'
          },
          body: JSON.stringify({
            apiAction: funcName,
            args: args
          }),
          redirect: 'follow'
        })
          .then(response => {
            if (!response.ok) {
              throw new Error('HTTPエラー: ' + response.status);
            }
            return response.json();
          })
          .then(json => {
            if (json && json.ok === false) {
              throw new Error(json.error || 'サーバーエラーが発生しました');
            }
            resolve(json && json.ok === true ? json.data : json);
          })
          .catch(err => reject(err));
      });
    }

    function submitAuthKey() {
      const apiInput = document.getElementById('apiUrlInput');
      const keyInput = document.getElementById('authKeyInput');
      const apiVal = apiInput ? apiInput.value.trim() : '';
      const keyVal = keyInput ? keyInput.value.trim() : '';

      if (!isGasEnvironment()) {
        if (apiVal) {
          state.apiUrl = apiVal;
          localStorage.setItem('companion_api_url', apiVal);
        }
        if (!state.apiUrl) {
          showAuthForm('GAS ウェブアプリURL（https://script.google.com/macros/s/.../exec）を入力してください');
          return;
        }
      }

      if (keyVal) {
        state.authKey = keyVal;
        localStorage.setItem('companion_auth_key', keyVal);
      }
      if (!state.authKey) {
        showAuthForm('アクセスキー（またはLINE User IDの末尾6文字）を入力してください');
        return;
      }

      document.getElementById('authErrorMsg').style.display = 'none';
      loadData();
    }

    window.addEventListener('error', function(e) {
      var lv = document.getElementById('loadingView');
      if (lv) lv.style.display = 'none';
      console.error('Global error:', e.error || e.message);
    });

    function loadData() {
      document.getElementById('loadingView').style.display = 'block';
      var finished = false;
      var timeoutId = setTimeout(function() {
        if (!finished) {
          finished = true;
          document.getElementById('loadingView').style.display = 'none';
          showAuthForm('タイムアウト: サーバーからの応答がありません。GASのWebアプリURLが最新版でデプロイされているかご確認ください。');
        }
      }, 15000);

      callServerApi('apiGetDashboardData', state.authKey)
        .then(function(res) {
          if (finished) return;
          finished = true;
          clearTimeout(timeoutId);
          document.getElementById('loadingView').style.display = 'none';
          if (!res || !res.authorized) {
            showAuthForm((res && res.error) ? res.error : '認証に失敗しました');
            return;
          }
          if (res.validKey) {
            state.authKey = res.validKey;
            localStorage.setItem('companion_auth_key', res.validKey);
          }
          if (res.liffId) {
            var cleanId = normalizeLiffId(res.liffId);
            if (cleanId && cleanId !== state.liffId) {
              state.liffId = cleanId;
              localStorage.setItem('companion_liff_id', cleanId);
              var lp = initLiff();
              if (lp) lp.catch(function() {});
            } else if (cleanId && !isLiffReady) {
              var lp = initLiff();
              if (lp) lp.catch(function() {});
            }
          }
          document.getElementById('authSection').style.display = 'none';
          state.data = res;
          renderAll();
        })
        .catch(function(err) {
          if (finished) return;
          finished = true;
          clearTimeout(timeoutId);
          document.getElementById('loadingView').style.display = 'none';
          showAuthForm('通信エラー: ' + (err.message || err));
          showToast('読み込みエラー: ' + (err.message || err));
        });
    }

    function switchTab(tabName, skipRender) {
      const validTabs = ['tasks', 'shopping', 'input', 'memory'];
      if (!validTabs.includes(tabName)) tabName = 'tasks';
      state.activeTab = tabName;

      validTabs.forEach(t => {
        const panel = document.getElementById('tab-' + t);
        const nav = document.getElementById('nav-' + t);
        if (panel) panel.style.display = (t === tabName && state.data) ? 'block' : 'none';
        if (nav) nav.classList.toggle('active', t === tabName);
      });

      if (!skipRender && state.data) {
        renderAll();
      }
    }

    function renderAll() {
      if (!state.data) return;
      switchTab(state.activeTab, true);

      // バッジ件数更新
      const uncompletedTasks = (state.data.tasks || []).filter(t => t.status === '未完了');
      const unboughtShop = (state.data.shopping || []).filter(s => s.status === '未買');
      const pendingInput = (state.data.inputStock || []).filter(i => i.status === '未');

      updateNavBadge('badge-tasks', uncompletedTasks.length);
      updateNavBadge('badge-shopping', unboughtShop.length);
      updateNavBadge('badge-input', pendingInput.length);

      renderTasks();
      renderShopping();
      renderInputStock();
      renderMemoryAndCycles();
    }

    function updateNavBadge(id, count) {
      const el = document.getElementById(id);
      if (!el) return;
      if (count > 0) {
        el.textContent = count;
        el.style.display = 'inline-block';
      } else {
        el.style.display = 'none';
      }
    }

    // ==========================================
    // 1. タスク描画（プレフィックス別グループ ＆ 直近締切優先）
    // ==========================================
    function sortTasksByDuePriority(list) {
      return list.slice().sort((a, b) => {
        // 期限ありを優先し、期限が近い順（昇順）
        const aHasDue = Boolean(a.dueDate);
        const bHasDue = Boolean(b.dueDate);
        if (aHasDue && bHasDue) {
          if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        } else if (aHasDue && !bHasDue) {
          return -1;
        } else if (!aHasDue && bHasDue) {
          return 1;
        }
        // 期限が同じ・または両方期限なしの場合は登録日が古い（長期残っている）順または行順
        return (b.elapsedDays || 0) - (a.elapsedDays || 0);
      });
    }

    function setTaskViewMode(mode) {
      state.taskViewMode = mode;
      document.getElementById('btnViewGroup').classList.toggle('active', mode === 'group');
      document.getElementById('btnViewFlat').classList.toggle('active', mode === 'flat');
      renderTasks();
    }

    function selectPrefixFilter(prefix) {
      state.selectedPrefix = prefix;
      renderTasks();
    }

    function renderTasks() {
      const allTasks = state.data.tasks || [];
      const activeTasks = allTasks.filter(t => t.status === '未完了');
      const completedToday = allTasks.filter(t => t.status === '完了');

      document.getElementById('taskSummaryText').textContent =
        '未完了タスク（全 ' + activeTasks.length + ' 件）';

      // プレフィックス集計
      const prefixCounts = {};
      activeTasks.forEach(t => {
        const p = t.prefix || 'その他';
        prefixCounts[p] = (prefixCounts[p] || 0) + 1;
      });

      const prefixes = Object.keys(prefixCounts);
      if (state.selectedPrefix !== 'ALL' && !prefixCounts[state.selectedPrefix]) {
        state.selectedPrefix = 'ALL';
      }

      // ピルバー描画
      const pillBar = document.getElementById('prefixPillBar');
      let pillHtml = '<button class="filter-pill ' + (state.selectedPrefix === 'ALL' ? 'active' : '') + '" onclick="selectPrefixFilter(\\'ALL\\')">すべて <span class="count">' + activeTasks.length + '</span></button>';
      prefixes.forEach(p => {
        const isAct = state.selectedPrefix === p ? 'active' : '';
        pillHtml += '<button class="filter-pill ' + isAct + '" onclick="selectPrefixFilter(' + JSON.stringify(p).replace(/"/g, '&quot;') + ')">' + escapeHtml(p) + ' <span class="count">' + prefixCounts[p] + '</span></button>';
      });
      pillBar.innerHTML = pillHtml;

      // 絞り込み適用
      const filtered = state.selectedPrefix === 'ALL'
        ? activeTasks
        : activeTasks.filter(t => (t.prefix || 'その他') === state.selectedPrefix);

      const container = document.getElementById('taskListContainer');
      if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state">🌿 未完了のタスクはありません。穏やかな一日をお過ごしください。</div>';
      } else if (state.taskViewMode === 'flat') {
        // フラットな締切順一覧
        const sorted = sortTasksByDuePriority(filtered);
        container.innerHTML = '<div class="card-list">' + sorted.map(t => buildTaskCardHtml(t, true)).join('') + '</div>';
      } else {
        // プレフィックスごとのグループ表示（グループ内は直近締切順、グループ自体も最短締切順）
        const groupsMap = {};
        filtered.forEach(t => {
          const p = t.prefix || 'その他';
          if (!groupsMap[p]) groupsMap[p] = [];
          groupsMap[p].push(t);
        });

        const groupKeys = Object.keys(groupsMap).map(k => {
          const sortedItems = sortTasksByDuePriority(groupsMap[k]);
          const earliestDue = sortedItems.find(item => Boolean(item.dueDate));
          return {
            prefix: k,
            items: sortedItems,
            earliestDueDate: earliestDue ? earliestDue.dueDate : '9999-99-99'
          };
        }).sort((a, b) => {
          if (a.earliestDueDate !== b.earliestDueDate) {
            return a.earliestDueDate.localeCompare(b.earliestDueDate);
          }
          return b.items.length - a.items.length;
        });

        let groupsHtml = '';
        groupKeys.forEach(g => {
          groupsHtml += '<div class="group-section">' +
            '<div class="group-header">' +
              '<div class="group-title"><span class="group-dot"></span>' + escapeHtml(g.prefix) + '</div>' +
              '<span class="group-badge">' + g.items.length + '件</span>' +
            '</div>' +
            '<div class="card-list">' +
              g.items.map(t => buildTaskCardHtml(t, false)).join('') +
            '</div>' +
          '</div>';
        });
        container.innerHTML = groupsHtml;
      }

      // 本日完了済みセクション
      const compContainer = document.getElementById('completedTodayContainer');
      if (completedToday.length > 0) {
        compContainer.innerHTML =
          '<div class="group-header"><div class="group-title" style="color:var(--text-sub); font-size:0.86rem;">✨ 本日完了したタスク (' + completedToday.length + '件)</div></div>' +
          '<div class="card-list">' + completedToday.map(t => buildTaskCardHtml(t, true)).join('') + '</div>';
      } else {
        compContainer.innerHTML = '';
      }
    }

    function buildTaskCardHtml(t, showPrefixBadge) {
      const isCompleted = t.status === '完了';
      let cardClass = 'item-card';
      if (isCompleted) {
        cardClass += ' completed-card';
      } else if (t.daysUntilDue !== null && t.daysUntilDue <= 0) {
        cardClass += ' urgent';
      } else if (t.daysUntilDue !== null && t.daysUntilDue <= 3) {
        cardClass += ' soon';
      }

      // 期限バッジ生成
      let dueBadge = '';
      if (t.dueDate) {
        if (t.daysUntilDue < 0) {
          dueBadge = '<span class="badge badge-urgent">📅 期限超過 (' + escapeHtml(formatShortDate(t.dueDate)) + ')</span>';
        } else if (t.daysUntilDue === 0) {
          dueBadge = '<span class="badge badge-urgent">📅 今日締切 (' + escapeHtml(formatShortDate(t.dueDate)) + ')</span>';
        } else if (t.daysUntilDue === 1) {
          dueBadge = '<span class="badge badge-soon">📅 明日 (' + escapeHtml(formatShortDate(t.dueDate)) + ')</span>';
        } else if (t.daysUntilDue <= 7) {
          dueBadge = '<span class="badge badge-soon">📅 あと' + t.daysUntilDue + '日 (' + escapeHtml(formatShortDate(t.dueDate)) + ')</span>';
        } else {
          dueBadge = '<span class="badge badge-normal">📅 ' + escapeHtml(formatShortDate(t.dueDate)) + '</span>';
        }
      } else {
        dueBadge = '<span class="badge badge-normal">⏳ 期限なし</span>';
      }

      // 時間ヒントバッジ
      const timeBadge = t.timeHint
        ? '<span class="badge badge-urgent">⏰ ' + escapeHtml(t.timeHint) + '</span>'
        : '';

      // プレフィックスバッジ（フラット表示時）
      const prefixBadge = (showPrefixBadge && t.prefix)
        ? '<span class="badge badge-prefix">' + escapeHtml(t.prefix) + '</span>'
        : '';

      // 長期熟成バッジ（登録から7日以上経過）
      const agedBadge = (!isCompleted && t.elapsedDays >= 7)
        ? '<span class="badge badge-aged">🌱 登録から' + t.elapsedDays + '日</span>'
        : '';

      const memoHtml = t.memo
        ? '<div class="card-memo">' + escapeHtml(t.memo) + '</div>'
        : '';

      const nextStatus = isCompleted ? '未完了' : '完了';

      return '<div class="' + cardClass + '" id="task-card-' + escapeHtml(t.id) + '">' +
        '<button class="circle-check ' + (isCompleted ? 'checked' : '') + '" onclick="toggleTaskStatus(' + JSON.stringify(t.id).replace(/"/g, '&quot;') + ', ' + JSON.stringify(nextStatus).replace(/"/g, '&quot;') + ')" title="完了切替">✓</button>' +
        '<div class="card-body">' +
          '<div class="card-title-row">' +
            '<div class="card-title">' + escapeHtml(t.cleanTitle || t.fullTitle) + '</div>' +
          '</div>' +
          '<div class="card-meta">' +
            prefixBadge + dueBadge + timeBadge + agedBadge +
          '</div>' +
          memoHtml +
        '</div>' +
      '</div>';
    }

    function toggleTaskStatus(taskId, newStatus) {
      const cardEl = document.getElementById('task-card-' + taskId);
      if (cardEl && newStatus === '完了') {
        cardEl.classList.add('completing');
        const btn = cardEl.querySelector('.circle-check');
        if (btn) btn.classList.add('checked');
      }

      setTimeout(() => {
        // ローカル状態を即時反映
        const target = (state.data.tasks || []).find(t => t.id === taskId);
        if (target) {
          target.status = newStatus;
          target.completedDate = (newStatus === '完了') ? state.data.todayStr : '';
          renderAll();
        }

        if (newStatus === '完了') {
          showToast('🌿 タスクを完了しました', () => {
            toggleTaskStatus(taskId, '未完了');
          });
          if (target) {
            sendLiffMessage('✅ 「' + (target.cleanTitle || target.fullTitle) + '」を完了したよ');
          }
        } else {
          showToast('タスクを未完了に戻しました');
        }

        callServerApi('apiUpdateTaskStatus', state.authKey, taskId, newStatus)
          .catch(err => {
            showToast('更新失敗: ' + (err.message || err));
            loadData();
          });
      }, newStatus === '完了' ? 260 : 50);
    }

    function openTaskModal() {
      const activeTasks = (state.data && state.data.tasks) ? state.data.tasks.filter(t => t.status === '未完了') : [];
      const prefixes = Array.from(new Set(activeTasks.map(t => t.prefix).filter(Boolean)));
      const defaultPrefixes = ['生活伴走システム', '音楽制作', 'プライベート', '家事・生活'];
      defaultPrefixes.forEach(dp => {
        if (!prefixes.includes(dp)) prefixes.push(dp);
      });

      const sugBar = document.getElementById('modalPrefixSuggestions');
      sugBar.innerHTML = prefixes.map(p =>
        '<button type="button" class="filter-pill" onclick="document.getElementById(\\'newTaskPrefix\\').value=' + JSON.stringify(p).replace(/"/g, '&quot;') + '">' + escapeHtml(p) + '</button>'
      ).join('');

      if (state.selectedPrefix && state.selectedPrefix !== 'ALL') {
        document.getElementById('newTaskPrefix').value = state.selectedPrefix;
      }
      document.getElementById('taskModal').classList.add('open');
    }

    function closeTaskModal() {
      document.getElementById('taskModal').classList.remove('open');
    }

    function submitNewTask() {
      const prefix = document.getElementById('newTaskPrefix').value.trim();
      const title = document.getElementById('newTaskTitle').value.trim();
      const dueDate = document.getElementById('newTaskDueDate').value.trim();
      const memo = document.getElementById('newTaskMemo').value.trim();

      if (!title) {
        showToast('タスク内容を入力してください');
        return;
      }

      closeTaskModal();
      showToast('🌱 タスクを追加しています...');

      callServerApi('apiAddTask', state.authKey, { prefix, title, dueDate, memo })
        .then(() => {
          document.getElementById('newTaskTitle').value = '';
          document.getElementById('newTaskDueDate').value = '';
          document.getElementById('newTaskMemo').value = '';
          showToast('🌿 タスクを追加しました');
          loadData();
        })
        .catch(err => {
          showToast('追加エラー: ' + (err.message || err));
        });
    }

    // ==========================================
    // 2. 買い物リスト描画
    // ==========================================
    function renderShopping() {
      const list = (state.data.shopping || []).filter(s => s.status === '未買');
      const container = document.getElementById('shoppingListContainer');

      if (list.length === 0) {
        container.innerHTML = '<div class="empty-state">🛒 買うものリストは空です。</div>';
        return;
      }

      const byCat = {};
      list.forEach(item => {
        const c = item.category || '日用品';
        if (!byCat[c]) byCat[c] = [];
        byCat[c].push(item);
      });

      let html = '';
      Object.keys(byCat).forEach(cat => {
        html += '<div class="group-section">' +
          '<div class="group-header">' +
            '<div class="group-title"><span class="group-dot"></span>' + escapeHtml(cat) + '</div>' +
            '<span class="group-badge">' + byCat[cat].length + '件</span>' +
          '</div>' +
          '<div class="card-list">' +
            byCat[cat].map(item =>
              '<div class="item-card" id="shop-card-' + item.rowIndex + '">' +
                '<button class="circle-check" onclick="completeShopping(' + item.rowIndex + ')">✓</button>' +
                '<div class="card-body">' +
                  '<div class="card-title">' + escapeHtml(item.item) + '</div>' +
                  (item.createdDate ? '<div class="card-meta"><span class="badge badge-normal">登録: ' + escapeHtml(formatShortDate(item.createdDate)) + '</span></div>' : '') +
                '</div>' +
              '</div>'
            ).join('') +
          '</div>' +
        '</div>';
      });
      container.innerHTML = html;
    }

    function completeShopping(rowIndex) {
      const card = document.getElementById('shop-card-' + rowIndex);
      if (card) {
        card.classList.add('completing');
        const btn = card.querySelector('.circle-check');
        if (btn) btn.classList.add('checked');
      }

      setTimeout(() => {
        const target = (state.data.shopping || []).find(s => s.rowIndex === rowIndex);
        if (target) {
          target.status = '購入済';
          renderAll();
          sendLiffMessage('🛒 「' + target.item + '」を購入したよ');
        }
        showToast('🛒 購入済みにしました', () => {
          callServerApi('apiUpdateShoppingStatus', state.authKey, rowIndex, '未買').then(() => loadData());
        });
        callServerApi('apiUpdateShoppingStatus', state.authKey, rowIndex, '購入済')
          .catch(() => loadData());
      }, 240);
    }

    function addShoppingItem() {
      const itemInput = document.getElementById('shopItemInput');
      const catSelect = document.getElementById('shopCategorySelect');
      const item = itemInput.value.trim();
      const category = catSelect.value;
      if (!item) return;

      itemInput.value = '';
      showToast('🛒 追加しています...');
      callServerApi('apiAddShoppingItem', state.authKey, item, category)
        .then(() => {
          showToast('🛒 買い物リストに追加しました');
          loadData();
        })
        .catch(err => showToast('エラー: ' + (err.message || err)));
    }

    // ==========================================
    // 3. インプットストック描画
    // ==========================================
    function selectInputType(type) {
      state.selectedInputType = type;
      renderInputStock();
    }

    function renderInputStock() {
      const all = (state.data.inputStock || []).filter(i => i.status === '未');
      const typeCounts = {};
      all.forEach(i => {
        const t = i.type || 'その他';
        typeCounts[t] = (typeCounts[t] || 0) + 1;
      });

      const pillBar = document.getElementById('inputTypePillBar');
      let pillHtml = '<button class="filter-pill ' + (state.selectedInputType === 'ALL' ? 'active' : '') + '" onclick="selectInputType(\\'ALL\\')">すべて <span class="count">' + all.length + '</span></button>';
      Object.keys(typeCounts).forEach(t => {
        const isAct = state.selectedInputType === t ? 'active' : '';
        pillHtml += '<button class="filter-pill ' + isAct + '" onclick="selectInputType(' + JSON.stringify(t).replace(/"/g, '&quot;') + ')">' + escapeHtml(t) + ' <span class="count">' + typeCounts[t] + '</span></button>';
      });
      pillBar.innerHTML = pillHtml;

      const filtered = state.selectedInputType === 'ALL'
        ? all
        : all.filter(i => (i.type || 'その他') === state.selectedInputType);

      const container = document.getElementById('inputListContainer');
      if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state">💡 ストックされている作品はありません。</div>';
        return;
      }

      container.innerHTML = '<div class="card-list">' + filtered.map(item =>
        '<div class="item-card" id="input-card-' + item.rowIndex + '">' +
          '<button class="circle-check" onclick="completeInputStock(' + item.rowIndex + ')">✓</button>' +
          '<div class="card-body">' +
            '<div class="card-title">' + escapeHtml(item.title) + '</div>' +
            '<div class="card-meta">' +
              '<span class="badge badge-prefix">' + escapeHtml(item.type || '作品') + '</span>' +
            '</div>' +
            (item.memo ? '<div class="card-memo">' + escapeHtml(item.memo) + '</div>' : '') +
          '</div>' +
        '</div>'
      ).join('') + '</div>';
    }

    function completeInputStock(rowIndex) {
      const card = document.getElementById('input-card-' + rowIndex);
      if (card) {
        card.classList.add('completing');
        const btn = card.querySelector('.circle-check');
        if (btn) btn.classList.add('checked');
      }

      setTimeout(() => {
        const target = (state.data.inputStock || []).find(i => i.rowIndex === rowIndex);
        if (target) {
          target.status = '完';
          renderAll();
          sendLiffMessage('💡 「' + target.title + '」(' + (target.type || '作品') + ')を消化・鑑賞したよ');
        }
        showToast('✨ 鑑賞・消化済みにしました', () => {
          callServerApi('apiUpdateInputStatus', state.authKey, rowIndex, '未').then(() => loadData());
        });
        callServerApi('apiUpdateInputStatus', state.authKey, rowIndex, '完')
          .catch(() => loadData());
      }, 240);
    }

    function addInputItem() {
      const type = document.getElementById('inputTypeSelect').value;
      const titleInput = document.getElementById('inputTitleInput');
      const memoInput = document.getElementById('inputMemoInput');
      const title = titleInput.value.trim();
      const memo = memoInput.value.trim();
      if (!title) return;

      titleInput.value = '';
      memoInput.value = '';
      showToast('💡 ストックに追加しています...');
      callServerApi('apiAddInputStock', state.authKey, { type, title, memo })
        .then(() => {
          showToast('💡 ストックに追加しました');
          loadData();
        })
        .catch(err => showToast('エラー: ' + (err.message || err)));
    }

    // ==========================================
    // 4. 周期スタンプ ＆ AI記憶タブ描画
    // ==========================================
    function renderMemoryAndCycles() {
      const mem = state.data.memory || {};
      const stamps = mem.cycle_stamps || [];

      const stampGrid = document.getElementById('stampGridContainer');
      if (stamps.length === 0) {
        stampGrid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">周期スタンプはまだ記録されていません。</div>';
      } else {
        stampGrid.innerHTML = stamps.map(s => {
          const daysText = (s.elapsedDays !== null && s.elapsedDays !== undefined)
            ? (s.elapsedDays === 0 ? '✨ 今日実施' : s.elapsedDays + '日経過')
            : '日付未記録';
          return '<div class="stamp-card">' +
            '<div class="stamp-info">' +
              '<h4>' + escapeHtml(s.label) + '</h4>' +
              '<div class="stamp-days">' + escapeHtml(daysText) + '</div>' +
              '<div class="stamp-date">最終: ' + escapeHtml(s.date || '-') + '</div>' +
            '</div>' +
            '<button class="btn-secondary" onclick="stampToday(' + JSON.stringify(s.label).replace(/"/g, '&quot;') + ')">✨ 今日やった</button>' +
          '</div>';
        }).join('');
      }

      // 定期ルーティン
      const routines = state.data.routines || [];
      const routineEl = document.getElementById('routineListContainer');
      if (routines.length === 0) {
        routineEl.innerHTML = '<div style="font-size:0.84rem; color:var(--text-muted);">登録されているルーティンはありません</div>';
      } else {
        routineEl.innerHTML = '<div class="card-list">' + routines.map(r =>
          '<div style="background:var(--bg-base); padding:10px 12px; border-radius:10px; border:1px solid var(--border-soft); display:flex; justify-content:space-between; align-items:center; gap:8px;">' +
            '<div>' +
              '<div style="font-weight:600; font-size:0.88rem;">' + escapeHtml(r.ruleName) + '</div>' +
              '<div style="font-size:0.75rem; color:var(--text-sub);">設定: ' + escapeHtml(r.type) + ' (' + escapeHtml(r.value) + ') ' + (r.memo ? '｜ ' + escapeHtml(r.memo) : '') + '</div>' +
            '</div>' +
            '<span class="badge badge-normal">最終: ' + escapeHtml(r.lastGeneratedDate || '未') + '</span>' +
          '</div>'
        ).join('') + '</div>';
      }

      document.getElementById('memDictionary').textContent = mem.dictionary || '（未設定）';
      document.getElementById('memProfile').textContent = mem.profile || '（未設定）';
      document.getElementById('memRolling').textContent = mem.rolling_memory || '（未設定）';
      document.getElementById('memWeekly').textContent = mem.weekly_summary || '（未設定）';
    }

    function stampToday(label) {
      showToast('✨ 「' + label + '」を今日の日付で更新中...');
      sendLiffMessage('✨ 「' + label + '」のお手入れ・メンテナンスを実施したよ');
      callServerApi('apiStampCycleItem', state.authKey, label, '')
        .then(() => {
          showToast('🌿 「' + label + '」を今日に更新しました');
          loadData();
        })
        .catch(err => showToast('エラー: ' + (err.message || err)));
    }

    function addNewCycleStamp() {
      const input = document.getElementById('newStampLabel');
      const label = input.value.trim();
      if (!label) return;
      input.value = '';
      stampToday(label);
    }

    function openMemoryEditModal(key, title) {
      state.editingMemoryKey = key;
      document.getElementById('memoryModalTitle').textContent = '✎ ' + title;
      document.getElementById('memoryModalTextarea').value = (state.data.memory && state.data.memory[key]) || '';
      document.getElementById('memoryEditModal').classList.add('open');
    }

    function closeMemoryEditModal() {
      document.getElementById('memoryEditModal').classList.remove('open');
    }

    function saveMemoryField() {
      if (!state.editingMemoryKey) return;
      const val = document.getElementById('memoryModalTextarea').value;
      closeMemoryEditModal();
      showToast('💾 保存しています...');
      callServerApi('apiUpdateMemoryField', state.authKey, state.editingMemoryKey, val)
        .then(() => {
          showToast('🌿 記憶データを更新しました');
          loadData();
        })
        .catch(err => showToast('保存エラー: ' + (err.message || err)));
    }

    // ==========================================
    // ユーティリティ
    // ==========================================
    function formatShortDate(dateStr) {
      if (!dateStr) return '';
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        return parseInt(parts[1], 10) + '/' + parseInt(parts[2], 10);
      }
      return dateStr;
    }

    function escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function showToast(message, undoCallback) {
      const bar = document.getElementById('toastBar');
      const txt = document.getElementById('toastText');
      const undoBtn = document.getElementById('toastUndoBtn');

      txt.textContent = message;
      if (undoCallback) {
        undoBtn.style.display = 'inline-block';
        undoBtn.onclick = () => {
          bar.classList.remove('show');
          undoCallback();
        };
      } else {
        undoBtn.style.display = 'none';
        undoBtn.onclick = null;
      }

      bar.classList.add('show');
      if (state.toastTimer) clearTimeout(state.toastTimer);
      state.toastTimer = setTimeout(() => {
        bar.classList.remove('show');
      }, 4000);
    }
  </script>
</body>
</html>`;
}

// ==========================================
// FILE: src/Webhook.js
// ==========================================

/**
 * Webhook.js - LINE Webhookハンドラー（doPost / doGet）
 * 厳密なユーザー認証、ファースト・ハロー判定、超低遅延Reply、安全な後続データ反映
 */

/**
 * LINEプラットフォームからのWebhook POSTリクエストを受信・処理
 * @param {Object} e イベントオブジェクト
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'empty payload' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const payload = JSON.parse(e.postData.contents);

    // ダッシュボード（GitHub Pages等）からのJSON APIリクエスト処理
    if (payload && payload.apiAction) {
      const apiRes = handleDashboardApiRequest(payload);
      return ContentService.createTextOutput(JSON.stringify(apiRes))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const config = getConfig();
    const events = payload.events || [];

    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      // ----------------------------------------------------
      // 0. セキュリティ: オーナーUser ID検証（他者アクセス遮断）
      // ----------------------------------------------------
      const senderUserId = event.source ? event.source.userId : null;
      if (!senderUserId || senderUserId !== config.ownerUserId) {
        Logger.log(`[セキュリティ遮断] 未許可のUser IDです: ${senderUserId} (設定値: ${config.ownerUserId})。初回設定時はこのUser IDをスクリプトプロパティ OWNER_USER_ID に設定してください。`);
        continue;
      }

      // メッセージ受信イベントのみ対象
      if (event.type !== 'message') continue;

      const messageType = event.message ? event.message.type : '';
      const replyToken = event.replyToken;

      // ----------------------------------------------------
      // 1. 画像イベント（image）: Drive保存 & バッファ蓄積（返答なし）
      // ----------------------------------------------------
      if (messageType === 'image') {
        try {
          const savedImage = downloadLineImageAndSaveToDrive(event.message.id);
          addImageIdToBuffer(savedImage.fileId);
          continue;
        } catch (imgErr) {
          Logger.log('画像処理エラー: ' + imgErr.message);
          replyLineMessage(replyToken, '画像の保存中にエラーが発生しました。もう一度送信してください。');
          continue;
        }
      }

      // ----------------------------------------------------
      // 2. テキストイベント（text）: ファースト・ハロー合流 ＋ 即時返答
      // ----------------------------------------------------
      if (messageType === 'text') {
        const userText = event.message.text ? event.message.text.trim() : '';

        // A. 本日初回発言判定 (ファースト・ハロー)
        // ※朝ブリーフィングは午前04:00〜昼11:59（正午まで）の発言かつ、本日未配信の場合のみ発動
        // ※午後（12:00以降）や夜の発言では絶対に誤発動させない
        const currentHour = new Date().getHours();
        const isMorningTime = currentHour >= 4 && currentHour < 12;
        const isFirstHello = isMorningTime && !isBriefingDeliveredToday();

        // B. 蓄積画像の取得
        const bufferedImages = getBufferedImages();
        const imageBlobs = bufferedImages.blobs;
        const imageUrls = bufferedImages.urls;

        // C. コンテキスト情報の取得 (スプレッドシート & 動的カレンダー)
        const sheetContext = getSpreadsheetContext(userText);
        const calendarContext = getCalendarAndHolidayContext();
        const combinedContext = `${sheetContext}\n\n${calendarContext}`;

        // D. 本日の全会話ログ（極小高密度フォーマット: HH:mm User: ... / AI: ...）の取得
        const todayLogsCondensed = getCondensedTodayLogs();

        // E. Gemini 3.8 Flash 呼び出し（JSON取得）
        let aiResult;
        let isGeminiSuccess = false;
        try {
          aiResult = callGeminiFlash(userText, imageBlobs, combinedContext, todayLogsCondensed, isFirstHello);
          isGeminiSuccess = true;
        } catch (geminiErr) {
          const errStr = String(geminiErr.message || '');
          Logger.log('Gemini呼び出しエラー: ' + errStr);

          let errorReply = '申し訳ありません、システムの処理中にエラーが発生しました。';
          if (errStr.includes('429') || errStr.includes('RESOURCE_EXHAUSTED') || errStr.includes('quota') || errStr.includes('Credit')) {
            errorReply = '【システム通知】Gemini APIのクレジット残高不足、または利用クォータの上限に達しました。\nGoogle AI Studio / Google Cloud コンソールの残高・お支払い情報をご確認ください。';
          } else if (errStr.includes('503') || errStr.includes('UNAVAILABLE') || errStr.includes('high demand')) {
            errorReply = '【システム通知】GoogleのAIサーバーが現在一時的にアクセス集中・混雑しています。\n自動再試行を行いましたが応答が得られませんでした。少し時間を置いてもう一度お話しください。';
          } else if (errStr.includes('401') || errStr.includes('403') || errStr.includes('API key')) {
            errorReply = '【システム通知】Gemini APIキーの認証に失敗しました。\nGASスクリプトプロパティの GEMINI_API_KEY 設定をご確認ください。';
          } else if (errStr.includes('404')) {
            errorReply = '【システム通知】Geminiの指定モデルが見つかりません(404)。\nモデル設定をご確認ください。';
          } else {
            errorReply = `【システム通知】思考エンジンの応答中にエラーが発生しました。\n詳細: ${errStr.substring(0, 100)}`;
          }

          aiResult = {
            reply_text: errorReply,
            system_notification: '',
            task_actions: [],
            calendar_actions: [],
            shopping_actions: [],
            input_stock_actions: [],
            routine_actions: []
          };
        }

        // F. DB・カレンダー操作アクションの即時適用（ブリーフィングおよび返信文へ確実に反映させるため先に実行）
        let replyText = (aiResult.reply_text || '了解いたしました。').trim();
        const executedNotices = [];

        try {
          if (aiResult.task_actions && aiResult.task_actions.length > 0) {
            const taskRes = applyTaskActions(aiResult.task_actions);
            executedNotices.push.apply(executedNotices, taskRes);
          }
          if (aiResult.calendar_actions && aiResult.calendar_actions.length > 0) {
            const calRes = applyCalendarActions(aiResult.calendar_actions);
            executedNotices.push.apply(executedNotices, calRes);
          }
          if (aiResult.shopping_actions && aiResult.shopping_actions.length > 0) {
            const shopRes = applyShoppingActions(aiResult.shopping_actions);
            executedNotices.push.apply(executedNotices, shopRes);
          }
          if (aiResult.input_stock_actions && aiResult.input_stock_actions.length > 0) {
            const inputRes = applyInputStockActions(aiResult.input_stock_actions);
            executedNotices.push.apply(executedNotices, inputRes);
          }
          if (aiResult.routine_actions && aiResult.routine_actions.length > 0) {
            const routineRes = applyRoutineActions(aiResult.routine_actions);
            executedNotices.push.apply(executedNotices, routineRes);
          }
        } catch (actionErr) {
          Logger.log('アクション先行適用エラー: ' + actionErr.message);
        }

        // F2. 実行されたDB/カレンダー操作通知の統合（重複防止）
        // プログラムが正式な通知文字列（✅ タスク完了: ..., 📝 タスク追加: ..., 📅 カレンダー追加: ...）を一元付加する
        if (executedNotices.length > 0) {
          // AIが返信文内に手動で書いた可能性がある絵文字プレフィックス付き通知行を除去して一本化
          const cleanedReplyLines = replyText.split('\n').filter(line => {
            const trimmed = line.trim();
            return !/^(📝\s*タスク追加|✅\s*タスク完了|🗑️\s*タスク破棄|📅\s*カレンダー|🛒\s*買物|🔄\s*ルーティン)/.test(trimmed);
          });
          replyText = cleanedReplyLines.join('\n').trim();
          replyText += '\n\n' + executedNotices.join('\n');
        }

        // プログラム制御による朝ブリーフィング合流（1日1回・初回のみ確実に付加し即時配信完了記録）
        if (isFirstHello && isGeminiSuccess) {
          markBriefingDeliveredToday();
          replyText += '\n\n' + buildDailyBriefingText();
        }

        // G. LINE Reply API で返答送信
        replyLineMessage(replyToken, replyText);

        // H. 返答完了後の後続処理（ログ保存・メモリー更新・バッファクリア）
        try {
          // Gemini呼び出しが成功した場合のみ画像バッファクリア
          if (isGeminiSuccess && imageBlobs.length > 0) {
            clearImageBuffer();
          }

          // ログ追記 (画像内容の要約があればテキストに統合して保存し、文脈を永続化)
          const nowStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
          const imgUrlString = imageUrls.join('\n');
          let loggedUserText = userText;
          if (aiResult.image_summary && aiResult.image_summary.trim() !== '') {
            const imgDesc = `[画像内容: ${aiResult.image_summary.trim()}]`;
            loggedUserText = loggedUserText ? `${loggedUserText}\n${imgDesc}` : imgDesc;
          }
          appendLog(nowStr, 'user', loggedUserText, imgUrlString, replyText);

          // メモリー更新: 日中の通常チャットでの profile 勝手な上書きを禁止（深夜バッチで1日まとめて慎重に代謝）
          // ※「プロファイル更新して」「設定変更して」等、ユーザーが明示的にプロファイル変更を求めた場合のみ日中反映
          if (aiResult.memory_updates) {
            const isExplicitProfileRequest = userText && (
              userText.includes('プロフィール') ||
              userText.includes('プロファイル') ||
              userText.includes('設定変更') ||
              userText.includes('覚えておいて') ||
              userText.includes('登録して')
            );

            if (isExplicitProfileRequest && aiResult.memory_updates.profile) {
              updateProfileSafely(aiResult.memory_updates.profile);
              Logger.log('ユーザー明示要求によりプロファイルを安全に更新/追記しました');
            }

            // 用語辞書への追記（辞書更新や新用語の定義がある場合）
            if (aiResult.memory_updates.dictionary) {
              updateDictionarySafely(aiResult.memory_updates.dictionary);
              Logger.log('用語辞書に新しい前提知識を安全に反映しました');
            }
          }

          // 月報通知フラグの解除
          const memory = getMemory();
          if (memory.monthly_report_ready === 'TRUE') {
            setMemoryValue('monthly_report_ready', 'FALSE');
          }
        } catch (postProcessErr) {
          Logger.log('後続処理反映エラー: ' + postProcessErr.message);
        }
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (globalErr) {
    Logger.log('doPost 全体例外: ' + globalErr.message);
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: globalErr.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * 本日のデイリーブリーフィング文字列をプログラム制御で直接組み立て（AI出力に依存せず100%確実に1日1回配信）
 * @return {string}
 */
function buildDailyBriefingText() {
  const memory = getMemory();
  const todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

  // 1. 天気
  let weatherLine = '・天気: ';
  let weatherText = (memory.weather_info || '').trim();
  if (!weatherText || weatherText.includes('エラー')) {
    try {
      const freshWeather = fetchWeatherAndPressure();
      if (freshWeather && freshWeather.weatherInfo && !freshWeather.weatherInfo.includes('エラー')) {
        weatherText = freshWeather.weatherInfo;
        setMemoryValue('weather_info', weatherText);
        setMemoryValue('pressure_alert', freshWeather.pressureAlert);
      }
    } catch (wErr) {}
  }
  if (weatherText && !weatherText.includes('エラー')) {
    weatherLine += weatherText;
  } else {
    weatherLine += '室内を過ごしやすい温度・湿度に整えてお過ごしください';
  }

  // 2. 気圧
  const isPressureDrop = memory.pressure_alert === 'TRUE';
  const pressureLine = isPressureDrop
    ? '・気圧: ⚠️ 急降下アラート発令中（頭痛・体調の変化にご注意ください）'
    : '・気圧: 安定（急降下アラートなし）';

  // 3. 予定 (メインカレンダー + 家族共用カレンダーの「♪」付き)
  const todayEvents = getTodayEventsList();
  let scheduleLine = '・予定: ';
  if (todayEvents.length > 0) {
    scheduleLine += todayEvents.join(' / ');
  } else {
    scheduleLine += 'カレンダーの登録予定なし（終日フリー）';
  }

  // 4. タスク (本日期限の未完了タスク)
  const tasks = getTasks('未完了');
  const todayTasks = tasks.filter(t => t.dueDate === todayStr);
  let taskLine = '・タスク: ';
  if (todayTasks.length > 0) {
    taskLine += todayTasks.map(t => t.title).join(' / ');
  } else {
    taskLine += '本日期限の重要タスクはありません';
  }

  return `━━━━━━━━━━━━━━\n☀️ 本日のデイリーブリーフィング\n${weatherLine}\n${pressureLine}\n${scheduleLine}\n${taskLine}\n━━━━━━━━━━━━━━`;
}

/**
 * GETハンドラー: 生活伴走Webダッシュボード（HTML Service）を配信
 * （?mode=health 指定時のみ疎通確認テキストを返却）
 */
function doGet(e) {
  if (e && e.parameter) {
    if (e.parameter.mode === 'health') {
      return ContentService.createTextOutput('LINE Bot 生活秘書システムは正常稼働中です。')
        .setMimeType(ContentService.MimeType.TEXT);
    }
    if (e.parameter.apiAction) {
      let args = [];
      try {
        if (e.parameter.args) args = JSON.parse(e.parameter.args);
      } catch (err) {}
      const apiRes = handleDashboardApiRequest({
        apiAction: e.parameter.apiAction,
        args: args
      });
      return ContentService.createTextOutput(JSON.stringify(apiRes))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  return renderDashboardHtml(e);
}

// ==========================================
// FILE: src/Setup.js
// ==========================================

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

