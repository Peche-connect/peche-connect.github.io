// Réservations : panier vérifié côté serveur, empreinte bancaire Stripe, QR signé + code de retrait,
// pesée et encaissement du poids réel, besoins des pros.
import { onCall } from 'firebase-functions/v2/https';
import { alerte, APPCHECK, APPEL, centimes, connecte, db, erreur, FieldValue, journal, limiter, QR_SECRET, reglages, site, stripe, STRIPE_SECRET_KEY, Timestamp } from './commun';
import { ajouterEtape, type Auteur } from './historique';
import { emettreFacture } from './factures';
import { notifier } from './notifier';
import { CODE_BON, codeRetrait, creneaux, especeConnue, masquerNumeros, montantBloque, montantsPesee, nomPropre, normaliser, preuveValide, signerBon } from './regles';

export type LigneBon = { produitId: string | null; espece: string; kg: number; prixKg: number; preparation: string; supplementKg: number };
type Produit = { id: string; espece: string; prixKg: number; dispoKg: number; preparations: { nom: string; supplementKg: number }[] };
const KG_MAX_PARTICULIER = 10, KG_MAX_PRO = 100;
const INTROUVABLE = 'Bon introuvable.'; // même réponse si le bon n'existe pas ou n'est pas à vous

export function codeBon(v: unknown) {
  const c = String(v ?? '');
  if (!CODE_BON.test(c)) throw erreur('invalid-argument', INTROUVABLE);
  return c;
}

// Numéro de bon suivant (R-100, R-101…), sans doublon même avec des réservations simultanées
async function prochainCode(t: FirebaseFirestore.Transaction) {
  const ref = db.doc('compteurs/bons');
  const n = ((await t.get(ref)).data()?.n ?? 99) + 1;
  t.set(ref, { n });
  return 'R-' + n;
}

// Page de paiement Stripe : empreinte (capture manuelle), reversement au compte du pêcheur
async function sessionPaiement(code: string, montant: number, compteStripe: string, email: string | undefined, relance: boolean) {
  const expire = Math.floor(Date.now() / 1000) + 30 * 60; // poisson remis en vente après 30 min sans paiement
  const s = await stripe().checkout.sessions.create({
    mode: 'payment', locale: 'fr', customer_email: email,
    line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: centimes(montant),
      product_data: { name: 'Réservation ' + code + ' (montant maximum)', description: 'Seul le poids réel pesé devant vous est débité ; le reste est libéré.' } } }],
    payment_intent_data: { capture_method: 'manual', transfer_data: { destination: compteStripe }, metadata: { code }, description: 'Pêche Connect ' + code },
    metadata: { code, relance: relance ? '1' : '0' },
    expires_at: expire,
    success_url: site() + '/bon/' + code + '?paye=1',
    cancel_url: relance ? site() + '/bon/' + code : site() + '/panier?annule=' + code,
  });
  await db.doc('bonsSecrets/' + code).set({ stripeSession: s.id, sessionExpireLe: Timestamp.fromMillis(expire * 1000) }, { merge: true });
  return s;
}

// Ferme la page de paiement en cours d'un bon (plus aucun paiement possible dessus)
export async function expirerSession(code: string) {
  const s = (await db.doc('bonsSecrets/' + code).get()).data()?.stripeSession as string | undefined;
  if (s) await stripe().checkout.sessions.expire(s).catch(() => {});
}

const SYSTEME: Auteur = { uid: null, role: 'systeme' };
// Remet le poisson en vente et annule un bon non payé (ou payé mais jamais retiré)
export async function annulerBon(code: string, raison = 'paiement non effectué', par: Auteur = SYSTEME) {
  await db.runTransaction(async (t) => {
    const ref = db.doc('bons/' + code); const b = (await t.get(ref)).data();
    if (!b || !['en_attente_paiement', 'reserve', 'en_livraison'].includes(b.statut)) return;
    const etalRef = db.doc('etals/' + b.etalId); const etal = (await t.get(etalRef)).data();
    if (etal && b.origine !== 'demande') {
      const produits = (etal.produits as Produit[]).map((p) => {
        const kg = (b.lignes as LigneBon[]).filter((l) => l.produitId === p.id).reduce((s, l) => s + l.kg, 0);
        return kg ? { ...p, dispoKg: Math.round((p.dispoKg + kg) * 10) / 10 } : p;
      });
      t.update(etalRef, { produits });
    }
    t.update(ref, { statut: 'annule', ...ajouterEtape(t, code, b, 'annulee', par, { raison }) });
  });
}

