# Masame (柾目) — proposition : le meilleur logiciel de go de 2026

*Rédigée le 11 octobre 2026. Elle s'appuie sur cinq recherches vérifiées aux sources : le marché, les joseki, les usages réels chiffrés, l'esthétique et Windows. Elle s'appuie aussi sur ce que nous avons construit et mesuré : les étapes 0 et 1, et le prototype 3D. English version: [proposal.en.md](proposal.en.md).*

*Le projet s’appelait « Baduk » (nom de travail) quand cette proposition a été rédigée ; il s’appelle désormais **Masame**.*

---

## En une phrase

**Le premier logiciel de go qui ressemble à un vrai goban et qui enseigne comme un vrai professeur.** C'est un objet d'artisan, rendu en lumière réelle. On y joue contre une IA qui se comporte comme un humain de ton niveau, ou en ligne sur OGS. Une boucle *jouer → comprendre → s'entraîner* transforme chaque partie en progrès. Il tourne sur Mac et Windows, en français et en anglais, hors ligne si on veut, sans publicité ni abonnement.

---

## 1. Ce qui est vraiment utilisé en octobre 2026

### Les chiffres (relevés le 11 octobre 2026)

Les sources sont l'API GitHub, Google Play, l'App Store, Similarweb, l'API d'OGS et r/baduk. Les chiffres asiatiques sont déclaratifs et datés : ce sont des ordres de grandeur.

| Usage | Qui domine | Chiffres clés |
|---|---|---|
| Jeu en ligne, Chine | **Fox Weiqi (野狐)** | 30 M de comptes et plus de 1 M d'actifs par mois (chiffres officiels de 2022), plus de 1 000 pros actifs, 20 000 à 40 000 joueurs connectés en même temps (estimations) |
| Jeu en ligne, Corée | Tygem | 3,8 M de membres (2016), ≈ 10 000 connectés |
| Jeu en ligne, Occident | **OGS** | 2,12 M de comptes (+640 par jour), ≈ 29 600 parties par jour, 1,6 M de visites par mois, dont 6 % depuis la France |
| Analyse IA sur ordinateur | KataGo, avec KaTrain, Sabaki, LizzieYzy | Téléchargements cumulés : KataGo 1,06 M, Sabaki 552 k, KaTrain 289 k. Environ 24 000 téléchargements par mois en tout, **à 65–90 % sous Windows contre 6–17 % sous Mac** |
| Analyse IA sur le web | AI Sensei | 133 000 visites par mois |
| Apprentissage sur mobile | BadukPop, Tsumego Pro | BadukPop : 2,17 M d'installations Android, 36 400 notes iOS (4,8★). Tsumego Pro : 2,13 M d'installations |
| Problèmes sur le web | 101weiqi | 583 000 visites par mois |
| Steam | — | Aucun vrai logiciel de go ne dépasse 16 avis |

### Ce que les joueurs font vraiment

Échantillon : 400 parties OGS tirées au hasard, du 4 au 11 octobre 2026.
- **92 % de parties en direct, rapides ou blitz**, d'une durée moyenne de 10 minutes. 6 % se jouent par correspondance.
- **47 % en 19×19, 42 % en 9×9**, 10 % en 13×13.
- 34 % des parties impliquent un bot, et 24 % des parties entre humains se jouent avec handicap.
- **75 % des parties terminées reçoivent une revue KataGo automatique.** Environ 5 % seulement ont droit à une revue approfondie payante.
- Usages classés selon les données : jeu classé en ligne, puis revue IA, tsumego quotidien, parties d'entraînement contre des bots, et enfin joseki (beaucoup de questions, aucun outil vraiment utilisé).

### Les six enseignements qui orientent le plan

