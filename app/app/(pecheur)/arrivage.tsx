import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IcCompte, IcPhoto } from '../../src/components/icones';
import { Bouton, Chip, Feuille, Logo, Rond, Stepper, T } from '../../src/components/ui';
import { ESPECES } from '../../src/data/demo';
import { fermeture } from '../../src/data/fermetures';
import { euro, heure, kg } from '../../src/format';
import { changer as changerTaille, useEchelle } from '../../src/taille';
import { ENGINS, enginDefaut } from '../../src/data/especes';
import { partagerAutre, partagerImage, partagerWhatsApp } from '../../src/partage';
import { disponible, NOMS_FORMATS, produitParDefaut, stockKg } from '../../src/formats';
import type { Format, Produit, TypePortion } from '../../src/types';
import { useApp } from '../../src/store';
import { couleurs as c } from '../../src/theme';

type L = Omit<Produit, 'id'>;
const r1 = (n: number) => Math.round(n * 10) / 10;
let n = 0; const nouvelId = () => 'n' + Date.now().toString(36) + (n++);

// Petit réglage − valeur + (prix, poids, nombre)
function Reglage({ valeur, onMoins, onPlus, label }: { valeur: string; onMoins: () => void; onPlus: () => void; label: string }) {
  const b = { width: 30, height: 30, borderRadius: 6, backgroundColor: c.doux, alignItems: 'center', justifyContent: 'center' } as const;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', borderWidth: 1, borderColor: c.ligne, borderRadius: 8, padding: 2, gap: 4 }}>
      <Pressable accessibilityLabel={'Baisser ' + label} onPress={onMoins} style={b}><T tresGras>−</T></Pressable>
      <T tresGras style={{ minWidth: 70, textAlign: 'center' }}>{valeur}</T>
      <Pressable accessibilityLabel={'Monter ' + label} onPress={onPlus} style={b}><T tresGras>+</T></Pressable>
    </View>
  );
}

