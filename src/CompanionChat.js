/**
 * CompanionChat.js - v2 Chat 1段構成＋オンデマンド2段目（Web検索 / 広域カレンダー）オーケストレータ
 * Prefix Cache 最適化済みリクエスト構築と返答/スタンプ＋アクションサニタイズを担う
 */

/**
 * オンデマンド Web検索リクエストのペイロードを構築（検索クエリ＋現在日時のみを注入）
 * @param {string} searchQuery AIが抽出した自己完結の検索質問
 * @param {Object} precomputed
 * @param {string=} fallbackUserText searchQueryが空だった場合のみの安全フォールバック
 * @return {Object}
 * @private
 */
function buildGeminiWebSearchPayload_(searchQuery, precomputed, fallbackUserText) {
  const effectiveQuery = String(searchQuery || '').trim() || String(fallbackUserText || '').trim();
  const systemPrompt =
    'あなたは事実に忠実なWeb検索リサーチャーです。\n' +
    '与えられた現在日時を時間軸の基準とし、確認したい質問・トピックについて必ず googleSearch ツールを実行して最新の一次情報を確認してください。\n' +
    '確認できた事実の要点のみを簡潔に整理して答え、確認できなかった細部は推測で補完しないでください。';

  const nowStr = (precomputed && precomputed.nowStr) ? precomputed.nowStr : '';
  const userContent =
    `【現在日時】: ${nowStr}\n` +
    `【確認したい質問・トピック】:\n${effectiveQuery}`;

  return {
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userContent }]
      }
    ],
    tools: [{ googleSearch: {} }],
    generationConfig: {
      thinkingConfig: resolveThinkingConfig_(SYSTEM_CONSTANTS.GEMINI_35_LITE_MODEL, { thinking_level: 'medium' })
    }
  };
}

/**
 * 事実質問時専用: Gemini 3.5 Flash-Lite + googleSearch で外部一次情報を取得（JSON制約なし・直交分離）
 * @param {string} searchQuery 自己完結の検索質問
 * @param {Object} precomputed
 * @param {string=} fallbackUserText searchQueryが空だった場合のみの安全フォールバック
 * @return {{summaryText: string, queries: Array<string>, chunksCount: number, metaKeys: Array<string>, sources: Array<{title: string, uri: string}>, finishReason: string, candidateKeys: Array<string>, partKeys: Array<string>, usage: Object|null, failed: boolean}}
 * @private
 */
function callGeminiWebSearch_(searchQuery, precomputed, fallbackUserText) {
  const payload = buildGeminiWebSearchPayload_(searchQuery, precomputed, fallbackUserText);

  try {
    const res = fetchGeminiResultWithRetry(payload, SYSTEM_CONSTANTS.GEMINI_35_LITE_ENDPOINT_BASE);
    return {
      summaryText: res.text || '',
      queries: Array.isArray(res.groundingQueries) ? res.groundingQueries : [],
      chunksCount: res.groundingChunksCount || 0,
      metaKeys: Array.isArray(res.groundingMetaKeys) ? res.groundingMetaKeys : [],
      sources: Array.isArray(res.groundingSources) ? res.groundingSources : [],
      finishReason: res.finishReason || '',
      candidateKeys: Array.isArray(res.candidateKeys) ? res.candidateKeys : [],
      partKeys: Array.isArray(res.partKeys) ? res.partKeys : [],
      usage: res.usage || null,
      failed: false
    };
  } catch (err) {
    Logger.log('Web検索取得エラー (検索未完了として続行): ' + err.message);
    return {
      summaryText: '',
      queries: [],
      chunksCount: 0,
      metaKeys: [],
      sources: [],
      finishReason: '',
      candidateKeys: [],
      partKeys: [],
      usage: null,
      failed: true
    };
  }
}

/**
 * cycle_stamps 文字列をエントリ配列へ安全にパースする
 * @param {string} rawStamps
 * @return {Array<{label: string, value: string, normalizedDate: string}>}
 * @private
 */
