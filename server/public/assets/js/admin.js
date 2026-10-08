// Administração (SPA por hash). O menu mostra só o que o perfil pode fazer, mas TODAS as permissões são verificadas no servidor.
(async function () {
  const { esc, $, $$ } = L;
  const me = await L.chrome('admin');
  const main = $('#main'), side = $('#side');
  const U = me.user;
  if (!U) { location.replace('/entrar?next=/admin'); return; }
  if (U.role === 'customer') { location.replace('/conta'); return; }
  if (me.mfaPending || U.must_change_password) { location.replace('/entrar?next=/admin'); return; }
  const can = (p) => (me.perms || []).includes(p);
  const head = (h, sub, right) => `<div class="row between wrapx" style="align-items:flex-end"><div><h1 style="font-size:28px">${esc(h)}</h1>${sub ? `<p class="sub muted" style="margin-top:4px">${sub}</p>` : ''}</div>${right || ''}</div><div style="height:18px"></div>`;
  const ask = (title, text, ok, opts) => L.confirm(title, text, ok, opts);
  const yes = (b) => (b ? '<span class="tag ok">sim</span>' : '<span class="tag">não</span>');
  const reload = () => route();

  const NAV = [
    ['Operação'], ['painel', 'adm.dashboard', 'dashboard.view'], ['transferencias', 'adm.transfers', 'orders.view'], ['encomendas', 'adm.orders', 'orders.view'], ['clientes', 'adm.customers', 'customers.view'], ['licencas', 'adm.licenses', 'licenses.view'], ['subscricoes', 'adm.subs', 'licenses.view'], ['eventos', 'adm.events', 'payments.events'],
    ['Configuração'], ['configuracoes', 'adm.settings', 'settings.view'], ['textos', 'adm.texts', 'settings.view'], ['equipa', 'adm.staff', 'staff.manage'], ['auditoria', 'adm.audit', 'audit.view'], ['emails', 'adm.emails', 'emails.view'], ['seguranca', 'adm.me', null],
  ];
  const ALIAS = { transferencia: 'transferencias', encomenda: 'encomendas', cliente: 'clientes', licenca: 'licencas', texto: 'textos' };
  let badge = 0;
  const drawSide = (cur) => {
    side.innerHTML = `<div style="padding:4px 12px 10px"><div class="small" style="font-weight:600">${esc(U.name)}</div><div class="tiny dim">${esc(me.roleLabel)}</div></div>` + NAV.map((n) => n.length === 1 ? `<div class="grp">${esc(n[0])}</div>` : (!n[2] || can(n[2])) ? `<a href="#${n[0]}" class="${cur === n[0] || ALIAS[cur] === n[0] ? 'on' : ''}">${esc(t(n[1]))}${n[0] === 'transferencias' && badge ? `<span class="n">${badge}</span>` : ''}</a>` : '').join('');
  };

  const V = {};
  // ---------------- painel ----------------
  V.painel = async () => {
    const days = +(sessionStorage.getItem('mm.adm.days') || 30);
    const d = await L.get('/api/admin/dashboard?from=' + (Date.now() - days * 864e5));
    badge = d.proofsToReview; drawSide('painel');
    const byCur = {}; d.daily.forEach((x) => { (byCur[x.currency] = byCur[x.currency] || {})[x.d] = x.v; });
    const dayList = Array.from({ length: days }, (_, i) => new Date(Date.now() - (days - 1 - i) * 864e5).toISOString().slice(0, 10));
    const k = (label, v, sub, cls) => `<div class="card kpi"><div class="k">${esc(label)}</div><div class="v ${cls || ''}">${v}</div>${sub ? `<div class="small muted">${sub}</div>` : ''}</div>`;
    main.innerHTML = head(t('adm.dashboard'), 'Receita por moeda — moedas diferentes nunca são somadas.', `<div class="row">${[7, 30, 90].map((n) => `<button class="btn sm ${n === days ? 'acc' : 'ghost'}" data-days="${n}">${n} dias</button>`).join('')}</div>`) + `
      ${d.warnings.length ? `<div class="notice" style="margin-bottom:16px"><strong>Por configurar antes de vender</strong><ul style="margin:8px 0 0;padding-left:18px">${d.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
      <div class="grid g4">${d.revenue.length ? d.revenue.map((r) => k(`Receita ${r.currency}`, esc(r.grossFmt), `${r.n} pagamentos${r.refunded ? ' · reembolsado ' + esc(r.refundedFmt) : ''}`)).join('') : k('Receita', '—', 'Sem pagamentos no período')}
        ${k('Comprovativos por validar', d.proofsToReview, `<a href="#transferencias">Abrir fila</a>`, d.proofsToReview ? 'warn-t' : '')}
        ${k('Transferências pendentes', d.transfersPending, 'sem comprovativo')}
        ${k('Subscrições ativas', d.subs.active, `${d.subs.expiring} a expirar em 7 dias · ${d.subs.past_due} com cobrança falhada`)}
        ${k('Licenças perpétuas', d.perpetual, `${d.activeDevices} computadores ativos (todas as licenças)`)}
        ${k('Clientes', d.customers)}
        ${k('Pagamentos falhados', d.failed, 'no período')}
        ${k('Reembolsos · contestações', `${d.refunds} · ${d.disputes}`, 'total', d.disputes ? 'bad-t' : '')}
        ${k('Subscrições canceladas', d.subs.cancelled, `${d.subs.expired} expiradas`)}
      </div>
      <div class="grid g2" style="margin-top:16px">${Object.keys(byCur).length ? Object.entries(byCur).map(([cur, m]) => { const max = Math.max(...Object.values(m)); return `<div class="card"><div class="row between"><h3>Receita diária · ${esc(cur)}</h3><span class="small dim">${days} dias</span></div><div class="bars" style="margin-top:14px">${dayList.map((dd) => `<i title="${dd}: ${((m[dd] || 0) / 100).toLocaleString('pt-PT')} ${cur}" style="height:${Math.max(2, ((m[dd] || 0) / max) * 100)}%;${m[dd] ? '' : 'opacity:.18'}"></i>`).join('')}</div></div>`; }).join('') : '<div class="card"><p class="muted">Sem receita no período.</p></div>'}</div>`;
    $$('[data-days]').forEach((b) => (b.onclick = () => { sessionStorage.setItem('mm.adm.days', b.dataset.days); V.painel(); }));
  };

  // ---------------- transferências ----------------
  const proofLine = (o) => { const p = o.proofs[0]; return p ? `${L.statusTag(p.status, 'proof')}${o.proofs.length > 1 ? ` <span class="tiny dim">+${o.proofs.length - 1}</span>` : ''}` : '<span class="dim small">sem comprovativo</span>'; };
  V.transferencias = async () => {
    const list = await L.get('/api/admin/transfers');
    badge = list.filter((o) => o.status === 'awaiting_validation').length; drawSide('transferencias');
    main.innerHTML = head(t('adm.transfers'), 'Primeiro os que têm comprovativo por validar. O envio do comprovativo nunca emite a licença — só a confirmação abaixo, depois de verificares a entrada do valor no banco.') +
      (list.length ? `<div class="card tscroll" style="padding:6px 10px"><table class="t"><tr><th>Referência</th><th>Cliente</th><th>Destino</th><th>Valor</th><th>Estado</th><th>Comprovativo</th><th>Prazo</th></tr>${list.map((o) => `<tr class="click" data-id="${o.id}"><td class="mono">${esc(o.ref)}${o.kind === 'renewal' ? ' <span class="tag">renovação</span>' : ''}</td><td>${esc(o.customer.name)}<div class="tiny dim">${esc(o.customer.email)}</div></td><td>${esc(o.destination)}</td><td><strong>${esc(o.amount)}</strong></td><td>${L.statusTag(o.status)}</td><td>${proofLine(o)}</td><td class="small ${o.due_at < Date.now() ? 'bad-t' : 'muted'}">${esc(L.date(o.due_at))}</td></tr>`).join('')}</table></div>` : '<div class="card"><p class="muted">Não há transferências pendentes.</p></div>');
    $$('[data-id]').forEach((r) => (r.onclick = () => (location.hash = 'transferencia/' + r.dataset.id)));
  };
  V.transferencia = (id) => orderDetail(id, true);

  // ---------------- encomendas ----------------
  V.encomendas = async () => {
    const f = JSON.parse(sessionStorage.getItem('mm.adm.of') || '{}');
    const list = await L.get(`/api/admin/orders?status=${f.status || ''}&method=${f.method || ''}&q=${encodeURIComponent(f.q || '')}`);
    const opt = (v, l, cur) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`;
    main.innerHTML = head(t('adm.orders')) + `<div class="row wrapx" style="margin-bottom:14px"><input class="field" id="q" placeholder="Referência ou email" value="${esc(f.q || '')}" style="max-width:260px"><select class="field" id="st" style="max-width:220px">${opt('', 'Todos os estados', f.status)}${['pending', 'awaiting_validation', 'confirmed', 'failed', 'expired', 'cancelled', 'refunded', 'disputed'].map((s) => opt(s, t('status.' + s), f.status)).join('')}</select><select class="field" id="me" style="max-width:240px">${opt('', 'Todos os métodos', f.method)}${[['card', 'Cartão'], ['paypal', 'PayPal'], ['bank_pt', 'Transferência PT'], ['bank_ao', 'Transferência AO'], ['test', 'Simulado'], ['gift', 'Oferta']].map(([v, l]) => opt(v, l, f.method)).join('')}</select></div>` +
      `<div class="card tscroll" style="padding:6px 10px"><table class="t"><tr><th>Referência</th><th>Cliente</th><th>Plano</th><th>Método</th><th>Valor</th><th>Estado</th><th>Data</th></tr>${list.map((o) => `<tr class="click" data-id="${o.id}"><td class="mono">${esc(o.ref)}</td><td>${esc(o.customer.email)}</td><td>${esc(o.plan)}${o.kind === 'renewal' ? ' <span class="tag">renovação</span>' : ''}</td><td class="small">${esc(o.methodLabel)}</td><td>${esc(o.amount)}</td><td>${L.statusTag(o.status)}</td><td class="small muted">${esc(L.date(o.created_at))}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nenhuma encomenda.</td></tr>'}</table></div>`;
    const save = () => { sessionStorage.setItem('mm.adm.of', JSON.stringify({ q: $('#q').value, status: $('#st').value, method: $('#me').value })); V.encomendas(); };
    $('#st').onchange = $('#me').onchange = save; $('#q').onkeydown = (e) => { if (e.key === 'Enter') save(); };
    $$('[data-id]').forEach((r) => (r.onclick = () => (location.hash = 'encomenda/' + r.dataset.id)));
  };
  V.encomenda = (id) => orderDetail(id, false);

  async function orderDetail(id, fromTransfers) {
    const o = await L.get('/api/admin/orders/' + id);
    const bank = ['bank_pt', 'bank_ao'].includes(o.method), open = ['pending', 'awaiting_validation'].includes(o.status);
    const latest = o.proofs.find((p) => ['submitted', 'needs_info'].includes(p.status));
    const mismatch = latest && latest.declared_cents !== null && latest.declared_cents !== o.amount_cents;
    main.innerHTML = `<a class="small" href="#${fromTransfers ? 'transferencias' : 'encomendas'}">← ${esc(t(fromTransfers ? 'adm.transfers' : 'adm.orders'))}</a>` + head(`Encomenda ${o.ref}`, `${esc(o.plan)}${o.kind === 'renewal' ? ' (renovação)' : ''} · ${esc(o.methodLabel)} · ${esc(L.date(o.created_at, true))}`, L.statusTag(o.status)) + `
      <div class="grid g2" style="align-items:start">
        <div class="stack">
          <div class="card"><h3>Pagamento</h3><dl class="kv" style="margin-top:12px">
            <dt>Valor esperado</dt><dd style="font-size:20px;font-weight:700">${esc(o.amount)}</dd>${o.currency !== 'USD' ? `<dt>Base USD</dt><dd>${esc(o.usd)} · câmbio ${esc(o.fx)}</dd>` : ''}<dt>Imposto</dt><dd>${esc(o.tax)}</dd>
            ${bank ? `<dt>Conta de destino</dt><dd>${esc(o.destination)}</dd><dt>Prazo</dt><dd>${esc(L.date(o.due_at))}</dd>` : ''}
            <dt>Cliente</dt><dd><a href="#cliente/${o.user_id}">${esc(o.customer.name)}</a><div class="small dim">${esc(o.customer.email)}</div></dd>
            <dt>País</dt><dd>${esc(o.country || '—')}</dd><dt>Faturação</dt><dd class="small">${esc([o.billing.name, o.billing.address, o.billing.taxId && 'NIF ' + o.billing.taxId].filter(Boolean).join(' · ') || '—')}</dd>
            ${o.license ? `<dt>Licença</dt><dd><a href="#licenca/${o.license.id}">…${esc(o.license.key4)}</a> ${L.statusTag(o.license.status)}</dd>` : ''}
            ${o.confirmed_at ? `<dt>Confirmado</dt><dd>${esc(L.date(o.confirmed_at, true))}</dd>` : ''}</dl>
            <div class="row wrapx" style="margin-top:16px">
              ${open && bank && can('payments.validate') ? `<button class="btn primary" id="approve">${esc(t('adm.approve'))}</button><button class="btn" id="info">${esc(t('adm.requestInfo'))}</button>${latest && latest.status === 'submitted' ? `<button class="btn danger" id="reject">${esc(t('adm.reject'))}</button>` : ''}` : ''}
              ${open && can('payments.validate') ? '<button class="btn ghost" id="cancel">Cancelar encomenda</button>' : ''}
              ${o.status === 'confirmed' && can('payments.refund') ? '<button class="btn danger" id="refund">Reembolsar</button>' : ''}
            </div>
            ${mismatch ? `<div class="notice bad" style="margin-top:14px">O valor declarado no comprovativo (${esc(latest.declared)}) é diferente do valor esperado (${esc(o.amount)}). Confirma no banco antes de aprovar.</div>` : ''}
          </div>
          <div class="card"><h3>Histórico</h3><ul class="timeline" style="margin-top:12px">${o.history.map((h) => `<li class="on"><strong>${esc(h.action)}</strong> <span class="dim small">· ${esc(L.date(h.at, true))} · ${esc(h.actor_email || 'sistema')}</span>${h.reason ? `<div class="small muted">${esc(h.reason)}</div>` : ''}</li>`).join('') || '<li>Sem ações registadas.</li>'}</ul></div>
        </div>
        <div class="stack">${bank ? `<div class="card"><h3>Comprovativos</h3>${o.proofs.length ? o.proofs.map((p) => `<div style="border-top:1px solid var(--line);padding:12px 0;margin-top:10px">
            <div class="row between wrapx"><strong class="small">${esc(p.filename)}</strong>${L.statusTag(p.status, 'proof')}</div>
            <div class="small muted" style="margin-top:4px">Enviado ${esc(L.date(p.created_at, true))} · ${(p.size / 1024).toFixed(0)} KB${p.declared ? ` · declarado <strong class="${p.declared_cents !== o.amount_cents ? 'bad-t' : 'ok-t'}">${esc(p.declared)}</strong>` : ''}${p.transfer_date ? ' · data ' + esc(p.transfer_date) : ''}${p.transfer_ref ? ' · ref. ' + esc(p.transfer_ref) : ''}</div>
            ${p.reason ? `<div class="small warn-t" style="margin-top:4px">${esc(p.reason)}${p.reviewed_by ? ' — ' + esc(p.reviewed_by) : ''}</div>` : ''}
            ${p.mime.startsWith('image/') ? `<a href="/api/admin/proofs/${p.id}/file" target="_blank" rel="noopener"><img src="/api/admin/proofs/${p.id}/file" alt="Comprovativo" style="margin-top:10px;max-width:100%;max-height:340px;border-radius:10px;border:1px solid var(--line2)"></a>` : ''}
            <div class="row" style="margin-top:8px"><a class="btn sm" href="/api/admin/proofs/${p.id}/file" target="_blank" rel="noopener">Abrir</a><a class="btn sm ghost" href="/api/admin/proofs/${p.id}/file?download=1">Descarregar</a></div></div>`).join('') : '<p class="muted small" style="margin-top:8px">O cliente ainda não enviou comprovativo. Podes aprovar sem comprovativo se a entrada do valor estiver confirmada no banco.</p>'}
            <p class="tiny dim" style="margin-top:10px">Cada visualização fica registada na auditoria.</p></div>` : `<div class="card"><h3>Prestador</h3><p class="muted small" style="margin-top:8px">Pagamentos ${esc(o.methodLabel)} são confirmados por webhook assinado (ou captura no servidor), nunca pela página de regresso do navegador. Ver <a href="#eventos">eventos dos prestadores</a>.</p></div>`}</div>
      </div>`;
    const done = async (msg) => { L.toast(msg); await orderDetail(id, fromTransfers); };
    const on = (sel, fn) => { const b = $(sel); if (b) b.onclick = fn; };
    on('#approve', async () => { const r = await ask(t('adm.approve'), `Encomenda ${o.ref} · ${o.customer.email}. A licença é emitida e o cliente recebe a chave por email. Esta ação fica auditada.`, 'Confirmar e emitir', { check: t('adm.approve.check', { amount: o.amount }) }); if (!r) return; try { const x = await L.post(`/api/admin/orders/${o.id}/approve`, { confirmReceived: true }); done(x.duplicate ? 'Já estava confirmada — nenhuma licença duplicada.' : 'Pagamento confirmado e licença emitida.'); } catch (e) { L.err(e); } });
    on('#info', async () => { const r = await ask(t('adm.requestInfo'), 'O cliente recebe um email com o motivo e pode enviar um novo comprovativo. A encomenda volta a pendente.', 'Enviar pedido', { reason: true }); if (!r) return; try { await L.post(`/api/admin/orders/${o.id}/request-info`, { reason: r.reason }); done('Pedido enviado ao cliente.'); } catch (e) { L.err(e); } });
    on('#reject', async () => { const r = await ask(t('adm.reject'), 'O comprovativo é rejeitado e o cliente é notificado com o motivo. Nenhuma licença é emitida.', 'Rejeitar', { reason: true, danger: true }); if (!r) return; try { await L.post(`/api/admin/orders/${o.id}/reject`, { reason: r.reason }); done('Comprovativo rejeitado.'); } catch (e) { L.err(e); } });
    on('#cancel', async () => { const r = await ask('Cancelar encomenda', 'A encomenda deixa de aceitar pagamento.', 'Cancelar encomenda', { reason: true, danger: true }); if (!r) return; try { await L.post(`/api/admin/orders/${o.id}/cancel`, { reason: r.reason }); done('Encomenda cancelada.'); } catch (e) { L.err(e); } });
    on('#refund', async () => {
      const manual = bank || o.method === 'gift' || o.method === 'test';
      const r = await ask('Reembolsar', manual ? 'Transferências: faz primeiro a devolução pelo banco. A licença é revogada.' : `O reembolso é pedido ao prestador (${o.methodLabel}) e a licença é revogada.`, 'Reembolsar', { reason: true, danger: true, check: manual ? 'Reembolso manual efetuado pelo banco' : 'Confirmo o reembolso total' });
      if (!r) return; try { await L.post(`/api/admin/orders/${o.id}/refund`, { reason: r.reason, manualDone: manual }); done('Reembolso registado e licença revogada.'); } catch (e) { L.err(e); }
    });
  }

  // ---------------- clientes ----------------
  V.clientes = async () => {
    const f = JSON.parse(sessionStorage.getItem('mm.adm.cf') || '{}');
    const list = await L.get(`/api/admin/customers?q=${encodeURIComponent(f.q || '')}&status=${f.status || ''}`);
    main.innerHTML = head(t('adm.customers'), 'Suspender ou bloquear o login é diferente de revogar uma licença. Palavras-passe nunca são visíveis — envia uma ligação de redefinição.', can('customers.edit') ? '<button class="btn primary" id="new">Novo cliente</button>' : '') +
      `<div class="row wrapx" style="margin-bottom:14px"><input class="field" id="q" placeholder="Nome ou email" value="${esc(f.q || '')}" style="max-width:280px"><select class="field" id="st" style="max-width:200px"><option value="">Todos</option>${['pending', 'active', 'suspended', 'blocked'].map((s) => `<option value="${s}" ${f.status === s ? 'selected' : ''}>${esc({ pending: 'Pendente', active: 'Ativa', suspended: 'Suspensa', blocked: 'Bloqueada' }[s])}</option>`).join('')}</select></div>
      <div class="card tscroll" style="padding:6px 10px"><table class="t"><tr><th>Cliente</th><th>País</th><th>Estado</th><th>Email</th><th>Licenças</th><th>Compras</th><th>Último acesso</th></tr>${list.map((c) => `<tr class="click" data-id="${c.id}"><td>${esc(c.name)}<div class="tiny dim">${esc(c.email)}</div></td><td>${esc(c.country || '—')}</td><td>${L.statusTag(c.status)}</td><td>${c.email_verified ? '<span class="tag ok">confirmado</span>' : c.invited ? '<span class="tag info">convidado</span>' : '<span class="tag warn">por confirmar</span>'}</td><td>${c.licenses}</td><td>${c.purchases}</td><td class="small muted">${esc(L.rel(c.last_login_at))}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nenhum cliente.</td></tr>'}</table></div>`;
    const save = () => { sessionStorage.setItem('mm.adm.cf', JSON.stringify({ q: $('#q').value, status: $('#st').value })); V.clientes(); };
    $('#st').onchange = save; $('#q').onkeydown = (e) => { if (e.key === 'Enter') save(); };
    $$('[data-id]').forEach((r) => (r.onclick = () => (location.hash = 'cliente/' + r.dataset.id)));
    const nb = $('#new'); if (nb) nb.onclick = () => L.modal(`<h3>Novo cliente</h3><label class="f">Nome</label><input class="field" id="n"><label class="f">Email</label><input class="field" id="e" type="email"><label class="f">País</label><select class="field" id="c">${L.countryOptions('')}</select><label class="check" style="margin-top:14px"><input type="checkbox" id="i" checked> <span>Enviar convite por email para definir a palavra-passe</span></label><div class="row" style="justify-content:flex-end;margin-top:18px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Criar</button></div>`, (m, close) => {
      m.querySelector('[data-x]').onclick = () => close();
      m.querySelector('[data-ok]').onclick = async () => { try { const u = await L.post('/api/admin/customers', { name: m.querySelector('#n').value, email: m.querySelector('#e').value, country: m.querySelector('#c').value, sendInvite: m.querySelector('#i').checked }); close(); L.toast('Cliente criado.'); location.hash = 'cliente/' + u.id; } catch (e) { L.err(e); } };
    });
  };
  V.cliente = async (id) => {
    const c = await L.get('/api/admin/customers/' + id), u = c.user;
    main.innerHTML = `<a class="small" href="#clientes">← ${esc(t('adm.customers'))}</a>` + head(u.name, `${esc(u.email)} · cliente desde ${esc(L.date(u.created_at))}`, L.statusTag(u.status)) + `
      ${u.status_reason ? `<div class="notice" style="margin-bottom:14px">Motivo: ${esc(u.status_reason)}</div>` : ''}
      <div class="grid g2" style="align-items:start"><div class="stack">
        <div class="card"><h3>Conta</h3><dl class="kv" style="margin-top:12px"><dt>Email</dt><dd>${esc(u.email)} ${u.email_verified ? '<span class="tag ok">confirmado</span>' : '<span class="tag warn">por confirmar</span>'}</dd><dt>País</dt><dd>${esc(u.country || '—')}</dd><dt>Faturação</dt><dd class="small">${esc([u.billing_name, u.billing_address, u.tax_id && 'NIF ' + u.tax_id].filter(Boolean).join(' · ') || '—')}</dd><dt>Sessões ativas</dt><dd>${c.sessions}</dd><dt>Último acesso</dt><dd>${esc(L.date(u.last_login_at, true))}</dd><dt>Palavra-passe</dt><dd class="small muted">${u.invited ? 'Ainda não definida (convite)' : 'Definida — nunca visível'}</dd></dl>
          <div class="row wrapx" style="margin-top:16px">${can('customers.edit') ? '<button class="btn sm" id="edit">Editar dados</button><button class="btn sm" id="reset">Enviar ligação de redefinição</button>' : ''}
          ${u.status !== 'suspended' && u.status !== 'blocked' && can('customers.suspend') ? '<button class="btn sm danger" id="susp">Suspender login</button>' : ''}${u.status !== 'blocked' && can('customers.block') ? '<button class="btn sm danger" id="block">Bloquear</button>' : ''}${['suspended', 'blocked'].includes(u.status) && (u.status === 'suspended' ? can('customers.suspend') : can('customers.block')) ? '<button class="btn sm acc" id="react">Repor acesso</button>' : ''}</div></div>
        <div class="card"><h3>Licenças</h3><table class="t" style="margin-top:8px">${c.licenses.map((l) => `<tr class="click" data-lic="${l.id}"><td class="mono small">${esc(l.key)}</td><td>${esc(t('lic.' + l.type))}</td><td>${L.statusTag(l.status)}</td><td class="small muted">${esc(l.device || 'sem computador')}</td></tr>`).join('') || '<tr><td class="muted">Sem licenças.</td></tr>'}</table></div>
        <div class="card"><h3>Subscrições</h3><table class="t" style="margin-top:8px">${c.subscriptions.map((s) => `<tr><td>${esc(s.plan_name)}</td><td>${L.statusTag(s.status)}</td><td class="small muted">até ${esc(L.date(s.current_period_end))}${s.cancel_at_period_end ? ' · não renova' : ''}</td></tr>`).join('') || '<tr><td class="muted">Sem subscrições.</td></tr>'}</table></div>
      </div><div class="stack">
        <div class="card"><h3>Encomendas</h3><table class="t" style="margin-top:8px">${c.orders.map((o) => `<tr class="click" data-ord="${o.id}"><td class="mono small">${esc(o.ref)}</td><td class="small">${esc(o.method)}</td><td>${esc(o.amount)}</td><td>${L.statusTag(o.status)}</td></tr>`).join('') || '<tr><td class="muted">Sem encomendas.</td></tr>'}</table></div>
        <div class="card"><h3>Pagamentos</h3><table class="t" style="margin-top:8px">${c.payments.map((p) => `<tr><td class="mono small">${esc(p.ref)}</td><td class="small">${esc(p.provider)}</td><td>${esc(p.amount)}</td><td>${L.statusTag(p.status)}</td><td class="tiny dim">${esc(p.confirmed_by || '')}</td></tr>`).join('') || '<tr><td class="muted">Sem pagamentos.</td></tr>'}</table></div>
        <div class="card"><h3>Auditoria da conta</h3><ul class="timeline" style="margin-top:10px">${c.audit.map((a) => `<li class="on"><strong>${esc(a.action)}</strong> <span class="dim small">· ${esc(L.date(a.at, true))} · ${esc(a.actor_email || '')}</span>${a.reason ? `<div class="small muted">${esc(a.reason)}</div>` : ''}</li>`).join('') || '<li>Sem registos.</li>'}</ul></div>
      </div></div>`;
    $$('[data-lic]').forEach((r) => (r.onclick = () => (location.hash = 'licenca/' + r.dataset.lic)));
    $$('[data-ord]').forEach((r) => (r.onclick = () => (location.hash = 'encomenda/' + r.dataset.ord)));
    const on = (sel, fn) => { const b = $(sel); if (b) b.onclick = fn; };
    const setStatus = async (status, title, text, danger) => { const r = await ask(title, text, title, { reason: true, danger }); if (!r) return; try { const x = await L.post(`/api/admin/customers/${id}/status`, { status, reason: r.reason }); L.toast(x.consequence, 'ok', 7000); V.cliente(id); } catch (e) { L.err(e); } };
    on('#susp', () => setStatus('suspended', 'Suspender login', 'O cliente deixa de conseguir entrar e as sessões são terminadas. As licenças continuam a funcionar.', true));
    on('#block', () => setStatus('blocked', 'Bloquear conta', 'Login bloqueado e as licenças desta conta deixam de ativar e validar (não são revogadas). Só o administrador principal desbloqueia.', true));
    on('#react', () => setStatus('active', 'Repor acesso', 'O cliente volta a conseguir entrar.'));
    on('#reset', async () => { if (!(await ask('Enviar ligação de redefinição', `Enviamos para ${u.email} uma ligação válida durante 1 hora (ou um convite, se a palavra-passe ainda não foi definida).`, 'Enviar'))) return; try { await L.post(`/api/admin/customers/${id}/reset-link`); L.toast('Ligação enviada.'); } catch (e) { L.err(e); } });
    on('#edit', () => L.modal(`<h3>Editar cliente</h3><label class="f">Nome</label><input class="field" id="n" value="${esc(u.name)}"><label class="f">Email</label><input class="field" id="e" value="${esc(u.email)}"><p class="hint">Se mudares o email, o cliente tem de o confirmar de novo.</p><label class="f">País</label><select class="field" id="c">${L.countryOptions(u.country || '')}</select><label class="f">Nome de faturação</label><input class="field" id="bn" value="${esc(u.billing_name || '')}"><label class="f">Morada</label><input class="field" id="ba" value="${esc(u.billing_address || '')}"><label class="f">NIF</label><input class="field" id="tx" value="${esc(u.tax_id || '')}"><div class="row" style="justify-content:flex-end;margin-top:18px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Guardar</button></div>`, (m, close) => {
      m.querySelector('[data-x]').onclick = () => close();
      m.querySelector('[data-ok]').onclick = async () => { try { await L.patch('/api/admin/customers/' + id, { name: m.querySelector('#n').value, email: m.querySelector('#e').value, country: m.querySelector('#c').value, billing_name: m.querySelector('#bn').value, billing_address: m.querySelector('#ba').value, tax_id: m.querySelector('#tx').value }); close(); L.toast(t('common.saved')); V.cliente(id); } catch (e) { L.err(e); } };
    }));
  };

  // ---------------- licenças ----------------
  V.licencas = async () => {
    const f = JSON.parse(sessionStorage.getItem('mm.adm.lf') || '{}');
    const list = await L.get(`/api/admin/licenses?q=${encodeURIComponent(f.q || '')}&type=${f.type || ''}&status=${f.status || ''}`);
    main.innerHTML = head(t('adm.licenses'), 'Uma máquina ativa por licença. Revogar é diferente de suspender o login do cliente.', can('licenses.issue') ? '<button class="btn primary" id="issue">Emitir licenças</button>' : '') +
      `<div class="row wrapx" style="margin-bottom:14px"><input class="field" id="q" placeholder="Chave, email ou nota" value="${esc(f.q || '')}" style="max-width:280px"><select class="field" id="ty" style="max-width:180px"><option value="">Todos os tipos</option>${['perpetual', 'subscription', 'demo', 'gift'].map((x) => `<option value="${x}" ${f.type === x ? 'selected' : ''}>${esc(t('lic.' + x))}</option>`).join('')}</select><select class="field" id="st" style="max-width:180px"><option value="">Todos os estados</option>${['active', 'suspended', 'revoked', 'expired'].map((x) => `<option value="${x}" ${f.status === x ? 'selected' : ''}>${esc(t('status.' + x))}</option>`).join('')}</select></div>
      <div class="card tscroll" style="padding:6px 10px"><table class="t"><tr><th>Chave</th><th>Tipo</th><th>Cliente</th><th>Estado</th><th>Computador</th><th>Validade</th></tr>${list.map((l) => `<tr class="click" data-id="${l.id}"><td class="mono small">${esc(l.key)}</td><td>${esc(t('lic.' + l.type))} <span class="dim small">${l.major}.x</span></td><td class="small">${esc(l.customer ? l.customer.email : '— (lote)')}</td><td>${L.statusTag(l.status)}</td><td class="small">${l.device ? `${esc(l.device.name || '—')} <span class="dim">${esc(l.device.platform || '')}</span>` : '<span class="dim">—</span>'}</td><td class="small muted">${l.expires_at ? esc(L.date(l.expires_at)) : 'perpétua'}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nenhuma licença.</td></tr>'}</table></div>`;
    const save = () => { sessionStorage.setItem('mm.adm.lf', JSON.stringify({ q: $('#q').value, type: $('#ty').value, status: $('#st').value })); V.licencas(); };
    $('#ty').onchange = $('#st').onchange = save; $('#q').onkeydown = (e) => { if (e.key === 'Enter') save(); };
    $$('[data-id]').forEach((r) => (r.onclick = () => (location.hash = 'licenca/' + r.dataset.id)));
    const ib = $('#issue'); if (ib) ib.onclick = () => L.modal(`<h3>Emitir licenças</h3><p class="muted small">Ofertas, demonstrações ou perpétuas (por exemplo, para parceiros). Tudo fica auditado.</p>
      <div class="grid g2" style="gap:0 12px"><div><label class="f">Tipo</label><select class="field" id="ty"><option value="gift">Oferta</option><option value="demo">Demonstração</option><option value="perpetual">Perpétua</option></select></div><div><label class="f">Quantidade</label><input class="field" id="n" type="number" min="1" max="500" value="1"></div>
      <div><label class="f">Validade (dias, opcional)</label><input class="field" id="d" type="number" min="0" placeholder="vazio = sem fim; demo = 14"></div><div><label class="f">Email do cliente (opcional)</label><input class="field" id="e" type="email" placeholder="só para 1 licença"></div></div>
      <label class="f">Motivo (obrigatório)</label><input class="field" id="r" placeholder="ex.: parceria, sorteio, substituição">
      <div id="out"></div><div class="row" style="justify-content:flex-end;margin-top:18px"><button class="btn" data-x>Fechar</button><button class="btn primary" data-ok>Emitir</button></div>`, (m, close) => {
      m.querySelector('[data-x]').onclick = () => { close(); V.licencas(); };
      m.querySelector('[data-ok]').onclick = async () => {
        try {
          const r = await L.post('/api/admin/licenses', { type: m.querySelector('#ty').value, count: +m.querySelector('#n').value, days: +m.querySelector('#d').value || 0, email: m.querySelector('#e').value.trim() || undefined, reason: m.querySelector('#r').value });
          const txt = r.keys.map((k) => k.key).join('\n');
          m.querySelector('#out').innerHTML = `<label class="f">${r.keys.length} chave(s) emitida(s)</label><textarea class="field" rows="5" readonly>${esc(txt)}</textarea><button class="btn sm" style="margin-top:8px" id="cp">Copiar todas</button>`;
          m.querySelector('#cp').onclick = () => L.copy(txt); m.querySelector('[data-ok]').disabled = true;
        } catch (e) { L.err(e); }
      };
    });
  };
  V.licenca = async (id) => {
    const l = await L.get('/api/admin/licenses/' + id);
    main.innerHTML = `<a class="small" href="#licencas">← ${esc(t('adm.licenses'))}</a>` + head(`${t('lic.' + l.type)} · ${l.major}.x`, `<span class="mono">${esc(l.key)}</span>`, L.statusTag(l.status)) + `
      ${l.statusReason ? `<div class="notice" style="margin-bottom:14px">Motivo: ${esc(l.statusReason)}</div>` : ''}
      <div class="grid g2" style="align-items:start"><div class="stack">
        <div class="card"><h3>Licença</h3><dl class="kv" style="margin-top:12px"><dt>Cliente</dt><dd>${l.customer ? `<a href="#cliente/${l.user_id}">${esc(l.customer.name)}</a> <span class="small dim">${esc(l.customer.email)}</span>` : '— (lote, por associar)'}</dd><dt>Encomenda</dt><dd class="mono">${esc(l.order || '—')}</dd><dt>Emitida</dt><dd>${esc(L.date(l.issued_at, true))}</dd><dt>Validade</dt><dd>${l.expires_at ? esc(L.date(l.expires_at)) : 'Perpétua (versão ' + l.major + '.x)'}</dd>${l.note ? `<dt>Nota</dt><dd>${esc(l.note)}</dd>` : ''}</dl>
          <div class="row wrapx" style="margin-top:16px">
            ${l.status === 'active' && can('licenses.manage') ? '<button class="btn sm danger" data-st="suspended">Suspender</button>' : ''}
            ${['suspended', 'revoked'].includes(l.status) && (l.status === 'suspended' ? can('licenses.manage') : can('licenses.revoke')) ? '<button class="btn sm acc" data-st="active">Reativar</button>' : ''}
            ${l.status !== 'revoked' && can('licenses.revoke') ? '<button class="btn sm danger" data-st="revoked">Revogar</button>' : ''}
            ${l.expires_at && can('subscriptions.manage') ? '<button class="btn sm" id="ext">Prolongar</button>' : ''}
            ${can('licenses.issue') ? '<button class="btn sm" id="asg">Associar a cliente</button>' : ''}
          </div></div>
        <div class="card"><h3>Computador ativo</h3>${l.device ? `<dl class="kv" style="margin-top:12px"><dt>Nome</dt><dd>${esc(l.device.name || '—')}</dd><dt>Sistema</dt><dd>${esc(l.device.platform || '—')}</dd><dt>Versão da app</dt><dd>${esc(l.device.app_version || '—')}</dd><dt>Ativado</dt><dd>${esc(L.date(l.device.activated_at, true))}</dd><dt>Último contacto</dt><dd>${esc(L.rel(l.device.last_seen_at))}</dd></dl>${can('licenses.manage') ? '<button class="btn sm danger" style="margin-top:14px" id="rel">Libertar computador (recuperação)</button>' : ''}` : '<p class="muted small" style="margin-top:8px">Nenhum computador ativo.</p>'}
          ${can('licenses.manage') ? `<p class="tiny dim" style="margin-top:10px">A recuperação administrativa (avaria, perda, substituição) não conta para o limite de mudanças do cliente.${!l.device ? ' <a href="#" id="rst">Repor o limite de mudanças</a>' : ''}</p>` : ''}</div>
      </div><div class="stack">
        <div class="card"><h3>Computadores</h3><table class="t" style="margin-top:8px">${l.devices.map((d) => `<tr><td>${esc(d.name || '—')} <span class="dim small">${esc(d.platform || '')}</span><div class="tiny dim">${esc(d.app_version || '')}</div></td><td class="small">${esc(L.date(d.activated_at))}</td><td class="small">${d.deactivated_at ? `${esc(L.date(d.deactivated_at))}<div class="tiny dim">${esc(d.deactivation_reason || '')}</div>` : '<span class="tag ok">ativo</span>'}</td></tr>`).join('') || '<tr><td class="muted">Nunca ativada.</td></tr>'}</table></div>
        <div class="card"><h3>Histórico</h3><ul class="timeline" style="margin-top:10px">${l.events.map((e) => `<li class="${/revok|deactiv|suspend|expired/.test(e.action) ? 'bad' : 'on'}"><strong>${esc(L.licAction(e.action))}</strong> <span class="dim small">· ${esc(L.date(e.at, true))} · ${esc(e.actor)}</span>${e.details ? `<div class="tiny dim" style="overflow-wrap:anywhere">${esc(e.details)}</div>` : ''}</li>`).join('')}</ul></div>
      </div></div>`;
    const TXT = { suspended: ['Suspender licença', 'A licença deixa de ativar e validar até ser reativada. O login do cliente não muda.'], revoked: ['Revogar licença', 'Revogação definitiva: deixa de ativar e validar. Computadores offline só sabem quando voltarem a contactar o servidor (ou quando o comprovativo expirar). Só o administrador principal pode reverter.'], active: ['Reativar licença', 'A licença volta a ativar e validar.'] };
    $$('[data-st]').forEach((b) => (b.onclick = async () => { const [ti, tx] = TXT[b.dataset.st]; const r = await ask(ti, tx, ti, { reason: true, danger: b.dataset.st !== 'active' }); if (!r) return; try { const x = await L.post(`/api/admin/licenses/${id}/status`, { status: b.dataset.st, reason: r.reason }); L.toast(x.consequence, 'ok', 7000); V.licenca(id); } catch (e) { L.err(e); } }));
    const on = (sel, fn) => { const b = $(sel); if (b) b.onclick = fn; };
    on('#rel', () => L.modal(`<h3>Libertar computador</h3><p class="muted small">Desativa o computador atual para o cliente poder ativar noutro. Usa para avarias, perda ou substituição.</p><label class="f">Motivo (obrigatório)</label><input class="field" id="r"><label class="check" style="margin-top:14px"><input type="checkbox" id="z" checked> <span>Repor também o limite de mudanças do cliente</span></label><div class="row" style="justify-content:flex-end;margin-top:18px"><button class="btn" data-x>Cancelar</button><button class="btn danger" data-ok>Libertar</button></div>`, (m, close) => {
      m.querySelector('[data-x]').onclick = () => close();
      m.querySelector('[data-ok]').onclick = async () => { try { await L.post(`/api/admin/licenses/${id}/release-device`, { reason: m.querySelector('#r').value, resetLimit: m.querySelector('#z').checked }); close(); L.toast('Computador libertado.'); V.licenca(id); } catch (e) { L.err(e); } };
    }));
    on('#rst', async (e) => { e.preventDefault(); const r = await ask('Repor o limite de mudanças', 'O cliente volta a poder mudar de computador como se não tivesse feito mudanças recentes.', 'Repor', { reason: true }); if (!r) return; try { await L.post(`/api/admin/licenses/${id}/release-device`, { reason: r.reason, resetLimit: true }); L.toast('Limite reposto.'); V.licenca(id); } catch (er) { L.err(er); } });
    on('#ext', () => L.modal(`<h3>Prolongar</h3><label class="f">Dias</label><input class="field" id="d" type="number" min="1" max="3650" value="30"><label class="f">Motivo (obrigatório)</label><input class="field" id="r"><div class="row" style="justify-content:flex-end;margin-top:18px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Prolongar</button></div>`, (m, close) => {
      m.querySelector('[data-x]').onclick = () => close();
      m.querySelector('[data-ok]').onclick = async () => { try { const x = await L.post(`/api/admin/licenses/${id}/extend`, { days: +m.querySelector('#d').value, reason: m.querySelector('#r').value }); close(); L.toast('Válida até ' + L.date(x.until) + '.'); V.licenca(id); } catch (e) { L.err(e); } };
    }));
    on('#asg', () => L.modal(`<h3>Associar a cliente</h3><label class="f">Email do cliente</label><input class="field" id="e" type="email"><label class="f">Motivo (obrigatório)</label><input class="field" id="r"><div class="row" style="justify-content:flex-end;margin-top:18px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Associar</button></div>`, (m, close) => {
      m.querySelector('[data-x]').onclick = () => close();
      m.querySelector('[data-ok]').onclick = async () => { try { await L.post(`/api/admin/licenses/${id}/assign`, { email: m.querySelector('#e').value, reason: m.querySelector('#r').value }); close(); L.toast('Licença associada.'); V.licenca(id); } catch (e) { L.err(e); } };
    }));
  };

  // ---------------- subscrições ----------------
  V.subscricoes = async () => {
    const f = sessionStorage.getItem('mm.adm.sf') || '';
    const list = await L.get('/api/admin/subscriptions?filter=' + f);
    const F = [['', 'Todas'], ['active', 'Ativas'], ['expiring', 'A expirar (7 dias)'], ['past_due', 'Cobrança falhada'], ['manual', 'Renovação manual'], ['cancelled', 'Canceladas'], ['expired', 'Expiradas']];
    main.innerHTML = head(t('adm.subs'), 'Transferências renovam manualmente: a renovação aparece em Transferências quando o cliente a cria.') + `<div class="row wrapx" style="margin-bottom:14px">${F.map(([v, l]) => `<button class="btn sm ${f === v ? 'acc' : 'ghost'}" data-f="${v}">${esc(l)}</button>`).join('')}</div>
      <div class="card tscroll" style="padding:6px 10px"><table class="t"><tr><th>Cliente</th><th>Plano</th><th>Método</th><th>Estado</th><th>Fim do período</th><th>Renovação</th><th></th></tr>${list.map((s) => `<tr><td>${esc(s.customer.name)}<div class="tiny dim">${esc(s.customer.email)}</div></td><td>${esc(s.plan)}</td><td class="small">${esc(s.method)}</td><td>${L.statusTag(s.status)}</td><td class="small">${esc(L.date(s.periodEnd))}</td><td class="small">${s.cancelAtPeriodEnd ? 'não renova' : s.autoRenew ? 'automática' : 'manual'}${s.pendingRenewal ? ` · <span class="mono">${esc(s.pendingRenewal)}</span>` : ''}</td><td style="white-space:nowrap">${s.licenseId ? `<a class="btn sm ghost" href="#licenca/${s.licenseId}">Licença</a>` : ''}${!s.cancelAtPeriodEnd && ['active', 'past_due'].includes(s.status) && can('subscriptions.manage') ? `<button class="btn sm ghost" data-cr="${s.id}">Cancelar renovação</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nenhuma subscrição.</td></tr>'}</table></div>`;
    $$('[data-f]').forEach((b) => (b.onclick = () => { sessionStorage.setItem('mm.adm.sf', b.dataset.f); V.subscricoes(); }));
    $$('[data-cr]').forEach((b) => (b.onclick = async () => { const r = await ask('Cancelar a renovação', 'A subscrição deixa de renovar (também no prestador). O cliente mantém o acesso até ao fim do período pago.', 'Cancelar renovação', { reason: true, danger: true }); if (!r) return; try { await L.post(`/api/admin/subscriptions/${b.dataset.cr}/cancel-renewal`, { reason: r.reason }); L.toast('Renovação cancelada.'); V.subscricoes(); } catch (e) { L.err(e); } }));
  };

  // ---------------- eventos ----------------
  V.eventos = async () => {
    const list = await L.get('/api/admin/events');
    main.innerHTML = head(t('adm.events'), 'Webhooks recebidos. Cada evento é processado uma só vez (idempotência por prestador + id).') + `<div class="card tscroll" style="padding:6px 10px"><table class="t"><tr><th>Recebido</th><th>Prestador</th><th>Tipo</th><th>Id do evento</th><th>Resultado</th></tr>${list.map((e) => `<tr><td class="small">${esc(L.date(e.received_at, true))}</td><td>${esc(e.provider)}</td><td class="mono small">${esc(e.type)}</td><td class="mono tiny">${esc(e.event_id)}</td><td class="small">${e.processed_at ? '<span class="tag ok">processado</span>' : '<span class="tag warn">por processar</span>'} <span class="dim">${esc(e.result || '')}</span></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Sem eventos.</td></tr>'}</table></div>`;
  };

  // ---------------- configurações ----------------
  let settingsTab = sessionStorage.getItem('mm.adm.tab') || 'planos';
  V.configuracoes = async () => {
    const S = await L.get('/api/admin/settings'), edit = can('settings.edit');
    const TABS = [['planos', 'Planos e preços'], ['metodos', 'Métodos de pagamento'], ['prestadores', 'Stripe e PayPal'], ['bancos', 'Dados bancários'], ['moedas', 'Moedas e câmbio'], ['impostos', 'Impostos'], ['licenciamento', 'Licenciamento e demonstração'], ['loja', 'Loja, suporte e segurança'], ['versoes', 'Versões e downloads']];
    main.innerHTML = head(t('adm.settings'), edit ? 'As alterações ficam registadas na auditoria.' : 'Só leitura — o teu perfil não pode alterar configurações.', `<span class="tag ${S.mode === 'test' ? 'warn' : 'ok'}">${S.mode === 'test' ? 'MODO DE TESTES' : 'PRODUÇÃO'}</span>`) +
      `<div class="row wrapx" style="gap:6px;margin-bottom:16px">${TABS.map(([k, l]) => `<button class="btn sm ${settingsTab === k ? 'acc' : 'ghost'}" data-tab="${k}">${esc(l)}</button>`).join('')}</div><div id="tab"></div>`;
    $$('[data-tab]').forEach((b) => (b.onclick = () => { settingsTab = b.dataset.tab; sessionStorage.setItem('mm.adm.tab', settingsTab); V.configuracoes(); }));
    const tab = $('#tab'), dis = edit ? '' : 'disabled';
    const saveSetting = async (key, value, reason) => { try { await L.put('/api/admin/settings/' + key, { value, reason }); L.toast(t('common.saved')); V.configuracoes(); } catch (e) { L.err(e); } };
    const saveBtn = (id) => edit ? `<button class="btn primary" style="margin-top:18px" id="${id}">${esc(t('common.save'))}</button>` : '';
    const T = {};
    T.planos = () => {
      tab.innerHTML = `<div class="card"><p class="muted small">Preços base em USD. A poupança do plano anual é recalculada automaticamente: <strong>${S.annualSaving !== null ? S.annualSaving.toLocaleString('pt-PT') + '%' : '—'}</strong>.</p>
        <div class="tscroll"><table class="t" style="margin-top:10px"><tr><th>Plano</th><th>Nome</th><th>Preço (USD)</th><th>Ativo</th><th>Stripe price id (opcional)</th><th>PayPal plan id (subscrições)</th><th></th></tr>${S.plans.map((p) => `<tr data-plan="${p.id}"><td class="mono small">${esc(p.id)}</td><td><input class="field" name="name" value="${esc(p.name)}" ${dis}></td><td><input class="field" name="price_usd" type="number" step="0.01" min="1" value="${(p.price_usd_cents / 100).toFixed(2)}" style="width:110px" ${dis}></td><td><input type="checkbox" name="active" ${p.active ? 'checked' : ''} ${dis}></td><td><input class="field" name="stripe_price_id" value="${esc(p.stripe_price_id || '')}" placeholder="—" ${dis}></td><td><input class="field" name="paypal_plan_id" value="${esc(p.paypal_plan_id || '')}" placeholder="${p.kind === 'subscription' ? 'obrigatório para PayPal' : 'n/a'}" ${dis} ${p.kind === 'subscription' ? '' : 'disabled'}></td><td>${edit ? '<button class="btn sm acc" data-save>Guardar</button>' : ''}</td></tr>`).join('')}</table></div>
        <p class="tiny dim" style="margin-top:10px">Com cartão, o preço é enviado à Stripe em cada checkout (não é obrigatório criar produtos na Stripe). As subscrições PayPal exigem um plano criado no PayPal com o mesmo preço.</p></div>`;
      $$('[data-save]', tab).forEach((b) => (b.onclick = async () => { const tr = b.closest('tr'), g = (n) => tr.querySelector(`[name=${n}]`); try { const r = await L.put('/api/admin/plans/' + tr.dataset.plan, { name: g('name').value, price_usd: +g('price_usd').value, active: g('active').checked, stripe_price_id: g('stripe_price_id').value, paypal_plan_id: g('paypal_plan_id').value }); L.toast(`Guardado. Poupança anual: ${r.annualSaving}%`); V.configuracoes(); } catch (e) { L.err(e); } }));
    };
    T.metodos = () => {
      const M = S.methods, LBL = { card: 'Cartão (Stripe Checkout)', paypal: 'PayPal', bank_pt: 'Transferência — Portugal', bank_ao: 'Transferência — Angola', test: 'Pagamento simulado (só testes)' };
      tab.innerHTML = `<div class="card"><p class="muted small">Ativa métodos e limita por país (códigos ISO separados por vírgulas, ou * para todos). Um método ativo só aparece ao cliente quando estiver configurado.</p>
        <table class="t" style="margin-top:10px"><tr><th>Método</th><th>Ativo</th><th>Países</th></tr>${Object.keys(LBL).filter((k) => M[k]).map((k) => `<tr data-m="${k}"><td>${esc(LBL[k])}</td><td><input type="checkbox" name="enabled" ${M[k].enabled ? 'checked' : ''} ${dis} ${k === 'test' && S.mode !== 'test' ? 'disabled' : ''}></td><td>${k === 'test' ? '<span class="dim small">—</span>' : `<input class="field" name="countries" value="${esc(M[k].countries || '*')}" ${dis} placeholder="* ou PT,AO,BR">`}</td></tr>`).join('')}</table>${saveBtn('sv')}</div>`;
      const sv = $('#sv'); if (sv) sv.onclick = () => { const v = {}; $$('[data-m]', tab).forEach((tr) => { const c = tr.querySelector('[name=countries]'); v[tr.dataset.m] = { enabled: tr.querySelector('[name=enabled]').checked, ...(c ? { countries: c.value.trim() || '*' } : {}) }; }); saveSetting('methods', v); };
    };
    T.prestadores = () => {
      const C = S.credentials, f = (p, k, label, hint) => { const c = C[p][k]; return `<label class="f">${esc(label)} ${c.set ? `<span class="tag ok">definido · ${esc(c.hint)}</span> <span class="tiny dim">${esc(c.source)}</span>` : '<span class="tag warn">por configurar</span>'}</label><input class="field mono" data-p="${p}" data-k="${k}" type="password" autocomplete="off" placeholder="${c.set ? 'deixa vazio para manter' : ''}" ${dis}>${hint ? `<p class="hint">${hint}</p>` : ''}`; };
      tab.innerHTML = `<div class="notice info" style="margin-bottom:14px">As credenciais são cifradas na base de dados e nunca são mostradas por inteiro nem registadas. Em produção, prefere variáveis de ambiente (STRIPE_SECRET_KEY, PAYPAL_CLIENT_SECRET…) — têm prioridade sobre o painel.</div>
        <div class="grid g2" style="align-items:start"><div class="card"><h3>Stripe (cartões)</h3>${f('stripe', 'secretKey', 'Chave secreta (sk_live_… / sk_test_…)')}${f('stripe', 'webhookSecret', 'Segredo do webhook (whsec_…)')}
          <label class="f">URL do webhook a registar na Stripe</label><div class="code">${esc(C.webhooks.stripe)}</div><p class="hint">Eventos: checkout.session.completed, checkout.session.expired, checkout.session.async_payment_succeeded/failed, invoice.paid, invoice.payment_failed, customer.subscription.updated/deleted, charge.refunded, charge.dispute.created.</p>${edit ? '<button class="btn primary" style="margin-top:14px" data-save="stripe">Guardar Stripe</button>' : ''}</div>
        <div class="card"><h3>PayPal</h3>${f('paypal', 'clientId', 'Client ID')}${f('paypal', 'clientSecret', 'Client secret')}${f('paypal', 'webhookId', 'Webhook ID')}
          <label class="f">URL do webhook a registar no PayPal</label><div class="code">${esc(C.webhooks.paypal)}</div><p class="hint">Eventos: PAYMENT.CAPTURE.COMPLETED/DENIED/REFUNDED, CUSTOMER.DISPUTE.CREATED, BILLING.SUBSCRIPTION.ACTIVATED/CANCELLED/SUSPENDED/EXPIRED/PAYMENT.FAILED, PAYMENT.SALE.COMPLETED.</p>${edit ? '<button class="btn primary" style="margin-top:14px" data-save="paypal">Guardar PayPal</button>' : ''}</div></div>`;
      $$('[data-save]', tab).forEach((b) => (b.onclick = async () => { const p = b.dataset.save, body = {}; $$(`[data-p=${p}]`, tab).forEach((i) => { if (i.value) body[i.dataset.k] = i.value; }); if (!Object.keys(body).length) return L.toast('Nada para guardar.', 'warn'); try { await L.put('/api/admin/credentials/' + p, body); L.toast('Credenciais guardadas (cifradas).'); V.configuracoes(); } catch (e) { L.err(e); } }));
    };
    T.bancos = () => {
      const card = (k, title) => { const b = S[k]; return `<div class="card" data-bank="${k}"><div class="row between"><h3>${esc(title)}</h3>${b.example ? '<span class="tag warn">EXEMPLO de testes</span>' : b.iban ? '<span class="tag ok">configurado</span>' : '<span class="tag warn">por preencher</span>'}</div>
        ${b.example ? '<div class="notice bad" style="margin-top:12px">Dados de exemplo — ao gravar dados reais deixam de ser exemplo.</div>' : ''}
        <label class="f">Titular</label><input class="field" name="holder" value="${esc(b.holder)}" ${dis}><label class="f">Banco</label><input class="field" name="bank" value="${esc(b.bank)}" ${dis}><label class="f">IBAN / número de conta</label><input class="field mono" name="iban" value="${esc(b.iban)}" ${dis}><label class="f">SWIFT/BIC</label><input class="field mono" name="swift" value="${esc(b.swift || '')}" ${dis}>
        <div class="grid g2" style="gap:0 12px"><div><label class="f">Moeda</label><select class="field" name="currency" ${dis}>${['EUR', 'AOA', 'USD'].map((c) => `<option ${b.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div><div><label class="f">Prazo de pagamento (dias)</label><input class="field" name="deadlineDays" type="number" min="1" max="60" value="${b.deadlineDays || 5}" ${dis}></div></div>
        <label class="f">Instruções ao cliente</label><textarea class="field" name="instructions" rows="3" style="font-family:var(--sans);min-height:70px" ${dis}>${esc(b.instructions || '')}</textarea>${edit ? '<button class="btn primary" style="margin-top:14px" data-save>Guardar</button>' : ''}</div>`; };
      tab.innerHTML = `<div class="grid g2" style="align-items:start">${card('bank_pt', 'Conta em Portugal')}${card('bank_ao', 'Conta em Angola')}</div><p class="small dim" style="margin-top:12px">Os dados bancários reais nunca são inventados: ficam vazios até os preencheres. O método só aparece aos clientes quando titular, banco e IBAN estiverem preenchidos e houver câmbio para a moeda.</p>`;
      $$('[data-bank] [data-save]', tab).forEach((b) => (b.onclick = async () => { const c = b.closest('[data-bank]'), g = (n) => c.querySelector(`[name=${n}]`).value.trim(); const r = await ask('Guardar dados bancários', 'Os clientes passam a ver estes dados para transferir. Confirma que estão corretos.', 'Guardar', { reason: true }); if (!r) return; saveSetting(c.dataset.bank, { holder: g('holder'), bank: g('bank'), iban: g('iban'), swift: g('swift'), currency: g('currency'), deadlineDays: +g('deadlineDays') || 5, instructions: g('instructions') }, r.reason); }));
    };
    T.moedas = () => {
      const R = S.currencies.rates;
      tab.innerHTML = `<div class="card"><p class="muted small">Moeda base: <strong>USD</strong>. As transferências em EUR e AOA usam estas taxas (1 USD = x). O cliente vê o preço base e o câmbio aplicado. Os kwanzas são arredondados à unidade.</p>
        <table class="t" style="margin-top:10px"><tr><th>Moeda</th><th>1 USD =</th><th>Nota</th></tr>${Object.entries(R).map(([c, r]) => `<tr data-cur="${c}"><td>${esc(c)}</td><td><input class="field" type="number" step="0.0001" min="0" name="rate" value="${r.rate ?? ''}" placeholder="por configurar" style="width:160px" ${dis}></td><td class="small ${r.note ? 'warn-t' : 'dim'}">${esc(r.note || (r.rate ? '' : 'sem câmbio — o método fica indisponível'))}</td></tr>`).join('')}</table>${saveBtn('sv')}</div>`;
      const sv = $('#sv'); if (sv) sv.onclick = () => { const rates = {}; $$('[data-cur]', tab).forEach((tr) => { const v = tr.querySelector('[name=rate]').value; rates[tr.dataset.cur] = { rate: v ? +v : null }; }); saveSetting('currencies', { base: 'USD', rates }); };
    };
    T.impostos = () => {
      const X = S.taxes;
      const row = (r) => `<tr class="tr"><td><input class="field" name="country" value="${esc(r.country || '')}" maxlength="2" style="width:70px;text-transform:uppercase" ${dis}></td><td><input class="field" name="rate" type="number" step="0.01" min="0" max="50" value="${r.rate ?? ''}" style="width:100px" ${dis}></td><td><input class="field" name="label" value="${esc(r.label || '')}" placeholder="ex.: IVA 23%" ${dis}></td><td>${edit ? '<button class="btn sm ghost" data-del>Remover</button>' : ''}</td></tr>`;
      tab.innerHTML = `<div class="notice" style="margin-bottom:14px">As regras fiscais (IVA, OSS, retenções, faturação) têm de ser validadas por um contabilista. Os valores no modo de testes são exemplos.</div><div class="card">
        <label class="f">Modo</label><select class="field" id="mode" style="max-width:360px" ${dis}><option value="added" ${X.mode === 'added' ? 'selected' : ''}>Acrescentado ao preço no checkout</option><option value="included" ${X.mode === 'included' ? 'selected' : ''}>Incluído no preço apresentado</option></select>
        <table class="t" style="margin-top:14px" id="rules"><tr><th>País</th><th>Taxa %</th><th>Designação</th><th></th></tr>${(X.rules || []).map(row).join('')}</table>
        ${edit ? '<button class="btn sm" style="margin-top:10px" id="add">Adicionar regra</button>' : ''}${saveBtn('sv')}</div>`;
      const bindDel = () => $$('[data-del]', tab).forEach((b) => (b.onclick = () => b.closest('tr').remove()));
      bindDel();
      const add = $('#add'); if (add) add.onclick = () => { $('#rules tbody').insertAdjacentHTML('beforeend', row({})); bindDel(); };
      const sv = $('#sv'); if (sv) sv.onclick = () => { const rules = $$('#rules .tr', tab).map((tr) => ({ country: tr.querySelector('[name=country]').value.trim().toUpperCase(), rate: +tr.querySelector('[name=rate]').value || 0, label: tr.querySelector('[name=label]').value.trim() })).filter((r) => /^[A-Z]{2}$/.test(r.country)); saveSetting('taxes', { mode: $('#mode').value, rules }); };
    };
    T.licenciamento = () => {
      const Lc = S.licensing, Dm = S.demo;
      tab.innerHTML = `<div class="grid g2" style="align-items:start"><div class="card"><h3>Licenciamento</h3>
        <label class="f">Tolerância das subscrições após o fim do período (dias)</label><input class="field" id="grace" type="number" min="0" max="60" value="${Lc.graceDays}" ${dis}>
        <label class="f">Mudanças de computador permitidas</label><div class="row"><input class="field" id="tl" type="number" min="1" max="50" value="${Lc.transferLimit}" style="width:100px" ${dis}><span class="muted small">em</span><input class="field" id="tw" type="number" min="1" max="365" value="${Lc.transferWindowDays}" style="width:100px" ${dis}><span class="muted small">dias</span></div>
        <label class="f">Validação online pela app (a cada x dias)</label><input class="field" id="cd" type="number" min="1" max="60" value="${Lc.checkDays}" ${dis}>
        <p class="hint">Licenças perpétuas funcionam offline depois de ativadas. Subscrições funcionam offline até ao fim do período pago + tolerância.</p>${saveBtn('svL')}</div>
        <div class="card"><h3>Demonstração</h3><label class="f">Segundos de exportação na demo</label><input class="field" id="ds" type="number" min="0" max="600" value="${Dm.exportSeconds}" ${dis}>
        <label class="f">Formatos de exportação na demo</label><input class="field" id="df" value="${esc((Dm.formats || []).join(', '))}" placeholder="mp3" ${dis}>
        <label class="f">Texto apresentado</label><textarea class="field" id="dt" rows="3" style="font-family:var(--sans);min-height:70px" ${dis}>${esc(Dm.text || '')}</textarea>${saveBtn('svD')}</div>
        <div class="card" style="grid-column:1/-1"><h3>Chave pública de verificação</h3><p class="muted small" style="margin-top:6px">A app verifica os comprovativos de licença offline com esta chave (ECDSA P-256). A chave privada fica só no servidor.</p><div class="code" style="margin-top:10px;overflow-wrap:anywhere">${esc(S.licensePublicKey)}</div><button class="btn sm" style="margin-top:10px" id="cpk">Copiar</button></div></div>`;
      $('#cpk').onclick = () => L.copy(S.licensePublicKey);
      const a = $('#svL'); if (a) a.onclick = () => saveSetting('licensing', { graceDays: +$('#grace').value, transferLimit: +$('#tl').value, transferWindowDays: +$('#tw').value, checkDays: +$('#cd').value });
      const b = $('#svD'); if (b) b.onclick = () => saveSetting('demo', { exportSeconds: +$('#ds').value, formats: $('#df').value.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean), text: $('#dt').value.trim() });
    };
    T.loja = () => {
      const St = S.store, Su = S.support, Se = S.security;
      tab.innerHTML = `<div class="grid g2" style="align-items:start"><div class="card"><h3>Loja</h3>
        <label class="f">Aviso de impostos</label><textarea class="field" id="tn" rows="3" style="font-family:var(--sans);min-height:70px" ${dis}>${esc(St.taxNotice)}</textarea>
        <label class="f">Garantia de reembolso da licença perpétua (dias)</label><input class="field" id="rd" type="number" min="0" max="60" value="${St.refundDaysPerpetual}" ${dis}>${saveBtn('svS')}</div>
        <div class="stack"><div class="card"><h3>Suporte</h3><label class="f">Email de suporte</label><input class="field" id="se" value="${esc(Su.email || '')}" ${dis}><label class="f">Centro de ajuda (URL)</label><input class="field" id="su" value="${esc(Su.url || '')}" ${dis}>${saveBtn('svU')}</div>
        <div class="card"><h3>Segurança</h3><label class="check" style="margin-top:10px"><input type="checkbox" id="r2" ${Se.require2faForStaff ? 'checked' : ''} ${dis}> <span>Exigir verificação em dois passos a toda a equipa</span></label>
          <div class="grid g2" style="gap:0 12px"><div><label class="f">Tentativas de login</label><input class="field" id="la" type="number" min="3" max="20" value="${Se.loginMaxAttempts}" ${dis}></div><div><label class="f">Bloqueio (minutos)</label><input class="field" id="lm" type="number" min="1" max="240" value="${Se.lockMinutes}" ${dis}></div></div>
          <p class="hint">Emails: ${esc(S.emailProvider === 'outbox' ? 'caixa de saída de testes (não enviados)' : S.emailProvider)}.</p>${saveBtn('svX')}</div></div></div>`;
      const on = (s, fn) => { const b = $(s); if (b) b.onclick = fn; };
      on('#svS', () => saveSetting('store', { ...St, taxNotice: $('#tn').value.trim(), refundDaysPerpetual: +$('#rd').value }));
      on('#svU', () => saveSetting('support', { email: $('#se').value.trim(), url: $('#su').value.trim() }));
      on('#svX', async () => { if ($('#r2').checked && !U.totp_enabled) return L.toast('Ativa primeiro a tua 2FA em “A minha segurança”.', 'warn'); saveSetting('security', { require2faForStaff: $('#r2').checked, loginMaxAttempts: +$('#la').value, lockMinutes: +$('#lm').value }); });
    };
    T.versoes = () => {
      tab.innerHTML = `<div class="card"><table class="t"><tr><th>Versão</th><th>Notas</th><th>Ligações</th><th>Atual</th><th>Publicada</th></tr>${S.versions.map((v) => `<tr><td class="mono">${esc(v.version)}</td><td class="small">${esc(v.notes || '')}</td><td class="small">${[v.url_web && 'web', v.url_windows && 'Windows', v.url_macos && 'macOS'].filter(Boolean).join(' · ') || '—'}</td><td>${yes(v.is_current)}</td><td class="small muted">${esc(L.date(v.published_at))}</td></tr>`).join('')}</table></div>
        ${edit ? `<div class="card" style="margin-top:16px"><h3>Publicar versão</h3><div class="grid g2" style="gap:0 12px"><div><label class="f">Versão</label><input class="field" id="vv" placeholder="1.8.1"></div><div><label class="f">Aplicação web (https)</label><input class="field" id="vw" placeholder="https://…"></div><div><label class="f">Instalador Windows (https, opcional)</label><input class="field" id="vwin"></div><div><label class="f">Instalador macOS (https, opcional)</label><input class="field" id="vmac"></div></div><label class="f">Notas</label><input class="field" id="vn"><label class="check" style="margin-top:12px"><input type="checkbox" id="vc" checked> <span>Marcar como atual</span></label><button class="btn primary" style="margin-top:14px" id="vs">Publicar</button></div>` : ''}`;
      const vs = $('#vs'); if (vs) vs.onclick = async () => { try { await L.post('/api/admin/versions', { version: $('#vv').value.trim(), url_web: $('#vw').value.trim(), url_windows: $('#vwin').value.trim(), url_macos: $('#vmac').value.trim(), notes: $('#vn').value, current: $('#vc').checked }); L.toast('Versão publicada.'); V.configuracoes(); } catch (e) { L.err(e); } };
    };
    (T[settingsTab] || T.planos)();
  };

  // ---------------- textos legais e emails ----------------
  V.textos = async () => {
    const list = await L.get('/api/admin/texts'), legal = list.filter((x) => !x.key.startsWith('email:')), mails = list.filter((x) => x.key.startsWith('email:'));
    const stateOf = (x) => x.published && x.published === x.draft ? '<span class="tag ok">publicado</span>' : x.validated_at ? '<span class="tag info">validado · por publicar</span>' : x.published ? '<span class="tag warn">alterações por validar</span>' : '<span class="tag warn">rascunho por validar</span>';
    main.innerHTML = head(t('adm.texts'), 'Textos legais: rascunho → validação (jurídica/comercial) → publicação. Os templates de email entram em vigor ao gravar.') + `
      <div class="card"><h3>Textos legais e comerciais</h3><table class="t" style="margin-top:8px">${legal.map((x) => `<tr class="click" data-k="${esc(x.key)}"><td>${esc(x.title)}</td><td>${stateOf(x)}</td><td class="small muted">${x.validated_by ? 'validado por ' + esc(x.validated_by) : ''}</td><td class="small muted">${x.published_at ? 'publicado ' + esc(L.date(x.published_at)) : ''}</td></tr>`).join('')}</table></div>
      <div class="card" style="margin-top:16px"><h3>Templates de email</h3><p class="small muted" style="margin-top:4px">A primeira linha é o assunto (“Assunto: …”). Variáveis entre {{chavetas}}.</p><table class="t" style="margin-top:8px">${mails.map((x) => `<tr class="click" data-k="${esc(x.key)}"><td class="mono small">${esc(x.key.slice(6))}</td><td>${esc(x.title)}</td><td class="small muted">${x.updated_by ? 'editado por ' + esc(x.updated_by) : 'original'}</td></tr>`).join('')}</table></div>`;
    $$('[data-k]').forEach((r) => (r.onclick = () => (location.hash = 'texto/' + encodeURIComponent(r.dataset.k))));
  };
  V.texto = async (key) => {
    const x = (await L.get('/api/admin/texts')).find((y) => y.key === key); if (!x) { main.innerHTML = '<div class="notice bad">Texto inexistente.</div>'; return; }
    const isEmail = key.startsWith('email:'), edit = can('texts.edit'), pub = can('texts.publish'), dirty = x.published !== x.draft;
    main.innerHTML = `<a class="small" href="#textos">← ${esc(t('adm.texts'))}</a>` + head(x.title, isEmail ? 'Template de email — entra em vigor ao gravar.' : (x.published ? `Publicado ${esc(L.date(x.published_at))} por ${esc(x.published_by)}` : 'Ainda não publicado') + (x.validated_at ? ` · validado por ${esc(x.validated_by)}` : '')) + `
      <div class="grid g2" style="align-items:start"><div class="card"><label class="f" style="margin-top:0">Rascunho (markdown simples)</label><textarea class="field" id="tx" rows="24" ${edit ? '' : 'disabled'}>${esc(x.draft)}</textarea>
        <div class="row wrapx" style="margin-top:14px">${edit ? `<button class="btn primary" id="sv">${isEmail ? 'Guardar (entra em vigor)' : 'Guardar rascunho'}</button>` : ''}
        ${!isEmail && pub ? `<button class="btn" id="val" ${x.validated_at ? 'disabled' : ''}>${x.validated_at ? 'Validado' : 'Marcar como validado'}</button><button class="btn acc" id="pub" ${x.validated_at && dirty ? '' : 'disabled'}>Publicar</button>` : ''}</div>
        ${!isEmail ? '<p class="tiny dim" style="margin-top:10px">Qualquer edição anula a validação. Só textos validados podem ser publicados. Em produção, a loja só aceita compras com termos, privacidade e reembolsos publicados.</p>' : ''}</div>
        <div class="card md" id="pv" style="max-height:640px;overflow:auto"></div></div>`;
    const pv = () => ($('#pv').innerHTML = isEmail ? `<div class="code">${esc($('#tx').value)}</div>` : L.md($('#tx').value));
    pv(); $('#tx').oninput = pv;
    const on = (s, fn) => { const b = $(s); if (b) b.onclick = fn; };
    on('#sv', async () => { try { await L.put('/api/admin/texts/' + encodeURIComponent(key), { draft: $('#tx').value }); L.toast(t('common.saved')); V.texto(key); } catch (e) { L.err(e); } });
    on('#val', () => L.modal(`<h3>Validar texto</h3><p class="muted small">Confirma que este texto foi revisto (jurídico/comercial) e pode ser publicado.</p><label class="f">Revisto por (nome/entidade)</label><input class="field" id="rv"><label class="check" style="margin-top:14px"><input type="checkbox" id="ck"> <span>Confirmo a revisão e validação deste texto</span></label><div class="row" style="justify-content:flex-end;margin-top:18px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Validar</button></div>`, (m, close) => {
      m.querySelector('[data-x]').onclick = () => close();
      m.querySelector('[data-ok]').onclick = async () => { if (!m.querySelector('#ck').checked) return L.toast('Confirma a revisão.', 'warn'); try { await L.post(`/api/admin/texts/${encodeURIComponent(key)}/validate`, { confirm: true, reviewer: m.querySelector('#rv').value }); close(); L.toast('Texto validado.'); V.texto(key); } catch (e) { L.err(e); } };
    }));
    on('#pub', async () => { if (!(await ask('Publicar texto', 'A versão validada passa a ser a versão pública.', 'Publicar'))) return; try { await L.post(`/api/admin/texts/${encodeURIComponent(key)}/publish`); L.toast('Publicado.'); V.texto(key); } catch (e) { L.err(e); } });
  };

  // ---------------- equipa ----------------
  V.equipa = async () => {
    const d = await L.get('/api/admin/staff');
    const PL = { 'dashboard.view': 'painel', 'customers.view': 'ver clientes', 'customers.edit': 'editar clientes', 'customers.suspend': 'suspender login', 'customers.block': 'bloquear contas', 'orders.view': 'ver encomendas', 'payments.validate': 'validar transferências', 'payments.refund': 'reembolsos', 'payments.events': 'eventos', 'licenses.view': 'ver licenças', 'licenses.manage': 'gerir licenças e computadores', 'licenses.revoke': 'revogar', 'licenses.issue': 'emitir ofertas/demos', 'subscriptions.manage': 'gerir subscrições', 'settings.view': 'ver configurações', 'settings.edit': 'alterar configurações', 'texts.edit': 'editar textos', 'texts.publish': 'validar/publicar textos', 'staff.manage': 'equipa', 'audit.view': 'auditoria', 'emails.view': 'emails' };
    main.innerHTML = head(t('adm.staff'), 'Convites por email: cada membro define a sua palavra-passe. Ninguém vê palavras-passe de outros.', '<button class="btn primary" id="inv">Convidar membro</button>') + `
      <div class="card tscroll" style="padding:6px 10px"><table class="t"><tr><th>Membro</th><th>Perfil</th><th>Estado</th><th>2FA</th><th>Último acesso</th><th></th></tr>${d.staff.map((s) => `<tr><td>${esc(s.name)}<div class="tiny dim">${esc(s.email)}</div></td><td>${esc((d.roles.find((r) => r.id === s.role) || {}).label || s.role)}</td><td>${L.statusTag(s.status)}${s.invited ? ' <span class="tag info">convite</span>' : ''}</td><td>${s.totp_enabled ? '<span class="tag ok">ativa</span>' : '<span class="tag warn">inativa</span>'}</td><td class="small muted">${esc(L.rel(s.last_login_at))}</td><td>${s.id !== U.id ? `<button class="btn sm ghost" data-ed="${s.id}" data-role="${s.role}" data-status="${s.status}">Alterar</button>` : '<span class="tiny dim">tu</span>'}</td></tr>`).join('')}</table></div>
      <div class="grid g3" style="margin-top:16px">${d.roles.map((r) => `<div class="card"><h3>${esc(r.label)}</h3><p class="small muted" style="margin-top:8px">${r.perms.map((p) => esc(PL[p] || p)).join(' · ')}</p></div>`).join('')}</div>`;
    const roleOpts = (cur) => d.roles.map((r) => `<option value="${r.id}" ${cur === r.id ? 'selected' : ''}>${esc(r.label)}</option>`).join('');
    $('#inv').onclick = () => L.modal(`<h3>Convidar membro da equipa</h3><label class="f">Nome</label><input class="field" id="n"><label class="f">Email</label><input class="field" id="e" type="email"><label class="f">Perfil</label><select class="field" id="r">${roleOpts('support')}</select><div class="row" style="justify-content:flex-end;margin-top:18px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Enviar convite</button></div>`, (m, close) => {
      m.querySelector('[data-x]').onclick = () => close();
      m.querySelector('[data-ok]').onclick = async () => { try { await L.post('/api/admin/staff', { name: m.querySelector('#n').value, email: m.querySelector('#e').value, role: m.querySelector('#r').value }); close(); L.toast('Convite enviado.'); V.equipa(); } catch (e) { L.err(e); } };
    });
    $$('[data-ed]').forEach((b) => (b.onclick = () => L.modal(`<h3>Alterar membro</h3><label class="f">Perfil</label><select class="field" id="r">${roleOpts(b.dataset.role)}</select><label class="f">Estado</label><select class="field" id="s"><option value="active" ${b.dataset.status === 'active' ? 'selected' : ''}>Ativo</option><option value="blocked" ${b.dataset.status === 'blocked' ? 'selected' : ''}>Bloqueado</option></select><label class="f">Motivo</label><input class="field" id="m"><div class="row" style="justify-content:flex-end;margin-top:18px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Guardar</button></div>`, (m, close) => {
      m.querySelector('[data-x]').onclick = () => close();
      m.querySelector('[data-ok]').onclick = async () => { try { await L.patch('/api/admin/staff/' + b.dataset.ed, { role: m.querySelector('#r').value, status: m.querySelector('#s').value, reason: m.querySelector('#m').value }); close(); L.toast(t('common.saved')); V.equipa(); } catch (e) { L.err(e); } };
    })));
  };

  // ---------------- auditoria e emails ----------------
  V.auditoria = async () => {
    const q = sessionStorage.getItem('mm.adm.aq') || '';
    const list = await L.get('/api/admin/audit?q=' + encodeURIComponent(q));
    main.innerHTML = head(t('adm.audit'), 'Registo das ações sensíveis: quem, quando, o quê e porquê. Credenciais e palavras-passe nunca são registadas.') + `<input class="field" id="q" placeholder="Filtrar por ação (ex.: transfer, license, customer)" value="${esc(q)}" style="max-width:360px;margin-bottom:14px">
      <div class="card tscroll" style="padding:6px 10px"><table class="t"><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Alvo</th><th>Motivo</th><th>Detalhes</th></tr>${list.map((a) => `<tr><td class="small" style="white-space:nowrap">${esc(L.date(a.at, true))}</td><td class="small">${esc(a.actor_email || '—')}</td><td class="mono small">${esc(a.action)}</td><td class="tiny dim">${esc(a.target_type || '')}</td><td class="small">${esc(a.reason || '')}</td><td class="tiny dim" style="max-width:320px;overflow-wrap:anywhere">${esc(a.details || '')}</td></tr>`).join('')}</table></div>`;
    $('#q').onkeydown = (e) => { if (e.key === 'Enter') { sessionStorage.setItem('mm.adm.aq', $('#q').value); V.auditoria(); } };
  };
  V.emails = async () => {
    const list = await L.get('/api/admin/emails');
    main.innerHTML = head(t('adm.emails'), 'Emails enviados (ou retidos na caixa de saída, no modo de testes).') + `<div class="card tscroll" style="padding:6px 10px"><table class="t"><tr><th>Quando</th><th>Para</th><th>Template</th><th>Assunto</th><th>Estado</th></tr>${list.map((m) => `<tr class="click" data-m="${m.id}"><td class="small" style="white-space:nowrap">${esc(L.date(m.created_at, true))}</td><td class="small">${esc(m.to_addr)}</td><td class="mono tiny">${esc(m.template)}</td><td class="small">${esc(m.subject)}</td><td>${m.status === 'sent' ? '<span class="tag ok">enviado</span>' : m.status === 'test' ? '<span class="tag warn">teste</span>' : m.status === 'failed' ? `<span class="tag bad" title="${esc(m.error || '')}">falhou</span>` : '<span class="tag">em fila</span>'}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Sem emails.</td></tr>'}</table></div>`;
    $$('[data-m]').forEach((r) => (r.onclick = () => { const m = list.find((x) => String(x.id) === r.dataset.m); L.modal(`<h3>${esc(m.subject)}</h3><p class="small muted">Para ${esc(m.to_addr)} · ${esc(L.date(m.created_at, true))}</p><div class="code" style="margin-top:12px">${esc(m.body)}</div><div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn" data-x>Fechar</button></div>`, (mm, close) => (mm.querySelector('[data-x]').onclick = () => close())); }));
  };

  // ---------------- a minha segurança ----------------
  V.seguranca = async () => {
    const m = await L.loadMe();
    main.innerHTML = head(t('adm.me'), `${esc(U.email)} · ${esc(me.roleLabel)}`) + (m.require2fa ? '<div class="notice bad" style="margin-bottom:16px">A verificação em dois passos é obrigatória para a equipa. Ativa-a para continuares a usar a administração.</div>' : '') + `
      <div class="grid g2" style="align-items:start"><div class="card" id="mfa"></div>
      <form class="card" id="pw"><h3>Alterar palavra-passe</h3><label class="f">Atual</label><input class="field" id="cur" type="password" autocomplete="current-password"><label class="f">Nova</label><input class="field" id="np" type="password" autocomplete="new-password"><p class="hint">Pelo menos 10 caracteres. As outras sessões serão terminadas.</p><button class="btn" style="margin-top:14px">Alterar</button></form></div>`;
    L.mfaCard($('#mfa'), m.user, () => location.reload());
    $('#pw').onsubmit = async (e) => { e.preventDefault(); try { await L.post('/api/auth/change-password', { current: $('#cur').value, password: $('#np').value }); L.toast('Palavra-passe alterada.'); $('#cur').value = $('#np').value = ''; } catch (er) { L.err(er); } };
  };

  function route() {
    let [k, arg] = (location.hash.slice(1) || '').split('/');
    if (me.require2fa) k = 'seguranca';
    if (!V[k]) k = can('dashboard.view') ? 'painel' : 'seguranca';
    drawSide(k);
    window.scrollTo(0, 0);
    main.innerHTML = '<div class="skel">A carregar…</div>';
    Promise.resolve(V[k](arg && decodeURIComponent(arg))).catch((e) => { main.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; if (e.code === 'MFA_OBRIGATORIA') location.hash = 'seguranca'; });
  }
  window.addEventListener('hashchange', route);
  if (can('orders.view')) L.get('/api/admin/transfers').then((l) => { badge = l.filter((o) => o.status === 'awaiting_validation').length; drawSide((location.hash.slice(1) || 'painel').split('/')[0]); }).catch(() => {});
  route();
  void reload;
})();
