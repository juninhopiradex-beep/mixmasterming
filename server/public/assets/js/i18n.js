// Textos da interface (pt-PT). Para traduzir: acrescentar outro dicionário com as mesmas chaves e mudar LOCALE.
// Nas páginas, os elementos com data-i18n="chave" recebem o texto; nos scripts usa-se t('chave', {variáveis}).
(function () {
  const D = {
    'pt-PT': {
      'nav.features': 'Funcionalidades', 'nav.pricing': 'Preços', 'nav.demo': 'Demonstração', 'nav.faq': 'Perguntas', 'nav.login': 'Entrar', 'nav.account': 'A minha conta', 'nav.buy': 'Comprar', 'nav.logout': 'Sair', 'nav.admin': 'Administração', 'nav.store': 'Loja',
      'test.banner': 'MODO DE TESTES — pagamentos simulados, dados bancários de exemplo e emails não enviados',
      'common.loading': 'A carregar…', 'common.save': 'Guardar', 'common.cancel': 'Cancelar', 'common.close': 'Fechar', 'common.confirm': 'Confirmar', 'common.copy': 'Copiar', 'common.copied': 'Copiado.', 'common.saved': 'Guardado.', 'common.error': 'Ocorreu um erro.', 'common.reason': 'Motivo (obrigatório)', 'common.yes': 'Sim', 'common.no': 'Não', 'common.none': '—', 'common.view': 'Ver', 'common.download': 'Descarregar', 'common.search': 'Procurar…',
      'status.pending': 'Pendente', 'status.awaiting_validation': 'A aguardar validação', 'status.confirmed': 'Confirmado', 'status.failed': 'Falhado', 'status.expired': 'Expirado', 'status.refunded': 'Reembolsado', 'status.disputed': 'Contestação de pagamento', 'status.cancelled': 'Cancelado',
      'status.active': 'Ativa', 'status.suspended': 'Suspensa', 'status.revoked': 'Revogada', 'status.blocked': 'Bloqueada', 'status.past_due': 'Cobrança falhada',
      'proof.submitted': 'Em análise', 'proof.needs_info': 'Precisa de esclarecimento', 'proof.rejected': 'Rejeitado', 'proof.accepted': 'Aceite', 'proof.superseded': 'Substituído',
      'lic.perpetual': 'Perpétua', 'lic.subscription': 'Subscrição', 'lic.demo': 'Demonstração', 'lic.gift': 'Oferta',
      'acc.title': 'A minha conta', 'acc.overview': 'Resumo', 'acc.licenses': 'Licenças e computador', 'acc.subs': 'Subscrições', 'acc.orders': 'Compras e pagamentos', 'acc.downloads': 'Downloads e ativação', 'acc.profile': 'Perfil e segurança', 'acc.support': 'Suporte',
      'acc.verify': 'Confirma o teu email para veres as chaves de licença e gerires computadores.', 'acc.resend': 'Reenviar email de confirmação',
      'acc.proof.ok': 'Comprovativo recebido. O pagamento encontra-se a aguardar validação.',
      'acc.deactivate.q': 'Desativar este computador?', 'acc.deactivate.t': 'A licença fica livre para ativares noutro computador. Se o computador antigo estiver sem internet, só deixa de funcionar quando voltar a contactar o servidor ou quando o comprovativo expirar (perpétuas: ao voltar a ligar-se).',
      'acc.cancel.q': 'Cancelar a renovação?', 'acc.cancel.t': 'A subscrição deixa de renovar. Manténs o acesso até {date}. Os pagamentos de subscrição não são reembolsáveis, sem prejuízo dos teus direitos legais.',
      'adm.title': 'Administração', 'adm.dashboard': 'Painel', 'adm.transfers': 'Transferências e comprovativos', 'adm.orders': 'Encomendas e pagamentos', 'adm.customers': 'Clientes e acessos', 'adm.licenses': 'Licenças', 'adm.subs': 'Subscrições', 'adm.events': 'Eventos dos prestadores', 'adm.settings': 'Configurações', 'adm.texts': 'Textos e emails', 'adm.staff': 'Equipa e permissões', 'adm.audit': 'Auditoria', 'adm.emails': 'Emails enviados', 'adm.me': 'A minha segurança',
      'adm.approve': 'Confirmar pagamento e emitir licença', 'adm.requestInfo': 'Solicitar novo comprovativo ou esclarecimento', 'adm.reject': 'Rejeitar comprovativo',
      'adm.approve.check': 'Confirmo que verifiquei no banco a entrada efetiva de {amount}.',
    },
  };
  const LOCALE = 'pt-PT';
  window.t = (k, v) => { let s = (D[LOCALE] && D[LOCALE][k]) || k; if (v) s = s.replace(/\{(\w+)\}/g, (_, x) => (v[x] === undefined ? '' : v[x])); return s; };
  window.i18nApply = (root) => (root || document).querySelectorAll('[data-i18n]').forEach((el) => { const s = D[LOCALE][el.dataset.i18n]; if (s) el.textContent = s; });
  document.documentElement.lang = LOCALE;
})();
