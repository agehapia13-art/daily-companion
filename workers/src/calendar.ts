import { getGoogleAccessToken } from './google-auth';
import {
  BoundaryInfo,
  Env,
  HeroBoundary,
  WorkBoundaryResult,
  WorkMode,
} from './types';
import {
  formatJstIso,
  formatJstYmd,
  getJstClock,
  JST_OFFSET_MS,
  pad2,
  toJstDate,
} from './utils';

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const USER_PREFIX = '♪';
const OTHER_PREFIXES = ['◆', '★', '♯', '#'];
const TODAY_CACHE_TTL_SECONDS = 180;

interface GoogleCalendarEventDateTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

interface GoogleCalendarEvent {
  id?: string;
  status?: string;
  summary?: string;
  start?: GoogleCalendarEventDateTime;
  end?: GoogleCalendarEventDateTime;
  recurringEventId?: string;
  recurrence?: string[];
}

interface GoogleCalendarEventsListResponse {
  items?: GoogleCalendarEvent[];
}

interface TimedEventItem {
  title: string;
  startMs: number;
  endMs: number;
}

interface CachedTodayCalendarData {
  todayEvents: string[];
  timedEvents: TimedEventItem[];
  isNationalHoliday: boolean;
}

/**
 * 第2家族共用カレンダーの予定タイトルから抽出対象かどうかを判定
 */
function evaluateHouseholdEvent(title: string): { include: boolean; category: string } {
  const t = String(title || '');
  if (t.includes(USER_PREFIX)) {
    return { include: true, category: '共用(本人)' };
  }
  const hasOther = OTHER_PREFIXES.some((p) => t.includes(p));
  if (!hasOther) {
    return { include: true, category: '共用(家族全体)' };
  }
  return { include: false, category: '除外' };
}

/**
 * JST の年月日と時分秒から UTC エポックミリ秒を生成
 */
function makeJstEpochMs(
  year: number,
  monthZeroBased: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0
): number {
  return Date.UTC(year, monthZeroBased, day, hours, minutes, seconds) - JST_OFFSET_MS;
}

function getJstYmdParts(now: Date): { year: number; month: number; day: number } {
  const d = toJstDate(now);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
  };
}

