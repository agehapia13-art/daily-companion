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
 * YYYY-MM-DD 文字列に deltaDays 日加算して YYYY-MM-DD を返す
 */
export function addDaysToYmd(ymd: string, deltaDays: number): string {
  const m = String(ymd || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return String(ymd || '');
  const y = parseInt(m[1], 10);
  const mon = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const delta = Number.isFinite(deltaDays) ? Math.trunc(deltaDays) : 0;
  const dt = new Date(Date.UTC(y, mon - 1, d + delta));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export interface ParsedCycleStampItem {
  label: string;
  date: string;
  elapsedDays: number | null;
  elapsed: string;
}

/**
 * cycle_stamps 文字列をパースし、baseYmd (YYYY-MM-DD) からの経過日数を算出する
 */
export function parseCycleStampItems(rawStamps: string, baseYmd: string): ParsedCycleStampItem[] {
  const trimmed = String(rawStamps || '').trim();
  if (!trimmed) return [];

  const baseMatch = String(baseYmd || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const resolvedBaseYmd = baseMatch ? baseMatch[0] : formatJstYmd();
  const [by, bm, bd] = resolvedBaseYmd.split('-').map((n) => parseInt(n, 10));
  const baseMs = Date.UTC(by, bm - 1, bd);

  const lines = trimmed.split(/[,\n、]+/).map((s) => s.trim()).filter(Boolean);
  const items: ParsedCycleStampItem[] = [];

  for (const line of lines) {
    const m = line.match(/^([^:：]+)[：:]\s*(.+)$/);
    const label = m ? m[1].replace(/^[・\-\s]+/, '').trim() : line;
    const val = m ? m[2].trim() : '';
    let dateStr = '';
    let elapsedDays: number | null = null;

    const dm = val.match(/(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/);
    if (dm) {
      const p = dm[1].replace(/\//g, '-').split('-');
      const y = parseInt(p[0], 10);
      const mon = parseInt(p[1], 10);
      const d = parseInt(p[2], 10);
      if (Number.isFinite(y) && Number.isFinite(mon) && Number.isFinite(d)) {
        dateStr = `${String(y).padStart(4, '0')}-${pad2(mon)}-${pad2(d)}`;
        const dtMs = Date.UTC(y, mon - 1, d);
        elapsedDays = Math.max(0, Math.floor((baseMs - dtMs) / 86400000));
      }
    }

    const elapsed =
      elapsedDays === null
        ? '未着手'
        : elapsedDays === 0
          ? '今日'
          : `${elapsedDays}日前`;

    items.push({
      label,
      date: dateStr,
      elapsedDays,
      elapsed
    });
  }

  return items;
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
