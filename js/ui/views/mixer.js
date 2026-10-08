/* MIXMIND — vista Mixer + assistente + editor de módulos */
(function () {
  const MM = window.MM, D = MM.dsp, UI = MM.ui;
  const V = (MM.views = MM.views || {});

  // escala do fader (dB → posição 0..1, de cima para baixo)
  const FD = [[6, 0], [0, 0.12], [-6, 0.25], [-12, 0.38], [-24, 0.57], [-40, 0.78], [-60, 1]];
  const db2pos = (db) => { db = D.clamp(db, -60, 6); for (let i = 1; i < FD.length; i++) if (db >= FD[i][0]) { const [a, pa] = FD[i - 1], [b, pb] = FD[i]; return pa + ((a - db) / (a - b)) * (pb - pa); } return 1; };
  const pos2db = (p) => { p = D.clamp(p, 0, 1); for (let i = 1; i < FD.length; i++) if (p <= FD[i][1]) { const [a, pa] = FD[i - 1], [b, pb] = FD[i]; return a - ((p - pa) / (pb - pa)) * (a - b); } return -60; };

  const MODS = [
    ['hpf', 'HPF', (p) => p.hpf.on], ['eq', 'EQ', (p) => p.eq.some((e) => e.on)], ['dyn', 'DYN EQ', (p) => (p.dyn || []).length], ['deess', 'DEESS', (p) => p.deess.on],
    ['comp', 'COMP', (p) => p.comp.on], ['comp2', 'COMP 2', (p) => p.comp2.on], ['trans', 'TRANS', (p) => p.trans.on], ['sat', 'SAT', (p) => p.sat.on], ['duck', 'DUCK', (p) => p.duck && p.duck.on],
  ];
  const isManual = (s, k) => s.manual && (s.manual[k] || (k === 'dyn' && s.manual.dyn));
  const REVAB = { plate: 'PLT', room: 'ROOM', hall: 'HALL' };

  function stripHTML(app, s) {
    const p = s.p, c = UI.colorOf(s), sel = app.selected === s.id;
    const mods = MODS.filter(([, , on]) => on(p));
    const ghost = s.ai && Math.abs(s.ai.fader - p.fader) > 0.25 ? `<div class="ghost" style="top:${db2pos(s.ai.fader) * 100}%" title="Valor proposto pela IA: ${UI.fmtDb(s.ai.fader)} dB"></div>` : '';
    const send = p.sendRev > -59 ? `${REVAB[p.revType] || 'REV'} ${Math.round(p.sendRev)}` : p.sendDly > -59 ? `DLY ${Math.round(p.sendDly)}` : '';
    const autoOn = (app.state.automation || []).some((l) => l.target.id === s.id && l.enabled.ai);
    return `<div class="strip ${sel ? 'sel' : ''} ${s.mute ? 'muted-s' : ''}" style="--c:${c}" data-strip="${s.id}">
      <div class="name" title="${UI.esc(s.label)}">${UI.esc(s.short || s.label)}${s.p.polarity ? '<span class="phbadge" title="Polaridade invertida (vista Análise → Fase)">Ø</span>' : ''}${+s.p.align > 0 ? `<span class="phbadge" title="Atrasado ${UI.fmtNum(+s.p.align, 2)} ms para alinhar a fase">+${UI.fmtNum(+s.p.align, 1)}ms</span>` : ''}${s.locked ? UI.icon('lock') : ''}</div>
      <div class="meta">${Math.round(s.conf * 100)}% · ${s.hier}</div>
      <div class="mods">${MM.tune && (MM.ROLES[s.role].fam === 'vocal' || (s.p.tune && Object.keys(s.p.tune.edits || {}).length)) ? `<div class="mod tunemod ${MM.tune.hasEdits(s) ? 'man' : ''}" data-tune="${s.id}" title="Editor de voz: afinação, tempo e expressão nota a nota (antes do resto da cadeia)">VOZ${MM.tune.hasEdits(s) ? ' ●' : ''}</div>` : ''}${mods.map(([k, l]) => `<div class="mod ${isManual(s, k) ? 'man' : 'ai'}" data-mod="${k}" data-sid="${s.id}">${l}</div>`).join('') || '<div class="dim tiny" style="text-align:center;margin-top:30px">sem processamento</div>'}</div>
      <div class="panrow"><div class="panknob" data-pan="${s.id}"><div class="tr"></div><div class="ctr"></div><div class="th" style="left:${((p.pan + 1) / 2) * 100}%"></div></div><div class="panlbl">${MM.panLabel(p.pan)}</div></div>
      <div class="faderwrap">
        <div class="scale">${[6, 0, -6, -12, -24, -40, -60].map((d) => `<span style="top:${db2pos(d) * 100}%">${d > 0 ? '+' + d : d}</span>`).join('')}</div>
        <div class="fader" data-fader="${s.id}"><div class="rail"></div>${ghost}<div class="cap" style="top:${db2pos(p.fader) * 100}%"></div></div>
        <div class="meter"><canvas data-meter="${s.id}"></canvas></div>
      </div>
      <div class="db" data-dbv="${s.id}">${UI.fmtNum(p.fader)}</div>
      <div class="send">${send}</div>
      <div class="btns"><button class="s ${s.solo ? 'on' : ''}" data-ssolo="${s.id}" title="Solo">S</button><button class="m ${s.mute ? 'on' : ''}" data-smute="${s.id}" title="Mute">M</button><button class="r ${autoOn ? 'on' : ''}" data-read="${s.id}" title="Ler automação">R</button></div>
    </div>`;
  }

  function masterStripHTML(app) {
    const st = app.state, m = st.metrics.master;
    const sc = st.score;
    return `<div class="strip mstrip">
      <div class="unit" style="margin-top:4px">MASTER</div>
      <div class="big" id="msBig">${m ? UI.fmtNum(m.lufs) : '—'}</div>
      <div class="unit">LUFS-I</div>
      <div class="mstat"><span>TP</span><b id="msTP">${m ? UI.fmtNum(m.tp) : '—'}</b><span>PLR</span><b>${m ? UI.fmtNum(m.plr) : '—'}</b><span>GR</span><b id="msGR">${st.masterGR ? UI.fmtNum(st.masterGR) : '—'}</b><span>LRA</span><b>${m ? UI.fmtNum(m.lra) : '—'}</b></div>
      <div class="hr" style="margin:6px 0 12px"></div>
      <div class="unit">MIX SCORE</div>
      <div class="scorebig" style="text-align:center;margin:8px 0">${sc ? sc.overall : '—'}<small>/100</small></div>
      <div class="legend"><i style="border:1.5px dashed var(--acc)"></i>Valor proposto pela IA</div>
      <div class="legend"><i style="background:#dfe5ec"></i>Valor atual</div>
      <div class="spacer"></div>
      <div class="meter" style="height:120px;margin-top:12px"><canvas id="mMeter"></canvas></div>
    </div>`;
  }

  // ---------- assistente ----------
  function assistantHTML(app) {
    const msgs = app.chat;
    return `<div class="pad">
      <div class="row" style="justify-content:space-between"><div class="eyebrow">AI Assistant</div><label class="check small"><input type="checkbox" id="explainT" ${app.explainOn !== false ? 'checked' : ''}>Explain</label></div>
      <div class="chat" style="margin-top:12px">
        ${msgs.length ? '' : '<div class="bubble ai">Diz-me o que queres ouvir. Eu proponho, tu decides.</div>'}
        ${msgs.map((m, i) => m.proposal ? `<div class="proposal ${m.proposal.status !== 'open' ? 'done' : ''}"><h4>Proposta · ${m.proposal.changes.length} ${m.proposal.changes.length === 1 ? 'alteração' : 'alterações'}${m.proposal.status === 'applied' ? ' · aplicada' : m.proposal.status === 'rejected' ? ' · rejeitada' : ''}</h4>
          ${m.proposal.changes.map((c) => `<div class="ln"><span>${UI.esc(c.label)}</span><span>${Math.round(c.conf * 100)}%</span></div>`).join('')}
          ${m.proposal.status === 'open' ? `<div class="row" style="margin-top:12px"><button class="btn primary sm" data-apply="${i}">Aplicar</button><button class="btn sm" data-reject="${i}">Rejeitar</button><button class="btn ghost sm" data-why="${i}">Ver porquê</button></div>` : ''}
          ${m.showWhy ? `<div class="small muted" style="margin-top:10px">${m.proposal.changes.filter((c) => c.why).map((c) => '• ' + UI.esc(c.why)).join('<br>')}</div>` : ''}
        </div>` : `<div class="bubble ${m.role === 'ai' ? 'ai' : ''}">${UI.esc(m.text)}</div>`).join('')}
      </div>
      <form class="composer" id="ask"><input class="field" placeholder="Pede uma alteração…" id="askIn" autocomplete="off"><button class="btn primary icon" type="submit">${UI.icon('send')}</button></form>
      <div class="suggest">${['Quero mais punch no kick.', 'Quero a voz mais próxima.', 'Quero o refrão mais aberto.', 'Quero uma estética mais analógica.', 'Reduz a agressividade da master.', 'Aproxima esta mix da referência.'].map((t) => `<button data-sug="${UI.esc(t)}">${UI.esc(t)}</button>`).join('')}</div>
    </div>`;
  }

  function chainSummary(s, k) {
    const p = s.p;
    switch (k) {
      case 'hpf': return `${D.fmtHz(p.hpf.freq)} · 24 dB/oct`;
      case 'eq': return p.eq.filter((e) => e.on).map((e) => `${UI.fmtDb(e.gain)} dB @ ${D.fmtHz(e.freq)}`).join(' · ');
      case 'dyn': return (p.dyn || []).map((d) => `${D.fmtHz(d.freq)} · até −${UI.fmtNum(d.cut)} dB`).join(' · ');
      case 'deess': return `${D.fmtHz(p.deess.freq)} · ${UI.fmtNum(p.deess.amount)} dB`;
      case 'comp': return `${UI.fmtNum(p.comp.ratio)}:1 · atk ${p.comp.atk} ms · thr ${UI.fmtNum(p.comp.thr)}`;
      case 'comp2': return `${UI.fmtNum(p.comp2.ratio)}:1 · rel ${p.comp2.rel} ms`;
      case 'trans': return `attack ${UI.fmtDb(p.trans.attack * 12)} · sustain ${UI.fmtDb(p.trans.sustain * 12)}`;
      case 'sat': return `${MM.SAT_NAMES[p.sat.model]} · ${Math.round(p.sat.drive * 100)} % · mix ${Math.round(p.sat.mix * 100)} %`;
      case 'duck': return `<${p.duck.freq} Hz · −${UI.fmtNum(p.duck.depth)} dB`;
    }
    return '';
  }
  const MODNAME = { hpf: 'High-pass', eq: 'EQ', dyn: 'EQ dinâmico (anti-masking)', deess: 'De-esser', comp: 'Compressor', comp2: 'Compressor série', trans: 'Transient shaper', sat: 'Saturação', duck: 'Sidechain multibanda', sends: 'Sends (reverb / delay)' };

  function sideHTML(app) {
    const s = app.stem(), st = app.state;
    if (!s) return assistantHTML(app);
    const mods = MODS.filter(([, , on]) => on(s.p));
    const exps = (st.explain || []).filter((e) => e.stem === s.id);
    const conf = st.confidence || {};
    const cb = (l, v) => `<div class="cbar"><span>${l}</span><div class="bar"><i style="width:${(v || 0) * 100}%"></i></div><span>${v ? Math.round(v * 100) + '%' : '—'}</span></div>`;
    return assistantHTML(app) + `<div class="hr" style="margin:0"></div><div class="pad">
      <div class="row" style="justify-content:space-between"><div class="eyebrow">${UI.esc(s.label)} · cadeia</div><span class="small muted">${mods.length} módulos</span></div>
      <div class="chain" style="margin-top:6px">
        ${mods.map(([k]) => `<div class="it" data-mod="${k}" data-sid="${s.id}"><div><b>${MODNAME[k]}${k === 'comp' ? ' · ' + s.p.comp.style : ''}</b><small>${UI.esc(chainSummary(s, k))}</small></div><span class="tag ${isManual(s, k) ? 'manual' : 'ia'}">${isManual(s, k) ? 'MANUAL' : 'IA'}</span></div>`).join('')}
        <div class="it" data-mod="sends" data-sid="${s.id}"><div><b>Sends</b><small>${s.p.sendRev > -59 ? `${MM.REV_NAMES[s.p.revType]} ${UI.fmtNum(s.p.sendRev)} dB` : 'Reverb off'} · ${s.p.sendDly > -59 ? `Delay ${UI.fmtNum(s.p.sendDly)} dB` : 'Delay off'}</small></div><span class="tag ${isManual(s, 'sendRev') ? 'manual' : 'ia'}">${isManual(s, 'sendRev') ? 'MANUAL' : 'IA'}</span></div>
      </div>
      <div class="row wrap" style="margin-top:12px">
        <button class="btn sm" id="addMod">${UI.icon('plus')}Módulo</button>
        <button class="btn sm ${s.locked ? 'warn' : ''}" id="lockS">${UI.icon(s.locked ? 'lock' : 'unlock')}${s.locked ? 'Bloqueado' : 'Bloquear stem'}</button>
        <button class="btn sm ghost" id="resetS" title="Repor os valores propostos pela IA">${UI.icon('undo')}Reset IA</button>
      </div>
      ${app.explainOn !== false ? `<div class="row" style="justify-content:space-between;margin-top:22px"><div class="eyebrow">Explicação</div><a class="small acc-t" data-act="notes" style="cursor:pointer">Notas do Motor →</a></div><div class="explain" style="margin-top:10px">${exps.length ? exps.slice(0, 7).map((e) => `<p><span class="tag ${e.module === 'Masking' ? 'ia' : ''}" style="margin-right:6px">${UI.esc(e.module)}</span>${UI.esc(e.text)}</p>`).join('') : '<p class="muted">Ainda sem decisões para este stem — corre o AI Mix & Master.</p>'}</div>
      <div style="margin-top:16px">${cb('Deteção de instrumento', s.conf)}${cb('Decisão de EQ', conf.eq)}${cb('Compressão', conf.comp)}${cb('Direção da mistura', conf.direction)}</div>` : ''}
    </div>`;
  }

  V.mixer = {
    flush: true,
    render(app) {
      const st = app.state;
      const stems = st.stems.filter((s) => !s.removed);
      if (!app.selected || !app.stem() || app.stem().removed) app.selected = stems[0] && stems[0].id;
      const ref = st.refs.find((r) => r.id === st.activeRef);
      return `<div class="three">
        <aside><div class="pad">
          <div class="eyebrow">Sessão</div>
          <div class="mono" style="font-size:17px;margin-top:8px">${st.music.bpm} BPM · ${st.music.key} · ${st.music.meter}</div>
          <div class="muted small" style="margin-top:2px">${stems.length} stems · ${ref ? 'Referência carregada' : 'Sem referência'} · ${st.music.genre}</div>
          <div class="row" style="justify-content:space-between;margin:22px 0 8px"><div class="eyebrow">Stems</div><span class="eyebrow">Solo · Mute · H</span></div>
          <div class="stemlist">${stems.map((s) => `<div class="it ${app.selected === s.id ? 'sel' : ''}" data-sel="${s.id}"><span class="dot" style="background:${UI.colorOf(s)}"></span><div style="min-width:0"><b>${UI.esc(s.label)}</b><small>${UI.esc(MM.ROLES[s.role].pt)}</small></div><span class="row" style="gap:6px">${UI.sm(s)}<button class="lockbtn ${s.locked ? 'on' : ''}" data-lock="${s.id}" title="${s.locked ? 'Desbloquear' : 'Bloquear: a IA não mexe'}">${UI.icon(s.locked ? 'lock' : 'unlock')}</button></span><span class="h" title="Confiança ${Math.round(s.conf * 100)} %">${s.hier}</span></div>`).join('')}</div>
          <button class="btn" style="width:100%;margin-top:14px;border-style:dashed" id="addSt">${UI.icon('plus')}Adicionar stems</button>
        </div></aside>
        <main><div class="mixer">${stems.map((s) => stripHTML(app, s)).join('')}${masterStripHTML(app)}</div></main>
        <aside class="right" id="side">${sideHTML(app)}</aside>
      </div>`;
    },
    mount(app, root) {
      const st = app.state;
      const graph = () => app.engine.graph;
      root.querySelectorAll('[data-sel]').forEach((el) => (el.onclick = (e) => { if (e.target.closest('[data-lock],.sm')) return; app.selected = el.dataset.sel; app.refresh(); }));
      root.querySelectorAll('[data-strip]').forEach((el) => el.addEventListener('pointerdown', (e) => { if (app.selected !== el.dataset.strip && !e.target.closest('.fader,.panknob,[data-mod],button')) { app.selected = el.dataset.strip; app.refresh(); } }));
      root.querySelectorAll('[data-lock]').forEach((b) => (b.onclick = () => app.change('Bloquear stem', () => { const s = app.stem(b.dataset.lock); s.locked = !s.locked; }, {})));
      root.querySelector('#addSt').onclick = () => app.pickFiles();
      root.querySelectorAll('[data-read]').forEach((b) => (b.onclick = () => app.change('Leitura de automação', () => {
        const lanes = st.automation.filter((l) => l.target.id === b.dataset.read);
        const on = !lanes.some((l) => l.enabled.ai);
        lanes.forEach((l) => { l.enabled.ai = on; l.enabled.manual = on; });
      }, { reschedule: true })));
      // faders
      root.querySelectorAll('[data-fader]').forEach((el) => {
        const s = app.stem(el.dataset.fader);
        const cap = el.querySelector('.cap'), lbl = root.querySelector(`[data-dbv="${s.id}"]`);
        const setDb = (db) => {
          s.p.fader = Math.round(db * 10) / 10; s.manual.fader = true;
          cap.style.top = db2pos(s.p.fader) * 100 + '%'; lbl.textContent = UI.fmtNum(s.p.fader);
          graph() && graph().applyStem(s);
        };
        UI.drag(el, {
          get: () => db2pos(s.p.fader), min: 0, max: 1,
          abs: (ev) => { const r = el.getBoundingClientRect(); return pos2db((ev.clientY - r.top) / r.height); },
          set: (db) => setDb(db),
          start: () => MM.commit(st, 'Fader ' + s.label), end: () => { st.dirty.mix = true; app.renderTop(); app.saveSoon(); },
          reset: () => { MM.commit(st, 'Fader ' + s.label); setDb(s.ai ? s.ai.fader : 0); },
        });
      });
      root.querySelectorAll('[data-pan]').forEach((el) => {
        const s = app.stem(el.dataset.pan), th = el.querySelector('.th'), lbl = el.parentElement.querySelector('.panlbl');
        const setPan = (v) => { s.p.pan = Math.round(v * 100) / 100; s.manual.pan = true; th.style.left = ((s.p.pan + 1) / 2) * 100 + '%'; lbl.textContent = MM.panLabel(s.p.pan); graph() && graph().applyStem(s); };
        UI.drag(el, { axis: 'x', get: () => s.p.pan, set: setPan, min: -1, max: 1, sens: 0.02, start: () => MM.commit(st, 'Pan ' + s.label), end: () => { st.dirty.mix = true; app.renderTop(); app.saveSoon(); }, reset: () => setPan(s.ai ? s.ai.pan : 0) });
      });
      root.querySelectorAll('[data-tune]').forEach((el) => (el.onclick = (e) => { e.stopPropagation(); app.tuneStem = el.dataset.tune; app.go('tune'); }));
      root.querySelectorAll('[data-mod]').forEach((el) => (el.onclick = (e) => { e.stopPropagation(); V.openEditor(app, app.stem(el.dataset.sid), el.dataset.mod, el); }));
      mountSide(app, root);
    },
    frame(app) {
      const g = app.engine.graph;
      if (!g || !g.stems) return;
      const buf = V._mbuf || (V._mbuf = new Float32Array(512));
      document.querySelectorAll('canvas[data-meter]').forEach((cv) => {
        const n = g.stems[cv.dataset.meter];
        const s = app.stem(cv.dataset.meter);
        if (!n || !n.meter || !s) return;
        let pk = 0;
        if (app.engine.playing) { n.meter.getFloatTimeDomainData(buf); for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > pk) pk = a; } }
        const prev = +cv.dataset.v || 0, v = Math.max(pk, prev * 0.9);
        cv.dataset.v = v;
        const { ctx, w, h } = UI.fitCanvas(cv);
        ctx.clearRect(0, 0, w, h);
        const y = h * db2pos(D.lin2db(v + 1e-9));
        const grd = ctx.createLinearGradient(0, h, 0, 0);
        grd.addColorStop(0, UI.colorOf(s)); grd.addColorStop(0.82, UI.colorOf(s)); grd.addColorStop(0.88, '#fbbf24'); grd.addColorStop(1, '#fb7185');
        ctx.fillStyle = grd; ctx.fillRect(0, y, w, h - y);
      });
      const mm = document.getElementById('mMeter');
      if (mm) {
        const { ctx, w, h } = UI.fitCanvas(mm), m = app.engine.meter;
        ctx.clearRect(0, 0, w, h);
        const bw = (w - 6) / 2;
        [m.pkL, m.pkR].forEach((pk, i) => {
          const y = app.engine.playing ? h * db2pos(D.lin2db((pk || 0) + 1e-9)) : h;
          const grd = ctx.createLinearGradient(0, h, 0, 0); grd.addColorStop(0, '#5eead4'); grd.addColorStop(0.85, '#38bdf8'); grd.addColorStop(0.9, '#fbbf24'); grd.addColorStop(1, '#fb7185');
          ctx.fillStyle = grd; ctx.fillRect(i * (bw + 6), y, bw, h - y);
        });
        if (app.engine.playing && app.engine.monitor === 'master') {
          const b = document.getElementById('msBig'); if (b && m.I > -69) b.textContent = UI.fmtNum(m.I);
          const t = document.getElementById('msTP'); if (t && m.tpMax > -69) t.textContent = UI.fmtNum(m.tpMax);
        }
      }
    },
    unmount() { V.closeEditor(); },
  };

  function mountSide(app, root) {
    const side = root.querySelector('#side') || root;
    const f = side.querySelector('#ask');
    if (f) f.onsubmit = (e) => { e.preventDefault(); const i = side.querySelector('#askIn'); const t = i.value; i.value = ''; app.ask(t); };
    side.querySelectorAll('[data-sug]').forEach((b) => (b.onclick = () => app.ask(b.dataset.sug)));
    side.querySelectorAll('[data-apply]').forEach((b) => (b.onclick = () => app.applyProposal(+b.dataset.apply)));
    side.querySelectorAll('[data-reject]').forEach((b) => (b.onclick = () => app.rejectProposal(+b.dataset.reject)));
    side.querySelectorAll('[data-why]').forEach((b) => (b.onclick = () => { const m = app.chat[+b.dataset.why]; m.showWhy = !m.showWhy; app.refresh(); }));
    const ex = side.querySelector('#explainT'); if (ex) ex.onchange = () => { app.explainOn = ex.checked; app.refresh(); };
    const s = app.stem();
    const lk = side.querySelector('#lockS'); if (lk) lk.onclick = () => app.change('Bloquear stem', () => { s.locked = !s.locked; }, {});
    const rs = side.querySelector('#resetS'); if (rs) rs.onclick = () => { if (!s.ai) return; app.change('Reset IA ' + s.label, () => { const tune = s.p.tune; s.p = JSON.parse(JSON.stringify(s.ai)); if (tune) s.p.tune = tune; else delete s.p.tune; s.manual = {}; }, { stem: s.id }); };
    const am = side.querySelector('#addMod');
    if (am) am.onclick = () => {
      const opts = MODS.filter(([, , on]) => !on(s.p)).map(([k]) => k);
      UI.modal(`<div class="modal"><h2>Adicionar módulo a ${UI.esc(s.label)}</h2><div class="col" style="margin-top:16px">${opts.map((k) => `<button class="btn" data-k="${k}" style="justify-content:flex-start">${MODNAME[k]}</button>`).join('') || '<span class="muted">Todos os módulos já estão ativos.</span>'}</div></div>`, (m, close) => {
        m.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => {
          close();
          const k = b.dataset.k;
          app.change('Adicionar ' + MODNAME[k], () => {
            const p = s.p; s.manual[k] = true;
            if (k === 'hpf') p.hpf = { on: true, freq: 80 };
            if (k === 'eq') p.eq.push({ type: 'peaking', freq: 1000, gain: 0, q: 1, on: true, why: 'manual' });
            if (k === 'deess') p.deess = { on: true, freq: 6500, amount: 3 };
            if (k === 'comp') p.comp = Object.assign(p.comp, { on: true, ratio: 3, thr: -24, atk: 10, rel: 120, makeup: 2 });
            if (k === 'comp2') p.comp2 = Object.assign(p.comp2, { on: true, ratio: 2, thr: -24, atk: 15, rel: 200, makeup: 1 });
            if (k === 'trans') p.trans = { on: true, attack: 0.2, sustain: 0 };
            if (k === 'sat') p.sat = { on: true, model: 'tape', drive: 0.2, mix: 0.4 };
            if (k === 'duck') { const kick = app.state.stems.find((x) => MM.ROLES[x.role].fam === 'kick'); p.duck = { on: true, src: kick ? kick.id : null, freq: 120, depth: 3 }; }
            if (k === 'dyn') { const v = app.state.stems.find((x) => x.role === 'Lead Vocal'); p.dyn = [{ freq: 2500, q: 1.4, cut: 2, src: v ? v.id : null }]; }
          }, { stem: s.id, auto: ['duck', 'dyn', 'deess'].includes(k) });
          setTimeout(() => V.openEditor(app, s, k, null), 50);
        }));
      });
    };
  }
  V.mountSide = mountSide;
  V.sideHTML = sideHTML;

  // ---------- editor de módulo ----------
  V.closeEditor = function () { const e = UI.$('.editor'); if (e) e.remove(); document.removeEventListener('pointerdown', V._outside, true); };
  MM.app && (MM.app.closeEditor = V.closeEditor);
  const prm = (label, key, val, min, max, step, fmt) => `<div class="prm"><label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}" value="${val}" data-k="${key}"><span class="v" data-v="${key}">${fmt(val)}</span></div>`;
  const logS = { to: (f) => Math.log10(f), from: (v) => Math.round(Math.pow(10, v)) };

  V.openEditor = function (app, s, k, anchor) {
    V.closeEditor();
    if (!s) return;
    const st = app.state, p = s.p;
    const el = document.createElement('div');
    el.className = 'editor';
    const fdb = (v) => UI.fmtDb(+v) + ' dB', fms = (v) => Math.round(v) + ' ms', fhz = (v) => D.fmtHz(+v), fpc = (v) => Math.round(v * 100) + ' %';
    let body = '';
    if (k === 'hpf') body = `<div class="prm"><label>Ativo</label><button class="toggle ${p.hpf.on ? 'on' : ''}" data-t="hpf.on"></button><span></span></div>` + prm('Frequência', 'hpf.freq', logS.to(p.hpf.freq), 1.3, 2.9, 0.01, (v) => D.fmtHz(logS.from(v)));
    if (k === 'eq') {
      body = `<canvas class="eqcanvas" id="eqc"></canvas>` + p.eq.map((e, i) => `<div class="eqband"><div class="row" style="justify-content:space-between;margin-bottom:4px"><select class="field" data-sel="eq.${i}.type" style="height:28px;width:130px;font-size:12px">${['peaking', 'lowshelf', 'highshelf'].map((t) => `<option ${t === e.type ? 'selected' : ''} value="${t}">${{ peaking: 'Peak', lowshelf: 'Low shelf', highshelf: 'High shelf' }[t]}</option>`).join('')}</select><span class="small muted">${UI.esc(e.why || '')}</span><button class="btn icon xs ghost" data-del="${i}">${UI.icon('x')}</button></div>
        ${prm('Freq.', `eq.${i}.freq`, logS.to(e.freq), 1.3, 4.3, 0.005, (v) => D.fmtHz(logS.from(v)))}${prm('Ganho', `eq.${i}.gain`, e.gain, -12, 12, 0.1, fdb)}${e.type === 'peaking' ? prm('Q', `eq.${i}.q`, e.q, 0.3, 10, 0.1, (v) => UI.fmtNum(+v)) : ''}</div>`).join('') + `<button class="btn sm" data-addband>${UI.icon('plus')}Banda</button>`;
    }
    if (k === 'dyn') body = (p.dyn || []).map((d, i) => { const src = st.stems.find((x) => x.id === d.src); return `<div class="eqband"><div class="small muted" style="margin-bottom:4px">Atua quando <b style="color:var(--text)">${src ? UI.esc(src.label) : '—'}</b> toca</div>${prm('Freq.', `dyn.${i}.freq`, logS.to(d.freq), 1.3, 4.3, 0.005, (v) => D.fmtHz(logS.from(v)))}${prm('Corte máx.', `dyn.${i}.cut`, d.cut, 0, 9, 0.1, (v) => '−' + UI.fmtNum(+v) + ' dB')}</div>`; }).join('');
    if (k === 'deess') body = `<div class="prm"><label>Ativo</label><button class="toggle ${p.deess.on ? 'on' : ''}" data-t="deess.on"></button><span></span></div>` + prm('Frequência', 'deess.freq', logS.to(p.deess.freq), 3.5, 4.1, 0.005, (v) => D.fmtHz(logS.from(v))) + prm('Redução máx.', 'deess.amount', p.deess.amount, 0, 12, 0.1, (v) => '−' + UI.fmtNum(+v) + ' dB');
    if (k === 'comp' || k === 'comp2') {
      const c = p[k];
      body = `<div class="prm"><label>Ativo</label><button class="toggle ${c.on ? 'on' : ''}" data-t="${k}.on"></button><span class="small muted" style="text-align:right">GR <b class="mono" id="grv">—</b></span></div>` + prm('Threshold', k + '.thr', c.thr, -60, 0, 0.5, fdb) + prm('Ratio', k + '.ratio', c.ratio, 1, 20, 0.1, (v) => UI.fmtNum(+v) + ':1') + prm('Attack', k + '.atk', c.atk, 0.1, 100, 0.1, fms) + prm('Release', k + '.rel', c.rel, 10, 1000, 1, fms) + prm('Knee', k + '.knee', c.knee, 0, 18, 0.5, fdb) + prm('Makeup', k + '.makeup', c.makeup, 0, 24, 0.1, fdb) + prm('Mix (paralelo)', k + '.mix', c.mix, 0, 1, 0.01, fpc);
    }
    if (k === 'trans') body = `<div class="prm"><label>Ativo</label><button class="toggle ${p.trans.on ? 'on' : ''}" data-t="trans.on"></button><span></span></div>` + prm('Punch / attack', 'trans.attack', p.trans.attack, -1, 1, 0.01, (v) => UI.fmtDb(v * 12) + ' dB') + prm('Sustain', 'trans.sustain', p.trans.sustain, -1, 1, 0.01, (v) => UI.fmtDb(v * 12) + ' dB');
    if (k === 'sat') body = `<div class="prm"><label>Ativo</label><button class="toggle ${p.sat.on ? 'on' : ''}" data-t="sat.on"></button><span></span></div><div class="prm"><label>Modelo</label><select class="field" data-sel="sat.model">${Object.entries(MM.SAT_NAMES).map(([m, n]) => `<option value="${m}" ${m === p.sat.model ? 'selected' : ''}>${n}</option>`).join('')}</select><span></span></div>` + prm('Drive', 'sat.drive', p.sat.drive, 0, 1, 0.01, fpc) + prm('Mix', 'sat.mix', p.sat.mix, 0, 1, 0.01, fpc);
    if (k === 'duck') { const src = st.stems.find((x) => x.id === p.duck.src); body = `<div class="small muted" style="margin-bottom:8px">Baixa os graves deste stem nas pancadas de <b style="color:var(--text)">${src ? UI.esc(src.label) : '—'}</b> (sidechain multibanda).</div><div class="prm"><label>Ativo</label><button class="toggle ${p.duck.on ? 'on' : ''}" data-t="duck.on"></button><span></span></div>` + prm('Profundidade', 'duck.depth', p.duck.depth, 0, 12, 0.1, (v) => '−' + UI.fmtNum(+v) + ' dB') + prm('Crossover', 'duck.freq', p.duck.freq, 60, 250, 1, fhz); }
    if (k === 'sends') body = `<div class="prm"><label>Reverb</label><select class="field" data-sel="revType">${Object.entries(MM.REV_NAMES).map(([m, n]) => `<option value="${m}" ${m === p.revType ? 'selected' : ''}>${n}</option>`).join('')}</select><span></span></div>` + prm('Send reverb', 'sendRev', p.sendRev, -60, 0, 0.5, (v) => (v <= -59 ? 'off' : fdb(v))) + prm('Send delay', 'sendDly', p.sendDly, -60, 0, 0.5, (v) => (v <= -59 ? 'off' : fdb(v)));
    const aiv = s.ai ? 'IA' : '';
    el.innerHTML = `<div class="ttl"><div><div class="eyebrow">${UI.esc(s.label)}</div><h3 style="margin-top:4px">${MODNAME[k]}</h3></div><span class="tag ${isManual(s, k) ? 'manual' : 'ia'}">${isManual(s, k) ? 'MANUAL' : aiv || 'IA'}</span></div>${body}
      <div class="row" style="margin-top:14px;justify-content:space-between"><div class="row"><button class="btn sm" data-bypass>Bypass</button><button class="btn sm ghost" data-reset title="Repor o valor da IA">Reset IA</button></div><button class="btn sm" data-close>Fechar</button></div>`;
    document.body.appendChild(el);
    // posição
    const r = anchor ? anchor.getBoundingClientRect() : { left: window.innerWidth / 2 - 180, top: 140, right: window.innerWidth / 2, bottom: 160 };
    let left = r.right + 10, top = r.top - 20;
    if (left + 370 > window.innerWidth) left = Math.max(10, r.left - 370);
    el.style.left = left + 'px';
    el.style.top = Math.max(70, Math.min(top, window.innerHeight - el.offsetHeight - 20)) + 'px';
    UI.bindRanges(el);
    const get = (path) => path.split('.').reduce((o, x) => o[x], p);
    const setv = (path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((o, x) => o[x], p)[last] = v; };
    const g = () => app.engine.graph;
    const apply = (auto) => { s.manual = s.manual || {}; s.manual[k === 'sends' ? 'sendRev' : k] = true; if (k === 'sends') s.manual.sendDly = true; if (auto) { MM.buildAutomation(st, st.stems.filter((x) => !x.removed), null); app.engine.graph && st.stems.forEach((x) => g().applyStem(x)); app.engine.reschedule(); } else g() && g().applyStem(s); st.dirty.mix = true; };
    let committed = false;
    const commit = () => { if (!committed) { MM.commit(st, MODNAME[k] + ' ' + s.label); committed = true; } };
    el.querySelectorAll('input[type=range][data-k]').forEach((inp) => {
      const key = inp.dataset.k;
      const isLog = /freq/.test(key) && !/duck/.test(key);
      inp.addEventListener('pointerdown', commit);
      inp.addEventListener('input', () => {
        commit();
        let v = +inp.value;
        if (isLog) v = logS.from(v);
        setv(key, v);
        const lbl = el.querySelector(`[data-v="${key}"]`);
        if (lbl) lbl.textContent = isLog ? D.fmtHz(v) : /gain|thr|knee|makeup|sendRev|sendDly/.test(key) ? (v <= -59 && /send/.test(key) ? 'off' : UI.fmtDb(v) + ' dB') : /ratio/.test(key) ? UI.fmtNum(v) + ':1' : /atk|rel/.test(key) ? Math.round(v) + ' ms' : /mix|drive/.test(key) ? Math.round(v * 100) + ' %' : /attack|sustain/.test(key) ? UI.fmtDb(v * 12) + ' dB' : /cut|depth|amount/.test(key) ? '−' + UI.fmtNum(v) + ' dB' : /duck.freq/.test(key) ? D.fmtHz(v) : UI.fmtNum(v);
        apply(/^dyn/.test(key));
        if (k === 'eq') drawEq();
      });
      inp.addEventListener('change', () => { app.renderTop(); app.saveSoon(); });
    });
    el.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { commit(); const key = b.dataset.t; setv(key, !get(key)); b.classList.toggle('on'); apply(['deess.on', 'duck.on'].includes(key)); app.renderTop(); }));
    el.querySelectorAll('select[data-sel]').forEach((sel) => (sel.onchange = () => { commit(); setv(sel.dataset.sel, sel.value); apply(); if (k === 'eq') { V.openEditor(app, s, k, anchor); } app.renderTop(); }));
    el.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => { commit(); p.eq.splice(+b.dataset.del, 1); apply(); V.openEditor(app, s, k, anchor); }));
    const ab = el.querySelector('[data-addband]'); if (ab) ab.onclick = () => { commit(); p.eq.push({ type: 'peaking', freq: 1000, gain: 0, q: 1, on: true, why: 'manual' }); apply(); V.openEditor(app, s, k, anchor); };
    el.querySelector('[data-close]').onclick = () => { V.closeEditor(); app.refresh(); };
    el.querySelector('[data-bypass]').onclick = () => {
      commit();
      if (k === 'eq') p.eq.forEach((e) => (e.on = !e.on));
      else if (k === 'dyn') { s._dynBak = s._dynBak || p.dyn; p.dyn = p.dyn.length ? [] : s._dynBak; }
      else if (k === 'sends') { p.sendRev = -60; p.sendDly = -60; }
      else if (p[k] && 'on' in p[k]) p[k].on = !p[k].on;
      apply(k === 'dyn' || k === 'deess' || k === 'duck'); V.closeEditor(); app.refresh();
    };
    el.querySelector('[data-reset]').onclick = () => {
      if (!s.ai) return;
      commit();
      const ai = JSON.parse(JSON.stringify(s.ai));
      if (k === 'sends') { p.sendRev = ai.sendRev; p.sendDly = ai.sendDly; p.revType = ai.revType; delete s.manual.sendRev; delete s.manual.sendDly; }
      else { p[k] = ai[k]; delete s.manual[k]; }
      apply(true); V.closeEditor(); app.refresh();
    };
    function drawEq() {
      const cv = el.querySelector('#eqc'); if (!cv) return;
      const { ctx, w, h } = UI.fitCanvas(cv), sr = st.sampleRate;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1;
      [100, 1000, 10000].forEach((f) => { const x = (Math.log10(f / 20) / 3) * w; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); });
      ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
      const coefs = p.eq.filter((e) => e.on).map((e) => D.biquad(e.type, e.freq, e.q || 0.7, e.gain, sr));
      if (p.hpf.on) { coefs.push(D.biquad('highpass', p.hpf.freq, 0.5412, 0, sr)); coefs.push(D.biquad('highpass', p.hpf.freq, 1.3066, 0, sr)); }
      ctx.beginPath(); ctx.strokeStyle = '#5eead4'; ctx.lineWidth = 2;
      for (let x = 0; x <= w; x += 2) {
        const f = 20 * Math.pow(1000, x / w);
        const db = coefs.reduce((a, c) => a + D.biquadMagDb(c, f, sr), 0);
        const y = h / 2 - (D.clamp(db, -18, 18) / 18) * (h / 2 - 6);
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    drawEq();
    // GR ao vivo
    const grKey = k === 'comp' ? 'c:' + s.id : k === 'comp2' ? 'c2:' + s.id : null;
    if (grKey) { const iv = setInterval(() => { const gv = el.isConnected ? document.getElementById('grv') : null; if (!gv) { clearInterval(iv); return; } const v = g() && g().gr[grKey]; gv.textContent = v ? UI.fmtNum(v) + ' dB' : '0,0 dB'; }, 120); }
    V._outside = (e) => { if (!el.contains(e.target) && !e.target.closest('[data-mod]') && !e.target.closest('.modal')) { V.closeEditor(); app.refresh(); } };
    setTimeout(() => document.addEventListener('pointerdown', V._outside, true), 0);
  };
})();
