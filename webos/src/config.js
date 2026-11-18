// Configuration de l'app TV, lue par api.js du site au démarrage (mêmes clés
// que public/config.js). Rien d'autre : le Worker officiel, ses secours et
// le relais vidéo sont ceux du site.
// twitchClientId : le client public de l'iPhone, de l'Apple TV et d'Android,
// le seul qui permet la connexion par code (auth.js) ; Helix exige ce même
// client avec ses jetons.
window.TU_CONFIG = window.TU_CONFIG || {
  twitchClientId: '1e68ku2ehgzy5cy0di3xvfy82sxpf6',
}
