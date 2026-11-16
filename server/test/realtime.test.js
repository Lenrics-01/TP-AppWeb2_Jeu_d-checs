// Tests d'intégration du temps réel : un vrai serveur Socket.IO, de vrais clients
// socket.io-client, une vraie base SQLite en mémoire. Un bloc describe par récit.
// Chaque connexion porte le cookie de session qu'aurait le navigateur du joueur.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, waitFor, expectNothing } from './helpers.js';

let api;
beforeEach(async () => {
  // Chaque test démarre avec une base mémoire neuve.
  api = await startTestServer();
});
afterEach(async () => {
  await api.close();
});

describe('Connexion Socket.IO : authentifiée à son ouverture, par le cookie', () => {
  it('reconnaît le joueur grâce à son cookie de session', async () => {
    const game = await api.startGame();
    const black = await api.connect(game.black.token);
    const state = await api.join(black, game.code);
    assert.equal(state.yourColor, 'black');
  });

  it('traite une connexion sans cookie comme un spectateur', async () => {
    const game = await api.startGame();
    const anonymous = await api.connect(null);
    const state = await api.join(anonymous, game.code);
    assert.equal(state.yourColor, null);
  });

  it('ne reconnaît personne avec un cookie modifié à la main', async () => {
    const game = await api.startGame();
    // On garde le cookie de noir, mais on change un caractère : la signature ne correspond plus.
    const cookie = await api.cookieFor(game.black.token);
    const forged = cookie.slice(0, -2) + (cookie.at(-2) === 'A' ? 'B' : 'A') + cookie.at(-1);
    const socket = await api.connectWithCookie(forged);
    const state = await api.join(socket, game.code);
    assert.equal(state.yourColor, null);
  });

  it('ne croit pas une identité que le client déclare lui-même', async () => {
    const game = await api.startGame();
    // Sans cookie, le client prétend être le joueur blanc : seul le cookie compte.
    const liar = await api.connectWithCookie(null, { playerId: game.white.player.id });
    const state = await api.join(liar, game.code);
    assert.equal(state.yourColor, null);
  });

  it('cache une partie en attente à tous sauf à son créateur', async () => {
    const alice = await api.login('alice');
    const bob = await api.login('bob');
    const { body } = await api.request('POST', '/api/games', { token: alice.token });

    const creator = await api.connect(alice.token);
    assert.equal((await api.join(creator, body.code)).status, 'waiting');

    const other = await api.connect(bob.token);
    await assert.rejects(api.join(other, body.code), /introuvable/);
  });

  it('refuse un code inconnu avec un message clair', async () => {
    const socket = await api.connect(null);
    await assert.rejects(api.join(socket, 'ZZZZZZ'), /introuvable/);
  });
});

describe('Récit 7 : je vois le coup de mon adversaire sans recharger', () => {
  it('le coup d’un joueur arrive à son adversaire', async () => {
    const game = await api.startGame();
    const black = await api.connect(game.black.token);
    await api.join(black, game.code);

    // On écoute AVANT de jouer, pour ne pas rater le message.
    const arrived = waitFor(black, 'game:state', (g) => g.moves.length === 1);
    await api.request('POST', `/api/games/${game.code}/moves`, {
      token: game.white.token,
      body: { from: 'e2', to: 'e4' },
    });

    const state = await arrived;
    assert.deepEqual(state.moves, ['e4']);
    assert.deepEqual(state.lastMove, { from: 'e2', to: 'e4' });
    assert.equal(state.turn, 'black');
    // Chaque connexion reçoit SA vue : noir reste noir.
    assert.equal(state.yourColor, 'black');
  });

  it('l’abandon arrive aussi à l’adversaire', async () => {
    const game = await api.startGame();
    const white = await api.connect(game.white.token);
    await api.join(white, game.code);

    const finished = waitFor(white, 'game:state', (g) => g.status === 'finished');
    await api.request('POST', `/api/games/${game.code}/resign`, { token: game.black.token });

    const state = await finished;
    assert.equal(state.result, 'white');
    assert.equal(state.reason, 'resignation');
  });

  it('le créateur, dans le salon, apprend que l’adversaire a rejoint', async () => {
    const alice = await api.login('alice');
    const bob = await api.login('bob');
    const { body } = await api.request('POST', '/api/games', { token: alice.token });
    const creator = await api.connect(alice.token);
    await api.join(creator, body.code);

    const started = waitFor(creator, 'game:state', (g) => g.status === 'active');
    await api.request('POST', '/api/games/join', { token: bob.token, body: { code: body.code } });

    assert.equal((await started).status, 'active');
  });

  it('un coup refusé n’est pas diffusé', async () => {
    const game = await api.startGame();
    const black = await api.connect(game.black.token);
    await api.join(black, game.code);

    const nothing = expectNothing(black, 'game:state');
    const res = await api.request('POST', `/api/games/${game.code}/moves`, {
      token: game.white.token,
      body: { from: 'e2', to: 'e5' },
    });
    assert.equal(res.status, 400);
    await nothing;
  });
});

