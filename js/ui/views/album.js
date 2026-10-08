/* MIXMIND — vista Álbum · DDP: sequência, loudness coerente, pausas/fades, CUE e DDP 2.0 */
(function () {
  const MM = window.MM, D = MM.dsp, UI = MM.ui;
  const V = (MM.views = MM.views || {});
  const A = () => MM.album;
  const fmtT = (s) => D.fmtTime(s).slice(0, 5);

  const view = {
    async ensure(app) {
      if (app.albumList === undefined) app.albumList = await A().list();
      if (!app.albumCur && app.albumList.length) app.albumCur = await A().get(app.albumList[0].id);
    },
    render(app) {
      if (app.albumList === undefined) { view.ensure(app).then(() => app.curView === view && app.refresh()); return '<div class="empty-note">A carregar álbuns…</div>'; }
      const al = app.albumCur;
      const list = app.albumList;
      const side = `<aside class="pad" style="border-right:1px solid var(--line);overflow:auto">
        <div class="row" style="justify-content:space-between"><div class="eyebrow">Álbuns / EPs</div><button class="btn sm" data-al="new">+ Novo</button></div>
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:6px">${list.map((x) => `<button class="style-it ${al && al.id === x.id ? 'on' : ''}" data-alopen="${x.id}" style="text-align:left;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:${al && al.id === x.id ? 'var(--acc-bg)' : 'var(--panel)'}"><b>${UI.esc(x.name)}</b><div class="small dim">${x.n} ${x.n === 1 ? 'faixa' : 'faixas'}</div></button>`).join('') || '<div class="small muted">Ainda não tens álbuns. Cria um e junta masters (da sessão atual ou ficheiros WAV/FLAC).</div>'}</div>
        ${al ? `<div class="hr"></div><div class="eyebrow">Dados do disco</div>
          <div class="col" style="margin-top:10px;gap:8px">
            ${[['name', 'Título do álbum'], ['artist', 'Artista'], ['upc', 'UPC/EAN (código de barras)'], ['year', 'Ano'], ['label', 'Editora'], ['copyright', 'Copyright (℗)'], ['genre', 'Género']].map(([k, l]) => `<label class="mf"><span>${l}${k === 'upc' && al.upc ? (MM.delivery.validEAN(al.upc) ? ' <b class="acc-t">✓</b>' : ' <b class="bad-t">inválido</b>') : ''}</span><input class="field ${k === 'upc' ? 'mono' : ''}" data-alf="${k}" value="${UI.esc(al[k] || '')}"></label>`).join('')}
            <div class="row" style="gap:8px"><label class="mf" style="flex:1"><span>Alvo do álbum (LUFS)</span><input class="field mono" data-alf="target" placeholder="mediana" value="${al.target ?? ''}"></label><label class="mf" style="flex:1"><span>Ceiling (dBTP)</span><input class="field mono" data-alf="ceiling" value="${al.ceiling}"></label></div>
            <button class="btn sm ghost" data-al="del" style="margin-top:6px">Apagar álbum</button>
          </div>` : ''}
      </aside>`;
      if (!al) return `<div class="album">${side}<div class="pad"><h1>Álbum · DDP</h1><p class="muted" style="max-width:620px;margin-top:8px">Junta os masters de um EP ou álbum, iguala o loudness entre faixas, define pausas e fades, escreve ISRC e UPC e exporta masters individuais, WAV + CUE ou uma imagem DDP 2.0 para a fábrica de CD.</p><button class="btn primary lg" data-al="new" style="margin-top:18px">+ Criar álbum</button></div></div>`;
      const totSec = al.tracks.reduce((a, t, i) => a + t.duration + (i < al.tracks.length - 1 ? t.gapAfter || 0 : 0), 0) + 2;
      const lu = al.tracks.map((t) => A().effLufs(t));
      const spread = lu.length > 1 ? Math.max(...lu) - Math.min(...lu) : 0;
      const sess = app.hasSession() && app.state.masterBuf;
      return `<div class="album">${side}
        <div class="pad" style="overflow:auto">
          <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
            <div><h1 style="margin:0">${UI.esc(al.name)}</h1><div class="muted small" style="margin-top:4px">${al.tracks.length} faixas · ${fmtT(totSec)} com o pregap de 2 s${al.tracks.length ? ` · loudness ${UI.fmtNum(Math.min(...lu))} a ${UI.fmtNum(Math.max(...lu))} LUFS (diferença ${UI.fmtNum(spread)} LU)` : ''}</div></div>
            <div class="row" style="gap:8px;flex-wrap:wrap">
              <button class="btn sm ${sess ? 'acc' : ''}" data-al="addSession" ${sess ? '' : 'disabled title="Abre uma sessão e faz o master primeiro"'}>+ Master da sessão atual</button>
              <button class="btn sm" data-al="addFiles">+ Ficheiros (WAV, AIFF, FLAC, MP3)</button>
            </div>
          </div>
          ${al.tracks.length ? `<div style="overflow-x:auto;margin-top:16px"><table class="altab"><thead><tr><th>#</th><th>Título</th><th>Artista</th><th>ISRC</th><th>Duração</th><th title="loudness integrado depois do ganho">LUFS</th><th>TP</th><th title="ganho aplicado à faixa">Ganho</th><th title="intenção: ex. −2 LU numa balada">Intenção</th><th title="pausa depois da faixa">Pausa</th><th>Fade in/out</th><th></th></tr></thead><tbody>
            ${al.tracks.map((t, i) => { const tp = A().effTp(t); return `<tr>
              <td class="mono">${i + 1}</td>
              <td><input class="field" data-tf="title" data-ti="${i}" value="${UI.esc(t.title)}"></td>
              <td><input class="field" data-tf="artist" data-ti="${i}" value="${UI.esc(t.artist || '')}" placeholder="${UI.esc(al.artist || '')}"></td>
              <td><input class="field mono ${t.isrc && !MM.delivery.validISRC(t.isrc) ? 'bad' : ''}" data-tf="isrc" data-ti="${i}" value="${UI.esc(t.isrc ? MM.delivery.fmtISRC(t.isrc) : '')}" placeholder="AO-XXX-26-00001" style="width:150px"></td>
              <td class="mono">${fmtT(t.duration)}</td>
              <td class="mono">${UI.fmtNum(A().effLufs(t))}</td>
              <td class="mono ${tp > al.ceiling + 0.05 ? 'warn-t' : ''}">${UI.fmtNum(tp)}</td>
              <td><input class="field mono" data-tf="gain" data-ti="${i}" value="${UI.fmtNum(t.gain || 0)}" style="width:70px"></td>
              <td><input class="field mono" data-tf="intent" data-ti="${i}" value="${UI.fmtNum(t.intent || 0)}" style="width:64px"></td>
              <td>${i < al.tracks.length - 1 ? `<input class="field mono" data-tf="gapAfter" data-ti="${i}" value="${UI.fmtNum(t.gapAfter)}" style="width:60px">` : '<span class="dim small">fim</span>'}</td>
              <td class="row" style="gap:4px"><input class="field mono" data-tf="fadeIn" data-ti="${i}" value="${UI.fmtNum(t.fadeIn || 0)}" style="width:52px"><input class="field mono" data-tf="fadeOut" data-ti="${i}" value="${UI.fmtNum(t.fadeOut || 0)}" style="width:52px"></td>
              <td class="row" style="gap:2px"><button class="btn icon xs ghost" data-tplay="${i}" title="Ouvir a partir desta faixa">${UI.icon('play')}</button><button class="btn icon xs ghost" data-tup="${i}" title="Subir">${UI.icon('up')}</button><button class="btn icon xs ghost" data-tdn="${i}" title="Descer">${UI.icon('down')}</button><button class="btn icon xs ghost" data-tdel="${i}" title="Remover">✕</button></td>
            </tr>`; }).join('')}</tbody></table></div>
            <div class="cvbox" style="margin-top:18px"><canvas id="alChart" style="width:100%;height:150px;display:block"></canvas></div>`
          : '<div class="empty-note" style="margin-top:20px">Junta masters: arrasta ficheiros para aqui, ou usa os botões acima.</div>'}
        </div>
        <aside class="pad" style="border-left:1px solid var(--line);overflow:auto">
          <div class="eyebrow">Loudness do álbum</div>
          <p class="small muted" style="margin:8px 0 10px">Iguala as faixas ao alvo (mediana, se vazio) somando a intenção de cada uma. O ganho nunca passa o ceiling: se uma faixa precisar de mais, re-masteriza-a com mais limiting.</p>
          <button class="btn acc sm" data-al="match" ${al.tracks.length ? '' : 'disabled'}>Igualar loudness</button>
          <div id="alMatch" class="small" style="margin-top:8px"></div>
          <div class="hr"></div>
          <div class="eyebrow">Ouvir</div>
          <div class="row" style="gap:8px;margin-top:10px"><button class="btn sm" data-al="play" ${al.tracks.length ? '' : 'disabled'}>${UI.icon('play')}Tocar álbum</button><button class="btn sm ghost" data-al="stop">${UI.icon('stop')}Parar</button></div>
          <div id="alNow" class="small muted" style="margin-top:8px">${view.nowText(app)}</div>
          <div class="hr"></div>
          <div class="eyebrow">Exportar</div>
          <div class="col" style="margin-top:10px;gap:8px">
            <button class="btn sm" data-alx="masters" ${al.tracks.length ? '' : 'disabled'}>Masters individuais · WAV 24-bit + metadados</button>
            <button class="btn sm" data-alx="cue" ${al.tracks.length ? '' : 'disabled'}>Álbum · WAV 16-bit/44,1 kHz + CUE</button>
            <button class="btn sm primary" data-alx="ddp" ${al.tracks.length ? '' : 'disabled'}>Imagem DDP 2.0 para fábrica (ZIP)</button>
          </div>
          <div id="alExp" class="small" style="margin-top:10px"></div>
          <p class="small dim" style="margin-top:12px">O DDP inclui DDPID, DDPMS, PQDESCR, IMAGE.DAT, CHECKSUM.MD5 e a folha PQ. Antes de enviar, abre-o num leitor DDP (ex.: HOFA DDP Player) e confirma faixas, ISRC e duração. CD-TEXT ainda não é gerado.</p>
        </aside>
      </div>`;
    },
    nowText(app) { const p = app.albumPlay; return p && p.playing ? `A tocar faixa ${p.track} · ${UI.esc(p.title)}` : ''; },
    mount(app, root) {
      const save = async () => { await A().save(app.albumCur); app.albumList = await A().list(); };
      const al = app.albumCur;
      root.querySelectorAll('[data-alopen]').forEach((b) => (b.onclick = async () => { view.stop(app); app.albumCur = await A().get(b.dataset.alopen); app.refresh(); }));
      root.querySelectorAll('[data-al]').forEach((b) => (b.onclick = async () => {
        const k = b.dataset.al;
        if (k === 'new') { app.albumCur = A().create('Novo álbum'); if (app.hasSession() && app.state.meta) { app.albumCur.artist = app.state.meta.artist || ''; } await save(); app.refresh(); return; }
        if (k === 'del') { if (await UI.confirm('Apagar álbum', `“${UI.esc(al.name)}” e as faixas guardadas neste browser serão apagados.`, 'Apagar')) { view.stop(app); await A().remove(al.id); app.albumList = await A().list(); app.albumCur = app.albumList.length ? await A().get(app.albumList[0].id) : null; app.refresh(); } return; }
        if (k === 'addSession') { const st = app.state, m = MM.delivery.defaults(st); UI.toast('A juntar o master da sessão…', 'ok', 1500); await A().addTrack(al, st.masterBuf, { title: m.title || st.project.name.replace(/\s*\(demo\)/i, ''), artist: m.artist, isrc: m.isrc, composer: m.composer, source: st.project.name }); await save(); app.refresh(); return; }
        if (k === 'addFiles') { const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.accept = 'audio/*,.wav,.aif,.aiff,.flac,.mp3'; inp.onchange = () => view.addFiles(app, inp.files); inp.click(); return; }
        if (k === 'match') { const lim = A().matchLoudness(al); await save(); app.refresh(); const el = document.getElementById('alMatch'); if (el) el.innerHTML = `Alvo ${UI.fmtNum(al.appliedTarget)} LUFS aplicado.${lim.length ? ` <span class="warn-t">${lim.map((x) => `“${UI.esc(x.t.title)}” ficou ${UI.fmtNum(x.want - x.got)} dB abaixo (limite de true peak)`).join('; ')}.</span>` : ' <span class="acc-t">Todas as faixas no alvo.</span>'}`; return; }
        if (k === 'play') { view.play(app, 0); return; }
        if (k === 'stop') { view.stop(app); return; }
      }));
      root.querySelectorAll('[data-alf]').forEach((inp) => (inp.onchange = async () => {
        const k = inp.dataset.alf; let v = inp.value.trim();
        if (k === 'target') v = v === '' ? null : parseFloat(v.replace(',', '.').replace('−', '-'));
        if (k === 'ceiling') v = D.clamp(parseFloat(v.replace(',', '.').replace('−', '-')) || -1, -3, 0);
        if (k === 'upc') v = v.replace(/\D/g, '');
        al[k] = v; await save(); if (['name', 'upc'].includes(k)) setTimeout(() => app.refresh(), 0);
      }));
      root.querySelectorAll('[data-tf]').forEach((inp) => (inp.onchange = async () => {
        const t = al.tracks[+inp.dataset.ti], k = inp.dataset.tf;
        let v = inp.value.trim();
        if (['gain', 'intent', 'gapAfter', 'fadeIn', 'fadeOut'].includes(k)) v = parseFloat(v.replace(',', '.').replace('−', '-')) || 0;
        if (k === 'gapAfter' || k === 'fadeIn' || k === 'fadeOut') v = D.clamp(v, 0, 30);
        if (k === 'isrc') v = MM.delivery.normISRC(v);
        t[k] = v; app.albumRender = null; await save();
        if (['gain', 'isrc'].includes(k)) setTimeout(() => app.refresh(), 0);
      }));
      root.querySelectorAll('[data-tup],[data-tdn]').forEach((b) => (b.onclick = async () => { A().move(al, +(b.dataset.tup ?? b.dataset.tdn), b.dataset.tup !== undefined ? -1 : 1); app.albumRender = null; await save(); app.refresh(); }));
      root.querySelectorAll('[data-tdel]').forEach((b) => (b.onclick = async () => { al.tracks.splice(+b.dataset.tdel, 1); app.albumRender = null; await save(); app.refresh(); }));
      root.querySelectorAll('[data-tplay]').forEach((b) => (b.onclick = () => view.play(app, +b.dataset.tplay)));
      root.querySelectorAll('[data-alx]').forEach((b) => (b.onclick = () => view.export(app, b.dataset.alx)));
      view.drawChart(app, root);
    },
    unmount(app) { /* o álbum continua a tocar se mudares de vista */ void app; },
    async addFiles(app, files) {
      const al = app.albumCur || (app.albumCur = A().create('Novo álbum'));
      await app.ensureAudio();
      files = Array.from(files).filter((f) => /\.(wav|wave|aif|aiff|flac|mp3|m4a|ogg)$/i.test(f.name));
      for (const f of files) {
        try { UI.toast(`A analisar ${UI.esc(f.name)}…`, 'ok', 1200); const buf = await app.engine.ctx.decodeAudioData(await f.arrayBuffer()); await A().addTrack(al, buf, { title: f.name.replace(/\.[a-z0-9]+$/i, '').replace(/^\d+[\s._-]+/, ''), source: f.name }); }
        catch (e) { UI.toast(`Não foi possível ler ${UI.esc(f.name)}`, 'err'); }
      }
      await A().save(al); app.albumList = await A().list(); app.albumRender = null; app.refresh();
    },
    async rendered(app, sr, cd) {
      const key = sr + ':' + cd;
      if (!app.albumRender || app.albumRender.key !== key || app.albumRender.id !== app.albumCur.id) app.albumRender = { key, id: app.albumCur.id, r: await A().render(app.albumCur, sr, { cd }) };
      return app.albumRender.r;
    },
    async play(app, fromTrack) {
      view.stop(app);
      await app.ensureAudio();
      if (app.engine.playing) app.engine.pause();
      const ctx = app.engine.ctx;
      if (ctx.state !== 'running') await ctx.resume();
      const r = await view.rendered(app, 44100, true);
      const buf = MM.toAudioBuffer(r.chs, r.sr);
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(app.engine.out);
      const off = r.marks[fromTrack] ? r.marks[fromTrack].start / r.sr : 0;
      src.start(ctx.currentTime + 0.05, off);
      const t0 = ctx.currentTime + 0.05 - off;
      app.albumPlay = { src, playing: true, track: fromTrack + 1, title: app.albumCur.tracks[fromTrack].title };
      clearInterval(app.albumTick);
      app.albumTick = setInterval(() => {
        const t = (ctx.currentTime - t0) * r.sr; const m = r.marks.findIndex((x) => t >= x.start && t < x.start + x.length);
        if (m >= 0 && app.albumPlay) { app.albumPlay.track = m + 1; app.albumPlay.title = app.albumCur.tracks[m] ? app.albumCur.tracks[m].title : ''; }
        const el = document.getElementById('alNow'); if (el) el.textContent = view.nowText(app) + (m >= 0 ? ` · ${fmtT((t - r.marks[m].start) / r.sr)}` : '');
      }, 250);
      src.onended = () => view.stop(app);
    },
    stop(app) { if (app.albumPlay) { try { app.albumPlay.src.stop(); } catch (e) { /* */ } app.albumPlay = null; } clearInterval(app.albumTick); const el = document.getElementById('alNow'); if (el) el.textContent = ''; },
    async export(app, kind) {
      const al = app.albumCur, el = document.getElementById('alExp');
      const say = (t) => { if (el) el.innerHTML = t; };
      const safe = (s) => String(s || '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, '_').slice(0, 60) || 'Album';
      try {
        if (MM.license && kind !== 'masters') MM.license.guard(kind === 'ddp' ? 'O export DDP' : 'O export WAV + CUE');
        if (kind === 'masters') {
          const files = [];
          for (let i = 0; i < al.tracks.length; i++) {
            const t = al.tracks[i];
            say(`A codificar ${i + 1}/${al.tracks.length}…`);
            const g = D.db2lin(t.gain || 0), n = t.chs[0].length, fi = Math.round((t.fadeIn || 0) * t.sr), fo = Math.round((t.fadeOut || 0) * t.sr);
            const chs = t.chs.map((x) => { const y = new Float32Array(n); for (let k = 0; k < n; k++) { let e = g; if (k < fi) e *= Math.sin((k / fi) * Math.PI / 2) ** 2; if (k > n - fo) e *= Math.sin(((n - k) / fo) * Math.PI / 2) ** 2; y[k] = x[k] * e; } return y; });
            const meta = { title: t.title, artist: t.artist || al.artist, album: al.name, year: al.year, genre: al.genre, isrc: t.isrc, upc: al.upc, copyright: al.copyright, label: al.label, composer: t.composer, comment: `Faixa ${i + 1}/${al.tracks.length} · MIXMIND by Piradex` };
            const loud = { lufs: A().effLufs(t), lra: t.metrics.lra, tp: A().effTp(t), mMax: t.metrics.stMax, stMax: t.metrics.stMax };
            const e = await MM.exporter.encode(MM.toAudioBuffer(chs, t.sr), 'wav', 24, meta, loud);
            files.push({ name: `${String(i + 1).padStart(2, '0')} - ${safe(t.title).replace(/_/g, ' ')}.wav`, data: e.data });
            await D.yieldUI();
          }
          MM.exporter.download(MM.exporter.zip(files), safe(al.name) + '_Masters.zip', 'application/zip');
          say(`<span class="acc-t">${files.length} masters exportados com metadados e ISRC.</span>`);
        } else if (kind === 'cue') {
          say('A renderizar o álbum a 44,1 kHz…');
          const r = await view.rendered(app, 44100, true);
          const wavName = safe(al.name) + '.wav';
          const pcm = A().pcm16(r);
          const hdr = MM.exporter.wav([new Float32Array(0), new Float32Array(0)], 44100, 16);
          const v = new DataView(hdr.buffer); v.setUint32(4, 36 + pcm.length, true); v.setUint32(40, pcm.length, true);
          const wav = new Uint8Array(hdr.length + pcm.length); wav.set(hdr, 0); wav.set(pcm, hdr.length);
          MM.exporter.download(MM.exporter.zip([{ name: wavName, data: wav }, { name: safe(al.name) + '.cue', data: A().cue(al, r, wavName) }]), safe(al.name) + '_WAV_CUE.zip', 'application/zip');
          say('<span class="acc-t">WAV 16-bit/44,1 kHz + CUE exportados.</span>');
        } else if (kind === 'ddp') {
          say('A renderizar o álbum para CD (44,1 kHz, 16-bit, alinhado ao setor)…');
          const r = await view.rendered(app, 44100, true);
          const res = A().ddp(al, r);
          const chk = A().readDDP(res.files);
          say(`<div class="${chk.problems.length ? 'bad-t' : 'acc-t'}">${chk.problems.length ? 'Verificação falhou: ' + UI.esc(chk.problems.join('; ')) : '● Verificação independente OK'}</div>
            <table class="altab mini" style="margin-top:6px"><tr><th>Faixa</th><th>Índice</th><th>Início</th><th>ISRC</th></tr>${chk.pq.filter((e) => e.track !== '00').map((e) => `<tr><td>${e.track === 'AA' ? 'Lead-out' : e.track}</td><td>${e.index}</td><td class="mono">${A().msf(e.sector)}</td><td class="mono">${e.isrc || '—'}</td></tr>`).join('')}</table>
            ${res.warns.length ? `<div class="warn-t" style="margin-top:6px">${res.warns.map(UI.esc).join('<br>')}</div>` : ''}`);
          if (!chk.problems.length) MM.exporter.download(MM.exporter.zip(res.files.map((f) => ({ name: 'DDP/' + f.name, data: f.data }))), safe(al.name) + '_DDP.zip', 'application/zip');
        }
      } catch (e) { console.error(e); say(`<span class="bad-t">${UI.esc(e.message)}</span>`); }
    },
    drawChart(app, root) {
      const cv = root.querySelector('#alChart'); if (!cv) return;
      const al = app.albumCur, { ctx, w, h } = UI.fitCanvas(cv);
      const n = al.tracks.length, x0 = 44, gw = w - x0 - 10, top = 10, gh = h - top - 22;
      const lu = al.tracks.map((t) => A().effLufs(t)), lo = Math.min(...lu, -16) - 1, hi = Math.max(...lu, -6) + 1;
      const Y = (v) => top + (1 - (v - lo) / (hi - lo)) * gh;
      ctx.clearRect(0, 0, w, h);
      ctx.font = '10.5px Geist Mono, monospace';
      for (let v = Math.ceil(lo); v <= hi; v += 2) { ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(x0, Y(v), gw, 1); ctx.fillStyle = '#7c8597'; ctx.fillText(String(v), 4, Y(v) + 4); }
      const bw = Math.min(60, gw / Math.max(1, n) - 10);
      al.tracks.forEach((t, i) => {
        const x = x0 + (i + 0.5) * (gw / n) - bw / 2, v = lu[i];
        ctx.fillStyle = 'rgba(94,234,212,.55)'; ctx.fillRect(x, Y(v), bw, top + gh - Y(v));
        ctx.fillStyle = '#e9edf4'; ctx.fillText(UI.fmtNum(v), x + 2, Y(v) - 4);
        ctx.fillStyle = '#7c8597'; ctx.fillText(String(i + 1), x + bw / 2 - 3, h - 6);
      });
      if (al.appliedTarget !== undefined || al.target !== null) { const tv = al.target ?? al.appliedTarget; ctx.strokeStyle = '#fbbf24'; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(x0, Y(tv)); ctx.lineTo(x0 + gw, Y(tv)); ctx.stroke(); ctx.setLineDash([]); }
    },
  };
  V.album = view;
})();
