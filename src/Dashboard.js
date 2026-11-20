/**
 * Dashboard.js - Companion Cockpit (v2) GAS HTML Service レンダラ
 * UI 実体は web/ 配下で管理し、`npm run build:dashboard` により src/DashboardHtml.html と docs/index.html を生成する
 */

/**
 * doGet から呼び出される HTML レンダリング関数（GAS Web App 直接アクセス時用）
 * @param {Object} e イベントオブジェクト
 * @return {GoogleAppsScript.HTML.HtmlOutput}
 */
function renderDashboardHtml(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  const initialTab = params.tab || 'home';
  const urlKey = params.key || '';
  const isPreAuthorized = verifyDashboardAccess(urlKey);
  const validKey = isPreAuthorized ? getDashboardAccessKey() : '';

  const html = buildDashboardTemplate(initialTab, validKey, '');
  return HtmlService.createHtmlOutput(html)
    .setTitle('Daily Companion')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * PWA HTML テンプレートを生成（GAS / GitHub Pages 両用）
 * @param {string=} initialTab 'home' | 'talk' | 'lists'
 * @param {string=} validKey GAS側事前認証キー
 * @param {string=} _unusedOpt 後方互換用ダミー引数
 * @return {string}
 */
function buildDashboardTemplate(initialTab, validKey, _unusedOpt) {
  const safeTab = String(initialTab || 'home').replace(/[^a-zA-Z0-9_-]/g, '') || 'home';
  const safeTabJson = JSON.stringify(safeTab);
  const safeKeyJson = JSON.stringify(String(validKey || ''));
  const rawHtml = HtmlService.createHtmlOutputFromFile('DashboardHtml').getContent();

  const bootSnippet = `var INITIAL_TAB = ${safeTabJson};\n    var SERVER_PRE_KEY = ${safeKeyJson};`;
  return rawHtml.replace(
    /var INITIAL_TAB = "home";\s*var SERVER_PRE_KEY = "";/,
    () => bootSnippet
  );
}
