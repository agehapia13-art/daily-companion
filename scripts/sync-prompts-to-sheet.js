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

const updatedHabits = `[入浴]: お湯張りと入浴は完全に別タスク。お湯張り前に軽く浴槽ブラシをかけるのがいつもの流れ。お湯張り中に手元で別作業をしたり、同居家族のために先に沸かすことも多い。土日は17:00〜18:00でお風呂に入り、夕食前に済ませるのが固定リズム。
[食事]: 土日の昼食は12:30〜13:30、夕食は18:00〜19:00でほぼ固定。豚の脂身（角煮など）と相性が悪く胃腸を崩しやすい。
[身支度]: 起きてから朝食〜身支度完了までに1時間半ほどかかる（メイクを簡易にするなど急いでも最低1時間）。出勤前にはメイク・身支度時間が必要で、少し早めに家を出られると安心。
[作業]: 長時間の音作業・ディレクション後は、無音で耳を休める時間が必要。単純作業にはBGMやラジオ活用も好む。
[睡眠]: 07:00起床・23:00就寝が理想の健康軸。寒がりだが就寝時に暑いと首元等の肌が痒くなりやすい体質（濡れタオルや保冷剤等で調整）。
[家事]: 洗濯は深夜・就寝前に設定（基本は母親が担当）。
[余白・趣味]: 水彩・色鉛筆を使ってスケッチブックにさらっと描く手元クリエイティブが好きで良い気分転換になる。休日のカフェ散策やゲーム（モンスト、ぽこポケ、刀剣乱舞）も気晴らし・家族時間の定番。`;

const updatesToApply = {
  'prompt_core': sandbox.getDefaultPromptCore(),
  'prompt_lite': sandbox.getDefaultPromptLite(),
  'prompt_phase_a': sandbox.getDefaultPromptPhaseA(),
  'prompt_phase_b': sandbox.getDefaultPromptPhaseB(),
  'prompt_phase_c': sandbox.getDefaultPromptPhaseC(),
  'prompt_phase_d': sandbox.getDefaultPromptPhaseD(),
  'prompt_db': sandbox.getDefaultPromptDb(),
  'prompt_relief': sandbox.getDefaultPromptRelief(),
  'custom_system_prompt': updatedCustomPrompt,
  'lifestyle_habits': updatedHabits
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
