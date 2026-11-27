import { getWorkModeAndBoundary } from './calendar';
import { timingSafeEqualStr } from './utils';
import { drainMirrorQueue } from './sheets-mirror';
import {
  appendLog,
  applyInputStockActions,
  applyTaskActions,
  buildListsSnapshot,
  ensureLogicalDayBoundary,
  getInputStockList,
  getLogicalTodayLogs,
  getMemory,
  getRoutines,
  getShoppingList,
  getTasks,
  isOpProcessed,
  loadFastState,
  markOpProcessed,
  saveFastState,
  setMemoryValue,
  toggleShoppingItemById,
  updateCycleStampsSafely
} from './db';
import {
  buildDailyBriefingObj,
  buildDeltaText,
  composeHomeDeck,
  generateAiDeck
} from './deck-engine';
import { uploadBase64ImageToDrive } from './media';
import { importAllFromSheets } from './sheets-import';
import { MirrorEvent, mirrorToSheets } from './sheets-mirror';
import {
  ActiveSession,
  Env,
  FastState,
  LogEntry,
  MemoryMap
} from './types';
import {
  addDaysToYmd,
  formatJstDateTime,
  formatJstIso,
  formatJstYmd,
  getLogicalDayKey,
  jsonResponse,
  parsePositiveEstimatedMins
} from './utils';
import {
  fetchWeatherAndPressure,
  formatWeatherLineForHome,
  isWeatherStale,
  refreshBriefingWeatherLine
} from './weather';

// =============================================================================
// 1. 認証 & 共通ヘルパー
// =============================================================================

function verifyDashboardAccess(env: Env, authKey: unknown): boolean {
  const expected = String(env.DASHBOARD_ACCESS_KEY || '').trim();
  const actual = String(authKey ?? '').trim();
  return Boolean(expected && actual && timingSafeEqualStr(expected, actual));
}

function unauthorizedPayload() {
  return {
    authorized: false,
    error: '認証キーが正しくありません。設定画面からオーナー認証キーを確認してください。'
  };
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

function extractBadgesAndDocLinks(noticeLines: string[]): {
  badges: string[];
  docLinks: Array<{ label: string; url: string }>;
} {
  const badges: string[] = [];
  const docLinks: Array<{ label: string; url: string }> = [];
  const seenUrls: Record<string, boolean> = {};
  const docUrlRegex = /(https:\/\/(?:docs\.google\.com\/document|drive\.google\.com\/drive\/folders)\/[^\s)\]]+)/g;

  for (let i = 0; i < (noticeLines || []).length; i++) {
    let line = String(noticeLines[i] || '').trim();
    if (!line) continue;
    const matches = line.match(docUrlRegex);
    if (matches && matches.length > 0) {
      for (const url of matches) {
        if (!seenUrls[url]) {
          seenUrls[url] = true;
          let label = line
            .replace(url, '')
            .replace(/\(\s*\)|（\s*）/g, '')
            .replace(/^((?:📁|📄|🔗)\s*(?:資料作成|フォルダ作成|資料|フォルダ|タスク紐付)?[:：]?\s*)/, '')
            .replace(/[(（]\s*$/, '')
            .trim();
          if (!label) {
            label = url.indexOf('/folders/') !== -1 ? 'Driveフォルダを開く' : '関連資料を開く';
          }
          docLinks.push({ label, url });
        }
        line = line.replace(url, '').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim();
      }
    }
    if (line) {
      badges.push(line);
    }
  }
  return { badges, docLinks };
}

function buildChatLogEntryObject(entry: {
  id?: string | number;
  timestampStr: string;
  message: string;
  imageUrl: string;
  aiReply: string;
}) {
  const tsStr = String(entry.timestampStr || '');
  const hhmm = tsStr.length >= 16 ? tsStr.substring(11, 16) : '';
  const userText = String(entry.message || '')
    .replace(/\n?\[画像内容:[\s\S]*$/g, '')
    .trim();
  const imageUrls = String(entry.imageUrl || '')
    .split('\n')
    .map((u) => u.trim())
    .filter(Boolean);

  const lines = String(entry.aiReply || '').split('\n');
  let reactionEmoji = '';
  const bodyLines: string[] = [];
  const noticeLines: string[] = [];
  const noticePattern = /^(📝|✅|🗑️|📅|🛒|🎬|💡|🔄|📁|📄|🔗|📌)\s+/;

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) {
      if (bodyLines.length > 0) bodyLines.push('');
      continue;
    }
    const stampMatch = t.match(/^\[スタンプ:\s*([^\]]+)\]$/);
    if (stampMatch) {
      reactionEmoji = stampMatch[1].trim();
    } else if (noticePattern.test(t)) {
      noticeLines.push(t);
    } else {
      bodyLines.push(lines[i]);
    }
  }

  const aiText = bodyLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const parsedNotices = extractBadgesAndDocLinks(noticeLines);

  return {
    id: entry.id || 'LOG_' + tsStr,
    time: hhmm,
    timestampStr: tsStr,
    userText,
    imageUrls,
    reactionEmoji,
    aiText,
    badges: parsedNotices.badges,
    docLinks: parsedNotices.docLinks
  };
}

function buildChatMessagesFromLogs(logs: LogEntry[]) {
  return logs
    .filter((entry) => entry.sender !== 'system')
    .map((entry, idx) => {
      const item = buildChatLogEntryObject(entry);
      item.id = `LOG_${idx}_${item.time}`;
      return item;
    });
}

