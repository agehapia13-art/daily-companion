/**
 * DeckEngine.js - v2 状況適応型行動デッキ（Home カード）＆ 朝ブリーフィング生成エンジン
 * 固定スロットを排し、GRAND_DESIGN と memory.prompt_deck / lifestyle_habits に基づき
 * 通常候補（cards: 6〜9件 + 引き算カード）と低負荷予備（low_cards: 3〜5件）を同時編成する
 */

const DECK_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    cards: {
      type: 'ARRAY',
      description: '現在の状況・次の時間帯に適した行動カード候補（優先度順に6〜9件）',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING', description: '一意のID（タスク/ストック連動時は対象IDまたは短い英数字ID）' },
          title: { type: 'STRING', description: 'カードの短いタイトル（18文字以内目安）' },
          sub: { type: 'STRING', description: '着手摩擦を下げる短い補足1行（24文字以内目安）' },
          mins: { type: 'INTEGER', description: '見込み所要時間（分）' },
          icon: {
            type: 'STRING',
            enum: ['coffee', 'utensils', 'droplets', 'droplet', 'book', 'music', 'walk', 'wind', 'users', 'cart', 'sparkles', 'checkCircle', 'sliders', 'compass', 'home', 'message']
          },
          linkedType: { type: 'STRING', enum: ['none', 'task', 'stock', 'habit'] },
          linkedId: { type: 'STRING', description: 'taskId / stockタイトル / habit項目名（なければ空文字）' },
          cycleStampLabel: { type: 'STRING', description: '完了時に更新すべき cycle_stamps 項目名（なければ空文字）' },
          isTriage: { type: 'BOOLEAN', description: '引き算（荷下ろし）提案カードなら true' },
          rightLabel: { type: 'STRING', description: 'isTriage=true 時のみ短いラベル（例: 引き算）' },
          triageTaskIds: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: 'isTriage=true 時に翌日へリスケ対象とするタスクID配列'
          }
        },
        required: ['id', 'title', 'sub', 'mins', 'icon', 'linkedType', 'linkedId', 'isTriage']
      }
    },
    low_cards: {
      type: 'ARRAY',
      description: '「少しだるい」押下時用の極小負荷カード（現在の時間帯・場所・体調に合う3〜5件）',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          title: { type: 'STRING' },
          sub: { type: 'STRING' },
          mins: { type: 'INTEGER' },
          icon: {
            type: 'STRING',
            enum: ['coffee', 'wind', 'home', 'droplet', 'book', 'music', 'sparkles', 'compass']
          },
          linkedType: { type: 'STRING', enum: ['none', 'task', 'stock', 'habit'] },
          linkedId: { type: 'STRING' }
        },
        required: ['id', 'title', 'sub', 'mins', 'icon']
      }
    }
  },
  required: ['cards', 'low_cards']
};

// getDefaultPromptDeck() は src/Prompts.js にて一元管理

/**
 * 朝ブリーフィングオブジェクトを構築
 * @param {string} weatherInfo
 * @param {string} pressureAlert
 * @param {string} workMode
 * @param {Array<string>} todayEvents
 * @param {Array<Object>} uncompletedTasks
 * @param {string} todayStr
 * @return {Object}
 */
function buildDailyBriefingObj(weatherInfo, pressureAlert, workMode, todayEvents, uncompletedTasks, todayStr) {
  const weatherLine = formatWeatherLineForHome(weatherInfo, pressureAlert, workMode);
  const pressureTxt = pressureAlert === 'TRUE' ? '⚠️ 気圧急降下注意' : '気圧は安定';

  let scheduleTxt = '本日の固定予定なし';
  if (todayEvents && todayEvents.length > 0) {
    scheduleTxt = '予定: ' + todayEvents.slice(0, 3).join(' / ');
  } else if (workMode === 'commute') {
    scheduleTxt = '予定: 10:00〜19:00 出社';
  } else if (workMode === 'remote') {
    scheduleTxt = '予定: 10:00〜19:00 リモートワーク';
  }

  const urgent = (uncompletedTasks || []).filter(t => t.dueDate && t.dueDate <= todayStr);
  const prio = (uncompletedTasks || []).filter(t => (!t.dueDate || t.dueDate > todayStr) && /最優先|優先/.test((t.remindContext || '') + (t.memo || '')));
  const pick = urgent.concat(prio).slice(0, 2);

  const lines = [`${pressureTxt} · ${scheduleTxt}`];
  if (pick.length > 0) {
    const names = pick.map(t => String(t.title || '').replace(/^\[[^\]]+\]\s*/, '')).join(' / ');
    lines.push((urgent.length > 0 ? '期限: ' : '優先: ') + names);
  } else if (weatherLine) {
    lines.push(weatherLine);
  }

  return {
    dateKey: getLogicalDayKey(),
    kicker: '今朝のブリーフィング',
    lines: lines,
    dismissed: false
  };
}

