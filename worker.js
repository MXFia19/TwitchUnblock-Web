const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

// Headers pour RÉPONDRE à votre site web
const RESPONSE_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Cache-Control, Range, Authorization',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range'
};

// Headers pour ATTAQUER Twitch et Luminous incognito
const REQUEST_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Safari/537.36',
    'Referer': 'https://www.twitch.tv/',
    'Origin': 'https://www.twitch.tv'
};

// Formats Twitch : tout paramètre qui finit dans une requête GQL ou une
// adresse est vérifié d'abord. Avant, `name` était collé tel quel dans le
// texte de la requête GQL — un guillemet suffisait à en réécrire le contenu.
const LOGIN_RE = /^[a-zA-Z0-9_]{1,25}$/;
const VOD_ID_RE = /^\d{1,20}$/;
const CURSOR_RE = /^[A-Za-z0-9+/=_-]{1,500}$/;

const QUALITY_ORDER = ['chunked', 'source', '1080p60', '1080p30', '720p60', '720p30', '480p30', '360p30', '160p30', 'audio_only'];

export default {
    // Chaque minute (wrangler.toml) : notifications de live du site.
    async scheduled(event, env, ctx) {
        // Docker : la tâche passe par POST /api/cron et son secret. Un appel
        // ici vient alors de /cdn-cgi/local/scheduled de wrangler dev, que
        // n'importe qui pouvait viser : il ne fait rien.
        if (dockerCron(env)) return;
        applyEnvConfig(env);
        ctx.waitUntil(pushTick(env).catch((e) => console.error(e)));
        ctx.waitUntil(relayWatch(env, new Date(event?.scheduledTime || Date.now())).catch((e) => console.error(e)));
    },

    async fetch(request, env, ctx) {
        if (request.method === "OPTIONS") return new Response(null, { headers: RESPONSE_HEADERS });
        applyEnvConfig(env);

        const url = new URL(request.url);
        const workerOrigin = url.origin; 
        
        try {
            switch (url.pathname) {
                case '/': return new Response("Twitch Proxy - Anti 403 Ready", { headers: RESPONSE_HEADERS });
                case '/api/get-live': return await handleGetLive(url, workerOrigin);
                case '/api/get-channel-videos': return await handleGetVideos(url);
                case '/api/get-m3u8': return await handleGetM3U8(url, workerOrigin);
                case '/api/proxy': return await handleProxy(url, request, env);

                // Récupération de VODs supprimées (le navigateur ne peut joindre
                // ni la source externe ni le CDN de Twitch : CORS). Voir plus bas.
                case '/api/recover-list': return await handleRecoverList(url);
                case '/api/recover-resolve': return await handleRecoverResolve(url, workerOrigin);
                
                // Routes Sync (Sauvegarde Cloud)
                case '/api/sync/get': return await handleSyncGet(url, request, env);
                case '/api/sync/post': return await handleSyncPost(request, env);

                // Comptage d'utilisation (app iOS et site)
                case '/api/ping': return await handlePing(request, env);
                case '/api/stats': return await cachedStats(request, env, ctx);

                // Outils d'administration (compte du propriétaire uniquement)
                case '/api/admin/me': return await handleAdminMe(request);
                case '/api/admin/usage': return await handleAdminUsage(request, env);
                case '/api/admin/usage/delete': return await handleAdminUsageDelete(request, env);
                case '/api/admin/sync/delete': return await handleAdminSyncDelete(request, env);

                // Annonces affichées dans l'app (lecture publique, écriture admin)
                case '/api/announcement': return await handleAnnouncementGet(env);
                case '/api/announcement/react': return await handleAnnouncementReact(request, env);
                // Sondages (lecture et vote publics, création admin ou bot)
                case '/api/poll': return await handlePollState(request, env);
                case '/api/poll/vote': return await handlePollVote(request, env);
                case '/api/admin/poll': return await handleAdminPoll(request, env);
                // Retours (bug, idée) du site et de l'app
                case '/api/feedback': return await handleFeedback(request, env, ctx);
                case '/api/feedback/thread': return await handleFeedbackThread(request, env);
                case '/api/feedback/reply': return await handleFeedbackReply(request, env, ctx);
                case '/api/feedback/photo': return await handleFeedbackPhoto(url, request, env);
                case '/api/feedback/discord': return await handleFeedbackBot(request, env);
                case '/api/admin/feedback': return await handleAdminFeedback(request, env, ctx);

                // Notifications de live du site installé (Web Push)
                case '/api/push/key': return await handlePushKey(env);
                case '/api/push/subscribe': return await handlePushSubscribe(request, env);
                case '/api/push/unsubscribe': return await handlePushUnsubscribe(request, env);
                case '/api/push/test': return await handlePushTest(request, env);
                // Docker : la tâche planifiée, lancée par l'entrypoint (handleCron).
                case '/api/cron': return await handleCron(request, env);

                // Commandes Moobot pour le site (son API refuse les navigateurs)
                case '/api/bot-commands/moobot': return await handleMoobotCommands(url);
                case '/api/admin/announcement': return await handleAdminAnnouncement(request, env);

                default:
                    // Docker (site + Worker ensemble) : les adresses du site façon
                    // Twitch (/xqc, /videos/123, /directory…) ne sont pas des
                    // fichiers ; elles reçoivent la page, qui ouvre la bonne vue.
                    if (env.ASSETS && request.method === 'GET' && !url.pathname.startsWith('/api/')) {
                        return env.ASSETS.fetch(new Request(new URL('/', url).href, { headers: request.headers }));
                    }
                    return new Response("Not Found", { status: 404, headers: RESPONSE_HEADERS });
            }
        } catch (e) {
            // Pas de message interne renvoyé au client : seulement dans les logs.
            console.error(e);
            return new Response(JSON.stringify({ error: "Erreur interne" }), { status: 500, headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json' } });
        }
    }
};

// --- SYSTÈME DE SYNCHRONISATION CLOUD (D1) ---
// ── Authentification de la sauvegarde ─────────────────────────────────────
// Avant, il suffisait de connaître l'identifiant Twitch de quelqu'un — il est
// public — pour lire ou écraser son historique. Chaque requête doit
// maintenant présenter le jeton Twitch de l'utilisateur (en-tête
// `Authorization: Bearer …`), que Twitch confirme, et il doit appartenir à
// l'identifiant visé.
//
// Twitch demande de toute façon de valider un jeton au moins toutes les
// heures. Le résultat est gardé en mémoire 30 minutes (au mieux : chaque
// instance du Worker a la sienne), pour ne pas appeler Twitch à chaque
// requête.
const tokenCache = new Map();   // empreinte du jeton → { userId, login, until }
async function tokenUserId(request) {
    return (await tokenIdentity(request))?.userId ?? null;
}

/** Compte Twitch du jeton présenté (`Authorization: Bearer …`), ou null. */
async function tokenIdentity(request) {
    const auth = request.headers.get('Authorization') || '';
    const token = auth.replace(/^(Bearer|OAuth)\s+/i, '').trim();
    if (!token || token.length > 200) return null;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const key = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const hit = tokenCache.get(key);
    if (hit && hit.until > Date.now()) return hit;
    const res = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${token}` } });
    if (!res.ok) { tokenCache.delete(key); return null; }
    const v = await res.json();
    const userId = v && v.user_id ? String(v.user_id) : null;
    if (!userId) return null;
    if (tokenCache.size > 500) tokenCache.clear();
    const entry = { userId, login: String(v.login || '').toLowerCase(), until: Date.now() + 30 * 60 * 1000 };
    tokenCache.set(key, entry);
    return entry;
}

async function authorizeSync(request, userId) {
    if (!/^\d{1,20}$/.test(userId)) return jsonError("User ID invalide", 400);
    const owner = await tokenUserId(request);
    if (!owner) return jsonError("Jeton Twitch manquant ou expiré", 401);
    if (owner !== userId) return jsonError("Ce jeton n'appartient pas à cet utilisateur", 403);
    return null;
}

async function handleSyncGet(url, request, env) {
    if (!env.DB) return jsonError("Erreur Serveur : base D1 'DB' non liée au Worker.", 500);
    const userId = String(url.searchParams.get('userId') || '');
    const denied = await authorizeSync(request, userId);
    if (denied) return denied;

    const data = await store(env).get(`user_${userId}`, { type: "json" });
    return jsonResponse(data || { history: [], progress: {} });
}

async function handleSyncPost(request, env) {
    if (request.method !== 'POST') return jsonError("Method Not Allowed", 405);
    if (!env.DB) return jsonError("Erreur Serveur : base D1 'DB' non liée au Worker.", 500);

    // Taille bornée : une sauvegarde normale pèse quelques kilo-octets.
    const raw = await request.text();
    if (raw.length > SYNC_MAX_BYTES) return jsonError("Sauvegarde trop volumineuse", 413);
    let body;
    try { body = JSON.parse(raw); } catch (e) { return jsonError("JSON invalide", 400); }
    if (!body || typeof body !== 'object') return jsonError("JSON invalide", 400);
    const userId = String(body.userId || '');
    const denied = await authorizeSync(request, userId);
    if (denied) return denied;

    // L'app iOS et le site écrivent tous deux ici. Remplacer bêtement l'objet
    // laissait chacun effacer ce que l'autre avait envoyé ; on fusionne :
    //   • historique : celui du client fait foi (il a déjà fusionné le serveur
    //     à l'ouverture, et c'est lui qui connaît les suppressions) ;
    //   • progression : pour chaque VOD, la position la plus avancée ;
    //   • champ absent de l'envoi : on garde celui du serveur.
    const key = `user_${userId}`;
    const incoming = body.data || {};
    const current = (await store(env).get(key, { type: 'json' })) || {};
    const progress = { ...(current.progress || {}) };
    for (const [id, t] of Object.entries(incoming.progress || {})) {
        const v = Number(t);
        if (/^\d+$/.test(id) && Number.isFinite(v) && v > (Number(progress[id]) || 0)) progress[id] = Math.round(v);
    }
    // Progression bornée aux VODs les plus récentes (les identifiants Twitch
    // croissent avec le temps) : la fusion « garder le plus avancé » ne
    // retirait jamais rien, l'objet grossissait sans fin.
    const ids = Object.keys(progress);
    if (ids.length > SYNC_MAX_PROGRESS) {
        ids.sort((a, b) => (BigInt(b) > BigInt(a) ? 1 : -1));
        for (const id of ids.slice(SYNC_MAX_PROGRESS)) delete progress[id];
    }
    const next = {
        history: Array.isArray(incoming.history) ? incoming.history.slice(0, 50).map(cleanHistoryItem).filter(Boolean) : (current.history || []),
        progress
    };

    // Rien de neuf : pas d'écriture (quota D1 gratuit : 100 000 lignes par jour).
    const before = JSON.stringify({ history: current.history || [], progress: current.progress || {} });
    const after = JSON.stringify(next);
    if (before === after) return jsonResponse({ success: true, unchanged: true });

    await store(env).put(key, after);
    return jsonResponse({ success: true });
}

const SYNC_MAX_BYTES = 256 * 1024;
const SYNC_MAX_PROGRESS = 500;
// Seuls les champs connus, en texte de longueur raisonnable : la sauvegarde
// ne doit pas servir à stocker n'importe quoi.
function cleanHistoryItem(it) {
    if (!it || typeof it !== 'object') return null;
    const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
    const term = str(it.term, 100);
    if (!term || (it.type !== 'vod' && it.type !== 'channel')) return null;
    const out = { term, type: it.type, display: str(it.display, 300) || term };
    const thumb = str(it.thumb, 500); if (thumb && /^https:\/\//.test(thumb)) out.thumb = thumb;
    const avatar = str(it.avatar, 500); if (avatar && /^https:\/\//.test(avatar)) out.avatar = avatar;
    const streamer = str(it.streamer, 50); if (streamer) out.streamer = streamer;
    const addedAt = Number(it.addedAt); if (Number.isFinite(addedAt) && addedAt > 0) out.addedAt = addedAt;
    return out;
}

// --- HANDLERS CLASSIQUES ---
async function handleGetVideos(url) {
    const name = (url.searchParams.get('name') || '').trim();
    const cursor = url.searchParams.get('cursor') || null;
    if (!LOGIN_RE.test(name)) return jsonError("Nom invalide", 400);
    if (cursor && !CURSOR_RE.test(cursor)) return jsonError("Curseur invalide", 400);

    const query = `query($login: String!, $after: Cursor) { user(login: $login) { profileImageURL(width: 70) videos(first: 100, type: ARCHIVE, sort: TIME, after: $after) { edges { node { id, title, publishedAt, lengthSeconds, viewCount, previewThumbnailURL(height: 180, width: 320) } } pageInfo { hasNextPage, endCursor } } } }`;
    
    try {
        const data = await twitchGQL(query, { login: name.toLowerCase(), after: cursor });
        const user = data.data.user;
        if (!user || !user.videos) return jsonError("Aucune vidéo", 404);
        
        return jsonResponse({ 
            videos: user.videos.edges.map(e => e.node), 
            pagination: user.videos.pageInfo,
            avatar: user.profileImageURL
        });
    } catch (e) { console.error(e); return jsonError("Twitch injoignable", 502); }
}

async function handleGetLive(url, workerOrigin) {
    const login = (url.searchParams.get('name') || '').trim().toLowerCase();
    if (!LOGIN_RE.test(login)) return jsonError("Nom invalide", 400);
    const useProxy = true; // On force toujours le proxy pour les Lives (CORS)
    
    // Ordre des sources choisi dans les réglages : essayées l'une après
    // l'autre jusqu'à ce qu'une réponde, pour que le direct se lance quand
    // même ; `source`, dans la réponse, dit laquelle a servi.
    const steps = liveSourceSteps(url.searchParams.get('order'), url.searchParams.get('source'));

    let m3u8Content = "";
    let masterUrl = "";
    let source = "";
    for (const id of steps) {
        try {
            const got = id === 'twitch' ? await usherLiveMaster(login) : await proxyLiveMaster(LIVE_PROXIES[id](login));
            if (!got) continue;
            m3u8Content = got.text;
            masterUrl = got.url;
            source = id;
            break;
        } catch (err) { /* source suivante */ }
    }
    if (!m3u8Content) return jsonError("Offline ou introuvable", 404);

    // Découpage du fichier M3U8 avec notre Proxy
    const links = parseAndProxyM3U8(m3u8Content, masterUrl, workerOrigin, false, useProxy);
    const variants = variantInfo(m3u8Content);
    
    // Récupération des infos du stream (Titre, Jeu, Avatar) pour un bel affichage
    try {
        const meta = await twitchGQL(`query($login: String!) { user(login: $login) { profileImageURL(width: 70) broadcastSettings { title game { displayName } } } }`, { login });
        const info = meta.data?.user?.broadcastSettings, avatar = meta.data?.user?.profileImageURL;
        return jsonResponse({ links, variants, source, best: links["Source"] || links["Auto"], title: info?.title || "Live", game: info?.game?.displayName || "", thumbnail: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-640x360.jpg`, avatar: avatar || "" });
    } catch(e) {
        // Si l'API GQL bug, on renvoie la vidéo quand même
        return jsonResponse({ links, variants, source, best: links["Source"] || links["Auto"], title: "Live", game: "", thumbnail: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-640x360.jpg`, avatar: "" });
    }
}

async function handleGetM3U8(url, workerOrigin) {
    const vodId = url.searchParams.get('id') || ''; if (!VOD_ID_RE.test(vodId)) return jsonError("ID invalide", 400);
    const useProxy = url.searchParams.get('proxy') !== 'false';
    
    // --- 1. Tentative Normale ---
    try {
        const token = await getAccessToken(vodId, false);
        if (token) {
            const res = await fetch(`https://usher.ttvnw.net/vod/${vodId}.m3u8?nauth=${encodeURIComponent(token.value)}&nauthsig=${encodeURIComponent(token.signature)}&allow_source=true&allow_audio_only=true&player_backend=mediaplayer`, { headers: REQUEST_HEADERS });
            if (res.ok) { 
                // allow_audio_only : « Audio seul » existe aussi pour les VODs.
                const text = await res.text();
                const links = parseAndProxyM3U8(text, res.url, workerOrigin, true, useProxy); 
                return jsonResponse({ links, variants: variantInfo(text), best: links["Source"] || links["Auto"] }); 
            }
            // Sans ce journal, l'échec ne laissait aucune trace (Docker compris).
            console.warn(`get-m3u8 ${vodId} : usher ${res.status}`);
        } else console.warn(`get-m3u8 ${vodId} : pas de jeton`);
    } catch (e) { console.warn(`get-m3u8 ${vodId} :`, e.message); }
    
    // --- 2. Plan de Secours ---
    try {
        const data = await twitchGQL(`query($id: ID!) { video(id: $id) { seekPreviewsURL } }`, { id: vodId }); const seekUrl = data.data?.video?.seekPreviewsURL;
        if (seekUrl) {
            const rawLinks = await storyboardHack(seekUrl, vodId);
            if (Object.keys(rawLinks).length > 0) {
                const proxied = (u) => useProxy ? `${workerOrigin}/api/proxy?url=${encodeURIComponent(u)}&isVod=true` : u;
                // « Auto » = la meilleure qualité trouvée (l'ordre des réponses était aléatoire).
                const finalLinks = { Auto: proxied(rawLinks[QUALITY_ORDER.find(q => rawLinks[q])]) };
                // La version d'origine (dossier « chunked ») s'appelle « Source »,
                // comme dans la liste maîtresse (variantName) : seuls les noms
                // contenant un libellé connu étaient recopiés, et « chunked » n'en
                // contient aucun — la qualité d'origine manquait à la liste.
                const source = rawLinks.chunked || rawLinks.source;
                if (source) finalLinks.Source = proxied(source);
                for (const q of QUALITY_ORDER) {
                    if (q !== 'chunked' && q !== 'source' && rawLinks[q]) finalLinks[q] = proxied(rawLinks[q]);
                }
                return jsonResponse({ links: finalLinks, best: finalLinks["Source"] || finalLinks["Auto"], info: "Backup" });
            }
            console.warn(`get-m3u8 ${vodId} : secours sans résultat`);
        } else console.warn(`get-m3u8 ${vodId} : pas d'aperçu (VOD supprimée ?)`);
    } catch (e) { console.warn(`get-m3u8 ${vodId} : secours`, e.message); }
    return jsonError("VOD introuvable", 404);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Récupération de VODs supprimées (pour le site : l'app iOS fait tout en natif).
//
//  Le navigateur ne peut appeler ni la source de métadonnées (CORS) ni le CDN
//  de Twitch : tout passe par ici. On relit l'id de diffusion + l'heure de
//  début chez la source externe (seul le nom public de la chaîne est transmis),
//  on reconstruit le dossier CDN — SHA1("login_streamID_epoch")[:20]_… — et on
//  cherche sa playlist parmi les hôtes connus. Les segments d'une VOD supprimée
//  ne restent qu'un temps : au-delà, 404.
// ═══════════════════════════════════════════════════════════════════════════
const RECOVER_HOSTS = [
    'd3vd9lfkzbru3h.cloudfront.net', 'd2nvs31859zcd8.cloudfront.net',
    'd3stzm2eumvgb4.cloudfront.net', 'd1m7jfoe9zdc1j.cloudfront.net',
    'd2vi6trrdongqn.cloudfront.net', 'd3fi1amfgojobc.cloudfront.net',
    'dgeft87wbj63p.cloudfront.net', 'ddacn6pr5v0tl.cloudfront.net',
    'd2e2de1etea730.cloudfront.net', 'dqrpb9wgowsf5.cloudfront.net',
    'ds0h3roq6wcgc.cloudfront.net', 'd2aba1wr3818hz.cloudfront.net',
    'd3c27h4odz752x.cloudfront.net', 'd1ymi26ma8va5x.cloudfront.net',
    'd1mhjrowxxagfy.cloudfront.net', 'd36nr0u3xmc4mm.cloudfront.net',
    'd1oca24q5dwo6d.cloudfront.net', 'd2um2qdswy1tb0.cloudfront.net',
    'vod-secure.twitch.tv', 'vod-metro.twitch.tv', 'vod-pop-secure.twitch.tv',
];

async function sha1hex(s) {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// GET /api/recover-list?channel= — diffusions passées récupérables (source externe).
// Source en panne (erreur, réponse illisible) : `unavailable: true`, pour que
// le site ne la confonde pas avec « rien à récupérer » (une chaîne inconnue
// de la source, elle, répond 200 et une liste vide). `streams` reste une
// liste vide : les anciens clients n'y voient pas de différence.
async function handleRecoverList(url) {
    const channel = (url.searchParams.get('channel') || '').toLowerCase();
    if (!LOGIN_RE.test(channel)) return jsonError('Chaîne invalide', 400);
    let arr;
    try {
        const r = await fetch(`https://api.vodvod.top/channels/@${channel}`,
            { headers: { 'User-Agent': REQUEST_HEADERS['User-Agent'], Accept: 'application/json' } });
        if (!r.ok) return jsonResponse({ streams: [], unavailable: true });
        arr = await r.json();
    } catch (e) { return jsonResponse({ streams: [], unavailable: true }); }
    if (!Array.isArray(arr)) return jsonResponse({ streams: [], unavailable: true });
    const streams = arr.map((it) => {
        const m = it.Metadata || {};
        const sid = typeof m.StreamID === 'string' ? m.StreamID : (m.StreamID != null ? String(m.StreamID) : '');
        const start = Date.parse(m.StartTime);
        if (!VOD_ID_RE.test(sid) || !Number.isFinite(start)) return null;
        // { Float64, Valid } ; Valid à false tant que la diffusion est en cours.
        const hls = m.HlsDurationSeconds || {};
        return {
            streamID: sid, login: String(m.StreamerLoginAtStart || channel).toLowerCase(),
            epoch: Math.floor(start / 1000), start: m.StartTime,
            title: String(m.TitleAtStart || ''), game: String(m.GameNameAtStart || ''),
            maxViews: Number(m.MaxViews) || 0,
            duration: hls.Valid ? Math.round(Number(hls.Float64) || 0) : 0,
        };
    }).filter(Boolean);
    return jsonResponse({ streams });
}

// Premier hôte servant la playlist, sondé en parallèle (borné par la taille de la liste).
async function firstRecoverHost(folder, hosts) {
    const checks = await Promise.all(hosts.map(async (h) => {
        try {
            const r = await fetch(`https://${h}/${folder}/chunked/index-dvr.m3u8`,
                { method: 'HEAD', headers: REQUEST_HEADERS });
            return r.status === 200 ? h : null;
        } catch (e) { return null; }
    }));
    return checks.find(Boolean) || null;
}

// GET /api/recover-resolve?login=&streamID=&epoch= — reconstruit la playlist.
// Sondes plafonnées (décalage 0 sur tous les hôtes, puis ±1 sur les plus
// courants) pour tenir sous la limite de sous-requêtes du plan gratuit.
async function handleRecoverResolve(url, workerOrigin) {
    const login = (url.searchParams.get('login') || '').toLowerCase();
    const streamID = url.searchParams.get('streamID') || '';
    const epoch = parseInt(url.searchParams.get('epoch') || '', 10);
    if (!LOGIN_RE.test(login) || !VOD_ID_RE.test(streamID) || !Number.isFinite(epoch)) {
        return jsonError('Paramètres invalides', 400);
    }
    const useProxy = url.searchParams.get('proxy') !== 'false';
    const plans = [
        { offsets: [0], hosts: RECOVER_HOSTS },
        { offsets: [-1, 1], hosts: RECOVER_HOSTS.slice(0, 8) },
    ];
    for (const plan of plans) {
        for (const off of plan.offsets) {
            const key = `${login}_${streamID}_${epoch + off}`;
            const folder = (await sha1hex(key)).slice(0, 20) + `_${key}`;
            const host = await firstRecoverHost(folder, plan.hosts);
            if (host) {
                const media = `https://${host}/${folder}/chunked/index-dvr.m3u8`;
                const link = useProxy ? `${workerOrigin}/api/proxy?url=${encodeURIComponent(media)}&isVod=true` : media;
                return jsonResponse({ links: { Source: link }, best: link, info: 'Recovered' });
            }
        }
    }
    return jsonError('VOD introuvable', 404);
}

// --- LE PROXY ---
// Hôtes que le proxy accepte de relayer : Twitch (playlists, segments,
// VODs) et Luminous. Sans cette liste, /api/proxy relayait n'importe quelle
// adresse — un proxy ouvert à tout Internet, aux frais du Worker.
// cloudfront.net n'y est plus : n'importe qui peut y ouvrir sa propre
// distribution et y déposer une page, que le proxy resservait sous le domaine
// du projet (en Docker, même origine que le site : elle lisait le jeton
// Twitch). Seules passent les distributions de Twitch (TWITCH_CLOUDFRONT).
const PROXY_HOSTS = ['ttvnw.net', 'jtvnw.net', 'twitch.tv', 'luminous.dev', 'twitchcdn.net', 'twitch-al.nadeko.net'];

// Distributions CloudFront des VODs de Twitch (archives, highlights, uploads,
// aperçus) : celles de RECOVER_HOSTS. Sondées le 15/10/2026 sur 200 chaînes
// (1 335 vidéos, playlists d'usher et seekPreviewsURL) : sept d'entre elles
// servent tout, playlist toujours sur la distribution de l'aperçu. Une
// distribution que Twitch ajouterait passe dès que Twitch lui-même la désigne
// (twitchVouches) ; aucune autre.
const TWITCH_CLOUDFRONT = new Set(RECOVER_HOSTS.filter((h) => h.endsWith('.cloudfront.net')));
// Verdicts de twitchCloudfront (mémoire de l'instance). Les refus ne valent
// que pour la vidéo ou la chaîne demandée, et ne partagent pas la liste des
// distributions reconnues : une adresse inventée ne bloque plus les vraies
// vidéos d'un hôte, et un flot de refus n'efface plus ce qui est reconnu.
const cloudfrontOk = new Map();      // hôte → fin de validité (désigné par Twitch)
const cloudfrontNo = new Map();      // « hôte|v:<vidéo> » ou « hôte|c:<chaîne> » → fin du refus
const cloudfrontAsks = new Map();    // « v:<vidéo> » ou « c:<chaîne> » → question GQL en cours
const cloudfrontBudget = { n: 0, until: 0 };   // questions GQL de la minute
const CLOUDFRONT_GQL_PER_MINUTE = 30;
// Redirections de l'amont suivies au plus (la suivante est refusée).
const PROXY_MAX_REDIRECTS = 4;

// Proxys au format TTV.LOL v1 : la requête usher, encodée, après
// /playlist/<chaîne>.m3u8 (« %3F » compris). Celui-ci est en Albanie ; ses
// variantes se lisent de n'importe quelle adresse et annoncent leurs segments
// d'avance, comme celles de Luminous.
const TTVLOL_HOSTS = ['twitch-al.nadeko.net'];
const ttvlolUrl = (host, login) =>
    `https://${host}/playlist/${login}.m3u8%3F${encodeURIComponent('allow_source=true&allow_audio_only=true&fast_bread=true')}`;

// Sources du direct, dans l'ordre automatique. Les proxys évitent la plupart
// des pubs, pas toutes : les pré-rolls à l'ouverture et les pauses pub lancées
// par la chaîne (« Commercial break in progress », DATERANGE
// « twitch-stitched-ad ») arrivent sur toutes les sources à la même seconde
// (sondes du 14/10) — le lecteur les signale et coupe le son. Ne pas passer le
// jeton en playerType « popout » : avec un Device-ID, il reçoit les mêmes.
// fast_bread : chaque playlist annonce en plus les deux prochains segments
// (« EXT-X-TWITCH-PREFETCH »), dont le lecteur du site se sert pour coller au
// direct.
// Luminous Asie d'abord, comme l'app ; l'européen renvoie des listes au
// format des serveurs IVS, où « Source » donnait un écran noir chez des
// utilisateurs. Twitch officiel, avec ses pubs, vient en dernier — ou en
// premier si on le choisit.
const LIVE_QUERY = 'allow_source=true&allow_audio_only=true&fast_bread=true';
const LIVE_PROXIES = {
    as: (login) => ({ url: `https://as.luminous.dev/live/${login}?${LIVE_QUERY}`, headers: getRequestHeaders(login) }),
    al: (login) => ({ url: ttvlolUrl(TTVLOL_HOSTS[0], login), headers: { 'X-Donate-To': 'https://ttv.lol/donate' } }),
    eu: (login) => ({ url: `https://eu.luminous.dev/live/${login}?${LIVE_QUERY}`, headers: getRequestHeaders(login) }),
};
const LIVE_PROXY_ORDER = ['as', 'al', 'eu'];
const LIVE_SOURCE_IDS = [...LIVE_PROXY_ORDER, 'twitch'];

/** Sources à essayer, dans l'ordre demandé (`order=eu,as,…`) ; une source
 *  inconnue est ignorée, une oubliée ajoutée à la fin : toutes restent
 *  essayées. Les clients d'avant l'ordre n'envoient que leur préférée
 *  (`source=`) : elle passe en tête de l'ordre automatique. */
function liveSourceSteps(order, wanted) {
    const asked = String(order || '').split(',').map((s) => s.trim())
        .filter((id, i, all) => LIVE_SOURCE_IDS.includes(id) && all.indexOf(id) === i);
    const first = asked.length ? asked : (LIVE_SOURCE_IDS.includes(wanted) ? [wanted] : []);
    return [...first, ...LIVE_SOURCE_IDS.filter((id) => !first.includes(id))];
}

/** Liste maîtresse d'un proxy ; null s'il ne répond pas ou si la
 *  chaîne y est hors ligne (pas de « #EXT-X-STREAM-INF »). */
async function proxyLiveMaster(c) {
    const r = await fetch(c.url, { headers: c.headers });
    if (!r.ok) return null;
    const text = await r.text();
    return text.includes('#EXT-X-STREAM-INF') ? { text, url: r.url } : null;
}

/** Liste maîtresse officielle de Twitch (usher), avec ses pubs. */
async function usherLiveMaster(login) {
    const token = await getAccessToken(login, true);
    if (!token) return null;
    const r = await fetch(`https://usher.ttvnw.net/api/channel/hls/${login}.m3u8?allow_source=true&allow_audio_only=true&allow_spectre=true&fast_bread=true&player=twitchweb&playlist_include_framerate=true&segment_preference=4&sig=${encodeURIComponent(token.signature)}&token=${encodeURIComponent(token.value)}`, { headers: REQUEST_HEADERS });
    return r.ok ? { text: await r.text(), url: r.url } : null;
}
/** Adresse que le proxy peut demander : https, port par défaut, hôte de
 *  PROXY_HOSTS ou distribution CloudFront de Twitch. */
async function proxyAllowed(target) {
    let u;
    try { u = new URL(target); } catch (e) { return false; }
    if (u.protocol !== 'https:' || u.port || u.username || u.password) return false;
    if (u.hostname.endsWith('.cloudfront.net')) return twitchCloudfront(u);
    return PROXY_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
}

/** Distribution CloudFront de Twitch ? Connue, ou désignée par Twitch pour
 *  la vidéo ou la chaîne du chemin (verdict gardé : 24 h oui ; non, 10 min
 *  pour cette vidéo ou cette chaîne seulement). */
async function twitchCloudfront(u) {
    const host = u.hostname;
    if (TWITCH_CLOUDFRONT.has(host)) return true;
    const now = Date.now();
    if ((cloudfrontOk.get(host) || 0) > now) return true;
    // Chemin d'aucune forme de Twitch : refusé sans rien demander.
    const subject = cloudfrontSubject(u);
    if (!subject) return false;
    const refusal = `${host}|${subject}`;
    if ((cloudfrontNo.get(refusal) || 0) > now) return false;
    let hosts;
    // GQL injoignable, ou trop de questions cette minute : refusé cette fois,
    // sans rien retenir.
    try { hosts = await twitchVouches(subject); } catch (e) { return false; }
    if (!hosts) return false;
    for (const h of hosts) rememberCloudfront(cloudfrontOk, h, 24 * 3600 * 1000, 100);
    if (hosts.has(host)) return true;
    rememberCloudfront(cloudfrontNo, refusal, 600 * 1000, 500);
    return false;
}

/** Garde `key` dans `map` pendant `ttl` ms ; à `max` entrées, les expirées
 *  partent, puis les plus anciennes. */
function rememberCloudfront(map, key, ttl, max) {
    const now = Date.now();
    map.delete(key);
    if (map.size >= max) {
        for (const [k, until] of map) if (until <= now) map.delete(k);
        for (const k of map.keys()) { if (map.size < max) break; map.delete(k); }
    }
    map.set(key, now + ttl);
}

/** Ce que nomme le chemin, sous une forme vue chez Twitch : une vidéo
 *  (« v:<id> ») ou une chaîne (« c:<login> ») ; null sinon.
 *    <empreinte>_<chaîne>_<diffusion>_<epoch>/…   archives, highlights
 *    <empreinte>/<chaîne>_<diffusion>_<n>/…       très vieux highlights
 *    <chaîne>/<vidéo>/<uuid>/…                    anciens uploads
 *    <empreinte>_<id chaîne>_<vidéo>_<uuid>/…     uploads */
function cloudfrontSubject(u) {
    const [a = '', b = ''] = u.pathname.split('/').filter(Boolean);
    if (a.length > 120 || b.length > 120) return null;
    let m;
    if ((m = /^[0-9a-f]{10,20}_\d+_(\d+)_[0-9a-f-]{36}$/.exec(a)) || (LOGIN_RE.test(a) && VOD_ID_RE.test(b) && (m = [a, b]))) {
        return `v:${m[1]}`;
    }
    if ((m = /^[0-9a-f]{10,20}_(\w+?)_\d+_\d+$/.exec(a)) || (/^[0-9a-f]{10,20}$/.test(a) && (m = /^(\w+?)_\d+_\d+$/.exec(b)))) {
        return LOGIN_RE.test(m[1]) ? `c:${m[1].toLowerCase()}` : null;
    }
    return null;
}

/** Distributions CloudFront où Twitch range la vidéo, ou les 50 dernières
 *  vidéos de la chaîne, d'après leurs aperçus (seekPreviewsURL). Une question
 *  déjà en cours n'est pas reposée (dix requêtes simultanées faisaient dix
 *  GQL) ; au-delà de CLOUDFRONT_GQL_PER_MINUTE questions dans la minute,
 *  null sans GQL : une distribution nouvelle n'en coûte qu'une, gardée 24 h. */
function twitchVouches(subject) {
    const pending = cloudfrontAsks.get(subject);
    if (pending) return pending;
    const now = Date.now();
    if (cloudfrontBudget.until <= now) Object.assign(cloudfrontBudget, { n: 0, until: now + 60 * 1000 });
    if (++cloudfrontBudget.n > CLOUDFRONT_GQL_PER_MINUTE) return Promise.resolve(null);
    const ask = (async () => {
        const id = subject.slice(2);
        const data = subject.startsWith('v:')
            ? await twitchGQL(`query($id: ID!) { video(id: $id) { seekPreviewsURL } }`, { id })
            : await twitchGQL(`query($login: String!) { user(login: $login) { videos(first: 50, sort: TIME) { edges { node { seekPreviewsURL } } } } }`, { login: id });
        if (!data?.data) throw new Error('GQL sans données');
        const hosts = new Set();
        const previews = [data.data.video?.seekPreviewsURL, ...(data.data.user?.videos?.edges || []).map((e) => e?.node?.seekPreviewsURL)];
        for (const p of previews) {
            try { const h = new URL(p).hostname; if (h.endsWith('.cloudfront.net')) hosts.add(h); } catch (e) {}
        }
        return hosts;
    })().finally(() => cloudfrontAsks.delete(subject));
    cloudfrontAsks.set(subject, ask);
    return ask;
}

/** Réponse de l'amont, redirections suivies à la main : chaque nouvelle
 *  adresse repasse par proxyAllowed (https, hôte autorisé). fetch() les
 *  suivait seul, vers n'importe où — en http, vers le réseau interne ou le
 *  service de métadonnées du serveur (SSRF). Rend { res, url } (url : la
 *  dernière adresse demandée, base des adresses relatives d'une playlist),
 *  ou {} quand une redirection est refusée. */
async function proxyUpstream(target, headers, doFetch) {
    let url = target;
    for (let hops = 0; ; hops++) {
        const res = await doFetch(url, { headers, redirect: 'manual' });
        const location = res.status >= 300 && res.status < 400 ? res.headers.get('Location') : null;
        if (!location) return { res, url };
        await res.body?.cancel().catch(() => {});
        let next;
        try { next = new URL(location, url).href; } catch (e) { return {}; }
        if (hops >= PROXY_MAX_REDIRECTS || !(await proxyAllowed(next))) return {};
        url = next;
    }
}

// Réponse du proxy : un type de média et les seuls en-têtes utiles à un
// lecteur. Tous ceux de l'amont étaient recopiés, type compris : une page
// HTML repartait en page HTML, active sous le domaine du site.
const PROXY_KEEP_HEADERS = ['cache-control', 'expires', 'last-modified', 'age'];
// Ceux qui décrivent le corps d'origine : pas pour une playlist réécrite, ni
// pour un corps décompressé en route.
const PROXY_BODY_HEADERS = ['content-length', 'content-range', 'accept-ranges', 'etag'];
// Segments (video/MP2T, video/mp4, application/octet-stream), aperçus
// (image/jpeg) et storyboards (binary/octet-stream) de Twitch. Pas de
// sous-type en « +xml » (video/x+xml…) : le navigateur l'affiche comme un
// document XML, XHTML compris.
const PROXY_MEDIA_TYPE = /^(?:(?:video|audio)\/(?![\w.+-]*\+xml$)[\w.+-]+|image\/(?:jpeg|png|gif|webp|avif)|application\/(?:octet-stream|mp4|json)|binary\/octet-stream)$/;

/** Type servi pour un corps relayé tel quel : celui de l'amont s'il est un
 *  type de média, sinon un fichier opaque (page HTML, SVG, script…). */
function proxyMediaType(raw) {
    const essence = String(raw || '').split(/[;,]/)[0].trim().toLowerCase();
    return PROXY_MEDIA_TYPE.test(essence) ? essence : 'application/octet-stream';
}

function proxyResponseHeaders(res, type, sameBody) {
    const out = new Headers();
    const names = sameBody && !res.headers.get('content-encoding') ? [...PROXY_KEEP_HEADERS, ...PROXY_BODY_HEADERS] : PROXY_KEEP_HEADERS;
    for (const name of names) {
        const v = res.headers.get(name);
        if (v !== null) out.set(name, v);
    }
    out.set('Content-Type', type);
    out.set('Access-Control-Allow-Origin', '*');
    out.set('Access-Control-Expose-Headers', '*');
    // Ouverte dans un onglet, une réponse du proxy n'est jamais une page active.
    out.set('X-Content-Type-Options', 'nosniff');
    out.set('Content-Security-Policy', "sandbox; default-src 'none'");
    return out;
}

async function handleProxy(url, request, env) {
    const target = url.searchParams.get('url'); if (!target) return new Response("URL manquante", { status: 400, headers: RESPONSE_HEADERS });
    if (!(await proxyAllowed(target))) return new Response("Hôte non autorisé", { status: 403, headers: RESPONSE_HEADERS });
    const isVod = url.searchParams.get('isVod') === 'true', workerOrigin = url.origin;

    let fetchHeaders = { ...REQUEST_HEADERS };
    if (request.headers.get("Range")) fetchHeaders["Range"] = request.headers.get("Range");

    // Le relais du VPS fournit son propre fetch, qui refuse en plus toute
    // adresse interne (docker/relay.mjs).
    const doFetch = typeof env?.PROXY_FETCH === 'function' ? env.PROXY_FETCH : (u, init) => fetch(u, init);
    const up = await proxyUpstream(target, fetchHeaders, doFetch);
    if (!up.res) return new Response("Redirection non autorisée", { status: 403, headers: RESPONSE_HEADERS });
    const res = up.res;

    // Playlist reconnue à son type, pas seulement à son extension : celles
    // de Luminous (« /live/<chaîne>?allow_source=true ») et les variantes
    // qu'elles listent (« …playlist.ttvnw.net/v1/playlist/… ») n'ont pas de
    // « .m3u8 ». Non reconnues, elles passaient sans réécriture.
    const type = res.headers.get('content-type') || '';
    if (target.includes('.m3u8') || /mpegurl/i.test(type)) {
        const newHeaders = proxyResponseHeaders(res, 'application/vnd.apple.mpegurl', false);
        const finalUrl = up.url, base = finalUrl.substring(0, finalUrl.lastIndexOf('/') + 1);
        const proxyUrl = (full) => `${workerOrigin}/api/proxy?url=${encodeURIComponent(full)}&isVod=${isVod}`;
        // Une sous-playlist passe TOUJOURS par le proxy : demandée par le
        // navigateur, elle était refusée (403). La cause est l'en-tête Origin
        // qu'il ajoute (mesuré par deux enquêtes du 14/10), pas un lien avec
        // l'adresse IP. Les segments d'un direct, eux, partent en direct :
        // leur CDN accepte tout le monde.
        const isPlaylistUrl = (full) => full.includes('.m3u8') || /(^|\.)playlist\.ttvnw\.net\//.test(new URL(full).hostname + '/') || /luminous\.dev$/.test(new URL(full).hostname);
        const proxify = (u, playlist) => {
            const full = u.startsWith('http') ? u : new URL(u, base).href;
            return (isVod || playlist || isPlaylistUrl(full)) ? proxyUrl(full) : full;
        };
        let nextIsPlaylist = false;
        const newText = (await res.text()).split('\n').map(l => {
            const line = l.trim(); if (!line) return line;
            if (line.startsWith('#')) {
                // La ligne qui suit EXT-X-STREAM-INF est une sous-playlist.
                if (line.startsWith('#EXT-X-STREAM-INF')) nextIsPlaylist = true;
                const tagIsPlaylist = line.startsWith('#EXT-X-MEDIA') || line.startsWith('#EXT-X-I-FRAME-STREAM-INF');
                // Balises avec une adresse (EXT-X-MAP du fMP4, EXT-X-KEY,
                // pistes audio EXT-X-MEDIA…).
                return line.replace(/URI="([^"]+)"/g, (_m, u) => `URI="${proxify(u, tagIsPlaylist)}"`);
            }
            // Passages coupés pour droits d'auteur : les playlists du CDN des
            // VODs les listent en « N-unmuted.ts », que le CDN refuse (403) —
            // la lecture bloquait dès le premier. Seul « N-muted.ts » (son
            // coupé) se lit.
            const out = proxify(line.replace(/-unmuted\.ts(?=$|\?)/, '-muted.ts'), nextIsPlaylist);
            nextIsPlaylist = false;
            return out;
        }).join('\n');
        return new Response(newText, { status: res.status, headers: newHeaders });
    }
    return new Response(res.body, { status: res.status, headers: proxyResponseHeaders(res, proxyMediaType(type), true) });
}

// --- FONCTIONS UTILITAIRES ---
// Nom de chaque qualité, dans les deux formats de playlist maîtresse :
// l'ancien (VIDEO="chunked", repris des lignes EXT-X-MEDIA) et celui des
// serveurs IVS que renvoie maintenant le miroir européen de Luminous
// (STABLE-VARIANT-ID="1080p60", IVS-VARIANT-SOURCE="source", sans
// EXT-X-MEDIA). Seul le premier était reconnu : le site n'affichait plus que
// « Auto ». La version d'origine garde le nom « Source » dans les deux cas,
// pour que la qualité retenue par chacun reste valable.
// En multi-encodage (Enhanced Broadcasting : le streamer envoie lui-même
// chaque qualité), le format IVS marque TOUTES les variantes « source »,
// audio seul compris : toutes s'appelaient « Source » et la dernière,
// l'audio seul, l'emportait — écran noir en « Source » (gotaga, miroir
// européen). « Source » n'est donc retenu que pour une variante vidéo seule
// de son espèce (`ivsSource`) ; sinon chaque qualité garde son nom, comme
// chez Luminous Asie.
function variantName(streamInf, sourceGroups = new Set(), ivsSource = true) {
    const attr = (name) => (streamInf.match(new RegExp(`[:,]${name}="([^"]+)"`)) || [])[1];
    const name = attr('VIDEO') || attr('STABLE-VARIANT-ID') || attr('IVS-NAME') || '';
    const ivs = ivsSource && attr('IVS-VARIANT-SOURCE') === 'source' && /[:,]RESOLUTION=/.test(streamInf);
    return name === 'chunked' || sourceGroups.has(name) || ivs ? 'Source' : name;
}

/** Une seule variante vidéo marquée « source » (format IVS) : c'est la
 *  version d'origine. Plusieurs : multi-encodage, aucune ne l'est plus
 *  qu'une autre. */
function singleIvsSource(content) {
    return content.split('\n').filter((l) => l.startsWith('#EXT-X-STREAM-INF')
        && /[:,]IVS-VARIANT-SOURCE="source"/.test(l) && /[:,]RESOLUTION=/.test(l)).length <= 1;
}

/** Groupes vidéo marqués « (source) » dans leur nom (EXT-X-MEDIA) : certains
 *  proxys, comme celui de l'Albanie, nomment la version d'origine « 1080p60 »
 *  au lieu de « chunked ». */
function sourceGroupsOf(content) {
    const groups = new Set();
    for (const l of content.split('\n')) {
        if (!l.startsWith('#EXT-X-MEDIA') || !/\(source\)/i.test(l)) continue;
        const g = (l.match(/GROUP-ID="([^"]+)"/) || [])[1];
        if (g) groups.add(g);
    }
    return groups;
}

/** Hauteur, cadence et débit de chaque qualité, sous les noms de
 *  parseAndProxyM3U8 (même parcours, la dernière variante d'un nom gagne) :
 *  « Source » ne dit pas sa hauteur (1080p60, 720p60, 936p…), et sans elle
 *  une qualité préférée de 720p prenait la 480p sur une chaîne en 720p60.
 *  Facultatif pour les clients (Worker pas à jour, secours storyboard). */
function variantInfo(content) {
    const sources = sourceGroupsOf(content), single = singleIvsSource(content), out = {};
    let last = null;
    for (const l of content.split('\n')) {
        if (l.startsWith('#EXT-X-STREAM-INF')) {
            const name = variantName(l, sources, single);
            const num = (re) => Number((l.match(re) || [])[1]) || 0;
            last = name ? { name, info: { h: num(/[:,]RESOLUTION=\d+x(\d+)/), fps: Math.round(num(/[:,]FRAME-RATE=([\d.]+)/)), bw: num(/[:,]BANDWIDTH=(\d+)/) } } : null;
        } else if (l.startsWith('http') && last) { out[last.name] = last.info; last = null; }
    }
    return out;
}

function parseAndProxyM3U8(content, master, workerOrigin, isVod, useProxy = true) { 
    const lines = content.split('\n'); const proxyBase = `${workerOrigin}/api/proxy?url=`; let unsorted = {}, last = ""; const sources = sourceGroupsOf(content), single = singleIvsSource(content); 
    lines.forEach(l => { 
        if (l.startsWith('#EXT-X-STREAM-INF')) { last = variantName(l, sources, single); }
        else if (l.startsWith('http') && last) { unsorted[last] = useProxy ? `${proxyBase}${encodeURIComponent(l)}&isVod=${isVod}` : l; last = ""; } 
    }); 
    let sorted = {}; sorted["Auto"] = useProxy ? `${proxyBase}${encodeURIComponent(master)}&isVod=${isVod}` : master; 
    ['Source', '1080p60', '1080p30', '720p60', '720p30', '480p30', '360p30', '160p30', 'audio_only'].forEach(key => { Object.keys(unsorted).forEach(k => { if (k.toLowerCase().includes(key.toLowerCase())) { sorted[k] = unsorted[k]; delete unsorted[k]; } }); }); Object.assign(sorted, unsorted); return sorted; 
}

async function twitchGQL(query, variables = {}) {
    const res = await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json', 'User-Agent': REQUEST_HEADERS['User-Agent'], 'Device-ID': 'MkMq8a9' + Math.random().toString(36).substring(2, 15) },
        body: JSON.stringify({ query, variables })
    });
    if (!res.ok) throw new Error(`GQL ${res.status}`);
    return await res.json();
}

