# TP2-AppWeb2_Jeu_d-checs
Création d'un jeu d'échecs simple où deux personnes peuvent s'affronter normalement tout en suivant les règles préétablis des échecs

# Points important 
- **Pondération** : 20 %
- **Modalité** : la même équipe qu'au projet 1, évaluation individuelle
- **Énoncé distribué** : semaine 10
- **Remise** : dépôt final, le dimanche 29 novembre 2026, à 23 h 59
- **Correction** : entretien individuel de 20 minutes pendant la semaine 14, sur rendez-vous. Le lien pour réserver votre plage sera envoyé plus tard.
- **Intelligence artificielle** : permise, voir ci-dessous.

# Le jeu en direct
Les règles du projet 1 ne changent pas : partie privée avec un code, mat, nulle, abandon, classement Elo.

# Le temps réel
Quand un joueur joue un coup, son adversaire le voit aussitôt, sans recharger la page. Le navigateur n'interroge plus le serveur à intervalles réguliers : c'est le serveur qui prévient.

# La présence de l'adversaire
Chaque joueur voit si son adversaire est en ligne, c'est-à-dire s'il a la partie ouverte en ce moment.
Un joueur qui se déconnecte en pleine partie (onglet fermé, réseau coupé) a 60 secondes pour revenir :
- son adversaire voit le temps restant ;
- s'il revient à temps, la partie continue là où elle en était ;
- sinon, il perd par abandon, et les deux classements sont mis à jour comme pour un abandon ordinaire.
- Recharger la page est une déconnexion suivie d'un retour : la partie continue. Si les deux joueurs sont déconnectés, le premier dont le délai expire perd la partie.

# Les spectateurs
N'importe qui peut regarder une partie en cours avec le lien de la partie, même sans compte. Le spectateur voit l'échiquier se mettre à jour en direct, mais ne peut ni jouer ni abandonner.
Les deux joueurs voient combien de spectateurs regardent leur partie.

# Les récits
Les six récits du projet 1 restent obligatoires, et les six suivants s'y ajoutent. Comment l'application les réalise, c'est à vous de le décider, dans les limites des exigences techniques.
1. En tant que joueur, je vois le coup de mon adversaire dès qu'il le joue, sans recharger la page.
2. En tant que joueur, je vois si mon adversaire est en ligne, afin de savoir si j'attends quelqu'un.
3. En tant que joueur, quand mon adversaire se déconnecte, je vois le temps qu'il lui reste pour revenir. S'il ne revient pas dans les 60 secondes, je gagne par abandon.
4. En tant que joueur, si je recharge la page ou si ma connexion tombe, je retrouve la partie là où elle en était, à condition de revenir dans les 60 secondes.
5. En tant que spectateur, j'ouvre le lien d'une partie en cours et je la suis en direct, sans pouvoir jouer.
6. En tant que joueur, je vois combien de spectateurs regardent ma partie.

# La remise
Avant le dimanche 29 novembre 2026, à 23 h 59 :

1. Le même dépôt GitHub qu'au projet 1. S'il est privé, je dois toujours y être collaborateur (archambaultv), et le paquet ghcr.io doit être public.
2. Un tag Git v2 sur le commit remis. Ce qui est poussé après ne compte pas.
3. Sur LÉA : une seule remise par équipe, un fichier texte contenant
- l'URL du dépôt ;
- le nom des membres de l'équipe ;
- si vous visez le niveau avancé du critère Livraison : l'adresse publique de l'application.