function buildActiveSessionFromPayload(c: Record<string, any>, now: Date, nowIso: string): ActiveSession {
  const startedAtCandidate =
    typeof c.startedAtIso === 'string' && c.startedAtIso.trim()
      ? c.startedAtIso.trim()
      : typeof c.startedAt === 'string' && c.startedAt.trim()
        ? c.startedAt.trim()
        : '';
  const startedAtIso =
    startedAtCandidate && Number.isFinite(Date.parse(startedAtCandidate))
      ? startedAtCandidate
      : nowIso;

  return {
    id: String(c.id || `custom_${now.getTime()}`),
    title: String(c.title || '行動').trim(),
    sub: String(c.sub || '').trim(),
    icon: String(c.icon || 'compass'),
    mins: parsePositiveEstimatedMins(c.mins) || 30,
    isAnchor: Boolean(c.isAnchor),
    isSleepCard: Boolean(c.isSleepCard),
    isWorkBlock: Boolean(c.isWorkBlock),
    isTriage: Boolean(c.isTriage),
    isCustom: Boolean(c.isCustom),
    linkedType: String(c.linkedType || 'none'),
    linkedId: String(c.linkedId || ''),
    cycleStampLabel: String(c.cycleStampLabel || ''),
    triageTaskIds: Array.isArray(c.triageTaskIds) ? c.triageTaskIds.map(String) : [],
    startedAtMs: Number(c.startedAtMs) > 0 ? Number(c.startedAtMs) : now.getTime(),
    startedAtIso
  };
}

async function executeCompleteSessionCore(
  env: Env,
  fastState: FastState,
  p: Record<string, any>,
  now: Date,
  nowStr: string,
  nowIso: string,
  logicalDayStr: string,
  logIdxOffset: number
): Promise<{
  notices: string[];
  addedChatMessage: ReturnType<typeof buildChatLogEntryObject>;
  mirrorEvents: MirrorEvent[];
}> {
  const session = (p.session || fastState.activeSession || {}) as Record<string, any>;
  const mood = String(p.mood || '').trim();
  const note = String(p.note || '').trim();
  const keepOpen = Boolean(p.keepOpen);
  const notices: string[] = [];
  const mirrorEvents: MirrorEvent[] = [];
  let photoUrl = '';
  if (p.photoBase64) {
    try {
      const savedImg = await uploadBase64ImageToDrive(
        env,
        String(p.photoBase64),
        String(p.photoMimeType || 'image/jpeg'),
        'reflect'
      );
      photoUrl = savedImg.url;
    } catch (imgErr) {
      console.warn(
        'ふりかえり画像Drive保存エラー:',
        imgErr instanceof Error ? imgErr.message : String(imgErr)
      );
      notices.push('⚠️ 画像保存に失敗しました（記録自体は完了）');
    }
  }

  const sessionTitle = String(session.title || '行動').trim();

  try {
    if (session.isTriage) {
      const targetIds = Array.isArray(session.triageTaskIds)
        ? session.triageTaskIds.filter(Boolean).map(String)
        : [];
      const tomorrowStr = addDaysToYmd(logicalDayStr, 1);
      let idsToMove = targetIds;
      if (idsToMove.length === 0) {
        const uncompleted = await getTasks(env, '未完了');
        idsToMove = uncompleted
          .filter((t) => t.dueDate && t.dueDate <= logicalDayStr)
          .slice(0, 5)
          .map((t) => t.id);
      }
      if (idsToMove.length > 0) {
        const res = await applyTaskActions(
          env,
          idsToMove.map((id) => ({
            action: 'update',
            task_id: id,
            due_date: tomorrowStr
          }))
        );
        notices.push(...res.notices);
      }
      fastState.triagedToday = true;
    }

    if (!keepOpen) {
      if (session.linkedType === 'task' && session.linkedId) {
        const taskRes = await applyTaskActions(env, [
          { action: 'complete', task_id: String(session.linkedId) }
        ]);
        notices.push(...taskRes.notices);
      } else if (session.linkedType === 'stock' && session.linkedId) {
        const stockRes = await applyInputStockActions(env, [
          { action: 'complete', title: String(session.linkedId) }
        ]);
        notices.push(...stockRes.notices);
      }
    }

    if (session.cycleStampLabel) {
      const updated = await updateCycleStampsSafely(env, [
        `${session.cycleStampLabel}: ${logicalDayStr}`
      ]);
      if (updated && updated.length > 0) {
        updated.forEach((entry) => notices.push(`📌 周期スタンプ更新: ${entry}`));
        const latestMem = await getMemory(env);
        mirrorEvents.push({
          type: 'set_memory',
          key: 'cycle_stamps',
          value: latestMem.cycle_stamps || ''
        });
      }
    }
  } catch (applyErr) {
    console.error('完了反映エラー:', applyErr instanceof Error ? applyErr.message : String(applyErr));
    notices.push('⚠️ 一部の状態反映に失敗しました');
  }

  if (session.id && !session.isCustom && !session.isSleepCard) {
    fastState.completedToday[String(session.id)] = true;
  }
  if (!keepOpen && session.linkedType === 'task' && session.linkedId) {
    fastState.completedToday[String(session.linkedId)] = true;
  }
  fastState.activeSession = null;
  fastState.lastAction = {
    title: session.isSleepCard ? '睡眠・起床' : sessionTitle,
    completedAt: nowIso,
    isSleep: Boolean(session.isSleepCard)
  };

  const rawUsedMins = Number(p.usedMins);
  const startedMs = Number(p.startedAtMs) > 0 ? Number(p.startedAtMs) : Number(session.startedAtMs) || 0;
  const endedMs = Number(p.endedAtMs) > 0 ? Number(p.endedAtMs) : now.getTime();
  const elapsedMins =
    Number.isFinite(rawUsedMins) && rawUsedMins > 0
      ? Math.max(1, Math.round(rawUsedMins))
      : startedMs > 0
        ? Math.max(1, Math.round((endedMs - startedMs) / 60000))
        : 0;
  let userMsg = '';
  if (session.isSleepCard) {
    const sleepDur =
      elapsedMins > 0
        ? elapsedMins >= 60
          ? `${Math.floor(elapsedMins / 60)}時間${elapsedMins % 60 > 0 ? (elapsedMins % 60) + '分' : ''}`
          : `${elapsedMins}分`
        : '';
    userMsg = `起きました（おはよう${sleepDur ? ' · 睡眠 ' + sleepDur : ''}）`;
  } else if (session.isTriage) {
    userMsg = `【引き算】${sessionTitle}`;
  } else if (keepOpen) {
    userMsg = `【進行】${sessionTitle}${elapsedMins > 0 ? `（実測${elapsedMins}分）` : ''}`;
  } else {
    userMsg = `【完了】${sessionTitle}${elapsedMins > 0 ? `（実測${elapsedMins}分）` : ''}`;
  }

  const detailParts: string[] = [];
  if (mood) detailParts.push(`気分: ${mood}`);
  if (note) detailParts.push(note);
  if (detailParts.length > 0) {
    userMsg += `\n${detailParts.join(' / ')}`;
  }

  const emoji = session.isSleepCard ? '☀️' : session.isTriage ? '🌿' : '✨';
  const aiReplyLines = [`[スタンプ: ${emoji}]`];
  if (notices.length > 0) {
    aiReplyLines.push(notices.join('\n'));
  }
  const aiReplyStr = aiReplyLines.join('\n');

  const logEntry: LogEntry = {
    timestampStr: nowStr,
    sender: 'user',
    message: userMsg,
    imageUrl: photoUrl,
    aiReply: aiReplyStr
  };

  try {
    await appendLog(env, logEntry);
    mirrorEvents.push({ type: 'append_log', entry: logEntry });
  } catch (logErr) {
    console.error('完了ログ追記エラー:', logErr instanceof Error ? logErr.message : String(logErr));
  }

  const addedChatMessage = buildChatLogEntryObject({
    id: `LOG_${now.getTime() + logIdxOffset}`,
    timestampStr: nowStr,
    message: userMsg,
    imageUrl: photoUrl,
    aiReply: aiReplyStr
  });

  return { notices, addedChatMessage, mirrorEvents };
}