function parseCycleStampEntries_(rawStamps) {
  if (!rawStamps || typeof rawStamps !== 'string' || !rawStamps.trim()) return [];
  const entries = [];
  const lines = rawStamps.split('\n').map(s => s.trim()).filter(s => s.length > 0);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([^:：]+)[：:]\s*(.+)$/);
    if (!m) continue;
    const label = m[1].replace(/^[・\-\s]+/, '').trim();
    const value = m[2].trim();
    if (!label) continue;
    let normalizedDate = '';
    const dm = value.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (dm) {
      normalizedDate = `${dm[1]}-${String(Number(dm[2])).padStart(2, '0')}-${String(Number(dm[3])).padStart(2, '0')}`;
    }
    entries.push({ label: label, value: value, normalizedDate: normalizedDate });
  }
  return entries;
}

/**
 * cycle_stamps 文字列をパースし、各項目の経過日数ラベルを付与した文字列を生成
 * @param {string} rawStamps
 * @param {Date} todayDate
 * @return {string}
 * @private
 */
function formatCycleStampsWithElapsed_(rawStamps, todayDate) {
  if (!rawStamps || !rawStamps.trim()) return '';
  if (typeof parseCycleStamps !== 'function') return rawStamps.trim();
  const parsed = parseCycleStamps(rawStamps, todayDate || new Date());
  if (!parsed || parsed.length === 0) return rawStamps.trim();
  return parsed.map(p => {
    const elapsedText = (p.elapsedDays !== null && p.elapsedDays !== undefined)
      ? (p.elapsedDays === 0 ? '今日' : `${p.elapsedDays}日前`)
      : '未着手';
    return `${p.label}: ${p.date || '未着手'} (${elapsedText})`;
  }).join('\n');
}

/**
 * Structured Outputs の空文字列/null フィールドによる既存データ上書きを防ぐサニタイザ
 * @param {Object} parsed
 * @return {Object}
 * @private
 */
