// ═══════════════════════════════════════════════════════════════════════════
//  Bot Discord de TwitchUnblock, lancé par relay.mjs. Tout ce qu'il poste est
//  en anglais : la communauté l'est surtout. Seules les réponses visibles de
//  la personne seule de /roles, /roles-config, /download, /version, /help,
//  /live, /top, /my-reports, /suggest, /suggestions et /app-announce suivent
//  la langue de son Discord (français, espagnol, russe ; anglais sinon).
//
//  Retours (bugs, idées) — le pont :
//    - le Worker publie chaque retour dans un salon « Forum » (un post par
//      retour, où arrivent aussi les réponses de la personne) ;
//    - ce qu'on écrit dans le post part comme réponse du développeur (« // »
//      au début : note privée) ; ✅ quand c'est parti, ❌ sinon ;
//    - l'étiquette d'état (New, Seen, Accepted, In progress, Done, Declined)
//      devient l'état du retour ; le bot crée celles qui manquent et renomme
//      en anglais les anciennes ;
//    - boutons de réponses rapides sous chaque nouveau retour ;
//    - /delete, /block (la personne ne peut plus écrire), /merge (doublon) ;
//    - passé à « Done », le bot demande où sortira le correctif, et la
//      personne est prévenue quand la version sort (« It's live ») ;
//    - posts « Done » ou « Declined » archivés après un jour sans activité ;
//    - /bug et /idea : n'importe quel membre signale depuis Discord (une
//      capture en option de la commande) ; les réponses lui arrivent en
//      message privé, images jointes, avec deux boutons pour répondre
//      (« Reply » : texte ; « Send screenshots » : captures) ;
//    - les retours d'avant le pont reçoivent leur post.
//  Surveillance (salon privé choisi avec /setup) : Workers en panne, ntfy en
//  pause, webhook refusé, CI de l'app ou du site en échec, forum des retours
//  visible de tous ; résumé chaque matin. Le relais lui-même : le Worker
//  prévient (ALERT_WEBHOOK).
//  Communauté : /announce (bandeau de l'app et du site), /poll et
//  /poll-end (sondage, résultats postés à la fin) ; brouillon des
//  notes de version à chaque sortie, publié d'un bouton (avec la mention du
//  rôle des sorties choisi par /setup) ; versions de test annoncées aux
//  testeurs ; /release-pings (ou le bouton posté par /setup, gardé tout en
//  bas du salon des annonces) : chacun prend ou rend ce rôle (sans
//  permission ni accès à un salon, vérifié).
//  Rôles : /roles, un menu de ses rôles (les rôles choisis par
//  /roles-config, et celui des sorties) ; public:true (développeur) : un
//  message permanent dans le salon, le même menu pour tous. Seuls des rôles
//  sûrs, revérifiés à chaque fois ; un changement toutes les 5 s par personne.
//  Pour tous aussi : /download (toutes les façons d'installer), /version
//  (dernières versions, lues sur GitHub et le site), /help ; /live (une
//  chaîne en direct ?) et /top (les 10 plus gros directs), avec des boutons
//  vers le site et vers l'app (une adresse du Worker qui y renvoie) ;
//  /my-reports (ce qu'on a envoyé et son état) ; /suggest (une suggestion :
//  un retour, et une carte publique où les membres votent ; boutons d'état
//  pour le développeur ; la carte part avec la suggestion, par la corbeille)
//  et /suggestions top — réponses gardées 60 s.
//  Bienvenue (/setup use: Welcome) : un message pour chaque arrivée, avec
//  Download, Pick roles et Help ; il demande l'intent GUILD_MEMBERS, refusé
//  par Discord s'il n'est pas activé dans le portail (le bot repart alors
//  sans lui et coupe la bienvenue).
//  /app-announce : l'annonce des apps et du site, publiée après un aperçu.
//  À faire : « Add to to-do » (menu Apps d'un message : une bonne idée lue
//  sur le serveur) et /todo (texte libre) postent une carte dans le salon
//  choisi par /setup, avec un bouton Done / Reopen. Une copie des cartes
//  (todo_mirror), relue au moins toutes les 15 min, reste dans le Worker :
//  tools/reports.mjs --todo la lit depuis le PC du développeur.
//  Exploitation (salon privé) : plafonds du jour à 80 %, base à 70 % de sa
//  taille, tâche planifiée muette depuis 5 min, quotas gratuits de
//  Cloudflare à 70 % (avec CLOUDFLARE_API_TOKEN), VPS ou Worker en retard
//  sur GitHub ; /status (état en un message), /forget-user (effacer les
//  données d'une personne, après confirmation). Chaque action du
//  développeur part avec son auteur (`by`) : le Worker la note au journal
//  d'audit.
//  Seuls le propriétaire du serveur et DISCORD_ADMIN_IDS agissent au nom du
//  développeur.
//
//  Variables (relay/docker-compose.yml, fichier .env) : DISCORD_BOT_TOKEN,
//  FEEDBACK_BOT_SECRET (même valeur que sur le Worker), FEEDBACK_WORKER,
//  DISCORD_ADMIN_IDS ; facultatives : FALLBACK_WORKERS, SUMMARY_TZ,
//  SUMMARY_HOUR, CLOUDFLARE_API_TOKEN et CLOUDFLARE_ACCOUNT_ID (quotas).
//
//  Sans dépendance : passerelle de Discord par le WebSocket de Node 22, API
//  REST par fetch. Sa mémoire (réglages, versions vues, brouillons, copie
//  de la liste à faire) est rangée par le Worker (D1), rien sur le disque
//  du VPS.
// ═══════════════════════════════════════════════════════════════════════════

// GUILDS (salons, posts, étiquettes, rôles), GUILD_MESSAGES, DIRECT_MESSAGES (pour
// renvoyer vers les boutons qui écrit au bot en privé), MESSAGE_CONTENT
// (intention privilégiée, à activer dans le portail : le texte des messages).
const INTENTS = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15)
// GUILD_MEMBERS (intention privilégiée « Server Members ») : les arrivées,
// pour la bienvenue — demandée seulement quand un salon est choisi.
const GUILD_MEMBERS = 1 << 1
// Fermetures sans nouvel essai possible (4014 avec GUILD_MEMBERS demandée :
// nouvel essai sans elle).
const FATAL = new Map([
  [4004, 'token refused (DISCORD_BOT_TOKEN)'],
  [4010, 'invalid shard'],
  [4011, 'sharding required'],
  [4012, 'invalid API version'],
  [4013, 'invalid intents'],
  [4014, 'Message Content intent not enabled (developer portal → Bot)'],
])
const FORUM = 15
const STATUSES = ['new', 'seen', 'accepted', 'progress', 'done', 'refused']
const LABELS = { new: 'New', seen: 'Seen', accepted: 'Accepted', progress: 'In progress', done: 'Done', refused: 'Declined' }
// Noms d'étiquettes reconnus pour chaque état (sans accents ni emoji).
const TAG_NAMES = {
  new: ['new', 'received', 'recu', 'nouveau'],
  seen: ['seen', 'vu'],
  accepted: ['accepted', 'accepte'],
  progress: ['in progress', 'progress', 'en cours'],
  done: ['done', 'fixed', 'fait', 'termine', 'resolu'],
  refused: ['declined', 'refused', 'refuse'],
}
const normName = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z]+/g, ' ').trim()
const statusOfName = (name) => STATUSES.find((s) => TAG_NAMES[s].includes(normName(name))) || null
// Réponses rapides : envoyées telles quelles à la personne. « Fixed next
// version » passe aussi le retour à « Done ».
const QUICK = [
  { label: 'Thanks, noted', text: "Thanks for the report! It's noted — I'll keep you posted here." },
  { label: 'Send a screenshot', text: 'Thanks! Could you send a screenshot or a short screen recording of the problem? You can attach it to your reply.' },
  { label: 'More details', text: 'Thanks! Could you tell me a bit more: which channel or video, what you did just before, and whether it happens every time?' },
  { label: 'Fixed next version', text: "Good news: it's fixed and will be in the next version. I'll tell you here as soon as it's out.", status: 'done' },
  { label: 'Already fixed', text: 'This should already be fixed in the latest version. Could you update and tell me if it still happens?' },
  { label: "Can't reproduce", text: "I can't reproduce it on my side. Does it still happen? A screenshot or more details would help a lot." },
]
// Commandes : celles du développeur sont réservées par défaut aux
// administrateurs du serveur (default_member_permissions « 0 »), et le bot
// le vérifie aussi.
const ADMIN = '0'
// /bug et /idea : capture facultative (type 11, pièce jointe), gardée le
// temps de remplir le formulaire.
const screenshotOption = (description) => [{ type: 11, name: 'screenshot', description, required: false }]
// /top language: : codes de langue de Twitch (25 choix au plus dans Discord),
// les mêmes que ceux qu'accepte le Worker.
const TOP_LANGUAGES = ['en', 'es', 'pt', 'de', 'fr', 'ru', 'ja', 'ko', 'zh', 'it', 'pl', 'tr', 'ar',
  'th', 'id', 'hi', 'uk', 'nl', 'sv', 'cs', 'hu', 'fi', 'da', 'no', 'vi']
const languageNames = new Intl.DisplayNames(['en'], { type: 'language' })
const COMMANDS = [
  { name: 'bug', description: 'Report a bug in TwitchUnblock (app or website)', options: screenshotOption('A screenshot of the problem (optional)') },
  { name: 'idea', description: 'Suggest an idea for TwitchUnblock', options: screenshotOption('An image to go with your idea (optional)') },
  { name: 'delete', description: 'Delete this report (run it in its post)', default_member_permissions: ADMIN },
  { name: 'block', description: 'Close this report: the user can no longer write in it', default_member_permissions: ADMIN },
  {
    name: 'merge', description: 'Merge this report into another one (duplicate)', default_member_permissions: ADMIN,
    options: [{ type: 3, name: 'into', description: 'Link or ID of the other report’s post', required: true }],
  },
  {
    name: 'announce', description: 'Show an announcement in the app and on the website', default_member_permissions: ADMIN,
    options: [{ type: 3, name: 'template', description: 'Start from a saved template (edit them in /stats)', required: false, autocomplete: true }],
  },
  { name: 'announce-clear', description: 'Remove the current announcement', default_member_permissions: ADMIN },
  { name: 'poll', description: 'Start a poll in the app and on the website', default_member_permissions: ADMIN },
  { name: 'poll-end', description: 'End the current poll and post its results', default_member_permissions: ADMIN },
  {
    name: 'setup', description: 'Use this channel for the bot', default_member_permissions: ADMIN,
    options: [
      {
        type: 3, name: 'use', description: 'What this channel is for', required: true,
        choices: [
          { name: 'Alerts, daily summary and release drafts (private)', value: 'alerts' },
          { name: 'Release announcements', value: 'announcements' },
          { name: 'Test builds', value: 'testers' },
          { name: 'To-do list (suggestions to keep)', value: 'todo' },
          { name: 'Suggestions (/suggest cards, members vote)', value: 'suggestions' },
          { name: 'Welcome messages for new members', value: 'welcome' },
          { name: 'Stop the welcome messages', value: 'welcome-off' },
        ],
      },
      { type: 8, name: 'role', description: 'Role to mention (release announcements or test builds)', required: false },
    ],
  },
  { name: 'summary', description: 'Post the daily summary now', default_member_permissions: ADMIN },
  // Menu « Apps » d'un message (clic droit, ou appui long sur mobile).
  { type: 3, name: 'Add to to-do', default_member_permissions: ADMIN },
  {
    name: 'todo', description: 'Add an item to the to-do channel', default_member_permissions: ADMIN,
    options: [{ type: 3, name: 'text', description: 'What to do', required: true, max_length: 1500 }],
  },
  { name: 'release-pings', description: 'Get pinged when a new version is out (run it again to stop)' },
  // « public » : réservé au développeur (vérifié par le bot) ; Discord ne
  // cache pas une option à une partie des membres.
  {
    name: 'roles', description: 'Pick your roles',
    options: [{ type: 5, name: 'public', description: 'Developer only: post a roles menu in this channel for everyone', required: false }],
  },
  {
    name: 'roles-config', description: 'Choose the roles members can pick with /roles', default_member_permissions: ADMIN,
    options: [
      {
        type: 1, name: 'add', description: 'Offer a role in /roles (or change its description or emoji)',
        options: [
          { type: 8, name: 'role', description: 'A role without permissions, not used in channel permissions, below the bot’s', required: true },
          { type: 3, name: 'description', description: 'Shown under the role in the menu', required: false, max_length: 100 },
          { type: 3, name: 'emoji', description: 'A standard emoji or one of this server’s', required: false, max_length: 64 },
        ],
      },
      { type: 1, name: 'remove', description: 'Stop offering a role in /roles', options: [{ type: 8, name: 'role', description: 'The role', required: true }] },
      { type: 1, name: 'list', description: 'Show the roles offered in /roles' },
    ],
  },
  {
    name: 'download', description: 'All the ways to install TwitchUnblock',
    options: [{ type: 5, name: 'public', description: 'Developer only: post it in this channel', required: false }],
  },
  { name: 'version', description: 'Latest versions of the apps and the website' },
  { name: 'help', description: 'What the bot can do for you' },
  {
    name: 'live', description: 'Is a Twitch channel live? Title, category, viewers, uptime',
    options: [{ type: 3, name: 'channel', description: 'The channel’s name (or its twitch.tv link)', required: true, max_length: 60 }],
  },
  {
    name: 'top', description: 'The 10 biggest lives right now',
    options: [
      { type: 3, name: 'category', description: 'Only this category (e.g. Just Chatting)', required: false, max_length: 100 },
      {
        type: 3, name: 'language', description: 'Only streams in this language', required: false,
        choices: TOP_LANGUAGES.map((value) => ({ name: languageNames.of(value), value })),
      },
    ],
  },
  { name: 'my-reports', description: 'What you sent with /bug, /idea or /suggest, and its status' },
  { name: 'suggest', description: 'Suggest a feature — members can vote for it' },
  {
    name: 'suggestions', description: 'Suggestions sent with /suggest',
    options: [{ type: 1, name: 'top', description: 'The 10 most voted open suggestions' }],
  },
  {
    name: 'app-announce', description: 'Announcement in the apps and on the website, after a preview', default_member_permissions: ADMIN,
    options: [
      {
        type: 1, name: 'post', description: 'Preview an announcement, then publish it with a button',
        options: [
          { type: 3, name: 'text', description: 'The message (500 characters at most)', required: true, max_length: 500 },
          { type: 3, name: 'duration', description: 'How long: 30m, 6h, 3d… — 1 minute to 30 days (default 24h)', required: false, max_length: 12, autocomplete: true },
          { type: 3, name: 'link', description: 'A link (https://…)', required: false, max_length: 300 },
          { type: 3, name: 'title', description: 'A title above the message', required: false, max_length: 80 },
        ],
      },
      { type: 1, name: 'clear', description: 'Remove the current announcement' },
    ],
  },
  { name: 'status', description: 'Server status: Workers, database, notifications, versions, quotas, top D1 reads', default_member_permissions: ADMIN },
  {
    name: 'forget-user', description: 'Erase a person’s data (shows what will go, then asks to confirm)', default_member_permissions: ADMIN,
    options: [{ type: 3, name: 'who', description: 'Twitch name/ID, install ID, report link/ID, @user, ntfy topic (several allowed)', required: true, max_length: 1000 }],
  },
]
const MAX_PHOTO_B64 = 700_000     // comme le Worker (~500 Ko d'image)
// Octets d'une image qui tient dans MAX_PHOTO_B64 : au-delà, pas la peine de
// la télécharger.
const MAX_PHOTO_BYTES = MAX_PHOTO_B64 / 4 * 3
const MAX_PHOTOS = 3              // par message, comme le Worker
const MAX_TAGS = 5                // par post (limite de Discord)
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const PHOTO_TYPES = 'JPEG, PNG or WebP'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const snowflakeTime = (id) => Number((BigInt(id) >> 22n) + 1420070400000n)
const row = (...components) => ({ type: 1, components })
const button = (label, custom_id, style = 2) => ({ type: 2, style, label, custom_id })
const textInput = (custom_id, label, style, { min, max, required = true, placeholder, value } = {}) =>
  ({ type: 4, custom_id, label, style, required, ...(min ? { min_length: min } : {}), ...(max ? { max_length: max } : {}), ...(placeholder ? { placeholder } : {}),
    ...(value ? { value: String(value).slice(0, max || 4000) } : {}) })
