/**
 * state-api.js - Frontend boot state, offline snapshot & GAS/HTTP API bridge
 */

var CUSTOM_DUR_STEPS = [5, 10, 15, 30, 45, 60, 90, 120, 150, 180, 240, 360];

var FEELING_CHIPS = ['✨ すっきり', '😌 ほっとした', '👍 まあまあ', '😮‍💨 つかれた'];

var TASK_CATS = ['ALL', '仕事', '制作・創作', '家事・環境', '実務・手続', '趣味・文化', '身体・ケア', 'お出かけ'];

function normalizeTabName(raw) {
  var s = String(raw || '').toLowerCase();
  if (s === 'chat' || s === 'talk') return 'talk';
  if (s === 'lists' || s === 'tasks' || s === 'shopping' || s === 'input' || s === 'stock' || s === 'habits' || s === 'memory') return 'lists';
  return 'home';
}

function readUrlParams() {
  var res = {};
  try {
    var sp = new URLSearchParams(window.location.search);
    sp.forEach(function(v, k) { if (v) res[k] = v; });
  } catch (e) {}
  return res;
}

var urlParams = readUrlParams();

var savedTheme = '';
try { savedTheme = localStorage.getItem('companion_theme') || ''; } catch (e) {}

var osDark = Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

var state = {
  isDark: savedTheme ? savedTheme === 'dark' : osDark,
  authKey: (urlParams.key || SERVER_PRE_KEY || localStorage.getItem('companion_auth_key') || '').trim(),
  apiUrl: (urlParams.api || localStorage.getItem('companion_api_url') || '').trim(),
  authorized: false,
  isSyncing: false,
  isSending: false,
  isSubmittingReflect: false,
  tab: normalizeTabName(urlParams.tab || INITIAL_TAB),
  listSubTab: 'tasks',
  taskCategoryFilter: 'ALL',
  weatherLine: '天気情報を同期中…',
  boundary: null,
  deltaText: '',
  fastState: {
    dayKey: '',
    activeSession: null,
    completedToday: {},
    dismissedToday: {},
    isLowMode: false,
    triagedToday: false,
    dailyBriefing: null,
    aiDeck: { cards: [], lowCards: [] }
  },
  composedDeck: { cards: [], lowCards: [] },
  reflection: null,
  showCustomForm: false,
  customDurMins: 30,
  deckOffset: 0,
  openSwipeId: null,
  lists: { tasks: [], shopping: [], stock: [], habits: [] },
  messages: [],
  pendingChatPhoto: null,
  failedPayloads: {},
  savedRange: null,
  lastFetchedAt: 0,
  syncEpoch: 0,
  inFlightMutations: 0,
  toastTimer: null
};

function isGasEnvironment() {
  return typeof google !== 'undefined' && google.script && google.script.run;
}

function callServerApi(funcName) {
  var args = Array.prototype.slice.call(arguments, 1);
  return new Promise(function(resolve, reject) {
    if (isGasEnvironment()) {
      var runner = google.script.run
        .withSuccessHandler(resolve)
        .withFailureHandler(reject);
      runner[funcName].apply(runner, args);
      return;
    }
    if (!state.apiUrl) {
      reject(new Error('GAS ウェブアプリURLが設定されていません'));
      return;
    }
    fetch(state.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ apiAction: funcName, args: args }),
      redirect: 'follow'
    })
      .then(function(r) {
        if (!r.ok) throw new Error('HTTPエラー: ' + r.status);
        return r.json();
      })
      .then(function(json) {
        if (json && json.ok === false) {
          throw new Error(json.error || 'サーバーエラー');
        }
        resolve(json && json.ok === true ? json.data : json);
      })
      .catch(reject);
  });
}

function saveLocalSnapshot() {
  try {
    localStorage.setItem('cc_v2_snapshot', JSON.stringify({
      weatherLine: state.weatherLine,
      boundary: state.boundary,
      deltaText: state.deltaText,
      fastState: state.fastState,
      composedDeck: state.composedDeck,
      lists: state.lists,
      messages: state.messages.filter(function(m) { return !m.isError; }),
      savedAt: Date.now()
    }));
  } catch (e) {}
}

function loadLocalSnapshot() {
  try {
    var raw = localStorage.getItem('cc_v2_snapshot');
    if (!raw) return false;
    var snap = JSON.parse(raw);
    if (!snap || typeof snap !== 'object') return false;
    if (snap.weatherLine) state.weatherLine = snap.weatherLine;
    if (snap.boundary) state.boundary = snap.boundary;
    if (snap.deltaText) state.deltaText = snap.deltaText;
    if (snap.fastState) state.fastState = snap.fastState;
    if (snap.composedDeck) state.composedDeck = snap.composedDeck;
    if (snap.lists) state.lists = snap.lists;
    if (Array.isArray(snap.messages)) state.messages = snap.messages;
    return true;
  } catch (e) {
    return false;
  }
}

