const path = require('path');
const { google } = require('googleapis');

const SPREADSHEET_ID = '1Qu8Q2TsvcXifw5AejjJILWyxjzX9d_VtGMQnXH7MJOA';
const KEY_FILE = path.resolve(__dirname, '../service-account.json');

const auth = new google.auth.GoogleAuth({
  keyFile: KEY_FILE,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });

const TITLE_MAPPING = {
  '個人事業主転向時の生命保険・保障の検討': '[実務・手続] 個人事業主転向時の生命保険・保障の検討',
  '刀剣乱舞：回想回収': '[趣味・文化] 刀剣乱舞：回想回収',
  'コスメ：化粧ブラシのクリーニング': '[家事・環境] コスメ：化粧ブラシのクリーニング',
  '生活伴走システム：持ち物収納場所の記録・検索機能の実装（トークン節約のため常時読み込まず専用コマンド方式で照会・追加）': '[実務・手続] 生活伴走システム：持ち物収納場所の記録・検索機能の実装（トークン節約のため常時読み込まず専用コマンド方式で照会・追加）',
  '家事：不要な充電コード・アダプタ類の家族相談・整理': '[家事・環境] 不要な充電コード・アダプタ類の家族相談・整理',
  'コスメ：メイクボックスの要件定義': '[家事・環境] コスメ：メイクボックスの要件定義',
  '生活伴走システム：仕事用伴走環境（ChatGPT再現）の構想・仕様検討': '[実務・手続] 生活伴走システム：仕事用伴走環境（ChatGPT再現）の構想・仕様検討',
  'お出かけ：旧前田家本邸 洋館見学': '[お出かけ] 旧前田家本邸 洋館見学',
  '個人開発：クローゼット管理×コーディネート提案AIシステムの構想': '[制作・創作] 個人開発：クローゼット管理×コーディネート提案AIシステムの構想',
  '整理：Googleドライブのファイル整理': '[家事・環境] Googleドライブのファイル整理',
  '刀剣乱舞：戦術強化訓練 かぼちゃ大作戦（〜12:59まで）': '[趣味・文化] 刀剣乱舞：戦術強化訓練 かぼちゃ大作戦（〜12:59まで）',
  'Reaper：MCP連携＆テーマ変更の続き（2時間以上・途中休憩あり）': '[制作・創作] REAPER：MCP連携＆テーマ変更の続き（2時間以上・途中休憩あり）',
  '制作環境：ブラックフライデーのプラグイン購入検討': '[制作・創作] ブラックフライデーのプラグイン購入検討'
};

async function migrate() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'tasks!A2:H100'
  });
  const rows = res.data.values || [];
  let updatedCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const status = row[3];
    const currentTitle = (row[1] || '').trim();
    const rowIndex = i + 2;

    if (status === '未完了' && TITLE_MAPPING[currentTitle]) {
      const newTitle = TITLE_MAPPING[currentTitle];
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `tasks!B${rowIndex}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[newTitle]] }
      });
      console.log(`✅ [Row ${rowIndex}] ${currentTitle} -> ${newTitle}`);
      updatedCount++;
    }
  }

  console.log(`🎉 合計 ${updatedCount} 件の未完了タスクのタイトルを7大プリフィックス形式に更新しました！`);
}

migrate().catch(console.error);
