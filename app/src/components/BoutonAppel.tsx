// Bouton « Appeler » de l'en-tête des conversations : appel par Internet, numéros masqués
import { router } from 'expo-router';
import { Pressable } from 'react-native';
import { couleurs as c } from '../theme';
import { T } from './ui';

export function BoutonAppel({ id }: { id: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Appeler" onPress={() => router.push({ pathname: '/appel/[id]', params: { id } })}
      style={{ height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: c.marine, alignItems: 'center', justifyContent: 'center' }}>
      <T tresGras style={{ color: '#fff', fontSize: 14 }}>Appeler</T>
    </Pressable>
  );
}
