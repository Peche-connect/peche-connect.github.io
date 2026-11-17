-- Imitation minimale de Supabase (rôles, schéma auth) pour tester le schéma sur un Postgres ordinaire
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid(), phone text, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', 'anon') $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(current_setting('request.jwt.claims', true)::jsonb, '{}') $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant usage on schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;
-- Comme Supabase : droits larges par défaut pour anon et authenticated, la sécurité repose sur les règles (RLS)
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
-- Stockage de fichiers (Storage), version minimale
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;
create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner uuid default auth.uid());
alter table storage.objects enable row level security;
grant all on storage.objects to anon, authenticated, service_role;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
