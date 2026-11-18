"""Serveur local façon GitHub Pages : renvoie 404.html pour les liens profonds. Usage : python3 serveur.py dossier port"""
import http.server, os, sys

RACINE, PORT = sys.argv[1], int(sys.argv[2])

def lire_entetes():
    e = {}
    try:
        bloc = False
        for l in open(os.path.join(RACINE, '_headers'), encoding='utf-8'):
            if l.startswith('/*'): bloc = True; continue
            if l.startswith('/'): bloc = False; continue
            if bloc and ':' in l and l.startswith('  '):
                k, v = l.strip().split(':', 1); e[k] = v.strip()
    except FileNotFoundError: pass
    e.pop('Strict-Transport-Security', None)
    if 'Content-Security-Policy' in e: e['Content-Security-Policy'] = e['Content-Security-Policy'].replace('; upgrade-insecure-requests', '')
    return e
ENTETES = lire_entetes()

class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        for k, v in ENTETES.items(): self.send_header(k, v)
        super().end_headers()

    def __init__(self, *a, **k):
        super().__init__(*a, directory=RACINE, **k)

    def send_head(self):
        chemin = self.translate_path(self.path.split('?')[0])
        if not os.path.exists(chemin):
            self.path = '/404.html'
        return super().send_head()

    def log_message(self, *a):
        pass

http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
