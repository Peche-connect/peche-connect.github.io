// Comptes : choix du rôle à la première connexion, compte de paiement du pêcheur (Stripe Connect),
// jetons de notification, export et suppression des données (RGPD), droits de connexion tenus à jour.
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { alerte, APPEL, connecte, db, erreur, FieldValue, journal, limiter, REGION, site, stripe, STRIPE_SECRET_KEY } from './commun';
import { masquerNumeros, nomPropre, normaliser, portConnu, TYPES_PRO } from './regles';
import { annulerBon, expirerSession } from './reservations';
import { champsSiret, siretValide, verifierSiret } from './sirene';

const exiger = <T,>(v: T | null, message: string): T => { if (v === null) throw erreur('invalid-argument', message); return v; };

// Première connexion (ou changement) : « Particulier », « Professionnel » ou « Pêcheur »
export const choisirRole = onCall(APPEL, async (req) => {
  const uid = connecte(req);
  await limiter(uid, 'role', 10);
  const d = (req.data ?? {}) as { role: string; prenom: string; commune?: string; pro?: Record<string, string>; pecheur?: Record<string, string> };
  if (!['client', 'pro', 'pecheur'].includes(d.role)) throw erreur('invalid-argument', 'Rôle inconnu.');
  const prenom = exiger(nomPropre(d.prenom, 1, 40), 'Prénom invalide : des lettres, sans numéro de téléphone.');
  const existant = (await db.doc('profils/' + uid).get()).data();
  const etalRef = db.doc('etals/' + uid); // un seul étal par pêcheur, même avec deux appels simultanés
  const etalExistant = (await etalRef.get()).data();
  if (existant?.role === 'pecheur' && d.role !== 'pecheur' && etalExistant?.statut === 'verifie') throw erreur('failed-precondition', 'Ce compte est un compte pêcheur vérifié.');
  const profil = { role: d.role, prenom, commune: portConnu(d.commune), suivis: existant?.suivis ?? [], jetons: existant?.jetons ?? [],
    email: req.auth?.token.email ?? null, creeLe: existant?.creeLe ?? FieldValue.serverTimestamp() };

  if (d.role === 'pro') {
    const p = d.pro ?? {};
    const siret = String(p.siret ?? '').replace(/\D/g, '');
    if (siret.length !== 14) throw erreur('invalid-argument', 'Le SIRET doit avoir 14 chiffres.');
    if (!siretValide(siret)) throw erreur('invalid-argument', 'Ce numéro SIRET n’existe pas : vérifiez les chiffres.');
    // contrôle auprès du répertoire des entreprises (si injoignable : refait plus tard par les tâches automatiques)
    const v = await verifierSiret(siret);
    if (v.statut === 'ferme') throw erreur('failed-precondition', 'Cet établissement est fermé selon le répertoire des entreprises (INSEE).');
    if (!TYPES_PRO.includes(p.type)) throw erreur('invalid-argument', 'Type d’établissement inconnu.');
    const raison = exiger(nomPropre(p.raison, 2, 120), 'Raison sociale invalide.');
    const commune = exiger(portConnu(p.commune) ?? nomPropre(p.commune, 2, 40), 'Commune invalide.');
    // l'adresse de livraison est montrée au pêcheur d'une commande livrée : jamais de numéro dedans
    const adresse = normaliser(p.adresse).slice(0, 200);
    await db.doc('pros/' + uid).set({ raison, type: p.type, siret, ...champsSiret(v), commune, adresse: adresse ? masquerNumeros(adresse).texte : null });
    profil.commune = portConnu(commune);
  } else if (existant?.role === 'pro') {
    await db.doc('pros/' + uid).delete(); // un ancien pro redevenu particulier perd la livraison et la facture
  }

  if (d.role === 'pecheur') {
    const p = d.pecheur ?? {};
    const port = exiger(portConnu(p.port), 'Port inconnu.');
    const bateau = exiger(nomPropre(p.bateau, 1, 60), 'Nom du bateau invalide.');
    const immatriculation = normaliser(p.immatriculation).toUpperCase();
    if (!/^[A-Z0-9 -]{5,20}$/.test(immatriculation)) throw erreur('invalid-argument', 'Immatriculation invalide.');
    // numéro d'identification du marin : vérifié à la main par l'équipe (pas de service public interrogeable),
    // gardé à part, jamais montré aux clients
    const numeroMarin = normaliser(p.numeroMarin).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[A-Z0-9]{4,20}$/.test(numeroMarin)) throw erreur('invalid-argument', 'Numéro de marin invalide.');
    const dossierRef = etalRef.collection('verification').doc('dossier');
    const aRevoir = await db.runTransaction(async (t) => {
      const e = (await t.get(etalRef)).data();
      const prive = e ? (await t.get(etalRef.collection('prive').doc('infos'))).data() : undefined;
      const dossier = e ? (await t.get(dossierRef)).data() : undefined;
      if (!e) {
        t.set(etalRef, { pecheurId: uid, prenom, port, bateau, statut: 'en_attente', stripePret: false, note: 5, avis: 0,
          photoUrl: null, debarqueLe: null, limiteRetrait: 12 * 60, produits: [], notifieLe: null, creeLe: FieldValue.serverTimestamp() });
        t.set(etalRef.collection('prive').doc('infos'), { lieu: 'Débarcadère de ' + port, precision: '', immatriculation });
        t.set(dossierRef, { numeroMarin, numeroVerifie: false, soumisLe: FieldValue.serverTimestamp() });
        return false;
      }
      const change = e.port !== port || e.bateau !== bateau || prive?.immatriculation !== immatriculation || dossier?.numeroMarin !== numeroMarin;
      // un pêcheur vérifié qui change de bateau, d'immatriculation, de port ou de numéro de marin repasse en vérification
      // un dossier refusé puis corrigé repart en vérification (un compte suspendu, non : décision de l'équipe)
      const repasse = (change && e.statut === 'verifie') || e.statut === 'refuse';
      t.update(etalRef, { prenom, port, bateau, ...(repasse ? { statut: 'en_attente', motifStatut: null } : {}) });
      t.set(etalRef.collection('prive').doc('infos'), { immatriculation }, { merge: true });
      if (dossier?.numeroMarin !== numeroMarin) t.set(dossierRef, { numeroMarin, numeroVerifie: false, soumisLe: FieldValue.serverTimestamp() });
      return change && e.statut === 'verifie';
    });
    if (!etalExistant) await journal(uid, 'inscription pêcheur à vérifier', { etalId: uid, port, bateau, immatriculation, numeroMarin });
    else if (aRevoir) await alerte(uid, 'pêcheur vérifié : bateau, port ou immatriculation modifié, à revérifier', { port, bateau, immatriculation });
    profil.commune = port;
  }
  await db.doc('profils/' + uid).set(profil);
  const etal = d.role === 'pecheur' ? (await etalRef.get()).data() : undefined;
  await getAuth().setCustomUserClaims(uid, { role: d.role, ...(etal ? { etalId: uid, verifie: etal.statut === 'verifie' && etal.stripePret === true } : {}) });
  return { role: d.role, etalId: etal ? uid : null };
});

