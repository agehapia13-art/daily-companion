#!/usr/bin/env node
/**
 * scripts/mock-server.js
 * v2 Companion Cockpit ローカルモック＆ハイブリッド（実Gemini連携）検証サーバー
 *
 * 特徴:
 *   - 実フロントエンド (docs/) + 実バックエンド (src/*.js) + インメモリGASシートDBで動作
 *   - .env (companion-cockpit/.env または resilient-noether/.env) の GEMINI_API_KEY を自動読み込み
 *     * キー設定時: インメモリDBを安全に使いつつ Gemini API だけ実機接続（ハイブリッド検証）
 *     * --mock-gemini 時 / キー未設定時: オフライン決定論モックで完結
 *   - 起動時に一連の操作＋Gemini返答E2Eテストを自動実行（--test-only / --no-test 対応）
 *
 * 使い方:
 *   node scripts/mock-server.js                  # E2Eテスト実行後に http://localhost:3456 起動
 *   node scripts/mock-server.js --test-only      # E2Eテストのみ実行して終了
 *   node scripts/mock-server.js --no-test        # テストをスキップして即サーバー起動
 *   node scripts/mock-server.js --mock-gemini    # Geminiも完全オフラインモックで実行
 *   node scripts/mock-server.js --port=4000      # ポート指定
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const assert = require('assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const DOCS_DIR = path.join(ROOT, 'docs');
const COMPANION_ROOT = path.resolve(ROOT, '..', 'companion-cockpit');

const args = process.argv.slice(2);
const TEST_ONLY = args.includes('--test-only');
const NO_TEST = args.includes('--no-test');
const FORCE_MOCK_GEMINI = args.includes('--mock-gemini');
const portArg = args.find(a => a.startsWith('--port='));
const PORT = portArg ? parseInt(portArg.split('=')[1], 10) || 3456 : (parseInt(process.env.PORT, 10) || 3456);
const MOCK_AUTH_KEY = 'mock-key';

/**
 * .env ファイルからキーを安全に環境変数へ読み込む（値自体はログ出力しない）
 */
function loadDotEnvIfPresent() {
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) return 'env';
  const candidates = [
    path.join(COMPANION_ROOT, '.env'),
    path.join(ROOT, '.env')
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && val && !process.env[key]) {
        process.env[key] = val;
      }
    }
    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
      return path.relative(path.resolve(ROOT, '..'), envPath);
    }
  }
  return '';
}

const KEY_SOURCE = loadDotEnvIfPresent();
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const USE_LIVE_GEMINI = Boolean(GEMINI_API_KEY && !FORCE_MOCK_GEMINI);

// =============================================================================
// 1. インメモリ GAS サービスシム (SpreadsheetApp / DocumentApp / DriveApp / Cache / Lock)
// =============================================================================

function createInMemorySheet(name, initialRows) {
  const rows = initialRows.map(r => r.slice());

  function ensureCell(r0, c0) {
    while (rows.length <= r0) rows.push([]);
    while (rows[r0].length <= c0) rows[r0].push('');
  }

  function makeRange(row1, col1, numRows, numCols) {
    const rCount = Math.max(1, numRows || 1);
    const cCount = Math.max(1, numCols || 1);
    return {
      getRow: () => row1,
      getColumn: () => col1,
      getNumRows: () => rCount,
      getNumColumns: () => cCount,
      getLastRow: () => row1 + rCount - 1,
      getValues() {
        const out = [];
        for (let r = 0; r < rCount; r++) {
          const srcRow = rows[row1 - 1 + r] || [];
          const rowCopy = [];
          for (let c = 0; c < cCount; c++) {
            const val = srcRow[col1 - 1 + c];
            rowCopy.push(val === undefined || val === null ? '' : val);
          }
          out.push(rowCopy);
        }
        return out;
      },
      getValue() {
        return this.getValues()[0][0];
      },
      setValues(values2d) {
        for (let r = 0; r < values2d.length; r++) {
          const rowIdx = row1 - 1 + r;
          const rowVals = values2d[r] || [];
          for (let c = 0; c < rowVals.length; c++) {
            ensureCell(rowIdx, col1 - 1 + c);
            rows[rowIdx][col1 - 1 + c] = rowVals[c];
          }
        }
      },
      setValue(val) {
        ensureCell(row1 - 1, col1 - 1);
        rows[row1 - 1][col1 - 1] = val;
      },
      clearContent() {
        for (let r = 0; r < rCount; r++) {
          for (let c = 0; c < cCount; c++) {
            if (rows[row1 - 1 + r] && col1 - 1 + c < rows[row1 - 1 + r].length) {
              rows[row1 - 1 + r][col1 - 1 + c] = '';
            }
          }
        }
      },
      setNumberFormat() { return this; },
      setFontWeight() { return this; },
      setBackground() { return this; },
      createFilter() { return null; }
    };
  }

  return {
    _rows: rows,
    getName: () => name,
    getLastRow() {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i] && rows[i].some(cell => cell !== '' && cell !== null && cell !== undefined)) {
          return i + 1;
        }
      }
      return 0;
    },
    getLastColumn() {
      let max = 0;
      for (const r of rows) {
        if (r && r.length > max) max = r.length;
      }
      return max;
    },
    getMaxRows: () => Math.max(rows.length, 200),
    insertRowsAfter: () => {},
    getFilter: () => null,
    getRange: (r, c, nr, nc) => makeRange(r, c, nr, nc),
    getDataRange() {
      return makeRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
    },
    appendRow(rowData) {
      rows.push(Array.isArray(rowData) ? rowData.slice() : [rowData]);
    },
    deleteRow(row1) {
      if (row1 >= 1 && row1 <= rows.length) {
        rows.splice(row1 - 1, 1);
      }
    },
    clear() {
      rows.length = 0;
    },
    setFrozenRows: () => {},
    autoResizeColumn: () => {}
  };
}

