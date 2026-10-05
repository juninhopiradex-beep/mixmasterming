/* MixMind — vistas Comparar e Referências */
(function () {
  const MM = window.MM, D = MM.dsp, UI = MM.ui;
  const V = (MM.views = MM.views || {});

  function changes(app) {
    const st = app.state, out = { mix: [], master: [] };
    if (st.mode !== 'master') {
      const stems = st.stems.filter((s) => !s.removed && s.features);
      const rel = (s) => -20 + s.p.fader + (s.p.comp.on ? s.p.comp.makeup * 0.3 : 0) - s.features.lufs;
      const meanRel = D.mean(stems.map(rel));
      const groups = {};
      stems.forEach((s) => { const g = s.group === 'vocals' ? 'Vozes' : s.group === 'drums' ? (MM.ROLES[s.role].fam === 'hat' ? 'Hi-hat' : 'Bateria') : s.group === 'bass' ? 'Baixo' : s.role === 'Pad' ? 'Pad' : 'Instrumentos'; (groups[g] = groups[g] || []).push(s); });
      Object.entries(groups).forEach(([g, ss]) => {
        const d = D.mean(ss.map(rel)) - meanRel;
        const extras = [];
        const pres = ss.flatMap((s) => s.p.eq.filter((e) => e.on && e.gain > 0.5 && e.freq > 2000 && e.freq < 6000));
        if (pres.length) extras.push(`presença @ ${D.fmtHz(pres[0].freq)}`);
        const hp = ss.find((s) => s.p.hpf.on && s.p.hpf.freq < 50 && g === 'Baixo'); if (hp) extras.push(`high-pass ${Math.round(hp.p.hpf.freq)} Hz`);
        const pans = ss.filter((s) => Math.abs(s.p.pan) > 0.3); if (pans.length && g === 'Instrumentos') extras.push(`abertos em ${pans.map((s) => MM.panLabel(s.p.pan)).slice(0, 2).join('/')}`);
        if (g === 'Hi-hat' && ss.some((s) => s.p.eq.some((e) => e.type === 'highshelf' && e.gain < 0))) extras.push('brilho suave');
        if (g === 'Pad' && ss.some((s) => s.chs.length > 1)) extras.push('estéreo largo');
        out.mix.push({ t: `${g} ${UI.fmtDb(d)} dB${extras.length ? ', ' + extras.join(', ') : ''}`, v: UI.fmtDb(d), w: Math.abs(d) });
      });
      out.mix.sort((a, b) => b.w - a.w);
      out.mix = out.mix.slice(0, 5);
      if (st.bus.glue.on) out.mix.push({ t: 'Compressão de bus leve', v: 'GR ' + UI.fmtNum(st.bus.glue.gr) });
    }
    const c = st.master.chain;
    if (c.dyn.on) out.master.push({ t: 'Dynamic EQ: lama @ 320 Hz', v: UI.fmtNum(c.dyn.mud) });
    if (Math.abs(c.eq.air) > 0.1) out.master.push({ t: 'Shelf de ar @ 9 kHz', v: UI.fmtDb(c.eq.air) });
    if (Math.abs(c.eq.low) > 0.1) out.master.push({ t: 'Low shelf @ 80 Hz', v: UI.fmtDb(c.eq.low) });
    if (c.glue.on) out.master.push({ t: `Glue de bus ${UI.fmtNum(c.glue.ratio, 0)}:1`, v: 'GR ' + UI.fmtNum(c.glue.gr) });
    if (c.sat.on || c.clip.on) out.master.push({ t: 'Saturação e clipper', v: Math.round(c.sat.drive * 100) + ' %' });
    out.master.push({ t: `Limiter true-peak, alvo ${UI.fmtNum(st.master.target, Number.isInteger(st.master.target) ? 0 : 1)} LUFS`, v: 'GR ' + UI.fmtNum(st.masterGR || 0) });
    return out;
  }

  V.compare = {
    flush: true,
    render(app) {
      const st = app.state, m = st.metrics, e = app.engine;
      const ref = st.refs.find((r) => r.id === st.activeRef);
      const card = (k, name, met, peaks, score, color) => `<div class="vcard ${e.monitor === k ? 'on' : ''}" data-mon="${k}">
        <div class="row" style="justify-content:space-between"><b style="font-size:16px">${name}</b><span class="mono muted">${met ? UI.fmtNum(met.lufs) + ' LUFS' : '—'}</span></div>
        <canvas data-vc="${k}" data-col="${color}"></canvas>
        <div class="vstats"><div><div class="k">TP dBTP</div><div class="v">${met ? UI.fmtNum(met.tp) : '—'}</div></div><div><div class="k">LRA</div><div class="v">${met ? UI.fmtNum(met.lra) : '—'}</div></div><div><div class="k">PLR</div><div class="v">${met ? UI.fmtNum(met.plr) : '—'}</div></div><div><div class="k">Score</div><div class="v">${score || '—'}</div></div></div>
      </div>`;
      const ch = changes(app);
      const alts = st.alternatives || [];
      return `<div style="display:grid;grid-template-columns:minmax(0,1fr) 380px;height:100%">
        <div style="overflow:auto;padding:22px 24px">
          <h1>Ouvir e comparar</h1>
          <p class="muted" style="margin:6px 0 16px">Alterna entre Original, Mix e Master enquanto a música toca. Com o loudness match ligado, ouves só a diferença de som e não de volume.</p>
          ${V.listenHTML(app)}
          <div style="margin:12px 4px 0" class="row"><span class="mono small" id="cpNow">0:00</span><div class="bar" style="flex:1;height:5px;cursor:pointer" id="cpBar"><i id="cpFill" style="width:0"></i></div><span class="mono small">${D.fmtTime(e.duration()).slice(0, 5)}</span></div>
          <div class="grid3" style="margin-top:18px;${ref ? 'grid-template-columns:repeat(4,1fr)' : ''}">
            ${card('orig', 'Original', m.orig, st.origPeaks, st.scoreOrig, '#9aa3b4')}
            ${card('mix', 'Mix', m.mix, st.mixPeaks, st.mixScore ? st.mixScore.overall : null, '#e9edf4')}
            ${card('master', 'Master', m.master, st.masterPeaks, st.score ? st.score.overall : null, '#5eead4')}
            ${ref ? card('ref', 'Referência', ref.metrics, null, null, '#f5b14c') : ''}
          </div>
          <div class="panel p" style="margin-top:18px"><div class="row" style="justify-content:space-between"><div class="eyebrow">Espectro · as três versões, mesmo volume</div><div class="row small muted" style="gap:14px"><span style="color:#9aa3b4">— Original</span><span style="color:#e9edf4">— Mix</span><span style="color:#5eead4">— Master</span>${ref ? '<span style="color:#f5b14c">— Referência</span>' : ''}</div></div><canvas id="cspec" style="width:100%;height:280px;display:block;margin-top:10px"></canvas></div>
          <div class="panel p" style="margin-top:18px">
            <div class="row" style="justify-content:space-between"><div><div class="eyebrow">Alternativas da IA</div><div class="small muted" style="margin-top:4px">Quatro direções diferentes da mesma sessão. Alterna instantaneamente enquanto ouves — sem renderizar.</div></div><button class="btn ${alts.length ? '' : 'acc'} sm" id="genAlt" ${app.ready() ? '' : 'disabled'}>${UI.icon('layers')}${alts.length ? 'Regenerar' : 'Gerar 4 alternativas'}</button></div>
            ${alts.length ? `<div class="alts" style="margin-top:14px">${alts.map((a) => `<button data-alt="${a.id}" class="${st.activeAlt === a.id ? 'on' : ''}"><b>Mix ${a.id} — ${a.name}</b><small>${MM.DIR.filter(([k]) => Math.abs(a.direction[k] - 50) > 25).map(([k, l, r]) => (a.direction[k] > 50 ? r : l)).slice(0, 3).join(' · ') || 'equilibrada'}</small></button>`).join('')}</div><div class="row" style="margin-top:12px"><button class="btn sm" id="keepAlt" ${st.activeAlt ? '' : 'disabled'}>${UI.icon('save')}Guardar como versão e renderizar</button></div>` : ''}
          </div>
          <div class="panel p" style="margin-top:18px"><div class="eyebrow">Versões</div><div class="row wrap" style="margin-top:12px">${st.versions.map((v) => `<button class="chip ${v.id === st.currentVersion ? 'on' : ''}" data-ver="${v.id}">${UI.esc(v.name)}${v.lufs ? ` · <span class="mono">${UI.fmtNum(v.lufs)}</span>` : ''}${v.score ? ` · ${v.score}` : ''}</button>`).join('') || '<span class="muted small">Ainda sem versões.</span>'}<button class="chip dashed" id="saveVer" ${app.ready() ? '' : 'disabled'}>${UI.icon('plus')}Guardar versão atual</button></div></div>
        </div>
        <aside style="border-left:1px solid var(--line);overflow:auto"><div class="pad">
          <div class="eyebrow">O que mudou</div>
          ${st.mode !== 'master' ? `<h3 style="margin:14px 0 6px">Original → Mix</h3><div class="changes">${ch.mix.map((c) => `<div class="ln"><span>${UI.esc(c.t)}</span><span>${UI.esc(c.v)}</span></div>`).join('')}</div>` : ''}
          <h3 style="margin:20px 0 6px" class="acc-t">Mix → Master</h3><div class="changes">${ch.master.map((c) => `<div class="ln"><span>${UI.esc(c.t)}</span><span>${UI.esc(c.v)}</span></div>`).join('')}</div>
          <div class="tip" style="margin-top:22px">Dica: liga o loudness match e alterna no refrão. O que soa melhor sem ser mais alto é a diferença real do processamento.</div>
        </div></aside>
      </div>`;
    },
    mount(app, root) {
      const st = app.state;
      root.querySelectorAll('canvas[data-vc]').forEach((cv) => {
        const k = cv.dataset.vc;
        let pk = k === 'orig' ? st.origPeaks : k === 'mix' ? st.mixPeaks : k === 'master' ? st.masterPeaks : null;
        if (k === 'ref') { const r = st.refs.find((x) => x.id === st.activeRef); if (r) pk = r.peaks || (r.peaks = MM.peaks(D.channelsOf(r.buffer), 900)); }
        UI.drawWave(cv, pk, cv.dataset.col, { gap: true, norm: false });
      });
      V.compare.drawSpec(app, root);
      const bar = root.querySelector('#cpBar');
      bar.onclick = (e) => { const r = bar.getBoundingClientRect(); app.ensureAudio().then(() => app.engine.seek(((e.clientX - r.left) / r.width) * app.engine.duration())); };
      const g = root.querySelector('#genAlt'); if (g) g.onclick = () => app.makeAlternatives();
      root.querySelectorAll('[data-alt]').forEach((b) => (b.onclick = () => app.useAlternative(b.dataset.alt)));
      const ka = root.querySelector('#keepAlt'); if (ka) ka.onclick = () => { const a = st.alternatives.find((x) => x.id === st.activeAlt); app.runAI({ keepMix: true, versionName: `Mix ${a.id} — ${a.name}` }); };
      root.querySelectorAll('[data-ver]').forEach((b) => (b.onclick = () => app.loadVersion(b.dataset.ver)));
      const sv = root.querySelector('#saveVer'); if (sv) sv.onclick = () => { MM.saveVersion(st); app.refresh(); UI.toast('Versão guardada: ' + st.currentVersionName, 'ok'); };
    },
    drawSpec(app, root) {
      const cv = root.querySelector('#cspec'); if (!cv) return;
      const st = app.state, { ctx, w, h } = UI.fitCanvas(cv);
      const x0 = 10, gw = w - 20, gh = h - 24;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#626b7c'; ctx.font = '10.5px Geist Mono, monospace';
      [20, 100, 500, 1000, 2000, 5000, 10000].forEach((f) => { const x = x0 + (Math.log10(f / 20) / 3) * gw; ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(x, 0, 1, gh); ctx.fillStyle = '#626b7c'; ctx.fillText(f >= 1000 ? f / 1000 + 'k' : f, x + 3, h - 6); });
      const curves = [[st.metrics.orig, '#9aa3b4'], [st.metrics.mix, '#e9edf4'], [st.metrics.master, '#5eead4']];
      const ref = st.refs.find((r) => r.id === st.activeRef); if (ref) curves.push([ref.metrics, '#f5b14c']);
      curves.forEach(([m, col]) => {
        if (!m || !m.spectrum) return;
        const freqs = m.spectrum.freqs, db = m.spectrum.db.map((_, i, a) => { let s2 = 0, n = 0; for (let j = Math.max(0, i - 3); j <= Math.min(a.length - 1, i + 3); j++) { s2 += Math.pow(10, a[j] / 10); n++; } return 10 * Math.log10(s2 / n); });
        const idx = freqs.map((f, i) => (f > 100 && f < 4000 ? i : -1)).filter((i) => i >= 0);
        const mean = D.mean(idx.map((i) => db[i]));
        ctx.beginPath(); ctx.strokeStyle = col; ctx.lineWidth = col === '#5eead4' ? 2.2 : 1.7;
        freqs.forEach((f, i) => { const x = x0 + (Math.log10(f / 20) / 3) * gw, y = D.clamp(0.25 - (db[i] - mean) / 70, 0, 1) * gh; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.stroke();
      });
    },
    frame(app) {
      const f = document.getElementById('cpFill'); if (!f) return;
      const p = app.engine.position(), d = app.engine.duration() || 1;
      f.style.width = (p / d) * 100 + '%';
      document.getElementById('cpNow').textContent = D.fmtTime(p).slice(0, 5);
    },
    onMonitor(app) {
      document.querySelectorAll('.listen [data-mon], .vcard[data-mon]').forEach((b) => b.classList.toggle('on', b.dataset.mon === app.engine.monitor));
      const lm = document.querySelector('.listen .opt.lm');
      if (lm) { lm.classList.toggle('on', app.engine.lm); lm.querySelector('b').textContent = 'Loudness match ' + (app.engine.lm ? 'ligado' : 'desligado'); }
    },
  };

  // ================= REFERÊNCIAS =================
  V.refs = {
    flush: true,
    render(app) {
      const st = app.state, ref = st.refs.find((r) => r.id === st.activeRef);
      const mine = st.metrics.master || st.metrics.mix;
      let center = `<div class="empty-note" style="margin-top:80px">${st.refs.length ? '' : 'Adiciona até 3 faixas de referência. A IA analisa tonalidade, loudness, dinâmica e estéreo — orienta, não copia.'}</div>`;
      let right = '';
      if (ref && mine) {
        const d = MM.referenceDiff(mine, ref.metrics);
        const mx = Math.max(3, ...d.diff.map(Math.abs));
        center = `<h1>A tua mix vs ${UI.esc(ref.name)}</h1><p class="muted" style="margin:6px 0 18px">Diferença por banda, depois de igualar o volume. Positivo = a tua mix tem mais energia.</p>
          <div class="panel p">${D.BANDS7.map((b, i) => { const v = d.diff[i], wpc = (Math.abs(v) / mx) * 50, good = Math.abs(v) < 0.8; return `<div class="bandrow"><span>${b.name} (${b.lo >= 1000 ? b.lo / 1000 : b.lo}–${b.hi >= 1000 ? b.hi / 1000 + ' kHz' : b.hi + ' Hz'})</span><div class="bb"><div class="z"></div><i style="${v >= 0 ? 'left:50%' : 'right:50%'};width:${wpc}%;background:${good ? 'var(--acc)' : 'var(--warn)'}"></i></div><span class="d ${good ? 'acc-t' : 'warn-t'}">${UI.fmtDb(v)} dB</span><small>${UI.esc(d.notes[i])}</small></div>`; }).join('')}</div>
          <div class="tiles" style="grid-template-columns:repeat(4,1fr)">
            <div class="tile"><div class="k">LUFS-I</div><div class="v">${UI.fmtNum(mine.lufs)}</div><small>vs ${UI.fmtNum(ref.metrics.lufs)}</small></div>
            <div class="tile"><div class="k">LRA</div><div class="v">${UI.fmtNum(mine.lra)}</div><small>vs ${UI.fmtNum(ref.metrics.lra)}</small></div>
            <div class="tile"><div class="k">LARGURA</div><div class="v">${MM.widthPct(mine.width)} %</div><small>vs ${MM.widthPct(ref.metrics.width)} %</small></div>
            <div class="tile"><div class="k">CORRELAÇÃO</div><div class="v">${(mine.corr >= 0 ? '+' : '') + UI.fmtNum(mine.corr, 2)}</div><small>vs ${(ref.metrics.corr >= 0 ? '+' : '') + UI.fmtNum(ref.metrics.corr, 2)}</small></div>
          </div>`;
        right = `<div class="eyebrow">O que a IA aprendeu</div><div class="learned">${d.learned.map(([k, t]) => `<b>${k}</b><p>${UI.esc(t)}</p>`).join('')}<b>Confiança</b><p>${ref.genre && ref.genre === st.music.genre ? 'Alta: a referência é do mesmo género e andamento.' : 'Média: confirma que a referência é do mesmo estilo.'}</p></div>
          <div class="tip" style="margin-top:20px">A referência orienta o alvo de tom e dinâmica. Não copia a música: a decisão final continua a ser tua.</div>`;
      } else if (ref) center = '<div class="empty-note" style="margin-top:80px">Corre o AI Mix &amp; Master para comparar a tua mix com a referência.</div>';
      return `<div class="refs">
        <div class="pad">
          <div class="eyebrow">Faixas de referência</div>
          <div style="margin-top:12px">${st.refs.map((r, i) => `<div class="refcard ${r.id === st.activeRef ? 'on' : ''}" data-ref="${r.id}"><div class="row"><b>Referência ${'ABC'[i]} · ${UI.esc(r.name)}</b><span class="mono small muted">${UI.fmtNum(r.metrics.lufs)} LUFS</span></div><small>${D.fmtTime(r.metrics.duration).slice(0, 5)} · ${UI.esc(r.note)}</small><div class="row" style="margin-top:8px"><button class="btn xs" data-listen="${r.id}">${UI.icon('play')}Ouvir</button><button class="btn xs ghost" data-del="${r.id}">${UI.icon('trash')}</button></div></div>`).join('')}</div>
          ${st.refs.length < 3 ? `<div class="drop" data-refdrop style="padding:26px 16px;margin-top:6px"><div class="muted">Arrasta uma faixa aqui</div><div class="small dim" style="margin-top:4px">WAV, FLAC, MP3 · até 3 referências</div><button class="btn sm" style="margin-top:10px" id="pickRef">${UI.icon('plus')}Escolher ficheiro</button></div>` : ''}
          <div class="eyebrow" style="margin-top:24px">Influência da referência</div>
          <div class="seg acc" style="margin-top:10px">${[0, 30, 60, 100].map((v) => `<button data-inf="${v}" class="${Math.round(st.refInfluence * 100) === v ? 'on' : ''}">${v} %</button>`).join('')}</div>
          <div class="eyebrow" style="margin-top:24px">Aplicar em</div>
          <div class="seg acc" style="margin-top:10px"><button data-ap="mix" class="${st.refApply.mix ? 'on' : ''}">Mix</button><button data-ap="master" class="${st.refApply.master ? 'on' : ''}">Master</button></div>
          ${st.refs.length ? `<button class="btn acc" style="width:100%;margin-top:22px" id="applyRef" ${app.ready() ? '' : 'disabled'}>${UI.icon('spark')}Aproximar da referência</button>` : ''}
        </div>
        <div class="c">${center}</div>
        <div class="pad">${right}</div>
      </div>`;
    },
    mount(app, root) {
      const st = app.state;
      const add = async (files) => {
        for (const f of Array.from(files).slice(0, 3 - st.refs.length)) {
          try {
            await app.ensureAudio();
            const { ab, buf } = await MM.decodeFile(app.engine.ctx, f);
            const chs = [buf.getChannelData(0).slice(), (buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)).slice()];
            UI.toast('A analisar a referência…', 'ok', 1500);
            await app.addReference(f.name, chs, ab);
          } catch (e) { UI.toast('Não foi possível ler ' + f.name, 'err'); }
        }
        app.saveSoon(); app.refresh(); app.renderTop();
      };
      const pr = root.querySelector('#pickRef'); if (pr) pr.onclick = () => app.pickFiles({ multiple: true, onFiles: add });
      const dz = root.querySelector('[data-refdrop]');
      if (dz) { dz.addEventListener('drop', async (e) => { e.preventDefault(); add(await app.filesFromDrop(e.dataTransfer)); }); }
      root.querySelectorAll('[data-ref]').forEach((c) => (c.onclick = (e) => { if (e.target.closest('button')) return; app.setActiveRef(c.dataset.ref); app.refresh(); app.renderTop(); }));
      root.querySelectorAll('[data-listen]').forEach((b) => (b.onclick = () => { app.setActiveRef(b.dataset.listen); app.renderTop(); app.setMonitor('ref'); if (!app.engine.playing) app.togglePlay(); app.refresh(); }));
      root.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => app.change('Remover referência', () => { st.refs = st.refs.filter((r) => r.id !== b.dataset.del); if (st.activeRef === b.dataset.del) { st.activeRef = st.refs[0] ? st.refs[0].id : null; } app.setActiveRef(st.activeRef); if (app.engine.monitor === 'ref') app.engine.setMonitor('mix'); }, {})));
      root.querySelectorAll('[data-inf]').forEach((b) => (b.onclick = () => app.change('Influência da referência', () => { st.refInfluence = +b.dataset.inf / 100; }, {})));
      root.querySelectorAll('[data-ap]').forEach((b) => (b.onclick = () => app.change('Aplicar referência em ' + b.dataset.ap, () => { st.refApply[b.dataset.ap] = !st.refApply[b.dataset.ap]; }, {})));
      const ar = root.querySelector('#applyRef');
      if (ar) ar.onclick = async () => {
        app.change('Aproximar da referência', () => { delete st.master.manual.target; delete st.master.manual.eq; if (st.refApply.mix) MM.applyRefToMix(st); }, { bus: true });
        await app.runAI({ keepMix: true });
      };
    },
  };
})();
