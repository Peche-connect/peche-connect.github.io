import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { T } from '../../src/components/ui';
import { euro } from '../../src/format';
import * as B from '../../src/services/backend';
import { MODE_DEMO, useApp } from '../../src/store';
import { couleurs as c } from '../../src/theme';

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const jour = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '');

// Démo : exemple chiffré, pour montrer l'écran (en vrai : calculé par le serveur)
const EXEMPLE: B.MesVentes = {
  semaine: { nombre: 14, montant: 412.6, commissions: 20.63 }, mois: { nombre: 51, montant: 1488.2, commissions: 74.41 }, annee: { nombre: 51, montant: 1488.2, commissions: 74.41 },
  parMois: [{ mois: '11', montant: 1488.2 }],
  dernieres: [{ code: 'R-41', client: 'Sophie', montant: 38.5, commission: 1.93, rembourse: 0, le: new Date().toISOString() }, { code: 'R-39', client: 'Le Comptoir du Port', montant: 126, commission: 6.3, rembourse: 0, le: new Date().toISOString() }],
  soldeDisponible: 0, soldeEnAttente: 164.5, virements: [{ montant: 248.1, date: new Date(Date.now() - 86400_000).toISOString(), statut: 'paid' }],
};

function Case({ titre, p }: { titre: string; p: B.Periode }) {
  return (
    <View style={{ flex: 1, backgroundColor: c.doux, borderRadius: 14, padding: 12, gap: 2 }}>
      <T gris petit>{titre}</T>
      <T tresGras style={{ fontSize: 22 }}>{euro(p.montant)}</T>
      <T gris petit>{p.nombre} vente{p.nombre > 1 ? 's' : ''}</T>
    </View>
  );
}

// Pêcheur : ce que l'appli lui rapporte (ventes, commission prélevée, virements reçus)
export default function MesVentes() {
  const app = useApp();
  const [v, setV] = useState<B.MesVentes | null>(MODE_DEMO ? null : null);
  const [erreur, setErreur] = useState('');
  const [charge, setCharge] = useState(false);
  const charger = useCallback(async () => {
    setCharge(true);
    if (MODE_DEMO) {
      // démo : ventes retirées sur l'étal du téléphone, sinon l'exemple
      const bons = app.bonsPecheur(app.e.session?.etalId).filter((b) => b.statut === 'retire');
      if (!bons.length) setV(EXEMPLE);
      else {
        const montant = Math.round(bons.reduce((s, b) => s + (b.montantPaye ?? 0), 0) * 100) / 100, p = { nombre: bons.length, montant, commissions: 0 };
        setV({ ...EXEMPLE, semaine: p, mois: p, annee: p, parMois: [{ mois: String(new Date().getMonth() + 1).padStart(2, '0'), montant }],
          dernieres: bons.slice(-15).reverse().map((b) => ({ code: b.code, client: b.client ?? '', montant: b.montantPaye ?? 0, commission: 0, rembourse: b.rembourse ?? 0, le: null })), soldeEnAttente: montant, virements: [] });
      }
    } else {
      try { setV(await B.mesVentes()); setErreur(''); } catch (e) { setErreur((e as Error).message); }
    }
    setCharge(false);
  }, []);
  useEffect(() => { charger(); }, [charger]);
  const max = Math.max(1, ...(v?.parMois ?? []).map((m) => m.montant));
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.fond }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={charge} onRefresh={charger} />}>
        <T tresGras style={{ fontSize: 24 }}>Mes ventes</T>
        {MODE_DEMO && v === EXEMPLE ? <T gris petit>Démo : exemple de chiffres. Avec l’appli branchée, ce sont vos vraies ventes.</T> : null}
        {erreur ? <T style={{ color: c.alerte }}>{erreur}</T> : null}
        {v ? (
          <>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Case titre="7 derniers jours" p={v.semaine} />
              <Case titre="Ce mois-ci" p={v.mois} />
            </View>
            <View style={{ borderWidth: 1, borderColor: c.ligne, borderRadius: 14, padding: 14, gap: 6 }}>
              <T tresGras>Depuis le début de l’année</T>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T gris>Ventes encaissées</T><T tresGras>{euro(v.annee.montant)}</T></View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T gris>Commission et frais de service</T><T>− {euro(v.annee.commissions)}</T></View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T tresGras>Pour vous</T><T tresGras style={{ color: c.vert }}>{euro(Math.round((v.annee.montant - v.annee.commissions) * 100) / 100)}</T></View>
              {v.parMois.length > 1 ? (
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 90, marginTop: 8 }}>
                  {v.parMois.map((m) => (
                    <View key={m.mois} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                      <View style={{ width: '70%', height: Math.max(4, (m.montant / max) * 64), backgroundColor: c.marine, borderRadius: 4 }} />
                      <T gris style={{ fontSize: 11 }}>{MOIS[Number(m.mois) - 1]}</T>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
            <View style={{ borderWidth: 1, borderColor: c.ligne, borderRadius: 14, padding: 14, gap: 6 }}>
              <T tresGras>Votre argent</T>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T gris>En route vers votre banque</T><T tresGras>{euro(v.soldeEnAttente + v.soldeDisponible)}</T></View>
              <T gris petit>Stripe vire automatiquement l’argent de vos ventes sur votre compte bancaire.</T>
              {v.virements.length ? v.virements.map((x, i) => (
                <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <T>Virement du {jour(x.date)}</T>
                  <T tresGras style={{ color: x.statut === 'failed' ? c.alerte : c.texte }}>{euro(x.montant)}{x.statut === 'failed' ? ' · refusé' : x.statut === 'paid' ? '' : ' · en cours'}</T>
                </View>
              )) : <T gris>Pas encore de virement.</T>}
            </View>
            <T tresGras style={{ fontSize: 17 }}>Dernières ventes</T>
            {v.dernieres.length ? v.dernieres.map((d) => (
              <View key={d.code} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.ligne }}>
                <View><T tresGras>{d.client || 'Client'}</T><T gris petit>{d.code}{d.le ? ' · ' + jour(d.le) : ''}{d.rembourse ? ' · remboursé ' + euro(d.rembourse) : ''}</T></View>
                <T tresGras>{euro(d.montant)}</T>
              </View>
            )) : <T gris>Aucune vente pour l’instant.</T>}
          </>
        ) : <T gris>Chargement…</T>}
      </ScrollView>
    </SafeAreaView>
  );
}
