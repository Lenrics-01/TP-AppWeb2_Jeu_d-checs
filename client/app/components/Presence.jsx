// Affichage de la présence (récits 8, 9 et 12).
// Tout vient de l'événement « presence » envoyé par le serveur :
//   { white: { online, remainingMs }, black: { online, remainingMs }, spectators }
// Le navigateur ne fait qu'AFFICHER : c'est le serveur qui compte les 60 s et
// qui termine la partie. Le compte à rebours ne décide jamais de rien.
import { useEffect, useState } from 'react';

// Récit 8 : pastille « en ligne » / « hors ligne ».
// Le texte est écrit en toutes lettres : la couleur seule ne suffit pas
// (daltonisme, lecteurs d'écran).
export function OnlineDot({ online }) {
  return (
    <span className={`online-dot ${online ? 'on' : 'off'}`}>
      <span className="dot" aria-hidden="true" />
      {online ? 'en ligne' : 'hors ligne'}
    </span>
  );
}

// Récit 9 : temps restant avant la défaite par abandon de l'adversaire déconnecté.
// Le serveur envoie un temps restant (remainingMs), pas une heure de fin, car
// l'horloge du navigateur peut être décalée. On calcule donc notre propre heure
// de fin au moment où on reçoit le message, puis on décompte.
export function Countdown({ remainingMs }) {
  // useState(() => ...) : calculé une seule fois, au premier affichage.
  const [end] = useState(() => Date.now() + remainingMs);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // Mise à jour 4 fois par seconde pour que l'affichage reste fluide.
    const id = setInterval(() => setNow(Date.now()), 250);
    // Arrêt quand le composant disparaît (l'adversaire est revenu, partie finie).
    return () => clearInterval(id);
  }, []);

  // Jamais sous 0, même si le message de fin du serveur arrive un peu en retard.
  const seconds = Math.max(0, Math.ceil((end - now) / 1000));
  return (
    <p className="countdown" role="timer">
      Revient dans {seconds} s, sinon vous gagnez
    </p>
  );
}

// Récit 12 : le nombre de spectateurs qui regardent la partie.
export function SpectatorCount({ count }) {
  return (
    <p className="spectators muted small">
      👁 {count} {count > 1 ? 'spectateurs' : 'spectateur'}
    </p>
  );
}