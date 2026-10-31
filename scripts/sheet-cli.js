/**
 * scripts/sheet-cli.js - Antigravity用スプレッドシート直接操作CLIツール
 * 
 * 使用例:
 *   node scripts/sheet-cli.js get-prompt [moduleKey]
 *   node scripts/sheet-cli.js set-prompt <moduleKey> <filePath|text>
 *   node scripts/sheet-cli.js get-memory [key]
 *   node scripts/sheet-cli.js set-memory <key> <value>
 *   node scripts/sheet-cli.js get-logs [limit]
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const SPREADSHEET_ID = '1Qu8Q2TsvcXifw5AejjJILWyxjzX9d_VtGMQnXH7MJOA';
const KEY_FILE = path.resolve(__dirname, '../service-account.json');

if (!fs.existsSync(KEY_FILE)) {
  console.error('❌ service-account.json が見つかりません:', KEY_FILE);
  process.exit(1);
}

const auth = new google.auth.GoogleAuth({
  keyFile: KEY_FILE,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });

const PROMPT_KEYS = [
  'prompt_lite',
  'prompt_core',
  'prompt_phase_a',
  'prompt_phase_b',
  'prompt_phase_c',
  'prompt_phase_d',
  'prompt_db',
  'prompt_relief'
];

async function getMemory() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'memory!A2:B50'
  });
  const map = {};
  for (const row of (res.data.values || [])) {
    if (row[0]) map[row[0].trim()] = row[1] || '';
  }
  return map;
}

async function setMemory(key, value) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'memory!A2:B50'
  });
  const rows = res.data.values || [];
  let targetRowIndex = -1;

  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] && rows[i][0].trim() === key) {
      targetRowIndex = i + 2; // 2行目スタート
      break;
    }
  }

  if (targetRowIndex > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `memory!B${targetRowIndex}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[value]] }
    });
    console.log(`✅ memory の [${key}] を更新しました (Row ${targetRowIndex})`);
  } else {
    // 新規追加
    const nextRow = rows.length + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `memory!A${nextRow}:B${nextRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[key, value]] }
    });
    console.log(`✅ memory に [${key}] を新規追加しました (Row ${nextRow})`);
  }
}

async function getLogs(limit = 10) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'logs!A2:E'
  });
  const rows = res.data.values || [];
  const latest = rows.slice(-limit);
  console.log(`=== 最新会話ログ (${latest.length}件) ===`);
  for (const r of latest) {
    console.log(`[${r[0] || ''}] User: ${r[2] || ''}`);
    if (r[4]) console.log(`       AI: ${r[4].replace(/\n/g, ' ')}`);
  }
}

async function main() {
  const [,, cmd, arg1, arg2, ...rest] = process.argv;

  switch (cmd) {
    case 'get-prompt': {
      const memory = await getMemory();
      if (arg1) {
        console.log(`=== [${arg1}] ===\n` + (memory[arg1] || '（未設定・コードデフォルトが使用されます）'));
      } else {
        console.log('=== 設定中のモジュールプロンプト一覧 ===');
        for (const k of PROMPT_KEYS) {
          const val = memory[k];
          const status = val && val.trim() ? `設定済 (${val.length}文字)` : '未設定 (コードデフォルト使用)';
          console.log(`- ${k}: ${status}`);
        }
      }
      break;
    }
    case 'set-prompt': {
      if (!arg1) {
        console.error('使用法: node scripts/sheet-cli.js set-prompt <moduleKey> <filePath|text>');
        console.error('対応キー:', PROMPT_KEYS.join(', '));
        process.exit(1);
      }
      const targetKey = arg1;
      let promptContent = '';
      if (arg2 && fs.existsSync(arg2)) {
        promptContent = fs.readFileSync(arg2, 'utf8');
      } else if (arg2) {
        promptContent = [arg2, ...rest].join(' ');
      } else {
        console.error('プロンプト内容またはファイルパスを指定してください');
        process.exit(1);
      }
      await setMemory(targetKey, promptContent);
      break;
    }
    case 'get-memory': {
      const memory = await getMemory();
      if (arg1) {
        console.log(`[${arg1}]:\n` + (memory[arg1] || '（未設定）'));
      } else {
        console.log(JSON.stringify(memory, null, 2));
      }
      break;
    }
    case 'set-memory': {
      if (!arg1) {
        console.error('使用法: node scripts/sheet-cli.js set-memory <キー> <値>');
        process.exit(1);
      }
      const val = [arg2, ...rest].filter(Boolean).join(' ');
      await setMemory(arg1, val);
      break;
    }
    case 'get-logs': {
      const limit = parseInt(arg1 || '10', 10);
      await getLogs(limit);
      break;
    }
    default:
      console.log(`
使用可能なコマンド:
  node scripts/sheet-cli.js get-prompt [moduleKey]
  node scripts/sheet-cli.js set-prompt <moduleKey> <filePath|text>
  node scripts/sheet-cli.js get-memory [key]
  node scripts/sheet-cli.js set-memory <key> <value>
  node scripts/sheet-cli.js get-logs [limit]
      `);
      break;
  }
}

main().catch(err => {
  console.error('❌ エラーが発生しました:', err.message);
  process.exit(1);
});
