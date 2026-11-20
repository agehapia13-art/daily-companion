/**
 * home-view.js - Home deck rendering, triage cards, custom card slider, focus & reflection
 */

function getVisibleDeckCards() {
  var completed = state.fastState.completedToday || {};
  var dismissed = state.fastState.dismissedToday || {};
  var pool = state.fastState.isLowMode
    ? (state.composedDeck.lowCards || [])
    : (state.composedDeck.cards || []);
  var valid = pool.filter(function(c) {
    if (!c || !c.id) return false;
    if (completed[c.id] || dismissed[c.id]) return false;
    if (c.isTriage && state.fastState.triagedToday) return false;
    return true;
  });
  if (valid.length <= 3) return valid;
  var out = [];
  var start = state.deckOffset % valid.length;
  for (var i = 0; i < 3; i++) {
    out.push(valid[(start + i) % valid.length]);
  }
  return out;
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
  if (state.deltaText && !sess && !state.reflection) {
    subEl.textContent = state.deltaText;
    subEl.classList.remove('hidden');
  } else {
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
    center.innerHTML =
      '<div class="reflect-view fade-in">' +
        '<h2 class="reflect-heading">' + (r.card.isSleepCard ? 'おはようございます' : 'お疲れさまでした') + '</h2>' +
        '<div class="reflect-sub">' + escapeHtml(r.card.title) + (r.card.isSleepCard ? '' : ' · ' + r.usedMins + '分') + '</div>' +
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
    var elSec = Math.max(0, Math.floor((Date.now() - (sess.startedAtMs || Date.now())) / 1000));
    var showBreak = Math.floor(elSec / 60) >= 60 && !sess.isWorkBlock && !sess.isSleepCard;
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
          '<button onclick="finishFocus()" class="btn-done-pill">' + (sess.isSleepCard ? '起きた' : '終わった') + '</button>' +
        '</div>' +
      '</div>';
    return;
  }

  var cards = getVisibleDeckCards();
  var parts = ['<div class="cards-stack fade-in">'];
  if (state.isRefreshingDeck) {
    parts.push(
      '<div class="action-card" style="cursor:default;">' +
        '<div class="card-icon-badge">' + getIconSvg('refresh', 18) + '</div>' +
        '<div class="card-body">' +
          '<div class="card-row1"><span class="card-title">新しい候補を探しています…</span></div>' +
          '<div class="card-row2">反映まで少しお待ちください</div>' +
        '</div>' +
      '</div>'
    );
  } else if (cards.length === 0) {
    parts.push(
      '<div class="action-card" style="cursor:default;">' +
        '<div class="card-icon-badge">' + getIconSvg('checkCircle', 18) + '</div>' +
        '<div class="card-body">' +
          '<div class="card-row1"><span class="card-title">今の手札は落ち着いています</span></div>' +
          '<div class="card-row2">「別の候補」か「自分で始める」から選べます</div>' +
        '</div>' +
      '</div>'
    );
  } else {
    cards.forEach(function(c) {
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
  }
  parts.push('</div>');

  parts.push(
    '<div class="subtle-actions">' +
      '<button onclick="toggleCustomForm()" class="text-link primary-link">' + getIconSvg('plus', 13) + ' 自分で始める</button>' +
      '<button onclick="rotateDeck()" class="text-link">' + getIconSvg('shuffle', 13) + ' 別の候補</button>' +
      '<button onclick="toggleLowMode()" class="text-link">' + getIconSvg('cloud', 13) + ' ' + (state.fastState.isLowMode ? '通常に戻す' : '少しだるい') + '</button>' +
    '</div>'
  );

  if (state.adjustingCardId) {
    var adjCard = (state.composedDeck.cards || []).find(function(c) { return c && c.id === state.adjustingCardId; });
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
    saveLocalSnapshot();
    renderHome();
  }
}

function rotateDeck() {
  if (state.isRefreshingDeck) return;
  var completed = state.fastState.completedToday || {};
  var dismissed = state.fastState.dismissedToday || {};
  var pool = (state.composedDeck.cards || []).filter(function(c) {
    return c && c.id && !completed[c.id] && !dismissed[c.id];
  });
  var nextOffset = state.deckOffset + 3;
  if (nextOffset < pool.length) {
    state.deckOffset = nextOffset;
    state.openSwipeId = null;
    renderHome();
    return;
  }
  state.deckOffset = 0;
  state.isRefreshingDeck = true;
  renderHome();
  var excludeIds = pool.map(function(c) { return c.id; });
  callServerApi('apiRefreshDeck', state.authKey, excludeIds)
    .then(function(res) {
      state.isRefreshingDeck = false;
      if (res && res.authorized) {
        state.fastState.aiDeck = res.aiDeck;
        state.composedDeck = res.deck;
        saveLocalSnapshot();
      }
      renderHome();
    })
    .catch(function() {
      state.isRefreshingDeck = false;
      showToast('候補の更新に失敗しました');
      renderHome();
    });
}

function toggleLowMode() {
  state.openSwipeId = null;
  state.fastState.isLowMode = !state.fastState.isLowMode;
  saveLocalSnapshot();
  renderHome();
}

function dismissCardToday(cardId) {
  state.fastState.dismissedToday[cardId] = true;
  state.openSwipeId = null;
  saveLocalSnapshot();
  renderHome();
  showToast('今日は非表示にしました');
  callServerApi('apiDismissCardToday', state.authKey, cardId)
    .then(function(res) {
      if (res && res.authorized && res.deck) {
        state.fastState = res.state;
        state.composedDeck = res.deck;
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
  var card = (state.composedDeck.cards || []).find(function(c) { return c && c.id === cardId; });
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
  var card = (state.composedDeck.cards || []).find(function(c) { return c && c.id === state.adjustingCardId; });
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
  callServerApi('apiCompleteAction', state.authKey, { session: card })
    .then(function(res) {
      if (res && res.authorized) {
        applyServerStatePayload(res);
        renderAll();
      }
    })
    .catch(function() { showToast('リスケ同期に失敗しました'); });
}

function startAction(card) {
  var started = Object.assign({}, card, { startedAtMs: Date.now() });
  state.fastState.activeSession = started;
  if (state.fastState.dailyBriefing) state.fastState.dailyBriefing.dismissed = true;
  state.openSwipeId = null;
  state.reflection = null;
  saveLocalSnapshot();
  renderHome();

  callServerApi('apiStartAction', state.authKey, started)
    .then(function(res) {
      if (res && res.authorized) {
        if (res.aiDeck) state.fastState.aiDeck = res.aiDeck;
        if (res.deck) state.composedDeck = res.deck;
        if (res.boundary) state.boundary = res.boundary;
        saveLocalSnapshot();
      }
    })
    .catch(function() {});
}

function pauseFocus() {
  state.fastState.activeSession = null;
  saveLocalSnapshot();
  renderHome();
}

function finishFocus() {
  var sess = state.fastState.activeSession;
  if (!sess) return;
  var elMins = Math.max(1, Math.round((Date.now() - (sess.startedAtMs || Date.now())) / 60000));
  state.fastState.activeSession = null;
  state.reflection = {
    card: sess,
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
  state.pendingSessionLockUntil = Date.now() + 8000;
  state.reflection = null;
  state.fastState.activeSession = null;
  if (r.card && r.card.id && !r.card.isCustom) {
    state.fastState.completedToday[r.card.id] = true;
  }
  if (!keepOpen && r.card && r.card.linkedType === 'task' && r.card.linkedId) {
    state.fastState.completedToday[r.card.linkedId] = true;
  }
  saveLocalSnapshot();
  renderAll();
  showToast(keepOpen ? 'ここまでの進行を記録しました' : (r.feeling || note || r.photoBase64 ? '記録して次へ進みました' : 'お疲れさまでした'));

  callServerApi('apiCompleteAction', state.authKey, {
    session: r.card,
    mood: r.feeling,
    note: note,
    keepOpen: Boolean(keepOpen),
    photoBase64: r.photoBase64 || '',
    photoMimeType: r.photoMimeType || 'image/jpeg'
  })
    .then(function(res) {
      if (res && res.authorized) {
        applyServerStatePayload(res);
        if (res.addedChatMessage) {
          state.messages.push(res.addedChatMessage);
        }
        saveLocalSnapshot();
        renderAll();
      } else {
        showToast('記録の同期に失敗しました');
      }
    })
    .catch(function(err) {
      showToast('送信エラー: ' + (err.message || err));
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
