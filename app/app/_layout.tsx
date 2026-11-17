import { BebasNeue_400Regular } from '@expo-google-fonts/bebas-neue';
import { Figtree_500Medium, Figtree_700Bold, Figtree_800ExtraBold, useFonts } from '@expo-google-fonts/figtree';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { MagasinProvider, useApp } from '../src/store';
import { couleurs, polices } from '../src/theme';

function Contenu() {
  const { pret, e, effacerErreur } = useApp();
  if (!pret) return <View style={{ flex: 1, backgroundColor: couleurs.fond }} />;
  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: couleurs.fond } }} />
      {e.erreur ? (
        // Message d'erreur du serveur (« Plus assez de thon… »), en haut de l'écran
        <SafeAreaView edges={['top']} style={{ position: 'absolute', left: 0, right: 0, top: 0 }} pointerEvents="box-none">
          <Pressable accessibilityRole="alert" onPress={effacerErreur} style={{ margin: 10, padding: 14, borderRadius: 12, backgroundColor: couleurs.alerte, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Text style={{ flex: 1, color: '#fff', fontFamily: polices.gras, fontSize: 15 }}>{e.erreur}</Text>
            <Text style={{ color: '#fff', fontFamily: polices.tresGras, fontSize: 18 }}>✕</Text>
          </Pressable>
        </SafeAreaView>
      ) : null}
    </View>
  );
}

export default function Racine() {
  const [polices] = useFonts({ BebasNeue_400Regular, Figtree_500Medium, Figtree_700Bold, Figtree_800ExtraBold });
  if (!polices) return <View style={{ flex: 1, backgroundColor: couleurs.fond }} />;
  return (
    <SafeAreaProvider>
      <MagasinProvider>
        <StatusBar style="dark" />
        <Contenu />
      </MagasinProvider>
    </SafeAreaProvider>
  );
}
