// Outils communs aux tests d'intégration.
// Chaque test démarre une vraie API Express sur un port libre, avec une base
// SQLite en mémoire : rapide, isolée (aucun test ne voit les données d'un autre)
// et sans fichier à nettoyer. Seul GitHub est remplacé par un faux.
// chess.js prépare les suites de coups envoyées à l'API.
import { Chess } from 'chess.js';
// Le client Socket.IO, comme dans le navigateur, mais exécuté par Node.
import { io as ioClient } from 'socket.io-client';
// createApp construit la même application que celle lancée en production.
import { createApp } from '../src/app.js';
// Le temps réel et le cookie de session, branchés comme dans server.js.
import { createCookieSession } from '../src/cookieSession.js';
import { createRealtime } from '../src/realtime.js';
// La base mémoire isole chaque serveur de test.
import { createRepository, openDatabase } from '../src/repository/index.js';

// Le secret qui signe les cookies des tests (en production : SESSION_SECRET).
const TEST_SECRET = 'secret-des-tests';

/** Faux GitHub : le code "user-alice" correspond à l'utilisateur alice. */
const fakeGithub = {
  async exchangeCode(code) {
    // Le faux accepte uniquement les codes fabriqués par login().
    if (!code.startsWith('user-')) throw new Error('code refusé');
    // Le suffixe devient à la fois le nom et un identifiant stable.
    const login = code.slice('user-'.length);
    return { githubId: `gh-${login}`, name: login };
  },
};

