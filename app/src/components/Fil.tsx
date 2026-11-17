import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { demarrer, duree as fmtDuree, DUREE_MAX_S, enregistrementPossible, lire, type Enregistrement } from '../audio';
import { heure } from '../format';
import { couleurs as c, polices as f } from '../theme';
import type { Conversation, Role } from '../types';
import { IcEnvoyer, IcMicro, IcVerrou } from './icones';
import { T } from './ui';

// Fil de discussion commun au client et au pêcheur
// Note vocale dans une bulle : lecture / pause et durée
function BulleAudio({ uri, duree, mien }: { uri: string; duree: number; mien: boolean }) {
  const [lecture, setLecture] = useState(false);
  const stop = useRef<(() => void) | null>(null);
  const basculer = async () => {
    if (lecture) { stop.current?.(); setLecture(false); return; }
    setLecture(true);
    try { stop.current = await lire(uri, () => setLecture(false)); } catch { setLecture(false); }
  };
  const couleur = mien ? '#fff' : c.marine;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={(lecture ? 'Arrêter' : 'Écouter') + ' le message vocal'} onPress={basculer}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 170 }}>
      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: mien ? 'rgba(255,255,255,0.2)' : '#fff', alignItems: 'center', justifyContent: 'center' }}>
        <T tresGras style={{ color: couleur, fontSize: 14 }}>{lecture ? '❚❚' : '▶'}</T>
      </View>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        {[6, 12, 9, 15, 7, 13, 10, 5, 11, 8, 14, 6].map((h, i) => <View key={i} style={{ width: 3, height: h, borderRadius: 2, backgroundColor: couleur, opacity: lecture ? 1 : 0.55 }} />)}
      </View>
      <T gras style={{ color: couleur, fontSize: 13 }}>{fmtDuree(duree)}</T>
    </Pressable>
  );
}