function formatJstHmFromMs(ms: number): string {
  const d = toJstDate(new Date(ms));
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function isAllDayEvent(ev: GoogleCalendarEvent): boolean {
  return Boolean(ev.start?.date && !ev.start?.dateTime);
}

function isUmbrellaEventTitle(title: string): boolean {
  if (!title || typeof title !== 'string') return false;
  return /(タスク|作業|整理|片付|片づけ|自由時間|フリー|休息|休憩|予備|余白|バッファ|段取り)/i.test(
    title
  );
}

async function fetchCalendarEvents(
  token: string,
  calendarId: string,
  params: Record<string, string>
): Promise<GoogleCalendarEvent[]> {
  const qs = new URLSearchParams(params).toString();
  const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${qs}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Calendar API GET failed (${calendarId}): HTTP ${res.status} ${errText}`);
  }
  const data = (await res.json()) as GoogleCalendarEventsListResponse;
  return (data.items || []).filter((ev) => ev.status !== 'cancelled');
}

/**
 * 4カレンダー（メイン・第1家族共用・第2家族共用・日本祝日）を並列取得し KV に180秒キャッシュ
 */
async function getCachedTodayData(env: Env, now: Date): Promise<CachedTodayCalendarData> {
  const ymd = formatJstYmd(now);
  const cacheKey = `cal_today_${ymd}`;

  try {
    const cachedRaw = await env.CACHE.get(cacheKey);
    if (cachedRaw) {
      return JSON.parse(cachedRaw) as CachedTodayCalendarData;
    }
  } catch (err) {
    console.warn(`KV cache read failed for ${cacheKey}:`, err);
  }

  const { year, month, day } = getJstYmdParts(now);
  const todayStartIso = formatJstIso(new Date(makeJstEpochMs(year, month, day, 0, 0, 0)));
  const todayEndIso = formatJstIso(new Date(makeJstEpochMs(year, month, day, 23, 59, 59)));

  const listParams: Record<string, string> = {
    timeMin: todayStartIso,
    timeMax: todayEndIso,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  };

  const token = await getGoogleAccessToken(env);
  const familyId = env.FAMILY_CALENDAR_ID || '';
  const rawHouseholdId = env.HOUSEHOLD_CALENDAR_ID || env.DEFAULT_HOUSEHOLD_CALENDAR_ID || '';
  const householdId = rawHouseholdId && rawHouseholdId !== familyId ? rawHouseholdId : '';
  const holidayId = env.JAPAN_HOLIDAY_CALENDAR_ID || '';

  const safeFetch = async (calId: string, label: string): Promise<GoogleCalendarEvent[]> => {
    if (!calId) return [];
    try {
      return await fetchCalendarEvents(token, calId, listParams);
    } catch (err) {
      console.warn(`${label}取得エラー:`, err);
      return [];
    }
  };

  const [primaryEvents, familyEvents, householdEvents, holidayEvents] = await Promise.all([
    safeFetch('primary', 'メインカレンダー'),
    safeFetch(familyId, '第1家族共用カレンダー'),
    safeFetch(householdId, '第2家族共用カレンダー'),
    safeFetch(holidayId, '祝日カレンダー'),
  ]);

  const todayEvents: string[] = [];
  const timedEvents: TimedEventItem[] = [];

  // 1. メインカレンダー
  for (const ev of primaryEvents) {
    const title = String(ev.summary || '');
    if (isAllDayEvent(ev)) {
      todayEvents.push(`[終日] ${title}`);
    } else if (ev.start?.dateTime && ev.end?.dateTime) {
      const startMs = new Date(ev.start.dateTime).getTime();
      const endMs = new Date(ev.end.dateTime).getTime();
      todayEvents.push(`${formatJstHmFromMs(startMs)}〜${formatJstHmFromMs(endMs)} ${title}`);
      timedEvents.push({ title, startMs, endMs });
    }
  }

  // 2. 第1家族共用カレンダー（♪付きのみ）
  for (const ev of familyEvents) {
    const title = String(ev.summary || '');
    if (!title.includes(USER_PREFIX)) continue;
    if (isAllDayEvent(ev)) {
      todayEvents.push(`[共用終日] ${title}`);
    } else if (ev.start?.dateTime && ev.end?.dateTime) {
      const startMs = new Date(ev.start.dateTime).getTime();
      const endMs = new Date(ev.end.dateTime).getTime();
      todayEvents.push(`[共用] ${formatJstHmFromMs(startMs)}〜${formatJstHmFromMs(endMs)} ${title}`);
      timedEvents.push({ title, startMs, endMs });
    }
  }

  // 3. 第2家族共用カレンダー（♪付き＆プレフィックスなし）
  for (const ev of householdEvents) {
    const title = String(ev.summary || '');
    const evalRes = evaluateHouseholdEvent(title);
    if (!evalRes.include) continue;
    if (isAllDayEvent(ev)) {
      todayEvents.push(`[${evalRes.category}・終日] ${title}`);
    } else if (ev.start?.dateTime && ev.end?.dateTime) {
      const startMs = new Date(ev.start.dateTime).getTime();
      const endMs = new Date(ev.end.dateTime).getTime();
      todayEvents.push(
        `[${evalRes.category}] ${formatJstHmFromMs(startMs)}〜${formatJstHmFromMs(endMs)} ${title}`
      );
      timedEvents.push({ title: `[${evalRes.category}] ${title}`, startMs, endMs });
    }
  }

  timedEvents.sort((a, b) => a.startMs - b.startMs);

  const result: CachedTodayCalendarData = {
    todayEvents,
    timedEvents,
    isNationalHoliday: holidayEvents.length > 0,
  };

  try {
    await env.CACHE.put(cacheKey, JSON.stringify(result), {
      expirationTtl: TODAY_CACHE_TTL_SECONDS,
    });
  } catch (err) {
    console.warn(`KV cache write failed for ${cacheKey}:`, err);
  }

  return result;
}

/**
 * 本日の予定一覧を高密度サマリー配列として取得
 */
export async function getTodayEventsList(env: Env, now: Date = new Date()): Promise<string[]> {
  const data = await getCachedTodayData(env, now);
  return data.todayEvents;
}

function parseYmdParts(ymd: string): { year: number; month: number; day: number } | null {
  const m = String(ymd || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function formatJstYmdWithDowFromMs(ms: number): string {
  const d = toJstDate(new Date(ms));
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  const dow = days[d.getUTCDay()] || '';
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}(${dow})`;
}

/**
 * 指定期間（startYmd〜endYmd, 最大62日）の4カレンダー予定を並列取得し、日付付きの予定文字列配列を返す
 */
export async function getEventsInDateRange(
  env: Env,
  startYmd: string,
  endYmd: string
): Promise<string[]> {
  const now = new Date();
  const startParts = parseYmdParts(startYmd) || getJstYmdParts(now);
  const endParts = parseYmdParts(endYmd) || startParts;

  const startMs = makeJstEpochMs(startParts.year, startParts.month, startParts.day, 0, 0, 0);
  let endMs = makeJstEpochMs(endParts.year, endParts.month, endParts.day, 23, 59, 59);
  if (endMs < startMs) {
    endMs = makeJstEpochMs(startParts.year, startParts.month, startParts.day, 23, 59, 59);
  }
  const maxEndMs = makeJstEpochMs(startParts.year, startParts.month, startParts.day + 62, 23, 59, 59);
  if (endMs > maxEndMs) {
    endMs = maxEndMs;
  }

  const listParams: Record<string, string> = {
    timeMin: formatJstIso(new Date(startMs)),
    timeMax: formatJstIso(new Date(endMs)),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  };

  const token = await getGoogleAccessToken(env);
  const familyId = env.FAMILY_CALENDAR_ID || '';
  const rawHouseholdId = env.HOUSEHOLD_CALENDAR_ID || env.DEFAULT_HOUSEHOLD_CALENDAR_ID || '';
  const householdId = rawHouseholdId && rawHouseholdId !== familyId ? rawHouseholdId : '';
  const holidayId = env.JAPAN_HOLIDAY_CALENDAR_ID || '';

  const safeFetch = async (calId: string, label: string): Promise<GoogleCalendarEvent[]> => {
    if (!calId) return [];
    try {
      return await fetchCalendarEvents(token, calId, listParams);
    } catch (err) {
      console.warn(`${label}範囲取得エラー:`, err);
      return [];
    }
  };

  const [primaryEvents, familyEvents, householdEvents, holidayEvents] = await Promise.all([
    safeFetch('primary', 'メインカレンダー'),
    safeFetch(familyId, '第1家族共用カレンダー'),
    safeFetch(householdId, '第2家族共用カレンダー'),
    safeFetch(holidayId, '祝日カレンダー'),
  ]);

  const items: Array<{ sortMs: number; line: string }> = [];

  const formatAllDayDate = (dateStr?: string): { ms: number; label: string } | null => {
    if (!dateStr) return null;
    const p = parseYmdParts(dateStr);
    if (!p) return null;
    const ms = makeJstEpochMs(p.year, p.month, p.day, 0, 0, 0);
    return { ms, label: formatJstYmdWithDowFromMs(ms) };
  };

  for (const ev of primaryEvents) {
    const title = String(ev.summary || '');
    if (isAllDayEvent(ev)) {
      const d = formatAllDayDate(ev.start?.date);
      if (d) items.push({ sortMs: d.ms, line: `[メイン終日] ${d.label}: ${title}` });
    } else if (ev.start?.dateTime && ev.end?.dateTime) {
      const sMs = new Date(ev.start.dateTime).getTime();
      const eMs = new Date(ev.end.dateTime).getTime();
      items.push({
        sortMs: sMs,
        line: `[メイン予定] ${formatJstYmdWithDowFromMs(sMs)} ${formatJstHmFromMs(sMs)}〜${formatJstHmFromMs(eMs)}: ${title}`,
      });
    }
  }

  for (const ev of familyEvents) {
    const title = String(ev.summary || '');
    if (!title.includes(USER_PREFIX)) continue;
    if (isAllDayEvent(ev)) {
      const d = formatAllDayDate(ev.start?.date);
      if (d) items.push({ sortMs: d.ms, line: `[共用終日] ${d.label}: ${title}` });
    } else if (ev.start?.dateTime && ev.end?.dateTime) {
      const sMs = new Date(ev.start.dateTime).getTime();
      const eMs = new Date(ev.end.dateTime).getTime();
      items.push({
        sortMs: sMs,
        line: `[共用予定] ${formatJstYmdWithDowFromMs(sMs)} ${formatJstHmFromMs(sMs)}〜${formatJstHmFromMs(eMs)}: ${title}`,
      });
    }
  }

  for (const ev of householdEvents) {
    const title = String(ev.summary || '');
    const evalRes = evaluateHouseholdEvent(title);
    if (!evalRes.include) continue;
    if (isAllDayEvent(ev)) {
      const d = formatAllDayDate(ev.start?.date);
      if (d) items.push({ sortMs: d.ms, line: `[${evalRes.category}・終日] ${d.label}: ${title}` });
    } else if (ev.start?.dateTime && ev.end?.dateTime) {
      const sMs = new Date(ev.start.dateTime).getTime();
      const eMs = new Date(ev.end.dateTime).getTime();
      items.push({
        sortMs: sMs,
        line: `[${evalRes.category}] ${formatJstYmdWithDowFromMs(sMs)} ${formatJstHmFromMs(sMs)}〜${formatJstHmFromMs(eMs)}: ${title}`,
      });
    }
  }

  for (const ev of holidayEvents) {
    const title = String(ev.summary || '');
    if (isAllDayEvent(ev)) {
      const d = formatAllDayDate(ev.start?.date);
      if (d) items.push({ sortMs: d.ms, line: `[祝日] ${d.label}: ${title}` });
    } else if (ev.start?.dateTime) {
      const sMs = new Date(ev.start.dateTime).getTime();
      items.push({ sortMs: sMs, line: `[祝日] ${formatJstYmdWithDowFromMs(sMs)}: ${title}` });
    }
  }

  items.sort((a, b) => a.sortMs - b.sortMs);
  return items.map((item) => item.line);
}

function buildBoundaryInfo(timedEvents: TimedEventItem[], now: Date): BoundaryInfo {
  const nowMs = now.getTime();
  const activeEvents: TimedEventItem[] = [];
  let nextEvent: TimedEventItem | null = null;

  for (const ev of timedEvents) {
    if (ev.startMs <= nowMs && nowMs < ev.endMs) {
      activeEvents.push(ev);
    } else if (ev.startMs > nowMs && !nextEvent) {
      nextEvent = ev;
    }
  }

  const formatMins = (mins: number): string => {
    if (mins < 60) return `${mins}分`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}時間${m}分（計${mins}分）` : `${h}時間（計${mins}分）`;
  };

  if (activeEvents.length > 0) {
    const cur = activeEvents[0];
    const remMins = Math.max(1, Math.round((cur.endMs - nowMs) / 60000));
    const sStr = formatJstHmFromMs(cur.startMs);
    const eStr = formatJstHmFromMs(cur.endMs);
    const isUmbrella = isUmbrellaEventTitle(cur.title);

    let text = isUmbrella
      ? `現在予定の最中（タスク・作業包括枠）: 「${cur.title}」(${sStr}〜${eStr} / 枠終了まで残り${formatMins(remMins)})`
      : `現在予定の最中: 「${cur.title}」(${sStr}〜${eStr} / 終了まで残り${formatMins(remMins)})`;

    if (nextEvent) {
      const nsStr = formatJstHmFromMs(nextEvent.startMs);
      const minsToNext = Math.max(1, Math.round((nextEvent.startMs - nowMs) / 60000));
      text += ` ｜ 次の予定: 「${nextEvent.title}」(${nsStr}〜 / 開始まであと${formatMins(minsToNext)})`;
    }

    return {
      isDuringEvent: true,
      currentEventTitle: cur.title,
      currentEventRemainingMinutes: remMins,
      minutesUntilNext: isUmbrella ? remMins : 0,
      summaryText: text,
    };
  }

  if (nextEvent) {
    const minsUntilNext = Math.max(1, Math.round((nextEvent.startMs - nowMs) / 60000));
    const sStr = formatJstHmFromMs(nextEvent.startMs);
    const eStr = formatJstHmFromMs(nextEvent.endMs);
    return {
      isDuringEvent: false,
      currentEventTitle: '',
      currentEventRemainingMinutes: 0,
      minutesUntilNext: minsUntilNext,
      summaryText: `次の予定「${nextEvent.title} (${sStr}〜${eStr})」まで残り ${formatMins(minsUntilNext)}`,
    };
  }

  const { year, month, day } = getJstYmdParts(now);
  const bedtimeMs = makeJstEpochMs(year, month, day, 23, 0, 0);
  const minsUntilBed = Math.round((bedtimeMs - nowMs) / 60000);
  if (minsUntilBed > 0) {
    return {
      isDuringEvent: false,
      currentEventTitle: '',
      currentEventRemainingMinutes: 0,
      minutesUntilNext: minsUntilBed,
      summaryText: `本日のこれ以降のカレンダー固定予定なし（23:00就寝目安まで残り ${formatMins(minsUntilBed)}）`,
    };
  }

  return {
    isDuringEvent: false,
    currentEventTitle: '',
    currentEventRemainingMinutes: 0,
    minutesUntilNext: 0,
    summaryText: '本日の固定予定なし（23:00就寝目安時刻を過ぎています）',
  };
}

/**
 * 当日のカレンダー予定・日本の祝日・基本勤務形態から勤務モードと次の境界ターゲットを算出
 */
export async function getWorkModeAndBoundary(
  env: Env,
  now: Date = new Date()
): Promise<WorkBoundaryResult> {
  const { todayEvents, timedEvents, isNationalHoliday } = await getCachedTodayData(env, now);
  const boundaryInfo = buildBoundaryInfo(timedEvents, now);

  const joinedEvents = todayEvents.join(' ');
  const hasOffice = /出社/.test(joinedEvents);
  const hasRemote = /(リモート|在宅)/.test(joinedEvents);
  const hasVacation = /(休暇|有給|有休|休み|公休|代休|振休)/.test(joinedEvents);

  const { dow } = getJstClock(now);
  let workMode: WorkMode = 'remote';
  if (hasOffice && !hasVacation) {
    workMode = 'commute';
  } else if (hasVacation || dow === 0 || dow === 6 || isNationalHoliday) {
    workMode = 'holiday';
  } else if (hasRemote) {
    workMode = 'remote';
  } else {
    workMode = dow === 2 || dow === 3 ? 'commute' : 'remote';
  }

  const nowMs = now.getTime();
  const { year, month, day } = getJstYmdParts(now);
  const makeTarget = (h: number, m: number): number => makeJstEpochMs(year, month, day, h, m, 0);
  let heroBoundary: HeroBoundary;

  if (boundaryInfo.isDuringEvent && boundaryInfo.currentEventRemainingMinutes > 0) {
    const endMs = nowMs + boundaryInfo.currentEventRemainingMinutes * 60000;
    const hhmm = formatJstHmFromMs(endMs);
    heroBoundary = {
      label: `進行中 · 〜${hhmm} ${boundaryInfo.currentEventTitle}`,
      targetMs: endMs,
      textOnly: '',
    };
  } else if (
    boundaryInfo.minutesUntilNext > 0 &&
    boundaryInfo.summaryText.indexOf('次の予定「') === 0
  ) {
    const startMs = nowMs + boundaryInfo.minutesUntilNext * 60000;
    const m = boundaryInfo.summaryText.match(/次の予定「(.+?) \((\d{2}:\d{2})〜/);
    const title = m ? m[1] : '予定';
    const hhmm = m ? m[2] : formatJstHmFromMs(startMs);
    heroBoundary = {
      label: `次の予定 · ${hhmm} ${title}`,
      targetMs: startMs,
      textOnly: '',
    };
  } else if (workMode !== 'holiday') {
    const depMs = makeTarget(8, 30);
    const startMs = makeTarget(10, 0);
    const lunchMs = makeTarget(12, 0);
    const endWorkMs = makeTarget(19, 0);
    const bedMs = makeTarget(23, 0);
    if (workMode === 'commute' && nowMs < depMs) {
      heroBoundary = { label: '次の目安 · 08:30 出発', targetMs: depMs, textOnly: '' };
    } else if (nowMs < startMs) {
      heroBoundary = { label: '次の目安 · 10:00 始業', targetMs: startMs, textOnly: '' };
    } else if (nowMs < lunchMs) {
      heroBoundary = { label: '次の目安 · 12:00 昼休憩', targetMs: lunchMs, textOnly: '' };
    } else if (nowMs < endWorkMs) {
      heroBoundary = { label: '次の目安 · 19:00 終業', targetMs: endWorkMs, textOnly: '' };
    } else if (nowMs < bedMs) {
      heroBoundary = { label: '次の目安 · 23:00 就寝', targetMs: bedMs, textOnly: '' };
    } else {
      heroBoundary = { label: '夜の区切り', targetMs: null, textOnly: 'そろそろ就寝の時間' };
    }
  } else {
    const lunchMs = makeTarget(12, 30);
    const bathMs = makeTarget(17, 0);
    const dinnerMs = makeTarget(18, 0);
    const bedMs = makeTarget(23, 0);
    if (nowMs < lunchMs) {
      heroBoundary = { label: '午前の時間 · 〜12:30頃', targetMs: lunchMs, textOnly: '' };
    } else if (nowMs < bathMs) {
      heroBoundary = { label: '午後の時間 · 〜17:00頃', targetMs: bathMs, textOnly: '' };
    } else if (nowMs < dinnerMs) {
      heroBoundary = { label: '夕方の目安 · 18:00 夕食', targetMs: dinnerMs, textOnly: '' };
    } else if (nowMs < bedMs) {
      heroBoundary = { label: '次の目安 · 23:00 就寝', targetMs: bedMs, textOnly: '' };
    } else {
      heroBoundary = { label: '夜の区切り', targetMs: null, textOnly: 'そろそろ就寝の時間' };
    }
  }

  return {
    workMode,
    isHoliday: workMode === 'holiday',
    todayEvents,
    boundaryInfo,
    heroBoundary,
  };
}

/**
 * イベント日時文字列を Date へ変換（"HH:mm" は baseDate の JST 日付で補完）
 */
function parseEventDateTime(timeStr: string | Date | undefined, baseDate: Date): Date {
  if (!timeStr) return new Date(baseDate.getTime());
  if (timeStr instanceof Date) {
    return Number.isNaN(timeStr.getTime()) ? new Date(baseDate.getTime()) : timeStr;
  }

  const str = String(timeStr).trim();
  const timeOnlyMatch = str.match(/^(\d{1,2}):(\d{2})$/);
  if (timeOnlyMatch) {
    const { year, month, day } = getJstYmdParts(baseDate);
    return new Date(
      makeJstEpochMs(
        year,
        month,
        day,
        parseInt(timeOnlyMatch[1], 10),
        parseInt(timeOnlyMatch[2], 10),
        0
      )
    );
  }

  const dateOnlyMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (dateOnlyMatch) {
    return new Date(
      makeJstEpochMs(
        parseInt(dateOnlyMatch[1], 10),
        parseInt(dateOnlyMatch[2], 10) - 1,
        parseInt(dateOnlyMatch[3], 10),
        0,
        0,
        0
      )
    );
  }

  const normalizedStr = str.includes(' ') && !str.includes('T') ? str.replace(' ', 'T') : str;
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalizedStr);
  const parsed = new Date(hasTimezone ? normalizedStr : `${normalizedStr}+09:00`);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }
  const fallback = new Date(str);
  return Number.isNaN(fallback.getTime()) ? new Date(baseDate.getTime()) : fallback;
}

async function createPrimaryEvent(
  token: string,
  payload: Record<string, unknown>
): Promise<void> {
  const url = `${CALENDAR_API_BASE}/calendars/primary/events`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Calendar API POST failed: HTTP ${res.status} ${errText}`);
  }
}

