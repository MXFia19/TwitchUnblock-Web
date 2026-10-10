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
                case '/api/proxy': return await handleProxy(url, request);

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
                // Retours (bug, idée) du site et de l'app
                case '/api/feedback': return await handleFeedback(request, env, ctx);
                case '/api/feedback/thread': return await handleFeedbackThread(request, env);
                case '/api/feedback/reply': return await handleFeedbackReply(request, env, ctx);
                case '/api/feedback/photo': return await handleFeedbackPhoto(url, request, env);
                case '/api/admin/feedback': return await handleAdminFeedback(request, env);

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
    
    let m3u8Content = "";
    let masterUrl = "";

    try {
        // --- TENTATIVE 1 : Luminous API (Filtre Anti-Pub) ---
        // fast_bread : chaque playlist annonce en plus les deux prochains
        // segments (« EXT-X-TWITCH-PREFETCH »), dont le lecteur du site se
        // sert pour coller au direct. Miroir asiatique d'abord, comme avant et
        // comme l'app : l'européen renvoie des listes au format des serveurs
        // IVS, où le choix « Source » donnait un écran noir chez des
        // utilisateurs. Il reste en secours (variantName lit les deux formats).
        let resLuminous = null;
        for (const host of ['as.luminous.dev', 'eu.luminous.dev']) {
            try {
                const r = await fetch(`https://${host}/live/${login}?allow_source=true&allow_audio_only=true&fast_bread=true`, { headers: getRequestHeaders(login) });
                if (r.ok) { resLuminous = r; break; }
            } catch (err) { /* miroir suivant */ }
        }
        if (resLuminous) {
            m3u8Content = await resLuminous.text();
            masterUrl = resLuminous.url;
        } else {
            throw new Error("Luminous down");
        }
    } catch(e) {
        // --- TENTATIVE 2 : Plan de Secours Officiel Twitch ---
        try {
            const token = await getAccessToken(login, true); if (!token) return jsonError("Offline", 404);
            const resUsher = await fetch(`https://usher.ttvnw.net/api/channel/hls/${login}.m3u8?allow_source=true&allow_audio_only=true&allow_spectre=true&fast_bread=true&player=twitchweb&playlist_include_framerate=true&segment_preference=4&sig=${encodeURIComponent(token.signature)}&token=${encodeURIComponent(token.value)}`, { headers: REQUEST_HEADERS });
            if (!resUsher.ok) throw new Error("Stream introuvable");
            m3u8Content = await resUsher.text();
            masterUrl = resUsher.url;
        } catch(err) {
            return jsonError("Offline ou introuvable", 404);
        }
    }

    // Découpage du fichier M3U8 avec notre Proxy
    const links = parseAndProxyM3U8(m3u8Content, masterUrl, workerOrigin, false, useProxy);
    
    // Récupération des infos du stream (Titre, Jeu, Avatar) pour un bel affichage
    try {
        const meta = await twitchGQL(`query($login: String!) { user(login: $login) { profileImageURL(width: 70) broadcastSettings { title game { displayName } } } }`, { login });
        const info = meta.data?.user?.broadcastSettings, avatar = meta.data?.user?.profileImageURL;
        return jsonResponse({ links, best: links["Source"] || links["Auto"], title: info?.title || "Live", game: info?.game?.displayName || "", thumbnail: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-640x360.jpg`, avatar: avatar || "" });
    } catch(e) {
        // Si l'API GQL bug, on renvoie la vidéo quand même
        return jsonResponse({ links, best: links["Source"] || links["Auto"], title: "Live", game: "", thumbnail: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-640x360.jpg`, avatar: "" });
    }
}

