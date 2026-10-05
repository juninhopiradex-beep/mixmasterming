/* MixMind — vista Automação */
(function () {
  const MM = window.MM, D = MM.dsp, UI = MM.ui;
  const V = (MM.views = MM.views || {});

  const norm = (l, v) => (l.log ? (Math.log(v) - Math.log(l.min)) / (Math.log(l.max) - Math.log(l.min)) : (v - l.min) / (l.max - l.min));
  const denorm = (l, y) => (l.log ? Math.exp(Math.log(l.min) + y * (Math.log(l.max) - Math.log(l.min))) : l.min + y * (l.max - l.min));
  function fmtVal(app, l, v) {
    if (l.unit === 'Hz') return D.fmtHz(v);
    if (l.unit === '%') { const base = l.target.type === 'master' ? app.state.master.width : 100; return Math.round((base * v) / 100) + ' %'; }
    if (l.rel && l.target.type === 'stem') {
      const s = app.stem(l.target.id);
      const base = l.base !== undefined ? l.base : l.target.param === 'sendRev' ? s.p.sendRev : s.p.sendDly;
      const a = base + v;
      return a <= -45 ? 'off' : UI.fmtDb(a) + ' dB';
    }
    return UI.fmtDb(v) + ' dB';
  }
  const visibleLanes = (app) => (app.state.automation || []).filter((l) => l.show || app.showInternal);

  V.automation = {
    flush: true,
    render(app) {
      const st = app.state, lanes = visibleLanes(app), r = st.rider;
      const rl = (st.automation || []).find((l) => l.kind === 'rider');
      const v = st.stems.find((s) => s.role === 'Lead Vocal');
      const exps = (st.explain || []).filter((e) => e.module === 'Vocal rider' || e.module === 'Automação');
      const manualCount = (st.automation || []).reduce((a, l) => a + l.manual.length, 0);
      const sl = (lbl, key, min, max, step, fmt) => `<div style="margin-bottom:12px"><div class="row" style="justify-content:space-between"><span>${lbl}</span><span class="mono" data-rv="${key}">${fmt(r[key])}</span></div><input type="range" min="${min}" max="${max}" step="${step}" value="${r[key]}" data-r="${key}"></div>`;
      return `<div class="auto">
        <div class="lanes-l"><div style="height:62px;border-bottom:1px solid var(--line);display:flex;align-items:center;padding:0 18px"><label class="check small"><input type="checkbox" id="showInt" ${app.showInternal ? 'checked' : ''}>Automação interna</label></div>
          ${lanes.map((l) => `<div class="lane-h"><div class="row" style="justify-content:space-between"><b>${UI.esc(l.label)}</b>${l.target.type === 'stem' && app.stem(l.target.id) ? UI.sm(app.stem(l.target.id)) : ''}</div><small>${UI.esc(l.sub)}</small><div class="val" data-lv="${l.id}">${fmtVal(app, l, MM.laneValue(l, app.engine.position()))}</div>
            <div class="row" style="gap:14px"><label class="check small"><input type="checkbox" data-en="${l.id}" data-w="ai" ${l.enabled.ai ? 'checked' : ''}>IA</label><label class="check small"><input type="checkbox" data-en="${l.id}" data-w="manual" ${l.enabled.manual ? 'checked' : ''}>Manual${l.manual.length ? ` (${l.manual.length})` : ''}</label></div></div>`).join('') || '<div class="empty-note">Sem automação — corre o AI Mix &amp; Master.</div>'}
        </div>
        <div style="overflow:auto;position:relative" id="autoMid">
          <div class="ruler"><canvas id="autoRuler"></canvas></div>
          ${lanes.map((l) => `<div class="lane-c"><canvas data-lane="${l.id}"></canvas></div>`).join('')}
          <canvas id="autoHead" style="position:absolute;left:0;top:0;width:100%;pointer-events:none"></canvas>
          <div class="row small muted" style="padding:14px 18px;gap:22px"><span><span style="display:inline-block;width:26px;border-top:2px dashed var(--acc);vertical-align:3px"></span> Escrita pela IA</span><span><span style="display:inline-block;width:26px;border-top:2px solid #fff;vertical-align:3px"></span> Editada manualmente (prevalece sobre a IA)</span><span>Arrasta para desenhar · duplo clique remove o segmento manual</span></div>
        </div>
        <aside style="border-left:1px solid var(--line);overflow:auto"><div class="pad">
          <div class="eyebrow">Vocal rider · ${v ? UI.esc(v.label) : 'sem voz principal'}</div>
          <p class="explain" style="margin:12px 0 18px">Mantém a voz ${UI.fmtNum(r.target)} dB acima do instrumental na banda 300 Hz – 4 kHz, frase a frase.${st.riderInfo ? ` ${st.riderInfo.points} pontos escritos, ${st.riderInfo.sections} secções, ${st.riderInfo.breaths} blocos de respiração atenuados.` : ''}</p>
          ${sl('Máx. movimento', 'max', 0.5, 8, 0.5, (x) => '±' + UI.fmtNum(+x) + ' dB')}
          ${sl('Distância alvo vs instrumental', 'target', -3, 6, 0.1, (x) => UI.fmtDb(+x) + ' LU')}
          ${sl('Suavização', 'smooth', 0, 100, 1, (x) => Math.round(x) + ' %')}
          ${sl('Respirações', 'breaths', -12, 0, 0.5, (x) => UI.fmtDb(+x) + ' dB')}
          ${sl('Adlibs vs lead', 'adlibs', -8, 2, 0.5, (x) => UI.fmtDb(+x) + ' dB')}
          <div class="row wrap" style="margin-top:6px"><button class="btn primary sm" id="accAI">Aceitar IA</button><button class="btn sm" id="smoothB">Suavizar</button><button class="btn sm" id="reduceB">Reduzir pontos</button><button class="btn sm ghost" id="clearB" ${manualCount ? '' : 'disabled'}>Limpar manual</button></div>
          <div class="hr"></div>
          <div class="eyebrow">Explicação</div>
          <div class="explain" style="margin-top:10px">${exps.map((e) => `<p>${UI.esc(e.text)}</p>`).join('')}${(st.automation || []).filter((l) => l.manual.length).map((l) => `<p><b>${UI.esc(l.label)} · ${UI.esc(l.sub)}:</b> a tua edição manual foi respeitada; a IA não volta a mexer nesse troço.</p>`).join('')}</div>
        </div></aside>
      </div>`;
    },
    mount(app, root) {
      const st = app.state, dur = st.music.duration;
      const lanes = visibleLanes(app);
      const drawRuler = () => {
        const cv = root.querySelector('#autoRuler'); const { ctx, w, h } = UI.fitCanvas(cv);
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#7c8597'; ctx.font = '11px Geist Mono, monospace';
        for (let b = 0; b <= st.music.bars; b += 16) { const x = ((st.music.downbeat + b * st.music.barSec) / dur) * w; ctx.fillText(String(b + 1), x + 3, 13); }
        st.music.sections.forEach((s) => { const x0 = (s.start / dur) * w, x1 = (s.end / dur) * w; ctx.fillStyle = 'rgba(94,234,212,.1)'; ctx.fillRect(x0 + 1, 24, x1 - x0 - 2, 30); ctx.fillStyle = '#d6e4e1'; ctx.font = '12px Geist, Inter, sans-serif'; ctx.save(); ctx.beginPath(); ctx.rect(x0, 24, x1 - x0 - 4, 30); ctx.clip(); ctx.fillText(s.name, x0 + 7, 43); ctx.restore(); });
      };
      drawRuler();
      const drawLane = (l) => {
        const cv = root.querySelector(`canvas[data-lane="${CSS.escape(l.id)}"]`); if (!cv) return;
        const { ctx, w, h } = UI.fitCanvas(cv), pad = 14;
        ctx.clearRect(0, 0, w, h);
        st.music.sections.forEach((s) => { ctx.fillStyle = 'rgba(255,255,255,.035)'; ctx.fillRect((s.start / dur) * w, 0, 1, h); });
        const yOf = (v) => h - pad - D.clamp(norm(l, v), 0, 1) * (h - 2 * pad);
        // linha de referência (valor neutro)
        ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(0, yOf(l.def)); ctx.lineTo(w, yOf(l.def)); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#626b7c'; ctx.font = '10.5px Geist Mono, monospace';
        ctx.fillText(l.unit === 'Hz' ? D.fmtHz(l.max) : (l.max > 0 ? '+' : '') + l.max + (l.unit === '%' ? '%' : ''), 6, 12);
        ctx.fillText(l.unit === 'Hz' ? D.fmtHz(l.min) : l.min + (l.unit === '%' ? '%' : ''), 6, h - 4);
        // curva IA
        if (l.ai) {
          ctx.strokeStyle = l.enabled.ai ? '#5eead4' : 'rgba(94,234,212,.3)'; ctx.lineWidth = 1.8; ctx.setLineDash([5, 4]); ctx.beginPath();
          for (let x = 0; x <= w; x += 2) { const t = (x / w) * dur; const vv = laneAI(l, t); x ? ctx.lineTo(x, yOf(vv)) : ctx.moveTo(x, yOf(vv)); }
          ctx.stroke(); ctx.setLineDash([]);
        }
        // segmentos manuais
        l.manual.forEach((seg) => {
          ctx.strokeStyle = l.enabled.manual ? '#fff' : 'rgba(255,255,255,.35)'; ctx.lineWidth = 2; ctx.beginPath();
          seg.forEach(([t, vv], i) => { const x = (t / dur) * w; i ? ctx.lineTo(x, yOf(vv)) : ctx.moveTo(x, yOf(vv)); });
          ctx.stroke();
          ctx.fillStyle = '#fff';
          [seg[0], seg[seg.length - 1]].forEach(([t, vv]) => { ctx.beginPath(); ctx.arc((t / dur) * w, yOf(vv), 3.5, 0, Math.PI * 2); ctx.fill(); });
        });
        cv._yOf = yOf; cv._pad = pad;
      };
      function laneAI(l, t) { const sv = l.manual; l.manual = []; const v = MM.laneValue(Object.assign({}, l, { enabled: { ai: true, manual: false } }), t); l.manual = sv; return v; }
      lanes.forEach(drawLane);
      V.automation._redraw = () => lanes.forEach(drawLane);
      // desenho manual
      lanes.forEach((l) => {
        const cv = root.querySelector(`canvas[data-lane="${CSS.escape(l.id)}"]`); if (!cv) return;
        let pts = null;
        cv.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          cv.setPointerCapture(e.pointerId);
          MM.commit(st, 'Automação manual ' + l.label);
          pts = [];
          const base = l.manual.slice();
          let seg = null;
          const add = (ev) => {
            const r = cv.getBoundingClientRect(), h = r.height, pad = 14;
            const t = D.clamp(((ev.clientX - r.left) / r.width) * dur, 0, dur);
            const y = D.clamp(1 - (ev.clientY - r.top - pad) / (h - 2 * pad), 0, 1);
            let v = denorm(l, y);
            v = l.unit === 'dB' ? Math.round(v * 10) / 10 : Math.round(v);
            if (pts.length && t <= pts[pts.length - 1][0]) pts[pts.length - 1][1] = v; else pts.push([t, v]);
            seg = pts.length > 1 ? simplify(pts) : [[Math.max(0, t - 0.5), v], [Math.min(dur, t + 0.5), v]];
            l.manual = base.filter((q) => q[q.length - 1][0] < seg[0][0] || q[0][0] > seg[seg.length - 1][0]).concat([seg]).sort((x, z) => x[0][0] - z[0][0]);
            drawLane(l);
          };
          add(e);
          const mv = (ev) => add(ev);
          const up = () => {
            cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up);
            l.enabled.manual = true;
            st.dirty.mix = true; app.engine.reschedule(); app.saveSoon(); app.refresh();
          };
          cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up);
        });
        cv.addEventListener('dblclick', (e) => {
          const r = cv.getBoundingClientRect(), t = ((e.clientX - r.left) / r.width) * dur;
          const i = l.manual.findIndex((s) => t >= s[0][0] - 0.3 && t <= s[s.length - 1][0] + 0.3);
          if (i >= 0) app.change('Remover automação manual', () => l.manual.splice(i, 1), { reschedule: true });
        });
      });
      function simplify(p) {
        if (p.length < 3) return p.slice();
        const out = [p[0]];
        for (let i = 1; i < p.length - 1; i++) { const a = out[out.length - 1]; if (p[i][0] - a[0] > dur / 400 || Math.abs(p[i][1] - a[1]) > 0.0001) out.push(p[i]); }
        out.push(p[p.length - 1]);
        return out;
      }
      root.querySelectorAll('[data-en]').forEach((c) => (c.onchange = () => app.change('Automação on/off', () => { const l = st.automation.find((x) => x.id === c.dataset.en); l.enabled[c.dataset.w] = c.checked; }, { reschedule: true })));
      root.querySelector('#showInt').onchange = (e) => { app.showInternal = e.target.checked; app.refresh(); };
      const fmts = { max: (x) => '±' + UI.fmtNum(+x) + ' dB', target: (x) => UI.fmtDb(+x) + ' LU', smooth: (x) => Math.round(x) + ' %', breaths: (x) => UI.fmtDb(+x) + ' dB', adlibs: (x) => UI.fmtDb(+x) + ' dB' };
      root.querySelectorAll('[data-r]').forEach((inp) => {
        inp.oninput = () => (root.querySelector(`[data-rv="${inp.dataset.r}"]`).textContent = fmts[inp.dataset.r](inp.value));
        inp.onchange = () => app.change('Vocal rider', () => {
          st.rider[inp.dataset.r] = +inp.value;
          if (inp.dataset.r === 'adlibs') { const a = st.stems.find((s) => s.role === 'Adlibs'); const v = st.stems.find((s) => s.role === 'Lead Vocal'); if (a && v && !a.locked) { a.p.fader = +(v.p.fader + st.rider.adlibs - 4.5).toFixed(1); a.manual.fader = true; } }
        }, { auto: true });
      });
      const rider = () => st.automation.find((l) => l.kind === 'rider');
      root.querySelector('#accAI').onclick = () => app.change('Aceitar IA', () => { st.automation.forEach((l) => { if (l.kind === 'rider') { l.manual = []; l.enabled.ai = true; } }); }, { reschedule: true });
      root.querySelector('#smoothB').onclick = () => app.change('Suavizar rider', () => { st.rider.smooth = Math.min(100, st.rider.smooth + 10); }, { auto: true });
      root.querySelector('#reduceB').onclick = () => app.change('Reduzir pontos', () => {
        const l = rider();
        if (l && l.ai.values) { const pts = []; const step = 0.5; for (let t = 0; t <= dur; t += step) pts.push([t, +MM.laneValue(Object.assign({}, l, { enabled: { ai: true, manual: false } }), t).toFixed(2)]); l.ai = { points: pts }; }
        st.automation.forEach((x) => (x.manual = x.manual.map((s) => s.filter((p2, i) => i === 0 || i === s.length - 1 || i % 3 === 0))));
        UI.toast(`Rider reduzido a ${l ? l.ai.points.length : 0} pontos (1 por 0,5 s).`, 'ok');
      }, { reschedule: true });
      root.querySelector('#clearB').onclick = () => app.change('Limpar automação manual', () => st.automation.forEach((l) => (l.manual = [])), { reschedule: true });
    },
    frame(app) {
      const cv = document.getElementById('autoHead'), mid = document.getElementById('autoMid');
      if (!cv || !mid) return;
      cv.style.height = mid.scrollHeight - 50 + 'px';
      const { ctx, w, h } = UI.fitCanvas(cv);
      ctx.clearRect(0, 0, w, h);
      const x = (app.engine.position() / app.engine.duration()) * w;
      ctx.fillStyle = '#fff'; ctx.fillRect(x, 0, 1.5, h);
      ctx.beginPath(); ctx.moveTo(x - 6, 0); ctx.lineTo(x + 7, 0); ctx.lineTo(x + 0.7, 8); ctx.fill();
      if (app.engine.playing) document.querySelectorAll('[data-lv]').forEach((el) => {
        const l = app.state.automation.find((q) => q.id === el.dataset.lv);
        if (l) el.textContent = fmtVal(app, l, MM.laneValue(l, app.engine.position())) + (l.enabled.manual && l.manual.some((s) => app.engine.position() >= s[0][0] && app.engine.position() <= s[s.length - 1][0]) ? ' (manual)' : '');
      });
    },
  };
})();
