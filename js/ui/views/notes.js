/* MIXMIND — Notas do Motor: registo consolidado de todas as decisões (faixa processada, ajuste realizado e motivo).
 * Fonte: state.explain (mistura, por stem) e state.masterExplain (master). Filtros, pesquisa e exportação CSV/TXT. */
(function () {
  const MM = window.MM, UI = MM.ui;
  const V = (MM.views = MM.views || {});

  /** Separa "ajuste: motivo" (o motor escreve as notas nesse formato). */
  function split(text) {
    const t = String(text || '');
    const i = t.indexOf(': ');
    if (i > 0 && i < 140) return [t.slice(0, i), t.slice(i + 2)];
    return [t, ''];
  }
  function rows(st) {
    const out = [];
    (st.explain || []).forEach((e) => { const [adj, why] = split(e.text); out.push({ track: e.stemName || 'Mix bus', stem: e.stem, module: e.module, adj, why, conf: e.conf }); });
    (st.masterExplain || []).forEach((e) => { const [adj, why] = split(e.text); out.push({ track: 'Master', stem: '__master', module: e.module, adj, why, conf: e.conf }); });
    // agrupar por faixa (ordem da sessão; Mix bus e Master no fim), mantendo a ordem das decisões dentro de cada faixa
    const order = new Map((st.stems || []).map((s, i) => [s.id, i]));
    const rank = (r) => (r.stem === '__master' ? 1e6 + 1 : r.stem == null ? 1e6 : order.has(r.stem) ? order.get(r.stem) : 5e5);
    return out.map((r, i) => [r, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((x) => x[0]);
  }

  V.notes = {
    render(app) {
      const st = app.state, all = rows(st), f = (app.notesF = app.notesF || { track: '', module: '', q: '' });
      if (!all.length) return `<div class="empty-note"><h2>Notas do Motor</h2><p>Ainda não há decisões registadas. Corre o <b>AI Mix &amp; Master</b> e cada ajuste aparece aqui, com o motivo.</p></div>`;
      const tracks = [...new Set(all.map((r) => r.track))], modules = [...new Set(all.map((r) => r.module))].sort();
      const q = f.q.toLowerCase();
      const list = all.filter((r) => (!f.track || r.track === f.track) && (!f.module || r.module === f.module) && (!q || (r.track + ' ' + r.module + ' ' + r.adj + ' ' + r.why).toLowerCase().includes(q)));
      let last = null;
      const body = list.map((r) => {
        const g = r.track !== last ? `<tr class="grp"><td colspan="4">${UI.esc(r.track)}</td></tr>` : ''; last = r.track;
        return `${g}<tr><td class="trk">${UI.esc(r.module)}</td><td>${UI.esc(r.adj)}</td><td class="why">${UI.esc(r.why || '—')}</td><td title="Confiança ${Math.round((r.conf || 0) * 100)} %"><span class="confbar"><i style="width:${Math.round((r.conf || 0) * 100)}%"></i></span></td></tr>`;
      }).join('');
      return `<div style="max-width:1200px">
        <h1>Notas do Motor</h1><p class="muted" style="margin:6px 0 18px">Todas as decisões da IA nesta versão: <b>faixa processada</b>, <b>ajuste realizado</b> e <b>motivo</b>. ${all.length} notas em ${tracks.length} faixas. As alterações manuais prevalecem sobre estas decisões.</p>
        <div class="notes-tools">
          <select class="field" id="nTrack"><option value="">Todas as faixas</option>${tracks.map((t) => `<option ${f.track === t ? 'selected' : ''}>${UI.esc(t)}</option>`).join('')}</select>
          <select class="field" id="nMod"><option value="">Todos os módulos</option>${modules.map((m) => `<option ${f.module === m ? 'selected' : ''}>${UI.esc(m)}</option>`).join('')}</select>
          <input class="field" id="nQ" placeholder="Procurar (ex.: 200 Hz, de-esser)" value="${UI.esc(f.q)}" style="min-width:260px">
          <span class="spacer" style="flex:1"></span>
          <button class="btn sm ghost" id="nCsv">${UI.icon('download')}CSV</button><button class="btn sm ghost" id="nTxt">${UI.icon('download')}TXT</button>
        </div>
        <div class="panel" style="padding:4px 8px;overflow-x:auto"><table class="mm-notes"><thead><tr><th style="width:150px">Módulo</th><th>Ajuste realizado</th><th>Motivo</th><th style="width:70px">Conf.</th></tr></thead><tbody>${body || '<tr><td colspan="4" class="muted">Nenhuma nota com estes filtros.</td></tr>'}</tbody></table></div>
      </div>`;
    },
    mount(app, root) {
      const f = app.notesF;
      const on = (id, ev, fn) => { const el = root.querySelector(id); if (el) el[ev] = fn; };
      on('#nTrack', 'onchange', (e) => { f.track = e.target.value; app.refresh(); });
      on('#nMod', 'onchange', (e) => { f.module = e.target.value; app.refresh(); });
      on('#nQ', 'onkeydown', (e) => { if (e.key === 'Enter') { f.q = e.target.value; app.refresh(); } });
      const name = (app.state.project.name || 'MIXMIND').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40);
      on('#nCsv', 'onclick', () => {
        const q = (s) => '"' + String(s || '').replace(/"/g, '""') + '"';
        const csv = '﻿Faixa;Módulo;Ajuste;Motivo;Confiança\r\n' + rows(app.state).map((r) => [r.track, r.module, r.adj, r.why, Math.round((r.conf || 0) * 100) + '%'].map(q).join(';')).join('\r\n');
        MM.exporter.download(csv, name + '_NotasDoMotor.csv', 'text/csv');
      });
      on('#nTxt', 'onclick', () => {
        let last = null;
        const txt = `MIXMIND by Piradex — Notas do Motor\n${app.state.project.name} · ${app.state.currentVersionName || 'Mix'} · ${new Date().toLocaleString('pt-PT')}\n` + rows(app.state).map((r) => { const h = r.track !== last ? `\n== ${r.track} ==\n` : ''; last = r.track; return `${h}- [${r.module}] ${r.adj}${r.why ? ' — ' + r.why : ''}`; }).join('\n') + '\n';
        MM.exporter.download(txt, name + '_NotasDoMotor.txt', 'text/plain');
      });
    },
  };
})();
