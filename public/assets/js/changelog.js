// ═══════════════════════════════════════════════════════════════════════════
//  Nouveautés du site, de la plus récente à la plus ancienne. La clé suit
//  SITE_VERSION (usage.js) : à chaque nouvelle version, ajouter une entrée
//  en tête. Le site montre celles qu'on n'a pas encore vues.
// ═══════════════════════════════════════════════════════════════════════════

export const CHANGELOG = [
  {
    version: '2026.10.15a',
    items: {
      fr: [
        'Multi-live : jusqu’à quatre vidéos côte à côte, directs et VODs mêlés. Ajoute une VOD avec le « + » de sa carte ou en collant son lien dans la mosaïque ; elle reprend où tu en étais, et celle qui a le son a ses commandes (lecture, ±10 s, barre de position) et son chat rejoué. Le lien copié garde l’instant de chaque VOD.',
        'Qualité préférée (Réglages → Lecteur) : Auto, Source, 1080p… ou audio seul, pour chaque direct et chaque VOD (la plus proche en dessous si la chaîne ne l’a pas). « Auto » démarre plus haut, ne reste plus coincée en 360p et montre la qualité jouée (« Auto · 720p »).',
        'Direct : la vidéo ne change plus de vitesse pour rattraper le direct, elle fait au besoin un petit saut : le son reste calé sur l’image, aussi dans le multi-live. Après « −10 s », le lecteur ne te ramène plus tout seul au direct.',
        'Pauses pub de la chaîne : quand Twitch remplace le direct par son écran « Commercial break in progress », un bandeau l’explique avec un compte à rebours, et le son est coupé jusqu’au retour du direct (tu peux le remettre).',
        'Installe le site comme une app (Réglages → Installer l’app) : une icône sur l’écran d’accueil et sa propre fenêtre. Les notifications de live arrivent site fermé, sur iPhone et iPad aussi une fois le site installé (iOS 16.4 ou plus), plus vite quand on suit beaucoup de chaînes, et les Réglages disent si elles sont actives.',
        'Chat : le Train de la Hype s’affiche, même sans compte : la carte « En approche » avec son compte à rebours, puis le départ, le niveau en cours avec sa barre et le temps restant, et la fin.',
        'Masque une chaîne ou une catégorie avec l’œil barré de sa carte (avec « Annuler » ; tout se réaffiche depuis les Réglages) ; ce que tu suis ou épingles ne l’est jamais. Sans compte, « Charger plus » dépasse maintenant les 100 premiers (catégories, lives, clips et VODs d’une chaîne), et le Top des lives en a un aussi.',
        'VODs : vitesse de 0,25× à 2× (touches < et >), gardée d’une VOD à l’autre ; les directs restent à 1×. Les passages des VODs récentes qui ont gardé leur son ne sont plus annoncés « son coupé ».',
        'Chat : si tu es banni d’une chaîne, son chat continue en lecture seule (bandeau et bouton « Réessayer avec mon compte »). Et le chat se connecte en quelques secondes même quand une source d’emotes est lente (VPN, réseau filtré).',
        'Fiche des emotes plus riche : type (abonné niveau 1 à 3, points de chaîne…) et chaîne d’origine en un clic, auteur et lien pour BTTV, FFZ et 7TV ; elle s’ouvre aussi d’un clic droit dans le sélecteur. Les emotes FFZ animées bougent enfin.',
      ],
      en: [
        'Multi-live: up to four videos side by side, lives and VODs mixed. Add a VOD with the “+” on its card or by pasting its link into the mosaic; it resumes where you left off, and the one you hear has its controls (play, ±10 s, seek bar) and its replayed chat. The copied link keeps each VOD’s moment.',
        'Preferred quality (Settings → Player): Auto, Source, 1080p… or audio only, for every live and VOD (the closest one below if the channel doesn’t have it). “Auto” starts higher, no longer gets stuck at 360p and shows the quality actually playing (“Auto · 720p”).',
        'Lives: the video no longer changes speed to catch up with the live edge, it makes a small jump when needed, so the sound stays in sync with the picture, in multi-live too. After “−10 s”, the player no longer pulls you back to live on its own.',
        'Channel ad breaks: when Twitch replaces the live with its “Commercial break in progress” screen, a banner explains it with a countdown, and the sound is muted until the stream is back (you can turn it back on).',
        'Install the site as an app (Settings → Install the app): an icon on your home screen and its own window. Live notifications arrive with the site closed, on iPhone and iPad too once the site is installed (iOS 16.4 or later), faster when many channels are followed, and Settings show whether they’re on.',
        'Chat: the Hype Train now shows, even without an account: the “Incoming” card with its countdown, then the departure, the current level with its bar and time left, and the end.',
        'Hide a channel or a category with the crossed-out eye on its card (with “Undo”; show everything again from Settings); what you follow or pin is never hidden. Without an account, “Load more” now goes past the first 100 (categories, lives, a channel’s clips and VODs), and Top streams has one too.',
        'VODs: speed from 0.25× to 2× (< and > keys), kept from one VOD to the next; lives stay at 1×. Parts of recent VODs that kept their sound are no longer flagged “sound muted”.',
        'Chat: if you’re banned from a channel, its chat keeps going read-only (banner and a “Retry with my account” button). And the chat connects within a few seconds even when an emote source is slow (VPN, filtered network).',
        'Richer emote card: type (tier 1–3 sub, channel points…) and its channel one click away, author and link for BTTV, FFZ and 7TV; it also opens with a right-click in the picker. Animated FFZ emotes finally move.',
      ],
      es: [
        'Multi-live: hasta cuatro vídeos lado a lado, directos y VODs mezclados. Añade un VOD con el «+» de su tarjeta o pegando su enlace en el mosaico; se reanuda donde lo dejaste, y el que suena tiene sus controles (reproducir, ±10 s, barra de posición) y su chat repetido. El enlace copiado guarda el momento de cada VOD.',
        'Calidad preferida (Ajustes → Reproductor): Auto, Source, 1080p… o solo audio, para cada directo y cada VOD (la más cercana por debajo si el canal no la tiene). «Auto» empieza más alto, ya no se queda atascada en 360p y muestra la calidad que se reproduce («Auto · 720p»).',
        'Directos: el vídeo ya no cambia de velocidad para alcanzar el directo, da un pequeño salto si hace falta: el sonido sigue sincronizado con la imagen, también en el multi-live. Después de «−10 s», el reproductor ya no te devuelve solo al directo.',
        'Pausas publicitarias del canal: cuando Twitch sustituye el directo por su pantalla «Commercial break in progress», un aviso lo explica con una cuenta atrás, y el sonido se silencia hasta que vuelve el directo (puedes volver a activarlo).',
        'Instala el sitio como una app (Ajustes → Instalar la app): un icono en la pantalla de inicio y su propia ventana. Las notificaciones de directos llegan con el sitio cerrado, también en iPhone y iPad una vez instalado el sitio (iOS 16.4 o posterior), más rápido cuando se siguen muchos canales, y los Ajustes indican si están activas.',
        'Chat: el Tren del Hype ya se muestra, incluso sin cuenta: la tarjeta «Entrante» con su cuenta atrás, luego la salida, el nivel en curso con su barra y el tiempo restante, y el final.',
        'Oculta un canal o una categoría con el ojo tachado de su tarjeta (con «Deshacer»; todo vuelve a mostrarse desde los Ajustes); lo que sigues o fijas nunca se oculta. Sin cuenta, «Cargar más» ahora va más allá de los 100 primeros (categorías, directos, clips y VODs de un canal), y el Top de directos también lo tiene.',
        'VODs: velocidad de 0,25× a 2× (teclas < y >), conservada de un VOD a otro; los directos siguen a 1×. Las partes de los VODs recientes que conservan su sonido ya no se marcan «sonido silenciado».',
        'Chat: si te banean de un canal, su chat sigue en solo lectura (aviso y botón «Reintentar con mi cuenta»). Y el chat se conecta en pocos segundos aunque una fuente de emotes vaya lenta (VPN, red filtrada).',
        'Ficha de los emotes más completa: tipo (suscriptor nivel 1 a 3, puntos del canal…) y su canal a un clic, autor y enlace para BTTV, FFZ y 7TV; también se abre con clic derecho en el selector. Los emotes animados de FFZ por fin se mueven.',
      ],
      ru: [
        'Мульти-просмотр: до четырёх видео рядом, трансляции и VOD вперемешку. Добавьте VOD кнопкой «+» на его карточке или вставив ссылку в мозаику; он продолжается с того места, где вы остановились, а у того, что вы слышите, есть управление (воспроизведение, ±10 сек, полоса перемотки) и повтор чата. Скопированная ссылка сохраняет момент каждого VOD.',
        'Предпочтительное качество (Настройки → Плеер): Авто, Источник, 1080p… или только звук — для каждой трансляции и записи (ближайшее ниже, если на канале его нет). «Авто» стартует выше, больше не застревает на 360p и показывает реально воспроизводимое качество («Авто · 720p»).',
        'Трансляции: видео больше не меняет скорость, чтобы догнать прямой эфир, а при необходимости делает небольшой скачок — звук остаётся синхронным с картинкой, в том числе в мульти-просмотре. После «−10 с» плеер больше не возвращает вас к эфиру сам.',
        'Рекламные паузы канала: когда Twitch заменяет трансляцию своим экраном «Commercial break in progress», баннер объясняет это с обратным отсчётом, а звук отключается до возвращения трансляции (его можно включить).',
        'Установите сайт как приложение (Настройки → Установить приложение): значок на главном экране и отдельное окно. Уведомления о трансляциях приходят, даже когда сайт закрыт, — и на iPhone и iPad, если сайт установлен (iOS 16.4 и новее), быстрее при большом числе отслеживаемых каналов, а настройки показывают, включены ли они.',
        'Чат: теперь показывается Хайповоз, даже без аккаунта: карточка «Прибывает» с обратным отсчётом, затем отправление, текущий уровень с полосой и оставшимся временем, и финал.',
        'Скройте канал или категорию перечёркнутым глазом на карточке (с кнопкой «Отменить»; всё можно вернуть в настройках); то, что вы отслеживаете или закрепляете, никогда не скрывается. Без аккаунта «Загрузить ещё» теперь работает дальше первых 100 (категории, трансляции, клипы и записи канала), и под «Топом трансляций» она тоже есть.',
        'Записи: скорость от 0,25× до 2× (клавиши < и >) сохраняется между записями; трансляции идут со скоростью 1×. Фрагменты свежих записей, в которых звук сохранился, больше не помечаются «звук отключён».',
        'Чат: если вас забанили на канале, его чат продолжает работать только для чтения (баннер и кнопка «Повторить с моим аккаунтом»). А подключается чат за несколько секунд, даже если источник эмоутов медленный (VPN, фильтруемая сеть).',
        'Карточка эмоута подробнее: тип (для подписчиков уровня 1–3, за баллы канала…) и его канал в один клик, автор и ссылка для BTTV, FFZ и 7TV; открывается и правым кликом в панели эмоутов. Анимированные эмоуты FFZ наконец двигаются.',
      ],
    },
  },
  {
    version: '2026.10.12a',
    items: {
      fr: [
        'Thèmes : fond clair, sombre, noir OLED ou ardoise (ou celui de ton appareil), et sept couleurs d’accent, comme dans l’app (Réglages → Apparence).',
        'Épingle tes streamers préférés : la punaise sur leur carte (ou au bout de leur ligne hors ligne) les met en tête des suivies.',
        'Chat : une carte annonce les drops de la chaîne (récompense, temps de visionnage, échéance, détails) ; une fois fermée, elle ne revient pas.',
        'Chat : clique sur une emote ou un badge pour voir son nom exact et d’où il vient (Twitch, BetterTTV, FrankerFaceZ, 7TV), le copier ou l’ajouter à ton message.',
        'Emotes BetterTTV : les emotes personnelles des abonnés BTTV Pro s’affichent dès que BTTV les annonce, et celles ajoutées à la chaîne pendant le live apparaissent tout de suite.',
        'Direct : jamais à moins de 4 secondes du direct (plus près, la lecture pouvait se figer), même en avançant ou avec « Direct ».',
        'Direct : une coupure réseau passagère ne fait plus passer la vidéo par notre serveur pendant une semaine ; elle revient d’elle-même aux serveurs de Twitch dès qu’ils répondent.',
        'Mes signalements : un bandeau te prévient quand le développeur répond.',
        'Réglages : le choix de la langue ne déborde plus sur téléphone.',
      ],
      en: [
        'Themes: light, dark, OLED black or slate background (or your device’s), and seven accent colors, like in the app (Settings → Appearance).',
        'Pin your favourite streamers: the pin on their card (or at the end of their offline row) puts them at the top of Following.',
        'Chat: a card announces the channel’s drops (reward, watch time, end date, details); once dismissed, it doesn’t come back.',
        'Chat: click an emote or a badge to see its exact name and where it comes from (Twitch, BetterTTV, FrankerFaceZ, 7TV), copy it or add it to your message.',
        'BetterTTV emotes: personal emotes of BTTV Pro users show up once BTTV announces them, and emotes added to the channel during the stream appear right away.',
        'Live: never closer than 4 seconds to the edge (closer, playback could freeze), even when skipping ahead or pressing Live.',
        'Live: a brief network drop no longer sends the video through our server for a week; it goes back to Twitch’s own servers as soon as they answer.',
        'My reports: a banner lets you know when the developer replies.',
        'Settings: the language picker no longer overflows on phones.',
      ],
      es: [
        'Temas: fondo claro, oscuro, negro OLED o pizarra (o el de tu dispositivo), y siete colores de acento, como en la app (Ajustes → Apariencia).',
        'Fija a tus streamers favoritos: la chincheta de su tarjeta (o al final de su fila desconectada) los pone arriba en Seguidos.',
        'Chat: una tarjeta anuncia los drops del canal (recompensa, tiempo de visionado, fin, detalles); una vez cerrada, no vuelve.',
        'Chat: haz clic en un emote o una insignia para ver su nombre exacto y de dónde viene (Twitch, BetterTTV, FrankerFaceZ, 7TV), copiarlo o añadirlo a tu mensaje.',
        'Emotes de BetterTTV: los emotes personales de los suscriptores BTTV Pro aparecen en cuanto BTTV los anuncia, y los añadidos al canal durante el directo aparecen al momento.',
        'Directo: nunca a menos de 4 segundos del directo (más cerca, la reproducción podía congelarse), incluso al avanzar o con «Directo».',
        'Directo: un corte breve de la red ya no hace pasar el vídeo por nuestro servidor durante una semana; vuelve solo a los servidores de Twitch en cuanto responden.',
        'Mis reportes: un aviso te informa cuando el desarrollador responde.',
        'Ajustes: la elección del idioma ya no se desborda en el móvil.',
      ],
      ru: [
        'Темы: светлый, тёмный, чёрный OLED или сланцевый фон (или как на устройстве) и семь цветов акцента, как в приложении (Настройки → Оформление).',
        'Закрепляйте любимых стримеров: булавка на их карточке (или в конце строки офлайн) поднимает их наверх подписок.',
        'Чат: карточка сообщает о дропсах канала (награда, время просмотра, окончание, подробности); закрытая, она больше не появляется.',
        'Чат: щёлкните по эмоуту или значку, чтобы увидеть точное название и источник (Twitch, BetterTTV, FrankerFaceZ, 7TV), скопировать его или добавить в сообщение.',
        'Эмоуты BetterTTV: личные эмоуты подписчиков BTTV Pro появляются, как только BTTV их объявляет, а эмоуты, добавленные на канал во время трансляции, — сразу.',
        'Трансляции: никогда ближе 4 секунд к прямому эфиру (ближе воспроизведение могло зависать), даже при перемотке вперёд или кнопке «В эфир».',
        'Трансляции: кратковременный обрыв сети больше не направляет видео через наш сервер на неделю; оно само возвращается на серверы Twitch, как только они отвечают.',
        'Мои обращения: баннер сообщает, когда разработчик отвечает.',
        'Настройки: выбор языка больше не выходит за край экрана на телефоне.',
      ],
    },
  },
  {
    version: '2026.10.11b',
    items: {
      fr: ['Chat : les modes du salon (followers uniquement et depuis combien de temps, abonnés, mode lent…) s’affichent au-dessus du champ, les règles de la chaîne s’acceptent avant le premier message, et un message refusé par Twitch est retiré avec la raison.', 'Réglages experts : si le Worker de TwitchUnblock tombe, le site peut passer par le tien (déployé depuis le dépôt du site), en premier pour la lecture, ou pour tout.', 'Catégories : filtre les lives par langue (toutes, ou une seule), un choix gardé pour toutes les catégories.', 'Direct : choisis l’ordre des sources (Réglages → Lecteur). Si une source ne répond pas, la suivante prend le relais ; en choisir une dans le menu ⚙ du lecteur la met en tête.', 'Luminous Europe : « Source » donnait un écran noir sur les chaînes qui diffusent en multi-encodage (gotaga…) ; chaque qualité y garde maintenant son nom (1080p60…).', 'Mes signalements : nouvel état « Vu », quand ton message a été lu.', 'Notifications de live : une notification quand une chaîne que tu suis passe en live, même site fermé (Réglages → Notifications). Sur iPhone et iPad, ajoute d’abord le site à l’écran d’accueil.', 'Les VODs au nouveau format de Twitch retrouvent elles aussi le son d’origine des passages coupés.', 'Télécharge une VOD, ou juste un passage (de tel instant à tel autre, depuis là où tu en es, les 10 minutes suivantes), dans la qualité de ton choix : bouton « Télécharger » sous la vidéo. Les passages coupés pour musique protégée gardent leur son d’origine tant que Twitch l’a encore. Chrome et Edge l’écrivent directement sur le disque.', 'Multi-live : regarde jusqu’à quatre directs côte à côte. Le bouton « + » d’une carte de live (ou « Multi-live » sur la page d’une chaîne et sous le lecteur) les ajoute ; un clic sur un direct lui donne le son, double-clic pour le plein écran. Sur grand écran, son chat s’affiche à droite. Le lien de la mosaïque se partage.'],
      en: ['Chat: the room’s modes (followers only and for how long, subscribers only, slow mode…) show above the message box, the channel’s rules are accepted before your first message, and a message Twitch refuses is removed with the reason.', 'Expert settings: if TwitchUnblock’s Worker goes down, the site can use yours (deployed from the site’s repository), first for playback, or for everything.', 'Categories: filter the lives by language (all, or a single one), kept for every category.', 'Live: pick the order of the sources (Settings → Player). If a source doesn’t answer, the next one takes over; picking one from the player’s ⚙ menu moves it to the top.', 'Luminous Europe: “Source” gave a black screen on channels that stream with multiple encodes (gotaga…); each quality now keeps its own name (1080p60…).', 'My reports: a new “Seen” status, once your message has been read.', 'Live notifications: a notification when a channel you follow goes live, even with the site closed (Settings → Notifications). On iPhone and iPad, add the site to your Home Screen first.', 'VODs in Twitch’s new format get their muted parts’ original sound back too.', 'Download a VOD, or just a part of it (from one time to another, from where you are, the next 10 minutes), in the quality you pick: “Download” button under the video. Parts muted for copyrighted music keep their original sound while Twitch still has it. Chrome and Edge write it straight to disk.', 'Multi-live: watch up to four streams side by side. The “+” button on a live card (or “Multi-live” on a channel page and under the player) adds them; click a stream to hear it, double-click for fullscreen. On large screens, its chat shows on the right. The mosaic’s link can be shared.'],
      es: ['Chat: los modos de la sala (solo seguidores y desde cuándo, suscriptores, modo lento…) aparecen sobre el campo, las reglas del canal se aceptan antes del primer mensaje, y un mensaje rechazado por Twitch se retira con el motivo.', 'Ajustes avanzados: si el Worker de TwitchUnblock cae, el sitio puede usar el tuyo (desplegado desde el repositorio del sitio), primero para la reproducción, o para todo.', 'Categorías: filtra los directos por idioma (todos, o uno solo), una elección que se guarda para todas las categorías.', 'Directo: elige el orden de las fuentes (Ajustes → Reproductor). Si una fuente no responde, la siguiente toma el relevo; elegir una en el menú ⚙ del reproductor la pone primera.', 'Luminous Europa: «Source» daba pantalla negra en los canales que emiten con varias codificaciones (gotaga…); ahora cada calidad conserva su nombre (1080p60…).', 'Mis reportes: nuevo estado «Visto», cuando tu mensaje ha sido leído.', 'Notificaciones de directos: una notificación cuando un canal que sigues empieza un directo, incluso con el sitio cerrado (Ajustes → Notificaciones). En iPhone y iPad, añade primero el sitio a la pantalla de inicio.', 'Los VODs con el nuevo formato de Twitch también recuperan el sonido original de las partes silenciadas.', 'Descarga un VOD, o solo un fragmento (de un momento a otro, desde donde estás, los 10 minutos siguientes), en la calidad que elijas: botón «Descargar» bajo el vídeo. Las partes silenciadas por música protegida conservan su sonido original mientras Twitch lo tenga. Chrome y Edge lo escriben directamente en el disco.', 'Multi-live: mira hasta cuatro directos uno al lado del otro. El botón «+» de una tarjeta de directo (o «Multi-live» en la página de un canal y bajo el reproductor) los añade; haz clic en un directo para oírlo, doble clic para pantalla completa. En pantallas grandes, su chat aparece a la derecha. El enlace del mosaico se puede compartir.'],
      ru: ['Чат: режимы чата (только фолловеры и с какого срока, подписчики, медленный режим…) видны над полем ввода, правила канала принимаются перед первым сообщением, а отклонённое Twitch сообщение убирается с указанием причины.', 'Расширенные настройки: если Worker TwitchUnblock упадёт, сайт может работать через ваш (из репозитория сайта) — сначала для воспроизведения или для всего.', 'Категории: фильтр трансляций по языку (все или один), выбор сохраняется для всех категорий.', 'Трансляции: выберите порядок источников (Настройки → Плеер). Если источник не отвечает, его заменяет следующий; выбор источника в меню ⚙ плеера ставит его первым.', 'Luminous Европа: «Source» давал чёрный экран на каналах с несколькими кодировками (gotaga…); теперь у каждого качества своё название (1080p60…).', 'Мои обращения: новый статус «Просмотрено», когда ваше сообщение прочитано.', 'Уведомления о трансляциях: уведомление, когда отслеживаемый канал начинает трансляцию, даже если сайт закрыт (Настройки → Уведомления). На iPhone и iPad сначала добавьте сайт на экран «Домой».', 'VOD в новом формате Twitch тоже получают обратно оригинальный звук заглушённых фрагментов.', 'Скачивайте VOD целиком или только фрагмент (с одного момента до другого, с текущего места, следующие 10 минут) в выбранном качестве: кнопка «Скачать» под видео. Фрагменты, заглушённые из-за защищённой музыки, сохраняют оригинальный звук, пока он есть у Twitch. Chrome и Edge пишут файл прямо на диск.', 'Мульти-просмотр: смотрите до четырёх трансляций рядом. Кнопка «+» на карточке трансляции (или «Мульти-просмотр» на странице канала и под плеером) добавляет их; щелчок по трансляции включает её звук, двойной щелчок — полный экран. На большом экране справа показывается её чат. Ссылкой на мозаику можно поделиться.'],
    },
  },
  {
    version: '2026.10.11a',
    items: {
      fr: [
        'Direct : choisis la source (Luminous Asie, Luminous Europe, proxy albanais ou Twitch officiel) dans les réglages ou directement dans le menu ⚙ du lecteur, qui montre aussi celle en cours. Si elle ne répond pas, les autres prennent le relais.',
        'Les tags des lives (langue, DropsEnabled…) s’affichent sous les cartes et sous le titre du direct, comme sur Twitch.',
        'Catégories : jaquettes plus nettes.',
      ],
      en: [
        'Live: pick the source (Luminous Asia, Luminous Europe, Albania proxy or official Twitch) in the settings or right from the player’s ⚙ menu, which also shows the one in use. If it doesn’t answer, the others take over.',
        'Stream tags (language, DropsEnabled…) show under the cards and under the stream title, like on Twitch.',
        'Categories: sharper box art.',
      ],
      es: [
        'Directo: elige la fuente (Luminous Asia, Luminous Europa, proxy de Albania o Twitch oficial) en los ajustes o directamente en el menú ⚙ del reproductor, que también muestra la que está en uso. Si no responde, las demás toman el relevo.',
        'Las etiquetas de los directos (idioma, DropsEnabled…) aparecen bajo las tarjetas y bajo el título del directo, como en Twitch.',
        'Categorías: carátulas más nítidas.',
      ],
      ru: [
        'Трансляции: выбирайте источник (Luminous Азия, Luminous Европа, албанский прокси или официальный Twitch) в настройках или прямо в меню ⚙ плеера — там же видно, какой используется сейчас. Если он не отвечает, его заменяют остальные.',
        'Теги трансляций (язык, DropsEnabled…) показываются под карточками и под названием трансляции, как на Twitch.',
        'Категории: более чёткие обложки.',
      ],
    },
  },
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
