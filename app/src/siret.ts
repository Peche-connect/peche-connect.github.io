// Contrôle de la clé d'un SIRET (algorithme de Luhn, exception La Poste) : même règle que le serveur
export function siretValide(s: string) {
  if (!/^\d{14}$/.test(s)) return false;
  if (s.startsWith('356000000')) return [...s].reduce((a, c) => a + Number(c), 0) % 5 === 0;
  let t = 0;
  for (let i = 0; i < 14; i++) { let d = Number(s[13 - i]); if (i % 2) { d *= 2; if (d > 9) d -= 9; } t += d; }
  return t % 10 === 0;
}
