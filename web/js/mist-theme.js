/**
 * mist-theme.js - Fluid Mist canvas, SVG icons, theme toggle & clock helpers
 */

var MIST_PLUMES = [
  { bx: 0.72, by: 0.16, ax: 0.24, ay: 0.14, wx: 0.44, wy: 0.34, ux: 0.21, uy: 0.18, px: 0.2, py: 1.1, rx: 0.40, ry: 0.26, rot0: 0.4, rotSpeed: 0.24, morphPhase: 0.0, morphSpeed: 0.52 },
  { bx: 0.24, by: 0.28, ax: 0.28, ay: 0.16, wx: 0.36, wy: 0.48, ux: 0.19, uy: 0.23, px: 1.8, py: 0.4, rx: 0.38, ry: 0.25, rot0: -0.5, rotSpeed: -0.21, morphPhase: 1.3, morphSpeed: 0.47 },
  { bx: 0.76, by: 0.48, ax: 0.26, ay: 0.18, wx: 0.51, wy: 0.31, ux: 0.25, uy: 0.15, px: 3.1, py: 2.2, rx: 0.36, ry: 0.24, rot0: 0.9, rotSpeed: 0.19, morphPhase: 2.6, morphSpeed: 0.58 },
  { bx: 0.28, by: 0.62, ax: 0.26, ay: 0.17, wx: 0.39, wy: 0.45, ux: 0.17, uy: 0.27, px: 4.4, py: 0.9, rx: 0.41, ry: 0.28, rot0: -0.2, rotSpeed: -0.26, morphPhase: 3.9, morphSpeed: 0.43 },
  { bx: 0.62, by: 0.76, ax: 0.25, ay: 0.15, wx: 0.47, wy: 0.38, ux: 0.22, uy: 0.19, px: 2.4, py: 3.5, rx: 0.35, ry: 0.23, rot0: 0.7, rotSpeed: 0.22, morphPhase: 5.1, morphSpeed: 0.54 },
  { bx: 0.48, by: 0.38, ax: 0.24, ay: 0.20, wx: 0.33, wy: 0.53, ux: 0.24, uy: 0.16, px: 5.2, py: 1.7, rx: 0.32, ry: 0.21, rot0: -0.8, rotSpeed: -0.18, morphPhase: 1.9, morphSpeed: 0.49 },
  { bx: 0.36, by: 0.86, ax: 0.28, ay: 0.12, wx: 0.56, wy: 0.36, ux: 0.18, uy: 0.22, px: 0.9, py: 4.8, rx: 0.37, ry: 0.24, rot0: 0.3, rotSpeed: 0.25, morphPhase: 4.2, morphSpeed: 0.51 }
];

var MIST_RIBBONS = [
  { bx: 0.52, by: 0.36, ax: 0.18, ay: 0.18, wx: 0.32, wy: 0.41, px: 0.6, py: 2.1, rx: 0.72, ry: 0.16, rot0: 0.61, rotAmp: 0.22, rotSpeed: 0.31 },
  { bx: 0.46, by: 0.68, ax: 0.18, ay: 0.16, wx: 0.38, wy: 0.29, px: 3.4, py: 0.8, rx: 0.68, ry: 0.15, rot0: -0.44, rotAmp: 0.20, rotSpeed: -0.27 }
];

var MIST_PALETTES = {
  light: {
    morning: [[186,156,255,0.34],[249,178,224,0.30],[156,194,254,0.28],[206,178,255,0.30],[244,190,232,0.26],[174,196,255,0.26],[220,186,255,0.26]],
    day:     [[188,162,255,0.30],[158,192,255,0.28],[249,184,226,0.26],[214,184,255,0.26],[168,194,255,0.25],[246,194,230,0.24],[204,178,255,0.25]],
    night:   [[168,144,252,0.36],[144,174,252,0.30],[240,166,218,0.28],[198,160,252,0.30],[162,184,252,0.28],[232,176,224,0.26],[186,156,250,0.28]]
  },
  dark: {
    morning: [[139,92,246,0.40],[236,72,153,0.34],[99,102,241,0.38],[192,132,252,0.36],[244,114,182,0.32],[129,140,248,0.34],[168,85,247,0.34]],
    day:     [[129,140,248,0.38],[168,85,247,0.36],[236,72,153,0.32],[96,165,250,0.32],[217,70,239,0.32],[167,139,250,0.34],[244,114,182,0.30]],
    night:   [[124,58,237,0.42],[219,39,119,0.34],[79,70,229,0.38],[192,132,252,0.36],[129,140,248,0.34],[232,121,249,0.32],[147,51,234,0.34]]
  }
};