describe('Récit 10 : après un rechargement ou une coupure, je retrouve la partie', () => {
  it('une nouvelle connexion reçoit l’état complet, coups joués pendant l’absence compris', async () => {
    const game = await api.startGame();
    const first = await api.connect(game.black.token);
    await api.join(first, game.code);
    first.close(); // la page est rechargée, ou le réseau tombe

    // Pendant ce temps, blanc joue.
    await api.playSan(game, ['e4']);

    const again = await api.connect(game.black.token);
    const state = await api.join(again, game.code);
    assert.deepEqual(state.moves, ['e4']);
    assert.equal(state.yourColor, 'black');
  });
});

describe('Récit 11 : un spectateur suit la partie en direct, sans pouvoir jouer', () => {
  it('un spectateur sans compte reçoit les coups en direct', async () => {
    const game = await api.startGame();
    const spectator = await api.connect(null);
    await api.join(spectator, game.code);

    const arrived = waitFor(spectator, 'game:state', (g) => g.moves.length === 1);
    await api.playSan(game, ['e4']);

    const state = await arrived;
    assert.deepEqual(state.moves, ['e4']);
    assert.equal(state.yourColor, null);
  });

  it('un spectateur ne peut pas jouer', async () => {
    const game = await api.startGame();
    const carol = await api.login('carol'); // connectée, mais pas dans cette partie

    // Par HTTP : sans compte -> 401 ; connectée mais pas joueuse -> 403.
    const anonymous = await api.request('POST', `/api/games/${game.code}/moves`, {
      body: { from: 'e2', to: 'e4' },
    });
    assert.equal(anonymous.status, 401);
    const notPlayer = await api.request('POST', `/api/games/${game.code}/moves`, {
      token: carol.token,
      body: { from: 'e2', to: 'e4' },
    });
    assert.equal(notPlayer.status, 403);

    // Par Socket.IO : il n'existe aucun message pour jouer. Un message inventé est ignoré.
    const socket = await api.connect(carol.token);
    await api.join(socket, game.code);
    socket.emit('game:move', { code: game.code, from: 'e2', to: 'e4' });
    await expectNothing(socket, 'game:state');

    // La position n'a pas bougé.
    const seen = await api.request('GET', `/api/games/${game.code}`, { token: game.white.token });
    assert.deepEqual(seen.body.moves, []);
  });

  it('un spectateur ne peut pas abandonner à la place d’un joueur', async () => {
    const game = await api.startGame();
    const carol = await api.login('carol');
    const res = await api.request('POST', `/api/games/${game.code}/resign`, { token: carol.token });
    assert.equal(res.status, 403);
    const seen = await api.request('GET', `/api/games/${game.code}`);
    assert.equal(seen.body.status, 'active');
  });

  it('GET /api/games/:code est lisible sans compte pour une partie commencée', async () => {
    const game = await api.startGame();
    const res = await api.request('GET', `/api/games/${game.code}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.yourColor, null);
  });

  it('GET /api/games/:code cache une partie en attente à qui n’est pas le créateur', async () => {
    const alice = await api.login('alice');
    const { body } = await api.request('POST', '/api/games', { token: alice.token });
    assert.equal((await api.request('GET', `/api/games/${body.code}`)).status, 404);
    assert.equal(
      (await api.request('GET', `/api/games/${body.code}`, { token: alice.token })).status,
      200,
    );
  });
});
