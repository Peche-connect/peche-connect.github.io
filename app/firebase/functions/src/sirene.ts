// Vérification du SIRET des professionnels auprès du répertoire public des entreprises de l'État
// (API Recherche d'entreprises, données INSEE Sirene : gratuite, sans clé).
import { logger } from 'firebase-functions';

export type ResultatSiret = { statut: 'actif' | 'ferme' | 'introuvable' | 'indisponible'; nom?: string; adresse?: string };

// Contrôle de la clé (algorithme de Luhn), exception La Poste (SIREN 356 000 000)
export function siretValide(s: string) {
  if (!/^\d{14}$/.test(s)) return false;
  if (s.startsWith('356000000')) return [...s].reduce((a, c) => a + Number(c), 0) % 5 === 0;
  let t = 0;
  for (let i = 0; i < 14; i++) { let d = Number(s[13 - i]); if (i % 2) { d *= 2; if (d > 9) d -= 9; } t += d; }
  return t % 10 === 0;
}

export async function verifierSiret(siret: string): Promise<ResultatSiret> {
  // en test : faux répertoire local ; jamais d'appel vers Internet depuis les émulateurs
  const hote = process.env.FUNCTIONS_EMULATOR === 'true' ? process.env.SIRENE_API_HOTE : 'https://recherche-entreprises.api.gouv.fr';
  if (!hote) return { statut: 'indisponible' };
  try {
    const r = await fetch(hote + '/search?per_page=1&q=' + siret, { signal: AbortSignal.timeout(4000), headers: { Accept: 'application/json' } });
    if (!r.ok) return { statut: 'indisponible' };
    const res = ((await r.json()) as { results?: Record<string, any>[] }).results?.[0];
    const etab = res?.matching_etablissements?.find((e: { siret?: string }) => e.siret === siret) ?? (res?.siege?.siret === siret ? res.siege : null);
    if (!res || !etab) return { statut: 'introuvable' };
    const nom = String(res.nom_complet ?? '').slice(0, 120), adresse = String(etab.adresse ?? '').slice(0, 200);
    return { statut: etab.etat_administratif === 'A' && res.etat_administratif === 'A' ? 'actif' : 'ferme', nom, adresse };
  } catch (e) {
    logger.warn('Répertoire des entreprises injoignable', { erreur: String(e).slice(0, 80) });
    return { statut: 'indisponible' };
  }
}

// Champs enregistrés dans pros/<uid> après un contrôle
export const champsSiret = (v: ResultatSiret) => ({
  siretVerifie: v.statut === 'actif', siretStatut: v.statut, siretControleLe: new Date(),
  ...(v.nom ? { siretNom: v.nom, siretAdresse: v.adresse ?? null } : {}),
});
