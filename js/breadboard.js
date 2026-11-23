/* MachSim – mô phỏng breadboard (bo cắm thử) */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  const DEFS = MS.DEFS;
  const fmt = MS.formatSI;
  const X = (x, u) => (u >= 0 ? x[u] : 0);

  /* ===================== Mô hình IC cho breadboard ===================== */
  // LM741 (DIP-8): 2 = IN−, 3 = IN+, 4 = V−, 6 = OUT, 7 = V+ ; mức bão hòa lấy theo nguồn nuôi thật
  function opampSupplied(el, v) {
    const vpos = v(el.u[6]), vneg = v(el.u[3]);
    const P = Object.assign({}, el.P);
    if (vpos - vneg < 3) { const m = (vpos + vneg) / 2; P.vp = m + 0.05; P.vn = m - 0.05; P.unpowered = true; }
    else { P.vp = vpos - 1.5; P.vn = vneg + 1.5; }
    return P;
  }
  function opSub(el) { return el._sub || (el._sub = { u: [el.u[1], el.u[2], el.u[5]], br: el.br, s: el.s, P: el.P }); }
  DEFS.BB741 = {
    type: 'BB741', name: 'LM741', terms: new Array(8).fill([0, 0]), params: DEFS.OPAMP.params.filter((q) => q.k !== 'vp' && q.k !== 'vn'),
    presets: DEFS.OPAMP.presets, nonlinear: true, branches: 1,
    compile: (p) => DEFS.OPAMP.compile(Object.assign({}, p, { vp: '13.5', vn: '-13.5' })),
    init(el) { el.s.u = 0; },
    stamp(el, c) { const s = opSub(el); s.u = [el.u[1], el.u[2], el.u[5]]; s.br = el.br; s.s = el.s; s.P = opampSupplied(el, (k) => c.v(k)); DEFS.OPAMP.stamp(s, c); },
    accept(el, c) { const s = opSub(el); s.P = opampSupplied(el, (k) => c.v(k)); DEFS.OPAMP.accept(s, c); },
    fromDC(el, x) { const s = opSub(el); s.P = opampSupplied(el, (k) => X(x, k)); DEFS.OPAMP.fromDC(s, x); },
    currents(el, x) { const r = new Array(8).fill(0); r[5] = x[el.br[0]]; return r; },
    info(el, eng) {
      const v = (k) => eng.nodeV(el.n[k]);
      const P = opampSupplied(el, (k) => X(eng.x, k));
      const vo = v(5);
      const st = P.unpowered ? '⚠ Chưa cấp nguồn (chân 7 = V+, chân 4 = V−)' : vo > P.vp - 0.05 ? 'Bão hòa dương' : vo < P.vn + 0.05 ? 'Bão hòa âm' : 'Tuyến tính (V+ ≈ V−)';
      return [['Chân 7 (V+)', fmt(v(6), 'V')], ['Chân 4 (V−)', fmt(v(3), 'V')], ['Chân 3 (IN+)', fmt(v(2), 'V')], ['Chân 2 (IN−)', fmt(v(1), 'V')], ['Chân 6 (OUT)', fmt(vo, 'V')], ['Trạng thái', st]];
    }
  };

  // 74xx (DIP-14): chân 14 = VCC, chân 7 = GND. Mỗi cổng: [vào…, ra] (đánh số chân từ 1)
  const CHIPS = {
    '7400': { g: 'NAND', name: '74HC00 – 4 cổng NAND', gates: [[1, 2, 3], [4, 5, 6], [9, 10, 8], [12, 13, 11]] },
    '7402': { g: 'NOR', name: '74HC02 – 4 cổng NOR', gates: [[2, 3, 1], [5, 6, 4], [8, 9, 10], [11, 12, 13]] },
    '7404': { g: 'NOT', name: '74HC04 – 6 cổng NOT', gates: [[1, 2], [3, 4], [5, 6], [9, 8], [11, 10], [13, 12]] },
    '7408': { g: 'AND', name: '74HC08 – 4 cổng AND', gates: [[1, 2, 3], [4, 5, 6], [9, 10, 8], [12, 13, 11]] },
    '7432': { g: 'OR', name: '74HC32 – 4 cổng OR', gates: [[1, 2, 3], [4, 5, 6], [9, 10, 8], [12, 13, 11]] },
    '7486': { g: 'XOR', name: '74HC86 – 4 cổng XOR', gates: [[1, 2, 3], [4, 5, 6], [9, 10, 8], [12, 13, 11]] }
  };
  function chipSubs(el) {
    if (el._subs) return el._subs;
    const ch = CHIPS[el.p.chip] || CHIPS['7400'];
    el._subs = ch.gates.map((pins) => ({ g: ch.g, u: pins.map((k) => el.u[k - 1]), P: null, out: pins[pins.length - 1] - 1 }));
    return el._subs;
  }
  const chipVH = (el, v) => Math.max(v(el.u[13]) - v(el.u[6]), 0);
  DEFS.BB74 = {
    type: 'BB74', name: '74HCxx', terms: new Array(14).fill([0, 0]), nonlinear: true,
    params: [{ k: 'chip', label: 'Loại IC', type: 'sel', opts: Object.keys(CHIPS).map((k) => [k, CHIPS[k].name]), def: '7400' }],
    compile: () => ({}),
    caps(el) { return chipSubs(el).map((s) => [s.u[s.u.length - 1], -1, 10e-12]); },
    stamp(el, c) {
      const VH = chipVH(el, (k) => c.v(k));
      for (const s of chipSubs(el)) {
        if (VH < 2) { c.G(s.u[s.u.length - 1], -1, 1e-6); continue; }
        s.P = { VH, w: VH / 60, R: 50 };
        DEFS[s.g].stamp(s, c);
      }
    },
    currents(el, x) {
      const r = new Array(14).fill(0);
      const VH = chipVH(el, (k) => X(x, k));
      if (VH < 2) return r;
      for (const s of chipSubs(el)) { s.P = { VH, w: VH / 60, R: 50 }; const ic = DEFS[s.g].currents(s, x); r[s.out] = ic[ic.length - 1]; }
      return r;
    },
    info(el, eng) {
      const v = (k) => eng.nodeV(el.n[k]);
      const VH = v(13) - v(6);
      const rows = [['VCC (chân 14 − chân 7)', fmt(VH, 'V')]];
      if (VH < 2) { rows.push(['Trạng thái', '⚠ Chưa cấp nguồn (chân 14 = VCC, chân 7 = GND)']); return rows; }
      const ch = CHIPS[el.p.chip] || CHIPS['7400'];
      const lv = (k) => (v(k - 1) > VH / 2 ? '1' : '0');
      ch.gates.forEach((pins, i) => {
        const ins = pins.slice(0, -1), o = pins[pins.length - 1];
        rows.push([`Cổng ${i + 1} (${ch.g})`, `${ins.map((k) => `chân ${k}=${lv(k)}`).join(', ')} → chân ${o}=${lv(o)}`]);
      });
      return rows;
    }
  };

  /* ===================== Hình học bo cắm ===================== */
  const COLS = 63;
  const RAILS = { 0: 'CH1', 1: 'GND_T', 16: 'GND_B', 17: 'CH2' };
  const ROW_L = { 3: 'a', 4: 'b', 5: 'c', 6: 'd', 7: 'e', 10: 'f', 11: 'g', 12: 'h', 13: 'i', 14: 'j' };
  const isRail = (y) => y in RAILS;
  const isTerm = (y) => (y >= 3 && y <= 7) || (y >= 10 && y <= 14);
  function isHole(c, y) {
    if (isRail(y)) return c >= 2 && c <= 62 && (c - 1) % 6 !== 0;
    return isTerm(y) && c >= 1 && c <= COLS;
  }
  function groupOf(c, y) {
    if (isRail(y)) return RAILS[y];
    return (y <= 7 ? 'T' : 'B') + c;
  }
  function holeName(c, y) {
    if (isRail(y)) return { CH1: 'ray CH1 (trên)', GND_T: 'ray GND (trên)', GND_B: 'ray GND (dưới)', CH2: 'ray CH2 (dưới)' }[RAILS[y]];
    return ROW_L[y] + c;
  }
  const ALL_HOLES = [];
  for (const y of [0, 1, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 16, 17]) for (let c = 1; c <= COLS; c++) if (isHole(c, y)) ALL_HOLES.push([c, y]);

  /* ===================== Loại linh kiện trên breadboard ===================== */
  const WIRE_COLORS = [['red', 'Đỏ', '#e0352b'], ['black', 'Đen', '#222'], ['blue', 'Xanh dương', '#2a6fd6'], ['green', 'Xanh lá', '#2e9e48'], ['yellow', 'Vàng', '#e8c21a'], ['orange', 'Cam', '#f07d1a'], ['white', 'Trắng', '#f4f4f4'], ['purple', 'Tím', '#8a4fd0']];
  const wireColor = (k) => (WIRE_COLORS.find((w) => w[0] === k) || WIRE_COLORS[2])[2];
  const PT = {
    wire: { name: 'Dây nối', place: 'two', params: [{ k: 'color', label: 'Màu dây', type: 'sel', opts: WIRE_COLORS.map((w) => [w[0], w[1]]), def: 'blue' }] },
    R: { name: 'Điện trở', place: 'two', sim: 'R' },
    LED: { name: 'LED', place: 'two', sim: 'LED', legs: ['Anode (+, chân dài)', 'Cathode (−)'] },
    D: { name: 'Diode', place: 'two', sim: 'D', legs: ['Anode', 'Cathode (vạch)'] },
    DZ: { name: 'Diode Zener', place: 'two', sim: 'DZ', legs: ['Anode', 'Cathode (vạch)'] },
    C: { name: 'Tụ điện', place: 'two', sim: 'C', legs: ['Chân +', 'Chân − (vạch)'] },
    L: { name: 'Cuộn cảm', place: 'two', sim: 'L' },
    BTN: { name: 'Nút nhấn', place: 'two', sim: 'SW', momentary: true, params: [] },
    SW: { name: 'Công tắc gạt', place: 'two', sim: 'SW' },
    NPN: { name: 'Transistor NPN', place: 'three', sim: 'NPN', pins: ['E', 'B', 'C'], map: [1, 2, 0] },
    PNP: { name: 'Transistor PNP', place: 'three', sim: 'PNP', pins: ['E', 'B', 'C'], map: [1, 2, 0] },
    NMOS: { name: 'MOSFET kênh N', place: 'three', sim: 'NMOS', pins: ['S', 'G', 'D'], map: [1, 2, 0] },
    PMOS: { name: 'MOSFET kênh P', place: 'three', sim: 'PMOS', pins: ['S', 'G', 'D'], map: [1, 2, 0] },
    NJF: { name: 'JFET kênh N', place: 'three', sim: 'NJF', pins: ['D', 'S', 'G'], map: [2, 0, 1] },
    SCR: { name: 'Thyristor SCR', place: 'three', sim: 'SCR', pins: ['K', 'G', 'A'], map: [2, 0, 1] },
    POT: { name: 'Biến trở tinh chỉnh', place: 'three', sim: 'POT', pins: ['1', 'W', '3'], map: [0, 2, 1] },
    IC741: { name: 'IC op-amp LM741', place: 'dip', n: 8, sim: 'BB741' },
    IC74: { name: 'IC logic 74HCxx', place: 'dip', n: 14, sim: 'BB74' },
    BAT: { name: 'Pin (kẹp + / −)', place: 'two', sim: 'V', defaults: { V: '9' }, legs: ['Kẹp đỏ (+)', 'Kẹp đen (−)'] },
    GEN: { name: 'Máy phát sóng', place: 'two', sim: 'AC', defaults: { amp: '1', freq: '1k' }, legs: ['Kẹp tín hiệu (đỏ)', 'Kẹp mass (đen)'] },
    DMM: { name: 'Đồng hồ vạn năng', place: 'two', params: [{ k: 'mode', label: 'Chế độ đo', type: 'sel', opts: [['V', 'Vôn (V) – đặt song song'], ['A', 'Ampe (A) – mắc nối tiếp']], def: 'V' }], legs: ['Que đỏ (+)', 'Que đen (COM)'] },
    PROBE: { name: 'Que dao động ký', place: 'one', sim: 'PROBE' }
  };
  const PALETTE = [
    ['Nối & nguồn', ['wire', 'BAT', 'GEN']],
    ['Thụ động', ['R', 'C', 'L', 'POT', 'BTN', 'SW']],
    ['Bán dẫn', ['LED', 'D', 'DZ', 'NPN', 'PNP', 'NMOS', 'PMOS', 'NJF', 'SCR']],
    ['IC', ['IC741', 'IC74']],
    ['Đo', ['DMM', 'PROBE']]
  ];
  const simType = (part) => (part.type === 'DMM' ? (part.p.mode === 'A' ? 'AM' : 'VM') : PT[part.type].sim);
  const defOf = (part) => {
    const t = PT[part.type];
    if (t.params) return { params: t.params };
    return DEFS[t.sim];
  };
  function newParams(type) {
    const t = PT[type];
    const p = {};
    if (t.params) for (const q of t.params) p[q.k] = q.def;
    else Object.assign(p, MS.defaultParams(t.sim));
    if (t.defaults) Object.assign(p, t.defaults);
    if (type === 'BTN') p.closed = false;
    if (type === 'SW') p.closed = false;
    return p;
  }

  /* ===================== Màu vạch điện trở ===================== */
  const BAND = ['#111', '#7a4a1e', '#d82020', '#f07d1a', '#f2d000', '#22a030', '#2050d8', '#8a3fd0', '#888', '#f4f4f4'];
  function resistorBands(R) {
    if (!(R > 0)) return [BAND[0], BAND[0], BAND[0]];
    let e = Math.floor(Math.log10(R)) - 1;
    let d = Math.round(R / Math.pow(10, e));
    if (d >= 100) { d = Math.round(d / 10); e++; }
    const mult = e < 0 ? (e === -1 ? '#d4af37' : '#c0c0c0') : BAND[Math.min(e, 9)];
    return [BAND[Math.floor(d / 10)], BAND[d % 10], mult];
  }

  /* ===================== Ví dụ ===================== */
  const EXAMPLES = [
    {
      id: 'bb-led', name: 'LED, điện trở và nút nhấn',
      desc: 'Nguồn 5 V nối vào ray đỏ CH1, ray xanh là GND. LED1 (đỏ) sáng khi <b>nhấn giữ</b> nút; LED2 (lục) luôn sáng. Rê chuột lên một lỗ để thấy các lỗ <b>được nối thông</b> với nó (sáng xanh) — mỗi cột 5 lỗ a–e (hoặc f–j) là một nút.',
      supply: { on: true, v1: '5', v2: '5' },
      parts: [
        ['BTN', 'S1', [[6, 0], [6, 4]]],
        ['R', 'R1', [[6, 6], [10, 6]], { R: '330' }],
        ['LED', 'LED1', [[10, 4], [11, 4]], { color: 'red' }],
        ['wire', 'W1', [[11, 3], [11, 1]], { color: 'black' }],
        ['R', 'R2', [[16, 0], [16, 4]], { R: '470' }],
        ['LED', 'LED2', [[16, 6], [17, 6]], { color: 'green' }],
        ['wire', 'W2', [[17, 3], [17, 1]], { color: 'black' }]
      ]
    },
    {
      id: 'bb-bjt', name: 'Transistor làm khóa',
      desc: 'Transistor NPN (chân E–B–C từ trái sang phải, mặt phẳng hướng về phía bạn). <b>Nhấn giữ nút</b>: có dòng vào cực B qua R<sub>B</sub> 10 kΩ ⇒ transistor bão hòa ⇒ LED ở cực C sáng. Chọn transistor để xem V<sub>BE</sub>, V<sub>CE</sub>, I<sub>C</sub> và vùng làm việc.',
      supply: { on: true, v1: '5', v2: '5' },
      parts: [
        ['NPN', 'Q1', [[20, 7], [21, 7], [22, 7]], { model: '2N2222' }],
        ['wire', 'W1', [[20, 5], [20, 1]], { color: 'black' }],
        ['R', 'RB', [[21, 3], [26, 3]], { R: '10k' }],
        ['BTN', 'S1', [[26, 0], [26, 5]]],
        ['LED', 'LED1', [[23, 5], [22, 5]], { color: 'yellow' }],
        ['R', 'RC', [[23, 0], [23, 3]], { R: '220' }]
      ]
    },
    {
      id: 'bb-opamp', name: 'Op-amp LM741 khuếch đại đảo',
      desc: 'Nguồn đối xứng: CH1 = +12 V (ray đỏ trên) nối chân 7, CH2 = −12 V (ray đỏ dưới) nối chân 4. Máy phát sóng 1 V/1 kHz qua R1 = 1 kΩ vào chân 2 (IN−), R<sub>f</sub> = 10 kΩ hồi tiếp từ chân 6 (OUT), chân 3 nối GND ⇒ A<sub>v</sub> = −10. Hai que dao động ký đo tín hiệu vào và ra. Thử rút dây nguồn chân 7 để thấy IC ngừng hoạt động.',
      supply: { on: true, v1: '12', v2: '-12' },
      parts: [
        ['IC741', 'U1', 'dip', 30, { model: 'LM741' }],
        ['wire', 'W1', [[31, 5], [32, 0]], { color: 'red' }],
        ['wire', 'W2', [[33, 12], [33, 17]], { color: 'purple' }],
        ['wire', 'W3', [[32, 13], [32, 16]], { color: 'black' }],
        ['GEN', 'GEN1', [[24, 14], [24, 16]], { amp: '1', freq: '1k' }],
        ['R', 'R1', [[24, 11], [31, 11]], { R: '1k' }],
        ['R', 'Rf', [[31, 13], [36, 13]], { R: '10k' }],
        ['wire', 'W4', [[36, 10], [36, 7]], { color: 'green' }],
        ['wire', 'W5', [[32, 3], [36, 3]], { color: 'yellow' }],
        ['R', 'RL', [[36, 6], [38, 1]], { R: '10k' }],
        ['PROBE', 'CH1', [[24, 12]]],
        ['PROBE', 'CH2', [[36, 5]]]
      ]
    },
    {
      id: 'bb-logic', name: 'IC 74HC08 – cổng AND',
      desc: 'IC 74HC08 cắm vắt qua rãnh giữa: chân 14 (góc trên trái) nối +5 V, chân 7 (góc dưới phải) nối GND. Hai công tắc gạt đưa mức 1 vào chân 1 và 2 (có điện trở kéo xuống 10 kΩ để mức 0 xác định khi công tắc mở). Chân 3 là đầu ra cổng AND, điều khiển LED. <b>Nhấp vào công tắc</b> để đổi trạng thái; chọn IC để xem mức logic từng chân.',
      supply: { on: true, v1: '5', v2: '5' },
      parts: [
        ['IC74', 'U1', 'dip', 40, { chip: '7408' }],
        ['wire', 'W1', [[40, 5], [40, 0]], { color: 'red' }],
        ['wire', 'W2', [[46, 13], [46, 16]], { color: 'black' }],
        ['SW', 'SA', [[32, 17], [32, 12]], { closed: true }],
        ['wire', 'W3', [[32, 11], [40, 11]], { color: 'yellow' }],
        ['R', 'RA', [[32, 14], [33, 16]], { R: '10k' }],
        ['SW', 'SB', [[35, 17], [35, 12]], { closed: false }],
        ['wire', 'W4', [[35, 13], [41, 13]], { color: 'orange' }],
        ['R', 'RB', [[35, 14], [36, 16]], { R: '10k' }],
        ['R', 'RL', [[42, 12], [50, 12]], { R: '330' }],
        ['LED', 'LED1', [[50, 13], [51, 13]], { color: 'red' }],
        ['wire', 'W5', [[51, 14], [51, 16]], { color: 'black' }]
      ]
    }
  ];
  function dipLegs(n, c) {
    const h = n / 2, legs = [];
    for (let k = 1; k <= h; k++) legs.push([c + k - 1, 10]);
    for (let k = 1; k <= h; k++) legs.push([c + h - k, 7]);
    return legs;
  }
  function buildExample(ex) {
    return {
      supply: Object.assign({ on: true, v1: '5', v2: '5' }, ex.supply),
      parts: ex.parts.map(([type, name, legs, a, b]) => {
        const p = newParams(type);
        let L = legs, extra = a;
        if (legs === 'dip') { L = dipLegs(PT[type].n, a); extra = b; }
        if (extra) {
          const d = defOf({ type, p });
          if (d && d.params) for (const q of d.params) if (q.preset && extra[q.k] && d.presets && d.presets[extra[q.k]]) Object.assign(p, d.presets[extra[q.k]]);
          Object.assign(p, extra);
        }
        return { id: MS.uid(), type, name, legs: L.map((h) => h.slice()), p };
      }),
      example: ex.id
    };
  }
  MS.BB_EXAMPLES = EXAMPLES;

  /* ===================== Giao diện breadboard ===================== */
  MS.initBreadboard = function (el) {
    const cv = el.canvas;
    let g = cv.getContext('2d');
    const scope = new MS.Scope(el.scopeCanvas);
    scope.emptyText = 'Chưa có kênh nào. Cắm “Que dao động ký” (nhóm Đo) vào một lỗ để xem dạng sóng.';
    const LS = 'machsim.bb.v1';
    const S = {
      circ: null, eng: null, net: null, running: true, error: null,
      view: { x: 0, y: 0, z: 1 }, tool: 'select', placeType: null, placeRev: false, pend: null,
      sel: null, hoverHole: null, mouse: { wx: 0, wy: 0, sx: 0, sy: 0, in: false }, drag: null,
      hist: [], speed: 1e-3, dt: 1e-5, debt: 0, lastTs: 0, lastUi: 0, active: false, pressed: null, vmax: 1
    };
    const PX = 18;

    const occupied = () => {
      const m = new Map();
      for (const p of S.circ.parts) for (const [c, y] of p.legs) m.set(c + ',' + y, p);
      return m;
    };

    /* ---------- Netlist ---------- */
    function rebuild() {
      const parent = new Map();
      const find = (k) => { while (parent.has(k) && parent.get(k) !== k) k = parent.get(k); return k; };
      const add = (k) => { if (!parent.has(k)) parent.set(k, k); };
      const union = (a, b) => { add(a); add(b); a = find(a); b = find(b); if (a !== b) parent.set(a, b); };
      ['CH1', 'CH2', 'GND_T', 'GND_B'].forEach(add);
      union('GND_T', 'GND_B');
      for (const p of S.circ.parts) {
        for (const [c, y] of p.legs) add(groupOf(c, y));
        if (p.type === 'wire') union(groupOf(...p.legs[0]), groupOf(...p.legs[1]));
      }
      const nodeOf = new Map();
      nodeOf.set(find('GND_T'), 0);
      let n = 1;
      const node = (gk) => { const r = find(gk); if (!nodeOf.has(r)) nodeOf.set(r, n++); return nodeOf.get(r); };
      node('CH1'); node('CH2');
      const elements = [];
      const sup = S.circ.supply;
      if (sup.on) {
        elements.push(MS.makeElement('V', [node('CH1'), 0], { V: sup.v1 }));
        if (node('CH2') !== node('CH1')) elements.push(MS.makeElement('V', [node('CH2'), 0], { V: sup.v2 }));
      }
      // số chân/đầu dây cắm vào mỗi nút (để phát hiện chân treo)
      const cnt = new Map();
      for (const p of S.circ.parts) {
        p._el = null;
        const st = simType(p);
        const nodes = p.legs.map(([c, y]) => node(groupOf(c, y)));
        p._nodes = nodes;
        for (const k of nodes) cnt.set(k, (cnt.get(k) || 0) + 1);
        if (!st) continue;
        const map = PT[p.type].map;
        const simNodes = map ? map.map((li) => nodes[li]) : nodes;
        const e = MS.makeElement(st, simNodes, {});
        e.p = p.p;
        e.P = e.def.compile ? e.def.compile(p.p) : {};
        e.part = p;
        p._el = e;
        elements.push(e);
      }
      S.dangling = new Set();
      for (const p of S.circ.parts) p.legs.forEach(([c, y], i) => {
        const k = p._nodes[i];
        if (k > 0 && !isRail(y) && (cnt.get(k) || 0) < 2 && p.type !== 'PROBE' && PT[p.type].place !== 'dip') S.dangling.add(c + ',' + y);
      });
      S.holeNode = (c, y) => node(groupOf(c, y));
      S.nodeCount = n;
      S.eng = MS.assemble(elements, n);
      S.eng.method = 'be';
      S.error = null;
      // bước thời gian & tốc độ theo máy phát sóng
      const gens = S.circ.parts.filter((p) => p.type === 'GEN').map((p) => MS.parseSI(p.p.freq) || 1e3);
      if (gens.length) { const f = Math.max(...gens); S.dt = 1 / (f * 200); S.speedAuto = 3 / f; scope.window = 3 / Math.min(...gens); }
      else { S.dt = 1e-4; S.speedAuto = 0.2; scope.window = 0.2; }
      if (!S.speedUser) S.speed = S.speedAuto;
      if (!S.eng.initFromDC()) S.eng.reset();
      computeDisplay();
      const probes = S.circ.parts.filter((p) => p.type === 'PROBE');
      scope.setSignals(probes.map((p) => ({ id: p.id, kind: 'v', label: `${p.name} (${holeName(...p.legs[0])})` })));
      renderChips();
      syncTools();
    }
    function computeDisplay() {
      let vm = 1;
      for (const p of S.circ.parts) if (p._el) p._el.ic = p._el.def.currents(p._el, S.eng.x);
      for (let k = 1; k < S.nodeCount; k++) vm = Math.max(vm, Math.abs(S.eng.nodeV(k)));
      S.vmax = vm;
    }
    function recompile(p) { if (p._el && p._el.def.compile) p._el.P = p._el.def.compile(p.p); }
    function sigValue(s) { const p = S.circ.parts.find((q) => q.id === s.id); return p ? S.eng.nodeV(p._nodes[0]) : 0; }

    /* ---------- Lưu / hoàn tác ---------- */
    const strip = (k, v) => (k[0] === '_' ? undefined : v);
    const snap = () => JSON.stringify(S.circ, strip);
    function pushHist() { S.hist.push(snap()); if (S.hist.length > 100) S.hist.shift(); }
    function save() { try { localStorage.setItem(LS, snap()); } catch (e) { /* */ } }
    function commit() { save(); rebuild(); renderProps(); }
    function undo() { if (!S.hist.length) return; S.circ = JSON.parse(S.hist.pop()); S.sel = null; commit(); }
    function load(c, keepHist) {
      if (!keepHist && S.circ) pushHist();
      S.circ = c; S.sel = null; S.speedUser = false; S.running = true;
      commit(); fit();
    }

    /* ---------- Toạ độ ---------- */
    const toWorld = (sx, sy) => [(sx - S.view.x) / (PX * S.view.z), (sy - S.view.y) / (PX * S.view.z)];
    function holeAt(wx, wy) {
      const c = Math.round(wx), y = Math.round(wy);
      if (!isHole(c, y) || Math.hypot(wx - c, wy - y) > 0.48) return null;
      return [c, y];
    }
    function fit() {
      const r = cv.getBoundingClientRect();
      if (!r.width) return;
      const z = Math.min(r.width / (66 * PX), r.height / (23 * PX));
      S.view.z = MS.clamp(z, 0.3, 3);
      S.view.x = r.width / 2 - 32 * PX * S.view.z;
      S.view.y = r.height / 2 - 8.5 * PX * S.view.z;
    }
    function resize() {
      const r = cv.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
      cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
    }

    function partAt(wx, wy) {
      for (let i = S.circ.parts.length - 1; i >= 0; i--) {
        const p = S.circ.parts[i], t = PT[p.type];
        if (t.place === 'two') {
          const [a, b] = p.legs;
          if (p.type === 'DMM') { const m = dmmBox(p); if (wx >= m.x && wx <= m.x + m.w && wy >= m.y && wy <= m.y + m.h) return p; }
          const d = distSeg(wx, wy, a[0], a[1], b[0], b[1]);
          if (d < (p.type === 'wire' ? 0.3 : 0.6)) return p;
        } else if (t.place === 'three') {
          const xs = p.legs.map((l) => l[0]), y = p.legs[0][1];
          if (wx >= Math.min(...xs) - 0.6 && wx <= Math.max(...xs) + 0.6 && wy >= y - 1.3 && wy <= y + 0.3) return p;
        } else if (t.place === 'dip') {
          const xs = p.legs.map((l) => l[0]);
          if (wx >= Math.min(...xs) - 0.5 && wx <= Math.max(...xs) + 0.5 && wy >= 7.3 && wy <= 9.7) return p;
        } else if (t.place === 'one') {
          const [c, y] = p.legs[0];
          if (Math.hypot(wx - c - 0.9, wy - y + 0.9) < 0.7 || Math.hypot(wx - c, wy - y) < 0.4) return p;
        }
      }
      return null;
    }
    function distSeg(px, py, x1, y1, x2, y2) {
      const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
      const t = L ? MS.clamp(((px - x1) * dx + (py - y1) * dy) / L, 0, 1) : 0;
      return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
    }
    function dmmBox(p) {
      const [a, b] = p.legs;
      const mx = (a[0] + b[0]) / 2, my = Math.min(a[1], b[1]);
      return { x: mx - 2.6, y: my - 4.6, w: 5.2, h: 3.2 };
    }

    // Chân dự kiến khi đặt linh kiện tại lỗ h
    function legsFor(type, h) {
      const t = PT[type];
      if (!h) return null;
      const [c, y] = h;
      if (t.place === 'one') return [[c, y]];
      if (t.place === 'three') {
        if (!isTerm(y)) return null;
        const L = [[c, y], [c + 1, y], [c + 2, y]];
        return S.placeRev ? L.reverse() : L;
      }
      if (t.place === 'dip') return dipLegs(t.n, c);
      return null;
    }
    function legsValid(legs, ignore) {
      if (!legs) return false;
      const occ = occupied();
      const seen = new Set();
      for (const [c, y] of legs) {
        const k = c + ',' + y;
        if (!isHole(c, y) || seen.has(k)) return false;
        seen.add(k);
        const o = occ.get(k);
        if (o && o !== ignore) return false;
      }
      return true;
    }
    function autoName(type) {
      const pre = { wire: 'W', R: 'R', LED: 'LED', D: 'D', DZ: 'DZ', C: 'C', L: 'L', BTN: 'S', SW: 'SW', NPN: 'Q', PNP: 'Q', NMOS: 'M', PMOS: 'M', NJF: 'J', SCR: 'SCR', POT: 'VR', IC741: 'U', IC74: 'U', BAT: 'BAT', GEN: 'GEN', DMM: 'DMM', PROBE: 'CH' }[type];
      let max = 0;
      for (const p of S.circ.parts) if (p.name.startsWith(pre)) { const n = parseInt(p.name.slice(pre.length), 10); if (n > max) max = n; }
      return pre + (max + 1);
    }
    function addPart(type, legs) {
      pushHist();
      const p = { id: MS.uid(), type, name: autoName(type), legs, p: newParams(type) };
      if (type === 'wire') {
        const gs = legs.map(([c, y]) => groupOf(c, y));
        p.p.color = gs.includes('CH1') || gs.includes('CH2') ? 'red' : gs.includes('GND_T') || gs.includes('GND_B') ? 'black' : ['blue', 'green', 'yellow', 'orange', 'purple'][S.circ.parts.filter((q) => q.type === 'wire').length % 5];
      }
      S.circ.parts.push(p);
      S.sel = type === 'wire' ? null : p;
      commit();
    }

    /* ---------- Vẽ ---------- */
    function leg(x1, y1, x2, y2) { g.strokeStyle = '#a9adb3'; g.lineWidth = 0.11; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
    function rr(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
    function txt(s, x, y, size, color, align, weight) {
      g.font = `${weight || 600} ${size}px system-ui, sans-serif`;
      g.fillStyle = color; g.textAlign = align || 'center'; g.textBaseline = 'middle';
      g.fillText(s, x, y);
    }

    function drawBoard() {
      g.fillStyle = '#ecebe4';
      rr(-0.6, -1.6, COLS + 1.6 + 0.6, 20.2, 0.6); g.fill();
      g.strokeStyle = '#cfcdc2'; g.lineWidth = 0.06; g.stroke();
      // rãnh giữa
      g.fillStyle = '#dcdad0'; g.fillRect(0.3, 8.1, COLS + 0.4, 0.8);
      // vạch ray
      const rail = (y, col) => { g.strokeStyle = col; g.lineWidth = 0.09; g.beginPath(); g.moveTo(1.4, y); g.lineTo(COLS - 0.4, y); g.stroke(); };
      rail(-0.6, '#e0352b'); rail(1.6, '#2a6fd6'); rail(15.4, '#2a6fd6'); rail(17.6, '#e0352b');
      // chữ hàng & số cột
      for (const y in ROW_L) { txt(ROW_L[y], -0.1, +y, 0.5, '#8e8b80'); txt(ROW_L[y], COLS + 0.6, +y, 0.5, '#8e8b80'); }
      for (let c = 1; c <= COLS; c += c === 1 ? 4 : 5) { txt(String(c), c, 2.2, 0.42, '#8e8b80'); txt(String(c), c, 14.8, 0.42, '#8e8b80'); }
      const sup = S.circ.supply;
      const lab = (y, s, col) => txt(s, 0.4, y, 0.55, col, 'right', 700);
      lab(0, sup.on ? fmt(MS.parseSI(sup.v1), 'V') : 'CH1', '#e0352b');
      lab(1, 'GND', '#2a6fd6');
      lab(16, 'GND', '#2a6fd6');
      lab(17, sup.on ? fmt(MS.parseSI(sup.v2), 'V') : 'CH2', '#e0352b');
      // lỗ
      const hl = S.hoverHole ? S.holeNode(...S.hoverHole) : null;
      for (const [c, y] of ALL_HOLES) {
        const on = hl !== null && S.holeNode(c, y) === hl;
        g.fillStyle = on ? '#2fbf6a' : '#3b3a36';
        const s = on ? 0.42 : 0.34;
        g.fillRect(c - s / 2, y - s / 2, s, s);
      }
    }

    function body(p, a, b, len) {
      // vị trí thân linh kiện dọc trục a→b
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L;
      const bl = Math.min(len, L * 0.75);
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      return { ux, uy, L, bl, mx, my, s1: [mx - (ux * bl) / 2, my - (uy * bl) / 2], s2: [mx + (ux * bl) / 2, my + (uy * bl) / 2], ang: Math.atan2(dy, dx) };
    }

    function drawPart(p, o) {
      o = o || {};
      const t = PT[p.type];
      const sel = o.sel;
      const el2 = p._el;
      if (t.place === 'two') {
        const [a, b] = p.legs;
        if (p.type === 'wire') {
          const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
          const bend = Math.min(0.25 * L, 1.6);
          const cx = (a[0] + b[0]) / 2 - (dy / (L || 1)) * bend * 0.35, cy = (a[1] + b[1]) / 2 + (dx / (L || 1)) * bend * 0.35 - bend * 0.25;
          g.lineCap = 'round';
          if (sel) { g.strokeStyle = 'rgba(79,195,247,0.6)'; g.lineWidth = 0.55; g.beginPath(); g.moveTo(a[0], a[1]); g.quadraticCurveTo(cx, cy, b[0], b[1]); g.stroke(); }
          g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 0.34; g.beginPath(); g.moveTo(a[0] + 0.05, a[1] + 0.08); g.quadraticCurveTo(cx + 0.05, cy + 0.12, b[0] + 0.05, b[1] + 0.08); g.stroke();
          g.strokeStyle = wireColor(p.p.color); g.lineWidth = 0.3; g.beginPath(); g.moveTo(a[0], a[1]); g.quadraticCurveTo(cx, cy, b[0], b[1]); g.stroke();
          g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 0.08; g.beginPath(); g.moveTo(a[0], a[1] - 0.06); g.quadraticCurveTo(cx, cy - 0.06, b[0], b[1] - 0.06); g.stroke();
          for (const q of [a, b]) { g.fillStyle = '#9da1a6'; g.beginPath(); g.arc(q[0], q[1], 0.13, 0, 7); g.fill(); }
          return;
        }
        if (p.type === 'BAT' || p.type === 'GEN' || p.type === 'DMM') {
          drawInstrument(p, a, b, sel);
          return;
        }
        const len = { R: 2.4, D: 2.2, DZ: 2.0, L: 2.4, C: 1.4, LED: 1.2, BTN: 1.6, SW: 2.0 }[p.type] || 2;
        const B = body(p, a, b, len);
        leg(a[0], a[1], B.s1[0], B.s1[1]);
        leg(B.s2[0], B.s2[1], b[0], b[1]);
        g.save();
        g.translate(B.mx, B.my);
        if (sel) { g.fillStyle = 'rgba(79,195,247,0.35)'; g.beginPath(); g.arc(0, 0, Math.max(B.bl, 1.2) * 0.7, 0, 7); g.fill(); }
        if (p.type === 'LED' || p.type === 'C' || p.type === 'BTN') {
          if (p.type === 'LED') drawLED(p, B, el2);
          else if (p.type === 'C') drawCap(p, B);
          else drawButton(p);
          g.restore();
          return;
        }
        g.rotate(B.ang);
        const bl = B.bl;
        if (p.type === 'R' || p.type === 'L') {
          g.fillStyle = p.type === 'R' ? '#d8c39a' : '#5f9d6b';
          rr(-bl / 2, -0.33, bl, 0.66, 0.3); g.fill();
          g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 0.04; g.stroke();
          if (p.type === 'R') {
            const bands = resistorBands(MS.parseSI(p.p.R)).concat(['#d4af37']);
            const xs = [-bl * 0.3, -bl * 0.15, 0, bl * 0.28];
            bands.forEach((col, i) => { g.fillStyle = col; g.fillRect(xs[i] - 0.07, -0.33, 0.14, 0.66); });
          }
        } else if (p.type === 'D' || p.type === 'DZ') {
          const glass = p.type === 'DZ' || p.p.model === '1N4148';
          g.fillStyle = glass ? '#e98a3a' : '#1d1d1d';
          rr(-bl / 2, -0.28, bl, 0.56, 0.22); g.fill();
          g.fillStyle = glass ? '#222' : '#c8c8c8';
          g.fillRect(bl / 2 - 0.42, -0.28, 0.16, 0.56);
        } else if (p.type === 'SW') {
          g.fillStyle = '#2c2c2c'; rr(-bl / 2, -0.45, bl, 0.9, 0.12); g.fill();
          g.fillStyle = '#e6e6e6'; const kx = p.p.closed ? bl / 2 - 0.65 : -bl / 2 + 0.15;
          rr(kx, -0.3, 0.5, 0.6, 0.08); g.fill();
        }
        g.restore();
        return;
      }
      if (t.place === 'three') {
        const xs = p.legs.map((l) => l[0]), y = p.legs[0][1];
        const x0 = Math.min(...xs), x1 = Math.max(...xs), cx = (x0 + x1) / 2;
        if (sel) { g.fillStyle = 'rgba(79,195,247,0.35)'; rr(x0 - 0.7, y - 1.5, x1 - x0 + 1.4, 1.9, 0.3); g.fill(); }
        if (p.type === 'POT') {
          g.fillStyle = '#2f62b8'; rr(cx - 1.4, y - 2.4, 2.8, 2.6, 0.2); g.fill();
          g.fillStyle = '#f2f2f2'; g.beginPath(); g.arc(cx, y - 1.1, 0.85, 0, 7); g.fill();
          const ang = Math.PI * (0.75 + 1.5 * (1 - (+p.p.pos || 0)));
          g.strokeStyle = '#333'; g.lineWidth = 0.14; g.beginPath(); g.moveTo(cx, y - 1.1); g.lineTo(cx + 0.7 * Math.cos(ang), y - 1.1 - 0.7 * Math.sin(ang)); g.stroke();
        } else {
          g.fillStyle = '#1b1b1b';
          g.beginPath(); g.moveTo(x0 - 0.45, y + 0.1); g.lineTo(x1 + 0.45, y + 0.1); g.lineTo(x1 + 0.45, y - 0.5);
          g.quadraticCurveTo(cx, y - 1.9, x0 - 0.45, y - 0.5); g.closePath(); g.fill();
          const lbl = (p.p.model && p.p.model !== 'custom' ? p.p.model.replace(/ \(.*\)/, '') : p.type).slice(0, 8);
          txt(lbl, cx, y - 0.55, 0.36, '#ddd');
        }
        p.legs.forEach(([c], i) => txt(t.pins[i], c, y + 0.55, 0.36, '#55524a', 'center', 700));
        return;
      }
      if (t.place === 'dip') {
        const xs = p.legs.map((l) => l[0]);
        const x0 = Math.min(...xs) - 0.45, x1 = Math.max(...xs) + 0.45;
        if (sel) { g.fillStyle = 'rgba(79,195,247,0.4)'; rr(x0 - 0.25, 6.6, x1 - x0 + 0.5, 3.8, 0.3); g.fill(); }
        for (const [c, y] of p.legs) { g.fillStyle = '#b9bcc0'; g.fillRect(c - 0.16, y === 7 ? 7 : 9.4, 0.32, 0.6); }
        g.fillStyle = '#232323'; rr(x0, 7.35, x1 - x0, 2.3, 0.15); g.fill();
        g.fillStyle = '#444'; g.beginPath(); g.arc(x0, 8.5, 0.35, -Math.PI / 2, Math.PI / 2); g.fill();
        g.fillStyle = '#555'; g.beginPath(); g.arc(x0 + 0.5, 9.25, 0.13, 0, 7); g.fill();
        const name = p.type === 'IC741' ? 'LM741' : (CHIPS[p.p.chip] || CHIPS['7400']).name.split(' ')[0];
        txt(name, (x0 + x1) / 2, 8.5, 0.6, '#e8e8e8', 'center', 700);
        if (o.pins) p.legs.forEach(([c, y], i) => txt(String(i + 1), c, y === 7 ? 6.45 : 10.55, 0.36, '#0a6fb3', 'center', 700));
        return;
      }
      if (t.place === 'one') {
        const [c, y] = p.legs[0];
        const sc = scope.signals.find((s) => s.id === p.id);
        const col = sc ? sc.color : '#999';
        g.strokeStyle = '#555'; g.lineWidth = 0.12; g.beginPath(); g.moveTo(c, y); g.lineTo(c + 0.9, y - 0.9); g.stroke();
        g.fillStyle = col; g.beginPath(); g.arc(c + 1.05, y - 1.05, 0.55, 0, 7); g.fill();
        if (sel) { g.strokeStyle = '#4fc3f7'; g.lineWidth = 0.12; g.stroke(); }
        txt(p.name, c + 1.05, y - 1.05, 0.38, '#111', 'center', 800);
        g.fillStyle = '#ddd'; g.beginPath(); g.arc(c, y, 0.16, 0, 7); g.fill();
      }
    }

    function drawLED(p, B, e) {
      const P = DEFS.LED.compile(p.p);
      const i = e && e.ic ? e.ic[0] : 0;
      const br = MS.clamp(Math.sqrt(Math.max(i, 0) / P.Imax), 0, 1);
      if (br > 0.02) {
        const gr = g.createRadialGradient(0, 0, 0.2, 0, 0, 2.6);
        gr.addColorStop(0, P.color); gr.addColorStop(1, P.color + '00');
        g.globalAlpha = br; g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 2.6, 0, 7); g.fill(); g.globalAlpha = 1;
      }
      g.fillStyle = P.color; g.globalAlpha = 0.35 + 0.65 * br;
      g.beginPath(); g.arc(0, 0, 0.72, 0, 7); g.fill(); g.globalAlpha = 1;
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.05; g.stroke();
      // mặt phẳng phía cathode
      g.save(); g.rotate(B.ang);
      g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 0.08; g.beginPath(); g.moveTo(0.55, -0.45); g.lineTo(0.55, 0.45); g.stroke();
      g.restore();
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.arc(-0.22, -0.22, 0.18, 0, 7); g.fill();
      if (i > 1.5 * P.Imax) txt('⚠', 0, -1.2, 0.8, '#ff9f0a');
    }
    function drawCap(p, B) {
      const C = MS.parseSI(p.p.C);
      if (C >= 1e-6) {
        g.fillStyle = '#1f3f8a'; g.beginPath(); g.arc(0, 0, 0.9, 0, 7); g.fill();
        g.save(); g.rotate(B.ang); g.fillStyle = '#c9d3ea'; g.beginPath(); g.arc(0, 0, 0.9, -0.5, 0.5); g.closePath(); g.fill(); g.restore();
        g.strokeStyle = '#9aa6c4'; g.lineWidth = 0.05; g.beginPath(); g.moveTo(-0.35, 0); g.lineTo(0.35, 0); g.moveTo(0, -0.35); g.lineTo(0, 0.35); g.stroke();
      } else {
        g.fillStyle = '#e2a12a'; g.beginPath(); g.ellipse(0, 0, 0.7, 0.55, B.ang, 0, 7); g.fill();
      }
      txt(fmt(C, 'F').replace(' ', ''), 0, -1.25, 0.42, '#55524a');
    }
    function drawButton(p) {
      g.fillStyle = '#2a2a2a'; rr(-0.75, -0.75, 1.5, 1.5, 0.12); g.fill();
      g.fillStyle = p.p.closed ? '#e0352b' : '#8b1a14'; g.beginPath(); g.arc(0, 0, p.p.closed ? 0.42 : 0.5, 0, 7); g.fill();
    }
    function drawInstrument(p, a, b, sel) {
      let bx, by, bw, bh;
      if (p.type === 'DMM') { const m = dmmBox(p); bx = m.x; by = m.y; bw = m.w; bh = m.h; }
      else {
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        const off = my > 8.5 ? 3.4 : -3.4;
        bw = 4.2; bh = 2.2; bx = mx - bw / 2 - 2.8; by = my + off - bh / 2;
        if (bx < 1) bx = mx + 1;
      }
      const cols = p.type === 'GEN' ? ['#e0352b', '#222'] : p.type === 'DMM' ? ['#e0352b', '#222'] : ['#e0352b', '#222'];
      [a, b].forEach((q, i) => {
        g.strokeStyle = cols[i]; g.lineWidth = 0.16; g.lineCap = 'round';
        g.beginPath(); g.moveTo(q[0], q[1]); g.quadraticCurveTo(q[0], by + bh + 0.8, bx + bw * (i ? 0.7 : 0.3), by + (by > q[1] ? 0 : bh)); g.stroke();
        g.fillStyle = cols[i]; g.beginPath(); g.arc(q[0], q[1], 0.2, 0, 7); g.fill();
      });
      if (sel) { g.fillStyle = 'rgba(79,195,247,0.4)'; rr(bx - 0.3, by - 0.3, bw + 0.6, bh + 0.6, 0.4); g.fill(); }
      if (p.type === 'DMM') {
        g.fillStyle = '#f0c419'; rr(bx, by, bw, bh, 0.35); g.fill();
        g.fillStyle = '#c7d9b5'; rr(bx + 0.3, by + 0.3, bw - 0.6, 1.6, 0.15); g.fill();
        let val = '—';
        if (p._el && S.eng) val = p.p.mode === 'A' ? fmt(S.eng.x[p._el.br[0]], 'A') : fmt(S.eng.nodeV(p._nodes[0]) - S.eng.nodeV(p._nodes[1]), 'V');
        txt(val, bx + bw / 2, by + 1.1, 0.75, '#1d2a17', 'center', 700);
        txt(p.p.mode === 'A' ? 'DC A' : 'DC V', bx + bw / 2, by + 2.5, 0.42, '#3b3112', 'center', 700);
      } else if (p.type === 'BAT') {
        g.fillStyle = '#2b2b2b'; rr(bx, by, bw, bh, 0.25); g.fill();
        g.fillStyle = '#d6a21a'; g.fillRect(bx + bw * 0.55, by, bw * 0.45, bh);
        txt(fmt(MS.parseSI(p.p.V), 'V'), bx + bw * 0.28, by + bh / 2, 0.7, '#fff', 'center', 800);
      } else {
        g.fillStyle = '#d9dde3'; rr(bx, by, bw, bh, 0.25); g.fill();
        g.fillStyle = '#16303f'; rr(bx + 0.2, by + 0.2, bw - 0.4, 1.1, 0.1); g.fill();
        const P = DEFS.AC.compile(p.p);
        txt(`${{ sin: '∿', square: '⊓', triangle: '⋀', saw: '⩘' }[P.wave] || ''} ${fmt(P.f, 'Hz')}`, bx + bw / 2, by + 0.75, 0.48, '#7fe0ff', 'center', 700);
        txt(`${fmt(P.amp, 'V')} đỉnh`, bx + bw / 2, by + 1.7, 0.42, '#334', 'center', 700);
      }
    }

    function render() {
      const dpr = window.devicePixelRatio || 1;
      const W = cv.width / dpr, H = cv.height / dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = MS.cssVar('--cv-bg', '#0d1117');
      g.fillRect(0, 0, W, H);
      const sc = PX * S.view.z;
      g.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * S.view.x, dpr * S.view.y);
      g.lineCap = 'round'; g.lineJoin = 'round';
      drawBoard();
      // linh kiện: thân trước, dây sau, dụng cụ đo trên cùng
      const order = (p) => (p.type === 'wire' ? 1 : ['DMM', 'BAT', 'GEN', 'PROBE'].includes(p.type) ? 2 : 0);
      const parts = S.circ.parts.slice().sort((a, b) => order(a) - order(b));
      for (const p of parts) drawPart(p, { sel: S.sel === p, pins: S.sel === p || S.hoverPart === p });
      // chân treo
      g.strokeStyle = '#ff3b30'; g.lineWidth = 0.08;
      for (const k of S.dangling) { const [c, y] = k.split(',').map(Number); g.beginPath(); g.arc(c, y, 0.32, 0, 7); g.stroke(); }
      // đặt linh kiện
      if (S.tool === 'place' && S.mouse.in) {
        const t = PT[S.placeType];
        const h = S.hoverHole;
        g.globalAlpha = 0.6;
        if (t.place === 'two') {
          if (S.pend) {
            const legs = [S.pend, h || [S.mouse.wx, S.mouse.wy]];
            const ok = h && legsValid(legs);
            drawPart({ type: S.placeType, legs, p: newParams(S.placeType), name: '' }, {});
            g.globalAlpha = 1;
            if (!ok && h) markBad(h);
          }
        } else {
          const legs = legsFor(S.placeType, h);
          if (legs) {
            drawPart({ type: S.placeType, legs, p: newParams(S.placeType), name: 'CH?' }, { pins: true });
            g.globalAlpha = 1;
            if (!legsValid(legs)) legs.forEach((l) => isHole(...l) || markBad(l));
            if (!legsValid(legs)) markBad(h);
          }
        }
        g.globalAlpha = 1;
      }
      // tay cầm đầu dây / chân của linh kiện đang chọn
      if (S.sel && (PT[S.sel.type].place === 'two' || PT[S.sel.type].place === 'one')) {
        for (const [c, y] of S.sel.legs) { g.strokeStyle = '#4fc3f7'; g.lineWidth = 0.1; g.beginPath(); g.arc(c, y, 0.36, 0, 7); g.stroke(); }
      }
      // chú thích lỗ đang trỏ
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (S.hoverHole && S.mouse.in) {
        const [c, y] = S.hoverHole;
        const k = S.holeNode(c, y);
        const t = `${holeName(c, y)} · ${k === 0 ? '0 V (GND)' : fmt(S.eng.nodeV(k), 'V')}`;
        g.font = '600 12px system-ui, sans-serif';
        const tw = g.measureText(t).width + 12;
        g.fillStyle = 'rgba(0,0,0,0.78)'; g.fillRect(S.mouse.sx + 14, S.mouse.sy - 28, tw, 20);
        g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(t, S.mouse.sx + 20, S.mouse.sy - 18);
      }
    }
    function markBad(h) {
      if (!h) return;
      g.strokeStyle = '#ff3b30'; g.lineWidth = 0.12;
      g.beginPath(); g.moveTo(h[0] - 0.35, h[1] - 0.35); g.lineTo(h[0] + 0.35, h[1] + 0.35); g.moveTo(h[0] + 0.35, h[1] - 0.35); g.lineTo(h[0] - 0.35, h[1] + 0.35); g.stroke();
    }

    /* ---------- Chuột ---------- */
    function evPos(e) {
      const r = cv.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const [wx, wy] = toWorld(sx, sy);
      Object.assign(S.mouse, { sx, sy, wx, wy });
      S.hoverHole = holeAt(wx, wy);
      return { sx, sy, wx, wy };
    }
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      const p = evPos(e);
      if (e.button === 1 || e.button === 2) {
        if (e.button === 2 && S.tool === 'place') { setTool('select'); return; }
        S.drag = { mode: 'pan', sx0: p.sx, sy0: p.sy, vx: S.view.x, vy: S.view.y };
        return;
      }
      const h = S.hoverHole;
      if (S.tool === 'place') {
        const t = PT[S.placeType];
        if (t.place === 'two') { if (!S.pend && h && legsValid([h])) S.pend = h; return; }
        const legs = legsFor(S.placeType, h);
        if (legs && legsValid(legs)) { addPart(S.placeType, legs); if (!e.shiftKey) setTool('select'); }
        return;
      }
      // kéo tay cầm chân
      if (S.sel && (PT[S.sel.type].place === 'two' || PT[S.sel.type].place === 'one')) {
        const i = S.sel.legs.findIndex(([c, y]) => Math.hypot(p.wx - c, p.wy - y) < 0.45);
        if (i >= 0) { S.drag = { mode: 'leg', part: S.sel, i, moved: false }; return; }
      }
      const part = partAt(p.wx, p.wy);
      if (part) {
        if (part.type === 'BTN') { part.p.closed = true; recompile(part); S.pressed = part; }
        S.sel = part;
        renderProps();
        S.drag = { mode: 'move', part, wx0: Math.round(p.wx), wy0: Math.round(p.wy), legs0: part.legs.map((l) => l.slice()), moved: false };
        return;
      }
      if (h) { setTool('place', 'wire'); S.pend = h; S.drag = null; return; }
      S.sel = null; renderProps();
      S.drag = { mode: 'pan', sx0: p.sx, sy0: p.sy, vx: S.view.x, vy: S.view.y };
    });
    cv.addEventListener('pointermove', (e) => {
      const p = evPos(e);
      S.mouse.in = true;
      S.hoverPart = partAt(p.wx, p.wy);
      const d = S.drag;
      if (!d) return;
      if (d.mode === 'pan') { S.view.x = d.vx + p.sx - d.sx0; S.view.y = d.vy + p.sy - d.sy0; }
      else if (d.mode === 'leg') {
        const h = S.hoverHole;
        if (h && (h[0] !== d.part.legs[d.i][0] || h[1] !== d.part.legs[d.i][1])) {
          const legs = d.part.legs.map((l) => l.slice()); legs[d.i] = h;
          if (legsValid(legs, d.part)) { if (!d.moved) { pushHist(); d.moved = true; } d.part.legs = legs; rebuild(); }
        }
      } else if (d.mode === 'move') {
        const dc = Math.round(p.wx) - d.wx0;
        let dy = Math.round(p.wy) - d.wy0;
        if (PT[d.part.type].place === 'dip') dy = 0;
        if (PT[d.part.type].place === 'three' && dy) { const ny = d.legs0[0][1] + dy; if (!isTerm(ny)) dy = 0; }
        const legs = d.legs0.map(([c, y]) => [c + dc, y + dy]);
        const same = legs.every((l, i) => l[0] === d.part.legs[i][0] && l[1] === d.part.legs[i][1]);
        if (!same && legsValid(legs, d.part)) {
          if (!d.moved) { pushHist(); d.moved = true; }
          d.part.legs = legs; rebuild();
          if (S.pressed) { S.pressed.p.closed = false; recompile(S.pressed); S.pressed = null; }
        }
      }
    });
    cv.addEventListener('pointerup', () => {
      const d = S.drag;
      S.drag = null;
      if (S.pressed) { S.pressed.p.closed = false; recompile(S.pressed); S.pressed = null; }
      if (S.tool === 'place' && S.pend && PT[S.placeType].place === 'two') {
        const h = S.hoverHole;
        if (h && (h[0] !== S.pend[0] || h[1] !== S.pend[1]) && legsValid([S.pend, h])) {
          const type = S.placeType;
          addPart(type, [S.pend, h]);
          S.pend = null;
          if (type !== 'wire') setTool('select');
        }
        return;
      }
      if (d && (d.mode === 'move' || d.mode === 'leg')) {
        if (d.moved) { save(); renderProps(); }
        else if (d.mode === 'move' && d.part.type === 'SW') { pushHist(); d.part.p.closed = !d.part.p.closed; recompile(d.part); save(); renderProps(); }
      }
    });
    cv.addEventListener('pointerleave', () => { S.mouse.in = false; S.hoverHole = null; });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = evPos(e);
      const z = MS.clamp(S.view.z * Math.exp(-e.deltaY * 0.0015), 0.3, 4);
      S.view.x = p.sx - p.wx * PX * z; S.view.y = p.sy - p.wy * PX * z; S.view.z = z;
    }, { passive: false });

    function setTool(t, type) {
      S.tool = t; S.placeType = type || null; S.pend = null; S.placeRev = false;
      el.palette.querySelectorAll('.pal-item').forEach((b) => b.classList.toggle('active', t === 'place' && b.dataset.type === type));
      cv.style.cursor = t === 'place' ? 'crosshair' : 'default';
      updateStatus();
    }
    function deleteSel() {
      if (!S.sel) return;
      pushHist();
      S.circ.parts = S.circ.parts.filter((p) => p !== S.sel);
      S.sel = null;
      commit();
    }
    function rotateSel() {
      if (S.tool === 'place') { S.placeRev = !S.placeRev; return; }
      const p = S.sel;
      if (!p) return;
      const t = PT[p.type];
      if (t.place === 'three' || t.place === 'two') {
        const legs = p.legs.slice().reverse();
        pushHist(); p.legs = legs; commit();
      }
    }
    document.addEventListener('keydown', (e) => {
      if (!S.active || e.target.closest('input, select, textarea, dialog')) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(); }
      else if (e.ctrlKey || e.metaKey) return;
      else if (k === 'delete' || k === 'backspace') { e.preventDefault(); deleteSel(); }
      else if (k === 'r') rotateSel();
      else if (k === 'escape') { setTool('select'); S.sel = null; renderProps(); }
      else if (k === 'w') setTool('place', 'wire');
      else if (k === ' ') { e.preventDefault(); S.running = !S.running; syncTools(); }
      else if (k === 'home' || k === '0') fit();
    });

    /* ---------- Bảng linh kiện ---------- */
    function buildPalette() {
      const pal = el.palette;
      pal.innerHTML = '';
      for (const [cat, items] of PALETTE) {
        const h = document.createElement('h3'); h.textContent = cat; pal.appendChild(h);
        const grid = document.createElement('div'); grid.className = 'pal-grid';
        for (const type of items) {
          const b = document.createElement('button');
          b.className = 'pal-item'; b.dataset.type = type; b.title = PT[type].name;
          const ic = document.createElement('canvas'); ic.width = 112; ic.height = 64;
          b.appendChild(ic);
          const s = document.createElement('span'); s.textContent = PT[type].name; b.appendChild(s);
          b.addEventListener('click', () => (S.tool === 'place' && S.placeType === type ? setTool('select') : setTool('place', type)));
          grid.appendChild(b);
          // biểu tượng
          const x = ic.getContext('2d');
          const t = PT[type];
          const demo = { type, name: type === 'PROBE' ? 'CH' : '', p: newParams(type), legs: t.place === 'two' ? [[0, 0], [4, 0]] : t.place === 'three' ? [[0, 0], [1, 0], [2, 0]] : t.place === 'dip' ? dipLegs(t.n, 0) : [[0, 0]] };
          if (type === 'LED') demo._el = { ic: [0.012] };
          const bb = t.place === 'two' ? [-0.5, -1.2, 4.5, 1.2] : t.place === 'three' ? [-0.8, -2.5, 2.8, 0.9] : t.place === 'dip' ? [-0.8, 6.6, t.n / 2 - 0.2, 10.5] : [-0.4, -1.8, 1.8, 0.4];
          let bx = bb, isInst = ['BAT', 'GEN', 'DMM'].includes(type);
          if (isInst) { demo.legs = type === 'DMM' ? [[0, 5], [4, 5]] : [[3, 0], [7, 0]]; bx = type === 'DMM' ? [-1, -0.6, 5, 5.6] : [-0.8, -4.8, 7.6, 0.6]; }
          const s2 = Math.min(104 / (bx[2] - bx[0]), 56 / (bx[3] - bx[1]));
          x.setTransform(s2, 0, 0, s2, 56 - ((bx[0] + bx[2]) / 2) * s2, 32 - ((bx[1] + bx[3]) / 2) * s2);
          const gg = g;
          // vẽ bằng hàm chung, tạm đổi ngữ cảnh
          drawWith(x, () => drawPart(demo, { pins: false }));
          void gg;
        }
        pal.appendChild(grid);
      }
    }
    function drawWith(ctx, fn) { const keep = g; g = ctx; g.lineCap = 'round'; g.lineJoin = 'round'; try { fn(); } finally { g = keep; } }

    /* ---------- Bảng thuộc tính ---------- */
    function renderProps() {
      const box = el.props;
      box.innerHTML = '';
      const p = S.sel;
      if (!p) {
        const ex = S.circ.example && EXAMPLES.find((e) => e.id === S.circ.example);
        const sup = S.circ.supply;
        const d = document.createElement('div');
        d.className = 'props-empty';
        d.innerHTML = (ex ? `<h2>${MS.escapeHTML(ex.name)}</h2><p class="ex-desc">${ex.desc}</p>` : '<h2>Breadboard</h2>') + '<h3 class="sec">Nguồn phòng thí nghiệm</h3>';
        box.appendChild(d);
        const sp = document.createElement('div');
        const sdef = { params: [
          { k: 'on', label: 'Bật nguồn', type: 'bool', def: true },
          { k: 'v1', label: 'CH1 – ray đỏ phía trên', unit: 'V', def: '5' },
          { k: 'v2', label: 'CH2 – ray đỏ phía dưới (có thể âm)', unit: 'V', def: '5' }
        ] };
        MS.paramForm(sp, sdef, sup, () => { pushHist(); commit(); });
        box.appendChild(sp);
        const tips = document.createElement('div');
        tips.className = 'tips';
        tips.innerHTML = `<h3>Cách dùng</h3><ul>
          <li><b>Lỗ thông nhau:</b> mỗi cột 5 lỗ a–e là một nút, f–j là một nút khác; mỗi ray chạy suốt chiều dài bo. Rê chuột lên lỗ để thấy các lỗ được nối (màu xanh).</li>
          <li><b>Cắm linh kiện 2 chân / dây:</b> chọn ở bảng trái, nhấp lỗ thứ nhất rồi lỗ thứ hai (hoặc kéo). Nhấp vào lỗ trống bất kỳ để kéo dây nhanh.</li>
          <li><b>Transistor, biến trở:</b> 3 chân liền nhau trên một hàng; <kbd>R</kbd> đảo chiều. <b>IC</b> cắm vắt qua rãnh giữa, chân 1 ở góc dưới trái.</li>
          <li><b>Nút nhấn:</b> nhấn giữ chuột. <b>Công tắc gạt:</b> nhấp để đổi.</li>
          <li>Vòng đỏ quanh chân = chân chưa nối với gì. Kéo tay cầm (vòng xanh) để dời chân dây/linh kiện đã chọn.</li>
        </ul>`;
        box.appendChild(tips);
        return;
      }
      const t = PT[p.type];
      const head = document.createElement('div');
      head.className = 'props-head';
      head.innerHTML = `<div class="props-type">${MS.escapeHTML(t.name)}</div>`;
      const nr = document.createElement('label'); nr.className = 'field';
      nr.innerHTML = '<span class="field-label">Tên</span>';
      const ni = document.createElement('input'); ni.type = 'text'; ni.value = p.name;
      ni.addEventListener('change', () => { pushHist(); p.name = ni.value.trim() || p.name; save(); rebuild(); });
      ni.addEventListener('keydown', (e) => e.stopPropagation());
      nr.appendChild(ni); head.appendChild(nr);
      box.appendChild(head);
      const d = defOf(p);
      if (d && d.params && d.params.length) {
        const pf = document.createElement('div');
        let pushed = false;
        MS.paramForm(pf, d, p.p, (k, live) => {
          if (!pushed) { pushHist(); pushed = true; }
          if (k === 'mode' || k === 'chip' || k === 'freq') { save(); rebuild(); renderProps(); return; }
          recompile(p);
          if (p._el) p._el._subs = null;
          if (!live) { save(); pushed = false; }
        });
        box.appendChild(pf);
      }
      const pinInfo = document.createElement('div');
      pinInfo.className = 'hint';
      const lg = t.pins ? t.pins.map((n, i) => `${n}: ${holeName(...p.legs[i])}`) : t.legs ? t.legs.map((n, i) => `${n}: ${holeName(...p.legs[i])}`) : p.legs.length <= 2 ? p.legs.map((l, i) => `Chân ${i + 1}: ${holeName(...l)}`) : [`Chân 1 tại ${holeName(...p.legs[0])}`];
      pinInfo.innerHTML = lg.join(' · ');
      box.appendChild(pinInfo);
      const acts = document.createElement('div'); acts.className = 'props-actions';
      const btn = (l, f, c) => { const b = document.createElement('button'); b.innerHTML = l; b.className = c || ''; b.onclick = f; acts.appendChild(b); };
      if (t.place === 'two' || t.place === 'three') btn('⇄ Đảo chiều (R)', rotateSel);
      btn('🗑 Xóa', deleteSel, 'danger');
      box.appendChild(acts);
      const live = document.createElement('div'); live.className = 'props-live'; live.id = 'bbLive';
      box.appendChild(live);
      const sim = simType(p);
      if (sim && DEFS[sim] && DEFS[sim].theory) {
        const th = document.createElement('div'); th.className = 'theory';
        th.innerHTML = '<h3>Lý thuyết</h3>' + DEFS[sim].theory;
        box.appendChild(th);
      }
      if (p.type === 'IC741' || p.type === 'IC74') {
        const th = document.createElement('div'); th.className = 'theory';
        th.innerHTML = p.type === 'IC741'
          ? '<h3>Sơ đồ chân LM741</h3>1: chỉnh offset · <b>2: IN−</b> · <b>3: IN+</b> · <b>4: V−</b> · 5: chỉnh offset · <b>6: OUT</b> · <b>7: V+</b> · 8: không dùng. Mức ra bão hòa ≈ nguồn nuôi − 1,5 V.'
          : `<h3>Sơ đồ chân ${(CHIPS[p.p.chip] || CHIPS['7400']).name}</h3><b>14: VCC</b>, <b>7: GND</b>. ` + (CHIPS[p.p.chip] || CHIPS['7400']).gates.map((pins, i) => `Cổng ${i + 1}: vào ${pins.slice(0, -1).join(', ')} → ra ${pins[pins.length - 1]}`).join(' · ') + '. Chân 1 nằm ở góc dưới bên trái (cạnh vết khuyết).';
        box.appendChild(th);
      }
      updateLive();
    }
    function updateLive() {
      const live = document.getElementById('bbLive');
      if (!live || !S.sel) return;
      const e = S.sel._el;
      if (!e || !e.def.info) { live.innerHTML = ''; return; }
      let rows;
      try { rows = e.def.info(e, S.eng); } catch (err) { rows = []; }
      live.innerHTML = '<h3>Số đo trực tiếp</h3><table>' + rows.map(([k, v]) => `<tr><td>${MS.escapeHTML(k)}</td><td>${MS.escapeHTML(v)}</td></tr>`).join('') + '</table>';
    }

    /* ---------- Công cụ / dao động ký ---------- */
    function renderChips() {
      const box = el.chips;
      box.innerHTML = '';
      scope.signals.forEach((s) => {
        const c = document.createElement('span');
        c.className = 'chip'; c.style.setProperty('--c', s.color);
        c.innerHTML = `<i></i><span class="chip-name">${MS.escapeHTML(s.label)}</span><span class="chip-val"></span>`;
        box.appendChild(c);
      });
      if (!scope.signals.length) box.innerHTML = '<span class="hint">Cắm “Que dao động ký” vào một lỗ để xem dạng sóng.</span>';
    }
    function updateChips() {
      const ch = el.chips.querySelectorAll('.chip');
      scope.signals.forEach((s, i) => { if (ch[i]) ch[i].querySelector('.chip-val').textContent = `${fmt(scope.current(s), 'V')} · ${fmt(s.perDiv, 'V')}/div`; });
    }
    function syncTools() {
      el.run.innerHTML = S.running ? '⏸ Tạm dừng' : '▶ Chạy';
      el.run.classList.toggle('paused', !S.running);
      el.speed.value = Math.log10(S.speed);
      el.speedLbl.textContent = fmt(S.speed, 's') + '/s';
      updateStatus();
    }
    function updateStatus() {
      const parts = [];
      if (S.tool === 'place') {
        const t = PT[S.placeType];
        parts.push(t.place === 'two' ? (S.pend ? `Chọn lỗ thứ hai cho ${t.name}` : `Nhấp lỗ thứ nhất cho ${t.name}`) : t.place === 'dip' ? 'Nhấp để cắm IC vắt qua rãnh giữa (chân 1 ở góc dưới trái)' : t.place === 'three' ? `Nhấp lỗ cho chân trái của ${t.name} · R đảo chiều` : 'Nhấp vào lỗ để cắm que đo');
        parts.push('Esc / chuột phải: thoát');
      } else parts.push('Nhấp linh kiện để chọn · kéo để di chuyển · nhấp lỗ trống để kéo dây · kéo nền để cuộn');
      if (S.dangling && S.dangling.size) parts.push(`<span class="warn">⚠ ${S.dangling.size} chân chưa nối</span>`);
      if (!S.circ.supply.on) parts.push('<span class="warn">Nguồn đang tắt</span>');
      if (S.error) parts.push(`<span class="err">✖ ${S.error}</span>`);
      el.status.innerHTML = parts.map((s) => `<span>${s}</span>`).join('');
    }

    el.run.onclick = () => { S.running = !S.running; S.error = null; syncTools(); };
    el.reset.onclick = () => { S.running = true; rebuild(); };
    el.speed.oninput = () => { S.speed = Math.pow(10, +el.speed.value); S.speedUser = true; el.speedLbl.textContent = fmt(S.speed, 's') + '/s'; };
    el.fit.onclick = fit;
    el.del.onclick = deleteSel;
    el.rot.onclick = rotateSel;
    el.undo.onclick = undo;
    el.clear.onclick = () => { if (S.circ.parts.length && !confirm('Gỡ hết linh kiện khỏi breadboard?')) return; load({ supply: S.circ.supply, parts: [] }); };
    const dd = el.exBtn.parentElement;
    el.exBtn.onclick = (e) => { e.stopPropagation(); dd.classList.toggle('open'); };
    document.addEventListener('click', (e) => { if (!dd.contains(e.target)) dd.classList.remove('open'); });
    el.exMenu.innerHTML = '';
    for (const ex of EXAMPLES) {
      const b = document.createElement('button');
      b.textContent = ex.name;
      b.onclick = () => { dd.classList.remove('open'); load(buildExample(ex)); };
      el.exMenu.appendChild(b);
    }
    new ResizeObserver(() => { resize(); }).observe(cv.parentElement);

    /* ---------- Vòng lặp ---------- */
    function tick(ts) {
      const dtR = S.lastTs ? Math.min(0.05, (ts - S.lastTs) / 1000) : 0;
      S.lastTs = ts;
      if (S.active) {
        if (S.running && !S.error) {
          S.debt += S.speed * dtR;
          const t0 = performance.now();
          let n = 0;
          while (S.debt >= S.dt) {
            if (!S.eng.step(S.dt)) {
              S.error = S.eng.error === 'singular' ? 'Ma trận suy biến: có thể nguồn bị nối tắt (ray đỏ nối thẳng GND?)' : 'Mô phỏng không hội tụ';
              S.running = false; syncTools(); break;
            }
            S.debt -= S.dt; n++;
            scope.sample(S.eng.t, sigValue);
            if ((n & 7) === 0 && performance.now() - t0 > 14) { S.debt = 0; break; }
          }
          computeDisplay();
        }
        render();
        scope.draw();
        if (ts - S.lastUi > 200) { S.lastUi = ts; updateLive(); updateChips(); el.time.textContent = 't = ' + fmt(S.eng.t, 's'); }
      }
      requestAnimationFrame(tick);
    }

    /* ---------- Khởi tạo ---------- */
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) { /* */ }
    S.circ = saved && saved.parts ? saved : buildExample(EXAMPLES[0]);
    S.circ.supply = Object.assign({ on: true, v1: '5', v2: '5' }, S.circ.supply);
    buildPalette();
    resize();
    rebuild();
    renderProps();
    requestAnimationFrame(tick);
    return {
      show() { S.active = true; resize(); if (!S.fitted) { fit(); S.fitted = true; } },
      hide() { S.active = false; },
      state: S,
      load: (id) => load(buildExample(EXAMPLES.find((e) => e.id === id)))
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
