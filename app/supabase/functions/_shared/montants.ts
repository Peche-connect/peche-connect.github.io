// Montants : mêmes règles que l'appli (app/src/format.ts). Les taux viennent de la table « reglages ».
export type Reglages = {
  frais_service: number;
  commission_pct: number;
  marge_empreinte: number;
  livraison_min_kg: number;
  frais_livraison: number;
};
export type Ligne = { kg: number; prixKg: number; supplementKg: number };

const arrondi = (n: number) => Math.round(n * 100) / 100;
export const sousTotal = (lignes: Ligne[]) => lignes.reduce((s, l) => s + l.kg * (l.prixKg + l.supplementKg), 0);

// Empreinte bloquée à la réservation (poids estimé + marge + frais)
export const montantBloque = (r: Reglages, lignes: Ligne[], fraisLivraison = 0) =>
  arrondi(sousTotal(lignes) * (1 + Number(r.marge_empreinte)) + Number(r.frais_service)) + fraisLivraison;

// À la pesée : poids réel + frais ; part de la plateforme = commission + frais de service + livraison
export function montantsPesee(r: Reglages, lignesPesees: Ligne[], fraisLivraison = 0) {
  const st = sousTotal(lignesPesees);
  const total = arrondi(st + Number(r.frais_service) + fraisLivraison);
  const plateforme = arrondi(st * Number(r.commission_pct) + Number(r.frais_service) + fraisLivraison);
  return { total, plateforme, pourLePecheur: arrondi(total - plateforme) };
}
