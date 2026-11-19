import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { quandRetour } from '../../src/components/Sorties';
import { Bouton, EnTete, Pastille, Stepper, T, Vide } from '../../src/components/ui';
import { euro, kg } from '../../src/format';
import { MODE_DEMO, useApp } from '../../src/store';
import { couleurs as c } from '../../src/theme';

// Client : réserver avant le retour du pêcheur (aucun paiement maintenant)
export default function SortieClient() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useApp();
  const s = app.e.sorties.find((x) => x.etalId === id);
  const pro = !!app.e.session?.pro;
  const [qte, setQte] = useState<Record<string, number>>({});
  const [envoi, setEnvoi] = useState('');
  const miennes = app.mesPrecommandes().filter((p) => p.etalId === id);
  if (!s) return <SafeAreaView style={{ flex: 1, backgroundColor: c.fond }}><EnTete titre="Sortie en mer" fermer /><Vide titre="Sortie terminée" texte="Le pêcheur est rentré ou a annulé sa sortie." action="Voir son étal" onAction={() => router.replace({ pathname: '/etal/[id]', params: { id } })} /></SafeAreaView>;
  const rentree = s.statut !== 'annoncee';
  const max = pro ? 100 : 10;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.fond }}>
      <EnTete titre={s.prenom + ' part en mer'} sousTitre={s.port + ' · ' + s.bateau} fermer />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
        <Pastille texte={rentree ? 'Rentré au port' : 'Retour prévu ' + quandRetour(s.retour).toLowerCase()} style={{ alignSelf: 'flex-start', backgroundColor: c.doux }} />
        <View style={{ backgroundColor: c.doux, borderRadius: 12, padding: 12, gap: 4 }}>
          <T gras>Comment ça marche</T>
          <T>1. Vous réservez maintenant, sans payer.</T>
          <T>2. À son retour, votre part est mise de côté (premiers arrivés, premiers servis).</T>
          <T>3. Vous recevez une alerte et payez dans l’heure. Seul le poids réel est débité.</T>
          <T gris petit>S’il ne pêche pas votre espèce, rien n’est débité.</T>
        </View>
        {s.especes.map((x) => {
          const reste = Math.max(0, Math.round((x.kgMax - (s.reserveKg[x.espece] ?? 0)) * 10) / 10);
          const deja = miennes.find((p) => p.espece === x.espece && p.statut === 'en_attente');
          const q = qte[x.espece] ?? Math.min(pro ? 5 : 1, reste);
          return (
            <View key={x.espece} style={{ borderWidth: 1, borderColor: c.ligne, borderRadius: 14, padding: 14, gap: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <T tresGras style={{ fontSize: 16 }}>{x.espece}</T>
                <T tresGras>~{euro(x.prixKg)}/kg</T>
              </View>
              <T gris petit>Prix annoncé, confirmé à l’arrivée · encore {kg(reste)} à réserver</T>
              {deja ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <T gras style={{ color: c.vert }}>✓ {kg(deja.kg)} réservés</T>
                  <Bouton clair titre="Annuler" onPress={() => app.annulerPrecommande(deja.id)} style={{ height: 40, paddingHorizontal: 16 }} />
                </View>
              ) : rentree || reste < 0.5 ? <T gris>{rentree ? 'Rentré : voyez son étal.' : 'Tout est déjà réservé.'}</T> : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Stepper valeur={kg(q)} onMoins={() => setQte((m) => ({ ...m, [x.espece]: Math.max(0.5, q - (pro ? 1 : 0.5)) }))} onPlus={() => setQte((m) => ({ ...m, [x.espece]: Math.min(reste, max, q + (pro ? 1 : 0.5)) }))} />
                  <Bouton titre={'Réserver ' + kg(q)} desactive={!!envoi} style={{ flex: 1, height: 46 }}
                    onPress={async () => {
                      // visiteur sans compte : on lui demande de se connecter, puis il revient ici
                      if (!app.e.session) { router.push({ pathname: '/connexion', params: { retour: '/sortie/' + s.etalId } }); return; }
                      setEnvoi(x.espece); await app.precommander(s.etalId, x.espece, q); setEnvoi('');
                    }} />
                </View>
              )}
            </View>
          );
        })}
        <Bouton clair titre={'Voir l’étal de ' + s.prenom} onPress={() => router.push({ pathname: '/etal/[id]', params: { id: s.etalId } })} />
        {MODE_DEMO && !rentree ? <Bouton clair titre="Démo : simuler son retour au port" onPress={() => { app.simulerRetour(s.etalId); router.replace('/(client)/bons'); }} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
