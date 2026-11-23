import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Chiffres } from '../src/components/Chiffres';
import { Bouton, Chip, EnTete, Feuille, T, Vide } from '../src/components/ui';
import { euro } from '../src/format';
import * as B from '../src/services/backend';
import { MODE_DEMO } from '../src/store';
import { couleurs as c, polices as f } from '../src/theme';

type Tableau = Awaited<ReturnType<typeof B.equipeTableau>>;

// Exemples affichés en mode démo (rien n'est envoyé)
const DEMO: Tableau = {
  dossiers: [
    { etalId: 'd1', prenom: 'Patrick', port: 'Le Vauclin', bateau: 'Lanmè Bèl', stripePret: true, creeLe: new Date().toISOString(), immatriculation: 'FF 654321', nomLegal: null, numeroMarin: 'AB998877', motifRefus: null },
    { etalId: 'd2', prenom: 'Rose', port: 'Grand-Rivière', bateau: 'Ti Kanno', stripePret: false, creeLe: new Date().toISOString(), immatriculation: 'FF 102938', nomLegal: null, numeroMarin: 'CD445566', motifRefus: null },
  ],
  signalements: [
    { id: 's1', conv: 'jm_x', bonCode: 'R-12', motif: 'Le pêcheur me demande de payer en liquide en dehors de l’appli.', bloquer: false, le: new Date().toISOString(), par: { prenom: 'Sophie', role: 'client' }, contre: { prenom: 'Jean-Marc', role: 'pêcheur' } },
  ],
  avis: [{ code: 'R-9', etalId: 'jm', prenom: 'Kévin', note: 1, commentaire: 'Nul !!! appelez-moi au •• •• •• •• ••', le: new Date().toISOString() }],
  controle: { jour: new Date().toISOString().slice(0, 10), ok: true, anomalies: 0, verifies: 42, ecarts: [], erreurs: [] },
  avoirs: [],
  factures: [{ numero: 'FA-2026-000001', bon: 'R-31', emiseLe: new Date().toISOString(), acheteur: 'Le Comptoir du Port', vendeur: 'Jean-Marc', totalTtc: 182.4 }],
};
const MOTIFS = ['Numéro de marin introuvable', 'Immatriculation ne correspond pas', 'Pièce illisible : à renvoyer', 'Pas pêcheur professionnel'];
const jour = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

