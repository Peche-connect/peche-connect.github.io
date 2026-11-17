// Périodes de fermeture connues (mêmes règles que la table « fermetures » du serveur, qui fait foi).
// À revérifier chaque année auprès de la Direction de la Mer de Martinique.
export const FERMETURES = [
  { espece: 'Lambi', debut: [1, 1], fin: [6, 30], motif: 'Pêche et vente du lambi frais interdites du 1er janvier au 30 juin' },
  { espece: 'Langouste', debut: [6, 1], fin: [9, 30], motif: 'Pêche de la langouste fermée du 1er juin au 30 septembre' },
] as const;

export function fermeture(espece: string, jour = new Date()) {
  const md = (jour.getMonth() + 1) * 100 + jour.getDate();
  return FERMETURES.find((f) => f.espece === espece && md >= f.debut[0] * 100 + f.debut[1] && md <= f.fin[0] * 100 + f.fin[1]) ?? null;
}
