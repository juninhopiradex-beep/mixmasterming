/* MixMind — vista "Estilos": biblioteca de treino por estilo */
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
          ${sorted.filter((s) => !q || s.name.toLowerCase().includes(q)).map((s) => {
            const t = S.tracksOf(s.id), a = t.filter((x) => x.status === 'approved').length, pe = t.filter((x) => x.status === 'pending').length, pr = S.profile(s.name);
            return `<div class="refcard ${s.id === sel.id ? 'on' : ''}" data-st="${s.id}" style="padding:10px 12px;margin-bottom:6px"><div class="row"><b style="font-size:14px">${UI.esc(s.name)}</b>${s.builtin ? '' : '<span class="tag">NOVO</span>'}<span class="spacer"></span><span class="mono small muted">${a}${pe ? ` · <span class="warn-t">${pe} pend.</span>` : ''}</span></div>
              <div class="bar" style="height:4px;margin-top:7px"><i style="width:${pr ? Math.round(pr.conf * 100) : 0}%"></i></div></div>`;
          }).join('')}
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
      V.styles.drawCurve(root, sel);
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
