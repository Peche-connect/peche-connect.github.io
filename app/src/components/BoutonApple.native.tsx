// Bouton officiel « Continuer avec Apple » (exigé par les règles de l'App Store), iPhone seulement
import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform, View } from 'react-native';

export function BoutonApple({ onPress, desactive }: { onPress: () => void; desactive?: boolean }) {
  if (Platform.OS !== 'ios') return null;
  return (
    <View style={{ opacity: desactive ? 0.4 : 1 }} pointerEvents={desactive ? 'none' : 'auto'}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={14} style={{ height: 52, width: '100%' }} onPress={onPress} />
    </View>
  );
}
