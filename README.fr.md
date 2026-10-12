<p align="center">
  <img src="docs/images/hero.jpg" alt="Un goban en kaya, pierres d'ardoise et de coquillage dans leurs bols de bois, dans la lumière du soir" width="100%">
</p>

<h1 align="center">Masame <sub>柾目</sub></h1>

<p align="center">
  <i>Un goban d'artisan — et un professeur qui joue comme un humain.</i>
</p>

<p align="center">
  <a href="LICENSE"><img alt="Licence : MIT" src="https://img.shields.io/badge/licence-MIT-8a6a4a?style=flat-square"></a>
  <img alt="macOS · Windows · Linux" src="https://img.shields.io/badge/macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-6b5a48?style=flat-square">
  <img alt="KataGo 1.18" src="https://img.shields.io/badge/KataGo-1.18-3d3229?style=flat-square">
</p>

<p align="center"><sub><a href="README.md">English</a> · Français</sub></p>

<br>

*Masame*, c'est le grain droit et parallèle qui distingue les plus beaux gobans en kaya. Cette application est faite dans le même esprit : un goban aux vraies proportions et aux vraies matières, bois, ardoise et coquillage, rendus dans une lumière qui suit l'heure du jour. En face de toi, KataGo ne joue pas comme une machine, mais comme un humain du niveau que tu choisis, de 20 kyu à 9 dan. Elle parle français et anglais, fonctionne hors ligne, garde tes parties pour toi, et elle est gratuite.

<br>

<table>
  <tr>
    <td width="50%"><img src="docs/images/study-fr.jpg" alt="Vue Étude" width="100%"><br><sub><b>Étude.</b> Le goban vu d'en haut, la partie à côté.</sub></td>
    <td width="50%"><img src="docs/images/contemplation-fr.jpg" alt="Vue Contemplation" width="100%"><br><sub><b>Contemplation.</b> Le goban posé sur la table, vu de ta place.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/light-and-shadow.jpg" alt="Territoire « Ombre et lumière »" width="100%"><br><sub><b>Ombre et lumière.</b> Le territoire en lumière et en ombre sur le bois.</sub></td>
    <td width="50%"><img src="docs/images/counting-fr.jpg" alt="Comptage" width="100%"><br><sub><b>Comptage.</b> Pierres mortes proposées par le moteur, corrigées d'un clic.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/networks-fr.jpg" alt="Gestionnaire de réseaux" width="100%"><br><sub><b>Réseaux.</b> Les réseaux officiels de KataGo, téléchargés et vérifiés dans l'app.</sub></td>
    <td width="50%"><img src="docs/images/light-2d-fr.jpg" alt="Mode léger 2D" width="100%"><br><sub><b>Mode léger.</b> Un goban 2D tout simple, et le repli quand la 3D n'est pas disponible.</sub></td>
  </tr>
</table>

## Fonctions

- **L'Atelier vivant.** Un goban three.js en temps réel, bois et pierres aux matières physiques, lumière qui suit l'heure du jour, deux vues (Étude et Contemplation), et des bols avec couvercles pour les pierres en réserve et capturées. 9×9, 13×13 et 19×19.
- **Un adversaire humain.** KataGo, avec son réseau humain (SL), imite un joueur de 20k à 9d, avec ajustement automatique du niveau et temps de réflexion naturels (optionnels).
- **Ombre et lumière.** L'estimation de propriété de KataGo affichée en vraie lumière et ombre sur le goban.
- **Comptage.** Le moteur propose les pierres mortes ; tu les corriges d'un clic.
- **Règles et parties.** Captures, ko, suicide, passe, annulation, navigation dans les coups, ouverture et enregistrement SGF.
- **Deux langues.** Entièrement en français et en anglais ; suit la langue du système et se change dans l'app.
- **Un mode léger 2D.** Un goban Canvas, utilisé automatiquement quand le rendu 3D n'est pas disponible.

## État

Masame est jeune, et le dit franchement.

- **macOS, Apple Silicon** marche aujourd'hui. Le moteur est un KataGo 1.18.2 (Metal) autonome, aux dépendances statiques ; il faut macOS 13 ou plus récent, et aucune bibliothèque Homebrew à l'exécution.
- **Windows** est écrit — le code, l'installeur NSIS et une compilation KataGo OpenCL avec repli automatique sur le processeur — et compilé par GitHub Actions. L'installeur est disponible en préversion, pas encore testé sur du vrai matériel.
- **Linux, x86_64** est nouveau : une AppImage, un .deb et un .rpm, compilés sur Ubuntu 22.04 par GitHub Actions, avec KataGo 1.18.2 compilé depuis les sources (OpenCL, avec repli automatique sur le processeur). En préversion aussi.

