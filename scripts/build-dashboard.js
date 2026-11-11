const fs = require('fs');
const vm = require('vm');
const zlib = require('zlib');

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
        src: './icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any maskable'
      },
      {
        src: './icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable'
      },
      {
        src: './icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any'
      }
    ]
  }, null, 2) + '\n';
}

function buildIconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="170" fill="#E8F0E9"/>
  <g transform="translate(106.67 106.67) scale(12.4444)" fill="none" stroke="#4F6653" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
    <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/>
    <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
  </g>
</svg>\n`;
}

/**
 * SVG楕円弧コマンド(rx, ry, largeArc, sweep)を中心角パラメータへ変換 (SVG 1.1 F.6.5準拠)
 */
function sampleSvgArcSegments(x1, y1, rxIn, ryIn, largeArc, sweep, x2, y2, steps) {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const lambda = (dx2 * dx2) / (rx * rx) + (dy2 * dy2) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const rxSq = rx * rx;
  const rySq = ry * ry;
  const xSq = dx2 * dx2;
  const ySq = dy2 * dy2;
  const denom = rxSq * ySq + rySq * xSq;
  const num = Math.max(0, rxSq * rySq - denom);
  const sign = (largeArc === sweep) ? -1 : 1;
  const coef = denom === 0 ? 0 : sign * Math.sqrt(num / denom);
  const cxp = coef * (rx * dy2) / ry;
  const cyp = coef * (-ry * dx2) / rx;
  const cx = cxp + (x1 + x2) / 2;
  const cy = cyp + (y1 + y2) / 2;

  const vecAngle = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const ratio = len === 0 ? 1 : Math.max(-1, Math.min(1, dot / len));
    return ((ux * vy - uy * vx) < 0 ? -1 : 1) * Math.acos(ratio);
  };

  const ux = (dx2 - cxp) / rx;
  const uy = (dy2 - cyp) / ry;
  const vx = (-dx2 - cxp) / rx;
  const vy = (-dy2 - cyp) / ry;

  const theta1 = vecAngle(1, 0, ux, uy);
  let dTheta = vecAngle(ux, uy, vx, vy);
  if (!sweep && dTheta > 0) dTheta -= Math.PI * 2;
  if (sweep && dTheta < 0) dTheta += Math.PI * 2;

  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const ang = theta1 + (dTheta * i) / steps;
    pts.push([cx + rx * Math.cos(ang), cy + ry * Math.sin(ang)]);
  }
  return pts;
}

function sampleCubicBezier(p0, p1, p2, p3, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * mt * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t * t * t * p3[0];
    const y = mt * mt * mt * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t * t * t * p3[1];
    pts.push([x, y]);
  }
  return pts;
}

function polylineToSegments(pts) {
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    segs.push([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]]);
  }
  return segs;
}

/**
 * Daily Companion ヘッダー横の葉っぱロゴそのままのデザインで不透明RGB PNGを生成（外部依存ゼロ）
 * @param {number} size
 * @return {Buffer}
 */
function renderLeafIconPng(size) {
  const bg = [232, 240, 233]; // --dc-sage-light (#E8F0E9)
  const fg = [79, 102, 83];   // --dc-sage-main  (#4F6653)

  // .dc-logo-mark (24x24) 内の 14x14 アイコンと同じ中心配置比率
  const scale = (size * (14 / 24)) / 24;
  const offset = size * (5 / 24);
  const halfStroke = (2.1 * scale) / 2;

  const path1Pts = [
    ...sampleSvgArcSegments(11, 20, 7, 7, 0, 1, 9.8, 6.1, 48),
    ...sampleCubicBezier([9.8, 6.1], [15.5, 5], [17, 4.48], [19, 2], 40).slice(1),
    ...sampleCubicBezier([19, 2], [20, 4], [21, 6.18], [21, 10], 40).slice(1),
    ...sampleCubicBezier([21, 10], [21, 15.5], [16.22, 20], [11, 20], 48).slice(1)
  ];
  const path2Pts = [
    ...sampleCubicBezier([2, 21], [2, 18], [3.85, 15.64], [7.08, 15], 40),
    ...sampleCubicBezier([7.08, 15], [9.5, 14.52], [12, 13], [13, 12], 40).slice(1)
  ];

  const toPixel = (pt) => [offset + pt[0] * scale, offset + pt[1] * scale];
  const segs = [
    ...polylineToSegments(path1Pts.map(toPixel)),
    ...polylineToSegments(path2Pts.map(toPixel))
  ];

  const rowStride = 1 + size * 3;
  const raw = Buffer.alloc(rowStride * size);
  const maxDistCheckSq = (halfStroke + 1.2) * (halfStroke + 1.2);

  let minX = size, maxX = 0, minY = size, maxY = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    minX = Math.min(minX, Math.floor(Math.min(s[0], s[2]) - halfStroke - 2));
    maxX = Math.max(maxX, Math.ceil(Math.max(s[0], s[2]) + halfStroke + 2));
    minY = Math.min(minY, Math.floor(Math.min(s[1], s[3]) - halfStroke - 2));
    maxY = Math.max(maxY, Math.ceil(Math.max(s[1], s[3]) + halfStroke + 2));
  }
  minX = Math.max(0, minX);
  maxX = Math.min(size - 1, maxX);
  minY = Math.max(0, minY);
  maxY = Math.min(size - 1, maxY);

  for (let y = 0; y < size; y++) {
    const rowOff = y * rowStride;
    raw[rowOff] = 0; // PNG filter: None
    const inYBand = y >= minY && y <= maxY;
    for (let x = 0; x < size; x++) {
      let cov = 0;
      if (inYBand && x >= minX && x <= maxX) {
        const px = x + 0.5;
        const py = y + 0.5;
        let minDistSq = Infinity;
        for (let k = 0; k < segs.length; k++) {
          const s = segs[k];
          const vx = s[2] - s[0];
          const vy = s[3] - s[1];
          const wx = px - s[0];
          const wy = py - s[1];
          const lenSq = vx * vx + vy * vy;
          let t = lenSq === 0 ? 0 : (wx * vx + wy * vy) / lenSq;
          if (t < 0) t = 0;
          else if (t > 1) t = 1;
          const dx = px - (s[0] + t * vx);
          const dy = py - (s[1] + t * vy);
          const dSq = dx * dx + dy * dy;
          if (dSq < minDistSq) minDistSq = dSq;
        }
        if (minDistSq <= maxDistCheckSq) {
          const d = Math.sqrt(minDistSq);
          cov = Math.max(0, Math.min(1, halfStroke + 0.5 - d));
        }
      }
      const pOff = rowOff + 1 + x * 3;
      if (cov <= 0) {
        raw[pOff] = bg[0];
        raw[pOff + 1] = bg[1];
        raw[pOff + 2] = bg[2];
      } else {
        const inv = 1 - cov;
        raw[pOff] = Math.round(bg[0] * inv + fg[0] * cov);
        raw[pOff + 1] = Math.round(bg[1] * inv + fg[1] * cov);
        raw[pOff + 2] = Math.round(bg[2] * inv + fg[2] * cov);
      }
    }
  }

  return encodeRgbPng(size, size, raw);
}

function encodeRgbPng(width, height, rawScanlines) {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const makeChunk = (type, data) => {
    const typeBuf = Buffer.from(type, 'ascii');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  };

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(rawScanlines, { level: 9 });
  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

function buildServiceWorkerJs() {
  return `const CACHE_NAME = 'dc-pwa-v2';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png'
];

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
fs.writeFileSync('docs/apple-touch-icon.png', renderLeafIconPng(180));
fs.writeFileSync('docs/icon-192.png', renderLeafIconPng(192));
fs.writeFileSync('docs/icon-512.png', renderLeafIconPng(512));
fs.writeFileSync('docs/sw.js', swCode, 'utf8');
console.log('✅ Generated GitHub Pages PWA assets in docs/ (index.html: ' + staticHtml.length + ' bytes + PNG icons)');
