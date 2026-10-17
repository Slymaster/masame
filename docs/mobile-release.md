# Publier Masame sur iPhone et Android

Deux workflows, indépendants du desktop (`build.yml` ignore ces tags) :

- `.github/workflows/ios.yml` : un tag `ios-vX.Y.Z` construit l'app signée et l'envoie sur TestFlight.
- `.github/workflows/android.yml` : un tag `android-vX.Y.Z` construit l'App Bundle, le signe et l'envoie sur le test interne de Google Play.

Sans tag (push ou PR qui touche le build mobile), ils construisent la même chose sans signature, sans envoi et sans aucun secret : c'est le contrôle continu.

Les secrets vivent dans deux environnements GitHub, chacun réservé à ses tags. Le build desktop (`release`) ne les voit jamais, et inversement.

## Une fois : iPhone (TestFlight)

1. **Fiche App Store Connect.** Dans Certificates, Identifiers & Profiles, l'App ID `com.sylvainrey.masame` (équipe GUARANI LLC, `CN9TKA949C`). Puis dans App Store Connect, Apps > « + » > Nouvelle app : iOS, nom « Masame », identifiant `com.sylvainrey.masame`.
2. **Clé API.** Users and Access > Integrations > App Store Connect API > Team Keys > « + », rôle **Admin**. La signature dans le cloud (certificat de distribution géré par Apple, profil créé à la volée) l'exige, et la même clé sert à l'envoi. Une clé à part de celle du desktop se révoque sans toucher au reste. Note le Key ID et l'Issuer ID, télécharge le `.p8` (une seule fois possible).
3. **Environnement `testflight`**, réservé aux tags `ios-v*`, puis ses trois secrets :

   ```sh
   gh api -X PUT repos/Slymaster/masame/environments/testflight \
     -F 'deployment_branch_policy[protected_branches]=false' -F 'deployment_branch_policy[custom_branch_policies]=true'
   gh api -X POST repos/Slymaster/masame/environments/testflight/deployment-branch-policies -f name='ios-v*' -f type=tag
   gh secret set APPLE_API_KEY --env testflight --repo Slymaster/masame      # le Key ID
   gh secret set APPLE_API_ISSUER --env testflight --repo Slymaster/masame   # l'Issuer ID
   gh secret set APPLE_API_KEY_P8 --env testflight --repo Slymaster/masame < AuthKey_XXXXXXXXXX.p8
   ```

   Crée l'environnement **avant** le premier tag : GitHub crée sinon un environnement vide, sans restriction.
4. **Testeurs.** Dans TestFlight, un groupe interne (toi). Les testeurs externes passent par une revue bêta d'Apple au premier build.
5. **Chiffrement.** L'Info.plist (`src-tauri/gen/apple`) déclare `ITSAppUsesNonExemptEncryption = false` (HTTPS seul, exempté) : TestFlight ne pose donc pas la question à chaque build. Vérifie que cette déclaration est juste ; elle t'engage.

## Une fois : Android (Google Play)

1. **Fiche Play Console.** Créer l'app « Masame » ; l'identifiant `com.sylvainrey.masame` sera fixé par le premier bundle. Garder la signature d'app par Google Play (Play App Signing) : Google garde la clé de signature, toi seulement la clé d'**envoi**, qu'on peut faire réinitialiser si elle est perdue.
2. **Clé d'envoi**, générée par toi, sur ta machine, hors du dépôt (le `.gitignore` refuse de toute façon `*.p12`, `*.jks`, `*.keystore`) :

   ```sh
   keytool -genkeypair -v -storetype PKCS12 -keystore ~/masame-upload.p12 -alias upload \
     -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Sylvain Rey"
   ```

   Garde le fichier et son mot de passe dans ton gestionnaire de mots de passe. Un PKCS12 n'a qu'un mot de passe, pour le magasin et la clé.
