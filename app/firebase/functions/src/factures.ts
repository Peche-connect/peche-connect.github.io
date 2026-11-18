// Factures des professionnels : numérotées à la suite sans trou (FA-2026-000001, compteur par année tiré
// dans la même transaction que la facture), contenu figé dans « factures/<numéro> » (jamais modifiable,
// même par l'appli), PDF archivé dans le stockage privé « factures/<numéro>.pdf ». Conservation 10 ans.
// Deux parties distinctes : le poisson, vendu par le pêcheur (facture émise par Pêche Connect en son nom
// et pour son compte, mandat de facturation prévu aux conditions) ; les services de Pêche Connect
// (frais de service, livraison). Taux de TVA et mentions à faire valider par l'expert-comptable.
import type { LigneBon } from './formats';
import { getStorage } from 'firebase-admin/storage';
import PDFDocument from 'pdfkit';
import { db, FieldValue } from './commun';
import { ajouterEtape } from './historique';

export const TVA_POISSON = 0.021; // taux réduit Martinique (produits de la mer), à confirmer
export const TVA_SERVICES = 0.085; // taux normal Martinique, à confirmer
const SOCIETE_DEFAUT = { raison: '[Raison sociale à compléter]', forme: 'SARL', capital: '[…]', siret: '[…]', rcs: '[…]', tva: '[…]', adresse: '[Adresse du siège à compléter]', email: 'contact@peche-connect.fr' };

const arrondi = (x: number) => Math.round(x * 100) / 100;
const ht = (ttc: number, taux: number) => arrondi(ttc / (1 + taux));

export type DonneesFacture = {
  numero: string; bon: string; emiseLe: string; payeeLe: string | null;
  societe: typeof SOCIETE_DEFAUT;
  vendeur: { uid: string; prenom: string; nomLegal: string | null; siret: string | null; bateau: string; immatriculation: string | null; port: string };
  acheteur: { uid: string; raison: string; siret: string; siretVerifie: boolean; adresse: string | null; commune: string };
  poisson: { lignes: { designation: string; kg: number; prixKgTtc: number; totalTtc: number; detail?: string }[]; ttc: number; ht: number; tva: number; taux: number };
  services: { lignes: { designation: string; totalTtc: number }[]; ttc: number; ht: number; tva: number; taux: number };
  totalTtc: number;
};

const date = (x: unknown) => { const t = (x as { toDate?: () => Date })?.toDate?.(); return t ? t.toISOString() : null; };

