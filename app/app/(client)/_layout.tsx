import { Redirect, Tabs } from 'expo-router';
import { IcAccueil, IcArrivage, IcBons, IcCarte, IcMessages } from '../../src/components/icones';
import { useApp } from '../../src/store';
import { couleurs as c, polices as f } from '../../src/theme';

export default function OngletsClient() {
  const app = useApp();
  // visiteur sans compte : il voit les étals et la carte ; on lui demande de se connecter pour réserver
  const s = app.e.session;
  if (s?.role === 'pecheur') return <Redirect href="/" />;
  const enCours = s ? app.mesBons().filter((b) => b.statut === 'reserve').length : 0;
  const nonLus = s ? app.nonLusClient() : 0;
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: c.marine,
      tabBarInactiveTintColor: c.gris,
      tabBarLabelStyle: { fontFamily: f.gras, fontSize: 12, lineHeight: 18, height: 20, overflow: 'visible' },
      tabBarBadgeStyle: { backgroundColor: c.accent, color: c.surAccent, fontFamily: f.tresGras, fontSize: 11 },
      sceneStyle: { backgroundColor: c.fond },
      tabBarStyle: { height: 74, paddingTop: 6, paddingBottom: 14, backgroundColor: c.fond, borderTopColor: c.ligne },
      tabBarItemStyle: { paddingBottom: 2 },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Accueil', tabBarIcon: ({ color }) => <IcAccueil couleur={color} /> }} />
      <Tabs.Screen name="carte" options={{ title: 'Carte', tabBarIcon: ({ color }) => <IcCarte couleur={color} /> }} />
      <Tabs.Screen name="besoins" options={{ title: 'Besoins', href: s?.pro ? undefined : null, tabBarIcon: ({ color }) => <IcArrivage couleur={color} /> }} />
      <Tabs.Screen name="bons" options={{ title: 'Mes bons', tabBarBadge: enCours || undefined, tabBarIcon: ({ color }) => <IcBons couleur={color} /> }} />
      <Tabs.Screen name="messages" options={{ title: 'Messages', tabBarBadge: nonLus || undefined, tabBarIcon: ({ color }) => <IcMessages couleur={color} /> }} />
    </Tabs>
  );
}