export const creerReservation = onCall({ ...APPEL, consumeAppCheckToken: APPCHECK, secrets: [STRIPE_SECRET_KEY] }, async (req) => {
  const uid = connecte(req);
  if (req.auth?.token.email_verified !== true) throw erreur('failed-precondition', 'Confirmez votre adresse e-mail avant de réserver.');
  await limiter(uid, 'reservation', 10);
  const d = (req.data ?? {}) as { etalId: string; lignes: { produitId: string; kg: number; preparation: string }[]; creneau: string; livraison?: boolean };
  if (typeof d.etalId !== 'string' || !/^[A-Za-z0-9]{1,40}$/.test(d.etalId) || !Array.isArray(d.lignes) || !d.lignes.length || d.lignes.length > 20) throw erreur('invalid-argument', 'Panier invalide.');
  const compteStripe = (await db.doc('comptesStripe/' + d.etalId).get()).data()?.compte as string | undefined;
  if (!compteStripe) throw erreur('failed-precondition', 'Ce pêcheur ne peut pas encore recevoir de paiement.');
  const r = await reglages();
  const [profil, pro] = await Promise.all([db.doc('profils/' + uid).get(), db.doc('pros/' + uid).get()]);
  if (!profil.exists) throw erreur('failed-precondition', 'Terminez votre inscription avant de réserver.');

  const code = await db.runTransaction(async (t) => {
    const etalRef = db.doc('etals/' + d.etalId);
    const etal = (await t.get(etalRef)).data();
    if (!etal || etal.statut !== 'verifie' || !etal.stripePret) throw erreur('failed-precondition', 'Étal indisponible.');
    if (etal.pecheurId === uid) throw erreur('failed-precondition', 'Vous ne pouvez pas réserver sur votre propre étal.');
    // anti-abus : pas plus de 2 réservations non payées à la fois (sinon on bloquerait le poisson des autres)
    const enAttente = await t.get(db.collection('bons').where('clientId', '==', uid).where('statut', '==', 'en_attente_paiement').where('origine', '==', 'panier'));
    if (enAttente.size >= 2) throw erreur('resource-exhausted', 'Vous avez déjà 2 réservations en attente de paiement : réglez-les ou attendez 30 minutes.');
    const produits = (etal.produits as Produit[]).map((p) => ({ ...p }));
    const lignes: LigneBon[] = d.lignes.map((l) => {
      const p = produits.find((x) => x.id === l?.produitId);
      const kg = Math.round(Number(l?.kg) * 10) / 10;
      if (!p) throw erreur('failed-precondition', 'Un poisson de votre panier n’est plus en vente.');
      if (!(kg > 0) || kg > p.dispoKg) throw erreur('failed-precondition', 'Plus assez de ' + p.espece.toLowerCase() + ' (reste ' + String(p.dispoKg).replace('.', ',') + ' kg).');
      const prep = p.preparations.find((x) => x.nom === l.preparation) ?? p.preparations[0];
      p.dispoKg = Math.round((p.dispoKg - kg) * 10) / 10;
      return { produitId: p.id, espece: p.espece, kg, prixKg: p.prixKg, preparation: prep.nom, supplementKg: prep.supplementKg };
    });
    const totalKg = lignes.reduce((s, l) => s + l.kg, 0);
    const infosPro = pro.data();
    if (totalKg > (infosPro ? KG_MAX_PRO : KG_MAX_PARTICULIER)) throw erreur('invalid-argument', 'Au plus ' + (infosPro ? KG_MAX_PRO : KG_MAX_PARTICULIER) + ' kg par réservation.');
    const livraison = d.livraison === true && infosPro && totalKg >= r.livraisonMinKg
      ? { adresse: infosPro.adresse || infosPro.raison + ', ' + infosPro.commune, frais: r.fraisLivraison } : null;
    const liste = creneaux(Number(etal.limiteRetrait ?? 720));
    const creneau = liste.includes(d.creneau) ? d.creneau : liste[0]; // liste fermée : pas de texte libre
    const c = await prochainCode(t);
    t.update(etalRef, { produits });
    t.set(db.doc('bons/' + c), {
      code: c, origine: 'panier', etalId: d.etalId, pecheurId: etal.pecheurId, clientId: uid, clientPrenom: nomPropre(profil.data()?.prenom, 1, 40) ?? 'Client',
      pro: infosPro ? { raison: infosPro.raison, type: infosPro.type, siret: infosPro.siret, commune: infosPro.commune } : null,
      livraison, chauffeurId: null, lignes, creneau: livraison ? 'Livraison ' + creneau.toLowerCase() : creneau,
      statut: 'en_attente_paiement', montantBloque: montantBloque(r, lignes, livraison?.frais ?? 0), montantPaye: null, commission: null,
      creeLe: FieldValue.serverTimestamp(), payeLe: null, retireLe: null, rappelEnvoye: false, facture: null,
      ...ajouterEtape(t, c, undefined, 'reservee', { uid, role: infosPro ? 'pro' : 'client' }, { kg: Math.round(totalKg * 10) / 10, montantBloque: montantBloque(r, lignes, livraison?.frais ?? 0), creneau: livraison ? 'Livraison ' + creneau.toLowerCase() : creneau }),
    });
    return c;
  });

  try {
    const bon = (await db.doc('bons/' + code).get()).data()!;
    const s = await sessionPaiement(code, bon.montantBloque, compteStripe, req.auth?.token.email, false);
    return { code, url: s.url };
  } catch (e) {
    await annulerBon(code, 'page de paiement impossible à créer');
    throw e;
  }
});

