// Point d'entrée de l'API : lit la configuration dans l'environnement,
// ouvre la base et démarre Express.
// createApp contient les routes; ce fichier ne fait que composer l'application réelle.
import { createApp } from './app.js';
// Le client GitHub garde le secret OAuth côté serveur.
import { createGithubClient } from './auth.js';
// Le secret de développement, le même que celui du client (client/app/session.js).
import { sessionSecretFromEnv } from './cookieSession.js';
// Le temps réel : Socket.IO, branché sur le même serveur HTTP qu'Express.
import { createRealtime } from './realtime.js';
// Le repository regroupe l'accès SQLite et son initialisation.
import { createRepository, openDatabase, seedDatabase } from './repository/index.js';

// Les variables d'environnement permettent de changer la configuration sans modifier le code.
const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } = process.env;
const dbPath = process.env.DB_PATH ?? 'data/echecs.sqlite';
const port = Number(process.env.PORT ?? 4000);
const sessionSecret = sessionSecretFromEnv(process.env);

if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
  console.warn('GITHUB_CLIENT_ID ou GITHUB_CLIENT_SECRET manquant : la connexion GitHub échouera.');
}
// L'API relit le cookie signé par le client : elle a besoin du même secret.
if (!process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET manquant : secret de développement utilisé. En production, mettez le même que le client.');
}

// openDatabase crée le fichier et les tables si nécessaire.
const db = openDatabase(dbPath);
if (process.env.SEED_DB === 'true') seedDatabase(db);
// Les routes utilisent cette façade plutôt que db directement.
const repo = createRepository(db);

// realtime est créé juste après le serveur HTTP (il en a besoin). La flèche ne le
// lit qu'au moment d'un appel, donc après le démarrage.
let realtime;
const app = createApp({
  repo,
  github: createGithubClient({ clientId: GITHUB_CLIENT_ID, clientSecret: GITHUB_CLIENT_SECRET }),
  devLogin: process.env.DEV_LOGIN === 'true',
  notify: (code) => realtime.notify(code),
});

// listen démarre le serveur HTTP et appelle le callback une fois le port prêt.
const server = app.listen(port, () => {
  console.log(`API prête sur http://localhost:${port} (base : ${dbPath})`);
});
// Socket.IO partage ce serveur et ce port : les requêtes /socket.io/ sont pour lui.
realtime = createRealtime(server, {
  repo,
  sessionSecret,
});

// docker compose stop envoie SIGTERM : on ferme proprement la base avant de quitter.
// io.close() ferme les WebSocket ouverts, puis le serveur HTTP. closeAllConnections() :
// sans lui, la fermeture attendrait la fin des requêtes en cours, et Docker pourrait
// tuer le conteneur (code 137) avant la fermeture de la base.
for (const signal of ['SIGTERM', 'SIGINT']) {
  // Docker et Ctrl+C utilisent ces signaux pour demander un arrêt propre.
  process.on(signal, () => {
    realtime.io.close(() => {
      repo.close();
      process.exit(0);
    });
    server.closeAllConnections();
  });
}
