/**
 * home-view.js - Home deck rendering, triage cards, custom card slider, focus & reflection
 */

function getActiveTaskIdSet() {
  if (!state.lists || !Array.isArray(state.lists.tasks) || state.lists.tasks.length === 0) {
    return null;
  }
  var set = {};
  state.lists.tasks.forEach(function(t) {
    if (t && t.id) set[t.id] = true;
  });
  return set;
}

function findDeckCardById(cardId) {
  if (!cardId || !state.composedDeck) return null;
  var cards = state.composedDeck.cards || [];
  var found = cards.find(function(c) { return c && c.id === cardId; });
  if (found) return found;
  var lowCards = state.composedDeck.lowCards || [];
  return lowCards.find(function(c) { return c && c.id === cardId; }) || null;
}

function isDeckCardAvailable(c, completed, dismissed, activeTaskIds) {
  if (!c || !c.id) return false;
  if (!c.isSleepCard && (completed[c.id] || (c.linkedId && completed[c.linkedId]))) return false;
  if (dismissed[c.id]) return false;
  if (activeTaskIds && c.linkedType === 'task' && c.linkedId && !activeTaskIds[c.linkedId]) return false;
  return true;
}

var DECK_PAGE_SIZE = 3;

function getAvailableDeckCards() {
  var completed = state.fastState.completedToday || {};
  var dismissed = state.fastState.dismissedToday || {};
  var activeTaskIds = getActiveTaskIdSet();
  var pool = state.fastState.isLowMode
    ? (state.composedDeck.lowCards || [])
    : (state.composedDeck.cards || []);
  return pool.filter(function(c) {
    if (state.fastState.pausedSession && c.id === state.fastState.pausedSession.id) return false;
    if (!isDeckCardAvailable(c, completed, dismissed, activeTaskIds)) return false;
    if (c.isTriage && state.fastState.triagedToday) return false;
    return true;
  });
}

function getVisibleDeckCards() {
  return getAvailableDeckCards();
}

function getDeckPaginationState() {
  var validCards = getAvailableDeckCards();
  var itemsWithGenerate = validCards.concat([{ __isGenerateMore: true }]);
  var totalPages = Math.max(1, Math.ceil(itemsWithGenerate.length / DECK_PAGE_SIZE));
  var currentPage = Math.max(0, Math.min(totalPages - 1, Number(state.deckPage) || 0));
  state.deckPage = currentPage;
  var start = currentPage * DECK_PAGE_SIZE;
  return {
    validCards: validCards,
    totalPages: totalPages,
    page: currentPage,
    pageItems: itemsWithGenerate.slice(start, start + DECK_PAGE_SIZE)
  };
}

function renderDurSliderHtml(sliderId, displayId, oninputFn, currentMins) {
  var idx = 0;
  var bestDiff = Infinity;
  for (var i = 0; i < CUSTOM_DUR_STEPS.length; i++) {
    var d = Math.abs(CUSTOM_DUR_STEPS[i] - (currentMins || 30));
    if (d < bestDiff) { bestDiff = d; idx = i; }
  }
  return (
    '<div class="dur-slider-wrap">' +
      '<div class="dur-slider-head">' +
        '<span id="' + displayId + '" class="dur-slider-val">' + formatCustomDurLabel(CUSTOM_DUR_STEPS[idx]) + '</span>' +
      '</div>' +
      '<input id="' + sliderId + '" type="range" class="dur-slider" min="0" max="' + (CUSTOM_DUR_STEPS.length - 1) + '" step="1" value="' + idx + '" oninput="' + oninputFn + '(this.value)" />' +
      '<div class="dur-slider-ticks">' +
        '<span>5分</span>' +
        '<span style="left:27.3%;">30分</span>' +
        '<span style="left:45.5%;">1時間</span>' +
        '<span style="left:63.6%;">2時間</span>' +
        '<span>6時間</span>' +
      '</div>' +
    '</div>'
  );
}

