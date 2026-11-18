// Bouton « Continuer avec Apple » du site (dans l'appli iPhone : bouton officiel d'Apple, BoutonApple.native.tsx)
import { Pressable } from 'react-native';
import { T } from './ui';

export function BoutonApple({ onPress, desactive }: { onPress: () => void; desactive?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={desactive}
      style={{ height: 52, borderRadius: 14, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10, opacity: desactive ? 0.4 : 1 }}>
      <T tresGras style={{ fontSize: 16, color: '#fff' }}>Continuer avec Apple</T>
    </Pressable>
  );
}
