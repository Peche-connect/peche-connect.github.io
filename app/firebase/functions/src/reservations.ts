// Réservations : panier vérifié côté serveur, empreinte bancaire Stripe, QR signé, pesée et encaissement
// du poids réel, commandes des pros (besoins).
import { onCall } from 'firebase-functions/v2/https';
import { centimes, connecte, db, erreur, FieldValue, journal, QR_SECRET, reglages, site, stripe, STRIPE_SECRET_KEY, APPEL, limiter, alerte } from './commun';
import { notifier } from './notifier';
import { montantBloque, montantsPesee, signatureValide } from './regles';

export type LigneBon = { produitId: string | null; espece: string; kg: number; prixKg: number; preparation: string; supplementKg: number };
type Produit = { id: string; espece: string; prixKg: number; dispoKg: number; preparations: { nom: string; supplementKg: number }[] };

// Numéro de bon suivant (R-100, R-101…), sans doublon même avec des réservations simultanées
async function prochainCode(t: FirebaseFirestore.Transaction) {
  const ref = db.doc('compteurs/bons');
  const n = ((await t.get(ref)).data()?.n ?? 99) + 1;
  t.set(ref, { n });
  return 'R-' + n;
}

// Page de paiement Stripe : empreinte (capture manuelle), reversement au compte du pêcheur
async function sessionPaiement(code: string, montant: number, compteStripe: string, email: string | undefined, relance: boolean) {
  return stripe().checkout.sessions.create({
    mode: 'payment', locale: 'fr', customer_email: email,
    line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: centimes(montant),
      product_data: { name: 'Réservation ' + code + ' (montant maximum)', description: 'Seul le poids réel pesé devant vous est débité ; le reste est libéré.' } } }],
    payment_intent_data: { capture_method: 'manual', transfer_data: { destination: compteStripe }, metadata: { code }, description: 'Pêche Connect ' + code },
    metadata: { code, relance: relance ? '1' : '0' },
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // poisson remis en vente après 30 min sans paiement
    success_url: site() + '/bon/' + code + '?paye=1',
    cancel_url: relance ? site() + '/bon/' + code : site() + '/panier?annule=' + code,
  });
}

// Remet le poisson en vente et annule un bon non payé (ou payé mais jamais retiré)
export async function annulerBon(code: string) {
  await db.runTransaction(async (t) => {
    const ref = db.doc('bons/' + code); const b = (await t.get(ref)).data();
    if (!b || !['en_attente_paiement', 'reserve'].includes(b.statut)) return;
    const etalRef = db.doc('etals/' + b.etalId); const etal = (await t.get(etalRef)).data();
    if (etal && b.origine !== 'demande') {
      const produits = (etal.produits as Produit[]).map((p) => {
        const kg = (b.lignes as LigneBon[]).filter((l) => l.produitId === p.id).reduce((s, l) => s + l.kg, 0);
        return kg ? { ...p, dispoKg: Math.round((p.dispoKg + kg) * 10) / 10 } : p;
      });
      t.update(etalRef, { produits });
    }
    t.update(ref, { statut: 'annule' });
  });
}

