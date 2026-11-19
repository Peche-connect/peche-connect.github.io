import { Redirect } from 'expo-router';
import { useApp } from '../src/store';

// Aiguillage : sans compte, on arrive directement sur les étals ; espace pêcheur si connecté comme pêcheur
export default function Aiguillage() {
  const { e } = useApp();
  if (!e.session) return <Redirect href="/(client)" />;
  if (e.session.role === 'pecheur') return <Redirect href={e.session.statutPecheur === 'verifie' ? '/(pecheur)/arrivage' : '/inscription-pecheur'} />;
  return <Redirect href="/(client)" />;
}
