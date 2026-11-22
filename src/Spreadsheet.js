/**
 * Spreadsheet.js - スプレッドシート操作モジュール
 * 全6タブ（logs, tasks, routines, shopping, input_stock, memory）の厳密な読み書きとデータ変換
 */

const _reqSheetCache = {
  ss: null,
  memory: null,
  tasks: null,
  shopping: null,
  inputStock: null,
  routines: null,
  logs: null
};

/**
 * リクエスト内キャッシュを破棄（引数省略時は全タブ破棄）
 * @param {string=} keyOpt
 */
function invalidateSheetCache_(keyOpt) {
  if (keyOpt) {
    if (Object.prototype.hasOwnProperty.call(_reqSheetCache, keyOpt)) {
      _reqSheetCache[keyOpt] = null;
    }
    return;
  }
  _reqSheetCache.memory = null;
  _reqSheetCache.tasks = null;
  _reqSheetCache.shopping = null;
  _reqSheetCache.inputStock = null;
  _reqSheetCache.routines = null;
  _reqSheetCache.logs = null;
}

/**
 * スプレッドシートオブジェクトを取得（リクエスト内キャッシュ）
 * @return {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getSpreadsheet() {
  if (_reqSheetCache.ss) return _reqSheetCache.ss;
  const config = getConfig();
  _reqSheetCache.ss = SpreadsheetApp.openById(config.spreadsheetId);
  return _reqSheetCache.ss;
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

/**
 * フィルター（BasicFilter）の有無や非表示行に左右されず、安全かつ確実にシート末尾へ行データを追記
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {Array<any>} rowData 追記する1行のデータ配列
 */
function appendRowSafely_(sheet, rowData) {
  if (!sheet || !rowData || !Array.isArray(rowData)) return;

  // 1. A列を走査して空文字ではない真の最終行（realLastRow）を特定
  const lastRow = sheet.getLastRow();
  let realLastRow = 0;
  if (lastRow > 0) {
    const aValues = sheet.getRange(1, 1, lastRow, 1).getValues();
    for (let i = aValues.length - 1; i >= 0; i--) {
      if (aValues[i][0] !== '' && aValues[i][0] !== null && aValues[i][0] !== undefined) {
        realLastRow = i + 1;
        break;
      }
    }
  }
  const targetRow = realLastRow + 1;
  const maxRows = sheet.getMaxRows();
  if (targetRow > maxRows) {
    sheet.insertRowsAfter(maxRows, Math.max(20, targetRow - maxRows));
  }

  // 2. 基本フィルター（BasicFilter）が存在する場合、一時的に解除して書き込み後に再適用
  const filter = sheet.getFilter();
  let filterCriteriaMap = null;
  let filterRange = null;

  if (filter) {
    try {
      filterRange = filter.getRange();
      filterCriteriaMap = {};
      const numCols = filterRange.getNumColumns();
      const startCol = filterRange.getColumn();
      for (let c = 0; c < numCols; c++) {
        const colIndex = startCol + c;
        const criteria = filter.getColumnFilterCriteria(colIndex);
        if (criteria) {
          filterCriteriaMap[colIndex] = criteria;
        }
      }
      filter.remove();
    } catch (e) {
      Logger.log('フィルター情報取得/解除中の軽微な警告: ' + e.message);
    }
  }

  // 3. 明示的な行座標指定（setValues）で確実に書き込み
  sheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);
  SpreadsheetApp.flush();

  // 4. フィルターが元々存在していた場合、拡張した範囲で再適用して元の条件を復元
  if (filterRange) {
    try {
      const newMaxRow = Math.max(filterRange.getLastRow(), targetRow);
      const newFilterRange = sheet.getRange(
        filterRange.getRow(),
        filterRange.getColumn(),
        newMaxRow - filterRange.getRow() + 1,
        filterRange.getNumColumns()
      );
      const newFilter = newFilterRange.createFilter();
      if (filterCriteriaMap) {
        for (const colStr in filterCriteriaMap) {
          newFilter.setColumnFilterCriteria(parseInt(colStr, 10), filterCriteriaMap[colStr]);
        }
      }
    } catch (e) {
      Logger.log('フィルター再適用中の軽微な警告: ' + e.message);
    }
  }
}

// ==========================================
// 1. logs (会話ログ・直近30日ローリング保持・全16列対応) 操作
// ヘッダー: [時刻, 発言者, メッセージ, 画像URL, AI返答, Lite入力, Lite出力, Liteキャッシュ, Flash入力, Flash出力, Flashキャッシュ, 新総トークン, 判定タグ/フェーズ, 旧AI返答（比較用）, 旧Flash総トークン, トークン削減差分]
// ==========================================

/**
 * 会話ログを取得（targetDateStr 指定時はその日付のみ、未指定時は全件）
 * @param {string=} targetDateStr オプション: 'yyyy-MM-dd' 形式で特定日付のログのみ抽出
 * @return {Array<Object>} ログ一覧
 */
function getLogs(targetDateStr) {
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.LOGS);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const maxCol = Math.max(9, Math.min(sheet.getLastColumn(), 16));
  const values = sheet.getRange(2, 1, lastRow - 1, maxCol).getValues();
  const logs = [];

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const timestamp = row[0];
    const tStr = (timestamp instanceof Date)
      ? Utilities.formatDate(timestamp, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss')
      : String(timestamp || '');

    if (targetDateStr) {
      if (!tStr.startsWith(targetDateStr)) continue;
    }

    logs.push({
      timestamp: timestamp,
      timestampStr: tStr,
      sender: row[1],
      message: String(row[2] || ''),
      imageUrl: String(row[3] || ''),
      aiReply: String(row[4] || ''),
      litePromptTokens: row[5] || 0,
      liteCandidatesTokens: row[6] || 0,
      liteCachedTokens: row[7] || 0,
      flashPromptTokens: row[8] || 0,
      flashCandidatesTokens: row[9] || 0,
      flashCachedTokens: row[10] || 0,
      totalTokens: row[11] || row[8] || 0,
      phaseAndTags: String(row[12] || ''),
      oldAiReply: String(row[13] || ''),
      oldTotalTokens: row[14] || 0,
      tokenReductionDiff: String(row[15] || '')
    });
  }

  return logs;
}

