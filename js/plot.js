/* MachSim – vẽ đồ thị XY (dùng cho trang đặc tuyến linh kiện) */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});

  function css(name, fb) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fb;
  }

  function ticks(min, max, n) {
    const step = MS.niceStep((max - min) / (n || 6));
    const out = [];
    for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return out;
  }

  class Plot {
    constructor(canvas) {
      this.cv = canvas;
      this.g = canvas.getContext('2d');
      this.opts = null;
      this.hover = null;
      canvas.addEventListener('pointermove', (e) => {
        const r = canvas.getBoundingClientRect();
        this.hover = [e.clientX - r.left, e.clientY - r.top];
        this.draw();
      });
      canvas.addEventListener('pointerleave', () => { this.hover = null; this.draw(); });
      new ResizeObserver(() => this.draw()).observe(canvas);
    }

    set(opts) { this.opts = opts; this.draw(); }

    draw() {
      const o = this.opts, cv = this.cv, g = this.g;
      const dpr = window.devicePixelRatio || 1;
      const W = cv.clientWidth, H = cv.clientHeight;
      if (!W || !H) return;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = css('--plot-bg', '#0b0f14');
      g.fillRect(0, 0, W, H);
      if (!o) return;
      const ml = 70, mr = 18, mt = 18, mb = 46;
      const pw = W - ml - mr, ph = H - mt - mb;
      if (pw < 50 || ph < 50) return;

      const fy = o.yLog ? (v) => Math.log10(Math.max(Math.abs(v), 1e-15)) : (v) => v;
      let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
      for (const s of o.series) for (const [x, y] of s.pts) {
        if (!isFinite(x) || !isFinite(y)) continue;
        const yy = fy(y);
        if (x < xmin) xmin = x; if (x > xmax) xmax = x;
        if (yy < ymin) ymin = yy; if (yy > ymax) ymax = yy;
      }
      if (o.xRange) [xmin, xmax] = o.xRange;
      if (o.yRange && !o.yLog) [ymin, ymax] = o.yRange;
      if (!isFinite(xmin)) { xmin = 0; xmax = 1; ymin = 0; ymax = 1; }
      if (xmax - xmin < 1e-12) { xmax += 1; xmin -= 1; }
      if (ymax - ymin < 1e-15) { ymax += o.yLog ? 1 : Math.abs(ymax) * 0.1 + 1e-9; ymin -= o.yLog ? 1 : Math.abs(ymin) * 0.1 + 1e-9; }
      if (!o.yRange || o.yLog) { const pad = (ymax - ymin) * 0.06; ymax += pad; if (!(ymin === 0 && !o.yLog)) ymin -= pad; }
      const X = (x) => ml + ((x - xmin) / (xmax - xmin)) * pw;
      const Y = (y) => mt + ph - ((fy(y) - ymin) / (ymax - ymin)) * ph;
      const Yr = (yy) => mt + ph - ((yy - ymin) / (ymax - ymin)) * ph;

      const grid = css('--plot-grid', '#1e2731'), axis = css('--plot-axis', '#3a4756'), text = css('--muted', '#8b949e');
      g.font = '12px system-ui, sans-serif';
      g.lineWidth = 1;
      // lưới + nhãn
      g.fillStyle = text;
      g.textAlign = 'center'; g.textBaseline = 'top';
      for (const v of ticks(xmin, xmax, Math.max(3, Math.floor(pw / 80)))) {
        const px = X(v);
        g.strokeStyle = v === 0 ? axis : grid;
        g.beginPath(); g.moveTo(px, mt); g.lineTo(px, mt + ph); g.stroke();
        g.fillText(MS.formatSI(v, o.xUnit || '', 3), px, mt + ph + 6);
      }
      g.textAlign = 'right'; g.textBaseline = 'middle';
      const yt = o.yLog ? (() => { const a = []; for (let k = Math.ceil(ymin); k <= Math.floor(ymax); k++) a.push(k); return a; })() : ticks(ymin, ymax, Math.max(3, Math.floor(ph / 50)));
      for (const v of yt) {
        const py = Yr(v);
        g.strokeStyle = !o.yLog && v === 0 ? axis : grid;
        g.beginPath(); g.moveTo(ml, py); g.lineTo(ml + pw, py); g.stroke();
        g.fillText(o.yLog ? MS.formatSI(Math.pow(10, v), o.yUnit || '', 2) : MS.formatSI(v, o.yUnit || '', 3), ml - 6, py);
      }
      g.strokeStyle = axis;
      g.strokeRect(ml + 0.5, mt + 0.5, pw, ph);
      // tên trục
      g.fillStyle = css('--text', '#e6edf3');
      g.font = '600 13px system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'bottom';
      g.fillText(o.xLabel || '', ml + pw / 2, H - 4);
      g.save(); g.translate(14, mt + ph / 2); g.rotate(-Math.PI / 2); g.textBaseline = 'middle'; g.fillText(o.yLabel || '', 0, 0); g.restore();

      // đường cong
      g.save();
      g.beginPath(); g.rect(ml, mt, pw, ph); g.clip();
      for (const s of o.series) {
        g.strokeStyle = s.color;
        g.lineWidth = s.width || 2;
        g.setLineDash(s.dash || []);
        g.beginPath();
        let first = true;
        for (const [x, y] of s.pts) {
          if (!isFinite(x) || !isFinite(y)) { first = true; continue; }
          const px = X(x), py = Y(y);
          first ? g.moveTo(px, py) : g.lineTo(px, py);
          first = false;
        }
        g.stroke();
      }
      g.setLineDash([]);
      for (const m of o.markers || []) {
        const px = X(m.x), py = Y(m.y);
        g.fillStyle = m.color || '#fff';
        g.beginPath(); g.arc(px, py, 5, 0, Math.PI * 2); g.fill();
        if (m.label) {
          g.font = '600 12px system-ui, sans-serif';
          g.textAlign = 'left'; g.textBaseline = 'bottom';
          g.fillText(m.label, px + 8, py - 4);
        }
      }
      g.restore();

      // chú thích
      const leg = o.series.filter((s) => s.label);
      if (leg.length) {
        g.font = '12px system-ui, sans-serif';
        const w = Math.max(...leg.map((s) => g.measureText(s.label).width)) + 34;
        const lx = o.legendRight ? ml + pw - w - 8 : ml + 8, ly = mt + 8;
        g.fillStyle = css('--legend-bg', 'rgba(13,17,23,0.85)');
        g.fillRect(lx, ly, w, leg.length * 18 + 8);
        leg.forEach((s, i) => {
          g.strokeStyle = s.color; g.lineWidth = 2; g.setLineDash(s.dash || []);
          g.beginPath(); g.moveTo(lx + 6, ly + 13 + i * 18); g.lineTo(lx + 24, ly + 13 + i * 18); g.stroke();
          g.setLineDash([]);
          g.fillStyle = css('--text', '#e6edf3');
          g.textAlign = 'left'; g.textBaseline = 'middle';
          g.fillText(s.label, lx + 30, ly + 13 + i * 18);
        });
      }

      // con trỏ đọc giá trị
      if (this.hover) {
        const [hx, hy] = this.hover;
        if (hx >= ml && hx <= ml + pw && hy >= mt && hy <= mt + ph) {
          let best = null, bd = 400;
          for (const s of o.series) {
            if (s.noHover) continue;
            for (const [x, y] of s.pts) {
              if (!isFinite(x) || !isFinite(y)) continue;
              const d = (X(x) - hx) ** 2 + (Y(y) - hy) ** 2;
              if (d < bd) { bd = d; best = [x, y, s]; }
            }
          }
          g.strokeStyle = css('--muted', '#8b949e'); g.setLineDash([4, 4]); g.lineWidth = 1;
          g.beginPath(); g.moveTo(hx, mt); g.lineTo(hx, mt + ph); g.moveTo(ml, hy); g.lineTo(ml + pw, hy); g.stroke();
          g.setLineDash([]);
          if (best) {
            const [x, y, s] = best;
            const px = X(x), py = Y(y);
            g.fillStyle = s.color; g.beginPath(); g.arc(px, py, 4, 0, Math.PI * 2); g.fill();
            const txt = `${o.xName || 'x'} = ${MS.formatSI(x, o.xUnit || '', 4)}   ${o.yName || 'y'} = ${MS.formatSI(y, o.yUnit || '', 4)}` + (s.label ? `   (${s.label})` : '');
            g.font = '12px system-ui, sans-serif';
            const tw = g.measureText(txt).width + 14;
            let tx = px + 10, ty = py - 30;
            if (tx + tw > ml + pw) tx = px - tw - 10;
            if (ty < mt) ty = py + 12;
            g.fillStyle = css('--legend-bg', 'rgba(13,17,23,0.92)');
            g.fillRect(tx, ty, tw, 22);
            g.fillStyle = css('--text', '#e6edf3');
            g.textAlign = 'left'; g.textBaseline = 'middle';
            g.fillText(txt, tx + 7, ty + 11);
          }
        }
      }
    }
  }

  MS.Plot = Plot;
  MS.cssVar = css;
})(typeof window !== 'undefined' ? window : globalThis);
