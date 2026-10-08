// Checkout: plano → conta → país/faturação → método → resumo calculado no servidor → prestador ou instruções de transferência.
(async function () {
  const { esc, $ } = L;
  const me = await L.chrome('comprar');
  L.footer();
  const S = L.store || {};
  const u = me.user;
  const st = { plan: L.qs('plano') || 'annual', country: (u && u.country) || '', method: '' };
  if (!(S.plans || []).some((p) => p.id === st.plan)) st.plan = (S.plans && S.plans[0] && S.plans[0].id) || '';

  if (S.mode !== 'test' && !S.legalReady) $('#closed').innerHTML = '<div class="notice bad" style="margin-top:18px">A loja abre depois da publicação dos termos, da política de privacidade e da política de reembolsos.</div>';
  if (u && u.role !== 'customer') $('#closed').innerHTML = '<div class="notice" style="margin-top:18px">Tens sessão iniciada com uma conta da equipa. As compras fazem-se com uma conta de cliente.</div>';
  $('#taxNotice').textContent = S.taxNotice || '';

  // 1 · planos
  const per = { month: '/mês', year: '/ano' };
  const drawPlans = () => {
    $('#plans').innerHTML = (S.plans || []).map((p) => `<label class="opt ${st.plan === p.id ? 'on' : ''}"><input type="radio" name="plan" value="${esc(p.id)}" ${st.plan === p.id ? 'checked' : ''}><div><div class="t">${esc(p.name)}</div><div class="d">${esc(L.usd(p.price_usd_cents))}${p.interval ? per[p.interval] : ' · pagamento único'}${p.id === 'annual' && S.annualSaving ? ` · poupa ${esc(S.annualSaving.toLocaleString('pt-PT'))}%` : ''}</div></div></label>`).join('');
    const pl = (S.plans || []).find((p) => p.id === st.plan);
    $('#refundLine').textContent = !pl ? '' : pl.kind === 'perpetual' ? `Licença perpétua: garantia comercial de reembolso de ${S.refundDays || 14} dias.` : 'Subscrição: renova automaticamente com cartão ou PayPal (manual com transferência). Podes cancelar a renovação a qualquer momento e manténs o acesso até ao fim do período pago. Pagamentos de subscrição não reembolsáveis, sem prejuízo dos direitos legais.';
  };
  $('#plans').addEventListener('change', (e) => { st.plan = e.target.value; drawPlans(); quote(); });
  drawPlans();

  // 2 · conta
  $('#acctBody').innerHTML = u
    ? `<p style="margin-top:10px">Vais comprar com a conta <strong>${esc(u.email)}</strong>. <a href="#" id="other">Não és tu?</a></p>${!u.email_verified ? '<p class="small warn-t" style="margin-top:6px">O teu email ainda não está confirmado. Podes comprar, mas as chaves só aparecem depois de confirmares.</p>' : ''}`
    : `<div class="grid g2"><div><label class="f" for="name">Nome</label><input class="field" id="name" maxlength="100" autocomplete="name" required></div><div><label class="f" for="email">Email</label><input class="field" id="email" type="email" maxlength="254" autocomplete="email" required></div></div>
       <label class="f" for="password">Palavra-passe da conta</label><input class="field" id="password" type="password" minlength="10" autocomplete="new-password" required>
       <p class="hint">Pelo menos 10 caracteres. Serve para entrares na área de cliente — não é a chave de licença. Já tens conta? <a href="/entrar?next=${encodeURIComponent('/comprar?plano=' + st.plan)}">Entra primeiro</a>.</p>`;
  const other = $('#other'); if (other) other.onclick = async (e) => { e.preventDefault(); await L.post('/api/auth/logout'); location.reload(); };

  // 3 · país
  $('#country').innerHTML = L.countryOptions(st.country);
  ['billingName', 'billingAddress', 'taxId'].forEach((k) => { const f = { billingName: 'billing_name', billingAddress: 'billing_address', taxId: 'tax_id' }[k]; if (u && u[f]) $('#' + k).value = u[f]; });
  $('#country').onchange = () => { st.country = $('#country').value; loadMethods(); };

  // 4 · métodos (dependem do país)
  let mn = 0;
  async function loadMethods() {
    const n = ++mn;
    if (!st.country) { $('#methods').innerHTML = '<p class="dim small">Escolhe primeiro o país.</p>'; st.method = ''; quote(); return; }
    const ms = await L.get('/api/public/methods?country=' + st.country).catch(() => []);
    if (n !== mn) return; // resposta de um país anterior
    if (!ms.some((m) => m.id === st.method && m.available)) st.method = (ms.find((m) => m.available) || {}).id || '';
    const desc = { card: 'Visa, Mastercard e outros. Página segura da Stripe — não guardamos dados do cartão.', paypal: 'Concluis o pagamento no PayPal.', bank_pt: 'Transferência para conta em Portugal. Envias o comprovativo na área de cliente; a licença é emitida após confirmação.', bank_ao: 'Transferência para conta em Angola. Envias o comprovativo na área de cliente; a licença é emitida após confirmação.', test: 'Só no modo de testes: simula o prestador através de um webhook assinado.' };
    $('#methods').innerHTML = ms.length ? ms.map((m) => `<label class="opt ${st.method === m.id ? 'on' : ''} ${m.available ? '' : 'off'}"><input type="radio" name="method" value="${esc(m.id)}" ${st.method === m.id ? 'checked' : ''} ${m.available ? '' : 'disabled'}><div><div class="t">${esc(m.label)} ${m.currency && m.currency !== 'USD' ? `<span class="tag">${esc(m.currency)}</span>` : ''} ${m.example ? '<span class="tag warn">dados de exemplo</span>' : ''}</div><div class="d">${esc(m.available ? desc[m.id] || '' : 'Indisponível de momento' + (m.why ? ' — ' + m.why : '') + '.')}</div></div></label>`).join('')
      : '<div class="notice">Não há métodos de pagamento disponíveis para este país. Contacta o suporte.</div>';
    quote();
  }
  $('#methods').addEventListener('change', (e) => { st.method = e.target.value; L.$$('#methods .opt').forEach((o) => o.classList.toggle('on', o.querySelector('input').checked)); quote(); });

  // resumo — preço calculado no servidor
  let qn = 0;
  async function quote() {
    const n = ++qn;
    if (!st.plan || !st.method || !st.country) { $('#sum').innerHTML = '<p class="dim small">Escolhe o plano, o país e o método.</p>'; return; }
    try {
      const q = await L.get(`/api/public/quote?plan=${st.plan}&method=${st.method}&country=${st.country}`);
      if (n !== qn) return;
      const per2 = q.plan.interval ? per[q.plan.interval] : '';
      $('#sum').innerHTML = `<div class="sumrow"><span>${esc(q.plan.name)}</span><span>${esc(q.net)}</span></div>
        ${q.tax_cents ? `<div class="sumrow muted"><span>${esc(q.tax_label || 'Imposto')} (${q.tax_rate}%)</span><span>${esc(q.tax)}</span></div>` : q.tax_mode === 'included' && q.tax_rate ? `<div class="sumrow muted"><span>${esc(q.tax_label || 'Imposto')} incluído</span><span></span></div>` : ''}
        <div class="sumrow tot"><span>Total</span><span>${esc(q.total)}<span class="small muted" style="font-weight:500">${per2}</span></span></div>
        ${q.currency !== 'USD' ? `<p class="tiny dim" style="margin-top:8px">Preço base ${esc(q.usd)} · câmbio aplicado: 1 USD = ${esc(String(q.fx).replace('.', ','))} ${esc(q.currency)}${S.mode === 'test' ? ' (exemplo de testes)' : ''}. Pagamento em ${esc(q.currency)}.</p>` : ''}`;
    } catch (e) { if (n === qn) $('#sum').innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; }
  }
  if (st.country) loadMethods();

  // submeter
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const b = { plan: st.plan, method: st.method, country: st.country, billingName: $('#billingName').value, billingAddress: $('#billingAddress').value, taxId: $('#taxId').value, acceptTerms: $('#acceptTerms').checked, acceptPrivacy: $('#acceptPrivacy').checked };
    if (!u) Object.assign(b, { name: $('#name').value, email: $('#email').value, password: $('#password').value });
    if (!st.country) return L.toast('Escolhe o país.', 'warn');
    if (!st.method) return L.toast('Escolhe um método de pagamento disponível.', 'warn');
    if (!b.acceptTerms || !b.acceptPrivacy) return L.toast('Tens de aceitar os termos e a política de privacidade.', 'warn');
    const go = $('#go'); go.disabled = true; go.textContent = 'A preparar o pagamento…';
    try {
      const r = await L.post('/api/checkout', b);
      location.href = r.redirect;
    } catch (err) {
      L.err(err); go.disabled = false; go.textContent = 'Continuar para o pagamento';
      if (err.code === 'EMAIL_EXISTE') $('#acctBody').insertAdjacentHTML('beforeend', `<div class="notice info" style="margin-top:12px">Já existe uma conta com este email. <a href="/entrar?next=${encodeURIComponent('/comprar?plano=' + st.plan)}">Entra</a> para continuar a compra.</div>`);
    }
  };
})();
