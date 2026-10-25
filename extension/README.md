# TwitchUnblock Connect

> **English summary.** A small Manifest V3 browser extension (one code base for Chrome,
> Edge, Brave and Firefox 128+) that lets the TwitchUnblock site use the Twitch session of
> *this* browser — channel points, bonus chests, watch presence, drops, channel rewards,
> predictions, polls, raids, and since 0.2.0 lives in 1440p and above (Enhanced
> Broadcasting, served by Twitch to logged-in accounts only) — without the session ever
> leaving the extension. The site can only ask for a closed list of actions (see
> [PROTOCOL.md](PROTOCOL.md)); spending points needs a real click; for 1440p the page only
> gets the account's live playlists rewritten by the extension (segment addresses, no
> token, no playlist address); nothing is sent anywhere but Twitch.
> **Install**: download `twitchunblock-connect-chrome.zip` or
> `twitchunblock-connect-firefox.zip` from the
> [latest release](https://github.com/MXFia19/TwitchUnblock-Web/releases/latest) and follow
> [INSTALL.md](INSTALL.md) — unpacked in Chrome, Edge and Brave, as a temporary add-on in
> Firefox (until it is signed on AMO).

Extension de navigateur qui relie le site TwitchUnblock à la session Twitch de ce
navigateur. Le site peut alors afficher le solde de points, réclamer les coffres, faire
compter le visionnage (points passifs), faire avancer et réclamer les drops, échanger
des récompenses de chaîne, parier sur les prédictions, voter aux sondages et rejoindre
les raids, comme sur twitch.tv, et, depuis la 0.2.0, lire les directs en 1440p et plus
(voir « Qualités supérieures »). La session Twitch ne quitte jamais l'extension.

Mettre à jour une installation existante (0.1.0 → 0.2.0) : nouveau zip à la place des
anciens fichiers, puis ↻ sur la carte de l'extension (Chrome, Edge, Brave), ou nouveau
module temporaire (Firefox, qui demande l'accès de plus `*.playlist.ttvnw.net` :
« Autoriser l'accès » dans la fenêtre de l'extension). Détails : [INSTALL.md](INSTALL.md).

Le contrat entre le site et l'extension est dans [PROTOCOL.md](PROTOCOL.md) (copie du
document commun aux deux côtés).

## Installation

### Chrome, Edge, Brave (extension non empaquetée)

1. Télécharger `twitchunblock-connect-chrome.zip` dans la
   [dernière release](https://github.com/MXFia19/TwitchUnblock-Web/releases/latest)
   (publiée par le workflow « Extension » à chaque passage sur `main`) et le
   décompresser, ou prendre le dossier `extension/` d'un dépôt cloné. Étapes en anglais
   pour les utilisateurs : [INSTALL.md](INSTALL.md).
2. Ouvrir `chrome://extensions` (Edge : `edge://extensions`, Brave : `brave://extensions`).
3. Activer le **mode développeur**.
4. **Charger l'extension non empaquetée** et choisir le dossier (celui qui contient
   `manifest.json`).

### Firefox 128 et plus (module temporaire)

Le dossier `extension/` est la version Chrome (Chrome, Edge et Brave refusent
l'arrière-plan sous forme de script, que Firefox exige). La version Firefox se prépare à
part : `twitchunblock-connect-firefox.zip` dans la
[dernière release](https://github.com/MXFia19/TwitchUnblock-Web/releases/latest) (à
choisir tel quel, sans le décompresser), ou `node extension/dev/build-firefox.mjs` depuis
le dépôt cloné, qui l'écrit dans `extension-firefox/`.

1. Ouvrir `about:debugging#/runtime/this-firefox`.
2. **Charger un module complémentaire temporaire…** et choisir le zip Firefox de la
   release (ou le `manifest.json` de `extension-firefox/`).
3. Ouvrir la fenêtre de l'extension : si un cadre orange signale des accès manquants,
   cliquer **Autoriser l'accès** (ou `about:addons` → TwitchUnblock Connect →
   Permissions → autoriser twitch.tv et les deux adresses du site).

Un module temporaire disparaît à la fermeture de Firefox. L'installation durable demande
une signature de Mozilla (AMO), que fera plus tard le propriétaire du projet
(identifiant `connect@twitchunblock.app`).

### Ensuite