3. **Compte de service, sans clé.** Dans Google Cloud, le projet `masame-play`, l'API « Google Play Android Developer API » activée et le compte de service `masame-play-upload@masame-play.iam.gserviceaccount.com`, **sans clé JSON** : l'organisation les interdit (`iam.disableServiceAccountKeyCreation`). Dans Play Console > Utilisateurs et autorisations, inviter l'adresse du compte de service, limitée à l'app Masame, avec **Publier des apps dans les canaux de test** (et la lecture des infos de l'app). Rien d'autre.

   Le job `release` prouve son identité à Google avec le jeton OIDC de GitHub (fédération d'identité de charge de travail) et reçoit des identifiants valables une heure. Google n'accepte que les jobs de l'environnement `play` de ce dépôt, reconnu à ses identifiants numériques : depuis juillet 2026 les dépôts neufs émettent un `sub` « immuable » (`repo:Slymaster@13293300/masame@1414560156:…`), et les identifiants numériques survivent à un renommage ou à un transfert.

   ```sh
   gcloud services enable iamcredentials.googleapis.com sts.googleapis.com --project=masame-play
   gcloud iam workload-identity-pools create github --project=masame-play --location=global
   gcloud iam workload-identity-pools providers create-oidc masame --project=masame-play --location=global \
     --workload-identity-pool=github --issuer-uri=https://token.actions.githubusercontent.com \
     --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.environment=assertion.environment" \
     --attribute-condition="attribute.repository_id == '1414560156' && attribute.repository_owner_id == '13293300' && attribute.environment == 'play'"
   gcloud projects describe masame-play --format='value(projectNumber)'   # le NUMERO_DU_PROJET ci-dessous
   gcloud iam service-accounts add-iam-policy-binding masame-play-upload@masame-play.iam.gserviceaccount.com \
     --project=masame-play --role=roles/iam.workloadIdentityUser \
     --member=principalSet://iam.googleapis.com/projects/NUMERO_DU_PROJET/locations/global/workloadIdentityPools/github/attribute.repository_id/1414560156
   ```

   Si l'étape `google-github-actions/auth` échoue, c'est la fédération (fournisseur, condition, liaison) ; si c'est l'envoi qui répond 403, c'est l'invitation Play Console, qui met parfois plusieurs heures à prendre effet.
4. **Environnement `play`**, réservé aux tags `android-v*`, puis ses trois secrets et une variable (le fournisseur d'identité, pas un secret) :

   ```sh
   gh api -X PUT repos/Slymaster/masame/environments/play \
     -F 'deployment_branch_policy[protected_branches]=false' -F 'deployment_branch_policy[custom_branch_policies]=true'
   gh api -X POST repos/Slymaster/masame/environments/play/deployment-branch-policies -f name='android-v*' -f type=tag
   base64 -i ~/masame-upload.p12 | gh secret set ANDROID_KEYSTORE_BASE64 --env play --repo Slymaster/masame
   gh secret set ANDROID_KEYSTORE_PASSWORD --env play --repo Slymaster/masame   # saisi au clavier
   gh secret set ANDROID_KEY_ALIAS --env play --repo Slymaster/masame --body upload
   gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --env play --repo Slymaster/masame \
     --body projects/NUMERO_DU_PROJET/locations/global/workloadIdentityPools/github/providers/masame
   ```
5. **Premier envoi, à la main.** Play ne crée l'app qu'à partir d'un bundle envoyé dans la console. Pousse le premier tag `android-v…` : le job `release` signe le bundle et le garde 7 jours comme artefact `masame-android` (page du run sur GitHub), même si son envoi échoue. Télécharge-le et dépose-le dans Test interne > Créer une release. Les tags suivants s'envoient seuls. Si Play répond « Only releases with status draft may be created on draft app », termine cette release dans la console : il le fait tant que l'app n'a jamais été publiée.

Le job de build Android ne voit aucun secret. Un job séparé, sans le code du projet, signe (jarsigner) puis envoie. Il affiche l'empreinte SHA-256 du certificat d'envoi : elle doit être celle de Play Console > Intégrité de l'app.

## Publier

```sh
git tag ios-v0.5.0 && git push origin ios-v0.5.0          # TestFlight
git tag android-v0.5.0 && git push origin android-v0.5.0  # Play, test interne
```

- Le tag doit être exactement la `version` de `src-tauri/tauri.conf.json`, sinon le build s'arrête.
- **iPhone** : la version affichée est `X.Y.Z`. Le numéro de build (CFBundleVersion) est `X.Y.<numéro du run>`, toujours croissant. Apple refuse plus de trois nombres, d'où `X.Y` et non `X.Y.Z`.
- **Android** : `versionName` = `X.Y.Z`, `versionCode` = numéro du run de `android.yml`, toujours croissant. N'envoie jamais à Play un build fait sur ta machine : son `versionCode` calculé (0.5.0 donne 5000) dépasserait ceux de la CI et bloquerait les envois suivants. Renommer `android.yml` remet le compteur à zéro.
- Retenter un tag : supprimer le tag, le repousser. Le nouveau run a un nouveau numéro, donc un nouveau build.

## Build local signé (Android, facultatif)

`src-tauri/gen/android/keystore.properties` (ignoré par git), s'il existe, signe les builds release locaux :

```properties
storeFile=/chemin/absolu/vers/masame-upload.p12
storePassword=…
keyAlias=upload
```

`storeFile` est le chemin absolu de ton `.p12` (Gradle ne développe pas `~`), ou un chemin relatif à `src-tauri/gen/android`.

Sans ce fichier, rien ne change pour les builds de debug, et les builds release restent non signés.
