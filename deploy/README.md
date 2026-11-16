# Déploiement

La machine n'a besoin que de **Docker** (avec `docker compose`). Pas de Node, pas de code source : seulement ce dossier (`compose.yml` et un `.env`).

## 1. Application GitHub OAuth

GitHub → Settings → Developer settings → OAuth Apps → New OAuth App :

- Homepage URL : `http://localhost:3000` (ou l'adresse de la machine)
- Authorization callback URL : `http://localhost:3000/login`

Notez le *Client ID* et générez un *Client secret*.

## 2. Configuration

```bash
cp .env.example .env
```

Dans `.env`, remplir :

- `TAG` : le tag `sha-xxxxxxx` publié par la CI pour le commit marqué `v2` (onglet *Actions* du dépôt, ou page du paquet sur GitHub). On n'utilise pas `latest` : ce tag change à chaque push, alors que `sha-xxxxxxx` désigne toujours la même image.
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` : ceux de l'application OAuth.
- `SESSION_SECRET` : une longue chaîne aléatoire, par exemple la sortie de `openssl rand -hex 32`.

Les secrets ne sont que dans ce `.env`, sur la machine : jamais dans le dépôt, jamais dans les images.

### `SESSION_SECRET` est donné aux deux services

Depuis le projet 2, `compose.yml` passe `SESSION_SECRET` au **client** et à l'**API** :

- le client s'en sert pour signer le cookie `echecs_session`, qui contient le jeton ;
- l'API s'en sert pour relire ce cookie à l'ouverture d'une connexion Socket.IO, et savoir quel joueur est au bout.

Si les deux valeurs étaient différentes, l'API ne reconnaîtrait plus personne sur le WebSocket : tout le monde serait vu comme spectateur. Une seule ligne dans `.env` suffit, `compose.yml` la transmet aux deux.

## 3. Démarrer

```bash
docker compose up -d        # télécharge les images et démarre
docker compose logs -f      # voir les journaux
```

Le site est sur `http://localhost:3000` (ou le `PORT` choisi).

### Vérifier le temps réel

1. Ouvrir le site dans une fenêtre normale et une fenêtre privée, se connecter avec deux comptes, créer puis rejoindre une partie.
2. Jouer un coup : il doit apparaître chez l'autre sans recharger.
3. Dans les outils de développement (F12), onglet **Réseau**, filtre **WS** : une connexion `socket.io` doit être ouverte. Elle passe par le client (port 3000), qui la relaie à l'API sur le réseau interne de Docker.

L'API n'a toujours **pas de `ports:`** dans `compose.yml` : elle n'est joignable que par le client, y compris pour le WebSocket.

## Arrêter, mettre à jour

```bash
docker compose down         # arrête et supprime les conteneurs ; le volume reste
docker compose down -v      # supprime AUSSI le volume : toutes les parties sont perdues
```

Pour une nouvelle version : changer `TAG` dans `.env`, puis `docker compose up -d`.

Une base créée avec le projet 1 est mise à jour automatiquement au démarrage : l'API ajoute les colonnes du délai de déconnexion si elles manquent.

## Où vivent les données

La base SQLite est le fichier `/data/echecs.sqlite` du conteneur `server`, dans le volume nommé `echecs-data`. Un redémarrage, un `docker compose down` ou une mise à jour de l'image ne l'effacent pas. Seul `docker compose down -v` (ou `docker volume rm`) le supprime.

Les connexions Socket.IO, elles, vivent en mémoire : après un `docker compose restart server`, les navigateurs se reconnectent seuls et la partie continue.