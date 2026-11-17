import Svg, { Path, Rect } from 'react-native-svg';
// Cœur de la bibliothèque « qrcode » (pur JavaScript, fonctionne sur téléphone et sur le web)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const QRCode = require('qrcode/lib/core/qrcode') as { create: (t: string, o: { errorCorrectionLevel: string }) => { modules: { size: number; data: Uint8Array } } };

// Vrai QR code lisible par n'importe quel appareil photo. Il contient le lien signé du bon
// (…/pesee/R-127?s=signature) : le pêcheur le scanne, la signature est vérifiée par le serveur.
export function QR({ contenu, taille = 104 }: { contenu: string; taille?: number }) {
  if (!contenu) return <Svg width={taille} height={taille}><Rect width={taille} height={taille} fill="#f3f3f1" rx={8} /></Svg>;
  const { size, data } = QRCode.create(contenu, { errorCorrectionLevel: 'M' }).modules;
  let d = '';
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      if (data[y * size + x]) {
        let fin = x; while (fin < size && data[y * size + fin]) fin++;
        d += 'M' + x + ' ' + y + 'h' + (fin - x) + 'v1h-' + (fin - x) + 'z';
        x = fin;
      } else x++;
    }
  }
  return (
    <Svg width={taille} height={taille} viewBox={'-2 -2 ' + (size + 4) + ' ' + (size + 4)} accessibilityLabel="QR code du bon">
      <Rect x={-2} y={-2} width={size + 4} height={size + 4} fill="#fff" />
      <Path d={d} fill="#111" />
    </Svg>
  );
}
