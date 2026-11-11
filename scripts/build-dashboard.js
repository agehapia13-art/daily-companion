const fs = require('fs');
const vm = require('vm');

/**
 * HTML文字列内のインライン <script> ブロックをすべて構文検証
 * （テンプレートリテラル内のエスケープ漏れ等によるブラウザ即死をビルド/チェック時に検知）
 * @param {string} html
 * @param {string} label
 */
function validateHtmlScripts(html, label) {
  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let index = 0;
  while ((match = scriptRegex.exec(html)) !== null) {
    const code = match[1];
    index += 1;
    if (!code || !code.trim()) continue;
    new vm.Script(code, { filename: `${label}_script_${index}.js` });
  }
}

const isCheckOnly = process.argv.includes('--check');
const dashboardSrc = fs.readFileSync('src/Dashboard.js', 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(dashboardSrc, sandbox);

if (typeof sandbox.buildDashboardTemplate !== 'function') {
  console.error('❌ buildDashboardTemplate function not found in src/Dashboard.js');
  process.exit(1);
}

const staticHtml = sandbox.buildDashboardTemplate('tasks', '', '');
validateHtmlScripts(staticHtml, 'dashboard_static');

const gasHtml = sandbox.buildDashboardTemplate('memory', 'verify_key', 'verify_liff_id');
validateHtmlScripts(gasHtml, 'dashboard_gas');

if (isCheckOnly) {
  console.log('✅ Dashboard template inline <script> syntax OK');
  process.exit(0);
}

// GitHub Pages用の静的フロントエンド (docs/index.html) を自動生成
fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/index.html', staticHtml, 'utf8');
fs.writeFileSync('docs/.nojekyll', '', 'utf8');
console.log('✅ Generated GitHub Pages frontend at docs/index.html (' + staticHtml.length + ' bytes)');
