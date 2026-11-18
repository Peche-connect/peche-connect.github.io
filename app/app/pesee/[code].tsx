import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Bouton, EnTete, Ligne, Stepper, T, Vide } from '../../src/components/ui';
import { euro, kg } from '../../src/format';
import { cleLigne, libelleLigne, montantPaye } from '../../src/formats';
import type { LignePanier } from '../../src/types';
// valeur saisie à la pesée : le poids réel, ou le nombre de lots remis (prix fixe)
const depart = (l: LignePanier) => (l.format === 'lot' ? l.nombre ?? 1 : l.kg);
import { REGLES_ANNULATION } from '../../src/annulation';
import { useApp } from '../../src/store';
import { couleurs as c, polices as f } from '../../src/theme';

// Pesée devant le client : seul le poids réel est encaissé (capture Stripe en production)
export default function Pesee() {
  // « s » : signature lue dans le QR code du client (le pêcheur scanne le QR avec son appareil photo)
  const { code, s: signature } = useLocalSearchParams<{ code: string; s?: string }>();
  const app = useApp();
  const b = app.e.bons.find((x) => x.code === code);
  const [poids, setPoids] = useState<number[]>(b ? b.lignes.map(depart) : []);
  const [qr, setQr] = useState<{ ok: boolean; message: string } | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [pin, setPin] = useState('');
  const preuve = signature || pin;
  useEffect(() => { if (b && poids.length !== b.lignes.length) setPoids(b.lignes.map(depart)); }, [b?.lignes.length]);
  useEffect(() => { if (signature && code) app.verifierQr(code, signature).then(setQr); }, [code, signature]);
  // sans QR : le client dicte son code de retrait (6 chiffres), vérifié par le serveur
  useEffect(() => { if (!signature && code) { if (pin.length === 6) app.verifierQr(code, pin).then(setQr); else setQr(null); } }, [pin]);
  if (app.e.session?.role !== 'pecheur') return <SafeAreaView style={{ flex: 1 }}><EnTete titre="Pesée" /><Vide titre="Réservé au pêcheur" texte="Ce QR code se scanne depuis l’espace pêcheur de Pêche Connect." /></SafeAreaView>;
  if (!b) return <SafeAreaView style={{ flex: 1 }}><EnTete titre="Pesée" /><Vide titre="Bon introuvable" texte={qr && !qr.ok ? qr.message : 'Ce bon n’est pas pour votre étal. Revenez aux réservations.'} /></SafeAreaView>;
  const lignesPesees = b.lignes.map((l, i) => (l.format === 'lot' ? { ...l, nombre: poids[i] ?? l.nombre } : { ...l, kg: poids[i] ?? l.kg }));
  const montant = montantPaye(lignesPesees, b.livraison?.frais ?? 0);
  const trop = montant > b.montantBloque + 0.001;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.fond }}>
      <EnTete titre={'Pesée · ' + b.code} sousTitre={(b.client === 'Vous' ? 'Client démo' : b.client) + ' · ' + b.creneau} />
      <ScrollView>
        {!signature && b.statut !== 'retire' ? (
          <View style={{ margin: 16, marginBottom: 0, gap: 6 }}>
            <T gras>Code de retrait du client</T>
            <TextInput value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" placeholder="6 chiffres (ou scannez son QR)" maxLength={6}
              accessibilityLabel="Code de retrait du client" style={{ borderWidth: 1, borderColor: c.ligne, borderRadius: 12, padding: 12, fontSize: 22, letterSpacing: 4, fontFamily: f.tresGras, color: c.texte }} />
            <T gris petit>Le client le lit sur son bon. Sans QR ni code, la pesée ne peut pas être encaissée.</T>
          </View>
        ) : null}
        {qr ? <View style={{ margin: 16, marginBottom: 0, padding: 12, borderRadius: 12, backgroundColor: qr.ok ? '#dff3ea' : '#fde7dc' }}><T gras style={{ color: qr.ok ? c.vert : c.alerte }}>{qr.ok ? '✓ ' : '✕ '}{qr.message}</T></View> : null}
        {b.statut === 'retire' ? (
          <Vide titre="Vente clôturée" texte={'Encaissé : ' + euro(b.montantPaye ?? 0) + '. Le reste de l’empreinte a été libéré.'} />
        ) : (
          <>
            {b.lignes.map((l, i) => {
              const lot = l.format === 'lot';
              const detail = lot ? 'Prix fixe · ' + euro(l.prixLot ?? 0) + ' le lot (pas de pesée)'
                : 'Réservé ~' + kg(l.kg) + (l.format === 'kilo' || !l.format ? ' · ' + l.preparation.toLowerCase() : '') + ' · ' + euro(l.prixKg + l.supplementKg) + '/kg';
              return (
                <View key={cleLigne(l)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: c.ligne }}>
                  <View style={{ flex: 1 }}><T tresGras style={{ fontSize: 16 }}>{libelleLigne(l)}</T><T gris petit>{detail}</T></View>
                  {lot ? (
                    <Stepper valeur={String(poids[i]) + ' lot' + ((poids[i] ?? 0) > 1 ? 's' : '')} onMoins={() => setPoids((p) => p.map((x, j) => (j === i ? Math.max(0, x - 1) : x)))} onPlus={() => setPoids((p) => p.map((x, j) => (j === i ? Math.min(l.nombre ?? 1, x + 1) : x)))} />
                  ) : (
                    <Stepper valeur={kg(poids[i])} onMoins={() => setPoids((p) => p.map((x, j) => (j === i ? Math.max(0, Math.round((x - 0.1) * 10) / 10) : x)))} onPlus={() => setPoids((p) => p.map((x, j) => (j === i ? Math.round((x + 0.1) * 10) / 10 : x)))} />
                  )}
                </View>
              );
            })}
            <View style={{ padding: 16, gap: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T>Montant bloqué (max)</T><T>{euro(b.montantBloque)}</T></View>
              <Ligne />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T tresGras>À encaisser (réel + frais)</T><T tresGras>{euro(montant)}</T></View>
              {trop ? <T gras style={{ color: c.alerte }}>Au-delà du montant bloqué : retirez un peu de poisson ou demandez au client de valider le supplément.</T> : <T gris petit>Le client voit le poids et le montant s’afficher sur son bon.</T>}
            </View>
          </>
        )}
      </ScrollView>
      {b.statut === 'retire' ? null : (
        <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: c.ligne }}>
          <Bouton titre={envoi ? 'Encaissement…' : poids.every((p) => p === 0) ? 'Annuler : rien à remettre' : 'Valider la pesée · ' + euro(montant)} desactive={trop || envoi || (!poids.every((p) => p === 0) && !qr?.ok)}
            onPress={async () => { setEnvoi(true); const ok = await app.validerPesee(b.code, poids, preuve ?? ''); setEnvoi(false); if (ok) router.canGoBack() ? router.back() : router.replace('/(pecheur)/reservations'); }} />
          {b.statut === 'reserve' ? (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <Bouton clair titre="Plus de poisson" style={{ flex: 1, height: 46 }} desactive={envoi}
                onPress={async () => { if (await app.annulerParPecheur(b.code)) router.replace('/(pecheur)/reservations'); }} />
              <Bouton clair titre="Client absent" style={{ flex: 1, height: 46 }} desactive={envoi}
                onPress={async () => { if (await app.clientAbsent(b.code)) router.replace('/(pecheur)/reservations'); }} />
            </View>
          ) : null}
          {b.statut === 'reserve' ? <T gris petit style={{ marginTop: 6 }}>« Plus de poisson » : rien n’est débité au client. « Client absent » : possible {REGLES_ANNULATION.absentApresMin} min après l’heure limite, {Math.round(REGLES_ANNULATION.penaliteAbsencePct * 100)} % du poisson débité pour vous dédommager (règles provisoires).</T> : null}
        </View>
      )}
    </SafeAreaView>
  );
}
