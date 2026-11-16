// Salon d'attente : affiche le code à transmettre et attend l'adversaire.
// Plus de polling : le socket reçoit game:state quand l'adversaire rejoint
// (le serveur appelle notify dans /api/games/join), puis on va sur la partie.
import { useEffect, useState } from 'react';
import { Link, data, redirect, useNavigate } from 'react-router';
// Les loaders appellent l'API côté serveur et gèrent les sessions expirées.
import { apiOrLogin } from '../api.js';
import { requireToken } from '../session.js';
// Le même hook que la page de partie : connexion, game:join, réception.
import { useGameSocket } from '../useGameSocket.js';

export function meta({ params }) {
  // Le code est inclus dans le titre pour identifier le salon ouvert.
  return [{ title: `Partie ${params.code} — en attente` }];
}

export async function loader({ request, params }) {
  // Le créateur doit être authentifié pour consulter son salon.
  const token = await requireToken(request);
  const res = await apiOrLogin(`/api/games/${params.code}`, { token });
  if (!res.ok) throw data(res.data?.error ?? 'Partie introuvable.', { status: res.status });
  // Si l'adversaire a déjà rejoint (page rechargée), on va directement sur la partie.
  if (res.data.status !== 'waiting') throw redirect(`/games/${res.data.code}`);
  return { code: res.data.code };
}

// Récit 2 : la page qui affiche le code à transmettre à l'adversaire.
export default function Lobby({ loaderData }) {
  // Le code est fourni par le loader, donc présent dès le rendu serveur.
  const { code } = loaderData;
  const navigate = useNavigate();
  // État de départ : partie en attente, sans coup. Le socket le remplace dès
  // que le serveur annonce que la partie a commencé.
  const { game } = useGameSocket({ code, status: 'waiting', moves: [] });
  // État local : true après un clic sur « Copier le code », pour afficher « Copié ! ».
  const [copied, setCopied] = useState(false);

  // Dès que la partie devient active (l'adversaire a rejoint), on passe à l'échiquier.
  useEffect(() => {
    if (game.status === 'active') navigate(`/games/${code}`);
  }, [game.status, code, navigate]);

  // Copie le code dans le presse-papiers (API du navigateur), puis affiche « Copié ! ».
  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
  }

  return (
    <section className="card narrow center">
      <h1>Partie créée</h1>
      <p>Donnez ce code à votre adversaire :</p>
      <p className="invite-code">{code}</p>
      <button type="button" onClick={copy}>
        {copied ? 'Copié !' : 'Copier le code'}
      </button>
      <p className="muted waiting">En attente de l’adversaire…</p>
      <p className="muted small">Le code ne peut servir qu’une seule fois.</p>
      <Link to="/">Retour à l’accueil</Link>
    </section>
  );
}