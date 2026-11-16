import { reactRouter } from '@react-router/dev/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // En développement, on lit le fichier .env à la racine du dépôt (le même que
  // l'API) et on le copie dans process.env, que lisent nos loaders et actions.
  // En production, les variables viennent directement de docker compose.
  Object.assign(process.env, loadEnv(mode, '..', ''), { ...process.env });

  return {
    plugins: [reactRouter()],
    // Même port qu'en production : une seule URL de rappel dans l'application GitHub OAuth.
    // DEV_HOST=true dans .env -> le site de développement est aussi joignable depuis
    // un autre ordinateur du même réseau (http://<IP de cet ordi>:3000), pour jouer à
    // deux sur un seul serveur. Désactivé par défaut : avec DEV_LOGIN=true, n'importe
    // qui sur le Wi-Fi pourrait sinon se connecter. L'API (port 4000) reste locale.
    server: {
      port: 3000,
      host: process.env.DEV_HOST === 'true',
      // Socket.IO : le navigateur se connecte à /socket.io sur CE serveur (même origine,
      // donc le cookie de session part avec la connexion), et Vite relaie vers l'API.
      // ws: true -> relaie aussi le passage de HTTP à WebSocket.
      proxy: {
        '/socket.io': { target: process.env.API_URL ?? 'http://localhost:4000', ws: true },
      },
    },
  };
});