**Télécharge** la dernière version sur la [page des versions](https://github.com/Slymaster/masame/releases/latest) : un DMG pour macOS (Apple Silicon), un installeur pour Windows (x64), et une AppImage, un .deb et un .rpm pour Linux (x86_64). Les versions ne sont pas encore signées ; le système avertit donc au premier lancement :

- **macOS :** si Masame est bloqué, ouvre Réglages Système → Confidentialité et sécurité et clique sur **Ouvrir quand même**.
- **Windows :** quand SmartScreen apparaît, clique sur **Informations complémentaires**, puis **Exécuter quand même**.

Sous **Linux**, Masame demande glibc 2.35 ou plus récent (Ubuntu 22.04+, Debian 12, Fedora, Linux Mint 21+). Quelques points à savoir :

- L'AppImage peut demander `libfuse2` (ou lance-la avec `--appimage-extract-and-run`).
- Fenêtre vide avec le pilote propriétaire NVIDIA : lance Masame avec `WEBKIT_DISABLE_DMABUF_RENDERER=1`.
- Le bruit des pierres demande les plugins « good » de GStreamer (`gstreamer1.0-plugins-good` sur Debian et Ubuntu).
- Le goban 3D demande WebGL2 ; sans lui, Masame passe au goban 2D.

## Compiler depuis les sources

Il faut Node.js 22, [pnpm](https://pnpm.io/) 9, [Rust](https://www.rust-lang.org/tools/install) (stable) avec les [prérequis de Tauri 2](https://v2.tauri.app/start/prerequisites/), et sur macOS Xcode (pour AppleClang, Swift et Metal) ainsi que `cmake`, `ninja`, `pkg-config`, `curl` et `git`. Protobuf et abseil sont compilés depuis des sources épinglées ; voir l'en-tête de [`scripts/build-katago.sh`](scripts/build-katago.sh).

Sous Linux (x86_64), compile plutôt le moteur avec `scripts/build-katago-linux.sh`, qui demande `g++`, `cmake`, `ninja`, `git` et les paquets de développement de zlib, Eigen 3 et OpenCL (sur Debian et Ubuntu : `ninja-build cmake zlib1g-dev libeigen3-dev ocl-icd-opencl-dev opencl-headers`). Il compile les moteurs OpenCL et CPU dans `src-tauri/resources/katago-linux/`.

```sh
git clone https://github.com/Slymaster/masame.git
cd masame
pnpm install
scripts/build-katago.sh   # compile KataGo v1.18.2 (Metal) dans src-tauri/binaries/
pnpm tauri dev
```

Tests : `pnpm test` (TypeScript) et `cargo test --manifest-path src-tauri/Cargo.toml` (Rust). Les versions Windows sont produites par le workflow GitHub Actions ([`.github/workflows/build.yml`](.github/workflows/build.yml)) ; les instructions locales suivront une fois vérifiées sur du vrai matériel.

## Réseaux

Masame n'embarque aucun réseau de neurones. À la première utilisation, le gestionnaire de réseaux lit le catalogue de l'API katagotraining.org et télécharge les réseaux choisis depuis `media.katagotraining.org`, le site de distribution officiel de KataGo. Chaque fichier est vérifié avec son sha256 publié (ou, pour le réseau humain SL, un sha256 épinglé dans l'app) avant d'être utilisé, et un téléchargement corrompu est supprimé. Les réseaux sont stockés en local, dans le dossier de données de l'app : `~/Library/Application Support/com.sylvainrey.masame/models/` sur macOS.

Les réseaux sont publiés par le projet KataGo sous la [KataGo Neural Network License](https://katagotraining.org/network_license/).

## Vie privée

- Aucune télémétrie, aucune mesure d'audience, aucun compte.
- Les requêtes réseau vont à katagotraining.org (le catalogue des réseaux et leur téléchargement) et à github.com.
- Au plus une fois par jour, Masame demande à github.com si une nouvelle version existe (tu peux le désactiver dans le panneau). Une mise à jour n'est téléchargée que si tu cliques sur Installer, et elle est vérifiée avec la clé de signature de Masame avant d'être installée.
- Tes parties restent sur ta machine ; les fichiers SGF sont enregistrés là où tu le choisis.

## Feuille de route

Les fondations et l'Atelier vivant en 3D sont en place. Viennent ensuite le professeur — une revue locale et automatique de tes parties, les trois moments qui les ont décidées, « devine, puis découvre » —, puis un client OGS, puis un entraînement quotidien construit à partir de tes propres parties. Le plan complet et ses raisons sont dans [docs/proposition.md](docs/proposition.md) (en anglais : [docs/proposal.en.md](docs/proposal.en.md)).

## Remerciements

- [KataGo](https://github.com/lightvector/KataGo), de David J Wu (« lightvector ») et ses contributeurs : le moteur et ses réseaux de neurones.
- [@sabaki/go-board](https://github.com/SabakiHQ/go-board) et [@sabaki/sgf](https://github.com/SabakiHQ/sgf), de Yichuan Shen : logique du goban et lecture des SGF.
- [three.js](https://threejs.org/), [Tauri](https://tauri.app/) et [React](https://react.dev/).
- Textures de bois d'[ambientCG](https://ambientcg.com/), éclairage (HDRI) de [Poly Haven](https://polyhaven.com/), sons de pierres de [Freesound](https://freesound.org/) par billhails2, Hongsungbock et MPooman — tous en CC0.
- Polices : Cormorant Garamond et Manrope, sous SIL Open Font License.

## Licence

Masame est publié sous [licence MIT](LICENSE). Les composants tiers gardent leurs propres licences ; la liste complète est dans [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
