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

function buildManifestJson() {
  return JSON.stringify({
    name: 'Daily Companion',
    short_name: 'Companion',
    description: '生活の輪郭を静かに支える伴走アプリ',
    start_url: './',
    scope: './',
    display: 'standalone',
    orientation: 'any',
    background_color: '#F6F3EC',
    theme_color: '#4F6653',
    icons: [
      {
        src: './icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any maskable'
      }
    ]
  }, null, 2) + '\n';
}

function buildIconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#F6F3EC"/>
  <circle cx="256" cy="256" r="156" fill="#E8F0E9"/>
  <g transform="translate(136 136) scale(10)" fill="none" stroke="#4F6653" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
    <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/>
    <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
  </g>
</svg>\n`;
}

function buildServiceWorkerJs() {
  return `const CACHE_NAME = 'dc-pwa-v1';
const PRECACHE_URLS = ['./', './index.html', './manifest.json', './icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isDocument = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
  if (isDocument) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (let i = 0; i < clients.length; i++) {
        const client = clients[i];
        if (client.url.indexOf(self.registration.scope) === 0 && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('./');
      }
    })
  );
});
`;
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

const staticHtml = sandbox.buildDashboardTemplate('chat', '', '');
validateHtmlScripts(staticHtml, 'dashboard_static');

const gasHtml = sandbox.buildDashboardTemplate('memory', 'verify_key', 'verify_liff_id');
validateHtmlScripts(gasHtml, 'dashboard_gas');

const swCode = buildServiceWorkerJs();
new vm.Script(swCode, { filename: 'sw.js' });

if (isCheckOnly) {
  console.log('✅ Dashboard template inline <script> & sw.js syntax OK');
  process.exit(0);
}

// GitHub Pages用のPWA静的フロントエンド一式 (docs/) を自動生成
fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/index.html', staticHtml, 'utf8');
fs.writeFileSync('docs/.nojekyll', '', 'utf8');
fs.writeFileSync('docs/manifest.json', buildManifestJson(), 'utf8');
fs.writeFileSync('docs/icon.svg', buildIconSvg(), 'utf8');
fs.writeFileSync('docs/sw.js', swCode, 'utf8');
console.log('✅ Generated GitHub Pages PWA assets in docs/ (index.html: ' + staticHtml.length + ' bytes)');
