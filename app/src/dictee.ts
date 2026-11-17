// Lecture d'un arrivage dicté : « thon jaune 12 kilos à 14 euros, vivaneau 5 kg 16 euros 50 »
// → [{ espece: 'Thon jaune', dispoKg: 12, prixKg: 14 }, { espece: 'Vivaneau', dispoKg: 5, prixKg: 16.5 }]
// Les quantités ou prix non dits restent à compléter avec les boutons + / −.

const sansAccents = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Noms tels qu'ils sont souvent dits → nom de l'espèce dans l'appli
const ALIAS: Record<string, string> = {
  'thon jaune': 'Thon jaune', 'thon': 'Thon jaune', 'bonite': 'Bonite', 'dorade coryphene': 'Dorade coryphène', 'dorade': 'Dorade coryphène', 'daurade': 'Dorade coryphène',
  'coryphene': 'Dorade coryphène', 'balaou': 'Balaou', 'vivaneau': 'Vivaneau', 'colas': 'Colas', 'coulirou': 'Coulirou', 'thazard': 'Thazard', 'tazar': 'Thazard',
  'chatrou': 'Chatrou', 'chatrous': 'Chatrou', 'poulpe': 'Chatrou', 'langouste': 'Langouste', 'lambi': 'Lambi', 'lambis': 'Lambi',
};

const MOTS: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20, trente: 30 };

export type LigneDictee = { espece: string; dispoKg?: number; prixKg?: number };

export function lireDictee(texte: string, especes: string[]): LigneDictee[] {
  let t = ' ' + sansAccents(texte).replace(/[;,.!?]/g, (m) => (m === ',' ? ',' : ' ')) + ' ';
  t = t.replace(/(\d),(\d)/g, '$1.$2'); // 12,5 → 12.5
  t = t.replace(/\b(un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingt|trente)\b/g, (m) => String(MOTS[m]));
  t = t.replace(/(\d+(?:\.\d+)?)\s*(?:kilos?|kg|kilogrammes?)\s*et demi/g, (_m, n) => String(Number(n) + 0.5) + ' kg');

  // repère chaque espèce citée (le nom le plus long d'abord : « thon jaune » avant « thon »)
  const noms = Object.keys(ALIAS).filter((a) => especes.includes(ALIAS[a])).sort((a, b) => b.length - a.length);
  const reperes: { pos: number; fin: number; espece: string }[] = [];
  for (const n of noms) {
    const re = new RegExp('\\b' + n.replace(/ /g, '\\s+') + 's?\\b', 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      if (!reperes.some((r) => m!.index < r.fin && m!.index + m![0].length > r.pos)) reperes.push({ pos: m.index, fin: m.index + m[0].length, espece: ALIAS[n] });
    }
  }
  reperes.sort((a, b) => a.pos - b.pos);

  const res: LigneDictee[] = [];
  reperes.forEach((r, i) => {
    const morceau = t.slice(r.fin, i + 1 < reperes.length ? reperes[i + 1].pos : t.length);
    const kgM = morceau.match(/(\d+(?:\.\d+)?)\s*(?:kilos?|kg|kilogrammes?)\b/);
    const prixM = morceau.match(/(\d+(?:\.\d+)?)\s*(?:euros?|€|eur)\b(?:\s*(\d{1,2})\b)?/);
    const ligne: LigneDictee = { espece: r.espece };
    if (kgM) ligne.dispoKg = Number(kgM[1]);
    if (prixM) ligne.prixKg = Number(prixM[1]) + (prixM[2] ? Number(prixM[2]) / (prixM[2].length === 1 ? 10 : 100) : 0);
    // nombres sans unité : le premier = kilos, le second = prix (« thazard 8 à 15 »)
    if (!kgM || !prixM) {
      const nus = [...morceau.replace(/(\d+(?:\.\d+)?)\s*(?:kilos?|kg|kilogrammes?|euros?|€|eur)\b(\s*\d{1,2}\b)?/g, ' ').matchAll(/\b(\d+(?:\.\d+)?)\b/g)].map((x) => Number(x[1]));
      if (ligne.dispoKg === undefined && nus.length) ligne.dispoKg = nus.shift();
      if (ligne.prixKg === undefined && nus.length) ligne.prixKg = nus.shift();
    }
    const deja = res.find((x) => x.espece === ligne.espece);
    if (deja) Object.assign(deja, Object.fromEntries(Object.entries(ligne).filter(([, v]) => v !== undefined)));
    else res.push(ligne);
  });
  return res;
}