/**
  * 当日の会話ログを全件取得し、極小高密度の会話テキスト（HH:mm User: ... / AI: ...）に圧縮変換
  * 日時・秒・空列・重複を除去し、朝から夜までの全伏線を最小トークンで保持
  * @param {string=} beforeTimestamp オプション: 指定日時（例: "2026-10-25 20:46:00"）より前のログのみを抽出（過去時点シミュレーション用）
  * @param {string=} targetDateStr オプション: 指定日付（例: "2026-10-25"）のログのみ抽出（過去シミュレーション用。省略時は今日の日付）
  * @return {string}
  */
function getCondensedTodayLogs(beforeTimestamp, targetDateStr) {
  // 指定日付または今日（JST）の日付のログのみを抽出（過去ログ蓄積があっても当日のログだけを安全に抽出）
  let filterDateStr = targetDateStr;
  if (!filterDateStr) {
    if (beforeTimestamp) {
      const match = beforeTimestamp.match(/^(\d{4}-\d{2}-\d{2})/);
      filterDateStr = match ? match[1] : Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    } else {
      filterDateStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    }
  }

  const allLogs = getLogs(filterDateStr);
  if (allLogs.length === 0) return '';

  const validPairs = allLogs.filter(log => {
    if (!log.message || log.message.trim() === '') return false;
    if (beforeTimestamp) {
      const tStr = log.timestampStr || ((log.timestamp instanceof Date)
        ? Utilities.formatDate(log.timestamp, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss')
        : String(log.timestamp));
      if (tStr >= beforeTimestamp) return false;
    }
    return true;
  });
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
      // 朝ブリーフィング枠、A/Bテスト比較装飾、および末尾の機械的DB操作通知行を除去して純粋な会話応答のみを保持
      let cleanedReply = log.aiReply
        .replace(/━━━━━━━━━━━━━━\s*☀️\s*本日のデイリーブリーフィング[\s\S]*$/, '')
        .replace(/━━━━━━━━━━━━━━\s*🕰️\s*【旧システム】[\s\S]*$/, '')
        .split('\n')
        .filter(line => {
          const trimmed = line.trim();
          return trimmed !== '' &&
            !/^🆕\s*【新システム】/.test(trimmed) &&
            !/^⚠️\s*\[旧のみ検出/.test(trimmed) &&
            !/^(📝\s*タスク追加|📝\s*タスク更新|✅\s*タスク完了|🗑️\s*タスク破棄|📅\s*カレンダー|🛒\s*買物|🎬\s*インプット|🔄\s*ルーティン)/.test(trimmed);
        })
        .join(' ')
        .trim();
      if (cleanedReply) {
        // 直近4ターンはAI返答も全文を維持し、それ以前（5ターン以上前）は冒頭1〜2文（最大80文字）にスリム化
        const isRecent = (i >= validPairs.length - 4);
        if (isRecent) {
          lines.push(`AI: ${cleanedReply}`);
        } else {
          let shortReply = cleanedReply;
          const sentenceMatch = cleanedReply.match(/^([^。！？\n]+[。！？])/);
          if (sentenceMatch && sentenceMatch[1]) {
            shortReply = sentenceMatch[1];
          } else if (cleanedReply.length > 80) {
            shortReply = cleanedReply.substring(0, 80) + '...';
          }
          lines.push(`AI: ${shortReply}`);
        }
      }
    }
  }

  return lines.join('\n');
}

/**
 * ログを追加（2モデル体制・A/Bテスト全16列対応 ＆ 旧モード後方互換）
 * @param {string} timestamp 日時文字列
 * @param {string} sender 発言者（user / ai）
 * @param {string} message メッセージ本文
 * @param {string} imageUrl 関連画像URL
 * @param {string} aiReply AIの返答内容（※次ターン履歴保護のため新システムの純粋返答のみ格納）
 * @param {Object=} logMeta トークン使用量・判定ログ・旧システム比較メタデータ
 */
function appendLog(timestamp, sender, message, imageUrl, aiReply, logMeta) {
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.LOGS);
  const ts = timestamp || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');

  if (logMeta && logMeta.isTwoModel) {
    appendRowSafely_(sheet, [
      ts,
      sender || 'user',
      message || '',
      imageUrl || '',
      aiReply || '',
      logMeta.litePromptTokens !== undefined ? logMeta.litePromptTokens : '',
      logMeta.liteCandidatesTokens !== undefined ? logMeta.liteCandidatesTokens : '',
      logMeta.liteCachedTokens !== undefined ? logMeta.liteCachedTokens : '',
      logMeta.flashPromptTokens !== undefined ? logMeta.flashPromptTokens : '',
      logMeta.flashCandidatesTokens !== undefined ? logMeta.flashCandidatesTokens : '',
      logMeta.flashCachedTokens !== undefined ? logMeta.flashCachedTokens : '',
      logMeta.newTotalTokens !== undefined ? logMeta.newTotalTokens : '',
      logMeta.phaseAndTags || '',
      logMeta.oldAiReply || '',
      logMeta.oldTotalTokens !== undefined ? logMeta.oldTotalTokens : '',
      logMeta.tokenReductionDiff || ''
    ]);
  } else {
    // OLDモード（単一Flash）またはレガシー呼び出し時
    const promptTokens = logMeta ? (logMeta.promptTokenCount || 0) : '';
    const candidatesTokens = logMeta ? (logMeta.candidatesTokenCount || 0) : '';
    const cachedTokens = logMeta ? (logMeta.cachedContentTokenCount || 0) : '';
    const totalTokens = logMeta ? (logMeta.totalTokenCount || 0) : '';

    appendRowSafely_(sheet, [
      ts,
      sender || 'user',
      message || '',
      imageUrl || '',
      aiReply || '',
      '',
      '',
      '',
      promptTokens,
      candidatesTokens,
      cachedTokens,
      '',
      '[OLD単独モード]',
      '',
      totalTokens,
      ''
    ]);
  }
}

/**
 * 指定日数（デフォルト30日）を超えた古いログを安全にパージ
 * @param {number=} retentionDays 保持日数（デフォルト30日）
 */