async function getAccessToken(id, isLive) {
    const query = isLive 
        ? `query($id: String!) { streamPlaybackAccessToken(channelName: $id, params: {platform: "web", playerBackend: "mediaplayer", playerType: "site"}) { value signature } }`
        : `query($id: ID!) { videoPlaybackAccessToken(id: $id, params: {platform: "web", playerBackend: "mediaplayer", playerType: "site"}) { value signature } }`;
    const data = await twitchGQL(query, { id });
    return isLive ? data.data?.streamPlaybackAccessToken : data.data?.videoPlaybackAccessToken;
}

// Une archive a sa playlist dans `<qualité>/index-dvr.m3u8` ; un highlight
// (les vidéos des playlists de chaîne) dans `<qualité>/highlight-<id>.m3u8`.
// Seul le premier nom était essayé : le secours échouait toujours sur les
// highlights, et la VOD tombait en « introuvable ».
async function storyboardHack(seekUrl, vodId) {
    try {
        const parts = seekUrl.split('/');
        const storyIndex = parts.indexOf('storyboards');
        if (storyIndex === -1) return {};
        const hash = parts[storyIndex - 1]; 
        const root = `https://${new URL(seekUrl).host}/${hash}`;

        let found = {};
        const names = ['index-dvr.m3u8', ...(VOD_ID_RE.test(vodId || '') ? [`highlight-${vodId}.m3u8`] : [])];
        await Promise.all(QUALITY_ORDER.map(async q => {
            for (const name of names) {
                const u = `${root}/${q}/${name}`;
                const res = await fetch(u, { method: 'HEAD', headers: REQUEST_HEADERS });
                if (res.status === 200) { found[q] = u; return; }
            }
        }));
        return found;
    } catch(e) { return {}; }
}

