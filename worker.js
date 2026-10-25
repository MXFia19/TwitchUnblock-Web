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
        // Battement : dernier passage noté, pour le bot (section « Exploitation »).
        ctx.waitUntil(opsCronBeat(env, 'cron').catch((e) => logCaught('cron/beat', e)));
        ctx.waitUntil(pushTick(env).catch((e) => recordServerError(env, 'cron/notifications', e)));
        ctx.waitUntil(relayWatch(env, new Date(event?.scheduledTime || Date.now())).catch((e) => recordServerError(env, 'cron/relay', e)));
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
                // Réglages du compte (GET : lecture, POST : envoi), à part
                case '/api/sync/prefs': return await handleSyncPrefs(url, request, env);

                // Comptage d'utilisation (app iOS et site)
                case '/api/ping': return await handlePing(request, env);
                case '/api/stats': return await cachedStats(request, env, ctx);
                // Points de chaîne des apps : leurs « minute-watched », relayés
                // quand un bloqueur coupe l'adresse de statistiques de Twitch.
                case '/api/spade': return await handleSpade(request);

                // Outils d'administration (compte du propriétaire uniquement)
                case '/api/admin/me': return await handleAdminMe(request);
                case '/api/admin/usage': return await handleAdminUsage(request, env);
                // Actions notées au journal d'audit (audited, section « Exploitation »).
                case '/api/admin/usage/delete': return await audited(request, env, ctx, (r) => handleAdminUsageDelete(r, env));
                case '/api/admin/sync/delete': return await audited(request, env, ctx, (r) => handleAdminSyncDelete(r, env));
                // Journal d'audit, effacement des données d'une personne
                case '/api/admin/audit': return await handleAdminAudit(request, env);
                case '/api/admin/forget': return await handleAdminForget(request, env, ctx);

                // Annonces affichées dans l'app (lecture publique, écriture admin)
                case '/api/announcement': return await handleAnnouncementGet(env);
                case '/api/announcement/react': return await handleAnnouncementReact(request, env);
                // Sondages (lecture et vote publics, création admin ou bot)
                case '/api/poll': return await handlePollState(request, env);
                case '/api/poll/vote': return await handlePollVote(request, env);
                case '/api/admin/poll': return await audited(request, env, ctx, (r) => handleAdminPoll(r, env));
                // Retours (bug, idée) du site et de l'app
                case '/api/feedback': return await handleFeedback(request, env, ctx);
                case '/api/feedback/thread': return await handleFeedbackThread(request, env);
                case '/api/feedback/reply': return await handleFeedbackReply(request, env, ctx);
                case '/api/feedback/photo': return await handleFeedbackPhoto(url, request, env);
                case '/api/feedback/discord': return await audited(request, env, ctx, (r) => handleFeedbackBot(r, env, ctx));
                case '/api/admin/feedback': return await audited(request, env, ctx, (r) => handleAdminFeedback(r, env, ctx));
                // Retours lus par la clé REPORTS_KEY (tools/reports.mjs), qui
                // change aussi l'état d'un retour et marque des cartes à faire.
                case '/api/admin/reports': return await handleAdminReports(request, env, ctx);
                // Bouton « Open in the app » du bot Discord (/live, /top) : vers l'app.
                case '/api/open/live': return handleOpenLive(url, request);

                // Notifications de live du site installé (Web Push)
                case '/api/push/key': return await handlePushKey(env);
                case '/api/push/subscribe': return await handlePushSubscribe(request, env);
                case '/api/push/unsubscribe': return await handlePushUnsubscribe(request, env);
                case '/api/push/test': return await handlePushTest(request, env);
                // Docker : la tâche planifiée, lancée par l'entrypoint (handleCron).
                case '/api/cron': return await handleCron(request, env);

                // Commandes Moobot pour le site (son API refuse les navigateurs)
                case '/api/bot-commands/moobot': return await handleMoobotCommands(url);
                case '/api/admin/announcement': return await audited(request, env, ctx, (r) => handleAdminAnnouncement(r, env));

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
            // Pas de message interne renvoyé au client : seulement dans les
            // journaux (avec la route) et dans /stats (erreurs du serveur).
            const saving = recordServerError(env, `${request.method} ${url.pathname}`, e);
            if (ctx?.waitUntil) ctx.waitUntil(saving);
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
const tokenCache = new Map();   // empreinte du jeton → { userId, login, clientId, until }
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
    // clientId : application Twitch pour laquelle le jeton a été émis (voir
    // adminToken).
    const entry = { userId, login: String(v.login || '').toLowerCase(), clientId: String(v.client_id || ''), until: Date.now() + 30 * 60 * 1000 };
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

// ── Réglages synchronisés ──────────────────────────────────────────────────
// Un document « préférences » par compte, sous sa propre clé (`prefs_<id>`,
// pas `user_<id>`) et sa propre route : l'app iPhone 1.5.0 et l'app Android
// envoient /api/sync/post sans lui, et cette route-là ne réécrit que
// l'historique et la progression — elle ne peut donc jamais l'effacer.
// Sections indépendantes, chacune avec sa date de modification (`at`, en
// millisecondes, celle de l'appareil qui l'a changée) :
//   common : réglages communs au site et à l'app (noms de la sauvegarde) ;
//   pinned : chaînes épinglées (pseudos en minuscules, dans l'ordre) ;
//   hidden : chaînes et catégories masquées (format de la sauvegarde) ;
//   ios    : personnalisation et réglages propres à l'app iPhone, gardés
//            ici pour ses autres appareils, ignorés du site.
// Un envoi ne remplace que les sections qu'il apporte, et seulement si elles
// sont plus récentes que celles du serveur : la plus récente gagne, section
// par section ; une section absente de l'envoi reste telle quelle. La
// réponse dit lesquelles ont été prises (`accepted`) et rend le document
// entier. Mêmes contrôles d'accès que la sauvegarde (jeton Twitch du compte).
const PREFS_SECTIONS = ['common', 'pinned', 'hidden', 'ios'];
// 500 chaînes et 200 catégories masquées tiennent dedans ; au-delà, les
// appareils gardent les plus anciennes pour eux.
const PREFS_MAX_BYTES = 64 * 1024;
// Document entier : chaque section arrive dans un envoi de 64 Ko au plus,
// mais l'ensemble peut dépasser (masqués près du plafond et 500 personnes
// masquées du chat) — borné à 64 Ko, l'envoi des masqués était refusé
// (413) à chaque essai, sans fin.
const PREFS_DOC_MAX_BYTES = 256 * 1024;
const prefsKey = (userId) => `prefs_${userId}`;

/** Document gardé (ou rien) → { v, sections } avec les seules sections connues. */
function readPrefsDoc(raw) {
    const src = raw && typeof raw === 'object' && raw.sections && typeof raw.sections === 'object' ? raw.sections : {};
    const sections = {};
    for (const name of PREFS_SECTIONS) {
        const s = src[name];
        if (s && typeof s === 'object' && Number.isFinite(s.at) && s.at > 0 && s.data !== undefined) sections[name] = { at: s.at, data: s.data };
    }
    return { v: 1, sections };
}

/** Section d'un envoi ({ at, data }) nettoyée, ou null si elle est
 *  invalide. Une date dans le futur est ramenée à l'heure du serveur : une
 *  horloge en avance ne gagnerait sinon plus jamais rien aux autres. */
function cleanPrefsSection(name, s, now) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
    // Un nombre, au moins 1 ms : Number() laissait passer « 300 », [400] ou
    // « 1e3 ».
    const at = s.at;
    if (typeof at !== 'number' || !Number.isFinite(at) || at < 1) return null;
    const data = cleanPrefsData(name, s.data);
    return data === null ? null : { at: Math.min(Math.round(at), now), data };
}

// Les listes au format de la sauvegarde ; les réglages (common, ios) en
// valeurs JSON telles quelles, sous des noms bornés : le site et l'app les
// valident à la lecture, comme à l'import d'une sauvegarde.
function cleanPrefsData(name, d) {
    const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const stamp = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n < 1e14 ? Math.round(n) : 0; };
    if (name === 'pinned') {
        if (!Array.isArray(d)) return null;
        return [...new Set(d.filter((x) => typeof x === 'string' && LOGIN_RE.test(x)).map((x) => x.toLowerCase()))].slice(0, 300);
    }
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
    if (name === 'hidden') {
        const list = (v) => (Array.isArray(v) ? v : []);
        return {
            channels: list(d.channels).filter((x) => x && typeof x.login === 'string' && LOGIN_RE.test(x.login)).slice(0, 500)
                .map((x) => ({ login: x.login.toLowerCase(), name: str(x.name, 100) || x.login.toLowerCase(), at: stamp(x.at) })),
            categories: list(d.categories).filter((x) => x && /^\d{1,20}$/.test(String(x.id ?? ''))).slice(0, 200)
                .map((x) => {
                    const box = str(x.box, 500);
                    return { id: String(x.id), name: str(x.name, 100), box: box.startsWith('https://') ? box : '', at: stamp(x.at) };
                }),
        };
    }
    // Peu imbriquées : un réglage n'en demande pas plus (ios_customization,
    // objet de listes), et une valeur imbriquée sur des milliers de niveaux
    // faisait échouer JSON.stringify (erreur 500).
    const shallow = (v, depth) => v === null || typeof v !== 'object'
        || (depth < 4 && Object.values(v).every((x) => shallow(x, depth + 1)));
    const out = {};
    for (const [k, v] of Object.entries(d).slice(0, 100)) {
        if (k !== '__proto__' && /^[A-Za-z0-9_]{1,60}$/.test(k) && shallow(v, 0)) out[k] = v;
    }
    return out;
}

