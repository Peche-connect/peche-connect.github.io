import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { ETALS_DEMO, PORTS } from './data/demo';
const VERSION_DEMO = 2; // à augmenter quand les données de démo changent de forme
import { distanceKm, FRAIS_LIVRAISON, heure, kg, LIVRAISON_MIN_KG } from './format';
import { cleLigne, disponible, libelleLigne, montantBloque, montantPaye, nomBarquette, nomLot, normaliserProduit, stockKg } from './formats';
import { versDataUrl, type Enregistrement } from './audio';
import * as B from './services/backend';
import type { Bon, Conversation, Demande, Etal, EtapeSuivi, InfosPro, LignePanier, Message, Panier, Produit, Role, Session } from './types';

// Mode démo : tout est stocké sur le téléphone, aucun paiement réel.
// Mode réel : dès que les clés Firebase EXPO_PUBLIC_FIREBASE_* sont renseignées (fichier .env, voir
// .env.example), chaque action passe par le serveur Firebase (src/services/backend.ts).
export const MODE_DEMO = !(process.env.EXPO_PUBLIC_FIREBASE_API_KEY && process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID);
export const CODE_SMS_DEMO = '123456';
export const SITE = (process.env.EXPO_PUBLIC_SITE_URL ?? 'https://peche-connect.github.io').replace(/\/$/, '');
const CLE = MODE_DEMO ? 'peche-connect-app-v1' : 'peche-connect-reel-v1';
const HEURE_DEMO = 8 * 60 + 5; // en démo, l'horloge démarre à 8 h 05
const DELAI_POSITION_MIN = 30;  // la position « une seule fois » est effacée après 30 min

type Etat = {
  session: Session;
  uid: string | null;              // mode réel : identifiant du compte connecté
  profilIncomplet: boolean;        // mode réel : connecté (Google / SMS) mais prénom et rôle pas encore choisis
  commune: string;
  etals: Etal[];
  panier: Panier;
  creneau: string | null;
  livraison: boolean;
  bons: Bon[];
  convs: Record<string, Conversation>;
  prochainCode: number;
  horloge: number;
  demandes: Demande[];
  suivis: string[];                // espèces suivies (alertes d'arrivage)
  erreur: string | null;
};

const etatInitial = (): Etat => ({
  session: null,
  uid: null,
  profilIncomplet: false,
  commune: 'Le Robert',
  etals: MODE_DEMO ? JSON.parse(JSON.stringify(ETALS_DEMO)) : [],
  panier: null,
  creneau: null,
  livraison: false,
  bons: MODE_DEMO ? [
    { code: 'R-25', etalId: 'jm', client: 'Sophie L.', lignes: [{ produitId: 'jm1', espece: 'Thon jaune', kg: 1.5, prixKg: 14, preparation: 'En tranches', supplementKg: 2 }], creneau: 'Avant 10 h', statut: 'reserve', montantBloque: 27.3, creeLe: 0 },
    { code: 'R-26', etalId: 'jm', client: 'Marc D.', lignes: [{ produitId: 'jm2', espece: 'Dorade coryphène', kg: 2, prixKg: 13, preparation: 'En filets', supplementKg: 3 }], creneau: '10 h – 12 h', statut: 'reserve', montantBloque: 36.1, creeLe: 0 },
  ] : [],
  convs: MODE_DEMO ? {
    'jm|Sophie L.': { id: 'jm|Sophie L.', etalId: 'jm', client: 'Sophie L.', bon: 'R-25', luClient: true, luPecheur: false,
      messages: [{ id: 'm0', auteur: 'client', texte: 'Bonjour, je suis sur le parking. Vous êtes où exactement ?', heure: 7 * 60 + 57 }] },
  } : {},
  prochainCode: 27,
  horloge: MODE_DEMO ? HEURE_DEMO : B.maintenantMartinique(),
  demandes: MODE_DEMO ? [
    { id: 'd1', auteur: 'Chez Tante Arlette', pro: { raison: 'Restaurant Chez Tante Arlette', type: 'Restaurant', siret: '12345678900015', commune: 'Le Robert' }, espece: 'Thon jaune', kg: 15, prixMaxKg: 13, pour: 'Demain', note: 'Livraison avant 10 h si possible', statut: 'ouverte', creeLe: 7 * 60 },
    { id: 'd2', auteur: 'Poissonnerie du Bourg', pro: { raison: 'Poissonnerie du Bourg', type: 'Poissonnerie', siret: '98765432100015', commune: 'Le François' }, espece: 'Vivaneau', kg: 10, prixMaxKg: 16, pour: 'Aujourd’hui', statut: 'ouverte', creeLe: 7 * 60 + 30 },
  ] : [],
  suivis: [],
  erreur: null,
});

function creneauxDe(e: Etal) {
  const c = ['Avant 10 h'];
  if (e.limiteRetrait > 600) c.push('10 h – ' + (e.limiteRetrait >= 720 ? '12 h' : heure(e.limiteRetrait)));
  if (e.limiteRetrait > 720) c.push('12 h – ' + heure(e.limiteRetrait));
  return c;
}