// Quand l'administration vérifie un pêcheur (console Firebase : statut = « verifie ») ou que Stripe
// valide son compte de paiement, ses droits de connexion sont mis à jour automatiquement ;
// un pêcheur suspendu est déconnecté tout de suite (ses anciens droits ne servent plus)
export const etalModifie = onDocumentWritten({ region: REGION, document: 'etals/{etal}' }, async (ev) => {
  const avant = ev.data?.before.data(); const apres = ev.data?.after.data();
  if (!apres?.pecheurId) return;
  if (avant && avant.statut === apres.statut && avant.stripePret === apres.stripePret) return;
  const verifie = apres.statut === 'verifie' && apres.stripePret === true;
  try {
    await getAuth().setCustomUserClaims(apres.pecheurId, { role: 'pecheur', etalId: ev.params.etal, verifie });
    if (!verifie && avant?.statut === 'verifie') await getAuth().revokeRefreshTokens(apres.pecheurId);
  } catch (e) { console.error('droits pêcheur', e); }
});

// Jeton de notification du téléphone (format Expo contrôlé, 10 appareils au plus)
export const enregistrerJeton = onCall(APPEL, async (req) => {
  const uid = connecte(req);
  await limiter(uid, 'jeton', 20);
  const jeton = String((req.data as { jeton?: string })?.jeton ?? '');
  if (!/^ExponentPushToken\[[A-Za-z0-9_-]{10,100}\]$/.test(jeton)) throw erreur('invalid-argument', 'Jeton invalide.');
  const ref = db.doc('profils/' + uid);
  await db.runTransaction(async (t) => {
    const p = (await t.get(ref)).data();
    if (!p) throw erreur('failed-precondition', 'Terminez votre inscription.');
    const jetons = [...new Set([...((p.jetons ?? []) as string[]).filter((j) => j !== jeton), jeton])].slice(-10);
    t.update(ref, { jetons });
  });
  return { ok: true };
});