export const creerReservation = onCall({ ...APPEL, secrets: [STRIPE_SECRET_KEY] }, async (req) => {
  const uid = connecte(req);
  await limiter(uid, 'reservation', 10);
  const d = req.data as { etalId: string; lignes: { produitId: string; kg: number; preparation: string }[]; creneau: string; livraison?: boolean };
  if (typeof d.etalId !== 'string' || !Array.isArray(d.lignes) || !d.lignes.length || d.lignes.length > 20) throw erreur('invalid-argument', 'Panier invalide.');
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
    const produits = (etal.produits as Produit[]).map((p) => ({ ...p }));
    const lignes: LigneBon[] = d.lignes.map((l) => {
      const p = produits.find((x) => x.id === l.produitId);
      const kg = Math.round(Number(l.kg) * 10) / 10;
      if (!p) throw erreur('failed-precondition', 'Un poisson de votre panier n’est plus en vente.');
      if (!(kg > 0) || kg > p.dispoKg) throw erreur('failed-precondition', 'Plus assez de ' + p.espece.toLowerCase() + ' (reste ' + String(p.dispoKg).replace('.', ',') + ' kg).');
      const prep = p.preparations.find((x) => x.nom === l.preparation) ?? p.preparations[0];
      p.dispoKg = Math.round((p.dispoKg - kg) * 10) / 10;
      return { produitId: p.id, espece: p.espece, kg, prixKg: p.prixKg, preparation: prep.nom, supplementKg: prep.supplementKg };
    });
    const totalKg = lignes.reduce((s, l) => s + l.kg, 0);
    const infosPro = pro.data();
    const livraison = d.livraison && infosPro && totalKg >= r.livraisonMinKg
      ? { adresse: infosPro.adresse || infosPro.raison + ', ' + infosPro.commune, frais: r.fraisLivraison } : null;
    const creneau = String(d.creneau ?? 'Avant 10 h').slice(0, 40);
    // anti-abus : pas plus de 2 réservations non payées à la fois (sinon on bloquerait le poisson des autres)
    const enAttente = await t.get(db.collection('bons').where('clientId', '==', uid).where('statut', '==', 'en_attente_paiement').where('origine', '==', 'panier'));
    if (enAttente.size >= 2) throw erreur('resource-exhausted', 'Vous avez déjà 2 réservations en attente de paiement : réglez-les ou attendez 30 minutes.');
    const c = await prochainCode(t);
    t.update(etalRef, { produits });
    t.set(db.doc('bons/' + c), {
      code: c, origine: 'panier', etalId: d.etalId, pecheurId: etal.pecheurId, clientId: uid, clientPrenom: profil.data()?.prenom || 'Client',
      pro: infosPro ? { raison: infosPro.raison, type: infosPro.type, siret: infosPro.siret, commune: infosPro.commune } : null,
      livraison, chauffeurId: null, lignes, creneau: livraison ? 'Livraison ' + creneau.toLowerCase() : creneau,
      statut: 'en_attente_paiement', montantBloque: montantBloque(r, lignes, livraison?.frais ?? 0), montantPaye: null, commission: null,
      creeLe: FieldValue.serverTimestamp(), payeLe: null, retireLe: null, rappelEnvoye: false,
    });
    return c;
  });

  try {
    const bon = (await db.doc('bons/' + code).get()).data()!;
    const s = await sessionPaiement(code, bon.montantBloque, compteStripe, req.auth?.token.email, false);
    await db.doc('bonsSecrets/' + code).set({ stripeSession: s.id }, { merge: true });
    return { code, url: s.url };
  } catch (e) {
    await annulerBon(code);
    throw e;
  }
});

// Régler un bon pas encore payé (commande de pro acceptée, ou paiement interrompu)
export const payerBon = onCall({ ...APPEL, secrets: [STRIPE_SECRET_KEY] }, async (req) => {
  const uid = connecte(req);
  await limiter(uid, 'payer', 10);
  const code = String((req.data as { code: string }).code);
  const b = (await db.doc('bons/' + code).get()).data();
  if (!b || b.clientId !== uid) throw erreur('not-found', 'Bon introuvable.');
  if (b.statut !== 'en_attente_paiement') throw erreur('failed-precondition', 'Ce bon est déjà payé ou annulé.');
  const compteStripe = (await db.doc('comptesStripe/' + b.etalId).get()).data()?.compte as string | undefined;
  if (!compteStripe) throw erreur('failed-precondition', 'Ce pêcheur ne peut pas encore recevoir de paiement.');
  // l'ancienne page de paiement est fermée : un seul paiement possible par bon
  const ancienne = (await db.doc('bonsSecrets/' + code).get()).data()?.stripeSession as string | undefined;
  if (ancienne) await stripe().checkout.sessions.expire(ancienne).catch(() => {});
  const s = await sessionPaiement(code, b.montantBloque, compteStripe, req.auth?.token.email, true);
  await db.doc('bonsSecrets/' + code).set({ stripeSession: s.id }, { merge: true });
  return { url: s.url };
});

