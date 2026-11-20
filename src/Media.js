/**
 * Media.js - 画像データのデコードおよび Google Drive 保存モジュール
 * （v1 Line.js から LINE Webhook/Buffer 依存を廃止し、PWA 直接送信向けに純化）
 */

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

  // PWAプレビューおよびNotion画像ブロック（external URL）として表示できるようリンク共有（閲覧のみ）を設定
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
 * Base64画像データをGoogle Driveへ保存し、Blob・File ID・URLを返す
 * @param {string} base64Data Base64文字列またはData URI
 * @param {string=} mimeType MIMEタイプ
 * @param {string=} filePrefix 保存ファイル名接頭辞
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