function cleanOldLogs(retentionDays) {
  const days = (typeof retentionDays === 'number' && retentionDays > 0) ? retentionDays : 30;
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.LOGS);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  const now = new Date();
  const cutoffDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  const cutoffStr = Utilities.formatDate(cutoffDate, 'Asia/Tokyo', 'yyyy-MM-dd 00:00:00');

  const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  let deleteCount = 0;
  for (let i = 0; i < values.length; i++) {
    const val = values[i][0];
    const tStr = (val instanceof Date)
      ? Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss')
      : String(val);
    if (tStr < cutoffStr) {
      deleteCount++;
    } else {
      break; // ログは時系列昇順のため、閾値以降は残す
    }
  }

  if (deleteCount > 0) {
    sheet.deleteRows(2, deleteCount);
    Logger.log(`[cleanOldLogs] ${deleteCount} 件の古いログ(${days}日超過)を削除しました`);
  }
}

/**
 * ログシートの整理（直近30日を保持して古いログのみ安全にパージ）
 */
function clearDailyLogs() {
  cleanOldLogs(30);
}

// ==========================================
// 2. tasks (単発タスク・全8列対応) 操作
// ヘッダー: [タスクID, タスク名, 期限, ステータス(未完了/完了/破棄), 登録日, 完了日, メモ, リマインド目安]
// ==========================================

/**
 * 未完了タスクを緊急度順（期限超過 → 本日期限 → 直近期限 → 期限なし）にソート
 * @param {Array<Object>} tasks
 * @param {string=} todayStrOpt YYYY-MM-DD（省略時は現在日）
 * @return {Array<Object>}
 */
function sortTasksByUrgency_(tasks, todayStrOpt) {
  if (!tasks || !Array.isArray(tasks) || tasks.length <= 1) return tasks || [];
  const todayStr = todayStrOpt || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

  return tasks.slice().sort((a, b) => {
    const aDue = a.dueDate || '';
    const bDue = b.dueDate || '';

    // 1. 期限超過タスクの判定 (due < todayStr)
    const aOverdue = (aDue && aDue < todayStr);
    const bOverdue = (bDue && bDue < todayStr);
    if (aOverdue && !bOverdue) return -1;
    if (!aOverdue && bOverdue) return 1;
    if (aOverdue && bOverdue) return aDue.localeCompare(bDue); // 超過タスク同士はより古い期限を優先

    // 2. 本日期限タスクの判定 (due === todayStr)
    const aToday = (aDue === todayStr);
    const bToday = (bDue === todayStr);
    if (aToday && !bToday) return -1;
    if (!aToday && bToday) return 1;

    // 3. 未来期限タスクの判定 (due > todayStr)
    const aFuture = (aDue && aDue > todayStr);
    const bFuture = (bDue && bDue > todayStr);
    if (aFuture && !bFuture) return -1;
    if (!aFuture && bFuture) return 1;
    if (aFuture && bFuture) return aDue.localeCompare(bDue); // 未来期限は直近順

    // 4. 期限なしタスク同士は登録順序維持
    return (a.rowIndex || 0) - (b.rowIndex || 0);
  });
}

/**
 * タスク一覧を取得
 * @param {string} filterStatus オプション（未完了 / 完了 / 破棄）
 * @return {Array<Object>}
 */
function formatSheetDateAndTimestamp_(val) {
  if (!val) return { dateStr: '', timestampStr: '' };
  if (val instanceof Date) {
    return {
      dateStr: Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM-dd'),
      timestampStr: Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss')
    };
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return { dateStr: s, timestampStr: '' };
  }
  const d = new Date(s);
  if (isNaN(d.getTime())) {
    return { dateStr: s, timestampStr: '' };
  }
  return {
    dateStr: Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd'),
    timestampStr: Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss')
  };
}

function getDefaultTaskEstimatedMins_(title) {
  const t = String(title || '');
  if (/\[お出かけ\]/.test(t)) return 90;
  return 30;
}

function getDefaultInputStockEstimatedMins_(type) {
  const t = String(type || '').trim();
  if (t === '本' || t === '漫画') return 20;
  if (t === '映画' || t === 'アニメ') return 120;
  if (t === '音楽') return 30;
  return 30;
}

function parsePositiveEstimatedMins_(val) {
  if (val === '' || val === null || val === undefined) return null;
  const n = parseInt(String(val).replace(/[^\d]/g, ''), 10);
  return (!isNaN(n) && n > 0) ? Math.min(480, Math.max(5, n)) : null;
}

function getTasks(filterStatus) {
  if (_reqSheetCache.tasks) {
    if (!filterStatus) return _reqSheetCache.tasks.slice();
    const filtered = _reqSheetCache.tasks.filter(t => t.status === filterStatus);
    return filterStatus === '未完了' ? sortTasksByUrgency_(filtered) : filtered;
  }
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.TASKS);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const numCols = Math.max(7, Math.min(sheet.getLastColumn(), 10));
  const values = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
  const tasks = values.map((row, index) => {
    const completedInfo = formatSheetDateAndTimestamp_(row[5]);
    const title = String(row[1] || '');
    const parsedMins = numCols >= 10 ? parsePositiveEstimatedMins_(row[9]) : null;
    return {
      rowIndex: index + 2,
      id: String(row[0]),
      title: title,
      dueDate: row[2] ? Utilities.formatDate(new Date(row[2]), 'Asia/Tokyo', 'yyyy-MM-dd') : '',
      status: String(row[3]),
      createdDate: row[4] ? Utilities.formatDate(new Date(row[4]), 'Asia/Tokyo', 'yyyy-MM-dd') : '',
      completedDate: completedInfo.dateStr,
      completedTimestampStr: completedInfo.timestampStr,
      memo: String(row[6] || ''),
      remindContext: row[7] ? String(row[7]).trim() : '',
      docUrl: row[8] ? String(row[8]).trim() : '',
      estimatedMins: parsedMins || getDefaultTaskEstimatedMins_(title)
    };
  });

  _reqSheetCache.tasks = tasks.slice();
  if (filterStatus) {
    const filtered = tasks.filter(t => t.status === filterStatus);
    if (filterStatus === '未完了') {
      return sortTasksByUrgency_(filtered);
    }
    return filtered;
  }
  return tasks;
}

/**
 * 指定日数（デフォルト30日）を超えた完了・破棄済みタスクを安全にパージ
 * ※ステータスが「完了」または「破棄」かつ日付が基準日未満の行のみ削除し、「未完了」は絶対に保持する
 * @param {number=} retentionDays 保持日数（デフォルト30日）
 */
