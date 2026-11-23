// Kiểm tra lõi mô phỏng & các mạch ví dụ bằng Node: node tools/test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
for (const f of ['util', 'engine', 'components', 'netlist', 'examples']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), { filename: f + '.js' });
}
const MS = globalThis.MS;
let fail = 0;
const ok = (cond, msg) => { if (!cond) { fail++; console.log('  ✗ ' + msg); } };
const fmt = MS.formatSI;

function run(e) {
  const circ = MS.buildExample(e);
  const net = MS.buildNetlist(circ);
  const eng = net.engine;
  console.log(`\n▶ ${e.name}  (${net.nNodes} nút, ${eng.size} ẩn)`);
  ok(net.unconnected.length === 0, 'cực chưa nối: ' + net.unconnected.map((p) => p.k).join(' '));
  ok(!net.groundAuto, 'không có GND');
  const s = circ.sim;
  if (s.dcStart) ok(eng.initFromDC(), 'DC op không hội tụ: ' + eng.error);
  const T = Math.min(s.window * 2, s.speed * 3);
  const steps = Math.ceil(T / s.dt);
  let okRun = true;
  for (let i = 0; i < steps; i++) if (!eng.step(s.dt)) { okRun = false; console.log('  lỗi tại t=' + eng.t + ' ' + eng.error); break; }
  ok(okRun, 'mô phỏng quá độ thất bại');
  const byName = (n) => circ.comps.find((c) => c.name === n);
  const rep = [];
  for (const c of circ.comps) {
    const el = c._el;
    if (c.type === 'VM' || c.type === 'AM') rep.push(`${c.name}=${fmt(el.def.reading(el, eng), c.type === 'VM' ? 'V' : 'A')}`);
    if (c.type === 'PROBE') rep.push(`${c.name}=${fmt(eng.nodeV(el.n[0]), 'V')}`);
    if (el.def.info && /NPN|PNP|NMOS|PMOS|NJF|PJF|SCR|LED/.test(c.type)) {
      const inf = el.def.info(el, eng);
      const st = inf.find((r) => /Vùng|Trạng thái/.test(r[0]));
      rep.push(`${c.name}[${st ? st[1] : ''}]`);
    }
  }
  console.log('  t=' + fmt(eng.t, 's') + '  ' + rep.join('  '));
  return { circ, eng, byName };
}

for (const e of MS.EXAMPLES) {
  try { run(e); } catch (err) { fail++; console.log('  ✗ ngoại lệ: ' + err.stack); }
}

// Kiểm tra một số giá trị lý thuyết
(function () {
  const e = MS.EXAMPLES.find((x) => x.id === 'diode-basic');
  const { circ, eng } = run(e);
  const vd = circ.comps.find((c) => c.name === 'VD')._el;
  const v = vd.def.reading(vd, eng);
  ok(v > 0.55 && v < 0.75, 'Vd diode ~0.65V, nhận ' + v);
})();

// Kiểm tra hành vi động
function setup(id) {
  const e = MS.EXAMPLES.find((x) => x.id === id);
  const circ = MS.buildExample(e);
  const net = MS.buildNetlist(circ);
  const eng = net.engine;
  if (circ.sim.dcStart) eng.initFromDC();
  const C = (n) => circ.comps.find((c) => c.name === n);
  const V = (n) => eng.nodeV(C(n)._el.n[0]);
  const I = (n) => C(n)._el.def.currents(C(n)._el, eng.x)[0];
  const runTo = (T, cb) => { while (eng.t < T) { if (!eng.step(circ.sim.dt)) throw new Error('fail ' + eng.error); cb && cb(); } };
  const toggle = (n, v) => { C(n).p.closed = v; C(n)._el.P = C(n)._el.def.compile(C(n).p); };
  return { circ, eng, C, V, I, runTo, toggle };
}
function pp(fn, T0, T1, s) { let mn = 1e9, mx = -1e9; s.runTo(T0); s.runTo(T1, () => { const v = fn(); mn = Math.min(mn, v); mx = Math.max(mx, v); }); return [mn, mx]; }

