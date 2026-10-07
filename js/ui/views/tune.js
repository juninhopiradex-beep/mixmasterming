/* MIXMIND — vista "Voz": editor nota a nota (afinação, tempo, formantes, vibrato, ganho, harmonia).
 * O resultado substitui o áudio do stem ANTES da cadeia do mixer (EQ, compressão, sends…). */
(function () {
  const MM = window.MM, D = MM.dsp, UI = MM.ui;
  const V = (MM.views = MM.views || {});
  const T = () => MM.tune;
  const KW = 64, RH = 30, EH = 38; // teclado, régua, faixa de energia
  const TOOLS = [['hybrid', 'Híbrida', 'Arrastar: na vertical muda o pitch, na horizontal move no tempo; pelas pontas estica. Duplo clique centra a nota.'], ['pitch', 'Pitch', 'Arrastar na vertical (Alt = sem encaixe). Duplo clique centra.'], ['move', 'Mover', 'Arrastar na horizontal'], ['stretch', 'Esticar', 'Arrastar as pontas da nota'], ['split', 'Dividir', 'Clique para dividir a nota nesse ponto'], ['formant', 'Formantes', 'Arrastar na vertical: timbre mais claro/escuro, sem mudar a nota'], ['vibrato', 'Vibrato', 'Arrastar na vertical: menos / mais vibrato original'], ['gain', 'Ganho', 'Arrastar na vertical: nível da nota']];
  const name = (c) => { const k = Math.round(c / 100); return `${T().NOTE_NAMES[((k % 12) + 12) % 12]}${Math.floor(k / 12) - 1}`; };
  const fmtC = (v) => (v >= 0 ? '+' : '−') + Math.abs(Math.round(v)) + ' c';

  const vocalStems = (st) => st.stems.filter((s) => !s.removed && s.role !== 'Reference Track').sort((a, b) => (MM.ROLES[b.role].fam === 'vocal') - (MM.ROLES[a.role].fam === 'vocal') || (b.role === 'Lead Vocal') - (a.role === 'Lead Vocal'));
  const curStem = (app) => {
    const st = app.state, Z = app.tn;
    let s = st.stems.find((x) => x.id === Z.stem && !x.removed);
    if (!s) { s = vocalStems(st)[0]; Z.stem = s && s.id; }
    return s;
  };
  // tempo de saída de uma nota (depois de mover/esticar)
  const outT = (s, n) => { const e = T().editOf(s, n.id), mv = e.move || 0, sc = e.stretch || 1; return [n.t0 + mv, n.t0 + mv + (n.t1 - n.t0) * sc]; };

  V.tune = {
    flush: true,
    render(app) {
      const st = app.state;
      const Z = (app.tn = app.tn || { tool: 'hybrid', pps: 120, t0: 0, cTop: 7400, rowH: 18, sel: new Set(), follow: true, snap: 'scale', stem: app.tuneStem || null });
      if (app.tuneStem) { Z.stem = app.tuneStem; app.tuneStem = null; }
      const s = curStem(app);
      if (!s) return '<div class="empty-note">Sem stems nesta sessão.</div>';
      const t = s.p.tune || T().defaults(), ok = T().analyzed(s), key = T().keyOf(st, s);
      const opts = vocalStems(st).map((x) => `<option value="${x.id}" ${x.id === s.id ? 'selected' : ''}>${UI.esc(x.label)}${MM.ROLES[x.role].fam === 'vocal' ? '' : ' (não é voz)'}${T().hasEdits(x) ? ' ●' : ''}</option>`).join('');
      return `<div class="tn">
        <div class="tn-bar">
          <div class="tn-g"><div class="tn-l">STEM</div><select class="field" id="tnStem" style="height:32px;width:150px">${opts}</select></div>
          <div class="tn-g"><div class="tn-l">TRANSPORTE</div><div class="row" style="gap:6px"><button class="btn sm ${app.engine.playing ? 'acc' : ''}" id="tnPlay">${UI.icon(app.engine.playing ? 'pause' : 'play')}</button><button class="btn sm" id="tnRegion" title="Loop na seleção (ou no que está visível)">Região</button><button class="btn sm ${s.solo ? 'acc' : ''}" id="tnSolo" title="Solo deste stem">S</button><button class="btn sm ${Z.follow ? 'acc' : ''}" id="tnFollow" title="Seguir a reprodução">→|</button></div></div>
          <div class="tn-g"><div class="tn-l">EDITAR</div><div class="seg acc tn-tools">${TOOLS.map(([k, l, h]) => `<button data-tool="${k}" class="${Z.tool === k ? 'on' : ''}" title="${h}">${l}</button>`).join('')}</div></div>
          <button class="btn sm" id="tnFit" title="Ajustar a vista às notas">Ajustar</button>
          <div class="tn-g"><div class="tn-l">PITCH CENTRE</div><div class="row" style="gap:8px"><input type="range" id="tnCentre" min="0" max="100" step="1" value="${Math.round(V.tune.selCentre(app, s) * 100)}" style="width:90px"><span class="mono small" id="tnCentreV">${Math.round(V.tune.selCentre(app, s) * 100)} %</span></div></div>
          <button class="btn sm" id="tnKey" title="Tonalidade e escala">${UI.icon('gear')}${UI.esc(T().keyLabel(key))}</button>
          <span class="spacer"></span>
          <div class="tn-g"><div class="tn-l" style="display:flex;gap:10px"><span style="width:44px;text-align:center" title="Anti-artefactos: suaviza as transições entre notas editadas">ANTI</span><span style="width:44px;text-align:center" title="Sibilantes, respirações e outros sons sem pitch">SIB.</span></div><div class="row" style="gap:10px">${V.tune.dial('anti', '', Math.round((t.anti === undefined ? 0.4 : t.anti) * 100), 0, 100, '%')}${V.tune.dial('sib', '', +(t.sib || 0).toFixed(1), -12, 6, 'dB')}</div></div>
        </div>
        <div class="tn-body">
          <div class="tn-cv">${ok ? '<canvas id="tnCv"></canvas><canvas id="tnHd"></canvas>' : `<div class="tn-ana" id="tnAna"><div class="up" style="width:54px;height:54px">${UI.icon('mic')}</div><b>A analisar a voz de ${UI.esc(s.label)}…</b><div class="small muted">Pitch a cada 5 ms, notas, sibilantes e marcas de período. Fica guardado no projeto.</div><div class="bar" style="width:260px;margin-top:12px"><i id="tnAnaP" style="width:0"></i></div></div>`}</div>
          <div class="tn-side" id="tnSide"></div>
        </div>
        <div class="tn-foot">
          <button class="btn sm ghost" id="tnUndo" title="Desfazer (Ctrl+Z)">${UI.icon('undo')}</button><button class="btn sm ghost" id="tnRedo" title="Refazer">${UI.icon('redo')}</button>
          <button class="btn sm ${t.on === false ? '' : 'acc'}" id="tnAB" title="Ouvir com / sem as edições (A/B)">${t.on === false ? 'A/B: original' : 'A/B: editada'}</button>
          <button class="btn sm" id="tnRestore" title="Repor as notas selecionadas (ou todas) ao original">Repor</button>
          <button class="btn sm" id="tnLink" title="Liga as notas selecionadas com um glide suave">Link</button>
          <div class="row" style="gap:8px"><span class="small">Match energy</span><input type="range" id="tnMatch" min="0" max="100" step="1" value="${Math.round((t.match || 0) * 100)}" style="width:110px"><span class="mono small" id="tnMatchV">${Math.round((t.match || 0) * 100)} %</span></div>
          <button class="btn sm" id="tnHarm" title="Criar uma voz harmónica (novo stem)">◇ Harmonia</button>
          <button class="btn sm acc" id="tnAI" title="A IA centra as notas desafinadas sem mexer no vibrato">${UI.icon('spark')}Sugestão da IA</button>
          <span class="small muted" id="tnStatus"></span>
          <span class="spacer"></span>
          <span class="tiny dim">Roda: pitch · Shift+roda: tempo · Ctrl/⌘+roda: zoom · Alt: sem encaixe</span>
        </div>
      </div>`;
    },
    dial(id, label, v, min, max, unit) {
      return `<div class="dial" data-dial="${id}" data-min="${min}" data-max="${max}" data-v="${v}" title="Arrasta na vertical · duplo clique repõe">${V.tune.dialSVG((v - min) / (max - min))}<span>${v}<small>${unit}</small></span></div>`;
    },
    dialSVG(p) {
      const a0 = -225, a1 = 45, a = a0 + (a1 - a0) * D.clamp(p, 0, 1), rad = (d) => (d * Math.PI) / 180, pt = (ang, r) => [22 + r * Math.cos(rad(ang)), 22 + r * Math.sin(rad(ang))];
      const arc = (f, t2, r) => { const [x0, y0] = pt(f, r), [x1, y1] = pt(t2, r); return `M${x0} ${y0} A${r} ${r} 0 ${t2 - f > 180 ? 1 : 0} 1 ${x1} ${y1}`; };
      return `<svg viewBox="0 0 44 44"><path d="${arc(a0, a1, 18)}" stroke="rgba(255,255,255,.12)" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="${arc(a0, Math.max(a0 + 0.5, a), 18)}" stroke="#5eead4" stroke-width="3.5" fill="none" stroke-linecap="round"/></svg>`;
    },
    selCentre(app, s) {
      const Z = app.tn, ids = Z && Z.sel && Z.sel.size ? [...Z.sel] : T().notes(s).filter((n) => n.kind === 'v').map((n) => n.id);
      if (!ids.length || !T().analyzed(s)) return 0;
      return D.mean(ids.map((id) => T().editOf(s, id).centre || 0));
    },

    mount(app, root) {
      const st = app.state, Z = app.tn, s = curStem(app);
      if (!s) return;
      V.tune.root = root;
      root.querySelector('#tnStem').onchange = (e) => { Z.stem = e.target.value; Z.sel = new Set(); Z.fitted = false; app.refresh(); };
      root.querySelector('#tnPlay').onclick = async () => { await app.togglePlay(); V.tune.bar(app); };
      root.querySelector('#tnSolo').onclick = () => { app.toggleSM(s, 'solo', true); app.refresh(); };
      root.querySelector('#tnFollow').onclick = () => { Z.follow = !Z.follow; app.refresh(); };
      root.querySelector('#tnRegion').onclick = () => {
        const ns = T().notes(s).filter((n) => Z.sel.has(n.id));
        let a, b; if (ns.length) { a = Math.min(...ns.map((n) => outT(s, n)[0])) - 0.3; b = Math.max(...ns.map((n) => outT(s, n)[1])) + 0.3; } else { const v = V.tune.vis(app); a = v.a; b = v.b; }
        app.engine.loop = [Math.max(0, a), b]; app.engine.seek(Math.max(0, a)); if (!app.engine.playing) app.togglePlay(); UI.toast(`Loop ${D.fmtTime(a)} – ${D.fmtTime(b)} (botão de loop na barra de baixo para desligar).`, 'ok', 2200);
      };
      root.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => { Z.tool = b.dataset.tool; root.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('on', x === b)); }));
      root.querySelector('#tnFit').onclick = () => { V.tune.fit(app, s); V.tune.draw(app); };
      root.querySelector('#tnKey').onclick = () => V.tune.keyModal(app, s);
      root.querySelector('#tnAB').onclick = () => { MM.commit(st, 'Editor de voz A/B'); const t = T().state(s); t.on = t.on === false; app.refresh(); V.tune.commit(app, s, false); };
      root.querySelector('#tnRestore').onclick = async () => {
        const t = T().state(s);
        if (Z.sel.size) { MM.commit(st, 'Repor notas'); Z.sel.forEach((id) => delete t.edits[id]); }
        else { if (!(await UI.confirm('Repor tudo', `Todas as edições de ${UI.esc(s.label)} voltam ao original (a análise mantém-se). Podes desfazer com Ctrl+Z.`, 'Repor'))) return; MM.commit(st, 'Repor voz'); t.edits = {}; t.splits = []; t.match = 0; t.sib = 0; s._tuneNotes = null; }
        V.tune.commit(app, s);
      };
      const cen = root.querySelector('#tnCentre');
      cen.oninput = () => { root.querySelector('#tnCentreV').textContent = cen.value + ' %'; };
      cen.onchange = () => {
        MM.commit(st, 'Pitch Centre ' + cen.value + ' %');
        const ids = Z.sel.size ? [...Z.sel] : T().notes(s).filter((n) => n.kind === 'v').map((n) => n.id);
        ids.forEach((id) => { const e = T().edit(s, id); e.centre = +cen.value / 100; e.manual = true; });
        V.tune.commit(app, s);
      };
      const mt = root.querySelector('#tnMatch');
      mt.oninput = () => { root.querySelector('#tnMatchV').textContent = mt.value + ' %'; };
      mt.onchange = () => { MM.commit(st, 'Match energy'); T().state(s).match = +mt.value / 100; V.tune.commit(app, s); };
      root.querySelector('#tnUndo').onclick = () => app.undo();
      root.querySelector('#tnRedo').onclick = () => app.redo();
      root.querySelector('#tnLink').onclick = () => {
        const ns = T().notes(s).filter((n) => Z.sel.has(n.id) && n.kind === 'v');
        if (ns.length < 2) { UI.toast('Seleciona duas ou mais notas seguidas para as ligar.', 'warn'); return; }
        MM.commit(st, 'Link de notas');
        const all = ns.slice(1).every((n) => T().editOf(s, n.id).link);
        ns.slice(1).forEach((n) => { const e = T().edit(s, n.id); e.link = !all; if (!e.glide) e.glide = 90; });
        V.tune.commit(app, s);
      };
      root.querySelector('#tnHarm').onclick = () => V.tune.harmModal(app, s);
      root.querySelector('#tnAI').onclick = () => V.tune.aiModal(app, s);
      root.querySelectorAll('[data-dial]').forEach((d) => V.tune.bindDial(app, s, d));
      if (!T().analyzed(s)) { V.tune.analyze(app, s); V.tune.side(app); return; }
      V.tune.bindCanvas(app, s, root.querySelector('#tnCv'));
      if (!Z.fitted || Z.fitStem !== s.id) { V.tune.fit(app, s); Z.fitted = true; Z.fitStem = s.id; }
      V.tune.draw(app); V.tune.side(app); V.tune.status(app);
      V.tune._keys = (e) => V.tune.keys(app, e);
      window.addEventListener('keydown', V.tune._keys, true);
      V.tune._ro = new ResizeObserver(() => V.tune.draw(app)); V.tune._ro.observe(root.querySelector('.tn-cv'));
    },
    unmount() {
      if (V.tune._keys) window.removeEventListener('keydown', V.tune._keys, true);
      if (V.tune._ro) V.tune._ro.disconnect();
      V.tune._keys = null; V.tune.root = null;
    },
    onTuned(app) { V.tune.status(app); },
    bar(app) { const b = V.tune.root && V.tune.root.querySelector('#tnPlay'); if (b) { b.innerHTML = UI.icon(app.engine.playing ? 'pause' : 'play'); b.classList.toggle('acc', app.engine.playing); } },

    async analyze(app, s) {
      if (V.tune.busy) return;
      V.tune.busy = true;
      try {
        await T().analyze(s, s.buffer ? s.buffer.sampleRate : app.state.sampleRate, (p) => { const el = document.getElementById('tnAnaP'); if (el) el.style.width = Math.round(p * 100) + '%'; });
        if (!s.p.tune) s.p.tune = T().defaults();
        MM.saveProject(app.state);
      } catch (e) { console.error(e); UI.toast('Não foi possível analisar a voz: ' + e.message, 'err'); }
      V.tune.busy = false;
      if (app.view === 'tune') app.refresh();
    },

    // ---------- geometria ----------
    geo(app) {
      const cv = V.tune.root && V.tune.root.querySelector('#tnCv'); if (!cv) return null;
      const Z = app.tn, w = cv.clientWidth, h = cv.clientHeight;
      return { cv, w, h, x: (t) => KW + (t - Z.t0) * Z.pps, t: (x) => Z.t0 + (x - KW) / Z.pps, y: (c) => RH + ((Z.cTop - c) / 100) * Z.rowH, c: (y) => Z.cTop - ((y - RH) / Z.rowH) * 100, bottom: h - EH };
    },
    vis(app) { const g = V.tune.geo(app); return g ? { a: g.t(KW), b: g.t(g.w) } : { a: 0, b: 10 }; },
    fit(app, s) {
      const Z = app.tn, g = V.tune.geo(app), ns = T().notes(s).filter((n) => n.kind === 'v');
      if (!g || !ns.length) return;
      const cs = ns.map((n) => n.c).sort((a, b) => a - b), lo = cs[Math.floor(cs.length * 0.03)], hi = cs[Math.min(cs.length - 1, Math.floor(cs.length * 0.97))];
      const rows = Math.max(14, (hi - lo) / 100 + 6); Z.rowH = D.clamp((g.bottom - RH) / rows, 10, 30);
      Z.cTop = Math.ceil((hi + 300) / 100) * 100 + 50;
      // tempo: começa na primeira nota visível, ~16 s no ecrã
      const first = ns[0].t0; Z.pps = D.clamp((g.w - KW) / 16, 20, 2000); Z.t0 = Math.max(0, Math.min(first - 0.5, app.engine.position() - 1));
    },

    // ---------- desenho ----------
    draw(app) {
      const g = V.tune.geo(app); if (!g) return;
      const st = app.state, Z = app.tn, s = curStem(app); if (!s || !T().analyzed(s)) return;
      const { ctx, w, h } = UI.fitCanvas(g.cv), A = s.features.pitch, key = T().keyOf(st, s), pcs = T().SCALES[key ? key.scale : 'chromatic'][1].map((v) => (v + (key ? key.tonic : 0)) % 12);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#0a0d12'; ctx.fillRect(0, 0, w, h);
      // linhas das notas (fora da escala mais escuras)
      const kTop = Math.ceil(Z.cTop / 100), kBot = Math.floor(g.c(g.bottom) / 100);
      for (let k = kBot; k <= kTop; k++) {
        const y0 = g.y(k * 100 + 50), y1 = g.y(k * 100 - 50), pc = ((k % 12) + 12) % 12, inS = pcs.includes(pc);
        ctx.fillStyle = pc === (key ? key.tonic : -1) ? 'rgba(94,234,212,.07)' : inS ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.25)';
        ctx.fillRect(KW, y0, w - KW, y1 - y0);
        ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(KW, y1, w - KW, 1);
        // teclado
        const black = [1, 3, 6, 8, 10].includes(pc);
        ctx.fillStyle = black ? '#1a1f28' : '#d9dee6'; ctx.fillRect(2, y0 + 0.5, KW - 6, y1 - y0 - 1);
        if (Z.rowH >= 11) { ctx.fillStyle = black ? '#aeb6c4' : '#2a303a'; ctx.font = `${Math.min(11, Z.rowH - 3)}px Geist Mono, monospace`; ctx.textAlign = 'right'; ctx.fillText(name(k * 100), KW - 10, (y0 + y1) / 2 + 4); ctx.textAlign = 'left'; }
        if (!inS) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(2, y0 + 0.5, KW - 6, y1 - y0 - 1); }
      }
      // compassos
      const m = st.music, barSec = m.barSec || 2.5, db = m.downbeat || 0;
      const every = [1, 2, 4, 8, 16].find((k) => barSec * k * Z.pps >= 60) || 32;
      ctx.font = '10.5px Geist Mono, monospace';
      for (let b = Math.max(0, Math.floor((g.t(KW) - db) / barSec / every) * every); ; b += every) {
        const tt = db + b * barSec, x = g.x(tt); if (x > w) break; if (x < KW) continue;
        ctx.fillStyle = 'rgba(255,255,255,.09)'; ctx.fillRect(x, RH, 1, g.bottom - RH);
        if (every === 1 && barSec * Z.pps > 120) for (let q = 1; q < 4; q++) { const xq = g.x(tt + (q * barSec) / 4); ctx.fillStyle = 'rgba(255,255,255,.035)'; ctx.fillRect(xq, RH, 1, g.bottom - RH); }
        ctx.fillStyle = '#7d8696'; ctx.fillText(String(b + 1), x + 4, 12);
      }
      // secções na régua
      (m.sections || []).forEach((sec, i) => { const a = Math.max(KW, g.x(sec.start)), b = Math.min(w, g.x(sec.end)); if (b <= a) return; ctx.fillStyle = i % 2 ? 'rgba(94,234,212,.08)' : 'rgba(94,234,212,.14)'; ctx.fillRect(a, 16, b - a, 12); ctx.fillStyle = '#9fe9da'; ctx.font = '10px Geist, sans-serif'; ctx.fillText((MM.sections ? MM.sections.label(st, i) : sec.name).slice(0, Math.max(0, Math.floor((b - a) / 6))), a + 4, 25); });
      ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(KW, RH - 1, w - KW, 1);
      // faixa de energia (voz)
      ctx.fillStyle = 'rgba(255,255,255,.03)'; ctx.fillRect(KW, g.bottom, w - KW, EH);
      ctx.beginPath(); ctx.moveTo(KW, h);
      let pk = -120; for (let f = 0; f < A.db.length; f += 3) if (A.db[f] > pk) pk = A.db[f];
      for (let x = KW; x < w; x += 2) { const f = Math.round((g.t(x) - A.off) / A.hop); const v = f >= 0 && f < A.db.length ? D.clamp((A.db[f] - pk + 50) / 50, 0, 1) : 0; ctx.lineTo(x, h - 3 - v * (EH - 8)); }
      ctx.lineTo(w, h); ctx.closePath(); ctx.fillStyle = 'rgba(148,163,184,.25)'; ctx.fill();
      // notas
      const notes = T().notes(s), psig = JSON.stringify([s.p.tune, key, s.id]), P = V.tune._psig === psig ? V.tune._plan : (V.tune._plan = T().plan(s, key)), rects = []; V.tune._psig = psig;
      const prevC = []; let lastC = null; notes.forEach((n) => { if (n.kind === 'v') lastC = T().target(n, T().editOf(s, n.id), key); prevC.push(lastC); });
      notes.forEach((n, i) => {
        const e = T().editOf(s, n.id), [a, b] = outT(s, n), x0 = g.x(a), x1 = g.x(b);
        if (x1 < KW || x0 > w) { rects.push(null); return; }
        const sel = Z.sel.has(n.id), muted = e.gain !== undefined && e.gain <= -59;
        if (n.kind === 'u') {
          const c = prevC[i] !== null ? prevC[i] - 250 : (notes.find((q) => q.kind === 'v') || { c: 6000 }).c - 250, y = g.y(c);
          const r = { x: Math.max(KW, x0), y: y - Z.rowH * 0.32, w: Math.max(4, x1 - Math.max(KW, x0)), h: Z.rowH * 0.64, n };
          ctx.fillStyle = sel ? 'rgba(226,232,240,.75)' : 'rgba(148,163,184,.42)'; rr(ctx, r.x, r.y, r.w, r.h, 4); ctx.fill();
          rects.push(r); return;
        }
        const tc = T().target(n, e, key), y = g.y(tc);
        const r = { x: x0, y: y - Z.rowH * 0.45, w: Math.max(3, x1 - x0), h: Z.rowH * 0.9, n };
        const edited = Object.keys(e).some((k) => !['manual', 'ai'].includes(k));
        ctx.fillStyle = muted ? 'rgba(94,234,212,.12)' : edited ? 'rgba(94,234,212,.95)' : 'rgba(94,234,212,.62)';
        rr(ctx, r.x, r.y, r.w, r.h, Math.min(6, r.h / 2)); ctx.fill();
        if (sel) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke(); }
        // desvio em relação à nota da escala (barra fina) — quanto falta afinar
        const dev = tc - T().snap(tc, key);
        if (Math.abs(dev) > 8 && r.w > 14) { ctx.fillStyle = Math.abs(dev) > 25 ? '#fbbf24' : 'rgba(251,191,36,.55)'; const yy = g.y(tc - dev); ctx.fillRect(r.x + 3, Math.min(y, yy), 2, Math.max(1, Math.abs(yy - y))); }
        // formantes / ganho / vibrato acrescentado: pequenos marcadores
        let badge = '';
        if (e.formant) badge += `F${e.formant > 0 ? '+' : ''}${Math.round(e.formant)} `;
        if (e.gain && !muted) badge += `${e.gain > 0 ? '+' : ''}${e.gain.toFixed(1)}dB `;
        if (e.vib !== undefined && Math.abs(e.vib - 1) > 0.01) badge += `v${Math.round(e.vib * 100)}% `;
        if (e.link) badge = '⌒ ' + badge;
        if (e.ai && !e.manual) badge += 'IA';
        if (badge && r.w > 34 && Z.rowH > 12) { ctx.fillStyle = '#062a26'; ctx.font = '9.5px Geist Mono, monospace'; ctx.fillText(badge.trim().slice(0, Math.floor(r.w / 6)), r.x + 6, r.y + r.h - 3); }
        rects.push(r);
        // curva de pitch (o que vai soar) e original (tracejado, se editada)
        const sc = e.stretch || 1, mv = e.move || 0;
        const curve = (useDelta) => { ctx.beginPath(); let on = false; for (let f = n.i0; f < n.i1; f++) { const o = A.cents[f]; if (isNaN(o) || Math.abs(o - n.c) > 700) { on = false; continue; } const tf = A.off + f * A.hop, to = n.t0 + mv + (tf - n.t0) * sc, xx = g.x(to), yy = g.y(o + (useDelta ? P.delta[f] : 0)); if (!on) { ctx.moveTo(xx, yy); on = true; } else ctx.lineTo(xx, yy); } ctx.stroke(); };
        if (edited) { ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(253,186,116,.35)'; ctx.lineWidth = 1; curve(false); ctx.setLineDash([]); }
        ctx.strokeStyle = muted ? 'rgba(253,186,116,.3)' : '#fdba74'; ctx.lineWidth = 1.4; curve(true);
      });
      V.tune._rects = rects;
      // retângulo de seleção
      if (Z.band) { ctx.strokeStyle = '#5eead4'; ctx.setLineDash([4, 3]); ctx.strokeRect(Z.band.x0, Z.band.y0, Z.band.x1 - Z.band.x0, Z.band.y1 - Z.band.y0); ctx.setLineDash([]); }
      // cabeça de reprodução (camada própria: não obriga a redesenhar as notas)
      V.tune.drawHead(app);
    },
    drawHead(app) {
      const g = V.tune.geo(app), hd = V.tune.root && V.tune.root.querySelector('#tnHd'); if (!g || !hd) return;
      const { ctx, w, h } = UI.fitCanvas(hd); ctx.clearRect(0, 0, w, h);
      const x = g.x(app.engine.position());
      if (x >= KW && x <= g.w) { ctx.fillStyle = '#5eead4'; ctx.fillRect(x, RH - 4, 1.5, g.h - RH + 4); ctx.beginPath(); ctx.moveTo(x - 5, RH - 8); ctx.lineTo(x + 6, RH - 8); ctx.lineTo(x + 0.75, RH - 1); ctx.fill(); }
      V.tune._headX = x;
    },
    frame(app) {
      const Z = app.tn; if (!Z || !V.tune.root) return;
      const g = V.tune.geo(app); if (!g) return;
      const p = app.engine.position(), x = g.x(p);
      if (app.engine.playing && Z.follow && (x > g.w - 40 || x < KW)) { Z.t0 = Math.max(0, p - 1); V.tune.draw(app); return; }
      if (Math.abs((V.tune._headX || 0) - x) > 0.5) V.tune.drawHead(app);
    },

    // ---------- interação ----------
    hit(app, mx, my) { const R = V.tune._rects || []; for (let i = R.length - 1; i >= 0; i--) { const r = R[i]; if (r && mx >= r.x - 2 && mx <= r.x + r.w + 2 && my >= r.y - 2 && my <= r.y + r.h + 2) return r; } return null; },
    bindCanvas(app, s, cv) {
      const st = app.state, Z = app.tn;
      const pt = (e) => { const b = cv.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
      cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        const g = V.tune.geo(app), [mx, my] = pt(e);
        if (e.ctrlKey || e.metaKey) { const t0 = g.t(mx); Z.pps = D.clamp(Z.pps * Math.exp(-e.deltaY * 0.0015), 8, 4000); Z.t0 = Math.max(0, t0 - (mx - KW) / Z.pps); }
        else if (e.altKey) { const c0 = g.c(my); Z.rowH = D.clamp(Z.rowH * Math.exp(-e.deltaY * 0.0015), 8, 48); Z.cTop = c0 + ((my - RH) / Z.rowH) * 100; }
        else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) Z.t0 = Math.max(0, Z.t0 + (e.deltaX || e.deltaY) / Z.pps);
        else Z.cTop = D.clamp(Z.cTop - (e.deltaY / Z.rowH) * 100 * 0.5, 3000, 10800);
        V.tune.draw(app);
      }, { passive: false });
      cv.addEventListener('dblclick', (e) => {
        const [mx, my] = pt(e), r = V.tune.hit(app, mx, my);
        if (!r || r.n.kind !== 'v' || !['hybrid', 'pitch'].includes(Z.tool)) return;
        MM.commit(st, 'Centrar nota');
        const ids = Z.sel.has(r.n.id) ? [...Z.sel] : [r.n.id];
        ids.forEach((id) => { const e2 = T().edit(s, id); e2.centre = 1; e2.manual = true; });
        V.tune.commit(app, s);
      });
      cv.addEventListener('pointerdown', (e) => {
        const g = V.tune.geo(app), [mx, my] = pt(e);
        if (my < RH) { app.engine.seek(Math.max(0, g.t(mx))); V.tune.draw(app); return; }
        if (mx < KW) return;
        const r = V.tune.hit(app, mx, my);
        if (!r) { if (!e.shiftKey) Z.sel = new Set(); Z.band = { x0: mx, y0: my, x1: mx, y1: my, add: e.shiftKey }; cv.setPointerCapture(e.pointerId); V.tune.draw(app); V.tune.side(app); return; }
        const n = r.n;
        if (e.shiftKey) { if (Z.sel.has(n.id)) Z.sel.delete(n.id); else Z.sel.add(n.id); V.tune.draw(app); V.tune.side(app); return; }
        if (!Z.sel.has(n.id)) Z.sel = new Set([n.id]);
        // dividir
        if (Z.tool === 'split') {
          const [a] = outT(s, n), e0 = T().editOf(s, n.id), tin = n.t0 + (g.t(mx) - a) / (e0.stretch || 1);
          if (tin - n.t0 < 0.03 || n.t1 - tin < 0.03) { UI.toast('Demasiado perto da ponta da nota.', 'warn', 1500); return; }
          MM.commit(st, 'Dividir nota');
          const t = T().state(s); t.splits = (t.splits || []).concat([+tin.toFixed(4)]); s._tuneNotes = null;
          const nid = 'n' + Math.round(tin * 1000); if (t.edits[n.id]) t.edits[nid] = JSON.parse(JSON.stringify(t.edits[n.id]));
          Z.sel = new Set([n.id, nid]);
          V.tune.commit(app, s); return;
        }
        // que gesto? (pontas = esticar; corpo = conforme a ferramenta)
        const edge = r.w > 14 && (mx - r.x < 7 ? 'L' : r.x + r.w - mx < 7 ? 'R' : null);
        let mode = Z.tool;
        if (Z.tool === 'hybrid') mode = edge ? 'stretch' + edge : 'free';
        else if (Z.tool === 'stretch') mode = 'stretch' + (edge || (mx - r.x < r.w / 2 ? 'L' : 'R'));
        const sel = T().notes(s).filter((q) => Z.sel.has(q.id));
        const key = T().keyOf(st, s);
        Z.drag = { mode, x0: mx, y0: my, n, key, base: sel.map((q) => ({ q, e: JSON.parse(JSON.stringify(T().editOf(s, q.id))), tc: q.kind === 'v' ? T().target(q, T().editOf(s, q.id), key) : null })), committed: false, axis: null };
        cv.setPointerCapture(e.pointerId);
        V.tune.draw(app); V.tune.side(app);
      });
      cv.addEventListener('pointermove', (e) => {
        const g = V.tune.geo(app), [mx, my] = pt(e);
        if (Z.band) { Z.band.x1 = mx; Z.band.y1 = my; const xa = Math.min(Z.band.x0, mx), xb = Math.max(Z.band.x0, mx), ya = Math.min(Z.band.y0, my), yb = Math.max(Z.band.y0, my); (V.tune._rects || []).forEach((r) => { if (r && r.x + r.w > xa && r.x < xb && r.y + r.h > ya && r.y < yb) Z.sel.add(r.n.id); }); V.tune.draw(app); return; }
        const d = Z.drag;
        if (!d) { const r = V.tune.hit(app, mx, my); cv.style.cursor = !r ? 'default' : Z.tool === 'split' ? 'col-resize' : (r.w > 14 && (mx - r.x < 7 || r.x + r.w - mx < 7) && ['hybrid', 'stretch'].includes(Z.tool)) ? 'ew-resize' : Z.tool === 'move' ? 'grab' : 'ns-resize'; return; }
        const dx = mx - d.x0, dy = my - d.y0;
        if (!d.committed) { if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return; MM.commit(st, 'Editor de voz · ' + (TOOLS.find((x) => x[0] === Z.tool) || [0, ''])[1]); d.committed = true; }
        let mode = d.mode;
        if (mode === 'free') { if (!d.axis) d.axis = Math.abs(dy) >= Math.abs(dx) ? 'pitch' : 'move'; mode = d.axis; }
        const dt = dx / Z.pps;
        d.base.forEach(({ q, e: e0, tc }) => {
          const e2 = T().edit(s, q.id); e2.manual = true;
          if (mode === 'pitch' && q.kind === 'v') {
            const anchor = d.base.find((b) => b.q.id === d.n.id) || d.base[0];
            const raw = (anchor.tc === null ? tc : anchor.tc) - (dy / Z.rowH) * 100;
            const snapped = e.altKey ? raw : app.tn.snap === 'scale' ? T().snap(raw, d.key) : Math.round(raw / 100) * 100;
            const dc = snapped - (anchor.tc === null ? tc : anchor.tc);
            e2.shift = +(tc + dc - q.c).toFixed(1); e2.centre = 0;
          } else if (mode === 'move') e2.move = +((e0.move || 0) + dt).toFixed(4);
          else if (mode === 'stretchR') e2.stretch = +D.clamp(((e0.stretch || 1) * (q.t1 - q.t0) + dt) / (q.t1 - q.t0), 0.25, 4).toFixed(4);
          else if (mode === 'stretchL') { const dur0 = (e0.stretch || 1) * (q.t1 - q.t0), nd = D.clamp(dur0 - dt, 0.25 * (q.t1 - q.t0), 4 * (q.t1 - q.t0)); e2.move = +((e0.move || 0) + (dur0 - nd)).toFixed(4); e2.stretch = +(nd / (q.t1 - q.t0)).toFixed(4); }
          else if (mode === 'formant') e2.formant = Math.round(D.clamp((e0.formant || 0) - dy * 4, -1200, 1200));
          else if (mode === 'vibrato' && q.kind === 'v') e2.vib = +D.clamp((e0.vib === undefined ? 1 : e0.vib) - dy / 120, 0, 2.5).toFixed(2);
          else if (mode === 'gain') { const v = D.clamp((e0.gain || 0) - dy / 5, -60, 12); e2.gain = v <= -59 ? -60 : +v.toFixed(1); }
        });
        V.tune.draw(app); V.tune.side(app);
      });
      const up = () => {
        if (Z.band) { Z.band = null; V.tune.draw(app); V.tune.side(app); return; }
        const d = Z.drag; Z.drag = null;
        if (d && d.committed) V.tune.commit(app, s);
      };
      cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    },
    keys(app, e) {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' && e.target.type !== 'range' || tag === 'textarea' || tag === 'select') return;
      const Z = app.tn, s = curStem(app); if (!s || !T().analyzed(s)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); e.stopImmediatePropagation(); Z.sel = new Set(T().notes(s).map((n) => n.id)); V.tune.draw(app); V.tune.side(app); return; }
      if (!Z.sel.size) return;
      const st = app.state, ids = [...Z.sel];
      const go = (label, fn) => { e.preventDefault(); e.stopImmediatePropagation(); MM.commit(st, label); ids.forEach((id) => { const n = T().notes(s).find((q) => q.id === id); if (n) { const e2 = T().edit(s, id); e2.manual = true; fn(e2, n); } }); V.tune.commit(app, s); };
      if (e.key === 'Escape') { e.stopImmediatePropagation(); Z.sel = new Set(); V.tune.draw(app); V.tune.side(app); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { const sg = e.key === 'ArrowUp' ? 1 : -1, step = e.altKey ? 10 : 100; go('Pitch ' + (sg > 0 ? '+' : '−') + step + ' c', (e2, n) => { if (n.kind === 'v') { e2.shift = (e2.shift || 0) + sg * step; if (step === 100) e2.centre = e2.centre || 0; } }); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { const sg = e.key === 'ArrowRight' ? 1 : -1, step = e.shiftKey ? 0.05 : 0.01; go('Mover nota', (e2) => { e2.move = +((e2.move || 0) + sg * step).toFixed(4); }); }
      else if (e.key === 'Delete' || e.key === 'Backspace') go('Calar nota', (e2) => { e2.gain = e2.gain !== undefined && e2.gain <= -59 ? 0 : -60; });
    },

    // ---------- aplicar ----------
    commit(app, s, redraw) {
      const st = app.state;
      st.dirty.mix = true; app.saveSoon();
      if (redraw !== false) { V.tune.draw(app); V.tune.side(app); }
      V.tune.status(app, 'A renderizar a voz…');
      app.syncTune().then(() => { V.tune.status(app); app.renderTop(); });
    },
    status(app, txt) {
      const el = V.tune.root && V.tune.root.querySelector('#tnStatus'); if (!el) return;
      const s = curStem(app); if (!s || !T().analyzed(s)) { el.textContent = ''; return; }
      if (txt) { el.textContent = txt; return; }
      const key = T().keyOf(app.state, s), ns = T().notes(s), v = ns.filter((n) => n.kind === 'v');
      const off = v.filter((n) => Math.abs(T().target(n, T().editOf(s, n.id), key) - T().snap(T().target(n, T().editOf(s, n.id), key), key)) > 15).length;
      el.innerHTML = `Pronto · ${ns.length} eventos · ${v.length} notas · <span class="${off ? 'warn-t' : 'acc-t'}">${off} a mais de 15 c da escala</span>${T().hasEdits(s) ? ' · edições ativas' : ''}`;
    },
    /** Painel lateral: propriedades da seleção. */
    side(app) {
      const el = V.tune.root && V.tune.root.querySelector('#tnSide'); if (!el) return;
      const st = app.state, Z = app.tn, s = curStem(app);
      if (!s || !T().analyzed(s)) { el.innerHTML = `<div class="eyebrow">Editor de voz</div><p class="small muted" style="margin-top:10px">O resultado substitui a voz <b>antes</b> do mixer: EQ, compressão, sends e o master já recebem a voz editada. O “Original” (tecla 1) continua a ser a gravação crua.</p>`; return; }
      const key = T().keyOf(st, s), ns = T().notes(s).filter((n) => Z.sel.has(n.id)), nv = ns.filter((n) => n.kind === 'v');
      if (!ns.length) {
        const v = T().notes(s).filter((n) => n.kind === 'v'), devs = v.map((n) => Math.abs(n.c - T().snap(n.c, key)));
        el.innerHTML = `<div class="eyebrow">Voz · ${UI.esc(s.label)}</div>
          <div class="kv" style="margin-top:12px"><div><div class="k">Tonalidade</div><div class="v" style="font-size:16px">${UI.esc(T().keyLabel(key))}</div></div><div><div class="k">Notas</div><div class="v" style="font-size:16px">${v.length}</div></div><div><div class="k">Desvio médio</div><div class="v" style="font-size:16px">${devs.length ? Math.round(D.mean(devs)) : 0} c</div></div><div><div class="k">> 25 c</div><div class="v" style="font-size:16px">${devs.filter((d) => d > 25).length}</div></div></div>
          <p class="small muted" style="margin-top:14px">Clica numa nota (Shift para juntar, ou arrasta um retângulo). ↑ ↓ meio-tom (Alt: 10 c) · ← → mover · Delete cala · Ctrl+A tudo.</p>
          <p class="small muted">As barras amarelas mostram quanto cada nota está fora da escala. A linha laranja é o pitch que vai soar; o tracejado é o original.</p>
          <p class="tiny dim" style="margin-top:14px">Afinação por PSOLA com formantes preservados. Só as zonas editadas são processadas — o resto da gravação passa intacto, bit a bit.</p>`;
        return;
      }
      const e = T().editOf(s, ns[0].id), avg = (k, d) => D.mean(ns.map((n) => { const v = T().editOf(s, n.id)[k]; return v === undefined ? d : v; }));
      const one = ns.length === 1 ? ns[0] : null, tc = one && one.kind === 'v' ? T().target(one, e, key) : null;
      const row = (k, label, v, min, max, step, unit, fmt) => `<div class="tn-row"><div class="row" style="justify-content:space-between"><span class="small">${label}</span><span class="mono small" data-out="${k}">${fmt ? fmt(v) : v + (unit || '')}</span></div><input type="range" data-ed="${k}" min="${min}" max="${max}" step="${step}" value="${v}"></div>`;
      el.innerHTML = `<div class="eyebrow">${ns.length === 1 ? (one.kind === 'v' ? 'Nota' : 'Evento sem pitch') : ns.length + ' selecionadas'}</div>
        ${one && one.kind === 'v' ? `<div class="tn-note"><b>${name(tc)}</b> <span class="mono">${fmtC(tc - Math.round(tc / 100) * 100)}</span><span class="small muted"> · original ${name(one.c)} ${fmtC(one.c - Math.round(one.c / 100) * 100)} · ${Math.round((one.t1 - one.t0) * 1000)} ms${one.v > 15 && one.t1 - one.t0 > 0.25 ? ` · vibrato ±${Math.round(one.v)} c a ${one.r.toFixed(1)} Hz` : ''}</span></div>` : ''}
        ${nv.length ? `<div class="row wrap" style="gap:6px;margin:10px 0 4px"><button class="btn xs" data-nud="-100">−1 st</button><button class="btn xs" data-nud="-10">−10 c</button><button class="btn xs" data-nud="10">+10 c</button><button class="btn xs" data-nud="100">+1 st</button><button class="btn xs acc" data-snapnow title="Centra na nota da escala">Centrar</button></div>
        ${row('centre', 'Centro (Pitch Centre)', Math.round(avg('centre', 0) * 100), 0, 100, 1, ' %')}
        ${row('drift', 'Drift (endireitar)', Math.round(avg('drift', 0) * 100), 0, 100, 1, ' %')}
        ${row('vib', 'Vibrato original', Math.round(avg('vib', 1) * 100), 0, 250, 1, ' %')}
        ${row('avd', 'Vibrato acrescentado', Math.round(D.mean(ns.map((n) => (T().editOf(s, n.id).avib || {}).d || 0))), 0, 100, 1, ' c')}
        ${row('avr', 'Velocidade do vibrato', +D.mean(ns.map((n) => (T().editOf(s, n.id).avib || {}).r || 5.5)).toFixed(1), 3, 8, 0.1, ' Hz')}
        ${row('formant', 'Formantes', Math.round(avg('formant', 0)), -1200, 1200, 10, '', (v) => fmtC(v))}` : ''}
        ${row('gain', 'Ganho', +avg('gain', 0).toFixed(1), -60, 12, 0.5, '', (v) => (v <= -59 ? 'calada' : D.fmtDb(+v)))}
        ${row('move', 'Mover', Math.round(avg('move', 0) * 1000), -500, 500, 1, ' ms')}
        ${row('stretch', 'Duração', Math.round(avg('stretch', 1) * 100), 25, 300, 1, ' %')}
        ${nv.length ? `${row('glide', 'Glide (link)', Math.round(avg('glide', 90)), 20, 400, 5, ' ms')}<label class="check small" style="margin-top:6px"><input type="checkbox" id="tnLinkC" ${ns.every((n) => T().editOf(s, n.id).link) ? 'checked' : ''}>Ligar à nota anterior (glide)</label>` : ''}
        <div class="row" style="gap:6px;margin-top:14px"><button class="btn sm" data-restsel>Repor seleção</button><button class="btn sm ghost" data-mutesel>${ns.every((n) => (T().editOf(s, n.id).gain || 0) <= -59) ? 'Reativar' : 'Calar'}</button></div>`;
      let committed = false;
      const apply = (k, val) => {
        if (!committed) { MM.commit(st, 'Editor de voz · ' + k); committed = true; }
        ns.forEach((n) => {
          const e2 = T().edit(s, n.id); e2.manual = true;
          if (k === 'centre' || k === 'drift') { if (n.kind === 'v') e2[k] = val / 100; }
          else if (k === 'vib') { if (n.kind === 'v') e2.vib = val / 100; }
          else if (k === 'avd') { if (n.kind === 'v') e2.avib = Object.assign({ r: 5.5 }, e2.avib, { d: val }); }
          else if (k === 'avr') { if (n.kind === 'v') e2.avib = Object.assign({ d: 0 }, e2.avib, { r: val }); }
          else if (k === 'formant') { if (n.kind === 'v') e2.formant = val; }
          else if (k === 'gain') e2.gain = val <= -59 ? -60 : val;
          else if (k === 'move') e2.move = val / 1000;
          else if (k === 'stretch') e2.stretch = val / 100;
          else if (k === 'glide') { if (n.kind === 'v') e2.glide = val; }
        });
      };
      el.querySelectorAll('[data-ed]').forEach((inp) => {
        inp.oninput = () => { const k = inp.dataset.ed, v = +inp.value, o = el.querySelector(`[data-out="${k}"]`); if (o) o.textContent = k === 'formant' ? fmtC(v) : k === 'gain' ? (v <= -59 ? 'calada' : D.fmtDb(v)) : v + ({ centre: ' %', drift: ' %', vib: ' %', avd: ' c', avr: ' Hz', move: ' ms', stretch: ' %', glide: ' ms' }[k] || ''); apply(k, v); V.tune.draw(app); };
        inp.onchange = () => { committed = false; V.tune.commit(app, s, false); };
      });
      UI.bindRanges(el);
      el.querySelectorAll('[data-nud]').forEach((b) => (b.onclick = () => { MM.commit(st, 'Pitch'); nv.forEach((n) => { const e2 = T().edit(s, n.id); e2.manual = true; e2.shift = (e2.shift || 0) + +b.dataset.nud; }); V.tune.commit(app, s); }));
      const sn = el.querySelector('[data-snapnow]'); if (sn) sn.onclick = () => { MM.commit(st, 'Centrar notas'); nv.forEach((n) => { const e2 = T().edit(s, n.id); e2.manual = true; e2.centre = 1; }); V.tune.commit(app, s); };
      const lc = el.querySelector('#tnLinkC'); if (lc) lc.onchange = () => { MM.commit(st, 'Link'); nv.forEach((n) => { const e2 = T().edit(s, n.id); e2.link = lc.checked; if (!e2.glide) e2.glide = 90; }); V.tune.commit(app, s); };
      el.querySelector('[data-restsel]').onclick = () => { MM.commit(st, 'Repor seleção'); const t = T().state(s); ns.forEach((n) => delete t.edits[n.id]); V.tune.commit(app, s); };
      el.querySelector('[data-mutesel]').onclick = () => { MM.commit(st, 'Calar notas'); const all = ns.every((n) => (T().editOf(s, n.id).gain || 0) <= -59); ns.forEach((n) => { T().edit(s, n.id).gain = all ? 0 : -60; }); V.tune.commit(app, s); };
    },
    bindDial(app, s, d) {
      const id = d.dataset.dial, min = +d.dataset.min, max = +d.dataset.max, st = app.state;
      let v = +d.dataset.v, y0 = 0, v0 = 0, moved = false;
      const show = () => { d.innerHTML = V.tune.dialSVG((v - min) / (max - min)) + `<span>${id === 'sib' ? v.toFixed(1) : Math.round(v)}<small>${id === 'sib' ? 'dB' : '%'}</small></span>`; };
      const set = () => { const t = T().state(s); if (id === 'anti') t.anti = v / 100; else t.sib = v; };
      d.addEventListener('pointerdown', (e) => { y0 = e.clientY; v0 = v; moved = false; d.setPointerCapture(e.pointerId); });
      d.addEventListener('pointermove', (e) => { if (!d.hasPointerCapture(e.pointerId)) return; const nv = D.clamp(v0 + ((y0 - e.clientY) / 150) * (max - min), min, max); if (nv !== v) { if (!moved) { MM.commit(st, id === 'anti' ? 'Anti-artefactos' : 'Sibilantes'); moved = true; } v = id === 'sib' ? Math.round(nv * 2) / 2 : Math.round(nv); set(); show(); } });
      d.addEventListener('pointerup', () => { if (moved) V.tune.commit(app, s); });
      d.addEventListener('dblclick', () => { MM.commit(st, 'Repor'); v = id === 'anti' ? 40 : 0; set(); show(); V.tune.commit(app, s); });
    },

    // ---------- janelas ----------
    keyModal(app, s) {
      const st = app.state, t = T().state(s), cur = T().keyOf(st, s), A = s.features.pitch, mk = T().parseKey(st.music && st.music.key);
      UI.modal(`<div class="modal"><h2>Tonalidade e escala</h2><p class="muted" style="margin:8px 0 14px">As correções e o encaixe ao arrastar respeitam a escala. Da música: <b>${UI.esc(st.music && st.music.key || '—')}</b> · detetada na voz: <b>${UI.esc(T().keyLabel(A && A.key))}</b>${A && A.key ? ` (${Math.round(A.key.conf * 100)} %)` : ''}.</p>
        <div class="row" style="gap:10px"><select class="field" id="kT">${T().NOTE_NAMES.map((n, i) => `<option value="${i}" ${cur && cur.tonic === i ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <select class="field" id="kS">${Object.entries(T().SCALES).map(([k, [l]]) => `<option value="${k}" ${cur && cur.scale === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="row" style="gap:8px;margin-top:10px">${mk ? '<button class="btn sm" data-k="music">Usar a da música</button>' : ''}${A && A.key ? '<button class="btn sm" data-k="voice">Usar a detetada na voz</button>' : ''}</div>
        <label class="small muted" style="display:block;margin-top:16px">Ao arrastar o pitch, encaixar em</label>
        <div class="seg acc" style="margin-top:6px" id="kSnap"><button data-v="scale" class="${app.tn.snap === 'scale' ? 'on' : ''}">Notas da escala</button><button data-v="semi" class="${app.tn.snap === 'semi' ? 'on' : ''}">Meio-tom</button></div>
        <div class="row" style="justify-content:flex-end;margin-top:18px"><button class="btn ghost" data-x>Cancelar</button><button class="btn primary" data-ok>Aplicar</button></div></div>`, (m, close) => {
        m.querySelector('[data-x]').onclick = close;
        m.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => { const k = b.dataset.k === 'music' ? mk : A.key; m.querySelector('#kT').value = k.tonic; m.querySelector('#kS').value = k.scale; }));
        m.querySelectorAll('#kSnap button').forEach((b) => (b.onclick = () => { app.tn.snap = b.dataset.v; m.querySelectorAll('#kSnap button').forEach((x) => x.classList.toggle('on', x === b)); }));
        m.querySelector('[data-ok]').onclick = () => { MM.commit(st, 'Tonalidade da voz'); t.key = { tonic: +m.querySelector('#kT').value, scale: m.querySelector('#kS').value }; close(); app.refresh(); V.tune.commit(app, s, false); };
      });
    },
    aiModal(app, s) {
      const st = app.state, key = T().keyOf(st, s);
      UI.modal(`<div class="modal"><h2>Sugestão da IA</h2><p class="muted" style="margin:8px 0 14px">Centra as notas que estão a mais de 12 cents da escala (${UI.esc(T().keyLabel(key))}), endireita um pouco o drift e não mexe no vibrato, nas notas curtas (ornamentos) nem nas que já editaste à mão. Podes desfazer.</p>
        <div class="row" style="justify-content:space-between"><span class="small">Intensidade</span><span class="mono small" id="aiV">70 %</span></div><input type="range" id="aiK" min="20" max="100" value="70">
        <div class="row" style="justify-content:flex-end;margin-top:18px"><button class="btn ghost" data-x>Cancelar</button><button class="btn primary" data-ok>Aplicar</button></div></div>`, (m, close) => {
        UI.bindRanges(m);
        const k = m.querySelector('#aiK'); k.oninput = () => (m.querySelector('#aiV').textContent = k.value + ' %');
        m.querySelector('[data-x]').onclick = close;
        m.querySelector('[data-ok]').onclick = () => {
          MM.commit(st, 'Sugestão da IA (afinação)');
          const r = T().suggest(st, s, +k.value / 100);
          close();
          (st.explain = st.explain || []).push({ stem: s.id, stemName: s.label, module: 'Afinação', text: `Afinação sugerida: ${r.n} notas centradas a ${k.value} % na escala de ${T().keyLabel(r.key)} (desvio médio corrigido ${Math.round(r.avg)} cents), vibrato e ornamentos intactos.`, conf: 0.8 });
          UI.toast(r.n ? `${r.n} notas centradas (desvio médio ${Math.round(r.avg)} c).` : 'Nenhuma nota precisava de correção.', 'ok');
          V.tune.commit(app, s);
        };
      });
    },
    harmModal(app, s) {
      const st = app.state, Z = app.tn, key = T().keyOf(st, s);
      UI.modal(`<div class="modal"><h2>Harmonia</h2><p class="muted" style="margin:8px 0 14px">Cria um stem novo com a voz deslocada por graus da escala (${UI.esc(T().keyLabel(key))}), a partir da voz já editada. Os formantes ficam preservados. O stem entra no mixer como backing vocal.</p>
        <div class="row" style="gap:10px"><select class="field" id="hI">${T().INTERVALS.map(([l, v], i) => `<option value="${v}" ${i === 0 ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select class="field" id="hW"><option value="all">Todas as notas</option>${Z.sel.size ? `<option value="sel" selected>Só as ${Z.sel.size} selecionadas</option>` : ''}</select></div>
        <div class="row" style="justify-content:flex-end;margin-top:18px"><button class="btn ghost" data-x>Cancelar</button><button class="btn primary" data-ok>Criar stem</button></div></div>`, (m, close) => {
        m.querySelector('[data-x]').onclick = close;
        m.querySelector('[data-ok]').onclick = async () => {
          const steps = +m.querySelector('#hI').value, only = m.querySelector('#hW').value === 'sel' ? [...Z.sel] : null, lab = T().INTERVALS.find((x) => x[1] === steps)[0];
          close(); V.tune.status(app, 'A criar a harmonia…'); await D.yieldUI();
          try {
            const chs = T().harmony(st, s, steps, only);
            const ns = MM.makeStem(`${s.label} · harmonia ${lab}.wav`, chs, s.features.pitch.sr, null, null);
            ns.features = await MM.analyzeStem(ns.chs, s.features.pitch.sr, 'fast');
            MM.commit(st, 'Harmonia ' + lab);
            st.stems.push(ns);
            MM.setRole(st, ns, 'Backing Vocal'); ns.conf = 1;
            ns.p = JSON.parse(JSON.stringify(s.p)); delete ns.p.tune; ns.p.fader = (s.p.fader || 0) - 6; ns.p.pan = steps > 0 ? -0.35 : 0.35; ns.manual = { fader: true, pan: true };
            if (MM.assignLabels) MM.assignLabels(st);
            ns.label = `${s.label} · harm. ${lab}`; ns.short = `Harm. ${lab.split(' ')[0]}`;
            app.engine.rebuild(st); st.dirty.mix = true; app.saveSoon();
            V.tune.status(app); app.renderTop();
            UI.toast(`Stem “${UI.esc(ns.label)}” criado (−6 dB, pan ${steps > 0 ? 'esquerda' : 'direita'}). Corre o AI Mix & Master para o integrar na mistura.`, 'ok', 6000);
          } catch (e) { console.error(e); UI.toast('Não foi possível criar a harmonia: ' + e.message, 'err'); V.tune.status(app); }
        };
      });
    },
  };
  function rr(ctx, x, y, w, h, r) { r = Math.max(0, Math.min(r, w / 2, h / 2)); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
})();
