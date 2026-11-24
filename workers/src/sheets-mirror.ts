import { getGoogleAccessToken } from './google-auth';
import { Env, LogEntry } from './types';
import { formatJstDateTime, formatJstIso } from './utils';

export type MirrorEvent =
  | { type: 'append_log'; entry: LogEntry }
  | { type: 'sync_snapshot' }
  | { type: 'set_memory'; key: string; value: string };

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

const TASK_HEADERS = [
  'タスクID',
  'タスク名',
  '期限',
  'ステータス(未完了/完了/破棄)',
  '登録日',
  '完了日',
  'メモ',
  'リマインド目安',
  '関連URL',
  '見込み所要時間(分)'
];
const SHOPPING_HEADERS = ['品名', 'カテゴリ', 'ステータス(未買/購入済)', '登録日'];
const INPUT_STOCK_HEADERS = ['種別', 'タイトル', 'メモ', 'ステータス(未/完)', '消化日', '見込み所要時間(分)'];

async function sheetsFetch(
  accessToken: string,
  url: string,
  init: RequestInit = {}
): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Sheets API error (${res.status}): ${errText}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

function formatLogRowForSheet(entry: LogEntry): (string | number)[] {
  const ts = entry.timestampStr || formatJstDateTime();
  const sender = entry.sender || 'user';
  const message = entry.message || '';
  const imageUrl = entry.imageUrl || '';
  const aiReply = entry.aiReply || '';

  let meta: Record<string, any> | null = null;
  if (entry.metaJson) {
    try {
      meta = JSON.parse(entry.metaJson);
    } catch {
      meta = null;
    }
  }

  if (meta && (meta.isTwoModel || meta.newTotalTokens !== undefined)) {
    return [
      ts,
      sender,
      message,
      imageUrl,
      aiReply,
      meta.litePromptTokens ?? '',
      meta.liteCandidatesTokens ?? '',
      meta.liteCachedTokens ?? '',
      meta.flashPromptTokens ?? '',
      meta.flashCandidatesTokens ?? '',
      meta.flashCachedTokens ?? '',
      meta.newTotalTokens ?? '',
      meta.phaseAndTags || meta.phaseTag || '',
      meta.oldAiReply || '',
      meta.oldTotalTokens ?? '',
      meta.tokenReductionDiff ?? ''
    ];
  }

  if (meta && (meta.promptTokenCount !== undefined || meta.totalTokenCount !== undefined)) {
    return [
      ts,
      sender,
      message,
      imageUrl,
      aiReply,
      '',
      '',
      '',
      meta.promptTokenCount ?? 0,
      meta.candidatesTokenCount ?? 0,
      meta.cachedContentTokenCount ?? 0,
      '',
      '[OLD単独モード]',
      '',
      meta.totalTokenCount ?? 0,
      ''
    ];
  }

  return [ts, sender, message, imageUrl, aiReply, '', '', '', '', '', '', '', '', '', '', ''];
}

async function appendLogToSheet(
  accessToken: string,
  spreadsheetId: string,
  entry: LogEntry
): Promise<void> {
  const range = encodeURIComponent('logs!A:P');
  const url = `${SHEETS_API_BASE}/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  await sheetsFetch(accessToken, url, {
    method: 'POST',
    body: JSON.stringify({
      values: [formatLogRowForSheet(entry)]
    })
  });
}

async function upsertMemoryKeysToSheet(
  accessToken: string,
  spreadsheetId: string,
  pairs: Array<{ key: string; value: string }>
): Promise<void> {
  if (pairs.length === 0) return;

  const getUrl = `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent('memory!A:B')}`;
  const data = await sheetsFetch(accessToken, getUrl, { method: 'GET' });
  const rows: string[][] = Array.isArray(data.values) ? data.values : [];

  const keyRowMap = new Map<string, number>();
  for (let i = 1; i < rows.length; i++) {
    const k = String(rows[i]?.[0] || '').trim();
    if (k && !keyRowMap.has(k)) {
      keyRowMap.set(k, i + 1); // 1-indexed sheet row
    }
  }

  const updateData: Array<{ range: string; values: string[][] }> = [];
  const appendRows: string[][] = [];

  for (const { key, value } of pairs) {
    const existingRow = keyRowMap.get(key);
    if (existingRow) {
      updateData.push({
        range: `memory!B${existingRow}`,
        values: [[String(value ?? '')]]
      });
    } else {
      appendRows.push([key, String(value ?? '')]);
      keyRowMap.set(key, rows.length + appendRows.length);
    }
  }

  if (updateData.length > 0) {
    const batchUpdateUrl = `${SHEETS_API_BASE}/${spreadsheetId}/values:batchUpdate`;
    await sheetsFetch(accessToken, batchUpdateUrl, {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: updateData
      })
    });
  }

  if (appendRows.length > 0) {
    const appendUrl = `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent('memory!A:B')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    await sheetsFetch(accessToken, appendUrl, {
      method: 'POST',
      body: JSON.stringify({ values: appendRows })
    });
  }
}

