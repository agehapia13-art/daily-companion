/**
 * Config.js - Companion Cockpit (v2) 設定およびスクリプトプロパティ管理
 * LINE Bot 依存を排除し、PWAオーナー認証・GAS/外部API設定・7大生活プリフィックス定義を一元管理
 */

const REQUIRED_PROPERTIES = [
  'GEMINI_API_KEY',
  'SPREADSHEET_ID',
  'DRIVE_FOLDER_ID',
  'NOTION_API_KEY',
  'NOTION_DAILY_DB_ID',
  'NOTION_MONTHLY_DB_ID'
];

const SYSTEM_CONSTANTS = {
  GEMINI_MODEL: 'gemini-3.8-flash',
  GEMINI_ENDPOINT_BASE: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
  GEMINI_LITE_MODEL: 'gemini-3.1-flash-lite',
  GEMINI_LITE_ENDPOINT_BASE: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent',
  GEMINI_35_LITE_MODEL: 'gemini-3.5-flash-lite',
  GEMINI_35_LITE_ENDPOINT_BASE: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
  GEMINI_HYDROGEN_MODEL: 'gemini-4-hydrogen',
  GEMINI_HYDROGEN_ENDPOINT_BASE: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent',
  NOTION_API_BASE: 'https://api.notion.com/v1',
  NOTION_VERSION: '2022-06-28',
  JAPAN_HOLIDAY_CALENDAR_ID: 'ja.japanese#holiday@group.v.calendar.google.com',
  DEFAULT_HOUSEHOLD_CALENDAR_ID: '8790a51c6413d18fecb9b205b369457de35817ae84d8e4860cefa6ff35488f4b@group.calendar.google.com',
  OPEN_METEO_BASE: 'https://api.open-meteo.com/v1/forecast',
  V2_FAST_STATE_PROP_KEY: 'V2_FAST_STATE',
  WEATHER_STALE_MS: 3 * 60 * 60 * 1000, // 3時間
  SHEET_NAMES: {
    LOGS: 'logs',
    TASKS: 'tasks',
    ROUTINES: 'routines',
    SHOPPING: 'shopping',
    INPUT_STOCK: 'input_stock',
    MEMORY: 'memory'
  },
  DEFAULT_COORDINATES: {
    HOME: { lat: 35.3970, lon: 139.6179, name: '自宅(横浜市磯子区)' },
    WORK: { lat: 35.6580, lon: 139.7016, name: '職場(渋谷)' }
  },
  PROJECT_ROOT_CATEGORIES: [
    { prefix: '仕事', folderName: '01_仕事' },
    { prefix: '制作・創作', folderName: '02_制作・創作' },
    { prefix: '家事・環境', folderName: '03_家事・環境' },
    { prefix: '実務・手続', folderName: '04_実務・手続' },
    { prefix: '趣味・文化', folderName: '05_趣味・文化' },
    { prefix: '身体・ケア', folderName: '06_身体・ケア' },
    { prefix: 'お出かけ', folderName: '07_お出かけ' }
  ]
};

/**
 * カテゴリ文字列（「仕事」「[仕事]」「01_仕事」等）から7大カテゴリ定義を検索
 * @param {string} rawCategory
 * @return {{prefix: string, folderName: string}|null}
 */
function findProjectCategoryEntry(rawCategory) {
  const categories = (SYSTEM_CONSTANTS && SYSTEM_CONSTANTS.PROJECT_ROOT_CATEGORIES) || [];
  const cleaned = String(rawCategory || '').replace(/[\[\]\s]/g, '').trim();
  if (!cleaned) return null;

  for (let i = 0; i < categories.length; i++) {
    const c = categories[i];
    if (c.folderName === cleaned || c.prefix === cleaned) {
      return c;
    }
  }
  for (let i = 0; i < categories.length; i++) {
    const c = categories[i];
    if (cleaned.includes(c.prefix) || (c.prefix.includes(cleaned) && cleaned.length >= 2)) {
      return c;
    }
  }
  return null;
}

/**
 * スクリプトプロパティを取得・検証して設定オブジェクトを返却
 * ※開発/テスト用にプロパティ OVERRIDE_SPREADSHEET_ID が設定されている場合はそちらを優先可
 * @return {Object}
 */
