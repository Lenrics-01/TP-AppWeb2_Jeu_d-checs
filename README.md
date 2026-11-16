# Jeu d'échecs en ligne — Applications Web 2, projets 1 et 2

Deux personnes jouent aux échecs, chacune dans son navigateur. On se connecte avec GitHub, on crée une partie privée, on envoie le code à son adversaire. Chaque partie terminée (mat, nulle, abandon ou déconnexion) met à jour le classement Elo des deux joueurs.

Le projet 2 rend la partie **en direct** : le coup de l'adversaire arrive sans recharger (Socket.IO), on voit s'il est en ligne, un joueur déconnecté a 60 secondes pour revenir, et n'importe qui peut suivre une partie en spectateur.

- **API** : Express + SQLite (`node:sqlite`) + Socket.IO, dans `server/`
- **Client** : React Router en mode framework (rendu côté serveur) + `socket.io-client`, dans `client/`
- **Règles des échecs** : [chess.js](https://github.com/jhlywa/chess.js)

## Démarrer en développement

Prérequis : Node.js 22.13 ou plus récent (24 recommandé).

1. Créer une application GitHub OAuth de développement (GitHub → Settings → Developer settings → OAuth Apps) :
   - Homepage URL : `http://localhost:3000`
   - Authorization callback URL : `http://localhost:3000/login`
2. Préparer le projet :
   ```bash
   ./setup.sh          # copie .env.example en .env, puis npm install
   ```
   (ou à la main : `cp .env.example .env` puis `npm install` ; sous PowerShell : `Copy-Item .env.example .env`)
3. Remplir `GITHUB_CLIENT_ID` et `GITHUB_CLIENT_SECRET` dans `.env`. `SESSION_SECRET` est lu **par le client et par l'API** : les deux doivent avoir la même valeur (c'est le cas avec le `.env` commun).
4. Lancer :
   ```bash
   npm run dev         # API sur http://localhost:4000, site sur http://localhost:3000
   npm test            # tests unitaires, d'intégration et temps réel de l'API
   ```

**Tester à deux joueurs sur un seul poste** : avec `DEV_LOGIN=true` (valeur par défaut du `.env` de développement), la page `/login` propose aussi une connexion par nom, sans GitHub. Ouvrez une fenêtre normale et une fenêtre de navigation privée, avec deux noms différents. Cette route n'existe pas en production.

**Tester un spectateur** : ouvrez le lien de la partie (`/games/CODE`) dans une troisième fenêtre, sans vous connecter, ou connecté avec un troisième nom.

**Jouer à deux sur deux ordinateurs** : chaque `npm run dev` a sa propre base, donc un code créé sur un poste n'existe pas sur l'autre. Un seul poste lance le projet avec `DEV_HOST=true` dans son `.env` ; l'autre ouvre `http://<IP de ce poste>:3000` (adresse affichée par `npm run dev`, ligne *Network*). Pour la connexion GitHub, ajouter aussi `http://<IP>:3000/login` aux adresses de retour de l'application OAuth ; sinon, utiliser la connexion par nom.

Pour essayer les images Docker localement à partir du code source : `docker compose up --build` (voir `compose.yml`).

## Démarrer sur la machine de déploiement

La machine n'a besoin que de Docker. Le code source n'y est pas : les images sont téléchargées depuis ghcr.io. Voir [`deploy/README.md`](deploy/README.md).

```bash
cd deploy
cp .env.example .env    # puis remplir : TAG, identifiants GitHub, SESSION_SECRET
docker compose up -d
```

## Architecture

```
                 HTTP (pages, formulaires)            HTTP + jeton
navigateur ────────────────────────────▶ client ───────────────────▶ API ──▶ SQLite (volume)
           ◀──── Socket.IO (/socket.io) ──▶ (:3000) ◀── proxy WebSocket ──▶ (:4000)
```

- Le **navigateur ne parle qu'au client** (port 3000). Les loaders et actions de React Router s'exécutent côté serveur et appellent l'API avec le jeton de session (`Authorization: Bearer ...`).
- Le **jeton de l'API** est gardé dans un cookie signé, `httpOnly`, du client (`client/app/session.js`). Le JavaScript du navigateur ne le voit jamais.
- **Tout le SQL** est dans `server/src/repository/`. Les routes (`app.js`) n'appellent que des fonctions comme `repo.games.find(code)`.
- **La position vit dans la base** : la FEN dans `games.fen` et la liste des coups dans `moves`. À chaque coup, l'API relit la partie en base et rejoue les coups avec chess.js (ce qui permet aussi de détecter la triple répétition). Un redémarrage ne perd aucune partie.

### Le temps réel (projet 2)