function runMutationApi(funcName) {
  var args = Array.prototype.slice.call(arguments, 1);
  state.syncEpoch = (state.syncEpoch || 0) + 1;
  var myEpoch = state.syncEpoch;
  state.inFlightMutations = (state.inFlightMutations || 0) + 1;
  return callServerApi.apply(null, [funcName].concat(args))
    .then(function(res) {
      state.inFlightMutations = Math.max(0, (state.inFlightMutations || 1) - 1);
      if (res && typeof res === 'object' && myEpoch !== state.syncEpoch) {
        res._stale = true;
      }
      return res;
    })
    .catch(function(err) {
      state.inFlightMutations = Math.max(0, (state.inFlightMutations || 1) - 1);
      throw err;
    });
}

function applyServerStatePayload(res) {
  if (!res || res._stale) return;
  if (res.state) {
    var prev = state.fastState || {};
    var sameDay = Boolean(prev.dayKey && res.state.dayKey && prev.dayKey === res.state.dayKey);
    var mergedCompleted = sameDay
      ? Object.assign({}, prev.completedToday || {}, res.state.completedToday || {})
      : (res.state.completedToday || {});
    var mergedDismissed = sameDay
      ? Object.assign({}, prev.dismissedToday || {}, res.state.dismissedToday || {})
      : (res.state.dismissedToday || {});
    var localSession = prev.activeSession;
    var lockActive = Boolean(state.pendingSessionLockUntil && Date.now() < state.pendingSessionLockUntil);
    var keepLocalSession = Boolean(localSession && !res.state.activeSession && lockActive);
    var keepClearedSession = Boolean(!localSession && res.state.activeSession && lockActive);
    var briefingDismissed = sameDay && Boolean((prev.dailyBriefing && prev.dailyBriefing.dismissed) || mergedDismissed['__briefing__']);
    state.fastState = res.state;
    state.fastState.completedToday = mergedCompleted;
    state.fastState.dismissedToday = mergedDismissed;
    if (briefingDismissed && state.fastState.dailyBriefing) {
      state.fastState.dailyBriefing.dismissed = true;
    }
    if (keepLocalSession) state.fastState.activeSession = localSession;
    if (keepClearedSession) state.fastState.activeSession = null;
  }
  if (res.deck) state.composedDeck = res.deck;
  if (res.lists) state.lists = res.lists;
  if (res.boundary) state.boundary = res.boundary;
  if (res.weatherLine) state.weatherLine = res.weatherLine;
  if (res.deltaText !== undefined) state.deltaText = res.deltaText;
}

function syncFromServer(manual) {
  if (state.isSyncing) return;
  if (!manual && state.inFlightMutations > 0) return;
  if (!manual && state.pendingSessionLockUntil && Date.now() < state.pendingSessionLockUntil) return;
  state.isSyncing = true;
  var reqEpoch = state.syncEpoch || 0;
  var btn = document.getElementById('syncBtn');
  if (btn) btn.classList.add('spinning');

  callServerApi('apiGetHomeBootstrap', state.authKey)
    .then(function(res) {
      state.isSyncing = false;
      if (btn) btn.classList.remove('spinning');
      if (reqEpoch !== (state.syncEpoch || 0) || state.inFlightMutations > 0) {
        return;
      }
      if (!res || !res.authorized) {
        state.authorized = false;
        openSettingsModal((res && res.error) ? res.error : '認証に失敗しました。');
        return;
      }
      state.authorized = true;
      state.lastFetchedAt = Date.now();
      if (res.validKey) {
        state.authKey = res.validKey;
        try { localStorage.setItem('companion_auth_key', res.validKey); } catch (e) {}
      }
      applyServerStatePayload(res);
      if (Array.isArray(res.chatMessages)) {
        var localErrors = state.messages.filter(function(m) { return m.isError; });
        state.messages = res.chatMessages.concat(localErrors);
      }
      saveLocalSnapshot();
      closeSettingsModal();
      renderAll();
      if (manual) showToast('同期しました');
    })
    .catch(function(err) {
      state.isSyncing = false;
      if (btn) btn.classList.remove('spinning');
      if (!state.authorized && !state.fastState.dayKey) {
        openSettingsModal('接続エラー: ' + (err.message || err));
      } else if (manual) {
        showToast('同期に失敗しました');
      }
    });
}

/* Image compression (handles vertical tall screenshots safely) */

function compressImageToJpeg(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) {
      var img = new Image();
      img.onload = function() {
        var w = img.width;
        var h = img.height;
        var longEdge = Math.max(w, h);
        var shortEdge = Math.max(1, Math.min(w, h));
        var aspect = longEdge / shortEdge;
        if (aspect > 2.2) {
          if (shortEdge > 1120) {
            var ratio = 1120 / shortEdge;
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }
          var pixels = w * h;
          if (pixels > 3200000) {
            var pScale = Math.sqrt(3200000 / pixels);
            w = Math.round(w * pScale);
            h = Math.round(h * pScale);
          }
        } else if (longEdge > 1600) {
          var scale = 1600 / longEdge;
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        w = Math.max(1, w);
        h = Math.max(1, h);
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        var dataUrl = canvas.toDataURL('image/jpeg', 0.84);
        resolve({ dataUrl: dataUrl, base64: dataUrl.split(',')[1] || '', mimeType: 'image/jpeg' });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
