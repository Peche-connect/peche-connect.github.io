// Comptes : choix du rôle à la première connexion, compte de paiement du pêcheur (Stripe Connect),
// export et suppression des données (RGPD), droits de connexion tenus à jour.
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { connecte, db, erreur, FieldValue, journal, REGION, site, stripe, STRIPE_SECRET_KEY } from './commun';

const TYPES_PRO = ['Restaurant', 'Poissonnerie', 'Revendeur', 'Traiteur'];
const texte = (v: unknown, min: number, max: number, nom: string) => {
  const t = typeof v === 'string' ? v.trim() : '';
  if (t.length < min || t.length > max) throw erreur('invalid-argument', nom + ' invalide.');
  return t;
};

// Première connexion : « Particulier », « Professionnel » ou « Pêcheur »
export const choisirRole = onCall({ region: REGION }, async (req) => {
  const uid = connecte(req);
  const d = req.data as { role: string; prenom: string; commune?: string; pro?: Record<string, string>; pecheur?: Record<string, string> };
  if (!['client', 'pro', 'pecheur'].includes(d.role)) throw erreur('invalid-argument', 'Rôle inconnu.');
  const prenom = texte(d.prenom, 1, 40, 'Prénom');
  const existant = (await db.doc('profils/' + uid).get()).data();
  if (existant?.role === 'pecheur' && d.role !== 'pecheur') {
    const e = await db.collection('etals').where('pecheurId', '==', uid).limit(1).get();
    if (!e.empty && e.docs[0].data().statut === 'verifie') throw erreur('failed-precondition', 'Ce compte est un compte pêcheur vérifié.');
  }
  const profil = { role: d.role, prenom, commune: typeof d.commune === 'string' ? d.commune.slice(0, 40) : null,
    suivis: existant?.suivis ?? [], jetons: existant?.jetons ?? [], email: req.auth?.token.email ?? null,
    creeLe: existant?.creeLe ?? FieldValue.serverTimestamp() };
  let etalId: string | undefined;

  if (d.role === 'pro') {
    const p = d.pro ?? {};
    const siret = String(p.siret ?? '').replace(/\D/g, '');
    if (siret.length !== 14) throw erreur('invalid-argument', 'Le SIRET doit avoir 14 chiffres.');
    if (!TYPES_PRO.includes(p.type)) throw erreur('invalid-argument', 'Type d’établissement inconnu.');
    await db.doc('pros/' + uid).set({ raison: texte(p.raison, 2, 120, 'Raison sociale'), type: p.type, siret,
      commune: texte(p.commune, 2, 40, 'Commune'), adresse: typeof p.adresse === 'string' && p.adresse.trim() ? p.adresse.trim().slice(0, 200) : null });
    profil.commune = p.commune;
  }
  if (d.role === 'pecheur') {
    const p = d.pecheur ?? {};
    const port = texte(p.port, 2, 40, 'Port');
    const bateau = texte(p.bateau, 1, 60, 'Nom du bateau');
    const immatriculation = texte(p.immatriculation, 5, 20, 'Immatriculation').toUpperCase();
    const deja = await db.collection('etals').where('pecheurId', '==', uid).limit(1).get();
    const ref = deja.empty ? db.collection('etals').doc() : deja.docs[0].ref;
    etalId = ref.id;
    if (deja.empty) {
      await ref.set({ pecheurId: uid, prenom, port, bateau, statut: 'en_attente', stripePret: false, note: 5, avis: 0,
        photoUrl: null, debarqueLe: null, limiteRetrait: 12 * 60, produits: [], notifieLe: null, creeLe: FieldValue.serverTimestamp() });
      await ref.collection('prive').doc('infos').set({ lieu: 'Débarcadère de ' + port, precision: '', immatriculation });
      await journal(uid, 'inscription pêcheur à vérifier', { etalId, port, bateau, immatriculation });
    } else {
      await ref.update({ prenom, port, bateau });
      await ref.collection('prive').doc('infos').set({ immatriculation }, { merge: true });
    }
    profil.commune = port;
  }
  await db.doc('profils/' + uid).set(profil);
  const etal = etalId ? (await db.doc('etals/' + etalId).get()).data() : undefined;
  await getAuth().setCustomUserClaims(uid, { role: d.role, ...(etalId ? { etalId, verifie: etal?.statut === 'verifie' && etal?.stripePret === true } : {}) });
  return { role: d.role, etalId: etalId ?? null };
});

// Quand l'administration vérifie un pêcheur (console Firebase : statut = « verifie ») ou que Stripe
// valide son compte de paiement, ses droits de connexion sont mis à jour automatiquement
export const etalModifie = onDocumentWritten({ region: REGION, document: 'etals/{etal}' }, async (ev) => {
  const avant = ev.data?.before.data(); const apres = ev.data?.after.data();
  if (!apres?.pecheurId) return;
  if (avant && avant.statut === apres.statut && avant.stripePret === apres.stripePret) return;
  const verifie = apres.statut === 'verifie' && apres.stripePret === true;
  try { await getAuth().setCustomUserClaims(apres.pecheurId, { role: 'pecheur', etalId: ev.params.etal, verifie }); }
  catch (e) { console.error('droits pêcheur', e); }
});