- **Même origine** : le navigateur ouvre Socket.IO sur `/socket.io` du client (port 3000). Le cookie `echecs_session` part donc avec la connexion.
- **Proxy WebSocket** : le client relaie `/socket.io` vers l'API (`vite.config.js` en développement, `client/server.js` en production). L'API n'est toujours pas exposée en Docker.
- **Authentification à l'ouverture** (`server/src/realtime.js`, `io.use`) : l'API relit le cookie avec le même `SESSION_SECRET`, en tire le jeton, puis le joueur. Pas de cookie valide : spectateur. Le serveur ne croit jamais une identité écrite dans un message.
- **Une partie = un salon** `game:CODE`. Le navigateur envoie `game:join` à chaque connexion (et donc à chaque reconnexion) ; le serveur lui répond aussitôt avec l'état complet.
- **Les coups restent en HTTP** (`POST /api/games/:code/moves`) : les vérifications (401, 403, 409, 400) et leurs tests existent déjà. Après l'écriture en base, l'API envoie `game:state` à chaque socket du salon.

| Événement | Sens | Contenu |
|---|---|---|
| `game:join` | navigateur → serveur | le code de la partie |
| `game:state` | serveur → navigateur | la partie, même forme que `GET /api/games/:code` (`yourColor` dépend de qui regarde) |
| `presence` | serveur → navigateur | `{ white: { online, remainingMs }, black: { online, remainingMs }, spectators }` |

**Où vit chaque état**

| État | Où | Après un redémarrage du serveur |
|---|---|---|
| Parties, coups, sessions | base SQLite | conservés |
| Fin du délai de 60 s | base (`*_disconnect_deadline`) + minuteur en mémoire | l'heure de fin reste en base |
| Sockets ouverts, salons, présence | mémoire de l'API | les navigateurs se reconnectent seuls |

**Présence et délai de 60 s** : un joueur est en ligne tant qu'il lui reste au moins un onglet ouvert sur la partie. Quand il ferme le dernier, le **serveur** lance un délai de 60 s. S'il revient avant, la partie continue ; sinon, il perd par abandon (`reason: 'disconnect'`) et les deux Elo sont mis à jour. Le serveur envoie un temps restant (`remainingMs`) plutôt qu'une heure de fin, car l'horloge du navigateur peut être décalée. Le navigateur ne fait qu'afficher le compte à rebours : il ne termine jamais la partie.

**Spectateurs** : `GET /api/games/:code` est lisible sans compte pour une partie commencée, avec `yourColor: null`. Les écritures (coup, abandon) gardent `requireAuth` (401) et le contrôle du joueur (403), et Socket.IO n'a aucun événement d'écriture : un spectateur n'a aucun chemin pour jouer.

### Côté client (projet 2)

- `client/app/useGameSocket.js` remplace l'ancien polling (`useChessGame.js`, supprimé). Le socket s'ouvre dans `useEffect`, donc seulement dans le navigateur, jamais pendant le rendu serveur. Il renvoie `{ game, presence, connected }`.
- La réponse de l'action (après notre coup) et le `game:state` du socket donnent la même partie : on garde la plus récente (nombre de coups, puis partie terminée).
- `client/app/components/Presence.jsx` : pastille « en ligne / hors ligne » (en texte, pas seulement en couleur), compte à rebours (`role="timer"`) et nombre de spectateurs.
- Bannière « Connexion perdue, reconnexion… » quand le réseau est coupé ; la partie reprend seule à la reconnexion.

### Rendu côté serveur ou côté client

| Route | Rendu | Pourquoi |
|---|---|---|
| `/` (accueil, classement, historique) | serveur | Les données arrivent dans le HTML, sans écran de chargement ; le jeton reste côté serveur. |
| `/games/:code` | serveur au premier affichage, puis client | L'échiquier est visible tout de suite (aussi pour un spectateur) ; ensuite, Socket.IO met la page à jour sans la recharger. |
| `/lobby/:code` | serveur, puis Socket.IO | Affiche le code, puis passe à la partie dès que le serveur annonce l'arrivée de l'adversaire. |
| `/login`, `/logout` | serveur seulement | Redirections OAuth et gestion du cookie : rien à afficher côté client. |

### Choix de chess.js

