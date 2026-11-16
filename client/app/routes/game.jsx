// La partie. Premier affichage rendu côté serveur (l'échiquier est dans le HTML),
// puis mises à jour côté client : Socket.IO (useGameSocket) et coups envoyés par fetcher.
// Récit 11 : un spectateur, même sans compte, suit la partie sans pouvoir jouer.
// useState conserve l'état temporaire de confirmation de l'abandon.
import { useState } from 'react';
// Link navigue sans rechargement; data et redirect contrôlent les loaders;
// useFetcher envoie des actions sans changer l'adresse de la page.
import { Link, data, redirect, useFetcher } from 'react-router';
// api appelle l'API sans jeton (spectateur sans compte) ; apiOrLogin avec jeton,
// et renvoie vers la connexion si le jeton n'est plus valide.
import { api, apiOrLogin } from '../api.js';
// getToken : le jeton s'il existe, sinon null (spectateur sans compte).
import { getToken } from '../session.js';
// L'échiquier gère les clics et remonte le coup choisi au parent.
import ChessBoard from '../components/ChessBoard.jsx';
// Le hook reçoit la partie en direct par Socket.IO (coups de l'adversaire).
import { useGameSocket } from '../useGameSocket.js';
// Pastille en ligne / hors ligne, compte à rebours et nombre de spectateurs.
import { Countdown, OnlineDot, SpectatorCount } from '../components/Presence.jsx';

export function meta({ params }) {
  // params.code vient du segment dynamique games/:code.
  return [{ title: `Partie ${params.code} — Échecs en ligne` }];
}

export async function loader({ request, params }) {
  // Le jeton est facultatif : sans compte, on regarde la partie en spectateur.
  const token = await getToken(request);
  // L'état initial contient la FEN, les joueurs, le tour et l'historique SAN.
  // Avec jeton : l'API renvoie notre couleur. Sans jeton : yourColor vaut null (M6).
  const res = token
    ? await apiOrLogin(`/api/games/${params.code}`, { token })
    : await api(`/api/games/${params.code}`);
  // data transforme une erreur API en erreur de route affichée par ErrorBoundary.
  if (!res.ok) throw data(res.data?.error ?? 'Partie introuvable.', { status: res.status });
  // Une partie non commencée doit rester dans le salon, pas sur l'échiquier.
  if (res.data.status === 'waiting') throw redirect(`/lobby/${res.data.code}`);
  // Le composant reçoit un objet nommé game, transmis ensuite à useGameSocket.
  return { game: res.data };
}

// Jouer un coup ou abandonner. C'est l'API qui vérifie tout (tour, légalité,
// partie terminée) ; ici on relaie seulement sa réponse ou son message d'erreur.
export async function action({ request, params }) {
  // Toutes les écritures de cette page passent par cette action serveur.
  // Un spectateur sans compte n'a pas de jeton : on refuse tout de suite.
  // (L'API refuserait de toute façon : 401 sans compte, 403 si on n'est pas joueur.)
  const token = await getToken(request);
  if (!token) return { error: 'En spectateur, vous ne pouvez pas jouer.' };
  // Le formulaire virtuel de useFetcher contient intent et les champs du coup.
  const form = await request.formData();
  // intent permet de partager une action entre jouer et abandonner.
  const intent = form.get('intent');
  // res sera rempli par l'appel API correspondant à l'intention.
  let res;
  if (intent === 'move') {
    // Les valeurs FormData sont des chaînes; l'API valide ensuite les cases et la promotion.
    res = await apiOrLogin(`/api/games/${params.code}/moves`, {
      token,
      method: 'POST',
      body: {
        from: form.get('from'),
        to: form.get('to'),
        promotion: form.get('promotion') || undefined,
      },
    });
  } else if (intent === 'resign') {
    // L'abandon ne nécessite ni cases ni promotion.
    res = await apiOrLogin(`/api/games/${params.code}/resign`, { token, method: 'POST' });
  } else {
    // Une intention inconnue ne doit jamais être interprétée comme un coup.
    return { error: 'Action inconnue.' };
  }
  // Les erreurs sont renvoyées au composant pour rester visibles sans navigation.
  if (!res.ok) return { error: res.data?.error ?? 'Action refusée.' };
  // Une action réussie renvoie la nouvelle vue complète de la partie.
  return { game: res.data };
}

// Traduction des codes internes de fin de partie en phrases lisibles.
const REASONS = {
  checkmate: 'par mat',
  stalemate: 'par pat',
  resignation: 'par abandon',
  repetition: 'par triple répétition',
  insufficient_material: 'par matériel insuffisant',
  fifty_moves: 'par la règle des 50 coups',
};