// =============================================================================
// 2. Public API Endpoints
// =============================================================================

export async function apiGetHomeBootstrap(
  env: Env,
  ctx: ExecutionContext,
  authKey: string,
  options?: { force?: boolean; clientRevision?: number }
) {
  if (!verifyDashboardAccess(env, authKey)) {
    return unauthorizedPayload();
  }

  const opts = options && typeof options === 'object' ? options : {};
  const force = Boolean(opts.force);
  const clientRevision = Number(opts.clientRevision) || 0;

  const now = new Date();
  const todayStr = formatJstYmd(now);

  const [fastState, memory, workBoundary] = await Promise.all([
    loadFastState(env, now),
    getMemory(env),
    getWorkModeAndBoundary(env, now)
  ]);

  let stateDirty = false;
  const mirrorEvents: MirrorEvent[] = [];

  if (isWeatherStale(fastState, workBoundary.workMode, memory.weather_info, now)) {
    try {
      const freshW = await fetchWeatherAndPressure(env, workBoundary.workMode === 'commute');
      if (freshW && freshW.weatherInfo) {
        memory.weather_info = freshW.weatherInfo;
        memory.pressure_alert = freshW.pressureAlert;
        await Promise.all([
          setMemoryValue(env, 'weather_info', freshW.weatherInfo),
          setMemoryValue(env, 'pressure_alert', freshW.pressureAlert)
        ]);
        mirrorEvents.push(
          { type: 'set_memory', key: 'weather_info', value: freshW.weatherInfo },
          { type: 'set_memory', key: 'pressure_alert', value: freshW.pressureAlert }
        );
        fastState.weatherFetchedAt = formatJstIso(now);
        refreshBriefingWeatherLine(
          fastState,
          memory.weather_info,
          memory.pressure_alert,
          workBoundary.workMode
        );
        stateDirty = true;
      }
    } catch (wErr) {
      console.warn('Bootstrap 天気更新警告:', wErr instanceof Error ? wErr.message : String(wErr));
    }
  }

  // 日跨ぎ・天気鮮度チェックの後にリビジョン一致を判定（天気・日付更新のスキップを防止）
  if (
    !force &&
    !stateDirty &&
    clientRevision > 0 &&
    Number(fastState.revision) === clientRevision &&
    fastState.dailyBriefing &&
    fastState.dailyBriefing.dateKey === fastState.dayKey &&
    fastState.aiDeck &&
    Array.isArray(fastState.aiDeck.cards) &&
    fastState.aiDeck.cards.length > 0
  ) {
    return {
      authorized: true,
      unchanged: true,
      revision: fastState.revision,
      deltaText: buildDeltaText(fastState.lastAction, now)
    };
  }

  const [lists, todayLogs] = await Promise.all([
    buildListsSnapshot(env, memory, now),
    getLogicalTodayLogs(env, now)
  ]);

  if (!fastState.dailyBriefing || fastState.dailyBriefing.dateKey !== fastState.dayKey) {
    const uncompletedTasks = lists.tasks.filter((t) => !t.done && t.status !== '完了');
    fastState.dailyBriefing = buildDailyBriefingObj(
      memory.weather_info,
      memory.pressure_alert,
      workBoundary.workMode,
      workBoundary.todayEvents,
      uncompletedTasks,
      todayStr,
      now
    );
    stateDirty = true;
  }

  if (
    !fastState.aiDeck ||
    !Array.isArray(fastState.aiDeck.cards) ||
    fastState.aiDeck.cards.length === 0
  ) {
    fastState.aiDeck = await generateAiDeck(env, {
      reason: 'bootstrap_fallback',
      now,
      memory,
      fastState,
      workMode: workBoundary.workMode,
      todayEvents: workBoundary.todayEvents,
      boundaryInfo: workBoundary.boundaryInfo,
      tasks: lists.tasks,
      stock: lists.stock,
      todayLogsText: buildCondensedLogsFromArray(todayLogs),
      useFlashModel: false
    });
    stateDirty = true;
  }

  fastState.listCache = lists;
  if (stateDirty) {
    await saveFastState(env, fastState);
    mirrorEvents.push({ type: 'sync_snapshot' });
  }
  if (mirrorEvents.length > 0) {
    ctx.waitUntil(mirrorToSheets(env, mirrorEvents));
  }

  const deck = composeHomeDeck(workBoundary.workMode, now, fastState);
  const weatherLine = formatWeatherLineForHome(
    memory.weather_info,
    memory.pressure_alert,
    workBoundary.workMode
  );
  const chatMessages = buildChatMessagesFromLogs(todayLogs);

  return {
    authorized: true,
    state: fastState,
    deck,
    boundary: workBoundary.heroBoundary,
    workMode: workBoundary.workMode,
    isHoliday: workBoundary.isHoliday,
    weatherLine,
    weatherInfo: memory.weather_info || '',
    pressureAlert: memory.pressure_alert || 'FALSE',
    deltaText: buildDeltaText(fastState.lastAction, now),
    lists,
    chatMessages
  };
}

