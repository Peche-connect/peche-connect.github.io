// Informations obligatoires pour la vente de poisson au consommateur (règlement UE 1379/2013, art. 35) :
// dénomination commerciale + nom scientifique, méthode de production (« pêché »), zone de capture (zone FAO),
// catégorie d'engin de pêche. Dénominations : liste officielle de la DGCCRF (juillet 2026) quand l'espèce y est ;
// sinon nom FAO. « aConfirmer » : correspondance nom local → espèce à faire valider par la Direction de la Mer.
// FICHIER COPIÉ À L'IDENTIQUE dans firebase/functions/src/especes.ts (un test vérifie qu'ils sont pareils).

export const ZONE_CAPTURE = 'Atlantique Centre-Ouest (zone FAO 31)';
export const METHODE = 'pêché';

// Catégories d'engins de l'annexe III du règlement 1379/2013 (+ plongée, à confirmer pour le lambi et le chatrou)
export const ENGINS = ['Lignes et hameçons', 'Casiers et pièges', 'Filets maillants et filets similaires', 'Sennes',
  'Filets tournants et filets soulevés', 'Plongée (à la main)'] as const;
export type Engin = typeof ENGINS[number];

export type InfoEspece = { denomination: string; scientifique: string; fao: string; engin: Engin; aConfirmer?: boolean };
export const INFOS_ESPECES: Record<string, InfoEspece> = {
  'Thon jaune': { denomination: 'Albacore (thon jaune)', scientifique: 'Thunnus albacares', fao: 'YFT', engin: 'Lignes et hameçons' },
  'Bonite': { denomination: 'Bonite à ventre rayé, listao', scientifique: 'Katsuwonus pelamis', fao: 'SKJ', engin: 'Lignes et hameçons', aConfirmer: true },
  'Dorade coryphène': { denomination: 'Dorade-coryphène', scientifique: 'Coryphaena hippurus', fao: 'DOL', engin: 'Lignes et hameçons' },
  'Balaou': { denomination: 'Demi-bec du Brésil (balaou)', scientifique: 'Hemiramphus brasiliensis', fao: 'BAL', engin: 'Sennes', aConfirmer: true },
  'Vivaneau': { denomination: 'Vivaneau soie', scientifique: 'Lutjanus vivanus', fao: 'LTJ', engin: 'Lignes et hameçons', aConfirmer: true },
  'Colas': { denomination: 'Colas', scientifique: 'Pristipomoides spp.', fao: '', engin: 'Lignes et hameçons', aConfirmer: true },
  'Coulirou': { denomination: 'Sélar coulisou (coulirou)', scientifique: 'Selar crumenophthalmus', fao: 'BIS', engin: 'Sennes' },
  'Thazard': { denomination: 'Thazard barré', scientifique: 'Scomberomorus cavalla', fao: 'KGM', engin: 'Lignes et hameçons', aConfirmer: true },
  'Chatrou': { denomination: 'Poulpe (chatrou)', scientifique: 'Octopus vulgaris', fao: 'OCC', engin: 'Casiers et pièges', aConfirmer: true },
  'Langouste': { denomination: 'Langouste blanche', scientifique: 'Panulirus argus', fao: 'SLC', engin: 'Casiers et pièges', aConfirmer: true },
  'Lambi': { denomination: 'Strombe rose (lambi)', scientifique: 'Aliger gigas', fao: 'CRC', engin: 'Plongée (à la main)', aConfirmer: true },
  'Poisson volant': { denomination: 'Poisson volant', scientifique: 'Hirundichthys affinis', fao: 'FFL', engin: 'Filets maillants et filets similaires', aConfirmer: true },
};

export const enginDefaut = (espece: string): Engin => INFOS_ESPECES[espece]?.engin ?? 'Lignes et hameçons';
export const enginValide = (x: unknown): Engin | null => (ENGINS as readonly string[]).includes(String(x)) ? (x as Engin) : null;

// Ligne affichée sous le produit, sur le bon et sur la facture
export function mentionsObligatoires(espece: string, engin?: string) {
  const i = INFOS_ESPECES[espece];
  if (!i) return METHODE + ' en ' + ZONE_CAPTURE;
  return i.denomination + ' · ' + i.scientifique + ' · ' + METHODE + ' en ' + ZONE_CAPTURE + ' · ' + (engin || i.engin).toLowerCase();
}
