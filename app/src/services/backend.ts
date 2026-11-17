// Liaison avec le serveur (Supabase + fonctions Stripe). Utilisé seulement en mode réel, c'est-à-dire
// quand EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY sont renseignées (voir .env.example).
// La clé « anon » est publique par nature : la sécurité est assurée par les règles d'accès de la base
// (supabase/migrations). Aucune clé secrète (Stripe, service_role) ne doit apparaître ici.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import type { Bon, Conversation, Demande, Etal, InfosPro, LignePanier, Message, Session } from '../types';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const CLE = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const CONNEXION_SMS = process.env.EXPO_PUBLIC_CONNEXION_SMS === '1';
export const CONNEXION_GOOGLE = process.env.EXPO_PUBLIC_CONNEXION_GOOGLE !== '0';

let client: SupabaseClient | null = null;
export function sb(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, CLE, {
      auth: {
        storage: Platform.OS === 'web' ? undefined : AsyncStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: Platform.OS === 'web',
        flowType: 'pkce',
      },
    });
  }
  return client;
}

export class ErreurServeur extends Error {}

async function fonction<T>(nom: string, corps: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().functions.invoke(nom, { body: corps });
  if (error) {
    // message lisible renvoyé par la fonction (« Plus assez de thon… »)
    let message = 'Le serveur ne répond pas. Vérifiez votre connexion.';
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.erreur) message = j.erreur; } catch { /* message par défaut */ }
    throw new ErreurServeur(message);
  }
  return data as T;
}

const verif = <T,>(r: { data: T; error: { message: string } | null }) => {
  if (r.error) {
    const m = r.error.message;
    if (/fetch|network|réseau/i.test(m)) throw new ErreurServeur('Pas de connexion au serveur. Vérifiez votre réseau puis réessayez.');
    throw new ErreurServeur(/Vente fermée|Compte pêcheur/.test(m) ? m.replace(/^.*?(Vente fermée|Compte pêcheur)/, '$1') : 'Opération impossible : ' + m);
  }
  return r.data;
};

// ───────── Heures : la Martinique est à UTC−4 toute l'année ─────────
export const minutesMartinique = (d: Date | string | null | undefined) => {
  if (!d) return 0;
  const x = typeof d === 'string' ? new Date(d) : d;
  return (((x.getUTCHours() - 4) * 60 + x.getUTCMinutes()) % 1440 + 1440) % 1440;
};
export const maintenantMartinique = () => minutesMartinique(new Date());
const minutesHeure = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

// ───────── Connexion ─────────
export async function envoyerCodeSms(telephone: string) {
  const r = await sb().auth.signInWithOtp({ phone: versInternational(telephone) });
  if (r.error) throw new ErreurServeur(r.error.status === 429 ? 'Trop de codes demandés. Réessayez plus tard.' : 'Envoi du SMS impossible : ' + r.error.message);
}
export async function verifierCodeSms(telephone: string, code: string) {
  const r = await sb().auth.verifyOtp({ phone: versInternational(telephone), token: code, type: 'sms' });
  if (r.error) throw new ErreurServeur('Code incorrect ou expiré.');
}
// 0696 12 34 56 → +596696123456 (Martinique) ; 06… → +336…
export function versInternational(t: string) {
  const c = t.replace(/[^\d+]/g, '');
  if (c.startsWith('+')) return c;
  if (/^0(696|697|596)/.test(c)) return '+596' + c.slice(1);
  if (/^0[67]/.test(c)) return '+33' + c.slice(1);
  return '+' + c;
}