export async function apiStartAction(
  env: Env,
  ctx: ExecutionContext,
  authKey: string,
  cardPayload?: Record<string, any>
) {
  if (!verifyDashboardAccess(env, authKey)) {
    return unauthorizedPayload();
  }

  const now = new Date();
  const nowStr = formatJstDateTime(now);
  const nowIso = formatJstIso(now);
  const fastState = await loadFastState(env, now);

  if (!cardPayload || !cardPayload.title) {
    fastState.activeSession = null;
    await saveFastState(env, fastState);
    ctx.waitUntil(mirrorToSheets(env, [{ type: 'sync_snapshot' }]));
    return { authorized: true, state: fastState };
  }

  const session = buildActiveSessionFromPayload(cardPayload, now, nowIso);
  fastState.activeSession = session;
  if (fastState.dailyBriefing) {
    fastState.dailyBriefing.dismissed = true;
  }

  const [memory, workBoundary] = await Promise.all([
    getMemory(env),
    getWorkModeAndBoundary(env, now)
  ]);

  const mirrorEvents: MirrorEvent[] = [];

  if (session.isSleepCard) {
    const logEntry: LogEntry = {
      timestampStr: nowStr,
      sender: 'user',
      message: 'これから寝ます（おやすみ）',
      imageUrl: '',
      aiReply: '[スタンプ: 🌙]\nおやすみなさい。良い睡眠を。'
    };
    try {
      await appendLog(env, logEntry);
      mirrorEvents.push({ type: 'append_log', entry: logEntry });
    } catch (logErr) {
      console.error('就寝開始ログ追記エラー:', logErr instanceof Error ? logErr.message : String(logErr));
    }
  } else if (!session.isWorkBlock) {
    const [tasks, stock, todayLogs] = await Promise.all([
      getTasks(env, '未完了'),
      getInputStockList(env, '未'),
      getLogicalTodayLogs(env, now)
    ]);
    fastState.aiDeck = await generateAiDeck(env, {
      reason: 'start_action',
      now,
      memory,
      fastState,
      workMode: workBoundary.workMode,
      todayEvents: workBoundary.todayEvents,
      boundaryInfo: workBoundary.boundaryInfo,
      tasks,
      stock,
      todayLogsText: buildCondensedLogsFromArray(todayLogs),
      startedCard: session,
      useFlashModel: false
    });
  }

  await saveFastState(env, fastState);
  mirrorEvents.push({ type: 'sync_snapshot' });
  ctx.waitUntil(mirrorToSheets(env, mirrorEvents));

  const deck = composeHomeDeck(workBoundary.workMode, now, fastState);

  return {
    authorized: true,
    state: fastState,
    activeSession: fastState.activeSession,
    aiDeck: fastState.aiDeck,
    deck,
    boundary: workBoundary.heroBoundary
  };
}

export async function apiPausedSession(
  env: Env,
  ctx: ExecutionContext,
  authKey: string,
  payload: Record<string, any> | null
) {
  if (!verifyDashboardAccess(env, authKey)) {
    return unauthorizedPayload();
  }
  const now = new Date();
  const fastState = await loadFastState(env, now);
  const p = payload && typeof payload === 'object' ? payload : {};
  fastState.pausedSession = p.pausedSession ? (p.pausedSession as any) : null;
  if (Object.prototype.hasOwnProperty.call(p, 'activeSession')) {
    fastState.activeSession = p.activeSession ? (p.activeSession as any) : null;
  }
  await saveFastState(env, fastState);
  ctx.waitUntil(mirrorToSheets(env, [{ type: 'sync_snapshot' }]));
  return { authorized: true, state: fastState };
}

