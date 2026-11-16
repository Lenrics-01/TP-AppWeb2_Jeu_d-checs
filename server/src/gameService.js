// Ce que l'API sait faire sur une partie, en dehors des routes HTTP.
// Les routes (app.js) ET le temps réel (realtime.js) en ont besoin : les mettre
// ici évite de copier le même code à deux endroits.
import { updateRatings } from './elo.js';
import { colorOf } from './game.js';

/** Met un code au format des codes en base (majuscules, sans espaces). */
export function normalizeCode(code) {
  // Une valeur non textuelle devient un code vide et sera refusée par la recherche.
  return typeof code === 'string' ? code.trim().toUpperCase() : '';
}

export function createGameService(repo) {
  /**
   * Ce que le client reçoit pour afficher une partie, par HTTP comme par Socket.IO.
   * playerId : le joueur qui regarde, ou null pour un spectateur (yourColor vaut alors null).
   */
  function view(code, playerId) {
    // Le client reçoit une vue orientée jeu, pas les lignes SQL brutes.
    const game = repo.games.find(code);
    const moves = repo.games.listMoves(code);
    // Cette fonction locale évite de dupliquer la construction blanc/noir.
    const player = (color) =>
      game[`${color}_id`] == null
        ? null
        : {
            id: game[`${color}_id`],
            name: game[`${color}_name`],
            elo: game[`${color}_elo`],
            eloBefore: game[`${color}_elo_before`],
            eloAfter: game[`${color}_elo_after`],
          };
    return {
      code: game.code,
      status: game.status,
      fen: game.fen,
      turn: game.fen.split(' ')[1] === 'w' ? 'white' : 'black',
      moves: moves.map((m) => m.san),
      lastMove: moves.length ? { from: moves.at(-1).from, to: moves.at(-1).to } : null,
      white: player('white'),
      black: player('black'),
      yourColor: colorOf(game, playerId),
      result: game.result,
      reason: game.end_reason,
    };
  }

  /**
   * Termine la partie et met à jour le classement des deux joueurs.
   * À appeler dans repo.transaction(). On relit les Elo en base juste avant le calcul.
   */
  function finish(code, { result, reason }) {
    const game = repo.games.find(code);
    const ratings = updateRatings(game.white_elo, game.black_elo, result);
    const finished = repo.games.finish({
      code,
      result,
      reason,
      white: { before: game.white_elo, after: ratings.white },
      black: { before: game.black_elo, after: ratings.black },
    });
    if (!finished) {
      // La partie était déjà terminée : la transaction est annulée (409).
      throw Object.assign(new Error('La partie est terminée.'), { status: 409 });
    }
    repo.accounts.setElo(game.white_id, ratings.white);
    repo.accounts.setElo(game.black_id, ratings.black);
  }

  return { view, finish };
}