export async function connexionGoogle() {
  const retour = Platform.OS === 'web' ? window.location.origin + '/' : Linking.createURL('/');
  if (Platform.OS === 'web') {
    const r = await sb().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: retour } });
    if (r.error) throw new ErreurServeur('Connexion Google impossible.');
    return; // la page part chez Google puis revient
  }
  const WebBrowser = await import('expo-web-browser');
  const r = await sb().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: retour, skipBrowserRedirect: true } });
  if (r.error || !r.data.url) throw new ErreurServeur('Connexion Google impossible.');
  const res = await WebBrowser.openAuthSessionAsync(r.data.url, retour);
  if (res.type !== 'success') return;
  const code = new URL(res.url).searchParams.get('code');
  if (code) { const x = await sb().auth.exchangeCodeForSession(code); if (x.error) throw new ErreurServeur('Connexion Google impossible.'); }
}

export async function deconnexion() { await sb().auth.signOut(); }
export function surChangementSession(f: (connecte: boolean) => void) {
  return sb().auth.onAuthStateChange((_ev, s) => f(!!s)).data.subscription;
}

// ───────── Profil ─────────
type LigneProfil = { id: string; role: 'client' | 'pro' | 'pecheur' | 'chauffeur' | 'admin'; prenom: string; telephone: string | null; commune: string | null };

export async function chargerSession(): Promise<{ session: Session; profilIncomplet: boolean; uid: string | null }> {
  const { data } = await sb().auth.getSession();
  const u = data.session?.user;
  if (!u) return { session: null, profilIncomplet: false, uid: null };
  const p = verif(await sb().from('profils').select('*').eq('id', u.id).maybeSingle()) as LigneProfil | null;
  if (!p || !p.prenom) return { session: null, profilIncomplet: true, uid: u.id };
  const telephone = p.telephone ?? u.phone ?? '';
  if (p.role === 'pecheur') {
    const e = verif(await sb().from('etals').select('id, statut, stripe_pret').eq('pecheur_id', u.id).maybeSingle()) as { id: string; statut: string; stripe_pret: boolean } | null;
    return { uid: u.id, profilIncomplet: false, session: { telephone, role: 'pecheur', prenom: p.prenom, etalId: e?.id, statutPecheur: e?.statut === 'verifie' ? 'verifie' : 'en_attente', stripePret: !!e?.stripe_pret } };
  }
  if (p.role === 'pro') {
    const pro = verif(await sb().from('pros').select('*').eq('profil_id', u.id).maybeSingle()) as (InfosPro & { adresse: string | null }) | null;
    if (!pro) return { session: null, profilIncomplet: true, uid: u.id };
    return { uid: u.id, profilIncomplet: false, session: { telephone, role: 'client', prenom: p.prenom, pro: { raison: pro.raison, type: pro.type, siret: pro.siret, commune: pro.commune, adresse: pro.adresse ?? undefined } } };
  }
  return { uid: u.id, profilIncomplet: false, session: { telephone, role: 'client', prenom: p.prenom } };
}

async function uid() {
  const { data } = await sb().auth.getUser();
  if (!data.user) throw new ErreurServeur('Session expirée, reconnectez-vous.');
  return data.user.id;
}

export async function enregistrerClient(prenom: string, commune?: string) {
  const id = await uid();
  verif(await sb().from('profils').update({ prenom, role: 'client', commune: commune ?? null }).eq('id', id));
}
export async function enregistrerPro(prenom: string, pro: InfosPro) {
  const id = await uid();
  verif(await sb().from('profils').update({ prenom, role: 'pro', commune: pro.commune }).eq('id', id));
  verif(await sb().from('pros').upsert({ profil_id: id, raison: pro.raison, type: pro.type, siret: pro.siret, commune: pro.commune, adresse: pro.adresse ?? null }));
}
export async function inscrirePecheur(i: { prenom: string; port: string; bateau: string; immatriculation: string }) {
  const id = await uid();
  verif(await sb().from('profils').update({ prenom: i.prenom, role: 'pecheur', commune: i.port }).eq('id', id));
  const e = verif(await sb().from('etals').upsert({ pecheur_id: id, prenom: i.prenom, port: i.port, bateau: i.bateau }, { onConflict: 'pecheur_id' }).select('id').single()) as { id: string };
  verif(await sb().from('etals_prive').upsert({ etal_id: e.id, immatriculation: i.immatriculation, lieu: 'Débarcadère de ' + i.port }));
}