async function deletePrimaryEvent(token: string, eventId: string): Promise<void> {
  const url = `${CALENDAR_API_BASE}/calendars/primary/events/${encodeURIComponent(eventId)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Calendar API DELETE failed: HTTP ${res.status} ${errText}`);
  }
}

/**
 * primary カレンダーに対する add / delete を適用し、cal_today_* キャッシュを削除する
 */
export async function applyCalendarActions(env: Env, actions: any[]): Promise<string[]> {
  if (!actions || !Array.isArray(actions) || actions.length === 0) return [];

  const token = await getGoogleAccessToken(env);
  const weekdayMap: Record<string, { rrule: string; label: string }> = {
    MON: { rrule: 'MO', label: '月' },
    MONDAY: { rrule: 'MO', label: '月' },
    月: { rrule: 'MO', label: '月' },
    TUE: { rrule: 'TU', label: '火' },
    TUESDAY: { rrule: 'TU', label: '火' },
    火: { rrule: 'TU', label: '火' },
    WED: { rrule: 'WE', label: '水' },
    WEDNESDAY: { rrule: 'WE', label: '水' },
    水: { rrule: 'WE', label: '水' },
    THU: { rrule: 'TH', label: '木' },
    THURSDAY: { rrule: 'TH', label: '木' },
    木: { rrule: 'TH', label: '木' },
    FRI: { rrule: 'FR', label: '金' },
    FRIDAY: { rrule: 'FR', label: '金' },
    金: { rrule: 'FR', label: '金' },
    SAT: { rrule: 'SA', label: '土' },
    SATURDAY: { rrule: 'SA', label: '土' },
    土: { rrule: 'SA', label: '土' },
    SUN: { rrule: 'SU', label: '日' },
    SUNDAY: { rrule: 'SU', label: '日' },
    日: { rrule: 'SU', label: '日' },
  };

  const results: string[] = [];
  const now = new Date();

  for (const act of actions) {
    if (!act || !act.action) continue;

    try {
      if (act.action === 'add' && act.title) {
        let rawDays: string[] = [];
        if (Array.isArray(act.recurrence_days)) {
          rawDays = act.recurrence_days.map(String);
        } else if (typeof act.recurrence_days === 'string' && act.recurrence_days.trim() !== '') {
          rawDays = act.recurrence_days.split(/[,\s・]+/);
        }

        const rruleDays: string[] = [];
        const weekdayLabels: string[] = [];
        for (const rawDay of rawDays) {
          const key = rawDay.trim().toUpperCase();
          const mapped = weekdayMap[key];
          if (mapped && !rruleDays.includes(mapped.rrule)) {
            rruleDays.push(mapped.rrule);
            weekdayLabels.push(mapped.label);
          }
        }

        const isAllDay = act.is_all_day === true || act.is_all_day === 'true';

        if (rruleDays.length > 0) {
          const sDate = act.start_time ? parseEventDateTime(act.start_time, now) : new Date(now);
          const { year, month, day } = getJstYmdParts(sDate);
          const cleanupStartIso = formatJstIso(new Date(makeJstEpochMs(year, month, day, 0, 0, 0)));
          const cleanupEndIso = formatJstIso(
            new Date(makeJstEpochMs(year, month, day + 14, 23, 59, 59))
          );

          const existingEvents = await fetchCalendarEvents(token, 'primary', {
            timeMin: cleanupStartIso,
            timeMax: cleanupEndIso,
            singleEvents: 'false',
            maxResults: '250',
          });
          for (const ev of existingEvents) {
            if (ev.id && ev.summary === act.title && !ev.recurringEventId && !ev.recurrence) {
              await deletePrimaryEvent(token, ev.id);
            }
          }

          const recurrence = [`RRULE:FREQ=WEEKLY;BYDAY=${rruleDays.join(',')}`];
          if (isAllDay) {
            const startYmd = formatJstYmd(sDate);
            const endYmd = formatJstYmd(new Date(sDate.getTime() + 86400000));
            await createPrimaryEvent(token, {
              summary: act.title,
              start: { date: startYmd },
              end: { date: endYmd },
              recurrence,
            });
            results.push(
              `📅 カレンダー定期追加: ${act.title} (毎週${weekdayLabels.join('・')} / 終日)`
            );
          } else {
            let eDate: Date;
            if (act.end_time) {
              eDate = parseEventDateTime(act.end_time, sDate);
              if (eDate.getTime() <= sDate.getTime()) {
                eDate = new Date(eDate.getTime() + 86400000);
              }
            } else {
              eDate = new Date(sDate.getTime() + 60 * 60 * 1000);
            }
            await createPrimaryEvent(token, {
              summary: act.title,
              start: { dateTime: formatJstIso(sDate), timeZone: 'Asia/Tokyo' },
              end: { dateTime: formatJstIso(eDate), timeZone: 'Asia/Tokyo' },
              recurrence,
            });
            results.push(
              `📅 カレンダー定期追加: ${act.title} (毎週${weekdayLabels.join('・')} ${formatJstHmFromMs(sDate.getTime())}〜${formatJstHmFromMs(eDate.getTime())})`
            );
          }
        } else if (isAllDay) {
          const d = act.start_time ? parseEventDateTime(act.start_time, now) : new Date(now);
          const startYmd = formatJstYmd(d);
          const endYmd = formatJstYmd(new Date(d.getTime() + 86400000));
          await createPrimaryEvent(token, {
            summary: act.title,
            start: { date: startYmd },
            end: { date: endYmd },
          });
          results.push(`📅 カレンダー終日追加: ${act.title} (${startYmd})`);
        } else {
          const sDate = act.start_time ? parseEventDateTime(act.start_time, now) : new Date(now);
          let eDate: Date;
          if (act.end_time) {
            eDate = parseEventDateTime(act.end_time, sDate);
            if (eDate.getTime() <= sDate.getTime()) {
              eDate = new Date(eDate.getTime() + 86400000);
            }
          } else {
            eDate = new Date(sDate.getTime() + 60 * 60 * 1000);
          }
          await createPrimaryEvent(token, {
            summary: act.title,
            start: { dateTime: formatJstIso(sDate), timeZone: 'Asia/Tokyo' },
            end: { dateTime: formatJstIso(eDate), timeZone: 'Asia/Tokyo' },
          });
          const sJst = toJstDate(sDate);
          const sStr = `${pad2(sJst.getUTCMonth() + 1)}/${pad2(sJst.getUTCDate())} ${formatJstHmFromMs(sDate.getTime())}`;
          const eStr = formatJstHmFromMs(eDate.getTime());
          results.push(`📅 カレンダー追加: ${act.title} (${sStr}〜${eStr})`);
        }
      } else if (act.action === 'delete' && act.title) {
        const targetDate = act.date ? parseEventDateTime(act.date, now) : new Date(now);
        const { year, month, day } = getJstYmdParts(targetDate);
        const startDayIso = formatJstIso(new Date(makeJstEpochMs(year, month, day, 0, 0, 0)));
        const endDayIso = formatJstIso(new Date(makeJstEpochMs(year, month, day, 23, 59, 59)));

        const events = await fetchCalendarEvents(token, 'primary', {
          timeMin: startDayIso,
          timeMax: endDayIso,
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '250',
        });

        for (const ev of events) {
          const evTitle = String(ev.summary || '');
          if (evTitle.includes(act.title) && ev.id) {
            if (act.delete_series && ev.recurringEventId) {
              await deletePrimaryEvent(token, ev.recurringEventId);
              results.push(`📅 カレンダー定期削除: ${evTitle}`);
            } else {
              await deletePrimaryEvent(token, ev.id);
              results.push(`📅 カレンダー削除: ${evTitle}`);
            }
            break;
          }
        }
      }
    } catch (actErr) {
      console.error(`カレンダーアクション実行エラー [${act.title}]:`, actErr);
    }
  }

  // cal_today_* キャッシュを無効化
  try {
    const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const ymd = jstNow.toISOString().slice(0, 10);
    await env.CACHE.delete(`cal_today_${ymd}`);
  } catch (cacheErr) {
    console.warn('cal_today_* cache invalidation failed:', cacheErr);
  }

  return results;
}
