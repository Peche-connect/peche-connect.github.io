export type Role = 'client' | 'pecheur';

export type Preparation = { nom: string; supplementKg: number };

// Façons de vendre une espèce, choisies par le pêcheur à la publication :
// au kilo (petits poissons), à la pièce (gros poissons entiers, poids approximatif), en barquettes
// déjà préparées (filets, darnes, tranches) ou en lot à prix fixe (poisson volant, lambi…)
export type Format = 'kilo' | 'piece' | 'portion' | 'lot';
export type Piece = { id: string; poidsKg: number }; // poids approximatif, le prix se fait à la pesée
export type TypePortion = 'Filets' | 'Darnes' | 'Tranches';

export type Produit = {
  id: string;
  espece: string;
  format: Format;
  prixKg: number; // en euros (pas utilisé pour un lot)
  dispoKg: number; // stock approximatif en kg, pour l'affichage (au kilo : le stock exact)
  preparations: Preparation[]; // au kilo et à la pièce : entier, vidé, écaillé… (+ supplément au kilo)
  pasKg?: number; // au kilo : pas du + / − (0,5 ou 1 kg)
  pieces?: Piece[]; // à la pièce : les poissons disponibles
  teteAuChoix?: boolean; // à la pièce : le client choisit avec ou sans tête
  portion?: { type: TypePortion; poidsKg: number; nombre: number }; // barquettes : poids approximatif et nombre
  lot?: { quantite: number; unite: 'pièces' | 'kg'; prix: number; nombre: number }; // prix fixe par lot, nombre de lots
};

export type Etal = {
  id: string; // identifiant du pêcheur
  pecheur: string; // prénom affiché
  port: string;
  note: number;
  avis: number;
  bateau: string;
  debarque: number; // minutes depuis minuit
  limiteRetrait: number; // minutes depuis minuit
  produits: Produit[];
  photo?: string; // photo de la pêche du jour (publiée par le pêcheur)
  // Adresse exacte : visible seulement après paiement (règle anti-contournement)
  lieu?: string;
  precision?: string;
};

export type LignePanier = {
  produitId: string; espece: string; format?: Format;
  kg: number; // poids estimé (réel après la pesée) ; pour un lot : poids indicatif
  prixKg: number; preparation: string; supplementKg: number;
  pieceId?: string; tete?: 'avec' | 'sans'; // à la pièce
  nombre?: number; // barquettes ou lots
  prixLot?: number; // lot à prix fixe
  libelle?: string; // ex. « barquette de filets ~500 g », « lot de 10 pièces »
};

export type Panier = { etalId: string; lignes: LignePanier[] } | null;

export type StatutBon = 'a_payer' | 'reserve' | 'retire' | 'annule'; // « a_payer » : commande de pro acceptée, pas encore réglée

export type InfosPro = { raison: string; type: 'Restaurant' | 'Poissonnerie' | 'Revendeur' | 'Traiteur'; siret: string; commune: string; adresse?: string };

// Livraison par un chauffeur Pêche Connect, réservée aux grosses quantités des pros
export type Livraison = { adresse: string; frais: number };

// Demande d'achat publiée par un professionnel ; un pêcheur peut y répondre
export type Demande = { id: string; pro: InfosPro; auteur: 'Vous' | string; espece: string; kg: number; prixMaxKg: number; pour: 'Aujourd’hui' | 'Demain'; note?: string; livraison?: Livraison; statut: 'ouverte' | 'acceptee' | 'annulee'; etalId?: string; bon?: string; creeLe: number };

export type Bon = {
  code: string;
  pro?: InfosPro; // commande passée par un professionnel (facture HT / TVA / TTC)
  livraison?: Livraison;
  etalId: string;
  client: string;
  lignes: LignePanier[];
  creneau: string;
  statut: StatutBon;
  montantBloque: number;
  montantPaye?: number;
  creeLe: number;
  date?: string; // date de création (mode réel), pour le relevé mensuel
  facture?: string; // numéro de facture (pros), ex. FA-2026-000001
};

// Une étape du suivi d'un bon (réservée, payée, retirée…), écrite par le serveur
export type EtapeSuivi = { etape: 'reservee' | 'commande_creee' | 'payee' | 'paiement_refuse' | 'retiree' | 'annulee' | 'facture_emise'; par: string; quand: number; details: Record<string, unknown> };

export type Message = {
  id: string;
  auteur: Role | 'systeme';
  texte?: string;
  position?: { libelle: string; lat: number; lon: number };
  audio?: { uri: string; duree: number }; // message vocal (secondes)
  heure: number;
};

export type Conversation = { id: string; uuid?: string; etalId: string; client: string; bon: string; messages: Message[]; luClient: boolean; luPecheur: boolean };

export type Session = { telephone: string; email?: string; role: Role; prenom: string; pro?: InfosPro; etalId?: string; statutPecheur?: 'en_attente' | 'verifie'; stripePret?: boolean } | null;
