/**
 * Weather.js - Open-Meteo API連携モジュール
 * 自宅（横浜市磯子区）および職場（渋谷）の天気予報・気温・降水確率取得と気圧急降下判定
 */

/**
 * WMO Weather interpretation codes (WW) を日本語の天気に変換
 * @param {number} code
 * @return {string}
 */
function interpretWeatherCode(code) {
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

/**
 * 単一地点の天気・気温・降水確率および気圧急降下を取得
 * @param {number} latitude
 * @param {number} longitude
 * @param {string} label 地点名
 * @return {Object}
 */
function fetchSingleLocationWeather(latitude, longitude, label) {
  const url = `${SYSTEM_CONSTANTS.OPEN_METEO_BASE}?latitude=${latitude}&longitude=${longitude}&hourly=surface_pressure&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo`;

  let response;
  let statusCode = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
      statusCode = response.getResponseCode();
      if (statusCode === 200) break;
      if (statusCode === 429 && attempt === 0) {
        Utilities.sleep(1500); // 1.5秒待機して再試行
      }
    } catch (netErr) {
      if (attempt === 0) Utilities.sleep(1500);
    }
  }

  try {
    if (!response || response.getResponseCode() !== 200) {
      throw new Error(`HTTP ${statusCode} ${response ? response.getContentText() : 'No response'}`);
    }

    const data = JSON.parse(response.getContentText());

    let desc = '不明';
    let maxTemp = '-';
    let minTemp = '-';
    let precipProb = 0;

    if (data.daily && data.daily.weather_code && data.daily.weather_code.length > 0) {
      desc = interpretWeatherCode(data.daily.weather_code[0]);
      maxTemp = data.daily.temperature_2m_max ? String(data.daily.temperature_2m_max[0]) : '-';
      minTemp = (data.daily.temperature_2m_min && data.daily.temperature_2m_min[0] !== undefined) ? String(data.daily.temperature_2m_min[0]) : '-';
      precipProb = data.daily.precipitation_probability_max ? Number(data.daily.precipitation_probability_max[0]) : 0;
    }

    // 気圧急降下判定 (当日06:00〜24:00の間に、6時間以内で5hPa以上の低下があるか)
    let hasDrop = false;
    if (data.hourly && data.hourly.surface_pressure && Array.isArray(data.hourly.surface_pressure)) {
      const pressures = data.hourly.surface_pressure;
      const dayEndIndex = Math.min(pressures.length - 1, 24); // 当日24:00まで

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
      label: label,
      summary: summary,
      hasDrop: hasDrop,
      precipProb: precipProb,
      maxTemp: maxTemp,
      minTemp: minTemp,
      desc: desc
    };

  } catch (e) {
    Logger.log(`[${label}] 天気取得エラー: ${e.message}`);
    return {
      success: false,
      label: label,
      summary: `${label}: 天気取得エラー`,
      hasDrop: false,
      precipProb: 0,
      maxTemp: '-',
      minTemp: '-',
      desc: 'エラー'
    };
  }
}

/**
 * 自宅（横浜市磯子区）および（当日「出社」予定がある場合のみ）職場（渋谷）の天気を取得し統合解析
 * @return {Object} { weatherInfo: string, pressureAlert: string, home: Object, work: Object|null }
 */
function fetchWeatherAndPressure() {
  const config = getConfig();

  const homeResult = fetchSingleLocationWeather(config.home.latitude, config.home.longitude, config.home.name);

  // 本日のカレンダー予定に「出社」がある場合のみ職場(渋谷)の天気も取得
  const includeWork = (typeof hasOfficeEventToday === 'function') ? hasOfficeEventToday() : false;
  let workResult = null;
  if (includeWork) {
    workResult = fetchSingleLocationWeather(config.work.latitude, config.work.longitude, config.work.name);
  }

  // 対象地点のいずれかで急降下があればアラートTRUE
  const overallPressureAlert = (homeResult.hasDrop || (workResult && workResult.hasDrop)) ? 'TRUE' : 'FALSE';

  // 出社予定がある日は2地点結合、ない日は自宅のみ
  const combinedWeatherInfo = workResult
    ? `${homeResult.summary} ｜ ${workResult.summary}`
    : homeResult.summary;

  return {
    weatherInfo: combinedWeatherInfo,
    pressureAlert: overallPressureAlert,
    home: homeResult,
    work: workResult
  };
}
