// Affichage plus gros (option dans « Mon compte ») : tous les textes de l'appli sont agrandis.
// Choix gardé sur le téléphone. S'ajoute au réglage de taille du téléphone lui-même.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

export const TAILLES = [{ nom: 'Normale', echelle: 1 }, { nom: 'Grande', echelle: 1.2 }, { nom: 'Très grande', echelle: 1.4 }] as const;
const CLE = 'pc-taille-texte';
let echelle = 1;
const abonnes = new Set<() => void>();

AsyncStorage.getItem(CLE).then((v) => { const n = Number(v); if (TAILLES.some((t) => t.echelle === n)) changer(n, false); }).catch(() => {});

export function changer(n: number, garder = true) {
  echelle = n; abonnes.forEach((f) => f());
  if (garder) AsyncStorage.setItem(CLE, String(n)).catch(() => {});
}
export const useEchelle = () => useSyncExternalStore((f) => { abonnes.add(f); return () => abonnes.delete(f); }, () => echelle, () => echelle);
