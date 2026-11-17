// Outils communs aux fonctions serveur Pêche Connect (Deno, Supabase Edge Functions).
// Les clés secrètes viennent des « secrets » Supabase (Project Settings > Edge Functions),
// jamais du code : voir supabase/LISEZMOI.md.
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.119.0';
import Stripe from 'npm:stripe@17.7.0';

export const env = (nom: string, obligatoire = true) => {
  const v = Deno.env.get(nom);
  if (!v && obligatoire) throw new Erreur(500, 'Configuration manquante : ' + nom);
  return v ?? '';
};

export class Erreur extends Error {
  constructor(public statut: number, message: string) { super(message); }
}

// Le site est servi depuis une autre adresse que Supabase : autoriser seulement nos origines.
const ORIGINES = () => (Deno.env.get('ORIGINES_AUTORISEES') ?? 'https://peche-connect.github.io,https://peche-connect.fr,https://www.peche-connect.fr,http://localhost:8081').split(',');
export function cors(req: Request) {
  const o = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ORIGINES().includes(o) ? o : ORIGINES()[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

export const json = (req: Request, corps: unknown, statut = 200) =>
  new Response(JSON.stringify(corps), { status: statut, headers: { ...cors(req), 'Content-Type': 'application/json' } });

// Enveloppe chaque fonction : CORS, erreurs propres en français, pas de détails techniques renvoyés
export function servir(f: (req: Request) => Promise<unknown>) {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
    try {
      const r = await f(req);
      return r instanceof Response ? r : json(req, r ?? { ok: true });
    } catch (e) {
      if (e instanceof Erreur) return json(req, { erreur: e.message }, e.statut);
      console.error(e);
      const message = e instanceof Error && /Plus assez|Vente fermée|Étal indisponible|Panier vide/.test(e.message) ? e.message : 'Erreur du serveur, réessayez dans un instant.';
      return json(req, { erreur: message }, 500);
    }
  });
}

// Client « serveur » : contourne les règles d'accès, à n'utiliser qu'ici
export const admin = (): SupabaseClient => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

// Utilisateur à l'origine de l'appel (jeton envoyé par l'appli)
export async function utilisateur(req: Request): Promise<User> {
  const jeton = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
  if (!jeton) throw new Erreur(401, 'Connectez-vous pour continuer.');
  const { data, error } = await admin().auth.getUser(jeton);
  if (error || !data.user) throw new Erreur(401, 'Session expirée, reconnectez-vous.');
  return data.user;
}

export const stripe = () => new Stripe(env('STRIPE_SECRET_KEY'), { apiVersion: '2025-02-24.acacia', httpClient: Stripe.createFetchHttpClient() });
export const centimes = (euros: number) => Math.round(euros * 100);
export const site = () => (Deno.env.get('SITE_URL') ?? 'https://peche-connect.github.io').replace(/\/$/, '');

export async function corps<T>(req: Request): Promise<T> {
  try { return await req.json() as T; } catch { throw new Erreur(400, 'Requête invalide.'); }
}

export async function journal(qui: string | null, quoi: string, details?: unknown) {
  await admin().from('journal').insert({ qui, quoi, details: details ?? null });
}
