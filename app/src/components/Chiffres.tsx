import { useEffect, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { euro } from '../format';
import * as B from '../services/backend';
import { MODE_DEMO } from '../store';
import { couleurs as c } from '../theme';
import { Chip, T } from './ui';

// Démo : exemple chiffré (en vrai : calculé par le serveur sur les ventes retirées)
const p = (k: number): B.PeriodeChiffres => ({ ventes: 9 * k, montant: 312 * k, revenuPlateforme: 23 * k, panierMoyen: 34.7, pecheursActifs: Math.min(12, 3 + k), clientsActifs: 7 * k, clientsFideles: Math.round(1.6 * k), pros: k });
const EXEMPLE: B.Chiffres = {
  jour: p(1), semaine: p(6), mois: p(24), annulations30j: 9, absences30j: 3, pecheursVerifies: 14,
  parJour: Array.from({ length: 30 }, (_, i) => ({ jour: new Date(Date.now() - (29 - i) * 86400_000).toISOString().slice(0, 10), ventes: 4 + ((i * 7) % 9), montant: 150 + ((i * 53) % 260) })),
};

function Tuile({ titre, valeur, detail }: { titre: string; valeur: string; detail?: string }) {
  return (
    <View style={{ flexBasis: '47%', flexGrow: 1, backgroundColor: c.doux, borderRadius: 12, padding: 12, gap: 2 }}>
      <T gris petit>{titre}</T>
      <T tresGras style={{ fontSize: 20 }}>{valeur}</T>
      {detail ? <T gris petit>{detail}</T> : null}
    </View>
  );
}

// Tableau de bord de l'équipe : ventes, montant, revenu, pêcheurs actifs, clients qui reviennent
export function Chiffres() {
  const [x, setX] = useState<B.Chiffres | null>(MODE_DEMO ? EXEMPLE : null);
  const [erreur, setErreur] = useState('');
  const [per, setPer] = useState<'jour' | 'semaine' | 'mois'>('semaine');
  useEffect(() => { if (!MODE_DEMO) B.equipeChiffres().then(setX).catch((e) => setErreur((e as Error).message)); }, []);
  if (erreur) return <T style={{ color: c.alerte }}>{erreur}</T>;
  if (!x) return <T gris>Chargement des chiffres…</T>;
  const d = x[per];
  const max = Math.max(1, ...x.parJour.map((j) => j.montant));
  const exporter = () => {
    const csv = ['jour;ventes;montant_ttc', ...x.parJour.map((j) => j.jour + ';' + j.ventes + ';' + j.montant.toFixed(2))].join('\n');
    if (Platform.OS === 'web') { const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('﻿' + csv); a.download = 'peche-connect-ventes-30-jours.csv'; a.click(); }
  };
  return (
    <View style={{ gap: 10 }}>
      {MODE_DEMO ? <T gris petit>Démo : chiffres d’exemple.</T> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Chip titre="Aujourd’hui" actif={per === 'jour'} onPress={() => setPer('jour')} />
        <Chip titre="7 jours" actif={per === 'semaine'} onPress={() => setPer('semaine')} />
        <Chip titre="30 jours" actif={per === 'mois'} onPress={() => setPer('mois')} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Tuile titre="Montant vendu" valeur={euro(d.montant)} detail={d.ventes + ' vente' + (d.ventes > 1 ? 's' : '') + (d.pros ? ' dont ' + d.pros + ' pro' : '')} />
        <Tuile titre="Revenu Pêche Connect" valeur={euro(d.revenuPlateforme)} detail="commissions + frais de service" />
        <Tuile titre="Panier moyen" valeur={euro(d.panierMoyen)} />
        <Tuile titre="Pêcheurs actifs" valeur={String(d.pecheursActifs)} detail={'sur ' + x.pecheursVerifies + ' vérifiés'} />
        <Tuile titre="Clients actifs" valeur={String(d.clientsActifs)} />
        <Tuile titre="Clients qui reviennent" valeur={d.clientsActifs ? Math.round((d.clientsFideles / d.clientsActifs) * 100) + ' %' : '—'} detail={d.clientsFideles + ' avec 2 achats ou plus'} />
      </View>
      <T gris petit>Sur 30 jours : {x.annulations30j} réservation(s) annulée(s), dont {x.absences30j} client(s) absent(s).</T>
      <T tresGras style={{ marginTop: 4 }}>Montant vendu par jour (30 jours)</T>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 90 }} accessibilityLabel="Graphique du montant vendu par jour">
        {x.parJour.map((j) => <View key={j.jour} style={{ flex: 1, height: Math.max(2, (j.montant / max) * 86), backgroundColor: c.marine, borderRadius: 2 }} />)}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T gris petit>{x.parJour[0]?.jour.slice(5).split('-').reverse().join('/')}</T><T gris petit>aujourd’hui</T></View>
      {Platform.OS === 'web' && !MODE_DEMO ? <Pressable onPress={exporter} accessibilityRole="button"><T tresGras style={{ color: c.marine }}>Exporter les 30 jours (tableur)</T></Pressable> : null}
    </View>
  );
}
