# KataGo v1.18.2 (Metal) : compilation, réseaux et benchmark

*Mesuré le 11 octobre 2026 sur un MacBook M2 Max, macOS 26.6.2, plateau 19×19. Pendant les mesures, la charge de la machine était élevée (load average ≈ 15 : indexation Spotlight, fileproviderd, et une autre session qui lançait `katago runoutputtests` en boucle). Les chiffres absolus sont donc plutôt pessimistes. Les rapports entre réseaux, eux, sont fiables.*

## 1. Compilation (binaire autonome, macOS 13+)

Script : `scripts/build-katago.sh` (idempotent, ≈ 3 min à froid sur M2 Max, ≈ 2 s quand tout est en cache). Il fait ceci :

1. **Dépendances statiques** dans `vendor/deps` (gitignoré) : abseil-cpp `20240722.0` puis protobuf `v29.3` (avec `utf8_range`/`utf8_validity` et un `protoc` 29.3 compilé depuis les mêmes sources, pour que le code généré corresponde aux en-têtes). Release, arm64, `-DBUILD_SHARED_LIBS=OFF`, cible de déploiement fixe, `protobuf_BUILD_LIBUPB=OFF`, `protobuf_WITH_ZLIB=OFF`, tests désactivés. Les archives sont téléchargées dans `vendor/dl` et leur sha256 est vérifié à chaque exécution :

   | Archive | sha256 |
   |---|---|
   | `abseil/abseil-cpp/archive/refs/tags/20240722.0.tar.gz` | `f50e5ac311a81382da7fa75b97310e4b9006474f9560ac46f54a9967f07d4ae3` |
   | `protocolbuffers/protobuf/archive/refs/tags/v29.3.tar.gz` | `008a11cc56f9b96679b4c285fd05f46d317d685be3ab524b2a310be0fbad987e` |

   Un fichier `vendor/deps/.stamp` (versions + cible + arch) sert de clé de cache : s'il change, les dépendances et le dossier de build KataGo sont reconstruits de zéro.
2. Clone superficiel du tag `v1.18.2` dans `vendor/KataGo` (tag vérifié).
3. `cmake -G Ninja -DUSE_BACKEND=METAL -DCMAKE_BUILD_TYPE=Release -DLIBZIP_LIBRARY=OFF -DCMAKE_OSX_DEPLOYMENT_TARGET=13.0 -DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_Swift_FLAGS="-target arm64-apple-macosx13.0"`, avec `Protobuf_ROOT`/`CMAKE_PREFIX_PATH`/`Protobuf_PROTOC_EXECUTABLE` pointés sur `vendor/deps`.
4. Copie vers `src-tauri/binaries/katago-aarch64-apple-darwin`, `/usr/bin/strip -x`, suppression des `LC_RPATH` de la machine de build, signature ad hoc (`codesign -s -`, la vraie signature viendra du pipeline de release), puis contrôles qui **font échouer le script** si une bibliothèque hors `/usr/lib` et `/System/Library` est liée, ou si `minos` n'est pas la cible attendue.

Isolation de la chaîne d'outils (la machine a un `protoc` 25.3 et un `strip` Anaconda, un `pkg-config` et un `ninja` MacPorts, et protobuf/abseil Homebrew en dylib) :
- `PKG_CONFIG_LIBDIR=vendor/deps/lib/pkgconfig` : pkg-config, quel que soit le binaire, ne voit **que** nos `.pc`. Comme seuls des `.a` existent dans `vendor/deps/lib`, les `-l` de `katagocoreml` résolvent forcément vers le statique.
- `CMAKE_IGNORE_PREFIX_PATH=/opt/homebrew;/usr/local;/opt/local` : `find_package`/`find_library` ignorent Homebrew, l'ancien préfixe Intel et MacPorts.
- `CC=/usr/bin/clang`, `CXX=/usr/bin/clang++`, `/usr/bin/strip` ; `CPATH`, `LIBRARY_PATH`, `MACOSX_DEPLOYMENT_TARGET` sont vidés.

Résultat :

```
KataGo v1.18.2
Git revision: fd0723fdbc0e9d82cf269c9630af8c27c57c07c4
Using Metal backend
```

Binaire : **10,6 Mo** (10 574 592 octets, contre 10,7 Mo + 8,8 Mo de dylibs Homebrew avant), arm64, **`minos 13.0`**, `sdk 27.0` (Xcode 27.0, Swift 6.4).

