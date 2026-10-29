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
        lines.push(`AI: ${cleanedReply}`);
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
 * タスク一覧を取得
 * @param {string} filterStatus オプション（未完了 / 完了 / 破棄）
 * @return {Array<Object>}
 */
function getTasks(filterStatus) {
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.TASKS);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const numCols = Math.max(7, Math.min(sheet.getLastColumn(), 8));
  const values = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
  const tasks = values.map((row, index) => ({
    rowIndex: index + 2,
    id: String(row[0]),
    title: String(row[1]),
    dueDate: row[2] ? Utilities.formatDate(new Date(row[2]), 'Asia/Tokyo', 'yyyy-MM-dd') : '',
    status: String(row[3]),
    createdDate: row[4] ? Utilities.formatDate(new Date(row[4]), 'Asia/Tokyo', 'yyyy-MM-dd') : '',
    completedDate: row[5] ? Utilities.formatDate(new Date(row[5]), 'Asia/Tokyo', 'yyyy-MM-dd') : '',
    memo: String(row[6] || ''),
    remindContext: row[7] ? String(row[7]).trim() : ''
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
 * Geminiレスポンスに基づくタスク操作を適用（8列目「リマインド目安」対応）
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
      const memo = act.memo ? String(act.memo).trim() : '';
      const remindContext = normalizeTaskRemindContext_(act.title, act.remind_context);
      appendRowSafely_(sheet, [taskId, act.title, dueDate, '未完了', todayStr, '', memo, remindContext]);
      const formattedTitle = formatTaskTitleWithBadge(act.title);
      results.push(`📝 タスク追加: ${formattedTitle}${dueDate ? ` (期限: ${dueDate})` : ''}`);
    } else if (act.action === 'update') {
      const tasks = getTasks();
      const searchTitle = act.target_title || act.title || '';
      for (let j = 0; j < tasks.length; j++) {
        const t = tasks[j];
        if (t.status === '未完了') {
          const matchById = act.task_id && t.id === act.task_id;
          const matchByTitle = searchTitle && (t.title.includes(searchTitle) || searchTitle.includes(t.title));
          if (matchById || matchByTitle) {
            const newTitle = (act.new_title || act.title || t.title).trim();
            const newDue = act.due_date !== undefined ? String(act.due_date || '').trim() : t.dueDate;
            const newMemo = act.memo !== undefined ? String(act.memo || '').trim() : t.memo;
            sheet.getRange(t.rowIndex, 2).setValue(newTitle);
            sheet.getRange(t.rowIndex, 3).setValue(newDue);
            sheet.getRange(t.rowIndex, 7).setValue(newMemo);
            if (act.remind_context !== undefined) {
              const newRemind = normalizeTaskRemindContext_(newTitle, act.remind_context);
              sheet.getRange(t.rowIndex, 8).setValue(newRemind);
            }
            const formattedTitle = formatTaskTitleWithBadge(newTitle);
            results.push(`📝 タスク更新: ${formattedTitle}${newDue ? ` (期限: ${newDue})` : ''}`);
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
      appendRowSafely_(sheet, [act.title, type, value, '', act.memo || '']);
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
      appendRowSafely_(sheet, [act.type || '映画', act.title, act.memo || '', '未', '']);
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
    system_prompt: '',
    custom_system_prompt: '',
    rolling_memory: '',
    dictionary: '',
    ideal_self: '',
    lifestyle_habits: '',
    skill_options: '',
    system_mode: 'AB_TEST',
    prompt_lite: '',
    prompt_core: '',
    prompt_phase_a: '',
    prompt_phase_b: '',
    prompt_phase_c: '',
    prompt_phase_d: '',
    prompt_db: '',
    prompt_relief: ''
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
      } else if (key === 'system_mode' || key === 'ab_test_mode') {
        const upper = val.toUpperCase();
        if (upper === 'OLD') {
          memoryObj.system_mode = 'OLD';
        } else if (upper === 'NEW' || upper === 'FALSE') {
          memoryObj.system_mode = 'NEW';
        } else {
          memoryObj.system_mode = 'AB_TEST';
        }
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
  appendRowSafely_(sheet, [key, String(value)]);
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
 * cycle_stamps の特定項目を既存の他のスタンプを破壊せずに安全にマージ更新
 * @param {string} updatesText 例: "外歩き・散歩: 2026-10-29"
 */
function updateCycleStampsSafely(updatesText) {
  if (!updatesText || typeof updatesText !== 'string' || !updatesText.trim()) return;
  const currentMemory = getMemory();
  const existingRaw = (currentMemory.cycle_stamps || '').trim();

  const parseEntries = (text) => {
    const map = {};
    const order = [];
    const lines = text.split(/[,\n]+/).map(s => s.trim()).filter(s => s.length > 0);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^([^:：]+)[：:]\s*(.+)$/);
      if (m) {
        const key = m[1].replace(/^[・\-\s]+/, '').trim();
        const val = m[2].trim();
        if (key) {
          if (!map.hasOwnProperty(key)) order.push(key);
          map[key] = val;
        }
      }
    }
    return { map: map, order: order };
  };

  const existing = parseEntries(existingRaw);
  const incoming = parseEntries(updatesText);

  for (let i = 0; i < incoming.order.length; i++) {
    const k = incoming.order[i];
    if (!existing.map.hasOwnProperty(k)) {
      existing.order.push(k);
    }
    existing.map[k] = incoming.map[k];
  }

  const mergedLines = existing.order.map(k => `${k}: ${existing.map[k]}`);
  setMemoryValue('cycle_stamps', mergedLines.join('\n'));
}

/**
 * lifestyle_habits テキストから登録済みの見出しトピック一覧（例: ['入浴', '食事', '身支度', ...]）を動的に抽出
 * @param {string} lifestyleHabitsText
 * @return {Array<string>}
 */
function extractHabitTopicsList(lifestyleHabitsText) {
  if (!lifestyleHabitsText || typeof lifestyleHabitsText !== 'string') return [];
  const topics = [];
  const lines = lifestyleHabitsText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].trim().match(/^\[([^\]]+)\]/);
    if (match && match[1]) {
      const topic = match[1].trim();
      if (topic && topics.indexOf(topic) === -1) {
        topics.push(topic);
      }
    }
  }
  return topics;
}

/**
 * lifestyle_habits テキストから指定されたトピック名に合致するエントリー行のみをピンポイント抽出
 * @param {string} lifestyleHabitsText
 * @param {string} matchedTopic 例: "入浴" または "[入浴]"
 * @return {string}
 */
function extractHabitEntryByTopic(lifestyleHabitsText, matchedTopic) {
  if (!lifestyleHabitsText || !matchedTopic || matchedTopic === 'none') return '';
  const cleanTarget = String(matchedTopic).replace(/[\[\]]/g, '').trim();
  if (!cleanTarget || cleanTarget === 'none') return '';

  const lines = lifestyleHabitsText.split('\n');
  const matchedLines = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(/^\[([^\]]+)\]/);
    if (match && match[1].trim() === cleanTarget) {
      matchedLines.push(line);
    }
  }
  return matchedLines.join('\n');
}

