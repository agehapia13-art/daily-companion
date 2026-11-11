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
  const initialTab = params.tab || 'chat';
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
      apiSendCompanionMessage: apiSendCompanionMessage,
      apiBufferCompanionImage: apiBufferCompanionImage,
      apiRemoveBufferedImage: apiRemoveBufferedImage,
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
    // プレフィックス抽出（[大分類] 内容 または 大分類：内容 形式）
    let prefix = 'その他';
    let cleanTitle = t.title || '';
    const bracketMatch = cleanTitle.match(/^\[([^\]]+)\]\s*(.+)$/);
    if (bracketMatch) {
      prefix = bracketMatch[1].trim();
      cleanTitle = bracketMatch[2].trim();
    } else {
      const colonMatch = cleanTitle.match(/^([^：:]{1,20})[：:]\s*(.+)$/);
      if (colonMatch) {
        prefix = colonMatch[1].trim();
        cleanTitle = colonMatch[2].trim();
      }
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
      memo: t.memo || '',
      docUrl: t.docUrl || ''
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

  // 6. 当日の統合会話ログ（LINE・PWA共通）＋ バッファ中画像（ショートカット・LINE先行画像）
  const todayLogs = buildTodayLogsForDashboard_(todayStr);
  const bufferedImages = getBufferedImageMetadata();

  return {
    authorized: true,
    validKey: getDashboardAccessKey(),
    liffId: getNormalizedLiffId(),
    todayStr: todayStr,
    tasks: enrichedTasks,
    shopping: shopping,
    inputStock: inputStock,
    routines: routines,
    todayLogs: todayLogs,
    bufferedImages: bufferedImages,
    memory: {
      profile: memory.profile || '',
      lifestyle_habits: memory.lifestyle_habits || '',
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
 * AI返信文字列から本体本文・実行通知バッジ・Googleドキュメント/Driveリンクを構造化抽出
 * @param {string} rawReply
 * @return {{ aiText: string, notices: Array<string>, docLinks: Array<{ label: string, url: string }> }}
 */
function parseAiReplyForDashboard_(rawReply) {
  const lines = String(rawReply || '').split('\n');
  const bodyLines = [];
  const notices = [];
  const docLinks = [];
  const seenUrls = {};
  const noticePattern = /^(📝|✅|🗑️|📅|🛒|🎬|💡|🔄|📁|📄|🔗)\s+/;
  const docUrlRegex = /(https:\/\/(?:docs\.google\.com\/document|drive\.google\.com\/drive\/folders)\/[^\s)\]]+)/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (noticePattern.test(trimmed)) {
      let noticeText = trimmed;
      const matches = trimmed.match(docUrlRegex);
      if (matches && matches.length > 0) {
        for (let m = 0; m < matches.length; m++) {
          const url = matches[m];
          if (!seenUrls[url]) {
            seenUrls[url] = true;
            let cleanLabel = trimmed
              .replace(url, '')
              .replace(/\(\s*\)|（\s*）/g, '')
              .replace(/^((?:📁|📄|🔗)\s*(?:資料作成|フォルダ作成|資料|フォルダ|タスク紐付)?[:：]?\s*)/, '')
              .replace(/[(（]\s*$/, '')
              .trim();
            if (!cleanLabel) {
              cleanLabel = url.indexOf('/folders/') !== -1 ? 'Driveフォルダを開く' : '関連資料を開く';
            }
            docLinks.push({ label: cleanLabel, url: url });
          }
          noticeText = noticeText.replace(url, '').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim();
        }
      }
      if (noticeText) {
        notices.push(noticeText);
      }
    } else {
      bodyLines.push(line);
    }
  }

  return {
    aiText: bodyLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    notices: notices,
    docLinks: docLinks
  };
}

/**
 * 指定日（当日）の logs シートをPWAタイムライン向けに整形して返す
 * @param {string} targetDateStr yyyy-MM-dd
 * @return {Array<Object>}
 */
function buildTodayLogsForDashboard_(targetDateStr) {
  const rawLogs = getLogs(targetDateStr);
  const items = [];

  for (let i = 0; i < rawLogs.length; i++) {
    const entry = rawLogs[i];
    const tsStr = String(entry.timestampStr || '');
    const hhmm = tsStr.length >= 16 ? tsStr.substring(11, 16) : '';

    // [画像内容: ...] サマリは検索・文脈用メタ情報のため吹き出し表示からは除去
    let userText = String(entry.message || '')
      .replace(/\n?\[画像内容:[\s\S]*$/g, '')
      .trim();

    const imageUrls = String(entry.imageUrl || '')
      .split('\n')
      .map(u => u.trim())
      .filter(Boolean);

    const parsedAi = parseAiReplyForDashboard_(entry.aiReply || '');

    items.push({
      id: `LOG_${i}_${hhmm}`,
      timestamp: tsStr,
      time: hhmm,
      sender: entry.sender || 'user',
      userText: userText,
      imageUrls: imageUrls,
      aiText: parsedAi.aiText,
      notices: parsedAi.notices,
      docLinks: parsedAi.docLinks
    });
  }

  return items;
}

/**
 * PWAチャットから伴走AIへメッセージを送信し、DB更新・ログ保存・最新ダッシュボードデータを返す
 * @param {string} authKey
 * @param {Object} payload { promptText, displayText, images?: Array<{ base64, mimeType }>, consumeBuffer?: boolean }
 * @return {Object}
 */
function apiSendCompanionMessage(authKey, payload) {
  if (!verifyDashboardAccess(authKey)) {
    return { authorized: false, error: '認証キーが正しくありません。' };
  }

  const opts = payload || {};
  const promptText = String(opts.promptText || '').trim();
  const displayText = opts.displayText !== undefined ? String(opts.displayText).trim() : promptText;
  const rawImages = Array.isArray(opts.images) ? opts.images : [];
  const consumeBuffer = opts.consumeBuffer !== false;

  const inlineImages = [];
  for (let i = 0; i < rawImages.length; i++) {
    const img = rawImages[i];
    if (!img || !img.base64) continue;
    const decoded = decodeBase64ImageToBlob_(img.base64, img.mimeType || 'image/jpeg', 'pwa_img');
    inlineImages.push({
      blob: decoded.blob,
      fileName: decoded.fileName
    });
  }

  const hasBuffered = consumeBuffer && getBufferedImageEntries().length > 0;
  if (!promptText && inlineImages.length === 0 && !hasBuffered) {
    throw new Error('送信するメッセージまたは画像がありません。');
  }

  const turnRes = executeAndPersistCompanionTurn_({
    promptText: promptText,
    displayText: displayText,
    inlineImages: inlineImages,
    consumeBuffer: consumeBuffer,
    allowErrorFallback: false
  });

  if (!turnRes.isGeminiSuccess) {
    return {
      authorized: true,
      turnSuccess: false,
      errorCode: turnRes.errorCode,
      errorMessage: turnRes.errorMessage
    };
  }

  return {
    authorized: true,
    turnSuccess: true,
    dashboard: apiGetDashboardData(authKey)
  };
}

/**
 * iOSショートカット（共有シート）等から画像を先行バッファリングするAPI
 * @param {string} authKey
 * @param {string} base64Data
 * @param {string=} mimeType
 * @return {Object}
 */
function apiBufferCompanionImage(authKey, base64Data, mimeType) {
  if (!verifyDashboardAccess(authKey)) {
    return { authorized: false, error: '認証キーが正しくありません。' };
  }
  const saved = saveBase64ImageToDrive(base64Data, mimeType || 'image/jpeg', 'shortcut_img');
  addImageIdToBuffer(saved.fileId);
  return {
    authorized: true,
    fileId: saved.fileId,
    url: saved.url,
    previewUrl: saved.url,
    bufferedImages: getBufferedImageMetadata()
  };
}

/**
 * バッファに待機中の画像を個別キャンセルするAPI
 * @param {string} authKey
 * @param {string} fileId
 * @return {Object}
 */
function apiRemoveBufferedImage(authKey, fileId) {
  if (!verifyDashboardAccess(authKey)) {
    return { authorized: false, error: '認証キーが正しくありません。' };
  }
  const res = removeImageIdFromBuffer(fileId);
  return {
    authorized: true,
    removed: res.removed,
    bufferedImages: getBufferedImageMetadata()
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
  if (prefix && !fullTitle.startsWith('[') && !fullTitle.includes('：') && !fullTitle.includes(':')) {
    fullTitle = `[${prefix}] ${fullTitle}`;
  }

  const dueDate = (payload.dueDate || '').trim();
  const memo = (payload.memo || '').trim();
  const docUrl = (payload.docUrl || '').trim();
  const remindContext = (typeof normalizeTaskRemindContext_ === 'function')
    ? normalizeTaskRemindContext_(fullTitle, '')
    : '';

  appendRowSafely_(sheet, [taskId, fullTitle, dueDate, '未完了', todayStr, '', memo, remindContext, docUrl]);
  return { success: true, taskId: taskId };
}

/**
 * タスクの内容（タイトル・期限・メモ・関連URL）を編集
 * @param {string} authKey
 * @param {Object} payload { taskId, fullTitle, dueDate, memo, docUrl }
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
      if (payload.docUrl !== undefined) sheet.getRange(row, 9).setValue((payload.docUrl || '').trim());
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
  appendRowSafely_(sheet, [item.trim(), (category || '日用品').trim(), '未買', todayStr]);
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
  appendRowSafely_(sheet, [
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
  appendRowSafely_(sheet, [
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
  const allowedKeys = [
    'profile', 'lifestyle_habits', 'dictionary', 'rolling_memory', 'weekly_summary', 'cycle_stamps',
    'custom_system_prompt', 'prompt_lite', 'prompt_core', 'prompt_phase_a', 'prompt_phase_b',
    'prompt_phase_c', 'prompt_phase_d', 'prompt_db', 'prompt_relief'
  ];
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
  const b64 = "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";
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
  <meta name="theme-color" content="#F6F3EC" id="metaThemeColor">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <link rel="manifest" href="./manifest.json">
  <link rel="icon" type="image/svg+xml" href="./icon.svg">
  <link rel="apple-touch-icon" href="./icon.svg">
  <script charset="utf-8" src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
  <style>
    :root {
      --dc-bg-base: #F6F3EC;
      --dc-bg-header: rgba(246, 243, 236, 0.9);
      --dc-bg-elevated: #FCFBF8;
      --dc-bg-subtle: #EDE8DF;
      --dc-bg-hover: #E5DFD3;
      --dc-bg-input: #F2EFE7;
      --dc-border-soft: rgba(46, 44, 41, 0.08);
      --dc-border-strong: rgba(46, 44, 41, 0.14);
      --dc-text-main: #2A2825;
      --dc-text-sub: #6B6760;
      --dc-text-muted: #989288;

      --dc-sage-main: #4F6653;
      --dc-sage-on: #FFFFFF;
      --dc-sage-text: #3A4E3E;
      --dc-sage-light: #E8F0E9;
      --dc-sage-light-soft: rgba(232, 240, 233, 0.65);
      --dc-sage-border: rgba(79, 102, 83, 0.28);

      --dc-terracotta: #B85D43;
      --dc-terracotta-text: #7A3421;
      --dc-terracotta-sub: #6B4236;
      --dc-terracotta-light: #F9ECE7;
      --dc-terracotta-border: rgba(184, 93, 67, 0.28);

      --dc-amber: #9E7442;
      --dc-amber-text: #78542C;
      --dc-amber-light: #F6EFE3;
      --dc-amber-border: rgba(158, 116, 66, 0.28);

      --dc-violet: #524A7E;
      --dc-violet-light: #ECEAF7;
      --dc-violet-border: rgba(82, 74, 126, 0.25);

      --dc-teal: #2B5E53;
      --dc-teal-light: #E4F1ED;
      --dc-teal-border: rgba(43, 94, 83, 0.26);

      --dc-blue: #2C5E8A;
      --dc-blue-light: #EAF1F8;
      --dc-blue-border: rgba(44, 94, 138, 0.22);

      --dc-user-bubble-bg: #4F6653;
      --dc-user-bubble-text: #FFFFFF;
      --dc-user-pill-bg: rgba(255, 255, 255, 0.92);
      --dc-user-pill-text: #2A2825;
      --dc-user-pill-border: rgba(255, 255, 255, 0.45);

      --dc-banner-bg: rgba(38, 36, 33, 0.94);
      --dc-banner-text: #FAF8F4;
      --dc-banner-border: rgba(255, 255, 255, 0.14);

      --dc-shadow-card: 0 1px 2px rgba(42, 40, 37, 0.04);
      --dc-composer-shadow: 0 -2px 12px rgba(42, 40, 37, 0.04);
    }

    body.dc-dark {
      --dc-bg-base: #141714;
      --dc-bg-header: rgba(24, 27, 24, 0.9);
      --dc-bg-elevated: #1D211D;
      --dc-bg-subtle: #262B26;
      --dc-bg-hover: #2E342E;
      --dc-bg-input: #171A17;
      --dc-border-soft: rgba(255, 255, 255, 0.07);
      --dc-border-strong: rgba(255, 255, 255, 0.14);
      --dc-text-main: #EAE7E0;
      --dc-text-sub: #A5A199;
      --dc-text-muted: #76736C;

      --dc-sage-main: #729478;
      --dc-sage-on: #0F1410;
      --dc-sage-text: #B8D4BD;
      --dc-sage-light: #223025;
      --dc-sage-light-soft: rgba(34, 48, 37, 0.8);
      --dc-sage-border: rgba(114, 148, 120, 0.36);

      --dc-terracotta: #E0866B;
      --dc-terracotta-text: #F2B5A3;
      --dc-terracotta-sub: #D6A293;
      --dc-terracotta-light: #33201B;
      --dc-terracotta-border: rgba(224, 134, 107, 0.32);

      --dc-amber: #CEA26B;
      --dc-amber-text: #E5C496;
      --dc-amber-light: #30271C;
      --dc-amber-border: rgba(206, 162, 107, 0.32);

      --dc-violet: #B6AFE3;
      --dc-violet-light: #27243A;
      --dc-violet-border: rgba(182, 175, 227, 0.3);

      --dc-teal: #7CC2B3;
      --dc-teal-light: #1C302B;
      --dc-teal-border: rgba(124, 194, 179, 0.3);

      --dc-blue: #89BBE6;
      --dc-blue-light: #1B2936;
      --dc-blue-border: rgba(137, 187, 230, 0.28);

      --dc-user-bubble-bg: #364D3B;
      --dc-user-bubble-text: #F4F7F4;
      --dc-user-pill-bg: rgba(18, 22, 18, 0.62);
      --dc-user-pill-text: #E2EFE4;
      --dc-user-pill-border: rgba(184, 212, 189, 0.32);

      --dc-banner-bg: rgba(32, 36, 32, 0.94);
      --dc-banner-text: #EAE7E0;
      --dc-banner-border: rgba(255, 255, 255, 0.14);

      --dc-shadow-card: 0 1px 3px rgba(0, 0, 0, 0.24);
      --dc-composer-shadow: 0 -2px 14px rgba(0, 0, 0, 0.28);
    }

    *, *::before, *::after {
      box-sizing: border-box;
      -webkit-tap-highlight-color: transparent;
    }

    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      background-color: var(--dc-bg-base);
      color: var(--dc-text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
      -webkit-font-smoothing: antialiased;
      transition: background-color 0.22s ease, color 0.22s ease;
    }

    button {
      font-family: inherit;
      border: none;
      background: transparent;
      color: inherit;
      padding: 0;
      cursor: pointer;
    }

    .is-hidden {
      display: none !important;
    }

    .no-scrollbar::-webkit-scrollbar {
      display: none;
    }
    .no-scrollbar {
      -ms-overflow-style: none;
      scrollbar-width: none;
    }

    /* App Shell */
    .dc-shell {
      width: 100%;
      height: 100vh;
      height: 100dvh;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      position: relative;
      overflow: hidden;
      background-color: var(--dc-bg-base);
    }

    @media (min-width: 1200px) {
      .dc-shell {
        max-width: 1200px;
        border-left: 1px solid var(--dc-border-soft);
        border-right: 1px solid var(--dc-border-soft);
      }
    }

    /* Slim Quiet Header */
    .dc-header {
      height: 48px;
      padding: 0 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background-color: var(--dc-bg-header);
      border-bottom: 1px solid var(--dc-border-soft);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      flex-shrink: 0;
      z-index: 20;
    }

    .dc-header-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .dc-logo-mark {
      width: 24px;
      height: 24px;
      border-radius: 8px;
      background-color: var(--dc-sage-light);
      color: var(--dc-sage-main);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .dc-brand-title {
      font-size: 15px;
      font-weight: 600;
      letter-spacing: -0.01em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .dc-header-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .dc-icon-btn {
      width: 32px;
      height: 32px;
      border-radius: 999px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--dc-text-sub);
      transition: transform 0.14s ease, opacity 0.18s ease, background-color 0.18s ease;
    }
    .dc-icon-btn:hover {
      background-color: var(--dc-bg-subtle);
    }
    .dc-icon-btn:active {
      transform: scale(0.94);
    }

    @keyframes dcSpin {
      to { transform: rotate(360deg); }
    }
    .dc-spinning svg {
      animation: dcSpin 0.9s linear infinite;
    }

    /* Responsive Workspace Grid */
    .dc-workspace {
      flex: 1;
      min-height: 0;
      min-width: 0;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: 1fr auto auto;
      grid-template-areas:
        "main"
        "composer"
        "nav";
    }

    .dc-split-tabs {
      display: none;
      grid-area: cardtabs;
      min-width: 0;
      padding: 6px 10px;
      gap: 4px;
      align-items: center;
      background-color: var(--dc-bg-elevated);
      border-left: 1px solid var(--dc-border-soft);
      border-bottom: 1px solid var(--dc-border-soft);
    }

    .dc-chat-pane {
      grid-area: main;
      min-height: 0;
      min-width: 0;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 12px 16px 24px;
    }

    .dc-cards-pane {
      grid-area: main;
      min-height: 0;
      min-width: 0;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 12px 16px 24px;
    }

    .dc-composer-pane {
      grid-area: composer;
      min-width: 0;
      position: relative;
      z-index: 30;
      padding: 10px 12px;
      background-color: var(--dc-bg-elevated);
      border-top: 1px solid var(--dc-border-soft);
      box-shadow: var(--dc-composer-shadow);
    }

    .dc-bottom-nav {
      grid-area: nav;
      min-width: 0;
      display: flex;
      justify-content: space-around;
      align-items: center;
      padding: 6px 6px max(6px, env(safe-area-inset-bottom));
      background-color: var(--dc-bg-elevated);
      border-top: 1px solid var(--dc-border-soft);
      z-index: 30;
    }

    .dc-mobile-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 2px;
      margin-bottom: 10px;
    }

    .dc-mobile-heading h2 {
      margin: 0;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--dc-text-muted);
    }

    @media (min-width: 768px) {
      .dc-workspace {
        grid-template-columns: minmax(0, 1.05fr) minmax(340px, 0.95fr);
        grid-template-rows: auto 1fr auto;
        grid-template-areas:
          "chat cardtabs"
          "chat cards"
          "composer cards";
      }
      .dc-split-tabs {
        display: flex;
      }
      .dc-chat-pane {
        grid-area: chat;
        display: block !important;
        padding: 18px 22px 24px;
      }
      .dc-cards-pane {
        grid-area: cards;
        display: block !important;
        border-left: 1px solid var(--dc-border-soft);
        background-color: var(--dc-bg-base);
        padding: 16px 18px 24px;
      }
      .dc-composer-pane {
        padding: 10px 18px max(12px, env(safe-area-inset-bottom));
      }
      .dc-bottom-nav,
      .dc-mobile-heading {
        display: none !important;
      }
    }

    @media (min-width: 1024px) {
      .dc-workspace {
        grid-template-columns: minmax(0, 1.25fr) minmax(390px, 450px);
      }
    }

    /* Navigation Tabs */
    .dc-tab-btn {
      flex: 1;
      padding: 4px;
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      transition: background-color 0.18s ease, color 0.18s ease;
      color: var(--dc-text-muted);
    }

    .dc-nav-btn {
      flex: 1;
      padding: 2px 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      color: var(--dc-text-muted);
      transition: color 0.18s ease;
    }

    .dc-nav-pill {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 28px;
      border-radius: 999px;
      transition: background-color 0.18s ease;
    }

    .dc-tab-icon-wrap {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .dc-nav-label {
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.02em;
      line-height: 1;
      white-space: nowrap;
    }

    .dc-badge {
      position: absolute;
      top: -3px;
      right: -8px;
      min-width: 14px;
      height: 14px;
      padding: 0 4px;
      border-radius: 999px;
      font-size: 9.5px;
      font-weight: 600;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: var(--dc-sage-main);
      color: var(--dc-sage-on);
    }

    .dc-nav-pill .dc-badge {
      top: -2px;
      right: 2px;
    }

    /* Chat Timeline & Bubbles */
    .dc-date-row {
      display: flex;
      justify-content: center;
      margin-bottom: 14px;
    }

    .dc-date-chip {
      font-size: 11px;
      font-weight: 500;
      padding: 3px 10px;
      border-radius: 999px;
      background-color: var(--dc-bg-subtle);
      color: var(--dc-text-muted);
    }

    .dc-timeline {
      min-width: 0;
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding-bottom: 8px;
    }

    .dc-chat-empty {
      text-align: center;
      padding: 36px 12px;
      font-size: 12.5px;
      color: var(--dc-text-muted);
    }

    .dc-msg-row {
      display: flex;
      flex-direction: column;
      min-width: 0;
      width: 100%;
    }
    .dc-msg-row.user {
      align-items: flex-end;
    }
    .dc-msg-row.ai {
      align-items: flex-start;
    }

    .dc-msg-bubble {
      min-width: 0;
      max-width: 84%;
      padding: 10px 14px;
      font-size: 14px;
      line-height: 1.62;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      word-break: break-word;
      box-shadow: var(--dc-shadow-card);
    }

    @media (min-width: 768px) {
      .dc-msg-bubble {
        max-width: 76%;
      }
    }

    .dc-msg-bubble.user {
      border-radius: 18px 18px 4px 18px;
      background-color: var(--dc-user-bubble-bg);
      color: var(--dc-user-bubble-text);
    }

    .dc-msg-bubble.ai {
      border-radius: 18px 18px 18px 4px;
      background-color: var(--dc-bg-elevated);
      color: var(--dc-text-main);
      border: 1px solid var(--dc-border-soft);
    }

    .dc-msg-bubble a,
    .dc-url-text {
      color: inherit;
      overflow-wrap: anywhere;
      word-break: break-all;
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .dc-msg-time {
      font-size: 11px;
      margin-top: 4px;
      padding: 0 4px;
      color: var(--dc-text-muted);
    }

    .dc-msg-imgs {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .dc-msg-imgs.grid-2 {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
    }
    .dc-msg-imgs.has-text {
      margin-bottom: 8px;
    }
    .dc-msg-img {
      width: 100%;
      max-height: 224px;
      object-fit: cover;
      border-radius: 12px;
      cursor: pointer;
      display: block;
      transition: opacity 0.16s ease;
    }
    .dc-msg-img:hover {
      opacity: 0.94;
    }

    .dc-notices-row {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--dc-border-soft);
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .dc-notice-chip {
      font-size: 11.5px;
      font-weight: 500;
      padding: 2px 8px;
      border-radius: 6px;
      background-color: var(--dc-sage-light);
      color: var(--dc-sage-text);
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .dc-doc-links {
      margin-top: 6px;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .dc-doc-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      font-weight: 500;
      padding: 4px 10px;
      border-radius: 8px;
      background-color: var(--dc-blue-light);
      color: var(--dc-blue);
      border: 1px solid var(--dc-blue-border);
      text-decoration: none !important;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .dc-error-card {
      max-width: 84%;
      border-radius: 18px 18px 18px 4px;
      padding: 10px 14px;
      font-size: 12px;
      background-color: var(--dc-terracotta-light);
      border: 1px solid var(--dc-terracotta-border);
      color: var(--dc-terracotta-text);
      display: flex;
      flex-direction: column;
      gap: 8px;
      box-shadow: var(--dc-shadow-card);
    }

    .dc-error-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--dc-terracotta);
    }

    .dc-error-desc {
      line-height: 1.55;
      color: var(--dc-terracotta-sub);
      overflow-wrap: anywhere;
    }

    .dc-err-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      padding-top: 2px;
    }

    .dc-btn-err-retry {
      padding: 5px 12px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 500;
      background-color: var(--dc-terracotta);
      color: #FFFFFF;
    }

    .dc-btn-err-restore {
      padding: 5px 12px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 500;
      background-color: var(--dc-bg-elevated);
      border: 1px solid var(--dc-terracotta-border);
      color: var(--dc-terracotta-text);
    }

    .dc-thinking-bubble {
      padding: 12px 16px;
      border-radius: 18px 18px 18px 4px;
      background-color: var(--dc-bg-elevated);
      border: 1px solid var(--dc-border-soft);
      display: inline-flex;
      align-items: center;
      gap: 6px;
      box-shadow: var(--dc-shadow-card);
    }

    /* Cards & Filters */
    .dc-cat-bar {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding-bottom: 4px;
      margin-bottom: 10px;
    }

    .dc-cat-pill {
      font-size: 12px;
      font-weight: 500;
      padding: 5px 12px;
      border-radius: 999px;
      white-space: nowrap;
      border: 1px solid var(--dc-border-soft);
      background-color: var(--dc-bg-elevated);
      color: var(--dc-text-sub);
      transition: background-color 0.16s ease, color 0.16s ease, border-color 0.16s ease;
    }
    .dc-cat-pill.active {
      background-color: var(--dc-sage-main);
      color: var(--dc-sage-on);
      border-color: var(--dc-sage-main);
    }

    .dc-card-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .dc-empty-cards {
      text-align: center;
      padding: 32px 12px;
      font-size: 12px;
      border-radius: 16px;
      border: 1px dashed var(--dc-border-soft);
      background-color: var(--dc-bg-elevated);
      color: var(--dc-text-muted);
    }

    .dc-card-item {
      position: relative;
      overflow: hidden;
      min-width: 0;
      border-radius: 16px;
      padding: 12px 14px;
      cursor: pointer;
      background-color: var(--dc-bg-elevated);
      border: 1px solid var(--dc-border-soft);
      box-shadow: var(--dc-shadow-card);
      transition: transform 0.14s ease, border-color 0.18s ease, background-color 0.18s ease;
    }
    .dc-card-item:hover {
      border-color: var(--dc-border-strong);
    }
    .dc-card-item:active {
      transform: scale(0.988);
    }

    .dc-card-accent {
      position: absolute;
      left: 0;
      top: 10px;
      bottom: 10px;
      width: 3px;
      border-radius: 0 3px 3px 0;
    }

    .dc-card-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      min-width: 0;
    }
    .dc-card-row.center {
      align-items: center;
    }

    .dc-card-body {
      flex: 1;
      min-width: 0;
    }

    .dc-card-title {
      font-size: 14px;
      font-weight: 500;
      line-height: 1.4;
      color: var(--dc-text-main);
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .dc-card-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 8px;
      margin-top: 4px;
      font-size: 11px;
      color: var(--dc-text-muted);
    }

    .dc-card-memo {
      margin-top: 6px;
      font-size: 12px;
      line-height: 1.5;
      color: var(--dc-text-sub);
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .dc-card-doc-link {
      display: inline-block;
      font-size: 11px;
      font-weight: 500;
      padding: 2px 8px;
      border-radius: 6px;
      background-color: var(--dc-blue-light);
      color: var(--dc-blue);
      text-decoration: none;
    }

    .dc-cycle-top {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .dc-cycle-label {
      font-size: 14px;
      font-weight: 500;
      color: var(--dc-text-main);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .dc-cycle-pill {
      font-size: 11px;
      font-weight: 500;
      padding: 2px 8px;
      border-radius: 999px;
      flex-shrink: 0;
    }

    .dc-insert-indicator {
      flex-shrink: 0;
      width: 24px;
      height: 24px;
      border-radius: 999px;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: var(--dc-bg-subtle);
      color: var(--dc-text-muted);
      transition: background-color 0.16s ease, color 0.16s ease;
    }

    /* Composer & Inline Variable Pills */
    .dc-media-menu {
      position: absolute;
      bottom: calc(100% + 8px);
      left: 12px;
      width: 176px;
      border-radius: 16px;
      padding: 6px;
      background-color: var(--dc-bg-elevated);
      border: 1px solid var(--dc-border-strong);
      box-shadow: 0 10px 26px rgba(0, 0, 0, 0.14);
      backdrop-filter: blur(10px);
      display: flex;
      flex-direction: column;
      gap: 2px;
      z-index: 40;
    }

    .dc-media-menu-btn {
      width: 100%;
      text-align: left;
      padding: 8px 10px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--dc-text-main);
    }
    .dc-media-menu-btn:hover {
      background-color: var(--dc-bg-subtle);
    }

    .dc-pending-strip {
      padding-bottom: 8px;
    }

    .dc-pending-list {
      display: flex;
      align-items: center;
      gap: 8px;
      overflow-x: auto;
      padding-top: 4px;
    }

    .dc-pending-item {
      position: relative;
      flex-shrink: 0;
      padding: 4px 4px 0 0;
    }

    .dc-pending-thumb {
      width: 56px;
      height: 56px;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid var(--dc-border-strong);
      cursor: pointer;
    }
    .dc-pending-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .dc-pending-remove {
      position: absolute;
      top: 0;
      right: 0;
      width: 17px;
      height: 17px;
      border-radius: 999px;
      background-color: rgba(0, 0, 0, 0.76);
      color: #FFFFFF;
      font-size: 11px;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(255, 255, 255, 0.25);
    }

    .dc-composer-row {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      min-width: 0;
    }

    .dc-circle-btn {
      flex-shrink: 0;
      width: 36px;
      height: 36px;
      border-radius: 999px;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: var(--dc-bg-subtle);
      color: var(--dc-text-sub);
      transition: transform 0.14s ease, background-color 0.18s ease, color 0.18s ease;
    }
    .dc-circle-btn:active {
      transform: scale(0.94);
    }

    .dc-composer-box {
      flex: 1;
      min-width: 0;
      border-radius: 16px;
      padding: 8px 14px;
      background-color: var(--dc-bg-input);
      border: 1px solid var(--dc-border-soft);
      transition: border-color 0.18s ease;
    }
    .dc-composer-box:focus-within {
      border-color: var(--dc-sage-border);
    }

    .shortcut-editor {
      min-height: 24px;
      max-height: 112px;
      overflow-y: auto;
      line-height: 1.65;
      overflow-wrap: anywhere;
      word-break: break-word;
      white-space: pre-wrap;
      outline: none;
      font-size: 14px;
      color: var(--dc-text-main);
    }

    .shortcut-editor:empty::before {
      content: attr(data-placeholder);
      color: var(--dc-text-muted);
      pointer-events: none;
    }

    .inline-var-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      max-width: 100%;
      background-color: var(--dc-sage-light);
      color: var(--dc-sage-text);
      border: 1px solid var(--dc-sage-border);
      border-radius: 7px;
      padding: 1px 7px;
      margin: 1px 2px;
      font-size: 12.5px;
      font-weight: 600;
      line-height: 1.4;
      vertical-align: baseline;
      user-select: none;
      cursor: default;
    }

    .inline-var-pill-label {
      min-width: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .inline-var-pill[data-kind="shopping"] {
      background-color: var(--dc-amber-light);
      color: var(--dc-amber-text);
      border-color: var(--dc-amber-border);
    }
    .inline-var-pill[data-kind="input"] {
      background-color: var(--dc-violet-light);
      color: var(--dc-violet);
      border-color: var(--dc-violet-border);
    }
    .inline-var-pill[data-kind="cycle"] {
      background-color: var(--dc-teal-light);
      color: var(--dc-teal);
      border-color: var(--dc-teal-border);
    }

    .dc-msg-bubble.user .inline-var-pill {
      background-color: var(--dc-user-pill-bg);
      color: var(--dc-user-pill-text);
      border-color: var(--dc-user-pill-border);
    }

    .inline-var-remove {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: 15px;
      height: 15px;
      border-radius: 999px;
      opacity: 0.65;
      cursor: pointer;
      font-size: 12px;
      line-height: 1;
    }
    .inline-var-remove:hover {
      opacity: 1;
      background-color: rgba(128, 128, 128, 0.2);
    }

    /* Toast, Lightbox & Settings/Auth Modals */
    .dc-toast {
      position: fixed;
      left: 50%;
      bottom: 84px;
      transform: translateX(-50%) translateY(8px);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease, transform 0.2s ease;
      z-index: 60;
      font-size: 12px;
      font-weight: 500;
      padding: 7px 14px;
      border-radius: 999px;
      background-color: var(--dc-banner-bg);
      color: var(--dc-banner-text);
      border: 1px solid var(--dc-banner-border);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
      white-space: nowrap;
      max-width: 88vw;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .dc-toast.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }

    .dc-lightbox {
      position: fixed;
      inset: 0;
      z-index: 80;
      background-color: rgba(0, 0, 0, 0.86);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      cursor: pointer;
    }
    .dc-lightbox img {
      max-width: 100%;
      max-height: 88vh;
      border-radius: 14px;
      object-fit: contain;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
    }

    .dc-overlay {
      position: fixed;
      inset: 0;
      z-index: 70;
      background-color: rgba(20, 22, 20, 0.48);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }

    .dc-modal-card {
      width: 100%;
      max-width: 420px;
      max-height: 88vh;
      overflow-y: auto;
      border-radius: 20px;
      padding: 20px;
      background-color: var(--dc-bg-elevated);
      border: 1px solid var(--dc-border-strong);
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.18);
    }

    .dc-modal-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 14px;
    }

    .dc-modal-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--dc-text-main);
    }

    .dc-field {
      margin-bottom: 12px;
    }
    .dc-label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: var(--dc-text-sub);
      margin-bottom: 5px;
    }
    .dc-input {
      width: 100%;
      padding: 9px 12px;
      border-radius: 12px;
      border: 1px solid var(--dc-border-strong);
      background-color: var(--dc-bg-input);
      color: var(--dc-text-main);
      font-size: 13.5px;
      outline: none;
    }
    .dc-input:focus {
      border-color: var(--dc-sage-main);
    }

    .dc-auth-err {
      margin-bottom: 12px;
      padding: 9px 12px;
      border-radius: 12px;
      font-size: 12px;
      line-height: 1.5;
      background-color: var(--dc-terracotta-light);
      color: var(--dc-terracotta-text);
      border: 1px solid var(--dc-terracotta-border);
    }

    .dc-btn-primary {
      width: 100%;
      padding: 10px 16px;
      border-radius: 12px;
      font-size: 13.5px;
      font-weight: 600;
      background-color: var(--dc-sage-main);
      color: var(--dc-sage-on);
      transition: opacity 0.16s ease, transform 0.14s ease;
    }
    .dc-btn-primary:active {
      transform: scale(0.985);
    }

    .dc-btn-secondary {
      padding: 7px 12px;
      border-radius: 10px;
      font-size: 12px;
      font-weight: 500;
      background-color: var(--dc-bg-subtle);
      color: var(--dc-text-main);
      border: 1px solid var(--dc-border-soft);
    }

    .dc-settings-section {
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid var(--dc-border-soft);
    }

    .dc-settings-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .dc-code-block {
      margin-top: 8px;
      padding: 8px 10px;
      border-radius: 10px;
      font-size: 11px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      background-color: var(--dc-bg-input);
      border: 1px solid var(--dc-border-soft);
      color: var(--dc-text-sub);
      overflow-wrap: anywhere;
      word-break: break-all;
      white-space: pre-wrap;
    }

    /* Animations */
    @keyframes msgSendUp {
      0% { opacity: 0; transform: translateY(14px) scale(0.96); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes msgReceivePop {
      0% { opacity: 0; transform: translateY(12px) scale(0.97); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes dotWave {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.35; }
      30% { transform: translateY(-4px); opacity: 1; }
    }
    @keyframes sendBtnPulse {
      0% { transform: scale(1); }
      40% { transform: scale(0.88); }
      80% { transform: scale(1.06); }
      100% { transform: scale(1); }
    }

    .anim-send-bubble {
      animation: msgSendUp 0.56s cubic-bezier(0.22, 1, 0.36, 1) forwards;
      transform-origin: bottom right;
    }
    .anim-receive-bubble {
      animation: msgReceivePop 0.62s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      transform-origin: bottom left;
    }
    .anim-send-btn {
      animation: sendBtnPulse 0.35s ease-out;
    }

    .thinking-dot {
      width: 6.5px;
      height: 6.5px;
      border-radius: 999px;
      background-color: var(--dc-sage-main);
      display: inline-block;
      animation: dotWave 1.5s infinite ease-in-out;
    }
    .thinking-dot:nth-child(2) { animation-delay: 0.2s; }
    .thinking-dot:nth-child(3) { animation-delay: 0.4s; }
  </style>
</head>
<body>

  <input type="file" id="photoLibraryInput" accept="image/*" multiple class="is-hidden" onchange="handleFilesSelected(this.files)">
  <input type="file" id="cameraCaptureInput" accept="image/*" capture="environment" class="is-hidden" onchange="handleFilesSelected(this.files)">

  <div id="dcShell" class="dc-shell">
    <!-- Lightbox -->
    <div id="imageLightbox" class="dc-lightbox is-hidden" onclick="closeImageLightbox()">
      <img id="lightboxImg" src="" alt="拡大画像">
    </div>

    <!-- Header -->
    <header class="dc-header">
      <div class="dc-header-brand">
        <span class="dc-logo-mark">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>
        </span>
        <span class="dc-brand-title">Daily Companion</span>
      </div>
      <div class="dc-header-actions">
        <button onclick="toggleTheme()" id="headerThemeBtn" class="dc-icon-btn" aria-label="テーマ切替"></button>
        <button onclick="refreshDashboardManual()" id="syncBtn" class="dc-icon-btn" aria-label="同期">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
        </button>
        <button onclick="openSettingsModal()" class="dc-icon-btn" aria-label="接続と設定">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
      </div>
    </header>

    <!-- Workspace Grid -->
    <div class="dc-workspace">
      <!-- Split Right-Pane Workspace Tabs (Tablet / PC) -->
      <div class="dc-split-tabs">
        <button onclick="switchTab('tasks')" id="split-nav-tasks" class="dc-tab-btn" title="Tasks" aria-label="Tasks">
          <span class="dc-tab-icon-wrap">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/></svg>
            <span id="split-badge-tasks" class="dc-badge is-hidden">0</span>
          </span>
          <span class="dc-nav-label">Tasks</span>
        </button>

        <button onclick="switchTab('shopping')" id="split-nav-shopping" class="dc-tab-btn" title="Shopping" aria-label="Shopping">
          <span class="dc-tab-icon-wrap">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>
            <span id="split-badge-shopping" class="dc-badge is-hidden">0</span>
          </span>
          <span class="dc-nav-label">Shopping</span>
        </button>

        <button onclick="switchTab('input')" id="split-nav-input" class="dc-tab-btn" title="Stock" aria-label="Stock">
          <span class="dc-tab-icon-wrap">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
            <span id="split-badge-input" class="dc-badge is-hidden">0</span>
          </span>
          <span class="dc-nav-label">Stock</span>
        </button>

        <button onclick="switchTab('cycles')" id="split-nav-cycles" class="dc-tab-btn" title="Habits" aria-label="Habits">
          <span class="dc-tab-icon-wrap">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"/><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/></svg>
          </span>
          <span class="dc-nav-label">Habits</span>
        </button>
      </div>

      <!-- Chat Panel -->
      <section id="panel-chat" class="dc-chat-pane">
        <div class="dc-date-row">
          <span id="chatDateChip" class="dc-date-chip">Today</span>
        </div>
        <div id="chatTimeline" class="dc-timeline"></div>
      </section>

      <!-- Cards Workspace Pane -->
      <div id="cardsPane" class="dc-cards-pane is-hidden">
        <section id="panel-tasks">
          <div class="dc-mobile-heading"><h2>Tasks</h2></div>
          <div id="taskCategoryBar" class="dc-cat-bar no-scrollbar"></div>
          <div id="taskListArea" class="dc-card-list"></div>
        </section>

        <section id="panel-shopping" class="is-hidden">
          <div class="dc-mobile-heading"><h2>Shopping</h2></div>
          <div id="shopListArea" class="dc-card-list"></div>
        </section>

        <section id="panel-input" class="is-hidden">
          <div class="dc-mobile-heading"><h2>Stock</h2></div>
          <div id="inputListArea" class="dc-card-list"></div>
        </section>

        <section id="panel-cycles" class="is-hidden">
          <div class="dc-mobile-heading"><h2>Habits</h2></div>
          <div id="cycleListArea" class="dc-card-list"></div>
        </section>
      </div>

      <!-- Persistent Composer -->
      <div class="dc-composer-pane">
        <div id="mediaAttachMenu" class="dc-media-menu is-hidden">
          <button onclick="openPhotoLibrary()" class="dc-media-menu-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
            <span>写真を選ぶ</span>
          </button>
          <button onclick="openCameraCapture()" class="dc-media-menu-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
            <span>カメラで撮影</span>
          </button>
        </div>

        <div id="pendingImagesStrip" class="dc-pending-strip is-hidden">
          <div id="pendingImagesList" class="dc-pending-list no-scrollbar"></div>
        </div>

        <div class="dc-composer-row">
          <button id="attachBtn" onclick="toggleMediaMenu(event)" class="dc-circle-btn" aria-label="画像を添付">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="3" ry="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
          </button>

          <div class="dc-composer-box">
            <div id="composerEditor" class="shortcut-editor" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="メッセージ"></div>
          </div>

          <button id="sendBtn" onclick="handleSendMessage()" class="dc-circle-btn" aria-label="送信">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>
          </button>
        </div>
      </div>

      <!-- Mobile Bottom Nav -->
      <nav class="dc-bottom-nav">
        <button onclick="switchTab('chat')" id="nav-chat" class="dc-nav-btn" aria-label="Chat">
          <span id="nav-pill-chat" class="dc-nav-pill">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>
          </span>
          <span class="dc-nav-label">Chat</span>
        </button>

        <button onclick="switchTab('tasks')" id="nav-tasks" class="dc-nav-btn" aria-label="Tasks">
          <span id="nav-pill-tasks" class="dc-nav-pill">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/></svg>
            <span id="badge-tasks" class="dc-badge is-hidden">0</span>
          </span>
          <span class="dc-nav-label">Tasks</span>
        </button>

        <button onclick="switchTab('shopping')" id="nav-shopping" class="dc-nav-btn" aria-label="Shopping">
          <span id="nav-pill-shopping" class="dc-nav-pill">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>
            <span id="badge-shopping" class="dc-badge is-hidden">0</span>
          </span>
          <span class="dc-nav-label">Shopping</span>
        </button>

        <button onclick="switchTab('input')" id="nav-input" class="dc-nav-btn" aria-label="Stock">
          <span id="nav-pill-input" class="dc-nav-pill">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
            <span id="badge-input" class="dc-badge is-hidden">0</span>
          </span>
          <span class="dc-nav-label">Stock</span>
        </button>

        <button onclick="switchTab('cycles')" id="nav-cycles" class="dc-nav-btn" aria-label="Habits">
          <span id="nav-pill-cycles" class="dc-nav-pill">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"/><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/></svg>
          </span>
          <span class="dc-nav-label">Habits</span>
        </button>
      </nav>
    </div>

    <!-- Boot Loading Overlay -->
    <div id="loadingOverlay" class="dc-overlay is-hidden">
      <div class="dc-thinking-bubble">
        <span class="thinking-dot"></span>
        <span class="thinking-dot"></span>
        <span class="thinking-dot"></span>
      </div>
    </div>

    <!-- Settings & Auth Modal -->
    <div id="settingsModal" class="dc-overlay is-hidden" onclick="if(event.target===this && state.authorized) closeSettingsModal()">
      <div class="dc-modal-card">
        <div class="dc-modal-head">
          <div class="dc-modal-title">接続・通知設定</div>
          <button id="settingsCloseBtn" onclick="closeSettingsModal()" class="dc-icon-btn" aria-label="閉じる">✕</button>
        </div>

        <div id="authErrorMsg" class="dc-auth-err is-hidden"></div>

        <div id="apiUrlGroup" class="dc-field">
          <label class="dc-label" for="apiUrlInput">GAS ウェブアプリ URL</label>
          <input type="url" id="apiUrlInput" class="dc-input" placeholder="https://script.google.com/macros/s/.../exec" autocomplete="off">
        </div>

        <div class="dc-field">
          <label class="dc-label" for="authKeyInput">アクセスキー（LINE User ID 末尾6文字など）</label>
          <input type="text" id="authKeyInput" class="dc-input" placeholder="例: a1b2c3" autocomplete="off">
        </div>

        <button onclick="submitSettingsAndConnect()" class="dc-btn-primary">接続して読み込む</button>

        <div class="dc-settings-section">
          <div class="dc-settings-row">
            <div>
              <div style="font-size:13px;font-weight:500;">返信通知</div>
              <div id="notifyStatusText" style="font-size:11.5px;color:var(--dc-text-muted);margin-top:2px;">状態を確認中...</div>
            </div>
            <button id="notifyPermBtn" onclick="requestNotificationOptIn()" class="dc-btn-secondary">有効にする</button>
          </div>
        </div>

        <div class="dc-settings-section">
          <details>
            <summary style="font-size:12.5px;font-weight:500;color:var(--dc-text-sub);cursor:pointer;">iOSショートカット共有レシピ（任意）</summary>
            <div style="font-size:11.5px;color:var(--dc-text-sub);line-height:1.55;margin-top:8px;">
              共有シートの画像をそのまま待機欄へ送る POST 先・JSON 形式です。アプリを開くと入力欄に画像が待機します。
            </div>
            <div id="shortcutRecipeCode" class="dc-code-block"></div>
            <button onclick="copyShortcutRecipe()" class="dc-btn-secondary" style="margin-top:8px;">JSONテンプレートをコピー</button>
          </details>
        </div>
      </div>
    </div>

    <div id="toastBar" class="dc-toast"></div>
  </div>

  <script>
    var INITIAL_TAB = ${JSON.stringify(initialTab || 'chat')};
    var SERVER_PRE_KEY = ${JSON.stringify(validKey || '')};
    var SERVER_LIFF_ID = ${JSON.stringify(liffId || '')};

    var SVG_SUN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
    var SVG_MOON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
    var SVG_PLUS = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
    var SVG_CHECK = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

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

    function normalizeTabName(rawTab) {
      if (!rawTab) return 'chat';
      if (rawTab === 'memory') return 'cycles';
      if (['chat', 'tasks', 'shopping', 'input', 'cycles'].indexOf(rawTab) !== -1) return rawTab;
      return 'chat';
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
          if (v && !result[k]) result[k] = v;
        }
        var nested = sp.get('liff.state');
        if (nested) {
          try { nested = decodeURIComponent(nested); } catch (e) {}
          var qIdx = nested.indexOf('?');
          parseQuery(qIdx >= 0 ? nested.substring(qIdx + 1) : nested);
        }
      };
      parseQuery(window.location.search);
      if (window.location.hash && window.location.hash.indexOf('=') >= 0) {
        parseQuery(window.location.hash);
      }
      return result;
    }

    var urlParams = getEffectiveParams();
    var initialNormalizedTab = normalizeTabName(urlParams.tab || INITIAL_TAB);
    var savedTheme = '';
    try { savedTheme = localStorage.getItem('companion_theme') || ''; } catch (e) {}
    var osDark = Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

    var state = {
      theme: savedTheme || (osDark ? 'dark' : 'light'),
      authKey: (urlParams.key || SERVER_PRE_KEY || localStorage.getItem('companion_auth_key') || '').trim(),
      apiUrl: (urlParams.api || localStorage.getItem('companion_api_url') || '').trim(),
      liffId: normalizeLiffId(urlParams.liffId || SERVER_LIFF_ID || localStorage.getItem('companion_liff_id') || ''),
      authorized: false,
      activeMobileTab: initialNormalizedTab,
      activeCardTab: initialNormalizedTab !== 'chat' ? initialNormalizedTab : 'tasks',
      selectedCategory: 'ALL',
      savedRange: null,
      isSending: false,
      isRefreshing: false,
      lastFetchedAt: 0,
      lastFailedPayloads: {},
      pendingImages: [],
      bufferedImages: [],
      messages: [],
      data: null,
      toastTimer: null
    };

    var editor = document.getElementById('composerEditor');
    var shellEl = document.getElementById('dcShell');

    function isGasEnvironment() {
      return Boolean(window.google && google.script && google.script.run);
    }

    function applyTheme() {
      var isDark = state.theme === 'dark';
      document.body.classList.toggle('dc-dark', isDark);
      var btn = document.getElementById('headerThemeBtn');
      if (btn) btn.innerHTML = isDark ? SVG_SUN : SVG_MOON;
      var meta = document.getElementById('metaThemeColor');
      if (meta) meta.setAttribute('content', isDark ? '#141714' : '#F6F3EC');
    }

    function toggleTheme() {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('companion_theme', state.theme); } catch (e) {}
      applyTheme();
    }

    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) {
        mq.addEventListener('change', function(e) {
          var manual = '';
          try { manual = localStorage.getItem('companion_theme') || ''; } catch (err) {}
          if (!manual) {
            state.theme = e.matches ? 'dark' : 'light';
            applyTheme();
          }
        });
      }
    }

    function syncParamsFromUrl() {
      var p = getEffectiveParams();
      if (p.key) {
        state.authKey = p.key.trim();
        try { localStorage.setItem('companion_auth_key', state.authKey); } catch (e) {}
      }
      if (p.api) {
        state.apiUrl = p.api.trim();
        try { localStorage.setItem('companion_api_url', state.apiUrl); } catch (e) {}
      }
      if (p.liffId) {
        state.liffId = normalizeLiffId(p.liffId);
        if (state.liffId) {
          try { localStorage.setItem('companion_liff_id', state.liffId); } catch (e) {}
        }
      }
      if (p.tab) {
        var norm = normalizeTabName(p.tab);
        state.activeMobileTab = norm;
        if (norm !== 'chat') state.activeCardTab = norm;
      }
    }

    var isLiffReady = false;
    var liffInitPromise = null;
    function initLiff() {
      if (!window.liff || !state.liffId) return null;
      if (!liffInitPromise) {
        liffInitPromise = liff.init({ liffId: state.liffId })
          .then(function() {
            isLiffReady = true;
            syncParamsFromUrl();
          })
          .catch(function(err) {
            liffInitPromise = null;
            throw err;
          });
      }
      return liffInitPromise;
    }

    function callServerApi(funcName) {
      var args = Array.prototype.slice.call(arguments, 1);
      return new Promise(function(resolve, reject) {
        if (isGasEnvironment()) {
          var runner = google.script.run
            .withSuccessHandler(function(res) { resolve(res); })
            .withFailureHandler(function(err) { reject(err); });
          runner[funcName].apply(runner, args);
          return;
        }
        if (!state.apiUrl) {
          reject(new Error('GAS ウェブアプリURLが設定されていません'));
          return;
        }
        fetch(state.apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ apiAction: funcName, args: args }),
          redirect: 'follow'
        })
          .then(function(response) {
            if (!response.ok) throw new Error('HTTPエラー: ' + response.status);
            return response.json();
          })
          .then(function(json) {
            if (json && json.ok === false) {
              throw new Error(json.error || 'サーバーエラーが発生しました');
            }
            resolve(json && json.ok === true ? json.data : json);
          })
          .catch(function(err) { reject(err); });
      });
    }

    window.addEventListener('DOMContentLoaded', async function() {
      applyTheme();
      syncParamsFromUrl();
      if (state.authKey) {
        try { localStorage.setItem('companion_auth_key', state.authKey); } catch (e) {}
      }
      if (state.apiUrl) {
        try { localStorage.setItem('companion_api_url', state.apiUrl); } catch (e) {}
      }
      if (state.liffId) {
        try { localStorage.setItem('companion_liff_id', state.liffId); } catch (e) {}
      }

      if (!isGasEnvironment() && 'serviceWorker' in navigator && window.location.protocol === 'https:') {
        navigator.serviceWorker.register('./sw.js').catch(function() {});
      }

      syncVisiblePanels();

      if (window.liff && state.liffId) {
        try {
          await initLiff();
          syncParamsFromUrl();
        } catch (liffErr) {}
      }

      var needsApiUrl = !isGasEnvironment() && !state.apiUrl;
      var needsAuthKey = !state.authKey;
      if (needsApiUrl || needsAuthKey) {
        openSettingsModal();
      } else {
        loadData({ showBootLoader: true });
      }
    });

    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible' && state.authorized && !state.isSending && !state.isRefreshing) {
        if (Date.now() - state.lastFetchedAt > 8000) {
          loadData({ silent: true });
        }
      }
    });

    function setSyncSpinning(active) {
      var btn = document.getElementById('syncBtn');
      if (btn) btn.classList.toggle('dc-spinning', Boolean(active));
    }

    function hydrateFromDashboard(res, animateLatestAi) {
      state.authorized = true;
      state.data = res;
      state.lastFetchedAt = Date.now();
      if (res.validKey) {
        state.authKey = res.validKey;
        try { localStorage.setItem('companion_auth_key', res.validKey); } catch (e) {}
      }
      if (res.liffId) {
        var cleanId = normalizeLiffId(res.liffId);
        if (cleanId && cleanId !== state.liffId) {
          state.liffId = cleanId;
          try { localStorage.setItem('companion_liff_id', cleanId); } catch (e) {}
        }
      }

      // Today chip
      var chip = document.getElementById('chatDateChip');
      if (chip && res.todayStr) {
        chip.textContent = formatDateChip(res.todayStr);
      }

      // Buffered images (Shortcut / LINE pre-sent)
      state.bufferedImages = Array.isArray(res.bufferedImages) ? res.bufferedImages : [];

      // Rebuild message list from server todayLogs (preserving any local un-cleared error card)
      var existingErrors = state.messages.filter(function(m) { return m.sender === 'error'; });
      var nextMessages = [];
      var logs = Array.isArray(res.todayLogs) ? res.todayLogs : [];

      for (var i = 0; i < logs.length; i++) {
        var log = logs[i];
        var hasUserImgs = Array.isArray(log.imageUrls) && log.imageUrls.length > 0;
        if (log.userText || hasUserImgs) {
          nextMessages.push({
            id: log.id + '_U',
            sender: 'user',
            time: log.time || '',
            html: log.userText ? linkifyEscapedText(log.userText) : '',
            images: (log.imageUrls || []).map(function(u) {
              return { dataUrl: u, label: '画像' };
            })
          });
        }
        if (log.aiText || (log.notices && log.notices.length > 0) || (log.docLinks && log.docLinks.length > 0)) {
          var isLastAi = animateLatestAi && (i === logs.length - 1);
          nextMessages.push({
            id: log.id + '_A',
            sender: 'ai',
            time: log.time || '',
            text: log.aiText || '',
            notices: log.notices || [],
            docLinks: log.docLinks || [],
            animateReceive: isLastAi
          });
        }
      }

      if (existingErrors.length > 0) {
        nextMessages = nextMessages.concat(existingErrors);
      }

      var prevLen = state.messages.length;
      state.messages = nextMessages;
      renderAll();
      if (animateLatestAi || prevLen === 0) {
        scrollToChatBottom();
      }
    }

    function loadData(opts) {
      var options = opts || {};
      if (state.isRefreshing) return;
      state.isRefreshing = true;
      setSyncSpinning(true);
      if (options.showBootLoader) {
        document.getElementById('loadingOverlay').classList.remove('is-hidden');
      }

      var finished = false;
      var timeoutId = setTimeout(function() {
        if (!finished) {
          finished = true;
          state.isRefreshing = false;
          setSyncSpinning(false);
          document.getElementById('loadingOverlay').classList.add('is-hidden');
          if (!state.authorized) {
            openSettingsModal('サーバー応答がタイムアウトしました。URLとネットワークをご確認ください。');
          } else if (!options.silent) {
            showToast('同期がタイムアウトしました');
          }
        }
      }, 15000);

      callServerApi('apiGetDashboardData', state.authKey)
        .then(function(res) {
          if (finished) return;
          finished = true;
          clearTimeout(timeoutId);
          state.isRefreshing = false;
          setSyncSpinning(false);
          document.getElementById('loadingOverlay').classList.add('is-hidden');

          if (!res || !res.authorized) {
            if (!options.isRetry) {
              syncParamsFromUrl();
              if (state.authKey) {
                loadData({ showBootLoader: options.showBootLoader, isRetry: true, silent: options.silent });
                return;
              }
            }
            state.authorized = false;
            openSettingsModal((res && res.error) ? res.error : '認証に失敗しました。');
            return;
          }

          closeSettingsModal();
          hydrateFromDashboard(res, false);
          if (options.manualFeedback) {
            showToast('同期しました');
          }
        })
        .catch(function(err) {
          if (finished) return;
          finished = true;
          clearTimeout(timeoutId);
          state.isRefreshing = false;
          setSyncSpinning(false);
          document.getElementById('loadingOverlay').classList.add('is-hidden');
          if (!state.authorized) {
            openSettingsModal('通信エラー: ' + (err.message || err));
          } else if (!options.silent) {
            showToast('同期に失敗しました');
          }
        });
    }

    function refreshDashboardManual() {
      if (!state.authKey || (!isGasEnvironment() && !state.apiUrl)) {
        openSettingsModal();
        return;
      }
      loadData({ manualFeedback: true });
    }

    // Settings & Auth Modal
    function openSettingsModal(errMsg) {
      var modal = document.getElementById('settingsModal');
      var apiGroup = document.getElementById('apiUrlGroup');
      var apiInput = document.getElementById('apiUrlInput');
      var keyInput = document.getElementById('authKeyInput');
      var closeBtn = document.getElementById('settingsCloseBtn');
      var errEl = document.getElementById('authErrorMsg');

      if (apiGroup) apiGroup.classList.toggle('is-hidden', isGasEnvironment());
      if (apiInput && state.apiUrl) apiInput.value = state.apiUrl;
      if (keyInput && state.authKey) keyInput.value = state.authKey;
      if (closeBtn) closeBtn.classList.toggle('is-hidden', !state.authorized);

      if (errMsg) {
        errEl.textContent = errMsg;
        errEl.classList.remove('is-hidden');
      } else {
        errEl.classList.add('is-hidden');
      }

      updateNotificationSettingsUI();
      updateShortcutRecipePreview();
      modal.classList.remove('is-hidden');
    }

    function closeSettingsModal() {
      document.getElementById('settingsModal').classList.add('is-hidden');
    }

    function submitSettingsAndConnect() {
      var apiInput = document.getElementById('apiUrlInput');
      var keyInput = document.getElementById('authKeyInput');
      var apiVal = apiInput ? apiInput.value.trim() : '';
      var keyVal = keyInput ? keyInput.value.trim() : '';

      if (!isGasEnvironment()) {
        if (apiVal) {
          state.apiUrl = apiVal;
          try { localStorage.setItem('companion_api_url', apiVal); } catch (e) {}
        }
        if (!state.apiUrl) {
          openSettingsModal('GAS ウェブアプリURLを入力してください。');
          return;
        }
      }
      if (keyVal) {
        state.authKey = keyVal;
        try { localStorage.setItem('companion_auth_key', keyVal); } catch (e) {}
      }
      if (!state.authKey) {
        openSettingsModal('アクセスキーを入力してください。');
        return;
      }

      document.getElementById('authErrorMsg').classList.add('is-hidden');
      loadData({ showBootLoader: true });
    }

    function updateNotificationSettingsUI() {
      var statusEl = document.getElementById('notifyStatusText');
      var btnEl = document.getElementById('notifyPermBtn');
      if (!statusEl || !btnEl) return;

      if (!('Notification' in window)) {
        statusEl.textContent = 'この環境では通知を利用できません';
        btnEl.classList.add('is-hidden');
        return;
      }
      if (Notification.permission === 'granted') {
        statusEl.textContent = 'オン（バックグラウンド受信時に通知）';
        btnEl.textContent = '設定済み';
        btnEl.disabled = true;
      } else if (Notification.permission === 'denied') {
        statusEl.textContent = 'ブラウザ設定で通知がブロックされています';
        btnEl.textContent = '設定不可';
        btnEl.disabled = true;
      } else {
        statusEl.textContent = 'オフ（返信到着をOS通知でお知らせ）';
        btnEl.textContent = '有効にする';
        btnEl.disabled = false;
        btnEl.classList.remove('is-hidden');
      }
    }

    function requestNotificationOptIn() {
      if (!('Notification' in window)) return;
      Notification.requestPermission().then(function(perm) {
        updateNotificationSettingsUI();
        if (perm === 'granted') showToast('通知を有効にしました');
      }).catch(function() {});
    }

    function getShortcutRecipePayloadText() {
      return JSON.stringify({
        apiAction: 'apiBufferCompanionImage',
        args: [state.authKey || '<ACCESS_KEY>', '<BASE64_ENCODED_IMAGE>', 'image/jpeg']
      }, null, 2);
    }

    function updateShortcutRecipePreview() {
      var el = document.getElementById('shortcutRecipeCode');
      if (!el) return;
      var endpoint = state.apiUrl || (isGasEnvironment() ? window.location.href.split('?')[0] : 'https://script.google.com/macros/s/.../exec');
      el.textContent = 'POST ' + endpoint + '\\n' + getShortcutRecipePayloadText();
    }

    function copyShortcutRecipe() {
      var text = getShortcutRecipePayloadText();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function() {
          showToast('コピーしました');
        }).catch(function() {
          showToast('コピーできませんでした');
        });
      }
    }

    // Navigation & Split Sync
    function isSplitViewport() {
      return window.innerWidth >= 768;
    }

    window.addEventListener('resize', function() {
      syncVisiblePanels();
    });

    function switchTab(tab) {
      var norm = normalizeTabName(tab);
      state.activeMobileTab = norm;
      if (norm !== 'chat') state.activeCardTab = norm;
      syncVisiblePanels();
      renderAll();
    }

    function syncVisiblePanels() {
      var isSplit = isSplitViewport();
      var chatPane = document.getElementById('panel-chat');
      var cardsPane = document.getElementById('cardsPane');

      if (isSplit) {
        chatPane.classList.remove('is-hidden');
        cardsPane.classList.remove('is-hidden');
      } else {
        var showChat = state.activeMobileTab === 'chat';
        chatPane.classList.toggle('is-hidden', !showChat);
        cardsPane.classList.toggle('is-hidden', showChat);
      }

      var targetCardTab = isSplit ? state.activeCardTab : state.activeMobileTab;
      ['tasks', 'shopping', 'input', 'cycles'].forEach(function(t) {
        var sec = document.getElementById('panel-' + t);
        if (sec) sec.classList.toggle('is-hidden', t !== targetCardTab);
      });

      ['chat', 'tasks', 'shopping', 'input', 'cycles'].forEach(function(t) {
        var nav = document.getElementById('nav-' + t);
        var pill = document.getElementById('nav-pill-' + t);
        if (!nav || !pill) return;
        var active = (t === state.activeMobileTab);
        nav.style.color = active ? 'var(--dc-sage-main)' : 'var(--dc-text-muted)';
        pill.style.backgroundColor = active ? 'var(--dc-sage-light)' : 'transparent';
      });

      ['tasks', 'shopping', 'input', 'cycles'].forEach(function(t) {
        var snav = document.getElementById('split-nav-' + t);
        if (!snav) return;
        var active = (t === state.activeCardTab);
        snav.style.backgroundColor = active ? 'var(--dc-sage-light)' : 'transparent';
        snav.style.color = active ? 'var(--dc-sage-text)' : 'var(--dc-text-muted)';
      });
    }

    // Image Attachment, Tall-Screenshot Aware Compression, Paste & D&D
    function toggleMediaMenu(ev) {
      ev.stopPropagation();
      document.getElementById('mediaAttachMenu').classList.toggle('is-hidden');
    }

    document.addEventListener('click', function(ev) {
      var menu = document.getElementById('mediaAttachMenu');
      var btn = document.getElementById('attachBtn');
      if (menu && !menu.classList.contains('is-hidden')) {
        if (!menu.contains(ev.target) && !btn.contains(ev.target)) {
          menu.classList.add('is-hidden');
        }
      }
    });

    function openPhotoLibrary() {
      document.getElementById('mediaAttachMenu').classList.add('is-hidden');
      var input = document.getElementById('photoLibraryInput');
      input.value = '';
      input.click();
    }

    function openCameraCapture() {
      document.getElementById('mediaAttachMenu').classList.add('is-hidden');
      var input = document.getElementById('cameraCaptureInput');
      input.value = '';
      input.click();
    }

    function compressImageToJpeg(file) {
      return new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.onload = function(e) {
          var img = new Image();
          img.onload = function() {
            var w = img.width;
            var h = img.height;
            var longEdge = Math.max(w, h);
            var shortEdge = Math.max(1, Math.min(w, h));
            var aspect = longEdge / shortEdge;

            if (aspect > 2.2) {
              if (shortEdge > 1120) {
                var ratio = 1120 / shortEdge;
                w = Math.round(w * ratio);
                h = Math.round(h * ratio);
              }
              var pixels = w * h;
              if (pixels > 3200000) {
                var pScale = Math.sqrt(3200000 / pixels);
                w = Math.round(w * pScale);
                h = Math.round(h * pScale);
              }
            } else if (longEdge > 1600) {
              var scale = 1600 / longEdge;
              w = Math.round(w * scale);
              h = Math.round(h * scale);
            }

            w = Math.max(1, w);
            h = Math.max(1, h);
            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext('2d');
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);

            var dataUrl = canvas.toDataURL('image/jpeg', 0.84);
            resolve({
              dataUrl: dataUrl,
              base64: dataUrl.split(',')[1] || '',
              mimeType: 'image/jpeg'
            });
          };
          img.onerror = reject;
          img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    async function handleFilesSelected(fileList) {
      if (!fileList || fileList.length === 0) return;
      var files = Array.from(fileList).filter(function(f) { return f.type && f.type.indexOf('image/') === 0; });
      if (files.length === 0) {
        showToast('画像ファイルを選択してください');
        return;
      }

      for (var i = 0; i < files.length; i++) {
        try {
          var res = await compressImageToJpeg(files[i]);
          state.pendingImages.push({
            id: 'IMG_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            dataUrl: res.dataUrl,
            base64: res.base64,
            mimeType: res.mimeType,
            label: files[i].name || 'image.jpg'
          });
        } catch (err) {
          showToast('画像を読み込めませんでした');
        }
      }
      renderPendingImages();
      updateComposerUI();
    }

    function removeLocalPendingImage(imgId) {
      state.pendingImages = state.pendingImages.filter(function(img) { return img.id !== imgId; });
      renderPendingImages();
      updateComposerUI();
    }

    function removeBufferedServerImage(fileId) {
      var prev = state.bufferedImages.slice();
      state.bufferedImages = state.bufferedImages.filter(function(img) { return img.fileId !== fileId; });
      renderPendingImages();
      updateComposerUI();

      callServerApi('apiRemoveBufferedImage', state.authKey, fileId)
        .then(function(res) {
          if (res && Array.isArray(res.bufferedImages)) {
            state.bufferedImages = res.bufferedImages;
            renderPendingImages();
            updateComposerUI();
          }
        })
        .catch(function() {
          state.bufferedImages = prev;
          renderPendingImages();
          updateComposerUI();
          showToast('画像を削除できませんでした');
        });
    }

    function renderPendingImages() {
      var strip = document.getElementById('pendingImagesStrip');
      var list = document.getElementById('pendingImagesList');
      var hasAny = state.bufferedImages.length > 0 || state.pendingImages.length > 0;

      if (!hasAny) {
        strip.classList.add('is-hidden');
        list.innerHTML = '';
        return;
      }

      strip.classList.remove('is-hidden');
      var html = '';

      state.bufferedImages.forEach(function(img) {
        var src = img.previewUrl || img.url || '';
        html += '<div class="dc-pending-item">' +
          '<div class="dc-pending-thumb" onclick="openImageLightbox(\\'' + escapeAttrJs(src) + '\\')">' +
            '<img src="' + escapeHtml(src) + '" alt="画像">' +
          '</div>' +
          '<button onclick="removeBufferedServerImage(\\'' + escapeAttrJs(img.fileId) + '\\')" class="dc-pending-remove" aria-label="画像を削除">×</button>' +
        '</div>';
      });

      state.pendingImages.forEach(function(img) {
        html += '<div class="dc-pending-item">' +
          '<div class="dc-pending-thumb" onclick="openImageLightbox(\\'' + escapeAttrJs(img.dataUrl) + '\\')">' +
            '<img src="' + escapeHtml(img.dataUrl) + '" alt="' + escapeHtml(img.label) + '">' +
          '</div>' +
          '<button onclick="removeLocalPendingImage(\\'' + escapeAttrJs(img.id) + '\\')" class="dc-pending-remove" aria-label="画像を削除">×</button>' +
        '</div>';
      });

      list.innerHTML = html;
    }

    function openImageLightbox(src) {
      if (!src) return;
      document.getElementById('lightboxImg').src = src;
      document.getElementById('imageLightbox').classList.remove('is-hidden');
    }

    function closeImageLightbox() {
      document.getElementById('imageLightbox').classList.add('is-hidden');
    }

    // Paste & Drag/Drop & Cursor Preservation
    editor.addEventListener('paste', function(e) {
      var items = (e.clipboardData && e.clipboardData.items) ? Array.from(e.clipboardData.items) : [];
      var imgFiles = items.filter(function(it) { return it.type && it.type.indexOf('image/') === 0; })
        .map(function(it) { return it.getAsFile(); })
        .filter(Boolean);
      if (imgFiles.length > 0) {
        e.preventDefault();
        handleFilesSelected(imgFiles);
      }
    });

    shellEl.addEventListener('dragover', function(e) {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') !== -1) {
        e.preventDefault();
      }
    });

    shellEl.addEventListener('drop', function(e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        e.preventDefault();
        handleFilesSelected(e.dataTransfer.files);
      }
    });

    function saveEditorSelection() {
      var sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        var range = sel.getRangeAt(0);
        if (editor.contains(range.commonAncestorContainer)) {
          state.savedRange = range.cloneRange();
        }
      }
    }

    editor.addEventListener('keyup', function() { saveEditorSelection(); updateComposerUI(); });
    editor.addEventListener('mouseup', saveEditorSelection);
    editor.addEventListener('input', function() { saveEditorSelection(); updateComposerUI(); });

    editor.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) {
        e.preventDefault();
        handleSendMessage();
        return;
      }
      if (e.key === 'Backspace') {
        var sel = window.getSelection();
        if (sel && sel.isCollapsed && sel.rangeCount > 0) {
          var range = sel.getRangeAt(0);
          var node = range.startContainer;
          var offset = range.startOffset;
          if (node === editor && offset > 0) {
            var prev = editor.childNodes[offset - 1];
            if (prev && prev.nodeType === 1 && prev.classList.contains('inline-var-pill')) {
              e.preventDefault();
              prev.remove();
              updateComposerUI();
            }
          } else if (node.nodeType === 3 && offset === 0 && node.previousSibling) {
            var prevSib = node.previousSibling;
            if (prevSib.nodeType === 1 && prevSib.classList.contains('inline-var-pill')) {
              e.preventDefault();
              prevSib.remove();
              updateComposerUI();
            }
          }
        }
      }
    });

    function getIconForKind(kind) {
      if (kind === 'task') return '🌿';
      if (kind === 'shopping') return '🛒';
      if (kind === 'input') return '💡';
      if (kind === 'cycle') return '🌱';
      return '📌';
    }

    function createPillElement(item) {
      var span = document.createElement('span');
      span.className = 'inline-var-pill';
      span.contentEditable = 'false';
      span.dataset.kind = item.kind;
      span.dataset.id = item.id;
      span.dataset.label = item.label;
      if (item.docUrl) span.dataset.docUrl = item.docUrl;

      var labelSpan = document.createElement('span');
      labelSpan.className = 'inline-var-pill-label';
      labelSpan.textContent = getIconForKind(item.kind) + ' ' + item.label;

      var removeBtn = document.createElement('span');
      removeBtn.className = 'inline-var-remove';
      removeBtn.textContent = '×';
      removeBtn.onclick = function(ev) {
        ev.stopPropagation();
        span.remove();
        updateComposerUI();
      };

      span.appendChild(labelSpan);
      span.appendChild(removeBtn);
      return span;
    }

    function insertVariableIntoComposer(item) {
      var pill = createPillElement(item);
      var trailingSpace = document.createTextNode(' ');

      editor.focus();
      var sel = window.getSelection();
      var range = state.savedRange;
      if (!range || !editor.contains(range.commonAncestorContainer)) {
        range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
      }

      range.deleteContents();
      range.insertNode(trailingSpace);
      range.insertNode(pill);

      var nextRange = document.createRange();
      nextRange.setStartAfter(trailingSpace);
      nextRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(nextRange);
      state.savedRange = nextRange.cloneRange();

      updateComposerUI();
    }

    function getInsertedIds() {
      var pills = editor.querySelectorAll('.inline-var-pill');
      var ids = new Set();
      pills.forEach(function(p) { ids.add(p.dataset.id); });
      return ids;
    }

    function serializeComposerContent() {
      var humanHtml = '';
      var logsText = '';
      var aiPromptText = '';
      var attachedItems = [];
      var rawNodesSnapshot = [];

      editor.childNodes.forEach(function(node) {
        if (node.nodeType === 3) {
          var t = node.textContent;
          humanHtml += linkifyEscapedText(t);
          logsText += t;
          aiPromptText += t;
          rawNodesSnapshot.push({ type: 'text', text: t });
        } else if (node.nodeType === 1 && node.classList.contains('inline-var-pill')) {
          var kind = node.dataset.kind;
          var id = node.dataset.id;
          var label = node.dataset.label;
          var docUrl = node.dataset.docUrl || '';
          var icon = getIconForKind(kind);

          attachedItems.push({ kind: kind, id: id, label: label, docUrl: docUrl });
          rawNodesSnapshot.push({ type: 'pill', kind: kind, id: id, label: label, docUrl: docUrl });
          humanHtml += '<span class="inline-var-pill" data-kind="' + escapeHtml(kind) + '"><span class="inline-var-pill-label">' + icon + ' ' + escapeHtml(label) + '</span></span>';
          logsText += '「' + label + '」';

          if (kind === 'task') {
            aiPromptText += '【[タスクID:' + id + '] ' + label + (docUrl ? ' (doc:' + docUrl + ')' : '') + '】';
          } else if (kind === 'shopping') {
            aiPromptText += '【[買物] ' + label + '】';
          } else if (kind === 'input') {
            aiPromptText += '【[ストック] ' + label + '】';
          } else {
            aiPromptText += '【[活動・習慣] ' + label + '】';
          }
        } else if (node.nodeType === 1) {
          var elText = node.innerText || node.textContent || '';
          humanHtml += linkifyEscapedText(elText);
          logsText += elText;
          aiPromptText += elText;
          rawNodesSnapshot.push({ type: 'text', text: elText });
        }
      });

      return {
        humanHtml: humanHtml.trim(),
        logsText: logsText.trim(),
        aiPromptText: aiPromptText.trim(),
        attachedItems: attachedItems,
        rawNodesSnapshot: rawNodesSnapshot,
        localImages: state.pendingImages.slice(),
        bufferedImages: state.bufferedImages.slice()
      };
    }

    function restoreSnapshotToComposer(snapshot, localImagesSnapshot, bufferedImagesSnapshot) {
      if (snapshot && Array.isArray(snapshot)) {
        editor.innerHTML = '';
        snapshot.forEach(function(entry) {
          if (entry.type === 'text') {
            editor.appendChild(document.createTextNode(entry.text));
          } else if (entry.type === 'pill') {
            editor.appendChild(createPillElement(entry));
          }
        });
      }
      if (localImagesSnapshot && Array.isArray(localImagesSnapshot)) {
        state.pendingImages = localImagesSnapshot.slice();
      }
      if (bufferedImagesSnapshot && Array.isArray(bufferedImagesSnapshot)) {
        state.bufferedImages = bufferedImagesSnapshot.slice();
      }
      renderPendingImages();
      updateComposerUI();
      editor.focus();
    }

    function updateComposerUI() {
      var ser = serializeComposerContent();
      var canSend = Boolean(ser.logsText || ser.attachedItems.length > 0 || ser.localImages.length > 0 || ser.bufferedImages.length > 0);
      var sendBtn = document.getElementById('sendBtn');
      if (sendBtn) {
        sendBtn.style.backgroundColor = canSend ? 'var(--dc-sage-main)' : 'var(--dc-bg-subtle)';
        sendBtn.style.color = canSend ? 'var(--dc-sage-on)' : 'var(--dc-text-muted)';
      }
      renderTasks();
      renderShopping();
      renderInputs();
      renderCycles();
    }

    function clearComposerInputAndLocalImages() {
      editor.innerHTML = '';
      state.savedRange = null;
      state.pendingImages = [];
      state.bufferedImages = [];
      renderPendingImages();
      updateComposerUI();
    }

    // Card Renderers
    function renderAll() {
      renderChat();
      renderTasks();
      renderShopping();
      renderInputs();
      renderCycles();
      updateBadges();
      updateComposerUI();
    }

    function getActiveTasks() {
      var list = (state.data && Array.isArray(state.data.tasks)) ? state.data.tasks : [];
      return list.filter(function(t) { return t.status !== '完了' && t.status !== '破棄'; });
    }

    function getActiveShopping() {
      var list = (state.data && Array.isArray(state.data.shopping)) ? state.data.shopping : [];
      return list.filter(function(s) { return s.status === '未買'; });
    }

    function getActiveInputs() {
      var list = (state.data && Array.isArray(state.data.inputStock)) ? state.data.inputStock : [];
      return list.filter(function(i) { return i.status === '未'; });
    }

    function getCycleStamps() {
      var mem = (state.data && state.data.memory) ? state.data.memory : {};
      return Array.isArray(mem.cycle_stamps) ? mem.cycle_stamps : [];
    }

    function updateBadges() {
      var counts = {
        tasks: getActiveTasks().length,
        shopping: getActiveShopping().length,
        input: getActiveInputs().length
      };
      Object.keys(counts).forEach(function(k) {
        var mob = document.getElementById('badge-' + k);
        var spl = document.getElementById('split-badge-' + k);
        [mob, spl].forEach(function(el) {
          if (!el) return;
          el.textContent = String(counts[k]);
          el.classList.toggle('is-hidden', counts[k] <= 0);
        });
      });
    }

    function renderChat() {
      var container = document.getElementById('chatTimeline');
      if (!state.data && state.messages.length === 0) {
        container.innerHTML = '';
        return;
      }
      if (state.messages.length === 0 && !state.isSending) {
        container.innerHTML = '<div class="dc-chat-empty">今日の会話はまだありません</div>';
        return;
      }

      var html = state.messages.map(function(m) {
        if (m.sender === 'user') {
          var animCls = m.animateSend ? ' anim-send-bubble' : '';
          var hasText = Boolean(m.html);
          var imgs = Array.isArray(m.images) ? m.images : [];
          var imgsHtml = '';
          if (imgs.length > 0) {
            imgsHtml = '<div class="dc-msg-imgs' + (imgs.length > 1 ? ' grid-2' : '') + (hasText ? ' has-text' : '') + '">' +
              imgs.map(function(img) {
                return '<img src="' + escapeHtml(img.dataUrl) + '" alt="画像" onclick="openImageLightbox(\\'' + escapeAttrJs(img.dataUrl) + '\\')" class="dc-msg-img">';
              }).join('') +
            '</div>';
          }
          return '<div class="dc-msg-row user' + animCls + '">' +
            '<div class="dc-msg-bubble user">' +
              imgsHtml +
              (hasText ? '<div>' + m.html + '</div>' : '') +
            '</div>' +
            (m.time ? '<div class="dc-msg-time">' + escapeHtml(m.time) + '</div>' : '') +
          '</div>';
        }

        if (m.sender === 'error') {
          return '<div class="dc-msg-row ai anim-receive-bubble">' +
            '<div class="dc-error-card">' +
              '<div class="dc-error-title">送信できませんでした</div>' +
              '<div class="dc-error-desc">' + escapeHtml(m.errorText || '通信またはAI呼び出しでエラーが発生しました。') + '</div>' +
              '<div class="dc-err-actions">' +
                '<button onclick="retryFailedMessage(\\'' + escapeJs(m.id) + '\\')" class="dc-btn-err-retry">再試行</button>' +
                '<button onclick="restoreFailedMessage(\\'' + escapeJs(m.id) + '\\')" class="dc-btn-err-restore">入力に戻す</button>' +
              '</div>' +
            '</div>' +
            (m.time ? '<div class="dc-msg-time" style="color:var(--dc-terracotta);">' + escapeHtml(m.time) + '</div>' : '') +
          '</div>';
        }

        var rAnim = m.animateReceive ? ' anim-receive-bubble' : '';
        var noticesHtml = (m.notices && m.notices.length > 0)
          ? '<div class="dc-notices-row">' + m.notices.map(function(n) {
              return '<span class="dc-notice-chip">' + escapeHtml(n) + '</span>';
            }).join('') + '</div>'
          : '';
        var docsHtml = (m.docLinks && m.docLinks.length > 0)
          ? '<div class="dc-doc-links">' + m.docLinks.map(function(dl) {
              return '<a href="' + escapeHtml(dl.url) + '" target="_blank" rel="noopener noreferrer" class="dc-doc-btn"><span>📄 ' + escapeHtml(dl.label) + '</span><span>↗</span></a>';
            }).join('') + '</div>'
          : '';

        return '<div class="dc-msg-row ai' + rAnim + '">' +
          '<div class="dc-msg-bubble ai">' +
            (m.text ? '<div>' + linkifyEscapedText(m.text) + '</div>' : '') +
            noticesHtml +
            docsHtml +
          '</div>' +
          (m.time ? '<div class="dc-msg-time">' + escapeHtml(m.time) + '</div>' : '') +
        '</div>';
      }).join('');

      if (state.isSending) {
        html += '<div class="dc-msg-row ai anim-receive-bubble"><div class="dc-thinking-bubble"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span></div></div>';
      }

      container.innerHTML = html;
      state.messages.forEach(function(m) {
        m.animateSend = false;
        m.animateReceive = false;
      });
    }

    function renderInsertIndicator(isInserted, accentBg, accentText) {
      return '<span class="dc-insert-indicator" style="' +
        (isInserted ? 'background-color:' + accentBg + ';color:' + accentText + ';' : '') + '">' +
        (isInserted ? SVG_CHECK : SVG_PLUS) +
      '</span>';
    }

    function renderTasks() {
      var listArea = document.getElementById('taskListArea');
      var catBar = document.getElementById('taskCategoryBar');
      if (!state.data) return;

      var insertedIds = getInsertedIds();
      var allTasks = getActiveTasks().slice().sort(function(a, b) {
        var aHas = Boolean(a.dueDate);
        var bHas = Boolean(b.dueDate);
        if (aHas && bHas && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        if (aHas && !bHas) return -1;
        if (!aHas && bHas) return 1;
        return 0;
      });

      var categories = [];
      allTasks.forEach(function(t) {
        var p = t.prefix || 'その他';
        if (categories.indexOf(p) === -1) categories.push(p);
      });

      var catHtml = '<button onclick="selectTaskCat(\\'ALL\\')" class="dc-cat-pill' + (state.selectedCategory === 'ALL' ? ' active' : '') + '">すべて</button>';
      categories.forEach(function(c) {
        catHtml += '<button onclick="selectTaskCat(\\'' + escapeJs(c) + '\\')" class="dc-cat-pill' + (state.selectedCategory === c ? ' active' : '') + '">' + escapeHtml(c) + '</button>';
      });
      catBar.innerHTML = catHtml;

      var filtered = state.selectedCategory === 'ALL'
        ? allTasks
        : allTasks.filter(function(t) { return (t.prefix || 'その他') === state.selectedCategory; });

      if (filtered.length === 0) {
        listArea.innerHTML = '<div class="dc-empty-cards">未完了タスクはありません</div>';
        return;
      }

      listArea.innerHTML = filtered.map(function(t) {
        var title = t.cleanTitle || t.fullTitle || '';
        var isInserted = insertedIds.has(t.id);
        var hasDueNum = typeof t.daysUntilDue === 'number';
        var accentColor = (hasDueNum && t.daysUntilDue <= 0)
          ? 'var(--dc-terracotta)'
          : ((hasDueNum && t.daysUntilDue <= 3) ? 'var(--dc-amber)' : 'transparent');

        var dueLabel = '';
        if (hasDueNum) {
          if (t.daysUntilDue < 0) {
            dueLabel = '<span style="font-weight:600;color:var(--dc-terracotta);">期限超過 · ' + escapeHtml(formatShort(t.dueDate)) + '</span>';
          } else if (t.daysUntilDue === 0) {
            dueLabel = '<span style="font-weight:600;color:var(--dc-terracotta);">今日</span>';
          } else {
            dueLabel = '<span>' + escapeHtml(formatShort(t.dueDate)) + '</span>';
          }
        }

        var docBadge = '';
        if (t.docUrl && new RegExp('^https?://', 'i').test(t.docUrl)) {
          var isFolder = t.docUrl.indexOf('/folders/') !== -1;
          docBadge = '<a href="' + escapeHtml(t.docUrl) + '" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" class="dc-card-doc-link">' +
            (isFolder ? 'フォルダ ↗' : '資料 ↗') + '</a>';
        }

        return '<div onclick="insertVariableIntoComposer({kind:\\'task\\',id:\\'' + escapeAttrJs(t.id) + '\\',label:\\'' + escapeAttrJs(title) + '\\',docUrl:\\'' + escapeAttrJs(t.docUrl || '') + '\\'})" ' +
          'class="dc-card-item" style="' + (isInserted ? 'background-color:var(--dc-sage-light-soft);border-color:var(--dc-sage-main);' : '') + '">' +
          (accentColor !== 'transparent' ? '<div class="dc-card-accent" style="background-color:' + accentColor + ';"></div>' : '') +
          '<div class="dc-card-row">' +
            '<div class="dc-card-body">' +
              '<div class="dc-card-title">' + escapeHtml(title) + '</div>' +
              '<div class="dc-card-meta">' +
                '<span style="font-weight:500;color:var(--dc-sage-text);">' + escapeHtml(t.prefix || 'その他') + '</span>' +
                (dueLabel ? '<span>·</span>' + dueLabel : '') +
                (t.timeHint ? '<span style="color:var(--dc-terracotta);">' + escapeHtml(t.timeHint) + '</span>' : '') +
                docBadge +
              '</div>' +
              (t.memo ? '<div class="dc-card-memo">' + escapeHtml(t.memo) + '</div>' : '') +
            '</div>' +
            renderInsertIndicator(isInserted, 'var(--dc-sage-main)', 'var(--dc-sage-on)') +
          '</div>' +
        '</div>';
      }).join('');
    }

    function selectTaskCat(cat) {
      state.selectedCategory = cat;
      renderTasks();
    }

    function renderShopping() {
      var area = document.getElementById('shopListArea');
      if (!state.data) return;

      var list = getActiveShopping();
      var insertedIds = getInsertedIds();

      if (list.length === 0) {
        area.innerHTML = '<div class="dc-empty-cards">買うものはありません</div>';
        return;
      }

      area.innerHTML = list.map(function(s) {
        var cid = 'SHOP_' + s.rowIndex;
        var isInserted = insertedIds.has(cid);
        return '<div onclick="insertVariableIntoComposer({kind:\\'shopping\\',id:\\'' + escapeAttrJs(cid) + '\\',label:\\'' + escapeAttrJs(s.item) + '\\'})" ' +
          'class="dc-card-item" style="' + (isInserted ? 'background-color:var(--dc-amber-light);border-color:var(--dc-amber);' : '') + '">' +
          '<div class="dc-card-row center">' +
            '<div class="dc-card-body">' +
              '<div class="dc-card-title">' + escapeHtml(s.item) + '</div>' +
              '<div class="dc-card-meta">' +
                '<span style="font-weight:500;color:var(--dc-amber-text);">' + escapeHtml(s.category || '日用品') + '</span>' +
                (s.createdDate ? '<span>·</span><span>' + escapeHtml(formatShort(s.createdDate)) + '</span>' : '') +
              '</div>' +
            '</div>' +
            renderInsertIndicator(isInserted, 'var(--dc-amber)', '#FFFFFF') +
          '</div>' +
        '</div>';
      }).join('');
    }

    function renderInputs() {
      var area = document.getElementById('inputListArea');
      if (!state.data) return;

      var list = getActiveInputs();
      var insertedIds = getInsertedIds();

      if (list.length === 0) {
        area.innerHTML = '<div class="dc-empty-cards">ストックはありません</div>';
        return;
      }

      area.innerHTML = list.map(function(inp) {
        var cid = 'INPUT_' + inp.rowIndex;
        var isInserted = insertedIds.has(cid);
        return '<div onclick="insertVariableIntoComposer({kind:\\'input\\',id:\\'' + escapeAttrJs(cid) + '\\',label:\\'' + escapeAttrJs(inp.title) + '\\'})" ' +
          'class="dc-card-item" style="' + (isInserted ? 'background-color:var(--dc-violet-light);border-color:var(--dc-violet);' : '') + '">' +
          '<div class="dc-card-row">' +
            '<div class="dc-card-body">' +
              '<div class="dc-card-title">' + escapeHtml(inp.title) + '</div>' +
              '<div class="dc-card-meta"><span style="font-weight:500;color:var(--dc-violet);">' + escapeHtml(inp.type || 'ストック') + '</span></div>' +
              (inp.memo ? '<div class="dc-card-memo">' + escapeHtml(inp.memo) + '</div>' : '') +
            '</div>' +
            renderInsertIndicator(isInserted, 'var(--dc-violet)', '#FFFFFF') +
          '</div>' +
        '</div>';
      }).join('');
    }

    function renderCycles() {
      var area = document.getElementById('cycleListArea');
      if (!state.data) return;

      var stamps = getCycleStamps().slice().sort(function(a, b) {
        var ae = (typeof a.elapsedDays === 'number') ? a.elapsedDays : -1;
        var be = (typeof b.elapsedDays === 'number') ? b.elapsedDays : -1;
        return be - ae;
      });
      var insertedIds = getInsertedIds();

      if (stamps.length === 0) {
        area.innerHTML = '<div class="dc-empty-cards">記録された活動・習慣はありません</div>';
        return;
      }

      area.innerHTML = stamps.map(function(c, idx) {
        var cid = 'CYCLE_' + idx + '_' + c.label;
        var isInserted = insertedIds.has(cid);
        var hasDays = typeof c.elapsedDays === 'number';
        var pillStyle = 'background-color:var(--dc-sage-light);color:var(--dc-sage-text);';
        if (hasDays && c.elapsedDays >= 14) {
          pillStyle = 'background-color:var(--dc-terracotta-light);color:var(--dc-terracotta);';
        } else if (hasDays && c.elapsedDays >= 5) {
          pillStyle = 'background-color:var(--dc-amber-light);color:var(--dc-amber-text);';
        }
        var daysLabel = hasDays ? (c.elapsedDays === 0 ? '今日' : c.elapsedDays + '日ぶり') : '未記録';

        return '<div onclick="insertVariableIntoComposer({kind:\\'cycle\\',id:\\'' + escapeAttrJs(cid) + '\\',label:\\'' + escapeAttrJs(c.label) + '\\'})" ' +
          'class="dc-card-item" style="' + (isInserted ? 'background-color:var(--dc-teal-light);border-color:var(--dc-teal);' : '') + '">' +
          '<div class="dc-card-row center">' +
            '<div class="dc-card-body">' +
              '<div class="dc-cycle-top">' +
                '<span class="dc-cycle-label">' + escapeHtml(c.label) + '</span>' +
                '<span class="dc-cycle-pill" style="' + pillStyle + '">' + escapeHtml(daysLabel) + '</span>' +
              '</div>' +
              (c.date ? '<div class="dc-card-meta"><span>' + escapeHtml(formatShort(c.date)) + '</span></div>' : '') +
            '</div>' +
            renderInsertIndicator(isInserted, 'var(--dc-teal)', '#FFFFFF') +
          '</div>' +
        '</div>';
      }).join('');
    }

    // Send & Retry / Restore Flow
    function scrollToChatBottom() {
      var pane = document.getElementById('panel-chat');
      setTimeout(function() {
        if (pane) pane.scrollTop = pane.scrollHeight;
      }, 40);
    }

    function sendBackgroundNotification(replyText) {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      if (document.visibilityState !== 'hidden') return;
      var body = String(replyText || '返信が届きました').replace(/\\s+/g, ' ').trim();
      if (body.length > 96) body = body.substring(0, 95) + '…';

      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(function(reg) {
          if (reg && reg.showNotification) {
            return reg.showNotification('Daily Companion', {
              body: body,
              icon: './icon.svg',
              badge: './icon.svg',
              tag: 'dc-reply'
            });
          }
        }).catch(function() {
          try { new Notification('Daily Companion', { body: body }); } catch (e) {}
        });
      } else {
        try { new Notification('Daily Companion', { body: body }); } catch (e) {}
      }
    }

    function executeSendPayload(payloadObj, userMsgId) {
      state.isSending = true;
      renderChat();
      scrollToChatBottom();

      var now = new Date();
      var hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
      var apiImages = payloadObj.localImages.map(function(img) {
        return { base64: img.base64, mimeType: img.mimeType || 'image/jpeg' };
      });

      callServerApi('apiSendCompanionMessage', state.authKey, {
        promptText: payloadObj.aiPromptText,
        displayText: payloadObj.logsText,
        images: apiImages,
        consumeBuffer: true
      })
        .then(function(res) {
          state.isSending = false;
          if (!res || !res.authorized) {
            state.authorized = false;
            openSettingsModal((res && res.error) ? res.error : '認証が無効です');
            renderChat();
            return;
          }
          if (!res.turnSuccess || !res.dashboard) {
            pushInlineErrorBubble(res && res.errorMessage ? res.errorMessage : '応答を生成できませんでした。', hhmm, payloadObj, userMsgId);
            return;
          }
          hydrateFromDashboard(res.dashboard, true);
          var logs = res.dashboard.todayLogs || [];
          var lastLog = logs.length > 0 ? logs[logs.length - 1] : null;
          if (lastLog && lastLog.aiText) {
            sendBackgroundNotification(lastLog.aiText);
          }
        })
        .catch(function(err) {
          state.isSending = false;
          pushInlineErrorBubble((err && err.message) ? err.message : '通信エラーが発生しました。', hhmm, payloadObj, userMsgId);
        });
    }

    function pushInlineErrorBubble(errorText, hhmm, payloadObj, userMsgId) {
      var errId = 'ERR_' + Date.now();
      state.lastFailedPayloads[errId] = {
        userMsgId: userMsgId,
        payload: payloadObj
      };
      state.messages.push({
        id: errId,
        sender: 'error',
        time: hhmm,
        errorText: errorText
      });
      renderChat();
      scrollToChatBottom();
    }

    function handleSendMessage() {
      if (state.isSending) return;
      if (!state.authorized) {
        openSettingsModal();
        return;
      }

      var ser = serializeComposerContent();
      var hasAny = Boolean(ser.logsText || ser.attachedItems.length > 0 || ser.localImages.length > 0 || ser.bufferedImages.length > 0);
      if (!hasAny) return;

      var sendBtn = document.getElementById('sendBtn');
      if (sendBtn) {
        sendBtn.classList.remove('anim-send-btn');
        void sendBtn.offsetWidth;
        sendBtn.classList.add('anim-send-btn');
      }

      var now = new Date();
      var hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
      var previewImages = ser.bufferedImages.map(function(b) {
        return { dataUrl: b.previewUrl || b.url, label: '画像' };
      }).concat(ser.localImages.map(function(l) {
        return { dataUrl: l.dataUrl, label: l.label || '画像' };
      }));

      var userMsgId = 'OPT_' + Date.now();
      state.messages.push({
        id: userMsgId,
        sender: 'user',
        time: hhmm,
        html: ser.humanHtml,
        images: previewImages,
        animateSend: true
      });

      clearComposerInputAndLocalImages();
      if (!isSplitViewport()) {
        state.activeMobileTab = 'chat';
        syncVisiblePanels();
      }

      executeSendPayload(ser, userMsgId);
    }

    function retryFailedMessage(errId) {
      if (state.isSending) return;
      var saved = state.lastFailedPayloads[errId];
      if (!saved) return;
      delete state.lastFailedPayloads[errId];
      state.messages = state.messages.filter(function(m) { return m.id !== errId; });
      executeSendPayload(saved.payload, saved.userMsgId);
    }

    function restoreFailedMessage(errId) {
      var saved = state.lastFailedPayloads[errId];
      if (!saved) return;
      delete state.lastFailedPayloads[errId];
      state.messages = state.messages.filter(function(m) {
        return m.id !== errId && m.id !== saved.userMsgId;
      });
      renderChat();
      restoreSnapshotToComposer(saved.payload.rawNodesSnapshot, saved.payload.localImages, saved.payload.bufferedImages);
    }

    // Helpers
    function showToast(msg) {
      var bar = document.getElementById('toastBar');
      if (!bar) return;
      bar.textContent = msg;
      bar.classList.add('show');
      if (state.toastTimer) clearTimeout(state.toastTimer);
      state.toastTimer = setTimeout(function() {
        bar.classList.remove('show');
      }, 2400);
    }

    function formatShort(d) {
      if (!d) return '';
      var p = String(d).split('-');
      return p.length === 3 ? (parseInt(p[1], 10) + '/' + parseInt(p[2], 10)) : String(d);
    }

    function formatDateChip(dateStr) {
      var p = String(dateStr || '').split('-');
      if (p.length !== 3) return dateStr || 'Today';
      var dt = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
      var w = ['日', '月', '火', '水', '木', '金', '土'][dt.getDay()];
      return parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日 (' + w + ')';
    }

    function escapeHtml(s) {
      return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function linkifyEscapedText(rawStr) {
      var escaped = escapeHtml(rawStr);
      return escaped.replace(/(https?:\\/\\/[^\\s<>"']+)/g, function(url) {
        return '<a href="' + url + '" target="_blank" rel="noopener noreferrer" class="dc-url-text">' + url + '</a>';
      });
    }

    function escapeJs(s) {
      return String(s || '')
        .replace(/\\\\/g, '\\\\\\\\')
        .replace(/'/g, "\\\\'")
        .replace(/\\n/g, '\\\\n')
        .replace(/\\r/g, '');
    }

    function escapeAttrJs(s) {
      return escapeHtml(escapeJs(s));
    }
  </script>
</body>
</html>`;
}
