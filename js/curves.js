/* MachSim – trang vẽ đặc tuyến linh kiện bán dẫn (dùng chính lõi mô phỏng) */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  const fmt = (v, u) => MS.formatSI(v, u);
  const COLORS = ['#32d4ff', '#ffd60a', '#ff6bd6', '#7dff6b', '#ff9f40', '#b48cff', '#ff5a5a', '#5ad1a0'];

  /* ---------- Biểu mẫu tham số dùng chung (bảng thuộc tính + trang đặc tuyến) ---------- */
  MS.paramForm = function (box, def, p, onChange) {
    box.innerHTML = '';
    const presetParam = def.params.find((q) => q.preset);
    let presetSel = null;
    for (const q of def.params) {
      const row = document.createElement('label');
      row.className = 'field';
      const lab = document.createElement('span');
      lab.className = 'field-label';
      lab.textContent = q.label;
      row.appendChild(lab);
      let input;
      if (q.type === 'sel') {
        input = document.createElement('select');
        for (const [v, t] of q.opts) {
          const o = document.createElement('option');
          o.value = v; o.textContent = t;
          input.appendChild(o);
        }
        input.value = p[q.k];
        input.addEventListener('change', () => {
          p[q.k] = input.value;
          if (q.preset && def.presets && def.presets[input.value]) {
            Object.assign(p, def.presets[input.value]);
            MS.paramForm(box, def, p, onChange);
          }
          onChange(q.k);
        });
        if (q.preset) presetSel = input;
      } else if (q.type === 'bool') {
        row.classList.add('field-check');
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!p[q.k];
        input.addEventListener('change', () => { p[q.k] = input.checked; onChange(q.k); });
        row.insertBefore(input, lab);
      } else if (q.type === 'range') {
        const wrap = document.createElement('div');
        wrap.className = 'range-wrap';
        input = document.createElement('input');
        input.type = 'range'; input.min = 0; input.max = 1; input.step = 0.01;
        input.value = p[q.k];
        const val = document.createElement('output');
        val.textContent = Math.round(p[q.k] * 100) + '%';
        input.addEventListener('input', () => { p[q.k] = +input.value; val.textContent = Math.round(p[q.k] * 100) + '%'; onChange(q.k, true); });
        input.addEventListener('change', () => onChange(q.k));
        wrap.appendChild(input); wrap.appendChild(val);
        row.appendChild(wrap);
        box.appendChild(row);
        continue;
      } else {
        const wrap = document.createElement('div');
        wrap.className = 'num-wrap';
        input = document.createElement('input');
        input.type = 'text';
        input.inputMode = 'decimal';
        input.spellcheck = false;
        input.value = p[q.k];
        const apply = () => {
          const v = MS.parseSI(input.value);
          if (!isFinite(v)) { input.classList.add('bad'); return; }
          input.classList.remove('bad');
          if (String(p[q.k]) === input.value.trim()) return;
          p[q.k] = input.value.trim();
          if (presetParam && def.presets && q.k !== presetParam.k) {
            const pr = def.presets[p[presetParam.k]];
            if (pr && q.k in pr && MS.parseSI(pr[q.k]) !== v) {
              p[presetParam.k] = 'custom';
              if (presetSel) presetSel.value = 'custom';
            }
          }
          onChange(q.k);
        };
        input.addEventListener('change', apply);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { apply(); input.blur(); } e.stopPropagation(); });
        wrap.appendChild(input);
        if (q.unit) { const u = document.createElement('span'); u.className = 'unit'; u.textContent = q.unit; wrap.appendChild(u); }
        row.appendChild(wrap);
        box.appendChild(row);
        continue;
      }
      if (q.type !== 'bool') row.appendChild(input);
      box.appendChild(row);
    }
  };

  /* ---------- Tính toán đặc tuyến ---------- */
  function circuit(nNodes, list) {
    const els = list.map(([t, n, p]) => MS.makeElement(t, n, p));
    const eng = MS.assemble(els, nNodes);
    eng.reset();
    return { eng, els };
  }
  function setV(el, v) { el.P.V = v; }
  function setI(el, i) { el.P.I = i; }
  const pol = (type) => (/PNP|PMOS|PJF/.test(type) ? -1 : 1);

  function diodeIV(type, p, vmin, imax) {
    const { eng, els } = circuit(2, [['V', [1, 0], { V: 0 }], [type, [1, 0], p]]);
    const [src, d] = els;
    const fwd = [], rev = [];
    for (let k = 0; k <= 400; k++) {
      const v = (k / 400) * 6;
      setV(src, v);
      if (!eng.dcSolve()) break;
      const i = d.def.currents(d, eng.x)[0];
      fwd.push([v, i]);
      if (i > imax) break;
    }
    eng.x.fill(0);
    for (let k = 1; k <= 400; k++) {
      const v = (k / 400) * vmin;
      setV(src, v);
      if (!eng.dcSolve()) break;
      const i = d.def.currents(d, eng.x)[0];
      rev.push([v, i]);
      if (i < -imax) break;
    }
    return rev.reverse().concat(fwd);
  }

  function bjtOut(type, p, ibs, vmax) {
    const s = pol(type);
    const out = [];
    for (const ib of ibs) {
      const { eng, els } = circuit(3, [['V', [1, 0], { V: 0 }], ['I', s > 0 ? [0, 2] : [2, 0], { I: ib }], [type, [2, 1, 0], p]]);
      const [vs, , q] = els;
      const pts = [];
      for (let k = 0; k <= 200; k++) {
        const v = (k / 200) * vmax;
        setV(vs, s * v);
        if (!eng.dcSolve()) continue;
        pts.push([v, s * q.def.currents(q, eng.x)[1]]);
      }
      out.push(pts);
    }
    return out;
  }

  function bjtIn(type, p, vce, vmax) {
    const s = pol(type);
    const { eng, els } = circuit(3, [['V', [1, 0], { V: s * vce }], ['V', [2, 0], { V: 0 }], [type, [2, 1, 0], p]]);
    const [, vb, q] = els;
    const pts = [];
    for (let k = 0; k <= 300; k++) {
      const v = (k / 300) * vmax;
      setV(vb, s * v);
      if (!eng.dcSolve()) continue;
      pts.push([v, s * q.def.currents(q, eng.x)[0]]);
    }
    return pts;
  }

  function bjtQ(type, p, vcc, rc, ib) {
    const s = pol(type);
    const { eng, els } = circuit(4, [['V', [3, 0], { V: s * vcc }], ['R', [3, 1], { R: rc }], ['I', s > 0 ? [0, 2] : [2, 0], { I: ib }], [type, [2, 1, 0], p]]);
    if (!eng.dcOp(true)) return null;
    const q = els[3];
    return { v: s * eng.nodeV(1), i: s * q.def.currents(q, eng.x)[1] };
  }

  function fetOut(type, p, vgss, vmax) {
    const s = pol(type);
    const out = [];
    for (const vgs of vgss) {
      const { eng, els } = circuit(3, [['V', [1, 0], { V: 0 }], ['V', [2, 0], { V: vgs }], [type, [2, 1, 0], p]]);
      const [vd, , m] = els;
      const pts = [];
      for (let k = 0; k <= 200; k++) {
        const v = (k / 200) * vmax;
        setV(vd, s * v);
        if (!eng.dcSolve()) continue;
        pts.push([v, s * m.def.currents(m, eng.x)[1]]);
      }
      out.push(pts);
    }
    return out;
  }

  function fetTr(type, p, vds, a, b) {
    const s = pol(type);
    const { eng, els } = circuit(3, [['V', [1, 0], { V: s * vds }], ['V', [2, 0], { V: a }], [type, [2, 1, 0], p]]);
    const [, vg, m] = els;
    const pts = [];
    for (let k = 0; k <= 300; k++) {
      const v = a + ((b - a) * k) / 300;
      setV(vg, v);
      if (!eng.dcSolve()) continue;
      pts.push([v, s * m.def.currents(m, eng.x)[1]]);
    }
    return pts;
  }

  function fetQ(type, p, vdd, rd, vgs) {
    const s = pol(type);
    const { eng, els } = circuit(4, [['V', [3, 0], { V: s * vdd }], ['R', [3, 1], { R: rd }], ['V', [2, 0], { V: vgs }], [type, [2, 1, 0], p]]);
    if (!eng.dcOp(true)) return null;
    const m = els[3];
    return { v: s * eng.nodeV(1), i: s * m.def.currents(m, eng.x)[1] };
  }

  /* ---------- Giao diện ---------- */
  const DEVICES = ['D', 'DS', 'DZ', 'LED', 'NPN', 'PNP', 'NMOS', 'PMOS', 'NJF', 'PJF'];
  const PLOTS = {
    diode: [['iv', 'Đặc tuyến V–A (tuyến tính)'], ['log', 'Đặc tuyến V–A (thang log |I|)']],
    bjt: [['out', 'Đặc tuyến ra I_C – V_CE'], ['in', 'Đặc tuyến vào I_B – V_BE']],
    fet: [['out', 'Đặc tuyến ra I_D – V_DS'], ['tr', 'Đặc tuyến truyền đạt I_D – V_GS']]
  };
  const family = (t) => (/^(D|DS|DZ|LED)$/.test(t) ? 'diode' : /NPN|PNP/.test(t) ? 'bjt' : 'fet');

  function defaultSweep(type, p) {
    const f = family(type), s = pol(type);
    if (f === 'diode') {
      const bv = MS.parseSI(p.BV) || 0;
      return { vmin: type === 'DZ' ? -(bv + 2) : type === 'LED' ? -6 : -2, imax: '20m' };
    }
    if (f === 'bjt') return { start: '10u', step: '10u', count: 5, vmax: 10, vce: 5, vbe: 0.9, ll: true, vcc: 10, rc: '1k', q: '20u' };
    const P = MS.DEFS[type].compile(p);
    // chọn R_D để điểm Q nằm khoảng giữa đường tải
    const rdFor = (vdd, id) => { const r = vdd / 2 / Math.max(id, 1e-9); const e = Math.pow(10, Math.floor(Math.log10(r))); const f = r / e; return MS.formatSI((f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e, '').replace(/\s/g, ''); };
    if (/JF/.test(type)) {
      const vp = P.Vp, q = +(vp / 3).toPrecision(2);
      const id = P.Idss * Math.pow(1 - q / vp, 2);
      return { start: 0, step: +(vp / 5).toPrecision(2), count: 5, vmax: 10, vds: 10, ga: s > 0 ? vp : 0, gb: s > 0 ? 0 : vp, ll: true, vcc: 15, rc: rdFor(15, id), q };
    }
    const vth = MS.parseSI(p.Vth);
    const st = s * (Math.ceil(Math.abs(vth)) + 1);
    const vq = st + s, id = (P.beta / 2) * Math.pow(Math.abs(vq) - Math.abs(vth), 2);
    return { start: st, step: s * 1, count: 5, vmax: 10, vds: 10, ga: 0, gb: s * (Math.abs(vth) + 5), ll: true, vcc: 10, rc: rdFor(10, id), q: vq };
  }

  const THEORY = {
    diode: {
      iv: 'Đặc tuyến V–A cho thấy diode gần như không dẫn khi phân cực ngược (dòng rò ~ I<sub>S</sub>), bắt đầu dẫn mạnh khi điện áp thuận vượt ngưỡng (Si ≈ 0,6–0,7 V; Schottky ≈ 0,3 V; LED 1,8–3 V) và dòng tăng theo hàm mũ. Với Zener, khi điện áp ngược đạt V<sub>Z</sub>, dòng ngược tăng đột ngột trong khi điện áp gần như không đổi.',
      log: 'Trên thang log, đoạn dẫn thuận là một đường gần thẳng: dòng tăng 10 lần sau mỗi khoảng n·V<sub>T</sub>·ln10 ≈ n·60 mV. Độ dốc này cho phép xác định hệ số lý tưởng n; điểm cắt trục dòng (ngoại suy về V = 0) là I<sub>S</sub>.'
    },
    bjt: {
      out: 'Họ đặc tuyến ra I<sub>C</sub>(V<sub>CE</sub>) với I<sub>B</sub> là tham số. <b>Vùng bão hòa</b>: V<sub>CE</sub> nhỏ (< ~0,3 V), I<sub>C</sub> tăng nhanh theo V<sub>CE</sub>. <b>Vùng khuếch đại</b>: các đường gần nằm ngang, I<sub>C</sub> ≈ β·I<sub>B</sub>; độ nghiêng nhẹ là do hiệu ứng Early (các đường kéo dài cắt trục V<sub>CE</sub> tại −V<sub>A</sub>). <b>Đường tải tĩnh</b> I<sub>C</sub> = (V<sub>CC</sub> − V<sub>CE</sub>)/R<sub>C</sub>; giao điểm với đặc tuyến ứng với I<sub>B</sub> phân cực là <b>điểm làm việc Q</b>.',
      in: 'Đặc tuyến vào I<sub>B</sub>(V<sub>BE</sub>) giống đặc tuyến của một diode: transistor Si bắt đầu dẫn khi V<sub>BE</sub> ≈ 0,6–0,7 V. Điện trở vào động r<sub>π</sub> = β/g<sub>m</sub> = β·V<sub>T</sub>/I<sub>C</sub>.'
    },
    fet: {
      out: 'Họ đặc tuyến ra I<sub>D</sub>(V<sub>DS</sub>) với V<sub>GS</sub> là tham số. Đường nét đứt V<sub>DS</sub> = V<sub>GS</sub> − V<sub>th</sub> chia hai vùng: bên trái là <b>vùng tuyến tính/triode</b> (FET như điện trở điều khiển bằng điện áp), bên phải là <b>vùng bão hòa</b> (nguồn dòng, dùng để khuếch đại): I<sub>D</sub> ≈ (β/2)(V<sub>GS</sub> − V<sub>th</sub>)². Với JFET, V<sub>th</sub> chính là điện áp thắt kênh V<sub>P</sub>.',
      tr: 'Đặc tuyến truyền đạt I<sub>D</sub>(V<sub>GS</sub>) ở vùng bão hòa có dạng parabol. MOSFET tăng cường chỉ dẫn khi |V<sub>GS</sub>| > |V<sub>th</sub>|; JFET (nghèo) dẫn mạnh nhất tại V<sub>GS</sub> = 0 (I<sub>D</sub> = I<sub>DSS</sub>) và tắt tại V<sub>GS</sub> = V<sub>P</sub>. Độ dốc của đường cong là hỗ dẫn g<sub>m</sub> = dI<sub>D</sub>/dV<sub>GS</sub>.'
    }
  };

  MS.initCurves = function (side, canvas, info) {
    const plot = new MS.Plot(canvas);
    const st = { type: 'NPN', p: MS.defaultParams('NPN'), plot: 'out' };
    st.sw = defaultSweep(st.type, st.p);

    function field(parent, label, value, onSet, opts) {
      const row = document.createElement('label');
      row.className = 'field';
      row.innerHTML = `<span class="field-label">${label}</span>`;
      if (opts && opts.check) {
        row.classList.add('field-check');
        const c = document.createElement('input');
        c.type = 'checkbox'; c.checked = !!value;
        c.addEventListener('change', () => onSet(c.checked));
        row.insertBefore(c, row.firstChild);
      } else {
        const wrap = document.createElement('div');
        wrap.className = 'num-wrap';
        const i = document.createElement('input');
        i.type = 'text'; i.value = value; i.spellcheck = false;
        i.addEventListener('change', () => {
          const v = MS.parseSI(i.value);
          if (!isFinite(v)) { i.classList.add('bad'); return; }
          i.classList.remove('bad');
          onSet(i.value);
        });
        i.addEventListener('keydown', (e) => e.stopPropagation());
        wrap.appendChild(i);
        if (opts && opts.unit) { const u = document.createElement('span'); u.className = 'unit'; u.textContent = opts.unit; wrap.appendChild(u); }
        row.appendChild(wrap);
      }
      parent.appendChild(row);
    }

    function section(title) {
      const s = document.createElement('div');
      s.className = 'side-section';
      s.innerHTML = `<h3>${title}</h3>`;
      side.appendChild(s);
      return s;
    }

    function build() {
      side.innerHTML = '';
      const s1 = section('Linh kiện');
      const sel = document.createElement('select');
      for (const t of DEVICES) { const o = document.createElement('option'); o.value = t; o.textContent = MS.DEFS[t].name; sel.appendChild(o); }
      sel.value = st.type;
      sel.addEventListener('change', () => {
        st.type = sel.value;
        st.p = MS.defaultParams(st.type);
        st.plot = PLOTS[family(st.type)][0][0];
        st.sw = defaultSweep(st.type, st.p);
        build();
      });
      const row = document.createElement('label'); row.className = 'field';
      row.innerHTML = '<span class="field-label">Loại linh kiện</span>';
      row.appendChild(sel); s1.appendChild(row);
      const pbox = document.createElement('div');
      s1.appendChild(pbox);
      MS.paramForm(pbox, MS.DEFS[st.type], st.p, (k) => {
        if (k === 'model' || k === 'Vth' || k === 'Vp' || k === 'BV') { st.sw = defaultSweep(st.type, st.p); build(); }
        else compute();
      });

      const fam = family(st.type);
      const s2 = section('Đồ thị');
      const ps = document.createElement('select');
      for (const [v, t] of PLOTS[fam]) { const o = document.createElement('option'); o.value = v; o.textContent = t; ps.appendChild(o); }
      ps.value = st.plot;
      ps.addEventListener('change', () => { st.plot = ps.value; build(); });
      const r2 = document.createElement('label'); r2.className = 'field';
      r2.innerHTML = '<span class="field-label">Loại đồ thị</span>';
      r2.appendChild(ps); s2.appendChild(r2);

      const sw = st.sw, set = (k) => (v) => { sw[k] = v; compute(); };
      const P = pol(st.type) < 0;
      if (fam === 'diode') {
        field(s2, 'Điện áp ngược nhỏ nhất', sw.vmin, set('vmin'), { unit: 'V' });
        field(s2, 'Dòng tối đa hiển thị', sw.imax, set('imax'), { unit: 'A' });
      } else if (fam === 'bjt') {
        if (st.plot === 'out') {
          field(s2, `I_B bắt đầu${P ? ' (ra khỏi cực B)' : ''}`, sw.start, set('start'), { unit: 'A' });
          field(s2, 'Bước tăng I_B', sw.step, set('step'), { unit: 'A' });
          field(s2, 'Số đường cong', sw.count, set('count'));
          field(s2, `${P ? '|V_CE|' : 'V_CE'} tối đa`, sw.vmax, set('vmax'), { unit: 'V' });
          const s3 = section('Đường tải & điểm Q');
          field(s3, 'Vẽ đường tải tĩnh', sw.ll, set('ll'), { check: true });
          field(s3, `${P ? '|V_CC|' : 'V_CC'}`, sw.vcc, set('vcc'), { unit: 'V' });
          field(s3, 'R_C', sw.rc, set('rc'), { unit: 'Ω' });
          field(s3, 'I_B phân cực (điểm Q)', sw.q, set('q'), { unit: 'A' });
        } else {
          field(s2, `${P ? '|V_CE|' : 'V_CE'} cố định`, sw.vce, set('vce'), { unit: 'V' });
          field(s2, `${P ? '|V_BE|' : 'V_BE'} tối đa`, sw.vbe, set('vbe'), { unit: 'V' });
        }
      } else {
        if (st.plot === 'out') {
          field(s2, 'V_GS bắt đầu', sw.start, set('start'), { unit: 'V' });
          field(s2, 'Bước V_GS', sw.step, set('step'), { unit: 'V' });
          field(s2, 'Số đường cong', sw.count, set('count'));
          field(s2, `${P ? '|V_DS|' : 'V_DS'} tối đa`, sw.vmax, set('vmax'), { unit: 'V' });
          const s3 = section('Đường tải & điểm Q');
          field(s3, 'Vẽ đường tải tĩnh', sw.ll, set('ll'), { check: true });
          field(s3, `${P ? '|V_DD|' : 'V_DD'}`, sw.vcc, set('vcc'), { unit: 'V' });
          field(s3, 'R_D', sw.rc, set('rc'), { unit: 'Ω' });
          field(s3, 'V_GS phân cực (điểm Q)', sw.q, set('q'), { unit: 'V' });
        } else {
          field(s2, `${P ? '|V_DS|' : 'V_DS'} cố định`, sw.vds, set('vds'), { unit: 'V' });
          field(s2, 'V_GS từ', sw.ga, set('ga'), { unit: 'V' });
          field(s2, 'V_GS đến', sw.gb, set('gb'), { unit: 'V' });
        }
      }
      const th = document.createElement('div');
      th.className = 'theory';
      th.innerHTML = '<h3>Lý thuyết linh kiện</h3>' + (MS.DEFS[st.type].theory || '');
      side.appendChild(th);
      compute();
    }

    function compute() {
      const t = st.type, p = st.p, sw = st.sw, fam = family(t), N = MS.parseSI;
      const P = pol(t) < 0;
      let o, notes = [];
      try {
        if (fam === 'diode') {
          const imax = Math.abs(N(sw.imax)) || 0.02;
          const pts = diodeIV(t, p, Math.min(N(sw.vmin), -0.1), imax);
          const log = st.plot === 'log';
          o = { series: [{ pts: log ? pts.filter((q) => Math.abs(q[1]) > 1e-15) : pts, color: COLORS[0], label: MS.DEFS[t].name }], xLabel: 'Điện áp V_D (V)', yLabel: log ? '|I_D| (A)' : 'Dòng I_D (A)', xUnit: 'V', yUnit: 'A', xName: 'V', yName: 'I', yLog: log, yRange: log ? null : [pts.some((q) => q[1] < -imax * 0.15) ? -imax * 1.05 : -imax * 0.15, imax * 1.05] };
          for (const target of [1e-3, 10e-3]) {
            const q = pts.find((r) => r[1] >= target);
            if (q) notes.push(`V<sub>D</sub> tại I = ${fmt(target, 'A')}: <b>${fmt(q[0], 'V')}</b>`);
          }
          const bv = MS.parseSI(p.BV) || 0;
          if (bv > 0 && Math.abs(N(sw.vmin)) > bv) notes.push(`Điện áp đánh thủng V<sub>BR</sub> ≈ <b>${fmt(-bv, 'V')}</b>`);
          if (log) notes.push(`Độ dốc lý thuyết: 1 decade / ${fmt((MS.parseSI(p.n) || 2) * MS.VT * Math.LN10, 'V')}`);
        } else if (fam === 'bjt' && st.plot === 'out') {
          const count = MS.clamp(Math.round(N(sw.count)) || 5, 1, 10);
          const ibs = Array.from({ length: count }, (_, k) => N(sw.start) + k * N(sw.step));
          const vmax = Math.abs(N(sw.vmax)) || 10;
          const curves = bjtOut(t, p, ibs, vmax);
          o = { series: curves.map((pts, k) => ({ pts, color: COLORS[k % COLORS.length], label: `I_B = ${fmt(ibs[k], 'A')}` })), xLabel: `${P ? '|V_CE|' : 'V_CE'} (V)`, yLabel: `${P ? '|I_C|' : 'I_C'} (A)`, xUnit: 'V', yUnit: 'A', xName: 'V_CE', yName: 'I_C', xRange: [0, vmax], legendRight: true };
          const mid = curves[Math.floor(count / 2)];
          const c5 = mid && mid.find((q) => q[0] >= vmax / 2);
          if (c5) notes.push(`Tại V<sub>CE</sub> = ${fmt(c5[0], 'V')}, I<sub>B</sub> = ${fmt(ibs[Math.floor(count / 2)], 'A')}: I<sub>C</sub> = ${fmt(c5[1], 'A')} ⇒ β ≈ <b>${(c5[1] / ibs[Math.floor(count / 2)]).toFixed(0)}</b>`);
          if (sw.ll) {
            const vcc = Math.abs(N(sw.vcc)), rc = Math.abs(N(sw.rc));
            o.series.push({ pts: [[0, vcc / rc], [vcc, 0]], color: MS.cssVar('--text', '#e6edf3'), dash: [6, 5], label: `Đường tải (V_CC=${fmt(vcc, 'V')}, R_C=${fmt(rc, 'Ω')})`, noHover: true });
            const Q = bjtQ(t, p, vcc, rc, N(sw.q));
            if (Q) {
              o.markers = [{ x: Q.v, y: Q.i, color: '#ff453a', label: 'Q' }];
              o.series.push({ pts: bjtOut(t, p, [N(sw.q)], vmax)[0], color: '#ff453a', width: 1.5, label: `I_BQ = ${fmt(N(sw.q), 'A')}` });
              const reg = Q.v < 0.3 ? 'bão hòa' : Q.i < 1e-7 ? 'tắt' : 'khuếch đại';
              notes.push(`Điểm Q: V<sub>CEQ</sub> = <b>${fmt(Q.v, 'V')}</b>, I<sub>CQ</sub> = <b>${fmt(Q.i, 'A')}</b> (vùng ${reg})`);
              notes.push(`Biên độ ra tối đa không méo ≈ ${fmt(Math.min(Q.v - 0.2, vcc - Q.v), 'V')} (giới hạn bởi bão hòa / tắt)`);
            }
          }
        } else if (fam === 'bjt') {
          const vmax = Math.abs(N(sw.vbe)) || 0.9;
          const pts = bjtIn(t, p, Math.abs(N(sw.vce)), vmax);
          o = { series: [{ pts, color: COLORS[0], label: `V_CE = ${fmt(Math.abs(N(sw.vce)), 'V')}` }], xLabel: `${P ? '|V_BE|' : 'V_BE'} (V)`, yLabel: `${P ? '|I_B|' : 'I_B'} (A)`, xUnit: 'V', yUnit: 'A', xName: 'V_BE', yName: 'I_B', xRange: [0, vmax] };
          const q = pts.find((r) => r[1] >= 10e-6);
          if (q) notes.push(`V<sub>BE</sub> tại I<sub>B</sub> = 10 µA: <b>${fmt(q[0], 'V')}</b>`);
        } else if (st.plot === 'out') {
          const count = MS.clamp(Math.round(N(sw.count)) || 5, 1, 10);
          const vgss = Array.from({ length: count }, (_, k) => +(N(sw.start) + k * N(sw.step)).toPrecision(6));
          const vmax = Math.abs(N(sw.vmax)) || 10;
          const curves = fetOut(t, p, vgss, vmax);
          o = { series: curves.map((pts, k) => ({ pts, color: COLORS[k % COLORS.length], label: `V_GS = ${fmt(vgss[k], 'V')}` })), xLabel: `${P ? '|V_DS|' : 'V_DS'} (V)`, yLabel: `${P ? '|I_D|' : 'I_D'} (A)`, xUnit: 'V', yUnit: 'A', xName: 'V_DS', yName: 'I_D', xRange: [0, vmax], legendRight: true };
          const PP = MS.DEFS[t].compile(p);
          const bpts = [];
          for (let k = 0; k <= 100; k++) { const v = (k / 100) * vmax; bpts.push([v, (PP.beta / 2) * v * v * (1 + PP.lambda * v)]); }
          const ymax = Math.max(...curves.flat().map((q) => q[1]), 1e-12);
          o.series.push({ pts: bpts.filter((q) => q[1] <= ymax * 1.1), color: '#9aa4b2', dash: [3, 4], label: 'Ranh giới V_DS = V_GS − V_th', noHover: true });
          if (sw.ll) {
            const vcc = Math.abs(N(sw.vcc)), rc = Math.abs(N(sw.rc));
            o.series.push({ pts: [[0, vcc / rc], [vcc, 0]], color: MS.cssVar('--text', '#e6edf3'), dash: [6, 5], label: `Đường tải (V_DD=${fmt(vcc, 'V')}, R_D=${fmt(rc, 'Ω')})`, noHover: true });
            o.yRange = [0, Math.max(ymax, 1e-12) * 1.08];
            const Q = fetQ(t, p, vcc, rc, N(sw.q));
            if (Q) {
              o.markers = [{ x: Q.v, y: Q.i, color: '#ff453a', label: 'Q' }];
              o.series.push({ pts: fetOut(t, p, [N(sw.q)], vmax)[0], color: '#ff453a', width: 1.5, label: `V_GSQ = ${fmt(N(sw.q), 'V')}` });
              notes.push(`Điểm Q: V<sub>DSQ</sub> = <b>${fmt(Q.v, 'V')}</b>, I<sub>DQ</sub> = <b>${fmt(Q.i, 'A')}</b>`);
            }
          }
          notes.push(`β = ${fmt(PP.beta, 'A/V²')}, V<sub>th</sub> (hệ quy chiếu kênh N) = ${fmt(PP.Vth, 'V')}`);
        } else {
          const a = N(sw.ga), b = N(sw.gb);
          const pts = fetTr(t, p, Math.abs(N(sw.vds)), a, b);
          o = { series: [{ pts, color: COLORS[0], label: `|V_DS| = ${fmt(Math.abs(N(sw.vds)), 'V')}` }], xLabel: 'V_GS (V)', yLabel: `${P ? '|I_D|' : 'I_D'} (A)`, xUnit: 'V', yUnit: 'A', xName: 'V_GS', yName: 'I_D', xRange: [Math.min(a, b), Math.max(a, b)] };
          if (/JF/.test(t)) {
            const z = pts.reduce((m, q) => (Math.abs(q[0]) < Math.abs(m[0]) ? q : m), pts[0]);
            if (z) notes.push(`I<sub>D</sub> tại V<sub>GS</sub> = 0 (≈ I<sub>DSS</sub>): <b>${fmt(z[1], 'A')}</b>`);
          }
        }
      } catch (err) {
        console.error(err);
        notes.push('Lỗi khi tính: ' + err.message);
      }
      if (o) plot.set(o);
      info.innerHTML = (notes.length ? '<ul class="notes">' + notes.map((n) => `<li>${n}</li>`).join('') + '</ul>' : '') + `<p>${THEORY[fam][st.plot] || ''}</p>`;
    }

    build();
    return { redraw: () => plot.draw() };
  };
})(typeof window !== 'undefined' ? window : globalThis);
