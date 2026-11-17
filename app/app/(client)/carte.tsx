import { router } from 'expo-router';
import { useState } from 'react';
import { Image, LayoutChangeEvent, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Chip, Logo, Prix, T } from '../../src/components/ui';
import { FILTRES, PORTS } from '../../src/data/demo';
import { distanceKm, euro, heure } from '../../src/format';
import { useApp } from '../../src/store';
import { couleurs as c } from '../../src/theme';

// Fond : carte OpenStreetMap (© contributeurs OpenStreetMap), calée sur le tracé réel de l'île.
// Dans la version installée sur téléphone, elle sera remplacée par une carte vivante (react-native-maps).
const W = 1055, H = 1280;
const xy = (lat: number, lon: number) => [(136108.0 + 2222.2 * lon) / W, (34232.374 - 2295.661 * lat) / H];

export default function Carte() {
  const app = useApp();
  const [filtre, setFiltre] = useState('Tout');
  const [port, setPort] = useState(app.e.commune);
  const [taille, setTaille] = useState({ w: 0, h: 0 });

  const garde = (portNom: string) => app.e.etals.filter((e) => e.port === portNom && e.produits.length > 0 && (
    filtre === 'Tout' ? true : filtre === 'Moins d’1 h' ? app.frais(e) : e.produits.some((p) => p.espece.startsWith(filtre) && p.dispoKg > 0)));
  const etalsPort = garde(port);

  const auLayout = (ev: LayoutChangeEvent) => {
    const { width, height } = ev.nativeEvent.layout;
    const h = Math.min(height, (width * H) / W);
    setTaille({ w: (h * W) / H, h });
  };

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

      <View style={{ flex: 1, backgroundColor: '#e9eff1', alignItems: 'center', justifyContent: 'center' }} onLayout={auLayout}>
        {taille.w > 0 ? (
          <View style={{ width: taille.w, height: taille.h }}>
            <Image source={require('../../assets/carte-martinique.png')} style={{ width: taille.w, height: taille.h }} resizeMode="stretch" accessibilityLabel="Carte de la Martinique" />
            {Object.keys(PORTS).filter((nom) => !garde(nom).length).map((nom, _i, vides) => {
              const [px, py] = xy(PORTS[nom].lat, PORTS[nom].lon); const choisi = nom === port;
              // pas de nom si une étiquette d'arrivage est juste à côté (évite les chevauchements)
              const t = PORTS[nom].type === 'Port territorial' ? 16 : 12;
              const aDroite = px < 0.55;
              const X = px * taille.w, Y = py * taille.h, larg = nom.length * 5.6 + 10;
              const nx0 = aDroite ? X + t / 2 : X - t / 2 - larg, nx1 = nx0 + larg;
              const gene = Object.keys(PORTS).some((o) => {
                if (!garde(o).length) return false;
                const [ox, oy] = xy(PORTS[o].lat, PORTS[o].lon); const OX = ox * taille.w, OY = oy * taille.h;
                return nx0 < OX + 34 && nx1 > OX - 34 && Y - 8 < OY - 6 && Y + 8 > OY - 32;
              });
              return (
                <Pressable key={nom} accessibilityLabel={nom + ', ' + PORTS[nom].type.toLowerCase() + ', aucun arrivage'} onPress={() => setPort(nom)} hitSlop={8}
                  style={{ position: 'absolute', left: px * taille.w - (aDroite ? t / 2 : 110 - t / 2), top: py * taille.h - t / 2, width: 110, flexDirection: aDroite ? 'row' : 'row-reverse', alignItems: 'center', gap: 3 }}>
                  <View style={{ width: t, height: t, borderRadius: t / 2, backgroundColor: c.marine, borderWidth: 3, borderColor: choisi ? '#ffd23f' : '#fff', shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 }} />
                  {gene && !choisi ? null : <View style={st.nomPort}><T gras style={{ fontSize: 9.5, color: c.marine }} numberOfLines={1}>{nom}</T></View>}
                </Pressable>
              );
            })}
            {Object.keys(PORTS).map((nom) => {
              const es = garde(nom); if (!es.length) return null;
              const [px, py] = xy(PORTS[nom].lat, PORTS[nom].lon);
              const frais = es.some(app.frais), choisi = nom === port;
              return (
                <Pressable key={nom} accessibilityLabel={nom + ', ' + es.length + ' étals'} onPress={() => setPort(nom)}
                  style={{ position: 'absolute', left: px * taille.w - 40, top: py * taille.h - 30, width: 80, alignItems: 'center' }}>
                  <View style={[st.repere, frais ? { backgroundColor: c.accent } : { backgroundColor: c.texte }, choisi && st.choisi]}>
                    <T tresGras style={{ fontSize: 11, color: frais ? c.surAccent : '#fff' }}>{nom === 'Fort-de-France' ? 'Marché · ' + es.length : es.length + ' étal' + (es.length > 1 ? 's' : '')}</T>
                  </View>
                  <View style={{ width: 2, height: 6, backgroundColor: frais ? c.accent : c.texte }} />
                </Pressable>
              );
            })}
            <View style={st.osm}><T gris style={{ fontSize: 10 }}>© Contributeurs OpenStreetMap</T></View>
            <View style={st.legende}>
              <View style={st.ligneLeg}><View style={[st.pt, { width: 14, height: 14, borderRadius: 7 }]} /><T style={st.txtLeg}>Port territorial</T></View>
              <View style={st.ligneLeg}><View style={[st.pt, { width: 10, height: 10, borderRadius: 5, marginHorizontal: 2 }]} /><T style={st.txtLeg}>Abri de pêche (APIT)</T></View>
              <View style={st.ligneLeg}><View style={[st.repere, { backgroundColor: c.texte }]}><T tresGras style={{ fontSize: 9, color: '#fff' }}>1 étal</T></View><T style={st.txtLeg}>Arrivage du jour</T></View>
            </View>
          </View>
        ) : null}
      </View>

      <View style={st.volet}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
          <T tresGras style={{ fontSize: 17 }}>{port} · {etalsPort.length} étal{etalsPort.length > 1 ? 's' : ''}</T>
          <T gras gris petit>{distanceKm(PORTS[app.e.commune], PORTS[port])} km</T>
        </View>
        {etalsPort.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {etalsPort.map((e) => (
              <Pressable key={e.id} onPress={() => router.push({ pathname: '/etal/[id]', params: { id: e.id } })} style={[st.mini, { width: etalsPort.length > 1 ? 270 : 340 }]}>
                <T tresGras>Étal de {e.pecheur} · {String(e.note).replace('.', ',')} ★</T>
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
  repere: { borderRadius: 7, paddingHorizontal: 6, paddingVertical: 3 },
  choisi: { borderWidth: 2, borderColor: '#fff', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 3 },
  nomPort: { backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 5, paddingHorizontal: 4, paddingVertical: 1, maxWidth: 92 },
  legende: { position: 'absolute', left: 6, bottom: 6, backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: 10, padding: 8, gap: 5 },
  ligneLeg: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pt: { backgroundColor: c.marine, borderWidth: 2, borderColor: '#fff' },
  txtLeg: { fontSize: 11 },
  osm: { position: 'absolute', right: 6, top: 6, backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  volet: { backgroundColor: c.fond, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingTop: 14, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 12, elevation: 6 },
  mini: { borderWidth: 1, borderColor: c.ligne, borderRadius: 14, padding: 12, gap: 6 },
});
