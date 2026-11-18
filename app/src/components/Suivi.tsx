// Suivi d'une commande étape par étape (réservée, payée, retirée, facturée…), avec qui et quand
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { euro } from '../format';
import { useApp } from '../store';
import { couleurs as c } from '../theme';
import type { EtapeSuivi } from '../types';
import { T } from './ui';

const PAR: Record<string, string> = { client: 'par vous', pro: 'par vous', pecheur: 'par le pêcheur', stripe: 'par la banque (Stripe)', systeme: 'automatiquement' };
function libelle(s: EtapeSuivi) {
  const d = s.details as Record<string, unknown>;
  switch (s.etape) {
    case 'reservee': return 'Réservée' + (typeof d.montantBloque === 'number' ? ' · ' + euro(d.montantBloque) + ' max' : '');
    case 'commande_creee': return 'Commande proposée par le pêcheur';
    case 'payee': return 'Paiement accepté (montant bloqué)';
    case 'paiement_refuse': return 'Paiement refusé';
    case 'retiree': return 'Pesée et retirée' + (typeof d.debite === 'number' ? ' · ' + euro(d.debite) + ' débités' : '');
    case 'annulee': return 'Annulée' + (d.raison ? ' · ' + String(d.raison) : '');
    case 'facture_emise': return 'Facture ' + String(d.numero ?? '') + ' émise';
  }
}
const quand = (ms: number) => new Date(ms).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Martinique' });

export function Suivi({ code, statut }: { code: string; statut: string }) {
  const app = useApp();
  const [etapes, setEtapes] = useState<EtapeSuivi[]>([]);
  useEffect(() => { app.suivi(code).then(setEtapes); }, [code, statut]);
  if (!etapes.length) return null;
  return (
    <View style={{ margin: 16, marginBottom: 0, gap: 10 }}>
      <T tresGras style={{ fontSize: 16 }}>Suivi de la commande</T>
      {etapes.map((s, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ alignItems: 'center', width: 12 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 5, backgroundColor: s.etape === 'annulee' || s.etape === 'paiement_refuse' ? c.alerte : c.marine }} />
            {i < etapes.length - 1 ? <View style={{ flex: 1, width: 2, backgroundColor: c.ligne, marginTop: 2 }} /> : null}
          </View>
          <View style={{ flex: 1, paddingBottom: 4 }}>
            <T gras>{libelle(s)}</T>
            <T gris petit>{quand(s.quand)} · {PAR[s.par] ?? s.par}</T>
          </View>
        </View>
      ))}
    </View>
  );
}
