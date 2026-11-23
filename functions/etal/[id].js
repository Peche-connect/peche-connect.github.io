// Cloudflare Pages Function : quand un lien d'étal (https://peche-connect.fr/etal/<id>) est partagé sur
// WhatsApp ou Facebook, l'aperçu montre le pêcheur et son arrivage au lieu de l'aperçu général.
// Lit l'étal public dans Firestore (lecture autorisée pour les étals vérifiés), sans clé secrète.
// Variable à définir dans Cloudflare Pages > Paramètres > Variables : FIREBASE_PROJECT_ID (ex. peche-connect).
// En cas de problème, la page normale de l'appli est servie telle quelle.

const echapper = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const valeur = (v) => v == null ? null : 'stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue)
  : 'doubleValue' in v ? v.doubleValue : 'booleanValue' in v ? v.booleanValue : 'mapValue' in v ? objet(v.mapValue.fields)
  : 'arrayValue' in v ? (v.arrayValue.values ?? []).map(valeur) : null;
const objet = (f = {}) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, valeur(v)]));
const euro = (n) => Number(n).toFixed(2).replace('.', ',') + ' €';

export async function onRequest(ctx) {
  const page = await ctx.env.ASSETS.fetch(new URL('/', ctx.request.url));
  const id = String(ctx.params.id ?? '');
  const projet = ctx.env.FIREBASE_PROJECT_ID;
  if (!projet || !/^[A-Za-z0-9]{1,40}$/.test(id)) return page;
  try {
    const r = await fetch('https://firestore.googleapis.com/v1/projects/' + projet + '/databases/(default)/documents/etals/' + id, { cf: { cacheTtl: 120 } });
    if (!r.ok) return page;
    const e = objet((await r.json()).fields);
    const dispo = (e.produits ?? []).filter((p) => (p.format ?? 'kilo') === 'kilo' ? p.dispoKg > 0
      : p.format === 'piece' ? (p.pieces ?? []).length > 0 : p.format === 'portion' ? p.portion?.nombre > 0 : p.lot?.nombre > 0);
    const titre = 'Arrivage chez ' + e.prenom + ' · ' + e.port;
    const desc = (dispo.length
      ? dispo.slice(0, 5).map((p) => p.espece + ' ' + (p.format === 'lot' ? euro(p.lot.prix) + ' le lot' : euro(p.prixKg) + '/kg')).join(' · ')
      : 'Bientôt de nouveaux arrivages') + '. Réservez en ligne, retrait au port.';
    const image = e.photoUrl && /^https:\/\//.test(e.photoUrl) ? e.photoUrl : new URL('/og.png', ctx.request.url).toString();
    const html = (await page.text())
      .replace(/<meta property="og:title" content="[^"]*" \/>/, '<meta property="og:title" content="' + echapper(titre) + '" />')
      .replace(/<meta property="og:description" content="[^"]*" \/>/, '<meta property="og:description" content="' + echapper(desc) + '" />')
      .replace(/<meta property="og:image" content="[^"]*" \/>/, '<meta property="og:image" content="' + echapper(image) + '" />')
      .replace(/<title>[^<]*<\/title>/, '<title>' + echapper(titre) + ' · Pêche Connect</title>');
    const h = new Headers(page.headers); h.set('cache-control', 'public, max-age=120');
    return new Response(html, { status: 200, headers: h });
  } catch { return page; }
}
