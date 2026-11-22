/**
 * chat-lists-view.js - Chat composer, Lists view, modals, navigation & DOM boot
 */

function switchTab(next) {
  state.tab = next;
  renderNav();
  if (next === 'home') renderHome();
  if (next === 'talk') {
    renderChat();
    scrollToChatBottom();
  }
  if (next === 'lists') renderLists();
}

function switchListSubTab(sub) {
  state.listSubTab = sub;
  renderLists();
}

function setTaskCategoryFilter(cat) {
  state.taskCategoryFilter = cat;
  renderLists();
}

function renderNav() {
  ['home', 'talk', 'lists'].forEach(function(t) {
    var panel = document.getElementById('tab-' + t);
    var btn = document.getElementById('nav-' + t);
    if (panel) panel.classList.toggle('hidden', state.tab !== t);
    if (btn) btn.classList.toggle('active', state.tab === t);
  });
  var comp = document.getElementById('sharedComposer');
  if (comp) comp.classList.toggle('hidden', state.tab === 'home');
}

function handleChatPhotoSelect(ev) {
  var file = ev.target && ev.target.files && ev.target.files[0];
  if (!file) return;
  compressImageToJpeg(file).then(function(res) {
    state.pendingChatPhoto = res;
    renderChatPhotoPreview();
  }).catch(function() { showToast('画像を読み込めませんでした'); });
  ev.target.value = '';
}

function clearChatPhoto() {
  state.pendingChatPhoto = null;
  renderChatPhotoPreview();
}

function renderChatPhotoPreview() {
  var bar = document.getElementById('chatPhotoPreview');
  if (!bar) return;
  if (!state.pendingChatPhoto) {
    bar.classList.add('hidden');
    bar.innerHTML = '';
    return;
  }
  bar.classList.remove('hidden');
  bar.innerHTML =
    '<div class="attach-thumb-wrap">' +
      '<img src="' + state.pendingChatPhoto.dataUrl + '" class="attach-thumb" alt="添付写真" />' +
      '<button type="button" onclick="clearChatPhoto()" class="attach-remove-btn" aria-label="写真を削除">×</button>' +
    '</div>';
}

