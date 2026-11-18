// « Signaler » dans une conversation : motif, et possibilité de bloquer (plus de messages ni d'appels)
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useApp } from '../store';
import { couleurs as c } from '../theme';
import { Bouton, Feuille, T } from './ui';

const MOTIFS = ['Propos déplacés ou insultants', 'Demande de paiement ou de contact hors de l’appli', 'Commande non honorée', 'Autre problème'];

export function Signaler({ id }: { id: string }) {
  const app = useApp();
  const [ouvert, setOuvert] = useState(false);
  const [motif, setMotif] = useState(MOTIFS[0]);
  const [bloquer, setBloquer] = useState(false);
  const [fait, setFait] = useState(false);
  return (
    <>
      <Pressable accessibilityRole="button" onPress={() => { setFait(false); setOuvert(true); }} style={{ alignSelf: 'center', paddingVertical: 8 }}>
        <T gris petit style={{ textDecorationLine: 'underline' }}>Signaler un problème</T>
      </Pressable>
      <Feuille visible={ouvert} onFermer={() => setOuvert(false)} titre={fait ? 'Merci, c’est noté' : 'Signaler un problème'}>
        {fait ? (
          <View style={{ gap: 12 }}>
            <T>L’équipe Pêche Connect va regarder la conversation.{bloquer ? ' Elle est bloquée : plus de messages ni d’appels.' : ''}</T>
            <Bouton titre="Fermer" onPress={() => setOuvert(false)} />
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {MOTIFS.map((m) => (
              <Pressable key={m} accessibilityRole="radio" accessibilityState={{ selected: motif === m }} onPress={() => setMotif(m)}
                style={{ padding: 14, borderRadius: 12, borderWidth: 1.5, borderColor: motif === m ? c.marine : c.ligne }}>
                <T gras={motif === m}>{m}</T>
              </Pressable>
            ))}
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: bloquer }} onPress={() => setBloquer(!bloquer)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 6 }}>
              <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: c.marine, backgroundColor: bloquer ? c.marine : 'transparent' }} />
              <T style={{ flex: 1 }}>Bloquer aussi cette conversation (plus de messages ni d’appels)</T>
            </Pressable>
            <Bouton titre="Envoyer le signalement" onPress={async () => { if (await app.signaler(id, motif, bloquer)) setFait(true); }} />
          </View>
        )}
      </Feuille>
    </>
  );
}