export function Fil({ conv, moi, nomAutre, rapides, onEnvoyer, onAudio, onPosition, avant }: {
  conv: Conversation; moi: Role; nomAutre: string; rapides: string[]; onEnvoyer: (t: string) => void;
  onAudio?: (a: Enregistrement) => void;
  onPosition?: (m: { lat: number; lon: number; libelle: string }) => void; avant?: React.ReactNode;
}) {
  const [texte, setTexte] = useState('');
  const [enreg, setEnreg] = useState<{ arreter: () => Promise<Enregistrement | null>; annuler: () => void } | null>(null);
  const [secondes, setSecondes] = useState(0);
  const [alerte, setAlerte] = useState('');
  const ref = useRef<ScrollView>(null);
  const vocal = !!onAudio && enregistrementPossible();

  // Enregistrement : toucher le micro pour commencer, puis envoyer ou annuler
  useEffect(() => {
    if (!enreg) return;
    setSecondes(0);
    const t = setInterval(() => setSecondes((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [enreg]);
  useEffect(() => { if (enreg && secondes >= DUREE_MAX_S) terminer(); }, [secondes]);
  const commencer = async () => {
    setAlerte('');
    try { setEnreg(await demarrer()); } catch (e) { setAlerte(e instanceof Error ? e.message : 'Micro indisponible.'); }
  };
  const terminer = async () => {
    const r = enreg; setEnreg(null); if (!r) return;
    const a = await r.arreter();
    if (a) onAudio?.(a); else setAlerte('Message trop court : gardez le micro au moins une seconde.');
  };
  const annuler = () => { enreg?.annuler(); setEnreg(null); };
  useEffect(() => { setTimeout(() => ref.current?.scrollToEnd({ animated: true }), 50); }, [conv.messages.length]);
  const envoyer = (t: string) => { if (!t.trim()) return; onEnvoyer(t); setTexte(''); };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      {avant}
      <ScrollView ref={ref} contentContainerStyle={{ padding: 16, gap: 10 }}>
        <View style={{ alignSelf: 'center', flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: c.doux, borderRadius: 10, padding: 10, maxWidth: 300 }}>
          <IcVerrou couleur={c.gris} taille={14} />
          <T gris petit style={{ flex: 1, textAlign: 'center' }}>Messagerie ouverte après la réservation. Les numéros restent masqués.</T>
        </View>
        {conv.messages.map((m) => {
          if (m.auteur === 'systeme') return <T key={m.id} gris petit style={{ alignSelf: 'center', textAlign: 'center', backgroundColor: c.doux, padding: 8, borderRadius: 10, overflow: 'hidden' }}>{m.texte}</T>;
          const mien = m.auteur === moi;
          return (
            <View key={m.id} style={{ alignSelf: mien ? 'flex-end' : 'flex-start', maxWidth: '80%', gap: 3, alignItems: mien ? 'flex-end' : 'flex-start' }}>
              {m.position ? (
                <View style={{ width: 250, borderWidth: 1, borderColor: c.ligne, borderRadius: 16, overflow: 'hidden', backgroundColor: '#fff' }}>
                  <View style={{ height: 90, backgroundColor: '#eceeec', alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c.marine, borderWidth: 3, borderColor: '#fff' }} />
                  </View>
                  <View style={{ padding: 10, gap: 8 }}>
                    <T tresGras>Position du pêcheur</T>
                    <T gris petit>{m.position.libelle}</T>
                    {onPosition && !mien ? <Pressable onPress={() => onPosition(m.position!)} style={{ height: 38, borderRadius: 10, backgroundColor: c.marine, alignItems: 'center', justifyContent: 'center' }}><T tresGras style={{ color: '#fff' }}>Y aller</T></Pressable> : null}
                  </View>
                </View>
              ) : (
                <View style={{ backgroundColor: mien ? c.marine : c.doux, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, borderBottomRightRadius: mien ? 4 : 18, borderBottomLeftRadius: mien ? 18 : 4 }}>
                  {m.audio ? <BulleAudio uri={m.audio.uri} duree={m.audio.duree} mien={mien} /> : <T style={{ color: mien ? '#fff' : c.texte }}>{m.texte}</T>}
                </View>
              )}
              <T petit style={{ color: c.grisClair, fontSize: 11 }}>{heure(m.heure)}</T>
            </View>
          );
        })}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 10 }}>
        {rapides.map((r) => <Pressable key={r} onPress={() => envoyer(r)} style={{ borderWidth: 1.5, borderColor: c.marine, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 }}><T gras petit>{r}</T></Pressable>)}
      </ScrollView>
      {alerte ? <T gras petit style={{ color: c.alerte, paddingHorizontal: 16, paddingBottom: 6 }}>{alerte}</T> : null}
      {enreg ? (
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', padding: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: c.ligne }}>
          <Pressable accessibilityLabel="Annuler le message vocal" onPress={annuler} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.doux, alignItems: 'center', justifyContent: 'center' }}>
            <T tresGras style={{ fontSize: 18 }}>✕</T>
          </Pressable>
          <View style={{ flex: 1, height: 44, borderRadius: 22, backgroundColor: c.doux, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.alerte }} />
            <T gras>Enregistrement… {fmtDuree(secondes)}</T>
          </View>
          <Pressable accessibilityLabel="Envoyer le message vocal" onPress={terminer} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.marine, alignItems: 'center', justifyContent: 'center' }}>
            <IcEnvoyer couleur="#fff" />
          </Pressable>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', padding: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: c.ligne }}>
          <TextInput value={texte} onChangeText={setTexte} placeholder={'Écrire à ' + nomAutre + '…'} placeholderTextColor={c.grisClair} onSubmitEditing={() => envoyer(texte)} returnKeyType="send"
            style={{ flex: 1, height: 44, borderRadius: 22, backgroundColor: c.doux, paddingHorizontal: 16, fontSize: 16, fontFamily: f.normal, color: c.texte }} />
          {vocal && !texte.trim() ? (
            <Pressable accessibilityLabel="Enregistrer un message vocal" onPress={commencer} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.marine, alignItems: 'center', justifyContent: 'center' }}>
              <IcMicro couleur="#fff" />
            </Pressable>
          ) : (
            <Pressable accessibilityLabel="Envoyer" onPress={() => envoyer(texte)} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.marine, alignItems: 'center', justifyContent: 'center' }}>
              <IcEnvoyer couleur="#fff" />
            </Pressable>
          )}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
