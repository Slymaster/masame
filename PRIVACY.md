# Privacy policy · Politique de confidentialité

*Prepared for the next Masame mobile OGS release. Not a notice that this draft build has been published.*
*En français plus bas.*

## English

Masame has no Masame account, analytics, advertising, tracking or automatic crash reporting. Its author operates no server
that receives your games or learning progress. Offline play and learning work without an OGS account.

### Network services you use

- **katagotraining.org** and **media.katagotraining.org** provide the network catalogue and the neural networks you choose
  to download. After installation, local play and analysis work offline. Like any download host, these sites see your IP address.
- **OGS (online-go.com)** is optional on desktop, Android and iPhone. If you sign in or watch games, Masame contacts OGS.
  Your password is entered in the system browser on OGS, never in Masame. OGS receives the game actions, account identifiers,
  a randomly generated installation identifier, app version, browser user agent and language needed by its client protocol.
  OGS keeps the online games and account under its own [privacy policy](https://online-go.com/docs/privacy-policy).
  During dead-stone marking, **ai.online-go.com** may receive the final board, game rules and an OGS session JWT for OGS's scorer.
  Your local learning progress and unrelated local games are not uploaded to OGS.
- **The HTTPS sign-in callback host** is the host shown in the browser at the end of OGS authorization. It is associated with
  the installed app. The callback carries a one-use authorization code and state, never your refresh token or password.
  When association works the OS opens Masame; the static fallback page has no analytics. The code can only be exchanged
  with the private verifier kept on your device. The release owner must configure the host before distributing the app.
- **Desktop updates:** GitHub and its file servers are checked for a new version when automatic checks are enabled.
  Updates download only when you choose to install them. Phone apps update through their stores.
- Links you open and files you explicitly export go through your browser or system sharing UI.

### Local storage and deletion

Games, settings, learning progress and downloaded networks stay in the app's data folder. Exported files go where you choose.
The Android Keystore protects a key used to encrypt OGS credentials in the app's non-backup folder. iOS uses its device-only
Keychain while the device is unlocked. An OAuth sign-in transaction is valid for at most five minutes and consumed once. Expired transactions are removed when the app next checks them.
Mobile has no plaintext credential fallback. OGS access tokens are available to the local webview; refresh tokens remain native.

Signing out erases local OGS credentials and attempts to revoke them at OGS. If the device is offline, local sign-out still works;
you can revoke Masame's authorization from OGS too. Sign-out does not delete your OGS account or online games. Use OGS's
account controls for their deletion. Deleting Masame removes its local files; use sign-out before removal to erase its Keychain
entry as well. A Keychain entry can survive an app reinstall depending on the operating system.

### Backups and notifications

Your device's Apple/Google backup may include your local games, settings and progress under your own account. Downloaded
networks are excluded. Mobile OGS credentials and pending sign-ins are device-only and are not included in those backups.
Masame does not send phone push notifications or keep your online games connected after the OS suspends or closes the app.
Your OGS clock can keep running while Masame is not visible. Desktop can show local notifications while Masame remains open.

### Children and stores

Masame has no in-app chat. Optional OGS play connects you to other players and is governed by OGS's account rules.
Apple and Google process app downloads under their own policies. The author sees the anonymous aggregated statistics provided
by their store consoles. The next mobile release's store privacy disclosures must include the optional OGS integration.

### Contact

Write to sylvain@guarani-llc.com or open [an issue](https://github.com/Slymaster/masame/issues).
Masame is [open source](https://github.com/Slymaster/masame), under the MIT licence.

## Français

Masame n'a ni compte Masame, ni statistiques d'usage, publicité, pistage ou rapports automatiques de plantage. Son auteur
n'exploite aucun serveur recevant tes parties ou ta progression. Le jeu et l'apprentissage locaux fonctionnent sans compte OGS.

### Services réseau utilisés

- **katagotraining.org** et **media.katagotraining.org** fournissent le catalogue et les réseaux que tu choisis de télécharger.
  Après installation, le jeu et l'analyse locaux fonctionnent hors ligne. Ces sites voient ton adresse IP comme tout hébergeur.
- **OGS (online-go.com)** est facultatif sur ordinateur, Android et iPhone. Masame contacte OGS quand tu te connectes ou
  regardes des parties. Tu saisis ton mot de passe dans le navigateur système sur OGS, jamais dans Masame. OGS reçoit les
  actions de jeu, les identifiants du compte, un identifiant d'installation aléatoire, la version de l'app, le user agent et la langue
  prévus par son protocole. OGS conserve les parties et le compte selon sa [politique](https://online-go.com/docs/privacy-policy).
  Pendant le marquage des pierres mortes, **ai.online-go.com** peut recevoir le plateau final, les règles et un JWT de session
  OGS pour son compteur. Ta progression d'apprentissage et tes autres parties locales ne sont pas envoyées à OGS.
- **L'hôte HTTPS de retour de connexion**, visible dans le navigateur à la fin de l'autorisation OGS, est associé à l'app
  installée. Le retour porte un code d'autorisation à usage unique et un state, jamais ton refresh token ni ton mot de passe.
  Le système ouvre Masame quand l'association fonctionne ; la page statique de secours n'a pas de statistiques. Le code
  nécessite le verifier privé gardé sur l'appareil. Le responsable de la release doit configurer cet hôte avant distribution.
- **Mises à jour sur ordinateur :** GitHub et ses serveurs sont interrogés si les vérifications automatiques sont activées.
  Une mise à jour se télécharge seulement si tu choisis de l'installer. Les téléphones se mettent à jour par leurs stores.
- Les liens ouverts et les fichiers que tu exportes passent par le navigateur ou le partage système à ton initiative.

### Stockage local et suppression

Parties, réglages, progression et réseaux restent dans le dossier de l'app. Les exports vont où tu choisis. Android Keystore
protège une clé qui chiffre les identifiants OGS dans un dossier exclu des sauvegardes. iOS utilise son Keychain limité à
l'appareil déverrouillé. Une transaction OAuth est valable au plus cinq minutes et consommée une seule fois. Une transaction expirée est effacée au prochain contrôle par l’app. Sur mobile,
aucun identifiant n'est enregistré en clair. La webview locale reçoit l'access token OGS ; le refresh token reste natif.

Se déconnecter efface les identifiants locaux et tente de les révoquer chez OGS. Hors ligne, la déconnexion locale fonctionne
quand même ; tu peux aussi révoquer l'autorisation de Masame depuis OGS. Cela ne supprime ni ton compte ni tes parties OGS.
Leur suppression passe par les réglages OGS. Supprimer Masame supprime ses fichiers locaux ; déconnecte-toi avant pour effacer
également son entrée Keychain. Selon le système, une entrée Keychain peut survivre à une réinstallation.

### Sauvegardes et notifications

La sauvegarde Apple/Google de ton appareil peut inclure tes parties locales, réglages et progression, sous ton propre compte.
Les réseaux téléchargés sont exclus. Les identifiants OGS mobiles et les connexions en attente restent liés à l'appareil et ne sont
pas dans ces sauvegardes. Masame n'envoie pas de push sur téléphone et ne maintient pas les parties connectées après suspension
ou fermeture par le système. Ton horloge OGS peut continuer pendant que Masame n'est pas visible. Sur ordinateur, des notifications
locales sont possibles tant que Masame reste ouvert.

### Enfants et stores

Masame n'a pas de discussion intégrée. Le jeu OGS facultatif te met en relation avec d'autres joueurs selon les règles de compte
OGS. Apple et Google traitent les téléchargements selon leurs politiques. L'auteur voit les statistiques anonymes agrégées de leurs
consoles. Les déclarations de confidentialité de la prochaine version mobile doivent inclure l'intégration OGS facultative.

### Contact

Écris à sylvain@guarani-llc.com ou ouvre [une issue](https://github.com/Slymaster/masame/issues).
Masame est [open source](https://github.com/Slymaster/masame), sous licence MIT.
