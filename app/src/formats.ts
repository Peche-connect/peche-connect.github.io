// Formats de vente : mêmes règles que le serveur (firebase/functions/src/formats.ts)
import { FRAIS_SERVICE, kg, MARGE_EMPREINTE, euro } from './format';
import type { Format, LignePanier, Produit } from './types';

export const NOMS_FORMATS: Record<Format, string> = { kilo: 'Au kilo', piece: 'À la pièce', portion: 'En barquettes', lot: 'En lot' };

// Format proposé d'office selon l'espèce (le pêcheur peut le changer)
export function formatParDefaut(espece: string): Format {
  if (['Dorade coryphène', 'Thazard', 'Vivaneau', 'Bonite', 'Langouste'].includes(espece)) return 'piece';
  if (['Poisson volant', 'Lambi'].includes(espece)) return 'lot';
  return 'kilo';
}

export function produitParDefaut(espece: string, format: Format = formatParDefaut(espece)): Omit<Produit, 'id'> {
  const base = { espece, format, prixKg: 12, dispoKg: 0, preparations: [] as Produit['preparations'] };
  switch (format) {
    case 'kilo': return { ...base, dispoKg: 5, pasKg: 0.5, preparations: espece === 'Thon jaune' ? [{ nom: 'En tranches', supplementKg: 0 }, { nom: 'En darnes', supplementKg: 1 }] : [{ nom: 'Entier', supplementKg: 0 }, { nom: 'Écaillé et vidé', supplementKg: 1 }] };
    case 'piece': return { ...base, prixKg: 13, pieces: [{ id: 'p1', poidsKg: 3 }, { id: 'p2', poidsKg: 4 }], teteAuChoix: espece !== 'Langouste',
      preparations: espece === 'Langouste' ? [{ nom: 'Vivante', supplementKg: 0 }] : [{ nom: 'Entier', supplementKg: 0 }, { nom: 'Écaillé et vidé', supplementKg: 1 }] };
    case 'portion': return { ...base, prixKg: 18, portion: { type: espece.startsWith('Thon') || espece === 'Thazard' ? 'Darnes' : 'Filets', poidsKg: 0.5, nombre: 6 } };
    case 'lot': return { ...base, prixKg: 0, lot: espece === 'Lambi' ? { quantite: 1, unite: 'kg', prix: 25, nombre: 5 } : { quantite: 10, unite: 'pièces', prix: 10, nombre: 5 } };
  }
}

// Anciennes données (sans format) : vendues au kilo
export const normaliserProduit = (p: Produit): Produit => (p.format ? p : { ...p, format: 'kilo', pasKg: 0.5 });

export const stockKg = (p: Produit) =>
  p.format === 'piece' ? (p.pieces ?? []).reduce((t, x) => t + x.poidsKg, 0)
  : p.format === 'portion' ? (p.portion ? p.portion.nombre * p.portion.poidsKg : 0)
  : p.format === 'lot' ? (p.lot?.unite === 'kg' ? p.lot.quantite * p.lot.nombre : 0)
  : p.dispoKg;
export const disponible = (p: Produit) =>
  p.format === 'piece' ? (p.pieces ?? []).length > 0 : p.format === 'portion' ? (p.portion?.nombre ?? 0) > 0 : p.format === 'lot' ? (p.lot?.nombre ?? 0) > 0 : p.dispoKg > 0;

export const nomLot = (l: NonNullable<Produit['lot']>) => 'lot de ' + (l.unite === 'kg' ? kg(l.quantite) : l.quantite + ' pièces');
export const nomBarquette = (b: NonNullable<Produit['portion']>) => 'barquette de ' + b.type.toLowerCase() + ' ~' + kg(b.poidsKg);

