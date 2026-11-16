// Serveur de production du client : sert les fichiers statiques construits par
// "react-router build" et confie toutes les autres requêtes à React Router,
// qui exécute les loaders/actions et fait le rendu côté serveur.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createRequestHandler } from '@react-router/express';

const buildDir = path.join(import.meta.dirname, 'build');
// pathToFileURL : import() exige une URL file:// sous Windows (C:\...).
const build = await import(pathToFileURL(path.join(buildDir, 'server', 'index.js')).href);
const port = Number(process.env.PORT ?? 3000);

const app = express();
app.disable('x-powered-by');

// Les fichiers de /assets ont un hash dans leur nom : on peut les garder en cache un an.
app.use(
  '/assets',
  express.static(path.join(buildDir, 'client', 'assets'), { immutable: true, maxAge: '1y' }),
);
app.use(express.static(path.join(buildDir, 'client'), { maxAge: '1h' }));

// Socket.IO : le navigateur ne parle qu'à ce serveur. /socket.io est relayé vers
// l'API (http://server:4000 en Docker), qui n'est pas exposée à l'extérieur.
// Même origine que la page, donc le cookie de session part avec la connexion.
const socketProxy = createProxyMiddleware({
  target: process.env.API_URL ?? 'http://localhost:4000',
  pathFilter: '/socket.io',
  ws: true,
});
// Avant React Router, sinon il répondrait 404 à /socket.io.
app.use(socketProxy);

app.use(createRequestHandler({ build }));

const server = app.listen(port, () => {
  console.log(`Client prêt sur http://localhost:${port}`);
});
// Le passage de HTTP à WebSocket arrive par l'événement « upgrade » du serveur
// HTTP, pas par Express : on le confie aussi au proxy. On garde chaque WebSocket
// ouvert, car closeAllConnections() ne les ferme pas (voir l'arrêt plus bas).
const webSockets = new Set();
server.on('upgrade', (req, socket, head) => {
  webSockets.add(socket);
  socket.on('close', () => webSockets.delete(socket));
  socketProxy.upgrade(req, socket, head);
});

// docker compose stop envoie SIGTERM. server.close() attend la fin des requêtes en
// cours (un loader qui attend l'API, par exemple) : sans closeAllConnections(), Docker
// perd patience et tue le conteneur (code 137) au lieu d'un arrêt propre (code 0).
// Les WebSocket relayés vers l'API ne sont pas fermés par closeAllConnections() :
// on les ferme nous-mêmes, sinon server.close() attendrait indéfiniment.
// Le navigateur se reconnectera tout seul quand le client redémarrera.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
    for (const socket of webSockets) socket.destroy();
  });
}
