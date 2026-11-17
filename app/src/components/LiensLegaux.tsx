import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { PAGES } from '../legal';
import { T } from './ui';

// Liens vers les pages légales (connexion, mon compte, bas des pages légales)
export function LiensLegaux({ centre }: { centre?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, justifyContent: centre ? 'center' : 'flex-start' }}>
      {Object.entries(PAGES).map(([k, v]) => (
        <Pressable key={k} accessibilityRole="link" onPress={() => router.push({ pathname: '/legal/[page]', params: { page: k } })}>
          <T gris petit style={{ textDecorationLine: 'underline' }}>{v.titre.replace('Conditions générales d’utilisation et de vente', 'Conditions générales')}</T>
        </Pressable>
      ))}
    </View>
  );
}
