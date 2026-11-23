import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IcCarte } from '../../src/components/icones';
import { Itineraire } from '../../src/components/Itineraire';
import { QR } from '../../src/components/QR';
import { Suivi } from '../../src/components/Suivi';
import { Bouton, EnTete, Feuille, Ligne, Pastille, T, Vide } from '../../src/components/ui';
import { PORTS } from '../../src/data/demo';
import { detailTva, euro, kg, TVA_PRODUITS_MER } from '../../src/format';
import { cleLigne, libelleLigne, preparationLigne, quantiteLigne } from '../../src/formats';
import { NoterAchat } from '../../src/components/Avis';
import { texteRegles } from '../../src/annulation';
import { mentionsObligatoires } from '../../src/data/especes';
import { MODE_DEMO, useApp } from '../../src/store';
import { couleurs as c } from '../../src/theme';

export default function BonEcran() {
  const { code, paye } = useLocalSearchParams<{ code: string; paye?: string }>();
  const app = useApp();
  const [iti, setIti] = useState(false);
  const [annuler, setAnnuler] = useState(false);
  const [qr, setQr] = useState({ lien: '', pin: '' });
  const b = app.e.bons.find((x) => x.code === code);
  const statut = b?.statut;
  useEffect(() => { if (b && statut === 'reserve') app.lienQr(b.code).then(setQr); }, [code, statut]);
  // retour de la page de paiement : le serveur confirme en quelques secondes
  useEffect(() => { if (!MODE_DEMO && paye && (!b || statut === 'a_payer')) { const t = setInterval(app.recharger, 2500); return () => clearInterval(t); } }, [paye, statut, !!b]);
  if (!b) return <SafeAreaView style={{ flex: 1 }}><EnTete titre="Bon de retrait" fermer /><Vide titre={paye ? 'Paiement en cours de confirmation…' : 'Bon introuvable'} texte={paye ? 'Votre bon s’affiche dans quelques secondes.' : 'Retrouvez vos réservations dans « Mes bons ».'} /></SafeAreaView>;
  const e = app.etal(b.etalId);
  if (!e) return <SafeAreaView style={{ flex: 1 }}><EnTete titre={'Bon ' + b.code} fermer /><Vide titre="Étal indisponible" texte="Ce pêcheur n’est plus sur Pêche Connect. Votre bon reste dans « Mes bons »." /></SafeAreaView>;
  const p = PORTS[e.port] ?? PORTS['Le Robert'];
  const retire = b.statut === 'retire';
  if (b.statut === 'annule') return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.fond }}>
      <EnTete titre={'Bon ' + b.code} sousTitre="Réservation annulée" fermer />
      <View style={{ padding: 16, gap: 10 }}>
        <T tresGras style={{ fontSize: 18 }}>Cette réservation est annulée.</T>
        <T>{b.montantPaye ? euro(b.montantPaye) + ' ont été débités (client absent, règles d’annulation). Le reste de l’empreinte bancaire est libéré.' : 'Rien ne vous a été débité.'}</T>
        <Suivi code={b.code} statut={b.statut} />
      </View>
    </SafeAreaView>
  );
  if (b.statut === 'a_payer') return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.fond }}>
      <EnTete titre={'Commande ' + b.code} sousTitre={'Étal de ' + e.pecheur + ' · ' + e.port} fermer />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <T tresGras style={{ fontSize: 20 }}>{paye ? 'Paiement en cours de confirmation…' : 'À régler pour confirmer'}</T>
        {b.lignes.map((l, i) => <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}><T style={{ flex: 1 }}>{libelleLigne(l)}</T><T tresGras>{quantiteLigne(l, false)}</T></View>)}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T gris>Montant bloqué (max)</T><T tresGras>{euro(b.montantBloque)}</T></View>
        {b.origine === 'sortie' ? <T gras>Réservé avant la sortie : le pêcheur est rentré, votre part est mise de côté. Payez dans l’heure pour la garder.</T> : null}
        <T gris>Comme pour une réservation, seul le poids réel est débité à la pesée.</T>
        {paye ? null : <Bouton titre={'Payer ' + euro(b.montantBloque) + ' max'} onPress={() => app.payerBon(b.code)} />}
        <T gris petit>La messagerie avec le pêcheur s’ouvre une fois la commande réglée.</T>
        {retire ? <NoterAchat code={b.code} deja={b.avis} /> : null}
        <Suivi code={b.code} statut={b.statut} />
      </ScrollView>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.fond }}>
      <EnTete titre="Votre bon de retrait" sousTitre="Réservation confirmée · payée" fermer />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {retire ? null : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 12 }}>
            <Image source={require('../../assets/personnage/pouce.png')} style={{ width: 70, height: 90 }} resizeMode="contain" accessibilityIgnoresInvertColors />
            <View style={{ flex: 1, gap: 2 }}><T tresGras style={{ fontSize: 18 }}>C’est réservé !</T><T gris>Montrez ce code au pêcheur au moment du retrait.</T></View>
          </View>
        )}
        <View style={{ margin: 16, marginBottom: 0, borderWidth: 1, borderColor: c.ligne, borderRadius: 16, padding: 18, gap: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ gap: 6 }}>
              <T gras gris petit style={{ letterSpacing: 1 }}>CODE À DONNER</T>
              <T tresGras style={{ fontSize: 50, letterSpacing: -1 }}>{b.code}</T>
              <Pastille texte={'Aujourd’hui · ' + b.creneau} />
            </View>
            {retire ? null : <QR contenu={qr.lien} />}
          </View>
          {!retire && qr.pin ? <T gris>Si le QR ne passe pas, dites au pêcheur votre code de retrait : <T tresGras style={{ color: c.texte, letterSpacing: 2 }}>{qr.pin.slice(0, 3) + ' ' + qr.pin.slice(3)}</T>. Ne le donnez qu’au moment de la pesée.</T> : null}
          <Pastille texte={retire ? 'Retiré · payé ' + euro(b.montantPaye ?? 0) : 'À retirer · en attente de pesée'} style={retire ? { backgroundColor: '#dff3ea' } : { backgroundColor: c.doux }} />
          <Ligne />
          {b.lignes.map((l) => <View key={cleLigne(l)} style={{ gap: 2 }}><View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}><T style={{ flex: 1 }}>{libelleLigne(l)}{preparationLigne(l) ? ', ' + preparationLigne(l) : ''}</T><T tresGras>{quantiteLigne(l, retire)}</T></View><T gris style={{ fontSize: 12 }}>{mentionsObligatoires(l.espece, l.engin)}</T></View>)}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T gris>{retire ? 'Payé (poids réel)' : 'Montant bloqué'}</T><T tresGras>{retire ? euro(b.montantPaye ?? 0) : euro(b.montantBloque) + ' max'}</T></View>
          {b.rembourse ? <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T gris>Remboursé</T><T tresGras style={{ color: c.vert }}>{euro(b.rembourse)}</T></View> : null}
        </View>
        {b.pro ? (() => {
          const ttc = retire ? b.montantPaye ?? 0 : b.montantBloque; const t = detailTva(ttc);
          return (
            <View style={{ margin: 16, marginBottom: 0, borderRadius: 16, backgroundColor: c.doux, padding: 16, gap: 6 }}>
              <T tresGras style={{ fontSize: 16 }}>{retire ? 'Facture ' + (b.facture ?? '(en préparation)') : 'Facture (estimation) · ' + b.code}</T>
              <T>{b.pro.raison}</T>
              <T gris petit>SIRET {b.pro.siret.replace(/(\d{3})(\d{3})(\d{3})(\d{5})/, '$1 $2 $3 $4')} · {b.pro.commune}</T>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}><T>Montant HT</T><T>{euro(t.ht)}</T></View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T>TVA {(TVA_PRODUITS_MER * 100).toFixed(1).replace('.', ',')} %</T><T>{euro(t.tva)}</T></View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T tresGras>Total TTC</T><T tresGras>{euro(t.ttc)}</T></View>
              {retire && b.facture ? <Bouton clair titre="Télécharger la facture (PDF)" style={{ marginTop: 6, height: 46 }} onPress={() => app.ouvrirFacture(b.facture!)} /> : null}
              <T gris petit>{retire ? 'Facture numérotée, gardée 10 ans, dans « Mon compte » aussi.' : 'La facture définitive est établie au poids réel.'} Taux de TVA à confirmer avec le comptable.</T>
            </View>
          );
        })() : null}
        {b.livraison ? (
          <View style={{ flexDirection: 'row', gap: 12, padding: 16 }}>
            <IcCarte />
            <View style={{ flex: 1, gap: 2 }}>
              <T tresGras style={{ fontSize: 16 }}>Livraison par chauffeur</T>
              <T gris>{b.livraison.adresse} · {b.creneau.toLowerCase()} · frais {euro(b.livraison.frais)}</T>
              <T gris petit>Le chauffeur récupère votre commande chez {e.pecheur} ({e.port}) et vous la livre. Vous serez prévenu à son départ.</T>
            </View>
          </View>
        ) : (
        <View style={{ flexDirection: 'row', gap: 12, padding: 16 }}>
          <IcCarte />
          <View style={{ flex: 1, gap: 2 }}>
            <T tresGras style={{ fontSize: 16 }}>{e.lieu ?? 'Adresse affichée après confirmation du paiement'}</T>
            <T gris>{e.pecheur} · {e.precision}</T>
          </View>
        </View>
        )}
        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16 }}>
          {b.livraison ? null : <Bouton titre="Itinéraire" style={{ flex: 1, height: 50 }} onPress={() => setIti(true)} />}
          <Bouton titre="Message" clair style={{ flex: 1, height: 50 }} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: e.id + '|Vous' } })} />
        </View>
        {b.statut === 'reserve' ? (
          <Pressable onPress={() => setAnnuler(true)} accessibilityRole="button" style={{ marginHorizontal: 16, marginTop: 12 }}><T gris style={{ textDecorationLine: 'underline' }}>Annuler ma réservation</T></Pressable>
        ) : null}
        <Suivi code={b.code} statut={b.statut} />
        <T gris style={{ margin: 16 }}>{e.pecheur} pèse votre poisson devant vous et valide le bon. Seul le poids réel est débité ; le reste est libéré tout de suite.</T>
      </ScrollView>
      <Feuille visible={annuler} onFermer={() => setAnnuler(false)} titre="Annuler la réservation ?">
        {texteRegles().map((t) => <T key={t} gris style={{ marginBottom: 6 }}>• {t}</T>)}
        <Bouton titre="Oui, annuler (rien n’est débité)" style={{ marginTop: 8, backgroundColor: c.alerte }} onPress={async () => { const ok = await app.annulerParClient(b.code); setAnnuler(false); if (ok) router.replace('/(client)/bons'); }} />
        <Bouton clair titre="Garder ma réservation" style={{ marginTop: 8 }} onPress={() => setAnnuler(false)} />
      </Feuille>
      <Itineraire visible={iti} onFermer={() => setIti(false)} lieu={e.lieu ?? e.port} lat={p.lat} lon={p.lon} />
    </SafeAreaView>
  );
}