function sanitizeChatActionResult_(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;

  const stripEmptyProps = (obj, keys) => {
    if (!obj || typeof obj !== 'object') return obj;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (obj[k] === null || obj[k] === undefined || obj[k] === '') {
        delete obj[k];
      }
    }
    return obj;
  };

  if (Array.isArray(parsed.task_actions)) {
    parsed.task_actions = parsed.task_actions
      .filter(a => a && a.action)
      .map(a => {
        const copy = Object.assign({}, a);
        stripEmptyProps(copy, ['task_id', 'title', 'new_title', 'target_title', 'category', 'due_date', 'memo', 'remind_context', 'project_name', 'doc_url']);
        if (copy.estimated_mins === null || copy.estimated_mins === undefined || Number(copy.estimated_mins) <= 0) {
          delete copy.estimated_mins;
        }
        return copy;
      });
  }

  if (Array.isArray(parsed.project_actions)) {
    parsed.project_actions = parsed.project_actions
      .filter(a => a && a.action)
      .map(a => {
        const copy = Object.assign({}, a);
        stripEmptyProps(copy, ['category', 'project_name', 'doc_title', 'initial_content', 'content', 'task_id', 'target_task_title']);
        if (copy.create_doc === null || copy.create_doc === undefined) delete copy.create_doc;
        return copy;
      });
  }

  if (Array.isArray(parsed.calendar_actions)) {
    parsed.calendar_actions = parsed.calendar_actions
      .filter(a => a && a.action && a.title)
      .map(a => {
        const copy = Object.assign({}, a);
        stripEmptyProps(copy, ['start_time', 'end_time', 'date']);
        if (!Array.isArray(copy.recurrence_days) || copy.recurrence_days.length === 0) delete copy.recurrence_days;
        if (copy.is_all_day !== true) delete copy.is_all_day;
        if (copy.delete_series !== true) delete copy.delete_series;
        return copy;
      });
  }

  if (Array.isArray(parsed.shopping_actions)) {
    parsed.shopping_actions = parsed.shopping_actions
      .filter(a => a && a.action && a.item)
      .map(a => stripEmptyProps(Object.assign({}, a), ['category']));
  }

  if (Array.isArray(parsed.input_stock_actions)) {
    parsed.input_stock_actions = parsed.input_stock_actions
      .filter(a => a && a.action)
      .map(a => {
        const copy = Object.assign({}, a);
        stripEmptyProps(copy, ['type', 'title', 'target_title', 'memo']);
        if (copy.estimated_mins === null || copy.estimated_mins === undefined || Number(copy.estimated_mins) <= 0) {
          delete copy.estimated_mins;
        }
        return copy;
      });
  }

  if (Array.isArray(parsed.routine_actions)) {
    parsed.routine_actions = parsed.routine_actions
      .filter(a => a && a.action && a.title)
      .map(a => stripEmptyProps(Object.assign({}, a), ['type', 'value', 'memo']));
  }

  if (parsed.memory_updates && typeof parsed.memory_updates === 'object') {
    stripEmptyProps(parsed.memory_updates, ['cycle_stamps_updates', 'lifestyle_habits', 'dictionary', 'profile']);
    if (Object.keys(parsed.memory_updates).length === 0) delete parsed.memory_updates;
  }

  if (parsed.state_changes && typeof parsed.state_changes === 'object') {
    if (typeof parsed.state_changes.mark_low_mode !== 'boolean') delete parsed.state_changes.mark_low_mode;
    if (!parsed.state_changes.completed_anchor_id || !String(parsed.state_changes.completed_anchor_id).trim()) {
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

/**
 * Chat 用リクエストペイロードを構築（1段目・オンデマンド2段目共通 / Prefix Cache 最適化）
 * @param {string} userText
 * @param {Array<GoogleAppsScript.Base.Blob>} imageBlobs
 * @param {string} todayLogsText
 * @param {Object} memory
 * @param {Object} precomputed
 * @param {Object=} options { isSecondPass: boolean, webSearchContext: Object|null, extendedCalendarContext: string }
 * @return {Object} Gemini API requestPayload
 */
function buildChatPayload_(userText, imageBlobs, todayLogsText, memory, precomputed, options) {
  const mem = memory || {};
  const opt = options || {};
  const pre = precomputed || {};
  const hasImages = Boolean(imageBlobs && imageBlobs.length > 0);

  // 1. 不変システム指示（全ターン同一順序で結合し Prefix Cache を最大化）
  const promptModules = [
    (mem.prompt_core && mem.prompt_core.trim() !== '') ? mem.prompt_core.trim() : getDefaultPromptCore(),
    (mem.prompt_schedule && mem.prompt_schedule.trim() !== '') ? mem.prompt_schedule.trim() : getDefaultPromptSchedule(),
    (mem.prompt_db && mem.prompt_db.trim() !== '') ? mem.prompt_db.trim() : getDefaultPromptDb()
  ];
  if (mem.custom_system_prompt && mem.custom_system_prompt.trim() !== '') {
    promptModules.push(`【追加カスタム指示（最優先フォーマット・ルール）】\n${mem.custom_system_prompt.trim()}`);
  }
  const finalSystemPrompt = promptModules.join('\n\n==================================================\n\n');

  // 2. 準静的プレフィックス（メモリー系：先頭配置）
  const projSummary = (pre.projSummary !== undefined)
    ? pre.projSummary
    : ((mem.project_folders && typeof formatProjectsForAiPrompt === 'function')
        ? formatProjectsForAiPrompt(mem.project_folders)
        : '');
  const prefixLines = [
    `【プロファイル（恒久生活基盤）】: ${(mem.profile && mem.profile.trim() !== '') ? mem.profile.trim() : '未設定'}`,
    (mem.ideal_self && mem.ideal_self.trim() !== '') ? `【ありたい人間像・生活指針】: ${mem.ideal_self.trim()}` : '',
    (mem.lifestyle_habits && mem.lifestyle_habits.trim() !== '') ? `【生活習慣・活動定義 (lifestyle_habits)】:\n${mem.lifestyle_habits.trim()}` : '',
    (mem.skill_options && mem.skill_options.trim() !== '') ? `【スキルアップ選択肢 (skill_options)】:\n${mem.skill_options.trim()}` : '',
    (projSummary && projSummary !== 'なし') ? `【既存プロジェクトフォルダ一覧（Drive連携）】:\n${projSummary}` : ''
  ].filter(Boolean);

  // 3. 動的コンテキスト（可変データ：末尾配置）
  const dynamicLines = [];
  if (pre.weatherDisplay) {
    dynamicLines.push(`【天気・気温】: ${pre.weatherDisplay} / 気圧急降下: ${pre.pressureAlertVal === 'TRUE' ? '急降下中(注意)' : '安定'}`);
  }
  dynamicLines.push(`【現在日時】: ${pre.nowStr || ''}`);
  dynamicLines.push(`【直前のやり取りからの経過時間(Δt)】: ${pre.elapsedStr || '初回'}`);
  dynamicLines.push(`【時間の鏡（現在の予定・次の境界までの残り時間）】: ${(pre.boundaryInfo && pre.boundaryInfo.summaryText) ? pre.boundaryInfo.summaryText : 'なし'}`);

  if (mem.monthly_report_ready === 'TRUE') {
    dynamicLines.push('【月報通知フラグ】: TRUE');
  }
  if (pre.stampsFormatted) {
    dynamicLines.push(`【活動・メンテナンス最終記録 (cycle_stamps)】:\n${pre.stampsFormatted}`);
  }
  if (mem.weekly_summary && mem.weekly_summary.trim() !== '') {
    dynamicLines.push(`【直近1〜2週間の生活サマリー】: ${mem.weekly_summary.trim()}`);
  }
  if (pre.upcomingHolidays) {
    dynamicLines.push(`【今後1年間の日本の祝日】: ${pre.upcomingHolidays}`);
  }
  if (pre.defaultCalendarContext) {
    dynamicLines.push(pre.defaultCalendarContext);
  } else if (pre.todayEvents && pre.todayEvents.length > 0) {
    dynamicLines.push(`【本日のカレンダー予定】: ${pre.todayEvents.join(' / ')}`);
  }

  try {
    if (typeof loadFastState === 'function') {
      const fs = loadFastState(opt.simulatedNowDate || new Date());
      if (fs && fs.activeSession && fs.activeSession.title) {
        const mins = fs.activeSession.startedAtMs
          ? Math.max(0, Math.round((Date.now() - Number(fs.activeSession.startedAtMs)) / 60000))
          : 0;
        dynamicLines.push(`【現在進行中のタイマー行動】: ${fs.activeSession.title}（開始から${mins}分経過）`);
      }
    }
  } catch (e) {}

  const allTasks = pre.allUncompletedTasks || [];
  if (allTasks.length > 0 && typeof formatUncompletedTasksForContext === 'function') {
    dynamicLines.push(`【未完了タスク一覧】:\n${formatUncompletedTasksForContext(allTasks, pre.todayDate)}`);
  }
  if (pre.unboughtShopping && pre.unboughtShopping.length > 0) {
    dynamicLines.push(`【買物リスト(未買)】: ${pre.unboughtShopping.map(s => s.item).join(', ')}`);
  }
  if (pre.pendingInput && pre.pendingInput.length > 0) {
    const inputItems = pre.pendingInput.map(inp => `[${inp.type}]${inp.title}${inp.estimatedMins ? '(' + inp.estimatedMins + '分)' : ''}${inp.memo ? '[' + inp.memo + ']' : ''}`);
    dynamicLines.push(`【インプットストック(未消化)】: ${inputItems.join(', ')}`);
  }
  if (pre.routines && pre.routines.length > 0) {
    dynamicLines.push(`【登録済み定期ルーティン（ルール定義）】: ${pre.routines.map(r => `${r.ruleName}(${r.type}:${r.value})`).join(', ')}`);
  }
  if (pre.relevantDict) {
    dynamicLines.push(`【用語辞書（関連項目）】:\n${pre.relevantDict}`);
  }

  let promptBody = prefixLines.join('\n') + '\n\n' + dynamicLines.join('\n') + '\n\n';
  if (todayLogsText && todayLogsText.trim() !== '') {
    promptBody += `=== 本日の会話履歴 (時系列) ===\n${todayLogsText.trim()}\n\n`;
  }
  promptBody += `=== ユーザーの最新発言 ===\n${userText || '（画像を受信しました。内容を確認してください）'}`;

  if (opt.extendedCalendarContext) {
    promptBody += `\n\n【追加取得カレンダー予定（2段目取得結果）】:\n${opt.extendedCalendarContext}`;
  }
  if (opt.webSearchContext) {
    const ws = opt.webSearchContext;
    const hasGroundedEvidence = !ws.failed && Boolean(ws.summaryText) &&
      ((ws.chunksCount || 0) > 0 || (Array.isArray(ws.queries) && ws.queries.length > 0));
    if (hasGroundedEvidence) {
      const queryLabel = (Array.isArray(ws.queries) && ws.queries.length > 0)
        ? ` (検索クエリ: ${ws.queries.join(' / ')})`
        : '';
      let searchBlock = `\n\n【外部Web検索結果（一次情報）${queryLabel}】:\n${ws.summaryText}`;
      if (Array.isArray(ws.sources) && ws.sources.length > 0) {
        searchBlock += '\n参照元:\n' + ws.sources.map(s => `- ${s.title || s.uri}: ${s.uri}`).join('\n');
      }
      promptBody += searchBlock;
    } else {
      promptBody += '\n\n【外部Web検索結果】: Web検索から確実な一次情報を取得できませんでした（未確認の細部は推測で断定せず、確認が必要である旨を伝えること）。';
    }
  }
  if (opt.isSecondPass) {
    promptBody += '\n\n※追加取得した上記情報を踏まえ、最終的な応答と必要なJSONアクションを完成させてください（再検索・再レンジ要求は不要です）。';
  }

  const currentTurnParts = [];
  if (hasImages) {
    for (let i = 0; i < imageBlobs.length; i++) {
      const blob = imageBlobs[i];
      if (blob) {
        currentTurnParts.push({
          inlineData: {
            mimeType: blob.getContentType() || 'image/jpeg',
            data: Utilities.base64Encode(blob.getBytes())
          }
        });
      }
    }
  }
  currentTurnParts.push({ text: promptBody });

  const backendTarget = resolveBackendModel_(mem);
  const effectiveThinkingMem = (mem._testThinkingLevel || (mem.thinking_level && String(mem.thinking_level).trim() !== ''))
    ? mem
    : Object.assign({}, mem, { thinking_level: 'low' });

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
      thinkingConfig: resolveThinkingConfig_(backendTarget.model, effectiveThinkingMem),
      responseMimeType: 'application/json',
      responseSchema: CHAT_RESPONSE_SCHEMA
    }
  };
}

