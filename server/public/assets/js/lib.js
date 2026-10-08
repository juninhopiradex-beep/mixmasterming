// Utilitários partilhados: API, escape, formatação, toasts, modais, markdown simples, sessão.
(function () {
  const L = (window.L = {});
  L.esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  L.$ = (s, r) => (r || document).querySelector(s);
  L.$$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  L.api = async function (method, path, body, opts = {}) {
    const h = { 'X-MM': '1' };
    let b = body;
    if (body !== undefined && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    if (opts.type) h['Content-Type'] = opts.type;
    const r = await fetch(path, { method, headers: h, body: b, credentials: 'same-origin' });
    let j = null; try { j = await r.json(); } catch { /* */ }
    if (!r.ok) { const e = new Error((j && j.error) || t('common.error')); e.status = r.status; e.code = j && j.code; e.data = j; throw e; }
    return j;
  };
  L.get = (p) => L.api('GET', p); L.post = (p, b) => L.api('POST', p, b || {}); L.put = (p, b) => L.api('PUT', p, b); L.patch = (p, b) => L.api('PATCH', p, b);
  L.date = (ms, time) => (ms ? new Date(ms).toLocaleString('pt-PT', time ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }) : '—');
  L.rel = (ms) => { if (!ms) return '—'; const d = (ms - Date.now()) / 864e5; const rtf = new Intl.RelativeTimeFormat('pt-PT', { numeric: 'auto' }); return Math.abs(d) < 1 ? rtf.format(Math.round(d * 24), 'hour') : rtf.format(Math.round(d), 'day'); };
  L.statusTag = (s, kind) => { const k = kind ? kind + '.' + s : 'status.' + s; const cls = { confirmed: 'ok', active: 'ok', accepted: 'ok', pending: 'warn', awaiting_validation: 'info', submitted: 'info', needs_info: 'warn', past_due: 'warn', suspended: 'warn', failed: 'bad', rejected: 'bad', revoked: 'bad', blocked: 'bad', disputed: 'bad', refunded: 'bad', expired: '', cancelled: '', superseded: '' }[s] || ''; return `<span class="tag ${cls}">${L.esc(t(k))}</span>`; };
  L.toast = (msg, kind, ms) => { let box = L.$('.toasts'); if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); } const el = document.createElement('div'); el.className = 'toast ' + (kind || ''); el.textContent = msg; box.appendChild(el); setTimeout(() => el.remove(), ms || 4500); };
  L.err = (e) => L.toast(e && e.message ? e.message : t('common.error'), 'bad', 6000);
  /** Modal: html + função de montagem (m, fechar). Devolve uma promessa resolvida ao fechar. */
  L.modal = (html, mount) => new Promise((res) => {
    const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    const close = (v) => { bg.remove(); document.removeEventListener('keydown', esc); res(v); };
    const esc = (e) => { if (e.key === 'Escape') close(null); };
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(null); }); document.addEventListener('keydown', esc);
    document.body.appendChild(bg); if (mount) mount(bg.firstElementChild, close);
    const f = bg.querySelector('input,textarea,select,button.primary'); if (f) setTimeout(() => f.focus(), 30);
  });
  L.confirm = (title, text, ok, opts = {}) => L.modal(`<h3>${L.esc(title)}</h3><p class="muted">${L.esc(text)}</p>${opts.reason ? `<label class="f">${L.esc(t('common.reason'))}</label><textarea class="field" id="mr" rows="3" style="min-height:80px;font-family:var(--sans)"></textarea>` : ''}${opts.check ? `<label class="check" style="margin-top:14px"><input type="checkbox" id="mc"> <span>${L.esc(opts.check)}</span></label>` : ''}
    <div class="row" style="justify-content:flex-end;margin-top:20px"><button class="btn" data-x>${L.esc(t('common.cancel'))}</button><button class="btn ${opts.danger ? 'danger' : 'primary'}" data-ok>${L.esc(ok || t('common.confirm'))}</button></div>`, (m, close) => {
    m.querySelector('[data-x]').onclick = () => close(null);
    m.querySelector('[data-ok]').onclick = () => {
      const reason = opts.reason ? m.querySelector('#mr').value.trim() : '';
      if (opts.reason && reason.length < 3) { L.toast('O motivo é obrigatório.', 'warn'); return; }
      if (opts.check && !m.querySelector('#mc').checked) { L.toast('Confirma a caixa de verificação.', 'warn'); return; }
      close({ reason, checked: true });
    };
  });
  /** US$ sem casas decimais quando o valor é inteiro (US$99, US$19,99). */
  L.usd = (c) => 'US$' + (c / 100).toLocaleString('pt-PT', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
  L.qs = (k) => new URLSearchParams(location.search).get(k);
  /** Nome legível de um evento de licença. */
  L.licAction = (a) => ({ issued: 'Emitida', activated: 'Ativada num computador', reactivated_same_machine: 'Reativada no mesmo computador', deactivated: 'Computador desativado', extended: 'Prolongada', renewed: 'Renovada', expired: 'Expirada', transfer_limit_reset: 'Limite de mudanças reposto', assigned: 'Associada a um cliente', status_active: 'Reativada', status_suspended: 'Suspensa', status_revoked: 'Revogada', status_refunded: 'Revogada (reembolso)', status_disputed: 'Suspensa (contestação)' }[a] || a);
  L.copy = (txt) => navigator.clipboard.writeText(txt).then(() => L.toast(t('common.copied')), () => L.toast(txt));
  /** Markdown mínimo (títulos, negrito, listas, parágrafos) — o texto é escapado primeiro. */
  L.md = (src) => {
    const lines = L.esc(src || '').split('\n'); let html = '', list = null;
    const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\[(.+?)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g, '<a href="$2">$1</a>');
    const flush = () => { if (list) { html += `</${list}>`; list = null; } };
    for (const l of lines) {
      let m;
      if ((m = /^(#{1,3})\s+(.*)/.exec(l))) { flush(); html += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; }
      else if ((m = /^\s*[-*]\s+(.*)/.exec(l))) { if (list !== 'ul') { flush(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
      else if ((m = /^\s*\d+\.\s+(.*)/.exec(l))) { if (list !== 'ol') { flush(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
      else if (!l.trim()) flush();
      else { flush(); html += `<p>${inline(l)}</p>`; }
    }
    flush(); return html;
  };
  L.me = null;
  L.loadMe = async () => { try { L.me = await L.get('/api/auth/me'); } catch { L.me = { user: null }; } return L.me; };
  /** Barra de navegação comum + faixa do modo de testes. */
  L.chrome = async function (active) {
    const [me, store] = await Promise.all([L.loadMe(), L.get('/api/public/store').catch(() => ({}))]);
    L.store = store;
    const u = me.user, staff = u && u.role !== 'customer';
    const nav = document.createElement('header');
    nav.innerHTML = `${store.mode === 'test' ? `<div class="testbar">${L.esc(t('test.banner'))}</div>` : ''}<nav class="nav"><div class="wrap">
      <a class="brand" href="/"><i><em></em></i><b>MIXMIND</b><span>by Piradex</span></a>
      ${active === 'conta' || active === 'admin' ? `<div class="links"><a href="/">${t('nav.store')}</a></div>` : `<div class="links"><a href="/#funcionalidades">${t('nav.features')}</a><a href="/#precos">${t('nav.pricing')}</a><a href="/#demo">${t('nav.demo')}</a><a href="/#perguntas">${t('nav.faq')}</a></div>`}
      <span class="spacer"></span>
      ${u ? `${staff ? `<a class="btn sm ${active === 'admin' ? 'acc' : 'ghost'}" href="/admin">${t('nav.admin')}</a>` : `<a class="btn sm ${active === 'conta' ? 'acc' : 'ghost'}" href="/conta">${t('nav.account')}</a>`}<button class="btn sm ghost" id="navOut">${t('nav.logout')}</button>`
        : `<a class="btn sm ghost" href="/entrar">${t('nav.login')}</a>`}
      ${!staff && !['comprar', 'conta'].includes(active) ? `<a class="btn sm primary" href="/comprar">${t('nav.buy')}</a>` : ''}
    </div></nav>`;
    document.body.prepend(nav);
    const out = L.$('#navOut'); if (out) out.onclick = async () => { await L.post('/api/auth/logout'); location.href = '/'; };
    i18nApply();
    return me;
  };
  L.footer = () => { const f = document.createElement('footer'); f.className = 'f'; f.innerHTML = `<div class="wrap row wrapx between"><span>© ${new Date().getFullYear()} MIXMIND by Piradex · BeatFreak Studio</span><span class="row wrapx"><a href="/termos">Termos e condições</a><a href="/privacidade">Privacidade</a><a href="/reembolsos">Reembolsos</a><a href="/conta#suporte">Suporte</a></span></div>`; document.body.appendChild(f); };
  // países (ISO 3166-1) com nomes em português
  const CC = 'AD AE AF AG AI AL AM AO AR AT AU AW AZ BA BB BD BE BF BG BH BI BJ BM BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GI GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PR PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS YE ZA ZM ZW'.split(' ');
  L.countries = () => { const dn = new Intl.DisplayNames(['pt-PT'], { type: 'region' }); return CC.map((c) => [c, dn.of(c)]).sort((a, b) => a[1].localeCompare(b[1], 'pt')); };
  L.countryOptions = (sel) => `<option value="">Escolhe…</option>` + ['PT', 'AO', 'BR', 'MZ', 'CV'].map((c) => `<option value="${c}" ${sel === c ? 'selected' : ''}>${new Intl.DisplayNames(['pt-PT'], { type: 'region' }).of(c)}</option>`).join('') + '<option disabled>──────────</option>' + L.countries().map(([c, n]) => `<option value="${c}" ${sel === c && !['PT', 'AO', 'BR', 'MZ', 'CV'].includes(c) ? 'selected' : ''}>${L.esc(n)}</option>`).join('');
})();