// ───────── Lecture des données ─────────
type LigneEtal = { id: string; prenom: string; port: string; note: number; avis: number; bateau: string; photo_url: string | null; debarque_le: string | null; limite_retrait: string; produits: { id: string; espece: string; prix_kg: number; dispo_kg: number; preparations: { nom: string; supplementKg: number }[] }[] };

export async function chargerEtals(): Promise<Etal[]> {
  const etals = verif(await sb().from('etals').select('id, prenom, port, note, avis, bateau, photo_url, debarque_le, limite_retrait, produits(id, espece, prix_kg, dispo_kg, preparations)')) as LigneEtal[];
  // adresses exactes : seulement celles que les règles d'accès autorisent (étal du pêcheur, bons payés)
  const prives = verif(await sb().from('etals_prive').select('etal_id, lieu, precision')) as { etal_id: string; lieu: string | null; precision: string | null }[];
  return etals.map((e) => {
    const p = prives.find((x) => x.etal_id === e.id);
    return {
      id: e.id, pecheur: e.prenom, port: e.port, note: Number(e.note), avis: e.avis, bateau: e.bateau, photo: e.photo_url ?? undefined,
      debarque: e.debarque_le ? minutesMartinique(e.debarque_le) : -600, limiteRetrait: minutesHeure(e.limite_retrait),
      lieu: p?.lieu ?? undefined, precision: p?.precision ?? undefined,
      produits: e.produits.map((x) => ({ id: x.id, espece: x.espece, prixKg: Number(x.prix_kg), dispoKg: Number(x.dispo_kg), preparations: x.preparations })),
    };
  });
}

type LigneBon = { id: string; code: string; etal_id: string; client_id: string | null; client_prenom: string; pro: InfosPro | null; livraison: { adresse: string; frais: number } | null; lignes: LignePanier[]; creneau: string; statut: string; montant_bloque: number; montant_paye: number | null; cree_le: string };

export async function chargerBons(moi: string): Promise<Bon[]> {
  const bons = verif(await sb().from('bons').select('id, code, etal_id, client_id, client_prenom, pro, livraison, lignes, creneau, statut, montant_bloque, montant_paye, cree_le').neq('statut', 'annule').order('cree_le')) as LigneBon[];
  return bons.map((b) => ({
    code: b.code, etalId: b.etal_id, client: b.client_id === moi ? 'Vous' : b.client_prenom, pro: b.pro ?? undefined, livraison: b.livraison ?? undefined,
    lignes: b.lignes, creneau: b.creneau, montantBloque: Number(b.montant_bloque), montantPaye: b.montant_paye == null ? undefined : Number(b.montant_paye),
    statut: b.statut === 'retire' ? 'retire' : b.statut === 'en_attente_paiement' ? 'a_payer' : 'reserve', creeLe: minutesMartinique(b.cree_le), date: b.cree_le,
  }));
}

type LigneConv = { id: string; etal_id: string; client_id: string; client_prenom: string; bon_code: string | null; lu_client: boolean; lu_pecheur: boolean; messages: { id: string; auteur: Message['auteur']; texte: string | null; position: Message['position'] | null; cree_le: string }[] };

export async function chargerConversations(moi: string): Promise<Record<string, Conversation>> {
  const convs = verif(await sb().from('conversations').select('id, etal_id, client_id, client_prenom, bon_code, lu_client, lu_pecheur, messages(id, auteur, texte, position, cree_le)').order('cree_le', { referencedTable: 'messages' })) as LigneConv[];
  const r: Record<string, Conversation> = {};
  for (const c of convs) {
    const jeSuisClient = c.client_id === moi;
    const id = c.etal_id + '|' + (jeSuisClient ? 'Vous' : c.id);
    r[id] = {
      id, uuid: c.id, etalId: c.etal_id, client: jeSuisClient ? 'Vous' : c.client_prenom, bon: c.bon_code ?? '', luClient: c.lu_client, luPecheur: c.lu_pecheur,
      messages: c.messages.map((m) => ({ id: m.id, auteur: m.auteur, texte: m.texte ?? undefined, position: m.position ?? undefined, heure: minutesMartinique(m.cree_le) })),
    };
  }
  return r;
}

