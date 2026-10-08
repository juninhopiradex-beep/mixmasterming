// Área do cliente (SPA por hash): resumo, licenças e computador, subscrições, compras e comprovativos, downloads, perfil, suporte.
(async function () {
  const { esc, $, $$ } = L;
  const me = await L.chrome('conta');
  L.footer();
  if (!me.user) { location.replace('/entrar?next=' + encodeURIComponent('/conta' + location.hash)); return; }
  if (me.user.role !== 'customer') { location.replace('/admin'); return; }
  const main = $('#main'), side = $('#side');
  let D = null;
  const load = async () => (D = await L.get('/api/account/overview'));

  const NAV = [['resumo', 'acc.overview'], ['licencas', 'acc.licenses'], ['subscricoes', 'acc.subs'], ['encomendas', 'acc.orders'], ['downloads', 'acc.downloads'], ['perfil', 'acc.profile'], ['suporte', 'acc.support']];
  const drawSide = (cur) => {
    const pend = D ? D.orders.filter((o) => o.bank && o.status === 'pending').length : 0;
    side.innerHTML = `<div class="grp">${esc(t('acc.title'))}</div>` + NAV.map(([k, l]) => `<a href="#${k}" class="${cur === k || (cur === 'encomenda' && k === 'encomendas') ? 'on' : ''}">${esc(t(l))}${k === 'encomendas' && pend ? `<span class="n">${pend}</span>` : ''}</a>`).join('');
  };
  const head = (h, sub) => `<h1>${esc(h)}</h1>${sub ? `<p class="sub">${sub}</p>` : '<div style="height:18px"></div>'}`;
  const verifyBanner = () => D.verified ? '' : `<div class="notice" style="margin-bottom:18px"><div class="row between wrapx"><span>${esc(t('acc.verify'))}</span><button class="btn sm" id="resend">${esc(t('acc.resend'))}</button></div></div>`;
  const bindResend = () => { const b = $('#resend'); if (b) b.onclick = async () => { b.disabled = true; try { await L.post('/api/auth/resend-verification'); L.toast('Enviámos uma nova ligação de confirmação.'); } catch (e) { L.err(e); b.disabled = false; } }; };

  const V = {};
  V.resumo = () => {
    const act = D.licenses.filter((l) => l.status === 'active');
    const sub = D.subscriptions.find((s) => ['active', 'past_due'].includes(s.status));
    const todo = D.orders.filter((o) => o.bank && ['pending'].includes(o.status));
    const review = D.orders.filter((o) => o.status === 'awaiting_validation');
    main.innerHTML = head(`Olá, ${D.user.name.split(' ')[0]}`, 'Gere as tuas licenças, computadores, subscrições e pagamentos.') + verifyBanner() + `
      <div class="grid g3">
        <div class="card kpi"><div class="k">Licenças ativas</div><div class="v">${act.length}</div><div class="small muted">${act.filter((l) => l.device).length} com computador ativo</div></div>
        <div class="card kpi"><div class="k">Subscrição</div><div class="v" style="font-size:20px">${sub ? esc(sub.plan) : '—'}</div><div class="small muted">${sub ? (sub.cancelAtPeriodEnd ? 'Não renova · acesso até ' + esc(L.date(sub.periodEnd)) : sub.manual ? 'Renovação manual · até ' + esc(L.date(sub.periodEnd)) : 'Renova em ' + esc(L.date(sub.periodEnd))) : 'Sem subscrição ativa'}</div></div>
        <div class="card kpi"><div class="k">Pagamentos pendentes</div><div class="v">${todo.length + review.length}</div><div class="small muted">${review.length ? review.length + ' a aguardar validação' : 'Nenhum em análise'}</div></div>
      </div>
      ${todo.length ? `<div class="card" style="margin-top:16px"><h3>Ações pendentes</h3><div class="stack" style="margin-top:12px">${todo.map((o) => { const ni = o.proofs.find((p) => p.status === 'needs_info'); return `<div class="row between wrapx"><span>${ni ? '<span class="tag warn">Pedimos esclarecimento</span>' : '<span class="tag warn">Envia o comprovativo</span>'} <span class="mono">${esc(o.ref)}</span> · ${esc(o.plan)} · ${esc(o.amount)}</span><a class="btn sm acc" href="#encomenda/${esc(o.ref)}">Abrir</a></div>`; }).join('')}</div></div>` : ''}
      <div class="grid g2" style="margin-top:16px">
        <div class="card"><h3>Palavra-passe ≠ chave de licença</h3><p class="muted small" style="margin-top:8px">A <strong>palavra-passe</strong> dá acesso a esta área. A <strong>chave de licença</strong> ativa o MIXMIND num computador. Cada licença funciona num computador de cada vez; para mudar, desativa o antigo em <a href="#licencas">Licenças e computador</a>.</p></div>
        <div class="card"><h3>Últimas compras</h3>${D.orders.length ? `<div class="stack small" style="margin-top:10px">${D.orders.slice(0, 4).map((o) => `<div class="row between"><a href="#encomenda/${esc(o.ref)}" class="mono">${esc(o.ref)}</a><span>${esc(o.amount)} ${L.statusTag(o.status)}</span></div>`).join('')}</div>` : '<p class="muted small" style="margin-top:8px">Ainda não fizeste compras. <a href="/comprar">Ver planos</a></p>'}</div>
      </div>`;
    bindResend();
  };

  V.licencas = () => {
    const LC = D.licensing;
    main.innerHTML = head(t('acc.licenses'), `Cada licença permite <strong>um computador ativo</strong>. Podes mudar de computador até ${LC.transferLimit} vezes em ${LC.transferWindowDays} dias; se precisares de mais, contacta o suporte.`) + verifyBanner() +
      (D.licenses.length ? `<div class="stack">${D.licenses.map((l) => `<div class="card">
        <div class="row between wrapx"><div class="row wrapx" style="gap:8px"><h3>${esc(t('lic.' + l.type))} · versão ${l.major}.x</h3>${L.statusTag(l.status)}</div><span class="small dim">Emitida ${esc(L.date(l.issued_at))}${l.expires_at ? ' · válida até ' + esc(L.date(l.expires_at)) : ' · sem data de fim'}</span></div>
        <div class="row wrapx" style="margin-top:14px">${l.key ? `<span class="key">${esc(l.key)}</span><button class="btn sm" data-copy="${esc(l.key)}">${esc(t('common.copy'))}</button>` : `<span class="key">MMX1-•••••-•••••-•••••-${esc(l.key4)}</span><span class="small warn-t">Confirma o email para veres a chave completa.</span>`}</div>
        ${l.statusReason && l.status !== 'active' ? `<div class="notice bad" style="margin-top:12px">${esc(l.statusReason)}</div>` : ''}
        <hr class="sep" style="margin:16px 0">
        ${l.device ? `<div class="row between wrapx"><div><div class="small muted">Computador ativo</div><div style="font-weight:600;margin-top:2px">${esc(l.device.name || 'Computador')} <span class="tag">${esc(l.device.platform || '—')}</span></div><div class="small dim">MIXMIND ${esc(l.device.app_version || '—')} · ativado ${esc(L.date(l.device.activated_at))} · último contacto ${esc(L.rel(l.device.last_seen_at))}</div></div>
          <div class="row"><button class="btn sm" data-hist="${l.id}">Histórico</button><button class="btn sm danger" data-deact="${l.id}" ${D.verified ? '' : 'disabled'}>Desativar este computador</button></div></div>`
        : `<div class="row between wrapx"><span class="muted small">Nenhum computador ativo. Introduz a chave na aplicação (Definições → Licença) para ativar.</span><button class="btn sm" data-hist="${l.id}">Histórico</button></div>`}
      </div>`).join('')}</div>` : `<div class="card"><p class="muted">Ainda não tens licenças. <a href="/comprar">Ver planos</a> ou experimenta a demonstração gratuita.</p></div>`);
    bindResend();
    $$('[data-copy]').forEach((b) => (b.onclick = () => L.copy(b.dataset.copy)));
    $$('[data-deact]').forEach((b) => (b.onclick = async () => {
      if (!(await L.confirm(t('acc.deactivate.q'), t('acc.deactivate.t'), 'Desativar', { danger: true }))) return;
      try { await L.post(`/api/account/licenses/${b.dataset.deact}/deactivate`); L.toast('Computador desativado. A licença está livre para outro computador.'); await load(); V.licencas(); } catch (e) { L.err(e); }
    }));
    $$('[data-hist]').forEach((b) => (b.onclick = async () => {
      try {
        const h = await L.get(`/api/account/licenses/${b.dataset.hist}/history`);
        L.modal(`<h3>Histórico da licença</h3><h4 class="eyebrow" style="margin:16px 0 8px">Computadores</h4>${h.devices.length ? `<table class="t"><tr><th>Computador</th><th>Ativado</th><th>Desativado</th></tr>${h.devices.map((d) => `<tr><td>${esc(d.name || '—')} <span class="dim">${esc(d.platform || '')}</span></td><td>${esc(L.date(d.activated_at))}</td><td>${d.deactivated_at ? esc(L.date(d.deactivated_at)) : '<span class="tag ok">ativo</span>'}</td></tr>`).join('')}</table>` : '<p class="muted small">Nenhum.</p>'}
          <h4 class="eyebrow" style="margin:18px 0 8px">Eventos</h4><ul class="timeline">${h.events.map((e) => `<li class="${/revok|deactiv|suspend|expired|refunded|disputed/.test(e.action) ? 'bad' : 'on'}"><strong>${esc(L.licAction(e.action))}</strong> <span class="dim">· ${esc(L.date(e.at, true))} · ${esc(e.actor)}</span></li>`).join('')}</ul>
          <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-x>${esc(t('common.close'))}</button></div>`, (m, close) => (m.querySelector('[data-x]').onclick = () => close()));
      } catch (e) { L.err(e); }
    }));
  };

  V.subscricoes = () => {
    main.innerHTML = head(t('acc.subs'), 'Cartão e PayPal renovam automaticamente. Transferências renovam manualmente: crias a encomenda de renovação e envias o comprovativo.') +
      (D.subscriptions.length ? `<div class="stack">${D.subscriptions.map((s) => `<div class="card"><div class="row between wrapx"><div class="row wrapx" style="gap:8px"><h3>${esc(s.plan)}</h3>${L.statusTag(s.status)}${s.cancelAtPeriodEnd ? '<span class="tag">não renova</span>' : ''}</div><span class="small muted">${esc(s.methodLabel)}</span></div>
        <dl class="kv" style="margin-top:14px"><dt>Período pago até</dt><dd>${esc(L.date(s.periodEnd))}</dd><dt>Renovação</dt><dd>${s.cancelAtPeriodEnd ? 'Cancelada — manténs o acesso até ' + esc(L.date(s.periodEnd)) : s.manual ? 'Manual (transferência)' : s.autoRenew ? 'Automática em ' + esc(L.date(s.nextRenewal)) : '—'}</dd></dl>
        ${s.status === 'past_due' ? '<div class="notice bad" style="margin-top:12px">A última cobrança falhou. Atualiza o método de pagamento no prestador; manténs o acesso durante a tolerância.</div>' : ''}
        <div class="row wrapx" style="margin-top:16px">
          ${s.manual && ['active', 'past_due', 'expired'].includes(s.status) ? (s.pendingRenewal ? '<a class="btn sm acc" href="#encomendas">Renovação pendente — ver encomendas</a>' : `<button class="btn sm acc" data-renew="${s.id}">Renovar por transferência</button>`) : ''}
          ${['active', 'past_due'].includes(s.status) && !s.cancelAtPeriodEnd ? `<button class="btn sm danger" data-cancel="${s.id}" data-until="${s.periodEnd}">Cancelar a renovação</button>` : ''}
        </div></div>`).join('')}</div>` : '<div class="card"><p class="muted">Não tens subscrições. <a href="/comprar?plano=annual">Ver planos</a></p></div>') +
      '<p class="small dim" style="margin-top:16px">Os pagamentos de subscrição não são reembolsáveis, sem prejuízo dos direitos legais aplicáveis. <a href="/reembolsos">Política de reembolsos</a>.</p>';
    $$('[data-cancel]').forEach((b) => (b.onclick = async () => {
      if (!(await L.confirm(t('acc.cancel.q'), t('acc.cancel.t', { date: L.date(+b.dataset.until) }), 'Cancelar a renovação', { danger: true }))) return;
      try { const r = await L.post(`/api/account/subscriptions/${b.dataset.cancel}/cancel`); L.toast('Renovação cancelada. Acesso até ' + L.date(r.accessUntil) + '.'); await load(); V.subscricoes(); } catch (e) { L.err(e); }
    }));
    $$('[data-renew]').forEach((b) => (b.onclick = async () => { try { const r = await L.post(`/api/account/subscriptions/${b.dataset.renew}/renew`, {}); await load(); location.hash = 'encomenda/' + r.ref; } catch (e) { L.err(e); } }));
  };

  V.encomendas = () => {
    main.innerHTML = head(t('acc.orders')) + (D.orders.length ? `<div class="card tscroll" style="padding:6px 10px"><table class="t"><tr><th>Referência</th><th>Plano</th><th>Método</th><th>Valor</th><th>Estado</th><th>Data</th></tr>${D.orders.map((o) => `<tr class="click" data-ref="${esc(o.ref)}"><td class="mono">${esc(o.ref)}</td><td>${esc(o.plan)}${o.kind === 'renewal' ? ' <span class="tag">renovação</span>' : ''}</td><td class="small">${esc(o.methodLabel)}</td><td>${esc(o.amount)}</td><td>${L.statusTag(o.status)}</td><td class="small muted">${esc(L.date(o.created_at))}</td></tr>`).join('')}</table></div>` : '<div class="card"><p class="muted">Ainda não fizeste compras.</p></div>');
    $$('[data-ref]').forEach((r) => (r.onclick = () => (location.hash = 'encomenda/' + r.dataset.ref)));
  };

  V.encomenda = async (ref) => {
    let o; try { o = await L.get('/api/account/orders/' + encodeURIComponent(ref)); } catch (e) { main.innerHTML = head('Encomenda') + `<div class="notice bad">${esc(e.message)}</div>`; return; }
    const bank = ['bank_pt', 'bank_ao'].includes(o.method);
    const hasProof = o.proofs.some((p) => ['submitted', 'accepted'].includes(p.status));
    const steps = bank ? [['Encomenda criada', true], ['Transferência e comprovativo', hasProof || o.status !== 'pending'], ['Validação pela equipa', o.status === 'confirmed'], ['Licença emitida', o.status === 'confirmed']]
      : [['Encomenda criada', true], ['Pagamento no prestador', o.status !== 'pending'], ['Confirmação pelo servidor', o.status === 'confirmed'], ['Licença emitida', o.status === 'confirmed']];
    const cur = steps.findIndex((s) => !s[1]);
    const ni = o.proofs.find((p) => p.status === 'needs_info'), rej = o.proofs.find((p) => p.status === 'rejected');
    const B = o.bank;
    main.innerHTML = `<a href="#encomendas" class="small">← Compras e pagamentos</a>` + head(`Encomenda ${o.ref}`, `${esc(o.plan)}${o.kind === 'renewal' ? ' (renovação)' : ''} · ${esc(o.methodLabel)} · criada ${esc(L.date(o.created_at, true))}`) + `
      <div class="steps" style="margin-bottom:18px">${steps.map((s, i) => `<span class="${s[1] ? 'done' : i === cur ? 'on' : ''}">${s[1] ? '✓ ' : ''}${esc(s[0])}</span>`).join('')}</div>
      <div class="grid g2" style="align-items:start">
        <div class="stack">
          <div class="card"><div class="row between"><h3>Resumo</h3>${L.statusTag(o.status)}</div>
            <dl class="kv" style="margin-top:14px"><dt>Total</dt><dd style="font-size:20px;font-weight:700">${esc(o.amount)}</dd>${o.tax ? `<dt>Inclui imposto</dt><dd>${esc(o.tax)}</dd>` : ''}${o.currency !== 'USD' ? `<dt>Preço base</dt><dd>${esc(o.usd)} · câmbio ${esc(String(o.fx).replace('.', ','))}</dd>` : ''}${o.due_at && o.status === 'pending' ? `<dt>Prazo</dt><dd>${esc(L.date(o.due_at))}</dd>` : ''}${o.confirmed_at ? `<dt>Confirmado</dt><dd>${esc(L.date(o.confirmed_at, true))}</dd>` : ''}</dl>
            ${o.status === 'confirmed' ? '<div class="notice ok" style="margin-top:14px">Pagamento confirmado. A licença está em <a href="#licencas">Licenças e computador</a>.</div>' : ''}
            ${!bank && o.status === 'pending' ? `<div class="notice info" style="margin-top:14px">A aguardar a confirmação do prestador de pagamento. A licença é emitida automaticamente quando o servidor receber a confirmação.${o.method === 'test' ? ` <a href="/teste-pagamento?ref=${encodeURIComponent(o.ref)}">Abrir o pagamento simulado</a>.` : ''}</div>` : ''}
            ${o.status === 'pending' ? '<button class="btn sm ghost" style="margin-top:12px" id="cancelOrder">Cancelar esta encomenda</button>' : ''}
          </div>
          ${B ? `<div class="card"><h3>Dados para a transferência</h3>${B.example ? '<div class="notice bad" style="margin-top:12px"><strong>Dados de EXEMPLO (modo de testes).</strong> Não transfiras dinheiro para esta conta.</div>' : ''}
            <dl class="kv" style="margin-top:14px"><dt>Titular</dt><dd>${esc(B.holder)}</dd><dt>Banco</dt><dd>${esc(B.bank)}</dd><dt>IBAN / conta</dt><dd><span class="mono">${esc(B.iban)}</span> <button class="btn sm ghost" data-copy="${esc(B.iban)}">${esc(t('common.copy'))}</button></dd>${B.swift ? `<dt>SWIFT/BIC</dt><dd class="mono">${esc(B.swift)}</dd>` : ''}<dt>Valor exato</dt><dd><strong>${esc(o.amount)}</strong></dd><dt>Descritivo</dt><dd><span class="mono">${esc(o.ref)}</span> <button class="btn sm ghost" data-copy="${esc(o.ref)}">${esc(t('common.copy'))}</button></dd></dl>
            ${B.instructions ? `<p class="small muted" style="margin-top:12px">${esc(B.instructions)}</p>` : ''}</div>` : ''}
        </div>
        <div class="stack">
          ${bank && ['pending', 'awaiting_validation'].includes(o.status) ? `<div class="card" id="proofCard"><h3>Enviar comprovativo (borderô)</h3>
            ${ni ? `<div class="notice" style="margin-top:12px"><strong>Pedimos esclarecimento:</strong> ${esc(ni.reason)}</div>` : rej && !hasProof ? `<div class="notice bad" style="margin-top:12px"><strong>Comprovativo rejeitado:</strong> ${esc(rej.reason)}</div>` : ''}
            ${o.status === 'awaiting_validation' ? `<div class="notice info" style="margin-top:12px">${esc(t('acc.proof.ok'))}</div>` : ''}
            <div class="drop" id="drop" style="margin-top:14px"><input type="file" id="file" accept="application/pdf,image/jpeg,image/png" hidden><div style="font-weight:600;color:var(--tx)">Arrasta o ficheiro para aqui</div><div class="small" style="margin-top:4px">ou <a href="#" id="pick">escolhe no computador</a> · PDF, JPG ou PNG até 10 MB</div><div class="small acc-t" id="fname" style="margin-top:8px"></div></div>
            <div class="grid g2" style="gap:0 12px"><div><label class="f" for="pAmount">Valor transferido (${esc(o.currency)})</label><input class="field" id="pAmount" inputmode="decimal" placeholder="ex.: ${esc(o.amount.replace(/[^\d.,]/g, ''))}"></div><div><label class="f" for="pDate">Data da transferência</label><input class="field" id="pDate" type="date"></div></div>
            <label class="f" for="pRef">Referência / descritivo usado</label><input class="field" id="pRef" maxlength="80" value="${esc(o.ref)}">
            ${hasProof ? '<label class="check" style="margin-top:12px"><input type="checkbox" id="pComp"> <span>Complemento (junta ao comprovativo anterior em vez de o substituir)</span></label>' : ''}
            <button class="btn primary block" style="margin-top:16px" id="send">Enviar comprovativo</button>
            <p class="tiny dim" style="margin-top:10px">O envio do comprovativo não ativa a licença. A licença é emitida depois de a equipa confirmar a entrada do valor na conta bancária.</p></div>` : ''}
          ${o.proofs.length ? `<div class="card"><h3>Comprovativos enviados</h3><table class="t" style="margin-top:8px">${o.proofs.map((p) => `<tr><td><a href="/api/account/proofs/${p.id}/file" target="_blank" rel="noopener">${esc(p.filename)}</a><div class="tiny dim">${esc(L.date(p.created_at, true))}${p.declared ? ' · ' + esc(p.declared) : ''}${p.transfer_date ? ' · ' + esc(p.transfer_date) : ''}</div>${p.reason ? `<div class="tiny warn-t">${esc(p.reason)}</div>` : ''}</td><td style="text-align:right">${L.statusTag(p.status, 'proof')}</td></tr>`).join('')}</table></div>` : ''}
        </div>
      </div>`;
    $$('[data-copy]').forEach((b) => (b.onclick = () => L.copy(b.dataset.copy)));
    const co = $('#cancelOrder'); if (co) co.onclick = async () => { if (!(await L.confirm('Cancelar a encomenda?', 'A encomenda deixa de estar ativa. Se já transferiste o valor, não canceles — envia o comprovativo.', 'Cancelar encomenda', { danger: true }))) return; try { await L.post(`/api/account/orders/${encodeURIComponent(o.ref)}/cancel`); await load(); route(); } catch (e) { L.err(e); } };
    if (!$('#proofCard')) return;
    let file = null;
    const pickF = (f) => { if (!f) return; if (f.size > 10 * 1024 * 1024) return L.toast('O ficheiro passa de 10 MB.', 'warn'); if (!/^(application\/pdf|image\/(jpeg|png))$/.test(f.type)) return L.toast('Formato não aceite. Envia PDF, JPG ou PNG.', 'warn'); file = f; $('#fname').textContent = `${f.name} · ${(f.size / 1024).toFixed(0)} KB`; };
    const drop = $('#drop');
    $('#pick').onclick = (e) => { e.preventDefault(); $('#file').click(); };
    $('#file').onchange = (e) => pickF(e.target.files[0]);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); pickF(e.dataTransfer.files[0]); };
    $('#send').onclick = async () => {
      if (!file) return L.toast('Escolhe o ficheiro do comprovativo.', 'warn');
      const q = new URLSearchParams({ filename: file.name, amount: $('#pAmount').value, date: $('#pDate').value, ref: $('#pRef').value, complement: $('#pComp') && $('#pComp').checked ? '1' : '0' });
      const b = $('#send'); b.disabled = true; b.textContent = 'A enviar…';
      try {
        const r = await L.api('POST', `/api/account/orders/${encodeURIComponent(o.ref)}/proofs?${q}`, file, { type: 'application/octet-stream' });
        L.toast(r.message, 'ok', 7000);
        await load(); await V.encomenda(ref);
      } catch (e) { L.err(e); b.disabled = false; b.textContent = 'Enviar comprovativo'; }
    };
  };

  V.downloads = () => {
    const v = D.versions[0];
    const dl = (u, l) => u ? `<a class="btn acc" href="${esc(u)}" rel="noopener">${esc(l)}</a>` : '';
    main.innerHTML = head(t('acc.downloads'), 'O MIXMIND corre no navegador (Chrome, Edge ou Safari recentes) em Windows e macOS, e pode ser instalado como aplicação.') + `
      <div class="grid g2" style="align-items:start">
        <div class="card"><h3>Abrir o MIXMIND</h3><p class="muted small" style="margin-top:8px">${v ? `Versão atual: <strong>${esc(v.version)}</strong> · ${esc(L.date(v.published_at))}` : ''}</p>
          <div class="row wrapx" style="margin-top:14px">${D.appUrl ? `<a class="btn primary" href="${esc(D.appUrl)}" rel="noopener">Abrir a aplicação</a>` : ''}${v ? dl(v.url_windows, 'Instalador Windows') + dl(v.url_macos, 'Instalador macOS') : ''}</div>
          ${v && v.notes ? `<p class="small muted" style="margin-top:14px">${esc(v.notes)}</p>` : ''}
          <p class="tiny dim" style="margin-top:14px">Para instalar: no Chrome/Edge, menu → “Instalar MIXMIND”; no Safari (macOS), Ficheiro → “Adicionar à Dock”. Funciona sem internet depois de instalado.</p></div>
        <div class="card"><h3>Ativar a licença</h3><ol class="small muted" style="padding-left:18px;margin:12px 0 0">
          <li>Abre o MIXMIND e vai a <strong>Definições → Licença</strong>.</li>
          <li>Cola a chave de licença (em <a href="#licencas">Licenças e computador</a>) e carrega em <strong>Ativar</strong>.</li>
          <li>A ativação liga este computador à licença. Precisa de internet só neste passo.</li>
          <li>Para mudar de computador, desativa primeiro o antigo (na aplicação ou aqui) e ativa no novo.</li></ol></div>
      </div>
      ${D.versions.length > 1 ? `<div class="card" style="margin-top:16px"><h3>Versões anteriores</h3><table class="t" style="margin-top:8px">${D.versions.slice(1).map((x) => `<tr><td>${esc(x.version)}</td><td class="small muted">${esc(L.date(x.published_at))}</td><td class="small">${esc(x.notes || '')}</td></tr>`).join('')}</table></div>` : ''}`;
  };

  V.perfil = async () => {
    const u = D.user;
    main.innerHTML = head(t('acc.profile')) + `<div class="grid g2" style="align-items:start">
      <form class="card" id="pf"><h3>Dados da conta</h3>
        <label class="f">Email</label><input class="field" value="${esc(u.email)}" disabled><p class="hint">${u.email_verified ? 'Confirmado.' : 'Por confirmar.'} Para mudar o email, contacta o suporte.</p>
        <label class="f" for="name">Nome</label><input class="field" id="name" value="${esc(u.name)}" maxlength="100">
        <label class="f" for="country">País</label><select class="field" id="country">${L.countryOptions(u.country || '')}</select>
        <label class="f" for="bn">Nome ou empresa para faturação</label><input class="field" id="bn" value="${esc(u.billing_name || '')}" maxlength="120">
        <label class="f" for="ba">Morada de faturação</label><input class="field" id="ba" value="${esc(u.billing_address || '')}" maxlength="300">
        <label class="f" for="tx">NIF / identificação fiscal</label><input class="field" id="tx" value="${esc(u.tax_id || '')}" maxlength="40">
        <button class="btn primary" style="margin-top:18px">${esc(t('common.save'))}</button></form>
      <div class="stack">
        <form class="card" id="pw"><h3>Alterar palavra-passe</h3>
          <label class="f" for="cur">Atual</label><input class="field" id="cur" type="password" autocomplete="current-password">
          <label class="f" for="np">Nova</label><input class="field" id="np" type="password" autocomplete="new-password"><p class="hint">Pelo menos 10 caracteres. As outras sessões serão terminadas.</p>
          <button class="btn" style="margin-top:14px">Alterar</button></form>
        <div class="card" id="mfa"></div>
        <div class="card"><h3>Sessões ativas</h3><div id="sess" class="small" style="margin-top:8px"></div></div>
      </div></div>`;
    $('#pf').onsubmit = async (e) => { e.preventDefault(); try { await L.patch('/api/account/profile', { name: $('#name').value, country: $('#country').value, billing_name: $('#bn').value, billing_address: $('#ba').value, tax_id: $('#tx').value }); L.toast(t('common.saved')); await load(); } catch (er) { L.err(er); } };
    $('#pw').onsubmit = async (e) => { e.preventDefault(); try { await L.post('/api/auth/change-password', { current: $('#cur').value, password: $('#np').value }); L.toast('Palavra-passe alterada.'); $('#cur').value = $('#np').value = ''; drawSessions(); } catch (er) { L.err(er); } };
    L.mfaCard($('#mfa'), u, async () => { await load(); V.perfil(); });
    async function drawSessions() {
      const ss = await L.get('/api/auth/sessions');
      $('#sess').innerHTML = ss.map((s) => `<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line)"><span>${esc((s.ua || 'Navegador').slice(0, 60))}<div class="tiny dim">${esc(s.ip || '')} · ${esc(L.rel(s.last_seen_at))}</div></span>${s.current ? '<span class="tag acc">esta sessão</span>' : `<button class="btn sm ghost" data-rv="${s.id}">Terminar</button>`}</div>`).join('');
      $$('[data-rv]').forEach((b) => (b.onclick = async () => { await L.post(`/api/auth/sessions/${b.dataset.rv}/revoke`); drawSessions(); }));
    }
    drawSessions();
  };

  V.suporte = () => {
    const S = D.support || {};
    main.innerHTML = head(t('acc.support')) + `<div class="grid g2" style="align-items:start"><div class="card"><h3>Contactar o suporte</h3>
      ${S.email || S.url ? `<p class="muted" style="margin-top:8px">${S.email ? `Email: <a href="mailto:${esc(S.email)}">${esc(S.email)}</a>` : ''}${S.url ? `<br>Centro de ajuda: <a href="${esc(S.url)}" rel="noopener">${esc(S.url)}</a>` : ''}</p>` : '<p class="muted" style="margin-top:8px">Os contactos de suporte ainda não foram configurados.</p>'}
      <p class="small dim" style="margin-top:12px">Indica o email da conta e, se for sobre um pagamento, a referência da encomenda. Nunca te pediremos a palavra-passe.</p></div>
      <div class="card faq"><h3>Situações comuns</h3>
        <details><summary>O computador avariou e não consigo desativar</summary><p>Contacta o suporte: libertamos a licença sem contar para o limite de mudanças.</p></details>
        <details><summary>Atingi o limite de mudanças de computador</summary><p>O limite repõe-se automaticamente. Em casos justificados, o suporte pode repô-lo.</p></details>
        <details><summary>Enviei o comprovativo e ainda não tenho licença</summary><p>A licença é emitida quando confirmarmos a entrada do valor na conta. Vais receber um email.</p></details>
        <details><summary>Quero cancelar a subscrição</summary><p>Em Subscrições → Cancelar a renovação. Manténs o acesso até ao fim do período pago.</p></details></div></div>`;
  };

  function route() {
    const [k, arg] = (location.hash.slice(1) || 'resumo').split('/');
    const view = V[k] ? k : 'resumo';
    drawSide(view);
    window.scrollTo(0, 0);
    Promise.resolve(V[view](arg && decodeURIComponent(arg))).catch(L.err);
  }
  try { await load(); } catch (e) { main.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
  window.addEventListener('hashchange', route);
  route();
})();