function cleanOldTasks(retentionDays) {
  const days = (typeof retentionDays === 'number' && retentionDays > 0) ? retentionDays : 30;
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.TASKS);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  const now = new Date();
  const cutoffDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  const cutoffStr = Utilities.formatDate(cutoffDate, 'Asia/Tokyo', 'yyyy-MM-dd');

  const colCount = Math.min(Math.max(sheet.getLastColumn(), 6), 9);
  const values = sheet.getRange(2, 1, lastRow - 1, colCount).getValues();
  const rowsToDelete = [];

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const status = String(row[3] || '').trim();
    if (status !== '完了' && status !== '破棄') continue;

    const refDateStr = formatSheetDateAndTimestamp_(row[5]).dateStr ||
      formatSheetDateAndTimestamp_(row[4]).dateStr ||
      formatSheetDateAndTimestamp_(row[2]).dateStr;
    if (refDateStr && refDateStr < cutoffStr) {
      rowsToDelete.push(i + 2);
    }
  }

  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    sheet.deleteRow(rowsToDelete[i]);
  }
  if (rowsToDelete.length > 0) {
    Logger.log(`[cleanOldTasks] ${rowsToDelete.length} 件の古い完了・破棄タスク(${days}日超過)を削除しました`);
  }
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
 * 日中締切（〜11:59まで、〜12:59まで等の午前〜昼締切）が含まれるタスクに対して
 * 「締切前日夜 または 当日朝」のリマインド目安を自動補完するヘルパー
 * @param {string} title
 * @param {string} rawRemindContext
 * @return {string}
 */
function normalizeTaskRemindContext_(title, rawRemindContext) {
  let ctx = String(rawRemindContext || '').trim();
  const t = String(title || '');
  // 04:00〜13:59 までの日中締切パターン検知（例: 〜11:59まで、12:00締切、正午まで 等）
  const hasDaytimeDeadline = /(?:0?[4-9]|1[0-3]):[0-5]\d\s*(?:まで|締切)|午前中|正午まで/.test(t);
  if (hasDaytimeDeadline) {
    if (!ctx.includes('前日') && !ctx.includes('朝')) {
      ctx = ctx ? `締切前日夜・当日朝 / ${ctx}` : '締切前日夜 または 当日朝';
    }
  }
  return ctx;
}

/**
 * タスクの7大生活プリフィックスと既存プロジェクトの親カテゴリフォルダの直交整合性を検証
 * @param {string} taskTitle
 * @param {string} projectCategoryFolderName 例: '03_家事・環境'
 * @return {boolean} タイトルが7大プリフィックスのいずれかであり、かつ別カテゴリフォルダと明確に不一致の場合は false
 * @private
 */
function isProjectCategoryCompatibleWithTask_(taskTitle, projectCategoryFolderName) {
  const folder = String(projectCategoryFolderName || '').trim();
  if (!folder) return true;
  const match = String(taskTitle || '').trim().match(/^\[([^\]]+)\]/);
  if (!match || !match[1]) return true;
  const taskPrefix = match[1].trim();
  const categories = (typeof SYSTEM_CONSTANTS !== 'undefined' && SYSTEM_CONSTANTS.PROJECT_ROOT_CATEGORIES) || [];
  for (let i = 0; i < categories.length; i++) {
    if (categories[i].prefix === taskPrefix) {
      return categories[i].folderName === folder;
    }
  }
  return true;
}

/**
 * タスクアクション（doc_url / project_name）から関連Google Docs / フォルダURLを解決
 * @param {Object} act
 * @param {Object=} extraProjectUrlMapOpt 同一ターンで作成されたプロジェクト名 -> URL マップ
 * @param {Function=} getEntriesFnOpt 遅延取得用プロジェクト台帳ゲッター
 * @return {string|null} 解決されたURL（空文字明示時は''、未指定・未解決時はnull）
 * @private
 */
function resolveTaskDocUrl_(act, extraProjectUrlMapOpt, getEntriesFnOpt) {
  if (!act) return null;
  if (act.doc_url !== undefined) {
    return String(act.doc_url || '').trim();
  }
  const projQuery = act.project_name ? String(act.project_name).trim() : '';
  if (!projQuery) return null;

  const qNoDate = projQuery.replace(/^\d{4}_/, '').trim();
  if (extraProjectUrlMapOpt && typeof extraProjectUrlMapOpt === 'object') {
    if (extraProjectUrlMapOpt[projQuery]) return extraProjectUrlMapOpt[projQuery];
    const mapKeys = Object.keys(extraProjectUrlMapOpt);
    for (let k = 0; k < mapKeys.length; k++) {
      const key = mapKeys[k];
      if (key.replace(/^\d{4}_/, '').trim() === qNoDate && extraProjectUrlMapOpt[key]) {
        return extraProjectUrlMapOpt[key];
      }
    }
  }

  if (typeof getEntriesFnOpt === 'function' && typeof findProjectEntry === 'function' && typeof getProjectEntryResourceUrl === 'function') {
    const entries = getEntriesFnOpt();
    const entry = findProjectEntry(entries, projQuery);
    if (entry) {
      if (act.action === 'add' && !isProjectCategoryCompatibleWithTask_(act.title, entry.categoryFolderName)) {
        Logger.log(`[誤紐付けガード] タスク(${act.title})と既存プロジェクト(${entry.categoryFolderName}/${entry.projectName})の生活領域が一致しないため自動紐付けをスキップします`);
        return null;
      }
      const url = getProjectEntryResourceUrl(entry);
      if (url) return url;
    }
  }
  return null;
}

/**
 * 既存タスクタイトルの先頭カテゴリプリフィックス [大分類] を新しいカテゴリへ安全に付け替える
 * @param {string} currentTitle
 * @param {string} rawCategory 例: '仕事', '[仕事]', '01_仕事'
 * @return {string}
 * @private
 */