// Formulaire « Send screenshots » : chaque champ dans un « Label » (type 18,
// libellé de 45 caractères au plus, description de 100), les fichiers dans
// un « File Upload » (type 19).
const labelled = (label, component, description) => ({ type: 18, label, ...(description ? { description } : {}), component })
const fileUpload = (custom_id) => ({ type: 19, custom_id, min_values: 1, max_values: MAX_PHOTOS, required: true })
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`
const bullets = (body) => String(body || '').split('\n').map((l) => l.trim()).filter((l) => /^[-*] /.test(l)).map((l) => `- ${l.slice(2).trim()}`)

// /download et /version : adresses reprises des README (app iPhone et Apple
// TV, Android). La source de l'iPhone liste aussi « TU Test », les builds de
// test ; celle des versions stables de l'Apple TV n'existe qu'à partir de sa
// prochaine sortie (lue avant d'être montrée).
const IOS_SOURCE = 'https://raw.githubusercontent.com/MXFia19/TwitchUnblock/master/apps.json'
const ADD_SOURCE = 'https://altdirect.app/?url=https://raw.githubusercontent.com/MXFia19/TwitchUnblock/master/apps.json'
const IPA = 'https://github.com/MXFia19/TwitchUnblock/releases/latest/download/TwitchUnblock.ipa'
const TV_TEST_SOURCE = 'https://raw.githubusercontent.com/MXFia19/TwitchUnblock/test-17d298/apps-tv.json'
const TV_STABLE_SOURCE = 'https://raw.githubusercontent.com/MXFia19/TwitchUnblock/master/apps-tv-stable.json'
const APK_RELEASES = 'https://github.com/MXFia19/TwitchUnblock-Android/releases'

// Emoji d'un rôle de /roles : un emoji standard (une seule séquence), ou un
// emoji du serveur écrit <:nom:id> (<a:nom:id> s'il est animé).
const CUSTOM_EMOJI = /^<(a?):(\w{2,32}):(\d{5,25})>$/
const UNICODE_EMOJI = /^(?:\p{Regional_Indicator}{2}|[#*0-9]️?⃣|\p{Extended_Pictographic}[️\p{Emoji_Modifier}\u{E0020}-\u{E007F}]*(?:‍\p{Extended_Pictographic}[️\p{Emoji_Modifier}]*)*)$/u
const emojiOf = (s) => {
  const m = String(s).match(CUSTOM_EMOJI)
  return m ? { id: m[3], name: m[2], animated: Boolean(m[1]) } : { name: String(s) }
}

// Réponses visibles de la personne seule de /roles, /roles-config,
// /download, /version et /help : dans la langue de son Discord (fr, es, ru),
// l'anglais sinon et pour ce qui manque. Les messages postés dans un salon
// restent en anglais ; les raisons « rp_* » servent aussi à /setup.
const I18N = {
  en: {
    roles_intro: '🏷️ **Your roles** — ticked: the ones you have. Tick or untick, then close the menu to save.',
    roles_pick: 'Pick your roles',
    roles_none: 'No roles to pick yet.',
    roles_none_admin: 'Add some with /roles-config add.',
    roles_same: 'No change.',
    roles_wait: '⏳ One change every few seconds — try again in a moment.',
    roles_skipped: (n) => `⚠️ ${n === 1 ? 'One role' : `${n} roles`} can’t be given out right now — the developer was told.`,
    roles_error: (r, m) => `❌ I couldn’t change ${r} (${m}) — please tell the developer.`,
    rp_desc: 'Get pinged when a new version is out',
    public_admin_only: 'ℹ️ Only the developer can post this in the channel — here it is, just for you.',
    posted: (c) => `✅ Posted in <#${c}>.`,
    post_failed: (m) => `Not posted (${m}): I need to see this channel and to send messages with embeds in it.`,
    rc_added: (r) => `✅ <@&${r}> is now offered in /roles.`,
    rc_updated: (r) => `✅ <@&${r}> updated.`,
    rc_full: '❌ 25 roles at most (a Discord menu limit), the release pings role included.',
    rc_bad_emoji: '❌ Unknown emoji: use a standard emoji or one of this server’s.',
    rc_removed: (r) => `🗑️ <@&${r}> is no longer offered.`,
    rc_not_listed: (r) => `<@&${r}> wasn’t offered.`,
    rc_release_stays: (r) => `<@&${r}> is the release pings role (set with /setup): it stays in /roles.`,
    rc_empty: 'No roles offered yet: add one with /roles-config add.',
    rc_head: '🏷️ **Roles offered in /roles**',
    rc_release: 'release pings, /setup',
    rc_message: (c) => `Roles message for everyone: <#${c}> (kept up to date).`,
    rp_everyone: '@everyone can’t be used.',
    rp_unreadable: 'I can’t read this role.',
    rp_check: 'I can’t read the server’s roles and channels to check it — try again.',
    rp_managed: (r) => `<@&${r}> is managed by an integration (bot, Boost…).`,
    rp_perms: (r) => `<@&${r}> has permissions — use a role without any.`,
    rp_access: (r, c) => `<@&${r}> is in the permissions of <#${c}> — use a role that no channel’s permissions mention.`,
    rp_above: (r) => `<@&${r}> is above my highest role — move mine above it (Server Settings → Roles).`,
    dl_ios_title: '📱 iPhone and iPad',
    dl_ios: (src) => 'Not on the App Store: it’s sideloaded. **Add source** opens the source in AltStore, SideStore or Feather (also LiveContainer, StikStore, TrollApps): install **TwitchUnblock**. The same source lists **TU Test**, the test builds (newest features, may be unstable), installed next to the normal app. **Download IPA**: the latest version, for Sideloadly or TrollStore.\n'
      + `Source address, to add it by hand:\n\`\`\`\n${src}\n\`\`\``,
    dl_tv_title: '📺 Apple TV',
    dl_tv: 'AltStore, SideStore and Feather don’t handle tvOS: install it with **ATVLoadly** (or Xcode on a Mac). Add a source in ATVLoadly and the app updates on its own.',
    dl_tv_test: 'Test builds:',
    dl_tv_stable: 'Stable releases:',
    dl_tv_no_stable: 'Stable releases get their source with the next Apple TV release.',
    dl_android_title: '🤖 Android',
    dl_android: 'One app for phones, tablets and Android TV: download the latest `TwitchUnblock-….apk` from **Releases**, open it, and allow installs from this source if Android asks. On a TV, install *Downloader* and enter the APK’s address.',
    dl_android_test_only: (v) => `Only test builds (**TU Test**) so far — latest: **${v}**.`,
    dl_android_none: 'No release yet.',
    dl_web_title: '🌐 Website',
    dl_web: 'Nothing to install: it runs in any browser. On iPhone, add it to your Home Screen: it opens like an app and gets live notifications (iOS 16.4+).',
    dl_latest: (v) => `Latest version: **${v}**`,
    b_add_source: 'Add source', b_ipa: 'Download IPA', b_tv_test: 'Test source', b_tv_stable: 'Stable source', b_apk: 'APK (Releases)', b_site: 'Open the website',
    v_head: '🏷️ **Latest versions**',
    v_ios: 'iPhone app:', v_tu_test: 'TU Test (test builds):', v_tv: 'Apple TV:', v_android: 'Android:', v_web: 'Website:',
    v_test: 'test', v_stable: 'stable',
    v_test_only: (v) => `test builds only (${v})`,
    v_unknown: 'unknown', v_none: 'none yet', v_checked: 'Checked',
    h_head: '📖 **What I can do**',
    h_bug: 'report a bug in the app or the website (screenshot optional)',
    h_idea: 'suggest an idea',
    h_roles: 'pick your roles',
    h_release_pings: 'get pinged when a new version is out (again to stop)',
    h_download: 'all the ways to install TwitchUnblock',
    h_version: 'latest versions of the apps and the website',
    h_help: 'this list',
    h_replies: 'Replies to your reports come in a direct message: answer with the buttons under them.',
    h_admin: '**Developer only**',
    h_setup: 'use this channel for alerts, release announcements, test builds, the to-do list, suggestions or welcome messages',
    h_announce: 'banner in the app and on the website, and remove it',
    h_poll: 'poll in the app and on the website, and end it (results posted)',
    h_todo: 'add to the to-do channel (or a message’s Apps menu → Add to to-do)',
    h_summary: 'post the daily summary now',
    h_status: 'server status in one message, with the D1 queries that read the most today',
    h_roles_config: 'roles offered in /roles: add, remove, list',
    h_public: 'post them in this channel for everyone',
    h_report: 'in a report’s post: delete it, close it, merge it into another',
    h_forget: 'erase a person’s data, after a preview',
    h_suggest: 'suggest a feature: members vote for it',
    h_suggestions: 'the most voted open suggestions',
    h_my_reports: 'what you sent (bugs, ideas, suggestions) and its status',
    h_live: 'is a channel live? Title, category, viewers',
    h_top: 'the biggest lives right now (by category, language)',
    h_app_announce: 'announcement in the apps and on the website, after a preview (and remove it)',
    admin_only: 'Only the developer can use this.',
    live_bad: 'That isn’t a Twitch channel name (letters, digits and _, 25 at most).',
    live_wait: '⏳ One lookup every 5 seconds — try again in a moment.',
    live_busy: '⏳ Too many lookups right now — try again in a minute.',
    live_error: '❌ Twitch didn’t answer — try again in a moment.',
    live_none: (n) => `No Twitch channel is called **${n}**.`,
    live_offline: (n) => `⚫ **${n}** is offline.`,
    live_last: (t) => `Last live: ${t}`,
    live_tag: '🔴 LIVE',
    f_category: 'Category', f_viewers: 'Viewers', f_uptime: 'Live for',
    dur: (h, m) => (h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`),
    b_watch: 'Watch on the website', b_app: 'Open in the app',
    top_title: 'Biggest lives right now',
    top_none: 'No lives found.',
    top_cat_none: (c) => `No category matches “${c}”.`,
    top_pick: 'Open a live…',
    mr_head: '🗂️ **What you sent from Discord**',
    mr_none: 'Nothing sent from Discord yet — /bug, /idea or /suggest.',
    mr_more: 'Older ones aren’t listed.',
    mr_post: 'post', mr_card: 'card', mr_merged: 'merged into another report',
    k_bug: 'Bug', k_idea: 'Idea', k_other: 'Other', k_suggestion: 'Suggestion',
    s_new: 'New', s_seen: 'Seen', s_accepted: 'Accepted', s_progress: 'In progress', s_done: 'Done', s_refused: 'Declined',
    sg_modal: 'Suggest a feature', sg_title: 'Title', sg_title_ph: 'In a few words', sg_desc: 'Description',
    sg_desc_ph: 'What should it do, and why would it help? (members will see it)',
    sg_wait: (t) => `⏳ One suggestion every 10 minutes — you can send the next one ${t}.`,
    sg_daily: '⏳ That’s enough suggestions for today — try again tomorrow.',
    sg_paused: '⏳ Suggestions are paused for now — try again later.',
    sg_failed: (m) => `❌ Not sent (${m}).`,
    sg_keep: 'Your text, to send it again later:',
    sg_sent: (c) => `💡 Thanks! Your suggestion is up in <#${c}>: members can vote for it.`,
    sg_sent_nocard: '💡 Thanks! Your suggestion was sent to the developer (it couldn’t be posted for votes right now).',
    sg_dm: ' The developer’s replies will come in a direct message.',
    sg_dm_off: ' I couldn’t send you a direct message: allow DMs from this server’s members (Privacy settings) to get the replies.',
    v_added: (n) => `👍 Vote counted — ${n} in all. Tap again to remove it.`,
    v_removed: (n) => `Vote removed — ${n} left.`,
    v_closed: 'Voting is closed: this suggestion is done, declined or merged.',
    v_gone: 'This suggestion no longer exists.',
    v_wait: '⏳ Too many votes — try again in a moment.',
    st_head: '🏆 **Most voted open suggestions**',
    st_none: 'No open suggestions yet — add one with /suggest.',
    ss_set: (s) => `✅ Status set: **${s}**.`,
    ss_same: (s) => `It’s already **${s}**.`,
    aa_preview: (until) => `👀 **Preview** — once published, it shows at the top of the apps and the website until about ${until}. Nothing is sent before you press **Publish**.`,
    aa_replaces: (x) => `It replaces the current announcement: “${x}”.`,
    aa_bad_duration: '❌ Duration: a number with m, h or d (30m, 6h, 3d) — from 1 minute to 30 days.',
    aa_bad_link: '❌ Link: https:// only.',
    aa_published: (until) => `✅ Announcement live in the apps and on the website until ${until}.`,
    aa_cancelled: 'Cancelled — nothing was published.',
    aa_expired: 'This preview has expired — run /app-announce post again.',
    aa_cleared: 'Announcement removed from the apps and the website.',
    b_publish: 'Publish', b_cancel: 'Cancel',
  },
  fr: {
    roles_intro: '🏷️ **Tes rôles** — cochés : ceux que tu as. Coche ou décoche, puis ferme le menu pour enregistrer.',
    roles_pick: 'Choisis tes rôles',
    roles_none: 'Aucun rôle à choisir pour l’instant.',
    roles_none_admin: 'Ajoutes-en avec /roles-config add.',
    roles_same: 'Aucun changement.',
    roles_wait: '⏳ Un changement toutes les quelques secondes — réessaie dans un instant.',
    roles_skipped: (n) => `⚠️ ${n === 1 ? 'Un rôle ne peut' : `${n} rôles ne peuvent`} pas être donné${n === 1 ? '' : 's'} pour l’instant — le développeur est prévenu.`,
    roles_error: (r, m) => `❌ Je n’ai pas pu changer ${r} (${m}) — préviens le développeur.`,
    rp_desc: 'Être notifié quand une nouvelle version sort',
    public_admin_only: 'ℹ️ Seul le développeur peut le poster dans le salon — le voici, pour toi seul.',
    posted: (c) => `✅ Posté dans <#${c}>.`,
    post_failed: (m) => `Pas posté (${m}) : je dois voir ce salon et pouvoir y envoyer des messages avec des encadrés.`,
    rc_added: (r) => `✅ <@&${r}> est maintenant proposé dans /roles.`,
    rc_updated: (r) => `✅ <@&${r}> mis à jour.`,
    rc_full: '❌ 25 rôles au plus (limite d’un menu de Discord), rôle des sorties compris.',
    rc_bad_emoji: '❌ Emoji inconnu : prends un emoji standard ou un emoji de ce serveur.',
    rc_removed: (r) => `🗑️ <@&${r}> n’est plus proposé.`,
    rc_not_listed: (r) => `<@&${r}> n’était pas proposé.`,
    rc_release_stays: (r) => `<@&${r}> est le rôle des sorties (choisi avec /setup) : il reste dans /roles.`,
    rc_empty: 'Aucun rôle proposé pour l’instant : ajoutes-en un avec /roles-config add.',
    rc_head: '🏷️ **Rôles proposés dans /roles**',
    rc_release: 'sorties, /setup',
    rc_message: (c) => `Message des rôles pour tous : <#${c}> (tenu à jour).`,
    rp_everyone: '@everyone ne peut pas servir.',
    rp_unreadable: 'Je n’arrive pas à lire ce rôle.',
    rp_check: 'Je n’arrive pas à lire les rôles et les salons du serveur pour le vérifier — réessaie.',
    rp_managed: (r) => `<@&${r}> est géré par une intégration (bot, Boost…).`,
    rp_perms: (r) => `<@&${r}> a des permissions — prends un rôle qui n’en a aucune.`,
    rp_access: (r, c) => `<@&${r}> figure dans les permissions de <#${c}> — prends un rôle cité dans les permissions d’aucun salon.`,
    rp_above: (r) => `<@&${r}> est au-dessus de mon rôle le plus haut — place le mien au-dessus (Paramètres du serveur → Rôles).`,
    dl_ios_title: '📱 iPhone et iPad',
    dl_ios: (src) => 'Pas sur l’App Store : elle s’installe autrement (sideload). **Ajouter la source** l’ouvre dans AltStore, SideStore ou Feather (aussi LiveContainer, StikStore, TrollApps) : installe **TwitchUnblock**. La même source propose **TU Test**, les builds de test (nouveautés en avance, parfois instables), installée à côté de l’app normale. **Télécharger l’IPA** : la dernière version, pour Sideloadly ou TrollStore.\n'
      + `Adresse de la source, à ajouter à la main :\n\`\`\`\n${src}\n\`\`\``,
    dl_tv: 'AltStore, SideStore et Feather ne gèrent pas tvOS : installe-la avec **ATVLoadly** (ou Xcode sur un Mac). Ajoute une source dans ATVLoadly et l’app se met à jour toute seule.',
    dl_tv_test: 'Builds de test :',
    dl_tv_stable: 'Versions stables :',
    dl_tv_no_stable: 'Les versions stables auront leur source à la prochaine sortie de l’app Apple TV.',
    dl_android: 'Une seule app pour téléphone, tablette et Android TV : télécharge le dernier `TwitchUnblock-….apk` dans **Releases**, ouvre-le, et autorise l’installation depuis cette source si Android le demande. Sur une TV : installe *Downloader* et entre l’adresse de l’APK.',
    dl_android_test_only: (v) => `Seulement des builds de test (**TU Test**) pour l’instant — dernier : **${v}**.`,
    dl_android_none: 'Pas encore de version publiée.',
    dl_web_title: '🌐 Site web',
    dl_web: 'Rien à installer : il marche dans n’importe quel navigateur. Sur iPhone, ajoute-le à l’écran d’accueil : il s’ouvre comme une app et reçoit les notifications de live (iOS 16.4+).',
    dl_latest: (v) => `Dernière version : **${v}**`,
    b_add_source: 'Ajouter la source', b_ipa: 'Télécharger l’IPA', b_tv_test: 'Source de test', b_tv_stable: 'Source stable', b_site: 'Ouvrir le site',
    v_head: '🏷️ **Dernières versions**',
    v_ios: 'App iPhone :', v_tu_test: 'TU Test (builds de test) :', v_tv: 'Apple TV :', v_android: 'Android :', v_web: 'Site :',
    v_test: 'test', v_stable: 'stable',
    v_test_only: (v) => `builds de test seulement (${v})`,
    v_unknown: 'inconnue', v_none: 'aucune pour l’instant', v_checked: 'Vérifié',
    h_head: '📖 **Ce que je sais faire**',
    h_bug: 'signaler un bug dans l’app ou sur le site (capture facultative)',
    h_idea: 'proposer une idée',
    h_roles: 'choisir tes rôles',
    h_release_pings: 'être notifié quand une nouvelle version sort (encore une fois pour arrêter)',
    h_download: 'toutes les façons d’installer TwitchUnblock',
    h_version: 'dernières versions des apps et du site',
    h_help: 'cette liste',
    h_replies: 'Les réponses à tes retours arrivent en message privé : réponds avec les boutons dessous.',
    h_admin: '**Réservé au développeur**',
    h_setup: 'ce salon pour les alertes, les annonces de version, les builds de test, la liste à faire, les suggestions ou la bienvenue',
    h_announce: 'bandeau dans l’app et sur le site, et le retirer',
    h_poll: 'sondage dans l’app et sur le site, et le clore (résultats postés)',
    h_todo: 'ajouter à la liste à faire (ou menu Apps d’un message → Add to to-do)',
    h_summary: 'poster le résumé du jour maintenant',
    h_status: 'état du serveur en un message, avec les requêtes D1 qui lisent le plus aujourd’hui',
    h_roles_config: 'rôles proposés dans /roles : ajouter, retirer, lister',
    h_public: 'les poster dans ce salon pour tout le monde',
    h_report: 'dans le post d’un retour : le supprimer, le clore, le fusionner avec un autre',
    h_forget: 'effacer les données d’une personne, après un aperçu',
    h_suggest: 'proposer une fonctionnalité : les membres votent pour elle',
    h_suggestions: 'les suggestions ouvertes les plus votées',
    h_my_reports: 'ce que tu as envoyé (bugs, idées, suggestions) et son état',
    h_live: 'une chaîne est-elle en live ? Titre, catégorie, spectateurs',
    h_top: 'les plus gros lives du moment (par catégorie, langue)',
    h_app_announce: 'annonce dans les apps et sur le site, après un aperçu (et la retirer)',
    admin_only: 'Seul le développeur peut s’en servir.',
    live_bad: 'Ce n’est pas un nom de chaîne Twitch (lettres, chiffres et _, 25 au plus).',
    live_wait: '⏳ Une recherche toutes les 5 secondes — réessaie dans un instant.',
    live_busy: '⏳ Trop de recherches en ce moment — réessaie dans une minute.',
    live_error: '❌ Twitch n’a pas répondu — réessaie dans un instant.',
    live_none: (n) => `Aucune chaîne Twitch ne s’appelle **${n}**.`,
    live_offline: (n) => `⚫ **${n}** est hors ligne.`,
    live_last: (t) => `Dernier live : ${t}`,
    live_tag: '🔴 EN DIRECT',
    f_category: 'Catégorie', f_viewers: 'Spectateurs', f_uptime: 'En live depuis',
    b_watch: 'Regarder sur le site', b_app: 'Ouvrir dans l’app',
    top_title: 'Les plus gros lives du moment',
    top_none: 'Aucun live trouvé.',
    top_cat_none: (c) => `Aucune catégorie ne correspond à « ${c} ».`,
    top_pick: 'Ouvrir un live…',
    mr_head: '🗂️ **Ce que tu as envoyé depuis Discord**',
    mr_none: 'Rien d’envoyé depuis Discord pour l’instant — /bug, /idea ou /suggest.',
    mr_more: 'Les plus anciens ne sont pas listés.',
    mr_post: 'post', mr_card: 'carte', mr_merged: 'fusionné avec un autre retour',
    k_bug: 'Bug', k_idea: 'Idée', k_other: 'Autre', k_suggestion: 'Suggestion',
    s_new: 'Nouveau', s_seen: 'Vu', s_accepted: 'Accepté', s_progress: 'En cours', s_done: 'Fait', s_refused: 'Refusé',
    sg_modal: 'Proposer une fonctionnalité', sg_title: 'Titre', sg_title_ph: 'En quelques mots', sg_desc: 'Description',
    sg_desc_ph: 'Que devrait-elle faire, et en quoi aiderait-elle ? (les membres la verront)',
    sg_wait: (t) => `⏳ Une suggestion toutes les 10 minutes — tu pourras envoyer la suivante ${t}.`,
    sg_daily: '⏳ Assez de suggestions pour aujourd’hui — réessaie demain.',
    sg_paused: '⏳ Les suggestions sont en pause pour l’instant — réessaie plus tard.',
    sg_failed: (m) => `❌ Pas envoyée (${m}).`,
    sg_keep: 'Ton texte, pour le renvoyer plus tard :',
    sg_sent: (c) => `💡 Merci ! Ta suggestion est dans <#${c}> : les membres peuvent voter pour elle.`,
    sg_sent_nocard: '💡 Merci ! Ta suggestion a été envoyée au développeur (elle n’a pas pu être postée pour les votes pour l’instant).',
    sg_dm: ' Les réponses du développeur arriveront en message privé.',
    sg_dm_off: ' Je n’ai pas pu t’envoyer de message privé : autorise ceux des membres de ce serveur (paramètres de confidentialité) pour recevoir les réponses.',
    v_added: (n) => `👍 Vote compté — ${n} en tout. Appuie encore pour le retirer.`,
    v_removed: (n) => `Vote retiré — il en reste ${n}.`,
    v_closed: 'Les votes sont clos : cette suggestion est faite, refusée ou fusionnée.',
    v_gone: 'Cette suggestion n’existe plus.',
    v_wait: '⏳ Trop de votes — réessaie dans un instant.',
    st_head: '🏆 **Suggestions ouvertes les plus votées**',
    st_none: 'Aucune suggestion ouverte pour l’instant — ajoutes-en une avec /suggest.',
    ss_set: (s) => `✅ État posé : **${s}**.`,
    ss_same: (s) => `C’est déjà **${s}**.`,
    aa_preview: (until) => `👀 **Aperçu** — une fois publiée, elle s’affiche en haut des apps et du site jusqu’à ${until} environ. Rien ne part avant **Publier**.`,
    aa_replaces: (x) => `Elle remplace l’annonce en cours : « ${x} ».`,
    aa_bad_duration: '❌ Durée : un nombre avec m, h ou d (30m, 6h, 3d) — de 1 minute à 30 jours.',
    aa_bad_link: '❌ Lien : https:// uniquement.',
    aa_published: (until) => `✅ Annonce en ligne dans les apps et sur le site jusqu’à ${until}.`,
    aa_cancelled: 'Annulé — rien n’a été publié.',
    aa_expired: 'Cet aperçu a expiré — relance /app-announce post.',
    aa_cleared: 'Annonce retirée des apps et du site.',
    b_publish: 'Publier', b_cancel: 'Annuler',
  },
  es: {
    roles_intro: '🏷️ **Tus roles** — marcados: los que tienes. Marca o desmarca y cierra el menú para guardar.',
    roles_pick: 'Elige tus roles',
    roles_none: 'Todavía no hay roles para elegir.',
    roles_none_admin: 'Añade alguno con /roles-config add.',
    roles_same: 'Sin cambios.',
    roles_wait: '⏳ Un cambio cada pocos segundos: vuelve a intentarlo en un momento.',
    roles_skipped: (n) => `⚠️ ${n === 1 ? 'Un rol no se puede' : `${n} roles no se pueden`} dar por ahora; ya se avisó al desarrollador.`,
    roles_error: (r, m) => `❌ No pude cambiar ${r} (${m}); avisa al desarrollador.`,
    rp_desc: 'Recibir un aviso cuando salga una nueva versión',
    public_admin_only: 'ℹ️ Solo el desarrollador puede publicarlo en el canal; aquí lo tienes, solo para ti.',
    posted: (c) => `✅ Publicado en <#${c}>.`,
    post_failed: (m) => `No publicado (${m}): necesito ver este canal y poder enviar en él mensajes con insertos.`,
    rc_added: (r) => `✅ <@&${r}> ya se ofrece en /roles.`,
    rc_updated: (r) => `✅ <@&${r}> actualizado.`,
    rc_full: '❌ 25 roles como máximo (límite de un menú de Discord), incluido el rol de las versiones.',
    rc_bad_emoji: '❌ Emoji desconocido: usa un emoji estándar o uno de este servidor.',
    rc_removed: (r) => `🗑️ <@&${r}> ya no se ofrece.`,
    rc_not_listed: (r) => `<@&${r}> no se ofrecía.`,
    rc_release_stays: (r) => `<@&${r}> es el rol de las versiones (elegido con /setup): sigue en /roles.`,
    rc_empty: 'Todavía no se ofrece ningún rol: añade uno con /roles-config add.',
    rc_head: '🏷️ **Roles ofrecidos en /roles**',
    rc_release: 'versiones, /setup',
    rc_message: (c) => `Mensaje de roles para todos: <#${c}> (se mantiene al día).`,
    rp_everyone: '@everyone no se puede usar.',
    rp_unreadable: 'No puedo leer este rol.',
    rp_check: 'No puedo leer los roles y canales del servidor para comprobarlo; inténtalo de nuevo.',
    rp_managed: (r) => `<@&${r}> lo gestiona una integración (bot, Boost…).`,
    rp_perms: (r) => `<@&${r}> tiene permisos; usa un rol sin ninguno.`,
    rp_access: (r, c) => `<@&${r}> aparece en los permisos de <#${c}>; usa un rol que no aparezca en los permisos de ningún canal.`,
    rp_above: (r) => `<@&${r}> está por encima de mi rol más alto; sube el mío por encima (Ajustes del servidor → Roles).`,
    dl_ios_title: '📱 iPhone y iPad',
    dl_ios: (src) => 'No está en la App Store: se instala por otra vía (sideload). **Añadir fuente** la abre en AltStore, SideStore o Feather (también LiveContainer, StikStore, TrollApps): instala **TwitchUnblock**. La misma fuente incluye **TU Test**, las versiones de prueba (novedades antes, pueden ser inestables), que se instala junto a la app normal. **Descargar IPA**: la última versión, para Sideloadly o TrollStore.\n'
      + `Dirección de la fuente, para añadirla a mano:\n\`\`\`\n${src}\n\`\`\``,
    dl_tv: 'AltStore, SideStore y Feather no admiten tvOS: instálala con **ATVLoadly** (o Xcode en un Mac). Añade una fuente en ATVLoadly y la app se actualiza sola.',
    dl_tv_test: 'Versiones de prueba:',
    dl_tv_stable: 'Versiones estables:',
    dl_tv_no_stable: 'Las versiones estables tendrán su fuente con la próxima versión de la app de Apple TV.',
    dl_android: 'Una sola app para móvil, tableta y Android TV: descarga el último `TwitchUnblock-….apk` en **Releases**, ábrelo y permite instalar desde esta fuente si Android lo pide. En una TV: instala *Downloader* e introduce la dirección del APK.',
    dl_android_test_only: (v) => `Por ahora solo hay versiones de prueba (**TU Test**); la última: **${v}**.`,
    dl_android_none: 'Todavía no hay ninguna versión.',
    dl_web_title: '🌐 Sitio web',
    dl_web: 'Nada que instalar: funciona en cualquier navegador. En iPhone, añádelo a la pantalla de inicio: se abre como una app y recibe avisos de directos (iOS 16.4+).',
    dl_latest: (v) => `Última versión: **${v}**`,
    b_add_source: 'Añadir fuente', b_ipa: 'Descargar IPA', b_tv_test: 'Fuente de prueba', b_tv_stable: 'Fuente estable', b_site: 'Abrir el sitio',
    v_head: '🏷️ **Últimas versiones**',
    v_ios: 'App de iPhone:', v_tu_test: 'TU Test (versiones de prueba):', v_web: 'Sitio web:',
    v_test: 'prueba', v_stable: 'estable',
    v_test_only: (v) => `solo versiones de prueba (${v})`,
    v_unknown: 'desconocida', v_none: 'ninguna todavía', v_checked: 'Comprobado',
    h_head: '📖 **Lo que puedo hacer**',
    h_bug: 'informar de un error en la app o el sitio web (captura opcional)',
    h_idea: 'proponer una idea',
    h_roles: 'elegir tus roles',
    h_release_pings: 'recibir un aviso cuando salga una nueva versión (otra vez para dejarlo)',
    h_download: 'todas las formas de instalar TwitchUnblock',
    h_version: 'últimas versiones de las apps y del sitio web',
    h_help: 'esta lista',
    h_replies: 'Las respuestas a tus informes llegan por mensaje directo: contesta con los botones de debajo.',
    h_admin: '**Solo para el desarrollador**',
    h_setup: 'usar este canal para alertas, anuncios de versiones, versiones de prueba, la lista de tareas, sugerencias o bienvenidas',
    h_announce: 'aviso en la app y el sitio web, y quitarlo',
    h_poll: 'encuesta en la app y el sitio web, y cerrarla (resultados publicados)',
    h_todo: 'añadir a la lista de tareas (o menú Apps de un mensaje → Add to to-do)',
    h_summary: 'publicar ahora el resumen del día',
    h_status: 'estado del servidor en un mensaje, con las consultas D1 que más filas leen hoy',
    h_roles_config: 'roles ofrecidos en /roles: añadir, quitar, listar',
    h_public: 'publicarlos en este canal para todos',
    h_report: 'en el hilo de un informe: borrarlo, cerrarlo, fusionarlo con otro',
    h_forget: 'borrar los datos de una persona, tras una vista previa',
    h_suggest: 'sugerir una función: los miembros la votan',
    h_suggestions: 'las sugerencias abiertas más votadas',
    h_my_reports: 'lo que enviaste (errores, ideas, sugerencias) y su estado',
    h_live: '¿está en directo un canal? Título, categoría, espectadores',
    h_top: 'los directos más grandes ahora (por categoría, idioma)',
    h_app_announce: 'anuncio en las apps y el sitio web, tras una vista previa (y quitarlo)',
    admin_only: 'Solo el desarrollador puede usar esto.',
    live_bad: 'Eso no es un nombre de canal de Twitch (letras, números y _, 25 como máximo).',
    live_wait: '⏳ Una búsqueda cada 5 segundos: vuelve a intentarlo en un momento.',
    live_busy: '⏳ Demasiadas búsquedas ahora mismo: vuelve a intentarlo en un minuto.',
    live_error: '❌ Twitch no respondió: vuelve a intentarlo en un momento.',
    live_none: (n) => `Ningún canal de Twitch se llama **${n}**.`,
    live_offline: (n) => `⚫ **${n}** no está en directo.`,
    live_last: (t) => `Último directo: ${t}`,
    live_tag: '🔴 EN DIRECTO',
    f_category: 'Categoría', f_viewers: 'Espectadores', f_uptime: 'En directo desde hace',
    b_watch: 'Ver en el sitio web', b_app: 'Abrir en la app',
    top_title: 'Los directos más grandes ahora',
    top_none: 'No se encontró ningún directo.',
    top_cat_none: (c) => `Ninguna categoría coincide con «${c}».`,
    top_pick: 'Abrir un directo…',
    mr_head: '🗂️ **Lo que enviaste desde Discord**',
    mr_none: 'Todavía no enviaste nada desde Discord: /bug, /idea o /suggest.',
    mr_more: 'Los más antiguos no aparecen.',
    mr_post: 'hilo', mr_card: 'tarjeta', mr_merged: 'fusionado con otro informe',
    k_bug: 'Error', k_idea: 'Idea', k_other: 'Otro', k_suggestion: 'Sugerencia',
    s_new: 'Nuevo', s_seen: 'Visto', s_accepted: 'Aceptado', s_progress: 'En curso', s_done: 'Hecho', s_refused: 'Rechazado',
    sg_modal: 'Sugerir una función', sg_title: 'Título', sg_title_ph: 'En pocas palabras', sg_desc: 'Descripción',
    sg_desc_ph: '¿Qué debería hacer y en qué ayudaría? (los miembros la verán)',
    sg_wait: (t) => `⏳ Una sugerencia cada 10 minutos: podrás enviar la siguiente ${t}.`,
    sg_daily: '⏳ Ya son suficientes sugerencias por hoy: vuelve a intentarlo mañana.',
    sg_paused: '⏳ Las sugerencias están en pausa por ahora: vuelve a intentarlo más tarde.',
    sg_failed: (m) => `❌ No enviada (${m}).`,
    sg_keep: 'Tu texto, para enviarlo de nuevo más tarde:',
    sg_sent: (c) => `💡 ¡Gracias! Tu sugerencia está en <#${c}>: los miembros pueden votarla.`,
    sg_sent_nocard: '💡 ¡Gracias! Tu sugerencia se envió al desarrollador (por ahora no se pudo publicar para votarla).',
    sg_dm: ' Las respuestas del desarrollador llegarán por mensaje directo.',
    sg_dm_off: ' No pude enviarte un mensaje directo: permite los de los miembros de este servidor (ajustes de privacidad) para recibir las respuestas.',
    v_added: (n) => `👍 Voto contado: ${n} en total. Pulsa otra vez para quitarlo.`,
    v_removed: (n) => `Voto quitado: quedan ${n}.`,
    v_closed: 'La votación está cerrada: esta sugerencia está hecha, rechazada o fusionada.',
    v_gone: 'Esta sugerencia ya no existe.',
    v_wait: '⏳ Demasiados votos: vuelve a intentarlo en un momento.',
    st_head: '🏆 **Sugerencias abiertas más votadas**',
    st_none: 'Todavía no hay sugerencias abiertas: añade una con /suggest.',
    ss_set: (s) => `✅ Estado: **${s}**.`,
    ss_same: (s) => `Ya está en **${s}**.`,
    aa_preview: (until) => `👀 **Vista previa**: una vez publicado, aparece arriba en las apps y el sitio web hasta aproximadamente ${until}. No se envía nada hasta que pulses **Publicar**.`,
    aa_replaces: (x) => `Sustituye al anuncio actual: «${x}».`,
    aa_bad_duration: '❌ Duración: un número con m, h o d (30m, 6h, 3d), de 1 minuto a 30 días.',
    aa_bad_link: '❌ Enlace: solo https://.',
    aa_published: (until) => `✅ Anuncio visible en las apps y el sitio web hasta ${until}.`,
    aa_cancelled: 'Cancelado: no se publicó nada.',
    aa_expired: 'Esta vista previa caducó: vuelve a usar /app-announce post.',
    aa_cleared: 'Anuncio retirado de las apps y del sitio web.',
    b_publish: 'Publicar', b_cancel: 'Cancelar',
  },
  ru: {
    roles_intro: '🏷️ **Твои роли** — отмечены те, что у тебя есть. Отметь или сними отметки и закрой меню, чтобы сохранить.',
    roles_pick: 'Выбери роли',
    roles_none: 'Пока нет ролей на выбор.',
    roles_none_admin: 'Добавь их через /roles-config add.',
    roles_same: 'Ничего не изменилось.',
    roles_wait: '⏳ Не больше одного изменения в несколько секунд — попробуй чуть позже.',
    roles_skipped: (n) => `⚠️ Сейчас нельзя выдать ролей: ${n} — разработчик предупреждён.`,
    roles_error: (r, m) => `❌ Не удалось изменить ${r} (${m}) — сообщи разработчику.`,
    rp_desc: 'Уведомление о выходе новой версии',
    public_admin_only: 'ℹ️ Публиковать это в канале может только разработчик — вот ответ только для тебя.',
    posted: (c) => `✅ Опубликовано в <#${c}>.`,
    post_failed: (m) => `Не опубликовано (${m}): мне нужно видеть этот канал и отправлять в него сообщения со вставками.`,
    rc_added: (r) => `✅ <@&${r}> теперь предлагается в /roles.`,
    rc_updated: (r) => `✅ <@&${r}> обновлена.`,
    rc_full: '❌ Не больше 25 ролей (ограничение меню Discord), включая роль уведомлений о версиях.',
    rc_bad_emoji: '❌ Неизвестный эмодзи: используй стандартный эмодзи или эмодзи этого сервера.',
    rc_removed: (r) => `🗑️ <@&${r}> больше не предлагается.`,
    rc_not_listed: (r) => `<@&${r}> и так не предлагалась.`,
    rc_release_stays: (r) => `<@&${r}> — роль уведомлений о версиях (задана через /setup): она остаётся в /roles.`,
    rc_empty: 'Пока не предлагается ни одной роли: добавь через /roles-config add.',
    rc_head: '🏷️ **Роли в /roles**',
    rc_release: 'версии, /setup',
    rc_message: (c) => `Сообщение с ролями для всех: <#${c}> (обновляется).`,
    rp_everyone: '@everyone использовать нельзя.',
    rp_unreadable: 'Не могу прочитать эту роль.',
    rp_check: 'Не могу прочитать роли и каналы сервера, чтобы её проверить — попробуй ещё раз.',
    rp_managed: (r) => `<@&${r}> управляется интеграцией (бот, буст…).`,
    rp_perms: (r) => `У <@&${r}> есть права — выбери роль без прав.`,
    rp_access: (r, c) => `<@&${r}> указана в правах канала <#${c}> — выбери роль, которой нет в правах ни одного канала.`,
    rp_above: (r) => `<@&${r}> выше моей самой высокой роли — подними мою роль выше (Настройки сервера → Роли).`,
    dl_ios_title: '📱 iPhone и iPad',
    dl_ios: (src) => 'Приложения нет в App Store — его ставят в обход (sideload). **Добавить источник** открывает его в AltStore, SideStore или Feather (а также LiveContainer, StikStore, TrollApps): установи **TwitchUnblock**. В том же источнике есть **TU Test** — тестовые сборки (новинки раньше всех, бывают нестабильны), ставятся рядом с обычным приложением. **Скачать IPA** — последняя версия, для Sideloadly или TrollStore.\n'
      + `Адрес источника, чтобы добавить вручную:\n\`\`\`\n${src}\n\`\`\``,
    dl_tv: 'AltStore, SideStore и Feather не поддерживают tvOS: установи через **ATVLoadly** (или Xcode на Mac). Добавь источник в ATVLoadly — и приложение будет обновляться само.',
    dl_tv_test: 'Тестовые сборки:',
    dl_tv_stable: 'Стабильные версии:',
    dl_tv_no_stable: 'Источник стабильных версий появится со следующим выпуском приложения для Apple TV.',
    dl_android: 'Одно приложение для телефона, планшета и Android TV: скачай последний `TwitchUnblock-….apk` в **Releases**, открой его и разреши установку из этого источника, если Android спросит. На телевизоре установи *Downloader* и введи адрес APK.',
    dl_android_test_only: (v) => `Пока есть только тестовые сборки (**TU Test**), последняя: **${v}**.`,
    dl_android_none: 'Версий пока нет.',
    dl_web_title: '🌐 Сайт',
    dl_web: 'Ничего не нужно устанавливать: работает в любом браузере. На iPhone добавь его на экран «Домой» — он откроется как приложение и будет присылать уведомления о трансляциях (iOS 16.4+).',
    dl_latest: (v) => `Последняя версия: **${v}**`,
    b_add_source: 'Добавить источник', b_ipa: 'Скачать IPA', b_tv_test: 'Тестовый источник', b_tv_stable: 'Стабильный источник', b_site: 'Открыть сайт',
    v_head: '🏷️ **Последние версии**',
    v_ios: 'Приложение для iPhone:', v_tu_test: 'TU Test (тестовые сборки):', v_web: 'Сайт:',
    v_test: 'тест', v_stable: 'стабильная',
    v_test_only: (v) => `только тестовые сборки (${v})`,
    v_unknown: 'неизвестна', v_none: 'пока нет', v_checked: 'Проверено',
    h_head: '📖 **Что я умею**',
    h_bug: 'сообщить об ошибке в приложении или на сайте (скриншот по желанию)',
    h_idea: 'предложить идею',
    h_roles: 'выбрать роли',
    h_release_pings: 'получать уведомление о новой версии (ещё раз — отключить)',
    h_download: 'все способы установить TwitchUnblock',
    h_version: 'последние версии приложений и сайта',
    h_help: 'этот список',
    h_replies: 'Ответы на твои сообщения приходят в личку: отвечай кнопками под ними.',
    h_admin: '**Только для разработчика**',
    h_setup: 'этот канал для оповещений, анонсов версий, тестовых сборок, списка задач, предложений или приветствий',
    h_announce: 'баннер в приложении и на сайте, и убрать его',
    h_poll: 'опрос в приложении и на сайте, и завершить его (итоги публикуются)',
    h_todo: 'добавить в список задач (или меню «Приложения» у сообщения → Add to to-do)',
    h_summary: 'опубликовать сводку дня сейчас',
    h_status: 'состояние сервера одним сообщением, с запросами D1, которые сегодня читают больше всего строк',
    h_roles_config: 'роли в /roles: добавить, убрать, список',
    h_public: 'опубликовать их в этом канале для всех',
    h_report: 'в посте отчёта: удалить, закрыть, объединить с другим',
    h_forget: 'стереть данные человека после предпросмотра',
    h_suggest: 'предложить функцию: участники за неё голосуют',
    h_suggestions: 'открытые предложения с наибольшим числом голосов',
    h_my_reports: 'что ты отправил (ошибки, идеи, предложения) и их статус',
    h_live: 'идёт ли трансляция на канале? Название, категория, зрители',
    h_top: 'самые популярные трансляции сейчас (по категории, языку)',
    h_app_announce: 'объявление в приложениях и на сайте после предпросмотра (и убрать его)',
    admin_only: 'Это может использовать только разработчик.',
    live_bad: 'Это не имя канала Twitch (буквы, цифры и _, не больше 25).',
    live_wait: '⏳ Один поиск раз в 5 секунд — попробуй чуть позже.',
    live_busy: '⏳ Сейчас слишком много запросов — попробуй через минуту.',
    live_error: '❌ Twitch не ответил — попробуй чуть позже.',
    live_none: (n) => `Канала Twitch с именем **${n}** нет.`,
    live_offline: (n) => `⚫ **${n}** сейчас не в эфире.`,
    live_last: (t) => `Последний эфир: ${t}`,
    live_tag: '🔴 В ЭФИРЕ',
    f_category: 'Категория', f_viewers: 'Зрители', f_uptime: 'В эфире',
    dur: (h, m) => (h ? `${h} ч ${String(m).padStart(2, '0')} мин` : `${m} мин`),
    b_watch: 'Смотреть на сайте', b_app: 'Открыть в приложении',
    top_title: 'Самые популярные трансляции сейчас',
    top_none: 'Трансляций не найдено.',
    top_cat_none: (c) => `Нет категории «${c}».`,
    top_pick: 'Открыть трансляцию…',
    mr_head: '🗂️ **Что ты отправил из Discord**',
    mr_none: 'Ты пока ничего не отправлял из Discord — /bug, /idea или /suggest.',
    mr_more: 'Более старые не показаны.',
    mr_post: 'пост', mr_card: 'карточка', mr_merged: 'объединено с другим отчётом',
    k_bug: 'Ошибка', k_idea: 'Идея', k_other: 'Другое', k_suggestion: 'Предложение',
    s_new: 'Новое', s_seen: 'Просмотрено', s_accepted: 'Принято', s_progress: 'В работе', s_done: 'Готово', s_refused: 'Отклонено',
    sg_modal: 'Предложить функцию', sg_title: 'Заголовок', sg_title_ph: 'В двух словах', sg_desc: 'Описание',
    sg_desc_ph: 'Что она должна делать и чем поможет? (участники это увидят)',
    sg_wait: (t) => `⏳ Одно предложение раз в 10 минут — следующее можно будет отправить ${t}.`,
    sg_daily: '⏳ На сегодня предложений достаточно — попробуй завтра.',
    sg_paused: '⏳ Предложения пока на паузе — попробуй позже.',
    sg_failed: (m) => `❌ Не отправлено (${m}).`,
    sg_keep: 'Твой текст, чтобы отправить его позже:',
    sg_sent: (c) => `💡 Спасибо! Твоё предложение в <#${c}>: участники могут за него голосовать.`,
    sg_sent_nocard: '💡 Спасибо! Предложение отправлено разработчику (опубликовать его для голосования пока не получилось).',
    sg_dm: ' Ответы разработчика придут в личные сообщения.',
    sg_dm_off: ' Не удалось написать тебе в личку: разреши личные сообщения от участников этого сервера (настройки конфиденциальности), чтобы получать ответы.',
    v_added: (n) => `👍 Голос учтён — всего ${n}. Нажми ещё раз, чтобы отменить.`,
    v_removed: (n) => `Голос отменён — осталось ${n}.`,
    v_closed: 'Голосование закрыто: предложение выполнено, отклонено или объединено.',
    v_gone: 'Этого предложения больше нет.',
    v_wait: '⏳ Слишком много голосов — попробуй чуть позже.',
    st_head: '🏆 **Открытые предложения с наибольшим числом голосов**',
    st_none: 'Открытых предложений пока нет — добавь своё через /suggest.',
    ss_set: (s) => `✅ Статус: **${s}**.`,
    ss_same: (s) => `Уже **${s}**.`,
    aa_preview: (until) => `👀 **Предпросмотр** — после публикации объявление будет вверху приложений и сайта примерно до ${until}. Ничего не отправится, пока ты не нажмёшь **Опубликовать**.`,
    aa_replaces: (x) => `Оно заменит текущее объявление: «${x}».`,
    aa_bad_duration: '❌ Длительность: число с m, h или d (30m, 6h, 3d) — от 1 минуты до 30 дней.',
    aa_bad_link: '❌ Ссылка: только https://.',
    aa_published: (until) => `✅ Объявление показывается в приложениях и на сайте до ${until}.`,
    aa_cancelled: 'Отменено — ничего не опубликовано.',
    aa_expired: 'Предпросмотр устарел — снова запусти /app-announce post.',
    aa_cleared: 'Объявление убрано из приложений и с сайта.',
    b_publish: 'Опубликовать', b_cancel: 'Отмена',
  },
}
/** Textes de I18N pour `locale` (« fr », « es-ES », « es-419 », « ru »…). */
function lang(locale) {
  const own = I18N[String(locale || '').slice(0, 2).toLowerCase()] || I18N.en
  const t = (key, ...args) => {
    const v = own[key] ?? I18N.en[key]
    return typeof v === 'function' ? v(...args) : v ?? key
  }
  // Nombres et noms de langue à la façon de la personne (« 12 345 », « français »).
  let numbers = null
  let languages = null
  try {
    numbers = new Intl.NumberFormat(String(locale || 'en'))
    languages = new Intl.DisplayNames([String(locale || 'en')], { type: 'language' })
  } catch {}
  t.num = (n) => (numbers || new Intl.NumberFormat('en')).format(Number(n) || 0)
  t.language = (code) => { try { return (languages || languageNames).of(code) || code } catch { return code } }
  return t
}
const EN = lang('en')
// /help : commandes du développeur, montrées à lui seul.
const ADMIN_HELP = [
  ['/setup', 'h_setup'], ['/announce · /announce-clear', 'h_announce'], ['/app-announce', 'h_app_announce'], ['/poll · /poll-end', 'h_poll'],
  ['/todo', 'h_todo'], ['/summary', 'h_summary'], ['/status', 'h_status'], ['/roles-config', 'h_roles_config'],
  ['/roles public:True · /download public:True', 'h_public'], ['/delete · /block · /merge', 'h_report'], ['/forget-user', 'h_forget'],
]