- Bibliothèque de référence pour les règles (coups légaux, échec, mat, pat, nulles), très utilisée et testée.
- Sans dépendance, et utilisable **des deux côtés** : l'API s'en sert pour valider (c'est elle qui fait foi), le client pour afficher les cases permises.
- Intégration : tout passe par `server/src/game.js` (`replay`, `tryMove`, `outcome`). Le reste du serveur ne connaît pas chess.js.

## Les récits

| # | Récit |
|---|---|
| 1 | Je me connecte avec GitHub ; j'ai un nom et un Elo (1000 la première fois). |
| 2 | Je crée une partie privée et je reçois un code. |
| 3 | J'entre un code et je rejoins la partie (code inconnu, déjà utilisé ou contre soi-même : refusé). |
| 4 | Je joue un coup quand c'est mon tour (coup illégal ou hors tour : refusé). |
| 5 | J'abandonne : la partie est perdue pour moi, gagnée pour l'adversaire. |
| 6 | Fin de partie (mat, nulle, abandon) : les deux Elo sont mis à jour ; historique et classement. |
| 7 | Je vois le coup de mon adversaire dès qu'il le joue, sans recharger. |
| 8 | Je vois si mon adversaire est en ligne. |
| 9 | Je vois le temps qui reste à mon adversaire déconnecté ; après 60 s, je gagne par abandon. |
| 10 | Si je recharge ou perds la connexion, je retrouve la partie (dans les 60 s). |
| 11 | En spectateur, je suis une partie en direct sans pouvoir jouer. |
| 12 | Je vois combien de spectateurs regardent ma partie. |

## L'API

Les routes d'écriture et `/api/me` exigent `Authorization: Bearer <jeton>`.

| Méthode | Route | Rôle | Refus |
|---|---|---|---|
| POST | `/api/auth/github` | `{ code, redirectUri }` → `{ token, player }` | 401 connexion GitHub échouée |
| POST | `/api/auth/logout` | révoque le jeton | |
| GET | `/api/me` | le joueur connecté (nom, Elo) | 401 |
| GET | `/api/me/games` | historique des parties terminées | 401 |
| GET | `/api/leaderboard` | 10 meilleurs Elo | |
| POST | `/api/games` | crée une partie → `{ code }` | 401 |
| POST | `/api/games/join` | `{ code }` rejoint, couleurs tirées au sort | 404 code inconnu, 409 déjà utilisé, 400 contre soi-même |
| GET | `/api/games/:code` | état de la partie ; lisible sans compte une fois commencée (`yourColor: null`) | 404 partie en attente pour qui n'est pas le créateur |
| POST | `/api/games/:code/moves` | `{ from, to, promotion? }` | 401, 403 pas joueur, 400 illégal, 409 hors tour, 409 partie terminée |
| POST | `/api/games/:code/resign` | abandon : défaite pour soi | 401, 403 pas joueur, 409 partie terminée |

## Tests

`npm test` lance `node --test` dans `server/` :

- `test/elo.test.js` : tests unitaires de la formule Elo (arrondi, bornes 100 et 3000).
- `test/games.test.js` : tests d'intégration, un bloc par récit. Chaque test démarre une vraie API Express sur un port libre, avec une **base SQLite en mémoire** (`:memory:`) : rapide, isolée, rien à nettoyer. Seul GitHub est remplacé par un faux (`test/helpers.js`). Un test utilise un vrai fichier pour vérifier qu'une partie survit à un redémarrage.
- `test/realtime.test.js` : tests temps réel avec `socket.io-client`. Le test fabrique le même cookie que le navigateur. On y vérifie notamment :
  - le coup d'un joueur arrive à son adversaire ;
  - un spectateur ne peut pas jouer (401 sans compte, 403 connecté mais pas joueur) ;
  - un joueur qui se déconnecte est annoncé hors ligne à son adversaire ;
  - le délai (raccourci à 200 ms dans les tests) donne la victoire à l'adversaire, et un retour avant la fin annule la défaite ;
  - un deuxième onglet fermé ne met pas le joueur hors ligne.

### Ce qui n'est pas testé automatiquement

- **Le client React** (hook, pages, compte à rebours) : vérifié à la main dans deux navigateurs et une fenêtre privée, avec le tableau de vérification de la semaine 4. Amélioration possible : des tests de composants (Vitest + Testing Library) ou un test de bout en bout (Playwright).
- **L'échange réel avec GitHub** : on ne veut pas que les tests dépendent d'un service externe.
- **Le proxy WebSocket du client** : vérifié à la main avec `npm run dev` et `docker compose up --build` (onglet Réseau, filtre WS).

## Intégration continue

`.github/workflows/ci.yml` : à chaque push sur `main`, `npm ci`, `npm test`, `npm run build`. Si tout passe, les images `server` et `client` sont publiées sur `ghcr.io/lenrics-01/tp1-appweb2-jeu-d-checs-{server,client}` avec les tags `latest` et `sha-<7 premiers caractères du commit>`. Sur une pull request vers `main`, les tests sont lancés mais rien n'est publié.

## Limites connues

- **Une seule instance du serveur** : les salons, les sockets et la présence vivent dans la mémoire de l'API. Pour plusieurs instances, il faudrait un adaptateur Socket.IO partagé (par exemple Redis).
- **Détection de coupure** : si le réseau tombe sans que l'onglet se ferme, le serveur ne s'en rend compte qu'après le délai de ping de Socket.IO.
- **Identité lue à l'ouverture** : un socket déjà ouvert reste authentifié après une déconnexion du site, jusqu'à sa fermeture.