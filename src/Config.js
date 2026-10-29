/**
 * Config.js - 生活秘書システム 設定およびスクリプトプロパティ管理
 */

/**
 * スクリプトプロパティの基本必須キー一覧
 */
const REQUIRED_PROPERTIES = [
  'OWNER_USER_ID',
  'LINE_CHANNEL_ACCESS_TOKEN',
  'GEMINI_API_KEY',
  'SPREADSHEET_ID',
  'DRIVE_FOLDER_ID',
  'NOTION_API_KEY',
  'NOTION_DAILY_DB_ID',
  'NOTION_MONTHLY_DB_ID'
];

/**
 * システム定数
 */
const SYSTEM_CONSTANTS = {
  GEMINI_MODEL: 'gemini-3.8-flash',
  GEMINI_ENDPOINT_BASE: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
  GEMINI_LITE_MODEL: 'gemini-3.1-flash-lite',
  GEMINI_LITE_ENDPOINT_BASE: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent',
  LINE_REPLY_ENDPOINT: 'https://api.line.me/v2/bot/message/reply',
  LINE_CONTENT_ENDPOINT_BASE: 'https://api-data.line.me/v2/bot/message',
  NOTION_API_BASE: 'https://api.notion.com/v1',
  NOTION_VERSION: '2022-06-28',
  JAPAN_HOLIDAY_CALENDAR_ID: 'ja.japanese#holiday@group.v.calendar.google.com',
  DEFAULT_HOUSEHOLD_CALENDAR_ID: '8790a51c6413d18fecb9b205b369457de35817ae84d8e4860cefa6ff35488f4b@group.calendar.google.com',
  OPEN_METEO_BASE: 'https://api.open-meteo.com/v1/forecast',
  IMAGE_BUFFER_PROP_KEY: 'BUFFERED_IMAGE_METAS',
  IMAGE_BUFFER_TTL_MS: 30 * 60 * 1000, // 30分
  SHEET_NAMES: {
    LOGS: 'logs',
    TASKS: 'tasks',
    ROUTINES: 'routines',
    SHOPPING: 'shopping',
    INPUT_STOCK: 'input_stock',
    MEMORY: 'memory'
  },
  // デフォルト座標
  DEFAULT_COORDINATES: {
    HOME: { lat: 35.3970, lon: 139.6179, name: '自宅(横浜市磯子区)' },
    WORK: { lat: 35.6580, lon: 139.7016, name: '職場(渋谷)' }
  }
};

/**
 * スクリプトプロパティを取得・検証してオブジェクトとして返却
 * @return {Object} 各種設定値
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

  // 座標設定のチェック（HOME_LATITUDE または LOCATION_LATITUDE）
  const hasHomeCoord = (props.HOME_LATITUDE && props.HOME_LONGITUDE) || (props.LOCATION_LATITUDE && props.LOCATION_LONGITUDE);
  if (!hasHomeCoord) {
    missing.push('HOME_LATITUDE (または LOCATION_LATITUDE)');
    missing.push('HOME_LONGITUDE (または LOCATION_LONGITUDE)');
  }

  if (missing.length > 0) {
    throw new Error(`必要なスクリプトプロパティが設定されていません: ${missing.join(', ')}`);
  }

  // 自宅座標の確定
  const homeLat = props.HOME_LATITUDE ? parseFloat(props.HOME_LATITUDE.trim()) : (props.LOCATION_LATITUDE ? parseFloat(props.LOCATION_LATITUDE.trim()) : SYSTEM_CONSTANTS.DEFAULT_COORDINATES.HOME.lat);
  const homeLon = props.HOME_LONGITUDE ? parseFloat(props.HOME_LONGITUDE.trim()) : (props.LOCATION_LONGITUDE ? parseFloat(props.LOCATION_LONGITUDE.trim()) : SYSTEM_CONSTANTS.DEFAULT_COORDINATES.HOME.lon);

  // 職場座標の確定
  const workLat = props.WORK_LATITUDE ? parseFloat(props.WORK_LATITUDE.trim()) : SYSTEM_CONSTANTS.DEFAULT_COORDINATES.WORK.lat;
  const workLon = props.WORK_LONGITUDE ? parseFloat(props.WORK_LONGITUDE.trim()) : SYSTEM_CONSTANTS.DEFAULT_COORDINATES.WORK.lon;

  return {
    ownerUserId: props.OWNER_USER_ID.trim(),
    lineChannelAccessToken: props.LINE_CHANNEL_ACCESS_TOKEN.trim(),
    geminiApiKey: props.GEMINI_API_KEY.trim(),
    spreadsheetId: props.SPREADSHEET_ID.trim(),
    driveFolderId: props.DRIVE_FOLDER_ID.trim(),
    notionApiKey: props.NOTION_API_KEY.trim(),
    notionDailyDbId: props.NOTION_DAILY_DB_ID.trim(),
    notionMonthlyDbId: props.NOTION_MONTHLY_DB_ID.trim(),
    home: {
      latitude: homeLat,
      longitude: homeLon,
      name: '自宅(磯子)'
    },
    work: {
      latitude: workLat,
      longitude: workLon,
      name: '職場(渋谷)'
    },
    familyCalendarId: props.FAMILY_CALENDAR_ID ? props.FAMILY_CALENDAR_ID.trim() : '',
    householdCalendarId: props.HOUSEHOLD_CALENDAR_ID ? props.HOUSEHOLD_CALENDAR_ID.trim() : SYSTEM_CONSTANTS.DEFAULT_HOUSEHOLD_CALENDAR_ID
  };
}
