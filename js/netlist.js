/* MachSim – chuyển sơ đồ (linh kiện + dây) thành netlist cho Engine */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});

  // Biến đổi toạ độ cục bộ -> toạ độ lưới: lật (y -> -y) rồi xoay rot × 90° theo chiều kim đồng hồ
  MS.xform = function (c, lx, ly) {
    if (c.flip) ly = -ly;
    for (let i = 0; i < (c.rot & 3); i++) { const t = lx; lx = -ly; ly = t; }
    return [c.x + lx, c.y + ly];
  };
  MS.invXform = function (c, wx, wy) {
    let lx = wx - c.x, ly = wy - c.y;
    for (let i = 0; i < (c.rot & 3); i++) { const t = lx; lx = ly; ly = -t; }
    if (c.flip) ly = -ly;
    return [lx, ly];
  };
  MS.terminals = function (c) {
    return MS.DEFS[c.type].terms.map(([x, y]) => MS.xform(c, x, y));
  };

  // Gán chỉ số ẩn & nhánh cho danh sách phần tử, tạo Engine
  MS.assemble = function (elements, nNodes) {
    let nodes = nNodes;
    for (const el of elements) {
      el.n = el.n.slice();
      for (let k = 0; k < (el.def.internal || 0); k++) el.n.push(nodes++);
    }
    let nb = 0;
    for (const el of elements) {
      el.brIdx = [];
      for (let k = 0; k < (el.def.branches || 0); k++) el.brIdx.push(nb++);
    }
    for (const el of elements) {
      el.u = el.n.map((k) => k - 1);
      el.br = el.brIdx.map((k) => nodes - 1 + k);
    }
    return new MS.Engine({ nNodes: nodes, nBranch: nb, elements });
  };

  // Tạo phần tử độc lập (dùng cho vẽ đặc tuyến)
  MS.makeElement = function (type, nodes, params) {
    const def = MS.DEFS[type];
    const p = Object.assign(MS.defaultParams(type), params || {});
    return { def, n: nodes, p, P: def.compile ? def.compile(p) : {}, s: {} };
  };

  MS.buildNetlist = function (circ) {
    const DEFS = MS.DEFS;
    const pts = new Map();
    const P = (x, y) => {
      const k = x + ',' + y;
      let p = pts.get(k);
      if (!p) { p = { x, y, k, deg: 0, id: pts.size, inj: 0 }; pts.set(k, p); }
      return p;
    };
    const comps = circ.comps.filter((c) => DEFS[c.type]);
    for (const c of comps) {
      c._t = MS.terminals(c);
      c._pts = c._t.map(([x, y]) => { const p = P(x, y); p.deg++; return p; });
    }
    for (const w of circ.wires) { P(w.x1, w.y1).deg++; P(w.x2, w.y2).deg++; }

    // Tách dây tại các điểm nằm trên thân dây (nối chữ T)
    const all = Array.from(pts.values());
    const edges = [];
    circ.wires.forEach((w, wi) => {
      const dx = w.x2 - w.x1, dy = w.y2 - w.y1, L2 = dx * dx + dy * dy;
      const on = [];
      if (L2 > 0) {
        for (const p of all) {
          const t = ((p.x - w.x1) * dx + (p.y - w.y1) * dy) / L2;
          if (t <= 1e-9 || t >= 1 - 1e-9) continue;
          if (Math.abs((p.x - w.x1) * dy - (p.y - w.y1) * dx) > 1e-9) continue;
          on.push([t, p]);
          p.deg += 2;
        }
      }
      on.sort((a, b) => a[0] - b[0]);
      const chain = [P(w.x1, w.y1)].concat(on.map((o) => o[1]), [P(w.x2, w.y2)]);
      for (let i = 0; i + 1 < chain.length; i++) edges.push({ a: chain[i], b: chain[i + 1], wire: wi, cur: 0 });
    });

    // Hợp nhất (union–find)
    const ptsArr = Array.from(pts.values());
    const parent = ptsArr.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    for (const e of edges) { const a = find(e.a.id), b = find(e.b.id); if (a !== b) parent[a] = b; }

    // Đánh số nút; nút đất = 0
    const rootNode = new Map();
    let groundAuto = false;
    for (const c of comps) if (c.type === 'GND') rootNode.set(find(c._pts[0].id), 0);
    const implicitGnd = comps.some((c) => DEFS[c.type].implicitGround);
    if (!rootNode.size && !implicitGnd) {
      const src = comps.find((c) => c.type === 'V' || c.type === 'AC') || comps.find((c) => DEFS[c.type].terms.length > 1);
      if (src) { rootNode.set(find(src._pts[src._pts.length > 1 ? 1 : 0].id), 0); groundAuto = true; }
    }
    let nNodes = 1;
    for (const p of ptsArr) {
      const r = find(p.id);
      if (!rootNode.has(r)) rootNode.set(r, nNodes++);
      p.node = rootNode.get(r);
    }

    const elements = [];
    for (const c of comps) {
      const def = DEFS[c.type];
      const el = { comp: c, def, n: c._pts.map((p) => p.node), p: c.p, s: {} };
      el.P = def.compile ? def.compile(c.p) : {};
      c._el = el;
      elements.push(el);
    }
    const engine = MS.assemble(elements, nNodes);
    const unconnected = [];
    for (const c of comps) c._pts.forEach((p) => { if (p.deg < 2) unconnected.push(p); });
    return { engine, elements, pts: ptsArr, edges, nNodes, groundAuto, unconnected, comps };
  };

  // Tính dòng trên từng đoạn dây (để vẽ chấm dòng điện chạy)
  MS.wireCurrents = function (net) {
    const { pts, edges, comps } = net;
    for (const p of pts) p.inj = 0;
    for (const c of comps) {
      const ic = c._el && c._el.ic;
      if (!ic) continue;
      c._pts.forEach((p, i) => { p.inj -= ic[i] || 0; }); // dòng từ linh kiện đổ vào điểm
    }
    // Duyệt cây khung theo từng nhóm điểm nối với nhau bằng dây
    const adj = new Map();
    edges.forEach((e, i) => {
      e.cur = 0;
      if (!adj.has(e.a.id)) adj.set(e.a.id, []);
      if (!adj.has(e.b.id)) adj.set(e.b.id, []);
      adj.get(e.a.id).push([i, e.b]);
      adj.get(e.b.id).push([i, e.a]);
    });
    const seen = new Set();
    for (const start of pts) {
      if (seen.has(start.id) || !adj.has(start.id)) continue;
      const order = [], parentEdge = new Map();
      const stack = [start];
      seen.add(start.id);
      while (stack.length) {
        const p = stack.pop();
        order.push(p);
        for (const [ei, q] of adj.get(p.id) || []) {
          if (seen.has(q.id)) continue;
          seen.add(q.id);
          parentEdge.set(q.id, [ei, p]);
          stack.push(q);
        }
      }
      const acc = new Map(order.map((p) => [p.id, p.inj]));
      for (let i = order.length - 1; i > 0; i--) {
        const p = order[i];
        const [ei, par] = parentEdge.get(p.id);
        const f = acc.get(p.id); // dòng đi từ p về phía cha
        const e = edges[ei];
        e.cur = e.a === p ? f : -f; // dương: chảy từ a sang b
        acc.set(par.id, acc.get(par.id) + f);
      }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