// Ce que voit le client sous le nom de l'espèce
export function offre(p: Produit) {
  switch (p.format) {
    case 'piece': return { prix: euro(p.prixKg) + '/kg', detail: (p.espece === 'Langouste' ? 'À la pièce' : 'Poisson entier') + (p.teteAuChoix ? ', avec ou sans tête' : '') + ' · prix au poids réel', reste: (p.pieces ?? []).length + ' poisson' + ((p.pieces ?? []).length > 1 ? 's' : '') };
    case 'portion': return { prix: euro(p.prixKg) + '/kg', detail: p.portion ? 'Barquettes de ' + p.portion.type.toLowerCase() + ' ~' + kg(p.portion.poidsKg) + ' (≈ ' + euro(p.portion.poidsKg * p.prixKg) + ')' : '', reste: (p.portion?.nombre ?? 0) + ' barquette' + ((p.portion?.nombre ?? 0) > 1 ? 's' : '') };
    case 'lot': return { prix: p.lot ? euro(p.lot.prix) + ' le ' + nomLot(p.lot) : '', detail: 'Prix fixe, sans pesée', reste: (p.lot?.nombre ?? 0) + ' lot' + ((p.lot?.nombre ?? 0) > 1 ? 's' : '') };
    default: return { prix: euro(p.prixKg) + '/kg', detail: p.preparations.length > 1 ? p.preparations[0].nom + ' ou ' + p.preparations[1].nom.toLowerCase() + (p.preparations[1].supplementKg ? ' (+' + p.preparations[1].supplementKg + ' €/kg)' : '') : p.preparations[0]?.nom ?? 'Entier', reste: kg(p.dispoKg) };
  }
}

// ───────── Montants des lignes ─────────
export const pesable = (l: LignePanier) => l.format !== 'lot';
export const valeur = (l: LignePanier) => (l.format === 'lot' ? (l.nombre ?? 0) * (l.prixLot ?? 0) : l.kg * (l.prixKg + l.supplementKg));
export const sousTotal = (lignes: LignePanier[]) => lignes.reduce((t, l) => t + valeur(l), 0);
const arrondi = (n: number) => Math.round(n * 100) / 100;
// Empreinte : les lignes pesées + marge, les lots au prix fixe, frais de service et livraison
export const montantBloque = (lignes: LignePanier[], livraison = 0) =>
  arrondi(arrondi(lignes.filter(pesable).reduce((t, l) => t + valeur(l), 0) * (1 + MARGE_EMPREINTE) + lignes.filter((l) => !pesable(l)).reduce((t, l) => t + valeur(l), 0) + FRAIS_SERVICE) + livraison);
export const montantPaye = (lignes: LignePanier[], livraison = 0) => arrondi(sousTotal(lignes) + FRAIS_SERVICE + livraison);

export const cleLigne = (l: { produitId: string; pieceId?: string }) => (l.pieceId ? l.produitId + '#' + l.pieceId : l.produitId);

// Texte d'une ligne : « Dorade coryphène entière ~4 kg, sans tête », « 2 barquettes de filets ~500 g »…
export function libelleLigne(l: LignePanier) {
  if (l.format === 'lot') return l.espece + ' · ' + (l.nombre ?? 1) + ' × ' + (l.libelle ?? 'lot');
  if (l.format === 'portion') return l.espece + ' · ' + (l.nombre ?? 1) + ' × ' + (l.libelle ?? 'barquette');
  if (l.format === 'piece') return l.espece + ' · 1 ' + (l.espece === 'Langouste' ? 'pièce' : 'poisson entier') + ' ~' + kg(l.kg) + (l.tete === 'sans' ? ', sans tête' : '');
  return l.espece + ' · ' + kg(l.kg);
}

// Presque épuisé : moins de 3 kg au kilo, un seul poisson, 2 barquettes ou 2 lots
export const peuDispo = (p: Produit) =>
  p.format === 'piece' ? (p.pieces ?? []).length <= 1 : p.format === 'portion' ? (p.portion?.nombre ?? 0) <= 2 : p.format === 'lot' ? (p.lot?.nombre ?? 0) <= 2 : p.dispoKg <= 3;

// Préparation affichée sur le bon (« écaillé et vidé », « sans tête »…)
export const preparationLigne = (l: LignePanier) =>
  l.format === 'lot' || l.format === 'portion' ? '' : [l.preparation.toLowerCase(), l.tete === 'sans' && l.format !== 'piece' ? 'sans tête' : ''].filter(Boolean).join(', ');
// Quantité à droite : poids (≈ avant pesée) ou prix du lot
export const quantiteLigne = (l: LignePanier, pese: boolean) => (l.format === 'lot' ? euro(valeur(l)) : (pese ? '' : '~') + kg(l.kg));
