/* MIXMIND — vista Arranjo: pistas por stem, estrutura editável, zoom e mute por secção */
(function () {
  const MM = window.MM, D = MM.dsp, UI = MM.ui;
  const V = (MM.views = MM.views || {});
  const S = () => MM.sections;
  const LANE = 58, RULER = 46;

  /** Pirâmide de picos (máx. |x| por bloco de 256 amostras) — desenho rápido a qualquer zoom. */
  const PYR = 256;
  function pyramid(s) {
    if (s._pyr && s._pyr.len === s.length) return s._pyr.v;
    const n = Math.ceil(s.length / PYR), v = new Float32Array(n);
    s.chs.forEach((x) => { for (let b = 0; b < n; b++) { let m = v[b]; const e = Math.min(x.length, (b + 1) * PYR); for (let i = b * PYR; i < e; i++) { const a = x[i] < 0 ? -x[i] : x[i]; if (a > m) m = a; } v[b] = m; } });
    let mx = 1e-6; for (let b = 0; b < n; b++) if (v[b] > mx) mx = v[b];
    s._pyr = { len: s.length, v, mx };
    return v;
  }
  function peakAt(s, i0, i1) {
    const v = pyramid(s);
    if (i1 - i0 >= PYR * 2) { let m = 0; for (let b = Math.floor(i0 / PYR), e = Math.min(v.length, Math.ceil(i1 / PYR)); b < e; b++) if (v[b] > m) m = v[b]; return m; }
    let m = 0;
    s.chs.forEach((x) => { for (let i = Math.max(0, i0), e = Math.min(x.length, i1); i < e; i++) { const a = x[i] < 0 ? -x[i] : x[i]; if (a > m) m = a; } });
    return m;
  }

  const view = (app) => {
    const st = app.state, dur = st.music.duration;
    const z = (app.arr = app.arr || { zoom: 1, t0: 0, sel: 0 });
    z.zoom = D.clamp(z.zoom, 1, 64);
    const span = dur / z.zoom;
    z.t0 = D.clamp(z.t0, 0, Math.max(0, dur - span));
    z.sel = D.clamp(z.sel, 0, Math.max(0, S().list(st).length - 1));
    return { z, span, dur, x: (t, w) => ((t - z.t0) / span) * w, t: (x, w) => z.t0 + (x / w) * span };
  };

  V.arrange = {
    flush: true,
    render(app) {
      const st = app.state, stems = st.stems.filter((s) => !s.removed);
      const z = view(app).z;
      return `<div class="arr">
        <div class="arr-tools">
          <div class="row" style="gap:8px">
            <div class="seg"><button data-z="out" title="Afastar (Ctrl/⌘ + roda)">−</button><button data-z="fit" title="Ver a música toda">Ajustar</button><button data-z="in" title="Aproximar (Ctrl/⌘ + roda)">+</button></div>
            <span class="mono small dim" id="zLbl">${z.zoom.toFixed(z.zoom < 10 ? 1 : 0).replace('.', ',')}×</span>
            <input type="range" id="arrScroll" min="0" max="1000" value="0" class="arr-scroll" ${z.zoom > 1.01 ? '' : 'disabled'} title="Deslocar (Shift + roda)">
          </div>
          <span class="small muted arr-hint">Arrasta as fronteiras na régua (Shift = livre) · duplo clique renomeia · botão direito numa pista cala esse stem nessa secção</span>
        </div>
        <div class="secbar" id="secBar"></div>
        <div class="arr-grid" id="arrGrid">
          <div class="arr-names">
            <div style="height:${RULER}px;border-bottom:1px solid var(--line)" class="row small dim" ><span style="padding:0 14px">Stems · Solo · Mute</span></div>
            ${stems.map((s) => `<div class="row lane-name" data-lane-name="${s.id}" style="height:${LANE}px"><span style="width:9px;height:9px;border-radius:50%;background:${UI.colorOf(s)};flex:none"></span><div style="flex:1;min-width:0"><b>${UI.esc(s.label)}</b><small class="dim mono">${UI.fmtDb(s.p.fader)} dB · ${MM.panLabel(s.p.pan)}${s.p.polarity ? ' · Ø' : ''}</small></div>${UI.sm(s)}</div>`).join('')}
          </div>
          <div class="arr-tl" id="arrWrap">
            <canvas id="arrRuler" style="height:${RULER}px"></canvas>
            ${stems.map((s) => `<div class="lane" style="height:${LANE}px"><canvas data-arr="${s.id}"></canvas></div>`).join('')}
            <canvas id="arrHead" class="arr-head"></canvas>
          </div>
        </div>
      </div>`;
    },
    mount(app, root) {
      const st = app.state;
      V.arrange.root = root;
      V.arrange.drawAll(app);
      V.arrange.renderSecBar(app);
      const wrap = root.querySelector('#arrWrap'), rc = root.querySelector('#arrRuler');
      // zoom
      const zoomAt = (f, tAnchor) => {
        const v = view(app), w = wrap.getBoundingClientRect().width;
        const ta = tAnchor === undefined ? v.z.t0 + v.span / 2 : tAnchor;
        const rel = (ta - v.z.t0) / v.span;
        v.z.zoom = D.clamp(v.z.zoom * f, 1, 64);
        const span2 = v.dur / v.z.zoom;
        v.z.t0 = ta - rel * span2;
        V.arrange.drawAll(app); V.arrange.syncTools(app);
        void w;
      };
      root.querySelectorAll('[data-z]').forEach((b) => (b.onclick = () => {
        const k = b.dataset.z;
        if (k === 'fit') { app.arr.zoom = 1; app.arr.t0 = 0; V.arrange.drawAll(app); V.arrange.syncTools(app); }
        else zoomAt(k === 'in' ? 1.6 : 1 / 1.6, app.engine.position());
      }));
      root.querySelector('#arrScroll').oninput = (e) => { const v = view(app); v.z.t0 = (e.target.value / 1000) * Math.max(0, v.dur - v.span); V.arrange.drawAll(app); };
      wrap.addEventListener('wheel', (e) => {
        const r = wrap.getBoundingClientRect(), v = view(app);
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * 0.0025), v.t(e.clientX - r.left, r.width)); return; }
        const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
        if (dx && v.z.zoom > 1.001) { e.preventDefault(); v.z.t0 += (dx / r.width) * v.span; V.arrange.drawAll(app); V.arrange.syncTools(app); }
      }, { passive: false });

      // régua: fronteiras arrastáveis, clique = selecionar + loop, duplo clique = renomear
      const hitBoundary = (x, w) => {
        const v = view(app), L = S().list(st);
        for (let i = 1; i < L.length; i++) if (Math.abs(v.x(L[i].start, w) - x) < 6) return i;
        return -1;
      };
      rc.addEventListener('pointermove', (e) => {
        if (rc._drag) return;
        const r = rc.getBoundingClientRect();
        rc.style.cursor = e.clientY - r.top > 18 && hitBoundary(e.clientX - r.left, r.width) > 0 ? 'col-resize' : 'pointer';
      });
      rc.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const r = rc.getBoundingClientRect(), x = e.clientX - r.left, v = view(app), t = v.t(x, r.width);
        if (e.clientY - r.top <= 18) { app.ensureAudio().then(() => app.engine.seek(t)); return; }
        const bi = hitBoundary(x, r.width);
        if (bi > 0) {
          MM.commit(st, 'Mover secção'); V.arrange.backupAI(st);
          rc._drag = { i: bi, moved: false };
          rc.setPointerCapture(e.pointerId);
          return;
        }
        const i = S().at(st, t);
        if (i >= 0) {
          const sec = S().list(st)[i];
          app.arr.sel = i;
          app.setLoop(app.engine.loop && Math.abs(app.engine.loop[0] - sec.start) < 1e-6 ? null : sec);
          V.arrange.drawAll(app); V.arrange.renderSecBar(app);
        }
      });
      rc.addEventListener('pointermove', (e) => {
        if (!rc._drag) return;
        const r = rc.getBoundingClientRect(), v = view(app);
        S().moveBoundary(st, rc._drag.i, v.t(e.clientX - r.left, r.width), e.shiftKey);
        rc._drag.moved = true;
        V.arrange.drawAll(app);
      });
      const endDrag = () => {
        if (!rc._drag) return;
        const moved = rc._drag.moved; rc._drag = null;
        if (moved) V.arrange.changed(app, false); else MM.history.undo.pop();
      };
      rc.addEventListener('pointerup', endDrag); rc.addEventListener('pointercancel', endDrag);
      rc.addEventListener('dblclick', (e) => {
        const r = rc.getBoundingClientRect(), v = view(app);
        const i = S().at(st, v.t(e.clientX - r.left, r.width));
        if (i < 0) return;
        app.arr.sel = i; V.arrange.renderSecBar(app);
        const inp = root.querySelector('#secName'); if (inp) { inp.focus(); inp.select(); }
      });

      // pistas: clique = posicionar; botão direito (ou Alt+clique) = calar o stem nesta secção
      root.querySelectorAll('canvas[data-arr]').forEach((cv) => {
        const tAt = (e) => { const r = cv.getBoundingClientRect(); return view(app).t(e.clientX - r.left, r.width); };
        const toggle = (e) => {
          const s = app.stem(cv.dataset.arr), i = S().at(st, tAt(e));
          if (!s || i < 0) return;
          MM.commit(st, (S().isMuted(st, i, s.id) ? 'Ativar ' : 'Calar ') + s.label + ' · ' + S().label(st, i));
          S().toggleMute(st, i, s.id);
          app.arr.sel = i;
          V.arrange.changed(app, true);
          UI.toast(`${UI.esc(s.label)} ${S().isMuted(st, i, s.id) ? 'calado' : 'ativo'} em ${UI.esc(S().label(st, i))}.`, 'ok', 1600);
        };
        cv.addEventListener('contextmenu', (e) => { e.preventDefault(); toggle(e); });
        cv.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          if (e.altKey) { toggle(e); return; }
          app.selected = cv.dataset.arr;
          const t = tAt(e);
          app.ensureAudio().then(() => app.engine.seek(t));
        });
      });
      V.arrange._ro = new ResizeObserver(() => V.arrange.drawAll(app));
      V.arrange._ro.observe(wrap);
    },
    unmount() { if (V.arrange._ro) V.arrange._ro.disconnect(); V.arrange._ro = null; },

    /** Depois de editar a estrutura: automação reconstruída, motor reagendado, ecrã atualizado. */
    changed(app, muteOnly) {
      const st = app.state;
      if (muteOnly) { st.dirty.mix = true; st.dirty.master = true; } else S().commit(st);
      app.engine.reschedule();
      if (app.engine.loop) { const L = S().list(st), s = L[app.arr.sel]; if (s) app.setLoop(s); }
      app.saveSoon(); app.renderTop();
      V.arrange.drawAll(app); V.arrange.renderSecBar(app);
    },
    syncTools(app) {
      const root = V.arrange.root; if (!root) return;
      const v = view(app);
      const zl = root.querySelector('#zLbl'); if (zl) zl.textContent = v.z.zoom.toFixed(v.z.zoom < 10 ? 1 : 0).replace('.', ',') + '×';
      const sc = root.querySelector('#arrScroll');
      if (sc) { sc.disabled = v.z.zoom <= 1.001; sc.value = v.dur - v.span > 0 ? Math.round((v.z.t0 / (v.dur - v.span)) * 1000) : 0; UI.rangePct(sc); }
    },

    renderSecBar(app) {
      const root = V.arrange.root; if (!root) return;
      const bar = root.querySelector('#secBar'); if (!bar) return;
      const st = app.state, L = S().list(st), i = app.arr.sel, s = L[i];
      if (!s) { bar.innerHTML = ''; return; }
      const stems = st.stems.filter((x) => !x.removed && x.role !== 'Reference Track');
      const looped = app.engine.loop && Math.abs(app.engine.loop[0] - s.start) < 1e-6;
      const edited = !!st.music.sectionsAI;
      bar.innerHTML = `
        <div class="row" style="gap:10px;flex-wrap:wrap">
          <span class="eyebrow acc">Secção ${i + 1}/${L.length}</span>
          <input id="secName" class="field" list="secNames" value="${UI.esc(s.name)}" style="width:160px;height:32px" title="Nome (a IA usa o nome para a automação: Verso, Pré, Refrão, Bridge…)">
          <datalist id="secNames">${S().NAMES.map((n) => `<option value="${n}">`).join('')}</datalist>
          <span class="mono small dim">compassos ${s.startBar + 1}–${s.endBar} · ${D.fmtTime(s.start).slice(0, 5)}–${D.fmtTime(s.end).slice(0, 5)}</span>
          <span class="spacer"></span>
          <button class="btn sm ${looped ? 'acc' : ''}" data-sa="loop">${UI.icon('loop')}${looped ? 'Loop ligado' : 'Loop'}</button>
          <button class="btn sm" data-sa="split" title="Divide no compasso mais próximo da posição de reprodução">Dividir no cursor</button>
          <button class="btn sm" data-sa="merge" ${i < L.length - 1 ? '' : 'disabled'}>Juntar com a seguinte</button>
          <button class="btn sm" data-sa="del" ${L.length > 1 ? '' : 'disabled'} title="Remove a secção (junta-a à anterior)">Remover</button>
          ${edited ? '<button class="btn sm ghost" data-sa="reset" title="Volta às secções detetadas pela IA">Repor deteção da IA</button>' : ''}
        </div>
        <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap">
          <span class="small muted" style="margin-right:4px">Calar nesta secção:</span>
          ${stems.map((x) => `<button class="chip sm ${S().isMuted(st, i, x.id) ? 'warn' : ''}" data-secmute="${x.id}" title="${S().isMuted(st, i, x.id) ? 'Calado nesta secção — clica para ativar' : 'Clica para calar só nesta secção'}"><i style="width:8px;height:8px;border-radius:50%;background:${UI.colorOf(x)}"></i>${UI.esc(x.short || x.label)}</button>`).join('')}
        </div>`;
      const inp = bar.querySelector('#secName');
      const ren = () => { const v = inp.value.trim(); if (!v || v === s.name) return; MM.commit(st, 'Renomear secção'); V.arrange.backupAI(st); S().rename(st, i, v); V.arrange.changed(app, false); };
      inp.addEventListener('change', ren);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); e.stopPropagation(); });
      bar.querySelectorAll('[data-sa]').forEach((b) => (b.onclick = () => {
        const a = b.dataset.sa;
        if (a === 'loop') { app.setLoop(looped ? null : s); V.arrange.renderSecBar(app); V.arrange.drawAll(app); return; }
        V.arrange.backupAI(st);
        if (a === 'split') {
          const t = app.engine.position();
          MM.commit(st, 'Dividir secção');
          const k = S().split(st, t, false);
          if (k < 0) { MM.history.undo.pop(); UI.toast('Põe o cursor dentro de uma secção, a pelo menos meio segundo das fronteiras.', 'warn'); return; }
          app.arr.sel = k;
        } else if (a === 'merge') { MM.commit(st, 'Juntar secções'); S().mergeNext(st, i); }
        else if (a === 'del') { MM.commit(st, 'Remover secção'); S().remove(st, i); app.arr.sel = Math.max(0, i - 1); }
        else if (a === 'reset') { MM.commit(st, 'Repor secções da IA'); st.music.sections = structuredClone(st.music.sectionsAI); delete st.music.sectionsAI; app.arr.sel = 0; }
        V.arrange.changed(app, false);
      }));
      bar.querySelectorAll('[data-secmute]').forEach((b) => (b.onclick = () => {
        const x = app.stem(b.dataset.secmute);
        MM.commit(st, (S().isMuted(st, i, x.id) ? 'Ativar ' : 'Calar ') + x.label + ' · ' + S().label(st, i));
        S().toggleMute(st, i, x.id);
        V.arrange.changed(app, true);
      }));
    },
    backupAI(st) { if (!st.music.sectionsAI) st.music.sectionsAI = structuredClone(st.music.sections.map((s) => Object.assign({}, s, { mutes: [] }))); },

    drawAll(app) {
      const root = V.arrange.root; if (!root || !root.isConnected) return;
      const st = app.state, v = view(app), L = S().list(st);
      const loop = app.engine.loop;
      // régua
      const rc = root.querySelector('#arrRuler');
      const { ctx, w, h } = UI.fitCanvas(rc);
      ctx.clearRect(0, 0, w, h);
      L.forEach((s, i) => {
        const x0 = v.x(s.start, w), x1 = v.x(s.end, w);
        if (x1 < 0 || x0 > w) return;
        const sel = i === app.arr.sel, lp = loop && Math.abs(loop[0] - s.start) < 1e-6;
        ctx.fillStyle = lp ? 'rgba(94,234,212,.34)' : sel ? 'rgba(94,234,212,.26)' : /Refr/.test(s.name) ? 'rgba(94,234,212,.17)' : 'rgba(94,234,212,.08)';
        ctx.fillRect(x0 + 1, 21, x1 - x0 - 2, 23);
        if (sel) { ctx.strokeStyle = 'rgba(94,234,212,.9)'; ctx.lineWidth = 1.5; ctx.strokeRect(x0 + 1.5, 21.5, x1 - x0 - 3, 22); }
        ctx.save(); ctx.beginPath(); ctx.rect(x0 + 2, 21, Math.max(0, x1 - x0 - 6), 23); ctx.clip();
        ctx.fillStyle = '#dbe7e5'; ctx.font = '12px Geist, Inter, sans-serif'; ctx.fillText(S().label(st, i), Math.max(x0, 0) + 7, 37);
        if (s.mutes && s.mutes.length) { ctx.fillStyle = '#fbbf24'; ctx.font = '10.5px Geist Mono, monospace'; const tw = ctx.measureText('M×' + s.mutes.length).width; ctx.fillText('M×' + s.mutes.length, Math.min(x1, w) - tw - 8, 37); }
        ctx.restore();
        if (i > 0) { ctx.fillStyle = 'rgba(94,234,212,.75)'; ctx.fillRect(x0 - 1, 19, 2, 27); }
      });
      // compassos (densidade adaptada ao zoom)
      const m = st.music, barPx = (m.barSec / v.span) * w;
      const every = [1, 2, 4, 8, 16, 32].find((k) => barPx * k >= 34) || 64;
      ctx.font = '10.5px Geist Mono, monospace';
      const b0 = Math.max(0, Math.floor((v.z.t0 - m.downbeat) / m.barSec / every) * every);
      for (let b = b0; b <= m.bars; b += every) {
        const x = v.x(m.downbeat + b * m.barSec, w);
        if (x > w) break; if (x < -20) continue;
        ctx.fillStyle = '#7c8597'; ctx.fillText(String(b + 1), x + 3, 13); ctx.fillRect(x, 3, 1, 13);
      }
      if (loop) { ctx.fillStyle = 'rgba(94,234,212,.5)'; const a = v.x(loop[0], w), b = v.x(loop[1], w); ctx.fillRect(a, 16, b - a, 3); }

      // pistas
      root.querySelectorAll('canvas[data-arr]').forEach((cv) => {
        const s = app.stem(cv.dataset.arr); if (!s) return;
        const { ctx, w, h } = UI.fitCanvas(cv);
        ctx.clearRect(0, 0, w, h);
        L.forEach((sec, i) => {
          const x0 = v.x(sec.start, w), x1 = v.x(sec.end, w);
          if (x1 < 0 || x0 > w) return;
          if (i === app.arr.sel) { ctx.fillStyle = 'rgba(94,234,212,.05)'; ctx.fillRect(x0, 0, x1 - x0, h); } else if (i % 2) { ctx.fillStyle = 'rgba(255,255,255,.018)'; ctx.fillRect(x0, 0, x1 - x0, h); }
          if (i > 0) { ctx.fillStyle = 'rgba(94,234,212,.18)'; ctx.fillRect(x0, 0, 1, h); }
        });
        pyramid(s);
        const sr = st.sampleRate, c = UI.colorOf(s);
        const norm = s._pyr.mx * D.db2lin(Math.min(0, s.p.trim));
        const g = D.db2lin(s.p.fader + Math.max(0, s.p.trim));
        const ranges = S().muteRanges(st, s.id);
        const muted = (t) => ranges.some(([a, b]) => t >= a && t < b);
        const step = 2, secPerPx = v.span / w;
        for (let x = 0; x < w; x += step) {
          const t = v.z.t0 + x * secPerPx;
          const i0 = Math.floor(t * sr), i1 = Math.floor((t + secPerPx * step) * sr);
          if (i0 >= s.length) break;
          const pk = Math.min(1, (peakAt(s, i0, i1) / norm) * g);
          const off = s.mute || muted(t);
          ctx.globalAlpha = off ? 0.22 : 0.85; ctx.fillStyle = off ? '#7c8597' : c;
          const hh = Math.max(0.5, pk * h * 0.45);
          ctx.fillRect(x, h / 2 - hh, 1.5, hh * 2);
        }
        ctx.globalAlpha = 1;
        // zonas caladas por secção: tracejado + etiqueta
        ranges.forEach(([a, b]) => {
          const x0 = Math.max(0, v.x(a, w)), x1 = Math.min(w, v.x(b, w));
          if (x1 <= x0) return;
          ctx.save(); ctx.beginPath(); ctx.rect(x0, 0, x1 - x0, h); ctx.clip();
          ctx.strokeStyle = 'rgba(251,191,36,.28)'; ctx.lineWidth = 1;
          for (let k = x0 - h; k < x1; k += 9) { ctx.beginPath(); ctx.moveTo(k, h); ctx.lineTo(k + h, 0); ctx.stroke(); }
          ctx.fillStyle = 'rgba(12,15,20,.85)'; ctx.fillRect(x0 + 4, 4, 22, 15); ctx.fillStyle = '#fbbf24'; ctx.font = '600 10.5px Geist Mono, monospace'; ctx.fillText('M', x0 + 11, 15.5);
          ctx.restore();
        });
      });
      V.arrange.syncTools(app);
    },
    frame(app) {
      const root = V.arrange.root; if (!root) return;
      const cv = root.querySelector('#arrHead'); if (!cv) return;
      const { ctx, w, h } = UI.fitCanvas(cv);
      ctx.clearRect(0, 0, w, h);
      const v = view(app), p = app.engine.position();
      // segue a reprodução quando há zoom
      if (app.engine.playing && v.z.zoom > 1.001 && (p > v.z.t0 + v.span * 0.92 || p < v.z.t0)) { v.z.t0 = p - v.span * 0.08; V.arrange.drawAll(app); }
      const x = v.x(p, w);
      if (x >= 0 && x <= w) { ctx.fillStyle = '#fff'; ctx.fillRect(x, 0, 1.5, h); }
    },
  };
})();