// Réponses automatiques du pêcheur, uniquement pour la démo
function reponseDemo(texte: string, e: Etal): Omit<Message, 'id' | 'heure'>[] {
  const t = texte.toLowerCase();
  if (/o[uù] [eê]tes|vous [eê]tes o[uù]|position|trouver/.test(t)) {
    const p = PORTS[e.port];
    return [{ auteur: 'pecheur', texte: 'Je vous envoie ma position.' }, { auteur: 'pecheur', position: { libelle: 'En direct jusqu’à ' + heure(e.limiteRetrait), lat: p.lat, lon: p.lon } }];
  }
  if (/retard/.test(t)) return [{ auteur: 'pecheur', texte: 'Pas de souci, je vous attends jusqu’à ' + heure(e.limiteRetrait) + '.' }];
  if (/arrive/.test(t)) return [{ auteur: 'pecheur', texte: 'Parfait, à tout de suite ! Je suis ' + (e.precision ?? 'au port') + '.' }];
  if (/merci/.test(t)) return [{ auteur: 'pecheur', texte: 'Avec plaisir, bonne journée !' }];
  return [{ auteur: 'pecheur', texte: 'Bien reçu, merci !' }];
}

// Anti-contournement : les numéros de téléphone sont masqués dans la messagerie (aussi fait côté serveur)
export function masquerNumeros(t: string) {
  const re = /(\+?\d[\d .-]{7,}\d)/g;
  return { texte: t.replace(re, '•• •• •• •• ••'), masque: re.test(t) };
}

// Position réelle du téléphone (GPS) ; à défaut, le port du pêcheur
async function positionActuelle(defaut: { lat: number; lon: number }) {
  try {
    if (Platform.OS === 'web') {
      if (!('geolocation' in navigator)) return defaut;
      return await new Promise<{ lat: number; lon: number }>((ok) => navigator.geolocation.getCurrentPosition(
        (p) => ok({ lat: p.coords.latitude, lon: p.coords.longitude }), () => ok(defaut), { timeout: 8000, enableHighAccuracy: true }));
    }
    const L = await import('expo-location');
    const { status } = await L.requestForegroundPermissionsAsync();
    if (status !== 'granted') return defaut;
    const p = await L.getCurrentPositionAsync({ accuracy: L.Accuracy.High });
    return { lat: p.coords.latitude, lon: p.coords.longitude };
  } catch { return defaut; }
}

const aujourdHuiA = (minutes: number) => { // minutes (heure de Martinique) → Date
  const d = new Date(); const m = B.maintenantMartinique();
  return new Date(d.getTime() + (minutes - m) * 60000);
};

