# Radio Tracker — Historique de diffusion (Europe 2, Europe 1, RFM, NRJ, Nostalgie, Chérie FM, Fun Radio, RTL2)

Collecte automatique des titres diffusés (station, artiste, titre, horodatage) via les métadonnées ICY des flux, stockage dans Google Sheets, et page de consultation avec pochettes.

## Architecture

```
[Flux radio ICY] --(toutes les ~5 min via GitHub Actions)--> poll-radios.mjs
                                                                    |
                                                                    v
                                              Web App Google Apps Script (doPost)
                                                                    |
                                                                    v
                                                          Google Sheet "RadioLog"
                                                                    |
                                                                    v
                                            query.html (recherche par date/station + pochettes Deezer)
```

## Étape 1 — Trouver les vraies URLs de flux

Les annuaires publics contiennent beaucoup de liens morts. Méthode fiable :

1. Ouvre le player web de la station (ex. europe2.fr, rfm.fr, nrj.fr, nostalgie.fr, cheriefm.fr,
   funradio.fr, rtl2.fr, europe1.fr)
2. Ouvre les outils de développement du navigateur (F12) → onglet **Network** (ou Réseau)
3. Filtre sur "Media" et lance la lecture
4. Repère l'URL du flux audio (souvent un `.mp3`, `.aac` ou `.m3u8`)
5. Colle-la dans `stations.json`, dans le champ `streamUrl` correspondant

⚠️ **Cas des flux HLS (.m3u8)** : le script actuel lit les métadonnées ICY, qui ne fonctionnent
que sur des flux "progressifs" classiques (Icecast/Shoutcast direct). Si une station ne renvoie
que du HLS, le script affichera `no-icy-metaint` pour cette station — dans ce cas les
métadonnées sont probablement embarquées en tags ID3 dans les segments audio, ce qui demande un
parseur différent. Fais-moi signe si tu tombes sur ce cas, je l'ajouterai.

En tant qu'employé Lagardère Radio, tu as peut-être un accès plus direct/fiable aux flux
d'Europe 2 et RFM en interne — n'hésite pas à les utiliser si c'est le cas.

## Étape 2 — Déployer le Web App Apps Script

1. Crée (ou réutilise) un Google Sheet dédié
2. Extensions → Apps Script
3. Colle le contenu de `apps-script/Code.gs`
4. **Change la valeur de `SHARED_SECRET_RADIOTRACKER`** pour une chaîne aléatoire (garde-la de côté)
5. Déployer → Nouveau déploiement → Type : Application Web
   - Exécuter en tant que : Moi
   - Qui a accès : Tout le monde
6. Autorise les permissions demandées, puis copie l'URL du Web App (se termine par `/exec`)

## Étape 3 — Configurer le dépôt GitHub

1. Crée un nouveau repo, pousse tout le contenu de ce dossier
2. Dans Settings → Secrets and variables → Actions, ajoute :
   - `GAS_WEBAPP_URL` : l'URL du Web App obtenue à l'étape 2
   - `RADIO_POLL_SECRET` : le même secret que dans `Code.gs`
3. Le workflow `.github/workflows/poll.yml` se déclenche automatiquement toutes les ~5 min.
   Tu peux aussi le lancer manuellement depuis l'onglet Actions (bouton "Run workflow").

## Étape 4 — Consulter l'historique

Ouvre `query.html` dans un navigateur (en local ou hébergé où tu veux, ex. Netlify comme ton
Fit Point Analyzer). Colle l'URL du Web App dans le champ prévu (elle est mémorisée pour les
prochaines fois), puis filtre par station et/ou plage de dates.

## Limites connues

- **Timing GitHub Actions** : le cron `*/5 * * * *` n'est pas garanti à la minute près ; sous
  forte charge GitHub, une exécution peut être retardée de plusieurs minutes.
- **Doublons** : chaque passage du poller enregistre une ligne, même si le titre n'a pas changé
  depuis le dernier passage. C'est volontaire (garde une trace de présence du titre à chaque
  instant vérifié) mais ça veut dire qu'un même morceau peut apparaître plusieurs fois de suite
  dans le Sheet — utile pour estimer sa durée de diffusion approximative, à dédupliquer si tu
  veux une vue "un morceau = une ligne".
- **Quota Deezer** : l'API Deezer est gratuite mais non documentée officiellement comme illimitée ;
  en usage personnel/interne ça devrait passer largement.