function applyTaskCategoryPrefix_(currentTitle, rawCategory) {
  const base = String(currentTitle || '').trim();
  const cleanedRaw = String(rawCategory || '').replace(/[\[\]]/g, '').trim();
  if (!cleanedRaw) return base;

  const matched = (typeof findProjectCategoryEntry === 'function')
    ? findProjectCategoryEntry(cleanedRaw)
    : null;
  const nextPrefix = matched ? matched.prefix : cleanedRaw.replace(/^\d{2}_/, '').trim();
  if (!nextPrefix) return base;

  if (/^\[[^\]]+\]\s*/.test(base)) {
    return base.replace(/^\[[^\]]+\]\s*/, `[${nextPrefix}] `);
  }
  return base ? `[${nextPrefix}] ${base}` : `[${nextPrefix}]`;
}

/**
 * Geminiレスポンスに基づくタスク操作を適用（8列目「リマインド目安」・9列目「関連URL」対応）
 * @param {Array<Object>} actions
 * @param {Object=} extraProjectUrlMapOpt 同一ターンで作成されたプロジェクトURLマップ
 * @return {Array<string>} 適用結果のメッセージリスト
 */
function applyTaskActions(actions, extraProjectUrlMapOpt) {
  if (!actions || !Array.isArray(actions) || actions.length === 0) return [];
  invalidateSheetCache_('tasks');
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.TASKS);
  const todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const results = [];

  let cachedProjectEntries = null;
  const getProjectEntriesCached = () => {
    if (cachedProjectEntries === null) {
      if (typeof parseProjectFoldersIndex === 'function') {
        const mem = getMemory() || {};
        cachedProjectEntries = parseProjectFoldersIndex(mem.project_folders || '');
      } else {
        cachedProjectEntries = [];
      }
    }
    return cachedProjectEntries;
  };

  for (let i = 0; i < actions.length; i++) {
    const act = actions[i];
    if (!act || !act.action) continue;

    if (act.action === 'add' && act.title) {
      let addTitle = String(act.title).trim();
      if (act.category && !/^\[[^\]]+\]/.test(addTitle)) {
        addTitle = applyTaskCategoryPrefix_(addTitle, act.category);
      }
      const taskId = 'T_' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss') + '_' + Math.floor(Math.random() * 1000);
      const dueDate = act.due_date || '';
      const memo = act.memo ? String(act.memo).trim() : '';
      const remindContext = normalizeTaskRemindContext_(addTitle, act.remind_context);
      const actForUrl = addTitle === act.title ? act : Object.assign({}, act, { title: addTitle });
      const resolvedUrl = resolveTaskDocUrl_(actForUrl, extraProjectUrlMapOpt, getProjectEntriesCached);
      const docUrl = resolvedUrl || '';
      const estMins = parsePositiveEstimatedMins_(act.estimated_mins) || getDefaultTaskEstimatedMins_(addTitle);
      appendRowSafely_(sheet, [taskId, addTitle, dueDate, '未完了', todayStr, '', memo, remindContext, docUrl, estMins]);
      const formattedTitle = formatTaskTitleWithBadge(addTitle);
      results.push(`📝 タスク追加: ${formattedTitle}${dueDate ? ` (期限: ${dueDate})` : ''}${estMins ? ` (${estMins}分)` : ''}${docUrl ? ' 🔗 資料連携' : ''}`);
    } else if (act.action === 'update') {
      const tasks = getTasks();
      const searchTitle = act.target_title || (!act.new_title ? act.title : '') || '';
      for (let j = 0; j < tasks.length; j++) {
        const t = tasks[j];
        if (t.status === '未完了') {
          const matchById = Boolean(act.task_id && t.id === act.task_id);
          const matchByTitle = Boolean(searchTitle && (t.title.includes(searchTitle) || searchTitle.includes(t.title)));
          if (matchById || matchByTitle) {
            let updatedTitle = String(t.title || '').trim();
            let hasChanges = false;

            // new_title、category、または ID一致時の明確な変更後 title をタイトル列（列2）へ反映
            let resolvedNewTitle = '';
            if (act.new_title !== undefined && String(act.new_title).trim() !== '') {
              resolvedNewTitle = String(act.new_title).trim();
            } else if (matchById && act.title !== undefined && String(act.title).trim() !== '') {
              const candTitle = String(act.title).trim();
              const hasOtherFieldUpdate = act.due_date !== undefined || act.memo !== undefined ||
                act.remind_context !== undefined || act.doc_url !== undefined ||
                act.project_name !== undefined || act.category !== undefined ||
                act.estimated_mins !== undefined;
              const curBody = updatedTitle.replace(/^\[[^\]]+\]\s*/, '');
              const candBody = candTitle.replace(/^\[[^\]]+\]\s*/, '');
              const isCategoryPrefixOnlyChange = /^\[[^\]]+\]\s*/.test(candTitle) && curBody === candBody && candTitle !== updatedTitle;
              const isCopiedDisplayString = /\|\s*(?:estimated_mins|remind_context|memo):|\[目安:|\[📄資料連携済\]|\(見込み\d+分\)|\[⚠️/.test(candTitle);
              if (!isCopiedDisplayString && !updatedTitle.includes(candTitle) && (!hasOtherFieldUpdate || isCategoryPrefixOnlyChange)) {
                resolvedNewTitle = candTitle;
              }
            }

            if (resolvedNewTitle) {
              updatedTitle = resolvedNewTitle;
            }
            if (act.category !== undefined && String(act.category).trim() !== '') {
              updatedTitle = applyTaskCategoryPrefix_(updatedTitle, act.category);
            }
            if (updatedTitle !== String(t.title || '').trim()) {
              sheet.getRange(t.rowIndex, 2).setValue(updatedTitle);
              hasChanges = true;
            }

            // due_date が指定されている場合のみ期限列（列3）を更新
            let updatedDue = String(t.dueDate || '').trim();
            if (act.due_date !== undefined) {
              const nextDue = String(act.due_date || '').trim();
              if (nextDue !== updatedDue) {
                sheet.getRange(t.rowIndex, 3).setValue(nextDue);
                updatedDue = nextDue;
                hasChanges = true;
              }
            }
            // memo が指定されている場合のみメモ列（列7）を更新
            if (act.memo !== undefined) {
              const nextMemo = String(act.memo || '').trim();
              if (nextMemo !== String(t.memo || '').trim()) {
                sheet.getRange(t.rowIndex, 7).setValue(nextMemo);
                hasChanges = true;
              }
            }
            // remind_context が指定されている場合のみリマインド文脈（列8）を更新
            if (act.remind_context !== undefined) {
              const newRemind = normalizeTaskRemindContext_(updatedTitle, act.remind_context);
              if (newRemind !== String(t.remindContext || '').trim()) {
                sheet.getRange(t.rowIndex, 8).setValue(newRemind);
                hasChanges = true;
              }
            }
            // doc_url / project_name が指定・解決された場合のみ関連URL（列9）を更新
            const resolvedDocUrl = resolveTaskDocUrl_(act, extraProjectUrlMapOpt, getProjectEntriesCached);
            let urlLinked = false;
            if (resolvedDocUrl !== null) {
              if (resolvedDocUrl !== String(t.docUrl || '').trim()) {
                sheet.getRange(t.rowIndex, 9).setValue(resolvedDocUrl);
                hasChanges = true;
              }
              urlLinked = Boolean(resolvedDocUrl);
            }
            // estimated_mins が指定された場合は10列目（見込み時間(分)）を更新
            let updatedMins = null;
            if (act.estimated_mins !== undefined) {
              const parsedNextMins = parsePositiveEstimatedMins_(act.estimated_mins);
              if (parsedNextMins && parsedNextMins !== t.estimatedMins) {
                sheet.getRange(t.rowIndex, 10).setValue(parsedNextMins);
                updatedMins = parsedNextMins;
                hasChanges = true;
              }
            }

            if (hasChanges) {
              const formattedTitle = formatTaskTitleWithBadge(updatedTitle);
              const minsNote = updatedMins ? ` (${updatedMins}分)` : '';
              results.push(`📝 タスク更新: ${formattedTitle}${updatedDue ? ` (期限: ${updatedDue})` : ''}${minsNote}${urlLinked ? ' 🔗 資料連携' : ''}`);
            } else {
              Logger.log(`[タスク更新スキップ] 変更内容がないため通知を省略しました (ID: ${t.id})`);
            }
            break;
          }
        }
      }
    } else if (act.action === 'complete') {
      const tasks = getTasks();
      for (let j = 0; j < tasks.length; j++) {
        const t = tasks[j];
        if (t.status === '未完了') {
          const matchById = act.task_id && t.id === act.task_id;
          const matchByTitle = act.title && (t.title.includes(act.title) || act.title.includes(t.title));
          if (matchById || matchByTitle) {
            const completedAtStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
            sheet.getRange(t.rowIndex, 4).setValue('完了');
            sheet.getRange(t.rowIndex, 6).setValue(completedAtStr);
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
        const matchByTitle = act.title && (t.title.includes(act.title) || act.title.includes(t.title));
        if (matchById || matchByTitle) {
          sheet.getRange(t.rowIndex, 4).setValue('破棄');
          const formattedTitle = formatTaskTitleWithBadge(t.title);
          results.push(`🗑️ タスク破棄: ${formattedTitle}`);
          break;
        }
      }
    }
  }
  invalidateSheetCache_('tasks');
  return results;
}

