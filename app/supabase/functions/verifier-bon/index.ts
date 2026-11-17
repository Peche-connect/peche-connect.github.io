// Le pêcheur scanne le QR du client : on vérifie la signature et que le bon est bien pour son étal.
import { admin, corps, Erreur, journal, servir, utilisateur } from '../_shared/outils.ts';
import { signatureValide } from '../_shared/qr.ts';

servir(async (req) => {
  const u = await utilisateur(req);
  const { code, signature } = await corps<{ code: string; signature: string }>(req);
  const { data: bon } = await admin().from('bons').select('id, code, statut, client_prenom, creneau, etals!inner(pecheur_id)').eq('code', String(code)).maybeSingle();
  const valide = !!bon && await signatureValide(bon.code, bon.id, String(signature ?? ''));
  if (!valide) {
    await journal(u.id, 'QR invalide scanné', { code });
    throw new Erreur(400, 'QR code non valable : ce bon n’a pas été émis par Pêche Connect.');
  }
  if ((bon!.etals as unknown as { pecheur_id: string }).pecheur_id !== u.id) throw new Erreur(403, 'Ce bon est pour un autre pêcheur.');
  if (!['reserve', 'en_livraison'].includes(bon!.statut)) throw new Erreur(409, bon!.statut === 'retire' ? 'Ce bon a déjà été retiré.' : 'Ce bon n’est pas payé ou a été annulé.');
  return { valide: true, code: bon!.code, client: bon!.client_prenom, creneau: bon!.creneau };
});
