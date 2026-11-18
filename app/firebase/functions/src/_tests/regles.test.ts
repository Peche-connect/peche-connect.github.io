// Tests des règles métier (sans base) : npm run test:unitaires
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { doitCouper } from '../coupeCircuit';
import {
  codeRetrait, creneaux, especeConnue, fermetureActive, FERMETURES_CONNUES, masquerNumeros, montantBloque, montantsPesee, nomPropre,
  nouveauNonce, portConnu, preparationConnue, preuveValide, signerBon,
} from '../regles';

const r = { fraisService: 0.9, commissionPct: 0.05, margeEmpreinte: 0.1 };

test('montant bloqué identique à l’appli (1,5 kg de thon en tranches)', () => {
  assert.equal(montantBloque(r, [{ kg: 1.5, prixKg: 14, supplementKg: 2 }]), 27.3);
  assert.equal(montantBloque(r, [{ kg: 10, prixKg: 13, supplementKg: 0 }], 15), 158.9);
});
test('pesée : total, part plateforme, part pêcheur', () => {
  assert.deepEqual(montantsPesee(r, [{ kg: 1.4, prixKg: 14, supplementKg: 2 }]), { total: 23.3, plateforme: 2.02, pourLePecheur: 21.28 });
  assert.deepEqual(montantsPesee({ ...r, commissionPct: 0 }, [{ kg: 1, prixKg: 10, supplementKg: 0 }], 15), { total: 25.9, plateforme: 15.9, pourLePecheur: 10 });
});
test('QR et code de retrait : liés au secret propre du bon, refusés sinon', () => {
  const cle = 'cle-de-test-longue-0123456789'; const n = nouveauNonce();
  const s = signerBon(cle, 'R-127', n); const pin = codeRetrait(cle, 'R-127', n);
  assert.match(pin, /^\d{6}$/);
  assert.equal(preuveValide(cle, 'R-127', n, s), true);
  assert.equal(preuveValide(cle, 'R-127', n, pin), true);
  assert.equal(preuveValide(cle, 'R-128', n, s), false);
  assert.equal(preuveValide(cle, 'R-127', nouveauNonce(), s), false, 'autre bon payé / nonce effacé après retrait');
  assert.equal(preuveValide(cle, 'R-127', undefined, s), false, 'bon retiré : plus de nonce');
  assert.equal(preuveValide(cle, 'R-127', n, s.slice(0, -1) + (s.endsWith('A') ? 'B' : 'A')), false);
  assert.equal(preuveValide(cle, 'R-127', n, pin === '000000' ? '000001' : '000000'), false);
  assert.equal(preuveValide('autre-cle', 'R-127', n, s), false);
  assert.equal(preuveValide(cle, 'R-127', n, ''), false);
});
test('numéros masqués, même déguisés', () => {
  for (const t of ['0696 12 34 56', '+596 696 12 34 56', '0696/12/34/56', '0696_12_34_56', '0696.12.34.56', '(0696)123456', '０６９６１２３４５６']) {
    assert.equal(masquerNumeros('Appelez ' + t).masque, true, t);
  }
  assert.deepEqual(masquerNumeros('2 kg à 14 €, retrait 10 h'), { texte: '2 kg à 14 €, retrait 10 h', masque: false });
});
test('noms propres : pas de numéro de téléphone caché dans un prénom ou un bateau', () => {
  assert.equal(nomPropre('Jean-Marc', 1, 40), 'Jean-Marc');
  assert.equal(nomPropre('Ti Moun 2', 1, 60), 'Ti Moun 2');
  assert.equal(nomPropre('Jo 0696123456', 1, 40), null);
  assert.equal(nomPropre('Jo <script>', 1, 40), null);
  assert.equal(nomPropre('', 1, 40), null);
});
test('listes fermées : espèces, ports, préparations', () => {
  assert.equal(especeConnue('lambi'), 'Lambi');
  assert.equal(especeConnue('Dorade coryphene'), 'Dorade coryphène');
  assert.equal(especeConnue('Lambi frais'), null);
  assert.equal(especeConnue('Lаmbi'), null, 'a cyrillique');
  assert.equal(portConnu('le robert'), 'Le Robert');
  assert.equal(portConnu('Paris'), null);
  assert.equal(preparationConnue('en filets'), 'En filets');
  assert.equal(preparationConnue('Appelez 0696…'), null);
});
test('créneaux de retrait', () => {
  assert.deepEqual(creneaux(720), ['Avant 10 h', '10 h – 12 h']);
  assert.deepEqual(creneaux(810), ['Avant 10 h', '10 h – 12 h', '12 h – 13 h 30']);
  assert.deepEqual(creneaux(570), ['Avant 10 h']);
});
test('fermetures lambi et langouste', () => {
  const j = (m: number, d: number) => new Date(Date.UTC(2027, m - 1, d, 12));
  assert.ok(fermetureActive(FERMETURES_CONNUES, 'Lambi', 'Le Robert', j(3, 15)));
  assert.equal(fermetureActive(FERMETURES_CONNUES, 'Lambi', 'Le Robert', j(7, 1)), null);
  assert.ok(fermetureActive(FERMETURES_CONNUES, 'langouste', 'Le Robert', j(9, 30)));
  assert.equal(fermetureActive(FERMETURES_CONNUES, 'Langouste', 'Le Robert', j(11, 17)), null);
  assert.equal(fermetureActive(FERMETURES_CONNUES, 'Thon jaune', 'Le Robert', j(3, 15)), null);
  assert.ok(fermetureActive([{ espece: 'Colas', debut: '11-01', fin: '02-28', motif: 'zone', port: 'Trinité' }], 'Colas', 'Trinité', j(1, 10)));
  assert.equal(fermetureActive([{ espece: 'Colas', debut: '11-01', fin: '02-28', motif: 'zone', port: 'Trinité' }], 'Colas', 'Le Robert', j(1, 10)), null);
});
test('coupe-circuit : seulement le budget « plafond », seulement une fois atteint', () => {
  assert.equal(doitCouper({ budgetDisplayName: 'Plafond Pêche Connect', costAmount: 50.2, budgetAmount: 50 }), true);
  assert.equal(doitCouper({ budgetDisplayName: 'Plafond Pêche Connect', costAmount: 49, budgetAmount: 50 }), false);
  assert.equal(doitCouper({ budgetDisplayName: 'Alerte 10 €', costAmount: 80, budgetAmount: 10 }), false);
  assert.equal(doitCouper({}), false);
});
