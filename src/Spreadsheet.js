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
 * タスクタイトルをバッジ風表示 [プレフィックス] タイトル に整形
 * （コロン重複 ": コスメ：" を防止し、視認性を高める）
 * 例: "コスメ：ファンデーションの確認" -> "[コスメ] ファンデーションの確認"
 * @param {string} title
 * @return {string}
 */
function formatTaskTitleWithBadge(title) {
  if (!title) return '';
  const trimmed = title.trim();
  if (/^\[[^\]]+\]/.test(trimmed)) {
    return trimmed;
  }
  const colonMatch = trimmed.match(/^([^：:]+)[：:]\s*(.*)$/);
  if (colonMatch) {
    const prefix = colonMatch[1].trim();
    const taskBody = colonMatch[2].trim();
    if (taskBody) {
      return `[${prefix}] ${taskBody}`;
    }
  }
  return trimmed;
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
      const formattedTitle = formatTaskTitleWithBadge(act.title);
      results.push(`📝 タスク追加: ${formattedTitle}${dueDate ? ` (期限: ${dueDate})` : ''}`);
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
            const formattedTitle = formatTaskTitleWithBadge(t.title);
            results.push(`✅ タスク完了: ${formattedTitle}`);
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
          const formattedTitle = formatTaskTitleWithBadge(t.title);
          results.push(`🗑️ タスク破棄: ${formattedTitle}`);
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
  if (memory.cycle_stamps && memory.cycle_stamps.trim() !== '') {
    context += `【周期・スキルアップ履歴（cycle_stamps）】:\n${memory.cycle_stamps.trim()}\n`;
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

  // 3. インプットストックを1行に圧縮（未発売等のメモがあれば含める）
  if (pendingInput.length > 0) {
    const inputItems = pendingInput.map(inp => {
      const memoPart = inp.memo && inp.memo.trim() ? `(${inp.memo.trim()})` : '';
      return `[${inp.type}]${inp.title}${memoPart}`;
    });
    context += `インプット未消化: ${inputItems.join(', ')}\n`;
  }

  // ※ routines（ルーティン設定マスタ）は日中会話では不要なため完全除外

  return context.trim();
}
