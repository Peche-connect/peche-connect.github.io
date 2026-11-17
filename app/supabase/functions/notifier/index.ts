// Notifications :
//  • type « arrivage » : appelé par l'appli quand un pêcheur met en vente → prévient les clients
//    qui suivent une des espèces publiées (au plus une fois toutes les 2 h par étal) ;
//  • type « rappels » : lancé toutes les 15 min par pg_cron (voir LISEZMOI) → rappel de retrait
//    aux clients dont le bon est payé depuis plus d'1 h et pas encore retiré.
import { notifier } from '../_shared/notifier.ts';
import { admin, corps, env, Erreur, servir, utilisateur } from '../_shared/outils.ts';

servir(async (req) => {
  const { type } = await corps<{ type: 'arrivage' | 'rappels' }>(req);
  const db = admin();

  if (type === 'rappels') {
    if (req.headers.get('x-cle-taches') !== env('CLE_TACHES')) throw new Erreur(403, 'Interdit.');
    const { data: bons } = await db.from('bons').select('id, code, client_id, creneau, etals(prenom, port)')
      .eq('statut', 'reserve').eq('rappel_envoye', false).lt('paye_le', new Date(Date.now() - 3600_000).toISOString()).not('client_id', 'is', null).limit(200);
    for (const b of bons ?? []) {
      const e = b.etals as unknown as { prenom: string; port: string };
      await notifier([b.client_id!], 'Votre poisson vous attend', 'Bon ' + b.code + ' chez ' + e.prenom + ' (' + e.port + ') · ' + b.creneau, { lien: '/bon/' + b.code });
      await db.from('bons').update({ rappel_envoye: true }).eq('id', b.id);
    }
    return { rappels: bons?.length ?? 0 };
  }

  if (type === 'arrivage') {
    const u = await utilisateur(req);
    const { data: etal } = await db.from('etals').select('id, prenom, port, notifie_le').eq('pecheur_id', u.id).single();
    if (!etal) throw new Erreur(403, 'Réservé aux pêcheurs.');
    if (etal.notifie_le && Date.now() - new Date(etal.notifie_le).getTime() < 2 * 3600_000) return { envoyes: 0 };
    const { data: produits } = await db.from('produits').select('espece').eq('etal_id', etal.id).gt('dispo_kg', 0);
    const especes = [...new Set((produits ?? []).map((p) => p.espece))];
    if (!especes.length) return { envoyes: 0 };
    const { data: suivis } = await db.from('suivis').select('profil_id, espece').in('espece', especes);
    const clients = [...new Set((suivis ?? []).map((s) => s.profil_id))].filter((id) => id !== u.id);
    await db.from('etals').update({ notifie_le: new Date().toISOString() }).eq('id', etal.id);
    const n = await notifier(clients, 'Arrivage à ' + etal.port, etal.prenom + ' vient de débarquer : ' + especes.join(', ').toLowerCase(), { lien: '/etal/' + etal.id });
    return { envoyes: n };
  }
  throw new Erreur(400, 'Type inconnu.');
});
