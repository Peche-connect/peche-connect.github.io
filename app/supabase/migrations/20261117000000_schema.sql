-- Pêche Connect · schéma de la base (Supabase / Postgres)
-- À exécuter une fois dans Supabase : SQL Editor > coller ce fichier > Run
-- (ou « supabase db push » avec la CLI). Rejouable sans casse sur une base vide.
--
-- Principes :
--  * chaque table a ses règles d'accès (RLS) : personne ne lit ni n'écrit sans règle explicite ;
--  * l'adresse exacte et l'immatriculation du pêcheur sont dans une table à part (etals_prive),
--    lisible seulement par le pêcheur, l'administration et les clients qui ont un bon payé chez lui ;
--  * les bons, les paiements et les stocks ne sont modifiés que par les fonctions serveur
--    (clé « service_role », jamais dans l'appli) ;
--  * l'administration exige la double vérification (2FA, niveau « aal2 »).

create extension if not exists pgcrypto;

-- ───────────────────────── Types ─────────────────────────
do $$ begin
  create type role_utilisateur as enum ('client', 'pro', 'pecheur', 'chauffeur', 'admin');
exception when duplicate_object then null; end $$;
do $$ begin
  create type statut_bon as enum ('en_attente_paiement', 'reserve', 'en_livraison', 'retire', 'annule');
exception when duplicate_object then null; end $$;
do $$ begin
  create type statut_pecheur as enum ('en_attente', 'verifie', 'suspendu');
exception when duplicate_object then null; end $$;

-- ───────────────────────── Réglages (montants à fixer entre associés) ─────────────────────────
create table if not exists reglages (
  id boolean primary key default true check (id), -- une seule ligne
  frais_service numeric(6,2) not null default 0.90,     -- payés par le client, par réservation
  commission_pct numeric(5,4) not null default 0.0000,  -- part prélevée sur le poisson (0 = gratuit pour les pêcheurs)
  marge_empreinte numeric(5,4) not null default 0.10,   -- on bloque 10 % de plus que l'estimation
  livraison_min_kg numeric(6,1) not null default 10,    -- provisoire
  frais_livraison numeric(6,2) not null default 15,     -- provisoire
  tva_produits_mer numeric(5,4) not null default 0.021, -- à confirmer avec un comptable
  delai_position_min int not null default 30,           -- position du pêcheur effacée après ce délai
  maj_le timestamptz not null default now()
);
insert into reglages (id) values (true) on conflict do nothing;

-- ───────────────────────── Profils et rôles ─────────────────────────
create table if not exists profils (
  id uuid primary key references auth.users (id) on delete cascade,
  role role_utilisateur not null default 'client',
  prenom text not null default '' check (char_length(prenom) <= 40),
  telephone text,            -- jamais montré aux autres utilisateurs
  commune text,
  cree_le timestamptz not null default now()
);

-- Infos des professionnels (restaurants, poissonneries…) : SIRET et adresse protégés
create table if not exists pros (
  profil_id uuid primary key references profils (id) on delete cascade,
  raison text not null check (char_length(raison) between 2 and 120),
  type text not null check (type in ('Restaurant', 'Poissonnerie', 'Revendeur', 'Traiteur')),
  siret text not null check (siret ~ '^\d{14}$'),
  commune text not null,
  adresse text
);

-- Étal = la vitrine publique d'un pêcheur (sans adresse exacte ni numéro)
create table if not exists etals (
  id uuid primary key default gen_random_uuid(),
  pecheur_id uuid unique references profils (id) on delete set null, -- vide si le pêcheur supprime son compte (ventes gardées)
  prenom text not null,
  port text not null,
  bateau text not null default '',
  statut statut_pecheur not null default 'en_attente',
  stripe_pret boolean not null default false,
  note numeric(2,1) not null default 5,
  avis int not null default 0,
  photo_url text,
  debarque_le timestamptz,
  limite_retrait time not null default '12:00',
  cree_le timestamptz not null default now()
);

-- Partie privée de l'étal (règle anti-contournement)
create table if not exists etals_prive (
  etal_id uuid primary key references etals (id) on delete cascade,
  lieu text,                 -- adresse exacte du point de retrait
  precision text,            -- « à gauche de la cale », etc.
  immatriculation text,
  stripe_compte text         -- identifiant du compte Stripe Connect (acct_…)
);

create table if not exists produits (
  id uuid primary key default gen_random_uuid(),
  etal_id uuid not null references etals (id) on delete cascade,
  espece text not null,
  prix_kg numeric(6,2) not null check (prix_kg > 0 and prix_kg < 500),
  dispo_kg numeric(7,1) not null check (dispo_kg >= 0),
  preparations jsonb not null default '[{"nom":"Entier","supplementKg":0}]',
  publie_le timestamptz not null default now()
);
create index if not exists produits_etal on produits (etal_id);

-- Fermetures (périodes de pêche fermées, zones interdites) : la plateforme bloque la mise en vente
create table if not exists fermetures (
  id serial primary key,
  espece text not null,
  port text,                 -- null = toute la Martinique
  debut date not null,
  fin date not null,
  annuelle boolean not null default false, -- vrai : se répète chaque année (seuls le jour et le mois comptent)
  motif text not null,
  source text                -- arrêté préfectoral, à renseigner
);

-- ───────────────────────── Bons de retrait ─────────────────────────
create sequence if not exists numero_bon start 100;
create table if not exists bons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('R-' || nextval('numero_bon')),
  etal_id uuid not null references etals (id),
  client_id uuid references profils (id) on delete set null, -- anonymisé si le client supprime son compte
  client_prenom text not null default 'Client',
  pro jsonb,                 -- copie raison / type / SIRET / commune pour la facture
  livraison jsonb,           -- { adresse, frais }
  chauffeur_id uuid references profils (id) on delete set null,
  lignes jsonb not null,     -- [{ produitId, espece, kg, prixKg, preparation, supplementKg }]
  creneau text not null,
  statut statut_bon not null default 'en_attente_paiement',
  montant_bloque numeric(8,2) not null,
  montant_paye numeric(8,2),
  commission numeric(8,2),
  stripe_session text,
  stripe_paiement text,      -- PaymentIntent
  signature text,            -- signature HMAC du QR (lisible seulement par le client via mon_qr)
  cree_le timestamptz not null default now(),
  paye_le timestamptz,
  retire_le timestamptz
);
create index if not exists bons_etal on bons (etal_id, statut);
create index if not exists bons_client on bons (client_id);

