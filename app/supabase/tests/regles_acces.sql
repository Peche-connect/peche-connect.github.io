-- Tests des règles d'accès (RLS). Lancés en local sur Postgres avec une imitation de Supabase.
-- Chaque ligne « OK » ou « ÉCHEC » s'affiche ; le script s'arrête au premier échec.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create or replace function pg_temp.verif(ok boolean, nom text) returns void language plpgsql as $$
begin
  if ok then raise notice 'OK      %', nom; else raise exception 'ÉCHEC   %', nom; end if;
end $$;
create or replace function pg_temp.qui(id uuid, aal text default 'aal1') returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', id, 'role', 'authenticated', 'aal', aal)::text, false);
$$;

-- ── Données de départ (en tant que serveur) ──
insert into auth.users (id, phone) values
  ('00000000-0000-0000-0000-00000000000a', '596696000001'), -- pêcheur
  ('00000000-0000-0000-0000-00000000000b', '596696000002'), -- client avec bon
  ('00000000-0000-0000-0000-00000000000c', '596696000003'), -- autre client
  ('00000000-0000-0000-0000-00000000000d', '596696000004'), -- pro
  ('00000000-0000-0000-0000-00000000000e', '596696000005'); -- admin
update profils set role = 'pecheur', prenom = 'Jean-Marc' where id = '00000000-0000-0000-0000-00000000000a';
update profils set prenom = 'Sophie' where id = '00000000-0000-0000-0000-00000000000b';
update profils set prenom = 'Marc' where id = '00000000-0000-0000-0000-00000000000c';
update profils set role = 'pro', prenom = 'Arlette' where id = '00000000-0000-0000-0000-00000000000d';
update profils set role = 'admin' where id = '00000000-0000-0000-0000-00000000000e';
insert into pros values ('00000000-0000-0000-0000-00000000000d', 'Chez Tante Arlette', 'Restaurant', '12345678900012', 'Le Robert', '12 rue du Port');
insert into etals (id, pecheur_id, prenom, port, bateau, statut, stripe_pret) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Jean-Marc', 'Le Robert', 'Ti Moun', 'verifie', true);
insert into etals_prive values ('10000000-0000-0000-0000-000000000001', 'Débarcadère du Robert', 'à gauche de la cale', 'MQ 123456', 'acct_secret');
insert into produits (id, etal_id, espece, prix_kg, dispo_kg, preparations) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Thon jaune', 14, 10, '[{"nom":"Entier","supplementKg":0},{"nom":"En tranches","supplementKg":2}]');
insert into fermetures (espece, debut, fin, motif) values ('Lambi', current_date - 1, current_date + 1, 'Période de fermeture (test)');
select pg_temp.verif((select count(*) from fermetures where annuelle) = 2, 'fermetures annuelles lambi et langouste pré-remplies');

-- Réservation créée par le serveur
select pg_temp.verif((select montant_bloque from creer_bon('00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001',
  '[{"produitId":"20000000-0000-0000-0000-000000000001","kg":1.5,"preparation":"En tranches"}]', 'Avant 10 h', false)) = 27.30,
  'creer_bon : montant bloqué = 1,5 × 16 × 1,10 + 0,90 = 27,30 €');
select pg_temp.verif((select dispo_kg from produits where id = '20000000-0000-0000-0000-000000000001') = 8.5, 'creer_bon : stock retiré (10 → 8,5 kg)');
do $$ begin
  perform creer_bon('00000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-000000000001',
    '[{"produitId":"20000000-0000-0000-0000-000000000001","kg":50,"preparation":"Entier"}]', 'Avant 10 h', false);
  raise exception 'ÉCHEC   survente acceptée';
exception when others then
  if sqlerrm like 'ÉCHEC%' then raise; end if;
  raise notice 'OK      creer_bon : survente refusée (%)', sqlerrm;
end $$;
update bons set statut = 'reserve', signature = 'sig-secrete', paye_le = now() where client_id = '00000000-0000-0000-0000-00000000000b';
insert into conversations (id, etal_id, client_id, client_prenom, bon_code)
  select '30000000-0000-0000-0000-000000000001', etal_id, client_id, client_prenom, code from bons where client_id = '00000000-0000-0000-0000-00000000000b';

-- ── Visiteur non connecté ──
set role anon;
select set_config('request.jwt.claims', '{}', false);
select pg_temp.verif((select count(*) from etals) = 1, 'visiteur : voit la vitrine des étals vérifiés');
select pg_temp.verif((select count(*) from produits) = 1, 'visiteur : voit les arrivages');
do $$ begin perform signature from bons; raise exception 'ÉCHEC   visiteur lit les signatures';
exception when insufficient_privilege then raise notice 'OK      visiteur : bons et signatures inaccessibles'; end $$;
select pg_temp.verif((select count(*) from profils) = 0 and (select count(*) from pros) = 0 and (select count(*) from messages) = 0, 'visiteur : aucun profil, pro ni message lisible');
do $$ begin perform * from etals_prive; raise exception 'ÉCHEC   visiteur lit etals_prive';
exception when insufficient_privilege then raise notice 'OK      visiteur : adresse exacte inaccessible'; end $$;
reset role;