export async function apiCompleteAction(
  env: Env,
  ctx: ExecutionContext,
  authKey: string,
  completePayload?: Record<string, any>
) {
  if (!verifyDashboardAccess(env, authKey)) {
    return unauthorizedPayload();
  }

  const p = completePayload || {};
  const clientOpId = String(p.clientOpId || '').trim();
  const now = new Date();
  const nowStr = formatJstDateTime(now);
  const nowIso = formatJstIso(now);
  const logicalDayStr = getLogicalDayKey(now);
  const fastState = await loadFastState(env, now);

  if (clientOpId) {
    const claimRes = await env.DB.prepare(
      'INSERT OR IGNORE INTO processed_ops (op_id, processed_at) VALUES (?, ?)'
    )
      .bind(clientOpId, nowIso)
      .run();
    if ((claimRes.meta?.changes ?? 0) === 0) {
      const [memoryDup, workBoundaryDup] = await Promise.all([
        getMemory(env),
        getWorkModeAndBoundary(env, now)
      ]);
      const listsDup =
        fastState.listCache || (await buildListsSnapshot(env, memoryDup, now));
      return {
        authorized: true,
        duplicateSkipped: true,
        state: fastState,
        deck: composeHomeDeck(workBoundaryDup.workMode, now, fastState),
        lists: listsDup,
        boundary: workBoundaryDup.heroBoundary
      };
    }
  }

  let execResult: Awaited<ReturnType<typeof executeCompleteSessionCore>>;
  try {
    execResult = await executeCompleteSessionCore(
      env,
      fastState,
      p,
      now,
      nowStr,
      nowIso,
      logicalDayStr,
      0
    );
  } catch (err) {
    if (clientOpId) {
      await env.DB.prepare('DELETE FROM processed_ops WHERE op_id = ?').bind(clientOpId).run().catch(() => {});
    }
    throw err;
  }

  const { notices, addedChatMessage, mirrorEvents } = execResult;

  const memory = await getMemory(env);
  const [lists, workBoundary] = await Promise.all([
    buildListsSnapshot(env, memory, now),
    getWorkModeAndBoundary(env, now)
  ]);

  fastState.listCache = lists;
  await saveFastState(env, fastState);

  mirrorEvents.push({ type: 'sync_snapshot' });
  ctx.waitUntil(mirrorToSheets(env, mirrorEvents));

  const deck = composeHomeDeck(workBoundary.workMode, now, fastState);

  return {
    authorized: true,
    state: fastState,
    deck,
    lists,
    boundary: workBoundary.heroBoundary,
    deltaText: buildDeltaText(fastState.lastAction, now),
    notices,
    addedChatMessage
  };
}

export async function apiDismissCardToday(
  env: Env,
  ctx: ExecutionContext,
  authKey: string,
  cardId?: string,
  cardTitle?: string
) {
  if (!verifyDashboardAccess(env, authKey)) {
    return unauthorizedPayload();
  }

  const now = new Date();
  const fastState = await loadFastState(env, now);

  if (cardId) {
    const cleanTitle = cardTitle && String(cardTitle).trim() ? String(cardTitle).trim() : '';
    fastState.dismissedToday[String(cardId)] = cleanTitle || true;
    if (cardId === '__briefing__' && fastState.dailyBriefing) {
      fastState.dailyBriefing.dismissed = true;
    }
    await saveFastState(env, fastState);
    ctx.waitUntil(mirrorToSheets(env, [{ type: 'sync_snapshot' }]));
  }

  const workBoundary = await getWorkModeAndBoundary(env, now);
  const deck = composeHomeDeck(workBoundary.workMode, now, fastState);

  return {
    authorized: true,
    state: fastState,
    deck
  };
}

export async function apiMutateListItem(
  env: Env,
  ctx: ExecutionContext,
  authKey: string,
  mutation?: Record<string, any>
) {
  if (!verifyDashboardAccess(env, authKey)) {
    return unauthorizedPayload();
  }

  const m = mutation || {};
  const listType = String(m.listType || 'shopping');
  if (listType === 'shopping' && m.action === 'toggle' && m.rowIndex) {
    await toggleShoppingItemById(env, Number(m.rowIndex), Boolean(m.done));
  } else {
    throw new Error('未対応のリスト操作です。');
  }

  const now = new Date();
  const [fastState, memory] = await Promise.all([loadFastState(env, now), getMemory(env)]);
  const lists = await buildListsSnapshot(env, memory, now);
  fastState.listCache = lists;
  await saveFastState(env, fastState);
  ctx.waitUntil(mirrorToSheets(env, [{ type: 'sync_snapshot' }]));

  return {
    authorized: true,
    lists
  };
}