// ==========================================
// 3. routines (繰り返し定義) 操作
// ヘッダー: [ルール名, タイプ(day_of_week/day_of_month/interval_days), 設定値, 最終生成日, メモ]
// ==========================================

/**
 * routinesシートの7列ヘッダー（ステータス・完了日）を必要に応じて補完
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 */
function ensureRoutinesSchema7Cols_(sheet) {
  if (!sheet) return;
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['ルール名', 'タイプ(day_of_week/day_of_month/interval_days)', '設定値', '最終生成日', 'メモ', 'ステータス(有効/完了/期間満了)', '完了日']);
    return;
  }
  if (sheet.getLastColumn() < 7) {
    sheet.getRange(1, 6).setValue('ステータス(有効/完了/期間満了)');
    sheet.getRange(1, 7).setValue('完了日');
  }
}

/**
 * ルーティン一覧を取得（7列対応・旧5列およびレガシーexpired互換）
 * @param {string=} filterStatus '有効' | '完了' | '期間満了' 等（省略時は全件）
 * @return {Array<Object>}
 */
function getRoutines(filterStatus) {
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.ROUTINES);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const colCount = Math.min(Math.max(sheet.getLastColumn(), 5), 8);
  const values = sheet.getRange(2, 1, lastRow - 1, colCount).getValues();
  const routines = values.map((row, index) => {
    const ruleName = String(row[0] || '');
    const type = String(row[1] || '');
    const value = String(row[2] || '');
    const lastGeneratedDate = formatSheetDateAndTimestamp_(row[3]).dateStr;
    const memo = String(row[4] || '');
    let status = row[5] ? String(row[5]).trim() : '';
    if (!status) {
      status = (type === 'expired' || memo.includes('[期間満了')) ? '期間満了' : '有効';
    }
    let completedDate = formatSheetDateAndTimestamp_(row[6]).dateStr;
    if (!completedDate && memo) {
      const m = memo.match(/\[期間満了[:：]\s*(\d{4}-\d{2}-\d{2})\]/);
      if (m) completedDate = m[1];
    }
    return {
      rowIndex: index + 2,
      ruleName: ruleName,
      type: type,
      value: value,
      lastGeneratedDate: lastGeneratedDate,
      memo: memo,
      status: status,
      completedDate: completedDate,
      estimatedMins: colCount >= 8 ? parsePositiveEstimatedMins_(row[7]) : null
    };
  });

  if (filterStatus) {
    return routines.filter(r => r.status === filterStatus);
  }
  return routines;
}

/**
 * ルーティン追加・完了アクションを適用
 * @param {Array<Object>} actions
 * @return {Array<string>}
 */