1. **Le jeu en ligne est l'usage n°1, et la communauté veut qu'on se branche sur OGS.** Au lancement d'un nouveau serveur en octobre 2026, la réponse la plus votée demandait de *se connecter à OGS*. Le client OGS remonte donc dans la feuille de route.
2. **Le 9×9 pèse presque autant que le 19×19.** « Un 9×9 en 10 minutes contre un humain de ton niveau » doit être un moment parfait.
3. **L'adversaire « humain » est LA fonction de 2024–2026.** Le réseau humain est le 4e fichier le plus téléchargé de KataGo (39 000 fois). AI Sensei, BadukPop, SmartGo et KaTrain en vendent tous une version. Il faut la meilleure.
4. **La revue IA de base est déjà gratuite partout.** Ce qui manque :
   - le *pourquoi* ;
   - l'analyse **« devine puis révèle »** ;
   - la **revue à deux** (absente d'OGS).

   Les joueurs forts se méfient des explications rédigées par une IA de langage. Les nôtres seront **calculées à partir des données du moteur, et vérifiables**.
5. **L'analyse sur ordinateur, c'est Windows** (65–90 % des téléchargements). La version Windows n'est pas une option.
6. **Le tsumego est l'habitude quotidienne, et le volume est sur mobile.** D'où le rituel quotidien. Une version tablette et mobile est à envisager plus tard : Tauri 2 sait le faire.

---

## 2. Le constat : chacun excelle sur une seule case

| Besoin | Le meilleur aujourd'hui | Sa limite |
|---|---|---|
| Jouer en ligne | Fox (Asie), OGS (Occident) | Interfaces denses ou contestées. La refonte d'OGS en septembre 2026 a déclenché une forte contestation. |
| Jouer contre une IA « humaine » | KaTrain 1.20, AI Sensei, BadukPop | Fonctions enfouies, interface terne, web ou abonnement |
| Revue IA | Revue automatique d'OGS, AI Sensei, KaTrain | Courbes de taux de victoire, **aucun pourquoi**, ni « devine puis révèle » ni revue à deux |
| Tsumego | Tsumego Pro, 101weiqi, BadukPop | Banques génériques, pas d'explication en cas d'erreur, abonnement |
| Joseki | OGS Joseki Explorer, Josekipedia, Joseki Dojo | Arbres figés ou outils bruts |
| Apprendre de ses erreurs | GoReview (iOS, 2026) | iOS seulement |
| Beauté | SmartGo One (sobriété), Sabaki (textures) | **Aucune app ne paraît haut de gamme** |

**Le trou du marché** : personne ne réunit la beauté, une IA humaine, le pourquoi, l'entraînement personnalisé et le jeu en ligne dans une seule boucle, sur Mac *et* Windows.

---

## 3. La proposition : six piliers et une boucle

```
   JOUER  ──────────►  COMPRENDRE  ──────────►  S'ENTRAÎNER
 (IA humaine, OGS,     (3 moments clés,          (rituel quotidien :
  9×9 en 10 min)        devine puis révèle,       tsumego et joseki
        ▲               ombre et lumière)         tirés de TES parties)
        └──────────────────────────────────────────────┘
```

1. **L'objet.** Un goban d'artisan rendu en lumière réelle : « Atelier vivant » (section 4).
2. **L'adversaire humain.**
   - Il joue comme un joueur de 20k à 9d, avec des temps de réflexion naturels. Pendant qu'il réfléchit, on l'entend remuer ses pierres dans le bol.
   - Un ajustement automatique vise 50 % de victoires.
   - Des parties de 9×9 en 10 minutes.
   - Le **salon des époques** propose de jouer contre le style de 1850, des années 1930 ou d'avant AlphaGo.
3. **Le professeur.**
   - **Chacune de tes parties est revue automatiquement sur ta machine**, y compris celles jouées sur OGS.
   - La revue s'arrête sur **les 3 moments qui ont décidé la partie**. Pour chacun, elle montre ce que tu as joué, ce qu'un joueur de ton rang joue d'habitude, et le meilleur coup.
   - Le mode **« devine puis révèle »** te fait proposer ton coup avant de voir la réponse.
   - Les **explications vérifiables** viennent des données du moteur. Exemple : « Ce coup a laissé le groupe de D4 sans base : −12 points ».
   - On peut **rejouer le moment** contre l'IA.
4. **L'entraînement personnel**, sous forme d'un **rituel de 10 minutes par jour**. Il puise dans :
   - des **tsumego tirés de tes propres parties**, vérifiés par KataGo ;
   - tes déviations de joseki ;
   - le **dojo joseki** : lentille de rang, punir l'erreur, choisir le bon joseki selon le goban entier.

   Le tout est révisé par répétition espacée (de type FSRS).
5. **Branché sur le monde.**
   - **Le plus beau client OGS** : jeu classé en direct, import de tes parties par pseudo, revue locale automatique.
   - Import SGF (Fox, KGS, Tygem).
   - Plus tard : revue à deux et photo d'un vrai goban.
6. **Partout et honnête.**
   - Mac et Windows, français et anglais.
   - Hors ligne pour l'IA, données privées.
   - Gratuit, code ouvert recommandé.
   - KataGo crédité, réseaux à jour depuis le catalogue officiel.

---

## 4. L'esthétique poussée au maximum : « Atelier vivant »

Le premier prototype était un fichier local (`design/atelier3d/`, absent du dépôt), remplacé depuis par le rendu de `src/board3d/`.

### Ce qui est déjà démontré
- **Les vraies proportions** d'un goban :
  - cases de 22 × 23,7 mm, donc plus longues que larges ;
  - lignes de 1 mm à l'encre laquée, hoshi de 4 mm ;
  - plateau de 424 × 454 mm, pierres bombées de 22,2 mm (noires) et 21,9 mm (blanches).

  Aucune app ne respecte ces proportions.
- **Les matières.**
  - Les pierres noires sont en ardoise satinée à micro-rugosité, pas en plastique brillant.
  - Les pierres blanches sont en coquillage à stries de croissance, toutes différentes.
  - Chaque pierre est légèrement décalée, comme posée à la main, et voisines se repoussent sans se chevaucher.
- **La lumière** : un éclairage d'intérieur réel (HDRI sous licence CC0) et une lumière principale qui suit l'heure, matin à 5 500 K, après-midi à 4 200 K, soir à 3 000 K.
- **Deux caméras.**
  - **Étude** : vue de dessus orthogonale, nette, sans reflets gênants. C'est le mode de jeu et d'analyse.
  - **Contemplation** : objectif de 28°, plateau incliné de 22° (avec les cases de 22 × 23,7 mm, elles apparaissent alors carrées). On voit l'épaisseur du plateau et les bols en mûrier, et les pierres capturées s'empilent sur les couvercles.
- **« Ombre et lumière » devient de la vraie lumière.** L'estimation du territoire est projetée comme une source lumineuse : le territoire de Blanc reçoit une lumière chaude, celui de Noir tombe dans l'ombre, sur le bois comme sur les pierres. **Aucune app de go ne fait ça.**
- **La pose** : la pierre tombe de 12 mm en 140 ms, son ombre se resserre, un frémissement de 0,4° suit, et les voisines bougent d'un demi-millimètre.
- **Performance mesurée** (M2 Max, 2880 × 1800) : 3,1 ms par image en Étude, 4,9 ms en Contemplation. Le rendu ne tourne que quand quelque chose bouge.

### Ce qu'il reste à faire pour atteindre le maximum
| Détail | Impact | Effort |
|---|---|---|
| **Sons enregistrés** : variantes selon la force, voisinage, capture qui claque sur le couvercle, réverbération de pièce, pierres remuées dans le bol pendant que l'IA réfléchit | Très fort (fait : sons CC0 enregistrés) | Faible à moyen |
| **Vrai bois de kaya** : une texture scannée à fibres visibles. Désormais du vrai bois scanné (ambientCG) étalonné en kaya doré ; reste un scan en plus haute résolution pour les gros plans. | Très fort (fait, sauf le scan haute résolution) | Faible |
| Translucidité et stries plus fines du coquillage | Fort | Moyen |
| Retour haptique du trackpad Mac sur les captures et la fin de partie | Moyen | Faible |
| Lumière qui suit l'heure réelle (option) | Moyen | Faible |
| **Fin de partie à l'ancienne** : en comptage, les territoires se réarrangent en rectangles, comme le font les joueurs | Fort (moment signature) | Moyen |
| **Mode léger 2D** : le rendu Canvas actuel, gardé comme repli pour les petites cartes graphiques | Indispensable | Déjà fait |

### Garde-fous de lisibilité
- En Étude, les pierres blanches gardent un contraste d'au moins 3:1 sur le bois (mesuré : 3,2 à 3,7 selon l'heure).
- Les effets sont coupés en analyse.
- Les animations sont désactivées si le système demande moins de mouvement.
- Une option « pierres à fort contraste » est prévue.
- Le 9×9 est soigné à part : les pierres y sont grandes, et chaque détail se voit.