/**
 * 生活伴走システム v2 Chat 実行エンジン（3.5-Flash-Lite 原則1段 ＋ 必要時オンデマンド2段目）
 * @param {string} userText
 * @param {Array<GoogleAppsScript.Base.Blob>} imageBlobs
 * @param {string} todayLogsText
 * @param {Object=} memoryOpt
 * @param {Date=} simulatedNowDate
 * @return {{
 *   primaryResult: Object,
 *   logMeta: Object
 * }}
 */
function executeCompanionTurn(userText, imageBlobs, todayLogsText, memoryOpt, simulatedNowDate) {
  const memory = memoryOpt || getMemory();
  const now = simulatedNowDate || new Date();

  // 1. GAS 前処理＆ターン内共有スナップショット構築（Pass 1 / Pass 2 で完全共有）
  const nowStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd(E) HH:mm');
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const lastTimeStr = extractLastLogTime(todayLogsText);
  const elapsedStr = formatElapsedTime(lastTimeStr, now);
  const boundaryInfo = getNextBoundaryInfo(now);
  const todayEvents = getTodayEventsList(now);
  const excludeDate = (memory && memory._testCalendarExcludeDate) || '';

  const allUncompletedTasks = (memory && Array.isArray(memory._testMockTasks))
    ? memory._testMockTasks
    : ((typeof getTasks === 'function') ? getTasks('未完了') : []);
  const unboughtShopping = (memory && Array.isArray(memory._testMockShopping))
    ? memory._testMockShopping
    : ((typeof getShoppingList === 'function') ? getShoppingList('未買') : []);
  const pendingInput = (memory && Array.isArray(memory._testMockInputStock))
    ? memory._testMockInputStock
    : ((typeof getInputStockList === 'function') ? getInputStockList('未') : []);
  const routines = (memory && Array.isArray(memory._testMockRoutines))
    ? memory._testMockRoutines
    : ((typeof getRoutines === 'function') ? getRoutines('有効') : []);

  let weatherDisplay = (memory && memory.weather_info) || '';
  let pressureAlertVal = (memory && memory.pressure_alert) || 'FALSE';
  if ((!weatherDisplay || weatherDisplay.indexOf('エラー') !== -1) && typeof fetchWeatherAndPressure === 'function' && !(memory && memory._testSkipWeatherFetch)) {
    try {
      const freshW = fetchWeatherAndPressure();
      if (freshW && freshW.weatherInfo) {
        weatherDisplay = freshW.weatherInfo;
        pressureAlertVal = freshW.pressureAlert;
      }
    } catch (e) {}
  }
  if (typeof hasOfficeEventToday === 'function' && !hasOfficeEventToday() && weatherDisplay.indexOf('｜') !== -1) {
    weatherDisplay = weatherDisplay.split('｜')[0].trim();
  }

  let relevantDict = '';
  if (memory && memory.dictionary && memory.dictionary.trim() !== '' && typeof filterRelevantDictionaryEntries === 'function') {
    const taskTitlesText = allUncompletedTasks.map(t => t.title || '').join(' ');
    const inputTitlesText = pendingInput.map(inp => inp.title || '').join(' ');
    const shopTitlesText = unboughtShopping.map(s => s.item || '').join(' ');
    const searchTarget = `${userText || ''}\n${todayLogsText || ''}\n${taskTitlesText}\n${inputTitlesText}\n${shopTitlesText}`;
    relevantDict = filterRelevantDictionaryEntries(memory.dictionary, searchTarget);
  }

  const precomputed = {
    now: now,
    nowStr: nowStr,
    todayDate: todayDate,
    elapsedStr: elapsedStr,
    boundaryInfo: boundaryInfo,
    todayEvents: todayEvents,
    upcomingHolidays: (typeof getUpcomingHolidaysSummary_ === 'function') ? getUpcomingHolidaysSummary_(now) : '',
    defaultCalendarContext: (typeof getCalendarAndHolidayContext === 'function') ? getCalendarAndHolidayContext(now, excludeDate, '', '') : '',
    stampsFormatted: (memory && memory.cycle_stamps) ? formatCycleStampsWithElapsed_(memory.cycle_stamps, todayDate) : '',
    projSummary: (memory && memory.project_folders && typeof formatProjectsForAiPrompt === 'function') ? formatProjectsForAiPrompt(memory.project_folders) : '',
    allUncompletedTasks: allUncompletedTasks,
    unboughtShopping: unboughtShopping,
    pendingInput: pendingInput,
    routines: routines,
    weatherDisplay: weatherDisplay,
    pressureAlertVal: pressureAlertVal,
    relevantDict: relevantDict
  };

  const backendTarget = resolveBackendModel_(memory);
  const effectiveThinkingMem = (memory && (memory._testThinkingLevel || (memory.thinking_level && String(memory.thinking_level).trim() !== '')))
    ? memory
    : Object.assign({}, memory, { thinking_level: 'low' });
  const thinkingCfg = resolveThinkingConfig_(backendTarget.model, effectiveThinkingMem);
  const thinkLabel = thinkingCfg.thinkingLevel ? thinkingCfg.thinkingLevel : 'b0';

  // 2. Pass 1 実行（原則1パスで完了）
  const pass1Payload = buildChatPayload_(userText, imageBlobs, todayLogsText, memory, precomputed, { isSecondPass: false });
  const tPass1 = Date.now();
  const pass1Res = fetchGeminiResultWithRetry(pass1Payload, backendTarget.endpoint);
  const pass1LatencyMs = Date.now() - tPass1;
  const pass1Usage = pass1Res.usage || {};
  const pass1Parsed = sanitizeChatActionResult_(parseGeminiActionJson_(pass1Res.text, pass1Usage));

  // 3. オンデマンド2段目判定（Web検索または範囲外カレンダー要求時のみ）
  const searchQuery = String((pass1Parsed && pass1Parsed.need_web_search_query) || '').trim();
  const calRange = (pass1Parsed && pass1Parsed.need_calendar_range) ? pass1Parsed.need_calendar_range : null;
  const needSearch = Boolean(searchQuery);
  const needCalRange = Boolean(calRange && (calRange.start || calRange.end));

  let finalParsed = pass1Parsed;
  let pass2Usage = {};
  let pass2LatencyMs = 0;
  let webSearchContext = null;
  let webSearchUsage = {};
  let webSearchLatencyMs = 0;
  let extendedCalendarContext = '';

  if (needSearch || needCalRange) {
    if (needSearch) {
      const tSearch0 = Date.now();
      const ws = callGeminiWebSearch_(searchQuery, precomputed, userText);
      webSearchLatencyMs = Date.now() - tSearch0;
      webSearchContext = ws;
      webSearchUsage = ws.usage || {};
    }
    if (needCalRange && typeof getCalendarAndHolidayContext === 'function') {
      extendedCalendarContext = getCalendarAndHolidayContext(now, excludeDate, calRange.start, calRange.end);
    }

    const pass2Payload = buildChatPayload_(userText, imageBlobs, todayLogsText, memory, precomputed, {
      isSecondPass: true,
      webSearchContext: webSearchContext,
      extendedCalendarContext: extendedCalendarContext
    });
    const tPass2 = Date.now();
    const pass2Res = fetchGeminiResultWithRetry(pass2Payload, backendTarget.endpoint);
    pass2LatencyMs = Date.now() - tPass2;
    pass2Usage = pass2Res.usage || {};
    finalParsed = sanitizeChatActionResult_(parseGeminiActionJson_(pass2Res.text, pass2Usage));
  }

  // 4. トークン集計・メタデータ記録
  const p1Stats = extractTokenStats_(pass1Usage);
  const wsStats = extractTokenStats_(webSearchUsage);
  const p2Stats = extractTokenStats_(pass2Usage);
  const isTwoPass = (needSearch || needCalRange);
  const finalStats = isTwoPass ? p2Stats : p1Stats;
  const totalTokens = p1Stats.total + wsStats.total + p2Stats.total;
  const webSearchQueries = (webSearchContext && Array.isArray(webSearchContext.queries)) ? webSearchContext.queries : [];

  const passTags = [];
  if (needSearch) passTags.push('+web');
  if (needCalRange) passTags.push('+cal');
  const phaseAndTags = `[v2 ${isTwoPass ? '2-pass' : '1-pass'}${passTags.join('')} / mode:${finalParsed.reply_mode || 'reply'} / model:${backendTarget.shortLabel}(${thinkLabel})]`;

  const logMeta = {
    isTwoModel: true,
    backendModel: backendTarget.model,
    litePromptTokens: isTwoPass ? (p1Stats.prompt + wsStats.prompt) : 0,
    liteCandidatesTokens: isTwoPass ? (p1Stats.cand + wsStats.cand) : 0,
    liteCachedTokens: isTwoPass ? (p1Stats.cached + wsStats.cached) : 0,
    liteThinkingTokens: isTwoPass ? (p1Stats.thinking + wsStats.thinking) : 0,
    webSearchUsed: needSearch,
    webSearchModel: needSearch ? SYSTEM_CONSTANTS.GEMINI_35_LITE_MODEL : '',
    webSearchFailed: Boolean(webSearchContext && webSearchContext.failed),
    webSearchPromptTokens: wsStats.prompt,
    webSearchCandidatesTokens: wsStats.cand,
    webSearchCachedTokens: wsStats.cached,
    webSearchThinkingTokens: wsStats.thinking,
    webSearchToolUseTokens: wsStats.toolUse,
    webSearchTotalTokens: wsStats.total,
    webSearchLatencyMs: webSearchLatencyMs,
    flashPromptTokens: finalStats.prompt,
    flashCandidatesTokens: finalStats.cand,
    flashCachedTokens: finalStats.cached,
    flashThinkingTokens: finalStats.thinking,
    flashToolUseTokens: finalStats.toolUse,
    liteLatencyMs: isTwoPass ? (pass1LatencyMs + webSearchLatencyMs) : 0,
    flashLatencyMs: isTwoPass ? pass2LatencyMs : pass1LatencyMs,
    newTotalTokens: totalTokens,
    phaseAndTags: phaseAndTags,
    webSearchQueries: webSearchQueries,
    groundingChunksCount: (webSearchContext && webSearchContext.chunksCount) || 0,
    groundingMetaKeys: (webSearchContext && Array.isArray(webSearchContext.metaKeys)) ? webSearchContext.metaKeys : [],
    webSearchFinishReason: (webSearchContext && webSearchContext.finishReason) || '',
    webSearchCandidateKeys: (webSearchContext && Array.isArray(webSearchContext.candidateKeys)) ? webSearchContext.candidateKeys : [],
    webSearchPartKeys: (webSearchContext && Array.isArray(webSearchContext.partKeys)) ? webSearchContext.partKeys : [],
    webSearchSummaryPreview: (webSearchContext && webSearchContext.summaryText)
      ? String(webSearchContext.summaryText).replace(/\s+/g, ' ').slice(0, 220)
      : ''
  };

  return {
    primaryResult: finalParsed,
    logMeta: logMeta
  };
}