function applyRoutineActions(actions) {
  if (!actions || !Array.isArray(actions) || actions.length === 0) return [];
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.ROUTINES);
  ensureRoutinesSchema7Cols_(sheet);
  const todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const results = [];

  for (let i = 0; i < actions.length; i++) {
    const act = actions[i];
    if (!act) continue;
    if (act.action === 'add' && act.title) {
      const type = act.type || 'day_of_week';
      const value = act.value || 'MON';
      appendRowSafely_(sheet, [act.title, type, value, '', act.memo || '', '有効', '']);
      results.push(`🔄 ルーティン追加: ${act.title} (${value})`);
    } else if (act.action === 'complete') {
      const targetName = String(act.title || act.ruleName || '').trim();
      if (!targetName) continue;
      const stripPrefix = s => String(s || '').replace(/^\[[^\]]+\]\s*/, '').trim();
      const targetBody = stripPrefix(targetName);
      const activeRoutines = getRoutines('有効');
      let matched = activeRoutines.find(r => r.ruleName === targetName || stripPrefix(r.ruleName) === targetBody);
      if (!matched && targetBody) {
        matched = activeRoutines.find(r => r.ruleName.includes(targetBody) || targetBody.includes(stripPrefix(r.ruleName)));
      }
      if (matched) {
        sheet.getRange(matched.rowIndex, 6).setValue('完了');
        sheet.getRange(matched.rowIndex, 7).setValue(todayStr);
        results.push(`🔄 ルーティン完了: ${matched.ruleName}`);
      }
    }
  }
  invalidateSheetCache_('tasks');
  return results;
}

/**
 * 指定日数（デフォルト30日）を超えた完了・期間満了ルーティンを安全にパージ
 * ※ステータスが「完了」「期間満了」（またはレガシーexpired）かつ完了日が基準日未満の行のみ削除し、「有効」は絶対に保持する
 * @param {number=} retentionDays 保持日数（デフォルト30日）
 */
function cleanOldRoutines(retentionDays) {
  const days = (typeof retentionDays === 'number' && retentionDays > 0) ? retentionDays : 30;
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.ROUTINES);
  if (sheet.getLastRow() <= 1) return;

  const now = new Date();
  const cutoffDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  const cutoffStr = Utilities.formatDate(cutoffDate, 'Asia/Tokyo', 'yyyy-MM-dd');

  const routines = getRoutines();
  const rowsToDelete = [];
  for (let i = 0; i < routines.length; i++) {
    const r = routines[i];
    const isFinished = (r.status === '完了' || r.status === '期間満了' || r.type === 'expired');
    if (!isFinished) continue;

    const refDateStr = r.completedDate || r.lastGeneratedDate;
    if (refDateStr && refDateStr < cutoffStr) {
      rowsToDelete.push(r.rowIndex);
    }
  }

  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    sheet.deleteRow(rowsToDelete[i]);
  }
  if (rowsToDelete.length > 0) {
    Logger.log(`[cleanOldRoutines] ${rowsToDelete.length} 件の古い完了・期間満了ルーティン(${days}日超過)を削除しました`);
  }
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
  if (_reqSheetCache.shopping) {
    return filterStatus ? _reqSheetCache.shopping.filter(s => s.status === filterStatus) : _reqSheetCache.shopping.slice();
  }
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

  _reqSheetCache.shopping = list.slice();
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
  invalidateSheetCache_('shopping');
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.SHOPPING);
  const todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const results = [];

  for (let i = 0; i < actions.length; i++) {
    const act = actions[i];
    if (!act || !act.action) continue;

    if (act.action === 'add' && act.item) {
      appendRowSafely_(sheet, [act.item, act.category || '日用品', '未買', todayStr]);
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
    } else if (act.action === 'delete' && act.item) {
      const items = getShoppingList();
      for (let j = 0; j < items.length; j++) {
        const it = items[j];
        if (it.status === '未買' && it.item.includes(act.item)) {
          sheet.getRange(it.rowIndex, 3).setValue('破棄');
          results.push(`🛒 買物削除: ${it.item}`);
          break;
        }
      }
    }
  }
  invalidateSheetCache_('shopping');
  invalidateSheetCache_('tasks');
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
  if (_reqSheetCache.inputStock) {
    return filterStatus ? _reqSheetCache.inputStock.filter(i => i.status === filterStatus) : _reqSheetCache.inputStock.slice();
  }
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.INPUT_STOCK);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const numCols = Math.max(5, Math.min(sheet.getLastColumn(), 6));
  const values = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
  const list = values.map((row, index) => {
    const consumedInfo = formatSheetDateAndTimestamp_(row[4]);
    const type = String(row[0] || '');
    const parsedMins = numCols >= 6 ? parsePositiveEstimatedMins_(row[5]) : null;
    return {
      rowIndex: index + 2,
      type: type,
      title: String(row[1]),
      memo: String(row[2]),
      status: String(row[3]),
      consumedDate: consumedInfo.dateStr,
      consumedTimestampStr: consumedInfo.timestampStr,
      estimatedMins: parsedMins || getDefaultInputStockEstimatedMins_(type)
    };
  });

  _reqSheetCache.inputStock = list.slice();
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
  invalidateSheetCache_('inputStock');
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.INPUT_STOCK);
  const results = [];

  for (let i = 0; i < actions.length; i++) {
    const act = actions[i];
    if (!act || !act.action) continue;

    if (act.action === 'add' && act.title) {
      const estMins = parsePositiveEstimatedMins_(act.estimated_mins) || getDefaultInputStockEstimatedMins_(act.type);
      appendRowSafely_(sheet, [act.type || '映画', act.title, act.memo || '', '未', '', estMins]);
      results.push(`🎬 インプット追加: ${act.title}${estMins ? ` (${estMins}分)` : ''}`);
    } else if (act.action === 'update' && (act.title || act.target_title)) {
      const target = String(act.target_title || act.title || '').trim();
      const list = getInputStockList();
      for (let j = 0; j < list.length; j++) {
        const item = list[j];
        if (item.status === '未' && (item.title === target || item.title.includes(target) || target.includes(item.title))) {
          let changed = false;
          if (act.estimated_mins !== undefined) {
            const nextMins = parsePositiveEstimatedMins_(act.estimated_mins);
            if (nextMins) {
              sheet.getRange(item.rowIndex, 6).setValue(nextMins);
              changed = true;
            }
          }
          if (act.memo !== undefined) {
            sheet.getRange(item.rowIndex, 3).setValue(String(act.memo || '').trim());
            changed = true;
          }
          if (changed) {
            results.push(`🎬 インプット更新: ${item.title}${act.estimated_mins ? ` (${parsePositiveEstimatedMins_(act.estimated_mins)}分)` : ''}`);
          }
          break;
        }
      }
    } else if (act.action === 'complete' && act.title) {
      const list = getInputStockList();
      for (let j = 0; j < list.length; j++) {
        const item = list[j];
        if (item.status === '未' && item.title.includes(act.title)) {
          const consumedAtStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
          sheet.getRange(item.rowIndex, 4).setValue('完');
          sheet.getRange(item.rowIndex, 5).setValue(consumedAtStr);
          results.push(`🎬 インプット完了: ${item.title}`);
          break;
        }
      }
    } else if (act.action === 'delete' && act.title) {
      const list = getInputStockList();
      for (let j = 0; j < list.length; j++) {
        const item = list[j];
        if (item.status === '未' && item.title.includes(act.title)) {
          sheet.getRange(item.rowIndex, 4).setValue('破棄');
          results.push(`🎬 インプット削除: ${item.title}`);
          break;
        }
      }
    }
  }
  invalidateSheetCache_('tasks');
  return results;
}

