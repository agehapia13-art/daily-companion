const fs = require("fs");
let html = fs.readFileSync("docs/index.html", "utf8");

// 1. ローカルスコープの state と renderHome をモックから触れるように公開
html = html.replace(
  "    function renderHome() {",
  "    window.__mockState = state;\n    window.__mockRenderHome = renderHome;\n    function renderHome() {"
);

// 2. ローカルスコープの callServerApi の先頭にモックフックを差し込む
const callApiSig = "    function callServerApi(funcName) {";
if (!html.includes(callApiSig)) {
  throw new Error("callServerApi signature not found");
}
html = html.replace(
  callApiSig,
  callApiSig + "\n      if (window.__mockCallServerApi) return window.__mockCallServerApi.apply(this, arguments);"
);

// 3. getVisibleDeckCards() で一時停止中のカードIDを一時的に非表示にする（元データからは削除しない）
const filterSig = "      var valid = pool.filter(function(c) {";
if (!html.includes(filterSig)) {
  throw new Error("getVisibleDeckCards filter signature not found");
}
html = html.replace(
  filterSig,
  filterSig + "\n        if (window.mockPausedSession && c.id === window.mockPausedSession.id) return false;"
);

// 4. アクティブタイマー画面のボタン並びを「キャンセル」「一時停止」「終わった」にする
//    すでに中断中（window.mockPausedSession）がある場合は「一時停止」ボタンを出さない（1件制限）
const targetActions = `<button onclick="pauseFocus()" class="btn-pause-soft">キャンセル</button>`;
if (!html.includes(targetActions)) {
  throw new Error("targetActions not found");
}
html = html.replace(
  targetActions,
  `<button onclick="pauseFocus()" class="btn-pause-soft">キャンセル</button>' +\n              (window.mockPausedSession ? '' : '<button type="button" onclick="window.mockPauseCurrentFocus()" class="btn-pause-soft">一時停止</button>') + '`
);
// 上記置換で余分な `+ '` が入るのを防ぐため、直後の `' +` と繋ぐ形で調整
html = html.replace(
  `) + '' +\n              '<button onclick="finishFocus()"`,
  `) +\n              '<button onclick="finishFocus()"`
);