// Compte de paiement du pêcheur (Stripe Connect Express) : création, lien d'inscription, état
export const comptePaiement = onCall({ ...APPEL, secrets: [STRIPE_SECRET_KEY] }, async (req) => {
  const uid = connecte(req);
  await limiter(uid, 'paiement', 20);
  const action = (req.data as { action?: string })?.action;
  if (action !== 'lien' && action !== 'etat') throw erreur('invalid-argument', 'Action inconnue.');
  const etalRef = db.doc('etals/' + uid);
  const etal = (await etalRef.get()).data();
  if (!etal) throw erreur('not-found', 'Inscrivez-vous d’abord comme pêcheur.');
  if (etal.statut !== 'verifie') throw erreur('failed-precondition', 'Votre inscription de pêcheur professionnel est en cours de vérification.');
  const refCompte = db.doc('comptesStripe/' + uid);
  let compte = (await refCompte.get()).data()?.compte as string | undefined;
  const s = stripe();
  if (action === 'etat') {
    if (!compte) return { pret: false };
    const a = await s.accounts.retrieve(compte);
    const pret = !!(a.charges_enabled && a.payouts_enabled);
    await etalRef.update({ stripePret: pret });
    return { pret };
  }
  if (!compte) {
    const a = await s.accounts.create({
      type: 'express', country: 'FR', email: req.auth?.token.email ?? undefined, business_type: 'individual',
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      business_profile: { product_description: 'Vente directe de poisson frais (pêcheur professionnel, Martinique)' },
      metadata: { etalId: uid, uid }, settings: { payouts: { schedule: { interval: 'daily' } } },
    });
    compte = a.id;
    await refCompte.set({ compte });
  }
  const lien = await s.accountLinks.create({ account: compte, type: 'account_onboarding',
    refresh_url: site() + '/inscription-pecheur?stripe=relance', return_url: site() + '/inscription-pecheur?stripe=retour' });
  return { url: lien.url };
});

const messagesDe = async (c: FirebaseFirestore.QueryDocumentSnapshot) => ({
  bon: c.data().bonCode, messages: (await c.ref.collection('messages').orderBy('creeLe').get()).docs.map((m) => {
    const x = m.data(); return { auteur: x.auteur, texte: x.texte ?? null, vocal: x.audio ? x.audio.duree + ' s' : null, le: x.creeLe?.toDate?.() ?? null };
  }),
});

