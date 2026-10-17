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
