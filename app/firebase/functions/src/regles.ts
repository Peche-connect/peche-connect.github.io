// Règles métier sans base de données : listes fermées, montants, QR signé, masquage des numéros,
// fermetures, créneaux. Testées par src/_tests/regles.test.ts.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// ───────── Listes fermées (aucun texte libre affiché aux autres sans contrôle) ─────────
export const ESPECES = ['Thon jaune', 'Bonite', 'Dorade coryphène', 'Balaou', 'Vivaneau', 'Colas', 'Coulirou', 'Thazard', 'Chatrou', 'Langouste', 'Lambi', 'Poisson volant'];
export const PREPARATIONS = ['Entier', 'Entière', 'Vendu entier', 'Vivante', 'Nettoyé', 'Écaillé et vidé', 'En tranches', 'En filets', 'En darnes'];
export const PORTS = ['Grand-Rivière', 'Basse-Pointe', 'Le Marigot', 'Tartane', 'Trinité', 'Le Robert', 'Le François', 'Le Vauclin', 'Le Marin',
  'Sainte-Anne', 'Sainte-Luce', 'Le Diamant', 'Les Anses-d’Arlet', 'Les Trois-Îlets', 'Ducos', 'Le Lamentin', 'Fort-de-France', 'Fond Lahaye',
  'Case-Pilote', 'Belle-Fontaine', 'Le Carbet', 'Saint-Pierre', 'Le Prêcheur'];
export const TYPES_PRO = ['Restaurant', 'Poissonnerie', 'Revendeur', 'Traiteur'];
export const CODE_BON = /^R-\d{1,9}$/;

// Normalise un texte saisi : forme Unicode standard (les chiffres « pleine chasse » deviennent 0-9),
// espaces multiples réduits, caractères de contrôle retirés
const INVISIBLES = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202f\\u2060-\\u206f]', 'g');
export const normaliser = (t: unknown) => String(t ?? '').normalize('NFKC').replace(INVISIBLES, '').replace(/\s+/g, ' ').trim();
const ACCENTS = new RegExp('[\\u0300-\\u036f]', 'g');
const sansAccents = (t: string) => t.normalize('NFD').replace(ACCENTS, '').toLowerCase();

// Prénom, nom de bateau, raison sociale : lettres, chiffres limités (3 au plus), ponctuation simple
export function nomPropre(t: unknown, min: number, max: number) {
  const n = normaliser(t);
  if (n.length < min || n.length > max) return null;
  if (!/^[\p{L}\p{M}0-9 '’.&-]+$/u.test(n)) return null;
  if ((n.match(/\d/g) ?? []).length > 3) return null;
  return n;
}
export const especeConnue = (t: unknown) => ESPECES.find((e) => sansAccents(e) === sansAccents(normaliser(t))) ?? null;
export const portConnu = (t: unknown) => PORTS.find((p) => sansAccents(p) === sansAccents(normaliser(t))) ?? null;
export const preparationConnue = (t: unknown) => PREPARATIONS.find((p) => sansAccents(p) === sansAccents(normaliser(t))) ?? null;

// ───────── Montants ─────────
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

// ───────── Créneaux de retrait (liste fermée, calculée comme dans l'appli) ─────────
const heure = (m: number) => Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + String(m % 60).padStart(2, '0') : '');
export function creneaux(limiteRetrait: number) {
  const c = ['Avant 10 h'];
  if (limiteRetrait > 600) c.push('10 h – ' + (limiteRetrait >= 720 ? '12 h' : heure(limiteRetrait)));
  if (limiteRetrait > 720) c.push('12 h – ' + heure(limiteRetrait));
  return c;
}

// ───────── QR du bon et code de retrait ─────────
// Au paiement, le serveur tire un secret aléatoire propre au bon (« nonce »). Le QR contient
// HMAC(QR_SECRET, code|nonce) et le client voit aussi un code de retrait à 6 chiffres tiré du même
// calcul. Après le retrait, le nonce est effacé : l'ancien QR ne vaut plus rien.
export const nouveauNonce = () => randomBytes(16).toString('hex');
const hmac = (secret: string, texte: string) => createHmac('sha256', secret).update(texte).digest();
export const signerBon = (secret: string, code: string, nonce: string) => hmac(secret, code + '|' + nonce).toString('base64url').slice(0, 22);
export const codeRetrait = (secret: string, code: string, nonce: string) => String(hmac(secret, 'retrait|' + code + '|' + nonce).readUInt32BE(0) % 1_000_000).padStart(6, '0');
const egal = (a: string, b: string) => { const x = Buffer.from(a); const y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
// Accepte le QR scanné (signature longue) OU le code de retrait à 6 chiffres donné par le client
export function preuveValide(secret: string, code: string, nonce: string | undefined, preuve: string) {
  if (!nonce || !preuve) return false;
  const p = String(preuve).trim();
  return /^\d{6}$/.test(p) ? egal(codeRetrait(secret, code, nonce), p) : egal(signerBon(secret, code, nonce), p);
}

// ───────── Anti-contournement : numéros de téléphone masqués ─────────
// 8 chiffres ou plus, séparés ou non par espaces, points, tirets, barres, soulignés, parenthèses
const NUMERO = /\+?\(?\d(?:[\s./_()-]*\d){7,}/g;
export function masquerNumeros(t: string) {
  const n = String(t).normalize('NFKC');
  const texte = n.replace(NUMERO, '•• •• •• •• ••');
  return { texte, masque: texte !== n };
}
export const contientNumero = (t: string) => masquerNumeros(t).masque;

// ───────── Périodes de fermeture ─────────
// Connues (Direction de la Mer de Martinique, à revérifier chaque année), complétées par la collection « fermetures »
export type Fermeture = { espece: string; debut: string; fin: string; motif: string; port?: string | null }; // « MM-JJ »
export const FERMETURES_CONNUES: Fermeture[] = [
  { espece: 'Lambi', debut: '01-01', fin: '06-30', motif: 'Pêche et vente du lambi frais interdites du 1er janvier au 30 juin' },
  { espece: 'Langouste', debut: '06-01', fin: '09-30', motif: 'Pêche de la langouste fermée du 1er juin au 30 septembre' },
];
export function fermetureActive(fermetures: Fermeture[], espece: string, port: string, jour = new Date()) {
  const md = String(jour.getUTCMonth() + 1).padStart(2, '0') + '-' + String(jour.getUTCDate()).padStart(2, '0');
  return fermetures.find((f) => sansAccents(f.espece) === sansAccents(espece) && (!f.port || f.port === port)
    && (f.debut <= f.fin ? md >= f.debut && md <= f.fin : md >= f.debut || md <= f.fin)) ?? null;
}
