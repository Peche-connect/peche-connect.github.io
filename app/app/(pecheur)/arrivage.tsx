import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IcCompte, IcMicro, IcPhoto } from '../../src/components/icones';
import { Bouton, Chip, Feuille, Logo, Rond, Stepper, T } from '../../src/components/ui';
import { ESPECES } from '../../src/data/demo';
import { lireDictee } from '../../src/dictee';
import { fermeture } from '../../src/data/fermetures';
import { euro, heure, kg } from '../../src/format';
import { useApp } from '../../src/store';
import { couleurs as c, polices as f } from '../../src/theme';

type L = { espece: string; prixKg: number; dispoKg: number; preparations: { nom: string; supplementKg: number }[] };

// Publier l'arrivage en moins d'une minute : prix et quantités d'hier pré-remplis
export default function Arrivage() {
  const app = useApp();
  const s = app.e.session!;
  const e = app.etal(s.etalId)!;
  const [lignes, setLignes] = useState<L[]>([]);
  const [ajout, setAjout] = useState(false);
  const [publie, setPublie] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [photo, setPhoto] = useState<{ uri: string; type?: string } | null>(null);
  const [dictee, setDictee] = useState(false);
  const [texte, setTexte] = useState('');
  const [ecoute, setEcoute] = useState(false);
  const [info, setInfo] = useState('');
  useEffect(() => { setLignes(e.produits.map((p) => ({ espece: p.espece, prixKg: p.prixKg, dispoKg: p.dispoKg, preparations: p.preparations }))); }, [e.id]);
  const total = lignes.reduce((t, l) => t + l.dispoKg, 0);
  const aPreparer = app.bonsPecheur(s.etalId).filter((b) => b.statut === 'reserve').length;
  const maj = (i: number, f: (l: L) => L) => setLignes((ls) => ls.map((l, j) => (j === i ? f(l) : l)));

  // Photo de la pêche : appareil photo du téléphone (ou galerie)
  const prendrePhoto = async () => {
    const IP = await import('expo-image-picker');
    if (Platform.OS !== 'web') { const p = await IP.requestCameraPermissionsAsync(); if (!p.granted) { setInfo('Autorisez l’appareil photo dans les réglages du téléphone.'); return; } }
    const r = await IP.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6, allowsEditing: true, aspect: [4, 3] }).catch(() => IP.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 }));
    if (!r.canceled && r.assets[0]) setPhoto({ uri: r.assets[0].uri, type: r.assets[0].mimeType ?? 'image/jpeg' });
  };

  // Dictée : reconnaissance vocale du navigateur (Chrome, Safari) ; dans l'appli, le micro du clavier
  const Reco = Platform.OS === 'web' && typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;
  const ecouter = () => {
    if (!Reco) return;
    const r = new Reco(); r.lang = 'fr-FR'; r.interimResults = false; r.continuous = true;
    r.onresult = (ev: any) => { const t = Array.from(ev.results as ArrayLike<any>).map((x: any) => x[0].transcript).join(' '); setTexte((v) => (v ? v + ' ' : '') + t); };
    r.onend = () => setEcoute(false); r.onerror = () => setEcoute(false);
    r.start(); setEcoute(true);
    setTimeout(() => { try { r.stop(); } catch { /* déjà arrêté */ } }, 20000);
  };
  const remplir = () => {
    const lu = lireDictee(texte, ESPECES.filter((x) => !fermeture(x)));
    if (!lu.length) { setInfo('Aucune espèce reconnue. Exemple : « thon jaune 12 kilos à 14 euros ».'); return; }
    setLignes((ls) => {
      const n = [...ls];
      lu.forEach((d) => {
        const i = n.findIndex((l) => l.espece === d.espece);
        const base = i >= 0 ? n[i] : { espece: d.espece, prixKg: 12, dispoKg: 5, preparations: [{ nom: 'Entier', supplementKg: 0 }] };
        const l = { ...base, dispoKg: d.dispoKg ?? base.dispoKg, prixKg: d.prixKg ?? base.prixKg };
        if (i >= 0) n[i] = l; else n.push(l);
      });
      return n;
    });
    setInfo(lu.length + ' espèce' + (lu.length > 1 ? 's' : '') + ' remplie' + (lu.length > 1 ? 's' : '') + ' : vérifiez puis mettez en vente.');
    setDictee(false); setTexte('');
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.fond }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 10, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Logo /><T gris>Bonjou {s.prenom}</T></View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Chip titre={aPreparer + ' à préparer'} onPress={() => router.navigate('/(pecheur)/reservations')} style={{ backgroundColor: c.accent, minHeight: 34 }} />
            <Rond label="Mon compte" onPress={() => router.push('/compte')}><IcCompte /></Rond>
          </View>
        </View>
        <T tresGras style={{ fontSize: 26 }}>Votre arrivage du jour</T>
        <T gris>{e.port} · retrait jusqu’à <T tresGras>{heure(e.limiteRetrait)}</T></T>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 4 }}>
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 6 }}>
          <Pressable onPress={prendrePhoto} style={{ flex: 1, minHeight: 70, borderRadius: 14, backgroundColor: c.doux, alignItems: 'center', justifyContent: 'center', gap: 6, overflow: 'hidden' }}>
            {photo ? <Image source={{ uri: photo.uri }} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: 0.35 }} resizeMode="cover" /> : null}
            <IcPhoto /><T gras>{photo ? 'Photo ajoutée ✓' : 'Photo de la pêche'}</T>
          </Pressable>
          <Pressable onPress={() => { setDictee(true); setInfo(''); }} style={{ flex: 1, minHeight: 70, borderRadius: 14, backgroundColor: c.doux, alignItems: 'center', justifyContent: 'center', gap: 6 }}><IcMicro /><T gras>Dicter l’arrivage</T></Pressable>
        </View>
        {info ? <T gras style={{ color: c.marine, marginBottom: 4 }}>{info}</T> : null}
        {lignes.map((l, i) => (
          <View key={l.espece} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.ligne }}>
            <View style={{ flex: 1, gap: 6 }}>
              <T tresGras style={{ fontSize: 16 }}>{l.espece}</T>
              <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', borderWidth: 1, borderColor: c.ligne, borderRadius: 8, padding: 2, gap: 4 }}>
                <Pressable accessibilityLabel="Baisser le prix" onPress={() => maj(i, (x) => ({ ...x, prixKg: Math.max(1, x.prixKg - 0.5) }))} style={{ width: 26, height: 26, borderRadius: 6, backgroundColor: c.doux, alignItems: 'center', justifyContent: 'center' }}><T tresGras>−</T></Pressable>
                <T tresGras style={{ minWidth: 76, textAlign: 'center' }}>{euro(l.prixKg)}/kg</T>
                <Pressable accessibilityLabel="Monter le prix" onPress={() => maj(i, (x) => ({ ...x, prixKg: x.prixKg + 0.5 }))} style={{ width: 26, height: 26, borderRadius: 6, backgroundColor: c.doux, alignItems: 'center', justifyContent: 'center' }}><T tresGras>+</T></Pressable>
              </View>
            </View>
            <Stepper valeur={kg(l.dispoKg)} onMoins={() => maj(i, (x) => ({ ...x, dispoKg: Math.max(0, x.dispoKg - 1) }))} onPlus={() => maj(i, (x) => ({ ...x, dispoKg: x.dispoKg + 1 }))} />
          </View>
        ))}
        <Pressable onPress={() => setAjout(true)} style={{ paddingVertical: 14 }}><T tresGras>+ Ajouter une espèce</T></Pressable>
        <View style={{ backgroundColor: c.doux, borderRadius: 12, padding: 12 }}><T gris>Vos prix et quantités d’hier sont déjà remplis.</T></View>
        {publie ? <T gras style={{ color: c.vert, marginTop: 8 }}>Arrivage publié : les clients le voient tout de suite.</T> : null}
      </ScrollView>
      <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: c.ligne }}>
        <Bouton titre="Mettre en vente" desactive={!total || envoi} droite={<T gras style={{ color: '#fff', opacity: 0.8 }}>{kg(total)} · {lignes.length} espèce{lignes.length > 1 ? 's' : ''}</T>}
          onPress={async () => { setEnvoi(true); const ok = await app.publierArrivage(e.id, lignes, photo ?? undefined); setEnvoi(false); if (ok) { setPublie(true); setPhoto(null); } }} />
      </View>
      <Feuille visible={dictee} onFermer={() => setDictee(false)} titre="Dicter l’arrivage">
        <T gris style={{ marginBottom: 10 }}>Dites les espèces, les kilos et les prix. Exemple : « thon jaune 12 kilos à 14 euros, vivaneau 5 kilos à 16 euros ».</T>
        {Reco ? <Bouton titre={ecoute ? 'J’écoute… parlez' : '🎙 Parler'} clair={ecoute} onPress={ecouter} desactive={ecoute} style={{ marginBottom: 10 }} />
          : <T gris petit style={{ marginBottom: 8 }}>{Platform.OS === 'web' ? 'Ce navigateur ne reconnaît pas la voix : tapez le texte.' : 'Touchez le micro du clavier pour dicter.'}</T>}
        <TextInput value={texte} onChangeText={setTexte} multiline placeholder="thon jaune 12 kilos à 14 euros…" placeholderTextColor={c.grisClair}
          style={{ minHeight: 90, borderRadius: 12, backgroundColor: c.doux, padding: 12, fontSize: 16, fontFamily: f.normal, color: c.texte, textAlignVertical: 'top' }} />
        <Bouton titre="Remplir mon arrivage" onPress={remplir} desactive={!texte.trim()} style={{ marginTop: 12 }} />
      </Feuille>
      <Feuille visible={ajout} onFermer={() => setAjout(false)} titre="Ajouter une espèce">
        {ESPECES.filter((x) => !lignes.some((l) => l.espece === x)).map((x) => {
          const f = fermeture(x); // période de fermeture : vente bloquée
          return (
            <Pressable key={x} disabled={!!f} onPress={() => { setLignes((ls) => [...ls, { espece: x, prixKg: 12, dispoKg: 5, preparations: [{ nom: 'Entier', supplementKg: 0 }] }]); setAjout(false); }}
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.ligne, opacity: f ? 0.5 : 1 }}>
              <View style={{ flex: 1 }}><T tresGras>{x}</T>{f ? <T petit style={{ color: c.alerte }}>{f.motif}</T> : null}</View><T tresGras>{f ? 'Fermé' : '+'}</T>
            </Pressable>
          );
        })}
      </Feuille>
    </SafeAreaView>
  );
}
