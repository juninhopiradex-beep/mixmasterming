/* MixMind — vista Master + componente "Ouvir" + editor de módulos do master */
(function () {
  const MM = window.MM, D = MM.dsp, UI = MM.ui;
  const V = (MM.views = MM.views || {});

  const MNAME = { eq: 'EQ tonal', dyn: 'Dynamic EQ', mb: 'Multiband comp', glue: 'Bus glue', sat: 'Saturação', ms: 'M/S + largura', clip: 'Soft clipper', lim: 'Limiter true-peak' };
  function modSub(M, k) {
    const c = M.chain[k];
    switch (k) {
      case 'eq': return [['80 Hz', c.low], ['300 Hz', c.mud], ['3 kHz', c.pres], ['9 kHz', c.air]].filter((x) => Math.abs(x[1]) >= 0.1).map((x) => `${UI.fmtDb(x[1])} dB @ ${x[0]}`).slice(0, 2).join(' · ') + ((c.ref || []).some((g) => Math.abs(g) > 0.05) ? ' · + referência' : '') || 'neutra';
      case 'dyn': return `Lama 320 Hz · aspereza 3,2 kHz`;
      case 'mb': return `3 bandas · low-end ${UI.fmtNum(c.bands[0].ratio)}:1`;
      case 'glue': return `${UI.fmtNum(c.ratio)}:1 · ataque ${c.atk} ms · release auto`;
      case 'sat': return `${MM.SAT_NAMES[c.model]} · oversampling`;
      case 'ms': return `Graves mono < ${c.monoBelow} Hz`;
      case 'clip': return 'Aparar transientes de bombo';
      case 'lim': return `Look-ahead ${c.lookahead} ms · ceiling ${UI.fmtNum(M.ceiling)}`;
    }
    return '';
  }
  function modVal(app, M, k) {
    const c = M.chain[k], g = app.engine.graph ? app.engine.graph.gr : {};
    switch (k) {
      case 'eq': return c.air ? `${UI.fmtDb(c.air)} dB @ 9 kHz` : `${UI.fmtDb(c.low)} dB @ 80 Hz`;
      case 'dyn': return `${UI.fmtNum(c.mud)} dB`;
      case 'mb': return `GR ${UI.fmtNum(g.mb0 || 0)} dB`;
      case 'glue': return `GR ${UI.fmtNum(g.mGlue !== undefined ? g.mGlue : c.gr)} dB`;
      case 'sat': return `${Math.round(c.drive * 100)} %`;
      case 'ms': return `${M.width} %`;
      case 'clip': return `${UI.fmtNum(c.amount * 1.5)} dB`;
      case 'lim': return `GR ${UI.fmtNum(g.mLim !== undefined ? g.mLim : app.state.masterGR || 0)} dB`;
    }
    return '';
  }

  /** Componente "Ouvir · Original / Mix / Master". */
  V.listenHTML = function (app, opts) {
    const e = app.engine, st = app.state, m = e.monitor;
    const tgt = UI.fmtNum(st.master.target, Number.isInteger(st.master.target) ? 0 : 1);
    return `<div class="listen"><div class="opts">
      <button class="bigplay" data-act="play">${UI.icon(e.playing ? 'pause' : 'play')}</button>
      <button class="opt ${m === 'orig' ? 'on' : ''}" data-mon="orig"><b>Original</b><small>${st.mode === 'master' ? 'Mix sem master' : 'Stems somados, sem tratamento'}</small></button>
      <button class="opt ${m === 'mix' ? 'on' : ''}" data-mon="mix"><b>Mix</b><small>${st.mode === 'master' ? 'O teu ficheiro' : 'Equilíbrio, pan e EQ da IA'}</small></button>
      <button class="opt ${m === 'master' ? 'on' : ''}" data-mon="master" ${app.ready() ? '' : 'disabled'}><b>Master</b><small>Cadeia de master · ${tgt} LUFS</small></button>
      <button class="opt lm ${e.lm ? 'on' : ''}" data-act="lm"><b style="font-size:14px">Loudness match ${e.lm ? 'ligado' : 'desligado'}</b><small>${e.lm ? 'Só ouves a diferença de som' : 'Ouves também a diferença de volume'}</small></button>
    </div>${opts && opts.note ? `<div class="small muted" style="margin-top:10px">${opts.note}</div>` : ''}</div>`;
  };

  function spectrumTarget(st, freqs) {
    const prof = MM.styles && MM.styles.profile(st.music.genre);
    if (prof && prof.curve31 && prof.conf > 0.3) {
      const pts = MM.styles.THIRD.map((f, i) => [Math.log2(f), prof.curve31[i]]);
      const tiltAdj = ((st.direction.tone - 50) / 50) * 0.8;
      return freqs.map((f) => D.curveAt(pts, Math.log2(f)) + tiltAdj * Math.log2(f / 1000) * 0.5);
    }
    const s = MM.MASTER_STYLES[st.master.style] || MM.MASTER_STYLES.Punchy;
    const genreTilt = { Kizomba: -0.3, 'Hip-Hop': -0.6, Trap: -0.6, EDM: 0.4, House: 0.2, Pop: 0.4, Jazz: -0.4, Acoustic: -0.2 }[st.music.genre] || 0;
    const tilt = s.tilt + genreTilt + ((st.direction.tone - 50) / 50) * 0.8;
    return freqs.map((f) => {
      const oct = Math.log2(f / 1000);
      // energia por banda de largura relativa constante: ruído rosa = plano; masters típicos caem ~1,8 dB/oitava
      let v = -1.8 * oct + tilt * oct * 0.9;
      if (f < 60) v -= Math.pow((60 - f) / 40, 2) * 6;
      if (f > 12000) v -= Math.pow((f - 12000) / 6000, 2) * 8;
      return v;
    });
  }
  const normCurve = (db, freqs) => { const idx = freqs.map((f, i) => (f > 100 && f < 4000 ? i : -1)).filter((i) => i >= 0); const m = D.mean(idx.map((i) => db[i])); return db.map((v) => v - m); };

  V.master = {
    flush: true,
    render(app) {
      const st = app.state, M = st.master, m = st.metrics.master, pm = st.metrics.mix;
      const ref = st.refs.find((r) => r.id === st.activeRef);
      const targets = [-14, -12, -10, -9, -8, -7];
      const isCustom = !targets.includes(M.target);
      const qc = st.qc || [];
      const warns = qc.filter((q) => q.status !== 'ok').length;
      const prevV = st.versions.length > 1 ? st.versions[st.versions.length - 2] : null;
      return `<div class="mst">
        <div class="pad">
          <div class="eyebrow">Alvo de loudness (LUFS-I)</div>
          <div class="chips" style="margin-top:10px">${targets.map((t) => `<button class="chip mono ${M.target === t ? 'on' : ''}" data-tgt="${t}">${UI.fmtNum(t, 0)}</button>`).join('')}<input class="field mono" id="tgtC" style="width:86px;height:30px" placeholder="Custom" value="${isCustom ? UI.fmtNum(M.target) : ''}"></div>
          <div class="row" style="justify-content:space-between;margin-top:14px"><span>True peak ceiling</span><select class="field mono" id="ceil" style="width:110px;height:32px">${[-2, -1.5, -1, -0.8, -0.5, -0.3, -0.1].map((c) => `<option value="${c}" ${M.ceiling === c ? 'selected' : ''}>${UI.fmtNum(c)} dBTP</option>`).join('')}</select></div>
          <div class="eyebrow" style="margin-top:22px">Estilo de master</div>
          <div class="chips" style="margin-top:10px">${Object.keys(MM.MASTER_STYLES).map((s) => `<button class="chip ${M.style === s ? 'on' : ''}" data-style="${s}" title="${UI.esc(MM.MASTER_STYLES[s].desc)}">${s}</button>`).join('')}</div>
          <div class="small muted" style="margin-top:8px">${UI.esc((MM.MASTER_STYLES[M.style] || {}).desc || '')}</div>
          <div class="row" style="justify-content:space-between;margin-top:20px"><span>Influência da referência</span><span class="mono" id="riV">${Math.round(st.refInfluence * 100)} %</span></div>
          <input type="range" min="0" max="100" value="${Math.round(st.refInfluence * 100)}" id="ri" ${ref ? '' : 'disabled'}>
          ${ref ? '' : '<div class="small dim">Adiciona uma referência em Referências.</div>'}
          <div class="row" style="justify-content:space-between;margin-top:22px"><div class="eyebrow">Cadeia de master adaptativa</div><span class="small dim">ordem: ${M.order.indexOf('sat') < M.order.indexOf('glue') ? 'sat → glue' : 'glue → sat'}</span></div>
          <div class="mchain" style="margin-top:10px">${M.order.map((k, i) => { const c = M.chain[k]; const on = c.on && !(k === 'sat' && !c.drive) && !(k === 'clip' && !c.amount); return `<div class="it ${on ? '' : 'off'}" data-mm="${k}"><span class="led"></span><div><b>${MNAME[k]}</b><small>${UI.esc(modSub(M, k))}</small></div><span class="v" data-mv="${k}">${modVal(app, M, k)}</span><span class="row" style="gap:4px"><span class="tag ${M.manual[k] ? 'manual' : 'ia'}">${M.manual[k] ? 'MANUAL' : 'IA'}</span><span class="col" style="gap:0"><button class="btn icon xs ghost" data-up="${i}" style="height:14px;width:18px" title="Subir">${UI.icon('up')}</button><button class="btn icon xs ghost" data-dn="${i}" style="height:14px;width:18px" title="Descer">${UI.icon('down')}</button></span></span></div>`; }).join('')}</div>
          <div class="row" style="margin-top:12px"><button class="btn acc sm" id="remaster">${UI.icon('spark')}Re-masterizar</button><button class="btn ghost sm" id="mReset">Reset IA</button></div>
        </div>
        <div class="c">
          <div class="row" style="justify-content:space-between"><div class="eyebrow">Espectro · Master vs alvo vs referência</div><div class="row small muted" style="gap:16px"><span><span style="display:inline-block;width:18px;border-top:2px solid var(--acc);vertical-align:3px"></span> Master</span><span><span style="display:inline-block;width:18px;border-top:2px dashed #cfd6e2;vertical-align:3px"></span> ${MM.styles && MM.styles.profile(st.music.genre) ? 'Alvo aprendido · ' + UI.esc(st.music.genre) : 'Alvo do estilo'}</span>${ref ? '<span><span style="display:inline-block;width:18px;border-top:2px solid #f5b14c;vertical-align:3px"></span> Referência</span>' : ''}</div></div>
          <div class="cvbox" style="margin-top:12px"><canvas id="mspec" class="cv" style="height:330px;border:1px solid var(--line);border-radius:12px;background:rgba(0,0,0,.25)"></canvas><div class="tooltip" id="mtip" style="display:none"></div></div>
          <div class="tiles">
            <div class="tile"><div class="k">LUFS-I</div><div class="v" id="tI">${m ? UI.fmtNum(m.lufs) : '—'}</div><small>alvo ${UI.fmtNum(M.target)}</small></div>
            <div class="tile"><div class="k">SHORT-TERM</div><div class="v" id="tS">${m ? UI.fmtNum(m.stMax) : '—'}</div><small>máx</small></div>
            <div class="tile"><div class="k">TRUE PEAK</div><div class="v ${m && m.tp > M.ceiling + 0.05 ? 'warn' : ''}" id="tTP">${m ? UI.fmtNum(m.tp) : '—'}</div><small>dBTP · ≤ ${UI.fmtNum(M.ceiling)} ${m ? (m.tp <= M.ceiling + 0.05 ? '✓' : '✗') : ''}</small></div>
            <div class="tile"><div class="k">LRA</div><div class="v">${m ? UI.fmtNum(m.lra) : '—'}</div><small>LU</small></div>
            <div class="tile"><div class="k">PLR</div><div class="v">${m ? UI.fmtNum(m.plr) : '—'}</div><small>dB · crest ${m ? UI.fmtNum(m.crest) : '—'}</small></div>
            <div class="tile"><div class="k">MIX SCORE</div><div class="v acc">${st.score ? st.score.overall : '—'}</div><small>${prevV && prevV.score && st.score ? (st.score.overall - prevV.score >= 0 ? '+' : '') + (st.score.overall - prevV.score) + ' vs ' + UI.esc(prevV.name) : pm ? 'premaster ' + UI.fmtNum(pm.lufs) + ' LUFS' : ''}</small></div>
          </div>
          <div style="display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:14px;margin-top:14px">
            <div><div class="eyebrow" style="margin-bottom:8px">Ouvir · Original / Mix / Master</div>${V.listenHTML(app, { note: 'A comparação é sempre feita ao mesmo volume percebido quando o loudness match está ligado.' })}</div>
            <div class="listen"><div class="eyebrow">Fase</div><canvas id="vscope" style="width:100%;height:118px;display:block"></canvas><div class="mono small muted" id="corrV">corr ${m ? '+' + UI.fmtNum(m.corr, 2) : '—'}</div></div>
          </div>
        </div>
        <div class="pad">
          <div class="row" style="justify-content:space-between"><div class="eyebrow">Controlo de qualidade</div><span class="${warns ? 'warn-t' : 'ok-t'} small">${qc.length ? (warns ? warns + ' avisos' : 'tudo OK') : ''}</span></div>
          <div class="qc" style="margin-top:6px">${qc.length ? qc.map((q) => `<div class="it ${q.status}"><span class="ic">${UI.icon(q.status === 'ok' ? 'check' : q.status === 'warn' ? 'info' : 'x')}</span><div><b>${UI.esc(q.title)}</b><small>${UI.esc(q.text)}</small></div></div>`).join('') : '<div class="empty-note">O QC corre automaticamente depois do master.</div>'}</div>
          <div class="eyebrow" style="margin-top:22px">Exportar para</div>
          <div class="plat" style="margin-top:10px">${MM.PLATFORMS.filter((p) => p.id !== 'cd').map((p) => `<button data-plat="${p.id}" class="${p.lufs === M.target && p.tp === M.ceiling ? 'on' : ''}"><b>${p.name}</b><small>${UI.fmtNum(p.lufs, 0)} LUFS · ${UI.fmtNum(p.tp)} dBTP</small></button>`).join('')}<button data-plat="cd"><b>CD</b><small>16-bit · dither</small></button><button data-plat="dual"><b>Streaming dupla</b><small>Master + versão −14</small></button></div>
          <button class="btn primary lg" style="width:100%;margin-top:16px" data-view="export">${UI.icon('download')}Exportar WAV 24-bit + relatório</button>
          ${(st.masterExplain || []).length ? `<div class="eyebrow" style="margin-top:22px">Decisões do master</div><div class="explain small" style="margin-top:8px">${st.masterExplain.map((e) => `<p><b>${UI.esc(e.module)}:</b> ${UI.esc(e.text)}</p>`).join('')}</div>` : ''}
        </div>
      </div>`;
    },
    mount(app, root) {
      const st = app.state, M = st.master;
      const remaster = () => app.runAI({ keepMix: true });
      root.querySelectorAll('[data-tgt]').forEach((b) => (b.onclick = () => { app.change('Alvo ' + b.dataset.tgt + ' LUFS', () => { M.target = +b.dataset.tgt; M.manual.target = true; }, { master: true }); remaster(); }));
      const tc = root.querySelector('#tgtC');
      tc.onchange = () => { const v = parseFloat(tc.value.replace(',', '.').replace('−', '-')); if (isFinite(v) && v < -4 && v > -30) { app.change('Alvo custom', () => { M.target = v; M.manual.target = true; }, { master: true }); remaster(); } };
      root.querySelector('#ceil').onchange = (e) => { app.change('Ceiling', () => { M.ceiling = +e.target.value; M.ceilAdj = 0; }, { master: true }); remaster(); };
      root.querySelectorAll('[data-style]').forEach((b) => (b.onclick = () => {
        app.change('Estilo ' + b.dataset.style, () => {
          M.style = b.dataset.style; M.manual = { target: M.manual.target };
          const t = MM.MASTER_STYLES[M.style].target; if (t && !M.manual.target) M.target = t;
        }, { master: true });
        remaster();
      }));
      const ri = root.querySelector('#ri');
      ri.oninput = () => (root.querySelector('#riV').textContent = ri.value + ' %');
      ri.onchange = () => { app.change('Influência da referência', () => { st.refInfluence = ri.value / 100; st.refApply.master = true; delete M.manual.target; }, { master: true }); remaster(); };
      root.querySelectorAll('[data-up],[data-dn]').forEach((b) => (b.onclick = (e) => {
        e.stopPropagation();
        const i = +(b.dataset.up || b.dataset.dn), j = b.dataset.up !== undefined ? i - 1 : i + 1;
        if (j < 0 || j >= M.order.length) return;
        app.change('Ordem do master', () => { const o = M.order.slice(); [o[i], o[j]] = [o[j], o[i]]; M.order = o; M.manual.order = true; }, { master: true });
      }));
      root.querySelectorAll('[data-mm]').forEach((el) => (el.onclick = (e) => { if (e.target.closest('button')) return; V.masterEditor(app, el.dataset.mm, el); }));
      root.querySelector('#remaster').onclick = remaster;
      root.querySelector('#mReset').onclick = () => { app.change('Reset master', () => { M.manual = {}; M.order = MM.defaultMaster().order; }, { master: true }); app.runAI({ keepMix: true }); };
      root.querySelectorAll('[data-plat]').forEach((b) => (b.onclick = () => {
        const p = MM.PLATFORMS.find((x) => x.id === b.dataset.plat);
        if (b.dataset.plat === 'dual') { app.exportPreset = { platforms: ['spotify'] }; app.go('export'); return; }
        if (b.dataset.plat === 'cd') { app.exportPreset = { format: 'wav', bits: 16, sr: 44100 }; app.go('export'); return; }
        app.change('Alvo ' + p.name, () => { M.target = p.lufs; M.ceiling = p.tp; M.ceilAdj = 0; M.manual.target = true; }, { master: true });
        remaster();
      }));
      V.master.drawSpec(app, root);
      const cv = root.querySelector('#mspec'), tip = root.querySelector('#mtip');
      cv.addEventListener('mousemove', (e) => {
        const r = cv.getBoundingClientRect(), f = 20 * Math.pow(1000, (e.clientX - r.left - 44) / (r.width - 56));
        if (f < 20 || f > 20000) { tip.style.display = 'none'; return; }
        const c = M.chain;
        let txt = D.fmtHz(f);
        if (Math.abs(Math.log2(f / 320)) < 0.5 && c.dyn.on) txt = `Dynamic EQ: ${UI.fmtNum(c.dyn.mud)} dB @ 320 Hz — só quando a energia excede o alvo`;
        else if (Math.abs(Math.log2(f / 3200)) < 0.5 && c.dyn.on) txt = `Dynamic EQ: ${UI.fmtNum(c.dyn.harsh)} dB @ 3,2 kHz — aspereza`;
        else if (f < 120) txt += ` · graves em mono abaixo de ${c.ms.monoBelow} Hz`;
        tip.style.display = 'block'; tip.textContent = txt; tip.style.left = Math.min(e.clientX - r.left + 12, r.width - 300) + 'px'; tip.style.top = e.clientY - r.top - 34 + 'px';
      });
      cv.addEventListener('mouseleave', () => (tip.style.display = 'none'));
    },
    drawSpec(app, root) {
      const cv = (root || document).querySelector('#mspec'); if (!cv) return;
      const st = app.state, { ctx, w, h } = UI.fitCanvas(cv);
      const x0 = 44, y0 = 12, gw = w - x0 - 12, gh = h - y0 - 26;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.fillStyle = '#626b7c'; ctx.font = '10.5px Geist Mono, monospace';
      for (let d = 0; d >= -50; d -= 10) { const y = y0 + (-d / 60) * gh; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + gw, y); ctx.stroke(); ctx.fillText(d + ' dB', 2, y + 3); }
      [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].forEach((f) => { const x = x0 + (Math.log10(f / 20) / 3) * gw; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + gh); ctx.stroke(); ctx.fillText(f >= 1000 ? f / 1000 + 'k' : f, x - 8, h - 6); });
      const m = st.metrics.master;
      const live = app.engine.playing && app.engine.anL;
      let freqs, cur;
      if (live) {
        const n = app.engine.anL.frequencyBinCount, fb = V._fb || (V._fb = new Float32Array(n));
        app.engine.anL.getFloatFrequencyData(fb);
        const sr = app.engine.ctx.sampleRate;
        freqs = []; cur = [];
        for (let i = 0; i < 128; i++) { const f = 20 * Math.pow(1000, i / 127); freqs.push(f); const k0 = Math.max(1, Math.floor(((f / 1.06) / sr) * 2 * n)), k1 = Math.max(k0 + 1, Math.ceil(((f * 1.06) / sr) * 2 * n)); let s = 0; for (let k = k0; k < Math.min(k1, n); k++) s += Math.pow(10, fb[k] / 10); cur.push(10 * Math.log10(s + 1e-14)); }
      } else if (m) { freqs = m.spectrum.freqs; cur = m.spectrum.db; }
      if (!freqs) { ctx.fillStyle = '#7c8597'; ctx.font = '13px Geist, Inter'; ctx.fillText('O espectro aparece depois do master.', x0 + 20, y0 + 30); return; }
      const toXY = (f, v) => [x0 + (Math.log10(f / 20) / 3) * gw, y0 + D.clamp((-(v - 0)) / 60, 0, 1) * gh];
      const sm = (a, k) => a.map((_, i) => { let s2 = 0, n = 0; for (let j = Math.max(0, i - k); j <= Math.min(a.length - 1, i + k); j++) { s2 += Math.pow(10, a[j] / 10); n++; } return 10 * Math.log10(s2 / n); });
      cur = sm(cur, 3);
      const curN = normCurve(cur, freqs).map((v) => v - 18);
      const tgt = normCurve(spectrumTarget(st, freqs), freqs).map((v) => v - 18);
      // área do master
      ctx.beginPath();
      freqs.forEach((f, i) => { const [x, y] = toXY(f, curN[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.lineTo(x0 + gw, y0 + gh); ctx.lineTo(x0, y0 + gh); ctx.closePath();
      const gr = ctx.createLinearGradient(0, y0, 0, y0 + gh); gr.addColorStop(0, 'rgba(94,234,212,.22)'); gr.addColorStop(1, 'rgba(94,234,212,.02)');
      ctx.fillStyle = gr; ctx.fill();
      const line = (arr, color, dash, lw) => { ctx.beginPath(); ctx.setLineDash(dash || []); ctx.strokeStyle = color; ctx.lineWidth = lw || 2; freqs.forEach((f, i) => { const [x, y] = toXY(f, arr[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); ctx.setLineDash([]); };
      const ref = st.refs.find((r) => r.id === st.activeRef);
      if (ref && ref.metrics.spectrum) { const rf = ref.metrics.spectrum; const rr = normCurve(sm(rf.db, 3), rf.freqs).map((v) => v - 18); line(freqs.map((f) => D.curveAt(rf.freqs.map((q, i) => [q, rr[i]]), f)), '#f5b14c', null, 1.6); }
      line(tgt, '#cfd6e2', [6, 5], 1.6);
      line(curN, '#5eead4', null, 2.2);
    },
    frame(app) {
      if (app.engine.playing) V.master.drawSpec(app);
      const vs = document.getElementById('vscope');
      if (vs && app.engine.anL) {
        const { ctx, w, h } = UI.fitCanvas(vs);
        ctx.fillStyle = 'rgba(8,10,14,.35)'; ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.moveTo(w / 2 - h / 2, h / 2); ctx.lineTo(w / 2 + h / 2, h / 2); ctx.stroke();
        if (app.engine.playing) {
          const n = 1024, L = V._vl || (V._vl = new Float32Array(app.engine.anL.fftSize)), R = V._vr || (V._vr = new Float32Array(app.engine.anR.fftSize));
          app.engine.anL.getFloatTimeDomainData(L); app.engine.anR.getFloatTimeDomainData(R);
          ctx.fillStyle = 'rgba(94,234,212,.55)';
          for (let i = 0; i < n; i += 1) { const s = (L[i] - R[i]) * 0.7071, m = (L[i] + R[i]) * 0.7071; ctx.fillRect(w / 2 + s * h * 0.42, h / 2 - m * h * 0.42, 1.2, 1.2); }
          const c = document.getElementById('corrV'); if (c) c.textContent = 'corr ' + (app.engine.meter.corr >= 0 ? '+' : '') + UI.fmtNum(app.engine.meter.corr, 2);
        }
      }
      if (app.engine.playing && app.engine.monitor === 'master') {
        const mt = app.engine.meter, set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
        if (mt.I > -69) set('tI', UI.fmtNum(mt.I)); if (mt.S > -69) set('tS', UI.fmtNum(mt.S)); if (mt.tpMax > -69) set('tTP', UI.fmtNum(mt.tpMax));
        document.querySelectorAll('[data-mv]').forEach((el) => (el.textContent = modVal(app, app.state.master, el.dataset.mv)));
      }
    },
    onMonitor(app) { document.querySelectorAll('.listen [data-mon]').forEach((b) => b.classList.toggle('on', b.dataset.mon === app.engine.monitor)); },
    unmount() { V.closeEditor && V.closeEditor(); },
  };

  // ---------- editor de módulo do master ----------
  V.masterEditor = function (app, k, anchor) {
    V.closeEditor && V.closeEditor();
    const st = app.state, M = st.master, c = M.chain[k];
    const el = document.createElement('div'); el.className = 'editor';
    const row = (label, key, val, min, max, step, fmt) => `<div class="prm"><label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}" value="${val}" data-k="${key}"><span class="v" data-f="${fmt}">${fmtv(fmt, val)}</span></div>`;
    function fmtv(f, v) { v = +v; return f === 'db' ? UI.fmtDb(v) + ' dB' : f === 'cut' ? UI.fmtNum(v) + ' dB' : f === 'ratio' ? UI.fmtNum(v) + ':1' : f === 'ms' ? Math.round(v) + ' ms' : f === 'pct' ? Math.round(v * 100) + ' %' : f === 'hz' ? D.fmtHz(v) : f === 'w' ? Math.round(v) + ' %' : UI.fmtNum(v); }
    let body = `<div class="prm"><label>Ativo</label><button class="toggle ${c.on ? 'on' : ''}" data-t="on"></button><span></span></div>`;
    if (k === 'eq') body += row('Low 80 Hz', 'low', c.low, -6, 6, 0.1, 'db') + row('Lama 300 Hz', 'mud', c.mud, -6, 3, 0.1, 'db') + row('Presença 3 kHz', 'pres', c.pres, -4, 4, 0.1, 'db') + row('Ar 9 kHz', 'air', c.air, -4, 6, 0.1, 'db') + `<div class="small muted" style="margin-top:6px">EQ da referência: ${(c.ref || []).map((g) => UI.fmtDb(g)).join(' · ')} dB</div>`;
    if (k === 'dyn') body += row('Lama (máx.)', 'mud', c.mud, -6, 0, 0.1, 'cut') + row('Aspereza (máx.)', 'harsh', c.harsh, -6, 0, 0.1, 'cut');
    if (k === 'mb') body += row('Cruzamento low', 'xLow', c.xLow, 60, 300, 1, 'hz') + row('Cruzamento high', 'xHigh', c.xHigh, 1000, 6000, 10, 'hz') + c.bands.map((b, i) => row(['Low', 'Mid', 'High'][i] + ' ratio', `bands.${i}.ratio`, b.ratio, 1, 6, 0.1, 'ratio')).join('');
    if (k === 'glue') body += row('GR alvo', 'gr', c.gr, 0, 6, 0.1, 'cut') + row('Ratio', 'ratio', c.ratio, 1.2, 10, 0.1, 'ratio') + row('Ataque', 'atk', c.atk, 0.1, 100, 0.1, 'ms') + row('Release', 'rel', c.rel, 50, 1200, 10, 'ms');
    if (k === 'sat') body += `<div class="prm"><label>Modelo</label><select class="field" data-sel="model">${Object.entries(MM.SAT_NAMES).map(([m2, n]) => `<option value="${m2}" ${m2 === c.model ? 'selected' : ''}>${n}</option>`).join('')}</select><span></span></div>` + row('Drive', 'drive', c.drive, 0, 0.8, 0.01, 'pct') + row('Mix', 'mix', c.mix, 0, 1, 0.01, 'pct');
    if (k === 'ms') body += row('Largura', '@width', M.width, 60, 150, 1, 'w') + row('Mono abaixo de', 'monoBelow', c.monoBelow, 40, 250, 1, 'hz');
    if (k === 'clip') body += row('Quantidade', 'amount', c.amount, 0, 1, 0.01, 'pct');
    if (k === 'lim') body += row('Look-ahead', 'lookahead', c.lookahead, 1, 10, 0.5, 'ms') + row('Release', 'release', c.release, 10, 500, 5, 'ms') + `<div class="small muted">Ceiling e alvo definem-se no painel da esquerda.</div>`;
    el.innerHTML = `<div class="ttl"><div><div class="eyebrow">Master</div><h3 style="margin-top:4px">${MNAME[k]}</h3></div><span class="tag ${M.manual[k] ? 'manual' : 'ia'}">${M.manual[k] ? 'MANUAL' : 'IA'}</span></div>${body}
      <div class="row" style="justify-content:space-between;margin-top:14px"><button class="btn sm acc" data-rm>${UI.icon('spark')}Aplicar e medir</button><button class="btn sm" data-close>Fechar</button></div>`;
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    el.style.left = Math.min(window.innerWidth - 380, r.right + 10) + 'px';
    el.style.top = Math.max(70, Math.min(r.top - 20, window.innerHeight - el.offsetHeight - 20)) + 'px';
    UI.bindRanges(el);
    let committed = false;
    const commit = () => { if (!committed) { MM.commit(st, 'Master ' + MNAME[k]); committed = true; } M.manual[k] = true; st.dirty.master = true; };
    const setv = (key, v) => { if (key === '@width') { M.width = v; return; } const ks = key.split('.'); const last = ks.pop(); ks.reduce((o, x) => o[x], c)[last] = v; };
    el.querySelectorAll('input[data-k]').forEach((inp) => (inp.oninput = () => { commit(); setv(inp.dataset.k, +inp.value); inp.parentElement.querySelector('.v').textContent = fmtv(inp.parentElement.querySelector('.v').dataset.f, inp.value); app.engine.graph && app.engine.graph.applyMaster(); }));
    el.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { commit(); c.on = !c.on; b.classList.toggle('on'); app.engine.graph && app.engine.graph.applyMaster(); }));
    el.querySelectorAll('select[data-sel]').forEach((s) => (s.onchange = () => { commit(); c[s.dataset.sel] = s.value; app.engine.graph && app.engine.graph.applyMaster(); }));
    el.querySelector('[data-close]').onclick = () => { V.closeEditor(); app.refresh(); };
    el.querySelector('[data-rm]').onclick = () => { V.closeEditor(); app.runAI({ keepMix: true }); };
    V._outside = (e) => { if (!el.contains(e.target) && !e.target.closest('[data-mm]')) { V.closeEditor(); app.refresh(); } };
    setTimeout(() => document.addEventListener('pointerdown', V._outside, true), 0);
  };
})();
