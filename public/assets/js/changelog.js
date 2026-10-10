// ═══════════════════════════════════════════════════════════════════════════
//  Nouveautés du site, de la plus récente à la plus ancienne. La clé suit
//  SITE_VERSION (usage.js) : à chaque nouvelle version, ajouter une entrée
//  en tête. Le site montre celles qu'on n'a pas encore vues.
// ═══════════════════════════════════════════════════════════════════════════

export const CHANGELOG = [
  {
    version: '2026.10.10c',
    items: {
      fr: ['Direct : environ 4 s de retard au lieu d’une dizaine. Le lecteur se sert maintenant des segments que Twitch annonce d’avance, comme son propre lecteur, et rattrape tout seul le retard pris après une coupure.'],
      en: ['Live: about 4 s of delay instead of ten or so. The player now uses the segments Twitch announces ahead of time, like its own player, and catches up by itself after a hiccup.'],
      es: ['Directo: unos 4 s de retraso en lugar de unos diez. El reproductor usa ahora los segmentos que Twitch anuncia por adelantado, como su propio reproductor, y recupera solo el retraso tras un corte.'],
      ru: ['Трансляции: задержка около 4 с вместо примерно десяти. Плеер теперь использует сегменты, которые Twitch объявляет заранее, как и его собственный плеер, и сам догоняет эфир после сбоя.'],
    },
  },
  {
    version: '2026.10.10b',
    items: {
      fr: ['« Mes signalements » se met à jour tout seul : la réponse et le nouvel état apparaissent sans recharger la page.'],
      en: ['“My reports” updates on its own: the reply and the new status show up without reloading the page.'],
      es: ['«Mis reportes» se actualiza solo: la respuesta y el nuevo estado aparecen sin recargar la página.'],
      ru: ['«Мои обращения» обновляются сами: ответ и новый статус появляются без перезагрузки страницы.'],
    },
  },
  {
    version: '2026.10.10a',
    items: {
      fr: [
        'Retours : joins jusqu’à 3 captures (ou colle-les avec Ctrl+V). Dans « Mes signalements », suis où en est ton retour (reçu, accepté, en cours, fait, refusé), lis la réponse et réponds à ton tour ; une pastille signale les nouvelles réponses.',
        'VODs : les passages dont Twitch a coupé le son (musique protégée) apparaissent en orange sur la barre, avec un bouton « Passer ». Un jour ou deux après le live, Twitch garde encore le son d’origine : le site le remet alors tout seul.',
        'Clic molette (ou Ctrl/Cmd + clic) sur un live, une VOD, un clip, une catégorie ou une chaîne : ouverture dans un nouvel onglet.',
        'Compte : « Changer de compte » dans les réglages. Après une déconnexion, Twitch demande quel compte utiliser au lieu de reconnecter l’ancien.',
        'Nouvelle langue : russe, traduit avec l’IA — les corrections sont les bienvenues (« Signaler une erreur de traduction » dans les réglages).',
        'Le site a une nouvelle adresse : twitchunblock.vercel.app (l’ancienne y renvoie).',
      ],
      en: [
        'Feedback: attach up to 3 screenshots (or paste them with Ctrl+V). In “My reports”, see where your report stands (received, accepted, in progress, done, declined), read the reply and answer back; a badge flags new replies.',
        'VODs: parts Twitch muted (copyrighted music) show in orange on the seek bar, with a “Skip” button. For a day or two after the stream, Twitch still keeps the original sound: the site then puts it back on its own.',
        'Middle-click (or Ctrl/Cmd + click) on a stream, VOD, clip, category or channel opens it in a new tab.',
        'Account: “Switch account” in the settings. After logging out, Twitch asks which account to use instead of signing the old one back in.',
        'New language: Russian, translated with AI — corrections are welcome (“Report a translation mistake” in the settings).',
        'The site has a new address: twitchunblock.vercel.app (the old one redirects there).',
      ],
      es: [
        'Comentarios: adjunta hasta 3 capturas (o pégalas con Ctrl+V). En «Mis reportes», mira en qué punto está tu reporte (recibido, aceptado, en curso, hecho, rechazado), lee la respuesta y contesta; un indicador avisa de las respuestas nuevas.',
        'VODs: las partes que Twitch silenció (música protegida) aparecen en naranja en la barra, con un botón «Saltar». Uno o dos días después del directo, Twitch aún guarda el sonido original: el sitio lo restaura solo.',
        'Clic con la rueda (o Ctrl/Cmd + clic) en un directo, VOD, clip, categoría o canal: se abre en una pestaña nueva.',
        'Cuenta: «Cambiar de cuenta» en los ajustes. Tras cerrar sesión, Twitch pregunta qué cuenta usar en lugar de reconectar la anterior.',
        'Nuevo idioma: ruso, traducido con IA; las correcciones son bienvenidas («Reportar un error de traducción» en los ajustes).',
        'El sitio tiene una nueva dirección: twitchunblock.vercel.app (la anterior redirige allí).',
      ],
      ru: [
        'Обратная связь: прикрепляйте до 3 скриншотов (или вставляйте их через Ctrl+V). В разделе «Мои обращения» видно, на каком этапе ваше обращение (получено, принято, в работе, готово, отклонено), можно прочитать ответ и ответить; значок сообщает о новых ответах.',
        'VOD: фрагменты, где Twitch отключил звук (защищённая музыка), отмечены оранжевым на шкале, есть кнопка «Пропустить». В течение дня-двух после трансляции Twitch ещё хранит исходный звук — сайт сам его возвращает.',
        'Средняя кнопка мыши (или Ctrl/Cmd + клик) по трансляции, VOD, клипу, категории или каналу открывает их в новой вкладке.',
        'Аккаунт: «Сменить аккаунт» в настройках. После выхода Twitch спрашивает, какой аккаунт использовать, а не входит снова в прежний.',
        'Новый язык: русский, переведён с помощью ИИ — исправления приветствуются («Сообщить об ошибке перевода» в настройках).',
        'У сайта новый адрес: twitchunblock.vercel.app (старый перенаправляет на него).',
      ],
    },
  },
  {
    version: '2026.10.07c',
    items: {
      fr: [
        'Direct : environ 6 s de retard au lieu de 20. Le lecteur se plaçait trop loin du direct (Twitch annonce des segments de 6 s qui en durent 2).',
        'Direct : ←/→ et les boutons ±10 s marchent aussi pendant un live, pour se rapprocher du direct ou revenir un peu en arrière — comme dans le lecteur incrusté.',
        'Nouveau : « Signaler un bug ou proposer une idée » — bouton dans la barre du haut, en tête des réglages, dans le menu du lecteur et sur son écran d’erreur.',
        'Chat : les annonces (messages encadrés des modérateurs et des bots) s’affichent correctement, le pseudo n’est plus coupé en morceaux.',
        'Sans compte, le site explique pourquoi une liste s’arrête à 100 : c’est la limite de Twitch pour les visiteurs non connectés.',
      ],
      en: [
        'Live: about 6 s of delay instead of 20. The player sat too far from the live edge (Twitch announces 6-second segments that last 2).',
        'Live: ←/→ and the ±10 s buttons now work during a live stream too, to get closer to live or go back a little — like in picture-in-picture.',
        'New: “Report a bug or suggest an idea” — a button in the top bar, at the top of the settings, in the player menu and on its error screen.',
        'Chat: announcements (boxed messages from moderators and bots) display properly, the username is no longer split into pieces.',
        'Without an account, the site explains why a list stops at 100: it’s Twitch’s limit for logged-out visitors.',
      ],
      es: [
        'Directo: unos 6 s de retraso en lugar de 20. El reproductor se quedaba demasiado lejos del directo (Twitch anuncia segmentos de 6 s que duran 2).',
        'Directo: ←/→ y los botones ±10 s también funcionan durante un directo, para acercarse al directo o retroceder un poco, como en el modo imagen en imagen.',
        'Nuevo: «Informar de un error o proponer una idea»: botón en la barra superior, al principio de los ajustes, en el menú del reproductor y en su pantalla de error.',
        'Chat: los anuncios (mensajes enmarcados de moderadores y bots) se muestran bien, el nombre ya no se corta en trozos.',
        'Sin cuenta, la web explica por qué una lista se detiene en 100: es el límite de Twitch para visitantes sin sesión.',
      ],
    },
  },
  {
    version: '2026.10.07b',
    items: {
      fr: [
        'Adresses comme sur Twitch : remplace « twitch.tv » par l’adresse du site (/xqc, /videos/…?t=1h2m3s, /xqc/clips, /directory/category/just-chatting…). Les boutons précédent et suivant du navigateur passent d’une page à l’autre ; depuis le lecteur, « précédent » le réduit en mini-lecteur sans couper la lecture.',
        'Page d’une chaîne : nouvel onglet « À propos » (description, followers, réseaux et panneaux du streamer).',
        'Clips : « Charger plus » (100 clips sans compte, sans limite une fois connecté). Au-delà de 100 sans compte, le site le dit au lieu de s’arrêter sans rien afficher.',
        'Cartes de live : le pseudo ouvre la chaîne et la catégorie ses lives, comme dans le lecteur.',
        'Commandes des bots : les liens sont cliquables.',
        'Réglages : option pour masquer les chaînes récentes.',
        'Un lien Twitch collé dans la recherche ouvre ce qu’il désigne (chaîne, VOD, clip, catégorie) ; l’onglet Lien / ID accepte aussi les liens de clips.',
      ],
      en: [
        'Twitch-style links: replace “twitch.tv” with the site’s address (/xqc, /videos/…?t=1h2m3s, /xqc/clips, /directory/category/just-chatting…). The browser’s back and forward buttons move between pages; from the player, “back” shrinks it to the mini player without stopping playback.',
        'Channel page: new “About” tab (description, followers, social links and the streamer’s panels).',
        'Clips: “Load more” (100 clips without an account, unlimited once logged in). Past 100 without an account, the site says so instead of silently stopping.',
        'Stream cards: the username opens the channel and the category opens its streams, like in the player.',
        'Bot commands: links are clickable.',
        'Settings: option to hide recent channels.',
        'A Twitch link pasted in the search opens what it points to (channel, VOD, clip, category); the Link / ID tab also takes clip links.',
      ],
      es: [
        'Enlaces como en Twitch: cambia «twitch.tv» por la dirección del sitio (/xqc, /videos/…?t=1h2m3s, /xqc/clips, /directory/category/just-chatting…). Los botones atrás y adelante del navegador pasan de una página a otra; desde el reproductor, «atrás» lo reduce al minirreproductor sin cortar la reproducción.',
        'Página de un canal: nueva pestaña «Acerca de» (descripción, seguidores, redes y paneles del streamer).',
        'Clips: «Cargar más» (100 clips sin cuenta, sin límite al iniciar sesión). Pasados 100 sin cuenta, el sitio lo indica en lugar de pararse sin más.',
        'Tarjetas de directo: el nombre abre el canal y la categoría sus directos, como en el reproductor.',
        'Comandos de bots: los enlaces se pueden pulsar.',
        'Ajustes: opción para ocultar los canales recientes.',
        'Un enlace de Twitch pegado en la búsqueda abre lo que indica (canal, VOD, clip, categoría); la pestaña Enlace / ID también acepta enlaces de clips.',
      ],
    },
  },
  {
    version: '2026.10.07',
    items: {
      fr: [
        'Page d’une chaîne : plus d’onglet « Supprimées » — les VODs supprimées ou masquées apparaissent directement parmi les VODs, à leur date, marquées « VOD non listée ».',
        'Catégories : « Charger plus » fonctionne à nouveau (jusqu’à 100 catégories et 100 lives par catégorie sans compte, sans limite une fois connecté).',
        'Chat synchronisé : les messages ne sont plus retenus que de ton retard sur le direct. Sur les chaînes qui diffusent avec un délai, ils arrivaient jusqu’à 10 s trop tard, ou plus.',
      ],
      en: [
        'Channel page: no more “Deleted” tab — deleted or hidden VODs now appear right among the VODs, at their date, marked “Unlisted VOD”.',
        'Categories: “Load more” works again (up to 100 categories and 100 streams per category without an account, unlimited once logged in).',
        'Chat sync: messages are now held back only by how far behind live you are. On channels that stream with a delay, they showed up 10 s late or more.',
      ],
      es: [
        'Página de un canal: ya no hay pestaña «Eliminados»: los VODs borrados u ocultos aparecen directamente entre los VODs, en su fecha, marcados «VOD no listado».',
        'Categorías: «Cargar más» vuelve a funcionar (hasta 100 categorías y 100 directos por categoría sin cuenta, sin límite al iniciar sesión).',
        'Chat sincronizado: los mensajes solo se retrasan según tu retraso respecto al directo. En los canales que emiten con retraso, llegaban 10 s tarde o más.',
      ],
    },
  },
  {
    version: '2026.10.06b',
    items: {
      fr: [
        'Accueil : nouvel onglet « Hors ligne » pour tes chaînes suivies hors ligne ; « Suivies » ne montre plus que les lives.',
        'Page d’une chaîne : l’onglet « Supprimées » passe juste après les VODs.',
        'Nouvelle visite guidée interactive, qui montre les vrais boutons du site (Réglages > Revoir le tutoriel).',
        'Réglages : le « Journal des modifications » affiche toutes les nouveautés depuis le début.',
      ],
      en: [
        'Home: new “Offline” tab for your offline followed channels; “Following” now only shows who is live.',
        'Channel page: the “Deleted” tab now comes right after VODs.',
        'New interactive guided tour that points at the real buttons of the site (Settings > Replay the tutorial).',
        'Settings: the “Changelog” lists every update since the beginning.',
      ],
      es: [
        'Inicio: nueva pestaña «Desconectados» para tus canales seguidos sin directo; «Seguidos» ya solo muestra los directos.',
        'Página de un canal: la pestaña «Eliminados» va justo después de los VODs.',
        'Nueva visita guiada interactiva, que señala los botones reales del sitio (Ajustes > Ver el tutorial otra vez).',
        'Ajustes: el «Registro de cambios» muestra todas las novedades desde el principio.',
      ],
    },
  },
  {
    version: '2026.10.06',
    items: {
      fr: [
        'Nouvel onglet « Supprimées » sur la page d’une chaîne : récupère les VODs récemment supprimées, tant que Twitch sert encore leurs segments.',
      ],
      en: [
        'New “Deleted” tab on a channel page: recover recently deleted VODs, while Twitch still serves their segments.',
      ],
      es: [
        'Nueva pestaña «Eliminados» en la página de un canal: recupera VODs borrados recientemente, mientras Twitch siga sirviendo sus segmentos.',
      ],
    },
  },
  {
    version: '2026.10.05c',
    items: {
      fr: [
        'Barre de lecture des VODs : en la faisant glisser, le compteur affiche l’instant visé, et au doigt l’infobulle passe au-dessus du pouce.',
        'Réglages : lignes régulièrement espacées dans « À propos ».',
      ],
      en: [
        'VOD seek bar: while dragging, the time display shows where you are seeking to, and on touch screens the tooltip sits above your thumb.',
        'Settings: evenly spaced rows in “About”.',
      ],
      es: [
        'Barra de reproducción de los VODs: al deslizarla, el contador muestra el instante elegido y, en pantallas táctiles, la etiqueta queda por encima del pulgar.',
        'Ajustes: filas espaciadas de forma regular en «Acerca de».',
      ],
    },
  },
  {
    version: '2026.10.05',
    items: {
      fr: [
        'Page streamer en onglets : VODs, Highlights, Playlists et Clips.',
        'Sauvegarde : exporte et importe tes chaînes suivies, catégories et réglages (Réglages > Sauvegarde), compatible avec l’app iOS.',
        'Nouvelle option : désactiver la pause au clic sur la vidéo (Réglages > Lecteur).',
        '« Hors ligne depuis » dans ta langue, avec la date du dernier live — aussi pour chaque chaîne hors ligne de l’accueil.',
      ],
      en: [
        'Streamer page in tabs: VODs, Highlights, Playlists and Clips.',
        'Backup: export and import your followed channels, categories and settings (Settings > Backup), compatible with the iOS app.',
        'New option: turn off click-to-pause on the video (Settings > Player).',
        '“Offline for” now uses your language and shows the date of the last stream — also for each offline channel on Home.',
      ],
      es: [
        'Página del streamer en pestañas: VODs, Destacados, Listas y Clips.',
        'Copia de seguridad: exporta e importa tus canales seguidos, categorías y ajustes (Ajustes > Copia de seguridad), compatible con la app iOS.',
        'Nueva opción: desactivar la pausa al hacer clic en el vídeo (Ajustes > Reproductor).',
        '«Desconectado hace» en tu idioma, con la fecha del último directo — también para cada canal desconectado en Inicio.',
      ],
    },
  },
  {
    version: '2026.10.04c',
    items: {
      fr: [
        'Playlists des chaînes : nouvelle section sur la page streamer, avec « Tout lire » qui enchaîne les vidéos.',
        'Les highlights (vidéos des playlists) se lancent même quand Twitch refuse le jeton de lecture.',
        'Une VOD indisponible affiche « VOD introuvable » au lieu d’une fausse erreur réseau.',
      ],
      en: [
        'Channel playlists: new section on the streamer page, with “Play all” to chain the videos.',
        'Highlights (playlist videos) now play even when Twitch refuses the playback token.',
        'An unavailable VOD now says so instead of showing a misleading network error.',
      ],
      es: [
        'Listas de los canales: nueva sección en la página del streamer, con «Reproducir todo» para encadenar los vídeos.',
        'Los highlights (vídeos de las listas) se reproducen aunque Twitch rechace el token de reproducción.',
        'Un VOD no disponible lo indica en lugar de mostrar un falso error de red.',
      ],
    },
  },
  {
    version: '2026.10.04b',
    items: {
      fr: [
        'Nouvel onglet Catégories : toutes les catégories, recherche, et tes catégories suivies (bouton « Suivre »).',
        'Accueil en deux onglets : « Chaînes suivies » et « Top des lives ».',
        'Les chaînes suivies hors ligne sont listées : un clic ouvre leur page (VODs, clips).',
        'Dans le lecteur, cliquer sur le pseudo ouvre la page de la chaîne.',
      ],
      en: [
        'New Categories tab: all categories, search, and your followed categories (“Follow” button).',
        'Home split into two tabs: “Followed channels” and “Top streams”.',
        'Offline followed channels are listed: one click opens their page (VODs, clips).',
        'In the player, clicking the streamer name opens their channel page.',
      ],
      es: [
        'Nueva pestaña Categorías: todas las categorías, búsqueda y tus categorías seguidas (botón «Seguir»).',
        'Inicio en dos pestañas: «Canales seguidos» y «Top de directos».',
        'Los canales seguidos desconectados aparecen en una lista: un clic abre su página (VODs, clips).',
        'En el reproductor, hacer clic en el nombre del streamer abre su canal.',
      ],
    },
  },
  {
    version: '2026.10.04',
    items: {
      fr: [
        'Suis des chaînes sans compte Twitch : bouton « Suivre » sur leur page, elles arrivent dans « Chaînes suivies ».',
        'Accueil en liste façon Twitch ou en grille (bouton à côté de « Chaînes suivies »).',
        'Commandes des bots (Nightbot, StreamElements, Fossabot, Moobot) depuis l’en-tête du chat.',
        'Le message épinglé déplié s’affiche par-dessus le chat au lieu de le pousser.',
        'Réactions aux annonces, et cette fenêtre des nouveautés.',
      ],
      en: [
        'Follow channels without a Twitch account: “Follow” button on their page, they show up in “Followed channels”.',
        'Home as a Twitch-style list or a grid (button next to “Followed channels”).',
        'Bot commands (Nightbot, StreamElements, Fossabot, Moobot) from the chat header.',
        'An expanded pinned message now opens over the chat instead of pushing it down.',
        'React to announcements, and this “What’s new” window.',
      ],
      es: [
        'Sigue canales sin cuenta de Twitch: botón «Seguir» en su página, aparecen en «Canales seguidos».',
        'Inicio en lista al estilo Twitch o en cuadrícula (botón junto a «Canales seguidos»).',
        'Comandos de bots (Nightbot, StreamElements, Fossabot, Moobot) desde la cabecera del chat.',
        'El mensaje fijado desplegado se abre sobre el chat en lugar de empujarlo.',
        'Reacciones a los anuncios, y esta ventana de novedades.',
      ],
    },
  },
  {
    version: '2026.10.03',
    items: {
      fr: [
        'Annonces du développeur en haut de l’accueil.',
        'Top des lives dans la langue de ton appareil, réglable dans les réglages.',
        'Page /stats publique (français, anglais, espagnol).',
        'Lien vers le Discord dans le pied de page et les réglages.',
      ],
      en: [
        'Developer announcements at the top of the home page.',
        'Top streams in your device language, adjustable in settings.',
        'Public /stats page (English, French, Spanish).',
        'Discord link in the footer and settings.',
      ],
      es: [
        'Anuncios del desarrollador arriba del inicio.',
        'Top de directos en el idioma de tu dispositivo, ajustable en los ajustes.',
        'Página pública /stats (español, inglés, francés).',
        'Enlace al Discord en el pie de página y los ajustes.',
      ],
    },
  },
]
