import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IcVerrou } from '../../src/components/icones';
import { Bouton, Chip, Feuille, Pastille, Prix, Rond, Stepper, T, Vide, s } from '../../src/components/ui';
import { euro, heure, kg } from '../../src/format';
import { disponible, offre, sousTotal } from '../../src/formats';
import { ListeAvis } from '../../src/components/Avis';
import { useApp } from '../../src/store';
import { couleurs as c } from '../../src/theme';

export default function EtalEcran() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useApp();
  const e = app.etal(id);
  const [reglage, setReglage] = useState<{ produitId: string; kg: number } | null>(null);
  if (!e) return <SafeAreaView style={{ flex: 1 }}><Vide titre="Étal introuvable" texte="Il n’est peut-être plus en ligne aujourd’hui." action="Retour à l’accueil" onAction={() => router.replace('/(client)')} /></SafeAreaView>;

  const autre = app.e.panier && app.e.panier.etalId !== e.id;
  const nb = app.e.panier?.etalId === e.id ? app.e.panier.lignes.length : 0;
  const pro = !!app.e.session?.pro;
  const pas = (produitId: string, signe: 1 | -1, pasKg = 0.5) => {
    const q = app.kgPanier(e.id, produitId);
    app.reglerKg(e.id, produitId, q === 0 && signe > 0 ? 1 : q + (pro ? Math.max(1, pasKg) : pasKg) * signe);
  };
  const prodReglage = reglage ? e.produits.find((p) => p.id === reglage.produitId) : undefined;

  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: c.fond }}>
      <ScrollView>
        <View style={[s.photo, { height: 190, borderRadius: 0, overflow: 'hidden' }]}>
          {e.photo ? <Image source={{ uri: e.photo }} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} resizeMode="cover" accessibilityLabel={'Pêche du jour de ' + e.pecheur} /> : <T gras gris style={{ letterSpacing: 1 }}>{e.port.toUpperCase()}</T>}
          <SafeAreaView edges={['top']} style={{ position: 'absolute', left: 14, right: 14, top: 0, flexDirection: 'row', justifyContent: 'space-between' }}>
            <Rond blanc label="Retour" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(client)'))}><T tresGras style={{ fontSize: 20 }}>‹</T></Rond>
          </SafeAreaView>
        </View>
        <View style={{ padding: 16, gap: 8 }}>
          <T tresGras style={{ fontSize: 26 }}>Étal de {e.pecheur}</T>
          <T gris>{e.avis ? String(e.note).replace('.', ',') + ' ★ (' + e.avis + ' avis)' : 'Nouveau'} · {e.port} · {app.km(e)} km</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <Pastille texte={'Débarqué ' + heure(e.debarque) + ' · ' + app.depuis(e)} fonce={!app.frais(e)} />
            <Pastille texte={'Retrait jusqu’à ' + heure(e.limiteRetrait)} style={{ backgroundColor: c.doux }} />
            <Pastille texte={e.bateau} style={{ backgroundColor: c.doux }} />
          </View>
        </View>
        {app.sortie(e.id) ? (
          <Pressable onPress={() => router.push({ pathname: '/sortie/[id]', params: { id: e.id } })} accessibilityRole="button" style={{ marginHorizontal: 16, marginBottom: 12, padding: 12, borderRadius: 12, backgroundColor: c.doux }}>
            <T><T tresGras>{e.pecheur} est en mer.</T> Réservez sa prochaine pêche avant son retour ›</T>
          </Pressable>
        ) : null}
        {autre ? (
          <View style={{ marginHorizontal: 16, marginBottom: 12, padding: 12, borderRadius: 12, backgroundColor: c.accentPale, gap: 8 }}>
            <T>Votre panier contient déjà l’étal de <T tresGras>{app.etal(app.e.panier!.etalId)?.pecheur}</T>. Un panier = un seul pêcheur.</T>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Chip titre="Vider le panier" actif onPress={app.viderPanier} />
              <Chip titre="Voir mon panier" onPress={() => router.push('/panier')} />
            </View>
          </View>
        ) : null}
        {e.produits.map((p) => {
          const dispo = disponible(p), o = offre(p);
          const plus = (label: string, onPress: () => void) => (
            <Pressable accessibilityLabel={label} onPress={onPress} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: c.marine, alignItems: 'center', justifyContent: 'center' }}>
              <T tresGras style={{ color: '#fff', fontSize: 20 }}>+</T>
            </Pressable>
          );
          let action: React.ReactNode = null;
          if (dispo && !autre) {
            if (p.format === 'kilo') {
              const q = app.kgPanier(e.id, p.id);
              action = q ? <Stepper valeur={kg(q)} onMoins={() => pas(p.id, -1, p.pasKg)} onPlus={() => pas(p.id, 1, p.pasKg)} onValeur={() => setReglage({ produitId: p.id, kg: q })} />
                : plus('Ajouter ' + p.espece, () => pas(p.id, 1, p.pasKg));
            } else if (p.format === 'portion' || p.format === 'lot') {
              const n = app.nombrePanier(e.id, p.id);
              action = n ? <Stepper valeur={String(n)} onMoins={() => app.reglerNombre(e.id, p.id, n - 1)} onPlus={() => app.reglerNombre(e.id, p.id, n + 1)} />
                : plus('Ajouter ' + p.espece + (p.format === 'portion' ? ' en barquette' : ' en lot'), () => app.reglerNombre(e.id, p.id, 1));
            }
          }
          return (
            <View key={p.id} style={{ paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: c.ligne, gap: 10, opacity: dispo ? 1 : 0.5 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ flex: 1, gap: 3 }}>
                  <T tresGras style={{ fontSize: 16 }}>{p.espece}{p.format === 'portion' && p.portion ? ' · ' + p.portion.type.toLowerCase() : ''}</T>
                  <T gris petit>{o.detail}</T>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Prix texte={o.prix} />
                    <T petit style={{ color: !dispo ? c.alerte : c.vert }}>{!dispo ? 'épuisé' : o.reste + ' dispo'}</T>
                  </View>
                </View>
                {action}
              </View>
              {p.format === 'piece' && dispo && !autre ? (
                <View style={{ gap: 6 }}>
                  <T gris petit>Choisissez votre poisson (poids approximatif) :</T>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {(p.pieces ?? []).map((x) => {
                      const pris = app.pieceDansPanier(e.id, p.id, x.id);
                      return <Chip key={x.id} titre={(pris ? '✓ ' : '') + '~' + kg(x.poidsKg) + ' · ≈ ' + euro(x.poidsKg * p.prixKg)} actif={pris} onPress={() => app.basculerPiece(e.id, p.id, x.id)} />;
                    })}
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
        <View style={{ flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: c.ligne }}>
          <IcVerrou couleur={c.gris} taille={18} />
          <T gris petit style={{ flex: 1 }}>L’adresse exacte et la messagerie avec {e.pecheur} s’ouvrent après la réservation.</T>
        </View>
        <ListeAvis etalId={e.id} nombre={e.avis} />
      </ScrollView>
      <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: c.ligne }}>
        <Bouton titre="Voir mon panier" desactive={!nb} onPress={() => router.push('/panier')}
          gauche={<View style={{ backgroundColor: c.accent, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 }}><T tresGras petit>{nb}</T></View>}
          droite={<T tresGras style={{ color: '#fff' }}>env. {euro(nb ? sousTotal(app.e.panier!.lignes) : 0)}</T>} />
      </View>

      <Feuille visible={!!reglage && !!prodReglage} onFermer={() => setReglage(null)} titre={prodReglage?.espece ?? ''}>
        {reglage && prodReglage ? (
          <View style={{ gap: 14 }}>
            <T gris>{euro(prodReglage.prixKg)}/kg · {kg(prodReglage.dispoKg)} disponibles · vous payez le poids réel pesé</T>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
              <Pressable onPress={() => setReglage({ ...reglage, kg: Math.max(0, Math.round((reglage.kg - 0.1) * 10) / 10) })} style={{ width: 76, height: 56, borderRadius: 16, backgroundColor: c.doux, alignItems: 'center', justifyContent: 'center' }}><T tresGras>−100 g</T></Pressable>
              <View style={{ alignItems: 'center', minWidth: 120 }}>
                <T tresGras style={{ fontSize: 40 }}>{kg(reglage.kg)}</T>
                <T gras gris>≈ {euro(reglage.kg * prodReglage.prixKg)}</T>
              </View>
              <Pressable onPress={() => setReglage({ ...reglage, kg: Math.min(prodReglage.dispoKg, Math.round((reglage.kg + 0.1) * 10) / 10) })} style={{ width: 76, height: 56, borderRadius: 16, backgroundColor: c.doux, alignItems: 'center', justifyContent: 'center' }}><T tresGras>+100 g</T></Pressable>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {(pro ? [1, 2, 5, 10, 20] : [0.5, 1, 1.5, 2, 3, 5]).filter((x) => x <= prodReglage.dispoKg).map((x) => <Chip key={x} titre={x < 1 ? '500 g' : kg(x)} actif={Math.abs(reglage.kg - x) < 0.01} onPress={() => setReglage({ ...reglage, kg: x })} />)}
            </View>
            <Bouton titre={reglage.kg > 0 ? 'Valider ' + kg(reglage.kg) : 'Retirer du panier'} onPress={() => { app.reglerKg(e.id, reglage.produitId, reglage.kg); setReglage(null); }} />
          </View>
        ) : null}
      </Feuille>
    </SafeAreaView>
  );
}
