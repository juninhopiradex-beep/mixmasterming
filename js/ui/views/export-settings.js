/* MixMind — vistas Exportar e Definições */
(function () {
  const MM = window.MM, D = MM.dsp, UI = MM.ui;
  const V = (MM.views = MM.views || {});

  const FORMATS = [
    { id: 'wav24', f: 'wav', bits: 24, name: 'WAV 24-bit', sub: 'Sem perdas · masters' },
    { id: 'wav16', f: 'wav', bits: 16, name: 'WAV 16-bit', sub: 'Com dither · CD' },
    { id: 'wav32', f: 'wav', bits: 32, name: 'WAV 32-bit float', sub: 'Sem limites · arquivo' },
    { id: 'aiff', f: 'aiff', bits: 24, name: 'AIFF 24-bit', sub: 'Sem perdas · Logic/Mac' },
    { id: 'flac', f: 'flac', bits: 24, name: 'FLAC', sub: 'Sem perdas · arquivo' },
    { id: 'mp3', f: 'mp3', bits: 16, name: 'MP3 320', sub: 'Pré-visualização' },
  ];
  const ITEMS = [
    ['master', 'Master final'], ['premaster', 'Mix sem master (premaster)'], ['stems', 'Stems processados'], ['instrumental', 'Instrumental'],
    ['acapella', 'Acapella'], ['tv', 'TV Mix (sem voz principal)'], ['performance', 'Performance Mix (sem voz principal e adlibs)'], ['report', 'Relatório de QC (HTML/PDF)'], ['session', 'Sessão MixMind (JSON)'],
  ];
  function opts(app) {
    const st = app.state;
    if (!app.exportOpts) {
      app.exportOpts = { fmt: 'wav24', sr: st.sampleRate === 44100 ? 44100 : 48000, items: { master: true, report: true }, plats: {}, name: '' };
    }
    if (app.exportPreset) {
      const p = app.exportPreset, o = app.exportOpts;
      if (p.bits === 16) o.fmt = 'wav16';
      if (p.sr) o.sr = p.sr;
      (p.platforms || []).forEach((x) => (o.plats[x] = true));
      app.exportPreset = null;
    }
    return app.exportOpts;
  }
  function fileBase(app) {
    const st = app.state, o = opts(app), f = FORMATS.find((x) => x.id === o.fmt);
    const proj = st.project.name.replace(/\(demo\)/i, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('').slice(0, 40) || 'MixMind';
    const ver = (st.currentVersionName || 'V1').replace(/^Mix /, '').replace(/[^\w]+/g, '');
    return o.name || `${proj}_Master_${ver}_${f.f === 'mp3' ? '320' : f.bits + 'b'}_${o.sr / 1000 === 44.1 ? '44k' : Math.round(o.sr / 1000) + 'k'}`;
  }

  V.export = {
    render(app) {
      const st = app.state, o = opts(app), f = FORMATS.find((x) => x.id === o.fmt);
      const dur = app.engine.duration();
      const bytes = f.f === 'mp3' ? (dur * 320000) / 8 : dur * o.sr * 2 * (f.bits / 8) * (f.f === 'flac' ? 0.62 : 1);
      const nStems = st.stems.filter((s) => !s.removed).length;
      const sizes = { master: bytes, premaster: bytes, stems: bytes * nStems, instrumental: bytes, acapella: bytes * 0.6, tv: bytes, performance: bytes, report: 30000, session: 200000 };
      const items = st.mode === 'master' ? ITEMS.filter(([k]) => ['master', 'premaster', 'report', 'session'].includes(k)) : ITEMS;
      const m = st.metrics.master, M = st.master;
      const qc = st.qc || [];
      const plats = MM.PLATFORMS.filter((p) => p.lufs !== null);
      const nFiles = Object.entries(o.items).filter(([k, v]) => v && items.some((i) => i[0] === k)).reduce((a, [k]) => a + (k === 'stems' ? nStems : 1), 0) + Object.values(o.plats).filter(Boolean).length;
      const total = Object.entries(o.items).filter(([k, v]) => v && sizes[k]).reduce((a, [k]) => a + sizes[k], 0) + Object.values(o.plats).filter(Boolean).length * bytes;
      return `<div style="display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:26px">
        <div>
          <h1>Exportar</h1><p class="muted" style="margin:6px 0 20px">Escolhe o formato, o que incluir e as versões por plataforma. O relatório de QC vai junto. Tudo é renderizado no teu computador, com o mesmo motor que estás a ouvir.</p>
          <div class="eyebrow">Formato</div>
          <div class="fmt" style="grid-template-columns:repeat(6,1fr);margin-top:10px">${FORMATS.map((x) => `<button data-fmt="${x.id}" class="${o.fmt === x.id ? 'on' : ''}"><b>${x.name}</b><small>${x.sub}</small></button>`).join('')}</div>
          <div class="row" style="margin-top:14px"><span class="muted">Sample rate</span><div class="seg acc">${[44100, 48000, 88200, 96000].map((r) => `<button data-sr="${r}" class="${o.sr === r ? 'on' : ''}" ${f.f === 'mp3' && r > 48000 ? 'disabled' : ''}>${(r / 1000).toString().replace('.', ',')} kHz</button>`).join('')}</div>${o.sr !== st.sampleRate ? `<span class="small dim">Render a ${(o.sr / 1000).toString().replace('.', ',')} kHz (o projeto corre a ${(st.sampleRate / 1000).toString().replace('.', ',')} kHz)</span>` : ''}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:24px">
            <div><div class="eyebrow">Incluir</div><div class="incl" style="margin-top:10px">${items.map(([k, l]) => `<label class="it ${o.items[k] ? 'on' : ''}"><span class="check"><input type="checkbox" data-it="${k}" ${o.items[k] ? 'checked' : ''}>${l}${k === 'stems' ? ` (${nStems})` : ''}</span><span>${UI.bytes(sizes[k])}</span></label>`).join('')}</div></div>
            <div><div class="eyebrow">Versões por plataforma</div>
              <table class="ptab" style="margin-top:6px">${plats.map((p) => { const diff = m ? p.lufs - m.lufs : 0; const near = Math.abs(diff) < 1; return `<tr><td><label class="check"><input type="checkbox" data-pl="${p.id}" ${o.plats[p.id] ? 'checked' : ''}><b>${p.name}</b></label></td><td>${UI.fmtNum(p.lufs, 0)} LUFS · ${UI.fmtNum(p.tp)} dBTP</td><td class="${near ? 'acc-t' : diff < -4 ? 'warn-t' : 'muted'}">${!m ? '' : near ? `Master atual (${UI.fmtNum(m.lufs)}) é adequado` : diff < 0 ? `Normaliza ${UI.fmtDb(diff)} dB${diff < -4 ? '; usar versão dedicada' : ''}` : `Sobe ${UI.fmtDb(diff)} dB${p.note ? ' · ' + p.note : ''}`}</td></tr>`; }).join('')}</table>
              <div class="small dim" style="margin-top:8px">Versões dedicadas são re-masterizadas ao alvo da plataforma (menos limiting), não apenas baixadas de volume.</div>
            </div>
          </div>
          <div class="eyebrow" style="margin-top:24px">Nome dos ficheiros</div>
          <input class="field mono" id="fname" style="margin-top:10px;height:44px" value="${UI.esc(fileBase(app))}.${f.f === 'flac' ? 'flac' : f.f}">
        </div>
        <div>
          <div class="eyebrow">Relatório de QC · pré-visualização</div>
          <div class="report" style="margin-top:12px">
            <h3>${UI.esc(st.project.name)}</h3><small>${UI.esc(st.currentVersionName || 'Mix')} · Master ${UI.esc(M.style)}${st.music.bpm ? ` · ${st.music.bpm} BPM · ${UI.esc(st.music.key)}` : ''}</small>
            ${m ? `<div class="g"><span>LUFS-I ${UI.fmtNum(m.lufs)}</span><span>TP ${UI.fmtNum(m.tp)} dBTP</span><span>LRA ${UI.fmtNum(m.lra)} LU</span><span>PLR ${UI.fmtNum(m.plr)} dB</span><span>Score ${st.score ? st.score.overall : '—'}</span><span>Corr ${(m.corr >= 0 ? '+' : '') + UI.fmtNum(m.corr, 2)}</span></div>
            <b style="font-size:13.5px">${qc.filter((q) => q.status === 'ok').length} verificações OK · ${qc.filter((q) => q.status !== 'ok').length} avisos</b><div><small>${qc.filter((q) => q.status !== 'ok').map((q) => UI.esc(q.title)).join(' · ') || 'Pronto a entregar.'}</small></div>` : '<p><small>Corre o AI Mix &amp; Master primeiro.</small></p>'}
          </div>
          <div class="row" style="justify-content:space-between;margin-top:16px"><span class="muted">Ficheiros</span><span class="mono">${nFiles} ficheiro${nFiles === 1 ? '' : 's'}${nFiles > 1 ? ' (ZIP)' : ''}</span></div>
          <div class="row" style="justify-content:space-between;margin-top:8px"><span class="muted">Tamanho estimado</span><span class="mono">${UI.bytes(total)}</span></div>
          <button class="btn primary lg" style="width:100%;margin-top:16px" id="doExport" ${app.ready() && nFiles ? '' : 'disabled'}>${UI.icon('download')}Exportar ${nFiles} ficheiro${nFiles === 1 ? '' : 's'}</button>
          <div id="expProg" style="margin-top:12px"></div>
          ${(st.exports || []).length ? `<div class="eyebrow" style="margin-top:28px">Exportações anteriores</div><div class="changes" style="margin-top:6px">${st.exports.slice().reverse().map((e) => `<div class="ln"><span>${UI.esc(e.name)}</span><span>${UI.esc(e.ver)} · ${UI.fmtNum(e.lufs)} LUFS</span></div>`).join('')}</div>` : ''}
        </div>
      </div>`;
    },
    mount(app, root) {
      const o = opts(app);
      root.querySelectorAll('[data-fmt]').forEach((b) => (b.onclick = () => { o.fmt = b.dataset.fmt; o.name = ''; if (o.fmt === 'mp3' && o.sr > 48000) o.sr = 48000; if (o.fmt === 'wav16' && !o.srTouched) o.sr = 44100; app.refresh(); }));
      root.querySelectorAll('[data-sr]').forEach((b) => (b.onclick = () => { o.sr = +b.dataset.sr; o.srTouched = true; o.name = ''; app.refresh(); }));
      root.querySelectorAll('[data-it]').forEach((c) => (c.onchange = () => { o.items[c.dataset.it] = c.checked; app.refresh(); }));
      root.querySelectorAll('[data-pl]').forEach((c) => (c.onchange = () => { o.plats[c.dataset.pl] = c.checked; app.refresh(); }));
      const fn = root.querySelector('#fname');
      fn.onchange = () => { o.name = fn.value.replace(/\.[a-z0-9]+$/i, ''); };
      root.querySelector('#doExport').onclick = () => V.export.run(app, root);
    },
    async run(app, root) {
      const st = app.state, o = opts(app), f = FORMATS.find((x) => x.id === o.fmt);
      if (app.busy) return;
      app.busy = true; app.renderTop();
      const prog = root.querySelector('#expProg'), btn = root.querySelector('#doExport');
      btn.classList.add('busy');
      const say = (t, p) => (prog.innerHTML = `<div class="row" style="justify-content:space-between"><span class="small">${UI.esc(t)}</span><span class="mono small muted">${Math.round(p * 100)} %</span></div><div class="bar" style="margin-top:6px"><i style="width:${p * 100}%"></i></div>`);
      const files = [];
      const base = fileBase(app);
      const ext = f.f === 'flac' ? 'flac' : f.f;
      const sr = o.sr;
      try {
        if (f.f === 'mp3') await MM.exporter.loadLame();
        const tasks = [];
        const sameSR = sr === st.sampleRate && !st.dirty.mix && !st.dirty.master && st.masterBuf;
        let premaster = null, master = null, masterMet = null;
        const needMaster = o.items.master || Object.values(o.plats).some(Boolean) || o.items.report;
        say('A preparar o render…', 0.02);
        if (st.mode === 'master') {
          premaster = sr === st.sampleRate ? st.premaster : await MM.resample(st.premaster, sr);
        }
        if (needMaster || o.items.premaster) {
          if (sameSR) { premaster = st.premasterBuf; master = st.masterBuf; masterMet = st.metrics.master; }
          else {
            if (st.mode !== 'master') { say('A renderizar o premaster…', 0.05); premaster = await MM.render(st, { out: 'premaster', sr, onProgress: (p) => say('A renderizar o premaster…', 0.05 + p * 0.25) }); }
            else if (!premaster) premaster = st.premaster;
            const pmL = D.loudness(D.channelsOf(premaster), sr).integrated;
            say('A masterizar…', 0.32);
            const res = await MM.masterize(st, premaster, { sr, premasterLufs: pmL, reuseGain: true, onProgress: (p) => say('A masterizar…', 0.32 + p * 0.2) });
            master = res.buffer; masterMet = res.metrics;
          }
        }
        const enc = async (buf, name, bitsOverride) => { const e = await MM.exporter.encode(buf, f.f, bitsOverride || f.bits); files.push({ name: name + '.' + e.ext, data: e.data, type: e.type }); };
        if (o.items.master) { say('A codificar o master…', 0.55); await enc(master, base); }
        if (o.items.premaster) { say('A codificar o premaster…', 0.58); await enc(premaster, base.replace('_Master_', '_Premaster_')); }
        const variants = [['instrumental', 'Instrumental', (s) => s.group !== 'vocals'], ['acapella', 'Acapella', (s) => s.group === 'vocals'], ['tv', 'TVMix', (s) => s.role !== 'Lead Vocal'], ['performance', 'PerformanceMix', (s) => s.role !== 'Lead Vocal' && s.role !== 'Adlibs']];
        let vi = 0;
        for (const [k, nm, filt] of variants) {
          vi++;
          if (!o.items[k] || st.mode === 'master') continue;
          say(`A renderizar ${nm}…`, 0.6 + vi * 0.04);
          const b = await MM.render(st, { out: 'master', sr, filter: filt });
          await enc(b, base.replace('_Master_', '_' + nm + '_'));
        }
        if (o.items.stems && st.mode !== 'master') {
          const ss = st.stems.filter((s) => !s.removed);
          for (let i = 0; i < ss.length; i++) {
            say(`A renderizar stems processados (${i + 1}/${ss.length})…`, 0.76 + (i / ss.length) * 0.12);
            const b = await MM.render(st, { out: 'premaster', sr, filter: (s) => s.id === ss[i].id });
            await enc(b, 'Stems/' + String(i + 1).padStart(2, '0') + '_' + ss[i].label.replace(/[^\w]+/g, ''));
          }
        }
        const plats = MM.PLATFORMS.filter((p) => o.plats[p.id]);
        for (let i = 0; i < plats.length; i++) {
          const p = plats[i];
          say(`Versão ${p.name} (${UI.fmtNum(p.lufs, 0)} LUFS)…`, 0.88 + (i / Math.max(1, plats.length)) * 0.08);
          const pmL = D.loudness(D.channelsOf(premaster), sr).integrated;
          const r = await MM.masterize(st, premaster, { sr, target: p.lufs, ceiling: p.tp, premasterLufs: pmL, temporary: true });
          await enc(r.buffer, base.replace('_Master_', '_' + p.name.replace(/\s/g, '') + '_'));
        }
        if (o.items.report && masterMet) { const qc = MM.exporter.qc(masterMet, st); files.push({ name: base.replace('_Master_', '_QC_') + '.html', data: MM.exporter.reportHTML(st, masterMet, qc), type: 'text/html' }); }
        if (o.items.session) {
          const snap = MM.snapshot(st);
          snap.stems.forEach((s) => delete s.header);
          files.push({ name: base.replace('_Master_', '_Sessao_') + '.mixmind.json', data: JSON.stringify({ app: 'MixMind', v: 1, project: st.project, music: Object.assign({}, st.music, { energyPerBar: undefined, vocalPerBar: undefined }), snapshot: snap }, (k, v) => (v instanceof Float32Array ? Array.from(v, (x) => +x.toFixed(3)) : v), 1), type: 'application/json' });
        }
        say('A empacotar…', 0.98);
        if (files.length === 1) MM.exporter.download(files[0].data, files[0].name, files[0].type);
        else MM.exporter.download(MM.exporter.zip(files.map((x) => ({ name: x.name, data: typeof x.data === 'string' ? x.data : x.data }))), base + '.zip', 'application/zip');
        st.exports = st.exports || [];
        st.exports.push({ name: files.length === 1 ? files[0].name : base + '.zip', ver: st.currentVersionName || '—', lufs: masterMet ? masterMet.lufs : 0, when: Date.now() });
        say(`Pronto: ${files.length} ficheiro${files.length === 1 ? '' : 's'}.`, 1);
        UI.toast(`Exportação concluída: ${files.length} ficheiro${files.length === 1 ? '' : 's'}${files.length > 1 ? ' em ZIP' : ''}.`, 'ok');
      } catch (e) {
        console.error(e); UI.toast('Erro na exportação: ' + e.message, 'err', 8000); prog.innerHTML = `<span class="bad-t small">${UI.esc(e.message)}</span>`;
      }
      btn.classList.remove('busy');
      app.busy = false; app.renderTop();
    },
  };

  // ================= DEFINIÇÕES =================
  V.settings = {
    render(app) {
      const st = app.state, s = st.settings, sec = app.setSec || 'ai';
      const seg = (key, opts2, cur) => `<div class="seg acc">${opts2.map(([v, l, dis]) => `<button data-set="${key}" data-v="${v}" class="${cur === v ? 'on' : ''}" ${dis ? 'disabled title="Em breve"' : ''}>${l}</button>`).join('')}</div>`;
      const gpu = !!navigator.gpu;
      let body = '';
      if (sec === 'ai') body = `<h2>Motor de IA</h2><p class="muted">Onde e como a análise corre.</p>
        <div class="setrow"><div><b>Processamento</b><small>Local: o áudio nunca sai do teu computador.</small></div>${seg('processing', [['local', 'Local'], ['server', 'Servidor privado', true]], s.processing)}</div>
        <div class="setrow"><div><b>Qualidade da análise</b><small>Mais qualidade demora mais, sobretudo em sessões com muitos stems.</small></div>${seg('quality', [['fast', 'Rápida'], ['balanced', 'Equilibrada'], ['max', 'Máxima']], s.quality)}</div>
        <div class="setrow"><div><b>Usar GPU</b><small>${gpu ? 'WebGPU disponível neste browser — reservado para os modelos de classificação neural.' : 'WebGPU não disponível neste browser; a análise DSP corre no CPU.'}</small></div>${seg('gpu', [['auto', 'Automático'], ['off', 'Desligado']], s.gpu)}</div>
        <div class="setrow"><div><b>Guarda contra over-processing</b><small>Limita quanto a IA pode mexer num stem sem a tua confirmação (EQ máx., nº de bandas, GR, saturação).</small></div>${seg('guard', [['conservative', 'Conservador'], ['normal', 'Normal'], ['free', 'Livre']], s.guard)}</div>
        <div class="setrow"><div><b>Limites atuais</b><small class="mono">EQ ±${MM.GUARD[s.guard].eq} dB · ${MM.GUARD[s.guard].bands} bandas · GR ≤ ${MM.GUARD[s.guard].gr} dB · saturação ≤ ${Math.round(MM.GUARD[s.guard].sat * 100)} %</small></div><span></span></div>`;
      if (sec === 'audio') body = `<h2>Áudio</h2><p class="muted">Motor Web Audio com processamento interno em 32-bit float.</p>
        <div class="setrow"><div><b>Sample rate do projeto</b><small>Definida pela placa de som; o export pode usar 44,1 / 48 / 88,2 / 96 kHz.</small></div><span class="mono">${app.engine.ctx ? (app.engine.ctx.sampleRate / 1000).toString().replace('.', ',') + ' kHz' : '—'}</span></div>
        <div class="setrow"><div><b>Latência de saída</b><small>Latência do browser + look-ahead do limiter (4 ms).</small></div><span class="mono">${app.engine.ctx ? Math.round(((app.engine.ctx.baseLatency || 0) + (app.engine.ctx.outputLatency || 0)) * 1000) + ' ms' : '—'}</span></div>
        <div class="setrow"><div><b>Saída de áudio</b><small>${typeof AudioContext !== 'undefined' && AudioContext.prototype.setSinkId ? 'Escolhe a interface de áudio.' : 'O teu browser não permite escolher a saída (usa a do sistema).'}</small></div>${typeof AudioContext !== 'undefined' && AudioContext.prototype.setSinkId ? '<select class="field" id="sink" style="width:260px"><option value="">Saída do sistema</option></select>' : '<span></span>'}</div>`;
      if (sec === 'privacy') body = `<h2>Privacidade</h2><p class="muted">O MixMind corre inteiramente no browser. Nenhum áudio é enviado para servidores.</p>
        <div class="setrow"><div><b>Projetos guardados neste computador</b><small>Guardados em IndexedDB (stems originais + decisões). Ficam só neste browser.</small></div><span class="mono">${app.recent.length}</span></div>
        <div id="projList">${app.recent.map((r) => `<div class="setrow"><div><b>${UI.esc(r.name)}</b><small>${new Date(r.updated).toLocaleString('pt-PT')} · ${r.mode === 'master' ? 'master' : r.n + ' stems'}</small></div><button class="btn sm ghost" data-delp="${r.id}">${UI.icon('trash')}Apagar</button></div>`).join('')}</div>`;
      if (sec === 'keys') body = `<h2>Idioma e atalhos</h2><p class="muted">Interface em Português (Portugal).</p><div class="kbdlist" style="margin-top:18px">${[['Play / pausa', 'Espaço'], ['Ouvir Original / Mix / Master / Ref', '1 · 2 · 3 · 4'], ['Loudness match', 'L'], ['Desfazer / Refazer', 'Ctrl+Z · Ctrl+Shift+Z'], ['Guardar versão', 'Ctrl+S'], ['Paleta de comandos', 'Ctrl+K'], ['Avançar / recuar 5 s (1 s com Shift)', '→ · ←'], ['Início', 'Home'], ['Mute / Solo do stem selecionado', 'M · S'], ['Fader / pan: fino', 'Shift + arrastar'], ['Fader / pan: valor da IA', 'Duplo clique']].map(([a, b]) => `<span>${a}</span><span class="kbd">${b}</span>`).join('')}</div>`;
      return `<div class="set"><div class="setnav"><div class="eyebrow" style="margin-bottom:12px">Definições</div>${[['ai', 'Motor de IA'], ['audio', 'Áudio'], ['privacy', 'Privacidade'], ['keys', 'Idioma e atalhos']].map(([k, l]) => `<a data-sec="${k}" class="${sec === k ? 'on' : ''}">${l}</a>`).join('')}</div><div>${body}</div></div>`;
    },
    mount(app, root) {
      root.querySelectorAll('[data-sec]').forEach((a) => (a.onclick = () => { app.setSec = a.dataset.sec; app.refresh(); }));
      root.querySelectorAll('[data-set]').forEach((b) => (b.onclick = () => { app.state.settings[b.dataset.set] = b.dataset.v; app.saveSoon(); app.refresh(); if (b.dataset.set === 'guard' && app.ready()) UI.toast('Novo limite aplicado na próxima execução do AI Mix & Master.', 'ok'); }));
      root.querySelectorAll('[data-delp]').forEach((b) => (b.onclick = async () => { if (await UI.confirm('Apagar projeto', 'Os stems e as decisões guardadas neste browser serão apagados.', 'Apagar')) { await MM.deleteProject(b.dataset.delp); app.recent = await MM.listProjects(); app.refresh(); } }));
      const sink = root.querySelector('#sink');
      if (sink && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        navigator.mediaDevices.enumerateDevices().then((ds) => { ds.filter((d) => d.kind === 'audiooutput').forEach((d) => { const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || 'Saída ' + d.deviceId.slice(0, 6); sink.appendChild(o); }); });
        sink.onchange = async () => { try { await app.ensureAudio(); await app.engine.ctx.setSinkId(sink.value); UI.toast('Saída de áudio alterada.', 'ok'); } catch (e) { UI.toast('Não foi possível mudar a saída: ' + e.message, 'err'); } };
      }
    },
  };
})();