// Régler un bon pas encore payé (commande de pro acceptée, ou paiement interrompu dans les 30 minutes)
export const payerBon = onCall({ ...APPEL, secrets: [STRIPE_SECRET_KEY] }, async (req) => {
  const uid = connecte(req);
  await limiter(uid, 'payer', 10);
  const code = codeBon((req.data as { code?: string })?.code);
  const b = (await db.doc('bons/' + code).get()).data();
  if (!b || b.clientId !== uid) throw erreur('not-found', INTROUVABLE);
  if (b.statut !== 'en_attente_paiement') throw erreur('failed-precondition', 'Ce bon est déjà payé ou annulé.');
  // une réservation du panier ne se prolonge pas : au-delà de 30 minutes, il faut la refaire
  if (b.origine !== 'demande' && (b.creeLe?.toMillis?.() ?? 0) < Date.now() - 30 * 60_000) throw erreur('failed-precondition', 'Réservation expirée : refaites-la depuis l’étal.');
  const etal = (await db.doc('etals/' + b.etalId).get()).data();
  if (!etal || etal.statut !== 'verifie' || !etal.stripePret) throw erreur('failed-precondition', 'Ce pêcheur ne vend plus pour le moment.');
  const compteStripe = (await db.doc('comptesStripe/' + b.etalId).get()).data()?.compte as string | undefined;
  if (!compteStripe) throw erreur('failed-precondition', 'Ce pêcheur ne peut pas encore recevoir de paiement.');
  await expirerSession(code); // un seul paiement possible par bon
  const s = await sessionPaiement(code, b.montantBloque, compteStripe, req.auth?.token.email, true);
  return { url: s.url };
});

// Contenu du QR et code de retrait à 6 chiffres : seulement pour le client du bon
export const monQr = onCall({ ...APPEL, secrets: [QR_SECRET] }, async (req) => {
  const uid = connecte(req);
  await limiter(uid, 'qr', 120);
  const code = codeBon((req.data as { code?: string })?.code);
  const b = (await db.doc('bons/' + code).get()).data();
  if (!b || b.clientId !== uid || !['reserve', 'en_livraison'].includes(b.statut)) return { signature: null, codeRetrait: null };
  const nonce = (await db.doc('bonsSecrets/' + code).get()).data()?.nonce as string | undefined;
  if (!nonce) return { signature: null, codeRetrait: null };
  return { signature: signerBon(QR_SECRET.value(), code, nonce), codeRetrait: codeRetrait(QR_SECRET.value(), code, nonce) };
});

