# Fiches App Store et Google Play

Tout ce que demandent App Store Connect et la Play Console pour Masame 0.5.0 sur iPhone et Android, prêt à coller. Chaque champ limité donne son nombre de caractères (espaces compris, comptés comme les consoles : un caractère accentué ou « × » compte pour un).

Ce que contient la version téléphone, pour vérifier chaque phrase : jouer contre KataGo à ton niveau (réseau humain calibré par rang, Maîtres d'une époque, mentor), revue de chaque partie, Apprendre (rituel du jour, exercices tirés de tes parties avec répétition espacée, tsumego, compter, joseki, fuseki, rejouer de mémoire, les Classiques), Mes parties, import/export SGF, français et anglais, goban 2D. KataGo tourne sur le téléphone (iPhone : Neural Engine ; Android : processeur) après un téléchargement unique de deux réseaux depuis katagotraining.org (iPhone : Humain 99 Mo + Rapide 98 Mo ; Android : Humain 99 Mo + Rapide 14 Mo). OGS est facultatif sur téléphone comme sur ordinateur : parties classées, défis, observation et correspondance au premier plan. Le goban 3D reste réservé au bureau. Pas de compte Masame, pas de publicité, pas de statistiques d'usage, pas d'achat intégré.

URL de la politique de confidentialité, pour les deux stores : **https://github.com/Slymaster/masame/blob/main/PRIVACY.md**. Elle ne répond qu'une fois develop fusionné dans main ; d'ici là, https://github.com/Slymaster/masame/blob/develop/PRIVACY.md fonctionne (à remplacer par l'adresse `main` à la release). Adresse de contact publique, dans PRIVACY.md et ici : `sylvain@guarani-llc.com`.

Les captures d'écran ne sont pas dans le dépôt. Style retenu le 16 octobre 2026 : **B, légendé** (un titre en Cormorant italique sur fond lin au-dessus de l'écran). Les fichiers à déposer, rangés par store et par langue avec un LISEZ-MOI, sont dans `design/screenshots/masame-stores-0.5.0/` (ignoré par git).

---

## App Store Connect

Langues de la fiche : **anglais (U.S.)** comme langue principale, et **français**. Pour la France, l'App Store indexe aussi les mots-clés de la fiche anglais (U.K.) : facultatif, une fiche anglais (U.K.) qui reprend celle des U.S. avec d'autres mots-clés élargit la recherche.

### Informations sur l'app

**Nom** (limite 30) : EN (6 caractères)

```
Masame
```

FR (6 caractères)

```
Masame
```

Si « Masame » est déjà pris sur l'App Store (le nom doit être unique), repli : EN (9 caractères)

```
Masame Go
```

et, en dernier recours, (24 caractères)

```
Masame: Go, Baduk, Weiqi
```

Le nom affiché sous l'icône reste « Masame » (CFBundleDisplayName) quel que soit le nom de la fiche.

**Sous-titre** (limite 30) : EN (20 caractères)

```
Learn Go with KataGo
```

FR (26 caractères)

```
Apprends le go avec KataGo
```

**Catégorie principale** : Jeux, sous-catégories **Société** (Board) et **Stratégie** (Strategy).
**Catégorie secondaire** : Éducation.

