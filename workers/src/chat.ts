import { applyCalendarActions, getEventsInDateRange, getWorkModeAndBoundary } from './calendar';
import {
  appendLog,
  applyInputStockActions,
  applyRoutineActions,
  applyShoppingActions,
  applyTaskActions,
  buildListsSnapshot,
  getInputStockList,
  getLogicalTodayLogs,
  getMemory,
  getRoutines,
  getShoppingList,
  getTasks,
  loadFastState,
  saveFastState,
  setMemoryValue,
  updateCycleStampsSafely
} from './db';
import { composeHomeDeck, formatUncompletedTasksForContext } from './deck-engine';
import { uploadBase64ImageToDrive } from './media';
import {
  CHAT_RESPONSE_SCHEMA,
  getDefaultPromptCore,
  getDefaultPromptDb,
  getDefaultPromptSchedule
} from './prompts';
import { MirrorEvent, mirrorToSheets } from './sheets-mirror';
import { Env, LogEntry, MemoryMap } from './types';
import {
  corsHeaders,
  formatJstDateTime,
  formatJstYmd,
  getJstClock,
  jsonResponse,
  parseCycleStampItems,
  toJstDate
} from './utils';
import { fetchWeatherAndPressure, isWeatherStale } from './weather';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_CHAT_MODEL = 'gemini-3.5-flash-lite';
const WEB_SEARCH_MODEL = 'gemini-3.5-flash-lite';
const ALLOWED_THINKING_LEVELS = new Set(['minimal', 'low', 'medium', 'high']);

interface WebSearchContext {
  summaryText: string;
  queries: string[];
  chunksCount: number;
  sources: Array<{ title: string; uri: string }>;
  usage: Record<string, any> | null;
  failed: boolean;
}

interface TokenStats {
  prompt: number;
  cand: number;
  cached: number;
  thinking: number;
  toolUse: number;
  total: number;
}

function verifyDashboardAccess(env: Env, authKey: unknown): boolean {
  const expected = String(env.DASHBOARD_ACCESS_KEY || '').trim();
  const actual = String(authKey ?? '').trim();
  return Boolean(expected && actual && expected === actual);
}

function parseBase64Image(
  base64Data: string,
  fallbackMimeType?: string
): { mimeType: string; data: string } | null {
  const raw = String(base64Data || '').trim();
  if (!raw) return null;
  let mimeType = String(fallbackMimeType || '').trim().toLowerCase() || 'image/jpeg';
  let data = raw;
  const m = raw.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (m) {
    mimeType = m[1].trim().toLowerCase() || mimeType;
    data = m[2].trim();
  }
  data = data.replace(/\s+/g, '');
  if (!data) return null;
  if (mimeType === 'image/jpg') mimeType = 'image/jpeg';
  return { mimeType, data };
}

function formatJstNowWithDay(now: Date): string {
  const d = toJstDate(now);
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  const dow = days[d.getUTCDay()] || '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}(${dow}) ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function getDefaultCalendarEndYmd(now: Date): string {
  const { dow, hours } = getJstClock(now);
  const addDays = dow === 0 && hours >= 18 ? 7 : ((8 - dow) % 7) || 7;
  return formatJstYmd(new Date(now.getTime() + addDays * 24 * 60 * 60 * 1000));
}

function buildCondensedLogsFromArray(logsList: LogEntry[]): string {
  if (!logsList || logsList.length === 0) return '';
  const lines: string[] = [];
  const valid = logsList.filter((l) => l && l.message && String(l.message).trim() !== '');
  for (let i = 0; i < valid.length; i++) {
    const l = valid[i];
    const ts = String(l.timestampStr || '');
    const hhmm = ts.length >= 16 ? ts.substring(11, 16) : '';
    lines.push((hhmm ? `${hhmm} ` : '') + 'User: ' + String(l.message).trim());
    if (l.aiReply && String(l.aiReply).trim()) {
      const cleaned = String(l.aiReply)
        .split('\n')
        .filter((line) => {
          const t = line.trim();
          return (
            t &&
            !/^\[スタンプ:/.test(t) &&
            !/^(📝|✅|🗑️|📅|🛒|🎬|🔄|📌)/.test(t)
          );
        })
        .join(' ')
        .trim();
      if (cleaned) {
        const isRecent = i >= valid.length - 4;
        lines.push(
          'AI: ' + (isRecent || cleaned.length <= 80 ? cleaned : cleaned.substring(0, 80) + '...')
        );
      }
    }
  }
  return lines.join('\n');
}

function extractLastLogTime(todayLogsText: string): string | null {
  if (!todayLogsText) return null;
  const lines = todayLogsText.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i].match(/^(\d{1,2}:\d{2})/);
    if (match) return match[1];
  }
  return null;
}

function formatElapsedTime(lastTimeStr: string | null, nowDate: Date): string {
  if (!lastTimeStr) return 'なし（本日初回の発言）';
  const parts = lastTimeStr.split(':');
  const lastMinutes = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  const { hours, mins } = getJstClock(nowDate);
  const nowMinutes = hours * 60 + mins;

  let diff = nowMinutes - lastMinutes;
  if (diff < 0) diff += 24 * 60;

  if (diff < 1) return '1分未満（直前のやり取り直後）';
  if (diff < 60) return `${diff}分経過`;
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return `${h}時間${m > 0 ? `${m}分` : ''}経過（計${diff}分）`;
}

function formatCycleStampsWithElapsed(rawStamps: string, todayYmd: string): string {
  const items = parseCycleStampItems(rawStamps, todayYmd);
  if (items.length === 0) return '';
  return items
    .map((item) => {
      const dateText = item.date || '未着手';
      return `${item.label}: ${dateText} (${item.elapsed || '未着手'})`;
    })
    .join('\n');
}

function safeParseGeminiJson(rawText: string): any {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) {
    throw new Error('Gemini からの応答テキストが空のため JSON を解析できませんでした。');
  }
  try {
    return JSON.parse(trimmed);
  } catch (firstErr) {
    const cleaned = trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        const extracted = cleaned.slice(firstBrace, lastBrace + 1);
        try {
          return JSON.parse(extracted);
        } catch (extractErr) {
          const detail = extractErr instanceof Error ? extractErr.message : String(extractErr);
          throw new Error(`Gemini 応答 JSON の解析に失敗しました: ${detail}`);
        }
      }
      const detail = firstErr instanceof Error ? firstErr.message : String(firstErr);
      throw new Error(`Gemini 応答 JSON の解析に失敗しました: ${detail}`);
    }
  }
}