/**
 * AI デッキ生成が利用できない場合の安全なフォールバック候補組み立て
 * @private
 */
function buildFallbackAiDeck_(uncompletedTasks, pendingInput, habits, todayStr) {
  const cards = [];
  const sortedTasks = sortTasksByUrgency_(uncompletedTasks || [], todayStr);
  for (let i = 0; i < Math.min(3, sortedTasks.length); i++) {
    const t = sortedTasks[i];
    const clean = String(t.title || '').replace(/^\[[^\]]+\]\s*/, '').trim();
    cards.push({
      id: t.id,
      title: clean.length > 22 ? clean.substring(0, 22) + '…' : clean,
      sub: t.dueDate ? (t.dueDate <= todayStr ? '本日・直近の期限' : `期限: ${t.dueDate}`) : (t.remindContext || '手元の未完了タスク'),
      mins: t.estimatedMins || 30,
      icon: /お出かけ/.test(t.title) ? 'compass' : (/制作|創作/.test(t.title) ? 'music' : 'checkCircle'),
      linkedType: 'task',
      linkedId: t.id,
      cycleStampLabel: '',
      isTriage: false,
      triageTaskIds: []
    });
  }
  for (let j = 0; j < Math.min(2, (pendingInput || []).length); j++) {
    const s = pendingInput[j];
    cards.push({
      id: 'INPUT_' + s.rowIndex,
      title: s.title,
      sub: `${s.type || 'ストック'} · 少しずつ消化`,
      mins: s.estimatedMins || 20,
      icon: s.type === '音楽' ? 'music' : 'book',
      linkedType: 'stock',
      linkedId: s.title,
      cycleStampLabel: '',
      isTriage: false,
      triageTaskIds: []
    });
  }
  for (let k = 0; k < Math.min(2, (habits || []).length); k++) {
    const h = habits[k];
    if (h.stampedToday) continue;
    cards.push({
      id: h.id,
      title: h.title,
      sub: h.elapsed + ' · リズムを整える',
      mins: h.mins || 20,
      icon: /運動|散歩/.test(h.title) ? 'wind' : (/ピアノ|ギター|音楽|DTM/.test(h.title) ? 'music' : 'sparkles'),
      linkedType: 'habit',
      linkedId: h.title,
      cycleStampLabel: h.title,
      isTriage: false,
      triageTaskIds: []
    });
  }
  return {
    generatedAt: Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss+09:00"),
    cards: cards,
    lowCards: getFallbackLowCards_()
  };
}

/**
 * Gemini を使って現在の状況・終了見込み時刻に適応した aiDeck (cards + lowCards) を生成
 * @param {Object=} opts
 *   - reason: 'midnight_init' | 'evening_batch' | 'start_action' | 'refresh' | 'chat_update' | 'bootstrap_fallback'
 *   - now: Date
 *   - memory: Object
 *   - fastState: Object
 *   - workMode: string
 *   - todayEvents: Array<string>
 *   - boundaryInfo: Object
 *   - startedCard: Object|null (apiStartAction時)
 *   - excludeTitles: Array<string> (refresh時)
 *   - useFlashModel: boolean
 * @return {{ cards: Array<Object>, lowCards: Array<Object>, generatedAt: string }}
 */
