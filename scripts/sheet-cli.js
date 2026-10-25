/**
 * scripts/sheet-cli.js - Antigravity用スプレッドシート直接操作CLIツール
 * 
 * 使用例:
 *   node scripts/sheet-cli.js get-prompt
 *   node scripts/sheet-cli.js set-prompt <filePath>
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
  const [,, cmd, arg1, ...rest] = process.argv;

  switch (cmd) {
    case 'get-prompt': {
      const memory = await getMemory();
      console.log(memory.system_prompt || '（system_promptは未設定です）');
      break;
    }
    case 'set-prompt': {
      let promptContent = '';
      if (!arg1) {
        // 引数なしの場合: src/Gemini.js の getDefaultSystemPrompt() を自動抽出して反映
        const vm = require('vm');
        const code = fs.readFileSync(path.resolve(__dirname, '../src/Gemini.js'), 'utf8');
        const ctx = {};
        vm.runInNewContext(code, ctx);
        promptContent = ctx.getDefaultSystemPrompt();
        console.log('📄 src/Gemini.js から最新の getDefaultSystemPrompt() を抽出しました');
      } else if (fs.existsSync(arg1)) {
        promptContent = fs.readFileSync(arg1, 'utf8');
      } else {
        promptContent = [arg1, ...rest].join(' ');
      }
      await setMemory('system_prompt', promptContent);
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
      const val = rest.join(' ');
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
  node scripts/sheet-cli.js get-prompt
  node scripts/sheet-cli.js set-prompt <filePath>
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