function buildSeededSheets(promptCtx) {
  const sheets = {};
  const today = '2026-11-20';

  sheets.logs = createInMemorySheet('logs', [
    ['時刻', '発言者', 'メッセージ', '画像URL', 'AI返答', 'Lite入力', 'Lite出力', 'Liteキャッシュ', 'Flash入力', 'Flash出力', 'Flashキャッシュ', '新総トークン', '判定タグ/フェーズ', '旧AI返答（比較用）', '旧Flash総トークン', 'トークン削減差分'],
    [`${today} 07:45:00`, 'user', '【完了】起床', '', '[スタンプ: ☀️]']
  ]);

  sheets.tasks = createInMemorySheet('tasks', [
    ['ID', 'タイトル', '期限', 'ステータス', '作成日', '完了日時', 'メモ', '実施タイミング目安', '連携資料URL', '見込み所要時間(分)'],
    ['T_20261102_093316_410', '[制作・創作] ブラックフライデーのプラグイン購入検討', '2026-11-27', '未完了', '2026-11-02', '', 'セール対象プラグイン検討', '休日PC・夜自由時間', 'https://docs.google.com/document/d/1XUq6hv030_P_XyP2btiyo1m1yyMdNwP69fHJ5Pq7aiQ/edit', 30],
    ['T_20261026_191721_102', '[家事・環境] Googleドライブのファイル整理', '', '未完了', '2026-10-26', '', '時間かかるからそのうち', 'PC作業・隙間30分', 'https://docs.google.com/document/d/1HAQ5iAV3K5jeB41ghXY9CzB9j8JkOkQYy44XSwFfats/edit', 30],
    ['T_20261103_230042_188', '[家事・環境] Chrome・iCloud・Notionのパスワードを1Passwordへ順次移行', '', '未完了', '2026-11-03', '', '優先度高め', '直近の空き枠・最優先', '', 20],
    ['T_20261114_224707_511', '[家事・環境] 毛布の購入', '2026-11-19', '未完了', '2026-11-14', '', '毛布を購入する', '直近の空き枠', '', 45]
  ]);

  sheets.routines = createInMemorySheet('routines', [
    ['ルール名', '周期タイプ', '設定値', '最終生成日', 'メモ', 'ステータス', '完了日'],
    ['[趣味・文化] モンスト：超究極・兵のミザリー周回', 'interval_days', '1', '2026-11-19', '', '有効', '']
  ]);

  sheets.shopping = createInMemorySheet('shopping', [
    ['アイテム', 'カテゴリ', 'ステータス', '登録日'],
    ['バター餅（ローソン）', '食品', '未買', '2026-11-18']
  ]);

  sheets.input_stock = createInMemorySheet('input_stock', [
    ['種類', 'タイトル', 'メモ', 'ステータス', '消費日', '見込み所要時間(分)'],
    ['本', '漱石と倫敦ミイラ殺人事件', '推理小説', '未', '', 45],
    ['その他', '薬屋のひとりごと 第3シーズン', 'アニメ（複数話）', '未', '', 25]
  ]);

  sheets.memory = createInMemorySheet('memory', [
    ['キー', '値'],
    ['profile', 'サウンドディレクター / ゲーム・映像音響制作。女性。自宅(横浜市磯子区・最寄り上大岡駅徒歩15分強、両親・妹の早希と同居)と職場(渋谷、約1.5時間)。月・木・金リモート、火・水出社（10:00〜19:00、昼12:00〜13:00）。'],
    ['weather_info', '自宅(磯子): 晴れ 最高17℃ 降水10% ｜ 職場(渋谷): 晴れ 最高18℃ 降水10%'],
    ['pressure_alert', 'FALSE'],
    ['backend_model', '3.5-lite'],
    ['thinking_level', 'low'],
    ['monthly_report_ready', 'FALSE'],
    ['custom_system_prompt', '【口調・話し方】\n丁寧な敬体（です・ます調）で、落ち着いた頼れる伴走者として自然に応答する。\n定型の挨拶や前置きに頼りすぎず、さっぱりとした等身大の距離感で要点へ自然に入る。'],
    ['ideal_self', '健やかな心身と社会性のある繋がりを保ちつつ、夜は罪悪感なくしっかり休み、すっきり目覚めた朝の余白でタスクや好きな時間を楽しむ生活。'],
    ['lifestyle_habits', [
      '[入浴]: お湯張りと入浴は完全に別タスク。入浴開始〜洗髪・ドライヤー・スキンケア・着替え完了まで一式で1時間ほどかかる。',
      '[食事]: 土日の昼食は12:30〜13:30、夕食は18:00〜19:00でほぼ固定。',
      '[身支度]: 起きてから朝食〜身支度完了までに1時間半ほどかかる。',
      '[音作業]: 長時間の音作業・ディレクション後は、無音で耳を休める時間が必要。',
      '[睡眠]: 07:00起床・23:00就寝が理想の健康軸。',
      '[家事]: 洗濯は深夜・就寝前に設定（基本は母親が担当）。'
    ].join('\n')],
    ['skill_options', '[30分〜1時間]: 【音楽・音響】30分スケッチ(DAWモチーフ作り) / 【ビジネス・思考】記事1章要約'],
    ['cycle_stamps', '爪切り: 2026-11-15\n外歩き・散歩: 2026-11-18\n読書（本・漫画）: 2026-11-14\nピアノ演奏: 2026-11-19'],
    ['project_folders', [
      '[02_制作・創作] 2611_BFプラグイン購入検討 | folder:1MwBCrApQNhHNbNlLlcaVJzaL67hacBDQ | doc:1XUq6hv030_P_XyP2btiyo1m1yyMdNwP69fHJ5Pq7aiQ',
      '[03_家事・環境] 2611_Google Drive整理 | folder:1O76_33kWjyNf3r1GzXAaUVeY8G-2jTj_ | doc:1HAQ5iAV3K5jeB41ghXY9CzB9j8JkOkQYy44XSwFfats'
    ].join('\n')],
    ['dictionary', '・ぽこあポケモン（ぽこポケ）: Nintendo Switch 2用ゲーム。\n・残響フラクタル: オリジナル創作小説作品。'],
    ['rolling_memory', '- 2026-11-18: 出社日。帰宅時に地元イルミネーションを楽しんだ。\n- 2026-11-19: 在宅勤務。夜にピアノ演奏して就寝。'],
    ['prompt_core', promptCtx.getDefaultPromptCore()],
    ['prompt_schedule', promptCtx.getDefaultPromptSchedule()],
    ['prompt_db', promptCtx.getDefaultPromptDb()],
    ['prompt_deck', promptCtx.getDefaultPromptDeck()],
    ['weather_fetched_at', '2026-11-20T10:00:00+09:00']
  ]);

  return sheets;
}

