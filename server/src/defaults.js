// Valores por omissão: configurações, planos e textos. Tudo editável no painel de administração.
// Dados bancários, credenciais e taxas de câmbio NÃO são inventados: ficam vazios ("por preencher").
// No modo de testes há exemplos claramente marcados para se poder experimentar o fluxo.

export const PLANS = [
  { id: 'perpetual', name: 'Licença perpétua', kind: 'perpetual', interval: null, price_usd_cents: 9900, sort: 1 },
  { id: 'monthly', name: 'Subscrição mensal', kind: 'subscription', interval: 'month', price_usd_cents: 1999, sort: 2 },
  { id: 'annual', name: 'Subscrição anual', kind: 'subscription', interval: 'year', price_usd_cents: 5900, sort: 3 },
];

export function defaultSettings(test) {
  const EX = 'EXEMPLO DE TESTES — NÃO TRANSFERIR';
  return {
    currencies: { base: 'USD', rates: test ? { EUR: { rate: 0.92, note: 'exemplo de testes' }, AOA: { rate: 915, note: 'exemplo de testes' } } : { EUR: { rate: null }, AOA: { rate: null } } },
    taxes: { mode: 'added', rules: test ? [{ country: 'PT', rate: 23, label: 'IVA (exemplo de testes — validar com contabilista)' }] : [] },
    methods: {
      card: { enabled: true, countries: '*' },
      paypal: { enabled: true, countries: '*' },
      bank_pt: { enabled: true, countries: '*' },
      bank_ao: { enabled: true, countries: '*' },
      test: { enabled: test },
    },
    bank_pt: test ? { holder: EX, bank: 'Banco Exemplo, S.A.', iban: 'PT50 0000 0000 0000 0000 0000 0', swift: 'EXMPPTPL', currency: 'EUR', instructions: 'Indica a referência da encomenda no descritivo da transferência.', deadlineDays: 5, example: true }
      : { holder: '', bank: '', iban: '', swift: '', currency: 'EUR', instructions: 'Indica a referência da encomenda no descritivo da transferência.', deadlineDays: 5 },
    bank_ao: test ? { holder: EX, bank: 'Banco Exemplo Angola, S.A.', iban: 'AO06 0000 0000 0000 0000 0000 0', swift: 'EXMPAOLU', currency: 'AOA', instructions: 'Indica a referência da encomenda no descritivo da transferência.', deadlineDays: 5, example: true }
      : { holder: '', bank: '', iban: '', swift: '', currency: 'AOA', instructions: 'Indica a referência da encomenda no descritivo da transferência.', deadlineDays: 5 },
    licensing: { graceDays: 7, transferLimit: 3, transferWindowDays: 30, checkDays: 7 },
    demo: { exportSeconds: 60, formats: ['mp3'], text: 'Demonstração gratuita: todas as funções de mistura e master, exportação limitada a 60 s em MP3.' },
    security: { require2faForStaff: false, loginMaxAttempts: 5, lockMinutes: 15 },
    support: { email: '', url: '' },
    store: { productName: 'MIXMIND by Piradex', refundDaysPerpetual: 14, taxNotice: 'Os impostos aplicáveis, incluindo IVA, poderão ser acrescentados no checkout, conforme o país e a configuração fiscal.' },
  };
}

const T = (title, body) => ({ title, body });
// Textos legais: rascunhos que TÊM de ser validados (jurídico) e publicados antes do lançamento.
export const TEXTS = {
  terms: T('Termos e condições', `# Termos e condições de venda e utilização

**Rascunho — sujeito a validação jurídica antes da publicação.**

1. **Objeto.** Estes termos regulam a compra de licenças do software MIXMIND by Piradex ("Software").
2. **Conta e licença.** A palavra-passe dá acesso à conta. A chave de licença ativa o Software. Uma conta pode ter várias licenças; cada licença permite a ativação e utilização num único computador de cada vez, Windows ou macOS.
3. **Licença perpétua.** Pagamento único; utilização permanente da versão 1.x adquirida, com atualizações gratuitas da série 1.x. Versões principais futuras (por exemplo 2.x) não estão incluídas automaticamente.
4. **Subscrição.** Utilização durante o período pago; renovação automática quando paga por cartão ou PayPal; renovação manual quando paga por transferência. O cancelamento termina a renovação e mantém o acesso até ao fim do período pago.
5. **Preços e impostos.** Preços em dólares dos EUA (USD). Os impostos aplicáveis, incluindo IVA, poderão ser acrescentados no checkout, conforme o país e a configuração fiscal.
6. **Reembolsos.** Ver a Política de reembolsos.
7. **Ativação e funcionamento offline.** O processamento áudio é local. A licença é validada por um comprovativo digital assinado; licenças perpétuas funcionam offline depois de ativadas; subscrições dentro do período pago e da tolerância indicada.
8. **Dados pessoais.** Ver a Política de privacidade.
9. **Lei aplicável.** [A definir pelo jurídico.]`),
  privacy: T('Política de privacidade', `# Política de privacidade

**Rascunho — sujeito a validação jurídica antes da publicação.**

- **Responsável pelo tratamento:** [nome, morada e contacto a preencher].
- **Dados recolhidos:** nome, email, país, dados de faturação e identificação fiscal quando necessários, histórico de compras, licenças e identificador anónimo do computador ativado (hash).
- **Pagamentos:** os dados de cartão são tratados exclusivamente pelo prestador de pagamento (Stripe ou PayPal); não guardamos números de cartão nem CVV.
- **Comprovativos de transferência:** guardados de forma privada, acessíveis apenas ao cliente e a administradores autorizados.
- **Áudio:** o processamento é local; os teus ficheiros de áudio não são enviados para os nossos servidores.
- **Direitos:** acesso, retificação, apagamento, portabilidade e oposição — [contacto a preencher].
- **Conservação:** [prazos a definir pelo jurídico/contabilidade].`),
  refund: T('Política de reembolsos', `# Política de reembolsos

**Rascunho — sujeito a validação jurídica antes da publicação.**

- **Licença perpétua:** garantia comercial de reembolso de 14 dias a contar da compra. Após o reembolso, a licença é revogada.
- **Subscrições (mensal e anual):** os pagamentos de subscrição não são reembolsáveis, sem prejuízo dos direitos legais aplicáveis ao consumidor no teu país. Podes cancelar a renovação a qualquer momento e manténs o acesso até ao fim do período pago.
- **Recomendação:** experimenta a demonstração gratuita antes de comprar.`),
};

