/* MIXMIND by Piradex — configuração do backend (OPCIONAL).
 * Sem chaves, a app funciona 100 % local, como sempre.
 * Com um projeto Supabase (grátis): portal de clientes (portal.html), moderação na vista Estilos e biblioteca partilhada.
 * Passos no README → "Backend para clientes (Supabase)". A chave "anon" é pública por natureza: a segurança está nas
 * regras RLS de supabase/schema.sql (os clientes só conseguem ENVIAR; só o admin lê, aprova e apaga). */
window.MIXMIND_CONFIG = {
  SUPABASE_URL: '',      // ex.: 'https://abcdefgh.supabase.co'
  SUPABASE_ANON_KEY: '', // Project Settings → API → anon public
  BUCKET: 'submissions',
};
