import AsyncStorage from '@react-native-async-storage/async-storage';
import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LiensLegaux } from '../src/components/LiensLegaux';
import { Bouton, Logo, T } from '../src/components/ui';
import * as B from '../src/services/backend';
import { CODE_SMS_DEMO, MODE_DEMO, useApp } from '../src/store';
import { couleurs as c, polices as f } from '../src/theme';
import type { Role } from '../src/types';

type Choix = Role | 'pro';
const EN_ATTENTE = 'peche-connect-inscription'; // rôle et prénom choisis avant de partir chez Google

// Connexion : en démo, numéro + code 123456. En mode réel : Google et/ou code par SMS (Supabase Auth),
// puis choix du rôle et du prénom à la première connexion.
export default function Connexion() {
  const app = useApp();
  const [role, setRole] = useState<Choix>('client');
  const [tel, setTel] = useState('');
  const [prenom, setPrenom] = useState('');
  const [etape, setEtape] = useState<'numero' | 'code'>('numero');
  const [code, setCode] = useState('');
  const [erreur, setErreur] = useState('');
  const [occupe, setOccupe] = useState(false);
  const chiffres = tel.replace(/\D/g, '');
  const numeroOk = chiffres.length >= 10;
  const smsActif = MODE_DEMO || B.CONNEXION_SMS;
  const googleActif = !MODE_DEMO && B.CONNEXION_GOOGLE;

  // retour de Google : on retrouve le rôle et le prénom choisis avant de partir
  useEffect(() => {
    AsyncStorage.getItem(EN_ATTENTE).then((v) => { if (v) { try { const x = JSON.parse(v); setRole(x.role); setPrenom(x.prenom ?? ''); } catch { /* ignoré */ } } });
  }, []);

  if (!MODE_DEMO && app.e.session) return <Redirect href="/" />;

  // Après connexion (Google ou SMS) : enregistre le profil puis ouvre le bon espace
  const continuer = async (r: Choix = role, p: string = prenom) => {
    setOccupe(true); setErreur('');
    await AsyncStorage.removeItem(EN_ATTENTE);
    if (r === 'pecheur') { router.replace({ pathname: '/inscription-pecheur', params: { tel: chiffres } }); return; }
    if (r === 'pro') { router.replace({ pathname: '/inscription-pro', params: { tel: chiffres } }); return; }
    await app.connecter(chiffres, 'client', p.trim() || 'Client');
    setOccupe(false);
    router.replace('/(client)');
  };

  const envoyerCode = async () => {
    setErreur('');
    if (!MODE_DEMO) { setOccupe(true); try { await B.envoyerCodeSms(tel); } catch (err) { setErreur((err as Error).message); setOccupe(false); return; } setOccupe(false); }
    setEtape('code');
  };
  const valider = async () => {
    if (MODE_DEMO) {
      if (code !== CODE_SMS_DEMO) { setErreur('Code incorrect. Vérifiez le SMS reçu (démo : ' + CODE_SMS_DEMO + ').'); return; }
      return continuer();
    }
    setOccupe(true);
    try { await B.verifierCodeSms(tel, code); } catch (err) { setErreur((err as Error).message); setOccupe(false); return; }
    const r = await app.recharger();
    setOccupe(false);
    if (r && !r.session) await continuer();
  };
  const google = async () => {
    setErreur(''); setOccupe(true);
    await AsyncStorage.setItem(EN_ATTENTE, JSON.stringify({ role, prenom }));
    try { await B.connexionGoogle(); const r = await app.recharger(); if (r && !r.session && r.profilIncomplet) await continuer(); } catch (err) { setErreur((err as Error).message); }
    setOccupe(false);
  };

  const choixRole = (
    <>
      <View style={st.bascule} accessibilityRole="radiogroup">
        {([['client', 'Particulier'], ['pro', 'Professionnel'], ['pecheur', 'Pêcheur']] as const).map(([r, libelle]) => (
          <Pressable key={r} accessibilityRole="radio" accessibilityState={{ checked: role === r }} onPress={() => setRole(r)} style={[st.choix, role === r && { backgroundColor: c.marine }]}>
            <T tresGras style={{ color: role === r ? c.surMarine : c.texte, fontSize: 14 }}>{libelle}</T>
          </Pressable>
        ))}
      </View>
      {role === 'pro' ? <T gris petit style={{ marginTop: -12 }}>Restaurant, poissonnerie, revendeur, traiteur : achats en volume et factures pour votre comptabilité.</T> : null}
      {role === 'client' ? (
        <View style={{ gap: 6 }}>
          <T gras>Votre prénom</T>
          <TextInput value={prenom} onChangeText={setPrenom} placeholder="Ex. Sophie" style={st.champ} autoComplete="given-name" />
        </View>
      ) : null}
    </>
  );

  const entete = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 8 }}>
      <Logo taille={44} />
      <T tresGras style={{ fontSize: 17, lineHeight: 23 }}>Réservez.{'\n'}Payez.{'\n'}Récupérez.</T>
    </View>
  );

  // Connecté mais profil pas encore rempli (première connexion)
  if (!MODE_DEMO && app.e.profilIncomplet) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.fond }}>
        <ScrollView contentContainerStyle={{ padding: 24, gap: 22 }} keyboardShouldPersistTaps="handled">
          {entete}
          <View style={{ gap: 6 }}>
            <T tresGras style={{ fontSize: 24 }}>Encore une étape</T>
            <T gris>Dites-nous qui vous êtes pour ouvrir le bon espace.</T>
          </View>
          {choixRole}
          {erreur ? <T style={{ color: c.alerte }} gras>{erreur}</T> : null}
          <Bouton titre={occupe ? 'Un instant…' : 'Continuer'} desactive={occupe || (role === 'client' && !prenom.trim())} onPress={() => continuer()} />
          <Pressable onPress={() => app.deconnecter()}><T gras style={{ textAlign: 'center', textDecorationLine: 'underline' }}>Changer de compte</T></Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.fond }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, gap: 22 }} keyboardShouldPersistTaps="handled">
        {entete}

        {etape === 'numero' ? (
          <>
            <Image source={require('../assets/ambiance/yoles.jpg')} style={{ width: '100%', height: 170, borderRadius: 16 }} resizeMode="cover" accessibilityLabel="Yoles de pêcheurs sur la plage" />
            <View style={{ gap: 6 }}>
              <T tresGras style={{ fontSize: 24 }}>Bienvenue</T>
              <T gris>Le poisson du jour des pêcheurs de Martinique, réservé en quelques secondes.</T>
            </View>
            {choixRole}
            {googleActif ? (
              <Pressable accessibilityRole="button" onPress={google} disabled={occupe || (role === 'client' && !prenom.trim())}
                style={[st.google, (occupe || (role === 'client' && !prenom.trim())) && { opacity: 0.4 }]}>
                <T tresGras style={{ fontSize: 18, color: '#4285F4' }}>G</T>
                <T tresGras style={{ fontSize: 16 }}>Continuer avec Google</T>
              </Pressable>
            ) : null}
            {googleActif && smsActif ? <T gris petit style={{ textAlign: 'center' }}>ou</T> : null}
            {smsActif ? (
              <>
                <View style={{ gap: 6 }}>
                  <T gras>Votre numéro de téléphone</T>
                  <TextInput value={tel} onChangeText={setTel} placeholder="0696 12 34 56" keyboardType="phone-pad" style={st.champ} autoComplete="tel" />
                  <T gris petit>Nous vous envoyons un code par SMS. Votre numéro n’est jamais montré aux autres utilisateurs.</T>
                </View>
                <Bouton titre={occupe ? 'Envoi…' : 'Recevoir le code'} onPress={envoyerCode} desactive={!numeroOk || occupe || (role === 'client' && !prenom.trim() && !MODE_DEMO)} />
              </>
            ) : null}
            {erreur ? <T style={{ color: c.alerte }} gras>{erreur}</T> : null}
            <T gris petit style={{ textAlign: 'center' }}>En continuant, vous acceptez les conditions générales et la politique de confidentialité.</T>
            <LiensLegaux centre />
          </>
        ) : (
          <>
            <View style={{ gap: 6 }}>
              <T tresGras style={{ fontSize: 24 }}>Code reçu par SMS</T>
              <T gris>Envoyé au {tel}. {MODE_DEMO ? 'Démo : tapez ' + CODE_SMS_DEMO + '.' : ''}</T>
            </View>
            <TextInput value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" keyboardType="number-pad" style={[st.champ, st.code]} autoComplete="sms-otp" textContentType="oneTimeCode" maxLength={6} />
            {erreur ? <T style={{ color: c.alerte }} gras>{erreur}</T> : null}
            <Bouton titre={occupe ? 'Vérification…' : 'Valider'} onPress={valider} desactive={code.length !== 6 || occupe} />
            <Pressable onPress={() => { setEtape('numero'); setCode(''); setErreur(''); }}><T gras style={{ textAlign: 'center', textDecorationLine: 'underline' }}>Changer de numéro</T></Pressable>
          </>
        )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  bascule: { flexDirection: 'row', backgroundColor: c.doux, borderRadius: 999, padding: 4, gap: 4 },
  choix: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 999 },
  champ: { height: 52, borderRadius: 12, backgroundColor: c.doux, paddingHorizontal: 16, fontSize: 17, fontFamily: f.gras, color: c.texte },
  code: { fontSize: 28, letterSpacing: 10, textAlign: 'center' },
  google: { height: 54, borderRadius: 13, borderWidth: 1.5, borderColor: c.ligne, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#fff' },
});
