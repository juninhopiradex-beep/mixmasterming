/* MixMind — vista "MixMind Master" (interface tipo plugin para o master) */
(function () {
  const MM = window.MM, D = MM.dsp, UI = MM.ui;
  const V = (MM.views = MM.views || {});

  // macros ↔ parâmetros do master
  const MAC = {
    punch: { name: 'Punch', get: (M) => D.clamp((M.chain.clip.amount / 0.7) * 0.6 + ((M.chain.glue.atk - 5) / 45) * 0.4, 0, 1), set: (M, v) => { M.chain.clip.on = true; M.chain.clip.amount = +(v * 0.7).toFixed(2); M.chain.glue.atk = Math.round(5 + v * 45); M.manual.clip = M.manual.glue = true; } },
    warmth: { name: 'Warmth', get: (M) => D.clamp(M.chain.sat.drive / 0.3 * 0.7 + (0.5 - M.chain.eq.air / 4) * 0.3, 0, 1), set: (M, v) => { M.chain.sat.on = true; M.chain.sat.drive = +(v * 0.3).toFixed(2); M.chain.sat.model = v > 0.6 ? 'tube' : 'tape'; M.chain.eq.air = +((0.5 - v) * 3).toFixed(1); M.manual.sat = M.manual.eq = true; } },
    width: { name: 'Width', get: (M) => D.clamp((M.width - 80) / 60, 0, 1), set: (M, v) => { M.width = Math.round(80 + v * 60); M.chain.ms.on = true; M.manual.ms = true; } },
    loud: { name: 'Loudness', get: (M) => D.clamp((M.target + 16) / 10, 0, 1), set: (M, v) => { M.target = +(-16 + v * 10).toFixed(1); M.manual.target = true; } },
  };

  V.plugin = {
    render(app) {
      const st = app.state;
      if (!app.hasSession()) {
        return `<div class="hero" style="max-width:900px"><div class="eyebrow acc">MixMind Master</div><h1 style="margin-top:10px">Masteriza uma mix stereo.</h1><p class="lead">Carrega uma mix já feita. A IA analisa tonalidade, dinâmica e estéreo, escolhe a cadeia e acerta o alvo de loudness com true peak seguro. Tu ajustas com quatro macros.</p>
          <div class="drop" id="mdrop"><div class="up">${UI.icon('upload')}</div><h2>Arrasta a tua mix</h2><p class="muted" style="margin:8px 0 18px">WAV, AIFF, FLAC ou MP3 — de preferência 24-bit, com 3–6 dB de headroom.</p><button class="btn primary lg" id="mpick">${UI.icon('file')}Escolher ficheiro</button></div></div>`;
      }
      const M = st.master, m = st.metrics.master;
      const busy = app.busy;
      return `<div class="plug">
        <div class="hd">${UI.logo()}<b style="font-size:19px">MixMind Master</b>
          <select class="field" id="pStyle" style="width:170px;height:34px">${Object.keys(MM.MASTER_STYLES).map((s) => `<option ${s === M.style ? 'selected' : ''}>${s}</option>`).join('')}</select>
          <span class="spacer"></span><span class="muted small">Latência ${M.chain.lim.lookahead} ms · look-ahead</span>
          <button class="btn ${busy ? 'busy' : app.ready() && !st.dirty.master ? 'primary' : 'acc'}" id="pState">${busy ? 'A processar' : app.ready() && !st.dirty.master ? 'Processado' : 'Por processar'}</button>
        </div>
        <div class="bd">
          <div>
            <div class="chips">${['Transparent', 'Punchy', 'Warm', 'Aggressive', 'Wide', 'Streaming', 'Club'].map((s) => `<button class="chip ${M.style === s ? 'on' : ''}" data-ps="${s}">${s === 'Aggressive' ? 'Loud' : s}</button>`).join('')}</div>
            <div class="knobs">${Object.entries(MAC).map(([k, mc]) => `<div class="knob" data-knob="${k}"><div data-ksvg>${UI.knobSVG(mc.get(M))}</div><b>${mc.name}</b><small data-kv>${Math.round(mc.get(M) * 100)} %</small></div>`).join('')}</div>
            <canvas id="pspec" style="width:100%;height:260px;display:block;margin-top:16px;border:1px solid var(--line);border-radius:12px;background:rgba(0,0,0,.25)"></canvas>
            <div class="row wrap" style="margin-top:16px"><button class="btn primary lg" id="pAn">${UI.icon('spark')}Analisar e ajustar</button><button class="btn lg" id="pRef">${UI.icon('target')}Aprender com referência…</button><span class="muted">Toca 10 s do refrão e carrega em Analisar. A IA propõe, tu decides.</span></div>
            <div style="margin-top:18px">${V.listenHTML(app)}</div>
          </div>
          <div class="side">
            <div class="pm"><div class="k">LUFS-I</div><div class="v" id="pI">${m ? UI.fmtNum(m.lufs) : '—'}</div><div class="bar"><i id="pIb" style="width:${m ? D.clamp((m.lufs + 24) / 20, 0, 1) * 100 : 0}%;background:#e9edf4"></i></div></div>
            <div class="pm"><div class="k">TRUE PEAK</div><div class="v warn-t" id="pTP">${m ? UI.fmtNum(m.tp) : '—'}</div><div class="bar"><i id="pTPb" style="width:${m ? D.clamp((m.tp + 12) / 12, 0, 1) * 100 : 0}%;background:var(--warn)"></i></div></div>
            <div class="pm"><div class="k">GAIN RED.</div><div class="v acc-t" id="pGR">${st.masterGR ? UI.fmtNum(st.masterGR) : '—'}</div><div class="bar"><i id="pGRb" style="width:${D.clamp((st.masterGR || 0) / 8, 0, 1) * 100}%"></i></div></div>
            <div class="pm"><div class="k">CORRELAÇÃO</div><div class="v" id="pC">${m ? (m.corr >= 0 ? '+' : '') + UI.fmtNum(m.corr, 2) : '—'}</div><div class="bar"><i id="pCb" style="width:${m ? ((m.corr + 1) / 2) * 100 : 0}%;background:#e9edf4"></i></div></div>
            <div class="hr"></div>
            <div class="mono small muted">Alvo ${UI.fmtNum(M.target)} LUFS · ceiling ${UI.fmtNum(M.ceiling)} dBTP<br>Largura ${M.width} % · mono &lt; ${M.chain.ms.monoBelow} Hz</div>
            <div class="row wrap" style="margin-top:14px"><button class="btn sm" data-view="master">${UI.icon('gauge')}Cadeia completa</button><button class="btn sm" data-view="export">${UI.icon('download')}Exportar</button></div>
            ${st.mode === 'master' ? `<button class="btn sm ghost" style="margin-top:10px" id="pNew">${UI.icon('file')}Outra mix…</button>` : ''}
          </div>
        </div>
      </div>`;
    },
    mount(app, root) {
      if (!app.hasSession()) {
        const pick = () => app.pickFiles({ multiple: false, onFiles: (f) => f[0] && app.loadMasterFile(f[0]) });
        root.querySelector('#mpick').onclick = pick;
        return;
      }
      const st = app.state, M = st.master;
      const restyle = (s) => { app.change('Estilo ' + s, () => { M.style = s; M.manual = {}; const t = MM.MASTER_STYLES[s].target; if (t) M.target = t; }, { master: true }); app.runAI({ keepMix: true }); };
      root.querySelector('#pStyle').onchange = (e) => restyle(e.target.value);
      root.querySelectorAll('[data-ps]').forEach((b) => (b.onclick = () => restyle(b.dataset.ps)));
      root.querySelector('#pAn').onclick = () => { app.change('Analisar e ajustar', () => { M.manual = {}; }, { master: true }); app.runAI({ keepMix: true }); };
      root.querySelector('#pState').onclick = () => { if (st.dirty.master || !app.ready()) app.runAI({ keepMix: true }); };
      root.querySelector('#pRef').onclick = () => app.pickFiles({ multiple: false, onFiles: async (fs) => {
        const f = fs[0]; if (!f) return;
        await app.ensureAudio();
        const { ab, buf } = await MM.decodeFile(app.engine.ctx, f);
        const chs = [buf.getChannelData(0).slice(), (buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)).slice()];
        const r = await app.addReference(f.name, chs, ab);
        if (r) { app.setActiveRef(r.id); st.refInfluence = Math.max(st.refInfluence, 0.6); st.refApply.master = true; delete M.manual.target; app.runAI({ keepMix: true }); }
      } });
      const nw = root.querySelector('#pNew'); if (nw) nw.onclick = () => app.pickFiles({ multiple: false, onFiles: (f) => f[0] && app.loadMasterFile(f[0]) });
      root.querySelectorAll('[data-knob]').forEach((el) => {
        const k = el.dataset.knob, mc = MAC[k];
        UI.drag(el, {
          get: () => mc.get(M), min: 0, max: 1, sens: 0.005,
          start: () => MM.commit(st, 'Macro ' + mc.name),
          set: (v) => { mc.set(M, v); el.querySelector('[data-ksvg]').innerHTML = UI.knobSVG(v); el.querySelector('[data-kv]').textContent = Math.round(v * 100) + ' %'; if (k !== 'loud') app.engine.graph && app.engine.graph.applyMaster(); st.dirty.master = true; },
          end: (moved) => { if (moved) { app.renderTop(); if (k === 'loud') app.runAI({ keepMix: true }); } },
        });
      });
      V.plugin.draw(app);
    },
    draw(app) {
      const cv = document.getElementById('pspec'); if (!cv) return;
      // reaproveita o desenho do espectro do master
      cv.id = 'mspec'; MM.views.master.drawSpec(app, cv.parentElement); cv.id = 'pspec';
    },
    frame(app) {
      if (!app.hasSession()) return;
      if (app.engine.playing) {
        V.plugin.draw(app);
        if (app.engine.monitor === 'master') {
          const m = app.engine.meter, g = app.engine.graph ? app.engine.graph.gr.mLim || 0 : 0;
          const set = (id, v, bid, w) => { const e = document.getElementById(id); if (e) e.textContent = v; const b = document.getElementById(bid); if (b) b.style.width = D.clamp(w, 0, 1) * 100 + '%'; };
          if (m.I > -69) set('pI', UI.fmtNum(m.I), 'pIb', (m.I + 24) / 20);
          if (m.tpMax > -69) set('pTP', UI.fmtNum(m.tpMax), 'pTPb', (m.tpMax + 12) / 12);
          set('pGR', UI.fmtNum(g), 'pGRb', g / 8);
          set('pC', (m.corr >= 0 ? '+' : '') + UI.fmtNum(m.corr, 2), 'pCb', (m.corr + 1) / 2);
        }
      }
    },
    onMonitor(app) { MM.views.master.onMonitor(app); },
  };
})();
