import {
  Env,
  FastState,
  HabitSnapshotItem,
  ListsSnapshot,
  LogEntry,
  MemoryMap,
  ShoppingSnapshotItem,
  StockSnapshotItem,
  TaskSnapshotItem
} from './types';
import {
  formatJstCompact,
  formatJstDateTime,
  formatJstIso,
  formatJstYmd,
  getLogicalDayKey,
  JST_OFFSET_MS,
  pad2,
  parsePositiveEstimatedMins
} from './utils';

// ==========================================
// 1. 内部ヘルパー（GAS互換正規化・ソート・デフォルト値）
// ==========================================

function getDefaultTaskEstimatedMins(title: string): number {
  if (/\[お出かけ\]/.test(String(title || ''))) return 90;
  return 30;
}

function getDefaultInputStockEstimatedMins(type: string): number {
  const t = String(type || '').trim();
  if (t === '本' || t === '漫画') return 20;
  if (t === '映画' || t === 'アニメ') return 120;
  if (t === '音楽') return 30;
  return 30;
}

function getDefaultHabitEstimatedMins(label: string): number {
  const s = String(label || '');
  if (/爪切り/.test(s)) return 5;
  if (/室内運動|フィットネス/.test(s)) return 20;
  if (/散歩|外歩き/.test(s)) return 30;
  if (/アニメ|映画/.test(s)) return 45;
  if (/DTM|楽曲/.test(s)) return 45;
  return 20;
}

function clampEstimatedMins(val: unknown): number | null {
  const n = parsePositiveEstimatedMins(val);
  if (n === null) return null;
  return Math.min(480, Math.max(5, n));
}

function extractDatePart(val: unknown): string {
  const s = String(val || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

function splitTaskCategoryAndTitle(title: string): { cat: string; cleanTitle: string } {
  let cat = 'その他';
  let cleanTitle = String(title || '').trim();
  const bm = cleanTitle.match(/^\[([^\]]+)\]\s*(.+)$/);
  if (bm) {
    cat = bm[1].trim();
    cleanTitle = bm[2].trim();
  }
  return { cat, cleanTitle };
}

function formatTaskTitleWithBadge(title: string): string {
  if (!title) return '';
  const trimmed = title.trim();
  if (/^\[[^\]]+\]/.test(trimmed)) {
    return trimmed;
  }
  const colonMatch = trimmed.match(/^([^：:]+)[：:]\s*(.*)$/);
  if (colonMatch) {
    const prefix = colonMatch[1].trim();
    const taskBody = colonMatch[2].trim();
    if (taskBody) {
      return `[${prefix}] ${taskBody}`;
    }
  }
  return trimmed;
}

function applyTaskCategoryPrefix(currentTitle: string, rawCategory: string): string {
  const base = String(currentTitle || '').trim();
  const cleanedRaw = String(rawCategory || '').replace(/[\[\]]/g, '').trim();
  if (!cleanedRaw) return base;

  const nextPrefix = cleanedRaw.replace(/^\d{2}_/, '').trim();
  if (!nextPrefix) return base;

  if (/^\[[^\]]+\]\s*/.test(base)) {
    return base.replace(/^\[[^\]]+\]\s*/, `[${nextPrefix}] `);
  }
  return base ? `[${nextPrefix}] ${base}` : `[${nextPrefix}]`;
}

function normalizeTaskRemindContext(title: string, rawRemindContext: unknown): string {
  let ctx = String(rawRemindContext || '').trim();
  const t = String(title || '');
  const hasDaytimeDeadline = /(?:0?[4-9]|1[0-3]):[0-5]\d\s*(?:まで|締切)|午前中|正午まで/.test(t);
  if (hasDaytimeDeadline) {
    if (!ctx.includes('前日') && !ctx.includes('朝')) {
      ctx = ctx ? `締切前日夜・当日朝 / ${ctx}` : '締切前日夜 または 当日朝';
    }
  }
  return ctx;
}

function sortTasksByUrgency<T extends { dueDate: string; rowIndex?: number }>(tasks: T[], todayStr?: string): T[] {
  if (!tasks || tasks.length <= 1) return tasks || [];
  const today = todayStr || formatJstYmd();

  return tasks.slice().sort((a, b) => {
    const aDue = a.dueDate || '';
    const bDue = b.dueDate || '';

    // 1. 期限超過タスク (due < today)
    const aOverdue = Boolean(aDue && aDue < today);
    const bOverdue = Boolean(bDue && bDue < today);
    if (aOverdue && !bOverdue) return -1;
    if (!aOverdue && bOverdue) return 1;
    if (aOverdue && bOverdue) return aDue.localeCompare(bDue);

    // 2. 本日期限タスク (due === today)
    const aToday = aDue === today;
    const bToday = bDue === today;
    if (aToday && !bToday) return -1;
    if (!aToday && bToday) return 1;

    // 3. 未来期限タスク (due > today)
    const aFuture = Boolean(aDue && aDue > today);
    const bFuture = Boolean(bDue && bDue > today);
    if (aFuture && !bFuture) return -1;
    if (!aFuture && bFuture) return 1;
    if (aFuture && bFuture) return aDue.localeCompare(bDue);

    // 4. 期限なしタスク同士は登録順序維持
    return (a.rowIndex || 0) - (b.rowIndex || 0);
  });
}