export default function Game({ loaderData }) {
  // La version la plus récente de la partie : celle du loader (premier affichage,
  // ou après notre coup) ou celle reçue par Socket.IO (coup de l'adversaire).
  // presence : qui est en ligne, temps restant d'un joueur déconnecté, spectateurs.
  const { game, presence } = useGameSocket(loaderData.game);
  // useFetcher envoie un coup ou l'abandon à l'action de cette page, sans changer d'URL.
  // mover.state : 'idle' ou envoi en cours ; mover.data : la réponse de l'action.
  const mover = useFetcher();
  // État local : true pendant qu'on demande la confirmation de l'abandon.
  const [confirmResign, setConfirmResign] = useState(false);
  // État local : true après un clic sur « Copier le lien de la partie ».
  const [linkCopied, setLinkCopied] = useState(false);

  // Valeurs calculées à chaque rendu à partir de la partie : pas besoin de useState.
  // Récit 11 : yourColor vaut null quand on n'est pas un des deux joueurs.
  const spectator = game.yourColor == null;
  // En spectateur, on montre les blancs en bas, comme sur un échiquier classique.
  const me = spectator ? 'white' : game.yourColor;
  // L'autre couleur sert à afficher l'adversaire au-dessus du plateau.
  const opponent = me === 'white' ? 'black' : 'white';
  // Une partie active accepte des coups; une partie terminée affiche le résultat.
  const active = game.status === 'active';
  // Le joueur ne peut jouer que si la couleur du tour correspond à la sienne.
  // Un spectateur ne joue jamais.
  const myTurn = !spectator && active && game.turn === me;
  // pending évite deux clics pendant que le serveur traite le premier coup.
  const pending = mover.state !== 'idle';

  // Appelée par l'échiquier (prop onMove). C'est l'API qui décide si le coup est légal.
  function playMove(from, to, promotion) {
    // La promotion est vide pour un coup ordinaire et q/r/b/n pour un pion promu.
    mover.submit({ intent: 'move', from, to, promotion: promotion ?? '' }, { method: 'post' });
  }

  // Récit 5 : abandonner, après confirmation.
  function resign() {
    // La confirmation disparaît avant l'envoi pour éviter un double abandon.
    setConfirmResign(false);
    mover.submit({ intent: 'resign' }, { method: 'post' });
  }

  // Copie l'adresse de la page pour inviter des spectateurs.
  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setLinkCopied(true);
  }

  return (
    <div className="game-layout">
      <div className="board-column">
        {/* L'adversaire en haut, soi-même en bas (en spectateur : noirs en haut, blancs en bas). */}
        {/* On passe la présence de l'adversaire : pastille et éventuel compte à rebours. */}
        <PlayerBar
          player={game[opponent]}
          color={opponent}
          toMove={active && game.turn === opponent}
          presence={presence?.[opponent]}
          active={active}
          spectator={spectator}
        />
        {/* On ne peut cliquer que si c'est notre tour et qu'aucun envoi n'est en cours. */}
        <ChessBoard
          fen={game.fen}
          orientation={me}
          canMove={myTurn && !pending}
          lastMove={game.lastMove}
          onMove={playMove}
        />
        {/* En spectateur, on affiche aussi la présence du joueur du bas. */}
        <PlayerBar
          player={game[me]}
          color={me}
          toMove={active && game.turn === me}
          you={!spectator}
          presence={spectator ? presence?.[me] : undefined}
          active={active}
          spectator={spectator}
        />
      </div>

      <aside className="card side-panel">
        <p className="muted small">Partie {game.code}</p>
        {/* Récit 11 : bannière qui dit clairement qu'on ne peut pas jouer. */}
        {spectator && <p className="spectator-banner">Vous regardez la partie en direct</p>}
        {/* Récit 12 : le nombre de spectateurs, dès que le serveur a envoyé la présence. */}
        {presence && <SpectatorCount count={presence.spectators} />}
        {/* Les joueurs peuvent inviter des spectateurs en partageant le lien. */}
        {!spectator && (
          <button type="button" className="secondary" onClick={copyLink}>
            {linkCopied ? 'Lien copié !' : 'Copier le lien de la partie'}
          </button>
        )}

        {/* Partie en cours : statut, erreur et abandon (joueurs seulement).
            Partie terminée : le résultat. */}
        {active && spectator ? (
          <p className="status">Au tour des {game.turn === 'white' ? 'blancs' : 'noirs'}</p>
        ) : active ? (
          // <>...</> (fragment) : regroupe plusieurs éléments sans ajouter de balise.
          <>
            {/* Un coup noté en SAN qui finit par « + » met le roi adverse en échec. */}
            <p className={`status ${myTurn ? 'my-turn' : ''}`}>
              {myTurn ? 'À vous de jouer' : 'Au tour de l’adversaire…'}
              {game.moves.at(-1)?.endsWith('+') && ' — échec !'}
            </p>
            {/* Récit 4 : le refus de l'API (coup illégal, hors tour, partie terminée). */}
            {mover.data?.error && (
              <p className="error" role="alert">
                {mover.data.error}
              </p>
            )}
            {/* Premier clic : on demande confirmation. Deuxième clic : on abandonne. */}
            {confirmResign ? (
              <div className="row">
                <button type="button" className="danger" onClick={resign}>
                  Confirmer l’abandon
                </button>
                <button type="button" className="secondary" onClick={() => setConfirmResign(false)}>
                  Annuler
                </button>
              </div>
            ) : (
              <button type="button" className="secondary" onClick={() => setConfirmResign(true)} disabled={pending}>
                Abandonner
              </button>
            )}
          </>
        ) : (
          <GameResult game={game} spectator={spectator} />
        )}

        <h2>Coups</h2>
        <MoveList moves={game.moves} />
      </aside>
    </div>
  );
}

