import { getTodayEventsList } from './calendar';
import { Env, FastState, WorkMode } from './types';

const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';
const WEATHER_STALE_MS = 3 * 60 * 60 * 1000; // 3時間

interface OpenMeteoResponse {
  daily?: {
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
  };
  hourly?: {
    surface_pressure?: Array<number | null>;
  };
}

interface SingleLocationWeatherResult {
  success: boolean;
  label: string;
  summary: string;
  hasDrop: boolean;
  precipProb: number;
  maxTemp: string;
  minTemp: string;
  desc: string;
}

/**
 * WMO Weather interpretation codes (WW) を日本語の天気に変換
 */
function interpretWeatherCode(code: number): string {
  if (code === 0) return '快晴';
  if (code === 1) return '概ね晴れ';
  if (code === 2) return '時々曇り';
  if (code === 3) return '曇り';
  if (code === 45 || code === 48) return '霧';
  if (code >= 51 && code <= 55) return '霧雨';
  if (code >= 61 && code <= 65) return '雨';
  if (code >= 66 && code <= 67) return '凍雨';
  if (code >= 71 && code <= 77) return '雪';
  if (code >= 80 && code <= 82) return 'にわか雨';
  if (code >= 85 && code <= 86) return '雪';
  if (code >= 95 && code <= 99) return '雷雨';
  return '不明';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSingleLocationWeather(
  latitude: string,
  longitude: string,
  label: string
): Promise<SingleLocationWeatherResult> {
  const url = `${OPEN_METEO_BASE}?latitude=${latitude}&longitude=${longitude}&hourly=surface_pressure&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo`;

  let response: Response | null = null;
  let statusCode = 0;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetch(url, { method: 'GET' });
      statusCode = response.status;
      if (statusCode === 200) break;
      if (statusCode === 429 && attempt === 0) {
        await sleep(1500);
      }
    } catch {
      if (attempt === 0) await sleep(1500);
    }
  }

  try {
    if (!response || response.status !== 200) {
      const errBody = response ? await response.text().catch(() => '') : 'No response';
      throw new Error(`HTTP ${statusCode} ${errBody}`);
    }

    const data = (await response.json()) as OpenMeteoResponse;

    let desc = '不明';
    let maxTemp = '-';
    let minTemp = '-';
    let precipProb = 0;

    if (data.daily?.weather_code && data.daily.weather_code.length > 0) {
      desc = interpretWeatherCode(data.daily.weather_code[0]);
      maxTemp =
        data.daily.temperature_2m_max && data.daily.temperature_2m_max[0] !== undefined
          ? String(data.daily.temperature_2m_max[0])
          : '-';
      minTemp =
        data.daily.temperature_2m_min && data.daily.temperature_2m_min[0] !== undefined
          ? String(data.daily.temperature_2m_min[0])
          : '-';
      precipProb =
        data.daily.precipitation_probability_max &&
        data.daily.precipitation_probability_max[0] !== undefined
          ? Number(data.daily.precipitation_probability_max[0])
          : 0;
    }

    // 気圧急降下判定 (当日06:00〜24:00の間に、6時間以内で5hPa以上の低下があるか)
    let hasDrop = false;
    if (data.hourly?.surface_pressure && Array.isArray(data.hourly.surface_pressure)) {
      const pressures = data.hourly.surface_pressure;
      const dayEndIndex = Math.min(pressures.length - 1, 24);

      for (let i = 0; i <= dayEndIndex; i++) {
        const pCurrent = pressures[i];
        if (typeof pCurrent !== 'number') continue;

        for (let step = 1; step <= 6; step++) {
          const targetIdx = i + step;
          if (targetIdx >= 6 && targetIdx <= dayEndIndex) {
            const pFuture = pressures[targetIdx];
            if (typeof pFuture === 'number' && pCurrent - pFuture >= 5.0) {
              hasDrop = true;
              break;
            }
          }
        }
        if (hasDrop) break;
      }
    }

    const umbrellaMark = precipProb >= 40 ? '（傘推奨☔）' : '';
    const tempPart = minTemp !== '-' ? `最高${maxTemp}℃/最低${minTemp}℃` : `最高${maxTemp}℃`;
    const summary = `${label}: ${desc} ${tempPart} / 降水確率${precipProb}%${umbrellaMark}`;

    return {
      success: true,
      label,
      summary,
      hasDrop,
      precipProb,
      maxTemp,
      minTemp,
      desc,
    };
  } catch (err) {
    console.error(`[${label}] 天気取得エラー:`, err);
    return {
      success: false,
      label,
      summary: `${label}: 天気取得エラー`,
      hasDrop: false,
      precipProb: 0,
      maxTemp: '-',
      minTemp: '-',
      desc: 'エラー',
    };
  }
}

