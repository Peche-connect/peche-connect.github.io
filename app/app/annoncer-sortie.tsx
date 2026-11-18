import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { quandRetour } from '../src/components/Sorties';
import { Bouton, Chip, EnTete, Feuille, T } from '../src/components/ui';
import { ESPECES } from '../src/data/demo';
import { euro, kg } from '../src/format';
import { useApp } from '../src/store';
import { couleurs as c } from '../src/theme';
import type { EspeceSortie } from '../src/types';

const HEURES = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

// Petit réglage − valeur +
function Regle({ valeur, onMoins, onPlus, label }: { valeur: string; onMoins: () => void; onPlus: () => void; label: string }) {
  const b = { width: 34, height: 34, borderRadius: 8, backgroundColor: c.doux, alignItems: 'center', justifyContent: 'center' } as const;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Pressable accessibilityLabel={'Baisser ' + label} onPress={onMoins} style={b}><T tresGras>−</T></Pressable>
      <T tresGras style={{ minWidth: 72, textAlign: 'center' }}>{valeur}</T>
      <Pressable accessibilityLabel={'Monter ' + label} onPress={onPlus} style={b}><T tresGras>+</T></Pressable>
    </View>
  );
}

// Pêcheur : annoncer sa sortie pour que les clients réservent avant son retour
export default function AnnoncerSortie() {
  const app = useApp();
  const etalId = app.e.session?.etalId;
  const e = app.etal(etalId ?? '');
  const s = app.sortie(etalId);
  const pre = app.precommandesEtal(etalId).filter((p) => p.statut === 'en_attente');
  const [jour, setJour] = useState<0 | 1>(1);
  const [h, setH] = useState(11);
  const [especes, setEspeces] = useState<EspeceSortie[]>([]);
  const [ajout, setAjout] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [modifier, setModifier] = useState(!s);
  useEffect(() => {
    if (s) { setEspeces(s.especes.map((x) => ({ ...x }))); const d = new Date(s.retour); setH(d.getHours()); setJour(d.toDateString() === new Date().toDateString() ? 0 : 1); }
    else if (e && !especes.length) setEspeces([...new Set(e.produits.map((p) => p.espece))].slice(0, 3).map((esp) => ({ espece: esp, prixKg: e.produits.find((p) => p.espece === esp && p.prixKg)?.prixKg || 12, kgMax: 10 })));
  }, [s?.retour, e?.id]);
  const retour = () => { const d = new Date(); d.setDate(d.getDate() + jour); d.setHours(h, 0, 0, 0); return d; };
  const passe = retour().getTime() < Date.now() + 30 * 60_000;
  const maj = (i: number, f: (x: EspeceSortie) => EspeceSortie) => setEspeces((l) => l.map((x, j) => (j === i ? f(x) : x)));
  const total = (esp: string) => pre.filter((p) => p.espece === esp).reduce((t, p) => t + p.kg, 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.fond }}>
      <EnTete titre="Annoncer ma sortie" sousTitre="Les clients réservent avant votre retour" fermer />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
        {s && !modifier ? (
          <>
            <View style={{ backgroundColor: c.doux, borderRadius: 12, padding: 12, gap: 4 }}>
              <T tresGras style={{ fontSize: 16 }}>Sortie annoncée · retour {quandRetour(s.retour).toLowerCase()}</T>
              <T gris>À votre retour, publiez votre arrivage : chaque réservation devient un bon à payer dans l’heure, dans l’ordre d’arrivée.</T>
            </View>
            <T tresGras style={{ fontSize: 17 }}>Déjà réservé</T>
            {s.especes.map((x) => <T key={x.espece}>{x.espece} : <T tresGras>{kg(Math.round(total(x.espece) * 10) / 10)}</T> sur {kg(x.kgMax)} · ~{euro(x.prixKg)}/kg</T>)}
            {pre.length ? pre.map((p) => <T key={p.id} gris>{p.clientPrenom} · {p.espece} {kg(p.kg)}</T>) : <T gris>Pas encore de réservation.</T>}
            <Bouton titre="Je suis rentré : publier mon arrivage" onPress={() => router.replace('/(pecheur)/arrivage')} />
            <Bouton clair titre="Modifier la sortie" onPress={() => setModifier(true)} />
            <Bouton clair titre="Annuler la sortie (mauvais temps, panne…)" onPress={async () => { await app.annulerSortie('sortie annulée'); router.back(); }} />
          </>
        ) : (
          <>
            <T tresGras style={{ fontSize: 17 }}>Retour prévu</T>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Chip titre="Aujourd’hui" actif={jour === 0} onPress={() => setJour(0)} />
              <Chip titre="Demain" actif={jour === 1} onPress={() => setJour(1)} />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {HEURES.map((x) => <Chip key={x} titre={'vers ' + x + ' h'} actif={h === x} onPress={() => setH(x)} />)}
            </View>
            {passe ? <T gras style={{ color: c.alerte }}>Choisissez une heure de retour à venir.</T> : null}
            <T tresGras style={{ fontSize: 17, marginTop: 6 }}>Ce que vous pensez ramener</T>
            <T gris petit>Prix annoncé (confirmé à l’arrivée) et quantité que vous acceptez de réserver.</T>
            {especes.map((x, i) => (
              <View key={x.espece} style={{ borderWidth: 1, borderColor: c.ligne, borderRadius: 14, padding: 12, gap: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <T tresGras style={{ fontSize: 16 }}>{x.espece}</T>
                  <Pressable onPress={() => setEspeces((l) => l.filter((_, j) => j !== i))} accessibilityLabel={'Retirer ' + x.espece}><T gris>Retirer</T></Pressable>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><T gris>Prix au kilo</T>
                  <Regle label="le prix" valeur={euro(x.prixKg)} onMoins={() => maj(i, (y) => ({ ...y, prixKg: Math.max(1, y.prixKg - 0.5) }))} onPlus={() => maj(i, (y) => ({ ...y, prixKg: y.prixKg + 0.5 }))} /></View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><T gris>À réserver, au plus</T>
                  <Regle label="la quantité" valeur={kg(x.kgMax)} onMoins={() => maj(i, (y) => ({ ...y, kgMax: Math.max(1, y.kgMax - 1) }))} onPlus={() => maj(i, (y) => ({ ...y, kgMax: y.kgMax + 1 }))} /></View>
              </View>
            ))}
            {especes.length < 8 ? <Pressable onPress={() => setAjout(true)} style={{ paddingVertical: 8 }}><T tresGras style={{ color: c.marine }}>+ Ajouter une espèce</T></Pressable> : null}
            <View style={{ backgroundColor: c.doux, borderRadius: 12, padding: 12 }}>
              <T gris>Ne réservez pas plus que ce que vous ramenez d’habitude : au retour, les premiers inscrits sont servis d’abord, les autres sont prévenus sans rien payer.</T>
            </View>
            <Bouton titre={s ? 'Enregistrer' : 'Annoncer ma sortie'} desactive={!especes.length || passe || envoi}
              onPress={async () => { setEnvoi(true); const ok = await app.annoncerSortie(retour().toISOString(), especes); setEnvoi(false); if (ok) setModifier(false); }} />
          </>
        )}
      </ScrollView>
      <Feuille visible={ajout} onFermer={() => setAjout(false)} titre="Quelle espèce ?">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {ESPECES.filter((x) => !especes.some((y) => y.espece === x)).map((x) => <Chip key={x} titre={x} onPress={() => { setEspeces((l) => [...l, { espece: x, prixKg: 12, kgMax: 10 }]); setAjout(false); }} />)}
        </View>
      </Feuille>
    </SafeAreaView>
  );
}