- Se connecter à **twitch.tv** dans ce navigateur (la session est le cookie `auth-token`
  de twitch.tv ; l'extension la relit à chaque usage).
- Ouvrir le site (`https://twitchunblock.vercel.app`, ou l'aperçu Vercel de la branche de
  test) : il détecte l'extension tout seul.

## La fenêtre de l'extension

- **État** : connecté en tant que @pseudo, ou « connecte-toi à twitch.tv » ; échéance du
  jeton d'intégrité s'il y en a un.
- **Réglages** (enregistrés dans le navigateur, sans secret), tous actifs par défaut :
  - *Connexion au site TwitchUnblock* : coupée, le site ne reçoit plus rien (il voit
    seulement que l'extension est là et coupée).
  - *Réclamer automatiquement (coffres et drops)* : le coffre bonus et les drops terminés
    sont réclamés pendant le visionnage d'un direct sur le site.
  - *Paris, votes et récompenses depuis le site* : toujours après un vrai clic sur le site
    et sa confirmation.
- **Diagnostic** : revalide la session et obtient un nouveau jeton d'intégrité. Les
  jetons n'apparaissent que masqués (4 premiers caractères et longueur).

## Sécurité et vie privée

- La session Twitch (`auth-token`) et le jeton `Client-Integrity` restent dans
  l'arrière-plan de l'extension : jamais envoyés à la page, au content script, dans un
  journal ni dans un message d'erreur. La session est relue dans les cookies à chaque
  usage, jamais copiée ; le jeton d'intégrité vit dans `storage.session` (mémoire du
  navigateur, effacée à sa fermeture, fermée aux content scripts).
- Le content script ne tourne que sur les deux adresses du site, cadre principal
  seulement. Il vérifie l'origine et la forme de chaque demande, ne touche pas à la page
  et ne voit aucun jeton. L'arrière-plan revérifie tout (expéditeur, origine, cadre,
  arguments).
- Liste fermée d'opérations, pas de requête GQL libre, pas de relais générique ; pas de
  `externally_connectable` ni de `web_accessible_resources`.
- Dépenses de points (paris, votes, récompenses) : réglage dédié + vrai clic
  (`navigator.userActivation`) + confirmation affichée par le site. Avant un rachat, la
  récompense est relue chez Twitch (active, pas en pause, en stock, pas en recharge, même
  coût, même titre, solde suffisant).
- Drops : l'adresse signée de la playlist (jeton de lecture du compte) et les segments
  déjà vus restent dans `storage.session` ; la page ne reçoit que « actif ou non » et les
  noms des drops réclamés.
- Qualités supérieures (0.2.0) : le jeton de lecture du compte, l'adresse usher et
  celles des playlists des variantes restent dans l'arrière-plan (`storage.session`) ;
  la page reçoit un identifiant tiré au hasard par variante, puis chaque playlist
  réécrite sur liste blanche (balises de lecture, pauses pub sans leurs attributs
  `X-TV-TWITCH-*`, adresses des segments du CDN de Twitch). C'est la seule chose de
  plus qui va à la page : sans elle, pas de 1440p (voir PROTOCOL.md, « Principe de
  sécurité »). Pas de `declarativeNetRequest` : la page n'obtient aucun droit de lire
  Twitch elle-même.
- Limites de débit dans l'arrière-plan (60 demandes par minute en tout, lectures mises en
  cache 3 s ; `hq.playlist` sur un budget à part de 240 par minute, etc. : voir
  PROTOCOL.md).
- Rien n'est envoyé ailleurs que chez Twitch : aucun serveur à nous, aucune statistique.
- Permissions : `cookies` (lire la session), `scripting` + `tabs` (obtenir le jeton
  d'intégrité dans une page twitch.tv), `storage` (réglages et état de session). Hôtes :
  `*.twitch.tv`, `static.twitchcdn.net` (fichier de réglages de twitch.tv où se trouve
  l'adresse des statistiques de visionnage), `usher.ttvnw.net` (liste des qualités d'un
  direct), `*.hls.ttvnw.net` (segments, demandés en HEAD pour les drops),
  `*.playlist.ttvnw.net` (0.2.0 : playlists des directs, pour les drops et le 1440p ;
  sans cet accès, Twitch les refuse à l'extension, en-tête Origin oblige — vérifié dans
  Chrome 155) et les deux adresses du site (content script, réinjecté dans les onglets
  déjà ouverts après une installation ou une mise à jour : sous Chrome, l'ancien reste
  orphelin et se tait). Un réglage changé dans la fenêtre est annoncé tout de suite à
  ces onglets.

## Notes de développement

### Fichiers

| Fichier | Rôle |
| --- | --- |
| `manifest.json` | MV3, version Chrome (`service_worker`) ; `dev/build-firefox.mjs` en tire la version Firefox (`scripts`, identifiant gecko) |
| `background.js` | opérations du protocole, session, jeton d'intégrité, limites, cache |
| `content.js` | pont page ↔ arrière-plan, rien d'autre |
| `popup.html`, `popup.js` | fenêtre : état, réglages, diagnostic |
| `_locales/*/messages.json` | textes en, fr, es, ru, it, ja |
| `icons/` | icônes PNG, refaites par `node dev/make-icons.mjs` |
| `tests/run.mjs` | banc d'essai Node (hors du zip) |
| `PROTOCOL.md` | contrat site ↔ extension |

JavaScript simple, sans dépendance ni étape de construction.

### Jeton d'intégrité

Les mutations de Twitch (coffre, pari, vote, raid, drop, récompense) exigent un en-tête
`Client-Integrity` produit par le script anti-robots de twitch.tv. Comme les apps,
l'extension fait faire `POST https://gql.twitch.tv/integrity` par une vraie page
www.twitch.tv (`scripting.executeScript`, `world: "MAIN"`), puis envoie elle-même les
mutations avec ce jeton (valable plusieurs heures) et `X-Device-Id` = cookie `unique_id`.
Elle prend un onglet www.twitch.tv déjà ouvert ; sinon elle ouvre
`https://www.twitch.tv/directory` dans un onglet inactif et coupé (pas de vidéo), puis
l'accueil en repli, et referme l'onglet. Une seule obtention à la fois ; mutation
refusée pour l'intégrité : jeton oublié, nouvelle obtention, un seul nouvel essai.
Après un échec, pas de nouvel onglet avant 30 s (5 min pour le coffre automatique).

### Requêtes Twitch

Reprises de l'app iOS (`Sources/Chat/ChannelPointsService.swift`,
`LiveEventsService.swift`, `TwitchGQL.swift`, `TwitchWebGQL.swift`,
`Sources/Services/Drops.swift`, `TwitchAPI.swift`) : mêmes persisted queries, mêmes
variables, mêmes en-têtes.