/**
 * タイムスタンプ文字列が未明（00:00〜02:59）に該当するか判定
 * @param {string} timestampStr 'yyyy-MM-dd HH:mm:ss'
 * @return {boolean}
 * @private
 */
function isEarlyMorningTimestampStr_(timestampStr) {
  return /\s0[0-2]:/.test(String(timestampStr || '').trim());
}

/**
 * 指定ログ群の完了通知行に対象タイトルの完了記録が含まれるか判定（日付のみ格納分の境界切り分け用）
 * @param {Array<Object>} logsList
 * @param {string} title
 * @param {string} actionLabel '✅ タスク完了' | '🎬 インプット完了'
 * @return {boolean}
 * @private
 */
function hasActionCompletionInLogs_(logsList, title, actionLabel) {
  if (!logsList || logsList.length === 0 || !title) return false;
  const rawTitle = String(title).trim();
  const badgedTitle = (typeof formatTaskTitleWithBadge === 'function')
    ? formatTaskTitleWithBadge(rawTitle)
    : rawTitle;
  const plainBody = rawTitle.replace(/^\[[^\]]+\]\s*/, '').trim();

  return logsList.some(l => {
    const rawReply = `${String((l && l.aiReply) || '')}\n${(l && l.sender !== 'user') ? String(l.message || '') : ''}`;
    const completionLines = rawReply.split('\n').filter(line => line.includes(actionLabel));
    if (completionLines.length === 0) return false;
    const joined = completionLines.join('\n');
    return joined.includes(rawTitle) ||
      (badgedTitle && joined.includes(badgedTitle)) ||
      (plainBody && plainBody.length >= 2 && joined.includes(plainBody));
  });
}

/**
 * 完了タスク・消化ストックが 03:00〜翌02:59 の集計ウィンドウ内に属するか判定
 * @private
 */
function isItemInDailyWindow_(item, dateKey, tsKey, title, actionLabel, targetDateStr, nextDateStr, logsTargetEarly, logsTargetDay, logsNextEarly) {
  const itemDate = item[dateKey] || '';
  if (itemDate !== targetDateStr && itemDate !== nextDateStr) return false;

  const ts = String(item[tsKey] || '').trim();
  const hasExplicitTime = ts.includes(' ') && !ts.endsWith(' 00:00:00');
  if (hasExplicitTime) {
    const isEarly = isEarlyMorningTimestampStr_(ts);
    return itemDate === targetDateStr ? !isEarly : isEarly;
  }

  // 時刻情報がない既存データ・Webアプリ更新分のフォールバック:
  // targetDate未明(00:00〜02:59)に完了ログがあり日中以降に再完了していなければ前日分とみなして除外
  if (itemDate === targetDateStr) {
    const inTargetEarly = hasActionCompletionInLogs_(logsTargetEarly, title, actionLabel);
    const inTargetDay = hasActionCompletionInLogs_(logsTargetDay, title, actionLabel);
    return !(inTargetEarly && !inTargetDay);
  }

  // nextDate側の日付のみデータは、未明(00:00〜02:59)の完了ログ一致または深夜バッチ時間帯(03時台まで)のみ採用
  if (hasActionCompletionInLogs_(logsNextEarly, title, actionLabel)) return true;
  const now = new Date();
  const nowDateStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
  const nowHour = parseInt(Utilities.formatDate(now, 'Asia/Tokyo', 'H'), 10);
  return nowDateStr === nextDateStr && nowHour < 4;
}

/**
 * 03:00〜翌02:59 の1日境界で対象日のログ・完了タスク・消化インプットを一括抽出（前日未明との二重計上を防止）
 * @param {string} targetDateStr 'yyyy-MM-dd'
 * @param {Array<Object>=} preloadedTasksOpt 事前取得済みタスク配列
 * @return {Object} { nextDateStr, logs, completedTasks, consumedInputs }
 */
function getDailyReportWindowData_(targetDateStr, preloadedTasksOpt) {
  const targetAnchor = new Date(`${targetDateStr}T12:00:00+09:00`);
  const nextDateStr = Utilities.formatDate(
    new Date(targetAnchor.getTime() + 24 * 60 * 60 * 1000),
    'Asia/Tokyo',
    'yyyy-MM-dd'
  );

  const logsTargetRaw = getLogs(targetDateStr);
  const logsTargetEarly = logsTargetRaw.filter(l => isEarlyMorningTimestampStr_(l.timestampStr));
  const logsTargetDay = logsTargetRaw.filter(l => !isEarlyMorningTimestampStr_(l.timestampStr));
  const logsNextEarly = getLogs(nextDateStr).filter(l => isEarlyMorningTimestampStr_(l.timestampStr));
  const logs = logsTargetDay.concat(logsNextEarly);

  const tasks = preloadedTasksOpt || getTasks();
  const completedTasks = tasks.filter(t =>
    t.status === '完了' &&
    isItemInDailyWindow_(t, 'completedDate', 'completedTimestampStr', t.title, '✅ タスク完了', targetDateStr, nextDateStr, logsTargetEarly, logsTargetDay, logsNextEarly)
  );

  const inputStock = getInputStockList();
  const consumedInputs = inputStock.filter(inp =>
    inp.status === '完' &&
    isItemInDailyWindow_(inp, 'consumedDate', 'consumedTimestampStr', inp.title, '🎬 インプット完了', targetDateStr, nextDateStr, logsTargetEarly, logsTargetDay, logsNextEarly)
  );

  return {
    nextDateStr: nextDateStr,
    logs: logs,
    completedTasks: completedTasks,
    consumedInputs: consumedInputs
  };
}