function renderChat() {
  var list = document.getElementById('chatList');
  if (!list) return;
  if (state.messages.length === 0 && !state.isSending) {
    list.innerHTML = '<div class="chat-empty">今日の会話はまだありません</div>';
    return;
  }

  var html = state.messages.map(function(m) {
    if (m.isError) {
      return (
        '<div class="bubble-wrap ai fade-in">' +
          '<div class="error-card">' +
            '<div class="error-title">送信できませんでした</div>' +
            '<div>' + escapeHtml(m.errorText || '通信またはAIエラーが発生しました。') + '</div>' +
            '<div class="error-actions">' +
              '<button onclick="retryFailedMessage(\'' + escapeJsAttr(m.id) + '\')" class="btn-solid">再試行</button>' +
              '<button onclick="restoreFailedMessage(\'' + escapeJsAttr(m.id) + '\')" class="btn-soft">入力に戻す</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }

    var parts = [];
    var userImgs = (Array.isArray(m.imageUrls) && m.imageUrls.length > 0) ? m.imageUrls : (m.localPhotoUrl ? [m.localPhotoUrl] : []);
    if (m.userText || userImgs.length > 0) {
      var imgHtml = userImgs.map(function(u) {
        return '<img src="' + escapeHtml(u) + '" class="bubble-photo" alt="画像" onclick="openImageLightbox(\'' + escapeJsAttr(u) + '\')" />';
      }).join('');
      var uTextHtml = '';
      if (Array.isArray(m.tokens) && m.tokens.length > 0) {
        uTextHtml = m.tokens.map(function(tk) {
          return tk.type === 'pill'
            ? '<span class="inline-var-pill" data-kind="' + escapeHtml(tk.kind) + '">' + escapeHtml(tk.label) + '</span>'
            : linkifyEscapedText(tk.value);
        }).join('');
      } else if (m.userText) {
        uTextHtml = linkifyEscapedText(m.userText);
      }
      var reactHtml = m.reactionEmoji ? '<span class="reaction-chip">' + escapeHtml(m.reactionEmoji) + '</span>' : '';
      parts.push(
        '<div class="bubble-wrap user fade-in">' +
          '<div class="bubble">' + imgHtml + (uTextHtml ? '<div>' + uTextHtml + '</div>' : '') + '</div>' +
          reactHtml +
        '</div>'
      );
    }

    if (m.aiText || (m.badges && m.badges.length > 0) || (m.docLinks && m.docLinks.length > 0)) {
      var badgesHtml = (m.badges && m.badges.length > 0)
        ? '<div class="quiet-badges-row">' + m.badges.map(function(b) {
            return '<span class="quiet-badge">' + escapeHtml(b) + '</span>';
          }).join('') + '</div>'
        : '';
      var docsHtml = (m.docLinks && m.docLinks.length > 0)
        ? '<div class="doc-links-row">' + m.docLinks.map(function(dl) {
            return '<a href="' + escapeHtml(dl.url) + '" target="_blank" rel="noopener noreferrer" class="doc-link-btn"><span>📄 ' + escapeHtml(dl.label) + '</span><span>↗</span></a>';
          }).join('') + '</div>'
        : '';
      parts.push(
        '<div class="bubble-wrap ai fade-in">' +
          '<div class="bubble">' +
            (m.aiText ? '<div>' + linkifyEscapedText(m.aiText) + '</div>' : '') +
            badgesHtml +
            docsHtml +
          '</div>' +
          (m.time ? '<div class="bubble-time">' + escapeHtml(m.time) + '</div>' : '') +
        '</div>'
      );
    }
    return parts.join('');
  }).join('');

  if (state.isSending) {
    html += '<div class="bubble-wrap ai fade-in"><div class="thinking-bubble"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span></div></div>';
  }
  list.innerHTML = html;
}

function scrollToChatBottom() {
  var sc = document.getElementById('talkScroll');
  if (sc) setTimeout(function() { sc.scrollTop = sc.scrollHeight; }, 30);
}

function insertPillToSharedComposer(kind, itemId, label) {
  var editor = document.getElementById('talkEditor');
  if (!editor) return;
  var pill = document.createElement('span');
  pill.className = 'inline-var-pill';
  pill.setAttribute('contenteditable', 'false');
  pill.setAttribute('data-kind', kind);
  pill.setAttribute('data-id', itemId);
  pill.setAttribute('data-label', label);
  var txtSpan = document.createElement('span');
  txtSpan.textContent = label;
  var rm = document.createElement('span');
  rm.className = 'pill-remove';
  rm.textContent = '×';
  rm.onclick = function(e) { e.stopPropagation(); pill.remove(); };
  pill.appendChild(txtSpan);
  pill.appendChild(rm);
  editor.appendChild(pill);
  editor.appendChild(document.createTextNode(' '));

  setTimeout(function() {
    editor.focus();
    var range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }, 15);
}

function submitTalkEditor() {
  var editor = document.getElementById('talkEditor');
  if (!editor || state.isSending) return;

  var tokens = [];
  function collectEditorNodes(parentNode) {
    parentNode.childNodes.forEach(function(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        tokens.push({ type: 'text', value: node.textContent });
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.classList.contains('inline-var-pill')) {
          tokens.push({
            type: 'pill',
            kind: node.getAttribute('data-kind') || 'tasks',
            id: node.getAttribute('data-id') || '',
            label: node.getAttribute('data-label') || ''
          });
        } else if (node.tagName === 'BR') {
          tokens.push({ type: 'text', value: '\n' });
        } else {
          var isBlock = node.tagName === 'DIV' || node.tagName === 'P';
          if (isBlock && tokens.length > 0) {
            tokens.push({ type: 'text', value: '\n' });
          }
          collectEditorNodes(node);
        }
      }
    });
  }
  collectEditorNodes(editor);

  var plainText = tokens.map(function(t) {
    if (t.type !== 'pill') return t.value;
    return (t.kind === 'tasks' && t.id) ? ('「' + t.label + '」(ID:' + t.id + ')') : ('「' + t.label + '」');
  }).join('').trim();
  var photo = state.pendingChatPhoto;
  if (!plainText && !photo) return;

  editor.innerHTML = '';
  state.pendingChatPhoto = null;
  renderChatPhotoPreview();

  var msgObj = {
    id: 'MSG_' + Date.now(),
    userText: plainText,
    tokens: tokens,
    localPhotoUrl: photo ? photo.dataUrl : '',
    imageUrls: [],
    reactionEmoji: '',
    aiText: '',
    badges: [],
    docLinks: []
  };
  executeChatSend(msgObj, plainText, photo);
}