-- ── Client sans bon ──
set role authenticated; select pg_temp.qui('00000000-0000-0000-0000-00000000000c');
select pg_temp.verif((select count(*) from etals_prive) = 0, 'client sans bon : adresse exacte cachée');
select pg_temp.verif((select count(*) from bons) = 0, 'client sans bon : ne voit pas les bons des autres');
select pg_temp.verif((select count(*) from conversations) = 0, 'client sans bon : ne voit pas les conversations des autres');
select pg_temp.verif((select count(*) from messages) = 0, 'client sans bon : ne lit pas les messages des autres');
select pg_temp.verif((select count(*) from pros) = 0, 'client : SIRET et adresse des pros protégés');
select pg_temp.verif((select count(*) from profils) = 1, 'client : ne voit que son propre profil (numéros protégés)');
select pg_temp.verif(mon_qr((select code from bons limit 1)) is null, 'client sans bon : pas de QR des autres');
do $$ begin insert into bons (etal_id, client_id, lignes, creneau, montant_bloque) values ('10000000-0000-0000-0000-000000000001', auth.uid(), '[]', 'x', 1);
  raise exception 'ÉCHEC   client crée un bon sans payer';
exception when insufficient_privilege then raise notice 'OK      client : impossible de créer un bon sans passer par le paiement'; end $$;
do $$ begin perform creer_bon(auth.uid(), '10000000-0000-0000-0000-000000000001', '[]', 'x', false); raise exception 'ÉCHEC   creer_bon appelable';
exception when insufficient_privilege then raise notice 'OK      client : fonctions serveur non appelables'; end $$;
do $$ begin update profils set role = 'admin' where id = auth.uid(); raise exception 'ÉCHEC   rôle admin auto-attribué';
exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'OK      client : ne peut pas se donner le rôle admin'; end $$;
do $$ begin update profils set role = 'chauffeur' where id = auth.uid(); raise exception 'ÉCHEC   rôle chauffeur auto-attribué';
exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'OK      client : ne peut pas se donner le rôle chauffeur'; end $$;
update produits set prix_kg = 1 where id = '20000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.verif((select prix_kg from produits where id = '20000000-0000-0000-0000-000000000001') = 14, 'client : ne peut pas changer les prix d''un pêcheur');

-- ── Client avec bon payé ──
set role authenticated; select pg_temp.qui('00000000-0000-0000-0000-00000000000b');
select pg_temp.verif((select lieu from etals_prive) = 'Débarcadère du Robert', 'client avec bon payé : adresse exacte débloquée');
do $$ begin perform stripe_compte from etals_prive; raise exception 'ÉCHEC   compte Stripe lisible';
exception when insufficient_privilege then raise notice 'OK      client : identifiant Stripe du pêcheur illisible'; end $$;
select pg_temp.verif((select count(*) from bons) = 1, 'client : voit son bon');
do $$ begin perform signature from bons; raise exception 'ÉCHEC   signature lisible directement';
exception when insufficient_privilege then raise notice 'OK      client : signature du QR non lisible en direct'; end $$;
select pg_temp.verif(mon_qr((select code from bons limit 1)) = 'sig-secrete', 'client : récupère le QR signé de son bon');
insert into messages (conversation_id, auteur_id, auteur, texte) values ('30000000-0000-0000-0000-000000000001', auth.uid(), 'client', 'Appelez-moi au 0696 12 34 56 svp');
select pg_temp.verif((select texte from messages order by cree_le desc limit 1) not like '%0696%', 'messagerie : numéro de téléphone masqué');
do $$ begin update conversations set etal_id = '10000000-0000-0000-0000-000000000002' where client_id = auth.uid();
  raise exception 'ÉCHEC   conversation déplacée vers un autre pêcheur';
exception when insufficient_privilege then raise notice 'OK      messagerie : impossible de rediriger une conversation vers un autre pêcheur'; end $$;
update conversations set lu_client = true where client_id = auth.uid();
do $$ begin insert into messages (conversation_id, auteur_id, auteur, texte) values ('30000000-0000-0000-0000-000000000001', auth.uid(), 'pecheur', 'faux');
  raise exception 'ÉCHEC   client se fait passer pour le pêcheur';
exception when insufficient_privilege then raise notice 'OK      messagerie : un client ne peut pas écrire au nom du pêcheur'; end $$;
reset role;