```
$ otool -L src-tauri/binaries/katago-aarch64-apple-darwin
  /usr/lib/libz.1.dylib
  /usr/lib/libc++.1.dylib
  /System/Library/Frameworks/MetalPerformanceShaders.framework/Versions/A/MetalPerformanceShaders
  /System/Library/Frameworks/MetalPerformanceShadersGraph.framework/Versions/A/MetalPerformanceShadersGraph
  /usr/lib/libSystem.B.dylib
  /System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation
  /System/Library/Frameworks/CoreML.framework/Versions/A/CoreML
  /System/Library/Frameworks/Foundation.framework/Versions/C/Foundation
  /System/Library/Frameworks/Metal.framework/Versions/A/Metal
  /usr/lib/libobjc.A.dylib
  /usr/lib/swift/libswiftCore.dylib, libswiftCoreFoundation, libswiftDarwin, libswiftDispatch,
    libswiftIOKit, libswiftMetal, libswiftObjectiveC, libswiftUniformTypeIdentifiers,
    libswiftXPC, libswiftos, libswiftsimd
$ otool -l … | grep -A4 LC_BUILD_VERSION
      cmd LC_BUILD_VERSION
  cmdsize 32
 platform 1
    minos 13.0
      sdk 27.0
```

Aucun `@rpath`, aucun `LC_RPATH`, plus aucune dylib Homebrew : un seul fichier à signer et notariser. Le runtime Swift vient de `/usr/lib/swift`, présent dans l'OS depuis macOS 10.14.4.

### Pourquoi macOS 13.0

- Le piège initial : `CMakeLists.txt` de KataGo fait `set(CMAKE_OSX_DEPLOYMENT_TARGET 13.0)` **après** `project()`. Le C++ reçoit bien `-mmacosx-version-min=13.0`, mais `swiftc` ne reçoit aucun `-target`, prend celui du SDK (`macosx26.0`), et c'est lui qui fait l'édition de liens : d'où le `minos 26.0` précédent. Le script passe donc `-target arm64-apple-macosx13.0` via `CMAKE_Swift_FLAGS`.
- 13.0 est la cible choisie par KataGo lui-même, et elle **compile du premier coup**. En Swift, l'utilisation d'une API plus récente que la cible sans `#available` est une **erreur** de compilation, pas un avertissement. Or `metalbackend.swift` et `metallayers.swift` ne contiennent aucun `#available`/`@available` : chaque API MPSGraph/CoreML/Metal utilisée est donc annotée ≤ macOS 13 dans le SDK. Aucun avertissement de disponibilité côté C++ non plus. 14.0 et 15.0 n'ont donc pas eu besoin d'être essayés.
- Pas d'essai sous 13.0 : c'est le plancher décidé en amont, et macOS 13 couvre tous les Mac Apple Silicon.
- **Non vérifié** : l'exécution réelle sur macOS 13, 14 ou 15. Seul macOS 26.6.2 était disponible. MPSGraph peut se comporter différemment selon la version (performances, bugs corrigés depuis). À tester sur une VM ou un Mac en macOS 13 avant de l'annoncer.

### Vérifications (11 octobre 2026, nouveau binaire)

