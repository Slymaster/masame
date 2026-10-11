# Exploration : un jeu de go esthétique pour apprendre les joseki et jouer contre une IA

*État des lieux au 11 octobre 2026. Les points marqués (?) n'ont pas pu être vérifiés.*

---

## 1. Ce qui existe déjà

### Logiciels de bureau
| Produit | Prix | Points forts | Limites |
|---|---|---|---|
| **KaTrain** (v1.20, août 2026) | Libre | KataGo intégré. Bots « Human-like », « Calibrated rank » et « Historical pro » (réseau humain de KataGo). Mode enseignement. | Interface fonctionnelle mais terne. Configuration et GPU rebutants. |
| **Sabaki** (v0.60, juil. 2026) | Libre | Le plus joli des classiques : textures, thèmes, pierres légèrement décalées. | Le moteur IA est à brancher soi-même. Rien pour apprendre. |
| **Lizzie / LizzieYzy, q5Go, GoGui** | Libre | Analyse | Abandonnés (dernières versions 2020-2023). |
| **Crazy Stone** | ~80 $ (?) | Moteur maison | Fermé, cher. |
| **Kaya** (2026) | Libre (AGPL) | Web, PWA et Tauri, KataGo dans le navigateur via ONNX | Licence AGPL : à lire, pas à copier. |
| **Hoshi** (bêta 2026) | Libre | Client OGS, revue KataGo, entraîneur joseki, thèmes, musique | Bêta. Le plus proche de ton idée, à surveiller. |
| **Companion Baduk**, **Hibiki & Kanon** (Steam, 2026) | Accès anticipé / 6,59 $ | Personnages animés, leçons, dictionnaire de joseki | Esthétique anime ou « mignonne », pas épurée. |

### Mobile
| Produit | Prix | Points forts | Limites |
|---|---|---|---|
| **SmartGo One** (iOS/Mac) | 99 $ à vie ou 30 $/an | 140 000 parties pro (GoGoD), recherche de motifs, « devine le coup » | Interface peu intuitive. Environ 20 % des problèmes signalés erronés. 19×19 payant. |
| **BadukPop** | 50 $/an | Bots-personnages de 20k à 7d, très soigné | Aucune explication quand on se trompe. Révision payante. |
| **GoReview** (iOS, 2026) | Achat unique | KataGo sur l'appareil, répétition espacée sur *tes* erreurs, synchro OGS | iOS uniquement. |
| **Go Quest, Go Hane, PlayGo.gg, Omoyo, Igosil…** | Variable | 9×9 classé, cartes de chaleur « coups humains probables », bots « humains » | Pubs, système d'énergie (Igosil), moteurs non documentés. |

### Web
- **OGS** : gratuit, avec le **Joseki Explorer** (≈ 20 000 positions curées, coups étiquetés Idéal, Bon, Piège, Erreur). Sa refonte de septembre 2026 a déclenché une forte contestation.
- **AI Sensei** : revue KataGo, bots humains de 30k à 9d.
- **Joseki Sage** (exercices), **Josekipedia** (arbre collaboratif), **dictionnaire de Kogo** (un seul SGF figé depuis 2014, avec des erreurs).
- **Joseki Dojo** (libre, MIT, 2026) : tu joues un coin contre KataGo qui imite un rang humain, puis il mesure tes pertes et vérifie si tu as puni ses erreurs. **C'est le concurrent le plus proche de l'idée « punir l'erreur ».** Bureau uniquement, interface en russe, sans répétition espacée.

