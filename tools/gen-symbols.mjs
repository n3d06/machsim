// Sinh js/symbols.js từ gói schematic-symbols (MIT, tscircuit): chọn vài ký hiệu 2 cực,
// chuẩn hoá về hệ toạ độ linh kiện của MachSim (cực ở x=0 và x=4, trục y hướng xuống).
import { symbols } from 'schematic-symbols';
import { writeFileSync } from 'node:fs';

const PICK = { R_IEC: 'boxresistor_right', R_ANSI: 'resistor_right', D: 'diode_right', C: 'capacitor_right', L: 'inductor_right' };
const r = (n) => Math.round(n * 1000) / 1000;
const out = {};
for (const [key, name] of Object.entries(PICK)) {
  const s = symbols[name];
  const [pa, pb] = s.ports.sort((a, b) => a.x - b.x);
  const span = pb.x - pa.x;
  const k = Math.min(4, 3.9 / span); // vừa khoảng 4 ô, chừa chỗ cho dây dẫn
  const cx = (pa.x + pb.x) / 2, cy = (pa.y + pb.y) / 2;
  const X = (x) => 2 + (x - cx) * k, Y = (y) => -(y - cy) * k;
  const paths = s.primitives.filter((p) => p.type === 'path').map((p) => p.points.map((q) => [r(X(q.x)), r(Y(q.y))]));
  const ex = [r(X(pa.x)), r(X(pb.x))];
  // dây dẫn nối cực linh kiện (x=0 và x=4) tới chân ký hiệu
  const lead = (a, b) => [[a, 0], [b, 0]];
  out[key] = { w: ex, paths: paths.map((p) => p.flat()), lead: [lead(0, ex[0]).flat(), lead(ex[1], 4).flat()] };
}
writeFileSync(new URL('../js/symbols.js', import.meta.url), `/* Sinh tự động bởi tools/gen-symbols.mjs từ schematic-symbols (MIT, tscircuit) – đừng sửa tay. */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  // paths: các đường gấp khúc (x0,y0,x1,y1,...) trong toạ độ linh kiện; w: x của hai chân ký hiệu
  MS.SYM = ${JSON.stringify(out)};
  // Vẽ ký hiệu; đường chạm chân trái/phải lấy màu điện áp của cực 0/1 như dây dẫn.
  MS.drawSym = function (g, o, key) {
    const s = MS.SYM[key];
    const stroke = (pts, col) => {
      g.strokeStyle = col; g.lineWidth = 0.1; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      g.stroke();
    };
    stroke(s.lead[0], o.col(0)); stroke(s.lead[1], o.col(1));
    for (const p of s.paths) {
      const xs = [p[0], p[p.length - 2]];
      stroke(p, xs.some((x) => x <= s.w[0] + 0.02) ? o.col(0) : xs.some((x) => x >= s.w[1] - 0.02) ? o.col(1) : o.body);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
`);