function renderHome() {
  var metaEl = document.getElementById('homeMeta');
  if (metaEl) metaEl.textContent = state.weatherLine || '横浜・磯子';

  var boundaryEl = document.getElementById('homeBoundary');
  if (state.boundary) {
    if (state.boundary.targetMs) {
      boundaryEl.innerHTML =
        '<div class="boundary-next-row"><span class="boundary-next-dot"></span><span>' + escapeHtml(state.boundary.label) + '</span></div>' +
        '<h1 id="homeCountdown" class="boundary-countdown">' + formatCountdownHMS((state.boundary.targetMs - Date.now()) / 1000) + '</h1>';
    } else {
      boundaryEl.innerHTML =
        '<div class="boundary-next-row"><span class="boundary-next-dot"></span><span>' + escapeHtml(state.boundary.label || '夜の区切り') + '</span></div>' +
        '<h1 class="boundary-sleep-text">' + escapeHtml(state.boundary.textOnly || 'そろそろ就寝の時間') + '</h1>';
    }
  } else {
    boundaryEl.innerHTML = '';
  }

  var subEl = document.getElementById('homeSubLine');
  var sess = state.fastState.activeSession;
  var pendingCount = (state.pendingOutbox && state.pendingOutbox.length) || 0;
  if (pendingCount > 0 && !sess && !state.reflection) {
    if (state.outboxLastError) {
      subEl.textContent = '未同期 ' + pendingCount + '件（エラー: ' + state.outboxLastError + ' / タップで再送・設定）';
      subEl.onclick = function() { openSettingsModal('同期エラー: ' + state.outboxLastError); };
    } else {
      subEl.textContent = '未同期の記録が' + pendingCount + '件あります（タップで今すぐ同期）';
      subEl.onclick = function() { syncFromServer(true); };
    }
    subEl.style.cursor = 'pointer';
    subEl.classList.remove('hidden');
  } else if (state.deltaText && !sess && !state.reflection) {
    subEl.textContent = state.deltaText;
    subEl.onclick = null;
    subEl.style.cursor = '';
    subEl.classList.remove('hidden');
  } else {
    subEl.onclick = null;
    subEl.style.cursor = '';
    subEl.classList.add('hidden');
  }

  var bSlot = document.getElementById('briefingSlot');
  var br = state.fastState.dailyBriefing;
  if (br && !br.dismissed && !sess && !state.reflection) {
    bSlot.innerHTML =
      '<div class="briefing-card glass-surface fade-in">' +
        '<div class="briefing-top">' +
          '<span class="briefing-kicker">' + getIconSvg('sun', 14) + ' ' + escapeHtml(br.kicker || '今朝のブリーフィング') + '</span>' +
          '<button onclick="dismissBriefing()" class="briefing-close" aria-label="閉じる">' + getIconSvg('x', 14) + '</button>' +
        '</div>' +
        (br.lines || []).map(function(ln) {
          return '<div class="briefing-line">' + escapeHtml(ln) + '</div>';
        }).join('') +
      '</div>';
  } else {
    bSlot.innerHTML = '';
  }

  var center = document.getElementById('homeCenterArea');

  if (state.reflection) {
    var r = state.reflection;
    var chips = FEELING_CHIPS.map(function(ch) {
      var cls = r.feeling === ch ? 'feeling-chip selected' : 'feeling-chip';
      return '<button type="button" onclick="toggleFeeling(\'' + escapeJsAttr(ch) + '\')" class="' + cls + '">' + escapeHtml(ch) + '</button>';
    }).join('');
    var photoHtml = r.photoDataUrl
      ? '<div class="attach-preview-bar"><div class="attach-thumb-wrap"><img src="' + r.photoDataUrl + '" class="attach-thumb" alt="添付写真" /><button type="button" onclick="clearReflectPhoto()" class="attach-remove-btn" aria-label="削除">×</button></div></div>'
      : '';
    var startMs = r.startedMs || (r.card && r.card.startedAtMs) || (Date.now() - (r.usedMins || 1) * 60000);
    var endMs = r.endedMs || Date.now();
    r.startedMs = startMs;
    r.endedMs = endMs;
    var sVal = formatTimeInputHm_(startMs);
    var eVal = formatTimeInputHm_(endMs);
    var reflectAdjustHtml = !r.isAdjustOpen
      ? '<div class="time-adjust-wrap"><button type="button" class="time-adjust-toggle" onclick="toggleReflectTimeAdjust(true)">✎ 時間を調整（' + sVal + ' 〜 ' + eVal + '）</button></div>'
      : '<div class="time-adjust-wrap"><div class="glass-surface time-adjust-panel fade-in">' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;">' +
            '<label style="font-size:12px;color:var(--dc-text-sub);display:flex;align-items:center;gap:6px;">開始 <input id="reflectStartTimeInput" type="time" class="time-adjust-input" value="' + sVal + '" /></label>' +
            '<span style="color:var(--dc-text-sub);">〜</span>' +
            '<label style="font-size:12px;color:var(--dc-text-sub);display:flex;align-items:center;gap:6px;">終了 <input id="reflectEndTimeInput" type="time" class="time-adjust-input" value="' + eVal + '" /></label>' +
          '</div>' +
          '<div style="display:flex;gap:8px;justify-content:center;">' +
            '<button type="button" class="btn-soft" onclick="toggleReflectTimeAdjust(false)">キャンセル</button>' +
            '<button type="button" class="btn-solid" onclick="applyReflectTimeAdjust()">適用</button>' +
          '</div>' +
        '</div></div>';
    center.innerHTML =
      '<div class="reflect-view fade-in">' +
        '<h2 class="reflect-heading">' + (r.card.isSleepCard ? 'おはようございます' : 'お疲れさまでした') + '</h2>' +
        '<div class="reflect-sub">' + escapeHtml(r.card.title) + (r.card.isSleepCard ? '' : ' · ' + r.usedMins + '分') + '</div>' +
        reflectAdjustHtml +
        '<div class="feeling-row">' + chips + '</div>' +
        photoHtml +
        '<div class="reflect-input-row">' +
          '<input id="reflectPhotoInput" type="file" accept="image/*" class="hidden" onchange="handleReflectPhotoSelect(event)" />' +
          '<button type="button" onclick="document.getElementById(\'reflectPhotoInput\').click()" class="attach-btn-glass" aria-label="写真を添付">' + getIconSvg('camera', 18) + '</button>' +
          '<input id="reflectNoteInput" type="text" class="reflect-input" placeholder="ひとこと感想（書かなくてもOK）" value="' + escapeHtml(r.note || '') + '" oninput="if(state.reflection) state.reflection.note=this.value;" />' +
        '</div>' +
        (r.card && (r.card.linkedType === 'task' || r.card.linkedType === 'stock')
          ? '<div style="display:flex;flex-direction:column;gap:8px;width:100%;">' +
              '<button type="button" id="reflectKeepOpenBtn" onclick="completeReflection(true)" class="btn-next-full" style="background:rgba(255,255,255,0.45);color:var(--text-primary);border:1px solid rgba(255,255,255,0.6);"' + (state.isSubmittingReflect ? ' disabled' : '') + '>' + (state.isSubmittingReflect ? '記録中…' : '今日はここまで（未完のまま記録）') + '</button>' +
              '<button type="button" id="reflectNextBtn" onclick="completeReflection(false)" class="btn-next-full"' + (state.isSubmittingReflect ? ' disabled' : '') + '>' + (state.isSubmittingReflect ? '記録中…' : '完了にする（やり切った）') + '</button>' +
            '</div>'
          : '<button type="button" id="reflectNextBtn" onclick="completeReflection(false)" class="btn-next-full"' + (state.isSubmittingReflect ? ' disabled' : '') + '>' + (state.isSubmittingReflect ? '記録中…' : 'つぎへ') + '</button>') +
      '</div>';
    return;
  }

  if (sess) {
    var elSec = Math.max(0, Math.floor((Date.now() - (sess.startedAtMs || Date.now()) - (sess.pausedDurationMs || 0)) / 1000));
    var showBreak = Math.floor(elSec / 60) >= 60 && !sess.isWorkBlock && !sess.isSleepCard;
    var sValActive = formatTimeInputHm_(sess.startedAtMs || Date.now());
    var activeAdjustHtml = !state.isStartAdjustOpen
      ? '<div class="time-adjust-wrap"><button type="button" class="time-adjust-toggle" onclick="toggleStartTimeAdjust(true)">✎ 開始時刻を調整（' + sValActive + '〜）</button></div>'
      : '<div class="time-adjust-wrap"><div class="glass-surface time-adjust-panel fade-in">' +
          '<div style="display:flex;align-items:center;justify-content:center;gap:8px;">' +
            '<span style="font-size:12px;color:var(--dc-text-sub);">開始時刻</span>' +
            '<input id="activeStartTimeInput" type="time" class="time-adjust-input" value="' + sValActive + '" />' +
          '</div>' +
          '<div style="display:flex;gap:8px;justify-content:center;">' +
            '<button type="button" class="btn-soft" onclick="toggleStartTimeAdjust(false)">キャンセル</button>' +
            '<button type="button" class="btn-solid" onclick="applyStartTimeAdjust()">適用</button>' +
          '</div>' +
        '</div></div>';
    center.innerHTML =
      '<div class="focus-view fade-in">' +
        '<h2 class="focus-title">' + escapeHtml(sess.title) + '</h2>' +
        '<div class="focus-dial">' +
          '<div class="focus-dial-inner">' +
            '<span class="focus-kicker">' + getIconSvg(sess.icon || 'compass', 13) + ' ' + (sess.isSleepCard ? 'おやすみ中' : '進行中') + '</span>' +
            '<div id="focusTimerText" class="focus-timer">' + formatTimer(elSec) + '</div>' +
          '</div>' +
        '</div>' +
        '<div id="focusGentleNote" class="focus-gentle-note' + (showBreak ? '' : ' hidden') + '">そろそろ一息入れませんか</div>' +
        '<div class="focus-actions">' +
          '<button onclick="pauseFocus()" class="btn-pause-soft">キャンセル</button>' +
          (!sess.isSleepCard && !state.fastState.pausedSession ? '<button type="button" onclick="pauseActiveToHold()" class="btn-pause-soft">一時停止</button>' : '') +
          '<button onclick="finishFocus()" class="btn-done-pill">' + (sess.isSleepCard ? '起きた' : '終わった') + '</button>' +
        '</div>' +
        activeAdjustHtml +
      '</div>';
    return;
  }

  var deckPageState = getDeckPaginationState();
  var pageItems = deckPageState.pageItems;
  var parts = [];
  if (state.fastState.pausedSession) {
    var ps = state.fastState.pausedSession;
    var pElSec = Math.max(0, Math.floor(((ps.pausedAtMs || Date.now()) - (ps.startedAtMs || Date.now()) - (ps.pausedDurationMs || 0)) / 1000));
    var pMin = Math.floor(pElSec / 60);
    var pSec = pElSec % 60;
    var pLabel = pMin + '分' + (pSec < 10 ? '0' : '') + pSec + '秒';
    parts.push(
      '<div class="glass-surface paused-session-bar fade-in">' +
        '<div class="paused-session-info">' +
          '<span class="paused-session-badge">⏸ 中断中</span>' +
          '<span class="paused-session-title">' + escapeHtml(ps.title || '') + ' (' + pLabel + ')</span>' +
        '</div>' +
        '<div class="paused-session-actions">' +
          '<button type="button" class="btn-solid paused-session-btn" onclick="resumePausedSession()">再開</button>' +
          '<button type="button" class="btn-soft paused-session-btn" onclick="completePausedSession()">完了</button>' +
          '<button type="button" class="btn-soft paused-session-btn" onclick="discardPausedSession()" aria-label="破棄">×</button>' +
        '</div>' +
      '</div>'
    );
  }
  parts.push('<div class="cards-stack fade-in">');
  pageItems.forEach(function(c) {
    if (c.__isGenerateMore) {
      var isGen = Boolean(state.isRefreshingDeck);
      var genIcon = isGen
        ? '<span class="spinning" style="display:inline-flex;">' + getIconSvg('refresh', 18) + '</span>'
        : getIconSvg('sparkles', 18);
      var genTitle = isGen ? '新しい候補を生成しています…' : '別の候補を生成する';
      var genRight = isGen ? '' : '<span class="card-right">' + getIconSvg('plus', 15) + '</span>';
      parts.push(
        '<button type="button" class="action-card generate-more-card' + (isGen ? ' is-loading' : '') + '" onclick="generateMoreDeckCards()"' + (isGen ? ' disabled' : '') + '>' +
          '<div class="card-icon-badge">' + genIcon + '</div>' +
          '<div class="card-body">' +
            '<div class="card-row1"><span class="card-title">' + genTitle + '</span>' + genRight + '</div>' +
          '</div>' +
        '</button>'
      );
      return;
    }
    var cls = c.isTriage ? 'action-card triage' : 'action-card';
    var rightHtml = c.isTriage
      ? '<span class="card-right triage-badge">' + escapeHtml(c.rightLabel || '引き算') + ' ' + getIconSvg('chevron', 14) + '</span>'
      : '<span class="card-right">' +
          (c.isSleepCard ? '' : '<button type="button" onclick="event.stopPropagation();openCardDurAdjust(\'' + escapeJsAttr(c.id) + '\')" style="background:rgba(139,92,246,0.12);border:none;border-radius:999px;color:inherit;font:inherit;font-weight:600;padding:6px 10px;margin:-4px 2px -4px 0;cursor:pointer;" title="開始前に所要時間を調整">' + formatCustomDurLabel(c.mins) + '</button> ') +
          getIconSvg('chevron', 14) +
        '</span>';
    parts.push(
      '<div class="swipe-wrap" data-card-id="' + escapeHtml(c.id) + '">' +
        '<div class="swipe-behind">' +
          '<button type="button" onclick="dismissCardToday(\'' + escapeJsAttr(c.id) + '\')" class="swipe-dismiss-btn">' +
            getIconSvg('eyeOff', 16) +
            '<span>今日は提案しない</span>' +
          '</button>' +
        '</div>' +
        '<div class="' + cls + '" role="button" tabindex="0">' +
          '<div class="card-icon-badge">' + getIconSvg(c.icon || 'compass', 18) + '</div>' +
          '<div class="card-body">' +
            '<div class="card-row1"><span class="card-title">' + escapeHtml(c.title) + '</span>' + rightHtml + '</div>' +
            '<div class="card-row2">' + escapeHtml(c.sub || '') + '</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  });
  parts.push('</div>');

  if (deckPageState.totalPages > 1) {
    var dotsHtml = '';
    for (var pi = 0; pi < deckPageState.totalPages; pi++) {
      dotsHtml += '<button type="button" class="deck-page-dot' + (pi === deckPageState.page ? ' active' : '') + '" onclick="setDeckPage(' + pi + ')" aria-label="' + (pi + 1) + 'ページ目へ"></button>';
    }
    parts.push(
      '<div class="deck-pager">' +
        '<button type="button" class="deck-page-btn" onclick="stepDeckPage(-1)" aria-label="前の候補"' + (deckPageState.page <= 0 ? ' disabled' : '') + '>' + getIconSvg('chevronLeft', 15) + '</button>' +
        '<div class="deck-page-center">' +
          '<div class="deck-page-dots">' + dotsHtml + '</div>' +
          '<span class="deck-page-label">' + (deckPageState.page + 1) + ' / ' + deckPageState.totalPages + '</span>' +
        '</div>' +
        '<button type="button" class="deck-page-btn" onclick="stepDeckPage(1)" aria-label="次の候補"' + (deckPageState.page >= deckPageState.totalPages - 1 ? ' disabled' : '') + '>' + getIconSvg('chevron', 15) + '</button>' +
      '</div>'
    );
  }

  parts.push(
    '<div class="subtle-actions">' +
      '<button onclick="toggleCustomForm()" class="text-link primary-link">' + getIconSvg('plus', 13) + ' 自分で始める</button>' +
      '<button onclick="toggleLowMode()" class="text-link">' + getIconSvg('cloud', 13) + ' ' + (state.fastState.isLowMode ? '通常に戻す' : '少しだるい') + '</button>' +
    '</div>'
  );

  if (state.adjustingCardId) {
    var adjCard = findDeckCardById(state.adjustingCardId);
    if (adjCard) {
      parts.push(
        '<div class="custom-create-card glass-surface fade-in">' +
          '<div style="font-size:13px;font-weight:600;color:var(--text-primary);">「' + escapeHtml(adjCard.title) + '」の見込み時間を調整</div>' +
          renderDurSliderHtml('adjustDurSlider', 'adjustDurDisplay', 'setAdjustDurStep', state.adjustingCardMins || adjCard.mins || 30) +
          '<div class="custom-btns">' +
            '<button type="button" onclick="confirmCardDurStart()" class="btn-solid">この時間で始める</button>' +
            '<button type="button" onclick="cancelCardDurAdjust()" class="btn-ghost">キャンセル</button>' +
          '</div>' +
        '</div>'
      );
    }
  }

  if (state.showCustomForm) {
    parts.push(
      '<form onsubmit="startCustomCard(event)" class="custom-create-card glass-surface fade-in">' +
        '<input id="customTitleInput" type="text" class="custom-input" placeholder="これから始めること（例：ギター練習）" />' +
        renderDurSliderHtml('customDurSlider', 'customDurDisplay', 'setCustomDurStep', state.customDurMins) +
        '<div class="custom-btns">' +
          '<button type="button" onclick="toggleCustomForm(false)" class="btn-soft">閉じる</button>' +
          '<button type="submit" class="btn-solid">始める</button>' +
        '</div>' +
      '</form>'
    );
  }

  center.innerHTML = parts.join('');
  bindSwipeHandlers();
}

function dismissBriefing() {
  if (state.fastState.dailyBriefing) {
    state.fastState.dailyBriefing.dismissed = true;
    state.fastState.dismissedToday['__briefing__'] = true;
    saveLocalSnapshot();
    renderHome();
    runMutationApi('apiDismissCardToday', state.authKey, '__briefing__').catch(function() {});
  }
}

function setDeckPage(page) {
  var totalPages = getDeckPaginationState().totalPages;
  var nextPage = Math.max(0, Math.min(totalPages - 1, Number(page) || 0));
  if (nextPage === state.deckPage) return;
  state.deckPage = nextPage;
  state.openSwipeId = null;
  renderHome();
}

function stepDeckPage(delta) {
  setDeckPage((Number(state.deckPage) || 0) + (Number(delta) || 0));
}

function generateMoreDeckCards() {
  if (state.isRefreshingDeck) return;
  var isLow = Boolean(state.fastState.isLowMode);
  var beforeCount = getAvailableDeckCards().length;
  var rawCards = isLow ? (state.composedDeck.lowCards || []) : (state.composedDeck.cards || []);
  var excludeIds = rawCards.map(function(c) { return c.id; });
  state.isRefreshingDeck = true;
  state.openSwipeId = null;
  renderHome();
  runMutationApi('apiRefreshDeck', state.authKey, excludeIds, { mode: 'append', isLowMode: isLow })
    .then(function(res) {
      state.isRefreshingDeck = false;
      if (res && res.authorized && !res._stale) {
        if (res.aiDeck) state.fastState.aiDeck = res.aiDeck;
        if (res.deck) state.composedDeck = res.deck;
        saveLocalSnapshot();
        var afterCount = getAvailableDeckCards().length;
        if (afterCount <= beforeCount) {
          showToast('これ以上新しい候補が見つかりませんでした');
        }
      }
      renderHome();
    })
    .catch(function() {
      state.isRefreshingDeck = false;
      showToast('候補の生成に失敗しました');
      renderHome();
    });
}

function toggleLowMode() {
  state.openSwipeId = null;
  state.deckPage = 0;
  state.fastState.isLowMode = !state.fastState.isLowMode;
  saveLocalSnapshot();
  renderHome();
}

function dismissCardToday(cardId) {
  var targetCard = findDeckCardById(cardId);
  var cardTitle = (targetCard && targetCard.title) ? String(targetCard.title).trim() : '';
  state.fastState.dismissedToday[cardId] = cardTitle || true;
  state.openSwipeId = null;
  saveLocalSnapshot();
  renderHome();
  showToast('今日は非表示にしました');
  runMutationApi('apiDismissCardToday', state.authKey, cardId, cardTitle)
    .then(function(res) {
      if (res && res.authorized && !res._stale && res.deck) {
        applyServerStatePayload(res);
        saveLocalSnapshot();
      }
    })
    .catch(function() {});
}

function toggleCustomForm(force) {
  state.showCustomForm = (typeof force === 'boolean') ? force : !state.showCustomForm;
  renderHome();
  if (state.showCustomForm) {
    var inp = document.getElementById('customTitleInput');
    if (inp) inp.focus();
  }
}

function startCustomCard(ev) {
  ev.preventDefault();
  var inp = document.getElementById('customTitleInput');
  var title = inp ? inp.value.trim() : '';
  if (!title) return;
  state.showCustomForm = false;
  startAction({
    id: 'custom_' + Date.now(),
    icon: 'compass',
    title: title,
    sub: '自分で始めた行動',
    mins: state.customDurMins,
    isCustom: true
  });
}

function openCardDurAdjust(cardId) {
  var card = findDeckCardById(cardId);
  if (!card) return;
  state.showCustomForm = false;
  state.adjustingCardId = cardId;
  state.adjustingCardMins = card.mins || 30;
  renderHome();
}

function setAdjustDurStep(stepIdx) {
  var idx = Math.max(0, Math.min(CUSTOM_DUR_STEPS.length - 1, Number(stepIdx) || 0));
  state.adjustingCardMins = CUSTOM_DUR_STEPS[idx];
  var disp = document.getElementById('adjustDurDisplay');
  if (disp) disp.textContent = formatCustomDurLabel(state.adjustingCardMins);
}

function cancelCardDurAdjust() {
  state.adjustingCardId = null;
  renderHome();
}

function confirmCardDurStart() {
  var card = findDeckCardById(state.adjustingCardId);
  state.adjustingCardId = null;
  if (!card) { renderHome(); return; }
  var updated = Object.assign({}, card, { mins: state.adjustingCardMins || card.mins || 30 });
  startAction(updated);
}

function handleCardClick(cardId) {
  var cards = getVisibleDeckCards();
  var card = cards.find(function(c) { return c.id === cardId; });
  if (!card) return;
  if (card.isTriage) {
    executeTriageCard(card);
    return;
  }
  state.pendingSessionLockUntil = Date.now() + 8000;
  startAction(card);
}

function executeTriageCard(card) {
  state.fastState.triagedToday = true;
  state.fastState.completedToday[card.id] = true;
  saveLocalSnapshot();
  renderHome();
  showToast('今日の残り負荷を軽くしました');
  enqueueOutboxMutation('apiCompleteAction', { session: card });
}

function startAction(card) {
  var started = Object.assign({}, card, { startedAtMs: Date.now() });
  state.fastState.activeSession = started;
  if (state.fastState.dailyBriefing) state.fastState.dailyBriefing.dismissed = true;
  state.openSwipeId = null;
  state.reflection = null;
  saveLocalSnapshot();
  renderHome();

  enqueueOutboxMutation('apiStartAction', started);
}

function pauseFocus() {
  state.pendingSessionLockUntil = Date.now() + 8000;
  state.fastState.activeSession = null;
  saveLocalSnapshot();
  renderHome();
  enqueueOutboxMutation('apiStartAction', null);
}

function pauseActiveToHold() {
  var sess = state.fastState && state.fastState.activeSession;
  if (!sess || sess.isSleepCard || state.fastState.pausedSession) return;
  state.pendingSessionLockUntil = Date.now() + 8000;
  var held = Object.assign({}, sess, { pausedAtMs: Date.now() });
  state.fastState.pausedSession = held;
  state.fastState.activeSession = null;
  saveLocalSnapshot();
  renderHome();
  enqueueOutboxMutation('apiPausedSession', { pausedSession: held, activeSession: null });
}

function resumePausedSession() {
  var ps = state.fastState && state.fastState.pausedSession;
  if (!ps) return;
  state.pendingSessionLockUntil = Date.now() + 8000;
  var nowMs = Date.now();
  var addedPause = Math.max(0, nowMs - (ps.pausedAtMs || nowMs));
  var resumed = Object.assign({}, ps, {
    pausedDurationMs: (ps.pausedDurationMs || 0) + addedPause
  });
  delete resumed.pausedAtMs;
  state.fastState.pausedSession = null;
  state.fastState.activeSession = resumed;
  saveLocalSnapshot();
  renderHome();
  enqueueOutboxMutation('apiPausedSession', { pausedSession: null, activeSession: resumed });
}

function completePausedSession() {
  var ps = state.fastState && state.fastState.pausedSession;
  if (!ps) return;
  state.pendingSessionLockUntil = Date.now() + 8000;
  var endMs = ps.pausedAtMs || Date.now();
  var startMs = ps.startedAtMs || endMs;
  var elMins = Math.max(1, Math.round((endMs - startMs - (ps.pausedDurationMs || 0)) / 60000));
  state.fastState.pausedSession = null;
  state.reflection = {
    card: ps,
    startedMs: startMs,
    endedMs: endMs,
    usedMins: elMins,
    feeling: '',
    note: '',
    photoDataUrl: '',
    photoBase64: '',
    photoMimeType: 'image/jpeg'
  };
  saveLocalSnapshot();
  renderHome();
  enqueueOutboxMutation('apiPausedSession', { pausedSession: null });
}

function discardPausedSession() {
  if (!state.fastState || !state.fastState.pausedSession) return;
  state.pendingSessionLockUntil = Date.now() + 8000;
  state.fastState.pausedSession = null;
  saveLocalSnapshot();
  renderHome();
  enqueueOutboxMutation('apiPausedSession', { pausedSession: null });
}

function formatTimeInputHm_(ms) {
  var d = new Date(ms || Date.now());
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function applyTimeInputToMs_(baseMs, timeStr) {
  var parts = String(timeStr || '').split(':');
  if (parts.length !== 2) return baseMs || Date.now();
  var d = new Date(baseMs || Date.now());
  d.setHours(Number(parts[0]), Number(parts[1]), 0, 0);
  if (d.getTime() > Date.now() + 60000) {
    d.setDate(d.getDate() - 1);
  }
  return d.getTime();
}

function toggleStartTimeAdjust(open) {
  state.isStartAdjustOpen = Boolean(open);
  renderHome();
}

function applyStartTimeAdjust() {
  var el = document.getElementById('activeStartTimeInput');
  var sess = state.fastState && state.fastState.activeSession;
  if (!el || !el.value || !sess) return;
  var newMs = applyTimeInputToMs_(sess.startedAtMs || Date.now(), el.value);
  sess.startedAtMs = newMs;
  sess.startedAtIso = new Date(newMs).toISOString();
  state.isStartAdjustOpen = false;
  saveLocalSnapshot();
  renderHome();
  enqueueOutboxMutation('apiStartAction', sess);
  showToast('開始時刻を ' + el.value + ' に更新しました');
}

function toggleReflectTimeAdjust(open) {
  if (!state.reflection) return;
  state.reflection.isAdjustOpen = Boolean(open);
  renderHome();
}

function applyReflectTimeAdjust() {
  var r = state.reflection;
  if (!r) return;
  var sEl = document.getElementById('reflectStartTimeInput');
  var eEl = document.getElementById('reflectEndTimeInput');
  if (sEl && sEl.value) {
    r.startedMs = applyTimeInputToMs_(r.startedMs, sEl.value);
    if (r.card) r.card.startedAtMs = r.startedMs;
  }
  if (eEl && eEl.value) r.endedMs = applyTimeInputToMs_(r.endedMs, eEl.value);
  r.usedMins = Math.max(1, Math.round((r.endedMs - r.startedMs) / 60000));
  r.isAdjustOpen = false;
  renderHome();
  showToast('実績時間を ' + r.usedMins + '分 に更新しました');
}

function finishFocus() {
  var sess = state.fastState.activeSession;
  if (!sess) return;
  var endMs = Date.now();
  var startMs = sess.startedAtMs || endMs;
  var elMins = Math.max(1, Math.round((endMs - startMs - (sess.pausedDurationMs || 0)) / 60000));
  state.isStartAdjustOpen = false;
  state.fastState.activeSession = null;
  state.reflection = {
    card: sess,
    startedMs: startMs,
    endedMs: endMs,
    usedMins: elMins,
    feeling: '',
    note: '',
    photoDataUrl: '',
    photoBase64: '',
    photoMimeType: 'image/jpeg'
  };
  renderHome();
}

function toggleFeeling(chip) {
  if (!state.reflection) return;
  state.reflection.feeling = state.reflection.feeling === chip ? '' : chip;
  renderHome();
}

function completeReflection(keepOpen) {
  if (!state.reflection || state.isSubmittingReflect) return;
  var r = state.reflection;
  var noteEl = document.getElementById('reflectNoteInput');
  var note = noteEl ? noteEl.value.trim() : (r.note || '').trim();

  // 楽観的UI: 即座にふりかえり画面を閉じてHomeへ戻り、裏でサーバーへ記録する
  state.pendingSessionLockUntil = Date.now() + 15000;
  state.reflection = null;
  state.fastState.activeSession = null;
  if (r.card && r.card.id && !r.card.isCustom && !r.card.isSleepCard) {
    state.fastState.completedToday[r.card.id] = true;
  }
  if (!keepOpen && r.card && r.card.linkedType === 'task' && r.card.linkedId) {
    state.fastState.completedToday[r.card.linkedId] = true;
  }
  saveLocalSnapshot();
  renderAll();
  showToast(keepOpen ? 'ここまでの進行を記録しました' : (r.feeling || note || r.photoBase64 ? '記録して次へ進みました' : 'お疲れさまでした'));

  enqueueOutboxMutation('apiCompleteAction', {
    session: r.card,
    mood: r.feeling,
    note: note,
    keepOpen: Boolean(keepOpen),
    startedAtMs: r.startedMs,
    endedAtMs: r.endedMs,
    usedMins: r.usedMins,
    photoBase64: r.photoBase64 || '',
    photoMimeType: r.photoMimeType || 'image/jpeg'
  });
}

function handleReflectPhotoSelect(ev) {
  var file = ev.target && ev.target.files && ev.target.files[0];
  if (!file || !state.reflection) return;
  compressImageToJpeg(file).then(function(res) {
    if (!state.reflection) return;
    state.reflection.photoDataUrl = res.dataUrl;
    state.reflection.photoBase64 = res.base64;
    state.reflection.photoMimeType = res.mimeType;
    renderHome();
  }).catch(function() { showToast('画像を読み込めませんでした'); });
  ev.target.value = '';
}

function clearReflectPhoto() {
  if (!state.reflection) return;
  state.reflection.photoDataUrl = '';
  state.reflection.photoBase64 = '';
  renderHome();
}

function bindSwipeHandlers() {
  var wraps = document.querySelectorAll('.swipe-wrap');
  wraps.forEach(function(wrap) {
    var cardId = wrap.getAttribute('data-card-id');
    var front = wrap.querySelector('.action-card');
    if (!front || !cardId) return;
    var startX = 0;
    var startY = 0;
    var baseOffset = (state.openSwipeId === cardId) ? -118 : 0;
    var currentOffset = baseOffset;
    var isTracking = false;
    var isHorizontal = null;

    if (state.openSwipeId === cardId) {
      wrap.classList.add('swipe-open');
      front.style.transform = 'translateX(-118px)';
    } else {
      wrap.classList.remove('swipe-open');
    }

    front.addEventListener('pointerdown', function(e) {
      if (e.button && e.button !== 0) return;
      startX = e.clientX;
      startY = e.clientY;
      baseOffset = (state.openSwipeId === cardId) ? -118 : 0;
      currentOffset = baseOffset;
      isTracking = true;
      isHorizontal = null;
      front.style.transition = 'none';
      try { front.setPointerCapture(e.pointerId); } catch (err) {}
    });

    front.addEventListener('pointermove', function(e) {
      if (!isTracking) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      if (isHorizontal === null) {
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          isHorizontal = Math.abs(dx) > Math.abs(dy);
          if (!isHorizontal) {
            isTracking = false;
            wrap.classList.remove('swiping');
            front.style.transition = '';
            return;
          }
        } else {
          return;
        }
      }
      currentOffset = Math.max(-148, Math.min(0, baseOffset + dx));
      wrap.classList.toggle('swiping', currentOffset < -4);
      front.style.transform = 'translateX(' + currentOffset + 'px)';
    });

    function finishPointer(e, canceled) {
      if (!isTracking) return;
      isTracking = false;
      try { front.releasePointerCapture(e.pointerId); } catch (err) {}
      wrap.classList.remove('swiping');
      front.style.transition = '';

      if (!canceled && isHorizontal !== true) {
        if (state.openSwipeId) {
          state.openSwipeId = null;
          renderHome();
          return;
        }
        if (e.target && e.target.closest && e.target.closest('button')) return;
        handleCardClick(cardId);
        return;
      }
      if (!canceled && currentOffset <= -108) {
        wrap.classList.add('swipe-open');
        front.style.transform = 'translateX(-100%)';
        setTimeout(function() { dismissCardToday(cardId); }, 140);
        return;
      }
      if (!canceled && currentOffset <= -44) {
        state.openSwipeId = cardId;
        wrap.classList.add('swipe-open');
        front.style.transform = 'translateX(-118px)';
      } else {
        if (state.openSwipeId === cardId) state.openSwipeId = null;
        wrap.classList.remove('swipe-open');
        front.style.transform = 'translateX(0px)';
      }
    }
    front.addEventListener('pointerup', function(e) { finishPointer(e, false); });
    front.addEventListener('pointercancel', function(e) { finishPointer(e, true); });
  });
}
