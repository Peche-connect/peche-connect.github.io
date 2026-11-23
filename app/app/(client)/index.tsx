import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CarteEtal } from '../../src/components/CarteEtal';
import { SortiesAnnoncees } from '../../src/components/Sorties';
import { IcCompte, IcLoupe } from '../../src/components/icones';
import { Chip, Feuille, Logo, Rond, T, Vide } from '../../src/components/ui';
import { FILTRES, PORTS } from '../../src/data/demo';
import { disponible } from '../../src/formats';
import { useApp } from '../../src/store';
import { couleurs as c, polices as f } from '../../src/theme';

export default function Accueil() {
  const app = useApp();
  const [filtre, setFiltre] = useState('Tout');
  const [q, setQ] = useState('');
  const [choixCommune, setChoixCommune] = useState(false);

  const liste = useMemo(() => app.e.etals.filter((e) => {
    if (filtre === 'Moins d’1 h' && !app.frais(e)) return false;
    if (filtre !== 'Tout' && filtre !== 'Moins d’1 h' && !e.produits.some((p) => p.espece.startsWith(filtre) && disponible(p))) return false;
    const t = q.trim().toLowerCase();
    if (t && !(e.pecheur + ' ' + e.port + ' ' + e.produits.map((p) => p.espece).join(' ')).toLowerCase().includes(t)) return false;
    return e.produits.length > 0;
  }).sort((a, b) => app.km(a) - app.km(b)), [app, filtre, q]);
  const recents = liste.filter(app.frais);
  const favoris = app.e.etals.filter((x) => app.e.favoris.includes(x.id));

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.fond }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 10, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Logo />
            <Pressable accessibilityRole="button" onPress={() => setChoixCommune(true)}>
              <T gris petit>Retrait près de</T>
              <T tresGras style={{ fontSize: 17 }}>{app.e.commune} ▾</T>
            </Pressable>
          </View>
          {app.e.session ? <Rond label="Mon compte" onPress={() => router.push('/compte')}><IcCompte /></Rond>
            : <Pressable accessibilityRole="button" onPress={() => router.push('/connexion')} style={{ backgroundColor: c.doux, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 9 }}><T tresGras style={{ fontSize: 13 }}>Se connecter</T></Pressable>}
        </View>
        <View style={st.recherche}>
          <IcLoupe couleur={c.gris} taille={18} />
          <TextInput value={q} onChangeText={setQ} placeholder="Thon, vivaneau, un port…" placeholderTextColor={c.grisClair} style={st.champ} accessibilityLabel="Rechercher" />
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 12 }} style={{ flexGrow: 0, flexShrink: 0, minHeight: 62 }}>
        {FILTRES.map((x) => <Chip key={x} titre={x} actif={filtre === x} onPress={() => setFiltre(x)} />)}
      </ScrollView>
      <ScrollView contentContainerStyle={{ paddingBottom: 24, gap: 20 }}>
        {filtre === 'Tout' && !q ? (
          <View style={st.bandeau}>
            <View style={{ width: '58%', gap: 6 }}>
              <T tresGras style={{ color: c.marine, fontSize: 19, lineHeight: 23 }}>Le poisson du jour, en direct des pêcheurs</T>
              <T gras style={{ color: c.texte }}>{liste.length} étals ouverts ce matin</T>
            </View>
            <Image source={require('../../assets/personnage/poisson-fier.png')} style={st.perso} resizeMode="contain" accessibilityLabel="Le pêcheur montre fièrement un vivaneau" />
          </View>
        ) : null}
        {!liste.length ? (
          <Vide titre="Aucun étal ne correspond" texte="Essayez un autre poisson ou effacez la recherche." action="Tout afficher" onAction={() => { setFiltre('Tout'); setQ(''); }} />
        ) : (
          <>
            {filtre === 'Tout' && !q && favoris.length ? (
              <View style={{ gap: 10 }}>
                <T tresGras style={st.h2}>Mes pêcheurs</T>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: 16 }}>
                  {favoris.map((e) => <CarteEtal key={e.id} etal={e} />)}
                </ScrollView>
              </View>
            ) : null}
            {filtre === 'Tout' && !q ? <SortiesAnnoncees titre={st.h2} /> : null}
            {recents.length > 0 && filtre !== 'Moins d’1 h' ? (
              <View style={{ gap: 10 }}>
                <T tresGras style={st.h2}>Arrivé il y a moins d’une heure</T>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: 16 }}>
                  {recents.map((e) => <CarteEtal key={e.id} etal={e} />)}
                </ScrollView>
              </View>
            ) : null}
            <View style={{ gap: 10 }}>
              <T tresGras style={st.h2}>{filtre === 'Tout' && !q ? 'Tous les étals du jour' : liste.length + ' étal' + (liste.length > 1 ? 's' : '') + ' trouvé' + (liste.length > 1 ? 's' : '')}</T>
              <View style={{ paddingHorizontal: 16, gap: 18 }}>{liste.map((e) => <CarteEtal key={e.id} etal={e} large />)}</View>
            </View>
          </>
        )}
      </ScrollView>
      <Feuille visible={choixCommune} onFermer={() => setChoixCommune(false)} titre="Retrait près de…">
        {Object.keys(PORTS).map((p) => (
          <Pressable key={p} onPress={() => { app.choisirCommune(p); setChoixCommune(false); }} style={st.option}>
            <T tresGras style={{ flex: 1 }}>{p}</T>{app.e.commune === p ? <T tresGras>✓</T> : null}
          </Pressable>
        ))}
      </Feuille>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  bandeau: { marginHorizontal: 16, height: 160, borderRadius: 16, paddingLeft: 18, justifyContent: 'center', overflow: 'hidden', backgroundColor: c.doux },
  perso: { position: 'absolute', right: 8, bottom: -4, width: 128, height: 160 },
  recherche: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.doux, borderRadius: 999, paddingHorizontal: 16, height: 46 },
  champ: { flex: 1, fontSize: 16, fontFamily: f.normal, color: c.texte, height: 46 },
  h2: { fontSize: 19, paddingHorizontal: 16 },
  option: { flexDirection: 'row', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.ligne },
});
