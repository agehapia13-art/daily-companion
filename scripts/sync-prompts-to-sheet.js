/**
 * scripts/sync-prompts-to-sheet.js
 * src/Gemini.js 内の最新プロンプト関数群および custom_system_prompt を
 * 本番スプレッドシートの memory シートへ直接一括同期するCLIツール
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
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

// src/Gemini.js からプロンプト関数を動的ロード
const geminiCode = fs.readFileSync(path.resolve(__dirname, '../src/Gemini.js'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(geminiCode, sandbox);

const updatedCustomPrompt = `【レイアウト・改行ルール】
・LINEで読みやすいよう、文字が詰まった塊にしない。
・1〜2文ごとに適宜改行し、意味のまとまりや「提案・アドバイス」の前には空行を1行挟んでスッキリ見せる。
・reply_textの内容はプレーンテキストで出力する
・【時報アナウンスの禁止】返信の冒頭などで「現在〇〇時ですので〜」「今は〇〇時で〜」と機械的に時刻を読み上げることは禁止。時刻データは内的な引き際判断の参考にとどめ、相手から聞かれた場合や「〇〇時頃を目安に区切りましょう」と引き際を促す時以外は自然に省略すること。`;

const updatesToApply = {
  'prompt_core': sandbox.getDefaultPromptCore(),
  'prompt_lite': sandbox.getDefaultPromptLite(),
  'prompt_phase_a': sandbox.getDefaultPromptPhaseA(),
  'prompt_phase_b': sandbox.getDefaultPromptPhaseB(),
  'prompt_phase_c': sandbox.getDefaultPromptPhaseC(),
  'prompt_phase_d': sandbox.getDefaultPromptPhaseD(),
  'prompt_db': sandbox.getDefaultPromptDb(),
  'prompt_relief': sandbox.getDefaultPromptRelief(),
  'custom_system_prompt': updatedCustomPrompt
};

async function main() {
  console.log('🔄 memory シートのプロンプトを同期中...');
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'memory!A2:B50'
  });
  const rows = res.data.values || [];

  for (const [key, value] of Object.entries(updatesToApply)) {
    let targetRowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] && rows[i][0].trim() === key) {
        targetRowIndex = i + 2;
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
      console.log(`✅ [${key}] を更新しました (Row ${targetRowIndex})`);
    } else {
      const nextRow = rows.length + 2;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `memory!A${nextRow}:B${nextRow}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[key, value]] }
      });
      rows.push([key, value]);
      console.log(`✅ [${key}] を新規追加しました (Row ${nextRow})`);
    }
  }

  console.log('🎉 memory シートへのプロンプト同期が完了しました！');
}

main().catch(err => {
  console.error('❌ エラー:', err);
  process.exit(1);
});
