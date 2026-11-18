import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Bouton, Chip, EnTete, Feuille, Ligne, T, Vide } from '../src/components/ui';
import { euro, FRAIS_LIVRAISON, FRAIS_SERVICE, LIVRAISON_MIN_KG } from '../src/format';
import { cleLigne, libelleLigne, montantBloque, pesable, sousTotal, valeur } from '../src/formats';
import { MODE_DEMO, useApp } from '../src/store';
import { couleurs as c } from '../src/theme';

export default function PanierEcran() {
  const app = useApp();
  const [paiement, setPaiement] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const p = app.e.panier;
  if (!p) return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.fond }}>
      <EnTete titre="Mon panier" fermer />
      <Vide titre="Votre panier est vide" texte="Ouvrez un étal et ajoutez des kilos avec +." action="Voir les étals" onAction={() => router.replace('/(client)')} />
    </SafeAreaView>
  );
  const e = app.etal(p.etalId)!;
  const cren = app.creneaux(e);
  const creneau = app.e.creneau && cren.includes(app.e.creneau) ? app.e.creneau : cren[Math.min(1, cren.length - 1)];
  const pro = app.e.session?.pro;
  const totalKg = p.lignes.reduce((t, l) => t + l.kg, 0);
  const livraisonPossible = !!pro && totalKg >= LIVRAISON_MIN_KG;
  const livrer = livraisonPossible && app.e.livraison;
  const st = sousTotal(p.lignes), bloque = montantBloque(p.lignes, livrer ? FRAIS_LIVRAISON : 0);
  const aPeser = p.lignes.some(pesable);

  const reserver = () => {
    setEnvoi(true);
    // Mode réel : la fonction serveur « creer-reservation » vérifie le panier puis ouvre la page de paiement
    // Stripe (empreinte bancaire) ; au retour, le bon s'affiche.
    setTimeout(async () => {
      const code = await app.reserver();
      setEnvoi(false);
      if (code) router.replace({ pathname: '/bon/[code]', params: { code } });
    }, MODE_DEMO ? 600 : 0);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.fond }}>
      <EnTete titre="Mon panier" sousTitre={'Étal de ' + e.pecheur + ' · ' + e.port} fermer />
      <ScrollView>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, margin: 16, marginBottom: 4, padding: 12, borderRadius: 14, backgroundColor: c.doux }}>
          <Image source={require('../assets/personnage/decoupe.png')} style={{ width: 70, height: 78 }} resizeMode="contain" accessibilityIgnoresInvertColors />
          <T gris style={{ flex: 1 }}>Entier, en tranches ou en filets : le pêcheur prépare votre poisson à la demande.</T>
        </View>
        {p.lignes.map((l) => {
          const pr = e.produits.find((x) => x.id === l.produitId)!;
          const cle = cleLigne(l);
          return (
            <View key={cle} style={{ padding: 16, gap: 8, borderBottomWidth: 1, borderBottomColor: c.ligne }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                <T tresGras style={{ flex: 1 }}>{libelleLigne(l)}</T>
                <T tresGras>{(pesable(l) ? '≈ ' : '') + euro(valeur(l))}</T>
              </View>
              {l.format === 'piece' && pr.teteAuChoix ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Chip titre="Avec la tête" actif={l.tete !== 'sans'} onPress={() => app.choisirTete(cle, 'avec')} />
                  <Chip titre="Sans la tête" actif={l.tete === 'sans'} onPress={() => app.choisirTete(cle, 'sans')} />
                </View>
              ) : null}
              {(l.format === 'kilo' || l.format === 'piece' || !l.format) && pr.preparations.length > 1 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {pr.preparations.map((pp) => <Chip key={pp.nom} titre={pp.nom + (pp.supplementKg ? ' +' + pp.supplementKg + ' €/kg' : '')} actif={l.preparation === pp.nom} onPress={() => app.choisirPreparation(cle, pp.nom)} />)}
                </View>
              ) : <T gris petit>{l.format === 'lot' ? 'Prix fixe, sans pesée' : l.format === 'portion' ? 'Déjà préparé, payé au poids réel' : l.preparation}</T>}
              {l.format === 'piece' ? <T gris petit>Poids approximatif : vous payez le poids réel à la pesée.</T> : null}
            </View>
          );
        })}
        <View style={{ padding: 16, gap: 12 }}>
          <Pressable onPress={() => router.back()}><T tresGras>+ Ajouter d’autres poissons</T></Pressable>
          {pro ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[['Je viens chercher', 'Au port · ' + e.port, false], ['Livraison', livraisonPossible ? 'Par chauffeur · ' + euro(FRAIS_LIVRAISON) : 'Dès ' + LIVRAISON_MIN_KG + ' kg', true]].map(([t, d, v]) => (
                <Pressable key={String(t)} disabled={v === true && !livraisonPossible} onPress={() => app.choisirLivraison(v as boolean)}
                  style={{ flex: 1, borderRadius: 12, padding: 12, borderWidth: livrer === v ? 2 : 1, borderColor: livrer === v ? c.marine : c.ligne, backgroundColor: livrer === v ? c.doux : '#fff', opacity: v === true && !livraisonPossible ? 0.45 : 1 }}>
                  <T tresGras>{String(t)}</T><T gris petit>{String(d)}</T>
                </Pressable>
              ))}
            </View>
          ) : null}
          {livrer ? <T gris petit>Livré à : {pro!.adresse || pro!.raison + ', ' + pro!.commune}</T> : null}
          <T tresGras style={{ fontSize: 16 }}>{livrer ? 'Créneau de livraison' : 'Retrait · ' + e.port}</T>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {cren.map((x) => (
              <Pressable key={x} onPress={() => app.choisirCreneau(x)} style={{ flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: creneau === x ? 2 : 1, borderColor: creneau === x ? c.marine : c.ligne, backgroundColor: creneau === x ? c.doux : '#fff' }}>
                <T gras={creneau !== x} tresGras={creneau === x} petit>{x}</T>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={() => setPaiement(true)} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: c.ligne, borderRadius: 14, padding: 14 }}>
            <View><T tresGras>Paiement</T><T gris petit>{MODE_DEMO ? 'Carte de démonstration (aucun débit)' : 'Carte bancaire ou Apple Pay'}</T></View>
            <T tresGras>Modifier</T>
          </Pressable>
          <View style={{ gap: 6 }}>
            <Ligne2 a={aPeser ? 'Sous-total estimé' : 'Sous-total'} b={euro(st)} />
            <Ligne2 a="Frais de service" b={euro(FRAIS_SERVICE)} />
            {livrer ? <Ligne2 a="Livraison par chauffeur" b={euro(FRAIS_LIVRAISON)} /> : null}
            <Ligne style={{ marginVertical: 4 }} />
            <Ligne2 a="Montant bloqué sur la carte" b={euro(bloque)} fort />
            <T gris petit>{aPeser ? 'Vous ne payez que le poids réel, pesé devant vous au retrait. Le reste est libéré aussitôt.' : 'Lots à prix fixe : ce montant sera encaissé au retrait.'}</T>
          </View>
        </View>
      </ScrollView>
      <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: c.ligne }}>
        <Bouton titre={envoi ? 'Paiement en cours…' : 'Réserver et payer'} desactive={envoi} onPress={() => { app.choisirCreneau(creneau); reserver(); }} />
      </View>
      <Feuille visible={paiement} onFermer={() => setPaiement(false)} titre="Moyen de paiement">
        <T gris style={{ marginBottom: 10 }}>{MODE_DEMO ? 'En mode démo, aucun paiement réel n’est fait.' : 'Le paiement est sécurisé par Stripe.'}</T>
        <Bouton titre="Fermer" onPress={() => setPaiement(false)} />
      </Feuille>
    </SafeAreaView>
  );
}

function Ligne2({ a, b, fort }: { a: string; b: string; fort?: boolean }) {
  return <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T tresGras={fort}>{a}</T><T tresGras={fort}>{b}</T></View>;
}
