# TwitchUnblock Connect — protocole site ↔ extension (v1)

Document de référence commun à l'extension (dossier `extension/` du dépôt web) et au
site (`public/assets/js`). Les deux côtés DOIVENT le suivre à la lettre. Une copie
vit dans `extension/PROTOCOL.md`.

## Principe de sécurité

- La session Twitch (cookie `auth-token`) et le jeton `Client-Integrity` ne quittent
  JAMAIS l'arrière-plan de l'extension : ni vers la page, ni vers le content script,
  ni dans un journal, ni sur disque. `auth-token` est relu dans les cookies à chaque
  usage ; le jeton d'intégrité vit dans `storage.session` (mémoire seulement, non
  lisible par les content scripts).
- Le site ne peut demander qu'une LISTE FERMÉE d'opérations (ci-dessous). Aucune
  requête GQL libre, aucun relais générique.
- Le content script n'est injecté que sur les origines autorisées, cadre principal
  seulement (`all_frames: false`) :
  - `https://twitchunblock.vercel.app/*` (production)
  - `https://test2-git-test-17d298-mxfia19s-projects.vercel.app/*` (aperçu Vercel de
    la branche de test, protégé par la connexion Vercel)
  Rien d'autre : pas de `*.vercel.app`, pas de localhost.
- L'arrière-plan revérifie tout : `sender.id === runtime.id`, origine de
  `sender.url` dans la liste ci-dessus, `sender.frameId === 0`, types et bornes de
  chaque argument.
- Opérations qui dépensent des points (`predictions.bet`, `polls.vote`,
  `rewards.redeem`) : refusées si le réglage « Paris, votes et récompenses depuis le
  site » est coupé, ou si `navigator.userActivation.isActive` est faux au moment où le
  content script reçoit la demande (elle doit suivre un vrai clic de l'utilisateur). Le
  site affiche en plus sa propre confirmation (montant, choix) avant d'envoyer. Une
  dépense n'est jamais envoyée à Twitch plus de 30 s après la demande (au-delà :
  `timeout`), pour que la réponse arrive avant les 45 s du site.
- Les réglages ne se changent que dans la fenêtre de l'extension, jamais par la page.

## Transport

Page ↔ content script : `window.postMessage(msg, location.origin)`. Chaque côté ignore
tout message dont `event.source !== window`, `event.origin !== location.origin`, ou
`msg.tuConnect !== 1`. Content script ↔ arrière-plan : `runtime.sendMessage`.

- Demande (page → extension) :
  `{ tuConnect: 1, dir: "req", id: "<chaîne ≤ 64 car.>", op: "<op>", args: { … } }`
- Réponse (extension → page) :
  `{ tuConnect: 1, dir: "res", id, ok: true, data: { … } }`
  ou `{ tuConnect: 1, dir: "res", id, ok: false, error: { code: "<code>", message: "<texte court, facultatif>" } }`
- Annonce (extension → page), envoyée par le content script à son chargement, et de
  nouveau quand un réglage change dans la fenêtre de l'extension :
  `{ tuConnect: 1, dir: "hello", protocol: 1, version: "<version de l'extension>", enabled: <bool> }`

Détection côté site : écouter les annonces, et envoyer `hello` à 0 s, 0,5 s, 1,5 s et
3 s tant qu'aucune réponse n'est arrivée. Délai d'attente par demande : 15 s (45 s pour
une opération qui peut devoir obtenir un jeton d'intégrité : `points.claim`,
`watch.beat`, `predictions.bet`, `polls.vote`, `raid.join`, `drops.claim`,
`drops.pulse`, `rewards.redeem`).

Après une installation ou une mise à jour de l'extension, le content script est
réinjecté dans les onglets du site déjà ouverts ; l'ancien (orphelin sous Chrome) ne
répond plus.

## Opérations (liste fermée)

`channel` = login Twitch de la chaîne, `^[a-z0-9_]{1,25}$` (le site met en minuscules).

1. `hello` `{}` → `{ protocol: 1, version, enabled, browser: "chrome" | "firefox" }`
2. `status` `{}` → `{ enabled, session: { login, userId } | null, settings: { autoClaim, allowSpend } }`
3. `points.get` `{ channel }` →
   `{ channelId, balance, claimAvailable, pointsName: string | null, pointsIconUrl: string | null, watchStreak: number | null }`
   (`watchStreak` : série de visionnage sur cette chaîne, même requête que l'iOS
   `BatchGetWatchStreaks` dans `LiveEventsService.swift` ; `null` si inconnue)