// Publier l'arrivage en moins d'une minute : prix et quantités d'hier pré-remplis
export default function Arrivage() {
  const echelle = useEchelle();
  const app = useApp();
  const s = app.e.session!;
  const e = app.etal(s.etalId)!;
  const [lignes, setLignes] = useState<L[]>([]);
  const [ajout, setAjout] = useState(false);
  const [enginDe, setEnginDe] = useState<number | null>(null);
  const [partage, setPartage] = useState(''); // ligne dont on choisit l'engin de pêche
  const [publie, setPublie] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [photo, setPhoto] = useState<{ uri: string; type?: string } | null>(null);
  const [info, setInfo] = useState('');
  // prix et quantités d'hier ; les poissons à la pièce déjà vendus ne reviennent pas
  useEffect(() => { setLignes(e.produits.map(({ id: _id, ...p }) => JSON.parse(JSON.stringify(p)))); }, [e.id]);
  const vide = (l: L) => (l.format === 'piece' ? !(l.pieces ?? []).length : l.format === 'portion' ? !l.portion?.nombre : l.format === 'lot' ? !l.lot?.nombre : !l.dispoKg);
  const total = lignes.reduce((t, l) => t + stockKg({ ...l, id: '' }), 0);
  const enVente = lignes.filter((l) => !vide(l)).length;
  const doublon = lignes.some((l, i) => lignes.some((m, j) => j < i && m.espece === l.espece && m.format === l.format && (l.format !== 'portion' || m.portion?.type === l.portion?.type)));
  const changerFormat = (i: number, f: Format) => maj(i, (x) => (x.format === f ? x : { ...produitParDefaut(x.espece, f), ...(f !== 'lot' && x.format !== 'lot' ? { prixKg: f === 'portion' && x.format !== 'portion' ? x.prixKg + 5 : x.format === 'portion' && f !== 'portion' ? Math.max(1, x.prixKg - 5) : x.prixKg } : {}) }));
  const aPreparer = app.bonsPecheur(s.etalId).filter((b) => b.statut === 'reserve').length;
  const maj = (i: number, f: (l: L) => L) => setLignes((ls) => ls.map((l, j) => (j === i ? f(l) : l)));

  // Photo de la pêche : appareil photo du téléphone (ou galerie)
  const prendrePhoto = async () => {
    const IP = await import('expo-image-picker');
    if (Platform.OS !== 'web') { const p = await IP.requestCameraPermissionsAsync(); if (!p.granted) { setInfo('Autorisez l’appareil photo dans les réglages du téléphone.'); return; } }
    const r = await IP.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6, allowsEditing: true, aspect: [4, 3] }).catch(() => IP.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 }));
    if (!r.canceled && r.assets[0]) setPhoto({ uri: r.assets[0].uri, type: r.assets[0].mimeType ?? 'image/jpeg' });
  };


  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.fond }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 10, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Logo /><T gris>Bonjou {s.prenom}</T></View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Chip titre={aPreparer + ' à préparer'} onPress={() => router.navigate('/(pecheur)/reservations')} style={{ backgroundColor: c.accent, minHeight: 34 }} />
            <Rond label={echelle > 1 ? 'Texte normal' : 'Texte plus gros'} onPress={() => changerTaille(echelle > 1 ? 1 : 1.4)}><T tresGras style={{ fontSize: 15 / echelle }}>{echelle > 1 ? 'A−' : 'A+'}</T></Rond>
            <Rond label="Mon compte" onPress={() => router.push('/compte')}><IcCompte /></Rond>
          </View>
        </View>
        <T tresGras style={{ fontSize: 26 }}>Votre arrivage du jour</T>
        <T gris>{e.port} · retrait jusqu’à <T tresGras>{heure(e.limiteRetrait)}</T></T>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 4 }}>
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 6 }}>
          <Pressable onPress={prendrePhoto} style={{ flex: 1, minHeight: 70, borderRadius: 14, backgroundColor: c.doux, alignItems: 'center', justifyContent: 'center', gap: 6, overflow: 'hidden' }}>
            {photo ? <Image source={{ uri: photo.uri }} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: 0.35 }} resizeMode="cover" /> : null}
            <IcPhoto /><T gras>{photo ? 'Photo ajoutée ✓' : 'Photo de la pêche'}</T>
          </Pressable>
        </View>
        {info ? <T gras style={{ color: c.marine, marginBottom: 4 }}>{info}</T> : null}
        {lignes.map((l, i) => (
          <View key={i} style={{ gap: 10, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.ligne }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <T tresGras style={{ fontSize: 17 }}>{l.espece}</T>
              <Pressable accessibilityLabel={'Retirer ' + l.espece} onPress={() => setLignes((ls) => ls.filter((_, j) => j !== i))}><T gris>Retirer</T></Pressable>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {(Object.keys(NOMS_FORMATS) as Format[]).map((f) => <Chip key={f} titre={NOMS_FORMATS[f]} actif={l.format === f} onPress={() => changerFormat(i, f)} />)}
            </View>
            <Pressable onPress={() => setEnginDe(i)} accessibilityRole="button" accessibilityLabel={'Engin de pêche pour ' + l.espece}>
              <T gris petit>Pêché avec : <T gras petit>{(l.engin || enginDefaut(l.espece)).toLowerCase()}</T> · <T gras petit style={{ color: c.marine }}>changer</T></T>
            </Pressable>
            {l.format !== 'lot' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <T gris style={{ width: 92 }}>Prix au kilo</T>
                <Reglage label="le prix" valeur={euro(l.prixKg) + '/kg'} onMoins={() => maj(i, (x) => ({ ...x, prixKg: Math.max(1, x.prixKg - 0.5) }))} onPlus={() => maj(i, (x) => ({ ...x, prixKg: x.prixKg + 0.5 }))} />
              </View>
            ) : null}
            {l.format === 'kilo' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <T gris style={{ width: 92 }}>Quantité</T>
                <Stepper valeur={kg(l.dispoKg)} onMoins={() => maj(i, (x) => ({ ...x, dispoKg: Math.max(0, x.dispoKg - 1) }))} onPlus={() => maj(i, (x) => ({ ...x, dispoKg: x.dispoKg + 1 }))} />
              </View>
            ) : null}
            {l.format === 'piece' ? (
              <View style={{ gap: 8 }}>
                <T gris>Vos poissons (poids approximatif) :</T>
                {(l.pieces ?? []).map((q, k) => (
                  <View key={q.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <T gras style={{ width: 92 }}>Poisson {k + 1}</T>
                    <Reglage label={'le poids du poisson ' + (k + 1)} valeur={'~' + kg(q.poidsKg)}
                      onMoins={() => maj(i, (x) => ({ ...x, pieces: x.pieces!.map((y) => (y.id === q.id ? { ...y, poidsKg: Math.max(0.2, r1(y.poidsKg - 0.2)) } : y)) }))}
                      onPlus={() => maj(i, (x) => ({ ...x, pieces: x.pieces!.map((y) => (y.id === q.id ? { ...y, poidsKg: r1(y.poidsKg + 0.2) } : y)) }))} />
                    <Pressable accessibilityLabel={'Enlever le poisson ' + (k + 1)} onPress={() => maj(i, (x) => ({ ...x, pieces: x.pieces!.filter((y) => y.id !== q.id) }))}><T gris>✕</T></Pressable>
                  </View>
                ))}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Chip titre="+ Ajouter un poisson" onPress={() => maj(i, (x) => ({ ...x, pieces: [...(x.pieces ?? []), { id: nouvelId(), poidsKg: x.pieces?.length ? x.pieces[x.pieces.length - 1].poidsKg : 3 }] }))} />
                  {l.espece !== 'Langouste' ? <Chip titre={l.teteAuChoix ? '✓ Tête au choix du client' : 'Tête au choix du client'} actif={!!l.teteAuChoix} onPress={() => maj(i, (x) => ({ ...x, teteAuChoix: !x.teteAuChoix }))} /> : null}
                </View>
              </View>
            ) : null}
            {l.format === 'portion' && l.portion ? (
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {(['Filets', 'Darnes', 'Tranches'] as TypePortion[]).map((t) => <Chip key={t} titre={t} actif={l.portion!.type === t} onPress={() => maj(i, (x) => ({ ...x, portion: { ...x.portion!, type: t } }))} />)}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <T gris style={{ width: 92 }}>Barquette</T>
                  <Reglage label="le poids d'une barquette" valeur={'~' + kg(l.portion.poidsKg)} onMoins={() => maj(i, (x) => ({ ...x, portion: { ...x.portion!, poidsKg: Math.max(0.2, r1(x.portion!.poidsKg - 0.1)) } }))} onPlus={() => maj(i, (x) => ({ ...x, portion: { ...x.portion!, poidsKg: Math.min(5, r1(x.portion!.poidsKg + 0.1)) } }))} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <T gris style={{ width: 92 }}>Nombre</T>
                  <Stepper valeur={String(l.portion.nombre)} onMoins={() => maj(i, (x) => ({ ...x, portion: { ...x.portion!, nombre: Math.max(0, x.portion!.nombre - 1) } }))} onPlus={() => maj(i, (x) => ({ ...x, portion: { ...x.portion!, nombre: x.portion!.nombre + 1 } }))} />
                </View>
                <T gris petit>≈ {euro(l.portion.poidsKg * l.prixKg)} la barquette, payée au poids réel.</T>
              </View>
            ) : null}
            {l.format === 'lot' && l.lot ? (
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <T gris style={{ width: 92 }}>Un lot =</T>
                  <Reglage label="la taille du lot" valeur={l.lot.unite === 'kg' ? kg(l.lot.quantite) : l.lot.quantite + ' pièces'}
                    onMoins={() => maj(i, (x) => ({ ...x, lot: { ...x.lot!, quantite: Math.max(x.lot!.unite === 'kg' ? 0.5 : 1, r1(x.lot!.quantite - (x.lot!.unite === 'kg' ? 0.5 : 1))) } }))}
                    onPlus={() => maj(i, (x) => ({ ...x, lot: { ...x.lot!, quantite: r1(x.lot!.quantite + (x.lot!.unite === 'kg' ? 0.5 : 1)) } }))} />
                  <Chip titre={l.lot.unite === 'kg' ? 'en kg' : 'en pièces'} onPress={() => maj(i, (x) => ({ ...x, lot: { ...x.lot!, unite: x.lot!.unite === 'kg' ? 'pièces' : 'kg', quantite: x.lot!.unite === 'kg' ? 10 : 1 } }))} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <T gris style={{ width: 92 }}>Prix du lot</T>
                  <Reglage label="le prix du lot" valeur={euro(l.lot.prix)} onMoins={() => maj(i, (x) => ({ ...x, lot: { ...x.lot!, prix: Math.max(1, x.lot!.prix - 1) } }))} onPlus={() => maj(i, (x) => ({ ...x, lot: { ...x.lot!, prix: x.lot!.prix + 1 } }))} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <T gris style={{ width: 92 }}>Nombre</T>
                  <Stepper valeur={String(l.lot.nombre)} onMoins={() => maj(i, (x) => ({ ...x, lot: { ...x.lot!, nombre: Math.max(0, x.lot!.nombre - 1) } }))} onPlus={() => maj(i, (x) => ({ ...x, lot: { ...x.lot!, nombre: x.lot!.nombre + 1 } }))} />
                </View>
                <T gris petit>Prix fixe : pas de pesée.</T>
              </View>
            ) : null}
          </View>
        ))}
        <Pressable onPress={() => setAjout(true)} style={{ paddingVertical: 14 }}><T tresGras>+ Ajouter une espèce</T></Pressable>
        {(() => {
          const so = app.sortie(e.id); const n = app.precommandesEtal(e.id).filter((p) => p.statut === 'en_attente');
          return (
            <Pressable onPress={() => router.push('/annoncer-sortie')} accessibilityRole="button" style={{ borderWidth: 1, borderColor: so ? c.marine : c.ligne, borderRadius: 12, padding: 12, gap: 2 }}>
              <T tresGras>{so ? 'Sortie annoncée · ' + n.length + ' réservation' + (n.length > 1 ? 's' : '') + ' ›' : 'Vous partez en mer ? Annoncez votre sortie ›'}</T>
              <T gris petit>{so ? 'En publiant cet arrivage, les réservations deviennent des bons à payer, dans l’ordre d’arrivée.' : 'Les clients réservent avant votre retour.'}</T>
            </Pressable>
          );
        })()}
        <View style={{ backgroundColor: c.doux, borderRadius: 12, padding: 12, gap: 4 }}>
          <T gris>Vos prix et quantités d’hier sont déjà remplis.</T>
          <T gris petit>Une même espèce peut être vendue de deux façons : par exemple des dorades entières à la pièce et des filets en barquettes.</T>
        </View>
        {doublon ? <T gras style={{ color: c.alerte }}>Une espèce apparaît deux fois avec le même format : retirez-en une.</T> : null}
        {publie ? <T gras style={{ color: c.vert, marginTop: 8 }}>Arrivage publié : les clients le voient tout de suite.</T> : null}
        {e.produits.some(disponible) ? (
          <View style={{ borderWidth: 1, borderColor: publie ? c.marine : c.ligne, borderRadius: 14, padding: 14, gap: 8, marginTop: 8 }}>
            <T tresGras style={{ fontSize: 16 }}>Faites-le savoir</T>
            <T gris petit>Envoyez votre arrivage à vos clients habituels et sur votre statut WhatsApp, avec le lien de votre étal. Votre numéro n’y figure pas : ils réservent et paient dans l’appli.</T>
            <Bouton titre="Partager sur WhatsApp" onPress={() => partagerWhatsApp(e)} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {Platform.OS === 'web' ? <Bouton clair titre="Image statut" style={{ flex: 1, height: 46 }} onPress={async () => setPartage(await partagerImage(e))} /> : null}
              <Bouton clair titre="Autre appli" style={{ flex: 1, height: 46 }} onPress={async () => setPartage(await partagerAutre(e))} />
            </View>
            {partage === 'copie' ? <T gris petit>Texte copié : collez-le où vous voulez.</T> : partage === 'telecharge' ? <T gris petit>Image enregistrée : ajoutez-la à votre statut WhatsApp depuis votre téléphone.</T> : null}
          </View>
        ) : null}
        {app.enAttente ? (
          <View style={{ backgroundColor: '#fde7dc', borderRadius: 12, padding: 12, gap: 6, marginTop: 8 }}>
            <T tresGras>Pas de réseau : arrivage gardé sur le téléphone</T>
            <T>Il partira tout seul dès que le réseau revient. Gardez l’appli ouverte, ou rouvrez-la plus tard : l’envoi reprend.</T>
            <Pressable onPress={() => app.envoyerFile()} accessibilityRole="button"><T tresGras style={{ color: c.marine }}>Réessayer maintenant</T></Pressable>
          </View>
        ) : null}
      </ScrollView>
      <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: c.ligne }}>
        <Bouton titre="Mettre en vente" desactive={!enVente || doublon || envoi} droite={<T gras style={{ color: '#fff', opacity: 0.8 }}>{total ? kg(r1(total)) + ' · ' : ''}{enVente} produit{enVente > 1 ? 's' : ''}</T>}
          onPress={async () => { setEnvoi(true); const ok = await app.publierArrivage(e.id, lignes.filter((l) => !vide(l)), photo ?? undefined); setEnvoi(false); if (ok === true) { setPublie(true); setPhoto(null); } }} />
      </View>
      <Feuille visible={enginDe !== null} onFermer={() => setEnginDe(null)} titre="Pêché avec quel engin ?">
        <T gris style={{ marginBottom: 8 }}>Information obligatoire pour la vente au consommateur, affichée sur votre étal et le bon.</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {ENGINS.map((x) => <Chip key={x} titre={x} actif={enginDe !== null && (lignes[enginDe]?.engin || enginDefaut(lignes[enginDe]?.espece ?? '')) === x}
            onPress={() => { if (enginDe !== null) maj(enginDe, (y) => ({ ...y, engin: x })); setEnginDe(null); }} />)}
        </View>
      </Feuille>
      <Feuille visible={ajout} onFermer={() => setAjout(false)} titre="Ajouter une espèce">
        {ESPECES.map((x) => {
          const f = fermeture(x); // période de fermeture : vente bloquée
          return (
            <Pressable key={x} disabled={!!f} onPress={() => { setLignes((ls) => [...ls, produitParDefaut(x)]); setAjout(false); }}
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.ligne, opacity: f ? 0.5 : 1 }}>
              <View style={{ flex: 1 }}><T tresGras>{x}</T>{f ? <T petit style={{ color: c.alerte }}>{f.motif}</T> : null}</View><T tresGras>{f ? 'Fermé' : '+'}</T>
            </Pressable>
          );
        })}
      </Feuille>
    </SafeAreaView>
  );
}
