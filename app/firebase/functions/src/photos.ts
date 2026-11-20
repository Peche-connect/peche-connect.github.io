// Photos des arrivages : une photo prise au téléphone contient souvent la position GPS exacte
// (et le modèle du téléphone, l'heure…). Dès qu'elle arrive, elle est réenregistrée SANS ces
// informations (et réduite à 1600 px, assez pour l'appli). Le pêcheur ne dévoile donc jamais
// où il est par sa photo.
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions';
import { onObjectFinalized } from 'firebase-functions/v2/storage';
import sharp from 'sharp';
import { REGION } from './commun';

export async function nettoyerPhoto(chemin: string, contentType: string | undefined) {
  const f = getStorage().bucket().file(chemin);
  const [meta] = await f.getMetadata();
  if (meta.metadata?.nettoye === '1') return false; // déjà fait (le réenregistrement relance ce déclencheur)
  const [brut] = await f.download();
  let img = sharp(brut, { failOn: 'none' }).rotate() // applique l'orientation, puis aucune métadonnée n'est recopiée
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true });
  const type = contentType === 'image/png' ? 'image/png' : contentType === 'image/webp' ? 'image/webp' : 'image/jpeg';
  img = type === 'image/png' ? img.png() : type === 'image/webp' ? img.webp({ quality: 82 }) : img.jpeg({ quality: 82, mozjpeg: true });
  const propre = await img.toBuffer();
  await f.save(propre, { resumable: false, contentType: type, metadata: { cacheControl: 'public, max-age=86400', metadata: { nettoye: '1' } } });
  return true;
}

export const photoDeposee = onObjectFinalized({ region: REGION, memory: '512MiB' }, async (ev) => {
  const chemin = ev.data.name ?? '';
  if (!/^arrivages\/[A-Za-z0-9]+\/[A-Za-z0-9._-]+$/.test(chemin) || ev.data.metadata?.nettoye === '1') return;
  try { await nettoyerPhoto(chemin, ev.data.contentType); }
  catch (e) {
    // photo illisible : supprimée plutôt que publiée avec sa position
    logger.warn('photo non nettoyée, supprimée', { chemin, erreur: String(e).slice(0, 120) });
    await getStorage().bucket().file(chemin).delete().catch(() => null);
  }
});
