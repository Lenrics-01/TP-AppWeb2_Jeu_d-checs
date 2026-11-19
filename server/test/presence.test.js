import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPresence } from '../src/presence.js';

describe('présence', () => {
  it('marque un joueur en ligne jusqu’à la fermeture de son dernier onglet', () => {
    const presence = createPresence();

    assert.deepEqual(presence.join('ABC123', 'socket-1', 7), { cameBack: true });
    assert.deepEqual(presence.join('ABC123', 'socket-2', 7), { cameBack: false });
    assert.equal(presence.isOnline('ABC123', 7), true);
    assert.deepEqual(presence.leave('ABC123', 'socket-1', 7), { wentOffline: false });
    assert.equal(presence.isOnline('ABC123', 7), true);
    assert.deepEqual(presence.leave('ABC123', 'socket-2', 7), { wentOffline: true });
    assert.equal(presence.isOnline('ABC123', 7), false);
  });

  it('compte les spectateurs et construit le snapshot de présence', () => {
    const presence = createPresence();
    const game = {
      white_id: 7,
      black_id: 8,
      white_disconnect_deadline: 1_500,
      black_disconnect_deadline: null,
    };

    presence.join('ABC123', 'white', 7);
    presence.join('ABC123', 'spectator-1', null);
    presence.join('ABC123', 'spectator-2', null);

    assert.deepEqual(presence.snapshot('ABC123', game, 1_000), {
      white: { online: true, remainingMs: null },
      black: { online: false, remainingMs: null },
      spectators: 2,
    });

    presence.leave('ABC123', 'white', 7);
    assert.deepEqual(presence.snapshot('ABC123', game, 1_000).white, {
      online: false,
      remainingMs: 500,
    });
    presence.leave('ABC123', 'spectator-1', null);
    assert.equal(presence.spectators('ABC123'), 1);
  });
});