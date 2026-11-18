import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { CarteIle } from '../../src/components/CarteIle';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Chip, Logo, Prix, T } from '../../src/components/ui';
import { FILTRES, PORTS } from '../../src/data/demo';
import { distanceKm, euro, heure } from '../../src/format';
import { disponible } from '../../src/formats';
import { useApp } from '../../src/store';
import { couleurs as c } from '../../src/theme';


export default function Carte() {
  const app = useApp();
  const [filtre, setFiltre] = useState('Tout');
  const [port, setPort] = useState(app.e.commune);

  const garde = (portNom: string) => app.e.etals.filter((e) => e.port === portNom && e.produits.length > 0 && (
    filtre === 'Tout' ? true : filtre === 'Moins d’1 h' ? app.frais(e) : e.produits.some((p) => p.espece.startsWith(filtre) && disponible(p))));
  const etalsPort = garde(port);


  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.fond }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Logo />
          <View><T gris petit>Arrivages du jour</T><T tresGras style={{ fontSize: 17 }}>Martinique</T></View>
        </View>
        <View style={st.bascule}>
          <Pressable onPress={() => router.navigate('/(client)')} style={st.basc}><T gras gris>Liste</T></Pressable>
          <View style={[st.basc, { backgroundColor: c.marine }]}><T gras style={{ color: '#fff' }}>Carte</T></View>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 12 }} style={{ flexGrow: 0, flexShrink: 0, minHeight: 62 }}>
        {FILTRES.map((x) => <Chip key={x} titre={x} actif={filtre === x} onPress={() => setFiltre(x)} />)}
      </ScrollView>

      <CarteIle infos={Object.fromEntries(Object.keys(PORTS).flatMap((n) => { const es = garde(n); return es.length ? [[n, { nb: es.length, frais: es.some(app.frais) }]] : []; }))}
        choisi={port} onChoisir={setPort} />

      <View style={st.volet}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
          <T tresGras style={{ fontSize: 17 }}>{port} · {etalsPort.length} étal{etalsPort.length > 1 ? 's' : ''}</T>
          <T gras gris petit>{distanceKm(PORTS[app.e.commune], PORTS[port])} km</T>
        </View>
        {etalsPort.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {etalsPort.map((e) => (
              <Pressable key={e.id} onPress={() => router.push({ pathname: '/etal/[id]', params: { id: e.id } })} style={[st.mini, { width: etalsPort.length > 1 ? 270 : 340 }]}>
                <T tresGras>Étal de {e.pecheur} · {e.avis ? String(e.note).replace('.', ',') + ' ★' : 'Nouveau'}</T>
                <T gris petit numberOfLines={1}>{e.produits.map((p) => p.espece).join(', ')}</T>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  {app.minPrix(e) !== null ? <Prix texte={'dès ' + euro(app.minPrix(e)!) + '/kg'} /> : <View />}
                  <T gris petit>Débarqué {heure(e.debarque)}</T>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        ) : <T gris>{PORTS[port]?.type ?? 'Port'} · {app.e.etals.some((e) => e.port === port) ? 'aucun étal ne correspond au filtre ici.' : 'aucun arrivage publié pour l’instant.'} Touchez un autre repère.</T>}
      </View>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  bascule: { flexDirection: 'row', backgroundColor: c.doux, borderRadius: 999, padding: 3 },
  basc: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  volet: { backgroundColor: c.fond, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingTop: 14, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 12, elevation: 6 },
  mini: { borderWidth: 1, borderColor: c.ligne, borderRadius: 14, padding: 12, gap: 6 },
});
