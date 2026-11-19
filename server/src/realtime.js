// Le temps réel : Socket.IO, branché sur le serveur HTTP de l'API.
//
// Le protocole (les seuls messages échangés) :
//   navigateur → serveur  « game:join »  (code)       rejoindre le salon d'une partie
//   serveur → navigateur  « game:state » (partie)     l'état complet, même forme que GET /api/games/:code
//
// Les coups et l'abandon ne passent PAS par Socket.IO : ils restent en HTTP
// (POST /moves, /resign), avec leurs vérifications et leurs tests. Socket.IO sert
// seulement à prévenir : après chaque changement, app.js appelle notify(code).
// Un spectateur n'a donc aucun message pour jouer.
import { Server } from 'socket.io';
import { createCookieSession, readToken } from './cookieSession.js';
import { createGameService, normalizeCode } from './gameService.js';
import { colorOf, opponentOf } from './game.js';
import { createPresence } from './presence.js';

// Une partie = un salon. Le préfixe évite toute confusion avec d'autres salons.
function roomOf(code) {
  return `game:${code}`;
}

/**
 * httpServer : le serveur renvoyé par app.listen(...).
 * Renvoie { io, notify } : notify(code) envoie l'état de la partie à tout son salon.
 */
export function createRealtime(httpServer, { repo, sessionSecret, graceMs = 60_000 }) {
  const io = new Server(httpServer);
  const service = createGameService(repo);
  const cookieSession = createCookieSession(sessionSecret);
  const presence = createPresence();
  const timers = new Map();
  let shuttingDown = false;

  // 1. Qui est au bout de la connexion ? Décidé UNE fois, à l'ouverture, avec le
  //    cookie de session. Aucun message ne peut le changer ensuite : le serveur ne
  //    lit jamais une identité dans le contenu d'un message.
  io.use(async (socket, next) => {
    try {
      const token = await readToken(cookieSession, socket.handshake.headers.cookie);
      // Pas de cookie, cookie falsifié ou session révoquée : spectateur (null).
      socket.data.player = token ? (repo.accounts.findPlayerBySession(token) ?? null) : null;
      next();
    } catch (error) {
      next(error);
    }
  });

  io.on('connection', (socket) => {
    // 2. Rejoindre le salon d'une partie et recevoir aussitôt son état complet.
    //    C'est aussi ce qui règle la reconnexion : le client renvoie game:join à
    //    chaque « connect », et reçoit la partie là où elle en est.
    socket.on('game:join', (rawCode, ack) => {
      // ack est la réponse facultative du client ; on ne fait pas confiance à son type.
      const reply = typeof ack === 'function' ? ack : () => {};
      const game = repo.games.find(normalizeCode(rawCode));
      const playerId = socket.data.player?.id ?? null;

      // Une partie en attente n'est visible que par son créateur (le salon d'attente).
      // Une partie commencée est visible par tout le monde : joueurs et spectateurs.
      if (!game || (game.status === 'waiting' && game.creator_id !== playerId)) {
        return reply({ error: 'Partie introuvable.' });
      }

      socket.join(roomOf(game.code));
      const { cameBack } = presence.join(game.code, socket.id, playerId);
      if (cameBack && playerId != null) clearGrace(game.code, colorOf(game, playerId));
      socket.emit('game:state', service.view(game.code, playerId));
      broadcastPresence(game.code);
      reply({ ok: true });
    });

    socket.on('disconnecting', () => {
      if (shuttingDown) return;
      for (const room of socket.rooms) {
        if (!room.startsWith('game:')) continue;
        const code = room.slice('game:'.length);
        const { wentOffline } = presence.leave(code, socket.id, socket.data.player?.id ?? null);
        if (wentOffline) startGrace(code, socket.data.player.id);
        broadcastPresence(code);
      }
    });
  });

  // 3. Prévenir tout le salon d'un changement (coup, abandon, arrivée de l'adversaire).
  //    Chaque connexion reçoit SA vue : yourColor dépend de qui regarde.
  async function notify(code) {
    const game = repo.games.find(code);
    if (!game) return;
    if (game.status === 'finished') clearGameGrace(code);
    const sockets = await io.in(roomOf(code)).fetchSockets();
    for (const socket of sockets) {
      socket.emit('game:state', service.view(code, socket.data.player?.id ?? null));
    }
    broadcastPresence(code);
  }

  function broadcastPresence(code) {
    const game = repo.games.find(code);
    if (game) io.to(roomOf(code)).emit('presence', presence.snapshot(code, game));
  }

  function startGrace(code, playerId) {
    const game = repo.games.find(code);
    const color = game && colorOf(game, playerId);
    if (!game || game.status !== 'active' || !color) return;

    clearGrace(code, color);
    const deadline = Date.now() + graceMs;
    repo.games.setDeadline(code, color, deadline);
    const timer = setTimeout(() => expire(code, color), graceMs);
    timers.set(`${code}:${color}`, timer);
    broadcastPresence(code);
  }

  function clearGrace(code, color) {
    if (!color) return;
    const key = `${code}:${color}`;
    clearTimeout(timers.get(key));
    timers.delete(key);
    repo.games.clearDeadline(code, color);
    broadcastPresence(code);
  }

  function clearGameGrace(code) {
    for (const color of ['white', 'black']) {
      const key = `${code}:${color}`;
      clearTimeout(timers.get(key));
      timers.delete(key);
      repo.games.clearDeadline(code, color);
    }
  }

  function expire(code, color) {
    timers.delete(`${code}:${color}`);
    try {
      repo.transaction(() =>
        service.finish(code, { result: opponentOf(color), reason: 'disconnect' }),
      );
    } catch (error) {
      if (error.status !== 409) throw error;
    }
    clearGameGrace(code);
    notify(code);
  }

  return {
    io,
    notify,
    close() {
      shuttingDown = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      return new Promise((resolve) => io.close(resolve));
    },
  };
}
