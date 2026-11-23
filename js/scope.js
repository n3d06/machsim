/* MachSim – dao động ký: mỗi kênh tự chọn thang V/div (1-2-5), chế độ thời gian hoặc XY */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  const N = 6000;
  const COLORS = ['#ffd60a', '#32d4ff', '#ff6bd6', '#7dff6b', '#ff9f40', '#b48cff'];

  function niceCeil(v) {
    if (!(v > 0)) return 1;
    const e = Math.pow(10, Math.floor(Math.log10(v)));
    const f = v / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
  }

  class Scope {
    constructor(canvas) {
      this.cv = canvas;
      this.g = canvas.getContext('2d');
      this.signals = [];
      this.t = new Float64Array(N);
      this.head = 0;
      this.count = 0;
      this.window = 0.01;
      this.xy = false;
      this.lastSample = -Infinity;
      new ResizeObserver(() => this.draw()).observe(canvas);
    }

    setSignals(list) {
      this.signals = list.map((s, i) => Object.assign({ color: COLORS[i % COLORS.length], buf: new Float64Array(N), perDiv: 1 }, s));
      this.clear();
    }

    addSignal(s) {
      if (this.signals.some((x) => x.id === s.id && x.kind === s.kind)) return false;
      const used = new Set(this.signals.map((x) => x.color));
      const color = COLORS.find((c) => !used.has(c)) || COLORS[this.signals.length % COLORS.length];
      this.signals.push(Object.assign({ color, buf: new Float64Array(N), perDiv: 1 }, s));
      this.clear();
      return true;
    }

    removeSignal(i) { this.signals.splice(i, 1); }

    clear() { this.head = 0; this.count = 0; this.lastSample = -Infinity; }

    // Ghi một mẫu; get(sig) trả về giá trị hiện tại của kênh
    sample(t, get, force) {
      if (!this.signals.length) return;
      if (!force && t - this.lastSample < this.window / 900) return;
      this.lastSample = t;
      const i = this.head;
      this.t[i] = t;
      for (const s of this.signals) s.buf[i] = get(s);
      this.head = (i + 1) % N;
      if (this.count < N) this.count++;
    }

    // Duyệt các mẫu trong cửa sổ hiển thị (cũ -> mới)
    visible(fn) {
      if (!this.count) return;
      const last = (this.head - 1 + N) % N;
      const tEnd = this.t[last], tStart = tEnd - this.window;
      let k = this.count, i = last;
      while (k > 1 && this.t[(i - 1 + N) % N] >= tStart) { i = (i - 1 + N) % N; k--; }
      const n = this.count - k + 1;
      for (let j = 0; j < n; j++) fn((i + j) % N, tEnd);
    }

    current(s) { return this.count ? s.buf[(this.head - 1 + N) % N] : 0; }

    draw() {
      const cv = this.cv, g = this.g;
      const dpr = window.devicePixelRatio || 1;
      const W = cv.clientWidth, H = cv.clientHeight;
      if (!W || !H) return;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = MS.cssVar('--scope-bg', '#050807');
      g.fillRect(0, 0, W, H);
      const pad = 8;
      const pw = W - 2 * pad, ph = H - 2 * pad - 14;
      const cols = 10, rows = 8;
      const dx = pw / cols, dy = ph / rows;
      // lưới
      g.strokeStyle = MS.cssVar('--scope-grid', '#16301f');
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i <= cols; i++) { const x = Math.round(pad + i * dx) + 0.5; g.moveTo(x, pad); g.lineTo(x, pad + ph); }
      for (let j = 0; j <= rows; j++) { const y = Math.round(pad + j * dy) + 0.5; g.moveTo(pad, y); g.lineTo(pad + pw, y); }
      g.stroke();
      g.strokeStyle = MS.cssVar('--scope-axis', '#25523a');
      g.beginPath();
      g.moveTo(pad + pw / 2, pad); g.lineTo(pad + pw / 2, pad + ph);
      g.moveTo(pad, pad + ph / 2); g.lineTo(pad + pw, pad + ph / 2);
      g.stroke();

      g.font = '11px system-ui, sans-serif';
      g.fillStyle = MS.cssVar('--muted', '#8b949e');
      g.textBaseline = 'bottom';
      if (!this.signals.length) {
        g.textAlign = 'center';
        g.fillText('Chưa có kênh nào. Chọn một linh kiện rồi bấm “Đo điện áp / Đo dòng điện”, hoặc đặt Đầu dò lên mạch.', W / 2, H / 2);
        return;
      }

      // thang đo từng kênh theo dữ liệu trong cửa sổ
      for (const s of this.signals) {
        let m = 0;
        this.visible((i) => { const v = Math.abs(s.buf[i]); if (v > m) m = v; });
        s.perDiv = niceCeil(Math.max(m, s.kind === 'i' ? 1e-9 : 1e-6) / (this.xy ? 4.8 : 3.8));
      }
      g.save();
      g.beginPath(); g.rect(pad, pad, pw, ph); g.clip();
      g.lineWidth = 1.6;
      if (this.xy && this.signals.length >= 2) {
        const sx = this.signals[0], sy = this.signals[1];
        g.strokeStyle = sy.color;
        g.beginPath();
        let first = true;
        this.visible((i) => {
          const x = pad + pw / 2 + (sx.buf[i] / sx.perDiv) * dx;
          const y = pad + ph / 2 - (sy.buf[i] / sy.perDiv) * dy;
          first ? g.moveTo(x, y) : g.lineTo(x, y);
          first = false;
        });
        g.stroke();
        if (this.count) {
          const i = (this.head - 1 + N) % N;
          g.fillStyle = '#fff';
          g.beginPath(); g.arc(pad + pw / 2 + (sx.buf[i] / sx.perDiv) * dx, pad + ph / 2 - (sy.buf[i] / sy.perDiv) * dy, 3, 0, 7); g.fill();
        }
      } else {
        for (const s of this.signals) {
          g.strokeStyle = s.color;
          g.beginPath();
          let first = true;
          this.visible((i, tEnd) => {
            const x = pad + pw - ((tEnd - this.t[i]) / this.window) * pw;
            const y = pad + ph / 2 - (s.buf[i] / s.perDiv) * dy;
            first ? g.moveTo(x, y) : g.lineTo(x, y);
            first = false;
          });
          g.stroke();
        }
      }
      g.restore();
      g.textAlign = 'left';
      g.fillStyle = MS.cssVar('--muted', '#8b949e');
      const foot = this.xy && this.signals.length >= 2
        ? `XY — X: ${this.signals[0].label} ${MS.formatSI(this.signals[0].perDiv, this.signals[0].kind === 'i' ? 'A' : 'V')}/div   Y: ${this.signals[1].label} ${MS.formatSI(this.signals[1].perDiv, this.signals[1].kind === 'i' ? 'A' : 'V')}/div`
        : `${MS.formatSI(this.window / cols, 's')}/div`;
      g.fillText(foot, pad, H - 2);
    }
  }

  MS.Scope = Scope;
})(typeof window !== 'undefined' ? window : globalThis);
