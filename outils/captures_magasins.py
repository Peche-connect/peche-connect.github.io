"""Captures d'écran pour l'App Store (iPhone 6,7 po : 1290×2796) et Google Play (1080×2340), depuis le mode démo."""
import asyncio, os, sys
from playwright.async_api import async_playwright
BASE = sys.argv[1]; OUT = sys.argv[2]
FORMATS = {'iphone': ({'width': 430, 'height': 932}, 3), 'android': ({'width': 360, 'height': 780}, 3)}

async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        for nom, (vue, echelle) in FORMATS.items():
            pg = await (await b.new_context(viewport=vue, device_scale_factor=echelle)).new_page()
            async def clic(t, exact=False, s=1000): await pg.get_by_text(t, exact=exact).filter(visible=True).first.click(); await pg.wait_for_timeout(s)
            async def photo(n): await pg.screenshot(path=f'{OUT}/{nom}-{n}.png')
            await pg.goto(BASE + '/connexion'); await pg.wait_for_timeout(2000)
            await photo('1-connexion')
            await pg.get_by_placeholder('Ex. Sophie').fill('Bertrand'); await pg.get_by_placeholder('0696 12 34 56').fill('0696123456')
            await clic('Recevoir le code'); await pg.get_by_placeholder('••••••').fill('123456'); await clic('Valider', s=1800)
            await photo('2-accueil')
            await pg.goto(BASE + '/carte'); await pg.wait_for_timeout(1800); await photo('3-carte')
            await pg.goto(BASE + '/'); await pg.wait_for_timeout(1200)
            await clic('Étal de', s=1500)
            await pg.get_by_label('Ajouter Thon jaune').filter(visible=True).first.click(); await pg.wait_for_timeout(500)
            await pg.get_by_label('Plus').filter(visible=True).first.click(); await pg.wait_for_timeout(800)
            await photo('4-etal')
            await pg.get_by_text('Voir mon panier').filter(visible=True).last.click(); await pg.wait_for_timeout(1200)
            await clic('Réserver et payer', s=2500); await photo('5-bon')
            await clic('Message', exact=True, s=1500)
            await pg.get_by_placeholder('Écrire à', exact=False).filter(visible=True).first.fill('J’arrive dans 10 min, merci !')
            await pg.get_by_label('Envoyer', exact=True).filter(visible=True).first.click(); await pg.wait_for_timeout(3500)
            await photo('6-messagerie')
            await pg.goto(BASE + '/compte'); await pg.wait_for_timeout(1000); await clic('Me déconnecter')
            await pg.get_by_text('Pêcheur', exact=True).filter(visible=True).click(); await pg.wait_for_timeout(500)
            await pg.get_by_placeholder('0696 12 34 56').fill('0696999999'); await clic('Recevoir le code')
            await pg.get_by_placeholder('••••••').fill('123456'); await clic('Valider', s=1200)
            await pg.get_by_placeholder('Ex. Jean-Marc').fill('Louis'); await pg.get_by_placeholder('Ex. Yole Bèl Lanmè').fill('Ti Moun')
            await pg.get_by_placeholder('Ex. FF 890414').fill('FF 123456'); await pg.get_by_placeholder('Numéro d’identification du marin').fill('AB123456'); await clic('Envoyer mon dossier', s=1200)
            await clic('Démo : simuler la vérification'); await clic('Ouvrir mon compte de paiement'); await clic('Publier mon premier arrivage', s=1200)
            await clic('+ Ajouter une espèce'); await clic('Thon jaune', exact=True)
            await clic('+ Ajouter une espèce'); await clic('Vivaneau', exact=True, s=1200)
            await photo('7-arrivage')
            await pg.context.close()
        await b.close()
asyncio.run(main())
