export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * Date を JST の疑似 Date（UTC メソッドで JST 成分を読める Date）へ変換
 */
export function toJstDate(now: Date = new Date()): Date {
  return new Date(now.getTime() + JST_OFFSET_MS);
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatJstYmd(now: Date = new Date()): string {
  const d = toJstDate(now);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function formatJstDateTime(now: Date = new Date()): string {
  const d = toJstDate(now);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

export function formatJstIso(now: Date = new Date()): string {
  const d = toJstDate(now);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}+09:00`;
}

export function formatJstCompact(now: Date = new Date()): string {
  const d = toJstDate(now);
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}_${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}`;
}

/**
 * 論理日キー（03:00〜翌02:59 JST）を yyyy-MM-dd 形式で返す
 */
export function getLogicalDayKey(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return formatJstYmd(shifted);
}

/**
 * JST の曜日インデックス (0=日..6=土) と時分 (minsOfDay) を返す
 */
export function getJstClock(now: Date = new Date()): { dow: number; hours: number; mins: number; minsOfDay: number } {
  const d = toJstDate(now);
  const hours = d.getUTCHours();
  const mins = d.getUTCMinutes();
  return {
    dow: d.getUTCDay(),
    hours,
    mins,
    minsOfDay: hours * 60 + mins
  };
}

export function parsePositiveEstimatedMins(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

export function corsHeaders(origin = '*'): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Internal-Secret',
    'Access-Control-Max-Age': '86400'
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders()
    }
  });
}

export function unauthorizedResponse(): Response {
  return jsonResponse({
    ok: true,
    data: {
      authorized: false,
      error: '認証キーが正しくありません。設定画面からオーナー認証キーを確認してください。'
    }
  });
}
