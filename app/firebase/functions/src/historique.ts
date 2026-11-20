// Suivi d'une commande étape par étape (réservée, payée, pesée, retirée, annulée, facturée), avec qui et quand.
// Écrit uniquement par le serveur, dans la même transaction que le changement qu'il décrit : pas d'étape
// sans changement, pas de changement sans étape. Chaque étape est numérotée et porte l'empreinte de la
// précédente (chaînage) : une étape modifiée, supprimée ou insérée après coup casse la chaîne et se voit.
import { createHash } from 'node:crypto';
import { db, Timestamp } from './commun';

export type Etape = 'reservee' | 'commande_creee' | 'payee' | 'paiement_refuse' | 'retiree' | 'annulee' | 'facture_emise' | 'remboursee' | 'litige' | 'avoir_emis';
export type Auteur = { uid: string | null; role: 'client' | 'pro' | 'pecheur' | 'systeme' | 'stripe' | 'equipe' };
type Suivi = { n: number; empreinte: string };

const empreinte = (prec: string, code: string, n: number, etape: string, quand: number, par: Auteur, details: Record<string, unknown>) =>
  createHash('sha256').update([prec, code, n, etape, quand, par.role, par.uid ?? '', JSON.stringify(details)].join('|')).digest('hex');

// À appeler dans la transaction qui modifie le bon ; renvoie le champ « suivi » à écrire sur le bon
export function ajouterEtape(t: FirebaseFirestore.Transaction, code: string, bon: { suivi?: Suivi } | undefined, etape: Etape, par: Auteur, details: Record<string, unknown> = {}) {
  const prec: Suivi = bon?.suivi ?? { n: 0, empreinte: '' };
  const n = prec.n + 1; const quand = Date.now();
  const e = empreinte(prec.empreinte, code, n, etape, quand, par, details);
  t.set(db.doc('bons/' + code + '/historique/' + String(n).padStart(4, '0')), {
    n, etape, par: par.role, uid: par.uid, quand: Timestamp.fromMillis(quand), details, precedente: prec.empreinte, empreinte: e,
  });
  return { suivi: { n, empreinte: e } };
}

// Contrôle d'intégrité : la chaîne est complète, dans l'ordre, et aboutit à l'empreinte notée sur le bon
export async function verifierSuivi(code: string) {
  const [bon, h] = await Promise.all([db.doc('bons/' + code).get(), db.collection('bons/' + code + '/historique').orderBy('n').get()]);
  let prec = ''; let n = 0;
  for (const d of h.docs) {
    const x = d.data(); n++;
    const attendu = empreinte(prec, code, n, x.etape, x.quand.toMillis(), { role: x.par, uid: x.uid }, x.details ?? {});
    if (x.n !== n || x.precedente !== prec || x.empreinte !== attendu) return { valide: false, etapes: n };
    prec = x.empreinte;
  }
  const s = bon.data()?.suivi as Suivi | undefined;
  return { valide: (s?.n ?? 0) === n && (s?.empreinte ?? '') === prec, etapes: n };
}