// Templates de email (primeira linha = assunto). Variáveis entre {{ }}.
export const EMAILS = {
  account_confirm: T('Confirmação de conta', 'Assunto: Confirma o teu email — {{product}}\n\nOlá {{name}},\n\nConfirma o teu email para ativar a conta:\n{{link}}\n\nA ligação é válida durante 48 horas. Se não criaste esta conta, ignora esta mensagem.'),
  password_reset: T('Recuperação de palavra-passe', 'Assunto: Recuperar a palavra-passe — {{product}}\n\nOlá {{name}},\n\nPara definires uma nova palavra-passe, abre:\n{{link}}\n\nA ligação é válida durante 1 hora. Se não pediste a recuperação, ignora esta mensagem — a palavra-passe atual continua válida.'),
  invite: T('Convite', 'Assunto: Foi criada uma conta para ti — {{product}}\n\nOlá {{name}},\n\nFoi criada uma conta {{product}} para este email. Define a tua palavra-passe aqui:\n{{link}}\n\nA ligação é válida durante 7 dias.'),
  order_created: T('Encomenda criada', 'Assunto: Encomenda {{ref}} criada\n\nOlá {{name}},\n\nRecebemos a tua encomenda {{ref}}: {{plan}} — {{amount}}.\nMétodo: {{method}}.\n\nPodes acompanhar o estado em {{link}}.'),
  transfer_instructions: T('Instruções de transferência', 'Assunto: Instruções de pagamento da encomenda {{ref}}\n\nOlá {{name}},\n\nTransfere {{amount}} para:\n{{bank}}\n\nReferência obrigatória no descritivo: {{ref}}\nPrazo: {{due}}\n\nDepois, envia o comprovativo em {{link}}. A licença é emitida depois de confirmarmos a entrada do pagamento.'),
  proof_received: T('Comprovativo recebido', 'Assunto: Comprovativo recebido — encomenda {{ref}}\n\nOlá {{name}},\n\nComprovativo recebido. O pagamento encontra-se a aguardar validação.\nVamos confirmar a entrada do valor e avisar-te por email.'),
  proof_needs_info: T('Pedido de esclarecimento', 'Assunto: Precisamos de mais informação — encomenda {{ref}}\n\nOlá {{name}},\n\nPara validarmos o pagamento da encomenda {{ref}} precisamos do seguinte:\n{{reason}}\n\nPodes complementar ou substituir o comprovativo em {{link}}.'),
  payment_approved: T('Pagamento aprovado', 'Assunto: Pagamento confirmado — encomenda {{ref}}\n\nOlá {{name}},\n\nO pagamento da encomenda {{ref}} foi confirmado. Obrigado!'),
  payment_rejected: T('Pagamento rejeitado', 'Assunto: Pagamento não confirmado — encomenda {{ref}}\n\nOlá {{name}},\n\nNão foi possível confirmar o pagamento da encomenda {{ref}}.\nMotivo: {{reason}}\n\nSe tiveres dúvidas, responde a este email ou contacta o suporte.'),
  license_issued: T('Licença emitida', 'Assunto: A tua licença {{product}}\n\nOlá {{name}},\n\nA tua licença ({{plan}}) está pronta.\nChave de licença: {{key}}\n\nAtiva-a em MIXMIND → Definições → Licença. Cada licença permite a ativação num único computador de cada vez.\nGere a licença e o computador autorizado em {{link}}.'),
  renewal_reminder: T('Aproximação da expiração', 'Assunto: A tua subscrição termina a {{date}}\n\nOlá {{name}},\n\nA tua subscrição ({{plan}}) termina a {{date}}.\n{{action}}\n\nGere a subscrição em {{link}}.'),
  renewed: T('Renovação', 'Assunto: Subscrição renovada até {{date}}\n\nOlá {{name}},\n\nA tua subscrição ({{plan}}) foi renovada e está válida até {{date}}.'),
  payment_failed: T('Falha de cobrança', 'Assunto: Não conseguimos cobrar a tua subscrição\n\nOlá {{name}},\n\nA cobrança da subscrição ({{plan}}) falhou. Atualiza o método de pagamento junto do prestador ({{provider}}) para manteres o acesso depois de {{date}}.\n\n{{link}}'),
  subscription_cancelled: T('Cancelamento de subscrição', 'Assunto: Renovação cancelada\n\nOlá {{name}},\n\nCancelámos a renovação da tua subscrição ({{plan}}). Manténs o acesso até {{date}}.'),
  device_changed: T('Alteração do computador autorizado', 'Assunto: Computador autorizado alterado\n\nOlá {{name}},\n\nA licença terminada em {{key4}} foi {{what}} ({{device}}) em {{date}}.\nSe não foste tu, contacta o suporte de imediato.'),
};
