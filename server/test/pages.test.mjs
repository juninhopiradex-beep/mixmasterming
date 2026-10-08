// Interface da loja no Chromium: páginas sem erros, compra pela interface (pagamento simulado e transferência),
// envio do comprovativo, validação pelo administrador e troca obrigatória da palavra-passe inicial.
// `node --no-warnings server/test/pages.test.mjs`
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startAll } from './harness.mjs';
import { test, ok, summary } from '../../tests/load.mjs';

const S = await startAll();
const base = S.base, db = S.ctx.db;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
const page = async (ctx) => { const p = await (ctx || (await browser.newContext({ viewport: { width: 1280, height: 860 } }))).newPage(); p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => { if (m.type() === 'error' && !/status of (400|401|404)/.test(m.text())) errors.push(m.text()); }); return p; };
const until = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 15000 }).catch(async (e) => { throw new Error(`à espera de ${String(fn).slice(0, 90)} em ${p.url()} — ${(await p.locator("body").innerText().catch(() => "")).slice(-300).replace(/\s+/g, " ")}`); });
// PNG mínimo válido para o comprovativo
function png() {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const h = Buffer.alloc(13); h.writeUInt32BE(8, 0); h.writeUInt32BE(8, 4); h[8] = 8; h[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', h), ch('IDAT', zlib.deflateSync(Buffer.alloc(8 * 25, 200))), ch('IEND', Buffer.alloc(0))]);
}
const proofFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mmp-')), 'comprovativo.png'); fs.writeFileSync(proofFile, png());

console.log('Loja · interface');
await test('páginas públicas abrem sem erros e a página de vendas mostra os 3 planos e a poupança', async () => {
  const p = await page();
  for (const u of ['/', '/comprar', '/entrar', '/registar', '/recuperar', '/termos', '/privacidade', '/reembolsos']) { await p.goto(base + u, { waitUntil: 'networkidle' }); }
  await p.goto(base + '/', { waitUntil: 'networkidle' });
  const t = await p.locator('#plans').innerText();
  ok(/US\$99/.test(t) && /US\$19,99/.test(t) && /US\$59/.test(t) && /75,4%/.test(t), t.slice(0, 200));
  const f = await p.locator('#feats').innerText(); ok(/Em breve/.test(f) && /chave API/.test(f), 'motor de IA com chave própria marcado como Em breve');
  const r = await fetch(base + '/nao-existe'); ok(r.status === 404, 'estado 404');
  await p.context().close();
});

let adminCtx;
await test('administrador: entra com a palavra-passe inicial e é obrigado a alterá-la', async () => {
  adminCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const p = await page(adminCtx);
  await p.goto(base + '/entrar', { waitUntil: 'networkidle' });
  await p.fill('#email', 'admin@loja.test'); await p.fill('#pw', S.adminPw); await p.click('#go');
  await until(p, () => /palavra-passe inicial/.test(document.body.innerText));
  const np = 'Gestor-' + crypto.randomBytes(9).toString('base64url');
  await p.fill('#cur', S.adminPw); await p.fill('#pw', np); await p.fill('#pw2', np); await p.click('#go');
  await p.waitForURL(/\/admin/); await until(p, () => document.querySelector('.side a.on'));
  ok(!db.get("SELECT must_change_password m FROM users WHERE email = 'admin@loja.test'").m, 'troca registada');
  await p.close();
});

let buyerCtx, ref;
await test('compra pela interface (pagamento simulado): licença só depois do evento do prestador', async () => {
  buyerCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const p = await page(buyerCtx);
  await p.goto(base + '/comprar?plano=perpetual', { waitUntil: 'networkidle' });
  await p.fill('#name', 'Rita UI'); await p.fill('#email', 'rita.ui@ex.test'); await p.fill('#password', 'Rita-Interface-2026');
  await p.selectOption('#country', 'PT'); await until(p, () => document.querySelector('input[value=test]'));
  await p.check('input[value=test]'); await until(p, () => /Total/.test(document.querySelector('#sum').innerText));
  ok(/IVA/.test(await p.locator('#sum').innerText()), 'imposto de PT no resumo');
  await p.click('#go'); ok(/aceitar/.test(await p.locator('.toast').last().innerText()), 'exige aceitar os termos');
  await p.check('#acceptTerms'); await p.check('#acceptPrivacy'); await p.click('#go');
  await p.waitForURL(/teste-pagamento/);
  ref = new URL(p.url()).searchParams.get('ref');
  const lic = () => db.get("SELECT COUNT(*) n FROM licenses l JOIN users u ON u.id = l.user_id WHERE u.email = 'rita.ui@ex.test'").n;
  ok(lic() === 0, 'sem licença antes do evento');
  await until(p, () => document.querySelector('[data-o=paid]')); await p.click('[data-o=paid]');
  await until(p, () => /Confirmado/.test(document.querySelector('#app').innerText));
  ok(lic() === 1, 'uma licença');
  await p.close();
});

await test('transferência: instruções, envio do borderô pela interface e mensagem exata; sem licença', async () => {
  const p = await page(buyerCtx);
  await p.goto(base + '/comprar?plano=annual', { waitUntil: 'networkidle' });
  await p.selectOption('#country', 'AO'); await until(p, () => document.querySelector('input[value=bank_ao]'));
  await p.check('input[value=bank_ao]'); await until(p, () => /Kz/.test(document.querySelector('#sum').innerText));
  ok(/câmbio/.test(await p.locator('#sum').innerText()), 'mostra a conversão');
  await p.check('#acceptTerms'); await p.check('#acceptPrivacy'); await p.click('#go');
  await p.waitForURL(/conta#encomenda\//); await until(p, () => document.querySelector('#proofCard'));
  const t = await p.locator('#main').innerText(); ok(/EXEMPLO/.test(t) && /IBAN/.test(t), 'dados bancários (exemplo de testes)');
  await p.setInputFiles('#file', proofFile); await p.fill('#pAmount', '53985'); await p.click('#send');
  await until(p, () => /Comprovativo recebido\. O pagamento encontra-se a aguardar validação\./.test(document.body.innerText));
  ref = decodeURIComponent(p.url().split('#encomenda/')[1]);
  const o = db.get('SELECT * FROM orders WHERE ref = ?', ref);
  ok(o.status === 'awaiting_validation' && !db.get('SELECT 1 FROM licenses WHERE order_id = ?', o.id), 'aguarda validação e sem licença');
  await p.close();
});

await test('administrador: valida o comprovativo na fila (com confirmação obrigatória) e a licença é emitida uma vez', async () => {
  const p = await page(adminCtx);
  await p.goto(base + '/admin#transferencias', { waitUntil: 'networkidle' });
  await until(p, (r) => document.querySelector(`tr[data-id]`) && document.body.innerText.includes(r), ref);
  await p.click(`tr[data-id]:has-text("${ref}")`); await until(p, () => document.querySelector('#approve'));
  ok(await p.locator('img[alt=Comprovativo]').count() === 1, 'pré-visualização do comprovativo');
  await p.click('#approve'); await p.click('.modal [data-ok]');
  ok(/Confirma a caixa/.test(await p.locator('.toast').last().innerText()), 'exige a caixa de confirmação');
  await p.check('.modal #mc'); await p.click('.modal [data-ok]');
  await until(p, () => /Confirmado/.test(document.querySelector('#main').innerText));
  const o = db.get('SELECT * FROM orders WHERE ref = ?', ref);
  ok(o.status === 'confirmed' && db.get('SELECT COUNT(*) n FROM licenses WHERE order_id = ? OR subscription_id = ?', o.id, o.subscription_id).n === 1, 'uma licença da subscrição');
  ok(db.get("SELECT COUNT(*) n FROM audit_log WHERE action = 'transfer.approve'").n === 1, 'auditado');
  await p.close();
});

await test('área do cliente: licenças visíveis depois de confirmar o email; desativar o computador', async () => {
  const mail = db.get("SELECT body FROM emails WHERE to_addr = 'rita.ui@ex.test' AND template = 'account_confirm' ORDER BY id DESC");
  const p = await page(buyerCtx);
  await p.goto(base + '/verificar?token=' + /token=([\w-]+)/.exec(mail.body)[1], { waitUntil: 'networkidle' });
  ok(/Email confirmado/.test(await p.locator('#app').innerText()), 'email confirmado');
  const key = db.get("SELECT l.key FROM licenses l JOIN users u ON u.id = l.user_id WHERE u.email = 'rita.ui@ex.test' AND l.type = 'perpetual'").key;
  await fetch(base + '/api/v1/licenses/activate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, machineId: 'pc-da-rita-123456', machineName: 'PC da Rita', platform: 'Windows 11', appVersion: '1.8' }) });
  await p.goto(base + '/conta#licencas', { waitUntil: 'networkidle' }); await until(p, () => document.querySelector('[data-deact]'));
  ok((await p.locator('#main').innerText()).includes(key), 'chave completa visível');
  await p.click('[data-deact]'); await p.click('.modal [data-ok]');
  await until(p, () => /Nenhum computador ativo/.test(document.querySelector('#main').innerText));
  await p.close();
});

await test('administrador: todas as secções abrem sem erros', async () => {
  const p = await page(adminCtx);
  for (const h of ['painel', 'transferencias', 'encomendas', 'clientes', 'licencas', 'subscricoes', 'eventos', 'configuracoes', 'textos', 'texto/terms', 'equipa', 'auditoria', 'emails', 'seguranca']) {
    await p.goto(base + '/admin#' + h, { waitUntil: 'networkidle' }); await until(p, () => !document.querySelector('#main .skel'));
    ok(!(await p.locator('#main .notice.bad').count()), 'erro em ' + h);
  }
  await p.close();
});
await test('sem erros de JavaScript nas páginas', async () => ok(!errors.length, errors.join('\n')));
await browser.close(); S.close();
summary();