// ==========================================
// 2. FastState 管理
// ==========================================

export function createEmptyFastState(dayKey?: string): FastState {
  return {
    dayKey: dayKey || getLogicalDayKey(),
    revision: 1,
    activeSession: null,
    completedToday: {},
    dismissedToday: {},
    isLowMode: false,
    triagedToday: false,
    lastAction: null,
    weatherFetchedAt: '',
    dailyBriefing: null,
    aiDeck: {
      generatedAt: '',
      cards: [],
      lowCards: []
    },
    listCache: {
      updatedAt: '',
      tasks: [],
      shopping: [],
      stock: [],
      habits: []
    }
  };
}

export function ensureLogicalDayBoundary(
  state: FastState | null,
  now: Date = new Date()
): { state: FastState; rolledOver: boolean } {
  const currentDayKey = getLogicalDayKey(now);
  if (!state || typeof state !== 'object') {
    return { state: createEmptyFastState(currentDayKey), rolledOver: true };
  }

  const normalized: FastState = Object.assign(createEmptyFastState(currentDayKey), state);
  if (normalized.dayKey === currentDayKey) {
    return { state: normalized, rolledOver: false };
  }

  // 03:00 境界を跨いだ場合: 日次フラグのみリセットし、就寝セッションは維持する
  const preservedSleep =
    normalized.activeSession && normalized.activeSession.isSleepCard
      ? normalized.activeSession
      : null;

  normalized.dayKey = currentDayKey;
  normalized.activeSession = preservedSleep;
  normalized.completedToday = {};
  normalized.dismissedToday = {};
  normalized.isLowMode = false;
  normalized.triagedToday = false;
  return { state: normalized, rolledOver: true };
}

export async function loadFastState(env: Env, now: Date = new Date()): Promise<FastState> {
  let parsed: FastState | null = null;
  let hasRow = false;

  const row = await env.DB.prepare('SELECT json_data FROM fast_state WHERE id = 1').first<{ json_data: string }>();
  if (row && row.json_data) {
    hasRow = true;
    try {
      parsed = JSON.parse(row.json_data) as FastState;
    } catch {
      parsed = null;
    }
  }

  if (!parsed) {
    const memRow = await env.DB.prepare("SELECT value FROM memory WHERE key = 'V2_FAST_STATE'").first<{ value: string }>();
    if (memRow && memRow.value) {
      try {
        parsed = JSON.parse(memRow.value) as FastState;
      } catch {
        parsed = null;
      }
    }
  }

  const check = ensureLogicalDayBoundary(parsed, now);
  if (check.rolledOver || !hasRow) {
    await saveFastState(env, check.state);
  }
  return check.state;
}

export async function saveFastState(env: Env, state: FastState): Promise<void> {
  if (!state) return;
  state.revision = (Number(state.revision) || 0) + 1;
  const jsonData = JSON.stringify(state);
  const updatedAt = formatJstIso();

  await env.DB.prepare(
    `INSERT INTO fast_state (id, day_key, revision, json_data, updated_at)
     VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       day_key = excluded.day_key,
       revision = excluded.revision,
       json_data = excluded.json_data,
       updated_at = excluded.updated_at`
  )
    .bind(state.dayKey, state.revision, jsonData, updatedAt)
    .run();
}

// ==========================================
// 3. Memory 管理
// ==========================================

const DEFAULT_MEMORY_KEYS: MemoryMap = {
  profile: '',
  backend_model: '',
  weather_info: '',
  pressure_alert: 'FALSE',
  cycle_stamps: '',
  weekly_summary: '',
  briefing_delivered_date: '',
  monthly_report_ready: 'FALSE',
  custom_system_prompt: '',
  rolling_memory: '',
  dictionary: '',
  ideal_self: '',
  lifestyle_habits: '',
  skill_options: '',
  prompt_core: '',
  prompt_schedule: '',
  prompt_db: '',
  prompt_deck: '',
  V2_FAST_STATE: ''
};

