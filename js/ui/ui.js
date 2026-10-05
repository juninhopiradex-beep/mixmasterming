/* MixMind — utilitários de interface */
(function () {
  const MM = (window.MM = window.MM || {});
  const D = MM.dsp;
  const UI = (MM.ui = {});

  UI.$ = (s, r) => (r || document).querySelector(s);
  UI.$$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  UI.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const P = {
    play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/>',
    stop: '<rect x="5.5" y="5.5" width="13" height="13" rx="2" fill="currentColor" stroke="none"/>',
    back: '<path d="M6 5v14M19 5 9 12l10 7z"/>',
    loop: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 18v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    wave: '<path d="M2 12h2M6 8v8M10 5v14M14 8v8M18 10v4M22 12h0"/>',
    gauge: '<path d="M12 14l4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
    brain: '<path d="M9 3a3 3 0 0 0-3 3v.2A3 3 0 0 0 4 9a3 3 0 0 0 .5 5A3 3 0 0 0 7 18a3 3 0 0 0 5 1.5V4.5A3 3 0 0 0 9 3z"/><path d="M15 3a3 3 0 0 1 3 3v.2A3 3 0 0 1 20 9a3 3 0 0 1-.5 5A3 3 0 0 1 17 18a3 3 0 0 1-5 1.5"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/>',
    compare: '<path d="M12 3v18"/><rect x="3" y="7" width="6" height="10" rx="1"/><rect x="15" y="5" width="6" height="14" rx="1"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    auto: '<path d="M3 17c3 0 3-10 6-10s3 10 6 10 3-6 6-6"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    plug: '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    save: '<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/>',
    up: '<path d="m18 15-6-6-6 6"/>',
    dot: '<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  };
  UI.icon = (n, cls) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${cls ? ` class="${cls}"` : ''}>${P[n] || ''}</svg>`;
  UI.logo = () => `<svg class="logo" viewBox="0 0 28 28"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5eead4"/><stop offset="1" stop-color="#38bdf8"/></linearGradient></defs><rect x="3" y="11" width="5" height="14" rx="2.5" fill="url(#lg)"/><rect x="11.5" y="3" width="5" height="22" rx="2.5" fill="url(#lg)"/><rect x="20" y="8" width="5" height="17" rx="2.5" fill="url(#lg)"/></svg>`;

  // cores por grupo
  UI.GROUP_COLOR = { vocals: '#f5b14c', drums: '#f2706b', bass: '#a78bfa', music: '#60a5fa', fx: '#7c8597', ref: '#7c8597' };
  UI.colorOf = (s) => (MM.ROLES[s.role] && MM.ROLES[s.role].color === 'pad' ? '#94a3b8' : UI.GROUP_COLOR[s.group] || '#94a3b8');

  // toasts
  UI.toast = function (msg, kind, ms) {
    let box = UI.$('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.innerHTML = (kind === 'err' ? UI.icon('alert') : kind === 'warn' ? UI.icon('info') : UI.icon('check')).replace('<svg', '<svg style="width:16px;height:16px;flex:none;margin-top:1px;color:' + (kind === 'err' ? 'var(--bad)' : kind === 'warn' ? 'var(--warn)' : 'var(--acc)') + '"') + `<div>${msg}</div>`;
    box.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, ms || 3600);
  };

  UI.modal = function (html, onMount) {
    const s = document.createElement('div');
    s.className = 'scrim';
    s.innerHTML = html;
    document.body.appendChild(s);
    const close = () => { s.remove(); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc);
    s.addEventListener('mousedown', (e) => { if (e.target === s) close(); });
    if (onMount) onMount(s, close);
    return close;
  };
  UI.confirm = (title, text, okLabel) => new Promise((res) => {
    UI.modal(`<div class="modal"><h2>${title}</h2><p class="muted" style="margin:10px 0 20px">${text}</p><div class="row" style="justify-content:flex-end"><button class="btn ghost" data-a="no">Cancelar</button><button class="btn primary" data-a="ok">${okLabel || 'Continuar'}</button></div></div>`, (s, close) => {
      s.querySelector('[data-a=no]').onclick = () => { close(); res(false); };
      s.querySelector('[data-a=ok]').onclick = () => { close(); res(true); };
    });
  });

  // canvas com hiDPI
  UI.fitCanvas = function (cv) {
    const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: r.width, h: r.height };
  };
  UI.drawWave = function (cv, peaks, color, opts) {
    opts = opts || {};
    const { ctx, w, h } = UI.fitCanvas(cv);
    ctx.clearRect(0, 0, w, h);
    if (!peaks) return;
    const n = peaks.length;
    let mx = opts.norm === false ? 1 : 0.0001;
    if (opts.norm !== false) for (let i = 0; i < n; i++) mx = Math.max(mx, peaks[i]);
    ctx.fillStyle = color;
    const step = Math.max(1, Math.floor(n / w));
    for (let x = 0; x < w; x += opts.gap ? 3 : 1) {
      const i = Math.floor((x / w) * n);
      let v = 0; for (let k = i; k < Math.min(n, i + step); k++) v = Math.max(v, peaks[k]);
      const y = Math.max(0.5, (v / mx) * h * 0.46);
      ctx.fillRect(x, h / 2 - y, opts.gap ? 2 : 1, y * 2);
    }
  };

  /** Arrastar vertical/horizontal com sensibilidade; shift = fino; duplo clique = reset. */
  UI.drag = function (el, o) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const start = o.get();
      const x0 = e.clientX, y0 = e.clientY;
      let moved = false;
      o.start && o.start();
      const mv = (ev) => {
        const fine = ev.shiftKey ? 0.2 : 1;
        const d = o.axis === 'x' ? ev.clientX - x0 : y0 - ev.clientY;
        if (Math.abs(d) > 1) moved = true;
        if (o.abs) o.set(o.abs(ev), ev); else o.set(D.clamp(start + d * (o.sens || 0.1) * fine, o.min, o.max), ev);
      };
      const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); o.end && o.end(moved); };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      if (o.abs) o.set(o.abs(e), e);
    });
    if (o.reset) el.addEventListener('dblclick', o.reset);
  };

  UI.rangePct = (inp) => { const p = ((inp.value - inp.min) / (inp.max - inp.min)) * 100; inp.style.setProperty('--p', p + '%'); };
  UI.bindRanges = (root) => UI.$$('input[type=range]', root).forEach((r) => { UI.rangePct(r); r.addEventListener('input', () => UI.rangePct(r)); });

  // knob em arco (vista plugin)
  UI.knobSVG = function (v) {
    const a0 = -225, a1 = 45, a = a0 + (a1 - a0) * D.clamp(v, 0, 1);
    const rad = (d) => (d * Math.PI) / 180;
    const pt = (ang, r) => [54 + r * Math.cos(rad(ang)), 54 + r * Math.sin(rad(ang))];
    const arc = (from, to, r) => { const [x0, y0] = pt(from, r), [x1, y1] = pt(to, r); return `M${x0} ${y0} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`; };
    const [nx, ny] = pt(a, 26), [cx, cy] = pt(a, 10);
    return `<svg viewBox="0 0 108 96"><path d="${arc(a0, a1, 38)}" stroke="rgba(255,255,255,.1)" stroke-width="8" fill="none" stroke-linecap="round"/><path d="${arc(a0, Math.max(a0 + 0.1, a), 38)}" stroke="#5eead4" stroke-width="8" fill="none" stroke-linecap="round"/><line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="#eef6f4" stroke-width="3.5" stroke-linecap="round"/></svg>`;
  };

  UI.fmtDb = (v, d) => D.fmtDb(v, d === undefined ? 1 : d);
  UI.fmtNum = (v, d) => D.fmtNum(v, d === undefined ? 1 : d);
  UI.pct = (v) => Math.round(v * 100) + ' %';
  UI.bytes = (n) => (n > 1e9 ? (n / 1e9).toFixed(1).replace('.', ',') + ' GB' : n > 1e6 ? Math.round(n / 1e6) + ' MB' : n > 1e3 ? Math.round(n / 1e3) + ' kB' : n + ' B');
  UI.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
})();
