/* MachSim – thư viện linh kiện: mô hình toán học, tham số, ký hiệu vẽ, lý thuyết */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  const VT = 0.025852; // điện áp nhiệt ở 300 K
  const GLEAK = 1e-9; // điện dẫn rò song song tiếp giáp (giúp hội tụ khi có nút nổi)
  const fmt = (v, u) => MS.formatSI(v, u);
  const X = (x, u) => (u >= 0 ? x[u] : 0);
  const DEFS = {};
  const def = (type, o) => { o.type = type; DEFS[type] = o; return o; };

  /* ===================== Hàm mô hình dùng chung ===================== */

  // Giới hạn bước điện áp tiếp giáp p-n (theo SPICE) để Newton hội tụ
  function pnjlim(vnew, vold, vt, vcrit) {
    if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
      if (vold > 0) {
        const arg = 1 + (vnew - vold) / vt;
        vnew = arg > 0 ? vold + vt * Math.log(arg) : vcrit;
      } else {
        vnew = vt * Math.log(vnew / vt);
      }
      return [vnew, true];
    }
    return [vnew, false];
  }

  function diodeParams(Is, n, BV, IBV) {
    const nvt = n * VT;
    IBV = IBV || 1e-3;
    return {
      Is, n, nvt, BV: BV > 0 ? BV : 0, IBV,
      vcrit: nvt * Math.log(nvt / (Math.SQRT2 * Is)),
      vcritBV: VT * Math.log(VT / (Math.SQRT2 * IBV))
    };
  }

  function diodeEval(v, P) {
    let i, g;
    const e = Math.exp(Math.min(v / P.nvt, 700));
    i = P.Is * (e - 1);
    g = (P.Is * e) / P.nvt;
    if (P.BV > 0) {
      const e = Math.exp(Math.min(-(v + P.BV) / VT, 700));
      i -= P.IBV * e;
      g += (P.IBV * e) / VT;
    }
    return { i, g };
  }

  function diodeLimit(v, vold, P, c) {
    let lim;
    [v, lim] = pnjlim(v, vold, P.nvt, P.vcrit);
    if (lim) c.limited = true;
    if (P.BV > 0 && v < 0) {
      let u = -v - P.BV, uold = -vold - P.BV;
      [u, lim] = pnjlim(u, uold, VT, P.vcritBV);
      if (lim) { c.limited = true; v = -u - P.BV; }
    }
    return v;
  }

  // Stamp diode giữa a (anode) và k (cathode); st lưu điện áp lần lặp trước
  function stampDiode(c, a, k, P, st, key) {
    let v = c.v(a) - c.v(k);
    v = diodeLimit(v, st[key] || 0, P, c);
    st[key] = v;
    const { i, g } = diodeEval(v, P);
    c.G(a, k, g + GLEAK);
    c.I(a, k, i - g * v);
  }

  function bjtParams(Is, BF, BR, VA) {
    return { Is, BF, BR, VA: VA > 0 ? VA : 0, vcrit: VT * Math.log(VT / (Math.SQRT2 * Is)) };
  }

  // Mô hình Ebers–Moll (dạng truyền đạt) + hiệu ứng Early, hệ quy chiếu NPN
  function bjtEval(vbe, vbc, P) {
    const ebe = Math.exp(Math.min(vbe / VT, 700));
    const ebc = Math.exp(Math.min(vbc / VT, 700));
    const If = P.Is * (ebe - 1), gif = (P.Is * ebe) / VT;
    const Ir = P.Is * (ebc - 1), gir = (P.Is * ebc) / VT;
    let kE = 1, dk = 0;
    if (P.VA > 0) {
      kE = 1 + (vbe - vbc) / P.VA;
      dk = 1 / P.VA;
      if (kE < 0.2) { kE = 0.2; dk = 0; }
    }
    const Ict = (If - Ir) * kE;
    const dIct_be = gif * kE + (If - Ir) * dk;
    const dIct_bc = -gir * kE - (If - Ir) * dk;
    return {
      Ic: Ict - Ir / P.BR,
      Ib: If / P.BF + Ir / P.BR,
      gc_be: dIct_be,
      gc_bc: dIct_bc - gir / P.BR,
      gb_be: gif / P.BF,
      gb_bc: gir / P.BR
    };
  }

  // p = +1 (NPN) hoặc -1 (PNP)
  function stampBJT(c, b, cn, e, P, st, p) {
    let vbe = p * (c.v(b) - c.v(e));
    let vbc = p * (c.v(b) - c.v(cn));
    let l1, l2;
    [vbe, l1] = pnjlim(vbe, st.vbe || 0, VT, P.vcrit);
    [vbc, l2] = pnjlim(vbc, st.vbc || 0, VT, P.vcrit);
    if (l1 || l2) c.limited = true;
    st.vbe = vbe; st.vbc = vbc;
    const m = bjtEval(vbe, vbc, P);
    const Icc = p * (m.Ic - m.gc_be * vbe - m.gc_bc * vbc);
    const Ibc = p * (m.Ib - m.gb_be * vbe - m.gb_bc * vbc);
    c.cur(cn, Icc, [[m.gc_be, b, e], [m.gc_bc, b, cn]]);
    c.cur(b, Ibc, [[m.gb_be, b, e], [m.gb_bc, b, cn]]);
    c.cur(e, -Icc - Ibc, [[-m.gc_be - m.gb_be, b, e], [-m.gc_bc - m.gb_bc, b, cn]]);
  }

  function bjtCurrents(x, b, cn, e, P, p) {
    const vbe = p * (X(x, b) - X(x, e)), vbc = p * (X(x, b) - X(x, cn));
    const m = bjtEval(vbe, vbc, P);
    return [p * m.Ib, p * m.Ic, -p * (m.Ib + m.Ic)];
  }

  // Mô hình Shichman–Hodges (MOSFET level 1, JFET), hệ quy chiếu kênh N, vds >= 0
  function fetEval(vgs, vds, P) {
    const vov = vgs - P.Vth;
    if (vov <= 0) return { id: 0, gm: 0, gds: 0, region: 0 };
    const kl = 1 + P.lambda * vds;
    if (vds < vov) {
      const q = vov * vds - (vds * vds) / 2;
      return { id: P.beta * q * kl, gm: P.beta * vds * kl, gds: P.beta * (vov - vds) * kl + P.beta * q * P.lambda, region: 1 };
    }
    return { id: (P.beta / 2) * vov * vov * kl, gm: P.beta * vov * kl, gds: (P.beta / 2) * vov * vov * P.lambda, region: 2 };
  }

  function fetlim(vnew, vold, vth) {
    const vov = vold - vth;
    if (vov <= 0) {
      if (vnew > vth + 0.5) return vth + 0.5;
      return vnew;
    }
    const maxd = Math.max(0.5, vov);
    if (vnew - vold > maxd) return vold + maxd;
    if (vold - vnew > maxd) return vold - maxd;
    return vnew;
  }

  function stampFET(c, g, d, s, P, st, p) {
    const swap = p * (c.v(d) - c.v(s)) < 0;
    const dd = swap ? s : d, ss = swap ? d : s;
    let vgs = p * (c.v(g) - c.v(ss));
    const vds = p * (c.v(dd) - c.v(ss));
    if (st.init && st.swap === swap) {
      const lv = fetlim(vgs, st.vgs, P.Vth);
      if (Math.abs(lv - vgs) > 1e-12) { vgs = lv; c.limited = true; }
    }
    st.vgs = vgs; st.vds = vds; st.swap = swap; st.init = true;
    const m = fetEval(vgs, vds, P);
    const Ic = p * (m.id - m.gm * vgs - m.gds * vds);
    c.cur(dd, Ic, [[m.gm, g, ss], [m.gds, dd, ss]]);
    c.cur(ss, -Ic, [[-m.gm, g, ss], [-m.gds, dd, ss]]);
    c.G(d, s, 1e-12);
  }

  function fetState(x, g, d, s, P, p) {
    const swap = p * (X(x, d) - X(x, s)) < 0;
    const dd = swap ? s : d, ss = swap ? d : s;
    const vgs = p * (X(x, g) - X(x, ss)), vds = p * (X(x, dd) - X(x, ss));
    const m = fetEval(vgs, vds, P);
    const idD = p * m.id * (swap ? -1 : 1); // dòng vào cực D thực
    return { m, vgs, vds, swap, idD };
  }

  /* ===================== Tiện ích vẽ (đơn vị = 1 ô lưới) ===================== */
  function line(g, pts, color, w) {
    g.strokeStyle = color;
    g.lineWidth = w || 0.1;
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.stroke();
  }
  function arrow(g, x1, y1, x2, y2, color, size) {
    size = size || 0.35;
    const a = Math.atan2(y2 - y1, x2 - x1);
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x2, y2);
    g.lineTo(x2 - size * Math.cos(a - 0.45), y2 - size * Math.sin(a - 0.45));
    g.lineTo(x2 - size * Math.cos(a + 0.45), y2 - size * Math.sin(a + 0.45));
    g.closePath();
    g.fill();
  }
  function circle(g, x, y, r, color, w, fill) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { g.fillStyle = fill; g.fill(); }
    g.strokeStyle = color;
    g.lineWidth = w || 0.1;
    g.stroke();
  }
  // Hai dây dẫn của linh kiện 2 cực: [0,a] và [b,4]
  function leads2(g, o, a, b) {
    line(g, [0, 0, a, 0], o.col(0));
    line(g, [b, 0, 4, 0], o.col(1));
  }
  function diodeBody(g, o, fill) {
    leads2(g, o, 1.4, 2.6);
    g.beginPath();
    g.moveTo(1.4, -0.6); g.lineTo(1.4, 0.6); g.lineTo(2.6, 0); g.closePath();
    g.fillStyle = fill || o.fillBody;
    g.fill();
    g.strokeStyle = o.body; g.lineWidth = 0.1; g.stroke();
  }
  function textC(g, s, x, y, color, size) {
    g.save();
    g.fillStyle = color;
    g.font = `bold ${size || 0.7}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(s, x, y);
    g.restore();
  }

  // Chữ luôn đứng thẳng dù linh kiện bị xoay/lật
  function textUp(g, el, str, x, y, color, size) {
    const c = el && el.comp;
    g.save();
    g.translate(x, y);
    if (c) { if (c.flip) g.scale(1, -1); g.rotate((-(c.rot & 3) * Math.PI) / 2); }
    textC(g, str, 0, 0, color, size);
    g.restore();
  }

  const TWO = [[0, 0], [4, 0]];
  const BOX2 = [0, -0.9, 4, 0.9];
  const PATH2 = [[0, [[0, 0], [4, 0]]]];

  // Lấy dòng (vào cực 0) & áp cho linh kiện 2 cực
  function info2(el, eng, curLabel) {
    const ic = el.def.currents(el, eng.x);
    const v = X(eng.x, el.u[0]) - X(eng.x, el.u[1]);
    return [['Điện áp', fmt(v, 'V')], [curLabel || 'Dòng điện', fmt(ic[0], 'A')], ['Công suất', fmt(v * ic[0], 'W')]];
  }

  /* ===================== LINH KIỆN CƠ BẢN ===================== */

  def('GND', {
    name: 'Đất (GND)', cat: 'basic', prefix: 'GND', terms: [[0, 0]], bbox: [-0.7, -0.2, 0.7, 1.2], paths: [],
    params: [], noLabel: true,
    stamp() {}, currents: () => [0],
    draw(g, el, o) {
      line(g, [0, 0, 0, 0.6], o.col(0));
      line(g, [-0.7, 0.6, 0.7, 0.6], o.body);
      line(g, [-0.45, 0.85, 0.45, 0.85], o.body);
      line(g, [-0.2, 1.1, 0.2, 1.1], o.body);
    },
    theory: 'Nút đất là điểm tham chiếu 0 V. Mọi điện áp nút được đo so với đất. Mỗi mạch cần ít nhất một điểm nối đất.'
  });

  def('PROBE', {
    name: 'Đầu dò (dao động ký)', cat: 'meter', prefix: 'P', terms: [[0, 0]], bbox: [-0.2, -1.6, 1.6, 0.2], paths: [],
    params: [], value: () => '',
    stamp() {}, currents: () => [0],
    draw(g, el, o) {
      line(g, [0, 0, 0.7, -0.7], o.col(0));
      circle(g, 1, -1, 0.42, o.probeColor || o.body, 0.1, o.probeColor || o.body);
    },
    info(el, eng) { return [['Điện áp so với đất', fmt(X(eng.x, el.u[0]), 'V')]]; },
    theory: 'Đầu dò đo điện áp tại một nút so với đất và hiển thị dạng sóng trên dao động ký ở phía dưới.'
  });

  def('R', {
    name: 'Điện trở', cat: 'basic', prefix: 'R', terms: TWO, bbox: BOX2, paths: PATH2,
    params: [{ k: 'R', label: 'Điện trở', unit: 'Ω', def: '1k' }],
    compile: (p) => ({ R: Math.max(MS.parseSI(p.R) || 1e3, 1e-6) }),
    value: (p) => fmt(MS.parseSI(p.R), 'Ω'),
    stamp(el, c) { c.G(el.u[0], el.u[1], 1 / el.P.R); },
    currents(el, x) { const i = (X(x, el.u[0]) - X(x, el.u[1])) / el.P.R; return [i, -i]; },
    info: (el, eng) => info2(el, eng),
    draw(g, el, o) {
      MS.drawSym(g, o, o.ansi ? 'R_ANSI' : 'R_IEC');
    },
    theory: 'Định luật Ohm: <b>U = I·R</b>. Công suất tiêu tán <b>P = I²R = U²/R</b>.'
  });

  def('C', {
    name: 'Tụ điện', cat: 'basic', prefix: 'C', terms: TWO, bbox: BOX2, paths: PATH2,
    params: [{ k: 'C', label: 'Điện dung', unit: 'F', def: '10u' }, { k: 'ic', label: 'Điện áp ban đầu (khi không khởi động từ DC)', unit: 'V', def: '0' }],
    compile: (p) => ({ C: Math.max(MS.parseSI(p.C) || 1e-6, 1e-18), ic: MS.parseSI(p.ic) || 0 }),
    value: (p) => fmt(MS.parseSI(p.C), 'F'),
    init(el) { el.s.v = el.P.ic || 0; el.s.i = 0; },
    fromDC(el, x) { el.s.v = X(x, el.u[0]) - X(x, el.u[1]); el.s.i = 0; },
    stamp(el, c) {
      if (c.mode === 'dc') return;
      const [a, b] = el.u, s = el.s;
      if (c.method === 'be') {
        const g = el.P.C / c.h;
        c.G(a, b, g); c.I(a, b, -g * s.v);
      } else {
        const g = (2 * el.P.C) / c.h;
        c.G(a, b, g); c.I(a, b, -(g * s.v + s.i));
      }
    },
    accept(el, c) {
      const v = c.v(el.u[0]) - c.v(el.u[1]), s = el.s;
      s.i = c.method === 'be' ? (el.P.C / c.h) * (v - s.v) : ((2 * el.P.C) / c.h) * (v - s.v) - s.i;
      s.v = v;
    },
    currents(el) { return [el.s.i || 0, -(el.s.i || 0)]; },
    info(el, eng) {
      const r = info2(el, eng);
      const v = X(eng.x, el.u[0]) - X(eng.x, el.u[1]);
      r.push(['Năng lượng', fmt(0.5 * el.P.C * v * v, 'J')]);
      return r;
    },
    draw(g, el, o) {
      MS.drawSym(g, o, 'C');
    },
    theory: 'Quan hệ <b>i = C·du/dt</b>. Tụ chặn dòng một chiều (DC) và cho tín hiệu xoay chiều đi qua. Trở kháng <b>Z<sub>C</sub> = 1/(2πfC)</b>.'
  });

  def('L', {
    name: 'Cuộn cảm', cat: 'basic', prefix: 'L', terms: TWO, bbox: BOX2, paths: PATH2, branches: 1,
    params: [{ k: 'L', label: 'Độ tự cảm', unit: 'H', def: '10m' }],
    compile: (p) => ({ L: Math.max(MS.parseSI(p.L) || 1e-3, 1e-15) }),
    value: (p) => fmt(MS.parseSI(p.L), 'H'),
    init(el) { el.s.v = 0; el.s.i = 0; },
    fromDC(el, x) { el.s.i = x[el.br[0]]; el.s.v = 0; },
    stamp(el, c) {
      const [a, b] = el.u, br = el.br[0], s = el.s;
      c.a(a, br, 1); c.a(b, br, -1); c.a(br, a, 1); c.a(br, b, -1);
      if (c.mode === 'dc') return;
      if (c.method === 'be') {
        const r = el.P.L / c.h;
        c.a(br, br, -r); c.rhs(br, -r * s.i);
      } else {
        const r = (2 * el.P.L) / c.h;
        c.a(br, br, -r); c.rhs(br, -r * s.i - s.v);
      }
    },
    accept(el, c) { el.s.i = c.x[el.br[0]]; el.s.v = c.v(el.u[0]) - c.v(el.u[1]); },
    currents(el, x) { const i = x[el.br[0]]; return [i, -i]; },
    info: (el, eng) => info2(el, eng),
    draw(g, el, o) {
      MS.drawSym(g, o, 'L');
    },
    theory: 'Quan hệ <b>u = L·di/dt</b>. Cuộn cảm ngắn mạch với DC, cản trở dòng biến thiên. Trở kháng <b>Z<sub>L</sub> = 2πfL</b>.'
  });

  def('V', {
    name: 'Nguồn áp DC', cat: 'basic', prefix: 'V', terms: TWO, bbox: BOX2, paths: PATH2, branches: 1,
    params: [{ k: 'V', label: 'Điện áp', unit: 'V', def: '5' }],
    compile: (p) => ({ V: MS.parseSI(p.V) || 0 }),
    value: (p) => fmt(MS.parseSI(p.V), 'V'),
    stamp(el, c) { c.V(el.br[0], el.u[0], el.u[1], el.P.V * c.scale); },
    currents(el, x) { const i = x[el.br[0]]; return [i, -i]; },
    info(el, eng) {
      const i = -eng.x[el.br[0]];
      return [['Điện áp', fmt(el.P.V, 'V')], ['Dòng cấp ra (cực +)', fmt(i, 'A')], ['Công suất cấp', fmt(i * el.P.V, 'W')]];
    },
    draw(g, el, o) {
      leads2(g, o, 1.8, 2.2);
      line(g, [1.8, -0.9, 1.8, 0.9], o.body, 0.1);
      line(g, [2.2, -0.45, 2.2, 0.45], o.body, 0.22);
      textC(g, '+', 1.2, -0.7, o.body, 0.7);
    },
    theory: 'Nguồn áp lý tưởng giữ hiệu điện thế không đổi giữa hai cực, bất kể dòng điện. Cạnh dài là cực dương (+).'
  });

  const WAVES = [['sin', 'Sin'], ['square', 'Vuông'], ['triangle', 'Tam giác'], ['saw', 'Răng cưa']];
  def('AC', {
    name: 'Máy phát sóng (AC)', cat: 'basic', prefix: 'V', terms: TWO, bbox: [0, -1.1, 4, 1.1], paths: PATH2, branches: 1,
    params: [
      { k: 'wave', label: 'Dạng sóng', type: 'sel', opts: WAVES, def: 'sin' },
      { k: 'amp', label: 'Biên độ (đỉnh)', unit: 'V', def: '5' },
      { k: 'freq', label: 'Tần số', unit: 'Hz', def: '50' },
      { k: 'offset', label: 'Điện áp DC offset', unit: 'V', def: '0' },
      { k: 'phase', label: 'Pha ban đầu (độ)', unit: '°', def: '0' }
    ],
    compile: (p) => ({ wave: p.wave || 'sin', amp: MS.parseSI(p.amp) || 0, f: MS.parseSI(p.freq) || 50, off: MS.parseSI(p.offset) || 0, ph: MS.parseSI(p.phase) || 0 }),
    value(p) {
      const w = { sin: '∿', square: '⊓', triangle: '⋀', saw: '⩘' }[p.wave] || '';
      return `${w} ${fmt(MS.parseSI(p.amp), 'V')} ${fmt(MS.parseSI(p.freq), 'Hz')}` + (MS.parseSI(p.offset) ? ` +${fmt(MS.parseSI(p.offset), 'V')}` : '');
    },
    valueAt(P, t) {
      let fr = (P.f * t + P.ph / 360) % 1;
      if (fr < 0) fr += 1;
      let y;
      switch (P.wave) {
        case 'square': y = fr < 0.5 ? 1 : -1; break;
        case 'triangle': y = fr < 0.25 ? 4 * fr : fr < 0.75 ? 2 - 4 * fr : 4 * fr - 4; break;
        case 'saw': y = 2 * fr - 1; if (fr === 0) y = 0; break;
        default: y = Math.sin(2 * Math.PI * fr);
      }
      return P.off + P.amp * y;
    },
    stamp(el, c) { c.V(el.br[0], el.u[0], el.u[1], DEFS.AC.valueAt(el.P, c.t) * c.scale); },
    currents(el, x) { const i = x[el.br[0]]; return [i, -i]; },
    info(el, eng) {
      const v = X(eng.x, el.u[0]) - X(eng.x, el.u[1]), i = -eng.x[el.br[0]];
      return [['Điện áp tức thời', fmt(v, 'V')], ['Dòng cấp ra (cực +)', fmt(i, 'A')], ['Chu kỳ T', fmt(1 / el.P.f, 's')], ['Giá trị hiệu dụng (sin)', fmt(el.P.amp / Math.SQRT2, 'V')]];
    },
    draw(g, el, o) {
      leads2(g, o, 1, 3);
      circle(g, 2, 0, 1, o.body, 0.1, o.fillBody);
      g.strokeStyle = o.body; g.lineWidth = 0.09; g.beginPath();
      const w = el.comp ? el.comp.p.wave : 'sin';
      if (w === 'square') { g.moveTo(1.45, 0.3); g.lineTo(1.45, -0.3); g.lineTo(2, -0.3); g.lineTo(2, 0.3); g.lineTo(2.55, 0.3); g.lineTo(2.55, -0.3); }
      else if (w === 'triangle') { g.moveTo(1.4, 0.3); g.lineTo(1.7, -0.3); g.lineTo(2.3, 0.3); g.lineTo(2.6, -0.3); }
      else if (w === 'saw') { g.moveTo(1.4, 0.3); g.lineTo(2, -0.3); g.lineTo(2, 0.3); g.lineTo(2.6, -0.3); g.lineTo(2.6, 0.3); }
      else { for (let i = 0; i <= 20; i++) { const t = i / 20; const xx = 1.4 + 1.2 * t, yy = -0.35 * Math.sin(t * Math.PI * 2); i ? g.lineTo(xx, yy) : g.moveTo(xx, yy); } }
      g.stroke();
      textC(g, '+', 0.6, -0.6, o.body, 0.6);
    },
    theory: 'Nguồn tín hiệu xoay chiều <b>u(t) = U<sub>0</sub> + U<sub>m</sub>·sin(2πft + φ)</b>. Với sóng sin, giá trị hiệu dụng <b>U<sub>rms</sub> = U<sub>m</sub>/√2</b>.'
  });

  def('I', {
    name: 'Nguồn dòng DC', cat: 'basic', prefix: 'I', terms: TWO, bbox: [0, -1.1, 4, 1.1], paths: PATH2,
    params: [{ k: 'I', label: 'Dòng điện', unit: 'A', def: '1m' }],
    compile: (p) => ({ I: MS.parseSI(p.I) || 0 }),
    value: (p) => fmt(MS.parseSI(p.I), 'A'),
    stamp(el, c) { c.I(el.u[0], el.u[1], el.P.I * c.scale); },
    currents(el) { return [el.P.I, -el.P.I]; },
    info(el, eng) { const v = X(eng.x, el.u[1]) - X(eng.x, el.u[0]); return [['Dòng điện', fmt(el.P.I, 'A')], ['Điện áp trên nguồn', fmt(v, 'V')], ['Công suất cấp', fmt(v * el.P.I, 'W')]]; },
    draw(g, el, o) {
      leads2(g, o, 1, 3);
      circle(g, 2, 0, 1, o.body, 0.1, o.fillBody);
      line(g, [1.4, 0, 2.4, 0], o.body, 0.1);
      arrow(g, 1.6, 0, 2.65, 0, o.body, 0.4);
    },
    theory: 'Nguồn dòng lý tưởng luôn đẩy một dòng điện không đổi theo chiều mũi tên, bất kể điện áp trên nó.'
  });

  def('SW', {
    name: 'Công tắc', cat: 'basic', prefix: 'SW', terms: TWO, bbox: BOX2, paths: PATH2,
    params: [{ k: 'closed', label: 'Đóng', type: 'bool', def: false }],
    compile: (p) => ({ closed: !!p.closed }),
    value: (p) => (p.closed ? 'đóng' : 'mở'),
    clickable: true,
    stamp(el, c) { c.G(el.u[0], el.u[1], el.P.closed ? 1e3 : 1e-10); },
    currents(el, x) { const i = (X(x, el.u[0]) - X(x, el.u[1])) * (el.P.closed ? 1e3 : 1e-10); return [i, -i]; },
    info: (el, eng) => info2(el, eng),
    draw(g, el, o) {
      const closed = el.comp ? el.comp.p.closed : false;
      leads2(g, o, 1.2, 2.8);
      circle(g, 1.2, 0, 0.12, o.body, 0.08, o.body);
      circle(g, 2.8, 0, 0.12, o.body, 0.08, o.body);
      line(g, closed ? [1.2, 0, 2.8, 0] : [1.2, 0, 2.7, -0.9], o.body, 0.12);
    },
    theory: 'Công tắc lý tưởng: khi đóng có điện trở ≈ 0, khi mở hở mạch. <b>Nhấp chuột vào công tắc để bật/tắt.</b>'
  });

  def('POT', {
    name: 'Biến trở (chiết áp)', cat: 'basic', prefix: 'VR', terms: [[0, 0], [4, 0], [2, 2]], bbox: [0, -0.6, 4, 2],
    paths: [[0, [[0, 0], [2, 0]]], [1, [[4, 0], [2, 0]]], [2, [[2, 2], [2, 0.5]]]],
    params: [
      { k: 'R', label: 'Điện trở toàn phần', unit: 'Ω', def: '10k' },
      { k: 'pos', label: 'Vị trí con chạy (0 = phía B, 100% = phía A)', type: 'range', def: 0.5 }
    ],
    compile(p) { const R = Math.max(MS.parseSI(p.R) || 1e4, 1e-3); const pos = MS.clamp(+p.pos, 0, 1); return { R1: Math.max(R * (1 - pos), 1e-3), R2: Math.max(R * pos, 1e-3) }; },
    value: (p) => `${fmt(MS.parseSI(p.R), 'Ω')} (${Math.round(p.pos * 100)}%)`,
    stamp(el, c) { c.G(el.u[0], el.u[2], 1 / el.P.R1); c.G(el.u[2], el.u[1], 1 / el.P.R2); },
    currents(el, x) {
      const va = X(x, el.u[0]), vb = X(x, el.u[1]), vw = X(x, el.u[2]);
      const i1 = (va - vw) / el.P.R1, i2 = (vb - vw) / el.P.R2;
      return [i1, i2, -i1 - i2];
    },
    info(el, eng) {
      const ic = el.def.currents(el, eng.x);
      return [['R (A–con chạy)', fmt(el.P.R1, 'Ω')], ['R (con chạy–B)', fmt(el.P.R2, 'Ω')], ['Điện áp con chạy', fmt(X(eng.x, el.u[2]), 'V')], ['Dòng con chạy', fmt(ic[2], 'A')]];
    },
    draw(g, el, o) {
      line(g, [0, 0, 1, 0], o.col(0));
      line(g, [3, 0, 4, 0], o.col(1));
      g.fillStyle = o.fillBody; g.fillRect(1, -0.4, 2, 0.8);
      g.strokeStyle = o.body; g.lineWidth = 0.1; g.strokeRect(1, -0.4, 2, 0.8);
      line(g, [2, 2, 2, 0.9], o.col(2));
      arrow(g, 2, 1.5, 2, 0.45, o.body, 0.45);
    },
    theory: 'Biến trở 3 chân là bộ chia áp điều chỉnh được: <b>U<sub>ra</sub> = U·R<sub>2</sub>/(R<sub>1</sub>+R<sub>2</sub>)</b>. Kéo thanh trượt trong bảng thuộc tính để thay đổi.'
  });

  /* ===================== ĐỒNG HỒ ĐO ===================== */

  def('VM', {
    name: 'Vôn kế', cat: 'meter', prefix: 'VM', terms: TWO, bbox: [0, -1, 4, 1], paths: [],
    params: [], meter: 'V',
    stamp() {},
    currents: () => [0, 0],
    reading: (el, eng) => X(eng.x, el.u[0]) - X(eng.x, el.u[1]),
    info: (el, eng) => [['Số chỉ', fmt(X(eng.x, el.u[0]) - X(eng.x, el.u[1]), 'V')]],
    draw(g, el, o) {
      leads2(g, o, 1.2, 2.8);
      circle(g, 2, 0, 0.8, o.body, 0.1, o.fillBody);
      textC(g, 'V', 2, 0.03, o.body, 0.9);
      textC(g, '+', 0.8, -0.55, o.body, 0.55);
    },
    theory: 'Vôn kế lý tưởng (điện trở trong vô cùng lớn) mắc <b>song song</b> với phần tử cần đo điện áp. Số chỉ = V(+) − V(−).'
  });

  def('AM', {
    name: 'Ampe kế', cat: 'meter', prefix: 'AM', terms: TWO, bbox: [0, -1, 4, 1], paths: PATH2, branches: 1,
    params: [], meter: 'A',
    stamp(el, c) { c.V(el.br[0], el.u[0], el.u[1], 0); },
    currents(el, x) { const i = x[el.br[0]]; return [i, -i]; },
    reading: (el, eng) => eng.x[el.br[0]],
    info: (el, eng) => [['Số chỉ', fmt(eng.x[el.br[0]], 'A')]],
    draw(g, el, o) {
      leads2(g, o, 1.2, 2.8);
      circle(g, 2, 0, 0.8, o.body, 0.1, o.fillBody);
      textC(g, 'A', 2, 0.03, o.body, 0.9);
      textC(g, '+', 0.8, -0.55, o.body, 0.55);
    },
    theory: 'Ampe kế lý tưởng (điện trở trong bằng 0) mắc <b>nối tiếp</b> trong nhánh cần đo. Số chỉ dương khi dòng đi vào cực (+).'
  });

  /* ===================== LINH KIỆN BÁN DẪN ===================== */

  function diodeInfo(el, eng) {
    const v = X(eng.x, el.u[0]) - X(eng.x, el.u[1]);
    const i = el.def.currents(el, eng.x)[0];
    let st;
    if (el.P.BV > 0 && v < -0.9 * el.P.BV && i < -1e-6) st = 'Đánh thủng ngược (vùng Zener)';
    else if (i > 1e-5) st = 'Phân cực thuận – đang dẫn';
    else if (v > 0) st = 'Phân cực thuận – chưa vượt ngưỡng';
    else st = 'Phân cực ngược – khóa';
    return [['Điện áp V_AK', fmt(v, 'V')], ['Dòng I_D', fmt(i, 'A')], ['Công suất', fmt(v * i, 'W')], ['Trạng thái', st]];
  }
  function diodeCurrents(el, x) {
    const v = X(x, el.u[0]) - X(x, el.u[1]);
    const i = diodeEval(v, el.P).i + GLEAK * v;
    return [i, -i];
  }
  const diodeCommon = {
    cat: 'semi', terms: TWO, bbox: BOX2, paths: PATH2, nonlinear: true,
    init(el) { el.s.vd = 0; },
    stamp(el, c) { stampDiode(c, el.u[0], el.u[1], el.P, el.s, 'vd'); },
    currents: diodeCurrents,
    info: diodeInfo
  };
  const diodeParamDefs = (presets, defModel) => [
    { k: 'model', label: 'Mẫu linh kiện', type: 'sel', opts: Object.keys(presets).map((k) => [k, k]).concat([['custom', 'Tùy chỉnh']]), def: defModel, preset: true },
    { k: 'Is', label: 'Dòng bão hòa ngược Is', unit: 'A', def: presets[defModel].Is },
    { k: 'n', label: 'Hệ số lý tưởng n', unit: '', def: presets[defModel].n },
    { k: 'BV', label: 'Điện áp đánh thủng BV (0 = bỏ qua)', unit: 'V', def: presets[defModel].BV }
  ];

  const D_PRESETS = {
    '1N4148': { Is: '2.52n', n: '1.752', BV: '100' },
    '1N4007': { Is: '7n', n: '1.8', BV: '1000' },
    'Si lý tưởng hoá': { Is: '10f', n: '1', BV: '0' }
  };
  def('D', Object.assign({}, diodeCommon, {
    name: 'Diode chỉnh lưu', prefix: 'D', presets: D_PRESETS,
    params: diodeParamDefs(D_PRESETS, '1N4148'),
    compile: (p) => diodeParams(MS.parseSI(p.Is) || 1e-14, MS.parseSI(p.n) || 1, MS.parseSI(p.BV) || 0),
    value: (p) => (p.model !== 'custom' ? p.model : 'Diode'),
    draw(g, el, o) { MS.drawSym(g, o, 'D'); },
    theory: 'Diode bán dẫn (tiếp giáp p–n). Phương trình Shockley: <b>I<sub>D</sub> = I<sub>S</sub>(e<sup>V<sub>D</sub>/(nV<sub>T</sub>)</sup> − 1)</b>, V<sub>T</sub> ≈ 25,85 mV ở 300 K. Diode Si dẫn rõ rệt khi V<sub>D</sub> ≈ 0,6–0,7 V; phân cực ngược chỉ có dòng rò rất nhỏ cho tới khi bị đánh thủng.'
  }));

  const DS_PRESETS = {
    '1N5819': { Is: '1u', n: '1.05', BV: '40' },
    'BAT54': { Is: '50n', n: '1.0', BV: '30' }
  };
  def('DS', Object.assign({}, diodeCommon, {
    name: 'Diode Schottky', prefix: 'D', presets: DS_PRESETS,
    params: diodeParamDefs(DS_PRESETS, '1N5819'),
    compile: (p) => diodeParams(MS.parseSI(p.Is) || 1e-8, MS.parseSI(p.n) || 1, MS.parseSI(p.BV) || 0),
    value: (p) => (p.model !== 'custom' ? p.model : 'Schottky'),
    draw(g, el, o) { diodeBody(g, o); line(g, [2.3, -0.4, 2.3, -0.6, 2.6, -0.6, 2.6, 0.6, 2.9, 0.6, 2.9, 0.4], o.body, 0.11); },
    theory: 'Diode Schottky dùng tiếp giáp kim loại–bán dẫn: điện áp thuận thấp (≈ 0,2–0,4 V), chuyển mạch rất nhanh, nhưng dòng rò ngược lớn hơn diode Si thường. Dùng trong nguồn xung, bảo vệ ngược cực.'
  }));

  const DZ_PRESETS = {
    '3V3': { Is: '10f', n: '1', BV: '3.3' },
    '5V1': { Is: '10f', n: '1', BV: '5.1' },
    '6V2': { Is: '10f', n: '1', BV: '6.2' },
    '9V1': { Is: '10f', n: '1', BV: '9.1' },
    '12V': { Is: '10f', n: '1', BV: '12' }
  };
  def('DZ', Object.assign({}, diodeCommon, {
    name: 'Diode Zener', prefix: 'DZ', presets: DZ_PRESETS,
    params: [
      { k: 'model', label: 'Điện áp Zener', type: 'sel', opts: Object.keys(DZ_PRESETS).map((k) => [k, k]).concat([['custom', 'Tùy chỉnh']]), def: '5V1', preset: true },
      { k: 'BV', label: 'Điện áp Zener V_Z', unit: 'V', def: '5.1' },
      { k: 'Is', label: 'Dòng bão hòa Is', unit: 'A', def: '10f' },
      { k: 'n', label: 'Hệ số lý tưởng n', unit: '', def: '1' }
    ],
    compile: (p) => diodeParams(MS.parseSI(p.Is) || 1e-14, MS.parseSI(p.n) || 1, MS.parseSI(p.BV) || 5.1),
    value: (p) => 'Zener ' + fmt(MS.parseSI(p.BV), 'V'),
    draw(g, el, o) { diodeBody(g, o); line(g, [2.3, -0.75, 2.6, -0.6, 2.6, 0.6, 2.9, 0.75], o.body, 0.12); },
    theory: 'Diode Zener được thiết kế để làm việc ở vùng <b>đánh thủng ngược</b>: khi phân cực ngược và |V| đạt V<sub>Z</sub>, điện áp trên diode gần như không đổi dù dòng thay đổi lớn ⇒ dùng để <b>ổn áp</b>. Mắc cathode về phía điện áp dương, luôn có điện trở hạn dòng nối tiếp.'
  }));

  const LED_COLORS = { red: ['Đỏ', 1.8, '#ff453a'], yellow: ['Vàng', 2.0, '#ffd60a'], green: ['Lục', 2.1, '#30d158'], blue: ['Lam', 3.0, '#3a8bff'], white: ['Trắng', 3.0, '#f5f5ff'] };
  def('LED', Object.assign({}, diodeCommon, {
    name: 'LED', prefix: 'LED',
    params: [
      { k: 'color', label: 'Màu', type: 'sel', opts: Object.keys(LED_COLORS).map((k) => [k, LED_COLORS[k][0]]), def: 'red' },
      { k: 'Imax', label: 'Dòng định mức', unit: 'A', def: '20m' }
    ],
    compile(p) {
      const c = LED_COLORS[p.color] || LED_COLORS.red;
      const n = 2, Vf = c[1];
      const Is = 0.01 / (Math.exp(Vf / (n * VT)) - 1);
      const P = diodeParams(Is, n, 5);
      P.Imax = MS.parseSI(p.Imax) || 0.02;
      P.Vf = Vf;
      P.color = c[2];
      return P;
    },
    value: (p) => 'LED ' + (LED_COLORS[p.color] || LED_COLORS.red)[0].toLowerCase(),
    info(el, eng) {
      const r = diodeInfo(el, eng);
      const i = r && el.def.currents(el, eng.x)[0];
      r.push(['Độ sáng', Math.round(MS.clamp(Math.sqrt(Math.max(i, 0) / el.P.Imax), 0, 1) * 100) + '%']);
      if (i > 1.5 * el.P.Imax) r.push(['Cảnh báo', '⚠ Quá dòng – LED thật sẽ hỏng!']);
      return r;
    },
    draw(g, el, o) {
      const P = el.P || DEFS.LED.compile(el.comp ? el.comp.p : { color: 'red' });
      const i = o.ic ? o.ic[0] : 0;
      const b = MS.clamp(Math.sqrt(Math.max(i, 0) / P.Imax), 0, 1);
      if (b > 0.02) {
        const gr = g.createRadialGradient(2, 0, 0.1, 2, 0, 2.2);
        gr.addColorStop(0, P.color + 'ff');
        gr.addColorStop(1, P.color + '00');
        g.globalAlpha = b * 0.8;
        g.fillStyle = gr;
        g.beginPath(); g.arc(2, 0, 2.2, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
      }
      diodeBody(g, o, b > 0.02 ? P.color : P.color + '40');
      line(g, [2.6, -0.6, 2.6, 0.6], o.body, 0.12);
      line(g, [1.9, -0.8, 2.4, -1.3], o.body, 0.08); arrow(g, 1.9, -0.8, 2.5, -1.4, o.body, 0.25);
      line(g, [2.4, -0.7, 2.9, -1.2], o.body, 0.08); arrow(g, 2.4, -0.7, 3.0, -1.3, o.body, 0.25);
      if (i > 1.5 * P.Imax) textC(g, '⚠', 3.3, -1.1, '#ff9f0a', 0.8);
    },
    theory: 'LED (diode phát quang) phát sáng khi phân cực thuận. Điện áp thuận phụ thuộc màu: đỏ ≈ 1,8 V, lục ≈ 2,1 V, lam/trắng ≈ 3 V. Cần điện trở hạn dòng: <b>R = (U<sub>nguồn</sub> − V<sub>F</sub>)/I<sub>F</sub></b>, thường I<sub>F</sub> ≈ 10–20 mA.'
  }));

  /* ---------- BJT ---------- */
  const NPN_PRESETS = {
    '2N2222': { beta: '200', BR: '3', Is: '14f', VA: '75' },
    '2N3904': { beta: '300', BR: '4', Is: '6.7f', VA: '74' },
    'BC547': { beta: '290', BR: '8', Is: '18f', VA: '63' },
    'Lý tưởng hoá (β=100)': { beta: '100', BR: '1', Is: '10f', VA: '0' }
  };
  const PNP_PRESETS = {
    '2N2907': { beta: '230', BR: '4', Is: '650f', VA: '115' },
    '2N3906': { beta: '180', BR: '4', Is: '1.4f', VA: '19' },
    'BC557': { beta: '250', BR: '6', Is: '10f', VA: '45' },
    'Lý tưởng hoá (β=100)': { beta: '100', BR: '1', Is: '10f', VA: '0' }
  };
  const bjtParamDefs = (presets, d) => [
    { k: 'model', label: 'Mẫu linh kiện', type: 'sel', opts: Object.keys(presets).map((k) => [k, k]).concat([['custom', 'Tùy chỉnh']]), def: d, preset: true },
    { k: 'beta', label: 'Hệ số khuếch đại β (h_FE)', unit: '', def: presets[d].beta },
    { k: 'BR', label: 'β ngược (β_R)', unit: '', def: presets[d].BR },
    { k: 'Is', label: 'Dòng bão hòa Is', unit: 'A', def: presets[d].Is },
    { k: 'VA', label: 'Điện áp Early V_A (0 = bỏ qua)', unit: 'V', def: presets[d].VA }
  ];
  const BJT_TERMS = [[0, 0], [2, -2], [2, 2]];
  const BJT_PATHS = [[0, [[0, 0], [1, 0]]], [1, [[2, -2], [2, -1], [1, -0.35]]], [2, [[2, 2], [2, 1], [1, 0.35]]]];

  function bjtInfo(el, eng, p) {
    const [b, cn, e] = el.u, x = eng.x;
    const ic = bjtCurrents(x, b, cn, e, el.P, p);
    const vbe = X(x, b) - X(x, e), vce = X(x, cn) - X(x, e);
    const on = p * vbe > 0.45 && p * ic[0] > 1e-9;
    let reg;
    if (!on) reg = 'Tắt (ngưng dẫn)';
    else if (p * vce < 0) reg = 'Tích cực ngược';
    else if (p * vce < 0.3) reg = 'Bão hòa';
    else reg = 'Khuếch đại (tích cực thuận)';
    const r = [
      ['V_BE', fmt(vbe, 'V')], ['V_CE', fmt(vce, 'V')],
      ['I_B', fmt(ic[0], 'A')], ['I_C', fmt(ic[1], 'A')], ['I_E (ra)', fmt(-ic[2], 'A')],
      ['β thực tế = I_C/I_B', Math.abs(ic[0]) > 1e-12 ? (ic[1] / ic[0]).toFixed(1) : '—'],
      ['Công suất tiêu tán', fmt(vce * ic[1] + vbe * ic[0], 'W')],
      ['Vùng làm việc', reg]
    ];
    if (on && reg.startsWith('Khuếch đại')) r.splice(6, 0, ['Hỗ dẫn g_m = I_C/V_T', fmt(Math.abs(ic[1]) / VT, 'S')]);
    return r;
  }

  function drawBJT(g, o, pnp) {
    line(g, [0, 0, 1, 0], o.col(0));
    circle(g, 1.45, 0, 1.25, o.body, 0.06, o.fillBody);
    line(g, [1, -0.8, 1, 0.8], o.body, 0.18);
    line(g, [1, -0.35, 2, -1, 2, -2], o.col(1));
    line(g, [1, 0.35, 2, 1, 2, 2], o.col(2));
    if (pnp) arrow(g, 1.75, 0.84, 1.12, 0.43, o.body, 0.42);
    else arrow(g, 1.3, 0.55, 1.95, 0.97, o.body, 0.42);
  }

  def('NPN', {
    name: 'BJT NPN', cat: 'semi', prefix: 'Q', terms: BJT_TERMS, termNames: ['B', 'C', 'E'], bbox: [-0.1, -2, 2.8, 2], paths: BJT_PATHS, nonlinear: true,
    presets: NPN_PRESETS, params: bjtParamDefs(NPN_PRESETS, '2N2222'),
    compile: (p) => { const P = bjtParams(MS.parseSI(p.Is) || 1e-14, MS.parseSI(p.beta) || 100, MS.parseSI(p.BR) || 1, MS.parseSI(p.VA) || 0); return P; },
    value: (p) => (p.model !== 'custom' ? p.model.replace(/ \(.*\)/, '') : 'NPN') + ` β=${p.beta}`,
    init(el) { el.s.vbe = 0; el.s.vbc = 0; },
    caps: (el) => [[el.u[0], el.u[2], 20e-12], [el.u[0], el.u[1], 5e-12]],
    stamp(el, c) { stampBJT(c, el.u[0], el.u[1], el.u[2], el.P, el.s, 1); },
    currents: (el, x) => bjtCurrents(x, el.u[0], el.u[1], el.u[2], el.P, 1),
    info: (el, eng) => bjtInfo(el, eng, 1),
    draw: (g, el, o) => drawBJT(g, o, false),
    theory: 'Transistor lưỡng cực NPN, 3 cực B–C–E. Ở <b>vùng khuếch đại</b> (B–E phân cực thuận ≈ 0,7 V, B–C phân cực ngược): <b>I<sub>C</sub> = β·I<sub>B</sub></b>, I<sub>E</sub> = I<sub>B</sub> + I<sub>C</sub>. <b>Bão hòa</b>: cả hai tiếp giáp phân cực thuận, V<sub>CE</sub> ≈ 0,1–0,2 V (dùng làm khóa đóng). <b>Tắt</b>: V<sub>BE</sub> < ~0,5 V, I<sub>C</sub> ≈ 0. Mô hình: Ebers–Moll + hiệu ứng Early (V<sub>A</sub>).'
  });

  def('PNP', {
    name: 'BJT PNP', cat: 'semi', prefix: 'Q', terms: BJT_TERMS, termNames: ['B', 'C', 'E'], bbox: [-0.1, -2, 2.8, 2], paths: BJT_PATHS, nonlinear: true,
    presets: PNP_PRESETS, params: bjtParamDefs(PNP_PRESETS, '2N3906'),
    compile: (p) => bjtParams(MS.parseSI(p.Is) || 1e-14, MS.parseSI(p.beta) || 100, MS.parseSI(p.BR) || 1, MS.parseSI(p.VA) || 0),
    value: (p) => (p.model !== 'custom' ? p.model.replace(/ \(.*\)/, '') : 'PNP') + ` β=${p.beta}`,
    init(el) { el.s.vbe = 0; el.s.vbc = 0; },
    caps: (el) => [[el.u[0], el.u[2], 20e-12], [el.u[0], el.u[1], 5e-12]],
    stamp(el, c) { stampBJT(c, el.u[0], el.u[1], el.u[2], el.P, el.s, -1); },
    currents: (el, x) => bjtCurrents(x, el.u[0], el.u[1], el.u[2], el.P, -1),
    info: (el, eng) => bjtInfo(el, eng, -1),
    draw: (g, el, o) => drawBJT(g, o, true),
    theory: 'Transistor PNP hoạt động như NPN nhưng mọi điện áp và dòng điện đảo chiều: dẫn khi V<sub>EB</sub> ≈ 0,7 V (cực E dương hơn B), dòng đi vào cực E và ra ở C và B. Thường mắc E lên nguồn dương. Nhấn <b>F</b> để lật linh kiện (E lên trên).'
  });

  /* ---------- MOSFET ---------- */
  const NMOS_PRESETS = {
    '2N7000': { Vth: '2.1', beta: '0.2', lambda: '0.01' },
    'IRF540': { Vth: '3.5', beta: '15', lambda: '0.005' },
    'CMOS (W/L nhỏ)': { Vth: '1', beta: '1m', lambda: '0.02' }
  };
  const PMOS_PRESETS = {
    'BS250': { Vth: '-2.5', beta: '0.15', lambda: '0.01' },
    'IRF9540': { Vth: '-3.5', beta: '8', lambda: '0.005' },
    'CMOS (W/L nhỏ)': { Vth: '-1', beta: '1m', lambda: '0.02' }
  };
  const fetParamDefs = (presets, d) => [
    { k: 'model', label: 'Mẫu linh kiện', type: 'sel', opts: Object.keys(presets).map((k) => [k, k]).concat([['custom', 'Tùy chỉnh']]), def: d, preset: true },
    { k: 'Vth', label: 'Điện áp ngưỡng V_th', unit: 'V', def: presets[d].Vth },
    { k: 'beta', label: 'Hệ số β = μC_ox·W/L', unit: 'A/V²', def: presets[d].beta },
    { k: 'lambda', label: 'Điều chế kênh λ', unit: '1/V', def: presets[d].lambda }
  ];
  const FET_TERMS = [[0, 0], [2, -2], [2, 2]];
  const FET_PATHS = [[1, [[2, -2], [2, -0.65], [1, -0.65]]], [2, [[2, 2], [2, 0.65], [1, 0.65]]]];
  const REG_MOS = ['Ngắt (cut-off)', 'Tuyến tính / triode (như điện trở)', 'Bão hòa (khuếch đại)'];

  function fetInfo(el, eng, p, names) {
    const [g, d, s] = el.u, x = eng.x;
    const st = fetState(x, g, d, s, el.P, p);
    return [
      ['V_GS', fmt(X(x, g) - X(x, s), 'V')], ['V_DS', fmt(X(x, d) - X(x, s), 'V')],
      ['I_D (vào cực D)', fmt(st.idD, 'A')],
      ['Hỗ dẫn g_m', fmt(st.m.gm, 'S')],
      ['Công suất', fmt((X(x, d) - X(x, s)) * st.idD, 'W')],
      ['Vùng làm việc', names[st.m.region]]
    ];
  }

  function drawMOS(g, o, pmos) {
    line(g, [0, 0, 0.7, 0], o.col(0));
    line(g, [0.7, -0.8, 0.7, 0.8], o.body, 0.12);
    for (const [a, b] of [[-0.95, -0.4], [-0.25, 0.25], [0.4, 0.95]]) line(g, [1.0, a, 1.0, b], o.body, 0.14);
    line(g, [1.0, -0.65, 2, -0.65, 2, -2], o.col(1));
    line(g, [1.0, 0.65, 2, 0.65, 2, 2], o.col(2));
    line(g, [1.0, 0, 2, 0, 2, 0.65], o.col(2), 0.08);
    if (pmos) arrow(g, 1.15, 0, 1.85, 0, o.body, 0.38);
    else arrow(g, 1.85, 0, 1.08, 0, o.body, 0.38);
  }

  def('NMOS', {
    name: 'MOSFET kênh N', cat: 'semi', prefix: 'M', terms: FET_TERMS, termNames: ['G', 'D', 'S'], bbox: [-0.1, -2, 2.3, 2], paths: FET_PATHS, nonlinear: true,
    presets: NMOS_PRESETS, params: fetParamDefs(NMOS_PRESETS, '2N7000'),
    compile: (p) => ({ Vth: MS.parseSI(p.Vth), beta: MS.parseSI(p.beta) || 1e-3, lambda: MS.parseSI(p.lambda) || 0 }),
    value: (p) => (p.model !== 'custom' ? p.model.replace(/ \(.*\)/, '') : 'NMOS') + ` Vth=${p.Vth}V`,
    init(el) { el.s = {}; },
    caps: (el) => [[el.u[0], el.u[2], 10e-12], [el.u[0], el.u[1], 3e-12]],
    stamp(el, c) { stampFET(c, el.u[0], el.u[1], el.u[2], el.P, el.s, 1); },
    currents(el, x) { const st = fetState(x, el.u[0], el.u[1], el.u[2], el.P, 1); return [0, st.idD, -st.idD]; },
    info: (el, eng) => fetInfo(el, eng, 1, REG_MOS),
    draw: (g, el, o) => drawMOS(g, o, false),
    theory: 'MOSFET tăng cường kênh N, 3 cực G–D–S (thân nối nguồn S). Cực G cách điện ⇒ I<sub>G</sub> = 0. <b>Ngắt</b>: V<sub>GS</sub> < V<sub>th</sub>. <b>Triode</b> (V<sub>DS</sub> < V<sub>GS</sub>−V<sub>th</sub>): I<sub>D</sub> = β[(V<sub>GS</sub>−V<sub>th</sub>)V<sub>DS</sub> − V<sub>DS</sub>²/2]. <b>Bão hòa</b>: I<sub>D</sub> = (β/2)(V<sub>GS</sub>−V<sub>th</sub>)²(1+λV<sub>DS</sub>). Mô hình Shichman–Hodges (level 1).'
  });

  def('PMOS', {
    name: 'MOSFET kênh P', cat: 'semi', prefix: 'M', terms: FET_TERMS, termNames: ['G', 'D', 'S'], bbox: [-0.1, -2, 2.3, 2], paths: FET_PATHS, nonlinear: true,
    presets: PMOS_PRESETS, params: fetParamDefs(PMOS_PRESETS, 'BS250'),
    compile: (p) => ({ Vth: -(MS.parseSI(p.Vth) || -1), beta: MS.parseSI(p.beta) || 1e-3, lambda: MS.parseSI(p.lambda) || 0 }),
    value: (p) => (p.model !== 'custom' ? p.model.replace(/ \(.*\)/, '') : 'PMOS') + ` Vth=${p.Vth}V`,
    init(el) { el.s = {}; },
    caps: (el) => [[el.u[0], el.u[2], 10e-12], [el.u[0], el.u[1], 3e-12]],
    stamp(el, c) { stampFET(c, el.u[0], el.u[1], el.u[2], el.P, el.s, -1); },
    currents(el, x) { const st = fetState(x, el.u[0], el.u[1], el.u[2], el.P, -1); return [0, st.idD, -st.idD]; },
    info: (el, eng) => fetInfo(el, eng, -1, REG_MOS),
    draw: (g, el, o) => drawMOS(g, o, true),
    theory: 'MOSFET tăng cường kênh P: dẫn khi V<sub>GS</sub> < V<sub>th</sub> (V<sub>th</sub> âm, ví dụ −2 V), dòng đi từ S sang D. Thường mắc S lên nguồn dương (khóa phía cao, tầng kéo lên trong CMOS). Nhấn <b>F</b> để lật (S lên trên).'
  });

  /* ---------- JFET ---------- */
  const REG_JFET = ['Thắt kênh hoàn toàn (ngắt)', 'Vùng điện trở (ohmic)', 'Bão hòa (khuếch đại)'];
  const jfetParamDefs = (vp) => [
    { k: 'Idss', label: 'Dòng bão hòa I_DSS (V_GS=0)', unit: 'A', def: '10m' },
    { k: 'Vp', label: 'Điện áp thắt kênh V_P', unit: 'V', def: vp },
    { k: 'lambda', label: 'Điều chế kênh λ', unit: '1/V', def: '0.01' }
  ];
  function jfetCompile(p, pol) {
    const Idss = MS.parseSI(p.Idss) || 0.01;
    let Vp = MS.parseSI(p.Vp);
    if (!Vp) Vp = -3 * pol;
    const vp = pol * Vp; // âm trong hệ quy chiếu kênh N
    return { Vth: vp, beta: (2 * Idss) / (vp * vp), lambda: MS.parseSI(p.lambda) || 0, Idss, Vp, gate: diodeParams(1e-14, 1, 0) };
  }
  function drawJFET(g, o, pch) {
    line(g, [0, 0, 1, 0], o.col(0));
    if (pch) arrow(g, 0.95, 0, 0.3, 0, o.body, 0.38); else arrow(g, 0.2, 0, 0.92, 0, o.body, 0.38);
    line(g, [1, -0.9, 1, 0.9], o.body, 0.16);
    line(g, [1, -0.6, 2, -0.6, 2, -2], o.col(1));
    line(g, [1, 0.6, 2, 0.6, 2, 2], o.col(2));
  }
  function stampJFET(el, c, p) {
    const [g, d, s] = el.u;
    stampFET(c, g, d, s, el.P, el.s, p);
    if (p > 0) { stampDiode(c, g, s, el.P.gate, el.s, 'gs'); stampDiode(c, g, d, el.P.gate, el.s, 'gd'); }
    else { stampDiode(c, s, g, el.P.gate, el.s, 'gs'); stampDiode(c, d, g, el.P.gate, el.s, 'gd'); }
  }
  function jfetCurrents(el, x, p) {
    const [g, d, s] = el.u;
    const st = fetState(x, g, d, s, el.P, p);
    const igs = p * diodeEval(p * (X(x, g) - X(x, s)), el.P.gate).i;
    const igd = p * diodeEval(p * (X(x, g) - X(x, d)), el.P.gate).i;
    return [igs + igd, st.idD - igd, -st.idD - igs];
  }
  def('NJF', {
    name: 'JFET kênh N', cat: 'semi', prefix: 'J', terms: FET_TERMS, termNames: ['G', 'D', 'S'], bbox: [-0.1, -2, 2.3, 2], paths: [[0, [[0, 0], [1, 0]]]].concat(FET_PATHS), nonlinear: true,
    params: jfetParamDefs('-3'),
    compile: (p) => jfetCompile(p, 1),
    value: (p) => `I_DSS=${fmt(MS.parseSI(p.Idss), 'A')} Vp=${p.Vp}V`,
    init(el) { el.s = {}; },
    caps: (el) => [[el.u[0], el.u[2], 5e-12], [el.u[0], el.u[1], 2e-12]],
    stamp: (el, c) => stampJFET(el, c, 1),
    currents: (el, x) => jfetCurrents(el, x, 1),
    info: (el, eng) => fetInfo(el, eng, 1, REG_JFET),
    draw: (g, el, o) => drawJFET(g, o, false),
    theory: 'JFET kênh N là linh kiện <b>nghèo</b>: dẫn mạnh nhất khi V<sub>GS</sub> = 0 (I<sub>D</sub> = I<sub>DSS</sub>), V<sub>GS</sub> âm làm hẹp kênh, tắt hẳn khi V<sub>GS</sub> ≤ V<sub>P</sub>. Ở bão hòa: <b>I<sub>D</sub> = I<sub>DSS</sub>(1 − V<sub>GS</sub>/V<sub>P</sub>)²</b> (phương trình Shockley). Tiếp giáp G–kênh phải luôn phân cực ngược.'
  });
  def('PJF', {
    name: 'JFET kênh P', cat: 'semi', prefix: 'J', terms: FET_TERMS, termNames: ['G', 'D', 'S'], bbox: [-0.1, -2, 2.3, 2], paths: [[0, [[0, 0], [1, 0]]]].concat(FET_PATHS), nonlinear: true,
    params: jfetParamDefs('3'),
    compile: (p) => jfetCompile(p, -1),
    value: (p) => `I_DSS=${fmt(MS.parseSI(p.Idss), 'A')} Vp=${p.Vp}V`,
    init(el) { el.s = {}; },
    caps: (el) => [[el.u[0], el.u[2], 5e-12], [el.u[0], el.u[1], 2e-12]],
    stamp: (el, c) => stampJFET(el, c, -1),
    currents: (el, x) => jfetCurrents(el, x, -1),
    info: (el, eng) => fetInfo(el, eng, -1, REG_JFET),
    draw: (g, el, o) => drawJFET(g, o, true),
    theory: 'JFET kênh P: giống kênh N nhưng đảo cực tính — V<sub>P</sub> dương, V<sub>GS</sub> dương làm giảm dòng, dòng chảy từ S sang D.'
  });

  /* ---------- SCR (Thyristor) ---------- */
  def('SCR', {
    name: 'Thyristor (SCR)', cat: 'semi', prefix: 'SCR', terms: [[0, 0], [4, 0], [3, 2]], termNames: ['A', 'K', 'G'], bbox: [0, -0.8, 4, 2],
    paths: [[0, [[0, 0], [4, 0]]], [2, [[3, 2], [3, 0.8], [2.6, 0.3]]]], nonlinear: true, internal: 1,
    params: [
      { k: 'Rgk', label: 'Điện trở G–K nội (quyết định I_GT, I_H)', unit: 'Ω', def: '1k' },
      { k: 'bn', label: 'β transistor NPN nội', unit: '', def: '100' },
      { k: 'bp', label: 'β transistor PNP nội', unit: '', def: '2' }
    ],
    compile: (p) => ({ Rgk: Math.max(MS.parseSI(p.Rgk) || 1e3, 1), n: bjtParams(1e-14, MS.parseSI(p.bn) || 100, 1, 0), p: bjtParams(1e-14, MS.parseSI(p.bp) || 2, 1, 0) }),
    value: () => 'SCR',
    init(el) { el.s = { n: {}, p: {} }; },
    caps: (el) => [[el.u[2], el.u[1], 20e-12], [el.u[3], el.u[0], 20e-12], [el.u[3], el.u[2], 10e-12]],
    stamp(el, c) {
      const [a, k, g, n1] = el.u;
      stampBJT(c, n1, g, a, el.P.p, el.s.p, -1); // PNP: B=n1, C=G, E=A
      stampBJT(c, g, n1, k, el.P.n, el.s.n, 1); // NPN: B=G, C=n1, E=K
      c.G(g, k, 1 / el.P.Rgk);
    },
    currents(el, x) {
      const [a, k, g, n1] = el.u;
      const ip = bjtCurrents(x, n1, g, a, el.P.p, -1);
      const ia = ip[2];
      const igk = (X(x, g) - X(x, k)) / el.P.Rgk;
      const inn = bjtCurrents(x, g, n1, k, el.P.n, 1);
      return [ia, inn[2] - igk, -(ia + inn[2] - igk)];
    },
    info(el, eng) {
      const ic = el.def.currents(el, eng.x);
      const vak = X(eng.x, el.u[0]) - X(eng.x, el.u[1]);
      return [['V_AK', fmt(vak, 'V')], ['Dòng anode I_A', fmt(ic[0], 'A')], ['Dòng cổng I_G', fmt(ic[2], 'A')], ['Trạng thái', ic[0] > 1e-4 ? 'ĐANG DẪN (đã chốt)' : 'Khóa']];
    },
    draw(g, el, o) {
      diodeBody(g, o);
      line(g, [2.6, -0.6, 2.6, 0.6], o.body, 0.12);
      line(g, [2.6, 0.3, 3, 0.8, 3, 2], o.col(2));
    },
    theory: 'Thyristor (SCR) gồm 4 lớp p–n–p–n, tương đương một cặp transistor PNP–NPN hồi tiếp dương. Khi được <b>kích</b> bằng xung dòng vào cực G (I<sub>G</sub> > I<sub>GT</sub>), SCR chuyển sang dẫn và <b>tự giữ (chốt)</b> kể cả khi bỏ xung kích. SCR chỉ tắt khi dòng anode giảm dưới dòng duy trì I<sub>H</sub> (ví dụ ngắt mạch, hoặc nguồn AC đi qua 0).'
  });

  /* ===================== OP-AMP ===================== */
  const sp = (x) => (x > 30 ? x : Math.log1p(Math.exp(x)));
  const sig = (x) => 1 / (1 + Math.exp(-MS.clamp(x, -60, 60)));
  // Giới hạn mềm u trong [vn, vp] (độ cong w) — trả về [giá trị, đạo hàm]
  function softClamp(u, vn, vp, w) {
    const g1 = vn + w * sp((u - vn) / w), d1 = sig((u - vn) / w);
    return [vp - w * sp((vp - g1) / w), sig((vp - g1) / w) * d1];
  }
  const OPAMP_PRESETS = {
    'LM741': { A: '200k', gbw: '1Meg', vp: '13.5', vn: '-13.5', vos: '0' },
    'TL081': { A: '200k', gbw: '3Meg', vp: '13.5', vn: '-13.5', vos: '0' },
    'LM358 (nguồn đơn 5 V)': { A: '100k', gbw: '1Meg', vp: '3.5', vn: '0', vos: '0' },
    'Lý tưởng hoá': { A: '1Meg', gbw: '100Meg', vp: '14', vn: '-14', vos: '0' }
  };
  function opampU(el, vd, c) {
    const P = el.P;
    if (c.mode === 'dc') return [P.A * vd, P.A];
    const a = c.h * P.wp;
    return [(el.s.u + a * P.A * vd) / (1 + a), (a * P.A) / (1 + a)];
  }
  def('OPAMP', {
    name: 'Op-amp (KĐ thuật toán)', cat: 'digital', prefix: 'U', terms: [[0, -1], [0, 1], [4, 0]], termNames: ['−', '+', 'Ra'], bbox: [0, -2.1, 4, 2.1],
    paths: [[2, [[4, 0], [3.6, 0]]]], nonlinear: true, branches: 1, outTerm: 2, labelTop: true, implicitGround: true,
    presets: OPAMP_PRESETS,
    params: [
      { k: 'model', label: 'Mẫu linh kiện', type: 'sel', opts: Object.keys(OPAMP_PRESETS).map((k) => [k, k]).concat([['custom', 'Tùy chỉnh']]), def: 'LM741', preset: true },
      { k: 'A', label: 'Hệ số khuếch đại vòng hở A', unit: '', def: '200k' },
      { k: 'gbw', label: 'Tích độ lợi–băng thông GBW', unit: 'Hz', def: '1Meg' },
      { k: 'vp', label: 'Điện áp ra bão hòa dương +V_sat', unit: 'V', def: '13.5' },
      { k: 'vn', label: 'Điện áp ra bão hòa âm −V_sat', unit: 'V', def: '-13.5' },
      { k: 'vos', label: 'Điện áp lệch đầu vào V_os', unit: 'V', def: '0' }
    ],
    compile(p) {
      const A = Math.max(MS.parseSI(p.A) || 2e5, 1);
      const gbw = Math.max(MS.parseSI(p.gbw) || 1e6, 1);
      let vp = MS.parseSI(p.vp), vn = MS.parseSI(p.vn);
      if (!isFinite(vp)) vp = 13.5;
      if (!isFinite(vn)) vn = -13.5;
      if (vn > vp - 0.1) vn = vp - 0.1;
      return { A, wp: (2 * Math.PI * gbw) / A, vp, vn, vos: MS.parseSI(p.vos) || 0 };
    },
    value: (p) => (p.model !== 'custom' ? p.model.replace(/ \(.*\)/, '') : 'Op-amp'),
    init(el) { el.s.u = 0; },
    fromDC(el, x) { const P = el.P; el.s.u = MS.clamp(P.A * (X(x, el.u[1]) - X(x, el.u[0]) + P.vos), P.vn - 0.5, P.vp + 0.5); },
    stamp(el, c) {
      const [inn, inp, out] = el.u, br = el.br[0], P = el.P;
      const vd = c.v(inp) - c.v(inn) + P.vos;
      const [u, du] = opampU(el, vd, c);
      const [vo, dvo] = softClamp(u, P.vn, P.vp, 0.05);
      const g = dvo * du;
      c.a(out, br, 1);
      c.a(br, out, 1); c.a(br, inp, -g); c.a(br, inn, g);
      c.rhs(br, vo - g * (vd - P.vos));
    },
    accept(el, c) {
      const P = el.P;
      const vd = c.v(el.u[1]) - c.v(el.u[0]) + P.vos;
      el.s.u = MS.clamp(opampU(el, vd, c)[0], P.vn - 0.5, P.vp + 0.5);
    },
    currents(el, x) { return [0, 0, x[el.br[0]]]; },
    info(el, eng) {
      const x = eng.x, P = el.P;
      const vm = X(x, el.u[0]), vpl = X(x, el.u[1]), vo = X(x, el.u[2]);
      const st = vo > P.vp - 0.05 ? 'Bão hòa dương (+V_sat)' : vo < P.vn + 0.05 ? 'Bão hòa âm (−V_sat)' : 'Tuyến tính (V+ ≈ V−)';
      return [['V+ (không đảo)', fmt(vpl, 'V')], ['V− (đảo)', fmt(vm, 'V')], ['V_d = V+ − V−', fmt(vpl - vm, 'V')], ['V_ra', fmt(vo, 'V')], ['Dòng ra', fmt(-x[el.br[0]], 'A')], ['Trạng thái', st]];
    },
    draw(g, el, o) {
      line(g, [0, -1, 0.6, -1], o.col(0));
      line(g, [0, 1, 0.6, 1], o.col(1));
      line(g, [3.6, 0, 4, 0], o.col(2));
      g.beginPath(); g.moveTo(0.6, -2); g.lineTo(0.6, 2); g.lineTo(3.6, 0); g.closePath();
      g.fillStyle = o.fillBody; g.fill();
      g.strokeStyle = o.body; g.lineWidth = 0.1; g.stroke();
      textC(g, '−', 1.05, -1, o.body, 0.8);
      textC(g, '+', 1.05, 1, o.body, 0.8);
    },
    theory: 'Bộ khuếch đại thuật toán: <b>V<sub>ra</sub> = A·(V<sub>+</sub> − V<sub>−</sub>)</b>, giới hạn trong khoảng ±V<sub>sat</sub> (nguồn nuôi được ngầm định). Khi có <b>hồi tiếp âm</b>, op-amp tự điều chỉnh để <b>V<sub>+</sub> ≈ V<sub>−</sub></b> (ngắn mạch ảo) và dòng vào hai cực ≈ 0. Mạch đảo: A<sub>v</sub> = −R<sub>f</sub>/R<sub>1</sub>; không đảo: A<sub>v</sub> = 1 + R<sub>f</sub>/R<sub>1</sub>. Không có hồi tiếp (hoặc hồi tiếp dương) op-amp làm việc như <b>bộ so sánh</b>. Băng thông giới hạn bởi GBW: f<sub>c</sub> ≈ GBW/A<sub>v</sub>. Chân: − (trên), + (dưới); nhấn <b>F</b> để đổi chỗ.'
  });

  /* ===================== CỔNG LOGIC ===================== */
  const GATE_FN = {
    AND: (s) => [s[0] * s[1], [s[1], s[0]]],
    OR: (s) => [1 - (1 - s[0]) * (1 - s[1]), [1 - s[1], 1 - s[0]]],
    XOR: (s) => [s[0] + s[1] - 2 * s[0] * s[1], [1 - 2 * s[1], 1 - 2 * s[0]]],
    NAND: (s) => [1 - s[0] * s[1], [-s[1], -s[0]]],
    NOR: (s) => [(1 - s[0]) * (1 - s[1]), [-(1 - s[1]), -(1 - s[0])]],
    NOT: (s) => [1 - s[0], [-1]]
  };
  const GATE_INFO = {
    AND: ['Cổng AND', 'Y = A·B', 'Ra 1 chỉ khi <b>tất cả</b> đầu vào bằng 1.', ['0', '0', '0', '1']],
    OR: ['Cổng OR', 'Y = A + B', 'Ra 1 khi <b>có ít nhất một</b> đầu vào bằng 1.', ['0', '1', '1', '1']],
    XOR: ['Cổng XOR', 'Y = A ⊕ B', 'Ra 1 khi hai đầu vào <b>khác nhau</b> (cộng nhị phân không nhớ).', ['0', '1', '1', '0']],
    NAND: ['Cổng NAND', 'Y = (A·B)̅', 'Đảo của AND. Là cổng <b>vạn năng</b>: có thể ghép NAND để tạo mọi cổng khác.', ['1', '1', '1', '0']],
    NOR: ['Cổng NOR', 'Y = (A + B)̅', 'Đảo của OR; cũng là cổng vạn năng.', ['1', '0', '0', '0']],
    NOT: ['Cổng NOT (đảo)', 'Y = A̅', 'Đảo mức logic: 0 → 1, 1 → 0.', null]
  };
  function gateTheory(t) {
    const [, eq, txt, tt] = GATE_INFO[t];
    let h = `Biểu thức: <b>${eq}</b>. ${txt}`;
    if (tt) h += `<table class="tt"><tr><th>A</th><th>B</th><th>Y</th></tr>${[[0, 0], [0, 1], [1, 0], [1, 1]].map(([a, b], i) => `<tr><td>${a}</td><td>${b}</td><td>${tt[i]}</td></tr>`).join('')}</table>`;
    else h += '<table class="tt"><tr><th>A</th><th>Y</th></tr><tr><td>0</td><td>1</td></tr><tr><td>1</td><td>0</td></tr></table>';
    return h + 'Mô hình: đầu vào trở kháng cao, ngưỡng V<sub>H</sub>/2; đầu ra là nguồn áp 0/V<sub>H</sub> qua điện trở ra 50 Ω. Đầu vào để hở được coi là mức 0.';
  }
  function drawGateBody(g, o, t) {
    const orLike = t === 'OR' || t === 'NOR' || t === 'XOR';
    const bubble = t === 'NAND' || t === 'NOR';
    line(g, [0, -1, 0.8, -1], o.col(0));
    line(g, [0, 1, 0.8, 1], o.col(1));
    g.beginPath();
    if (orLike) {
      g.moveTo(0.6, -1.5); g.quadraticCurveTo(2.4, -1.5, 3.5, 0); g.quadraticCurveTo(2.4, 1.5, 0.6, 1.5); g.quadraticCurveTo(1.3, 0, 0.6, -1.5);
    } else {
      g.moveTo(0.8, -1.5); g.lineTo(2, -1.5); g.arc(2, 0, 1.5, -Math.PI / 2, Math.PI / 2); g.lineTo(0.8, 1.5); g.closePath();
    }
    g.fillStyle = o.fillBody; g.fill();
    g.strokeStyle = o.body; g.lineWidth = 0.1; g.stroke();
    if (t === 'XOR') { g.beginPath(); g.moveTo(0.25, 1.5); g.quadraticCurveTo(0.95, 0, 0.25, -1.5); g.stroke(); }
    if (bubble) { circle(g, 3.68, 0, 0.18, o.body, 0.08, o.fillBody); line(g, [3.86, 0, 4, 0], o.col(2)); }
    else line(g, [3.5, 0, 4, 0], o.col(2));
  }
  function gateDef(t) {
    const one = t === 'NOT';
    const nIn = one ? 1 : 2;
    const terms = one ? [[0, 0], [4, 0]] : [[0, -1], [0, 1], [4, 0]];
    const outIdx = nIn;
    def(t, {
      name: GATE_INFO[t][0], cat: 'digital', prefix: 'G', terms, termNames: one ? ['A', 'Y'] : ['A', 'B', 'Y'],
      bbox: one ? [0, -1.1, 4, 1.1] : [0, -1.6, 4, 1.6], paths: [[outIdx, [[4, 0], [3.4, 0]]]], nonlinear: true, outTerm: outIdx, labelTop: true, implicitGround: true,
      params: [{ k: 'VH', label: 'Mức logic cao V_H (nguồn nuôi)', unit: 'V', def: '5' }],
      compile: (p) => { const VH = MS.parseSI(p.VH) || 5; return { VH, w: VH / 60, R: 50 }; },
      value: (p) => (MS.parseSI(p.VH) !== 5 ? fmt(MS.parseSI(p.VH), 'V') : ''),
      caps: (el) => [[el.u[outIdx], -1, 10e-12]],
      stamp(el, c) {
        const P = el.P, o = el.u[outIdx];
        const vs = [], s = [], ds = [];
        for (let i = 0; i < nIn; i++) {
          vs.push(c.v(el.u[i]));
          const q = sig((vs[i] - P.VH / 2) / P.w);
          s.push(q); ds.push((q * (1 - q)) / P.w);
        }
        const [F, dF] = GATE_FN[t](s);
        const Vt = P.VH * F;
        const terms = [[1 / P.R, o, -1]];
        let Ic = -Vt / P.R;
        for (let i = 0; i < nIn; i++) {
          const k = P.VH * dF[i] * ds[i];
          terms.push([-k / P.R, el.u[i], -1]);
          Ic += (k * vs[i]) / P.R;
        }
        c.cur(o, Ic, terms);
      },
      currents(el, x) {
        const P = el.P, s = [];
        for (let i = 0; i < nIn; i++) s.push(sig((X(x, el.u[i]) - P.VH / 2) / P.w));
        const r = new Array(nIn + 1).fill(0);
        r[outIdx] = (X(x, el.u[outIdx]) - P.VH * GATE_FN[t](s)[0]) / P.R;
        return r;
      },
      info(el, eng) {
        const P = el.P, x = eng.x, lv = (v) => (v > P.VH / 2 ? '1' : '0');
        const r = [];
        for (let i = 0; i < nIn; i++) { const v = X(x, el.u[i]); r.push([`Vào ${'AB'[i]}`, `${fmt(v, 'V')} (mức ${lv(v)})`]); }
        const vo = X(x, el.u[outIdx]);
        r.push(['Ra Y', `${fmt(vo, 'V')} (mức ${lv(vo)})`]);
        return r;
      },
      draw(g, el, o) {
        if (one) {
          line(g, [0, 0, 1, 0], o.col(0));
          g.beginPath(); g.moveTo(1, -1); g.lineTo(1, 1); g.lineTo(3, 0); g.closePath();
          g.fillStyle = o.fillBody; g.fill(); g.strokeStyle = o.body; g.lineWidth = 0.1; g.stroke();
          circle(g, 3.18, 0, 0.18, o.body, 0.08, o.fillBody);
          line(g, [3.36, 0, 4, 0], o.col(1));
        } else drawGateBody(g, o, t);
      },
      theory: gateTheory(t)
    });
  }
  ['AND', 'OR', 'NAND', 'NOR', 'XOR', 'NOT'].forEach(gateDef);

  def('LOGICIN', {
    name: 'Đầu vào logic (công tắc 0/1)', cat: 'digital', prefix: 'IN', terms: [[0, 0]], bbox: [-2.5, -0.8, 0.2, 0.8], paths: [[0, [[0, 0], [-0.6, 0]]]],
    branches: 1, outTerm: 0, toggleKey: 'high', clickable: true, implicitGround: true,
    params: [{ k: 'high', label: 'Mức cao (1)', type: 'bool', def: false }, { k: 'VH', label: 'Điện áp mức 1', unit: 'V', def: '5' }],
    compile: (p) => ({ V: p.high ? MS.parseSI(p.VH) || 5 : 0 }),
    value: () => '',
    stamp(el, c) { c.V(el.br[0], el.u[0], -1, el.P.V * c.scale); },
    currents(el, x) { return [x[el.br[0]]]; },
    info: (el, eng) => [['Mức logic', el.P.V > 0 ? '1 (cao)' : '0 (thấp)'], ['Điện áp', fmt(X(eng.x, el.u[0]), 'V')]],
    draw(g, el, o) {
      const hi = el.comp ? !!el.comp.p.high : false;
      line(g, [-0.6, 0, 0, 0], o.col(0));
      g.fillStyle = hi ? '#2fbf6a' : o.fillBody;
      g.fillRect(-2.4, -0.7, 1.8, 1.4);
      g.strokeStyle = o.body; g.lineWidth = 0.1; g.strokeRect(-2.4, -0.7, 1.8, 1.4);
      textUp(g, el, hi ? '1' : '0', -1.5, 0.04, hi ? '#04140a' : o.body, 1);
    },
    theory: 'Nguồn tín hiệu logic: mức <b>1</b> = V<sub>H</sub> (mặc định 5 V), mức <b>0</b> = 0 V so với đất. <b>Nhấp vào ô để đổi 0/1.</b>'
  });

  def('LOGICOUT', {
    name: 'Đèn báo logic', cat: 'digital', prefix: 'OUT', terms: [[0, 0]], bbox: [-0.2, -0.8, 2.1, 0.8], paths: [], outTerm: 0, implicitGround: true,
    params: [{ k: 'VH', label: 'Mức logic cao V_H (ngưỡng = V_H/2)', unit: 'V', def: '5' }],
    compile: (p) => ({ VH: MS.parseSI(p.VH) || 5 }),
    value: () => '',
    stamp() {}, currents: () => [0],
    info: (el, eng) => { const v = X(eng.x, el.u[0]); return [['Điện áp', fmt(v, 'V')], ['Mức logic', v > el.P.VH / 2 ? '1 (cao)' : '0 (thấp)']]; },
    draw(g, el, o) {
      const v = o.volt ? o.volt(0) : 0;
      const VH = el.P ? el.P.VH : 5;
      const hi = v > VH / 2;
      line(g, [0, 0, 0.65, 0], o.col(0));
      if (hi) {
        const gr = g.createRadialGradient(1.35, 0, 0.1, 1.35, 0, 1.6);
        gr.addColorStop(0, 'rgba(255,69,58,0.8)'); gr.addColorStop(1, 'rgba(255,69,58,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(1.35, 0, 1.6, 0, Math.PI * 2); g.fill();
      }
      circle(g, 1.35, 0, 0.68, o.body, 0.1, hi ? '#ff453a' : o.fillBody);
      textUp(g, el, hi ? '1' : '0', 1.35, 0.04, hi ? '#fff' : o.body, 0.85);
    },
    theory: 'Đèn báo mức logic: sáng (1) khi điện áp vào lớn hơn V<sub>H</sub>/2, tắt (0) khi nhỏ hơn. Trở kháng vào vô cùng lớn.'
  });

  /* ===================== Danh mục cho bảng linh kiện ===================== */
  MS.CATEGORIES = [
    { id: 'basic', name: 'Cơ bản', items: ['GND', 'R', 'C', 'L', 'V', 'AC', 'I', 'SW', 'POT'] },
    { id: 'semi', name: 'Bán dẫn', items: ['D', 'DZ', 'DS', 'LED', 'NPN', 'PNP', 'NMOS', 'PMOS', 'NJF', 'PJF', 'SCR'] },
    { id: 'digital', name: 'Op-amp & Logic', items: ['OPAMP', 'NOT', 'AND', 'OR', 'NAND', 'NOR', 'XOR', 'LOGICIN', 'LOGICOUT'] },
    { id: 'meter', name: 'Đo lường', items: ['PROBE', 'VM', 'AM'] }
  ];

  // Tham số mặc định của một loại linh kiện
  MS.defaultParams = function (type) {
    const d = DEFS[type], p = {};
    for (const q of d.params) p[q.k] = q.def;
    return p;
  };

  MS.DEFS = DEFS;
  MS.VT = VT;
  MS.model = { diodeEval, bjtEval, fetEval, diodeParams, bjtParams };
})(typeof window !== 'undefined' ? window : globalThis);