4. `points.claim` `{ channel }` → `{ claimed: <points gagnés ou null>, balance }`
   (l'arrière-plan relit le coffre disponible lui-même ; erreur `no_claim` s'il n'y en a pas)
5. `watch.beat` `{ channel }` → `{ live: bool, balance: number | null, claimed: number | null }`
   Envoie l'événement « minute-watched » comme l'app iOS (`ChannelPointsService.startWatchPresence`).
   Le site l'appelle toutes les 60 s pendant la lecture d'un direct (lecteur principal
   seulement, pas en pause, pas pour une VOD). Au plus un battement compté par 50 s et
   par chaîne. Si le réglage « Coffres automatiques » est actif et qu'un coffre est là,
   il est réclamé et `claimed` donne le gain.
6. `predictions.get` `{ channel }` →
   `{ balance, event: null | { id, title, status: "ACTIVE" | "LOCKED" | "RESOLVE_PENDING" | "RESOLVED" | "CANCELED", createdAt, windowSeconds, winningOutcomeId: string | null, outcomes: [ { id, title, color: "BLUE" | "PINK", totalPoints, totalUsers } ], self: null | { outcomeId, points } } }`
7. `predictions.bet` `{ channel, eventId, outcomeId, points }` (dépense) →
   `{ balance, self: { outcomeId, points } }`
   Vérifications : entier 1 … 250 000, ≤ solde, événement ACTIVE, issue de cet
   événement, pas de mise déjà faite sur une AUTRE issue.
8. `polls.get` `{ channel }` →
   `{ poll: null | { id, title, status: "ACTIVE" | "COMPLETED" | "TERMINATED" | "ARCHIVED", startedAt, durationSeconds, totalVotes, choices: [ { id, title, votes } ], pointsVoting: { enabled, cost }, self: null | { choiceIds: [ … ], votes } } }`
9. `polls.vote` `{ channel, pollId, choiceId, withPoints: bool }` (dépense si `withPoints`, et
   toujours soumis au vrai clic et au réglage) → `{ poll: <même forme que polls.get> }`

10. `raid.join` `{ channel, raidId }` → `{ joined: bool }`
   Rejoint le raid que lance la chaîne regardée (mutation `JoinRaid`, `input: { raidID }`),
   ce qui donne le bonus de points de raid, comme sur twitch.tv. Pas une dépense : pas de
   vrai clic exigé, mais soumis au réglage « Connexion au site ». `raidId` :
   `^[A-Za-z0-9-]{1,64}$`. Au plus une fois par raid (même `raidId` → réponse en cache),
   et 1 par 30 s et par chaîne. Le site l'appelle dès qu'il reçoit l'annonce du raid
   (`raid_update_v2`, champ `raid.id`) sur la chaîne regardée, avant de suivre le raid.

11. `drops.get` `{ channel }` →
   `{ channelHasDrops: bool, campaigns: [ { id, name, gameName: string | null, endsAt: string | null, drops: [ { id, name, imageUrl: string | null, requiredMinutes, currentMinutes, claimed: bool, dropInstanceId: string | null } ] } ] }`
   Campagnes de drops actives sur cette chaîne avec la progression du compte (reprend
   `Sources/Services/Drops.swift` de l'iOS : `refresh`, `refreshAvailable`,
   `refreshSession`, `campaign(_:)`). `dropInstanceId` non nul = drop réclamable.
12. `drops.claim` `{ dropInstanceId }` → `{ claimed: bool }`
   Mutation `DropsPage_ClaimDropRewards` (hash `claimHash` de Drops.swift), avec le jeton
   d'intégrité. Pas une dépense : pas de vrai clic exigé. `dropInstanceId` :
   `^[A-Za-z0-9#._:-]{1,200}$`. 1 par 5 s.
13. `drops.pulse` `{ channel }` → `{ active: bool, claimed: [ <noms des drops réclamés> ] }`
   Fait avancer les drops comme la « pulsation » de l'iOS (Drops.swift : `start`, `run`,
   `poll`, `lowestVariant`, `playbackToken`) : playlist de la plus basse qualité obtenue
   AVEC la session du compte, puis requête HEAD de chaque nouveau segment (rien n'est
   téléchargé ni lu). Le site l'appelle toutes les 10 s pendant la lecture d'un direct
   dont la chaîne a des drops (`channelHasDrops`), lecteur principal seulement, pas en
   pause. Au plus 1 par 8 s et par chaîne. Si « Réclamer automatiquement » est actif et
   qu'un drop devient réclamable, il est réclamé et son nom figure dans `claimed`.
   L'adresse signée de la playlist reste dans l'arrière-plan (`storage.session`).
