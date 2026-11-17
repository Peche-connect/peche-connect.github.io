-- Pêche Connect · photos d'arrivage, accès des chauffeurs, tâches automatiques

-- ───────── Chauffeurs : voient le point d'enlèvement des commandes qu'ils livrent ─────────
create or replace function livre_chez(p_etal uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from bons where etal_id = p_etal and chauffeur_id = auth.uid() and statut in ('reserve', 'en_livraison'))
$$;
grant execute on function livre_chez(uuid) to authenticated;
drop policy if exists etals_prive_lire on etals_prive;
create policy etals_prive_lire on etals_prive for select using (etal_id = mon_etal() or a_bon_paye(etal_id) or livre_chez(etal_id) or est_admin());

-- ───────── Photos des arrivages (Supabase Storage) ─────────
-- Dossier public « arrivages », un sous-dossier par étal : arrivages/<id de l'étal>/photo.jpg
do $$ begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('arrivages', 'arrivages', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;

    drop policy if exists arrivages_lire on storage.objects;
    create policy arrivages_lire on storage.objects for select using (bucket_id = 'arrivages');
    drop policy if exists arrivages_deposer on storage.objects;
    create policy arrivages_deposer on storage.objects for insert to authenticated
      with check (bucket_id = 'arrivages' and (storage.foldername(name))[1] = mon_etal()::text);
    drop policy if exists arrivages_remplacer on storage.objects;
    create policy arrivages_remplacer on storage.objects for update to authenticated
      using (bucket_id = 'arrivages' and (storage.foldername(name))[1] = mon_etal()::text);
    drop policy if exists arrivages_effacer on storage.objects;
    create policy arrivages_effacer on storage.objects for delete to authenticated
      using (bucket_id = 'arrivages' and (storage.foldername(name))[1] = mon_etal()::text);
  end if;
end $$;

-- ───────── Tâches automatiques (extension pg_cron, à activer dans Database > Extensions) ─────────
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- toutes les 5 minutes : efface les positions de pêcheur expirées
    perform cron.schedule('effacer-positions', '*/5 * * * *', 'select public.effacer_positions_expirees()');
    -- chaque nuit à 3 h (heure de Paris = 22 h en Martinique) : purge du compteur de SMS
    perform cron.schedule('purger-sms', '0 3 * * *', $c$delete from public.envois_sms where cree_le < now() - interval '2 days'$c$);
    -- toutes les 15 minutes : remet en vente le poisson des paiements abandonnés depuis plus d'une heure
    perform cron.schedule('bons-abandonnes', '*/15 * * * *',
      $c$select public.annuler_bon(b.code) from public.bons b where b.statut = 'en_attente_paiement' and (
           (b.cree_le < now() - interval '1 hour' and not exists (select 1 from public.demandes d where d.bon_code = b.code))
        or (b.cree_le < now() - interval '24 hours'))$c$);
  end if;
end $$;

-- ───────── Alerte d'activité anormale ─────────
-- Vue lue par l'admin (et par la fonction « surveillance ») : comptes qui créent beaucoup de bons ou
-- envoient beaucoup de messages sur la dernière heure.
create or replace view activite_anormale with (security_invoker = true) as
  select 'bons' as quoi, client_id as qui, count(*) as nombre from bons
   where cree_le > now() - interval '1 hour' group by client_id having count(*) > 10
  union all
  select 'messages', auteur_id, count(*) from messages
   where cree_le > now() - interval '1 hour' group by auteur_id having count(*) > 120;
grant select on activite_anormale to authenticated;

-- ───────── Rappel de retrait (notification envoyée une seule fois) ─────────
alter table bons add column if not exists rappel_envoye boolean not null default false;
-- Notification d'arrivage : une seule fois toutes les 2 heures par étal
alter table etals add column if not exists notifie_le timestamptz;

-- ───────── Périodes de fermeture connues (à revérifier chaque année auprès de la Direction de la Mer) ─────────
-- Zones chlordécone : arrêté préfectoral n°2012335 du 30 novembre 2012 (fonds de baies) ; à ajouter port par port
-- avec la colonne « port » une fois la carte des zones croisée avec les points de débarquement.
insert into fermetures (espece, debut, fin, annuelle, motif, source)
select * from (values
  ('Lambi', date '2000-01-01', date '2000-06-30', true, 'Fermeture annuelle du lambi : pêche et vente en frais interdites du 1er janvier au 30 juin', 'Direction de la Mer de Martinique, mémento de la pêche professionnelle'),
  ('Langouste', date '2000-06-01', date '2000-09-30', true, 'Fermeture annuelle de la langouste du 1er juin au 30 septembre', 'Préfecture de la Martinique (rappel du 7 juin 2024)')
) v(espece, debut, fin, annuelle, motif, source)
where not exists (select 1 from fermetures f where f.espece = v.espece and f.annuelle);
