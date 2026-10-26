// ═══════════════════════════════════════════════════════════════════════════
//  Nouveautés du site, de la plus récente à la plus ancienne. La clé suit
//  SITE_VERSION (usage.js) : à chaque nouvelle version, ajouter une entrée
//  en tête. Le site montre celles qu'on n'a pas encore vues.
// ═══════════════════════════════════════════════════════════════════════════

export const CHANGELOG = [
  {
    version: '2026.10.26b',
    items: {
      fr: [
        'Réglages → « Reprendre les VODs » : coupé, le site ne retient plus où tu t’es arrêté dans une VOD (elles partent du début), et la rangée « Reprendre » comme la barre violette des vignettes disparaissent. Ce qui était gardé revient si tu le réactives.',
        'Direct bloqué après l’écran de pub de Twitch : quand l’image reste figée juste au moment où le son change de format, le lecteur repart au bout de 3 s au lieu de 30.',
        'Auto-hébergement (Docker) : la variable SITE_DEFAULTS fixe les réglages par défaut de tes visiteurs (langue, accueil, qualité…), un objet JSON avec les noms de la sauvegarde.',
      ],
      en: [
        'Settings → “Continue watching”: turned off, the site no longer remembers where you stopped in a VOD (they start from the beginning), and the Continue watching row and the purple bar on thumbnails go away. What was kept comes back if you turn it on again.',
        'Live stuck after Twitch’s ad screen: when the picture freezes right where the sound changes format, the player starts again after 3 s instead of 30.',
        'Self-hosting (Docker): the SITE_DEFAULTS variable sets your visitors’ default settings (language, home, quality…), as a JSON object with the backup’s names.',
      ],
      es: [
        'Ajustes → «Seguir viendo»: desactivado, el sitio ya no recuerda dónde te quedaste en un VOD (empiezan desde el principio), y desaparecen la fila «Seguir viendo» y la barra morada de las miniaturas. Lo guardado vuelve si lo reactivas.',
        'Directo atascado tras la pantalla de anuncios de Twitch: cuando la imagen se congela justo donde el sonido cambia de formato, el reproductor vuelve a empezar a los 3 s en lugar de 30.',
        'Autoalojamiento (Docker): la variable SITE_DEFAULTS fija los ajustes por defecto de tus visitantes (idioma, portada, calidad…), como un objeto JSON con los nombres de la copia de seguridad.',
      ],
      ru: [
        'Настройки → «Продолжить просмотр»: если выключить, сайт больше не запоминает, где вы остановились в записи (записи начинаются с начала), а ряд «Продолжить просмотр» и фиолетовая полоска на превью исчезают. Сохранённое вернётся, если включить снова.',
        'Трансляция зависает после рекламного экрана Twitch: если изображение застывает ровно там, где меняется формат звука, плеер перезапускается через 3 с вместо 30.',
        'Самостоятельный хостинг (Docker): переменная SITE_DEFAULTS задаёт настройки по умолчанию для ваших посетителей (язык, главная, качество…) — JSON-объект с названиями из резервной копии.',
      ],
      'zh-Hant': [
        '設定 →「繼續觀看」：關閉後，網站不再記住你在 VOD 停下的位置（VOD 會從頭開始），「繼續觀看」列與縮圖上的紫色進度條也會消失。重新開啟後，先前保留的紀錄會回來。',
        'Twitch 廣告畫面後直播卡住：若畫面剛好在聲音格式改變的地方凍結，播放器會在 3 秒後重新開始，而不是 30 秒。',
        '自行架設（Docker）：SITE_DEFAULTS 變數可設定訪客的預設設定（語言、首頁、畫質…），格式為使用備份名稱的 JSON 物件。',
      ],
    },
  },
  {
    version: '2026.10.26a',
    items: {
      fr: [
        'Direct réservé à certains pays : quand Twitch limite un live à quelques pays (droits de diffusion, comme un match de NFL) et qu’aucune de nos sources n’y a accès, le site le dit clairement au lieu de « aucune source ne répond ».',
        'Son déformé après une pause pub : sur certaines chaînes, la voix du streamer revenait comme passée dans un « voice changer » après l’écran « Commercial break in progress ». Quand le son change de format entre l’écran de Twitch et le direct, le lecteur repart à neuf, au bon format.',
      ],
      en: [
        'Lives kept to some countries: when Twitch limits a live to a few countries (broadcast rights, like an NFL game) and none of our sources can reach it, the site now says so clearly instead of “no source is answering”.',
        'Distorted sound after an ad break: on some channels, the streamer’s voice came back as if through a voice changer after the “Commercial break in progress” screen. When the sound changes format between Twitch’s screen and the live, the player now starts afresh in the right format.',
      ],
      es: [
        'Directos limitados a algunos países: cuando Twitch limita un directo a unos pocos países (derechos de emisión, como un partido de la NFL) y ninguna de nuestras fuentes tiene acceso, el sitio ahora lo dice claramente en lugar de «ninguna fuente responde».',
        'Sonido distorsionado tras una pausa publicitaria: en algunos canales, la voz del streamer volvía como si pasara por un modulador de voz tras la pantalla «Commercial break in progress». Cuando el sonido cambia de formato entre la pantalla de Twitch y el directo, el reproductor ahora vuelve a empezar en el formato correcto.',
      ],
      ru: [
        'Трансляции только для некоторых стран: когда Twitch ограничивает трансляцию несколькими странами (права на трансляцию, например матч НФЛ) и ни один из наших источников не имеет к ней доступа, сайт теперь прямо говорит об этом вместо «ни один источник не отвечает».',
        'Искажённый звук после рекламной паузы: на некоторых каналах голос стримера после экрана «Commercial break in progress» звучал будто через модулятор голоса. Когда звук меняет формат между экраном Twitch и трансляцией, плеер теперь перезапускается в правильном формате.',
      ],
      'zh-Hant': [
        '限定部分國家的直播：當 Twitch 只在少數國家開放某場直播（轉播權，例如 NFL 比賽），而我們的來源都無法存取時，網站現在會清楚說明，而不是顯示「沒有來源回應」。',
        '廣告時段後聲音失真：在某些頻道，「Commercial break in progress」畫面結束後，實況主的聲音聽起來像經過變聲器。當 Twitch 畫面與直播之間的聲音格式不同時，播放器現在會以正確的格式重新開始。',
      ],
    },
  },
  {
    version: '2026.10.25c',
    items: {
      fr: [
        'TwitchUnblock Connect : l’extension ne se met pas à jour toute seule (elle s’installe à la main depuis GitHub). Quand une version plus récente que la tienne est sortie, une ligne discrète en haut du site le dit — « TwitchUnblock Connect 0.2.0 est disponible (tu as 0.1.0) » —, avec le lien de téléchargement et, sous « Comment mettre à jour ? », la marche à suivre pour ton navigateur : remplacer le contenu du dossier puis recharger l’extension sous Chrome, Edge ou Brave, la réinstaller avec le nouveau zip sous Firefox. Fermée, elle ne revient plus pour cette version.',
        'Comptage d’usage : le signal du site dit aussi si l’extension TwitchUnblock Connect est là, avec sa version et son navigateur (Chrome, Firefox ou autre) — rien de ses réglages ni de ta session Twitch. La page /stats montre combien de personnes l’utilisent (aujourd’hui, sur 7 et 30 jours), par version et par navigateur. Comme le reste du comptage, Réglages → Utilisation → « Partager mon utilisation » le coupe.',
      ],
      en: [
        'TwitchUnblock Connect: the extension doesn’t update itself (it’s installed by hand from GitHub). When a newer version than yours is out, a discreet line at the top of the site says so — “TwitchUnblock Connect 0.2.0 is available (you have 0.1.0)” —, with the download link and, under “How to update?”, the steps for your browser: replace the folder’s content then reload the extension in Chrome, Edge or Brave, install it again from the new zip in Firefox. Once closed, it doesn’t come back for that version.',
        'Usage count: the site’s signal now also says whether the TwitchUnblock Connect extension is there, with its version and its browser (Chrome, Firefox or other) — nothing of its settings or your Twitch session. The /stats page shows how many people use it (today, over 7 and 30 days), by version and by browser. Like the rest of the count, Settings → Usage → “Share my usage” turns it off.',
      ],
      es: [
        'TwitchUnblock Connect: la extensión no se actualiza sola (se instala a mano desde GitHub). Cuando sale una versión más reciente que la tuya, una línea discreta arriba del sitio lo indica — «TwitchUnblock Connect 0.2.0 está disponible (tienes la 0.1.0)» —, con el enlace de descarga y, en «¿Cómo actualizar?», los pasos para tu navegador: sustituir el contenido de la carpeta y recargar la extensión en Chrome, Edge o Brave, volver a instalarla con el nuevo zip en Firefox. Una vez cerrada, no vuelve para esa versión.',
        'Recuento de uso: la señal del sitio indica también si está la extensión TwitchUnblock Connect, con su versión y su navegador (Chrome, Firefox u otro) — nada de sus ajustes ni de tu sesión de Twitch. La página /stats muestra cuántas personas la usan (hoy, en 7 y 30 días), por versión y por navegador. Como el resto del recuento, Ajustes → Uso → «Compartir mi uso» lo desactiva.',
      ],
      ru: [
        'TwitchUnblock Connect: расширение не обновляется само (оно устанавливается вручную с GitHub). Когда выходит версия новее вашей, вверху сайта появляется неброская строка — «Доступна версия TwitchUnblock Connect 0.2.0 (у вас 0.1.0)» — со ссылкой для скачивания, а в разделе «Как обновить?» — шаги для вашего браузера: в Chrome, Edge или Brave заменить содержимое папки и перезагрузить расширение, в Firefox — установить его заново из нового zip-архива. Если её закрыть, для этой версии она больше не появится.',
        'Статистика использования: сигнал сайта теперь сообщает и о том, установлено ли расширение TwitchUnblock Connect, — его версию и браузер (Chrome, Firefox или другой), но ничего из его настроек и вашей сессии Twitch. Страница /stats показывает, сколько людей им пользуется (сегодня, за 7 и 30 дней), по версиям и браузерам. Как и остальной подсчёт, это отключается в «Настройки → Статистика → Делиться статистикой».',
      ],
      'zh-Hant': [
        'TwitchUnblock Connect：擴充功能不會自動更新（它是從 GitHub 手動安裝的）。當有比你更新的版本推出時，網站頂端會出現一行不顯眼的提示——「TwitchUnblock Connect 0.2.0 已推出（你目前是 0.1.0）」——附上下載連結，並在「如何更新？」中說明你的瀏覽器該怎麼做：在 Chrome、Edge 或 Brave 中取代資料夾內容後重新載入擴充功能；在 Firefox 中用新的 zip 重新安裝。關閉後，這個版本就不會再出現。',
        '使用量統計：網站送出的訊號現在也會說明是否裝有 TwitchUnblock Connect 擴充功能，以及它的版本與瀏覽器（Chrome、Firefox 或其他）——不含它的任何設定，也不含你的 Twitch 工作階段。/stats 頁面會顯示有多少人在使用它（今天、7 天與 30 天內），並依版本與瀏覽器分列。和其他統計一樣，可在「設定 → 使用量 → 分享我的使用資料」中關閉。',
      ],
    },
  },
  {
    version: '2026.10.25b',
    items: {
      fr: [
        'Qualités supérieures (1440p et plus) avec l’extension TwitchUnblock Connect 0.2.0 : Réglages → Lecteur → « Qualités supérieures ». Sur les chaînes qui diffusent au-dessus de 1080p (Enhanced Broadcasting), le direct passe par ton compte Twitch et le menu des qualités propose « 1440p60 (Source) »… ; HEVC et AV1 seulement si ton navigateur les décode en matériel. Sans abonnement ni Turbo, pendant les pauses pub de Twitch, la lecture passe sur la source habituelle (1080p au plus) sans pub, puis revient. Ta session Twitch reste dans l’extension : le site ne reçoit que les playlists du direct, réécrites. Pas dans le multi-live.',
        'Mets l’extension à jour (Réglages → TwitchUnblock Connect → Page de l’extension) : la 0.2.0 fait aussi de nouveau avancer les drops, Twitch ayant changé l’adresse de ses playlists.',
      ],
      en: [
        'Higher qualities (1440p and above) with the TwitchUnblock Connect extension 0.2.0: Settings → Player → “Higher qualities”. On channels streaming above 1080p (Enhanced Broadcasting), the live goes through your Twitch account and the quality menu offers “1440p60 (Source)”…; HEVC and AV1 only when your browser decodes them in hardware. Without a sub or Turbo, during Twitch ad breaks, playback switches to the usual source (1080p at most) without ads, then comes back. Your Twitch session stays in the extension: the site only gets the live’s playlists, rewritten. Not in multi-live.',
        'Update the extension (Settings → TwitchUnblock Connect → Extension page): 0.2.0 also gets drops moving again, as Twitch moved its playlists to a new address.',
      ],
      es: [
        'Calidades superiores (1440p o más) con la extensión TwitchUnblock Connect 0.2.0: Ajustes → Reproductor → «Calidades superiores». En los canales que emiten por encima de 1080p (Enhanced Broadcasting), el directo pasa por tu cuenta de Twitch y el menú de calidades ofrece «1440p60 (Source)»…; HEVC y AV1 solo si tu navegador los decodifica por hardware. Sin suscripción ni Turbo, durante las pausas publicitarias de Twitch, la reproducción pasa a la fuente habitual (1080p como máximo) sin anuncios y luego vuelve. Tu sesión de Twitch se queda en la extensión: el sitio solo recibe las playlists del directo, reescritas. No en el multi-live.',
        'Actualiza la extensión (Ajustes → TwitchUnblock Connect → Página de la extensión): la 0.2.0 también vuelve a hacer avanzar los drops, ya que Twitch cambió la dirección de sus playlists.',
      ],
      ru: [
        'Повышенное качество (1440p и выше) с расширением TwitchUnblock Connect 0.2.0: Настройки → Плеер → «Повышенное качество». На каналах, вещающих выше 1080p (Enhanced Broadcasting), трансляция идёт через ваш аккаунт Twitch, а в меню качества появляются «1440p60 (Source)» и другие; HEVC и AV1 — только если браузер декодирует их аппаратно. Без подписки и Turbo во время рекламных пауз Twitch воспроизведение переходит на обычный источник (не выше 1080p) без рекламы, а затем возвращается. Ваша сессия Twitch остаётся в расширении: сайт получает только переписанные плейлисты трансляции. Не в мульти-просмотре.',
        'Обновите расширение (Настройки → TwitchUnblock Connect → Страница расширения): версия 0.2.0 также снова продвигает дропы — Twitch сменил адрес своих плейлистов.',
      ],
      'zh-Hant': [
        '更高畫質（1440p 以上），需搭配 TwitchUnblock Connect 擴充功能 0.2.0：設定 → 播放器 →「更高畫質」。在 1080p 以上播出的頻道（Enhanced Broadcasting），直播會走你的 Twitch 帳號，畫質選單會出現「1440p60 (Source)」等選項；HEVC 與 AV1 只在瀏覽器能以硬體解碼時提供。沒有訂閱或 Turbo 時，Twitch 廣告時間會切到平常的來源（最高 1080p）無廣告播放，結束後再切回。你的 Twitch 工作階段留在擴充功能裡：網站只會收到改寫過的直播播放清單。多直播不適用。',
        '請更新擴充功能（設定 → TwitchUnblock Connect → 擴充功能頁面）：0.2.0 也讓掉寶進度重新推進——Twitch 更改了播放清單的位址。',
      ],
    },
  },
  {
    version: '2026.10.25a',
    items: {
      fr: [
        'Sélecteur d’emotes : nouvel onglet « Mes emotes », en tête, quand tu es connecté au chat. Il réunit toutes les emotes Twitch que ton compte peut utiliser sur n’importe quelle chaîne — celles des chaînes où tu es abonné, Prime, Turbo et les globales —, rangées par chaîne avec son avatar : celle que tu regardes d’abord, les autres par ordre alphabétique, puis Twitch. Un clic en ajoute une à ton message, et la recherche du sélecteur les trouve aussi. Les onglets « Cette chaîne » et « Globales » remplacent les deux parties de la liste ; celui de la chaîne s’ouvre toujours en premier.',
      ],
      en: [
        'Emote picker: a new “Mine” tab, first, when you’re logged in to the chat. It gathers every Twitch emote your account can use on any channel — those of the channels you’re subscribed to, Prime, Turbo and the global ones —, grouped by channel with its avatar: the one you’re watching first, the others alphabetically, then Twitch. A click adds one to your message, and the picker’s search finds them too. “This channel” and “Global” tabs replace the list’s two parts; the channel’s tab still opens first.',
      ],
      es: [
        'Selector de emotes: nueva pestaña «Mis emotes», la primera, cuando has iniciado sesión en el chat. Reúne todos los emotes de Twitch que tu cuenta puede usar en cualquier canal — los de los canales a los que estás suscrito, Prime, Turbo y los globales —, agrupados por canal con su avatar: el que estás viendo primero, los demás por orden alfabético y luego Twitch. Un clic añade uno a tu mensaje, y la búsqueda del selector también los encuentra. Las pestañas «Este canal» y «Globales» sustituyen las dos partes de la lista; la del canal sigue abriéndose primero.',
      ],
      ru: [
        'Окно выбора эмоутов: новая вкладка «Мои эмоуты» — первая, когда вы вошли в чат. В ней собраны все эмоуты Twitch, которые ваш аккаунт может использовать на любом канале, — эмоуты каналов, на которые вы подписаны, Prime, Turbo и глобальные, — по каналам, с аватаром: сначала канал, который вы смотрите, затем остальные по алфавиту, потом Twitch. Нажатие добавляет эмоут в сообщение, и поиск в окне выбора их тоже находит. Вкладки «Этот канал» и «Глобальные» заменяют две части списка; вкладка канала по-прежнему открывается первой.',
      ],
      'zh-Hant': [
        '表情符號選擇器：登入聊天室後，最前面新增「我的表情符號」分頁。它收集你的帳號在任何頻道都能使用的所有 Twitch 表情符號——你訂閱的頻道的表情符號、Prime、Turbo 與全域表情符號——依頻道分組並附上頭像：先是你正在觀看的頻道，其他頻道依字母順序排列，最後是 Twitch。點一下即可加入訊息，選擇器的搜尋也找得到它們。「本頻道」與「全域」分頁取代原本清單的兩個部分；頻道分頁仍會最先開啟。',
      ],
    },
  },
  {
    version: '2026.10.23a',
    items: {
      fr: [
        'Commandes des bots d’une chaîne hors ligne : sa page a maintenant un bouton « Commandes des bots », sous « Hors ligne », qui ouvre la même liste que dans le chat — Nightbot, StreamElements, Fossabot et Moobot, avec la recherche —, et un clic copie la commande. Le chat du lecteur ouvert sur une chaîne hors ligne y donne accès aussi. Jusqu’ici, la liste n’était là que pendant un direct.',
      ],
      en: [
        'Bot commands of an offline channel: its page now has a “Bot commands” button, under “Offline”, that opens the same list as in the chat — Nightbot, StreamElements, Fossabot and Moobot, with search —, and a click copies the command. The player’s chat, when opened on an offline channel, gives access to it too. Until now, the list was only there during a live.',
      ],
      es: [
        'Comandos de bots de un canal desconectado: su página tiene ahora un botón «Comandos de bots», bajo «Desconectado», que abre la misma lista que en el chat — Nightbot, StreamElements, Fossabot y Moobot, con la búsqueda —, y un clic copia el comando. El chat del reproductor abierto en un canal desconectado también da acceso a ella. Hasta ahora, la lista solo estaba disponible durante un directo.',
      ],
      ru: [
        'Команды ботов канала не в сети: на его странице теперь есть кнопка «Команды ботов» (под «Не в сети»), которая открывает тот же список, что и в чате, — Nightbot, StreamElements, Fossabot и Moobot, с поиском, — а нажатие копирует команду. Чат плеера, открытого на канале не в сети, тоже даёт к нему доступ. Раньше список был доступен только во время эфира.',
      ],
      'zh-Hant': [
        '離線頻道的機器人指令：頻道頁的「離線」下方新增「機器人指令」按鈕，會開啟和聊天室中相同的清單（Nightbot、StreamElements、Fossabot 與 Moobot，可搜尋），點一下即可複製指令。在離線頻道上開啟的播放器聊天室也能使用。以前只有直播時才看得到這份清單。',
      ],
    },
  },
  {
    version: '2026.10.22a',
    items: {
      fr: [
        'Directs sur iPad (et Safari sur Mac) : le lecteur tient maintenant lui-même la mémoire vidéo des directs aussi, comme pour les VODs, avec une version plus récente de son moteur (hls.js 1.5.20). Sur iPad, un long direct faisait encore planter Safari au bout de quelques minutes, au point de devoir le quitter pour qu’il reparte.',
        'Longs directs, suite : sur iPad et iPhone, le chat garde 150 messages au lieu de 300, comme Twitch — chaque emote animée encore dans la page pèse sur la mémoire de Safari —, seuls les derniers GIF restent des images (les plus anciens redeviennent leur texte), et le sélecteur d’emotes se vide une fois fermé.',
        'VODs dans Safari sur Mac (et iPad) : la lecture ne se met plus à saccader au bout d’un moment. Le lecteur tient lui-même sa mémoire vidéo au lieu de laisser Safari l’interrompre toutes les 20 secondes environ, et une VOD ne reste plus figée après un saut sous Safari 27.',
        'Le journal des erreurs (Réglages → À propos, joint à tes signalements) note maintenant l’état de la lecture quand elle se met à saccader — décrochages, images perdues, mémoire tampon, réparations — et au moment où tu signales un problème : de quoi comprendre un saccadement qui ne laisse aucune erreur. Rien de personnel n’y figure.',
        'Masquer une emote : clique dessus dans le chat (ou appuie longuement), puis « Masquer cette emote » dans sa fiche — elle s’affiche ensuite comme son mot, quelle que soit sa source, en direct comme dans le chat des VODs. Réglages → Chat → « Emotes masquées » pour les retrouver et les réafficher. La liste suit ton compte (réglages synchronisés), app iPhone comprise.',
        'Le site existe maintenant en chinois traditionnel (繁體中文), grâce à trend0522 : un navigateur réglé en chinois l’ouvre directement dans cette langue, et Réglages → Langue permet d’en changer.',
      ],
      en: [
        'Lives on iPad (and Safari on Mac): the player now keeps the video buffer of lives itself too, like VODs, with a newer version of its engine (hls.js 1.5.20). On iPad, a long live still crashed Safari after a few minutes, to the point of having to quit it to get it going again.',
        'Long lives, continued: on iPad and iPhone the chat keeps 150 messages instead of 300, like Twitch — every animated emote still in the page weighs on Safari’s memory —, only the latest GIFs stay images (older ones turn back into their text), and the emote picker empties once closed.',
        'VODs in Safari on Mac (and iPad): playback no longer starts stuttering after a while. The player now keeps its video buffer itself instead of letting Safari interrupt it every 20 seconds or so, and a VOD no longer freezes after a jump in Safari 27.',
        'The error log (Settings → About, attached to your reports) now notes the playback’s state when it starts stuttering — stalls, dropped frames, buffer, repairs — and when you report a problem: enough to understand stutter that leaves no error behind. Nothing personal goes in it.',
        'Hide an emote: click it in the chat (or long-press it), then “Hide this emote” in its card — from then on it shows as its word, whatever its source, in lives and in the VOD chat. Settings → Chat → “Hidden emotes” lists them so you can show them again. The list follows your account (synced settings), iPhone app included.',
        'The site now speaks Traditional Chinese (繁體中文), thanks to trend0522: a browser set to Chinese opens it in that language, and Settings → Language lets you switch.',
      ],
      es: [
        'Directos en iPad (y Safari en Mac): el reproductor ahora gestiona él mismo la memoria de vídeo también en los directos, como en los VOD, con una versión más reciente de su motor (hls.js 1.5.20). En iPad, un directo largo seguía haciendo que Safari se cerrara a los pocos minutos, hasta el punto de tener que salir de él para que volviera a funcionar.',
        'Directos largos, continuación: en iPad y iPhone el chat guarda 150 mensajes en lugar de 300, como Twitch — cada emote animado que sigue en la página pesa en la memoria de Safari —, solo los últimos GIF siguen siendo imágenes (los más antiguos vuelven a ser su texto) y el selector de emotes se vacía al cerrarse.',
        'VOD en Safari en Mac (y iPad): la reproducción ya no empieza a dar tirones al cabo de un rato. El reproductor gestiona él mismo su memoria de vídeo en lugar de dejar que Safari la interrumpa cada 20 segundos más o menos, y un VOD ya no se queda congelado tras un salto en Safari 27.',
        'El registro de errores (Ajustes → Acerca de, adjunto a tus reportes) anota ahora el estado de la reproducción cuando empieza a dar tirones — cortes, fotogramas perdidos, búfer, reparaciones — y cuando reportas un problema: lo necesario para entender unos tirones que no dejan ningún error. No incluye nada personal.',
        'Ocultar un emote: haz clic en él en el chat (o mantenlo pulsado) y luego en «Ocultar este emote» en su ficha — a partir de ahí se muestra como su palabra, sea cual sea su origen, en directo y en el chat de los VOD. Ajustes → Chat → «Emotes ocultos» los reúne para volver a mostrarlos. La lista sigue a tu cuenta (ajustes sincronizados), app de iPhone incluida.',
        'El sitio ya está en chino tradicional (繁體中文), gracias a trend0522: un navegador configurado en chino lo abre directamente en ese idioma, y Ajustes → Idioma permite cambiarlo.',
      ],
      ru: [
        'Эфиры на iPad (и в Safari на Mac): плеер теперь сам управляет видеобуфером и в эфирах, как в VOD, с более новой версией своего движка (hls.js 1.5.20). На iPad долгий эфир всё ещё через несколько минут приводил к падению Safari — настолько, что его приходилось закрывать, чтобы всё снова заработало.',
        'Долгие эфиры, продолжение: на iPad и iPhone чат хранит 150 сообщений вместо 300, как Twitch, — каждый анимированный эмоут, оставшийся на странице, занимает память Safari, — картинками остаются только последние GIF (более старые снова становятся текстом), а окно выбора эмоутов очищается после закрытия.',
        'VOD в Safari на Mac (и iPad): воспроизведение больше не начинает дёргаться через некоторое время. Плеер теперь сам управляет своим видеобуфером, а не позволяет Safari прерывать его примерно каждые 20 секунд, и VOD больше не замирает после перемотки в Safari 27.',
        'Журнал ошибок (Настройки → О проекте, прикрепляется к вашим сообщениям) теперь записывает состояние воспроизведения, когда оно начинает дёргаться, — подвисания, пропущенные кадры, буфер, восстановления — и в момент, когда вы сообщаете о проблеме: этого хватает, чтобы разобраться в рывках, которые не оставляют ошибок. Ничего личного туда не попадает.',
        'Скрыть эмоут: нажмите на него в чате (или удерживайте), затем «Скрыть этот эмоут» в его карточке — дальше он показывается словом, откуда бы он ни был, и в эфире, и в чате VOD. Настройки → Чат → «Скрытые эмоуты» — их список, чтобы вернуть их. Список следует за вашим аккаунтом (синхронизация настроек), включая приложение для iPhone.',
        'Сайт теперь доступен на традиционном китайском (繁體中文) — спасибо trend0522: браузер с китайским языком сразу открывает его на нём, а сменить язык можно в Настройки → Язык.',
      ],
      'zh-Hant': [
        'iPad（以及 Mac 上的 Safari）的直播：播放器現在也像 VOD 一樣，自己管理直播的影片緩衝，並換上較新版本的播放引擎（hls.js 1.5.20）。在 iPad 上，長時間的直播仍會在幾分鐘後讓 Safari 當掉，甚至得完全關閉 Safari 才能恢復。',
        '長時間直播（續）：在 iPad 與 iPhone 上，聊天室只保留 150 則訊息而不是 300 則，和 Twitch 一樣——頁面上每個還在的動態表情符號都會佔用 Safari 的記憶體——只有最新的幾張 GIF 會保留為圖片（較舊的會變回文字），表情符號選單關閉後也會清空。',
        'Mac（與 iPad）上 Safari 的 VOD：播放不會再過一陣子就開始卡頓。播放器改為自己管理影片緩衝，不再讓 Safari 大約每 20 秒打斷一次；在 Safari 27 中跳轉後，VOD 也不會再卡住不動。',
        '錯誤日誌（設定 → 關於，會附在你的回報中）現在會在播放開始卡頓時記錄播放狀態——停頓、掉格、緩衝、修復——以及你回報問題的當下：足以了解那些沒留下任何錯誤的卡頓。其中不含任何個人資料。',
        '隱藏表情符號：在聊天室點一下它（或長按），再在它的資訊卡中點「隱藏這個表情符號」——之後不論來源，它都會顯示為文字，直播與 VOD 聊天室都一樣。在「設定 → 聊天室 → 已隱藏的表情符號」可以找到並重新顯示。這份清單會跟著你的帳號（同步設定），iPhone app 也一樣。',
        '網站現在提供繁體中文版，感謝 trend0522：瀏覽器設為中文時會直接以中文開啟，也可以在「設定 → 語言」切換。',
      ],
    },
  },
  {
    version: '2026.10.20d',
    items: {
      fr: [
        'TwitchUnblock Connect, une extension pour ton navigateur d’ordinateur (Réglages → TwitchUnblock Connect, avec le lien d’installation) : pendant un direct, le site gagne enfin tes points de chaîne en regardant (solde et série de visionnage en haut du chat), réclame les coffres — ou te laisse le faire d’un clic —, rejoint les raids pour leur bonus, et te laisse miser sur les prédictions (montant, puis confirmation) et voter aux sondages Twitch, depuis le chat du lecteur. Ta session Twitch reste dans l’extension : rien ne passe par les serveurs de TwitchUnblock. Sans l’extension, rien ne change.',
        'TwitchUnblock Connect, suite : en touchant ton solde, les récompenses de la chaîne (grisées si tes points manquent, ou si elles sont en pause, épuisées ou en recharge, avec le temps restant), à échanger après une confirmation — avec ton message quand la récompense en demande un. Et les drops : la carte de la campagne montre ta progression par drop (barre et minutes), ce qui est réclamé et un bouton « Réclamer » ; pendant que tu regardes, l’extension fait avancer les drops (et les réclame d’elle-même si tu l’as choisi), avec un petit avis à chaque drop réclamé.',
        'Longs directs : le lecteur garde bien moins de vidéo en mémoire — derrière l’image, 10 s au lieu de 90 sur iPad et iPhone (30 s sur ordinateur), et l’avance est bornée elle aussi —, et le chat n’empile plus des milliers de messages quand la page est masquée. Sur iPad, un direct en 1080p faisait planter Safari toutes les 20 minutes environ.',
        'Lecture bloquée : après une erreur que le lecteur ne sait pas réparer, ou un direct figé 30 s sans aucune erreur, il repart de lui-même (trois fois en 5 minutes au plus) au lieu de rester figé jusqu’au rechargement de la page. Si c’est la chaîne qui n’envoie plus d’images (coupure ou reconnexion du streamer), il attend simplement que le direct reprenne, et le chat synchronisé continue de défiler au lieu d’empiler ses messages jusqu’à la reprise.',
      ],
      en: [
        'TwitchUnblock Connect, an extension for your desktop browser (Settings → TwitchUnblock Connect, with the install link): during a live, the site now earns your channel points while you watch (balance and watch streak at the top of the chat), claims the bonus chests — or lets you do it in one click —, joins raids for their bonus, and lets you bet on predictions (amount, then confirmation) and vote in Twitch polls, right from the player’s chat. Your Twitch session stays in the extension: nothing goes through TwitchUnblock’s servers. Without the extension, nothing changes.',
        'TwitchUnblock Connect, continued: tap your balance for the channel’s rewards (greyed out when you’re short on points, or when they’re paused, out of stock or on cooldown, with the time left), redeemed after a confirmation — with your message when the reward asks for one. And drops: the campaign card shows your progress for each drop (bar and minutes), what’s claimed and a “Claim” button; while you watch, the extension moves the drops forward (and claims them itself if you chose so), with a small notice for each drop claimed.',
        'Long lives: the player keeps much less video in memory — behind the picture, 10 s instead of 90 on iPad and iPhone (30 s on a computer), and what it loads ahead is capped too — and the chat no longer piles up thousands of messages while the page is hidden. On iPad, a 1080p live used to crash Safari every 20 minutes or so.',
        'Stuck playback: after an error the player can’t repair, or a live frozen for 30 s without any error, it restarts on its own (up to three times in 5 minutes) instead of staying frozen until you reload the page. When it’s the channel that stops sending video (the streamer’s connection dropped or is reconnecting), it simply waits for the live to resume, and the synced chat keeps flowing instead of piling up its messages until then.',
      ],
      es: [
        'TwitchUnblock Connect, una extensión para el navegador de tu ordenador (Ajustes → TwitchUnblock Connect, con el enlace de instalación): durante un directo, el sitio por fin gana tus puntos del canal mientras miras (saldo y racha de visualización arriba del chat), reclama los cofres — o te deja hacerlo con un clic —, se une a los raids para conseguir su bonificación y te deja apostar en las predicciones (cantidad y luego confirmación) y votar en las encuestas de Twitch, desde el chat del reproductor. Tu sesión de Twitch se queda en la extensión: nada pasa por los servidores de TwitchUnblock. Sin la extensión, no cambia nada.',
        'TwitchUnblock Connect, continuación: toca tu saldo para ver las recompensas del canal (en gris si te faltan puntos, o si están en pausa, agotadas o en recarga, con el tiempo restante), que se canjean tras una confirmación — con tu mensaje cuando la recompensa lo pide. Y los drops: la tarjeta de la campaña muestra tu progreso en cada drop (barra y minutos), lo que ya está reclamado y un botón «Reclamar»; mientras miras, la extensión hace avanzar los drops (y los reclama sola si así lo elegiste), con un pequeño aviso por cada drop reclamado.',
        'Directos largos: el reproductor guarda mucho menos vídeo en memoria — detrás de la imagen, 10 s en lugar de 90 en iPad y iPhone (30 s en el ordenador), y lo que carga por adelantado también tiene un límite —, y el chat ya no acumula miles de mensajes mientras la página está oculta. En iPad, un directo en 1080p hacía que Safari se cerrara cada 20 minutos más o menos.',
        'Reproducción bloqueada: tras un error que el reproductor no sabe reparar, o un directo congelado 30 s sin ningún error, vuelve a arrancar solo (tres veces en 5 minutos como máximo) en lugar de quedarse congelado hasta que recargues la página. Si es el canal el que deja de enviar imagen (corte o reconexión del streamer), simplemente espera a que el directo se reanude, y el chat sincronizado sigue avanzando en lugar de acumular sus mensajes hasta entonces.',
      ],
      ru: [
        'TwitchUnblock Connect — расширение для браузера на компьютере (Настройки → TwitchUnblock Connect, там же ссылка для установки): во время эфира сайт теперь начисляет вам баллы канала за просмотр (баланс и серия просмотров вверху чата), забирает сундуки — или даёт сделать это одним нажатием, — присоединяется к рейдам ради их бонуса и позволяет делать ставки в прогнозах (сумма, затем подтверждение) и голосовать в опросах Twitch прямо из чата плеера. Ваша сессия Twitch остаётся в расширении: ничего не проходит через серверы TwitchUnblock. Без расширения ничего не меняется.',
        'TwitchUnblock Connect, продолжение: нажмите на баланс, чтобы увидеть награды канала (серые, если не хватает баллов или если награда на паузе, закончилась или перезаряжается, с оставшимся временем); обмен — после подтверждения и с вашим сообщением, если награда его требует. И дропы: карточка кампании показывает ваш прогресс по каждому дропу (полоса и минуты), что уже получено, и кнопку «Забрать»; пока вы смотрите, расширение продвигает дропы (и само забирает их, если вы так настроили), с коротким уведомлением о каждом полученном дропе.',
        'Долгие эфиры: плеер держит в памяти гораздо меньше видео — позади картинки 10 с вместо 90 на iPad и iPhone (30 с на компьютере), и запас вперёд тоже ограничен, — а чат больше не копит тысячи сообщений, пока страница скрыта. На iPad эфир в 1080p примерно каждые 20 минут приводил к падению Safari.',
        'Зависшее воспроизведение: после ошибки, которую плеер не может исправить, или если эфир застыл на 30 с без единой ошибки, он сам перезапускается (не больше трёх раз за 5 минут), а не остаётся замершим до перезагрузки страницы. Если же видео перестал присылать сам канал (у стримера оборвалась связь или он переподключается), плеер просто ждёт, пока эфир возобновится, а синхронизированный чат идёт дальше, а не копит сообщения до возобновления.',
      ],
    },
  },
  {
    version: '2026.10.20c',
    items: {
      fr: [
        'Chat synchronisé avec la vidéo, comme dans l’app iPhone : pendant un direct, chaque message attend le retard de l’image sur le direct (moins 2 s, 60 s au plus). Ce retard suit aussitôt un calage, et quand tu reviens vers le direct, les messages en attente sortent dans l’ordre en quelques secondes. Tes messages, les avis du chat et les bandeaux (message épinglé compris) s’affichent tout de suite. En haut du chat, « ⏱ −6 s » montre le retard : un clic coupe ou rallume la synchro (aussi dans Réglages → Chat, activée par défaut).',
        'Chaînes épinglées : leurs directs restent en tête des suivies, et sont maintenant triés entre eux par spectateurs. Pour garder l’ordre d’épinglage, coupe « Épinglées triées par spectateurs » dans les réglages (propre à cet appareil).',
        'Un clic sur l’onglet déjà ouvert (ou sur le logo, depuis Découvrir) ramène la page en haut, en douceur.',
      ],
      en: [
        'Chat synced with the video, like in the iPhone app: during a live, each message waits for the video’s delay behind the live edge (minus 2 s, 60 s at most). The delay follows a stall right away, and when you move back toward live, waiting messages come out in order within a few seconds. Your own messages, chat notices and banners (the pinned message included) show up immediately. At the top of the chat, “⏱ −6 s” shows the delay: click it to turn syncing off or back on (also in Settings → Chat, on by default).',
        'Pinned channels: their lives stay at the top of Following, and are now sorted among themselves by viewers. To keep the order you pinned them in, turn off “Pinned sorted by viewers” in the settings (per device).',
        'Clicking the tab you’re already on (or the logo, from Discover) smoothly scrolls the page back to the top.',
      ],
      es: [
        'Chat sincronizado con el vídeo, como en la app de iPhone: durante un directo, cada mensaje espera el retraso de la imagen respecto al directo (menos 2 s, 60 s como máximo). El retraso sigue enseguida un parón, y cuando vuelves hacia el directo, los mensajes en espera salen en orden en pocos segundos. Tus mensajes, los avisos del chat y los banners (el mensaje fijado incluido) aparecen de inmediato. Arriba del chat, «⏱ −6 s» muestra el retraso: un clic desactiva o reactiva la sincronización (también en Ajustes → Chat, activada por defecto).',
        'Canales fijados: sus directos siguen arriba en Seguidos y ahora se ordenan entre sí por espectadores. Para mantener el orden en que los fijaste, desactiva «Fijados ordenados por espectadores» en los ajustes (propio de este dispositivo).',
        'Un clic en la pestaña que ya está abierta (o en el logo, desde Descubrir) vuelve suavemente al principio de la página.',
      ],
      ru: [
        'Чат синхронизирован с видео, как в приложении для iPhone: во время эфира каждое сообщение ждёт, пока изображение догонит его (задержка видео относительно эфира минус 2 с, не больше 60 с). Задержка сразу учитывает подвисание, а когда вы возвращаетесь ближе к эфиру, ожидающие сообщения выходят по порядку за несколько секунд. Ваши сообщения, уведомления чата и баннеры (включая закреплённое сообщение) появляются сразу. Вверху чата «⏱ −6 с» показывает задержку: нажатие выключает или снова включает синхронизацию (также в Настройки → Чат, включено по умолчанию).',
        'Закреплённые каналы: их эфиры остаются вверху отслеживаемых и теперь сортируются между собой по числу зрителей. Чтобы сохранить порядок закрепления, выключите «Закреплённые по числу зрителей» в настройках (только для этого устройства).',
        'Нажатие на уже открытую вкладку (или на логотип со страницы «Обзор») плавно возвращает страницу наверх.',
      ],
    },
  },
  {
    version: '2026.10.20b',
    items: {
      fr: [
        'Partager : sous le lecteur, « Partager » copie le lien Twitch de ce que tu regardes (une VOD à l’instant où tu en es, un direct, un clip), ou celui du site, qui rouvre la VOD au même instant. Un message confirme la copie ; sur téléphone, c’est la feuille de partage du système qui s’ouvre.',
        'Planning des chaînes : un onglet « Planning » sur la page d’une chaîne qui en a un (prochains lives au jour et à l’heure de ton appareil, durée, titre, catégorie, créneaux répétés chaque semaine ou annulés, vacances), et sur une chaîne hors ligne, la ligne « Prochain live : mardi · 20:00 ». Une chaîne sans planning n’affiche rien de plus.',
      ],
      en: [
        'Share: under the player, “Share” copies the Twitch link of what you’re watching (a VOD at the moment you’re at, a live, a clip), or the site’s own link, which reopens the VOD at the same moment. A message confirms the copy; on phones, the system share sheet opens instead.',
        'Channel schedules: a “Schedule” tab on the page of a channel that has one (upcoming streams in your device’s day and time, length, title, category, weekly or canceled slots, vacations), and on an offline channel, a “Next stream: Tuesday · 8:00 PM” line. A channel without a schedule shows nothing more.',
      ],
      es: [
        'Compartir: bajo el reproductor, «Compartir» copia el enlace de Twitch de lo que ves (un VOD en el momento en que vas, un directo, un clip), o el del sitio, que vuelve a abrir el VOD en el mismo momento. Un mensaje confirma la copia; en el móvil se abre el menú para compartir del sistema.',
        'Horario de los canales: una pestaña «Horario» en la página de un canal que tiene uno (próximos directos en el día y la hora de tu dispositivo, duración, título, categoría, franjas semanales o canceladas, vacaciones) y, en un canal desconectado, la línea «Próximo directo: martes · 20:00». Un canal sin horario no muestra nada más.',
      ],
      ru: [
        'Поделиться: под плеером кнопка «Поделиться» копирует ссылку Twitch на то, что вы смотрите (VOD с текущего момента, эфир, клип), или ссылку на сайт, которая откроет VOD с того же момента. Сообщение подтверждает копирование; на телефоне открывается системное меню «Поделиться».',
        'Расписание каналов: вкладка «Расписание» на странице канала, у которого оно есть (ближайшие эфиры по дню и времени вашего устройства, длительность, название, категория, еженедельные и отменённые эфиры, отпуск), а у канала не в сети — строка «Следующий эфир: вторник · 20:00». Канал без расписания ничего дополнительно не показывает.',
      ],
    },
  },
  {
    version: '2026.10.20a',
    items: {
      fr: [
        'Réglages synchronisés : connecté à ton compte Twitch, les réglages du chat (heure, messages supprimés, bots, commandes, mots et personnes masqués, mots surlignés), la langue du top, la vitesse des VODs, tes chaînes épinglées et tes chaînes et catégories masquées sont les mêmes sur tes appareils, site et app iPhone. La langue du site, la qualité, les notifications et l’apparence restent propres à chaque appareil.',
        'Le dernier changement l’emporte, partie par partie (réglages, épinglées, masquées), et les listes d’épinglées et de masquées changées des deux côtés sont fusionnées. Un appareil qui n’a encore rien changé reprend d’abord ce qui est sur ton compte, ses listes en plus. Réglages → Compte → « Synchroniser mes réglages » pour le couper sur un appareil.',
      ],
      en: [
        'Synced settings: signed in with your Twitch account, the chat settings (time, deleted messages, bots, commands, hidden words and people, highlighted words), the top streams language, the VOD speed, your pinned channels and your hidden channels and categories are the same on your devices, website and iPhone app. The site language, quality, notifications and appearance stay specific to each device.',
        'The latest change wins, part by part (settings, pinned, hidden), and pinned or hidden lists changed on both sides are merged. A device that hasn’t changed anything yet first takes what’s on your account, adding its own lists. Settings → Account → “Sync my settings” turns it off on a device.',
      ],
      es: [
        'Ajustes sincronizados: con tu cuenta de Twitch, los ajustes del chat (hora, mensajes borrados, bots, comandos, palabras y personas ocultas, palabras resaltadas), el idioma del top, la velocidad de los VODs, tus canales fijados y tus canales y categorías ocultos son los mismos en tus dispositivos, sitio y app de iPhone. El idioma del sitio, la calidad, las notificaciones y la apariencia siguen siendo propios de cada dispositivo.',
        'El último cambio gana, parte por parte (ajustes, fijados, ocultos), y las listas de fijados y ocultos cambiadas en ambos lados se fusionan. Un dispositivo que aún no ha cambiado nada toma primero lo que hay en tu cuenta, más sus propias listas. Ajustes → Cuenta → «Sincronizar mis ajustes» lo desactiva en un dispositivo.',
      ],
      ru: [
        'Синхронизация настроек: после входа в аккаунт Twitch настройки чата (время, удалённые сообщения, боты, команды, скрытые слова и люди, выделенные слова), язык топа, скорость VOD, закреплённые каналы, а также скрытые каналы и категории одинаковы на ваших устройствах — на сайте и в приложении для iPhone. Язык сайта, качество, уведомления и внешний вид у каждого устройства свои.',
        'Побеждает последнее изменение, по частям (настройки, закреплённые, скрытые), а списки закреплённых и скрытых, изменённые с обеих сторон, объединяются. Устройство, на котором ещё ничего не меняли, сначала берёт то, что есть в аккаунте, добавляя свои списки. Настройки → Аккаунт → «Синхронизировать мои настройки» отключает это на устройстве.',
      ],
    },
  },
  {
    version: '2026.10.19a',
    items: {
      fr: [
        'Compte : la déconnexion envoie bien la dernière sauvegarde (historique, progression) avant de révoquer le jeton, et sur un appareil partagé, l’historique d’un compte ne passe plus dans celui d’un autre quand la sauvegarde ne répond pas.',
        'Twitch injoignable : tes chaînes suivies ne repassent plus par le chargement puis l’erreur à chaque retour sur l’onglet, et « Chaînes notifiées » n’envoie plus une liste sans les suivis du compte quand ils n’ont pas pu être lus.',
        'Lien vers une chaîne en live : fermer l’annonce ou ouvrir les réglages pendant le chargement n’empêche plus le direct de s’ouvrir. Un sondage qui se termine pendant que la page est ouverte affiche ses résultats au lieu de « fin dans 1 min ».',
        'Multi-live : une panne du serveur n’affiche plus « Hors ligne ou introuvable » sur la tuile d’une chaîne en live. Chat : sur iPhone et iPad, un appui long sur une emote du sélecteur ouvre sa fiche, et la carte du Train de la Hype se replie aussi au clavier.',
      ],
      en: [
        'Account: logging out now sends the last backup (history, progress) before revoking the token, and on a shared device one account’s history no longer ends up in another’s when the backup doesn’t answer.',
        'Twitch unreachable: your followed channels no longer go through loading and then an error every time you come back to the tab, and “Notified channels” no longer sends a list without your account’s follows when they couldn’t be read.',
        'Link to a live channel: closing the announcement or opening settings while it loads no longer stops the stream from opening. A poll that ends while the page is open shows its results instead of “ends in 1 min”.',
        'Multi-live: a server outage no longer shows “Offline or not found” on the tile of a channel that is live. Chat: on iPhone and iPad, a long press on an emote in the picker opens its card, and the Hype Train card can also be folded with the keyboard.',
      ],
      es: [
        'Cuenta: al cerrar sesión se envía la última copia de seguridad (historial, progreso) antes de revocar el token, y en un dispositivo compartido el historial de una cuenta ya no pasa al de otra cuando la copia de seguridad no responde.',
        'Twitch inaccesible: tus canales seguidos ya no pasan por la carga y luego el error cada vez que vuelves a la pestaña, y «Canales notificados» ya no envía una lista sin los seguidos de la cuenta cuando no se pudieron leer.',
        'Enlace a un canal en directo: cerrar el anuncio o abrir los ajustes durante la carga ya no impide que se abra el directo. Una encuesta que termina con la página abierta muestra sus resultados en lugar de «termina en 1 min».',
        'Multi-live: una caída del servidor ya no muestra «Desconectado o no encontrado» en el recuadro de un canal en directo. Chat: en iPhone y iPad, una pulsación larga sobre un emote del selector abre su ficha, y la tarjeta del Tren del Hype también se pliega con el teclado.',
      ],
      ru: [
        'Аккаунт: при выходе последняя резервная копия (история, прогресс) теперь отправляется до отзыва токена, а на общем устройстве история одного аккаунта больше не попадает в историю другого, когда резервная копия не отвечает.',
        'Twitch недоступен: отслеживаемые каналы больше не проходят через загрузку и ошибку при каждом возвращении на вкладку, а «Каналы с уведомлениями» больше не отправляют список без отслеживаемых каналов аккаунта, если их не удалось прочитать.',
        'Ссылка на канал в эфире: если закрыть объявление или открыть настройки во время загрузки, трансляция всё равно откроется. Опрос, завершившийся при открытой странице, показывает результаты вместо «до конца: 1 мин».',
        'Мульти-просмотр: сбой сервера больше не показывает «Не в сети или не найдено» на плитке канала, который в эфире. Чат: на iPhone и iPad долгое нажатие на эмоут в списке открывает его карточку, а карточку Хайповоза теперь можно свернуть и с клавиатуры.',
      ],
    },
  },
  {
    version: '2026.10.18d',
    items: {
      fr: [
        'Mes signalements : une discussion fermée par le développeur, ou arrivée à 100 messages, le dit au lieu d’afficher le champ de réponse puis un échec. Deux réponses envoyées au même moment ne s’effacent plus l’une l’autre.',
        'Notifications de live : quand le navigateur renouvelle l’abonnement, il est remplacé tout de suite, chaînes comprises (avant, plus rien n’arrivait jusqu’à la visite suivante).',
      ],
      en: [
        'My reports: a conversation closed by the developer, or one that reached 100 messages, says so instead of showing the reply box and then failing. Two replies sent at the same time no longer erase each other.',
        'Live notifications: when the browser renews its subscription, it is replaced right away, channels included (before, nothing arrived until your next visit).',
      ],
      es: [
        'Mis reportes: una conversación cerrada por el desarrollador, o que llegó a 100 mensajes, lo indica en lugar de mostrar el campo de respuesta y luego fallar. Dos respuestas enviadas al mismo tiempo ya no se borran entre sí.',
        'Notificaciones de directos: cuando el navegador renueva la suscripción, se sustituye al momento, canales incluidos (antes no llegaba nada hasta la siguiente visita).',
      ],
      ru: [
        'Мои обращения: обсуждение, закрытое разработчиком или дошедшее до 100 сообщений, теперь сообщает об этом, а не показывает поле ответа с последующей ошибкой. Два ответа, отправленные одновременно, больше не стирают друг друга.',
        'Уведомления о трансляциях: когда браузер обновляет подписку, она сразу заменяется вместе с каналами (раньше ничего не приходило до следующего посещения).',
      ],
    },
  },
  {
    version: '2026.10.18c',
    items: {
      fr: [
        'Journal des erreurs : les erreurs du site (code, lecteur, Worker, Twitch) sont gardées dans ton navigateur, lisibles et copiables dans Réglages → À propos, et jointes à tes signalements pour que le problème soit trouvé plus vite.',
      ],
      en: [
        'Error log: the site’s errors (code, player, Worker, Twitch) are kept in your browser, readable and copyable in Settings → About, and attached to your reports so problems get found faster.',
      ],
      es: [
        'Registro de errores: los errores del sitio (código, reproductor, Worker, Twitch) se guardan en tu navegador, se pueden leer y copiar en Ajustes → Acerca de, y se adjuntan a tus reportes para encontrar los problemas más rápido.',
      ],
      ru: [
        'Журнал ошибок: ошибки сайта (код, плеер, Worker, Twitch) сохраняются в вашем браузере, их можно прочитать и скопировать в «Настройки → О сайте», и они прикрепляются к вашим сообщениям об ошибках, чтобы проблемы находились быстрее.',
      ],
    },
  },
  {
    version: '2026.10.18b',
    items: {
      fr: [
        'Couleurs d’accent : texte foncé sur les boutons verts, orange et sarcelle (le blanc s’y lisait mal), version foncée de l’accent pour les textes du thème clair, et les touches violettes qui restaient (sélection, survols, messages, sondages…) suivent la couleur choisie.',
        'Chat : le bouton « reprendre » et la fiche d’une emote ne recouvrent plus la zone de saisie quand elle s’agrandit.',
        'Téléphone : les messages en bas d’écran passent au-dessus du lecteur réduit et de la barre du multi-live, et l’iPhone ne zoome plus en touchant un champ.',
        'Ces messages et l’avis de son coupé ne sont plus limités à la moitié de la largeur, le plein écran s’affiche bien sur les iPad plus anciens, la sauvegarde refait un envoi raté, et deux réactions rapides à une annonce ne se contredisent plus.',
      ],
      en: [
        'Accent colors: dark text on green, orange and teal buttons (white was hard to read), a darker accent for text in the light theme, and the purple touches that were left (selection, hovers, messages, polls…) follow your color.',
        'Chat: the “resume” button and the emote card no longer cover the message box when it grows.',
        'Phone: messages at the bottom of the screen go above the mini player and the multi-live bar, and iPhone no longer zooms in when you tap a field.',
        'Those messages and the muted-audio notice are no longer limited to half the width, full screen looks right on older iPads, the backup retries a failed upload, and two quick reactions to an announcement no longer contradict each other.',
      ],
      es: [
        'Colores de acento: texto oscuro en los botones verdes, naranjas y turquesa (el blanco se leía mal), una versión más oscura del acento para los textos del tema claro, y los toques morados que quedaban (selección, efectos al pasar, mensajes, encuestas…) siguen tu color.',
        'Chat: el botón «reanudar» y la ficha de un emote ya no tapan el cuadro de mensaje cuando crece.',
        'Teléfono: los mensajes de la parte inferior pasan por encima del reproductor reducido y de la barra del multi-live, y el iPhone ya no hace zoom al tocar un campo.',
        'Esos mensajes y el aviso de audio silenciado ya no se limitan a la mitad del ancho, la pantalla completa se ve bien en iPad más antiguos, la copia de seguridad reintenta un envío fallido, y dos reacciones rápidas a un anuncio ya no se contradicen.',
      ],
      ru: [
        'Цвета акцента: тёмный текст на зелёных, оранжевых и бирюзовых кнопках (белый читался плохо), более тёмный акцент для текста в светлой теме, а оставшиеся фиолетовые элементы (выделение, наведение, сообщения, опросы…) теперь следуют выбранному цвету.',
        'Чат: кнопка «вернуться» и карточка эмоута больше не закрывают поле ввода, когда оно увеличивается.',
        'Телефон: сообщения внизу экрана показываются над мини-плеером и панелью мультистрима, а iPhone больше не увеличивает страницу при нажатии на поле.',
        'Эти сообщения и уведомление о заглушённом звуке больше не ограничены половиной ширины, полноэкранный режим правильно выглядит на старых iPad, резервная копия повторяет неудачную отправку, а две быстрые реакции на объявление больше не противоречат друг другу.',
        'Русский перевод: «отслеживать» и «эмоуты» теперь везде переведены одинаково.',
      ],
    },
  },
  {
    version: '2026.10.18a',
    items: {
      fr: [
        'Sauvegarde : l’historique de chaque compte Twitch reste le sien (appareil partagé), ce qui a été regardé sur un autre appareil n’est plus perdu à la synchro, et une synchro ratée n’écrase plus la sauvegarde.',
        'Thème clair : l’écran d’erreur du lecteur, l’en-tête posé sur la vidéo en paysage et les pseudos du chat redeviennent lisibles.',
        'Téléphone : la barre du lecteur ne coupe plus le plein écran ni l’image dans l’image, la saisie du chat n’est plus sous la barre d’accueil, et le menu des chapitres tient dans un petit lecteur.',
        'La liste des VODs s’affiche même avec les cookies bloqués, et « Ne pas partager » est respecté par un comptage déjà en attente.',
      ],
      en: [
        'Backup: each Twitch account keeps its own history (shared device), what you watched on another device is no longer lost when syncing, and a failed sync no longer overwrites the backup.',
        'Light theme: the player\'s error screen, the header over the video in landscape and chat usernames are readable again.',
        'Phone: the player bar no longer cuts off full screen and picture in picture, the chat box is no longer under the home bar, and the chapters menu fits in a small player.',
        'The VOD list shows even with cookies blocked, and “Don’t share” is respected by a usage count already waiting to go.',
      ],
      es: [
        'Copia de seguridad: cada cuenta de Twitch conserva su propio historial (dispositivo compartido), lo que viste en otro dispositivo ya no se pierde al sincronizar, y una sincronización fallida ya no sobrescribe la copia.',
        'Tema claro: la pantalla de error del reproductor, el encabezado sobre el vídeo en horizontal y los nombres del chat vuelven a leerse bien.',
        'Teléfono: la barra del reproductor ya no corta la pantalla completa ni la imagen en imagen, el cuadro del chat ya no queda bajo la barra de inicio y el menú de capítulos cabe en un reproductor pequeño.',
        'La lista de VODs se muestra aunque las cookies estén bloqueadas, y «No compartir» se respeta aunque un recuento ya estuviera en espera.',
      ],
      ru: [
        'Резервная копия: у каждого аккаунта Twitch своя история (общее устройство), просмотренное на другом устройстве больше не теряется при синхронизации, а неудачная синхронизация больше не перезаписывает копию.',
        'Светлая тема: экран ошибки плеера, заголовок поверх видео в горизонтальном положении и ники в чате снова читаются.',
        'Телефон: панель плеера больше не обрезает кнопки полноэкранного режима и «картинки в картинке», поле чата больше не уходит под полосу «Домой», а меню глав помещается в маленьком плеере.',
        'Список VOD показывается даже при заблокированных cookie, а «Не делиться» соблюдается и для уже ожидающего подсчёта.',
      ],
    },
  },
  {
    version: '2026.10.17b',
    items: {
      fr: [
        'Notifications de live : choisis quelles chaînes suivies te préviennent (Réglages → Notifications → Chaînes notifiées).',
      ],
      en: [
        'Live notifications: pick which followed channels notify you (Settings → Notifications → Notified channels).',
      ],
      es: [
        'Notificaciones de directos: elige qué canales seguidos te avisan (Ajustes → Notificaciones → Canales notificados).',
      ],
      ru: [
        'Уведомления о трансляциях: выберите, какие отслеживаемые каналы будут вас уведомлять (Настройки → Уведомления → Каналы с уведомлениями).',
      ],
    },
  },
  {
    version: '2026.10.17a',
    items: {
      fr: [
        'Multi-live : avance une vidéo d’une place avec la flèche de sa tuile (à trois, la première passe en grand).',
        'Direct : un clic sur la latence ramène au direct, sans recharger le flux.',
      ],
      en: [
        'Multi-live: move a video one place earlier with the arrow on its tile (with three, the first one is the big one).',
        'Live: clicking the latency brings you back to live, without reloading the stream.',
      ],
      es: [
        'Multi-live: adelanta un vídeo un puesto con la flecha de su recuadro (con tres, el primero se ve en grande).',
        'Directo: un clic en la latencia te devuelve al directo, sin recargar la transmisión.',
      ],
      ru: [
        'Мульти-просмотр: стрелка на плитке перемещает видео на одно место раньше (при трёх видео первое показывается крупно).',
        'Трансляция: клик по задержке возвращает к прямому эфиру без перезагрузки потока.',
      ],
    },
  },
  {
    version: '2026.10.16a',
    items: {
      fr: [
        'Chat : l’heure des messages s’affiche en 12 h (AM/PM) ou en 24 h selon ton appareil, ou comme tu préfères (Réglages → Chat → Format de l’heure).',
      ],
      en: [
        'Chat: message times show in 12-hour (AM/PM) or 24-hour format depending on your device, or the way you prefer (Settings → Chat → Time format).',
      ],
      es: [
        'Chat: la hora de los mensajes se muestra en formato de 12 h (a. m./p. m.) o de 24 h según tu dispositivo, o como prefieras (Ajustes → Chat → Formato de hora).',
      ],
      ru: [
        'Чат: время сообщений показывается в 12-часовом (AM/PM) или 24-часовом формате, как на устройстве, или как вам удобнее (Настройки → Чат → Формат времени).',
      ],
    },
  },
  {
    version: '2026.10.15b',
    items: {
      fr: [
        'Chat : les GIF envoyés avec le clavier GIF de Twitch s’affichent dans le chat, comme sur Twitch.',
      ],
      en: [
        'Chat: GIFs sent with Twitch’s GIF keyboard now show up in the chat, like on Twitch.',
      ],
      es: [
        'Chat: los GIF enviados con el teclado de GIF de Twitch ahora aparecen en el chat, como en Twitch.',
      ],
      ru: [
        'Чат: GIF, отправленные через GIF-клавиатуру Twitch, теперь показываются в чате, как на Twitch.',
      ],
    },
  },
  {
    version: '2026.10.15a',
    items: {
      fr: [
        'Multi-live : jusqu’à quatre vidéos côte à côte, directs et VODs mêlés. Ajoute une VOD avec le « + » de sa carte ou en collant son lien dans la mosaïque ; elle reprend où tu en étais, et celle qui a le son a ses commandes (lecture, ±10 s, barre de position) et son chat rejoué.',
        'Qualité préférée (Réglages → Lecteur) : Auto, Source, 1080p… ou audio seul, pour chaque direct et chaque VOD (la plus proche en dessous si la chaîne ne l’a pas). « Auto » démarre plus haut, ne reste plus coincée en 360p et montre la qualité jouée (« Auto · 720p »).',
        'Direct : la vidéo ne change plus de vitesse pour rattraper le direct, elle fait au besoin un petit saut : le son reste calé sur l’image, aussi dans le multi-live. Si tu recules de 10 s, le lecteur ne te ramène plus tout seul au direct.',
        'Pauses pub de la chaîne : quand Twitch remplace le direct par son écran « Commercial break in progress », un bandeau l’explique avec un compte à rebours, et le son est coupé jusqu’au retour du direct (tu peux le remettre).',
        'Installe le site comme une app (Réglages → Installer l’app) : une icône sur l’écran d’accueil et sa propre fenêtre. Les notifications de live arrivent site fermé, sur iPhone et iPad aussi une fois le site installé (iOS 16.4 ou plus), et les Réglages disent si elles sont actives.',
        'Chat : le Train de la Hype s’affiche, même sans compte : la carte « En approche » avec son compte à rebours, puis le départ, le niveau en cours avec sa barre et le temps restant, et la fin.',
        'Masque une chaîne ou une catégorie avec l’œil barré de sa carte (on la réaffiche depuis les Réglages) ; ce que tu suis ou épingles n’est jamais masqué. Sans compte, « Charger plus » dépasse maintenant les 100 premiers (catégories, lives, clips et VODs d’une chaîne), et le Top des lives en a un aussi.',
        'VODs : vitesse de 0,25× à 2× (touches < et >), gardée d’une VOD à l’autre ; les directs restent à 1×. Les passages des VODs récentes qui ont gardé leur son ne sont plus annoncés « son coupé ».',
        'Chat : si tu es banni d’une chaîne, son chat continue en lecture seule (bandeau et bouton « Réessayer avec mon compte »). Et le chat se connecte en quelques secondes même quand une source d’emotes est lente (VPN, réseau filtré).',
        'Fiche des emotes plus riche : type (abonné niveau 1 à 3, points de chaîne…) et chaîne d’origine en un clic, auteur et lien pour BTTV, FFZ et 7TV ; elle s’ouvre aussi d’un clic droit dans le sélecteur. Les emotes FFZ animées bougent enfin.',
        'Lecture plus solide : en cas de panne, le lecteur et le multi-live réessaient puis changent de relais ou de Worker au lieu de tourner en boucle ; une VOD saute un passage disparu, et une VOD dont la fin manque se termine normalement. Les anciens uploads et les très vieux temps forts se lisent de nouveau.',
        'Chat : Entrée envoie toujours ton message, Tab (ou un clic) prend l’emote ou le pseudo proposé ; tes messages s’affichent comme les autres les voient, et les emotes juste après un emoji s’affichent bien. Chat des VODs : après un saut, les messages d’avant apparaissent, et une erreur de Twitch ne l’arrête plus.',
        'Si Twitch ne répond pas à l’ouverture, tu restes connecté ; le logo ne recharge plus la page ; sur téléphone, un téléchargement trop gros s’arrête avec un message au lieu de faire planter l’onglet.',
        'Sauvegarde : un fichier importé reprend aussi le thème, l’accent et l’ordre des sources, mais ne peut plus changer le Worker utilisé, et l’export ne contient plus l’adresse de ton Worker personnel.',
        'Sondages : le développeur peut poser une question sous l’annonce de l’accueil ; tu votes sans compte (un ou plusieurs choix selon le sondage), tu peux changer d’avis jusqu’à la fin, et tu vois les résultats dès que tu as voté.',
      ],
      en: [
        'Multi-live: up to four videos side by side, lives and VODs mixed. Add a VOD with the “+” on its card or by pasting its link into the mosaic; it resumes where you left off, and the one you hear has its controls (play, ±10 s, seek bar) and its replayed chat.',
        'Preferred quality (Settings → Player): Auto, Source, 1080p… or audio only, for every live and VOD (the closest one below if the channel doesn’t have it). “Auto” starts higher, no longer gets stuck at 360p and shows the quality actually playing (“Auto · 720p”).',
        'Lives: the video no longer changes speed to catch up with the live edge, it makes a small jump when needed, so the sound stays in sync with the picture, in multi-live too. If you go back 10 s, the player no longer pulls you back to live on its own.',
        'Channel ad breaks: when Twitch replaces the live with its “Commercial break in progress” screen, a banner explains it with a countdown, and the sound is muted until the stream is back (you can turn it back on).',
        'Install the site as an app (Settings → Install the app): an icon on your home screen and its own window. Live notifications arrive with the site closed, on iPhone and iPad too once the site is installed (iOS 16.4 or later), and Settings show whether they’re on.',
        'Chat: the Hype Train now shows, even without an account: the “Incoming” card with its countdown, then the departure, the current level with its bar and time left, and the end.',
        'Hide a channel or a category with the crossed-out eye on its card (show it again from Settings); what you follow or pin is never hidden. Without an account, “Load more” now goes past the first 100 (categories, lives, a channel’s clips and VODs), and Top streams has one too.',
        'VODs: speed from 0.25× to 2× (< and > keys), kept from one VOD to the next; lives stay at 1×. Parts of recent VODs that kept their sound are no longer flagged “sound muted”.',
        'Chat: if you’re banned from a channel, its chat keeps going read-only (banner and a “Retry with my account” button). And the chat connects within a few seconds even when an emote source is slow (VPN, filtered network).',
        'Richer emote card: type (tier 1–3 sub, channel points…) and its channel one click away, author and link for BTTV, FFZ and 7TV; it also opens with a right-click in the picker. Animated FFZ emotes finally move.',
        'Sturdier playback: when something fails, the player and multi-live retry, then switch to another relay or Worker instead of looping; a VOD skips a missing part, and a VOD whose ending is gone now ends normally. Older uploads and very old highlights play again.',
        'Chat: Enter always sends your message, Tab (or a click) picks the suggested emote or name; your messages show the way others see them, and emotes right after an emoji display correctly. VOD chat: after a jump, the messages just before show up, and a Twitch error no longer stops it.',
        'If Twitch doesn’t answer when the site opens, you stay logged in; the logo no longer reloads the page; on phones, a download that grows too big stops with a message instead of crashing the tab.',
        'Backup: an imported file also restores the theme, accent and source order, but can no longer change the Worker in use, and exports no longer include your personal Worker’s address.',
        'Polls: the developer can ask a question under the home announcement; you vote without an account (one or several choices depending on the poll), can change your mind until it ends, and see the results as soon as you’ve voted.',
      ],
      es: [
        'Multi-live: hasta cuatro vídeos lado a lado, directos y VODs mezclados. Añade un VOD con el «+» de su tarjeta o pegando su enlace en el mosaico; se reanuda donde lo dejaste, y el que suena tiene sus controles (reproducir, ±10 s, barra de posición) y su chat repetido.',
        'Calidad preferida (Ajustes → Reproductor): Auto, Source, 1080p… o solo audio, para cada directo y cada VOD (la más cercana por debajo si el canal no la tiene). «Auto» empieza más alto, ya no se queda atascada en 360p y muestra la calidad que se reproduce («Auto · 720p»).',
        'Directos: el vídeo ya no cambia de velocidad para alcanzar el directo, da un pequeño salto si hace falta: el sonido sigue sincronizado con la imagen, también en el multi-live. Si retrocedes 10 s, el reproductor ya no te devuelve solo al directo.',
        'Pausas publicitarias del canal: cuando Twitch sustituye el directo por su pantalla «Commercial break in progress», un aviso lo explica con una cuenta atrás, y el sonido se silencia hasta que vuelve el directo (puedes volver a activarlo).',
        'Instala el sitio como una app (Ajustes → Instalar la app): un icono en la pantalla de inicio y su propia ventana. Las notificaciones de directos llegan con el sitio cerrado, también en iPhone y iPad una vez instalado el sitio (iOS 16.4 o posterior), y los Ajustes indican si están activas.',
        'Chat: el Tren del Hype ya se muestra, incluso sin cuenta: la tarjeta «Entrante» con su cuenta atrás, luego la salida, el nivel en curso con su barra y el tiempo restante, y el final.',
        'Oculta un canal o una categoría con el ojo tachado de su tarjeta (se vuelve a mostrar desde los Ajustes); lo que sigues o fijas nunca se oculta. Sin cuenta, «Cargar más» ahora va más allá de los 100 primeros (categorías, directos, clips y VODs de un canal), y el Top de directos también lo tiene.',
        'VODs: velocidad de 0,25× a 2× (teclas < y >), conservada de un VOD a otro; los directos siguen a 1×. Las partes de los VODs recientes que conservan su sonido ya no se marcan «sonido silenciado».',
        'Chat: si te banean de un canal, su chat sigue en solo lectura (aviso y botón «Reintentar con mi cuenta»). Y el chat se conecta en pocos segundos aunque una fuente de emotes vaya lenta (VPN, red filtrada).',
        'Ficha de los emotes más completa: tipo (suscriptor nivel 1 a 3, puntos del canal…) y su canal a un clic, autor y enlace para BTTV, FFZ y 7TV; también se abre con clic derecho en el selector. Los emotes animados de FFZ por fin se mueven.',
        'Reproducción más sólida: si algo falla, el reproductor y el multi-live reintentan y luego cambian de relé o de Worker en lugar de quedarse en bucle; un VOD salta una parte desaparecida, y un VOD cuyo final falta termina con normalidad. Los vídeos subidos antiguos y los momentos destacados muy antiguos vuelven a reproducirse.',
        'Chat: Intro siempre envía tu mensaje, Tab (o un clic) elige el emote o el nombre sugerido; tus mensajes se ven como los ven los demás, y los emotes justo después de un emoji se muestran bien. Chat de los VODs: tras un salto aparecen los mensajes de justo antes, y un error de Twitch ya no lo detiene.',
        'Si Twitch no responde al abrir el sitio, sigues con la sesión iniciada; el logo ya no recarga la página; en el móvil, una descarga demasiado grande se detiene con un mensaje en lugar de bloquear la pestaña.',
        'Copia de seguridad: un archivo importado también recupera el tema, el color de acento y el orden de las fuentes, pero ya no puede cambiar el Worker usado, y la exportación ya no incluye la dirección de tu Worker personal.',
        'Encuestas: el desarrollador puede hacer una pregunta bajo el anuncio de inicio; votas sin cuenta (una o varias opciones según la encuesta), puedes cambiar de opinión hasta el final y ves los resultados en cuanto votas.',
      ],
      ru: [
        'Мульти-просмотр: до четырёх видео рядом, трансляции и VOD вперемешку. Добавьте VOD кнопкой «+» на его карточке или вставив ссылку в мозаику; он продолжается с того места, где вы остановились, а у того, что вы слышите, есть управление (воспроизведение, ±10 сек, полоса перемотки) и повтор чата.',
        'Предпочтительное качество (Настройки → Плеер): Авто, Источник, 1080p… или только звук — для каждой трансляции и записи (ближайшее ниже, если на канале его нет). «Авто» стартует выше, больше не застревает на 360p и показывает реально воспроизводимое качество («Авто · 720p»).',
        'Трансляции: видео больше не меняет скорость, чтобы догнать прямой эфир, а при необходимости делает небольшой скачок — звук остаётся синхронным с картинкой, в том числе в мульти-просмотре. Если перемотать назад на 10 сек, плеер больше не возвращает вас к эфиру сам.',
        'Рекламные паузы канала: когда Twitch заменяет трансляцию своим экраном «Commercial break in progress», баннер объясняет это с обратным отсчётом, а звук отключается до возвращения трансляции (его можно включить).',
        'Установите сайт как приложение (Настройки → Установить приложение): значок на главном экране и отдельное окно. Уведомления о трансляциях приходят, даже когда сайт закрыт, — и на iPhone и iPad, если сайт установлен (iOS 16.4 и новее), а настройки показывают, включены ли они.',
        'Чат: теперь показывается Хайповоз, даже без аккаунта: карточка «Прибывает» с обратным отсчётом, затем отправление, текущий уровень с полосой и оставшимся временем, и финал.',
        'Скройте канал или категорию перечёркнутым глазом на карточке (вернуть можно в настройках); то, что вы отслеживаете или закрепляете, никогда не скрывается. Без аккаунта «Загрузить ещё» теперь работает дальше первых 100 (категории, трансляции, клипы и записи канала), и под «Топом трансляций» она тоже есть.',
        'Записи: скорость от 0,25× до 2× (клавиши < и >) сохраняется между записями; трансляции идут со скоростью 1×. Фрагменты свежих записей, в которых звук сохранился, больше не помечаются «звук отключён».',
        'Чат: если вас забанили на канале, его чат продолжает работать только для чтения (баннер и кнопка «Повторить с моим аккаунтом»). А подключается чат за несколько секунд, даже если источник эмоутов медленный (VPN, фильтруемая сеть).',
        'Карточка эмоута подробнее: тип (для подписчиков уровня 1–3, за баллы канала…) и его канал в один клик, автор и ссылка для BTTV, FFZ и 7TV; открывается и правым кликом в панели эмоутов. Анимированные эмоуты FFZ наконец двигаются.',
        'Воспроизведение надёжнее: при сбое плеер и мульти-просмотр повторяют попытку, затем переключаются на другой ретранслятор или Worker вместо зацикливания; запись пропускает пропавший фрагмент, а запись без концовки теперь завершается нормально. Старые загруженные видео и очень старые хайлайты снова воспроизводятся.',
        'Чат: Enter всегда отправляет сообщение, Tab (или щелчок) выбирает предложенный эмоут или ник; ваши сообщения выглядят так, как их видят другие, а эмоуты сразу после эмодзи отображаются правильно. Чат записей: после перемотки появляются сообщения перед этим моментом, а ошибка Twitch больше его не останавливает.',
        'Если Twitch не отвечает при открытии сайта, вы остаётесь в аккаунте; логотип больше не перезагружает страницу; на телефоне слишком большая загрузка останавливается с сообщением, а не роняет вкладку.',
        'Резервная копия: импортированный файл также восстанавливает тему, акцентный цвет и порядок источников, но больше не может сменить используемый Worker, а экспорт больше не содержит адрес вашего личного Worker.',
        'Опросы: разработчик может задать вопрос под объявлением на главной; голосуйте без аккаунта (один или несколько вариантов, в зависимости от опроса), меняйте решение до конца опроса и смотрите результаты сразу после голосования.',
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
