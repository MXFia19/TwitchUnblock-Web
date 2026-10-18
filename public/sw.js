// Service worker minimal : le site s'installe comme une app, et la coque
// (HTML, CSS, JS) s'ouvre même hors ligne. Réseau d'abord, toujours : une
// mise à jour du site est servie dès qu'elle est en ligne, le cache ne sert
// que de secours. Rien d'autre que nos propres fichiers n'est mis en cache.
const CACHE = 'tu-shell-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  // L'API (même origine en Docker) : ni les segments vidéo ni les listes
  // n'ont leur place dans ce cache.
  if (url.pathname.startsWith('/api/')) return
  e.respondWith((async () => {
    try {
      const res = await fetch(req)
      if (res.ok && res.type === 'basic') {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
      }
      return res
    } catch {
      const hit = await caches.match(req) ?? (req.mode === 'navigate' ? await caches.match('/') : null)
      return hit ?? Response.error()
    }
  })())
})

// ── Notifications de live (site installé) ───────────────────────────────
// Le Worker envoie une notification chiffrée quand une chaîne suivie passe
// en live ; la toucher ouvre son direct, dans le site déjà ouvert s'il l'est.
self.addEventListener('push', (e) => {
  let data = {}
  try { data = e.data ? e.data.json() : {} } catch {}
  e.waitUntil(self.registration.showNotification(data.title || 'TwitchUnblock', {
    body: data.body || '',
    icon: data.icon || '/assets/icons/icon-192.png',
    badge: '/assets/icons/icon-192.png',
    tag: data.tag || undefined,
    data: { url: data.url || '/' },
  }))
})

// Abonnement remplacé par le navigateur (Firefox surtout) : on en reprend un
// avec la même clé, et le Worker remplace l'ancien, chaînes et langue
// reprises (adresse du Worker notée par la page dans le cache). Avant, rien
// n'arrivait plus jusqu'à la visite suivante du site.
self.addEventListener('pushsubscriptionchange', (e) => {
  const old = e.oldSubscription
  const key = old?.options?.applicationServerKey
  if (!key) return
  e.waitUntil((async () => {
    const sub = e.newSubscription ?? await self.registration.pushManager.getSubscription()
      ?? await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    if (!sub || !old.endpoint || sub.endpoint === old.endpoint) return
    const api = await (await caches.open(CACHE)).match('/__push-api').then((r) => r?.text())
    if (!api) return
    await fetch(`${api}/api/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON(), replaces: old.endpoint }),
    })
  })().catch(() => {}))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href
  e.waitUntil((async () => {
    const wins = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter((w) => {
      const u = new URL(w.url)
      return u.origin === self.location.origin && !u.pathname.startsWith('/stats')
    })
    const win = wins.find((w) => w.focused) ?? wins[0]
    if (!win) return self.clients.openWindow(url)
    await win.focus()
    win.postMessage({ type: 'open', url })
  })())
})
