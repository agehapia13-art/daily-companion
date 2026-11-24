import { Env } from './types';

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const ACCESS_TOKEN_CACHE_KEY = 'google_access_token';
const ACCESS_TOKEN_TTL_SECONDS = 3000;

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

/**
 * Google OAuth2 アクセストークンを KV キャッシュ経由で取得する。
 * キャッシュになければ refresh_token グラントで再取得し、TTL 3000秒で保存する。
 */
export async function getGoogleAccessToken(env: Env): Promise<string> {
  try {
    const cached = await env.CACHE.get(ACCESS_TOKEN_CACHE_KEY);
    if (cached) {
      return cached;
    }
  } catch (err) {
    console.warn('KV cache read failed for google_access_token:', err);
  }

  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: env.GOOGLE_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });

  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Google OAuth token request failed: HTTP ${res.status} ${errText}`);
  }

  const data = (await res.json()) as GoogleTokenResponse;
  if (!data.access_token) {
    throw new Error(
      `Google OAuth token response missing access_token: ${data.error || 'unknown_error'}`
    );
  }

  try {
    await env.CACHE.put(ACCESS_TOKEN_CACHE_KEY, data.access_token, {
      expirationTtl: ACCESS_TOKEN_TTL_SECONDS,
    });
  } catch (err) {
    console.warn('KV cache write failed for google_access_token:', err);
  }

  return data.access_token;
}