// Contenu du QR : seul le client du bon reçoit la signature
export const monQr = onCall(APPEL, async (req) => {
  const uid = connecte(req);
  await limiter(uid, 'qr', 120);
  const code = String((req.data as { code: string }).code);
  const b = (await db.doc('bons/' + code).get()).data();
  if (!b || b.clientId !== uid || !['reserve', 'en_livraison'].includes(b.statut)) return { signature: null };
  return { signature: (await db.doc('bonsSecrets/' + code).get()).data()?.signature ?? null };
});

// Le pêcheur scanne le QR du client : signature et étal vérifiés
export const verifierBon = onCall({ ...APPEL, secrets: [QR_SECRET] }, async (req) => {
  const uid = connecte(req);
  await limiter(uid, 'verifier', 60);
  const { code, signature } = req.data as { code: string; signature: string };
  const b = (await db.doc('bons/' + String(code)).get()).data();
  if (!b || !signatureValide(QR_SECRET.value(), b.code, b.code, String(signature ?? ''))) {
    await alerte(uid, 'QR invalide scanné', { code });
    throw erreur('invalid-argument', 'QR code non valable : ce bon n’a pas été émis par Pêche Connect.');
  }
  if (b.pecheurId !== uid) throw erreur('permission-denied', 'Ce bon est pour un autre pêcheur.');
  if (!['reserve', 'en_livraison'].includes(b.statut)) throw erreur('failed-precondition', b.statut === 'retire' ? 'Ce bon a déjà été retiré.' : 'Ce bon n’est pas payé ou a été annulé.');
  return { valide: true, client: b.clientPrenom, creneau: b.creneau };
});

// Pesée devant le client : capture du poids réel ; tout à 0 kg = empreinte annulée, rien de débité
export const validerPesee = onCall({ ...APPEL, secrets: [STRIPE_SECRET_KEY] }, async (req) => {
  const uid = connecte(req);
  await limiter(uid, 'pesee', 60);
  const { code, poids } = req.data as { code: string; poids: number[] };
  const ref = db.doc('bons/' + String(code));
  const b = (await ref.get()).data();
  if (!b) throw erreur('not-found', 'Bon introuvable.');
  if (b.pecheurId !== uid) throw erreur('permission-denied', 'Ce bon n’est pas pour votre étal.');
  if (!['reserve', 'en_livraison'].includes(b.statut)) throw erreur('failed-precondition', 'Ce bon est déjà clôturé.');
  const lignes = b.lignes as LigneBon[];
  if (!Array.isArray(poids) || poids.length !== lignes.length || poids.some((p) => !(typeof p === 'number' && p >= 0 && p < 1000))) throw erreur('invalid-argument', 'Poids invalides.');
  const pesees = lignes.map((l, i) => ({ ...l, kg: Math.round(poids[i] * 10) / 10 }));
  const paiement = (await db.doc('bonsSecrets/' + b.code).get()).data()?.stripePaiement as string | undefined;
  if (!paiement) throw erreur('failed-precondition', 'Paiement introuvable pour ce bon.');

  if (pesees.every((l) => l.kg === 0)) {
    await stripe().paymentIntents.cancel(paiement);
    await ref.update({ statut: 'annule', lignes: pesees, montantPaye: 0, retireLe: FieldValue.serverTimestamp() });
    await notifier([b.clientId], 'Réservation ' + b.code + ' annulée', 'Rien ne vous a été débité.');
    return { annule: true };
  }
  const r = await reglages();
  const m = montantsPesee(r, pesees, Number(b.livraison?.frais ?? 0));
  if (m.total > b.montantBloque + 0.001) throw erreur('failed-precondition', 'Au-delà du montant bloqué : retirez un peu de poisson ou faites une nouvelle réservation pour le supplément.');
  await stripe().paymentIntents.capture(paiement, { amount_to_capture: centimes(m.total), application_fee_amount: centimes(m.plateforme) });
  await ref.update({ statut: 'retire', lignes: pesees, montantPaye: m.total, commission: m.plateforme, retireLe: FieldValue.serverTimestamp() });
  await journal(uid, 'pesée', { code: b.code, total: m.total, plateforme: m.plateforme });
  await notifier([b.clientId], 'Retrait ' + b.code + ' validé', 'Payé ' + m.total.toFixed(2).replace('.', ',') + ' €. Bon appétit !');
  return { montantPaye: m.total, pourLePecheur: m.pourLePecheur };
});

