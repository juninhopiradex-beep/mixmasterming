/* MIXMIND — vista Automação (v1.3)
 * Ferramentas: lápis, linha, formas (seno, triângulo, quadrada, rampas, aleatório) sincronizadas ao BPM e borracha.
 * Grelha: livre / batida / compasso. Lanes novas: volume, pan, envios, passa-baixo, passa-alta por stem; largura e fade do master. */
(function () {
  const MM = window.MM, D = MM.dsp, UI = MM.ui;
  const V = (MM.views = MM.views || {});

  const norm = (l, v) => (l.log ? (Math.log(v) - Math.log(l.min)) / (Math.log(l.max) - Math.log(l.min)) : (v - l.min) / (l.max - l.min));
  const denorm = (l, y) => (l.log ? Math.exp(Math.log(l.min) + y * (Math.log(l.max) - Math.log(l.min))) : l.min + y * (l.max - l.min));
  const roundV = (l, v) => (['Hz', 'pan', '%', 'size', 'fb'].includes(l.unit) ? Math.round(v) : Math.round(v * 10) / 10);
  function fmtVal(app, l, v) {
    if (l.unit === 'Hz') return D.fmtHz(v);
    if (l.unit === 'pan') return v === 0 ? 'sem movimento' : MM.panLabel(v / 100) + ' (movimento)';
    if (l.unit === 'size') { const dec = (app.state.fx[l.target.id] || {}).decay || 1.4; const k = v <= 50 ? 0.5 + v / 100 : 1 + (v - 50) / 50; return `${v < 40 ? 'mais curto' : v > 60 ? 'mais longo' : 'normal'} · ≈ ${UI.fmtNum(Math.min(4.8, dec * k))} s`; }
    if (l.unit === 'fb') return Math.round(v) + ' % feedback';
    if (l.target.param === 'cthr') return v === 0 ? 'thr. original' : `thr. ${UI.fmtDb(v)} dB · ${v > 0 ? 'menos' : 'mais'} comp.`;
    if (l.target.param === 'eqg') return `${UI.fmtDb(v)} dB face ao EQ`;
    if (l.unit === '%') { const base = l.target.type === 'master' ? app.state.master.width : 100; return Math.round((base * v) / 100) + ' %'; }
    if (l.abs) return v <= -59 ? 'off' : UI.fmtDb(v) + ' dB';
    if (l.rel && l.target.type === 'stem') {
      const s = app.stem(l.target.id);
      const base = l.base !== undefined ? l.base : l.target.param === 'sendRev' ? s.p.sendRev : s.p.sendDly;
      const a = base + v;
      return a <= -45 ? 'off' : UI.fmtDb(a) + ' dB';
    }
    if (l.target.type === 'master' && l.target.param === 'fade') return v <= -59 ? 'silêncio' : UI.fmtDb(v) + ' dB';
    return UI.fmtDb(v) + ' dB';
  }
  const visibleLanes = (app) => (app.state.automation || []).filter((l) => l.show || app.showInternal);

  // ---------- tipos de lane que o utilizador pode criar ----------
  const STEM_PARAMS = [
    ['ride', 'Volume', () => ({ unit: 'dB', min: -30, max: 6, def: 0 })],
    ['pan', 'Pan (movimento)', () => ({ unit: 'pan', min: -100, max: 100, def: 0 })],
    ['sendRev', 'Envio de reverb', (s) => ({ unit: 'dB', abs: true, min: -60, max: 6, def: s.p.sendRev <= -59 ? -60 : s.p.sendRev })],
    ['sendDly', 'Envio de delay', (s) => ({ unit: 'dB', abs: true, min: -60, max: 6, def: s.p.sendDly <= -59 ? -60 : s.p.sendDly })],
    ['lpf', 'Filtro passa-baixo', () => ({ unit: 'Hz', log: true, min: 200, max: 20000, def: 20000 })],
    ['hpf', 'Filtro passa-alta', () => ({ unit: 'Hz', log: true, min: 20, max: 2000, def: 20 })],
    ['eqg', 'Ganho de uma banda de EQ', () => ({ unit: 'dB', min: -12, max: 12, def: 0 })],
    ['cthr', 'Compressor · threshold', () => ({ unit: 'dB', min: -20, max: 20, def: 0 })],
  ];
  const FX_PARAMS = {
    plate: [['size', 'Tamanho do reverb', () => ({ unit: 'size', min: 0, max: 100, def: 50 })]],
    room: [['size', 'Tamanho do reverb', () => ({ unit: 'size', min: 0, max: 100, def: 50 })]],
    hall: [['size', 'Tamanho do reverb', () => ({ unit: 'size', min: 0, max: 100, def: 50 })]],
    delay: [['feedback', 'Feedback do delay', (st) => ({ unit: 'fb', min: 0, max: 95, def: Math.round((st.fx.delay.feedback || 0.3) * 100) })]],
  };
  const FX_NAME = { plate: 'Reverb Plate', room: 'Reverb Room', hall: 'Reverb Hall', delay: 'Delay' };
  const laneId = (tgt, param, extra) => (param === 'eqg' ? `eqg${Math.round(extra || 0)}:${tgt}` : tgt.startsWith('fx:') ? `${param}:${tgt}` : `${param}:${tgt}`);
  const MASTER_PARAMS = [
    ['width', 'Largura estéreo', () => ({ unit: '%', rel: true, min: 60, max: 150, def: 100 })],
    ['fade', 'Volume / fade do master', () => ({ unit: 'dB', min: -60, max: 0, def: 0 })],
  ];
  function makeLane(app, tgt, param, extra) {
    const st = app.state;
    if (tgt.startsWith('fx:')) {
      const fx = tgt.slice(3), d = FX_PARAMS[fx].find((x) => x[0] === param);
      return Object.assign({ id: laneId(tgt, param), label: FX_NAME[fx], sub: d[1], target: { type: 'fx', id: fx, param }, ai: null, manual: [], enabled: { ai: true, manual: true }, show: true, user: true }, d[2](st));
    }
    if (param === 'eqg') {
      const s = st.stems.find((x) => x.id === tgt);
      return { id: laneId(tgt, 'eqg', extra), label: s.label, sub: `EQ ${D.fmtHz(extra)} · ganho`, target: { type: 'stem', id: s.id, param: 'eqg', freq: extra }, unit: 'dB', min: -12, max: 12, def: 0, ai: null, manual: [], enabled: { ai: true, manual: true }, show: true, user: true };
    }
    if (tgt === 'master') {
      const d = MASTER_PARAMS.find((x) => x[0] === param);
      return Object.assign({ id: param + ':master', label: 'Master', sub: d[1], target: { type: 'master', param }, ai: null, manual: [], enabled: { ai: true, manual: true }, show: true, user: true }, d[2]());
    }
    const s = st.stems.find((x) => x.id === tgt), d = STEM_PARAMS.find((x) => x[0] === param);
    return Object.assign({ id: param + ':' + s.id, label: s.label, sub: d[1], target: { type: 'stem', id: s.id, param }, ai: null, manual: [], enabled: { ai: true, manual: true }, show: true, user: true }, d[2](s));
  }

  // ---------- operações sobre segmentos manuais ----------
  const interp = (seg, t) => D.curveAt(seg, t);
  /** Remove a cobertura manual em [a,b], cortando segmentos parcialmente sobrepostos. */
  function cutRange(manual, a, b) {
    const out = [];
    manual.forEach((seg) => {
      const s0 = seg[0][0], s1 = seg[seg.length - 1][0];
      if (s1 < a || s0 > b) { out.push(seg); return; }
      if (s0 < a) { const L = seg.filter((p) => p[0] < a); L.push([a - 0.001, interp(seg, a)]); if (L.length > 1) out.push(L); }
      if (s1 > b) { const R = [[b + 0.001, interp(seg, b)]].concat(seg.filter((p) => p[0] > b)); if (R.length > 1) out.push(R); }
    });
    return out;
  }
  const insertSeg = (manual, seg) => cutRange(manual, seg[0][0], seg[seg.length - 1][0]).concat([seg]).sort((x, z) => x[0][0] - z[0][0]);

  /** Forma de onda: fase 0..1 → 0..1 */
  const SHAPES = {
    sine: { name: 'Seno', f: (p) => 0.5 - 0.5 * Math.cos(2 * Math.PI * p) },
    tri: { name: 'Triângulo', f: (p) => (p < 0.5 ? p * 2 : 2 - p * 2) },
    square: { name: 'Quadrada', f: (p) => (p < 0.5 ? 1 : 0), step: true },
    rampUp: { name: 'Rampa ↑', f: (p) => p, saw: true },
    rampDn: { name: 'Rampa ↓', f: (p) => 1 - p, saw: true },
    random: { name: 'Aleatória', f: null, step: true },
  };
  const RATES = [['0.25', '1/16 compasso'], ['0.5', '1/8'], ['1', '1/4 (batida)'], ['2', '1/2 compasso'], ['4', '1 compasso'], ['8', '2 compassos'], ['16', '4 compassos']];

  V.automation = {
    flush: true,
    render(app) {
      const st = app.state, lanes = visibleLanes(app), r = st.rider;
      const T = (app.autoTool = app.autoTool || { tool: 'pencil', shape: 'sine', rate: '4', snap: 'beat' });
      const v = st.stems.find((s) => s.role === 'Lead Vocal');
      const exps = (st.explain || []).filter((e) => e.module === 'Vocal rider' || e.module === 'Automação');
      const manualCount = (st.automation || []).reduce((a, l) => a + l.manual.length, 0);
      const sl = (lbl, key, min, max, step, fmt) => `<div style="margin-bottom:12px"><div class="row" style="justify-content:space-between"><span>${lbl}</span><span class="mono" data-rv="${key}">${fmt(r[key])}</span></div><input type="range" min="${min}" max="${max}" step="${step}" value="${r[key]}" data-r="${key}"></div>`;
      const tb = (k, ic, label, key) => `<button data-tool="${k}" class="${T.tool === k ? 'on' : ''}" title="${label} (${key})">${ic} ${label}</button>`;
      return `<div class="auto-wrap">
        <div class="auto-tools">
          <div class="seg acc">${tb('pencil', '✎', 'Lápis', 'B')}${tb('line', '╱', 'Linha', 'L')}${tb('shape', '∿', 'Forma', 'F')}${tb('erase', '⌫', 'Borracha', 'E')}</div>
          <span class="shape-opts" style="${T.tool === 'shape' ? '' : 'display:none'}">
            <select class="field" id="aShape" style="width:auto;height:32px">${Object.entries(SHAPES).map(([k, s]) => `<option value="${k}" ${T.shape === k ? 'selected' : ''}>${s.name}</option>`).join('')}</select>
            <select class="field" id="aRate" style="width:auto;height:32px" title="Período da forma, sincronizado ao BPM">${RATES.map(([k, n]) => `<option value="${k}" ${T.rate === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
          </span>
          <label class="small muted row" style="gap:6px">Grelha <select class="field" id="aSnap" style="width:auto;height:32px"><option value="off" ${T.snap === 'off' ? 'selected' : ''}>Livre</option><option value="beat" ${T.snap === 'beat' ? 'selected' : ''}>Batida</option><option value="bar" ${T.snap === 'bar' ? 'selected' : ''}>Compasso</option></select></label>
          <span class="small muted auto-hint" id="aHint">${V.automation.hint(T.tool)}</span>
          <span class="spacer"></span>
          <button class="btn sm acc" id="addLane">+ Adicionar automação</button>
        </div>
        <div class="auto">
        <div class="lanes-l" id="lanesL"><div style="height:62px;border-bottom:1px solid var(--line);display:flex;align-items:center;padding:0 18px"><label class="check small"><input type="checkbox" id="showInt" ${app.showInternal ? 'checked' : ''}>Automação interna</label></div>
          ${lanes.map((l) => `<div class="lane-h"><div class="row" style="justify-content:space-between"><b>${UI.esc(l.label)}</b><span class="row" style="gap:4px">${l.target.type === 'stem' && app.stem(l.target.id) ? UI.sm(app.stem(l.target.id)) : ''}${l.user && !l.ai ? `<button class="btn icon xs ghost" data-rmlane="${l.id}" title="Remover esta automação">✕</button>` : ''}</span></div><small>${UI.esc(l.sub)}${l.user && !l.ai ? ' · tua' : ''}</small><div class="val" data-lv="${l.id}">${fmtVal(app, l, MM.laneValue(l, app.engine.position()))}</div>
            <div class="row" style="gap:14px"><label class="check small"><input type="checkbox" data-en="${l.id}" data-w="ai" ${l.enabled.ai ? 'checked' : ''} ${l.ai ? '' : 'disabled'}>IA</label><label class="check small"><input type="checkbox" data-en="${l.id}" data-w="manual" ${l.enabled.manual ? 'checked' : ''}>Manual${l.manual.length ? ` (${l.manual.length})` : ''}</label>${l.manual.length ? `<button class="btn xs ghost" data-clrlane="${l.id}" title="Apagar todo o desenho manual desta lane">limpar</button>` : ''}</div></div>`).join('') || '<div class="empty-note">Sem automação — corre o AI Mix &amp; Master ou adiciona uma.</div>'}
        </div>
        <div style="overflow:auto;position:relative" id="autoMid">
          <div class="ruler"><canvas id="autoRuler"></canvas></div>
          ${lanes.map((l) => `<div class="lane-c"><canvas data-lane="${l.id}"></canvas></div>`).join('')}
          <canvas id="autoHead" style="position:absolute;left:0;top:0;width:100%;pointer-events:none"></canvas>
          <div class="tooltip" id="aTip" style="display:none"></div>
          <div class="row small muted" style="padding:14px 18px;gap:22px;flex-wrap:wrap"><span><span style="display:inline-block;width:26px;border-top:2px dashed var(--acc);vertical-align:3px"></span> Escrita pela IA</span><span><span style="display:inline-block;width:26px;border-top:2px solid #fff;vertical-align:3px"></span> Editada por ti (prevalece sobre a IA)</span><span>Duplo clique remove um segmento · Ctrl+Z desfaz</span></div>
        </div>
        <aside style="border-left:1px solid var(--line);overflow:auto"><div class="pad">
          <div class="eyebrow">Vocal rider · ${v ? UI.esc(v.label) : 'sem voz principal'}</div>
          <p class="explain" style="margin:12px 0 18px">Mantém a voz ${UI.fmtNum(r.target)} dB acima do instrumental na banda 300 Hz – 4 kHz, frase a frase.${st.riderInfo ? ` ${st.riderInfo.points} pontos escritos, ${st.riderInfo.sections} secções, ${st.riderInfo.breaths} blocos de respiração atenuados.` : ''}</p>
          ${sl('Máx. movimento', 'max', 0.5, 8, 0.5, (x) => '±' + UI.fmtNum(+x) + ' dB')}
          ${sl('Distância alvo vs instrumental', 'target', -3, 6, 0.1, (x) => UI.fmtDb(+x) + ' LU')}
          ${sl('Suavização', 'smooth', 0, 100, 1, (x) => Math.round(x) + ' %')}
          ${sl('Respirações', 'breaths', -12, 0, 0.5, (x) => UI.fmtDb(+x) + ' dB')}
          ${sl('Adlibs vs lead', 'adlibs', -8, 2, 0.5, (x) => UI.fmtDb(+x) + ' dB')}
          <div class="row wrap" style="margin-top:6px"><button class="btn primary sm" id="accAI">Aceitar IA</button><button class="btn sm" id="smoothB">Suavizar</button><button class="btn sm" id="reduceB">Reduzir pontos</button><button class="btn sm ghost" id="clearB" ${manualCount ? '' : 'disabled'}>Limpar todo o manual</button></div>
          <div class="hr"></div>
          <div class="eyebrow">Explicação</div>
          <div class="explain" style="margin-top:10px">${exps.map((e) => `<p>${UI.esc(e.text)}</p>`).join('')}${(st.automation || []).filter((l) => l.manual.length).map((l) => `<p><b>${UI.esc(l.label)} · ${UI.esc(l.sub)}:</b> a tua edição manual foi respeitada; a IA não volta a mexer nesse troço.</p>`).join('')}</div>
        </div></aside>
      </div></div>`;
    },
    hint(tool) {
      return ({
        pencil: 'Arrasta para desenhar à mão livre.',
        line: 'Arrasta de um ponto ao outro: rampa em linha reta.',
        shape: 'Arrasta na horizontal para a duração; a altura inicial e final definem o mínimo e o máximo da onda.',
        erase: 'Arrasta sobre o desenho para o apagar. Com Alt: apaga também a IA nesse troço (fica o valor neutro).',
      })[tool] || '';
    },
    mount(app, root) {
      const st = app.state, dur = st.music.duration, T = app.autoTool;
      const lanes = visibleLanes(app);
      const grid = () => (T.snap === 'bar' ? st.music.barSec : T.snap === 'beat' ? 60 / st.music.bpm : 0);
      const snapT = (t) => { const g = grid(); if (!g) return t; const d0 = st.music.downbeat || 0; return D.clamp(d0 + Math.round((t - d0) / g) * g, 0, dur); };
      const drawRuler = () => {
        const cv = root.querySelector('#autoRuler'); const { ctx, w, h } = UI.fitCanvas(cv);
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#7c8597'; ctx.font = '11px Geist Mono, monospace';
        for (let b = 0; b <= st.music.bars; b += 16) { const x = ((st.music.downbeat + b * st.music.barSec) / dur) * w; ctx.fillText(String(b + 1), x + 3, 13); }
        st.music.sections.forEach((s, i) => { const x0 = (s.start / dur) * w, x1 = (s.end / dur) * w; ctx.fillStyle = 'rgba(94,234,212,.1)'; ctx.fillRect(x0 + 1, 24, x1 - x0 - 2, 30); ctx.fillStyle = '#d6e4e1'; ctx.font = '12px Geist, Inter, sans-serif'; ctx.save(); ctx.beginPath(); ctx.rect(x0, 24, x1 - x0 - 4, 30); ctx.clip(); ctx.fillText(MM.sections ? MM.sections.label(st, i) : s.name, x0 + 7, 43); ctx.restore(); });
      };
      drawRuler();
      function laneAI(l, t) { if (!l.ai) return l.def; return MM.laneValue(Object.assign({}, l, { manual: [], enabled: { ai: true, manual: false } }), t); }
      const drawLane = (l, preview) => {
        const cv = root.querySelector(`canvas[data-lane="${CSS.escape(l.id)}"]`); if (!cv) return;
        const { ctx, w, h } = UI.fitCanvas(cv), pad = 14;
        ctx.clearRect(0, 0, w, h);
        // grelha
        const g = grid();
        if (g && (g / dur) * w > 6) { ctx.fillStyle = 'rgba(255,255,255,.025)'; for (let t = st.music.downbeat || 0; t < dur; t += g) ctx.fillRect((t / dur) * w, 0, 1, h); }
        st.music.sections.forEach((s) => { ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect((s.start / dur) * w, 0, 1, h); });
        const yOf = (v) => h - pad - D.clamp(norm(l, v), 0, 1) * (h - 2 * pad);
        ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(0, yOf(l.def)); ctx.lineTo(w, yOf(l.def)); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#626b7c'; ctx.font = '10.5px Geist Mono, monospace';
        const lbl = (v) => (l.unit === 'Hz' ? D.fmtHz(v) : l.unit === 'pan' ? (v < 0 ? 'L' : v > 0 ? 'R' : 'C') + (v ? Math.abs(v) : '') : (v > 0 ? '+' : '') + v + (l.unit === '%' ? '%' : ''));
        ctx.fillText(lbl(l.max), 6, 12); ctx.fillText(lbl(l.min), 6, h - 4);
        if (l.ai) {
          ctx.strokeStyle = l.enabled.ai ? '#5eead4' : 'rgba(94,234,212,.3)'; ctx.lineWidth = 1.8; ctx.setLineDash([5, 4]); ctx.beginPath();
          for (let x = 0; x <= w; x += 2) { const t = (x / w) * dur; const vv = laneAI(l, t); x ? ctx.lineTo(x, yOf(vv)) : ctx.moveTo(x, yOf(vv)); }
          ctx.stroke(); ctx.setLineDash([]);
        }
        const segs = preview && preview.manual ? preview.manual : l.manual;
        segs.forEach((seg) => {
          ctx.strokeStyle = l.enabled.manual ? '#fff' : 'rgba(255,255,255,.35)'; ctx.lineWidth = 2; ctx.beginPath();
          seg.forEach(([t, vv], i) => { const x = (t / dur) * w; i ? ctx.lineTo(x, yOf(vv)) : ctx.moveTo(x, yOf(vv)); });
          ctx.stroke();
          ctx.fillStyle = '#fff';
          [seg[0], seg[seg.length - 1]].forEach(([t, vv]) => { ctx.beginPath(); ctx.arc((t / dur) * w, yOf(vv), 3.5, 0, Math.PI * 2); ctx.fill(); });
        });
        if (preview && preview.erase) {
          const [a, b] = preview.erase, x0 = (a / dur) * w, x1 = (b / dur) * w;
          ctx.fillStyle = preview.flat ? 'rgba(251,191,36,.16)' : 'rgba(251,113,133,.16)'; ctx.fillRect(x0, 0, x1 - x0, h);
          ctx.strokeStyle = preview.flat ? '#fbbf24' : '#fb7185'; ctx.setLineDash([4, 3]); ctx.strokeRect(x0 + 0.5, 0.5, x1 - x0 - 1, h - 1); ctx.setLineDash([]);
        }
      };
      lanes.forEach((l) => drawLane(l));
      V.automation._redraw = () => lanes.forEach((l) => drawLane(l));
      const tip = root.querySelector('#aTip'), mid = root.querySelector('#autoMid');
      const showTip = (ev, txt) => { const r = mid.getBoundingClientRect(); tip.style.display = 'block'; tip.textContent = txt; tip.style.left = Math.min(ev.clientX - r.left + 14, r.width - 220) + 'px'; tip.style.top = ev.clientY - r.top + mid.scrollTop - 30 + 'px'; };

      // ---------- edição ----------
      lanes.forEach((l) => {
        const cv = root.querySelector(`canvas[data-lane="${CSS.escape(l.id)}"]`); if (!cv) return;
        const at = (ev) => {
          const r = cv.getBoundingClientRect(), h = r.height, pad = 14;
          const t = D.clamp(((ev.clientX - r.left) / r.width) * dur, 0, dur);
          const y = D.clamp(1 - (ev.clientY - r.top - pad) / (h - 2 * pad), 0, 1);
          return { t, y, v: roundV(l, denorm(l, y)) };
        };
        cv.addEventListener('pointermove', (ev) => { if (cv._busy) return; const p = at(ev); showTip(ev, `${D.fmtTime(p.t).slice(0, 7)} · ${fmtVal(app, l, p.v)}`); });
        cv.addEventListener('pointerleave', () => { if (!cv._busy) tip.style.display = 'none'; });
        cv.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          cv.setPointerCapture(e.pointerId); cv._busy = true;
          MM.commit(st, (T.tool === 'erase' ? 'Borracha · ' : 'Automação · ') + l.label + ' ' + l.sub);
          const base = l.manual.slice();
          const p0 = at(e), t0 = T.tool === 'pencil' ? p0.t : snapT(p0.t);
          let pts = [], result = base, extra = {};
          const update = (ev) => {
            const p = at(ev);
            if (T.tool === 'pencil') {
              if (pts.length && p.t <= pts[pts.length - 1][0]) pts[pts.length - 1][1] = p.v; else pts.push([p.t, p.v]);
              const seg = pts.length > 1 ? simplify(pts) : [[Math.max(0, p.t - 0.25), p.v], [Math.min(dur, p.t + 0.25), p.v]];
              result = insertSeg(base, seg);
              showTip(ev, fmtVal(app, l, p.v));
            } else if (T.tool === 'line') {
              const t1 = snapT(p.t);
              const a = Math.min(t0, t1), b = Math.max(t0, t1);
              if (b - a < 0.02) { result = base; return; }
              const seg = t0 <= t1 ? [[a, p0.v], [b, p.v]] : [[a, p.v], [b, p0.v]];
              result = insertSeg(base, seg);
              showTip(ev, `${fmtVal(app, l, seg[0][1])} → ${fmtVal(app, l, seg[1][1])} · ${UI.fmtNum(b - a)} s`);
            } else if (T.tool === 'shape') {
              const t1 = snapT(p.t), a = Math.min(t0, t1), b = Math.max(t0, t1);
              if (b - a < 0.05) { result = base; return; }
              const seg = shapeSeg(l, a, b, p0.y, p.y);
              result = insertSeg(base, seg);
              showTip(ev, `${SHAPES[T.shape].name} · ${fmtVal(app, l, roundV(l, denorm(l, Math.min(p0.y, p.y))))} ↔ ${fmtVal(app, l, roundV(l, denorm(l, Math.max(p0.y, p.y))))}`);
            } else if (T.tool === 'erase') {
              const t1 = snapT(p.t), a = Math.min(t0, t1), b = Math.max(t0, t1);
              extra = { erase: [a, Math.max(b, a + 0.05)], flat: ev.altKey };
              result = cutRange(base, a, Math.max(b, a + 0.05));
              if (ev.altKey) result = insertSeg(result, [[a, l.def], [Math.max(b, a + 0.05), l.def]]);
              showTip(ev, ev.altKey ? 'Apagar desenho e IA (valor neutro)' : 'Apagar desenho');
            }
            drawLane(l, Object.assign({ manual: result }, extra));
          };
          update(e);
          const mv = (ev) => update(ev);
          const up = () => {
            cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', up);
            cv._busy = false; tip.style.display = 'none';
            const changed = JSON.stringify(result) !== JSON.stringify(base);
            if (!changed) { MM.history.undo.pop(); drawLane(l); return; }
            l.manual = result;
            if (l.manual.length) l.enabled.manual = true;
            st.dirty.mix = true; if (l.target.type === 'master') st.dirty.master = true;
            app.engine.reschedule(); app.saveSoon(); app.refresh();
          };
          cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
        });
        cv.addEventListener('dblclick', (e) => {
          const r = cv.getBoundingClientRect(), t = ((e.clientX - r.left) / r.width) * dur;
          const i = l.manual.findIndex((s) => t >= s[0][0] - 0.3 && t <= s[s.length - 1][0] + 0.3);
          if (i >= 0) app.change('Remover segmento de automação', () => l.manual.splice(i, 1), { reschedule: true });
        });
      });
      function simplify(p) {
        if (p.length < 3) return p.slice();
        const out = [p[0]];
        for (let i = 1; i < p.length - 1; i++) { const a = out[out.length - 1]; if (p[i][0] - a[0] > dur / 600 || Math.abs(p[i][1] - a[1]) > 0.0001) out.push(p[i]); }
        out.push(p[p.length - 1]);
        return out;
      }
      /** Onda sincronizada ao BPM entre os níveis y0 e y1 (normalizados), de a a b. */
      function shapeSeg(l, a, b, y0, y1) {
        const S = SHAPES[T.shape], period = (60 / st.music.bpm) * +T.rate;
        const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
        const val = (q) => roundV(l, denorm(l, lo + q * (hi - lo)));
        const pts = [];
        const n = Math.max(1, Math.round((b - a) / period));
        const P = (b - a) / n; // períodos inteiros dentro do troço
        let seed = 7;
        const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        const eps = Math.min(0.004, P / 50);
        for (let k = 0; k < n; k++) {
          const t0 = a + k * P;
          if (S.step) {
            if (T.shape === 'random') { const q = rnd(); pts.push([t0 + (k ? eps : 0), val(q)], [t0 + P - eps, val(q)]); }
            else { pts.push([t0 + (k ? eps : 0), val(1)], [t0 + P / 2 - eps, val(1)], [t0 + P / 2 + eps, val(0)], [t0 + P - eps, val(0)]); }
          } else if (S.saw) { pts.push([t0 + (k ? eps : 0), val(S.f(0))], [t0 + P - eps, val(S.f(1))]); }
          else { const m = 16; for (let j = 0; j < m; j++) pts.push([t0 + (j / m) * P, val(S.f(j / m))]); }
        }
        if (!S.step && !S.saw) pts.push([b, val(S.f(1))]);
        pts[pts.length - 1][0] = Math.min(pts[pts.length - 1][0], b);
        return pts;
      }

      // ---------- barra de ferramentas ----------
      const setTool = (k) => { T.tool = k; root.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('on', x.dataset.tool === k)); root.querySelector('.shape-opts').style.display = k === 'shape' ? '' : 'none'; root.querySelector('#aHint').textContent = V.automation.hint(k); };
      root.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
      root.querySelector('#aShape').onchange = (e) => (T.shape = e.target.value);
      root.querySelector('#aRate').onchange = (e) => (T.rate = e.target.value);
      root.querySelector('#aSnap').onchange = (e) => { T.snap = e.target.value; lanes.forEach((l) => drawLane(l)); };
      V.automation._keys = (e) => {
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.ctrlKey || e.metaKey) return;
        const k = { b: 'pencil', l: 'line', f: 'shape', e: 'erase' }[e.key.toLowerCase()];
        if (k) { setTool(k); e.preventDefault(); }
      };
      document.addEventListener('keydown', V.automation._keys);
      // rolagem vertical sincronizada entre os nomes e as lanes
      const ll = root.querySelector('#lanesL');
      mid.addEventListener('scroll', () => { if (ll.scrollTop !== mid.scrollTop) ll.scrollTop = mid.scrollTop; });
      ll.addEventListener('scroll', () => { if (mid.scrollTop !== ll.scrollTop) mid.scrollTop = ll.scrollTop; });

      root.querySelector('#addLane').onclick = () => V.automation.addLaneModal(app);
      root.querySelectorAll('[data-rmlane]').forEach((b) => (b.onclick = () => app.change('Remover automação', () => { st.automation = st.automation.filter((l) => l.id !== b.dataset.rmlane); }, { allStems: true, master: true, reschedule: true })));
      root.querySelectorAll('[data-clrlane]').forEach((b) => (b.onclick = () => app.change('Limpar desenho', () => { const l = st.automation.find((x) => x.id === b.dataset.clrlane); if (l) l.manual = []; }, { reschedule: true })));
      root.querySelectorAll('[data-en]').forEach((c) => (c.onchange = () => app.change('Automação on/off', () => { const l = st.automation.find((x) => x.id === c.dataset.en); l.enabled[c.dataset.w] = c.checked; }, { reschedule: true })));
      root.querySelector('#showInt').onchange = (e) => { app.showInternal = e.target.checked; app.refresh(); };
      const fmts = { max: (x) => '±' + UI.fmtNum(+x) + ' dB', target: (x) => UI.fmtDb(+x) + ' LU', smooth: (x) => Math.round(x) + ' %', breaths: (x) => UI.fmtDb(+x) + ' dB', adlibs: (x) => UI.fmtDb(+x) + ' dB' };
      root.querySelectorAll('[data-r]').forEach((inp) => {
        inp.oninput = () => (root.querySelector(`[data-rv="${inp.dataset.r}"]`).textContent = fmts[inp.dataset.r](inp.value));
        inp.onchange = () => app.change('Vocal rider', () => {
          st.rider[inp.dataset.r] = +inp.value;
          if (inp.dataset.r === 'adlibs') { const a = st.stems.find((s) => s.role === 'Adlibs'); const v = st.stems.find((s) => s.role === 'Lead Vocal'); if (a && v && !a.locked) { a.p.fader = +(v.p.fader + st.rider.adlibs - 4.5).toFixed(1); a.manual.fader = true; } }
        }, { auto: true });
      });
      const rider = () => st.automation.find((l) => l.kind === 'rider');
      root.querySelector('#accAI').onclick = () => app.change('Aceitar IA', () => { st.automation.forEach((l) => { if (l.kind === 'rider') { l.manual = []; l.enabled.ai = true; } }); }, { reschedule: true });
      root.querySelector('#smoothB').onclick = () => app.change('Suavizar rider', () => { st.rider.smooth = Math.min(100, st.rider.smooth + 10); }, { auto: true });
      root.querySelector('#reduceB').onclick = () => app.change('Reduzir pontos', () => {
        const l = rider();
        if (l && l.ai && l.ai.values) { const pts = []; const step = 0.5; for (let t = 0; t <= dur; t += step) pts.push([t, +MM.laneValue(Object.assign({}, l, { enabled: { ai: true, manual: false } }), t).toFixed(2)]); l.ai = { points: pts }; }
        st.automation.forEach((x) => (x.manual = x.manual.map((s) => s.filter((p2, i) => i === 0 || i === s.length - 1 || i % 3 === 0))));
        UI.toast(`Rider reduzido a ${l && l.ai ? l.ai.points.length : 0} pontos (1 por 0,5 s).`, 'ok');
      }, { reschedule: true });
      root.querySelector('#clearB').onclick = () => app.change('Limpar automação manual', () => st.automation.forEach((l) => (l.manual = [])), { reschedule: true });
    },
    unmount() { if (V.automation._keys) document.removeEventListener('keydown', V.automation._keys); V.automation._keys = null; },

    addLaneModal(app) {
      const st = app.state, stems = st.stems.filter((s) => !s.removed && s.role !== 'Reference Track');
      const has = (id) => (st.automation || []).some((l) => l.id === id);
      const usedFx = new Set(stems.filter((s) => s.p.sendRev > -59).map((s) => s.p.revType || 'plate'));
      UI.modal(`<div class="modal" style="width:600px"><h2>Adicionar automação</h2>
        <p class="muted small" style="margin:8px 0 16px">Escolhe o destino e o parâmetro. A lane começa no valor atual e desenhas com o lápis, a linha ou as formas.</p>
        <div class="row" style="gap:10px;margin-bottom:14px"><span class="small muted" style="width:70px">Destino</span><select class="field" id="alT" style="flex:1">
          <optgroup label="Master"><option value="master">Master</option></optgroup>
          <optgroup label="Efeitos">${['plate', 'room', 'hall', 'delay'].map((f) => `<option value="fx:${f}">${FX_NAME[f]}${f !== 'delay' && !usedFx.has(f) ? ' (sem envios)' : ''}</option>`).join('')}</optgroup>
          <optgroup label="Stems">${stems.map((s) => `<option value="${s.id}" ${s.id === app.selected ? 'selected' : ''}>${UI.esc(s.label)}</option>`).join('')}</optgroup></select></div>
        <div class="chips" id="alP"></div>
        <div id="alX" style="margin-top:14px"></div>
        <div class="row" style="justify-content:flex-end;margin-top:20px"><button class="btn ghost" data-a="no">Cancelar</button><button class="btn primary" data-a="ok" disabled>Adicionar</button></div></div>`, (m, close) => {
        let sel = null;
        const tSel = m.querySelector('#alT'), box = m.querySelector('#alP'), xb = m.querySelector('#alX'), ok = m.querySelector('[data-a=ok]');
        const stemOf = () => st.stems.find((x) => x.id === tSel.value);
        const extraUI = () => {
          xb.innerHTML = '';
          const s = stemOf();
          if (sel === 'eqg' && s) {
            const bands = (s.p.eq || []).map((e, i) => [e, i]).filter(([e, i]) => e && e.on && i < 8);
            xb.innerHTML = `<div class="row" style="gap:10px"><span class="small muted" style="width:70px">Banda</span><select class="field" id="alB" style="flex:1">${bands.map(([e]) => `<option value="${e.freq}">${D.fmtHz(e.freq)} · ${e.type === 'peaking' ? 'sino' : e.type} ${UI.fmtDb(e.gain)} dB${e.user ? ' (tua)' : ''}</option>`).join('')}<option value="new">Nova banda (sino, 0 dB)…</option></select><input class="field mono" id="alF" placeholder="Hz" style="width:100px;${bands.length ? 'display:none' : ''}" value="2500"></div>
              <div class="small dim" style="margin-top:8px">A automação soma ao ganho da banda: 0 dB = como está no EQ.</div>`;
            const b = xb.querySelector('#alB'), f = xb.querySelector('#alF');
            if (!bands.length) b.value = 'new';
            b.onchange = () => (f.style.display = b.value === 'new' ? '' : 'none');
          } else if (sel === 'cthr' && s) {
            xb.innerHTML = s.p.comp.on ? `<div class="small dim">Threshold atual ${UI.fmtNum(s.p.comp.thr)} dB · ${UI.fmtNum(s.p.comp.ratio)}:1. Valores positivos sobem o threshold (menos compressão), negativos comprimem mais.</div>` : '<div class="small" style="color:var(--warn)">Este stem não tem compressor ativo. Ativa-o no Mixer primeiro.</div>';
            ok.disabled = !s.p.comp.on;
          } else if (sel === 'size') {
            const fx = tSel.value.slice(3);
            xb.innerHTML = `<div class="small dim">50 % = como está (${UI.fmtNum(st.fx[fx].decay)} s). 0 % encurta para metade, 100 % duplica. O reverb faz um crossfade entre três respostas para não haver cortes.${!usedFx.has(fx) ? ' <span style="color:var(--warn)">Nenhum stem envia para este reverb.</span>' : ''}</div>`;
          }
        };
        const draw = () => {
          const tgt = tSel.value;
          const list = tgt === 'master' ? MASTER_PARAMS : tgt.startsWith('fx:') ? FX_PARAMS[tgt.slice(3)] : STEM_PARAMS;
          sel = null; ok.disabled = true; xb.innerHTML = '';
          box.innerHTML = list.map(([k, name]) => { const ex = k !== 'eqg' && has(laneId(tgt, k)); return `<button class="chip" data-p="${k}" title="${ex ? 'Já existe: vai ficar visível' : ''}">${name}${ex ? ' · já existe' : ''}</button>`; }).join('');
          box.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => { sel = b.dataset.p; box.querySelectorAll('[data-p]').forEach((x) => x.classList.toggle('on', x === b)); ok.disabled = false; extraUI(); }));
        };
        tSel.onchange = draw; draw();
        m.querySelector('[data-a=no]').onclick = close;
        ok.onclick = () => {
          const tgt = tSel.value;
          let extra = null, newBand = null;
          if (sel === 'eqg') {
            const b = xb.querySelector('#alB');
            if (b.value === 'new') { extra = D.clamp(parseFloat(String(xb.querySelector('#alF').value).replace(',', '.')) || 2500, 30, 18000); newBand = { type: 'peaking', freq: Math.round(extra), gain: 0, q: 1, on: true, user: true, why: 'banda de automação' }; }
            else extra = +b.value;
          }
          const id = laneId(tgt, sel, extra);
          close();
          app.change('Adicionar automação', () => {
            if (newBand) { const s = stemOf(); s.p.eq = s.p.eq || []; s.p.eq.push(newBand); }
            const ex = st.automation.find((l) => l.id === id);
            if (ex) { ex.show = true; ex.user = true; }
            else st.automation.push(makeLane(app, tgt, sel, extra));
          }, { allStems: true, master: true, fx: true, reschedule: true });
          UI.toast('Automação adicionada. Desenha na nova lane (fim da lista).', 'ok');
          setTimeout(() => { const mid = document.getElementById('autoMid'); if (mid) mid.scrollTop = mid.scrollHeight; }, 50);
        };
      });
    },

    frame(app) {
      const cv = document.getElementById('autoHead'), mid = document.getElementById('autoMid');
      if (!cv || !mid) return;
      cv.style.height = mid.scrollHeight - 50 + 'px';
      const { ctx, w, h } = UI.fitCanvas(cv);
      ctx.clearRect(0, 0, w, h);
      const x = (app.engine.position() / app.engine.duration()) * w;
      ctx.fillStyle = '#fff'; ctx.fillRect(x, 0, 1.5, h);
      ctx.beginPath(); ctx.moveTo(x - 6, 0); ctx.lineTo(x + 7, 0); ctx.lineTo(x + 0.7, 8); ctx.fill();
      if (app.engine.playing) document.querySelectorAll('[data-lv]').forEach((el) => {
        const l = app.state.automation.find((q) => q.id === el.dataset.lv);
        if (l) el.textContent = fmtVal(app, l, MM.laneValue(l, app.engine.position())) + (l.enabled.manual && l.manual.some((s) => app.engine.position() >= s[0][0] && app.engine.position() <= s[s.length - 1][0]) ? ' (manual)' : '');
      });
    },
  };
})();
