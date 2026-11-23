/* MachSim – biểu mẫu tham số dùng chung (bảng thuộc tính của sơ đồ và breadboard) */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
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
})(typeof window !== 'undefined' ? window : globalThis);