-- ───────────────────────── Messagerie ─────────────────────────
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  etal_id uuid not null references etals (id) on delete cascade,
  client_id uuid references profils (id) on delete cascade,
  client_prenom text not null default 'Client',
  bon_code text,
  lu_client boolean not null default true,
  lu_pecheur boolean not null default true,
  cree_le timestamptz not null default now(),
  unique (etal_id, client_id)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations (id) on delete cascade,
  auteur_id uuid references profils (id) on delete set null,
  auteur text not null check (auteur in ('client', 'pecheur', 'systeme')),
  texte text check (char_length(texte) <= 1000),
  position jsonb,            -- { libelle, lat, lon } ; effacée après expiration
  position_expire_le timestamptz,
  cree_le timestamptz not null default now()
);
create index if not exists messages_conv on messages (conversation_id, cree_le);

-- ───────────────────────── Besoins des pros ─────────────────────────
create table if not exists demandes (
  id uuid primary key default gen_random_uuid(),
  pro_id uuid not null references profils (id) on delete cascade,
  pro_raison text not null,
  pro_type text not null,
  pro_commune text not null,
  espece text not null,
  kg numeric(6,1) not null check (kg > 0 and kg <= 1000),
  prix_max_kg numeric(6,2) not null check (prix_max_kg > 0),
  pour text not null check (pour in ('Aujourd’hui', 'Demain')),
  note text check (char_length(note) <= 300),
  livraison jsonb,
  statut text not null default 'ouverte' check (statut in ('ouverte', 'acceptee', 'annulee')),
  etal_id uuid references etals (id) on delete set null,
  bon_code text,
  cree_le timestamptz not null default now()
);

