// Écran d'appel par Internet entre le client et le pêcheur : aucun numéro de téléphone n'est échangé.
// En démo, l'appel est simulé (pas de son).
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { demarrerAppel, type Appel } from '../../src/appel';
import { T } from '../../src/components/ui';
import { MODE_DEMO, useApp } from '../../src/store';
import { couleurs as c } from '../../src/theme';

type Etat = 'connexion' | 'sonne' | 'en-cours' | 'termine' | 'erreur';
const duree = (s: number) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

export default function EcranAppel() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useApp();
  const conv = app.e.convs[id];
  const moiPecheur = app.e.session?.role === 'pecheur';
  const etal = conv ? app.etal(conv.etalId) : undefined;
  const nom = moiPecheur ? (conv?.client ?? 'Client') : (etal?.pecheur ?? 'Pêcheur');
  const [etat, setEtat] = useState<Etat>('connexion');
  const [message, setMessage] = useState('');
  const [micro, setMicro] = useState(true);
  const [hp, setHp] = useState(false);
  const [secondes, setSecondes] = useState(0);
  const appel = useRef<Appel | null>(null);

  useEffect(() => {
    let fini = false;
    (async () => {
      try {
        const p = await app.preparerAppel(id);
        if (fini) return;
        if (!p) { // démo : l'autre « décroche » au bout de 2 secondes
          setEtat('sonne'); setTimeout(() => !fini && setEtat('en-cours'), 2000); return;
        }
        setEtat(p.reponse ? 'connexion' : 'sonne');
        appel.current = await demarrerAppel(p, (present) => setEtat(present ? 'en-cours' : 'termine'));
        if (fini) appel.current.raccrocher();
      } catch (e) { setMessage((e as Error).message); setEtat('erreur'); }
    })();
    return () => { fini = true; appel.current?.raccrocher(); appel.current = null; };
  }, [id]);
  useEffect(() => {
    if (etat !== 'en-cours') return;
    const t = setInterval(() => setSecondes((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [etat]);
  // l'autre a raccroché : retour automatique à la conversation
  useEffect(() => { if (etat === 'termine') { const t = setTimeout(() => router.canGoBack() ? router.back() : router.replace('/'), 1500); return () => clearTimeout(t); } }, [etat]);

  const raccrocher = async () => { await appel.current?.raccrocher(); appel.current = null; setEtat('termine'); };
  const texte = {
    connexion: 'Connexion…', sonne: 'Appel en cours… ' + nom + ' est prévenu', 'en-cours': duree(secondes),
    termine: 'Appel terminé', erreur: message,
  }[etat];

  const Rond = ({ label, actif, onPress, fond, children }: { label: string; actif?: boolean; onPress: () => void; fond?: string; children: React.ReactNode }) => (
    <View style={{ alignItems: 'center', gap: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
        style={{ width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: fond ?? (actif ? '#fff' : 'rgba(255,255,255,0.16)') }}>
        {children}
      </Pressable>
      <T petit style={{ color: '#fff' }}>{label}</T>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.marine }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 }}>
        <View style={{ width: 112, height: 112, borderRadius: 56, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' }}>
          <T tresGras style={{ fontSize: 44, color: '#fff' }}>{nom.slice(0, 1).toUpperCase()}</T>
        </View>
        <T tresGras style={{ fontSize: 28, color: '#fff' }}>{nom}</T>
        <T style={{ color: 'rgba(255,255,255,0.8)', textAlign: 'center' }} accessibilityLiveRegion="polite">{texte}</T>
        <T petit style={{ color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginTop: 8 }}>
          {MODE_DEMO ? 'Démo : appel simulé, sans son.' : 'Appel par Internet : vos numéros restent masqués.'}
        </T>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-evenly', paddingBottom: 40 }}>
        {etat === 'erreur' || etat === 'termine' ? (
          <Rond label="Fermer" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} fond="rgba(255,255,255,0.16)"><T tresGras style={{ fontSize: 26, color: '#fff' }}>✕</T></Rond>
        ) : (
          <>
            <Rond label={micro ? 'Micro' : 'Micro coupé'} actif={!micro} onPress={() => { const v = !micro; setMicro(v); appel.current?.micro(v); }}>
              <T tresGras style={{ fontSize: 15, color: micro ? '#fff' : c.marine }}>{micro ? 'MIC' : 'OFF'}</T>
            </Rond>
            <Rond label="Raccrocher" onPress={raccrocher} fond={c.alerte}><T tresGras style={{ fontSize: 26, color: '#fff' }}>✕</T></Rond>
            <Rond label="Haut-parleur" actif={hp} onPress={() => { const v = !hp; setHp(v); appel.current?.hautParleur(v); }}>
              <T tresGras style={{ fontSize: 15, color: hp ? c.marine : '#fff' }}>HP</T>
            </Rond>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