function getIconSvg(name, size) {
  var s = size || 17;
  var common = 'width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  var paths = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    coffee: '<path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/><path d="M6 2v2"/>',
    utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
    shirt: '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23Z"/>',
    sparkles: '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>',
    train: '<rect width="16" height="16" x="4" y="3" rx="2"/><path d="M4 11h16"/><path d="M12 3v8"/><path d="m8 19-2 3"/><path d="m18 22-2-3"/><path d="M8 15h.01"/><path d="M16 15h.01"/>',
    laptop: '<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/>',
    droplet: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
    droplets: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
    walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="m9 21 2.2-6.5L13 12l-1.5-3.5L15 7l2 3h2.5"/><path d="m13 12 2.5 3.5L15 21"/><path d="m7.5 14 2-3.5 2-1.5"/>',
    cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
    bed: '<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    wind: '<path d="M12.8 19.6A2 2 0 1 0 14 16H2"/><path d="M17.5 8a2.5 2.5 0 1 1 2 4H2"/><path d="M9.8 4.4A2 2 0 1 1 11 8H2"/>',
    sliders: '<line x1="4" x2="20" y1="7" y2="7"/><line x1="4" x2="20" y1="17" y2="17"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="17" r="2"/>',
    compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V19a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V9.5"/><path d="M9.5 21v-5.5a2.5 2.5 0 0 1 5 0V21"/>',
    message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    shuffle: '<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    send: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    refresh: '<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    fileText: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/>',
    eyeOff: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>'
  };
  return '<svg ' + common + '>' + (paths[name] || paths.compass) + '</svg>';
}

function applyTheme() {
  document.body.classList.toggle('dc-dark', Boolean(state.isDark));
  var meta = document.getElementById('metaThemeColor');
  if (meta) meta.setAttribute('content', state.isDark ? '#0D091A' : '#FDFCFF');
  var lbl = document.getElementById('themeStateLabel');
  if (lbl) lbl.textContent = state.isDark ? 'ダーク' : 'ライト';
}

function toggleTheme() {
  state.isDark = !state.isDark;
  try { localStorage.setItem('companion_theme', state.isDark ? 'dark' : 'light'); } catch (e) {}
  applyTheme();
}