function filterRelevantDictionaryEntries(dictionaryText: string, queryText: string): string {
  if (!dictionaryText || !queryText) return '';
  const lines = dictionaryText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const matched: string[] = [];
  const queryLower = queryText.toLowerCase();

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const rawTerm = line
      .substring(0, colonIndex)
      .replace(/^[・\-\s]+/, '')
      .trim()
      .toLowerCase();
    const keywords = rawTerm.split(/[（\(\)）\/\,\s]+/).filter((k) => k.length >= 2);
    const isHit =
      keywords.some((k) => queryLower.includes(k)) ||
      (rawTerm.length >= 2 && queryLower.includes(rawTerm));
    if (isHit) {
      matched.push(line);
    }
  }
  return matched.join('\n');
}

function sanitizeChatActionResult(parsed: any): any {
  if (!parsed || typeof parsed !== 'object') return parsed;

  const stripEmptyProps = (obj: Record<string, any>, keys: string[]) => {
    if (!obj || typeof obj !== 'object') return obj;
    for (const k of keys) {
      if (obj[k] === null || obj[k] === undefined || obj[k] === '') {
        delete obj[k];
      }
    }
    return obj;
  };

  if (Array.isArray(parsed.task_actions)) {
    parsed.task_actions = parsed.task_actions
      .filter((a: any) => a && a.action)
      .map((a: any) => {
        const copy = { ...a };
        stripEmptyProps(copy, [
          'task_id',
          'title',
          'new_title',
          'target_title',
          'category',
          'due_date',
          'memo',
          'remind_context',
          'project_name',
          'doc_url'
        ]);
        if (
          copy.estimated_mins === null ||
          copy.estimated_mins === undefined ||
          Number(copy.estimated_mins) <= 0
        ) {
          delete copy.estimated_mins;
        }
        return copy;
      });
  }

  if (Array.isArray(parsed.project_actions)) {
    parsed.project_actions = parsed.project_actions
      .filter((a: any) => a && a.action)
      .map((a: any) => {
        const copy = { ...a };
        stripEmptyProps(copy, [
          'category',
          'project_name',
          'doc_title',
          'initial_content',
          'content',
          'task_id',
          'target_task_title'
        ]);
        if (copy.create_doc === null || copy.create_doc === undefined) delete copy.create_doc;
        return copy;
      });
  }

  if (Array.isArray(parsed.calendar_actions)) {
    parsed.calendar_actions = parsed.calendar_actions
      .filter((a: any) => a && a.action && a.title)
      .map((a: any) => {
        const copy = { ...a };
        stripEmptyProps(copy, ['start_time', 'end_time', 'date']);
        if (!Array.isArray(copy.recurrence_days) || copy.recurrence_days.length === 0) {
          delete copy.recurrence_days;
        }
        if (copy.is_all_day !== true) delete copy.is_all_day;
        if (copy.delete_series !== true) delete copy.delete_series;
        return copy;
      });
  }

  if (Array.isArray(parsed.shopping_actions)) {
    parsed.shopping_actions = parsed.shopping_actions
      .filter((a: any) => a && a.action && a.item)
      .map((a: any) => stripEmptyProps({ ...a }, ['category']));
  }

  if (Array.isArray(parsed.input_stock_actions)) {
    parsed.input_stock_actions = parsed.input_stock_actions
      .filter((a: any) => a && a.action)
      .map((a: any) => {
        const copy = { ...a };
        stripEmptyProps(copy, ['type', 'title', 'target_title', 'memo']);
        if (
          copy.estimated_mins === null ||
          copy.estimated_mins === undefined ||
          Number(copy.estimated_mins) <= 0
        ) {
          delete copy.estimated_mins;
        }
        return copy;
      });
  }

  if (Array.isArray(parsed.routine_actions)) {
    parsed.routine_actions = parsed.routine_actions
      .filter((a: any) => a && a.action && a.title)
      .map((a: any) => stripEmptyProps({ ...a }, ['type', 'value', 'memo']));
  }

  if (parsed.memory_updates && typeof parsed.memory_updates === 'object') {
    stripEmptyProps(parsed.memory_updates, [
      'cycle_stamps_updates',
      'lifestyle_habits',
      'dictionary',
      'profile'
    ]);
    if (Object.keys(parsed.memory_updates).length === 0) delete parsed.memory_updates;
  }

  if (parsed.state_changes && typeof parsed.state_changes === 'object') {
    if (typeof parsed.state_changes.mark_low_mode !== 'boolean') {
      delete parsed.state_changes.mark_low_mode;
    }
    if (
      !parsed.state_changes.completed_anchor_id ||
      !String(parsed.state_changes.completed_anchor_id).trim()
    ) {
      delete parsed.state_changes.completed_anchor_id;
    }
    if (Object.keys(parsed.state_changes).length === 0) delete parsed.state_changes;
  }

  parsed.need_web_search_query = String(parsed.need_web_search_query || '').trim();
  if (parsed.need_calendar_range && typeof parsed.need_calendar_range === 'object') {
    const start = String(parsed.need_calendar_range.start || '').trim();
    const end = String(parsed.need_calendar_range.end || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(start) || /^\d{4}-\d{2}-\d{2}$/.test(end)) {
      parsed.need_calendar_range = {
        start: /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : end,
        end: /^\d{4}-\d{2}-\d{2}$/.test(end) ? end : start
      };
    } else {
      delete parsed.need_calendar_range;
    }
  } else {
    delete parsed.need_calendar_range;
  }

  return parsed;
}

function stripManualNoticeLines(text: string): string {
  return String(text || '')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !/^(📝\s*タスク追加|📝\s*タスク更新|✅\s*タスク完了|🗑️\s*タスク破棄|📅\s*カレンダー|🛒\s*買物|🎬\s*インプット|🔄\s*ルーティン|📁\s*フォルダ作成|📄\s*資料|🔗\s*タスク紐付)/.test(
        trimmed
      );
    })
    .join('\n')
    .trim();
}

