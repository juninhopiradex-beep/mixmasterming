-- MIXMIND by Piradex — backend para clientes (Supabase)
-- Corre isto UMA vez em Supabase → SQL Editor. Depois:
--   1) Authentication → Users → "Add user": cria o teu utilizador admin (email + palavra-passe)
--   2) troca o email na última linha deste ficheiro e corre-a (ou insere-o na tabela admins)
--   3) Project Settings → API: copia a URL e a chave "anon public" para config.js
-- Segurança (RLS): os clientes (chave anon) só conseguem CRIAR submissões pendentes e ENVIAR áudio para incoming/.
-- Não conseguem ler nada. Só quem está na tabela admins lê, aprova, apaga e publica na biblioteca.
-- A biblioteca partilhada (library_tracks) só tem MEDIDAS (curva tonal, loudness, balanço…) e é de leitura pública.

create extension if not exists pgcrypto;

create table if not exists public.admins (email text primary key);
alter table public.admins enable row level security; -- sem políticas: ninguém lê pela API

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  client_name text not null check (char_length(client_name) between 1 and 120),
  client_email text not null check (client_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  style text not null check (char_length(style) between 1 and 60),
  kind text not null check (kind in ('master', 'stems')),
  title text not null check (char_length(title) between 1 and 200),
  files jsonb not null default '[]'::jsonb check (jsonb_typeof(files) = 'array' and jsonb_array_length(files) between 1 and 200),
  note text check (note is null or char_length(note) <= 2000),
  rights_ok boolean not null check (rights_ok),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz
);
alter table public.submissions enable row level security;
drop policy if exists "clientes submetem" on public.submissions;
create policy "clientes submetem" on public.submissions for insert to anon, authenticated
  with check (status = 'pending' and reviewed_at is null and rights_ok);
drop policy if exists "admin lê" on public.submissions;
create policy "admin lê" on public.submissions for select to authenticated using (public.is_admin());
drop policy if exists "admin atualiza" on public.submissions;
create policy "admin atualiza" on public.submissions for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin apaga" on public.submissions;
create policy "admin apaga" on public.submissions for delete to authenticated using (public.is_admin());

create table if not exists public.library_tracks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  style text not null check (char_length(style) between 1 and 60),
  base text not null default 'Pop',
  kind text not null check (kind in ('master', 'stems')),
  name text not null,
  features jsonb,
  balance jsonb,
  submission_id uuid references public.submissions(id) on delete set null
);
alter table public.library_tracks enable row level security;
drop policy if exists "todos leem a biblioteca" on public.library_tracks;
create policy "todos leem a biblioteca" on public.library_tracks for select to anon, authenticated using (true);
drop policy if exists "admin publica" on public.library_tracks;
create policy "admin publica" on public.library_tracks for insert to authenticated with check (public.is_admin());
drop policy if exists "admin remove" on public.library_tracks;
create policy "admin remove" on public.library_tracks for delete to authenticated using (public.is_admin());

-- Storage: bucket privado, só áudio, até 500 MB por ficheiro
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('submissions', 'submissions', false, 524288000,
        array['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave', 'audio/aiff', 'audio/x-aiff', 'audio/flac', 'audio/x-flac', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/ogg', 'application/octet-stream'])
on conflict (id) do nothing;
drop policy if exists "clientes enviam áudio" on storage.objects;
create policy "clientes enviam áudio" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'submissions' and (storage.foldername(name))[1] = 'incoming');
drop policy if exists "admin lê áudio" on storage.objects;
create policy "admin lê áudio" on storage.objects for select to authenticated using (bucket_id = 'submissions' and public.is_admin());
drop policy if exists "admin apaga áudio" on storage.objects;
create policy "admin apaga áudio" on storage.objects for delete to authenticated using (bucket_id = 'submissions' and public.is_admin());

-- ⬇ troca pelo teu email de admin (o mesmo do utilizador criado em Authentication → Users)
insert into public.admins (email) values ('o-teu-email@exemplo.com') on conflict do nothing;
