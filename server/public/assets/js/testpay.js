// Prestador de pagamento SIMULADO (só no modo de testes). Os resultados entram pelo mesmo caminho dos webhooks reais
// (evento assinado → idempotência → confirmação no servidor); esta página nunca emite licenças por si.
(async function () {
  const { esc, $ } = L;
  const me = await L.chrome('testpay');
  L.footer();
  const app = $('#app'), ref = L.qs('ref') || '';
  if (!me.user) { location.replace('/entrar?next=' + encodeURIComponent(location.pathname + location.search)); return; }
  async function draw() {
    let o;
    try { o = await L.get('/api/test/order/' + encodeURIComponent(ref)); } catch (e) { app.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
    const paid = o.status === 'confirmed', sub = o.subscription;
    const btn = (k, label, cls) => `<button class="btn ${cls || ''}" data-o="${k}">${esc(label)}</button>`;
    app.innerHTML = `<span class="tag warn">Prestador simulado · modo de testes</span><h2 style="margin-top:12px">Pagamento simulado</h2>
      <p class="muted small" style="margin-top:6px">Simula a resposta do prestador. Cada botão envia um evento assinado ao webhook — o mesmo caminho usado pela Stripe e pelo PayPal.</p>
      <dl class="kv" style="margin-top:18px"><dt>Encomenda</dt><dd class="mono">${esc(o.ref)}</dd><dt>Plano</dt><dd>${esc(o.plan)}</dd><dt>Valor</dt><dd>${esc(o.amount)}</dd><dt>Estado</dt><dd>${L.statusTag(o.status)}</dd>${sub ? `<dt>Subscrição</dt><dd>${L.statusTag(sub.status)} até ${esc(L.date(sub.until))}</dd>` : ''}</dl>
      <div class="row wrapx" style="margin-top:20px">
        ${!paid && o.status !== 'refunded' ? btn('paid', 'Pagamento aprovado', 'primary') + btn('failed', 'Pagamento recusado', 'danger') : ''}
        ${paid && sub ? btn('renew', 'Simular renovação paga') + btn('renew_failed', 'Simular renovação falhada') : ''}
        ${paid ? btn('refund', 'Reembolso') + btn('dispute', 'Contestação (chargeback)', 'danger') : ''}
      </div>
      <hr class="sep"><a class="btn block acc" href="/conta#encomenda/${encodeURIComponent(o.ref)}">Ver a encomenda na minha conta</a>`;
    L.$$('[data-o]', app).forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      try { const r = await L.post('/api/test/simulate', { ref: o.ref, outcome: b.dataset.o }); L.toast(r.duplicate ? 'Evento repetido — ignorado (idempotente).' : 'Evento processado pelo servidor.'); } catch (e) { L.err(e); }
      draw();
    }));
  }
  draw();
})();