// GET  /api/sync/prefs?userId=… → { v, sections }
// POST /api/sync/prefs { userId, sections: { nom: { at, data } } }
//      → { success, accepted: [noms pris], v, sections }
async function handleSyncPrefs(url, request, env) {
    if (!env.DB) return jsonError("Erreur Serveur : base D1 'DB' non liée au Worker.", 500);
    if (request.method === 'GET') {
        const userId = String(url.searchParams.get('userId') || '');
        const denied = await authorizeSync(request, userId);
        if (denied) return denied;
        return jsonResponse(readPrefsDoc(await store(env).get(prefsKey(userId), { type: 'json' })));
    }
    if (request.method !== 'POST') return jsonError("Method Not Allowed", 405);

    const raw = await request.text();
    if (raw.length > PREFS_MAX_BYTES) return jsonError("Réglages trop volumineux", 413);
    let body;
    try { body = JSON.parse(raw); } catch (e) { return jsonError("JSON invalide", 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError("JSON invalide", 400);
    const userId = String(body.userId || '');
    const denied = await authorizeSync(request, userId);
    if (denied) return denied;
    const incoming = body.sections;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return jsonError("Sections manquantes", 400);

    const key = prefsKey(userId);
    // Relu et rejoué si un autre envoi (autre appareil) est passé entre la
    // lecture et l'écriture : sinon il effaçait la section que l'autre venait
    // de faire accepter, et cet appareil la reprenait du serveur à
    // l'ancienne version (voir updateFeedbackThread).
    for (let attempt = 0; attempt < 5; attempt++) {
        const read = await store(env).getWithMetadata(key);
        let stored = null;
        try { stored = read.value == null ? null : JSON.parse(read.value); } catch (e) { stored = null; }
        const doc = readPrefsDoc(stored);
        const now = Date.now();
        const accepted = [];
        let changed = false;
        for (const name of PREFS_SECTIONS) {
            if (!Object.prototype.hasOwnProperty.call(incoming, name)) continue;
            const s = cleanPrefsSection(name, incoming[name], now);
            if (!s) continue;
            const cur = doc.sections[name];
            // Même contenu : déjà là (renvoi après une réponse perdue, ou date
            // seule changée), rien à écrire ; la date du serveur reste.
            if (cur && JSON.stringify(cur.data) === JSON.stringify(s.data)) { accepted.push(name); continue; }
            // Celle du serveur, plus récente (ou de la même date), reste.
            if (cur && cur.at >= s.at) continue;
            doc.sections[name] = s;
            accepted.push(name);
            changed = true;
        }
        const done = () => jsonResponse({ success: true, accepted, ...doc });
        // Rien de neuf : pas d'écriture (quota D1 gratuit : 100 000 lignes par jour).
        if (!changed) return done();
        const out = JSON.stringify(doc);
        if (out.length > PREFS_DOC_MAX_BYTES) return jsonError("Réglages trop volumineux", 413);
        // Premier envoi du compte : rien à comparer.
        if (read.value == null) { await store(env).put(key, out); return done(); }
        if (await store(env).putIf(key, out, {}, read)) return done();
    }
    return jsonError("Réglages changés pendant l'envoi, réessaie", 409);
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
// Part de chaque adresse (/48 en IPv6), prise avant le budget commun : des
// numéros de vidéo inventés depuis une seule adresse le vidaient, et les
// vraies vidéos d'une distribution nouvelle étaient refusées à tous jusqu'à
// la minute suivante. Une vraie vidéo en coûte une, puis l'hôte est retenu
// 24 h : 6 par minute laissent de la marge à une adresse partagée.
const cloudfrontPerPerson = new Map();   // adresse → { n, until } (voir overLimit)
const CLOUDFRONT_GQL_PER_PERSON = 6;
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
 *  PROXY_HOSTS ou distribution CloudFront de Twitch. `who` : adresse du
 *  spectateur (clientKey48), vide sur le relais du VPS. */
async function proxyAllowed(target, who = '') {
    let u;
    try { u = new URL(target); } catch (e) { return false; }
    if (u.protocol !== 'https:' || u.port || u.username || u.password) return false;
    if (u.hostname.endsWith('.cloudfront.net')) return twitchCloudfront(u, who);
    return PROXY_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
}

/** Distribution CloudFront de Twitch ? Connue, ou désignée par Twitch pour
 *  la vidéo ou la chaîne du chemin (verdict gardé : 24 h oui ; non, 10 min
 *  pour cette vidéo ou cette chaîne seulement). */
async function twitchCloudfront(u, who = '') {
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
    try { hosts = await twitchVouches(subject, who); } catch (e) { return false; }
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
 *  GQL) ; au-delà de CLOUDFRONT_GQL_PER_PERSON questions de cette adresse
 *  ou de CLOUDFRONT_GQL_PER_MINUTE en tout dans la minute, null sans GQL :
 *  une distribution nouvelle n'en coûte qu'une, gardée 24 h. Sans adresse
 *  (relais du VPS), seul le budget commun compte. */
function twitchVouches(subject, who = '') {
    const pending = cloudfrontAsks.get(subject);
    if (pending) return pending;
    if (who && overLimit(cloudfrontPerPerson, who, CLOUDFRONT_GQL_PER_PERSON, 60 * 1000)) return Promise.resolve(null);
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
async function proxyUpstream(target, headers, doFetch, who = '') {
    let url = target;
    for (let hops = 0; ; hops++) {
        const res = await doFetch(url, { headers, redirect: 'manual' });
        const location = res.status >= 300 && res.status < 400 ? res.headers.get('Location') : null;
        if (!location) return { res, url };
        await res.body?.cancel().catch(() => {});
        let next;
        try { next = new URL(location, url).href; } catch (e) { return {}; }
        if (hops >= PROXY_MAX_REDIRECTS || !(await proxyAllowed(next, who))) return {};
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
    // Adresse du spectateur pour la part de questions GQL (twitchVouches) ;
    // vide sur le relais du VPS, qui n'en transmet pas.
    const who = clientKey48(request);
    if (!(await proxyAllowed(target, who))) return new Response("Hôte non autorisé", { status: 403, headers: RESPONSE_HEADERS });
    const isVod = url.searchParams.get('isVod') === 'true', workerOrigin = url.origin;

    let fetchHeaders = { ...REQUEST_HEADERS };
    if (request.headers.get("Range")) fetchHeaders["Range"] = request.headers.get("Range");

    // Le relais du VPS fournit son propre fetch, qui refuse en plus toute
    // adresse interne (docker/relay.mjs).
    const doFetch = typeof env?.PROXY_FETCH === 'function' ? env.PROXY_FETCH : (u, init) => fetch(u, init);
    const up = await proxyUpstream(target, fetchHeaders, doFetch, who);
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
        // Adresse illisible (ligne malformée) : laissée telle quelle. new URL()
        // levait, et toute la playlist finissait en erreur 500, notée en base à
        // chaque relecture (toutes les 2 s par spectateur).
        const proxify = (u, playlist) => {
            try {
                const full = u.startsWith('http') ? u : new URL(u, base).href;
                return (isVod || playlist || isPlaylistUrl(full)) ? proxyUrl(full) : full;
            } catch (e) { return u; }
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

// ── Relais des « minute-watched » (points de chaîne des apps) ─────────────
// Chaque minute, l'app envoie un événement « minute-watched » à l'adresse de
// statistiques de Twitch (`spade_url`, lue dans la page de la chaîne) :
// c'est lui qui crédite les points de chaîne. Un bloqueur de pubs ou un DNS
// filtrant coupe souvent cette adresse (spade.twitch.tv), et plus rien
// n'était crédité ; l'app passe alors par ici.
//   POST /api/spade   { url: <spade_url>, data: <base64 des événements JSON> }
//   → 200 { ok: true, status: <code HTTP de Twitch> } ; 400 adresse refusée
//     ou données invalides ; 429 trop d'envois ; 502 Twitch injoignable.
// L'envoi est refait comme l'app le fait (POST, `data=<base64>` en
// application/x-www-form-urlencoded, User-Agent de Safari sur iPhone, celui
// de ChannelPointsService), sans suivre de redirection. Ce n'est pas un
// mandataire ouvert : https seulement, hôte spade.twitch.tv ou
// video-edge-<…>.<…>.abs.hls.ttvnw.net, sans identifiants ni port, chemin
// (requête comprise) de SPADE_PATH_MAX caractères au plus ; les données,
// SPADE_DATA_MAX caractères de base64 au plus, doivent se décoder en une
// liste JSON de 1 à SPADE_EVENTS_MAX événements « minute-watched » (des
// objets, `properties` en objet) — rien d'autre ne part. SPADE_PER_MINUTE
// envois par minute et par adresse (/64 en IPv6), en mémoire de l'instance :
// ni lecture ni écriture D1 (une écriture par minute et par spectateur
// viderait le quota), et rien sur l'utilisateur au journal, même en erreur.
// En-têtes CORS comme les autres routes /api : un navigateur peut de toute
// façon poster directement à spade.twitch.tv.
const SPADE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 '
    + '(KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
const SPADE_HOST_RE = /^(?:spade\.twitch\.tv|video-edge-[a-z0-9-]{1,63}\.[a-z0-9-]{1,63}\.abs\.hls\.ttvnw\.net)$/;
// Chemin : aujourd'hui « /track » (spade.twitch.tv), mais la forme
// video-edge-…/v1/segment/<jeton> porte un long jeton.
const SPADE_URL_MAX = 2500;
const SPADE_PATH_MAX = 2000;
const SPADE_DATA_MAX = 8 * 1024;
const SPADE_EVENTS_MAX = 5;
const SPADE_PER_MINUTE = 20;
const SPADE_BODY_MAX = SPADE_DATA_MAX + SPADE_URL_MAX + 512;   // { url, data } en JSON
const spadeHits = new Map();   // adresse → { n, until } (mémoire de l'instance)

/** Adresse de statistiques de Twitch admise, rendue sans fragment ; null
 *  sinon. */
function spadeTarget(raw) {
    if (typeof raw !== 'string' || raw.length > SPADE_URL_MAX) return null;
    let u;
    try { u = new URL(raw); } catch (e) { return null; }
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !SPADE_HOST_RE.test(u.hostname)) return null;
    const path = u.pathname + u.search;
    return path.length <= SPADE_PATH_MAX ? `https://${u.hostname}${path}` : null;
}

/** `data` admis : du base64 qui se décode en une liste JSON de 1 à
 *  SPADE_EVENTS_MAX événements « minute-watched ». */
function spadeEventsOk(data) {
    if (typeof data !== 'string' || !data || data.length > SPADE_DATA_MAX || data.length % 4 !== 0
        || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return false;
    let events;
    try { events = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b64Bytes(data))); } catch (e) { return false; }
    const object = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
    return Array.isArray(events) && events.length >= 1 && events.length <= SPADE_EVENTS_MAX
        && events.every((e) => object(e) && e.event === 'minute-watched' && object(e.properties));
}

async function handleSpade(request) {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
    if (overLimit(spadeHits, clientKey(request), SPADE_PER_MINUTE, 60 * 1000)) {
        return jsonError('Trop d\x27envois, réessaie dans une minute', 429);
    }
    let body = null;
    try {
        if (!(Number(request.headers.get('Content-Length')) > SPADE_BODY_MAX)) {
            const text = await request.text();
            if (text.length <= SPADE_BODY_MAX) body = JSON.parse(text);
        }
    } catch (e) { body = null; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError('Données invalides', 400);
    const target = spadeTarget(body.url);
    if (!target) return jsonError('Adresse refusée', 400);
    if (!spadeEventsOk(body.data)) return jsonError('Données invalides', 400);
    let res;
    try {
        res = await fetch(target, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': SPADE_UA },
            body: `data=${encodeURIComponent(body.data)}`,
            redirect: 'manual',
            signal: AbortSignal.timeout(10000),
        });
    } catch (e) {
        return jsonError('Twitch injoignable', 502);
    }
    // Rien à lire dans la réponse : seul son code compte.
    res.body?.cancel().catch(() => {});
    return jsonResponse({ ok: true, status: res.status });
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
// Nouvelles installations anonymes comptées par jour et par adresse (/64 en
// IPv6) : au-delà, des UUID tirés au hasard gonfleraient /stats. Aussi par
// réseau (/48 en IPv6, l'adresse en IPv4 : un /48 compte 65 536 « adresses »)
// et en tout : chacune coûte des écritures D1, dont un flot vidait le quota
// du jour. Au-delà, le ping est ignoré sans erreur.
const USAGE_NEW_PER_PERSON = 20;
const USAGE_NEW_PER_NETWORK = 100;
const USAGE_NEW_PER_DAY = 1000;
// tvos : l'app Apple TV (comptée à part depuis la 0.1.15) ; android : l'app
// Android (téléphone et Android TV, dépôt TwitchUnblock-Android).
const PLATFORMS = ['ios', 'web', 'tvos', 'android'];
// Le site officiel : un ping « web » venu d'ailleurs (copie locale, tests,
// préversions) n'est pas compté. L'app iOS n'envoie pas d'en-tête Origin.
let USAGE_ORIGINS = ['https://twitchunblock.vercel.app', 'https://test2-fawn-eta.vercel.app'];
// Navigateurs automatisés et robots qui exécutent le JavaScript.
const BOT_UA = /headless|bot\b|crawler|spider|slurp|playwright|puppeteer|selenium|phantomjs|lighthouse|preview/i;
// Ce que le ping peut ajouter (pour /stats) : langue de l'interface, type
// d'appareil, version majeure d'iOS, et des compteurs de lectures — la source
// qui a servi un direct, les échecs. Jamais de chaîne ni de titre.
const USAGE_DEVICES = ['iphone', 'ipad', 'tv', 'mobile', 'desktop'];
// Langue (l) et appareil (d) par plateforme : i(OS), w(eb), t(vOS) ; version
// d'iOS ; extension TwitchUnblock Connect vue par le site (x…, voir handlePing).
const USAGE_META_FIELDS = ['li', 'lw', 'lt', 'la', 'di', 'dw', 'dt', 'da', 'os', 'xv', 'xb', 'xd'];
// Extension du site : version « 0.1.0 » (comme le site, connect.js) et
// navigateur de la liste ; autre chose est ignoré.
const USAGE_EXT_VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const USAGE_EXT_BROWSERS = ['chrome', 'firefox', 'other'];
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
    if (!(body = await readJsonObject(request))) return jsonError('JSON invalide', 400);

    // Chaque ping est une écriture D1 (100 000 par jour en gratuit) : une même
    // adresse ne peut pas en enchaîner des centaines. Compté en mémoire
    // seulement, jamais stocké.
    if (body?.forget !== true && overLimit(pingHits, clientKey(request), 10)) return jsonError('Trop de requêtes', 429);

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
    // qu'elle n'embarque le jeton. Un simple marqueur, pas une protection : il
    // se lit dans l'IPA publique (d'où le plafond des nouvelles installations,
    // plus bas).
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
    try { prev = (await store(env).getWithMetadata(key)).metadata || {}; } catch (e) { logCaught('ping/read', e); }

    // Première connexion sur cet appareil : l'historique anonyme est repris
    // par le compte, puis effacé (sinon la même personne compterait deux fois).
    if (who) {
        let anon = null;
        try { anon = (await store(env).getWithMetadata(anonKey)).metadata; } catch (e) { logCaught('ping/anon', e); }
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

    // Nouvelle installation anonyme : plafonnée par adresse et par jour (un
    // compte Twitch, lui, ne se fabrique pas en série). Refusée sans erreur.
    if (!who && !prev.first) {
        const mine = `pnew_${(await sha256hex(`ping|${day}|${clientKey(request)}`)).slice(0, 4)}`;
        const net = `pnwn_${(await sha256hex(`ping|${day}|net|${clientKey48(request)}`)).slice(0, 4)}`;
        let fresh = true;
        try {
            await ensureSchema(env);
            fresh = await takeNtfyLimits(env, [[mine, USAGE_NEW_PER_PERSON], [net, USAGE_NEW_PER_NETWORK], ['pnew', USAGE_NEW_PER_DAY]]);
        } catch (e) { logCaught('ping/limit', e); }
        if (!fresh) return jsonResponse({ ok: true, ignored: true });
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
    const suffix = platform === 'web' ? 'w' : platform === 'tvos' ? 't' : platform === 'android' ? 'a' : 'i';
    for (const f of USAGE_META_FIELDS) if (prev[f] !== undefined) meta[f] = prev[f];
    // Langue : deux lettres (« fr »), ou avec son écriture (« zh-Hant » : le
    // chinois traditionnel des apps et du site, refusé avant — ses
    // utilisateurs n'étaient comptés dans aucune langue). Gardée sous sa forme
    // BCP 47 (langue en minuscules, écriture avec une capitale), celle dont
    // /stats tire le nom (Intl.DisplayNames). Tout le reste est ignoré.
    const lm = /^([a-z]{2})(?:-([a-z]{4}))?$/i.exec(String(body.lang || ''));
    if (lm) meta['l' + suffix] = lm[2] ? `${lm[1].toLowerCase()}-${lm[2][0].toUpperCase()}${lm[2].slice(1).toLowerCase()}` : lm[1].toLowerCase();
    if (USAGE_DEVICES.includes(body.device)) meta['d' + suffix] = body.device;
    if (platform === 'ios' && /^\d{1,2}$/.test(String(body.os ?? ''))) meta.os = String(body.os);
    // Extension TwitchUnblock Connect (site) : sa version (xv), son navigateur
    // (xb) et le dernier jour où elle a été vue (xd), qui la compte dans les
    // périodes de /stats comme `last` les personnes. Absente (« none ») : rien
    // n'est effacé — un compte peut l'avoir sur un ordinateur et pas sur son
    // téléphone, et chaque signal de l'un puis de l'autre réécrirait l'entrée
    // —, seulement « - » si elle n'a jamais été vue (le site l'a cherchée).
    if (platform === 'web') {
        if (USAGE_EXT_VERSION.test(String(body.ext ?? ''))) {
            meta.xv = body.ext;
            meta.xd = day;
            if (USAGE_EXT_BROWSERS.includes(body.extBrowser)) meta.xb = body.extBrowser;
        } else if (body.ext === 'none' && !meta.xd) meta.xv = '-';
    }

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
// Le calcul gardé aussi en D1, pour toutes les instances : celui d'une
// instance ne servait guère (réglages de l'app et du site, /stats rafraîchi
// toutes les 2 minutes, sur des instances différentes) et chaque calcul lit
// toutes les entrées du comptage, les compteurs de 30 jours et les
// abonnements. Au plus un calcul par STATS_SHARED_TTL ; « Actualiser » de
// /stats (compte administrateur, `?fresh=1`) recalcule tout de suite.
const STATS_CACHE_KEY = 'stats_cache';
const STATS_SHARED_TTL = 10 * 60 * 1000;
async function cachedStats(request, env, ctx) {
    const reply = (body) => new Response(body, { headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    let fresh = false;
    if (new URL(request.url).searchParams.get('fresh') === '1' && request.headers.get('Authorization')) {
        fresh = await requireAdmin(request).then((r) => !r.denied, () => false);
    }
    if (!fresh && statsCache && statsCache.until > Date.now()) return reply(statsCache.body);
    if (!fresh && env.DB) {
        try {
            await ensureSchema(env);
            const row = await env.DB.prepare(`SELECT value, meta FROM kv WHERE key = ?1`).bind(STATS_CACHE_KEY).first();
            const at = Number(parseMeta(row?.meta)?.at) || 0;
            if (row?.value && Date.now() - at < STATS_SHARED_TTL) {
                statsCache = { body: row.value, until: Math.min(Date.now() + 60 * 1000, at + STATS_SHARED_TTL) };
                return reply(row.value);
            }
        } catch (e) { logCaught('stats/cache', e); }
    }
    const res = await handleStats(env);
    if (res.ok) {
        const body = await res.clone().text();
        statsCache = { body, until: Date.now() + 60 * 1000 };
        const save = store(env).putStatement(STATS_CACHE_KEY, body, { metadata: { at: Date.now() } }).run()
            .catch((e) => logCaught('stats/cache', e));
        if (ctx?.waitUntil) ctx.waitUntil(save); else await save;
    }
    return res;
}
/** Calcul gardé oublié (comptage effacé) : le prochain est refait. */
async function dropStatsCache(env) {
    statsCache = null;
    await store(env).delete(STATS_CACHE_KEY).catch((e) => logCaught('stats/cache', e));
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
    for (let i = 29; i >= 0; i--) daily[dayKey(i)] = { date: dayKey(i), newIos: 0, newWeb: 0, newTv: 0, newAndroid: 0, lastIos: 0, lastWeb: 0, lastTv: 0, lastAndroid: 0 };

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
    const devices = { reporting: { ios: 0, web: 0, tvos: 0, android: 0 }, lang: { ios: {}, web: {}, tvos: {}, android: {} }, os: {}, device: { ios: {}, web: {}, tvos: {}, android: {} } };
    const tally = (obj, k) => { obj[k] = (obj[k] || 0) + 1; };
    // Extension TwitchUnblock Connect : personnes vues avec elle sur le site,
    // une fois par période d'après le dernier jour où elle l'a été (xd), en
    // tout, par version et par navigateur (les derniers vus). `reporting` :
    // personnes actives sur 30 jours dont le site l'a cherchée, qu'elle y
    // soit ou non (versions du site depuis 2026.10.25c).
    const ext = { today: 0, week: 0, month: 0, reporting: 0, versions: {}, browsers: {} };
    const periods = () => ({ today: 0, week: 0, month: 0 });

    // list() renvoie les métadonnées sans lecture par clé ; 1000 clés par page.
    do {
        const page = await store(env).list({ prefix: USAGE_PREFIX, limit: 1000, cursor });
        for (const key of page.keys) {
            const meta = key.metadata || {};
            const then = Date.parse((meta.last || '') + 'T00:00:00Z');
            const age = Number.isNaN(then) ? Infinity : Math.floor((todayMs - then) / 86400000);
            const firstThen = Date.parse((meta.first || meta.last || '') + 'T00:00:00Z');
            const firstAge = Number.isNaN(firstThen) ? Infinity : Math.floor((todayMs - firstThen) / 86400000);
            // Une seule plateforme par identifiant : les apps d'abord (le vrai
            // signe d'adoption : iPhone, Android, Apple TV), puis le site.
            const plats = meta.ps ? String(meta.ps).split(',') : [meta.p || 'ios'];
            const plat = plats.includes('ios') ? 'ios' : plats.includes('android') ? 'android'
                : plats.includes('tvos') ? 'tvos' : plats.includes('web') ? 'web' : 'ios';
            const buckets = [platforms[plat]];
            const kind = meta.k === 'a' ? kinds.accounts : kinds.anonymous;
            // Une seule fois par période, quel que soit le nombre de jours où
            // la personne (le compte, ou l'appareil sans compte) est revenue.
            for (const c of [total, kind, ...buckets]) {
                c.known++;
                if (age === 0) { c.today++; if (firstAge === 0) c.todayNew++; }
                if (age < 7) { c.week++; if (firstAge < 7) c.weekNew++; }
                if (age < 30) { c.month++; if (firstAge < 30) c.monthNew++; }
            }
            if (age < 30) { const v = `${meta.p || 'ios'} ${meta.v || '?'}`; versions[v] = (versions[v] || 0) + 1; }
            const d = meta.days || 1;
            totalDays += d;
            if (d >= 2) { returning++; kind.returning++; for (const b of buckets) b.returning++; }
            if (d === 1) loyalty.once++; else if (d < 7) loyalty.few++; else if (d < 30) loyalty.regular++; else loyalty.daily++;
            if (meta.first && (!oldestFirst || meta.first < oldestFirst)) oldestFirst = meta.first;
            const p = plat === 'web' ? 'Web' : plat === 'tvos' ? 'Tv' : plat === 'android' ? 'Android' : 'Ios';
            if (daily[meta.first]) daily[meta.first]['new' + p]++;
            if (daily[meta.last]) daily[meta.last]['last' + p]++;

            if (meta.first && Number.isFinite(firstAge) && firstAge <= USAGE_RETENTION_DAYS) {
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
            if (age < 30) {
                if (meta.li || meta.di || meta.os) devices.reporting.ios++;
                if (meta.lw || meta.dw) devices.reporting.web++;
                if (meta.lt || meta.dt) devices.reporting.tvos++;
                if (meta.la || meta.da) devices.reporting.android++;
                if (meta.la) tally(devices.lang.android, meta.la);
                if (meta.da) tally(devices.device.android, meta.da);
                if (meta.lt) tally(devices.lang.tvos, meta.lt);
                if (meta.dt) tally(devices.device.tvos, meta.dt);
                if (meta.li) tally(devices.lang.ios, meta.li);
                if (meta.lw) tally(devices.lang.web, meta.lw);
                if (meta.os) tally(devices.os, meta.os);
                if (meta.di) tally(devices.device.ios, meta.di);
                if (meta.dw) tally(devices.device.web, meta.dw);
                if (meta.xv) ext.reporting++;
            }
            const xThen = meta.xd && meta.xv !== '-' ? Date.parse(meta.xd + 'T00:00:00Z') : NaN;
            const xAge = Number.isNaN(xThen) ? Infinity : Math.floor((todayMs - xThen) / 86400000);
            if (xAge < 30) {
                const browser = USAGE_EXT_BROWSERS.includes(meta.xb) ? meta.xb : 'other';
                for (const c of [ext, ext.versions[meta.xv] ??= periods(), ext.browsers[browser] ??= periods()]) {
                    c.month++;
                    if (xAge < 7) c.week++;
                    if (xAge === 0) c.today++;
                }
            }
        }
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    // Actifs par jour et santé du direct : compteurs de stats_day (depuis
    // leur mise en place seulement, l'historique d'avant n'existe pas).
    const activeDaily = Object.keys(daily).map((date) => ({ date, total: 0, ios: 0, web: 0, tvos: 0, android: 0, acct: 0, anon: 0 }));
    const byDate = Object.fromEntries(activeDaily.map((d) => [d.date, d]));
    const health = { week: { ios: {}, web: {}, tvos: {}, android: {} }, month: { ios: {}, web: {}, tvos: {}, android: {} }, since: null };
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
        const [subs, services, snapRow, queueRows, pauseRow] = await Promise.all([
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
            // Chaînes, en live, abonnements : notés par la tâche planifiée
            // (pushCheckLives), au lieu de compter push_live et push_follow
            // entiers à chaque calcul.
            rows(`SELECT meta FROM kv WHERE key = ?1`, PUSH_CURSOR_KEY),
            // Par l'index (kind, at) seul.
            rows(`SELECT kind, COUNT(*) AS n, MIN(at) AS oldest FROM push_queue GROUP BY kind`),
            rows(`SELECT value FROM kv WHERE key = 'push_ntfy_pause'`),
        ]);
        const snap = parseMeta(snapRow[0]?.meta) || {};
        // Avant le premier passage de la tâche planifiée : comptés ici.
        const channels = Number.isFinite(snap.n) ? [{ n: snap.n, live: snap.live }]
            : await rows(`SELECT COUNT(*) AS n, SUM(stream IS NOT NULL AND stream != '?') AS live FROM push_live`);
        const follows = Number.isFinite(snap.f) ? [{ n: snap.f }] : await rows(`SELECT COUNT(*) AS n FROM push_follow`);
        const side = (r) => (r.kind === 'ntfy' ? 'ntfy' : 'web');
        const kinds = Object.fromEntries(subs.map((r) => [side(r), r]));
        const queue = {};
        for (const r of queueRows) {
            const q = queue[side(r)] ??= { n: 0, oldest: 0 };
            q.n += Number(r.n) || 0;
            if (Number(r.oldest) && (!q.oldest || Number(r.oldest) < q.oldest)) q.oldest = Number(r.oldest);
        }
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
            queue,
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
        devices, ext, activeDaily, activeSince, health, push,
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
/** Erreur rattrapée mais notée : elle arrive dans les journaux du Worker
 *  (Cloudflare → Workers → Logs ; observability activée dans wrangler.toml).
 *  Ces lectures échouaient en silence. */
function logCaught(where, e) {
    console.warn(`[${where}]`, e?.message || String(e));
}

/** Erreurs du serveur gardées pour /stats (50 dernières, 14 jours) : visibles
 *  sans passer par le tableau de bord de Cloudflare. */
const SERVER_ERRORS_KEY = 'fbmeta_errors';
// Une erreur qui se répète (amont injoignable sur /api/proxy, relu toutes les
// 2 s par chaque spectateur) relisait et réécrivait la liste à chaque fois :
// des dizaines d'écritures D1 par seconde. Par instance, au plus une écriture
// par minute et par endroit (`where`), et SERVER_ERRORS_PER_MINUTE en tout ;
// les répétitions tues sont comptées et ajoutées à l'entrée (« (×N) »), qui
// remonte en tête au lieu de pousser les autres hors de la liste.
const SERVER_ERRORS_PER_MINUTE = 10;
const serverErrorSeen = new Map();   // where → { at, n } (mémoire de l'instance)
const serverErrorBudget = { n: 0, until: 0 };
async function recordServerError(env, where, e) {
    console.error(`[${where}]`, e?.stack || e?.message || String(e));
    if (!env.DB) return;
    const place = String(where).slice(0, 80);
    const now = Date.now();
    const seen = serverErrorSeen.get(place);
    if (seen && now - seen.at < 60 * 1000) { seen.n++; return; }
    if (serverErrorBudget.until <= now) Object.assign(serverErrorBudget, { n: 0, until: now + 60 * 1000 });
    if (++serverErrorBudget.n > SERVER_ERRORS_PER_MINUTE) return;
    if (serverErrorSeen.size >= 200) serverErrorSeen.clear();
    serverErrorSeen.set(place, { at: now, n: 0 });
    try {
        let list = [];
        try { list = JSON.parse(await store(env).get(SERVER_ERRORS_KEY) || '[]'); } catch (err) { list = []; }
        if (!Array.isArray(list)) list = [];
        const msg = String(e?.message || e).slice(0, 280);
        const same = list.findIndex((x) => x?.where === place && String(x.msg || '').replace(/ \(×\d+\)$/, '') === msg);
        const n = (same >= 0 ? Number(/ \(×(\d+)\)$/.exec(list[same].msg)?.[1]) || 1 : 0) + (seen?.n || 0) + 1;
        if (same >= 0) list.splice(same, 1);
        list.unshift({ at: now, where: place, msg: n > 1 ? `${msg} (×${n})` : msg });
        await store(env).put(SERVER_ERRORS_KEY, JSON.stringify(list.slice(0, 50)), { expirationTtl: 14 * 86400 });
    } catch (err) { console.error('[errors] not saved', err?.message || err); }
}
async function readServerErrors(env) {
    try {
        const list = JSON.parse(await store(env).get(SERVER_ERRORS_KEY) || '[]');
        return Array.isArray(list) ? list : [];
    } catch (e) { logCaught('errors/read', e); return []; }
}

/** Erreurs récentes du journal de l'app ou du site, jointes à un retour
 *  (20 lignes, 2 400 caractères au plus) : le bug arrive avec sa trace. */
function cleanErrors(list) {
    if (!Array.isArray(list)) return null;
    const lines = list.slice(0, 20).map((l) => cleanText(l, 240)).filter(Boolean);
    return lines.length ? lines.join('\n').slice(0, 2400) : null;
}

/** Corps JSON d'une requête s'il s'agit d'un objet ; null sinon (JSON
 *  invalide, ou `null`, nombre, tableau… qui faisaient des erreurs 500). */
async function readJsonObject(request) {
    try {
        const v = await request.json();
        const body = v && typeof v === 'object' && !Array.isArray(v) ? v : null;
        // Gardé pour le journal d'audit (audited) : rien à relire ni à recopier.
        if (body) parsedBodies.set(request, body);
        return body;
    } catch (e) { return null; }
}
const parsedBodies = new WeakMap();   // requête → corps lu par readJsonObject

// ═══════════════════════════════════════════════════════════════════════════
//  Administration : réservé aux comptes de ADMIN_IDS (jeton Twitch vérifié).
// ═══════════════════════════════════════════════════════════════════════════
// Applications Twitch dont un jeton ouvre ces outils : le site officiel et les
// apps (iPhone, Apple TV, Android), plus celle du site d'une instance
// auto-hébergée (TWITCH_CLIENT_ID, applyEnvConfig). Avant, un jeton du compte
// propriétaire émis pour n'importe quelle autre application (un site tiers où
// il s'est connecté avec Twitch) les ouvrait aussi.
let ADMIN_CLIENT_IDS = ['uyvqdqrz614y5wx5l4kev6c4ln7u9a', '1e68ku2ehgzy5cy0di3xvfy82sxpf6'];
const adminToken = (who) => Boolean(who && ADMIN_IDS.includes(who.userId) && ADMIN_CLIENT_IDS.includes(who.clientId));

async function requireAdmin(request) {
    const who = await tokenIdentity(request);
    if (!who) return { denied: jsonError('Jeton Twitch manquant ou expiré', 401) };
    if (!adminToken(who)) return { denied: jsonError('Réservé au propriétaire', 403) };
    return { who };
}

// GET /api/admin/me — suis-je administrateur ? (adminConfigured : faux sur
// une instance sans ADMIN_TWITCH_IDS, /stats le signale.)
async function handleAdminMe(request) {
    const who = await tokenIdentity(request);
    return jsonResponse({ login: who?.login ?? null, admin: adminToken(who), adminConfigured: ADMIN_IDS.length > 0 });
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
    if (!(body = await readJsonObject(request))) return jsonError('JSON invalide', 400);
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
    await dropStatsCache(env);
    return jsonResponse({ ok: true, deleted: doomed.length, remaining: keys.filter(match).length - doomed.length });
}

// POST /api/admin/sync/delete — { login } : efface la sauvegarde d'un compte
// (historique, progression) et ses réglages synchronisés.
async function handleAdminSyncDelete(request, env) {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
    const { denied } = await requireAdmin(request);
    if (denied) return denied;
    let body;
    if (!(body = await readJsonObject(request))) return jsonError('JSON invalide', 400);
    const login = String(body.login || '').trim().toLowerCase();
    if (!LOGIN_RE.test(login)) return jsonError('Nom invalide', 400);
    const d = await twitchGQL('query($l: String!) { user(login: $l) { id } }', { l: login });
    const id = d?.data?.user?.id;
    if (!id) return jsonError('Compte introuvable', 404);
    // `found` : ce qui est parti, par sorte (comme l'effacement d'une personne),
    // seul noté au journal d'audit.
    const found = { sync: 0, settings: 0 };
    for (const [kind, key] of [['sync', `user_${id}`], ['settings', prefsKey(id)]]) {
        if (!(await store(env).get(key))) continue;
        found[kind]++;
        await store(env).delete(key);
    }
    return jsonResponse({ ok: true, existed: found.sync + found.settings > 0, found });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Annonces : un message du développeur affiché dans l'app pendant une durée
//  choisie. Une seule annonce à la fois, clé KV `announcement`, qui expire
//  d'elle-même (expirationTtl) : rien à nettoyer.
// ═══════════════════════════════════════════════════════════════════════════
const ANNOUNCEMENT_KEY = 'announcement';
let announcementCache = null;   // { value, until } — l'app la relit à chaque ouverture

async function readAnnouncement(env) {
    if (announcementCache && announcementCache.until > Date.now()) {
        const v = announcementCache.value;
        return v && v.until > Date.now() ? v : null;
    }
    let value = null;
    try { value = await store(env).get(ANNOUNCEMENT_KEY, 'json'); } catch (e) { logCaught('announcement/read', e); }
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
    if (!(body = await readJsonObject(request))) return jsonError('JSON invalide', 400);
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
        try { prev = await store(env).get(ANNOUNCEMENT_KEY, 'json'); } catch (e) { logCaught('announcement/edit', e); }
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
// Plafonds du jour gardés en D1 (compteurs du jour de la table kv, comme ceux
// de ntfy) : les limites par adresse ne tiennent qu'en mémoire d'une
// instance, et un /48 IPv6 compte 65 536 « personnes ». Sans plafond global,
// un flot de retours vidait le quota d'écritures D1 du jour (100 000 lignes)
// ou remplissait la base, chacun ouvrant un post sur Discord. Un usage normal
// (quelques centaines d'utilisateurs) en reste loin.
const FEEDBACK_PER_PERSON = 10;          // nouveaux retours par jour et par adresse (/64 en IPv6)
const FEEDBACK_PER_NETWORK = 30;         // … par réseau (/48 en IPv6, l'adresse en IPv4)
const FEEDBACK_PER_DAY = 300;            // … en tout (site, apps et /bug sur Discord)
const FEEDBACK_REPLIES_PER_DAY = 1000;   // réponses des personnes par jour, en tout
// Base plus grosse que ça (500 Mo en gratuit : pleine, plus rien ne s'y écrit
// — sauvegardes, comptage, notifications) : plus de photos, et plus de
// retours ni de réponses non plus (seules les photos s'arrêtaient).
const FEEDBACK_DB_MAX = 400 * 1024 * 1024;   // octets de base
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
        if (opts.waitLink && opts.key && !entry.dt) {
            for (let i = 0; i < 5 && !entry.dt; i++) {
                await new Promise((r) => setTimeout(r, 2000));
                const { metadata } = await store(env).getWithMetadata(opts.key);
                if (metadata?.dt) entry = { ...entry, dt: metadata.dt };
            }
        }
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
    if (fresh && !(await store(env).patchMeta(key, 'dt', thread))) return;
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
        if (r.transient) return { error: `Discord unreachable (${r.transient})`, done, remaining: todo.length - done };
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
    if (!r.ok && (!r.status || r.status >= 500)) return { transient: r.status ? `HTTP ${r.status}` : r.detail || 'network' };
    if (!r.ok || !r.thread) {
        await store(env).patchMeta(key, 'dtf', (m.dtf || 0) + 1);
        return { ok: false };
    }
    await linkDiscordThread(env, key, r.thread, true, ttl);
    const rest = thread.slice(1);
    if (rest.length) {
        // Copiable sur mobile (texte du message) quand il y tient, sinon
        // encadré ; liens sans aperçu (quietLinks).
        const h = historyEmbed(rest);
        const plain = quietLinks(`**${h.title}**\n${h.description}`);
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

/** Plus de `max` requêtes dans l'heure (ou `period` ms) pour cette clé
 *  (adresse, préfixe IPv6, compte Discord) ? Au-delà de 5 000 clés suivies,
 *  on oublie celles dont la période est passée, puis les moins actives (une
 *  rafale d'adresses neuves) : `clear()` remettait tout le monde à zéro —
 *  5 000 adresses suffisaient à effacer sa propre trace. */
function overLimit(map, key, max, period = 60 * 60 * 1000) {
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
    map.set(key, { n: 1, until: now + period });
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

/** Réseau d'une personne : le préfixe /48 de son adresse IPv6 (l'adresse
 *  elle-même en IPv4). Un /48 s'obtient gratuitement (tunnel IPv6) et ses
 *  65 536 /64 comptaient pour autant de personnes : les plafonds globaux du
 *  jour ont une part par réseau, pour qu'un seul ne les vide pas. */
function clientKey48(request) {
    const key = clientKey(request);
    return key.endsWith('::/64') ? `${key.split(':').slice(0, 3).join(':')}::/48` : key;
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
// protège la base ; une part par réseau (/48) l'empêche d'en vider seul le
// plafond. Les réponses de l'équipe n'y sont pas soumises.
const FEEDBACK_PHOTOS_PER_DAY = 60 * 1024 * 1024;       // caractères base64 (~45 Mo d'images)
const FEEDBACK_PHOTOS_PER_PERSON = 6 * 1024 * 1024;     // une adresse (/64 en IPv6) ou un compte Discord
const FEEDBACK_PHOTOS_PER_NETWORK = 15 * 1024 * 1024;   // un réseau (/48 en IPv6, l'adresse en IPv4)

/** Compteurs du jour des photos : [mesure, plafond] pour tout le Worker, la
 *  personne `who` et son réseau `group` (s'il est connu). */
async function photoMetrics(day, who, group) {
    const bucket = async (prefix, id) => `${prefix}_${(await sha256hex(`photos|${day}|${id}`)).slice(0, 4)}`;
    return [['fb_photo_b64', FEEDBACK_PHOTOS_PER_DAY], [await bucket('fbp', who), FEEDBACK_PHOTOS_PER_PERSON],
        ...(group ? [[await bucket('fbq', `net|${group}`), FEEDBACK_PHOTOS_PER_NETWORK]] : [])];
}
// Ajouté et relu d'un coup (RETURNING) : lu avant d'écrire, le compteur
// laissait passer ensemble des envois simultanés.
const photoCount = (env, day, metric, n) => env.DB.prepare(`INSERT INTO stats_day (day, metric, n) VALUES (?1, ?2, ?3)
    ON CONFLICT(day, metric) DO UPDATE SET n = n + excluded.n RETURNING n`).bind(day, metric, n);

/** Photos de la personne `who` (clientKey, ou « du:<compte Discord> ») et de
 *  son réseau `group` (clientKey48, rien pour Discord), ou [] quand sa part
 *  du jour, celle du réseau, le plafond du jour ou la taille de la base
 *  l'interdisent ; celles qui passent sont comptées. Chaque part est comptée
 *  dans l'une des 65 536 cases tirées de l'empreinte du jour et de `who` (ou
 *  `group`) : la base ne garde aucune adresse, ni de quoi suivre quelqu'un
 *  d'un jour à l'autre. */
async function photoAllowance(env, photos, who, group = '') {
    if (!photos.length) return photos;
    const size = photos.reduce((n, p) => n + p.b64.length, 0);
    const day = new Date().toISOString().slice(0, 10);
    const metrics = await photoMetrics(day, who, group);
    let counts, dbSize;
    try {
        await ensureSchema(env);
        const res = await env.DB.batch(metrics.map(([metric]) => photoCount(env, day, metric, size)));
        counts = res.map((r) => Number(r?.results?.[0]?.n) || 0);
        dbSize = Number(res[res.length - 1]?.meta?.size_after) || 0;   // taille de la base (D1)
    } catch (e) {
        console.warn('retours : plafond des photos illisible,', e.message);
        return photos;
    }
    const why = counts[1] > FEEDBACK_PHOTOS_PER_PERSON ? 'part de la personne'
        : counts.length > 2 && counts[2] > FEEDBACK_PHOTOS_PER_NETWORK ? 'part du réseau'
        : counts[0] > FEEDBACK_PHOTOS_PER_DAY ? 'plafond du jour'
        : dbSize > FEEDBACK_DB_MAX ? 'base pleine' : null;
    if (!why) return photos;
    // Rien n'est rangé : rien n'est compté.
    await env.DB.batch(metrics.map(([metric]) => photoCount(env, day, metric, -size))).catch(() => {});
    console.warn(`retours : photos refusées (${why} ; ${Math.round((counts[0] - size) / 1e6)} Mo aujourd'hui, base de ${Math.round(dbSize / 1e6)} Mo)`);
    return [];
}

/** Photos acceptées pour un message finalement pas écrit (discussion fermée,
 *  pleine, occupée ou effacée entre-temps) : effacées si elles sont déjà
 *  rangées (numéros `ph`), et rendues à la part du jour de `who` et `group`
 *  (ceux de photoAllowance ; null : réponse de l'équipe, jamais comptée).
 *  Elles restaient orphelines, et comptées. */
async function dropFeedbackPhotos(env, key, ph, photos, who = null, group = '') {
    for (const n of ph) await store(env).delete(`${FEEDBACK_PHOTO_PREFIX}${key}_${n}`).catch((e) => logCaught('feedback/photos', e));
    if (who === null || !photos.length) return;
    const size = photos.reduce((n, p) => n + p.b64.length, 0);
    const day = new Date().toISOString().slice(0, 10);
    const metrics = await photoMetrics(day, who, group);
    await env.DB.batch(metrics.map(([metric]) => photoCount(env, day, metric, -size))).catch((e) => logCaught('feedback/photos', e));
}

/** Taille de la base en octets (D1 la donne avec chaque requête) ; 0 si
 *  inconnue. */
async function dbBytes(env) {
    try { return Number((await env.DB.prepare('SELECT 1').run())?.meta?.size_after) || 0; }
    catch (e) { logCaught('db/size', e); return 0; }
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

/** Numéros de photos réservés d'un coup (compteur `ph` du retour) : deux
 *  envois simultanés prenaient les mêmes, et l'un écrasait les photos de
 *  l'autre. Rend le premier, ou null si le retour n'existe plus. */
async function reserveFeedbackPhotos(env, key, count) {
    if (!count) return 0;
    await ensureSchema(env);
    const row = await env.DB.prepare(`UPDATE kv SET meta = json_set(COALESCE(meta, '{}'), '$.ph', COALESCE(json_extract(meta, '$.ph'), 0) + ?2)
        WHERE key = ?1 AND ${alive(Date.now())} RETURNING json_extract(meta, '$.ph') AS ph`).bind(key, count).first();
    return row ? Number(row.ph) - count : null;
}

/** Change la discussion d'un retour sans perdre une écriture simultanée
 *  (réponse de la personne, du développeur, du bot) : relue et rejouée si
 *  une autre est passée entre la lecture et l'écriture. `change(thread,
 *  metadata)` rend { thread, metadata } à écrire, ou autre chose (erreur,
 *  rien à faire), rendu tel quel. { gone } : retour effacé. */
async function updateFeedbackThread(env, key, change) {
    for (let attempt = 0; attempt < 5; attempt++) {
        const read = await store(env).getWithMetadata(key);
        if (!read.metadata) return { gone: true };
        const out = await change(feedbackThread(read.value, read.metadata), read.metadata);
        if (!out?.thread || out.unchanged) return out;
        if (await store(env).putIf(key, JSON.stringify(out.thread), { metadata: out.metadata, expirationTtl: FEEDBACK_TTL }, read)) return out;
    }
    logCaught('feedback/update', new Error(`écriture concurrente sans fin : ${key}`));
    return { busy: true };
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
/** Ce que voit la personne. `closed` : discussion fermée par le
 *  développeur ; `full` : plus de place (FEEDBACK_MAX_MESSAGES). Sans eux,
 *  le champ de réponse s'affichait, puis l'envoi échouait sans raison. */
function publicFeedback(id, meta, thread) {
    return { id, kind: meta.k || 'other', status: meta.s || 'new', updatedAt: meta.u || meta.at || 0, lastFrom: meta.r || 'u', thread,
             ...(meta.bl ? { closed: true } : {}), ...(thread.length >= FEEDBACK_MAX_MESSAGES ? { full: true } : {}) };
}

async function handleFeedback(request, env, ctx) {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
    if (!env.DB) return jsonError("Base D1 'DB' non liée au Worker.", 500);
    if (BOT_UA.test(request.headers.get('User-Agent') || '')) return jsonResponse({ ok: true, ignored: true });
    // 5 retours par heure et par adresse : de quoi tout dire, pas de quoi inonder.
    if (overLimit(feedbackHits, clientKey(request), 5)) {
        return jsonError('Trop de messages, réessaie dans une heure', 429);
    }

    let body;
    if (!(body = await readJsonObject(request))) return jsonError('JSON invalide', 400);
    const message = cleanText(body.message, 2000);
    if (message.length < 5) return jsonError('Message trop court', 400);
    if (await dbBytes(env) > FEEDBACK_DB_MAX) return jsonError('Retours en pause (base presque pleine), réessaie plus tard', 429);
    // Compté aussi en base, une fois le message validé (avant, dix requêtes
    // invalides bloquaient pour la journée une adresse partagée) : le
    // compteur en mémoire ne vaut que pour une instance du Worker. Par
    // personne (adresse hachée), par réseau et en tout.
    const fbDay = new Date().toISOString().slice(0, 10);
    const fbWho = `fbn_${(await sha256hex(`fb|${fbDay}|${clientKey(request)}`)).slice(0, 8)}`;
    const fbNet = `fbw_${(await sha256hex(`fb|${fbDay}|net|${clientKey48(request)}`)).slice(0, 8)}`;
    if (!(await takeNtfyLimits(env, [[fbWho, FEEDBACK_PER_PERSON], [fbNet, FEEDBACK_PER_NETWORK], ['fbd', FEEDBACK_PER_DAY]]).catch(() => true))) {
        return jsonError('Trop de messages aujourd\x27hui, réessaie demain', 429);
    }
    let info = body.info;
    if (info && typeof info === 'object') { try { info = JSON.stringify(info); } catch (e) { info = ''; } }
    const asked = cleanPhotos(body.photos);
    const photos = await photoAllowance(env, asked, clientKey(request), clientKey48(request));

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
        el: cleanErrors(body.errors),
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
    if (!(body = await readJsonObject(request))) return jsonError('JSON invalide', 400);
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
    if (!(body = await readJsonObject(request))) return jsonError('JSON invalide', 400);
    const id = String(body.id || '');
    const found = await ownedFeedback(env, id, body.token);
    if (!found) return jsonError('Retour introuvable', 404);
    const message = cleanText(body.message, 2000);
    const asked = cleanPhotos(body.photos);
    if (!message && !asked.length) return jsonError('Message vide', 400);
    const { meta, thread } = found;
    // `closed` / `full` : le site et l'app retirent le champ de réponse.
    if (meta.bl) return jsonError('This conversation was closed by the developer', 403, { closed: true });
    if (thread.length >= FEEDBACK_MAX_MESSAGES) return jsonError('Discussion trop longue', 409, { full: true });
    // Plafonds du jour en base (voir FEEDBACK_REPLIES_PER_DAY) : la limite
    // ci-dessus ne tient qu'en mémoire d'une instance, par /64.
    if (await dbBytes(env) > FEEDBACK_DB_MAX) return jsonError('Retours en pause (base presque pleine), réessaie plus tard', 429);
    if (!(await takeNtfyLimits(env, [['fbr', FEEDBACK_REPLIES_PER_DAY]]).catch(() => true))) {
        return jsonError('Trop de messages aujourd\x27hui, réessaie demain', 429);
    }
    const who = clientKey(request), net = clientKey48(request);
    const photos = await photoAllowance(env, asked, who, net);
    const dropped = asked.length - photos.length;
    if (!message && !photos.length) return jsonError('Photos en pause pour aujourd’hui, réessaie demain', 429, { photosDropped: dropped });

    const now = Date.now();
    const first = await reserveFeedbackPhotos(env, id, photos.length);
    if (first === null) {
        await dropFeedbackPhotos(env, id, [], photos, who, net);
        return jsonError('Retour introuvable', 404);
    }
    const ph = await saveFeedbackPhotos(env, id, photos, first);
    const out = await updateFeedbackThread(env, id, (th, m) => {
        if (m.bl) return { closed: true };
        if (th.length >= FEEDBACK_MAX_MESSAGES) return { full: true };
        th.push({ f: 'u', m: message, at: now, ...(ph.length ? { ph } : {}) });
        return { thread: th, metadata: { ...m, u: now, r: 'u', n: (m.n || 1) + 1 } };
    });
    // Message pas écrit : ses photos, déjà rangées et comptées, ne restent pas.
    if (!out.thread) await dropFeedbackPhotos(env, id, ph, photos, who, net);
    if (out.gone) return jsonError('Retour introuvable', 404);
    if (out.closed) return jsonError('This conversation was closed by the developer', 403, { closed: true });
    if (out.full) return jsonError('Discussion trop longue', 409, { full: true });
    if (out.busy) return jsonError('Réessaie dans un instant', 503);
    const next = out.metadata;
    const hook = notifyDiscord(env, ctx, { ...next, m: message }, photos,
        { key: id, inReplyTo: meta.m, waitLink: !next.dt && now - (meta.at || 0) < 120000 });
    if (!ctx?.waitUntil) await hook;
    return jsonResponse({ ok: true, item: publicFeedback(id, next, out.thread), ...(dropped ? { photosDropped: dropped } : {}) });
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
    // Suggestion (/suggest sur Discord) : une idée, nommée comme telle.
    const kind = e.sg ? '💡 Suggestion' : KINDS[e.k] || KINDS.other;
    const PLACES = { ios: 'iOS app', tvos: 'Apple TV app', android: 'Android app', discord: 'Discord', web: 'Website' };
    const fields = [{ name: 'Platform', value: `${PLACES[e.p] || PLACES.web} · ${e.v}`, inline: true }];
    if (e.c) fields.push({ name: 'Contact', value: e.c, inline: true });
    if (inReplyTo) fields.push({ name: 'In reply to', value: inReplyTo.slice(0, 300) });
    else if (e.i) fields.push({ name: 'Info', value: readableInfo(e.i).slice(0, 1000) });
    if (!inReplyTo && e.el) fields.push({ name: 'Recent errors', value: `\`\`\`\n${String(e.el).slice(0, 990)}\n\`\`\`` });
    const text = String(e.m || '').trim();
    const payload = {
        username: 'TwitchUnblock',
        allowed_mentions: { parse: [] },
        // Le texte dans le message même : sur mobile, « Copier le texte » de
        // Discord ne prend que lui, jamais celui d'un encadré. Plus long que
        // ce qu'un message tient : en entier dans l'encadré aussi. Ses liens
        // sans aperçu (quietLinks).
        ...(text ? { content: discordText(quietLinks(text)) } : {}),
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
    // Nom du post (salon forum) : genre et début du premier message (le titre
    // d'une suggestion).
    const first = String(inReplyTo ?? (e.sg && e.st ? e.st : e.m) ?? '').replace(/\s+/g, ' ').trim();
    const threadName = test ? 'Webhook test' : `${kind} · ${first || '📷'}`.slice(0, 100);
    return discordHook(webhook, payload, photoFiles(photos), { threadId: e.dt, threadName, requireThread });
}

/** Début d'un texte tenant dans un message Discord (2 000 caractères), sans
 *  couper un emoji en deux ni laisser un lien sans son « > » (quietLinks) ;
 *  « … » quand la suite manque. */
function discordText(text, max = 2000) {
    if (text.length <= max) return text;
    let cut = text.slice(0, max - 1).replace(/<https?:\/\/[^\s>]*$/i, '');
    if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
    return `${cut}…`;
}

/** Liens d'un texte libre sans aperçu sur Discord (entre < >, invitations
 *  sans « https:// » comprises) : écrit par n'importe qui, un retour
 *  déroulait dans le forum l'image, la vidéo ou l'invitation de son choix.
 *  (flags: 4, SUPPRESS_EMBEDS, masquerait aussi l'encadré du retour.) */
function quietLinks(text) {
    return String(text)
        .replace(/(^|[^\w/.@-])((?:www\.)?discord(?:app)?\.(?:gg|com\/invite)\/)/gi, '$1https://$2')
        .replace(/<?(https?:\/\/[^\s<>]+)>?/gi, '<$1>');
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
 *  de suite ; sinon, il vide la liste toutes les 10 min.
 *  Ajoutés sur place, en une requête (le bot retire les siens de même,
 *  action `trash-done`) : relue puis réécrite par l'un et par l'autre, la
 *  liste perdait un post ajouté entre les deux, qui restait en ligne. Plus
 *  de limite à 500, et gardée 90 jours (bot arrêté plus d'une semaine).
 *  Les cartes publiques des suggestions supprimées (`cards`, entrées de
 *  suggestionCardTrash) prennent le même chemin : le bot vérifie que c'est
 *  bien une de ses cartes de suggestion avant de la supprimer. */
const BOT_TRASH_TTL = 90 * 86400;
const SUGGEST_CARD_TRASH_RE = /^card:\d{5,25}:\d{5,25}:fb_[a-z0-9]{6,12}_[0-9a-f]{8}$/;
/** Carte publique de la suggestion `key` (`m.sc` : salon, message) pour la
 *  corbeille du bot, « card:<salon>:<message>:<suggestion> » ; null sans carte. */
const suggestionCardTrash = (key, m) => {
    const id = m?.sg && m.sc ? `card:${m.sc.c}:${m.sc.m}:${key}` : '';
    return SUGGEST_CARD_TRASH_RE.test(id) ? id : null;
};
async function trashDiscordPosts(env, ctx, threads, cards = []) {
    const posts = threads.filter((t) => /^\d{5,25}$/.test(t));
    const ids = [...posts, ...cards.filter((c) => SUGGEST_CARD_TRASH_RE.test(String(c)))];
    if (!ids.length || !env.FEEDBACK_BOT_SECRET) return;
    await ensureSchema(env);
    await env.DB.prepare(`INSERT INTO kv (key, value, expires) VALUES (?1, ?2, ?3)
        ON CONFLICT(key) DO UPDATE SET expires = excluded.expires, value = (
            SELECT json_group_array(id) FROM (
                SELECT o.value AS id FROM json_each(CASE WHEN json_valid(kv.value) AND json_type(kv.value) = 'array' THEN kv.value ELSE '[]' END) AS o
                UNION SELECT n.value FROM json_each(excluded.value) AS n))`)
        .bind(`${BOT_STORE_PREFIX}trash`, JSON.stringify([...new Set(ids)]), Date.now() + BOT_TRASH_TTL * 1000).run();
    // Sans post (une carte seule) : le bot la supprime à son prochain passage.
    if (posts.length) echoTeamToDiscord(env, ctx, { dt: posts[0] }, { note: '🗑️ Report deleted from /stats: this post is being deleted.' });
}

/** `from` : d'où vient le changement, dit dans le message (/stats et les
 *  apps par défaut ; « the developer's tool » pour la clé des retours). */
function echoTeamToDiscord(env, ctx, meta, { message = '', photos = [], status = null, note = null, from = '/stats or the app' }) {
    if (!env.FEEDBACK_WEBHOOK || !meta?.dt) return Promise.resolve();
    const content = note
        || (status
            ? `📌 Status: **${FEEDBACK_STATUS_LABELS[status] || status}** (from ${from})`
            : `💬 **Your reply** (from ${from})${message ? `\n${message}` : ''}`);
    const payload = { username: 'TwitchUnblock', allowed_mentions: { parse: [] }, content: content.slice(0, 2000) };
    const job = discordHook(env.FEEDBACK_WEBHOOK, payload, photoFiles(photos), { threadId: meta.dt }).catch(() => {});
    if (ctx?.waitUntil) ctx.waitUntil(job);
    return job;
}

/** Réponse ou état du développeur (`r` : rendu par feedbackTeamUpdate)
 *  recopié dans le post Discord du retour, et dans ceux de ses doublons qui
 *  ont suivi son état — depuis /stats, l'app ou l'outil du développeur
 *  (`from`, voir echoTeamToDiscord). */
function echoTeamUpdate(env, ctx, r, update, from) {
    const echo = from ? { ...update, from } : update;
    if (!r.unchanged) echoTeamToDiscord(env, ctx, r.metadata, echo);
    for (const dt of r.dupThreads || []) echoTeamToDiscord(env, ctx, { dt }, echo);
}

/**
 * Réponse (`message`, `photos`) ou nouvel état (`status`) du développeur,
 * ajouté à la discussion — depuis /stats, l'app ou Discord. Rend
 * { metadata, thread } à jour (`unchanged` : état déjà celui-là), ou
 * { error, code }.
 */
async function feedbackTeamUpdate(env, key, { message = '', photos = [], status = null, extra = null, follow = true }) {
    if (status !== null && !FEEDBACK_STATUSES.includes(status)) return { error: 'État inconnu', en: 'Unknown status', code: 400 };
    if (status === null && !message && !photos.length) return { error: 'Message vide', en: 'Empty message', code: 400 };
    const now = Date.now();
    let ph = [];
    if (status === null && photos.length) {
        const first = await reserveFeedbackPhotos(env, key, photos.length);
        if (first === null) return { error: 'Retour introuvable', en: 'Report not found', code: 404 };
        ph = await saveFeedbackPhotos(env, key, photos, first);
    }
    const out = await updateFeedbackThread(env, key, (thread, metadata) => {
        if (thread.length >= FEEDBACK_MAX_MESSAGES) return { error: 'Discussion trop longue', en: 'Conversation too long', code: 409 };
        const next = { ...metadata, u: now, r: 'a', sa: now, ...(extra || {}) };
        if (status !== null) {
            if (status === (metadata.s || 'new')) return { metadata, thread, unchanged: true };
            thread.push({ f: 'a', s: status, at: now });
            next.s = status;
        } else {
            thread.push({ f: 'a', m: message, at: now, ...(ph.length ? { ph } : {}) });
            next.n = (metadata.n || 1) + 1;
        }
        return { thread, metadata: next };
    });
    // Réponse pas écrite (discussion pleine, occupée, retour effacé) : ses
    // photos déjà rangées ne restent pas orphelines.
    if (ph.length && !out.thread) await dropFeedbackPhotos(env, key, ph, photos);
    if (out.gone) return { error: 'Retour introuvable', en: 'Report not found', code: 404 };
    if (out.busy) return { error: 'Réessaie dans un instant', en: 'Busy, try again', code: 503 };
    if (out.error || out.unchanged) return out;
    const { thread, metadata: next } = out;
    if (next.dt) await linkDiscordThread(env, key, next.dt, false);
    // Doublons fusionnés (/merge) : ils suivent l'état de celui-ci.
    const dupThreads = [];
    if (follow && status !== null && Array.isArray(next.dups)) {
        for (const dup of next.dups.slice(0, 20)) {
            const d = await feedbackTeamUpdate(env, dup, { status, follow: false });
            if (d.metadata?.dt && !d.unchanged && !d.error) dupThreads.push(d.metadata.dt);
        }
    }
    return { metadata: next, thread, ...(dupThreads.length ? { dupThreads } : {}) };
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
//   Outils du bot (voir plus bas) : get / set (sa mémoire), trash-done
//   (posts supprimés, retirés de sa corbeille), todo-actions-done (cartes
//   de la liste à faire marquées par l'outil du développeur), create /
//   userReply (/bug sur Discord, réponses en message privé, photos
//   comprises), delete, block, merge, fix / released (« c'est en ligne »),
//   summary, health, announce, poll / poll-end / poll-state (sondage).
//   Communauté (communityBotTool) : live / top (/live et /top), my-reports,
//   suggest / suggest-card / suggest-vote / suggest-status / suggestion /
//   suggestions (/suggest et ses votes).
//   Exploitation (opsBotTool, en fin de fichier) : ops (état du serveur),
//   forget (effacer les données d'une personne), audit (note au journal).
//   Messages d'erreur en anglais : le bot les
//   affiche.
async function handleFeedbackBot(request, env, ctx = null) {
    const secret = String(env.FEEDBACK_BOT_SECRET || '');
    if (secret.length < 16 || !env.DB) return jsonError('Discord bridge not configured', 404);
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
    // Empreintes comparées : la durée de la comparaison n'apprend rien du secret.
    if (await sha256hex(request.headers.get('Authorization') || '') !== await sha256hex(`Bearer ${secret}`)) {
        return jsonError('Access denied', 403);
    }
    let body;
    if (!(body = await readJsonObject(request))) return jsonError('Bad JSON', 400);

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
    const ops = await opsBotTool(env, ctx, body);
    if (ops) return ops;
    const general = await feedbackBotTool(env, body);
    if (general) return general;
    const community = await communityBotTool(env, body);
    if (community) return community;

    const thread = String(body.thread || '');
    if (!/^\d{5,25}$/.test(thread)) return jsonError('Bad post ID', 400);
    const key = await store(env).get(`${FEEDBACK_DISCORD_PREFIX}${thread}`);
    if (!key || !FEEDBACK_KEY_RE.test(key)) return jsonError('Unknown post', 404);
    const { value, metadata } = await store(env).getWithMetadata(key);
    if (!metadata) return jsonError('Report not found', 404);
    const state = (m) => botReportState(key, m);

    if (body.action === 'state') return jsonResponse(state(metadata));
    if (body.action === 'status') {
        const r = await feedbackTeamUpdate(env, key, { status: String(body.status || '') });
        return r.error ? jsonError(r.en, r.code) : jsonResponse({ ok: true, ...state(r.metadata), dupThreads: r.dupThreads || [] });
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
            if (!s.error) return jsonResponse({ ok: true, ...state(s.metadata), dupThreads: s.dupThreads || [] });
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
        if (body.peek !== true && thread.length > from) await store(env).patchMeta(key, 'dd', thread.length);
        return jsonResponse({ du: metadata.du, key, excerpt: String(metadata.m || '').slice(0, 80), items });
    }
    if (body.action === 'delivered') {
        const thread = feedbackThread(value, metadata);
        const upTo = Number(body.upTo);
        if (!Number.isInteger(upTo) || upTo < 0 || upTo >= thread.length) return jsonError('Bad index', 400);
        const dd = Math.max(Number(metadata.dd) || 1, upTo + 1);
        if (dd !== metadata.dd) await store(env).patchMeta(key, 'dd', dd);
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
        await store(env).deletePrefix(`${FEEDBACK_PHOTO_PREFIX}${key}_`);
        await store(env).deletePrefix(`${SUGGEST_VOTE_PREFIX}${key}_`);
        await store(env).delete(`${FEEDBACK_DISCORD_PREFIX}${thread}`);
        // Le post, le bot le supprime lui-même ; la carte publique d'une
        // suggestion va dans sa corbeille (`card` : à vider tout de suite).
        const card = suggestionCardTrash(key, metadata);
        if (card) await trashDiscordPosts(env, ctx, [], [card]);
        return jsonResponse({ ok: true, key, ...(card ? { card: true } : {}) });
    }
    if (body.action === 'block') {
        const meta = { ...metadata, bl: true };
        await store(env).patchMeta(key, 'bl', true);
        return jsonResponse({ ok: true, ...state(meta) });
    }
    if (body.action === 'merge') {
        // Lien du post (…/channels/<serveur>/<post>) ou son numéro.
        const into = String(body.into || '').match(/(\d{5,25})\D*$/)?.[1];
        const target = into && await store(env).get(`${FEEDBACK_DISCORD_PREFIX}${into}`);
        if (!target || !FEEDBACK_KEY_RE.test(target) || target === key) return jsonError('Other report not found', 404);
        const other = await store(env).getWithMetadata(target);
        if (!other.metadata) return jsonError('Other report not found', 404);
        if (metadata.mg) return jsonError('This report is already merged into another one', 409);
        if (other.metadata.mg) return jsonError('The other report is itself merged: merge into the one it points to', 409);
        const r = await feedbackTeamUpdate(env, key, { message: FEEDBACK_MERGED_MESSAGE, extra: { mg: target } });
        if (r.error) return jsonError(r.en, r.code);
        if ((other.metadata.s || 'new') !== (r.metadata.s || 'new')) await feedbackTeamUpdate(env, key, { status: other.metadata.s || 'new', follow: false });
        const dups = [...new Set([...(other.metadata.dups || []), ...(metadata.dups || []), key])].slice(-20);
        await store(env).patchMeta(target, 'dups', dups);
        return jsonResponse({ ok: true, key, into: target, intoThread: other.metadata.dt || null });
    }
    // Où partira le correctif : la personne sera prévenue à sa sortie
    // (« both » : l'app iPhone et le site).
    if (body.action === 'fix') {
        const p = String(body.platform || '');
        if (![...FEEDBACK_RELEASE_PLATFORMS, 'both', 'none'].includes(p)) return jsonError('Bad platform', 400);
        const meta = { ...metadata };
        meta.fx = p === 'none' ? { p, at: Date.now() } : { p, at: Date.now(), done: {} };
        await store(env).patchMeta(key, 'fx', meta.fx);
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
    tvos: (v) => `Good news: the fix is out in the Apple TV app (version ${v}). Update it, then let me know if anything's still wrong.`,
    android: (v) => `Good news: the fix is out in the Android app (version ${v}). Update TwitchUnblock, then let me know if anything's still wrong.`,
};
// Sorties suivies par le bot (fix, released) : l'app iPhone, le site, l'app
// Apple TV et l'app Android. Un correctif de ces deux dernières ne pouvait
// pas être annoncé.
const FEEDBACK_RELEASE_PLATFORMS = ['ios', 'web', 'tvos', 'android'];
const FEEDBACK_RELEASE_WHERE = { ios: 'the app', web: 'the website', tvos: 'the Apple TV app', android: 'the Android app' };
const BOT_STORE_PREFIX = 'dcbot_';
const discordReportHits = new Map();
const discordReplyHits = new Map();

/** Rend une réponse si l'action est l'une des siennes, sinon null. */
async function feedbackBotTool(env, body) {
    switch (body.action) {
        // Mémoire du bot (réglages, versions vues, brouillons) : petites
        // valeurs JSON sous `dcbot_<clé>`, gardées ou pour `ttl` secondes.
        // Lue seulement par le bot (secret partagé), sauf `todo_mirror`, sa
        // copie de la liste à faire, que rend aussi /api/admin/reports?view=todo
        // (clé REPORTS_KEY) ; `todo_actions`, les cartes à marquer, est
        // remplie par cette même route (POST, queueTodoActions).
        case 'get': {
            const k = String(body.key || '');
            if (!/^[a-z0-9_:-]{1,60}$/.test(k)) return jsonError('Bad key', 400);
            let value = null;
            try { value = JSON.parse(await store(env).get(BOT_STORE_PREFIX + k) || 'null'); } catch (e) { logCaught('bot/get', e); }
            return jsonResponse({ value });
        }
        case 'set': {
            const k = String(body.key || '');
            const text = JSON.stringify(body.value ?? null);
            // La copie de la liste à faire peut être longue (300 éléments) :
            // une ligne D1 tient bien plus que 20 000 caractères.
            const max = k === 'todo_mirror' ? 400_000 : 20000;
            if (!/^[a-z0-9_:-]{1,60}$/.test(k) || text.length > max) return jsonError('Bad key or value too big', 400);
            const ttl = Number(body.ttl) || 0;
            await store(env).put(BOT_STORE_PREFIX + k, text, ttl > 0 ? { expirationTtl: Math.max(60, ttl) } : {});
            return jsonResponse({ ok: true });
        }
        // Posts et cartes de la corbeille (trashDiscordPosts) que le bot a
        // supprimés : retirés de la liste sur place, ceux ajoutés entre-temps
        // restent. Une carte (« card:<salon>:<message>:<suggestion> ») fait
        // jusqu'à 81 caractères.
        case 'trash-done': {
            const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).filter((t) => t.length <= 100).slice(0, 500);
            if (!ids.length) return jsonResponse({ ok: true });
            await ensureSchema(env);
            await env.DB.prepare(`UPDATE kv SET value = (SELECT json_group_array(o.value) FROM json_each(kv.value) AS o
                WHERE o.value NOT IN (SELECT d.value FROM json_each(?2) AS d))
                WHERE key = ?1 AND json_valid(value) AND json_type(value) = 'array'`)
                .bind(`${BOT_STORE_PREFIX}trash`, JSON.stringify(ids)).run();
            return jsonResponse({ ok: true });
        }
        // Demandes de l'outil du développeur sur les cartes de la liste à
        // faire (reportsAction, `todo`) que le bot a traitées : retirées sur
        // place, chacune seulement si carte, sens et date sont les mêmes —
        // une demande arrivée entre-temps reste, même pour la même carte.
        // Rend le nombre de demandes qui attendent encore (`left`).
        case 'todo-actions-done': {
            const items = (Array.isArray(body.items) ? body.items : []).slice(0, TODO_ACTIONS_MAX)
                .filter((x) => TODO_CARD_RE.test(String(x?.id ?? '')) && typeof x?.done === 'boolean' && Number.isSafeInteger(x?.at))
                .map((x) => ({ id: String(x.id), done: x.done, at: x.at }));
            if (!items.length) return jsonResponse({ ok: true, left: null });
            await ensureSchema(env);
            const row = await env.DB.prepare(`UPDATE kv SET value = (
                    SELECT json_group_array(json(o.value)) FROM json_each(kv.value) AS o
                    WHERE o.type = 'object' AND NOT EXISTS (SELECT 1 FROM json_each(?2) AS d
                        WHERE json_extract(d.value, '$.id') = json_extract(o.value, '$.id')
                          AND json_extract(d.value, '$.done') = json_extract(o.value, '$.done')
                          AND json_extract(d.value, '$.at') = json_extract(o.value, '$.at')))
                WHERE key = ?1 AND json_valid(value) AND json_type(value) = 'array'
                RETURNING json_array_length(value) AS n`).bind(TODO_ACTIONS_KEY, JSON.stringify(items)).first();
            return jsonResponse({ ok: true, left: row ? Number(row.n) : 0 });
        }
        // /bug et /idea sur Discord : le même retour que depuis l'app ; les
        // réponses partent en message privé (deliver), pas de jeton à garder.
        case 'create': {
            const du = String(body.user?.id || '');
            if (!/^\d{5,25}$/.test(du)) return jsonError('Bad Discord user', 400);
            if (overLimit(discordReportHits, du, 5)) return jsonError('Too many reports — try again in an hour', 429);
            const message = cleanText(body.message, 2000);
            if (message.length < 5) return jsonError('Message too short', 400);
            // Plafonds communs avec le site et les apps (FEEDBACK_PER_DAY).
            if (await dbBytes(env) > FEEDBACK_DB_MAX) return jsonError('Reports are paused (database almost full) — try again later', 429);
            if (!(await takeNtfyLimits(env, [['fbd', FEEDBACK_PER_DAY]]).catch(() => true))) {
                return jsonError('Too many reports today — try again tomorrow', 429);
            }
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
            if (await dbBytes(env) > FEEDBACK_DB_MAX) return jsonError('Replies are paused (database almost full) — try again later', 429);
            if (!(await takeNtfyLimits(env, [['fbr', FEEDBACK_REPLIES_PER_DAY]]).catch(() => true))) {
                return jsonError('Too many replies today — try again tomorrow', 429);
            }
            const photos = await photoAllowance(env, asked, `du:${m.du}`);
            if (!message && !photos.length) return jsonError('Screenshots are paused for today — try again tomorrow', 429);
            const now = Date.now();
            const first = await reserveFeedbackPhotos(env, key, photos.length);
            if (first === null) {
                await dropFeedbackPhotos(env, key, [], photos, `du:${m.du}`);
                return jsonError('Report not found', 404);
            }
            const ph = await saveFeedbackPhotos(env, key, photos, first);
            const out = await updateFeedbackThread(env, key, (th, cur) => {
                if (cur.bl) return { closed: true };
                if (th.length >= FEEDBACK_MAX_MESSAGES) return { full: true };
                th.push({ f: 'u', m: message, at: now, ...(ph.length ? { ph } : {}) });
                return { thread: th, metadata: { ...cur, u: now, r: 'u', n: (cur.n || 1) + 1 } };
            });
            // Message pas écrit : ses photos, déjà rangées et comptées, ne restent pas.
            if (!out.thread) await dropFeedbackPhotos(env, key, ph, photos, `du:${m.du}`);
            if (out.gone) return jsonError('Report not found', 404);
            if (out.closed) return jsonError('This conversation was closed by the developer', 403);
            if (out.full) return jsonError('Conversation too long', 409);
            if (out.busy) return jsonError('Busy, try again', 503);
            const next = out.metadata;
            await notifyDiscord(env, null, { ...next, m: message }, photos, { key, inReplyTo: m.m });
            return jsonResponse({ ok: true, photos: ph.length });
        }
        case 'released':
            return jsonResponse(await feedbackReleased(env, { ios: body.ios, web: body.web, tvos: body.tvos, android: body.android }));
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
            try { pause = JSON.parse(await store(env).get('push_ntfy_pause') || 'null'); } catch (e) { logCaught('ntfy/pause', e); }
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
        // résultats une fois fini — et ceux du précédent (`previous`), fini
        // puis remplacé avant son passage (POLL_PREV_KEY).
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
            return jsonResponse({ ...(await pollAdminView(env, false)), previous: await previousPoll(env) });
        // Modèles d'annonce (/announce template:), modifiés dans /stats.
        case 'announce-templates':
            return jsonResponse({ templates: await readAnnounceTemplates(env) });
    }
    return null;
}

/** État d'un retour pour le bot (actions sur un post, suggestions). */
function botReportState(key, m) {
    return {
        key, status: m.s || 'new', lastFrom: m.r || 'u',
        fix: m.fx || null, blocked: Boolean(m.bl), discord: Boolean(m.du), mergedInto: m.mg || null,
        // Suggestion (/suggest) : sa carte publique, que le bot remet à jour.
        ...(m.sg ? { suggestion: { card: m.sc || null } } : {}),
    };
}

// ── Communauté : /live, /top, /my-reports, /suggest (bot du relais) ────────
// Actions du bot, derrière le même secret partagé. Les directs viennent de la
// GQL publique de Twitch, comme pour les notifications du Worker et les pages
// du site (mêmes champs) ; le bot garde chaque réponse 60 s et limite chaque
// personne. Une suggestion est un retour de genre « idea » (donc dans
// /stats, /my-reports, réponses en message privé) marqué `sg`, avec son
// titre (`st`) et sa carte publique (`sc` : { c: salon, m: message }), où les
// membres votent. Un vote par membre : la clé `sgv_<retour>_<membre
// Discord>`, comptée à la demande — aucun compteur à tenir à jour.
const SUGGEST_VOTE_PREFIX = 'sgv_';
const SUGGEST_COOLDOWN_PREFIX = 'sgcd_';
const SUGGEST_COOLDOWN = 10 * 60 * 1000;   // entre deux suggestions d'une personne
const SUGGEST_PER_PERSON = 5;              // suggestions par jour et par personne
const SUGGEST_PER_DAY = 50;                // … en tout
const SUGGEST_VOTES_PER_DAY = 5000;        // votes et retraits par jour, en tout
const SUGGEST_VOTES_PER_PERSON = 60;       // … par heure et par membre (mémoire de l'instance)
const BOT_LOOKUPS_PER_MINUTE = 120;        // /live et /top : questions à Twitch, en tout
const BOT_READS_PER_MINUTE = 30;           // /my-reports et /suggestions, par membre
// Langues de /top (les choix de la commande), valeurs de l'énumération Language de GQL.
const BOT_TOP_LANGUAGES = new Set(['en', 'es', 'pt', 'de', 'fr', 'ru', 'ja', 'ko', 'zh', 'it', 'pl', 'tr', 'ar',
    'th', 'id', 'hi', 'uk', 'nl', 'sv', 'cs', 'hu', 'fi', 'da', 'no', 'vi']);
const botLookupHits = new Map();
const botReadHits = new Map();
const suggestVoteHits = new Map();
const openLiveHits = new Map();
// Votes encore valables de la suggestion `f` (requête corrélée ; ?1 : maintenant).
const SUGGEST_VOTES_SQL = `(SELECT COUNT(*) FROM kv v WHERE v.key >= 'sgv_' || f.key || '_' AND v.key < 'sgv_' || f.key || '\`'
    AND (v.expires IS NULL OR v.expires > ?1))`;
const SUGGEST_META_SQL = 'CASE WHEN json_valid(f.meta) THEN f.meta END';
const suggestionOpen = (m) => !m.mg && m.s !== 'done' && m.s !== 'refused';
const suggestionView = (key, m, votes) => ({
    key, title: m.st || '', status: m.s || 'new', open: suggestionOpen(m), merged: Boolean(m.mg),
    votes, thread: m.dt || null, card: m.sc || null,
});

async function suggestionVotes(env, key) {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM kv WHERE key >= ?1 AND key < ?2 AND ${alive(Date.now())}`)
        .bind(`${SUGGEST_VOTE_PREFIX}${key}_`, `${SUGGEST_VOTE_PREFIX}${key}\``).first();
    return Number(row?.n) || 0;
}

/** Un direct (GQL) tel que l'affichent /live et /top. */
function botStream(n) {
    const started = Date.parse(n?.createdAt || '');
    return {
        title: cleanText(n?.title, 200), game: cleanText(n?.game?.displayName, 80),
        viewers: Math.max(0, Number(n?.viewersCount) || 0),
        startedAt: Number.isFinite(started) ? new Date(started).toISOString() : null,
        thumb: TWITCH_IMAGE.test(String(n?.previewImageURL || '')) ? n.previewImageURL : '',
    };
}
const twitchPicture = (u) => (TWITCH_IMAGE.test(String(u || '')) ? u : '');

/** Rend une réponse si l'action est l'une des siennes, sinon null. Messages
 *  d'erreur en anglais (le bot les affiche) ; `reason`, pour qu'il les
 *  traduise. */
async function communityBotTool(env, body) {
    const twitchDown = () => jsonError('Twitch didn’t answer — try again', 502, { reason: 'twitch' });
    const busy = () => jsonError('Too many requests — try again in a minute', 429, { reason: 'busy' });
    const failed = (where) => (e) => { logCaught(where, e); return null; };
    switch (body.action) {
        // /live : la chaîne et son direct, ou la date du dernier.
        case 'live': {
            const login = String(body.login || '').trim().toLowerCase();
            if (!LOGIN_RE.test(login)) return jsonError('Bad channel name', 400);
            if (overLimit(botLookupHits, 'twitch', BOT_LOOKUPS_PER_MINUTE, 60000)) return busy();
            const data = await twitchGQL(`query($l: String!) { user(login: $l) { login displayName profileImageURL(width: 70)
                lastBroadcast { startedAt }
                stream { title viewersCount createdAt previewImageURL(width: 640, height: 360) game { displayName } } } }`, { l: login })
                .catch(failed('bot/live'));
            if (!data?.data) return twitchDown();
            const u = data.data.user;
            if (!u || !LOGIN_RE.test(String(u.login || ''))) return jsonResponse({ found: false, login });
            const last = Date.parse(u.lastBroadcast?.startedAt || '');
            return jsonResponse({
                found: true, login: u.login.toLowerCase(), name: cleanText(u.displayName, 40) || u.login,
                avatar: twitchPicture(u.profileImageURL), live: u.stream ? botStream(u.stream) : null,
                lastLive: Number.isFinite(last) ? new Date(last).toISOString() : null,
            });
        }
        // /top : les 10 plus gros directs, d'une catégorie (cherchée par son
        // nom, comme la recherche du site) et d'une langue s'il le faut.
        case 'top': {
            const language = String(body.language || '').toLowerCase();
            if (language && !BOT_TOP_LANGUAGES.has(language)) return jsonError('Unknown language', 400);
            const category = cleanText(body.category, 100).replace(/\s+/g, ' ');
            if (overLimit(botLookupHits, 'twitch', BOT_LOOKUPS_PER_MINUTE, 60000)) return busy();
            const langs = language ? [language.toUpperCase()] : null;
            let game = null;
            if (category) {
                const found = await twitchGQL(`query($q: String!) { searchCategories(query: $q, first: 5) { edges { node { id name displayName } } } }`, { q: category })
                    .catch(failed('bot/top'));
                if (!found?.data) return twitchDown();
                const list = (found.data.searchCategories?.edges || []).map((e) => e?.node).filter((n) => /^\d{1,20}$/.test(String(n?.id || '')));
                const same = (n) => [n.displayName, n.name].some((x) => String(x || '').toLowerCase() === category.toLowerCase());
                game = list.find(same) || list[0] || null;
                if (!game) return jsonResponse({ category: null, language: language || null, streams: [], notFound: true });
            }
            const fields = 'title viewersCount createdAt previewImageURL(width: 640, height: 360) game { displayName } broadcaster { login displayName profileImageURL(width: 70) }';
            const data = await twitchGQL(game
                ? `query($id: ID!, $langs: [Language!]) { game(id: $id) { streams(first: 10, options: { broadcasterLanguages: $langs }) { edges { node { ${fields} } } } } }`
                : `query($langs: [Language!]) { streams(first: 10, options: { broadcasterLanguages: $langs }) { edges { node { ${fields} } } } }`,
            game ? { id: String(game.id), langs } : { langs }).catch(failed('bot/top'));
            if (!data?.data) return twitchDown();
            const edges = (game ? data.data.game?.streams?.edges : data.data.streams?.edges) || [];
            const streams = edges.map((e) => e?.node).filter((n) => LOGIN_RE.test(String(n?.broadcaster?.login || ''))).slice(0, 10)
                .map((n) => ({
                    login: n.broadcaster.login.toLowerCase(), name: cleanText(n.broadcaster.displayName, 40) || n.broadcaster.login,
                    avatar: twitchPicture(n.broadcaster.profileImageURL), ...botStream(n),
                }));
            return jsonResponse({ category: game ? cleanText(game.displayName || game.name, 100) : null, language: language || null, streams });
        }
        // /my-reports : ce que ce membre a envoyé depuis Discord (/bug, /idea,
        // /suggest), le plus récent d'abord. Le sien seulement : le bot passe
        // l'auteur de la commande, jamais un paramètre.
        case 'my-reports': {
            const du = String(body.du || '');
            if (!/^\d{5,25}$/.test(du)) return jsonError('Bad Discord user', 400);
            if (overLimit(botReadHits, `mr:${du}`, BOT_READS_PER_MINUTE, 60000)) return busy();
            await ensureSchema(env);
            const { results } = await env.DB.prepare(`SELECT f.key AS key, f.meta AS meta, ${SUGGEST_VOTES_SQL} AS votes FROM kv f
                WHERE f.key >= 'fb_' AND f.key < 'fb\`' AND (f.expires IS NULL OR f.expires > ?1)
                  AND json_extract(${SUGGEST_META_SQL}, '$.du') = ?2
                ORDER BY f.key DESC LIMIT 11`).bind(Date.now(), du).all();
            const items = (results || []).map((r) => {
                const m = parseMeta(r.meta) || {};
                return {
                    key: r.key, kind: FEEDBACK_KINDS.includes(m.k) ? m.k : 'other', suggestion: Boolean(m.sg),
                    title: auditExcerpt(m.sg && m.st ? m.st : m.m, 80), at: Number(m.at) || 0, status: m.s || 'new',
                    merged: Boolean(m.mg), thread: m.dt || null, card: m.sc || null, ...(m.sg ? { votes: Number(r.votes) || 0 } : {}),
                };
            });
            return jsonResponse({ items: items.slice(0, 10), more: items.length > 10 });
        }
        // /suggest : titre et description. Un délai entre deux suggestions
        // d'une personne, et des plafonds du jour gardés en D1 (ceux des
        // retours compris).
        case 'suggest': {
            const du = String(body.user?.id || '');
            if (!/^\d{5,25}$/.test(du)) return jsonError('Bad Discord user', 400);
            const title = cleanText(body.title, 100).replace(/\s+/g, ' ');
            const text = cleanText(body.description, 1500);
            if (title.length < 5) return jsonError('Title too short', 400);
            if (text.length < 10) return jsonError('Description too short', 400);
            await ensureSchema(env);
            if (await dbBytes(env) > FEEDBACK_DB_MAX) return jsonError('Suggestions are paused (database almost full) — try again later', 429, { reason: 'paused' });
            const now = Date.now();
            const cooldown = `${SUGGEST_COOLDOWN_PREFIX}${du}`;
            // Délai pris d'un coup (de deux envois simultanés, un seul passe),
            // rendu si un plafond du jour refuse ensuite.
            const took = await env.DB.prepare(`INSERT INTO kv (key, value, expires) VALUES (?1, '', ?2)
                ON CONFLICT(key) DO UPDATE SET expires = excluded.expires WHERE kv.expires IS NOT NULL AND kv.expires <= ?3`)
                .bind(cooldown, now + SUGGEST_COOLDOWN, now).run();
            if (!((took?.meta?.changes || 0) > 0)) {
                const row = await env.DB.prepare('SELECT expires FROM kv WHERE key = ?1').bind(cooldown).first();
                return jsonError('One suggestion every 10 minutes — try again later', 429, { reason: 'cooldown', retryAt: Number(row?.expires) || now + SUGGEST_COOLDOWN });
            }
            if (!(await takeNtfyLimits(env, [['fbd', FEEDBACK_PER_DAY], [`sgp_${du}`, SUGGEST_PER_PERSON], ['sgd', SUGGEST_PER_DAY]]).catch(() => true))) {
                await store(env).delete(cooldown);
                return jsonError('Too many suggestions today — try again tomorrow', 429, { reason: 'daily' });
            }
            const key = `${FEEDBACK_PREFIX}${now.toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
            const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '').slice(0, 48);
            const message = `${title}\n\n${text}`;
            const entry = {
                k: 'idea', m: message, st: title, sg: 1,
                c: `@${cleanText(body.user?.name, 40) || du} (Discord)`,
                p: 'discord', v: 'Suggestion', i: null,
                at: now, s: 'new', u: now, r: 'u', n: 1, ph: 0,
                h: await sha256hex(token), du, dd: 1,
            };
            await store(env).put(key, JSON.stringify([{ f: 'u', m: message, at: now }]), { metadata: entry, expirationTtl: FEEDBACK_TTL });
            const r = await notifyDiscord(env, null, entry, [], { key });
            return jsonResponse({ ok: true, key, thread: r?.thread || null });
        }
        // Carte publique de la suggestion, postée par le bot.
        case 'suggest-card': {
            const key = String(body.key || '');
            const channel = String(body.channel || '');
            const message = String(body.message || '');
            if (!FEEDBACK_KEY_RE.test(key) || !/^\d{5,25}$/.test(channel) || !/^\d{5,25}$/.test(message)) return jsonError('Bad suggestion or message', 400);
            const { metadata: m } = await store(env).getWithMetadata(key);
            if (!m?.sg) return jsonError('Suggestion not found', 404, { reason: 'gone' });
            await store(env).patchMeta(key, 'sc', { c: channel, m: message });
            return jsonResponse({ ok: true });
        }
        // Vote d'un membre : posé, ou retiré s'il y était. Suggestion fermée
        // (faite, refusée, fusionnée) : plus de vote, son état revient pour
        // la carte.
        case 'suggest-vote': {
            const key = String(body.key || '');
            const du = String(body.du || '');
            if (!FEEDBACK_KEY_RE.test(key) || !/^\d{5,25}$/.test(du)) return jsonError('Bad suggestion or user', 400);
            if (overLimit(suggestVoteHits, du, SUGGEST_VOTES_PER_PERSON)) return busy();
            const { metadata: m } = await store(env).getWithMetadata(key);
            if (!m?.sg) return jsonError('Suggestion not found', 404, { reason: 'gone' });
            if (!suggestionOpen(m)) return jsonError('Voting is closed for this suggestion', 409, { reason: 'closed', ...suggestionView(key, m, await suggestionVotes(env, key)) });
            if (!(await takeNtfyLimits(env, [['sgv', SUGGEST_VOTES_PER_DAY]]).catch(() => true))) {
                return jsonError('Too many votes today — try again tomorrow', 429, { reason: 'daily' });
            }
            const vote = `${SUGGEST_VOTE_PREFIX}${key}_${du}`;
            const now = Date.now();
            // Posé d'un coup s'il n'y était pas (ou plus : expiré) ; sinon retiré.
            const put = await env.DB.prepare(`INSERT INTO kv (key, value, expires) VALUES (?1, '', ?2)
                ON CONFLICT(key) DO UPDATE SET expires = excluded.expires WHERE kv.expires IS NOT NULL AND kv.expires <= ?3`)
                .bind(vote, now + FEEDBACK_TTL * 1000, now).run();
            const voted = (put?.meta?.changes || 0) > 0;
            if (!voted) await store(env).delete(vote);
            return jsonResponse({ ok: true, voted, ...suggestionView(key, m, await suggestionVotes(env, key)) });
        }
        // État posé depuis la carte (Planned, Done, Declined : le développeur),
        // noté au journal comme un changement d'état (describeBotAction).
        case 'suggest-status': {
            const key = String(body.key || '');
            const status = String(body.status || '');
            if (!FEEDBACK_KEY_RE.test(key)) return jsonError('Bad suggestion', 400);
            if (!FEEDBACK_STATUSES.includes(status)) return jsonError('Unknown status', 400);
            const { metadata: m } = await store(env).getWithMetadata(key);
            if (!m?.sg) return jsonError('Suggestion not found', 404, { reason: 'gone' });
            const r = await feedbackTeamUpdate(env, key, { status });
            if (r.error) return jsonError(r.en, r.code);
            return jsonResponse({
                ok: true, ...botReportState(key, r.metadata), ...suggestionView(key, r.metadata, await suggestionVotes(env, key)),
                prev: m.s || 'new', dupThreads: r.dupThreads || [], ...(r.unchanged ? { unchanged: true } : {}),
            });
        }
        // Une suggestion, pour remettre sa carte à jour.
        case 'suggestion': {
            const key = String(body.key || '');
            if (!FEEDBACK_KEY_RE.test(key)) return jsonError('Bad suggestion', 400);
            const { metadata: m } = await store(env).getWithMetadata(key);
            if (!m?.sg) return jsonError('Suggestion not found', 404, { reason: 'gone' });
            return jsonResponse(suggestionView(key, m, await suggestionVotes(env, key)));
        }
        // /suggestions top : les 10 suggestions ouvertes les plus votées.
        case 'suggestions': {
            const du = String(body.du || '');
            if (!/^\d{5,25}$/.test(du)) return jsonError('Bad Discord user', 400);
            if (overLimit(botReadHits, `sg:${du}`, BOT_READS_PER_MINUTE, 60000)) return busy();
            await ensureSchema(env);
            const { results } = await env.DB.prepare(`SELECT f.key AS key, f.meta AS meta, ${SUGGEST_VOTES_SQL} AS votes FROM kv f
                WHERE f.key >= 'fb_' AND f.key < 'fb\`' AND (f.expires IS NULL OR f.expires > ?1)
                  AND json_extract(${SUGGEST_META_SQL}, '$.sg') = 1 AND json_extract(${SUGGEST_META_SQL}, '$.mg') IS NULL
                  AND COALESCE(json_extract(${SUGGEST_META_SQL}, '$.s'), 'new') NOT IN ('done', 'refused')
                ORDER BY votes DESC, f.key DESC LIMIT 10`).bind(Date.now()).all();
            return jsonResponse({ items: (results || []).map((r) => suggestionView(r.key, parseMeta(r.meta) || {}, Number(r.votes) || 0)) });
        }
    }
    return null;
}

/** GET /api/open/live?channel=<pseudo> — redirige (302) vers le direct dans
 *  l'app (twitchunblock://live/<pseudo>, comme le bouton des notifications
 *  ntfy) : Discord n'accepte que des liens http(s) dans ses boutons. Seul le
 *  pseudo vérifié part dans l'adresse. */
function handleOpenLive(url, request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return jsonError('Method Not Allowed', 405);
    const login = String(url.searchParams.get('channel') || '').trim().toLowerCase();
    if (!LOGIN_RE.test(login)) return jsonError('Bad channel name', 400);
    if (overLimit(openLiveHits, clientKey(request), 60, 60000)) return jsonError('Too many requests', 429);
    const target = `twitchunblock://live/${login}`;
    return new Response(`<!doctype html><meta charset="utf-8"><title>TwitchUnblock</title><p><a href="${target}">Open ${login} in TwitchUnblock</a></p>`, {
        status: 302,
        headers: { Location: target, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' },
    });
}

/**
 * Nouvelle version en ligne (le bot lit les apps — iPhone, Apple TV,
 * Android — sur GitHub et le site sur Vercel ; FEEDBACK_RELEASE_PLATFORMS) :
 * chaque retour dont le correctif l'attendait (`fx`, choisi sur
 * Discord en passant à « Done ») reçoit « c'est en ligne », ses doublons
 * aussi, et son post Discord le note. La première fois, on retient
 * seulement les versions.
 */
/** Compare deux versions (« 1.4.12 », « 2026.10.18a ») : nombres comparés en
 *  nombres, lettres en texte. < 0, 0 ou > 0. */
function compareVersions(a, b) {
    const parts = (v) => String(v).match(/\d+|[^\d.]+/g) || [];
    const x = parts(a), y = parts(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        if (x[i] === undefined) return -1;
        if (y[i] === undefined) return 1;
        const c = /^\d+$/.test(x[i]) && /^\d+$/.test(y[i]) ? Number(x[i]) - Number(y[i]) : x[i].localeCompare(y[i]);
        if (c) return c;
    }
    return 0;
}

async function feedbackReleased(env, versions) {
    const { metadata: known } = await store(env).getWithMetadata(FEEDBACK_VERSIONS_KEY);
    const prev = known || {};
    const next = { ...prev };
    const shipped = [];
    for (const p of FEEDBACK_RELEASE_PLATFORMS) {
        const v = cleanText(versions?.[p], 40);
        if (!v || v === prev[p]) continue;
        if (prev[p] && compareVersions(v, prev[p]) < 0) continue;
        next[p] = v;
        if (prev[p]) shipped.push({ p, v });
    }
    let notified = 0, complete = true;
    if (shipped.length) {
        // Seulement ceux qui attendent encore cette sortie : tous les retours
        // « correctif » restaient dans la liste, et passé 30 (les plus anciens,
        // déjà prévenus), les nouveaux ne l'étaient plus jamais.
        // « both » : l'app iPhone et le site.
        const awaits = (fx, p) => (fx.p === p || (fx.p === 'both' && (p === 'ios' || p === 'web'))) && !fx.done?.[p];
        const pending = (await listStoreKeys(env, FEEDBACK_PREFIX)).filter(({ metadata: m }) => m?.fx
            && shipped.some(({ p }) => awaits(m.fx, p)));
        // Par lots de 30 (requêtes par appel) : le reste au passage suivant du bot.
        if (pending.length > 30) complete = false;
        for (const { name } of pending.slice(0, 30)) {
            for (const { p, v } of shipped) {
                const { metadata: m } = await store(env).getWithMetadata(name);
                if (!m?.fx || !awaits(m.fx, p)) continue;
                const message = FEEDBACK_LIVE_MESSAGES[p](v);
                const fx = { ...m.fx, done: { ...(m.fx.done || {}), [p]: v } };
                const r = await feedbackTeamUpdate(env, name, { message, extra: { fx } });
                if (r.error) continue;
                notified++;
                const where = `${FEEDBACK_RELEASE_WHERE[p]} ${v}`;
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
    try { ok = (await fetch(`${relay}/health`, { signal: AbortSignal.timeout(10000) })).ok; } catch (e) { logCaught('relay/health', e); }
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
        version: m.v || '?', info: m.i || null, errors: m.el || null, at: m.at || 0,
        status: m.s || 'new', updatedAt: m.u || m.at || 0, lastFrom: m.r || 'u', count: m.n || 1, photos: m.ph || 0,
        // Dernière fois que l'admin l'a vu (« Vu », réponse ou nouvel état).
        seenAt: m.sa || 0,
    });
    const noStore = { ...RESPONSE_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

    if (request.method === 'POST') {
        let body;
        if (!(body = await readJsonObject(request))) return jsonError('JSON invalide', 400);

        // « Vu » : un retour nouveau passe à l'état « Vu », que la personne
        // voit ; ce qu'elle a écrit jusque-là n'est plus « à répondre ». Rien
        // d'autre ne lui est envoyé.
        if (typeof body.seen?.key === 'string') {
            const key = body.seen.key;
            if (!FEEDBACK_KEY_RE.test(key)) return jsonError('Clé invalide', 400);
            const now = Date.now();
            let before = 'new';
            const out = await updateFeedbackThread(env, key, (thread, metadata) => {
                before = metadata.s || 'new';
                const next = { ...metadata, sa: now };
                if (before === 'new' && thread.length < FEEDBACK_MAX_MESSAGES) {
                    thread.push({ f: 'a', s: 'seen', at: now });
                    Object.assign(next, { s: 'seen', u: now, r: 'a' });
                }
                return { thread, metadata: next };
            });
            if (out.gone) return jsonError('Retour introuvable', 404);
            if (out.busy) return jsonError('Réessaie dans un instant', 503);
            const { thread, metadata: next } = out;
            if (next.s !== before) echoTeamToDiscord(env, ctx, next, { status: next.s });
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
            // Recopié dans le post Discord du retour (salon forum), et dans
            // ceux de ses doublons qui ont suivi son état.
            echoTeamUpdate(env, ctx, r, update);
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
            await store(env).deletePrefix(`${FEEDBACK_PHOTO_PREFIX}${body.delete}_`);
            await store(env).deletePrefix(`${SUGGEST_VOTE_PREFIX}${body.delete}_`);   // votes d'une suggestion
            // Son post Discord part aussi (supprimé par le bot du relais), et
            // la carte publique d'une suggestion (nom, avatar, texte de l'auteur).
            const card = suggestionCardTrash(body.delete, metadata);
            if (metadata?.dt || card) await trashDiscordPosts(env, ctx, metadata?.dt ? [metadata.dt] : [], card ? [card] : []);
            return jsonResponse({ ok: true, deleted: 1 });
        }
        if (body.clear === true) {
            // Une requête par préfixe : une écriture par entrée dépassait le
            // plafond de requêtes D1 d'un appel (erreur 500, effacement partiel).
            const all = await listAll(FEEDBACK_PREFIX);
            const links = await listAll(FEEDBACK_DISCORD_PREFIX);
            for (const p of [FEEDBACK_PREFIX, FEEDBACK_PHOTO_PREFIX, FEEDBACK_DISCORD_PREFIX, SUGGEST_VOTE_PREFIX]) await store(env).deletePrefix(p);
            await trashDiscordPosts(env, ctx, links.map((k) => k.name.slice(FEEDBACK_DISCORD_PREFIX.length)),
                all.map((k) => suggestionCardTrash(k.name, k.metadata)).filter(Boolean));
            return jsonResponse({ ok: true, deleted: all.length });
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
        serverErrors: await readServerErrors(env),
    }), { headers: noStore });
}

// ── Retours lus (et marqués) par clé (outil du développeur) ───────────────
// GET /api/admin/reports — les retours, pour tools/reports.mjs (l'assistant
// de développement les lit depuis le PC du propriétaire, sans qu'il ait à
// les recopier) ; POST : deux changements seulement, l'état d'un retour et
// les cartes de la liste à faire du bot (voir reportsAction plus bas). Seul
// accès : le secret REPORTS_KEY du Worker (32
// caractères au moins) dans `Authorization: Bearer <clé>`, comparé en temps
// constant ; ni jeton Twitch ni secret du bot n'ouvrent cette route, et la
// clé n'ouvre rien d'autre (ni réponse, ni suppression, ni fusion, ni les
// outils de /stats). Sans le secret, la route
// répond comme une adresse inconnue (404). Clé fausse : 401 ; après
// REPORTS_FAILS essais ratés en une heure depuis une adresse (/64 en IPv6),
// 429 pour toute requête de cette adresse jusqu'à la fin de l'heure
// (mémoire de l'instance : avec une clé de 64 caractères, deviner reste
// hors de portée).
//   ?id=fb_…    un retour, discussion et textes entiers (les filtres ne comptent pas)
//   ?kind=      bug | idea (suggestions comprises) | suggestion | other | all (défaut)
//   ?status=    open (défaut : ni fait, ni refusé, ni fusionné) | all | new |
//               seen | accepted | progress | done | refused
//   ?platform=  ios | web | tvos | android | discord | all (défaut)
//   ?since=     date ISO (2026-10-13) ou durée (30m, 24h, 7d, 2w) : retours
//               actifs depuis (création, message ou changement d'état)
//   ?limit=     50 par défaut, 200 au plus : les plus récents (création) d'abord
//   ?view=todo  la liste à faire du bot Discord au lieu des retours (voir
//               reportsTodo plus bas ; les autres paramètres ne comptent pas)
//   ?view=photo&id=fb_…&n=  une photo d'un retour ou d'une réponse, en fichier
//               (voir reportsPhoto plus bas)
// Lecture bornée : une requête D1 sur la plage des clés `fb_`, parcourue de
// la plus récente à la plus ancienne et arrêtée à `limit` (+1, pour `more`) ;
// votes comptés seulement pour les suggestions rendues ; pas de photo dans
// la liste (leur nombre et leurs numéros, `photoNumbers`, à demander une à
// une avec ?view=photo). Chaque champ rendu est choisi un à un
// (reportView) : ni contact (e-mail, compte Discord), ni identifiant
// d'installation, ni adresse, ni jeton ou son empreinte, ni lien Discord ;
// les infos techniques passent par une liste blanche (reportInfo). Chaque
// lecture est notée au journal d'audit (« reports.read » : filtres et
// nombre de retours, rien de personnel ; « reports.photo » : le retour et le
// numéro de la photo).
const REPORTS_FAILS = 10;            // clés fausses par heure et par adresse
const REPORTS_LIST_DEFAULT = 50;
const REPORTS_LIST_MAX = 200;
const REPORTS_LIST_REPLIES = 5;      // derniers messages de chaque discussion, en liste
const REPORTS_LIST_TEXT = 600;       // … coupés à tant de caractères (entiers avec ?id=)
const reportsFailHits = new Map();   // adresse → { n, until } (mémoire de l'instance)
// Infos techniques jointes par le site (navigateur, page, lecteur) et les
// apps (appareil, système, build, langue) qui peuvent sortir. Un client
// modifié pourrait y glisser autre chose (un identifiant…) : jamais rendu.
const REPORT_INFO_KEYS = ['app', 'build', 'device', 'ios', 'tvos', 'android', 'os', 'browser', 'screen',
    'lang', 'page', 'watching', 'player', 'account'];

/** Même texte ? En temps constant : les empreintes SHA-256 des deux (même
 *  longueur quelle que soit l'entrée), comparées octet par octet sans
 *  s'arrêter au premier écart. */
async function sameSecret(a, b) {
    const hash = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s))));
    const [x, y] = await Promise.all([hash(a), hash(b)]);
    let diff = 0;
    for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
    return diff === 0;
}

/** Début de la période de `since` : date ISO, ou durée jusqu'à maintenant
 *  (minutes, heures, jours, semaines). null sans `since`, NaN si illisible. */
function reportsSince(v, now) {
    if (!v) return null;
    const d = /^(\d{1,4})([mhdw])$/i.exec(v);
    if (d) return now - Number(d[1]) * { m: 60000, h: 3600000, d: 86400000, w: 604800000 }[d[2].toLowerCase()];
    if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i.test(v)) return NaN;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : NaN;
}

const isoDate = (ms) => (Number(ms) > 0 ? new Date(Number(ms)).toISOString() : null);

/** Infos techniques d'un retour (JSON du client, coupé à 600 caractères —
 *  parfois au milieu : lues alors champ par champ) : seulement les champs
 *  de REPORT_INFO_KEYS, et la page sans ce qui suit « ? » ou « # ». */
function reportInfo(text) {
    if (!text) return null;
    let o = null;
    try { o = JSON.parse(text); } catch (e) { /* coupé : champ par champ */ }
    const out = {};
    if (o && typeof o === 'object' && !Array.isArray(o)) {
        for (const k of REPORT_INFO_KEYS) {
            const v = o[k];
            if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
            else if (typeof v === 'string' && v.trim()) out[k] = cleanText(v, 200);
        }
    } else {
        for (const [, k, v] of String(text).matchAll(/"([a-z]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
            if (!REPORT_INFO_KEYS.includes(k) || k in out) continue;
            try { out[k] = cleanText(JSON.parse(`"${v}"`), 200); } catch (e) { /* illisible : laissé */ }
        }
    }
    if (typeof out.page === 'string') out.page = out.page.split(/[?#]/)[0];
    return Object.keys(out).length ? out : null;
}

/** Un retour tel que le rend /api/admin/reports, champ par champ (voir plus
 *  haut). `full` : discussion et textes entiers ; sinon les
 *  REPORTS_LIST_REPLIES derniers messages, coupés. `n` : place du message
 *  dans la discussion (0 : le retour lui-même). */
function reportView(key, m, value, votes, full) {
    const thread = feedbackThread(value, m);
    const status = FEEDBACK_STATUSES.includes(m.s) ? m.s : 'new';
    const info = reportInfo(m.i);
    const cut = (s) => {
        const t = String(s ?? '');
        return full || t.length <= REPORTS_LIST_TEXT ? t : `${t.slice(0, REPORTS_LIST_TEXT - 1)}…`;
    };
    const pics = (x) => (Array.isArray(x?.ph) ? x.ph.length : 0);
    // Numéros des photos du message (clés `fbimg_<retour>_<n>`), pour ?view=photo.
    const picNumbers = (x) => x.ph.filter((v) => Number.isInteger(v) && v >= 0 && v <= REPORT_PHOTO_MAX_N);
    const entries = thread.map((x, n) => ({
        n, from: x?.f === 'a' ? 'developer' : 'user', at: isoDate(x?.at),
        ...(x?.s ? { status: String(x.s), statusLabel: FEEDBACK_STATUS_LABELS[x.s] || String(x.s) } : { text: cut(x?.m) }),
        ...(pics(x) ? { photos: pics(x), photoNumbers: picNumbers(x) } : {}),
    }));
    return {
        key, kind: FEEDBACK_KINDS.includes(m.k) ? m.k : 'other', suggestion: Boolean(m.sg),
        platform: cleanText(m.p, 20) || 'web', version: cleanText(m.v, 60) || '?',
        build: typeof info?.build === 'string' ? info.build : null,
        createdAt: isoDate(m.at), updatedAt: isoDate(m.u || m.at),
        status, statusLabel: FEEDBACK_STATUS_LABELS[status], open: status !== 'done' && status !== 'refused' && !m.mg,
        lastFrom: m.r === 'a' ? 'developer' : 'user', closed: Boolean(m.bl),
        mergedInto: FEEDBACK_KEY_RE.test(String(m.mg || '')) ? m.mg : null,
        title: auditExcerpt(m.sg && m.st ? m.st : m.m, 100), message: String(m.m ?? ''),
        ...(m.sg ? { votes: Number(votes) || 0 } : {}),
        photos: thread.reduce((n, x) => n + pics(x), 0),
        info, errors: m.el ? String(m.el) : null,
        threadLength: thread.length,
        thread: full ? entries : entries.slice(-REPORTS_LIST_REPLIES),
    };
}

/** Lecture (ou changement, reportsAction) par la clé, notée au journal
 *  d'audit (à côté de la réponse). */
async function noteReportsRead(env, ctx, detail, what = 'reports.read') {
    const note = writeAudit(env, { who: 'REPORTS_KEY', from: 'key', what, detail }).catch((e) => logCaught('audit', e));
    if (ctx?.waitUntil) ctx.waitUntil(note); else await note;
}

// ── Liste à faire du bot Discord (?view=todo) ──────────────────────────────
// Copie que le bot range dans sa mémoire (`dcbot_todo_mirror`, voir
// writeTodoMirror dans docker/discord-bot.mjs) : les cartes qu'il a postées
// dans le salon à faire (« Add to to-do », /todo), ouvertes et faites,
// relues au moins toutes les 15 min. Seule cette route la rend, derrière la
// clé des retours (l'action `get` du bot aussi, mais derrière
// FEEDBACK_BOT_SECRET). Chaque champ est choisi et vérifié un à un : liens
// Discord de la forme d'un message seulement, et pour les pièces jointes,
// liens du CDN de Discord (les fichiers n'y passent jamais). Une lecture D1 ;
// notée au journal (« todo.read » : nombre d'éléments).
const TODO_MIRROR_KEY = `${BOT_STORE_PREFIX}todo_mirror`;
const TODO_VIEW_ITEMS = 400;     // le bot en garde 350 au plus (300 ouverts, 50 faits)
const TODO_VIEW_TEXT = 1500;     // le bot coupe à 1 500 caractères…
const TODO_VIEW_CONV_TEXT = 4000; // … et une conversation (transcription) à 4 000
const TODO_VIEW_FILES = 30;       // pièces jointes d'un élément (une conversation : plusieurs messages)
const DISCORD_MESSAGE_URL_RE = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/\d{5,25}\/\d{5,25}\/\d{5,25}$/;
// Pièces jointes du message d'origine (todoAttachments du bot) : liens signés
// du CDN de Discord seulement, pour tools/reports.mjs --files.
const DISCORD_CDN_URL_RE = /^https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/attachments\/\d{5,25}\/\d{5,25}\/[^\s?#/]{1,255}(?:\?[^\s#]{0,800})?$/;

/** Pièces jointes d'un élément, champ par champ : TODO_VIEW_FILES au plus,
 *  liens du CDN de Discord seulement (les autres sont écartés). */
function todoAttachmentsView(v) {
    if (!Array.isArray(v)) return [];
    const int = (n, max) => (Number.isInteger(n) && n >= 0 && n <= max ? n : null);
    return v.slice(0, TODO_VIEW_FILES).map((a) => {
        const url = typeof a?.url === 'string' && a.url.length <= 1200 && DISCORD_CDN_URL_RE.test(a.url) ? a.url : null;
        if (!url) return null;
        const type = typeof a.type === 'string' && /^[\w.+-]{1,60}\/[\w.+-]{1,60}$/.test(a.type) ? a.type.toLowerCase() : null;
        const w = int(a.w, 100_000), h = int(a.h, 100_000);
        return {
            name: (typeof a.name === 'string' ? cleanText(a.name, 120) : '') || 'file',
            size: int(a.size, 2 ** 40) ?? 0, type, url, ...(w && h ? { w, h } : {}),
        };
    }).filter(Boolean);
}

/** Un élément de la copie, champ par champ (null s'il est illisible). */
function todoItemView(x) {
    const id = String(x?.id ?? '');
    if (!/^\d{5,25}$/.test(id)) return null;
    const str = (v, max) => (typeof v === 'string' ? cleanText(v, max) : '');
    const link = (v) => (typeof v === 'string' && DISCORD_MESSAGE_URL_RE.test(v) ? v : null);
    const files = x.files;
    // Conversation (« Add conversation to to-do ») : transcription plus
    // longue, liens du premier (origin) et du dernier message, leur nombre.
    const type = x.type === 'suggestion' || x.type === 'conversation' ? x.type : 'todo';
    const messages = type === 'conversation' && Number.isInteger(x.messages) && x.messages > 0 ? Math.min(x.messages, 200) : 0;
    return {
        id, url: link(x.url), type, done: x.done === true,
        at: isoDate(Date.parse(str(x.at, 40))), author: str(x.author, 100) || null, addedBy: str(x.addedBy, 100) || null,
        text: str(x.text, type === 'conversation' ? TODO_VIEW_CONV_TEXT : TODO_VIEW_TEXT), origin: link(x.origin),
        last: type === 'conversation' ? link(x.last) : null, messages,
        files: Number.isInteger(files) && files > 0 ? Math.min(files, 100) : 0,
        attachments: todoAttachmentsView(x.attachments),
    };
}

/** { at, items, omitted?, partial? } : `at`, date de la copie (null : pas
 *  encore de copie) ; `omitted` { open, done }, cartes vues par le bot mais
 *  pas copiées (liste trop longue) ; `partial`, le bot n'a pas lu tout le
 *  salon. */
async function reportsTodo(env, ctx) {
    let mirror = null;
    try { mirror = JSON.parse(await store(env).get(TODO_MIRROR_KEY) || 'null'); } catch (e) { logCaught('reports/todo', e); }
    const items = (Array.isArray(mirror?.items) ? mirror.items : []).slice(0, TODO_VIEW_ITEMS).map(todoItemView).filter(Boolean);
    const count = (v) => (Number.isInteger(v) && v > 0 ? v : 0);
    const omitted = { open: count(mirror?.omitted?.open), done: count(mirror?.omitted?.done) };
    const open = items.filter((x) => !x.done).length;
    await noteReportsRead(env, ctx, mirror ? `${open} open, ${items.length - open} done` : 'no copy yet', 'todo.read');
    return {
        at: isoDate(Date.parse(String(mirror?.at ?? ''))), items,
        ...(omitted.open || omitted.done ? { omitted } : {}), ...(mirror?.partial === true ? { partial: true } : {}),
    };
}

// ── Photos d'un retour (?view=photo&id=fb_…&n=) ────────────────────────────
// Une capture jointe au retour ou à une réponse, pour l'assistant qui lit les
// retours (tools/reports.mjs --photos) : mêmes clé, blocage et en-têtes que
// les retours, aucune page ne peut la lire (ni CORS ni cookie : la clé passe
// en en-tête). `n` : le numéro de la photo dans la discussion (photoNumbers
// de ?id=), celui de sa clé `fbimg_<retour>_<n>` — une lecture D1, rien
// d'autre. Rendue en fichier à télécharger (attachment, no-store, nosniff,
// aucun script), et seulement si ses octets sont bien ceux d'une image JPEG,
// PNG ou WebP : le type noté à l'envoi n'est pas cru sur parole. Notée au
// journal (« reports.photo » : le retour et le numéro).
const REPORT_PHOTO_MAX_N = 999;   // comme /api/feedback/photo
const REPORT_PHOTO_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Type d'une image d'après ses premiers octets : JPEG, PNG ou WebP
 *  (« RIFF » suivi de « WEBP » : un autre RIFF, son ou vidéo, ne passe
 *  pas), sinon null. */
function imageTypeOf(bytes) {
    const at = (i, ...v) => bytes.length >= i + v.length && v.every((x, k) => bytes[i + k] === x);
    if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
    if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
    if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
    return null;
}

async function reportsPhoto(env, ctx, url, reply) {
    const id = String(url.searchParams.get('id') || '').trim();
    if (!FEEDBACK_KEY_RE.test(id)) return reply({ error: 'Clé de retour invalide' }, 400);
    const raw = String(url.searchParams.get('n') ?? '').trim();
    if (!/^\d{1,3}$/.test(raw)) return reply({ error: `n : numéro de photo, 0 à ${REPORT_PHOTO_MAX_N}` }, 400);
    const n = Number(raw);
    const { value } = await store(env).getWithMetadata(`${FEEDBACK_PHOTO_PREFIX}${id}_${n}`);
    let bytes = null;
    if (value) { try { bytes = b64Bytes(value); } catch (e) { /* base64 illisible : refusée */ } }
    const type = bytes ? imageTypeOf(bytes) : null;
    await noteReportsRead(env, ctx, `${id} #${n}${!value ? ' — not found' : !type ? ' — refused' : ''}`, 'reports.photo');
    if (!value) return reply({ error: 'Photo introuvable' }, 404);
    if (!type) return reply({ error: 'Type refusé : seulement JPEG, PNG ou WebP' }, 415);
    return new Response(bytes, {
        headers: {
            'Content-Type': type,
            'Content-Disposition': `attachment; filename="${id}_${n}.${REPORT_PHOTO_EXT[type]}"`,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; sandbox",
        },
    });
}

// ── Changements par la clé (POST, tools/reports.mjs --done…) ───────────────
// La clé des retours fait aussi, et seulement, ces deux changements :
//   { action: 'status', key: 'fb_…', status: done | refused | accepted | progress | seen }
//     → exactement le changement d'état de /stats (handleAdminFeedback) :
//       feedbackTeamUpdate (les doublons fusionnés suivent), puis
//       « 📌 Status: … (from the developer's tool) » dans le post Discord du
//       retour et dans ceux de ses doublons — le bot du relais y remet
//       l'étiquette, demande où sortira un correctif passé à « Done » (la
//       personne est prévenue à la sortie) et transmet l'état à qui a écrit
//       depuis Discord, comme après /stats. Rend { ok, key, status,
//       previous, unchanged, kind, suggestion, title, dups }.
//   { action: 'todo', ids: ['<carte>', …], done: true | false }
//     → le Worker ne parle pas à Discord : chaque demande { id, done, at }
//       va dans la mémoire du bot (`dcbot_todo_actions`, queueTodoActions),
//       qui la relit toutes les 2 min et fait ce que font ses boutons Done
//       / Reopen. Rend { ok, done, cards: [{ id, known, wasDone, type,
//       text }] (d'après la copie de la liste, `mirrorAt`), pending, oldest }.
// Ni réponse, ni suppression, ni fusion : aucun message n'est écrit aux
// personnes (un nouvel état leur parvient comme après /stats, rien de plus).
// Chaque changement est noté au journal d'audit (qui : REPORTS_KEY, d'où :
// « key » ; « report.status », « todo.done » ou « todo.reopen »).
const REPORTS_SET_STATUSES = ['done', 'refused', 'accepted', 'progress', 'seen'];
const TODO_ACTIONS_KEY = `${BOT_STORE_PREFIX}todo_actions`;
const TODO_ACTIONS_MAX = 100;     // demandes gardées pour le bot, les plus récentes
const TODO_CARD_RE = /^\d{5,25}$/;
const REPORTS_TOOL = "the developer's tool";

/** Demandes ajoutées à la mémoire du bot sur place, en une requête, comme
 *  la corbeille (trashDiscordPosts) : relue puis réécrite, la liste perdait
 *  une demande arrivée entre les deux, ou en rendait une que le bot venait
 *  de retirer (`todo-actions-done`). Une demande par carte (la nouvelle
 *  remplace l'ancienne), les TODO_ACTIONS_MAX plus récentes. Rend la liste
 *  à jour. */
async function queueTodoActions(env, entries) {
    await ensureSchema(env);
    const row = await env.DB.prepare(`INSERT INTO kv (key, value, expires) VALUES (?1, ?2, NULL)
        ON CONFLICT(key) DO UPDATE SET expires = NULL, value = (
            SELECT json_group_array(json(e)) FROM (
                SELECT e FROM (
                    SELECT o.value AS e, json_extract(o.value, '$.at') AS at
                    FROM json_each(CASE WHEN (kv.expires IS NULL OR kv.expires > ?3) AND json_valid(kv.value)
                        AND json_type(kv.value) = 'array' THEN kv.value ELSE '[]' END) AS o
                    WHERE o.type = 'object'
                      AND json_extract(o.value, '$.id') NOT IN (SELECT json_extract(n.value, '$.id') FROM json_each(excluded.value) AS n)
                    UNION ALL
                    SELECT n.value, json_extract(n.value, '$.at') FROM json_each(excluded.value) AS n
                ) ORDER BY at DESC LIMIT ${TODO_ACTIONS_MAX}))
        RETURNING value`).bind(TODO_ACTIONS_KEY, JSON.stringify(entries), Date.now()).first();
    let list = [];
    try { list = JSON.parse(row?.value || '[]'); } catch (e) { logCaught('reports/todo-actions', e); }
    return Array.isArray(list) ? list : [];
}

async function reportsAction(request, env, ctx, reply) {
    const body = await readJsonObject(request);
    if (!body) return reply({ error: 'JSON invalide' }, 400);

    if (body.action === 'status') {
        const key = String(body.key ?? '').trim();
        const status = String(body.status ?? '').trim();
        if (!FEEDBACK_KEY_RE.test(key)) return reply({ error: 'Clé de retour invalide' }, 400);
        if (!REPORTS_SET_STATUSES.includes(status)) return reply({ error: `status : ${REPORTS_SET_STATUSES.join(', ')}` }, 400);
        // Lu d'abord : l'état d'avant et le titre, pour ce que l'outil affiche.
        const { metadata: m } = await store(env).getWithMetadata(key);
        if (!m) return reply({ error: 'Retour introuvable' }, 404);
        const update = { status };
        const r = await feedbackTeamUpdate(env, key, update);
        if (r.error) return reply({ error: r.error }, r.code);
        echoTeamUpdate(env, ctx, r, update, REPORTS_TOOL);
        await noteReportsRead(env, ctx, `${key} → ${status}${r.unchanged ? ' (unchanged)' : ''}`, 'report.status');
        return reply({
            ok: true, key, status, previous: FEEDBACK_STATUSES.includes(m.s) ? m.s : 'new', unchanged: Boolean(r.unchanged),
            kind: FEEDBACK_KINDS.includes(m.k) ? m.k : 'other', suggestion: Boolean(m.sg),
            title: auditExcerpt(m.sg && m.st ? m.st : m.m, 100),
            dups: !r.unchanged && Array.isArray(m.dups) ? Math.min(m.dups.length, 20) : 0,
        });
    }

    if (body.action === 'todo') {
        const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map((x) => String(x ?? '').trim()))] : [];
        if (!ids.length || ids.length > TODO_ACTIONS_MAX || !ids.every((x) => TODO_CARD_RE.test(x))) {
            return reply({ error: `ids : 1 à ${TODO_ACTIONS_MAX} identifiants de cartes (des chiffres)` }, 400);
        }
        if (typeof body.done !== 'boolean') return reply({ error: 'done : true ou false' }, 400);
        const at = Date.now();
        const list = await queueTodoActions(env, ids.map((id) => ({ id, done: body.done, at })));
        // Ce qu'en dit la copie de la liste (une lecture), pour l'affichage.
        let mirror = null;
        try { mirror = JSON.parse(await store(env).get(TODO_MIRROR_KEY) || 'null'); } catch (e) { logCaught('reports/todo', e); }
        const known = new Map((Array.isArray(mirror?.items) ? mirror.items : []).slice(0, TODO_VIEW_ITEMS)
            .map(todoItemView).filter(Boolean).map((x) => [x.id, x]));
        await noteReportsRead(env, ctx, `${ids.length} card(s): ${ids.join(', ')}`, body.done ? 'todo.done' : 'todo.reopen');
        const times = list.map((x) => Number(x?.at)).filter((t) => t > 0);
        return reply({
            ok: true, done: body.done,
            cards: ids.map((id) => {
                const x = known.get(id);
                return { id, known: Boolean(x), wasDone: x ? x.done : null, type: x?.type || null, text: x ? auditExcerpt(x.text, 100) : null };
            }),
            mirrorAt: isoDate(Date.parse(String(mirror?.at ?? ''))),
            pending: list.length, oldest: times.length ? isoDate(Math.min(...times)) : null,
        });
    }

    return reply({ error: 'action : status ou todo' }, 400);
}

async function handleAdminReports(request, env, ctx) {
    const secret = String(env.REPORTS_KEY || '').trim();
    // Fonction coupée (secret absent ou trop court) : comme une route inconnue.
    if (secret.length < 32 || !env.DB) return new Response('Not Found', { status: 404, headers: RESPONSE_HEADERS });
    // Pas d'en-têtes CORS : réservé à l'outil local, aucune page ne lit la réponse.
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    const reply = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { ...headers, ...extra } });
    if (request.method !== 'GET' && request.method !== 'POST') return reply({ error: 'Method Not Allowed' }, 405);
    const who = clientKey(request);
    const fails = reportsFailHits.get(who);
    if (fails && fails.until >= Date.now() && fails.n >= REPORTS_FAILS) {
        return reply({ error: 'Trop d\x27essais, réessaie dans une heure' }, 429, { 'Retry-After': String(Math.max(1, Math.ceil((fails.until - Date.now()) / 1000))) });
    }
    const given = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('Authorization') || '')?.[1] || '';
    if (!(await sameSecret(given, secret))) {
        overLimit(reportsFailHits, who, REPORTS_FAILS);
        console.warn('[reports] clé refusée');
        return reply({ error: 'Clé refusée' }, 401);
    }

    await ensureSchema(env);
    // État d'un retour, cartes de la liste à faire : mêmes clé, blocage et
    // en-têtes que la lecture.
    if (request.method === 'POST') return reportsAction(request, env, ctx, reply);
    const url = new URL(request.url);
    // La liste à faire du bot et les photos : mêmes clé, blocage et en-têtes
    // que les retours.
    const view = String(url.searchParams.get('view') || 'reports').trim().toLowerCase();
    if (view === 'todo') return reply(await reportsTodo(env, ctx));
    if (view === 'photo') return reportsPhoto(env, ctx, url, reply);
    if (view !== 'reports') return reply({ error: 'view : reports (défaut), todo ou photo' }, 400);
    const now = Date.now();
    const select = (where) => `SELECT f.key AS key, f.value AS value, f.meta AS meta,
        CASE WHEN json_extract(${SUGGEST_META_SQL}, '$.sg') = 1 THEN ${SUGGEST_VOTES_SQL} END AS votes
        FROM kv f WHERE ${where}`;

    const id = String(url.searchParams.get('id') || '').trim();
    if (id) {
        if (!FEEDBACK_KEY_RE.test(id)) return reply({ error: 'Clé de retour invalide' }, 400);
        const row = await env.DB.prepare(select('f.key = ?2 AND (f.expires IS NULL OR f.expires > ?1)')).bind(now, id).first();
        const m = parseMeta(row?.meta);
        await noteReportsRead(env, ctx, m ? id : `${id} — not found`);
        if (!m) return reply({ error: 'Retour introuvable' }, 404);
        return reply({ generatedAt: isoDate(now), item: reportView(id, m, row.value, row.votes, true) });
    }

    const param = (k) => String(url.searchParams.get(k) || '').trim().toLowerCase();
    const kind = param('kind') || 'all';
    if (!['bug', 'idea', 'suggestion', 'other', 'all'].includes(kind)) return reply({ error: 'kind : bug, idea, suggestion, other ou all' }, 400);
    const status = param('status') || 'open';
    if (!['open', 'all', ...FEEDBACK_STATUSES].includes(status)) return reply({ error: `status : open, all, ${FEEDBACK_STATUSES.join(', ')}` }, 400);
    const platform = param('platform') || 'all';
    if (!['all', 'discord', ...PLATFORMS].includes(platform)) return reply({ error: `platform : all, discord, ${PLATFORMS.join(', ')}` }, 400);
    const since = reportsSince(String(url.searchParams.get('since') || '').trim(), now);
    if (Number.isNaN(since)) return reply({ error: 'since : date ISO (2026-10-13) ou durée (30m, 24h, 7d, 2w)' }, 400);
    const asked = param('limit');
    const limit = asked ? Number(asked) : REPORTS_LIST_DEFAULT;
    if (!Number.isInteger(limit) || limit < 1) return reply({ error: `limit : 1 à ${REPORTS_LIST_MAX}` }, 400);
    const n = Math.min(limit, REPORTS_LIST_MAX);

    // Filtres dans la requête même : le parcours s'arrête aux `n` premiers
    // retours qui y répondent (aucun index sur les métadonnées).
    const meta = (path) => `json_extract(${SUGGEST_META_SQL}, '$.${path}')`;
    const binds = [now];
    const arg = (v) => { binds.push(v); return `?${binds.length}`; };
    const where = [`f.key >= 'fb_' AND f.key < 'fb\`'`, '(f.expires IS NULL OR f.expires > ?1)'];
    if (kind === 'bug' || kind === 'idea') where.push(`${meta('k')} = ${arg(kind)}`);
    else if (kind === 'suggestion') where.push(`${meta('sg')} = 1`);
    else if (kind === 'other') where.push(`COALESCE(${meta('k')}, 'other') NOT IN ('bug', 'idea')`);
    if (status === 'open') where.push(`COALESCE(${meta('s')}, 'new') NOT IN ('done', 'refused') AND ${meta('mg')} IS NULL`);
    else if (status !== 'all') where.push(`COALESCE(${meta('s')}, 'new') = ${arg(status)}`);
    if (platform !== 'all') where.push(`COALESCE(${meta('p')}, 'web') = ${arg(platform)}`);
    if (since !== null) where.push(`COALESCE(${meta('u')}, ${meta('at')}, 0) >= ${arg(since)}`);
    const sql = `${select(where.join(' AND '))} ORDER BY f.key DESC LIMIT ${arg(n + 1)}`;
    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    const rows = (results || []).filter((r) => FEEDBACK_KEY_RE.test(String(r.key)));
    const items = rows.slice(0, n).map((r) => reportView(r.key, parseMeta(r.meta) || {}, r.value, r.votes, false));
    await noteReportsRead(env, ctx, `${kind} · ${status}${platform !== 'all' ? ` · ${platform}` : ''}`
        + `${since !== null ? ` · since ${isoDate(since) || 'start'}` : ''} — ${items.length} report(s)`);
    return reply({
        generatedAt: isoDate(now), filters: { kind, status, platform, since: since === null ? null : isoDate(since), limit: n },
        count: items.length, more: rows.length > n, items,
    });
}

// ── Réactions aux annonces ───────────────────────────────────────────────
// Une réaction par appareil (identifiant aléatoire de l'app ou du site),
// modifiable ou retirable. Clé `annr_<annonce>_<appareil>`, l'emoji en
// métadonnées : le décompte (réservé à l'admin) se fait avec list(), sans
// lecture par clé. Les clés expirent une semaine après l'annonce.
const REACTIONS = ['👍', '❤️', '🔥', '😂', '👎'];
const REACTION_PREFIX = 'annr_';
const reactHits = new Map();   // adresse → { n, until } (mémoire de l'instance)

/** Appareils nouveaux par adresse (/64 en IPv6) et par jour, pour une même
 *  annonce ou un même sondage (`scope`) : l'identifiant d'appareil est libre
 *  côté client, et un UUID inventé à chaque requête comptait comme une
 *  personne de plus. Une réaction ou un vote déjà là se change sans compter
 *  ici. Plafonds du jour aussi par réseau (/48 en IPv6 : ses 65 536 /64
 *  comptaient pour autant de personnes) et en tout, toutes écritures
 *  comprises : les limites par adresse ne tiennent qu'en mémoire d'une
 *  instance, et un flot de votes vidait le quota d'écritures D1 du jour (et
 *  faussait les résultats). Un usage normal en reste loin. */
const NEW_DEVICES_PER_PERSON = 8;
const NEW_DEVICES_PER_NETWORK = 40;     // appareils nouveaux par jour et par réseau
const DEVICE_WRITES_PER_DAY = 2000;     // votes ou réactions écrits par jour, en tout
/** Une écriture de vote ou de réaction (clé `key`) pour `scope`, ou false.
 *  `known` : l'appareil a déjà voté ou réagi (relu sinon). D1 en panne :
 *  accepté. */
async function takeDeviceWrite(env, request, scope, key, known) {
    known ??= await store(env).getWithMetadata(key).then((r) => r.metadata != null).catch(() => true);
    const limits = [[`ndw_${scope}`, DEVICE_WRITES_PER_DAY]];
    if (!known) {
        limits.push([`nd_${scope}_${(await sha256hex(`${scope}|${clientKey(request)}`)).slice(0, 6)}`, NEW_DEVICES_PER_PERSON],
            [`ndn_${scope}_${(await sha256hex(`${scope}|net|${clientKey48(request)}`)).slice(0, 6)}`, NEW_DEVICES_PER_NETWORK]);
    }
    return takeNtfyLimits(env, limits).catch((e) => { logCaught('newDevice', e); return true; });
}

async function handleAnnouncementReact(request, env) {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
    if (!env.DB) return jsonError("Base D1 'DB' non liée au Worker.", 500);
    const ua = request.headers.get('User-Agent') || '';
    if (BOT_UA.test(ua)) return jsonResponse({ ok: true, ignored: true });
    // Chaque réaction est une écriture KV : 30 par heure et par adresse.
    if (overLimit(reactHits, clientKey(request), 30)) return jsonError('Trop de requêtes', 429);
    const now = Date.now();

    let body;
    if (!(body = await readJsonObject(request))) return jsonError('JSON invalide', 400);
    const device = String(body.id || '');
    if (!/^[0-9a-fA-F-]{36}$/.test(device)) return jsonError('ID invalide', 400);
    const current = await readAnnouncement(env);
    if (!current || current.id !== String(body.announcementId || '')) return jsonError('Annonce terminée', 410);
    const emoji = body.emoji == null ? null : String(body.emoji);
    if (emoji !== null && !REACTIONS.includes(emoji)) return jsonError('Réaction inconnue', 400);

    const key = `${REACTION_PREFIX}${current.id}_${device.toLowerCase()}`;
    if (emoji === null) await store(env).delete(key);
    else if (!(await takeDeviceWrite(env, request, `a${current.id}`, key))) {
        return jsonError('Trop de réactions depuis cette adresse', 429);
    } else {
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
// Sondage fini puis remplacé par un nouveau avant que le bot n'en ait posté
// les résultats (il passe toutes les 10 min) : gardé deux jours pour lui.
const POLL_PREV_KEY = 'poll_prev';
const POLL_SHOW_AFTER = 24 * 3600 * 1000;   // résultats finaux affichés 24 h
const POLL_DEVICE_RE = /^[0-9a-fA-F-]{36}$/;
const pollHits = new Map();   // adresse → { n, until } (mémoire de l'instance)
let pollCache = null;         // { value, until }
// Résultats d'un sondage : une ligne `pollc_<id>` ({"c":[par choix],"n":votants}),
// changée dans le même lot que chaque vote (pollVoteCount).
const POLL_COUNT_PREFIX = 'pollc_';

async function readPoll(env) {
    if (pollCache && pollCache.until > Date.now()) return pollCache.value;
    let value = null;
    try { value = await store(env).get(POLL_KEY, 'json'); } catch (e) { logCaught('poll/read', e); }
    if (value && !(value.until + POLL_SHOW_AFTER > Date.now())) value = null;
    pollCache = { value, until: Date.now() + 30 * 1000 };
    return value;
}

/** Fin de vie des votes d'un sondage (leur TTL, handlePollVote), et de
 *  ses compteurs. */
const pollKeepUntil = (poll) => poll.until + POLL_SHOW_AFTER + 86400 * 1000;

/** SQL : décompte complet des votes d'un sondage, en une passe sur la plage
 *  de leurs clés (lue par l'index) → {"c":[…],"n":votants}. ?1, ?2 : la
 *  plage ; ?3 : maintenant. */
function pollTallySql(poll) {
    const has = (i) => `EXISTS (SELECT 1 FROM json_each(m.o) WHERE value = ${i})`;
    return `SELECT json_object('c', json_array(${poll.options.map((_, i) => `COALESCE(SUM(${has(i)}), 0)`).join(', ')}),
            'n', COALESCE(SUM(json_array_length(m.o) > 0), 0))
        FROM (SELECT CASE WHEN json_valid(meta) THEN json_extract(meta, '$.o') END AS o FROM kv
              WHERE key >= ?1 AND key < ?2 AND (expires IS NULL OR expires > ?3)) AS m`;
}

/** Résultats d'un sondage : par choix, et nombre de votants, lus dans ses
 *  compteurs (une ligne). Avant, chaque lecture recomptait tous les votes
 *  (deux requêtes), gardée 30 s par une instance seulement. Compteurs
 *  absents (sondage lancé avant eux, effacés par /forget-user) : comptés
 *  une fois et enregistrés, dans la même requête (un vote arrivé entre-temps
 *  n'est ni perdu ni compté deux fois). `repair` (vue admin) : recomptés et
 *  réécrits quoi qu'il arrive. */
async function pollResults(env, poll, repair = false) {
    await ensureSchema(env);
    const db = env.DB;
    const now = Date.now();
    const key = `${POLL_COUNT_PREFIX}${poll.id}`;
    const range = [`${POLL_VOTE_PREFIX}${poll.id}_`, `${POLL_VOTE_PREFIX}${poll.id}\``];
    const read = db.prepare(`SELECT value FROM kv WHERE key = ?1 AND ${alive(now)}`).bind(key);
    let raw = repair ? null : await read.first('value');
    if (raw == null) {
        // Absents ou périmés : posés ; `repair` : remplacés.
        const [, got] = await db.batch([
            db.prepare(`INSERT INTO kv (key, value, expires) SELECT ?4, (${pollTallySql(poll)}), ?5 WHERE true
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires = excluded.expires
                ${repair ? '' : 'WHERE kv.expires IS NOT NULL AND kv.expires <= ?3'}`).bind(...range, now, key, pollKeepUntil(poll)),
            read,
        ]);
        raw = got?.results?.[0]?.value;
    }
    let v = null;
    try { v = JSON.parse(raw); } catch (e) { /* illisible : zéros */ }
    const c = Array.isArray(v?.c) ? v.c : [];
    return { counts: poll.options.map((_, i) => Math.max(0, Number(c[i]) || 0)), voters: Math.max(0, Number(v?.n) || 0) };
}

/** Compteurs d'un sondage corrigés du vote d'un appareil (`voteKey`) :
 *  ses choix d'avant, relus dans la base, et les nouveaux (`picks`). À
 *  mettre dans le même lot que l'écriture du vote, juste avant : le lot est
 *  une transaction, deux votes simultanés ne se comptent pas l'un sur
 *  l'autre. Sans compteurs (sondage d'avant eux) : rien, la lecture
 *  suivante compte tout (pollResults). */
function pollVoteCount(env, poll, voteKey, picks) {
    const has = (i) => `EXISTS (SELECT 1 FROM json_each((SELECT o FROM old)) WHERE value = ${i})`;
    const sets = poll.options.map((_, i) => `'$.c[${i}]', COALESCE(json_extract(value, '$.c[${i}]'), 0) + ${picks.includes(i) ? 1 : 0} - ${has(i)}`);
    sets.push(`'$.n', COALESCE(json_extract(value, '$.n'), 0) + ${picks.length ? 1 : 0} - COALESCE((SELECT json_array_length(o) > 0 FROM old), 0)`);
    return env.DB.prepare(`WITH old(o) AS (SELECT CASE WHEN json_valid(meta) THEN json_extract(meta, '$.o') END FROM kv
            WHERE key = ?2 AND (expires IS NULL OR expires > ?3))
        UPDATE kv SET value = json_set(value, ${sets.join(', ')})
        WHERE key = ?1 AND json_valid(value) AND (expires IS NULL OR expires > ?3)`)
        .bind(`${POLL_COUNT_PREFIX}${poll.id}`, voteKey, Date.now());
}

/** Le sondage précédent (POLL_PREV_KEY), fini, et ses résultats ; null sans lui. */
async function previousPoll(env) {
    let poll = null;
    try { poll = await store(env).get(POLL_PREV_KEY, 'json'); } catch (e) { logCaught('poll/prev', e); }
    if (!poll?.id || !Array.isArray(poll.options)) return null;
    return { poll: { ...poll, ended: true }, results: await pollResults(env, poll) };
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
        results: ended || mine ? await pollResults(env, poll, fresh) : null,
    };
}

// GET /api/poll, ou POST { device } (son vote en plus) → { poll, mine, results }
async function handlePollState(request, env) {
    if (!env.DB) return jsonResponse({ poll: null, mine: null, results: null });
    let device = null;
    if (request.method === 'POST') {
        const body = (await readJsonObject(request)) || {};
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
    if (!(body = await readJsonObject(request))) return jsonError('JSON invalide', 400);
    const device = String(body.device || '').toLowerCase();
    if (!POLL_DEVICE_RE.test(device)) return jsonError('ID invalide', 400);
    pollCache = null;
    const poll = await readPoll(env);
    if (!poll || poll.id !== String(body.pollId || '') || Date.now() >= poll.until) return jsonError('Sondage terminé', 410);
    const picks = [...new Set((Array.isArray(body.choices) ? body.choices : []).map(Number))]
        .filter((i) => Number.isInteger(i) && i >= 0 && i < poll.options.length).sort((a, b) => a - b);
    if (!poll.multi && picks.length > 1) return jsonError('Un seul choix', 400);
    const key = `${POLL_VOTE_PREFIX}${poll.id}_${device}`;
    // Vote d'avant : null pour un appareil nouveau, undefined si illisible.
    const before = await store(env).getWithMetadata(key).then((r) => r.metadata, (e) => { logCaught('poll/vote', e); return undefined; });
    let write;
    if (!picks.length) write = env.DB.prepare(`DELETE FROM kv WHERE key = ?1`).bind(key);
    else if (!(await takeDeviceWrite(env, request, `p${poll.id}`, key, before !== null))) {
        return jsonError('Trop de votes depuis cette adresse', 429);
    } else {
        const ttl = Math.max(60, Math.round((poll.until + POLL_SHOW_AFTER - Date.now()) / 1000) + 86400);
        write = store(env).putStatement(key, '', { expirationTtl: ttl, metadata: { o: picks } });
    }
    // Compteurs corrigés de ce vote dans la même transaction, puis le vote.
    await env.DB.batch([pollVoteCount(env, poll, key, picks), write]);
    return jsonResponse({ ok: true, ...(await pollState(env, poll, device)) });
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
    // Le sondage remplacé, s'il était fini : ses résultats restent à poster
    // par le bot (previousPoll). Lancé dans les 10 min après la fin de
    // l'autre, le nouveau les faisait perdre.
    let prev = null;
    try { prev = await store(env).get(POLL_KEY, 'json'); } catch (e) { logCaught('poll/prev', e); }
    if (prev?.id && now >= prev.until) await store(env).put(POLL_PREV_KEY, JSON.stringify(prev), { expirationTtl: 2 * 86400 });
    const poll = { id: now.toString(36), question, options, multi: body.multi === true, until: now + Math.round(hours * 3600) * 1000, createdAt: now };
    // Ses compteurs à zéro avec lui, en un lot : un vote ne peut pas arriver
    // avant eux.
    await env.DB.batch([
        store(env).putStatement(`${POLL_COUNT_PREFIX}${poll.id}`, JSON.stringify({ c: options.map(() => 0), n: 0 }),
            { expirationTtl: Math.max(60, Math.round((pollKeepUntil(poll) - now) / 1000)) }),
        store(env).putStatement(POLL_KEY, JSON.stringify(poll), { expirationTtl: Math.max(60, Math.round((poll.until + POLL_SHOW_AFTER - now) / 1000)) }),
    ]);
    pollCache = null;
    return { poll };
}

/** Fin anticipée : les résultats restent affichés 24 h. */
async function endPoll(env) {
    let poll = null;
    try { poll = await store(env).get(POLL_KEY, 'json'); } catch (e) { logCaught('poll/admin', e); }
    if (!poll) return null;
    if (Date.now() < poll.until) {
        poll.until = Date.now();
        await store(env).put(POLL_KEY, JSON.stringify(poll), { expirationTtl: Math.round(POLL_SHOW_AFTER / 1000) });
    }
    pollCache = null;
    return poll;
}

/** Sondage et tous ses résultats (admin, bot). `repair` : votes recomptés
 *  et compteurs réécrits (vue de /stats, lancement, fin) ; le passage du bot
 *  toutes les 10 minutes lit les compteurs. */
async function pollAdminView(env, repair = true) {
    pollCache = null;
    const poll = await readPoll(env);
    return { poll: poll ? { ...poll, ended: Date.now() >= poll.until } : null, results: poll ? await pollResults(env, poll, repair) : null };
}

// GET : sondage en cours et résultats. POST { question, options, multi, hours } :
// lancer ; { end: true } : terminer (résultats affichés 24 h) ; { clear: true } : retirer.
async function handleAdminPoll(request, env) {
    const { denied } = await requireAdmin(request);
    if (denied) return denied;
    if (request.method === 'GET') return jsonResponse(await pollAdminView(env));
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
    let body;
    if (!(body = await readJsonObject(request))) return jsonError('JSON invalide', 400);
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
    // `kind` : voie d'envoi (« web » ou « ntfy », celle de l'abonné), pour
    // que chaque voie lise sa file par l'index (migrateSchema).
    `CREATE TABLE IF NOT EXISTS push_queue (
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        sub  TEXT NOT NULL,
        body TEXT NOT NULL,
        at   INTEGER NOT NULL,
        kind TEXT
    )`,
];
let schemaReady = null;   // une fois par instance du Worker
function ensureSchema(env) {
    schemaReady ??= (async () => {
        await env.DB.batch(SCHEMA.map((q) => env.DB.prepare(q)));
        // Migration à part : si D1 la refusait, seules les notifications (la
        // colonne `kind` de la file) en pâtiraient, pas toute la base
        // (synchro, sondage, retours…). Retentée par la prochaine instance.
        await migrateSchema(env).catch((e) => logCaught('schema/migrate', e));
    })().catch((e) => { schemaReady = null; throw e; });
    return schemaReady;
}

// Voie d'une notification en file d'après son abonné (lignes mises en file
// avant la colonne `kind`, ou par une ancienne version pendant un
// déploiement) : l'index la trouve, sans parcourir la file.
const PUSH_QUEUE_KIND_FILL = `UPDATE push_queue SET kind = CASE WHEN
    (SELECT s.kind FROM push_subs s WHERE s.id = push_queue.sub) = 'ntfy' THEN 'ntfy' ELSE 'web' END
    WHERE kind IS NULL`;

/** Changements de schéma d'une base existante (CREATE TABLE IF NOT EXISTS ne
 *  touche pas une table déjà là). Rejouable : la colonne n'est ajoutée que
 *  si elle manque, l'index s'il manque. Lignes lues D1 : la file des
 *  notifications était parcourue en entier par chaque voie d'envoi (chaque
 *  minute) et par son ménage (toutes les 2 minutes). */
async function migrateSchema(env) {
    await addColumn(env, 'push_queue', 'kind', 'TEXT');
    await env.DB.batch([
        env.DB.prepare(`CREATE INDEX IF NOT EXISTS push_queue_kind_at ON push_queue (kind, at)`),
        env.DB.prepare(PUSH_QUEUE_KIND_FILL),
    ]);
}

/** Ajoute une colonne si elle manque ; true si ajoutée. pragma_table_info
 *  d'abord ; refusé (ou deux instances en même temps), l'erreur précise
 *  « duplicate column name » dit qu'elle existe déjà. */
async function addColumn(env, table, column, type) {
    let has = null;
    try {
        has = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM pragma_table_info(?1) WHERE name = ?2`)
            .bind(table, column).first('n')) > 0;
    } catch (e) { logCaught('schema/pragma', e); }
    if (has) return false;
    try {
        await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
        return true;
    } catch (e) {
        if (/duplicate column name/i.test(String(e?.message || e))) return false;
        throw e;
    }
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

/** Borne haute (exclue) des clés qui commencent par `prefix` : son dernier
 *  caractère suivant (« fb_ » → « fb` »). null pour un préfixe vide ou hors
 *  ASCII imprimable (le filtre substr reste seul). */
function prefixEnd(prefix) {
    if (!prefix || !/^[\x20-\x7e]+$/.test(prefix)) return null;
    return prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
}

function store(env) {
    const db = env.DB;
    const api = {
        /** L'écriture de put, à joindre à un lot (db.batch), sans le ménage. */
        putStatement(key, value, opts = {}) {
            const ttl = Number(opts.expirationTtl) || 0;
            const expires = ttl > 0 ? Date.now() + ttl * 1000 : null;
            const meta = opts.metadata == null ? null : JSON.stringify(opts.metadata);
            return db.prepare(`INSERT INTO kv (key, value, meta, expires) VALUES (?1, ?2, ?3, ?4)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, meta = excluded.meta, expires = excluded.expires`)
                .bind(key, String(value ?? ''), meta, expires);
        },
        async getWithMetadata(key, type) {
            await ensureSchema(env);
            const row = await db.prepare(`SELECT value, meta FROM kv WHERE key = ?1 AND ${alive(Date.now())}`).bind(key).first();
            if (row) {
                const json = type === 'json' || type?.type === 'json';
                let value = row.value;
                if (json) { try { value = JSON.parse(row.value); } catch (e) { value = null; } }
                // `rawMeta` : pour putIf (écriture si rien n'a bougé).
                return { value, metadata: parseMeta(row.meta), rawMeta: row.meta };
            }
            return { value: null, metadata: null };
        },
        async get(key, type) {
            return (await api.getWithMetadata(key, type)).value;
        },
        async put(key, value, opts = {}) {
            await ensureSchema(env);
            await api.putStatement(key, value, opts).run();
            // De temps en temps, ménage des entrées expirées (le KV le faisait seul).
            if (Math.random() < 0.02) await db.prepare(`DELETE FROM kv WHERE expires IS NOT NULL AND expires <= ?1`).bind(Date.now()).run();
        },
        async delete(key) {
            await ensureSchema(env);
            await db.prepare(`DELETE FROM kv WHERE key = ?1`).bind(key).run();
        },
        /** Toutes les clés d'un préfixe, en une requête : une suppression par
         *  clé dépassait le plafond de requêtes D1 d'un appel (retour très
         *  illustré, « Tout effacer » : erreur 500 et effacement partiel). */
        async deletePrefix(prefix) {
            if (!prefix) return;
            await ensureSchema(env);
            // Plage de la clé primaire : substr seul parcourait toute la table.
            const end = prefixEnd(prefix);
            await db.prepare(`DELETE FROM kv WHERE key >= ?2${end ? ' AND key < ?3' : ''} AND substr(key, 1, ?1) = ?2`)
                .bind(prefix.length, prefix, ...(end ? [end] : [])).run();
        },
        /** Écrit seulement si valeur et métadonnées sont encore celles lues
         *  (`prev` : rendu par getWithMetadata) ; false sinon. Deux réponses
         *  presque simultanées se réécrivaient l'une l'autre. */
        async putIf(key, value, opts = {}, prev = {}) {
            await ensureSchema(env);
            const ttl = Number(opts.expirationTtl) || 0;
            const expires = ttl > 0 ? Date.now() + ttl * 1000 : null;
            const meta = opts.metadata == null ? null : JSON.stringify(opts.metadata);
            const r = await db.prepare(`UPDATE kv SET value = ?2, meta = ?3, expires = ?4
                WHERE key = ?1 AND value = ?5 AND meta IS ?6 AND ${alive(Date.now())}`)
                .bind(key, String(value ?? ''), meta, expires, String(prev.value ?? ''), prev.rawMeta ?? null).run();
            return (r?.meta?.changes || 0) > 0;
        },
        /** Une métadonnée changée sur place, sans relire ni réécrire la valeur
         *  (une réponse arrivée entre la lecture et l'écriture était perdue).
         *  false si la clé n'existe pas. */
        async patchMeta(key, field, val) {
            await ensureSchema(env);
            const r = await db.prepare(`UPDATE kv SET meta = json_set(COALESCE(meta, '{}'), ?2, json(?3)) WHERE key = ?1 AND ${alive(Date.now())}`)
                .bind(key, `$.${field}`, JSON.stringify(val)).run();
            return (r?.meta?.changes || 0) > 0;
        },
        /** { keys: [{ name, metadata, expiration }], list_complete, cursor } — le curseur est la dernière clé. */
        async list({ prefix = '', limit = 1000, cursor } = {}) {
            await ensureSchema(env);
            const n = Math.min(1000, Math.max(1, Number(limit) || 1000));
            // Lu sur la plage du préfixe dans l'index de la clé, depuis le
            // curseur : `substr(key, …) = préfixe` seul ne s'en sert pas, et
            // chaque page parcourait la table depuis son début, jusqu'au bout
            // quand le préfixe a moins de 1 000 clés (toutes les lignes lues
            // D1 de la table, à chaque liste des retours de /stats). Une seule
            // borne basse : avec deux, SQLite n'en prend qu'une.
            const binds = [];
            const arg = (v) => { binds.push(v); return `?${binds.length}`; };
            const after = cursor && String(cursor) >= prefix ? String(cursor) : null;
            const where = [after !== null || !prefix ? `key > ${arg(after ?? '')}` : `key >= ${arg(prefix)}`];
            const end = prefixEnd(prefix);
            if (end) where.push(`key < ${arg(end)}`);
            if (prefix) where.push(`substr(key, 1, ${arg(prefix.length)}) = ${arg(prefix)}`);
            const { results } = await db.prepare(
                `SELECT key, meta, expires FROM kv
                 WHERE ${where.join(' AND ')} AND ${alive(Date.now())}
                 ORDER BY key LIMIT ${arg(n + 1)}`).bind(...binds).all();
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
// TWITCH_CLIENT_ID : application Twitch de connexion d'un site auto-hébergé
//                    (twitchClientId de son config.js) : ses jetons ouvrent
//                    aussi les outils d'administration (ADMIN_CLIENT_IDS).
let envApplied = false;
function applyEnvConfig(env) {
    if (envApplied) return;
    envApplied = true;
    const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
    const admins = list(env?.ADMIN_TWITCH_IDS).length ? list(env.ADMIN_TWITCH_IDS) : list(env?.OFFICIAL_ADMIN_TWITCH_IDS);
    if (admins.length) ADMIN_IDS = admins.filter((x) => /^\d{1,20}$/.test(x));
    if (list(env?.SITE_ORIGINS).length) USAGE_ORIGINS = list(env.SITE_ORIGINS);
    if (list(env?.TWITCH_CLIENT_ID).length) ADMIN_CLIENT_IDS = [...new Set([...ADMIN_CLIENT_IDS, ...list(env.TWITCH_CLIENT_ID)])];
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
    // Au repos (pushIdle), pas de passage des notifications : une lecture au
    // lieu d'une dizaine de requêtes, dont des écritures, chaque minute ;
    // dans le doute (lecture en échec), le passage habituel. Le battement
    // (ops_cron) n'est lu que par le bot Discord (opsSnapshot), qui n'entre
    // qu'avec FEEDBACK_BOT_SECRET (handleFeedbackBot) : sans lui, il n'est
    // plus écrit (une écriture par minute sur le disque de l'hôte, carte SD
    // d'un Raspberry Pi comprise, pour personne).
    const botReads = String(env.FEEDBACK_BOT_SECRET || '').length >= 16;
    const runs = await Promise.allSettled([
        pushIdle(env).catch(() => false).then((idle) => (idle ? null : pushTick(env))),
        relayWatch(env, new Date()),
        botReads ? opsCronBeat(env, 'docker') : null,
    ]);
    for (const r of runs) if (r.status === 'rejected') console.error(r.reason);
    return jsonResponse({ ok: true });
}

/** Docker : les notifications n'ont rien à faire ? Aucune chaîne suivie,
 *  file vide, aucune chaîne en mémoire (push_live) ni sujet ntfy (le ménage
 *  des 6 heures les concerne), et les nombres notés pour /stats déjà à zéro
 *  ou jamais notés (/stats compte alors les tables lui-même). pushTick, dans
 *  cet état, ne lit et n'écrit que pour constater qu'il n'y a rien. Une
 *  requête, chaque clause par la clé ou l'arrêt à la première ligne. */
async function pushIdle(env) {
    if (!env.DB) return true;
    await ensureSchema(env);
    const row = await env.DB.prepare(`SELECT
            EXISTS (SELECT 1 FROM push_follow) OR EXISTS (SELECT 1 FROM push_queue)
            OR EXISTS (SELECT 1 FROM push_live) OR EXISTS (SELECT 1 FROM push_subs WHERE kind = 'ntfy') AS busy,
            (SELECT meta FROM kv WHERE key = ?1) AS snap`).bind(PUSH_CURSOR_KEY).first();
    const snap = parseMeta(row?.snap) || {};
    return !row?.busy && !['n', 'live', 'f', 'rn', 'rl'].some((k) => Number(snap[k]) > 0);
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
const NTFY_NEW_PER_NETWORK = 10;   // … par réseau (/48 en IPv6, l'adresse en IPv4)
const NTFY_NEW_PER_DAY = 40;       // nouveaux sujets par jour, en tout
const NTFY_TESTS_PER_TOPIC = 5;    // tests par jour et par sujet
const NTFY_TESTS_PER_DAY = 40;     // tests par jour, en tout
const NTFY_LIVES_PER_TOPIC = 30;   // notifications de live par jour et par sujet
// Budget du jour de toutes les notifications de live, sous le quota de
// ntfy.sh (tests compris) : sans lui, des sujets factices abonnés à des
// chaînes populaires l'épuisaient, et la pause qui suit (ntfyPause) coupait
// les notifications de toute l'app jusqu'à minuit UTC. Les sujets de moins de
// NTFY_YOUNG_AGE n'en prennent pas plus de NTFY_YOUNG_PER_DAY : le reste va
// aux anciens. Au-delà, le message est retiré de la file sans envoi. Sans
// objet avec NTFY_TOKEN (compte payant, compté à part).
const NTFY_LIVES_PER_DAY = NTFY_FREE_DAILY - NTFY_TESTS_PER_DAY - 10;   // 200
const NTFY_YOUNG_PER_DAY = 100;
const NTFY_YOUNG_AGE = 3 * 86400000;
// Chaînes suivies (push_follow) : seule la différence est écrite, et les
// changements sont plafonnés chaque jour, par abonnement, par réseau et en
// tout, comme les chaînes nouvelles pour le serveur (push_live, relues à
// chaque vérification). Avant, chaque changement de liste réécrivait tout
// (jusqu'à 500 lignes, plus les index) : en alternant deux listes de 500
// pseudos inventés, une seule adresse vidait en une heure le quota
// d'écritures D1 du jour, et noyait les vraies chaînes à vérifier. Une
// synchro de l'app ou du site ne change que quelques chaînes.
const PUSH_CHANGES_PER_SUB = 2000;        // chaînes ajoutées ou retirées par jour et par abonnement
const PUSH_CHANGES_PER_NETWORK = 3000;    // … par réseau (/48 en IPv6, l'adresse en IPv4)
const PUSH_CHANGES_PER_DAY = 20000;       // … en tout (un jour de sortie : ~50 nouveaux abonnés à 400 chaînes)
const PUSH_NEW_LOGINS_PER_DAY = 3000;     // chaînes nouvelles pour le serveur, par jour
const PUSH_TEXT = {
    fr: { live: (n) => `${n} est en live`, test: 'Les notifications de live fonctionnent.' },
    en: { live: (n) => `${n} is live`, test: 'Live notifications are working.' },
    es: { live: (n) => `${n} está en directo`, test: 'Las notificaciones de directos funcionan.' },
    ru: { live: (n) => `${n} в эфире`, test: 'Уведомления о трансляциях работают.' },
    'zh-Hant': { live: (n) => `${n} 開台了`, test: '直播通知運作正常。' },
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

/** Schémas de lien des apps iOS : l'app, et « TU Test » (canal de test), qui
 *  a le sien — avec le même, iOS ouvrait l'une ou l'autre au toucher d'une
 *  notification. */
const APP_SCHEMES = new Set(['twitchunblock', 'twitchunblock-test']);

/** Abonnement de l'app iOS : sujet ntfy secret créé par elle. Pas de clés
 *  Web Push pour ntfy : `auth` garde le schéma du lien de clic quand ce
 *  n'est pas celui de l'app (« TU Test »). */
function readNtfySubscription(body) {
    const topic = String(body?.ntfy || '');
    if (!/^tu-[a-z0-9]{20,40}$/.test(topic)) return null;
    const scheme = String(body?.scheme || '');
    return { kind: 'ntfy', endpoint: `${NTFY_URL}/${topic}`, p256dh: '',
             auth: scheme !== 'twitchunblock' && APP_SCHEMES.has(scheme) ? scheme : '' };
}

/** Lien qui ouvre l'app d'un abonnement ntfy (`path` : « live/<chaîne> »). */
const ntfyClick = (sub, path = '') => `${APP_SCHEMES.has(sub.auth) ? sub.auth : 'twitchunblock'}://${path}`;

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

/** Clé D1 d'un compteur du jour (UTC) des plafonds ntfy (et des nouvelles
 *  installations du comptage). */
const ntfyLimitKey = (name, now = Date.now()) => `lim:${name}:${new Date(now).toISOString().slice(0, 10)}`;

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

/** Une unité (ou `n`) de chaque compteur [nom, plafond, n] si tous restent
 *  sous leur plafond ; sinon rien n'est compté, et false. Relus d'abord : un
 *  compteur déjà plein refuse sans écrire (sous un flot de requêtes, chaque
 *  refus coûtait deux écritures D1 par compteur). */
async function takeNtfyLimits(env, limits) {
    const amount = (l) => l[2] ?? 1;
    await ensureSchema(env);
    const now = await readNtfyLimits(env, limits.map(([name]) => name));
    if (limits.some((l) => (now.get(l[0]) || 0) + amount(l) > l[1])) return false;
    const after = await bumpNtfyLimits(env, limits.map((l) => [l[0], amount(l)]));
    if (after.every((v, i) => v <= limits[i][1])) return true;
    await bumpNtfyLimits(env, limits.map((l) => [l[0], -amount(l)])).catch(() => {});
    return false;
}

// Totaux du jour des notifications de live ntfy : `lim:ntl:<jour>` (tous
// les sujets) et `lim:ntly:<jour>` (sujets récents, NTFY_YOUNG_AGE), hors
// de la plage des parts `lim:ntl_<sujet>:<jour>` (« : » < « _ » < « y »).
const NTFY_LIVES_ALL = 'ntl';
const NTFY_LIVES_YOUNG = 'ntly';
/** SQL : somme du jour (?1) des parts des sujets ; `young` : seulement
 *  celles des sujets créés après ?2. */
const ntfyPartsSum = (young) => `SELECT COALESCE(SUM(${young ? 'CASE WHEN s.created > ?2 THEN CAST(k.value AS INTEGER) ELSE 0 END' : 'CAST(k.value AS INTEGER)'}), 0) AS n
    FROM kv k ${young ? 'LEFT JOIN push_subs s ON s.id = substr(k.key, 9, length(k.key) - 19)' : ''}
    WHERE k.key >= 'lim:ntl_' AND k.key < 'lim:ntl\`' AND substr(k.key, -10) = ?1`;

/** Notifications de live ntfy envoyées aujourd'hui (UTC), en tout et par
 *  les sujets récents : deux compteurs tenus à jour à chaque envoi
 *  (countNtfyLives), lus par la clé. Avant, la somme des parts de tous les
 *  sujets du jour était refaite à chaque passage qui avait des ntfy, et
 *  toutes les 5 minutes pour le bot (une jointure par sujet). Sans total du
 *  jour (aucun envoi encore, ou jour du déploiement) : cette somme. */
async function ntfyDayTotals(env, now = Date.now()) {
    const [all, young] = [ntfyLimitKey(NTFY_LIVES_ALL, now), ntfyLimitKey(NTFY_LIVES_YOUNG, now)];
    const rows = (await env.DB.prepare(`SELECT key, value FROM kv WHERE key IN (?1, ?2)`).bind(all, young).all()).results || [];
    const value = new Map(rows.map((r) => [r.key, Number(r.value) || 0]));
    if (value.has(all)) return { total: value.get(all), young: value.get(young) || 0 };
    const row = await env.DB.prepare(`SELECT COALESCE(SUM(CAST(k.value AS INTEGER)), 0) AS total,
            COALESCE(SUM(CASE WHEN s.created > ?2 THEN CAST(k.value AS INTEGER) ELSE 0 END), 0) AS young
        FROM kv k LEFT JOIN push_subs s ON s.id = substr(k.key, 9, length(k.key) - 19)
        WHERE k.key >= 'lim:ntl_' AND k.key < 'lim:ntl\`' AND substr(k.key, -10) = ?1`)
        .bind(new Date(now).toISOString().slice(0, 10), now - NTFY_YOUNG_AGE).first();
    return { total: Number(row?.total) || 0, young: Number(row?.young) || 0 };
}

/** Notifications de live ntfy envoyées (`sent` : sujet → nombre ; `young` :
 *  combien vers des sujets récents) : part de chaque sujet et totaux du
 *  jour, en un lot. Un total absent est créé avec la somme des parts du
 *  jour, celles de ce lot comprises (jour du déploiement : rien de perdu) ;
 *  présent, il augmente de ce lot seulement. */
async function countNtfyLives(env, sent, young, now = Date.now()) {
    const db = env.DB;
    const day = new Date(now).toISOString().slice(0, 10);
    const expires = (Math.floor(now / 86400000) + 1) * 86400000;
    const total = [...sent.values()].reduce((a, n) => a + n, 0);
    const keyAll = ntfyLimitKey(NTFY_LIVES_ALL, now), keyYoung = ntfyLimitKey(NTFY_LIVES_YOUNG, now);
    const ops = [
        // Toutes les parts en une instruction (le lot compte pour les
        // requêtes D1 de l'exécution, plafonnées).
        db.prepare(`INSERT INTO kv (key, value, expires) SELECT 'lim:ntl_' || j.key || ':' || ?2, j.value, ?3 FROM json_each(?1) AS j WHERE true
            ON CONFLICT(key) DO UPDATE SET value = CAST(kv.value AS INTEGER) + excluded.value`)
            .bind(JSON.stringify(Object.fromEntries(sent)), day, expires),
    ];
    ops.push(
        db.prepare(`UPDATE kv SET value = CAST(value AS INTEGER) + ?2 WHERE key = ?1`).bind(keyAll, total),
        db.prepare(`INSERT INTO kv (key, value, expires) SELECT ?2, (${ntfyPartsSum(false)}), ?3
            WHERE NOT EXISTS (SELECT 1 FROM kv WHERE key = ?2)`).bind(day, keyAll, expires),
        db.prepare(`UPDATE kv SET value = CAST(value AS INTEGER) + ?2 WHERE key = ?1`).bind(keyYoung, young),
        db.prepare(`INSERT INTO kv (key, value, expires) SELECT ?3, (${ntfyPartsSum(true)}), ?4
            WHERE NOT EXISTS (SELECT 1 FROM kv WHERE key = ?3)`).bind(day, now - NTFY_YOUNG_AGE, keyYoung, expires),
    );
    await db.batch(ops);
}

/** Valeurs du jour de ces compteurs (nom → nombre). */
async function readNtfyLimits(env, names) {
    // Pas `names.map(ntfyLimitKey)` : map passerait l'index comme `now`.
    const keys = names.map((name) => ntfyLimitKey(name));
    const rows = (await env.DB.prepare(`SELECT key, value FROM kv WHERE key IN (SELECT value FROM json_each(?1))`)
        .bind(JSON.stringify(keys)).all()).results || [];
    const byKey = new Map(rows.map((r) => [r.key, Number(r.value) || 0]));
    return new Map(names.map((name, i) => [name, byKey.get(keys[i]) || 0]));
}

/** Langue d'un abonnement : une de PUSH_TEXT (« zh-Hant » compris), sinon
 *  l'anglais. Ses propres clés seulement : « constructor » ou « __proto__ »
 *  passaient (propriétés de tout objet), et l'envoi plantait sur `.live`. */
const pushLang = (l) => (typeof l === 'string' && Object.prototype.hasOwnProperty.call(PUSH_TEXT, l) ? l : 'en');

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
    await ensureSchema(env);
    // Abonnement renouvelé par le navigateur : l'ancien (`replaces`) est
    // effacé, et ses chaînes et sa langue reprises quand le service worker,
    // qui ne les connaît pas, l'envoie seul (pushsubscriptionchange). Sans
    // cela, plus rien n'arrivait avant la visite suivante du site, et
    // l'ancien restait en base.
    const replaces = sub.kind === 'ntfy' ? '' : String(body.replaces || '');
    let oldId = null;
    if (replaces && replaces !== sub.endpoint && replaces.length <= 1000) {
        try { if (new URL(replaces).protocol === 'https:' && PUSH_HOSTS.test(new URL(replaces).hostname)) oldId = await pushIdOf(replaces); } catch (e) {}
    }
    let given = Array.isArray(body.channels) ? body.channels : [];
    let langAsked = body.lang;
    if (oldId && !Array.isArray(body.channels)) {
        given = ((await env.DB.prepare('SELECT login FROM push_follow WHERE sub = ?1').bind(oldId).all()).results || []).map((r) => r.login);
        langAsked = await env.DB.prepare('SELECT lang FROM push_subs WHERE id = ?1').bind(oldId).first('lang');
    }
    const channels = [...new Set(given
        .map((c) => String(c).toLowerCase()).filter((c) => LOGIN_RE.test(c)))].slice(0, PUSH_MAX_CHANNELS);
    const lang = pushLang(langAsked);
    const id = await pushIdOf(sub.endpoint);
    const hash = await pushIdOf(channels.slice().sort().join(','));
    const known = await env.DB.prepare('SELECT hash FROM push_subs WHERE id = ?1').bind(id).first();
    const old = known?.hash ?? null;
    const day = new Date().toISOString().slice(0, 10);
    // Nouveau sujet ntfy : plafonné par personne, par réseau et en tout,
    // chaque jour (voir NTFY_NEW_PER_PERSON). Un sujet déjà connu (synchro
    // quotidienne de l'app, chaînes changées) ne compte pas.
    let topicLimits = null;
    if (sub.kind === 'ntfy' && !known) {
        const mine = `ntn_${(await sha256hex(`ntfy|${day}|${clientKey(request)}`)).slice(0, 4)}`;
        const net = `ntnn_${(await sha256hex(`ntfy|${day}|net|${clientKey48(request)}`)).slice(0, 4)}`;
        topicLimits = [[mine, NTFY_NEW_PER_PERSON], [net, NTFY_NEW_PER_NETWORK], ['ntn', NTFY_NEW_PER_DAY]];
        if (!(await takeNtfyLimits(env, topicLimits))) {
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
        // Seule la différence est écrite, dans les plafonds du jour (voir
        // PUSH_CHANGES_PER_SUB).
        const current = known ? ((await env.DB.prepare('SELECT login FROM push_follow WHERE sub = ?1').bind(id).all()).results || []).map((r) => r.login) : [];
        const wanted = new Set(channels), had = new Set(current);
        const added = channels.filter((c) => !had.has(c));
        const removed = current.filter((c) => !wanted.has(c));
        const changes = added.length + removed.length;
        if (changes) {
            const fresh = added.length ? Number(await env.DB.prepare(`SELECT COUNT(*) AS n FROM json_each(?1) AS j
                WHERE NOT EXISTS (SELECT 1 FROM push_live l WHERE l.login = j.value)`).bind(JSON.stringify(added)).first('n')) || 0 : 0;
            const net = `pfn_${(await sha256hex(`follow|${day}|${clientKey48(request)}`)).slice(0, 4)}`;
            const limits = [[`pfs_${id}`, PUSH_CHANGES_PER_SUB, changes], [net, PUSH_CHANGES_PER_NETWORK, changes], ['pfc', PUSH_CHANGES_PER_DAY, changes]];
            if (fresh) limits.push(['pfl', PUSH_NEW_LOGINS_PER_DAY, fresh]);
            if (!(await takeNtfyLimits(env, limits))) {
                // Rien n'est écrit : le nouveau sujet n'est pas compté non plus.
                if (topicLimits) await bumpNtfyLimits(env, topicLimits.map(([name]) => [name, -1])).catch(() => {});
                return jsonError('Trop de changements de chaînes aujourd\'hui, réessaie demain', 429);
            }
        }
        if (removed.length) {
            const list = JSON.stringify(removed);
            ops.push(env.DB.prepare('DELETE FROM push_follow WHERE sub = ?1 AND login IN (SELECT value FROM json_each(?2))').bind(id, list));
            // Chaînes que plus personne ne suit : plus vérifiées dès maintenant.
            ops.push(env.DB.prepare(`DELETE FROM push_live WHERE login IN (SELECT value FROM json_each(?1))
                AND NOT EXISTS (SELECT 1 FROM push_follow f WHERE f.login = push_live.login)`).bind(list));
        }
        if (added.length) {
            const list = JSON.stringify(added);
            ops.push(env.DB.prepare('INSERT OR IGNORE INTO push_follow (login, sub) SELECT value, ?1 FROM json_each(?2)').bind(id, list));
            ops.push(env.DB.prepare(`INSERT OR IGNORE INTO push_live (login, stream) SELECT value, '?' FROM json_each(?1)`).bind(list));
        }
    }
    if (oldId && oldId !== id) {
        // Notifications en attente reprises par le nouvel abonnement ; ses
        // chaînes que plus personne ne suit, plus vérifiées.
        ops.push(env.DB.prepare('UPDATE push_queue SET sub = ?1 WHERE sub = ?2').bind(id, oldId));
        ops.push(env.DB.prepare(`DELETE FROM push_live WHERE login IN (SELECT login FROM push_follow WHERE sub = ?1)
            AND NOT EXISTS (SELECT 1 FROM push_follow f WHERE f.login = push_live.login AND f.sub != ?1)`).bind(oldId));
        ops.push(env.DB.prepare('DELETE FROM push_follow WHERE sub = ?1').bind(oldId));
        ops.push(env.DB.prepare('DELETE FROM push_subs WHERE id = ?1').bind(oldId));
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
        // Ses chaînes que plus personne ne suivra : plus vérifiées.
        env.DB.prepare(`DELETE FROM push_live WHERE login IN (SELECT login FROM push_follow WHERE sub = ?1)
            AND NOT EXISTS (SELECT 1 FROM push_follow f WHERE f.login = push_live.login AND f.sub != ?1)`).bind(id),
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
                                           click: ntfyClick(sub), tags: ['white_check_mark'] }]);
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

// Chaînes lues par vérification : PUSH_GQL_PER_RUN tranches de 100.
const PUSH_CHECK_WINDOW = PUSH_GQL_PER_RUN * 100;
// Curseur de la lecture de push_live (dernière chaîne lue), et ce que les
// vérifications en tirent pour /stats (chaînes, en live, abonnements).
const PUSH_CURSOR_KEY = 'push_live_cursor';
// Ménage des notifications toutes les 180 vérifications (6 heures).
const PUSH_TIDY_EVERY = 180;

/** Lives démarrés parmi les chaînes suivies → notifications en file. */
async function pushCheckLives(env, now, counts = {}) {
    const db = env.DB;
    const W = PUSH_CHECK_WINDOW;

    // Qui est en live, parmi les chaînes suivies : les W suivantes dans
    // l'ordre des pseudos, depuis le curseur, puis reprise au début une fois
    // au bout (la fenêtre est remplie : jusqu'à 2 × W chaînes, chacune est
    // lue au moins une vérification sur deux, ~4 min ; au-delà, chacune à
    // son tour). Avant, toute la table était relue à chaque vérification
    // (720 par jour) pour n'en vérifier que W : autant de lignes lues D1 que
    // de chaînes suivies, à chaque fois.
    const [cur, head] = await db.batch([
        db.prepare(`SELECT value, meta FROM kv WHERE key = ?1`).bind(PUSH_CURSOR_KEY),
        db.prepare(`SELECT login, stream FROM push_live
            WHERE login > COALESCE((SELECT value FROM kv WHERE key = ?1), '') ORDER BY login LIMIT ?2`).bind(PUSH_CURSOR_KEY, W),
    ]);
    const cursor = String(cur?.results?.[0]?.value || '');
    const state = parseMeta(cur?.results?.[0]?.meta) || {};
    const first = head?.results || [];
    const more = first.length < W && cursor
        ? (await db.prepare(`SELECT login, stream FROM push_live WHERE login <= ?1 ORDER BY login LIMIT ?2`)
            .bind(cursor, W - first.length).all()).results || []
        : [];
    const rows = first.concat(more);
    const known = new Map(rows.map((r) => [r.login, r.stream]));
    const logins = rows.map((r) => r.login);
    const changes = [];
    const started = [];
    for (let k = 0; k < logins.length; k += 100) {
        const slice = logins.slice(k, k + 100);
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
                // stream : le live, pour la vignette des messages ntfy (ntfyLiveMessage).
                started.push({ login, name: u.displayName || login, title: u.stream.title || '',
                               game: u.stream.game?.displayName || '', icon: u.profileImageURL || '', stream });
            }
        }
    }
    // Curseur suivant, et pour /stats le nombre de chaînes et celles en live
    // (état après cette vérification), sans compter la table à part :
    // tout lu (au plus W chaînes), ou somme des fenêtres d'un tour entier.
    const after = new Map(known);
    for (const [login, stream] of changes) after.set(login, stream);
    const liveIn = (list) => list.reduce((n, r) => n + (after.get(r.login) && after.get(r.login) !== '?' ? 1 : 0), 0);
    const snap = { ...state };
    let next = rows.length ? rows[rows.length - 1].login : '';
    if (rows.length < W) {
        next = '';
        Object.assign(snap, { n: rows.length, live: liveIn(rows), at: now, rn: 0, rl: 0 });
    } else if (first.length < W) {
        Object.assign(snap, { n: (state.rn || 0) + first.length, live: (state.rl || 0) + liveIn(first), at: now,
                              rn: more.length, rl: liveIn(more) });
    } else {
        Object.assign(snap, { rn: (state.rn || 0) + first.length, rl: (state.rl || 0) + liveIn(first) });
    }
    // Ménage toutes les 6 heures (et au premier passage) : sujets ntfy dont
    // l'app ne donne plus de nouvelles, chaînes que plus personne ne suit, et
    // le nombre d'abonnements à des chaînes (/stats). Avant : à 2 % des envois
    // à file vide, jusqu'à ~30 fois par jour, NOT IN relisant tout push_follow.
    const tidy = Math.floor(now / 120000) % PUSH_TIDY_EVERY === 0 || !Number.isFinite(state.f);

    const writes = [db.prepare(PUSH_QUEUE_KIND_FILL)];
    const queuedAt = writes.length;
    if (started.length) {
        // Voie de l'abonné notée : chaque voie lit sa file par l'index (pushSend).
        // Avant l'écriture de push_live, et seulement pour un live qu'elle n'a
        // pas encore (le lot est une transaction) : deux vérifications en même
        // temps lisent la même fenêtre (même curseur), et mettaient en file
        // deux fois chaque live qui commence.
        writes.push(db.prepare(`INSERT INTO push_queue (sub, body, at, kind)
            SELECT f.sub, j.value, ?2, CASE WHEN s.kind = 'ntfy' THEN 'ntfy' ELSE 'web' END FROM json_each(?1) j
            JOIN push_live l ON l.login = json_extract(j.value, '$.login')
                AND l.stream IS NOT json_extract(j.value, '$.stream') AND l.stream IS NOT '?'
            JOIN push_follow f ON f.login = l.login
            LEFT JOIN push_subs s ON s.id = f.sub`).bind(JSON.stringify(started), now));
    }
    if (changes.length) {
        writes.push(db.prepare(`INSERT INTO push_live (login, stream)
            SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?1) WHERE true
            ON CONFLICT(login) DO UPDATE SET stream = excluded.stream`).bind(JSON.stringify(changes)));
    }
    // Par l'index (kind, at) : seulement les notifications périmées.
    writes.push(db.prepare(`DELETE FROM push_queue WHERE kind IN ('web', 'ntfy') AND at < ?1`).bind(now - PUSH_QUEUE_TTL));
    if (tidy) {
        const idle = now - NTFY_IDLE;
        const idleSubs = `SELECT id FROM push_subs WHERE kind = 'ntfy' AND updated < ?1`;
        writes.push(
            db.prepare(`DELETE FROM push_queue WHERE sub IN (${idleSubs})`).bind(idle),
            db.prepare(`DELETE FROM push_follow WHERE sub IN (${idleSubs})`).bind(idle),
            db.prepare(`DELETE FROM push_subs WHERE kind = 'ntfy' AND updated < ?1`).bind(idle),
            db.prepare('DELETE FROM push_live WHERE NOT EXISTS (SELECT 1 FROM push_follow f WHERE f.login = push_live.login)'),
        );
    }
    const same = next === cursor && ['n', 'live', 'rn', 'rl'].every((k) => snap[k] === state[k]);
    if (!same || tidy) {
        writes.push(db.prepare(`INSERT INTO kv (key, value, meta) VALUES (?1, ?2, ?3)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, meta = excluded.meta`).bind(PUSH_CURSOR_KEY, next, JSON.stringify(snap)));
    }
    if (tidy) {
        writes.push(db.prepare(`UPDATE kv SET meta = json_set(meta, '$.f', (SELECT COUNT(*) FROM push_follow), '$.fAt', ?2)
            WHERE key = ?1`).bind(PUSH_CURSOR_KEY, now));
    }
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
    // en panne) bloquaient tout le web. Chacune par l'index (kind, at) : en
    // filtrant sur la voie de l'abonné, chaque lecture parcourait la file
    // jusqu'à trouver ses lignes (toute la file quand l'autre voie s'y
    // entassait). Même ordre qu'avant : la plus ancienne d'abord.
    const pick = (kind, n) => db.prepare(`SELECT q.id, q.body, s.id AS sid, s.kind, s.endpoint, s.p256dh, s.auth, s.lang, s.created
        FROM push_queue q JOIN push_subs s ON s.id = q.sub WHERE q.kind = ?2
        ORDER BY q.at, q.id LIMIT ?1`).bind(n, kind);
    const lanes = await db.batch([pick('web', room), ...(ntfyOn ? [pick('ntfy', PUSH_NTFY_PER_RUN)] : [])]);
    const queue = lanes.flatMap((r) => r?.results || []);
    // Ménage (sujets ntfy oubliés, chaînes que plus personne ne suit) :
    // pushCheckLives, toutes les 6 heures.
    if (!queue.length) return;
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
        // Et le budget du jour de tous (NTFY_LIVES_PER_DAY), dont les sujets
        // récents ne prennent que NTFY_YOUNG_PER_DAY.
        const sids = [...new Set(ntfyRows.map((q) => q.sid))];
        const used = await readNtfyLimits(env, sids.map((sid) => `ntl_${sid}`)).catch(() => new Map());
        // Budget du jour sans objet avec NTFY_TOKEN : pas de lecture.
        const day = env.NTFY_TOKEN ? { total: 0, young: 0 } : await ntfyDayTotals(env).catch(() => ({ total: 0, young: 0 }));
        const [budget, youngBudget] = env.NTFY_TOKEN ? [Infinity, Infinity] : [NTFY_LIVES_PER_DAY, NTFY_YOUNG_PER_DAY];
        const young = (q) => Date.now() - (Number(q.created) || 0) < NTFY_YOUNG_AGE;
        let all = day.total, recent = day.young;
        const taken = new Map();
        ntfyRows = ntfyRows.filter((q) => {
            const n = (taken.get(q.sid) ?? used.get(`ntl_${q.sid}`) ?? 0) + 1;
            taken.set(q.sid, n);
            if (n <= NTFY_LIVES_PER_TOPIC && all < budget && !(young(q) && recent >= youngBudget)) {
                all++;
                if (young(q)) recent++;
                return true;
            }
            done.push(q.id);
            return false;
        });
        if (!ntfyRows.length) return;
        // Vignette, avatar et bouton « Regarder » en plus (section « Exploitation »).
        const results = await sendNtfy(env, ntfyRows.map((q) => ntfyLiveMessage(q, notice(q))));
        // Relais en panne : un essai compté, pas un par message — ils sont
        // retentés à chaque passage, jusqu'à 30 minutes.
        if (results.length && results.every((r) => r.relay)) pushCount(counts, 'ntfy', results[0]);
        const sent = new Map();
        let sentYoung = 0;
        results.forEach((r, i) => {
            if (!r.relay) pushCount(counts, 'ntfy', r);
            if (r.status !== 429 && r.status !== 503) done.push(ntfyRows[i].id);
            if (r.status >= 200 && r.status < 300) {
                sent.set(ntfyRows[i].sid, (sent.get(ntfyRows[i].sid) || 0) + 1);
                if (young(ntfyRows[i])) sentYoung++;
            }
        });
        // Comptés une fois envoyés : un message retenté n'use pas deux fois sa
        // part. Et dans les totaux du jour (ntfyDayTotals).
        if (sent.size) {
            await countNtfyLives(env, sent, sentYoung)
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

// ═══════════════════════════════════════════════════════════════════════════
//  Exploitation : surveiller et administrer le serveur.
//
//  - Battement de la tâche planifiée (`ops_cron`) : son dernier passage. Le
//    bot du relais prévient au-delà de 5 min sans passage (et /status).
//  - État du serveur pour le bot (action `ops` de /api/feedback/discord) :
//    plafonds du jour et leur remplissage, taille de la base, ntfy (envois du
//    jour, pause), file des notifications, dernier passage de la tâche,
//    version déployée (liaison `version_metadata` de wrangler.toml).
//  - Journal d'audit (`audit_<date>_<hasard>`, 90 jours) : chaque action
//    d'administration réussie, depuis /stats, les apps ou Discord — qui,
//    quoi, quand, d'où (audited, autour des routes concernées). Lu par
//    GET /api/admin/audit.
//  - Effacement des données d'une personne : POST /api/admin/forget et
//    l'action `forget` du bot (/forget-user), aperçu d'abord ; il efface le
//    compte Twitch que l'aperçu a montré, et le journal n'en garde que les
//    sortes de données et les nombres.
//  - Messages ntfy de live enrichis : vignette, avatar, bouton « Regarder ».
//  Rien ici ne change les routes existantes ni la forme de leurs réponses
//  (sync/delete rend seulement `found` en plus, pour le journal).
// ═══════════════════════════════════════════════════════════════════════════
const OPS_CRON_KEY = 'ops_cron';
// D1 gratuit : 500 Mo par base (pleine, plus rien ne s'y écrit).
const OPS_DB_FREE = 500 * 1024 * 1024;

/** Passage de la tâche planifiée (`via` : « cron » de Cloudflare, « docker »
 *  pour la boucle de l'image), noté à chaque minute : une écriture D1. */
async function opsCronBeat(env, via) {
    if (!env.DB) return;
    await store(env).put(OPS_CRON_KEY, '', { metadata: { at: Date.now(), via } });
}

/** Version déployée : liaison `version_metadata` (identifiant, étiquette et
 *  date de la version) ; absente en Docker, où le commit de l'image
 *  (BUILD_SHA, posé par docker/entrypoint.sh) en tient lieu. null sinon. */
function workerVersion(env) {
    const m = env.CF_VERSION_METADATA;
    if (m?.id) return { id: String(m.id), tag: m.tag ? String(m.tag) : null, timestamp: m.timestamp ? String(m.timestamp) : null };
    const sha = String(env.BUILD_SHA || '').trim().toLowerCase();
    return /^[0-9a-f]{7,40}$/.test(sha) ? { id: null, tag: sha, timestamp: null } : null;
}

/** Plafonds du jour (UTC) de tout le Worker, gardés en D1 (takeNtfyLimits) :
 *  [compteur, plafond, nom affiché par le bot (en anglais, comme lui)]. */
const OPS_DAILY_CAPS = [
    ['fbd', FEEDBACK_PER_DAY, 'New reports'],
    ['fbr', FEEDBACK_REPLIES_PER_DAY, 'Replies to reports'],
    ['pnew', USAGE_NEW_PER_DAY, 'New anonymous installs counted'],
    ['ntn', NTFY_NEW_PER_DAY, 'New ntfy topics'],
    ['ntt', NTFY_TESTS_PER_DAY, 'ntfy tests'],
    ['pfc', PUSH_CHANGES_PER_DAY, 'Followed-channel changes (notifications)'],
    ['pfl', PUSH_NEW_LOGINS_PER_DAY, 'Channels new to the notifications'],
];

/** État du serveur pour le bot (alertes de pic, /status) : quelques lectures
 *  par l'index, en une requête groupée. */
async function opsSnapshot(env) {
    await ensureSchema(env);
    const db = env.DB;
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const res = await db.batch([
        db.prepare(`SELECT key, value FROM kv WHERE key IN (SELECT value FROM json_each(?1))`)
            .bind(JSON.stringify(OPS_DAILY_CAPS.map(([name]) => ntfyLimitKey(name)))),
        // Votes et réactions : un compteur par sondage ou annonce (`ndw_<p|a><id>`).
        db.prepare(`SELECT key, value FROM kv WHERE key >= 'lim:ndw_' AND key < 'lim:ndw\`' AND substr(key, -10) = ?1`).bind(day),
        db.prepare(`SELECT metric, n FROM stats_day WHERE day = ?1 AND metric IN ('fb_photo_b64', 'pu_ok_ntfy')`).bind(day),
        // Par l'index (kind, at) seul, sans une lecture de l'abonné par ligne.
        db.prepare(`SELECT kind, COUNT(*) AS n, MIN(at) AS oldest FROM push_queue GROUP BY kind`),
        db.prepare(`SELECT value FROM kv WHERE key = 'push_ntfy_pause'`),
        db.prepare(`SELECT meta FROM kv WHERE key = ?1`).bind(OPS_CRON_KEY),
    ]);
    const [fixed, devices, stats, queue, pause, cron] = res.map((r) => r?.results || []);
    // Taille de la base : D1 la donne avec chaque requête.
    const bytes = Math.max(0, ...res.map((r) => Number(r?.meta?.size_after) || 0));
    const value = new Map(fixed.map((r) => [r.key, Number(r.value) || 0]));
    const caps = OPS_DAILY_CAPS.map(([id, max, label]) => ({ id, label, n: value.get(ntfyLimitKey(id)) || 0, max }));
    for (const r of devices) {
        const scope = String(r.key).slice('lim:ndw_'.length, -11);
        caps.push({ id: `ndw_${scope}`, label: scope.startsWith('p') ? 'Poll votes' : 'Announcement reactions', n: Number(r.value) || 0, max: DEVICE_WRITES_PER_DAY });
    }
    const metric = new Map(stats.map((r) => [r.metric, Number(r.n) || 0]));
    // Photos des retours : en Mo (de base64), comme leur plafond.
    caps.push({ id: 'photos', label: 'Report screenshots (MB)', n: Math.round((metric.get('fb_photo_b64') || 0) / 1048576),
                max: Math.round(FEEDBACK_PHOTOS_PER_DAY / 1048576) });
    // Budget du jour des notifications ntfy de live (sans NTFY_TOKEN seulement).
    if (!env.NTFY_TOKEN) {
        const lives = await ntfyDayTotals(env, now).catch((e) => { logCaught('ops/ntfy', e); return null; });
        if (lives) {
            caps.push({ id: 'ntl', label: 'ntfy live notifications', n: lives.total, max: NTFY_LIVES_PER_DAY },
                { id: 'ntly', label: 'ntfy live notifications to new topics', n: lives.young, max: NTFY_YOUNG_PER_DAY });
        }
    }
    let p = null;
    try { p = JSON.parse(pause[0]?.value || 'null'); } catch (e) { /* illisible : pas de pause */ }
    const route = ntfyRoute(env);
    const lanes = { web: { n: 0, oldest: 0 }, ntfy: { n: 0, oldest: 0 } };
    for (const r of queue) {
        const lane = lanes[r.kind === 'ntfy' ? 'ntfy' : 'web'];
        lane.n += Number(r.n) || 0;
        const oldest = Number(r.oldest) || 0;
        if (oldest && (!lane.oldest || oldest < lane.oldest)) lane.oldest = oldest;
    }
    return {
        at: now,
        db: { bytes, max: OPS_DB_FREE, pauseAt: FEEDBACK_DB_MAX },
        cron: parseMeta(cron[0]?.meta),
        version: workerVersion(env),
        ntfy: { route, sentToday: metric.get('pu_ok_ntfy') || 0, quota: env.NTFY_TOKEN ? null : NTFY_FREE_DAILY,
                pausedUntil: p?.via === route && p.until > now ? p.until : 0, code: Number(p?.code) || 0 },
        queue: lanes,
        caps,
    };
}

/** Outils d'exploitation du bot (/api/feedback/discord, secret partagé) :
 *  une réponse si l'action est l'une des leurs, sinon null. */
async function opsBotTool(env, ctx, body) {
    switch (body.action) {
        case 'ops':
            return jsonResponse(await opsSnapshot(env));
        // /forget-user : aperçu, puis effacement (`dry: false`) une fois confirmé.
        case 'forget':
            return jsonResponse(await forgetPerson(env, ctx, body.who, { dry: body.dry !== false, actor: botActor(body.by) }));
        // Action du bot seul (réglages, notes de version publiées…), notée au journal.
        case 'audit': {
            const what = String(body.what || '');
            if (!/^[a-z][a-z0-9.-]{1,39}$/.test(what)) return jsonError('Bad action name', 400);
            await writeAudit(env, { ...botActor(body.by), what, detail: body.detail });
            return jsonResponse({ ok: true });
        }
    }
    return null;
}

// ── Journal d'audit ────────────────────────────────────────────────────────
const AUDIT_PREFIX = 'audit_';
const AUDIT_TTL = 90 * 86400;
// key : lecture des retours, de leurs photos ou de la liste à faire du bot
// par la clé REPORTS_KEY (handleAdminReports), et ses changements (état
// d'un retour, cartes de la liste à faire : reportsAction).
const AUDIT_FROM = ['stats', 'app', 'discord', 'key'];
const auditExcerpt = (v, max = 60) => {
    const s = cleanText(v, 400).replace(/\s+/g, ' ');
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/** Note au journal : `who` (pseudo Twitch ou nom Discord), `by` (son
 *  identifiant), `from` (stats, app, discord), `what` (l'action), `detail`. */
async function writeAudit(env, { who, by = null, from, what, detail = '' }) {
    if (!env.DB) return;
    const at = Date.now();
    const meta = { at, who: cleanText(who, 60) || '?', from: AUDIT_FROM.includes(from) ? from : 'stats', what: cleanText(what, 40),
                   ...(detail ? { detail: cleanText(detail, 300) } : {}), ...(by ? { by: cleanText(by, 40) } : {}) };
    // Date en base 36 (8 caractères jusqu'en 2059) : l'ordre des clés est celui du temps.
    await store(env).put(`${AUDIT_PREFIX}${at.toString(36)}_${crypto.randomUUID().slice(0, 6)}`, '', { metadata: meta, expirationTtl: AUDIT_TTL });
}

/** Qui agit depuis /stats ou une app : le compte Twitch du jeton (vérifié
 *  par la route, gardé en cache). /stats envoie l'en-tête Origin, les apps
 *  non. */
async function adminActor(request) {
    const who = await tokenIdentity(request).catch(() => null);
    return { who: who?.login || (who?.userId ? `#${who.userId}` : '?'), by: who?.userId ? `twitch:${who.userId}` : null,
             from: request.headers.get('Origin') ? 'stats' : 'app' };
}

/** Le membre Discord qui a agi (`by` envoyé par le bot ; un bot d'avant ne
 *  l'envoie pas). */
function botActor(by) {
    const id = /^\d{5,25}$/.test(String(by?.id || '')) ? String(by.id) : null;
    return { who: cleanText(by?.name, 60) || (id ? `#${id}` : 'Discord'), by: id ? `discord:${id}` : null, from: 'discord' };
}

/** Route d'administration dont les actions réussies (POST) vont au journal.
 *  La réponse est rendue telle quelle ; la note s'écrit à côté (waitUntil).
 *  Le corps est celui que la route a déjà lu (readJsonObject) : une réponse
 *  avec photos (2 Mo) n'est ni recopiée ni relue. Seule la réponse d'une
 *  action (quelques centaines d'octets) est relue, pour son identifiant. */
async function audited(request, env, ctx, run) {
    const res = await run(request);
    const body = parsedBodies.get(request);
    if (request.method !== 'POST' || !res.ok || !body || !env.DB) return res;
    const path = new URL(request.url).pathname;
    const bot = path === '/api/feedback/discord';
    const describe = (answer) => (bot ? describeBotAction(body, answer) : describeAdminAction(path, body, answer));
    if (!describe({})) return res;   // lecture, mémoire du bot, photo… : rien à noter
    const out = res.clone();
    const note = (async () => {
        const act = describe((await out.json().catch(() => null)) || {});
        if (act) await writeAudit(env, { ...(bot ? botActor(body.by) : await adminActor(request)), ...act });
    })().catch((e) => logCaught('audit', e));
    if (ctx?.waitUntil) ctx.waitUntil(note); else await note;
    return res;
}

/** Action de /stats ou d'une app → { what, detail }, ou null (pas une
 *  action : « Vu » sur un retour, simple lecture). */
function describeAdminAction(path, b, out) {
    switch (path) {
        case '/api/admin/usage/delete': {
            const key = String(b.key || '');
            // Comme pour l'effacement : la sorte, jamais l'identifiant.
            const target = b.target !== 'key' ? cleanText(b.target, 12)
                : key.startsWith(USAGE_ACCOUNT_PREFIX) ? 'one account' : 'one install';
            return { what: 'usage.delete', detail: `${target} — ${Number(out.deleted) || 0} deleted` };
        }
        // Ni pseudo ni identifiant de la personne : ce qui est parti, et combien.
        case '/api/admin/sync/delete':
            return { what: 'sync.delete', detail: forgetCounts(out.found) };
        case '/api/admin/announcement':
            if (Array.isArray(b.templates)) return { what: 'announce.templates', detail: `${(out.templates || []).length} template(s)` };
            if (b.clear === true) return { what: 'announce.clear' };
            return { what: b.edit === true ? 'announce.edit' : 'announce.publish', detail: auditExcerpt(out.announcement?.title || out.announcement?.message) };
        case '/api/admin/poll':
            if (b.clear === true) return { what: 'poll.clear' };
            return { what: b.end === true ? 'poll.end' : 'poll.start', detail: auditExcerpt(out.poll?.question) };
        case '/api/admin/feedback':
            if (b.seen) return null;
            if (typeof b.reply?.key === 'string') return { what: 'report.reply', detail: `${b.reply.key} — ${auditExcerpt(b.reply.message) || 'pictures'}` };
            if (typeof b.status?.key === 'string') return { what: 'report.status', detail: `${b.status.key} → ${cleanText(b.status.status, 12)}` };
            if (b.testWebhook === true) return { what: 'webhook.test' };
            if (typeof b.delete === 'string') return { what: 'report.delete', detail: b.delete };
            if (b.clear === true) return { what: 'report.clear', detail: `${Number(out.deleted) || 0} report(s)` };
            return null;
    }
    return null;
}

/** Action du bot (au nom d'un membre, `by`) → { what, detail }, ou null
 *  (lectures, mémoire du bot, retours des personnes, sorties). */
function describeBotAction(b, out) {
    const key = cleanText(out.key, 40);
    switch (b.action) {
        case 'status': return { what: 'report.status', detail: `${key} → ${cleanText(out.status || b.status, 12)}` };
        case 'reply': return { what: 'report.reply', detail: `${key} — ${auditExcerpt(b.message) || 'pictures'}` };
        case 'delete': return { what: 'report.delete', detail: key };
        case 'block': return { what: 'report.close', detail: key };
        case 'merge': return { what: 'report.merge', detail: `${key} → ${cleanText(out.into, 40)}` };
        case 'fix': return { what: 'report.fix', detail: `${key} → ${cleanText(b.platform, 10)}` };
        case 'announce':
            if (b.clear === true) return { what: 'announce.clear' };
            return { what: 'announce.publish', detail: auditExcerpt(out.announcement?.title || out.announcement?.message) };
        case 'poll': return { what: 'poll.start', detail: auditExcerpt(out.poll?.question) };
        case 'poll-end': return { what: 'poll.end', detail: auditExcerpt(out.poll?.question) };
        // Boutons d'état de la carte d'une suggestion (déjà dans cet état : rien).
        case 'suggest-status':
            return out.unchanged ? null : { what: 'report.status', detail: `${key} → ${cleanText(out.status || b.status, 12)}` };
    }
    return null;
}

// GET /api/admin/audit — le journal, du plus récent au plus ancien (300 au plus).
async function handleAdminAudit(request, env) {
    const { denied } = await requireAdmin(request);
    if (denied) return denied;
    if (!env.DB) return jsonError("Base D1 'DB' non liée au Worker.", 500);
    await ensureSchema(env);
    const { results } = await env.DB.prepare(`SELECT meta FROM kv WHERE key >= ?1 AND key < ?2 AND ${alive(Date.now())}
        ORDER BY key DESC LIMIT 300`).bind(AUDIT_PREFIX, 'audit`').all();
    const entries = (results || []).map((r) => parseMeta(r.meta)).filter(Boolean);
    return new Response(JSON.stringify({ entries, days: AUDIT_TTL / 86400 }), {
        headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
}

// ── Effacement des données d'une personne ─────────────────────────────────
// Ce qui se rattache à quoi : un compte Twitch a sa sauvegarde (`user_<id>`),
// ses réglages synchronisés (`prefs_<id>`) et son entrée du comptage
// (`usage_a_<id>`) ; un identifiant d'installation (ou de navigateur), son
// entrée du comptage (`usage_<id>`), ses votes (`pollv_<sondage>_<id>`) et
// ses réactions (`annr_<annonce>_<id>`). Les retours ne gardent ni compte ni
// installation (seulement le compte Discord de qui a écrit avec /bug), et un
// abonnement aux notifications non plus : on les désigne eux-mêmes — clé du
// retour ou lien de son post, compte Discord, sujet ntfy (tu-…) ou adresse
// d'envoi Web Push. Un retour part avec ses photos, sa discussion, son post
// Discord et, pour une suggestion, sa carte publique (corbeille du bot).
const FORGET_MAX = 10;
const FORGET_FOUND = ['sync', 'settings', 'usage', 'votes', 'reactions', 'reports', 'pictures', 'posts', 'cards', 'subscriptions', 'channels'];
/** Ce qu'un effacement a emporté, par sorte et en nombre (« sync 1, usage
 *  2 ») : tout ce que le journal en garde, rien qui désigne la personne. */
const forgetCounts = (found) => FORGET_FOUND.filter((k) => Number(found?.[k]) > 0)
    .map((k) => `${k} ${Number(found[k])}`).join(', ') || 'nothing stored';
// Photos des retours de la liste JSON `?1` : clés `fbimg_<retour>_<n>`.
const FORGET_PHOTOS = `key >= 'fbimg_' AND key < 'fbimg\`'
    AND EXISTS (SELECT 1 FROM json_each(?1) AS j WHERE substr(kv.key, 7, length(j.value) + 1) = j.value || '_')`;

const pushEndpointOk = (s) => {
    try { const u = new URL(s); return u.protocol === 'https:' && PUSH_HOSTS.test(u.hostname) && s.length <= 1000; }
    catch (e) { return false; }
};

/** Identifiants reconnus dans un texte libre (espaces, virgules) : 10 au
 *  plus. Un nombre de 15 chiffres et plus est de Discord (post ou personne),
 *  un plus court un identifiant Twitch ; « @nom » force un pseudo. `kept` :
 *  le reste de ce qui est reconnu, tel qu'écrit. */
function parseForgetTargets(raw) {
    const t = { twitch: [], logins: [], installs: [], reports: [], posts: [], discord: [], snowflakes: [], subs: [], unknown: [], kept: [] };
    const tokens = [...new Set(String(raw ?? '').split(/[\s,;]+/).filter(Boolean))];
    for (const tok of tokens.slice(0, FORGET_MAX)) {
        let m;
        if ((m = /^<@!?(\d{5,25})>$/.exec(tok))) t.discord.push(m[1]);
        else if ((m = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/\d+\/(\d{5,25})(?:\/\d+)?\/?$/.exec(tok))) t.posts.push(m[1]);
        else if (FEEDBACK_KEY_RE.test(tok)) t.reports.push(tok);
        else if (/^[0-9a-fA-F-]{36}$/.test(tok)) t.installs.push(tok);
        else if ((m = /^(?:https:\/\/ntfy\.sh\/)?(tu-[a-z0-9]{20,40})$/.exec(tok))) t.subs.push({ endpoint: `${NTFY_URL}/${m[1]}`, label: `ntfy topic ${m[1].slice(0, 7)}…` });
        else if (pushEndpointOk(tok)) t.subs.push({ endpoint: tok, label: `Web Push (${new URL(tok).hostname})` });
        else if (/^\d{15,25}$/.test(tok)) t.snowflakes.push(tok);
        else if (/^\d{1,14}$/.test(tok)) { t.twitch.push(tok); continue; }
        else if ((m = /^@?([A-Za-z0-9_]{1,25})$/.exec(tok))) { t.logins.push(m[1].toLowerCase()); continue; }
        else { t.unknown.push(tok.slice(0, 40)); continue; }
        t.kept.push(tok);
    }
    if (tokens.length > FORGET_MAX) t.unknown.push(`+${tokens.length - FORGET_MAX} more (${FORGET_MAX} at most)`);
    return t;
}

/** Comptes Twitch par identifiant et par pseudo (10 au plus), en une
 *  requête : Map « id:… » ou « login:… » → { id, login } de ceux qui
 *  existent, ou null si Twitch n'a pas répondu. */
async function forgetAccounts(ids, logins) {
    const asks = [...ids.map((v) => ['id', 'ID', v]), ...logins.map((v) => ['login', 'String', v])];
    const out = new Map();
    if (!asks.length) return out;
    let data = null;
    try {
        data = (await twitchGQL(`query(${asks.map(([, type], i) => `$v${i}: ${type}!`).join(', ')}) {
            ${asks.map(([by], i) => `a${i}: user(${by}: $v${i}) { id login }`).join(' ')} }`,
        Object.fromEntries(asks.map(([, , v], i) => [`v${i}`, v]))))?.data;
    } catch (e) { logCaught('forget/twitch', e); }
    if (!data) return null;
    asks.forEach(([by, , v], i) => {
        const u = data[`a${i}`];
        // 14 chiffres au plus : renvoyé dans `who`, il se relit comme un compte Twitch.
        if (/^\d{1,14}$/.test(String(u?.id || '')) && LOGIN_RE.test(String(u.login || ''))) {
            out.set(`${by}:${v}`, { id: String(u.id), login: String(u.login).toLowerCase() });
        }
    });
    return out;
}

/**
 * Aperçu (`dry`, par défaut) ou effacement des données désignées par `raw`.
 * Rend { ok, dry, targets: [{ kind, label }], unknown: [texte], found:
 * { catégorie: nombre }, who } ; `who` : ce qui a été reconnu, chaque
 * pseudo remplacé par l'identifiant du compte trouvé — le texte que la
 * confirmation renvoie. L'effacement ne prend que des identifiants Twitch :
 * il efface le compte que l'aperçu a montré (identifiant et pseudo actuel),
 * même si le pseudo a changé de main entre-temps. Il est noté au journal
 * (`actor`) par sortes de données et nombres seulement, sans rien qui
 * désigne la personne.
 * Une dizaine de requêtes D1 en tout, quel que soit le nombre de clés (listes
 * en JSON) : un Worker gratuit en a 50 par appel.
 */
async function forgetPerson(env, ctx, raw, { dry = true, actor = null } = {}) {
    await ensureSchema(env);
    const db = env.DB;
    const live = alive(Date.now());
    const t = parseForgetTargets(raw);
    const targets = [];
    const unknown = [...t.unknown];
    const found = Object.fromEntries(FORGET_FOUND.map((k) => [k, 0]));
    // Comptes Twitch : identifiant → pseudo actuel ('' : plus de compte ;
    // null : Twitch n'a pas répondu). Un pseudo n'est cherché qu'à l'aperçu.
    const logins = dry ? [...new Set(t.logins)] : [];
    if (!dry) for (const l of t.logins) unknown.push(`@${l} (erasing needs the Twitch ID: preview first)`);
    const twitch = await forgetAccounts(t.twitch, logins);
    const accounts = new Map(t.twitch.map((id) => [id, twitch ? twitch.get(`id:${id}`)?.login || '' : null]));
    for (const l of logins) {
        const u = twitch?.get(`login:${l}`);
        if (u) accounts.set(u.id, u.login);
        else unknown.push(twitch ? `@${l} (no such Twitch account)` : `@${l} (Twitch didn’t answer: try again)`);
    }
    for (const [id, login] of accounts) {
        targets.push({ kind: 'twitch', label: `Twitch #${id}${login ? ` (@${login})` : login === '' ? ' (no Twitch account now)' : ''}` });
    }
    for (const d of t.installs) targets.push({ kind: 'install', label: `install ${d.slice(0, 8)}…` });
    for (const k of t.reports) targets.push({ kind: 'report', label: k });
    for (const p of t.posts) targets.push({ kind: 'post', label: `Discord post ${p}` });
    for (const d of t.discord) targets.push({ kind: 'discord', label: `Discord user ${d}` });
    for (const s of t.snowflakes) targets.push({ kind: 'discord', label: `Discord ${s}` });
    for (const s of t.subs) targets.push({ kind: 'subscription', label: s.label });

    // Clés connues d'avance → catégorie (`link` : post Discord → retour).
    const kinds = new Map();
    for (const id of accounts.keys()) {
        kinds.set(`user_${id}`, 'sync');
        kinds.set(`prefs_${id}`, 'settings');   // réglages synchronisés (/api/sync/prefs)
        kinds.set(`${USAGE_ACCOUNT_PREFIX}${id}`, 'usage');
    }
    // L'app iPhone envoie son identifiant en majuscules, le site en minuscules.
    for (const d of t.installs) for (const v of [d, d.toLowerCase(), d.toUpperCase()]) kinds.set(`${USAGE_PREFIX}${v}`, 'usage');
    for (const p of [...t.posts, ...t.snowflakes]) kinds.set(`${FEEDBACK_DISCORD_PREFIX}${p}`, 'link');
    const devices = [...new Set(t.installs.map((d) => d.toLowerCase()))];
    const people = [...new Set([...t.discord, ...t.snowflakes])];
    const reads = [];
    if (kinds.size) reads.push(['have', db.prepare(`SELECT key, value FROM kv WHERE key IN (SELECT value FROM json_each(?1)) AND ${live}`).bind(JSON.stringify([...kinds.keys()]))]);
    if (devices.length) {
        reads.push(['votes', db.prepare(`SELECT key FROM kv WHERE ((key >= 'pollv_' AND key < 'pollv\`') OR (key >= 'annr_' AND key < 'annr\`'))
            AND lower(substr(key, -36)) IN (SELECT value FROM json_each(?1)) AND ${live}`).bind(JSON.stringify(devices))]);
    }
    // Retours écrits depuis Discord (/bug) : le compte Discord est gardé (`du`).
    if (people.length) {
        reads.push(['discord', db.prepare(`SELECT key FROM kv WHERE key >= 'fb_' AND key < 'fb\`'
            AND (CASE WHEN json_valid(meta) THEN json_extract(meta, '$.du') END) IN (SELECT value FROM json_each(?1)) AND ${live}`).bind(JSON.stringify(people))]);
        // Ses votes pour des suggestions (/suggest) : `sgv_<retour>_<compte Discord>`.
        reads.push(['sgvotes', db.prepare(`SELECT key FROM kv WHERE key >= 'sgv_' AND key < 'sgv\`'
            AND EXISTS (SELECT 1 FROM json_each(?1) AS j WHERE substr(kv.key, -length(j.value) - 1) = '_' || j.value) AND ${live}`).bind(JSON.stringify(people))]);
    }
    const got = reads.length ? await db.batch(reads.map(([, q]) => q)) : [];
    const rows = Object.fromEntries(reads.map(([name], i) => [name, got[i]?.results || []]));
    const doomed = new Set();
    const reportKeys = new Set(t.reports);
    const posts = new Set();
    const cards = [];   // cartes des suggestions (suggestionCardTrash)
    for (const r of rows.have || []) {
        const kind = kinds.get(r.key);
        if (kind === 'link') {
            if (FEEDBACK_KEY_RE.test(String(r.value))) reportKeys.add(String(r.value));
            doomed.add(r.key);
            posts.add(r.key.slice(FEEDBACK_DISCORD_PREFIX.length));
            continue;
        }
        found[kind]++;
        doomed.add(r.key);
    }
    for (const r of rows.votes || []) {
        doomed.add(r.key);
        found[r.key.startsWith(POLL_VOTE_PREFIX) ? 'votes' : 'reactions']++;
    }
    for (const r of rows.discord || []) reportKeys.add(r.key);
    for (const r of rows.sgvotes || []) {
        doomed.add(r.key);
        found.votes++;
    }

    // Retours : leur post Discord (`dt`) et leurs photos.
    const reportList = JSON.stringify([...reportKeys]);
    if (reportKeys.size) {
        const [metas, pics] = (await db.batch([
            db.prepare(`SELECT key, meta FROM kv WHERE key IN (SELECT value FROM json_each(?1)) AND ${live}`).bind(reportList),
            db.prepare(`SELECT COUNT(*) AS n FROM kv WHERE ${FORGET_PHOTOS}`).bind(reportList),
        ])).map((r) => r?.results || []);
        for (const r of metas) {
            const m = parseMeta(r.meta) || {};
            found.reports++;
            doomed.add(r.key);
            if (/^\d{5,25}$/.test(String(m.dt || ''))) {
                posts.add(String(m.dt));
                doomed.add(`${FEEDBACK_DISCORD_PREFIX}${m.dt}`);
            }
            // Carte publique d'une suggestion : nom, avatar et texte de l'auteur.
            const card = suggestionCardTrash(r.key, m);
            if (card) cards.push(card);
        }
        found.pictures = Number(pics[0]?.n) || 0;
    }
    found.posts = posts.size;
    found.cards = cards.length;

    // Abonnements aux notifications (Web Push ou sujet ntfy) et leurs chaînes.
    const subIds = [...new Set(await Promise.all(t.subs.map((s) => pushIdOf(s.endpoint))))];
    const subList = JSON.stringify(subIds);
    if (subIds.length) {
        const [subs, follows] = (await db.batch([
            db.prepare(`SELECT id FROM push_subs WHERE id IN (SELECT value FROM json_each(?1))`).bind(subList),
            db.prepare(`SELECT COUNT(*) AS n FROM push_follow WHERE sub IN (SELECT value FROM json_each(?1))`).bind(subList),
        ])).map((r) => r?.results || []);
        found.subscriptions = subs.length;
        found.channels = Number(follows[0]?.n) || 0;
    }

    if (!dry) {
        const ops = [];
        // Compteurs des sondages où ses votes partent : oubliés, recomptés
        // à la lecture suivante (pollResults).
        for (const k of [...doomed]) {
            if (k.startsWith(POLL_VOTE_PREFIX)) doomed.add(`${POLL_COUNT_PREFIX}${k.slice(POLL_VOTE_PREFIX.length, k.lastIndexOf('_'))}`);
        }
        if (doomed.size) ops.push(db.prepare(`DELETE FROM kv WHERE key IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify([...doomed])));
        if (reportKeys.size) {
            ops.push(db.prepare(`DELETE FROM kv WHERE ${FORGET_PHOTOS}`).bind(reportList));
            // Votes des suggestions effacées (ceux des autres membres : sans eux, rien n'y renvoie).
            ops.push(db.prepare(`DELETE FROM kv WHERE key >= 'sgv_' AND key < 'sgv\`'
                AND EXISTS (SELECT 1 FROM json_each(?1) AS j WHERE substr(kv.key, 5, length(j.value) + 1) = j.value || '_')`).bind(reportList));
        }
        if (subIds.length) {
            ops.push(
                // Ses chaînes que plus personne ne suivra : plus vérifiées (comme handlePushUnsubscribe).
                db.prepare(`DELETE FROM push_live WHERE login IN (SELECT login FROM push_follow WHERE sub IN (SELECT value FROM json_each(?1)))
                    AND NOT EXISTS (SELECT 1 FROM push_follow f WHERE f.login = push_live.login AND f.sub NOT IN (SELECT value FROM json_each(?1)))`).bind(subList),
                db.prepare(`DELETE FROM push_subs WHERE id IN (SELECT value FROM json_each(?1))`).bind(subList),
                db.prepare(`DELETE FROM push_follow WHERE sub IN (SELECT value FROM json_each(?1))`).bind(subList),
                db.prepare(`DELETE FROM push_queue WHERE sub IN (SELECT value FROM json_each(?1))`).bind(subList),
            );
        }
        if (ops.length) await db.batch(ops);
        // Posts Discord des retours et cartes des suggestions : supprimés par
        // le bot (corbeille).
        if (posts.size || cards.length) await trashDiscordPosts(env, ctx, [...posts], cards);
        await dropStatsCache(env);
        await writeAudit(env, { ...(actor || { who: '?', from: 'stats' }), what: 'forget', detail: forgetCounts(found) });
    }
    return { ok: true, dry, targets, unknown, found, who: [...accounts.keys(), ...t.kept].join(' ') };
}

// POST /api/admin/forget { who, dry } — `who` : identifiants séparés par des
// espaces ; `dry` (par défaut) : aperçu, rien n'est effacé ; `dry: false` :
// effacement du `who` rendu par l'aperçu (pas de pseudo), noté au journal.
async function handleAdminForget(request, env, ctx) {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405);
    const { denied } = await requireAdmin(request);
    if (denied) return denied;
    if (!env.DB) return jsonError("Base D1 'DB' non liée au Worker.", 500);
    let body;
    if (!(body = await readJsonObject(request))) return jsonError('JSON invalide', 400);
    const r = await forgetPerson(env, ctx, body.who, { dry: body.dry !== false, actor: await adminActor(request) });
    return new Response(JSON.stringify(r), { headers: { ...RESPONSE_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

// ── Notifications ntfy de live enrichies ───────────────────────────────────
/** Bouton des messages ntfy de live, dans la langue de l'abonnement. */
const NTFY_WATCH = { fr: 'Regarder', en: 'Watch', es: 'Ver', ru: 'Смотреть', 'zh-Hant': '觀看' };
const TWITCH_IMAGE = /^https:\/\/static-cdn\.jtvnw\.net\/\S{1,300}$/;

/**
 * Message ntfy d'un live qui commence (`q` : ligne de la file et son
 * abonnement ; `n` : notice de pushSend). Titre et texte comme avant, et en
 * plus :
 *   - attach : la vignette du live, en grande image dans la notification ;
 *     `s` (le live) pour qu'une image d'un live précédent, gardée en cache,
 *     ne resserve pas ;
 *   - icon : l'avatar de la chaîne, en petite image (seule l'app Android de
 *     ntfy affiche `icon` : d'où la vignette en pièce jointe) ;
 *   - click et un bouton « Regarder » (action view) : l'app, par le schéma de
 *     l'abonnement (« TU Test » a le sien).
 * Un relais d'avant ne transmet que les champs qu'il connaît : la
 * notification reste alors celle d'avant.
 */
function ntfyLiveMessage(q, n) {
    const login = String(n.live.login || '').toLowerCase();
    const click = ntfyClick(q, `live/${login}`);
    const msg = { topic: ntfyTopic(q), title: n.title, message: n.body || n.title, click, tags: ['red_circle'] };
    if (LOGIN_RE.test(login)) {
        const s = /^\d{1,20}$/.test(String(n.live.stream || '')) ? `?s=${n.live.stream}` : '';
        msg.attach = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-640x360.jpg${s}`;
        msg.actions = [{ action: 'view', label: NTFY_WATCH[pushLang(q.lang)] || NTFY_WATCH.en, url: click, clear: true }];
    }
    if (TWITCH_IMAGE.test(String(n.live.icon || ''))) msg.icon = n.live.icon;
    return msg;
}
