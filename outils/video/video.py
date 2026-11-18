"""Filme le parcours de démonstration (mode démo) et note l'heure de chaque étape : python3 video.py URL"""
import sys, asyncio, json, time, os, shutil
from playwright.async_api import async_playwright

BASE = sys.argv[1]
OUT = '/tmp/video'
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)

# point bleu à chaque toucher (la vidéo ne montre pas le curseur)
TOUCHER = """
addEventListener('pointerdown', (e) => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;width:34px;height:34px;border-radius:17px;'
    + 'background:rgba(18,53,91,.35);border:2px solid rgba(18,53,91,.8);transform:translate(-50%,-50%) scale(.6);transition:all .45s ease-out;'
    + 'left:' + e.clientX + 'px;top:' + e.clientY + 'px';
  document.documentElement.appendChild(d);
  requestAnimationFrame(() => { d.style.transform = 'translate(-50%,-50%) scale(1.3)'; d.style.opacity = '0'; });
  setTimeout(() => d.remove(), 600);
}, true);
"""

async def main():
    etapes = []
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        await ctx.add_init_script(TOUCHER)
        pg = await ctx.new_page()
        # images de l'écran en haute définition (JPEG 92) avec leur heure exacte
        images = []
        cdp = await ctx.new_cdp_session(pg)
        def image(ev):
            n = len(images); open(f'{OUT}/i{n:05d}.jpg', 'wb').write(__import__('base64').b64decode(ev['data']))
            images.append((f'{OUT}/i{n:05d}.jpg', ev['metadata']['timestamp']))
            asyncio.ensure_future(cdp.send('Page.screencastFrameAck', {'sessionId': ev['sessionId']}))
        cdp.on('Page.screencastFrame', image)
        await cdp.send('Page.startScreencast', {'format': 'jpeg', 'quality': 92, 'maxWidth': 780, 'maxHeight': 1688, 'everyNthFrame': 1})
        t0 = time.time()
        def etape(cle): etapes.append((cle, round(time.time() - t0, 2)))
        async def pause(s=1.0): await pg.wait_for_timeout(int(s * 1000))
        async def clic(texte, exact=False, s=1.0):
            await pg.get_by_text(texte, exact=exact).filter(visible=True).first.click(); await pause(s)
        async def taper(ph, txt):
            await pg.get_by_placeholder(ph).filter(visible=True).first.click()
            await pg.keyboard.type(txt, delay=70)
        async def defiler(dy, s=1.2):
            await pg.mouse.move(195, 500); await pg.mouse.wheel(0, dy); await pause(s)

        # ── Client ──
        await pg.goto(BASE + '/connexion'); await pause(1.5)
        etape('connexion'); await pause(2.5)
        await taper('Ex. Sophie', 'Bertrand')
        await taper('0696 12 34 56', '0696123456')
        await clic('Recevoir le code')
        await taper('••••••', '123456'); await pause(0.4)
        await clic('Valider', s=1.5)
        etape('accueil'); await pause(3)
        await defiler(500, 2); await defiler(-500, 1)
        await pg.goto(BASE + '/carte'); await pause(1)
        etape('carte'); await pause(3.5)
        await pg.goto(BASE + '/'); await pause(1.2)
        await pg.get_by_text('Étal de').filter(visible=True).first.click(); await pause(1.2)
        etape('etal'); await pause(2)
        await pg.get_by_label('Ajouter Thon jaune').filter(visible=True).first.click(); await pause(0.8)
        await pg.get_by_label('Plus').filter(visible=True).first.click(); await pause(1.5)
        await pg.get_by_text('Voir mon panier').filter(visible=True).last.click(); await pause(1.2)
        etape('panier'); await pause(3)
        await defiler(400, 2)
        await clic('Réserver et payer', s=2.5)
        etape('bon'); await pause(4)
        await defiler(900, 3.5)
        etape('suivi'); await pause(2)
        await defiler(-900, 1)
        await clic('Message', exact=True, s=1.5)
        etape('chat'); await pause(1.5)
        await taper('Écrire à', 'Je passe vers 10 h, mon numéro 0696 12 34 56')
        await pause(0.6)
        await pg.get_by_label('Envoyer', exact=True).filter(visible=True).first.click(); await pause(2)
        etape('masque'); await pause(3.5)
        code = await pg.evaluate("() => { const m = location.href.match(/R-\\d+/) || document.body.innerText.match(/R-\\d+/); return m ? m[0] : 'R-27' }")

        # ── Pêcheur ──
        await pg.goto(BASE + '/compte'); await pause(1.2)
        etape('compte'); await pause(3)
        await clic('Me déconnecter', s=1)
        await pg.get_by_text('Pêcheur', exact=True).filter(visible=True).click(); await pause(0.8)
        etape('pecheur-connexion'); await pause(1)
        await taper('0696 12 34 56', '0696999999')
        await clic('Recevoir le code')
        await taper('••••••', '123456'); await clic('Valider', s=1.2)
        etape('inscription'); await pause(1)
        await taper('Ex. Jean-Marc', 'Louis')
        await taper('Ex. Yole Bèl Lanmè', 'Ti Moun')
        await taper('Ex. FF 890414', 'FF 123456'); await pause(0.8)
        await clic('Envoyer mon dossier', s=1.5)
        etape('verification'); await pause(2.5)
        await clic('Démo : simuler la vérification', s=1.5)
        await clic('Ouvrir mon compte de paiement', s=1.5)
        await clic('Publier mon premier arrivage', s=1.2)
        etape('arrivage'); await pause(2)
        await clic('+ Ajouter une espèce'); await clic('Thon jaune', exact=True, s=1.2)
        await pg.get_by_label('Monter le prix').filter(visible=True).first.click(); await pause(0.5)
        await pg.get_by_label('Monter le prix').filter(visible=True).first.click(); await pause(1)
        await clic('Mettre en vente', s=2.5)
        etape('publie'); await pause(2)
        await pg.goto(BASE + '/pesee/' + code); await pause(1.2)
        etape('pesee'); await pause(1.5)
        await taper('6 chiffres', '482615'); await pause(1.5)
        etape('pesee-code'); await pause(2.5)
        await pg.get_by_text('Valider la pesée').filter(visible=True).first.click(); await pause(2.5)
        etape('cloture'); await pause(3)
        etape('fin')
        await cdp.send('Page.stopScreencast')
        await ctx.close(); await b.close()
    json.dump(etapes, open(OUT + '/etapes.json', 'w'), ensure_ascii=False)
    json.dump([(f, round(t - t0, 3)) for f, t in images], open(OUT + '/images.json', 'w'))
    print(len(images), 'images')
    print(etapes)

asyncio.run(main())