// En-têtes pour Luminous : un Referer pointant sur la chaîne demandée.
// La fonction était appelée sans exister : l'appel levait une ReferenceError,
// avalée par le catch, et la route servait toujours le flux Twitch officiel,
// avec les publicités — Luminous n'était jamais réellement essayé.
function getRequestHeaders(login) {
    return { ...REQUEST_HEADERS, 'Referer': `https://www.twitch.tv/${login}` };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Comptage d'utilisation — app iOS et site.
//
//  Une clé par installation (app) ou par navigateur (site) : `usage_<uuid>`,
//  valeur vide, tout dans les métadonnées. Stocké : un identifiant tiré au
//  hasard, des dates (sans l'heure), une version, la plateforme. Pas
//  d'adresse IP, pas d'en-tête, rien du compte Twitch. Les clés expirent
//  seules au bout de 35 jours. Préfixe `usage_` : aucune collision avec la
//  sauvegarde (`user_`).
// ═══════════════════════════════════════════════════════════════════════════
const USAGE_PREFIX = 'usage_';
const USAGE_ACCOUNT_PREFIX = 'usage_a_';
/** Comptes Twitch administrateurs (ID numérique : le pseudo peut changer),
 *  posés par la variable ADMIN_TWITCH_IDS, ou OFFICIAL_ADMIN_TWITCH_IDS
 *  (wrangler.toml) pour l'instance officielle (applyEnvConfig). Aucun par
 *  défaut : une instance auto-hébergée qui ne la remplissait pas donnait au
 *  compte du développeur officiel les outils d'administration — retours et
 *  contacts, comptes du comptage, effacements, annonces. */
let ADMIN_IDS = [];
const USAGE_RETENTION_DAYS = 35;
// tvos : l'app Apple TV (comptée à part depuis la 0.1.15).
const PLATFORMS = ['ios', 'web', 'tvos'];
// Le site officiel : un ping « web » venu d'ailleurs (copie locale, tests,
// préversions) n'est pas compté. L'app iOS n'envoie pas d'en-tête Origin.
let USAGE_ORIGINS = ['https://twitchunblock.vercel.app', 'https://test2-fawn-eta.vercel.app'];
// Navigateurs automatisés et robots qui exécutent le JavaScript.
const BOT_UA = /headless|bot\b|crawler|spider|slurp|playwright|puppeteer|selenium|phantomjs|lighthouse|preview/i;
// Ce que le ping peut ajouter (pour /stats) : langue de l'interface, type
// d'appareil, version majeure d'iOS, et des compteurs de lectures — la source
// qui a servi un direct, les échecs. Jamais de chaîne ni de titre.
const USAGE_DEVICES = ['iphone', 'ipad', 'tv', 'mobile', 'desktop'];
// Langue (l) et appareil (d) par plateforme : i(OS), w(eb), t(vOS) ; version d'iOS.
const USAGE_META_FIELDS = ['li', 'lw', 'lt', 'di', 'dw', 'dt', 'os'];
// live_account : direct de l'app servi par le compte d'un abonné sans pub ;
// live_ad_break : pause pub de la chaîne affichée (une fois par pause).
const USAGE_EVENTS = ['live_as', 'live_al', 'live_eu', 'live_twitch', 'live_account', 'live_worker', 'live_unknown',
    'live_fail', 'live_play_fail', 'live_ad_break', 'vod', 'vod_fail', 'vod_play_fail'];

// POST /api/ping — { id, version, platform } enregistre ; { id, forget: true } efface.
async function handlePing(request, env) {
    // GET : les plateformes comptées. L'app Apple TV ne signale rien tant que
    // « tvos » n'y figure pas (un Worker d'avant la compterait comme l'iPhone).
    if (request.method === 'GET') return jsonResponse({ ok: true, platforms: PLATFORMS });
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
    if (!env.DB) return jsonError("Base D1 'DB' non liée au Worker.", 500);
    let body;
    try { body = await request.json(); } catch (e) { return jsonError('JSON invalide', 400); }

    // Chaque ping est une écriture D1 (100 000 par jour en gratuit) : une même
    // adresse ne peut pas en enchaîner des centaines. Compté en mémoire
    // seulement, jamais stocké.
    if (overLimit(pingHits, clientKey(request), 10)) return jsonError('Trop de requêtes', 429);

    // Bruit écarté sans erreur (le client n'a rien à corriger) : robots et
    // navigateurs automatisés, et pings « web » hors du site officiel.
    const origin = request.headers.get('Origin');
    const ua = request.headers.get('User-Agent') || '';
    if (BOT_UA.test(ua) || (origin && !USAGE_ORIGINS.includes(origin))) {
        return jsonResponse({ ok: true, ignored: true });
    }

    // L'app officielle joint un jeton de build (en-tête X-TU-Key) qu'un fork
    // réutilisant ce backend ne possède pas : lui compté gonflerait la base et
    // le quota pour des utilisateurs qui ne sont pas les nôtres. Le site, lui,
    // est déjà filtré par son origine ; le retrait (forget) passe toujours.
    // Inactif tant que PING_KEY n'est pas défini sur le Worker : rien ne change
    // d'ici là, et aucune installation officielle existante n'est perdue avant
    // qu'elle n'embarque le jeton.
    const fromOfficialSite = origin && USAGE_ORIGINS.includes(origin);
    if (env.PING_KEY && !fromOfficialSite && body.forget !== true
        && request.headers.get('X-TU-Key') !== env.PING_KEY) {
        return jsonResponse({ ok: true, ignored: true });
    }

    // Uniquement des UUID : pas question de laisser écrire des clés libres.
    const id = String(body.id || '');
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) return jsonError('ID invalide', 400);

    // Connecté à Twitch : on compte le COMPTE (un seul, quel que soit le
    // nombre d'appareils ou de navigateurs), clé `usage_a_<id Twitch>`.
    // Sinon l'identifiant aléatoire de l'appareil, clé `usage_<uuid>`.
    const who = request.headers.get('Authorization') ? await tokenIdentity(request) : null;
    const anonKey = USAGE_PREFIX + id;
    const key = who ? USAGE_ACCOUNT_PREFIX + who.userId : anonKey;

    if (body.forget === true) {
        await store(env).delete(anonKey);
        if (who) await store(env).delete(key);
        return jsonResponse({ ok: true, forgotten: true });
    }

    const day = new Date().toISOString().slice(0, 10);
    const platform = PLATFORMS.includes(body.platform) ? body.platform : 'ios';
    const version = String(body.version || '?').slice(0, 16);
    let prev = {};
    try { prev = (await store(env).getWithMetadata(key)).metadata || {}; } catch (e) {}

    // Première connexion sur cet appareil : l'historique anonyme est repris
    // par le compte, puis effacé (sinon la même personne compterait deux fois).
    if (who) {
        let anon = null;
        try { anon = (await store(env).getWithMetadata(anonKey)).metadata; } catch (e) {}
        if (anon) {
            if (!prev.first || (anon.first && anon.first < prev.first)) prev.first = anon.first;
            prev.days = Math.max(prev.days || 0, anon.days || 0);
            if (anon.last && (!prev.last || anon.last > prev.last)) prev.last = anon.last;
            // Les plateformes vues anonymement restent acquises au compte.
            const seen = new Set([...(prev.ps ? String(prev.ps).split(',') : (prev.p ? [prev.p] : [])), ...(anon.ps ? String(anon.ps).split(',') : (anon.p ? [anon.p] : []))]);
            prev.ps = [...seen].filter((x) => PLATFORMS.includes(x)).sort().join(',');
            await store(env).delete(anonKey);
        }
    }

    const platforms = [...new Set([...(prev.ps ? String(prev.ps).split(',') : (prev.p ? [prev.p] : [])), platform])].filter((x) => PLATFORMS.includes(x)).sort().join(',');
    const days = prev.last === day ? (prev.days || 1) : (prev.days || 0) + 1;
    // Premier signal de la journée pour cette personne (l'historique anonyme
    // repris compris) : comptée une fois dans les actifs du jour.
    const firstToday = prev.last !== day;
    const meta = { first: prev.first || day, last: day, days, v: version, p: platform, ps: platforms };
    if (who) { meta.k = 'a'; meta.l = who.login.slice(0, 25); }

    // Langue et appareil, par plateforme (un compte peut utiliser l'app et le
    // site) ; gardés tels quels si le client ne les envoie pas (anciennes versions).
    const suffix = platform === 'web' ? 'w' : platform === 'tvos' ? 't' : 'i';
    for (const f of USAGE_META_FIELDS) if (prev[f] !== undefined) meta[f] = prev[f];
    const lang = String(body.lang || '').toLowerCase();
    if (/^[a-z]{2}$/.test(lang)) meta['l' + suffix] = lang;
    if (USAGE_DEVICES.includes(body.device)) meta['d' + suffix] = body.device;
    if (platform === 'ios' && /^\d{1,2}$/.test(String(body.os ?? ''))) meta.os = String(body.os);

    // Compteurs du jour : actifs (une fois par personne), lectures par issue
    // (plafonnées par ping, contre un client qui enverrait n'importe quoi).
    const counts = {};
    if (firstToday) {
        counts.a = 1;
        counts['a_' + platform] = 1;
        counts[who ? 'a_acct' : 'a_anon'] = 1;
    }
    if (body.ev && typeof body.ev === 'object') {
        for (const k of USAGE_EVENTS) {
            const n = Math.min(50, Math.max(0, Math.floor(Number(body.ev[k]) || 0)));
            if (n) counts[`ev_${platform}_${k}`] = n;
        }
    }
    try { await bumpDaily(env, day, counts); } catch (e) { console.warn('stats_day :', e.message); }

    // Rien de neuf aujourd'hui : pas d'écriture.
    const same = (f) => prev[f] === meta[f];
    if (prev.last === day && prev.v === version && prev.ps === platforms && (!who || prev.l === meta.l)
        && USAGE_META_FIELDS.every(same)) {
        return jsonResponse({ ok: true, days, unchanged: true });
    }
    await store(env).put(key, '', { expirationTtl: 60 * 60 * 24 * USAGE_RETENTION_DAYS, metadata: meta });
    return jsonResponse({ ok: true, days, account: Boolean(who) });
}

const pingHits = new Map();   // adresse → { n, until } (mémoire de l'instance, voir overLimit)

