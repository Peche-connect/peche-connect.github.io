import type { Avis, Etal, Produit, TypePortion } from '../types';

// Ports couverts et coordonnées (pour la carte et les distances)
// Ports et abris de pêche de Martinique, d'après la carte « Le réseau de la pêche martiniquaise »
// du Comité régional des pêches (ports territoriaux et APIT). Coordonnées approximatives (bourg / débarcadère).
export type TypePort = 'Port territorial' | 'APIT' | 'Marché' | 'Débarcadère';
// cote : où placer l'étiquette sur la carte (d droite, g gauche, h dessus, b dessous, bg dessous à gauche)
export type CoteEtiquette = 'd' | 'g' | 'h' | 'b' | 'bg';
export const PORTS: Record<string, { lat: number; lon: number; type: TypePort; cote: CoteEtiquette }> = {
  'Grand-Rivière': { lat: 14.872, lon: -61.178, type: 'Port territorial', cote: 'h' },
  'Basse-Pointe': { lat: 14.874, lon: -61.114, type: 'APIT', cote: 'b' },
  'Le Marigot': { lat: 14.818, lon: -61.032, type: 'APIT', cote: 'd' },
  'Tartane': { lat: 14.76, lon: -60.905, type: 'APIT', cote: 'd' },
  'Trinité': { lat: 14.739, lon: -60.963, type: 'Port territorial', cote: 'g' },
  'Le Robert': { lat: 14.678, lon: -60.94, type: 'APIT', cote: 'd' },
  'Le François': { lat: 14.616, lon: -60.903, type: 'Port territorial', cote: 'g' },
  'Le Vauclin': { lat: 14.547, lon: -60.836, type: 'Port territorial', cote: 'g' },
  'Le Marin': { lat: 14.47, lon: -60.868, type: 'Port territorial', cote: 'h' },
  'Sainte-Anne': { lat: 14.437, lon: -60.88, type: 'APIT', cote: 'd' },
  'Sainte-Luce': { lat: 14.468, lon: -60.925, type: 'APIT', cote: 'bg' },
  'Le Diamant': { lat: 14.477, lon: -61.029, type: 'Port territorial', cote: 'g' },
  'Les Anses-d’Arlet': { lat: 14.488, lon: -61.083, type: 'Port territorial', cote: 'g' },
  'Les Trois-Îlets': { lat: 14.54, lon: -61.036, type: 'APIT', cote: 'd' },
  'Ducos': { lat: 14.578, lon: -60.996, type: 'APIT', cote: 'd' },
  'Le Lamentin': { lat: 14.597, lon: -61.017, type: 'APIT', cote: 'd' },
  'Fort-de-France': { lat: 14.603, lon: -61.07, type: 'Marché', cote: 'b' },
  'Fond Lahaye': { lat: 14.617, lon: -61.117, type: 'APIT', cote: 'g' },
  'Case-Pilote': { lat: 14.64, lon: -61.138, type: 'Port territorial', cote: 'd' },
  'Belle-Fontaine': { lat: 14.672, lon: -61.159, type: 'Débarcadère', cote: 'd' },
  'Le Carbet': { lat: 14.709, lon: -61.181, type: 'APIT', cote: 'g' },
  'Saint-Pierre': { lat: 14.743, lon: -61.176, type: 'APIT', cote: 'd' },
  'Le Prêcheur': { lat: 14.802, lon: -61.224, type: 'APIT', cote: 'd' },
};

export const FILTRES = ['Tout', 'Moins d’1 h', 'Thon', 'Vivaneau', 'Dorade', 'Thazard', 'Colas', 'Langouste', 'Lambi'];

export const ESPECES = ['Thon jaune', 'Bonite', 'Dorade coryphène', 'Balaou', 'Vivaneau', 'Colas', 'Coulirou', 'Thazard', 'Chatrou', 'Langouste', 'Lambi', 'Poisson volant'];