---

## 5. Ce que ça bat, fonction par fonction

| Fonction | Meilleur existant | Notre version |
|---|---|---|
| Bot humain | KaTrain Human-like (menu caché), BadukPop | Rang de 20k à 9d mis en avant, époques, tempo humain, ajustement vers 50 % de victoires |
| Revue | Revue automatique OGS, AI Sensei | 3 moments clés, devine puis révèle, lentille de rang, explications vérifiables, rejouer le moment, toutes tes parties revues sur ta machine |
| Territoire | Carrés colorés | Ombre et lumière, en vraie lumière |
| Jeu en ligne | Site web d'OGS | Client OGS dans l'Atelier, revue automatique incluse |
| Tsumego | Banques génériques | Tirés de **tes** parties, vérifiés par KataGo, et des banques classiques en plus |
| Joseki | Arbres figés | Arbre de l'ère IA généré par nous, statistiques par rang, répétition espacée coup par coup, punition, contexte du goban entier |
| Réseaux IA | À configurer soi-même | Catalogue officiel en direct, sha256, catalogue officiel en direct avec sha256 *(déjà fait)* ; le choix automatique selon la machine est prévu (Accordage du moteur) |
| Comptage | Souvent approximatif | Pierres mortes proposées, un clic pour corriger, décompte japonais *(déjà fait)* |
| Beauté | Bois plat | Atelier vivant |
| Plateformes | Souvent une seule | Mac et Windows, français et anglais |

