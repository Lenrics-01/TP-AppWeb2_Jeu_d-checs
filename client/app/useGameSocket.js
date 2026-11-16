// Partie en direct par Socket.IO (remplace le polling de useChessGame.js).
//
// - La connexion s'ouvre seulement dans le navigateur (dans useEffect), jamais
//   pendant le rendu serveur.
// - io() sans adresse : même origine que la page (port 3000), donc le cookie
//   echecs_session part avec la connexion et le serveur sait qui on est.
// - game:join est envoyé à CHAQUE « connect » : après une coupure, Socket.IO se
//   reconnecte tout seul, on rejoint à nouveau le salon et on reçoit l'état complet.
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

// Plus une partie a de coups, plus elle est récente ; à nombre égal, une partie
// terminée (abandon, déconnexion) est plus récente qu'une partie en cours.
function version(game) {
  return (game.moves?.length ?? 0) * 2 + (game.status === 'finished' ? 1 : 0);
}

/**
 * initialGame : la partie du loader (rendu serveur, ou rechargée après notre coup).
 * Renvoie { game, presence, connected } :
 * - game : la version la plus récente (loader ou socket) ;
 * - presence : { white: { online, remainingMs }, black: {...}, spectators } ou null ;
 * - connected : null avant la première connexion, true si connecté,
 *   false après une coupure réseau (pour afficher « reconnexion… »).
 */
export function useGameSocket(initialGame) {
  const [socketGame, setSocketGame] = useState(null);
  const [presence, setPresence] = useState(null);
  const [connected, setConnected] = useState(null);

  useEffect(() => {
    const socket = io();

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('game:join', initialGame.code);
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('game:state', setSocketGame);
    socket.on('presence', setPresence);

    // Quand on quitte la page : on ferme la connexion.
    return () => socket.disconnect();
  }, [initialGame.code]);

  // Deux sources pour la même partie : le loader et le socket. On garde la plus
  // récente. « >= » : à égalité, l'état du socket (le plus frais) gagne ; c'est
  // ce qui fait passer le salon de « waiting » à « active ».
  const game =
    socketGame && socketGame.code === initialGame.code && version(socketGame) >= version(initialGame)
      ? socketGame
      : initialGame;

  return { game, presence, connected };
}