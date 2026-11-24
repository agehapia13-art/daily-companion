import { ensureLogicalDayBoundary } from './db';
import { getGoogleAccessToken } from './google-auth';
import { Env, FastState } from './types';
import { formatJstIso, parsePositiveEstimatedMins } from './utils';

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const BATCH_CHUNK_SIZE = 50;

function normalizeSheetDateStr(val: unknown): string {
  const s = String(val ?? '').trim();
  if (!s) return '';
  // YYYY/MM/DD or YYYY-MM-DD (optionally with time)
  const normalized = s.replace(/\//g, '-');
  const m = normalized.match(/^(\d{4}-\d{1,2}-\d{1,2})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?/);
  if (m) {
    const [y, mo, d] = m[1].split('-');
    const ymd = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    if (m[2]) {
      const [hh, mm, ss = '00'] = m[2].split(':');
      return `${ymd} ${hh.padStart(2, '0')}:${mm.padStart(2, '0')}:${ss.padStart(2, '0')}`;
    }
    return ymd;
  }
  return s;
}

function extractStrictYmd(val: unknown): string {
  const normalized = normalizeSheetDateStr(val);
  return /^\d{4}-\d{2}-\d{2}/.test(normalized) ? normalized.slice(0, 10) : '';
}

function clampMins(val: unknown, fallback: number): number {
  const n = parsePositiveEstimatedMins(val);
  if (n === null) return fallback;
  return Math.min(480, Math.max(5, n));
}

async function runBatchChunked(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (let i = 0; i < statements.length; i += BATCH_CHUNK_SIZE) {
    const chunk = statements.slice(i, i + BATCH_CHUNK_SIZE);
    if (chunk.length > 0) {
      await db.batch(chunk);
    }
  }
}

export async function importAllFromSheets(
  env: Env
): Promise<{ imported: Record<string, number> }> {
  if (!env.SPREADSHEET_ID) {
    throw new Error('SPREADSHEET_ID is not configured');
  }

  const accessToken = await getGoogleAccessToken(env);
  const ranges = [
    'logs!A2:P',
    'tasks!A2:J',
    'routines!A2:H',
    'shopping!A2:D',
    'input_stock!A2:F',
    'memory!A2:B'
  ];
  const query = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
  const url = `${SHEETS_API_BASE}/${env.SPREADSHEET_ID}/values:batchGet?${query}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Sheets batchGet error (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as {
    valueRanges?: Array<{ range?: string; values?: string[][] }>;
  };
  const valueRanges = data.valueRanges || [];

  const logsRows = valueRanges[0]?.values || [];
  const tasksRows = valueRanges[1]?.values || [];
  const routinesRows = valueRanges[2]?.values || [];
  const shoppingRows = valueRanges[3]?.values || [];
  const stockRows = valueRanges[4]?.values || [];
  const memoryRows = valueRanges[5]?.values || [];

  const statements: D1PreparedStatement[] = [];
  const nowIso = formatJstIso();
  const imported: Record<string, number> = {
    logs: 0,
    tasks: 0,
    routines: 0,
    shopping: 0,
    input_stock: 0,
    memory: 0,
    fast_state: 0
  };

  // 1. logs
  for (const row of logsRows) {
    const ts = normalizeSheetDateStr(row[0]);
    const sender = String(row[1] ?? '').trim();
    const message = String(row[2] ?? '');
    const imageUrl = String(row[3] ?? '');
    const aiReply = String(row[4] ?? '');
    if (!ts && !message && !aiReply) continue;

    const hasMeta = row.slice(5).some((v) => v !== undefined && v !== null && String(v).trim() !== '');
    const metaJson = hasMeta
      ? JSON.stringify({
          litePromptTokens: row[5] ?? '',
          liteCandidatesTokens: row[6] ?? '',
          liteCachedTokens: row[7] ?? '',
          flashPromptTokens: row[8] ?? '',
          flashCandidatesTokens: row[9] ?? '',
          flashCachedTokens: row[10] ?? '',
          newTotalTokens: row[11] ?? '',
          phaseAndTags: row[12] ?? '',
          oldAiReply: row[13] ?? '',
          oldTotalTokens: row[14] ?? '',
          tokenReductionDiff: row[15] ?? ''
        })
      : '';

    statements.push(
      env.DB.prepare(
        'INSERT INTO logs (timestamp_str, sender, message, image_url, ai_reply, meta_json) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(ts, sender || 'user', message, imageUrl, aiReply, metaJson)
    );
    imported.logs++;
  }

  // 2. tasks
  tasksRows.forEach((row, idx) => {
    const id = String(row[0] ?? '').trim();
    const title = String(row[1] ?? '').trim();
    if (!id || !title) return;

    const dueDate = extractStrictYmd(row[2]);
    const status = String(row[3] ?? '未完了').trim() || '未完了';
    const createdAt = extractStrictYmd(row[4]);
    const completedAt = extractStrictYmd(row[5]);
    const memo = String(row[6] ?? '');
    const remindContext = String(row[7] ?? '').trim();
    const docUrl = String(row[8] ?? '').trim();
    const defaultMins = /\[お出かけ\]/.test(title) ? 90 : 30;
    const estMins = clampMins(row[9], defaultMins);

    statements.push(
      env.DB.prepare(
        `INSERT INTO tasks (id, title, due_date, status, created_at, completed_at, memo, remind_context, doc_url, estimated_mins, sheet_row)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, title, dueDate, status, createdAt, completedAt, memo, remindContext, docUrl, estMins, idx + 2)
    );
    imported.tasks++;
  });

  // 3. routines
  routinesRows.forEach((row, idx) => {
    const title = String(row[0] ?? '').trim();
    if (!title) return;

    const type = String(row[1] ?? '').trim();
    const value = String(row[2] ?? '').trim();
    const lastGeneratedAt = extractStrictYmd(row[3]);
    const memo = String(row[4] ?? '');
    let status = String(row[5] ?? '').trim();
    if (!status) {
      status = type === 'expired' || memo.includes('[期間満了') ? '期間満了' : '有効';
    }
    let completedAt = extractStrictYmd(row[6]);
    if (!completedAt && memo) {
      const m = memo.match(/\[期間満了[:：]\s*(\d{4}-\d{2}-\d{2})\]/);
      if (m) completedAt = m[1];
    }
    const estMins = clampMins(row[7], 30);

    statements.push(
      env.DB.prepare(
        `INSERT INTO routines (title, type, value, last_generated_at, memo, status, completed_at, estimated_mins, sheet_row)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(title, type, value, lastGeneratedAt, memo, status, completedAt, estMins, idx + 2)
    );
    imported.routines++;
  });

  // 4. shopping
  shoppingRows.forEach((row, idx) => {
    const item = String(row[0] ?? '').trim();
    if (!item) return;

    const category = String(row[1] ?? '日用品').trim() || '日用品';
    const status = String(row[2] ?? '未買').trim() || '未買';
    const createdAt = extractStrictYmd(row[3]);

    statements.push(
      env.DB.prepare(
        'INSERT INTO shopping (item, category, status, created_at, sheet_row) VALUES (?, ?, ?, ?, ?)'
      ).bind(item, category, status, createdAt, idx + 2)
    );
    imported.shopping++;
  });

  // 5. input_stock
  stockRows.forEach((row, idx) => {
    const type = String(row[0] ?? '映画').trim() || '映画';
    const title = String(row[1] ?? '').trim();
    if (!title) return;

    const memo = String(row[2] ?? '');
    const status = String(row[3] ?? '未').trim() || '未';
    const consumedAt = extractStrictYmd(row[4]);
    const defaultMins =
      type === '本' || type === '漫画' ? 20 : type === '映画' || type === 'アニメ' ? 120 : 30;
    const estMins = clampMins(row[5], defaultMins);

    statements.push(
      env.DB.prepare(
        `INSERT INTO input_stock (type, title, memo, status, consumed_at, estimated_mins, sheet_row)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(type, title, memo, status, consumedAt, estMins, idx + 2)
    );
    imported.input_stock++;
  });

  // 6. memory & fast_state
  let rawFastState = '';
  for (const row of memoryRows) {
    const key = String(row[0] ?? '').trim();
    if (!key) continue;

    let val = String(row[1] ?? '').trim();
    if (key === 'pressure_alert' || key === 'monthly_report_ready') {
      val = val.toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE';
    }
    if (key === 'V2_FAST_STATE') {
      rawFastState = val;
    }

    statements.push(
      env.DB.prepare('INSERT INTO memory (key, value, updated_at) VALUES (?, ?, ?)').bind(key, val, nowIso)
    );
    imported.memory++;
  }

  if (rawFastState) {
    try {
      const parsed = JSON.parse(rawFastState) as FastState;
      const { state } = ensureLogicalDayBoundary(parsed);
      statements.push(
        env.DB.prepare(
          'INSERT INTO fast_state (id, day_key, revision, json_data, updated_at) VALUES (1, ?, ?, ?, ?)'
        ).bind(state.dayKey, state.revision || 1, JSON.stringify(state), nowIso)
      );
      imported.fast_state = 1;
    } catch {
      // V2_FAST_STATE が不正な JSON の場合はスキップ
    }
  }

  statements.push(
    env.DB.prepare('INSERT OR REPLACE INTO memory (key, value, updated_at) VALUES (?, ?, ?)').bind(
      'D1_INITIALIZED',
      'TRUE',
      nowIso
    )
  );

  const deleteStmts: D1PreparedStatement[] = [
    env.DB.prepare('DELETE FROM logs'),
    env.DB.prepare('DELETE FROM tasks'),
    env.DB.prepare('DELETE FROM routines'),
    env.DB.prepare('DELETE FROM shopping'),
    env.DB.prepare('DELETE FROM input_stock'),
    env.DB.prepare('DELETE FROM memory'),
    env.DB.prepare('DELETE FROM fast_state')
  ];
  const allStmts = [...deleteStmts, ...statements];
  if (allStmts.length <= 100) {
    await env.DB.batch(allStmts);
  } else {
    await runBatchChunked(env.DB, allStmts);
  }
  return { imported };
}