// Crée la facture d'un bon retiré par un pro (une seule fois) ; renvoie son numéro
export async function emettreFacture(code: string): Promise<string | null> {
  const ref = db.doc('bons/' + code);
  const numero = await db.runTransaction(async (t) => {
    const b = (await t.get(ref)).data();
    if (!b || !b.pro || b.statut !== 'retire' || b.facture || !b.clientId) return null;
    const [etal, prive, pro, soc] = await Promise.all([
      t.get(db.doc('etals/' + b.etalId)), t.get(db.doc('etals/' + b.etalId + '/prive/infos')), t.get(db.doc('pros/' + b.clientId)), t.get(db.doc('reglages/societe')),
    ]);
    const e = etal.data() ?? {}; const pv = prive.data() ?? {}; const p = pro.data() ?? {};
    const maintenant = new Date(); const annee = maintenant.getFullYear();
    const compteur = db.doc('compteurs/factures-' + annee);
    const n = ((await t.get(compteur)).data()?.n ?? 0) + 1;
    const num = 'FA-' + annee + '-' + String(n).padStart(6, '0');

    const r = (await t.get(db.doc('reglages/general'))).data() ?? {};
    const fraisService = Number(r.fraisService ?? 0.9);
    const lignes = (b.lignes as LigneBon[]).filter((l) => (l.format === 'lot' ? (l.nombre ?? 0) > 0 : l.kg > 0)).map((l) => {
      if (l.format === 'lot') {
        const n = l.nombre ?? 0, pu = l.prixLot ?? 0;
        return { designation: l.espece + ' (' + (l.libelle ?? 'lot') + ')', kg: l.kg, prixKgTtc: 0, totalTtc: arrondi(n * pu), detail: n + ' × ' + euro(pu) + ' TTC (prix fixe)' };
      }
      const prep = l.format === 'portion' ? (l.libelle ?? l.preparation.toLowerCase()) : l.preparation.toLowerCase() + (l.tete === 'sans' ? ', sans tête' : '');
      return { designation: l.espece + ' (' + prep + ')', kg: l.kg, prixKgTtc: arrondi(l.prixKg + l.supplementKg), totalTtc: arrondi(l.kg * (l.prixKg + l.supplementKg)) };
    });
    const poissonTtc = arrondi(lignes.reduce((s, l) => s + l.totalTtc, 0));
    const lignesServices = [{ designation: 'Frais de service Pêche Connect', totalTtc: fraisService }];
    if (b.livraison?.frais) lignesServices.push({ designation: 'Livraison par chauffeur', totalTtc: Number(b.livraison.frais) });
    // les services sont la différence entre le payé et le poisson : le total de la facture = le montant encaissé
    const servicesTtc = arrondi(Number(b.montantPaye) - poissonTtc);
    if (Math.abs(servicesTtc - lignesServices.reduce((s, l) => s + l.totalTtc, 0)) > 0.011) lignesServices.splice(0, lignesServices.length, { designation: 'Services Pêche Connect (frais de service et livraison)', totalTtc: servicesTtc });

    const f: DonneesFacture = {
      numero: num, bon: code, emiseLe: maintenant.toISOString(), payeeLe: date(b.retireLe) ?? maintenant.toISOString(),
      societe: { ...SOCIETE_DEFAUT, ...(soc.data() ?? {}) },
      vendeur: { uid: b.pecheurId, prenom: e.prenom ?? '', nomLegal: pv.nomLegal ?? null, siret: pv.siret ?? null, bateau: e.bateau ?? '', immatriculation: pv.immatriculation ?? null, port: e.port ?? '' },
      acheteur: { uid: b.clientId, raison: b.pro.raison, siret: b.pro.siret, siretVerifie: p.siretVerifie === true, adresse: p.adresse ?? null, commune: b.pro.commune },
      poisson: { lignes, ttc: poissonTtc, ht: ht(poissonTtc, TVA_POISSON), tva: arrondi(poissonTtc - ht(poissonTtc, TVA_POISSON)), taux: TVA_POISSON },
      services: { lignes: lignesServices, ttc: servicesTtc, ht: ht(servicesTtc, TVA_SERVICES), tva: arrondi(servicesTtc - ht(servicesTtc, TVA_SERVICES)), taux: TVA_SERVICES },
      totalTtc: arrondi(Number(b.montantPaye)),
    };
    t.set(compteur, { n });
    t.create(db.doc('factures/' + num), { ...f, proId: b.clientId, pecheurId: b.pecheurId, pdf: false, creeLe: FieldValue.serverTimestamp() });
    t.update(ref, { facture: num, ...ajouterEtape(t, code, b, 'facture_emise', { uid: null, role: 'systeme' }, { numero: num, totalTtc: f.totalTtc }) });
    return num;
  });
  if (numero) await archiverPdf(numero);
  return numero;
}

// Fabrique le PDF à partir du contenu figé et le range dans le stockage privé (refait si besoin)
export async function archiverPdf(numero: string) {
  const ref = db.doc('factures/' + numero);
  const x = (await ref.get()).data() as (DonneesFacture & { proId: string; pecheurId: string }) | undefined;
  if (!x) return;
  const pdf = await fabriquerPdf(x);
  await getStorage().bucket().file('factures/' + numero + '.pdf').save(pdf, {
    contentType: 'application/pdf', resumable: false,
    metadata: { metadata: { proId: x.proId, pecheurId: x.pecheurId }, cacheControl: 'private, max-age=0' },
  });
  await ref.update({ pdf: true });
}

const euro = (x: number) => x.toFixed(2).replace('.', ',') + ' €';
const pct = (x: number) => (x * 100).toFixed(1).replace('.', ',') + ' %';
const jour = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'America/Martinique' }) : '');