type LigneDemande = { id: string; pro_id: string; pro_raison: string; pro_type: InfosPro['type']; pro_commune: string; espece: string; kg: number; prix_max_kg: number; pour: Demande['pour']; note: string | null; livraison: Demande['livraison'] | null; statut: Demande['statut']; etal_id: string | null; bon_code: string | null; cree_le: string };

export async function chargerDemandes(moi: string): Promise<Demande[]> {
  const d = verif(await sb().from('demandes').select('*').neq('statut', 'annulee').order('cree_le', { ascending: false })) as LigneDemande[];
  return d.map((x) => ({
    id: x.id, auteur: x.pro_id === moi ? 'Vous' : x.pro_raison, pro: { raison: x.pro_raison, type: x.pro_type, siret: '', commune: x.pro_commune },
    espece: x.espece, kg: Number(x.kg), prixMaxKg: Number(x.prix_max_kg), pour: x.pour, note: x.note ?? undefined, livraison: x.livraison ?? undefined,
    statut: x.statut, etalId: x.etal_id ?? undefined, bon: x.bon_code ?? undefined, creeLe: minutesMartinique(x.cree_le),
  }));
}

// Temps réel : la fonction est appelée dès qu'une donnée change (nouveau message, bon payé, arrivage…)
export function ecouterChangements(f: () => void): () => void {
  let minuteur: ReturnType<typeof setTimeout> | null = null;
  const plusTard = () => { if (minuteur) clearTimeout(minuteur); minuteur = setTimeout(f, 300); };
  const canal: RealtimeChannel = sb().channel('changements');
  for (const table of ['messages', 'conversations', 'bons', 'produits', 'demandes']) {
    canal.on('postgres_changes', { event: '*', schema: 'public', table }, plusTard);
  }
  canal.subscribe();
  return () => { sb().removeChannel(canal); };
}

// ───────── Actions ─────────
async function ouvrir(url: string) {
  if (Platform.OS === 'web') { window.location.assign(url); return; }
  const WebBrowser = await import('expo-web-browser');
  await WebBrowser.openBrowserAsync(url);
}

export async function reserver(etalId: string, lignes: LignePanier[], creneau: string, livraison: boolean) {
  const r = await fonction<{ code: string; url: string }>('creer-reservation', {
    etalId, creneau, livraison, lignes: lignes.map((l) => ({ produitId: l.produitId, kg: l.kg, preparation: l.preparation })),
  });
  await ouvrir(r.url); // page de paiement sécurisée de Stripe (empreinte bancaire)
  return r.code;
}
export async function payerBon(code: string) { const r = await fonction<{ url: string }>('payer-bon', { code }); await ouvrir(r.url); }
export const monQr = async (code: string) => verif(await sb().rpc('mon_qr', { p_code: code })) as string | null;
export const verifierBon = (code: string, signature: string) => fonction<{ valide: boolean; client: string; creneau: string }>('verifier-bon', { code, signature });
export const validerPesee = (code: string, poids: number[]) => fonction<{ montantPaye?: number; annule?: boolean }>('valider-pesee', { code, poids });

export async function envoyerMessage(conv: string, auteur: 'client' | 'pecheur', texte?: string, position?: Message['position'], expireLe?: Date) {
  verif(await sb().from('messages').insert({ conversation_id: conv, auteur_id: await uid(), auteur, texte: texte ?? null, position: position ?? null, position_expire_le: expireLe?.toISOString() ?? null }));
  verif(await sb().from('conversations').update(auteur === 'client' ? { lu_pecheur: false } : { lu_client: false }).eq('id', conv));
}
export async function marquerLu(conv: string, role: 'client' | 'pecheur') {
  await sb().from('conversations').update(role === 'client' ? { lu_client: true } : { lu_pecheur: true }).eq('id', conv);
}

