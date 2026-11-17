import { useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { LiensLegaux } from '../../src/components/LiensLegaux';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EnTete, T, Vide } from '../../src/components/ui';
import { PAGES } from '../../src/legal';
import { couleurs as c } from '../../src/theme';

// Mentions légales, confidentialité, conditions générales : /legal/mentions, /legal/confidentialite, /legal/conditions
export default function PageLegaleEcran() {
  const { page } = useLocalSearchParams<{ page: string }>();
  const p = PAGES[page ?? ''];
  if (!p) return <SafeAreaView style={{ flex: 1 }}><EnTete titre="Informations légales" /><Vide titre="Page introuvable" texte="Retrouvez les informations légales dans « Mon compte »." perso={false} /></SafeAreaView>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.fond }}>
      <EnTete titre={p.titre} sousTitre={'Mise à jour : ' + p.maj} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
        {p.sections.map((s) => (
          <View key={s.titre} style={{ gap: 4 }}>
            <T tresGras style={{ fontSize: 16 }}>{s.titre}</T>
            <T style={{ lineHeight: 22 }}>{s.texte}</T>
          </View>
        ))}
        <LiensLegaux />
      </ScrollView>
    </SafeAreaView>
  );
}