async function controlerPreuve(uid: string, code: string, preuve: unknown) {
  const [b, secrets] = await Promise.all([db.doc('bons/' + code).get(), db.doc('bonsSecrets/' + code).get()]);
  const bon = b.data();
  if (!bon || bon.pecheurId !== uid) throw erreur('not-found', INTROUVABLE);
  if (!preuveValide(QR_SECRET.value(), code, secrets.data()?.nonce, String(preuve ?? ''))) {
    await alerte(uid, 'QR ou code de retrait invalide', { code });
    throw erreur('invalid-argument', 'QR code ou code de retrait non valable.');
  }
  return bon;
}

// Le pêcheur scanne le QR du client (ou tape son code de retrait) : vérification avant la pesée
export const verifierBon = onCall({ ...APPEL, secrets: [QR_SECRET] }, async (req) => {
  const uid = connecte(req);
  await limiter(uid, 'verifier', 60);
  const d = (req.data ?? {}) as { code?: string; signature?: string };
  const code = codeBon(d.code);
  const b = await controlerPreuve(uid, code, d.signature);
  if (!['reserve', 'en_livraison'].includes(b.statut)) throw erreur('failed-precondition', b.statut === 'retire' ? 'Ce bon a déjà été retiré.' : 'Ce bon n’est pas payé ou a été annulé.');
  return { valide: true, client: b.clientPrenom, creneau: b.creneau };
});

// Pesée devant le client : encaissement du poids réel, SEULEMENT avec le QR du client ou son code de
// retrait (preuve qu'il est là). Tout à 0 kg (pêcheur en rupture, client absent) : rien n'est débité.
export const validerPesee = onCall({ ...APPEL, consumeAppCheckToken: APPCHECK, secrets: [STRIPE_SECRET_KEY, QR_SECRET] }, async (req) => {
  const uid = connecte(req);
  await limiter(uid, 'pesee', 60);
  const d = (req.data ?? {}) as { code?: string; poids?: number[]; preuve?: string };
  const code = codeBon(d.code);
  const ref = db.doc('bons/' + code);
  const b = (await ref.get()).data();
  if (!b || b.pecheurId !== uid) throw erreur('not-found', INTROUVABLE);
  const etal = (await db.doc('etals/' + b.etalId).get()).data();
  if (!etal || etal.statut !== 'verifie') throw erreur('permission-denied', 'Compte pêcheur suspendu.');
  if (!['reserve', 'en_livraison'].includes(b.statut)) throw erreur('failed-precondition', 'Ce bon est déjà clôturé.');
  const lignes = b.lignes as LigneBon[];
  const poids = d.poids;
  if (!Array.isArray(poids) || poids.length !== lignes.length || poids.some((p) => !(typeof p === 'number' && p >= 0 && p < 1000))) throw erreur('invalid-argument', 'Poids invalides.');
  const pesees = lignes.map((l, i) => ({ ...l, kg: Math.round(poids[i] * 10) / 10 }));
  const paiement = (await db.doc('bonsSecrets/' + code).get()).data()?.stripePaiement as string | undefined;
  if (!paiement) throw erreur('failed-precondition', 'Paiement introuvable pour ce bon.');
  const fermer = { fermeeLe: Timestamp.fromMillis(Date.now() + 24 * 3600_000) }; // messagerie fermée 24 h après le retrait
  const conv = db.doc('conversations/' + b.etalId + '_' + b.clientId);

  const pecheur: Auteur = { uid, role: 'pecheur' };
  if (pesees.every((l) => l.kg === 0)) {
    await stripe().paymentIntents.cancel(paiement);
    await db.runTransaction(async (t) => {
      const x = (await t.get(ref)).data();
      t.update(ref, { statut: 'annule', lignes: pesees, montantPaye: 0, retireLe: FieldValue.serverTimestamp(),
        ...ajouterEtape(t, code, x, 'annulee', pecheur, { raison: 'pesée à 0 kg (rupture ou client absent)', debite: 0 }) });
    });
    await db.doc('bonsSecrets/' + code).update({ nonce: FieldValue.delete() });
    await conv.set(fermer, { merge: true });
    await notifier([b.clientId], 'Réservation ' + code + ' annulée', 'Rien ne vous a été débité.');
    return { annule: true };
  }
  await controlerPreuve(uid, code, d.preuve);
  const r = await reglages();
  const m = montantsPesee(r, pesees, Number(b.livraison?.frais ?? 0));
  if (m.total > b.montantBloque + 0.001) throw erreur('failed-precondition', 'Au-delà du montant bloqué : retirez un peu de poisson ou faites une nouvelle réservation pour le supplément.');
  // verrou : une seule pesée à la fois pour ce bon
  await db.runTransaction(async (t) => {
    const x = (await t.get(ref)).data();
    if (!x || !['reserve', 'en_livraison'].includes(x.statut)) throw erreur('failed-precondition', 'Ce bon est déjà clôturé.');
    t.update(ref, { statut: 'pesee_en_cours' });
  });
  try {
    await stripe().paymentIntents.capture(paiement, { amount_to_capture: centimes(m.total), application_fee_amount: centimes(m.plateforme) });
  } catch (e) {
    await ref.update({ statut: b.statut });
    throw e;
  }
  await db.runTransaction(async (t) => {
    const x = (await t.get(ref)).data();
    t.update(ref, { statut: 'retire', lignes: pesees, montantPaye: m.total, commission: m.plateforme, retireLe: FieldValue.serverTimestamp(),
      ...ajouterEtape(t, code, x, 'retiree', pecheur, { poids: pesees.map((l) => ({ espece: l.espece, kg: l.kg })), debite: m.total, preuve: String(d.preuve ?? '').length === 6 ? 'code de retrait' : 'QR' }) });
  });
  if (b.pro) await emettreFacture(code).catch(() => null); // sinon refaite par les tâches automatiques
  await db.doc('bonsSecrets/' + code).update({ nonce: FieldValue.delete() }); // l'ancien QR ne vaut plus rien
  await conv.set(fermer, { merge: true });
  await journal(uid, 'pesée', { code, total: m.total, plateforme: m.plateforme });
  await notifier([b.clientId], 'Retrait ' + code + ' validé', 'Payé ' + m.total.toFixed(2).replace('.', ',') + ' €. Bon appétit !');
  return { montantPaye: m.total, pourLePecheur: m.pourLePecheur };
});