| Opération | Requête | Origine |
| --- | --- | --- |
| solde, coffre | `channel { id self { communityPoints { balance availableClaim { id } } } }` | iOS `fetchBalance` (+ `id`, comme l'essai) |
| nom et icône des points | `communityPointsSettings { name image { url2x } }` | requête brute, **pas dans l'iOS** |
| série de visionnage | `BatchGetWatchStreaks` | iOS `fetchStreak` |
| réclamer le coffre | `ClaimCommunityPoints` | iOS `claimBonus` |
| direct en cours | `user { stream { id } }` | iOS `fetchBroadcastId` |
| présence | `minute-watched` vers le spade (adresse lue dans la page de la chaîne) | iOS `sendMinuteWatched` |
| prédiction | `ChannelPointsPredictionContext`, `self { prediction … }`, `resolvedPredictionEvents` | iOS `fetchPrediction`, `myPrediction`, `resolvedWinner` |
| pari | `MakePrediction` | iOS `predict` |
| sondage, vote | `ChannelPollContext_GetViewablePoll`, `ChannelPollContext_VoteInPoll` | iOS `fetchPoll`, `vote` |
| vote avec des points | même mutation, `tokens: { bits: 0, channelPoints: <coût> }` | **pas dans l'iOS** (vote gratuit seulement) |
| raid | `JoinRaid` (hash non vérifié), repli en mutation brute | **pas dans l'iOS** |
| drops de la chaîne | `user { id channel { viewerDropCampaigns { id } } }` | iOS `dropsChannelId` |
| progression | `currentUser { inventory { dropCampaignsInProgress … } }` | iOS `refresh` |
| campagnes pas commencées | `currentUser { dropCampaigns … }` (jeton d'intégrité gardé seulement) | iOS `refreshAvailable` |
| drop en cours | `dropCurrentSession(channelID:)` | iOS `refreshSession` |
| réclamer un drop | `DropsPage_ClaimDropRewards` | iOS `claim` |
| pulsation | `streamPlaybackAccessToken` au nom du compte, usher, dernière variante, HEAD des nouveaux segments | iOS `accountPlaybackToken`, `lowestVariant`, `poll` |
| récompenses | `communityPointsSettings { isEnabled customRewards … }` | iOS `fetchRewards` |
| fin de recharge | `customRewards { id cooldownExpiresAt }` | requête brute, **pas dans l'iOS** |
| rachat | `redeemCommunityPointsCustomReward` (mutation écrite en clair) | iOS `redeem` |
| qualités supérieures | `streamPlaybackAccessToken` au nom du compte, usher avec `supported_codecs`, puis la playlist de chaque variante | iOS `accountPlaybackToken`, `HigherQualities`, `usherLiveLinks` |

### Drops

Depuis octobre 2026, Twitch ne compte les minutes de drops que si la session du compte
charge elle-même le flux. Comme l'app (`DropsHeartbeat`), chaque `drops.pulse` (toutes
les 10 s, rythmé par le site) relit la playlist de la plus basse qualité, obtenue avec
le jeton de lecture du compte, et demande chaque nouveau segment en HEAD : rien n'est
téléchargé ni lu. Jeton refusé : un neuf au battement suivant (une minute d'attente
après plusieurs refus) ; trois 404 de suite : direct fini, état oublié. Toutes les
5 min, si le réglage est actif, les drops terminés de l'inventaire sont réclamés (pas
ceux d'une campagne dont le compte de jeu n'est pas lié) ; une réclamation plus longue
que 6 s est annoncée au battement suivant.