export function fabriquerPdf(f: DonneesFacture): Promise<Buffer> {
  return new Promise((ok, ko) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: 'Facture ' + f.numero, Author: 'Pêche Connect' } });
    const morceaux: Buffer[] = [];
    doc.on('data', (c: Buffer) => morceaux.push(c)); doc.on('end', () => ok(Buffer.concat(morceaux))); doc.on('error', ko);
    const marine = '#12355b';
    doc.fillColor(marine).font('Helvetica-Bold').fontSize(22).text('PÊCHE CONNECT');
    doc.fillColor('#111111').fontSize(9).font('Helvetica').text(f.societe.raison + ' · ' + f.societe.forme + ' au capital de ' + f.societe.capital + ' · SIRET ' + f.societe.siret + ' · RCS ' + f.societe.rcs);
    doc.text(f.societe.adresse + ' · N° TVA ' + f.societe.tva + ' · ' + f.societe.email);
    doc.moveDown(1.2).font('Helvetica-Bold').fontSize(16).text('Facture ' + f.numero);
    doc.font('Helvetica').fontSize(10).text('Date : ' + jour(f.emiseLe) + ' · Commande ' + f.bon + ' · Acquittée le ' + jour(f.payeeLe) + ' par carte bancaire');
    doc.moveDown().font('Helvetica-Bold').text('Client');
    doc.font('Helvetica').text(f.acheteur.raison + ' · SIRET ' + f.acheteur.siret.replace(/(\d{3})(\d{3})(\d{3})(\d{5})/, '$1 $2 $3 $4'));
    doc.text((f.acheteur.adresse ? f.acheteur.adresse + ', ' : '') + f.acheteur.commune);

    const tableau = (titre: string, sousTitre: string, lignes: { designation: string; detail?: string; total: number }[], bloc: { ht: number; tva: number; ttc: number; taux: number }) => {
      doc.moveDown(1.2).font('Helvetica-Bold').fontSize(12).fillColor(marine).text(titre).fillColor('#111111');
      doc.font('Helvetica').fontSize(9).text(sousTitre);
      doc.moveDown(0.4).fontSize(10);
      for (const l of lignes) {
        const y = doc.y;
        doc.text(l.designation + (l.detail ? ' — ' + l.detail : ''), 50, y, { width: 380 });
        doc.text(euro(l.total), 430, y, { width: 115, align: 'right' });
      }
      doc.moveDown(0.3);
      for (const [lib, val, gras] of [['Total HT', bloc.ht, false], ['TVA ' + pct(bloc.taux), bloc.tva, false], ['Total TTC', bloc.ttc, true]] as const) {
        const y = doc.y; doc.font(gras ? 'Helvetica-Bold' : 'Helvetica');
        doc.text(lib, 300, y, { width: 130 }); doc.text(euro(val), 430, y, { width: 115, align: 'right' });
      }
      doc.font('Helvetica'); doc.x = 50; // retour à la marge gauche
    };
    const v = f.vendeur;
    tableau('1. Produits de la mer', 'Vendus par ' + (v.nomLegal ?? v.prenom) + (v.siret ? ' (SIRET ' + v.siret + ')' : '') + ', pêcheur professionnel, bateau « ' + v.bateau + ' »' + (v.immatriculation ? ' (' + v.immatriculation + ')' : '') + ', port de ' + v.port
      + '. Facture émise par Pêche Connect au nom et pour le compte du vendeur (mandat de facturation).',
      f.poisson.lignes.map((l) => ({ designation: l.designation, detail: l.detail ?? String(l.kg).replace('.', ',') + ' kg × ' + euro(l.prixKgTtc) + ' TTC/kg', total: l.totalTtc })), f.poisson);
    tableau('2. Services Pêche Connect', 'Vendus par ' + f.societe.raison + '.', f.services.lignes.map((l) => ({ designation: l.designation, total: l.totalTtc })), f.services);
    doc.moveDown(1.2).font('Helvetica-Bold').fontSize(13).text('Total payé : ' + euro(f.totalTtc), 50, doc.y, { width: 495, align: 'right' });
    doc.moveDown(2).font('Helvetica').fontSize(8).fillColor('#62625d');
    doc.text('Facture acquittée : aucun montant restant dû. Pour mémoire (art. L441-10 du Code de commerce) : en cas de retard de paiement, pénalités au taux '
        + 'd’intérêt de la BCE majoré de 10 points et indemnité forfaitaire de 40 € pour frais de recouvrement. Pas d’escompte pour paiement anticipé. '
        + 'Document généré automatiquement, conservé 10 ans. Taux de TVA appliqués sous réserve de validation par l’expert-comptable.', 50, doc.y, { width: 495 });
    doc.end();
  });
}