**Copyright** (le titulaire des droits, précédé de l'année ; même ligne que `LICENSE`) :

```
2026 Sylvain Rey
```

Le vendeur affiché sur la fiche sera GUARANI LLC, nom du compte développeur ; c'est normal et indépendant du copyright.

**Droits sur le contenu** (« Does your app contain, show, or access third-party content? ») : **Oui**, et **« I have the necessary rights »** coché. Les deux contenus tiers :

- Les réseaux de KataGo, téléchargés par l'app depuis katagotraining.org, le site officiel du projet KataGo, sous la [KataGo Neural Network License](https://katagotraining.org/network_license/), qui en permet l'usage et la redistribution, y compris dans une app. Masame n'en embarque aucun.
- Les Classiques : 21 parties de l'époque Edo (1603–1867), relevées dans des sources publiques et librement accessibles, nommées partie par partie dans `public/assets/classics/SOURCES.md`. Seuls les coups, les joueurs, le résultat et la date sont repris (faits historiques) ; aucun commentaire, aucune base commerciale (GoGoD, Go4Go).

### Prix et disponibilité

Gratuit, tous les pays. Pas d'achat intégré.

### Version 0.5.0

**Texte promotionnel** (limite 170, modifiable sans nouvelle version) : EN (169 caractères)

```
KataGo plays you at your rank, shows where your points went and turns your mistakes into exercises. Joseki, fuseki, tsumego, the Edo classics. Offline play is free without an account; online OGS is optional.
```

FR (168 caractères)

```
KataGo joue à ton niveau, te montre où filent tes points et fait de tes erreurs des exercices. Joseki, fuseki, tsumego, parties d'Edo. Hors ligne, gratuit, sans compte.
```

**Description** (limite 4000) : EN (2708 caractères)

```
Masame is a Go board and a teacher. Across the goban sits KataGo, the open-source Go engine, playing not like a machine but like a human of the rank you choose, from 20 kyu to 9 dan. After each game it shows you where your points went, and your own mistakes come back as exercises.

KataGo runs on your iPhone itself, on the Neural Engine. Download its two networks once, from the app (about 200 MB, from katagotraining.org, the official KataGo site). After that, Masame plays and reviews offline.

PLAY
• KataGo's human-like network, calibrated by rank, from 20k to 9d. It can follow your level as you play.
• Handicap games from 2 to 9 stones, proposed from the gap between your level and the AI's.
• Masters of an era: the professional style of 1850, 1900, 1935, 1970, 2005 or 2023, with the handicap of the old teaching games.
• The mentor: switch it on and Masame stops a move that costs too much. Try again, or keep it.
• 9×9, 13×13 and 19×19, against the AI or with a friend on the same phone. A game in progress survives closing the app.

REVIEW
• After a game, up to three key moments where a move cost the most points, each a short lesson: find the punishment yourself, see it, then see the better move.
• Candidate moves on any position, with the points each one loses.
• The rank your moves resemble, game by game and phase by phase, and where you lose your points.

LEARN
• Today: a ritual of about ten minutes. Exercises, tsumego and counting from your games, a few joseki or fuseki cards, then a 9×9 at your level.
• Exercises from your games, with spaced repetition: find a better move, and KataGo grades it.
• Tsumego from your games: life-and-death problems found in your own positions.
• Counting: who leads, and by how much? Then KataGo's count.
• Joseki and fuseki: each candidate move with the points it loses and how often players of your level choose it, then practice against an opponent of your level.
• The Classics: twenty-one games of the Edo period, from Dosaku to Shusaku's ear-reddening game. Play each move before you see the master's, and KataGo tells you what yours costs.
• Replay from memory: replay a finished game, both colours, move by move.

MY GAMES
• Every game kept on your phone, with its result, its key moments and your scores.
• Import and export SGF files through the Files app.

The board is drawn with the grain of kaya, slate and shell stones. In English and French.

No account, no ads, no tracking, no in-app purchases. Your games stay on your phone. Masame is free and open source (MIT licence): github.com/Slymaster/masame

Optional online play on OGS: ranked games, challenges, watching and correspondence, with secure browser sign-in. The 3D board remains desktop-only. Phone notifications are not available while the app is closed.
```

FR (3048 caractères)

```
Masame, c'est un goban et un professeur. En face de toi, KataGo, le moteur de go open source, qui ne joue pas comme une machine mais comme un joueur humain du rang que tu choisis, de 20 kyu à 9 dan. Après chaque partie, il te montre où sont partis tes points, et tes propres erreurs reviennent sous forme d'exercices.

KataGo tourne sur ton iPhone lui-même, sur le Neural Engine. Télécharge une fois ses deux réseaux depuis l'app (environ 200 Mo, sur katagotraining.org, le site officiel de KataGo). Ensuite, Masame joue et analyse hors ligne.

JOUER
• Le réseau humain de KataGo, calibré par rang, de 20k à 9d. Il peut suivre ton niveau au fil des parties.
• Parties à handicap de 2 à 9 pierres, proposées selon l'écart entre ton niveau et celui de l'IA.
• Maîtres d'une époque : le style des professionnels de 1850, 1900, 1935, 1970, 2005 ou 2023, avec le handicap des parties d'enseignement d'autrefois.
• Le mentor : active-le, et Masame t'arrête quand un coup coûte trop cher. Rejoue, ou garde-le.
• 9×9, 13×13 et 19×19, contre l'IA ou contre un ami sur le même téléphone. Une partie en cours survit à la fermeture de l'app.

REVUE
• Après une partie, jusqu'à trois moments clés où un coup a coûté le plus de points, chacun une courte leçon : trouve toi-même la punition, vois-la, puis vois le meilleur coup.
• Les coups candidats sur n'importe quelle position, avec les points que chacun perd.
• Le rang auquel ressemblent tes coups, partie par partie et phase par phase, et où tu perds tes points.

APPRENDRE
• Aujourd'hui : un rituel d'une dizaine de minutes. Des exercices, des tsumego et du comptage tirés de tes parties, quelques cartes de joseki ou de fuseki, puis un 9×9 à ton niveau.
• Exercices tirés de tes parties, en répétition espacée : trouve un meilleur coup, et KataGo le note.
• Tsumego tirés de tes parties : des problèmes de vie et de mort trouvés dans tes propres positions.
• Compter : qui mène, et de combien ? Puis le compte de KataGo.
• Joseki et fuseki : chaque coup candidat avec les points qu'il perd et la fréquence à laquelle les joueurs de ton niveau le jouent, puis l'entraînement contre un adversaire de ton niveau.
• Les Classiques : vingt et une parties de l'époque Edo, de Dosaku à la partie de l’oreille rouge de Shusaku. Joue chaque coup avant de voir celui du maître, et KataGo te dit ce que coûte le tien.
• Rejouer de mémoire : rejoue une partie terminée, les deux couleurs, coup par coup.

MES PARTIES
• Toutes tes parties gardées sur ton téléphone, avec leur résultat, leurs moments clés et tes scores.
• Import et export de fichiers SGF par l'app Fichiers.

Le goban porte le veinage du kaya, avec des pierres d'ardoise et de coquillage. En français et en anglais.

Pas de compte, pas de publicité, pas de pistage, pas d'achat intégré. Tes parties restent sur ton téléphone. Masame est gratuit et open source (licence MIT) : github.com/Slymaster/masame

Le jeu en ligne OGS est facultatif : parties classées, défis, observation et correspondance, avec connexion sécurisée dans le navigateur. Le goban 3D reste sur ordinateur. Pas de notifications lorsque l’app téléphone est fermée.
```

**Mots-clés** (limite 100, séparés par des virgules sans espace ; Apple indexe déjà le nom et le sous-titre, donc ni « Masame », « Go », « KataGo », « learn » ni « apprends » ici) : EN (93 caractères)

```
baduk,weiqi,igo,tsumego,joseki,fuseki,goban,sgf,AI,board,game,strategy,kyu,dan,review,offline
```

FR (99 caractères)

```
baduk,weiqi,igo,tsumego,joseki,fuseki,goban,sgf,IA,jeu,plateau,stratégie,kyu,dan,analyse,hors ligne
```

**Nouveautés de cette version** (limite 4000) : EN (276 caractères)

```
The first version of Masame for iPhone. Play KataGo at your level, see the review of every game, learn with the daily ritual, the trainers and the Classics, and keep your games on your phone, on the kaya board. This release adds optional online play on OGS while the app is visible. The 3D board remains desktop-only.
```

FR (320 caractères)

```
La première version de Masame pour iPhone. Joue contre KataGo à ton niveau, retrouve la revue de chaque partie, apprends avec le rituel du jour, les entraînements et les Classiques, et garde tes parties sur ton téléphone, sur le goban en kaya. Cette version ajoute OGS au premier plan. Le goban 3D reste réservé à l’ordinateur.
```

**URL d'assistance** :

```
https://github.com/Slymaster/masame/issues
```

**URL marketing** :

```
https://github.com/Slymaster/masame
```

**URL de la politique de confidentialité** :

```
https://github.com/Slymaster/masame/blob/main/PRIVACY.md
```

### Classification par âge (questionnaire) → 4+

Réponds **Aucun / None** ou **Non / No** partout :

| Rubrique | Réponse |
|---|---|
| Fonctions intégrées : contrôle parental, vérification de l'âge | Non (rien à contrôler) |
| Accès web sans restriction (navigateur intégré) | Non : un lien s'ouvre dans Safari, l'app ne navigue pas sur le web |
| Contenu généré par les utilisateurs | Non |
| Messagerie et discussion | Non |
| Publicité | Non |
| Thèmes pour adultes, horreur/peur, grossièretés, humour grossier | Aucun |
| Violence (dessinée, réaliste, prolongée), armes | Aucune |
| Contenu sexuel, nudité | Aucun |
| Alcool, tabac, drogues | Aucun |
| Informations médicales ou de bien-être | Non |
| Jeux d'argent simulés, jeux d'argent réels, concours, loot boxes | Non |

Résultat attendu : **4+**. Ne coche pas « Made for Kids » (catégorie Enfants) : l'app convient à tous, mais la catégorie Enfants impose des règles (pas de liens sortants sans contrôle parental, entre autres) que Masame ne vise pas.

### Confidentialité de l'app avec OGS

Ne pas reconduire la réponse « Données non collectées » de la première version hors ligne. OGS reçoit les identifiants
de compte et d'installation, les actions et le contenu des parties en ligne. Déclarer **User ID**, **Device ID** et
**Gameplay Content**, liés au compte et utilisés pour **App Functionality**, sans tracking, publicité ni analytics.
Le manifeste `PrivacyInfo.xcprivacy` reflète ces catégories. Vérifier les pratiques OGS et l'hôte callback avant la soumission.

Le mot de passe reste dans le navigateur système chez OGS ; le refresh token reste dans le Keychain iOS ou le coffre
Android Keystore. L'hôte HTTPS du callback ne reçoit qu'un code à usage unique protégé par PKCE et son state.
Le jeu local reste utilisable sans compte. Pas de chat intégré et pas de push lorsque l'app téléphone est fermée.

Références à revalider à la release : [déclarations Apple](https://developer.apple.com/app-store/app-privacy-details/),
[Data safety Google Play](https://support.google.com/googleplay/android-developer/answer/10787469).

### Conformité à l'export (chiffrement)

Déjà déclarée dans l'Info.plist : `ITSAppUsesNonExemptEncryption = false`. App Store Connect ne pose donc plus la question à chaque build. Pourquoi c'est exact : sur iPhone, Masame n'utilise que le chiffrement fourni par iOS, pour le HTTPS des téléchargements (le client réseau passe par le TLS d'Apple, `native-tls`, et non par une bibliothèque de chiffrement embarquée). Les tokens sont protégés par le Keychain du système ; PKCE et les téléchargements utilisent SHA-256, un hachage plutôt qu’un chiffrement de données. Un usage limité au chiffrement du système est exempté, et la France ne demande alors pas de déclaration à l'ANSSI. Si un jour l'app embarque son propre chiffrement (rustls, par exemple), il faudra revoir cette réponse.

### Notes pour l'App Review (en anglais)

Informations de connexion : jeu local sans compte ; OGS exige un compte OGS facultatif. Pour une revue des fonctionnalités connectées, fournir un compte de test dédié dans les champs privés de review, après autorisation du propriétaire. Coordonnées : ton nom, ton téléphone, `sylvain@guarani-llc.com`.

```
No sign-in is needed for local play and learning. OGS sign-in is optional for online play; Masame has no account of its own.

Masame is a Go (baduk) app. Its AI opponent and its game review use KataGo, an open-source Go engine that runs on the device. KataGo needs two neural networks, which the app downloads once, on the user's request, from katagotraining.org, the official KataGo distribution site (Human 99 MB and Fast 98 MB). Please use Wi-Fi.

To download them: on the first screen, the card says the AI needs its networks; tap "Open networks" (in French: "Ouvrir les réseaux") and download both. They are also in Settings › Networks. Each file is checked against a published SHA-256 before use.

These downloads are neural-network weights, that is data read by the engine, never executable code (guideline 2.5.2). All of the app's code is in the binary under review.

Once the networks are installed: Play › New game against the AI. Each time the engine starts, it spends about 11 seconds preparing the networks for the Neural Engine ("Preparing the engine…"); the first move comes right after. After a game, the review shows its key moments. Learn holds the daily ritual, the joseki and fuseki trainers and the Classics.

Online play on OGS is optional. Play > OGS offers browser sign-in, ranked games, challenges, watching and correspondence. The system browser returns through a verified HTTPS Universal Link. No chat or phone push is included. OGS games keep running on the server while the app is suspended; the board and clock are refreshed on return. Engine help is disabled during ongoing games. Please provide a dedicated OGS review account through the store review credentials field if review requires authenticated play; no credentials belong in this document.

Masame is free and open source (MIT): https://github.com/Slymaster/masame
```

---

## Google Play Console

Langue par défaut de la fiche : **anglais (États-Unis) – en-US**, avec une traduction **français – fr-FR**.

### Fiche principale du Store

**Nom de l'app** (limite 30) : EN (6 caractères)

```
Masame
```

FR (6 caractères)

```
Masame
```

Si Play le refuse (les noms n'y sont pas exclusifs, ça ne devrait pas arriver) : « Masame Go » (9).

**Description courte** (limite 80) : EN (77 caractères)

```
Play and learn Go (baduk) against KataGo, at your level. Offline play needs no account; online OGS is optional.
```

FR (76 caractères)

```
Joue et apprends le go contre KataGo, à ton niveau. Hors ligne, sans compte.
```

**Description complète** (limite 4000) : EN (2753 caractères)

```
Masame is a Go board and a teacher. Across the goban sits KataGo, the open-source Go engine, playing not like a machine but like a human of the rank you choose, from 20 kyu to 9 dan. After each game it shows you where your points went, and your own mistakes come back as exercises.

KataGo runs on your phone itself, on its processor. Download its two networks once, from the app (about 113 MB, from katagotraining.org, the official KataGo site). After that, Masame plays and reviews offline. On a phone's processor, a full review takes longer than on a computer.

PLAY
• KataGo's human-like network, calibrated by rank, from 20k to 9d. It can follow your level as you play.
• Handicap games from 2 to 9 stones, proposed from the gap between your level and the AI's.
• Masters of an era: the professional style of 1850, 1900, 1935, 1970, 2005 or 2023, with the handicap of the old teaching games.
• The mentor: switch it on and Masame stops a move that costs too much. Try again, or keep it.
• 9×9, 13×13 and 19×19, against the AI or with a friend on the same phone. A game in progress survives closing the app.

REVIEW
• After a game, up to three key moments where a move cost the most points, each a short lesson: find the punishment yourself, see it, then see the better move.
• Candidate moves on any position, with the points each one loses.
• The rank your moves resemble, game by game and phase by phase, and where you lose your points.

LEARN
• Today: a ritual of about ten minutes. Exercises, tsumego and counting from your games, a few joseki or fuseki cards, then a 9×9 at your level.
• Exercises from your games, with spaced repetition: find a better move, and KataGo grades it.
• Tsumego from your games: life-and-death problems found in your own positions.
• Counting: who leads, and by how much? Then KataGo's count.
• Joseki and fuseki: each candidate move with the points it loses and how often players of your level choose it, then practice against an opponent of your level.
• The Classics: twenty-one games of the Edo period, from Dosaku to Shusaku's ear-reddening game. Play each move before you see the master's, and KataGo tells you what yours costs.
• Replay from memory: replay a finished game, both colours, move by move.

MY GAMES
• Every game kept on your phone, with its result, its key moments and your scores.
• Import and export SGF files.

The board is drawn with the grain of kaya, slate and shell stones. In English and French.

No account, no ads, no tracking, no in-app purchases. Your games stay on your phone. Masame is free and open source (MIT licence): github.com/Slymaster/masame

Optional online play on OGS: ranked games, challenges, watching and correspondence, with secure browser sign-in. The 3D board remains desktop-only. Phone notifications are not available while the app is closed.
```

FR (3127 caractères)

```
Masame, c'est un goban et un professeur. En face de toi, KataGo, le moteur de go open source, qui ne joue pas comme une machine mais comme un joueur humain du rang que tu choisis, de 20 kyu à 9 dan. Après chaque partie, il te montre où sont partis tes points, et tes propres erreurs reviennent sous forme d'exercices.

KataGo tourne sur ton téléphone lui-même, sur son processeur. Télécharge une fois ses deux réseaux depuis l'app (environ 113 Mo, sur katagotraining.org, le site officiel de KataGo). Ensuite, Masame joue et analyse hors ligne. Sur le processeur d'un téléphone, une revue complète prend plus de temps que sur un ordinateur.

JOUER
• Le réseau humain de KataGo, calibré par rang, de 20k à 9d. Il peut suivre ton niveau au fil des parties.
• Parties à handicap de 2 à 9 pierres, proposées selon l'écart entre ton niveau et celui de l'IA.
• Maîtres d'une époque : le style des professionnels de 1850, 1900, 1935, 1970, 2005 ou 2023, avec le handicap des parties d'enseignement d'autrefois.
• Le mentor : active-le, et Masame t'arrête quand un coup coûte trop cher. Rejoue, ou garde-le.
• 9×9, 13×13 et 19×19, contre l'IA ou contre un ami sur le même téléphone. Une partie en cours survit à la fermeture de l'app.

REVUE
• Après une partie, jusqu'à trois moments clés où un coup a coûté le plus de points, chacun une courte leçon : trouve toi-même la punition, vois-la, puis vois le meilleur coup.
• Les coups candidats sur n'importe quelle position, avec les points que chacun perd.
• Le rang auquel ressemblent tes coups, partie par partie et phase par phase, et où tu perds tes points.

APPRENDRE
• Aujourd'hui : un rituel d'une dizaine de minutes. Des exercices, des tsumego et du comptage tirés de tes parties, quelques cartes de joseki ou de fuseki, puis un 9×9 à ton niveau.
• Exercices tirés de tes parties, en répétition espacée : trouve un meilleur coup, et KataGo le note.
• Tsumego tirés de tes parties : des problèmes de vie et de mort trouvés dans tes propres positions.
• Compter : qui mène, et de combien ? Puis le compte de KataGo.
• Joseki et fuseki : chaque coup candidat avec les points qu'il perd et la fréquence à laquelle les joueurs de ton niveau le jouent, puis l'entraînement contre un adversaire de ton niveau.
• Les Classiques : vingt et une parties de l'époque Edo, de Dosaku à la partie de l’oreille rouge de Shusaku. Joue chaque coup avant de voir celui du maître, et KataGo te dit ce que coûte le tien.
• Rejouer de mémoire : rejoue une partie terminée, les deux couleurs, coup par coup.

MES PARTIES
• Toutes tes parties gardées sur ton téléphone, avec leur résultat, leurs moments clés et tes scores.
• Import et export de fichiers SGF.

Le goban porte le veinage du kaya, avec des pierres d'ardoise et de coquillage. En français et en anglais.

Pas de compte, pas de publicité, pas de pistage, pas d'achat intégré. Tes parties restent sur ton téléphone. Masame est gratuit et open source (licence MIT) : github.com/Slymaster/masame

Le jeu en ligne OGS est facultatif : parties classées, défis, observation et correspondance, avec connexion sécurisée dans le navigateur. Le goban 3D reste sur ordinateur. Pas de notifications lorsque l’app téléphone est fermée.
```

**Éléments graphiques** : icône 512×512 (`icon-512.png`), image de présentation 1024×500 sans texte (`feature-graphic.png`, une seule pour les deux langues), 6 captures téléphone par langue (1080×2400). Voir `design/screenshots/masame-stores-0.5.0/google-play/`.

### Paramètres du Store

- **Type** : Jeu. **Catégorie** : **Société** (Board).
- **Tags** (jusqu'à 5, à choisir dans la liste de la console) : Board, Abstract strategy, Strategy, Single player, Offline. S'il en manque un dans la liste proposée, Classic ou Puzzle.
- **Coordonnées** : adresse e-mail (obligatoire, publique) `sylvain@guarani-llc.com` ; site web `https://github.com/Slymaster/masame` ; téléphone : facultatif, à laisser vide.
- **Règles relatives aux contenus › Politique de confidentialité** : `https://github.com/Slymaster/masame/blob/main/PRIVACY.md`.

### Contenu de l'app (Règles et programmes › Contenu de l'app)

**Accès à l'app** : le jeu local et l'apprentissage sont libres d'accès ; les parties en ligne nécessitent un compte OGS
facultatif. Déclarer cette restriction et fournir un compte de test dans les champs privés de Play Console pour la revue
OGS, après accord du propriétaire. Ne conserver aucun mot de passe dans le dépôt. Les réseaux locaux se téléchargent
une fois depuis Settings › Networks (113 Mo sur Android, Wi-Fi conseillé).

**Annonces** : « Non, mon app ne contient pas d'annonces ».

**Classification du contenu** (questionnaire IARC) :

- Adresse e-mail : `sylvain@guarani-llc.com`. Catégorie : **Jeu** (« Game »), pas « Divertissement » ni « Autre ».
- Violence, peur, sexualité, langage grossier, substances contrôlées, humour grossier : **Non** partout.
- Jeux d'argent simulés ou réels, contenu de type loterie : **Non**.
- « Les utilisateurs peuvent-ils interagir ou échanger du contenu ? » : **Oui**, via les coups et défis OGS. Il n’y a pas de chat intégré. Réévaluer la classification IARC avec ce parcours réel au lieu de reconduire la réponse de la version hors ligne.
- Partage de la position géographique : **Non**. Achats de biens numériques : **Non**. Navigateur web ou moteur de recherche : **Non**.
- Résultat attendu : PEGI 3, ESRB Everyone, USK 0, et l'équivalent « tous publics » ailleurs.

**Public cible et contenus** : coche **13-15, 16-17 et 18 ans et plus**, pas les tranches de moins de 13 ans. À « L'app pourrait-elle attirer involontairement les enfants ? », réponds **Non**. Pourquoi : cocher une tranche de moins de 13 ans fait entrer l'app dans le programme Familles de Google (règles Familles, déclarations supplémentaires, contrôle renforcé à chaque mise à jour) sans rien apporter ici. L'app convient pourtant à tous (PEGI 3) : rien n'empêche un enfant de l'installer, Le parcours OGS facultatif transmet des données à OGS et doit être pris en compte dans les déclarations. Ce choix pourra changer si une version pour les enfants est un jour visée.

**Sécurité des données** (Data safety) :

- Réévaluer le formulaire avec OGS. Les identifiants utilisateur/installation et le contenu des parties sont transmis à OGS
  pour le compte et le multijoueur ; ce sont des catégories facultatives liées au parcours en ligne, chiffrées en transit.
- Ne pas réutiliser l'affirmation « seules requêtes vers katagotraining.org » ou « aucune donnée collectée ». Vérifier les
  catégories et les exemptions de partage pour les transferts explicitement initiés par l'utilisateur selon la documentation Google.
- Pas de compte Masame créé. Le compte OGS et les parties en ligne se gèrent/suppriment sur OGS ; la déconnexion Masame
  efface seulement les identifiants locaux et tente leur révocation. Répondre aux exigences de suppression de compte applicables
  après validation du parcours OGS et fournir le lien de gestion du compte demandé par le formulaire.
- L'auteur ne reçoit ni analytics, ni rapports de plantage. Pas de tracking, d'identifiant publicitaire ou de permissions sensibles.
  Le coffre mobile et les transactions PKCE sont exclus des sauvegardes. Voir `PRIVACY.md` et `docs/ogs-mobile.md`.

**Identifiant publicitaire** : « Non, mon app n'utilise pas l'identifiant publicitaire ».

**Autres déclarations** : app d'actualités : non ; app de santé : non ; fonctionnalités financières : aucune ; app gouvernementale : non ; services de premier plan, autorisations sensibles (position, SMS, journal d'appels, accès à tous les fichiers) : aucun.

### Test interne : notes de version

Limite 500 caractères par langue, avec les balises de langue de la console.

EN (376 caractères)

```
First test version of Masame for Android. Play KataGo at your level, see the review of every game, learn with the daily ritual, the trainers and the Classics. KataGo runs on your phone's processor after a one-time download of two networks (113 MB) from Settings › Networks. Optional OGS online play is available while the app is visible. The 3D board remains desktop-only. Please report problems at github.com/Slymaster/masame/issues.
```

FR (426 caractères)

```
Première version de test de Masame pour Android. Joue contre KataGo à ton niveau, retrouve la revue de chaque partie, apprends avec le rituel du jour, les entraînements et les Classiques. KataGo tourne sur le processeur de ton téléphone après un téléchargement unique de deux réseaux (113 Mo) dans Réglages › Réseaux. OGS est disponible au premier plan. Le goban 3D reste sur ordinateur. Signale les problèmes sur github.com/Slymaster/masame/issues.
```

Collées dans la console :

```
<en-US>
(texte EN ci-dessus)
</en-US>
<fr-FR>
(texte FR ci-dessus)
</fr-FR>
```

---

## À vérifier avant d'envoyer

- Le nom « Masame » libre dans App Store Connect (il est réservé dès la création de la fiche).
- PRIVACY.md joignable à l'adresse `main` le jour de la soumission.
- Les captures correspondent à la version envoyée (0.5.0).