- `katago version` → `Using Metal backend`.
- Moteur `analysis` avec `src-tauri/resources/katago/analysis.cfg` + Équilibré (b10c512), 8 requêtes de 400 visites avec `includeOwnership` : `ownership` à 361 valeurs, winrate et score cohérents (≈ 0,40–0,50, −0,9 à 0). Mêmes coups et mêmes valeurs que l'ancien binaire.
- Avec `-human-model b18c384nbt-humanv0.bin.gz` et `overrideSettings {"humanSLProfile":"rank_8k","ignorePreRootHistory":false}` : `humanPolicy` à 362 valeurs (somme 1,000), `humanPrior` présent dans `moveInfos`.
- `cargo test --lib -- --ignored engine_end_to_end` : **ok**. Attention, ce test utilise par défaut le KataGo 1.15.3 Homebrew (OpenCL). Pour tester le sidecar, il faut `BADUK_KATAGO=…/binaries/katago-aarch64-apple-darwin BADUK_KATAGO_CONFIG=…/resources/katago/analysis.cfg BADUK_KATAGO_MODEL=…/kata1-tf3-b10c512….bin.gz` : ok en 67 s (80 coups en self-play humain 8k).
- Performances, ancien et nouveau binaire lancés l'un après l'autre (b10c512, config de l'app, load ≈ 4–6) : requêtes à chaud **123–207 v/s pour les deux**, première requête 13–17 s pour les deux. Les écarts entre requêtes viennent des recompilations MPSGraph (voir §6), pas du binaire. `katago benchmark -t 8 -v 600` (10 positions, load ≈ 4) : **≈ 140 v/s**, contre 78 v/s dans le tableau §3a mesuré sous load ≈ 15. Aucune régression : le code de calcul est identique, seule l'édition de liens a changé.

### Notes pour GitHub Actions (non testé sur un runner)

- Runner **macOS arm64** (`macos-14`, `macos-15` ou plus récent). Xcode avec Swift ≥ 5.9 (Xcode 15+). Ici : Xcode 27.0. Sélectionner explicitement la version (`sudo xcode-select -s /Applications/Xcode_XX.app`) pour figer le SDK.
- Outils : `cmake`, `ninja`, `pkg-config` (`brew install cmake ninja pkg-config` ; les versions Homebrew de protobuf/abseil éventuellement présentes sont ignorées). `curl`, `git`, `shasum` sont fournis.
- Cache : `vendor/dl` et `vendor/deps`, avec une clé de cache = hash de `scripts/build-katago.sh` + version de Xcode. Le build complet prend environ 3 min en local, sans doute 10 à 15 min sur un runner à 3 cœurs.
- Le script échoue avec un message explicite si le sha256 ne correspond pas, si un outil manque, si une dylib non système est liée, ou si `minos` est différent de la cible.
- Le `CMakeLists.txt` de KataGo ajoute `/usr/local/include` et `/usr/local/lib` s'ils existent. Sur les runners arm64, `/usr/local` est quasiment vide. Si un jour une protobuf s'y trouve, ses en-têtes pourraient passer devant les nôtres : `otool -L` ne le verrait pas, mais la compilation de `katagocoreml` échouerait probablement (versions différentes).

### Build universel (x86_64 + arm64) : ce qu'il faudrait

Non fait. Il faudrait :
1. Dépendances : `-DCMAKE_OSX_ARCHITECTURES="arm64;x86_64"` suffit pour abseil et protobuf (`.a` universels). En revanche, `protoc` doit tourner sur la machine de build : soit on le garde universel, soit on en compile un natif à part.
2. KataGo : le chemin Swift/CMake n'accepte qu'un seul `-target`. Il faut donc **deux builds** (`build-metal-arm64` avec `-target arm64-apple-macosx13.0`, `build-metal-x86_64` avec `-target x86_64-apple-macosx13.0` et `CMAKE_OSX_ARCHITECTURES=x86_64`), puis `lipo -create` avant la signature.
3. Tauri : produire `katago-x86_64-apple-darwin` (cible `x86_64-apple-darwin`) ou `katago-universal-apple-darwin` (cible `universal-apple-darwin`) dans `src-tauri/binaries/`.
4. Utilité discutable : KataGo prévient que le backend Metal « peut ne pas être optimal » sur Intel. Les performances sur GPU Intel/AMD sont inconnues. À mesurer avant d'investir.

## 2. Réseaux téléchargés

Dossier : `~/Library/Application Support/com.sylvainrey.masame/models/`. Chaque fichier passe par un `.part`, son sha256 est comparé à `model_file_sha256` de l'API katagotraining.org, puis il est renommé. Les trois correspondent.

| Réseau | Taille | sha256 |
|---|---|---|
| `kata1-tf3-b11c768-s11003M-d5973M-7gres.bin.gz` | 262,0 Mo | `93bdb63a3bfae4a70db0cb5265287495ecfc10b1ba1cc6814feeba1cdf055871` |
| `kata1-tf3-b10c512-s3203M-d5937M.bin.gz` | 94,3 Mo | `c04db4a503721d948bb720324f3cbdac6088cc9eb243632f020e4b6846f58995` |
| `kata1-tf2-b10c384-s2941M-d5872M.bin.gz` | 38,2 Mo | `8015d49bdf45854c94e5f9e22b2b70e8738d3e56a6edca730e5b82509998a5b5` |

Le fichier `b18c384nbt-humanv0.bin.gz` (99,1 Mo) a été déposé par le téléchargeur de l'app. Je ne l'ai pas téléchargé moi-même et je n'ai pas vérifié son hash.

### Elo (API katagotraining, `log_gamma × 400 / ln 10`)

| Réseau | Elo | ± (1σ) | Parties de classement |
|---|---|---|---|
| b11c768 (tf3) | **14 599** | 8 | 4 533 |
| b10c512 (tf3) | **14 164** | 6 | 4 218 |
| b10c384 (tf2) | **13 704** | 7 | 4 028 |

Écarts : b11c768 = +435 sur b10c512, qui a lui-même +460 sur b10c384. Ces Elo comparent des réseaux **à nombre de visites égal** dans les parties de classement du site. Le champ `log_gamma_offset` de l'API (−1,3 / −0,2 / +0,8) n'est pas appliqué ici, car sa sémantique n'est pas documentée.

## 3. Benchmark

### a) `katago benchmark` (GPU seul, 600 visites, 5 positions, visites/s)

| Réseau | 8 threads | 16 | 32 | 48 | 64 | Chargement du modèle |
|---|---|---|---|---|---|---|
| b10c384 | 145 | 123 | 138 | 57 | 64 | 4 s |
| b10c512 | 78 | 76 | 57 | 40 | 29 | 5 s |
| b11c768 | 48 | 50 | 25 | 15 | 18 | 9 s |
| *g170e-b20c256 (CNN, 2020, référence)* | 397 | 509 | 514 | 465 | 442 | 1 s |

**Les transformers sont nettement lents sur ce backend Metal, et ils ralentissent quand on ajoute des threads.** Le GPU reste en grande partie inactif (`Device Utilization` ≈ 0 à 20 %) pendant qu'un cœur CPU est à 100 %. Le graphe MPSGraph est construit avec une dimension de batch dynamique et **compilé pour chaque nouvelle taille de batch** (plusieurs secondes chacune, en CPU). Plus de threads, c'est plus de tailles de batch différentes, donc plus de compilations. Le benchmark court mesure surtout ce coût de chauffe. Le réseau convolutif g170e (b20) n'a pas ce problème et tourne 4 à 10 fois plus vite.

### b) Moteur `analysis` à chaud (config de l'app : 8 threads, `nnMaxBatchSize` 8, 400 visites/requête)

Huit requêtes successives sur des positions différentes d'une même partie, avec ownership et policy.

| Réseau | Démarrage du processus | Chauffe (premières requêtes lentes) | **Visites/s à chaud** | 400 visites |
|---|---|---|---|---|
| b10c384 | 0,5 s | ≈ 10 s | **≈ 240** | ≈ 1,7 s |
| b10c512 | 0,9 s | ≈ 25 à 35 s | **≈ 125 à 145** | ≈ 3 s |
| b11c768 | 2,0 s | ≈ 45 s et plus (compilations encore observées à la 6ᵉ requête) | **≈ 75** | ≈ 5,5 s |

Influence du nombre de threads (b10c512, à chaud) : 4 threads ≈ 105 v/s avec ≈ 20 s de chauffe, 8 threads ≈ 130 v/s avec ≈ 30 s, 16 threads ≈ 145 v/s avec ≈ 65 s. **La chauffe n'est pas mise en cache d'un lancement à l'autre** : deux lancements consécutifs ont donné la même lenteur initiale.

### c) Mode ANE / CoreML (« mux » : 2 threads GPU et 2 threads ANE)

Testé sur b10c512 : **40 v/s** (plus lent que le GPU seul), et **79 s de chargement**, car le modèle est reconverti et recompilé en CoreML à chaque démarrage, puis supprimé. Ce mode est écarté.

## 4. Configuration retenue (`src-tauri/resources/katago/analysis.cfg`)

- GPU seul (`numNNServerThreadsPerModel = 1`, `metalDeviceToUseThread0 = 0`).
- `numAnalysisThreads = 2`, `numSearchThreadsPerAnalysisThread = 8`, `nnMaxBatchSize = 8`. Le plafond de batch à 8 borne le nombre de graphes à compiler.
- `reportAnalysisWinratesAs = BLACK`, `maxVisits = 500` (valeur par défaut, l'app la remplace), `nnCacheSizePowerOfTwo = 20`.
- Logs : `logToStderr = true` et aucune clé `logFile`/`logDir`, donc aucun fichier n'est écrit.
- Modèle humain : rien de figé. L'app passe `-human-model` et envoie `humanSLProfile` (avec `ignorePreRootHistory: false` pour l'imitation) dans `overrideSettings`, ainsi que `includePolicy: true`.

Vérifié :
- `katago analysis -config analysis.cfg -model kata1-tf3-b10c512…` : la requête JSON renvoie `rootInfo`, `moveInfos` et `ownership` (361 valeurs), avec un winrate et un score cohérents.
- Avec `-human-model b18c384nbt-humanv0.bin.gz` et `overrideSettings {"humanSLProfile":"rank_8k","ignorePreRootHistory":false}`, la réponse contient `humanPolicy` (362 valeurs, somme 1,0) et `humanPrior` dans `moveInfos`. KataGo avertit au démarrage que `humanSLProfile` n'est pas fixé, ce qui est attendu.

## 5. Recommandation

**Réseau d'analyse par défaut : `kata1-tf3-b10c512-s3203M-d5937M` (« Équilibré »).**

- Il est très surhumain (+460 Elo sur b10c384), pour 94 Mo.
- 400 visites prennent environ 3 s à chaud. C'est confortable pour la revue d'une partie et pour les indications pendant le jeu.
- À temps égal, b11c768 reste probablement un peu plus fort : il est 1,8 fois plus lent, ce qui coûte environ 200 à 250 Elo, contre 435 Elo de gain par visite. Mais il pèse 262 Mo, sa chauffe dépasse 45 s et il fait environ 75 v/s. Pour un public qui apprend, la différence n'est pas perceptible, alors que l'attente l'est.

Rôles par préréglage :

| Préréglage | Réseau | Usage |
|---|---|---|
| **Léger** | b10c384 (38 Mo) | Premier lancement (téléchargement rapide), Mac modestes ou sur batterie, analyse en arrière-plan de toute une partie. Environ 240 v/s. |
| **Équilibré (par défaut)** | b10c512 (94 Mo) | Analyse interactive, revue, adversaire. Environ 130 v/s. |
| **Maximum** | b11c768 (262 Mo) | Revue approfondie à la demande, quand l'utilisateur accepte d'attendre. Environ 75 v/s. |
| Humain | b18c384nbt-humanv0 en `-human-model` | Policy humaine par rang, bots « humains ». Toujours en complément d'un des réseaux ci-dessus. |

Conséquences pour l'app :
- **Envoyer une requête de chauffe invisible juste après le lancement du moteur**, par exemple quelques requêtes de 50 à 100 visites, pour que les premières analyses visibles ne prennent pas 10 à 30 s. Afficher « Préparation du moteur… » pendant ce temps.
- Garder le processus KataGo vivant d'une analyse à l'autre : chaque redémarrage repaie la chauffe.
- Piste à évaluer (avec autorisation de téléchargement) : un réseau convolutif kata1 récent de type b18c384nbt. D'après le g170e-b20, le chemin Metal convolutif est 4 à 10 fois plus rapide que le chemin transformer, et pourrait donc offrir un meilleur rapport force/temps sur Mac que b10c512.

## 6. Recompilation MPSGraph à chaque taille de batch : proposition de correctif (non appliquée)

Cause, dans `vendor/KataGo/cpp/neuralnet/` :
- `metallayers.swift` : les placeholders d'entrée (`InputLayer`, `InputGlobalLayer`, `InputMetaLayer`, `MaskLayer`) sont créés avec `InputShape.create(batchSize: -1, …)`, donc avec une dimension de batch dynamique.
- `metalbackend.swift`, `MPSGraphModelHandle.apply(…, batchSize:)` : chaque appel crée des `MPSNDArray` de forme `[batchSize, C, H, W]` et appelle `graph.encode(to:feeds:targetTensors:…)`. MPSGraph spécialise et compile le graphe pour chaque nouvelle forme concrète. Le cache vit dans l'objet `MPSGraph`, donc en mémoire du processus seulement. Avec `nnMaxBatchSize = 8`, il peut y avoir jusqu’à 8 compilations (le graphe est construit pour 19×19 et sert aussi aux petits plateaux via le masque), de plusieurs secondes chacune pour les transformers. Ça correspond aux pics observés (requêtes à 35–60 v/s au milieu de requêtes à 130–200 v/s).

Correctif proposé (petit, local à `apply`, à proposer en amont) :
1. **Arrondir le batch** à une taille de « seau » : `bucket = min(maxBatchSize, nextPowerOfTwo(batchSize))`, soit {1, 2, 4, 8} pour 8. On peut aussi toujours utiliser `maxBatchSize` : une seule compilation, mais du calcul gaspillé pour les petits batchs. `MPSGraphModelHandle` doit alors recevoir `maxBatchSize` (déjà connu côté C++ dans `metalbackend.cpp`).
2. Allouer les `MPSNDArray` d'entrée en `bucket` lignes. Écrire les `batchSize` lignes réelles, puis remplir les lignes de bourrage avec une copie de la ligne 0, pas des zéros : un masque nul pourrait produire des NaN dans les normalisations masquées. Les lignes sont indépendantes en inférence, donc le bourrage n'influence pas les vraies lignes.
3. En sortie, `readBytes` vers un tampon temporaire de `bucket` lignes, puis copier seulement les `batchSize` premières lignes dans `policy`/`value`/`ownership`…, car les tampons de l'appelant ne sont dimensionnés que pour `batchSize` (à vérifier dans `metalbackend.cpp`).
4. Optionnel : préchauffer chaque seau au chargement (un `apply` factice par taille), pour payer les compilations au démarrage pendant « Préparation du moteur… » plutôt que pendant l'analyse. On peut aussi compiler explicitement avec `MPSGraph.compile(with:feeds:targetTensors:targetOperations:compilationDescriptor:)` (macOS 12+) et garder les `MPSGraphExecutable`.

Gain attendu : 4 compilations au plus au lieu de 8 (1 avec `maxBatchSize` fixe), et une chauffe prévisible. Non mesuré. Le patch n'a pas été appliqué aux sources vendorisées : il touche au chemin de sortie (taille des tampons) et demande une validation numérique (`katago runtests` / `testgpuerror`) qui sort du cadre de cette tâche.

## 7. Android (arm64-v8a, backend Eigen)

Script : `scripts/build-katago-android.sh`. Sur Android, KataGo reste un processus séparé, comme sur ordinateur : un exécutable PIE nommé `libkatago.so`, livré dans `jniLibs/arm64-v8a` de l'APK pour qu'Android l'extraie dans `nativeLibraryDir` (packaging « legacy »), seul dossier de l'app d'où l'on peut lancer un exécutable.

- Même KataGo que les autres scripts (`v1.18.2`, commit vérifié), Eigen `3.4.0` (même sha256 que `build-katago-macos-x86_64.sh`), NDK `27.2.12479018` via son fichier de toolchain CMake, `ANDROID_PLATFORM=android-24` (minSdk de Tauri 2), `ANDROID_STL=c++_static`, `-DLIBZIP_LIBRARY=OFF`, zlib du sysroot du NDK, `-DEIGEN_MPL2_ONLY`. Pas d'AVX (x86 seulement) : Eigen utilise NEON sur aarch64.
- Seul ajustement : `-include endian.h`, car `core/sha2.cpp` a besoin de `BYTE_ORDER`, que `<sys/types.h>` de bionic n'inclut pas (contrairement à glibc). Les sources vendorisées ne sont pas modifiées.
- `MASAME_VENDOR` (par défaut `vendor/`) désigne l'arbre vendor ; sortie : `$MASAME_VENDOR/katago-android/arm64-v8a/libkatago.so`, passé à `llvm-strip --strip-all`.
- Contrôles qui font échouer le script : AArch64, `FLAGS_1 PIE`, interpréteur `/system/bin/linker64`, et `NEEDED` limité à `libc`, `libm`, `libdl`, `liblog`, `libz`.

Résultat (15 octobre 2026) : **7,1 Mo** (7 484 424 octets), `ELF64 DYN`, `FLAGS_1: NOW PIE`, `NEEDED: libz.so libm.so libdl.so libc.so`.

### Mesures en émulateur (15 octobre 2026)

**L'émulateur n'est pas un téléphone** : ses 4 vCPU sont des cœurs de M2 Max virtualisés (Hypervisor.Framework), sans throttling thermique ni cœurs big.LITTLE. Surtout, le Mac était saturé pendant les mesures (load average 50 à 300 sur 12 cœurs, d'autres sessions compilaient) : qemu n'obtenait que 0,8 à 2,4 cœurs. Les chiffres absolus sont donc pessimistes, et seuls les ordres de grandeur comptent.

AVD `masame_engine` : `system-images;android-35;google_apis;arm64-v8a` (Android 15), 4 vCPU, 4 Go de RAM, 8 Go de données, lancé avec `-no-window -no-audio -no-boot-anim`. Fichiers poussés dans `/data/local/tmp` : `libkatago.so`, `analysis.cfg`, le réseau léger b10c384 et le réseau humain b18c384nbt.

- `libkatago.so version` → `Using Eigen(CPU) backend`, révision `fd0723fd…` : le binaire se charge et tourne sous bionic (API 35, alors qu'il est compilé pour l'API 24).
- `katago benchmark` (réseau léger, `numSearchThreads` 1 puis 4) : **0,6 v/s** avec 1 thread (sous load ≈ 380), **1,8 v/s** avec 4 threads (2 positions × 40 visites, load ≈ 70–150, `avgBatchSize` 1,0). Pour comparer, le même code Eigen compilé nativement sur le M2 Max (même réseau, 4 threads, load ≈ 60) : **4,9 v/s**. Avec Eigen, le réseau transformer b10c384 coûte donc environ 1 s de CPU par évaluation. Le réseau humain n'a pas été passé au benchmark.
- Moteur `analysis` (`-model` léger, `-human-model b18c384nbt-humanv0`, `-override-config numAnalysisThreads=1,numSearchThreadsPerAnalysisThread=4,nnMaxBatchSize=4,nnCacheSizePowerOfTwo=16,nnMutexPoolSizePowerOfTwo=14`), position 19×19 de milieu de partie (52 à 60 coups), `humanSLProfile` `rank_5k`, trois sessions :

  | Mesure | Valeurs |
  |---|---|
  | Lancement → `Started, ready to begin handling requests` (2 réseaux) | 6,4 à 15,2 s |
  | `maxVisits` 60 + `includeOwnership` (63 visites racine) | 28,6 à 46,0 s, soit **1,4 à 2,2 v/s** |
  | `maxVisits` 1 + `includePolicy`, position jamais vue | **3,6 à 5,7 s** (une évaluation de chaque réseau). `humanPolicy` 362 valeurs (somme 1,000), `policy` 362 valeurs |
  | Même requête, position déjà dans le cache NN | 0,02 s |
  | Mémoire résidente maximale (`VmHWM`) | **≈ 665 Mo** (15 threads) |
  | Fermeture de stdin | sortie propre, code 0, en 0,1 à 0,3 s |

  Les réponses sont cohérentes : `ownership` à 361 valeurs, `humanPrior` présent dans `moveInfos`, même meilleur coup (R16) à chaque session.

Conclusion provisoire : avec Eigen, même en divisant ces chiffres par trois pour la saturation, 60 visites prendront de l'ordre de 10 à 30 s sur un téléphone. C'est trop pour un coup de l'adversaire. Il faudrait plutôt jouer à 1 visite ou quelques visites avec la policy humaine, garder les 60 visites pour l'analyse et la revue, et mesurer sur un vrai téléphone avant de fixer `maxVisits`. Un réseau convolutif plus petit que b10c384 serait sans doute bien plus rapide sur CPU, mais ce serait un téléchargement à décider.

Réglages Eigen suggérés pour un téléphone (ceux de la session `analysis` ci-dessus ; à confirmer sur un appareil réel) :
- `numAnalysisThreads = 1` : l'app n'analyse qu'une position à la fois.
- `numSearchThreadsPerAnalysisThread = 4` : environ le nombre de cœurs « performance » ; au-delà, les cœurs efficaces ralentissent les batchs et chauffent le téléphone.
- `numEigenThreadsPerModel` : laisser la valeur par défaut, min(threads de recherche, cœurs).
- `nnMaxBatchSize = 4` (= threads de recherche) ; `nnCacheSizePowerOfTwo = 16` (65 536 entrées au lieu de 2^20 sur ordinateur : le cache ne se remplit qu'au rythme des évaluations, quelques milliers par minute sur CPU, et chaque entrée garde policy et ownership, donc quelques Ko) ; `nnMutexPoolSizePowerOfTwo = 14`.
- Réseau « léger » b10c384 par défaut ; `maxVisits` à régler d'après les visites/s mesurées sur téléphone (voir la conclusion ci-dessus).