-- ── Pêcheur ──
set role authenticated; select pg_temp.qui('00000000-0000-0000-0000-00000000000a');
select pg_temp.verif((select count(*) from bons) = 1, 'pêcheur : voit les bons de son étal');
select pg_temp.verif((select count(*) from pros) = 0, 'pêcheur : ne voit pas le SIRET / l''adresse des pros');
select pg_temp.verif((select count(*) from profils) = 1, 'pêcheur : ne voit pas le numéro des clients');
select pg_temp.verif((select lieu from etals_prive) is not null, 'pêcheur : voit et gère son adresse');
update etals set statut = 'verifie', stripe_pret = true, note = 5 where id = '10000000-0000-0000-0000-000000000001';
insert into messages (conversation_id, auteur_id, auteur, position) values ('30000000-0000-0000-0000-000000000001', auth.uid(), 'pecheur', '{"libelle":"En direct","lat":14.67,"lon":-60.94}');
select pg_temp.verif((select position_expire_le from messages where position is not null) < now() + interval '13 hours', 'position : date d''effacement posée automatiquement');
update produits set prix_kg = 15 where id = '20000000-0000-0000-0000-000000000001';
select pg_temp.verif((select prix_kg from produits where id = '20000000-0000-0000-0000-000000000001') = 15, 'pêcheur : modifie ses prix');
do $$ begin insert into produits (etal_id, espece, prix_kg, dispo_kg) values (mon_etal(), 'Lambi', 20, 5);
  raise exception 'ÉCHEC   espèce fermée mise en vente';
exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'OK      fermeture : lambi refusé pendant la période fermée (%)', sqlerrm; end $$;
reset role;
update messages set position_expire_le = now() - interval '1 minute' where position is not null;
select pg_temp.verif(effacer_positions_expirees() = 1, 'position : tâche d''effacement lancée');
select pg_temp.verif(not exists (select 1 from messages where position is not null), 'position : effacée après expiration');

-- ── Pêcheur pas encore vérifié ──
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000f');
set role authenticated; select pg_temp.qui('00000000-0000-0000-0000-00000000000f');
update profils set role = 'pecheur', prenom = 'Nouveau' where id = auth.uid();
insert into etals (id, pecheur_id, prenom, port, statut, stripe_pret) values ('10000000-0000-0000-0000-000000000002', auth.uid(), 'Nouveau', 'Trinité', 'verifie', true);
select pg_temp.verif((select statut::text || stripe_pret::text from etals where id = '10000000-0000-0000-0000-000000000002') = 'en_attentefalse', 'nouveau pêcheur : ne peut pas se déclarer vérifié');
do $$ begin insert into produits (etal_id, espece, prix_kg, dispo_kg) values (mon_etal(), 'Thon jaune', 12, 5);
  raise exception 'ÉCHEC   pêcheur non vérifié publie';
exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'OK      nouveau pêcheur : publication bloquée avant vérification'; end $$;
reset role;
set role anon; select set_config('request.jwt.claims', '{}', false);
select pg_temp.verif((select count(*) from etals) = 1, 'visiteur : un étal non vérifié n''apparaît pas');
reset role;

-- ── Pro ──
set role authenticated; select pg_temp.qui('00000000-0000-0000-0000-00000000000d');
select pg_temp.verif((select siret from pros) = '12345678900012', 'pro : voit ses propres infos');
insert into demandes (pro_id, pro_raison, pro_type, pro_commune, espece, kg, prix_max_kg, pour) values (auth.uid(), 'Chez Tante Arlette', 'Restaurant', 'Le Robert', 'Thon jaune', 15, 13, 'Demain');
reset role;
set role authenticated; select pg_temp.qui('00000000-0000-0000-0000-00000000000a');
select pg_temp.verif((select count(*) from demandes) = 1, 'pêcheur vérifié : voit les besoins des pros');
reset role;
set role authenticated; select pg_temp.qui('00000000-0000-0000-0000-00000000000c');
select pg_temp.verif((select count(*) from demandes) = 0, 'client : ne voit pas les besoins des pros');
reset role;

-- ── Administration : double vérification obligatoire ──
set role authenticated; select pg_temp.qui('00000000-0000-0000-0000-00000000000e', 'aal1');
select pg_temp.verif((select count(*) from profils) = 1 and (select count(*) from pros) = 0, 'admin sans 2FA : aucun accès étendu');
select pg_temp.qui('00000000-0000-0000-0000-00000000000e', 'aal2');
select pg_temp.verif((select count(*) from profils) = 6 and (select count(*) from pros) = 1, 'admin avec 2FA : accès complet');
reset role;

-- ── Suppression de compte ──
select anonymiser_compte('00000000-0000-0000-0000-00000000000b');
delete from auth.users where id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.verif((select client_id is null and client_prenom = 'Compte supprimé' from bons limit 1), 'suppression : bon gardé pour la compta mais anonymisé');
select pg_temp.verif(not exists (select 1 from profils where id = '00000000-0000-0000-0000-00000000000b'), 'suppression : profil effacé');

select anonymiser_compte('00000000-0000-0000-0000-00000000000a');
delete from auth.users where id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.verif((select pecheur_id is null from etals where id = '10000000-0000-0000-0000-000000000001'), 'suppression pêcheur : étal détaché, ventes passées gardées');
select annuler_bon((select code from bons limit 1));
select pg_temp.verif((select dispo_kg from produits where id = '20000000-0000-0000-0000-000000000001') = 10, 'annulation : poisson remis en vente');
\echo 'Tous les tests sont passés.'
