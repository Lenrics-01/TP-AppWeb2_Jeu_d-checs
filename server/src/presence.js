export function createPresence() {
  const games = new Map();

  function entry(code) {
    if (!games.has(code)) {
      games.set(code, { players: new Map(), spectators: new Set() });
    }
    return games.get(code);
  }

  return {
    join(code, socketId, playerId) {
      const game = entry(code);
      if (playerId == null) {
        game.spectators.add(socketId);
        return { cameBack: false };
      }

      const sockets = game.players.get(playerId) ?? new Set();
      const cameBack = sockets.size === 0;
      sockets.add(socketId);
      game.players.set(playerId, sockets);
      return { cameBack };
    },

    leave(code, socketId, playerId) {
      const game = games.get(code);
      if (!game) return { wentOffline: false };
      if (playerId == null) {
        game.spectators.delete(socketId);
        return { wentOffline: false };
      }

      const sockets = game.players.get(playerId);
      if (!sockets) return { wentOffline: false };
      sockets.delete(socketId);
      const wentOffline = sockets.size === 0;
      if (wentOffline) game.players.delete(playerId);
      return { wentOffline };
    },

    isOnline(code, playerId) {
      return (games.get(code)?.players.get(playerId)?.size ?? 0) > 0;
    },

    spectators(code) {
      return games.get(code)?.spectators.size ?? 0;
    },

    snapshot(code, game, now = Date.now()) {
      const player = (color) => {
        const online = game[`${color}_id`] != null && this.isOnline(code, game[`${color}_id`]);
        const deadline = game[`${color}_disconnect_deadline`] ?? null;
        return {
          online,
          remainingMs: online || deadline == null ? null : Math.max(0, deadline - now),
        };
      };

      return {
        white: player('white'),
        black: player('black'),
        spectators: this.spectators(code),
      };
    },
  };
}