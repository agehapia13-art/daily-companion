const path = require('path');
const { google } = require('googleapis');
const SPREADSHEET_ID = '1Qu8Q2TsvcXifw5AejjJILWyxjzX9d_VtGMQnXH7MJOA';
const KEY_FILE = path.resolve(__dirname, '../service-account.json');
const auth = new google.auth.GoogleAuth({ keyFile: KEY_FILE, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheets = google.sheets({ version: 'v4', auth });

async function checkLogMeta() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'logs!A:I'
  });
  const rows = res.data.values || [];
  const targetRow = rows.find(r => r[2] && r[2].includes('1passwordの導入について'));
  if (targetRow) {
    console.log('User:', targetRow[2]);
    console.log('AI:', targetRow[4]);
    console.log('Input tok:', targetRow[5], 'Output tok:', targetRow[6], 'Total tok:', targetRow[8]);
  }
}

checkLogMeta().catch(console.error);
