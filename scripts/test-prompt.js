/**
 * scripts/test-prompt.js - システムプロンプト比較・多様性検証スクリプト（完全ドライラン）
 *
 * スプレッドシートやLINEを一切汚さず、実際のスプレッドシートデータ（tasks, input_stock, memory, logs）を
 * コンテキストとして組み立て、旧プロンプト（現在スプシにあるもの）と新プロンプト（src/Gemini.js）の
 * 回答・行動提案のバリエーションを比較検証します。
 *
 * 使い方:
 *   GEMINI_API_KEY="AIza..." node scripts/test-prompt.js
 *   またはプロジェクト直下の .env に GEMINI_API_KEY=AIza... を記載して:
 *   node scripts/test-prompt.js
 *   node scripts/test-prompt.js "今ちょっと時間空いたんだけど何しようかな"
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { google } = require('googleapis');

const SPREADSHEET_ID = '1Qu8Q2TsvcXifw5AejjJILWyxjzX9d_VtGMQnXH7MJOA';
const KEY_FILE = path.resolve(__dirname, '../service-account.json');
const ENV_FILE = path.resolve(__dirname, '../.env');
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent';

// 1. .env または環境変数・引数から GEMINI_API_KEY を取得
function loadGeminiApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--key=')) return arg.slice(6).trim();
  }

  if (fs.existsSync(ENV_FILE)) {
    const lines = fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*GEMINI_API_KEY\s*=\s*(.+)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, '').trim();
    }
  }
  return '';
}

// 2. src/Gemini.js から最新の getDefaultSystemPrompt() を抽出
function loadCodeDefaultPrompt() {
  const code = fs.readFileSync(path.resolve(__dirname, '../src/Gemini.js'), 'utf8');
  const ctx = {};
  vm.runInNewContext(code, ctx);
  return ctx.getDefaultSystemPrompt();
}

// 3. スプレッドシートから全コンテキストデータを取得
async function fetchSpreadsheetData() {
  if (!fs.existsSync(KEY_FILE)) {
    throw new Error(`service-account.json が見つかりません: ${KEY_FILE}`);
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const [memRes, tasksRes, shopRes, inputRes, logsRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'memory!A2:B50' }),
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'tasks!A2:G200' }),
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'shopping!A2:D100' }),
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'input_stock!A2:E100' }),
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'logs!A2:E200' })
  ]);

  const memory = {};
  for (const r of (memRes.data.values || [])) {
    if (r[0]) memory[r[0].trim()] = r[1] || '';
  }

  const uncompletedTasks = (tasksRes.data.values || [])
    .filter(r => r[3] === '未完了')
    .map(r => ({
      id: r[0] || '',
      title: r[1] || '',
      dueDate: r[2] || '',
      status: r[3] || '',
      createdDate: r[4] || '',
      memo: r[6] || ''
    }));

  const unboughtShopping = (shopRes.data.values || [])
    .filter(r => r[2] === '未買')
    .map(r => ({ item: r[0] || '', category: r[1] || '' }));

  const pendingInput = (inputRes.data.values || [])
    .filter(r => r[3] === '未')
    .map(r => ({ type: r[0] || '', title: r[1] || '', memo: r[2] || '' }));

  const logs = (logsRes.data.values || []).map(r => ({
    timestamp: r[0] || '',
    sender: r[1] || 'user',
    message: r[2] || '',
    imageUrl: r[3] || '',
    aiReply: r[4] || ''
  }));

  return { memory, uncompletedTasks, unboughtShopping, pendingInput, logs };
}

// 4. GASの getSpreadsheetContext() と同等のコンテキスト文字列を構築
function buildContextText(data, nowStr, SimulatedTodayStr) {
  const { memory, uncompletedTasks, unboughtShopping, pendingInput } = data;
  const parts = SimulatedTodayStr.split('-');
  const todayDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));

  let context = `【現在日時】: ${nowStr}\n`;
  context += `【プロファイル】: ${memory.profile || '未設定'}\n`;
  context += `【天気・気温】: ${(memory.weather_info || '情報なし').split('｜')[0].trim()}\n`;
  context += `【気圧急降下】: ${memory.pressure_alert === 'TRUE' ? '急降下中(注意)' : '安定'}\n`;

  if (memory.dictionary) {
    context += `【用語辞書（客観的前提知識・誤認防止）】:\n${memory.dictionary.trim()}\n`;
  }
  if (memory.rolling_memory) {
    context += `【直近活動・関心バッファ】:\n${memory.rolling_memory.trim()}\n`;
  }
  if (memory.weekly_summary) {
    context += `【直近サマリー】: ${memory.weekly_summary.trim()}\n`;
  }
  if (memory.cycle_stamps) {
    context += `【周期・スキルアップ履歴（cycle_stamps）】:\n${memory.cycle_stamps.trim()}\n`;
  }

  if (uncompletedTasks.length > 0) {
    const taskLines = uncompletedTasks.map(t => {
      let warningTag = '';
      if (t.createdDate) {
        const cp = t.createdDate.split('-');
        if (cp.length === 3) {
          const cDate = new Date(parseInt(cp[0], 10), parseInt(cp[1], 10) - 1, parseInt(cp[2], 10));
          const diffDays = Math.floor((todayDate.getTime() - cDate.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays >= 7) warningTag = ' [⚠️登録後7日以上経過]';
        }
      }
      const memoPart = t.memo.trim() ? ` (メモ:${t.memo.trim()})` : '';
      return `[${t.id}] ${t.title}${t.dueDate ? ' (期限:' + t.dueDate + ')' : ''}${memoPart}${warningTag}`;
    });
    context += `未完了タスク: ${taskLines.join(' / ')}\n`;
  } else {
    context += `未完了タスク: なし\n`;
  }

  if (unboughtShopping.length > 0) {
    context += `買物(未買): ${unboughtShopping.map(s => s.item).join(', ')}\n`;
  }

  if (pendingInput.length > 0) {
    const inputItems = pendingInput.map(inp => {
      const memoPart = inp.memo.trim() ? `(${inp.memo.trim()})` : '';
      return `[${inp.type}]${inp.title}${memoPart}`;
    });
    context += `インプット未消化: ${inputItems.join(', ')}\n`;
  }

  return context.trim();
}

// 5. Gemini 3.8 Flash API 呼び出し
async function callGemini(apiKey, systemPrompt, userPromptBody) {
  const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPromptBody }] }],
      generationConfig: {
        temperature: 0.7,
        thinkingConfig: { thinkingBudget: 0 }
      }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API HTTP ${res.status}: ${errText}`);
  }

  const json = await res.json();
  const parts = json?.candidates?.[0]?.content?.parts || [];
  let text = parts.filter(p => p.text && !p.thought).map(p => p.text).join('').trim();
  text = text.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(text);
  } catch (_) {
    return { reply_text: text };
  }
}

async function main() {
  const apiKey = loadGeminiApiKey();
  if (!apiKey) {
    console.error('❌ GEMINI_API_KEY が設定されていません。');
    console.error('以下のいずれかの方法で指定してください:');
    console.error('  1) プロジェクト直下の .env ファイルに GEMINI_API_KEY=AIza... を記載する');
    console.error('  2) GEMINI_API_KEY="AIza..." node scripts/test-prompt.js と実行する');
    process.exit(1);
  }

  console.log('📊 スプレッドシートから最新コンテキストを取得中...');
  const data = await fetchSpreadsheetData();
  const customSuffix = data.memory.custom_system_prompt
    ? `\n\n【追加カスタム指示（最優先フォーマット・ルール）】\n${data.memory.custom_system_prompt.trim()}`
    : '';

  const oldPrompt = (data.memory.system_prompt || '').trim() + customSuffix;
  const newPrompt = loadCodeDefaultPrompt().trim() + customSuffix;

  const customArg = process.argv.slice(2).find(a => !a.startsWith('--'));

  // テストシナリオ定義
  const scenarios = customArg
    ? [
        {
          name: 'カスタム入力テスト',
          nowStr: '2026-10-25(日) 21:00',
          todayLogs: data.logs.slice(0, -1).map(l => `${l.timestamp.split(' ')[1]?.slice(0, 5) || ''} User: ${l.message}\nAI: ${l.aiReply.replace(/\n/g, ' ')}`).join('\n'),
          userText: customArg
        }
      ]
    : [
        {
          name: 'ケース1: 本日20:46（食後・家族とお菓子待ちの隙間時間相談 ※昼に一度『漱石』と『音楽』を提案済みの状態）',
          nowStr: '2026-10-25(日) 20:46',
          todayLogs: data.logs
            .filter(l => l.timestamp < '2026-10-25 20:46:00')
            .map(l => `${l.timestamp.split(' ')[1]?.slice(0, 5) || ''} User: ${l.message}\nAI: ${l.aiReply.replace(/\n/g, ' ')}`)
            .join('\n'),
          userText: 'ご飯食べ終えてだいぶ経ったけど、今何して過ごすかちょっと悩んでる　家族が一緒に食べたいお菓子あるみたいだからすぐには寝ない'
        },
        {
          name: 'ケース2: 休日昼15:00（午前中にぽこポケを2時間満喫済・体調は落ち着いており1時間ほど空きがある状態）',
          nowStr: '2026-10-25(日) 15:00',
          todayLogs: '09:00 User: おはよう、朝ごはん食べてから11時までぽこポケやった！楽しかった\nAI: ぽこポケたっぷり楽しめて何よりです！\n13:00 User: お昼ごはん食べ終わったよ\nAI: お昼ごはんお疲れさまでした！',
          userText: '16時すぎまで特に予定ないんだけど、何して過ごそうかな'
        },
        {
          name: 'ケース3: 準備行動の宣言（先読み・お節介・お礼が出ないかの検証）',
          nowStr: '2026-10-25(日) 16:55',
          todayLogs: '',
          userText: 'そろそろお風呂洗ってお湯沸かしてくるね'
        },
        {
          name: 'ケース4: 体調不良×暇（横になったままできる複数チャンネル提案の検証）',
          nowStr: '2026-10-25(日) 11:20',
          todayLogs: '09:00 User: おはよう、朝ごはん食べたよ\nAI: おはようございます！しっかり朝食が摂れて良かったです。',
          userText: 'お腹が重たくて横になってるんだけど、全然眠くはなくて暇なんだよね。13時のお昼まで何して過ごそう'
        },
        {
          name: 'ケース5: 起床直後＆活動目標宣言（今朝07:01再現: 逆算タイムライン設計と覚醒ウォームアップの検証）',
          nowStr: '2026-10-26(月) 07:01',
          todayLogs: '',
          userText: 'おはよう。今日は仕事前に生活伴走システムの改善をやりたいんだよね'
        },
        {
          name: 'ケース6: ルーティン完了報告（今朝07:09再現: 始業まで2時間50分の余白におけるネクストアクション導線の検証）',
          nowStr: '2026-10-26(月) 07:09',
          todayLogs: '07:01 User: おはよう。今日は仕事前に生活伴走システムの改善をやりたいんだよね\nAI: おはようございます！10時の始業まで約3時間ありますね。まずは水分補給や身支度で身体のエンジンをかけつつ、07:45〜09:45あたりでガッツリ改善作業の集中時間を取るスケジュールはいかがでしょうか？',
          userText: '今日のメダル受け取り完了'
        }
      ];

  for (const sc of scenarios) {
    console.log('\n============================================================');
    console.log(`🧪 ${sc.name}`);
    console.log(`💬 ユーザー発言: 「${sc.userText}」`);
    console.log('============================================================');

    const contextText = buildContextText(data, sc.nowStr, '2026-10-25');
    let body = `${contextText}\n\n`;
    if (sc.todayLogs) {
      body += `=== 本日の会話履歴 (時系列) ===\n${sc.todayLogs}\n\n`;
    }
    body += `=== ユーザーの最新発言 ===\n${sc.userText}`;

    const [oldRes, newRes] = await Promise.all([
      callGemini(apiKey, oldPrompt, body),
      callGemini(apiKey, newPrompt, body)
    ]);

    console.log('\n--- 【旧プロンプト（現在スプシにある版）】 ---');
    console.log(oldRes.reply_text);

    console.log('\n--- 【新プロンプト（今回再設計した版）】 ---');
    console.log(newRes.reply_text);
  }
}

main().catch(err => {
  console.error('❌ エラー:', err.message);
  process.exit(1);
});