async function handleGetM3U8(url, workerOrigin) {
    const vodId = url.searchParams.get('id') || ''; if (!VOD_ID_RE.test(vodId)) return jsonError("ID invalide", 400);
    const useProxy = url.searchParams.get('proxy') !== 'false';
    
    // --- 1. Tentative Normale ---
    try {
        const token = await getAccessToken(vodId, false);
        if (token) {
            const res = await fetch(`https://usher.ttvnw.net/vod/${vodId}.m3u8?nauth=${encodeURIComponent(token.value)}&nauthsig=${encodeURIComponent(token.signature)}&allow_source=true&player_backend=mediaplayer`, { headers: REQUEST_HEADERS });
            if (res.ok) { 
                const links = parseAndProxyM3U8(await res.text(), res.url, workerOrigin, true, useProxy); 
                return jsonResponse({ links, best: links["Source"] || links["Auto"] }); 
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
                let finalLinks = {}; 
                // « Auto » = la meilleure qualité trouvée (l'ordre des réponses était aléatoire).
                const top = rawLinks[QUALITY_ORDER.find(q => rawLinks[q])];
                finalLinks["Auto"] = useProxy ? `${workerOrigin}/api/proxy?url=${encodeURIComponent(top)}&isVod=true` : top;
                
                ['Source', '1080p60', '1080p30', '720p60', '720p30', '480p30', '360p30', '160p30', 'audio_only'].forEach(key => { 
                    Object.keys(rawLinks).forEach(k => { 
                        if (k.toLowerCase().includes(key.toLowerCase())) { 
                            finalLinks[k] = useProxy ? `${workerOrigin}/api/proxy?url=${encodeURIComponent(rawLinks[k])}&isVod=true` : rawLinks[k]; 
                            delete rawLinks[k]; 
                        } 
                    }); 
                });
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
async function handleRecoverList(url) {
    const channel = (url.searchParams.get('channel') || '').toLowerCase();
    if (!LOGIN_RE.test(channel)) return jsonError('Chaîne invalide', 400);
    let arr;
    try {
        const r = await fetch(`https://api.vodvod.top/channels/@${channel}`,
            { headers: { 'User-Agent': REQUEST_HEADERS['User-Agent'], Accept: 'application/json' } });
        if (!r.ok) return jsonResponse({ streams: [] });
        arr = await r.json();
    } catch (e) { return jsonResponse({ streams: [] }); }
    const streams = (Array.isArray(arr) ? arr : []).map((it) => {
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
const PROXY_HOSTS = ['ttvnw.net', 'jtvnw.net', 'twitch.tv', 'cloudfront.net', 'luminous.dev', 'twitchcdn.net'];
function proxyAllowed(target) {
    try {
        const u = new URL(target);
        if (u.protocol !== 'https:') return false;
        if (!PROXY_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h))) return false;
        // N'importe qui peut héberger des fichiers sur cloudfront.net : on n'y
        // accepte que les dossiers de VOD Twitch (« <empreinte>_<chaîne>_… »).
        if (u.hostname.endsWith('.cloudfront.net')) return /^\/[0-9a-f]{20}_/.test(u.pathname);
        return true;
    } catch (e) { return false; }
}

async function handleProxy(url, request) {
    const target = url.searchParams.get('url'); if (!target) return new Response("URL manquante", { status: 400, headers: RESPONSE_HEADERS });
    if (!proxyAllowed(target)) return new Response("Hôte non autorisé", { status: 403, headers: RESPONSE_HEADERS });
    const isVod = url.searchParams.get('isVod') === 'true', workerOrigin = url.origin;

    let fetchHeaders = { ...REQUEST_HEADERS };
    if (request.headers.get("Range")) fetchHeaders["Range"] = request.headers.get("Range");

    const res = await fetch(target, { headers: fetchHeaders });
    const newHeaders = new Headers(res.headers);
    newHeaders.set("Access-Control-Allow-Origin", "*");
    newHeaders.set("Access-Control-Expose-Headers", "*");
    newHeaders.delete("Set-Cookie");

    // Playlist reconnue à son type, pas seulement à son extension : celles
    // de Luminous (« /live/<chaîne>?allow_source=true ») et les variantes
    // qu'elles listent (« …playlist.ttvnw.net/v1/playlist/… ») n'ont pas de
    // « .m3u8 ». Non reconnues, elles passaient sans réécriture.
    const type = res.headers.get('content-type') || '';
    if (target.includes('.m3u8') || /mpegurl/i.test(type)) {
        newHeaders.set("Content-Type", "application/vnd.apple.mpegurl");
        const finalUrl = res.url, base = finalUrl.substring(0, finalUrl.lastIndexOf('/') + 1);
        const proxyUrl = (full) => `${workerOrigin}/api/proxy?url=${encodeURIComponent(full)}&isVod=${isVod}`;
        // Une sous-playlist passe TOUJOURS par le proxy : ses jetons sont liés
        // à l'adresse IP qui l'a demandée — celle du Worker ou de Luminous —,
        // et le navigateur s'y faisait refuser (403). Les segments d'un
        // direct, eux, partent en direct : leur CDN accepte tout le monde.
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
    return new Response(res.body, { status: res.status, headers: newHeaders });
}

// --- FONCTIONS UTILITAIRES ---
// Nom de chaque qualité, dans les deux formats de playlist maîtresse :
// l'ancien (VIDEO="chunked", repris des lignes EXT-X-MEDIA) et celui des
// serveurs IVS que renvoie maintenant le miroir européen de Luminous
// (STABLE-VARIANT-ID="1080p60", IVS-VARIANT-SOURCE="source", sans
// EXT-X-MEDIA). Seul le premier était reconnu : le site n'affichait plus que
// « Auto ». La version d'origine garde le nom « Source » dans les deux cas,
// pour que la qualité retenue par chacun reste valable.
function variantName(streamInf) {
    const attr = (name) => (streamInf.match(new RegExp(`[:,]${name}="([^"]+)"`)) || [])[1];
    const name = attr('VIDEO') || attr('STABLE-VARIANT-ID') || attr('IVS-NAME') || '';
    return name === 'chunked' || attr('IVS-VARIANT-SOURCE') === 'source' ? 'Source' : name;
}

function parseAndProxyM3U8(content, master, workerOrigin, isVod, useProxy = true) { 
    const lines = content.split('\n'); const proxyBase = `${workerOrigin}/api/proxy?url=`; let unsorted = {}, last = ""; 
    lines.forEach(l => { 
        if (l.startsWith('#EXT-X-STREAM-INF')) { last = variantName(l); }
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
/** Comptes Twitch administrateurs (ID numérique : le pseudo peut changer). mxfia19 */
let ADMIN_IDS = ['839837720'];
const USAGE_RETENTION_DAYS = 35;
const PLATFORMS = ['ios', 'web'];
// Le site officiel : un ping « web » venu d'ailleurs (copie locale, tests,
// préversions) n'est pas compté. L'app iOS n'envoie pas d'en-tête Origin.
let USAGE_ORIGINS = ['https://twitchunblock.vercel.app', 'https://test2-fawn-eta.vercel.app'];
// Navigateurs automatisés et robots qui exécutent le JavaScript.
const BOT_UA = /headless|bot\b|crawler|spider|slurp|playwright|puppeteer|selenium|phantomjs|lighthouse|preview/i;

// POST /api/ping — { id, version, platform } enregistre ; { id, forget: true } efface.
async function handlePing(request, env) {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
    if (!env.DB) return jsonError("Base D1 'DB' non liée au Worker.", 500);
    let body;
    try { body = await request.json(); } catch (e) { return jsonError('JSON invalide', 400); }

    // Chaque ping est une écriture D1 (100 000 par jour en gratuit) : une même
    // adresse ne peut pas en enchaîner des centaines. Compté en mémoire
    // seulement, jamais stocké.
    if (pingFlood(request.headers.get('CF-Connecting-IP') || '')) return jsonError('Trop de requêtes', 429);

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
    const meta = { first: prev.first || day, last: day, days, v: version, p: platform, ps: platforms };
    if (who) { meta.k = 'a'; meta.l = who.login.slice(0, 25); }

    // Rien de neuf aujourd'hui : pas d'écriture.
    if (prev.last === day && prev.v === version && prev.ps === platforms && (!who || prev.l === meta.l)) {
        return jsonResponse({ ok: true, days, unchanged: true });
    }
    await store(env).put(key, '', { expirationTtl: 60 * 60 * 24 * USAGE_RETENTION_DAYS, metadata: meta });
    return jsonResponse({ ok: true, days, account: Boolean(who) });
}

const pingHits = new Map();   // adresse → { n, until } (mémoire de l'instance)
function pingFlood(ip) {
    const now = Date.now();
    const hit = pingHits.get(ip);
    if (!hit || hit.until < now) {
        if (pingHits.size > 5000) pingHits.clear();
        pingHits.set(ip, { n: 1, until: now + 60 * 60 * 1000 });
        return false;
    }
    return ++hit.n > 10;
}

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
    const blank = () => ({ today: 0, week: 0, month: 0, known: 0, returning: 0 });
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
    for (let i = 29; i >= 0; i--) daily[dayKey(i)] = { date: dayKey(i), newIos: 0, newWeb: 0, lastIos: 0, lastWeb: 0 };

    // list() renvoie les métadonnées sans lecture par clé ; 1000 clés par page.
    do {
        const page = await store(env).list({ prefix: USAGE_PREFIX, limit: 1000, cursor });
        for (const key of page.keys) {
            const meta = key.metadata || {};
            const then = Date.parse((meta.last || '') + 'T00:00:00Z');
            const age = Number.isNaN(then) ? Infinity : Math.floor((todayMs - then) / 86400000);
            // Une seule plateforme par identifiant : utilisé sur l'app ET le
            // site, il compte comme iOS (l'app est le vrai signe d'adoption).
            const plats = meta.ps ? String(meta.ps).split(',') : [meta.p || 'ios'];
            const plat = plats.includes('ios') || !plats.includes('web') ? 'ios' : 'web';
            const buckets = [platforms[plat]];
            const kind = meta.k === 'a' ? kinds.accounts : kinds.anonymous;
            for (const c of [total, kind, ...buckets]) {
                c.known++;
                if (age === 0) c.today++;
                if (age <= 7) c.week++;
                if (age <= 30) c.month++;
            }
            if (age <= 30) { const v = `${meta.p || 'ios'} ${meta.v || '?'}`; versions[v] = (versions[v] || 0) + 1; }
            const d = meta.days || 1;
            totalDays += d;
            if (d >= 2) { returning++; kind.returning++; for (const b of buckets) b.returning++; }
            if (d === 1) loyalty.once++; else if (d < 7) loyalty.few++; else if (d < 30) loyalty.regular++; else loyalty.daily++;
            if (meta.first && (!oldestFirst || meta.first < oldestFirst)) oldestFirst = meta.first;
            const p = plat === 'web' ? 'Web' : 'Ios';
            if (daily[meta.first]) daily[meta.first]['new' + p]++;
            if (daily[meta.last]) daily[meta.last]['last' + p]++;
        }
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    const payload = {
        ...total, platforms, accounts: kinds.accounts, anonymous: kinds.anonymous, returning, loyalty,
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
function jsonError(msg, status) { return new Response(JSON.stringify({ error: msg }), { status, headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json' } }); }

// ═══════════════════════════════════════════════════════════════════════════
//  Administration : réservé aux comptes de ADMIN_IDS (jeton Twitch vérifié).
// ═══════════════════════════════════════════════════════════════════════════
async function requireAdmin(request) {
    const who = await tokenIdentity(request);
    if (!who) return { denied: jsonError('Jeton Twitch manquant ou expiré', 401) };
    if (!ADMIN_IDS.includes(who.userId)) return { denied: jsonError('Réservé au propriétaire', 403) };
    return { who };
}

// GET /api/admin/me — suis-je administrateur ?
async function handleAdminMe(request) {
    const who = await tokenIdentity(request);
    return jsonResponse({ login: who?.login ?? null, admin: Boolean(who && ADMIN_IDS.includes(who.userId)) });
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
        return jsonResponse({ announcement, reactions: announcement ? await countReactions(env, announcement.id) : null });
    }
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
    let body;
    try { body = await request.json(); } catch (e) { return jsonError('JSON invalide', 400); }
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
//  photos jointes. Ni adresse IP ni compte Twitch stockés : ce que la personne
//  écrit, et les infos techniques affichées avant l'envoi.
// ═══════════════════════════════════════════════════════════════════════════
const FEEDBACK_PREFIX = 'fb_';
const FEEDBACK_PHOTO_PREFIX = 'fbimg_';
const FEEDBACK_KINDS = ['bug', 'idea', 'other'];
// nouveau → accepté → en cours → fait, ou refusé.
const FEEDBACK_STATUSES = ['new', 'accepted', 'progress', 'done', 'refused'];
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

/** Envoie vers Discord si le secret est posé, et note le résultat. */
function notifyDiscord(env, ctx, ...args) {
    const hook = env.FEEDBACK_WEBHOOK ? String(env.FEEDBACK_WEBHOOK) : '';
    const job = (hook ? postFeedbackToDiscord(hook, ...args) : Promise.resolve({ ok: false, status: 0, detail: 'missing' }))
        .then((r) => store(env).put(FEEDBACK_HOOK_KEY, '', { metadata: { ...r, at: Date.now() } }))
        .catch(() => {});
    if (ctx?.waitUntil) ctx.waitUntil(job);
    return job;
}

/** Plus de `max` requêtes dans l'heure pour cette adresse ? */
function overLimit(map, ip, max) {
    const now = Date.now();
    const hit = map.get(ip);
    if (!hit || hit.until < now) {
        if (map.size > 5000) map.clear();
        map.set(ip, { n: 1, until: now + 60 * 60 * 1000 });
        return false;
    }
    return ++hit.n > max;
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
        if (!s || s.length > FEEDBACK_MAX_PHOTO_B64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) continue;
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
    if (overLimit(feedbackHits, request.headers.get('CF-Connecting-IP') || '', 5)) {
        return jsonError('Trop de messages, réessaie dans une heure', 429);
    }

    let body;
    try { body = await request.json(); } catch (e) { return jsonError('JSON invalide', 400); }
    const message = cleanText(body.message, 2000);
    if (message.length < 5) return jsonError('Message trop court', 400);
    let info = body.info;
    if (info && typeof info === 'object') { try { info = JSON.stringify(info); } catch (e) { info = ''; } }
    const photos = cleanPhotos(body.photos);

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
    const hook = notifyDiscord(env, ctx, entry, photos);
    if (!ctx?.waitUntil) await hook;
    return jsonResponse({ ok: true, id: key, token });
}

// POST /api/feedback/thread — les retours de l'appareil (30 au plus).
async function handleFeedbackThread(request, env) {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
    if (!env.DB) return jsonError("Base D1 'DB' non liée au Worker.", 500);
    // Une discussion ouverte est relue toutes les 20 s (site et app) : 600
    // par heure et par adresse laissent de la marge à plusieurs appareils.
    if (overLimit(threadHits, request.headers.get('CF-Connecting-IP') || '', 600)) return jsonError('Trop de requêtes', 429);
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
    if (overLimit(replyHits, request.headers.get('CF-Connecting-IP') || '', 20)) {
        return jsonError('Trop de messages, réessaie dans une heure', 429);
    }
    let body;
    try { body = await request.json(); } catch (e) { return jsonError('JSON invalide', 400); }
    const id = String(body.id || '');
    const found = await ownedFeedback(env, id, body.token);
    if (!found) return jsonError('Retour introuvable', 404);
    const message = cleanText(body.message, 2000);
    const photos = cleanPhotos(body.photos);
    if (!message && !photos.length) return jsonError('Message vide', 400);
    const { meta, thread } = found;
    if (thread.length >= FEEDBACK_MAX_MESSAGES) return jsonError('Discussion trop longue', 409);

    const now = Date.now();
    const ph = await saveFeedbackPhotos(env, id, photos, meta.ph || 0);
    thread.push({ f: 'u', m: message, at: now, ...(ph.length ? { ph } : {}) });
    const next = { ...meta, u: now, r: 'u', n: (meta.n || 1) + 1, ph: (meta.ph || 0) + ph.length };
    await store(env).put(id, JSON.stringify(thread), { metadata: next, expirationTtl: FEEDBACK_TTL });
    const hook = notifyDiscord(env, ctx, { ...next, m: message }, photos, meta.m);
    if (!ctx?.waitUntil) await hook;
    return jsonResponse({ ok: true, item: publicFeedback(id, next, thread) });
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
 * Publie un retour — ou, avec `inReplyTo`, la réponse de la personne — dans
 * le salon Discord du webhook (sans mention possible), photos jointes.
 * Rend { ok, status, detail } : un refus de Discord n'est plus silencieux.
 */
async function postFeedbackToDiscord(webhook, e, photos = [], inReplyTo = null) {
    const hook = String(webhook).trim();
    if (!/^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\//.test(hook)) return { ok: false, status: 0, detail: 'invalid' };
    const KINDS = { bug: '🐞 Bug', idea: '💡 Idée', other: '💬 Autre' };
    const COLORS = { bug: 0xeb0400, idea: 0x9147ff, other: 0x6b7280 };
    const fields = [{ name: 'Plateforme', value: `${e.p === 'ios' ? 'App iOS' : 'Site'} · ${e.v}`, inline: true }];
    if (e.c) fields.push({ name: 'Contact', value: e.c, inline: true });
    if (inReplyTo) fields.push({ name: 'En réponse à', value: inReplyTo.slice(0, 300) });
    else if (e.i) fields.push({ name: 'Infos', value: readableInfo(e.i).slice(0, 1000) });
    const payload = {
        username: 'TwitchUnblock',
        allowed_mentions: { parse: [] },
        embeds: [{
            title: inReplyTo ? `↩️ Réponse · ${KINDS[e.k] || KINDS.other}` : (KINDS[e.k] || KINDS.other),
            description: (e.m || '📷').slice(0, 4000),
            color: COLORS[e.k] ?? COLORS.other,
            fields,
            footer: { text: 'Répondre depuis /stats' },
            timestamp: new Date(e.u || e.at).toISOString(),
        }],
    };
    try {
        let res;
        if (photos.length) {
            const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
            const form = new FormData();
            form.append('payload_json', JSON.stringify(payload));
            photos.forEach((p, i) => form.append(`files[${i}]`, new Blob([b64Bytes(p.b64)], { type: p.type }), `photo${i + 1}.${ext[p.type] || 'jpg'}`));
            res = await fetch(hook, { method: 'POST', body: form });
        } else {
            res = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        }
        if (res.ok) return { ok: true, status: res.status };
        // Réponse de Discord (« Unknown Webhook », limite…), sans balises HTML.
        let detail = '';
        try { detail = (await res.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200); } catch (err) {}
        return { ok: false, status: res.status, detail };
    } catch (err) {
        // Discord injoignable : le retour reste dans D1.
        return { ok: false, status: 0, detail: String(err?.message || err).slice(0, 200) };
    }
}

// GET  /api/admin/feedback          — les retours, du plus récent au plus ancien.
// GET  /api/admin/feedback?key=fb_… — un retour et sa discussion.
// POST /api/admin/feedback — { reply: { key, message, photos? } },
//      { status: { key, status } }, { delete: '<clé>' } ou { clear: true }.
async function handleAdminFeedback(request, env) {
    const { denied } = await requireAdmin(request);
    if (denied) return denied;
    const listAll = async (prefix) => {
        const out = [];
        let cursor;
        do {
            const page = await store(env).list({ prefix, limit: 1000, cursor });
            out.push(...page.keys);
            cursor = page.list_complete ? undefined : page.cursor;
        } while (cursor && out.length < 5000);
        return out;
    };
    const summary = (key, m) => ({
        key, kind: m.k || 'other', message: m.m || '', contact: m.c || null, platform: m.p || '?',
        version: m.v || '?', info: m.i || null, at: m.at || 0,
        status: m.s || 'new', updatedAt: m.u || m.at || 0, lastFrom: m.r || 'u', count: m.n || 1, photos: m.ph || 0,
    });
    const noStore = { ...RESPONSE_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

    if (request.method === 'POST') {
        let body;
        try { body = await request.json(); } catch (e) { return jsonError('JSON invalide', 400); }

        // Réponse ou nouvel état : ajoutés à la discussion, que la personne lit
        // dans l'app ou sur le site.
        const target = body.reply?.key ?? body.status?.key;
        if (typeof target === 'string') {
            if (!FEEDBACK_KEY_RE.test(target)) return jsonError('Clé invalide', 400);
            const { value, metadata } = await store(env).getWithMetadata(target);
            if (!metadata) return jsonError('Retour introuvable', 404);
            const thread = feedbackThread(value, metadata);
            if (thread.length >= FEEDBACK_MAX_MESSAGES) return jsonError('Discussion trop longue', 409);
            const now = Date.now();
            const next = { ...metadata, u: now, r: 'a' };
            if (body.reply) {
                const message = cleanText(body.reply.message, 2000);
                const photos = cleanPhotos(body.reply.photos);
                if (!message && !photos.length) return jsonError('Message vide', 400);
                const ph = await saveFeedbackPhotos(env, target, photos, metadata.ph || 0);
                thread.push({ f: 'a', m: message, at: now, ...(ph.length ? { ph } : {}) });
                next.n = (metadata.n || 1) + 1;
                next.ph = (metadata.ph || 0) + ph.length;
            } else {
                const status = String(body.status.status || '');
                if (!FEEDBACK_STATUSES.includes(status)) return jsonError('État inconnu', 400);
                if (status === (metadata.s || 'new')) return jsonResponse({ ok: true, item: summary(target, metadata), thread });
                thread.push({ f: 'a', s: status, at: now });
                next.s = status;
            }
            await store(env).put(target, JSON.stringify(thread), { metadata: next, expirationTtl: FEEDBACK_TTL });
            return jsonResponse({ ok: true, item: summary(target, next), thread });
        }

        // Test de l'envoi vers Discord depuis /stats.
        if (body.testWebhook === true) {
            const r = await notifyDiscord(env, null, { k: 'other', m: '✅ Test du webhook depuis /stats : les retours arrivent bien ici.', p: 'web', v: 'test', at: Date.now() });
            const { metadata } = await store(env).getWithMetadata(FEEDBACK_HOOK_KEY);
            return jsonResponse({ ok: Boolean(metadata?.ok), webhook: { configured: Boolean(env.FEEDBACK_WEBHOOK), last: metadata || null } });
        }
        if (typeof body.delete === 'string' && FEEDBACK_KEY_RE.test(body.delete)) {
            await store(env).delete(body.delete);
            for (const k of (await listAll(`${FEEDBACK_PHOTO_PREFIX}${body.delete}_`)).slice(0, 200)) await store(env).delete(k.name);
            return jsonResponse({ ok: true, deleted: 1 });
        }
        if (body.clear === true) {
            // Une écriture D1 par entrée : 500 retours et 500 photos au plus par action.
            const keys = (await listAll(FEEDBACK_PREFIX)).slice(0, 500);
            for (const k of keys) await store(env).delete(k.name);
            const pics = (await listAll(FEEDBACK_PHOTO_PREFIX)).slice(0, 500);
            for (const k of pics) await store(env).delete(k.name);
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
    return new Response(JSON.stringify({ items, webhook: { configured: Boolean(env.FEEDBACK_WEBHOOK), last: hook || null } }), { headers: noStore });
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
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const now = Date.now();
    const hit = reactHits.get(ip);
    if (!hit || hit.until < now) {
        if (reactHits.size > 5000) reactHits.clear();
        reactHits.set(ip, { n: 1, until: now + 60 * 60 * 1000 });
    } else if (++hit.n > 30) return jsonError('Trop de requêtes', 429);

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

// ── Commandes Moobot (relais pour le site) ───────────────────────────────
// Nightbot, StreamElements et Fossabot sont appelés directement par le site ;
// Moobot n'autorise que moo.bot (CORS), d'où ce relais. Cache 10 min par chaîne.
const moobotCache = new Map();   // chaîne → { at, body }
async function handleMoobotCommands(url) {
    const channel = String(url.searchParams.get('channel') || '').toLowerCase();
    if (!/^[a-z0-9_]{1,25}$/.test(channel)) return jsonError('Chaîne invalide', 400);
    const hit = moobotCache.get(channel);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) {
        return new Response(hit.body, { headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json' } });
    }
    let commands = [];
    try {
        const meta = await (await fetch(`https://api.moo.bot/1/channel/meta?name=${channel}`)).json();
        const id = meta?.channel?.userid;
        if (id) {
            const list = await (await fetch(`https://api.moo.bot/1/channel/public/commands/list?channel=${encodeURIComponent(id)}`)).json();
            commands = (list?.list ?? [])
                .filter((c) => c?.identifier)
                .map((c) => ({ name: String(c.identifier).startsWith('!') ? String(c.identifier) : `!${c.identifier}`, response: String(c.response ?? '') }))
                .slice(0, 500);
        }
    } catch (e) {}
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
];
let schemaReady = null;   // une fois par instance du Worker
function ensureSchema(env) {
    schemaReady ??= env.DB.batch(SCHEMA.map((q) => env.DB.prepare(q))).catch((e) => { schemaReady = null; throw e; });
    return schemaReady;
}

const parseMeta = (m) => { if (!m) return null; try { return JSON.parse(m); } catch (e) { return null; } };
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
// ADMIN_TWITCH_IDS : identifiants Twitch admins, séparés par des virgules.
// SITE_ORIGINS     : origines du site dont les comptages sont acceptés.
// Absentes : valeurs de l'instance officielle.
let envApplied = false;
function applyEnvConfig(env) {
    if (envApplied) return;
    envApplied = true;
    const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (list(env?.ADMIN_TWITCH_IDS).length) ADMIN_IDS = list(env.ADMIN_TWITCH_IDS).filter((x) => /^\d{1,20}$/.test(x));
    if (list(env?.SITE_ORIGINS).length) USAGE_ORIGINS = list(env.SITE_ORIGINS);
}
