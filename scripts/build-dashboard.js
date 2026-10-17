const fs = require('fs');
const vm = require('vm');

// GitHub Pages用の静的フロントエンド (docs/index.html) を自動生成
const dashboardSrc = fs.readFileSync('src/Dashboard.js', 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(dashboardSrc, sandbox);

if (typeof sandbox.buildDashboardTemplate === 'function') {
  const html = sandbox.buildDashboardTemplate('tasks', '', '');
  fs.mkdirSync('docs', { recursive: true });
  fs.writeFileSync('docs/index.html', html, 'utf8');
  fs.writeFileSync('docs/.nojekyll', '', 'utf8');
  console.log('✅ Generated GitHub Pages frontend at docs/index.html (' + html.length + ' bytes)');
} else {
  console.error('❌ buildDashboardTemplate function not found in src/Dashboard.js');
  process.exit(1);
}
