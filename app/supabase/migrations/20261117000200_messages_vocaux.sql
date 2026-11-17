-- Pêche Connect · messages vocaux dans la messagerie
-- Le son est dans un dossier PRIVÉ « messages-audio/<id de la conversation>/ » :
-- seuls le client et le pêcheur de cette conversation peuvent l'écouter ou en déposer.

alter table messages add column if not exists audio jsonb; -- { chemin, duree } (durée en secondes)
do $$ begin
  alter table messages add constraint messages_audio_duree check (audio is null or ((audio ->> 'duree')::int between 1 and 120));
exception when duplicate_object then null; end $$;

-- Participant d'une conversation (client ou pêcheur de l'étal)
create or replace function participe(p_conv text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from conversations c where c.id::text = p_conv and (c.client_id = auth.uid() or c.etal_id = mon_etal()))
$$;
grant execute on function participe(text) to authenticated;

-- Un message vocal doit pointer vers un fichier de SA conversation
create or replace function verifier_audio() returns trigger
language plpgsql as $$
begin
  if new.audio is not null and split_part(new.audio ->> 'chemin', '/', 1) <> new.conversation_id::text then
    raise exception 'Fichier audio d''une autre conversation' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists messages_audio on messages;
create trigger messages_audio before insert on messages for each row execute function verifier_audio();

do $$ begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('messages-audio', 'messages-audio', false, 2097152, array['audio/webm', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/mpeg'])
    on conflict (id) do nothing;

    drop policy if exists audio_ecouter on storage.objects;
    create policy audio_ecouter on storage.objects for select to authenticated
      using (bucket_id = 'messages-audio' and participe((storage.foldername(name))[1]));
    drop policy if exists audio_deposer on storage.objects;
    create policy audio_deposer on storage.objects for insert to authenticated
      with check (bucket_id = 'messages-audio' and participe((storage.foldername(name))[1]));
  end if;
end $$;