export async function startTestServer({ dbFile = ':memory:', random, graceMs } = {}) {
  // Chaque appel crée une base, une application et un port séparés.
  const repo = createRepository(openDatabase(dbFile));
  // random peut être remplacé pour tester l'attribution des couleurs.
  // notify : comme dans server.js, realtime n'existe qu'après le démarrage du serveur.
  let realtime;
  const app = createApp({ repo, github: fakeGithub, random, notify: (code) => realtime.notify(code) });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  realtime = createRealtime(server, { repo, sessionSecret: TEST_SECRET, graceMs });
  // Les requêtes utilisent l'adresse du port choisi automatiquement par l'OS.
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  // Les sockets ouverts par le test, fermés dans close().
  const sockets = [];

  /** Envoie une requête à l'API et renvoie { status, body }. */
  async function request(method, path, { token, body } = {}) {
    // Les headers sont construits seulement quand l'appel possède réellement
    // un corps JSON ou un token d'authentification.
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // text permet de représenter correctement une réponse 204 par body null.
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  /** Connecte un joueur via le faux GitHub et renvoie { token, player }. */
  async function login(name) {
    // Le faux OAuth transforme ce code en joueur local.
    const res = await request('POST', '/api/auth/github', { body: { code: `user-${name}` } });
    return res.body;
  }

  /**
   * Alice crée une partie, Bob la rejoint. Les couleurs étant tirées au sort,
   * on renvoie les joueurs rangés par couleur : { code, white, black }.
   */
  async function startGame(creatorName = 'alice', joinerName = 'bob') {
    // Cette fonction reproduit le parcours complet créer puis rejoindre.
    const creator = await login(creatorName);
    const joiner = await login(joinerName);
    const { body } = await request('POST', '/api/games', { token: creator.token });
    const joined = await request('POST', '/api/games/join', {
      token: joiner.token,
      body: { code: body.code },
    });
    // La réponse de join donne les couleurs finales après le tirage aléatoire.
    const creatorIsWhite = joined.body.white.id === creator.player.id;
    return {
      code: body.code,
      white: creatorIsWhite ? creator : joiner,
      black: creatorIsWhite ? joiner : creator,
    };
  }

  /** Joue une suite de coups en notation algébrique, en alternant les joueurs. */
  async function playSan(game, sanMoves) {
    // Le helper joue depuis un historique local pour obtenir from/to/promotion.
    const chess = new Chess();
    let res;
    for (const san of sanMoves) {
      // Le tour local indique quel token doit envoyer le prochain coup.
      const player = chess.turn() === 'w' ? game.white : game.black;
      // chess.js convertit SAN en coordonnées utilisables par l'API.
      const { from, to, promotion } = chess.move(san);
      res = await request('POST', `/api/games/${game.code}/moves`, {
        token: player.token,
        body: { from, to, promotion },
      });
      // Une suite invalide arrête immédiatement le test avec le détail de l'API.
      if (res.status !== 200) throw new Error(`${san} refusé : ${JSON.stringify(res.body)}`);
    }
    return res;
  }

  // ------------------------------------------------------------ Temps réel

  /**
   * Le cookie de session qu'aurait le navigateur de ce joueur (même format que
   * client/app/session.js). Sans jeton : pas de cookie, donc un spectateur.
   */
  async function cookieFor(token) {
    const cookieSession = createCookieSession(TEST_SECRET);
    const session = await cookieSession.getSession();
    session.set('token', token);
    // « echecs_session=...; Path=/; ... » : l'en-tête Cookie ne garde que la première partie.
    return (await cookieSession.commitSession(session)).split(';')[0];
  }

  /**
   * Ouvre une connexion Socket.IO, comme un onglet du navigateur.
   * cookie : null (spectateur sans compte) ou la valeur de cookieFor(token).
   * auth : ce que le client envoie de lui-même à l'ouverture (le serveur doit l'ignorer).
   */
  async function connectWithCookie(cookie, auth = {}) {
    const socket = ioClient(baseUrl, {
      transports: ['websocket'],
      extraHeaders: cookie ? { cookie } : {},
      auth,
      reconnection: false, // un test ferme et rouvre lui-même ses connexions
    });
    sockets.push(socket);
    await waitFor(socket, 'connect');
    return socket;
  }

  /** Ouvre une connexion au nom de ce joueur (ou sans compte si token est absent). */
  async function connect(token) {
    return connectWithCookie(token ? await cookieFor(token) : null);
  }

  /**
   * Rejoint le salon d'une partie. Renvoie le premier « game:state » reçu
   * (l'état complet), ou lève une erreur si le serveur refuse.
   */
  async function join(socket, code) {
    // On écoute AVANT d'envoyer : le serveur envoie l'état juste avant de répondre.
    const firstState = waitFor(socket, 'game:state');
    const reply = await socket.timeout(2000).emitWithAck('game:join', code);
    if (reply.error) {
      // Refusé : aucun état n'arrivera, on abandonne donc cette attente sans erreur.
      firstState.catch(() => {});
      throw new Error(reply.error);
    }
    return firstState;
  }

  async function close() {
    // On ferme d'abord les sockets du test, puis Socket.IO et le serveur HTTP,
    // puis la base SQLite.
    for (const socket of sockets) socket.close();
    // fetch garde les connexions ouvertes (keep-alive) : closeAllConnections les ferme.
    const closed = realtime.close();
    server.closeAllConnections();
    await closed;
    repo.close();
  }

  return {
    baseUrl, repo, request, login, startGame, playSan,
    cookieFor, connectWithCookie, connect, join, close,
  };
}

/**
 * Attend le prochain « event » reçu par ce socket qui respecte la condition.
 * Échoue après ms millisecondes : un test ne reste jamais bloqué.
 */
export function waitFor(socket, event, condition = () => true, ms = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Aucun « ${event} » reçu en ${ms} ms.`));
    }, ms);
    function onEvent(data) {
      if (!condition(data)) return;
      clearTimeout(timer);
      socket.off(event, onEvent);
      resolve(data);
    }
    socket.on(event, onEvent);
  });
}

/**
 * Vérifie qu'AUCUN « event » respectant la condition n'arrive pendant ms millisecondes.
 * Sert à prouver qu'une chose n'a pas eu lieu.
 */
export function expectNothing(socket, event, condition = () => true, ms = 300) {
  return waitFor(socket, event, condition, ms).then(
    (data) => {
      throw new Error(`« ${event} » reçu alors qu'il ne devait pas l'être : ${JSON.stringify(data)}`);
    },
    () => undefined,
  );
}