function extractBadgesAndDocLinks(noticeLines: string[]): {
  badges: string[];
  docLinks: Array<{ label: string; url: string }>;
} {
  const badges: string[] = [];
  const docLinks: Array<{ label: string; url: string }> = [];
  const seenUrls: Record<string, boolean> = {};
  const docUrlRegex =
    /(https:\/\/(?:docs\.google\.com\/document|drive\.google\.com\/drive\/folders)\/[^\s)\]]+)/g;

  for (const rawLine of noticeLines || []) {
    let line = String(rawLine || '').trim();
    if (!line) continue;
    const matches = line.match(docUrlRegex);
    if (matches && matches.length > 0) {
      for (const url of matches) {
        if (!seenUrls[url]) {
          seenUrls[url] = true;
          let label = line
            .replace(url, '')
            .replace(/\(\s*\)|（\s*）/g, '')
            .replace(
              /^((?:📁|📄|🔗)\s*(?:資料作成|フォルダ作成|資料|フォルダ|タスク紐付)?[:：]?\s*)/,
              ''
            )
            .replace(/[(（]\s*$/, '')
            .trim();
          if (!label) {
            label = url.includes('/folders/') ? 'Driveフォルダを開く' : '関連資料を開く';
          }
          docLinks.push({ label, url });
        }
        line = line.replace(url, '').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim();
      }
    }
    if (line) badges.push(line);
  }
  return { badges, docLinks };
}

/**
 * ストリーミング中の部分 JSON から "reply_text" 文字列値の増分を安全に抽出するステートマシン
 */
class ReplyTextStreamExtractor {
  private buffer = '';
  private keySearchPos = 0;
  private inString = false;
  private escaped = false;
  private valueStartPos = -1;
  private scanPos = 0;
  private finished = false;

  append(chunk: string): string {
    if (!chunk || this.finished) return '';
    this.buffer += chunk;

    if (this.valueStartPos === -1) {
      this.locateReplyTextStart();
    }
    if (this.valueStartPos === -1) {
      return '';
    }

    let delta = '';
    while (this.scanPos < this.buffer.length) {
      const ch = this.buffer[this.scanPos];
      if (ch === '"') {
        this.finished = true;
        this.scanPos++;
        break;
      }
      if (ch === '\\') {
        if (this.scanPos + 1 >= this.buffer.length) {
          break;
        }
        const next = this.buffer[this.scanPos + 1];
        if (next === 'u') {
          if (this.scanPos + 5 >= this.buffer.length) {
            break;
          }
          const hex = this.buffer.slice(this.scanPos + 2, this.scanPos + 6);
          const code = parseInt(hex, 16);
          if (!Number.isNaN(code)) {
            delta += String.fromCharCode(code);
          }
          this.scanPos += 6;
        } else {
          switch (next) {
            case 'n':
              delta += '\n';
              break;
            case 'r':
              delta += '\r';
              break;
            case 't':
              delta += '\t';
              break;
            case '"':
              delta += '"';
              break;
            case '\\':
              delta += '\\';
              break;
            case '/':
              delta += '/';
              break;
            case 'b':
              delta += '\b';
              break;
            case 'f':
              delta += '\f';
              break;
            default:
              delta += next;
              break;
          }
          this.scanPos += 2;
        }
      } else {
        delta += ch;
        this.scanPos++;
      }
    }

    return delta;
  }