// Compte de paiement du pêcheur (Stripe Connect Express) : création, lien d'inscription, état
export const comptePaiement = onCall({ region: REGION, secrets: [STRIPE_SECRET_KEY] }, async (req) => {
  const uid = connecte(req);
  const { action } = req.data as { action: 'lien' | 'etat' };
  const e = await db.collection('etals').where('pecheurId', '==', uid).limit(1).get();
  if (e.empty) throw erreur('not-found', 'Inscrivez-vous d’abord comme pêcheur.');
  const etal = e.docs[0];
  if (etal.data().statut !== 'verifie') throw erreur('failed-precondition', 'Votre inscription de pêcheur professionnel est en cours de vérification.');
  const refCompte = db.doc('comptesStripe/' + etal.id);
  let compte = (await refCompte.get()).data()?.compte as string | undefined;
  const s = stripe();
  if (action === 'etat') {
    if (!compte) return { pret: false };
    const a = await s.accounts.retrieve(compte);
    const pret = !!(a.charges_enabled && a.payouts_enabled);
    await etal.ref.update({ stripePret: pret });
    return { pret };
  }
  if (!compte) {
    const a = await s.accounts.create({
      type: 'express', country: 'FR', email: req.auth?.token.email ?? undefined, business_type: 'individual',
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      business_profile: { product_description: 'Vente directe de poisson frais (pêcheur professionnel, Martinique)' },
      metadata: { etalId: etal.id, uid }, settings: { payouts: { schedule: { interval: 'daily' } } },
    });
    compte = a.id;
    await refCompte.set({ compte });
  }
  const lien = await s.accountLinks.create({ account: compte, type: 'account_onboarding',
    refresh_url: site() + '/inscription-pecheur?stripe=relance', return_url: site() + '/inscription-pecheur?stripe=retour' });
  return { url: lien.url };
});

// « Mon compte » : télécharger mes données / supprimer mon compte
export const compte = onCall({ region: REGION }, async (req) => {
  const uid = connecte(req);
  const { action } = req.data as { action: 'exporter' | 'supprimer' };
  const profil = await db.doc('profils/' + uid).get();
  const etalQ = await db.collection('etals').where('pecheurId', '==', uid).limit(1).get();
  const etal = etalQ.empty ? null : etalQ.docs[0];

  if (action === 'exporter') {
    const [pro, bons, convs, demandes, prive] = await Promise.all([
      db.doc('pros/' + uid).get(), db.collection('bons').where('clientId', '==', uid).get(),
      db.collection('conversations').where('clientId', '==', uid).get(), db.collection('demandes').where('proId', '==', uid).get(),
      etal ? etal.ref.collection('prive').doc('infos').get() : null,
    ]);
    const conversations = await Promise.all(convs.docs.map(async (c) => ({
      bon: c.data().bonCode, messages: (await c.ref.collection('messages').orderBy('creeLe').get()).docs.map((m) => {
        const x = m.data(); return { auteur: x.auteur, texte: x.texte ?? null, vocal: x.audio ? x.audio.duree + ' s' : null, le: x.creeLe?.toDate?.() ?? null };
      }),
    })));
    return JSON.parse(JSON.stringify({
      exporte_le: new Date().toISOString(), compte: { id: uid, email: req.auth?.token.email ?? null },
      profil: profil.data() ?? null, professionnel: pro.data() ?? null,
      etal: etal ? { ...etal.data(), prive: prive?.data() ?? null } : null,
      bons: bons.docs.map((b) => b.data()), conversations, besoins: demandes.docs.map((d) => d.data()),
    }));
  }

  if (action === 'supprimer') {
    if (etal) {
      const n = (await db.collection('bons').where('etalId', '==', etal.id).where('statut', 'in', ['reserve', 'en_livraison']).get()).size;
      if (n) throw erreur('failed-precondition', 'Vous avez encore ' + n + ' réservation(s) à honorer : clôturez-les avant de supprimer votre compte.');
    }
    const enCours = (await db.collection('bons').where('clientId', '==', uid).where('statut', 'in', ['reserve', 'en_livraison']).get()).size;
    if (enCours) throw erreur('failed-precondition', 'Vous avez une réservation en cours : retirez-la ou attendez son annulation avant de supprimer votre compte.');
    // bons gardés 10 ans pour la comptabilité, mais détachés de la personne
    const bons = await db.collection('bons').where('clientId', '==', uid).get();
    const lot = db.batch();
    bons.docs.forEach((b) => lot.update(b.ref, { clientId: null, clientPrenom: 'Compte supprimé' }));
    await lot.commit();
    // conversations du client : messages et fichiers vocaux effacés
    const convs = await db.collection('conversations').where('clientId', '==', uid).get();
    for (const c of convs.docs) {
      await getStorage().bucket().deleteFiles({ prefix: 'messages-audio/' + c.id + '/' }).catch(() => {});
      await db.recursiveDelete(c.ref);
    }
    const demandes = await db.collection('demandes').where('proId', '==', uid).get();
    await Promise.all(demandes.docs.map((d) => (d.data().statut === 'ouverte' ? d.ref.update({ statut: 'annulee' }) : null)));
    if (etal) {
      await etal.ref.update({ statut: 'suspendu', prenom: 'Compte supprimé', photoUrl: null, produits: [], pecheurId: null });
      await etal.ref.collection('prive').doc('infos').set({ lieu: '', precision: '', immatriculation: '' });
    }
    await db.doc('pros/' + uid).delete();
    await profil.ref.delete();
    await journal(uid, 'compte supprimé');
    await getAuth().deleteUser(uid);
    return { supprime: true };
  }
  throw erreur('invalid-argument', 'Action inconnue.');
});