-- ───────────────────────── Notifications ─────────────────────────
create table if not exists jetons_push (
  jeton text primary key,
  profil_id uuid not null references profils (id) on delete cascade,
  cree_le timestamptz not null default now()
);
create table if not exists suivis (  -- « prévenez-moi quand il y a du thazard »
  profil_id uuid not null references profils (id) on delete cascade,
  espece text not null,
  commune text,
  primary key (profil_id, espece)
);

-- ───────────────────────── Sécurité : limites et journal ─────────────────────────
create table if not exists envois_sms (
  telephone text not null,
  cree_le timestamptz not null default now()
);
create index if not exists envois_sms_tel on envois_sms (telephone, cree_le);

create table if not exists journal (
  id bigserial primary key,
  quand timestamptz not null default now(),
  qui uuid,
  quoi text not null,
  details jsonb
);

-- ───────────────────────── Fonctions utilitaires ─────────────────────────
create or replace function mon_role() returns role_utilisateur
language sql stable security definer set search_path = public as $$
  select role from profils where id = auth.uid()
$$;

-- Administrateur ET connecté avec la double vérification (2FA)
create or replace function est_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from profils where id = auth.uid()), false)
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

create or replace function mon_etal() returns uuid
language sql stable security definer set search_path = public as $$
  select id from etals where pecheur_id = auth.uid()
$$;

