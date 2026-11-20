// Circuit de l'argent avec Stripe Connect (charges « destination », capture manuelle) :
//
//   bon créé ──(page Stripe)──> payé = empreinte bloquée ──(pesée)──> encaissé (commission prélevée)
//      │                          │  └─(client annule / rupture / 6 jours)─> empreinte libérée
//      └─(30 min sans paiement)─> annulé     └─(client absent)─> pénalité encaissée, reste libéré
//   encaissé ──(équipe)──> remboursé en tout ou partie (le pêcheur rend sa part, la commission est rendue)
//   encaissé ──(banque du client)──> litige : alerte à l'équipe (Stripe prend 20 € de frais à la plateforme)
//
// Contraintes Stripe respectées :
//  - une empreinte bancaire dure 7 jours : bons non clôturés annulés à 6 jours (taches) ;
//  - un seul encaissement par empreinte, au plus le montant bloqué (contrôlé avant la pesée) ;
//  - chaque appel qui bouge de l'argent porte une clé d'idempotence : jamais deux fois ;
//  - l'état est écrit dans la base AVANT l'appel à Stripe ; les messages de Stripe peuvent arriver
//    en double ou dans le désordre sans effet (numéro d'événement mémorisé, états vérifiés) ;
//  - rapprochement quotidien base ↔ Stripe, avec correction automatique des cas sûrs.
// Ce module ajoute aussi le contrôle d'intégrité de la base (Firestore n'a pas de contraintes
// comme une base SQL : on les vérifie chaque nuit) et le cumul des ventes par vendeur (DAC7).
import { FieldPath } from 'firebase-admin/firestore';
import { onCall, onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import type Stripe from 'stripe';
import { alerte, APPEL, centimes, db, erreur, FieldValue, journal, REGION, stripe, STRIPE_SECRET_KEY, Timestamp } from './commun';
import { membreEquipe } from './equipe';
import { stockKg, type Produit } from './formats';
import { ajouterEtape, verifierSuivi } from './historique';
import { notifier } from './notifier';
import { CODE_BON } from './regles';
import { annulerBon } from './reservations';

const jour = (ms = Date.now()) => new Date(ms - 4 * 3600_000).toISOString().slice(0, 10); // jour en Martinique
const eur = (c: number) => Math.round(c) / 100;
export const STATUTS_BON = ['en_attente_paiement', 'reserve', 'en_livraison', 'pesee_en_cours', 'absence_en_cours', 'retire', 'annule', 'rembourse'];

// ───────── Cumul des ventes par vendeur (déclaration DAC7 / art. 242 bis du CGI) ─────────
// Écrit dans la même transaction que l'encaissement : ventesVendeurs/<étal>_<année>
export function cumulerVente(t: FirebaseFirestore.Transaction, etalId: string, montant: number, commission: number, quand = Date.now(), nombre = 1) {
  const j = jour(quand), annee = j.slice(0, 4), mois = j.slice(5, 7);
  t.set(db.doc('ventesVendeurs/' + etalId + '_' + annee), {
    etalId, annee: Number(annee), majLe: FieldValue.serverTimestamp(),
    nombre: FieldValue.increment(nombre), montant: FieldValue.increment(montant), commissions: FieldValue.increment(commission),
    mois: { [mois]: { nombre: FieldValue.increment(nombre), montant: FieldValue.increment(montant), commissions: FieldValue.increment(commission) } },
  }, { merge: true });
}

// ───────── Remboursement (par l'équipe, après une réclamation) ─────────
export const equipeRembourser = onCall({ ...APPEL, secrets: [STRIPE_SECRET_KEY] }, async (req) => {
  const { uid, email } = await membreEquipe(req);
  const d = (req.data ?? {}) as { code?: string; montant?: number; motif?: string };
  const code = String(d.code ?? '');
  const motif = String(d.motif ?? '').trim().slice(0, 200);
  if (!CODE_BON.test(code) || !motif) throw erreur('invalid-argument', 'Indiquez le bon et le motif du remboursement.');
  const ref = db.doc('bons/' + code);
  const paiement = (await db.doc('bonsSecrets/' + code).get()).data()?.stripePaiement as string | undefined;
  // 1. réserver le montant dans la base (deux remboursements simultanés ne peuvent pas dépasser le payé)
  const { montant, cumul, b } = await db.runTransaction(async (t) => {
    const b = (await t.get(ref)).data();
    if (!b || !paiement) throw erreur('not-found', 'Bon introuvable ou jamais encaissé.');
    if (!['retire', 'annule', 'rembourse'].includes(b.statut) || !(b.montantPaye > 0)) throw erreur('failed-precondition', 'Rien d’encaissé sur ce bon.');
    const deja = Number(b.rembourse ?? 0);
    const reste = Math.round((b.montantPaye - deja) * 100) / 100;
    const montant = d.montant === undefined ? reste : Math.round(Number(d.montant) * 100) / 100;
    if (!(montant > 0) || montant > reste + 0.001) throw erreur('invalid-argument', 'Au plus ' + reste.toFixed(2).replace('.', ',') + ' € à rembourser.');
    const cumul = Math.round((deja + montant) * 100) / 100;
    t.update(ref, { rembourse: cumul, remboursementEnCours: true });
    return { montant, cumul, b };
  });
  // 2. Stripe : le pêcheur rend sa part (reverse_transfer), la commission est rendue au prorata
  try {
    await stripe().refunds.create({ payment_intent: paiement, amount: centimes(montant), reverse_transfer: true, refund_application_fee: true, metadata: { code, motif } },
      { idempotencyKey: 'remb-' + code + '-' + centimes(cumul) });
  } catch (e) {
    await ref.update({ rembourse: Math.round((cumul - montant) * 100) / 100, remboursementEnCours: FieldValue.delete() });
    throw erreur('failed-precondition', 'Stripe a refusé le remboursement : ' + String((e as Error).message ?? e).slice(0, 120));
  }
  // 3. clôture dans la base, suivi, cumul DAC7 corrigé
  const total = cumul >= b.montantPaye - 0.001;
  await db.runTransaction(async (t) => {
    const x = (await t.get(ref)).data();
    t.update(ref, { remboursementEnCours: FieldValue.delete(), ...(total ? { statut: 'rembourse' } : {}),
      ...ajouterEtape(t, code, x, 'remboursee', { uid, role: 'equipe' }, { montant, cumul, motif, par: email }) });
    const part = b.montantPaye ? montant / b.montantPaye : 0;
    cumulerVente(t, b.etalId, -montant, -Math.round(Number(b.commission ?? 0) * part * 100) / 100, Date.now(), total ? -1 : 0);
    // facture d'un pro : un avoir doit être émis (numéro à part), à faire valider par l'expert-comptable
    if (b.facture) t.set(db.collection('avoirsAEmettre').doc(), { facture: b.facture, bon: code, montant, motif, le: FieldValue.serverTimestamp() });
  });
  await journal(uid, 'remboursement', { code, montant, motif });
  await notifier([b.clientId], 'Remboursement ' + code, montant.toFixed(2).replace('.', ',') + ' € remboursés sur votre carte (quelques jours selon la banque).');
  await notifier([b.pecheurId], 'Remboursement ' + code, 'L’équipe a remboursé ' + montant.toFixed(2).replace('.', ',') + ' € au client (' + motif + ').');
  return { montant, total };
});

// ───────── Rapprochement base ↔ Stripe ─────────
type Ecart = { code: string; paiement: string; stripe: string; base: string; probleme: string; corrige?: boolean };

export async function rapprocher(depuisMs: number) {
  const ecarts: Ecart[] = []; let verifies = 0;
  const vus = new Set<string>();
  const liste = stripe().paymentIntents.list({ created: { gte: Math.floor(depuisMs / 1000) }, limit: 100 });
  let n = 0;
  for await (const pi of liste as AsyncIterable<Stripe.PaymentIntent>) {
    if (++n > 2000) break;
    const code = pi.metadata?.code;
    if (!code || !CODE_BON.test(code)) continue;
    const [bs, ss] = await Promise.all([db.doc('bons/' + code).get(), db.doc('bonsSecrets/' + code).get()]);
    const b = bs.data(), secret = ss.data();
    verifies++;
    const e = (probleme: string, corrige = false) => ecarts.push({ code, paiement: pi.id, stripe: pi.status, base: b?.statut ?? 'absent', probleme, corrige });
    if (!b) { e('paiement Stripe sans bon dans la base'); continue; }
    if (secret?.stripePaiement && secret.stripePaiement !== pi.id) {
      // ancienne page de paiement remplacée : elle ne doit rien avoir encaissé ni bloqué
      if (pi.status === 'requires_capture') { await stripe().paymentIntents.cancel(pi.id, {}, { idempotencyKey: 'annul-' + pi.id }).catch(() => null); e('empreinte en double libérée', true); }
      else if (pi.status === 'succeeded') e('encaissement sur une ancienne page de paiement');
      continue;
    }
    vus.add(code);
    switch (pi.status) {
      case 'requires_capture':
        if (['annule', 'rembourse'].includes(b.statut)) {
          // bon annulé mais empreinte encore bloquée (Stripe injoignable au moment de l'annulation) : on la libère
          await stripe().paymentIntents.cancel(pi.id, {}, { idempotencyKey: 'annul-' + code }).catch(() => null);
          e('empreinte encore bloquée sur un bon annulé : libérée', true);
        } else if (b.statut === 'en_attente_paiement') e('empreinte bloquée mais bon pas marqué payé (message Stripe perdu ?)');
        else if (eur(pi.amount_capturable) + 0.001 < b.montantBloque) e('empreinte plus petite que le montant bloqué');
        break;
      case 'succeeded': {
        const recu = eur(pi.amount_received);
        if (['pesee_en_cours', 'reserve', 'en_livraison', 'absence_en_cours'].includes(b.statut)) e('encaissé ' + recu + ' € chez Stripe mais bon pas clôturé');
        else if (b.statut === 'en_attente_paiement' || b.statut === 'annule' && !(b.montantPaye > 0)) e('encaissé chez Stripe mais bon ' + b.statut);
        else if (Math.abs(recu - Number(b.montantPaye ?? 0)) > 0.001) e('montant encaissé ' + recu + ' € ≠ ' + b.montantPaye + ' € dans la base');
        else if (b.statut !== 'annule' && pi.application_fee_amount != null && Math.abs(eur(pi.application_fee_amount) - Number(b.commission ?? 0)) > 0.001) e('commission Stripe ≠ commission de la base');
        break;
      }
      case 'canceled':
        if (['reserve', 'en_livraison'].includes(b.statut)) {
          // empreinte annulée chez Stripe (expirée) alors que le bon attend encore : poisson remis en vente
          await annulerBon(code, 'empreinte annulée chez Stripe (rapprochement)', { uid: null, role: 'systeme' });
          e('empreinte annulée chez Stripe, bon annulé', true);
        } else if (['retire'].includes(b.statut)) e('bon retiré mais paiement annulé chez Stripe');
        break;
    }
  }
  // dans l'autre sens : bons payés de la période sans paiement Stripe connu
  const payes = await db.collection('bons').where('payeLe', '>=', Timestamp.fromMillis(depuisMs)).limit(2000).get();
  for (const d of payes.docs) {
    if (vus.has(d.id)) continue;
    const p = (await db.doc('bonsSecrets/' + d.id).get()).data()?.stripePaiement;
    if (!p) ecarts.push({ code: d.id, paiement: '', stripe: 'aucun', base: d.data().statut, probleme: 'bon payé sans paiement Stripe' });
  }
  return { verifies, ecarts };
}

// ───────── Contrôle d'intégrité de la base (les « contraintes » qu'une base SQL vérifierait) ─────────
export async function controlerIntegrite(depuisMs: number) {
  const erreurs: string[] = [];
  // 1. stocks : jamais négatifs, nombres entiers, poids positifs
  const etals = await db.collection('etals').get();
  for (const d of etals.docs) {
    for (const p of (d.data().produits ?? []) as Produit[]) {
      const ou = 'étal ' + d.id + ' / ' + p.espece + ' (' + (p.format ?? 'kilo') + ')';
      if (!(p.dispoKg >= 0)) erreurs.push(ou + ' : stock négatif');
      if (p.format === 'piece' && (p.pieces ?? []).some((x) => !(x.poidsKg > 0))) erreurs.push(ou + ' : poids de poisson invalide');
      if (p.format === 'portion' && !(Number.isInteger(p.portion?.nombre) && (p.portion?.nombre ?? -1) >= 0)) erreurs.push(ou + ' : nombre de barquettes invalide');
      if (p.format === 'lot' && !(Number.isInteger(p.lot?.nombre) && (p.lot?.nombre ?? -1) >= 0)) erreurs.push(ou + ' : nombre de lots invalide');
      if (p.format && p.format !== 'kilo' && Math.abs(stockKg(p) - p.dispoKg) > 0.05) erreurs.push(ou + ' : stock affiché ≠ stock réel');
    }
  }
  // 2. bons récents : statut connu, montants cohérents, suivi chaîné intact
  const bons = await db.collection('bons').where('creeLe', '>=', Timestamp.fromMillis(depuisMs)).limit(2000).get();
  for (const d of bons.docs) {
    const b = d.data(), ou = 'bon ' + d.id;
    if (!STATUTS_BON.includes(b.statut)) erreurs.push(ou + ' : statut inconnu « ' + b.statut + ' »');
    if (b.montantPaye != null && b.montantPaye > b.montantBloque + 0.001) erreurs.push(ou + ' : encaissé plus que le montant bloqué');
    if (b.statut === 'retire' && !(b.montantPaye > 0)) erreurs.push(ou + ' : retiré sans montant encaissé');
    if (Number(b.rembourse ?? 0) > Number(b.montantPaye ?? 0) + 0.001) erreurs.push(ou + ' : remboursé plus que payé');
    if (['pesee_en_cours', 'absence_en_cours'].includes(b.statut) && (b.creeLe?.toMillis?.() ?? 0) < Date.now() - 3600_000) erreurs.push(ou + ' : bloqué en « ' + b.statut + ' »');
    if (['retire', 'annule', 'rembourse'].includes(b.statut)) {
      const v = await verifierSuivi(d.id);
      if (!v.valide) erreurs.push(ou + ' : suivi de commande modifié ou incomplet');
    }
  }
  // 3. réservations avant sortie : le total réservé = somme des réservations en attente
  const sorties = await db.collection('sorties').where('statut', '==', 'annoncee').get();
  for (const s of sorties.docs) {
    const ps = await db.collection('precommandes').where('etalId', '==', s.id).where('statut', '==', 'en_attente').get();
    const somme: Record<string, number> = {};
    ps.docs.forEach((p) => { somme[p.data().espece] = (somme[p.data().espece] ?? 0) + p.data().kg; });
    for (const [esp, kg] of Object.entries((s.data().reserveKg ?? {}) as Record<string, number>)) {
      if (Math.abs(kg - (somme[esp] ?? 0)) > 0.05) erreurs.push('sortie ' + s.id + ' / ' + esp + ' : ' + kg + ' kg réservés affichés, ' + (somme[esp] ?? 0) + ' kg réellement');
    }
  }
  // 4. factures : numérotation continue, sans trou ni doublon
  const annee = new Date().getFullYear();
  const compteur = Number((await db.doc('compteurs/factures-' + annee).get()).data()?.n ?? 0);
  const factures = await db.collection('factures').where(FieldPath.documentId(), '>=', 'FA-' + annee + '-').where(FieldPath.documentId(), '<', 'FA-' + annee + '-~').get();
  const nums = factures.docs.map((f) => Number(f.id.slice(-6))).sort((a, b) => a - b);
  if (nums.length !== compteur || nums.some((x, i) => x !== i + 1)) erreurs.push('factures ' + annee + ' : numérotation non continue (' + nums.length + ' factures, compteur ' + compteur + ')');
  return { bons: bons.size, etals: etals.size, erreurs };
}

// ───────── Contrôle quotidien : rapprochement + intégrité, résultat visible dans l'espace équipe ─────────
export async function controleQuotidien(maintenant = Date.now()) {
  const depuis = maintenant - 3 * 86400_000;
  const [r, i] = await Promise.all([rapprocher(depuis), controlerIntegrite(depuis)]);
  const anomalies = r.ecarts.filter((x) => !x.corrige).length + i.erreurs.length;
  const res = { le: FieldValue.serverTimestamp(), jour: jour(maintenant), rapprochement: r, integrite: i, anomalies, ok: anomalies === 0 };
  await db.doc('controles/' + jour(maintenant)).set(res);
  if (anomalies) await alerte(null, 'contrôle quotidien : ' + anomalies + ' anomalie(s)', { ecarts: r.ecarts.slice(0, 20), erreurs: i.erreurs.slice(0, 20) });
  return { ...res, le: null };
}
export const controle = onSchedule({ region: REGION, schedule: 'every day 04:30', timeZone: 'America/Martinique', secrets: [STRIPE_SECRET_KEY] }, async () => { await controleQuotidien(); });
// l'équipe peut le relancer à la demande (après une correction)
export const equipeControler = onCall({ ...APPEL, secrets: [STRIPE_SECRET_KEY] }, async (req) => {
  await membreEquipe(req);
  return controleQuotidien();
});

// ───────── Export annuel DAC7 (ventes par vendeur, identité vérifiée par Stripe) ─────────
export const equipeDac7 = onCall({ ...APPEL, secrets: [STRIPE_SECRET_KEY] }, async (req) => {
  await membreEquipe(req);
  const annee = Number((req.data as { annee?: number })?.annee ?? new Date().getFullYear() - 1);
  if (!(annee >= 2026 && annee <= 2100)) throw erreur('invalid-argument', 'Année invalide.');
  const ventes = await db.collection('ventesVendeurs').where('annee', '==', annee).get();
  const lignes: string[] = ['etal;nom_legal;siret;nif;date_naissance;adresse;iban_fin;nombre_ventes;montant_ttc;commissions;T1;T2;T3;T4;seuil_atteint'];
  const csv = (x: unknown) => '"' + String(x ?? '').replace(/"/g, '""') + '"';
  for (const v of ventes.docs) {
    const x = v.data();
    const [prive, compte] = await Promise.all([db.doc('etals/' + x.etalId + '/prive/infos').get(), db.doc('comptesStripe/' + x.etalId).get()]);
    let naissance = '', adresse = '', iban = '';
    const idCompte = compte.data()?.compte;
    if (idCompte) {
      const a = await stripe().accounts.retrieve(idCompte).catch(() => null);
      const ind = a?.individual;
      if (ind?.dob?.year) naissance = ind.dob.year + '-' + String(ind.dob.month).padStart(2, '0') + '-' + String(ind.dob.day).padStart(2, '0');
      if (ind?.address) adresse = [ind.address.line1, ind.address.postal_code, ind.address.city].filter(Boolean).join(' ');
      const ext = a?.external_accounts?.data?.[0] as { last4?: string } | undefined;
      iban = ext?.last4 ? '…' + ext.last4 : '';
    }
    const trimestre = (q: number) => [1, 2, 3].reduce((s, k) => s + Number(x.mois?.[String((q - 1) * 3 + k).padStart(2, '0')]?.montant ?? 0), 0).toFixed(2);
    // exclus de la déclaration : moins de 30 ventes ET moins de 2 000 € dans l'année
    const seuil = x.nombre >= 30 || x.montant >= 2000;
    const p = prive.data() ?? {};
    lignes.push([x.etalId, p.nomLegal, p.siret, p.nif, naissance, adresse, iban, x.nombre, Number(x.montant).toFixed(2), Number(x.commissions).toFixed(2),
      trimestre(1), trimestre(2), trimestre(3), trimestre(4), seuil ? 'oui' : 'non'].map(csv).join(';'));
  }
  return { nom: 'dac7-' + annee + '.csv', csv: lignes.join('\n'), vendeurs: ventes.size };
});

// ───────── Adresse de santé pour la surveillance externe (UptimeRobot, Better Stack) ─────────
// 200 si les tâches automatiques ont tourné dans les 15 dernières minutes, 503 sinon.
export const sante = onRequest({ region: REGION, cors: false, maxInstances: 2 }, async (_req, res) => {
  const t = (await db.doc('etat/taches').get()).data()?.derniereExecution as Timestamp | undefined;
  const ok = !!t && t.toMillis() > Date.now() - 15 * 60_000;
  res.status(ok ? 200 : 503).json({ ok, taches: t?.toDate().toISOString() ?? null });
});
