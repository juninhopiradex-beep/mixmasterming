// server/scripts/beta-hash.mjs
import crypto2 from "node:crypto";

// server/src/security.js
import crypto from "node:crypto";
var SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function hashPassword(pw2) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pw2).normalize("NFKC"), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${h.toString("base64")}`;
}

// server/scripts/beta-hash.mjs
var [id = "", until = ""] = process.argv.slice(2);
if (!/^[a-z0-9][a-z0-9._@+-]{2,63}$/i.test(id)) {
  console.error("Uso: node server/scripts/beta-hash.mjs <utilizador> [AAAA-MM-DD]   (3–64 caracteres: letras, números, . _ - @ +)");
  process.exit(1);
}
if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
  console.error("Validade inválida (usa AAAA-MM-DD).");
  process.exit(1);
}
var A = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
var grp = () => Array.from(crypto2.randomBytes(5), (b) => A[b % A.length]).join("");
var pw = `${grp()}-${grp()}-${grp()}-${grp()}`;
console.log(`Utilizador:     ${id.toLowerCase()}`);
console.log(`Palavra-passe:  ${pw}      (entrega-a ao beta tester; não fica guardada)`);
console.log(`
Acrescenta a BETA_ACESSOS (separado das outras por um espaço):
${id.toLowerCase()}:${hashPassword(pw)}${until ? ":" + until : ""}`);