const preps = (l: [string, number][]) => l.map(([nom, supplementKg]) => ({ nom, supplementKg }));
// au kilo (petits poissons, thon à la découpe)
const p = (id: string, espece: string, prixKg: number, dispoKg: number, pr: [string, number][]): Produit => ({
  id, espece, format: 'kilo', prixKg, dispoKg, pasKg: 0.5, preparations: preps(pr),
});
// à la pièce : poids approximatif de chaque poisson
const pc = (id: string, espece: string, prixKg: number, poids: number[], pr: [string, number][], teteAuChoix = true): Produit => ({
  id, espece, format: 'piece', prixKg, dispoKg: poids.reduce((t, x) => t + x, 0), teteAuChoix, preparations: preps(pr),
  pieces: poids.map((poidsKg, i) => ({ id: id + '-' + (i + 1), poidsKg })),
});
// barquettes déjà préparées
const bq = (id: string, espece: string, prixKg: number, type: TypePortion, poidsKg: number, nombre: number): Produit => ({
  id, espece, format: 'portion', prixKg, dispoKg: poidsKg * nombre, preparations: [], portion: { type, poidsKg, nombre },
});
// lot à prix fixe
const lt = (id: string, espece: string, quantite: number, unite: 'pièces' | 'kg', prix: number, nombre: number): Produit => ({
  id, espece, format: 'lot', prixKg: 0, dispoKg: unite === 'kg' ? quantite * nombre : 0, preparations: [], lot: { quantite, unite, prix, nombre },
});

