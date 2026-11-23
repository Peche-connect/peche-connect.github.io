import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useApp } from '../store';
import { couleurs as c, polices as f } from '../theme';
import type { Avis } from '../types';
import { Bouton, T } from './ui';

const etoiles = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
const date = (iso: string) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : '');

// Après le retrait : le client note son achat (une seule fois par bon)
export function NoterAchat({ code, deja }: { code: string; deja?: number }) {
  const app = useApp();
  const [note, setNote] = useState(0);
  const [texte, setTexte] = useState('');
  const [envoi, setEnvoi] = useState(false);
  if (deja) return <View style={{ padding: 14, borderRadius: 14, backgroundColor: c.doux }}><T>Merci pour votre avis : <T tresGras>{etoiles(deja)}</T></T></View>;
  return (
    <View style={{ padding: 14, borderRadius: 14, borderWidth: 1, borderColor: c.ligne, gap: 10 }}>
      <T tresGras style={{ fontSize: 16 }}>Votre avis sur cet achat</T>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} onPress={() => setNote(n)} accessibilityRole="button" accessibilityLabel={n + ' étoile' + (n > 1 ? 's' : '')} hitSlop={6}>
            <T style={{ fontSize: 34, color: n <= note ? c.marine : c.ligne }}>★</T>
          </Pressable>
        ))}
      </View>
      <TextInput value={texte} onChangeText={setTexte} maxLength={300} multiline placeholder="Fraîcheur, accueil, découpe… (facultatif)" accessibilityLabel="Commentaire"
        style={{ minHeight: 70, borderWidth: 1, borderColor: c.ligne, borderRadius: 12, padding: 12, fontFamily: f.normal, color: c.texte, textAlignVertical: 'top' }} />
      <T gris petit>Votre prénom, la note et le commentaire seront visibles sur l’étal. Les numéros de téléphone sont masqués.</T>
      <Bouton titre="Envoyer mon avis" desactive={!note || envoi} onPress={async () => { setEnvoi(true); await app.laisserAvis(code, note, texte); setEnvoi(false); }} />
    </View>
  );
}

// Sur l'étal : les derniers avis des clients
export function ListeAvis({ etalId, nombre }: { etalId: string; nombre: number }) {
  const app = useApp();
  const [liste, setListe] = useState<Avis[] | null>(null);
  useEffect(() => { let actif = true; app.avisEtal(etalId).then((l) => actif && setListe(l)); return () => { actif = false; }; }, [etalId, nombre]);
  if (!liste) return null;
  return (
    <View style={{ padding: 16, gap: 10, borderTopWidth: 1, borderTopColor: c.ligne }}>
      <T tresGras style={{ fontSize: 17 }}>Avis des clients</T>
      {liste.length ? liste.map((a) => (
        <View key={a.code} style={{ gap: 2 }}>
          <T><T tresGras>{a.prenom}</T> · <T style={{ color: c.marine }}>{etoiles(a.note)}</T></T>
          <T gris petit>Achat vérifié{a.achatLe ? ' du ' + date(a.achatLe) : ''} · avis publié le {date(a.le)}</T>
          {a.commentaire ? <T gris>{a.commentaire}</T> : null}
        </View>
      )) : <T gris>Pas encore d’avis.</T>}
      <T gris petit>Seuls les clients qui ont retiré et payé leur poisson peuvent donner un avis, une fois par achat. Avis non modérés avant publication ; retirés seulement s’ils sont injurieux ou hors sujet.</T>
    </View>
  );
}
