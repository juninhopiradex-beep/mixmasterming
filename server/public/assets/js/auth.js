// Páginas de autenticação: entrar (com 2FA e troca obrigatória da palavra-passe inicial), registar, recuperar, redefinir, verificar.
(async function () {
  const { esc, $ } = L;
  const page = document.body.dataset.page;
  const me = await L.chrome('auth');
  L.footer();
  const app = $('#app');
  const safeNext = () => { const n = L.qs('next') || ''; return /^\/(?!\/)[\w\-/#?=&.%]*$/.test(n) ? n : ''; };
  const home = (u) => safeNext() || (u && u.role !== 'customer' ? '/admin' : '/conta');
  const busy = (btn, on, label) => { btn.disabled = on; if (label) btn.textContent = label; };
  const pwHint = '<p class="hint">Pelo menos 10 caracteres, sem conter o teu email. Usa uma frase longa ou um gestor de palavras-passe.</p>';

  const VIEWS = {
    entrar() {
      if (me.user && !me.mfaPending && !me.user.must_change_password) { location.replace(home(me.user)); return; }
      if (me.user && me.mfaPending) return mfaStep(me.user);
      if (me.user && me.user.must_change_password) return changeStep(me.user);
      app.innerHTML = `<h2>Entrar</h2><p class="muted small" style="margin-top:6px">Área de cliente e administração.</p>
        <form id="f" novalidate><label class="f" for="email">Email</label><input class="field" id="email" type="email" autocomplete="username" required>
        <label class="f" for="pw">Palavra-passe</label><input class="field" id="pw" type="password" autocomplete="current-password" required>
        <button class="btn primary block" style="margin-top:20px" id="go">Entrar</button></form>
        <div class="row between small" style="margin-top:16px"><a href="/recuperar">Esqueci-me da palavra-passe</a><a href="/registar">Criar conta</a></div>`;
      $('#f').onsubmit = async (e) => {
        e.preventDefault(); const b = $('#go'); busy(b, true, 'A entrar…');
        try {
          const r = await L.post('/api/auth/login', { email: $('#email').value, password: $('#pw').value });
          if (r.mfaPending) return mfaStep(r.user);
          if (r.mustChangePassword) return changeStep(r.user);
          location.href = home(r.user);
        } catch (err) { L.err(err); busy(b, false, 'Entrar'); }
      };
    },
    registar() {
      if (me.user) { location.replace(home(me.user)); return; }
      app.innerHTML = `<h2>Criar conta</h2><p class="muted small" style="margin-top:6px">A conta serve para gerires compras, licenças e computadores.</p>
        <form id="f" novalidate><label class="f" for="name">Nome</label><input class="field" id="name" autocomplete="name" maxlength="100" required>
        <label class="f" for="email">Email</label><input class="field" id="email" type="email" autocomplete="email" maxlength="254" required>
        <label class="f" for="country">País</label><select class="field" id="country">${L.countryOptions('')}</select>
        <label class="f" for="pw">Palavra-passe</label><input class="field" id="pw" type="password" autocomplete="new-password" required>${pwHint}
        <label class="check" style="margin-top:14px"><input type="checkbox" id="acc"> <span>Li e aceito os <a href="/termos" target="_blank">termos e condições</a> e a <a href="/privacidade" target="_blank">política de privacidade</a>.</span></label>
        <button class="btn primary block" style="margin-top:20px" id="go">Criar conta</button></form>
        <p class="small muted" style="margin-top:16px">Já tens conta? <a href="/entrar">Entrar</a></p>`;
      $('#f').onsubmit = async (e) => {
        e.preventDefault(); const b = $('#go'); busy(b, true, 'A criar…');
        try {
          const r = await L.post('/api/auth/register', { name: $('#name').value, email: $('#email').value, country: $('#country').value, password: $('#pw').value, acceptTerms: $('#acc').checked });
          app.innerHTML = `<h2>Confirma o teu email</h2><p class="muted" style="margin-top:10px">Enviámos uma ligação de confirmação para <strong>${esc(r.user.email)}</strong>. Até confirmares, a conta fica pendente e as chaves de licença não são mostradas.</p><a class="btn primary block" style="margin-top:20px" href="/conta">Ir para a minha conta</a>`;
        } catch (err) { L.err(err); busy(b, false, 'Criar conta'); }
      };
    },
    recuperar() {
      app.innerHTML = `<h2>Recuperar palavra-passe</h2><p class="muted small" style="margin-top:6px">Indica o email da conta. Se existir, enviamos uma ligação válida durante 1 hora.</p>
        <form id="f" novalidate><label class="f" for="email">Email</label><input class="field" id="email" type="email" autocomplete="email" required>
        <button class="btn primary block" style="margin-top:20px" id="go">Enviar ligação</button></form>
        <p class="small muted" style="margin-top:16px"><a href="/entrar">Voltar a entrar</a></p>`;
      $('#f').onsubmit = async (e) => {
        e.preventDefault(); const b = $('#go'); busy(b, true, 'A enviar…');
        try { const r = await L.post('/api/auth/forgot', { email: $('#email').value }); app.innerHTML = `<h2>Verifica o teu email</h2><p class="muted" style="margin-top:10px">${esc(r.message)}</p><a class="btn block" style="margin-top:20px" href="/entrar">Voltar a entrar</a>`; }
        catch (err) { L.err(err); busy(b, false, 'Enviar ligação'); }
      };
    },
    redefinir() {
      const token = L.qs('token'), invite = L.qs('convite') === '1';
      if (!token) { app.innerHTML = '<h2>Ligação inválida</h2><p class="muted" style="margin-top:10px">Abre a ligação completa que recebeste por email ou <a href="/recuperar">pede uma nova</a>.</p>'; return; }
      app.innerHTML = `<h2>${invite ? 'Definir a palavra-passe da conta' : 'Nova palavra-passe'}</h2><p class="muted small" style="margin-top:6px">${invite ? 'Foste convidado para o MIXMIND. Escolhe a palavra-passe para entrar.' : 'Todas as sessões abertas serão terminadas.'}</p>
        <form id="f" novalidate><label class="f" for="pw">Palavra-passe</label><input class="field" id="pw" type="password" autocomplete="new-password" required>
        <label class="f" for="pw2">Repetir</label><input class="field" id="pw2" type="password" autocomplete="new-password" required>${pwHint}
        <button class="btn primary block" style="margin-top:20px" id="go">Guardar</button></form>`;
      $('#f').onsubmit = async (e) => {
        e.preventDefault(); if ($('#pw').value !== $('#pw2').value) return L.toast('As palavras-passe não coincidem.', 'warn');
        const b = $('#go'); busy(b, true, 'A guardar…');
        try { await L.post('/api/auth/reset', { token, password: $('#pw').value }); history.replaceState(null, '', '/redefinir'); app.innerHTML = '<h2>Palavra-passe definida</h2><p class="muted" style="margin-top:10px">Já podes entrar com a nova palavra-passe.</p><a class="btn primary block" style="margin-top:20px" href="/entrar">Entrar</a>'; }
        catch (err) { L.err(err); busy(b, false, 'Guardar'); }
      };
    },
    async verificar() {
      const token = L.qs('token');
      if (!token) { app.innerHTML = '<h2>Ligação inválida</h2><p class="muted" style="margin-top:10px">Abre a ligação completa que recebeste por email.</p>'; return; }
      try { await L.post('/api/auth/verify', { token }); history.replaceState(null, '', '/verificar'); app.innerHTML = '<h2>Email confirmado</h2><p class="muted" style="margin-top:10px">A tua conta está ativa. As chaves de licença já aparecem na área de cliente.</p><a class="btn primary block" style="margin-top:20px" href="/conta">Ir para a minha conta</a>'; }
      catch (err) { app.innerHTML = `<h2>Não foi possível confirmar</h2><p class="muted" style="margin-top:10px">${esc(err.message)}</p>${me.user ? '<button class="btn block" style="margin-top:20px" id="again">Enviar nova ligação</button>' : '<a class="btn block" style="margin-top:20px" href="/entrar">Entrar para pedir nova ligação</a>'}`; const a = $('#again'); if (a) a.onclick = async () => { await L.post('/api/auth/resend-verification'); L.toast('Ligação enviada.'); }; }
    },
  };

  function mfaStep(u) {
    app.innerHTML = `<h2>Verificação em dois passos</h2><p class="muted small" style="margin-top:6px">Introduz o código de 6 dígitos da aplicação de autenticação de <strong>${esc(u.email)}</strong>.</p>
      <form id="f" novalidate><label class="f" for="code">Código</label><input class="field mono" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" style="font-size:22px;letter-spacing:.3em;text-align:center" required>
      <button class="btn primary block" style="margin-top:20px" id="go">Confirmar</button></form>`;
    $('#f').onsubmit = async (e) => {
      e.preventDefault(); const b = $('#go'); busy(b, true, 'A confirmar…');
      try { await L.post('/api/auth/mfa', { code: $('#code').value.trim() }); const m = await L.loadMe(); if (m.user.must_change_password) return changeStep(m.user); location.href = home(m.user); }
      catch (err) { L.err(err); busy(b, false, 'Confirmar'); }
    };
  }
  function changeStep(u) {
    app.innerHTML = `<h2>Altera a palavra-passe inicial</h2><div class="notice" style="margin-top:12px">Por segurança, a palavra-passe inicial tem de ser substituída no primeiro acesso. As outras sessões serão terminadas.</div>
      <form id="f" novalidate><label class="f" for="cur">Palavra-passe atual</label><input class="field" id="cur" type="password" autocomplete="current-password" required>
      <label class="f" for="pw">Nova palavra-passe</label><input class="field" id="pw" type="password" autocomplete="new-password" required>
      <label class="f" for="pw2">Repetir</label><input class="field" id="pw2" type="password" autocomplete="new-password" required>${pwHint}
      <button class="btn primary block" style="margin-top:20px" id="go">Alterar e continuar</button></form>`;
    $('#f').onsubmit = async (e) => {
      e.preventDefault(); if ($('#pw').value !== $('#pw2').value) return L.toast('As palavras-passe não coincidem.', 'warn');
      const b = $('#go'); busy(b, true, 'A guardar…');
      try { await L.post('/api/auth/change-password', { current: $('#cur').value, password: $('#pw').value }); L.toast('Palavra-passe alterada.'); location.href = u.role !== 'customer' ? '/admin#seguranca' : home(u); }
      catch (err) { L.err(err); busy(b, false, 'Alterar e continuar'); }
    };
  }
  await VIEWS[page]();
})();
