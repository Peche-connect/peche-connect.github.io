"""Monte la vidéo de démonstration : téléphone filmé à gauche, explication de chaque étape à droite (1920×1080, 30 i/s)."""
import json, glob, os, subprocess
from PIL import Image, ImageDraw, ImageFont

D = '/tmp/video'
F = '/home/claude/peche-connect.github.io/app/node_modules/@expo-google-fonts/'
bebas = lambda s: ImageFont.truetype(F + 'bebas-neue/BebasNeue_400Regular.ttf', s)
fig = lambda s, w='400Regular': ImageFont.truetype(F + 'figtree/Figtree_' + w + '.ttf', s)
MARINE, NOIR, GRIS, FOND = (18, 53, 91), (17, 17, 17), (98, 98, 93), (243, 243, 241)
W, H = 1920, 1080
TEL_H = 1000; TEL_W = round(780 * TEL_H / 1688); TEL_X, TEL_Y = 200, 40

TEXTES = {
  'connexion': ('Côté client', '1 · Connexion', 'Le client choisit « Particulier ». En démo : un numéro et le code 123456. En réel : Google, Apple ou un lien reçu par e-mail.'),
  'accueil': ('Côté client', '2 · Accueil', 'Les étals du jour, présentés comme des restaurants : espèces, prix au kilo, heure de débarquement. Recherche et filtres par espèce.'),
  'carte': ('Côté client', '3 · Carte des arrivages', 'Les ports qui ont du poisson aujourd’hui. On touche un port pour voir ses étals.'),
  'etal': ('Côté client', '4 · L’étal du pêcheur', 'On ajoute du poisson avec + et −. L’adresse exacte du pêcheur reste cachée jusqu’au paiement.'),
  'panier': ('Côté client', '5 · Panier', 'Préparation (entier, tranches, filets) et créneau de retrait. Un montant maximum est bloqué sur la carte : rien n’est encore débité.'),
  'bon': ('Côté client', '6 · Bon de retrait', 'Code, QR et code de retrait à 6 chiffres. L’adresse exacte et la messagerie s’ouvrent.'),
  'suivi': ('Côté client', '7 · Suivi de la commande', 'Chaque étape est enregistrée par le serveur, avec qui et quand. Une modification après coup se verrait.'),
  'chat': ('Côté client', '8 · Messagerie', 'Le client écrit au pêcheur… et tape son numéro de téléphone.'),
  'masque': ('Côté client', 'Le numéro est masqué', 'Les échanges restent sur Pêche Connect jusqu’au retrait : c’est la règle anti-contournement.'),
  'compte': ('Côté client', '9 · Mon compte', 'Alertes sur ses espèces préférées, téléchargement de ses données, suppression du compte.'),
  'pecheur-connexion': ('Côté pêcheur', '10 · Connexion', 'Le pêcheur se connecte avec le profil « Pêcheur ».'),
  'inscription': ('Côté pêcheur', '11 · Inscription', 'Prénom, port, nom et immatriculation du bateau.'),
  'verification': ('Côté pêcheur', '12 · Vérification', 'Pêche Connect vérifie le dossier, puis le pêcheur ouvre son compte de paiement Stripe. Simulé ici.'),
  'arrivage': ('Côté pêcheur', '13 · Publier l’arrivage', 'Espèce choisie dans la liste, prix au kilo, kilos avec + et −, photo. Moins d’une minute.'),
  'publie': ('Côté pêcheur', 'Arrivage publié', 'Les clients le voient tout de suite ; ceux qui suivent cette espèce reçoivent une alerte.'),
  'pesee': ('Côté pêcheur', '14 · Pesée au port', 'Le pêcheur scanne le QR du client, ou tape le code de retrait que le client lui dicte.'),
  'pesee-code': ('Côté pêcheur', 'Bon reconnu', 'Il ajuste le poids réel. Seul ce poids est encaissé ; le reste du montant bloqué est libéré.'),
  'cloture': ('Côté pêcheur', '15 · Vente clôturée', 'L’argent est réparti automatiquement : le pêcheur reçoit sa part, Pêche Connect sa commission.'),
}

def lignes(txt, police, largeur):
  mots, out, cur = txt.split(), [], ''
  for m in mots:
    essai = (cur + ' ' + m).strip()
    if police.getlength(essai) <= largeur: cur = essai
    else: out.append(cur); cur = m
  return out + [cur]

def logo(d, x, y, taille):
  d.text((x, y), 'PÊCHE', font=bebas(taille), fill=MARINE)
  d.text((x, y + taille * 0.86), 'CONNECT', font=bebas(taille), fill=MARINE)

