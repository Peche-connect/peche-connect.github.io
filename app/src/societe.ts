// Identité de la société : À REMPLIR UNE SEULE FOIS ICI dès le Kbis reçu. Les pages légales
// (mentions, confidentialité, conditions) se mettent à jour toutes seules. Tant qu'un champ est vide,
// la page affiche « à compléter » à sa place.
export const SOCIETE = {
  raisonSociale: 'Pêche Connect',
  forme: 'SARL',            // forme juridique
  capital: '',              // ex. '1 000'
  siege: '',                // adresse du siège social, Martinique
  rcs: '',                  // ex. 'RCS Fort-de-France 123 456 789'
  tva: '',                  // numéro de TVA intracommunautaire
  directeurPublication: '', // nom du gérant
  mediateur: '',            // médiateur de la consommation choisi (nom + site), obligatoire avant l'ouverture
  contact: 'contact@peche-connect.fr',
};
export const aCompleter = (v: string, libelle: string) => v || '[' + libelle + ' : à compléter]';
export const nomSociete = () => SOCIETE.raisonSociale + ' (' + SOCIETE.forme + (SOCIETE.rcs ? '' : ' en cours d’immatriculation') + ')';
