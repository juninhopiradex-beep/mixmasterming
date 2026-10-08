// Cartão de 2FA (TOTP), partilhado pela área de cliente e pela administração.
(function () {
/** Cartão de 2FA (TOTP), partilhado pela área de cliente e pela administração. */
function mfaCard(el, u, done) {
  const { esc, $ } = L;
  if (u.totp_enabled) {
    el.innerHTML = `<div class="row between"><h3>Verificação em dois passos</h3><span class="tag ok">Ativa</span></div><p class="muted small" style="margin-top:8px">É pedido um código da aplicação de autenticação ao entrar.</p><button class="btn sm" style="margin-top:12px" id="mfaOff">Desativar</button>`;
    $('#mfaOff', el).onclick = () => L.modal(`<h3>Desativar a 2FA</h3><label class="f">Palavra-passe</label><input class="field" id="p" type="password"><label class="f">Código atual</label><input class="field mono" id="c" inputmode="numeric" maxlength="6"><div class="row" style="justify-content:flex-end;margin-top:18px"><button class="btn" data-x>Cancelar</button><button class="btn danger" data-ok>Desativar</button></div>`, (m, close) => {
      m.querySelector('[data-x]').onclick = () => close();
      m.querySelector('[data-ok]').onclick = async () => { try { await L.post('/api/auth/mfa/disable', { password: m.querySelector('#p').value, code: m.querySelector('#c').value }); close(); L.toast('2FA desativada.'); done(); } catch (e) { L.err(e); } };
    });
    return;
  }
  el.innerHTML = `<div class="row between"><h3>Verificação em dois passos</h3><span class="tag">Inativa</span></div><p class="muted small" style="margin-top:8px">Protege a conta com um código de uma aplicação de autenticação (Google Authenticator, 1Password, Authy…).</p><button class="btn sm acc" style="margin-top:12px" id="mfaOn">Ativar</button>`;
  $('#mfaOn', el).onclick = async () => {
    try {
      const s = await L.post('/api/auth/mfa/setup');
      L.modal(`<h3>Ativar a verificação em dois passos</h3><ol class="small muted" style="padding-left:18px"><li>Na aplicação de autenticação, adiciona uma conta com a chave abaixo (ou abre a ligação no telemóvel).</li><li>Introduz o código de 6 dígitos que aparece.</li></ol>
        <label class="f">Chave secreta</label><div class="row"><span class="key" style="flex:1;overflow-wrap:anywhere">${esc(s.secret.replace(/(.{4})/g, '$1 ').trim())}</span><button class="btn sm" data-cp>Copiar</button></div>
        <p class="tiny dim" style="margin-top:8px;overflow-wrap:anywhere"><a href="${esc(s.uri)}">${esc(s.uri.slice(0, 60))}…</a></p>
        <label class="f">Código</label><input class="field mono" id="c" inputmode="numeric" maxlength="6" style="font-size:20px;letter-spacing:.3em;text-align:center">
        <div class="row" style="justify-content:flex-end;margin-top:18px"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Ativar</button></div>`, (m, close) => {
        m.querySelector('[data-cp]').onclick = () => L.copy(s.secret);
        m.querySelector('[data-x]').onclick = () => close();
        m.querySelector('[data-ok]').onclick = async () => { try { await L.post('/api/auth/mfa/enable', { code: m.querySelector('#c').value.trim() }); close(); L.toast('2FA ativada.'); done(); } catch (e) { L.err(e); } };
      });
    } catch (e) { L.err(e); }
  };
}
L.mfaCard = mfaCard;
})();
