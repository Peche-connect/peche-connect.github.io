// Règles d'annulation PROVISOIRES (mêmes valeurs que le serveur, reglages/general ; à décider entre associés)
export const REGLES_ANNULATION = {
  annulationClientAvantMin: 60, // le client annule gratuitement jusqu'à 60 min avant l'heure limite de retrait
  absentApresMin: 60,           // le pêcheur déclare le client absent 60 min après l'heure limite
  penaliteAbsencePct: 0.3,      // client absent : 30 % du poisson réservé débité (dédommagement du pêcheur)
  rupturesAlerte: 3,            // 3 ruptures en 30 jours : l'équipe est prévenue
};
export type ReglesAnnulation = typeof REGLES_ANNULATION;
const h = (m: number) => (m >= 60 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) : '') : m + ' min');
export const texteRegles = (r: ReglesAnnulation = REGLES_ANNULATION) => [
  'Vous pouvez annuler gratuitement jusqu’à ' + h(r.annulationClientAvantMin) + ' avant l’heure limite de retrait.',
  'Si le pêcheur n’a plus votre poisson, la réservation est annulée et rien n’est débité.',
  'Si vous ne venez pas, ' + Math.round(r.penaliteAbsencePct * 100) + ' % du poisson réservé est débité ' + h(r.absentApresMin) + ' après l’heure limite pour dédommager le pêcheur ; le reste est libéré et le poisson remis en vente.',
  'Un bon jamais clôturé est annulé sans frais au bout de 6 jours.',
];
