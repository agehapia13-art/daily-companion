/**
 * scripts/verify-prompts-live.js
 * v2 プロンプト4モジュール＆1段構成Chat / DeckEngine 実機検証ドライランツール
 *
 * 使い方:
 *   - ペイロード構造のみ事前確認（APIコールなし）:
 *       node scripts/verify-prompts-live.js --dry-run
 *   - 実機 Gemini 3.5 Flash-Lite で全8シナリオ検証（シート/カレンダー書換なし）:
 *       set -a; source .env; set +a; node scripts/verify-prompts-live.js
 *   - または明示指定:
 *       GEMINI_API_KEY="AIza..." node scripts/verify-prompts-live.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const IS_DRY_RUN = process.argv.includes('--dry-run');
const API_KEY = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : '';
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

if (!IS_DRY_RUN && !API_KEY) {
  console.error('❌ GEMINI_API_KEY が環境変数に設定されていません。');
  console.error('   実機テスト: set -a; source .env; set +a; node scripts/verify-prompts-live.js');
  console.error('   オフライン構造確認のみ: node scripts/verify-prompts-live.js --dry-run');
  process.exit(1);
}

// 検証用コピーシート基準のリアルフィクスチャ（個人情報・実書込なし）
const TEST_MEMORY_BASE = {
  profile: 'サウンドディレクター / ゲーム・映像音響制作。女性。自宅(横浜市磯子区・最寄り上大岡駅徒歩15分強、両親・妹の早希と同居)と職場(渋谷、約1.5時間)。月・木・金リモート、火・水出社（10:00〜19:00、昼12:00〜13:00）。',
  weather_info: '自宅(磯子): 晴れ 最高17℃ 降水10% ｜ 職場(渋谷): 晴れ 最高18℃ 降水10%',
  pressure_alert: 'FALSE',
  backend_model: '3.5-lite',
  thinking_level: 'low',
  monthly_report_ready: 'FALSE',
  custom_system_prompt: '【口調・話し方】\n丁寧な敬体（です・ます調）で、落ち着いた頼れる伴走者として自然に応答する。\n情緒的な慰めや定型の労い・前置きは最小限にとどめ、さっぱりとした等身大の距離感で、要点へ端的に入る。',
  ideal_self: '健やかな心身と社会性のある繋がりを保ちつつ、夜は罪悪感なくしっかり休み、すっきり目覚めた朝の余白でタスクや好きな時間を楽しむ生活。専門性・創作・大切な人との繋がりを自然に前進させていく。',
  lifestyle_habits: [
    '[入浴]: お湯張りと入浴は完全に別タスク。お湯張り前に軽く浴槽ブラシをかけるのがいつもの流れ。お湯張り中に手元で別作業をしたり、同居家族のために先に沸かすことも多い。入浴開始〜洗髪・ドライヤー・スキンケア・着替え完了まで一式で1時間ほどかかる。土日は17:00〜18:00でお風呂に入り、夕食前に済ませるのが固定リズム。',
    '[食事]: 土日の昼食は12:30〜13:30、夕食は18:00〜19:00でほぼ固定。',
    '[身支度]: 起きてから朝食〜身支度完了までに1時間半ほどかかる（最低1時間）。',
    '[音作業]: 長時間の音作業・ディレクション後は、無音で耳を休める時間が必要。',
    '[睡眠]: 07:00起床・23:00就寝が理想の健康軸。',
    '[家事]: 洗濯は深夜・就寝前に設定（基本は母親が担当）。',
    '[余白・趣味]: 水彩やiPadイラスト、ゲーム（モンスト、ぽこポケ、刀剣乱舞、Splatoon）、小説執筆。音楽を聴いた日は周期スタンプ対象。',
    '[運動・身体ケア]: ① 隙間5〜10分: YouTubeストレッチ / 自重トレ、② 室内30分: Switchフィットボクシング/リングフィット、③ 屋外30〜60分: 散歩（外歩き・散歩スタンプ対象）。'
  ].join('\n'),
  skill_options: [
    '[30分〜1時間]: 【音楽・音響】30分スケッチ(DAWモチーフ作り) / 【ビジネス・思考】記事1章要約',
    '[休日2時間〜]: 【音楽・音響】アレンジ制作 / 楽曲分析'
  ].join('\n'),
  cycle_stamps: [
    '爪切り: 2026-11-15',
    '外歩き・散歩: 2026-11-18',
    '読書（本・漫画）: 2026-11-14',
    'ピアノ演奏: 2026-11-19',
    '楽曲制作・DTM: 2026-11-12',
    '室内運動・フィットネス: 2026-11-17'
  ].join('\n'),
  project_folders: [
    '[02_制作・創作] 2611_BFプラグイン購入検討 | folder:1MwBCrApQNhHNbNlLlcaVJzaL67hacBDQ | doc:1XUq6hv030_P_XyP2btiyo1m1yyMdNwP69fHJ5Pq7aiQ',
    '[03_家事・環境] 2611_洋間収納プロジェクト | folder:1aDcrhtdZ5zbIltRLqFwgoyEO5MuJ4Sta',
    '[03_家事・環境] 2611_Google Drive整理 | folder:1O76_33kWjyNf3r1GzXAaUVeY8G-2jTj_ | doc:1HAQ5iAV3K5jeB41ghXY9CzB9j8JkOkQYy44XSwFfats'
  ].join('\n'),
  dictionary: '・ぽこあポケモン（ぽこポケ）: Nintendo Switch 2用ゲーム。\n・残響フラクタル: オリジナル創作小説作品。',
  rolling_memory: '- 2026-11-18: 出社日。帰宅時に地元イルミネーションを楽しんだ。\n- 2026-11-19: 在宅勤務。夜にピアノ演奏して就寝。'
};

const TEST_TASKS = [
  { id: 'T_20261102_093316_410', title: '[制作・創作] ブラックフライデーのプラグイン購入検討', dueDate: '2026-11-27', status: '未完了', memo: 'セール対象プラグイン検討', remindContext: '休日PC・夜自由時間', docUrl: 'https://docs.google.com/document/d/1XUq6hv030_P_XyP2btiyo1m1yyMdNwP69fHJ5Pq7aiQ/edit', estimatedMins: 30 },
  { id: 'T_20261026_191721_102', title: '[家事・環境] Googleドライブのファイル整理', dueDate: '', status: '未完了', memo: '時間かかるからそのうち', remindContext: 'PC作業・隙間30分', docUrl: 'https://docs.google.com/document/d/1HAQ5iAV3K5jeB41ghXY9CzB9j8JkOkQYy44XSwFfats/edit', estimatedMins: 30 },
  { id: 'T_20261103_230042_188', title: '[家事・環境] Chrome・iCloud・Notionのパスワードを1Passwordへ順次移行', dueDate: '', status: '未完了', memo: '優先度高め', remindContext: '直近の空き枠・最優先', estimatedMins: 20 },
  { id: 'T_20261024_143202_622', title: '[お出かけ] 旧前田家本邸 洋館見学', dueDate: '2026-11-22', status: '未完了', memo: '目黒区駒場公園内', remindContext: '休日お出かけ・晴れ', estimatedMins: 120 },
  { id: 'T_20261114_224707_511', title: '[家事・環境] 毛布の購入', dueDate: '2026-11-19', status: '未完了', memo: '毛布を購入する', remindContext: '直近の空き枠', estimatedMins: 45 }
];

const TEST_SHOPPING = [{ item: 'バター餅（ローソン）', category: '食品', status: '未買' }];
const TEST_INPUT_STOCK = [
  { rowIndex: 3, type: '本', title: '漱石と倫敦ミイラ殺人事件', memo: '推理小説', estimatedMins: 45, status: '未' },
  { rowIndex: 8, type: 'その他', title: '薬屋のひとりごと 第3シーズン', memo: 'アニメ', estimatedMins: 25, status: '未' }
];
const TEST_ROUTINES = [
  { ruleName: '[趣味・文化] モンスト：超究極・兵のミザリー周回', type: 'interval_days', value: '1', status: '有効' }
];

function createRuntimeContext() {
  const apiLog = [];
  const ctx = {
    console, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, parseInt, parseFloat, isNaN,
    Logger: { log: () => {} },
    Utilities: {
      sleep: () => {},
      formatDate(date, tz, pattern) {
        const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
        const y = jst.getUTCFullYear();
        const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
        const d = String(jst.getUTCDate()).padStart(2, '0');
        const h = String(jst.getUTCHours()).padStart(2, '0');
        const min = String(jst.getUTCMinutes()).padStart(2, '0');
        const s = String(jst.getUTCSeconds()).padStart(2, '0');
        const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][jst.getUTCDay()];
        if (pattern === 'yyyy-MM-dd') return `${y}-${m}-${d}`;
        if (pattern === 'HH:mm') return `${h}:${min}`;
        if (pattern === 'yyyy-MM-dd HH:mm:ss') return `${y}-${m}-${d} ${h}:${min}:${s}`;
        if (pattern === 'yyyy-MM-dd(E) HH:mm') return `${y}-${m}-${d}(${dow}) ${h}:${min}`;
        if (pattern === "yyyy-MM-dd'T'HH:mm:ss+09:00") return `${y}-${m}-${d}T${h}:${min}:${s}+09:00`;
        return jst.toISOString();
      }
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperties: () => ({
          GEMINI_API_KEY: API_KEY || 'DRY_RUN_KEY',
          SPREADSHEET_ID: 'test',
          DRIVE_FOLDER_ID: 'drv',
          NOTION_API_KEY: 'not',
          NOTION_DAILY_DB_ID: 'nd',
          NOTION_MONTHLY_DB_ID: 'nm'
        })
      })
    },
    CalendarApp: {
      getDefaultCalendar: () => ({
        getEvents: (s, e) => []
      }),
      getCalendarById: () => null
    },
    UrlFetchApp: { fetch: () => { throw new Error('Sync UrlFetchApp stub replaced dynamically'); } }
  };

  vm.createContext(ctx);
  for (const f of ['Config.js', 'Prompts.js', 'Spreadsheet.js', 'MemoryStore.js', 'Weather.js', 'Calendar.js', 'FastState.js', 'DeckEngine.js', 'GeminiClient.js', 'CompanionChat.js']) {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  }

  ctx.getMemory = () => Object.assign({}, TEST_MEMORY_BASE);
  ctx.getTasks = () => TEST_TASKS.slice();
  ctx.getShoppingList = () => TEST_SHOPPING.slice();
  ctx.getInputStockList = () => TEST_INPUT_STOCK.slice();
  ctx.getRoutines = () => TEST_ROUTINES.slice();
  ctx.getCondensedTodayLogs = () => '';
  ctx.getTodayEventsList = () => [];
  ctx.getUpcomingHolidaysSummary_ = () => '2026-11-23(Mon) 勤労感謝の日';

  // Dry-run payload spy or Live HTTPS wrapper
  ctx.__capturedCalls = apiLog;
  return ctx;
}

async function callGeminiHttp(endpointUrl, payloadObj) {
  const url = `${endpointUrl}?key=${encodeURIComponent(API_KEY)}`;
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payloadObj)
  });
  const txt = await res.text();
  const ms = Date.now() - t0;
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 400)}`);
  }
  return { rawText: txt, latencyMs: ms };
}

async function runChatScenarioLive(ctx, name, userText, nowIso, todayLogs, checkFn) {
  const now = new Date(nowIso);
  const memory = Object.assign({}, TEST_MEMORY_BASE, { _testSkipWeatherFetch: true });

  if (IS_DRY_RUN) {
    const calls = [];
    ctx.fetchGeminiResultWithRetry = (payload, endpoint) => {
      calls.push({ payload, endpoint });
      return {
        text: JSON.stringify({ reaction_emoji: '👍', reply_mode: 'reply', reply_text: 'DRY_RUN_OK' }),
        usage: { promptTokenCount: 100, candidatesTokenCount: 10, totalTokenCount: 110 }
      };
    };
    const out = ctx.executeCompanionTurn(userText, [], todayLogs, memory, now);
    const sysLen = calls[0].payload.systemInstruction.parts[0].text.length;
    const usrLen = calls[0].payload.contents[0].parts[0].text.length;
    console.log(`✅ [DRY-RUN Chat] ${name}: endpoint=${calls[0].endpoint.split('/').pop()} sys=${sysLen}ch usr=${usrLen}ch schema=${Boolean(calls[0].payload.generationConfig.responseSchema)}`);
    return out;
  }

  // Live Gemini execution mirroring CompanionChat Pass 1 + optional Pass 2
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const precomputed = {
    now,
    nowStr: ctx.Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd(E) HH:mm'),
    todayDate,
    elapsedStr: todayLogs ? '15分' : '初回',
    boundaryInfo: ctx.getNextBoundaryInfo(now),
    todayEvents: [],
    upcomingHolidays: '2026-11-23(Mon) 勤労感謝の日',
    defaultCalendarContext: '=== Googleカレンダー予定 ===\n・[メインカレンダー] 11/20(金) 在宅リモート / 11/22(日) 終日予定なし / 11/23(月・祝) 勤労感謝の日',
    stampsFormatted: ctx.formatCycleStampsWithElapsed_(memory.cycle_stamps, todayDate),
    projSummary: memory.project_folders,
    allUncompletedTasks: TEST_TASKS,
    unboughtShopping: TEST_SHOPPING,
    pendingInput: TEST_INPUT_STOCK,
    routines: TEST_ROUTINES,
    weatherDisplay: memory.weather_info,
    pressureAlertVal: memory.pressure_alert,
    relevantDict: ctx.filterRelevantDictionaryEntries(memory.dictionary, userText + '\n' + todayLogs)
  };
  const backend = ctx.resolveBackendModel_(memory);
  const p1Payload = ctx.buildChatPayload_(userText, [], todayLogs, memory, precomputed, { isSecondPass: false });
  const r1 = await callGeminiHttp(backend.endpoint, p1Payload);
  const c1 = ctx.extractGeminiCandidateResult_(r1.rawText);
  let parsed = ctx.sanitizeChatActionResult_(ctx.parseGeminiActionJson_(c1.text, c1.usage));
  let totalLatency = r1.latencyMs;
  let totalTokens = (c1.usage && c1.usage.totalTokenCount) || 0;
  let cachedTokens = (c1.usage && c1.usage.cachedContentTokenCount) || 0;
  let usedPass2 = false;
  let wsSummary = '';

  if (parsed.need_web_search_query || (parsed.need_calendar_range && (parsed.need_calendar_range.start || parsed.need_calendar_range.end))) {
    usedPass2 = true;
    let wsCtx = null;
    if (parsed.need_web_search_query) {
      const wsPayload = ctx.buildGeminiWebSearchPayload_(parsed.need_web_search_query, precomputed, userText);
      const rWs = await callGeminiHttp(backend.endpoint, wsPayload);
      const cWs = ctx.extractGeminiCandidateResult_(rWs.rawText);
      totalLatency += rWs.latencyMs;
      totalTokens += (cWs.usage && cWs.usage.totalTokenCount) || 0;
      wsSummary = cWs.text;
      wsCtx = { summaryText: cWs.text, queries: cWs.groundingQueries || [], chunksCount: cWs.groundingChunksCount || 0, sources: cWs.groundingSources || [], failed: false };
    }
    const extCal = parsed.need_calendar_range
      ? `=== 追加取得カレンダー (${parsed.need_calendar_range.start} 〜 ${parsed.need_calendar_range.end}) ===\n・12/01(火) 10:00〜19:00 出社\n・12/02(水) 10:00〜19:00 出社\n・12/03(木) 終日予定なし(在宅)\n・12/04(金) 19:30〜 友人食事`
      : '';
    const p2Payload = ctx.buildChatPayload_(userText, [], todayLogs, memory, precomputed, {
      isSecondPass: true,
      webSearchContext: wsCtx,
      extendedCalendarContext: extCal
    });
    const r2 = await callGeminiHttp(backend.endpoint, p2Payload);
    const c2 = ctx.extractGeminiCandidateResult_(r2.rawText);
    totalLatency += r2.latencyMs;
    totalTokens += (c2.usage && c2.usage.totalTokenCount) || 0;
    cachedTokens += (c2.usage && c2.usage.cachedContentTokenCount) || 0;
    parsed = ctx.sanitizeChatActionResult_(ctx.parseGeminiActionJson_(c2.text, c2.usage));
  }

  console.log(`\n━━ 💬 [Chat Live] ${name} ━━`);
  console.log(`User: "${userText}"`);
  console.log(`⏱ ${(totalLatency / 1000).toFixed(2)}s | 📊 tokens=${totalTokens} (cached=${cachedTokens}) | pass=${usedPass2 ? '2-pass' : '1-pass'}${wsSummary ? ' +web' : ''}`);
  console.log(`AI [${parsed.reaction_emoji}] (${parsed.reply_mode}): ${parsed.reply_text || '(スタンプのみ)'}`);
  if (parsed.state_changes) console.log('   state_changes:', JSON.stringify(parsed.state_changes));
  if (parsed.task_actions) console.log('   task_actions:', JSON.stringify(parsed.task_actions));
  if (parsed.project_actions) console.log('   project_actions:', JSON.stringify(parsed.project_actions));
  if (parsed.shopping_actions) console.log('   shopping_actions:', JSON.stringify(parsed.shopping_actions));
  try {
    checkFn(parsed, { usedPass2, wsSummary });
    console.log('   ✅ PASS');
    return true;
  } catch (err) {
    console.log('   ❌ CHECK_FAIL:', err.message);
    return false;
  }
}

async function runDeckScenarioLive(ctx, name, nowIso, workMode, checkFn) {
  const now = new Date(nowIso);
  const memory = Object.assign({}, TEST_MEMORY_BASE);
  const fastState = { completedToday: {}, dismissedToday: {}, aiDeck: { cards: [], lowCards: [] } };
  const wb = {
    workMode,
    todayEvents: workMode === 'remote' ? ['10:00〜19:00 リモートワーク'] : [],
    boundaryInfo: workMode === 'remote'
      ? { summaryText: '現在は「リモートワーク」進行中 (終了まで約5時間)' }
      : { summaryText: '固定予定なし（自由時間）' }
  };

  if (IS_DRY_RUN) {
    const calls = [];
    ctx.fetchGeminiResultWithRetry = (payload, endpoint) => {
      calls.push({ payload, endpoint });
      return { text: JSON.stringify({ cards: [{ id: 'd1', title: 'お茶', sub: '休む', mins: 10, icon: 'coffee', linkedType: 'none', linkedId: '', isTriage: false }], low_cards: [{ id: 'l1', title: '白湯', sub: 'ゆっくり', mins: 3, icon: 'coffee' }] }) };
    };
    const out = ctx.generateAiDeck({ reason: 'evening_batch', now, memory, fastState, workMode: wb.workMode, todayEvents: wb.todayEvents, boundaryInfo: wb.boundaryInfo, useFlashModel: false });
    assert.strictEqual(out.cards.length, 1);
    console.log(`✅ [DRY-RUN Deck] ${name}: endpoint=${calls[0].endpoint.split('/').pop()} sys=${calls[0].payload.systemInstruction.parts[0].text.length}ch`);
    return true;
  }

  let capturedPayload = null;
  let capturedEndpoint = '';
  ctx.fetchGeminiResultWithRetry = (payload, endpoint) => {
    capturedPayload = payload;
    capturedEndpoint = endpoint;
    throw new Error('__CAPTURE_ONLY__');
  };
  ctx.generateAiDeck({ reason: 'live_verify', now, memory, fastState, workMode: wb.workMode, todayEvents: wb.todayEvents, boundaryInfo: wb.boundaryInfo, useFlashModel: false });

  const r = await callGeminiHttp(capturedEndpoint, capturedPayload);
  const c = ctx.extractGeminiCandidateResult_(r.rawText);
  const parsed = JSON.parse(c.text);
  const tokens = (c.usage && c.usage.totalTokenCount) || 0;
  console.log(`\n━━ 🃏 [Deck Live] ${name} (${workMode}) ━━`);
  console.log(`⏱ ${(r.latencyMs / 1000).toFixed(2)}s | 📊 tokens=${tokens} | cards=${(parsed.cards || []).length} low=${(parsed.low_cards || []).length}`);
  console.log('Cards:', (parsed.cards || []).map(x => `${x.title}(${x.mins}m${x.isTriage ? ',引き算' : ''})`).join(' / '));
  console.log('LowCards:', (parsed.low_cards || []).map(x => `${x.title}(${x.mins}m)`).join(' / '));
  try {
    checkFn(parsed);
    console.log('   ✅ PASS');
    return true;
  } catch (err) {
    console.log('   ❌ CHECK_FAIL:', err.message);
    return false;
  }
}

async function main() {
  const ctx = createRuntimeContext();
  const results = [];

  results.push(await runChatScenarioLive(ctx, '1. 日常の食事報告（スタンプ主体）', 'お昼ご飯食べたよ', '2026-11-20T12:40:00+09:00', '', (res) => {
    assert.ok(res.reaction_emoji);
    assert.strictEqual(res.reply_mode, 'reaction', 'Meal murmur should prefer reaction mode');
    assert.strictEqual(res.reply_text, '', 'Reaction mode should omit reply_text');
  }));

  results.push(await runChatScenarioLive(ctx, '2. 疲労申告（低負荷モード移行）', 'ちょっとだるいかも…', '2026-11-20T20:15:00+09:00', '19:05 User: お仕事終わった\nAI: [スタンプ: 👍]', (res) => {
    assert.strictEqual(res.reply_mode, 'reply');
    assert.ok(res.reply_text && res.reply_text.length > 0, 'Expected non-empty reply_text');
    assert.strictEqual(res.state_changes && res.state_changes.mark_low_mode, true);
  }));

  results.push(await runChatScenarioLive(ctx, '3. タスク見積変更（部分update＆過剰複唱なし）', 'Googleドライブのファイル整理の見込み時間45分に変えて', '2026-11-20T20:20:00+09:00', '', (res) => {
    assert.strictEqual(res.reply_mode, 'reply');
    const upd = (res.task_actions || []).find(a => a.action === 'update');
    assert.ok(upd, 'Expected task update action');
    assert.strictEqual(upd.task_id, 'T_20261026_191721_102');
    assert.strictEqual(upd.estimated_mins, 45);
    assert.ok(!('memo' in upd), 'Must not overwrite memo on partial time update');
  }));

  results.push(await runChatScenarioLive(ctx, '4. 連携Doc追記（memo分離ルール確認）', 'ブラックフライデーのプラグイン検討にFabFilter Pro-Q 4も候補でメモ足しといて', '2026-11-20T20:25:00+09:00', '', (res) => {
    assert.strictEqual(res.reply_mode, 'reply');
    const app = (res.project_actions || []).find(a => a.action === 'append_doc');
    assert.ok(app, 'Expected project_actions.append_doc instead of task memo overwrite');
    assert.ok(app.content && app.content.includes('FabFilter'), 'Expected append_doc to include content');
  }));

  results.push(await runChatScenarioLive(ctx, '5. 段取り相談（lifestyle_habits 入浴実時間控除）', 'これから帰宅して19時過ぎから寝るまでの過ごし方組んで', '2026-11-20T18:50:00+09:00', '', (res) => {
    assert.strictEqual(res.reply_mode, 'reply');
    assert.ok(/\d{1,2}:\d{2}/.test(res.reply_text), 'Expected HH:mm schedule breakdown');
  }));

  results.push(await runChatScenarioLive(ctx, '6. オンデマンド2段目（Web検索＋来月カレンダー確認）', '旧前田家本邸の休館日いつだっけ？あと12月最初の週で出社じゃない日いつ？', '2026-11-20T20:30:00+09:00', '', (res, meta) => {
    assert.strictEqual(res.reply_mode, 'reply');
    assert.ok(meta.usedPass2, 'Expected Pass 2 execution for web search / next-month calendar');
  }));

  results.push(await runDeckScenarioLive(ctx, '7. 平日勤務中デッキ（本業重複回避）', '2026-11-20T14:00:00+09:00', 'remote', (deck) => {
    assert.ok(Array.isArray(deck.cards) && deck.cards.length >= 4);
    assert.ok(Array.isArray(deck.low_cards) && deck.low_cards.length >= 3);
    const titles = deck.cards.map(c => c.title).join(' ');
    assert.ok(!titles.includes('本業（午後）') && !titles.includes('就寝'), 'Must not duplicate system anchor cards');
  }));

  results.push(await runDeckScenarioLive(ctx, '8. 休日夕方デッキ（lifestyle_habits適応・洗濯非提案）', '2026-11-21T16:15:00+09:00', 'holiday', (deck) => {
    assert.ok(Array.isArray(deck.cards) && deck.cards.length >= 4);
    assert.ok(!deck.cards.some(c => /洗濯/.test(c.title)), 'Must respect lifestyle_habits that laundry is not user task');
  }));

  const passedCount = results.filter(Boolean).length;
  console.log(`\n🎉 検証完了 (${IS_DRY_RUN ? 'DRY-RUN' : 'LIVE gemini-3.5-flash-lite'}): ${passedCount}/${results.length} PASS`);
  if (!IS_DRY_RUN && passedCount < results.length) {
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('❌ 検証エラー:', err);
  process.exit(1);
});
