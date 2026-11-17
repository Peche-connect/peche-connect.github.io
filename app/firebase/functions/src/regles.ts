// Règles métier sans base de données : montants, QR signé, masquage des numéros, fermetures.
// Testées par src/_tests/regles.test.ts.
import { createHmac, timingSafeEqual } from 'node:crypto';

export type Ligne = { kg: number; prixKg: number; supplementKg: number };
type R = { fraisService: number; commissionPct: number; margeEmpreinte: number };
const arrondi = (n: number) => Math.round(n * 100) / 100;

export const sousTotal = (lignes: Ligne[]) => lignes.reduce((s, l) => s + l.kg * (l.prixKg + l.supplementKg), 0);

// Empreinte bloquée à la réservation (poids estimé + marge + frais de service + livraison)
export const montantBloque = (r: R, lignes: Ligne[], fraisLivraison = 0) =>
  arrondi(arrondi(sousTotal(lignes) * (1 + r.margeEmpreinte) + r.fraisService) + fraisLivraison);

// À la pesée : poids réel + frais ; part de la plateforme = commission + frais de service + livraison
export function montantsPesee(r: R, lignesPesees: Ligne[], fraisLivraison = 0) {
  const st = sousTotal(lignesPesees);
  const total = arrondi(st + r.fraisService + fraisLivraison);
  const plateforme = arrondi(st * r.commissionPct + r.fraisService + fraisLivraison);
  return { total, plateforme, pourLePecheur: arrondi(total - plateforme) };
}

// QR du bon : lien signé (HMAC-SHA256), impossible à fabriquer sans la clé QR_SECRET
export const signerBon = (secret: string, code: string, bonId: string) =>
  createHmac('sha256', secret).update(code + '|' + bonId).digest('base64url').slice(0, 22);
export function signatureValide(secret: string, code: string, bonId: string, signature: string) {
  const a = Buffer.from(signerBon(secret, code, bonId)); const b = Buffer.from(String(signature));
  return a.length === b.length && timingSafeEqual(a, b);
}

// Anti-contournement : numéros de téléphone masqués dans les messages écrits
const NUMERO = /\+?\d[\d .-]{7,}\d/g;
export const masquerNumeros = (t: string) => ({ texte: t.replace(NUMERO, '•• •• •• •• ••'), masque: new RegExp(NUMERO.source).test(t) });

// Périodes de fermeture connues (Direction de la Mer de Martinique, à revérifier chaque année),
// complétées par la collection « fermetures » de la base
export type Fermeture = { espece: string; debut: string; fin: string; motif: string; port?: string | null }; // « MM-JJ »
export const FERMETURES_CONNUES: Fermeture[] = [
  { espece: 'Lambi', debut: '01-01', fin: '06-30', motif: 'Pêche et vente du lambi frais interdites du 1er janvier au 30 juin' },
  { espece: 'Langouste', debut: '06-01', fin: '09-30', motif: 'Pêche de la langouste fermée du 1er juin au 30 septembre' },
];
export function fermetureActive(fermetures: Fermeture[], espece: string, port: string, jour = new Date()) {
  const md = String(jour.getUTCMonth() + 1).padStart(2, '0') + '-' + String(jour.getUTCDate()).padStart(2, '0');
  return fermetures.find((f) => f.espece.toLowerCase() === espece.toLowerCase() && (!f.port || f.port === port)
    && (f.debut <= f.fin ? md >= f.debut && md <= f.fin : md >= f.debut || md <= f.fin)) ?? null;
}
