/**
 * Api.js - Companion Cockpit (v2) Web App エンドポイント ＆ 7つのPWA通信API
 * LINE Webhook を廃止し、GitHub Pages / GAS HTML Service のフロントエンドと高速通信する
 */

// =============================================================================
// 1. GAS HTTP エンドポイント (doGet / doPost / handleDashboardApiRequest)
// =============================================================================

/**
 * Web App GET エンドポイント
 * ?ping=1 / ?apiAction=... / PWA HTML表示 に対応
 */
function doGet(e) {
  if (e && e.parameter) {
    if (e.parameter.ping) {
      return ContentService.createTextOutput('OK (Daily Companion v2 Active)')
        .setMimeType(ContentService.MimeType.TEXT);
    }
    if (e.parameter.apiAction) {
      let args = [];
      try {
        if (e.parameter.args) args = JSON.parse(e.parameter.args);
      } catch (err) {}
      const apiRes = handleDashboardApiRequest({
        apiAction: e.parameter.apiAction,
        args: args
      });
      return ContentService.createTextOutput(JSON.stringify(apiRes))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  return renderDashboardHtml(e);
}

/**
 * Web App POST エンドポイント (GitHub Pages CORS text/plain JSON 受信)
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Empty request body' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const payload = JSON.parse(e.postData.contents);
    const res = handleDashboardApiRequest(payload);
    return ContentService.createTextOutput(JSON.stringify(res))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    Logger.log('doPost エラー: ' + err.message);
    return ContentService.createTextOutput(JSON.stringify({
      ok: false,
      error: (err && err.message) ? err.message : String(err)
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * v2 PWA クライアントからの 7 エンドポイントをディスパッチ
 * @param {Object} payload { apiAction: string, args: Array }
 * @return {{ ok: boolean, data?: Object, error?: string }}
 */
function handleDashboardApiRequest(payload) {
  try {
    const action = payload ? payload.apiAction : '';
    const args = (payload && Array.isArray(payload.args)) ? payload.args : [];
    const handlers = {
      apiGetHomeBootstrap: apiGetHomeBootstrap,
      apiStartAction: apiStartAction,
      apiCompleteAction: apiCompleteAction,
      apiDismissCardToday: apiDismissCardToday,
      apiSendChat: apiSendChat,
      apiMutateListItem: apiMutateListItem,
      apiRefreshDeck: apiRefreshDeck
    };
    if (!handlers[action]) {
      return { ok: false, error: 'Unknown apiAction: ' + action };
    }
    const data = handlers[action].apply(null, args);
    return { ok: true, data: data };
  } catch (err) {
    return { ok: false, error: (err && err.message) ? err.message : String(err) };
  }
}

// =============================================================================
// 2. v2 API Endpoints (7本)
// =============================================================================

/**
 * 1. 初期起動・同期: State・天気/境界・リスト・当日Chatログを一括返却
 * @param {string} authKey
 * @return {Object}
 */
function apiGetHomeBootstrap(authKey) {
  if (!verifyDashboardAccess(authKey)) {
    return unauthorizedResponse_();
  }

  const now = new Date();
  const todayStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
  const fastState = loadFastState(now);
  const memory = getMemory();
  const workBoundary = getWorkModeAndBoundary(now, memory.profile);
  let stateDirty = false;

  // 天気情報の3時間鮮度 / エラー / 出社日の渋谷欠損チェック
  if (isWeatherStale(fastState, workBoundary.workMode, memory.weather_info, now)) {
    try {
      const freshW = fetchWeatherAndPressure();
      if (freshW && freshW.weatherInfo) {
        memory.weather_info = freshW.weatherInfo;
        memory.pressure_alert = freshW.pressureAlert;
        setMemoryValue('weather_info', freshW.weatherInfo);
        setMemoryValue('pressure_alert', freshW.pressureAlert);
        fastState.weatherFetchedAt = Utilities.formatDate(now, 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss+09:00");
        refreshBriefingWeatherLine(fastState, memory.weather_info, memory.pressure_alert, workBoundary.workMode);
        stateDirty = true;
      }
    } catch (wErr) {
      Logger.log('Bootstrap 天気更新警告: ' + wErr.message);
    }
  }

  // 朝ブリーフィング・AIデッキが当日分未生成なら安全に生成（03:00バッチ後の再起動・初回起動保護）
  let uncompletedTasks = null;
  if (!fastState.dailyBriefing || fastState.dailyBriefing.dateKey !== fastState.dayKey) {
    uncompletedTasks = getTasks('未完了');
    fastState.dailyBriefing = buildDailyBriefingObj(
      memory.weather_info,
      memory.pressure_alert,
      workBoundary.workMode,
      workBoundary.todayEvents,
      uncompletedTasks,
      todayStr
    );
    stateDirty = true;
  }

  if (!fastState.aiDeck || !Array.isArray(fastState.aiDeck.cards) || fastState.aiDeck.cards.length === 0) {
    fastState.aiDeck = generateAiDeck({
      reason: 'bootstrap_fallback',
      now: now,
      memory: memory,
      fastState: fastState,
      workMode: workBoundary.workMode,
      todayEvents: workBoundary.todayEvents,
      boundaryInfo: workBoundary.boundaryInfo,
      useFlashModel: false
    });
    stateDirty = true;
  }

  const lists = buildListsSnapshot(memory, now);
  fastState.listCache = lists;
  saveFastState(fastState, stateDirty);

  const deck = composeHomeDeck(workBoundary.workMode, now, fastState);
  const weatherLine = formatWeatherLineForHome(memory.weather_info, memory.pressure_alert, workBoundary.workMode);
  const chatMessages = buildChatMessagesFromLogicalTodayLogs_(now);

  return {
    authorized: true,
    validKey: getDashboardAccessKey(),
    state: fastState,
    deck: deck,
    boundary: workBoundary.heroBoundary,
    workMode: workBoundary.workMode,
    isHoliday: workBoundary.isHoliday,
    weatherLine: weatherLine,
    weatherInfo: memory.weather_info || '',
    pressureAlert: memory.pressure_alert || 'FALSE',
    deltaText: buildDeltaText(fastState.lastAction, now),
    lists: lists,
    chatMessages: chatMessages
  };
}

/**
 * 2. 行動の開始（「今すぐ始める」/ リスト「▶」 /「自分で始める」）
 * @param {string} authKey
 * @param {Object} cardPayload
 * @return {Object}
 */
function apiStartAction(authKey, cardPayload) {
  if (!verifyDashboardAccess(authKey)) {
    return unauthorizedResponse_();
  }

  const now = new Date();
  const nowStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  const nowIso = Utilities.formatDate(now, 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss+09:00");
  const fastState = loadFastState(now);
  if (!cardPayload || !cardPayload.title) {
    fastState.activeSession = null;
    saveFastState(fastState, true);
    return { authorized: true, state: fastState };
  }
  const c = cardPayload || {};

  const session = {
    id: String(c.id || ('custom_' + now.getTime())),
    title: String(c.title || '行動').trim(),
    sub: String(c.sub || '').trim(),
    icon: String(c.icon || 'compass'),
    mins: parsePositiveEstimatedMins_(c.mins) || 30,
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
    startedAtIso: nowIso
  };

  fastState.activeSession = session;
  if (fastState.dailyBriefing) {
    fastState.dailyBriefing.dismissed = true;
  }

  const memory = getMemory();
  const workBoundary = getWorkModeAndBoundary(now, memory.profile);

  if (session.isSleepCard) {
    try {
      appendLog(nowStr, 'user', 'これから寝ます（おやすみ）', '', '[スタンプ: 🌙]\nおやすみなさい。良い睡眠を。');
    } catch (logErr) {
      Logger.log('就寝開始ログ追記エラー: ' + logErr.message);
    }
  } else if (!session.isWorkBlock) {
    // 行動終了見込み時刻に適応した次の手札をバックグラウンド同期的に先読み生成
    fastState.aiDeck = generateAiDeck({
      reason: 'start_action',
      now: now,
      memory: memory,
      fastState: fastState,
      workMode: workBoundary.workMode,
      todayEvents: workBoundary.todayEvents,
      boundaryInfo: workBoundary.boundaryInfo,
      startedCard: session,
      useFlashModel: false
    });
  }

  saveFastState(fastState, true);
  const deck = composeHomeDeck(workBoundary.workMode, now, fastState);

  return {
    authorized: true,
    state: fastState,
    activeSession: fastState.activeSession,
    aiDeck: fastState.aiDeck,
    deck: deck,
    boundary: workBoundary.heroBoundary
  };
}

/**
 * 3. 行動の完了（「終わった！」＋ ふりかえり気分/写真/メモ / 起床 / 引き算一括リスケ）
 * @param {string} authKey
 * @param {Object} completePayload { session?, mood?, note?, photoBase64?, photoMimeType? }
 * @return {Object}
 */
function apiCompleteAction(authKey, completePayload) {
  if (!verifyDashboardAccess(authKey)) {
    return unauthorizedResponse_();
  }

  const p = completePayload || {};
  const clientOpId = String(p.clientOpId || '').trim();
  const now = new Date();
  const nowStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  const nowIso = Utilities.formatDate(now, 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss+09:00");
  const logicalDayStr = getLogicalDayKey(now);
  const fastState = loadFastState(now);

  if (clientOpId) {
    try {
      const cache = CacheService.getScriptCache();
      if (cache && cache.get('op_' + clientOpId)) {
        const memoryDup = getMemory();
        const workBoundaryDup = getWorkModeAndBoundary(now, memoryDup.profile);
        return {
          authorized: true,
          duplicateSkipped: true,
          state: fastState,
          deck: composeHomeDeck(workBoundaryDup.workMode, now, fastState),
          lists: fastState.listCache || buildListsSnapshot(memoryDup, now),
          boundary: workBoundaryDup.heroBoundary
        };
      }
    } catch (e) {}
  }

  const session = p.session || fastState.activeSession || {};

  const mood = String(p.mood || '').trim();
  const note = String(p.note || '').trim();
  const keepOpen = Boolean(p.keepOpen);
  let photoUrl = '';
  if (p.photoBase64) {
    const savedImg = saveBase64ImageToDrive(p.photoBase64, p.photoMimeType || 'image/jpeg', 'reflect');
    photoUrl = savedImg.url;
  }

  const notices = [];
  let addedChatMessage = null;
  const sessionTitle = String(session.title || '行動').trim();

  // DB / 周期 / 就寝 / 引き算の実反映
  try {
    if (session.isTriage) {
      const targetIds = Array.isArray(session.triageTaskIds) ? session.triageTaskIds.filter(Boolean) : [];
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const tomorrowStr = Utilities.formatDate(tomorrow, 'Asia/Tokyo', 'yyyy-MM-dd');
      let idsToMove = targetIds;
      if (idsToMove.length === 0) {
        const uncompleted = getTasks('未完了');
        idsToMove = uncompleted
          .filter(t => t.dueDate && t.dueDate <= logicalDayStr)
          .slice(0, 5)
          .map(t => t.id);
      }
      if (idsToMove.length > 0) {
        const res = applyTaskActions(idsToMove.map(id => ({
          action: 'update',
          task_id: id,
          due_date: tomorrowStr
        })));
        notices.push.apply(notices, res);
      }
      fastState.triagedToday = true;
    }

    if (!keepOpen) {
      if (session.linkedType === 'task' && session.linkedId) {
        const taskRes = applyTaskActions([{ action: 'complete', task_id: session.linkedId }]);
        notices.push.apply(notices, taskRes);
      } else if (session.linkedType === 'stock' && session.linkedId) {
        const stockRes = applyInputStockActions([{ action: 'complete', title: session.linkedId }]);
        notices.push.apply(notices, stockRes);
      }
    }

    if (session.cycleStampLabel) {
      const updated = updateCycleStampsSafely(`${session.cycleStampLabel}: ${logicalDayStr}`);
      if (updated && updated.length > 0) {
        updated.forEach(entry => notices.push(`📌 周期スタンプ更新: ${entry}`));
      }
    }
  } catch (applyErr) {
    Logger.log('完了反映エラー: ' + applyErr.message);
  }

  // 完了フラグ・直前状態更新（日跨ぎの就寝セッション完了＝起床時は当日の就寝フラグを立てない）
  if (session.id && !session.isCustom && !session.isSleepCard) {
    fastState.completedToday[session.id] = true;
  }
  if (!keepOpen && session.linkedType === 'task' && session.linkedId) {
    fastState.completedToday[session.linkedId] = true;
  }
  fastState.activeSession = null;
  fastState.lastAction = {
    title: session.isSleepCard ? '睡眠・起床' : sessionTitle,
    completedAt: nowIso,
    isSleep: Boolean(session.isSleepCard)
  };

  // logs シートへの記録（行動完了・進行・起床・引き算をすべて記録）
  {
    const startedMs = Number(session.startedAtMs) || 0;
    const elapsedMins = startedMs > 0 ? Math.max(1, Math.round((now.getTime() - startedMs) / 60000)) : 0;
    let userMsg = '';
    if (session.isSleepCard) {
      const sleepDur = elapsedMins > 0
        ? (elapsedMins >= 60 ? `${Math.floor(elapsedMins / 60)}時間${elapsedMins % 60 > 0 ? (elapsedMins % 60) + '分' : ''}` : `${elapsedMins}分`)
        : '';
      userMsg = `起きました（おはよう${sleepDur ? ' · 睡眠 ' + sleepDur : ''}）`;
    } else if (session.isTriage) {
      userMsg = `【引き算】${sessionTitle}`;
    } else if (keepOpen) {
      userMsg = `【進行】${sessionTitle}${elapsedMins > 0 ? `（実測${elapsedMins}分）` : ''}`;
    } else {
      userMsg = `【完了】${sessionTitle}${elapsedMins > 0 ? `（実測${elapsedMins}分）` : ''}`;
    }

    const detailParts = [];
    if (mood) detailParts.push(`気分: ${mood}`);
    if (note) detailParts.push(note);
    if (detailParts.length > 0) {
      userMsg += `\n${detailParts.join(' / ')}`;
    }

    const emoji = session.isSleepCard ? '☀️' : (session.isTriage ? '🌿' : '✨');
    const aiReplyLines = [`[スタンプ: ${emoji}]`];
    if (notices.length > 0) {
      aiReplyLines.push(notices.join('\n'));
    }
    const aiReplyStr = aiReplyLines.join('\n');

    try {
      appendLog(nowStr, 'user', userMsg, photoUrl, aiReplyStr);
      addedChatMessage = buildChatLogEntryObject_({
        id: 'LOG_' + now.getTime(),
        timestampStr: nowStr,
        message: userMsg,
        imageUrl: photoUrl,
        aiReply: aiReplyStr
      });
    } catch (logErr) {
      Logger.log('完了ログ追記エラー: ' + logErr.message);
    }
  }

  const memory = getMemory();
  const lists = buildListsSnapshot(memory, now);
  fastState.listCache = lists;
  saveFastState(fastState, true);

  const workBoundary = getWorkModeAndBoundary(now, memory.profile);
  const deck = composeHomeDeck(workBoundary.workMode, now, fastState);

  if (clientOpId) {
    try {
      const cache = CacheService.getScriptCache();
      if (cache) cache.put('op_' + clientOpId, '1', 3600);
    } catch (e) {}
  }

  return {
    authorized: true,
    state: fastState,
    deck: deck,
    lists: lists,
    boundary: workBoundary.heroBoundary,
    deltaText: buildDeltaText(fastState.lastAction, now),
    notices: notices,
    addedChatMessage: addedChatMessage
  };
}

/**
 * 4. カードの右スワイプ（「今日はいい」で当日除外）
 * @param {string} authKey
 * @param {string} cardId
 * @return {Object}
 */
function apiDismissCardToday(authKey, cardId) {
  if (!verifyDashboardAccess(authKey)) {
    return unauthorizedResponse_();
  }

  const now = new Date();
  const fastState = loadFastState(now);
  if (cardId) {
    fastState.dismissedToday[String(cardId)] = true;
    if (cardId === '__briefing__' && fastState.dailyBriefing) {
      fastState.dailyBriefing.dismissed = true;
    }
    saveFastState(fastState, true);
  }
  const workBoundary = getWorkModeAndBoundary(now);
  const deck = composeHomeDeck(workBoundary.workMode, now, fastState);

  return {
    authorized: true,
    state: fastState,
    deck: deck
  };
}

/**
 * 5. Chat タブからの相談・指示・つぶやき送信
 * @param {string} authKey
 * @param {Object|string} messagePayload { text, imageBase64?, imageMimeType? }
 * @return {Object}
 */
function apiSendChat(authKey, messagePayload) {
  if (!verifyDashboardAccess(authKey)) {
    return unauthorizedResponse_();
  }

  const payload = (typeof messagePayload === 'string')
    ? { text: messagePayload }
    : (messagePayload || {});
  const userText = String(payload.text || '').trim();
  const hasPhoto = Boolean(payload.imageBase64);
  if (!userText && !hasPhoto) {
    throw new Error('メッセージまたは画像を入力してください。');
  }

  const now = new Date();
  const nowStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  const hhmm = nowStr.substring(11, 16);

  let decodedImage = null;
  const imageBlobs = [];
  if (hasPhoto) {
    decodedImage = decodeBase64ImageToBlob_(payload.imageBase64, payload.imageMimeType || 'image/jpeg', 'chat_img');
    imageBlobs.push(decodedImage.blob);
  }

  const memory = getMemory();
  const todayLogsCondensed = buildCondensedLogsFromArray_(getLogicalTodayLogs(now));
  const turnOutcome = executeCompanionTurn(userText, imageBlobs, todayLogsCondensed, memory, now);
  const aiResult = turnOutcome.primaryResult || {};

  // 画像はGemini成功後にDriveへ保存
  let imageUrl = '';
  if (decodedImage && decodedImage.blob) {
    try {
      const saved = saveImageBlobToDrive_(decodedImage.blob, decodedImage.fileName);
      imageUrl = saved.url;
    } catch (imgErr) {
      Logger.log('Chat画像Drive保存エラー: ' + imgErr.message);
    }
  }

  // DB / カレンダー / プロジェクト / 周期スタンプ適用
  const executedNotices = [];
  let deckNeedsRefresh = false;
  const chatCompletedIds = [];
  try {
    let createdProjectUrlMap = {};
    if (aiResult.project_actions && aiResult.project_actions.length > 0 && typeof applyProjectActions === 'function') {
      const projRes = applyProjectActions(aiResult.project_actions);
      if (projRes && projRes.notices) executedNotices.push.apply(executedNotices, projRes.notices);
      if (projRes && projRes.createdUrlMap) createdProjectUrlMap = projRes.createdUrlMap;
    }
    if (aiResult.task_actions && aiResult.task_actions.length > 0) {
      const taskRes = applyTaskActions(aiResult.task_actions, createdProjectUrlMap);
      executedNotices.push.apply(executedNotices, taskRes);
      if (taskRes.length > 0 && aiResult.task_actions.some(a => a.action === 'complete' || a.action === 'delete')) {
        deckNeedsRefresh = 'check_low_cards';
        aiResult.task_actions.forEach(a => {
          if ((a.action === 'complete' || a.action === 'delete') && a.id) {
            chatCompletedIds.push(String(a.id));
          }
        });
      }
    }
    if (aiResult.calendar_actions && aiResult.calendar_actions.length > 0) {
      const calRes = applyCalendarActions(aiResult.calendar_actions);
      executedNotices.push.apply(executedNotices, calRes);
      if (calRes.length > 0) deckNeedsRefresh = true;
    }
    if (aiResult.shopping_actions && aiResult.shopping_actions.length > 0) {
      const shopRes = applyShoppingActions(aiResult.shopping_actions);
      executedNotices.push.apply(executedNotices, shopRes);
    }
    if (aiResult.input_stock_actions && aiResult.input_stock_actions.length > 0) {
      const inputRes = applyInputStockActions(aiResult.input_stock_actions);
      executedNotices.push.apply(executedNotices, inputRes);
      if (inputRes.length > 0 && aiResult.input_stock_actions.some(a => a.action === 'complete' || a.action === 'delete')) {
        deckNeedsRefresh = 'check_low_cards';
        aiResult.input_stock_actions.forEach(a => {
          if (a.action === 'complete' || a.action === 'delete') {
            if (a.id) chatCompletedIds.push(String(a.id));
            if (a.title) chatCompletedIds.push(String(a.title));
          }
        });
      }
    }
    if (aiResult.routine_actions && aiResult.routine_actions.length > 0) {
      const routineRes = applyRoutineActions(aiResult.routine_actions);
      executedNotices.push.apply(executedNotices, routineRes);
    }
    if (aiResult.memory_updates && aiResult.memory_updates.cycle_stamps_updates) {
      const updatedStamps = updateCycleStampsSafely(aiResult.memory_updates.cycle_stamps_updates);
      if (updatedStamps && updatedStamps.length > 0) {
        updatedStamps.forEach(entry => executedNotices.push(`📌 周期スタンプ更新: ${entry}`));
      }
    }
  } catch (actErr) {
    Logger.log('Chatアクション適用エラー: ' + actErr.message);
  }

  // 長期メモリー更新
  try {
    if (aiResult.memory_updates) {
      if (aiResult.memory_updates.lifestyle_habits) {
        updateLifestyleHabitsSafely(aiResult.memory_updates.lifestyle_habits);
      }
      if (aiResult.memory_updates.profile) {
        updateProfileSafely(aiResult.memory_updates.profile);
      }
      if (aiResult.memory_updates.dictionary) {
        updateDictionarySafely(aiResult.memory_updates.dictionary);
      }
    }
  } catch (memErr) {
    Logger.log('メモリー更新エラー: ' + memErr.message);
  }

  // FastState 反映（低負荷モード / アンカー完了 / チャット完了タスク・インプット）
  const fastState = loadFastState(now);
  let stateChanged = false;
  if (chatCompletedIds.length > 0) {
    chatCompletedIds.forEach(cid => {
      if (!fastState.completedToday[cid]) {
        fastState.completedToday[cid] = true;
        stateChanged = true;
      }
    });
  }
  const sc = aiResult.state_changes;
  if (sc && typeof sc === 'object') {
    if (typeof sc.mark_low_mode === 'boolean' && fastState.isLowMode !== sc.mark_low_mode) {
      fastState.isLowMode = sc.mark_low_mode;
      stateChanged = true;
      deckNeedsRefresh = true;
    }
    if (sc.completed_anchor_id) {
      fastState.completedToday[String(sc.completed_anchor_id)] = true;
      stateChanged = true;
    }
  }

  // スタンプ反応 vs テキスト返信モード解決
  const reactionEmoji = String(aiResult.reaction_emoji || '').trim() || '👍';
  let pureReplyText = stripManualNoticeLines_(aiResult.reply_text || '');
  let mode = (aiResult.reply_mode === 'reaction' && !pureReplyText) ? 'reaction' : 'reply';
  if (executedNotices.length > 0) {
    mode = 'reply';
    if (!pureReplyText) pureReplyText = '承知しました。反映しておきました。';
  } else if (aiResult.reply_mode === 'reaction' && !pureReplyText) {
    mode = 'reaction';
  } else if (!pureReplyText) {
    mode = 'reaction';
  }

  const parsedBadgesAndLinks = extractBadgesAndDocLinks_(executedNotices);
  const logReplyParts = [`[スタンプ: ${reactionEmoji}]`];
  if (pureReplyText) logReplyParts.push(pureReplyText);
  if (executedNotices.length > 0) logReplyParts.push(executedNotices.join('\n'));
  const loggedAiReply = logReplyParts.join('\n\n');

  let loggedUserText = userText;
  if (aiResult.image_summary && String(aiResult.image_summary).trim() !== '') {
    const desc = `[画像内容: ${String(aiResult.image_summary).trim()}]`;
    loggedUserText = loggedUserText ? `${loggedUserText}\n${desc}` : desc;
  }

  const workBoundary = getWorkModeAndBoundary(now, memory.profile);
  const shouldRefreshDeck = deckNeedsRefresh === true ||
    (deckNeedsRefresh === 'check_low_cards' && composeHomeDeck(workBoundary.workMode, now, fastState).cards.length < 3);

  try {
    const logMeta = Object.assign({}, turnOutcome.logMeta || {});
    logMeta.phaseTag = `${logMeta.phaseTag || 'chat'} | deckRefresh:${Boolean(shouldRefreshDeck)}`;
    appendLog(nowStr, 'user', loggedUserText, imageUrl, loggedAiReply, logMeta);
  } catch (logErr) {
    Logger.log('Chatログ追記エラー: ' + logErr.message);
  }

  const lists = buildListsSnapshot(null, now);
  fastState.listCache = lists;
  saveFastState(fastState, stateChanged);
  const deck = composeHomeDeck(workBoundary.workMode, now, fastState);

  return {
    authorized: true,
    mode: mode,
    reactionEmoji: reactionEmoji,
    replyText: mode === 'reply' ? pureReplyText : '',
    badges: parsedBadgesAndLinks.badges,
    docLinks: parsedBadgesAndLinks.docLinks,
    imageUrl: imageUrl,
    time: hhmm,
    nowStr: nowStr,
    lists: lists,
    state: fastState,
    deck: deck,
    needsDeckRefresh: Boolean(shouldRefreshDeck)
  };
}

/**
 * 6. Lists タブからの直接操作（Shopping の買えたトグル等）
 * @param {string} authKey
 * @param {Object} mutation { listType: 'shopping', action: 'toggle', rowIndex: number, done: boolean }
 * @return {Object}
 */
function apiMutateListItem(authKey, mutation) {
  if (!verifyDashboardAccess(authKey)) {
    return unauthorizedResponse_();
  }

  const m = mutation || {};
  const listType = String(m.listType || 'shopping');
  if (listType === 'shopping' && m.action === 'toggle' && m.rowIndex) {
    const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.SHOPPING);
    const nextStatus = m.done ? '購入済' : '未買';
    sheet.getRange(Number(m.rowIndex), 3).setValue(nextStatus);
    if (typeof invalidateSheetCache_ === 'function') invalidateSheetCache_('shopping');
  } else {
    throw new Error('未対応のリスト操作です。');
  }

  const now = new Date();
  const fastState = loadFastState(now);
  const lists = buildListsSnapshot(null, now);
  fastState.listCache = lists;
  saveFastState(fastState, false);

  return {
    authorized: true,
    lists: lists
  };
}

/**
 * 7. 「別の候補」で手札キャッシュが尽きた際の AI 追加生成
 * @param {string} authKey
 * @param {Array<string>=} excludeIds
 * @return {Object}
 */
function apiRefreshDeck(authKey, excludeIds) {
  if (!verifyDashboardAccess(authKey)) {
    return unauthorizedResponse_();
  }

  const now = new Date();
  const fastState = loadFastState(now);
  const memory = getMemory();
  const workBoundary = getWorkModeAndBoundary(now, memory.profile);

  const existingTitles = (fastState.aiDeck && Array.isArray(fastState.aiDeck.cards))
    ? fastState.aiDeck.cards.map(c => c.title)
    : [];
  const excludes = (Array.isArray(excludeIds) ? excludeIds : []).concat(existingTitles);

  const freshDeck = generateAiDeck({
    reason: 'refresh',
    now: now,
    memory: memory,
    fastState: fastState,
    workMode: workBoundary.workMode,
    todayEvents: workBoundary.todayEvents,
    boundaryInfo: workBoundary.boundaryInfo,
    excludeTitles: excludes,
    useFlashModel: false
  });

  // 既存未消化カードのうち除外対象外を残しつつ新規候補を優先配置
  const excludeSet = {};
  (Array.isArray(excludeIds) ? excludeIds : []).forEach(id => { excludeSet[String(id)] = true; });
  const oldKept = ((fastState.aiDeck && fastState.aiDeck.cards) || []).filter(c => c && !excludeSet[c.id]);
  const seen = {};
  const mergedCards = [];
  freshDeck.cards.concat(oldKept).forEach(c => {
    if (c && c.id && !seen[c.id]) {
      seen[c.id] = true;
      mergedCards.push(c);
    }
  });

  fastState.aiDeck = {
    generatedAt: freshDeck.generatedAt,
    cards: mergedCards,
    lowCards: (freshDeck.lowCards && freshDeck.lowCards.length > 0)
      ? freshDeck.lowCards
      : ((fastState.aiDeck && fastState.aiDeck.lowCards) || [])
  };
  saveFastState(fastState, true);

  const deck = composeHomeDeck(workBoundary.workMode, now, fastState);
  return {
    authorized: true,
    aiDeck: fastState.aiDeck,
    deck: deck
  };
}

// =============================================================================
// 3. 内部ヘルパー関数
// =============================================================================

/**
 * 認証失敗レスポンス生成
 * @private
 */
function unauthorizedResponse_() {
  return {
    authorized: false,
    error: '認証キーが正しくありません。設定画面からオーナー認証キーを確認してください。'
  };
}

/**
 * Geminiエラーのユーザー向け分類（デバッグ・フロント表示互換用）
 * @param {Error} geminiErr
 * @return {{ code: string, message: string }}
 */
function classifyGeminiError_(geminiErr) {
  const errStr = String((geminiErr && geminiErr.message) || geminiErr || '');
  if (errStr.includes('429') || errStr.includes('RESOURCE_EXHAUSTED') || errStr.includes('quota') || errStr.includes('Credit')) {
    return {
      code: 'QUOTA',
      message: 'Gemini APIの利用クォータ上限に達しました。Google AI Studioの残高をご確認ください。'
    };
  }
  if (errStr.includes('503') || errStr.includes('UNAVAILABLE') || errStr.includes('high demand')) {
    return {
      code: 'UNAVAILABLE',
      message: 'AIサーバーが一時的に混雑しています。少し置いてもう一度お試しください。'
    };
  }
  if (errStr.includes('401') || errStr.includes('403') || errStr.includes('API key')) {
    return {
      code: 'AUTH',
      message: 'Gemini APIキーの認証に失敗しました。'
    };
  }
  return {
    code: 'UNKNOWN',
    message: `応答中にエラーが発生しました: ${errStr.substring(0, 100)}`
  };
}

/**
 * AI返答文に混入した手動通知風行を除去（二重表示防止）
 * @param {string} text
 * @return {string}
 * @private
 */
function stripManualNoticeLines_(text) {
  return String(text || '').split('\n').filter(line => {
    const trimmed = line.trim();
    return !/^(📝\s*タスク追加|📝\s*タスク更新|✅\s*タスク完了|🗑️\s*タスク破棄|📅\s*カレンダー|🛒\s*買物|🎬\s*インプット|🔄\s*ルーティン|📁\s*フォルダ作成|📄\s*資料|🔗\s*タスク紐付)/.test(trimmed);
  }).join('\n').trim();
}

/**
 * 通知配列からバッジ文字列配列とGoogle Docs/Driveリンク一覧を抽出
 * @param {Array<string>} noticeLines
 * @return {{ badges: Array<string>, docLinks: Array<{ label: string, url: string }> }}
 * @private
 */
function extractBadgesAndDocLinks_(noticeLines) {
  const badges = [];
  const docLinks = [];
  const seenUrls = {};
  const docUrlRegex = /(https:\/\/(?:docs\.google\.com\/document|drive\.google\.com\/drive\/folders)\/[^\s)\]]+)/g;

  for (let i = 0; i < (noticeLines || []).length; i++) {
    let line = String(noticeLines[i] || '').trim();
    if (!line) continue;
    const matches = line.match(docUrlRegex);
    if (matches && matches.length > 0) {
      for (let m = 0; m < matches.length; m++) {
        const url = matches[m];
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
          docLinks.push({ label: label, url: url });
        }
        line = line.replace(url, '').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim();
      }
    }
    if (line) {
      badges.push(line);
    }
  }
  return { badges: badges, docLinks: docLinks };
}

/**
 * 論理日当日ログ配列を高密度プロンプトテキストへ圧縮
 * @param {Array<Object>} logsList
 * @return {string}
 * @private
 */
function buildCondensedLogsFromArray_(logsList) {
  if (!logsList || logsList.length === 0) return '';
  const lines = [];
  const valid = logsList.filter(l => l && l.message && String(l.message).trim() !== '');
  for (let i = 0; i < valid.length; i++) {
    const l = valid[i];
    const ts = String(l.timestampStr || '');
    const hhmm = ts.length >= 16 ? ts.substring(11, 16) : '';
    lines.push((hhmm ? hhmm + ' ' : '') + 'User: ' + String(l.message).trim());
    if (l.aiReply && String(l.aiReply).trim()) {
      const cleaned = String(l.aiReply)
        .split('\n')
        .filter(line => {
          const t = line.trim();
          return t && !/^\[スタンプ:/.test(t) &&
            !/^(📝|✅|🗑️|📅|🛒|🎬|🔄|📌)/.test(t);
        })
        .join(' ')
        .trim();
      if (cleaned) {
        const isRecent = (i >= valid.length - 4);
        lines.push('AI: ' + (isRecent || cleaned.length <= 80 ? cleaned : cleaned.substring(0, 80) + '...'));
      }
    }
  }
  return lines.join('\n');
}

/**
 * logs シート 1行分のオブジェクトから PWA ChatUI 向けメッセージオブジェクトを構築
 * @param {Object} entry
 * @return {Object}
 * @private
 */
function buildChatLogEntryObject_(entry) {
  const tsStr = String(entry.timestampStr || '');
  const hhmm = tsStr.length >= 16 ? tsStr.substring(11, 16) : '';
  const userText = String(entry.message || '')
    .replace(/\n?\[画像内容:[\s\S]*$/g, '')
    .trim();
  const imageUrls = String(entry.imageUrl || '')
    .split('\n')
    .map(u => u.trim())
    .filter(Boolean);

  const lines = String(entry.aiReply || '').split('\n');
  let reactionEmoji = '';
  const bodyLines = [];
  const noticeLines = [];
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
  const parsedNotices = extractBadgesAndDocLinks_(noticeLines);

  return {
    id: entry.id || ('LOG_' + tsStr),
    time: hhmm,
    timestampStr: tsStr,
    userText: userText,
    imageUrls: imageUrls,
    reactionEmoji: reactionEmoji,
    aiText: aiText,
    badges: parsedNotices.badges,
    docLinks: parsedNotices.docLinks
  };
}

/**
 * 論理日（03:00〜翌02:59）の Chat メッセージ配列を構築
 * @param {Date=} nowOpt
 * @return {Array<Object>}
 * @private
 */
function buildChatMessagesFromLogicalTodayLogs_(nowOpt) {
  const logs = getLogicalTodayLogs(nowOpt);
  return logs
    .filter(entry => entry.sender !== 'system')
    .map((entry, idx) => {
      const item = buildChatLogEntryObject_(entry);
      item.id = `LOG_${idx}_${item.time}`;
      return item;
    });
}

/**
 * 手動テスト/Setup.js互換用: デイリーブリーフィング文字列を組み立てる
 * @return {string}
 */
function buildDailyBriefingText() {
  const now = new Date();
  const memory = getMemory();
  const workBoundary = getWorkModeAndBoundary(now, memory.profile);
  const todayStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
  const b = buildDailyBriefingObj(
    memory.weather_info,
    memory.pressure_alert,
    workBoundary.workMode,
    workBoundary.todayEvents,
    getTasks('未完了'),
    todayStr
  );
  return `[${b.kicker}]\n` + b.lines.join('\n');
}