export async function publierArrivage(etalId: string, lignes: { espece: string; prixKg: number; dispoKg: number; preparations: { nom: string; supplementKg: number }[] }[], photoUrl?: string) {
  verif(await sb().from('produits').delete().eq('etal_id', etalId));
  const aPublier = lignes.filter((l) => l.dispoKg > 0).map((l) => ({ etal_id: etalId, espece: l.espece, prix_kg: l.prixKg, dispo_kg: l.dispoKg, preparations: l.preparations }));
  if (aPublier.length) verif(await sb().from('produits').insert(aPublier));
  verif(await sb().from('etals').update({ debarque_le: new Date().toISOString(), ...(photoUrl ? { photo_url: photoUrl } : {}) }).eq('id', etalId));
  fonction('notifier', { type: 'arrivage' }).catch(() => {}); // prévient les clients qui suivent ces espèces
}

// Photo de la pêche : envoyée dans le dossier public « arrivages/<étal>/ »
export async function envoyerPhoto(etalId: string, uri: string, type = 'image/jpeg') {
  const corps = await (await fetch(uri)).arrayBuffer();
  const chemin = etalId + '/' + Date.now() + (type === 'image/png' ? '.png' : '.jpg');
  verif(await sb().storage.from('arrivages').upload(chemin, corps, { contentType: type, upsert: false }));
  return sb().storage.from('arrivages').getPublicUrl(chemin).data.publicUrl;
}

export async function posterDemande(d: { espece: string; kg: number; prixMaxKg: number; pour: Demande['pour']; note?: string; livraison?: Demande['livraison'] }, pro: InfosPro) {
  verif(await sb().from('demandes').insert({ pro_id: await uid(), pro_raison: pro.raison, pro_type: pro.type, pro_commune: pro.commune, espece: d.espece, kg: d.kg, prix_max_kg: d.prixMaxKg, pour: d.pour, note: d.note ?? null, livraison: d.livraison ?? null }));
}
export async function annulerDemande(id: string) { verif(await sb().from('demandes').update({ statut: 'annulee' }).eq('id', id).eq('statut', 'ouverte')); }
export const accepterDemande = (id: string) => fonction<{ code: string }>('accepter-demande', { id });

export const comptePaiement = (action: 'lien' | 'etat') => fonction<{ url?: string; pret?: boolean }>('compte-paiement', { action });
export async function ouvrirComptePaiement() { const r = await comptePaiement('lien'); if (r.url) await ouvrir(r.url); }

export const exporterDonnees = () => fonction<Record<string, unknown>>('compte', { action: 'exporter' });
export async function supprimerCompte() { await fonction('compte', { action: 'supprimer' }); await sb().auth.signOut(); }

// Espèces suivies (« prévenez-moi quand il y a du thazard »)
export async function suivre(espece: string, oui: boolean) {
  const id = await uid();
  if (oui) verif(await sb().from('suivis').upsert({ profil_id: id, espece }));
  else verif(await sb().from('suivis').delete().eq('profil_id', id).eq('espece', espece));
}
export async function especesSuivies() { return ((verif(await sb().from('suivis').select('espece')) as { espece: string }[]) ?? []).map((s) => s.espece); }

// Notifications sur le téléphone (appli installée seulement)
export async function enregistrerNotifications() {
  if (Platform.OS === 'web') return;
  try {
    const Device = await import('expo-device');
    const N = await import('expo-notifications');
    if (!Device.isDevice) return;
    let { status } = await N.getPermissionsAsync();
    if (status !== 'granted') status = (await N.requestPermissionsAsync()).status;
    if (status !== 'granted') return;
    const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
    const jeton = (await N.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
    await sb().from('jetons_push').upsert({ jeton, profil_id: await uid() });
  } catch { /* notifications facultatives */ }
}
