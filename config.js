/* MIXMIND by Piradex — configuração do backend (OPCIONAL).
 * Sem chaves, a app funciona 100 % local, como sempre.
 * Com um projeto Supabase (grátis): portal de clientes (portal.html), moderação na vista Estilos e biblioteca partilhada.
 * Passos no README → "Backend para clientes (Supabase)". A chave "anon" é pública por natureza: a segurança está nas
 * regras RLS de supabase/schema.sql (os clientes só conseguem ENVIAR; só o admin lê, aprova e apaga). */
window.MIXMIND_CONFIG = {
  SUPABASE_URL: '',      // ex.: 'https://abcdefgh.supabase.co'
  SUPABASE_ANON_KEY: '', // Project Settings → API → anon public
  BUCKET: 'submissions',

  // Acesso controlado (v1.8): true = ninguém usa a app sem entrar com uma conta da loja (ecrã de entrada antes de tudo).
  // Precisa do servidor da loja publicado e do endereço em LICENSE_API. Para abrir a app sem contas: false.
  EXIGIR_LOGIN: true,

  // Licenciamento (v1.8). Vazio = licenciamento desligado (tudo disponível, como antes).
  // Com a loja instalada (pasta server/), indica o endereço público dela e a chave pública de verificação
  // (Administração → Configurações → Licenciamento → "Chave pública"). A chave pública NÃO é secreta.
  LICENSE_API: '',        // endereço da loja/servidor, ex.: 'https://loja.mixmind.example'  (sem barra no fim)
  LICENSE_PUBLIC_KEY: '', // SPKI em base64 (MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE…). Se ficar vazia, é obtida e fixada na 1.ª ativação.
};