// Ouvre (ou rouvre) la conversation client / pêcheur liée à un bon payé
export async function ouvrirConversation(etalId: string, pecheurId: string, clientId: string, clientPrenom: string, bonCode: string, message: { auteur: 'systeme' | 'pecheur'; texte: string; auteurId?: string }) {
  const ref = db.doc('conversations/' + etalId + '_' + clientId);
  await ref.set({ etalId, pecheurId, clientId, clientPrenom, bonCode, participants: [clientId, pecheurId], fermeeLe: null,
    luClient: message.auteur === 'systeme', luPecheur: message.auteur !== 'systeme', majLe: FieldValue.serverTimestamp() }, { merge: true });
  await ref.collection('messages').add({ auteurId: message.auteurId ?? null, auteur: message.auteur, texte: message.texte, creeLe: FieldValue.serverTimestamp() });
}

// Un pro publie un besoin : ses coordonnées viennent de sa fiche (pas de texte libre), note masquée
export const posterDemande = onCall(APPEL, async (req) => {
  const uid = connecte(req);
  await limiter(uid, 'besoin', 20);
  const pro = (await db.doc('pros/' + uid).get()).data();
  if (req.auth?.token.role !== 'pro' || !pro) throw erreur('permission-denied', 'Réservé aux professionnels.');
  if (pro.siretVerifie !== true) throw erreur('failed-precondition', pro.siretStatut === 'ferme' ? 'Votre établissement est fermé selon le répertoire des entreprises : contactez-nous.' : 'Votre SIRET est en cours de vérification : réessayez un peu plus tard.');
  const d = (req.data ?? {}) as { espece?: string; kg?: number; prixMaxKg?: number; pour?: string; note?: string; livraison?: boolean };
  const espece = especeConnue(d.espece);
  const kg = Math.round(Number(d.kg) * 10) / 10; const prixMaxKg = Math.round(Number(d.prixMaxKg) * 100) / 100;
  if (!espece) throw erreur('invalid-argument', 'Espèce inconnue.');
  if (!(kg > 0 && kg <= 1000) || !(prixMaxKg > 0 && prixMaxKg < 500)) throw erreur('invalid-argument', 'Quantité ou prix invalide.');
  if (d.pour !== 'Aujourd’hui' && d.pour !== 'Demain') throw erreur('invalid-argument', 'Jour invalide.');
  const note = normaliser(d.note).slice(0, 300);
  const r = await reglages();
  const id = await db.runTransaction(async (t) => {
    const ouvertes = await t.get(db.collection('demandes').where('proId', '==', uid).where('statut', '==', 'ouverte'));
    if (ouvertes.size >= 10) throw erreur('resource-exhausted', 'Vous avez déjà 10 besoins ouverts : annulez-en un d’abord.');
    const ref = db.collection('demandes').doc();
    t.set(ref, { proId: uid, proRaison: pro.raison, proType: pro.type, proCommune: pro.commune, espece, kg, prixMaxKg, pour: d.pour,
      ...(note ? { note: masquerNumeros(note).texte } : {}), livraison: d.livraison === true && kg >= r.livraisonMinKg,
      statut: 'ouverte', creeLe: FieldValue.serverTimestamp() });
    return ref.id;
  });
  return { id };
});