### Ce que les joueurs reprochent (r/baduk, OGS, lifein19x19, avis des stores)
1. **Une IA inhumaine** : trop forte, ou affaiblie de façon artificielle (une forme parfaite suivie d'une gaffe absurde).
2. **Pas de « pourquoi »** : on voit qu'un coup est mauvais sans comprendre la raison.
3. **Les débutants se noient** : 0 victoire sur 50 en 9×9. Il faudrait un handicap qui maintient environ 50 % de victoires.
4. **Des interfaces laides ou en régression**, surtout sur mobile.
5. **Une monétisation agressive** : énergie, pubs, offres « limitées » à 100 €.
6. **Des joseki récités plutôt que compris** (« apprendre les joseki fait perdre deux pierres »). Le plus dur n'est pas de connaître un joseki mais de **choisir le bon selon le reste du goban**.

### Les manques du marché
1. Un entraîneur de joseki axé sur la **compréhension** : le pourquoi, la punition des déviations, le contexte du goban entier, le niveau de l'élève.
2. Un adversaire **humain et lisible**. Le réseau « humain » de KataGo n'existe aujourd'hui que dans KaTrain, enfoui dans des menus.
3. Un **bel objet** : personne n'allie la sobriété de Lichess, le fini de Chess.com, le rendu de vraies matières, le son et la lenteur.
4. Un **modèle honnête** : achat unique, hors ligne, privé, sans pub ni énergie.

---

## 2. La technique disponible (vérifiée)

### KataGo, le moteur
- **v1.18.1** (24 août 2026). Nouveaux réseaux « transformer » depuis la v1.17. Backend **Metal** pour Apple Silicon.
- **Pas de binaire macOS officiel** : il faut passer par Homebrew (`katago` 1.18.2) ou compiler avec `-DUSE_BACKEND=METAL`, puis signer le binaire et le livrer comme *sidecar*. KaTrain le fait déjà : c'est une recette à copier.
- Ta machine a **KataGo 1.15.3**. C'est suffisant pour prototyper (le réseau humain est arrivé en 1.15), mais il faudra passer en 1.18 pour les réseaux récents.
- **Licences** : le code est MIT. Les réseaux kata1 sont sous la « KataGo Neural Network License », de type MIT : usage commercial autorisé, avis de licence obligatoire. La licence du réseau humain n'est pas confirmée (?).

### Les réseaux à proposer au téléchargement dans le jeu
| Rôle | Réseau | Taille |
|---|---|---|
| **Humain** (adversaire calibré par rang ou par époque) | `b18c384nbt-humanv0` | 99 Mo |
| **Équilibré** (par défaut) | `kata1-b18c384nbt-s9996604416…` | 98 Mo |
| **Fort** (analyse) | `kata1-zhizi-b28c512nbt-muonfd2` | 271 Mo |
| **Le plus fort** (transformer, KataGo ≥ 1.17) | `kata1-tf3-b11c768-…` | 262 Mo. Selon un retour utilisateur, il serait 5× plus lent que le b28 sur Mac (?). |

- URL : `https://media.katagotraining.org/uploaded/networks/models/kata1/<nom>.bin.gz`. L'API `katagotraining.org/api/networks/` publie le **sha256** et la taille de chaque réseau, ce qui permet de vérifier le fichier après téléchargement.
- **À faire avant de choisir** : lancer `katago benchmark` sur ton M2 Max.

### Le réseau « humain » : la vraie pépite
- Il prédit **le coup qu'un humain d'un profil donné jouerait** :
  - `rank_20k` à `rank_9d` (style moderne) ;
  - `preaz_20k` à `preaz_9d` (style d'avant AlphaGo, 2016) ;
  - **`proyear_1800` à `proyear_2023`** (style des professionnels d'une année donnée).
- Il se règle **requête par requête** (`overrideSettings.humanSLProfile`). Un seul processus KataGo peut donc être à la fois un adversaire 5k, un pro de 1850 et un analyste surhumain.
- La recette officielle est `gtp_human5k_example.cfg` : échantillonnage par température, et même des **pauses de réflexion humaines** (`delayMoveScale`).

### Protocole
On utilise le **moteur d'analyse JSON** de KataGo plutôt que GTP. Il renvoie :
- le taux de victoire et l'avance au score ;
- la variation principale (PV) ;
- la **carte de propriété** (à qui appartient chaque intersection) ;
- la politique IA *et* la politique humaine ;
- des résultats partiels en flux continu.

### Briques réutilisables
| Brique | Version | Licence | Usage |
|---|---|---|---|
| Tauri | 2.12 (oct. 2026) | MIT/Apache | Coquille d'application légère, KataGo en sidecar |
| `@sabaki/go-board` | 1.4 | MIT | Règles (captures, ko) |
| `@sabaki/sgf` | 3.5 | MIT | Lecture et écriture SGF |
| `@sabaki/shudan` | 1.8 | MIT | Goban DOM/CSS. Pour un rendu très esthétique, on dessinera le nôtre. |
| web-katrain | 2026 | MIT | KataGo dans le navigateur (TF.js/WebGPU), pour une future version web |

---

## 3. Proposition : **« Ma » (間)**, titre de travail

> *Ma* désigne en japonais l'espace vide qui donne son sens à ce qui l'entoure, ce que fait chaque intersection vide au go.

### Quatre piliers
1. **Un objet beau et calme.** De vraies matières (kaya, ardoise, coquillage), un vrai son de pierre, de la lenteur, aucune notification ni publicité.
2. **Des joseki compris, pas récités.** Chaque coup a une raison, une punition et un contexte.
3. **Une IA qui joue comme un humain** : de ton niveau, ou d'une autre époque.
4. **Une IA locale et honnête.** Elle tourne hors ligne et respecte ta vie privée. KataGo est crédité et les réseaux se téléchargent depuis le jeu.

### Fonctionnalités signature (ce que personne ne fait)

**★ A. La lentille de rang**
Sur chaque position de joseki, on montre côte à côte ce que joueraient un **20k, un 5k, un 1d, un pro et KataGo**. Tu vois *où les joueurs de ton niveau se trompent* et combien ça coûte. Les données sont calculées hors ligne avec le réseau humain et livrées avec le jeu.

**★ B. Le salon des époques**
Grâce aux profils `proyear_1800` à `2023`, tu peux :
- jouer contre **le style de 1850**, du Shin-Fuseki des années 1930, d'avant AlphaGo (2015) ou d'aujourd'hui ;
- faire glisser un **curseur d'époque** sur un joseki pour voir sa popularité monter puis s'effondrer quand l'IA est arrivée. Un musée vivant du go.

KaTrain contient la brique « Historical pro », mais personne n'en a fait une expérience.

**★ C. Le territoire en lavis d'encre**
La carte de propriété de KataGo se dessine comme de l'encre qui diffuse dans le papier, au lieu de carrés colorés. Un coup qui fait basculer la partie se *voit* : l'encre recule. C'est l'explication visuelle qui manque partout, sans graphique ni pourcentage.

**★ D. Le goban qui vieillit**
Le bois prend une patine au fil de tes parties. Tes joseki maîtrisés s'inscrivent dans un carnet calligraphié, comme un rouleau qui s'allonge. Une progression émotionnelle plutôt que des badges.

### L'entraîneur de joseki
| Fonction | Originalité | Coût |
|---|---|---|
| **Répétition espacée par coup** (algorithme FSRS) plutôt que par séquence entière, avec orientation et couleur aléatoires et un départ en milieu de séquence | Forte. EasyGo et JoseDog ne répètent que des séquences entières. | Faible |
| **Punir l'erreur** : le bot dévie comme un vrai joueur de ton rang, tu dois le punir, et chaque échec revient plus tôt | Moyenne. Joseki Dojo en fait une partie, sans répétition espacée. | Moyen |
| **« À quoi sert ce coup ? »** : avant de révéler le coup, tu choisis son but (sente, base, aji, influence), puis l'encre montre ce qui a changé | Forte | Moyen (le texte demande de la curation) |
| **Le bon joseki au bon moment** : même coin, reste du goban différent, tu choisis la variante ou tenuki, et KataGo juge | Très forte. N'existe qu'en livre. | Moyen |
| **Programme personnalisé** : les joseki sont triés par probabilité de les rencontrer à ton rang × points perdus si tu ne les connais pas | Forte | Calcul hors ligne |
| **Détecteur de fuites** : tu importes tes parties (SGF, OGS, Fox), il repère *tes* joseki les plus coûteux et alimente la répétition espacée | Forte | Moyen |
| **Provenance honnête** : chaque branche est étiquetée « classique », « fréquent chez les pros », « vérifié par KataGo » ou « contesté » | Moyenne | Faible |

**La base de joseki serait générée par nous**, avec KataGo et le réseau humain, sur ton Mac et hors ligne :
- **Exploration** : on part des coins 4-4, 3-4, 3-3 et 5-3, et on suit les coups probables chez les humains ou chez l'IA.
- **Évaluation** : chaque coup reçoit une avance au score calculée avec une recherche profonde, car KataGo surévalue « l'efficacité » en début de partie.
- **Pourquoi c'est la bonne voie** : c'est **juridiquement propre**, car Kogo et Josekipedia n'ont pas de licence et OGS n'en publie pas pour ses données. C'est aussi **moderne** (joseki de l'ère IA) et cela donne gratuitement les statistiques par rang.

### Jouer contre l'IA
- **Adversaire humain par rang** grâce au réseau humain. KataGo complet garde un droit de veto sur les gaffes absurdes.
- **Handicap automatique** qui vise 50 % de victoires.
- **Pauses de réflexion naturelles**, plutôt qu'une réponse instantanée qui casse l'illusion.
- **Revue en « 3 moments clés »** plutôt qu'un graphique de taux de victoire illisible. Pour chacun : ce que tu as joué, ce qu'un joueur de ton rang joue d'habitude, le meilleur coup, et l'encre qui bascule.
- **Gestionnaire de modèles intégré** : choix Léger, Équilibré, Fort ou Humain, téléchargement avec reprise, vérification sha256, écran de crédits et licences.

---

## 4. Stack recommandée

**Mac d'abord, extensible à Windows et au web :**
- **Tauri 2** + TypeScript + Vite (+ React ou Svelte).
- **Goban dessiné maison** en Canvas/WebGL (PixiJS si on veut des shaders pour l'encre et le bois). Règles avec `@sabaki/go-board`, fichiers avec `@sabaki/sgf`.
- **KataGo 1.18 Metal** en sidecar signé, piloté par le moteur d'analyse JSON derrière une interface `Engine`. Plus tard, une implémentation navigateur sur le modèle de web-katrain.
- Données de joseki en SQLite ou JSON, générées par un script hors ligne.

**Alternative si tu vises uniquement Apple** : SwiftUI + Metal.
- Pour : sensation Mac et iPad maximale (retours haptiques du trackpad, shaders Metal natifs).
- Contre : pas de web ni de Windows, et une intégration de KataGo plus lourde.

---

## 5. Feuille de route

| Étape | Contenu | Ce qu'elle valide |
|---|---|---|
| **0. Le toucher** ✅ (11 oct. 2026) | Goban seul : rendu des matières, son, animation de pose, règles, SGF | La direction esthétique |
| **1. L'adversaire** ✅ (11 oct. 2026) | Sidecar KataGo, gestionnaire de modèles, bot humain par rang, comptage (handicap auto reporté) | « Jouer contre une IA » |
| **2. Le dojo joseki** | Script de génération de l'arbre, lentille de rang, répétition espacée, « punir l'erreur » | Le cœur pédagogique |
| **3. La revue** | 3 moments clés, lavis d'encre, import de parties, détecteur de fuites | La boucle partie → apprentissage |
| **4. Les époques** | Salon des époques, « bon joseki au bon moment », iPad ou web | La signature |

---

## Décisions (11 octobre 2026)
- **Plateforme** : Mac d'abord (Tauri 2 + KataGo Metal), extensible ensuite.
- **Distribution** : gratuite. Il faudra signer et notariser l'app (compte Apple Developer) et soigner les crédits et licences dès le départ.
- **Public cible** : intermédiaire (15k-5k). Ce niveau fixe le rang par défaut de l'adversaire et le programme de joseki.
- **Direction artistique** : **Atelier (工房)**, choisie parmi trois (voir `design/directions.html`). Kaya au grain fin, pierres d'ardoise et de coquillage, lumière chaude, typographies Cormorant Garamond et Karla.
  - Conséquence : la signature « territoire en lavis d'encre » devient **« ombre et lumière »** : le territoire de Noir s'assombrit, celui de Blanc s'éclaire.
  - Sa lisibilité sera retravaillée à l'étape 1, avec la vraie carte de propriété de KataGo.

## 6. Risques et points ouverts
- **Licence du réseau humain** : non confirmée. Faire télécharger le fichier depuis l'URL officielle est plus sûr que de le réhéberger.
- **Données tierces** (Kogo, Josekipedia, OGS) : ne pas les importer sans autorisation écrite.
- **Performances sur Mac** : mesurer avant de choisir le réseau par défaut.
- **Distribution** : un compte Apple Developer (99 $/an) est nécessaire pour signer et notariser. Inutile pour un usage personnel.
- **Concurrence qui bouge vite** : surveiller Hoshi, Joseki Dojo, GoReview et Kaya.

## Sources principales
- KataGo : https://github.com/lightvector/KataGo/releases · réseaux : https://katagotraining.org/networks/ · réseaux annexes (humain) : https://katagotraining.org/extra_networks/ · licence : https://katagotraining.org/network_license/
- Moteur d'analyse : https://github.com/lightvector/KataGo/blob/master/docs/Analysis_Engine.md · config humaine : https://github.com/lightvector/KataGo/blob/master/cpp/configs/gtp_human5k_example.cfg
- KaTrain : https://github.com/sanderland/katrain · Sabaki : https://github.com/SabakiHQ/Sabaki · web-katrain : https://github.com/Sir-Teo/web-katrain · Kaya : https://github.com/kaya-go/kaya
- Joseki Dojo : https://github.com/EternalEclipse999/joseki-dojo · OGS Joseki Explorer : https://github.com/online-go/online-go.com/wiki/OGS-Joseki-Explorer
- Hoshi : https://forums.online-go.com/t/61074 · Omoyo : https://forums.online-go.com/t/59815 · contestation de la refonte OGS : https://forums.online-go.com/t/60811
- Tauri sidecar : https://v2.tauri.app/develop/sidecar/
