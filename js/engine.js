/* MachSim – lõi giải mạch: phân tích nút cải tiến (MNA) + Newton–Raphson
 * Ẩn số: điện áp các nút (trừ nút đất 0) và dòng nhánh (nguồn áp, cuộn cảm, ampe kế).
 */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  const GMIN = 1e-12;

  // Giải A·x = b bằng khử Gauss có chọn trụ (A, b bị ghi đè). Trả về null nếu suy biến.
  function solveLinear(A, b, n) {
    for (let k = 0; k < n; k++) {
      let p = k, max = Math.abs(A[k * n + k]);
      for (let i = k + 1; i < n; i++) {
        const v = Math.abs(A[i * n + k]);
        if (v > max) { max = v; p = i; }
      }
      if (max < 1e-30) return null;
      if (p !== k) {
        for (let j = k; j < n; j++) {
          const t = A[k * n + j]; A[k * n + j] = A[p * n + j]; A[p * n + j] = t;
        }
        const t = b[k]; b[k] = b[p]; b[p] = t;
      }
      const piv = A[k * n + k];
      for (let i = k + 1; i < n; i++) {
        const f = A[i * n + k] / piv;
        if (f === 0) continue;
        for (let j = k; j < n; j++) A[i * n + j] -= f * A[k * n + j];
        b[i] -= f * b[k];
      }
    }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      for (let j = i + 1; j < n; j++) s -= A[i * n + j] * x[j];
      x[i] = s / A[i * n + i];
    }
    return x;
  }

  // Ngữ cảnh "stamp": các phần tử ghi đóng góp của mình vào ma trận qua API này.
  // Chỉ số ẩn: nút k -> k-1 ; nút đất -> -1 (bỏ qua).
  class StampCtx {
    constructor(n) {
      this.n = n;
      this.A = new Float64Array(n * n);
      this.b = new Float64Array(n);
      this.x = new Float64Array(n);
      this.mode = 'tran'; // 'dc' | 'tran'
      this.method = 'be'; // 'trap' | 'be'
      this.h = 1e-5;
      this.t = 0;
      this.scale = 1; // hệ số nguồn (source stepping)
      this.limited = false;
    }
    clear() { this.A.fill(0); this.b.fill(0); this.limited = false; }
    a(r, c, v) { if (r >= 0 && c >= 0) this.A[r * this.n + c] += v; }
    rhs(r, v) { if (r >= 0) this.b[r] += v; }
    v(r) { return r >= 0 ? this.x[r] : 0; }
    // Điện dẫn g giữa hai nút
    G(p, q, g) { this.a(p, p, g); this.a(q, q, g); this.a(p, q, -g); this.a(q, p, -g); }
    // Nguồn dòng i chảy từ nút p, qua phần tử, sang nút q
    I(p, q, i) { this.rhs(p, -i); this.rhs(q, i); }
    // Nguồn áp: V(p) - V(q) = E, ẩn dòng br (chảy vào phần tử tại p)
    V(br, p, q, E) { this.a(p, br, 1); this.a(q, br, -1); this.a(br, p, 1); this.a(br, q, -1); this.rhs(br, E); }
    // Dòng tuyến tính hoá chảy vào phần tử tại nút r:  I = Ic + Σ g·(V(p) - V(q))
    cur(r, Ic, terms) {
      if (r < 0) return;
      this.b[r] -= Ic;
      for (let i = 0; i < terms.length; i++) {
        const t = terms[i];
        this.a(r, t[1], t[0]);
        this.a(r, t[2], -t[0]);
      }
    }
  }

  class Engine {
    // net: { nNodes (gồm đất), nBranch, elements:[{def, u:[chỉ số ẩn], br:[chỉ số ẩn], P, s}] }
    constructor(net) {
      this.nNodes = net.nNodes;
      this.nn = net.nNodes - 1;
      this.size = this.nn + net.nBranch;
      this.elements = net.elements;
      this.ctx = new StampCtx(Math.max(this.size, 1));
      this.x = new Float64Array(Math.max(this.size, 1));
      this.method = 'be';
      this.nonlinear = this.elements.some((e) => e.def.nonlinear);
      // Điện dung ký sinh bên trong linh kiện (tiếp giáp BJT, cực cổng FET…)
      this.capEls = this.elements.filter((e) => e.def.caps);
      for (const e of this.capEls) e.caps = e.def.caps(e);
      this.error = null;
      this.reset();
    }

    reset() {
      this.t = 0;
      this.x.fill(0);
      this.firstStep = true;
      this.error = null;
      for (const el of this.elements) {
        el.s = {};
        if (el.def.init) el.def.init(el);
      }
      for (const el of this.capEls) el.cs = el.caps.map(() => ({ v: 0, i: 0 }));
    }

    stampCaps(c) {
      if (c.mode === 'dc') return;
      for (const el of this.capEls) {
        for (let k = 0; k < el.caps.length; k++) {
          const [a, b, C] = el.caps[k], s = el.cs[k];
          if (c.method === 'be') { const g = C / c.h; c.G(a, b, g); c.I(a, b, -g * s.v); }
          else { const g = (2 * C) / c.h; c.G(a, b, g); c.I(a, b, -(g * s.v + s.i)); }
        }
      }
    }

    acceptCaps(c) {
      for (const el of this.capEls) {
        for (let k = 0; k < el.caps.length; k++) {
          const [a, b, C] = el.caps[k], s = el.cs[k];
          const v = c.v(a) - c.v(b);
          s.i = c.method === 'be' ? (C / c.h) * (v - s.v) : ((2 * C) / c.h) * (v - s.v) - s.i;
          s.v = v;
        }
      }
    }

    // Newton–Raphson. Trả về true nếu hội tụ (kết quả ở this.x).
    newton(maxIter) {
      const c = this.ctx, n = this.size;
      if (n === 0) return true;
      let x = Float64Array.from(this.x);
      const iters = this.nonlinear ? maxIter : 2;
      for (let it = 0; it < iters; it++) {
        c.clear();
        c.x = x;
        for (const el of this.elements) el.def.stamp(el, c);
        this.stampCaps(c);
        for (let i = 0; i < this.nn; i++) c.A[i * n + i] += GMIN;
        const sol = solveLinear(c.A, c.b, n);
        if (!sol) { this.error = 'singular'; return false; }
        let conv = !c.limited;
        for (let i = 0; i < n; i++) {
          const v = sol[i];
          if (!isFinite(v)) { this.error = 'nan'; return false; }
          const tol = i < this.nn ? 1e-6 + 1e-3 * Math.abs(v) : 1e-9 + 1e-3 * Math.abs(v);
          if (Math.abs(v - x[i]) > tol) conv = false;
        }
        x = sol;
        if (!this.nonlinear) { this.x = x; return true; }
        if (conv && it > 0) { this.x = x; return true; }
      }
      this.error = 'noconv';
      this.x = x;
      return false;
    }

    // Điểm làm việc DC (tụ hở mạch, cuộn cảm ngắn mạch)
    dcOp(fromZero) {
      const c = this.ctx;
      c.mode = 'dc'; c.t = this.t; c.scale = 1;
      const saved = Float64Array.from(this.x);
      if (fromZero) this.x.fill(0);
      this.error = null;
      if (this.newton(200)) return true;
      // Dự phòng: tăng dần nguồn (source stepping)
      this.x.fill(0);
      for (const el of this.elements) { el.s = {}; if (el.def.init) el.def.init(el); }
      let ok = true;
      for (let k = 1; k <= 20 && ok; k++) {
        c.scale = k / 20;
        ok = this.newton(200);
      }
      c.scale = 1;
      if (!ok) { this.x = saved; return false; }
      this.error = null;
      return true;
    }

    // Khởi tạo trạng thái tụ/cuộn cảm từ điểm làm việc DC
    initFromDC() {
      const ok = this.dcOp(true);
      if (ok) {
        for (const el of this.elements) if (el.def.fromDC) el.def.fromDC(el, this.x);
        const c = this.ctx; c.x = this.x;
        for (const el of this.capEls) el.caps.forEach(([a, b], k) => { el.cs[k].v = c.v(a) - c.v(b); el.cs[k].i = 0; });
      }
      return ok;
    }

    // Thử một bước h; nếu thành công thì chấp nhận
    _try(h, method) {
      const c = this.ctx;
      c.mode = 'tran';
      c.h = h;
      c.t = this.t + h;
      c.method = method;
      const prev = Float64Array.from(this.x);
      if (this.newton(50)) {
        c.x = this.x;
        for (const el of this.elements) if (el.def.accept) el.def.accept(el, c);
        this.acceptCaps(c);
        this.t += h;
        return true;
      }
      this.x = prev;
      return false;
    }

    // Một bước mô phỏng quá độ dài H; tự chia nhỏ bước khi không hội tụ
    step(H) {
      this.error = null;
      const target = this.t + H;
      let h = H, fails = 0, recover = 0;
      while (this.t < target - H * 1e-9) {
        h = Math.min(h, target - this.t);
        const method = this.firstStep || recover > 0 ? 'be' : this.method;
        if (this._try(h, method)) {
          this.firstStep = false;
          if (recover > 0) recover--;
          h = Math.min(h * 2, H);
        } else {
          if (this.error === 'singular') return false;
          h /= 8;
          recover = 4;
          if (h < H * 1e-10 || ++fails > 400) return false;
        }
      }
      this.error = null;
      return true;
    }

    // Giải DC dùng nghiệm hiện tại làm điểm khởi đầu (dùng cho quét đặc tuyến)
    dcSolve() {
      const c = this.ctx;
      c.mode = 'dc'; c.scale = 1;
      this.error = null;
      if (this.newton(200)) return true;
      return this.dcOp(true);
    }

    nodeV(node) { return node > 0 ? this.x[node - 1] : 0; }
  }

  MS.GMIN = GMIN;
  MS.solveLinear = solveLinear;
  MS.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
