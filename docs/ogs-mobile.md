# OGS sur Android et iPhone

Cette branche porte le jeu OGS du bureau sur les deux téléphones, au premier plan : connexion, parties classées,
recherche automatique, défis, observation, correspondance, historique et revue des parties terminées.
Elle ne publie aucun site et ne crée aucun service de notifications push. Garder la PR en draft jusqu'aux validations ci-dessous.

## Architecture et données

Le client OAuth public est `Zcn8DN7Jg5uCKB184btHYhvUllN6cxnU6enuDdOJ`. Aucun secret client n'est embarqué.
Le navigateur système ouvre OGS. Un callback HTTPS enregistré exactement chez OGS revient par Android App Links
ou iOS Universal Links. Le chemin est exact, sans wildcard. Le listener loopback reste réservé au bureau.

Rust génère le verifier PKCE S256 et le state. Une transaction expirant après cinq minutes est conservée dans le coffre
natif et consommée durablement avant l'échange du code. Un retour après destruction du processus fonctionne via
`get_current` ; un callback falsifié, répété, expiré, annulé ou sans transaction ne peut pas connecter le compte.
Le refresh token ne va jamais dans la webview, localStorage, un fichier clair ou les logs. L'access token OGS va dans
la webview pour les REST et l'auth WebSocket. OGS documente une durée de 30 jours, il ne faut pas le qualifier de jeton court.

Sur iOS, le Keychain utilise `WhenUnlockedThisDeviceOnly`, sans synchronisation iCloud. Sur Android, le blob est chiffré
avec AES-GCM et un IV neuf ; la clé AES non exportable vient d'Android Keystore, le blob atomique reste dans
`Context.noBackupFilesDir`. Une erreur du coffre n'est pas une déconnexion implicite et aucun fallback clair n'est autorisé.
« Se déconnecter » efface le coffre et révoque le refresh token au mieux, même hors ligne ; il ne supprime pas le compte OGS.

Le retour au premier plan rafraîchit le JWT et remplace le transport WebSocket. Les listeners des parties restent attachés.
Un coup exige un gamedata et une horloge serveur frais, ainsi que la resynchronisation des listes de parties et de défis.
Les événements de l'ancien transport et les réponses de listes d'une connexion antérieure sont ignorés. Un rafraîchissement
échoué garde les actions bloquées jusqu'à une reprise réussie. Les mutations utilisent un envoi sans queue ni retry automatique :
après une erreur, le joueur attend la position du serveur et choisit lui-même le coup suivant. `goban-engine` est épinglé à
8.3.226 ; l'accès contrôlé à son transport privé est testé et échoue fermé si une mise à jour change cette API interne.

L'analyse KataGo, les candidats tactiles, les entraînements, la revue et le travail de fond sont bloqués pendant la connexion
à une partie, une partie non terminée, une coupure ou une resynchronisation. Les epochs JS et Rust rejettent les résultats
commencés avant cette prise de contrôle. La fin de partie doit provenir du serveur. L'auto-score reste celui d'OGS, seulement
pendant le marquage des pierres mortes. Une partie OGS en cours ne devient jamais une partie locale restaurable.

## Prérequis externes avant un build mobile

Il n'y a aucun callback de production par défaut dans le dépôt. Ces paramètres doivent être fournis par le propriétaire :

- `MASAME_OGS_CALLBACK_URL` : l'URL HTTPS exacte, sans query, fragment, port ni credentials, sous un host contrôlé.
- `MASAME_OGS_ANDROID_CERT_SHA256` : les SHA256 des certificats de signature, séparés par des virgules. Inclure la clé
  **Play App Signing**, pas seulement la clé d'envoi ; ajouter le certificat debug uniquement sur un environnement de test.
- `MASAME_OGS_OAUTH_REGISTERED=1` : confirmation, après vérification dans le gestionnaire OGS, que cette URL exacte a
  été ajoutée au client public existant sans retirer les redirects desktop. Ce paramètre n'effectue pas l'inscription.

L'App ID Apple utilisé est `CN9TKA949C.com.sylvainrey.masame` ; l'identifiant Android est `com.sylvainrey.masame`.
Un autre identifiant de build exige ses propres associations et coffre. Ne pas modifier l'identifiant pour les builds de test
sans adapter et vérifier les associations.

```sh
node --test scripts/mobile-ogs.check.mjs
node scripts/mobile-ogs.mjs prepare
```

`prepare` génère seulement des fichiers locaux ignorés par Git dans `src-tauri/ogs-mobile.generated/` :
le merge de configuration Tauri, `/.well-known/assetlinks.json`, `/.well-known/apple-app-site-association` et une page de retour
statique `callback.html`. Aucun domaine n'est inventé, inscrit ou publié. Faire approuver les fichiers concrets avant publication.

