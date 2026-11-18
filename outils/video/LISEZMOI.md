# Vidéo de démonstration

Filme le site en mode démo (client puis pêcheur) et monte une vidéo 1920 × 1080 avec l'explication de chaque étape.

```
cd app && EXPO_OFFLINE=1 npx expo export --platform web --clear && cp dist/index.html dist/404.html
python3 outils/video/serveur.py app/dist 8765 &
python3 outils/video/video.py http://127.0.0.1:8765     # tournage (Playwright + Chrome), images dans /tmp/video
python3 outils/video/montage.py                          # montage (Pillow + ffmpeg) → ~/peche-connect-demo.mp4
```

Les textes de chaque étape sont dans `TEXTES` (`montage.py`). Dernière version : `design/video/peche-connect-demo.mp4`.