function useMagasin() {
  const [e, setE] = useState<Etat>(etatInitial);
  const [pret, setPret] = useState(false);
  const ref = useRef(e);
  ref.current = e;

  const maj = (f: (x: Etat) => Etat) => setE((x) => f(JSON.parse(JSON.stringify(x))));
  const tic = (x: Etat) => (MODE_DEMO ? (x.horloge += 1) : (x.horloge = B.maintenantMartinique()));
  const erreur = (err: unknown) => {
    const m = err instanceof Error ? err.message : 'Une erreur est survenue.';
    setE((x) => ({ ...x, erreur: m }));
  };

  // ───────── Mode réel : chargement depuis le serveur ─────────
  const recharger = async (): Promise<{ session: Session; profilIncomplet: boolean } | null> => {
    if (MODE_DEMO) return null;
    try {
      const s = await B.chargerSession();
      if (!s.session || !s.uid) {
        const etals = await B.chargerEtals();
        setE((x) => ({ ...x, session: null, uid: s.uid, profilIncomplet: s.profilIncomplet, etals, bons: [], convs: {}, demandes: [], horloge: B.maintenantMartinique() }));
        return s;
      }
      const [bons, convs, demandes, suivis] = await Promise.all([B.chargerBons(s.uid), B.chargerConversations(s.uid), B.chargerDemandes(s.uid), B.especesSuivies()]);
      // adresse exacte : seulement les étals où j'ai un bon payé
      const etals = await B.chargerEtals([...new Set(bons.filter((b) => b.client === 'Vous' && b.statut !== 'a_payer').map((b) => b.etalId))]);
      setE((x) => ({ ...x, session: s.session, uid: s.uid, profilIncomplet: false, etals, bons, convs, demandes, suivis, horloge: B.maintenantMartinique() }));
      return s;
    } catch (err) { erreur(err); return null; }
  };

  useEffect(() => {
    // éléments gardés sur le téléphone : tout en démo ; seulement commune / panier en mode réel
    AsyncStorage.getItem(CLE).then((v) => {
      if (!v) return;
      try {
        const lu = JSON.parse(v);
        // démo : une sauvegarde d'une ancienne version (sans les formats de vente) est ignorée
        if (MODE_DEMO && lu.v === VERSION_DEMO) setE({ ...etatInitial(), ...lu, demandes: lu.demandes ?? etatInitial().demandes, suivis: lu.suivis ?? [], erreur: null });
        else setE((x) => ({ ...x, commune: lu.commune ?? x.commune, panier: lu.panier ?? null, creneau: lu.creneau ?? null }));
      } catch { /* données illisibles : on repart de zéro */ }
    }).finally(async () => {
      // mode réel : on n'attend pas plus de 6 s le serveur (réseau faible au port) ; l'écran s'affiche
      // et se complète dès que les données arrivent
      if (!MODE_DEMO) {
        const delai = new Promise<'delai'>((ok) => setTimeout(() => ok('delai'), 6000));
        if ((await Promise.race([recharger(), delai])) === 'delai') setE((x) => ({ ...x, erreur: 'Connexion lente : les arrivages s’affichent dès que le réseau répond.' }));
      }
      setPret(true);
    });
    if (MODE_DEMO) return;
    const abonnement = B.surChangementSession(() => { recharger(); });
    const arret = B.ecouterChangements(() => { recharger(); });
    const minuteur = setInterval(() => setE((x) => ({ ...x, horloge: B.maintenantMartinique() })), 30000);
    return () => { abonnement.unsubscribe(); arret(); clearInterval(minuteur); };
  }, []);
  useEffect(() => {
    if (!pret) return;
    const { session, commune, panier, creneau } = e;
    const aGarder = MODE_DEMO ? { ...e, erreur: null } : { commune, panier, creneau };
    AsyncStorage.setItem(CLE, JSON.stringify({ ...aGarder, v: VERSION_DEMO })).catch(() => {});
    if (!MODE_DEMO && session) B.enregistrerNotifications();
  }, [e, pret]);

  const actions = useMemo(() => ({
    effacerErreur() { setE((x) => ({ ...x, erreur: null })); },
    recharger,

    // ───────── Connexion ─────────
    async connecter(telephone: string, role: Role, prenom: string) {
      if (!MODE_DEMO) { try { await B.enregistrerClient(prenom, ref.current.commune); await recharger(); } catch (err) { erreur(err); } return; }
      maj((x) => ({ ...x, session: role === 'pecheur'
        ? { telephone, role, prenom, etalId: 'jm', statutPecheur: 'verifie', stripePret: true }
        : { telephone, role, prenom } }));
    },
    async connecterPro(telephone: string, prenom: string, pro: InfosPro) {
      if (!MODE_DEMO) { try { await B.enregistrerPro(prenom, pro); await recharger(); maj((x) => ({ ...x, commune: PORTS[pro.commune] ? pro.commune : x.commune })); } catch (err) { erreur(err); } return; }
      maj((x) => ({ ...x, session: { telephone, role: 'client', prenom, pro }, commune: PORTS[pro.commune] ? pro.commune : x.commune }));
    },
    async inscrirePecheur(infos: { prenom: string; port: string; bateau: string; immatriculation: string; numeroMarin: string; telephone: string }) {
      if (!MODE_DEMO) { try { await B.inscrirePecheur(infos); await recharger(); } catch (err) { erreur(err); } return; }
      maj((x) => {
        const id = 'moi';
        x.etals = x.etals.filter((t) => t.id !== id);
        x.etals.push({ id, pecheur: infos.prenom, port: infos.port, note: 5, avis: 0, bateau: infos.bateau, debarque: x.horloge, limiteRetrait: 12 * 60,
          lieu: 'Débarcadère de ' + infos.port, precision: 'à préciser par le pêcheur', produits: [] });
        x.session = { telephone: infos.telephone, role: 'pecheur', prenom: infos.prenom, etalId: id, statutPecheur: 'en_attente', stripePret: false };
        return x;
      });
    },
    // Compte de paiement du pêcheur : page sécurisée de Stripe en mode réel
    async ouvrirComptePaiement() {
      if (MODE_DEMO) { maj((x) => { if (x.session) x.session.stripePret = true; return x; }); return; }
      try { await B.ouvrirComptePaiement(); } catch (err) { erreur(err); }
    },
    async verifierComptePaiement() {
      if (MODE_DEMO) return;
      try { await B.comptePaiement('etat'); await recharger(); } catch (err) { erreur(err); }
    },

    // ───────── Demandes des professionnels ─────────
    async posterDemande(d: { espece: string; kg: number; prixMaxKg: number; pour: Demande['pour']; note?: string; livraison?: Demande['livraison'] }) {
      if (!MODE_DEMO) { const pro = ref.current.session?.pro; if (!pro) return; try { await B.posterDemande(d, pro); await recharger(); } catch (err) { erreur(err); } return; }
      maj((x) => { if (!x.session?.pro) return x; x.demandes.unshift({ ...d, id: 'd' + Date.now(), auteur: 'Vous', pro: x.session.pro, statut: 'ouverte', creeLe: x.horloge }); return x; });
    },
    async annulerDemande(id: string) {
      if (!MODE_DEMO) { try { await B.annulerDemande(id); await recharger(); } catch (err) { erreur(err); } return; }
      maj((x) => { const d = x.demandes.find((y) => y.id === id); if (d && d.statut === 'ouverte') d.statut = 'annulee'; return x; });
    },
    async accepterDemande(id: string, etalId: string) {
      if (!MODE_DEMO) { try { await B.accepterDemande(id); await recharger(); } catch (err) { erreur(err); } return; }
      maj((x) => {
        const d = x.demandes.find((y) => y.id === id); if (!d || d.statut !== 'ouverte') return x;
        const code = 'R-' + x.prochainCode; x.prochainCode += 1;
        const lignes: LignePanier[] = [{ produitId: 'dem-' + id, espece: d.espece, format: 'kilo', kg: d.kg, prixKg: d.prixMaxKg, preparation: 'Entier', supplementKg: 0 }];
        const client = d.auteur;
        x.bons.push({ code, etalId, client, pro: d.pro, livraison: d.livraison, lignes, creneau: d.pour === 'Demain' ? 'Demain matin' : 'Aujourd’hui', statut: 'reserve', montantBloque: montantBloque(lignes, d.livraison?.frais ?? 0), creeLe: x.horloge });
        d.statut = 'acceptee'; d.etalId = etalId; d.bon = code;
        const cid = etalId + '|' + client;
        x.convs[cid] = x.convs[cid] ?? { id: cid, etalId, client, bon: code, messages: [], luClient: false, luPecheur: true };
        x.convs[cid].bon = code;
        x.convs[cid].messages.push({ id: 'a' + Date.now(), auteur: 'pecheur', texte: 'Bonjour, je peux vous fournir ' + kg(d.kg) + ' de ' + d.espece.toLowerCase() + ' à ' + d.prixMaxKg.toFixed(2).replace('.', ',') + ' €/kg (' + d.pour.toLowerCase() + ')' + (d.livraison ? ', livré par un chauffeur à votre établissement' : '') + '. Commande ' + code + ' créée.', heure: tic(x) });
        x.convs[cid].luClient = false;
        return x;
      });
    },
    simulerVerification() { maj((x) => { if (x.session) x.session.statutPecheur = 'verifie'; return x; }); },
    simulerStripe() { maj((x) => { if (x.session) x.session.stripePret = true; return x; }); },
    async deconnecter() {
      if (!MODE_DEMO) { try { await B.deconnexion(); } catch { /* déjà déconnecté */ } setE((x) => ({ ...etatInitial(), etals: x.etals, commune: x.commune })); return; }
      maj((x) => ({ ...x, session: null, panier: null }));
    },
    reinitialiser() { const s = etatInitial(); setE(s); },
    choisirCommune(c: string) { maj((x) => ({ ...x, commune: c })); },

    // ───────── Panier (toujours sur le téléphone) ─────────
    // Au kilo : poids voulu (pas de 0,5 ou 1 kg)
    reglerKg(etalId: string, produitId: string, q: number) {
      maj((x) => {
        const et = x.etals.find((t) => t.id === etalId)!; const pr = et.produits.find((p) => p.id === produitId)!;
        q = Math.max(0, Math.min(pr.dispoKg, Math.round(q * 10) / 10));
        if (!x.panier || x.panier.etalId !== etalId) x.panier = { etalId, lignes: [] };
        let l = x.panier.lignes.find((y) => y.produitId === produitId);
        if (!l && q > 0) { l = { produitId, espece: pr.espece, format: 'kilo', kg: 0, prixKg: pr.prixKg, preparation: pr.preparations[0]?.nom ?? 'Entier', supplementKg: pr.preparations[0]?.supplementKg ?? 0 }; x.panier.lignes.push(l); }
        if (l) l.kg = q;
        x.panier.lignes = x.panier.lignes.filter((y) => y.kg > 0 || (y.nombre ?? 0) > 0);
        if (!x.panier.lignes.length) x.panier = null;
        return x;
      });
    },
    // À la pièce : le client choisit un poisson précis (poids approximatif)
    basculerPiece(etalId: string, produitId: string, pieceId: string) {
      maj((x) => {
        const pr = x.etals.find((t) => t.id === etalId)!.produits.find((p) => p.id === produitId)!;
        const piece = pr.pieces?.find((q) => q.id === pieceId); if (!piece) return x;
        if (!x.panier || x.panier.etalId !== etalId) x.panier = { etalId, lignes: [] };
        const deja = x.panier.lignes.find((l) => l.produitId === produitId && l.pieceId === pieceId);
        if (deja) x.panier.lignes = x.panier.lignes.filter((l) => l !== deja);
        else x.panier.lignes.push({ produitId, pieceId, espece: pr.espece, format: 'piece', kg: piece.poidsKg, prixKg: pr.prixKg, tete: 'avec',
          preparation: pr.preparations[0]?.nom ?? 'Entier', supplementKg: pr.preparations[0]?.supplementKg ?? 0 });
        if (!x.panier.lignes.length) x.panier = null;
        return x;
      });
    },
    // Barquettes ou lots : nombre voulu
    reglerNombre(etalId: string, produitId: string, n: number) {
      maj((x) => {
        const pr = x.etals.find((t) => t.id === etalId)!.produits.find((p) => p.id === produitId)!;
        const max = pr.format === 'portion' ? pr.portion?.nombre ?? 0 : pr.lot?.nombre ?? 0;
        n = Math.max(0, Math.min(max, Math.round(n)));
        if (!x.panier || x.panier.etalId !== etalId) x.panier = { etalId, lignes: [] };
        let l = x.panier.lignes.find((y) => y.produitId === produitId);
        if (!l && n > 0) {
          l = pr.format === 'portion'
            ? { produitId, espece: pr.espece, format: 'portion', kg: 0, prixKg: pr.prixKg, preparation: pr.portion!.type, supplementKg: 0, nombre: 0, libelle: nomBarquette(pr.portion!) }
            : { produitId, espece: pr.espece, format: 'lot', kg: 0, prixKg: 0, preparation: 'Lot', supplementKg: 0, nombre: 0, prixLot: pr.lot!.prix, libelle: nomLot(pr.lot!) };
          x.panier.lignes.push(l);
        }
        if (l) { l.nombre = n; l.kg = pr.format === 'portion' ? Math.round(n * pr.portion!.poidsKg * 10) / 10 : pr.lot?.unite === 'kg' ? n * pr.lot.quantite : 0; }
        x.panier.lignes = x.panier.lignes.filter((y) => y.kg > 0 || (y.nombre ?? 0) > 0);
        if (!x.panier.lignes.length) x.panier = null;
        return x;
      });
    },
    choisirPreparation(cle: string, nom: string) {
      maj((x) => {
        const l = x.panier?.lignes.find((y) => cleLigne(y) === cle); if (!x.panier || !l) return x;
        const pr = x.etals.find((t) => t.id === x.panier!.etalId)!.produits.find((p) => p.id === l.produitId)!;
        const prep = pr.preparations.find((p) => p.nom === nom); if (!prep) return x;
        l.preparation = prep.nom; l.supplementKg = prep.supplementKg; return x;
      });
    },
    choisirTete(cle: string, tete: 'avec' | 'sans') {
      maj((x) => { const l = x.panier?.lignes.find((y) => cleLigne(y) === cle); if (l) l.tete = tete; return x; });
    },
    viderPanier() { maj((x) => ({ ...x, panier: null })); },
    choisirCreneau(c: string) { maj((x) => ({ ...x, creneau: c })); },
    choisirLivraison(v: boolean) { maj((x) => ({ ...x, livraison: v })); },

    // ───────── Réservation : empreinte bancaire Stripe en mode réel ─────────
    async reserver(): Promise<string | null> {
      const x0 = ref.current; if (!x0.panier || !x0.session) return null;
      if (!MODE_DEMO) {
        const et = x0.etals.find((t) => t.id === x0.panier!.etalId); if (!et) return null;
        const creneau = x0.creneau && creneauxDe(et).includes(x0.creneau) ? x0.creneau : creneauxDe(et)[Math.min(1, creneauxDe(et).length - 1)];
        try {
          const code = await B.reserver(et.id, x0.panier.lignes, creneau, x0.livraison);
          maj((x) => ({ ...x, panier: null, livraison: false }));
          await recharger();
          return code;
        } catch (err) { erreur(err); await recharger(); return null; }
      }
      const code = 'R-' + x0.prochainCode;
      maj((x) => {
        const et = x.etals.find((t) => t.id === x.panier!.etalId)!;
        const lignes = x.panier!.lignes;
        lignes.forEach((l) => {
          const p = et.produits.find((q) => q.id === l.produitId)!;
          if (p.format === 'piece') p.pieces = (p.pieces ?? []).filter((q) => q.id !== l.pieceId);
          else if (p.format === 'portion' && p.portion) p.portion.nombre -= l.nombre ?? 0;
          else if (p.format === 'lot' && p.lot) p.lot.nombre -= l.nombre ?? 0;
          else p.dispoKg = Math.round((p.dispoKg - l.kg) * 10) / 10;
          if (p.format !== 'kilo') p.dispoKg = Math.round(stockKg(p) * 10) / 10;
        });
        const creneau = x.creneau && creneauxDe(et).includes(x.creneau) ? x.creneau : creneauxDe(et)[Math.min(1, creneauxDe(et).length - 1)];
        const totalKg = lignes.reduce((t, l) => t + l.kg, 0);
        const livraison = x.session?.pro && x.livraison && totalKg >= LIVRAISON_MIN_KG ? { adresse: x.session.pro.adresse || x.session.pro.raison + ', ' + x.session.pro.commune, frais: FRAIS_LIVRAISON } : undefined;
        x.bons.push({ code, etalId: et.id, client: 'Vous', pro: x.session?.pro, livraison, lignes, creneau: livraison ? 'Livraison ' + creneau.toLowerCase() : creneau, statut: 'reserve', montantBloque: montantBloque(lignes, livraison?.frais ?? 0), creeLe: x.horloge });
        x.livraison = false;
        const id = et.id + '|Vous';
        x.convs[id] = x.convs[id] ?? { id, etalId: et.id, client: 'Vous', bon: code, messages: [], luClient: true, luPecheur: false };
        x.convs[id].bon = code;
        x.panier = null; x.prochainCode += 1;
        return x;
      });
      setTimeout(() => maj((x) => {
        const b = x.bons.find((y) => y.code === code); if (!b) return x;
        const c = x.convs[b.etalId + '|Vous'];
        c.messages.push({ id: 'b' + code, auteur: 'pecheur', texte: 'Bonjour ! Bien reçu votre réservation ' + code + ', je vous prépare ça (' + b.creneau.toLowerCase() + ').', heure: tic(x) });
        c.luClient = false; return x;
      }), 2500);
      return code;
    },
    // Commande de pro acceptée par un pêcheur : la régler
    async payerBon(code: string) {
      if (MODE_DEMO) { maj((x) => { const b = x.bons.find((y) => y.code === code); if (b) b.statut = 'reserve'; return x; }); return; }
      try { await B.payerBon(code); } catch (err) { erreur(err); }
    },
    // Contenu du QR code du bon (lien signé par le serveur, non falsifiable) et code de retrait à 6 chiffres
    // à dicter au pêcheur si le QR ne se lit pas
    async lienQr(code: string): Promise<{ lien: string; pin: string }> {
      if (MODE_DEMO) return { lien: SITE + '/pesee/' + code + '?s=demo', pin: '482615' };
      try { const r = await B.monQr(code); return r.signature ? { lien: SITE + '/pesee/' + code + '?s=' + r.signature, pin: r.codeRetrait ?? '' } : { lien: '', pin: '' }; } catch { return { lien: '', pin: '' }; }
    },
    // Signaler une conversation ; bloquer = plus de messages ni d'appels
    async signaler(convId: string, motif: string, bloquer: boolean): Promise<boolean> {
      if (MODE_DEMO) return true;
      const c = ref.current.convs[convId];
      try { await B.signaler(c?.uuid ?? '', motif, bloquer); await recharger(); return true; } catch (err) { erreur(err); return false; }
    },
    // Appel par Internet : renvoie de quoi rejoindre l'appel (null en démo : appel simulé)
    async preparerAppel(convId: string): Promise<{ appId: string; canal: string; jeton: string; numero: number; autre: number; reponse: boolean } | null> {
      if (MODE_DEMO) return null;
      const c = ref.current.convs[convId];
      if (!c?.uuid) throw new Error('Conversation introuvable.');
      return B.jetonAppel(c.uuid);
    },
    // Suivi étape par étape du bon (en démo : reconstitué à partir de son état)
    async suivi(code: string): Promise<EtapeSuivi[]> {
      if (!MODE_DEMO) { try { return await B.chargerSuivi(code); } catch { return []; } }
      const b = ref.current.bons.find((y) => y.code === code); if (!b) return [];
      const d = new Date(); const t = (m: number) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + (m + 240) * 60_000; // heure de Martinique (UTC−4)
      const s: EtapeSuivi[] = [{ etape: b.pro && b.statut === 'a_payer' ? 'commande_creee' : 'reservee', par: b.pro ? 'pro' : 'client', quand: t(b.creeLe), details: { montantBloque: b.montantBloque } }];
      if (b.statut !== 'a_payer') s.push({ etape: 'payee', par: 'stripe', quand: t(b.creeLe + 1), details: {} });
      if (b.statut === 'retire') s.push({ etape: 'retiree', par: 'pecheur', quand: t(b.creeLe + 60), details: { debite: b.montantPaye } });
      if (b.facture) s.push({ etape: 'facture_emise', par: 'systeme', quand: t(b.creeLe + 60), details: { numero: b.facture } });
      return s;
    },
    // Ouvre la facture PDF d'un pro (fichier privé)
    async ouvrirFacture(numero: string) {
      if (MODE_DEMO) { erreur(new Error('Démo : la facture PDF est créée par le serveur, une fois l’appli branchée.')); return; }
      try {
        const lien = await B.lienFacture(numero);
        if (Platform.OS === 'web') window.open(lien, '_blank'); else await (await import('react-native')).Linking.openURL(lien);
      } catch (err) { erreur(err); }
    },
    async verifierQr(code: string, signature: string): Promise<{ ok: boolean; message: string }> {
      if (MODE_DEMO) return /^\d{6}$/.test(signature) || signature === 'demo' ? { ok: true, message: 'Bon reconnu (démo : pas de vérification).' } : { ok: false, message: 'Code de retrait : 6 chiffres.' };
      try { const r = await B.verifierBon(code, signature); return { ok: true, message: 'Bon authentique · ' + r.client + ' · ' + r.creneau }; }
      catch (err) { return { ok: false, message: err instanceof Error ? err.message : 'QR non valable.' }; }
    },

    // ───────── Messagerie ─────────
    async envoyer(convId: string, texte: string, auteur: Role) {
      texte = texte.trim(); if (!texte) return;
      const m = masquerNumeros(texte);
      maj((x) => {
        const c = x.convs[convId];
        c.messages.push({ id: 'm' + Date.now(), auteur, texte: m.texte, heure: tic(x) });
        if (m.masque) c.messages.push({ id: 's' + Date.now(), auteur: 'systeme', texte: 'Numéro masqué : les échanges restent sur Pêche Connect jusqu’au retrait.', heure: x.horloge });
        if (auteur === 'client') c.luPecheur = false; else c.luClient = false;
        return x;
      });
      if (!MODE_DEMO) {
        const c = ref.current.convs[convId];
        try { if (c?.uuid) await B.envoyerMessage(c.uuid, auteur, m.texte); await recharger(); } catch (err) { erreur(err); }
        return;
      }
      if (auteur === 'client') {
        setTimeout(() => maj((x) => {
          const c = x.convs[convId]; const et = x.etals.find((t) => t.id === c.etalId)!;
          reponseDemo(texte, et).forEach((r, i) => c.messages.push({ ...r, id: 'r' + Date.now() + i, heure: tic(x) }));
          c.luClient = false; return x;
        }), 1300);
      }
    },
    // Message vocal (client ou pêcheur)
    async envoyerAudio(convId: string, a: Enregistrement, auteur: Role) {
      if (!MODE_DEMO) {
        const c = ref.current.convs[convId];
        try { if (c?.uuid) await B.envoyerAudio(c.uuid, auteur, a); await recharger(); } catch (err) { erreur(err); }
        return;
      }
      // démo : le son est gardé sur ce téléphone (texte « data: » pour survivre au rechargement de la page)
      const uri = a.donnees ? await versDataUrl(a.donnees) : a.uri;
      maj((x) => {
        const c = x.convs[convId];
        c.messages.push({ id: 'v' + Date.now(), auteur, audio: { uri, duree: a.duree }, heure: tic(x) });
        if (auteur === 'client') c.luPecheur = false; else c.luClient = false;
        return x;
      });
      if (auteur === 'client') setTimeout(() => maj((x) => {
        const c = x.convs[convId];
        c.messages.push({ id: 'r' + Date.now(), auteur: 'pecheur', texte: 'Bien reçu votre message vocal, merci !', heure: tic(x) });
        c.luClient = false; return x;
      }), 1500);
    },
    // Position du pêcheur : visible seulement dans la conversation d'un client avec un bon payé,
    // et effacée automatiquement (fin du retrait, ou 30 min pour « une seule fois »)
    async envoyerPosition(convId: string, mode: 'direct' | 'une-fois' | 'habituel') {
      const x0 = ref.current; const c = x0.convs[convId]; const et = x0.etals.find((t) => t.id === c?.etalId); if (!c || !et) return;
      const port = PORTS[et.port] ?? PORTS['Le Robert'];
      const libelle = mode === 'direct' ? 'Position jusqu’à ' + heure(et.limiteRetrait) : mode === 'une-fois' ? 'Position envoyée à ' + heure(x0.horloge) : 'Point de vente habituel · ' + (et.lieu ?? et.port);
      const pos = mode === 'habituel' ? port : MODE_DEMO ? port : await positionActuelle(port);
      if (!MODE_DEMO) {
        const fin = mode === 'une-fois' ? new Date(Date.now() + DELAI_POSITION_MIN * 60000) : aujourdHuiA(Math.max(et.limiteRetrait, B.maintenantMartinique() + 30));
        try { if (c.uuid) await B.envoyerMessage(c.uuid, 'pecheur', undefined, { libelle, lat: pos.lat, lon: pos.lon }, fin); await recharger(); } catch (err) { erreur(err); }
        return;
      }
      maj((x) => {
        const cc = x.convs[convId];
        cc.messages.push({ id: 'p' + Date.now(), auteur: 'pecheur', position: { libelle, lat: pos.lat, lon: pos.lon }, heure: tic(x) });
        cc.luClient = false; return x;
      });
    },
    marquerLu(convId: string, role: Role) {
      const c = ref.current.convs[convId];
      maj((x) => { const cc = x.convs[convId]; if (!cc) return x; if (role === 'client') cc.luClient = true; else cc.luPecheur = true; return x; });
      if (!MODE_DEMO && c?.uuid) B.marquerLu(c.uuid, role === 'client' ? 'client' : 'pecheur').catch(() => {});
    },

    // ───────── Espace pêcheur ─────────
    async publierArrivage(etalId: string, lignes: Omit<Produit, 'id'>[], photo?: { uri: string; type?: string }): Promise<boolean> {
      if (!MODE_DEMO) {
        try {
          const url = photo ? await B.envoyerPhoto(etalId, photo.uri, photo.type) : undefined;
          await B.publierArrivage(etalId, lignes, url); await recharger(); return true;
        } catch (err) { erreur(err); return false; }
      }
      maj((x) => {
        const et = x.etals.find((t) => t.id === etalId)!;
        et.produits = lignes.map((l, i) => { const p = { ...l, id: etalId + '-' + i + '-' + Date.now() } as Produit; if (p.format !== 'kilo') p.dispoKg = Math.round(stockKg(p) * 10) / 10; return p; }).filter(disponible);
        if (photo) et.photo = photo.uri;
        et.debarque = x.horloge; return x;
      });
      return true;
    },
    async validerPesee(code: string, poids: number[], preuve: string): Promise<boolean> {
      if (!MODE_DEMO) { try { await B.validerPesee(code, poids, preuve); await recharger(); return true; } catch (err) { erreur(err); return false; } }
      maj((x) => {
        const b = x.bons.find((y) => y.code === code)!;
        b.lignes.forEach((l, i) => { if (l.format === 'lot') l.nombre = poids[i]; else l.kg = poids[i]; });
        b.montantPaye = montantPaye(b.lignes, b.livraison?.frais ?? 0);
        b.statut = 'retire'; if (b.pro) b.facture = 'FA-DEMO-' + code.replace('R-', '').padStart(6, '0'); return x;
      });
      return true;
    },

    // ───────── Mon compte (données personnelles) ─────────
    async suivre(espece: string, oui: boolean) {
      maj((x) => ({ ...x, suivis: oui ? [...new Set([...x.suivis, espece])] : x.suivis.filter((s) => s !== espece) }));
      if (!MODE_DEMO) { try { await B.suivre(espece, oui); } catch (err) { erreur(err); } }
    },
    async exporterDonnees(): Promise<object | null> {
      if (MODE_DEMO) { const x = ref.current; return { exporte_le: new Date().toISOString(), mode: 'démo (données stockées sur ce téléphone uniquement)', session: x.session, bons: x.bons.filter((b) => b.client === 'Vous'), conversations: Object.values(x.convs).filter((c) => c.client === 'Vous'), especes_suivies: x.suivis }; }
      try { return await B.exporterDonnees(); } catch (err) { erreur(err); return null; }
    },
    async supprimerCompte(): Promise<boolean> {
      if (MODE_DEMO) { setE(etatInitial()); await AsyncStorage.removeItem(CLE); return true; }
      try { await B.supprimerCompte(); setE((x) => ({ ...etatInitial(), etals: x.etals })); await AsyncStorage.removeItem(CLE); return true; } catch (err) { erreur(err); return false; }
    },
  }), []);

  const sel = useMemo(() => ({
    etal: (id?: string) => e.etals.find((t) => t.id === id),
    frais: (t: Etal) => e.horloge - t.debarque >= 0 && e.horloge - t.debarque < 60,
    depuis: (t: Etal) => { const d = e.horloge - t.debarque; if (d < 0 || d > 20 * 60) return 'hier ou avant'; return d < 60 ? 'il y a ' + d + ' min' : 'il y a ' + Math.floor(d / 60) + ' h' + (d % 60 ? ' ' + String(d % 60).padStart(2, '0') : ''); },
    km: (t: Etal) => distanceKm(PORTS[e.commune] ?? PORTS['Le Robert'], PORTS[t.port] ?? PORTS['Le Robert']),
    minPrix: (t: Etal) => { const d = t.produits.filter((p) => disponible(p) && p.format !== 'lot'); return d.length ? Math.min(...d.map((p) => p.prixKg)) : null; },
    kgPanier: (etalId: string, produitId: string) => (e.panier?.etalId === etalId ? e.panier.lignes.find((l) => l.produitId === produitId)?.kg ?? 0 : 0),
    nombrePanier: (etalId: string, produitId: string) => (e.panier?.etalId === etalId ? e.panier.lignes.find((l) => l.produitId === produitId)?.nombre ?? 0 : 0),
    pieceDansPanier: (etalId: string, produitId: string, pieceId: string) => !!(e.panier?.etalId === etalId && e.panier.lignes.some((l) => l.produitId === produitId && l.pieceId === pieceId)),
    creneaux: creneauxDe,
    mesBons: () => e.bons.filter((b) => b.client === 'Vous').slice().reverse(),
    mesDemandes: () => e.demandes.filter((d) => d.auteur === 'Vous'),
    // un pro ne voit pas ses propres besoins ici ; en démo, le pêcheur voit aussi ceux publiés depuis ce téléphone
    demandesOuvertes: () => e.demandes.filter((d) => d.statut === 'ouverte' && !(e.session?.pro && d.auteur === 'Vous')),
    bonsPecheur: (etalId?: string) => e.bons.filter((b) => b.etalId === etalId && b.statut !== 'a_payer'),
    nonLusClient: () => Object.values(e.convs).filter((c) => c.client === 'Vous' && !c.luClient).length,
    nonLusPecheur: (etalId?: string) => Object.values(e.convs).filter((c) => c.etalId === etalId && !c.luPecheur).length,
    resume: (lignes: LignePanier[]) => lignes.map(libelleLigne).join(', '),
  }), [e]);

  return { e, pret, ...actions, ...sel };
}

type Magasin = ReturnType<typeof useMagasin>;
const Ctx = createContext<Magasin | null>(null);
export function MagasinProvider({ children }: { children: React.ReactNode }) {
  const m = useMagasin();
  return <Ctx.Provider value={m}>{children}</Ctx.Provider>;
}
export function useApp() {
  const m = useContext(Ctx);
  if (!m) throw new Error('useApp doit être utilisé dans MagasinProvider');
  return m;
}