function executeChatSend(msgObj, plainText, photo) {
  if (state.messages.indexOf(msgObj) === -1) state.messages.push(msgObj);
  state.isSending = true;
  if (state.tab === 'lists') state.tab = 'talk';
  renderNav();
  renderChat();
  scrollToChatBottom();

  runMutationApi('apiSendChat', state.authKey, {
    text: plainText,
    imageBase64: photo ? photo.base64 : '',
    imageMimeType: photo ? photo.mimeType : ''
  })
    .then(function(res) {
      state.isSending = false;
      if (!res || !res.authorized) {
        throw new Error((res && res.error) ? res.error : '認証エラー');
      }
      msgObj.reactionEmoji = res.reactionEmoji || '';
      msgObj.aiText = res.replyText || '';
      msgObj.badges = Array.isArray(res.badges) ? res.badges : [];
      msgObj.docLinks = Array.isArray(res.docLinks) ? res.docLinks : [];
      msgObj.time = res.time || '';
      if (res.imageUrl) msgObj.imageUrls = [res.imageUrl];
      applyServerStatePayload(res);
      saveLocalSnapshot();
      renderAll();
      scrollToChatBottom();
      if (res.needsDeckRefresh) {
        runMutationApi('apiRefreshDeck', state.authKey, [])
          .then(function(deckRes) {
            if (deckRes && deckRes.authorized && deckRes.deck) {
              state.composedDeck = deckRes.deck;
              if (deckRes.state) state.fastState = deckRes.state;
              saveLocalSnapshot();
              if (state.tab === 'home') renderHome();
            }
          })
          .catch(function() {});
      }
    })
    .catch(function(err) {
      setTimeout(function() {
        callServerApi('apiGetHomeBootstrap', state.authKey)
          .then(function(boot) {
            if (boot && boot.authorized && Array.isArray(boot.chatMessages)) {
              var matched = null;
              for (var i = boot.chatMessages.length - 1; i >= 0; i--) {
                var cm = boot.chatMessages[i];
                if (cm && cm.userText && plainText && cm.userText.indexOf(plainText.slice(0, 20)) !== -1 && (cm.aiText || cm.reactionEmoji)) {
                  matched = cm;
                  break;
                }
              }
              if (matched) {
                state.isSending = false;
                applyServerStatePayload(boot);
                var localErrors = state.messages.filter(function(m) { return m.isError; });
                state.messages = boot.chatMessages.concat(localErrors);
                saveLocalSnapshot();
                renderAll();
                scrollToChatBottom();
                return;
              }
            }
            throw err;
          })
          .catch(function() {
            state.isSending = false;
            var errId = 'ERR_' + Date.now();
            state.failedPayloads[errId] = { msgObj: msgObj, plainText: plainText, photo: photo };
            state.messages.push({
              id: errId,
              isError: true,
              errorText: (err && err.message) ? err.message : String(err)
            });
            renderChat();
            scrollToChatBottom();
          });
      }, 1500);
    });
}

function retryFailedMessage(errId) {
  if (state.isSending) return;
  var saved = state.failedPayloads[errId];
  if (!saved) return;
  delete state.failedPayloads[errId];
  state.messages = state.messages.filter(function(m) { return m.id !== errId; });
  executeChatSend(saved.msgObj, saved.plainText, saved.photo);
}