function generateAiDeck(opts) {
  const o = opts || {};
  const now = o.now || new Date();
  const memory = o.memory || getMemory();
  const fastState = o.fastState || loadFastState(now);
  const workBoundary = o.workMode ? null : getWorkModeAndBoundary(now, memory.profile);
  const workMode = o.workMode || (workBoundary ? workBoundary.workMode : 'remote');
  const todayEvents = o.todayEvents || (workBoundary ? workBoundary.todayEvents : getTodayEventsList(now));
  const boundaryInfo = o.boundaryInfo || (workBoundary ? workBoundary.boundaryInfo : getNextBoundaryInfo(now));

  const todayStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
  const nowStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd(E) HH:mm');
  const uncompletedTasks = getTasks('未完了');
  const pendingInput = getInputStockList('未');
  const listSnap = buildListsSnapshot(memory, now);

  // 開始中行動がある場合は「その行動が終わる見込み時刻」を基準点としてAIへ伝える
  let targetTimeContext = `現在時刻: ${nowStr}`;
  if (o.startedCard && !o.startedCard.isSleepCard) {
    const estMins = parsePositiveEstimatedMins_(o.startedCard.mins) || 30;
    const expectedEnd = new Date(now.getTime() + estMins * 60000);
    const endStr = Utilities.formatDate(expectedEnd, 'Asia/Tokyo', 'HH:mm');
    targetTimeContext =
      `現在時刻: ${nowStr}\n` +
      `【今開始した行動】: 「${o.startedCard.title}」（見込み${estMins}分 → 終了見込み時刻 ${endStr} 頃）\n` +
      `※ユーザーがこの行動を終えた「${endStr} 頃」のタイミング・残り時間に適した次の手札を編成してください。`;
  }

  const promptDeck = (memory.prompt_deck && memory.prompt_deck.trim() !== '')
    ? memory.prompt_deck.trim()
    : getDefaultPromptDeck();

  const completedKeys = Object.keys(fastState.completedToday || {});
  const dismissedKeys = Object.keys(fastState.dismissedToday || {});
  const excludeList = (o.excludeTitles || []).concat(completedKeys, dismissedKeys);

  const todayLogs = getCondensedTodayLogs('', todayStr);
  const stampsFormatted = formatCycleStampsWithElapsed_(memory.cycle_stamps || '', now);

  const anchorCards = (typeof buildRoutineAnchorCards === 'function')
    ? buildRoutineAnchorCards(workMode, now, fastState)
    : [];
  const anchorTitles = anchorCards.map(c => String(c.title || '').trim()).filter(Boolean);

  const userPrompt = [
    // --- 準静的プレフィックス（キャッシュ効率化） ---
    `【プロファイル】: ${memory.profile || ''}`,
    `【ありたい人間像】: ${memory.ideal_self || ''}`,
    `【生活習慣 (lifestyle_habits)】:\n${memory.lifestyle_habits || ''}`,
    `【スキルアップ選択肢 (skill_options)】:\n${memory.skill_options || ''}`,
    // --- 動的コンテキスト（末尾） ---
    `【生成理由】: ${o.reason || 'auto'}`,
    `【時間軸】:\n${targetTimeContext}`,
    `【勤務モード】: ${workMode}（commute=出社, remote=在宅リモート, holiday=休日）`,
    anchorTitles.length > 0 ? `【システム管理済みカード（重複生成不要）】: ${anchorTitles.join(', ')}` : '',
    (now.getHours() >= 17 && !(fastState.completedToday && fastState.completedToday.anchor_dinner) && !(fastState.dismissedToday && fastState.dismissedToday.anchor_dinner) ? '【17時以降の生活アンカー（状況に合う順で cards に配置可）】: id:"anchor_dinner" 夕食(45分)' + (!(fastState.completedToday && fastState.completedToday.anchor_bath) && !(fastState.dismissedToday && fastState.dismissedToday.anchor_bath) ? ' / id:"anchor_bath" 入浴(30分)' : '') : (!(fastState.completedToday && fastState.completedToday.anchor_bath) && !(fastState.dismissedToday && fastState.dismissedToday.anchor_bath) && now.getHours() >= 17 ? '【17時以降の生活アンカー（状況に合う順で cards に配置可）】: id:"anchor_bath" 入浴(30分)' : '')),
    `【次の予定境界】: ${boundaryInfo ? boundaryInfo.summaryText : 'なし'}`,
    `【本日の予定】: ${todayEvents && todayEvents.length > 0 ? todayEvents.join(' / ') : '登録なし'}`,
    `【天気・気圧】: ${memory.weather_info || '情報なし'} / 気圧急降下: ${memory.pressure_alert === 'TRUE' ? 'TRUE（注意）' : 'FALSE'}`,
    `【直前完了】: ${fastState.lastAction ? `${fastState.lastAction.title} (${fastState.lastAction.completedAt})` : 'なし'}`,
    `【活動・メンテナンス記録 (cycle_stamps)】:\n${stampsFormatted || 'なし'}`,
    `【未完了タスク】:\n${formatUncompletedTasksForContext(uncompletedTasks, now)}`,
    `【インプットストック(未消化)】:\n${pendingInput.map(i => `[INPUT_${i.rowIndex}][${i.type}] ${i.title} (${i.estimatedMins}分)${i.memo ? ' - ' + i.memo : ''}`).join(' / ') || 'なし'}`,
    `【直近メモリ (rolling_memory)】:\n${String(memory.rolling_memory || '').slice(-1500) || 'なし'}`,
    todayLogs ? `【本日のログ要約】:\n${todayLogs.slice(-1000)}` : '',
    excludeList.length > 0 ? `【除外・既出（本日完了/非表示/重複回避対象）】: ${excludeList.join(', ')}` : ''
  ].filter(Boolean).join('\n\n');

  const useFlash = Boolean(o.useFlashModel);
  const endpoint = useFlash ? SYSTEM_CONSTANTS.GEMINI_ENDPOINT_BASE : SYSTEM_CONSTANTS.GEMINI_35_LITE_ENDPOINT_BASE;
  const modelName = useFlash ? SYSTEM_CONSTANTS.GEMINI_MODEL : SYSTEM_CONSTANTS.GEMINI_35_LITE_MODEL;

  const payload = {
    systemInstruction: { parts: [{ text: promptDeck }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      thinkingConfig: resolveThinkingConfig_(modelName, { thinking_level: 'low' }),
      responseMimeType: 'application/json',
      responseSchema: DECK_RESPONSE_SCHEMA
    }
  };

  try {
    const res = fetchGeminiResultWithRetry(payload, endpoint);
    if (res && res.usage && typeof appendLog === 'function') {
      try {
        const u = res.usage;
        const tsStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
        const reasonLabel = o.reason || 'auto';
        appendLog(tsStr, 'system', `[DeckEngine:${reasonLabel}]`, '', '', {
          litePromptTokens: u.promptTokenCount || 0,
          liteCandidatesTokens: u.candidatesTokenCount || 0,
          liteCachedTokens: u.cachedContentTokenCount || 0,
          newTotalTokens: u.totalTokenCount || 0,
          phaseTag: `deck_${reasonLabel}`
        });
      } catch (logErr) {
        Logger.log('DeckEngine ログ追記エラー: ' + logErr.message);
      }
    }
    const parsed = JSON.parse(res.text);
    const sanitizeCard = (c, idx, isLow) => ({
      id: String(c.id || ((isLow ? 'low_' : 'ai_') + Date.now() + '_' + idx)),
      title: String(c.title || '').trim(),
      sub: String(c.sub || '').trim(),
      mins: parsePositiveEstimatedMins_(c.mins) || (isLow ? 5 : 20),
      icon: c.icon || 'compass',
      linkedType: c.linkedType || 'none',
      linkedId: String(c.linkedId || ''),
      cycleStampLabel: String(c.cycleStampLabel || ''),
      isTriage: Boolean(c.isTriage),
      rightLabel: c.isTriage ? String(c.rightLabel || '引き算') : '',
      triageTaskIds: Array.isArray(c.triageTaskIds) ? c.triageTaskIds.map(String) : []
    });

    const cards = Array.isArray(parsed.cards)
      ? parsed.cards.map((c, i) => sanitizeCard(c, i, false)).filter(c => c.title)
      : [];
    const lowCards = Array.isArray(parsed.low_cards)
      ? parsed.low_cards.map((c, i) => sanitizeCard(c, i, true)).filter(c => c.title)
      : [];

    if (cards.length === 0) {
      return buildFallbackAiDeck_(uncompletedTasks, pendingInput, listSnap.habits, todayStr);
    }

    return {
      generatedAt: Utilities.formatDate(now, 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss+09:00"),
      cards: cards,
      lowCards: lowCards.length > 0 ? lowCards : getFallbackLowCards_()
    };
  } catch (err) {
    Logger.log('generateAiDeck エラー (フォールバック使用): ' + err.message);
    if (fastState && fastState.aiDeck && Array.isArray(fastState.aiDeck.cards) && fastState.aiDeck.cards.length > 0 && o.reason !== 'refresh') {
      return fastState.aiDeck;
    }
    return buildFallbackAiDeck_(uncompletedTasks, pendingInput, listSnap.habits, todayStr);
  }
}

/**
 * 既存 aiDeck 内の天気行や、朝のブリーフィング天気表示を最新天気・気圧に更新
 * @param {Object} fastState
 * @param {string} weatherInfo
 * @param {string} pressureAlert
 * @param {string} workMode
 */
function refreshBriefingWeatherLine(fastState, weatherInfo, pressureAlert, workMode) {
  if (!fastState || !fastState.dailyBriefing || !Array.isArray(fastState.dailyBriefing.lines)) return;
  const lines = fastState.dailyBriefing.lines;
  const pressureTxt = pressureAlert === 'TRUE' ? '⚠️ 気圧急降下注意' : '気圧は安定';
  if (lines.length > 0 && /気圧/.test(lines[0])) {
    lines[0] = lines[0].replace(/^[^·]+·/, pressureTxt + ' ·');
  }
  const weatherShort = formatWeatherLineForHome(weatherInfo, pressureAlert, workMode);
  const wIdx = lines.findIndex(l => /磯子|渋谷|晴れ|曇り|雨|雪/.test(l));
  if (wIdx !== -1) {
    lines[wIdx] = weatherShort;
  } else if (lines.length < 3) {
    lines.push(weatherShort);
  }
}