`drops.get` ne fait jamais obtenir de jeton d'intégrité : si Twitch en demande un pour
le tableau de bord (campagnes pas encore commencées) et qu'aucun n'est gardé, ces
campagnes manquent jusqu'au prochain jeton (l'app, elle, en obtient un).

Jusqu'à la 0.1.0, la pulsation ne trouvait plus de variante : Twitch sert maintenant
ses playlists depuis `*.playlist.ttvnw.net` (seul `*.hls.ttvnw.net` était accepté), et
les refuse (403) à une extension sans accès à cet hôte (requête avec un en-tête Origin
`chrome-extension://…`). La 0.2.0 accepte cet hôte et en demande l'accès.

### Qualités supérieures

Twitch ne sert les variantes au-dessus de 1080p (Enhanced Broadcasting : 1440p, 4K,
parfois en HEVC ou AV1) qu'au jeton de lecture d'un compte ; celui d'un jeton anonyme
dit `maximum_resolution: FULL_HD` (`QUAD_HD: AUTHZ_NOT_LOGGED_IN`). `hq.master` obtient
le jeton du compte (comme la pulsation des drops), demande la liste à usher avec
`supported_codecs` (choisis par le site : `h264`, et `h265` ou `av1` si le navigateur
les décode en matériel) et rend chaque variante sous un identifiant tiré au hasard ;
`hq.playlist` lit la playlist d'une variante et la réécrit (PROTOCOL.md, opération 17).

Pourquoi l'extension relit chaque playlist au lieu de laisser la page le faire
(essais du 25/10/2026 avec un jeton anonyme, sans compte) : usher n'envoie
`Access-Control-Allow-Origin` que pour `https://www.twitch.tv`, et les playlists des
variantes, ouvertes à tous (`*`), répondent 403 dès qu'un en-tête Origin étranger est
là (celui du site, `null`, ou `chrome-extension://…`). Une règle
`declarativeNetRequest` qui réécrirait l'Origin pour la page aurait marché, mais
demandait une permission de plus et donnait à la page les adresses des playlists
(valables toute la séance) ; ici elle n'a que celles des segments (quelques secondes
de vidéo chacune), que leur CDN sert à toute origine.

### Durée de vie de l'arrière-plan

Chrome arrête le service worker après ~30 s sans événement (Firefox fait de même avec sa
page d'événements). Aucune minuterie longue : le site rythme les battements, et ce qui
doit survivre (limites de débit, jeton d'intégrité, dernière prédiction vue, votes
faits d'ici, état de la pulsation des drops, onglet temporaire à refermer) est dans
`storage.session`.

### Essais

```sh
node extension/tests/run.mjs
```

API `chrome` simulées, Twitch simulé, aucune requête réseau. Le banc vérifie notamment
le refus des opérations inconnues et des mauvaises origines ou cadres, les bornes des
arguments (même table pour le content script et l'arrière-plan), le refus d'une dépense
sans vrai clic ou avec le réglage coupé, les limites de débit (y compris après un
redémarrage de l'arrière-plan), l'obtention du jeton d'intégrité (onglet ouvert,
onglet temporaire, repli, un seul essai de plus), les drops (pulsation, segments en
HEAD, réclamation), les vérifications avant un rachat, les qualités supérieures (jeton du
compte, `supported_codecs`, variantes sans adresse, playlist réécrite à l'octet près,
identifiants liés à la session, budget à part) et l'absence de tout morceau de jeton ou
d'adresse signée dans les réponses, les journaux et `storage.local` (seules les réponses
de `hq.playlist` portent des adresses de segments, jamais usher, une playlist, un
déclencheur ni le jeton de lecture).

### Paquet

Le workflow `.github/workflows/extension.yml` (poussée sur `test-17d298` ou `main`
touchant `extension/`, ou lancement manuel) vérifie les JSON, la syntaxe des JS, lance
le banc d'essai et produit les paquets Chrome et Firefox (sans `tests/` ni `dev/`) en
artefacts. Sur `main`, il les publie aussi dans la release `connect-v<version>` (la
version du manifeste : `connect-v0.2.0`), marquée la dernière, avec `INSTALL.md` pour
texte : c'est elle qu'ouvre le lien du site (…/releases/latest).

Le site (Vercel ne sert que `public/`) et l'image Docker (le `Dockerfile` ne copie que
des chemins précis) n'embarquent pas ce dossier.
