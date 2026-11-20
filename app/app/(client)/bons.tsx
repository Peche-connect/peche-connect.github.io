import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Pastille, T, Vide } from '../../src/components/ui';
import { euro, kg } from '../../src/format';
import { useApp } from '../../src/store';
import { couleurs as c } from '../../src/theme';

export default function MesBons() {
  const app = useApp();
  const bons = app.mesBons();
  const pre = app.mesPrecommandes().filter((p) => p.statut !== 'annulee').reverse();
  const etat = (p: typeof pre[number]) => p.statut === 'en_attente' ? 'En attente du retour du pêcheur' : p.statut === 'convertie' ? 'Arrivé : ' + kg(p.kgServi ?? p.kg) + ' mis de côté, à payer' : 'Pas servi' + (p.raison ? ' (' + p.raison + ')' : '') + ' : rien débité';
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.fond }}>
      <T tresGras style={{ fontSize: 24, padding: 16 }}>Mes bons</T>
      <ScrollView>
        {pre.length ? (
          <View style={{ padding: 16, gap: 8, borderBottomWidth: 1, borderBottomColor: c.ligne }}>
            <T tresGras style={{ fontSize: 17 }}>Réservé avant la sortie</T>
            {pre.map((p) => (
              <Pressable key={p.id} onPress={() => (p.bonCode ? router.push({ pathname: '/bon/[code]', params: { code: p.bonCode } }) : router.push({ pathname: '/sortie/[id]', params: { id: p.etalId } }))} style={{ gap: 2, paddingVertical: 6 }}>
                <T><T tresGras>{p.espece} · {kg(p.kg)}</T> · étal de {app.etal(p.etalId)?.pecheur ?? '…'}</T>
                <T petit style={{ color: p.statut === 'convertie' ? c.alerte : c.gris }}>{etat(p)}</T>
              </Pressable>
            ))}
          </View>
        ) : null}
        {!bons.length && !pre.length ? <Vide titre="Aucun bon pour l’instant" texte="Quand vous réservez, votre bon de retrait apparaît ici avec son code." action="Voir les étals" onAction={() => router.navigate('/(client)')} /> : null}
        {bons.map((b) => {
          const e = app.etal(b.etalId);
          return (
            <Pressable key={b.code} onPress={() => router.push({ pathname: '/bon/[code]', params: { code: b.code } })} style={{ padding: 16, gap: 6, borderBottomWidth: 1, borderBottomColor: c.ligne }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <T tresGras style={{ fontSize: 18 }}>{b.code}</T>
                <Pastille texte={b.creneau} />
              </View>
              <T>Étal de {e?.pecheur ?? '—'} · {e?.port ?? ''}</T>
              <T gris petit>{app.resume(b.lignes)}</T>
              <Pastille texte={b.statut === 'annule' ? 'Annulé · ' + (b.montantPaye ? euro(b.montantPaye) + ' débités (absence)' : 'rien débité') : b.statut === 'retire' ? 'Retiré · payé ' + euro(b.montantPaye ?? 0) + (b.rembourse ? ' · remboursé ' + euro(b.rembourse) : '') : b.statut === 'a_payer' ? 'À régler pour confirmer' : 'À retirer · en attente de pesée'} style={{ backgroundColor: b.statut === 'retire' ? '#dff3ea' : b.statut === 'a_payer' ? '#fde7dc' : c.doux }} />
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