export async function apiFlushOutboxBatch(
  env: Env,
  ctx: ExecutionContext,
  authKey: string,
  ops?: Array<{ id?: string; funcName?: string; payload?: any }>
) {
  if (!verifyDashboardAccess(env, authKey)) {
    return unauthorizedPayload();
  }

  const operations = Array.isArray(ops) ? ops : [];
  const now = new Date();
  const nowStr = formatJstDateTime(now);
  const nowIso = formatJstIso(now);
  const logicalDayStr = getLogicalDayKey(now);

  const [fastState, memory, workBoundary] = await Promise.all([
    loadFastState(env, now),
    getMemory(env),
    getWorkModeAndBoundary(env, now)
  ]);

  const results: Array<{ id: string; ok: boolean; duplicateSkipped?: boolean; error?: string }> = [];
  const addedChatMessages: Array<ReturnType<typeof buildChatLogEntryObject>> = [];
  const mirrorEvents: MirrorEvent[] = [];
  let needAiDeckForActive = false;

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i] || {};
    const opId = String(op.id || (op.payload && op.payload.clientOpId) || '').trim();
    const funcName = String(op.funcName || '').trim();
    const p = op.payload;

    try {
      if (opId && (await isOpProcessed(env, opId))) {
        results.push({ id: opId, ok: true, duplicateSkipped: true });
        continue;
      }

      if (funcName === 'apiStartAction' || funcName === 'start_action') {
        if (!p || !p.title) {
          fastState.activeSession = null;
          needAiDeckForActive = false;
        } else {
          const session = buildActiveSessionFromPayload(p, now, nowIso);
          fastState.activeSession = session;
          if (fastState.dailyBriefing) {
            fastState.dailyBriefing.dismissed = true;
          }
          if (session.isSleepCard) {
            const logEntry: LogEntry = {
              timestampStr: nowStr,
              sender: 'user',
              message: 'これから寝ます（おやすみ）',
              imageUrl: '',
              aiReply: '[スタンプ: 🌙]\nおやすみなさい。良い睡眠を。'
            };
            await appendLog(env, logEntry);
            mirrorEvents.push({ type: 'append_log', entry: logEntry });
            needAiDeckForActive = false;
          } else {
            needAiDeckForActive = !session.isWorkBlock;
          }
        }
        if (opId) await markOpProcessed(env, opId);
        results.push({ id: opId, ok: true });
      } else if (funcName === 'apiCompleteAction' || funcName === 'complete_action') {
        const cp = (p && typeof p === 'object' ? p : {}) as Record<string, any>;
        const completed = await executeCompleteSessionCore(
          env,
          fastState,
          cp,
          now,
          nowStr,
          nowIso,
          logicalDayStr,
          i
        );
        needAiDeckForActive = false;
        addedChatMessages.push(completed.addedChatMessage);
        mirrorEvents.push(...completed.mirrorEvents);
        if (opId) await markOpProcessed(env, opId);
        results.push({ id: opId, ok: true });
      } else if (funcName === 'apiDismissCardToday' || funcName === 'dismiss_card') {
        const dp = (p && typeof p === 'object' ? p : {}) as Record<string, any>;
        const cid = String(dp.cardId || '').trim();
        if (cid) {
          const cleanTitle = dp.cardTitle && String(dp.cardTitle).trim() ? String(dp.cardTitle).trim() : '';
          fastState.dismissedToday[cid] = cleanTitle || true;
          if (cid === '__briefing__' && fastState.dailyBriefing) {
            fastState.dailyBriefing.dismissed = true;
          }
        }
        if (opId) await markOpProcessed(env, opId);
        results.push({ id: opId, ok: true });
      } else if (funcName === 'apiMutateListItem' || funcName === 'mutate_list') {
        const mp = (p && typeof p === 'object' ? p : {}) as Record<string, any>;
        const listType = String(mp.listType || 'shopping');
        if (listType === 'shopping' && mp.action === 'toggle' && mp.rowIndex) {
          await toggleShoppingItemById(env, Number(mp.rowIndex), Boolean(mp.done));
        } else {
          throw new Error('未対応のリスト操作です。');
        }
        if (opId) await markOpProcessed(env, opId);
        results.push({ id: opId, ok: true });
      } else if (funcName === 'apiPausedSession' || funcName === 'paused_session') {
        const pp = (p && typeof p === 'object' ? p : {}) as Record<string, any>;
        fastState.pausedSession = pp.pausedSession ? (pp.pausedSession as any) : null;
        if (Object.prototype.hasOwnProperty.call(pp, 'activeSession')) {
          fastState.activeSession = pp.activeSession ? (pp.activeSession as any) : null;
        }
        mirrorEvents.push({ type: 'sync_snapshot' });
        if (opId) await markOpProcessed(env, opId);
        results.push({ id: opId, ok: true });
      } else {
        results.push({
          id: opId,
          ok: false,
          error: 'Unsupported batch operation: ' + funcName
        });
      }
    } catch (opErr) {
      console.error(
        `apiFlushOutboxBatch op エラー (${funcName}):`,
        opErr instanceof Error ? opErr.message : String(opErr)
      );
      results.push({
        id: opId,
        ok: false,
        error: opErr instanceof Error ? opErr.message : String(opErr)
      });
    }
  }

  const latestMemory = await getMemory(env);
  const [lists, todayLogs] = await Promise.all([
    buildListsSnapshot(env, latestMemory, now),
    needAiDeckForActive ? getLogicalTodayLogs(env, now) : Promise.resolve([])
  ]);

  if (fastState.activeSession && needAiDeckForActive) {
    try {
      fastState.aiDeck = await generateAiDeck(env, {
        reason: 'start_action',
        now,
        memory: latestMemory,
        fastState,
        workMode: workBoundary.workMode,
        todayEvents: workBoundary.todayEvents,
        boundaryInfo: workBoundary.boundaryInfo,
        tasks: lists.tasks,
        stock: lists.stock,
        todayLogsText: buildCondensedLogsFromArray(todayLogs),
        startedCard: fastState.activeSession,
        useFlashModel: false
      });
    } catch (deckErr) {
      console.error(
        'apiFlushOutboxBatch aiDeck エラー:',
        deckErr instanceof Error ? deckErr.message : String(deckErr)
      );
    }
  }

  fastState.listCache = lists;
  await saveFastState(env, fastState);

  mirrorEvents.push({ type: 'sync_snapshot' });
  ctx.waitUntil(mirrorToSheets(env, mirrorEvents));

  const deck = composeHomeDeck(workBoundary.workMode, now, fastState);

  return {
    authorized: true,
    results,
    state: fastState,
    deck,
    lists,
    boundary: workBoundary.heroBoundary,
    deltaText: buildDeltaText(fastState.lastAction, now),
    addedChatMessages
  };
}

