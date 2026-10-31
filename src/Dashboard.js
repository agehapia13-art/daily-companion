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

  appendRowSafely_(sheet, [taskId, fullTitle, dueDate, '未完了', todayStr, '', memo]);
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
      <div id="consumedTodayContainer" style="margin-top:24px;"></div>
    </section>

    <!-- 4. 習慣・記憶タブ -->
    <section id="tab-memory" class="tab-panel" style="display:none;">
      <!-- 活動・習慣スタンプ -->
      <div class="toolbar">
        <div class="section-summary">🌱 活動・習慣スタンプ</div>
        <button class="icon-btn" onclick="openMemoryEditModal('cycle_stamps_raw', '活動・習慣スタンプ')">✎ 編集</button>
      </div>
      <div id="stampGridContainer" class="stamp-grid"></div>

      <div class="quick-add-box" style="margin-bottom:24px;">
        <div class="form-label">＋ 新しい活動・習慣スタンプを追加</div>
        <div class="quick-add-row">
          <input type="text" id="newStampLabel" class="organic-input" style="flex:1;" placeholder="例：読書、楽曲制作・DTM、爪切り、美容院">
          <button class="btn-primary" onclick="addNewCycleStamp()">今日実施で記録</button>
        </div>
      </div>

      <!-- 定期ルーティン一覧 -->
      <div class="memory-card">
        <div class="memory-header">
          <div class="memory-title">🔄 登録済み定期ルーティン</div>
        </div>
        <div id="routineListContainer"></div>
      </div>

      <!-- 生活習慣・リズム -->
      <div class="memory-card">
        <div class="memory-header">
          <div class="memory-title">🌿 生活習慣・リズム</div>
          <button class="icon-btn" onclick="openMemoryEditModal('lifestyle_habits', '生活習慣・リズム')">✎ 編集</button>
        </div>
        <div id="memHabits" class="memory-content"></div>
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

      <!-- 最近の関心・トピック -->
      <div class="memory-card">
        <div class="memory-header">
          <div class="memory-title">🌊 最近の関心・トピック</div>
          <button class="icon-btn" onclick="openMemoryEditModal('rolling_memory', '最近の関心・トピック')">✎ 編集</button>
        </div>
        <div id="memRolling" class="memory-content"></div>
      </div>

      <!-- 直近生活・活動サマリー -->
      <div class="memory-card">
        <div class="memory-header">
          <div class="memory-title">🍵 直近生活・活動サマリー</div>
          <button class="icon-btn" onclick="openMemoryEditModal('weekly_summary', '直近生活・活動サマリー')">✎ 編集</button>
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
      <span class="nav-label">習慣・記憶</span>
    </button>
  </nav>

  <!-- トースト通知 -->
  <div id="toastBar" class="toast-bar">
    <span id="toastText">完了しました</span>
    <button id="toastUndoBtn" class="toast-undo" style="display:none;">元に戻す</button>
  </div>

  <!-- タスク追加・編集モーダル -->
  <div id="taskModal" class="modal-backdrop" onclick="if(event.target===this) closeTaskModal()">
    <div class="modal-sheet">
      <div class="modal-header">
        <div class="modal-title" id="taskModalTitle">🌿 新しいタスクを追加</div>
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
      <button id="taskModalSubmitBtn" class="btn-primary" style="width:100%; padding:12px; font-size:0.95rem;" onclick="submitNewTask()">タスクを登録する</button>
      <button id="taskModalDeleteBtn" class="btn-secondary" style="width:100%; margin-top:8px; padding:10px; color:var(--terracotta); border-color:var(--terracotta-light); background:var(--terracotta-light); display:none;" onclick="discardEditingTask()">🗑️ このタスクを破棄する</button>
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
      editingTaskId: null,
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
      const safeIdAttr = JSON.stringify(t.id).replace(/"/g, '&quot;');

      return '<div class="' + cardClass + '" id="task-card-' + escapeHtml(t.id) + '">' +
        '<button class="circle-check ' + (isCompleted ? 'checked' : '') + '" onclick="toggleTaskStatus(' + safeIdAttr + ', ' + JSON.stringify(nextStatus).replace(/"/g, '&quot;') + ')" title="完了切替">✓</button>' +
        '<div class="card-body" style="cursor:pointer;" onclick="openTaskModal(' + safeIdAttr + ')" title="タップして編集">' +
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
      if (cardEl && (newStatus === '完了' || newStatus === '破棄')) {
        cardEl.classList.add('completing');
        const btn = cardEl.querySelector('.circle-check');
        if (btn && newStatus === '完了') btn.classList.add('checked');
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
        } else if (newStatus === '破棄') {
          showToast('🗑️ タスクを破棄しました', () => {
            toggleTaskStatus(taskId, '未完了');
          });
        } else {
          showToast('タスクを未完了に戻しました');
        }

        callServerApi('apiUpdateTaskStatus', state.authKey, taskId, newStatus)
          .catch(err => {
            showToast('更新失敗: ' + (err.message || err));
            loadData();
          });
      }, (newStatus === '完了' || newStatus === '破棄') ? 260 : 50);
    }

    function openTaskModal(taskId) {
      state.editingTaskId = taskId || null;
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

      const titleEl = document.getElementById('taskModalTitle');
      const submitBtn = document.getElementById('taskModalSubmitBtn');
      const deleteBtn = document.getElementById('taskModalDeleteBtn');

      if (state.editingTaskId) {
        const target = (state.data && state.data.tasks) ? state.data.tasks.find(t => t.id === state.editingTaskId) : null;
        titleEl.textContent = '✎ タスクを編集';
        submitBtn.textContent = '変更を保存する';
        deleteBtn.style.display = 'block';

        document.getElementById('newTaskPrefix').value = (target && target.prefix && target.prefix !== 'その他') ? target.prefix : '';
        document.getElementById('newTaskTitle').value = target ? ((target.cleanTitle || target.fullTitle) + (target.timeHint ? '（' + target.timeHint + '）' : '')) : '';
        document.getElementById('newTaskDueDate').value = (target && target.dueDate) ? target.dueDate : '';
        document.getElementById('newTaskMemo').value = (target && target.memo) ? target.memo : '';
      } else {
        titleEl.textContent = '🌿 新しいタスクを追加';
        submitBtn.textContent = 'タスクを登録する';
        deleteBtn.style.display = 'none';

        document.getElementById('newTaskPrefix').value = (state.selectedPrefix && state.selectedPrefix !== 'ALL') ? state.selectedPrefix : '';
        document.getElementById('newTaskTitle').value = '';
        document.getElementById('newTaskDueDate').value = '';
        document.getElementById('newTaskMemo').value = '';
      }

      document.getElementById('taskModal').classList.add('open');
    }

    function closeTaskModal() {
      state.editingTaskId = null;
      document.getElementById('taskModal').classList.remove('open');
    }

    function discardEditingTask() {
      if (!state.editingTaskId) return;
      const targetId = state.editingTaskId;
      closeTaskModal();
      toggleTaskStatus(targetId, '破棄');
    }

    function submitNewTask() {
      const prefix = document.getElementById('newTaskPrefix').value.trim();
      const title = document.getElementById('newTaskTitle').value.trim();
      const dueDate = document.getElementById('newTaskDueDate').value.trim();
      const memo = document.getElementById('newTaskMemo').value.trim();
      const editingId = state.editingTaskId;

      if (!title) {
        showToast('タスク内容を入力してください');
        return;
      }

      closeTaskModal();

      if (editingId) {
        let fullTitle = title;
        if (prefix && !fullTitle.includes('：') && !fullTitle.includes(':')) {
          fullTitle = prefix + '：' + fullTitle;
        }
        showToast('💾 タスクを更新しています...');
        callServerApi('apiEditTask', state.authKey, { taskId: editingId, fullTitle, dueDate, memo })
          .then(() => {
            showToast('🌿 タスクを更新しました');
            loadData();
          })
          .catch(err => {
            showToast('更新エラー: ' + (err.message || err));
          });
      } else {
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
      const rawList = state.data.inputStock || [];
      const all = rawList.filter(i => i.status === '未');
      const consumedToday = rawList.filter(i => i.status === '完');
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
      } else {
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

      const consumedContainer = document.getElementById('consumedTodayContainer');
      if (consumedContainer) {
        if (consumedToday.length > 0) {
          consumedContainer.innerHTML =
            '<div class="group-header"><div class="group-title" style="color:var(--text-sub); font-size:0.86rem;">✨ 本日消化したストック (' + consumedToday.length + '件)</div></div>' +
            '<div class="card-list">' + consumedToday.map(item =>
              '<div class="item-card completed-card" id="input-card-' + item.rowIndex + '">' +
                '<button class="circle-check checked" onclick="uncompleteInputStock(' + item.rowIndex + ')" title="未消化に戻す">✓</button>' +
                '<div class="card-body">' +
                  '<div class="card-title">' + escapeHtml(item.title) + '</div>' +
                  '<div class="card-meta"><span class="badge badge-prefix">' + escapeHtml(item.type || '作品') + '</span></div>' +
                '</div>' +
              '</div>'
            ).join('') + '</div>';
        } else {
          consumedContainer.innerHTML = '';
        }
      }
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
          uncompleteInputStock(rowIndex);
        });
        callServerApi('apiUpdateInputStatus', state.authKey, rowIndex, '完')
          .catch(() => loadData());
      }, 240);
    }

    function uncompleteInputStock(rowIndex) {
      const target = (state.data.inputStock || []).find(i => i.rowIndex === rowIndex);
      if (target) {
        target.status = '未';
        renderAll();
      }
      showToast('ストックを未消化に戻しました');
      callServerApi('apiUpdateInputStatus', state.authKey, rowIndex, '未')
        .catch(() => loadData());
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
        stampGrid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">活動・習慣スタンプはまだ記録されていません。</div>';
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

      document.getElementById('memHabits').textContent = mem.lifestyle_habits || '（未設定）';
      document.getElementById('memDictionary').textContent = mem.dictionary || '（未設定）';
      document.getElementById('memProfile').textContent = mem.profile || '（未設定）';
      document.getElementById('memRolling').textContent = mem.rolling_memory || '（未設定）';
      document.getElementById('memWeekly').textContent = mem.weekly_summary || '（未設定）';
    }

    function stampToday(label) {
      showToast('✨ 「' + label + '」を今日の日付で更新中...');
      sendLiffMessage('✨ 「' + label + '」を実施したよ');
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
      const targetKey = state.editingMemoryKey === 'cycle_stamps_raw' ? 'cycle_stamps' : state.editingMemoryKey;
      closeMemoryEditModal();
      showToast('💾 保存しています...');
      callServerApi('apiUpdateMemoryField', state.authKey, targetKey, val)
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
