/* MixMind — vistas: início (vazio), a analisar e revisão de stems + direção */
(function () {
  const MM = window.MM, D = MM.dsp, UI = MM.ui;
  const V = (MM.views = MM.views || {});

  // ================= início =================
  V.home = {
    render(app) {
      const st = app.state;
      if (st.stage === 'analyzing') return V.import.render(app);
      const rec = app.recent.slice(0, 4);
      return `<div class="hero">
        <div class="eyebrow acc">AI proposes. Engineer decides.</div>
        <h1 style="margin-top:10px">Mistura e masterização inteligente,<br><em>a partir dos teus stems.</em></h1>
        <p class="lead">O MixMind ouve cada stem, percebe a função musical, propõe uma direção e executa a mistura e o master — tudo editável, explicado e comparável com loudness match. Corre inteiramente no teu browser: o áudio nunca sai do teu computador.</p>
        <div class="drop" id="dropzone">
          <div class="up">${UI.icon('upload')}</div>
          <h2>Arrasta uma pasta de stems</h2>
          <p class="muted" style="margin:8px auto 18px;max-width:520px">WAV, AIFF, FLAC ou MP3. A IA identifica cada instrumento pelo nome <b>e</b> pelo áudio — mesmo com nomes como <span class="mono">Audio 12.wav</span>.</p>
          <div class="row" style="justify-content:center">
            <button class="btn primary lg" id="pick">${UI.icon('folder')}Escolher ficheiros</button>
            <button class="btn lg" id="pickDir">${UI.icon('folder')}Escolher pasta</button>
          </div>
        </div>
        <div class="cards3">
          <div class="card-act" id="demo"><div class="ic">${UI.icon('music')}</div><b>Sessão de demonstração</b><span class="muted small">15 stems de uma Kizomba (94 BPM, F♯ menor) sintetizados no browser, com nomes errados de propósito.</span></div>
          <div class="card-act" id="masterOnly"><div class="ic">${UI.icon('plug')}</div><b>Masterizar uma mix stereo</b><span class="muted small">Modo MixMind Master: carrega uma mix já feita e a IA propõe o master. Tu decides.</span></div>
          <div class="card-act" id="stylesCard"><div class="ic">${UI.icon('brain')}</div><b>Treinar estilos</b><span class="muted small">Carrega Kizombas, Sembas, Afro House… A IA aprende o som de cada estilo e aplica-o quando escolhem o preset.</span></div>
        </div>
        ${rec.length ? `<div class="recent"><span class="muted small">Projetos recentes:</span>${rec.map((r) => `<button class="chip" data-open="${r.id}">${UI.icon('file')}${UI.esc(r.name)} <span class="dim mono" style="font-size:11px">${r.mode === 'master' ? 'master' : r.n + ' stems'}</span></button>`).join('')}</div>` : ''}
        <div class="feat">
          <div><b>Classificação por áudio</b>Espectro, envolvente, transientes, pitch, harmonicidade e estéreo — com % de confiança.</div>
          <div><b>Explain mode</b>Cada decisão vem com o porquê: “Reduzi 2,1 dB a 280 Hz no piano porque…”.</div>
          <div><b>Loudness-true A/B</b>Original, Mix, Master e Referência ao mesmo volume, sem truques.</div>
          <div><b>Export com QC</b>WAV/AIFF/FLAC/MP3, versões por plataforma e relatório de qualidade.</div>
        </div>
      </div>`;
    },
    mount(app, root) {
      if (app.state.stage === 'analyzing') return V.import.mount(app, root);
      const $ = (s) => root.querySelector(s);
      $('#pick').onclick = () => app.pickFiles();
      $('#pickDir').onclick = () => app.pickFiles({ dir: true });
      $('#demo').onclick = () => app.loadDemo();
      $('#masterOnly').onclick = () => app.go('plugin');
      $('#stylesCard').onclick = () => app.go('styles');
      root.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => app.openProject(b.dataset.open)));
    },
    onStep(app, k) { if (app.state.stage === 'analyzing') V.import.onStep(app, k); },
  };

  // ================= importar / analisar / rever =================
  const STEP_LBL = { import: 'Importar stems', identify: 'Identificar instrumentos', music: 'Analisar música e secções', plan: 'Planear mix e master', render: 'Pré-renderizar versões' };
  function stepsHTML(app) {
    const S = app.steps || {};
    const order = ['import', 'identify', 'music', 'plan', 'render'];
    let cur = order.find((k) => !S[k] || S[k][0] < 1);
    return order.map((k) => {
      const [p, t] = S[k] || [0, ''];
      const done = p >= 1, isCur = k === cur;
      return `<li class="${done ? 'done' : isCur ? 'cur' : ''}"><span class="ic">${done ? '✓' : isCur ? '' : '○'}</span>${STEP_LBL[k]}<span class="val">${done ? UI.esc(t) : isCur ? UI.esc(t || 'em curso…') : ''}</span></li>`;
    }).join('');
  }
  function totalProgress(app) {
    const S = app.steps || {}, w = { import: 0.15, identify: 0.55, music: 0.3 };
    return Object.entries(w).reduce((a, [k, x]) => a + (S[k] ? S[k][0] : 0) * x, 0);
  }

  V.import = {
    render(app) {
      const st = app.state;
      if (st.stage === 'analyzing') {
        return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:1240px;margin:0 auto">
          <div class="panel p" style="padding:28px">
            <div class="eyebrow">A analisar</div>
            <h1 style="margin:10px 0 18px">A analisar a tua música… <span id="pctA" class="acc-t">${Math.round(totalProgress(app) * 100)} %</span></h1>
            <div class="bar" style="height:10px"><i id="barA" style="width:${totalProgress(app) * 100}%"></i></div>
            <ul class="steps" id="stepsA">${stepsHTML(app)}</ul>
            <p class="muted small" style="margin-top:22px">Tudo corre no teu computador. Análise espectral, transientes, pitch, estéreo, BPM, tonalidade, estrutura e género.</p>
          </div>
          <div class="panel p" style="padding:28px">
            <div class="eyebrow">O que a IA está a ouvir</div>
            <div id="liveStems" style="margin-top:14px">${liveStems(app)}</div>
          </div>
        </div>`;
      }
      // revisão
      const stems = st.stems;
      const act = stems.filter((s) => !s.removed);
      const hi = act.filter((s) => s.conf >= 0.85).length, rev = act.filter((s) => s.conf < 0.85).length;
      const fake = act.filter((s) => s.notes.some((n) => /Mono falso/.test(n.text))).length;
      const issues = (st.issues || []).filter((i) => !i.resolved);
      const m = st.music;
      return `<div style="display:grid;grid-template-columns:minmax(0,1fr) 420px;gap:22px;align-items:start">
        <div>
          ${issues.length ? `<div class="panel p" style="margin-bottom:18px;border-color:rgba(251,191,36,.25)"><div class="panel-title"><div class="eyebrow warn">Precisa de atenção</div><span class="muted small">${issues.length} de ${stems.length} stems com avisos — podes continuar sem resolver</span></div>
            ${issues.map((i) => `<div class="issue"><div class="row" style="justify-content:space-between"><b class="mono">${UI.esc(i.title)}</b><span class="k">${i.kind}</span></div><div style="margin:6px 0 10px">${UI.esc(i.text)}</div><div class="row">${i.actions.map(([a, l], k) => `<button class="btn sm ${k ? 'ghost' : ''}" data-issue="${i.id}" data-a="${a}">${l}</button>`).join('')}</div></div>`).join('')}</div>` : ''}
          <div class="row" style="align-items:baseline;gap:16px;flex-wrap:wrap"><h1>${act.length} stems analisados</h1><span class="muted">A IA classificou cada ficheiro pelo nome e pelo áudio. Corrige o que estiver errado — tudo é editável.</span></div>
          <div class="row wrap" style="margin:14px 0 6px"><span class="chip">${hi} com alta confiança</span>${rev ? `<span class="chip warn">${rev} a rever</span>` : ''}${fake ? `<span class="chip">${fake} mono falso</span>` : ''}<span class="spacer"></span><button class="btn sm" id="addStems">${UI.icon('plus')}Adicionar stems</button></div>
          <table class="stbl"><thead><tr><th>Ouvir</th><th>Forma de onda</th><th>Ficheiro</th><th>Papel detetado</th><th>Confiança</th><th>Hierarquia</th><th>Notas</th><th></th></tr></thead><tbody>
          ${stems.map((s) => `<tr class="${s.removed ? 'removed' : ''}" data-id="${s.id}">
            <td>${s.removed ? '' : UI.sm(s)}</td>
            <td><canvas class="wf" data-wf="${s.id}"></canvas></td>
            <td class="mono" style="font-size:13.5px">${UI.esc(s.name)}<div class="dim tiny">${s.header.format || ''}${s.header.sampleRate ? ' · ' + (s.header.sampleRate / 1000).toString().replace('.', ',') + ' kHz' : ''}${s.header.bits ? ' · ' + s.header.bits + '-bit' : ''} · ${s.chs.length === 1 ? 'mono' : 'estéreo'}</div></td>
            <td><select class="field role-sel" data-role="${s.id}" ${s.removed ? 'disabled' : ''}>${MM.ROLE_LIST.map((r) => `<option ${r === s.role ? 'selected' : ''}>${r}</option>`).join('')}</select></td>
            <td><div class="conf"><div class="bar"><i class="${s.conf < 0.85 ? 'low' : ''}" style="width:${s.conf * 100}%"></i></div><span class="mono">${Math.round(s.conf * 100)}%</span></div></td>
            <td><button class="tag hier ${s.hier.toLowerCase()}" data-hier="${s.id}">${{ P: 'PRIMARY', S: 'SECONDARY', B: 'BACKGROUND' }[s.hier]}</button></td>
            <td class="notes">${s.notes.map((n) => `<div class="${n.type === 'warn' ? 'warn' : ''}">${UI.esc(n.text)}</div>`).join('')}${s.alts && s.alts.length && s.conf < 0.85 ? `<div class="dim tiny">Alternativas: ${s.alts.slice(0, 2).map((a) => a.role).join(', ')}</div>` : ''}</td>
            <td><button class="btn icon sm ghost" data-rm="${s.id}" title="${s.removed ? 'Repor' : 'Remover da sessão'}">${UI.icon(s.removed ? 'undo' : 'trash')}</button></td>
          </tr>`).join('')}</tbody></table>
        </div>
        <div class="panel p" style="position:sticky;top:0">
          <div class="eyebrow">Visão geral da sessão</div>
          <div class="kv" style="margin-top:14px">
            <div><div class="k">Género</div><div class="v" style="font-size:17px"><select class="field" id="genreSel" style="height:32px;font-family:var(--mono);font-size:14px;padding-left:8px">${Object.keys(MM.GENRES).map((g) => `<option ${g === m.genre ? 'selected' : ''}>${g}</option>`).join('')}</select></div><div class="dim tiny" style="margin-top:3px">${Math.round(m.genreConf * 100)} % · ${m.genreSource === 'treino' ? 'reconhecido pelo treino' : m.genreSource === 'manual' ? 'escolhido por ti' : 'alt. ' + m.genreAlts.slice(0, 2).join(', ')}</div>${(() => { const p = MM.styles && MM.styles.profile(m.genre); return p ? `<div class="tiny acc-t" style="margin-top:3px">Perfil aprendido · ${p.n} ${p.n === 1 ? 'música' : 'músicas'}</div>` : `<div class="tiny dim" style="margin-top:3px"><a data-view="styles" style="cursor:pointer;color:var(--acc)">Treinar este estilo</a></div>`; })()}</div>
            <div><div class="k">BPM</div><div class="v">${m.bpm}</div></div>
            <div><div class="k">Tom</div><div class="v" style="font-size:18px">${m.key}</div></div>
            <div><div class="k">Compasso</div><div class="v">${m.meter}</div></div>
            <div><div class="k">Duração</div><div class="v">${D.fmtTime(m.duration).slice(0, 5)}</div></div>
            <div><div class="k">Stems</div><div class="v">${act.length}</div></div>
          </div>
          ${m.styleSuggestion && m.styleSuggestion.all ? `<div class="small muted" style="margin-top:12px">Pelo treino: ${m.styleSuggestion.all.map((x) => `<button class="chip" data-sug-style="${UI.esc(x.style)}" style="height:24px;font-size:12px;margin:2px">${UI.esc(x.style)} ${Math.round(x.p * 100)}%</button>`).join('')}</div>` : ''}
          <div class="sections-bar" style="margin-top:16px">${m.sections.map((s, i) => `<div class="${/Refr/.test(s.name) ? 'hi' : ''}" style="flex:${s.end - s.start}" title="${s.name} · ${D.fmtTime(s.start).slice(0, 5)}" data-sec="${i}"></div>`).join('')}</div>
          <div class="sections-lbl">${m.sections.map((s) => `<span style="flex:${s.end - s.start}">${UI.esc(s.name.replace('Verso ', 'V').replace('Refrão final', 'Ref. final').replace('Refrão', 'Ref.'))}</span>`).join('')}</div>
          <div class="row wrap" style="margin-top:16px">
            <button class="chip solid on">${m.genre}</button>
            ${Object.keys(MM.AESTHETICS).map((a) => `<button class="chip ${st.aesthetics.includes(a) ? 'on' : ''}" data-aes="${a}">${a}</button>`).join('')}
          </div>
          <div class="hr"></div>
          <div class="row" style="justify-content:space-between;margin-bottom:12px"><div class="eyebrow">Direção da mistura</div><span class="small muted"><span style="display:inline-block;width:9px;height:9px;border:1.5px dashed var(--acc);border-radius:50%;vertical-align:-1px"></span> proposta da IA</span></div>
          ${MM.DIR.map(([k, a, b]) => `<div class="dirrow"><div class="lbl"><span>${a}</span><span>${b}</span></div><div class="track"><input type="range" min="0" max="100" value="${st.direction[k]}" data-dir="${k}">${st.directionAI ? `<div class="ai-mark" style="left:calc(8px + (100% - 16px) * ${st.directionAI[k] / 100})"></div>` : ''}</div></div>`).join('')}
          ${st.directionReasons && st.directionReasons.length ? `<div class="small muted" style="margin:-4px 0 12px">${st.directionReasons.map(UI.esc).join(' ')}</div>` : ''}
          <div class="hr"></div>
          <div class="row" style="justify-content:space-between"><span>Influência da referência</span><span class="mono" id="refInfV">${Math.round(st.refInfluence * 100)} %</span></div>
          <input type="range" min="0" max="100" value="${Math.round(st.refInfluence * 100)}" id="refInf">
          <div class="row small muted" style="justify-content:space-between"><span>Ignorar</span><span>${st.refs.length ? UI.esc((st.refs.find((r) => r.id === st.activeRef) || st.refs[0]).name) + ' · aproximar' : 'Sem referência — <a data-view="refs" style="color:var(--acc);cursor:pointer">adicionar</a>'}</span></div>
          <button class="btn primary lg" style="width:100%;margin-top:20px" data-act="ai">${UI.icon('spark')}Iniciar AI Mix &amp; Master →</button>
          <div class="small dim" style="margin-top:8px;text-align:center">${app.ready() ? 'Voltar a correr respeita stems bloqueados e edições manuais.' : 'Podes ouvir a soma dos stems (Mix) desde já.'}</div>
        </div>
      </div>`;
    },
    mount(app, root) {
      const st = app.state;
      if (st.stage === 'analyzing') return;
      root.querySelectorAll('canvas[data-wf]').forEach((cv) => { const s = st.stems.find((x) => x.id === cv.dataset.wf); UI.drawWave(cv, s.peaks, UI.colorOf(s), { gap: true }); });
      root.querySelectorAll('[data-role]').forEach((sel) => (sel.onchange = () => app.change('Papel de ' + sel.value, () => {
        const s = st.stems.find((x) => x.id === sel.dataset.role);
        MM.setRole(st, s, sel.value); s.conf = 1; s.notes = s.notes.filter((n) => n.type !== 'warn'); s.notes.push({ type: 'info', text: 'Corrigido por ti' });
        s.manual.role = true;
      }, { rebuild: true })));
      root.querySelectorAll('[data-hier]').forEach((b) => (b.onclick = () => app.change('Hierarquia', () => {
        const s = st.stems.find((x) => x.id === b.dataset.hier);
        s.hier = { P: 'S', S: 'B', B: 'P' }[s.hier]; s.manual.hier = true;
      }, {})));
      root.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => app.change('Remover stem', () => {
        const s = st.stems.find((x) => x.id === b.dataset.rm); s.removed = !s.removed; MM.assignLabels(st);
      }, { rebuild: true })));
      root.querySelectorAll('[data-dir]').forEach((r) => {
        r.addEventListener('change', () => app.change('Direção ' + r.dataset.dir, () => { st.direction[r.dataset.dir] = +r.value; }, { refresh: false }));
      });
      root.querySelectorAll('[data-aes]').forEach((b) => (b.onclick = () => app.change('Preset ' + b.dataset.aes, () => {
        const a = b.dataset.aes, on = st.aesthetics.includes(a);
        st.aesthetics = on ? st.aesthetics.filter((x) => x !== a) : st.aesthetics.concat([a]);
        const pd = MM.proposeDirection(st); st.directionAI = pd.dir; st.direction = Object.assign({}, pd.dir); st.directionReasons = pd.reasons;
      }, {})));
      const gs = root.querySelector('#genreSel');
      if (gs) gs.onchange = () => app.change('Género ' + gs.value, () => {
        st.music.genre = gs.value; st.music.genreConf = 1; st.music.genreSource = 'manual';
        const pd = MM.proposeDirection(st); st.directionAI = pd.dir; st.direction = Object.assign({}, pd.dir); st.directionReasons = pd.reasons;
        const g = MM.GENRES[gs.value]; st.master.target = g.target; st.master.targetBase = g.target;
      }, {});
      root.querySelectorAll('[data-sug-style]').forEach((b) => (b.onclick = () => { gs.value = b.dataset.sugStyle; gs.onchange(); }));
      const ri = root.querySelector('#refInf');
      ri.oninput = () => (root.querySelector('#refInfV').textContent = ri.value + ' %');
      ri.onchange = () => app.change('Influência da referência', () => { st.refInfluence = ri.value / 100; }, { refresh: false });
      root.querySelector('#addStems').onclick = () => app.pickFiles();
      root.querySelectorAll('[data-sec]').forEach((d) => (d.onclick = () => { const s = st.music.sections[+d.dataset.sec]; app.ensureAudio().then(() => app.engine.seek(s.start)); }));
      root.querySelectorAll('[data-issue]').forEach((b) => (b.onclick = () => {
        const is = st.issues.find((x) => x.id === b.dataset.issue), s = st.stems.find((x) => x.id === is.stem), a = b.dataset.a;
        app.change('Resolver: ' + is.kind, () => {
          is.resolved = a;
          if (a === 'remove') { s.removed = true; MM.assignLabels(st); }
          if (a === 'keepfx') { MM.setRole(st, s, 'FX'); s.hier = 'B'; }
          if (a === 'align') {
            const other = st.stems.find((x) => x.id === s.pair);
            const len = Math.max(s.length, other.length);
            [s, other].forEach((x) => { if (x.length < len) { x.chs = x.chs.map((c) => { const n = new Float32Array(len); n.set(c); return n; }); x.length = len; x.buffer = MM.toAudioBuffer(x.chs, st.sampleRate); } });
          }
        }, { rebuild: true });
        UI.toast(a === 'align' ? 'Par L/R alinhado (comprimentos igualados).' : a === 'convert' ? 'Convertido para a sample rate do projeto.' : 'Resolvido.', 'ok');
      }));
    },
    onStep(app) {
      if (app.state.stage !== 'analyzing') return;
      const p = UI.$('#pctA'), b = UI.$('#barA'), s = UI.$('#stepsA'), l = UI.$('#liveStems');
      const t = totalProgress(app);
      if (p) p.textContent = Math.round(t * 100) + ' %';
      if (b) b.style.width = t * 100 + '%';
      if (s) s.innerHTML = stepsHTML(app);
      if (l) l.innerHTML = liveStems(app);
    },
  };
  function liveStems(app) {
    const st = app.state;
    if (!st.stems.length) return '<div class="muted">A preparar os ficheiros…</div>';
    return st.stems.slice(0, 16).map((s) => `<div class="row" style="padding:7px 0;border-bottom:1px solid var(--line)"><span style="width:9px;height:9px;border-radius:50%;background:${s.features ? UI.colorOf(s) : 'var(--dim)'}"></span><span class="mono small" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${UI.esc(s.name)}</span><span class="small ${s.features ? '' : 'dim'}">${s.features ? UI.esc(s.role) + ' · ' + Math.round(s.conf * 100) + '%' : '…'}</span></div>`).join('') + (st.stems.length > 16 ? `<div class="dim small" style="margin-top:8px">+ ${st.stems.length - 16} stems</div>` : '');
  }
})();
