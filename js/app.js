/* MachSim – trình soạn thảo sơ đồ & điều khiển mô phỏng */
(function () {
  'use strict';
  const MS = window.MS, DEFS = MS.DEFS, G = 20;
  const $ = (s) => document.querySelector(s);
  const fmt = MS.formatSI;
  const LS_CIRC = 'machsim.circuit.v1', LS_SET = 'machsim.settings.v1';

  const S = {
    circ: null, net: null, eng: null,
    running: true, error: null, slow: false,
    view: { x: 0, y: 0, z: 1 },
    tool: 'select', placeType: null, placeRot: 0, placeFlip: false,
    sel: new Set(), selW: new Set(),
    hist: [], fut: [],
    settings: { ansi: false, showValues: true, showDots: true, method: 'be', theme: 'auto', dotSpeed: 1, flow: 'conv', arrowsAll: false },
    debt: 0, vmax: 1, lastTs: 0,
    mouse: { sx: 0, sy: 0, wx: 0, wy: 0, in: false },
    drag: null, colors: {}, clip: null, lastUi: 0
  };

  const cv = $('#cv'), g = cv.getContext('2d');
  const scope = new MS.Scope($('#scopeCv'));

  /* ===================== Tiện ích ===================== */
  function toast(msg, kind) {
    const t = $('#toast');
    t.innerHTML = msg;
    t.className = 'show ' + (kind || '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.className = ''), kind === 'error' ? 6000 : 2600);
  }
  const strip = (k, v) => (k[0] === '_' ? undefined : v);
  const snapshot = () => JSON.stringify(S.circ, strip);

  function readColors() {
    const c = (n, f) => MS.cssVar(n, f);
    S.colors = {
      bg: c('--cv-bg', '#0d1117'), grid: c('--cv-grid', '#2a3340'), body: c('--cv-body', '#d8dee9'),
      fill: c('--cv-fill', '#161b22'), sel: c('--accent', '#4fc3f7'), text: c('--cv-text', '#c9d1d9'),
      muted: c('--muted', '#8b949e'), zero: c('--cv-zero', '#8a919c'), dot: c('--cv-dot', '#ffd60a'), electron: c('--cv-electron', '#5fd4ff')
    };
  }

  function colorV(v) {
    const t = MS.clamp(v / S.vmax, -1, 1), a = Math.abs(t);
    const z = S.colors.zeroRGB || (S.colors.zeroRGB = hexRGB(S.colors.zero));
    const tg = t >= 0 ? [40, 210, 95] : [255, 72, 72];
    return `rgb(${Math.round(z[0] + (tg[0] - z[0]) * a)},${Math.round(z[1] + (tg[1] - z[1]) * a)},${Math.round(z[2] + (tg[2] - z[2]) * a)})`;
  }
  function hexRGB(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  const compById = (id) => S.circ.comps.find((c) => c.id === id);
  const nodeV = (n) => (S.eng ? S.eng.nodeV(n) : 0);

  function autoName(type) {
    const pre = DEFS[type].prefix;
    let max = 0;
    for (const c of S.circ.comps) {
      if (c.name && c.name.startsWith(pre)) {
        const n = parseInt(c.name.slice(pre.length), 10);
        if (n > max) max = n;
      }
    }
    return pre + (max + 1);
  }

  /* ===================== Mạch & mô phỏng ===================== */
  function normalize(circ) {
    circ.comps = (circ.comps || []).filter((c) => DEFS[c.type]).map((c) => ({
      id: c.id || MS.uid(), type: c.type, name: c.name || '', x: c.x | 0, y: c.y | 0, rot: (c.rot | 0) & 3, flip: !!c.flip,
      p: Object.assign(MS.defaultParams(c.type), c.p || {})
    }));
    circ.wires = (circ.wires || []).map((w) => ({ x1: w.x1 | 0, y1: w.y1 | 0, x2: w.x2 | 0, y2: w.y2 | 0 })).filter((w) => w.x1 !== w.x2 || w.y1 !== w.y2);
    circ.sim = Object.assign({ dt: 1e-5, speed: 1e-3, window: 0.01, dcStart: true }, circ.sim || {});
    circ.scope = Object.assign({ signals: [], xy: false }, circ.scope || {});
    for (const c of circ.comps) if (!c.name) c.name = '?';
    return circ;
  }

  function rebuild() {
    S.net = MS.buildNetlist(S.circ);
    S.eng = S.net.engine;
    S.eng.method = S.settings.method;
    S.error = null;
    S.debt = 0;
    if (S.circ.sim.dcStart && S.circ.comps.length) {
      if (!S.eng.initFromDC()) { S.eng.reset(); }
    }
    for (const e of S.net.edges) e.ph = 0;
    computeDisplay();
    // bỏ các kênh của linh kiện đã xoá
    const ids = new Set(S.circ.comps.map((c) => c.id));
    const before = scope.signals.length;
    scope.signals = scope.signals.filter((s) => ids.has(s.id));
    if (scope.signals.length !== before) renderChips();
    scope.clear();
    scope.sample(S.eng.t, sigValue, true);
    updateStatus();
  }

  function computeDisplay() {
    if (!S.eng) return;
    let vm = 0;
    for (const el of S.net.elements) {
      el.ic = el.def.currents(el, S.eng.x);
    }
    for (let n = 1; n < S.net.nNodes; n++) vm = Math.max(vm, Math.abs(S.eng.nodeV(n)));
    vm = Math.max(vm, 1);
    S.vmax = vm > S.vmax ? vm : S.vmax + (vm - S.vmax) * 0.05;
    MS.wireCurrents(S.net);
  }

  function recompile(c) {
    if (c._el && c._el.def.compile) c._el.P = c._el.def.compile(c.p);
  }

  function commit(structural) {
    S.fut = [];
    saveLocal();
    if (structural !== false) rebuild();
    updateUndo();
  }
  function pushHist() {
    S.hist.push(snapshot());
    if (S.hist.length > 120) S.hist.shift();
  }
  function undo() {
    if (!S.hist.length) return;
    S.fut.push(snapshot());
    restore(S.hist.pop());
  }
  function redo() {
    if (!S.fut.length) return;
    S.hist.push(snapshot());
    restore(S.fut.pop());
  }
  function restore(json) {
    const sigs = scope.signals.map((s) => ({ id: s.id, kind: s.kind }));
    S.circ = normalize(JSON.parse(json));
    S.sel.clear(); S.selW.clear();
    scope.setSignals(sigs.filter((s) => compById(s.id)).map((s) => Object.assign(s, { label: sigLabel(s) })));
    rebuild();
    renderChips(); renderProps(); updateUndo(); saveLocal();
  }
  function updateUndo() {
    $('#btnUndo').disabled = !S.hist.length;
    $('#btnRedo').disabled = !S.fut.length;
  }

  function saveLocal() {
    clearTimeout(saveLocal._t);
    saveLocal._t = setTimeout(() => {
      try {
        S.circ.scope = { signals: scope.signals.map((s) => ({ id: s.id, kind: s.kind })), xy: scope.xy };
        localStorage.setItem(LS_CIRC, snapshot());
      } catch (e) { /* bỏ qua */ }
    }, 300);
  }
  function saveSettings() { try { localStorage.setItem(LS_SET, JSON.stringify(S.settings)); } catch (e) { /* */ } }

  function loadCirc(obj, opts) {
    opts = opts || {};
    if (S.circ && !opts.noHist) pushHist();
    S.circ = normalize(obj);
    S.sel.clear(); S.selW.clear();
    S.running = true;
    scope.window = S.circ.sim.window;
    scope.xy = !!S.circ.scope.xy;
    scope.setSignals(S.circ.scope.signals.filter((s) => compById(s.id)).map((s) => ({ id: s.id, kind: s.kind, label: sigLabel(s) })));
    rebuild();
    syncSimUI();
    renderChips();
    renderProps();
    if (!opts.keepView) fitView();
    updateUndo();
    saveLocal();
  }

  /* ===================== Kênh dao động ký ===================== */
  function sigLabel(s) {
    const c = compById(s.id);
    if (!c) return '?';
    if (c.type === 'PROBE') return c.name;
    const t = c.type;
    if (DEFS[t].outTerm != null) return `${c.name}: ${s.kind === 'v' ? 'U ra' : 'I ra'}`;
    const v = /NPN|PNP/.test(t) ? 'U_CE' : /MOS|JF/.test(t) ? 'U_DS' : t === 'SCR' ? 'U_AK' : t === 'POT' ? 'U con chạy' : 'U';
    const i = /NPN|PNP/.test(t) ? 'I_C' : /MOS|JF/.test(t) ? 'I_D' : t === 'SCR' ? 'I_A' : t === 'POT' ? 'I con chạy' : 'I';
    return `${c.name}: ${s.kind === 'v' ? v : i}`;
  }
  function sigValue(s) {
    const c = s._c && s._c._el ? s._c : (s._c = compById(s.id));
    if (!c || !c._el || !S.eng) return 0;
    const el = c._el, n = el.n, x = S.eng.x;
    if (c.type === 'PROBE') return nodeV(n[0]);
    if (el.def.outTerm != null) { const k = el.def.outTerm; return s.kind === 'v' ? nodeV(n[k]) : -el.def.currents(el, x)[k]; }
    if (c.type === 'POT') return s.kind === 'v' ? nodeV(n[2]) : el.def.currents(el, x)[2];
    if (el.def.terms.length === 3 && c.type !== 'SCR') return s.kind === 'v' ? nodeV(n[1]) - nodeV(n[2]) : el.def.currents(el, x)[1];
    return s.kind === 'v' ? nodeV(n[0]) - nodeV(n[1]) : el.def.currents(el, x)[0];
  }
  function addSignal(id, kind) {
    const s = { id, kind };
    s.label = sigLabel(s);
    if (!scope.addSignal(s)) { toast('Kênh này đã có trên dao động ký'); return; }
    renderChips();
    saveLocal();
    $('#scopePanel').classList.remove('collapsed');
  }
  function renderChips() {
    const box = $('#scopeChips');
    box.innerHTML = '';
    scope.signals.forEach((s, i) => {
      s._c = null;
      const el = document.createElement('span');
      el.className = 'chip';
      el.style.setProperty('--c', s.color);
      el.innerHTML = `<i></i><span class="chip-name">${MS.escapeHTML(s.label)}</span><span class="chip-val"></span><button title="Bỏ kênh">×</button>`;
      el.querySelector('button').addEventListener('click', () => { scope.removeSignal(i); renderChips(); saveLocal(); });
      box.appendChild(el);
    });
  }
  function updateChips() {
    const chips = $('#scopeChips').children;
    scope.signals.forEach((s, i) => {
      const ch = chips[i];
      if (!ch) return;
      const u = s.kind === 'i' ? 'A' : 'V';
      ch.querySelector('.chip-val').textContent = `${fmt(scope.current(s), u)} · ${fmt(s.perDiv, u)}/div`;
    });
  }

  /* ===================== Toạ độ & vùng chạm ===================== */
  const toWorld = (sx, sy) => [(sx - S.view.x) / (G * S.view.z), (sy - S.view.y) / (G * S.view.z)];
  const snap = (v) => Math.round(v);

  function compAt(wx, wy) {
    for (let i = S.circ.comps.length - 1; i >= 0; i--) {
      const c = S.circ.comps[i];
      const [lx, ly] = MS.invXform(c, wx, wy);
      const b = DEFS[c.type].bbox;
      if (lx >= b[0] - 0.15 && lx <= b[2] + 0.15 && ly >= b[1] - 0.15 && ly <= b[3] + 0.15) return c;
    }
    return null;
  }
  function distSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
    let t = L ? ((px - x1) * dx + (py - y1) * dy) / L : 0;
    t = MS.clamp(t, 0, 1);
    return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
  }
  function wireAt(wx, wy) {
    for (let i = S.circ.wires.length - 1; i >= 0; i--) {
      const w = S.circ.wires[i];
      if (distSeg(wx, wy, w.x1, w.y1, w.x2, w.y2) < 0.3) return w;
    }
    return null;
  }
  // Điểm nối (cực linh kiện hoặc đầu dây) gần con trỏ
  function connAt(wx, wy) {
    const gx = snap(wx), gy = snap(wy);
    if (Math.hypot(wx - gx, wy - gy) > 0.38 || !S.net) return null;
    const p = S.net.pts.find((q) => q.x === gx && q.y === gy);
    return p || null;
  }

  /* ===================== Vẽ ===================== */
  function resize() {
    const r = cv.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    cv.style.width = r.width + 'px';
    cv.style.height = r.height + 'px';
  }

  function dotSpeed(i) {
    const a = Math.abs(i);
    if (a < 1e-6) return 0;
    return (S.settings.flow === 'electron' ? -1 : 1) * Math.sign(i) * 0.7 * Math.log10(1 + a / 1e-6) * S.settings.dotSpeed;
  }
  function drawDotsAlong(pts, phase) {
    let total = 0;
    const segs = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      segs.push([pts[i], pts[i + 1], total, L]);
      total += L;
    }
    const ph = ((phase % 1) + 1) % 1;
    for (let s = ph; s < total; s += 1) {
      const seg = segs.find((q) => s >= q[2] && s <= q[2] + q[3]);
      if (!seg) continue;
      const t = seg[3] ? (s - seg[2]) / seg[3] : 0;
      const x = seg[0][0] + (seg[1][0] - seg[0][0]) * t, y = seg[0][1] + (seg[1][1] - seg[0][1]) * t;
      g.moveTo(x + 0.13, y);
      g.arc(x, y, 0.13, 0, Math.PI * 2);
    }
  }

  function drawComp(c, ghost) {
    const def = DEFS[c.type];
    const el = c._el;
    const sel = S.sel.has(c);
    const o = {
      col: (i) => (ghost || !el ? S.colors.body : sel ? S.colors.sel : colorV(nodeV(el.n[i]))),
      body: ghost ? S.colors.body : sel ? S.colors.sel : S.colors.body,
      fillBody: S.colors.fill,
      ic: el && !ghost ? el.ic : null,
      volt: (i) => (el && !ghost ? nodeV(el.n[i]) : 0),
      ansi: S.settings.ansi
    };
    if (c.type === 'PROBE') {
      const s = scope.signals.find((q) => q.id === c.id);
      o.probeColor = s ? s.color : S.colors.muted;
    }
    const pseudo = ghost ? { comp: c, P: def.compile ? def.compile(c.p) : {} } : el || { comp: c };
    if (!pseudo.comp) pseudo.comp = c;
    g.save();
    g.translate(c.x, c.y);
    g.rotate(((c.rot & 3) * Math.PI) / 2);
    if (c.flip) g.scale(1, -1);
    if (ghost) g.globalAlpha = 0.55;
    def.draw(g, pseudo, o);
    g.restore();
  }

  function compLabel(c) {
    const def = DEFS[c.type];
    if (def.noLabel) return;
    const b = def.bbox;
    const cs = [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]].map(([x, y]) => MS.xform(c, x, y));
    const minX = Math.min(...cs.map((p) => p[0])), maxX = Math.max(...cs.map((p) => p[0]));
    const minY = Math.min(...cs.map((p) => p[1])), maxY = Math.max(...cs.map((p) => p[1]));
    let val = '';
    if (def.meter && c._el && S.eng) val = fmt(def.reading(c._el, S.eng), def.meter);
    else if (S.settings.showValues && def.value) val = def.value(c.p);
    const horiz = (def.terms.length === 2 || def.labelTop) && (c.rot & 1) === 0;
    g.textBaseline = 'middle';
    if (horiz) {
      g.textAlign = 'center';
      const cx = (minX + maxX) / 2;
      if (val) { setFont(def.meter); g.fillStyle = def.meter ? S.colors.sel : S.colors.muted; g.fillText(val, cx, minY - 0.4); }
      g.font = '600 0.62px system-ui, sans-serif'; g.fillStyle = S.colors.text;
      g.fillText(c.name, cx, minY - (val ? 1.15 : 0.45));
    } else {
      g.textAlign = 'left';
      const cy = (minY + maxY) / 2;
      const x = maxX + 0.35;
      g.font = '600 0.62px system-ui, sans-serif'; g.fillStyle = S.colors.text;
      g.fillText(c.name, x, val ? cy - 0.38 : cy);
      if (val) { setFont(def.meter); g.fillStyle = def.meter ? S.colors.sel : S.colors.muted; g.fillText(val, x, cy + 0.38); }
    }
  }
  function setFont(bold) { g.font = (bold ? '700 0.66px' : '0.56px') + ' system-ui, sans-serif'; }

  /* Mũi tên chiều dòng điện + giá trị */
  function arrowLine(x1, y1, x2, y2, color) {
    g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 0.09;
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    const a = Math.atan2(y2 - y1, x2 - x1), s = 0.32;
    g.beginPath();
    g.moveTo(x2 + 0.05 * Math.cos(a), y2 + 0.05 * Math.sin(a));
    g.lineTo(x2 - s * Math.cos(a - 0.5), y2 - s * Math.sin(a - 0.5));
    g.lineTo(x2 - s * Math.cos(a + 0.5), y2 - s * Math.sin(a + 0.5));
    g.closePath(); g.fill();
  }
  function arrowText(txt, x, y, align, color) {
    g.font = '700 0.52px system-ui, sans-serif';
    g.textAlign = align; g.textBaseline = 'middle';
    const w = g.measureText(txt).width;
    const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    g.fillStyle = S.colors.bg; g.globalAlpha = 0.85;
    g.fillRect(x0 - 0.1, y - 0.34, w + 0.2, 0.68);
    g.globalAlpha = 1; g.fillStyle = color;
    g.fillText(txt, x, y);
  }
  function drawCurrentArrows(c) {
    const el = c._el, def = DEFS[c.type];
    if (!el || !el.ic || c.type === 'GND' || c.type === 'PROBE' || c.type === 'VM' || c.type === 'LOGICOUT') return;
    const elec = S.settings.flow === 'electron';
    const col = elec ? S.colors.electron : S.colors.dot;
    const pre = elec ? 'e⁻ ' : 'I = ';
    const t = MS.terminals(c);
    if (def.terms.length === 2) {
      const I = el.ic[0];
      if (Math.abs(I) < 1e-9) return;
      const [a, b] = t;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
      const horiz = Math.abs(ux) > 0.5;
      const mx = (a[0] + b[0]) / 2 + (horiz ? 0 : -1.45), my = (a[1] + b[1]) / 2 + (horiz ? 1.45 : 0);
      const s = Math.sign(I) * (elec ? -1 : 1);
      arrowLine(mx - ux * 0.85 * s, my - uy * 0.85 * s, mx + ux * 0.85 * s, my + uy * 0.85 * s, col);
      const txt = pre + fmt(Math.abs(I), 'A');
      if (horiz) arrowText(txt, mx, my + 0.65, 'center', col);
      else arrowText(txt, mx - 0.45, my, 'right', col);
      return;
    }
    const b = def.bbox;
    const [cx, cy] = MS.xform(c, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
    t.forEach((T, i) => {
      const I = el.ic[i];
      if (Math.abs(I) < 1e-9) return;
      const path = def.paths.find((q) => q[0] === i);
      let N = path ? MS.xform(c, path[1][1][0], path[1][1][1]) : [cx, cy];
      let dx = N[0] - T[0], dy = N[1] - T[1];
      const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
      let px = -dy, py = dx;
      if (px * (T[0] - cx) + py * (T[1] - cy) < 0) { px = -px; py = -py; }
      const ox = T[0] + dx * 0.6 + px * 0.42, oy = T[1] + dy * 0.6 + py * 0.42;
      const s = Math.sign(I) * (elec ? -1 : 1); // dương: đi vào cực
      arrowLine(ox - dx * 0.4 * s, oy - dy * 0.4 * s, ox + dx * 0.4 * s, oy + dy * 0.4 * s, col);
      const nm = def.termNames ? def.termNames[i] : '';
      const txt = (elec ? 'e⁻ ' : 'I' + (nm ? '_' + nm : '') + ' = ') + fmt(Math.abs(I), 'A');
      const tx = ox + px * 0.4, ty = oy + py * 0.4;
      arrowText(txt, tx, ty, Math.abs(px) > 0.5 ? (px > 0 ? 'left' : 'right') : 'center', col);
    });
  }

  function render() {
    const dpr = window.devicePixelRatio || 1;
    const W = cv.width / dpr, H = cv.height / dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = S.colors.bg;
    g.fillRect(0, 0, W, H);
    const sc = G * S.view.z;
    // lưới
    if (sc >= 7) {
      g.fillStyle = S.colors.grid;
      const x0 = Math.floor(-S.view.x / sc), x1 = Math.ceil((W - S.view.x) / sc);
      const y0 = Math.floor(-S.view.y / sc), y1 = Math.ceil((H - S.view.y) / sc);
      const r = sc > 14 ? 1.5 : 1;
      for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) g.fillRect(S.view.x + i * sc - r / 2, S.view.y + j * sc - r / 2, r, r);
    }
    g.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * S.view.x, dpr * S.view.y);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const net = S.net;

    // dây
    if (net) {
      for (const e of net.edges) {
        const w = S.circ.wires[e.wire];
        if (S.selW.has(w)) {
          g.strokeStyle = S.colors.sel; g.globalAlpha = 0.35; g.lineWidth = 0.42;
          g.beginPath(); g.moveTo(e.a.x, e.a.y); g.lineTo(e.b.x, e.b.y); g.stroke();
          g.globalAlpha = 1;
        }
        g.strokeStyle = colorV(nodeV(e.a.node));
        g.lineWidth = 0.12;
        g.beginPath(); g.moveTo(e.a.x, e.a.y); g.lineTo(e.b.x, e.b.y); g.stroke();
      }
    }
    // linh kiện
    for (const c of S.circ.comps) drawComp(c);
    // điểm nối & cực hở
    if (net) {
      for (const p of net.pts) {
        if (p.deg >= 3) { g.fillStyle = colorV(nodeV(p.node)); g.beginPath(); g.arc(p.x, p.y, 0.2, 0, Math.PI * 2); g.fill(); }
      }
      g.strokeStyle = '#ff5a5a'; g.lineWidth = 0.07;
      for (const p of net.unconnected) { g.beginPath(); g.arc(p.x, p.y, 0.22, 0, Math.PI * 2); g.stroke(); }
    }
    // chấm dòng điện
    if (net && S.settings.showDots && S.eng) {
      g.fillStyle = S.settings.flow === 'electron' ? S.colors.electron : S.colors.dot;
      g.beginPath();
      for (const e of net.edges) {
        if (Math.abs(e.cur) < 1e-6) continue;
        drawDotsAlong([[e.a.x, e.a.y], [e.b.x, e.b.y]], e.ph || 0);
      }
      for (const c of S.circ.comps) {
        const el = c._el;
        if (!el || !el.ic) continue;
        const paths = DEFS[c.type].paths;
        if (!c._dph) c._dph = paths.map(() => 0);
        paths.forEach(([ti, pts], k) => {
          if (Math.abs(el.ic[ti]) < 1e-6) return;
          drawDotsAlong(pts.map(([x, y]) => MS.xform(c, x, y)), c._dph[k]);
        });
      }
      g.fill();
    }
    // nhãn
    for (const c of S.circ.comps) compLabel(c);
    if (S.eng) for (const c of S.circ.comps) if (S.settings.arrowsAll || S.sel.has(c)) drawCurrentArrows(c);

    // đối tượng tạm
    const d = S.drag;
    if (S.tool === 'place' && S.mouse.in && !d) {
      drawComp({ type: S.placeType, x: snap(S.mouse.wx), y: snap(S.mouse.wy), rot: S.placeRot, flip: S.placeFlip, p: MS.defaultParams(S.placeType), name: '' }, true);
    }
    if (d && d.mode === 'wire') {
      g.strokeStyle = S.colors.sel; g.lineWidth = 0.12; g.setLineDash([0.3, 0.25]);
      g.beginPath();
      for (const [a, b] of wireSegs(d)) { g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
      g.stroke(); g.setLineDash([]);
    }
    if (d && d.mode === 'band') {
      g.fillStyle = 'rgba(79,195,247,0.08)'; g.strokeStyle = S.colors.sel; g.lineWidth = 0.05;
      const x = Math.min(d.wx0, S.mouse.wx), y = Math.min(d.wy0, S.mouse.wy);
      g.fillRect(x, y, Math.abs(S.mouse.wx - d.wx0), Math.abs(S.mouse.wy - d.wy0));
      g.strokeRect(x, y, Math.abs(S.mouse.wx - d.wx0), Math.abs(S.mouse.wy - d.wy0));
    }
    // điểm nối đang trỏ
    const hp = S.mouse.in && !d ? connAt(S.mouse.wx, S.mouse.wy) : null;
    if (hp && (S.tool === 'select' || S.tool === 'wire')) {
      g.strokeStyle = S.colors.sel; g.lineWidth = 0.08;
      g.beginPath(); g.arc(hp.x, hp.y, 0.32, 0, Math.PI * 2); g.stroke();
    }
    // chú thích điện áp tại con trỏ
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (S.mouse.in && !d && net && S.eng) {
      let node = null;
      if (hp) node = hp.node;
      else {
        const w = wireAt(S.mouse.wx, S.mouse.wy);
        if (w) { const p = net.pts.find((q) => q.x === w.x1 && q.y === w.y1); if (p) node = p.node; }
      }
      if (node !== null) {
        const txt = node === 0 ? '0 V (đất)' : fmt(nodeV(node), 'V');
        g.font = '600 12px system-ui, sans-serif';
        const tw = g.measureText(txt).width + 12;
        const x = S.mouse.sx + 14, y = S.mouse.sy - 26;
        g.fillStyle = 'rgba(0,0,0,0.75)';
        g.fillRect(x, y, tw, 20);
        g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'middle';
        g.fillText(txt, x + 6, y + 10);
      }
    }
  }

  /* ===================== Thao tác soạn thảo ===================== */
  function wireSegs(d) {
    const a = [d.gx0, d.gy0], b = [snap(S.mouse.wx), snap(S.mouse.wy)];
    if (a[0] === b[0] || a[1] === b[1]) return [[a, b]];
    const m = d.hfirst ? [b[0], a[1]] : [a[0], b[1]];
    return [[a, m], [m, b]];
  }
  function addWires(segs) {
    let n = 0;
    for (const [a, b] of segs) {
      if (a[0] === b[0] && a[1] === b[1]) continue;
      const dup = S.circ.wires.some((w) => (w.x1 === a[0] && w.y1 === a[1] && w.x2 === b[0] && w.y2 === b[1]) || (w.x1 === b[0] && w.y1 === b[1] && w.x2 === a[0] && w.y2 === a[1]));
      if (dup) continue;
      S.circ.wires.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
      n++;
    }
    return n;
  }

  // Biến đổi linh kiện, kéo theo đầu dây đang nối vào cực của chúng
  function transformComps(comps, mutate) {
    const before = comps.map((c) => MS.terminals(c));
    mutate();
    const map = new Map();
    comps.forEach((c, i) => {
      const after = MS.terminals(c), key = (ps) => ps.map((p) => p.join(',')).sort().join(';');
      if (key(before[i]) === key(after)) return; // cực vẫn nằm đúng chỗ cũ (vd. xoay 180°): dây giữ nguyên
      before[i].forEach((p, j) => map.set(p[0] + ',' + p[1], after[j]));
    });
    for (const w of S.circ.wires) {
      if (S.selW.has(w)) continue;
      const a = map.get(w.x1 + ',' + w.y1), b = map.get(w.x2 + ',' + w.y2);
      if (a) { w.x1 = a[0]; w.y1 = a[1]; }
      if (b) { w.x2 = b[0]; w.y2 = b[1]; }
    }
    S.circ.wires = S.circ.wires.filter((w) => w.x1 !== w.x2 || w.y1 !== w.y2);
  }

  // Xoay n bước 90° quanh tâm các cực (không phải cực 0): linh kiện 2 cực xoay 180° đứng yên tại chỗ, chỉ đảo cực
  function turn(c, n) {
    const centre = () => { const t = MS.terminals(c), xs = t.map((q) => q[0]), ys = t.map((q) => q[1]); return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]; };
    const a = centre();
    c.rot = (c.rot + n + 4) & 3;
    const b = centre();
    c.x += Math.round(a[0] - b[0]); c.y += Math.round(a[1] - b[1]);
  }
  function rotateSel(dir) {
    if (S.tool === 'place') { S.placeRot = (S.placeRot + (dir || 1) + 4) & 3; return; }
    const comps = [...S.sel];
    if (!comps.length) return;
    pushHist();
    transformComps(comps, () => comps.forEach((c) => turn(c, dir || 1)));
    commit();
  }
  function flipSel() {
    if (S.tool === 'place') { S.placeFlip = !S.placeFlip; return; }
    const comps = [...S.sel];
    if (!comps.length) return;
    pushHist();
    // Linh kiện 2 cực: lật không đổi vị trí cực nên "lật" = đảo cực (xoay 180° tại chỗ)
    transformComps(comps, () => comps.forEach((c) => (DEFS[c.type].terms.length === 2 ? turn(c, 2) : (c.flip = !c.flip))));
    commit();
  }
  function deleteSel() {
    if (!S.sel.size && !S.selW.size) return;
    pushHist();
    S.circ.comps = S.circ.comps.filter((c) => !S.sel.has(c));
    S.circ.wires = S.circ.wires.filter((w) => !S.selW.has(w));
    S.sel.clear(); S.selW.clear();
    commit();
    renderProps();
  }
  function copySel() {
    if (!S.sel.size && !S.selW.size) return false;
    S.clip = JSON.stringify({ comps: [...S.sel], wires: [...S.selW] }, strip);
    return true;
  }
  function paste(off) {
    if (!S.clip) return;
    const d = JSON.parse(S.clip);
    pushHist();
    S.sel.clear(); S.selW.clear();
    const o = off == null ? 2 : off;
    for (const c of d.comps) {
      const n = Object.assign({}, c, { id: MS.uid(), x: c.x + o, y: c.y + o });
      n.name = autoName(n.type);
      S.circ.comps.push(n);
      S.sel.add(n);
    }
    for (const w of d.wires) {
      const n = { x1: w.x1 + o, y1: w.y1 + o, x2: w.x2 + o, y2: w.y2 + o };
      S.circ.wires.push(n);
      S.selW.add(n);
    }
    commit();
    renderProps();
  }

  function setTool(t, type) {
    S.tool = t;
    S.placeType = type || null;
    if (t === 'place') { S.placeRot = 0; S.placeFlip = false; }
    document.querySelectorAll('.pal-item').forEach((b) => b.classList.toggle('active', t === 'place' && b.dataset.type === type));
    $('#toolSelect').classList.toggle('active', t === 'select');
    $('#toolWire').classList.toggle('active', t === 'wire');
    cv.style.cursor = t === 'wire' ? 'crosshair' : t === 'place' ? 'copy' : 'default';
    updateStatus();
  }

  function fitView() {
    const r = cv.getBoundingClientRect();
    const xs = [], ys = [];
    for (const c of S.circ.comps) {
      const b = DEFS[c.type].bbox;
      for (const [x, y] of [[b[0], b[1]], [b[2], b[3]]]) { const p = MS.xform(c, x, y); xs.push(p[0]); ys.push(p[1]); }
    }
    for (const w of S.circ.wires) { xs.push(w.x1, w.x2); ys.push(w.y1, w.y2); }
    if (!xs.length || !r.width) { S.view = { x: r.width / 2, y: r.height / 2, z: 1 }; return; }
    const x0 = Math.min(...xs) - 3, x1 = Math.max(...xs) + 5, y0 = Math.min(...ys) - 3, y1 = Math.max(...ys) + 3;
    const z = MS.clamp(Math.min(r.width / ((x1 - x0) * G), r.height / ((y1 - y0) * G)), 0.3, 2.2);
    S.view.z = z;
    S.view.x = r.width / 2 - ((x0 + x1) / 2) * G * z;
    S.view.y = r.height / 2 - ((y0 + y1) / 2) * G * z;
  }

  function zoomAt(sx, sy, f) {
    const z = MS.clamp(S.view.z * f, 0.2, 4);
    const [wx, wy] = toWorld(sx, sy);
    S.view.z = z;
    S.view.x = sx - wx * G * z;
    S.view.y = sy - wy * G * z;
  }

  /* ===================== Chuột / cảm ứng ===================== */
  function evPos(e) {
    const r = cv.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const [wx, wy] = toWorld(sx, sy);
    Object.assign(S.mouse, { sx, sy, wx, wy });
    return { sx, sy, wx, wy };
  }

  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    const p = evPos(e);
    const gx = snap(p.wx), gy = snap(p.wy);
    if (e.button === 1 || e.button === 2) {
      if (e.button === 2 && S.tool !== 'select') { setTool('select'); return; }
      S.drag = { mode: 'pan', sx0: p.sx, sy0: p.sy, vx0: S.view.x, vy0: S.view.y };
      return;
    }
    if (S.tool === 'place') {
      pushHist();
      const c = { id: MS.uid(), type: S.placeType, name: autoName(S.placeType), x: gx, y: gy, rot: S.placeRot, flip: S.placeFlip, p: MS.defaultParams(S.placeType) };
      S.circ.comps.push(c);
      S.sel.clear(); S.selW.clear(); S.sel.add(c);
      commit();
      if (c.type === 'PROBE') addSignal(c.id, 'v');
      renderProps();
      if (!e.shiftKey) setTool('select');
      return;
    }
    if (S.tool === 'wire') {
      S.drag = { mode: 'wire', gx0: gx, gy0: gy, hfirst: null };
      return;
    }
    // chế độ chọn
    const conn = connAt(p.wx, p.wy);
    const c = compAt(p.wx, p.wy);
    if (conn && !(c && S.sel.has(c) && e.altKey)) {
      S.drag = { mode: 'wire', gx0: conn.x, gy0: conn.y, hfirst: null, fromConn: true, comp: c };
      return;
    }
    if (c) {
      if (e.shiftKey) { S.sel.has(c) ? S.sel.delete(c) : S.sel.add(c); }
      else if (!S.sel.has(c)) { S.sel.clear(); S.selW.clear(); S.sel.add(c); }
      S.drag = { mode: 'move', gx0: gx, gy0: gy, lastGx: gx, lastGy: gy, moved: false, comp: c };
      renderProps();
      return;
    }
    const w = wireAt(p.wx, p.wy);
    if (w) {
      if (e.shiftKey) { S.selW.has(w) ? S.selW.delete(w) : S.selW.add(w); }
      else if (!S.selW.has(w)) { S.sel.clear(); S.selW.clear(); S.selW.add(w); }
      S.drag = { mode: 'move', gx0: gx, gy0: gy, lastGx: gx, lastGy: gy, moved: false };
      renderProps();
      return;
    }
    if (e.pointerType === 'touch') {
      S.drag = { mode: 'pan', sx0: p.sx, sy0: p.sy, vx0: S.view.x, vy0: S.view.y, tap: true };
      return;
    }
    if (!e.shiftKey) { S.sel.clear(); S.selW.clear(); renderProps(); }
    S.drag = { mode: 'band', wx0: p.wx, wy0: p.wy };
  });

  cv.addEventListener('pointermove', (e) => {
    const p = evPos(e);
    S.mouse.in = true;
    const d = S.drag;
    if (!d) return;
    if (d.mode === 'pan') {
      S.view.x = d.vx0 + p.sx - d.sx0;
      S.view.y = d.vy0 + p.sy - d.sy0;
      if (Math.hypot(p.sx - d.sx0, p.sy - d.sy0) > 4) d.tap = false;
    } else if (d.mode === 'wire') {
      const dx = snap(p.wx) - d.gx0, dy = snap(p.wy) - d.gy0;
      if (d.hfirst === null && (dx || dy)) d.hfirst = Math.abs(dx) >= Math.abs(dy);
    } else if (d.mode === 'move') {
      const gx = snap(p.wx), gy = snap(p.wy);
      const ddx = gx - d.lastGx, ddy = gy - d.lastGy;
      if (ddx || ddy) {
        if (!d.moved) { pushHist(); d.moved = true; }
        const comps = [...S.sel];
        transformComps(comps, () => comps.forEach((c) => { c.x += ddx; c.y += ddy; }));
        for (const w of S.selW) { w.x1 += ddx; w.y1 += ddy; w.x2 += ddx; w.y2 += ddy; }
        d.lastGx = gx; d.lastGy = gy;
        rebuild();
      }
    }
  });

  cv.addEventListener('pointerup', (e) => {
    const p = evPos(e);
    const d = S.drag;
    S.drag = null;
    if (!d) return;
    if (d.mode === 'wire') {
      const segs = wireSegs(d);
      if (addWiresCheck(segs)) { pushHist(); addWires(segs); commit(); }
      else if (d.fromConn && d.comp && DEFS[d.comp.type].clickable) toggleSwitch(d.comp);
    } else if (d.mode === 'move') {
      if (d.moved) commit();
      else if (d.comp && DEFS[d.comp.type].clickable && !e.shiftKey) toggleSwitch(d.comp);
    } else if (d.mode === 'band') {
      const x0 = Math.min(d.wx0, p.wx), x1 = Math.max(d.wx0, p.wx), y0 = Math.min(d.wy0, p.wy), y1 = Math.max(d.wy0, p.wy);
      if (x1 - x0 > 0.2 || y1 - y0 > 0.2) {
        for (const c of S.circ.comps) {
          const t = MS.terminals(c);
          if (t.every(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) S.sel.add(c);
        }
        for (const w of S.circ.wires) if (w.x1 >= x0 && w.x1 <= x1 && w.x2 >= x0 && w.x2 <= x1 && w.y1 >= y0 && w.y1 <= y1 && w.y2 >= y0 && w.y2 <= y1) S.selW.add(w);
        renderProps();
      }
    } else if (d.mode === 'pan' && d.tap) {
      S.sel.clear(); S.selW.clear(); renderProps();
    }
  });
  function addWiresCheck(segs) { return segs.some(([a, b]) => a[0] !== b[0] || a[1] !== b[1]); }

  cv.addEventListener('pointerleave', () => { S.mouse.in = false; });
  cv.addEventListener('pointerenter', () => { S.mouse.in = true; });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = evPos(e);
    zoomAt(p.sx, p.sy, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  }, { passive: false });
  cv.addEventListener('dblclick', (e) => {
    const p = evPos(e);
    const c = compAt(p.wx, p.wy);
    if (c) {
      S.sel.clear(); S.selW.clear(); S.sel.add(c); renderProps();
      const inp = $('#props input[type=text], #props select');
      if (inp) inp.focus();
    }
  });

  function toggleSwitch(c) {
    pushHist();
    const k = DEFS[c.type].toggleKey || 'closed';
    c.p[k] = !c.p[k];
    recompile(c);
    commit(false);
    renderProps();
  }

  /* ===================== Bàn phím ===================== */
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea, dialog') || document.body.dataset.view !== 'design') return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (mod && k === 'c') { if (copySel()) { e.preventDefault(); toast('Đã sao chép'); } }
    else if (mod && k === 'x') { if (copySel()) { e.preventDefault(); deleteSel(); } }
    else if (mod && k === 'v') { e.preventDefault(); paste(); }
    else if (mod && k === 'd') { e.preventDefault(); if (copySel()) paste(); }
    else if (mod && k === 'a') { e.preventDefault(); S.circ.comps.forEach((c) => S.sel.add(c)); S.circ.wires.forEach((w) => S.selW.add(w)); renderProps(); }
    else if (mod && k === 's') { e.preventDefault(); saveFile(); }
    else if (mod) return;
    else if (k === 'delete' || k === 'backspace') { e.preventDefault(); deleteSel(); }
    else if (k === 'r') rotateSel(e.shiftKey ? -1 : 1);
    else if (k === 'f') flipSel();
    else if (k === 'w') setTool('wire');
    else if (k === 'v' || k === 'escape') { setTool('select'); if (k === 'escape') { S.sel.clear(); S.selW.clear(); S.drag = null; renderProps(); } }
    else if (k === ' ') { e.preventDefault(); toggleRun(); }
    else if (k === 'home' || k === '0') fitView();
    else if (k === '+' || k === '=') zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 1.2);
    else if (k === '-') zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 1 / 1.2);
    else {
      const hot = { g: 'GND', 1: 'R', 2: 'C', 3: 'L', 4: 'V', 5: 'AC', 6: 'D', 7: 'LED', 8: 'NPN', 9: 'NMOS', p: 'PROBE' }[k];
      if (hot) setTool('place', hot);
    }
  });

  /* ===================== Bảng linh kiện ===================== */
  function buildPalette() {
    const pal = $('#palette');
    pal.innerHTML = '';
    for (const cat of MS.CATEGORIES) {
      const h = document.createElement('h3');
      h.textContent = cat.name;
      pal.appendChild(h);
      const grid = document.createElement('div');
      grid.className = 'pal-grid';
      for (const type of cat.items) {
        const def = DEFS[type];
        const b = document.createElement('button');
        b.className = 'pal-item';
        b.dataset.type = type;
        b.title = def.name;
        const ic = document.createElement('canvas');
        ic.width = 112; ic.height = 64;
        b.appendChild(ic);
        const s = document.createElement('span');
        s.textContent = def.name;
        b.appendChild(s);
        b.addEventListener('click', () => (S.tool === 'place' && S.placeType === type ? setTool('select') : setTool('place', type)));
        grid.appendChild(b);
      }
      pal.appendChild(grid);
    }
    drawPaletteIcons();
  }
  function drawPaletteIcons() {
    document.querySelectorAll('.pal-item').forEach((b) => {
      const type = b.dataset.type, def = DEFS[type];
      if (!def) return; // mục của palette breadboard (có bộ vẽ riêng)
      const ic = b.querySelector('canvas'), x = ic.getContext('2d');
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.clearRect(0, 0, ic.width, ic.height);
      const bb = def.bbox;
      const w = bb[2] - bb[0], h = bb[3] - bb[1];
      const s = Math.min(96 / w, 52 / h, 22);
      x.setTransform(s, 0, 0, s, 56 - ((bb[0] + bb[2]) / 2) * s, 32 - ((bb[1] + bb[3]) / 2) * s);
      x.lineCap = 'round'; x.lineJoin = 'round';
      const p = MS.defaultParams(type);
      const o = { col: () => S.colors.body, body: S.colors.body, fillBody: S.colors.fill, ic: type === 'LED' ? [0.015] : null, ansi: S.settings.ansi, probeColor: '#ffd60a' };
      def.draw(x, { comp: { p, name: '' }, P: def.compile ? def.compile(p) : {} }, o);
    });
  }

  /* ===================== Bảng thuộc tính ===================== */
  function renderProps() {
    const box = $('#props');
    box.innerHTML = '';
    const comps = [...S.sel], wires = [...S.selW];
    if (comps.length === 1 && !wires.length) {
      const c = comps[0], def = DEFS[c.type];
      const head = document.createElement('div');
      head.className = 'props-head';
      head.innerHTML = `<div class="props-type">${MS.escapeHTML(def.name)}</div>`;
      const nameRow = document.createElement('label');
      nameRow.className = 'field';
      nameRow.innerHTML = '<span class="field-label">Tên</span>';
      const ni = document.createElement('input');
      ni.type = 'text'; ni.value = c.name;
      ni.addEventListener('change', () => { pushHist(); c.name = ni.value.trim() || c.name; commit(false); scope.signals.forEach((s) => { if (s.id === c.id) s.label = sigLabel(s); }); renderChips(); });
      ni.addEventListener('keydown', (e) => { if (e.key === 'Enter') ni.blur(); e.stopPropagation(); });
      nameRow.appendChild(ni);
      head.appendChild(nameRow);
      box.appendChild(head);
      if (def.params.length) {
        const pf = document.createElement('div');
        pf.className = 'props-params';
        let pushed = false;
        MS.paramForm(pf, def, c.p, (k, live) => {
          if (!pushed) { pushHist(); pushed = true; }
          recompile(c);
          if (!live) { commit(false); pushed = false; }
          if (c.type === 'AC' && k === 'wave') drawPaletteIcons();
        });
        box.appendChild(pf);
      }
      const acts = document.createElement('div');
      acts.className = 'props-actions';
      const btn = (label, fn, cls) => { const b = document.createElement('button'); b.innerHTML = label; b.className = cls || ''; b.addEventListener('click', fn); acts.appendChild(b); };
      if (c.type !== 'GND') {
        btn(`${MS.icon('ChartLine')} Đo điện áp`, () => addSignal(c.id, 'v'));
        if (c.type !== 'PROBE' && c.type !== 'VM' && c.type !== 'LOGICOUT') btn(`${MS.icon('ChartLine')} Đo dòng điện`, () => addSignal(c.id, 'i'));
      }
      btn(`${MS.icon('RotateCw')} Xoay (R)`, () => rotateSel(1));
      btn(`${MS.icon('FlipVertical2')} Lật (F)`, () => flipSel());
      btn(`${MS.icon('Trash2')} Xóa`, () => deleteSel(), 'danger');
      box.appendChild(acts);
      const live = document.createElement('div');
      live.className = 'props-live';
      live.id = 'propsLive';
      box.appendChild(live);
      if (def.termNames) {
        const tn = document.createElement('div');
        tn.className = 'hint';
        tn.textContent = 'Thứ tự chân: ' + def.termNames.join(' – ');
        box.appendChild(tn);
      }
      if (def.theory) {
        const th = document.createElement('div');
        th.className = 'theory';
        th.innerHTML = '<h3>Lý thuyết</h3>' + def.theory;
        box.appendChild(th);
      }
      updateLive();
      return;
    }
    if (comps.length || wires.length) {
      const d = document.createElement('div');
      d.className = 'props-head';
      let node = '';
      if (wires.length === 1 && !comps.length && S.net) {
        const w = wires[0];
        const p = S.net.pts.find((q) => q.x === w.x1 && q.y === w.y1);
        if (p) node = `<p>Điện áp nút: <b id="wireV">${p.node === 0 ? '0 V (đất)' : fmt(nodeV(p.node), 'V')}</b></p>`;
      }
      d.innerHTML = `<div class="props-type">Đã chọn ${comps.length} linh kiện, ${wires.length} đoạn dây</div>${node}`;
      const acts = document.createElement('div');
      acts.className = 'props-actions';
      const b = document.createElement('button'); b.className = 'danger'; b.innerHTML = `${MS.icon('Trash2')} Xóa (Delete)`; b.onclick = deleteSel; acts.appendChild(b);
      if (comps.length) { const r = document.createElement('button'); r.innerHTML = `${MS.icon('RotateCw')} Xoay (R)`; r.onclick = () => rotateSel(1); acts.appendChild(r); }
      box.appendChild(d); box.appendChild(acts);
      return;
    }
    // không chọn gì: mô tả mạch
    const ex = S.circ.example && MS.EXAMPLES.find((e) => e.id === S.circ.example);
    const d = document.createElement('div');
    d.className = 'props-empty';
    d.innerHTML = (ex ? `<h2>${MS.escapeHTML(ex.name)}</h2><p class="ex-desc">${ex.desc}</p>` : '<h2>Mạch của bạn</h2>') +
      `<div class="tips"><h3>Cách dùng nhanh</h3><ul>
        <li><b>Đặt linh kiện:</b> chọn ở bảng bên trái rồi nhấp lên lưới. <kbd>R</kbd> xoay, <kbd>F</kbd> lật.</li>
        <li><b>Nối dây:</b> kéo từ một cực (chấm đỏ = chưa nối) tới điểm khác, hoặc dùng công cụ Dây (<kbd>W</kbd>).</li>
        <li><b>Sửa thông số:</b> nhấp vào linh kiện; bảng này sẽ hiện tham số, số đo trực tiếp và lý thuyết.</li>
        <li><b>Công tắc:</b> nhấp để bật/tắt khi đang chạy.</li>
        <li><b>Đo:</b> rê chuột lên dây để xem điện áp; dùng Đầu dò / nút “Đo” để xem dạng sóng.</li>
        <li>Màu dây: <span style="color:#28d25f">xanh = dương</span>, <span style="color:#ff4848">đỏ = âm</span>, xám = 0 V.</li>
        <li><b>Chiều dòng:</b> chấm vàng chạy theo chiều dòng <b>quy ước</b> (+ → −); bấm nút <b>“I Quy ước”</b> để đổi sang chiều <b>electron</b> (chấm xanh, − → +). Linh kiện đang chọn có mũi tên ghi giá trị dòng; nút <b>“→ I”</b> hiện mũi tên cho mọi linh kiện.</li>
      </ul></div>`;
    box.appendChild(d);
  }

  function updateLive() {
    const live = $('#propsLive');
    if (live && S.sel.size === 1 && S.eng) {
      const c = [...S.sel][0];
      const el = c._el;
      if (el && el.def.info) {
        let rows;
        try { rows = el.def.info(el, S.eng); } catch (e) { rows = []; }
        live.innerHTML = '<h3>Số đo trực tiếp</h3><table>' + rows.map(([k, v]) => `<tr><td>${MS.escapeHTML(k)}</td><td>${MS.escapeHTML(v)}</td></tr>`).join('') + '</table>';
      } else live.innerHTML = '';
    }
    const wv = $('#wireV');
    if (wv && S.selW.size === 1 && S.net) {
      const w = [...S.selW][0];
      const p = S.net.pts.find((q) => q.x === w.x1 && q.y === w.y1);
      if (p) wv.textContent = p.node === 0 ? '0 V (đất)' : fmt(nodeV(p.node), 'V');
    }
  }

  /* ===================== Trạng thái / thanh công cụ ===================== */
  function updateStatus() {
    const st = $('#status');
    if (!st || !S.net) return;
    const parts = [];
    const hint = { select: 'Chọn / kéo thả · kéo từ một cực để nối dây · chuột phải kéo để cuộn', wire: 'Vẽ dây: nhấn giữ và kéo giữa hai điểm lưới', place: `Đặt ${S.placeType ? DEFS[S.placeType].name : ''}: nhấp lên lưới · R xoay · F lật · Esc thoát` }[S.tool];
    parts.push(`<span>${hint}</span>`);
    if (S.net.unconnected.length) parts.push(`<span class="warn">⚠ ${S.net.unconnected.length} cực chưa nối</span>`);
    if (S.net.groundAuto) parts.push('<span class="warn">⚠ Chưa có GND – tự chọn nút tham chiếu</span>');
    if (S.error) parts.push(`<span class="err">✖ ${S.error}</span>`);
    if (S.slow) parts.push('<span class="warn">Máy chạy chậm hơn tốc độ yêu cầu</span>');
    st.innerHTML = parts.join('');
  }

  function toggleRun() {
    if (S.error) { S.error = null; }
    S.running = !S.running;
    syncRunBtn();
    updateStatus();
  }
  function syncRunBtn() {
    const b = $('#btnRun');
    b.innerHTML = S.running ? `${MS.icon('Pause')} Tạm dừng` : `${MS.icon('Play')} Chạy`;
    b.classList.toggle('paused', !S.running);
  }
  function syncFlowBtn() {
    const e = S.settings.flow === 'electron';
    const b = $('#toolFlow');
    b.textContent = e ? 'e⁻ Electron' : 'I Quy ước';
    b.classList.toggle('electron', e);
    b.title = e ? 'Đang hiện chiều electron (− → +). Nhấp để đổi sang chiều quy ước' : 'Đang hiện chiều dòng quy ước (+ → −). Nhấp để đổi sang chiều electron';
    $('#toolArrows').classList.toggle('active', S.settings.arrowsAll);
  }
  function syncSimUI() {
    $('#speed').value = Math.log10(S.circ.sim.speed);
    $('#speedLbl').textContent = fmt(S.circ.sim.speed, 's') + '/s';
    $('#scopeWin').value = fmt(scope.window, 's').replace(' ', '');
    $('#scopeXY').checked = scope.xy;
    syncRunBtn();
    syncFlowBtn();
  }

  /* ===================== Tệp / chia sẻ ===================== */
  function saveFile() {
    S.circ.scope = { signals: scope.signals.map((s) => ({ id: s.id, kind: s.kind })), xy: scope.xy };
    const blob = new Blob([JSON.stringify(S.circ, strip, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (S.circ.example || 'mach') + '.machsim.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function b64enc(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function b64dec(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); return decodeURIComponent(escape(atob(s))); }
  function share() {
    S.circ.scope = { signals: scope.signals.map((s) => ({ id: s.id, kind: s.kind })), xy: scope.xy };
    const url = location.href.split('#')[0] + '#c=' + b64enc(snapshot());
    const done = () => toast('Đã sao chép liên kết chia sẻ mạch vào bộ nhớ tạm');
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('Sao chép liên kết:', url));
    else prompt('Sao chép liên kết:', url);
  }

  /* ===================== Vòng lặp chính ===================== */
  function tick(ts) {
    const dtR = S.lastTs ? Math.min(0.05, (ts - S.lastTs) / 1000) : 0;
    S.lastTs = ts;
    const designVisible = !$('#designView').hidden;
    if (designVisible && S.running && S.eng && !S.error && S.circ.comps.length) {
      const dt = S.circ.sim.dt;
      S.debt += S.circ.sim.speed * dtR;
      const t0 = performance.now();
      let n = 0;
      S.slow = false;
      while (S.debt >= dt) {
        if (!S.eng.step(dt)) {
          S.error = S.eng.error === 'singular'
            ? 'Ma trận suy biến: có thể có vòng nguồn áp mắc song song hoặc nguồn áp bị nối tắt.'
            : 'Mô phỏng không hội tụ. Thử giảm bước thời gian (⚙ Cài đặt) hoặc kiểm tra lại mạch.';
          S.running = false;
          syncRunBtn();
          toast(S.error, 'error');
          updateStatus();
          break;
        }
        S.debt -= dt;
        n++;
        scope.sample(S.eng.t, sigValue);
        if ((n & 7) === 0 && performance.now() - t0 > 14) { S.debt = 0; S.slow = true; break; }
      }
      computeDisplay();
      if (S.settings.showDots && S.net) {
        for (const e of S.net.edges) e.ph = (e.ph || 0) + dotSpeed(e.cur) * dtR;
        for (const c of S.circ.comps) {
          if (!c._el || !c._el.ic) continue;
          const paths = DEFS[c.type].paths;
          if (!c._dph || c._dph.length !== paths.length) c._dph = paths.map(() => 0);
          paths.forEach(([ti], k) => (c._dph[k] += dotSpeed(c._el.ic[ti]) * dtR));
        }
      }
    }
    if (designVisible) {
      render();
      if (!$('#scopePanel').classList.contains('collapsed')) scope.draw();
      if (ts - S.lastUi > 200) {
        S.lastUi = ts;
        updateLive();
        updateChips();
        $('#simTime').textContent = 't = ' + fmt(S.eng ? S.eng.t : 0, 's');
        if (S.slow !== S._slowShown) { S._slowShown = S.slow; updateStatus(); }
      }
    }
    requestAnimationFrame(tick);
  }

  /* ===================== Khởi tạo giao diện ===================== */
  function buildExamplesMenu() {
    const m = $('#exMenu');
    m.innerHTML = '';
    let grp = null;
    for (const e of MS.EXAMPLES) {
      if (e.group !== grp) {
        grp = e.group;
        const h = document.createElement('div');
        h.className = 'menu-h';
        h.textContent = grp;
        m.appendChild(h);
      }
      const b = document.createElement('button');
      b.textContent = e.name;
      b.addEventListener('click', () => { m.parentElement.classList.remove('open'); loadCirc(MS.buildExample(e)); toast('Đã mở ví dụ: ' + e.name); });
      m.appendChild(b);
    }
  }

  function applyTheme() {
    const t = S.settings.theme;
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    readColors();
    drawPaletteIcons();
  }

  function wireUI() {
    $('#btnNew').onclick = () => {
      if (S.circ.comps.length && !confirm('Xóa mạch hiện tại và bắt đầu mạch mới?')) return;
      loadCirc({ comps: [], wires: [], sim: { dt: 1e-5, speed: 1e-3, window: 0.01, dcStart: true } });
    };
    const dd = $('#btnExamples').parentElement;
    $('#btnExamples').onclick = (e) => { e.stopPropagation(); dd.classList.toggle('open'); };
    document.addEventListener('click', (e) => { if (!dd.contains(e.target)) dd.classList.remove('open'); });
    $('#btnOpen').onclick = () => $('#fileInput').click();
    $('#fileInput').onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      f.text().then((t) => { try { loadCirc(JSON.parse(t)); toast('Đã mở ' + MS.escapeHTML(f.name)); } catch (err) { toast('Tệp không hợp lệ', 'error'); } });
      e.target.value = '';
    };
    $('#btnSave').onclick = saveFile;
    $('#btnShare').onclick = share;
    $('#btnUndo').onclick = undo;
    $('#btnRedo').onclick = redo;
    $('#btnRun').onclick = toggleRun;
    $('#btnReset').onclick = () => { S.running = true; rebuild(); syncRunBtn(); };
    $('#speed').oninput = () => {
      S.circ.sim.speed = Math.pow(10, +$('#speed').value);
      $('#speedLbl').textContent = fmt(S.circ.sim.speed, 's') + '/s';
      saveLocal();
    };
    $('#toolSelect').onclick = () => setTool('select');
    $('#toolWire').onclick = () => setTool(S.tool === 'wire' ? 'select' : 'wire');
    $('#toolRotate').onclick = () => rotateSel(1);
    $('#toolDelete').onclick = deleteSel;
    $('#toolFit').onclick = fitView;
    $('#toolFlow').onclick = () => { S.settings.flow = S.settings.flow === 'electron' ? 'conv' : 'electron'; saveSettings(); syncFlowBtn(); toast(S.settings.flow === 'electron' ? 'Hiển thị chiều chuyển động electron (từ − sang +)' : 'Hiển thị chiều dòng điện quy ước (từ + sang −)'); };
    $('#toolArrows').onclick = () => { S.settings.arrowsAll = !S.settings.arrowsAll; saveSettings(); syncFlowBtn(); };
    $('#toolZoomIn').onclick = () => zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 1.25);
    $('#toolZoomOut').onclick = () => zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 0.8);

    $('#scopeXY').onchange = () => { scope.xy = $('#scopeXY').checked; saveLocal(); };
    $('#scopeWin').onchange = () => {
      const v = MS.parseSI($('#scopeWin').value);
      if (v > 0) { scope.window = v; S.circ.sim.window = v; scope.clear(); saveLocal(); }
      $('#scopeWin').value = fmt(scope.window, 's').replace(' ', '');
    };
    $('#scopeWin').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
    $('#scopeClear').onclick = () => { scope.setSignals([]); renderChips(); saveLocal(); };
    $('#scopeToggle').onclick = () => { $('#scopePanel').classList.toggle('collapsed'); setTimeout(resize, 0); };

    // tab
    document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
      const v = b.dataset.view;
      $('#designView').hidden = v !== 'design';
      $('#scopePanel').hidden = v !== 'design';
      $('#bbView').hidden = v !== 'bb';
      $('#bbScopePanel').hidden = v !== 'bb';
      document.body.dataset.view = v;
      if (v === 'bb') {
        if (!S.bb) S.bb = MS.initBreadboard({
          canvas: $('#bbCv'), scopeCanvas: $('#bbScopeCv'), palette: $('#bbPalette'), props: $('#bbProps'), chips: $('#bbChips'),
          status: $('#bbStatus'), run: $('#bbRun'), reset: $('#bbReset'), speed: $('#bbSpeed'), speedLbl: $('#bbSpeedLbl'), time: $('#bbTime'),
          fit: $('#bbFit'), del: $('#bbDel'), rot: $('#bbRot'), undo: $('#bbUndo'), clear: $('#bbClear'), exBtn: $('#bbExBtn'), exMenu: $('#bbExMenu')
        });
        setTimeout(() => S.bb.show(), 0);
      } else if (S.bb) S.bb.hide();
      setTimeout(resize, 0);
    }));

    // cài đặt
    const dlgS = $('#dlgSettings');
    $('#btnSettings').onclick = () => {
      $('#setDt').value = fmt(S.circ.sim.dt, 's').replace(' ', '');
      $('#setMethod').value = S.settings.method;
      $('#setDc').checked = S.circ.sim.dcStart;
      $('#setValues').checked = S.settings.showValues;
      $('#setDots').checked = S.settings.showDots;
      $('#setAnsi').checked = S.settings.ansi;
      $('#setTheme').value = S.settings.theme;
      $('#setFlow').value = S.settings.flow;
      $('#setArrows').checked = S.settings.arrowsAll;
      dlgS.showModal();
    };
    $('#setApply').onclick = (e) => {
      e.preventDefault();
      const dt = MS.parseSI($('#setDt').value);
      if (dt > 0) S.circ.sim.dt = dt;
      S.settings.method = $('#setMethod').value;
      S.circ.sim.dcStart = $('#setDc').checked;
      S.settings.showValues = $('#setValues').checked;
      S.settings.showDots = $('#setDots').checked;
      S.settings.ansi = $('#setAnsi').checked;
      S.settings.theme = $('#setTheme').value;
      S.settings.flow = $('#setFlow').value;
      S.settings.arrowsAll = $('#setArrows').checked;
      syncFlowBtn();
      saveSettings(); saveLocal(); applyTheme();
      rebuild();
      dlgS.close();
    };
    $('#setCancel').onclick = (e) => { e.preventDefault(); dlgS.close(); };
    const dlgH = $('#dlgHelp');
    $('#btnHelp').onclick = () => dlgH.showModal();
    $('#helpClose').onclick = () => dlgH.close();
    $('#btnTheme').onclick = () => {
      const cur = S.settings.theme === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : S.settings.theme;
      S.settings.theme = cur === 'dark' ? 'light' : 'dark';
      saveSettings(); applyTheme();
    };
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); drawPaletteIcons(); });

    new ResizeObserver(resize).observe(cv.parentElement);
    window.addEventListener('hashchange', loadFromHash);
  }

  function loadFromHash() {
    const m = location.hash.match(/^#c=(.+)$/);
    if (!m) return false;
    try {
      loadCirc(JSON.parse(b64dec(m[1])));
      history.replaceState(null, '', location.pathname + location.search);
      toast('Đã mở mạch từ liên kết chia sẻ');
      return true;
    } catch (e) { toast('Liên kết mạch không hợp lệ', 'error'); return false; }
  }

  function init() {
    try { Object.assign(S.settings, JSON.parse(localStorage.getItem(LS_SET) || '{}')); } catch (e) { /* */ }
    applyTheme();
    readColors();
    buildPalette();
    buildExamplesMenu();
    wireUI();
    resize();
    setTool('select');
    S.circ = { comps: [], wires: [], sim: {}, scope: {} };
    normalize(S.circ);
    if (!loadFromHash()) {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(LS_CIRC) || 'null'); } catch (e) { /* */ }
      if (saved && saved.comps && saved.comps.length) loadCirc(saved, { noHist: true });
      else loadCirc(MS.buildExample(MS.EXAMPLES.find((e) => e.id === 'bridge')), { noHist: true });
    }
    S.hist = []; updateUndo();
    requestAnimationFrame(tick);
  }

  init();
  window.MachSim = { state: S, scope, rebuild, loadCirc };
})();