export async function getMemory(env: Env): Promise<MemoryMap> {
  const memoryObj: MemoryMap = { ...DEFAULT_MEMORY_KEYS };
  const { results } = await env.DB.prepare('SELECT key, value FROM memory').all<{ key: string; value: string }>();

  for (const row of results) {
    const key = String(row.key || '').trim();
    if (!key) continue;
    const val = String(row.value ?? '').trim();
    if (key === 'pressure_alert' || key === 'monthly_report_ready') {
      memoryObj[key] = val.toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE';
    } else {
      memoryObj[key] = val;
    }
  }
  return memoryObj;
}

export async function setMemoryValue(env: Env, key: string, value: string): Promise<void> {
  const updatedAt = formatJstIso();
  await env.DB.prepare(
    `INSERT INTO memory (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`
  )
    .bind(String(key).trim(), String(value ?? ''), updatedAt)
    .run();
}

// ==========================================
// 4. CRUD & スナップショット
// ==========================================

interface TaskRow {
  id: string;
  title: string;
  due_date: string;
  status: string;
  created_at: string;
  completed_at: string;
  memo: string;
  remind_context: string;
  doc_url: string;
  estimated_mins: number | null;
  sheet_row: number | null;
}

function mapTaskRow(row: TaskRow, idx: number): TaskSnapshotItem {
  const title = String(row.title || '');
  const { cat, cleanTitle } = splitTaskCategoryAndTitle(title);
  const parsedMins = clampEstimatedMins(row.estimated_mins);
  return {
    id: String(row.id),
    title,
    cleanTitle,
    cat,
    dueDate: extractDatePart(row.due_date),
    status: String(row.status || '未完了'),
    done: row.status === '完了',
    memo: String(row.memo || ''),
    remindContext: String(row.remind_context || '').trim(),
    docUrl: String(row.doc_url || '').trim(),
    estimatedMins: parsedMins || getDefaultTaskEstimatedMins(title),
    rowIndex: row.sheet_row && row.sheet_row > 0 ? row.sheet_row : idx + 2
  };
}

export async function getTasks(env: Env, filterStatus?: string): Promise<TaskSnapshotItem[]> {
  const stmt = filterStatus
    ? env.DB.prepare(
        'SELECT id, title, due_date, status, created_at, completed_at, memo, remind_context, doc_url, estimated_mins, sheet_row FROM tasks WHERE status = ? ORDER BY rowid ASC'
      ).bind(filterStatus)
    : env.DB.prepare(
        'SELECT id, title, due_date, status, created_at, completed_at, memo, remind_context, doc_url, estimated_mins, sheet_row FROM tasks ORDER BY rowid ASC'
      );

  const { results } = await stmt.all<TaskRow>();
  const mapped = results.map((row, idx) => mapTaskRow(row, idx));
  if (filterStatus === '未完了') {
    return sortTasksByUrgency(mapped);
  }
  return mapped;
}

interface ShoppingRow {
  id: number;
  item: string;
  category: string;
  status: string;
  created_at: string;
  sheet_row: number | null;
}

export async function getShoppingList(env: Env, filterStatus?: string): Promise<ShoppingSnapshotItem[]> {
  const stmt = filterStatus
    ? env.DB.prepare(
        'SELECT id, item, category, status, created_at, sheet_row FROM shopping WHERE status = ? ORDER BY id ASC'
      ).bind(filterStatus)
    : env.DB.prepare('SELECT id, item, category, status, created_at, sheet_row FROM shopping ORDER BY id ASC');

  const { results } = await stmt.all<ShoppingRow>();
  return results.map((row) => ({
    id: 'SHOP_' + row.id,
    rowIndex: Number(row.id),
    item: String(row.item || ''),
    category: String(row.category || '日用品'),
    status: String(row.status || '未買'),
    done: row.status === '購入済',
    createdAt: extractDatePart(row.created_at)
  }));
}

interface InputStockRow {
  id: number;
  type: string;
  title: string;
  memo: string;
  status: string;
  consumed_at: string;
  estimated_mins: number | null;
  sheet_row: number | null;
}

export async function getInputStockList(env: Env, filterStatus?: string): Promise<StockSnapshotItem[]> {
  const stmt = filterStatus
    ? env.DB.prepare(
        'SELECT id, type, title, memo, status, consumed_at, estimated_mins, sheet_row FROM input_stock WHERE status = ? ORDER BY id ASC'
      ).bind(filterStatus)
    : env.DB.prepare(
        'SELECT id, type, title, memo, status, consumed_at, estimated_mins, sheet_row FROM input_stock ORDER BY id ASC'
      );

  const { results } = await stmt.all<InputStockRow>();
  return results.map((row) => {
    const type = String(row.type || 'その他');
    const parsedMins = clampEstimatedMins(row.estimated_mins);
    return {
      id: 'INPUT_' + row.id,
      rowIndex: Number(row.id),
      type,
      title: String(row.title || ''),
      memo: String(row.memo || ''),
      status: String(row.status || '未'),
      done: row.status === '完',
      consumedAt: String(row.consumed_at || ''),
      estimatedMins: parsedMins || getDefaultInputStockEstimatedMins(type)
    };
  });
}