function startMistCanvas() {
  var canvas = document.getElementById('ambientCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var W = 220;
  var H = 428;
  canvas.width = W;
  canvas.height = H;
  var simTime = 0;
  var lastTs = null;

  function drawEllipticalMist(cx, cy, baseR, sx, sy, angle, rgba) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.scale(sx, sy);
    var grad = ctx.createRadialGradient(0, 0, 0, 0, 0, baseR);
    var rgb = rgba[0] + ',' + rgba[1] + ',' + rgba[2];
    var a = rgba[3];
    grad.addColorStop(0, 'rgba(' + rgb + ',' + a.toFixed(3) + ')');
    grad.addColorStop(0.48, 'rgba(' + rgb + ',' + (a * 0.55).toFixed(3) + ')');
    grad.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, baseR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawMist(ts) {
    if (lastTs === null) lastTs = ts;
    var dt = Math.min(0.05, Math.max(0, (ts - lastTs) / 1000));
    lastTs = ts;
    simTime += dt * (state.fastState.activeSession ? 0.55 : 1.0);

    ctx.globalCompositeOperation = 'source-over';
    var bgGrad = ctx.createLinearGradient(0, 0, W * 0.65, H);
    if (state.isDark) {
      bgGrad.addColorStop(0, '#0B0816');
      bgGrad.addColorStop(0.52, '#120A21');
      bgGrad.addColorStop(1, '#160B1E');
    } else {
      bgGrad.addColorStop(0, '#FDFCFF');
      bgGrad.addColorStop(0.52, '#FBF7FF');
      bgGrad.addColorStop(1, '#FEF8FC');
    }
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    var now = new Date();
    var mins = now.getHours() * 60 + now.getMinutes();
    var mode = 'day';
    if (mins >= 4 * 60 && mins < 10 * 60 + 30) mode = 'morning';
    else if (mins >= 18 * 60 + 30 || mins < 4 * 60) mode = 'night';

    var palette = (state.isDark ? MIST_PALETTES.dark : MIST_PALETTES.light)[mode];
    ctx.globalCompositeOperation = state.isDark ? 'screen' : 'source-over';

    for (var r = 0; r < MIST_RIBBONS.length; r++) {
      var rb = MIST_RIBBONS[r];
      var rCx = (rb.bx + rb.ax * Math.sin(simTime * rb.wx + rb.px)) * W;
      var rCy = (rb.by + rb.ay * Math.cos(simTime * rb.wy + rb.py)) * H;
      var rAngle = rb.rot0 + rb.rotAmp * Math.sin(simTime * rb.rotSpeed + r * 1.4);
      var rColor = palette[(r * 2 + 1) % palette.length];
      drawEllipticalMist(rCx, rCy, rb.rx * W, 1.0 + 0.08 * Math.sin(simTime * 0.4 + r), rb.ry / rb.rx, rAngle, [rColor[0], rColor[1], rColor[2], state.isDark ? 0.25 : 0.16]);
    }

    for (var i = 0; i < MIST_PLUMES.length; i++) {
      var p = MIST_PLUMES[i];
      var dx = (0.65 * Math.sin(simTime * p.wx + p.px) + 0.35 * Math.cos(simTime * p.ux + p.py * 1.3)) * p.ax * W;
      var dy = (0.65 * Math.cos(simTime * p.wy + p.py) + 0.35 * Math.sin(simTime * p.uy + p.px * 0.9)) * p.ay * H;
      var cx = p.bx * W + dx;
      var cy = p.by * H + dy;
      var breath = 1.0 + 0.16 * Math.sin(simTime * p.morphSpeed + p.morphPhase);
      var squash = 1.0 + 0.14 * Math.cos(simTime * (p.morphSpeed * 0.8) + p.morphPhase * 1.2);
      drawEllipticalMist(cx, cy, p.rx * W, Math.max(0.75, breath), Math.max(0.48, (p.ry / p.rx) * squash), p.rot0 + simTime * p.rotSpeed, palette[i % palette.length]);
    }
    requestAnimationFrame(drawMist);
  }
  requestAnimationFrame(drawMist);
}

function formatCountdownHMS(remSec) {
  var s = Math.max(0, Math.floor(remSec));
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var sec = s % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
}

function formatTimer(sec) {
  var s = Math.max(0, Math.floor(sec));
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var sc = s % 60;
  if (h > 0) return String(h) + ':' + String(m).padStart(2, '0') + ':' + String(sc).padStart(2, '0');
  return String(m).padStart(2, '0') + ':' + String(sc).padStart(2, '0');
}

function formatCustomDurLabel(mins) {
  var m = Number(mins) || 30;
  if (m < 60) return m + '分';
  var h = Math.floor(m / 60);
  var r = m % 60;
  return r > 0 ? (h + '時間' + r + '分') : (h + '時間');
}

function setCustomDurStep(stepIdx) {
  var idx = Math.max(0, Math.min(CUSTOM_DUR_STEPS.length - 1, parseInt(stepIdx, 10) || 0));
  state.customDurMins = CUSTOM_DUR_STEPS[idx];
  var disp = document.getElementById('customDurDisplay');
  if (disp) disp.textContent = formatCustomDurLabel(state.customDurMins);
}

function startLiveClocks() {
  setInterval(function() {
    if (state.tab !== 'home') return;
    if (state.boundary && state.boundary.targetMs) {
      var cdEl = document.getElementById('homeCountdown');
      if (cdEl) {
        cdEl.textContent = formatCountdownHMS((state.boundary.targetMs - Date.now()) / 1000);
      }
    }
    var sess = state.fastState.activeSession;
    if (sess && sess.startedAtMs && !state.reflection) {
      var elSec = Math.max(0, Math.floor((Date.now() - sess.startedAtMs) / 1000));
      var tEl = document.getElementById('focusTimerText');
      if (tEl) tEl.textContent = formatTimer(elSec);
      var noteEl = document.getElementById('focusGentleNote');
      if (noteEl && Math.floor(elSec / 60) >= 60 && !sess.isWorkBlock && !sess.isSleepCard) {
        noteEl.classList.remove('hidden');
      }
    }
  }, 1000);
}

function initStaticIcons() {
  document.getElementById('syncBtn').innerHTML = getIconSvg('refresh', 14);
  document.getElementById('settingsBtn').innerHTML = getIconSvg('sliders', 14);
  document.getElementById('closeSettingsBtn').innerHTML = getIconSvg('x', 14);
  document.querySelector('#sharedComposer .attach-circle').innerHTML = getIconSvg('camera', 16);
  document.querySelector('#sharedComposer .send-circle').innerHTML = getIconSvg('send', 15);
  document.getElementById('nav-home').innerHTML = getIconSvg('home', 20) + '<span>Home</span>';
  document.getElementById('nav-talk').innerHTML = getIconSvg('message', 20) + '<span>Chat</span>';
  document.getElementById('nav-lists').innerHTML = getIconSvg('checkCircle', 20) + '<span>Lists</span>';
}