def fond_etape(cle, n, total):
  im = Image.new('RGB', (W, H), FOND); d = ImageDraw.Draw(im)
  d.rounded_rectangle((TEL_X - 14, TEL_Y - 14, TEL_X + TEL_W + 14, TEL_Y + TEL_H + 14), 36, fill=NOIR)
  x = 820
  logo(d, x, 70, 64)
  partie, titre, texte = TEXTES[cle]
  d.text((x, 330), partie.upper(), font=fig(30, '700Bold'), fill=GRIS)
  y = 380
  for l in lignes(titre, fig(68, '800ExtraBold'), 980): d.text((x, y), l, font=fig(68, '800ExtraBold'), fill=NOIR); y += 82
  y += 24
  for l in lignes(texte, fig(40), 960): d.text((x, y), l, font=fig(40), fill=NOIR); y += 56
  # barre de progression
  d.rounded_rectangle((x, 980, x + 960, 988), 4, fill=(229, 229, 226))
  d.rounded_rectangle((x, 980, x + round(960 * n / total), 988), 4, fill=MARINE)
  d.text((x, 1000), 'Démonstration · données d’exemple · rien n’est payé', font=fig(26), fill=GRIS)
  return im

def carte(titre, sous, bas):
  im = Image.new('RGB', (W, H), 'white'); d = ImageDraw.Draw(im)
  logo(d, 160, 220, 150)
  d.line((560, 230, 560, 470), fill=MARINE, width=8)
  for i, m in enumerate(['Réservez.', 'Payez.', 'Récupérez.']): d.text((600, 240 + i * 74), m, font=fig(64, '800ExtraBold'), fill=NOIR)
  d.text((160, 620), titre, font=fig(64, '800ExtraBold'), fill=NOIR)
  d.text((160, 710), sous, font=fig(40), fill=GRIS)
  d.text((160, 940), bas, font=fig(30), fill=GRIS)
  return im

ENC = ['-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', '30']
def run(args):
  subprocess.run(['ffmpeg', '-v', 'error', '-y'] + args, check=True)

etapes = json.load(open(D + '/etapes.json'))
fin = etapes[-1][1]
# images de l'écran → une vidéo à 30 i/s (chaque image tenue jusqu'à la suivante)
imgs = [(f, t) for f, t in json.load(open(D + '/images.json')) if t < fin]
l = [f"file '{imgs[0][0]}'\nduration {max(imgs[0][1], 0.04):.3f}"] if imgs[0][1] > 0 else []
for i, (f, t) in enumerate(imgs):
  suivant = imgs[i + 1][1] if i + 1 < len(imgs) else fin
  l.append(f"file '{f}'\nduration {max(suivant - t, 0.001):.3f}")
l.append(f"file '{imgs[-1][0]}'")
open(D + '/ecran.txt', 'w').write('\n'.join(l) + '\n')
webm = D + '/ecran.txt'
cles = [c for c, _ in etapes if c in TEXTES]

# 1. fond de chaque étape (image) avec sa durée → une seule vidéo de fond
liste = []
for i, (cle, t) in enumerate(etapes[:-1]):
  duree = etapes[i + 1][1] - (0 if i == 0 else t)  # la 1re étape commence à 0 (chargement)
  p = f'{D}/fond-{i:02d}.png'; fond_etape(cle, i + 1, len(etapes) - 1).save(p)
  liste.append(f"file '{p}'\nduration {duree:.2f}")
liste.append(f"file '{D}/fond-{len(etapes) - 2:02d}.png'")
open(D + '/fonds.txt', 'w').write('\n'.join(liste) + '\n')

# 2. téléphone posé sur les fonds
run(['-f', 'concat', '-safe', '0', '-i', D + '/fonds.txt', '-f', 'concat', '-safe', '0', '-i', webm,
     '-filter_complex', f'[0:v]fps=30,format=yuv420p[f];[1:v]fps=30,scale={TEL_W}:{TEL_H}:flags=lanczos[t];[f][t]overlay={TEL_X}:{TEL_Y}:shortest=1,trim=duration={fin:.2f}',
     *ENC, D + '/milieu.tmp.mp4'])
os.replace(D + '/milieu.tmp.mp4', D + '/milieu.mp4')

# 3. cartes de début et de fin (fondu à l'intérieur de chaque fichier)
carte('Démonstration de l’application', 'Le parcours d’un client, puis celui d’un pêcheur', 'Mode démo · données d’exemple · novembre 2026').save(D + '/debut.png')
carte('Prêt à passer en mode réel', 'Firebase (Paris) · Stripe Connect · Cloudflare', 'peche-connect.github.io').save(D + '/fin.png')
for nom, duree in (('debut', 4), ('fin', 4)):
  fondu = 'fade=t=out:st=3.4:d=0.6' if nom == 'debut' else 'fade=t=in:st=0:d=0.6'
  run(['-framerate', '30', '-i', f'{D}/{nom}.png', '-vf', f'format=yuv420p,loop=-1:1,trim=duration={duree},{fondu}', *ENC, f'{D}/{nom}.tmp.mp4'])
  os.replace(f'{D}/{nom}.tmp.mp4', f'{D}/{nom}.mp4')

open(D + '/tout.txt', 'w').write(''.join(f"file '{D}/{n}.mp4'\n" for n in ('debut', 'milieu', 'fin')))
run(['-f', 'concat', '-safe', '0', '-i', D + '/tout.txt', '-c', 'copy', '-movflags', '+faststart', D + '/demo.tmp.mp4'])
os.replace(D + '/demo.tmp.mp4', '/home/claude/peche-connect-demo.mp4')
print('ok')