// Un pêcheur répond « Je peux fournir » au besoin d'un pro : commande créée, à régler par le pro.
// La messagerie s'ouvre seulement une fois la commande payée.
export const accepterDemande = onCall(APPEL, async (req) => {
  const uid = connecte(req);
  await limiter(uid, 'demande', 30);
  const id = String((req.data as { id?: string })?.id ?? '');
  if (!/^[A-Za-z0-9]{1,40}$/.test(id)) throw erreur('invalid-argument', 'Besoin introuvable.');
  const etalRef = db.doc('etals/' + uid);
  const etal = (await etalRef.get()).data();
  if (!etal || etal.pecheurId !== uid || etal.statut !== 'verifie' || !etal.stripePret) throw erreur('permission-denied', 'Compte pêcheur pas encore prêt.');
  const r = await reglages();
  const res = await db.runTransaction(async (t) => {
    const dRef = db.doc('demandes/' + id); const d = (await t.get(dRef)).data();
    if (!d || d.statut !== 'ouverte') throw erreur('already-exists', 'Ce besoin a déjà été pris par un autre pêcheur.');
    if (d.proId === uid) throw erreur('failed-precondition', 'Vous ne pouvez pas répondre à votre propre besoin.');
    const pro = (await t.get(db.doc('pros/' + d.proId))).data();
    if (!pro) throw erreur('failed-precondition', 'Ce professionnel n’est plus inscrit.');
    const lignes: LigneBon[] = [{ produitId: null, espece: d.espece, kg: d.kg, prixKg: d.prixMaxKg, preparation: 'Entier', supplementKg: 0 }];
    const livraison = d.livraison === true && d.kg >= r.livraisonMinKg ? { adresse: pro.adresse || (pro.raison + ', ' + pro.commune), frais: r.fraisLivraison } : null;
    const code = await prochainCode(t);
    t.set(db.doc('bons/' + code), {
      code, origine: 'demande', etalId: uid, pecheurId: uid, clientId: d.proId, clientPrenom: pro.raison,
      pro: { raison: pro.raison, type: pro.type, siret: pro.siret, commune: pro.commune }, livraison, chauffeurId: null, lignes,
      creneau: d.pour === 'Demain' ? 'Demain matin' : 'Aujourd’hui', statut: 'en_attente_paiement',
      montantBloque: montantBloque(r, lignes, livraison?.frais ?? 0), montantPaye: null, commission: null,
      creeLe: FieldValue.serverTimestamp(), payeLe: null, retireLe: null, rappelEnvoye: false, facture: null,
      ...ajouterEtape(t, code, undefined, 'commande_creee', { uid, role: 'pecheur' }, { besoin: id, kg: d.kg, montantBloque: montantBloque(r, lignes, livraison?.frais ?? 0) }),
    });
    t.update(dRef, { statut: 'acceptee', etalId: uid, bonCode: code });
    return { code, d };
  });
  await notifier([res.d.proId], etal.prenom + ' peut vous fournir', res.d.kg + ' kg de ' + res.d.espece + ' · commande ' + res.code + ' à régler', { lien: '/bon/' + res.code });
  return { code: res.code };
});
