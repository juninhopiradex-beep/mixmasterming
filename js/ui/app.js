/* MIXMIND — controlador da aplicação */
(function () {
  const MM = (window.MM = window.MM || {});
  const D = MM.dsp, UI = MM.ui;
  MM.views = MM.views || {};

  const App = (MM.app = {
    state: MM.newState(), engine: new MM.Engine(), view: 'home', selected: null, chat: [], busy: false,
    progress: null, steps: null, recent: [], raf: 0,
  });

  const NAV = [
    ['import', 'Importar', 'upload'], ['mixer', 'Mixer', 'sliders'], ['arrange', 'Arranjo', 'layers'], ['analysis', 'Análise', 'activity'],
    ['automation', 'Automação', 'auto'], ['master', 'Master', 'gauge'], ['compare', 'Comparar', 'compare'], ['refs', 'Referências', 'target'],
    ['export', 'Exportar', 'download'],
  ];

  // ---------- arranque ----------
  App.boot = async function () {
    document.getElementById('app').innerHTML = '<header class="topbar"></header><nav class="nav"></nav><div class="workspace"></div><footer class="dock" style="display:none"></footer>';
    App.engine.on((ev) => { if (['play', 'pause', 'stop', 'end', 'monitor'].includes(ev)) App.renderTop(); App.renderDockButtons(); });
    App.bindGlobal();
    App.recent = await MM.listProjects();
    App.render();
    App.loop();
    // recuperação: a última sessão não foi fechada normalmente (crash, separador morto, falta de luz)
    const rcv = MM.project.pendingRecovery();
    if (rcv && App.recent.some((r) => r.id === rcv.id)) {
      UI.confirm('Recuperar sessão', `A sessão “${UI.esc(rcv.name)}” não foi fechada normalmente (${new Date(rcv.t).toLocaleString('pt-PT')}). Queres reabri-la com as últimas decisões guardadas?`, 'Recuperar').then((ok) => { if (ok) App.openProject(rcv.id); else MM.project.markClosed(); });
    }
    MM.styles.load().then(() => { MM.styles.loaded = true; if (App.view === 'styles') App.refresh(); if (MM.cloud) MM.cloud.loadLibrary().then((n) => { if (n && App.view === 'styles') App.refresh(); }); });
    if (MM.engineer) MM.engineer.load();
  };

  App.ensureAudio = async function () {
    if (!App.engine.ctx) { await App.engine.init(); App.engine.idle(); }
    return App.engine.ctx;
  };

  // ---------- render ----------
  App.render = function () { App.renderTop(); App.renderNav(); App.renderView(); App.renderDock(); };
  App.ready = () => App.state.stage === 'ready';
  App.hasSession = () => ['review', 'ready'].includes(App.state.stage);

  App.renderTop = function () {
    const st = App.state, e = App.engine, top = UI.$('.topbar');
    if (!top) return;
    const vers = st.versions;
    const dirty = st.dirty && (st.dirty.mix || st.dirty.master) && App.ready();
    const mon = e.monitor;
    const hasRef = !!st.refBuffer;
    top.innerHTML = `
      <div class="brand" ${App.hasSession() ? '' : 'data-view="home" style="cursor:pointer"'}>${UI.logo()}<span class="brand-name">MIXMIND <em>by Piradex</em></span> <small>AI Mixing & Mastering · v${MM.VERSION}</small></div>
      ${App.hasSession() ? `<div class="proj"><input class="proj-name" value="${UI.esc(st.project.name)}" spellcheck="false" title="Nome do projeto">
        ${vers.length ? `<select class="field" id="verSel" style="height:32px;width:auto;font-size:13px">${vers.map((v) => `<option value="${v.id}"${v.id === st.currentVersion ? ' selected' : ''}>${UI.esc(v.name)}${v.score ? ' · ' + v.score : ''}</option>`).join('')}</select>` : ''}</div>` : ''}
      <div class="spacer"></div>
      ${App.hasSession() ? `<div class="monitor">
        <button class="playbtn" data-act="play" title="Play/pausa (Espaço)">${UI.icon(e.playing ? 'pause' : 'play')}</button>
        <div class="seg lg acc" id="monSeg">
          <button data-mon="orig" class="${mon === 'orig' ? 'on' : ''}" title="1">Original</button>
          <button data-mon="mix" class="${mon === 'mix' ? 'on' : ''}" title="2">Mix</button>
          <button data-mon="master" class="${mon === 'master' ? 'on' : ''}" ${App.ready() ? '' : 'disabled'} title="3">Master</button>
          ${hasRef ? `<button data-mon="ref" class="${mon === 'ref' ? 'on' : ''}" title="4">Ref</button>` : ''}
        </div>
        <button class="lm ${e.lm ? 'on' : ''}" data-act="lm" title="Loudness match (L)">LM ${e.lm ? 'on' : 'off'}</button>
        ${st.stems.some((x) => x.solo && !x.removed) ? `<button class="solo-clear" data-act="clearSolo" title="Desligar todos os solos">SOLO ✕</button>` : ''}
      </div>
      <span class="target-chip">${UI.fmtNum(st.master.target)} LUFS / ${UI.fmtNum(st.master.ceiling)} dBTP</span>
      <span class="status-pill ${App.busy ? 'busy' : dirty ? 'dirty' : ''}"><span class="dot"></span>${App.busy ? 'A processar…' : dirty ? 'Alterações por renderizar' : App.ready() ? 'Sincronizado' : 'Pronto para a IA'}</span>
      <button class="btn icon ghost" data-act="undo" title="Desfazer (Ctrl+Z)">${UI.icon('undo')}</button>
      <button class="btn icon ghost" data-act="redo" title="Refazer (Ctrl+Shift+Z)">${UI.icon('redo')}</button>
      ${dirty && !App.busy ? `<button class="btn acc" data-act="update" title="Renderizar premaster e master com as tuas alterações">${UI.icon('activity')}Atualizar</button>` : ''}
      <button class="btn primary ${App.busy ? 'busy' : ''}" data-act="ai">${UI.icon('spark')}AI Mix &amp; Master</button>
      ` : ''}
      <button class="btn icon ghost" data-act="palette" title="Comandos (Ctrl+K)">${UI.icon('search')}</button>`;
  };

  App.renderNav = function () {
    const nav = UI.$('.nav'), st = App.state;
    if (!nav) return;
    nav.style.display = '';
    if (!App.hasSession() && st.stage !== 'analyzing') {
      nav.innerHTML = `<a data-view="home" class="${App.view === 'home' ? 'on' : ''}">${UI.icon('upload')}Início</a><a data-view="styles" class="${App.view === 'styles' ? 'on' : ''}">${UI.icon('brain')}Estilos · treino</a><a data-view="plugin" class="${App.view === 'plugin' ? 'on' : ''}">${UI.icon('plug')}MIXMIND Master</a><a data-view="album" class="${App.view === 'album' ? 'on' : ''}">${UI.icon('disc') || UI.icon('music')}Álbum · DDP</a><div class="spacer"></div><a data-view="settings" class="${App.view === 'settings' ? 'on' : ''}">${UI.icon('gear')}Definições</a>`;
      return;
    }
    const items = st.mode === 'master' ? NAV.filter(([k]) => ['master', 'compare', 'refs', 'export'].includes(k)) : NAV;
    const unres = (st.issues || []).filter((i) => !i.resolved).length;
    nav.innerHTML = items.map(([k, l, ic]) => {
      const dis = !App.hasSession() && k !== 'import';
      return `<a data-view="${k}" class="${App.view === k ? 'on' : ''}" ${dis ? 'style="opacity:.35;pointer-events:none"' : ''}>${UI.icon(ic)}${l}${k === 'import' && unres ? ` <span class="badge">${unres}</span>` : ''}</a>`;
    }).join('') + `<span class="sep"></span><a data-view="styles" class="${App.view === 'styles' ? 'on' : ''}">${UI.icon('brain')}Estilos</a><a data-view="plugin" class="${App.view === 'plugin' ? 'on' : ''}">${UI.icon('plug')}MIXMIND Master</a><a data-view="album" class="${App.view === 'album' ? 'on' : ''}">${UI.icon('disc') || UI.icon('music')}Álbum</a><div class="spacer"></div><a data-view="settings" class="${App.view === 'settings' ? 'on' : ''}">${UI.icon('gear')}Definições</a>`;
  };

  App.renderView = function () {
    const ws = UI.$('.workspace');
    if (App.curView && App.curView.unmount) App.curView.unmount(App);
    let id = App.view;
    if (!App.hasSession() && !['settings', 'plugin', 'styles', 'album'].includes(id)) id = 'home';
    const v = MM.views[id] || MM.views.home;
    App.curView = v;
    ws.innerHTML = `<div class="view ${v.flush ? 'flush' : ''}">${v.render(App)}</div>`;
    const root = ws.firstElementChild;
    UI.bindRanges(root);
    if (v.mount) v.mount(App, root);
  };
  /** Re-render apenas da vista atual (mantendo o scroll). */
  App.refresh = function () {
    const ws = UI.$('.workspace');
    const sc = Array.from(ws.querySelectorAll('.view, aside, main, .view > div > div')).map((e) => e.scrollTop);
    App.renderView();
    Array.from(ws.querySelectorAll('.view, aside, main, .view > div > div')).forEach((e, i) => { if (sc[i]) e.scrollTop = sc[i]; });
    App.renderTop();
  };
  App.go = function (v) {
    App.view = v; App.closeEditor && App.closeEditor();
    App.renderNav(); App.renderView(); App.renderDock();
  };

  // ---------- dock ----------
  App.renderDock = function () {
    const dk = UI.$('.dock');
    if (!App.hasSession() || App.view === 'plugin' || App.view === 'styles' || App.view === 'album') { dk.style.display = 'none'; return; }
    dk.style.display = '';
    dk.innerHTML = `
      <div class="tp">
        <div class="tbtns">
          <button class="btn" data-act="toStart" title="Início (Home)">${UI.icon('back')}</button>
          <button class="btn play" data-act="play" title="Espaço">${UI.icon('play')}</button>
          <button class="btn" data-act="stop">${UI.icon('stop')}</button>
          <button class="btn" data-act="loop" title="Loop da secção atual">${UI.icon('loop')}</button>
        </div>
        <div class="time"><span id="tNow">00:00.0</span> <small>/ <span id="tDur">00:00.0</span></small></div>
        <div class="looplbl" id="loopLbl"></div>
      </div>
      <div class="timeline"><canvas id="tl"></canvas></div>
      <div class="mt">
        <div><div class="k">LUFS-I</div><div class="v" id="mI">—</div></div>
        <div><div class="k">LUFS-S</div><div class="v" id="mS">—</div></div>
        <div><div class="k">LUFS-M</div><div class="v" id="mM">—</div></div>
        <div><div class="k">TRUE PEAK</div><div class="v" id="mTP">—</div></div>
        <div><div class="k">CORREL.</div><div class="v" id="mC">—</div></div>
        <div><div class="k">GR</div><div class="v" id="mGR">—</div></div>
      </div>`;
    const tl = UI.$('#tl');
    tl.addEventListener('pointerdown', (ev) => {
      const r = tl.getBoundingClientRect();
      const t = ((ev.clientX - r.left) / r.width) * App.engine.duration();
      if (ev.clientY - r.top < 22 && App.state.music) {
        const s = App.state.music.sections.find((x) => t >= x.start && t < x.end);
        if (s) { App.setLoop(App.engine.loop && App.engine.loop[0] === s.start ? null : s); return; }
      }
      App.ensureAudio().then(() => App.engine.seek(t));
    });
    App.renderDockButtons();
  };
  App.renderDockButtons = function () {
    const b = UI.$('.dock [data-act=play]');
    if (b) b.innerHTML = UI.icon(App.engine.playing ? 'pause' : 'play');
    const l = UI.$('.dock [data-act=loop]');
    if (l) l.classList.toggle('on', !!App.engine.loop);
    const pb = UI.$('.topbar .playbtn');
    if (pb) pb.innerHTML = UI.icon(App.engine.playing ? 'pause' : 'play');
  };
  App.setLoop = function (sec) {
    App.engine.loop = sec ? [sec.start, sec.end] : null;
    App.loopName = sec ? sec.name : '';
    const ll = UI.$('#loopLbl'); if (ll) ll.textContent = sec ? 'Loop · ' + sec.name : '';
    App.renderDockButtons();
    if (sec && App.engine.playing) App.engine.play(sec.start);
  };
  App.currentPeaks = function () {
    const st = App.state, m = App.engine.monitor;
    if (m === 'master' && st.masterPeaks) return st.masterPeaks;
    if (m === 'orig' && st.origPeaks) return st.origPeaks;
    return st.mixPeaks || st.origPeaks || st.stemSumPeaks;
  };
  App.drawTimeline = function () {
    const cv = UI.$('#tl');
    if (!cv) return;
    const { ctx, w, h } = UI.fitCanvas(cv);
    const st = App.state, dur = App.engine.duration() || 1, pos = App.engine.position();
    ctx.clearRect(0, 0, w, h);
    const top = 22;
    if (st.music && st.mode !== 'master') {
      st.music.sections.forEach((s, i) => {
        const x0 = (s.start / dur) * w, x1 = (s.end / dur) * w;
        const on = App.engine.loop && App.engine.loop[0] === s.start;
        ctx.fillStyle = on ? 'rgba(94,234,212,.28)' : i % 2 ? 'rgba(94,234,212,.09)' : 'rgba(94,234,212,.14)';
        ctx.fillRect(x0 + 1, 0, x1 - x0 - 2, 18);
        ctx.fillStyle = '#d6e4e1'; ctx.font = '11px Geist, Inter, sans-serif';
        ctx.save(); ctx.beginPath(); ctx.rect(x0, 0, x1 - x0 - 4, 18); ctx.clip(); ctx.fillText(s.name, x0 + 6, 13); ctx.restore();
        ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(x0, top, 1, h - top);
      });
    }
    const pk = App.currentPeaks();
    if (pk) {
      const n = pk.length; let mx = 0.0001; for (let i = 0; i < n; i++) mx = Math.max(mx, pk[i]);
      const mid = top + (h - top) / 2, hh = (h - top) / 2 - 2;
      for (let x = 0; x < w; x += 3) {
        const i = Math.floor((x / w) * n), v = pk[i] / mx;
        const played = (x / w) * dur < pos;
        ctx.fillStyle = App.engine.monitor === 'orig' ? (played ? '#c7cdd8' : '#5d6574') : played ? '#7ff2de' : 'rgba(94,234,212,.42)';
        ctx.fillRect(x, mid - v * hh, 2, Math.max(1, v * hh * 2));
      }
    }
    if (App.engine.loop) {
      const [a, b] = App.engine.loop;
      ctx.fillStyle = 'rgba(94,234,212,.06)'; ctx.fillRect((a / dur) * w, top, ((b - a) / dur) * w, h - top);
    }
    const px = (pos / dur) * w;
    ctx.fillStyle = '#fff'; ctx.fillRect(px - 0.5, 0, 1.5, h);
  };

  // ---------- ciclo de animação ----------
  App.loop = function () {
    const tick = () => {
      App.raf = requestAnimationFrame(tick);
      const e = App.engine;
      if (!App.hasSession()) { if (App.curView && App.curView.frame) App.curView.frame(App); return; }
      const tn = UI.$('#tNow');
      if (tn) { tn.textContent = D.fmtTime(e.position()); UI.$('#tDur').textContent = D.fmtTime(e.duration()); }
      App.drawTimeline();
      const m = e.meter;
      const set = (id, v, warn) => { const el = UI.$(id); if (el) { el.textContent = v; el.classList.toggle('warn', !!warn); } };
      if (e.playing) {
        set('#mI', m.I > -69 ? UI.fmtNum(m.I) : '—'); set('#mS', m.S > -69 ? UI.fmtNum(m.S) : '—'); set('#mM', m.M > -69 ? UI.fmtNum(m.M) : '—');
        set('#mTP', m.tpMax > -69 ? UI.fmtNum(m.tpMax) : '—', m.tpMax > App.state.master.ceiling);
        set('#mC', (m.corr >= 0 ? '+' : '') + UI.fmtNum(m.corr, 2));
        const gr = App.engine.graph && App.engine.graph.gr ? App.engine.graph.gr.mLim || 0 : 0;
        set('#mGR', e.monitor === 'master' ? UI.fmtNum(gr) + ' dB' : '—');
      } else if (App.state.metrics.master && e.monitor === 'master') {
        const mm = App.state.metrics.master;
        set('#mI', UI.fmtNum(mm.lufs)); set('#mS', UI.fmtNum(mm.stMax)); set('#mM', UI.fmtNum(mm.mMax)); set('#mTP', UI.fmtNum(mm.tp), mm.tp > App.state.master.ceiling + 0.05); set('#mC', '+' + UI.fmtNum(mm.corr, 2)); set('#mGR', '—');
      }
      if (App.curView && App.curView.frame) App.curView.frame(App);
    };
    tick();
  };

  // ---------- transporte ----------
  App.togglePlay = async function () {
    await App.ensureAudio();
    if (!App.engine.graph) return;
    if (App.engine.playing) App.engine.pause(); else { App.engine.resetMeter(); App.engine.play(); }
  };
  App.setMonitor = function (m) {
    if (m === 'master' && !App.ready()) return;
    if (m === 'ref' && !App.state.refBuffer) return;
    if (m === 'codec' && !App.state.codecBuf) return;
    App.engine.setMonitor(m); App.renderTop();
    if (App.curView && App.curView.onMonitor) App.curView.onMonitor(App);
  };

  // ---------- importação e análise ----------
  App.importFiles = async function (files) {
    files = Array.from(files).filter((f) => /\.(wav|wave|aif|aiff|flac|mp3|m4a|ogg|caf)$/i.test(f.name) || /^audio\//.test(f.type));
    if (!files.length) { UI.toast('Nenhum ficheiro de áudio reconhecido (WAV, AIFF, FLAC, MP3).', 'warn'); return; }
    if (App.busy) { UI.toast('Espera que o processamento atual termine.', 'warn'); return; }
    await App.ensureAudio();
    const adding = App.hasSession() && App.state.mode === 'stems';
    if (!adding) { App.resetSession(); }
    const st = App.state;
    st.sampleRate = App.engine.sampleRate;
    st.stage = 'analyzing'; App.view = 'import';
    App.steps = { import: [0, ''], identify: [0, ''], music: [0, ''], plan: [0, ''], render: [0, ''] };
    App.render();
    const failed = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        const { ab, header, buf } = await MM.decodeFile(App.engine.ctx, f);
        const chs = []; for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
        st.stems.push(MM.makeStem(f.name, chs, st.sampleRate, header, ab, buf));
      } catch (e) { console.warn(e); failed.push(f.name); }
      App.step('import', (i + 1) / files.length, `${i + 1} / ${files.length}`);
      await D.yieldUI();
    }
    if (failed.length) UI.toast(`Não foi possível ler: ${failed.join(', ')}`, 'err', 6000);
    if (!st.stems.length) { App.resetSession(); App.render(); return; }
    if (!adding && files.length && /\.(wav|aif|flac)/i.test(files[0].name)) st.project.name = App.guessName(files);
    await App.analyze();
  };
  App.guessName = function (files) {
    const p = files[0].webkitRelativePath;
    if (p && p.includes('/')) return p.split('/')[0];
    return 'Nova sessão — ' + new Date().toLocaleDateString('pt-PT');
  };
  App.step = function (k, p, txt) {
    if (!App.steps) return;
    App.steps[k] = [p, txt || ''];
    if (App.curView && App.curView.onStep) App.curView.onStep(App, k);
    App.updateProgressFloat();
  };
  App.analyze = async function () {
    const st = App.state;
    App.busy = true; App.renderTop();
    try {
      await MM.analyzeSession(st, App.step);
      // referências entregues junto dos stems
      for (const s of st.pendingRefs || []) await App.addReference(s.name, s.chs, s.raw, true);
      st.pendingRefs = [];
      st.stemSumPeaks = (() => { const pk = new Float32Array(900); st.stems.forEach((s) => { if (s.removed) return; const p = MM.peaks(s.chs, 900); for (let i = 0; i < 900; i++) pk[i] += p[i]; }); return pk; })();
      App.engine.rebuild(st);
      App.engine.setLoudness({ orig: 0, mix: 0, master: 0, ref: 0 });
      App.engine.setMonitor('mix');
      App.selected = (st.stems.find((s) => s.role === 'Lead Vocal') || st.stems[0]).id;
      UI.toast(`${st.stems.filter((s) => !s.removed).length} stems analisados · ${st.music.bpm} BPM · ${st.music.key} · ${st.music.genre}`, 'ok');
      MM.saveProject(st);
    } catch (e) {
      console.error(e); UI.toast('Erro na análise: ' + e.message, 'err', 8000);
      st.stage = 'empty';
    }
    App.busy = false;
    App.render();
  };
  App.resetSession = function () {
    if (App.engine.playing) App.engine.stop();
    App.engine.loop = null;
    const keepSettings = App.state.settings;
    App.state = MM.newState();
    App.state.settings = keepSettings;
    if (MM.stemCache) MM.stemCache.clear(); // a cache por stem pertence à sessão anterior
    MM.STEM_CACHE_OFF = keepSettings && keepSettings.stemCache === 'off';
    MM.history.undo.length = 0; MM.history.redo.length = 0;
    App.chat = []; App.selected = null;
  };
  App.loadDemo = async function () {
    if (App.busy) return;
    await App.ensureAudio();
    App.resetSession();
    const st = App.state;
    st.sampleRate = App.engine.sampleRate;
    st.project.name = 'Noite de Luanda — Kizomba (demo)'; st.project.demo = true;
    st.stage = 'analyzing'; App.view = 'import';
    App.steps = { import: [0, 'a sintetizar stems…'], identify: [0, ''], music: [0, ''], plan: [0, ''], render: [0, ''] };
    App.render();
    const d = await MM.demo.generate(st.sampleRate, (p) => App.step('import', p * 0.95, 'a sintetizar stems…'));
    d.stems.forEach((s) => st.stems.push(MM.makeStem(s.name, s.ch, st.sampleRate, { format: 'WAV', sampleRate: st.sampleRate, channels: s.ch.length, bits: 24 })));
    const ref = MM.demo.makeReference(d.stems.map((s) => s.ch), st.sampleRate);
    st.pendingRefs = [{ name: 'Referencia_01 · Kizomba.wav', chs: ref, raw: null }];
    await App.analyze();
  };
  App.loadMasterFile = async function (file) {
    await App.ensureAudio();
    App.resetSession();
    const st = App.state;
    st.mode = 'master'; st.sampleRate = App.engine.sampleRate; st.project.name = file.name.replace(/\.[a-z0-9]+$/i, '');
    App.busy = true; App.render();
    try {
      const { ab, buf } = await MM.decodeFile(App.engine.ctx, file);
      st.premaster = buf; st.premasterRaw = ab;
      st.music = { duration: buf.duration, sections: [], genre: 'Pop', bpm: 0, key: '—', meter: '' };
      st.stage = 'review';
      const pm = await MM.measure(buf); st.metrics.mix = pm; st.metrics.orig = pm; st.master.premasterLufs = pm.lufs;
      st.mixPeaks = st.origPeaks = MM.peaks(D.channelsOf(buf), 900);
      // estilo reconhecido pelo treino da biblioteca (se existir)
      if (MM.styles && MM.styles.model) {
        try {
          const f = await MM.styles.masterFeatures(buf);
          const pr = MM.styles.predict(f);
          if (f.bpm) st.music.bpm = f.bpm;
          if (pr.length && pr[0].p >= 0.55) { st.music.genre = pr[0].style; st.music.genreConf = pr[0].p; st.music.genreSource = 'treino'; UI.toast(`Estilo reconhecido pelo treino: ${pr[0].style} (${Math.round(pr[0].p * 100)} %).`, 'ok'); }
        } catch (e) { console.warn(e); }
      }
      App.engine.rebuild(st);
      App.view = 'plugin';
      App.busy = false;
      await App.runAI({ keepMix: true });
    } catch (e) { console.error(e); UI.toast('Não foi possível abrir o ficheiro: ' + e.message, 'err'); App.busy = false; }
    App.render();
  };
  App.openProject = async function (id) {
    await App.ensureAudio();
    const rec = await MM.getProject(id);
    if (!rec) return;
    if (rec.demo) { await App.loadDemo(); return; }
    await App.loadRecord(rec);
  };
  /** Abre um ficheiro .mixmind (projeto completo exportado). */
  App.openProjectFile = async function (file) {
    await App.ensureAudio();
    try {
      UI.toast('A abrir o projeto…', 'ok', 1500);
      const rec = await MM.project.read(new Uint8Array(await file.arrayBuffer()));
      await App.loadRecord(rec);
      await MM.saveProject(App.state);
      App.recent = await MM.listProjects();
      UI.toast(`Projeto “${UI.esc(rec.name)}” aberto com ${rec.versions.length} ${rec.versions.length === 1 ? 'versão' : 'versões'}.`, 'ok');
    } catch (e) { console.error(e); UI.toast('Não foi possível abrir o projeto: ' + UI.esc(e.message), 'err', 7000); }
  };
  App.exportProjectFile = async function () {
    const st = App.state;
    if (!App.hasSession()) return;
    try {
      UI.toast('A preparar o projeto completo…', 'ok', 1800);
      const zip = await MM.project.export(st);
      const name = (st.project.name || 'Projeto').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/_+$/, '') + '.mixmind';
      MM.exporter.download(zip, name, 'application/zip');
      UI.toast(`Projeto exportado (${UI.bytes(zip.length)}): áudio original, decisões, ${st.versions.length} versões e automação.`, 'ok', 5000);
    } catch (e) { console.error(e); UI.toast('Erro ao exportar o projeto: ' + UI.esc(e.message), 'err'); }
  };
  App.loadRecord = async function (rec) {
    App.resetSession();
    const st = App.state;
    App.busy = true; st.stage = 'analyzing'; App.view = 'import';
    App.steps = { import: [0, ''], identify: [1, 'guardado'], music: [1, 'guardado'], plan: [0, ''], render: [0, ''] };
    App.render();
    try {
      st.project.id = rec.id; st.project.name = rec.name; st.mode = rec.mode || 'stems'; st.music = rec.music; st.settings = Object.assign(st.settings, rec.settings); st.issues = rec.issues || [];
      st.sampleRate = App.engine.sampleRate;
      if (st.mode === 'master' && rec.premasterRaw) {
        st.premaster = await App.engine.ctx.decodeAudioData(rec.premasterRaw.slice(0)); st.premasterRaw = rec.premasterRaw;
        if (rec.snap) MM.restore(st, rec.snap);
        st.versions = (rec.versions || []).map((v) => Object.assign({}, v, { masterBuf: null, premasterBuf: null }));
        st.stage = 'review'; App.engine.rebuild(st); App.busy = false; App.view = 'plugin'; await App.runAI({ keepMix: true }); return;
      }
      for (let i = 0; i < rec.stems.length; i++) {
        const r = rec.stems[i];
        if (!r.raw) continue;
        const buf = await App.engine.ctx.decodeAudioData(r.raw.slice(0));
        const chs = []; for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
        const s = MM.makeStem(r.name, chs, st.sampleRate, MM.parseHeader(r.raw), r.raw, buf);
        s.id = r.id; s.features = r.features;
        st.stems.push(s);
        App.step('import', (i + 1) / rec.stems.length, `${i + 1} / ${rec.stems.length}`);
      }
      MM.restore(st, rec.snap);
      // versões guardadas (sem áudio: ficam a pedir render ao carregar)
      st.versions = (rec.versions || []).map((v) => Object.assign({}, v, { masterBuf: null, premasterBuf: null }));
      st.currentVersion = rec.currentVersion || null; st.currentVersionName = rec.currentVersionName || null;
      if (rec.album) st.album = rec.album; if (rec.meta) st.meta = rec.meta;
      for (const r of rec.refs || []) if (r.raw) { const b = await App.engine.ctx.decodeAudioData(r.raw.slice(0)); const chs = [b.getChannelData(0).slice(), (b.numberOfChannels > 1 ? b.getChannelData(1) : b.getChannelData(0)).slice()]; await App.addReference(r.name, chs, r.raw, true, r.id); }
      st.stage = 'review';
      App.engine.rebuild(st);
      App.selected = (st.stems.find((s) => s.role === 'Lead Vocal') || st.stems[0]).id;
      App.busy = false; App.view = 'mixer';
      App.render();
      if (st.stems.some((s) => s.ai)) {
        await App.runAI({ keepMix: true, orig: true, noVersion: st.versions.length > 0 });
        const cv = st.versions.find((x) => x.id === st.currentVersion); if (cv) { cv.masterBuf = st.masterBuf; cv.premasterBuf = st.premasterBuf; }
      }
    } catch (e) { console.error(e); UI.toast('Erro ao abrir o projeto: ' + e.message, 'err'); App.busy = false; App.resetSession(); App.render(); }
  };

  // ---------- referências ----------
  App.addReference = async function (name, chs, raw, silent, id) {
    const st = App.state;
    if (st.refs.length >= 3) { UI.toast('Máximo de 3 referências.', 'warn'); return; }
    const sr = st.sampleRate;
    const buf = MM.toAudioBuffer(chs.length > 1 ? chs : [chs[0], chs[0]], sr);
    const metrics = await MM.analyzeReference(buf, name);
    const g = MM.GENRES[st.music && st.music.genre] ? st.music.genre : '';
    const r = { id: id || 'r' + Date.now().toString(36) + st.refs.length, name: name.replace(/\.[a-z0-9]+$/i, ''), raw, buffer: buf, metrics, note: metrics.plr < 8 ? 'compacta e alta' : metrics.lra > 7 ? 'mais dinâmica' : 'equilibrada', genre: g };
    st.refs.push(r);
    if (!st.activeRef) App.setActiveRef(r.id);
    if (!silent) UI.toast(`Referência “${r.name}” analisada: ${UI.fmtNum(metrics.lufs)} LUFS, PLR ${UI.fmtNum(metrics.plr)} dB.`, 'ok');
    return r;
  };
  App.setActiveRef = function (id) {
    const st = App.state;
    st.activeRef = id;
    const r = st.refs.find((x) => x.id === id);
    st.refBuffer = r ? r.buffer : null;
    App.updateLM();
  };
  App.updateLM = function () {
    const st = App.state, ref = st.refs.find((r) => r.id === st.activeRef);
    App.engine.setLoudness({
      orig: st.metrics.orig ? st.metrics.orig.lufs : -60, mix: st.metrics.mix ? st.metrics.mix.lufs : -60,
      master: st.metrics.master ? st.metrics.master.lufs : -60, ref: ref ? ref.metrics.lufs : -60, codec: st.codecLufs || -60,
    });
  };

  // ---------- IA ----------
  App.runAI = async function (opts) {
    opts = opts || {};
    const st = App.state;
    if (App.busy) return;
    if (!App.hasSession()) return;
    App.busy = true;
    App.steps = Object.assign(App.steps || {}, { plan: [0, ''], render: [0, ''] });
    App.progress = { title: opts.keepMix ? 'A renderizar premaster e master' : 'AI Mix & Master', p: 0, txt: '' };
    App.renderTop(); App.updateProgressFloat();
    const wasPlaying = App.engine.playing, pos = App.engine.position();
    if (opts.keepMix && !st.dirty.mix && st.premasterBuf) opts.reuseMix = true;
    try {
      if (!opts.keepMix && MM.history) MM.commit(st, 'AI Mix & Master');
      await MM.runAI(st, App.engine, (k, p, t) => {
        App.step(k, p, t);
        App.progress.p = k === 'plan' ? p * 0.06 : 0.06 + p * 0.94; App.progress.txt = t; App.updateProgressFloat();
      }, opts);
      App.updateLM();
      if (wasPlaying && !App.engine.playing) App.engine.play(pos);
      const m = st.metrics.master;
      UI.toast(`Master pronto: ${UI.fmtNum(m.lufs)} LUFS · ${UI.fmtNum(m.tp)} dBTP · score ${st.score.overall}. Alterna A/B com loudness match.`, 'ok', 5000);
      if (App.view === 'import' || App.view === 'home') App.view = st.mode === 'master' ? 'plugin' : 'mixer';
      if (st.mode !== 'master' || App.engine.monitor === 'codec') App.engine.setMonitor('master');
      MM.saveProject(st);
    } catch (e) {
      console.error(e); UI.toast('Erro no processamento: ' + e.message, 'err', 8000);
    }
    App.busy = false; App.progress = null; App.updateProgressFloat();
    App.render();
  };
  App.updateProgressFloat = function () {
    let el = UI.$('.progress-float');
    if (!App.progress || App.state.stage === 'analyzing') { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.className = 'progress-float'; document.body.appendChild(el); }
    el.innerHTML = `<div class="row"><b>${UI.esc(App.progress.title)}</b><span class="mono muted">${Math.round(App.progress.p * 100)} %</span></div><div class="bar"><i style="width:${(App.progress.p * 100).toFixed(1)}%"></i></div><div class="small muted" style="margin-top:6px">${UI.esc(App.progress.txt || '')} — podes continuar a trabalhar enquanto renderiza.</div>`;
  };

  // ---------- alterações (undo + motor) ----------
  App.stem = (id) => App.state.stems.find((s) => s.id === (id || App.selected));
  /**
   * Aplica uma alteração com undo.
   * @param {string} label
   * @param {Function} fn  mutação
   * @param {object} o  {stem, bus, fx, master, auto, rebuild, commit=true, refresh=true}
   */
  App.change = function (label, fn, o) {
    o = o || {};
    const st = App.state;
    if (o.commit !== false) MM.commit(st, label);
    fn(st);
    App.applyEngine(o);
    if (o.master) st.dirty.master = true; else st.dirty.mix = true;
    App.saveSoon();
    if (o.refresh !== false) App.refresh(); else App.renderTop();
  };
  App.applyEngine = function (o) {
    const g = App.engine.graph, st = App.state;
    if (!g) return;
    if (o.auto) {
      const stems = st.stems.filter((s) => !s.removed && s.role !== 'Reference Track');
      MM.buildAutomation(st, stems, null);
    }
    if (o.rebuild) { App.engine.rebuild(st); return; }
    if (o.stem) { const s = st.stems.find((x) => x.id === o.stem); if (s) g.applyStem(s); }
    if (o.allStems || o.auto) st.stems.forEach((s) => g.applyStem(s));
    if (o.bus) g.applyBus();
    if (o.fx) g.applyFx();
    if (o.master) g.applyMaster();
    if (o.auto || o.reschedule || g._needResched) { g._needResched = false; App.engine.reschedule(); }
  };
  App.saveSoon = UI.debounce(() => MM.saveProject(App.state), 2500);
  App.undo = function () {
    const l = MM.undo(App.state);
    if (!l) { UI.toast('Nada para desfazer.', 'warn', 1500); return; }
    App.engine.rebuild(App.state); App.refresh(); UI.toast('Desfeito: ' + l, 'ok', 1800);
  };
  App.redo = function () {
    const l = MM.redo(App.state);
    if (!l) { UI.toast('Nada para refazer.', 'warn', 1500); return; }
    App.engine.rebuild(App.state); App.refresh(); UI.toast('Refeito: ' + l, 'ok', 1800);
  };

  /** Solo / Mute com efeito imediato no motor; Alt/⌘+clique = solo exclusivo. */
  App.toggleSM = function (s, what, exclusive) {
    const st = App.state;
    MM.commit(st, what === 'solo' ? 'Solo ' + s.label : 'Mute ' + s.label);
    if (what === 'solo') {
      const on = !s.solo;
      if (exclusive) st.stems.forEach((x) => (x.solo = false));
      s.solo = on;
    } else { s.mute = !s.mute; st.dirty.mix = true; }
    const g = App.engine.graph;
    if (g && g.applyStem) st.stems.forEach((x) => g.applyStem(x));
    App.syncSM();
  };
  App.clearSolo = function () { const st = App.state; MM.commit(st, 'Limpar solo'); st.stems.forEach((x) => (x.solo = false)); const g = App.engine.graph; if (g && g.applyStem) st.stems.forEach((x) => g.applyStem(x)); App.syncSM(); };
  /** Atualiza todos os botões S/M visíveis sem redesenhar a vista. */
  App.syncSM = function () {
    App.state.stems.forEach((s) => {
      UI.$$(`[data-ssolo="${s.id}"]`).forEach((b) => b.classList.toggle('on', !!s.solo));
      UI.$$(`[data-smute="${s.id}"]`).forEach((b) => b.classList.toggle('on', !!s.mute));
      const strip = UI.$(`[data-strip="${s.id}"]`); if (strip) strip.classList.toggle('muted-s', !!s.mute);
    });
    App.renderTop();
  };

  // ---------- assistente ----------
  App.ask = function (text) {
    if (!text.trim()) return;
    const st = App.state;
    App.chat.push({ role: 'user', text });
    if (!App.ready() && st.mode !== 'master') {
      App.chat.push({ role: 'ai', text: 'Primeiro corre o AI Mix & Master — depois posso ajustar a mistura por ti.' });
      App.refresh(); return;
    }
    const r = MM.parseCommand(text, st);
    if (r.reply) App.chat.push({ role: 'ai', text: r.reply });
    if (r.changes.length) App.chat.push({ role: 'ai', proposal: { changes: r.changes, status: 'open' } });
    App.refresh();
  };
  App.applyProposal = async function (idx) {
    const msg = App.chat[idx];
    if (!msg || !msg.proposal || msg.proposal.status !== 'open') return;
    const st = App.state;
    MM.commit(st, 'Assistente: ' + (App.chat[idx - 1] ? App.chat[idx - 1].text : 'proposta'));
    const kinds = new Set();
    msg.proposal.changes.forEach((c) => { const k = c.apply(st); if (k) kinds.add(k); });
    msg.proposal.status = 'applied';
    if (kinds.has('rerun')) { MM.runMix(st); st.stems.forEach((s) => { if (!s.locked) s.ai = JSON.parse(JSON.stringify(s.p)); }); App.engine.rebuild(st); }
    else App.applyEngine({ allStems: true, auto: kinds.has('automation'), master: true, bus: true });
    st.dirty.mix = true;
    App.refresh();
    if (kinds.has('remaster') || kinds.has('master')) {
      App.chat.push({ role: 'ai', text: 'Aplicado. Estou a renderizar o master para medir o resultado…' });
      App.refresh();
      await App.runAI({ keepMix: true, versionName: undefined });
    } else App.chat.push({ role: 'ai', text: 'Aplicado em tempo real. Carrega em “Atualizar” para renderizar e medir o novo master.' });
    App.refresh();
  };
  App.rejectProposal = function (idx) { const m = App.chat[idx]; if (m && m.proposal) m.proposal.status = 'rejected'; App.chat.push({ role: 'ai', text: 'Ok, não mexi em nada.' }); App.refresh(); };

  // ---------- versões e alternativas ----------
  App.loadVersion = function (id) {
    const v = MM.loadVersion(App.state, id);
    if (!v) return;
    App.engine.rebuild(App.state); App.updateLM();
    UI.toast(`${v.name} carregada${v.masterBuf ? '' : ' (renderiza para medir)'}.`, 'ok', 2200);
    App.render();
  };
  App.makeAlternatives = async function () {
    const st = App.state;
    if (!App.ready()) return;
    MM.commit(st, 'Alternativas da IA');
    const base = Object.assign({}, st.direction), baseVer = st.currentVersion;
    st.alternatives = [];
    for (const alt of MM.ALTERNATIVES) {
      st.direction = Object.assign({}, base);
      Object.entries(alt.d).forEach(([k, dv]) => (st.direction[k] = D.clamp(st.direction[k] + dv, 0, 100)));
      MM.runMix(st);
      st.stems.forEach((s) => { if (!s.locked) s.ai = JSON.parse(JSON.stringify(s.p)); });
      st.alternatives.push({ id: alt.id, name: alt.name, snap: MM.snapshot(st), direction: Object.assign({}, st.direction) });
      await D.yieldUI();
    }
    if (baseVer) MM.loadVersion(st, baseVer); else st.direction = base;
    App.engine.rebuild(st);
    UI.toast('4 alternativas prontas — alterna instantaneamente enquanto ouves.', 'ok');
    App.refresh();
  };
  App.useAlternative = function (id) {
    const st = App.state, a = (st.alternatives || []).find((x) => x.id === id);
    if (!a) return;
    MM.restore(st, a.snap); st.activeAlt = id; st.dirty.mix = true;
    App.engine.rebuild(st);
    App.refresh();
  };

  // ---------- eventos globais ----------
  App.bindGlobal = function () {
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-act]');
      if (a && !a.disabled) {
        const act = a.dataset.act;
        const fn = {
          play: App.togglePlay, stop: () => App.engine.stop(), toStart: () => App.engine.seek(0), loop: () => {
            const t = App.engine.position(); const s = App.state.music && App.state.music.sections.find((x) => t >= x.start && t < x.end);
            App.setLoop(App.engine.loop ? null : s);
          },
          lm: () => { App.engine.setLM(!App.engine.lm); App.renderTop(); App.curView && App.curView.onMonitor && App.curView.onMonitor(App); },
          undo: App.undo, redo: App.redo, ai: () => App.runAI(), clearSolo: App.clearSolo, update: () => App.runAI({ keepMix: true }), palette: App.palette,
        }[act];
        if (fn) { e.preventDefault(); fn(); }
      }
      const so = e.target.closest('[data-ssolo],[data-smute]');
      if (so) {
        e.preventDefault(); e.stopPropagation();
        const s = App.stem(so.dataset.ssolo || so.dataset.smute);
        if (s) App.toggleSM(s, so.dataset.ssolo ? 'solo' : 'mute', e.altKey || e.metaKey);
        return;
      }
      const mon = e.target.closest('[data-mon]');
      if (mon) App.setMonitor(mon.dataset.mon);
      const v = e.target.closest('[data-view]');
      if (v) App.go(v.dataset.view);
    });
    document.addEventListener('change', (e) => {
      if (e.target.id === 'verSel') App.loadVersion(e.target.value);
      if (e.target.classList.contains('proj-name')) { App.state.project.name = e.target.value || 'Sem título'; App.saveSoon(); }
    });
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' && !['range', 'checkbox'].includes(e.target.type) || tag === 'textarea' || tag === 'select';
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); App.palette(); return; }
      if (typing) return;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? App.redo() : App.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); App.redo(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (App.ready()) { MM.saveVersion(App.state); MM.saveProject(App.state); App.renderTop(); UI.toast('Versão guardada: ' + App.state.currentVersionName, 'ok'); } return; }
      if (!App.hasSession()) return;
      if (e.code === 'Space') { e.preventDefault(); App.togglePlay(); }
      else if (e.key === '1') App.setMonitor('orig');
      else if (e.key === '2') App.setMonitor('mix');
      else if (e.key === '3') App.setMonitor('master');
      else if (e.key === '4') App.setMonitor('ref');
      else if (e.key.toLowerCase() === 'l') { App.engine.setLM(!App.engine.lm); App.renderTop(); }
      else if (e.key === 'ArrowLeft') App.engine.seek(App.engine.position() - (e.shiftKey ? 1 : 5));
      else if (e.key === 'ArrowRight') App.engine.seek(App.engine.position() + (e.shiftKey ? 1 : 5));
      else if (e.key === 'Home') App.engine.seek(0);
      else if (e.key === 'Escape') App.closeEditor && App.closeEditor();
      else if (e.key.toLowerCase() === 'm' && App.stem()) App.toggleSM(App.stem(), 'mute');
      else if (e.key.toLowerCase() === 's' && App.stem()) App.toggleSM(App.stem(), 'solo', e.altKey);
    });
    // arrastar ficheiros para qualquer lado
    let dragN = 0;
    window.addEventListener('dragenter', (e) => { e.preventDefault(); dragN++; const d = UI.$('.drop'); if (d) d.classList.add('over'); });
    window.addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; const d = UI.$('.drop'); if (d) d.classList.remove('over'); } });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', async (e) => {
      e.preventDefault(); dragN = 0;
      const d = UI.$('.drop'); if (d) d.classList.remove('over');
      if (e.target.closest && e.target.closest('[data-refdrop]')) return; // tratado pela vista
      if (App.view === 'styles') { UI.toast('Larga os ficheiros numa das caixas: músicas finais ou stems pós-fader.', 'warn'); return; }
      if (App.view === 'album') { const fs = await App.filesFromDrop(e.dataTransfer); MM.views.album.addFiles(App, fs); return; }
      const files = await App.filesFromDrop(e.dataTransfer);
      const proj = files.find((f) => /\.mixmind$/i.test(f.name));
      if (proj) { App.openProjectFile(proj); return; }
      if (App.view === 'plugin' && files.length === 1) App.loadMasterFile(files[0]);
      else App.importFiles(files);
    });
    window.addEventListener('beforeunload', () => { if (App.hasSession()) MM.saveProject(App.state); MM.project.markClosed(); });
  };
  /** Suporta arrastar pastas inteiras. */
  App.filesFromDrop = async function (dt) {
    const out = [];
    const items = dt.items ? Array.from(dt.items) : [];
    const walk = (entry) => new Promise((res) => {
      if (entry.isFile) entry.file((f) => { try { f.relPath = entry.fullPath.replace(/^\//, ''); } catch (e) { /* */ } out.push(f); res(); }, () => res());
      else if (entry.isDirectory) { const r = entry.createReader(); const all = []; const read = () => r.readEntries(async (ents) => { if (!ents.length) { for (const en of all) await walk(en); res(); } else { all.push(...ents); read(); } }, () => res()); read(); }
      else res();
    });
    if (items.length && items[0].webkitGetAsEntry) { for (const it of items) { const en = it.webkitGetAsEntry(); if (en) await walk(en); } }
    else out.push(...Array.from(dt.files || []));
    return out;
  };
  App.pickFiles = function (opts) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = !opts || opts.multiple !== false; inp.accept = 'audio/*,.wav,.aif,.aiff,.flac,.mp3';
    if (opts && opts.dir) inp.webkitdirectory = true;
    inp.onchange = () => opts && opts.onFiles ? opts.onFiles(inp.files) : App.importFiles(inp.files);
    inp.click();
  };

  // ---------- paleta de comandos ----------
  App.palette = function () {
    const st = App.state;
    const cmds = [
      ['AI Mix & Master', 'spark', () => App.runAI(), App.hasSession()],
      ['Atualizar render (mantém as tuas alterações)', 'activity', () => App.runAI({ keepMix: true }), App.ready()],
      ['Play / pausa', 'play', App.togglePlay, App.hasSession(), 'Espaço'],
      ['Ouvir Original', 'eye', () => App.setMonitor('orig'), App.hasSession(), '1'],
      ['Ouvir Mix', 'eye', () => App.setMonitor('mix'), App.hasSession(), '2'],
      ['Ouvir Master', 'eye', () => App.setMonitor('master'), App.ready(), '3'],
      ['Loudness match on/off', 'compare', () => { App.engine.setLM(!App.engine.lm); App.renderTop(); }, App.hasSession(), 'L'],
      ['Guardar versão', 'save', () => { MM.saveVersion(st); App.renderTop(); UI.toast('Versão guardada', 'ok'); }, App.ready(), 'Ctrl+S'],
      ['Gerar alternativas (Natural / Modern / Aggressive / Wide)', 'layers', () => { App.go('compare'); App.makeAlternatives(); }, App.ready()],
      ['Desfazer', 'undo', App.undo, App.hasSession(), 'Ctrl+Z'],
      ['Refazer', 'redo', App.redo, App.hasSession(), 'Ctrl+Shift+Z'],
      ['Adicionar stems…', 'plus', () => App.pickFiles(), true],
      ['Abrir sessão de demonstração', 'music', App.loadDemo, true],
      ['Masterizar uma mix stereo (MIXMIND Master)', 'plug', () => App.go('plugin'), true],
      ['Guardar projeto completo (.mixmind)', 'download', () => App.exportProjectFile(), App.hasSession()],
      ...NAV.map(([k, l, ic]) => ['Ir para ' + l, ic, () => App.go(k), App.hasSession()]),
      ['Estilos · treinar com músicas', 'brain', () => App.go('styles'), true],
      ['Definições', 'gear', () => App.go('settings'), true],
      ['Novo projeto', 'file', () => { App.resetSession(); App.view = 'home'; App.render(); }, true],
    ].filter((c) => c[3]);
    UI.modal(`<div class="palette"><input placeholder="Escreve um comando…" autofocus><div class="list"></div></div>`, (s, close) => {
      const inp = s.querySelector('input'), list = s.querySelector('.list');
      let sel = 0, cur = cmds;
      const draw = () => {
        const q = inp.value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        cur = cmds.filter((c) => c[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q));
        sel = Math.min(sel, Math.max(0, cur.length - 1));
        list.innerHTML = cur.map((c, i) => `<div class="it ${i === sel ? 'on' : ''}" data-i="${i}">${UI.icon(c[1])}${UI.esc(c[0])}${c[4] ? `<span class="kbd">${c[4]}</span>` : ''}</div>`).join('') || '<div class="empty-note">Sem resultados</div>';
      };
      inp.oninput = () => { sel = 0; draw(); };
      inp.onkeydown = (e) => {
        if (e.key === 'ArrowDown') { sel = Math.min(cur.length - 1, sel + 1); draw(); e.preventDefault(); }
        if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
        if (e.key === 'Enter' && cur[sel]) { close(); cur[sel][2](); }
      };
      list.onclick = (e) => { const it = e.target.closest('.it'); if (it) { close(); cur[+it.dataset.i][2](); } };
      draw(); setTimeout(() => inp.focus(), 10);
    });
  };

  window.addEventListener('DOMContentLoaded', () => App.boot());
})();