/** Entrées anglaises d'une version dans changelog.js du site (chaînes entre
 *  apostrophes droites, lues sans exécuter le fichier). */
function changelogItems(src, version) {
  const at = src.indexOf(`version: '${version}'`)
  if (at < 0) return []
  const end = src.indexOf('version: ', at + 10)
  const block = src.slice(at, end > 0 ? end : undefined)
  const en = block.match(/\ben:\s*\[([\s\S]*?)\]/)
  if (!en) return []
  return [...en[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\(.)/g, '$1'))
}

/** Compare deux versions (« 1.4.12 », « 2026.10.18a ») : nombres comparés en
 *  nombres, lettres en texte. < 0, 0 ou > 0. */
export function compareVersions(a, b) {
  const parts = (v) => String(v).match(/\d+|[^\d.]+/g) || []
  const x = parts(a), y = parts(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return -1
    if (y[i] === undefined) return 1
    const c = /^\d+$/.test(x[i]) && /^\d+$/.test(y[i]) ? Number(x[i]) - Number(y[i]) : x[i].localeCompare(y[i])
    if (c) return c
  }
  return 0
}

/** Texte en morceaux de `max` caractères au plus, coupés aux lignes (une
 *  ligne trop longue est coupée elle aussi, plutôt que tronquée). */
function chunks(text, max = 1900) {
  const parts = []
  let cur = ''
  for (let line of String(text).split('\n')) {
    while (line.length > max) {
      if (cur) { parts.push(cur); cur = '' }
      parts.push(line.slice(0, max))
      line = line.slice(max)
    }
    if (cur && cur.length + line.length + 1 > max) { parts.push(cur); cur = '' }
    cur = cur ? `${cur}\n${line}` : line
  }
  if (cur) parts.push(cur)
  return parts
}

// ── Copie de la liste à faire, pour l'outil du développeur ─────────────────
// Le bot range dans sa mémoire du Worker (`todo_mirror`) une copie des
// cartes du salon à faire ; tools/reports.mjs --todo la lit avec la clé
// REPORTS_KEY (GET /api/admin/reports?view=todo), sans passer par Discord.
const TODO_MIRROR_KEY = 'todo_mirror'
const TODO_OPEN_MAX = 300    // éléments ouverts gardés, les plus récents
const TODO_DONE_MAX = 50     // éléments faits gardés, les plus récents
const TODO_TEXT_MAX = 1500   // texte d'un élément, en caractères…
const TODO_TEXT_MIN = 80     // … raccourci jusque-là si la liste est longue
const TODO_PAGES = 5         // pages de 100 messages relues dans le salon
// Une valeur de la mémoire du bot fait 20 000 caractères de JSON au plus
// (action `set` du Worker) : un peu de marge.
const TODO_MIRROR_MAX = 19_500
const TODO_TYPES = new Map([['To-do', 'todo'], ['Suggestion', 'suggestion']])
// Fin d'une carte « Add to to-do » (addTodo) : le lien du message d'origine
// et, s'il en avait, son nombre de pièces jointes.
const TODO_ORIGIN = /\n*\[Original message\]\((https:\/\/[^\s()]+)\)(?: · 📎 (\d+) attachments?)?\s*$/

/** `s` coupé à `max` caractères (« … » compris), sans séparer les deux
 *  moitiés d'un emoji. */
function clipText(s, max) {
  if (s.length <= max) return s
  let end = max - 1
  if (/[\uD800-\uDBFF]/.test(s[end - 1])) end--
  return `${s.slice(0, end)}…`
}

/** Élément de la liste à faire lu dans un message du salon, ou null : seules
 *  comptent les cartes postées par le bot (`me`), titrées « To-do » ou
 *  « Suggestion » (« ✅ » devant une fois faites, todoCard). */
export function todoFromMessage(m, { me, guild, channel }) {
  const e = m?.embeds?.[0]
  const title = String(e?.title || '')
  const type = TODO_TYPES.get(title.replace(/^✅ /, ''))
  if (!me || m?.author?.id !== me || !type || !/^\d{5,25}$/.test(String(m.id))) return null
  let text = String(e.description || '')
  const tail = TODO_ORIGIN.exec(text)
  if (tail) text = text.slice(0, tail.index)
  const by = /^Added by (.+)$/.exec(String(e.footer?.text || ''))?.[1]?.trim()
  const at = Date.parse(e.timestamp || m.timestamp || '')
  const files = Number(tail?.[2]) || 0
  return {
    id: String(m.id),
    url: `https://discord.com/channels/${guild}/${m.channel_id || channel}/${m.id}`,
    type,
    done: title.startsWith('✅ '),
    text: text.trim(),
    ...(tail ? { origin: tail[1] } : {}),
    ...(e.author?.name ? { author: String(e.author.name) } : {}),
    ...(by ? { addedBy: by } : {}),
    ...(Number.isFinite(at) ? { at: new Date(at).toISOString() } : {}),
    ...(files ? { files } : {}),
  }
}

/** Copie à ranger, `max` caractères de JSON au plus : { at, channel, items,
 *  omitted?, partial? }. `open` et `done` : les cartes lues, chacune du plus
 *  récent au plus ancien. Gardés : les TODO_OPEN_MAX ouverts puis les
 *  TODO_DONE_MAX faits les plus récents, textes coupés à TODO_TEXT_MAX ;
 *  trop long, les textes sont raccourcis (le plus long commun qui tient,
 *  TODO_TEXT_MIN au moins), puis les plus anciens laissés de côté, les faits
 *  d'abord. `omitted` : cartes lues mais pas copiées ; `partial` : la
 *  lecture s'est arrêtée à TODO_PAGES pages, d'autres peuvent manquer. */
export function fitTodoMirror({ at, channel, open, done, partial = false, max = TODO_MIRROR_MAX }) {
  const nOpen = Math.min(open.length, TODO_OPEN_MAX)
  const kept = [...open.slice(0, TODO_OPEN_MAX), ...done.slice(0, TODO_DONE_MAX)]
  // Place de `omitted` et `partial` comptée d'avance, au plus large.
  const head = JSON.stringify({ at, channel, items: [], omitted: { open: open.length, done: done.length }, partial: true }).length
  const cut = (cap) => kept.map((x) => ({ ...x, text: clipText(x.text, cap) }))
  const size = (list) => list.reduce((n, x) => n + JSON.stringify(x).length + 1, head)   // + la virgule
  let lo = TODO_TEXT_MIN
  let hi = TODO_TEXT_MAX
  if (size(cut(hi)) <= max) lo = hi
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (size(cut(mid)) <= max) lo = mid
    else hi = mid - 1
  }
  const items = cut(lo)
  const sizes = items.map((x) => JSON.stringify(x).length + 1)
  let total = size(items)
  let o = nOpen
  let d = items.length - nOpen
  while (total > max && d) total -= sizes[o + --d]
  while (total > max && o) total -= sizes[--o]
  const omitted = { open: open.length - o, done: done.length - d }
  return {
    at, channel, items: [...items.slice(0, o), ...items.slice(nOpen, nOpen + d)],
    ...(omitted.open || omitted.done ? { omitted } : {}),
    ...(partial ? { partial: true } : {}),
  }
}

