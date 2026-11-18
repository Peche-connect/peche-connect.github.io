// Mode réseau faible (au port) : un arrivage qui n'a pas pu partir est gardé sur le téléphone
// et renvoyé tout seul dès que le réseau revient. Chaque envoi porte un identifiant : le serveur
// ne l'applique qu'une fois, même s'il arrive en double.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Produit } from './types';

const CLE = 'pc-file-attente';
export type EnvoiArrivage = { id: string; type: 'arrivage'; etalId: string; lignes: Omit<Produit, 'id'>[]; photo?: { uri: string; type?: string }; creeLe: number; essais: number };

export async function lireFile(): Promise<EnvoiArrivage[]> {
  try { return JSON.parse((await AsyncStorage.getItem(CLE)) ?? '[]'); } catch { return []; }
}
async function ecrire(l: EnvoiArrivage[]) { await AsyncStorage.setItem(CLE, JSON.stringify(l)).catch(() => {}); }

// Un seul arrivage en attente par étal : le plus récent remplace l'ancien
export async function mettreEnFile(x: Omit<EnvoiArrivage, 'creeLe' | 'essais'>) {
  const l = (await lireFile()).filter((y) => y.etalId !== x.etalId);
  await ecrire([...l, { ...x, creeLe: Date.now(), essais: 0 }]);
}
export async function retirerDeFile(id: string) { await ecrire((await lireFile()).filter((y) => y.id !== id)); }
export async function compterEssai(id: string) { await ecrire((await lireFile()).map((y) => (y.id === id ? { ...y, essais: y.essais + 1 } : y))); }
// au-delà de 12 h, un arrivage n'a plus de sens : abandonné
export const perime = (x: EnvoiArrivage) => Date.now() - x.creeLe > 12 * 3600_000;
export const nouvelId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
