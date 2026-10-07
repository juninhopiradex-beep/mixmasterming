/* MIXMIND — vista Análise (v1.3)
 * Campo estéreo com profundidade percebida · mapa de frequências Antes / Depois / Mudança tonal por secção ·
 * masking no tempo com correção editável e A/B · tonalidade vs estilo/referência · fase entre stems ·
 * compatibilidade mono · score com histórico de versões. */
(function () {
  const MM = window.MM, D = MM.dsp, UI = MM.ui;
  const V = (MM.views = MM.views || {});
  const I = () => MM.insight;
  const fmtPct = (v) => Math.round(v * 100) + ' %';

  // ================= profundidade percebida =================
  const HOFF = { P: 0, S: 0.04, B: 0.08 };
  function depthTerms(app, s) {
    const st = app.state, stems = st.stems.filter((x) => !x.removed && x.features && x.role !== 'Reference Track');
    const lvl = (x) => x.features.lufs + x.p.trim + x.p.fader;
    const top = Math.max(...stems.map(lvl));
    const levelT = D.clamp((top - lvl(s)) / 18, 0, 1);
    // brilho: o que o processamento fez acima de 4 kHz (medido, se houver; senão pelos parâmetros de EQ)
    let hf = 0;
    const post = st.post && st.post.bands[s.id];
    if (post) {
      const ks = D.THIRD_OCT.map((f, k) => (f >= 4000 && f <= 12500 ? k : -1)).filter((k) => k >= 0);
      const nb = s.features.bandFrames;
      let a = 0, b = 0; for (let t = 0; t < nb; t++) for (const k of ks) { a += post[t * 31 + k]; b += s.features.bandTL[t * 31 + k]; }
      hf = 10 * Math.log10((a + 1e-14) / (b + 1e-14)) - (s.p.trim + s.p.fader);
    } else {
      (s.p.eq || []).forEach((e) => { if (e && e.on && e.freq >= 3500) hf += e.gain * (e.type === 'highshelf' ? 1 : 0.5); });
      if (s.p.lpf.on && s.p.lpf.freq < 12000) hf -= D.clamp((12000 - s.p.lpf.freq) / 1500, 0, 8);
    }
    const darkT = D.clamp(-hf / 6, -0.5, 1);
    const wet = s.p.sendRev <= -59 ? 0 : D.clamp((s.p.sendRev + 26) / 26, 0, 1);
    const fxc = st.fx[s.p.revType || 'plate'] || {};
    const preT = D.clamp((fxc.predelay || 0) / 60, 0, 1);
    const compT = (s.p.comp.on && s.p.comp.ratio > 1.5 ? 0.05 : 0) + (s.p.comp2.on && s.p.comp2.ratio > 1.5 ? 0.03 : 0);
    const other = 0.08 + 0.25 * levelT + 0.12 * darkT - compT + (HOFF[s.hier] || 0);
    return { levelT, darkT, wet, preT, compT, other, hf };
  }
  const depthOf = (app, s) => { const t = depthTerms(app, s); return D.clamp(t.other + 0.55 * t.wet * (1 - 0.35 * t.preT), 0, 1); };
  const sendFromDepth = (app, s, d) => {
    const t = depthTerms(app, s);
    const w = (d - t.other) / (0.55 * (1 - 0.35 * t.preT));
    return { send: w <= 0.02 ? -60 : +(-26 + D.clamp(w, 0, 1) * 26).toFixed(1), clamped: w < -0.02 ? 'front' : w > 1.02 ? 'back' : null };
  };
  const zone = (d) => (d < 0.34 ? 'Frente' : d < 0.67 ? 'Meio' : 'Fundo');

  // ================= vista =================
  V.analysis = {
    render(app) {
      const st = app.state, sc = st.score;
      const A = (app.ana = app.ana || { mode: null, sec: -1, conf: null, tone: 'master' });
      if (!A.mode) A.mode = st.post || st.stage === 'ready' ? 'post' : 'pre';
      if (A.mode !== 'pre' && st.stage !== 'ready' && !st.post) A.mode = 'pre';
      const stems = st.stems.filter((s) => !s.removed);
      const secs = st.music.sections || [];

      return `${UI.stemBar(stems)}<div class="ana">
        <div class="panel p"><div class="panel-title"><div class="eyebrow">Stereo field</div><span class="small muted">Arrasta: ← → pan · ↑ ↓ profundidade</span></div>
          <div class="cvbox"><canvas id="sf" class="cv" style="height:440px"></canvas><div class="tooltip" id="sfTip" style="display:none"></div></div>
          <p class="small muted" style="margin:10px 0 0">Profundidade percebida = reverb (o pre-delay segura o som à frente) + nível face ao elemento mais forte + brilho (agudos cortados afastam) + compressão (aproxima). Arrastar muda o envio de reverb. <span style="color:var(--warn)">mono −x dB</span> = o que um stem largo perde em mono.</p>
        </div>
        <div class="panel p"><div class="panel-title" style="flex-wrap:wrap">
            <div class="eyebrow">Mapa de frequências · 20 Hz – 20 kHz</div>
            <div class="row" style="gap:8px;flex-wrap:wrap">
              <div class="seg acc" id="fmMode"><button data-m="pre" class="${A.mode === 'pre' ? 'on' : ''}" title="Os stems como chegaram (sem processamento nem fader)">Antes</button><button data-m="post" class="${A.mode === 'post' ? 'on' : ''}" title="Medido depois de EQ, dinâmica, saturação, fader e automação">Depois</button><button data-m="diff" class="${A.mode === 'diff' ? 'on' : ''}" title="O que o processamento mudou em cada banda (sem o ganho do fader)">Mudança tonal</button></div>
              <select class="field" id="fmSec" style="width:auto;height:34px"><option value="-1">Música toda</option>${secs.map((s, i) => `<option value="${i}" ${A.sec === i ? 'selected' : ''}>${UI.esc(MM.sections.label(st, i))}</option>`).join('')}</select>
            </div></div>
          <div id="postStatus" class="post-status"></div>
          <div class="cvbox"><canvas id="fm" class="cv" style="height:420px"></canvas><div class="tooltip" id="fmTip" style="display:none"></div></div>
          <div class="fm-legend small muted" id="fmLegend"></div>
          <div id="fmInfo" class="conf-info"></div>
        </div>
      </div>
      <div class="ana2">
        <div class="panel p" id="tonePanel"></div>
        <div class="panel p" id="phasePanel"><div class="panel-title"><div class="eyebrow">Fase entre stems</div></div><div class="small muted">A analisar a fase…</div></div>
      </div>
      <div class="panel p" style="margin-top:18px" id="scorePanel">${V.analysis.scoreHTML(st)}</div>`;
    },
    scoreHTML(st) {
      const sc = st.score;
      if (!sc) return `<div class="empty-note">O score aparece depois do AI Mix &amp; Master. <button class="btn primary sm" data-act="ai" style="margin-left:10px">${UI.icon('spark')}Correr agora</button></div>`;
      const bars = [['Balance', 'balance'], ['Dynamics', 'dynamics'], ['Low-End Control', 'lowEnd'], ['Loudness', 'loudness'], ['Tonal Balance', 'tone'], ['Clarity', 'clarity'], ['Stereo Image', 'stereo'], ['Vocal Presence', 'vocal'], ['Phase Integrity', 'phase']].filter(([, k]) => typeof sc[k] === 'number');
      const an = sc.anchored || {};
      const chips = [an.style ? `<span class="anc on">estilo ${UI.esc(an.style)}</span>` : `<span class="anc">sem estilo treinado</span>`, an.ref ? `<span class="anc on">ref. ${UI.esc(an.ref)}</span>` : `<span class="anc">sem referência</span>`, an.measured ? `<span class="anc on">masking medido</span>` : `<span class="anc">masking previsto</span>`].join('');
      const half = Math.ceil(bars.length / 2);
      return `<div class="score-grid">
          <div><div class="eyebrow">Mix quality score</div><div class="scorebig" style="font-size:84px;margin-top:10px">${sc.overall}</div><div class="muted">de 100 · ${UI.esc(st.currentVersionName || 'Mix')}${st.scoreOrig ? ` · original ${st.scoreOrig}` : ''}</div>
            <div class="small muted" style="margin-top:10px">Ancorado em referências externas, não nas decisões da IA:</div><div class="ancs">${chips}</div></div>
          <div>${bars.slice(0, half).map(([l, k]) => V.analysis.sbar(st, l, k)).join('')}</div>
          <div>${bars.slice(half).map(([l, k]) => V.analysis.sbar(st, l, k)).join('')}</div>
          <div><div class="eyebrow">Recomendações</div>${sc.recs.map((r, i) => `<div class="rec"><span>${UI.esc(r.text)}</span><button class="btn sm acc" data-rec="${i}">${r.label}</button></div>`).join('')}</div>
        </div>
        <div class="hist" id="scoreHist"></div>`;
    },
    renderScore(app) {
      const root = V.analysis.root; if (!root) return;
      const el = root.querySelector('#scorePanel'); if (!el) return;
      el.innerHTML = V.analysis.scoreHTML(app.state);
      V.analysis.renderHist(app);
      el.querySelectorAll('[data-rec]').forEach((b) => (b.onclick = () => V.analysis.applyRec(app, app.state.score.recs[+b.dataset.rec])));
      el.querySelectorAll('[data-act=ai]').forEach((b) => (b.onclick = () => app.runAI()));
    },
    /** Barra de critério com a variação face à versão anterior. */
    sbar(st, label, k) {
      const v = st.score[k];
      const prev = V.analysis.prevScores(st);
      const d = prev && typeof prev[k] === 'number' ? v - prev[k] : 0;
      const a = st.score.anchor && st.score.anchor[k], dt = st.score.detail && st.score.detail[k];
      return `<div class="sbar" title="${UI.esc([a ? 'Âncora: ' + a : '', dt || ''].filter(Boolean).join('\n'))}"><span>${label}</span><div class="bar"><i class="${v < 88 ? 'mid' : ''}" style="width:${v}%"></i></div><span>${v}${d ? `<em class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${d}</em>` : ''}</span>${a ? `<small class="sanc">${UI.esc(a)}${dt ? ' · ' + UI.esc(dt) : ''}</small>` : ''}</div>`;
    },
    prevScores(st) {
      const vs = st.versions.filter((v) => v.scores);
      const i = vs.findIndex((v) => v.id === st.currentVersion);
      const p = i > 0 ? vs[i - 1] : i < 0 && vs.length ? vs[vs.length - 1] : null;
      return p ? p.scores : null;
    },

    mount(app, root) {
      const st = app.state, A = app.ana;
      V.analysis.root = root;
      V.analysis.drawSF(app);
      V.analysis.drawFM(app);
      V.analysis.renderStatus(app);
      V.analysis.renderInfo(app);
      V.analysis.renderTone(app);
      V.analysis.renderHist(app);
      setTimeout(() => V.analysis.renderPhase(app), 30);
      // medir automaticamente o "Depois" se a medição estiver em falta ou desatualizada
      if (st.stage === 'ready' && !I().postFresh(st) && !V.analysis.measuring && !app.engine.playing) setTimeout(() => V.analysis.measure(app), 60);

      root.querySelectorAll('#fmMode [data-m]').forEach((b) => (b.onclick = () => {
        A.mode = b.dataset.m;
        root.querySelectorAll('#fmMode [data-m]').forEach((x) => x.classList.toggle('on', x === b));
        if (A.mode !== 'pre' && !I().postFresh(st) && st.stage === 'ready' && !V.analysis.measuring) V.analysis.measure(app);
        V.analysis.drawFM(app); V.analysis.renderStatus(app); V.analysis.renderInfo(app);
      }));
      root.querySelector('#fmSec').onchange = (e) => { A.sec = +e.target.value; V.analysis.drawFM(app); V.analysis.renderInfo(app); };

      // arrastar no stereo field
      const cv = root.querySelector('#sf'), tip = root.querySelector('#sfTip');
      let drag = null;
      const pick = (e) => {
        const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        return (V.analysis._sfPts || []).find((p) => Math.hypot(p.x - x, p.y - y) < p.r + 6);
      };
      cv.addEventListener('pointerdown', (e) => {
        const p = pick(e); if (!p) return;
        drag = p; cv.setPointerCapture(e.pointerId); MM.commit(st, 'Stereo field ' + p.s.label); app.selected = p.s.id;
      });
      cv.addEventListener('pointermove', (e) => {
        const r = cv.getBoundingClientRect();
        if (!drag) {
          const p = pick(e); cv.style.cursor = p ? 'grab' : 'default';
          if (p) { const t = depthTerms(app, p.s), ml = I().monoLoss(p.s); tip.style.display = 'block'; tip.style.left = e.clientX - r.left + 14 + 'px'; tip.style.top = e.clientY - r.top - 30 + 'px'; tip.textContent = `${p.s.label} · ${MM.panLabel(p.s.p.pan)} · ${zone(depthOf(app, p.s))} · reverb ${p.s.p.sendRev <= -59 ? 'off' : UI.fmtDb(p.s.p.sendRev) + ' dB'}${t.hf < -1 ? ' · agudos ' + UI.fmtDb(t.hf) + ' dB' : ''}${p.s.chs.length > 1 ? ' · mono ' + UI.fmtDb(ml) + ' dB' : ''}`; }
          else tip.style.display = 'none';
          return;
        }
        const L = V.analysis._sfGeom;
        const pan = D.clamp(((e.clientX - r.left - L.x0) / L.w) * 2 - 1, -1, 1);
        const depth = D.clamp(1 - (e.clientY - r.top - L.y0) / L.h, 0, 1);
        const s = drag.s, sd = sendFromDepth(app, s, depth);
        s.p.pan = Math.round(pan * 100) / 100;
        s.p.sendRev = sd.send;
        s.manual.pan = true; s.manual.sendRev = true;
        app.engine.graph && app.engine.graph.applyStem(s);
        tip.style.display = 'block'; tip.style.left = e.clientX - r.left + 14 + 'px'; tip.style.top = e.clientY - r.top - 30 + 'px';
        tip.textContent = `${s.label} → ${MM.panLabel(s.p.pan)} · ${zone(depthOf(app, s))}${sd.clamped === 'front' ? ' · limite: para mais perto sobe o fader ou o brilho' : sd.clamped === 'back' ? ' · limite: para mais longe baixa o fader ou escurece' : ''}`;
        V.analysis.drawSF(app);
      });
      cv.addEventListener('pointerleave', () => { if (!drag) tip.style.display = 'none'; });
      cv.addEventListener('pointerup', () => { if (drag) { drag = null; tip.style.display = 'none'; st.dirty.mix = true; app.renderTop(); app.saveSoon(); } });

      // mapa de frequências: clique num conflito
      const fm = root.querySelector('#fm');
      fm.addEventListener('click', (e) => {
        const r = fm.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        const box = (V.analysis._fmBoxes || []).find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
        A.conf = box ? box.idx : null;
        if (box) app.selected = box.c.b;
        V.analysis.drawFM(app); V.analysis.renderInfo(app);
      });
      fm.addEventListener('mousemove', (e) => {
        const r = fm.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, tp = root.querySelector('#fmTip');
        const cell = (V.analysis._fmCells || []).find((c) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);
        const box = (V.analysis._fmBoxes || []).find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
        fm.style.cursor = box ? 'pointer' : 'default';
        if (!cell) { tp.style.display = 'none'; return; }
        tp.style.display = 'block'; tp.style.left = Math.min(x + 14, r.width - 220) + 'px'; tp.style.top = y - 34 + 'px';
        tp.textContent = cell.txt;
      });
      fm.addEventListener('mouseleave', () => { root.querySelector('#fmTip').style.display = 'none'; });
      root.querySelectorAll('[data-rec]').forEach((b) => (b.onclick = () => V.analysis.applyRec(app, st.score.recs[+b.dataset.rec])));
    },
    unmount(app) { V.analysis.setBypass(app, null); V.analysis.root = null; },

    // ---------- medição "Depois" ----------
    async measure(app) {
      const st = app.state;
      if (V.analysis.measuring || st.stage !== 'ready') return;
      V.analysis.measuring = { p: 0 };
      V.analysis.renderStatus(app);
      try {
        await I().measurePost(st, (p) => { V.analysis.measuring.p = p; V.analysis.renderStatus(app); });
        st._maskCache = null;
        // o score passa a usar o masking e o balanço MEDIDOS depois do processamento
        const before = st.score ? st.score.overall : null;
        if (MM.rescore(st) && app.curView === V.analysis && V.analysis.root) { V.analysis.renderScore(app); if (before !== null && before !== st.score.overall) UI.toast(`Score atualizado com a medição real: ${before} → ${st.score.overall}`, 'ok'); }
      } catch (e) { console.error(e); UI.toast('Não foi possível medir os stems processados: ' + UI.esc(e.message), 'err'); }
      V.analysis.measuring = null;
      if (app.curView === V.analysis && V.analysis.root) { V.analysis.drawFM(app); V.analysis.renderStatus(app); V.analysis.renderInfo(app); V.analysis.drawSF(app); }
    },
    renderStatus(app) {
      const root = V.analysis.root; if (!root) return;
      const el = root.querySelector('#postStatus'); if (!el) return;
      const st = app.state, A = app.ana, m = V.analysis.measuring;
      let h = '';
      if (A.mode === 'pre') h = `<span class="dim">Stems como chegaram: sem processamento, sem fader.</span>`;
      else if (m) h = `<span>A medir os stems processados… ${Math.round(m.p * 100)} %</span><div class="bar" style="flex:1;max-width:240px;height:5px"><i style="width:${Math.round(m.p * 100)}%"></i></div>`;
      else if (!st.post) h = st.stage === 'ready' ? `<span class="dim">Ainda não medido.</span><button class="btn sm acc" data-pm="1">Medir agora</button>` : `<span class="dim">Corre o AI Mix &amp; Master para medir o resultado.</span>`;
      else if (!I().postFresh(st)) h = `<span style="color:var(--warn)">Desatualizado: mudaste a mistura depois da última medição.</span><button class="btn sm acc" data-pm="1">Medir de novo</button>`;
      else h = `<span class="acc-t">● Medido depois do processamento</span><span class="dim">· ${new Date(st.post.at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })} · EQ, dinâmica, saturação, fader, automação e mutes incluídos</span>`;
      el.innerHTML = h;
      const b = el.querySelector('[data-pm]'); if (b) b.onclick = () => V.analysis.measure(app);
      const lg = root.querySelector('#fmLegend');
      if (lg) lg.innerHTML = A.mode === 'diff'
        ? `<span><i class="lgd" style="background:#38bdf8"></i>reforçado</span><span><i class="lgd" style="background:#fb7185"></i>cortado</span><span>valores em dB face ao original, sem o ganho do fader · linha <b>Soma</b> = premaster (inclui bus e reverbs)</span>`
        : `<span><i class="lgd dash"></i>masking${A.mode === 'post' ? ' (cor: <b style="color:#4ade80">resolvido</b> · <b style="color:#fbbf24">com correção</b> · <b style="color:#fb7185">sem correção</b>; % = tempo em sobreposição antes → depois)' : ' detetado'} · clica para ver no tempo e editar a correção</span><span><i class="lgd" style="background:#fbbf24"></i>Soma: acumulação</span>`;
    },

    // ---------- desenho do mapa ----------
    rowsData(app) {
      const st = app.state, A = app.ana, mode = A.mode;
      const stems = st.stems.filter((s) => !s.removed && s.features && s.role !== 'Reference Track');
      const post = mode !== 'pre' && st.post;
      const rows = stems.map((s) => {
        const nb = s.features.bandFrames, [b0, b1] = I().blockRange(st, A.sec, nb);
        const raw = I().meanBands(I().levels(st, s, 'raw'), nb, b0, b1);
        const pst = post && st.post.bands[s.id] ? I().meanBands(I().levels(st, s, 'post'), nb, b0, b1) : null;
        let diff = null;
        if (mode === 'diff' && pst) {
          const mx = Math.max(...raw);
          const d = pst.map((v, k) => v - raw[k]);
          const w = raw.map((v) => (v > mx - 30 ? 1 : 0));
          const off = D.median(d.filter((_, k) => w[k])) || 0;
          diff = d.map((v, k) => (raw[k] > mx - 45 ? v - off : null));
        }
        const muted = s.mute || (A.sec >= 0 && MM.sections.isMuted(st, A.sec, s.id));
        return { s, raw, post: pst, diff, muted };
      });
      // soma
      let sum;
      if (mode !== 'pre' && st.post && st.post.sum) {
        const nb = st.post.sumNb, [b0, b1] = I().blockRange(st, A.sec, nb);
        const L = new Float32Array(nb * 31); for (let i = 0; i < L.length; i++) L[i] = 10 * Math.log10(st.post.sum[i] + 1e-14);
        sum = I().meanBands(L, nb, b0, b1);
      }
      const rawSum = new Float64Array(31);
      rows.forEach((r) => r.raw.forEach((v, k) => (rawSum[k] += Math.pow(10, v / 10))));
      const rawSumDb = Array.from(rawSum, (v) => 10 * Math.log10(v + 1e-14));
      if (!sum) { const ps = new Float64Array(31); let any = false; rows.forEach((r) => { if (r.post && !r.muted) { any = true; r.post.forEach((v, k) => (ps[k] += Math.pow(10, v / 10))); } }); if (any && mode !== 'pre') sum = Array.from(ps, (v) => 10 * Math.log10(v + 1e-14)); }
      let sumDiff = null;
      if (mode === 'diff' && sum) {
        const norm = (a) => { const m = D.mean(a.filter((_, k) => D.THIRD_OCT[k] >= 100 && D.THIRD_OCT[k] <= 4000)); return a.map((v) => v - m); };
        const a = norm(sum), b = norm(rawSumDb);
        sumDiff = a.map((v, k) => v - b[k]);
      }
      return { rows, sum: mode === 'pre' ? rawSumDb : sum || rawSumDb, sumDiff };
    },
    /** Estado de cada conflito antes/depois (cache por medição). */
    maskInfo(app, c) {
      const st = app.state;
      const key = `${c.a}:${c.b}:${c.band}:${st.post ? st.post.at : 0}:${c.overlap}`;
      st._maskCache = st._maskCache || {};
      if (!st._maskCache[key]) st._maskCache[key] = { pre: I().maskDetail(st, c, 'pre'), post: st.post ? I().maskDetail(st, c, 'post') : null };
      return st._maskCache[key];
    },
    drawFM(app) {
      const root = V.analysis.root; if (!root) return;
      const cv = root.querySelector('#fm'); if (!cv) return;
      const { ctx, w, h } = UI.fitCanvas(cv);
      const st = app.state, A = app.ana, mode = A.mode;
      const { rows, sum, sumDiff } = V.analysis.rowsData(app);
      const x0 = 120, gw = w - x0 - 10, top = 22, nrows = rows.length + 1, rh = Math.min(30, (h - top - 8) / nrows);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#7c8597'; ctx.font = '11px Geist Mono, monospace';
      [[20, '20'], [50, '50'], [100, '100'], [200, '200'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k'], [20000, '20k']].forEach(([f, t]) => { const x = x0 + (Math.log10(f / 20) / 3) * gw; ctx.fillText(t, Math.min(x - 6, w - 24), 12); ctx.fillStyle = 'rgba(255,255,255,.04)'; ctx.fillRect(x, top, 1, nrows * rh); ctx.fillStyle = '#7c8597'; });
      const bandX = (k) => x0 + (Math.log10(D.thirdOctEdges[k][0] / 20) / 3) * gw;
      const bandW = (k) => x0 + (Math.log10(Math.min(20000, D.thirdOctEdges[k][1]) / 20) / 3) * gw - bandX(k);
      const cells = [];
      const lv = (r) => (mode === 'pre' ? r.raw : r.post || r.raw);
      const gmax = Math.max(...rows.map((r) => Math.max(...lv(r))));
      rows.forEach((r, i) => {
        const y = top + i * rh, col = UI.colorOf(r.s);
        ctx.fillStyle = r.muted ? '#5d6574' : '#c9d1dc'; ctx.font = '12.5px Geist, Inter, sans-serif'; ctx.textAlign = 'right';
        ctx.fillText((r.s.short || r.s.label) + (r.muted ? ' (M)' : ''), x0 - 10, y + rh / 2 + 4); ctx.textAlign = 'left';
        for (let k = 0; k < 31; k++) {
          const bx = bandX(k) + 0.5, bw = Math.max(1, bandW(k) - 1);
          if (mode === 'diff') {
            const d = r.diff ? r.diff[k] : null;
            if (d === null) { ctx.fillStyle = 'rgba(255,255,255,.03)'; ctx.fillRect(bx, y + 2, bw, rh - 4); continue; }
            const a = D.clamp(Math.abs(d) / 6, 0, 1);
            ctx.fillStyle = d > 0 ? '#38bdf8' : '#fb7185'; ctx.globalAlpha = Math.abs(d) < 0.4 ? 0.04 : 0.1 + a * 0.8;
            ctx.fillRect(bx, y + 2, bw, rh - 4); ctx.globalAlpha = 1;
            if (Math.abs(d) >= 1 && bw > 17 && rh > 15) { ctx.fillStyle = '#e9edf4'; ctx.font = '9.5px Geist Mono, monospace'; ctx.textAlign = 'center'; ctx.fillText((d > 0 ? '+' : '') + d.toFixed(0), bx + bw / 2, y + rh / 2 + 3.5); ctx.textAlign = 'left'; }
            cells.push({ x: bx, y: y + 2, w: bw, h: rh - 4, txt: `${r.s.label} · ${D.fmtHz(D.THIRD_OCT[k])} · ${d > 0 ? '+' : ''}${UI.fmtNum(d)} dB` });
          } else {
            const v = lv(r)[k], a = D.clamp((v - (gmax - 48)) / 48, 0, 1);
            ctx.fillStyle = col; ctx.globalAlpha = (0.06 + a * a * 0.9) * (r.muted ? 0.35 : 1);
            ctx.fillRect(bx, y + 2, bw, rh - 4); ctx.globalAlpha = 1;
            const extra = mode === 'post' && r.post ? ` · ${(r.post[k] - r.raw[k] >= 0 ? '+' : '')}${UI.fmtNum(r.post[k] - r.raw[k])} dB face ao original (com fader)` : '';
            cells.push({ x: bx, y: y + 2, w: bw, h: rh - 4, txt: `${r.s.label} · ${D.fmtHz(D.THIRD_OCT[k])} · ${UI.fmtNum(v - gmax)} dB${extra}` });
          }
        }
      });
      // soma
      const y = top + rows.length * rh;
      ctx.fillStyle = '#c9d1dc'; ctx.font = '12.5px Geist, Inter, sans-serif'; ctx.textAlign = 'right'; ctx.fillText(mode === 'pre' ? 'Soma' : 'Soma (premaster)', x0 - 10, y + rh / 2 + 4); ctx.textAlign = 'left';
      if (mode === 'diff' && sumDiff) {
        for (let k = 0; k < 31; k++) {
          const d = sumDiff[k], a = D.clamp(Math.abs(d) / 6, 0, 1), bx = bandX(k) + 0.5, bw = Math.max(1, bandW(k) - 1);
          ctx.fillStyle = d > 0 ? '#38bdf8' : '#fb7185'; ctx.globalAlpha = Math.abs(d) < 0.4 ? 0.04 : 0.1 + a * 0.8; ctx.fillRect(bx, y + 2, bw, rh - 4); ctx.globalAlpha = 1;
          cells.push({ x: bx, y: y + 2, w: bw, h: rh - 4, txt: `Soma · ${D.fmtHz(D.THIRD_OCT[k])} · tonalidade ${d > 0 ? '+' : ''}${UI.fmtNum(d)} dB` });
        }
      } else {
        const smax = Math.max(...sum);
        for (let k = 0; k < 31; k++) {
          const rel = sum[k] - smax, ex = k > 0 && k < 30 ? sum[k] - (sum[k - 1] + sum[k + 1]) / 2 : 0;
          ctx.fillStyle = ex > 4 ? '#fbbf24' : rel < -45 ? 'rgba(255,255,255,.03)' : '#5eead4';
          ctx.globalAlpha = ex > 4 ? 0.85 : 0.12 + D.clamp((rel + 45) / 45, 0, 1) * 0.6;
          const bx = bandX(k) + 0.5, bw = Math.max(1, bandW(k) - 1);
          ctx.fillRect(bx, y + 2, bw, rh - 4);
          cells.push({ x: bx, y: y + 2, w: bw, h: rh - 4, txt: `Soma · ${D.fmtHz(D.THIRD_OCT[k])} · ${UI.fmtNum(rel)} dB${ex > 4 ? ' · acumulação (+' + UI.fmtNum(ex) + ' dB face às vizinhas)' : ''}` });
        }
        ctx.globalAlpha = 1;
      }
      ctx.globalAlpha = 1;
      V.analysis._fmCells = cells;
      // conflitos de masking
      const boxes = [], placed = [];
      const nm = (id) => { const s = rows.find((r) => r.s.id === id); return s ? s.s.short || s.s.label : '?'; };
      if (mode !== 'diff') (st.conflicts || []).slice(0, 10).forEach((c, idx) => {
        const ia = rows.findIndex((r) => r.s.id === c.a), ib = rows.findIndex((r) => r.s.id === c.b);
        if (ia < 0 || ib < 0) return;
        const mi = V.analysis.maskInfo(app, c);
        const pick = (d) => (d ? (A.sec >= 0 ? (d.perSec[A.sec] || { frac: 0 }).frac : d.overlap) : null);
        const before = pick(mi.pre), after = mode === 'post' ? pick(mi.post) : null;
        if (A.sec >= 0 && (before || 0) < 0.05 && (after === null || after < 0.05)) return;
        const k0 = Math.max(0, c.band - 1), k1 = Math.min(30, c.band + 1);
        const bx = bandX(k0), bw = bandX(k1) + bandW(k1) - bx;
        const hasCorr = c.action && !/nenhuma|limite/.test(c.action);
        const color = after === null ? (hasCorr ? '#fbbf24' : '#fb7185') : after < 0.15 ? '#4ade80' : after < (before || 1) * 0.7 || hasCorr ? '#fbbf24' : '#fb7185';
        const sel = A.conf === idx;
        [ia, ib].forEach((ri) => {
          const by = top + ri * rh + 1;
          ctx.setLineDash(sel ? [] : [4, 3]); ctx.strokeStyle = color; ctx.lineWidth = sel ? 2.4 : 1.5;
          ctx.strokeRect(bx, by, bw, rh - 2); ctx.setLineDash([]);
          boxes.push({ x: bx, y: by, w: bw, h: rh, c, idx });
        });
        const txt = `${nm(c.a)} × ${nm(c.b)} · ${D.fmtHz(c.freq)} · ${fmtPct(before || 0)}${after !== null ? ' → ' + fmtPct(after) : ''}`;
        ctx.font = '11.5px Geist Mono, monospace';
        const tw = ctx.measureText(txt).width;
        const lx = Math.min(bx + bw + 6, w - tw - 8);
        for (const ri of [Math.min(ia, ib), Math.max(ia, ib), Math.min(ia, ib) + 1, Math.max(ia, ib) - 1]) {
          const ly = top + ri * rh + rh / 2 + 4;
          const r = { x: lx - 3, y: ly - 12, w: tw + 6, h: 16 };
          if (placed.some((q) => r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h)) continue;
          placed.push(r);
          ctx.fillStyle = 'rgba(10,12,16,.9)'; ctx.fillRect(r.x, r.y, r.w, r.h);
          ctx.fillStyle = color; ctx.fillText(txt, lx, ly);
          boxes.push({ x: r.x, y: r.y, w: r.w, h: r.h, c, idx });
          break;
        }
      });
      V.analysis._fmBoxes = boxes;
    },

    // ---------- detalhe de um conflito: no tempo, correção editável, ouvir, A/B ----------
    corrOf(st, c) {
      const B = st.stems.find((x) => x.id === c.b);
      if (!B) return null;
      if (c.kind === 'duck' && B.p.duck && B.p.duck.on && B.p.duck.src === c.a) return { kind: 'duck', B, d: B.p.duck, lane: 'duck:' + B.id };
      const k = (B.p.dyn || []).findIndex((d) => d.src === c.a);
      if (k >= 0) return { kind: 'dyn', B, d: B.p.dyn[k], k, lane: `dyn${k}:` + B.id };
      return { kind: 'none', B };
    },
    renderInfo(app) {
      const root = V.analysis.root; if (!root) return;
      const el = root.querySelector('#fmInfo'); if (!el) return;
      const st = app.state, A = app.ana, c = A.conf !== null ? (st.conflicts || [])[A.conf] : null;
      if (!c || A.mode === 'diff') { el.innerHTML = (st.conflicts || []).length ? `<span class="small muted">${A.mode === 'diff' ? 'Em “Mudança tonal” vês o efeito do processamento em cada banda. Para ver os conflitos, escolhe Antes ou Depois.' : 'Clica num conflito (caixa tracejada) para o ver no tempo, ouvi-lo e ajustar a correção.'}</span>` : '<span class="small muted">Nenhum conflito de frequências relevante detetado.</span>'; V.analysis.setBypass(app, null); return; }
      const mi = V.analysis.maskInfo(app, c), co = V.analysis.corrOf(st, c);
      const aS = st.stems.find((x) => x.id === c.a), bS = co && co.B;
      const worst = mi.pre ? mi.pre.perSec.slice().sort((x, y) => y.frac - x.frac)[0] : null;
      const bypassed = !!(app.engine.graph && app.engine.graph.bypass && co && co.lane && app.engine.graph.bypass.has(co.lane));
      const freqVal = co && co.kind === 'dyn' ? co.d.freq : c.freq;
      const ctl = (id, label, min, max, step, val, fmt) => `<label class="cctl"><span>${label}</span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"><b id="${id}V">${fmt(val)}</b></label>`;
      const logF = (v) => Math.round(20 * Math.pow(1000, v / 1000));
      const invF = (f) => Math.round((1000 * Math.log10(f / 20)) / 3);
      let corrHtml;
      if (!co) corrHtml = '';
      else if (co.kind === 'dyn') corrHtml = `<div class="eyebrow" style="margin-bottom:6px">Correção · EQ dinâmico no ${UI.esc(bS.label)} (só atua quando ${UI.esc(aS.label)} toca)</div>
          <div class="cctls">${ctl('cCut', 'Corte máx.', 0, 8, 0.5, co.d.cut, (v) => '−' + UI.fmtNum(+v) + ' dB')}${ctl('cFreq', 'Frequência', 0, 1000, 1, invF(freqVal), (v) => D.fmtHz(logF(+v)))}${ctl('cQ', 'Q', 0.5, 4, 0.1, co.d.q || 1.4, (v) => UI.fmtNum(+v))}</div>`;
      else if (co.kind === 'duck') corrHtml = `<div class="eyebrow" style="margin-bottom:6px">Correção · sidechain multibanda no ${UI.esc(bS.label)} ← ${UI.esc(aS.label)}</div>
          <div class="cctls">${ctl('cCut', 'Profundidade', 0, 10, 0.5, co.d.depth, (v) => '−' + UI.fmtNum(+v) + ' dB')}${ctl('cFreq', 'Abaixo de', 0, 1000, 1, invF(co.d.freq || 120), (v) => D.fmtHz(logF(+v)))}</div>`;
      else corrHtml = `<div class="row" style="gap:10px"><span class="small muted">Sem correção ativa (${UI.esc(c.action || 'nenhuma')}).</span>${(bS.p.dyn || []).length < 2 || c.kind === 'duck' ? `<button class="btn sm acc" data-cc="create">Criar correção</button>` : '<span class="small dim">O stem já tem 2 bandas de EQ dinâmico.</span>'}</div>`;
      el.innerHTML = `
        <div class="row" style="gap:10px;flex-wrap:wrap;margin-bottom:10px">
          <b style="color:var(--text)">${UI.esc(c.aName)} × ${UI.esc(c.bName)} · ${D.fmtHz(c.freq)}</b>
          ${(() => { const bc = st.post && mi.post ? I().bandCut(st, c) : null; return bc !== null && bc !== undefined ? `<span class="small" title="Medido: quanto o processamento (EQ fixo + EQ dinâmico + compressão) mudou o ${UI.esc(c.bName)} nesta banda enquanto ${UI.esc(c.aName)} toca, sem contar o fader">${UI.esc(c.bName)} @ ${D.fmtHz(c.freq)} quando ${UI.esc(c.aName)} toca: <b class="mono">${bc > 0 ? '+' : ''}${UI.fmtNum(bc)} dB</b> <span class="dim">(sem fader)</span></span>` : ''; })()}
          <span class="small">Antes <b class="mono">${fmtPct(mi.pre ? mi.pre.overlap : c.overlap)}</b>${mi.post ? ` → depois <b class="mono" style="color:${mi.post.overlap < 0.15 ? '#4ade80' : mi.post.overlap < (mi.pre ? mi.pre.overlap : 1) * 0.7 ? '#fbbf24' : '#fb7185'}">${fmtPct(mi.post.overlap)}</b>` : st.stage === 'ready' ? ' · <span class="dim">depois: mede em “Depois”</span>' : ''} <span class="dim">do tempo em que ${UI.esc(c.aName)} toca</span></span>
          <span class="spacer"></span>
          <button class="btn sm acc" data-cc="listen">${UI.icon('play')}Ouvir o conflito</button>
          ${co && co.lane ? `<div class="seg"><button data-ab="on" class="${bypassed ? '' : 'on'}">Com correção</button><button data-ab="off" class="${bypassed ? 'on' : ''}">Sem correção</button></div>` : ''}
        </div>
        <div class="cvbox"><canvas id="confStrip" style="width:100%;height:54px;display:block"></canvas></div>
        <div class="chips" style="margin:10px 0 14px">${(mi.pre ? mi.pre.perSec : []).map((p) => { const po = mi.post ? mi.post.perSec[p.i] : null; return `<button class="chip sm ${p.frac >= 0.25 ? 'warn' : ''}" data-csec="${p.i}" title="Loop desta secção">${UI.esc(p.name)} · ${p.active ? fmtPct(p.frac) : '—'}${po && p.active ? ' → ' + fmtPct(po.frac) : ''}</button>`; }).join('')}</div>
        ${corrHtml}`;
      V.analysis.drawStrip(app, c, mi);
      el.querySelectorAll('[data-csec]').forEach((b) => (b.onclick = () => { const s = st.music.sections[+b.dataset.csec]; app.setLoop(s); app.ensureAudio().then(() => app.engine.play(s.start)); }));
      const lb = el.querySelector('[data-cc=listen]');
      if (lb) lb.onclick = async () => {
        await app.ensureAudio();
        st.stems.forEach((x) => (x.solo = x.id === c.a || x.id === c.b));
        const g = app.engine.graph; if (g) st.stems.forEach((x) => g.applyStem(x));
        app.syncSM();
        const s = worst && worst.active ? st.music.sections[worst.i] : null;
        if (s) app.setLoop(s);
        app.engine.play(s ? s.start : app.engine.position());
        UI.toast(`Solo ${UI.esc(c.aName)} + ${UI.esc(c.bName)}${s ? ' · loop ' + UI.esc(worst.name) : ''}. Usa “Com / Sem correção” para comparar; SOLO ✕ no topo para sair.`, 'ok', 5000);
      };
      el.querySelectorAll('[data-ab]').forEach((b) => (b.onclick = () => { V.analysis.setBypass(app, b.dataset.ab === 'off' ? co.lane : null); V.analysis.renderInfo(app); }));
      const cr = el.querySelector('[data-cc=create]');
      if (cr) cr.onclick = () => app.change('Criar correção de masking', () => {
        if (c.kind === 'duck') { bS.p.duck = { on: true, src: c.a, freq: 120, depth: Math.max(2, c.cut || 3) }; bS.manual.duck = true; c.action = `duck <120 Hz −${UI.fmtNum(Math.max(2, c.cut || 3))} dB com o ${aS.label.toLowerCase()}`; }
        else { bS.p.dyn = bS.p.dyn || []; bS.p.dyn.push({ freq: c.freq, q: 1.4, cut: Math.max(2, c.cut || 2), src: c.a }); bS.manual.dyn = true; c.action = `EQ dinâmico −${UI.fmtNum(Math.max(2, c.cut || 2))} dB @ ${D.fmtHz(c.freq)}`; }
      }, { auto: true, stem: bS.id });
      // controlos da correção: valor ao vivo enquanto arrasta, aplica ao largar
      const bind = (id, fmt, apply) => {
        const r = el.querySelector('#' + id); if (!r) return;
        r.addEventListener('input', () => { el.querySelector('#' + id + 'V').textContent = fmt(+r.value); });
        r.addEventListener('change', () => { app.change('Ajustar correção de masking', () => { apply(+r.value); }, { auto: true, stem: bS.id, refresh: false }); V.analysis.renderStatus(app); V.analysis.renderInfo(app); });
      };
      if (co && co.kind === 'dyn') {
        const upd = () => { bS.manual.dyn = true; c.action = `EQ dinâmico −${UI.fmtNum(co.d.cut)} dB @ ${D.fmtHz(co.d.freq)}`; };
        bind('cCut', (v) => '−' + UI.fmtNum(v) + ' dB', (v) => { co.d.cut = v; upd(); });
        bind('cFreq', (v) => D.fmtHz(logF(v)), (v) => { co.d.freq = logF(v); upd(); });
        bind('cQ', (v) => UI.fmtNum(v), (v) => { co.d.q = v; upd(); });
      } else if (co && co.kind === 'duck') {
        const upd = () => { bS.manual.duck = true; c.action = `duck <${Math.round(co.d.freq || 120)} Hz −${UI.fmtNum(co.d.depth)} dB com o ${aS.label.toLowerCase()}`; };
        bind('cCut', (v) => '−' + UI.fmtNum(v) + ' dB', (v) => { co.d.depth = v; upd(); });
        bind('cFreq', (v) => D.fmtHz(logF(v)), (v) => { co.d.freq = logF(v); upd(); });
      }
      UI.bindRanges(el);
    },
    /** Liga/desliga uma correção só na escuta (não altera o projeto). */
    setBypass(app, lane) {
      const g = app.engine.graph; if (!g) return;
      const had = g.bypass && g.bypass.size;
      g.bypass = lane ? new Set([lane]) : null;
      if (had || lane) app.engine.reschedule();
    },
    drawStrip(app, c, mi) {
      const root = V.analysis.root; const cv = root && root.querySelector('#confStrip'); if (!cv) return;
      const { ctx, w, h } = UI.fitCanvas(cv);
      const st = app.state, dur = st.music.duration, bs = I().blockSec(st);
      ctx.clearRect(0, 0, w, h);
      (st.music.sections || []).forEach((s, i) => {
        const x0 = (s.start / dur) * w, x1 = (s.end / dur) * w;
        ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.055)'; ctx.fillRect(x0, 0, x1 - x0, h);
        ctx.fillStyle = '#7c8597'; ctx.font = '10.5px Geist, Inter, sans-serif';
        ctx.save(); ctx.beginPath(); ctx.rect(x0, 0, x1 - x0 - 3, 14); ctx.clip(); ctx.fillText(MM.sections.label(st, i), x0 + 4, 11); ctx.restore();
      });
      const draw = (d, y, hh, col) => {
        if (!d) return;
        const n = d.nb, step = Math.max(1, Math.floor(n / w));
        ctx.fillStyle = col;
        for (let t = 0; t < n; t += step) {
          let v = 0; for (let k = t; k < Math.min(n, t + step); k++) v = Math.max(v, d.act[k] ? d.hit[k] : 0);
          if (v <= 0.01) continue;
          const x = ((t * bs) / dur) * w;
          ctx.globalAlpha = 0.25 + Math.min(1, v) * 0.75;
          ctx.fillRect(x, y + hh * (1 - Math.min(1, v)), Math.max(1, (step * bs / dur) * w), hh * Math.min(1, v));
        }
        ctx.globalAlpha = 1;
      };
      draw(mi.pre, 15, mi.post ? 18 : 36, '#fb7185');
      if (mi.post) draw(mi.post, 35, 18, '#4ade80');
      ctx.font = '9.5px Geist Mono, monospace';
      const tag = (t, y) => { const tw = ctx.measureText(t).width; ctx.fillStyle = 'rgba(10,12,16,.9)'; ctx.fillRect(w - tw - 8, y - 9, tw + 6, 12); ctx.fillStyle = '#c9d1dc'; ctx.fillText(t, w - tw - 5, y); };
      tag('antes', 27); if (mi.post) tag('depois', 48);
      void c;
    },

    // ---------- tonalidade vs estilo / referência ----------
    renderTone(app) {
      const root = V.analysis.root; if (!root) return;
      const el = root.querySelector('#tonePanel'); if (!el) return;
      const st = app.state, A = app.ana;
      const T = I().tone(st, A.tone);
      const head = `<div class="panel-title"><div class="eyebrow">Tonalidade vs alvo</div>${st.metrics.master && st.metrics.mix ? `<div class="seg" id="toneSel"><button data-t="master" class="${A.tone !== 'mix' ? 'on' : ''}">Master</button><button data-t="mix" class="${A.tone === 'mix' ? 'on' : ''}">Mix</button></div>` : ''}</div>`;
      if (!T) { el.innerHTML = head + '<div class="small muted">Disponível depois do AI Mix &amp; Master.</div>'; return; }
      const devTxt = (list, who) => list.slice(0, 4).map((d) => `<li><b class="mono" style="color:${d.db > 0 ? '#fbbf24' : '#38bdf8'}">${d.db > 0 ? '+' : ''}${UI.fmtNum(d.db)} dB</b> nos ${d.label} face ${who}</li>`).join('');
      const profTxt = T.style ? `ao perfil ${UI.esc(T.style.name)}` : '';
      el.innerHTML = `${head}
        <div class="cvbox"><canvas id="toneCv" style="width:100%;height:220px;display:block"></canvas></div>
        <div class="fm-legend small muted"><span><i class="lgd" style="background:#5eead4"></i>${A.tone === 'mix' ? 'mix (premaster)' : 'master'}</span>${T.style ? `<span><i class="lgd dash" style="border-color:#cfd6e2"></i>perfil ${UI.esc(T.style.name)} (${T.style.n} ${T.style.n === 1 ? 'música' : 'músicas'}, faixa = variação normal)</span>` : ''}${T.ref ? `<span><i class="lgd" style="background:#f5b14c"></i>referência ${UI.esc(T.ref.name)}</span>` : ''}</div>
        ${T.style ? (T.devStyle.length ? `<ul class="devs">${devTxt(T.devStyle, profTxt)}</ul>` : `<p class="small" style="margin:10px 0 0"><span class="acc-t">●</span> Dentro da variação normal do perfil ${UI.esc(T.style.name)} em todas as bandas.</p>`) : `<p class="small muted" style="margin:10px 0 0">Sem perfil treinado para ${UI.esc(st.music.genre || 'este estilo')}. <a data-view="styles" class="acc-t" style="cursor:pointer">Treina-o na aba Estilos</a> para comparar com músicas de referência do estilo.</p>`}
        ${T.ref ? (T.devRef.length ? `<ul class="devs">${devTxt(T.devRef, 'à referência')}</ul>` : `<p class="small" style="margin:6px 0 0"><span class="acc-t">●</span> A menos de 1 dB da referência em todas as bandas.</p>`) : ''}`;
      el.querySelectorAll('#toneSel [data-t]').forEach((b) => (b.onclick = () => { A.tone = b.dataset.t; V.analysis.renderTone(app); }));
      const cv = el.querySelector('#toneCv');
      const { ctx, w, h } = UI.fitCanvas(cv);
      const x0 = 34, gw = w - x0 - 8, y0 = 8, gh = h - y0 - 20, R = 9;
      const X = (f) => x0 + (Math.log10(f / 25) / Math.log10(16000 / 25)) * gw, Y = (v) => y0 + gh / 2 - (D.clamp(v, -R, R) / R) * (gh / 2);
      ctx.clearRect(0, 0, w, h);
      ctx.font = '10.5px Geist Mono, monospace'; ctx.fillStyle = '#7c8597';
      [-6, -3, 0, 3, 6].forEach((v) => { ctx.fillStyle = v ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.12)'; ctx.fillRect(x0, Y(v), gw, 1); ctx.fillStyle = '#7c8597'; ctx.fillText((v > 0 ? '+' : '') + v, 4, Y(v) + 4); });
      [[50, '50'], [100, '100'], [250, '250'], [500, '500'], [1000, '1k'], [2500, '2,5k'], [5000, '5k'], [10000, '10k']].forEach(([f, t]) => { ctx.fillStyle = 'rgba(255,255,255,.04)'; ctx.fillRect(X(f), y0, 1, gh); ctx.fillStyle = '#7c8597'; ctx.fillText(t, X(f) - 8, h - 5); });
      const F = T.freqs;
      // referência de nível: o estilo (ou a referência) é o zero; a curva da mix é relativa
      const base = T.style ? T.style.curve : T.ref ? T.ref.curve : F.map(() => 0);
      if (T.style) {
        ctx.beginPath();
        F.forEach((f, i) => { const y = Y(T.style.curve[i] - base[i] + Math.max(1, T.style.sd[i])); i ? ctx.lineTo(X(f), y) : ctx.moveTo(X(f), y); });
        for (let i = F.length - 1; i >= 0; i--) ctx.lineTo(X(F[i]), Y(T.style.curve[i] - base[i] - Math.max(1, T.style.sd[i])));
        ctx.closePath(); ctx.fillStyle = 'rgba(207,214,226,.08)'; ctx.fill();
      }
      const line = (arr, col, dash, lw) => { ctx.beginPath(); ctx.setLineDash(dash || []); ctx.strokeStyle = col; ctx.lineWidth = lw; F.forEach((f, i) => { const y = Y(arr[i] - base[i]); i ? ctx.lineTo(X(f), y) : ctx.moveTo(X(f), y); }); ctx.stroke(); ctx.setLineDash([]); };
      if (T.style) line(T.style.curve, '#cfd6e2', [6, 5], 1.4);
      if (T.ref) line(T.ref.curve, '#f5b14c', null, 1.5);
      line(T.mine, '#5eead4', null, 2.2);
      ctx.fillStyle = '#7c8597'; ctx.fillText(T.style ? 'dB face ao perfil' : T.ref ? 'dB face à referência' : 'curva normalizada', x0 + 4, y0 + 10);
    },

    // ---------- fase entre stems + compatibilidade mono ----------
    renderPhase(app) {
      const root = V.analysis.root; if (!root) return;
      const el = root.querySelector('#phasePanel'); if (!el) return;
      const st = app.state;
      const pairs = I().phasePairs(st);
      const rows = pairs.map((pr) => ({ pr, ev: I().phaseEval(st, pr) })).filter((r) => r.ev);
      const bandTxt = (b) => (b === 'low' ? 'graves < 150 Hz' : '80 Hz – 4 kHz');
      const row = ({ pr, ev }, i) => {
        const a = pr.a, b = pr.b;
        let msg, btn = '';
        if (ev.verdict === 'polarity') { msg = `<span class="bad-t">Polaridade oposta</span> · r ${UI.fmtNum(ev.r0, 2)} — a soma perde ${UI.fmtNum(-ev.sumDb)} dB nesta banda`; btn = `<button class="btn sm acc" data-ph="${i}">Inverter polaridade · ${UI.esc(b.short || b.label)}</button>`; }
        else if (ev.verdict === 'align') { const who = ev.fix.a > 0 ? a : b, ms = ev.fix.a > 0 ? ev.fix.a : ev.fix.b; msg = `<span style="color:var(--warn)">Desalinhados ${UI.fmtNum(Math.abs(ev.lagMs), 2)} ms</span> · r ${UI.fmtNum(ev.r0, 2)} → ${UI.fmtNum(ev.best, 2)} alinhados`; btn = `<button class="btn sm acc" data-ph="${i}">Atrasar ${UI.esc(who.short || who.label)} ${UI.fmtNum(ms, 2)} ms</button>`; }
        else msg = `<span class="acc-t">Em fase</span> · r ${ev.r0 >= 0 ? '+' : ''}${UI.fmtNum(ev.r0, 2)}${Math.abs(ev.r0) < 0.15 ? ' (pouco correlacionados: não se cancelam)' : ''}`;
        const fixed = [a, b].filter((x) => x.p.polarity || +x.p.align > 0);
        if (fixed.length) btn += `<button class="btn sm ghost" data-phreset="${i}" title="Volta a pôr polaridade normal e 0 ms">Repor</button>`;
        return `<div class="ph-row"><div><b>${UI.esc(a.short || a.label)} × ${UI.esc(b.short || b.label)}</b> <span class="small dim">${pr.why} · ${bandTxt(pr.band)} · ${UI.fmtNum(ev.seconds, 0)} s analisados</span><div class="small" style="margin-top:3px">${msg}${fixed.length ? ` <span class="dim">· aplicado: ${fixed.map((x) => `${UI.esc(x.short || x.label)}${x.p.polarity ? ' Ø' : ''}${+x.p.align > 0 ? ' +' + UI.fmtNum(+x.p.align, 2) + ' ms' : ''}`).join(', ')}</span>` : ''}</div></div><div class="row" style="gap:6px">${btn}</div></div>`;
      };
      const wide = st.stems.filter((s) => !s.removed && s.features && s.chs.length > 1 && s.role !== 'Reference Track').map((s) => ({ s, l: I().monoLoss(s) })).sort((x, y) => x.l - y.l);
      const bad = wide.filter((x) => x.l < -1.5).slice(0, 5);
      el.innerHTML = `<div class="panel-title"><div class="eyebrow">Fase entre stems</div><span class="small muted">correlação a 0 ms: +1 soma, −1 cancela</span></div>
        ${rows.length ? rows.map(row).join('') : '<div class="small muted">Sem pares em que a fase seja crítica (kick × baixo, camadas da mesma família, pares L/R).</div>'}
        <div class="eyebrow" style="margin:16px 0 8px">Compatibilidade mono</div>
        ${wide.length ? (bad.length ? bad.map((x) => `<div class="ph-row"><div><b>${UI.esc(x.s.short || x.s.label)}</b> <span class="small" style="color:${x.l < -4.5 ? 'var(--bad)' : 'var(--warn)'}">perde ${UI.fmtNum(-x.l)} dB em mono</span><div class="small dim">${x.l < -4.5 ? 'Muito largo ou com fase invertida entre L e R: em telemóvel/club mono quase desaparece.' : 'Largo: perde presença em mono. Normal para pads e ambiências.'}</div></div></div>`).join('') : '<div class="small"><span class="acc-t">●</span> Todos os stems estéreo somam bem em mono (perda &lt; 1,5 dB).</div>') : '<div class="small muted">Não há stems estéreo.</div>'}`;
      el.querySelectorAll('[data-ph]').forEach((b) => (b.onclick = () => {
        const { pr, ev } = rows[+b.dataset.ph];
        if (ev.verdict === 'polarity') app.change('Inverter polaridade · ' + pr.b.label, () => { pr.b.p.polarity = !pr.b.p.polarity; pr.b.manual.polarity = true; }, { stem: pr.b.id, refresh: false });
        else app.change('Alinhar ' + pr.a.label + ' × ' + pr.b.label, () => { pr.a.p.align = ev.fix.a; pr.b.p.align = ev.fix.b; pr.a.manual.align = pr.b.manual.align = true; }, { allStems: true, refresh: false });
        V.analysis.renderPhase(app); V.analysis.renderStatus(app);
        UI.toast('Aplicado. Ouve com Mix (tecla 2); Ctrl+Z desfaz.', 'ok');
      }));
      el.querySelectorAll('[data-phreset]').forEach((b) => (b.onclick = () => {
        const { pr } = rows[+b.dataset.phreset];
        app.change('Repor fase', () => { [pr.a, pr.b].forEach((x) => { x.p.polarity = false; x.p.align = 0; }); }, { allStems: true, refresh: false });
        V.analysis.renderPhase(app); V.analysis.renderStatus(app);
      }));
    },

    // ---------- histórico do score ----------
    renderHist(app) {
      const root = V.analysis.root; if (!root) return;
      const el = root.querySelector('#scoreHist'); if (!el) return;
      const st = app.state, vs = st.versions.filter((v) => typeof v.score === 'number');
      if (vs.length < 2) { el.innerHTML = `<div class="eyebrow" style="margin-bottom:8px">Histórico</div><div class="small muted">O histórico aparece quando houver duas ou mais versões (cada AI Mix &amp; Master ou Ctrl+S guarda uma).</div>`; return; }
      const K = [['balance', 'Balance'], ['dynamics', 'Dynamics'], ['lowEnd', 'Low-End'], ['loudness', 'Loudness'], ['tone', 'Tonal'], ['clarity', 'Clarity'], ['stereo', 'Stereo'], ['vocal', 'Vocal'], ['phase', 'Phase']];
      el.innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:8px"><div class="eyebrow">Histórico · ${vs.length} versões</div><span class="small muted">clica numa versão para a carregar</span></div>
        <div class="hist-grid"><canvas id="histCv" style="width:100%;height:110px;display:block"></canvas>
        <div class="hist-list">${vs.slice().reverse().slice(0, 8).map((v, j, arr) => {
          const prev = arr[j + 1];
          const ch = prev && v.scores && prev.scores ? K.map(([k, l]) => [l, v.scores[k] - prev.scores[k]]).filter(([, d]) => d).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3) : [];
          return `<div class="hist-row ${v.id === st.currentVersion ? 'on' : ''}" data-ver="${v.id}"><b>${UI.esc(v.name)}</b><span class="mono">${v.score}${prev ? `<em class="${v.score - prev.score >= 0 ? 'up' : 'down'}">${v.score - prev.score >= 0 ? '+' : ''}${v.score - prev.score}</em>` : ''}</span><span class="small dim">${ch.map(([l, d]) => `${l} ${d > 0 ? '+' : ''}${d}`).join(' · ') || (prev ? 'sem alterações no score' : 'primeira versão')}</span></div>`;
        }).join('')}</div></div>`;
      el.querySelectorAll('[data-ver]').forEach((r) => (r.onclick = () => app.loadVersion(r.dataset.ver)));
      const cv = el.querySelector('#histCv');
      const { ctx, w, h } = UI.fitCanvas(cv);
      const sc = vs.map((v) => v.score), lo = Math.min(...sc, 70) - 2, hi = Math.max(...sc, 95) + 2;
      const X = (i) => 10 + (i / Math.max(1, vs.length - 1)) * (w - 20), Y = (v) => 8 + (1 - (v - lo) / (hi - lo)) * (h - 22);
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,.06)'; [80, 90].forEach((v) => { if (v > lo && v < hi) { ctx.beginPath(); ctx.moveTo(0, Y(v)); ctx.lineTo(w, Y(v)); ctx.stroke(); ctx.fillStyle = '#5d6574'; ctx.font = '10px Geist Mono, monospace'; ctx.fillText(v, 0, Y(v) - 2); } });
      ctx.beginPath(); ctx.strokeStyle = '#5eead4'; ctx.lineWidth = 2;
      vs.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v.score)) : ctx.moveTo(X(i), Y(v.score)))); ctx.stroke();
      vs.forEach((v, i) => { ctx.beginPath(); ctx.arc(X(i), Y(v.score), v.id === st.currentVersion ? 5 : 3, 0, Math.PI * 2); ctx.fillStyle = v.id === st.currentVersion ? '#5eead4' : '#0b0e14'; ctx.fill(); ctx.strokeStyle = '#5eead4'; ctx.lineWidth = 1.5; ctx.stroke(); });
    },

    applyRec(app, rec) {
      const st = app.state;
      switch (rec.action) {
        case 'lessBus': app.change('Menos compressão no mix bus', () => { st.bus.glue.gr = Math.max(0.3, st.bus.glue.gr - 0.6); st.bus.manual = true; st.master.chain.glue.gr = Math.max(0.3, st.master.chain.glue.gr - 0.4); st.master.manual.glue = true; }, { bus: true, master: true }); app.runAI({ keepMix: true }); break;
        case 'moreBus': app.change('Mais cola no mix bus', () => { st.bus.glue.gr += 0.5; st.bus.manual = true; }, { bus: true }); break;
        case 'moreDuck': app.change('Mais ducking kick/baixo', () => { st.stems.forEach((s) => { if (s.p.duck && s.p.duck.on) { s.p.duck.depth = Math.min(8, s.p.duck.depth + 1.5); s.manual.duck = true; } }); }, { auto: true }); UI.toast('Ducking reforçado (+1,5 dB). Ouve o refrão com Mix.', 'ok'); break;
        case 'moreDyn': app.change('Reforçar EQ dinâmico', () => { st.stems.forEach((s) => (s.p.dyn || []).forEach((d) => (d.cut = Math.min(8, d.cut + 1)))); }, { auto: true }); break;
        case 'phase': {
          const pairs = st.stems.filter((s) => s.pair && !s.removed);
          UI.confirm('Fase e compatibilidade mono', `Correlação mínima ${UI.fmtNum(st.metrics.master.corrMin, 2)}. Posso estreitar os pares estéreo (${pairs.map((s) => s.label).join(', ') || 'nenhum par'}) em 15 % e baixar a largura do master para 100 %. Vê também o painel “Fase entre stems”.`, 'Aplicar').then((ok) => {
            if (ok) app.change('Corrigir correlação', () => { pairs.forEach((s) => { s.p.pan *= 0.85; s.manual.pan = true; }); st.master.width = Math.min(st.master.width, 100); st.master.manual.ms = true; }, { allStems: true, master: true });
          });
          break;
        }
        case 'remaster': app.runAI({ keepMix: true }); break;
        case 'compare': app.go('compare'); break;
        case 'balance': app.change('Aproximar o balanço da âncora', () => { (rec.fix || []).forEach((f) => { const s = st.stems.find((x) => x.id === f.id); if (s) { s.p.fader = D.clamp(s.p.fader + f.db, -40, 12); s.manual.fader = true; } }); }, { allStems: true }); break;
        case 'tone': { const el = V.analysis.root && V.analysis.root.querySelector('#tonePanel'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); break; }
        case 'measure': V.analysis.measure(app).then(() => { app.rescore && app.rescore(); }); break;
      }
    },

    drawSF(app) {
      const root = V.analysis.root; if (!root) return;
      const cv = root.querySelector('#sf'); if (!cv) return;
      const { ctx, w, h } = UI.fitCanvas(cv);
      const st = app.state, stems = st.stems.filter((s) => !s.removed && s.features && s.role !== 'Reference Track');
      const x0 = 70, y0 = 10, gw = w - x0 - 16, gh = h - y0 - 34;
      V.analysis._sfGeom = { x0, y0, w: gw, h: gh };
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, gw, gh);
      [1 / 3, 2 / 3].forEach((f) => { ctx.beginPath(); ctx.moveTo(x0, y0 + gh * f); ctx.lineTo(x0 + gw, y0 + gh * f); ctx.stroke(); });
      ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(x0 + gw / 2, y0); ctx.lineTo(x0 + gw / 2, y0 + gh); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#7c8597'; ctx.font = '12px Geist, Inter, sans-serif';
      ctx.fillText('Fundo', 8, y0 + 18); ctx.fillText('Meio', 8, y0 + gh / 2 + 4); ctx.fillText('Frente', 8, y0 + gh - 6);
      ctx.font = '11px Geist Mono, monospace';
      ['L100', 'L50', 'C', 'R50', 'R100'].forEach((t, i) => ctx.fillText(t, x0 + (gw * i) / 4 - (i === 4 ? 30 : i ? 12 : 0), h - 10));
      const pts = [], labels = [];
      const place = (txt, x, y, col) => {
        ctx.font = '12.5px Geist, Inter, sans-serif';
        const tw = ctx.measureText(txt).width;
        for (const dy of [0, 15, -15, 30, -30, 45]) {
          const r = { x, y: y + dy - 11, w: tw, h: 14 };
          if (!labels.some((q) => r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h)) { labels.push(r); ctx.fillStyle = col || '#e9edf4'; ctx.fillText(txt, x, y + dy); return; }
        }
        ctx.fillStyle = col || '#e9edf4'; ctx.fillText(txt, x, y);
      };
      stems.map((s) => ({ s, d: depthOf(app, s) })).sort((a, b) => b.d - a.d).forEach(({ s, d }) => {
        const x = x0 + ((s.p.pan + 1) / 2) * gw, y = y0 + (1 - d) * gh;
        const lv = D.clamp((s.p.fader + 20) / 22, 0.2, 1.2);
        const r = 10 + lv * 16 * (s.hier === 'P' ? 1.15 : s.hier === 'B' ? 0.8 : 1);
        const col = UI.colorOf(s);
        const wide = s.chs.length > 1 && s.features.width > 0.25;
        ctx.globalAlpha = s.mute ? 0.35 : 0.9;
        if (wide || s.role === 'Pad' || s.role === 'Strings') {
          const ew = Math.min(gw * 0.32, 60 + s.features.width * 220);
          ctx.beginPath(); ctx.ellipse(x, y, ew, r * 1.2, 0, 0, Math.PI * 2);
          ctx.fillStyle = col + '22'; ctx.fill(); ctx.strokeStyle = col + 'aa'; ctx.lineWidth = app.selected === s.id ? 2.5 : 1.5; ctx.stroke();
        } else {
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = col + '40'; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = app.selected === s.id ? 2.5 : 1.5; ctx.stroke();
          if (app.selected === s.id) { ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(x, y, r + 6, 0, Math.PI * 2); ctx.strokeStyle = '#5eead4'; ctx.stroke(); ctx.setLineDash([]); }
        }
        ctx.globalAlpha = 1;
        place(s.short || s.label, x + r + 6, y + 4);
        if (s.chs.length > 1) { const ml = I().monoLoss(s); if (ml < -2) { ctx.font = '10.5px Geist Mono, monospace'; ctx.fillStyle = ml < -4.5 ? '#fb7185' : '#fbbf24'; ctx.fillText(`mono ${UI.fmtNum(ml)} dB`, x + r + 6, y + 17); } }
        pts.push({ s, x, y, r });
      });
      V.analysis._sfPts = pts;
    },
  };
})();