console.log('\n— Kiểm tra hành vi —');
{
  const s = setup('ce-amp');
  const [mn, mx] = pp(() => s.V('Ra'), 0.004, 0.006, s);
  console.log('CE: Vout p-p =', fmt(mx - mn, 'V'));
  ok(mx - mn > 2.5 && mx - mn < 5, 'CE gain sai');
}
{
  const s = setup('jfet-amp');
  const [mn, mx] = pp(() => s.V('Ra'), 0.004, 0.006, s);
  console.log('JFET: Vout p-p =', fmt(mx - mn, 'V'));
  ok(mx - mn > 0.8 && mx - mn < 2, 'JFET gain sai');
}
{
  const s = setup('astable');
  let last = null, flips = 0;
  s.runTo(4, () => { const on = s.I('LED1') > 5e-3; if (last !== null && on !== last) flips++; last = on; });
  console.log('Đa hài: số lần LED1 đổi trạng thái trong 4 s =', flips);
  ok(flips >= 6 && flips <= 20, 'đa hài không dao động đúng');
}
{
  const s = setup('bridge');
  const [a, b] = pp(() => s.V('Ra'), 0.02, 0.04, s);
  console.log('Cầu (không tụ): Vout', fmt(a, 'V'), '…', fmt(b, 'V'));
  ok(a < 0.5 && b > 10 && b < 11.5, 'chỉnh lưu cầu sai');
  s.toggle('SW1', true);
  const [c, d] = pp(() => s.V('Ra'), 0.3, 0.34, s);
  console.log('Cầu (có tụ): Vout', fmt(c, 'V'), '…', fmt(d, 'V'));
  ok(c > 9.5 && d - c < 0.5, 'tụ lọc sai');
}
{
  const s = setup('scr-latch');
  s.runTo(0.01); const i0 = s.I('LED1');
  s.toggle('SW2', true); s.runTo(0.02); const i1 = s.I('LED1');
  s.toggle('SW2', false); s.runTo(0.03); const i2 = s.I('LED1');
  s.toggle('SW1', false); s.runTo(0.04); s.toggle('SW1', true); s.runTo(0.05); const i3 = s.I('LED1');
  console.log('SCR: I_LED', [i0, i1, i2, i3].map((v) => fmt(v, 'A')).join(' → '));
  ok(i0 < 1e-4 && i1 > 5e-3 && i2 > 5e-3 && i3 < 1e-4, 'SCR không chốt đúng');
}
{
  const s = setup('bjt-switch');
  s.runTo(0.005); const a = s.I('LED1');
  s.toggle('SW1', true); s.runTo(0.01); const b = s.I('LED1');
  console.log('BJT khóa: I_LED', fmt(a, 'A'), '→', fmt(b, 'A'));
  ok(a < 1e-5 && b > 0.01, 'BJT khóa sai');
}
{
  const s = setup('mos-switch');
  s.runTo(0.25); const a = s.V('VD');
  s.runTo(0.75); const b = s.V('VD');
  console.log('MOS khóa: VD (G cao)', fmt(a, 'V'), ' VD (G thấp)', fmt(b, 'V'));
  ok(a < 1 && b > 8, 'MOS khóa sai');
}
{
  const s = setup('cmos-inv');
  let lo = null, hi = null;
  s.runTo(0.03, () => { const vi = s.V('Vào'); if (vi < 0.5) lo = s.V('Ra'); if (vi > 4.5) hi = s.V('Ra'); });
  console.log('CMOS: Vin thấp → Vout', fmt(lo, 'V'), '; Vin cao → Vout', fmt(hi, 'V'));
  ok(lo > 4.9 && hi < 0.1, 'CMOS sai');
}
{
  const s = setup('doubler');
  s.runTo(0.08);
  console.log('Nhân đôi: Vout', fmt(s.V('Ra'), 'V'));
  ok(s.V('Ra') > 17, 'nhân áp sai');
}
{
  const s = setup('clipper');
  const [a, b] = pp(() => s.V('Ra'), 0.001, 0.003, s);
  console.log('Xén:', fmt(a, 'V'), '…', fmt(b, 'V'));
  ok(a > -0.85 && a < -0.5 && b < 0.85 && b > 0.5, 'xén sai');
}