function restoreFailedMessage(errId) {
  var saved = state.failedPayloads[errId];
  if (!saved) return;
  delete state.failedPayloads[errId];
  state.messages = state.messages.filter(function(m) { return m.id !== errId && m.id !== saved.msgObj.id; });
  var editor = document.getElementById('talkEditor');
  if (editor) editor.textContent = saved.plainText;
  if (saved.photo) {
    state.pendingChatPhoto = saved.photo;
    renderChatPhotoPreview();
  }
  renderChat();
}

function renderLists() {
  ['tasks', 'shopping', 'stock', 'habits'].forEach(function(k) {
    var btn = document.getElementById('seg-' + k);
    if (btn) btn.classList.toggle('active', state.listSubTab === k);
  });

  var catRow = document.getElementById('tasksCategoryRow');
  var container = document.getElementById('listsContent');

  if (state.listSubTab === 'tasks') {
    catRow.classList.remove('hidden');
    catRow.innerHTML = TASK_CATS.map(function(c) {
      var cls = state.taskCategoryFilter === c ? 'cat-chip active' : 'cat-chip';
      var label = c === 'ALL' ? 'すべて' : c;
      return '<button onclick="setTaskCategoryFilter(\'' + escapeJsAttr(c) + '\')" class="' + cls + '">' + escapeHtml(label) + '</button>';
    }).join('');

    var filtered = (state.lists.tasks || []).filter(function(t) {
      return state.taskCategoryFilter === 'ALL' || t.cat === state.taskCategoryFilter;
    });
    container.innerHTML = filtered.length === 0
      ? '<div class="chat-empty">該当するタスクはありません</div>'
      : filtered.map(function(t) {
          var metaParts = [];
          if (t.due) metaParts.push('期限: ' + t.due);
          if (t.mins) metaParts.push(t.mins + '分');
          if (t.done) metaParts.push('完了済');
          var durBtn = t.done
            ? ''
            : '<button type="button" onclick="event.stopPropagation();openListDurAdjust(\'task\',\'' + escapeJsAttr(t.id) + '\',' + (t.mins || 30) + ')" class="cat-chip" style="padding:4px 8px;font-size:11px;" title="所要時間を調整して開始">' + formatCustomDurLabel(t.mins || 30) + '</button>';
          var memoBtn = buildListMemoBtnHtml('task', t.id, t.memo);
          var docBtn = t.docUrl
            ? '<a href="' + escapeHtml(t.docUrl) + '" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" class="circle-action-btn" aria-label="資料を開く" title="資料を開く" style="text-decoration:none;">' + getIconSvg('fileText', 14) + '</a>'
            : '';
          var playBtn = t.done
            ? ''
            : '<button type="button" onclick="event.stopPropagation();startFromList(\'task\',\'' + escapeJsAttr(t.id) + '\')" class="circle-action-btn" aria-label="今すぐ始める">' + getIconSvg('play', 14) + '</button>';
          return (
            '<div class="list-item ' + (t.done ? 'done' : '') + '" onclick="insertPillToSharedComposer(\'tasks\',\'' + escapeJsAttr(t.id) + '\',\'' + escapeJsAttr(t.cleanTitle || t.title) + '\')">' +
              '<div class="list-item-main">' +
                '<div class="list-item-title">' + escapeHtml(t.title) + '</div>' +
                '<div class="list-item-meta">' + escapeHtml(metaParts.join(' · ') || t.cat) + '</div>' +
              '</div>' +
              '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">' + durBtn + memoBtn + docBtn + playBtn + '</div>' +
            '</div>' +
            renderListMemoCard('task', t.id, t.cleanTitle || t.title, t.memo) +
            renderListDurAdjustCard('task', t.id, t.cleanTitle || t.title)
          );
        }).join('');
    return;
  }

  catRow.classList.add('hidden');

  if (state.listSubTab === 'shopping') {
    var shops = state.lists.shopping || [];
    container.innerHTML = shops.length === 0
      ? '<div class="chat-empty">買い物リストは空です</div>'
      : shops.map(function(s) {
          return (
            '<div class="list-item ' + (s.done ? 'done' : '') + '" onclick="insertPillToSharedComposer(\'shopping\',\'' + escapeJsAttr(s.id) + '\',\'' + escapeJsAttr(s.item) + '\')">' +
              '<div class="list-item-main">' +
                '<div class="list-item-title">' + escapeHtml(s.item) + '</div>' +
                '<div class="list-item-meta">' + escapeHtml(s.cat || '日用品') + (s.done ? ' · 購入済' : '') + '</div>' +
              '</div>' +
              '<button type="button" onclick="event.stopPropagation();toggleShoppingDone(\'' + escapeJsAttr(s.id) + '\')" class="circle-action-btn" aria-label="購入済を切替">' + getIconSvg('check', 15) + '</button>' +
            '</div>'
          );
        }).join('');
    return;
  }

  if (state.listSubTab === 'stock') {
    var stocks = state.lists.stock || [];
    container.innerHTML = stocks.length === 0
      ? '<div class="chat-empty">インプットストックはありません</div>'
      : stocks.map(function(st) {
          var durBtn = st.done
            ? ''
            : '<button type="button" onclick="event.stopPropagation();openListDurAdjust(\'stock\',\'' + escapeJsAttr(st.id) + '\',' + (st.mins || 30) + ')" class="cat-chip" style="padding:4px 8px;font-size:11px;" title="所要時間を調整して開始">' + formatCustomDurLabel(st.mins || 30) + '</button>';
          var memoBtn = buildListMemoBtnHtml('stock', st.id, st.memo);
          var playBtn = st.done
            ? ''
            : '<button type="button" onclick="event.stopPropagation();startFromList(\'stock\',\'' + escapeJsAttr(st.id) + '\')" class="circle-action-btn" aria-label="今すぐ始める">' + getIconSvg('play', 14) + '</button>';
          return (
            '<div class="list-item ' + (st.done ? 'done' : '') + '" onclick="insertPillToSharedComposer(\'stock\',\'' + escapeJsAttr(st.id) + '\',\'' + escapeJsAttr(st.title) + '\')">' +
              '<div class="list-item-main">' +
                '<div class="list-item-title">[' + escapeHtml(st.type) + '] ' + escapeHtml(st.title) + '</div>' +
                '<div class="list-item-meta">' + (st.done ? '消化済' : st.mins + '分') + '</div>' +
              '</div>' +
              '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">' + durBtn + memoBtn + playBtn + '</div>' +
            '</div>' +
            renderListMemoCard('stock', st.id, st.title, st.memo) +
            renderListDurAdjustCard('stock', st.id, st.title)
          );
        }).join('');
    return;
  }

  var habits = state.lists.habits || [];
  container.innerHTML = habits.length === 0
    ? '<div class="chat-empty">周期・習慣記録はありません</div>'
    : habits.map(function(h) {
          var durBtn = '<button type="button" onclick="event.stopPropagation();openListDurAdjust(\'habits\',\'' + escapeJsAttr(h.id) + '\',' + (h.mins || 20) + ')" class="cat-chip" style="padding:4px 8px;font-size:11px;" title="所要時間を調整して開始">' + formatCustomDurLabel(h.mins || 20) + '</button>';
          return (
          '<div class="list-item" onclick="insertPillToSharedComposer(\'habits\',\'' + escapeJsAttr(h.id) + '\',\'' + escapeJsAttr(h.title) + '\')">' +
            '<div class="list-item-main">' +
              '<div class="list-item-title">' + escapeHtml(h.title) + '</div>' +
              '<div class="list-item-meta">' + escapeHtml(h.elapsed || '') + ' · ' + (h.mins || 20) + '分</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">' + durBtn +
            '<button type="button" onclick="event.stopPropagation();startFromList(\'habits\',\'' + escapeJsAttr(h.id) + '\')" class="circle-action-btn" aria-label="今すぐ始める">' + getIconSvg('play', 14) + '</button></div>' +
          '</div>' +
          renderListDurAdjustCard('habits', h.id, h.title)
        );
      }).join('');
}