// Le bandeau d'un joueur : couleur, nom et Elo. toMove le surligne quand c'est à lui de jouer.
// Après la partie, on affiche son nouvel Elo (eloAfter) plutôt que l'ancien.
// presence (seulement pour l'adversaire) : { online, remainingMs } envoyé par le serveur.
function PlayerBar({ player, color, toMove, you = false, presence, active = false, spectator = false }) {
  // Le compte à rebours ne s'affiche que si la partie est en cours, que le joueur
  // est hors ligne et que le serveur a envoyé un temps restant.
  const showCountdown = active && presence && !presence.online && presence.remainingMs != null;
  // player peut être null dans un salon; l'opérateur ?. affiche alors un tiret.
  return (
    <div className="player-bar-wrap">
      <div className={`player-bar ${toMove ? 'to-move' : ''}`}>
        <span className={`swatch ${color}`} aria-hidden="true" />
        <span className="player-name">
          {player?.name ?? '—'} {you && <span className="muted">(vous)</span>}
        </span>
        {/* Récit 8 : la pastille en ligne / hors ligne de l'adversaire. */}
        {presence && <OnlineDot online={presence.online} />}
        <span className="elo">{player?.eloAfter ?? player?.elo}</span>
      </div>
      {/* Récit 9 : key={remainingMs} fait repartir le compte à rebours à chaque
          nouvelle annonce du serveur (par exemple après une reconnexion ratée). */}
      {showCountdown && (
        <Countdown key={presence.remainingMs} remainingMs={presence.remainingMs} spectator={spectator} />
      )}
    </div>
  );
}

// Récit 6 : le résultat et les deux classements mis à jour.
function GameResult({ game, spectator = false }) {
  // Le titre dépend du point de vue : le même résultat est une victoire pour l'un,
  // une défaite pour l'autre, et un simple constat pour un spectateur.
  let title;
  if (game.result === 'draw') title = 'Partie nulle';
  else if (spectator) title = game.result === 'white' ? 'Victoire des blancs' : 'Victoire des noirs';
  else if (game.result === game.yourColor) title = 'Victoire !';
  else title = 'Défaite';

  return (
    <div className="result">
      <h2>{title}</h2>
      <p>{REASONS[game.reason] ?? game.reason}</p>
      <table>
        <tbody>
          {/* Une ligne par joueur : nom, Elo avant → après, et l'écart. */}
          {['white', 'black'].map((color) => {
            const p = game[color];
            const delta = p.eloAfter - p.eloBefore;
            return (
              <tr key={color}>
                <td>
                  <span className={`swatch ${color}`} aria-hidden="true" /> {p.name}
                </td>
                <td>
                  {p.eloBefore} → <strong>{p.eloAfter}</strong>{' '}
                  <span className={`delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}`}>
                    ({delta > 0 ? `+${delta}` : delta === 0 ? '±0' : delta})
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Link to="/" className="button">
        Retour à l’accueil
      </Link>
    </div>
  );
}

// La liste des coups, deux par ligne comme sur une feuille de partie :
// « 1. e4 e5 », « 2. Nf3 Nc6 »... (moves[0] = blancs, moves[1] = noirs, etc.).
function MoveList({ moves }) {
  // Une liste vide est un état normal au début d'une partie.
  if (moves.length === 0) return <p className="muted">Aucun coup joué.</p>;
  // On regroupe les coups par paires : une ligne = un coup des blancs + la réponse des noirs.
  const rows = [];
  for (let i = 0; i < moves.length; i += 2) {
    // i pointe vers le coup blanc; i+1 est le coup noir éventuel.
    rows.push({ number: i / 2 + 1, white: moves[i], black: moves[i + 1] });
  }
  return (
    <ol className="move-list">
      {rows.map((row) => (
        <li key={row.number}>
          <span className="muted">{row.number}.</span> <span>{row.white}</span>{' '}
          <span>{row.black ?? ''}</span>
        </li>
      ))}
    </ol>
  );
}