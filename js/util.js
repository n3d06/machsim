/* MachSim – tiện ích chung */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});

  // Đọc số có tiền tố SI: "4.7k", "10u", "100n", "1M" (mega), "2m" (mili), "1meg"
  MS.parseSI = function (s) {
    if (typeof s === 'number') return s;
    if (s == null) return NaN;
    s = String(s).trim().replace(/,/g, '.').replace(/\s+/g, '');
    const m = s.match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)(meg|Meg|MEG|[TGMkKmuµnpf])?([a-zA-ZΩ°%]*)$/);
    if (!m) return NaN;
    let v = parseFloat(m[1]);
    const mult = {
      T: 1e12, G: 1e9, M: 1e6, meg: 1e6, Meg: 1e6, MEG: 1e6, k: 1e3, K: 1e3,
      m: 1e-3, u: 1e-6, 'µ': 1e-6, n: 1e-9, p: 1e-12, f: 1e-15
    };
    if (m[2]) v *= mult[m[2]];
    return v;
  };

  const PREF = [[1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']];

  MS.formatSI = function (v, unit, digits) {
    unit = unit || '';
    digits = digits || 3;
    if (v == null || !isFinite(v)) return '—';
    if (Math.abs(v) < 1e-15) return '0 ' + unit;
    const a = Math.abs(v);
    for (let i = 0; i < PREF.length; i++) {
      const [s, p] = PREF[i];
      if (a >= s || i === PREF.length - 1) {
        let n = Number((v / s).toPrecision(digits));
        if (Math.abs(n) >= 1000 && i > 0) {
          const [s2, p2] = PREF[i - 1];
          n = Number((v / s2).toPrecision(digits));
          return n + ' ' + p2 + unit;
        }
        return n + ' ' + p + unit;
      }
    }
    return v.toExponential(2) + ' ' + unit;
  };

  // Bước chia "đẹp" 1-2-5
  MS.niceStep = function (raw) {
    if (!(raw > 0)) return 1;
    const e = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
  };

  MS.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  MS.uid = (function () {
    let n = 0;
    return () => 'c' + Date.now().toString(36) + (n++).toString(36);
  })();

  MS.escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
})(typeof window !== 'undefined' ? window : globalThis);
