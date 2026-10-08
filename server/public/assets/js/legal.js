// Textos legais publicados (termos, privacidade, reembolsos). Rascunhos só aparecem no modo de testes, marcados como provisórios.
(async function () {
  const { esc, $ } = L;
  const key = { termos: 'terms', privacidade: 'privacy', reembolsos: 'refund' }[document.body.dataset.page];
  await L.chrome('legal');
  L.footer();
  if (!key) return;
  const app = $('#app');
  try {
    const t = await L.get('/api/public/text/' + key);
    if (!t.body) { app.innerHTML = `<h1>${esc(t.title)}</h1><div class="notice">Este texto ainda não foi publicado. A loja abre depois da validação jurídica e da publicação.</div>`; return; }
    app.innerHTML = (t.provisional ? '<div class="notice" style="margin-bottom:22px"><strong>Rascunho não publicado</strong> — visível apenas no modo de testes, sujeito a validação jurídica.</div>' : '') + L.md(t.body) + (t.published_at ? `<p class="small dim" style="margin-top:30px">Publicado em ${esc(L.date(t.published_at))}.</p>` : '');
    document.title = t.title + ' — MIXMIND by Piradex';
  } catch (e) { app.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; }
})();