Le propriétaire de l'hébergement doit servir les deux associations à la **racine du host**, en HTTPS, avec un statut 200,
`Content-Type: application/json`, sans login ni redirection. Une Pages de projet seule ne fournit pas cette racine.
Servir la page statique au chemin exact du callback avec `Cache-Control: no-store` et `Referrer-Policy: no-referrer`,
sans script, analytics ou ressources tierces. Désactiver la journalisation des queries sur ce chemin : le code OAuth est
protégé par PKCE mais ne doit pas devenir une donnée de logs. Ne pas transmettre les paramètres à un autre site.

```sh
node scripts/mobile-ogs.mjs verify
pnpm tauri android build --config src-tauri/ogs-mobile.generated/tauri.conf.json --ci --target aarch64 --aab
# Tauri's Xcode bridge forwards TAURI* variables; preserve these public settings for its second Cargo invocation.
export TAURI_ENV_MASAME_OGS_CALLBACK_URL="$MASAME_OGS_CALLBACK_URL"
export TAURI_ENV_MASAME_OGS_OAUTH_REGISTERED="$MASAME_OGS_OAUTH_REGISTERED"
pnpm tauri ios build --config src-tauri/ogs-mobile.generated/tauri.conf.json --ci --no-sign
```

La commande `verify` est en lecture seule et compare les associations hébergées aux paramètres exacts. Le build Rust refuse
un callback absent, fictif, trop large, non confirmé chez OGS ou différent de la configuration Tauri. Les workflows mobiles
prennent ces valeurs depuis les variables du dépôt et exécutent prepare/verify. Les builds distribuables échouent explicitement
si ces prérequis manquent ; aucune URL d'exemple ne remplace cette erreur.

Sans configuration, une CI hors release peut seulement compiler une fixture debug avec `MASAME_OGS_COMPILE_ONLY=1`. Sur iOS, les alias explicites `TAURI_ENV_MASAME_OGS_COMPILE_ONLY=1` et
`TAURI_ENV_MASAME_OGS_CI=true` transmettent cette autorisation à la seconde invocation Cargo de Xcode.
L'absence de callback ou de variable CI n'active jamais ce mode ; le profil release est toujours refusé.
Ce mode exige `CI=true` et le profil Rust debug, n'enregistre aucun callback, refuse tout accès au coffre OGS et ne publie
aucun APK/IPA. Il vérifie la compilation native, sans prouver une connexion ni une association de domaine. Un build release
refuse ce mode même si la variable est présente. Les parcours signés ci-dessous restent nécessaires.

## Validation et sortie de draft

Tests sans SDK mobile :

```sh
pnpm test
pnpm build
node --test scripts/mobile-ogs.check.mjs
cargo test --manifest-path tests/ogs-auth/Cargo.toml --locked
```

Le harness compile les vrais fichiers OAuth et la machine d'état mobile, avec un serveur HTTP local et un coffre en mémoire.
Il compile aussi le vrai pont JNI Android sur l'hôte. Il ne remplace pas les tests du coffre natif ni les tests de liens signés.
Sur une machine avec les dépendances système Tauri, lancer aussi `cargo test --manifest-path src-tauri/Cargo.toml --lib` pour
les tests loopback et coffre desktop existants.

Sur **Android et iOS signés**, vérifier : consentement/refus/annulation OAuth, navigateur fermé, callback avec processus détruit,
expiration après cinq minutes, logout puis relance, rotation de refresh, coffre verrouillé/clé invalidée et absence de tokens dans
les logs/backups. Sur Android, exécuter `OgsVaultTest` dans `connectedAndroidTest`.
Inspecter les manifests/entitlements produits, les certificats Android autorisés et l'association Apple réellement installée.

Exercer REST authentifié et WSS depuis les deux webviews de production (leurs origins CORS diffèrent), automatch, défis reçus
et envoyés, annulation, handicap libre, spectateur, correspondance, pause/undo, marquage et score OGS, résultat puis revue.
Vérifier écran verrouillé, app switcher, contrôle iOS, perte réseau et changement Wi-Fi/cellulaire : aucun coup ancien ne doit être
renvoyé, aucune aide moteur ne doit apparaître avant une fin confirmée. Tester aussi la reconnexion du bureau.

Garder la PR draft tant que l'hébergement, l'inscription OAuth, les builds natifs et ces deux parcours signés ne sont pas validés.
Aucune notification n'est promise quand l'app est suspendue ou fermée. Un futur push exigerait APNs/FCM et un serveur recevant
les événements OGS, un périmètre distinct.

Références : [OAuth OGS](https://docs.online-go.com/oauth2.html),
[liens Tauri](https://v2.tauri.app/plugin/deep-linking/),
[Android Keystore](https://developer.android.com/privacy-and-security/keystore),
[OAuth natif RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html).