// Les statistiques parcourent toutes les entrées de comptage (lectures D1 :
// 5 millions par jour en gratuit). Mises en cache une minute, pour qu'une
// page rechargée en boucle ne vide pas le quota.
// (Cache API inopérant sur workers.dev : cache en mémoire de l'instance.)
let statsCache = null;   // { body, until }
async function cachedStats(request, env, ctx) {
    if (statsCache && statsCache.until > Date.now()) {
        return new Response(statsCache.body, { headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
    const res = await handleStats(env);
    if (res.ok) statsCache = { body: await res.clone().text(), until: Date.now() + 60 * 1000 };
    return res;
}

// GET /api/stats — compteurs agrégés, au total et par plateforme.
async function handleStats(env) {
    if (!env.DB) return jsonError("Base D1 'DB' non liée au Worker.", 500);
    const todayMs = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    // `…New` : parmi les personnes de la période, celles vues pour la
    // première fois pendant cette période (les autres étaient déjà venues).
    const blank = () => ({ today: 0, week: 0, month: 0, known: 0, returning: 0, todayNew: 0, weekNew: 0, monthNew: 0 });
    const total = blank();
    const kinds = { accounts: blank(), anonymous: blank() };
    const platforms = Object.fromEntries(PLATFORMS.map((p) => [p, blank()]));
    const versions = {};
    const loyalty = { once: 0, few: 0, regular: 0, daily: 0 };
    let returning = 0, totalDays = 0, oldestFirst = null, cursor;
    // Série des 30 derniers jours : nouveaux (premier jour vu) et vus pour la
    // dernière fois ce jour-là, par plateforme.
    const dayKey = (offset) => new Date(todayMs - offset * 86400000).toISOString().slice(0, 10);
    const daily = {};
    for (let i = 29; i >= 0; i--) daily[dayKey(i)] = { date: dayKey(i), newIos: 0, newWeb: 0, newTv: 0, lastIos: 0, lastWeb: 0, lastTv: 0 };

    // Rétention : parmi ceux arrivés il y a au moins N jours, la part revue N
    // jours ou plus après son premier jour (J+1, J+7, J+14), au total et par
    // semaine d'arrivée (lundi UTC). Les entrées s'effacent 35 jours après le
    // dernier passage : au-delà de 5 semaines, les chiffres seraient flatteurs.
    const ret = { d1: { base: 0, kept: 0 }, d7: { base: 0, kept: 0 }, d14: { base: 0, kept: 0 } };
    const cohorts = {};
    const weekOf = (iso) => {
        const d = new Date(iso + 'T00:00:00Z');
        return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
    };
    // Appareils : personnes actives sur 30 jours qui envoient ces infos.
    const devices = { reporting: { ios: 0, web: 0, tvos: 0 }, lang: { ios: {}, web: {}, tvos: {} }, os: {}, device: { ios: {}, web: {}, tvos: {} } };
    const tally = (obj, k) => { obj[k] = (obj[k] || 0) + 1; };

    // list() renvoie les métadonnées sans lecture par clé ; 1000 clés par page.
    do {
        const page = await store(env).list({ prefix: USAGE_PREFIX, limit: 1000, cursor });
        for (const key of page.keys) {
            const meta = key.metadata || {};
            const then = Date.parse((meta.last || '') + 'T00:00:00Z');
            const age = Number.isNaN(then) ? Infinity : Math.floor((todayMs - then) / 86400000);
            const firstThen = Date.parse((meta.first || meta.last || '') + 'T00:00:00Z');
            const firstAge = Number.isNaN(firstThen) ? Infinity : Math.floor((todayMs - firstThen) / 86400000);
            // Une seule plateforme par identifiant : l'app iPhone d'abord (le
            // vrai signe d'adoption), puis l'Apple TV, puis le site.
            const plats = meta.ps ? String(meta.ps).split(',') : [meta.p || 'ios'];
            const plat = plats.includes('ios') ? 'ios' : plats.includes('tvos') ? 'tvos' : plats.includes('web') ? 'web' : 'ios';
            const buckets = [platforms[plat]];
            const kind = meta.k === 'a' ? kinds.accounts : kinds.anonymous;
            // Une seule fois par période, quel que soit le nombre de jours où
            // la personne (le compte, ou l'appareil sans compte) est revenue.
            for (const c of [total, kind, ...buckets]) {
                c.known++;
                if (age === 0) { c.today++; if (firstAge === 0) c.todayNew++; }
                if (age <= 7) { c.week++; if (firstAge <= 7) c.weekNew++; }
                if (age <= 30) { c.month++; if (firstAge <= 30) c.monthNew++; }
            }
            if (age <= 30) { const v = `${meta.p || 'ios'} ${meta.v || '?'}`; versions[v] = (versions[v] || 0) + 1; }
            const d = meta.days || 1;
            totalDays += d;
            if (d >= 2) { returning++; kind.returning++; for (const b of buckets) b.returning++; }
            if (d === 1) loyalty.once++; else if (d < 7) loyalty.few++; else if (d < 30) loyalty.regular++; else loyalty.daily++;
            if (meta.first && (!oldestFirst || meta.first < oldestFirst)) oldestFirst = meta.first;
            const p = plat === 'web' ? 'Web' : plat === 'tvos' ? 'Tv' : 'Ios';
            if (daily[meta.first]) daily[meta.first]['new' + p]++;
            if (daily[meta.last]) daily[meta.last]['last' + p]++;

            if (meta.first && Number.isFinite(firstAge)) {
                const span = Math.round((then - firstThen) / 86400000);
                const week = weekOf(meta.first);
                const c = cohorts[week] ??= { week, size: 0, d1: { base: 0, kept: 0 }, d7: { base: 0, kept: 0 } };
                c.size++;
                for (const [n, k] of [[1, 'd1'], [7, 'd7'], [14, 'd14']]) {
                    if (firstAge < n) continue;
                    ret[k].base++;
                    if (span >= n) ret[k].kept++;
                    if (c[k]) { c[k].base++; if (span >= n) c[k].kept++; }
                }
            }
            if (age <= 30) {
                if (meta.li || meta.di || meta.os) devices.reporting.ios++;
                if (meta.lw || meta.dw) devices.reporting.web++;
                if (meta.lt || meta.dt) devices.reporting.tvos++;
                if (meta.lt) tally(devices.lang.tvos, meta.lt);
                if (meta.dt) tally(devices.device.tvos, meta.dt);
                if (meta.li) tally(devices.lang.ios, meta.li);
                if (meta.lw) tally(devices.lang.web, meta.lw);
                if (meta.os) tally(devices.os, meta.os);
                if (meta.di) tally(devices.device.ios, meta.di);
                if (meta.dw) tally(devices.device.web, meta.dw);
            }
        }
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    // Actifs par jour et santé du direct : compteurs de stats_day (depuis
    // leur mise en place seulement, l'historique d'avant n'existe pas).
    const activeDaily = Object.keys(daily).map((date) => ({ date, total: 0, ios: 0, web: 0, tvos: 0, acct: 0, anon: 0 }));
    const byDate = Object.fromEntries(activeDaily.map((d) => [d.date, d]));
    const health = { week: { ios: {}, web: {}, tvos: {} }, month: { ios: {}, web: {}, tvos: {} }, since: null };
    let activeSince = null;
    // Notifications : envois réussis par jour (et le reste des compteurs).
    const pushDaily = Object.keys(daily).map((date) => ({ date, ok_web: 0, ok_ntfy: 0 }));
    const pushByDate = Object.fromEntries(pushDaily.map((d) => [d.date, d]));
    const pushWeek = {};
    let pushSince = null;
    try {
        await ensureSchema(env);
        const { results } = await env.DB.prepare(`SELECT day, metric, n FROM stats_day WHERE day >= ?1`).bind(dayKey(29)).all();
        const weekStart = dayKey(6);
        for (const r of results || []) {
            const n = Number(r.n) || 0;
            const m = String(r.metric);
            if (m.startsWith('ev_')) {
                const [, plat, ...rest] = m.split('_');
                const key = rest.join('_');
                if (!health.month[plat]) continue;
                health.month[plat][key] = (health.month[plat][key] || 0) + n;
                if (r.day >= weekStart) health.week[plat][key] = (health.week[plat][key] || 0) + n;
                if (!health.since || r.day < health.since) health.since = r.day;
            } else if (m === 'a' || m.startsWith('a_')) {
                const d = byDate[r.day];
                if (!d) continue;
                const field = m === 'a' ? 'total' : m.slice(2);
                if (field in d) d[field] += n;
                if (m === 'a' && n > 0 && (!activeSince || r.day < activeSince)) activeSince = r.day;
            } else if (m.startsWith('pu_')) {
                const key = m.slice(3);
                const d = pushByDate[r.day];
                if (d) d[key] = (d[key] || 0) + n;
                if (r.day >= weekStart) pushWeek[key] = (pushWeek[key] || 0) + n;
                if (!pushSince || r.day < pushSince) pushSince = r.day;
            }
        }
    } catch (e) { console.warn('stats_day :', e.message); }

    // Notifications de live : état du moment (abonnés, chaînes, file, ntfy)
    // et compteurs du jour. Que des nombres : aucune chaîne, aucun abonné.
    let push = null;
    try {
        const rows = (sql, ...args) => {
            const st = env.DB.prepare(sql);
            return (args.length ? st.bind(...args) : st).all().then((r) => r.results || []);
        };
        const [subs, services, channels, follows, queue, pauseRow] = await Promise.all([
            rows(`SELECT kind, COUNT(*) AS n, SUM(created >= ?1) AS today, SUM(created >= ?2) AS week
                  FROM push_subs GROUP BY kind`, todayMs, todayMs - 6 * 86400000),
            // Service de push du navigateur, d'après l'adresse d'envoi.
            rows(`SELECT CASE
                    WHEN endpoint LIKE '%push.apple.com/%' THEN 'apple'
                    WHEN endpoint LIKE '%googleapis.com/%' THEN 'google'
                    WHEN endpoint LIKE '%push.services.mozilla.com/%' THEN 'mozilla'
                    WHEN endpoint LIKE '%notify.windows.com/%' THEN 'microsoft'
                    ELSE 'other' END AS svc, COUNT(*) AS n
                  FROM push_subs WHERE kind IS NOT 'ntfy' GROUP BY svc`),
            rows(`SELECT COUNT(*) AS n, SUM(stream IS NOT NULL AND stream != '?') AS live FROM push_live`),
            rows(`SELECT COUNT(*) AS n FROM push_follow`),
            rows(`SELECT s.kind, COUNT(*) AS n, MIN(q.at) AS oldest
                  FROM push_queue q JOIN push_subs s ON s.id = q.sub GROUP BY s.kind`),
            rows(`SELECT value FROM kv WHERE key = 'push_ntfy_pause'`),
        ]);
        const side = (r) => (r.kind === 'ntfy' ? 'ntfy' : 'web');
        const kinds = Object.fromEntries(subs.map((r) => [side(r), r]));
        const num = (v) => Number(v) || 0;
        let pause = null;
        try { pause = JSON.parse(pauseRow[0]?.value); } catch (e) {}
        const route = ntfyRoute(env);
        push = {
            subs: { web: num(kinds.web?.n), ntfy: num(kinds.ntfy?.n),
                    today: num(kinds.web?.today) + num(kinds.ntfy?.today),
                    week: num(kinds.web?.week) + num(kinds.ntfy?.week) },
            services: Object.fromEntries(services.map((r) => [r.svc, num(r.n)])),
            channels: num(channels[0]?.n),
            live: num(channels[0]?.live),
            follows: num(follows[0]?.n),
            queue: Object.fromEntries(queue.map((r) => [side(r), { n: num(r.n), oldest: num(r.oldest) }])),
            ntfy: {
                route,
                // Quota de l'adresse qui publie (relais, ou serveur en
                // direct) ; offre payante (NTFY_TOKEN) : le sien, inconnu ici.
                quota: env.NTFY_TOKEN ? null : NTFY_FREE_DAILY,
                sentToday: pushByDate[dayKey(0)]?.ok_ntfy || 0,
                pausedUntil: pause?.via === route && pause.until > Date.now() ? pause.until : 0,
                pauseCode: num(pause?.code),
            },
            daily: pushSince ? pushDaily.filter((d) => d.date >= pushSince) : [],
            week: pushWeek,
            since: pushSince,
        };
    } catch (e) { console.warn('stats des notifications :', e.message); }

    const payload = {
        ...total, platforms, accounts: kinds.accounts, anonymous: kinds.anonymous, returning, loyalty,
        retention: { ...ret, cohorts: Object.values(cohorts).sort((a, b) => b.week.localeCompare(a.week)).slice(0, 5) },
        devices, activeDaily, activeSince, health, push,
        avgDays: total.known ? Math.round((totalDays / total.known) * 10) / 10 : 0,
        oldestFirst,
        versions: Object.entries(versions).map(([version, count]) => ({ version, count })).sort((a, b) => b.count - a.count),
        daily: Object.values(daily),
        generatedAt: new Date().toISOString()
    };
    // no-store : sinon « Actualiser » pourrait resservir les mêmes chiffres.
    return new Response(JSON.stringify(payload), { headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

function jsonResponse(obj) { return new Response(JSON.stringify(obj), { headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json' } }); }
function jsonError(msg, status, extra = {}) { return new Response(JSON.stringify({ error: msg, ...extra }), { status, headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json' } }); }

// ═══════════════════════════════════════════════════════════════════════════
//  Administration : réservé aux comptes de ADMIN_IDS (jeton Twitch vérifié).
// ═══════════════════════════════════════════════════════════════════════════
async function requireAdmin(request) {
    const who = await tokenIdentity(request);
    if (!who) return { denied: jsonError('Jeton Twitch manquant ou expiré', 401) };
    if (!ADMIN_IDS.includes(who.userId)) return { denied: jsonError('Réservé au propriétaire', 403) };
    return { who };
}

// GET /api/admin/me — suis-je administrateur ? (adminConfigured : faux sur
// une instance sans ADMIN_TWITCH_IDS, /stats le signale.)
async function handleAdminMe(request) {
    const who = await tokenIdentity(request);
    return jsonResponse({ login: who?.login ?? null, admin: Boolean(who && ADMIN_IDS.includes(who.userId)), adminConfigured: ADMIN_IDS.length > 0 });
}

async function listUsage(env) {
    const out = [];
    let cursor;
    do {
        const page = await store(env).list({ prefix: USAGE_PREFIX, limit: 1000, cursor });
        out.push(...page.keys);
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return out;
}

// GET /api/admin/usage — le détail : comptes (avec pseudo) et anonymes.
async function handleAdminUsage(request, env) {
    const { denied } = await requireAdmin(request);
    if (denied) return denied;
    const keys = await listUsage(env);
    const entries = keys.map(({ name, metadata: m = {} }) => ({
        key: name,
        kind: m.k === 'a' ? 'account' : 'anonymous',
        login: m.l || null,
        platforms: m.ps || m.p || 'ios',
        version: m.v || '?',
        first: m.first || null,
        last: m.last || null,
        days: m.days || 1,
    })).sort((a, b) => String(b.last).localeCompare(String(a.last)));
    return new Response(JSON.stringify({ entries }), { headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

// POST /api/admin/usage/delete — { target: 'key'|'anon'|'anon-web'|'once'|'all', key? }
async function handleAdminUsageDelete(request, env) {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
    const { denied } = await requireAdmin(request);
    if (denied) return denied;
    let body;
    try { body = await request.json(); } catch (e) { return jsonError('JSON invalide', 400); }
    const target = String(body.target || '');
    const keys = await listUsage(env);
    const match = {
        key: (k) => k.name === body.key,
        anon: (k) => k.metadata?.k !== 'a',
        'anon-web': (k) => k.metadata?.k !== 'a' && (k.metadata?.ps || k.metadata?.p) === 'web',
        once: (k) => (k.metadata?.days || 1) <= 1,
        all: () => true,
    }[target];
    if (!match) return jsonError('Cible inconnue', 400);
    if (target === 'key' && !String(body.key || '').startsWith(USAGE_PREFIX)) return jsonError('Clé invalide', 400);
    // Chaque suppression compte comme une écriture KV : plafonnée par appel.
    const doomed = keys.filter(match).slice(0, 500);
    for (const k of doomed) await store(env).delete(k.name);
    statsCache = null;
    return jsonResponse({ ok: true, deleted: doomed.length, remaining: keys.filter(match).length - doomed.length });
}

// POST /api/admin/sync/delete — { login } : efface la sauvegarde d'un compte.
async function handleAdminSyncDelete(request, env) {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
    const { denied } = await requireAdmin(request);
    if (denied) return denied;
    let body;
    try { body = await request.json(); } catch (e) { return jsonError('JSON invalide', 400); }
    const login = String(body.login || '').trim().toLowerCase();
    if (!LOGIN_RE.test(login)) return jsonError('Nom invalide', 400);
    const d = await twitchGQL('query($l: String!) { user(login: $l) { id } }', { l: login });
    const id = d?.data?.user?.id;
    if (!id) return jsonError('Compte introuvable', 404);
    const existed = Boolean(await store(env).get(`user_${id}`));
    if (existed) await store(env).delete(`user_${id}`);
    return jsonResponse({ ok: true, existed });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Annonces : un message du développeur affiché dans l'app pendant une durée
//  choisie. Une seule annonce à la fois, clé KV `announcement`, qui expire
//  d'elle-même (expirationTtl) : rien à nettoyer.
// ═══════════════════════════════════════════════════════════════════════════
const ANNOUNCEMENT_KEY = 'announcement';
let announcementCache = null;   // { value, until } — l'app la relit à chaque ouverture

async function readAnnouncement(env) {
    if (announcementCache && announcementCache.until > Date.now()) return announcementCache.value;
    let value = null;
    try { value = await store(env).get(ANNOUNCEMENT_KEY, 'json'); } catch (e) {}
    if (value && !(value.until > Date.now())) value = null;
    announcementCache = { value, until: Date.now() + 60 * 1000 };
    return value;
}

// Modèles d'annonce (/stats, et /announce du bot) : modifiables, gardés ici ;
// ces deux-là tant qu'aucune liste n'a été enregistrée.
const ANNOUNCE_TEMPLATES_KEY = 'announcement_templates';
const DEFAULT_ANNOUNCE_TEMPLATES = [
    { id: 'star', name: '⭐ Star the repo', title: 'Enjoying TwitchUnblock?', message: 'A ⭐ on GitHub helps more people find the project, and it only takes a second.', link: 'https://github.com/MXFia19/TwitchUnblock' },
    { id: 'discord', name: '💬 Join the Discord', title: 'Join the Discord', message: 'News, help, test builds and polls: come and say hi!', link: 'https://discord.gg/cEsMRdxsVq' },
];

async function readAnnounceTemplates(env) {
    try {
        const list = await store(env).get(ANNOUNCE_TEMPLATES_KEY, 'json');
        if (Array.isArray(list)) return list;
    } catch (e) { /* illisible : ceux par défaut */ }
    return DEFAULT_ANNOUNCE_TEMPLATES;
}

/** Liste envoyée par /stats : 20 modèles au plus, nettoyés ; un modèle sans
 *  nom, vide ou au lien non https est écarté. */
function cleanAnnounceTemplates(list) {
    const out = [];
    for (const [n, x] of list.slice(0, 20).entries()) {
        const name = cleanText(x?.name, 40);
        const title = cleanText(x?.title, 80);
        const message = cleanText(x?.message, 500);
        const link = cleanText(x?.link, 300);
        if (!name || (!title && !message) || (link && !/^https:\/\/[^\s]+$/i.test(link))) continue;
        const id = /^[a-z0-9_-]{1,24}$/i.test(String(x?.id || '')) ? String(x.id) : `${Date.now().toString(36)}${n}`;
        out.push({ id, name, title, message, link });
    }
    return out;
}

// GET /api/announcement — { announcement: null | { id, title, message, link, until } }
async function handleAnnouncementGet(env) {
    if (!env.DB) return jsonResponse({ announcement: null });
    return new Response(JSON.stringify({ announcement: await readAnnouncement(env) }), {
        headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
}

// GET : annonce en cours. POST { title, message, link?, hours } : publier.
// POST { edit: true, …, keepUntil?, renotify? } : modifier l'annonce en cours
// (même identifiant : qui l'a fermée ne la revoit pas, sauf `renotify`).
// POST { clear: true } : retirer.
async function handleAdminAnnouncement(request, env) {
    const { denied } = await requireAdmin(request);
    if (denied) return denied;
    if (request.method === 'GET') {
        const announcement = await readAnnouncement(env);
        return jsonResponse({
            announcement, reactions: announcement ? await countReactions(env, announcement.id) : null,
            templates: await readAnnounceTemplates(env),
        });
    }
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
    let body;
    try { body = await request.json(); } catch (e) { return jsonError('JSON invalide', 400); }
    // Modèles modifiés dans /stats : la liste entière, remplacée.
    if (Array.isArray(body.templates)) {
        const templates = cleanAnnounceTemplates(body.templates);
        await store(env).put(ANNOUNCE_TEMPLATES_KEY, JSON.stringify(templates));
        return jsonResponse({ ok: true, templates });
    }
    announcementCache = null;
    if (body.clear === true) {
        await store(env).delete(ANNOUNCEMENT_KEY);
        return jsonResponse({ ok: true, announcement: null });
    }
    const title = String(body.title || '').trim().slice(0, 80);
    const message = String(body.message || '').trim().slice(0, 500);
    if (!title && !message) return jsonError('Titre ou message requis', 400);
    let link = String(body.link || '').trim().slice(0, 300);
    if (link && !/^https:\/\/[^\s]+$/i.test(link)) return jsonError('Lien : https:// uniquement', 400);
    let prev = null;
    if (body.edit === true) {
        try { prev = await store(env).get(ANNOUNCEMENT_KEY, 'json'); } catch (e) {}
        if (!prev || !(prev.until > Date.now())) return jsonError('Aucune annonce en cours à modifier', 404);
    }
    let ttl;
    if (prev && body.keepUntil === true) {
        ttl = Math.max(60, Math.round((prev.until - Date.now()) / 1000));
    } else {
        const hours = Math.min(24 * 30, Math.max(1 / 60, Number(body.hours) || 24));
        ttl = Math.round(hours * 3600);
    }
    const announcement = {
        id: prev && body.renotify !== true ? prev.id : Date.now().toString(36),
        title, message, link: link || null,
        until: prev && body.keepUntil === true ? prev.until : Date.now() + ttl * 1000,
        createdAt: prev ? prev.createdAt : Date.now(),
        ...(prev ? { editedAt: Date.now() } : {}),
    };
    // expirationTtl : 60 s minimum chez Cloudflare.
    await store(env).put(ANNOUNCEMENT_KEY, JSON.stringify(announcement), { expirationTtl: Math.max(60, ttl) });
    return jsonResponse({ ok: true, announcement });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Retours (bug, idée, autre) envoyés depuis le site et l'app, et la
//  discussion qui suit avec la personne.
//
//  POST /api/feedback        { kind, message, contact?, platform, version, info?, photos? }
//                            → { ok, id, token }
//  POST /api/feedback/thread { items: [{ id, token }] } → état et messages
//  POST /api/feedback/reply  { id, token, message, photos? }
//  GET  /api/feedback/photo?id=…&n=…&token=…   (ou jeton Twitch admin)
//
//  Pas de compte : à l'envoi, le Worker rend un jeton secret que l'appareil
//  garde ; lui seul permet de relire la discussion et d'y répondre. Seule son
//  empreinte (SHA-256) est stockée.
//
//  Rangés dans D1 : la clé `fb_<date>_<hasard>` porte le résumé dans ses
//  métadonnées (la liste admin se lit en une requête) et la discussion dans sa
//  valeur ; chaque photo a sa propre clé `fbimg_<clé>_<n>` (image en base64,
//  déjà réduite par l'appareil). Gardés 180 jours après le dernier message.
//  Si le secret FEEDBACK_WEBHOOK (adresse d'un webhook Discord) est posé sur
//  le Worker, chaque retour et chaque réponse de la personne y sont publiés,
//  photos jointes. Dans un salon « Forum », chaque retour a son post, où
//  arrivent aussi ses réponses ; avec le bot du relais (FEEDBACK_BOT_SECRET,
//  docker/discord-bot.mjs), on y répond et on y change l'état directement
//  (/api/feedback/discord). Ni adresse IP ni compte Twitch stockés : ce que la
//  personne écrit, et les infos techniques affichées avant l'envoi.
// ═══════════════════════════════════════════════════════════════════════════
const FEEDBACK_PREFIX = 'fb_';
const FEEDBACK_PHOTO_PREFIX = 'fbimg_';
const FEEDBACK_KINDS = ['bug', 'idea', 'other'];
// nouveau → vu → accepté → en cours → fait, ou refusé.
const FEEDBACK_STATUSES = ['new', 'seen', 'accepted', 'progress', 'done', 'refused'];
const FEEDBACK_TTL = 180 * 86400;
const FEEDBACK_MAX_PHOTOS = 3;
const FEEDBACK_MAX_PHOTO_B64 = 700000;   // ~500 Ko d'image
const FEEDBACK_MAX_MESSAGES = 100;
const FEEDBACK_KEY_RE = /^fb_[a-z0-9]{6,12}_[0-9a-f]{8}$/;
const FEEDBACK_TOKEN_RE = /^[0-9a-f]{48}$/;
// Compteurs par adresse (mémoire de l'instance, jamais stockés).
const feedbackHits = new Map();
const replyHits = new Map();
const threadHits = new Map();
// Résultat du dernier envoi vers Discord (réussi ou non, et pourquoi — jamais
// l'adresse du webhook), affiché dans /stats. Clé hors du préfixe des retours.
const FEEDBACK_HOOK_KEY = 'fbmeta_webhook';
// Post Discord (salon forum) → retour : `fbdc_<post>` vaut la clé du retour.
const FEEDBACK_DISCORD_PREFIX = 'fbdc_';
// Dernier signe de vie du bot Discord du relais, affiché dans /stats.
const FEEDBACK_BOT_KEY = 'fbmeta_bot';
// États tels qu'écrits sur Discord (en anglais : la communauté l'est surtout) :
// ce sont aussi les étiquettes du forum que le bot pose (et crée ou renomme).
const FEEDBACK_STATUS_LABELS = { new: 'New', seen: 'Seen', accepted: 'Accepted', progress: 'In progress', done: 'Done', refused: 'Declined' };

/** Envoie vers Discord si le secret est posé, et note le résultat. En salon
 *  forum, le post du retour est gardé avec lui (`dt`), et l'inverse
 *  (`fbdc_<post>`) pour le bot. `opts` : { key, inReplyTo, test }. */
function notifyDiscord(env, ctx, entry, photos = [], opts = {}) {
    const hook = env.FEEDBACK_WEBHOOK ? String(env.FEEDBACK_WEBHOOK) : '';
    const job = (async () => {
        const r = hook
            ? await postFeedbackToDiscord(hook, entry, photos, { ...opts, bot: Boolean(env.FEEDBACK_BOT_SECRET) })
            : { ok: false, status: 0, detail: 'missing' };
        if (r.thread && opts.key) await linkDiscordThread(env, opts.key, r.thread, r.thread !== entry.dt);
        const { thread, ...state } = r;
        await store(env).put(FEEDBACK_HOOK_KEY, '', { metadata: { ...state, forum: Boolean(thread), at: Date.now() } });
        return r;
    })().catch(() => ({ ok: false, status: 0, detail: 'error' }));
    if (ctx?.waitUntil) ctx.waitUntil(job);
    return job;
}

/** Retour ↔ post Discord. `fresh` : nouveau post, noté dans le retour ;
 *  sinon le lien est seulement prolongé (gardé autant que le retour).
 *  `ttl` : ce qui reste au retour (reprise des anciens : on ne le prolonge
 *  pas). */
async function linkDiscordThread(env, key, thread, fresh, ttl = FEEDBACK_TTL) {
    if (fresh) {
        const { value, metadata } = await store(env).getWithMetadata(key);
        if (!metadata) return;
        await store(env).put(key, value, { metadata: { ...metadata, dt: thread }, expirationTtl: ttl });
    }
    await store(env).put(`${FEEDBACK_DISCORD_PREFIX}${thread}`, key, { expirationTtl: ttl });
}

/** Clés d'un préfixe, avec leurs métadonnées et leur expiration (5000 au plus). */
async function listStoreKeys(env, prefix) {
    const out = [];
    let cursor;
    do {
        const page = await store(env).list({ prefix, limit: 1000, cursor });
        out.push(...page.keys);
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor && out.length < 5000);
    return out;
}

// ── Reprise des anciens retours ────────────────────────────────────────────
// Retours d'avant le pont (ou dont l'envoi a raté) : un post chacun, du plus
// ancien au plus récent — le message d'origine avec ses photos, puis la
// suite de la discussion en un message. Quatre par appel : un Worker gratuit
// a 50 sous-requêtes et 50 requêtes D1. Le bot du relais rappelle jusqu'au
// bout, en respectant le délai que Discord demande (429). Un retour raté deux
// fois est laissé de côté ; un retour de moins de 2 min est peut-être en
// train de partir : il attend le passage suivant.
const BACKFILL_BATCH = 4;
async function backfillDiscord(env) {
    const hook = String(env.FEEDBACK_WEBHOOK || '').trim();
    const now = Date.now();
    const todo = (await listStoreKeys(env, FEEDBACK_PREFIX))
        .filter(({ metadata: m }) => m && !m.dt && (m.dtf || 0) < 2 && now - (m.u || m.at || 0) > 120000)
        .sort((a, b) => (a.metadata.at || 0) - (b.metadata.at || 0));
    let done = 0;
    for (const { name, expiration } of todo.slice(0, BACKFILL_BATCH)) {
        const ttl = expiration ? Math.max(60, Math.round(expiration - now / 1000)) : FEEDBACK_TTL;
        const r = await backfillOne(env, hook, name, ttl);
        if (r.notForum) return { error: 'The webhook isn’t in a Forum channel', done, remaining: todo.length - done };
        if (r.retryAfter) return { done, remaining: todo.length - done, retryAfter: r.retryAfter };
        done++;
    }
    return { done, remaining: todo.length - done };
}

async function backfillOne(env, hook, key, ttl) {
    const { value, metadata: m } = await store(env).getWithMetadata(key);
    if (!m || m.dt) return { ok: true };
    const thread = feedbackThread(value, m);
    const first = thread[0] || { f: 'u', m: m.m, at: m.at };
    const photos = [];
    for (const n of (first.ph || []).slice(0, FEEDBACK_MAX_PHOTOS)) {
        const p = await store(env).getWithMetadata(`${FEEDBACK_PHOTO_PREFIX}${key}_${n}`);
        if (p.value) photos.push({ b64: p.value, type: p.metadata?.t || 'image/jpeg' });
    }
    const r = await postFeedbackToDiscord(hook, { ...m, m: first.m || m.m, u: first.at || m.at, dt: null }, photos,
        { bot: Boolean(env.FEEDBACK_BOT_SECRET), requireThread: true });
    if (r.notForum) return r;
    if (r.status === 429) return { retryAfter: r.retryAfter || 5 };
    if (!r.ok || !r.thread) {
        await store(env).put(key, value, { metadata: { ...m, dtf: (m.dtf || 0) + 1 }, expirationTtl: ttl });
        return { ok: false };
    }
    await linkDiscordThread(env, key, r.thread, true, ttl);
    const rest = thread.slice(1);
    if (rest.length) {
        // Copiable sur mobile (texte du message) quand il y tient, sinon encadré.
        const h = historyEmbed(rest);
        const plain = `**${h.title}**\n${h.description}`;
        await discordHook(hook, { username: 'TwitchUnblock', allowed_mentions: { parse: [] },
            ...(plain.length <= 2000 ? { content: plain } : { embeds: [h] }) }, [], { threadId: r.thread });
    }
    return { ok: true };
}

/** La suite d'une discussion d'avant le pont, en un message : qui, quand
 *  (heure affichée par Discord dans le fuseau de chacun), quoi. Trop longue,
 *  on garde la fin, la plus utile. */
function historyEmbed(messages) {
    const lines = messages.map((x) => {
        const when = x.at ? ` · <t:${Math.floor(x.at / 1000)}:f>` : '';
        if (x.s) return `📌 Status: **${FEEDBACK_STATUS_LABELS[x.s] || x.s}**${when}`;
        const who = x.f === 'a' ? '🛠️ **You**' : '👤 **User**';
        const pics = x.ph?.length ? ` · 📷 ${x.ph.length}` : '';
        return `${who}${when}${pics}\n${String(x.m || '').slice(0, 1500)}`;
    });
    let text = lines.join('\n\n');
    if (text.length > 4000) text = `… (start in /stats)\n${text.slice(-3950)}`;
    return { title: '🗂️ Earlier conversation (before the Discord bridge)', description: text, color: 0x6b7280 };
}

/** Plus de `max` requêtes dans l'heure pour cette clé (adresse, préfixe
 *  IPv6, compte Discord) ? Au-delà de 5 000 clés suivies, on oublie celles
 *  dont l'heure est passée, puis les moins actives (une rafale d'adresses
 *  neuves) : `clear()` remettait tout le monde à zéro — 5 000 adresses
 *  suffisaient à effacer sa propre trace. */
function overLimit(map, key, max) {
    const now = Date.now();
    const hit = map.get(key);
    if (hit && hit.until >= now) return ++hit.n > max;
    map.delete(key);
    if (map.size >= 5000) {
        for (const [k, v] of map) if (v.until < now) map.delete(k);
        if (map.size >= 4000) {
            [...map].sort((a, b) => a[1].n - b[1].n).slice(0, map.size - 4000).forEach(([k]) => map.delete(k));
        }
    }
    map.set(key, { n: 1, until: now + 60 * 60 * 1000 });
    return false;
}

/** Clé d'une personne pour les limites de débit : son adresse IPv4, ou le
 *  préfixe /64 de son adresse IPv6 — un abonné en reçoit souvent un entier,
 *  et en changeant d'adresse à chaque requête il échappait à toutes les
 *  limites. */
function clientKey(request) {
    const ip = request.headers.get('CF-Connecting-IP') || '';
    if (!ip.includes(':')) return ip;
    const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(ip);   // ::ffff:1.2.3.4
    if (v4) return v4[1];
    const [head, tail] = ip.toLowerCase().split('::');
    const left = head ? head.split(':') : [];
    const right = tail ? tail.split(':') : [];
    const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
    return groups.slice(0, 4).map((g) => g.padStart(4, '0')).join(':') + '::/64';
}

// Photos des retours : chaque jour, une part par personne et un plafond pour
// tout le Worker, gardés en D1 (les limites par adresse ne tiennent qu'en
// mémoire d'une instance), et plus aucune quand la base approche de sa
// taille maximale (500 Mo en gratuit : pleine, plus rien ne s'y écrit —
// sauvegardes, comptage, notifications). Sans la part par personne, une
// seule adresse vidait le plafond du jour en une seconde, et les captures
// des autres étaient ensuite jetées sans un mot. Le message passe toujours,
// sans ses photos, et la réponse le dit (photosDropped). Le plafond reste
// modeste : un /48 IPv6 compte 65 536 « personnes », et c'est lui qui
// protège la base. Les réponses de l'équipe n'y sont pas soumises.
const FEEDBACK_PHOTOS_PER_DAY = 60 * 1024 * 1024;     // caractères base64 (~45 Mo d'images)
const FEEDBACK_PHOTOS_PER_PERSON = 6 * 1024 * 1024;   // une adresse (/64 en IPv6) ou un compte Discord
const FEEDBACK_PHOTOS_DB_MAX = 400 * 1024 * 1024;     // octets de base

/** Photos de la personne `who` (clientKey, ou « du:<compte Discord> »), ou []
 *  quand sa part du jour, le plafond du jour ou la taille de la base
 *  l'interdisent ; celles qui passent sont comptées. Sa part est comptée
 *  dans l'une des 65 536 cases tirées de l'empreinte du jour et de `who` :
 *  la base ne garde aucune adresse, ni de quoi suivre quelqu'un d'un jour
 *  à l'autre. */
async function photoAllowance(env, photos, who) {
    if (!photos.length) return photos;
    const size = photos.reduce((n, p) => n + p.b64.length, 0);
    const day = new Date().toISOString().slice(0, 10);
    const mine = `fbp_${(await sha256hex(`photos|${day}|${who}`)).slice(0, 4)}`;
    // Ajouté et relu d'un coup (RETURNING) : lu avant d'écrire, le compteur
    // laissait passer ensemble des envois simultanés.
    const add = (metric, n) => env.DB.prepare(`INSERT INTO stats_day (day, metric, n) VALUES (?1, ?2, ?3)
        ON CONFLICT(day, metric) DO UPDATE SET n = n + excluded.n RETURNING n`).bind(day, metric, n);
    let total, person, dbSize;
    try {
        await ensureSchema(env);
        const [all, own] = await env.DB.batch([add('fb_photo_b64', size), add(mine, size)]);
        total = Number(all?.results?.[0]?.n) || 0;
        person = Number(own?.results?.[0]?.n) || 0;
        dbSize = Number(own?.meta?.size_after) || 0;   // taille de la base (D1)
    } catch (e) {
        console.warn('retours : plafond des photos illisible,', e.message);
        return photos;
    }
    const why = person > FEEDBACK_PHOTOS_PER_PERSON ? 'part de la personne'
        : total > FEEDBACK_PHOTOS_PER_DAY ? 'plafond du jour'
        : dbSize > FEEDBACK_PHOTOS_DB_MAX ? 'base pleine' : null;
    if (!why) return photos;
    // Rien n'est rangé : rien n'est compté.
    await env.DB.batch([add('fb_photo_b64', -size), add(mine, -size)]).catch(() => {});
    console.warn(`retours : photos refusées (${why} ; ${Math.round((total - size) / 1e6)} Mo aujourd'hui, base de ${Math.round(dbSize / 1e6)} Mo)`);
    return [];
}

/** Texte libre : sans caractères de contrôle (sauf retours à la ligne), borné. */
const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);

async function sha256hex(text) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Photos reçues (base64, préfixe `data:` accepté). Le type vient des premiers
 * octets, pas de ce qu'annonce l'appareil : seules de vraies images JPEG, PNG
 * ou WebP passent, et elles seront resservies avec ce type-là.
 */
function cleanPhotos(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const raw of list.slice(0, FEEDBACK_MAX_PHOTOS)) {
        const s = String(raw || '').replace(/^data:image\/[a-z]+;base64,/, '');
        if (!s || s.length > FEEDBACK_MAX_PHOTO_B64 || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) continue;
        // Longueur invalide ou base64 illisible : atob() levait plus tard, à
        // l'envoi sur Discord, et la reprise restait bloquée sur ce retour.
        try { atob(s); } catch { continue; }
        const type = s.startsWith('/9j/') ? 'image/jpeg'
            : s.startsWith('iVBORw0KGgo') ? 'image/png'
            : s.startsWith('UklGR') ? 'image/webp' : null;
        if (type) out.push({ type, b64: s });
    }
    return out;
}

function b64Bytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

/** Range les photos d'un message ; rend leurs numéros. */
async function saveFeedbackPhotos(env, key, photos, first) {
    const ids = [];
    for (let i = 0; i < photos.length; i++) {
        const n = first + i;
        await store(env).put(`${FEEDBACK_PHOTO_PREFIX}${key}_${n}`, photos[i].b64,
            { metadata: { t: photos[i].type }, expirationTtl: FEEDBACK_TTL });
        ids.push(n);
    }
    return ids;
}

/** Discussion stockée ; un retour d'avant les discussions n'a que son message. */
function feedbackThread(value, meta) {
    try {
        const t = JSON.parse(value || '');
        if (Array.isArray(t) && t.length) return t;
    } catch (e) { /* ancien format */ }
    return [{ f: 'u', m: meta?.m || '', at: meta?.at || 0 }];
}

/** Retour d'un appareil : clé et jeton valides, sinon null. */
async function ownedFeedback(env, id, token) {
    if (!FEEDBACK_KEY_RE.test(String(id || '')) || !FEEDBACK_TOKEN_RE.test(String(token || ''))) return null;
    const { value, metadata } = await store(env).getWithMetadata(id);
    if (!metadata?.h || metadata.h !== await sha256hex(token)) return null;
    return { meta: metadata, thread: feedbackThread(value, metadata) };
}

/** Ce que l'appareil voit d'un retour : état et messages, sans les infos techniques. */
function publicFeedback(id, meta, thread) {
    return { id, kind: meta.k || 'other', status: meta.s || 'new', updatedAt: meta.u || meta.at || 0, lastFrom: meta.r || 'u', thread };
}

async function handleFeedback(request, env, ctx) {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
    if (!env.DB) return jsonError("Base D1 'DB' non liée au Worker.", 500);
    if (BOT_UA.test(request.headers.get('User-Agent') || '')) return jsonResponse({ ok: true, ignored: true });
    // 5 retours par heure et par adresse : de quoi tout dire, pas de quoi inonder.
    if (overLimit(feedbackHits, clientKey(request), 5)) {
        return jsonError('Trop de messages, réessaie dans une heure', 429);
    }
    // Compté aussi en base : le compteur en mémoire ne vaut que pour une
    // instance du Worker. 10 retours par jour et par personne (adresse hachée).
    const fbDay = new Date().toISOString().slice(0, 10);
    const fbWho = `fbn_${(await sha256hex(`fb|${fbDay}|${clientKey(request)}`)).slice(0, 8)}`;
    if (!(await takeNtfyLimits(env, [[fbWho, 10]]).catch(() => true))) {
        return jsonError('Trop de messages aujourd\x27hui, réessaie demain', 429);
    }

    let body;
    try { body = await request.json(); } catch (e) { return jsonError('JSON invalide', 400); }
    const message = cleanText(body.message, 2000);
    if (message.length < 5) return jsonError('Message trop court', 400);
    let info = body.info;
    if (info && typeof info === 'object') { try { info = JSON.stringify(info); } catch (e) { info = ''; } }
    const asked = cleanPhotos(body.photos);
    const photos = await photoAllowance(env, asked, clientKey(request));

    const now = Date.now();
    const key = `${FEEDBACK_PREFIX}${now.toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
    const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '').slice(0, 48);
    const ph = await saveFeedbackPhotos(env, key, photos, 0);
    const entry = {
        k: FEEDBACK_KINDS.includes(body.kind) ? body.kind : 'other',
        m: message,
        c: cleanText(body.contact, 100) || null,
        p: PLATFORMS.includes(body.platform) ? body.platform : 'web',
        v: cleanText(body.version, 32) || '?',
        i: cleanText(info, 600) || null,
        at: now,
        s: 'new', u: now, r: 'u', n: 1, ph: ph.length,
        h: await sha256hex(token),
    };
    const thread = [{ f: 'u', m: message, at: now, ...(ph.length ? { ph } : {}) }];
    await store(env).put(key, JSON.stringify(thread), { metadata: entry, expirationTtl: FEEDBACK_TTL });
    const hook = notifyDiscord(env, ctx, entry, photos, { key });
    if (!ctx?.waitUntil) await hook;
    // photosDropped : captures non gardées (part ou plafond du jour), que le
    // site signale ; les anciens clients l'ignorent.
    const dropped = asked.length - photos.length;
    return jsonResponse({ ok: true, id: key, token, ...(dropped ? { photosDropped: dropped } : {}) });
}

// POST /api/feedback/thread — les retours de l'appareil (30 au plus).
async function handleFeedbackThread(request, env) {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
    if (!env.DB) return jsonError("Base D1 'DB' non liée au Worker.", 500);
    // Une discussion ouverte est relue toutes les 20 s (site et app) : 600
    // par heure et par adresse laissent de la marge à plusieurs appareils.
    if (overLimit(threadHits, clientKey(request), 600)) return jsonError('Trop de requêtes', 429);
    let body;
    try { body = await request.json(); } catch (e) { return jsonError('JSON invalide', 400); }
    const list = Array.isArray(body.items) ? body.items.slice(0, 30) : [];
    const items = [];
    for (const it of list) {
        const id = String(it?.id || '');
        const found = await ownedFeedback(env, id, it?.token);
        items.push(found ? publicFeedback(id, found.meta, found.thread) : { id, gone: true });
    }
    return new Response(JSON.stringify({ items }), { headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

// POST /api/feedback/reply — la personne répond dans sa discussion.
async function handleFeedbackReply(request, env, ctx) {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
    if (!env.DB) return jsonError("Base D1 'DB' non liée au Worker.", 500);
    if (BOT_UA.test(request.headers.get('User-Agent') || '')) return jsonResponse({ ok: true, ignored: true });
    if (overLimit(replyHits, clientKey(request), 20)) {
        return jsonError('Trop de messages, réessaie dans une heure', 429);
    }
    let body;
    try { body = await request.json(); } catch (e) { return jsonError('JSON invalide', 400); }
    const id = String(body.id || '');
    const found = await ownedFeedback(env, id, body.token);
    if (!found) return jsonError('Retour introuvable', 404);
    const message = cleanText(body.message, 2000);
    const asked = cleanPhotos(body.photos);
    if (!message && !asked.length) return jsonError('Message vide', 400);
    const { meta, thread } = found;
    if (meta.bl) return jsonError('This conversation was closed by the developer', 403);
    if (thread.length >= FEEDBACK_MAX_MESSAGES) return jsonError('Discussion trop longue', 409);
    const photos = await photoAllowance(env, asked, clientKey(request));
    const dropped = asked.length - photos.length;
    if (!message && !photos.length) return jsonError('Photos en pause pour aujourd’hui, réessaie demain', 429, { photosDropped: dropped });

    const now = Date.now();
    const ph = await saveFeedbackPhotos(env, id, photos, meta.ph || 0);
    thread.push({ f: 'u', m: message, at: now, ...(ph.length ? { ph } : {}) });
    const next = { ...meta, u: now, r: 'u', n: (meta.n || 1) + 1, ph: (meta.ph || 0) + ph.length };
    await store(env).put(id, JSON.stringify(thread), { metadata: next, expirationTtl: FEEDBACK_TTL });
    const hook = notifyDiscord(env, ctx, { ...next, m: message }, photos, { key: id, inReplyTo: meta.m });
    if (!ctx?.waitUntil) await hook;
    return jsonResponse({ ok: true, item: publicFeedback(id, next, thread), ...(dropped ? { photosDropped: dropped } : {}) });
}

// GET /api/feedback/photo?id=…&n=…&token=… — une photo d'une discussion, pour
// la personne (jeton du retour) ou l'admin (jeton Twitch).
async function handleFeedbackPhoto(url, request, env) {
    if (!env.DB) return jsonError("Base D1 'DB' non liée au Worker.", 500);
    const id = String(url.searchParams.get('id') || '');
    const n = Number(url.searchParams.get('n'));
    if (!FEEDBACK_KEY_RE.test(id) || !Number.isInteger(n) || n < 0 || n > 999) return jsonError('Paramètres invalides', 400);
    const token = url.searchParams.get('token');
    let allowed = Boolean(token && await ownedFeedback(env, id, token));
    if (!allowed) allowed = !(await requireAdmin(request)).denied;
    if (!allowed) return jsonError('Accès refusé', 403);
    const { value, metadata } = await store(env).getWithMetadata(`${FEEDBACK_PHOTO_PREFIX}${id}_${n}`);
    if (!value) return jsonError('Photo introuvable', 404);
    return new Response(b64Bytes(value), {
        headers: {
            ...RESPONSE_HEADERS,
            'Content-Type': ['image/jpeg', 'image/png', 'image/webp'].includes(metadata?.t) ? metadata.t : 'image/jpeg',
            'Cache-Control': 'private, max-age=86400',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'",
        },
    });
}

/** Infos techniques (JSON envoyé par le client) en lignes « clé : valeur ». */
function readableInfo(text) {
    try {
        const o = JSON.parse(text);
        if (o && typeof o === 'object') {
            const lines = Object.entries(o).filter(([, v]) => v !== null && v !== '' && v !== false).map(([k, v]) => `${k} : ${v}`);
            if (lines.length) return lines.join('\n');
        }
    } catch (e) { /* texte libre : tel quel */ }
    return text;
}

/**
 * Publie un retour — ou, avec `inReplyTo`, la réponse de la personne — sur le
 * webhook Discord (sans mention possible), photos jointes. En salon forum,
 * dans le post du retour (`e.dt`), créé au premier envoi.
 * Rend { ok, status, detail, thread } : un refus de Discord n'est plus silencieux.
 */
async function postFeedbackToDiscord(webhook, e, photos = [], { inReplyTo = null, test = false, bot = false, requireThread = false } = {}) {
    const KINDS = { bug: '🐞 Bug', idea: '💡 Idea', other: '💬 Other' };
    const COLORS = { bug: 0xeb0400, idea: 0x9147ff, other: 0x6b7280 };
    const kind = KINDS[e.k] || KINDS.other;
    const PLACES = { ios: 'iOS app', discord: 'Discord', web: 'Website' };
    const fields = [{ name: 'Platform', value: `${PLACES[e.p] || PLACES.web} · ${e.v}`, inline: true }];
    if (e.c) fields.push({ name: 'Contact', value: e.c, inline: true });
    if (inReplyTo) fields.push({ name: 'In reply to', value: inReplyTo.slice(0, 300) });
    else if (e.i) fields.push({ name: 'Info', value: readableInfo(e.i).slice(0, 1000) });
    const text = String(e.m || '').trim();
    const payload = {
        username: 'TwitchUnblock',
        allowed_mentions: { parse: [] },
        // Le texte dans le message même : sur mobile, « Copier le texte » de
        // Discord ne prend que lui, jamais celui d'un encadré. Plus long que
        // ce qu'un message tient : en entier dans l'encadré aussi.
        ...(text ? { content: discordText(text) } : {}),
        embeds: [{
            title: inReplyTo ? `↩️ Reply · ${kind}` : kind,
            ...(!text ? { description: '📷' } : text.length > 2000 ? { description: text.slice(0, 4000) } : {}),
            color: COLORS[e.k] ?? COLORS.other,
            fields,
            // Avec le bot du relais, on répond dans le post même.
            footer: { text: bot ? 'Reply in this post (start with // for a private note) or from /stats' : 'Reply from /stats' },
            timestamp: new Date(e.u || e.at).toISOString(),
        }],
    };
    // Nom du post (salon forum) : genre et début du premier message.
    const first = String(inReplyTo ?? e.m ?? '').replace(/\s+/g, ' ').trim();
    const threadName = test ? 'Webhook test' : `${kind} · ${first || '📷'}`.slice(0, 100);
    return discordHook(webhook, payload, photoFiles(photos), { threadId: e.dt, threadName, requireThread });
}

/** Début d'un texte tenant dans un message Discord (2 000 caractères), sans
 *  couper un emoji en deux ; « … » quand la suite manque. */
function discordText(text, max = 2000) {
    if (text.length <= max) return text;
    let cut = text.slice(0, max - 1);
    if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
    return `${cut}…`;
}

/** Photos d'un message en fichiers joints pour Discord. */
function photoFiles(photos) {
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
    // Une photo illisible (enregistrée avant le contrôle de sa longueur) est
    // laissée de côté : elle bloquait l'envoi, et la reprise, pour de bon.
    const out = [];
    photos.forEach((p, i) => {
        try { out.push({ bytes: b64Bytes(p.b64), type: p.type, name: `photo${i + 1}.${ext[p.type] || 'jpg'}` }); } catch {}
    });
    return out;
}

/**
 * Envoi sur un webhook Discord, et `thread` : le post où il est arrivé, en
 * salon forum. `threadId` : dans ce post ; `threadName` : nouveau post si le
 * salon est un forum. Le type de salon se déduit de la réponse de Discord,
 * sans réglage : 220001 (forum : il faut un post), 220003 (salon texte :
 * pas de post), 10003 (post supprimé : un nouveau).
 */
async function discordHook(webhook, payload, files = [], { threadId = null, threadName = null, requireThread = false } = {}) {
    const hook = String(webhook).trim();
    if (!/^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\//.test(hook)) return { ok: false, status: 0, detail: 'invalid' };
    const send = async (extra, thread) => {
        const url = new URL(hook);
        url.searchParams.set('wait', 'true');
        if (thread) url.searchParams.set('thread_id', thread);
        const body = JSON.stringify({ ...payload, ...extra });
        let init;
        if (files.length) {
            const form = new FormData();
            form.append('payload_json', body);
            files.forEach((f, i) => form.append(`files[${i}]`, new Blob([f.bytes], { type: f.type }), f.name));
            init = { method: 'POST', body: form };
        } else {
            init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body };
        }
        const res = await fetch(url, init);
        const text = await res.text().catch(() => '');
        let data = null;
        try { data = JSON.parse(text); } catch (err) { /* page d'erreur */ }
        return { res, data, text, inThread: Boolean(thread || extra.thread_name) };
    };
    try {
        let r = null;
        if (threadId) {
            r = await send({}, threadId);
            if (!r.res.ok && threadName && r.data?.code === 10003) r = null;
        }
        if (!r) {
            r = await send(threadName ? { thread_name: threadName } : {});
            if (r.res.status === 400 && r.data?.code === 220003) {
                // Salon texte : la reprise des anciens retours n'y écrit rien.
                if (requireThread) return { ok: false, status: 400, detail: 'not forum', notForum: true };
                r = await send({});
            } else if (r.res.status === 400 && r.data?.code === 220001) r = await send({ thread_name: (threadName || 'TwitchUnblock').slice(0, 100) });
        }
        if (r.res.ok) return { ok: true, status: r.res.status, thread: r.inThread ? (r.data?.channel_id || null) : null };
        // Réponse de Discord (« Unknown Webhook », limite…), sans balises HTML.
        const detail = r.text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
        return { ok: false, status: r.res.status, detail, retryAfter: Number(r.data?.retry_after) || 0 };
    } catch (err) {
        // Discord injoignable : le retour reste dans D1.
        return { ok: false, status: 0, detail: String(err?.message || err).slice(0, 200) };
    }
}

/** Réponse ou état donné depuis /stats ou l'app : recopié dans le post
 *  Discord du retour, pour que la discussion y soit entière ; le bot du
 *  relais y relit l'état pour son étiquette. Ce que fait le bot n'y est pas
 *  recopié : c'est déjà sur Discord. */
/** Posts Discord de retours supprimés dans /stats : un webhook ne peut pas
 *  supprimer un post, alors ils vont dans la liste `trash` de la mémoire du
 *  bot du relais, qui les supprime. Un mot dans le premier le prévient tout
 *  de suite ; sinon, il vide la liste toutes les 10 min. */
async function trashDiscordPosts(env, ctx, threads) {
    const ids = threads.filter((t) => /^\d{5,25}$/.test(t));
    if (!ids.length || !env.FEEDBACK_BOT_SECRET) return;
    const k = `${BOT_STORE_PREFIX}trash`;
    let list = [];
    try { list = JSON.parse(await store(env).get(k) || '[]'); } catch (e) { /* illisible : repart vide */ }
    list = [...new Set([...(Array.isArray(list) ? list : []), ...ids])].slice(-500);
    await store(env).put(k, JSON.stringify(list), { expirationTtl: 7 * 86400 });
    echoTeamToDiscord(env, ctx, { dt: ids[0] }, { note: '🗑️ Report deleted from /stats: this post is being deleted.' });
}

function echoTeamToDiscord(env, ctx, meta, { message = '', photos = [], status = null, note = null }) {
    if (!env.FEEDBACK_WEBHOOK || !meta?.dt) return Promise.resolve();
    const content = note
        || (status
            ? `📌 Status: **${FEEDBACK_STATUS_LABELS[status] || status}** (from /stats or the app)`
            : `💬 **Your reply** (from /stats or the app)${message ? `\n${message}` : ''}`);
    const payload = { username: 'TwitchUnblock', allowed_mentions: { parse: [] }, content: content.slice(0, 2000) };
    const job = discordHook(env.FEEDBACK_WEBHOOK, payload, photoFiles(photos), { threadId: meta.dt }).catch(() => {});
    if (ctx?.waitUntil) ctx.waitUntil(job);
    return job;
}

/**
 * Réponse (`message`, `photos`) ou nouvel état (`status`) du développeur,
 * ajouté à la discussion — depuis /stats, l'app ou Discord. Rend
 * { metadata, thread } à jour (`unchanged` : état déjà celui-là), ou
 * { error, code }.
 */
async function feedbackTeamUpdate(env, key, { message = '', photos = [], status = null, extra = null, follow = true }) {
    const { value, metadata } = await store(env).getWithMetadata(key);
    if (!metadata) return { error: 'Retour introuvable', en: 'Report not found', code: 404 };
    const thread = feedbackThread(value, metadata);
    if (thread.length >= FEEDBACK_MAX_MESSAGES) return { error: 'Discussion trop longue', en: 'Conversation too long', code: 409 };
    const now = Date.now();
    const next = { ...metadata, u: now, r: 'a', sa: now, ...(extra || {}) };
    if (status !== null) {
        if (!FEEDBACK_STATUSES.includes(status)) return { error: 'État inconnu', en: 'Unknown status', code: 400 };
        if (status === (metadata.s || 'new')) return { metadata, thread, unchanged: true };
        thread.push({ f: 'a', s: status, at: now });
        next.s = status;
    } else {
        if (!message && !photos.length) return { error: 'Message vide', en: 'Empty message', code: 400 };
        const ph = await saveFeedbackPhotos(env, key, photos, metadata.ph || 0);
        thread.push({ f: 'a', m: message, at: now, ...(ph.length ? { ph } : {}) });
        next.n = (metadata.n || 1) + 1;
        next.ph = (metadata.ph || 0) + ph.length;
    }
    await store(env).put(key, JSON.stringify(thread), { metadata: next, expirationTtl: FEEDBACK_TTL });
    if (next.dt) await linkDiscordThread(env, key, next.dt, false);
    // Doublons fusionnés (/merge) : ils suivent l'état de celui-ci.
    if (follow && status !== null && Array.isArray(next.dups)) {
        for (const dup of next.dups.slice(0, 20)) await feedbackTeamUpdate(env, dup, { status, follow: false });
    }
    return { metadata: next, thread };
}

// ── Pont Discord (bot du relais) ───────────────────────────────────────────
// Le bot (docker/discord-bot.mjs, sur le serveur du relais vidéo) suit le
// salon forum des retours : ce qu'on écrit dans le post d'un retour part
// comme réponse du développeur, l'étiquette d'état choisie devient l'état.
// Il s'annonce avec le secret FEEDBACK_BOT_SECRET, posé des deux côtés.
//   POST /api/feedback/discord
//     { action: 'config' }                          → { forum, guild, labels }
//     { action: 'state', thread }                   → { key, status, lastFrom }
//     { action: 'reply', thread, message, photos? } → idem, après la réponse
//     { action: 'status', thread, status }          → idem, après le changement
//     { action: 'backfill' }                        → { done, remaining, retryAfter? }
//                                                     (anciens retours, voir plus haut)
//     { action: 'deliver', thread, pics? }          → { du, key, excerpt, items }
//                                                     (réponses à envoyer en MP ;
//                                                     pics: true, bot qui sait
//                                                     joindre les photos : aussi
//                                                     les réponses « photo seule »,
//                                                     et leurs numéros)
//     { action: 'photo', thread, n }                → { type, b64 } (une photo)
//   Outils du bot (voir plus bas) : get / set (sa mémoire), create /
//   userReply (/bug sur Discord, réponses en message privé, photos
//   comprises), delete, block, merge, fix / released (« c'est en ligne »),
//   summary, health, announce, poll / poll-end / poll-state (sondage).
//   Messages d'erreur en anglais : le bot les
//   affiche.
async function handleFeedbackBot(request, env) {
    const secret = String(env.FEEDBACK_BOT_SECRET || '');
    if (secret.length < 16 || !env.DB) return jsonError('Discord bridge not configured', 404);
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
    // Empreintes comparées : la durée de la comparaison n'apprend rien du secret.
    if (await sha256hex(request.headers.get('Authorization') || '') !== await sha256hex(`Bearer ${secret}`)) {
        return jsonError('Access denied', 403);
    }
    let body;
    try { body = await request.json(); } catch (e) { return jsonError('Bad JSON', 400); }

    if (body.action === 'config') {
        const hook = String(env.FEEDBACK_WEBHOOK || '').trim();
        if (!/^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\//.test(hook)) return jsonError('FEEDBACK_WEBHOOK missing or invalid', 409);
        const res = await fetch(hook).catch(() => null);
        const w = res?.ok ? await res.json().catch(() => null) : null;
        if (!w?.channel_id) return jsonError(`Webhook unreadable (HTTP ${res?.status || 0})`, 502);
        // Signe de vie (toutes les 10 min) : /stats dit si le bot tourne.
        await store(env).put(FEEDBACK_BOT_KEY, '', { metadata: { at: Date.now(), forum: w.channel_id } });
        return jsonResponse({ forum: w.channel_id, guild: w.guild_id || null, labels: FEEDBACK_STATUS_LABELS });
    }

    if (body.action === 'backfill') return jsonResponse(await backfillDiscord(env));
    const general = await feedbackBotTool(env, body);
    if (general) return general;

    const thread = String(body.thread || '');
    if (!/^\d{5,25}$/.test(thread)) return jsonError('Bad post ID', 400);
    const key = await store(env).get(`${FEEDBACK_DISCORD_PREFIX}${thread}`);
    if (!key || !FEEDBACK_KEY_RE.test(key)) return jsonError('Unknown post', 404);
    const { value, metadata } = await store(env).getWithMetadata(key);
    if (!metadata) return jsonError('Report not found', 404);
    const state = (m) => ({
        key, status: m.s || 'new', lastFrom: m.r || 'u',
        fix: m.fx || null, blocked: Boolean(m.bl), discord: Boolean(m.du), mergedInto: m.mg || null,
    });

    if (body.action === 'state') return jsonResponse(state(metadata));
    if (body.action === 'status') {
        const r = await feedbackTeamUpdate(env, key, { status: String(body.status || '') });
        return r.error ? jsonError(r.en, r.code) : jsonResponse({ ok: true, ...state(r.metadata) });
    }
    if (body.action === 'reply') {
        const message = cleanText(body.message, 2000);
        const photos = cleanPhotos(body.photos);
        if (!message && !photos.length) return jsonError('Empty message', 400);
        // Répondre depuis Discord, c'est l'avoir vu : « Nouveau » passe à « Vu ».
        if ((metadata.s || 'new') === 'new') await feedbackTeamUpdate(env, key, { status: 'seen' });
        const r = await feedbackTeamUpdate(env, key, { message, photos });
        if (r.error) return jsonError(r.en, r.code);
        // Réponse rapide « corrigé » : passe à « Fait » dans la foulée.
        if (body.status && FEEDBACK_STATUSES.includes(body.status)) {
            const s = await feedbackTeamUpdate(env, key, { status: body.status });
            if (!s.error) return jsonResponse({ ok: true, ...state(s.metadata) });
        }
        return jsonResponse({ ok: true, ...state(r.metadata) });
    }
    // Réponses du développeur pas encore envoyées en message privé à qui a
    // écrit depuis Discord (/bug) ; notées comme envoyées. Les réponses
    // « photo seule » et les numéros des photos ne vont qu'au bot qui le
    // demande (pics) : un ancien bot prendrait une réponse sans texte pour
    // un changement d'état (« is now null »).
    if (body.action === 'deliver') {
        if (!metadata.du) return jsonResponse({ du: null, items: [] });
        const thread = feedbackThread(value, metadata);
        const from = Math.max(1, Number(metadata.dd) || 1);
        const withPics = body.pics === true;
        // `i` : place de l'élément dans la discussion, pour `delivered`.
        const items = thread.slice(from).map((x, k) => ({ x, i: from + k }))
            .filter(({ x }) => x.f === 'a' && (x.m || (withPics && x.ph?.length) || (x.s && x.s !== 'seen')))
            .map(({ x, i }) => ({
                i, m: x.m || null, s: x.s || null, label: x.s ? FEEDBACK_STATUS_LABELS[x.s] || x.s : null, ph: x.ph?.length || 0,
                ...(withPics ? { pics: (x.ph || []).slice(0, FEEDBACK_MAX_PHOTOS) } : {}),
            }));
        // `peek` (bot récent) : rien n'est noté ici, le bot dit ensuite ce qui
        // est vraiment parti (`delivered`). Noté d'avance, un envoi raté en
        // message privé était perdu pour de bon.
        if (body.peek !== true && thread.length > from) await store(env).put(key, value, { metadata: { ...metadata, dd: thread.length }, expirationTtl: FEEDBACK_TTL });
        return jsonResponse({ du: metadata.du, key, excerpt: String(metadata.m || '').slice(0, 80), items });
    }
    if (body.action === 'delivered') {
        const thread = feedbackThread(value, metadata);
        const upTo = Number(body.upTo);
        if (!Number.isInteger(upTo) || upTo < 0 || upTo >= thread.length) return jsonError('Bad index', 400);
        const dd = Math.max(Number(metadata.dd) || 1, upTo + 1);
        if (dd !== metadata.dd) await store(env).put(key, value, { metadata: { ...metadata, dd }, expirationTtl: FEEDBACK_TTL });
        return jsonResponse({ ok: true, dd });
    }
    // Une photo du retour, pour la joindre au message privé : le bot n'a ni
    // le jeton du retour ni de jeton Twitch (/api/feedback/photo). Une par
    // appel : toutes dans `deliver` feraient un JSON de plusieurs Mo.
    if (body.action === 'photo') {
        const n = body.n;
        if (!Number.isInteger(n) || n < 0 || n >= (metadata.ph || 0)) return jsonError('Bad picture', 400);
        const p = await store(env).getWithMetadata(`${FEEDBACK_PHOTO_PREFIX}${key}_${n}`);
        if (!p.value) return jsonError('Picture not found', 404);
        const type = ['image/jpeg', 'image/png', 'image/webp'].includes(p.metadata?.t) ? p.metadata.t : 'image/jpeg';
        return jsonResponse({ type, b64: p.value });
    }
    if (body.action === 'delete') {
        await store(env).delete(key);
        for (const k of (await listStoreKeys(env, `${FEEDBACK_PHOTO_PREFIX}${key}_`)).slice(0, 200)) await store(env).delete(k.name);
        await store(env).delete(`${FEEDBACK_DISCORD_PREFIX}${thread}`);
        return jsonResponse({ ok: true, key });
    }
    if (body.action === 'block') {
        const meta = { ...metadata, bl: true };
        await store(env).put(key, value, { metadata: meta, expirationTtl: FEEDBACK_TTL });
        return jsonResponse({ ok: true, ...state(meta) });
    }
    if (body.action === 'merge') {
        // Lien du post (…/channels/<serveur>/<post>) ou son numéro.
        const into = String(body.into || '').match(/(\d{5,25})\D*$/)?.[1];
        const target = into && await store(env).get(`${FEEDBACK_DISCORD_PREFIX}${into}`);
        if (!target || !FEEDBACK_KEY_RE.test(target) || target === key) return jsonError('Other report not found', 404);
        const other = await store(env).getWithMetadata(target);
        if (!other.metadata) return jsonError('Other report not found', 404);
        const r = await feedbackTeamUpdate(env, key, { message: FEEDBACK_MERGED_MESSAGE, extra: { mg: target } });
        if (r.error) return jsonError(r.en, r.code);
        if ((other.metadata.s || 'new') !== (r.metadata.s || 'new')) await feedbackTeamUpdate(env, key, { status: other.metadata.s || 'new', follow: false });
        const dups = [...new Set([...(other.metadata.dups || []), key])].slice(-20);
        await store(env).put(target, other.value, { metadata: { ...other.metadata, dups }, expirationTtl: FEEDBACK_TTL });
        return jsonResponse({ ok: true, key, into: target, intoThread: other.metadata.dt || null });
    }
    // Où partira le correctif : la personne sera prévenue à sa sortie.
    if (body.action === 'fix') {
        const p = String(body.platform || '');
        if (!['ios', 'web', 'both', 'none'].includes(p)) return jsonError('Bad platform', 400);
        const meta = { ...metadata };
        if (p === 'none') delete meta.fx;
        else meta.fx = { p, at: Date.now(), done: {} };
        await store(env).put(key, value, { metadata: meta, expirationTtl: FEEDBACK_TTL });
        const { metadata: versions } = await store(env).getWithMetadata(FEEDBACK_VERSIONS_KEY);
        return jsonResponse({ ok: true, ...state(meta), versions: versions || {} });
    }
    return jsonError('Unknown action', 400);
}

// ── Outils du bot qui ne visent pas un post ────────────────────────────────
const FEEDBACK_VERSIONS_KEY = 'fbmeta_versions';
const FEEDBACK_MERGED_MESSAGE = "Thanks! Someone reported the same thing, so I'm following it up there — you'll get the news here too.";
const FEEDBACK_LIVE_MESSAGES = {
    ios: (v) => `Good news: the fix is out in the app (version ${v}). Update TwitchUnblock from your source, then let me know if anything's still wrong.`,
    web: (v) => `Good news: the fix is live on the website (version ${v}). Reload the page, then let me know if anything's still wrong.`,
};
const BOT_STORE_PREFIX = 'dcbot_';
const discordReportHits = new Map();
const discordReplyHits = new Map();

/** Rend une réponse si l'action est l'une des siennes, sinon null. */
async function feedbackBotTool(env, body) {
    switch (body.action) {
        // Mémoire du bot (réglages, versions vues, brouillons) : petites
        // valeurs JSON sous `dcbot_<clé>`, gardées ou pour `ttl` secondes.
        case 'get': {
            const k = String(body.key || '');
            if (!/^[a-z0-9_:-]{1,60}$/.test(k)) return jsonError('Bad key', 400);
            let value = null;
            try { value = JSON.parse(await store(env).get(BOT_STORE_PREFIX + k) || 'null'); } catch (e) {}
            return jsonResponse({ value });
        }
        case 'set': {
            const k = String(body.key || '');
            const text = JSON.stringify(body.value ?? null);
            if (!/^[a-z0-9_:-]{1,60}$/.test(k) || text.length > 20000) return jsonError('Bad key or value too big', 400);
            const ttl = Number(body.ttl) || 0;
            await store(env).put(BOT_STORE_PREFIX + k, text, ttl > 0 ? { expirationTtl: Math.max(60, ttl) } : {});
            return jsonResponse({ ok: true });
        }
        // /bug et /idea sur Discord : le même retour que depuis l'app ; les
        // réponses partent en message privé (deliver), pas de jeton à garder.
        case 'create': {
            const du = String(body.user?.id || '');
            if (!/^\d{5,25}$/.test(du)) return jsonError('Bad Discord user', 400);
            if (overLimit(discordReportHits, du, 5)) return jsonError('Too many reports — try again in an hour', 429);
            const message = cleanText(body.message, 2000);
            if (message.length < 5) return jsonError('Message too short', 400);
            // Le bot compare `photos` (gardées) à ce qu'il a envoyé et le dit.
            const photos = await photoAllowance(env, cleanPhotos(body.photos), `du:${du}`);
            const now = Date.now();
            const key = `${FEEDBACK_PREFIX}${now.toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
            const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '').slice(0, 48);
            const ph = await saveFeedbackPhotos(env, key, photos, 0);
            const entry = {
                k: FEEDBACK_KINDS.includes(body.kind) ? body.kind : 'other',
                m: message,
                c: `@${cleanText(body.user?.name, 40) || du} (Discord)`,
                p: 'discord',
                v: cleanText(body.where, 60) || 'Discord',
                i: null,
                at: now, s: 'new', u: now, r: 'u', n: 1, ph: ph.length,
                h: await sha256hex(token), du, dd: 1,
            };
            await store(env).put(key, JSON.stringify([{ f: 'u', m: message, at: now, ...(ph.length ? { ph } : {}) }]), { metadata: entry, expirationTtl: FEEDBACK_TTL });
            const r = await notifyDiscord(env, null, entry, photos, { key });
            return jsonResponse({ ok: true, key, thread: r?.thread || null, photos: ph.length });
        }
        // Réponse de la personne (bouton d'un message privé), captures
        // comprises, comme /api/feedback/reply.
        case 'userReply': {
            const key = String(body.key || '');
            if (!FEEDBACK_KEY_RE.test(key)) return jsonError('Bad report', 400);
            const { value, metadata: m } = await store(env).getWithMetadata(key);
            if (!m?.du || m.du !== String(body.du || '')) return jsonError('Report not found', 404);
            if (m.bl) return jsonError('This conversation was closed by the developer', 403);
            const message = cleanText(body.message, 2000);
            const asked = cleanPhotos(body.photos);
            if (!message && !asked.length) return jsonError('Empty message', 400);
            const thread = feedbackThread(value, m);
            if (thread.length >= FEEDBACK_MAX_MESSAGES) return jsonError('Conversation too long', 409);
            if (overLimit(discordReplyHits, m.du, 20)) return jsonError('Too many replies — try again in an hour', 429);
            const photos = await photoAllowance(env, asked, `du:${m.du}`);
            if (!message && !photos.length) return jsonError('Screenshots are paused for today — try again tomorrow', 429);
            const now = Date.now();
            const ph = await saveFeedbackPhotos(env, key, photos, m.ph || 0);
            thread.push({ f: 'u', m: message, at: now, ...(ph.length ? { ph } : {}) });
            const next = { ...m, u: now, r: 'u', n: (m.n || 1) + 1, ph: (m.ph || 0) + ph.length };
            await store(env).put(key, JSON.stringify(thread), { metadata: next, expirationTtl: FEEDBACK_TTL });
            await notifyDiscord(env, null, { ...next, m: message }, photos, { key, inReplyTo: m.m });
            return jsonResponse({ ok: true, photos: ph.length });
        }
        case 'released':
            return jsonResponse(await feedbackReleased(env, { ios: body.ios, web: body.web }));
        // Résumé du matin : retours en attente de réponse, nouveaux, ouverts.
        case 'summary': {
            const now = Date.now();
            const list = (await listStoreKeys(env, FEEDBACK_PREFIX)).map(({ name, metadata }) => ({ key: name, m: metadata || {} }));
            const finished = (m) => m.s === 'done' || m.s === 'refused';
            const awaiting = list.filter(({ m }) => m.r === 'u' && !m.bl && !m.mg && !(finished(m) && m.r === 'a'))
                .sort((a, b) => (a.m.u || 0) - (b.m.u || 0))
                .map(({ key, m }) => ({ key, thread: m.dt || null, kind: m.k || 'other', excerpt: String(m.m || '').replace(/\s+/g, ' ').slice(0, 70), since: m.u || m.at || 0 }));
            return jsonResponse({
                awaiting: awaiting.slice(0, 15),
                awaitingCount: awaiting.length,
                open: list.filter(({ m }) => !finished(m) && !m.mg).length,
                new24h: list.filter(({ m }) => now - (m.at || 0) < 86400000).length,
                total: list.length,
            });
        }
        // État des notifications et du webhook, pour les alertes du bot.
        case 'health': {
            let pause = null;
            try { pause = JSON.parse(await store(env).get('push_ntfy_pause') || 'null'); } catch (e) {}
            const route = ntfyRoute(env);
            const { metadata: hook } = await store(env).getWithMetadata(FEEDBACK_HOOK_KEY);
            return jsonResponse({
                ntfy: pause && pause.via === route && pause.until > Date.now() ? { until: pause.until, code: Number(pause.code) || 0 } : null,
                webhook: hook || null,
            });
        }
        // /announce : le bandeau du développeur dans l'app et sur le site.
        case 'announce': {
            announcementCache = null;
            if (body.clear === true) {
                await store(env).delete(ANNOUNCEMENT_KEY);
                return jsonResponse({ ok: true, announcement: null });
            }
            const title = cleanText(body.title, 80);
            const message = cleanText(body.message, 500);
            if (!title && !message) return jsonError('A title or a message is needed', 400);
            const link = cleanText(body.link, 300);
            if (link && !/^https:\/\/[^\s]+$/i.test(link)) return jsonError('Link: https:// only', 400);
            const hours = Math.min(24 * 30, Math.max(1 / 60, Number(body.hours) || 24));
            const ttl = Math.round(hours * 3600);
            const announcement = { id: Date.now().toString(36), title, message, link: link || null, until: Date.now() + ttl * 1000, createdAt: Date.now() };
            await store(env).put(ANNOUNCEMENT_KEY, JSON.stringify(announcement), { expirationTtl: Math.max(60, ttl) });
            return jsonResponse({ ok: true, announcement });
        }
        // Sondage (/poll, /poll-end) ; `poll-state` : le bot en poste les
        // résultats une fois fini.
        case 'poll': {
            const r = await createPoll(env, body);
            if (r.error) return jsonError(r.error, 400);
            return jsonResponse({ ok: true, ...(await pollAdminView(env)) });
        }
        case 'poll-end': {
            if (!(await endPoll(env))) return jsonError('No poll running', 404);
            return jsonResponse({ ok: true, ...(await pollAdminView(env)) });
        }
        case 'poll-state':
            return jsonResponse(await pollAdminView(env));
        // Modèles d'annonce (/announce template:), modifiés dans /stats.
        case 'announce-templates':
            return jsonResponse({ templates: await readAnnounceTemplates(env) });
    }
    return null;
}

/**
 * Nouvelle version en ligne (le bot lit l'app sur GitHub et le site sur
 * Vercel) : chaque retour dont le correctif l'attendait (`fx`, choisi sur
 * Discord en passant à « Done ») reçoit « c'est en ligne », ses doublons
 * aussi, et son post Discord le note. La première fois, on retient
 * seulement les versions.
 */
async function feedbackReleased(env, versions) {
    const { metadata: known } = await store(env).getWithMetadata(FEEDBACK_VERSIONS_KEY);
    const prev = known || {};
    const next = { ...prev };
    const shipped = [];
    for (const p of ['ios', 'web']) {
        const v = cleanText(versions?.[p], 40);
        if (!v || v === prev[p]) continue;
        next[p] = v;
        if (prev[p]) shipped.push({ p, v });
    }
    let notified = 0, complete = true;
    if (shipped.length) {
        // Seulement ceux qui attendent encore cette sortie : tous les retours
        // « correctif » restaient dans la liste, et passé 30 (les plus anciens,
        // déjà prévenus), les nouveaux ne l'étaient plus jamais.
        const pending = (await listStoreKeys(env, FEEDBACK_PREFIX)).filter(({ metadata: m }) => m?.fx
            && shipped.some(({ p }) => (m.fx.p === p || m.fx.p === 'both') && !m.fx.done?.[p]));
        // Par lots de 30 (requêtes par appel) : le reste au passage suivant du bot.
        if (pending.length > 30) complete = false;
        for (const { name } of pending.slice(0, 30)) {
            for (const { p, v } of shipped) {
                const { metadata: m } = await store(env).getWithMetadata(name);
                if (!m?.fx || !(m.fx.p === p || m.fx.p === 'both') || m.fx.done?.[p]) continue;
                const message = FEEDBACK_LIVE_MESSAGES[p](v);
                const fx = { ...m.fx, done: { ...(m.fx.done || {}), [p]: v } };
                const r = await feedbackTeamUpdate(env, name, { message, extra: { fx } });
                if (r.error) continue;
                notified++;
                const where = p === 'ios' ? `the app ${v}` : `the website ${v}`;
                await echoTeamToDiscord(env, null, r.metadata, { note: `🚀 **Live in ${where}** — the user was told:\n${message}` });
                for (const dup of (m.dups || []).slice(0, 20)) {
                    const d = await feedbackTeamUpdate(env, dup, { message, follow: false });
                    if (!d.error) { notified++; await echoTeamToDiscord(env, null, d.metadata, { note: `🚀 **Live in ${where}** — the user was told.` }); }
                }
            }
        }
    }
    // Versions enregistrées une fois tout le monde prévenu : une erreur en route
    // ou un reste à traiter fait repasser l'appel suivant (les prévenus sont
    // sautés, voir fx.done). Enregistrées avant, les avis restants se perdaient.
    if (complete && JSON.stringify(next) !== JSON.stringify(prev)) await store(env).put(FEEDBACK_VERSIONS_KEY, '', { metadata: next });
    return { versions: complete ? next : prev, shipped, notified };
}

// ── Surveillance du relais (facultative) ───────────────────────────────────
// Toutes les 5 min, si ALERT_WEBHOOK (webhook d'un salon Discord privé) est
// posé : le relais du VPS répond-il (/health), et son bot Discord s'est-il
// annoncé (toutes les 10 min) ? Prévenu au changement seulement : panne,
// puis retour. Le bot ne peut pas le dire lui-même : il tourne dans le relais.
const RELAY_WATCH_KEY = 'fbmeta_relaywatch';
async function relayWatch(env, now = new Date()) {
    const hook = String(env.ALERT_WEBHOOK || '').trim();
    const relay = String(env.NTFY_RELAY || '').trim().replace(/\/+$/, '');
    if (!hook || !relay || !env.DB || now.getUTCMinutes() % 5) return;
    const { metadata: prev } = await store(env).getWithMetadata(RELAY_WATCH_KEY);
    const st = { relayDown: 0, botDown: 0, fails: 0, ...(prev || {}) };
    const before = JSON.stringify(st);
    let ok = false;
    try { ok = (await fetch(`${relay}/health`, { signal: AbortSignal.timeout(10000) })).ok; } catch (e) { /* injoignable */ }
    const t0 = now.getTime();
    const msgs = [];
    st.fails = ok ? 0 : st.fails + 1;
    if (st.fails >= 2 && !st.relayDown) {
        st.relayDown = t0;
        msgs.push(`⚠️ **Relay unreachable** (<${relay}>): the video relay, ntfy notifications and the Discord bot are down.`);
    }
    if (ok && st.relayDown) {
        msgs.push(`✅ **Relay is back** after ${Math.max(1, Math.round((t0 - st.relayDown) / 60000))} min.`);
        st.relayDown = 0;
    }
    if (ok && env.FEEDBACK_BOT_SECRET) {
        const { metadata: bot } = await store(env).getWithMetadata(FEEDBACK_BOT_KEY);
        const silent = !bot?.at || t0 - bot.at > 25 * 60000;
        if (silent && !st.botDown) {
            st.botDown = t0;
            msgs.push(`⚠️ **Discord bot silent** ${bot?.at ? `since <t:${Math.floor(bot.at / 1000)}:R>` : '(never checked in)'} — token, intents or the relay's .env?`);
        }
        if (!silent && st.botDown) { msgs.push('✅ **Discord bot is back.**'); st.botDown = 0; }
    }
    for (const content of msgs) await discordHook(hook, { username: 'TwitchUnblock', allowed_mentions: { parse: [] }, content });
    if (JSON.stringify(st) !== before) await store(env).put(RELAY_WATCH_KEY, '', { metadata: st });
}

// GET  /api/admin/feedback          — les retours, du plus récent au plus ancien.
// GET  /api/admin/feedback?key=fb_… — un retour et sa discussion.
// POST /api/admin/feedback — { reply: { key, message, photos? } },
//      { status: { key, status } }, { seen: { key } }, { delete: '<clé>' }
//      ou { clear: true }.
async function handleAdminFeedback(request, env, ctx) {
    const { denied } = await requireAdmin(request);
    if (denied) return denied;
    const listAll = (prefix) => listStoreKeys(env, prefix);
    const summary = (key, m) => ({
        key, kind: m.k || 'other', message: m.m || '', contact: m.c || null, platform: m.p || '?',
        version: m.v || '?', info: m.i || null, at: m.at || 0,
        status: m.s || 'new', updatedAt: m.u || m.at || 0, lastFrom: m.r || 'u', count: m.n || 1, photos: m.ph || 0,
        // Dernière fois que l'admin l'a vu (« Vu », réponse ou nouvel état).
        seenAt: m.sa || 0,
    });
    const noStore = { ...RESPONSE_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

    if (request.method === 'POST') {
        let body;
        try { body = await request.json(); } catch (e) { return jsonError('JSON invalide', 400); }

        // « Vu » : un retour nouveau passe à l'état « Vu », que la personne
        // voit ; ce qu'elle a écrit jusque-là n'est plus « à répondre ». Rien
        // d'autre ne lui est envoyé.
        if (typeof body.seen?.key === 'string') {
            const key = body.seen.key;
            if (!FEEDBACK_KEY_RE.test(key)) return jsonError('Clé invalide', 400);
            const { value, metadata } = await store(env).getWithMetadata(key);
            if (!metadata) return jsonError('Retour introuvable', 404);
            const thread = feedbackThread(value, metadata);
            const now = Date.now();
            const next = { ...metadata, sa: now };
            if ((metadata.s || 'new') === 'new' && thread.length < FEEDBACK_MAX_MESSAGES) {
                thread.push({ f: 'a', s: 'seen', at: now });
                Object.assign(next, { s: 'seen', u: now, r: 'a' });
            }
            await store(env).put(key, JSON.stringify(thread), { metadata: next, expirationTtl: FEEDBACK_TTL });
            if (next.s !== (metadata.s || 'new')) echoTeamToDiscord(env, ctx, next, { status: next.s });
            return jsonResponse({ ok: true, item: summary(key, next), thread });
        }

        // Réponse ou nouvel état : ajoutés à la discussion, que la personne lit
        // dans l'app ou sur le site.
        const target = body.reply?.key ?? body.status?.key;
        if (typeof target === 'string') {
            if (!FEEDBACK_KEY_RE.test(target)) return jsonError('Clé invalide', 400);
            const update = body.reply
                ? { message: cleanText(body.reply.message, 2000), photos: cleanPhotos(body.reply.photos) }
                : { status: String(body.status.status || '') };
            const r = await feedbackTeamUpdate(env, target, update);
            if (r.error) return jsonError(r.error, r.code);
            // Recopié dans le post Discord du retour (salon forum).
            if (!r.unchanged) echoTeamToDiscord(env, ctx, r.metadata, update);
            return jsonResponse({ ok: true, item: summary(target, r.metadata), thread: r.thread });
        }

        // Test de l'envoi vers Discord depuis /stats.
        if (body.testWebhook === true) {
            const r = await notifyDiscord(env, null, { k: 'other', m: '✅ Webhook test from /stats: reports arrive here.', p: 'web', v: 'test', at: Date.now() }, [], { test: true });
            const { metadata } = await store(env).getWithMetadata(FEEDBACK_HOOK_KEY);
            return jsonResponse({ ok: Boolean(metadata?.ok), webhook: { configured: Boolean(env.FEEDBACK_WEBHOOK), last: metadata || null } });
        }
        if (typeof body.delete === 'string' && FEEDBACK_KEY_RE.test(body.delete)) {
            const { metadata } = await store(env).getWithMetadata(body.delete);
            await store(env).delete(body.delete);
            if (metadata?.dt) await store(env).delete(`${FEEDBACK_DISCORD_PREFIX}${metadata.dt}`);
            for (const k of (await listAll(`${FEEDBACK_PHOTO_PREFIX}${body.delete}_`)).slice(0, 200)) await store(env).delete(k.name);
            // Son post Discord part aussi (supprimé par le bot du relais).
            if (metadata?.dt) await trashDiscordPosts(env, ctx, [metadata.dt]);
            return jsonResponse({ ok: true, deleted: 1 });
        }
        if (body.clear === true) {
            // Une écriture D1 par entrée : 500 retours et 500 photos au plus par action.
            const keys = (await listAll(FEEDBACK_PREFIX)).slice(0, 500);
            for (const k of keys) await store(env).delete(k.name);
            const pics = (await listAll(FEEDBACK_PHOTO_PREFIX)).slice(0, 500);
            for (const k of pics) await store(env).delete(k.name);
            const links = (await listAll(FEEDBACK_DISCORD_PREFIX)).slice(0, 500);
            for (const k of links) await store(env).delete(k.name);
            await trashDiscordPosts(env, ctx, links.map((k) => k.name.slice(FEEDBACK_DISCORD_PREFIX.length)));
            return jsonResponse({ ok: true, deleted: keys.length });
        }
        return jsonError('Action inconnue', 400);
    }

    const one = new URL(request.url).searchParams.get('key');
    if (one) {
        if (!FEEDBACK_KEY_RE.test(one)) return jsonError('Clé invalide', 400);
        const { value, metadata } = await store(env).getWithMetadata(one);
        if (!metadata) return jsonError('Retour introuvable', 404);
        return new Response(JSON.stringify({ item: summary(one, metadata), thread: feedbackThread(value, metadata) }), { headers: noStore });
    }
    const items = (await listAll(FEEDBACK_PREFIX)).map(({ name, metadata }) => summary(name, metadata || {}))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    const { metadata: hook } = await store(env).getWithMetadata(FEEDBACK_HOOK_KEY);
    const { metadata: bot } = await store(env).getWithMetadata(FEEDBACK_BOT_KEY);
    return new Response(JSON.stringify({
        items,
        webhook: { configured: Boolean(env.FEEDBACK_WEBHOOK), last: hook || null },
        bridge: { configured: Boolean(env.FEEDBACK_BOT_SECRET), last: bot || null },
    }), { headers: noStore });
}

// ── Réactions aux annonces ───────────────────────────────────────────────
// Une réaction par appareil (identifiant aléatoire de l'app ou du site),
// modifiable ou retirable. Clé `annr_<annonce>_<appareil>`, l'emoji en
// métadonnées : le décompte (réservé à l'admin) se fait avec list(), sans
// lecture par clé. Les clés expirent une semaine après l'annonce.
const REACTIONS = ['👍', '❤️', '🔥', '😂', '👎'];
const REACTION_PREFIX = 'annr_';
const reactHits = new Map();   // adresse → { n, until } (mémoire de l'instance)

async function handleAnnouncementReact(request, env) {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
    if (!env.DB) return jsonError("Base D1 'DB' non liée au Worker.", 500);
    const ua = request.headers.get('User-Agent') || '';
    if (BOT_UA.test(ua)) return jsonResponse({ ok: true, ignored: true });
    // Chaque réaction est une écriture KV : 30 par heure et par adresse.
    if (overLimit(reactHits, clientKey(request), 30)) return jsonError('Trop de requêtes', 429);
    const now = Date.now();

    let body;
    try { body = await request.json(); } catch (e) { return jsonError('JSON invalide', 400); }
    const device = String(body.id || '');
    if (!/^[0-9a-fA-F-]{36}$/.test(device)) return jsonError('ID invalide', 400);
    const current = await readAnnouncement(env);
    if (!current || current.id !== String(body.announcementId || '')) return jsonError('Annonce terminée', 410);
    const emoji = body.emoji == null ? null : String(body.emoji);
    if (emoji !== null && !REACTIONS.includes(emoji)) return jsonError('Réaction inconnue', 400);

    const key = `${REACTION_PREFIX}${current.id}_${device.toLowerCase()}`;
    if (emoji === null) await store(env).delete(key);
    else {
        const ttl = Math.max(60, Math.round((current.until - now) / 1000) + 7 * 86400);
        await store(env).put(key, '', { expirationTtl: ttl, metadata: { e: emoji } });
    }
    return jsonResponse({ ok: true, emoji });
}

async function countReactions(env, announcementId) {
    const counts = Object.fromEntries(REACTIONS.map((e) => [e, 0]));
    let cursor, total = 0;
    do {
        const page = await store(env).list({ prefix: `${REACTION_PREFIX}${announcementId}_`, limit: 1000, cursor });
        for (const k of page.keys) {
            const e = k.metadata?.e;
            if (e in counts) { counts[e]++; total++; }
        }
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return { counts, total };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Sondages : une question du développeur dans l'app et sur le site, comme
//  les annonces (un seul à la fois, durée choisie). Vote anonyme par
//  appareil, modifiable jusqu'à la fin ; résultats montrés après avoir voté,
//  et à tous une fois fini (24 h). Lancés dans /stats ou avec /poll (bot).
// ═══════════════════════════════════════════════════════════════════════════
const POLL_KEY = 'poll';
const POLL_VOTE_PREFIX = 'pollv_';
const POLL_SHOW_AFTER = 24 * 3600 * 1000;   // résultats finaux affichés 24 h
const POLL_DEVICE_RE = /^[0-9a-fA-F-]{36}$/;
const pollHits = new Map();   // adresse → { n, until } (mémoire de l'instance)
let pollCache = null;         // { value, until }
let pollCountCache = null;    // { id, at, value }

async function readPoll(env) {
    if (pollCache && pollCache.until > Date.now()) return pollCache.value;
    let value = null;
    try { value = await store(env).get(POLL_KEY, 'json'); } catch (e) {}
    if (value && !(value.until + POLL_SHOW_AFTER > Date.now())) value = null;
    pollCache = { value, until: Date.now() + 30 * 1000 };
    return value;
}

/** Votes d'un sondage : par choix, et nombre de votants. Une liste par
 *  lecture : gardés 30 s, sauf `fresh` (après un vote, pour l'admin). */
async function countPoll(env, poll, fresh = false) {
    const hit = pollCountCache;
    if (!fresh && hit && hit.id === poll.id && Date.now() - hit.at < 30 * 1000) return hit.value;
    const counts = poll.options.map(() => 0);
    let voters = 0;
    for (const k of await listStoreKeys(env, `${POLL_VOTE_PREFIX}${poll.id}_`)) {
        const picks = Array.isArray(k.metadata?.o) ? k.metadata.o.filter((i) => Number.isInteger(i) && i >= 0 && i < counts.length) : [];
        for (const i of picks) counts[i]++;
        if (picks.length) voters++;
    }
    const value = { counts, voters };
    pollCountCache = { id: poll.id, at: Date.now(), value };
    return value;
}

/** Ce qu'un appareil voit : le sondage, son vote, et les résultats s'il a
 *  voté ou si c'est fini. */
async function pollState(env, poll, device, fresh = false) {
    if (!poll) return { poll: null, mine: null, results: null };
    const ended = Date.now() >= poll.until;
    let mine = null;
    if (device) {
        const { metadata } = await store(env).getWithMetadata(`${POLL_VOTE_PREFIX}${poll.id}_${device}`);
        if (Array.isArray(metadata?.o) && metadata.o.length) mine = metadata.o;
    }
    return {
        poll: { id: poll.id, question: poll.question, options: poll.options, multi: Boolean(poll.multi), until: poll.until, ended },
        mine,
        results: ended || mine ? await countPoll(env, poll, fresh) : null,
    };
}

// GET /api/poll, ou POST { device } (son vote en plus) → { poll, mine, results }
async function handlePollState(request, env) {
    if (!env.DB) return jsonResponse({ poll: null, mine: null, results: null });
    let device = null;
    if (request.method === 'POST') {
        let body = {};
        try { body = await request.json(); } catch (e) {}
        if (POLL_DEVICE_RE.test(String(body.device || ''))) device = String(body.device).toLowerCase();
    } else if (request.method !== 'GET') return jsonError('Method Not Allowed', 405);
    return new Response(JSON.stringify(await pollState(env, await readPoll(env), device)), {
        headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
}

// POST /api/poll/vote { device, pollId, choices: [i…] } — choices vide : vote retiré.
async function handlePollVote(request, env) {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
    if (!env.DB) return jsonError("Base D1 'DB' non liée au Worker.", 500);
    if (BOT_UA.test(request.headers.get('User-Agent') || '')) return jsonResponse({ ok: true, ignored: true });
    // Chaque vote est une écriture : 30 par heure et par adresse.
    if (overLimit(pollHits, clientKey(request), 30)) return jsonError('Trop de requêtes', 429);
    let body;
    try { body = await request.json(); } catch (e) { return jsonError('JSON invalide', 400); }
    const device = String(body.device || '').toLowerCase();
    if (!POLL_DEVICE_RE.test(device)) return jsonError('ID invalide', 400);
    pollCache = null;
    const poll = await readPoll(env);
    if (!poll || poll.id !== String(body.pollId || '') || Date.now() >= poll.until) return jsonError('Sondage terminé', 410);
    const picks = [...new Set((Array.isArray(body.choices) ? body.choices : []).map(Number))]
        .filter((i) => Number.isInteger(i) && i >= 0 && i < poll.options.length).sort((a, b) => a - b);
    if (!poll.multi && picks.length > 1) return jsonError('Un seul choix', 400);
    const key = `${POLL_VOTE_PREFIX}${poll.id}_${device}`;
    if (!picks.length) await store(env).delete(key);
    else {
        const ttl = Math.max(60, Math.round((poll.until + POLL_SHOW_AFTER - Date.now()) / 1000) + 86400);
        await store(env).put(key, '', { expirationTtl: ttl, metadata: { o: picks } });
    }
    return jsonResponse({ ok: true, ...(await pollState(env, poll, device, true)) });
}

/** Nouveau sondage (/stats ou bot) : question, 2 à 6 choix, un ou plusieurs
 *  par personne, durée en heures. Remplace celui en cours. */
async function createPoll(env, body) {
    const question = cleanText(body.question, 140);
    const raw = Array.isArray(body.options) ? body.options : String(body.options || '').split('\n');
    const options = [...new Set(raw.map((o) => cleanText(o, 60)).filter(Boolean))];
    if (!question) return { error: 'A question is needed' };
    if (options.length < 2 || options.length > 6) return { error: 'Between 2 and 6 different choices' };
    const hours = Math.min(24 * 30, Math.max(1 / 60, Number(body.hours) || 24));
    const now = Date.now();
    const poll = { id: now.toString(36), question, options, multi: body.multi === true, until: now + Math.round(hours * 3600) * 1000, createdAt: now };
    await store(env).put(POLL_KEY, JSON.stringify(poll), { expirationTtl: Math.max(60, Math.round((poll.until + POLL_SHOW_AFTER - now) / 1000)) });
    pollCache = null;
    pollCountCache = null;
    return { poll };
}

/** Fin anticipée : les résultats restent affichés 24 h. */
async function endPoll(env) {
    let poll = null;
    try { poll = await store(env).get(POLL_KEY, 'json'); } catch (e) {}
    if (!poll) return null;
    if (Date.now() < poll.until) {
        poll.until = Date.now();
        await store(env).put(POLL_KEY, JSON.stringify(poll), { expirationTtl: Math.round(POLL_SHOW_AFTER / 1000) });
    }
    pollCache = null;
    return poll;
}

/** Sondage et tous ses résultats (admin, bot). */
async function pollAdminView(env) {
    pollCache = null;
    const poll = await readPoll(env);
    return { poll: poll ? { ...poll, ended: Date.now() >= poll.until } : null, results: poll ? await countPoll(env, poll, true) : null };
}

// GET : sondage en cours et résultats. POST { question, options, multi, hours } :
// lancer ; { end: true } : terminer (résultats affichés 24 h) ; { clear: true } : retirer.
async function handleAdminPoll(request, env) {
    const { denied } = await requireAdmin(request);
    if (denied) return denied;
    if (request.method === 'GET') return jsonResponse(await pollAdminView(env));
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
    let body;
    try { body = await request.json(); } catch (e) { return jsonError('JSON invalide', 400); }
    if (body.clear === true) {
        await store(env).delete(POLL_KEY);
        pollCache = null;
        return jsonResponse({ ok: true, poll: null, results: null });
    }
    if (body.end === true) {
        if (!(await endPoll(env))) return jsonError('Aucun sondage en cours', 404);
        return jsonResponse({ ok: true, ...(await pollAdminView(env)) });
    }
    const r = await createPoll(env, body);
    if (r.error) return jsonError(r.error, 400);
    return jsonResponse({ ok: true, ...(await pollAdminView(env)) });
}

// ── Commandes Moobot (relais pour le site) ───────────────────────────────
// Nightbot, StreamElements et Fossabot sont appelés directement par le site ;
// Moobot n'autorise que moo.bot (CORS), d'où ce relais. Cache 10 min par
// chaîne, sauf quand Moobot n'a pas répondu.
const moobotCache = new Map();   // chaîne → { at, body }
async function handleMoobotCommands(url) {
    const channel = String(url.searchParams.get('channel') || '').toLowerCase();
    if (!/^[a-z0-9_]{1,25}$/.test(channel)) return jsonError('Chaîne invalide', 400);
    const hit = moobotCache.get(channel);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) {
        return new Response(hit.body, { headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json' } });
    }
    let commands = [];
    const moo = async (u) => {
        const res = await fetch(u);
        if (!res.ok) throw new Error(`Moobot ${res.status}`);
        return res.json();
    };
    try {
        // Chaîne absente de Moobot : 200 sans `channel`, donc aucune commande.
        const meta = await moo(`https://api.moo.bot/1/channel/meta?name=${channel}`);
        const id = meta?.channel?.userid;
        if (id) {
            const list = await moo(`https://api.moo.bot/1/channel/public/commands/list?channel=${encodeURIComponent(id)}`);
            commands = (list?.list ?? [])
                .filter((c) => c?.identifier)
                .map((c) => ({ name: String(c.identifier).startsWith('!') ? String(c.identifier) : `!${c.identifier}`, response: String(c.response ?? '') }))
                .slice(0, 500);
        }
    } catch (e) {
        // Moobot injoignable ou réponse illisible : ce n'est pas « aucune
        // commande ». Rien n'est gardé 10 min, et le site le sait
        // (`unavailable`, que ses anciennes versions ignorent).
        return new Response(JSON.stringify({ commands: [], unavailable: true }), { headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json' } });
    }
    const body = JSON.stringify({ commands });
    if (moobotCache.size > 500) moobotCache.clear();
    moobotCache.set(channel, { at: Date.now(), body });
    return new Response(body, { headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json' } });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Stockage : base D1 (binding `DB`), à la place du KV.
//
//  Le KV gratuit n'offre que 1 000 écritures par jour ; D1 en offre 100 000.
//  Pour ne rien changer à la logique éprouvée du Worker (fusion de la
//  sauvegarde, comptage, stats, admin, annonces, réactions), D1 est exposé
//  avec les mêmes opérations que le KV : get, getWithMetadata, put (avec
//  métadonnées et durée de vie), delete, list par préfixe.
//
//  Sécurité : la base n'a ni adresse publique ni clé ; seul ce Worker y
//  accède, par son binding. Toutes les requêtes sont préparées (valeurs
//  passées par bind, jamais collées dans le SQL).
//
//  L'ancien KV (`TWITCH_DATA`) a été recopié dans D1 (bouton « Migrer
//  KV → D1 » de /stats) puis délié : D1 est la seule source. Avant, une
//  sauvegarde absente de D1 était encore relue dans le KV ; ce secours et
//  la route /api/admin/migrate n'ont plus lieu d'être.
// ═══════════════════════════════════════════════════════════════════════════
const SCHEMA = [
    `CREATE TABLE IF NOT EXISTS kv (
        key     TEXT PRIMARY KEY,
        value   TEXT NOT NULL DEFAULT '',
        meta    TEXT,
        expires INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS kv_expires ON kv (expires)`,
    // Compteurs par jour (/stats) : actifs du jour, lectures par issue.
    `CREATE TABLE IF NOT EXISTS stats_day (
        day    TEXT NOT NULL,
        metric TEXT NOT NULL,
        n      INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, metric)
    )`,
    // Notifications de live (Web Push) : abonnements, chaînes suivies par
    // chacun, dernier live vu par chaîne (« ? » : pas encore lu), file d'envoi.
    `CREATE TABLE IF NOT EXISTS push_subs (
        id       TEXT PRIMARY KEY,
        kind     TEXT NOT NULL DEFAULT 'web',
        endpoint TEXT NOT NULL,
        p256dh   TEXT NOT NULL,
        auth     TEXT NOT NULL,
        lang     TEXT,
        hash     TEXT,
        created  INTEGER,
        updated  INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS push_follow (
        login TEXT NOT NULL,
        sub   TEXT NOT NULL,
        PRIMARY KEY (login, sub)
    )`,
    `CREATE INDEX IF NOT EXISTS push_follow_sub ON push_follow (sub)`,
    `CREATE TABLE IF NOT EXISTS push_live (
        login  TEXT PRIMARY KEY,
        stream TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS push_queue (
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        sub  TEXT NOT NULL,
        body TEXT NOT NULL,
        at   INTEGER NOT NULL
    )`,
];
let schemaReady = null;   // une fois par instance du Worker
function ensureSchema(env) {
    schemaReady ??= env.DB.batch(SCHEMA.map((q) => env.DB.prepare(q))).catch((e) => { schemaReady = null; throw e; });
    return schemaReady;
}

const parseMeta = (m) => { if (!m) return null; try { return JSON.parse(m); } catch (e) { return null; } };

/** Ajoute aux compteurs d'un jour, sur place (un ping simultané n'efface pas
 *  l'autre) : une écriture D1 par mesure. */
async function bumpDaily(env, day, counts) {
    const entries = Object.entries(counts).filter(([, n]) => n > 0);
    if (!entries.length) return;
    await ensureSchema(env);
    await env.DB.batch(entries.map(([metric, n]) => env.DB.prepare(
        `INSERT INTO stats_day (day, metric, n) VALUES (?1, ?2, ?3)
         ON CONFLICT(day, metric) DO UPDATE SET n = n + excluded.n`).bind(day, metric, n)));
    // De temps en temps, ménage au-delà de 120 jours.
    if (Math.random() < 0.01) {
        const old = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
        await env.DB.prepare(`DELETE FROM stats_day WHERE day < ?1`).bind(old).run();
    }
}
const alive = (now) => `(expires IS NULL OR expires > ${Number(now)})`;

function store(env) {
    const db = env.DB;
    const api = {
        async getWithMetadata(key, type) {
            await ensureSchema(env);
            const row = await db.prepare(`SELECT value, meta FROM kv WHERE key = ?1 AND ${alive(Date.now())}`).bind(key).first();
            if (row) {
                const json = type === 'json' || type?.type === 'json';
                let value = row.value;
                if (json) { try { value = JSON.parse(row.value); } catch (e) { value = null; } }
                return { value, metadata: parseMeta(row.meta) };
            }
            return { value: null, metadata: null };
        },
        async get(key, type) {
            return (await api.getWithMetadata(key, type)).value;
        },
        async put(key, value, opts = {}) {
            await ensureSchema(env);
            const ttl = Number(opts.expirationTtl) || 0;
            const expires = ttl > 0 ? Date.now() + ttl * 1000 : null;
            const meta = opts.metadata == null ? null : JSON.stringify(opts.metadata);
            await db.prepare(`INSERT INTO kv (key, value, meta, expires) VALUES (?1, ?2, ?3, ?4)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, meta = excluded.meta, expires = excluded.expires`)
                .bind(key, String(value ?? ''), meta, expires).run();
            // De temps en temps, ménage des entrées expirées (le KV le faisait seul).
            if (Math.random() < 0.02) await db.prepare(`DELETE FROM kv WHERE expires IS NOT NULL AND expires <= ?1`).bind(Date.now()).run();
        },
        async delete(key) {
            await ensureSchema(env);
            await db.prepare(`DELETE FROM kv WHERE key = ?1`).bind(key).run();
        },
        /** { keys: [{ name, metadata, expiration }], list_complete, cursor } — le curseur est la dernière clé. */
        async list({ prefix = '', limit = 1000, cursor } = {}) {
            await ensureSchema(env);
            const n = Math.min(1000, Math.max(1, Number(limit) || 1000));
            const { results } = await db.prepare(
                `SELECT key, meta, expires FROM kv
                 WHERE substr(key, 1, ?1) = ?2 AND key > ?3 AND ${alive(Date.now())}
                 ORDER BY key LIMIT ?4`).bind(prefix.length, prefix, cursor || '', n + 1).all();
            const rows = results || [];
            const page = rows.slice(0, n);
            return {
                keys: page.map((r) => ({ name: r.key, metadata: parseMeta(r.meta), expiration: r.expires ? Math.floor(r.expires / 1000) : undefined })),
                list_complete: rows.length <= n,
                cursor: rows.length > n ? page[page.length - 1].key : undefined,
            };
        },
    };
    return api;
}

// ── Réglages par variables d'environnement (auto-hébergement) ─────────────
// ADMIN_TWITCH_IDS : identifiants Twitch admins, séparés par des virgules
//                    (tableau de bord de Cloudflare, ou docker-compose.yml).
// OFFICIAL_ADMIN_TWITCH_IDS : ceux de l'instance officielle (wrangler.toml),
//                    quand ADMIN_TWITCH_IDS manque. Un nom à part : une
//                    variable du toml qui porterait le nom d'un secret ou
//                    d'une variable du tableau de bord le remplacerait au
//                    déploiement. L'image Docker ne la pose pas : sans
//                    ADMIN_TWITCH_IDS, aucun admin.
// SITE_ORIGINS     : origines du site dont les comptages sont acceptés
//                    (absente : celles du site officiel).
let envApplied = false;
function applyEnvConfig(env) {
    if (envApplied) return;
    envApplied = true;
    const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
    const admins = list(env?.ADMIN_TWITCH_IDS).length ? list(env.ADMIN_TWITCH_IDS) : list(env?.OFFICIAL_ADMIN_TWITCH_IDS);
    if (admins.length) ADMIN_IDS = admins.filter((x) => /^\d{1,20}$/.test(x));
    if (list(env?.SITE_ORIGINS).length) USAGE_ORIGINS = list(env.SITE_ORIGINS);
}

// ── Tâche planifiée en Docker ──────────────────────────────────────────────
// Hors de Cloudflare, pas de Cron Trigger : docker/entrypoint.sh appelle
// POST /api/cron chaque minute avec CRON_SECRET, tiré au hasard à chaque
// démarrage du conteneur et connu de lui seul. Avant, wrangler l'exposait sur
// /__scheduled (--test-scheduled), ouvert à tous sur le port publié :
// n'importe qui déclenchait la tâche à volonté, et des passages qui se
// chevauchaient pouvaient doubler les notifications. La réponse n'arrive
// qu'une fois la tâche finie : la boucle ne relance jamais avant. Sans
// secret (Cloudflare), la route n'existe pas ; avec, scheduled() ne fait
// plus rien (wrangler dev la sert aussi sur /cdn-cgi/local/scheduled).
const dockerCron = (env) => String(env?.CRON_SECRET || '').length >= 16;

async function handleCron(request, env) {
    const secret = String(env.CRON_SECRET || '');
    if (!dockerCron(env)) return new Response("Not Found", { status: 404, headers: RESPONSE_HEADERS });
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
    // Empreintes comparées : la durée de la comparaison n'apprend rien du secret.
    if (await sha256hex(request.headers.get('Authorization') || '') !== await sha256hex(`Bearer ${secret}`)) {
        return jsonError('Accès refusé', 403);
    }
    const runs = await Promise.allSettled([pushTick(env), relayWatch(env, new Date())]);
    for (const r of runs) if (r.status === 'rejected') console.error(r.reason);
    return jsonResponse({ ok: true });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Notifications de live du site installé (Web Push)
//
//  Le navigateur s'abonne auprès de son service de push (Apple, Google,
//  Mozilla, Microsoft) et nous confie l'adresse d'envoi, ses clés, et les
//  chaînes suivies. Toutes les 2 minutes (tâche planifiée, `scheduled`), on
//  demande à Twitch lesquelles sont en live, 100 par requête GQL ; une chaîne
//  qui vient de démarrer met une notification en file pour chacun de ceux qui
//  la suivent. Envoi chiffré (RFC 8291, aes128gcm) et signé (VAPID, RFC 8292).
//
//  Coût : une exécution par minute (la détection une minute sur deux), quel
//  que soit le nombre d'abonnés. L'offre gratuite borne chaque exécution
//  (~10 ms de calcul, 50 requêtes sortantes) et un envoi coûte ~0,7 ms : la
//  file étale les envois (~480 par heure), le reste part aux suivantes.
//  Les clés VAPID sont créées au premier besoin et gardées en D1.
//
//  App iOS : pas de push Apple sans compte développeur payant ; elle passe par
//  ntfy (app gratuite). Un abonné peut donc aussi être un sujet ntfy secret,
//  créé par l'app : message en clair publié sur ntfy.sh (presque rien à
//  calculer), qui ouvre le direct dans l'app (twitchunblock://live/<chaîne>).
//  ntfy.sh gratuit : 250 messages par jour et par adresse IP. Or les Workers
//  sortent tous par les mêmes adresses, déjà à court : ntfy.sh leur répond
//  429. Avec la variable NTFY_RELAY, les messages partent donc du relais du
//  VPS (docker/relay.mjs), en un lot signé par la clé VAPID de ce Worker ;
//  relais en panne, ils attendent (pas d'envoi direct, refusé de toute
//  façon). Le secret facultatif NTFY_TOKEN (offre payante de ntfy, comptée
//  par compte et non par adresse) fait publier en direct, comme l'image
//  Docker.
// ═══════════════════════════════════════════════════════════════════════════
const PUSH_HOSTS = /(^|\.)(push\.apple\.com|fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/;
const PUSH_MAX_CHANNELS = 500;
const PUSH_GQL_PER_RUN = 12;      // 1 200 chaînes vérifiées par passage
// Offre gratuite : ~10 ms de calcul par exécution, et chaque envoi coûte
// un échange de clés et un chiffrement (~0,7 ms). Moins d'envois quand la
// même exécution a déjà lu les lives.
const PUSH_SENDS_PER_RUN = 12;
const PUSH_SENDS_WITH_CHECK = 4;
// ntfy : un message en clair, en plus des envois web. ntfy.sh accepte une
// requête toutes les 5 s par adresse (60 d'avance) : 12 par passage. En
// direct, 12 requêtes sortantes (+ 12 lectures GQL + 4 web, sous les 50 de
// l'offre gratuite) ; par le relais, une seule.
const PUSH_NTFY_PER_RUN = 12;
const NTFY_URL = 'https://ntfy.sh';
/** Après un refus de ntfy.sh (429), plus d'envoi ntfy pendant 5 minutes —
 *  ou jusqu'à minuit UTC, sa remise à zéro, quand le quota du jour est
 *  atteint (code d'erreur 42908). */
const NTFY_PAUSE = 5 * 60 * 1000;
const NTFY_DAILY_QUOTA = 42908;
/** ntfy.sh gratuit : messages par jour et par adresse (affiché dans /stats). */
const NTFY_FREE_DAILY = 250;
/** Sujet ntfy sans nouvelles de l'app depuis 60 jours (désinstallée…) : oublié. */
const NTFY_IDLE = 60 * 86400000;
const PUSH_QUEUE_TTL = 30 * 60 * 1000;
// Quota de ntfy.sh (NTFY_FREE_DAILY messages par jour, pour toute l'app iOS) :
// un test publiait sur n'importe quel sujet, et des sujets factices abonnés
// à des chaînes populaires le vidaient pour tout le monde jusqu'à minuit
// (UTC). Les limites par adresse ne tiennent qu'en mémoire d'une instance :
// ces plafonds-ci sont des compteurs du jour gardés en D1 (table kv, oubliés
// le lendemain). La part d'une personne est comptée dans l'une des 65 536
// cases tirées de l'empreinte du jour et de son adresse, comme pour les
// photos des retours : la base ne garde aucune adresse.
const NTFY_NEW_PER_PERSON = 5;     // nouveaux sujets par jour et par adresse (/64 en IPv6)
const NTFY_NEW_PER_DAY = 40;       // nouveaux sujets par jour, en tout
const NTFY_TESTS_PER_TOPIC = 5;    // tests par jour et par sujet
const NTFY_TESTS_PER_DAY = 40;     // tests par jour, en tout
const NTFY_LIVES_PER_TOPIC = 30;   // notifications de live par jour et par sujet
const PUSH_TEXT = {
    fr: { live: (n) => `${n} est en live`, test: 'Les notifications de live fonctionnent.' },
    en: { live: (n) => `${n} is live`, test: 'Live notifications are working.' },
    es: { live: (n) => `${n} está en directo`, test: 'Las notificaciones de directos funcionan.' },
    ru: { live: (n) => `${n} в эфире`, test: 'Уведомления о трансляциях работают.' },
};
const pushHits = new Map();

const b64u = {
    enc: (buf) => {
        const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
        let s = '';
        for (const b of bytes) s += String.fromCharCode(b);
        return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    dec: (str) => {
        const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
        return Uint8Array.from(atob(s + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
    },
};
const concatBytes = (...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
};

/** Clés VAPID (ECDSA P-256) : créées une fois, gardées dans la table kv. */
let vapidCache = null;
async function vapidKeys(env) {
    if (vapidCache) return vapidCache;
    await ensureSchema(env);
    const read = async () => {
        const v = await env.DB.prepare(`SELECT value FROM kv WHERE key = 'push_vapid'`).first('value');
        return v ? JSON.parse(v) : null;
    };
    let keys = await read();
    if (!keys) {
        const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
        const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
        const pub = b64u.enc(await crypto.subtle.exportKey('raw', pair.publicKey));
        await env.DB.prepare(`INSERT OR IGNORE INTO kv (key, value) VALUES ('push_vapid', ?1)`)
            .bind(JSON.stringify({ jwk, pub })).run();
        keys = await read();   // deux créations simultanées : la première gagne
    }
    vapidCache = keys;
    return keys;
}

/** En-tête Authorization VAPID : jeton signé pour le service de push visé,
 *  valable 12 h — réutilisé 11 h pour tous ses abonnés (une signature de
 *  moins par envoi). */
const vapidJwts = new Map();   // origine du service de push → { value, until }
async function vapidAuthorization(endpoint, keys) {
    const aud = new URL(endpoint).origin;
    const hit = vapidJwts.get(aud);
    if (hit && hit.until > Date.now() && hit.pub === keys.pub) return hit.value;
    const jwt = await vapidJwt(keys, {
        aud,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: 'https://twitchunblock.vercel.app',
    });
    const value = `vapid t=${jwt}, k=${keys.pub}`;
    vapidJwts.set(aud, { value, pub: keys.pub, until: Date.now() + 11 * 3600 * 1000 });
    return value;
}

/** Jeton JWT signé par la clé VAPID (ES256) : pour les services de push, et
 *  pour les lots ntfy confiés au relais. */
async function vapidJwt(keys, claims) {
    const enc = new TextEncoder();
    const header = b64u.enc(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
    const body = b64u.enc(enc.encode(JSON.stringify(claims)));
    const key = await crypto.subtle.importKey('jwk', keys.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${body}`));
    return `${header}.${body}.${b64u.enc(sig)}`;
}

async function hkdf(salt, ikm, info, length) {
    const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** Corps chiffré pour un abonnement (RFC 8291) : un seul enregistrement.
 *  `local` et `salt` ne servent qu'aux vecteurs de test de la RFC. */
async function encryptPush(sub, text, local = null, salt = null) {
    const enc = new TextEncoder();
    const uaPublic = b64u.dec(sub.p256dh);
    const authSecret = b64u.dec(sub.auth);
    local ??= await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
    const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
    const ikm = await hkdf(authSecret, ecdh, concatBytes(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
    salt ??= crypto.getRandomValues(new Uint8Array(16));
    const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
    const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
    // Délimiteur 0x02 : dernier (et seul) enregistrement.
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key,
        concatBytes(enc.encode(text), new Uint8Array([2]))));
    const head = new Uint8Array(21);
    head.set(salt, 0);
    new DataView(head.buffer).setUint32(16, 4096);
    head[20] = asPublic.length;
    return concatBytes(head, asPublic, cipher);
}

/** Envoie une notification ; code HTTP du service de push (0 : injoignable). */
async function sendPush(env, sub, payload) {
    try {
        const keys = await vapidKeys(env);
        const res = await fetch(sub.endpoint, {
            method: 'POST',
            headers: {
                Authorization: await vapidAuthorization(sub.endpoint, keys),
                'Content-Encoding': 'aes128gcm',
                'Content-Type': 'application/octet-stream',
                TTL: '1800',
                Urgency: 'high',
            },
            body: await encryptPush(sub, JSON.stringify(payload)),
        });
        return res.status;
    } catch (e) {
        return 0;
    }
}

const pushIdOf = async (text) => {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(d)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** Abonnement envoyé par le site : service de push connu, clés au bon format. */
function readPushSubscription(body) {
    const s = body?.subscription;
    const endpoint = String(s?.endpoint || '');
    const p256dh = String(s?.keys?.p256dh || '');
    const auth = String(s?.keys?.auth || '');
    let host = '';
    try { const u = new URL(endpoint); if (u.protocol === 'https:') host = u.hostname; } catch (e) {}
    if (!host || !PUSH_HOSTS.test(host) || endpoint.length > 1000) return null;
    if (!/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) return null;
    return { endpoint, p256dh, auth };
}

/** Abonnement de l'app iOS : sujet ntfy secret créé par elle. */
function readNtfySubscription(body) {
    const topic = String(body?.ntfy || '');
    if (!/^tu-[a-z0-9]{20,40}$/.test(topic)) return null;
    return { kind: 'ntfy', endpoint: `${NTFY_URL}/${topic}`, p256dh: '', auth: '' };
}

const ntfyTopic = (sub) => sub.endpoint.slice(NTFY_URL.length + 1);

/** Voie des messages ntfy : le relais (NTFY_RELAY, sans NTFY_TOKEN), sinon
 *  en direct. */
const ntfyRoute = (env) => (env.NTFY_RELAY && !env.NTFY_TOKEN ? 'relay' : 'direct');

/** Messages ntfy ({ topic, title, message, click, tags }), par la voie de
 *  ntfyRoute. Pour chacun, dans l'ordre : { status } de ntfy.sh (0 :
 *  injoignable) et, pour un 429, son code d'erreur (`code`). Relais en
 *  panne : 503 et sa raison (`relay`), sans envoi direct en secours —
 *  depuis Cloudflare, ntfy.sh le refuserait, et sa pause bloquerait le
 *  relais revenu. */
async function sendNtfy(env, msgs) {
    msgs = msgs.map((m) => ({ priority: 4, ...m }));
    if (ntfyRoute(env) === 'relay') return ntfyViaRelay(env, msgs);
    const out = [];
    for (const msg of msgs) {
        // À la suite, pas en rafale ; après un refus, le reste attend.
        if (out.at(-1)?.status === 429) { out.push(out.at(-1)); continue; }
        try {
            // JSON : titres en UTF-8 sans souci d'en-têtes.
            const res = await fetch(NTFY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json',
                           ...(env.NTFY_TOKEN ? { Authorization: `Bearer ${env.NTFY_TOKEN}` } : {}) },
                body: JSON.stringify(msg),
            });
            const err = res.status === 429 ? await res.json().catch(() => null) : null;
            out.push({ status: res.status, code: Number(err?.code) || 0 });
        } catch (e) {
            out.push({ status: 0, code: 0 });
        }
    }
    return out;
}

/** Lot confié au relais (POST NTFY_RELAY/ntfy), qui le publie depuis sa
 *  propre adresse. Jeton signé par la clé VAPID : empreinte du corps,
 *  5 minutes de validité, identifiant unique ; le relais le vérifie avec la
 *  clé publique de ce Worker (/api/push/key) et ne l'accepte qu'une fois. */
async function ntfyViaRelay(env, msgs) {
    let failure;
    try {
        const body = JSON.stringify({ messages: msgs });
        const sha = b64u.enc(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)));
        // jti : deux lots identiques dans la même seconde (deux appuis sur
        // « Tester ») avaient le même jeton, et le relais refusait le second
        // comme rejoué. Les anciens relais l'ignorent.
        const jwt = await vapidJwt(await vapidKeys(env), { exp: Math.floor(Date.now() / 1000) + 300, sha, jti: crypto.randomUUID() });
        const res = await fetch(`${String(env.NTFY_RELAY).trim().replace(/\/+$/, '')}/ntfy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
            body,
        });
        const out = res.ok ? (await res.json().catch(() => null))?.results : null;
        if (Array.isArray(out) && out.length === msgs.length && out.every((r) => Number.isInteger(r?.status))) return out;
        failure = res.ok ? 'réponse inattendue' : `HTTP ${res.status}`;
    } catch (e) {
        failure = 'injoignable';
    }
    console.warn('ntfy : relais en échec,', failure);
    return msgs.map(() => ({ status: 503, code: 0, relay: failure }));
}

/** Refus de ntfy.sh (429) : envois ntfy en pause (voir NTFY_PAUSE), pour la
 *  voie refusée seulement (relais ou direct). */
async function ntfyPause(env, code) {
    const now = Date.now();
    const until = code === NTFY_DAILY_QUOTA ? (Math.floor(now / 86400000) + 1) * 86400000 + 60000 : now + NTFY_PAUSE;
    await env.DB.prepare(`INSERT INTO kv (key, value) VALUES ('push_ntfy_pause', ?1)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify({ until, via: ntfyRoute(env), code: code || 0 })).run();
}

/** Résultat d'un envoi → compteur du jour pour /stats (pu_<issue>_<voie>). */
function pushCount(counts, kind, r) {
    const issue = r.status >= 200 && r.status < 300 ? 'ok' : r.relay ? 'relay' : r.status === 429 ? 'limit'
        : kind === 'web' && (r.status === 404 || r.status === 410) ? 'gone' : 'fail';
    counts[`pu_${issue}_${kind}`] = (counts[`pu_${issue}_${kind}`] || 0) + 1;
    return counts;
}

/** Compteurs du jour (UTC) des notifications, sans faire échouer l'envoi. */
async function pushStats(env, counts) {
    try { await bumpDaily(env, new Date().toISOString().slice(0, 10), counts); }
    catch (e) { console.warn('stats_day :', e.message); }
}

/** Fin de la pause sur la voie actuelle, 0 sans pause. */
async function ntfyPausedUntil(env) {
    const raw = await env.DB.prepare(`SELECT value FROM kv WHERE key = 'push_ntfy_pause'`).first('value');
    let p = null;
    try { p = JSON.parse(raw); } catch (e) {}
    return p?.via === ntfyRoute(env) && p.until > Date.now() ? p.until : 0;
}

/** Clé D1 d'un compteur du jour (UTC) des plafonds ntfy. */
const ntfyLimitKey = (name) => `lim:${name}:${new Date().toISOString().slice(0, 10)}`;

/** Ajoute à ces compteurs du jour ([nom, quantité]) et rend leurs nouvelles
 *  valeurs, d'un coup (RETURNING) : lus avant d'écrire, des requêtes
 *  simultanées passaient ensemble. */
async function bumpNtfyLimits(env, entries) {
    const expires = (Math.floor(Date.now() / 86400000) + 1) * 86400000;
    const res = await env.DB.batch(entries.map(([name, n]) => env.DB.prepare(
        `INSERT INTO kv (key, value, expires) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + ?2 RETURNING value`)
        .bind(ntfyLimitKey(name), n, expires)));
    return res.map((r) => Number(r?.results?.[0]?.value) || 0);
}

/** Une unité de chaque compteur [nom, plafond] si tous restent sous leur
 *  plafond ; sinon rien n'est compté, et false. */
async function takeNtfyLimits(env, limits) {
    const after = await bumpNtfyLimits(env, limits.map(([name]) => [name, 1]));
    if (after.every((v, i) => v <= limits[i][1])) return true;
    await bumpNtfyLimits(env, limits.map(([name]) => [name, -1])).catch(() => {});
    return false;
}

/** Valeurs du jour de ces compteurs (nom → nombre). */
async function readNtfyLimits(env, names) {
    const keys = names.map(ntfyLimitKey);
    const rows = (await env.DB.prepare(`SELECT key, value FROM kv WHERE key IN (SELECT value FROM json_each(?1))`)
        .bind(JSON.stringify(keys)).all()).results || [];
    const byKey = new Map(rows.map((r) => [r.key, Number(r.value) || 0]));
    return new Map(names.map((name, i) => [name, byKey.get(keys[i]) || 0]));
}

const pushLang = (l) => (PUSH_TEXT[l] ? l : 'en');

async function handlePushKey(env) {
    if (!env.DB) return jsonError('Indisponible', 503);
    return jsonResponse({ key: (await vapidKeys(env)).pub });
}

/** Abonnement (ou mise à jour des chaînes suivies). Une chaîne nouvelle pour
 *  le serveur est marquée « ? » : son état est lu sans notifier, sinon un
 *  live déjà en cours partirait comme un nouveau. */
async function handlePushSubscribe(request, env) {
    if (request.method !== 'POST' || !env.DB) return jsonError('Méthode non autorisée', 405);
    if (overLimit(pushHits, clientKey(request), 60)) return jsonError('Trop de requêtes', 429);
    const body = await request.json().catch(() => null);
    const sub = readPushSubscription(body) ?? readNtfySubscription(body);
    if (!sub) return jsonError('Abonnement invalide', 400);
    const channels = [...new Set((Array.isArray(body.channels) ? body.channels : [])
        .map((c) => String(c).toLowerCase()).filter((c) => LOGIN_RE.test(c)))].slice(0, PUSH_MAX_CHANNELS);
    const lang = pushLang(body.lang);
    await ensureSchema(env);
    const id = await pushIdOf(sub.endpoint);
    const hash = await pushIdOf(channels.slice().sort().join(','));
    const known = await env.DB.prepare('SELECT hash FROM push_subs WHERE id = ?1').bind(id).first();
    const old = known?.hash ?? null;
    // Nouveau sujet ntfy : plafonné par personne et en tout, chaque jour (voir
    // NTFY_NEW_PER_PERSON). Un sujet déjà connu (synchro quotidienne de
    // l'app, chaînes changées) ne compte pas.
    if (sub.kind === 'ntfy' && !known) {
        const day = new Date().toISOString().slice(0, 10);
        const mine = `ntn_${(await sha256hex(`ntfy|${day}|${clientKey(request)}`)).slice(0, 4)}`;
        if (!(await takeNtfyLimits(env, [[mine, NTFY_NEW_PER_PERSON], ['ntn', NTFY_NEW_PER_DAY]]))) {
            return jsonError('Trop de nouveaux sujets ntfy aujourd\'hui', 429);
        }
    }
    const now = Date.now();
    const ops = [env.DB.prepare(
        `INSERT INTO push_subs (id, kind, endpoint, p256dh, auth, lang, hash, created, updated)
         VALUES (?1, ?8, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT(id) DO UPDATE SET endpoint = excluded.endpoint, p256dh = excluded.p256dh,
           auth = excluded.auth, lang = excluded.lang, hash = excluded.hash, updated = excluded.updated`)
        .bind(id, sub.endpoint, sub.p256dh, sub.auth, lang, hash, now, sub.kind || 'web')];
    if (old !== hash) {
        const list = JSON.stringify(channels);
        ops.push(env.DB.prepare('DELETE FROM push_follow WHERE sub = ?1').bind(id));
        ops.push(env.DB.prepare('INSERT OR IGNORE INTO push_follow (login, sub) SELECT value, ?1 FROM json_each(?2)').bind(id, list));
        ops.push(env.DB.prepare(`INSERT OR IGNORE INTO push_live (login, stream) SELECT value, '?' FROM json_each(?1)`).bind(list));
    }
    await env.DB.batch(ops);
    return jsonResponse({ ok: true, channels: channels.length });
}

async function handlePushUnsubscribe(request, env) {
    if (request.method !== 'POST' || !env.DB) return jsonError('Méthode non autorisée', 405);
    const body = await request.json().catch(() => null);
    const endpoint = String(body?.subscription?.endpoint || readNtfySubscription(body)?.endpoint || '');
    if (!endpoint) return jsonError('Abonnement invalide', 400);
    await ensureSchema(env);
    const id = await pushIdOf(endpoint);
    await env.DB.batch([
        env.DB.prepare('DELETE FROM push_subs WHERE id = ?1').bind(id),
        env.DB.prepare('DELETE FROM push_follow WHERE sub = ?1').bind(id),
        env.DB.prepare('DELETE FROM push_queue WHERE sub = ?1').bind(id),
    ]);
    return jsonResponse({ ok: true });
}

/** Notification de test, envoyée tout de suite. */
async function handlePushTest(request, env) {
    if (request.method !== 'POST' || !env.DB) return jsonError('Méthode non autorisée', 405);
    if (overLimit(pushHits, clientKey(request), 60)) return jsonError('Trop de requêtes', 429);
    const body = await request.json().catch(() => null);
    const sub = readPushSubscription(body) ?? readNtfySubscription(body);
    if (!sub) return jsonError('Abonnement invalide', 400);
    const text = PUSH_TEXT[pushLang(body.lang)];
    if (sub.kind === 'ntfy') {
        // `limit` : ntfy.sh refuse les messages pour l'instant (l'app le dit
        // autrement qu'un serveur injoignable). `via` : relais ou direct.
        const via = ntfyRoute(env);
        const refused = (detail, status = 502) => new Response(JSON.stringify({ error: `ntfy.sh : ${detail}`, limit: true, via }),
            { status, headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json' } });
        await ensureSchema(env);
        // Seulement pour un sujet déjà abonné (l'app s'abonne avant de
        // proposer le test) : n'importe quel sujet passait, et quelques
        // centaines de tests vidaient le quota du jour pour toute l'app.
        const id = await pushIdOf(sub.endpoint);
        const known = await env.DB.prepare(`SELECT 1 AS ok FROM push_subs WHERE id = ?1 AND kind = 'ntfy'`).bind(id).first('ok');
        if (!known) return jsonError('Sujet ntfy inconnu : active d\'abord les notifications', 404);
        const paused = await ntfyPausedUntil(env);
        if (paused) return refused(`pause jusqu'à ${new Date(paused).toISOString().slice(11, 16)} UTC après un refus (429)`);
        // Tests plafonnés par sujet et en tout, chaque jour (`limit` : l'app
        // dit « réessaie plus tard »).
        if (!(await takeNtfyLimits(env, [[`ntt_${id}`, NTFY_TESTS_PER_TOPIC], ['ntt', NTFY_TESTS_PER_DAY]]))) {
            return refused('trop de tests aujourd\'hui', 429);
        }
        const [r] = await sendNtfy(env, [{ topic: ntfyTopic(sub), title: 'TwitchUnblock', message: text.test,
                                           click: 'twitchunblock://', tags: ['white_check_mark'] }]);
        await pushStats(env, pushCount({ pu_test: 1 }, 'ntfy', r));
        if (r.status >= 200 && r.status < 300) return jsonResponse({ ok: true, via });
        if (r.relay) return jsonError(`Relais ntfy : ${r.relay}`, 502);
        if (r.status !== 429) return jsonError(`ntfy.sh : ${r.status}`, 502);
        // Pause pour tous seulement quand ntfy.sh dit le quota du jour
        // atteint : le refus passager d'un test ne coupe plus les
        // notifications de live de tout le monde.
        if (r.code === NTFY_DAILY_QUOTA) await ntfyPause(env, r.code);
        return refused(`429${r.code ? ` (${r.code})` : ''}`);
    }
    const status = await sendPush(env, sub, { title: 'TwitchUnblock', body: text.test, tag: 'test', url: '/' });
    await pushStats(env, pushCount({ pu_test: 1 }, 'web', { status }));
    return status >= 200 && status < 300 ? jsonResponse({ ok: true }) : jsonError(`Service de push : ${status}`, 502);
}

/** Passage planifié (chaque minute) : une minute sur deux, lives démarrés
 *  → file d'attente ; à chaque fois, envois. */
async function pushTick(env) {
    if (!env.DB) return;
    await ensureSchema(env);
    const now = Date.now();
    const check = Math.floor(now / 60000) % 2 === 0;
    // Compteurs du jour pour /stats : une écriture D1 par mesure non nulle.
    const counts = {};
    if (check) await pushCheckLives(env, now, counts);
    await pushSend(env, check ? PUSH_SENDS_WITH_CHECK : PUSH_SENDS_PER_RUN, counts);
    await pushStats(env, counts);
}

/** Lives démarrés parmi les chaînes suivies → notifications en file. */
async function pushCheckLives(env, now, counts = {}) {
    const db = env.DB;

    // Qui est en live, parmi les chaînes suivies (par tranches, à tour de
    // rôle au-delà de PUSH_GQL_PER_RUN × 100 chaînes). La fenêtre avance
    // de PUSH_GQL_PER_RUN tranches à chaque vérification, pas d'une seule :
    // avec 20 tranches, une chaîne attendait jusqu'à 8 vérifications sans
    // être lue (~18 min) ; c'est au plus une maintenant (~4 min), jusqu'à
    // 2 × PUSH_GQL_PER_RUN tranches. Autant de requêtes qu'avant.
    const rows = (await db.prepare('SELECT login, stream FROM push_live').all()).results || [];
    const known = new Map(rows.map((r) => [r.login, r.stream]));
    const logins = [...known.keys()];
    const batches = Math.ceil(logins.length / 100);
    const first = batches > PUSH_GQL_PER_RUN ? (Math.floor(now / 120000) * PUSH_GQL_PER_RUN) % batches : 0;
    const changes = [];
    const started = [];
    for (let k = 0; k < Math.min(batches, PUSH_GQL_PER_RUN); k++) {
        const slice = logins.slice(((first + k) % batches) * 100, ((first + k) % batches) * 100 + 100);
        let users = [];
        try {
            const data = await twitchGQL(`query($logins: [String!]) { users(logins: $logins) {
                login displayName profileImageURL(width: 70) stream { id title game { displayName } } } }`, { logins: slice });
            users = data?.data?.users || [];
        } catch (e) { continue; }
        for (const u of users) {
            if (!u?.login) continue;
            const login = u.login.toLowerCase();
            const stream = u.stream?.id ? String(u.stream.id) : null;
            const before = known.get(login);
            if (stream === before) continue;
            changes.push([login, stream]);
            if (stream && before !== '?') {
                started.push({ login, name: u.displayName || login, title: u.stream.title || '',
                               game: u.stream.game?.displayName || '', icon: u.profileImageURL || '' });
            }
        }
    }
    const writes = [];
    if (changes.length) {
        writes.push(db.prepare(`INSERT INTO push_live (login, stream)
            SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?1) WHERE true
            ON CONFLICT(login) DO UPDATE SET stream = excluded.stream`).bind(JSON.stringify(changes)));
    }
    const queuedAt = writes.length;
    if (started.length) {
        writes.push(db.prepare(`INSERT INTO push_queue (sub, body, at)
            SELECT f.sub, j.value, ?2 FROM json_each(?1) j
            JOIN push_follow f ON f.login = json_extract(j.value, '$.login')`).bind(JSON.stringify(started), now));
    }
    writes.push(db.prepare('DELETE FROM push_queue WHERE at < ?1').bind(now - PUSH_QUEUE_TTL));
    const res = await db.batch(writes);
    if (started.length) {
        counts.pu_lives = started.length;
        counts.pu_queued = Number(res?.[queuedAt]?.meta?.changes) || 0;
    }
}

/** Envois en attente, `room` au plus. */
async function pushSend(env, room, counts = {}) {
    const db = env.DB;
    // ntfy en pause après un refus : ses messages attendent, sans retenir
    // ceux du site qui les suivent dans la file.
    const ntfyOn = !(await ntfyPausedUntil(env));
    // Au plus `room` notifications web (chiffrées) ; les ntfy en plus. Une
    // lecture par voie : avec une seule fenêtre commune, une file web
    // chargée ne laissait passer aucun ntfy, et des ntfy en attente (relais
    // en panne) bloquaient tout le web.
    const pick = (kind, n) => db.prepare(`SELECT q.id, q.body, s.id AS sid, s.kind, s.endpoint, s.p256dh, s.auth, s.lang
        FROM push_queue q JOIN push_subs s ON s.id = q.sub WHERE s.kind ${kind === 'ntfy' ? `= 'ntfy'` : `IS NOT 'ntfy'`}
        ORDER BY q.id LIMIT ?1`).bind(n);
    const lanes = await db.batch([pick('web', room), ...(ntfyOn ? [pick('ntfy', PUSH_NTFY_PER_RUN)] : [])]);
    const queue = lanes.flatMap((r) => r?.results || []);
    if (!queue.length) {
        // De temps en temps : chaînes que plus personne ne suit, sujets ntfy
        // dont l'app ne donne plus de nouvelles.
        if (Math.random() < 0.02) {
            const idle = Date.now() - NTFY_IDLE;
            await db.batch([
                db.prepare(`DELETE FROM push_follow WHERE sub IN (SELECT id FROM push_subs WHERE kind = 'ntfy' AND updated < ?1)`).bind(idle),
                db.prepare(`DELETE FROM push_subs WHERE kind = 'ntfy' AND updated < ?1`).bind(idle),
                db.prepare('DELETE FROM push_live WHERE login NOT IN (SELECT login FROM push_follow)'),
            ]);
        }
        return;
    }
    const done = [];
    const gone = [];
    const notice = (q) => {
        let live = {};
        try { live = JSON.parse(q.body); } catch (e) {}
        const title = PUSH_TEXT[pushLang(q.lang)].live(live.name || live.login);
        return { live, title, body: [live.title, live.game].filter(Boolean).join(' · ') };
    };
    // Envoyé, refusé pour de bon, ou injoignable : retiré de la file (un live
    // en retard de 30 minutes n'a plus d'intérêt). Refusé pour l'instant
    // (429) ou relais en panne (503) : il attend le passage suivant.
    const sendNtfyRows = async () => {
        let ntfyRows = queue.filter((q) => q.kind === 'ntfy');
        if (!ntfyRows.length) return;
        // Part de chaque sujet : au plus NTFY_LIVES_PER_TOPIC messages par
        // jour ; au-delà, retirés sans envoi. Sans elle, quelques sujets
        // factices abonnés à des chaînes populaires vidaient le quota commun.
        const sids = [...new Set(ntfyRows.map((q) => q.sid))];
        const used = await readNtfyLimits(env, sids.map((sid) => `ntl_${sid}`)).catch(() => new Map());
        const taken = new Map();
        ntfyRows = ntfyRows.filter((q) => {
            const n = (taken.get(q.sid) ?? used.get(`ntl_${q.sid}`) ?? 0) + 1;
            taken.set(q.sid, n);
            if (n <= NTFY_LIVES_PER_TOPIC) return true;
            done.push(q.id);
            return false;
        });
        if (!ntfyRows.length) return;
        const results = await sendNtfy(env, ntfyRows.map((q) => {
            const n = notice(q);
            return { topic: ntfyTopic(q), title: n.title, message: n.body || n.title,
                     click: `twitchunblock://live/${n.live.login}`, tags: ['red_circle'] };
        }));
        // Relais en panne : un essai compté, pas un par message — ils sont
        // retentés à chaque passage, jusqu'à 30 minutes.
        if (results.length && results.every((r) => r.relay)) pushCount(counts, 'ntfy', results[0]);
        const sent = new Map();
        results.forEach((r, i) => {
            if (!r.relay) pushCount(counts, 'ntfy', r);
            if (r.status !== 429 && r.status !== 503) done.push(ntfyRows[i].id);
            if (r.status >= 200 && r.status < 300) sent.set(ntfyRows[i].sid, (sent.get(ntfyRows[i].sid) || 0) + 1);
        });
        // Comptés une fois envoyés : un message retenté n'use pas deux fois sa part.
        if (sent.size) {
            await bumpNtfyLimits(env, [...sent].map(([sid, n]) => [`ntl_${sid}`, n]))
                .catch((e) => console.warn('ntfy : part des sujets non comptée,', e.message));
        }
        const refused = results.find((r) => r.status === 429);
        if (refused) await ntfyPause(env, refused.code);
    };
    await Promise.all([sendNtfyRows(), ...queue.filter((q) => q.kind !== 'ntfy').map(async (q) => {
        const n = notice(q);
        const status = await sendPush(env, q, { title: n.title, body: n.body, icon: n.live.icon || '',
                                                tag: `live-${n.live.login}`, url: `/${n.live.login}` });
        pushCount(counts, 'web', { status });
        // Abonnement expiré ou retiré par le navigateur : oublié.
        if (status === 404 || status === 410) gone.push(q.sid);
        if (status !== 429) done.push(q.id);
    })]);
    const cleanup = [db.prepare('DELETE FROM push_queue WHERE id IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(done))];
    if (gone.length) {
        const list = JSON.stringify(gone);
        cleanup.push(db.prepare('DELETE FROM push_subs WHERE id IN (SELECT value FROM json_each(?1))').bind(list));
        cleanup.push(db.prepare('DELETE FROM push_follow WHERE sub IN (SELECT value FROM json_each(?1))').bind(list));
        cleanup.push(db.prepare('DELETE FROM push_queue WHERE sub IN (SELECT value FROM json_each(?1))').bind(list));
    }
    await db.batch(cleanup);
}