// « Mon compte » : télécharger mes données / supprimer mon compte
export const compte = onCall({ ...APPEL, secrets: [STRIPE_SECRET_KEY] }, async (req) => {
  const uid = connecte(req);
  const action = (req.data as { action?: string })?.action;
  if (action !== 'exporter' && action !== 'supprimer') throw erreur('invalid-argument', 'Action inconnue.');
  await limiter(uid, 'compte-' + action, action === 'exporter' ? 5 : 3);
  const profil = await db.doc('profils/' + uid).get();
  const etalSnap = await db.doc('etals/' + uid).get();
  const etal = etalSnap.exists && etalSnap.data()?.pecheurId === uid ? etalSnap : null;

  if (action === 'exporter') {
    const [pro, bons, convs, demandes, prive, bonsEtal, convsEtal, facturesAchat, facturesVente] = await Promise.all([
      db.doc('pros/' + uid).get(), db.collection('bons').where('clientId', '==', uid).get(),
      db.collection('conversations').where('clientId', '==', uid).get(), db.collection('demandes').where('proId', '==', uid).get(),
      etal ? etal.ref.collection('prive').doc('infos').get() : null,
      etal ? db.collection('bons').where('pecheurId', '==', uid).get() : null,
      etal ? db.collection('conversations').where('pecheurId', '==', uid).get() : null,
      db.collection('factures').where('proId', '==', uid).get(), db.collection('factures').where('pecheurId', '==', uid).get(),
    ]);
    return JSON.parse(JSON.stringify({
      exporte_le: new Date().toISOString(), compte: { id: uid, email: req.auth?.token.email ?? null },
      profil: profil.data() ?? null, professionnel: pro.data() ?? null,
      etal: etal ? { ...etal.data(), prive: prive?.data() ?? null, verification: (await etal.ref.collection('verification').doc('dossier').get()).data() ?? null } : null,
      reservations_avant_sortie: (await db.collection('precommandes').where('clientId', '==', uid).get()).docs.map((p) => p.data()),
      bons: bons.docs.map((b) => b.data()), conversations: await Promise.all(convs.docs.map(messagesDe)), besoins: demandes.docs.map((d) => d.data()),
      ventes: bonsEtal?.docs.map((b) => b.data()) ?? [], conversations_pecheur: convsEtal ? await Promise.all(convsEtal.docs.map(messagesDe)) : [],
      factures: [...facturesAchat.docs, ...facturesVente.docs].map((f) => f.data()),
    }));
  }

  // ───── suppression ─────
  if (etal) {
    const n = (await db.collection('bons').where('etalId', '==', etal.id).where('statut', 'in', ['reserve', 'en_livraison']).get()).size;
    if (n) throw erreur('failed-precondition', 'Vous avez encore ' + n + ' réservation(s) à honorer : clôturez-les avant de supprimer votre compte.');
  }
  const enCours = (await db.collection('bons').where('clientId', '==', uid).where('statut', 'in', ['reserve', 'en_livraison']).get()).size;
  if (enCours) throw erreur('failed-precondition', 'Vous avez une réservation en cours : retirez-la ou attendez son annulation avant de supprimer votre compte.');
  // paiements pas encore faits : pages de paiement fermées et poisson remis en vente
  const nonPayes = [...(await db.collection('bons').where('clientId', '==', uid).where('statut', '==', 'en_attente_paiement').get()).docs,
    ...(etal ? (await db.collection('bons').where('etalId', '==', etal.id).where('statut', '==', 'en_attente_paiement').get()).docs : [])];
  for (const b of nonPayes) { await expirerSession(b.id); await annulerBon(b.id, 'compte supprimé par son titulaire'); }
  await getAuth().revokeRefreshTokens(uid); // plus aucune action possible avec l'ancienne connexion

  // bons gardés 10 ans pour la comptabilité, mais détachés de la personne
  const lot = db.batch();
  const mesBons = (await db.collection('bons').where('clientId', '==', uid).get()).docs;
  mesBons.forEach((b) => lot.update(b.ref, { clientId: null, clientPrenom: 'Compte supprimé' }));
  // avis gardés (la note de l'étal reste juste) mais sans prénom
  for (const b of mesBons) {
    if (!b.data().avis) continue;
    const a = db.doc('avis/' + b.id); // l'avis a pu être retiré par l'équipe
    if ((await a.get()).exists) lot.update(a, { prenom: 'Ancien client' });
  }
  if (etal) (await db.collection('bons').where('pecheurId', '==', uid).get()).docs.forEach((b) => lot.update(b.ref, { pecheurId: null }));
  await lot.commit();
  // conversations (côté client et côté pêcheur) : messages et fichiers vocaux effacés
  const convs = [...(await db.collection('conversations').where('clientId', '==', uid).get()).docs,
    ...(etal ? (await db.collection('conversations').where('pecheurId', '==', uid).get()).docs : [])];
  for (const c of convs) {
    await getStorage().bucket().deleteFiles({ prefix: 'messages-audio/' + c.id + '/' }).catch(() => {});
    await db.recursiveDelete(c.ref);
  }
  // réservations avant sortie : celles en attente sont annulées, toutes détachées de la personne
  for (const p of (await db.collection('precommandes').where('clientId', '==', uid).get()).docs) {
    await p.ref.update({ clientId: null, clientPrenom: 'Compte supprimé', ...(p.data().statut === 'en_attente' ? { statut: 'annulee' } : {}) });
  }
  if (etal) await db.doc('sorties/' + etal.id).delete().catch(() => {});
  const demandes = await db.collection('demandes').where('proId', '==', uid).get();
  await Promise.all(demandes.docs.map((d) => (d.data().statut === 'ouverte' ? d.ref.update({ statut: 'annulee' }) : null)));
  if (etal) {
    await getStorage().bucket().deleteFiles({ prefix: 'arrivages/' + etal.id + '/' }).catch(() => {});
    await etal.ref.update({ statut: 'suspendu', prenom: 'Compte supprimé', bateau: '', photoUrl: null, produits: [], pecheurId: null });
    await etal.ref.collection('prive').doc('infos').set({ lieu: '', precision: '', immatriculation: '' });
    await etal.ref.collection('verification').doc('dossier').delete();
  }
  await db.doc('pros/' + uid).delete();
  await profil.ref.delete();
  await journal(uid, 'compte supprimé');
  await getAuth().deleteUser(uid);
  return { supprime: true };
});