interface RoutineRow {
  id: number;
  title: string;
  type: string;
  value: string;
  last_generated_at: string;
  memo: string;
  status: string;
  completed_at: string;
  estimated_mins: number | null;
  sheet_row: number | null;
}

export async function getRoutines(env: Env, filterStatus?: string): Promise<any[]> {
  const stmt = filterStatus
    ? env.DB.prepare(
        'SELECT id, title, type, value, last_generated_at, memo, status, completed_at, estimated_mins, sheet_row FROM routines WHERE status = ? ORDER BY id ASC'
      ).bind(filterStatus)
    : env.DB.prepare(
        'SELECT id, title, type, value, last_generated_at, memo, status, completed_at, estimated_mins, sheet_row FROM routines ORDER BY id ASC'
      );

  const { results } = await stmt.all<RoutineRow>();
  return results.map((row) => ({
    id: row.id,
    rowIndex: row.sheet_row && row.sheet_row > 0 ? row.sheet_row : row.id,
    ruleName: String(row.title || ''),
    title: String(row.title || ''),
    type: String(row.type || ''),
    value: String(row.value || ''),
    lastGeneratedDate: extractDatePart(row.last_generated_at),
    memo: String(row.memo || ''),
    status: String(row.status || '有効'),
    completedDate: extractDatePart(row.completed_at),
    estimatedMins: clampEstimatedMins(row.estimated_mins)
  }));
}

interface LogRow {
  id: number;
  timestamp_str: string;
  sender: string;
  message: string;
  image_url: string;
  ai_reply: string;
  meta_json: string;
}

export async function getLogicalTodayLogs(env: Env, now: Date = new Date()): Promise<LogEntry[]> {
  const dayKey = getLogicalDayKey(now);
  const [y, m, d] = dayKey.split('-').map((n) => parseInt(n, 10));
  const nextDayUtc = new Date(Date.UTC(y, m - 1, d + 1));
  const nextDayKey = `${nextDayUtc.getUTCFullYear()}-${pad2(nextDayUtc.getUTCMonth() + 1)}-${pad2(nextDayUtc.getUTCDate())}`;

  const startStr = `${dayKey} 03:00:00`;
  const endStr = `${nextDayKey} 02:59:59`;

  const { results } = await env.DB.prepare(
    `SELECT id, timestamp_str, sender, message, image_url, ai_reply, meta_json
     FROM logs
     WHERE timestamp_str >= ? AND timestamp_str <= ?
     ORDER BY timestamp_str ASC, id ASC`
  )
    .bind(startStr, endStr)
    .all<LogRow>();

  return results.map((r) => ({
    id: r.id,
    timestampStr: String(r.timestamp_str || ''),
    sender: String(r.sender || ''),
    message: String(r.message || ''),
    imageUrl: String(r.image_url || ''),
    aiReply: String(r.ai_reply || ''),
    metaJson: String(r.meta_json || '')
  }));
}