async function syncSnapshotToSheets(
  env: Env,
  accessToken: string,
  spreadsheetId: string,
  pendingMemoryPairs: Array<{ key: string; value: string }>
): Promise<void> {
  const [tasksRes, shoppingRes, stockRes, fastStateRow] = await Promise.all([
    env.DB.prepare(
      'SELECT id, title, due_date, status, created_at, completed_at, memo, remind_context, doc_url, estimated_mins FROM tasks ORDER BY rowid ASC'
    ).all<any>(),
    env.DB.prepare(
      'SELECT item, category, status, created_at FROM shopping ORDER BY id ASC'
    ).all<any>(),
    env.DB.prepare(
      'SELECT type, title, memo, status, consumed_at, estimated_mins FROM input_stock ORDER BY id ASC'
    ).all<any>(),
    env.DB.prepare('SELECT json_data FROM fast_state WHERE id = 1').first<{ json_data: string }>()
  ]);

  const taskValues: (string | number)[][] = [
    TASK_HEADERS,
    ...tasksRes.results.map((r) => [
      r.id || '',
      r.title || '',
      r.due_date || '',
      r.status || '未完了',
      r.created_at || '',
      r.completed_at || '',
      r.memo || '',
      r.remind_context || '',
      r.doc_url || '',
      r.estimated_mins ?? 30
    ])
  ];

  const shoppingValues: (string | number)[][] = [
    SHOPPING_HEADERS,
    ...shoppingRes.results.map((r) => [
      r.item || '',
      r.category || '日用品',
      r.status || '未買',
      r.created_at || ''
    ])
  ];

  const stockValues: (string | number)[][] = [
    INPUT_STOCK_HEADERS,
    ...stockRes.results.map((r) => [
      r.type || '映画',
      r.title || '',
      r.memo || '',
      r.status || '未',
      r.consumed_at || '',
      r.estimated_mins ?? 30
    ])
  ];

  // 既存行ズレ防止のため、対象範囲をクリアしてから一括書き込み
  const clearUrl = `${SHEETS_API_BASE}/${spreadsheetId}/values:batchClear`;
  await sheetsFetch(accessToken, clearUrl, {
    method: 'POST',
    body: JSON.stringify({
      ranges: ['tasks!A:J', 'shopping!A:D', 'input_stock!A:F']
    })
  });

  const batchUpdateUrl = `${SHEETS_API_BASE}/${spreadsheetId}/values:batchUpdate`;
  await sheetsFetch(accessToken, batchUpdateUrl, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: 'tasks!A1', values: taskValues },
        { range: 'shopping!A1', values: shoppingValues },
        { range: 'input_stock!A1', values: stockValues }
      ]
    })
  });

  if (fastStateRow && fastStateRow.json_data) {
    pendingMemoryPairs.push({ key: 'V2_FAST_STATE', value: fastStateRow.json_data });
  }
}

async function enqueueMirrorFailure(
  env: Env,
  event: MirrorEvent,
  errorMsg: string
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO mirror_queue (action_type, payload_json, retry_count, last_error, created_at)
       VALUES (?, ?, 0, ?, ?)`
    )
      .bind(event.type, JSON.stringify(event), errorMsg.slice(0, 1000), formatJstIso())
      .run();
  } catch (qErr) {
    console.error('[sheets-mirror] Failed to enqueue mirror failure:', qErr);
  }
}

export async function mirrorToSheets(env: Env, events: MirrorEvent[]): Promise<void> {
  if (!events || events.length === 0 || !env.SPREADSHEET_ID) return;

  try {
    const accessToken = await getGoogleAccessToken(env);
    const spreadsheetId = env.SPREADSHEET_ID;

    const memoryPairs: Array<{ key: string; value: string }> = [];
    let hasSyncSnapshot = false;

    for (const ev of events) {
      if (ev.type === 'append_log') {
        await appendLogToSheet(accessToken, spreadsheetId, ev.entry);
      } else if (ev.type === 'sync_snapshot') {
        hasSyncSnapshot = true;
      } else if (ev.type === 'set_memory') {
        memoryPairs.push({ key: ev.key, value: ev.value });
      }
    }

    if (hasSyncSnapshot) {
      await syncSnapshotToSheets(env, accessToken, spreadsheetId, memoryPairs);
    }

    memoryPairs.push({ key: 'D1_LAST_MIRRORED_AT', value: formatJstDateTime() });
    await upsertMemoryKeysToSheet(accessToken, spreadsheetId, memoryPairs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[sheets-mirror] mirrorToSheets error:', msg);
    for (const ev of events) {
      await enqueueMirrorFailure(env, ev, msg);
    }
  }
}
