const fs = require('fs');
const vm = require('vm');

const files = [
  'src/Config.js',
  'src/Spreadsheet.js',
  'src/Calendar.js',
  'src/Weather.js',
  'src/Notion.js',
  'src/Gemini.js',
  'src/Line.js',
  'src/Batch.js',
  'src/Dashboard.js',
  'src/Webhook.js',
  'src/Setup.js'
];

let bundle = `/**
 * Code.js - Life Secretary System All-in-One Bundle
 * Generated automatically
 */\n\n`;

for (const file of files) {
  bundle += `// ==========================================\n// FILE: ${file}\n// ==========================================\n\n`;
  bundle += fs.readFileSync(file, 'utf8').trim() + '\n\n';
}

fs.mkdirSync('bundle', { recursive: true });
fs.writeFileSync('bundle/Code.js', bundle, 'utf8');
if (fs.existsSync('appsscript.json')) {
  fs.copyFileSync('appsscript.json', 'bundle/appsscript.json');
}
console.log('✅ Bundled successfully to bundle/Code.js (' + bundle.length + ' bytes)');

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
}

