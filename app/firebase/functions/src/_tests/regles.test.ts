// Tests des règles métier (sans base) : npm run test:unitaires
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { doitCouper } from '../coupeCircuit';
import { siretValide } from '../sirene';
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
test('SIRET : clé de contrôle (Luhn), exception La Poste', () => {
  assert.equal(siretValide('41816609600069'), true);
  assert.equal(siretValide('12345678900015'), true);
  assert.equal(siretValide('12345678900012'), false);
  assert.equal(siretValide('35600000000010'), true, 'La Poste');
  assert.equal(siretValide('1234567890001'), false);
});

// ───────── Formats de vente ─────────
import { appliquerPesee, prendre, produitValide, rendre, rienRemis, type Produit } from '../formats';
test('formats : un produit valide par format, rien à vendre = ignoré', () => {
  assert.equal(produitValide({ format: 'kilo', prixKg: 14, dispoKg: 0 }, 'Thon jaune'), null);
  const piece = produitValide({ format: 'piece', prixKg: 13, pieces: [{ poidsKg: 3.2 }, { poidsKg: 4 }] }, 'Dorade coryphène')!;
  assert.equal(piece.dispoKg, 7.2); assert.equal(piece.pieces!.length, 2); assert.notEqual(piece.pieces![0].id, piece.pieces![1].id);
  assert.throws(() => produitValide({ format: 'piece', prixKg: 13, pieces: [{ poidsKg: 900 }] }, 'Thazard'), /invalide/);
  assert.throws(() => produitValide({ format: 'portion', prixKg: 19, portion: { type: 'Autre', poidsKg: 0.5, nombre: 2 } }, 'Thazard'), /Barquettes invalides/);
  assert.throws(() => produitValide({ format: 'lot', lot: { quantite: 1.5, unite: 'pièces', prix: 10, nombre: 2 } }, 'Lambi'), /Lot invalide/);
  assert.deepEqual(produitValide({ format: 'lot', lot: { quantite: 1, unite: 'kg', prix: 25, nombre: 4 } }, 'Lambi')!.lot, { quantite: 1, unite: 'kg', prix: 25, nombre: 4 });
});
test('formats : prendre puis rendre remet exactement le stock', () => {
  const ps: Produit[] = [
    { id: 'a', espece: 'Dorade coryphène', format: 'piece', prixKg: 13, dispoKg: 7.2, teteAuChoix: true, preparations: [{ nom: 'Entière', supplementKg: 0 }], pieces: [{ id: 'x', poidsKg: 3.2 }, { id: 'y', poidsKg: 4 }] },
    { id: 'b', espece: 'Dorade coryphène', format: 'portion', prixKg: 19, dispoKg: 3, preparations: [], portion: { type: 'Filets', poidsKg: 0.5, nombre: 6 } },
    { id: 'c', espece: 'Lambi', format: 'lot', prixKg: 0, dispoKg: 4, preparations: [], lot: { quantite: 1, unite: 'kg', prix: 25, nombre: 4 } },
  ];
  const copie: Produit[] = JSON.parse(JSON.stringify(ps));
  const lignes = [prendre(copie[0], { pieceId: 'y', tete: 'sans' }), prendre(copie[1], { nombre: 2 }), prendre(copie[2], { nombre: 1 })];
  assert.equal(lignes[0].kg, 4); assert.equal(lignes[0].tete, 'sans'); assert.equal(lignes[1].kg, 1); assert.equal(lignes[2].kg, 1);
  assert.equal(copie[0].dispoKg, 3.2); assert.equal(copie[1].portion!.nombre, 4); assert.equal(copie[2].lot!.nombre, 3);
  assert.throws(() => prendre(copie[0], { pieceId: 'y' }), /vient d’être réservé/);
  assert.throws(() => prendre(copie[2], { nombre: 9 }), /Plus assez de lambi/);
  assert.equal(montantBloque(r, lignes), 104); // (52 + 19) × 1,1 + 25 € de lot + 0,90 (sans tête : même prix)
  const rendus = rendre(copie, lignes);
  assert.deepEqual(rendus.map((p) => p.dispoKg), [7.2, 3, 4]);
  assert.equal(rendus[0].pieces!.length, 2); assert.equal(rendus[1].portion!.nombre, 6); assert.equal(rendus[2].lot!.nombre, 4);
});
test('formats : pesée (lots au nombre remis, jamais plus)', () => {
  const l = [prendre({ id: 'c', espece: 'Poisson volant', format: 'lot', prixKg: 0, dispoKg: 0, preparations: [], lot: { quantite: 10, unite: 'pièces', prix: 10, nombre: 5 } }, { nombre: 2 })];
  assert.equal(montantsPesee(r, appliquerPesee(l, [1])).total, 10.9);
  assert.throws(() => appliquerPesee(l, [3]), /Plus de lots/);
  assert.equal(rienRemis(appliquerPesee(l, [0])), true);
});

// ───────── Informations obligatoires sur le poisson ─────────
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINS, INFOS_ESPECES, mentionsObligatoires } from '../especes';
import { ESPECES } from '../regles';
test('informations obligatoires : même fichier dans l’appli et sur le serveur, toutes les espèces couvertes', () => {
  const serveur = readFileSync(join(__dirname, '..', '..', 'src', 'especes.ts'), 'utf8');
  const appli = readFileSync(join(__dirname, '..', '..', '..', '..', 'src', 'data', 'especes.ts'), 'utf8');
  assert.equal(serveur, appli, 'app/src/data/especes.ts et functions/src/especes.ts doivent être identiques');
  for (const e of ESPECES) { assert.ok(INFOS_ESPECES[e], 'infos manquantes : ' + e); assert.ok(ENGINS.includes(INFOS_ESPECES[e].engin)); }
  assert.equal(mentionsObligatoires('Thon jaune'), 'Albacore (thon jaune) · Thunnus albacares · pêché en Atlantique Centre-Ouest (zone FAO 31) · lignes et hameçons');
  assert.match(mentionsObligatoires('Langouste', 'Casiers et pièges'), /Panulirus argus.*casiers et pièges/);
});
test('engin de pêche : défaut selon l’espèce, liste fermée', () => {
  assert.equal(produitValide({ format: 'kilo', prixKg: 14, dispoKg: 5 }, 'Thon jaune')!.engin, 'Lignes et hameçons');
  assert.equal(produitValide({ format: 'kilo', prixKg: 14, dispoKg: 5, engin: 'Casiers et pièges' }, 'Chatrou')!.engin, 'Casiers et pièges');
  assert.throws(() => produitValide({ format: 'kilo', prixKg: 14, dispoKg: 5, engin: 'dynamite' }, 'Thon jaune'), /Engin de pêche inconnu/);
  const p = produitValide({ format: 'kilo', prixKg: 14, dispoKg: 5, engin: 'Sennes' }, 'Coulirou')!;
  assert.equal(prendre({ ...p, id: 'x' }, { kg: 1 }).engin, 'Sennes');
});