export function startDiscordBridge({
  token, secret, worker, admins = [],
  api = 'https://discord.com/api/v10',
  gateway = 'wss://gateway.discord.gg/?v=10&encoding=json',
  github = 'https://api.github.com',
  site = 'https://twitchunblock.vercel.app',
  repos = { ios: 'MXFia19/TwitchUnblock', web: 'MXFia19/TwitchUnblock-Web', android: 'MXFia19/TwitchUnblock-Android' },
  fallbacks = ['https://test2-fallback.vxcraftmanpetit.workers.dev'],
  testSource = 'https://raw.githubusercontent.com/MXFia19/TwitchUnblock/test-17d298/apps-test.json',
  summaryTz = 'Europe/Paris',
  summaryHour = 9,
  // Commit et branche de l'image du relais (GIT_SHA, GIT_BRANCH) ; quotas de
  // Cloudflare : { token, account } (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID).
  version = '',
  branch = '',
  cloudflare = {},
  cloudflareApi = 'https://api.cloudflare.com/client/v4/graphql',
  timers = true,
  // Arrivées regroupées pendant ce temps en un message de bienvenue (ms).
  welcomeDelay = 5000,
  log = console,
}) {
  if (!token || !secret || !worker) {
    log.warn('Discord bridge off: DISCORD_BOT_TOKEN, FEEDBACK_BOT_SECRET and FEEDBACK_WORKER are needed')
    return null
  }
  try { new Intl.DateTimeFormat('en', { timeZone: summaryTz }) } catch {
    log.warn(`Discord bridge: SUMMARY_TZ “${summaryTz}” isn’t a time zone — Europe/Paris used instead`)
    summaryTz = 'Europe/Paris'
  }
  if (!Number.isInteger(summaryHour) || summaryHour < 0 || summaryHour > 23) {
    log.warn('Discord bridge: SUMMARY_HOUR must be between 0 and 23 — 9 used instead')
    summaryHour = 9
  }
  worker = worker.replace(/\/+$/, '')
  api = api.replace(/\/+$/, '')
  site = site.replace(/\/+$/, '')
  const extraAdmins = new Set(admins)
  const st = {
    forum: null, forumType: null, guild: null, owner: null, me: null, app: null, labels: {},
    settings: {},          // salons choisis avec /setup
    suggestionTag: null,   // étiquette « Suggestion » du forum (posts de /suggest)
    tagOf: new Map(),      // état → étiquette
    stateOf: new Map(),    // étiquette → état
    threads: new Map(),    // post du forum → étiquettes posées
    parents: new Map(),    // salon → parent (null : pas un post du forum)
    states: new Map(),     // post → { value: état du retour | null, at }
    expected: new Map(),   // post → étiquettes que le bot vient de poser
    quickDone: new Set(),  // posts qui ont leurs réponses rapides
    fixAsked: new Set(),   // posts où l'on a demandé où sort le correctif
    dmWarned: new Set(),
    alerts: null,          // pannes en cours (watchHealth), copie dans le Worker
    shots: new Map(),      // personne → capture de /bug ou /idea, le temps du formulaire
    dmHints: new Map(),    // personne → dernier renvoi vers les boutons (MP tapé)
    summaryDay: null,
  }
  let ws = null
  let seq = null
  let session = null
  let beatTimer = null
  let firstBeat = null
  let acked = true
  let retries = 0
  let stopped = false
  let backfilling = false
  let intents = INTENTS   // demandées à l'identification de la session en cours
  const intervals = []
  // Passerelle : état pour /health du relais (sa HEALTHCHECK) et /status.
  // waiting (réglages du Worker), connecting, ready, stopped (refus définitif).
  const gw = { state: 'waiting', since: Date.now(), readyAt: 0, lastAck: 0, interval: 0 }
  const gwState = (s) => { if (gw.state !== s) Object.assign(gw, { state: s, since: Date.now() }) }

  // ── API de Discord, du Worker, de GitHub ────────────────────────────────
  /** `files` ({ bytes, type, name }) : envoyés en multipart (payload_json +
   *  files[n]), formulaire refait à chaque essai ; fetch pose lui-même le
   *  Content-Type avec sa frontière. */
  async function rest(method, path, body, files = []) {
    for (let attempt = 0; ; attempt++) {
      let payload = body ? JSON.stringify(body) : undefined
      if (files.length) {
        payload = new FormData()
        payload.append('payload_json', JSON.stringify({ ...body, attachments: files.map((f, n) => ({ id: n, filename: f.name })) }))
        files.forEach((f, n) => payload.append(`files[${n}]`, new Blob([f.bytes], { type: f.type }), f.name))
      }
      const r = await fetch(`${api}${path}`, {
        method,
        headers: {
          Authorization: `Bot ${token}`,
          'User-Agent': 'DiscordBot (https://github.com/MXFia19/TwitchUnblock-Web, 1)',
          ...(body && !files.length ? { 'Content-Type': 'application/json' } : {}),
        },
        body: payload,
        signal: AbortSignal.timeout(files.length ? 30_000 : 15_000),
      })
      if (r.status === 429 && attempt < 3) {
        const j = await r.json().catch(() => ({}))
        await sleep(Math.min(10, Number(j.retry_after) || 1) * 1000)
        continue
      }
      const text = await r.text().catch(() => '')
      if (!r.ok) {
        let code = 0
        try { code = JSON.parse(text).code || 0 } catch {}
        const e = new Error(`${method} ${path.split('?')[0]} → ${r.status}${code ? ` (${code})` : ''}`)
        e.code = code
        throw e
      }
      try { return text ? JSON.parse(text) : null } catch { return null }
    }
  }

  async function call(body) {
    const r = await fetch(`${worker}/api/feedback/discord`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      const e = new Error(data.error || `HTTP ${r.status}`)
      e.status = r.status
      e.data = data   // `reason`, `retryAt`… des actions récentes
      throw e
    }
    return data
  }
  const kvGet = async (key) => (await call({ action: 'get', key })).value
  const kvSet = (key, value, ttl) => call({ action: 'set', key, value, ...(ttl ? { ttl } : {}) })

  async function fetchText(url) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'TwitchUnblock-relay' }, signal: AbortSignal.timeout(15_000) })
      return r.ok ? await r.text() : null
    } catch { return null }
  }
  async function gh(path) {
    const text = await fetchText(`${github}${path}`)
    try { return text ? JSON.parse(text) : null } catch { return null }
  }

  const react = (channel, message, emoji) => rest('PUT',
    `/channels/${channel}/messages/${message}/reactions/${encodeURIComponent(emoji)}/@me`)
    .catch((e) => log.warn(`Discord bridge: reaction failed (${e.message})`))
  const say = (channel, content, extra = {}) => rest('POST', `/channels/${channel}/messages`,
    { content: content.slice(0, 1900), allowed_mentions: { parse: [] }, ...extra }).catch(() => null)
  const isAdmin = (id) => Boolean(id) && (id === st.owner || extraAdmins.has(id))
  const label = (s) => st.labels[s] || LABELS[s] || s
  /** Auteur d'une action du développeur, pour le journal d'audit du Worker
   *  (un Worker d'avant l'ignore). */
  const byOf = (u) => (u?.id ? { id: u.id, name: u.global_name || u.username || '' } : null)

  /** Texte en messages de 1900 caractères au plus, coupés aux lignes ;
   *  `components` sur le dernier. */
  async function sendChunks(channel, text, { components, allowed_mentions = { parse: [] } } = {}) {
    const parts = chunks(text)
    let last = null
    for (let n = 0; n < parts.length; n++) {
      last = await rest('POST', `/channels/${channel}/messages`, {
        content: parts[n], allowed_mentions, ...(n === parts.length - 1 && components ? { components } : {}),
      })
    }
    return last
  }

  // ── Retours, posts et étiquettes ────────────────────────────────────────
  /** Retour lié au post (état, correctif, Discord…), ou null. `wait` : post
   *  tout juste créé, le Worker range le lien juste après — on réessaie. */
  async function stateOf(thread, { wait = false, fresh = false } = {}) {
    const known = st.states.get(thread)
    if (!fresh && known && (known.value || Date.now() - known.at < 60_000)) return known.value
    for (const delay of wait ? [0, 1500, 4000, 10_000] : [0]) {
      if (delay) await sleep(delay)
      try {
        const s = await call({ action: 'state', thread })
        st.states.set(thread, { value: s, at: Date.now() })
        return s
      } catch (e) {
        if (e.status !== 404) {
          log.warn(`Discord bridge: state of post ${thread} unreadable (${e.message})`)
          return known?.value ?? null
        }
      }
    }
    st.states.set(thread, { value: null, at: Date.now() })
    return null
  }
  const remember = (thread, s) => st.states.set(thread, { value: s, at: Date.now() })
  const forget = (thread) => { st.threads.delete(thread); st.states.delete(thread); st.parents.delete(thread) }

  function readTags(channel) {
    st.tagOf.clear()
    st.stateOf.clear()
    st.suggestionTag = null
    for (const t of channel?.available_tags || []) {
      if (!st.suggestionTag && ['suggestion', 'suggestions'].includes(normName(t.name))) { st.suggestionTag = t.id; continue }
      const s = statusOfName(t.name)
      if (s && !st.tagOf.has(s)) {
        st.tagOf.set(s, t.id)
        st.stateOf.set(t.id, s)
      }
    }
  }

  /** Étiquettes d'état : créées s'il en manque, renommées en anglais
   *  (même identifiant : les posts gardent les leurs). Celle des suggestions
   *  (« Suggestion ») aussi, s'il reste de la place. Droit « Gérer les
   *  salons » ; sinon, à faire à la main avec ces noms. */
  async function ensureTags(channel) {
    if (!channel) return
    readTags(channel)
    const tags = channel.available_tags || []
    const missing = STATUSES.filter((s) => !st.tagOf.has(s))
    const renamed = new Map([...st.tagOf].filter(([s, id]) => tags.find((t) => t.id === id)?.name !== label(s)).map(([s, id]) => [id, label(s)]))
    const suggestion = !st.suggestionTag && tags.length + missing.length < 20 ? ['Suggestion'] : []
    if (!missing.length && !renamed.size && !suggestion.length) return
    if (tags.length + missing.length > 20) {
      log.warn(`Discord bridge: no room left for the tags ${missing.map(label).join(', ')} (20 per forum)`)
      return
    }
    try {
      const updated = await rest('PATCH', `/channels/${channel.id}`, {
        available_tags: [
          ...tags.map((t) => ({ id: t.id, name: renamed.get(t.id) || t.name, moderated: t.moderated, emoji_id: t.emoji_id, emoji_name: t.emoji_name })),
          ...[...missing.map(label), ...suggestion].map((name) => ({ name, moderated: true })),
        ],
      })
      readTags(updated || channel)
      if (missing.length || suggestion.length) log.log(`Discord bridge: tags created (${[...missing.map(label), ...suggestion].join(', ')})`)
      if (renamed.size) log.log(`Discord bridge: tags renamed (${[...renamed.values()].join(', ')})`)
    } catch (e) {
      log.warn(`Discord bridge: create or rename the tags by hand (${[...STATUSES.map(label), 'Suggestion'].join(', ')}) — ${e.message}`)
    }
  }

  /** Post du forum ? Son parent, d'après ce qu'on a vu ou demandé à Discord. */
  async function parentOf(channel) {
    if (st.threads.has(channel)) return st.forum
    if (st.parents.has(channel)) return st.parents.get(channel)
    try {
      const c = await rest('GET', `/channels/${channel}`)
      st.parents.set(channel, c?.parent_id || null)
      if (c?.parent_id === st.forum) st.threads.set(channel, c.applied_tags || [])
      return c?.parent_id || null
    } catch {
      return null
    }
  }

  /** Étiquettes du post accordées à l'état du retour : celle de l'état, les
   *  autres étiquettes (hors états) gardées. */
  async function syncTags(thread, status) {
    const tag = st.tagOf.get(status)
    const cur = st.threads.get(thread)
    if (!tag || !cur) return
    let next = [...cur.filter((t) => !st.stateOf.has(t)), tag]
    if (next.length > MAX_TAGS) next = next.slice(-MAX_TAGS)
    if (next.length === cur.length && next.every((t) => cur.includes(t))) return
    st.expected.set(thread, next)
    try {
      try {
        await rest('PATCH', `/channels/${thread}`, { applied_tags: next })
      } catch (e) {
        // Post archivé (inactif) : rouvert le temps de changer l'étiquette.
        if (e.code !== 50083) throw e
        await rest('PATCH', `/channels/${thread}`, { archived: false, applied_tags: next })
      }
      st.threads.set(thread, next)
    } catch (e) {
      st.expected.delete(thread)
      log.warn(`Discord bridge: tag of post ${thread} not set (${e.message})`)
    }
  }

  /** Images jointes (JPEG, PNG, WebP), en base64 pour le Worker. Trop
   *  lourde : la version réduite du CDN de Discord (1280 px au plus, WebP).
   *  `reduce` (captures des personnes) : la version réduite d'abord, moins
   *  lourde à ranger, l'original en repli. */
  async function photosOf(list, { reduce = false } = {}) {
    const ok = []
    let skipped = Math.max(0, list.length - MAX_PHOTOS)
    for (const a of list.slice(0, MAX_PHOTOS)) {
      if (!/^image\/(jpeg|png|webp)/.test(a.content_type || '')) { skipped++; continue }
      let small = null
      if (a.proxy_url && a.width && a.height) {
        const scale = Math.min(1, 1280 / Math.max(a.width, a.height))
        const u = new URL(a.proxy_url)
        u.searchParams.set('width', String(Math.round(a.width * scale)))
        u.searchParams.set('height', String(Math.round(a.height * scale)))
        u.searchParams.set('format', 'webp')
        small = u.href
      }
      const fits = (b64) => Boolean(b64) && b64.length <= MAX_PHOTO_B64
      // L'original, seulement s'il peut tenir (taille annoncée par Discord).
      const original = () => (Number(a.size) > MAX_PHOTO_BYTES ? null : fetchB64(a.url))
      let b64 = reduce && small ? await fetchB64(small) : null
      if (!fits(b64)) b64 = await original()
      if (!fits(b64) && small && !reduce) b64 = await fetchB64(small)
      if (fits(b64)) ok.push(b64)
      else skipped++
    }
    return { ok, skipped }
  }
  const skippedNote = (n) => (n ? ` (${plural(n, 'file')} not sent: too big, or not a ${PHOTO_TYPES} image — ${MAX_PHOTOS} at most.)` : '')
  /** Captures envoyées au Worker mais pas rangées (Worker pas encore à
   *  jour : il ignore les photos) : la personne le sait. */
  const unsavedNote = (sent, r) => (sent && (Number(r?.photos) || 0) < sent ? ' ⚠️ The screenshot(s) couldn’t be saved — please send them again later.' : '')

  /** Fichier en base64, ou null au-delà de MAX_PHOTO_BYTES : lu par
   *  morceaux, le téléchargement s'arrête dès qu'il dépasse. Chargé en entier
   *  avant d'être refusé, un faux « .png » de plusieurs centaines de Mo
   *  (n'importe quel membre, /bug) pouvait faire tomber le processus, qui
   *  porte aussi le relais vidéo et ntfy. */
  async function fetchB64(url) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20_000) })
      if (!r.ok || Number(r.headers.get('content-length')) > MAX_PHOTO_BYTES) {
        await r.body?.cancel().catch(() => {})
        return null
      }
      const parts = []
      let size = 0
      for await (const chunk of r.body || []) {
        size += chunk.length
        if (size > MAX_PHOTO_BYTES) return null   // sortir de la boucle annule le téléchargement
        parts.push(chunk)
      }
      return Buffer.concat(parts).toString('base64')
    } catch {
      return null
    }
  }

  // ── Messages privés (retours envoyés depuis Discord) ────────────────────
  const dmChannels = new Map()
  /** `key` : boutons pour répondre, en texte (« Reply », le formulaire le
   *  plus simple, lu par tous les clients) ou en captures. Long texte : en
   *  plusieurs messages (photos sur le premier, boutons sur le dernier). */
  async function sendDm(userId, content, key, files = []) {
    let ch = dmChannels.get(userId)
    if (!ch) {
      ch = (await rest('POST', '/users/@me/channels', { recipient_id: userId }))?.id
      if (!ch) throw new Error('no DM channel')
      dmChannels.set(userId, ch)
    }
    const parts = chunks(content)
    for (let n = 0; n < parts.length; n++) {
      await rest('POST', `/channels/${ch}/messages`, {
        content: parts[n], allowed_mentions: { parse: [] },
        ...(key && n === parts.length - 1 ? { components: [row(button('Reply', `ur:${key}`, 1), button('Send screenshots', `us:${key}`))] } : {}),
      }, n === 0 ? files : [])
    }
  }

  /** Réponses du développeur pas encore envoyées à qui a écrit depuis
   *  Discord : en message privé, une par une, dans l'ordre, images jointes
   *  (lues une par une au Worker). Discord refuse les fichiers : le texte
   *  part seul, et le post le dit. */
  const dmQueue = new Map()
  function deliverDm(thread) {
    const run = (dmQueue.get(thread) || Promise.resolve()).then(async () => {
      // `peek` : le Worker ne note rien ; ce qui part vraiment est noté
      // après coup (delivered). Noté d'avance, un envoi raté était perdu.
      const r = await call({ action: 'deliver', thread, pics: true, peek: true })
      if (!r?.du || !r.items?.length) return
      for (const it of r.items) {
        const files = []
        for (const n of it.pics || []) {
          const p = await call({ action: 'photo', thread, n }).catch(() => null)
          if (p?.b64) files.push({ bytes: Buffer.from(p.b64, 'base64'), type: p.type, name: `picture${files.length + 1}.${EXT[p.type] || 'jpg'}` })
        }
        const ph = it.ph || 0
        const withLost = (text, k) => (k > 0 ? `${text}\n(📷 ${plural(k, 'picture')} couldn’t be sent here)` : text)
        const text = it.m || ph
          ? `💬 **The developer replied** about your report “${r.excerpt}”:${it.m ? `\n${it.m}` : ''}`
          : `📌 Your report “${r.excerpt}” is now **${it.label}**.`
        try {
          try {
            await sendDm(r.du, withLost(text, ph - files.length), r.key, files)
          } catch (e) {
            // MP fermés : rien ne passera. Autre refus avec des fichiers
            // (trop lourds, délai…) : le texte seul.
            if (!files.length || e.code === 50007) throw e
            await sendDm(r.du, withLost(text, ph), r.key)
            await say(thread, `⚠️ The picture(s) couldn’t be sent to the user in a direct message (${e.message}) — the text went through.`)
          }
        } catch (e) {
          if (e.code !== 50007) log.warn(`Discord bridge: DM to the user of post ${thread} not sent (${e.message})`)
          if (!st.dmWarned.has(thread)) {
            st.dmWarned.add(thread)
            // La vraie raison : ce n'est pas toujours des MP fermés. Le reste
            // repartira à la prochaine réponse (rien n'a été noté comme livré).
            await say(thread, `⚠️ I couldn’t send this to the user in a direct message (${e.code === 50007 ? 'their DMs are closed' : e.message}). It will be tried again with the next reply.`)
          }
          break
        }
        if (Number.isInteger(it.i)) await call({ action: 'delivered', thread, upTo: it.i }).catch(() => {})
      }
    }).catch((e) => log.warn(`Discord bridge: DM delivery failed (${e.message})`))
    dmQueue.set(thread, run)
    return run
  }

  // ── Après une réponse ou un état du développeur ─────────────────────────
  /** Nouveau retour : réponses rapides, et le propriétaire du serveur
   *  mentionné (notification Discord) avec son genre (`kind` : titre de
   *  l'encadré du webhook, « 💡 Idea », « 🐞 Bug »…) — une fois toutes les
   *  10 min au plus : une rafale de retours le faisait sonner à chacun. */
  let lastPing = 0
  async function postQuickReplies(thread, kind = '') {
    if (st.quickDone.has(thread)) return
    st.quickDone.add(thread)
    const mention = Boolean(st.owner) && Date.now() - lastPing >= 10 * 60_000
    if (mention) lastPing = Date.now()
    const ping = mention ? `🔔 <@${st.owner}> New report${kind ? `: ${kind}` : ''}\n` : ''
    await say(thread, `${ping}⚡ **Quick replies** — sent to the user as your reply:`, {
      ...(mention ? { allowed_mentions: { parse: [], users: [st.owner] } } : {}),
      components: [
        row(...QUICK.slice(0, 3).map((q, n) => button(q.label, `qr:${n}`))),
        row(...QUICK.slice(3).map((q, n) => button(q.label, `qr:${n + 3}`))),
      ],
    })
  }

  async function fixPrompt(thread) {
    if (st.fixAsked.has(thread)) return
    st.fixAsked.add(thread)
    await say(thread, '🚀 **Where will the fix ship?** I’ll tell the user as soon as it’s live.', {
      components: [
        row(button('In the app', 'fx:ios', 1), button('On the website', 'fx:web', 1), button('Both', 'fx:both', 1), button('Don’t tell them', 'fx:none')),
        row(button('Apple TV app', 'fx:tvos', 1), button('Android app', 'fx:android', 1)),
      ],
    })
  }

  /** `card` : la carte publique d'une suggestion suit l'état (sauf quand
   *  ses propres boutons viennent de la refaire). */
  async function afterTeamUpdate(thread, s, prevStatus, { card = true } = {}) {
    if (!s) return
    await syncTags(thread, s.status)
    // État précédent inconnu (bot redémarré, changement fait dans /stats) :
    // la question est posée quand même (une fois) — la personne n'était
    // sinon jamais prévenue.
    if (s.status === 'done' && prevStatus !== 'done' && !s.fix) await fixPrompt(thread)
    if (s.discord) await deliverDm(thread)
    if (card && s.suggestion?.card && s.status !== prevStatus) {
      await refreshCard(s.key).catch((e) => log.warn(`Discord bridge: suggestion card not updated (${e.message})`))
    }
    // Doublons fusionnés ici : leur état a suivi (Worker) ; leur étiquette et
    // leurs messages privés aussi.
    for (const dt of s.dupThreads || []) {
      const ds = await stateOf(dt, { fresh: true }).catch(() => null)
      if (!ds) continue
      await syncTags(dt, ds.status)
      if (ds.discord) await deliverDm(dt)
      if (ds.suggestion?.card) await refreshCard(ds.key).catch(() => {})
    }
  }

  /** Retours d'avant le pont : le Worker en publie quelques-uns par appel,
   *  on rappelle jusqu'au bout (au rythme demandé par Discord). Seulement
   *  dans un salon Forum : ailleurs, ils n'auraient pas de post à eux. */
  async function backfill() {
    if (backfilling || st.forumType !== FORUM) return
    backfilling = true
    let total = 0
    try {
      for (let round = 0; round < 500 && !stopped; round++) {
        const r = await call({ action: 'backfill' })
        total += r.done || 0
        if (r.error) { log.warn(`Discord bridge: older reports — ${r.error}`); break }
        if (!r.remaining || (!r.done && !r.retryAfter)) break
        await sleep(r.retryAfter ? Math.ceil(r.retryAfter * 1000) + 500 : 2500)
      }
    } catch (e) {
      log.warn(`Discord bridge: older reports not published (${e.message})`)
    } finally {
      backfilling = false
      if (total) log.log(`Discord bridge: ${total} older report(s) published in the forum`)
    }
  }

  // ── Événements de la passerelle ─────────────────────────────────────────
  async function onGuild(g) {
    st.owner = g.owner_id
    const forum = (g.channels || []).find((c) => c.id === st.forum)
    if (!forum) {
      log.warn(`Discord bridge: channel ${st.forum} of the webhook not found — the bot must be able to see it (channel permissions)`)
      return
    }
    st.forumType = forum.type
    if (forum.type !== FORUM) log.warn('Discord bridge: the webhook isn’t in a Forum channel — reports have no post of their own')
    // Retours, contacts et erreurs récentes (chaînes et vidéos regardées) y
    // sont publiés : le salon doit être privé (README), comme /stats.
    // @everyone sans « Voir le salon » (1 << 10), sinon on prévient.
    const everyone = (forum.permission_overwrites || []).find((o) => o.id === g.id)
    if (!(everyone && BigInt(everyone.deny || 0) & 1024n)) {
      const text = `⚠️ The reports channel <#${forum.id}> looks visible to everyone, but reports, contacts and recent errors (channels watched) are posted there: make it private (@everyone without “View Channel”).`
      log.warn(`Discord bridge: ${text}`)
      await alert(text)
    }
    await ensureTags(forum)
    for (const th of g.threads || []) {
      if (th.parent_id === st.forum) st.threads.set(th.id, th.applied_tags || [])
    }
    log.log(`Discord bridge: following forum “${forum.name}” — ${st.threads.size} open post(s), ${st.tagOf.size}/6 status tags`)
    // Changements faits pendant que le bot était arrêté : étiquettes remises.
    for (const id of [...st.threads.keys()].slice(0, 50)) {
      const s = await stateOf(id)
      if (s) await syncTags(id, s.status)
    }
    backfill()
  }

  async function onThreadUpdate(d) {
    if (d.parent_id !== st.forum) return
    const wasKnown = st.threads.has(d.id)
    const prev = st.threads.get(d.id) || []
    const tags = d.applied_tags || []
    st.threads.set(d.id, tags)
    const expected = st.expected.get(d.id)
    if (expected) {
      st.expected.delete(d.id)
      if (expected.length === tags.length && expected.every((t) => tags.includes(t))) return   // notre changement
    }
    // Post inconnu (archivé avant un redémarrage du bot) : ses étiquettes ne
    // disent rien d'un changement — toutes passaient pour « ajoutées », et
    // rouvert après un changement d'état depuis /stats, l'ancienne étiquette
    // l'annulait. L'état du Worker fait foi.
    if (!wasKnown) {
      const known = await stateOf(d.id)
      if (known) await syncTags(d.id, known.status)
      return
    }
    const added = tags.filter((t) => st.stateOf.has(t) && !prev.includes(t))
    if (!added.length) return
    const status = st.stateOf.get(added[added.length - 1])
    const known = await stateOf(d.id)
    if (!known) return
    if (known.status === status) return syncTags(d.id, status)
    try {
      // Étiquette changée à la main : Discord ne dit pas par qui.
      const r = await call({ action: 'status', thread: d.id, status, by: { name: 'post tag' } })
      remember(d.id, r)
      log.log(`Discord bridge: ${r.key} → ${r.status}`)
      await afterTeamUpdate(d.id, r, known.status)
    } catch (e) {
      // L'étiquette revient à l'état réel du retour.
      await syncTags(d.id, known.status)
      say(d.id, `❌ Status not changed: ${e.message}`)
    }
  }

  /** Message privé tapé au bot : il ne le lit pas (rien n'est gardé), il
   *  renvoie vers les boutons, au plus une fois par heure et par personne. */
  async function onDirectMessage(m) {
    const who = m.author?.id
    if (!who || m.author.bot || who === st.me) return
    const now = Date.now()
    if (now - (st.dmHints.get(who) || 0) < 3600_000) return
    if (st.dmHints.size > 5000) st.dmHints.clear()
    st.dmHints.set(who, now)
    await say(m.channel_id, 'ℹ️ I don’t read messages sent here. To answer about your report, use the buttons under my last message: **Reply** for text, **Send screenshots** for pictures. To report something new, use /bug or /idea in the server.')
  }

  async function onMessage(m) {
    if (!m.guild_id) return onDirectMessage(m)
    if (m.guild_id === st.guild && m.channel_id && m.channel_id === st.settings.announcements) return noteAnnouncement(m)
    if (m.guild_id !== st.guild || !st.forum) return
    if (m.author?.id && m.author.id === st.me) return
    if (await parentOf(m.channel_id) !== st.forum) return
    const thread = m.channel_id
    // Messages du webhook (retour, réponse de la personne, ce qui a été fait
    // dans /stats ou l'app, « c'est en ligne ») : l'étiquette suit l'état,
    // les réponses partent en message privé, un nouveau retour reçoit ses
    // réponses rapides.
    if (m.webhook_id) {
      // Retour supprimé dans /stats : le Worker l'annonce par un mot dans
      // son post, que la corbeille supprime.
      if ((await emptyTrash().catch(() => [])).includes(thread)) return
      const prev = st.states.get(thread)?.value?.status
      const s = await stateOf(thread, { wait: true, fresh: true })
      if (!s) return
      await afterTeamUpdate(thread, s, prev)
      if (m.id === thread && s.status === 'new') await postQuickReplies(thread, m.embeds?.[0]?.title || '')
      return
    }
    if (m.author?.bot || !isAdmin(m.author?.id)) return
    const text = String(m.content || '').trim()
    if (text.startsWith('//')) return   // note privée
    if (text.length > 2000) {
      await react(thread, m.id, '⚠️')
      say(thread, `⚠️ Not sent: ${text.length} characters, 2000 at most — split it into several messages.`)
      return
    }
    const photos = await photosOf(m.attachments || [])
    if (!text && !photos.ok.length) {
      if (photos.skipped) say(thread, `⚠️ Nothing sent: too big, or not a ${PHOTO_TYPES} image.`)
      return
    }
    const s = await stateOf(thread)
    if (!s) { react(thread, m.id, '❔'); return }
    try {
      const r = await call({ action: 'reply', thread, message: text, photos: photos.ok, by: byOf(m.author) })
      remember(thread, r)
      await react(thread, m.id, '✅')
      await afterTeamUpdate(thread, r, s.status)
      if (photos.skipped) say(thread, `⚠️ ${photos.skipped} attachment(s) not sent: too big, or not a JPEG, PNG or WebP image.`)
    } catch (e) {
      await react(thread, m.id, '❌')
      say(thread, `❌ Reply not sent: ${e.message}`)
    }
  }

  // ── Commandes, boutons, formulaires ─────────────────────────────────────
  const respond = (i, type, data) => rest('POST', `/interactions/${i.id}/${i.token}/callback`, data ? { type, data } : { type })
  const editOriginal = (i, data) => rest('PATCH', `/webhooks/${st.app}/${i.token}/messages/@original`, data).catch(() => null)
  const opt = (i, name) => i.data?.options?.find((o) => o.name === name)?.value
  // Champs d'un formulaire : en rangée (type 1) ou dans un Label (type 18).
  const inputs = (i) => (i.data?.components || []).flatMap((r) => r.components || (r.component ? [r.component] : []))
  const field = (i, id) => String(inputs(i).find((c) => c.custom_id === id)?.value || '').trim()
  /** Fichiers d'un champ « File Upload » : ses valeurs sont des numéros de
   *  pièces jointes, décrites dans `resolved`. */
  const uploads = (i, id) => (inputs(i).find((c) => c.custom_id === id)?.values || [])
    .map((v) => i.data?.resolved?.attachments?.[v]).filter(Boolean)
  /** Réponse différée (le Worker peut prendre plus de 3 s), visible de soi
   *  seul : un texte, ou un message entier (encadrés, menu) ; refusé par
   *  Discord pour un emoji (supprimé, inconnu…), il repart tel que `plain`. */
  async function deferred(i, fn) {
    await respond(i, 5, { flags: 64 })
    try {
      const r = await fn()
      const { plain, ...data } = r && typeof r === 'object' ? r : { content: String(r).slice(0, 1900) }
      const edit = (d) => rest('PATCH', `/webhooks/${st.app}/${i.token}/messages/@original`, { allowed_mentions: { parse: [] }, ...d })
      await edit(data).catch((e) => (e.code === 50035 && plain ? edit(plain) : Promise.reject(e)))
    } catch (e) {
      await editOriginal(i, { content: `❌ ${e.message}` })
    }
  }
  /** Message à emojis (`send(true)`) refait sans (`send(false)`) quand
   *  Discord en refuse un : emoji d'un rôle supprimé depuis, inconnu… */
  const withEmojiFallback = (send) => send(true).catch((e) => (e.code === 50035 ? send(false) : Promise.reject(e)))
  /** Réponse visible de la personne seule, sans mention. */
  const quiet = (content, extra = {}) => ({ flags: 64, content: String(content).slice(0, 2000), allowed_mentions: { parse: [] }, ...extra })
  const adminOnly = (i) => respond(i, 4, quiet(lang(i.locale)('admin_only')))

  const reportModal = (kind, shot) => ({
    custom_id: `report:${kind}`,
    // 45 caractères au plus (« Suggest an idea — file ignored (not an image) » : 45)
    title: `${kind === 'idea' ? 'Suggest an idea' : 'Report a bug'}${shot === 'ok' ? ' — screenshot attached' : shot === 'bad' ? ' — file ignored (not an image)' : ''}`,
    components: [
      row(textInput('text', kind === 'idea' ? 'Your idea' : 'What happened?', 2, {
        min: 5, max: 2000,
        placeholder: kind === 'idea' ? 'What would you like to see in TwitchUnblock?' : 'What you did, what you expected, what happened instead',
      })),
      row(textInput('where', 'App or website, and version (optional)', 1, { max: 60, required: false, placeholder: 'e.g. iOS app 1.3.0, or the website' })),
    ],
  })
  /** `tpl` : modèle choisi (/announce template:), qui pré-remplit le formulaire. */
  const announceModal = (tpl = null) => ({
    custom_id: 'announce',
    title: 'Announcement (app and website)',
    components: [
      row(textInput('title', 'Title (optional)', 1, { max: 80, required: false, value: tpl?.title })),
      row(textInput('message', 'Message', 2, { max: 500, required: false, value: tpl?.message })),
      row(textInput('link', 'Link (optional, https://…)', 1, { max: 300, required: false, value: tpl?.link })),
      row(textInput('hours', 'Show it for how many hours? (default 24)', 1, { max: 4, required: false })),
    ],
  })

  const pollModal = () => ({
    custom_id: 'poll',
    title: 'Poll (app and website)',
    components: [
      row(textInput('question', 'Question', 1, { max: 140 })),
      row(textInput('options', 'Choices, one per line (2 to 6)', 2, { max: 400 })),
      row(textInput('multi', 'Several choices per person? (yes / no)', 1, { max: 3, required: false, placeholder: 'no' })),
      row(textInput('hours', 'Open for how many hours? (default 24)', 1, { max: 4, required: false })),
    ],
  })

  async function onInteraction(i) {
    const user = i.member?.user || i.user
    if (!user) return
    if (i.type === 2) return onCommand(i, user)
    if (i.type === 3) return onComponent(i, user)
    if (i.type === 4) return onAutocomplete(i, user)
    if (i.type === 5) return onModal(i, user)
  }

  /** Modèles d'annonce (/announce template:, modifiés dans /stats), gardés
   *  ici : relus par le battement (10 min) et, en arrière-plan, à chaque
   *  saisie. Discord n'attend que 3 s une réponse ; demandés au Worker avant
   *  de répondre, un Worker lent ou froid faisait « L'application n'a pas
   *  répondu ». */
  const templates = { list: [], at: 0 }
  async function refreshTemplates() {
    const r = await call({ action: 'announce-templates' })
    if (Array.isArray(r?.templates)) Object.assign(templates, { list: r.templates, at: Date.now() })
  }

  /** /announce template: : les modèles enregistrés ; /app-announce
   *  duration: les durées de /stats (et celle tapée, si elle est valable). */
  async function onAutocomplete(i, user) {
    if (!isAdmin(user.id)) return respond(i, 8, { choices: [] })
    if (i.data?.name === 'app-announce') {
      const typed = String((i.data.options?.[0]?.options || []).find((o) => o.focused)?.value || '').trim().toLowerCase()
      const own = typed && parseHours(typed) !== null && !DURATIONS.includes(typed) ? [typed] : []
      const choices = [...own, ...DURATIONS.filter((d) => d.startsWith(typed))].slice(0, 25)
        .map((d) => ({ name: d === '24h' ? '24h (default)' : d, value: d }))
      return respond(i, 8, { choices })
    }
    if (Date.now() - templates.at > 30_000) refreshTemplates().catch(() => {})
    const typed = String(i.data?.options?.find((o) => o.focused)?.value || '').toLowerCase()
    const choices = templates.list.filter((x) => String(x.name).toLowerCase().includes(typed))
      .slice(0, 25).map((x) => ({ name: String(x.name).slice(0, 100), value: String(x.id) }))
    return respond(i, 8, { choices })
  }

  /** Capture passée en option de /bug ou /idea : gardée 10 minutes, le
   *  temps de remplir le formulaire (une par personne, la dernière). Un
   *  fichier qui n'est pas une image n'est pas gardé : le titre du
   *  formulaire le dit ('ok', 'bad', ou null sans fichier). */
  function keepShot(i, user) {
    const shot = i.data?.resolved?.attachments?.[opt(i, 'screenshot')]
    const image = /^image\/(jpeg|png|webp)/.test(shot?.content_type || '')
    const now = Date.now()
    for (const [id, s] of st.shots) if (now - s.at > 10 * 60_000) st.shots.delete(id)
    if (image) st.shots.set(user.id, { at: now, att: shot })
    else st.shots.delete(user.id)
    return shot ? (image ? 'ok' : 'bad') : null
  }
  function takeShot(user) {
    const s = st.shots.get(user.id)
    st.shots.delete(user.id)
    return s && Date.now() - s.at <= 10 * 60_000 ? [s.att] : []
  }

  async function onCommand(i, user) {
    const name = i.data?.name
    if (name === 'bug' || name === 'idea') return respond(i, 9, reportModal(name, keepShot(i, user)))
    if (name === 'release-pings') return deferred(i, () => toggleReleaseRole(i, user))
    // Pour tous, dans la langue de la personne (« public » : le développeur seul).
    if (name === 'roles') return rolesCommand(i, user)
    if (name === 'download') return downloadCommand(i, user)
    if (name === 'version') return deferred(i, () => versionText(lang(i.locale)))
    if (name === 'help') return respond(i, 4, { flags: 64, content: helpText(i, user), allowed_mentions: { parse: [] } })
    if (name === 'live') return liveCommand(i, user, opt(i, 'channel'))
    if (name === 'top') return topCommand(i, user)
    if (name === 'my-reports') return deferred(i, () => myReports(i, user))
    if (name === 'suggest') return suggestCommand(i, user)
    if (name === 'suggestions') return deferred(i, () => topSuggestions(i, user))
    if (!isAdmin(user.id)) return adminOnly(i)
    switch (name) {
      case 'app-announce': return appAnnounce(i, user)
      case 'roles-config': return deferred(i, () => rolesConfig(i, user))
      case 'Add to to-do':
      case 'todo':
        return deferred(i, () => addTodo(i, user))
      case 'announce': {
        // Modèle choisi : formulaire pré-rempli (à relire avant d'envoyer),
        // depuis les modèles gardés (refreshTemplates).
        const id = opt(i, 'template')
        const tpl = id ? templates.list.find((x) => String(x.id) === String(id)) : null
        return respond(i, 9, announceModal(tpl))
      }
      case 'announce-clear':
        return deferred(i, async () => { await call({ action: 'announce', clear: true, by: byOf(user) }); return 'Announcement removed from the app and the website.' })
      case 'poll': return respond(i, 9, pollModal())
      case 'poll-end':
        return deferred(i, async () => {
          const r = await call({ action: 'poll-end', by: byOf(user) })
          await postPollResults(r.poll, r.results)
          return st.settings.alerts ? `Poll ended: its results are in <#${st.settings.alerts}>.` : 'Poll ended (pick an alerts channel with /setup to get its results).'
        })
      case 'setup': return deferred(i, () => setup(i))
      case 'summary':
        return deferred(i, async () => ((await postSummary(st.settings.alerts || i.channel_id)) ? 'Summary posted.' : 'Nothing to post.'))
      case 'status': return deferred(i, statusText)
      case 'forget-user': return forgetCommand(i, user)
      case 'delete':
      case 'block':
      case 'merge': {
        const thread = i.channel_id
        if (await parentOf(thread) !== st.forum || !(await stateOf(thread))) {
          return respond(i, 4, { flags: 64, content: 'Run this in the post of a report.' })
        }
        if (name === 'delete') {
          return respond(i, 4, {
            flags: 64,
            content: 'Delete this report for good? The user will no longer see it, and this post will be deleted.',
            components: [row(button('Delete for good', 'del:yes', 4), button('Cancel', 'del:no'))],
          })
        }
        if (name === 'block') {
          return deferred(i, async () => {
            await call({ action: 'block', thread, by: byOf(user) })
            await say(thread, '🔒 Conversation closed: the user can no longer write in this report.')
            return 'Done: the user can no longer write in this report.'
          })
        }
        return deferred(i, () => merge(thread, String(opt(i, 'into') || ''), user))
      }
    }
    return respond(i, 4, { flags: 64, content: 'Unknown command.' })
  }

  async function merge(thread, into, user = null) {
    const r = await call({ action: 'merge', thread, into, by: byOf(user) })
    if (r.intoThread) {
      await say(thread, `🔀 Merged into <#${r.intoThread}>: the user was told, and this report will follow its status.`)
      await say(r.intoThread, `🔀 Duplicate merged here: <#${thread}>.`)
    }
    await deliverDm(thread)
    // Son étiquette suit l'état repris de l'autre retour.
    const s = await stateOf(thread, { fresh: true }).catch(() => null)
    if (s) await syncTags(thread, s.status)
    // Suggestion fusionnée : sa carte le dit, ses votes sont clos.
    if (s?.suggestion?.card) await refreshCard(s.key).catch(() => {})
    await rest('PATCH', `/channels/${thread}`, { archived: true }).catch(() => {})
    return 'Merged.'
  }

  async function setup(i) {
    const use = String(opt(i, 'use') || '')
    const role = opt(i, 'role') || null
    if (use === 'announcements' && role) {
      const problem = await releaseRoleProblem(i.guild_id || st.guild, role, i.data?.resolved?.roles?.[role], true)
      if (problem) return `❌ Not set: ${problem}`
    }
    const settings = { ...((await kvGet('settings').catch(() => null)) || st.settings) }
    if (use === 'alerts') settings.alerts = i.channel_id
    else if (use === 'announcements') { settings.announcements = i.channel_id; settings.announcementsRole = role }
    else if (use === 'testers') { settings.testers = i.channel_id; settings.testersRole = role }
    else if (use === 'todo') settings.todo = i.channel_id
    else if (use === 'suggestions') settings.suggestions = i.channel_id
    // Bienvenue : choisie (ou coupée) de nouveau, l'intent est redemandée.
    else if (use === 'welcome') { settings.welcome = i.channel_id; delete settings.welcomeBlocked }
    else if (use === 'welcome-off') { settings.welcome = null; delete settings.welcomeBlocked }
    else return 'Unknown choice.'
    await kvSet('settings', settings)
    st.settings = settings
    // Autre salon à faire : sa copie dans le Worker le suit.
    if (use === 'todo') todoSoon()
    // GUILD_MEMBERS se demande à l'identification : nouvelle session s'il
    // faut la demander, ou ne plus la demander.
    if (Boolean(intents & GUILD_MEMBERS) !== wantsMembers()) reidentify()
    // Journal d'audit du Worker (un Worker d'avant refuse : sans importance).
    call({ action: 'audit', what: 'bot.setup', detail: `${use} → #${i.channel_id}${role ? ` (role ${role})` : ''}`, by: byOf(i.member?.user || i.user) }).catch(() => {})
    // Rôle des sorties : un bouton dans le salon, pour le prendre ou le rendre.
    if (use === 'announcements' && role) await postReleasePing(i.channel_id)
    // Le rôle des sorties fait partie de la liste de /roles.
    if (use === 'announcements') refreshRolesMessage().catch((e) => log.warn(`Discord bridge: roles message not updated (${e.message})`))
    return {
      alerts: 'This channel now gets the alerts, the daily summary and the release-notes drafts. Keep it private.',
      announcements: role
        ? `Published release notes will go to this channel and mention <@&${role}> (the role must be mentionable). `
          + 'Members take or drop it with /release-pings or the button I just posted — I need “Manage Roles”, above that role.'
        : 'Published release notes will go to this channel (add a role to mention it at each release).',
      testers: `New test builds will be posted here${role ? ` and mention <@&${role}> (the role must be mentionable)` : ''}.`,
      todo: 'To-do items will be listed here: right-click a message → Apps → “Add to to-do”, or /todo.',
      suggestions: 'Suggestions (/suggest) will be posted here as public cards that members vote on. Their report also gets a post in the forum, tagged “Suggestion”.',
      welcome: 'New members will be welcomed here, with Download, Pick roles and Help buttons. This needs the **Server Members Intent** (developer portal → your application → Bot → Privileged Gateway Intents): if it’s off, Discord refuses the connection — I then reconnect without it, turn the welcome off and say so in the alerts channel.',
      'welcome-off': 'Welcome messages are off.',
    }[use]
  }

  // ── Bouton du rôle des sorties, toujours en bas du salon des annonces ──
  // Discord n'épingle rien en bas : après chaque nouveau message du salon
  // (notes de version publiées comprises), le bouton est reposté puis
  // l'ancien supprimé — 8 s plus tard, pour qu'une rafale de messages ne le
  // fasse reposter qu'une fois. Le message actuel est retenu dans les
  // réglages (releasePingMsg), y compris d'un redémarrage à l'autre.
  const RELEASE_PING_TEXT = '🔔 Want a ping when a new version of TwitchUnblock is out? Tap the button (tap it again to stop).'
  let releasePingTimer = null
  const isReleasePing = (m) => m.author?.id === st.me
    && (m.components || []).some((r) => (r.components || []).some((c) => c.custom_id === 'rp:toggle'))

  function noteAnnouncement(m) {
    if (!st.settings.announcementsRole || isReleasePing(m)) return
    clearTimeout(releasePingTimer)
    releasePingTimer = setTimeout(() => {
      postReleasePing(st.settings.announcements)
        .catch((e) => log.warn(`Discord bridge: release pings button not moved down (${e.message})`))
    }, 8000)
  }

  /** Le bouton posté en bas de `channel`, puis l'ancien supprimé (jamais un
   *  moment sans bouton). */
  async function postReleasePing(channel) {
    if (!channel) return
    const old = st.settings.releasePingMsg
    const m = await rest('POST', `/channels/${channel}/messages`, {
      content: RELEASE_PING_TEXT, allowed_mentions: { parse: [] },
      components: [row(button('🔔 Release pings', 'rp:toggle', 1))],
    })
    if (old?.id && old.id !== m?.id) {
      await rest('DELETE', `/channels/${old.channel || channel}/messages/${old.id}`).catch(() => {})
    } else if (!old?.id && m?.id) {
      // Boutons postés avant qu'il soit retenu : retirés des derniers messages.
      const recent = await rest('GET', `/channels/${channel}/messages?limit=50`).catch(() => null)
      for (const r of recent || []) {
        if (r.id !== m.id && isReleasePing(r)) await rest('DELETE', `/channels/${channel}/messages/${r.id}`).catch(() => {})
      }
    }
    if (!m?.id) return
    const settings = { ...st.settings, releasePingMsg: { channel, id: m.id } }
    await kvSet('settings', settings)
    st.settings = settings
  }

  /** Rôles et salons du serveur, et rôles du bot : de quoi vérifier un rôle
   *  avant de le donner. Gardés 30 s au plus et oubliés à tout changement de
   *  rôle ou de salon (passerelle) : une rafale de choix dans /roles ne les
   *  relit pas à chaque fois. Une lecture ratée n'est pas gardée ; `fresh` :
   *  relus quoi qu'il arrive (réglages du développeur). */
  let facts = null   // { guild, at, value }
  function guildFacts(guild, fresh = false) {
    if (!fresh && facts?.guild === guild && Date.now() - facts.at < 30_000) return facts.value
    const memo = { guild, at: Date.now() }
    memo.value = Promise.all([
      rest('GET', `/guilds/${guild}/roles`).catch(() => null),
      rest('GET', `/guilds/${guild}/channels`).catch(() => null),
      st.me ? rest('GET', `/guilds/${guild}/members/${st.me}`).catch(() => null) : null,
    ]).then(([roles, channels, me]) => {
      const f = { roles: Array.isArray(roles) ? roles : null, channels: Array.isArray(channels) ? channels : null, mine: Array.isArray(me?.roles) ? me.roles : null }
      if ((!f.roles || !f.channels || !f.mine) && facts === memo) facts = null
      return f
    })
    facts = memo
    return memo.value
  }
  const forgetFacts = () => { facts = null }

  /** Pourquoi `role` ne peut pas être donné à qui le demande (rôle des
   *  sorties, /roles) ; null s'il convient. Un rôle géré (bot, Boost…), avec
   *  des permissions, ou qui ouvre un salon (droits accordés au rôle dans les
   *  permissions d'un salon) en faisait cadeau à tout le monde ; un rôle qui
   *  y retire des droits (sanction) se rendait aussi librement, sanction
   *  levée ; au-dessus du rôle le plus haut du bot, Discord refuse de le
   *  donner. `f` : guildFacts ; `known` : le rôle décrit par l'interaction
   *  (/setup, /roles-config). */
  function roleProblem(f, guild, role, known = null, t = EN) {
    if (role === guild) return t('rp_everyone')
    const info = known || f.roles?.find((r) => r.id === role)
    if (!info) return t(f.roles ? 'rp_unreadable' : 'rp_check')
    if (info.managed) return t('rp_managed', role)
    if (BigInt(info.permissions || 0) !== 0n) return t('rp_perms', role)
    if (!f.roles || !f.channels || !f.mine) return t('rp_check')
    const opens = f.channels.find((c) => (c.permission_overwrites || []).some((o) => o.id === role && (BigInt(o.allow || 0) | BigInt(o.deny || 0)) !== 0n))
    if (opens) return t('rp_access', role, opens.id)
    const position = (id) => f.roles.find((r) => r.id === id)?.position
    const top = Math.max(-1, ...f.mine.map((id) => position(id) ?? -1))
    return Number(position(role) ?? info.position) < top ? null : t('rp_above', role)
  }
  async function releaseRoleProblem(guild, role, known = null, fresh = false) {
    return roleProblem(await guildFacts(guild, fresh), guild, role, known)
  }

  /** /release-pings et le bouton du salon des sorties : le rôle mentionné à
   *  chaque sortie, pris ou rendu. Revérifié avant d'être donné : ses droits
   *  ont pu changer depuis /setup. */
  async function toggleReleaseRole(i, user) {
    const role = st.settings.announcementsRole
    if (!role || !st.guild) return 'Release pings aren’t set up yet.'
    const has = (i.member?.roles || []).includes(role)
    if (!has) {
      const problem = await releaseRoleProblem(st.guild, role)
      if (problem) {
        log.warn(`Discord bridge: release role not given — ${problem}`)
        return '❌ Release pings are unavailable for now (the role isn’t safe to hand out) — please tell the developer.'
      }
    }
    try {
      await rest(has ? 'DELETE' : 'PUT', `/guilds/${st.guild}/members/${user.id}/roles/${role}`)
    } catch (e) {
      log.warn(`Discord bridge: release role not changed (${e.message})`)
      return `❌ I couldn’t change your roles (${e.message}). The bot needs “Manage Roles”, and its role must be above <@&${role}>.`
    }
    return has ? '🔕 You won’t be pinged for new versions anymore.' : '🔔 You’ll be pinged when a new version is out.'
  }

  // ── /roles et /roles-config ─────────────────────────────────────────────
  // Rôles proposés : réglage selfRoles ([{ id, description, emoji }], écrit
  // par /roles-config) et le rôle des sorties de /setup. Le message pour tous
  // de /roles public:true est retenu (rolesMsg) et suit la liste.
  const ROLE_COOLDOWN = 5000      // un changement par personne, au plus
  const roleChanges = new Map()   // personne → dernier changement

  /** Rôles proposés par /roles : ceux de /roles-config, et le rôle des
   *  sorties (/setup) s'il y en a un — 25 au plus (un menu de Discord). */
  function offeredRoles(settings = st.settings) {
    const list = (Array.isArray(settings.selfRoles) ? settings.selfRoles : []).filter((r) => r?.id)
    const rp = settings.announcementsRole
    return (rp && !list.some((r) => r.id === rp) ? [{ id: rp, release: true }, ...list] : list).slice(0, 25)
  }

  /** Rôle proposé qui n'est plus sûr : ni montré ni donné, et le développeur
   *  le sait (salon d'alertes, une fois par jour). */
  const flagRole = (role, problem) => alertOncePerDay(`role:${role}`,
    `⚠️ **A role offered in /roles isn’t given out**: ${problem} Fix it, or remove it with /roles-config remove.`)
    .catch((e) => log.warn(`Discord bridge: ${e.message}`))

  /** Les rôles proposés qui existent et restent sûrs, prêts pour le menu
   *  (nom, description, emoji). Un rôle supprimé du serveur est passé. */
  function roleOptions(f, t) {
    if (!f.roles || !f.channels || !f.mine) throw new Error(t('rp_check'))
    const out = []
    for (const r of offeredRoles()) {
      const info = f.roles.find((x) => x.id === r.id)
      if (!info) continue
      const problem = roleProblem(f, st.guild, r.id)
      if (problem) { flagRole(r.id, problem); continue }
      out.push({ id: r.id, name: info.name, description: r.description || (r.release ? t('rp_desc') : ''), emoji: r.emoji || (r.release ? '🔔' : '') })
    }
    return out
  }

  /** Menu des rôles ; `have` (rôles de la personne) coche les siens — sans,
   *  rien n'est coché (message pour tous). */
  const rolesMenu = (custom_id, options, placeholder, { have = null, emojis = true } = {}) => ({
    type: 3, custom_id, placeholder, min_values: have ? 0 : 1, max_values: options.length,
    options: options.map((o) => ({
      label: String(o.name || o.id).slice(0, 100), value: o.id,
      ...(o.description ? { description: String(o.description).slice(0, 100) } : {}),
      ...(emojis && o.emoji ? { emoji: emojiOf(o.emoji) } : {}),
      ...(have ? { default: have.has(o.id) } : {}),
    })),
  })
  const menuOptions = (components) => (components || []).flatMap((r) => r.components || [])
    .filter((c) => c.type === 3).flatMap((c) => c.options || [])
  /** Composants d'un message, son menu recoché d'après `have`. */
  const recheck = (components, have) => (components || []).map((r) => ({
    ...r, components: (r.components || []).map((c) => (c.type === 3 ? { ...c, options: (c.options || []).map((o) => ({ ...o, default: have.has(o.value) })) } : c)),
  }))

  /** Message permanent de /roles public:true, en anglais : la liste avec les
   *  descriptions, et le même menu, où rien n'est coché — chaque rôle choisi
   *  y est pris, ou rendu si on l'avait. */
  function rolesPublicMessage(options, emojis = true) {
    const lines = options.map((o) => `${emojis && o.emoji ? `${o.emoji} ` : ''}<@&${o.id}>${o.description ? ` — ${o.description}` : ''}`)
    return {
      embeds: [{
        title: '🏷️ Roles', color: 0x9146ff,
        description: (options.length
          ? `Pick a role in the menu to get it — pick it again to drop it. Only you see the answer.\n\n${lines.join('\n')}`
          : 'No roles to pick right now.').slice(0, 4000),
      }],
      components: options.length ? [row(rolesMenu('roles:pub', options, 'Pick a role to get it or drop it', { emojis }))] : [],
      allowed_mentions: { parse: [] },
    }
  }

  /** Réglages relus, changés (`patch`) et rangés dans le Worker. */
  async function saveSettings(patch) {
    const settings = { ...((await kvGet('settings').catch(() => null)) || st.settings), ...patch }
    await kvSet('settings', settings)
    st.settings = settings
    return settings
  }

  /** Message pour tous (le dernier posté) remis à jour quand la liste
   *  change ; supprimé entre-temps, il est oublié. */
  async function refreshRolesMessage() {
    const m = st.settings.rolesMsg
    if (!m?.id || !st.guild) return
    const options = roleOptions(await guildFacts(st.guild), EN)
    try {
      await withEmojiFallback((emojis) => rest('PATCH', `/channels/${m.channel}/messages/${m.id}`, rolesPublicMessage(options, emojis)))
    } catch (e) {
      if (e.code !== 10008 && e.code !== 10003) throw e
      await saveSettings({ rolesMsg: null })
    }
  }

  /** /roles : un menu pour soi seul, ses rôles cochés ; public:true
   *  (développeur) : le message pour tous, posté dans ce salon (le précédent
   *  est supprimé). */
  function rolesCommand(i, user) {
    const t = lang(i.locale)
    const asked = opt(i, 'public') === true
    const pub = asked && isAdmin(user.id)
    return deferred(i, async () => {
      if (!st.guild || i.guild_id !== st.guild) return t('roles_none')
      const options = roleOptions(await guildFacts(st.guild), pub ? EN : t)
      if (!options.length) return `${t('roles_none')}${isAdmin(user.id) ? ` ${t('roles_none_admin')}` : ''}`
      if (pub) {
        const m = await withEmojiFallback((emojis) => rest('POST', `/channels/${i.channel_id}/messages`, rolesPublicMessage(options, emojis)))
          .catch((e) => { throw new Error(t('post_failed', e.message)) })
        const old = st.settings.rolesMsg
        await saveSettings({ rolesMsg: { channel: i.channel_id, id: m?.id } })
        if (old?.id && old.id !== m?.id) rest('DELETE', `/channels/${old.channel}/messages/${old.id}`).catch(() => {})
        call({ action: 'audit', what: 'bot.roles', detail: `menu for everyone → #${i.channel_id}`, by: byOf(user) }).catch(() => {})
        return t('posted', i.channel_id)
      }
      const have = new Set(i.member?.roles || [])
      const content = `${t('roles_intro')}${asked ? `\n${t('public_admin_only')}` : ''}`
      const menu = (emojis) => [row(rolesMenu('roles:me', options, t('roles_pick'), { have, emojis }))]
      return { content, components: menu(true), plain: { content, components: menu(false) } }
    })
  }

  /** Menus de /roles. `roles:me` (sa réponse à soi seul) : les rôles cochés
   *  sont voulus, les décochés rendus, puis le menu revient à jour.
   *  `roles:pub` (message pour tous, rien n'y est coché) : chaque rôle choisi
   *  est pris, ou rendu si on l'avait ; réponse visible de soi seul. Un
   *  changement toutes les 5 s au plus par personne. */
  async function onRolesMenu(i, user, which) {
    const t = lang(i.locale)
    const now = Date.now()
    const wait = now - (roleChanges.get(user.id) || 0) < ROLE_COOLDOWN
    if (!wait) {
      if (roleChanges.size > 5000) for (const [id, at] of roleChanges) if (now - at >= ROLE_COOLDOWN) roleChanges.delete(id)
      roleChanges.set(user.id, now)
    }
    if (which === 'pub') {
      // Le menu remis à zéro chez la personne (même message, rien ne change
      // pour les autres) : ses choix y restaient cochés, et repartaient au
      // choix suivant. Refusé (emoji supprimé…) : réponse différée.
      const reset = await respond(i, 7, { components: i.message?.components || [] }).then(() => true, () => false)
      if (!reset) await respond(i, 5, { flags: 64 })
      const data = { content: wait ? t('roles_wait') : (await changeRoles(i, user, t, true)).text, allowed_mentions: { parse: [] } }
      await (reset ? rest('POST', `/webhooks/${st.app}/${i.token}`, { ...data, flags: 64 }) : rest('PATCH', `/webhooks/${st.app}/${i.token}/messages/@original`, data))
        .catch((e) => log.warn(`Discord bridge: roles answer not sent (${e.message})`))
      return
    }
    // Trop tôt : rien ne change, le menu revient aux rôles actuels.
    if (wait) {
      return respond(i, 7, { content: t('roles_wait'), components: recheck(i.message?.components, new Set(i.member?.roles || [])), allowed_mentions: { parse: [] } })
    }
    await respond(i, 6)
    const r = await changeRoles(i, user, t, false)
    const content = `${t('roles_intro')}\n${r.text}`
    // Options illisibles (erreur) : le menu d'avant, recoché.
    const menu = (emojis) => (!r.options ? recheck(i.message?.components, r.have)
      : r.options.length ? [row(rolesMenu('roles:me', r.options, t('roles_pick'), { have: r.have, emojis }))] : [])
    await withEmojiFallback((emojis) => rest('PATCH', `/webhooks/${st.app}/${i.token}/messages/@original`, { content, components: menu(emojis), allowed_mentions: { parse: [] } }))
      .catch((e) => log.warn(`Discord bridge: roles menu not updated (${e.message})`))
  }

  /** Rôles choisis dans un menu de /roles, donnés ou rendus un par un (PUT
   *  ou DELETE du seul rôle : renvoyer toute la liste de la personne
   *  échouait si elle avait un rôle au-dessus du bot, et écrasait un rôle
   *  donné au même moment par un autre). Seuls ceux encore proposés, sûrs à
   *  cet instant et qui changent vraiment sont touchés ; `toggle` (message
   *  pour tous) : chaque rôle choisi est pris ou rendu. Rend le texte de la
   *  réponse (ce qui a marché, ce qui a raté), les rôles de la personne
   *  après coup et les options du menu (null : illisibles). */
  async function changeRoles(i, user, t, toggle) {
    const have = new Set(i.member?.roles || [])
    try {
      if (!st.guild || i.guild_id !== st.guild) return { text: t('roles_none'), have, options: null }
      const options = roleOptions(await guildFacts(st.guild), t)
      const safe = new Set(options.map((o) => o.id))
      const offered = new Set(offeredRoles().map((r) => r.id))
      const picked = new Set(i.data?.values || [])
      // Menu pour soi : seuls les rôles qu'il montrait (un rôle ajouté à la
      // liste depuis, la personne ne l'a pas vu : il n'est pas rendu), et
      // parmi eux ceux qu'elle a cochés ou décochés — un rôle reçu ou perdu
      // ailleurs depuis l'affichage du menu reste tel quel. Coches du menu
      // illisibles : comparées à ses rôles actuels.
      const shown = menuOptions(i.message?.components)
      const ticked = shown.some((o) => 'default' in o) ? new Set(shown.filter((o) => o.default).map((o) => o.value)) : have
      const asked = new Set((toggle ? [...picked] : shown.map((o) => o.value).filter((id) => picked.has(id) !== ticked.has(id)))
        .filter((id) => offered.has(id)))
      const add = []
      const drop = []
      for (const id of asked) {
        const want = toggle ? !have.has(id) : picked.has(id)
        if (want !== have.has(id)) (want ? add : drop).push(id)
      }
      // Revérifiés à l'instant : un rôle qui n'est plus sûr n'est pas touché.
      const adds = add.filter((id) => safe.has(id))
      const drops = drop.filter((id) => safe.has(id))
      const skipped = add.length + drop.length - adds.length - drops.length
      // L'un après l'autre : rest attend, sur un 429, le temps demandé
      // (retry_after). Un échec n'empêche pas les autres.
      const done = []
      const failed = []
      let why = ''
      for (const id of [...adds, ...drops]) {
        const give = !have.has(id)
        const mark = `${give ? '+' : '−'}<@&${id}>`
        try {
          await rest(give ? 'PUT' : 'DELETE', `/guilds/${st.guild}/members/${user.id}/roles/${id}`)
          if (give) have.add(id)
          else have.delete(id)
          done.push(mark)
        } catch (e) {
          log.warn(`Discord bridge: role ${id} not ${give ? 'given' : 'removed'} (${e.message})`)
          failed.push(mark)
          why ||= e.message.split(' → ').pop()
        }
      }
      const lines = [done.length ? `✅ ${done.join(' ')}` : failed.length ? '' : t('roles_same')]
      if (failed.length) lines.push(t('roles_error', failed.join(' '), why))
      if (skipped) lines.push(t('roles_skipped', skipped))
      return { text: lines.filter(Boolean).join('\n'), have, options }
    } catch (e) {
      return { text: `❌ ${e.message}`, have, options: null }
    }
  }

  /** Emoji standard, ou emoji de ce serveur : avec un autre, Discord
   *  refuserait le menu. */
  async function emojiOk(s) {
    const m = s.match(CUSTOM_EMOJI)
    if (!m) return UNICODE_EMOJI.test(s)
    return Boolean(await rest('GET', `/guilds/${st.guild}/emojis/${m[3]}`).catch(() => null))
  }

  /** /roles-config add|remove|list : les rôles que propose /roles. Un rôle
   *  n'est accepté que sûr ; les rôles supprimés du serveur sortent de la
   *  liste au passage. */
  async function rolesConfig(i, user) {
    const t = lang(i.locale)
    const sub = i.data?.options?.[0]
    const arg = (name) => sub?.options?.find((o) => o.name === name)?.value
    const role = String(arg('role') || '')
    const f = await guildFacts(st.guild, true)
    const settings = { ...((await kvGet('settings').catch(() => null)) || st.settings) }
    const before = (Array.isArray(settings.selfRoles) ? settings.selfRoles : []).filter((r) => r?.id)
    const list = before.filter((r) => !f.roles || f.roles.some((x) => x.id === r.id))
    const save = async (next, detail = '') => {
      settings.selfRoles = next
      await kvSet('settings', settings)
      st.settings = settings
      if (detail) call({ action: 'audit', what: 'bot.roles', detail, by: byOf(user) }).catch(() => {})
      refreshRolesMessage().catch((e) => log.warn(`Discord bridge: roles message not updated (${e.message})`))
    }
    if (sub?.name === 'add') {
      const problem = roleProblem(f, st.guild, role, i.data?.resolved?.roles?.[role], t)
      if (problem) return `❌ ${problem}`
      const emoji = String(arg('emoji') || '').trim()
      if (emoji && !(await emojiOk(emoji))) return t('rc_bad_emoji')
      const description = String(arg('description') || '').trim().slice(0, 100)
      const at = list.findIndex((r) => r.id === role)
      // Déjà proposé : description et emoji remplacés s'ils sont donnés.
      const entry = { ...list[at], id: role, ...(description ? { description } : {}), ...(emoji ? { emoji } : {}) }
      const next = at >= 0 ? list.map((r, n) => (n === at ? entry : r)) : [...list, entry]
      const release = settings.announcementsRole
      if (next.length + (release && !next.some((r) => r.id === release) ? 1 : 0) > 25) return t('rc_full')
      await save(next, `${at >= 0 ? 'update' : 'add'} ${role}`)
      return t(at >= 0 ? 'rc_updated' : 'rc_added', role)
    }
    if (sub?.name === 'remove') {
      const next = list.filter((r) => r.id !== role)
      if (next.length !== before.length) await save(next, next.length !== list.length ? `remove ${role}` : '')
      if (role === settings.announcementsRole) return t('rc_release_stays', role)
      return t(next.length !== list.length ? 'rc_removed' : 'rc_not_listed', role)
    }
    if (list.length !== before.length) await save(list)
    const entries = offeredRoles({ ...settings, selfRoles: list })
    if (!entries.length) return t('rc_empty')
    const lines = entries.map((r) => {
      const problem = roleProblem(f, st.guild, r.id, null, t)
      const emoji = r.emoji || (r.release ? '🔔' : '')
      const description = r.description || (r.release ? t('rp_desc') : '')
      return `- ${emoji ? `${emoji} ` : ''}<@&${r.id}>${description ? ` — ${description}` : ''}${r.release ? ` (${t('rc_release')})` : ''}${problem ? `\n  ⚠️ ${problem}` : ''}`
    })
    const m = settings.rolesMsg?.id ? `\n${t('rc_message', settings.rolesMsg.channel)}` : ''
    return `${t('rc_head')}\n${lines.join('\n')}${m}`.slice(0, 1900)
  }

  // ── /download, /version, /help ──────────────────────────────────────────
  /** JSON d'une adresse : l'objet, false si elle n'existe pas (404), null si
   *  la lecture a raté. */
  async function readJson(url) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'TwitchUnblock-relay' }, signal: AbortSignal.timeout(15_000) })
      if (!r.ok) {
        await r.body?.cancel().catch(() => {})
        return r.status === 404 ? false : null
      }
      return await r.json()
    } catch {
      return null
    }
  }

  /** Version d'une source AltStore (de l'app `name`, ou de la première) :
   *  false si la source n'existe pas, null si elle est illisible. */
  function sourceVersion(src, name = null) {
    if (!src) return src === false ? false : null
    const apps = Array.isArray(src.apps) ? src.apps : []
    const app = name ? apps.find((a) => a?.name === name) : apps[0]
    const v = app?.versions?.[0]?.version || app?.version
    return v ? String(v).slice(0, 40) : null
  }

  /** Android : la dernière version stable (« TwitchUnblock X.Y.N ») et le
   *  dernier build de test (« TU Test … ») s'il est plus récent — null pour
   *  celle qui n'existe pas ; null tout court si la liste est illisible. */
  function androidVersions(list) {
    if (list === false) return { stable: null, test: null }
    if (!Array.isArray(list)) return null
    const when = (r) => Date.parse(r.published_at || r.created_at || 0) || 0
    const newest = (keep) => list.filter((r) => r && !r.draft && keep(r)).sort((a, b) => when(b) - when(a))[0] || null
    const stable = newest((r) => !r.prerelease && /^TwitchUnblock \d/.test(r.name || ''))
    const test = newest((r) => r.prerelease)
    const name = (r, prefix) => String(r.name || r.tag_name || '').replace(prefix, '').trim().slice(0, 40) || null
    return {
      stable: stable ? name(stable, /^TwitchUnblock\s+/) : null,
      test: test && (!stable || when(test) > when(stable)) ? name(test, /^TU Test\s+/) : null,
    }
  }

  /** Dernières versions, lues sur GitHub (sources brutes ; releases
   *  d'Android par l'API publique, sans jeton) et sur le site, gardées
   *  10 min — 1 min quand une lecture a raté. Une version illisible vaut
   *  null (« inconnue ») ; une source ou une sortie qui n'existe pas, false. */
  let versionsMemo = null   // { at, ttl, value }
  function latestVersions() {
    if (versionsMemo && Date.now() - versionsMemo.at < versionsMemo.ttl) return versionsMemo.value
    const memo = { at: Date.now(), ttl: 10 * 60_000 }
    memo.value = Promise.all([
      readJson(IOS_SOURCE), readJson(testSource), readJson(TV_TEST_SOURCE), readJson(TV_STABLE_SOURCE),
      repos.android ? readJson(`${github}/repos/${repos.android}/releases?per_page=30`) : false,
      siteVersion().catch(() => null),
    ]).then(([main, test, tv, tvStable, apks, web]) => {
      const v = {
        at: memo.at,
        ios: sourceVersion(main, 'TwitchUnblock'),
        iosTest: sourceVersion(test) || sourceVersion(main, 'TU Test'),
        tvTest: sourceVersion(tv),
        tvStable: sourceVersion(tvStable),
        android: androidVersions(apks),
        web: web || null,
      }
      if (Object.values(v).includes(null)) memo.ttl = 60_000
      return v
    })
    versionsMemo = memo
    return memo.value
  }

  /** /version, dans la langue de la personne. */
  async function versionText(t) {
    const v = await latestVersions()
    const b = (x) => (x ? `**${x}**` : t(x === false ? 'v_none' : 'v_unknown'))
    const a = v.android
    const android = !a ? t('v_unknown')
      : a.stable ? `${b(a.stable)}${a.test ? ` · ${t('v_test')} ${b(a.test)}` : ''}`
        : a.test ? t('v_test_only', b(a.test)) : t('v_none')
    return [
      t('v_head'),
      `📱 ${t('v_ios')} ${b(v.ios)} · ${t('v_tu_test')} ${b(v.iosTest)}`,
      `📺 ${t('v_tv')} ${t('v_test')} ${b(v.tvTest)}${v.tvStable ? ` · ${t('v_stable')} ${b(v.tvStable)}` : ''}`,
      `🤖 ${t('v_android')} ${android}`,
      `🌐 ${t('v_web')} ${b(v.web)}`,
      `-# ${t('v_checked')} <t:${Math.floor(v.at / 1000)}:R>`,
    ].join('\n')
  }

  /** /download : un encadré par plateforme et, dessous, une rangée de
   *  boutons (liens) par plateforme, dans le même ordre. */
  function downloadMessage(t, v) {
    const link = (emoji, label, url) => ({ type: 2, style: 5, label, url, emoji: { name: emoji } })
    const code = (url) => `\`\`\`\n${url}\n\`\`\`\n`
    const embed = (title, description) => ({ title, description: description.trim().slice(0, 4000), color: 0x9146ff })
    const a = v?.android
    const android = !a ? '' : `\n${a.stable ? t('dl_latest', a.stable) : a.test ? t('dl_android_test_only', a.test) : t('dl_android_none')}`
    // Source des versions stables de l'Apple TV : montrée, sauf quand on sait
    // qu'elle n'existe pas encore.
    const tvStable = v?.tvStable !== false
    return {
      embeds: [
        embed(t('dl_ios_title'), `${t('dl_ios', IOS_SOURCE)}${v?.ios ? `\n${t('dl_latest', v.ios)}${v.iosTest ? ` · TU Test **${v.iosTest}**` : ''}` : ''}`),
        embed(t('dl_tv_title'), `${t('dl_tv')}\n${t('dl_tv_test')}\n${code(TV_TEST_SOURCE)}${tvStable ? `${t('dl_tv_stable')}\n${code(TV_STABLE_SOURCE)}` : t('dl_tv_no_stable')}`),
        embed(t('dl_android_title'), `${t('dl_android')}${android}`),
        embed(t('dl_web_title'), t('dl_web')),
      ],
      components: [
        row(link('📱', t('b_add_source'), ADD_SOURCE), link('📱', t('b_ipa'), IPA)),
        row(link('📺', t('b_tv_test'), TV_TEST_SOURCE), ...(tvStable ? [link('📺', t('b_tv_stable'), TV_STABLE_SOURCE)] : [])),
        row(link('🤖', t('b_apk'), APK_RELEASES)),
        row(link('🌐', t('b_site'), site)),
      ],
    }
  }

  /** /download : pour soi, dans sa langue ; public:true (développeur) :
   *  posté dans ce salon, en anglais. */
  function downloadCommand(i, user) {
    const t = lang(i.locale)
    const asked = opt(i, 'public') === true
    const pub = asked && isAdmin(user.id)
    return deferred(i, async () => {
      const v = await latestVersions()
      if (!pub) return { ...downloadMessage(t, v), content: asked ? t('public_admin_only') : '' }
      await rest('POST', `/channels/${i.channel_id}/messages`, { ...downloadMessage(EN, v), allowed_mentions: { parse: [] } })
        .catch((e) => { throw new Error(t('post_failed', e.message)) })
      return t('posted', i.channel_id)
    })
  }

  /** /help : les commandes utiles à la personne (celles du développeur, à
   *  lui seul). */
  function helpText(i, user) {
    const t = lang(i.locale)
    const admin = isAdmin(user.id)
    const cmd = (c) => c.split(' · ').map((x) => `\`${x}\``).join(' · ')
    const mine = [
      ['/bug', 'h_bug'], ['/idea', 'h_idea'], ['/suggest', 'h_suggest'], ['/suggestions top', 'h_suggestions'], ['/my-reports', 'h_my_reports'],
      ['/live', 'h_live'], ['/top', 'h_top'],
      ...(admin || offeredRoles().length ? [['/roles', 'h_roles']] : []),
      ...(admin || st.settings.announcementsRole ? [['/release-pings', 'h_release_pings']] : []),
      ['/download', 'h_download'], ['/version', 'h_version'], ['/help', 'h_help'],
    ]
    const lines = [t('h_head'), ...mine.map(([c, k]) => `${cmd(c)} — ${t(k)}`), `-# ${t('h_replies')}`]
    if (admin) lines.push('', t('h_admin'), ...ADMIN_HELP.map(([c, k]) => `${cmd(c)} — ${t(k)}`))
    return lines.join('\n').slice(0, 1900)
  }

  // ── Petits outils des commandes pour tous ───────────────────────────────
  const sec = (ms) => Math.floor(Number(ms) / 1000)
  /** Texte d'autrui dans du Markdown : sur une ligne, sans mise en forme ni
   *  lien masqué ([texte](adresse)) ni mention. */
  const md = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().replace(/[\\`*_~|[\]<>]/g, '\\$&')
  const discordLink = (...ids) => `https://discord.com/channels/${st.guild}/${ids.join('/')}`
  const linkButton = (label, url, emoji) => ({ type: 2, style: 5, label, url, emoji: { name: emoji } })
  /** Lignes jointes dans `max` caractères : celles de `tail` toujours, celles
   *  de `lines` tant qu'elles tiennent (dans l'ordre). */
  function fit(lines, tail = [], max = 1900) {
    const out = []
    let size = tail.join('\n').length
    for (const l of lines) {
      if (size + l.length + 1 > max) break
      out.push(l)
      size += l.length + 1
    }
    return [...out, ...tail].join('\n')
  }

  // ── /live et /top ───────────────────────────────────────────────────────
  // Données du Worker (actions live et top : la GQL publique de Twitch),
  // gardées 60 s par chaîne (par recherche pour /top) ; une lecture au
  // Worker toutes les 5 s au plus par personne — une réponse gardée ne
  // compte pas. Réponses visibles de la personne seule, dans sa langue.
  const LOOKUP_TTL = 60_000
  const LOOKUP_COOLDOWN = 5000
  const liveCache = new Map()   // chaîne → { at, value: promesse }
  const topCache = new Map()    // « catégorie|langue » → { at, value: promesse }
  const lookups = new Map()     // personne → dernière lecture au Worker
  // « Open in the app » : une adresse https du Worker qui renvoie vers l'app
  // (twitchunblock://live/<chaîne>) — Discord n'accepte que des liens http(s).
  const openInApp = /^https:\/\//i.test(worker)
  if (!openInApp) log.warn('Discord bridge: FEEDBACK_WORKER isn’t an https address — /live and /top won’t have “Open in the app”')

  /** Réponse gardée, ou lue au Worker (`load`) ; null quand la personne doit
   *  attendre. Une lecture ratée n'est pas gardée. */
  function lookup(cache, key, user, load) {
    const now = Date.now()
    const hit = cache.get(key)
    if (hit && now - hit.at < LOOKUP_TTL) return hit.value
    if (now - (lookups.get(user.id) || 0) < LOOKUP_COOLDOWN) return null
    if (lookups.size > 5000) for (const [id, at] of lookups) if (now - at >= LOOKUP_COOLDOWN) lookups.delete(id)
    if (cache.size > 500) for (const [k, v] of cache) if (now - v.at >= LOOKUP_TTL) cache.delete(k)
    lookups.set(user.id, now)
    const value = load()
    cache.set(key, { at: now, value })
    value.catch(() => { if (cache.get(key)?.value === value) cache.delete(key) })
    return value
  }
  /** Échec d'une lecture au Worker, dans la langue de la personne. */
  const lookupError = (t, e) => (e.data?.reason === 'busy' ? t('live_busy') : e.data?.reason === 'twitch' ? t('live_error') : `❌ ${e.message}`)

  /** Nom de chaîne tapé (« xqc », « @xqc », un lien twitch.tv), en minuscules ; null s'il n'en est pas un. */
  function channelName(raw) {
    const s = String(raw || '').trim().replace(/^(?:https?:\/\/)?(?:www\.|m\.)?twitch\.tv\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '')
    return /^[a-z0-9_]{1,25}$/i.test(s) ? s.toLowerCase() : null
  }
  const liveButtons = (t, login) => row(linkButton(t('b_watch'), `${site}/${login}`, '🌐'),
    ...(openInApp ? [linkButton(t('b_app'), `${worker}/api/open/live?channel=${login}`, '📱')] : []))
  const uptime = (t, startedAt) => {
    const started = Date.parse(startedAt || '')
    if (!Number.isFinite(started)) return null
    const mins = Math.max(0, Math.floor((Date.now() - started) / 60_000))
    return t('dur', Math.floor(mins / 60), mins % 60)
  }

  /** Encadré de /live (et du menu de /top) : le direct, ou « hors ligne »
   *  avec la date du dernier. */
  function liveMessage(t, d) {
    if (!d?.found) return t('live_none', md(d?.login || '?'))
    const s = d.live
    const author = { name: d.name, url: `${site}/${d.login}`, ...(d.avatar ? { icon_url: d.avatar } : {}) }
    if (!s) {
      const last = Date.parse(d.lastLive || '')
      return {
        embeds: [{
          author, color: 0x6b7280, ...(d.avatar ? { thumbnail: { url: d.avatar } } : {}),
          description: `${t('live_offline', md(d.name))}${Number.isFinite(last) ? `\n${t('live_last', `<t:${sec(last)}:R>`)}` : ''}`,
        }],
        components: [liveButtons(t, d.login)],
      }
    }
    return {
      embeds: [{
        author: { ...author, name: `${d.name} · ${t('live_tag')}` },
        title: String(s.title || d.name).slice(0, 256), url: `${site}/${d.login}`, color: 0xeb0400,
        fields: [
          { name: t('f_category'), value: s.game || '—', inline: true },
          { name: t('f_viewers'), value: t.num(s.viewers), inline: true },
          { name: t('f_uptime'), value: uptime(t, s.startedAt) || '—', inline: true },
        ],
        // Vignette relue chaque minute : Discord garde une image par adresse.
        ...(s.thumb ? { image: { url: `${s.thumb}${s.thumb.includes('?') ? '&' : '?'}t=${Math.floor(Date.now() / 60_000)}` } } : {}),
      }],
      components: [liveButtons(t, d.login)],
    }
  }

  /** /live channel: — et un direct choisi dans le menu de /top. */
  function liveCommand(i, user, raw) {
    const t = lang(i.locale)
    const login = channelName(raw)
    if (!login) return respond(i, 4, quiet(t('live_bad')))
    const data = lookup(liveCache, login, user, () => call({ action: 'live', login }))
    if (!data) return respond(i, 4, quiet(t('live_wait')))
    return deferred(i, () => data.then((d) => liveMessage(t, d), (e) => lookupError(t, e)))
  }

  /** /top [category] [language]. */
  function topCommand(i, user) {
    const t = lang(i.locale)
    const category = String(opt(i, 'category') || '').replace(/\s+/g, ' ').trim().slice(0, 100)
    const language = TOP_LANGUAGES.includes(opt(i, 'language')) ? opt(i, 'language') : ''
    const data = lookup(topCache, `${category.toLowerCase()}|${language}`, user, () => call({ action: 'top', category, language }))
    if (!data) return respond(i, 4, quiet(t('live_wait')))
    return deferred(i, () => data.then((d) => topMessage(t, d, category), (e) => lookupError(t, e)))
  }

  /** /top : les directs en liste (liens vers le site et vers l'app), et un
   *  menu qui ouvre l'encadré de l'un d'eux, celui de /live. */
  function topMessage(t, d, asked) {
    if (d?.notFound) return t('top_cat_none', md(asked))
    const list = Array.isArray(d?.streams) ? d.streams : []
    if (!list.length) return t('top_none')
    const now = Date.now()
    // Le menu ouvre l'encadré sans relire le Worker : ces directs sont gardés.
    for (const s of list) {
      const hit = liveCache.get(s.login)
      if (!hit || now - hit.at >= LOOKUP_TTL) {
        liveCache.set(s.login, { at: now, value: Promise.resolve({ found: true, login: s.login, name: s.name, avatar: s.avatar, live: s, lastLive: null }) })
      }
    }
    const lines = list.map((s, n) => {
      const app = openInApp ? ` · [📱](${worker}/api/open/live?channel=${s.login})` : ''
      const time = uptime(t, s.startedAt)
      return `**${n + 1}. [${md(s.name)}](${site}/${s.login})**${app} — ${md(String(s.title || '').slice(0, 90)) || '—'}\n`
        + `${s.game ? `${md(s.game)} · ` : ''}👁 ${t.num(s.viewers)}${time ? ` · ⏱ ${time}` : ''}`
    })
    return {
      embeds: [{
        title: `🔥 ${t('top_title')}${d.category ? ` — ${d.category}` : ''}${d.language ? ` · ${t.language(d.language)}` : ''}`.slice(0, 256),
        description: lines.join('\n').slice(0, 4000), color: 0x9146ff,
      }],
      components: [row({
        type: 3, custom_id: 'top:pick', placeholder: t('top_pick'),
        options: list.map((s, n) => ({
          label: `${n + 1}. ${s.name}`.slice(0, 100), value: s.login,
          description: `${s.game ? `${s.game} · ` : ''}👁 ${t.num(s.viewers)}`.slice(0, 100),
        })),
      })],
    }
  }

  // ── /my-reports et /suggestions top ─────────────────────────────────────
  /** Peut-il ouvrir ce salon ? Droits du serveur puis du salon (rôles, puis
   *  le membre lui-même), comme Discord les calcule ; non si on ne sait pas. */
  function canView(f, member, channel) {
    const id = member?.user?.id
    if (!id || !channel) return false
    if (id === st.owner) return true
    const c = f?.channels?.find((x) => x.id === channel)
    if (!c || !f.roles) return false
    const mine = new Set(member.roles || [])
    let perms = 0n
    for (const r of f.roles) if (r.id === st.guild || mine.has(r.id)) perms |= BigInt(r.permissions || 0)
    if (perms & 8n) return true   // administrateur
    const ow = c.permission_overwrites || []
    const apply = (o) => { if (o) perms = (perms & ~BigInt(o.deny || 0)) | BigInt(o.allow || 0) }
    apply(ow.find((o) => o.id === st.guild))
    const roles = ow.filter((o) => Number(o.type) === 0 && mine.has(o.id))
    apply({ allow: roles.reduce((a, o) => a | BigInt(o.allow || 0), 0n), deny: roles.reduce((a, o) => a | BigInt(o.deny || 0), 0n) })
    apply(ow.find((o) => Number(o.type) === 1 && o.id === id))
    return Boolean(perms & 1024n)   // voir le salon
  }
  /** Le forum des retours est privé : son lien n'est donné qu'à qui peut l'ouvrir. */
  const forumVisible = async (i, user) => isAdmin(user.id)
    || (Boolean(st.guild && st.forum && i.guild_id === st.guild) && canView(await guildFacts(st.guild), i.member, st.forum))
  /** Liens d'un retour : sa carte publique (suggestion), son post du forum. */
  function reportLinks(t, x, seeForum) {
    const links = []
    if (x.card?.c && x.card?.m) links.push(`[${t('mr_card')}](${discordLink(x.card.c, x.card.m)})`)
    if (seeForum && x.thread) links.push(`[${t('mr_post')}](${discordLink(x.thread)})`)
    return links.length ? ` · ${links.join(' · ')}` : ''
  }

  // Chaque lecture parcourt tous les retours en D1 : réponses du Worker
  // gardées 60 s, celle de /suggestions top pour tous, celles de /my-reports
  // par membre. Un retour, une suggestion ou un vote d'un membre fait relire
  // les siennes (et /suggestions top) ; un changement d'état d'une
  // suggestion, /suggestions top ; une suppression ou un effacement
  // (/delete, /forget-user, corbeille), tout. Une lecture ratée n'est pas
  // gardée.
  const READ_TTL = 60_000
  const reads = new Map()   // « top » ou « mr:<membre> » → { at, value: promesse }
  function keptRead(key, load) {
    const now = Date.now()
    const hit = reads.get(key)
    if (hit && now - hit.at < READ_TTL) return hit.value
    if (reads.size > 5000) for (const [k, v] of reads) if (now - v.at >= READ_TTL) reads.delete(k)
    const value = load()
    reads.set(key, { at: now, value })
    value.catch(() => { if (reads.get(key)?.value === value) reads.delete(key) })
    return value
  }
  /** Après un envoi ou un vote de `who` : ses /my-reports relus, et
   *  /suggestions top avec `top`. */
  function readsChanged(who, top = true) {
    reads.delete(`mr:${who}`)
    if (top) reads.delete('top')
  }

  /** /my-reports : ce que la personne a envoyé depuis Discord — le sien seul,
   *  d'après l'interaction. */
  async function myReports(i, user) {
    const t = lang(i.locale)
    let r
    try { r = await keptRead(`mr:${user.id}`, () => call({ action: 'my-reports', du: user.id })) } catch (e) { return lookupError(t, e) }
    const items = Array.isArray(r?.items) ? r.items : []
    if (!items.length) return t('mr_none')
    const seeForum = await forumVisible(i, user)
    const lines = items.map((x) => `- **${md(x.title) || '—'}** — ${t(x.suggestion ? 'k_suggestion' : `k_${x.kind}`)} · <t:${sec(x.at)}:d> · `
      + `${x.merged ? t('mr_merged') : t(`s_${x.status}`)}${x.suggestion ? ` · 👍 ${t.num(x.votes)}` : ''}${reportLinks(t, x, seeForum)}`)
    return fit([t('mr_head'), ...lines], [...(r.more ? [`-# ${t('mr_more')}`] : []), `-# ${t('h_replies')}`])
  }

  /** /suggestions top : les 10 suggestions ouvertes les plus votées. */
  async function topSuggestions(i, user) {
    const t = lang(i.locale)
    let r
    try { r = await keptRead('top', () => call({ action: 'suggestions', du: user.id })) } catch (e) { return lookupError(t, e) }
    const items = Array.isArray(r?.items) ? r.items : []
    if (!items.length) return t('st_none')
    const seeForum = await forumVisible(i, user)
    return fit([t('st_head'), ...items.map((x, n) => `**${n + 1}.** 👍 ${t.num(x.votes)} — **${md(x.title) || '—'}** · ${t(`s_${x.status}`)}${reportLinks(t, x, seeForum)}`)])
  }

  // ── /suggest : suggestions publiques et votes ───────────────────────────
  // Une suggestion est un retour (Worker : forum, /stats, /my-reports,
  // réponses en message privé) avec une carte publique, en anglais, dans le
  // salon des suggestions (/setup ; à défaut, celui de la commande) : 👍 N
  // pour voter (un vote par membre, un second appui le retire ; compté par
  // le Worker), Planned / Done / Declined pour le développeur — l'état du
  // retour, donc l'étiquette de son post. Le Worker tient le délai entre
  // deux suggestions d'une personne et les plafonds du jour ; le bot retient
  // le dernier envoi pour refuser tout de suite, formulaire pas encore rempli.
  const SUGGEST_COOLDOWN = 10 * 60_000
  const suggested = new Map()   // personne → dernier envoi
  const votePace = new Map()    // personne → dernier vote (un toutes les 2 s)
  const CARD_STATUS = { new: 'Open', seen: 'Open', accepted: 'Planned', progress: 'In progress', done: 'Done', refused: 'Declined' }
  const CARD_COLORS = { accepted: 0x3b82f6, progress: 0x3b82f6, done: 0x2ecc71, refused: 0x6b7280 }
  let tagTriedAt = 0

  function suggestCommand(i, user) {
    const t = lang(i.locale)
    const last = suggested.get(user.id) || 0
    if (Date.now() - last < SUGGEST_COOLDOWN) return respond(i, 4, quiet(t('sg_wait', `<t:${sec(last + SUGGEST_COOLDOWN)}:R>`)))
    return respond(i, 9, {
      custom_id: 'suggest',
      title: t('sg_modal').slice(0, 45),
      components: [
        row(textInput('title', t('sg_title'), 1, { min: 5, max: 100, placeholder: t('sg_title_ph') })),
        row(textInput('text', t('sg_desc'), 2, { min: 10, max: 1500, placeholder: t('sg_desc_ph') })),
      ],
    })
  }

  /** Carte publique d'une suggestion. `s` : { title, text, author, avatar }
   *  pour une nouvelle, et { status, votes, open, merged } ; `base` : son
   *  encadré, quand elle est refaite (le texte reste le même). */
  function suggestionCard(key, s, base = null) {
    const status = s.status || 'new'
    const open = s.open ?? !['done', 'refused'].includes(status)
    const embed = base ? {
      title: base.title, description: base.description,
      ...(base.author?.name ? { author: { name: base.author.name, ...(base.author.icon_url ? { icon_url: base.author.icon_url } : {}) } } : {}),
      ...(base.timestamp ? { timestamp: base.timestamp } : {}),
    } : {
      title: `💡 ${s.title}`.slice(0, 256),
      // Écrit par un membre : ni lien masqué ni mention. La barre oblique
      // inverse aussi : « \[x\](adresse) » redevenait un lien masqué.
      description: String(s.text || '').replace(/[\\[\]<>]/g, '\\$&').slice(0, 4000),
      author: { name: `Suggestion from ${s.author}`.slice(0, 256), ...(s.avatar ? { icon_url: s.avatar } : {}) },
      timestamp: new Date().toISOString(),
    }
    const state = s.merged ? 'Merged into another suggestion' : `Status: ${CARD_STATUS[status] || status}`
    return {
      embeds: [{ ...embed, color: CARD_COLORS[status] || 0x9146ff, footer: { text: `${state} · ${open ? 'one vote per member — tap 👍 again to take yours back' : 'voting closed'}` } }],
      components: [row(
        { type: 2, style: open ? 1 : 2, label: String(Math.max(0, Number(s.votes) || 0)), emoji: { name: '👍' }, custom_id: `sv:${key}`, disabled: !open },
        button('Planned', `ss:${key}:accepted`), button('Done', `ss:${key}:done`, 3), button('Declined', `ss:${key}:refused`, 4),
      )],
      allowed_mentions: { parse: [] },
    }
  }
  /** Carte refaite (votes, état), son texte gardé. */
  const editCard = (channel, message, key, s) => (channel && message?.id
    ? rest('PATCH', `/channels/${channel}/messages/${message.id}`, suggestionCard(key, s, message.embeds?.[0] || {}))
      .catch((e) => log.warn(`Discord bridge: suggestion card not updated (${e.message})`))
    : Promise.resolve())
  /** Carte d'une suggestion qui n'est plus là : plus de boutons. */
  const retireCard = (channel, message) => (channel && message?.id
    ? rest('PATCH', `/channels/${channel}/messages/${message.id}`, { components: [] }).catch(() => {})
    : Promise.resolve())
  /** Suggestion supprimée, vue en appuyant sur sa carte : la carte perd ses
   *  boutons, et la corbeille est vidée tout de suite (la carte y attend
   *  peut-être : suppression faite dans /stats, sans post à prévenir). */
  async function cardGone(i) {
    await retireCard(i.channel_id, i.message)
    emptyTrash().catch((e) => log.warn(`Discord bridge: trash — ${e.message}`))
  }

  /** Carte relue (votes, état) après un changement venu d'ailleurs :
   *  étiquette du post, réponse rapide, /stats, fusion. */
  async function refreshCard(key) {
    reads.delete('top')
    const s = await call({ action: 'suggestion', key })
    if (!s?.card?.c || !s.card.m) return
    const m = await rest('GET', `/channels/${s.card.c}/messages/${s.card.m}`).catch(() => null)
    if (m) await editCard(s.card.c, m, key, s)
  }

  /** Formulaire de /suggest envoyé : le retour (Worker), sa carte publique,
   *  l'étiquette de son post, un message privé pour les réponses. */
  async function submitSuggestion(i, user) {
    const t = lang(i.locale)
    const title = field(i, 'title').replace(/\s+/g, ' ')
    const text = field(i, 'text')
    let r
    try {
      r = await call({ action: 'suggest', user: { id: user.id, name: user.global_name || user.username }, title, description: text })
    } catch (e) {
      const why = e.data?.reason
      const retryAt = Number(e.data?.retryAt) || Date.now() + SUGGEST_COOLDOWN
      if (why === 'cooldown') suggested.set(user.id, retryAt - SUGGEST_COOLDOWN)
      const head = why === 'cooldown' ? t('sg_wait', `<t:${sec(retryAt)}:R>`)
        : why === 'daily' ? t('sg_daily') : why === 'paused' ? t('sg_paused') : t('sg_failed', e.message)
      // Le formulaire est perdu : son texte, à recopier.
      return `${head}\n${t('sg_keep')}\n\`\`\`\n${`${title}\n\n${text}`.replace(/`/g, 'ˋ').slice(0, 1600)}\n\`\`\``
    }
    const now = Date.now()
    if (suggested.size > 5000) for (const [id, at] of suggested) if (now - at >= SUGGEST_COOLDOWN) suggested.delete(id)
    suggested.set(user.id, now)
    // Salon des suggestions (/setup) ; à défaut, celui de la commande, si la
    // personne peut y écrire (droits du salon, donnés par l'interaction) :
    // sinon le bot postait sa carte dans un salon en lecture seule (règles,
    // annonces).
    const own = BigInt(i.member?.permissions || 0) & ([10, 11, 12].includes(i.channel?.type) ? 1n << 38n : 1n << 11n)
    const channel = st.settings.suggestions || (own ? i.channel_id : null)
    const card = !channel ? null : await rest('POST', `/channels/${channel}/messages`, suggestionCard(r.key, {
      title, text, author: user.global_name || user.username || 'a member',
      avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : null, votes: 0,
    })).catch((e) => { log.warn(`Discord bridge: suggestion card not posted in ${channel} (${e.message})`); return null })
    if (card?.id) await call({ action: 'suggest-card', key: r.key, channel, message: card.id }).catch((e) => log.warn(`Discord bridge: suggestion card not saved (${e.message})`))
    readsChanged(user.id)   // carte comprise
    // Son post du forum (l'ordre des événements du post est gardé) : étiquette et lien.
    if (r.thread) {
      serial(r.thread, () => markSuggestion(r.thread, card?.id ? discordLink(channel, card.id) : null))
        .catch((e) => log.warn(`Discord bridge: suggestion post not tagged (${e.message})`))
    }
    const dm = await sendDm(user.id, `💡 Thanks for your suggestion “${title}”! Members can vote for it, and the developer’s replies will arrive here — answer with the buttons (text or screenshots).`, r.key)
      .then(() => true, () => false)
    return `${card?.id ? t('sg_sent', channel) : t('sg_sent_nocard')}${dm ? t('sg_dm') : t('sg_dm_off')}`
  }

  /** Post du forum d'une suggestion : l'étiquette « Suggestion » (créée si
   *  elle manque et si le bot en a le droit), son état gardé (« New » s'il
   *  n'en a pas encore), et le lien de sa carte. */
  async function markSuggestion(thread, link) {
    if (!st.suggestionTag && st.forum && Date.now() - tagTriedAt > 3600_000) {
      tagTriedAt = Date.now()
      await ensureTags(await rest('GET', `/channels/${st.forum}`).catch(() => null))
    }
    let cur = st.threads.get(thread)
    if (!cur) {
      const c = await rest('GET', `/channels/${thread}`).catch(() => null)
      cur = c?.applied_tags || []
      if (c?.parent_id === st.forum) st.threads.set(thread, cur)
    }
    const tag = st.suggestionTag
    if (tag && !cur.includes(tag)) {
      const next = [tag, ...cur]
      const fresh = st.tagOf.get('new')
      if (fresh && !cur.some((x) => st.stateOf.has(x))) next.push(fresh)
      const tags = next.slice(0, MAX_TAGS)
      st.expected.set(thread, tags)
      try {
        await rest('PATCH', `/channels/${thread}`, { applied_tags: tags })
        st.threads.set(thread, tags)
      } catch (e) {
        st.expected.delete(thread)
        log.warn(`Discord bridge: suggestion tag not set on post ${thread} (${e.message})`)
      }
    }
    if (link) await say(thread, `🗳️ Public card, where members vote: ${link}`)
  }

  /** 👍 N : le vote de la personne, posé ou retiré (Worker), la carte à jour
   *  et une réponse pour elle seule. Votes d'une carte l'un après l'autre :
   *  son compteur suit le dernier. */
  async function onVote(i, user, key) {
    const t = lang(i.locale)
    const now = Date.now()
    if (now - (votePace.get(user.id) || 0) < 2000) return respond(i, 4, quiet(t('v_wait')))
    if (votePace.size > 5000) for (const [id, at] of votePace) if (now - at >= 2000) votePace.delete(id)
    votePace.set(user.id, now)
    await respond(i, 6)
    const reply = (content) => rest('POST', `/webhooks/${st.app}/${i.token}`, quiet(content))
      .catch((e) => log.warn(`Discord bridge: vote answer not sent (${e.message})`))
    return serial(`card:${key}`, async () => {
      let r
      try {
        r = await call({ action: 'suggest-vote', key, du: user.id })
      } catch (e) {
        const why = e.data?.reason
        if (why === 'closed') await editCard(i.channel_id, i.message, key, e.data)
        if (why === 'gone') await cardGone(i)
        if (why === 'closed' || why === 'gone') readsChanged(user.id)
        return reply(why === 'closed' ? t('v_closed') : why === 'gone' ? t('v_gone') : why === 'busy' || why === 'daily' ? t('v_wait') : `❌ ${e.message}`)
      }
      readsChanged(user.id)
      await editCard(i.channel_id, i.message, key, r)
      return reply(t(r.voted ? 'v_added' : 'v_removed', t.num(r.votes)))
    })
  }

  /** Planned / Done / Declined (développeur) : l'état du retour, puis la
   *  carte, l'étiquette du post, la question du correctif et le message
   *  privé à l'auteur, comme pour une étiquette posée à la main. */
  async function onSuggestionStatus(i, user, key, status) {
    const t = lang(i.locale)
    if (!['accepted', 'done', 'refused'].includes(status)) return respond(i, 6)
    await respond(i, 6)
    const reply = (content) => rest('POST', `/webhooks/${st.app}/${i.token}`, quiet(content)).catch(() => {})
    return serial(`card:${key}`, async () => {
      let r
      try {
        r = await call({ action: 'suggest-status', key, status, by: byOf(user) })
      } catch (e) {
        if (e.data?.reason === 'gone') await cardGone(i)
        return reply(e.data?.reason === 'gone' ? t('v_gone') : `❌ ${e.message}`)
      }
      reads.delete('top')
      await editCard(i.channel_id, i.message, key, r)
      if (r.thread && !r.unchanged) {
        await serial(r.thread, async () => {
          remember(r.thread, r)
          await afterTeamUpdate(r.thread, r, r.prev, { card: false })
        }).catch((e) => log.warn(`Discord bridge: suggestion post not updated (${e.message})`))
      }
      return reply(t(r.unchanged ? 'ss_same' : 'ss_set', t(`s_${r.status}`)))
    })
  }

  // ── /app-announce : l'annonce des apps et du site, après un aperçu ──────
  // La même action que /announce et /stats (Worker : mêmes champs, durée de
  // 1 min à 30 jours, mêmes limites, journal d'audit) ; rien ne part sans
  // « Publish ». Aperçus gardés 15 min, en mémoire.
  const previews = new Map()   // identifiant → { title, message, link, hours, at, by }
  const PREVIEW_TTL = 15 * 60_000
  const DURATIONS = ['1h', '6h', '24h', '3d', '7d', '30d']

  /** « 30m », « 6h », « 3d » (« 2 j », « 1.5h »…) en heures — 24 sans rien ;
   *  null hors de 1 minute à 30 jours. */
  function parseHours(raw) {
    const s = String(raw ?? '').trim().toLowerCase().replace(',', '.')
    if (!s) return 24
    const m = s.match(/^(\d+(?:\.\d+)?)\s*(m|mins?|minutes?|h|hours?|d|days?|j|jours?)?$/)
    if (!m) return null
    const n = Number(m[1])
    const unit = (m[2] || 'h')[0]
    const hours = unit === 'm' ? n / 60 : unit === 'd' || unit === 'j' ? n * 24 : n
    return hours >= 1 / 60 - 1e-9 && hours <= 720 ? hours : null
  }

  function appAnnounce(i, user) {
    const t = lang(i.locale)
    const sub = i.data?.options?.[0]
    const arg = (name) => String(sub?.options?.find((o) => o.name === name)?.value ?? '').trim()
    if (sub?.name === 'clear') {
      return deferred(i, async () => { await call({ action: 'announce', clear: true, by: byOf(user) }); return t('aa_cleared') })
    }
    const message = arg('text').slice(0, 500)
    const title = arg('title').slice(0, 80)
    const link = arg('link').slice(0, 300)
    const hours = parseHours(arg('duration'))
    if (hours === null) return respond(i, 4, quiet(t('aa_bad_duration')))
    if (link && !/^https:\/\/[^\s]+$/i.test(link)) return respond(i, 4, quiet(t('aa_bad_link')))
    const now = Date.now()
    for (const [id, p] of previews) if (now - p.at > PREVIEW_TTL) previews.delete(id)
    const id = `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`
    previews.set(id, { title, message, link, hours, at: now, by: user.id })
    return deferred(i, async () => {
      // L'annonce en cours (route publique des apps), qu'elle remplacerait.
      const cur = (await readJson(`${worker}/api/announcement`))?.announcement
      const lines = [t('aa_preview', `<t:${sec(now + hours * 3600_000)}:f>`), ...(cur ? [t('aa_replaces', md(cur.title || cur.message))] : [])]
      return {
        content: lines.join('\n'),
        embeds: [{ ...(title ? { title } : {}), ...(message ? { description: message } : {}), color: 0x9146ff, ...(link ? { fields: [{ name: '🔗', value: link }] } : {}) }],
        components: [row(button(t('b_publish'), `aa:pub:${id}`, 3), button(t('b_cancel'), `aa:no:${id}`))],
      }
    })
  }

  /** Publish / Cancel de l'aperçu (développeur ; visible de lui seul). */
  async function onAnnouncePreview(i, user, choice, id) {
    const t = lang(i.locale)
    const p = previews.get(id)
    const none = { parse: [] }
    if (choice !== 'pub') {
      previews.delete(id)
      return respond(i, 7, { content: t('aa_cancelled'), embeds: [], components: [], allowed_mentions: none })
    }
    // Plus vieux que 15 min (il restait en mémoire jusqu'au /app-announce
    // suivant, et se publiait encore des heures après) ou d'un autre : expiré.
    if (!p || Date.now() - p.at > PREVIEW_TTL || p.by !== user.id) {
      return respond(i, 7, { content: t('aa_expired'), embeds: [], components: [], allowed_mentions: none })
    }
    previews.delete(id)   // un seul envoi, même sur un double appui
    await respond(i, 6)
    try {
      const r = await call({ action: 'announce', title: p.title, message: p.message, link: p.link, hours: p.hours, by: byOf(user) })
      await editOriginal(i, { content: t('aa_published', `<t:${sec(r.announcement.until)}:f>`), components: [], allowed_mentions: none })
    } catch (e) {
      previews.set(id, p)   // l'aperçu reste, pour réessayer
      await editOriginal(i, { content: `❌ ${e.message}`, components: i.message?.components || [], allowed_mentions: none })
    }
  }

  // ── Bienvenue (/setup use: Welcome) ─────────────────────────────────────
  // GUILD_MEMBER_ADD n'arrive qu'avec l'intent privilégié GUILD_MEMBERS, à
  // activer dans le portail : demandée seulement quand un salon de bienvenue
  // est choisi. Refusée par Discord (fermeture 4014), le bot se reconnecte
  // sans elle, coupe la bienvenue (welcomeBlocked, jusqu'au prochain /setup)
  // et prévient dans le salon d'alertes. Arrivées regroupées sur quelques
  // secondes (un message pour plusieurs, qui ne mentionne qu'eux) ; plus de
  // 10 en une minute (raid) : plus aucun message jusqu'à 10 min après la
  // dernière arrivée.
  const WELCOME_RAID = 10
  const welcome = { pending: [], timer: null, joins: [], quietUntil: 0 }
  const wantsMembers = () => Boolean(st.settings.welcome && !st.settings.welcomeBlocked)

  /** Nouvelle session (identification), pour demander GUILD_MEMBERS ou ne
   *  plus la demander. */
  function reidentify() {
    session = null
    seq = null
    if (ws) hangUp(ws)
  }

  /** 4014 avec GUILD_MEMBERS demandée : l'intent n'est pas activée. */
  function membersRefused() {
    st.settings = { ...st.settings, welcomeBlocked: true }
    log.warn('Discord bridge: Discord refused the Server Members intent — welcome messages turned off, reconnecting without it')
    saveSettings({ welcomeBlocked: true }).catch((e) => log.warn(`Discord bridge: welcome setting not saved (${e.message})`))
    alert('⚠️ **Welcome messages are off**: Discord refused the **Server Members Intent**, so I reconnected without it. Turn it on (developer portal → your application → Bot → Privileged Gateway Intents), then run `/setup use: Welcome messages for new members` again in the welcome channel.')
  }

  function onMemberJoin(d) {
    const u = d.user
    if (!u?.id || u.bot || !wantsMembers()) return
    const now = Date.now()
    welcome.joins = [...welcome.joins.filter((at) => now - at < 60_000), now]
    if (welcome.joins.length > WELCOME_RAID || now < welcome.quietUntil) {
      if (now >= welcome.quietUntil) alert(`🚨 **${welcome.joins.length} members joined within a minute** — no welcome messages until 10 minutes after the last arrival.`)
      welcome.quietUntil = now + 10 * 60_000
      welcome.pending = []
      clearTimeout(welcome.timer)
      welcome.timer = null
      return
    }
    welcome.pending.push(u.id)
    welcome.timer ??= setTimeout(() => flushWelcome().catch((e) => log.warn(`Discord bridge: welcome not posted (${e.message})`)), welcomeDelay)
  }

  async function flushWelcome() {
    const ids = [...new Set(welcome.pending)].slice(0, WELCOME_RAID)
    welcome.pending = []
    welcome.timer = null
    const channel = st.settings.welcome
    if (!ids.length || !channel || !wantsMembers() || Date.now() < welcome.quietUntil) return
    const who = ids.map((id) => `<@${id}>`)
    const names = who.length > 1 ? `${who.slice(0, -1).join(', ')} and ${who.at(-1)}` : who[0]
    const roles = offeredRoles().length > 0
    await rest('POST', `/channels/${channel}/messages`, {
      content: `👋 Welcome to the TwitchUnblock server, ${names}! TwitchUnblock lets you watch Twitch lives and VODs on iPhone, Apple TV, Android and the web. `
        + `**Download** shows how to install it${roles ? ', **Pick roles** lets you choose your roles' : ''} and **Help** lists what I can do.`,
      // Seuls les nouveaux venus sont mentionnés.
      allowed_mentions: { parse: [], users: ids },
      components: [row(
        { ...button('Download', 'wl:dl', 1), emoji: { name: '📥' } },
        ...(roles ? [{ ...button('Pick roles', 'wl:roles'), emoji: { name: '🏷️' } }] : []),
        { ...button('Help', 'wl:help'), emoji: { name: '📖' } },
      )],
    })
  }

  /** « Add to to-do » (menu d'un message) et /todo : une carte dans le salon
   *  des choses à faire, avec un bouton Done. Le message d'origine reçoit 📝 :
   *  la personne voit que son idée est notée. */
  async function addTodo(i, user) {
    const channel = st.settings.todo
    if (!channel) return 'Pick the to-do channel first: run /setup there with “To-do list”.'
    const by = `Added by ${user.global_name || user.username}`
    let embed
    if (i.data?.type === 3) {
      const m = i.data?.resolved?.messages?.[i.data?.target_id]
      if (!m) return '❌ Message not found.'
      const author = m.author || {}
      const link = `https://discord.com/channels/${i.guild_id}/${m.channel_id}/${m.id}`
      const text = String(m.content || '').trim() || String(m.embeds?.[0]?.description || '').trim()
      const files = (m.attachments || []).length
      embed = {
        title: 'Suggestion',
        description: `${(text || '(no text)').slice(0, 3500)}

[Original message](${link})`
          + (files ? ` · 📎 ${files} attachment${files > 1 ? 's' : ''}` : ''),
        color: 0x9146ff,
        author: {
          name: String(author.global_name || author.username || 'Unknown').slice(0, 100),
          ...(author.id && author.avatar ? { icon_url: `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png?size=64` } : {}),
        },
        footer: { text: by },
        timestamp: m.timestamp || new Date().toISOString(),
      }
      react(m.channel_id, m.id, '📝')
    } else {
      const text = String(opt(i, 'text') || '').trim()
      if (!text) return 'Nothing to add.'
      embed = { title: 'To-do', description: text.slice(0, 3500), color: 0x9146ff, footer: { text: by }, timestamp: new Date().toISOString() }
    }
    await rest('POST', `/channels/${channel}/messages`, {
      embeds: [embed], components: [row(button('Done', 'todo:done', 3))], allowed_mentions: { parse: [] },
    })
    todoSoon()
    return `📝 Added to <#${channel}>.`
  }

  /** Carte du salon à faire, rebâtie (Done : ✅ et vert ; Reopen : comme avant). */
  function todoCard(embed, done) {
    const title = String(embed?.title || 'To-do').replace(/^✅ /, '')
    return {
      title: done ? `✅ ${title}` : title,
      description: embed?.description || '',
      color: done ? 0x2ecc71 : 0x9146ff,
      ...(embed?.author?.name ? { author: { name: embed.author.name, ...(embed.author.icon_url ? { icon_url: embed.author.icon_url } : {}) } } : {}),
      ...(embed?.footer?.text ? { footer: { text: embed.footer.text } } : {}),
      ...(embed?.timestamp ? { timestamp: embed.timestamp } : {}),
    }
  }

  // ── Copie de la liste à faire dans le Worker (todo_mirror) ──────────────
  // Relue dans le salon (TODO_PAGES pages de 100 messages au plus) quelques
  // secondes après un ajout, un Done ou un Reopen (une fois pour une
  // rafale), à la connexion, puis toutes les 15 min (cartes supprimées ou
  // modifiées à la main). Écrite seulement quand elle a changé : son
  // empreinte reste ici (après un redémarrage, une écriture). Une relecture
  // à la fois ; une erreur attend la suivante sans rien gêner d'autre.
  const todoSync = { print: null, timer: null, running: null, again: false, failed: '' }

  async function writeTodoMirror() {
    const channel = st.settings.todo
    if (!channel || !st.me || !st.guild) return
    const open = []
    const done = []
    let before = ''
    let full = false
    for (let page = 0; page < TODO_PAGES; page++) {
      const list = await rest('GET', `/channels/${channel}/messages?limit=100${before ? `&before=${before}` : ''}`)
      if (!Array.isArray(list)) throw new Error('unexpected answer from Discord')
      for (const m of list) {
        const x = todoFromMessage(m, { me: st.me, guild: st.guild, channel })
        if (x) (x.done ? done : open).push(x)
      }
      full = list.length === 100
      if (!full) break
      before = list.at(-1).id
    }
    const mirror = fitTodoMirror({ at: new Date().toISOString(), channel, open, done, partial: full })
    const { at, ...content } = mirror
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(content)))
    const print = Buffer.from(digest).toString('hex')
    if (print === todoSync.print) return
    await kvSet(TODO_MIRROR_KEY, mirror)
    todoSync.print = print
  }

  /** Relit le salon et copie si besoin ; demandée pendant qu'une relecture
   *  tourne, elle est refaite juste après. Ne lève jamais d'erreur, et une
   *  même erreur n'est notée qu'une fois au journal. */
  function syncTodoMirror() {
    if (todoSync.running) { todoSync.again = true; return todoSync.running }
    todoSync.running = writeTodoMirror()
      .then(() => { todoSync.failed = '' })
      .catch((e) => {
        if (e.message !== todoSync.failed) log.warn(`Discord bridge: to-do copy not updated (${e.message})`)
        todoSync.failed = e.message
      })
      .finally(() => {
        todoSync.running = null
        if (todoSync.again && !stopped) { todoSync.again = false; syncTodoMirror() }
      })
    return todoSync.running
  }

  /** Relecture dans quelques secondes : une seule pour une rafale de Done,
   *  et la carte tout juste changée est alors à jour chez Discord. */
  function todoSoon(delay = 3000) {
    if (!st.settings.todo || stopped) return
    clearTimeout(todoSync.timer)
    todoSync.timer = setTimeout(syncTodoMirror, delay)
    todoSync.timer.unref?.()
  }

  const publishing = new Set()   // brouillons de notes en cours de publication
  async function onComponent(i, user) {
    const [kind, a, b] = String(i.data?.custom_id || '').split(':')
    // Boutons d'un message privé : « Reply » (texte seul) et « Send
    // screenshots » (captures, texte facultatif).
    if (kind === 'ur') {
      return respond(i, 9, {
        custom_id: `ureply:${a}`,
        title: 'Reply to the developer',
        components: [row(textInput('text', 'Your message', 2, { min: 1, max: 2000 }))],
      })
    }
    if (kind === 'us') {
      return respond(i, 9, {
        custom_id: `ushots:${a}`,
        title: 'Send screenshots to the developer',
        components: [
          labelled('Screenshots', fileUpload('pics'), `${PHOTO_TYPES} — up to ${MAX_PHOTOS}`),
          labelled('Message (optional)', { type: 4, custom_id: 'text', style: 2, required: false, max_length: 2000 }),
        ],
      })
    }
    if (kind === 'rp') return deferred(i, () => toggleReleaseRole(i, user))
    if (kind === 'roles') return onRolesMenu(i, user, a)
    // Menu de /top, vote d'une suggestion, boutons du message de bienvenue
    // (les réponses de /download, /roles et /help, pour soi seul).
    if (kind === 'top') return liveCommand(i, user, i.data?.values?.[0])
    if (kind === 'sv') return onVote(i, user, a)
    if (kind === 'wl') {
      if (a === 'dl') return downloadCommand(i, user)
      if (a === 'roles') return rolesCommand(i, user)
      return respond(i, 4, { flags: 64, content: helpText(i, user), allowed_mentions: { parse: [] } })
    }
    if (!isAdmin(user.id)) return adminOnly(i)
    const thread = i.channel_id
    switch (kind) {
      case 'ss': return onSuggestionStatus(i, user, a, b)
      case 'aa': return onAnnouncePreview(i, user, a, b)
      case 'todo': {
        const done = a === 'done'
        await respond(i, 7, {
          embeds: [todoCard(i.message?.embeds?.[0], done)],
          components: [row(done ? button('Reopen', 'todo:open') : button('Done', 'todo:done', 3))],
        })
        todoSoon()
        return
      }
      case 'qr': {
        const q = QUICK[Number(a)]
        if (!q) return
        await respond(i, 6)
        try {
          const prev = (await stateOf(thread))?.status
          const r = await call({ action: 'reply', thread, message: q.text, ...(q.status ? { status: q.status } : {}), by: byOf(user) })
          remember(thread, r)
          await editOriginal(i, { content: `${i.message?.content || ''}\n✅ Sent: “${q.label}”`.slice(0, 1900), components: i.message?.components })
          await afterTeamUpdate(thread, r, prev)
        } catch (e) {
          await say(thread, `❌ Reply not sent: ${e.message}`)
        }
        return
      }
      case 'fx': {
        await respond(i, 6)
        try {
          await call({ action: 'fix', thread, platform: a, by: byOf(user) })
          const where = { ios: 'the app', web: 'the website', both: 'the app and the website', tvos: 'the Apple TV app', android: 'the Android app' }[a]
          await editOriginal(i, { content: where ? `✅ I’ll tell the user when the fix is live in ${where}.` : 'OK, I won’t tell the user.', components: [] })
        } catch (e) {
          await editOriginal(i, { content: `❌ ${e.message}`, components: [] })
        }
        return
      }
      case 'del': {
        if (a !== 'yes') return respond(i, 7, { content: 'Cancelled.', components: [] })
        await respond(i, 6)
        let r
        try {
          r = await call({ action: 'delete', thread, by: byOf(user) })
        } catch (e) {
          await editOriginal(i, { content: `❌ ${e.message}`, components: [] })
          return
        }
        forget(thread)
        reads.clear()
        // Carte publique d'une suggestion : dans la corbeille du Worker, vidée tout de suite.
        if (r?.card) emptyTrash().catch((e) => log.warn(`Discord bridge: trash — ${e.message}`))
        await editOriginal(i, { content: 'Deleted.', components: [] })
        try {
          await rest('DELETE', `/channels/${thread}`)
        } catch (e) {
          await rest('PATCH', `/channels/${thread}`, { archived: true, locked: true }).catch(() => {})
          await editOriginal(i, { content: `Report deleted, but this post couldn’t be (${e.message}): it’s closed instead — delete it by hand.`, components: [] })
        }
        return
      }
      case 'rel': {
        const head = String(i.message?.content || '').split('\n')[0]
        if (a === 'del') {
          await kvSet(`draft_${b}`, null, 60).catch(() => {})
          call({ action: 'audit', what: 'release.discard', detail: b, by: byOf(user) }).catch(() => {})
          return respond(i, 7, { content: `${head}\n🗑️ Discarded.`, components: [] })
        }
        const channel = st.settings.announcements
        if (!channel) return respond(i, 4, { flags: 64, content: 'Pick the announcements channel first: run /setup there with “Release announcements”.' })
        if (publishing.has(b)) return respond(i, 4, { flags: 64, content: 'Already being published.' })
        publishing.add(b)
        await respond(i, 6)
        try {
          const draft = await kvGet(`draft_${b}`).catch(() => null)
          if (!draft?.text) return editOriginal(i, { content: `${head}\n❌ This draft expired.`, components: [] })
          const role = st.settings.announcementsRole
          await sendChunks(channel, (role ? `<@&${role}> ` : '') + draft.text,
            { allowed_mentions: role ? { parse: [], roles: [role] } : { parse: [] } })
          await kvSet(`draft_${b}`, null, 60).catch(() => {})
          call({ action: 'audit', what: 'release.publish', detail: b, by: byOf(user) }).catch(() => {})
          await editOriginal(i, { content: `${head}\n✅ Published in <#${channel}>.`, components: [] })
        } catch (e) {
          await editOriginal(i, { content: `${head}\n❌ Not published: ${e.message}`, components: i.message?.components })
        } finally {
          publishing.delete(b)
        }
        return
      }
      case 'fg': return forgetConfirm(i, user, a, b)
    }
  }

  async function onModal(i, user) {
    const [kind, a] = String(i.data?.custom_id || '').split(':')
    if (kind === 'suggest') return deferred(i, () => submitSuggestion(i, user))
    if (kind === 'report') {
      return deferred(i, async () => {
        const what = a === 'idea' ? 'idea' : 'report'
        // Capture de l'option de la commande : téléchargée maintenant (son
        // lien expire), rangée par le Worker avec le retour.
        const photos = await photosOf(takeShot(user), { reduce: true })
        const r = await call({
          action: 'create', kind: a === 'idea' ? 'idea' : 'bug',
          message: field(i, 'text'), where: field(i, 'where'), photos: photos.ok,
          user: { id: user.id, name: user.global_name || user.username },
        })
        readsChanged(user.id, false)   // son /my-reports
        const dm = await sendDm(user.id, `👋 Thanks for your ${what}! It was sent to the developer — their replies will arrive here, and you can answer with the buttons (text or screenshots).`, r.key)
          .then(() => true, () => false)
        return `Thanks! Your ${what} was sent to the developer.` + (dm
          ? ' Replies will come in a direct message.'
          : ' I couldn’t send you a direct message: allow DMs from this server’s members (Privacy settings) to get the replies.')
          + skippedNote(photos.skipped) + unsavedNote(photos.ok.length, r)
      })
    }
    if (kind === 'ureply') {
      return deferred(i, async () => {
        await call({ action: 'userReply', key: a, du: user.id, message: field(i, 'text') })
        return 'Sent! The developer will see it.'
      })
    }
    if (kind === 'ushots') {
      return deferred(i, async () => {
        const text = field(i, 'text')
        const photos = await photosOf(uploads(i, 'pics'), { reduce: true })
        if (!text && !photos.ok.length) {
          return photos.skipped ? `❌ Nothing sent: the file was too big, or not a ${PHOTO_TYPES} image.` : '❌ Attach a screenshot (or use “Reply” to write a message).'
        }
        const r = await call({ action: 'userReply', key: a, du: user.id, message: text, photos: photos.ok })
        return 'Sent! The developer will see it.' + skippedNote(photos.skipped) + unsavedNote(photos.ok.length, r)
      })
    }
    if (kind === 'announce') {
      if (!isAdmin(user.id)) return adminOnly(i)
      return deferred(i, async () => {
        const r = await call({
          action: 'announce', title: field(i, 'title'), message: field(i, 'message'),
          link: field(i, 'link'), hours: Number(field(i, 'hours')) || 24, by: byOf(user),
        })
        return `Announcement live in the app and on the website until <t:${Math.floor(r.announcement.until / 1000)}:f>.`
      })
    }
    if (kind === 'poll') {
      if (!isAdmin(user.id)) return adminOnly(i)
      return deferred(i, async () => {
        const r = await call({
          action: 'poll', question: field(i, 'question'), options: field(i, 'options'),
          multi: /^(y|yes|o|oui|1|true)$/i.test(String(field(i, 'multi') || '').trim()),
          hours: Number(field(i, 'hours')) || 24, by: byOf(user),
        })
        return `Poll live in the app and on the website until <t:${Math.floor(r.poll.until / 1000)}:f>: “${r.poll.question}” (${r.poll.options.length} choices${r.poll.multi ? ', several per person' : ', one per person'}). Its results will be posted in the alerts channel when it ends, or with /poll-end.`
      })
    }
  }

  /** Résultats d'un sondage fini, une fois : dans le salon d'alertes, avec
   *  « Publish » vers le salon des annonces, comme les notes de version. Un
   *  à la fois : /poll-end et le passage des 10 min, au même moment, les
   *  postaient deux fois. `poll_done` : les derniers sondages postés (le
   *  dernier seul, avant ; une lecture ratée abandonne, sans doublon). */
  function postPollResults(poll, results) {
    return serial('poll-results', () => postPollResultsOnce(poll, results))
  }
  async function postPollResultsOnce(poll, results) {
    if (!poll) return
    const done = await kvGet('poll_done')
    const ids = Array.isArray(done) ? done : done ? [done] : []
    if (ids.includes(poll.id)) return
    await kvSet('poll_done', [...ids, poll.id].slice(-20), 30 * 86400)
    const voters = results?.voters || 0
    const lines = poll.options.map((o, n) => {
      const c = results?.counts?.[n] || 0
      return `- ${o} — **${voters ? Math.round((c / voters) * 100) : 0}%** (${c})`
    })
    const text = `📊 **Poll results — ${poll.question}**\n${lines.join('\n')}\n\n${voters} ${voters === 1 ? 'voter' : 'voters'}${poll.multi ? ' · several choices per person' : ''}`
    if (!st.settings.alerts) { log.log(`Discord bridge: poll ${poll.id} ended (no /setup alerts channel for its results)`); return }
    const id = `poll-${poll.id}`.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 50)
    await kvSet(`draft_${id}`, { text }, 30 * 86400)
    await sendChunks(st.settings.alerts, text)
    const where = st.settings.announcements ? `<#${st.settings.announcements}>` : 'the announcements channel (pick it with /setup)'
    await say(st.settings.alerts, `📝 **Poll results draft**\n“Publish” posts the text above in ${where}.`, {
      components: [row(button('Publish', `rel:pub:${id}`, 3), button('Discard', `rel:del:${id}`, 4))],
    })
  }

  /** Sondage arrivé au bout de sa durée : ses résultats (toutes les 10 min).
   *  D'abord ceux du précédent, fini puis remplacé avant ce passage
   *  (`previous`, Worker à jour) : un sondage lancé moins de 10 min après la
   *  fin de l'autre, sans /poll-end, les faisait perdre. */
  async function checkPoll() {
    const r = await call({ action: 'poll-state' })
    if (r?.previous?.poll) await postPollResults(r.previous.poll, r.previous.results)
    if (r?.poll?.ended) await postPollResults(r.poll, r.results)
  }

  // ── Surveillance ────────────────────────────────────────────────────────
  async function alert(text) {
    if (st.settings.alerts) await sendChunks(st.settings.alerts, text).catch((e) => log.warn(`Discord bridge: alert not posted (${e.message})`))
    else log.warn(`Discord bridge alert (no /setup alerts channel): ${text}`)
  }

  /** Workers (principal et secours), ntfy, webhook : prévenu à la panne,
   *  puis au retour. */
  async function watchHealth() {
    // État gardé en mémoire : relu dans le Worker lui-même, il revenait vide
    // pendant sa panne — l'alerte repartait toutes les 5 min, et le retour
    // n'était jamais annoncé. La copie du Worker ne sert qu'après un redémarrage.
    if (!st.alerts) st.alerts = (await kvGet('alerts').catch(() => null)) || null
    const prev = st.alerts || {}
    const next = { ...prev }
    // La racine répond sans base de données (un Worker de secours n'en a
    // pas : /api/push/key y vaut 503) et passe en 429 au quota du jour.
    const probe = async (base) => {
      try {
        const r = await fetch(`${base}/`, { signal: AbortSignal.timeout(15_000) })
        return r.ok ? null : `HTTP ${r.status}${r.status === 429 ? ' — daily request quota reached?' : ''}`
      } catch {
        return 'unreachable'
      }
    }
    const checks = [['w:main', 'Main Worker', worker], ...fallbacks.map((f, n) => [`w:fb${n}`, 'Fallback Worker', f])]
    for (const [id, name, base] of checks) {
      const problem = await probe(base)
      if (problem && !prev[id]) { await alert(`⚠️ **${name} failing**: ${problem}\n<${base}>`); next[id] = Date.now() }
      if (!problem && prev[id]) { await alert(`✅ **${name} is back** after ${Math.max(1, Math.round((Date.now() - prev[id]) / 60000))} min.`); next[id] = 0 }
    }
    const h = await call({ action: 'health' }).catch(() => null)
    if (h) {
      const until = h.ntfy?.until || 0
      if (until && !prev.ntfy) {
        await alert(`⚠️ **ntfy notifications paused** until <t:${Math.floor(until / 1000)}:t> (${h.ntfy.code === 42908 ? 'daily quota reached' : `429${h.ntfy.code ? `, code ${h.ntfy.code}` : ''}`}).`)
        next.ntfy = until
      }
      if (!until && prev.ntfy) { await alert('✅ **ntfy notifications are going out again.**'); next.ntfy = 0 }
      const hook = h.webhook
      if (hook && hook.ok === false && !['missing'].includes(hook.detail) && hook.at && hook.at !== prev.hookAt) {
        await alert(`⚠️ **Discord webhook delivery failed**: HTTP ${hook.status || '—'}${hook.detail ? ` — ${hook.detail}` : ''}`)
        next.hookAt = hook.at
      }
    }
    st.alerts = next
    if (JSON.stringify(next) !== JSON.stringify(prev)) await kvSet('alerts', next).catch(() => {})
  }

  /** CI de l'app et du site : un échec, une alerte (une seule fois). Mémoire
   *  illisible (Worker injoignable) : passage abandonné — prise pour un
   *  premier passage, elle refaisait l'alerte des échecs déjà signalés. */
  async function watchActions() {
    const stored = await kvGet('runs')
    const seen = stored || { since: Date.now() - 15 * 60_000, ids: [] }
    let changed = false
    for (const [name, repo] of [['iOS app', repos.ios], ['Website', repos.web]]) {
      const data = await gh(`/repos/${repo}/actions/runs?per_page=15&status=completed`)
      for (const run of data?.workflow_runs || []) {
        if (run.conclusion !== 'failure' || seen.ids.includes(run.id) || Date.parse(run.updated_at) < seen.since) continue
        await alert(`❌ **${name} — “${run.name}” failed** on \`${run.head_branch}\` (\`${String(run.head_sha).slice(0, 7)}\`)\n<${run.html_url}>`)
        seen.ids.push(run.id)
        changed = true
      }
    }
    if (changed) { seen.ids = seen.ids.slice(-100); await kvSet('runs', seen) }
    else if (!stored) await kvSet('runs', seen)
  }

  async function siteVersion() {
    const src = await fetchText(`${site}/assets/js/usage.js?ts=${Date.now()}`)
    return src?.match(/SITE_VERSION = '([^']+)'/)?.[1] || null
  }

  /** Brouillon des notes de version dans le salon privé ; « Publish » le
   *  poste dans le salon des annonces. */
  async function draftRelease(kind, v, rel) {
    let text
    if (kind === 'ios') {
      const items = bullets(rel?.body)
      text = `**TwitchUnblock ${v} — iOS app**\n${items.join('\n') || '- Improvements and fixes'}\n\nUpdate from your source (Feather, SideStore, AltStore…) or download the IPA: <${rel.html_url}>`
    } else {
      const src = await fetchText(`${site}/assets/js/changelog.js?ts=${Date.now()}`)
      const items = src ? changelogItems(src, v) : []
      text = `**TwitchUnblock website — ${v}**\n${items.map((x) => `- ${x}`).join('\n') || '- Improvements and fixes'}\n\n<${site}>`
    }
    if (!st.settings.alerts) { log.log(`Discord bridge: new ${kind} version ${v} (no /setup alerts channel for its draft)`); return }
    const id = `${kind}-${v}`.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 50)
    await kvSet(`draft_${id}`, { text }, 30 * 86400)
    await sendChunks(st.settings.alerts, text)
    const where = st.settings.announcements ? `<#${st.settings.announcements}>` : 'the announcements channel (pick it with /setup)'
    await say(st.settings.alerts, `📝 **Release notes draft — ${kind === 'ios' ? 'iOS app' : 'website'} ${v}**\n“Publish” posts the text above in ${where}.`, {
      components: [row(button('Publish', `rel:pub:${id}`, 3), button('Discard', `rel:del:${id}`, 4))],
    })
  }

  async function postTestBuild(rel) {
    const channel = st.settings.testers
    if (!channel) return
    const role = st.settings.testersRole
    const tv = /^tv-test-/.test(rel.tag_name || '')
    const items = bullets(rel.body).slice(0, 12)
    // Apple TV : sa source (apps-tv.json, à côté de celle de test) pour
    // ATVLoadly, qui se met alors à jour seul.
    const how = tv
      ? `Apple TV build: add the source <${testSource.replace(/apps-test\.json$/, 'apps-tv.json')}> in ATVLoadly for automatic updates, or install it with Xcode (see the README): <${rel.html_url}>`
      : `Install it from the test source <${testSource}>, or download the IPA: <${rel.html_url}>`
    await sendChunks(channel, `${role ? `<@&${role}> ` : ''}🧪 **New test build: ${rel.name}**\n${items.join('\n')}\n\n${how}`,
      { allowed_mentions: role ? { parse: [], roles: [role] } : { parse: [] } })
  }

  /** Sorties : app (GitHub, versions stables et de test) et site (version
   *  en ligne). Nouvelle version stable : brouillon des notes, et le Worker
   *  prévient les retours qui l'attendaient. La première fois, on retient.
   *  Mémoire illisible (Worker injoignable) : passage abandonné — prise
   *  pour un premier passage, les sorties parues entre-temps étaient notées
   *  sans brouillon ni annonce aux testeurs. */
  async function watchReleases() {
    const seen = (await kvGet('seen')) || {}
    const next = { ...seen }
    const rels = await gh(`/repos/${repos.ios}/releases?per_page=50`)
    if (Array.isArray(rels)) {
      // La plus récemment publiée de chaque sorte : l'API ne les trie pas par
      // date (tv-test-10 arrivait après tv-test-6, et n'était jamais annoncée).
      const latest = (keep) => rels.filter(keep)
        .sort((a, b) => Date.parse(b.published_at || b.created_at || 0) - Date.parse(a.published_at || a.created_at || 0))[0]
      const stable = latest((r) => !r.prerelease && !r.draft && /^TwitchUnblock \d/.test(r.name || ''))
      const test = latest((r) => r.prerelease && /^test-/.test(r.tag_name || ''))
      const tv = latest((r) => r.prerelease && /^tv-test-/.test(r.tag_name || ''))
      if (stable) {
        const v = stable.name.replace(/^TwitchUnblock\s+/, '').trim()
        if (!seen.ios || compareVersions(v, seen.ios) > 0) {
          if (seen.ios) await draftRelease('ios', v, stable)
          next.ios = v
        }
      }
      const num = (tag) => Number(String(tag || '').match(/(\d+)$/)?.[1]) || 0
      if (test && num(test.tag_name) > num(seen.iosTest)) { if (seen.iosTest) await postTestBuild(test); next.iosTest = test.tag_name }
      if (tv && num(tv.tag_name) > num(seen.tvTest)) { if (seen.tvTest) await postTestBuild(tv); next.tvTest = tv.tag_name }
      // App Apple TV stable (« TwitchUnblock TV 0.1.N ») : retenue pour
      // prévenir les retours qui attendaient son correctif, sans brouillon.
      const tvStable = latest((r) => !r.prerelease && !r.draft && /^TwitchUnblock TV \d/.test(r.name || ''))
      const tvos = tvStable?.name.replace(/^TwitchUnblock TV\s+/, '').trim()
      if (tvos && (!seen.tvos || compareVersions(tvos, seen.tvos) > 0)) next.tvos = tvos
    }
    // App Android (son dépôt), version stable « TwitchUnblock X.Y.N » : pareil.
    const apks = repos.android ? await gh(`/repos/${repos.android}/releases?per_page=20`) : null
    if (Array.isArray(apks)) {
      const stable = apks.filter((r) => !r.prerelease && !r.draft && /^TwitchUnblock \d/.test(r.name || ''))
        .sort((a, b) => Date.parse(b.published_at || b.created_at || 0) - Date.parse(a.published_at || a.created_at || 0))[0]
      const android = stable?.name.replace(/^TwitchUnblock\s+/, '').trim()
      if (android && (!seen.android || compareVersions(android, seen.android) > 0)) next.android = android
    }
    const web = await siteVersion()
    if (web && (!seen.web || compareVersions(web, seen.web) > 0)) {
      if (seen.web) await draftRelease('web', web)
      next.web = web
    }
    if (JSON.stringify(next) !== JSON.stringify(seen)) await kvSet('seen', next)
    if (next.ios || next.web || next.tvos || next.android) {
      const r = await call({ action: 'released', ios: next.ios, web: next.web, tvos: next.tvos, android: next.android }).catch(() => null)
      if (r?.notified) log.log(`Discord bridge: ${r.notified} user(s) told their fix is live`)
    }
  }

  /** Posts « Done » ou « Declined » sans activité depuis un jour :
   *  archivés (une réponse de la personne les rouvre). */
  async function tidy() {
    if (!st.guild || !st.forum) return
    const data = await rest('GET', `/guilds/${st.guild}/threads/active`).catch(() => null)
    const now = Date.now()
    for (const th of data?.threads || []) {
      if (th.parent_id !== st.forum) continue
      const status = (th.applied_tags || []).map((t) => st.stateOf.get(t)).find(Boolean)
      if (status !== 'done' && status !== 'refused') continue
      if (now - snowflakeTime(th.last_message_id || th.id) < 24 * 3600_000) continue
      await rest('PATCH', `/channels/${th.id}`, { archived: true }).catch((e) => log.warn(`Discord bridge: post ${th.id} not archived (${e.message})`))
    }
  }

  /** Résumé du jour : retours à traiter, fréquentation de la veille,
   *  notifications, versions. */
  async function postSummary(channel) {
    if (!channel) return false
    const [fb, statsText, seen] = await Promise.all([
      call({ action: 'summary' }).catch(() => null),
      fetchText(`${worker}/api/stats`),
      kvGet('seen').catch(() => null),
    ])
    let stats = null
    try { stats = statsText ? JSON.parse(statsText) : null } catch {}
    const lines = [`☀️ **Daily summary** — <t:${Math.floor(Date.now() / 1000)}:D>`]
    if (fb) {
      lines.push(`**Reports**: ${fb.awaitingCount} awaiting your reply · ${fb.new24h} new in 24 h · ${fb.open} open`)
      for (const a of fb.awaiting.slice(0, 8)) {
        lines.push(`• ${a.thread ? `<#${a.thread}>` : `\`${a.key}\``} “${a.excerpt}” — waiting since <t:${Math.floor(a.since / 1000)}:R>`)
      }
    }
    if (stats) {
      const y = new Date(Date.now() - 86400_000).toISOString().slice(0, 10)
      const act = stats.activeDaily?.find((d) => d.date === y)
      const nw = stats.daily?.find((d) => d.date === y)
      const pu = stats.push?.daily?.find((d) => d.date === y)
      const fresh = nw ? (nw.newIos || 0) + (nw.newWeb || 0) + (nw.newTv || 0) + (nw.newAndroid || 0) : 0
      if (act) lines.push(`**Users yesterday**: ${act.total} active (iOS ${act.ios} · web ${act.web} · Apple TV ${act.tvos || 0} · Android ${act.android || 0})${nw ? ` · ${fresh} new` : ''}`)
      if (pu) lines.push(`**Live notifications sent yesterday**: ${(pu.ok_web || 0) + (pu.ok_ntfy || 0)} (web ${pu.ok_web || 0} · ntfy ${pu.ok_ntfy || 0})`)
    }
    if (seen) {
      lines.push(`**Versions**: app ${seen.ios || '?'} · website ${seen.web || '?'}${seen.tvos ? ` · Apple TV ${seen.tvos}` : ''}`
        + `${seen.android ? ` · Android ${seen.android}` : ''}${seen.iosTest ? ` · latest test build ${seen.iosTest}` : ''}`)
    }
    if (lines.length === 1) return false
    await sendChunks(channel, lines.join('\n'))
    return true
  }

  function localTime(d = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: summaryTz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d)
    const get = (t) => parts.find((p) => p.type === t)?.value
    return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) }
  }

  async function summaryClock() {
    const now = localTime()
    if (now.hour !== summaryHour || st.summaryDay === now.day || !st.settings.alerts) return
    st.summaryDay = now.day
    if ((await kvGet('summary_day').catch(() => null)) === now.day) return
    await kvSet('summary_day', now.day)
    await postSummary(st.settings.alerts)
  }

  /** Posts des retours supprimés dans /stats (liste `trash` écrite par le
   *  Worker, qui ne peut pas les supprimer lui-même), et cartes publiques des
   *  suggestions supprimées ou effacées (« card:<salon>:<message>:<suggestion> ») :
   *  supprimés ici, au mot du Worker et toutes les 10 min. Rend ceux qui sont partis. */
  async function emptyTrash() {
    if (!st.forum) return []
    const list = await kvGet('trash').catch(() => null)
    if (!Array.isArray(list) || !list.length) return []
    const done = []
    for (const t of list.slice(0, 50)) {
      const id = String(t)
      const card = /^card:(\d{5,25}):(\d{5,25}):(fb_[a-z0-9]+_[0-9a-f]+)$/.exec(id)
      if (card) {
        if (await trashCard(card[1], card[2], card[3])) done.push(t)
        continue
      }
      if (!/^\d{5,25}$/.test(id)) { done.push(t); continue }
      try {
        // Seulement un post du forum des retours : tout autre salon ou fil
        // que le bot peut gérer, mis dans la liste, était supprimé.
        const parent = st.threads.has(id) ? st.forum : (await rest('GET', `/channels/${id}`))?.parent_id || null
        if (parent !== st.forum) {
          log.warn(`Discord bridge: ${id} isn’t a post of the reports forum — not deleted`)
          done.push(t)
          continue
        }
        await rest('DELETE', `/channels/${id}`)
      } catch (e) {
        // Déjà supprimé (10003) : rien à faire ; autre refus : retenté plus tard.
        if (e.code !== 10003) { log.warn(`Discord bridge: post ${id} not deleted (${e.message})`); continue }
      }
      forget(id)
      done.push(t)
    }
    if (done.length) {
      reads.clear()   // /my-reports et /suggestions top gardés : sans ce qui est parti
      // Retirés sur place par le Worker : relue puis réécrite ici, la liste
      // perdait un post qu'il y ajoutait entre les deux. Worker d'avant
      // (action inconnue : 400), comme avant. Pas mise à jour : ces posts,
      // déjà partis (10003), en sortiront au passage suivant.
      await call({ action: 'trash-done', ids: done.map(String) }).catch(async (e) => {
        if (e.status !== 400) throw e
        const now = (await kvGet('trash').catch(() => null)) || []
        await kvSet('trash', now.filter((t) => !done.includes(t)), 7 * 86400)
      }).catch((e) => log.warn(`Discord bridge: trash list not updated (${e.message})`))
      log.log(`Discord bridge: ${done.length} post(s) or suggestion card(s) of deleted reports removed`)
    }
    return done
  }

  /** Carte d'une suggestion supprimée (corbeille) : supprimée seulement si
   *  c'est bien une carte de suggestion postée par le bot — celle de cette
   *  suggestion (son bouton 👍), ou une carte déjà retirée (sans boutons).
   *  Sans cette vérification, tout message que le bot peut supprimer, mis
   *  dans la liste, partirait. Vrai quand elle n'est plus à traiter ; faux :
   *  retentée plus tard. */
  async function trashCard(channel, message, key) {
    if (!st.me) return false   // pas encore connecté : auteur invérifiable
    try {
      const m = await rest('GET', `/channels/${channel}/messages/${message}`)
      const buttons = (m?.components || []).flatMap((r) => r.components || [])
      const ours = m?.author?.id === st.me && /^Suggestion from /.test(String(m.embeds?.[0]?.author?.name || ''))
        && (buttons.some((b) => b.custom_id === `sv:${key}`) || !buttons.length)
      if (!ours) {
        log.warn(`Discord bridge: message ${message} isn’t the card of this suggestion — not deleted`)
        return true
      }
      await rest('DELETE', `/channels/${channel}/messages/${message}`)
    } catch (e) {
      // Déjà supprimée (message ou salon inconnu) : rien à faire ; autre refus : retentée plus tard.
      if (e.code !== 10008 && e.code !== 10003) { log.warn(`Discord bridge: suggestion card ${message} not deleted (${e.message})`); return false }
    }
    return true
  }

  async function heartbeat() {
    emptyTrash().catch((e) => log.warn(`Discord bridge: trash — ${e.message}`))
    // Worker plus ancien (sans sondages ni modèles) : refus attendu, rien à signaler.
    checkPoll().catch(() => {})
    refreshTemplates().catch(() => {})
    const c = await call({ action: 'config' })
    if (c.forum !== st.forum || c.guild !== st.guild) {
      log.log(`Discord bridge: the webhook moved to channel ${c.forum}`)
      const newGuild = c.guild !== st.guild
      Object.assign(st, { forum: c.forum, guild: c.guild, labels: c.labels || st.labels })
      if (newGuild) {
        const g = await rest('GET', `/guilds/${c.guild}`).catch(() => null)
        st.owner = g?.owner_id || null
        await registerCommands()
      }
      st.threads.clear()
      st.parents.clear()
      st.states.clear()
      const forum = await rest('GET', `/channels/${c.forum}`).catch(() => null)
      st.forumType = forum?.type ?? null
      await ensureTags(forum)
    }
    // Retours dont l'envoi a raté (Discord injoignable…) : rattrapés.
    backfill()
  }

  async function registerCommands() {
    if (!st.app || !st.guild) return
    try {
      await rest('PUT', `/applications/${st.app}/guilds/${st.guild}/commands`, COMMANDS)
      log.log(`Discord bridge: ${COMMANDS.length} slash commands ready`)
    } catch (e) {
      log.warn(`Discord bridge: slash commands not registered (${e.message}) — invite the bot again with the applications.commands scope (README)`)
    }
  }

  // ── Exploitation : pics, base, tâche planifiée, quotas, versions ───────
  // Une alerte par mesure et par jour (UTC) au plus : mémoire `ops_alerts`
  // gardée par le Worker (un redémarrage ne les refait pas), avec l'état de
  // la tâche planifiée (muette depuis…).
  const num = (n) => Number(n || 0).toLocaleString('en-US')
  const pct = (n, max) => (max > 0 ? Math.round((Number(n || 0) / max) * 100) : 0)
  const mb = (bytes) => `${(Number(bytes || 0) / 1048576).toFixed(1)} MB`
  const ago = (ms) => `<t:${Math.floor(ms / 1000)}:R>`
  function dur(ms) {
    const m = Math.floor(Math.max(0, ms) / 60_000)
    if (m < 1) return `${Math.round(Math.max(0, ms) / 1000)} s`
    if (m < 60) return `${m} min`
    const h = Math.floor(m / 60)
    return h < 48 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`
  }
  let opsMemo = null
  let opsLoad = null   // lecture de la mémoire, une seule, attendue par tous
  async function opsAlerts() {
    const day = new Date().toISOString().slice(0, 10)
    // watchOps et watchQuotas partent ensemble au démarrage : chacun lisait
    // la mémoire et posait sa propre copie, l'alerte notée par l'un était
    // perdue, et refaite au passage suivant.
    opsLoad ??= kvGet('ops_alerts').catch(() => null)
    const stored = await opsLoad
    opsMemo ??= stored || {}
    if (opsMemo.day !== day) opsMemo = { ...opsMemo, day, sent: [] }
    return opsMemo
  }
  const saveOpsAlerts = () => kvSet('ops_alerts', opsMemo, 3 * 86400)
    .catch((e) => log.warn(`Discord bridge: alerts memory not saved (${e.message})`))
  /** Alerte `id` une fois par jour (UTC) au plus. */
  async function alertOncePerDay(id, text) {
    const memo = await opsAlerts()
    if (memo.sent.includes(id)) return
    memo.sent = [...memo.sent, id].slice(-100)
    await alert(text)
    await saveOpsAlerts()
  }

  /** État du Worker, toutes les 5 min : plafonds du jour à 80 %, base à 70 %
   *  de sa taille maximale, tâche planifiée muette depuis 5 min (puis
   *  revenue). Worker d'avant (action inconnue : 400) : rien. */
  async function watchOps() {
    const o = await call({ action: 'ops' }).catch((e) => { if (e.status === 400) return null; throw e })
    if (!Array.isArray(o?.caps)) return
    for (const c of o.caps) {
      if (!(c.max > 0) || c.n < 0.8 * c.max) continue
      await alertOncePerDay(`cap:${c.id}`, `📈 **${c.label}: ${pct(c.n, c.max)}% of today’s cap** (${num(c.n)} / ${num(c.max)}, UTC day). Past it, more are refused until midnight UTC.`)
    }
    if (o.db?.max > 0 && o.db.bytes >= 0.7 * o.db.max) {
      await alertOncePerDay('db', `🗄️ **Database at ${pct(o.db.bytes, o.db.max)}%** of D1’s ${mb(o.db.max)} (free plan): ${mb(o.db.bytes)}. New reports stop at ${mb(o.db.pauseAt)}; once full, nothing can be written any more (backups, counts, notifications).`)
    }
    // Tâche planifiée : muette depuis 5 min, puis revenue (une alerte chacune).
    const last = Number(o.cron?.at) || 0
    if (!last) return   // jamais notée (Worker tout juste à jour)
    const memo = await opsAlerts()
    const silent = Date.now() - last > 5 * 60_000
    if (silent && !memo.cron) {
      memo.cron = last
      await alert(`⏱️ **Scheduled task silent**: no run since ${ago(last)} — live notifications and the relay watch are stopped. Check the Worker’s Cron Trigger (Cloudflare → Workers & Pages → the Worker → Settings → Triggers).`)
      await saveOpsAlerts()
    } else if (!silent && memo.cron) {
      const gap = Date.now() - memo.cron
      memo.cron = 0
      await alert(`✅ **Scheduled task running again** (silent for about ${dur(gap)}).`)
      await saveOpsAlerts()
    }
  }

  // Quotas gratuits de Cloudflare, par jour UTC, pour tout le compte du Worker
  // principal (le secours est sur un autre compte). Sans jeton : coupé.
  const cfOn = /^[0-9a-f]{32}$/i.test(String(cloudflare.account || '')) && Boolean(cloudflare.token)
  const CF_QUOTAS = [
    ['requests', 'Worker requests', 100_000, 'past it, the main Worker answers 1027 until midnight UTC and the apps switch to the fallback'],
    ['rowsRead', 'D1 rows read', 5_000_000, 'past it, D1 refuses reads until midnight UTC'],
    ['rowsWritten', 'D1 rows written', 100_000, 'past it, D1 refuses writes until midnight UTC (backups, reports, counts, notifications)'],
  ]
  /** Requêtes des Workers et lignes D1 lues et écrites du jour, par l'API
   *  GraphQL Analytics (jeton en lecture seule). Valeurs écrites dans la
   *  requête : dates calculées ici, compte vérifié (32 caractères hexa). */
  /** Une requête GraphQL Analytics sur le compte (`fields` : ses champs) →
   *  le compte ; lève avec le message de Cloudflare. */
  async function cfAccount(fields) {
    const query = `{ viewer { accounts(filter: { accountTag: "${cloudflare.account}" }) { ${fields} } } }`
    const r = await fetch(cloudflareApi, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cloudflare.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(20_000),
    })
    const j = await r.json().catch(() => null)
    if (!r.ok || j?.errors?.length) throw new Error(String(j?.errors?.[0]?.message || `HTTP ${r.status}`).slice(0, 200))
    const acc = j?.data?.viewer?.accounts?.[0]
    if (!acc) throw new Error('account not found (CLOUDFLARE_ACCOUNT_ID, or the token’s account)')
    return acc
  }
  async function cfQuotas() {
    const now = new Date()
    const day = now.toISOString().slice(0, 10)
    const until = now.toISOString().replace(/\.\d+Z$/, 'Z')
    const acc = await cfAccount(`
      workers: workersInvocationsAdaptive(limit: 10000, filter: { datetime_geq: "${day}T00:00:00Z", datetime_leq: "${until}" }) { sum { requests } }
      d1: d1AnalyticsAdaptiveGroups(limit: 10000, filter: { date_geq: "${day}", date_leq: "${day}" }) { sum { rowsRead rowsWritten } }`)
    const sum = (list, k) => (Array.isArray(list) ? list : []).reduce((n, g) => n + (Number(g?.sum?.[k]) || 0), 0)
    return { at: Date.now(), day, requests: sum(acc.workers, 'requests'), rowsRead: sum(acc.d1, 'rowsRead'), rowsWritten: sum(acc.d1, 'rowsWritten') }
  }
  /** Les requêtes D1 qui ont lu le plus de lignes aujourd'hui (UTC) :
   *  [{ query, rowsRead, count }], 5 au plus. Requête à part : refusée
   *  (jeton sans ce droit, jeu de données absent), les quotas restent. */
  async function cfTopReads() {
    const day = new Date().toISOString().slice(0, 10)
    const acc = await cfAccount(`
      top: d1QueriesAdaptiveGroups(limit: 5, filter: { date_geq: "${day}", date_leq: "${day}" }, orderBy: [sum_rowsRead_DESC]) {
        count sum { rowsRead } dimensions { query }
      }`)
    return (Array.isArray(acc.top) ? acc.top : []).map((g) => ({
      query: String(g?.dimensions?.query || ''), rowsRead: Number(g?.sum?.rowsRead) || 0, count: Number(g?.count) || 0,
    }))
  }
  /** Toutes les 15 min : une alerte par quota et par jour, passé 70 %. */
  async function watchQuotas() {
    if (!cfOn) return
    let q
    try {
      q = await cfQuotas()
    } catch (e) {
      log.warn(`Discord bridge: Cloudflare quotas unreadable (${e.message})`)
      return
    }
    for (const [id, label, max, note] of CF_QUOTAS) {
      const n = q[id]
      if (n >= 0.7 * max) await alertOncePerDay(`cf:${id}`, `☁️ **Cloudflare quota at ${pct(n, max)}%**: ${label} — ${num(n)} of ${num(max)} today (UTC, free plan); ${note}.`)
    }
  }

  // Versions : l'image du relais (GIT_SHA) et le Worker (version_metadata)
  // face aux derniers commits de GitHub (API publique, sans jeton), toutes
  // les 30 min. Une alerte par version manquée, quand le retard dure encore
  // 30 min après avoir été vu (le temps d'une construction, d'un déploiement).
  // Pour le relais, seuls comptent ses fichiers : un changement du site seul
  // (public/) ne le concerne pas.
  const RELAY_PATHS = /^(worker\.js|Dockerfile|\.dockerignore|docker\/)/
  const WORKER_PATHS = /^(worker\.js|wrangler\.toml)$/
  const SHA = /^[0-9a-f]{7,40}$/
  let lastVersions = null   // { at, relay, worker } : pour /status
  /** Retard constaté (`target` : le commit attendu) → { target, since, sent } ;
   *  null quand c'est à jour. */
  async function lag(prev, target, text) {
    if (!target) return null
    const p = prev?.target === target ? prev : { target, since: Date.now(), sent: false }
    if (p.sent || Date.now() - p.since < 30 * 60_000) return p
    await alert(text())
    return { ...p, sent: true }
  }
  /** Mémoire illisible (Worker injoignable) : passage abandonné. */
  async function watchVersions() {
    const prev = (await kvGet('version_alerts')) || {}
    const next = { ...prev }
    const out = { at: Date.now(), relay: null, worker: null }
    if (SHA.test(version)) {
      const ref = branch || 'main'
      const cmp = await gh(`/repos/${repos.web}/compare/${version}...${encodeURIComponent(ref)}`)
      if (cmp) {
        const head = cmp.commits?.length ? cmp.commits[cmp.commits.length - 1].sha : null
        const stale = Boolean(head) && (cmp.files || []).some((f) => RELAY_PATHS.test(f.filename || ''))
        out.relay = { sha: version, branch: ref, head, ahead: Number(cmp.ahead_by) || 0, stale }
        next.relay = await lag(prev.relay, stale ? head : null, () => `⬆️ **VPS not up to date**: the relay runs \`${version.slice(0, 7)}\`, \`${ref}\` is at \`${head.slice(0, 7)}\` (${plural(out.relay.ahead, 'commit')} ahead, the relay’s files changed). In the relay’s folder: \`docker compose pull && docker compose up -d\`.`)
      }
    }
    const v = (await call({ action: 'ops' }).catch(() => null))?.version
    if (v) {
      let latest = null
      let stale = false
      if (SHA.test(v.tag || '')) {
        // Étiquette = commit déployé (image Docker) : comparaison exacte.
        const cmp = await gh(`/repos/${repos.web}/compare/${v.tag}...main`)
        if (cmp) {
          latest = cmp.commits?.length ? cmp.commits[cmp.commits.length - 1].sha : null
          stale = Boolean(latest) && (cmp.files || []).some((f) => WORKER_PATHS.test(f.filename || ''))
        }
      } else if (v.timestamp) {
        // Cloudflare : la date de la version face au dernier commit de main qui change worker.js.
        const list = await gh(`/repos/${repos.web}/commits?sha=main&path=worker.js&per_page=1`)
        const c = Array.isArray(list) ? list[0] : null
        if (c?.sha) {
          latest = c.sha
          stale = Date.parse(c.commit?.committer?.date || '') > Date.parse(v.timestamp) + 60_000
        }
      }
      out.worker = { id: v.id || null, tag: v.tag || null, deployedAt: Date.parse(v.timestamp || '') || null, latest, stale }
      next.worker = await lag(prev.worker, stale ? latest : null, () => `⬆️ **Worker not up to date**: the last change to \`worker.js\` on \`main\` (\`${latest.slice(0, 7)}\`) is newer than the deployed version${out.worker.deployedAt ? ` (${ago(out.worker.deployedAt)})` : ''}. Check the Worker’s builds (Cloudflare → Workers & Pages → the Worker → Deployments).`)
    }
    lastVersions = out
    if (JSON.stringify(next) !== JSON.stringify(prev)) await kvSet('version_alerts', next)
  }

  /** La racine d'un Worker répond-elle, et en combien de temps ? */
  async function probeWorker(base) {
    const t0 = Date.now()
    try {
      const r = await fetch(`${base}/`, { signal: AbortSignal.timeout(15_000) })
      await r.body?.cancel().catch(() => {})
      return { ok: r.ok, ms: Date.now() - t0, problem: r.ok ? null : `HTTP ${r.status}${r.status === 429 ? ' (daily quota?)' : ''}` }
    } catch {
      return { ok: false, ms: null, problem: 'unreachable' }
    }
  }

  /** /status : l'état du serveur en un message. Quotas de Cloudflare relus ;
   *  versions : la dernière comparaison (30 min au plus). */
  async function statusText() {
    const now = Date.now()
    const [o, probes, q, top] = await Promise.all([
      call({ action: 'ops' }).catch((e) => ({ error: e.status === 400 ? 'the Worker isn’t up to date' : e.message })),
      Promise.all([['main', worker], ...fallbacks.map((f) => ['fallback', f])].map(async ([kind, base]) => ({ kind, ...(await probeWorker(base)) }))),
      cfOn ? cfQuotas().catch((e) => ({ at: Date.now(), error: e.message })) : null,
      cfOn ? cfTopReads().catch((e) => ({ error: e.message })) : null,
    ])
    const L = [`📟 **Status** — <t:${Math.floor(now / 1000)}:f>`]
    L.push(`**Workers**: ${probes.map((p) => `${p.kind} ${p.ok ? '✅' : `❌ ${p.problem}`}${p.ms !== null ? ` (${p.ms} ms)` : ''}`).join(' · ')}`)
    if (o.error) L.push(`**Worker state**: unavailable (${o.error})`)
    else {
      L.push(`**Database**: ${mb(o.db?.bytes)} of ${mb(o.db?.max)} (${pct(o.db?.bytes, o.db?.max)}%)`)
      const n = o.ntfy || {}
      L.push(`**ntfy**: ${num(n.sentToday)}${n.quota ? ` / ${num(n.quota)}` : ''} sent today (${n.route === 'relay' ? 'through the relay' : 'direct'})`
        + (n.pausedUntil ? ` · ⏸️ paused until <t:${Math.floor(n.pausedUntil / 1000)}:t>${n.code === 42908 ? ' (daily quota reached)' : ''}` : ''))
      const lane = (k) => {
        const x = o.queue?.[k] || {}
        return `${k} ${num(x.n)}${x.n && x.oldest ? ` (oldest ${ago(x.oldest)})` : ''}`
      }
      L.push(`**Notification queue**: ${lane('web')} · ${lane('ntfy')}`)
      const last = Number(o.cron?.at) || 0
      L.push(`**Scheduled task**: ${last ? `last run ${ago(last)}${now - last > 5 * 60_000 ? ' ⚠️' : ''}` : 'no run recorded yet'}`)
      const busy = (o.caps || []).filter((c) => c.n > 0 && c.max > 0).sort((a, b) => b.n / b.max - a.n / a.max).slice(0, 6)
      L.push(`**Daily caps** (UTC): ${busy.length ? busy.map((c) => `${c.label} ${num(c.n)}/${num(c.max)}`).join(' · ') : 'nothing used yet'}`)
    }
    const vr = lastVersions?.relay
    const relayV = SHA.test(version)
      ? `\`${version.slice(0, 7)}\`${vr ? (vr.stale ? ` ⚠️ \`${vr.branch}\` is at \`${String(vr.head).slice(0, 7)}\`` : ' ✅') : ''}`
      : 'unknown (image built without GIT_SHA)'
    const wv = o.error ? null : o.version
    const vw = lastVersions?.worker
    const workerV = wv
      ? `\`${String(wv.tag || wv.id).slice(0, 8)}\`${wv.timestamp ? ` deployed ${ago(Date.parse(wv.timestamp))}` : ''}${vw ? (vw.stale ? ' ⚠️ behind main' : ' ✅') : ''}`
      : 'unknown (no version_metadata)'
    L.push(`**Versions**: relay ${relayV} · Worker ${workerV}${lastVersions ? ` · compared with GitHub ${ago(lastVersions.at)}` : ''}`)
    L.push(`**Bot**: ${gw.state === 'ready' && gw.readyAt ? `connected for ${dur(now - gw.readyAt)}` : gw.state}`
      + `${gw.lastAck ? ` · last heartbeat ack ${dur(now - gw.lastAck)} ago` : ''} · relay up for ${dur(process.uptime() * 1000)}`)
    if (!cfOn) L.push('**Cloudflare quotas**: off — set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the relay’s .env')
    else if (q?.error) L.push(`**Cloudflare quotas**: unreadable (${q.error})`)
    else L.push(`**Cloudflare quotas** (today, UTC, free plan): ${CF_QUOTAS.map(([id, label, max]) => `${label} ${num(q[id])} / ${num(max)} (${pct(q[id], max)}%)`).join(' · ')}`)
    // En dernier, raccourcies pour que tout tienne dans le message (1 900).
    if (cfOn) L.push(topReadsText(top, 1900 - L.join('\n').length - 1))
    return L.join('\n')
  }
  /** Les requêtes D1 qui lisent le plus aujourd'hui (cfTopReads), en `room`
   *  caractères au plus : début de chaque requête, lignes lues, appels. */
  function topReadsText(top, room) {
    const title = '**D1 rows read by query**'
    if (!top || top.error) return `${title}: unavailable (${String(top?.error || 'no answer').slice(0, 100)})`.slice(0, Math.max(0, room))
    if (!top.length) return `${title}: nothing recorded yet today`.slice(0, Math.max(0, room))
    const sql = (s, n) => {
      const t = String(s || '?').replace(/\s+/g, ' ').replace(/`/g, "'").trim()
      return t.length > n ? `${t.slice(0, n - 1)}…` : t
    }
    for (const width of [90, 70, 50, 35, 20]) {
      const text = [`${title} (top ${top.length} today, UTC):`, ...top.map((t, i) =>
        `${i + 1}. \`${sql(t.query, width)}\` — ${num(t.rowsRead)} rows · ${num(t.count)} ${t.count === 1 ? 'call' : 'calls'}`)].join('\n')
      if (text.length <= room) return text
    }
    return `${title}: too long to show here`.slice(0, Math.max(0, room))
  }

  // ── /forget-user ─────────────────────────────────────────────────────────
  // Aperçu d'abord (rien n'est effacé), puis « Erase for good ». Le texte que
  // rend l'aperçu (`who` : chaque @pseudo y est déjà l'identifiant du compte
  // montré) est gardé ici 10 min, sous un jeton dans l'identifiant du bouton
  // (100 caractères au plus pour lui) : la confirmation efface ce compte-là,
  // sans chercher le pseudo une seconde fois.
  const forgets = new Map()   // jeton → { who, at }
  const FORGET_LABELS = {
    sync: 'backup (history, progress)', settings: 'synced settings', usage: 'usage entries', votes: 'poll votes',
    reactions: 'reactions', reports: 'reports', pictures: 'pictures', posts: 'Discord posts', cards: 'suggestion cards',
    subscriptions: 'notification subscriptions', channels: 'followed channels',
  }
  const FORGET_HINT = 'ℹ️ Reports and notification subscriptions aren’t tied to a Twitch account or an install: add the report’s post (link or ID) or the person’s @Discord account, and their ntfy topic (tu-…) for the iOS app’s notifications.'
  function forgetSummary(r) {
    const found = Object.entries(r.found || {}).filter(([, n]) => n > 0).map(([k, n]) => `${FORGET_LABELS[k] || k} ${num(n)}`)
    return [
      `**Recognised**: ${(r.targets || []).map((x) => x.label).join(' · ') || 'nothing'}`,
      `**${r.dry ? 'Found' : 'Erased'}**: ${found.join(' · ') || 'nothing stored'}`,
      ...(r.unknown?.length ? [`**Not recognised**: ${r.unknown.join(' · ')}`] : []),
    ].join('\n')
  }
  // Worker d'avant : l'action inconnue tombe sur « Bad post ID ».
  const FORGET_OUTDATED = 'the Worker isn’t up to date (it can’t erase yet): update it first.'
  const forgetError = (e) => (e.status === 400 && /post ID/i.test(e.message) ? FORGET_OUTDATED : e.message)

  async function forgetCommand(i, user) {
    const who = String(opt(i, 'who') || '').slice(0, 1000)
    await respond(i, 5, { flags: 64 })
    try {
      const r = await call({ action: 'forget', who, dry: true, by: byOf(user) })
      const any = Object.values(r.found || {}).some((n) => n > 0)
      // Sans `who`, le Worker d'avant chercherait le pseudo à nouveau.
      if (any && typeof r.who !== 'string') throw new Error(FORGET_OUTDATED)
      let components = []
      if (any) {
        const now = Date.now()
        for (const [k, f] of forgets) if (now - f.at > 10 * 60_000) forgets.delete(k)
        const id = crypto.randomUUID().slice(0, 8)
        forgets.set(id, { who: r.who, at: now })
        components = [row(button('Erase for good', `fg:yes:${id}`, 4), button('Cancel', `fg:no:${id}`))]
      }
      const head = any ? '🧹 **Erase this person’s data?** Preview — nothing is erased yet.' : '🧹 Nothing stored for this — nothing to erase.'
      await editOriginal(i, { content: `${head}\n${forgetSummary(r)}\n${FORGET_HINT}`.slice(0, 1900), components })
    } catch (e) {
      await editOriginal(i, { content: `❌ ${forgetError(e)}` })
    }
  }

  async function forgetConfirm(i, user, choice, id) {
    const f = forgets.get(id)
    forgets.delete(id)
    if (choice !== 'yes') return respond(i, 7, { content: 'Cancelled — nothing was erased.', components: [] })
    if (!f || Date.now() - f.at > 10 * 60_000) return respond(i, 7, { content: 'This preview expired: run /forget-user again.', components: [] })
    await respond(i, 6)
    try {
      const r = await call({ action: 'forget', who: f.who, dry: false, by: byOf(user) })
      reads.clear()
      // Posts Discord des retours et cartes des suggestions : dans la
      // corbeille du Worker, vidée tout de suite.
      if (r.found?.posts || r.found?.cards) emptyTrash().catch((e) => log.warn(`Discord bridge: trash — ${e.message}`))
      await editOriginal(i, { content: `✅ **Erased.**\n${forgetSummary(r)}`.slice(0, 1900), components: [] })
    } catch (e) {
      await editOriginal(i, { content: `❌ Not erased: ${forgetError(e)}`, components: [] })
    }
  }

  /** État de la passerelle pour /health du relais : `ok` faux quand le bot est
   *  arrêté (jeton refusé…), pas connecté depuis plus de 5 min, ou sans accusé
   *  de battement depuis trois battements. */
  function health() {
    const now = Date.now()
    const late = gw.state === 'ready' && gw.interval > 0 && gw.lastAck > 0 && now - gw.lastAck > 3 * gw.interval
    const stuck = gw.state !== 'ready' && now - gw.since > 5 * 60_000
    return { state: gw.state, ok: gw.state !== 'stopped' && !late && !stuck, since: gw.since, readyAt: gw.readyAt || null, lastAck: gw.lastAck || null }
  }

  function startTimers() {
    if (!timers || intervals.length) return
    const every = (ms, fn) => {
      const h = setInterval(() => { if (!stopped) fn().catch((e) => log.warn(`Discord bridge: ${fn.name} — ${e.message}`)) }, ms)
      h.unref?.()
      intervals.push(h)
    }
    every(10 * 60_000, heartbeat)
    every(10 * 60_000, watchReleases)
    every(5 * 60_000, watchHealth)
    every(10 * 60_000, watchActions)
    every(60 * 60_000, tidy)
    every(60_000, summaryClock)
    every(5 * 60_000, watchOps)
    every(15 * 60_000, watchQuotas)
    every(30 * 60_000, watchVersions)
    // Copie de la liste à faire : cartes supprimées ou modifiées à la main.
    every(15 * 60_000, syncTodoMirror)
    const first = setTimeout(() => {
      for (const fn of [watchReleases, watchActions, watchHealth, tidy, watchOps, watchQuotas, watchVersions]) fn().catch((e) => log.warn(`Discord bridge: ${fn.name} — ${e.message}`))
    }, 30_000)
    first.unref?.()
    intervals.push(first)
  }

  // Événements d'un même post traités l'un après l'autre : en parallèle, deux
  // écritures dans le Worker pouvaient s'écraser (réponse perdue, ✅ affiché).
  const queues = new Map()
  function serial(key, fn) {
    const run = (queues.get(key) || Promise.resolve()).catch(() => {}).then(fn)
    queues.set(key, run)
    run.catch(() => {}).finally(() => { if (queues.get(key) === run) queues.delete(key) })
    return run
  }

  async function dispatch(t, d) {
    switch (t) {
      case 'READY':
        session = { id: d.session_id, resume: d.resume_gateway_url }
        st.me = d.user?.id
        st.app = d.application?.id || d.user?.id
        retries = 0
        gwState('ready')
        gw.readyAt = Date.now()
        log.log(`Discord bridge: connected (${d.user?.username || '?'})`)
        if (st.guild && !(d.guilds || []).some((g) => g.id === st.guild)) {
          log.warn('Discord bridge: the bot isn’t on the webhook’s server — invite it (README, “Discord bot”)')
        }
        await registerCommands()
        // Copie de la liste à faire relue à chaque connexion (écrite si elle a changé).
        syncTodoMirror()
        break
      case 'RESUMED':
        retries = 0
        gwState('ready')
        break
      case 'GUILD_CREATE':
        if (d.id === st.guild) await onGuild(d)
        break
      case 'CHANNEL_UPDATE':
        if (d.id === st.forum) readTags(d)
        if (d.guild_id === st.guild) forgetFacts()
        break
      // Rôles ou droits des salons changés : la vérification des rôles à
      // donner les relit (guildFacts).
      case 'CHANNEL_CREATE':
      case 'CHANNEL_DELETE':
      case 'GUILD_ROLE_CREATE':
      case 'GUILD_ROLE_UPDATE':
      case 'GUILD_ROLE_DELETE':
        if (d.guild_id === st.guild) forgetFacts()
        break
      case 'THREAD_CREATE':
        if (d.parent_id === st.forum) st.threads.set(d.id, d.applied_tags || [])
        break
      case 'THREAD_UPDATE':
        await serial(d.id, () => onThreadUpdate(d))
        break
      case 'THREAD_DELETE':
        forget(d.id)
        break
      case 'THREAD_LIST_SYNC':
        for (const th of d.threads || []) if (th.parent_id === st.forum) st.threads.set(th.id, th.applied_tags || [])
        break
      case 'MESSAGE_CREATE':
        await serial(d.channel_id, () => onMessage(d))
        break
      // Seulement avec GUILD_MEMBERS (bienvenue choisie avec /setup).
      case 'GUILD_MEMBER_ADD':
        if (d.guild_id === st.guild) onMemberJoin(d)
        break
      case 'INTERACTION_CREATE':
        await onInteraction(d)
        break
    }
  }

  // ── Passerelle (WebSocket) ──────────────────────────────────────────────
  const send = (op, d) => { if (ws?.readyState === 1) ws.send(JSON.stringify({ op, d })) }

  // Connexions déjà relancées (par leur « close » ou par hangUp) : une
  // relance chacune, jamais deux connexions en même temps.
  const relaunched = new WeakSet()

  /** Ferme `sock` et, si son « close » n'est pas arrivé 5 s plus tard, relance
   *  la connexion sans l'attendre : sur une connexion à moitié ouverte, il
   *  pouvait traîner des minutes, et le bot restait sourd. */
  function hangUp(sock) {
    clearInterval(beatTimer)
    clearTimeout(firstBeat)
    try { sock?.close(4000) } catch {}
    setTimeout(() => {
      if (!sock || ws !== sock || relaunched.has(sock) || stopped) return
      relaunched.add(sock)
      connect()
    }, 5000)
  }

  function beat() {
    // Pas d'accusé depuis le dernier battement : connexion morte, on reprend.
    if (!acked) { hangUp(ws); return }
    acked = false
    send(1, seq)
  }

  function onPayload(p) {
    if (p.s != null) seq = p.s
    switch (p.op) {
      case 10: {   // Hello
        clearInterval(beatTimer)
        clearTimeout(firstBeat)
        acked = true
        const every = p.d.heartbeat_interval
        Object.assign(gw, { interval: every, lastAck: Date.now() })
        firstBeat = setTimeout(beat, Math.random() * every)
        beatTimer = setInterval(beat, every)
        if (session) send(6, { token, session_id: session.id, seq })
        else {
          // GUILD_MEMBERS (privilégiée) seulement pour la bienvenue.
          intents = INTENTS | (wantsMembers() ? GUILD_MEMBERS : 0)
          send(2, { token, intents, properties: { os: 'linux', browser: 'twitchunblock-relay', device: 'twitchunblock-relay' } })
        }
        break
      }
      case 11: acked = true; gw.lastAck = Date.now(); break
      case 1: send(1, seq); break
      case 7: ws.close(4000); break   // Discord demande de se reconnecter
      case 9:                         // session invalide : reprise ou nouvelle
        if (!p.d) { session = null; seq = null }
        setTimeout(() => ws.close(4000), 1000 + Math.random() * 4000)
        break
      case 0:
        dispatch(p.t, p.d).catch((e) => log.warn(`Discord bridge: ${p.t} — ${e.message}`))
        break
    }
  }

  function connect() {
    if (stopped) return
    gwState('connecting')
    const url = session?.resume ? `${session.resume.replace(/\/+$/, '')}/?v=10&encoding=json` : gateway
    const sock = new WebSocket(url)
    ws = sock
    sock.addEventListener('message', (ev) => {
      if (ws !== sock) return   // connexion remplacée (hangUp) : plus écoutée
      try { onPayload(JSON.parse(String(ev.data))) } catch (e) { log.warn(`Discord bridge: unreadable message (${e.message})`) }
    })
    sock.addEventListener('error', () => {})   // suivi de « close »
    sock.addEventListener('close', (ev) => {
      if (ws !== sock || relaunched.has(sock)) return
      relaunched.add(sock)
      clearInterval(beatTimer)
      clearTimeout(firstBeat)
      if (stopped) return
      // Intent privilégiée refusée alors que GUILD_MEMBERS était demandée :
      // l'intent « Server Members » n'est pas activée dans le portail. Le bot
      // repart sans elle (bienvenue coupée) au lieu de s'arrêter ; sans elle,
      // un nouveau 4014 vise MESSAGE_CONTENT, et arrête tout comme avant.
      if (ev.code === 4014 && intents & GUILD_MEMBERS) {
        session = null
        seq = null
        intents = INTENTS
        membersRefused()
        setTimeout(connect, 1000)
        return
      }
      if (FATAL.has(ev.code)) {
        stopped = true
        gwState('stopped')
        log.error(`Discord bridge stopped: ${FATAL.get(ev.code)}`)
        return
      }
      // Numéro de séquence ou session périmés : nouvelle session.
      if (ev.code === 4007 || ev.code === 4009) { session = null; seq = null }
      setTimeout(connect, Math.min(60_000, 1000 * 2 ** Math.min(retries++, 6)))
    })
  }

  async function start() {
    while (!stopped) {
      try {
        const c = await call({ action: 'config' })
        st.forum = c.forum
        st.guild = c.guild
        st.labels = c.labels || {}
        st.settings = (await kvGet('settings')) || {}
        refreshTemplates().catch(() => {})
        break
      } catch (e) {
        log.warn(`Discord bridge: the Worker doesn’t answer (${e.message}) — trying again in 1 min`
          + (e.status === 403 || e.status === 404 ? ' (same FEEDBACK_BOT_SECRET on both sides? Worker up to date?)' : ''))
        await sleep(60_000)
      }
    }
    connect()
    startTimers()
  }

  start()
  return {
    stop() {
      stopped = true
      for (const h of intervals) { clearInterval(h); clearTimeout(h) }
      clearTimeout(todoSync.timer)
      ws?.close(1000)
    },
    // Passerelle Discord, pour /health du relais.
    health,
    // Pour le banc : les tâches périodiques, à la demande.
    run: { watchReleases, watchHealth, watchActions, tidy, postSummary, summaryClock, heartbeat, watchOps, watchQuotas, watchVersions, statusText, syncTodoMirror },
  }
}