// =============================================================================
// 2. Gemini Live (同期HTTPS subprocess) & Offline Mock レスポンダ
// =============================================================================

function callRealGeminiSync(url, options) {
  const helperScript = `
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', d => buf += d);
    process.stdin.on('end', async () => {
      try {
        const req = JSON.parse(buf);
        const res = await fetch(req.url, {
          method: req.method || 'POST',
          headers: req.headers || { 'Content-Type': 'application/json' },
          body: req.payload
        });
        const text = await res.text();
        process.stdout.write(JSON.stringify({ status: res.status, text }));
      } catch (err) {
        process.stdout.write(JSON.stringify({ status: 500, text: JSON.stringify({ error: { message: err.message } }) }));
      }
    });
  `;
  const rawOut = execFileSync(process.execPath, ['-e', helperScript], {
    input: JSON.stringify({
      url,
      method: (options && options.method) || 'post',
      headers: (options && options.headers) || { 'Content-Type': 'application/json' },
      payload: (options && options.payload) || ''
    }),
    env: Object.assign({}, process.env, { GEMINI_API_KEY }),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
  const parsed = JSON.parse(rawOut);
  return {
    getResponseCode: () => parsed.status,
    getContentText: () => parsed.text
  };
}

function generateMockGeminiResponse(url, options) {
  const body = JSON.parse((options && options.payload) || '{}');
  const sysText = ((body.systemInstruction || body.system_instruction || {}).parts || []).map(p => p.text || '').join('\n');
  const userText = (body.contents || []).map(c => (c.parts || []).map(p => p.text || '').join('\n')).join('\n');

  // Deck 生成リクエスト判定
  if (sysText.includes('cards') && sysText.includes('lowCards')) {
    const deckJson = {
      cards: [
        { title: 'パスワードの1Password移行', category: 'タスク', durationMins: 20, linkedType: 'task', linkedId: 'T_20261103_230042_188', reason: '最優先・短時間で進めやすい' },
        { title: '30分スケッチ(DAWモチーフ作り)', category: '制作', durationMins: 30, linkedType: 'skill', linkedId: '', reason: '手元で軽く音を触る' },
        { title: 'Googleドライブのファイル整理', category: 'タスク', durationMins: 30, linkedType: 'task', linkedId: 'T_20261026_191721_102', reason: '隙間時間に少しずつ進められる' },
        { title: '薬屋のひとりごと 第3シーズン', category: 'インプット', durationMins: 25, linkedType: 'stock', linkedId: '薬屋のひとりごと 第3シーズン', reason: '1話視聴で気分転換' }
      ],
      lowCards: [
        { title: '無音で耳を休める', category: 'リラックス', durationMins: 5, linkedType: 'habit', linkedId: '', reason: '音作業のあとの耳の休息' },
        { title: '温かい飲み物で一息', category: 'ケア', durationMins: 10, linkedType: 'habit', linkedId: '', reason: '画面から目を離す' },
        { title: '薬屋のひとりごと 第3シーズン', category: 'インプット', durationMins: 25, linkedType: 'stock', linkedId: '薬屋のひとりごと 第3シーズン', reason: '無理なく見られる' }
      ]
    };
    return {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(deckJson) }] } }],
        usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 280, totalTokenCount: 1480 }
      })
    };
  }

  // Chat リクエスト判定
  const msgMatch = userText.match(/=== ユーザーの最新発言 ===\n([\s\S]*?)(\n\n===|$)/);
  const latestMsg = msgMatch ? msgMatch[1].trim() : userText;
  let chatJson = {
    need_deep_thinking: false,
    reply_mode: 'reply',
    reaction_emoji: '👍',
    reply_text: '承知しました。引き続きご自身のペースで進めていきましょう。'
  };

  if (/昼.*食べ|お昼ご飯/.test(latestMsg)) {
    chatJson = {
      need_deep_thinking: false,
      reply_mode: 'reaction',
      reaction_emoji: '🍲',
      reply_text: '',
      state_changes: { completed_anchor_id: 'anchor_lunch' }
    };
  } else if (/だるい|つかれ|疲れ|しんど/.test(latestMsg)) {
    chatJson = {
      need_deep_thinking: false,
      reply_mode: 'reply',
      reaction_emoji: '🌙',
      reply_text: '少しお疲れがたまっているのですね。今日は低負荷モードに切り替えて、無理せずゆっくり過ごしましょう。',
      state_changes: { mark_low_mode: true }
    };
  } else if (/見込み.*45分|45分に/.test(latestMsg)) {
    chatJson = {
      need_deep_thinking: false,
      reply_mode: 'reply',
      reaction_emoji: '👍',
      reply_text: 'Googleドライブのファイル整理の見込み時間を45分に変更しました。',
      task_actions: [{ action: 'update', task_id: 'T_20261026_191721_102', estimated_mins: 45 }]
    };
  } else if (/1話|少し進め|今日はここまで/.test(latestMsg)) {
    chatJson = {
      need_deep_thinking: false,
      reply_mode: 'reply',
      reaction_emoji: '📺',
      reply_text: '1話視聴おつかれさまです！続きが楽しみですね。未完のまま記録しておきました。'
    };
  } else if (/FabFilter|メモ足し/.test(latestMsg)) {
    chatJson = {
      need_deep_thinking: false,
      reply_mode: 'reply',
      reaction_emoji: '📝',
      reply_text: 'FabFilter Pro-Q 4を候補として資料に追記しました。',
      project_actions: [{
        action: 'append_doc',
        project_name: '2611_BFプラグイン購入検討',
        task_id: 'T_20261102_093316_410',
        content: '検討候補: FabFilter Pro-Q 4'
      }]
    };
  }

  return {
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(chatJson) }] } }],
      usageMetadata: { promptTokenCount: 3800, candidatesTokenCount: 160, cachedContentTokenCount: 0, totalTokenCount: 3960 }
    })
  };
}

