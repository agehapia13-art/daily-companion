import { getGoogleAccessToken } from './google-auth';
import { Env } from './types';
import { formatJstCompact } from './utils';

const DRIVE_UPLOAD_ENDPOINT =
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
const DRIVE_FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';

const EXT_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

interface DriveUploadResponse {
  id?: string;
}

function decodeBase64ToBytes(
  base64Data: string,
  mimeType?: string,
  filePrefix?: string
): { bytes: Uint8Array; fileName: string; mimeType: string } {
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

  if (resolvedMime === 'image/jpg') resolvedMime = 'image/jpeg';
  if (!resolvedMime) resolvedMime = 'image/jpeg';
  const ext = EXT_MAP[resolvedMime];
  if (!ext) {
    throw new Error(`未対応の画像形式です: ${resolvedMime}`);
  }

  const binaryString = atob(pureBase64);
  if (!binaryString || binaryString.length === 0) {
    throw new Error('画像データのデコードに失敗しました。');
  }
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const prefix = String(filePrefix || 'pwa_img').replace(/[^a-zA-Z0-9_-]/g, '') || 'pwa_img';
  const rand = Math.random().toString(36).slice(2, 6);
  const fileName = `${prefix}_${formatJstCompact(new Date())}_${rand}.${ext}`;

  return { bytes, fileName, mimeType: resolvedMime };
}

function buildMultipartRelatedBody(
  metadata: Record<string, unknown>,
  mimeType: string,
  fileBytes: Uint8Array,
  boundary: string
): Uint8Array {
  const encoder = new TextEncoder();
  const preamble = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
  );
  const epilogue = encoder.encode(`\r\n--${boundary}--`);

  const body = new Uint8Array(preamble.length + fileBytes.length + epilogue.length);
  body.set(preamble, 0);
  body.set(fileBytes, preamble.length);
  body.set(epilogue, preamble.length + fileBytes.length);
  return body;
}

/**
 * Base64画像を Google Drive API v3 (multipart upload) で env.DRIVE_FOLDER_ID へ保存し、
 * anyone/reader 権限を付与して fileId と表示 URL を返す。
 */
export async function uploadBase64ImageToDrive(
  env: Env,
  base64Data: string,
  mimeType?: string,
  filePrefix?: string
): Promise<{ fileId: string; url: string }> {
  const decoded = decodeBase64ToBytes(base64Data, mimeType, filePrefix);
  const token = await getGoogleAccessToken(env);

  const boundary = `companion_boundary_${crypto.randomUUID().replace(/-/g, '')}`;
  const multipartBody = buildMultipartRelatedBody(
    {
      name: decoded.fileName,
      parents: [env.DRIVE_FOLDER_ID],
    },
    decoded.mimeType,
    decoded.bytes,
    boundary
  );

  const uploadRes = await fetch(DRIVE_UPLOAD_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => '');
    throw new Error(`Google Drive upload failed: HTTP ${uploadRes.status} ${errText}`);
  }

  const uploaded = (await uploadRes.json()) as DriveUploadResponse;
  if (!uploaded.id) {
    throw new Error('Google Drive upload response missing file id');
  }

  const fileId = uploaded.id;

  try {
    const permRes = await fetch(`${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}/permissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role: 'reader',
        type: 'anyone',
      }),
    });
    if (!permRes.ok) {
      const permErr = await permRes.text().catch(() => '');
      console.warn(`Drive画像共有設定警告: HTTP ${permRes.status} ${permErr}`);
    }
  } catch (shareErr) {
    console.warn('Drive画像共有設定警告:', shareErr);
  }

  return {
    fileId,
    url: `https://lh3.googleusercontent.com/d/${fileId}`,
  };
}