/**
 * 未完了タスク配列をコンテキスト注入用の高密度文字列に整形（リマインド目安・7日超過警告付き）
 * @param {Array<Object>} uncompletedTasks
 * @param {Date} todayDate
 * @return {string}
 */
function formatUncompletedTasksForContext(uncompletedTasks, todayDate) {
  if (!uncompletedTasks || uncompletedTasks.length === 0) return 'なし';
  const taskLines = uncompletedTasks.map(t => {
    let warningTag = '';
    if (t.createdDate && todayDate) {
      const parts = t.createdDate.split('-');
      if (parts.length === 3) {
        const cDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        const diffDays = Math.floor((todayDate.getTime() - cDate.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays >= 7) {
          warningTag = ' [⚠️登録後7日以上経過]';
        }
      }
    }
    const remindPart = (t.remindContext && t.remindContext.trim()) ? ` [目安:${t.remindContext.trim()}]` : '';
    const memoPart = (t.memo && t.memo.trim()) ? ` (メモ:${t.memo.trim()})` : '';
    return `[${t.id}] ${t.title}${t.dueDate ? ' (期限:' + t.dueDate + ')' : ''}${remindPart}${memoPart}${warningTag}`;
  });
  return taskLines.join(' / ');
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
 * 会話履歴テキストから直近のログ記録時刻（HH:mm）を抽出
 * @param {string} todayLogsText
 * @return {string|null}
 */
function extractLastLogTime(todayLogsText) {
  if (!todayLogsText || typeof todayLogsText !== 'string') return null;
  const lines = todayLogsText.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i].match(/^(\d{1,2}:\d{2})/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

/**
 * 直前のやり取り時刻と現在日時の差分を計算し、経過時間テキストを生成
 * @param {string|null} lastTimeStr 'HH:mm'
 * @param {Date} nowDate
 * @return {string}
 */
function formatElapsedTime(lastTimeStr, nowDate) {
  if (!lastTimeStr) return 'なし（本日初回の発言）';
  const parts = lastTimeStr.split(':');
  const lastMinutes = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();

  let diff = nowMinutes - lastMinutes;
  if (diff < 0) {
    diff += 24 * 60; // 日またぎ
  }

  if (diff < 1) {
    return '1分未満（直前のやり取り直後）';
  } else if (diff < 60) {
    return `${diff}分経過`;
  } else {
    const hours = Math.floor(diff / 60);
    const mins = diff % 60;
    return `${hours}時間${mins > 0 ? mins + '分' : ''}経過（計${diff}分）`;
  }
}

/**
 * Geminiへ送信用にスプレッドシートの現在状態を高密度テキスト（トークン最小化）として抽出
 * @param {string=} queryText ユーザー発言等の判定対象テキスト
 * @param {string=} todayLogsText 本日の会話履歴テキスト（辞書抽出の対象に含める）
 * @param {Date=} simulatedNowDate シミュレーション用の現在日時（過去時点テスト用。省略時はnew Date()）
 * @return {string}
 */
function getSpreadsheetContext(queryText, todayLogsText, simulatedNowDate) {
  const now = simulatedNowDate || new Date();
  const nowStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd(E) HH:mm');
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const memory = getMemory();
  const uncompletedTasks = getTasks('未完了');
  const unboughtShopping = getShoppingList('未買');
  const pendingInput = getInputStockList('未');

  let weatherDisplay = memory.weather_info || '情報なし';
  if (typeof hasOfficeEventToday === 'function' && !hasOfficeEventToday() && weatherDisplay.includes('｜')) {
    weatherDisplay = weatherDisplay.split('｜')[0].trim();
  }

  // --- 【静的・準静的コンテキスト（プレフィックス安定化・キャッシュ適合）】 ---
  // ※プロファイル・理念・用語辞書・記憶・タスク等を先頭に集約し、プレフィックス共通部分を4,096トークン以上に最大化する
  let context = `【プロファイル】: ${memory.profile || '未設定'}\n`;
  if (memory.ideal_self && memory.ideal_self.trim() !== '') {
    context += `【ありたい人間像・生活指針（判断の羅針盤）】: ${memory.ideal_self.trim()}\n`;
  }
  context += `【天気・気温】: ${weatherDisplay}\n`;
  context += `【気圧急降下】: ${memory.pressure_alert === 'TRUE' ? '急降下中(注意)' : '安定'}\n`;

  // 用語辞書: 今回の発言・当日ログ・プロファイル・直近バッファ・未完了タスク・未消化ストックに含まれる用語のみを
  // オンデマンド抽出して注入（無関係な辞書項目のトークン消費をカットしつつ誤認を防止）
  if (memory.dictionary && memory.dictionary.trim() !== '') {
    const taskTitlesText = uncompletedTasks.map(t => t.title).join(' ');
    const inputTitlesText = pendingInput.map(inp => inp.title).join(' ');
    const searchTarget = `${queryText || ''}\n${todayLogsText || ''}\n${memory.profile || ''}\n${memory.rolling_memory || ''}\n${taskTitlesText}\n${inputTitlesText}`;
    const relevantDict = filterRelevantDictionaryEntries(memory.dictionary, searchTarget);
    if (relevantDict) {
      context += `【用語辞書（客観的前提知識・誤認防止）】:\n${relevantDict}\n`;
    }
  }
  if (memory.rolling_memory) {
    context += `【直近活動・関心バッファ】:\n${memory.rolling_memory}\n`;
  }
  if (memory.weekly_summary) {
    context += `【直近1〜2週間の生活・活動サマリー】: ${memory.weekly_summary}\n`;
  }
  if (memory.monthly_report_ready === 'TRUE') {
    context += `【月報通知フラグ】: TRUE\n`;
  }
  if (memory.cycle_stamps && memory.cycle_stamps.trim() !== '') {
    context += `【活動・メンテナンス最終記録（cycle_stamps）】:\n${memory.cycle_stamps.trim()}\n`;
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
      const memoPart = (t.memo && t.memo.trim()) ? ` (メモ:${t.memo.trim()})` : '';
      return `[${t.id}] ${t.title}${t.dueDate ? ' (期限:' + t.dueDate + ')' : ''}${memoPart}${warningTag}`;
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

  // 4. ルーティン設定マスタは「ルーティン」「定期」「習慣」が話題に出た時のみオンデマンド注入
  if (queryText && /(ルーティン|定期|習慣)/.test(queryText)) {
    const routines = getRoutines();
    if (routines.length > 0) {
      const routineItems = routines.map(r => `${r.ruleName}(${r.type}:${r.value})`);
      context += `登録済み定期ルーティン: ${routineItems.join(', ')}\n`;
    }
  }

  // --- 【動的コンテキスト（毎分可変）】 ---
  // ※分単位で変化する現在日時・経過時間は末尾に配置し、先行する静的情報のプレフィックスキャッシュを保護する
  context += `【現在日時】: ${nowStr}\n`;
  const lastTimeStr = extractLastLogTime(todayLogsText);
  const elapsedStr = formatElapsedTime(lastTimeStr, now);
  context += `【直前のやり取りからの経過時間】: ${elapsedStr}\n`;

  return context.trim();
}
