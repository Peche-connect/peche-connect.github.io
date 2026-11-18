// Formats de vente, côté serveur (mêmes règles que l'appli, src/formats.ts) :
//  - kilo    : petits poissons ou thon à la découpe, le client choisit le poids ;
//  - piece   : gros poissons, le pêcheur liste chaque poisson avec un poids approximatif ;
//  - portion : barquettes déjà préparées (filets, darnes, tranches), poids approximatif ;
//  - lot     : prix fixe (poisson volant, lambi), sans pesée.
import { randomBytes } from 'node:crypto';
import { erreur } from './commun';
import { preparationConnue } from './regles';

export type Format = 'kilo' | 'piece' | 'portion' | 'lot';
export const FORMATS: Format[] = ['kilo', 'piece', 'portion', 'lot'];
export const TYPES_PORTION = ['Filets', 'Darnes', 'Tranches'] as const;
type Prep = { nom: string; supplementKg: number };
export type Produit = {
  id: string; espece: string; format?: Format; prixKg: number; dispoKg: number; preparations: Prep[];
  pasKg?: number; pieces?: { id: string; poidsKg: number }[]; teteAuChoix?: boolean;
  portion?: { type: typeof TYPES_PORTION[number]; poidsKg: number; nombre: number };
  lot?: { quantite: number; unite: 'pièces' | 'kg'; prix: number; nombre: number };
};
export type LigneBon = {
  produitId: string | null; espece: string; format?: Format; kg: number; prixKg: number; preparation: string; supplementKg: number;
  pieceId?: string; tete?: 'avec' | 'sans'; nombre?: number; prixLot?: number; libelle?: string;
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const entier = (n: unknown, min: number, max: number) => { const x = Number(n); return Number.isInteger(x) && x >= min && x <= max ? x : null; };
const kgTxt = (n: number) => (n < 1 ? Math.round(n * 1000) + ' g' : String(r1(n)).replace('.', ',') + ' kg');
export const formatDe = (p: { format?: Format }) => p.format ?? 'kilo'; // anciennes données : au kilo

export const stockKg = (p: Produit) => {
  switch (formatDe(p)) {
    case 'piece': return r1((p.pieces ?? []).reduce((t, x) => t + x.poidsKg, 0));
    case 'portion': return p.portion ? r1(p.portion.nombre * p.portion.poidsKg) : 0;
    case 'lot': return p.lot?.unite === 'kg' ? r1(p.lot.quantite * p.lot.nombre) : 0;
    default: return p.dispoKg;
  }
};
export const disponible = (p: Produit) => {
  switch (formatDe(p)) {
    case 'piece': return (p.pieces ?? []).length > 0;
    case 'portion': return (p.portion?.nombre ?? 0) > 0;
    case 'lot': return (p.lot?.nombre ?? 0) > 0;
    default: return p.dispoKg > 0;
  }
};
// clé d'un produit d'un arrivage à l'autre (garde le même identifiant)
export const cleProduit = (p: { espece: string; format?: Format; portion?: { type: string } }) =>
  p.espece + '|' + formatDe(p) + (formatDe(p) === 'portion' ? '|' + (p.portion?.type ?? '') : '');

function preparations(brut: unknown, espece: string, defaut: string): Prep[] {
  const l = Array.isArray(brut) && brut.length ? brut : [{ nom: defaut, supplementKg: 0 }];
  const ps = l.slice(0, 5).map((p) => ({ nom: preparationConnue((p as Prep)?.nom), supplementKg: Math.max(0, Math.min(50, r2(Number((p as Prep)?.supplementKg) || 0))) }));
  if (ps.some((p) => !p.nom)) throw erreur('invalid-argument', 'Préparation inconnue pour ' + espece + '.');
  return ps as Prep[];
}

// Contrôle d'un produit envoyé par le pêcheur ; renvoie null s'il n'y a rien à vendre
export function produitValide(l: Record<string, unknown>, espece: string): Omit<Produit, 'id'> | null {
  const format = (FORMATS.includes(l.format as Format) ? l.format : 'kilo') as Format;
  const prixKg = r2(Number(l.prixKg));
  const prixOk = prixKg > 0 && prixKg < 500;
  const faux = (m: string) => erreur('invalid-argument', m + ' pour ' + espece + '.');
  switch (format) {
    case 'kilo': {
      const dispoKg = r1(Number(l.dispoKg));
      if (!(dispoKg > 0)) return null;
      if (!prixOk || dispoKg > 1000) throw faux('Prix ou quantité invalide');
      const pasKg = [0.5, 1, 2, 5].includes(Number(l.pasKg)) ? Number(l.pasKg) : 0.5; // minimum et pas fixés par le pêcheur
      return { espece, format, prixKg, dispoKg, pasKg, preparations: preparations(l.preparations, espece, 'Entier') };
    }
    case 'piece': {
      const brut = Array.isArray(l.pieces) ? l.pieces : [];
      if (brut.length > 40) throw faux('Au plus 40 poissons');
      const pieces = brut.map((x) => r1(Number((x as { poidsKg?: unknown })?.poidsKg)));
      if (!pieces.length) return null;
      if (!prixOk || pieces.some((x) => !(x >= 0.1 && x <= 150))) throw faux('Prix ou poids invalide');
      const p = { espece, format, prixKg, teteAuChoix: l.teteAuChoix === true, preparations: preparations(l.preparations, espece, 'Entier'),
        pieces: pieces.map((poidsKg, k) => {
          // garde l'identifiant d'un poisson déjà en vente (paniers en cours), sinon en crée un
          const id = String((brut[k] as { id?: unknown })?.id ?? '');
          return { id: /^[a-z0-9-]{1,16}$/.test(id) && brut.findIndex((y) => (y as { id?: unknown })?.id === id) === k ? id : randomBytes(4).toString('hex'), poidsKg };
        }), dispoKg: 0 };
      return { ...p, dispoKg: stockKg({ ...p, id: '' }) };
    }
    case 'portion': {
      const b = (l.portion ?? {}) as Record<string, unknown>;
      const type = TYPES_PORTION.find((t) => t === b.type);
      const nombre = entier(b.nombre, 0, 200); const poidsKg = r1(Number(b.poidsKg));
      if (nombre === 0) return null;
      if (!type || nombre === null || !(poidsKg >= 0.1 && poidsKg <= 5) || !prixOk) throw faux('Barquettes invalides');
      return { espece, format, prixKg, preparations: [], portion: { type, poidsKg, nombre }, dispoKg: r1(nombre * poidsKg) };
    }
    case 'lot': {
      const b = (l.lot ?? {}) as Record<string, unknown>;
      const unite = b.unite === 'kg' ? 'kg' : 'pièces';
      const nombre = entier(b.nombre, 0, 200); const prix = r2(Number(b.prix));
      const quantite = unite === 'kg' ? r1(Number(b.quantite)) : entier(b.quantite, 1, 500);
      if (nombre === 0) return null;
      if (nombre === null || quantite === null || (unite === 'kg' && !(quantite >= 0.1 && quantite <= 100)) || !(prix > 0 && prix < 1000)) throw faux('Lot invalide');
      return { espece, format, prixKg: 0, preparations: [], lot: { quantite, unite, prix, nombre }, dispoKg: unite === 'kg' ? r1(quantite * nombre) : 0 };
    }
  }
}

// Ce que le client demande pour une ligne de son panier
export type Demande = { produitId?: unknown; kg?: unknown; preparation?: unknown; pieceId?: unknown; tete?: unknown; nombre?: unknown };

// Retire du stock (produit déjà copié) et renvoie la ligne du bon, avec les prix du serveur
export function prendre(p: Produit, l: Demande): LigneBon {
  const plusAssez = (reste: string) => erreur('failed-precondition', 'Plus assez de ' + p.espece.toLowerCase() + ' (reste ' + reste + ').');
  const prep = (nom: unknown) => p.preparations.find((x) => x.nom === nom) ?? p.preparations[0] ?? { nom: 'Entier', supplementKg: 0 };
  switch (formatDe(p)) {
    case 'piece': {
      const piece = (p.pieces ?? []).find((x) => x.id === l.pieceId);
      if (!piece) throw erreur('failed-precondition', 'Ce poisson (' + p.espece.toLowerCase() + ') vient d’être réservé par quelqu’un d’autre.');
      p.pieces = (p.pieces ?? []).filter((x) => x !== piece); p.dispoKg = stockKg(p);
      const pr = prep(l.preparation);
      return { produitId: p.id, espece: p.espece, format: 'piece', kg: piece.poidsKg, prixKg: p.prixKg, preparation: pr.nom, supplementKg: pr.supplementKg,
        pieceId: piece.id, tete: p.teteAuChoix && l.tete === 'sans' ? 'sans' : 'avec' };
    }
    case 'portion': {
      const n = entier(l.nombre, 1, 200); const b = p.portion!;
      if (n === null) throw erreur('invalid-argument', 'Nombre de barquettes invalide.');
      if (n > b.nombre) throw plusAssez(b.nombre + ' barquette' + (b.nombre > 1 ? 's' : ''));
      b.nombre -= n; p.dispoKg = stockKg(p);
      return { produitId: p.id, espece: p.espece, format: 'portion', kg: r1(n * b.poidsKg), prixKg: p.prixKg, preparation: b.type, supplementKg: 0,
        nombre: n, libelle: 'barquette de ' + b.type.toLowerCase() + ' ~' + kgTxt(b.poidsKg) };
    }
    case 'lot': {
      const n = entier(l.nombre, 1, 200); const b = p.lot!;
      if (n === null) throw erreur('invalid-argument', 'Nombre de lots invalide.');
      if (n > b.nombre) throw plusAssez(b.nombre + ' lot' + (b.nombre > 1 ? 's' : ''));
      b.nombre -= n; p.dispoKg = stockKg(p);
      return { produitId: p.id, espece: p.espece, format: 'lot', kg: b.unite === 'kg' ? r1(n * b.quantite) : 0, prixKg: 0, preparation: 'Lot', supplementKg: 0,
        nombre: n, prixLot: b.prix, libelle: 'lot de ' + (b.unite === 'kg' ? kgTxt(b.quantite) : b.quantite + ' pièces') };
    }
    default: {
      const kg = r1(Number(l.kg));
      if (!(kg > 0)) throw erreur('invalid-argument', 'Quantité invalide.');
      if (kg > p.dispoKg) throw plusAssez(String(p.dispoKg).replace('.', ',') + ' kg');
      p.dispoKg = r1(p.dispoKg - kg);
      const pr = prep(l.preparation);
      return { produitId: p.id, espece: p.espece, format: 'kilo', kg, prixKg: p.prixKg, preparation: pr.nom, supplementKg: pr.supplementKg };
    }
  }
}

// Remet en vente le poisson d'un bon annulé (si le produit est toujours à l'étal)
export function rendre(produits: Produit[], lignes: LigneBon[]) {
  return produits.map((p0) => {
    const ls = lignes.filter((l) => l.produitId === p0.id); if (!ls.length) return p0;
    const p: Produit = JSON.parse(JSON.stringify(p0));
    for (const l of ls) {
      const f = l.format ?? 'kilo';
      if (f !== formatDe(p)) continue;
      if (f === 'piece' && l.pieceId && !(p.pieces ?? []).some((x) => x.id === l.pieceId)) p.pieces = [...(p.pieces ?? []), { id: l.pieceId, poidsKg: l.kg }];
      else if (f === 'portion' && p.portion) p.portion.nombre += l.nombre ?? 0;
      else if (f === 'lot' && p.lot) p.lot.nombre += l.nombre ?? 0;
      else if (f === 'kilo') p.dispoKg = r1(p.dispoKg + l.kg);
    }
    p.dispoKg = stockKg(p);
    return p;
  });
}

// À la pesée : poids réel (kilo, pièce, barquettes) ou nombre de lots remis (au plus le nombre réservé)
export function appliquerPesee(lignes: LigneBon[], valeurs: number[]): LigneBon[] {
  return lignes.map((l, i) => {
    if ((l.format ?? 'kilo') !== 'lot') return { ...l, kg: r1(valeurs[i]) };
    const n = Math.round(valeurs[i]);
    if (n > (l.nombre ?? 0)) throw erreur('invalid-argument', 'Plus de lots remis que réservés.');
    return { ...l, nombre: n, kg: l.nombre ? r1(l.kg * n / l.nombre) : 0 };
  });
}
export const rienRemis = (lignes: LigneBon[]) => lignes.every((l) => ((l.format ?? 'kilo') === 'lot' ? (l.nombre ?? 0) === 0 : l.kg === 0));