// Espace équipe : vérifier les pêcheurs, traiter les signalements, retrouver les factures
export default function Equipe() {
  const [t, setT] = useState<Tableau | null>(MODE_DEMO ? DEMO : null);
  const [erreur, setErreur] = useState('');
  const [info, setInfo] = useState('');
  const [refus, setRefus] = useState<{ etalId: string; prenom: string; decision: 'refuser' | 'suspendre' } | null>(null);
  const [motif, setMotif] = useState('');
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    if (MODE_DEMO) return;
    try { setT(await B.equipeTableau()); setErreur(''); } catch (e) { setErreur((e as Error).message); }
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const agir = async (f: () => Promise<unknown>, apres: (x: Tableau) => Tableau, message: string) => {
    setOccupe(true);
    try {
      if (MODE_DEMO) setT((x) => (x ? apres(x) : x)); else { await f(); await charger(); }
      setInfo(message);
    } catch (e) { setInfo((e as Error).message); }
    setOccupe(false);
  };
  const decider = (d: B.Dossier, decision: 'verifier' | 'refuser' | 'suspendre', m = '') =>
    agir(() => B.equipeDossier(d.etalId, decision, m), (x) => ({ ...x, dossiers: x.dossiers.filter((y) => y.etalId !== d.etalId) }),
      decision === 'verifier' ? 'Dossier de ' + d.prenom + ' vérifié : vente possible dès que son compte de paiement est prêt.' : 'Dossier de ' + d.prenom + (decision === 'refuser' ? ' refusé' : ' suspendu') + ' ; le motif lui est envoyé.');
  const signalement = (s: B.SignalementEquipe, decision: 'classer' | 'suspendre') =>
    agir(() => B.equipeSignalement(s.id, decision), (x) => ({ ...x, signalements: x.signalements.filter((y) => y.id !== s.id) }),
      decision === 'classer' ? 'Signalement classé.' : 'Compte de ' + s.contre.prenom + ' suspendu.');
  const [remb, setRemb] = useState({ code: '', montant: '', motif: '' });
  const controler = () => agir(async () => { const r = await B.equipeControler(); setInfo(r.ok ? 'Contrôle refait : tout est cohérent.' : r.anomalies + ' anomalie(s) : voir ci-dessous.'); },
    (x) => x, 'Contrôle refait : tout est cohérent.');
  const rembourser = () => {
    const montant = remb.montant ? Number(remb.montant.replace(',', '.')) : undefined;
    agir(() => B.equipeRembourser(remb.code.trim().toUpperCase(), remb.motif.trim(), montant), (x) => x,
      'Remboursement de ' + remb.code.toUpperCase() + ' envoyé : le client est prévenu, la part du pêcheur et la commission sont reprises.');
    setRemb({ code: '', montant: '', motif: '' });
  };
  const dac7 = async (annee: number) => {
    if (MODE_DEMO) { setInfo('Démo : l’export DAC7 est produit par le serveur une fois l’appli branchée.'); return; }
    try {
      const r = await B.equipeDac7(annee);
      if (Platform.OS === 'web') { const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('\ufeff' + r.csv); a.download = r.nom; a.click(); }
      setInfo(r.vendeurs + ' vendeur(s) dans l’export ' + annee + '.');
    } catch (e) { setInfo((e as Error).message); }
  };
  const champ = { borderWidth: 1, borderColor: c.ligne, borderRadius: 12, padding: 12, fontFamily: f.normal, color: c.texte } as const;

  const facture = async (numero: string) => {
    if (MODE_DEMO) { setInfo('Démo : le PDF est créé par le serveur une fois l’appli branchée.'); return; }
    try {
      const r = await B.equipeFacture(numero);
      if (Platform.OS === 'web') {
        const a = document.createElement('a'); a.href = 'data:application/pdf;base64,' + r.pdf; a.download = r.nom; a.click();
      } else setInfo('Ouvrez l’espace équipe depuis un ordinateur pour télécharger le PDF.');
    } catch (e) { setInfo((e as Error).message); }
  };

  if (erreur) return <SafeAreaView style={{ flex: 1, backgroundColor: c.fond }}><EnTete titre="Espace équipe" fermer /><Vide titre="Accès refusé" texte={erreur} action="Retour" onAction={() => router.back()} /></SafeAreaView>;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.fond }}>
      <EnTete titre="Espace équipe" sousTitre={MODE_DEMO ? 'Démo : exemples, rien n’est envoyé' : 'Réservé à l’équipe Pêche Connect'} fermer />
      {!t ? <Vide titre="Chargement…" texte="" perso={false} /> : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
          {info ? <View style={{ backgroundColor: c.doux, borderRadius: 12, padding: 12 }}><T gras>{info}</T></View> : null}

          <T tresGras style={{ fontSize: 18 }}>Chiffres</T>
          <Chiffres />

          <View style={{ borderWidth: 1, borderColor: t.controle && !t.controle.ok ? c.alerte : c.ligne, borderRadius: 14, padding: 14, gap: 6 }}>
            <T tresGras style={{ fontSize: 16 }}>Contrôle de la nuit {t.controle ? '· ' + t.controle.jour : ''}</T>
            {!t.controle ? <T gris>Pas encore de contrôle (il tourne chaque nuit à 4 h 30).</T> : t.controle.ok
              ? <T style={{ color: c.vert }}>Tout est cohérent : {t.controle.verifies} paiements Stripe rapprochés, contraintes de la base respectées.</T>
              : <T gras style={{ color: c.alerte }}>{t.controle.anomalies} anomalie(s) à regarder :</T>}
            {t.controle?.ecarts.map((x, i) => <T key={'e' + i} petit>{x.corrige ? '✓ corrigé · ' : '• '}{x.code} : {x.probleme} (Stripe : {x.stripe}, base : {x.base})</T>)}
            {t.controle?.erreurs.map((x, i) => <T key={'i' + i} petit>• {x}</T>)}
            <Pressable onPress={controler} disabled={occupe} accessibilityRole="button"><T tresGras style={{ color: c.marine }}>Refaire le contrôle maintenant</T></Pressable>
          </View>

          <T tresGras style={{ fontSize: 18 }}>Pêcheurs à vérifier ({t.dossiers.length})</T>
          <T gris petit>Avant de valider : contrôlez le numéro de marin (registre des marins, Direction de la mer) et l’immatriculation du bateau (carte de circulation / rôle d’équipage).</T>
          {t.dossiers.length ? t.dossiers.map((d) => (
            <View key={d.etalId} style={{ borderWidth: 1, borderColor: c.ligne, borderRadius: 14, padding: 14, gap: 6 }}>
              <T tresGras style={{ fontSize: 16 }}>{d.prenom} · {d.port}</T>
              <T>Bateau : <T tresGras>{d.bateau || '—'}</T> · immatriculation <T tresGras>{d.immatriculation || '—'}</T></T>
              <T>Numéro de marin : <T tresGras>{d.numeroMarin || '—'}</T></T>
              <T gris petit>Inscrit le {jour(d.creeLe)} · compte de paiement {d.stripePret ? 'prêt' : 'pas encore ouvert'}</T>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <Bouton titre="Vérifié ✓" desactive={occupe} onPress={() => decider(d, 'verifier')} style={{ flex: 1 }} />
                <Bouton clair titre="Refuser" desactive={occupe} onPress={() => { setMotif(''); setRefus({ etalId: d.etalId, prenom: d.prenom, decision: 'refuser' }); }} style={{ flex: 1 }} />
              </View>
            </View>
          )) : <T gris>Aucun dossier en attente.</T>}

          <T tresGras style={{ fontSize: 18, marginTop: 10 }}>Signalements ({t.signalements.length})</T>
          {t.signalements.length ? t.signalements.map((s) => (
            <View key={s.id} style={{ borderWidth: 1, borderColor: c.ligne, borderRadius: 14, padding: 14, gap: 6 }}>
              <T gris petit>{jour(s.le)}{s.bonCode ? ' · bon ' + s.bonCode : ''}{s.bloquer ? ' · conversation bloquée' : ''}</T>
              <T><T tresGras>{s.par.prenom}</T> ({s.par.role}) signale <T tresGras>{s.contre.prenom}</T> ({s.contre.role})</T>
              <T style={{ fontStyle: 'italic' }}>« {s.motif} »</T>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <Bouton clair titre="Classer" desactive={occupe} onPress={() => signalement(s, 'classer')} style={{ flex: 1 }} />
                <Bouton titre={'Suspendre ' + s.contre.prenom} desactive={occupe} onPress={() => signalement(s, 'suspendre')} style={{ flex: 1, backgroundColor: c.alerte }} />
              </View>
            </View>
          )) : <T gris>Aucun signalement à traiter.</T>}

          <T tresGras style={{ fontSize: 18, marginTop: 10 }}>Derniers avis</T>
          <T gris petit>Retirez seulement un avis insultant ou hors sujet : la note de l’étal est recalculée.</T>
          {t.avis.length ? t.avis.map((a) => (
            <View key={a.code} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.ligne }}>
              <View style={{ flex: 1 }}><T><T tresGras>{a.prenom}</T> · {'★'.repeat(a.note)} · <T gris petit>étal {a.etalId} · {jour(a.le)}</T></T>{a.commentaire ? <T gris>{a.commentaire}</T> : null}</View>
              <Pressable accessibilityRole="button" disabled={occupe} onPress={() => agir(() => B.equipeRetirerAvis(a.code), (x) => ({ ...x, avis: x.avis.filter((y) => y.code !== a.code) }), 'Avis retiré.')}><T gras style={{ color: c.alerte }}>Retirer</T></Pressable>
            </View>
          )) : <T gris>Aucun avis.</T>}

          <T tresGras style={{ fontSize: 18, marginTop: 10 }}>Dernières factures</T>
          {t.factures.length ? t.factures.map((x) => (
            <Pressable key={x.numero} onPress={() => facture(x.numero)} accessibilityRole="button" style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.ligne }}>
              <View style={{ flex: 1 }}><T tresGras>{x.numero}</T><T gris petit>{x.acheteur} · pêcheur {x.vendeur} · {jour(x.emiseLe)}</T></View>
              <T tresGras>{euro(x.totalTtc)}</T>
            </Pressable>
          )) : <T gris>Aucune facture émise.</T>}
          {t.avoirs.length ? <T gras style={{ color: c.alerte }}>{t.avoirs.length} avoir(s) à émettre après remboursement d’un pro (voir l’expert-comptable) : {t.avoirs.map((a) => a.facture + ' (' + euro(a.montant) + ')').join(', ')}</T> : null}

          <T tresGras style={{ fontSize: 18, marginTop: 10 }}>Rembourser un client</T>
          <T gris petit>Après une réclamation (poisson abîmé, erreur de pesée). Le pêcheur rend sa part, la commission est rendue. Laissez le montant vide pour tout rembourser.</T>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput value={remb.code} onChangeText={(v) => setRemb((x) => ({ ...x, code: v }))} placeholder="Bon (R-123)" autoCapitalize="characters" accessibilityLabel="Code du bon" style={[champ, { flex: 1 }]} />
            <TextInput value={remb.montant} onChangeText={(v) => setRemb((x) => ({ ...x, montant: v }))} placeholder="Montant €" keyboardType="decimal-pad" accessibilityLabel="Montant" style={[champ, { width: 110 }]} />
          </View>
          <TextInput value={remb.motif} onChangeText={(v) => setRemb((x) => ({ ...x, motif: v }))} placeholder="Motif (envoyé au pêcheur)" maxLength={200} accessibilityLabel="Motif du remboursement" style={champ} />
          <Bouton clair titre="Rembourser" desactive={!/^R-\d+$/i.test(remb.code.trim()) || !remb.motif.trim() || occupe} onPress={rembourser} />

          <T tresGras style={{ fontSize: 18, marginTop: 10 }}>Déclaration des plateformes (DAC7)</T>
          <T gris petit>Ventes de chaque pêcheur sur l’année, avec l’identité vérifiée par Stripe, à déclarer à la DGFiP avant le 31 janvier et à envoyer à chaque pêcheur.</T>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[new Date().getFullYear() - 1, new Date().getFullYear()].filter((a) => a >= 2026).map((a) => <Chip key={a} titre={'Export ' + a} onPress={() => dac7(a)} />)}
          </View>

          <T gris petit>Gestion avancée (réglages, montants, fermetures d’espèces) : console Firebase. Voir MISE-EN-SERVICE.md.</T>
        </ScrollView>
      )}
      <Feuille visible={!!refus} onFermer={() => setRefus(null)} titre={'Refuser le dossier de ' + (refus?.prenom ?? '')}>
        <T gris style={{ marginBottom: 8 }}>Le motif est envoyé au pêcheur. Il pourra corriger son dossier.</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          {MOTIFS.map((m) => <Chip key={m} titre={m} actif={motif === m} onPress={() => setMotif(m)} />)}
        </View>
        <TextInput value={motif} onChangeText={setMotif} placeholder="Ou écrivez le motif" maxLength={300} accessibilityLabel="Motif du refus"
          style={{ borderWidth: 1, borderColor: c.ligne, borderRadius: 12, padding: 12, fontFamily: f.normal, color: c.texte, marginBottom: 10 }} />
        <Bouton titre="Refuser le dossier" desactive={!motif.trim() || occupe} onPress={() => { const d = t?.dossiers.find((x) => x.etalId === refus?.etalId); if (d && refus) decider(d, refus.decision, motif.trim()); setRefus(null); }} />
      </Feuille>
    </SafeAreaView>
  );
}
