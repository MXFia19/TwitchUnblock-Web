# TwitchUnblock Connect — essai (etape 0)

Extension de navigateur **minimale** (Manifest V3), un seul code pour **Chrome, Edge
et Firefox**. But de cette etape 0 : verifier qu'une extension peut faire, en local,
ce que font deja les apps iOS et Android — lire la session Twitch, obtenir un **jeton
d'integrite**, lire le **solde de points** et **reclamer un coffre** — **sans jamais
faire sortir la session de l'extension**.

A ce stade : **aucun** lien avec le site (twitchunblock.vercel.app), **aucun**
`externally_connectable`, **aucune** donnee envoyee ailleurs que chez Twitch. Le pont
avec le site viendra a l'etape 1.

## Ce que fait chaque bouton

1. **Session** — lit le cookie `auth-token` de twitch.tv (permission `cookies` + acces
   hote `*.twitch.tv`) et le valide via `https://id.twitch.tv/oauth2/validate`. Affiche
   le pseudo et l'id du compte. Le jeton n'est jamais affiche en clair (au plus ses 4
   premiers caracteres + sa longueur).
2. **Jeton d'integrite** — le point delicat. Twitch exige un en-tete `Client-Integrity`
   signe par son script anti-robots ; impossible a fabriquer soi-meme. L'extension
   execute donc la requete `POST https://gql.twitch.tv/integrity` **dans le contexte
   d'une vraie page twitch.tv** (`scripting.executeScript` avec `world: "MAIN"`), ou le
   script de Twitch ajoute tout seul ses en-tetes de protection. Elle utilise un onglet
   twitch.tv **deja ouvert** si possible, sinon elle en **ouvre un en arriere-plan
   (inactif)** le temps de l'essai, puis **le referme**. Affiche le jeton (masque) et sa
   date d'expiration, ou l'erreur exacte.
3. **Solde des points** — requete GQL (meme forme que les apps) pour la chaine saisie,
   avec la session (et le jeton d'integrite s'il a ete obtenu). Affiche le solde et s'il
   y a un coffre disponible.
4. **Reclamer le coffre** — mutation `ClaimCommunityPoints` (meme persisted query que les
   apps), seulement si un coffre est disponible. Affiche le resultat.

## Charger l'extension

### Chrome / Edge
1. Ouvrir `chrome://extensions` (ou `edge://extensions`).
2. Activer le **mode developpeur** (en haut a droite).
3. Cliquer **« Charger l'extension non empaquetee »** et choisir le dossier `extension`.

### Firefox (recent, 128+)
1. Ouvrir `about:debugging#/runtime/this-firefox`.
2. Cliquer **« Charger un module complementaire temporaire… »**.
3. Choisir le fichier `extension/manifest.json`.
4. Si besoin, autoriser l'acces a twitch.tv : icone de l'extension → autorisations
   (sous Firefox, les acces hotes MV3 peuvent demander une autorisation explicite).

## Faire les essais (dans l'ordre)

1. **Etre connecte a twitch.tv** dans ce navigateur (le cookie `auth-token` doit exister).
2. Ouvrir la **fenetre de l'extension** (clic sur son icone).
3. Saisir une **chaine en direct** dans le champ (un salon que tu regardes / ou tu as deja
   des points).
4. Cliquer les **4 boutons dans l'ordre** : Session → Jeton d'integrite → Solde des points
   → Reclamer le coffre.

## Quoi me renvoyer

- Le **message affiche sous chaque bouton** (OK ou echec + raison).
- Pour le jeton d'integrite : **obtenu ou non**, et la **date d'expiration**.
- **Ne recopie jamais un jeton entier** : les messages sont deja masques (4 premiers
   caracteres + longueur), laisse-les tels quels.

## Securite

- Permissions minimales : `cookies`, `scripting`, `tabs`, hote `*://*.twitch.tv/*`.
- Les jetons restent en memoire de la fenetre, ne sont jamais ecrits dans un journal, et
  ne sortent jamais vers un autre site que Twitch.
- Pas de `externally_connectable`, pas de serveur, pas de telemetrie.
