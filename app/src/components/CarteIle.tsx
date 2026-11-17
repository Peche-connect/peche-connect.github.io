import { useMemo, useRef, useState } from 'react';
import { Image, LayoutChangeEvent, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { PORTS } from '../data/demo';
import { couleurs as c, polices as f } from '../theme';
import { T } from './ui';

// Carte maison de la Martinique (silhouette tirée du trait de côte OpenStreetMap, © contributeurs OSM).
// Repère du fond : image de 1055 × 1280 unités (fichier en double résolution), même projection que l'ancienne carte.
const W = 1055, H = 1280;
const ILE = { x0: 46, x1: 976, y0: 77, y1: 1194 }; // cadre de l'île dans ce repère
const proj = (lat: number, lon: number) => [136108.0 + 2222.2 * lon, 34232.374 - 2295.661 * lat];
const ZOOM_MAX = 4, NOMS_DES = 1.7; // les noms de tous les ports apparaissent à partir de ce zoom

export type InfoPort = { nb: number; frais: boolean };

export function CarteIle({ infos, choisi, onChoisir }: { infos: Record<string, InfoPort>; choisi: string; onChoisir: (port: string) => void }) {
  const [t, setT] = useState({ w: 0, h: 0 });
  const [vue, setVue] = useState({ z: 1, dx: 0, dy: 0 });
  const vueRef = useRef(vue); vueRef.current = vue;
  const tRef = useRef(t); tRef.current = t;

  // échelle de base : toute l'île visible avec une marge
  const base = (w: number, h: number) => {
    const haut = 34, bas = 58; // place pour l'étiquette de Grand-Rivière et pour la légende
    const s = Math.min((w - 24) / (ILE.x1 - ILE.x0), (h - haut - bas) / (ILE.y1 - ILE.y0));
    return { s, ox: (w - (ILE.x1 - ILE.x0) * s) / 2 - ILE.x0 * s + 14, oy: haut + (h - haut - bas - (ILE.y1 - ILE.y0) * s) / 2 - ILE.y0 * s };
  };
  const borne = (v: { z: number; dx: number; dy: number }) => {
    const { w, h } = tRef.current; const z = Math.min(ZOOM_MAX, Math.max(1, v.z));
    const mx = (w * (z - 1)) / 2 + w * 0.25 * (z - 1) / z, my = (h * (z - 1)) / 2 + h * 0.25 * (z - 1) / z;
    return { z, dx: Math.max(-mx, Math.min(mx, v.dx)), dy: Math.max(-my, Math.min(my, v.dy)) };
  };
  // zoom autour d'un point de l'écran (px, py)
  const zoomer = (facteur: number, px?: number, py?: number) => {
    const { w, h } = tRef.current; const v = vueRef.current;
    const cx = px ?? w / 2, cy = py ?? h / 2;
    const z = Math.min(ZOOM_MAX, Math.max(1, v.z * facteur)); const k = z / v.z;
    // le point (cx, cy) reste sous le doigt : écran = centre + d + (base - centre) * z
    setVue(borne({ z, dx: cx - w / 2 - (cx - w / 2 - v.dx) * k, dy: cy - h / 2 - (cy - h / 2 - v.dy) * k }));
  };

  const geste = useRef({ d0: 0, z0: 1, x0: 0, y0: 0, dx0: 0, dy0: 0, mx: 0, my: 0 });
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) + Math.abs(g.dy) > 6 || g.numberActiveTouches === 2,
    onPanResponderGrant: (e) => { const v = vueRef.current; geste.current = { d0: 0, z0: v.z, x0: 0, y0: 0, dx0: v.dx, dy0: v.dy, mx: 0, my: 0 }; },
    onPanResponderMove: (e, g) => {
      const tt = e.nativeEvent.touches; const G = geste.current;
      if (tt && tt.length >= 2) {
        const d = Math.hypot(tt[0].pageX - tt[1].pageX, tt[0].pageY - tt[1].pageY);
        const mx = (tt[0].locationX + tt[1].locationX) / 2, my = (tt[0].locationY + tt[1].locationY) / 2;
        if (!G.d0) { G.d0 = d; G.z0 = vueRef.current.z; G.dx0 = vueRef.current.dx; G.dy0 = vueRef.current.dy; G.mx = mx; G.my = my; return; }
        const { w, h } = tRef.current; const z = Math.min(ZOOM_MAX, Math.max(1, G.z0 * (d / G.d0))); const k = z / G.z0;
        setVue(borne({ z, dx: G.mx - w / 2 - (G.mx - w / 2 - G.dx0) * k, dy: G.my - h / 2 - (G.my - h / 2 - G.dy0) * k }));
      } else if (!G.d0) {
        setVue(borne({ z: vueRef.current.z, dx: G.dx0 + g.dx, dy: G.dy0 + g.dy }));
      }
    },
  }), []);

  const auLayout = (e: LayoutChangeEvent) => setT({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  if (!t.w) return <View style={{ flex: 1, backgroundColor: MER }} onLayout={auLayout} />;

  const b = base(t.w, t.h); const s = b.s * vue.z;
  // position écran d'un point du repère
  const ecran = (X: number, Y: number) => [t.w / 2 + vue.dx + (b.ox + X * b.s - t.w / 2) * vue.z, t.h / 2 + vue.dy + (b.oy + Y * b.s - t.h / 2) * vue.z];
  const [fx, fy] = ecran(0, 0);
  const noms = vue.z >= NOMS_DES;

  return (
    <View style={{ flex: 1, backgroundColor: MER, overflow: 'hidden' }} onLayout={auLayout} {...pan.panHandlers}>
      <Image source={require('../../assets/carte-ile.png')} style={{ position: 'absolute', left: fx, top: fy, width: W * s, height: H * s }} accessibilityLabel="Carte de la Martinique" />
      {Object.entries(PORTS).map(([nom, p]) => {
        const [x, y] = ecran(...(proj(p.lat, p.lon) as [number, number]));
        const gros = p.type === 'Port territorial' || p.type === 'Marché';
        const r = (gros ? 13 : 9) * Math.min(1.4, 0.9 + vue.z * 0.12);
        const info = infos[nom];
        const ecart = r / 2 + 5;
        const txt = info ? `${nom === 'Fort-de-France' ? 'Fort-de-France (marché)' : nom} · ${info.nb}` : nom;
        const largeur = txt.length * (info ? 6.6 : 6.1) + (info ? 20 : 4);
        const place = p.cote === 'd' ? { left: x + ecart, top: y - 11 }
          : p.cote === 'g' ? { left: x - ecart - largeur, top: y - 11 }
          : p.cote === 'h' ? { left: x - largeur / 2, top: y - ecart - 22 }
          : p.cote === 'bg' ? { left: x - largeur - 2, top: y + ecart - 2 }
          : { left: x - largeur / 2, top: y + ecart };
        return (
          <View key={nom} pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            <Pressable accessibilityLabel={nom + (info ? ', ' + info.nb + ' étal' + (info.nb > 1 ? 's' : '') : ', aucun arrivage')} onPress={() => onChoisir(nom)} hitSlop={10}
              style={[st.point, { left: x - r / 2, top: y - r / 2, width: r, height: r, borderRadius: r / 2 }, nom === choisi && st.pointChoisi]} />
            {info ? (
              <Pressable onPress={() => onChoisir(nom)} style={[st.etiquette, place, { width: largeur }, info.frais ? st.frais : st.normale, nom === choisi && st.etiquetteChoisie]}>
                <T tresGras numberOfLines={1} style={{ fontSize: 11.5, color: info.frais ? c.texte : '#fff', textAlign: 'center' }}>{txt}</T>
              </Pressable>
            ) : noms || nom === choisi ? (
              <Pressable onPress={() => onChoisir(nom)} style={[st.nom, place, { width: largeur }]}>
                <T gras numberOfLines={1} style={{ fontSize: 11, color: c.marine, textAlign: p.cote === 'g' || p.cote === 'bg' ? 'right' : p.cote === 'd' ? 'left' : 'center', textShadowColor: '#fff', textShadowRadius: 3 }}>{nom}</T>
              </Pressable>
            ) : null}
          </View>
        );
      })}
      <View style={st.zoom}>
        <Pressable accessibilityLabel="Zoomer" onPress={() => zoomer(1.6)} style={st.btn}><T tresGras style={st.btnT}>+</T></Pressable>
        <Pressable accessibilityLabel="Dézoomer" onPress={() => zoomer(1 / 1.6)} style={[st.btn, { borderTopWidth: 1, borderTopColor: c.ligne }]}><T tresGras style={st.btnT}>−</T></Pressable>
      </View>
      <View style={st.legende} pointerEvents="none">
        <View style={st.ligneLeg}><View style={[st.pt, { width: 12, height: 12, borderRadius: 6 }]} /><T style={st.txt}>Port territorial</T>
          <View style={[st.pt, { width: 8, height: 8, borderRadius: 4, marginLeft: 6 }]} /><T style={st.txt}>Abri de pêche</T></View>
        <View style={st.ligneLeg}><View style={[st.mini, st.frais]}><T tresGras style={{ fontSize: 9, color: c.texte }}>Port · 2</T></View><T style={st.txt}>arrivé il y a moins d’1 h</T></View>
        {!noms ? <T gris style={{ fontSize: 10 }}>Zoomez pour voir tous les noms</T> : null}
      </View>
      <T gris style={st.credit}>Trait de côte © OpenStreetMap</T>
    </View>
  );
}

const MER = '#ddeaf2';
const st = StyleSheet.create({
  point: { position: 'absolute', backgroundColor: c.marine, borderWidth: 2.5, borderColor: '#fff', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  pointChoisi: { borderColor: c.marine, backgroundColor: '#fff', borderWidth: 4 },
  etiquette: { position: 'absolute', height: 22, borderRadius: 11, justifyContent: 'center', paddingHorizontal: 6, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
  normale: { backgroundColor: '#111' },
  frais: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#c9c9c4' },
  etiquetteChoisie: { borderWidth: 2, borderColor: c.marine },
  nom: { position: 'absolute', height: 22, justifyContent: 'center' },
  zoom: { position: 'absolute', right: 12, top: 12, borderRadius: 12, overflow: 'hidden', backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, elevation: 4 },
  btn: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  btnT: { fontSize: 22, color: c.marine, fontFamily: f.tresGras },
  legende: { position: 'absolute', left: 10, bottom: 10, backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 10, padding: 8, gap: 4 },
  ligneLeg: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pt: { backgroundColor: c.marine, borderWidth: 2, borderColor: '#fff', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 1 },
  mini: { borderRadius: 99, paddingHorizontal: 5, paddingVertical: 1 },
  txt: { fontSize: 11 },
  credit: { position: 'absolute', right: 8, bottom: 6, fontSize: 9 },
});