// 5. 末尾にモック用スタイル＆スクリプトを注入
const mockBlock = `
<style>
  .focus-actions { gap: 8px !important; flex-wrap: nowrap; }
  .focus-actions .btn-pause-soft, .focus-actions .btn-done-pill { padding-left: 14px; padding-right: 14px; font-size: 13px; white-space: nowrap; }
  .mock-paused-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 14px;
    margin: 0 0 12px 0;
    border-radius: 18px;
    font-size: 13px;
  }
  .mock-paused-info {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }
  .mock-paused-badge {
    font-size: 11px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 999px;
    background: var(--dc-btn-soft-glass, rgba(255,255,255,0.45));
    border: 1px solid var(--dc-glass-border, rgba(255,255,255,0.5));
    color: var(--dc-text-sub, #64748b);
    white-space: nowrap;
  }
  .mock-paused-title {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mock-paused-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .mock-paused-btn {
    padding: 6px 10px;
    font-size: 12px;
    border-radius: 999px;
  }
</style>
<script>
(function() {
  try {
    localStorage.setItem("companion_auth_key", "mock-dry-run");
  } catch (e) {}
  window.openSettingsModal = function() {};
  window.saveLocalSnapshot = function() {};

  var MOCK_DECK = [
    { id: "mock-commute", title: "会社へ移動", sub: "これから出かけるぞ・移動枠", mins: 35, icon: "compass" },
    { id: "mock-game", title: "電車内でゲーム", sub: "スキマ時間の趣味インプット", mins: 15, icon: "sparkles" },
    { id: "mock-mail", title: "メール返信・小タスク", sub: "10分で片付く軽作業", mins: 10, icon: "checkCircle" },
    { id: "mock-cook", title: "料理の仕込み", sub: "煮込み待ちあり", mins: 30, icon: "flame" }
  ];

  window.__mockCallServerApi = function() {
    return Promise.resolve({
      ok: true,
      authorized: true,
      composedDeck: { cards: MOCK_DECK.slice(), lowCards: MOCK_DECK.slice() },
      fastState: { completedToday: {}, dismissedToday: {}, activeSession: null, isLowMode: false },
      tasks: [],
      habits: [],
      stock: [],
      shopping: [],
      messages: [],
      boundaryText: "モック検証モード（ドライラン）",
      subLine: "一時停止→別タスク→完了→再開を試せます"
    });
  };

  window.mockPausedSession = null;

  function formatPausedDur(sec) {
    var m = Math.floor((sec || 0) / 60);
    var s = (sec || 0) % 60;
    return m + "分" + (s < 10 ? "0" : "") + s + "秒";
  }

  function injectPausedBar() {
    var st = window.__mockState;
    var center = document.getElementById("homeCenterArea");
    if (!center) return;
    var existing = center.querySelector(".mock-paused-bar");
    if (existing) existing.remove();
    // 他のカードのタイマー中・振り返り中は中断中バーを表示しない（目の前の1つに集中）
    var hasActive = !!(st && st.fastState && st.fastState.activeSession);
    if (window.mockPausedSession && !(st && st.reflection) && !hasActive) {
      var p = window.mockPausedSession;
      var bar = document.createElement("div");
      bar.className = "glass-surface mock-paused-bar fade-in";
      bar.innerHTML =
        "<div class=\\"mock-paused-info\\">" +
          "<span class=\\"mock-paused-badge\\">⏸ 中断中</span>" +
          "<span class=\\"mock-paused-title\\">" + (p.title || "") + " (" + formatPausedDur(p.elapsedSec) + ")</span>" +
        "</div>" +
        "<div class=\\"mock-paused-actions\\">" +
          "<button type=\\"button\\" class=\\"btn-solid mock-paused-btn\\" onclick=\\"window.mockResumePaused()\\">再開</button>" +
          "<button type=\\"button\\" class=\\"btn-soft mock-paused-btn\\" onclick=\\"window.mockCompletePaused()\\">完了</button>" +
          "<button type=\\"button\\" class=\\"btn-soft mock-paused-btn\\" onclick=\\"window.mockDiscardPaused()\\" aria-label=\\"破棄\\">×</button>" +
        "</div>";
      center.insertBefore(bar, center.firstChild);
    }
  }

  window.mockPauseCurrentFocus = function() {
    var st = window.__mockState;
    if (!st || !st.fastState || !st.fastState.activeSession) return;
    if (window.mockPausedSession) return; // 1件制限
    var s = st.fastState.activeSession;
    var elSec = Math.max(0, Math.floor((Date.now() - (s.startedAtMs || Date.now())) / 1000));
    window.mockPausedSession = {
      id: s.id, title: s.title, icon: s.icon || "compass", mins: s.mins || 15,
      elapsedSec: elSec, isSleepCard: !!s.isSleepCard, isWorkBlock: !!s.isWorkBlock, linkedType: s.linkedType
    };
    st.fastState.activeSession = null;
    if (window.__mockRenderHome) window.__mockRenderHome();
    injectPausedBar();
  };

  window.mockResumePaused = function() {
    var st = window.__mockState;
    if (!window.mockPausedSession || !st || !st.fastState) return;
    var target = window.mockPausedSession;
    window.mockPausedSession = null;
    st.fastState.activeSession = {
      id: target.id, title: target.title, icon: target.icon, mins: target.mins,
      startedAtMs: Date.now() - (target.elapsedSec * 1000),
      isSleepCard: target.isSleepCard, isWorkBlock: target.isWorkBlock, linkedType: target.linkedType
    };
    if (window.__mockRenderHome) window.__mockRenderHome();
    injectPausedBar();
  };

  window.mockCompletePaused = function() {
    var st = window.__mockState;
    if (!window.mockPausedSession || !st) return;
    var p = window.mockPausedSession;
    window.mockPausedSession = null;
    st.reflection = {
      card: { id: p.id, title: p.title, icon: p.icon, isSleepCard: p.isSleepCard, linkedType: p.linkedType },
      usedMins: Math.max(1, Math.round((p.elapsedSec || 60) / 60)),
      startedMs: Date.now() - (p.elapsedSec * 1000),
      endedMs: Date.now(), feeling: "", note: ""
    };
    if (window.__mockRenderHome) window.__mockRenderHome();
  };

  window.mockDiscardPaused = function() {
    window.mockPausedSession = null;
    if (window.__mockRenderHome) window.__mockRenderHome();
    injectPausedBar();
  };

  var centerEl = document.getElementById("homeCenterArea");
  if (centerEl && typeof MutationObserver !== "undefined") {
    var obs = new MutationObserver(function() {
      var st = window.__mockState;
      var hasActive = !!(st && st.fastState && st.fastState.activeSession);
      if (window.mockPausedSession && !(st && st.reflection) && !hasActive && !centerEl.querySelector(".mock-paused-bar")) {
        injectPausedBar();
      }
    });
    obs.observe(centerEl, { childList: true });
  }

  window.addEventListener("DOMContentLoaded", function() {
    setTimeout(function() {
      var st = window.__mockState;
      if (st) {
        st.composedDeck = { cards: MOCK_DECK.slice(), lowCards: MOCK_DECK.slice() };
        if (st.fastState) {
          st.fastState.completedToday = {};
          st.fastState.dismissedToday = {};
        }
        if (window.__mockRenderHome) window.__mockRenderHome();
      }
    }, 250);
  });
})();
</script>
`;

fs.writeFileSync("scratch/mock-app.html", html.replace("</body>", mockBlock + "\n</body>"), "utf8");
console.log("Updated scratch/mock-app.html successfully");
