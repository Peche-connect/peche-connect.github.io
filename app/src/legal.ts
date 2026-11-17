// Pages légales. Les éléments entre crochets […] sont à compléter une fois la société créée
// (raison sociale, siège, RCS, gérant, médiateur). Textes à faire relire par un juriste avant l'ouverture au public.
export type PageLegale = { titre: string; maj: string; sections: { titre: string; texte: string }[] };

const SOCIETE = 'Pêche Connect [SARL en cours de création]';
const CONTACT = 'contact@peche-connect.fr';

export const PAGES: Record<string, PageLegale> = {
  mentions: {
    titre: 'Mentions légales',
    maj: '17 novembre 2026',
    sections: [
      { titre: 'Éditeur', texte: SOCIETE + ', au capital de [montant] €, siège social : [adresse], Martinique. RCS Fort-de-France [numéro]. TVA intracommunautaire : [numéro]. Directeur de la publication : [nom du gérant]. Contact : ' + CONTACT + '.' },
      { titre: 'Hébergement du site', texte: 'Cloudflare Pages, Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, États-Unis.' },
      { titre: 'Hébergement des données', texte: 'Google Firebase (Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irlande) : base de données, fichiers et fonctions serveur sur des serveurs situés à Paris (région europe-west9) ; les comptes de connexion (adresse e-mail) sont gérés par Firebase Authentication, dont les serveurs peuvent se trouver hors de l’Union européenne. Paiements : Stripe Payments Europe Ltd, 1 Grand Canal Street Lower, Dublin 2, Irlande.' },
      { titre: 'Propriété intellectuelle', texte: 'Le nom Pêche Connect, le logo et les illustrations sont la propriété de l’éditeur. Les photos publiées par les pêcheurs restent leur propriété. Carte : © contributeurs OpenStreetMap (licence ODbL).' },
    ],
  },
  confidentialite: {
    titre: 'Politique de confidentialité',
    maj: '17 novembre 2026',
    sections: [
      { titre: 'Qui est responsable', texte: SOCIETE + ' est responsable du traitement de vos données. Pour toute question ou pour exercer vos droits : ' + CONTACT + '.' },
      { titre: 'Ce que nous collectons (et seulement cela)', texte: 'Clients : prénom, adresse e-mail (connexion), réservations, messages écrits et vocaux échangés avec les pêcheurs. Professionnels : en plus, raison sociale, SIRET, commune et adresse de livraison. Pêcheurs : prénom, port, nom et immatriculation du bateau, adresse du point de retrait, photos d’arrivage ; les pièces d’identité et le RIB sont saisis directement chez Stripe, nous ne les voyons pas. Nous ne stockons jamais de numéro de carte bancaire.' },
      { titre: 'Pourquoi', texte: 'Créer votre compte, permettre la réservation, le paiement et le retrait du poisson (exécution du contrat) ; tenir la comptabilité et répondre aux obligations légales, notamment la déclaration des revenus des vendeurs aux impôts (DAC7) ; assurer la sécurité du service (intérêt légitime). Aucune publicité, aucune revente de données.' },
      { titre: 'Position du pêcheur', texte: 'Le pêcheur peut partager sa position avec un client qui a un bon payé, uniquement depuis la messagerie et pendant le retrait. Elle est effacée automatiquement : 30 minutes après un envoi ponctuel, et peu après l’heure limite de retrait pour un partage en direct. Votre position de client n’est jamais collectée.' },
      { titre: 'Qui voit quoi', texte: 'Personne ne voit votre adresse e-mail ni votre numéro. L’adresse exacte du pêcheur n’est visible qu’après paiement. Le SIRET et l’adresse des professionnels ne sont visibles que par eux. Nos prestataires : Google Firebase (données à Paris ; la connexion, avec votre seule adresse e-mail, peut être traitée hors de l’Union européenne), Cloudflare (hébergement du site), Stripe (paiement), Apple (si vous vous connectez avec Apple), Expo (notifications sur téléphone). Certains sont des sociétés américaines : les transferts sont encadrés par les clauses contractuelles types de la Commission européenne.' },
      { titre: 'Combien de temps', texte: 'Compte : jusqu’à sa suppression. Messages écrits et vocaux : 1 an après le retrait ; les messages vocaux ne sont lisibles que par le client et le pêcheur de la conversation. Factures et bons payés : 10 ans (obligation comptable), détachés de votre identité si vous supprimez votre compte. Journaux de sécurité : 1 an.' },
      { titre: 'Vos droits', texte: 'Accès, rectification, effacement, portabilité, opposition et limitation. Dans « Mon compte » : « Télécharger mes données » et « Supprimer mon compte » fonctionnent tout de suite. Vous pouvez aussi écrire à ' + CONTACT + ' et saisir la CNIL (www.cnil.fr). En cas de fuite de données vous concernant, nous prévenons la CNIL sous 72 heures et vous-même si le risque est élevé.' },
      { titre: 'Cookies', texte: 'Aucun cookie publicitaire ni de mesure d’audience. Seule votre session de connexion est gardée sur votre appareil, ce qui ne demande pas de consentement.' },
    ],
  },
  conditions: {
    titre: 'Conditions générales d’utilisation et de vente',
    maj: '17 novembre 2026',
    sections: [
      { titre: 'Le service', texte: 'Pêche Connect met en relation des pêcheurs professionnels de Martinique et des acheteurs (particuliers et professionnels). Le pêcheur est le vendeur du poisson ; ' + SOCIETE + ' est un intermédiaire qui fournit l’appli, le paiement sécurisé et la messagerie.' },
      { titre: 'Comptes', texte: 'Un compte par personne. Les pêcheurs doivent être professionnels et sont vérifiés (immatriculation, statut) avant de vendre. Il est interdit de contourner la plateforme en échangeant ses coordonnées avant le paiement.' },
      { titre: 'Réservation et paiement', texte: 'À la réservation, un montant maximum est bloqué sur votre carte (poids estimé + 10 % + frais de service). Rien n’est débité à ce moment. Au retrait, le pêcheur pèse le poisson devant vous : seul le montant du poids réel et les frais de service sont débités, le reste est libéré aussitôt. Frais de service : [montant à fixer, actuellement 0,90 €] par réservation. Paiement opéré par Stripe.' },
      { titre: 'Retrait', texte: 'Le poisson se retire au lieu et pendant le créneau indiqués sur le bon, en présentant le code ou le QR code. Pour les professionnels, une livraison peut être proposée à partir de [10] kg pour [15] € (montants provisoires).' },
      { titre: 'Annulation', texte: 'Pêcheur en rupture : la réservation est annulée et rien n’est débité. Client absent à l’heure limite de retrait : [règle à définir]. Le poisson frais se détériorant rapidement, le droit de rétractation ne s’applique pas (article L221-28 4° du Code de la consommation).' },
      { titre: 'Qualité et réglementation', texte: 'Le pêcheur est responsable de la qualité, de l’hygiène et de la traçabilité de ses produits, ainsi que du respect des zones et périodes de pêche (zones chlordécone, fermetures du lambi et de la langouste). La plateforme bloque la mise en vente des espèces pendant les périodes de fermeture qu’elle connaît.' },
      { titre: 'Responsabilité', texte: 'Pêche Connect s’engage à faire fonctionner le service avec soin mais ne peut garantir l’absence d’interruption. Sa responsabilité est limitée au montant des frais de service perçus pour la commande concernée, sauf faute lourde.' },
      { titre: 'Litiges', texte: 'Écrivez d’abord à ' + CONTACT + '. Consommateurs : médiateur de la consommation [à désigner], et plateforme européenne de règlement des litiges. Droit français ; tribunaux de Fort-de-France.' },
    ],
  },
};
