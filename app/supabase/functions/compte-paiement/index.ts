// Compte de paiement du pêcheur (Stripe Connect Express) : création, lien d'inscription
// (pièce d'identité, RIB, SIRET, remplis sur la page sécurisée de Stripe) et état.
import { admin, corps, Erreur, servir, site, stripe, utilisateur } from '../_shared/outils.ts';

servir(async (req) => {
  const u = await utilisateur(req);
  const { action } = await corps<{ action: 'lien' | 'etat' }>(req);
  const db = admin();
  const { data: etal } = await db.from('etals').select('id, statut, prenom').eq('pecheur_id', u.id).single();
  if (!etal) throw new Erreur(404, 'Inscrivez-vous d’abord comme pêcheur.');
  if (etal.statut !== 'verifie') throw new Erreur(409, 'Votre inscription de pêcheur professionnel est en cours de vérification.');
  const { data: prive } = await db.from('etals_prive').select('stripe_compte').eq('etal_id', etal.id).single();
  const s = stripe();
  let compte = prive?.stripe_compte as string | null;

  if (action === 'etat') {
    if (!compte) return { pret: false };
    const a = await s.accounts.retrieve(compte);
    const pret = !!(a.charges_enabled && a.payouts_enabled);
    await db.from('etals').update({ stripe_pret: pret }).eq('id', etal.id);
    return { pret, manque: a.requirements?.currently_due ?? [] };
  }

  if (!compte) {
    const a = await s.accounts.create({
      type: 'express',
      country: 'FR', // la Martinique fait partie de la France pour Stripe
      email: u.email ?? undefined,
      business_type: 'individual',
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      business_profile: { product_description: 'Vente directe de poisson frais (pêcheur professionnel, Martinique)' },
      metadata: { etal_id: etal.id, profil_id: u.id },
      settings: { payouts: { schedule: { interval: 'daily' } } },
    });
    compte = a.id;
    await db.from('etals_prive').upsert({ etal_id: etal.id, stripe_compte: compte });
  }
  const lien = await s.accountLinks.create({
    account: compte, type: 'account_onboarding',
    refresh_url: site() + '/inscription-pecheur?stripe=relance',
    return_url: site() + '/inscription-pecheur?stripe=retour',
  });
  return { url: lien.url };
});