{
  const s = setup('opamp-inv');
  const [a, b] = pp(() => s.V('Ra'), 0.002, 0.004, s);
  console.log('KĐ đảo: Vout', fmt(a, 'V'), '…', fmt(b, 'V'));
  ok(Math.abs(b - 10) < 0.3 && Math.abs(a + 10) < 0.3, 'KĐ đảo sai');
}
{
  const s = setup('opamp-noninv');
  const [a, b] = pp(() => s.V('Ra'), 0.002, 0.004, s);
  console.log('KĐ không đảo: Vout', fmt(a, 'V'), '…', fmt(b, 'V'));
  ok(Math.abs(b - 5.5) < 0.2, 'KĐ không đảo sai');
}
{
  const s = setup('schmitt');
  let up = null, dn = null, last = null;
  s.runTo(0.04, () => { const vo = s.V('Ra'), vi = s.V('Vào'); if (last !== null) { if (last > 0 && vo < 0) dn = vi; if (last < 0 && vo > 0) up = vi; } last = vo; });
  console.log('Schmitt: ngưỡng lật xuống', fmt(dn, 'V'), ', lật lên', fmt(up, 'V'));
  ok(dn > 6 && dn < 7.5 && up < -6 && up > -7.5, 'Schmitt sai');
}
{
  const s = setup('integrator');
  const [a, b] = pp(() => s.V('Ra'), 0.05, 0.052, s);
  console.log('Tích phân: Vout', fmt(a, 'V'), '…', fmt(b, 'V'));
  ok(b - a > 4 && b - a < 6, 'tích phân sai');
}
{
  const s = setup('opamp-astable');
  let last = null, flips = 0;
  s.runTo(0.012, () => { const v = s.V('Ra'); if (last !== null && Math.sign(v) !== Math.sign(last)) flips++; last = v; });
  console.log('Op-amp đa hài: số lần lật trong 12 ms =', flips, '(f ≈', (flips / 2 / 0.012).toFixed(0), 'Hz)');
  ok(flips >= 8 && flips <= 14, 'op-amp đa hài sai');
}
{
  const s = setup('gates');
  const lv = (n) => (s.V(n) > 2.5 ? 1 : 0);
  const res = [];
  for (const [a, b] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
    s.C('A').p.high = !!a; s.C('A')._el.P = s.C('A')._el.def.compile(s.C('A').p);
    s.C('B').p.high = !!b; s.C('B')._el.P = s.C('B')._el.def.compile(s.C('B').p);
    s.runTo(s.eng.t + 1e-4);
    res.push(`${a}${b}:${lv('Y_AND')}${lv('Y_OR')}${lv('Y_XOR')}${lv('Y_NAND')}`);
  }
  console.log('Cổng (AND OR XOR NAND):', res.join(' '));
  ok(res.join(' ') === '00:0001 01:0111 10:0111 11:1100', 'bảng chân lý sai');
}
{
  const s = setup('sr-latch');
  const set = (n, v) => { s.C(n).p.high = v; s.C(n)._el.P = s.C(n)._el.def.compile(s.C(n).p); s.runTo(s.eng.t + 1e-4); return s.V('Q') > 2.5 ? 1 : 0; };
  s.runTo(1e-4);
  const seq = [s.V('Q') > 2.5 ? 1 : 0, set('R̄', true), set('S̄', false), set('S̄', true), set('R̄', false), set('R̄', true)];
  console.log('Chốt SR: Q =', seq.join(' → '));
  ok(seq.join('') === '001100', 'chốt SR sai');
}

console.log(fail ? `\n${fail} lỗi` : '\nTất cả kiểm tra đạt');
process.exit(fail ? 1 : 0);
