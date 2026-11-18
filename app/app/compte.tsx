import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LiensLegaux } from '../src/components/LiensLegaux';
import { Bouton, Chip, EnTete, Feuille, Ligne, T } from '../src/components/ui';
import { ESPECES } from '../src/data/demo';
import { detailTva, euro } from '../src/format';
import { MODE_DEMO, useApp } from '../src/store';
import { couleurs as c } from '../src/theme';

export default function Compte() {
  const app = useApp();
  const s = app.e.session;
  const [confirmer, setConfirmer] = useState(false);
  const [info, setInfo] = useState('');
  const [occupe, setOccupe] = useState(false);
  const identifiant = s?.email ? s.email : s?.telephone ? 'numéro terminant par ' + s.telephone.slice(-2) : 'compte connecté';

  // Droit d'accès / portabilité : fichier JSON de toutes mes données
  const exporter = async () => {
    setOccupe(true); const d = await app.exporterDonnees(); setOccupe(false);
    if (!d) return;
    const texte = JSON.stringify(d, null, 2);
    if (Platform.OS === 'web') {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([texte], { type: 'application/json' }));
      a.download = 'mes-donnees-peche-connect.json'; a.click();
      setInfo('Fichier « mes-donnees-peche-connect.json » téléchargé.');
    } else {
      await Share.share({ title: 'Mes données Pêche Connect', message: texte });
    }
  };
  const supprimer = async () => {
    setOccupe(true); const ok = await app.supprimerCompte(); setOccupe(false); setConfirmer(false);
    if (ok) router.replace('/connexion');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.fond }}>
      <EnTete titre="Mon compte" fermer />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
        <View style={{ gap: 2 }}>
          <T tresGras style={{ fontSize: 22 }}>{s?.prenom}</T>
          <T gris>{s?.role === 'pecheur' ? 'Pêcheur professionnel' : s?.pro ? 'Client professionnel' : 'Client'} · {identifiant}</T>
        </View>
        {s?.pro ? <View style={{ backgroundColor: c.doux, borderRadius: 12, padding: 12, gap: 2 }}><T tresGras>{s.pro.raison}</T><T gris>{s.pro.type} · SIRET {s.pro.siret} · {s.pro.commune}</T>{s.pro.adresse ? <T gris>Livraison : {s.pro.adresse}</T> : null}</View> : null}
        {MODE_DEMO ? <T gris petit>Mode démo : les données restent sur ce téléphone, aucun paiement réel.</T> : null}
        {s?.pro ? <FacturesDuMois /> : null}

        {s?.role !== 'pecheur' ? (
          <View style={{ gap: 8 }}>
            <T tresGras style={{ fontSize: 16 }}>Alertes d’arrivage</T>
            <T gris petit>Recevez une notification quand un pêcheur débarque ces espèces (appli installée).</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {ESPECES.map((x) => { const oui = app.e.suivis.includes(x); return <Chip key={x} titre={(oui ? '✓ ' : '') + x} actif={oui} onPress={() => app.suivre(x, !oui)} />; })}
            </View>
          </View>
        ) : null}

        <Bouton titre="Me déconnecter" onPress={async () => { await app.deconnecter(); router.replace('/connexion'); }} />
        {MODE_DEMO ? <Bouton clair titre="Recommencer la démo (tout effacer)" onPress={() => { app.reinitialiser(); router.replace('/connexion'); }} /> : null}

        <Ligne style={{ marginVertical: 4 }} />
        <T tresGras style={{ fontSize: 16 }}>Mes données</T>
        <Pressable onPress={exporter} disabled={occupe} style={{ paddingVertical: 10 }}><T gras style={{ textDecorationLine: 'underline' }}>Télécharger mes données</T></Pressable>
        <Pressable onPress={() => setConfirmer(true)} style={{ paddingVertical: 10 }}><T gras style={{ color: c.alerte, textDecorationLine: 'underline' }}>Supprimer mon compte</T></Pressable>
        {info ? <T gris petit>{info}</T> : null}
        <LiensLegaux />
      </ScrollView>
      <Feuille visible={confirmer} onFermer={() => setConfirmer(false)} titre="Supprimer mon compte ?">
        <T style={{ marginBottom: 8 }}>Votre compte, vos messages et vos alertes seront effacés définitivement.</T>
        <T gris petit style={{ marginBottom: 14 }}>Les bons déjà payés sont gardés 10 ans pour la comptabilité, sans votre nom. Une réservation en cours doit d’abord être retirée ou annulée.</T>
        <Bouton titre={occupe ? 'Suppression…' : 'Oui, supprimer définitivement'} desactive={occupe} onPress={supprimer} style={{ backgroundColor: c.alerte }} />
        <Bouton clair titre="Annuler" onPress={() => setConfirmer(false)} style={{ marginTop: 8 }} />
      </Feuille>
    </SafeAreaView>
  );
}

// Relevé mensuel des achats du professionnel (pour sa comptabilité) : bons retirés, HT / TVA / TTC
function FacturesDuMois() {
  const app = useApp();
  const parMois: Record<string, { n: number; ttc: number }> = {};
  const mois = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  app.mesBons().filter((b) => b.statut === 'retire').forEach((b) => {
    const cle = b.date ? new Date(b.date).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : mois; // en démo : ce mois-ci
    const m = parMois[cle] ?? (parMois[cle] = { n: 0, ttc: 0 });
    m.n += 1; m.ttc += b.montantPaye ?? 0;
  });
  const lignes = Object.entries(parMois);
  return (
    <View style={{ gap: 6 }}>
      <T tresGras style={{ fontSize: 16 }}>Relevé mensuel</T>
      {!lignes.length ? <T gris petit>Vos achats retirés apparaîtront ici, avec le total HT, la TVA et le TTC.</T> : lignes.map(([m, v]) => {
        const t = detailTva(Math.round(v.ttc * 100) / 100);
        return (
          <View key={m} style={{ backgroundColor: c.doux, borderRadius: 12, padding: 12, gap: 2 }}>
            <T tresGras>{m.charAt(0).toUpperCase() + m.slice(1)} · {v.n} commande{v.n > 1 ? 's' : ''}</T>
            <T gris>HT {euro(t.ht)} · TVA {euro(t.tva)} · TTC {euro(t.ttc)}</T>
          </View>
        );
      })}
      {app.mesBons().filter((b) => b.facture).map((b) => (
        <Pressable key={b.code} onPress={() => app.ouvrirFacture(b.facture!)} accessibilityRole="button" accessibilityLabel={'Facture ' + b.facture}
          style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderColor: c.ligne }}>
          <T gras>{b.facture}</T><T gris>{euro(b.montantPaye ?? 0)} · PDF</T>
        </Pressable>
      ))}
      <T gris petit>Factures numérotées et gardées 10 ans. Taux de TVA à confirmer avec le comptable.</T>
    </View>
  );
}