---

## 6. Mac et Windows : l'architecture

Une seule base de code : Tauri 2 (Rust), React/TypeScript et three.js.

### Le moteur KataGo
| | Mac | Windows |
|---|---|---|
| Version | 1.18.2, **compilée par nous en Metal** (aucune version officielle pour Mac) | 1.18.1 officielle |
| Livrée avec l'app | Le binaire Metal (≈ 11 Mo, autonome, macOS 13 et plus) | Les versions OpenCL (6 Mo) et CPU AVX2 (5,9 Mo). `OpenCL.dll` vient du pilote graphique ; s'il manque, l'app passe automatiquement sur le moteur CPU |
| Téléchargée à la demande | — | **OpenVINO** pour les puces Intel (jusqu'à 20 fois plus rapide qu'OpenCL sur Arc), **DirectML** en dernier recours, **CUDA** seulement si les bibliothèques NVIDIA sont déjà présentes (sinon 1,5 à 2 Go) |
| Détection | — | Liste des cartes graphiques via DXGI (NVIDIA, AMD, Intel, mémoire vidéo), test automatique et repli d'un niveau en cas d'échec |
| Sécurité | Code source de KataGo épinglé par commit, dépendances par sha256. Signé avec un Developer ID et notarisé par Apple depuis la v0.2.1. | Archives officielles épinglées par sha256 **dans le script de build**, extraction protégée contre les chemins piégés, dossier `%LOCALAPPDATA%`, processus rattaché à l'app (il s'arrête avec elle). Signature prévue. |

- **Premier lancement, « Accordage du moteur ».** L'app mesure la vitesse réelle de la machine, règle OpenCL et choisit le réseau par défaut (Léger, Équilibré ou Maximum). Les réseaux transformer sont lents sur Mac (≈ 130 positions/s pour l'Équilibré), et la variété des cartes Windows est énorme : il faut donc mesurer, pas deviner.
- **Moteur Mac** : autonome (protobuf et abseil liés en statique), macOS 13 ou plus, Apple Silicon. Le code source de KataGo est épinglé par commit.

### Fenêtre et rendu
- **Mac** : barre de titre intégrée, feux tricolores incrustés.
- **Windows** : barre native et effet Mica de Windows 11. On garde ainsi la disposition des fenêtres en mosaïque (Snap), qu'une barre sur mesure ferait perdre.
- **Rendu** : WebGL2 partout. WebGPU est disponible sur macOS 26 et sur la plupart des PC Windows, mais il n'est pas indispensable.
- **Petites cartes graphiques** : un régulateur ajuste résolution, ombres et anticrénelage, puis bascule en mode léger 2D si besoin. Windows utilise souvent la puce graphique intégrée, il faut donc prévoir ce cas.

### Construction
- GitHub Actions (`tauri-action` v1) sur des machines Mac et Windows, installeur NSIS en français et en anglais. Mises à jour automatiques signées en place depuis la v0.2.0.
- La construction Windows depuis un Mac existe, mais en dernier recours seulement.