  private locateReplyTextStart(): void {
    while (this.keySearchPos < this.buffer.length) {
      const ch = this.buffer[this.keySearchPos];
      if (this.inString) {
        if (this.escaped) {
          this.escaped = false;
        } else if (ch === '\\') {
          this.escaped = true;
        } else if (ch === '"') {
          this.inString = false;
        }
        this.keySearchPos++;
        continue;
      }

      if (ch === '"') {
        // Check if this string is "reply_text" followed by : "
        const rest = this.buffer.slice(this.keySearchPos);
        const match = rest.match(/^"reply_text"\s*:\s*"/);
        if (match) {
          this.valueStartPos = this.keySearchPos + match[0].length;
          this.scanPos = this.valueStartPos;
          return;
        }
        // Could it be an incomplete prefix of `"reply_text" : "`?
        if (!/^"reply_text"\s*:\s*"/.test(rest) && /^"[a-z_"]*\s*:?\s*$/.test(rest)) {
          return;
        }
        this.inString = true;
        this.keySearchPos++;
        continue;
      }

      this.keySearchPos++;
    }
  }
}

function extractTokenStats(usage: Record<string, any> | null | undefined): TokenStats {
  const u = usage || {};
  return {
    prompt: Number(u.promptTokenCount) || 0,
    cand: Number(u.candidatesTokenCount) || 0,
    cached: Number(u.cachedContentTokenCount) || 0,
    thinking: Number(u.thoughtsTokenCount) || 0,
    toolUse: Number(u.toolUsePromptTokenCount) || 0,
    total: Number(u.totalTokenCount) || 0
  };
}

function buildChatPayload(params: {
  userText: string;
  inlineImage: { mimeType: string; data: string } | null;
  todayLogsText: string;
  memory: MemoryMap;
  precomputed: {
    nowStr: string;
    todayYmd: string;
    elapsedStr: string;
    boundarySummary: string;
    defaultCalendarLines: string[];
    stampsFormatted: string;
    tasks: any[];
    shopping: any[];
    stock: any[];
    routines: any[];
    activeSessionTitle?: string;
    activeSessionMins?: number;
    weatherDisplay: string;
    pressureAlertVal: string;
    relevantDict: string;
  };
  isSecondPass: boolean;
  webSearchContext?: WebSearchContext | null;
  extendedCalendarLines?: string[];
}): Record<string, any> {
  const { userText, inlineImage, todayLogsText, memory, precomputed, isSecondPass } = params;

  const promptModules = [
    memory.prompt_core && memory.prompt_core.trim() !== ''
      ? memory.prompt_core.trim()
      : getDefaultPromptCore(),
    memory.prompt_schedule && memory.prompt_schedule.trim() !== ''
      ? memory.prompt_schedule.trim()
      : getDefaultPromptSchedule(),
    memory.prompt_db && memory.prompt_db.trim() !== ''
      ? memory.prompt_db.trim()
      : getDefaultPromptDb()
  ];
  if (memory.custom_system_prompt && memory.custom_system_prompt.trim() !== '') {
    promptModules.push(
      `【追加カスタム指示（最優先フォーマット・ルール）】\n${memory.custom_system_prompt.trim()}`
    );
  }
  const finalSystemPrompt = promptModules.join(
    '\n\n==================================================\n\n'
  );

  const prefixLines = [
    `【プロファイル（恒久生活基盤）】: ${memory.profile && memory.profile.trim() !== '' ? memory.profile.trim() : '未設定'}`,
    memory.ideal_self && memory.ideal_self.trim() !== ''
      ? `【ありたい人間像・生活指針】: ${memory.ideal_self.trim()}`
      : '',
    memory.lifestyle_habits && memory.lifestyle_habits.trim() !== ''
      ? `【生活習慣・活動定義 (lifestyle_habits)】:\n${memory.lifestyle_habits.trim()}`
      : '',
    memory.skill_options && memory.skill_options.trim() !== ''
      ? `【スキルアップ選択肢 (skill_options)】:\n${memory.skill_options.trim()}`
      : '',
    memory.project_folders && memory.project_folders.trim() !== ''
      ? `【既存プロジェクトフォルダ一覧（Drive連携）】:\n${memory.project_folders.trim()}`
      : ''
  ].filter(Boolean);

  const dynamicLines: string[] = [];
  if (precomputed.weatherDisplay) {
    dynamicLines.push(
      `【天気・気温】: ${precomputed.weatherDisplay} / 気圧急降下: ${precomputed.pressureAlertVal === 'TRUE' ? '急降下中(注意)' : '安定'}`
    );
  }
  dynamicLines.push(`【現在日時】: ${precomputed.nowStr}`);
  dynamicLines.push(`【直前のやり取りからの経過時間(Δt)】: ${precomputed.elapsedStr || '初回'}`);
  dynamicLines.push(
    `【時間の鏡（現在の予定・次の境界までの残り時間）】: ${precomputed.boundarySummary || 'なし'}`
  );

  if (memory.monthly_report_ready === 'TRUE') {
    dynamicLines.push('【月報通知フラグ】: TRUE');
  }
  if (precomputed.stampsFormatted) {
    dynamicLines.push(`【活動・メンテナンス最終記録 (cycle_stamps)】:\n${precomputed.stampsFormatted}`);
  }
  if (memory.weekly_summary && memory.weekly_summary.trim() !== '') {
    dynamicLines.push(`【直近1〜2週間の生活サマリー】: ${memory.weekly_summary.trim()}`);
  }
  if (precomputed.defaultCalendarLines.length > 0) {
    dynamicLines.push(
      `=== Googleカレンダー予定 ===\n${precomputed.defaultCalendarLines.map((l) => `・${l}`).join('\n')}`
    );
  }
  if (precomputed.activeSessionTitle) {
    dynamicLines.push(
      `【現在進行中のタイマー行動】: ${precomputed.activeSessionTitle}（開始から${precomputed.activeSessionMins || 0}分経過）`
    );
  }
  if (precomputed.tasks.length > 0) {
    dynamicLines.push(
      `【未完了タスク一覧】:\n${formatUncompletedTasksForContext(precomputed.tasks, precomputed.todayYmd)}`
    );
  }
  if (precomputed.shopping.length > 0) {
    dynamicLines.push(
      `【買物リスト(未買)】: ${precomputed.shopping.map((s) => s.item).join(', ')}`
    );
  }
  if (precomputed.stock.length > 0) {
    const inputItems = precomputed.stock.map(
      (inp) =>
        `[${inp.type}]${inp.title}${inp.estimatedMins ? `(${inp.estimatedMins}分)` : ''}${inp.memo ? `[${inp.memo}]` : ''}`
    );
    dynamicLines.push(`【インプットストック(未消化)】: ${inputItems.join(', ')}`);
  }
  if (precomputed.routines.length > 0) {
    dynamicLines.push(
      `【登録済み定期ルーティン（ルール定義）】: ${precomputed.routines.map((r) => `${r.ruleName}(${r.type}:${r.value})`).join(', ')}`
    );
  }
  if (precomputed.relevantDict) {
    dynamicLines.push(`【用語辞書（関連項目）】:\n${precomputed.relevantDict}`);
  }

  let promptBody = prefixLines.join('\n') + '\n\n' + dynamicLines.join('\n') + '\n\n';
  if (todayLogsText && todayLogsText.trim() !== '') {
    promptBody += `=== 本日の会話履歴 (時系列) ===\n${todayLogsText.trim()}\n\n`;
  }
  promptBody += `=== ユーザーの最新発言 ===\n${userText || '（画像を受信しました。内容を確認してください）'}`;

  if (params.extendedCalendarLines && params.extendedCalendarLines.length > 0) {
    promptBody += `\n\n【追加取得カレンダー予定（2段目取得結果）】:\n${params.extendedCalendarLines.map((l) => `・${l}`).join('\n')}`;
  } else if (isSecondPass && params.extendedCalendarLines) {
    promptBody += '\n\n【追加取得カレンダー予定（2段目取得結果）】:\n該当期間の登録予定はありません。';
  }

  if (params.webSearchContext) {
    const ws = params.webSearchContext;
    const hasGroundedEvidence =
      !ws.failed &&
      Boolean(ws.summaryText) &&
      (ws.chunksCount > 0 || ws.queries.length > 0);
    if (hasGroundedEvidence) {
      const queryLabel =
        ws.queries.length > 0 ? ` (検索クエリ: ${ws.queries.join(' / ')})` : '';
      let searchBlock = `\n\n【外部Web検索結果（一次情報）${queryLabel}】:\n${ws.summaryText}`;
      if (ws.sources.length > 0) {
        searchBlock +=
          '\n参照元:\n' + ws.sources.map((s) => `- ${s.title || s.uri}: ${s.uri}`).join('\n');
      }
      promptBody += searchBlock;
    } else {
      promptBody +=
        '\n\n【外部Web検索結果】: Web検索から確実な一次情報を取得できませんでした（未確認の細部は推測で断定せず、確認が必要である旨を伝えること）。';
    }
  }

  if (isSecondPass) {
    promptBody +=
      '\n\n※追加取得した上記情報を踏まえ、最終的な応答と必要なJSONアクションを完成させてください（再検索・再レンジ要求は不要です）。';
  }

  const currentTurnParts: Array<Record<string, any>> = [];
  if (inlineImage) {
    currentTurnParts.push({
      inlineData: {
        mimeType: inlineImage.mimeType,
        data: inlineImage.data
      }
    });
  }
  currentTurnParts.push({ text: promptBody });

  const rawThinkingLevel = String(memory.thinking_level ?? '').trim().toLowerCase();
  const thinkingLevel = ALLOWED_THINKING_LEVELS.has(rawThinkingLevel) ? rawThinkingLevel : 'low';

  return {
    systemInstruction: {
      parts: [{ text: finalSystemPrompt }]
    },
    contents: [
      {
        role: 'user',
        parts: currentTurnParts
      }
    ],
    generationConfig: {
      thinkingConfig: { thinkingLevel },
      responseMimeType: 'application/json',
      responseSchema: CHAT_RESPONSE_SCHEMA
    }
  };
}

async function streamGeminiChatPass(params: {
  env: Env;
  model: string;
  payload: Record<string, any>;
  onReplyDelta: (text: string) => Promise<void>;
}): Promise<{ rawText: string; usage: Record<string, any> | null }> {
  const endpoint = `${GEMINI_API_BASE}/${encodeURIComponent(params.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(params.env.GEMINI_API_KEY)}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params.payload)
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini stream API error [${res.status}]: ${errText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  const extractor = new ReplyTextStreamExtractor();

  let sseBuffer = '';
  let rawText = '';
  let lastUsage: Record<string, any> | null = null;

  const processLine = async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const dataStr = trimmed.slice(5).trim();
    if (!dataStr || dataStr === '[DONE]') return;

    let chunk: any;
    try {
      chunk = JSON.parse(dataStr);
    } catch {
      return;
    }

    if (chunk.usageMetadata) {
      lastUsage = chunk.usageMetadata;
    }

    const parts = chunk.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return;

    for (const part of parts) {
      if (part && part.text && !part.thought) {
        rawText += part.text;
        const delta = extractor.append(part.text);
        if (delta) {
          await params.onReplyDelta(delta);
        }
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });

    let newlineIdx = sseBuffer.indexOf('\n');
    while (newlineIdx !== -1) {
      const line = sseBuffer.slice(0, newlineIdx);
      sseBuffer = sseBuffer.slice(newlineIdx + 1);
      await processLine(line);
      newlineIdx = sseBuffer.indexOf('\n');
    }
  }

  sseBuffer += decoder.decode();
  if (sseBuffer.trim()) {
    for (const line of sseBuffer.split('\n')) {
      await processLine(line);
    }
  }

  return { rawText, usage: lastUsage };
}

async function callGeminiWebSearch(
  env: Env,
  searchQuery: string,
  nowStr: string,
  fallbackUserText: string
): Promise<WebSearchContext> {
  const effectiveQuery =
    String(searchQuery || '').trim() || String(fallbackUserText || '').trim();
  const systemPrompt =
    'あなたは事実に忠実なWeb検索リサーチャーです。\n' +
    '与えられた現在日時を時間軸の基準とし、確認したい質問・トピックについて必ず googleSearch ツールを実行して最新の一次情報を確認してください。\n' +
    '確認できた事実の要点のみを簡潔に整理して答え、確認できなかった細部は推測で補完しないでください。';

  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `【現在日時】: ${nowStr}\n【確認したい質問・トピック】:\n${effectiveQuery}`
          }
        ]
      }
    ],
    tools: [{ googleSearch: {} }],
    generationConfig: {
      thinkingConfig: { thinkingLevel: 'medium' }
    }
  };

  try {
    const endpoint = `${GEMINI_API_BASE}/${WEB_SEARCH_MODEL}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Web検索APIエラー [${res.status}]: ${errText}`);
    }

    const json: any = await res.json();
    const candidate = json.candidates?.[0] || {};
    const parts = candidate.content?.parts || [];
    let summaryText = '';
    for (const part of parts) {
      if (part?.text && !part.thought) {
        summaryText += part.text;
      }
    }

    const gm = candidate.groundingMetadata || {};
    const queries = Array.isArray(gm.webSearchQueries) ? gm.webSearchQueries.map(String) : [];
    const chunks = Array.isArray(gm.groundingChunks) ? gm.groundingChunks : [];
    const sources: Array<{ title: string; uri: string }> = [];
    for (const ch of chunks) {
      if (ch?.web?.uri) {
        sources.push({
          title: String(ch.web.title || ch.web.uri),
          uri: String(ch.web.uri)
        });
      }
    }

    return {
      summaryText: summaryText.trim(),
      queries,
      chunksCount: chunks.length,
      sources,
      usage: json.usageMetadata || null,
      failed: false
    };
  } catch (err) {
    console.warn('Web検索取得エラー (検索未完了として続行):', err);
    return {
      summaryText: '',
      queries: [],
      chunksCount: 0,
      sources: [],
      usage: null,
      failed: true
    };
  }
}

async function applyMemoryUpdatesSafely(
  env: Env,
  memory: MemoryMap,
  updates: Record<string, any> | undefined,
  mirrorEvents: MirrorEvent[]
): Promise<void> {
  if (!updates || typeof updates !== 'object') return;

  if (typeof updates.lifestyle_habits === 'string' && updates.lifestyle_habits.trim()) {
    const candidate = updates.lifestyle_habits.trim();
    const existingRaw = (memory.lifestyle_habits || '').trim();
    const parseHabits = (text: string) => {
      const map: Record<string, string> = {};
      const order: string[] = [];
      const lines = text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      let currentTopic: string | null = null;
      let currentContent: string[] = [];
      for (const line of lines) {
        const match = line.match(/^\[([^\]]+)\][:：\s]*(.*)$/);
        if (match) {
          if (currentTopic) map[currentTopic] = currentContent.join(' ').trim();
          currentTopic = match[1].trim();
          if (!order.includes(currentTopic)) order.push(currentTopic);
          currentContent = match[2] ? [match[2].trim()] : [];
        } else if (currentTopic) {
          currentContent.push(line);
        }
      }
      if (currentTopic) map[currentTopic] = currentContent.join(' ').trim();
      return { map, order };
    };

    const existing = parseHabits(existingRaw);
    const incoming = parseHabits(candidate);
    let nextValue = '';
    if (incoming.order.length === 0) {
      nextValue = existingRaw ? `${existingRaw}\n${candidate}` : candidate;
    } else {
      for (const topic of incoming.order) {
        if (!existing.order.includes(topic)) existing.order.push(topic);
        existing.map[topic] = incoming.map[topic];
      }
      nextValue = existing.order.map((t) => `[${t}]: ${existing.map[t]}`).join('\n');
    }
    if (nextValue && nextValue !== existingRaw) {
      await setMemoryValue(env, 'lifestyle_habits', nextValue);
      mirrorEvents.push({ type: 'set_memory', key: 'lifestyle_habits', value: nextValue });
    }
  }

  if (typeof updates.profile === 'string' && updates.profile.trim()) {
    const candidate = updates.profile.trim();
    const existingProfile = (memory.profile || '').trim();
    let nextProfile = candidate;
    if (existingProfile) {
      if (candidate.length >= existingProfile.length * 0.85) {
        nextProfile = candidate;
      } else {
        const existingLines = new Set(
          existingProfile
            .split('\n')
            .map((l) => l.replace(/^[・\-\s]+/, '').trim())
            .filter(Boolean)
        );
        const newLines = candidate
          .split('\n')
          .map((l) => l.replace(/^[・\-\s]+/, '').trim())
          .filter((l) => l.length > 0 && !existingLines.has(l));
        nextProfile =
          newLines.length > 0
            ? `${existingProfile}\n${newLines.map((l) => `・${l}`).join('\n')}`
            : existingProfile;
      }
    }
    if (nextProfile !== existingProfile) {
      await setMemoryValue(env, 'profile', nextProfile);
      mirrorEvents.push({ type: 'set_memory', key: 'profile', value: nextProfile });
    }
  }

  if (typeof updates.dictionary === 'string' && updates.dictionary.trim()) {
    const candidate = updates.dictionary.trim();
    const existingDict = (memory.dictionary || '').trim();
    let updated = existingDict;
    if (!existingDict) {
      updated = candidate;
    } else {
      const newLines = candidate
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      for (const line of newLines) {
        const term = line.split(':')[0].replace(/^[・\-\s]+/, '').trim();
        if (term && !updated.includes(term)) {
          const cleanLine = line.replace(/^[・\-\s]+/, '');
          updated += `\n・${cleanLine}`;
        }
      }
    }
    if (updated !== existingDict) {
      await setMemoryValue(env, 'dictionary', updated);
      mirrorEvents.push({ type: 'set_memory', key: 'dictionary', value: updated });
    }
  }
}

export async function handleChatStream(
  env: Env,
  ctx: ExecutionContext,
  authKey: string,
  messagePayload: any
): Promise<Response> {
  if (!verifyDashboardAccess(env, authKey)) {
    return jsonResponse({ ok: false, error: '認証に失敗しました' }, 401);
  }

  const payload =
    typeof messagePayload === 'string' ? { text: messagePayload } : messagePayload || {};
  const userText = String(payload.text || '').trim();
  const hasPhoto = Boolean(payload.imageBase64);
  if (!userText && !hasPhoto) {
    return jsonResponse({ ok: false, error: 'メッセージまたは画像を入力してください。' }, 400);
  }

  const inlineImage = hasPhoto
    ? parseBase64Image(payload.imageBase64, payload.imageMimeType)
    : null;

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const sendSse = async (event: string, data: unknown) => {
    const body = typeof data === 'string' ? data : JSON.stringify(data);
    await writer.write(encoder.encode(`event: ${event}\ndata: ${body}\n\n`));
  };

  const runStream = async () => {
    try {
      const now = new Date();
      const nowStr = formatJstDateTime(now);
      const hhmm = nowStr.substring(11, 16);
      const todayYmd = formatJstYmd(now);
      const defaultEndYmd = getDefaultCalendarEndYmd(now);

      // 画像アップロードは Gemini 呼び出しと並列で実行開始
      const imageUploadPromise = hasPhoto
        ? uploadBase64ImageToDrive(
            env,
            payload.imageBase64,
            payload.imageMimeType || 'image/jpeg',
            'chat_img'
          ).catch((err) => {
            console.error('Chat画像Drive保存エラー:', err);
            return null;
          })
        : Promise.resolve(null);

      // コンテキストを並列取得
      const [
        memory,
        todayLogs,
        fastState,
        tasks,
        shopping,
        stock,
        routines,
        workBoundary,
        defaultCalendarLines
      ] = await Promise.all([
        getMemory(env),
        getLogicalTodayLogs(env, now),
        loadFastState(env, now),
        getTasks(env, '未完了'),
        getShoppingList(env, '未買'),
        getInputStockList(env, '未'),
        getRoutines(env, '有効'),
        getWorkModeAndBoundary(env, now),
        getEventsInDateRange(env, todayYmd, defaultEndYmd).catch((err) => {
          console.warn('カレンダー範囲取得警告:', err);
          return [] as string[];
        })
      ]);

      let weatherDisplay = memory.weather_info || '';
      let pressureAlertVal = memory.pressure_alert || 'FALSE';
      if (isWeatherStale(fastState, workBoundary.workMode, weatherDisplay, now)) {
        try {
          const freshW = await fetchWeatherAndPressure(env);
          if (freshW && freshW.weatherInfo) {
            weatherDisplay = freshW.weatherInfo;
            pressureAlertVal = freshW.pressureAlert;
            memory.weather_info = freshW.weatherInfo;
            memory.pressure_alert = freshW.pressureAlert;
          }
        } catch (wErr) {
          console.warn('Chat天気更新警告:', wErr);
        }
      }
      if (workBoundary.workMode !== 'commute' && weatherDisplay.includes('｜')) {
        weatherDisplay = weatherDisplay.split('｜')[0].trim();
      }

      const todayLogsCondensed = buildCondensedLogsFromArray(todayLogs);
      const lastTimeStr = extractLastLogTime(todayLogsCondensed);
      const elapsedStr = formatElapsedTime(lastTimeStr, now);

      let relevantDict = '';
      if (memory.dictionary && memory.dictionary.trim() !== '') {
        const searchTarget = [
          userText,
          todayLogsCondensed,
          tasks.map((t) => t.title || '').join(' '),
          stock.map((s) => s.title || '').join(' '),
          shopping.map((s) => s.item || '').join(' ')
        ].join('\n');
        relevantDict = filterRelevantDictionaryEntries(memory.dictionary, searchTarget);
      }

      const activeSessionMins =
        fastState.activeSession && fastState.activeSession.startedAtMs
          ? Math.max(0, Math.round((now.getTime() - Number(fastState.activeSession.startedAtMs)) / 60000))
          : 0;

      const precomputed = {
        nowStr: formatJstNowWithDay(now),
        todayYmd,
        elapsedStr,
        boundarySummary: workBoundary.boundaryInfo?.summaryText || 'なし',
        defaultCalendarLines,
        stampsFormatted: memory.cycle_stamps
          ? formatCycleStampsWithElapsed(memory.cycle_stamps, todayYmd)
          : '',
        tasks,
        shopping,
        stock,
        routines,
        activeSessionTitle: fastState.activeSession?.title || '',
        activeSessionMins,
        weatherDisplay,
        pressureAlertVal,
        relevantDict
      };

      const chatModel = DEFAULT_CHAT_MODEL;
      const pass1Payload = buildChatPayload({
        userText,
        inlineImage,
        todayLogsText: todayLogsCondensed,
        memory,
        precomputed,
        isSecondPass: false
      });

      const tPass1 = Date.now();
      const pass1Res = await streamGeminiChatPass({
        env,
        model: chatModel,
        payload: pass1Payload,
        onReplyDelta: async (delta) => {
          await sendSse('delta', { text: delta });
        }
      });
      const pass1LatencyMs = Date.now() - tPass1;
      const pass1Parsed = sanitizeChatActionResult(safeParseGeminiJson(pass1Res.rawText));

      const searchQuery = String(pass1Parsed?.need_web_search_query || '').trim();
      const calRange = pass1Parsed?.need_calendar_range || null;
      const needSearch = Boolean(searchQuery);
      const needCalRange = Boolean(calRange && (calRange.start || calRange.end));

      let finalParsed = pass1Parsed;
      let webSearchContext: WebSearchContext | null = null;
      let extendedCalendarLines: string[] | undefined;
      let webSearchLatencyMs = 0;
      let pass2LatencyMs = 0;
      let pass2Usage: Record<string, any> | null = null;

      if (needSearch || needCalRange) {
        if (needSearch) {
          await sendSse('status', { text: '調べものをしています...', resetDraft: true });
        } else if (needCalRange) {
          await sendSse('status', { text: 'カレンダーを確認しています...', resetDraft: true });
        }

        const tWs0 = Date.now();
        const [wsRes, calRes] = await Promise.all([
          needSearch
            ? callGeminiWebSearch(env, searchQuery, precomputed.nowStr, userText)
            : Promise.resolve(null),
          needCalRange
            ? getEventsInDateRange(env, calRange.start, calRange.end).catch((err) => {
                console.warn('2段目カレンダー範囲取得警告:', err);
                return [] as string[];
              })
            : Promise.resolve(undefined)
        ]);
        if (needSearch) {
          webSearchLatencyMs = Date.now() - tWs0;
          webSearchContext = wsRes;
        }
        if (needCalRange) {
          extendedCalendarLines = calRes;
        }

        const pass2Payload = buildChatPayload({
          userText,
          inlineImage,
          todayLogsText: todayLogsCondensed,
          memory,
          precomputed,
          isSecondPass: true,
          webSearchContext,
          extendedCalendarLines
        });

        const tPass2 = Date.now();
        const pass2Res = await streamGeminiChatPass({
          env,
          model: chatModel,
          payload: pass2Payload,
          onReplyDelta: async (delta) => {
            await sendSse('delta', { text: delta });
          }
        });
        pass2LatencyMs = Date.now() - tPass2;
        pass2Usage = pass2Res.usage;
        finalParsed = sanitizeChatActionResult(safeParseGeminiJson(pass2Res.rawText));
      }

      const aiResult = finalParsed || {};
      const executedNotices: string[] = [];
      let deckNeedsRefresh: boolean | 'check_low_cards' = false;
      const chatCompletedIds: string[] = [];
      const mirrorEvents: MirrorEvent[] = [];
      let dbMutated = false;

      try {
        if (Array.isArray(aiResult.task_actions) && aiResult.task_actions.length > 0) {
          const taskRes = await applyTaskActions(env, aiResult.task_actions);
          executedNotices.push(...taskRes.notices);
          if (taskRes.notices.length > 0) {
            dbMutated = true;
            if (
              aiResult.task_actions.some(
                (a: any) => a.action === 'complete' || a.action === 'delete'
              )
            ) {
              deckNeedsRefresh = 'check_low_cards';
              if (taskRes.completedIds.length > 0) {
                chatCompletedIds.push(...taskRes.completedIds);
              } else {
                for (const a of aiResult.task_actions) {
                  const tid = a.task_id || a.id;
                  if ((a.action === 'complete' || a.action === 'delete') && tid) {
                    chatCompletedIds.push(String(tid));
                  }
                }
              }
            }
          }
        }

        if (Array.isArray(aiResult.calendar_actions) && aiResult.calendar_actions.length > 0) {
          const calRes = await applyCalendarActions(env, aiResult.calendar_actions);
          executedNotices.push(...calRes);
          if (calRes.length > 0) deckNeedsRefresh = true;
        }

        if (Array.isArray(aiResult.shopping_actions) && aiResult.shopping_actions.length > 0) {
          const shopRes = await applyShoppingActions(env, aiResult.shopping_actions);
          executedNotices.push(...shopRes);
          if (shopRes.length > 0) dbMutated = true;
        }

        if (
          Array.isArray(aiResult.input_stock_actions) &&
          aiResult.input_stock_actions.length > 0
        ) {
          const inputRes = await applyInputStockActions(env, aiResult.input_stock_actions);
          executedNotices.push(...inputRes.notices);
          if (inputRes.notices.length > 0) {
            dbMutated = true;
            if (
              aiResult.input_stock_actions.some(
                (a: any) => a.action === 'complete' || a.action === 'delete'
              )
            ) {
              deckNeedsRefresh = 'check_low_cards';
              if (inputRes.completedIds.length > 0) {
                chatCompletedIds.push(...inputRes.completedIds);
              }
              for (const a of aiResult.input_stock_actions) {
                if (a.action === 'complete' || a.action === 'delete') {
                  if (a.id) chatCompletedIds.push(String(a.id));
                  if (a.title) chatCompletedIds.push(String(a.title));
                }
              }
            }
          }
        }

        if (Array.isArray(aiResult.routine_actions) && aiResult.routine_actions.length > 0) {
          const routineRes = await applyRoutineActions(env, aiResult.routine_actions);
          executedNotices.push(...routineRes);
          if (routineRes.length > 0) dbMutated = true;
        }

        if (aiResult.memory_updates?.cycle_stamps_updates) {
          const rawStampUpdates = String(aiResult.memory_updates.cycle_stamps_updates);
          const updatedStamps = await updateCycleStampsSafely(env, [rawStampUpdates]);
          if (updatedStamps.length > 0) {
            for (const entry of updatedStamps) {
              executedNotices.push(`📌 周期スタンプ更新: ${entry}`);
            }
            const refreshedMemory = await getMemory(env);
            if (refreshedMemory.cycle_stamps !== undefined) {
              mirrorEvents.push({
                type: 'set_memory',
                key: 'cycle_stamps',
                value: refreshedMemory.cycle_stamps
              });
            }
          }
        }
      } catch (actErr) {
        console.error('Chatアクション適用エラー:', actErr);
      }

      try {
        await applyMemoryUpdatesSafely(env, memory, aiResult.memory_updates, mirrorEvents);
      } catch (memErr) {
        console.error('メモリー更新エラー:', memErr);
      }

      const sc = aiResult.state_changes;
      const reactionEmoji = String(aiResult.reaction_emoji || '').trim() || '👍';
      let pureReplyText = stripManualNoticeLines(aiResult.reply_text || '');
      let mode: 'reaction' | 'reply' =
        aiResult.reply_mode === 'reaction' && !pureReplyText ? 'reaction' : 'reply';
      if (executedNotices.length > 0) {
        mode = 'reply';
        if (!pureReplyText) pureReplyText = '承知しました。反映しておきました。';
      } else if (aiResult.reply_mode === 'reaction' && !pureReplyText) {
        mode = 'reaction';
      } else if (!pureReplyText) {
        mode = 'reaction';
      }

      const parsedBadgesAndLinks = extractBadgesAndDocLinks(executedNotices);
      const logReplyParts = [`[スタンプ: ${reactionEmoji}]`];
      if (pureReplyText) logReplyParts.push(pureReplyText);
      if (executedNotices.length > 0) logReplyParts.push(executedNotices.join('\n'));
      const loggedAiReply = logReplyParts.join('\n\n');

      let loggedUserText = userText;
      if (aiResult.image_summary && String(aiResult.image_summary).trim() !== '') {
        const desc = `[画像内容: ${String(aiResult.image_summary).trim()}]`;
        loggedUserText = loggedUserText ? `${loggedUserText}\n${desc}` : desc;
      }

      const uploadedImg = await imageUploadPromise;
      const imageUrl = uploadedImg?.url || '';

      const p1Stats = extractTokenStats(pass1Res.usage);
      const wsStats = extractTokenStats(webSearchContext?.usage);
      const p2Stats = extractTokenStats(pass2Usage);
      const isTwoPass = needSearch || needCalRange;
      const finalStats = isTwoPass ? p2Stats : p1Stats;
      const totalTokens = p1Stats.total + wsStats.total + p2Stats.total;
      const passTags: string[] = [];
      if (needSearch) passTags.push('+web');
      if (needCalRange) passTags.push('+cal');

      const latestWorkBoundary =
        aiResult.calendar_actions && aiResult.calendar_actions.length > 0
          ? await getWorkModeAndBoundary(env, now)
          : workBoundary;
      const lists = await buildListsSnapshot(env, undefined, now);
      const latestFastState = await loadFastState(env, now);
      if (chatCompletedIds.length > 0) {
        for (const cid of chatCompletedIds) {
          if (!latestFastState.completedToday[cid]) {
            latestFastState.completedToday[cid] = true;
          }
        }
      }
      if (sc && typeof sc === 'object') {
        if (typeof sc.mark_low_mode === 'boolean') {
          if (latestFastState.isLowMode !== sc.mark_low_mode) {
            deckNeedsRefresh = true;
          }
          latestFastState.isLowMode = sc.mark_low_mode;
        }
        if (sc.completed_anchor_id) {
          latestFastState.completedToday[String(sc.completed_anchor_id)] = true;
        }
      }
      latestFastState.listCache = lists;
      await saveFastState(env, latestFastState);

      const deck = composeHomeDeck(latestWorkBoundary.workMode, now, latestFastState);
      const shouldRefreshDeck =
        deckNeedsRefresh === true ||
        (deckNeedsRefresh === 'check_low_cards' && deck.cards.length < 3);

      const logMeta = {
        isTwoModel: true,
        backendModel: chatModel,
        litePromptTokens: isTwoPass ? p1Stats.prompt + wsStats.prompt : 0,
        liteCandidatesTokens: isTwoPass ? p1Stats.cand + wsStats.cand : 0,
        liteCachedTokens: isTwoPass ? p1Stats.cached + wsStats.cached : 0,
        flashPromptTokens: finalStats.prompt,
        flashCandidatesTokens: finalStats.cand,
        flashCachedTokens: finalStats.cached,
        newTotalTokens: totalTokens,
        liteLatencyMs: isTwoPass ? pass1LatencyMs + webSearchLatencyMs : 0,
        flashLatencyMs: isTwoPass ? pass2LatencyMs : pass1LatencyMs,
        phaseAndTags: `[workers-sse ${isTwoPass ? '2-pass' : '1-pass'}${passTags.join('')} / mode:${mode} / model:${chatModel}] | deckRefresh:${Boolean(shouldRefreshDeck)}`
      };

      const logEntry: LogEntry = {
        timestampStr: nowStr,
        sender: 'user',
        message: loggedUserText,
        imageUrl,
        aiReply: loggedAiReply,
        metaJson: JSON.stringify(logMeta)
      };
      await appendLog(env, logEntry);

      mirrorEvents.unshift({ type: 'append_log', entry: logEntry });
      if (dbMutated) {
        mirrorEvents.push({ type: 'sync_snapshot' });
      }
      ctx.waitUntil(mirrorToSheets(env, mirrorEvents));

      await sendSse('done', {
        authorized: true,
        mode,
        reactionEmoji,
        replyText: mode === 'reply' ? pureReplyText : '',
        badges: parsedBadgesAndLinks.badges,
        docLinks: parsedBadgesAndLinks.docLinks,
        imageUrl,
        time: hhmm,
        nowStr,
        lists,
        state: latestFastState,
        deck,
        needsDeckRefresh: Boolean(shouldRefreshDeck)
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('handleChatStream error:', msg);
      try {
        await sendSse('error', { error: msg });
      } catch {
        // stream already closed
      }
    } finally {
      try {
        await writer.close();
      } catch {
        // ignore close error
      }
    }
  };

  ctx.waitUntil(runStream());

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      ...corsHeaders()
    }
  });
}