// Ouvre (ou rouvre) la conversation client / pêcheur liée à un bon
export async function ouvrirConversation(etalId: string, pecheurId: string, clientId: string, clientPrenom: string, bonCode: string, message: { auteur: 'systeme' | 'pecheur'; texte: string; auteurId?: string }) {
  const ref = db.doc('conversations/' + etalId + '_' + clientId);
  await ref.set({ etalId, pecheurId, clientId, clientPrenom, bonCode, participants: [clientId, pecheurId],
    luClient: message.auteur === 'systeme', luPecheur: message.auteur !== 'systeme', majLe: FieldValue.serverTimestamp() }, { merge: true });
  await ref.collection('messages').add({ auteurId: message.auteurId ?? null, auteur: message.auteur, texte: message.texte, creeLe: FieldValue.serverTimestamp() });
}

// Un pêcheur répond « Je peux fournir » au besoin d'un pro : commande créée, à régler par le pro
export const accepterDemande = onCall(APPEL, async (req) => {
  const uid = connecte(req);
  await limiter(uid, 'demande', 30);
  const id = String((req.data as { id: string }).id);
  const e = await db.collection('etals').where('pecheurId', '==', uid).limit(1).get();
  const etal = e.empty ? null : e.docs[0];
  if (!etal || etal.data().statut !== 'verifie' || !etal.data().stripePret) throw erreur('permission-denied', 'Compte pêcheur pas encore prêt.');
  const r = await reglages();
  const res = await db.runTransaction(async (t) => {
    const dRef = db.doc('demandes/' + id); const d = (await t.get(dRef)).data();
    if (!d || d.statut !== 'ouverte') throw erreur('already-exists', 'Ce besoin a déjà été pris par un autre pêcheur.');
    const pro = (await t.get(db.doc('pros/' + d.proId))).data();
    const lignes: LigneBon[] = [{ produitId: null, espece: d.espece, kg: d.kg, prixKg: d.prixMaxKg, preparation: 'Entier', supplementKg: 0 }];
    const livraison = d.livraison ? { adresse: pro?.adresse || (pro?.raison + ', ' + pro?.commune), frais: r.fraisLivraison } : null;
    const code = await prochainCode(t);
    t.set(db.doc('bons/' + code), {
      code, origine: 'demande', etalId: etal.id, pecheurId: uid, clientId: d.proId, clientPrenom: d.proRaison,
      pro: pro ? { raison: pro.raison, type: pro.type, siret: pro.siret, commune: pro.commune } : null, livraison, chauffeurId: null, lignes,
      creneau: d.pour === 'Demain' ? 'Demain matin' : 'Aujourd’hui', statut: 'en_attente_paiement',
      montantBloque: montantBloque(r, lignes, livraison?.frais ?? 0), montantPaye: null, commission: null,
      creeLe: FieldValue.serverTimestamp(), payeLe: null, retireLe: null, rappelEnvoye: false,
    });
    t.update(dRef, { statut: 'acceptee', etalId: etal.id, bonCode: code });
    return { code, d };
  });
  const p = etal.data();
  await ouvrirConversation(etal.id, uid, res.d.proId, res.d.proRaison, res.code, {
    auteur: 'pecheur', auteurId: uid,
    texte: 'Bonjour, je peux vous fournir ' + res.d.kg + ' kg de ' + String(res.d.espece).toLowerCase() + ' à ' + Number(res.d.prixMaxKg).toFixed(2).replace('.', ',') + ' €/kg (' + String(res.d.pour).toLowerCase() + '). Commande ' + res.code + ' créée : réglez-la depuis votre bon pour la confirmer.',
  });
  await notifier([res.d.proId], p.prenom + ' peut vous fournir', res.d.kg + ' kg de ' + res.d.espece + ' · commande ' + res.code + ' à confirmer', { lien: '/bon/' + res.code });
  return { code: res.code };
});