export async function appendLog(env: Env, entry: LogEntry): Promise<void> {
  const ts = entry.timestampStr || formatJstDateTime();
  await env.DB.prepare(
    `INSERT INTO logs (timestamp_str, sender, message, image_url, ai_reply, meta_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      ts,
      entry.sender || 'user',
      entry.message || '',
      entry.imageUrl || '',
      entry.aiReply || '',
      entry.metaJson || ''
    )
    .run();
}

export async function buildListsSnapshot(
  env: Env,
  memory?: MemoryMap,
  now: Date = new Date()
): Promise<ListsSnapshot> {
  const todayStr = formatJstYmd(now);
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const todayMidnightMs = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate());
  const mem = memory || (await getMemory(env));

  // 1. Tasks（未完了 ＋ 本日完了分、緊急度順ソート）
  const { results: rawTaskRows } = await env.DB.prepare(
    `SELECT id, title, due_date, status, created_at, completed_at, memo, remind_context, doc_url, estimated_mins, sheet_row
     FROM tasks
     WHERE status = '未完了' OR (status = '完了' AND completed_at LIKE ?)
     ORDER BY rowid ASC`
  )
    .bind(`${todayStr}%`)
    .all<TaskRow>();

  const tasks = sortTasksByUrgency(
    rawTaskRows.map((row, idx) => mapTaskRow(row, idx)),
    todayStr
  );

  // 2. Shopping（未買のみ）
  const shopping = await getShoppingList(env, '未買');

  // 3. Input Stock（未消化 ＋ 本日消化分）
  const allStock = await getInputStockList(env);
  const stock = allStock.filter(
    (item) => item.status === '未' || (item.status === '完' && extractDatePart(item.consumedAt) === todayStr)
  );

  // 4. Habits（cycle_stamps ベース）
  const habits: HabitSnapshotItem[] = [];
  const rawStamps = (mem && mem.cycle_stamps ? String(mem.cycle_stamps) : '').trim();
  if (rawStamps) {
    const lines = rawStamps
      .split(/[,\n、]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const line of lines) {
      const m = line.match(/^([^:：]+)[：:]\s*(.+)$/);
      const label = m ? m[1].replace(/^[・\-\s]+/, '').trim() : line;
      const val = m ? m[2].trim() : '';
      let dateStr = '';
      let elapsedDays: number | null = null;
      const dm = val.match(/(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/);
      if (dm) {
        dateStr = dm[1].replace(/\//g, '-');
        const p = dateStr.split('-').map((n) => parseInt(n, 10));
        if (p.length === 3 && !p.some(isNaN)) {
          const dtMs = Date.UTC(p[0], p[1] - 1, p[2]);
          elapsedDays = Math.max(0, Math.floor((todayMidnightMs - dtMs) / (1000 * 60 * 60 * 24)));
        }
      }
      const elapsedText =
        elapsedDays === null ? '未着手' : elapsedDays === 0 ? '今日' : `${elapsedDays}日前`;

      habits.push({
        id: 'HABIT_' + label,
        label,
        date: dateStr,
        elapsedDays,
        elapsed: elapsedText,
        stampedToday: elapsedDays === 0,
        estimatedMins: getDefaultHabitEstimatedMins(label)
      });
    }

    habits.sort((a, b) => {
      const ae = a.elapsedDays === null ? 9999 : a.elapsedDays;
      const be = b.elapsedDays === null ? 9999 : b.elapsedDays;
      return be - ae;
    });
  }

  return {
    updatedAt: formatJstIso(now),
    tasks,
    shopping,
    stock,
    habits
  };
}

// ==========================================
// 5. AI アクション適用（Tasks / Shopping / InputStock / Routines / Habits）
// ==========================================

export async function applyTaskActions(
  env: Env,
  actions: any[]
): Promise<{ notices: string[]; completedIds: string[] }> {
  const notices: string[] = [];
  const completedIds: string[] = [];
  if (!actions || !Array.isArray(actions) || actions.length === 0) {
    return { notices, completedIds };
  }

  const todayStr = formatJstYmd();

  for (const act of actions) {
    if (!act || !act.action) continue;

    if (act.action === 'add' && act.title) {
      let addTitle = String(act.title).trim();
      if (act.category && !/^\[[^\]]+\]/.test(addTitle)) {
        addTitle = applyTaskCategoryPrefix(addTitle, String(act.category));
      }
      const taskId = `T_${formatJstCompact()}_${Math.floor(Math.random() * 1000)}`;
      const dueDate = act.due_date ? String(act.due_date).trim() : '';
      const memo = act.memo ? String(act.memo).trim() : '';
      const remindContext = normalizeTaskRemindContext(addTitle, act.remind_context);
      const docUrl = act.doc_url ? String(act.doc_url).trim() : '';
      const estMins = clampEstimatedMins(act.estimated_mins) || getDefaultTaskEstimatedMins(addTitle);

      await env.DB.prepare(
        `INSERT INTO tasks (id, title, due_date, status, created_at, completed_at, memo, remind_context, doc_url, estimated_mins, sheet_row)
         VALUES (?, ?, ?, '未完了', ?, '', ?, ?, ?, ?, 0)`
      )
        .bind(taskId, addTitle, dueDate, todayStr, memo, remindContext, docUrl, estMins)
        .run();

      const formattedTitle = formatTaskTitleWithBadge(addTitle);
      notices.push(
        `📝 タスク追加: ${formattedTitle}${dueDate ? ` (期限: ${dueDate})` : ''}${estMins ? ` (${estMins}分)` : ''}${docUrl ? ' 🔗 資料連携' : ''}`
      );
    } else if (act.action === 'update') {
      const tasks = await getTasks(env, '未完了');
      const searchTitle = String(act.target_title || (!act.new_title ? act.title : '') || '');
      for (const t of tasks) {
        const matchById = Boolean(act.task_id && t.id === act.task_id);
        const matchByTitle = Boolean(searchTitle && (t.title.includes(searchTitle) || searchTitle.includes(t.title)));
        if (!matchById && !matchByTitle) continue;

        let updatedTitle = String(t.title || '').trim();
        let resolvedNewTitle = '';
        if (act.new_title !== undefined && String(act.new_title).trim() !== '') {
          resolvedNewTitle = String(act.new_title).trim();
        } else if (matchById && act.title !== undefined && String(act.title).trim() !== '') {
          const candTitle = String(act.title).trim();
          const hasOtherFieldUpdate =
            act.due_date !== undefined ||
            act.memo !== undefined ||
            act.remind_context !== undefined ||
            act.doc_url !== undefined ||
            act.project_name !== undefined ||
            act.category !== undefined ||
            act.estimated_mins !== undefined;
          const curBody = updatedTitle.replace(/^\[[^\]]+\]\s*/, '');
          const candBody = candTitle.replace(/^\[[^\]]+\]\s*/, '');
          const isCategoryPrefixOnlyChange =
            /^\[[^\]]+\]\s*/.test(candTitle) && curBody === candBody && candTitle !== updatedTitle;
          const isCopiedDisplayString =
            /\|\s*(?:estimated_mins|remind_context|memo):|\[目安:|\[📄資料連携済\]|\(見込み\d+分\)|\[⚠️/.test(
              candTitle
            );
          if (!isCopiedDisplayString && !updatedTitle.includes(candTitle) && (!hasOtherFieldUpdate || isCategoryPrefixOnlyChange)) {
            resolvedNewTitle = candTitle;
          }
        }

        if (resolvedNewTitle) {
          updatedTitle = resolvedNewTitle;
        }
        if (act.category !== undefined && String(act.category).trim() !== '') {
          updatedTitle = applyTaskCategoryPrefix(updatedTitle, String(act.category));
        }

        let hasChanges = updatedTitle !== String(t.title || '').trim();
        let updatedDue = String(t.dueDate || '').trim();
        if (act.due_date !== undefined) {
          const nextDue = String(act.due_date || '').trim();
          if (nextDue !== updatedDue) {
            updatedDue = nextDue;
            hasChanges = true;
          }
        }

        let updatedMemo = String(t.memo || '').trim();
        if (act.memo !== undefined) {
          const nextMemo = String(act.memo || '').trim();
          if (nextMemo !== updatedMemo) {
            updatedMemo = nextMemo;
            hasChanges = true;
          }
        }

        let updatedRemind = String(t.remindContext || '').trim();
        if (act.remind_context !== undefined) {
          const nextRemind = normalizeTaskRemindContext(updatedTitle, act.remind_context);
          if (nextRemind !== updatedRemind) {
            updatedRemind = nextRemind;
            hasChanges = true;
          }
        }

        let updatedDocUrl = String(t.docUrl || '').trim();
        let urlLinked = false;
        if (act.doc_url !== undefined) {
          const nextDocUrl = String(act.doc_url || '').trim();
          if (nextDocUrl !== updatedDocUrl) {
            updatedDocUrl = nextDocUrl;
            hasChanges = true;
          }
          urlLinked = Boolean(nextDocUrl);
        }

        let updatedMins = t.estimatedMins;
        let minsChangedNote = '';
        if (act.estimated_mins !== undefined) {
          const parsedNextMins = clampEstimatedMins(act.estimated_mins);
          if (parsedNextMins && parsedNextMins !== t.estimatedMins) {
            updatedMins = parsedNextMins;
            minsChangedNote = ` (${parsedNextMins}分)`;
            hasChanges = true;
          }
        }

        if (hasChanges) {
          await env.DB.prepare(
            `UPDATE tasks
             SET title = ?, due_date = ?, memo = ?, remind_context = ?, doc_url = ?, estimated_mins = ?
             WHERE id = ?`
          )
            .bind(updatedTitle, updatedDue, updatedMemo, updatedRemind, updatedDocUrl, updatedMins, t.id)
            .run();

          const formattedTitle = formatTaskTitleWithBadge(updatedTitle);
          notices.push(
            `📝 タスク更新: ${formattedTitle}${updatedDue ? ` (期限: ${updatedDue})` : ''}${minsChangedNote}${urlLinked ? ' 🔗 資料連携' : ''}`
          );
        }
        break;
      }
    } else if (act.action === 'complete') {
      const tasks = await getTasks(env, '未完了');
      for (const t of tasks) {
        const matchById = Boolean(act.task_id && t.id === act.task_id);
        const matchByTitle = Boolean(act.title && (t.title.includes(act.title) || String(act.title).includes(t.title)));
        if (matchById || matchByTitle) {
          const completedAtStr = formatJstDateTime();
          await env.DB.prepare("UPDATE tasks SET status = '完了', completed_at = ? WHERE id = ?")
            .bind(completedAtStr, t.id)
            .run();
          completedIds.push(t.id);
          notices.push(`✅ タスク完了: ${formatTaskTitleWithBadge(t.title)}`);
          break;
        }
      }
    } else if (act.action === 'delete') {
      const tasks = await getTasks(env);
      for (const t of tasks) {
        const matchById = Boolean(act.task_id && t.id === act.task_id);
        const matchByTitle = Boolean(act.title && (t.title.includes(act.title) || String(act.title).includes(t.title)));
        if (matchById || matchByTitle) {
          await env.DB.prepare("UPDATE tasks SET status = '破棄' WHERE id = ?").bind(t.id).run();
          notices.push(`🗑️ タスク破棄: ${formatTaskTitleWithBadge(t.title)}`);
          break;
        }
      }
    }
  }

  return { notices, completedIds };
}

export async function applyShoppingActions(env: Env, actions: any[]): Promise<string[]> {
  const notices: string[] = [];
  if (!actions || !Array.isArray(actions) || actions.length === 0) return notices;

  const todayStr = formatJstYmd();

  for (const act of actions) {
    if (!act || !act.action) continue;

    if (act.action === 'add' && act.item) {
      await env.DB.prepare(
        "INSERT INTO shopping (item, category, status, created_at, sheet_row) VALUES (?, ?, '未買', ?, 0)"
      )
        .bind(String(act.item).trim(), String(act.category || '日用品').trim(), todayStr)
        .run();
      notices.push(`🛒 買物リスト追加: ${act.item}`);
    } else if (act.action === 'complete' && act.item) {
      const items = await getShoppingList(env, '未買');
      for (const it of items) {
        if (it.item.includes(String(act.item))) {
          await env.DB.prepare("UPDATE shopping SET status = '購入済' WHERE id = ?").bind(it.rowIndex).run();
          notices.push(`🛒 買物完了: ${it.item}`);
          break;
        }
      }
    } else if (act.action === 'delete' && act.item) {
      const items = await getShoppingList(env, '未買');
      for (const it of items) {
        if (it.item.includes(String(act.item))) {
          await env.DB.prepare("UPDATE shopping SET status = '破棄' WHERE id = ?").bind(it.rowIndex).run();
          notices.push(`🛒 買物削除: ${it.item}`);
          break;
        }
      }
    }
  }

  return notices;
}

export async function applyInputStockActions(
  env: Env,
  actions: any[]
): Promise<{ notices: string[]; completedIds: string[] }> {
  const notices: string[] = [];
  const completedIds: string[] = [];
  if (!actions || !Array.isArray(actions) || actions.length === 0) {
    return { notices, completedIds };
  }

  for (const act of actions) {
    if (!act || !act.action) continue;

    if (act.action === 'add' && act.title) {
      const type = String(act.type || '映画').trim();
      const estMins = clampEstimatedMins(act.estimated_mins) || getDefaultInputStockEstimatedMins(type);
      await env.DB.prepare(
        "INSERT INTO input_stock (type, title, memo, status, consumed_at, estimated_mins, sheet_row) VALUES (?, ?, ?, '未', '', ?, 0)"
      )
        .bind(type, String(act.title).trim(), String(act.memo || '').trim(), estMins)
        .run();
      notices.push(`🎬 インプット追加: ${act.title}${estMins ? ` (${estMins}分)` : ''}`);
    } else if (act.action === 'update' && (act.title || act.target_title)) {
      const target = String(act.target_title || act.title || '').trim();
      const list = await getInputStockList(env, '未');
      for (const item of list) {
        if (item.title === target || item.title.includes(target) || target.includes(item.title)) {
          let nextMins = item.estimatedMins;
          let nextMemo = item.memo;
          let changed = false;

          if (act.estimated_mins !== undefined) {
            const parsed = clampEstimatedMins(act.estimated_mins);
            if (parsed) {
              nextMins = parsed;
              changed = true;
            }
          }
          if (act.memo !== undefined) {
            nextMemo = String(act.memo || '').trim();
            changed = true;
          }
          if (changed) {
            await env.DB.prepare('UPDATE input_stock SET memo = ?, estimated_mins = ? WHERE id = ?')
              .bind(nextMemo, nextMins, item.rowIndex)
              .run();
            notices.push(
              `🎬 インプット更新: ${item.title}${act.estimated_mins ? ` (${clampEstimatedMins(act.estimated_mins)}分)` : ''}`
            );
          }
          break;
        }
      }
    } else if (act.action === 'complete' && act.title) {
      const list = await getInputStockList(env, '未');
      for (const item of list) {
        if (item.title.includes(String(act.title))) {
          const consumedAtStr = formatJstDateTime();
          await env.DB.prepare("UPDATE input_stock SET status = '完', consumed_at = ? WHERE id = ?")
            .bind(consumedAtStr, item.rowIndex)
            .run();
          completedIds.push(item.id);
          notices.push(`🎬 インプット完了: ${item.title}`);
          break;
        }
      }
    } else if (act.action === 'delete' && act.title) {
      const list = await getInputStockList(env, '未');
      for (const item of list) {
        if (item.title.includes(String(act.title))) {
          await env.DB.prepare("UPDATE input_stock SET status = '破棄' WHERE id = ?").bind(item.rowIndex).run();
          notices.push(`🎬 インプット削除: ${item.title}`);
          break;
        }
      }
    }
  }

  return { notices, completedIds };
}

export async function applyRoutineActions(env: Env, actions: any[]): Promise<string[]> {
  const notices: string[] = [];
  if (!actions || !Array.isArray(actions) || actions.length === 0) return notices;

  const todayStr = formatJstYmd();
  const stripPrefix = (s: string) => String(s || '').replace(/^\[[^\]]+\]\s*/, '').trim();

  for (const act of actions) {
    if (!act) continue;
    if (act.action === 'add' && act.title) {
      const type = String(act.type || 'day_of_week');
      const value = String(act.value || 'MON');
      await env.DB.prepare(
        "INSERT INTO routines (title, type, value, last_generated_at, memo, status, completed_at, estimated_mins, sheet_row) VALUES (?, ?, ?, '', ?, '有効', '', 30, 0)"
      )
        .bind(String(act.title).trim(), type, value, String(act.memo || '').trim())
        .run();
      notices.push(`🔄 ルーティン追加: ${act.title} (${value})`);
    } else if (act.action === 'complete') {
      const targetName = String(act.title || act.ruleName || '').trim();
      if (!targetName) continue;
      const targetBody = stripPrefix(targetName);
      const activeRoutines = await getRoutines(env, '有効');
      let matched = activeRoutines.find((r) => r.ruleName === targetName || stripPrefix(r.ruleName) === targetBody);
      if (!matched && targetBody) {
        matched = activeRoutines.find(
          (r) => r.ruleName.includes(targetBody) || targetBody.includes(stripPrefix(r.ruleName))
        );
      }
      if (matched) {
        await env.DB.prepare("UPDATE routines SET status = '完了', completed_at = ? WHERE id = ?")
          .bind(todayStr, matched.id)
          .run();
        notices.push(`🔄 ルーティン完了: ${matched.ruleName}`);
      }
    }
  }

  return notices;
}

export async function updateCycleStampsSafely(env: Env, updates: string[]): Promise<string[]> {
  const updatesText = Array.isArray(updates) ? updates.join('\n') : String(updates || '');
  if (!updatesText.trim()) return [];

  const currentMemory = await getMemory(env);
  const existingRaw = (currentMemory.cycle_stamps || '').trim();

  const parseEntries = (text: string) => {
    const map: Record<string, string> = {};
    const order: string[] = [];
    const lines = text
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const line of lines) {
      const m = line.match(/^([^:：]+)[：:]\s*(.+)$/);
      if (m) {
        const key = m[1].replace(/^[・\-\s]+/, '').trim();
        const val = m[2].trim();
        if (key) {
          if (!Object.prototype.hasOwnProperty.call(map, key)) {
            order.push(key);
          }
          map[key] = val;
        }
      }
    }
    return { map, order };
  };

  const existing = parseEntries(existingRaw);
  const incoming = parseEntries(updatesText);

  const updatedEntries: string[] = [];
  for (const k of incoming.order) {
    if (!Object.prototype.hasOwnProperty.call(existing.map, k)) {
      existing.order.push(k);
      updatedEntries.push(`${k}: ${incoming.map[k]}`);
    } else if (existing.map[k] !== incoming.map[k]) {
      updatedEntries.push(`${k}: ${incoming.map[k]}`);
    }
    existing.map[k] = incoming.map[k];
  }

  if (updatedEntries.length === 0) {
    return [];
  }

  const mergedLines = existing.order.map((k) => `${k}: ${existing.map[k]}`);
  await setMemoryValue(env, 'cycle_stamps', mergedLines.join('\n'));
  return updatedEntries;
}

export async function toggleShoppingItemById(
  env: Env,
  itemIdOrRow: number,
  done: boolean
): Promise<void> {
  const nextStatus = done ? '購入済' : '未買';
  const res = await env.DB.prepare('UPDATE shopping SET status = ? WHERE id = ?')
    .bind(nextStatus, itemIdOrRow)
    .run();

  if ((res.meta?.changes ?? 0) === 0) {
    await env.DB.prepare('UPDATE shopping SET status = ? WHERE sheet_row = ?')
      .bind(nextStatus, itemIdOrRow)
      .run();
  }
}

export async function isOpProcessed(env: Env, opId: string): Promise<boolean> {
  if (!opId) return false;
  const row = await env.DB.prepare('SELECT 1 AS found FROM processed_ops WHERE op_id = ?')
    .bind(opId)
    .first<{ found: number }>();
  return Boolean(row && row.found === 1);
}

export async function markOpProcessed(env: Env, opId: string): Promise<void> {
  if (!opId) return;
  await env.DB.prepare('INSERT OR IGNORE INTO processed_ops (op_id, created_at) VALUES (?, ?)')
    .bind(opId, Date.now())
    .run();
}
