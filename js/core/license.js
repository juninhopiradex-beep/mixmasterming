/* MIXMIND — licença na aplicação (ativação, validação periódica, modo de demonstração).
 *
 * Só fica ativo quando config.js define LICENSE_API (o servidor da loja). Sem isso, a app funciona como até aqui.
 *
 * Como funciona
 *  - A chave (MMX1-…) é ativada no servidor para ESTE navegador neste computador (um identificador aleatório guardado
 *    localmente). Cada licença tem um só computador ativo de cada vez.
 *  - O servidor devolve um comprovativo assinado (ECDSA P-256). A app verifica a assinatura com a chave pública
 *    (LICENSE_PUBLIC_KEY em config.js, ou a obtida na primeira ativação) e confirma que o comprovativo é deste
 *    computador. Perpétuas funcionam offline; subscrições até ao fim do período pago + tolerância.
 *  - Com internet, a app revalida de x em x dias (checkDays): revogações, suspensões e desativações remotas aplicam-se aí.
 *  - Sem licença válida → demonstração: exportação limitada (por omissão 60 s em MP3), conforme /api/v1/app/config.
 *
 * Limitação honesta: numa aplicação web todo o código corre no navegador do utilizador; isto é dissuasão, não DRM. */
(function () {
  const MM = (window.MM = window.MM || {});
  const CFG = window.MIXMIND_CONFIG || {};
  const API = String(CFG.LICENSE_API || '').replace(/\/+$/, '');
  const K_STATE = 'mm.license.v1', K_MID = 'mm.machine.v1', K_CFG = 'mm.appcfg.v1';
  const APP_VERSION = MM.VERSION || '1.8';  // definido em dsp.js
  const APP_MAJOR = 1;
  const DEMO_DEFAULT = { exportSeconds: 60, formats: ['mp3'] };
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* armazenamento indisponível */ } },
  };
  const L = (MM.license = { enabled: !!API, api: API, status: { mode: API ? 'checking' : 'off' }, listeners: [] });

  // ---------- utilitários ----------
  const b64uDec = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  const b64Dec = (s) => b64uDec(String(s).replace(/\s+/g, '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
  const hex = (buf) => Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, '0')).join('');
  const sha256 = async (txt) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)));
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : hex(crypto.getRandomValues(new Uint8Array(16))));

  /** Identificador deste navegador neste computador (aleatório; não usa dados pessoais nem impressão digital). */
  L.machineId = function () {
    let m = store.get(K_MID);
    if (!m || typeof m !== 'string' || m.length < 16) { m = 'web-' + uuid(); store.set(K_MID, m); }
    return m;
  };
  L.machineName = function () {
    const ua = navigator.userAgent || '';
    const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Computador';
    const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'navegador';
    return { name: `${os} · ${br}`, platform: os };
  };

  // ---------- comprovativo assinado ----------
  let keyPromise = null;
  async function publicKey(spkiB64) {
    const spki = spkiB64 || CFG.LICENSE_PUBLIC_KEY || (store.get(K_STATE) || {}).pub;
    if (!spki) return null;
    if (!keyPromise || keyPromise.spki !== spki) { keyPromise = crypto.subtle.importKey('spki', b64Dec(spki), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']); keyPromise.spki = spki; }
    return keyPromise;
  }
  /** Verifica assinatura, computador, versão principal e validade. Devolve { ok, payload, why }. */
  L.verify = async function (token, spki, now = Date.now()) {
    const p = String(token || '').split('.');
    if (p.length !== 3 || p[0] !== 'MMX1') return { ok: false, why: 'formato' };
    const key = await publicKey(spki);
    if (!key) return { ok: false, why: 'sem chave pública' };
    let ok = false;
    try { ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64uDec(p[2]), new TextEncoder().encode(p[0] + '.' + p[1])); } catch (e) { ok = false; }
    if (!ok) return { ok: false, why: 'assinatura inválida' };
    let pl; try { pl = JSON.parse(new TextDecoder().decode(b64uDec(p[1]))); } catch (e) { return { ok: false, why: 'formato' }; }
    const mb = (await sha256('mmx-bind:' + L.machineId())).slice(0, 32);
    if (pl.mb && pl.mb !== mb) return { ok: false, why: 'outro computador', payload: pl };
    if (pl.maj && pl.maj < APP_MAJOR) return { ok: false, why: 'versão principal', payload: pl };
    if (pl.exp && now > pl.exp) return { ok: false, why: 'expirado', payload: pl };
    return { ok: true, payload: pl };
  };

  // ---------- servidor ----------
  async function call(path, body) {
    const r = await fetch(API + path, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch (e) { /* */ }
    if (!r.ok) { const e = new Error((j && j.error) || 'Erro ' + r.status); e.code = j && j.code; e.status = r.status; throw e; }
    return j;
  }
  /** Regras da demonstração e versão atual (com cache para funcionar offline). */
  L.appConfig = function () { return store.get(K_CFG) || { demo: DEMO_DEFAULT }; };
  async function refreshConfig() { try { const c = await call('/api/v1/app/config'); store.set(K_CFG, c); } catch (e) { /* offline */ } }

  function emit() { L.listeners.forEach((f) => { try { f(L.status); } catch (e) { console.error(e); } }); }
  L.onChange = (f) => L.listeners.push(f);

  async function evaluate() {
    const s = store.get(K_STATE);
    if (!s || !s.token) { L.status = { mode: 'demo', blocked: s && s.blocked }; return L.status; }
    const v = await L.verify(s.token, s.pub);
    if (v.ok) L.status = { mode: 'licensed', payload: v.payload, key: s.key, needsCheck: Date.now() > (v.payload.chk || 0) };
    else L.status = { mode: v.why === 'expirado' ? 'expired' : 'invalid', why: v.why, payload: v.payload, key: s.key };
    return L.status;
  }

  /** Normaliza como o servidor: maiúsculas, sem separadores, O→0, I/L→1 (o prefixo MMX1 mantém-se). */
  L.normKey = (key) => { const raw = String(key || '').toUpperCase().replace(/[^0-9A-Z]/g, ''); const body = raw.replace(/^MMX1/, '').replace(/O/g, '0').replace(/[IL]/g, '1'); return body.length === 20 ? 'MMX1-' + body.match(/.{5}/g).join('-') : raw; };
  /** Ativa a chave neste computador. */
  L.activate = async function (key) {
    if (!API) throw new Error('O servidor de licenças não está configurado (LICENSE_API em config.js).');
    const k = L.normKey(key);
    if (!/^MMX1(-[0-9A-Z]{5}){4}$/.test(k)) throw new Error('A chave tem o formato MMX1-XXXXX-XXXXX-XXXXX-XXXXX.');
    let pub = CFG.LICENSE_PUBLIC_KEY || (store.get(K_STATE) || {}).pub;
    if (!pub) { const pk = await call('/api/v1/licenses/public-key'); pub = pk.spki; } // primeira ativação: fixa a chave pública
    const m = L.machineName();
    const r = await call('/api/v1/licenses/activate', { key: k, machineId: L.machineId(), machineName: m.name, platform: m.platform, appVersion: APP_VERSION });
    const v = await L.verify(r.token, pub);
    if (!v.ok) throw new Error('O comprovativo recebido não é válido (' + v.why + ').');
    store.set(K_STATE, { key: k, token: r.token, pub, at: Date.now() });
    await refreshConfig();
    await evaluate(); emit();
    return L.status;
  };
  /** Desativa este computador (liberta a licença para outro). */
  L.deactivate = async function () {
    const s = store.get(K_STATE); if (!s) return;
    if (API) await call('/api/v1/licenses/deactivate', { key: s.key, machineId: L.machineId() });
    store.set(K_STATE, { pub: s.pub });
    await evaluate(); emit();
  };
  /** Revalidação online: renova o comprovativo ou aplica revogação/suspensão/desativação remota. Sem rede, não faz nada. */
  L.check = async function (force) {
    const s = store.get(K_STATE);
    if (!API || !s || !s.token) return L.status;
    if (!force && L.status.mode === 'licensed' && !L.status.needsCheck) return L.status;
    let r;
    try { r = await call('/api/v1/licenses/validate', { key: s.key, machineId: L.machineId(), appVersion: APP_VERSION }); } catch (e) { return L.status; } // offline: mantém
    if (r.ok) store.set(K_STATE, { ...s, token: r.token, at: Date.now() });
    else store.set(K_STATE, { pub: s.pub, key: s.key, blocked: { code: r.code, message: r.message, at: Date.now() } });
    await evaluate(); emit();
    return L.status;
  };

  // ---------- demonstração ----------
  /** true quando o licenciamento está ligado e não há licença válida. */
  L.isDemo = () => L.enabled && L.status.mode !== 'licensed';
  L.demoRules = () => Object.assign({}, DEMO_DEFAULT, (L.appConfig() || {}).demo || {});
  L.formatAllowed = (fmt) => !L.isDemo() || L.demoRules().formats.includes(fmt);
  L.demoText = () => { const d = L.demoRules(); return `Exportação limitada a ${d.exportSeconds} s em ${d.formats.map((f) => f.toUpperCase()).join(', ')}. Ativa a tua licença em Definições → Licença.`; };
  L.demoMessage = () => 'Demonstração: ' + L.demoText().charAt(0).toLowerCase() + L.demoText().slice(1);
  /** Na demonstração, corta o áudio exportado com um fade-out curto. */
  L.trim = function (buf) {
    if (!L.isDemo() || !buf) return buf;
    const sr = buf.sampleRate, n = Math.min(buf.length, Math.round(L.demoRules().exportSeconds * sr));
    if (n >= buf.length) return buf;
    const fade = Math.min(n, Math.round(sr * 1.5));
    const chs = [];
    for (let c = 0; c < buf.numberOfChannels; c++) { const x = buf.getChannelData(c).slice(0, n); for (let i = 0; i < fade; i++) x[n - fade + i] *= 1 - i / fade; chs.push(x); }
    return MM.toAudioBuffer ? MM.toAudioBuffer(chs, sr) : buf;
  };
  /** Para exports que não passam pelo codificador (DDP, WAV+CUE do álbum). */
  L.guard = function (what) { if (L.isDemo()) throw new Error(`${what} não está disponível na demonstração. ` + L.demoMessage()); };

  // ---------- arranque ----------
  L.ready = (async function () {
    if (!API) return L.status;
    if (!(window.crypto && crypto.subtle)) { L.status = { mode: 'invalid', why: 'o navegador não suporta verificação criptográfica (usa https)' }; return L.status; }
    await evaluate();
    refreshConfig().then(() => L.check()).then(emit, emit);
    return L.status;
  })().catch((e) => { console.warn('Licença', e); L.status = { mode: 'demo' }; return L.status; });
  // revalida quando volta a haver rede e uma vez por dia com a app aberta
  window.addEventListener('online', () => L.check(true));
  setInterval(() => L.check(), 24 * 3600e3);
})();