// Données d'exemple du mode démo (remplacées par Supabase en production)
export const ETALS_DEMO: Etal[] = [
  { id: 'jm', pecheur: 'Jean-Marc', port: 'Le Robert', note: 4.8, avis: 32, bateau: 'Yole Bèl Lanmè · DCP', debarque: 7 * 60 + 10, limiteRetrait: 12 * 60 + 30,
    lieu: 'Ponton du front de mer, Le Robert', precision: 'yole Bèl Lanmè, à droite de la cale',
    produits: [p('jm1', 'Thon jaune', 14, 22, [['En tranches', 0], ['En darnes', 1]]), pc('jm2', 'Dorade coryphène', 13, [3.2, 4, 4.8], [['Entière', 0], ['Écaillé et vidé', 1]]), bq('jm4', 'Dorade coryphène', 19, 'Filets', 0.5, 6), p('jm3', 'Balaou', 10, 4, [['Vendu entier', 0]])] },
  { id: 'sy', pecheur: 'Sylvio', port: 'Le François', note: 4.7, avis: 18, bateau: 'Yole Ti Kaz · côtière', debarque: 7 * 60 + 35, limiteRetrait: 12 * 60,
    lieu: 'Marché du François', precision: 'premier étal à gauche en entrant',
    produits: [pc('sy1', 'Vivaneau', 18, [1.2, 1.5, 1.8, 2.2], [['Entier', 0], ['Écaillé et vidé', 1]]), p('sy2', 'Colas', 15, 8, [['Entier', 0], ['Écaillé et vidé', 1]]), p('sy3', 'Chatrou', 16, 5, [['Entier', 0], ['Nettoyé', 2]])] },
  { id: 'sp', pecheur: 'Didier', port: 'Saint-Pierre', note: 4.9, avis: 36, bateau: 'Yole Montagne Pelée · DCP', debarque: 7 * 60 + 30, limiteRetrait: 12 * 60,
    lieu: 'Débarcadère de Saint-Pierre', precision: 'sous le carbet bleu, face à la mer',
    produits: [p('sp1', 'Thon jaune', 13, 25, [['En tranches', 0], ['En darnes', 1]]), pc('sp2', 'Bonite', 10, [2.5, 3, 3.5], [['Entière', 0], ['Écaillé et vidé', 1]]), bq('sp3', 'Dorade coryphène', 18, 'Darnes', 1, 5)] },
  { id: 'jo', pecheur: 'Josette', port: 'Sainte-Luce', note: 4.9, avis: 41, bateau: 'Yole Fanm Doubout · DCP', debarque: 7 * 60 + 50, limiteRetrait: 11 * 60 + 30,
    lieu: 'Débarcadère de Sainte-Luce', precision: 'sous le carbet des pêcheurs',
    produits: [pc('jo1', 'Thazard', 15, [4, 5.5, 6], [['Entier', 0], ['Écaillé et vidé', 1]]), lt('jo2', 'Lambi', 1, 'kg', 25, 6)] },
  { id: 'di', pecheur: 'Yannick', port: 'Le Diamant', note: 4.7, avis: 21, bateau: 'Yole Rocher Diamant · côtière', debarque: 7 * 60 + 15, limiteRetrait: 12 * 60,
    lieu: 'Plage du Diamant, devant le bourg', precision: 'à côté de l’église, glacière blanche',
    produits: [p('di1', 'Colas', 15, 7, [['Entier', 0], ['Écaillé et vidé', 1]]), pc('di2', 'Vivaneau', 17, [1.4, 2], [['Entier', 0], ['Écaillé et vidé', 1]]), p('di3', 'Coulirou', 9, 10, [['Entier', 0]])] },
  { id: 'ro', pecheur: 'Rodrigue', port: 'Le Robert', note: 4.6, avis: 12, bateau: 'Yole Lavi Bel · côtière', debarque: 6 * 60 + 20, limiteRetrait: 12 * 60,
    lieu: 'Ponton du front de mer, Le Robert', precision: 'au bout du ponton, glacière bleue',
    produits: [p('ro1', 'Coulirou', 9, 15, [['Entier', 0]]), p('ro2', 'Colas', 14, 6, [['Entier', 0], ['Écaillé et vidé', 1]]), lt('ro3', 'Poisson volant', 10, 'pièces', 10, 8)] },
  { id: 'bf', pecheur: 'Christian', port: 'Belle-Fontaine', note: 4.8, avis: 19, bateau: 'Yole Ti Pwason · DCP', debarque: 7 * 60 + 40, limiteRetrait: 12 * 60,
    lieu: 'Marché Michel-Mourtialon, Belle-Fontaine', precision: 'étal 3, côté mer',
    produits: [p('bf1', 'Thon jaune', 14, 18, [['En tranches', 0], ['En darnes', 1]]), pc('bf2', 'Dorade coryphène', 13, [3.5, 4.2, 5, 6], [['Entière', 0], ['Écaillé et vidé', 1]]), p('bf3', 'Balaou', 9, 8, [['Vendu entier', 0]])] },
  { id: 'ml', pecheur: 'Marie-Line', port: 'Case-Pilote', note: 4.9, avis: 27, bateau: 'Yole Bon Vent · fond', debarque: 5 * 60 + 50, limiteRetrait: 11 * 60,
    lieu: 'Port de Case-Pilote', precision: 'à côté de l’église, sur la plage',
    produits: [pc('ml1', 'Vivaneau', 17, [1.3, 1.6], [['Entier', 0], ['Écaillé et vidé', 1]]), p('ml2', 'Colas', 14, 2, [['Entier', 0]])] },
  { id: 'fa', pecheur: 'Fabrice', port: 'Grand-Rivière', note: 4.8, avis: 22, bateau: 'Yole Nord Atlantique · DCP', debarque: 6 * 60, limiteRetrait: 11 * 60,
    lieu: 'Port de Grand-Rivière', precision: 'devant la coopérative',
    produits: [p('fa1', 'Thon jaune', 13, 30, [['En tranches', 0], ['En darnes', 1]]), pc('fa2', 'Langouste', 38, [0.8, 1, 1.2, 0.9], [['Vivante', 0]], false)] },
  { id: 'ge', pecheur: 'Gérard', port: 'Fort-de-France', note: 4.5, avis: 54, bateau: 'Yole Madinina · côtière', debarque: 6 * 60 + 30, limiteRetrait: 13 * 60,
    lieu: 'Marché aux poissons, Fort-de-France', precision: 'allée centrale, étal 12',
    produits: [bq('ge1', 'Thazard', 17, 'Darnes', 1, 8), p('ge2', 'Balaou', 9, 12, [['Vendu entier', 0]])] },
  { id: 'na', pecheur: 'Nadège', port: 'Le Marin', note: 4.7, avis: 15, bateau: 'Yole Sud Sauvage · DCP', debarque: 6 * 60 + 40, limiteRetrait: 12 * 60,
    lieu: 'Marché aux poissons du Marin', precision: 'sous la tente, à droite de l’entrée',
    produits: [pc('na1', 'Dorade coryphène', 12, [3, 3.8, 4.5], [['Entière', 0], ['Écaillé et vidé', 1]]), bq('na2', 'Thazard', 17, 'Darnes', 1, 6)] },
];

// Avis de démonstration (en vrai : laissés par les clients après le retrait)
const ilYa = (j: number) => new Date(Date.now() - j * 86400_000).toISOString();
export const AVIS_DEMO: Record<string, Avis[]> = {
  jm: [
    { code: 'R-8', prenom: 'Sophie', note: 5, commentaire: 'Thon superbe, découpé en tranches devant moi.', le: ilYa(1) },
    { code: 'R-5', prenom: 'Marc', note: 5, commentaire: 'Dorade entière très fraîche, Jean-Marc l’a vidée sur place.', le: ilYa(3) },
    { code: 'R-3', prenom: 'Le Comptoir du Port', note: 4, commentaire: 'Bon poisson, un peu d’attente au retrait.', le: ilYa(6) },
  ],
  jo: [{ code: 'R-4', prenom: 'Claire', note: 5, commentaire: 'Lambi propre et bien nettoyé.', le: ilYa(2) }],
};
