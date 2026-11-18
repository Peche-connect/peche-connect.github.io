// Faux répertoire des entreprises pour les tests (aucun appel vers Internet) : node tests/sirene-mock.mjs &
import { createServer } from 'node:http';
const ENTREPRISES = {
  '12345678900015': { nom_complet: 'CHEZ TANTE ARLETTE', etat_administratif: 'A', etab: 'A', adresse: '1 RUE DU PORT 97231 LE ROBERT' },
  '98765432100015': { nom_complet: 'ANCIEN RESTAURANT', etat_administratif: 'A', etab: 'F', adresse: '2 RUE DU BOURG 97240 LE FRANCOIS' },
};
createServer((req, res) => {
  const q = new URL(req.url, 'http://x').searchParams.get('q') ?? '';
  const e = ENTREPRISES[q];
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ results: e ? [{ siren: q.slice(0, 9), nom_complet: e.nom_complet, etat_administratif: e.etat_administratif, siege: { siret: q.slice(0, 9) + '00099' },
    matching_etablissements: [{ siret: q, etat_administratif: e.etab, adresse: e.adresse }] }] : [] }));
}).listen(12112, '127.0.0.1');
