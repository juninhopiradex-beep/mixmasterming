/* MixMind — vistas Arranjo e Análise */
(function () {
  const MM = window.MM, D = MM.dsp, UI = MM.ui;
  const V = (MM.views = MM.views || {});

  // ================= ARRANJO =================
  V.arrange = {
    flush: true,
    render(app) {
      const st = app.state, stems = st.stems.filter((s) => !s.removed);
      return `<div style="display:grid;grid-template-columns:230px minmax(0,1fr);height:100%;overflow:auto">
        <div style="border-right:1px solid var(--line)"><div style="height:46px;border-bottom:1px solid var(--line)"></div>
          ${stems.map((s) => `<div class="row" style="height:58px;padding:0 14px;border-bottom:1px solid var(--line);gap:8px"><span style="width:9px;height:9px;border-radius:50%;background:${UI.colorOf(s)}"></span><div style="flex:1;min-width:0"><b style="font-size:13.5px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${UI.esc(s.label)}</b><small class="dim mono">${UI.fmtDb(s.p.fader)} dB · ${MM.panLabel(s.p.pan)}</small></div><button class="btn xs ${s.solo ? 'warn' : ''}" data-solo="${s.id}">S</button><button class="btn xs ${s.mute ? 'warn' : ''}" data-mute="${s.id}">M</button></div>`).join('')}
        </div>
        <div style="position:relative" id="arrWrap">
          <canvas id="arrRuler" style="width:100%;height:46px;display:block;border-bottom:1px solid var(--line)"></canvas>
          ${stems.map((s) => `<div style="height:58px;border-bottom:1px solid var(--line);padding:6px 0"><canvas data-arr="${s.id}" style="width:100%;height:100%;display:block"></canvas></div>`).join('')}
          <canvas id="arrHead" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"></canvas>
        </div>
      </div>`;
    },
    mount(app, root) {
      const st = app.state, dur = st.music.duration;
      root.querySelectorAll('canvas[data-arr]').forEach((cv) => {
        const s = app.stem(cv.dataset.arr);
        if (!s.peaksHi) s.peaksHi = MM.peaks(s.chs, 1600);
        const { ctx, w, h } = UI.fitCanvas(cv);
        ctx.fillStyle = 'rgba(255,255,255,.02)'; ctx.fillRect(0, 0, w, h);
        st.music.sections.forEach((sec, i) => { if (i % 2) { ctx.fillStyle = 'rgba(255,255,255,.018)'; ctx.fillRect((sec.start / dur) * w, 0, ((sec.end - sec.start) / dur) * w, h); } });
        const pk = s.peaksHi, n = pk.length, c = UI.colorOf(s);
        let mx = 1e-4; for (let i = 0; i < n; i++) mx = Math.max(mx, pk[i]);
        const g = D.db2lin(s.p.trim + s.p.fader);
        ctx.fillStyle = c; ctx.globalAlpha = s.mute ? 0.25 : 0.85;
        const xLen = (s.length / st.sampleRate / dur) * w;
        for (let x = 0; x < xLen; x += 2) { const v = Math.min(1, (pk[Math.floor((x / xLen) * n)] * g) / Math.min(1, mx * D.db2lin(s.p.trim))) ; ctx.fillRect(x, h / 2 - v * h * 0.45, 1.5, Math.max(1, v * h * 0.9)); }
        ctx.globalAlpha = 1;
        cv.onpointerdown = (e) => { const r = cv.getBoundingClientRect(); app.ensureAudio().then(() => app.engine.seek(((e.clientX - r.left) / r.width) * dur)); };
      });
      const rc = root.querySelector('#arrRuler');
      const { ctx, w, h } = UI.fitCanvas(rc);
      st.music.sections.forEach((s, i) => {
        const x0 = (s.start / dur) * w, x1 = (s.end / dur) * w;
        ctx.fillStyle = /Refr/.test(s.name) ? 'rgba(94,234,212,.22)' : 'rgba(94,234,212,.1)';
        ctx.fillRect(x0 + 1, 22, x1 - x0 - 2, 22);
        ctx.fillStyle = '#dbe7e5'; ctx.font = '12px Geist, Inter, sans-serif'; ctx.fillText(s.name, x0 + 6, 37);
      });
      ctx.fillStyle = '#7c8597'; ctx.font = '10.5px Geist Mono, monospace';
      for (let b = 0; b <= st.music.bars; b += 8) { const x = ((st.music.downbeat + b * st.music.barSec) / dur) * w; ctx.fillText(String(b + 1), x + 2, 14); ctx.fillRect(x, 16, 1, 5); }
      rc.onpointerdown = (e) => { const r = rc.getBoundingClientRect(); const t = ((e.clientX - r.left) / r.width) * dur; const s = st.music.sections.find((x) => t >= x.start && t < x.end); if (s) app.setLoop(app.engine.loop && app.engine.loop[0] === s.start ? null : s); };
      root.querySelectorAll('[data-solo]').forEach((b) => (b.onclick = () => app.change('Solo', () => { const s = app.stem(b.dataset.solo); s.solo = !s.solo; }, { allStems: true })));
      root.querySelectorAll('[data-mute]').forEach((b) => (b.onclick = () => app.change('Mute', () => { const s = app.stem(b.dataset.mute); s.mute = !s.mute; }, { allStems: true })));
    },
    frame(app) {
      const cv = document.getElementById('arrHead'); if (!cv) return;
      const { ctx, w, h } = UI.fitCanvas(cv);
      ctx.clearRect(0, 0, w, h);
      const x = (app.engine.position() / app.engine.duration()) * w;
      ctx.fillStyle = '#fff'; ctx.fillRect(x, 0, 1.5, h);
    },
  };

  // ================= ANÁLISE =================
  const HOFF = { P: 0, S: 0.08, B: 0.2 };
  const depthOf = (s) => D.clamp(0.1 + (s.p.sendRev <= -59 ? 0 : D.clamp((s.p.sendRev + 26) / 26, 0, 1) * 0.65) + (HOFF[s.hier] || 0), 0, 1);
  const sendFromDepth = (s, d) => { const x = (d - 0.1 - (HOFF[s.hier] || 0)) / 0.65; return x <= 0.02 ? -60 : +(-26 + D.clamp(x, 0, 1) * 26).toFixed(1); };
  const zone = (d) => (d < 0.34 ? 'Frente' : d < 0.67 ? 'Meio' : 'Fundo');

  V.analysis = {
    render(app) {
      const st = app.state, sc = st.score;
      const bars = sc ? [['Balance', sc.balance], ['Dynamics', sc.dynamics], ['Low-End Control', sc.lowEnd], ['Loudness', sc.loudness], ['Clarity', sc.clarity], ['Stereo Image', sc.stereo], ['Vocal Presence', sc.vocal], ['Phase Integrity', sc.phase]] : [];
      return `<div class="ana">
        <div class="panel p"><div class="panel-title"><div class="eyebrow">Stereo field</div><span class="small muted">Arrasta: ← → pan · ↑ ↓ profundidade</span></div><div class="cvbox"><canvas id="sf" class="cv" style="height:440px"></canvas><div class="tooltip" id="sfTip" style="display:none"></div></div></div>
        <div class="panel p"><div class="panel-title"><div class="eyebrow">Mapa de frequências · 20 Hz – 20 kHz</div><span class="small muted"><span style="display:inline-block;width:12px;height:8px;border:1.5px dashed var(--bad);vertical-align:0"></span> masking detetado · clica numa zona para ver a correção</span></div><div class="cvbox"><canvas id="fm" class="cv" style="height:440px"></canvas><div class="tooltip" id="fmTip" style="display:none"></div></div><div id="fmInfo" class="small muted" style="min-height:22px;margin-top:10px"></div></div>
      </div>
      <div class="panel p" style="margin-top:18px">
        ${sc ? `<div class="score-grid">
          <div><div class="eyebrow">Mix quality score</div><div class="scorebig" style="font-size:84px;margin-top:10px">${sc.overall}</div><div class="muted">de 100 · ${UI.esc(st.currentVersionName || 'Mix')}${st.scoreOrig ? ` · original ${st.scoreOrig}` : ''}</div></div>
          <div>${bars.slice(0, 4).map(([l, v]) => `<div class="sbar"><span>${l}</span><div class="bar"><i class="${v < 88 ? 'mid' : ''}" style="width:${v}%"></i></div><span>${v}</span></div>`).join('')}</div>
          <div>${bars.slice(4).map(([l, v]) => `<div class="sbar"><span>${l}</span><div class="bar"><i class="${v < 88 ? 'mid' : ''}" style="width:${v}%"></i></div><span>${v}</span></div>`).join('')}</div>
          <div><div class="eyebrow">Recomendações</div>${sc.recs.map((r, i) => `<div class="rec"><span>${UI.esc(r.text)}</span><button class="btn sm acc" data-rec="${i}">${r.label}</button></div>`).join('')}</div>
        </div>` : `<div class="empty-note">O score aparece depois do AI Mix &amp; Master. <button class="btn primary sm" data-act="ai" style="margin-left:10px">${UI.icon('spark')}Correr agora</button></div>`}
      </div>`;
    },
    mount(app, root) {
      const st = app.state;
      V.analysis.drawSF(app, root);
      V.analysis.drawFM(app, root);
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
        if (!drag) { const p = pick(e); cv.style.cursor = p ? 'grab' : 'default'; return; }
        const L = V.analysis._sfGeom;
        const pan = D.clamp(((e.clientX - r.left - L.x0) / L.w) * 2 - 1, -1, 1);
        const depth = D.clamp(1 - (e.clientY - r.top - L.y0) / L.h, 0, 1);
        const s = drag.s;
        s.p.pan = Math.round(pan * 100) / 100;
        s.p.sendRev = sendFromDepth(s, depth);
        s.manual.pan = true; s.manual.sendRev = true;
        app.engine.graph && app.engine.graph.applyStem(s);
        tip.style.display = 'block'; tip.style.left = e.clientX - r.left + 14 + 'px'; tip.style.top = e.clientY - r.top - 30 + 'px';
        tip.textContent = `${s.label} → ${MM.panLabel(s.p.pan)} · ${zone(depth)}`;
        V.analysis.drawSF(app, root);
      });
      cv.addEventListener('pointerup', () => { if (drag) { drag = null; tip.style.display = 'none'; st.dirty.mix = true; app.renderTop(); app.saveSoon(); } });
      // clique no mapa de frequências
      const fm = root.querySelector('#fm'), info = root.querySelector('#fmInfo');
      fm.addEventListener('click', (e) => {
        const r = fm.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        const box = (V.analysis._fmBoxes || []).find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
        if (!box) { info.innerHTML = ''; return; }
        const c = box.c;
        const ex = (st.explain || []).find((e2) => e2.module === 'Masking' && e2.stem === c.b);
        info.innerHTML = `<b style="color:var(--text)">${UI.esc(c.aName)} × ${UI.esc(c.bName)} · ${D.fmtHz(c.freq)}</b> — ${Math.round(c.overlap * 100)} % de sobreposição · correção: <span class="acc-t">${UI.esc(c.action || 'nenhuma')}</span>${ex ? '<br>' + UI.esc(ex.text) : ''}`;
        app.selected = c.b;
      });
      root.querySelectorAll('[data-rec]').forEach((b) => (b.onclick = () => V.analysis.applyRec(app, st.score.recs[+b.dataset.rec])));
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
          UI.confirm('Fase e compatibilidade mono', `Correlação mínima ${UI.fmtNum(st.metrics.master.corrMin, 2)}. Posso estreitar os pares estéreo (${pairs.map((s) => s.label).join(', ') || 'nenhum par'}) em 15 % e baixar a largura do master para 100 %.`, 'Aplicar').then((ok) => {
            if (ok) app.change('Corrigir correlação', () => { pairs.forEach((s) => { s.p.pan *= 0.85; s.manual.pan = true; }); st.master.width = Math.min(st.master.width, 100); st.master.manual.ms = true; }, { allStems: true, master: true });
          });
          break;
        }
        case 'remaster': app.runAI({ keepMix: true }); break;
        case 'compare': app.go('compare'); break;
      }
    },
    drawSF(app, root) {
      const cv = root.querySelector('#sf'); if (!cv) return;
      const { ctx, w, h } = UI.fitCanvas(cv);
      const st = app.state, stems = st.stems.filter((s) => !s.removed);
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
      const place = (txt, x, y) => {
        ctx.font = '12.5px Geist, Inter, sans-serif';
        const tw = ctx.measureText(txt).width;
        for (const dy of [0, 15, -15, 30, -30, 45]) {
          const r = { x, y: y + dy - 11, w: tw, h: 14 };
          if (!labels.some((q) => r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h)) { labels.push(r); ctx.fillText(txt, x, y + dy); return; }
        }
        ctx.fillText(txt, x, y);
      };
      stems.slice().sort((a, b) => depthOf(b) - depthOf(a)).forEach((s) => {
        const d = depthOf(s), x = x0 + ((s.p.pan + 1) / 2) * gw, y = y0 + (1 - d) * gh;
        const lv = D.clamp((s.p.fader + 20) / 22, 0.2, 1.2);
        const r = 10 + lv * 16 * (s.hier === 'P' ? 1.15 : s.hier === 'B' ? 0.8 : 1);
        const col = UI.colorOf(s);
        const wide = s.chs.length > 1 && s.features && s.features.width > 0.25;
        ctx.globalAlpha = 0.9;
        if (wide || s.role === 'Pad' || s.role === 'Strings') {
          const ew = Math.min(gw * 0.32, 60 + (s.features ? s.features.width : 0.5) * 220);
          ctx.beginPath(); ctx.ellipse(x, y, ew, r * 1.2, 0, 0, Math.PI * 2);
          ctx.fillStyle = col + '22'; ctx.fill(); ctx.strokeStyle = col + 'aa'; ctx.lineWidth = 1.5; ctx.stroke();
        } else {
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = col + '40'; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = app.selected === s.id ? 2.5 : 1.5; ctx.stroke();
          if (app.selected === s.id) { ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(x, y, r + 6, 0, Math.PI * 2); ctx.strokeStyle = '#5eead4'; ctx.stroke(); ctx.setLineDash([]); }
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#e9edf4';
        place(s.short || s.label, x + r + 6, y + 4);
        pts.push({ s, x, y, r });
      });
      V.analysis._sfPts = pts;
    },
    drawFM(app, root) {
      const cv = root.querySelector('#fm'); if (!cv) return;
      const { ctx, w, h } = UI.fitCanvas(cv);
      const st = app.state, stems = st.stems.filter((s) => !s.removed && s.features);
      const x0 = 120, gw = w - x0 - 10, top = 22, rows = stems.length + 1, rh = Math.min(30, (h - top - 8) / rows);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#7c8597'; ctx.font = '11px Geist Mono, monospace';
      [[20, '20'], [50, '50'], [100, '100'], [200, '200'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k'], [20000, '20k']].forEach(([f, t]) => { const x = x0 + (Math.log10(f / 20) / 3) * gw; ctx.fillText(t, Math.min(x - 6, w - 24), 12); ctx.fillStyle = 'rgba(255,255,255,.04)'; ctx.fillRect(x, top, 1, rows * rh); ctx.fillStyle = '#7c8597'; });
      const bandX = (k) => x0 + (Math.log10(D.thirdOctEdges[k][0] / 20) / 3) * gw;
      const bandW = (k) => x0 + (Math.log10(Math.min(20000, D.thirdOctEdges[k][1]) / 20) / 3) * gw - bandX(k);
      const sum = new Float64Array(31);
      const levels = stems.map((s) => {
        const f = s.features, nb = f.bandFrames, L = new Float64Array(31);
        for (let t = 0; t < nb; t++) for (let k = 0; k < 31; k++) L[k] += f.bandTL[t * 31 + k];
        const off = s.p.trim + s.p.fader;
        const out = Array.from(L, (v) => 10 * Math.log10(v / nb + 1e-14) + off);
        out.forEach((v, k) => (sum[k] += Math.pow(10, v / 10)));
        return out;
      });
      const gmax = Math.max(...levels.flat());
      stems.forEach((s, i) => {
        const y = top + i * rh, col = UI.colorOf(s);
        ctx.fillStyle = '#c9d1dc'; ctx.font = '12.5px Geist, Inter, sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(s.short || s.label, x0 - 10, y + rh / 2 + 4); ctx.textAlign = 'left';
        for (let k = 0; k < 31; k++) {
          const a = D.clamp((levels[i][k] - (gmax - 48)) / 48, 0, 1);
          ctx.fillStyle = col; ctx.globalAlpha = 0.06 + a * a * 0.9;
          ctx.fillRect(bandX(k) + 0.5, y + 2, Math.max(1, bandW(k) - 1), rh - 4);
        }
        ctx.globalAlpha = 1;
      });
      // soma: excesso / vazios
      const y = top + stems.length * rh;
      ctx.fillStyle = '#c9d1dc'; ctx.textAlign = 'right'; ctx.fillText('Soma', x0 - 10, y + rh / 2 + 4); ctx.textAlign = 'left';
      const sdb = Array.from(sum, (v) => 10 * Math.log10(v + 1e-14));
      const smax = Math.max(...sdb);
      for (let k = 0; k < 31; k++) {
        const rel = sdb[k] - smax;
        const ex = k > 0 && k < 30 ? sdb[k] - (sdb[k - 1] + sdb[k + 1]) / 2 : 0;
        ctx.fillStyle = ex > 4 ? '#fbbf24' : rel < -45 ? 'rgba(255,255,255,.03)' : '#5eead4';
        ctx.globalAlpha = ex > 4 ? 0.85 : 0.12 + D.clamp((rel + 45) / 45, 0, 1) * 0.6;
        ctx.fillRect(bandX(k) + 0.5, y + 2, Math.max(1, bandW(k) - 1), rh - 4);
      }
      ctx.globalAlpha = 1;
      // caixas de masking
      const boxes = [], placed = [];
      const nm = (id) => { const s = stems.find((x) => x.id === id); return s ? s.short || s.label : '?'; };
      (st.conflicts || []).slice(0, 8).forEach((c) => {
        const ia = stems.findIndex((s) => s.id === c.a), ib = stems.findIndex((s) => s.id === c.b);
        if (ia < 0 || ib < 0) return;
        const k0 = Math.max(0, c.band - 1), k1 = Math.min(30, c.band + 1);
        const bx = bandX(k0), bw = bandX(k1) + bandW(k1) - bx;
        [ia, ib].forEach((ri) => {
          const by = top + ri * rh + 1;
          ctx.setLineDash([4, 3]); ctx.strokeStyle = c.action && c.action !== 'nenhuma' ? 'rgba(251,113,133,.9)' : '#fb7185'; ctx.lineWidth = 1.5;
          ctx.strokeRect(bx, by, bw, rh - 2); ctx.setLineDash([]);
          boxes.push({ x: bx, y: by, w: bw, h: rh, c });
        });
        const txt = `${nm(c.a)} × ${nm(c.b)} · ${D.fmtHz(c.freq)}`;
        ctx.font = '11.5px Geist Mono, monospace';
        const tw = ctx.measureText(txt).width;
        const lx = Math.min(bx + bw + 6, w - tw - 8);
        for (const ri of [Math.min(ia, ib), Math.max(ia, ib), Math.min(ia, ib) + 1]) {
          const ly = top + ri * rh + rh / 2 + 4;
          const r = { x: lx - 3, y: ly - 12, w: tw + 6, h: 16 };
          if (placed.some((q) => r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h)) continue;
          placed.push(r);
          ctx.fillStyle = 'rgba(10,12,16,.88)'; ctx.fillRect(r.x, r.y, r.w, r.h);
          ctx.fillStyle = '#fda4af'; ctx.fillText(txt, lx, ly);
          break;
        }
      });
      V.analysis._fmBoxes = boxes;
    },
  };
})();