---

## 7. Français et anglais

- Tous les textes sont déjà centralisés (`src/i18n/en.ts` et `src/i18n/fr.ts`), et le Rust ne renvoie que des codes.
- Deux dictionnaires typés, `fr` et `en` : un dictionnaire incomplet ne compile pas. Pas de bibliothèque lourde.
- La langue est détectée via `navigator.language`, avec un choix manuel dans les réglages.
- Les menus natifs, les boîtes de dialogue, l'installeur et la documentation existent dans les deux langues.
- Le vocabulaire du go reste celui de la communauté : kyu, dan, joseki, tsumego, sente, gote.
- La France pèse : 6 % des visites d'OGS, 4e marché iOS de SmartGo One et de Tsumego Pro.

---

## 8. Distribution, signature, code ouvert

- **Mac.** Le programme Apple Developer (99 $ par an) est nécessaire pour que l'app s'ouvre sans avertissement.
- **Windows.** Les certificats EV ne contournent plus SmartScreen. Trois options :
  1. **Code ouvert et SignPath Foundation** (gratuit pour les projets sous licence libre). *Recommandé.*
  2. Azure Artifact Signing (8,79 € par mois). Il est réservé aux organisations dans l'UE : un particulier en France n'y a pas accès.
  3. Un certificat OV sur HSM en ligne (prix non vérifié).
- **Code ouvert (licence MIT, comme KaTrain et Sabaki), recommandé.** Il montre le soin apporté et inspire confiance. Il ouvre aussi l'accès à la signature Windows gratuite et aux contributions.

---

## 9. Feuille de route, priorisée selon les usages réels

| Phase | Contenu | Pourquoi maintenant | État |
|---|---|---|---|
| **0. Le toucher** | Goban Atelier 2D, règles, SGF | — | ✅ fait |
| **1. L'adversaire** | KataGo Metal, gestionnaire de réseaux, bot humain, territoire, comptage | — | ✅ fait, vérifié, sécurité revue |
| **A. Fondations** | Français/anglais, version Windows (moteurs, détection, CI), moteur Mac autonome, code ouvert | Windows = 65–90 % des utilisateurs d'outils IA | Presque terminée : français/anglais fait ; moteur Mac autonome fait ; Windows écrit et compilé en CI, pas encore testé sur du matériel Windows ; préparation open source faite, publication en attente |
| **B. Atelier vivant** | Rendu 3D dans l'app, deux caméras, lumière, sons enregistrés, haptique, 9×9 soigné, repli 2D | La signature qui ne ressemble à rien d'existant | En cours : rendu 3D intégré comme goban principal avec repli 2D ; vrai bois CC0 et sons de pierres enregistrés faits. Reste : haptique, fin de partie à l'ancienne, option lumière selon l'heure réelle |
| **C. Le professeur** | Revue automatique locale, 3 moments clés, devine puis révèle, lentille de rang, explications vérifiables, rejouer le moment | Le 2e usage, et le « pourquoi » manque partout | |
| **D. Le monde** | Client OGS (jeu classé en direct, import par pseudo, revue de tes parties OGS) | L'usage n°1, et la demande explicite de la communauté | |
| **E. L'entraînement** | Rituel quotidien : tsumego tirés de tes parties, dojo joseki, répétition espacée | Le tsumego est l'habitude quotidienne ; le joseki est ton envie de départ | |
| **F. Les époques et le partage** | Salon des époques, revue à deux, photo d'un vrai goban, version tablette | La différenciation au long cours | |

*On peut remonter le dojo joseki (E) avant le client OGS (D) si l'apprentissage des joseki reste ta priorité personnelle.*

---

## 10. Décisions

**Prises le 11 octobre 2026** :
- **Direction 3D validée** : « Atelier vivant » devient le rendu principal, et la 2D sert de mode léger.
- **Tous les téléchargements sont autorisés** : protobuf et abseil, moteurs Windows, textures de bois CC0, sons CC0.
- **Code ouvert sous licence MIT sur GitHub.** La publication sera confirmée avant tout envoi.
- **Pas de PC Windows** : les tests passeront par la CI GitHub, puis par des testeurs.

Pour mémoire, les questions posées :