// =============================================================================
// 3. 完全なバックエンド VM 環境ビルダー
// =============================================================================

function createMockRuntime(options) {
  const useLiveGemini = options && typeof options.useLiveGemini === 'boolean' ? options.useLiveGemini : USE_LIVE_GEMINI;
  const promptCtx = { Console: console };
  vm.createContext(promptCtx);
  vm.runInContext(fs.readFileSync(path.join(SRC_DIR, 'Prompts.js'), 'utf8'), promptCtx);

  const sheets = buildSeededSheets(promptCtx);
  const scriptProps = {
    OWNER_USER_ID: 'MOCK_OWNER',
    DASHBOARD_ACCESS_KEY: MOCK_AUTH_KEY,
    GEMINI_API_KEY: GEMINI_API_KEY || 'MOCK_OFFLINE_KEY',
    SPREADSHEET_ID: 'mock-ss-id',
    DRIVE_FOLDER_ID: 'mock-drv-id',
    NOTION_API_KEY: 'mock-notion',
    NOTION_DAILY_DB_ID: 'mock-nd',
    NOTION_MONTHLY_DB_ID: 'mock-nm'
  };
  const cacheStore = {};
  const docsStore = {
    '1XUq6hv030_P_XyP2btiyo1m1yyMdNwP69fHJ5Pq7aiQ': ['2611_BFプラグイン購入検討'],
    '1HAQ5iAV3K5jeB41ghXY9CzB9j8JkOkQYy44XSwFfats': ['2611_Google Drive整理']
  };
  const driveFiles = {
    '1XUq6hv030_P_XyP2btiyo1m1yyMdNwP69fHJ5Pq7aiQ': { name: '2611_BFプラグイン購入検討' },
    '1HAQ5iAV3K5jeB41ghXY9CzB9j8JkOkQYy44XSwFfats': { name: '2611_Google Drive整理' }
  };
  const geminiTrace = [];
  let docSeq = 1;

  const ctx = {
    console, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent,
    Logger: { log: (msg) => { if (/エラー|Error/.test(String(msg))) console.error('  [GAS LOG]', msg); } },
    Utilities: {
      Charset: { UTF_8: 'UTF-8' },
      DigestAlgorithm: { SHA_256: 'SHA-256' },
      computeDigest: () => [1, 2, 3, 4, 5, 6],
      base64Decode: (b64) => Buffer.from(b64 || '', 'base64'),
      newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
      sleep: () => {},
      formatDate(date, tz, pattern) {
        const dObj = date instanceof Date ? date : new Date(date);
        const jst = new Date(dObj.getTime() + 9 * 60 * 60 * 1000);
        const y = jst.getUTCFullYear();
        const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
        const d = String(jst.getUTCDate()).padStart(2, '0');
        const h = String(jst.getUTCHours()).padStart(2, '0');
        const min = String(jst.getUTCMinutes()).padStart(2, '0');
        const s = String(jst.getUTCSeconds()).padStart(2, '0');
        const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][jst.getUTCDay()];
        if (pattern === 'yyyy-MM-dd') return `${y}-${m}-${d}`;
        if (pattern === 'HH:mm') return `${h}:${min}`;
        if (pattern === 'H') return String(jst.getUTCHours());
        if (pattern === 'yyyyMMdd_HHmmss') return `${y}${m}${d}_${h}${min}${s}`;
        if (pattern === 'yyyy/MM/dd HH:mm') return `${y}/${m}/${d} ${h}:${min}`;
        if (pattern === 'yyyy-MM-dd HH:mm:ss') return `${y}-${m}-${d} ${h}:${min}:${s}`;
        if (pattern === 'yyyy-MM-dd(E) HH:mm') return `${y}-${m}-${d}(${dow}) ${h}:${min}`;
        if (pattern === "yyyy-MM-dd'T'HH:mm:ss+09:00") return `${y}-${m}-${d}T${h}:${min}:${s}+09:00`;
        return jst.toISOString();
      }
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (Object.prototype.hasOwnProperty.call(scriptProps, k) ? scriptProps[k] : null),
        setProperty: (k, v) => { scriptProps[k] = String(v); },
        getProperties: () => Object.assign({}, scriptProps)
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (Object.prototype.hasOwnProperty.call(cacheStore, k) ? cacheStore[k] : null),
        put: (k, v) => { cacheStore[k] = String(v); },
        remove: (k) => { delete cacheStore[k]; }
      })
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {},
        tryLock: () => true,
        releaseLock: () => {}
      })
    },
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: (name) => sheets[name] || null,
        insertSheet: (name) => {
          sheets[name] = createInMemorySheet(name, []);
          return sheets[name];
        }
      }),
      flush: () => {}
    },
    DocumentApp: {
      ParagraphHeading: { HEADING1: 'HEADING1' },
      GlyphType: { BULLET: 'BULLET' },
      create(title) {
        const id = 'MOCK_DOC_' + (docSeq++);
        const lines = [];
        docsStore[id] = lines;
        driveFiles[id] = { name: title };
        const makeBody = () => ({
          appendParagraph: (t) => { lines.push(String(t || '')); return { setHeading: () => {} }; },
          appendListItem: (t) => { lines.push(String(t || '')); return { setGlyphType: () => {} }; },
          appendHorizontalRule: () => {}
        });
        return {
          getId: () => id,
          getName: () => title,
          getUrl: () => `https://docs.google.com/document/d/${id}/edit`,
          getBody: makeBody,
          saveAndClose: () => {}
        };
      },
      openById(id) {
        if (!docsStore[id]) docsStore[id] = [];
        const lines = docsStore[id];
        const title = (driveFiles[id] && driveFiles[id].name) || 'MockDoc';
        const makeBody = () => ({
          appendParagraph: (t) => { lines.push(String(t || '')); return { setHeading: () => {} }; },
          appendListItem: (t) => { lines.push(String(t || '')); return { setGlyphType: () => {} }; },
          appendHorizontalRule: () => {}
        });
        return {
          getId: () => id,
          getName: () => title,
          getUrl: () => `https://docs.google.com/document/d/${id}/edit`,
          getBody: makeBody,
          saveAndClose: () => {}
        };
      }
    },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
      Permission: { VIEW: 'VIEW' },
      getRootFolder: () => ({
        getFoldersByName: () => ({ hasNext: () => false }),
        createFolder: (n) => ({ getId: () => 'MOCK_FOLDER_' + n })
      }),
      getFolderById: (id) => ({
        getId: () => id,
        createFile: () => ({
          getId: () => 'MOCK_IMG_' + (docSeq++),
          setSharing: () => {}
        }),
        getFoldersByName: () => ({ hasNext: () => false }),
        createFolder: (n) => ({ getId: () => 'MOCK_FOLDER_' + n }),
        addFile: () => {}
      }),
      getFileById: (id) => ({
        getName: () => (driveFiles[id] && driveFiles[id].name) || 'MockDoc',
        setSharing: () => {},
        moveTo: () => {}
      })
    },
    CalendarApp: {
      getDefaultCalendar: () => ({
        getEvents: () => [],
        createEvent: () => ({ getId: () => 'MOCK_EV_' + (docSeq++) }),
        createAllDayEvent: () => ({ getId: () => 'MOCK_EV_' + (docSeq++) })
      }),
      getCalendarById: () => null
    },
    HtmlService: {
      createHtmlOutputFromFile: () => ({
        getContent: () => fs.readFileSync(path.join(SRC_DIR, 'DashboardHtml.html'), 'utf8')
      })
    },
    UrlFetchApp: {
      fetch(url, fetchOpts) {
        if (String(url).includes('generativelanguage.googleapis.com')) {
          const t0 = Date.now();
          const res = useLiveGemini ? callRealGeminiSync(url, fetchOpts) : generateMockGeminiResponse(url, fetchOpts);
          const elapsedMs = Date.now() - t0;
          let usage = null;
          let snippet = '';
          try {
            const parsed = JSON.parse(res.getContentText());
            usage = parsed.usageMetadata || null;
            snippet = (((parsed.candidates || [])[0] || {}).content || {}).parts?.[0]?.text?.slice(0, 1200) || '';
          } catch (e) {}
          geminiTrace.push({
            mode: useLiveGemini ? 'live' : 'mock',
            status: res.getResponseCode(),
            elapsedMs,
            model: String(url).match(/models\/([^:]+)/)?.[1] || 'unknown',
            usage,
            snippet
          });
          return res;
        }
        if (String(url).includes('open-meteo.com')) {
          return {
            getResponseCode: () => 200,
            getContentText: () => JSON.stringify({
              daily: {
                weather_code: [0],
                temperature_2m_max: [17.4],
                temperature_2m_min: [9.2],
                precipitation_probability_max: [10]
              },
              hourly: { surface_pressure: [1015, 1015, 1014, 1014] }
            })
          };
        }
        return { getResponseCode: () => 200, getContentText: () => '{}' };
      }
    }
  };

  vm.createContext(ctx);
  const files = [
    'Config.js', 'Prompts.js', 'Spreadsheet.js', 'MemoryStore.js',
    'Weather.js', 'Calendar.js', 'FastState.js', 'DeckEngine.js',
    'GeminiClient.js', 'CompanionChat.js', 'DriveProject.js',
    'ReportGenerator.js', 'Media.js', 'Api.js'
  ];
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(SRC_DIR, f), 'utf8'), ctx, { filename: f });
  }

  return { ctx, sheets, docsStore, scriptProps, geminiTrace, useLiveGemini };
}

