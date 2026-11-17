// Tests des règles métier (sans base) : npm run test:unitaires
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fermetureActive, FERMETURES_CONNUES, masquerNumeros, montantBloque, montantsPesee, signatureValide, signerBon } from '../regles';

const r = { fraisService: 0.9, commissionPct: 0.05, margeEmpreinte: 0.1 };

test('montant bloqué identique à l’appli (1,5 kg de thon en tranches)', () => {
  assert.equal(montantBloque(r, [{ kg: 1.5, prixKg: 14, supplementKg: 2 }]), 27.3);
  assert.equal(montantBloque(r, [{ kg: 10, prixKg: 13, supplementKg: 0 }], 15), 158.9);
});
test('pesée : total, part plateforme, part pêcheur', () => {
  assert.deepEqual(montantsPesee(r, [{ kg: 1.4, prixKg: 14, supplementKg: 2 }]), { total: 23.3, plateforme: 2.02, pourLePecheur: 21.28 });
  assert.deepEqual(montantsPesee({ ...r, commissionPct: 0 }, [{ kg: 1, prixKg: 10, supplementKg: 0 }], 15), { total: 25.9, plateforme: 15.9, pourLePecheur: 10 });
});
test('QR signé : valide, refusé si code, signature ou clé changent', () => {
  const s = signerBon('cle-de-test-longue-0123456789', 'R-127', 'R-127');
  assert.equal(signatureValide('cle-de-test-longue-0123456789', 'R-127', 'R-127', s), true);
  assert.equal(signatureValide('cle-de-test-longue-0123456789', 'R-128', 'R-128', s), false);
  assert.equal(signatureValide('cle-de-test-longue-0123456789', 'R-127', 'R-127', s.slice(0, -1) + (s.endsWith('A') ? 'B' : 'A')), false);
  assert.equal(signatureValide('autre-cle', 'R-127', 'R-127', s), false);
  assert.equal(signatureValide('cle-de-test-longue-0123456789', 'R-127', 'R-127', ''), false);
});
test('numéros masqués', () => {
  assert.deepEqual(masquerNumeros('Appelez le 0696 12 34 56'), { texte: 'Appelez le •• •• •• •• ••', masque: true });
  assert.deepEqual(masquerNumeros('+596 696 12 34 56 svp'), { texte: '•• •• •• •• •• svp', masque: true });
  assert.deepEqual(masquerNumeros('2 kg à 14 €'), { texte: '2 kg à 14 €', masque: false });
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
