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
  return saveImageBlobToDrive_(blob, fileName);
}

/**
 * 画像BlobをGoogle Driveへ保存し、リンク共有設定付きの識別子と表示URLを返す
 * @param {GoogleAppsScript.Base.Blob} blob
 * @param {string} fileName
 * @return {{ fileId: string, url: string }}
 */
function saveImageBlobToDrive_(blob, fileName) {
  const config = getConfig();
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
 * Base64画像文字列を検証・デコードし、Google Apps Script Blob を返す
 * @param {string} base64Data Base64文字列またはData URI
 * @param {string=} mimeType MIMEタイプ（省略時はData URIから推定、既定 image/jpeg）
 * @param {string=} filePrefix 保存ファイル名接頭辞（既定 pwa_img）
 * @return {{ blob: GoogleAppsScript.Base.Blob, fileName: string, mimeType: string }}
 */
function decodeBase64ImageToBlob_(base64Data, mimeType, filePrefix) {
  const raw = String(base64Data || '').trim();
  if (!raw) {
    throw new Error('画像データが空です。');
  }

  let resolvedMime = String(mimeType || '').trim().toLowerCase();
  let pureBase64 = raw;
  const dataUriMatch = raw.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (dataUriMatch) {
    if (!resolvedMime) resolvedMime = dataUriMatch[1].trim().toLowerCase();
    pureBase64 = dataUriMatch[2].trim();
  }

  // 空白や改行を除去（iOSショートカットのBase64出力は改行を含むため）
  pureBase64 = pureBase64.replace(/\s+/g, '');
  if (!pureBase64) {
    throw new Error('有効なBase64画像データではありません。');
  }

  const extMap = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif'
  };
  if (resolvedMime === 'image/jpg') resolvedMime = 'image/jpeg';
  if (!resolvedMime) resolvedMime = 'image/jpeg';
  if (!extMap[resolvedMime]) {
    throw new Error('未対応の画像形式です: ' + resolvedMime);
  }

  const bytes = Utilities.base64Decode(pureBase64);
  if (!bytes || bytes.length === 0) {
    throw new Error('画像データのデコードに失敗しました。');
  }

  const prefix = String(filePrefix || 'pwa_img').replace(/[^a-zA-Z0-9_-]/g, '') || 'pwa_img';
  const rand = Math.random().toString(36).slice(2, 6);
  const fileName = `${prefix}_${Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss')}_${rand}.${extMap[resolvedMime]}`;
  const blob = Utilities.newBlob(bytes, resolvedMime, fileName);
  return {
    blob: blob,
    fileName: fileName,
    mimeType: resolvedMime
  };
}

/**
 * Base64画像データをGoogle Driveへ保存し、Blob・File ID・URLを返す（PWA・ショートカット共通）
 * @param {string} base64Data Base64文字列またはData URI
 * @param {string=} mimeType MIMEタイプ（省略時はData URIから推定、既定 image/jpeg）
 * @param {string=} filePrefix 保存ファイル名接頭辞（既定 pwa_img）
 * @return {{ fileId: string, url: string, blob: GoogleAppsScript.Base.Blob }}
 */
function saveBase64ImageToDrive(base64Data, mimeType, filePrefix) {
  const decoded = decodeBase64ImageToBlob_(base64Data, mimeType, filePrefix);
  const saved = saveImageBlobToDrive_(decoded.blob, decoded.fileName);
  return {
    fileId: saved.fileId,
    url: saved.url,
    blob: decoded.blob
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
 * スクリプトプロパティからTTL内の有効な画像バッファエントリ一覧を取得
 * @return {Array<{ fileId: string, url: string, timestamp: number }>}
 */
function getBufferedImageEntries() {
  const props = PropertiesService.getScriptProperties();
  const key = SYSTEM_CONSTANTS.IMAGE_BUFFER_PROP_KEY;
  const raw = props.getProperty(key);
  if (!raw) return [];

  let entries = [];
  try {
    entries = JSON.parse(raw);
    if (!Array.isArray(entries)) entries = [];
  } catch (e) {
    return [];
  }

  const now = Date.now();
  const ttl = SYSTEM_CONSTANTS.IMAGE_BUFFER_TTL_MS;
  const validEntries = [];

  for (let i = 0; i < entries.length; i++) {
    const item = entries[i];
    // 単純文字列の過去データとの後方互換対応
    const fileId = typeof item === 'string' ? item : (item && item.fileId);
    const itemTime = (item && typeof item === 'object' && item.timestamp) ? Number(item.timestamp) : now;

    // TTLチェック (30分以内)
    if (now - itemTime <= ttl && fileId) {
      validEntries.push({
        fileId: String(fileId),
        url: `https://lh3.googleusercontent.com/d/${fileId}`,
        timestamp: itemTime
      });
    }
  }

  return validEntries;
}

/**
 * PWA向けの軽量なバッファ画像メタデータ一覧を返す（Driveアクセス不要）
 * @return {Array<{ fileId: string, url: string, previewUrl: string, timestamp: number }>}
 */
function getBufferedImageMetadata() {
  return getBufferedImageEntries().map(entry => ({
    fileId: entry.fileId,
    url: entry.url,
    previewUrl: entry.url,
    timestamp: entry.timestamp
  }));
}

/**
 * スクリプトプロパティの画像バッファから指定File IDを除外する (LockService排他制御付き)
 * @param {string} fileId
 * @return {{ removed: boolean, remainingCount: number }}
 */
function removeImageIdFromBuffer(fileId) {
  const targetId = String(fileId || '').trim();
  if (!targetId) return { removed: false, remainingCount: getBufferedImageEntries().length };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    const props = PropertiesService.getScriptProperties();
    const key = SYSTEM_CONSTANTS.IMAGE_BUFFER_PROP_KEY;
    const raw = props.getProperty(key);
    if (!raw) return { removed: false, remainingCount: 0 };

    let entries = [];
    try {
      entries = JSON.parse(raw);
      if (!Array.isArray(entries)) entries = [];
    } catch (e) {
      entries = [];
    }

    const beforeLen = entries.length;
    const nextEntries = entries.filter(item => {
      const id = typeof item === 'string' ? item : (item && item.fileId);
      return String(id || '') !== targetId;
    });

    if (nextEntries.length === 0) {
      props.deleteProperty(key);
    } else if (nextEntries.length !== beforeLen) {
      props.setProperty(key, JSON.stringify(nextEntries));
    }
    return { removed: nextEntries.length !== beforeLen, remainingCount: nextEntries.length };
  } catch (err) {
    Logger.log('画像バッファ個別削除エラー: ' + err.message);
    return { removed: false, remainingCount: getBufferedImageEntries().length };
  } finally {
    lock.releaseLock();
  }
}

/**
 * スクリプトプロパティから有効な画像バッファを取得し、DriveからBlobオブジェクトを取得 (TTLチェック)
 * @return {Object} { blobs: Array<GoogleAppsScript.Base.Blob>, urls: Array<string> }
 */
function getBufferedImages() {
  const validEntries = getBufferedImageEntries();
  const blobs = [];
  const urls = [];

  for (let i = 0; i < validEntries.length; i++) {
    const entry = validEntries[i];
    try {
      const file = DriveApp.getFileById(entry.fileId);
      blobs.push(file.getBlob());
      urls.push(entry.url);
    } catch (err) {
      Logger.log(`バッファ画像読み込み失敗 (${entry.fileId}): ${err.message}`);
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