// =============================================================================
// 4. 一連の操作 ＆ Gemini返答チェック E2E スイート
// =============================================================================

function runE2ESuite() {
  const modeLabel = USE_LIVE_GEMINI ? `LIVE Gemini (${KEY_SOURCE || 'env'})` : 'OFFLINE Mock Gemini';
  console.log(`\n━━ 🧪 Mock E2E 一連操作＋返答チェック (${modeLabel}) ━━`);

  const rt = createMockRuntime({ useLiveGemini: USE_LIVE_GEMINI });
  global.__lastMockRt = rt;
  const { ctx, docsStore, geminiTrace } = rt;

  const callApi = (action, ...apiArgs) => {
    const res = ctx.handleDashboardApiRequest({ apiAction: action, args: apiArgs });
    assert.strictEqual(res.ok, true, `${action} failed: ${res.error}`);
    return JSON.parse(JSON.stringify(res.data));
  };

  // 1. Bootstrap
  const boot = callApi('apiGetHomeBootstrap', MOCK_AUTH_KEY);
  assert.strictEqual(boot.authorized, true, 'Bootstrap authorized');
  assert.ok(Array.isArray(boot.deck.cards) && boot.deck.cards.length > 0, 'Deck has cards');
  assert.ok(boot.lists.tasks.length >= 4, 'Seeded tasks loaded');
  assert.ok(boot.lists.stock.length >= 2, 'Seeded input stock loaded');
  console.log(`  ✅ 1. Bootstrap (cards=${boot.deck.cards.length}, tasks=${boot.lists.tasks.length}, stock=${boot.lists.stock.length})`);

  // 2. タスク途中経過（「今日はここまで」 keepOpen: true）
  const driveTask = boot.lists.tasks.find(t => t.id === 'T_20261026_191721_102');
  assert.ok(driveTask, 'Drive cleanup task exists');
  callApi('apiStartAction', MOCK_AUTH_KEY, {
    id: 'card_drive_test',
    title: driveTask.title,
    category: 'タスク',
    durationMins: 30,
    linkedType: 'task',
    linkedId: driveTask.id
  });
  const keepOpenTaskRes = callApi('apiCompleteAction', MOCK_AUTH_KEY, {
    session: {
      id: 'card_drive_test',
      title: driveTask.title,
      category: 'タスク',
      durationMins: 30,
      linkedType: 'task',
      linkedId: driveTask.id
    },
    mood: '👍 まあまあ',
    note: 'フォルダ半分整理した',
    keepOpen: true
  });
  const driveTaskAfter = keepOpenTaskRes.lists.tasks.find(t => t.id === driveTask.id);
  assert.ok(driveTaskAfter && driveTaskAfter.done === false, 'keepOpen=true keeps task uncompleted (done=false)');
  assert.strictEqual(Boolean(keepOpenTaskRes.state.completedToday[driveTask.id]), false, 'keepOpen=true does not mark linkedId completedToday');
  assert.ok(keepOpenTaskRes.addedChatMessage.userText.startsWith('【進行】'), 'keepOpen=true logs as 【進行】');
  console.log('  ✅ 2. タスク途中経過 (keepOpen: true → 未完のまま【進行】ログ記録)');

  // 3. アニメ1話視聴（「今日はここまで」 keepOpen: true）
  const animeStock = boot.lists.stock.find(s => s.title.includes('薬屋のひとりごと'));
  assert.ok(animeStock, 'Anime stock exists');
  callApi('apiStartAction', MOCK_AUTH_KEY, {
    id: 'card_anime_test',
    title: animeStock.title,
    category: 'インプット',
    durationMins: 25,
    linkedType: 'stock',
    linkedId: animeStock.title
  });
  const keepOpenAnimeRes = callApi('apiCompleteAction', MOCK_AUTH_KEY, {
    session: {
      id: 'card_anime_test',
      title: animeStock.title,
      category: 'インプット',
      durationMins: 25,
      linkedType: 'stock',
      linkedId: animeStock.title
    },
    mood: '😌 ほっとした',
    note: '1話視聴',
    keepOpen: true
  });
  const animeAfter = keepOpenAnimeRes.lists.stock.find(s => s.title === animeStock.title);
  assert.ok(animeAfter && animeAfter.done === false, 'keepOpen=true keeps anime stock uncompleted (done=false)');
  console.log('  ✅ 3. アニメ途中経過 (keepOpen: true → インプットストック未完維持)');

  // 4. タスク完全完了 (keepOpen: false)
  const blanketTask = boot.lists.tasks.find(t => t.id === 'T_20261114_224707_511');
  callApi('apiStartAction', MOCK_AUTH_KEY, {
    id: 'card_blanket_test',
    title: blanketTask.title,
    category: 'タスク',
    durationMins: 45,
    linkedType: 'task',
    linkedId: blanketTask.id
  });
  const fullCompleteRes = callApi('apiCompleteAction', MOCK_AUTH_KEY, {
    session: {
      id: 'card_blanket_test',
      title: blanketTask.title,
      category: 'タスク',
      durationMins: 45,
      linkedType: 'task',
      linkedId: blanketTask.id
    },
    mood: '✨ すっきり',
    note: '注文完了',
    keepOpen: false
  });
  const blanketAfter = fullCompleteRes.lists.tasks.find(t => t.id === blanketTask.id);
  assert.ok(blanketAfter && blanketAfter.done === true, 'keepOpen=false marks task as done=true');
  assert.ok(fullCompleteRes.addedChatMessage.userText.startsWith('【完了】'), 'keepOpen=false logs as 【完了】');
  console.log('  ✅ 4. タスク完全完了 (keepOpen: false → 完了ステータス反映)');

  // 5. List直接操作（Shopping トグル）＆ スキップ
  const firstShop = boot.lists.shopping[0];
  assert.ok(firstShop && firstShop.rowIndex, 'Seeded shopping item exists');
  const toggleShopRes = callApi('apiMutateListItem', MOCK_AUTH_KEY, {
    listType: 'shopping',
    action: 'toggle',
    rowIndex: firstShop.rowIndex,
    done: true
  });
  assert.strictEqual(toggleShopRes.lists.shopping.some(s => s.rowIndex === firstShop.rowIndex), false, 'Completed shopping item removed from unpurchased list');
  callApi('apiDismissCardToday', MOCK_AUTH_KEY, 'mock_dismiss_card');
  console.log('  ✅ 5. リスト買えたトグル＆カードスキップ OK');

  // 6. Chat E2E（実Gemini または モックGemini）
  const chat1 = callApi('apiSendChat', MOCK_AUTH_KEY, { text: 'お昼ご飯食べたよ' });
  assert.strictEqual(chat1.authorized, true);
  assert.strictEqual(Boolean(chat1.state.completedToday.anchor_lunch), true, 'Chat1: anchor_lunch completed');
  console.log(`  ✅ 6a. Chat 食事報告 → mode=${chat1.mode} [${chat1.reactionEmoji}]`);

  const chat2 = callApi('apiSendChat', MOCK_AUTH_KEY, { text: 'Googleドライブのファイル整理の見込み時間45分に変えて' });
  const updatedDriveTask = chat2.lists.tasks.find(t => t.id === 'T_20261026_191721_102');
  assert.strictEqual(updatedDriveTask && updatedDriveTask.mins, 45, `Chat2: mins expected 45, got ${updatedDriveTask && updatedDriveTask.mins}`);
  console.log(`  ✅ 6b. Chat タスク見積変更 → mins=${updatedDriveTask.mins}`);

  const chat3 = callApi('apiSendChat', MOCK_AUTH_KEY, { text: '薬屋のひとりごと 1話だけ見た、今日はここまで' });
  const animeAfterChat3 = chat3.lists.stock.find(s => s.title.includes('薬屋のひとりごと'));
  assert.ok(animeAfterChat3 && animeAfterChat3.done === false, 'Chat3: 1話視聴でストックを完了にしてはいけない');
  console.log('  ✅ 6c. Chat アニメ1話視聴報告 → 未完のまま維持（誤完了なし）');

  const chat4 = callApi('apiSendChat', MOCK_AUTH_KEY, { text: 'ブラックフライデーのプラグイン検討にFabFilter Pro-Q 4も候補でメモ足しといて' });
  const docLines = docsStore['1XUq6hv030_P_XyP2btiyo1m1yyMdNwP69fHJ5Pq7aiQ'] || [];
  assert.ok(docLines.some(l => /FabFilter/i.test(l)), `Chat4: expected FabFilter appended to Google Doc, got: ${JSON.stringify(docLines)}`);
  console.log(`  ✅ 6d. Chat 連携Doc追記 → "${docLines[docLines.length - 1]}"`);

  const chat5 = callApi('apiSendChat', MOCK_AUTH_KEY, { text: 'ちょっとだるいかも…' });
  assert.strictEqual(chat5.state.isLowMode, true, 'Chat5: isLowMode transitioned to true');
  console.log('  ✅ 6e. Chat 疲労申告 → 低負荷モード移行');

  // 7. Deck 再生成
  const refDeck = callApi('apiRefreshDeck', MOCK_AUTH_KEY, []);
  assert.ok(refDeck.deck && Array.isArray(refDeck.deck.cards) && refDeck.deck.cards.length > 0, 'Deck refreshed');
  console.log(`  ✅ 7. デッキ再生成 OK (cards=${refDeck.deck.cards.length}, geminiCalls=${geminiTrace.length})`);
  console.log('🎉 E2E 一連テスト全項目 PASS\n');
}