export async function apiRefreshDeck(
  env: Env,
  ctx: ExecutionContext,
  authKey: string,
  excludeIds?: string[]
) {
  if (!verifyDashboardAccess(env, authKey)) {
    return unauthorizedPayload();
  }

  const now = new Date();
  const [fastState, memory, workBoundary, todayLogs] = await Promise.all([
    loadFastState(env, now),
    getMemory(env),
    getWorkModeAndBoundary(env, now),
    getLogicalTodayLogs(env, now)
  ]);

  const lists = await buildListsSnapshot(env, memory, now);

  const existingTitles =
    fastState.aiDeck && Array.isArray(fastState.aiDeck.cards)
      ? fastState.aiDeck.cards.map((c) => c.title)
      : [];
  const excludes = (Array.isArray(excludeIds) ? excludeIds : []).concat(existingTitles);

  const freshDeck = await generateAiDeck(env, {
    reason: 'refresh',
    now,
    memory,
    fastState,
    workMode: workBoundary.workMode,
    todayEvents: workBoundary.todayEvents,
    boundaryInfo: workBoundary.boundaryInfo,
    tasks: lists.tasks,
    stock: lists.stock,
    todayLogsText: buildCondensedLogsFromArray(todayLogs),
    excludeTitles: excludes,
    useFlashModel: false
  });

  const excludeSet: Record<string, boolean> = {};
  (Array.isArray(excludeIds) ? excludeIds : []).forEach((id) => {
    excludeSet[String(id)] = true;
  });

  const oldKept = ((fastState.aiDeck && fastState.aiDeck.cards) || []).filter(
    (c) => c && !excludeSet[c.id]
  );
  const seen: Record<string, boolean> = {};
  const mergedCards = [];
  for (const c of freshDeck.cards.concat(oldKept)) {
    if (c && c.id && !seen[c.id]) {
      seen[c.id] = true;
      mergedCards.push(c);
    }
  }

  fastState.aiDeck = {
    generatedAt: freshDeck.generatedAt,
    cards: mergedCards,
    lowCards:
      freshDeck.lowCards && freshDeck.lowCards.length > 0
        ? freshDeck.lowCards
        : (fastState.aiDeck && fastState.aiDeck.lowCards) || []
  };

  await saveFastState(env, fastState);
  ctx.waitUntil(mirrorToSheets(env, [{ type: 'sync_snapshot' }]));

  const deck = composeHomeDeck(workBoundary.workMode, now, fastState);

  return {
    authorized: true,
    aiDeck: fastState.aiDeck,
    deck
  };
}

export async function apiImportFromSheets(
  env: Env,
  _ctx: ExecutionContext,
  authKey: string
) {
  if (!verifyDashboardAccess(env, authKey)) {
    return unauthorizedPayload();
  }

  const { imported } = await importAllFromSheets(env);
  return {
    authorized: true,
    imported
  };
}

// =============================================================================
// 3. Internal Batch Endpoints (深夜バッチ連携)
// =============================================================================

function verifyInternalSecret(env: Env, request: Request): boolean {
  const expected = String(env.INTERNAL_API_SECRET || '').trim();
  const actual = String(request.headers.get('X-Internal-Secret') || '').trim();
  return Boolean(expected && actual && expected === actual);
}

export async function handleInternalExportDay(
  env: Env,
  request: Request
): Promise<Response> {
  if (!verifyInternalSecret(env, request)) {
    return jsonResponse({ ok: false, error: 'Unauthorized internal request' }, 401);
  }

  try {
    const now = new Date();
    const dayKey = getLogicalDayKey(now);

    const [fastState, memory, logs, tasks, routines, shopping, inputStock] = await Promise.all([
      loadFastState(env, now),
      getMemory(env),
      getLogicalTodayLogs(env, now),
      getTasks(env),
      getRoutines(env),
      getShoppingList(env),
      getInputStockList(env)
    ]);

    return jsonResponse({
      ok: true,
      data: {
        dayKey,
        exportedAt: formatJstIso(now),
        fastState,
        memory,
        logs,
        tasks,
        routines,
        shopping,
        inputStock
      }
    });
  } catch (err) {
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      500
    );
  }
}