/**
 * 自宅および（出社日のみ）職場の天気・気温・降水確率・気圧急降下を取得
 */
export async function fetchWeatherAndPressure(
  env: Env,
  isCommuteDay?: boolean
): Promise<{ weatherInfo: string; pressureAlert: string }> {
  let includeWork = isCommuteDay;
  if (includeWork === undefined) {
    const todayEvents = await getTodayEventsList(env);
    includeWork = todayEvents.some((evStr) => evStr.includes('出社'));
  }

  const [homeResult, workResult] = await Promise.all([
    fetchSingleLocationWeather(env.HOME_LATITUDE, env.HOME_LONGITUDE, env.HOME_NAME),
    includeWork
      ? fetchSingleLocationWeather(env.WORK_LATITUDE, env.WORK_LONGITUDE, env.WORK_NAME)
      : Promise.resolve(null),
  ]);

  const overallPressureAlert =
    homeResult.hasDrop || (workResult !== null && workResult.hasDrop) ? 'TRUE' : 'FALSE';

  const combinedWeatherInfo = workResult
    ? `${homeResult.summary} ｜ ${workResult.summary}`
    : homeResult.summary;

  return {
    weatherInfo: combinedWeatherInfo,
    pressureAlert: overallPressureAlert,
  };
}

/**
 * 天気情報が3時間以上古いか、エラー・出社日渋谷欠損時に再取得すべきか判定
 */
export function isWeatherStale(
  fastState: FastState,
  workMode: WorkMode,
  weatherInfo: string,
  now: Date = new Date()
): boolean {
  const info = String(weatherInfo || '').trim();
  if (!info || info.indexOf('エラー') !== -1) return true;
  if (workMode === 'commute' && info.indexOf('渋谷') === -1) return true;

  const fetchedAt =
    fastState && fastState.weatherFetchedAt ? new Date(fastState.weatherFetchedAt).getTime() : 0;
  if (!fetchedAt || Number.isNaN(fetchedAt)) return true;
  return now.getTime() - fetchedAt >= WEATHER_STALE_MS;
}

/**
 * Home ヘッダ用のコンパクト1行天気サマリーを整形（時刻なし・場所＋天気＋気温）
 */
export function formatWeatherLineForHome(
  weatherInfo: string,
  pressureAlert: string,
  workMode: WorkMode
): string {
  const raw = String(weatherInfo || '').trim();
  if (!raw || raw.indexOf('取得エラー') !== -1) {
    return pressureAlert === 'TRUE' ? '気圧急降下注意' : '横浜・磯子';
  }
  const parts = raw
    .split('｜')
    .map((s) => s.trim())
    .filter(Boolean);
  const compactParts: string[] = [];
  const limit = workMode === 'commute' ? parts.length : 1;

  for (let i = 0; i < Math.min(limit, parts.length); i++) {
    const p = parts[i];
    const loc = p.indexOf('渋谷') !== -1 ? '渋谷' : '磯子';
    const descMatch = p.match(/:\s*([^\s]+)/);
    const tempMatch = p.match(/最高(\d+℃)/);
    const rainMatch = p.match(/降水確率(\d+%)/);
    const bits = [loc];
    if (descMatch) bits.push(descMatch[1]);
    if (tempMatch) bits.push(tempMatch[1]);
    else if (rainMatch) bits.push(rainMatch[1]);
    compactParts.push(bits.join(' '));
  }

  let line = compactParts.join(' · ');
  if (pressureAlert === 'TRUE') {
    line += ' · 気圧低下注意';
  }
  return line;
}

/**
 * 朝のブリーフィング天気表示を最新天気・気圧に更新
 */
export function refreshBriefingWeatherLine(
  fastState: FastState,
  weatherInfo: string,
  pressureAlert: string,
  workMode: WorkMode
): void {
  if (!fastState || !fastState.dailyBriefing || !Array.isArray(fastState.dailyBriefing.lines)) {
    return;
  }
  const lines = fastState.dailyBriefing.lines;
  const pressureTxt = pressureAlert === 'TRUE' ? '⚠️ 気圧急降下注意' : '気圧は安定';
  if (lines.length > 0 && /気圧/.test(lines[0])) {
    lines[0] = lines[0].replace(/^[^·]+·/, `${pressureTxt} ·`);
  }
  const weatherShort = formatWeatherLineForHome(weatherInfo, pressureAlert, workMode);
  const wIdx = lines.findIndex((l) => /磯子|渋谷|晴れ|曇り|雨|雪/.test(l));
  if (wIdx !== -1) {
    lines[wIdx] = weatherShort;
  } else if (lines.length < 3) {
    lines.push(weatherShort);
  }
}
