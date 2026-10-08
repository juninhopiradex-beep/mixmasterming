// Página de vendas: funcionalidades (com o estado real), planos e preços vindos do servidor, demonstração.
(async function () {
  const { esc, $ } = L;
  // estado real de cada benefício — "soon" = ainda não implementado (não é apresentado como disponível)
  const FEATS = [
    ['M', 'Mistura e master completos', 'A partir dos teus stems — quatro, quarenta ou mais. Gain staging, EQ, dinâmica, espaço, anti-masking e master adaptativo.', 'ok'],
    ['N', 'Notas do Motor', 'Cada decisão fica registada: faixa processada, ajuste realizado e motivo. Tudo editável e reversível.', 'ok'],
    ['F', 'Faders que acompanham o motor', 'Os faders seguem a mistura proposta. Mexe num e assumes o controlo manual desse canal.', 'ok'],
    ['R', 'Referências, perfis e linguagem natural', 'Compara com até 3 referências, escolhe perfis sonoros por estilo e pede alterações por escrito (“mais punch no kick”).', 'ok'],
    ['L', 'Alvos de loudness', 'Streaming (Spotify, Apple Music, YouTube, Tidal), clubes, CD e radiodifusão (EBU R128, ATSC A/85).', 'ok'],
    ['A', 'A/B com volume igualado', 'Alterna entre o original, a mistura e o master com loudness match, sem enganos de volume.', 'ok'],
    ['E', 'Exportação profissional', 'WAV, AIFF e FLAC em 24 bits, MP3 320 e WAV 32-bit float, com metadados (ISRC, UPC) e versões por plataforma.', 'ok'],
    ['O', 'Processamento totalmente offline', 'O motor integrado corre no teu computador. O áudio nunca é enviado para servidores.', 'ok'],
    ['K', 'Motor de IA opcional com a tua chave API', 'Ligação a um modelo de IA externo usando a tua própria chave. Ainda em desenvolvimento.', 'soon'],
    ['1', 'Um computador de cada vez', 'Ativação num único computador, Windows ou macOS. Muda de computador quando quiseres, na área de cliente.', 'ok'],
    ['U', 'Atualizações gratuitas da série 1.x', 'Todas as versões 1.x incluídas, na licença perpétua e na subscrição.', 'ok'],
  ];
  $('#feats').innerHTML = FEATS.map(([ic, h, p, st]) => `<div class="card feat"><span class="ic">${esc(ic)}</span><div><div class="row" style="gap:8px;flex-wrap:wrap"><h3>${esc(h)}</h3>${st === 'ok' ? '<span class="tag ok">Disponível</span>' : '<span class="tag warn">Em breve</span>'}</div><p>${esc(p)}</p></div></div>`).join('');

  await L.chrome('home');
  L.footer();
  const S = L.store || {};
  if (S.version) $('#ver').textContent = S.version;
  if (S.taxNotice) $('#taxNotice').textContent = S.taxNotice;
  if (S.refundDays) $('#refundDays').textContent = S.refundDays;
  if (S.demo && S.demo.text) $('#demoText').textContent = S.demo.text;
  const demo = $('#demoBtn'); demo.href = S.appUrl || '#'; if (!S.appUrl) demo.classList.add('disabled');

  const plans = S.plans || [];
  const monthly = plans.find((p) => p.id === 'monthly');
  const ITEMS = {
    perpetual: (p) => ['Pagamento único', 'Utilização permanente da versão 1.x adquirida', 'Atualizações gratuitas da série 1.x', 'Uma máquina ativa por licença', `Garantia comercial de reembolso de ${S.refundDays || 14} dias`, ['no', 'Futuras versões principais (2.x) não incluídas automaticamente']],
    monthly: () => ['Mesma aplicação e funcionalidades', 'Uma máquina ativa por licença', 'Atualizações gratuitas da série 1.x', 'Cancelamento a qualquer momento', 'Acesso até ao fim do período pago'],
    annual: () => ['Cobrança anual', 'Mesmos benefícios do plano mensal', 'Uma máquina ativa por licença', S.annualSaving && monthly ? `Poupança aproximada de ${S.annualSaving.toLocaleString('pt-PT')}% face a doze mensalidades de ${L.usd(monthly.price_usd_cents)}` : null, 'Cancelamento a qualquer momento', 'Acesso até ao fim do período pago'].filter(Boolean),
  };
  const per = { month: '/mês', year: '/ano' };
  $('#plans').innerHTML = plans.map((p) => {
    const hi = p.id === 'annual';
    const items = (ITEMS[p.id] || (() => []))(p);
    return `<div class="card plan ${hi ? 'hi' : ''}" style="display:flex;flex-direction:column">
      <div class="row between"><h3>${esc(p.name)}</h3>${hi && S.annualSaving ? `<span class="tag acc">Poupa ${esc(S.annualSaving.toLocaleString('pt-PT'))}%</span>` : p.kind === 'perpetual' ? '<span class="tag">Pagamento único</span>' : ''}</div>
      <div class="price" style="margin-top:14px">${esc(L.usd(p.price_usd_cents))}<small>${p.interval ? per[p.interval] : ''}</small></div>
      <ul>${items.map((it) => Array.isArray(it) ? `<li class="${it[0]}">${esc(it[1])}</li>` : `<li>${esc(it)}</li>`).join('')}</ul>
      <a class="btn ${hi ? 'primary' : 'acc'} block" style="margin-top:auto" href="/comprar?plano=${encodeURIComponent(p.id)}">${p.kind === 'perpetual' ? 'Comprar licença' : 'Subscrever'}</a>
      ${p.kind === 'subscription' ? '<p class="tiny dim" style="margin-top:10px;text-align:center">Pagamentos de subscrição não reembolsáveis, sem prejuízo dos direitos legais.</p>' : ''}
    </div>`;
  }).join('') || '<div class="notice">Os planos ainda não estão disponíveis.</div>';
})();
