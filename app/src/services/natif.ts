// Site web : la connexion Google / Apple passe par une fenêtre du navigateur (voir backend.ts).
// Ces fonctions n'existent que dans l'appli installée (natif.native.ts).
const absent = () => { throw new Error('Réservé à l’appli installée.'); };
export async function jetonGoogle(): Promise<string> { return absent(); }
export async function jetonApple(): Promise<{ idToken: string; nonce: string; prenom?: string }> { return absent(); }
export async function appleDisponible() { return false; }
export async function deconnexionNative() {}
