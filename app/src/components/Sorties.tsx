import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { euro } from '../format';
import { useApp } from '../store';
import { couleurs as c } from '../theme';
import type { Sortie } from '../types';
import { T } from './ui';

// « Demain vers 11 h », « Aujourd'hui vers 15 h »
export function quandRetour(iso: string) {
  const d = new Date(iso), auj = new Date();
  const demain = new Date(); demain.setDate(auj.getDate() + 1);
  const jour = d.toDateString() === auj.toDateString() ? 'Aujourd’hui' : d.toDateString() === demain.toDateString() ? 'Demain' : d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' });
  return jour + ' vers ' + d.getHours() + ' h' + (d.getMinutes() ? String(d.getMinutes()).padStart(2, '0') : '');
}

export function CarteSortie({ s }: { s: Sortie }) {
  return (
    <Pressable onPress={() => router.push({ pathname: '/sortie/[id]', params: { id: s.etalId } })} accessibilityRole="button"
      style={{ width: 250, borderWidth: 1, borderColor: c.ligne, borderRadius: 14, padding: 14, gap: 4 }}>
      <T tresGras style={{ fontSize: 16 }}>{s.prenom} est en mer</T>
      <T gris petit>{s.port} · retour {quandRetour(s.retour).toLowerCase()}</T>
      <T style={{ marginTop: 4 }}>{s.especes.map((x) => x.espece + ' ~' + euro(x.prixKg) + '/kg').join(' · ')}</T>
      <T tresGras style={{ color: c.marine, marginTop: 6 }}>Réserver avant son retour ›</T>
    </Pressable>
  );
}

// Accueil : les sorties annoncées, en bandeau horizontal
export function SortiesAnnoncees({ titre }: { titre: object }) {
  const app = useApp();
  const l = app.sortiesOuvertes();
  if (!l.length) return null;
  return (
    <View style={{ gap: 10 }}>
      <T tresGras style={titre}>En mer : réservez avant leur retour</T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: 16 }}>
        {l.map((s) => <CarteSortie key={s.etalId} s={s} />)}
      </ScrollView>
    </View>
  );
}
