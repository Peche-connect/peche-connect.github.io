// « Partager mon étal » : le pêcheur publie son arrivage sur WhatsApp (discussion, groupe ou statut)
// avec un lien vers son étal. Jamais son numéro ni l'adresse exacte (règle anti-contournement) :
// le client réserve et paie dans l'appli.
import { Linking, Platform, Share } from 'react-native';
import { heure } from './format';
import { disponible, offre } from './formats';
import type { Etal } from './types';

export const SITE = (process.env.EXPO_PUBLIC_SITE_URL ?? 'https://peche-connect.fr').replace(/\/$/, '');
export const lienEtal = (e: Etal) => SITE + '/etal/' + e.id;

export function texteArrivage(e: Etal) {
  const lignes = e.produits.filter(disponible).slice(0, 8).map((p) => {
    const o = offre(p);
    return '• ' + p.espece + (p.format === 'portion' && p.portion ? ' (' + p.portion.type.toLowerCase() + ')' : '') + ' : ' + o.prix;
  });
  return [
    'Arrivage du jour chez ' + e.pecheur + ' (' + e.port + ')' + (e.debarque != null ? ', débarqué à ' + heure(e.debarque) : '') + ' :',
    ...lignes,
    '',
    'Réservez et payez en ligne, retrait au port avant ' + heure(e.limiteRetrait) + ' :',
    lienEtal(e),
  ].join('\n');
}

export async function partagerWhatsApp(e: Etal) {
  const texte = texteArrivage(e);
  const url = 'https://wa.me/?text=' + encodeURIComponent(texte);
  if (Platform.OS === 'web') { window.open(url, '_blank', 'noopener'); return; }
  const appli = 'whatsapp://send?text=' + encodeURIComponent(texte);
  if (await Linking.canOpenURL(appli).catch(() => false)) await Linking.openURL(appli);
  else await Linking.openURL(url);
}

// Autres applis (Facebook, SMS…) : feuille de partage du téléphone
export async function partagerAutre(e: Etal) {
  const texte = texteArrivage(e);
  if (Platform.OS === 'web') {
    const n = navigator as Navigator & { share?: (d: { text: string; url?: string; title?: string }) => Promise<void> };
    if (n.share) { await n.share({ title: 'Arrivage chez ' + e.pecheur, text: texte }).catch(() => {}); return 'partage'; }
    await navigator.clipboard?.writeText(texte).catch(() => {});
    return 'copie';
  }
  await Share.share({ message: texte });
  return 'partage';
}

// Image carrée pour le statut WhatsApp (site uniquement : dessinée dans le navigateur)
export async function imageStatut(e: Etal): Promise<Blob | null> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return null;
  await (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready;
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1920;
  const g = c.getContext('2d'); if (!g) return null;
  const marine = '#12355b';
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = marine; g.font = '170px BebasNeue_400Regular, sans-serif';
  g.fillText('PÊCHE', 80, 260); g.fillText('CONNECT', 80, 420);
  g.fillStyle = '#111111'; g.font = '800 64px Figtree_800ExtraBold, sans-serif';
  g.fillText('Arrivage du jour', 80, 600);
  g.font = '500 44px Figtree_500Medium, sans-serif'; g.fillStyle = '#62625d';
  g.fillText(e.pecheur + ' · ' + e.port + (e.debarque != null ? ' · ' + heure(e.debarque) : ''), 80, 670);
  let y = 800;
  for (const p of e.produits.filter(disponible).slice(0, 7)) {
    const o = offre(p);
    g.fillStyle = '#f3f3f1'; g.fillRect(60, y - 70, 960, 110);
    g.fillStyle = '#111111'; g.font = '800 52px Figtree_800ExtraBold, sans-serif'; g.fillText(p.espece, 90, y);
    g.font = '700 46px Figtree_700Bold, sans-serif'; g.fillStyle = marine;
    const w = g.measureText(o.prix).width; g.fillText(o.prix, 990 - w, y);
    y += 140;
  }
  g.fillStyle = marine; g.fillRect(60, 1640, 960, 190);
  g.fillStyle = '#ffffff'; g.font = '800 54px Figtree_800ExtraBold, sans-serif'; g.fillText('Réservez. Payez. Récupérez.', 100, 1720);
  g.font = '500 40px Figtree_500Medium, sans-serif'; g.fillText(lienEtal(e).replace(/^https?:\/\//, ''), 100, 1790);
  return new Promise((r) => c.toBlob((b) => r(b), 'image/png'));
}

// Partage de l'image (téléphone : feuille de partage → WhatsApp → Statut) ou téléchargement (ordinateur)
export async function partagerImage(e: Etal) {
  const b = await imageStatut(e); if (!b) return 'indisponible';
  const f = new File([b], 'arrivage-' + e.id + '.png', { type: 'image/png' });
  const n = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean; share?: (d: { files: File[]; text?: string }) => Promise<void> };
  if (n.canShare?.({ files: [f] }) && n.share) { await n.share({ files: [f], text: lienEtal(e) }).catch(() => {}); return 'partage'; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = f.name; a.click();
  return 'telecharge';
}