function getListMemoCardId(kind, itemId) {
  return 'list-memo-card-' + kind + '-' + String(itemId).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function buildListMemoBtnHtml(kind, itemId, memo) {
  if (!memo || !String(memo).trim()) return '';
  var k = escapeJsAttr(kind);
  var id = escapeJsAttr(itemId);
  return '<button type="button"' +
    ' onclick="event.stopPropagation()"' +
    ' onpointerdown="event.stopPropagation();event.preventDefault();showListMemoPeek(\'' + k + '\',\'' + id + '\',this)"' +
    ' onpointerup="event.stopPropagation();hideListMemoPeek(\'' + k + '\',\'' + id + '\',this)"' +
    ' onpointercancel="event.stopPropagation();hideListMemoPeek(\'' + k + '\',\'' + id + '\',this)"' +
    ' onpointerleave="hideListMemoPeek(\'' + k + '\',\'' + id + '\',this)"' +
    ' oncontextmenu="event.preventDefault();event.stopPropagation()"' +
    ' onblur="hideListMemoPeek(\'' + k + '\',\'' + id + '\',this)"' +
    ' class="circle-action-btn" aria-label="長押しでメモを確認" title="押している間メモを表示"' +
    ' style="touch-action:none;user-select:none;-webkit-user-select:none;">' +
    getIconSvg('message', 14) + '</button>';
}

function showListMemoPeek(kind, itemId, btn) {
  var card = document.getElementById(getListMemoCardId(kind, itemId));
  if (card) card.style.display = 'block';
  if (btn) {
    btn.style.borderColor = 'var(--accent)';
    btn.style.color = 'var(--accent)';
  }
}

function hideListMemoPeek(kind, itemId, btn) {
  var card = document.getElementById(getListMemoCardId(kind, itemId));
  if (card) card.style.display = 'none';
  if (btn) {
    btn.style.borderColor = '';
    btn.style.color = '';
  }
}

function renderListMemoCard(kind, itemId, title, memo) {
  if (!memo || !String(memo).trim()) return '';
  return (
    '<div id="' + escapeHtml(getListMemoCardId(kind, itemId)) + '" class="custom-create-card glass-surface fade-in" style="margin:6px 0 10px;display:none;" onclick="event.stopPropagation()">' +
      '<div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;">メモ · ' + escapeHtml(title) + '</div>' +
      '<div style="font-size:13px;line-height:1.55;color:var(--text-primary);white-space:pre-wrap;word-break:break-word;">' + escapeHtml(String(memo).trim()) + '</div>' +
    '</div>'
  );
}

function renderListDurAdjustCard(kind, itemId, title) {
  if (!state.adjustingListItem || state.adjustingListItem.kind !== kind || state.adjustingListItem.id !== itemId) return '';
  return (
    '<div class="custom-create-card glass-surface fade-in" style="margin:6px 0 10px;">' +
      '<div style="font-size:13px;font-weight:600;color:var(--text-primary);">「' + escapeHtml(title) + '」の見込み時間を調整</div>' +
      renderDurSliderHtml('listDurSlider', 'listDurDisplay', 'setListDurStep', state.adjustingListMins || 30) +
      '<div class="custom-btns">' +
        '<button type="button" onclick="confirmListDurStart()" class="btn-solid">この時間で始める</button>' +
        '<button type="button" onclick="cancelListDurAdjust()" class="btn-ghost">キャンセル</button>' +
      '</div>' +
    '</div>'
  );
}

function openListDurAdjust(kind, itemId, currentMins) {
  if (state.adjustingListItem && state.adjustingListItem.kind === kind && state.adjustingListItem.id === itemId) {
    state.adjustingListItem = null;
  } else {
    state.adjustingListItem = { kind: kind, id: itemId };
    state.adjustingListMins = currentMins || 30;
  }
  renderLists();
}

function setListDurStep(stepIdx) {
  var idx = Math.max(0, Math.min(CUSTOM_DUR_STEPS.length - 1, Number(stepIdx) || 0));
  state.adjustingListMins = CUSTOM_DUR_STEPS[idx];
  var disp = document.getElementById('listDurDisplay');
  if (disp) disp.textContent = formatCustomDurLabel(state.adjustingListMins);
}

function cancelListDurAdjust() {
  state.adjustingListItem = null;
  renderLists();
}

function confirmListDurStart() {
  var item = state.adjustingListItem;
  state.adjustingListItem = null;
  if (!item) { renderLists(); return; }
  startFromList(item.kind, item.id, state.adjustingListMins);
}

function startFromList(kind, itemId, overrideMins) {
  var card = null;
  if (kind === 'task') {
    var t = (state.lists.tasks || []).find(function(x) { return x.id === itemId; });
    if (!t) return;
    card = { id: t.id, linkedType: 'task', linkedId: t.id, icon: 'checkCircle', title: t.cleanTitle || t.title, sub: t.memo || 'タスク', mins: overrideMins || t.mins || 30 };
  } else if (kind === 'stock') {
    var st = (state.lists.stock || []).find(function(x) { return x.id === itemId; });
    if (!st) return;
    card = { id: st.id, linkedType: 'stock', linkedId: st.title, icon: st.type === '音楽' ? 'music' : 'book', title: st.title, sub: st.type, mins: overrideMins || st.mins || 30 };
  } else if (kind === 'habits') {
    var h = (state.lists.habits || []).find(function(x) { return x.id === itemId; });
    if (!h) return;
    card = { id: h.id, linkedType: 'habit', linkedId: h.title, cycleStampLabel: h.title, icon: 'wind', title: h.title, sub: h.elapsed || '習慣ケア', mins: overrideMins || h.mins || 20 };
  }
  if (!card) return;
  state.pendingSessionLockUntil = Date.now() + 8000;
  switchTab('home');
  startAction(card);
}

function toggleShoppingDone(itemId) {
  var s = (state.lists.shopping || []).find(function(x) { return x.id === itemId; });
  if (!s) return;
  s.done = !s.done;
  saveLocalSnapshot();
  renderLists();
  showToast(s.done ? '「' + s.item + '」を購入済にしました' : '「' + s.item + '」を未買に戻しました');
  runMutationApi('apiMutateListItem', state.authKey, {
    listType: 'shopping',
    action: 'toggle',
    rowIndex: s.rowIndex,
    done: s.done
  }).then(function(res) {
    if (res && res.authorized && res.lists) {
      state.lists = res.lists;
      saveLocalSnapshot();
    }
  }).catch(function() {});
}

function openSettingsModal(errMsg) {
  var modal = document.getElementById('settingsModal');
  var errEl = document.getElementById('settingsError');
  document.getElementById('apiUrlFieldGroup').classList.toggle('hidden', isGasEnvironment());
  document.getElementById('inputApiUrl').value = state.apiUrl || '';
  document.getElementById('inputAuthKey').value = state.authKey || '';
  if (errMsg) {
    errEl.textContent = errMsg;
    errEl.classList.remove('hidden');
  } else {
    errEl.classList.add('hidden');
  }
  modal.classList.remove('hidden');
}

function closeSettingsModal() {
  document.getElementById('settingsModal').classList.add('hidden');
}

function saveSettings() {
  var apiVal = (document.getElementById('inputApiUrl').value || '').trim();
  var keyVal = (document.getElementById('inputAuthKey').value || '').trim();
  state.apiUrl = apiVal;
  state.authKey = keyVal;
  try {
    localStorage.setItem('companion_api_url', apiVal);
    localStorage.setItem('companion_auth_key', keyVal);
  } catch (e) {}
  closeSettingsModal();
  syncFromServer(true);
}

function openImageLightbox(src) {
  if (!src) return;
  document.getElementById('lightboxImg').src = src;
  document.getElementById('imageLightbox').classList.remove('hidden');
}

function closeImageLightbox() {
  document.getElementById('imageLightbox').classList.add('hidden');
}

function renderAll() {
  renderNav();
  renderHome();
  if (state.tab === 'talk') renderChat();
  if (state.tab === 'lists') renderLists();
}

function showToast(msg) {
  var el = document.getElementById('toastBar');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  if (state.toastTimer) clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(function() { el.classList.add('hidden'); }, 2200);
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function linkifyEscapedText(rawStr) {
  var escaped = escapeHtml(rawStr);
  return escaped.replace(/(https?:\/\/[^\s<>"']+)/g, function(url) {
    return '<a href="' + url + '" target="_blank" rel="noopener noreferrer" class="dc-url-text">' + url + '</a>';
  });
}

function escapeJsAttr(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

function bindComposerListeners() {
  var editor = document.getElementById('talkEditor');
  if (!editor) return;
  editor.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) {
      e.preventDefault();
      submitTalkEditor();
      return;
    }
    if (e.key === 'Backspace') {
      var sel = window.getSelection();
      if (sel && sel.isCollapsed && sel.rangeCount > 0) {
        var range = sel.getRangeAt(0);
        var node = range.startContainer;
        var offset = range.startOffset;
        if (node === editor && offset > 0) {
          var prev = editor.childNodes[offset - 1];
          if (prev && prev.nodeType === 1 && prev.classList.contains('inline-var-pill')) {
            e.preventDefault();
            prev.remove();
          }
        } else if (node.nodeType === 3 && offset === 0 && node.previousSibling) {
          var prevSib = node.previousSibling;
          if (prevSib.nodeType === 1 && prevSib.classList.contains('inline-var-pill')) {
            e.preventDefault();
            prevSib.remove();
          }
        }
      }
    }
  });

  editor.addEventListener('paste', function(e) {
    var items = (e.clipboardData && e.clipboardData.items) ? Array.from(e.clipboardData.items) : [];
    var imgFile = items.filter(function(it) { return it.type && it.type.indexOf('image/') === 0; })
      .map(function(it) { return it.getAsFile(); })
      .find(Boolean);
    if (imgFile) {
      e.preventDefault();
      compressImageToJpeg(imgFile).then(function(res) {
        state.pendingChatPhoto = res;
        renderChatPhotoPreview();
      }).catch(function() {});
    }
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', function() {
      var comp = document.getElementById('sharedComposer');
      if (!comp) return;
      var kbHeight = Math.max(0, window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop);
      comp.style.bottom = kbHeight > 80
        ? Math.max(0, kbHeight - 66) + 'px'
        : '';
    });
  }
}