-- Le client connecté a-t-il un bon payé (pas encore clôturé depuis plus d'un jour) chez cet étal ?
create or replace function a_bon_paye(p_etal uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from bons
    where etal_id = p_etal and client_id = auth.uid()
      and statut in ('reserve', 'en_livraison', 'retire')
      and coalesce(retire_le, now()) > now() - interval '1 day'
  )
$$;

-- Anti-contournement : masque les numéros de téléphone dans les messages
create or replace function masquer_numeros() returns trigger
language plpgsql as $$
begin
  if new.texte is not null and new.texte ~ '\+?\d[\d .-]{7,}\d' then
    new.texte := regexp_replace(new.texte, '\+?\d[\d .-]{7,}\d', '•• •• •• •• ••', 'g');
  end if;
  return new;
end $$;
drop trigger if exists messages_masquer on messages;
create trigger messages_masquer before insert on messages for each row execute function masquer_numeros();

-- Position du pêcheur : durée de vie limitée
create or replace function borner_position() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.position is not null then
    new.position_expire_le := least(coalesce(new.position_expire_le, now() + interval '4 hours'), now() + interval '12 hours')
      + make_interval(mins => (select delai_position_min from reglages));
  end if;
  return new;
end $$;
drop trigger if exists messages_position on messages;
create trigger messages_position before insert on messages for each row execute function borner_position();

-- À lancer régulièrement (pg_cron, voir plus bas) : efface les positions expirées
create or replace function effacer_positions_expirees() returns int
language sql security definer set search_path = public as $$
  with m as (
    update messages set position = null, texte = coalesce(texte, 'Position partagée (expirée)')
    where position is not null and position_expire_le < now() returning 1
  ) select count(*)::int from m
$$;

-- Bloque la mise en vente d'une espèce fermée (période ou zone)
create or replace function verifier_fermeture() returns trigger
language plpgsql security definer set search_path = public as $$
declare f record; p text;
begin
  select port into p from etals where id = new.etal_id;
  select * into f from fermetures
   where lower(espece) = lower(new.espece) and (port is null or port = p)
     and ((not annuelle and current_date between debut and fin)
       or (annuelle and to_char(current_date, 'MMDD') between to_char(debut, 'MMDD') and to_char(fin, 'MMDD')))
   limit 1;
  if found and new.dispo_kg > 0 then
    raise exception 'Vente fermée : % (%)', new.espece, f.motif using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists produits_fermeture on produits;
create trigger produits_fermeture before insert or update on produits for each row execute function verifier_fermeture();

-- Un pêcheur ne publie que s'il est vérifié et que son compte de paiement est prêt
create or replace function verifier_pecheur_actif() returns trigger
language plpgsql set search_path = public as $$  -- pas « security definer » : on doit savoir QUI modifie
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if not exists (select 1 from etals where id = new.etal_id and statut = 'verifie' and stripe_pret) then
    raise exception 'Compte pêcheur pas encore vérifié' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists produits_pecheur_actif on produits;
create trigger produits_pecheur_actif before insert or update on produits for each row execute function verifier_pecheur_actif();

-- Empêche un utilisateur de se donner un rôle (pêcheur vérifié, admin…) ou de modifier un étal sensible
create or replace function proteger_profil() returns trigger
language plpgsql set search_path = public as $$  -- pas « security definer » : on doit savoir QUI modifie
begin
  if current_user not in ('authenticated', 'anon') or est_admin() then return new; end if;
  if tg_op = 'INSERT' then
    if new.role not in ('client', 'pro', 'pecheur') then raise exception 'Rôle non autorisé'; end if;
  elsif new.role is distinct from old.role then
    -- passage client <-> pro <-> pêcheur à l'inscription seulement ; jamais chauffeur / admin
    if new.role not in ('client', 'pro', 'pecheur') or old.role in ('chauffeur', 'admin') then raise exception 'Rôle non autorisé'; end if;
  end if;
  return new;
end $$;
drop trigger if exists profils_proteger on profils;
create trigger profils_proteger before insert or update on profils for each row execute function proteger_profil();

create or replace function proteger_etal() returns trigger
language plpgsql set search_path = public as $$  -- pas « security definer » : on doit savoir QUI modifie
begin
  if current_user not in ('authenticated', 'anon') or est_admin() then return new; end if;
  if tg_op = 'INSERT' then
    new.statut := 'en_attente'; new.stripe_pret := false; new.note := 5; new.avis := 0;
  else
    new.statut := old.statut; new.stripe_pret := old.stripe_pret; new.note := old.note; new.avis := old.avis; new.pecheur_id := old.pecheur_id;
  end if;
  return new;
end $$;
drop trigger if exists etals_proteger on etals;
create trigger etals_proteger before insert or update on etals for each row execute function proteger_etal();

create or replace function proteger_etal_prive() returns trigger
language plpgsql set search_path = public as $$  -- pas « security definer » : on doit savoir QUI modifie
begin
  if current_user not in ('authenticated', 'anon') or est_admin() then return new; end if;
  if tg_op = 'UPDATE' then new.stripe_compte := old.stripe_compte; else new.stripe_compte := null; end if;
  return new;
end $$;
drop trigger if exists etals_prive_proteger on etals_prive;
create trigger etals_prive_proteger before insert or update on etals_prive for each row execute function proteger_etal_prive();

-- Crée le profil automatiquement à l'inscription
create or replace function nouvel_utilisateur() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profils (id, telephone, prenom)
  values (new.id, new.phone, coalesce(new.raw_user_meta_data ->> 'given_name', split_part(coalesce(new.raw_user_meta_data ->> 'full_name', ''), ' ', 1), ''))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists auth_nouvel_utilisateur on auth.users;
create trigger auth_nouvel_utilisateur after insert on auth.users for each row execute function nouvel_utilisateur();

-- ───────────────────────── Fonctions appelées par le serveur (service_role uniquement) ─────────────────────────

-- Crée un bon et retire le stock en une seule opération (impossible de survendre)
create or replace function creer_bon(p_client uuid, p_etal uuid, p_lignes jsonb, p_creneau text, p_livraison boolean)
returns bons language plpgsql security definer set search_path = public as $$
declare
  r reglages; l jsonb; pr produits; prep jsonb; supp numeric; st numeric := 0; total_kg numeric := 0;
  lignes jsonb := '[]'; b bons; prof profils; pro_info pros; liv jsonb;
begin
  select * into r from reglages;
  select * into prof from profils where id = p_client;
  if prof is null then raise exception 'Client inconnu'; end if;
  if not exists (select 1 from etals where id = p_etal and statut = 'verifie' and stripe_pret) then raise exception 'Étal indisponible'; end if;
  if jsonb_array_length(p_lignes) = 0 then raise exception 'Panier vide'; end if;
  for l in select * from jsonb_array_elements(p_lignes) loop
    select * into pr from produits where id = (l ->> 'produitId')::uuid and etal_id = p_etal for update;
    if pr is null then raise exception 'Produit introuvable'; end if;
    if (l ->> 'kg')::numeric <= 0 or (l ->> 'kg')::numeric > pr.dispo_kg then raise exception 'Plus assez de % (reste % kg)', pr.espece, pr.dispo_kg; end if;
    select e into prep from jsonb_array_elements(pr.preparations) e where e ->> 'nom' = l ->> 'preparation';
    if prep is null then prep := pr.preparations -> 0; end if;
    supp := coalesce((prep ->> 'supplementKg')::numeric, 0);
    update produits set dispo_kg = round(dispo_kg - (l ->> 'kg')::numeric, 1) where id = pr.id;
    st := st + (l ->> 'kg')::numeric * (pr.prix_kg + supp);
    total_kg := total_kg + (l ->> 'kg')::numeric;
    lignes := lignes || jsonb_build_object('produitId', pr.id, 'espece', pr.espece, 'kg', (l ->> 'kg')::numeric, 'prixKg', pr.prix_kg, 'preparation', prep ->> 'nom', 'supplementKg', supp);
  end loop;
  select * into pro_info from pros where profil_id = p_client;
  if p_livraison and pro_info is not null and total_kg >= r.livraison_min_kg then
    liv := jsonb_build_object('adresse', coalesce(pro_info.adresse, pro_info.raison || ', ' || pro_info.commune), 'frais', r.frais_livraison);
  end if;
  insert into bons (etal_id, client_id, client_prenom, pro, livraison, lignes, creneau, montant_bloque)
  values (p_etal, p_client, coalesce(nullif(prof.prenom, ''), 'Client'),
          case when pro_info is null then null else jsonb_build_object('raison', pro_info.raison, 'type', pro_info.type, 'siret', pro_info.siret, 'commune', pro_info.commune, 'adresse', pro_info.adresse) end,
          liv, lignes, case when liv is null then p_creneau else 'Livraison ' || lower(p_creneau) end,
          round(st * (1 + r.marge_empreinte) + r.frais_service, 2) + coalesce((liv ->> 'frais')::numeric, 0))
  returning * into b;
  return b;
end $$;

-- Annule un bon non payé (paiement abandonné) et remet le poisson en vente
create or replace function annuler_bon(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare b bons; l jsonb;
begin
  select * into b from bons where code = p_code for update;
  if b is null or b.statut not in ('en_attente_paiement', 'reserve') then return; end if;
  for l in select * from jsonb_array_elements(b.lignes) loop
    update produits set dispo_kg = dispo_kg + (l ->> 'kg')::numeric where id = (l ->> 'produitId')::uuid;
  end loop;
  update bons set statut = 'annule' where id = b.id;
end $$;

-- QR du bon : seul son client peut lire la signature
create or replace function mon_qr(p_code text) returns text
language sql stable security definer set search_path = public as $$
  select signature from bons where code = p_code and client_id = auth.uid() and statut in ('reserve', 'en_livraison')
$$;

-- Effacement / anonymisation d'un compte (appelé par la fonction serveur supprimer-compte)
-- Les bons payés sont gardés pour la comptabilité (10 ans) mais détachés de la personne.
create or replace function anonymiser_compte(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update bons set client_id = null, client_prenom = 'Compte supprimé' where client_id = p_id;
  update messages set auteur_id = null where auteur_id = p_id;
  insert into journal (qui, quoi) values (p_id, 'compte supprimé');
end $$;

revoke all on function creer_bon(uuid, uuid, jsonb, text, boolean) from public, anon, authenticated;
revoke all on function annuler_bon(text) from public, anon, authenticated;
revoke all on function anonymiser_compte(uuid) from public, anon, authenticated;
revoke all on function effacer_positions_expirees() from public, anon, authenticated;

-- ───────────────────────── Règles d'accès (RLS) ─────────────────────────
alter table reglages enable row level security;
alter table profils enable row level security;
alter table pros enable row level security;
alter table etals enable row level security;
alter table etals_prive enable row level security;
alter table produits enable row level security;
alter table fermetures enable row level security;
alter table bons enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table demandes enable row level security;
alter table jetons_push enable row level security;
alter table suivis enable row level security;
alter table envois_sms enable row level security;   -- aucune règle : réservé au serveur
alter table journal enable row level security;      -- lecture admin seulement

-- Réglages et fermetures : lisibles par tous, modifiables par l'admin (2FA)
drop policy if exists reglages_lire on reglages;
create policy reglages_lire on reglages for select using (true);
drop policy if exists reglages_admin on reglages;
create policy reglages_admin on reglages for update using (est_admin());
drop policy if exists fermetures_lire on fermetures;
create policy fermetures_lire on fermetures for select using (true);
drop policy if exists fermetures_admin on fermetures;
create policy fermetures_admin on fermetures for all using (est_admin()) with check (est_admin());

-- Profils : chacun voit et modifie le sien
drop policy if exists profils_soi on profils;
create policy profils_soi on profils for select using (id = auth.uid() or est_admin());
drop policy if exists profils_maj on profils;
create policy profils_maj on profils for update using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists profils_creer on profils;
create policy profils_creer on profils for insert with check (id = auth.uid());

-- Pros : SIRET et adresse visibles seulement par le pro lui-même (et l'admin)
drop policy if exists pros_soi on pros;
create policy pros_soi on pros for all using (profil_id = auth.uid() or est_admin()) with check (profil_id = auth.uid() or est_admin());

-- Étals : vitrine publique (vérifiés seulement), le pêcheur gère le sien
drop policy if exists etals_lire on etals;
create policy etals_lire on etals for select using ((statut = 'verifie' and stripe_pret) or pecheur_id = auth.uid() or est_admin());
drop policy if exists etals_creer on etals;
create policy etals_creer on etals for insert with check (pecheur_id = auth.uid() and mon_role() = 'pecheur');
drop policy if exists etals_maj on etals;
create policy etals_maj on etals for update using (pecheur_id = auth.uid() or est_admin());

-- Adresse exacte : le pêcheur, l'admin, ou un client avec un bon payé chez lui
drop policy if exists etals_prive_lire on etals_prive;
create policy etals_prive_lire on etals_prive for select using (etal_id = mon_etal() or a_bon_paye(etal_id) or est_admin());
drop policy if exists etals_prive_ecrire on etals_prive;
create policy etals_prive_ecrire on etals_prive for insert with check (etal_id = mon_etal());
drop policy if exists etals_prive_maj on etals_prive;
create policy etals_prive_maj on etals_prive for update using (etal_id = mon_etal() or est_admin());
-- l'identifiant Stripe n'est jamais lu depuis l'appli
revoke select (stripe_compte) on etals_prive from anon, authenticated;

-- Produits : lisibles par tous sur les étals visibles ; le pêcheur gère les siens
drop policy if exists produits_lire on produits;
create policy produits_lire on produits for select using (exists (select 1 from etals e where e.id = etal_id));
drop policy if exists produits_pecheur on produits;
create policy produits_pecheur on produits for all using (etal_id = mon_etal()) with check (etal_id = mon_etal());

-- Bons : le client voit les siens, le pêcheur ceux de son étal, le chauffeur ceux qu'il livre.
-- Aucune écriture depuis l'appli : tout passe par les fonctions serveur.
drop policy if exists bons_lire on bons;
create policy bons_lire on bons for select using (
  client_id = auth.uid() or etal_id = mon_etal() or chauffeur_id = auth.uid() or est_admin()
);
revoke select (signature, stripe_session, stripe_paiement) on bons from anon, authenticated;

-- Conversations et messages : seulement les deux participants
drop policy if exists conv_lire on conversations;
create policy conv_lire on conversations for select using (client_id = auth.uid() or etal_id = mon_etal() or est_admin());
drop policy if exists conv_lu on conversations;
create policy conv_lu on conversations for update using (client_id = auth.uid() or etal_id = mon_etal());

drop policy if exists messages_lire on messages;
create policy messages_lire on messages for select using (
  exists (select 1 from conversations c where c.id = conversation_id and (c.client_id = auth.uid() or c.etal_id = mon_etal()))
  or est_admin()
);
drop policy if exists messages_ecrire on messages;
create policy messages_ecrire on messages for insert with check (
  auteur_id = auth.uid() and exists (
    select 1 from conversations c where c.id = conversation_id and (
      (auteur = 'client' and c.client_id = auth.uid() and position is null) or
      (auteur = 'pecheur' and c.etal_id = mon_etal())
    )
  )
);

-- Demandes des pros : le pro gère les siennes ; les pêcheurs vérifiés voient celles qui sont ouvertes
drop policy if exists demandes_pro on demandes;
create policy demandes_pro on demandes for all using (pro_id = auth.uid()) with check (pro_id = auth.uid() and mon_role() = 'pro');
drop policy if exists demandes_pecheurs on demandes;
create policy demandes_pecheurs on demandes for select using (
  (statut = 'ouverte' and exists (select 1 from etals e where e.pecheur_id = auth.uid() and e.statut = 'verifie'))
  or etal_id = mon_etal() or est_admin()
);

-- Notifications
drop policy if exists jetons_soi on jetons_push;
create policy jetons_soi on jetons_push for all using (profil_id = auth.uid()) with check (profil_id = auth.uid());
drop policy if exists suivis_soi on suivis;
create policy suivis_soi on suivis for all using (profil_id = auth.uid()) with check (profil_id = auth.uid());

drop policy if exists journal_admin on journal;
create policy journal_admin on journal for select using (est_admin());

-- Droits de base (Supabase les donne déjà ; rappelés ici pour être explicites)
grant usage on schema public to anon, authenticated;
grant select on reglages, fermetures, etals, produits to anon, authenticated;
grant select, insert, update on profils, pros, etals, etals_prive, produits, conversations, messages, demandes, jetons_push, suivis to authenticated;
grant delete on produits, demandes, jetons_push, suivis, pros to authenticated;
grant select on bons, journal to authenticated;
grant update (frais_service, commission_pct, marge_empreinte, livraison_min_kg, frais_livraison, tva_produits_mer, delai_position_min) on reglages to authenticated;
grant insert, update, delete on fermetures to authenticated;
grant usage on all sequences in schema public to authenticated;
-- re-retire les colonnes secrètes (le grant ci-dessus les avait rouvertes)
revoke select on bons from anon, authenticated;
grant select (id, code, etal_id, client_id, client_prenom, pro, livraison, chauffeur_id, lignes, creneau, statut, montant_bloque, montant_paye, commission, cree_le, paye_le, retire_le) on bons to authenticated;
revoke select on etals_prive from anon, authenticated;
-- conversations : seuls les indicateurs « lu » sont modifiables depuis l'appli
revoke update on conversations from anon, authenticated;
grant update (lu_client, lu_pecheur) on conversations to authenticated;
-- bons : jamais modifiés depuis l'appli (fonctions serveur uniquement)
revoke insert, update, delete on bons from anon, authenticated;
revoke all on envois_sms, journal from anon;
revoke insert, update, delete on envois_sms, journal from authenticated;
grant select (etal_id, lieu, precision, immatriculation) on etals_prive to authenticated;
grant execute on function mon_qr(text), mon_role(), est_admin(), mon_etal(), a_bon_paye(uuid) to authenticated;

-- Temps réel : l'appli est prévenue des changements (nouveaux messages, bons, arrivages)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table messages, conversations, bons, produits, demandes;
    exception when duplicate_object then null; end;
  end if;
end $$;