1. **Valider la direction 3D « Atelier vivant »** comme rendu principal, la 2D servant de mode léger.
2. **Autoriser les téléchargements suivants** :
   - sources de protobuf 29.3 et abseil 20240722 (moteur Mac autonome) ;
   - moteurs KataGo officiels pour Windows (OpenCL et AVX2, ≈ 12 Mo) ;
   - textures de bois en meilleure qualité (CC0) ;
   - sons de pierres enregistrés, CC0, sur Freesound. *Ou mieux : si tu as un goban, enregistre tes propres pierres.*
3. **Code ouvert ou privé**, avec ses conséquences sur la signature Windows.
4. **Tests Windows** : PC Windows, machine virtuelle, ou seulement la CI avec des testeurs.
5. *(Plus tard)* le compte Apple Developer et l'ordre des phases D et E.

**Nom retenu** : *Masame* (柾目). C'est le grain droit des plus beaux gobans en kaya : un mot que les connaisseurs reconnaissent, facile à chercher, et cohérent avec l'Atelier. Autres pistes envisagées : *Komorebi* (木漏れ日, la lumière filtrée par les feuillages, en écho à « ombre et lumière ») ou *Goishi* (碁石, les pierres de go). Disponibilité de la marque à vérifier.

---

## 11. Risques

- **Les réseaux transformer sont lents sur Metal** : le moteur recompile le réseau pour chaque taille de lot, et les 5 à 8 premières requêtes restent lentes malgré le préchauffage.
  - Parades : lots fixes, mesure au premier lancement, réseau Léger sur les petites machines.
  - Piste : contribuer le correctif à KataGo.
- **Le parc Windows est très hétérogène** : pilotes OpenCL Intel et anciens AMD capricieux, le DirectML de Windows 10 qui plante, antivirus méfiants envers un `katago.exe` non signé.
  - Parades : test automatique, chaîne de repli, signature.
- **La 3D sur une carte graphique intégrée** n'est mesurée que sur Apple Silicon. Parades : régulateur et mode 2D.
- **OGS** : client tiers soumis à leurs conditions d'utilisation, avec une connexion par compte OGS. À valider avant la phase D.
- **Licences.**
  - KataGo est sous MIT, les réseaux sous licence de type MIT.
  - **La licence du réseau humain est confirmée** : la page officielle (katagotraining.org/network_license, consultée le 11 octobre 2026) cite explicitement le « KataGo Human SL Network ». On le fait quand même télécharger depuis la source officielle.
  - Les réseaux « zhizi » du catalogue ont leur propre licence de type MIT, à créditer s'ils deviennent « le plus fort du moment ».
  - Les ressources sont en CC0 et les polices sous licence OFL.
- **Concurrence**, qui bouge vite : Hoshi (bêta, client OGS, entraîneur de joseki), Kaya (8 langues, KataGo dans le navigateur), GoReview, Joseki Dojo, KaTrain. Chess.com a cité le go parmi ses prochains jeux, sans date. Aucun ne combine les six piliers, mais il faut avancer.

---

## Sources

Le détail et les liens sont dans `docs/exploration.md`, `docs/katago-benchmark.md` et les rapports de recherche. Les principales :
- Usages : API GitHub (`api.github.com/repos/…/releases`), Google Play, App Store (`itunes.apple.com/lookup`), Similarweb (septembre 2026), API d'OGS (`online-go.com/api/v1/…`), r/baduk. Fox : https://www.foxwq.com/news/13872.html · GoMagic : https://gomagic.org/play-go-online/
- KataGo (versions et réseaux) : https://github.com/lightvector/KataGo/releases · https://katagotraining.org/networks/
- KaTrain : https://github.com/sanderland/katrain · Sabaki : https://github.com/SabakiHQ/Sabaki · Kaya : https://github.com/kaya-go/kaya · Joseki Dojo : https://github.com/EternalEclipse999/joseki-dojo
- Tauri (sidecar, Windows) : https://v2.tauri.app/ · tauri-action : https://github.com/tauri-apps/tauri-action
- Poly Haven (CC0) : https://polyhaven.com/license · Freesound (CC0) : https://freesound.org/people/billhails2/sounds/588317/
- Dimensions du matériel : https://en.wikipedia.org/wiki/Go_equipment · https://senseis.xmp.net/?GoBoard
- Signature Windows : Azure Artifact Signing · SignPath Foundation (https://signpath.org/)