export async function handleInternalSyncMemory(
  env: Env,
  request: Request
): Promise<Response> {
  if (!verifyInternalSecret(env, request)) {
    return jsonResponse({ ok: false, error: 'Unauthorized internal request' }, 401);
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      memoryUpdates?: Record<string, string>;
      routineUpdates?: Array<{
        id?: number;
        title?: string;
        last_generated_at?: string;
        status?: string;
        completed_at?: string;
        memo?: string;
      }>;
      newTasks?: Array<{
        id: string;
        title: string;
        due_date?: string;
        status?: string;
        created_at?: string;
        completed_at?: string;
        memo?: string;
        remind_context?: string;
        doc_url?: string;
        estimated_mins?: number;
      }>;
      fastStateUpdates?: Partial<FastState>;
    };

    const updatedMemoryKeys: string[] = [];
    const mirrorEvents: MirrorEvent[] = [];

    if (body.memoryUpdates && typeof body.memoryUpdates === 'object') {
      for (const [k, v] of Object.entries(body.memoryUpdates)) {
        const key = String(k || '').trim();
        if (!key) continue;
        const val = String(v ?? '');
        await setMemoryValue(env, key, val);
        updatedMemoryKeys.push(key);
        mirrorEvents.push({ type: 'set_memory', key, value: val });
      }
    }

    let updatedRoutines = 0;
    if (Array.isArray(body.routineUpdates)) {
      for (const r of body.routineUpdates) {
        if (!r || (!r.id && !r.title)) continue;
        const fields: string[] = [];
        const binds: unknown[] = [];

        if (r.last_generated_at !== undefined) {
          fields.push('last_generated_at = ?');
          binds.push(String(r.last_generated_at));
        }
        if (r.status !== undefined) {
          fields.push('status = ?');
          binds.push(String(r.status));
        }
        if (r.completed_at !== undefined) {
          fields.push('completed_at = ?');
          binds.push(String(r.completed_at));
        }
        if (r.memo !== undefined) {
          fields.push('memo = ?');
          binds.push(String(r.memo));
        }

        if (fields.length === 0) continue;

        if (r.id) {
          binds.push(Number(r.id));
          await env.DB.prepare(`UPDATE routines SET ${fields.join(', ')} WHERE id = ?`)
            .bind(...binds)
            .run();
        } else if (r.title) {
          binds.push(String(r.title).trim());
          await env.DB.prepare(`UPDATE routines SET ${fields.join(', ')} WHERE title = ?`)
            .bind(...binds)
            .run();
        }
        updatedRoutines++;
      }
    }

    let insertedTasks = 0;
    if (Array.isArray(body.newTasks)) {
      for (const t of body.newTasks) {
        if (!t || !t.id || !t.title) continue;
        await env.DB.prepare(
          `INSERT OR IGNORE INTO tasks (id, title, due_date, status, created_at, completed_at, memo, remind_context, doc_url, estimated_mins)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            String(t.id),
            String(t.title),
            String(t.due_date || ''),
            String(t.status || '未完了'),
            String(t.created_at || ''),
            String(t.completed_at || ''),
            String(t.memo || ''),
            String(t.remind_context || ''),
            String(t.doc_url || ''),
            Number(t.estimated_mins) > 0 ? Number(t.estimated_mins) : 30
          )
          .run();
        insertedTasks++;
      }
      if (insertedTasks > 0) {
        mirrorEvents.push({ type: 'sync_snapshot' });
      }
    }

    if (body.fastStateUpdates && typeof body.fastStateUpdates === 'object') {
      const fastState = await loadFastState(env);
      const preservedSleepSession =
        fastState.activeSession && fastState.activeSession.isSleepCard
          ? fastState.activeSession
          : null;
      Object.assign(fastState, body.fastStateUpdates);
      if (preservedSleepSession && !fastState.activeSession) {
        fastState.activeSession = preservedSleepSession;
      }
      const { state: normalized } = ensureLogicalDayBoundary(fastState);
      await saveFastState(env, normalized);
      mirrorEvents.push({ type: 'sync_snapshot' });
    }

    if (mirrorEvents.length > 0) {
      await mirrorToSheets(env, mirrorEvents);
    }

    return jsonResponse({
      ok: true,
      data: {
        updatedMemoryKeys,
        updatedRoutines,
        insertedTasks,
        syncedAt: formatJstIso()
      }
    });
  } catch (err) {
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      500
    );
  }
}

export async function handleScheduledCron(
  event: ScheduledEvent,
  env: Env,
  _ctx: ExecutionContext
): Promise<void> {
  const now = new Date();
  const cron = String(event?.cron || '');
  console.log(`[Cron] Triggered: ${cron} at ${formatJstIso(now)}`);

  try {
    const [fastState, memory, workBoundary] = await Promise.all([
      loadFastState(env, now),
      getMemory(env),
      getWorkModeAndBoundary(env, now)
    ]);
    const mirrorEvents: MirrorEvent[] = [];

    if (cron === '0 20 * * *') {
      // 05:00 JST: 天気・気圧定期更新バッチ
      const isCommuteDay = workBoundary.workMode === 'commute';
      const freshW = await fetchWeatherAndPressure(env, isCommuteDay);
      if (freshW && freshW.weatherInfo) {
        await Promise.all([
          setMemoryValue(env, 'weather_info', freshW.weatherInfo),
          setMemoryValue(env, 'pressure_alert', freshW.pressureAlert)
        ]);
        fastState.weatherFetchedAt = formatJstIso(now);
        refreshBriefingWeatherLine(
          fastState,
          freshW.weatherInfo,
          freshW.pressureAlert,
          workBoundary.workMode
        );
        await saveFastState(env, fastState);
        mirrorEvents.push(
          { type: 'set_memory', key: 'weather_info', value: freshW.weatherInfo },
          { type: 'set_memory', key: 'pressure_alert', value: freshW.pressureAlert },
          { type: 'sync_snapshot' }
        );
      }
    } else if (cron === '0 8 * * *') {
      // 17:00 JST: 夜シフト定期再編成バッチ
      const [lists, todayLogs] = await Promise.all([
        buildListsSnapshot(env, memory, now),
        getLogicalTodayLogs(env, now)
      ]);
      fastState.aiDeck = await generateAiDeck(env, {
        reason: 'evening_batch',
        now,
        memory,
        fastState,
        workMode: workBoundary.workMode,
        todayEvents: workBoundary.todayEvents,
        boundaryInfo: workBoundary.boundaryInfo,
        tasks: lists.tasks,
        stock: lists.stock,
        todayLogsText: buildCondensedLogsFromArray(todayLogs),
        useFlashModel: false
      });
      fastState.listCache = lists;
      await saveFastState(env, fastState);
      mirrorEvents.push({ type: 'sync_snapshot' });
    }

    if (mirrorEvents.length > 0) {
      await mirrorToSheets(env, mirrorEvents);
    }
    await drainMirrorQueue(env);

    // D1 容量 400MB 到達アラートチェック
    try {
      const pageCountRes = await env.DB.prepare('PRAGMA page_count').first<{ page_count: number }>();
      const pageSizeRes = await env.DB.prepare('PRAGMA page_size').first<{ page_size: number }>();
      const dbBytes = Number(pageCountRes?.page_count || 0) * Number(pageSizeRes?.page_size || 0);
      const limitBytes = 400 * 1024 * 1024;
      if (dbBytes >= limitBytes) {
        const mb = (dbBytes / (1024 * 1024)).toFixed(1);
        const warnLine = `⚠️ D1容量が400MBを超えました（現在 ${mb}MB / 上限 500MB）。ログ整理をご検討ください`;
        console.warn('[Cron] ' + warnLine);
        const fsNow = await loadFastState(env, now);
        if (fsNow.dailyBriefing && Array.isArray(fsNow.dailyBriefing.lines) && !fsNow.dailyBriefing.lines.includes(warnLine)) {
          fsNow.dailyBriefing.lines.unshift(warnLine);
          fsNow.dailyBriefing.dismissed = false;
          await saveFastState(env, fsNow);
        }
      }
    } catch (sizeErr) {
      console.warn('[Cron] D1 size check warning:', sizeErr instanceof Error ? sizeErr.message : String(sizeErr));
    }
  } catch (err) {
    console.error('[Cron] Execution error:', err instanceof Error ? err.message : String(err));
  }
}