window.addEventListener('DOMContentLoaded', function() {
  applyTheme();
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onSchemeChange = function(ev) {
      var manual = '';
      try { manual = localStorage.getItem('companion_theme') || ''; } catch (e) {}
      if (!manual) {
        state.isDark = Boolean(ev.matches);
        applyTheme();
      }
    };
    if (mq.addEventListener) mq.addEventListener('change', onSchemeChange);
    else if (mq.addListener) mq.addListener(onSchemeChange);
  }
  initStaticIcons();
  bindComposerListeners();
  startMistCanvas();
  startLiveClocks();

  if (!isGasEnvironment() && 'serviceWorker' in navigator && window.location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(function() {});
  }

  if (urlParams.key) {
    try { localStorage.setItem('companion_auth_key', urlParams.key.trim()); } catch (e) {}
  }
  if (urlParams.api) {
    try { localStorage.setItem('companion_api_url', urlParams.api.trim()); } catch (e) {}
  }

  var hasSnap = loadLocalSnapshot();
  renderAll();

  var needsApi = !isGasEnvironment() && !state.apiUrl;
  var needsKey = !state.authKey;
  if (needsApi || needsKey) {
    openSettingsModal();
  } else {
    syncFromServer(!hasSnap);
  }
});

document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible' && state.authKey && (isGasEnvironment() || state.apiUrl)) {
    if (Date.now() - state.lastFetchedAt > 15000) {
      syncFromServer(false);
    }
  }
});
