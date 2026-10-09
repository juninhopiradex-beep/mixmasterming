// Dados demonstrativos (SÓ no modo de testes): clientes, compras simuladas, transferências com e sem comprovativo,
// licenças ativadas e uma oferta. Tudo passa pela API real (checkout → webhook simulado → licença).
//
//   ADMIN_EMAIL=… ADMIN_PASSWORD=… node server/bin/seed-demo.mjs http://localhost:8790 [comprovativo.png]
//
// ADMIN_PASSWORD é a palavra-passe ATUAL do administrador (depois da troca obrigatória da inicial).
import fs from 'node:fs';
import zlib from 'node:zlib';

export function client(base) {
  let cookie = '';
  const req = async (method, p, body, type) => {
    const h = { 'X-MM': '1' }; if (cookie) h.Cookie = cookie;
    let b = body;
    if (body !== undefined && !Buffer.isBuffer(body)) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; } else if (type) h['Content-Type'] = type;
    const r = await fetch(base + p, { method, headers: h, body: b, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) { const m = /mm_s=([^;]*)/.exec(sc); if (m) cookie = m[1] ? 'mm_s=' + m[1] : ''; }
    const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch { /* */ }
    if (r.status >= 400) throw new Error(`${method} ${p} → ${r.status} ${txt.slice(0, 200)}`);
    return j;
  };
  return { get: (p) => req('GET', p), post: (p, b) => req('POST', p, b === undefined ? {} : b), put: (p, b) => req('PUT', p, b), raw: (p, buf, type) => req('POST', p, buf, type), get cookie() { return cookie.replace(/^mm_s=/, ''); } };
}

/** PNG simples (recibo cinzento) para quando não é dado um ficheiro. */
function plainPng(w = 600, h = 800) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3, v = y % 40 < 2 && x > 40 && x < w - 40 ? 200 : 245; raw[i] = raw[i + 1] = raw[i + 2] = v; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export async function seedDemo(base, adminEmail, adminPassword, proofFile) {
  const admin = client(base);
  await admin.post('/api/auth/login', { email: adminEmail, password: adminPassword });
  const store = await admin.get('/api/public/store');
  if (store.mode !== 'test') throw new Error('Os dados demonstrativos só podem ser criados no modo de testes.');
  const verify = async (email) => {
    const mails = await admin.get('/api/admin/emails');
    const m = mails.find((x) => x.to_addr === email && x.template === 'account_confirm');
    const tok = m && /token=([\w-]+)/.exec(m.body); if (tok) await client(base).post('/api/auth/verify', { token: tok[1] });
  };
  const buy = async (c, who, plan, method, country) => {
    const r = await c.post('/api/checkout', { ...who, plan, method, country, acceptTerms: true, acceptPrivacy: true, billingName: who.name, taxId: who.taxId });
    return r.ref;
  };
  const out = {};
  // Ana — subscrição anual + perpétua pagas (simulado), ambas ativadas
  const ana = client(base), A = { name: 'Ana Ribeiro', email: 'ana.ribeiro@exemplo.test', password: 'Demo-Ana-2026-segura', country: 'PT', taxId: '' };
  const r1 = await buy(ana, A, 'annual', 'test', 'PT'); await ana.post('/api/test/simulate', { ref: r1, outcome: 'paid' });
  const r2 = await buy(ana, {}, 'perpetual', 'test', 'PT'); await ana.post('/api/test/simulate', { ref: r2, outcome: 'paid' });
  await verify(A.email);
  const ov = await ana.get('/api/account/overview');
  const dev = [['ana-mbp-01', 'MacBook Pro de Ana', 'macOS 15'], ['ana-studio-02', 'ESTUDIO-PC', 'Windows 11']];
  for (const [i, l] of ov.licenses.entries()) await client(base).post('/api/v1/licenses/activate', { key: l.key, machineId: dev[i % 2][0], machineName: dev[i % 2][1], platform: dev[i % 2][2], appVersion: '1.8' });
  out.ana = { ref: r1, cookie: ana.cookie };
  // Bruno — perpétua por transferência (Angola) com comprovativo enviado → fila de validação
  const bruno = client(base), B = { name: 'Bruno Kiala', email: 'bruno.kiala@exemplo.test', password: 'Demo-Bruno-2026-segura', country: 'AO' };
  const r3 = await buy(bruno, B, 'perpetual', 'bank_ao', 'AO'); await verify(B.email);
  const ord = await bruno.get('/api/account/orders/' + r3);
  const png = proofFile && fs.existsSync(proofFile) ? fs.readFileSync(proofFile) : plainPng();
  const amt = ord.amount.replace(/[^\d,]/g, '').replace(',', '.');
  await bruno.raw(`/api/account/orders/${r3}/proofs?filename=comprovativo-${r3}.png&amount=${amt}&date=${new Date().toISOString().slice(0, 10)}&ref=${r3}`, png, 'application/octet-stream');
  out.bruno = { ref: r3, cookie: bruno.cookie };
  // Carla — mensal por transferência (Portugal), ainda sem comprovativo
  const carla = client(base), C = { name: 'Carla Mendes', email: 'carla.mendes@exemplo.test', password: 'Demo-Carla-2026-segura', country: 'PT', taxId: '123456789' };
  const r4 = await buy(carla, C, 'monthly', 'bank_pt', 'PT'); await verify(C.email);
  out.carla = { ref: r4, cookie: carla.cookie };
  // Diogo — pagamento recusado; Eva — mensal ativa (simulado)
  const diogo = client(base); const r5 = await buy(diogo, { name: 'Diogo Neto', email: 'diogo.neto@exemplo.test', password: 'Demo-Diogo-2026-segura', country: 'BR' }, 'monthly', 'test', 'BR'); await diogo.post('/api/test/simulate', { ref: r5, outcome: 'failed' });
  const eva = client(base); const r6 = await buy(eva, { name: 'Eva Tavares', email: 'eva.tavares@exemplo.test', password: 'Demo-Eva-2026-segura', country: 'MZ' }, 'monthly', 'test', 'MZ'); await eva.post('/api/test/simulate', { ref: r6, outcome: 'paid' }); await verify('eva.tavares@exemplo.test');
  // oferta emitida pelo administrador
  await admin.post('/api/admin/licenses', { type: 'gift', count: 1, email: 'eva.tavares@exemplo.test', reason: 'Oferta de lançamento (dados demonstrativos)' });
  out.admin = { cookie: admin.cookie };
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.argv[2] || 'http://localhost:8790';
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) { console.error('Define ADMIN_EMAIL e ADMIN_PASSWORD (a palavra-passe atual do administrador).'); process.exit(1); }
  seedDemo(base, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, process.argv[3]).then(() => console.log('Dados demonstrativos criados.'), (e) => { console.error(e.message); process.exit(1); });
}