14. `rewards.get` `{ channel }` →
   `{ balance, rewards: [ { id, title, cost, prompt: string | null, requiresInput: bool, enabled: bool, paused: bool, inStock: bool, cooldownEndsAt: string | null, color: string | null, imageUrl: string | null } ] }`
   Récompenses personnalisées de la chaîne (iOS : `ChannelPointsService.fetchRewards`).
15. `rewards.redeem` `{ channel, rewardId, cost, title, prompt: string | null, input: string | null }`
   (DÉPENSE : vrai clic + réglage « Paris, votes et récompenses ») → `{ balance }`
   Même mutation et mêmes champs que l'iOS (`ChannelPointsService.redeem`), avec le
   jeton d'intégrité. Vérifications : récompense relue et existante, activée, pas en
   pause, en stock, pas en recharge, coût identique à celui relu, ≤ solde ; `input`
   obligatoire si `requiresInput` (1 à 200 caractères) et interdit sinon. Erreur de
   Twitch → `twitch` avec son code.

Champs inconnus de Twitch : `null`, jamais inventés.

## Codes d'erreur

`disabled` (connexion au site coupée dans l'extension), `no_session` (pas connecté à
twitch.tv dans ce navigateur), `needs_activation` (dépense sans vrai clic),
`spend_disabled`, `bad_args`, `unknown_op`, `rate_limited`, `integrity` (jeton
d'intégrité impossible à obtenir), `twitch` (`message` = code d'erreur de Twitch),
`offline` (chaîne pas en direct), `no_claim`, `timeout`, `internal`.

`message` de `bad_args` (valeurs stables, que le site peut traduire) :

- forme de la demande, refusée par le content script ou l'arrière-plan : `id`, `args`
  (pas un objet, ou plus de 8 champs), ou le nom du champ inconnu ou mal formé
  (`channel`, `eventId`, `outcomeId`, `points`, `pollId`, `choiceId`, `withPoints`,
  `raidId`, `dropInstanceId`, `rewardId`, `cost`, `title`, `prompt`, `input`) ;
- `predictions.bet` : `eventId` (pas la prédiction en cours), `not_active` (pas
  ACTIVE), `outcomeId` (issue inconnue), `points` (plus que le solde), `other_outcome`
  (mise déjà faite sur une autre issue) ;
- `polls.vote` : `pollId` (pas le sondage en cours), `not_active`, `choiceId` (choix
  inconnu), `withPoints` (vote en points pas ouvert sur ce sondage), `points` (coût plus
  grand que le solde) ;
- `rewards.redeem` : `points_disabled` (points coupés sur la chaîne), `rewardId`
  (récompense inconnue), `not_enabled`, `paused`, `out_of_stock`, `cooldown`, `cost`
  (coût différent de celui relu), `title` (titre différent), `points` (coût plus grand
  que le solde), `input` (saisie manquante, vide, ou donnée sans être demandée).

`message` de `twitch` : le code de Twitch (`NOT_ENOUGH_POINTS`…, `UNKNOWN` s'il est
illisible), sinon `channel_not_found`, `network`, `bad_response`, `http_<statut>`,
`validate`, `validate_<statut>`, ou un message de Twitch nettoyé (80 caractères au plus).

## Limites de débit (arrière-plan)

Lectures (`*.get`, `status`) : au plus une requête Twitch par 3 s et par chaîne (sinon
réponse en cache) ; `points.claim` : 1 par 10 s ; `watch.beat` : 1 par 50 s et par
chaîne ; `raid.join` : 1 par 30 s et par chaîne ; `drops.claim` : 1 par 5 s ;
`drops.pulse` : 1 par 8 s et par chaîne ; dépenses : 1 par 3 s ; tout confondu :
60 demandes par minute, au-delà `rate_limited`.

## Réglages (fenêtre de l'extension, stockage local, sans secret)

- « Connexion au site TwitchUnblock » (actif par défaut)
- « Réclamer automatiquement (coffres et drops) » (actif par défaut ; clé `autoClaim`)
- « Paris, votes et récompenses depuis le site » (actif par défaut, toujours soumis au
  vrai clic ; clé `allowSpend`)

Dépenses soumises au vrai clic : `predictions.bet`, `polls.vote`, `rewards.redeem`.
Délais d'attente côté site (voir Transport) : 45 s aussi pour `raid.join`,
`drops.claim`, `drops.pulse` (qui peut obtenir un jeton d'intégrité pour le jeton de
lecture du compte) et `rewards.redeem`.