function getConfig() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const missing = [];

  for (let i = 0; i < REQUIRED_PROPERTIES.length; i++) {
    const key = REQUIRED_PROPERTIES[i];
    if (!props[key] || props[key].trim() === '') {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(`必要なスクリプトプロパティが設定されていません: ${missing.join(', ')}`);
  }

  const homeLat = props.HOME_LATITUDE
    ? parseFloat(props.HOME_LATITUDE.trim())
    : (props.LOCATION_LATITUDE ? parseFloat(props.LOCATION_LATITUDE.trim()) : SYSTEM_CONSTANTS.DEFAULT_COORDINATES.HOME.lat);
  const homeLon = props.HOME_LONGITUDE
    ? parseFloat(props.HOME_LONGITUDE.trim())
    : (props.LOCATION_LONGITUDE ? parseFloat(props.LOCATION_LONGITUDE.trim()) : SYSTEM_CONSTANTS.DEFAULT_COORDINATES.HOME.lon);
  const workLat = props.WORK_LATITUDE ? parseFloat(props.WORK_LATITUDE.trim()) : SYSTEM_CONSTANTS.DEFAULT_COORDINATES.WORK.lat;
  const workLon = props.WORK_LONGITUDE ? parseFloat(props.WORK_LONGITUDE.trim()) : SYSTEM_CONSTANTS.DEFAULT_COORDINATES.WORK.lon;

  return {
    dashboardAccessKey: props.DASHBOARD_ACCESS_KEY ? props.DASHBOARD_ACCESS_KEY.trim() : '',
    ownerUserId: props.OWNER_USER_ID ? props.OWNER_USER_ID.trim() : '',
    geminiApiKey: props.GEMINI_API_KEY.trim(),
    spreadsheetId: (props.TEST_SPREADSHEET_ID && props.USE_TEST_SPREADSHEET === 'TRUE')
      ? props.TEST_SPREADSHEET_ID.trim()
      : props.SPREADSHEET_ID.trim(),
    driveFolderId: props.DRIVE_FOLDER_ID.trim(),
    notionApiKey: props.NOTION_API_KEY.trim(),
    notionDailyDbId: props.NOTION_DAILY_DB_ID.trim(),
    notionMonthlyDbId: props.NOTION_MONTHLY_DB_ID.trim(),
    home: {
      latitude: isNaN(homeLat) ? SYSTEM_CONSTANTS.DEFAULT_COORDINATES.HOME.lat : homeLat,
      longitude: isNaN(homeLon) ? SYSTEM_CONSTANTS.DEFAULT_COORDINATES.HOME.lon : homeLon,
      name: '自宅(磯子)'
    },
    work: {
      latitude: isNaN(workLat) ? SYSTEM_CONSTANTS.DEFAULT_COORDINATES.WORK.lat : workLat,
      longitude: isNaN(workLon) ? SYSTEM_CONSTANTS.DEFAULT_COORDINATES.WORK.lon : workLon,
      name: '職場(渋谷)'
    },
    familyCalendarId: props.FAMILY_CALENDAR_ID ? props.FAMILY_CALENDAR_ID.trim() : '',
    householdCalendarId: props.HOUSEHOLD_CALENDAR_ID ? props.HOUSEHOLD_CALENDAR_ID.trim() : SYSTEM_CONSTANTS.DEFAULT_HOUSEHOLD_CALENDAR_ID
  };
}

/**
 * オーナー認証キーを解決（未設定時は scriptId または ownerUserId から決定論的ソルトで生成）
 * @return {string}
 */
function getDashboardAccessKey() {
  const props = PropertiesService.getScriptProperties();
  const customKey = props.getProperty('DASHBOARD_ACCESS_KEY');
  if (customKey && customKey.trim() !== '') {
    return customKey.trim();
  }
  const config = getConfig();
  const seed = config.ownerUserId || ScriptApp.getScriptId() || config.spreadsheetId;
  const raw = 'companion_salt_' + seed;
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
  let hex = '';
  for (let i = 0; i < digest.length; i++) {
    const byte = (digest[i] < 0 ? digest[i] + 256 : digest[i]);
    hex += ('0' + byte.toString(16)).slice(-2);
  }
  return hex.substring(0, 16);
}

/**
 * クライアント認証キー検証
 * @param {string} clientKey
 * @return {boolean}
 */
function verifyDashboardAccess(clientKey) {
  if (!clientKey || typeof clientKey !== 'string') return false;
  const trimmed = clientKey.trim();
  if (!trimmed) return false;

  const validKey = getDashboardAccessKey();
  if (trimmed === validKey) return true;

  const config = getConfig();
  if (config.ownerUserId) {
    if (trimmed === config.ownerUserId) return true;
    if (trimmed.length >= 6 && config.ownerUserId.endsWith(trimmed)) return true;
  }
  return false;
}