// =============================================================================
// 5. HTTP ローカルサーバー (PWA docs/ + /api + /mock-state)
// =============================================================================

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function startMockServer() {
  const rt = createMockRuntime({ useLiveGemini: USE_LIVE_GEMINI });

  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost:' + PORT}`);
    const pathname = reqUrl.pathname;

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Backend API endpoint (GAS doPost互換)
    if (pathname === '/api' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const t0 = Date.now();
          const apiRes = rt.ctx.handleDashboardApiRequest(payload);
          const ms = Date.now() - t0;
          console.log(`[API] ${payload.apiAction} (${ms}ms) -> ${apiRes.ok ? 'OK' : 'ERR: ' + apiRes.error}`);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(apiRes));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    // Inspect mock DB & Gemini call trace
    if (pathname === '/mock-state' && req.method === 'GET') {
      const snapshot = {
        mode: rt.useLiveGemini ? 'live-gemini' : 'mock-gemini',
        tasks: rt.sheets.tasks._rows,
        input_stock: rt.sheets.input_stock._rows,
        shopping: rt.sheets.shopping._rows,
        logs: rt.sheets.logs._rows,
        docs: rt.docsStore,
        geminiTrace: rt.geminiTrace
      };
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(snapshot, null, 2));
      return;
    }

    // Root access without ?api= -> redirect with local API & mock key params
    if (pathname === '/' && !reqUrl.searchParams.has('api')) {
      const origin = `http://${req.headers.host || 'localhost:' + PORT}`;
      const target = `/?api=${encodeURIComponent(origin + '/api')}&key=${encodeURIComponent(MOCK_AUTH_KEY)}`;
      res.writeHead(302, { Location: target });
      res.end();
      return;
    }

    // Static PWA files from docs/
    const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const safePath = path.normalize(relPath).replace(/^(\.\.[/\\])+/, '');
    const fullPath = path.join(DOCS_DIR, safePath);

    if (!fullPath.startsWith(DOCS_DIR) || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(fullPath).pipe(res);
  });

  server.listen(PORT, '0.0.0.0', () => {
    const baseUrl = `http://127.0.0.1:${PORT}`;
    const os = require('os');
    const nets = os.networkInterfaces();
    const lanIps = [];
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) lanIps.push(net.address);
      }
    }
    console.log(`🚀 Mock Server 起動完了: ${baseUrl}/?api=${encodeURIComponent(baseUrl + '/api')}&key=${MOCK_AUTH_KEY}`);
    if (lanIps.length > 0) {
      console.log(`📱 スマホ(同一Wi-Fi):   http://${lanIps[0]}:${PORT}/`);
    }
    console.log(`   Geminiモード: ${USE_LIVE_GEMINI ? `LIVE実機接続 (${KEY_SOURCE || 'env'})` : 'OFFLINEモック'}`);
    console.log(`   DB状態確認:   ${baseUrl}/mock-state`);
  });
}

if (!NO_TEST) {
  try {
    runE2ESuite();
  } catch (err) {
    console.error('\n❌ E2E失敗:', err && err.message ? err.message : err);
    if (global.__lastMockRt && global.__lastMockRt.geminiTrace) {
      const chatTraces = global.__lastMockRt.geminiTrace.slice(-3);
      console.error('📡 Recent Gemini Trace:', JSON.stringify(chatTraces, null, 2));
    }
    process.exit(1);
  }
}
if (!TEST_ONLY) {
  startMockServer();
}
