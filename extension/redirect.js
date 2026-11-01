"use strict";

// ---------------------------------------------------------------------------
// Pages de twitch.tv ouvertes sur TwitchUnblock (réglage « Ouvrir twitch.tv
// sur TwitchUnblock » de la fenêtre de l'extension, coupé d'office).
//
// Enregistré par l'arrière-plan seulement quand le réglage est allumé, au
// tout début du chargement de la page. Seules les pages que le site a (même
// chemin chez lui) : l'accueil, une chaîne et ses onglets, une VOD, un clip,
// les catégories. Connexion, réglages, abonnements, portefeuille… restent sur
// Twitch : la session de l'extension en a besoin. Une page ouverte depuis le
// site, ou avec ?tu=0 dans l'adresse, reste aussi sur Twitch.
// ---------------------------------------------------------------------------

(() => {
  const SITE = "https://twitchunblock.vercel.app";
  // Premiers segments de Twitch qui ne sont pas des chaînes.
  const RESERVED = new Set([
    "activate", "bits", "broadcast", "checkout", "creatorcamp", "dashboard", "downloads",
    "drops", "email-verification", "embed", "event", "friends", "giftcard", "inventory",
    "jobs", "login", "logout", "manager", "messages", "moderator", "p", "partner",
    "passport", "payments", "popout", "prime", "products", "redeem", "search", "settings",
    "signup", "store", "subs", "subscriptions", "team", "turbo", "u", "user", "wallet",
  ]);
  const LOGIN = /^[a-zA-Z0-9_]{1,25}$/;
  const SECTIONS = new Set(["", "about", "clips", "schedule", "videos"]);

  /** Chemin du site pour cette page de Twitch, ou null pour la laisser. */
  function target(url) {
    if (url.hostname === "clips.twitch.tv") {
      const slug = url.pathname.split("/").filter(Boolean)[0];
      return slug && slug !== "embed" ? "/clip/" + encodeURIComponent(slug) : null;
    }
    const [a = "", b = "", c = ""] = url.pathname.split("/").filter(Boolean);
    const first = a.toLowerCase();
    if (!first) return "/";
    if (first === "videos") return /^\d{6,}$/.test(b) ? url.pathname : null;
    if (first === "directory") return url.pathname;
    if (!LOGIN.test(a) || RESERVED.has(first)) return null;
    const section = b.toLowerCase();
    if (section === "clip" && c) return url.pathname;
    return SECTIONS.has(section) ? url.pathname : null;
  }

  try {
    if (window.top !== window) return;
    const url = new URL(location.href);
    if (url.searchParams.get("tu") === "0") return;
    if (document.referrer && new URL(document.referrer).origin === SITE) return;
    const path = target(url);
    if (path) location.replace(SITE + path + url.search + url.hash);
  } catch (e) {
    // adresse illisible : la page reste sur Twitch
  }
})();
