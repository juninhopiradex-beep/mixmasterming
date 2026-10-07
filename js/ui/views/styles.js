/* MIXMIND — vista "Estilos": biblioteca de treino por estilo */
(function () {
  const MM = window.MM, D = MM.dsp, UI = MM.ui;
  const V = (MM.views = MM.views || {});
  const S = MM.styles;
  const fmt = (v, d = 1) => (v === undefined || v === null || !isFinite(v) ? '—' : D.fmtNum(v, d));
  const STATUS = { pending: ['Pendente', 'warn'], analyzing: ['A analisar…', 'acc'], approved: ['Aprovada', 'ok'], rejected: ['Rejeitada', 'bad'] };

  function tiltOf(b) { return b ? (b[5] + b[6]) / 2 - (b[0] + b[1]) / 2 : 0; }
  function effects(name) {
    const p = S.profile(name);
    if (!p) return [];
    const out = [], st = p.stat;
    const g = MM.GENRES[name] || {};
    if (st.lufs) out.push(['Alvo de loudness', `${fmt(Math.round(D.lerp(g.target || -9, st.lufs.med, p.conf) * 2) / 2)} LUFS`, `mediana ${fmt(st.lufs.med)} (${fmt(st.lufs.p25)} a ${fmt(st.lufs.p75)})`]);
    if (p.bands7) {
      const dt = tiltOf(p.bands7) - tiltOf(MM.MASTER_TARGET_BANDS);
      out.push(['Curva tonal do master', dt > 0.5 ? 'mais brilhante' : dt < -0.5 ? 'mais quente' : 'neutra', `${D.fmtDb(dt)} dB agudos vs graves face à base`]);
    }
    if (st.plr) out.push(['Densidade', st.plr.med < 7.5 ? 'mais clipper e glue' : st.plr.med > 9.5 ? 'menos limiting' : 'normal', `PLR típico ${fmt(st.plr.med)} dB`]);
    if (st.width) out.push(['Largura', `${Math.round(st.width.med * 100)} % lado/centro`, st.wLow ? `graves ${st.wLow.med < 0.05 ? 'muito mono → mono < 140 Hz' : st.wLow.med < 0.12 ? 'mono < 120 Hz' : 'com algum estéreo'}` : '']);
    if (st.bpm) out.push(['Andamento', `${Math.round(st.bpm.min)}–${Math.round(st.bpm.max)} BPM`, `mediana ${Math.round(st.bpm.med)} — usado no reconhecimento do estilo`]);
    if (p.sections && p.sections.chorus) { const c = p.sections.chorus; out.push(['Refrão vs verso', `${c.lu >= 0 ? '+' : ''}${fmt(c.lu)} LU${c.width ? ` · largura ×${fmt(c.width, 2)}` : ''} · agudos ${D.fmtDb(c.bright)} dB`, `${p.sections.n} ${p.sections.n === 1 ? 'exemplo' : 'exemplos'} com estrutura — comanda a automação por secção`]); }
    if (p.balance) out.push(['Balanço dos stems', `${Object.keys(p.balance).length} papéis aprendidos`, `${p.nStems} sessão(ões) de stems pós-fader`]);
    const dd = S.directionDeltas(name, MM.MASTER_TARGET_BANDS);
    if (dd) {
      const parts = Object.entries(dd.d).filter(([, v]) => Math.abs(v) >= 2).map(([k, v]) => { const lab = MM.DIR.find((x) => x[0] === k); return `${v > 0 ? lab[2] : lab[1]} ${v > 0 ? '+' : '−'}${Math.round(Math.abs(v))}`; });
      out.push(['Direção da mistura', parts.length ? parts.join(' · ') : 'como a base', 'deslocamento dos macros quando o preset é escolhido']);
    }
    return out;
  }

  V.styles = {
    flush: true,
    render(app) {
      if (!S.loaded) return '<div class="empty-note">A carregar a biblioteca…</div>';
      const sel = app.styleSel && S.byId(app.styleSel) ? S.byId(app.styleSel) : S.list.find((s) => S.tracksOf(s.id).length) || S.byName('Kizomba') || S.list[0];
      app.styleSel = sel.id;
      const tracks = S.tracksOf(sel.id).sort((a, b) => b.added - a.added);
      const pend = tracks.filter((t) => t.status === 'pending');
      const p = S.profile(sel.name);
      const val = S.validation;
      const sorted = S.list.slice().sort((a, b) => (S.tracksOf(b.id).length - S.tracksOf(a.id).length) || a.name.localeCompare(b.name));
      const q = (app.styleQ || '').toLowerCase();
      return `<div class="refs" style="grid-template-columns:300px minmax(0,1fr) 400px">
        <div class="pad">
          <div class="row" style="justify-content:space-between"><div class="eyebrow">Estilos</div><button class="btn xs" id="newStyle">${UI.icon('plus')}Novo estilo</button></div>
          <input class="field" id="styleQ" placeholder="Procurar estilo…" value="${UI.esc(app.styleQ || '')}" style="margin:12px 0 10px;height:34px">
          <div class="stlist">${sorted.filter((s) => !q || s.name.toLowerCase().includes(q)).map((s) => {
            const t = S.tracksOf(s.id), a = t.filter((x) => x.status === 'approved').length, pe = t.filter((x) => x.status === 'pending').length, pr = S.profile(s.name);
            return `<div class="refcard ${s.id === sel.id ? 'on' : ''}" data-st="${s.id}" style="padding:10px 12px;margin-bottom:6px"><div class="row"><b style="font-size:14px">${UI.esc(s.name)}</b>${s.builtin ? '' : '<span class="tag">NOVO</span>'}<span class="spacer"></span><span class="mono small muted">${a}${pe ? ` · <span class="warn-t">${pe} pend.</span>` : ''}</span></div>
              <div class="bar" style="height:4px;margin-top:7px"><i style="width:${pr ? Math.round(pr.conf * 100) : 0}%"></i></div></div>`;
          }).join('')}</div>
          <div class="hr"></div>
          ${V.styles.engineerBlock(app)}
          <div class="hr"></div>
          ${V.styles.cloudBlock(app)}
          <div class="hr"></div>
          <div class="eyebrow">Classificador de estilos</div>
          <p class="small muted" style="margin-top:8px">${val ? `Precisão por validação cruzada: <b class="acc-t mono">${Math.round(val.acc * 100)} %</b> em ${val.n} músicas de ${Object.keys(val.per).length} estilos.` : 'Precisa de pelo menos 2 estilos com músicas aprovadas (idealmente 5+ por estilo) para reconhecer o estilo nas sessões.'}</p>
          ${val ? `<div class="changes">${Object.entries(val.per).map(([k, v]) => `<div class="ln"><span>${UI.esc(k)}</span><span>${v.ok}/${v.n}</span></div>`).join('')}</div>` : ''}
          <div class="row wrap" style="margin-top:14px"><button class="btn sm" id="expLib">${UI.icon('download')}Exportar biblioteca</button><button class="btn sm" id="impLib">${UI.icon('upload')}Importar</button></div>
          <p class="tiny dim" style="margin-top:8px">Para todos os utilizadores do site terem os estilos treinados, exporta a biblioteca e guarda-a no repositório como <span class="mono">styles/library.json</span>.</p>
        </div>
        <div class="c">
          <div class="row" style="justify-content:space-between;align-items:flex-start;gap:14px">
            <div><h1>${UI.esc(sel.name)}</h1><div class="muted" style="margin-top:4px">${sel.builtin ? 'Estilo de base' : 'Estilo criado por ti · base ' + UI.esc(sel.base)} · ${tracks.filter((t) => t.status === 'approved').length} aprovadas · ${pend.length} pendentes</div></div>
            <div class="row wrap" style="justify-content:flex-end">
              ${app.hasSession() ? `<button class="btn sm acc" id="useStyle">${UI.icon('spark')}Usar na sessão atual</button>` : ''}
              ${app.ready() ? `<button class="btn sm" id="addSession" title="Adiciona o master atual (e o teu balanço dos stems) como exemplo aprovado deste estilo">${UI.icon('plus')}Adicionar o master atual</button>` : ''}
              ${sel.builtin ? '' : `<button class="btn sm ghost" id="delStyle">${UI.icon('trash')}Apagar estilo</button>`}
            </div>
          </div>
          <div class="grid2" style="margin-top:18px">
            <div class="drop" data-refdrop data-kind="master" style="margin:0;padding:22px 16px"><div class="up" style="width:42px;height:42px">${UI.icon('music')}</div><b>Músicas finais (masters)</b><div class="small muted" style="margin:4px 0 10px">Arrasta várias músicas de ${UI.esc(sel.name)} — WAV, FLAC, MP3. Uma música = um exemplo.</div><button class="btn sm" id="pickMasters">${UI.icon('plus')}Escolher músicas</button></div>
            <div class="drop" data-refdrop data-kind="stems" style="margin:0;padding:22px 16px"><div class="up" style="width:42px;height:42px">${UI.icon('layers')}</div><b>Stems pós-fader (uma sessão)</b><div class="small muted" style="margin:4px 0 10px">Pasta com os stems já misturados (bounce com fader). Ensina o balanço entre instrumentos.</div><button class="btn sm" id="pickStems">${UI.icon('folder')}Escolher pasta</button></div>
          </div>
          <div class="row" style="justify-content:space-between;margin:20px 0 8px">
            <label class="check small"><input type="checkbox" id="autoAp" ${S.settings.autoApprove ? 'checked' : ''}>Aprovar automaticamente o que eu carrego</label>
            <div class="row">${pend.length ? `<button class="btn primary sm" id="approveAll">${UI.icon('check')}Aprovar e analisar ${pend.length}</button>` : ''}</div>
          </div>
          <div id="stProg"></div>
          ${tracks.length ? `<table class="stbl"><thead><tr><th>Exemplo</th><th>Estado</th><th>LUFS</th><th>PLR</th><th>BPM</th><th>Largura</th><th>Tom</th><th></th></tr></thead><tbody>
            ${tracks.map((t) => { const f = t.features, [lab, cl] = STATUS[t.status] || ['?', '']; return `<tr><td><b style="font-size:13.5px">${UI.esc(t.name)}</b><div class="tiny dim">${t.kind === 'stems' ? `stems · ${t.files.length} ficheiros` : t.source === 'session' ? 'master da sessão' : t.shipped ? 'biblioteca publicada' : 'master'}${t.size ? ' · ' + UI.bytes(t.size) : ''}${t.error ? ` · <span class="bad-t">${UI.esc(t.error)}</span>` : ''}</div></td>
              <td><span class="small ${cl}-t">${lab}</span></td>
              <td class="mono small">${f && !f.fromStems ? fmt(f.lufs) : '—'}</td><td class="mono small">${f && !f.fromStems ? fmt(f.plr) : '—'}</td><td class="mono small">${f && f.bpm ? f.bpm : '—'}</td><td class="mono small">${f ? Math.round(f.width * 100) + ' %' : '—'}</td><td class="mono small">${f ? D.fmtDb(tiltOf(f.bands7)) : '—'}</td>
              <td style="white-space:nowrap">${t.status === 'pending' ? `<button class="btn xs acc" data-ap="${t.id}">Aprovar</button> <button class="btn xs ghost" data-rj="${t.id}">Rejeitar</button>` : ''}<button class="btn icon xs ghost" data-rm="${t.id}" title="Remover">${UI.icon('trash')}</button></td></tr>`; }).join('')}</tbody></table>`
            : `<div class="empty-note">Ainda sem exemplos de ${UI.esc(sel.name)}. Carrega 5 a 20 músicas bem masterizadas deste estilo — quanto mais, melhor o perfil.</div>`}
          <p class="small dim" style="margin-top:14px">Privacidade: nada é analisado enquanto estiver pendente. Ao aprovares, a IA mede a música e apaga o áudio — ficam só as medidas (curva tonal, loudness, dinâmica, estéreo, tempo).</p>
        </div>
        <div class="pad">
          <div class="row" style="justify-content:space-between"><div class="eyebrow">Perfil aprendido</div>${p ? `<span class="small muted">confiança <b class="mono ${p.conf > 0.7 ? 'acc-t' : 'warn-t'}">${Math.round(p.conf * 100)} %</b></span>` : ''}</div>
          ${p ? `
            ${p.curve31 ? `<canvas id="stCurve" style="width:100%;height:170px;display:block;margin-top:12px;border:1px solid var(--line);border-radius:10px;background:rgba(0,0,0,.25)"></canvas><div class="row tiny muted" style="gap:14px;margin-top:6px"><span><span style="display:inline-block;width:16px;border-top:2px solid var(--acc);vertical-align:3px"></span> ${UI.esc(sel.name)} (média ± desvio)</span><span><span style="display:inline-block;width:16px;border-top:2px dashed #9aa3b4;vertical-align:3px"></span> base</span></div>` : ''}
            <div class="kv" style="margin-top:16px">${[['LUFS', p.stat.lufs && fmt(p.stat.lufs.med)], ['PLR', p.stat.plr && fmt(p.stat.plr.med)], ['LRA', p.stat.lra && fmt(p.stat.lra.med)], ['Largura', p.stat.width && Math.round(p.stat.width.med * 100) + '%'], ['Graves mono', p.stat.monoLow && Math.round(p.stat.monoLow.med) + '%'], ['BPM', p.stat.bpm && Math.round(p.stat.bpm.med)]].map(([k, v]) => `<div><div class="k">${k}</div><div class="v" style="font-size:18px">${v || '—'}</div></div>`).join('')}</div>
            <div class="eyebrow" style="margin-top:22px">O que muda quando escolhem ${UI.esc(sel.name)}</div>
            <div class="changes" style="margin-top:6px">${effects(sel.name).map(([a, b, c]) => `<div class="ln" style="display:block"><div class="row" style="justify-content:space-between"><span>${a}</span><b class="mono small">${UI.esc(b)}</b></div><div class="tiny dim">${UI.esc(c)}</div></div>`).join('')}</div>
            ${p.sections && p.sections.roles && Object.keys(p.sections.roles).length ? `<div class="eyebrow" style="margin-top:22px">Refrão face ao verso, por instrumento (aprendido)</div><div class="changes" style="margin-top:6px">${p.sections.vocal ? `<div class="ln"><span>Voz vs instrumental</span><span>${D.fmtDb(p.sections.vocal.med)} dB · n=${p.sections.vocal.n}</span></div>` : ''}${Object.entries(p.sections.roles).sort((a, b) => b[1].med - a[1].med).map(([r, v]) => `<div class="ln"><span>${UI.esc(r)}</span><span>${D.fmtDb(v.med)} dB · n=${v.n}</span></div>`).join('')}</div><div class="small dim" style="margin-top:6px">A IA compara com o arranjo dos teus stems e só automatiza a diferença.</div>` : ''}
            ${p.balance ? `<div class="eyebrow" style="margin-top:22px">Balanço aprendido (LU vs voz)</div><div class="changes" style="margin-top:6px">${Object.entries(p.balance).sort((a, b) => b[1].med - a[1].med).map(([r, b]) => `<div class="ln"><span>${UI.esc(r)}</span><span>${D.fmtDb(b.med)} dB · n=${b.n}${b.spread !== null ? ' · ±' + fmt(b.spread / 2) : ''}</span></div>`).join('')}</div>` : ''}
          ` : `<p class="muted" style="margin-top:12px">Sem perfil ainda. Enquanto não houver músicas aprovadas, ${UI.esc(sel.name)} usa as regras de base da IA${sel.builtin ? '' : ` (herdadas de ${UI.esc(sel.base)})`}.</p>`}
        </div>
      </div>`;
    },
    mount(app, root) {
      if (!S.loaded) { S.load().then(() => { S.loaded = true; app.refresh(); }); return; }
      const sel = S.byId(app.styleSel);
      root.querySelectorAll('[data-st]').forEach((c) => (c.onclick = () => { app.styleSel = c.dataset.st; app.refresh(); }));
      const sq = root.querySelector('#styleQ');
      sq.oninput = UI.debounce(() => { app.styleQ = sq.value; app.refresh(); setTimeout(() => { const e = document.getElementById('styleQ'); if (e) { e.focus(); e.setSelectionRange(e.value.length, e.value.length); } }, 0); }, 250);
      root.querySelector('#newStyle').onclick = () => {
        UI.modal(`<div class="modal"><h2>Novo estilo</h2><p class="muted" style="margin:8px 0 16px">Ex.: Afro House, Ghetto Zouk, Kuduro moderno… Escolhe a base mais parecida: enquanto o estilo não tiver músicas suficientes, a IA usa as regras da base.</p>
          <label class="small muted">Nome</label><input class="field" id="nsName" style="margin:6px 0 12px" placeholder="Nome do estilo">
          <label class="small muted">Base</label><select class="field" id="nsBase" style="margin-top:6px">${MM.BUILTIN_GENRES.map((g) => `<option>${g}</option>`).join('')}</select>
          <div class="row" style="justify-content:flex-end;margin-top:18px"><button class="btn ghost" data-x>Cancelar</button><button class="btn primary" data-ok>Criar</button></div></div>`, (m, close) => {
          setTimeout(() => m.querySelector('#nsName').focus(), 10);
          m.querySelector('[data-x]').onclick = close;
          m.querySelector('[data-ok]').onclick = async () => {
            try { const st = await S.createStyle(m.querySelector('#nsName').value, m.querySelector('#nsBase').value); close(); app.styleSel = st.id; app.refresh(); UI.toast(`Estilo “${st.name}” criado.`, 'ok'); }
            catch (e) { UI.toast(e.message, 'warn'); }
          };
        });
      };
      const add = async (files, kind) => {
        files = Array.from(files).filter((f) => /\.(wav|wave|aif|aiff|flac|mp3|m4a|ogg)$/i.test(f.name));
        if (!files.length) { UI.toast('Nenhum ficheiro de áudio.', 'warn'); return; }
        const items = await S.addItem(sel.id, files, kind);
        UI.toast(`${items.length} ${kind === 'stems' ? 'sessão de stems' : items.length === 1 ? 'música' : 'músicas'} adicionada(s) a ${sel.name} — ${S.settings.autoApprove ? 'a analisar' : 'pendente(s) de aprovação'}.`, 'ok');
        app.refresh();
        if (S.settings.autoApprove) V.styles.approveQueue(app, items.map((t) => t.id));
      };
      root.querySelector('#pickMasters').onclick = () => app.pickFiles({ multiple: true, onFiles: (f) => add(f, 'master') });
      root.querySelector('#pickStems').onclick = () => app.pickFiles({ dir: true, onFiles: (f) => add(f, 'stems') });
      root.querySelectorAll('[data-refdrop]').forEach((dz) => {
        dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('over'));
        dz.addEventListener('drop', async (e) => { e.preventDefault(); dz.classList.remove('over'); add(await app.filesFromDrop(e.dataTransfer), dz.dataset.kind); });
      });
      root.querySelector('#autoAp').onchange = (e) => { S.settings.autoApprove = e.target.checked; S.saveSettings(); };
      const aa = root.querySelector('#approveAll'); if (aa) aa.onclick = () => V.styles.approveQueue(app, S.tracksOf(sel.id).filter((t) => t.status === 'pending').map((t) => t.id));
      root.querySelectorAll('[data-ap]').forEach((b) => (b.onclick = () => V.styles.approveQueue(app, [b.dataset.ap])));
      root.querySelectorAll('[data-rj]').forEach((b) => (b.onclick = async () => { await S.reject(b.dataset.rj); app.refresh(); }));
      root.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => { await S.removeTrack(b.dataset.rm); app.refresh(); }));
      const ds = root.querySelector('#delStyle');
      if (ds) ds.onclick = async () => { if (await UI.confirm('Apagar estilo', `“${sel.name}” e os seus exemplos serão apagados desta biblioteca.`, 'Apagar')) { await S.deleteStyle(sel.id); app.styleSel = null; app.refresh(); } };
      const us = root.querySelector('#useStyle');
      if (us) us.onclick = () => {
        const st = app.state;
        app.change('Estilo ' + sel.name, () => {
          st.music.genre = sel.name; st.music.genreConf = 1; st.music.genreSource = 'manual';
          const pd = MM.proposeDirection(st); st.directionAI = pd.dir; st.direction = Object.assign({}, pd.dir); st.directionReasons = pd.reasons;
          const g = MM.GENRES[sel.name]; if (g) { st.master.target = g.target; st.master.targetBase = g.target; delete st.master.manual.target; }
        }, { refresh: false });
        UI.toast(`Sessão agora em ${sel.name}. Corre o AI Mix & Master para aplicar o perfil.`, 'ok');
        app.go('import');
      };
      const as = root.querySelector('#addSession');
      if (as) as.onclick = async () => { as.classList.add('busy'); try { await S.addFromSession(sel.id, app.state); UI.toast(`Master atual adicionado a ${sel.name} como exemplo aprovado.`, 'ok'); } catch (e) { UI.toast(e.message, 'err'); } app.refresh(); };
      root.querySelector('#expLib').onclick = () => { const lib = S.exportLibrary(); if (!lib.styles.length) { UI.toast('Ainda não há estilos treinados para exportar.', 'warn'); return; } MM.exporter.download(JSON.stringify(lib, null, 1), 'library.json', 'application/json'); };
      root.querySelector('#impLib').onclick = () => {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
        inp.onchange = async () => { try { const r = await S.importLibrary(JSON.parse(await inp.files[0].text())); UI.toast(`Importado: ${r.styles} estilo(s) novo(s), ${r.tracks} exemplo(s).`, 'ok'); app.refresh(); } catch (e) { UI.toast(e.message, 'err'); } };
        inp.click();
      };
      V.styles.bindEngineer(app, root);
      V.styles.bindCloud(app, root);
      V.styles.drawCurve(root, sel);
    },
    // ---------- modelo do engenheiro ----------
    engineerBlock(app) {
      const E = MM.engineer; if (!E) return '';
      const M = E.model, nS = E.sessions.length;
      const row = (lab, o, unit) => o ? `<div class="ln"><span>${lab}</span><span class="mono small ${o.gain > 0.1 ? 'acc-t' : 'dim'}" style="white-space:nowrap">±${fmt(o.cv.model)} <span class="dim">/ regra ±${fmt(o.cv.base)} ${unit}</span></span></div>` : '';
      const eqAvg = M && M.outs.d0 ? { cv: { model: D.mean([0, 1, 2, 3, 4, 5, 6].map((k) => M.outs['d' + k] ? M.outs['d' + k].cv.model : 0)), base: D.mean([0, 1, 2, 3, 4, 5, 6].map((k) => M.outs['d' + k] ? M.outs['d' + k].cv.base : 0)) }, gain: D.mean([0, 1, 2, 3, 4, 5, 6].map((k) => M.outs['d' + k] ? M.outs['d' + k].gain : 0)) } : null;
      return `<div class="row" style="justify-content:space-between"><div class="eyebrow">Modelo do engenheiro</div><label class="check tiny"><input type="checkbox" id="engUse" ${E.settings.use ? 'checked' : ''}>usar na IA</label></div>
        <p class="small muted" style="margin-top:8px">${M ? `Treinado com <b>${M.sessions}</b> sessões · ${M.samples} stems do teu arquivo. Erro em sessões que o modelo não viu:` : `Aprende como TU misturas: balanço, EQ e compressão. ${nS}/3 sessões (mínimo 3 para ativar).`}</p>
        ${M ? `<div class="changes">${row('Balanço', M.outs.bal, 'dB')}${row('EQ', eqAvg, 'dB')}${row('Compressão', M.outs.crest, 'dB')}</div><p class="tiny dim" style="margin-top:6px">Só pesa nas decisões onde bate a regra de base — e tanto mais quanto mais a bater.</p>` : ''}
        <div class="row wrap" style="margin-top:10px;gap:6px"><button class="btn sm acc" id="engArch">${UI.icon('folder')}Treinar com o meu arquivo</button>${app.ready() ? `<button class="btn sm" id="engCur" title="Usa os stems desta sessão e a tua mistura medida depois do processamento">${UI.icon('plus')}Esta sessão</button>` : ''}</div>
        <div class="row wrap" style="margin-top:6px;gap:6px">${nS ? `<button class="btn xs ghost" id="engList">Ver ${nS} sessões</button><button class="btn xs ghost" id="engExp">${UI.icon('download')}Exportar</button>` : ''}<button class="btn xs ghost" id="engImp">${UI.icon('upload')}Importar</button></div>
        <p class="tiny dim" style="margin-top:8px">Estrutura da pasta: <span class="mono">Arquivo/Música/raw/…</span> e <span class="mono">Arquivo/Música/mix/…</span> (stems brutos e os mesmos stems pós-fader, com nomes parecidos). Só ficam as medidas — o áudio não é guardado.</p>`;
    },
    bindEngineer(app, root) {
      const E = MM.engineer; if (!E) return;
      const u = root.querySelector('#engUse'); if (u) u.onchange = () => { E.settings.use = u.checked; E.saveSettings(); };
      const train = async (files) => {
        const sess = E.parseArchive(files);
        if (!sess.length) { UI.toast('Não encontrei sessões com pastas “raw” e “mix” (ou bruto / bounce / pós-fader).', 'warn', 6000); return; }
        const okGo = await UI.confirm('Treinar o modelo do engenheiro', `${sess.length} ${sess.length === 1 ? 'sessão' : 'sessões'} encontrada(s): ${sess.slice(0, 6).map((x) => `${UI.esc(x.name)} (${x.raw.length}/${x.mix.length})`).join(', ')}${sess.length > 6 ? '…' : ''}. Cada stem bruto é emparelhado com o misturado pelo nome e medido; o áudio não é guardado.`, 'Treinar');
        if (!okGo) return;
        await app.ensureAudio();
        const errs = [];
        for (let i = 0; i < sess.length; i++) {
          const say = (p) => { const el = document.getElementById('stProg'); if (el) el.innerHTML = `<div class="row" style="justify-content:space-between"><span class="small">Modelo do engenheiro: ${UI.esc(sess[i].name)} (${i + 1}/${sess.length})…</span><span class="mono small muted">${Math.round(p * 100)} %</span></div><div class="bar" style="margin:6px 0 12px"><i style="width:${p * 100}%"></i></div>`; };
          say(0);
          try { await E.addSession(sess[i], app.engine.ctx, say); } catch (e) { errs.push(e.message); }
        }
        app.refresh();
        UI.toast(E.model ? `Modelo treinado com ${E.model.sessions} sessões.${errs.length ? ' ' + errs.length + ' ignorada(s).' : ''}` : `Guardado. Faltam ${Math.max(0, 3 - E.sessions.length)} sessão(ões) para ativar.`, errs.length ? 'warn' : 'ok', 6000);
        if (errs.length) console.warn(errs);
      };
      const a = root.querySelector('#engArch'); if (a) a.onclick = () => app.pickFiles({ dir: true, onFiles: train });
      const c = root.querySelector('#engCur'); if (c) c.onclick = async () => { try { const r = await E.addCurrent(app.state); UI.toast(`Sessão adicionada ao modelo (${r.pairs} stems).`, 'ok'); app.refresh(); } catch (e) { UI.toast(e.message, 'warn'); } };
      const x = root.querySelector('#engExp'); if (x) x.onclick = () => MM.exporter.download(JSON.stringify(E.export()), 'mixmind-engineer-model.json', 'application/json');
      const im = root.querySelector('#engImp'); if (im) im.onclick = () => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json'; inp.onchange = async () => { try { const r = await E.import(JSON.parse(await inp.files[0].text())); UI.toast(`Importadas ${r.sessions} sessões.`, 'ok'); app.refresh(); } catch (e) { UI.toast(e.message, 'err'); } }; inp.click(); };
      const l = root.querySelector('#engList'); if (l) l.onclick = () => UI.modal(`<div class="modal" style="width:min(720px,94vw)"><h2>Sessões do modelo</h2><div style="max-height:60vh;overflow:auto;margin-top:12px">${E.sessions.slice().sort((p, q) => q.added - p.added).map((s2) => `<div class="setrow"><div><b>${UI.esc(s2.name)}</b><small>${s2.source === 'session' ? 'sessão MIXMIND' : 'arquivo'} · ${s2.pairs} stems${s2.vocal ? '' : ' · sem voz (sem balanço)'}${s2.unmatched && s2.unmatched.length ? ` · ${s2.unmatched.length} sem par: ${UI.esc(s2.unmatched.slice(0, 4).join(', '))}${s2.unmatched.length > 4 ? '…' : ''}` : ''}</small></div><button class="btn xs ghost" data-erm="${s2.id}">${UI.icon('trash')}</button></div>`).join('')}</div><div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-x>Fechar</button></div></div>`, (m, close) => {
        m.querySelector('[data-x]').onclick = close;
        m.querySelectorAll('[data-erm]').forEach((b) => (b.onclick = async () => { await E.removeSession(b.dataset.erm); b.closest('.setrow').remove(); app.refresh(); }));
      });
    },
    // ---------- backend para clientes (Supabase) ----------
    cloudBlock() {
      const C = MM.cloud; if (!C) return '';
      if (!C.on()) return `<div class="eyebrow">Clientes · portal de envio</div><p class="small muted" style="margin-top:8px">Desligado. Com um projeto Supabase gratuito, os clientes enviam músicas por <span class="mono">portal.html</span> e tu aprovas aqui.</p><button class="btn sm" id="clCfg" style="margin-top:6px">Configurar backend</button>`;
      const ses = C.session();
      return `<div class="row" style="justify-content:space-between"><div class="eyebrow">Clientes · portal de envio</div><a class="tiny" href="portal.html" target="_blank" rel="noopener">abrir portal ↗</a></div>
        <p class="small muted" style="margin-top:8px">Biblioteca partilhada: ${C.libraryError ? `<span class="warn-t">${UI.esc(C.libraryError)}</span>` : `${C.libraryRows || 0} exemplos`}. ${ses ? `Admin: <b>${UI.esc(ses.email)}</b>` : ''}</p>
        <div class="row wrap" style="gap:6px;margin-top:6px">${ses ? `<button class="btn sm acc" id="clRev">Rever envios pendentes</button><button class="btn xs ghost" id="clOut">Sair</button>` : `<button class="btn sm" id="clIn">Entrar como admin</button>`}<button class="btn xs ghost" id="clCfg">Configurar</button></div>`;
    },
    bindCloud(app, root) {
      const C = MM.cloud; if (!C) return;
      const cfg = root.querySelector('#clCfg');
      if (cfg) cfg.onclick = () => { const c = C.cfg(); UI.modal(`<div class="modal"><h2>Backend (Supabase)</h2><p class="muted" style="margin:8px 0 14px">Fica guardado só neste browser. Para todos os visitantes do site, põe os mesmos valores em <span class="mono">config.js</span>. Esquema da base de dados: <span class="mono">supabase/schema.sql</span>.</p>
          <label class="small muted">Project URL</label><input class="field" id="cu" value="${UI.esc(c.SUPABASE_URL)}" placeholder="https://xxxx.supabase.co" style="margin:6px 0 12px">
          <label class="small muted">Chave anon public</label><input class="field" id="ck" value="${UI.esc(c.SUPABASE_ANON_KEY)}" style="margin-top:6px">
          <div class="row" style="justify-content:space-between;margin-top:18px"><button class="btn ghost" data-clear>Limpar</button><div class="row"><button class="btn ghost" data-x>Cancelar</button><button class="btn primary" data-ok>Guardar</button></div></div></div>`, (m, close) => {
        m.querySelector('[data-x]').onclick = close;
        m.querySelector('[data-clear]').onclick = () => { C.saveLocal(null); C.logout(); close(); app.refresh(); };
        m.querySelector('[data-ok]').onclick = async () => { C.saveLocal({ SUPABASE_URL: m.querySelector('#cu').value.trim(), SUPABASE_ANON_KEY: m.querySelector('#ck').value.trim(), BUCKET: c.BUCKET }); close(); const n = await C.loadLibrary(); app.refresh(); UI.toast(C.libraryError ? 'Guardado, mas a biblioteca não respondeu: ' + C.libraryError : `Ligado. ${n} exemplo(s) novos da biblioteca partilhada.`, C.libraryError ? 'warn' : 'ok'); };
      }); };
      const li = root.querySelector('#clIn');
      if (li) li.onclick = () => UI.modal(`<div class="modal"><h2>Entrar como admin</h2><p class="muted" style="margin:8px 0 14px">Utilizador criado em Supabase → Authentication, com o email na tabela <span class="mono">admins</span>.</p>
          <input class="field" id="le" type="email" placeholder="email" style="margin-bottom:10px"><input class="field" id="lp" type="password" placeholder="palavra-passe">
          <div class="row" style="justify-content:flex-end;margin-top:18px"><button class="btn ghost" data-x>Cancelar</button><button class="btn primary" data-ok>Entrar</button></div></div>`, (m, close) => {
        m.querySelector('[data-x]').onclick = close;
        m.querySelector('[data-ok]').onclick = async () => { try { await C.login(m.querySelector('#le').value.trim(), m.querySelector('#lp').value); close(); app.refresh(); UI.toast('Sessão de admin iniciada.', 'ok'); } catch (e) { UI.toast('Não entrou: ' + e.message, 'err'); } };
      });
      const lo = root.querySelector('#clOut'); if (lo) lo.onclick = () => { C.logout(); app.refresh(); };
      const rv = root.querySelector('#clRev'); if (rv) rv.onclick = () => V.styles.reviewModal(app);
    },
    async reviewModal(app) {
      const C = MM.cloud, S = MM.styles;
      let subs;
      try { subs = await C.listSubmissions('pending'); } catch (e) { UI.toast('Não foi possível ler os envios: ' + e.message, 'err'); if (e.status === 401) { C.logout(); app.refresh(); } return; }
      const opts = (cur) => S.list.slice().sort((a, b) => a.name.localeCompare(b.name)).map((st) => `<option value="${st.id}" ${st.name === cur ? 'selected' : ''}>${UI.esc(st.name)}</option>`).join('') + (S.byName(cur) ? '' : `<option value="new:${UI.esc(cur)}" selected>${UI.esc(cur)} (novo estilo)</option>`);
      UI.modal(`<div class="modal" style="width:min(880px,95vw)"><h2>Envios pendentes · ${subs.length}</h2><p class="muted" style="margin:6px 0 12px">Aprovar = descarregar, analisar aqui, publicar só as medidas na biblioteca partilhada e apagar o áudio do servidor. Rejeitar apaga o áudio.</p>
        <div style="max-height:62vh;overflow:auto">${subs.length ? subs.map((x) => `<div class="setrow" data-sub="${x.id}" style="align-items:flex-start"><div style="min-width:0"><b>${UI.esc(x.title)}</b><small>${UI.esc(x.client_name)} · ${UI.esc(x.client_email)} · ${new Date(x.created_at).toLocaleString('pt-PT')} · ${x.kind === 'stems' ? 'stems' : 'master'} · ${x.files.length} ficheiro(s), ${UI.bytes(x.files.reduce((a, f) => a + (f.size || 0), 0))}${x.note ? ' · “' + UI.esc(x.note.slice(0, 140)) + '”' : ''}</small><div class="tiny dim" data-st></div></div>
          <div class="row" style="gap:6px;flex-shrink:0"><select class="field" data-style style="width:170px;height:32px">${opts(x.style)}</select><button class="btn xs acc" data-apv>Aprovar</button><button class="btn xs ghost" data-rej>Rejeitar</button></div></div>`).join('') : '<div class="empty-note">Sem envios pendentes.</div>'}</div>
        <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-x>Fechar</button></div></div>`, (m, close) => {
        m.querySelector('[data-x]').onclick = () => { close(); app.refresh(); };
        m.querySelectorAll('[data-sub]').forEach((row) => {
          const sub = subs.find((x) => x.id === row.dataset.sub), say = (t) => (row.querySelector('[data-st]').textContent = t);
          const busy = (b) => row.querySelectorAll('button,select').forEach((e) => (e.disabled = b));
          row.querySelector('[data-apv]').onclick = async () => {
            busy(true);
            try {
              let sid = row.querySelector('[data-style]').value;
              if (sid.startsWith('new:')) sid = (await S.createStyle(sid.slice(4), 'Pop')).id;
              await app.ensureAudio();
              const out = await C.approve(sub, sid, app.engine.ctx, (p) => say(`A processar… ${Math.round(p * 100)} %`));
              say(`Aprovado: ${out.length} exemplo(s) publicados; áudio apagado do servidor.`); row.style.opacity = 0.55;
            } catch (e) { say('Erro: ' + e.message); busy(false); }
          };
          row.querySelector('[data-rej]').onclick = async () => { busy(true); try { await C.reject(sub); say('Rejeitado e áudio apagado.'); row.style.opacity = 0.55; } catch (e) { say('Erro: ' + e.message); busy(false); } };
        });
      });
    },
    drawCurve(root, sel) {
      const cv = root.querySelector('#stCurve'), p = S.profile(sel.name);
      if (!cv || !p || !p.curve31) return;
      const { ctx, w, h } = UI.fitCanvas(cv), F = S.THIRD;
      const x = (f) => 8 + (Math.log10(f / 25) / Math.log10(16000 / 25)) * (w - 16), y = (v) => h / 2 - (D.clamp(v, -30, 18) / 30) * (h / 2 - 10);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#626b7c'; ctx.font = '10px Geist Mono, monospace';
      [50, 200, 1000, 5000].forEach((f) => { ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(x(f), 0, 1, h); ctx.fillStyle = '#626b7c'; ctx.fillText(f >= 1000 ? f / 1000 + 'k' : f, x(f) + 3, h - 4); });
      // base: curva derivada do alvo de 7 bandas (pendente −4,5 dB/oit típica)
      ctx.setLineDash([5, 4]); ctx.strokeStyle = '#9aa3b4'; ctx.lineWidth = 1.4; ctx.beginPath();
      F.forEach((f, i) => { const v = -1.8 * Math.log2(f / 1000) * 1 - (f < 60 ? ((60 - f) / 40) ** 2 * 6 : 0) - (f > 12000 ? ((f - 12000) / 6000) ** 2 * 8 : 0); i ? ctx.lineTo(x(f), y(v)) : ctx.moveTo(x(f), y(v)); }); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath();
      F.forEach((f, i) => { const v = p.curve31[i] + p.curve31sd[i]; i ? ctx.lineTo(x(f), y(v)) : ctx.moveTo(x(f), y(v)); });
      for (let i = F.length - 1; i >= 0; i--) ctx.lineTo(x(F[i]), y(p.curve31[i] - p.curve31sd[i]));
      ctx.closePath(); ctx.fillStyle = 'rgba(94,234,212,.12)'; ctx.fill();
      ctx.strokeStyle = '#5eead4'; ctx.lineWidth = 2; ctx.beginPath();
      F.forEach((f, i) => { i ? ctx.lineTo(x(f), y(p.curve31[i])) : ctx.moveTo(x(f), y(p.curve31[i])); }); ctx.stroke();
    },
    async approveQueue(app, ids) {
      if (V.styles.busy) { V.styles.pending = (V.styles.pending || []).concat(ids); return; }
      V.styles.busy = true;
      await app.ensureAudio();
      const wasIdle = app.engine.ctx.state !== 'running';
      for (let i = 0; i < ids.length; i++) {
        const t = S.tracks.find((x) => x.id === ids[i]);
        if (!t || t.status !== 'pending') continue;
        t.status = 'analyzing';
        if (app.view === 'styles') app.refresh();
        const say = (p) => { const el = document.getElementById('stProg'); if (el) el.innerHTML = `<div class="row" style="justify-content:space-between"><span class="small">A analisar ${UI.esc(t.name)} (${i + 1}/${ids.length})…</span><span class="mono small muted">${Math.round(p * 100)} %</span></div><div class="bar" style="margin:6px 0 12px"><i style="width:${p * 100}%"></i></div>`; };
        say(0);
        await S.approve(t.id, app.engine.ctx, say);
      }
      V.styles.busy = false;
      if (wasIdle) app.engine.idle();
      const more = V.styles.pending; V.styles.pending = null;
      if (app.view === 'styles') app.refresh();
      UI.toast('Treino atualizado: perfis e classificador recalculados.', 'ok');
      if (more && more.length) V.styles.approveQueue(app, more);
    },
  };
})();
