// poll-radios.mjs
// Interroge chaque flux radio configuré, lit les métadonnées ICY embarquées
// (protocole "Icy-MetaData: 1"), et envoie les résultats à un Web App
// Google Apps Script pour stockage dans un Google Sheet.
//
// IMPORTANT : ce script suppose des flux de type Icecast/Shoutcast "progressifs"
// (HTTP direct, pas de .m3u8/HLS). Si une station ne renvoie pas d'en-tête
// "icy-metaint", c'est probablement un flux HLS -> voir README.md.

import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WEBAPP_URL = process.env.GAS_WEBAPP_URL;
const SHARED_SECRET = process.env.RADIO_POLL_SECRET;

async function loadStations() {
  const raw = await readFile(path.join(__dirname, 'stations.json'), 'utf8');
  return JSON.parse(raw);
}

// Lit le flux juste assez longtemps pour capturer un bloc de métadonnées ICY,
// puis ferme la connexion (on ne télécharge jamais l'audio en continu).
function fetchIcyMetadata(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(
      url,
      { headers: { 'Icy-MetaData': '1', 'User-Agent': 'RadioTracker/1.0 (gael.sanquer@free.fr)' } },
      (res) => {
        const metaintHeader = res.headers['icy-metaint'];
        if (!metaintHeader) {
          res.destroy();
          req.destroy();
          finish({ ok: false, reason: 'no-icy-metaint (flux HLS/m3u8 probable)' });
          return;
        }

        const metaint = parseInt(metaintHeader, 10);
        let buffer = Buffer.alloc(0);
        let audioBytesToSkip = metaint;
        let state = 'audio'; // 'audio' -> 'metalen' -> 'meta'
        let metaLenBytes = 0;

        res.on('data', (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);

          // eslint-disable-next-line no-constant-condition
          while (true) {
            if (state === 'audio') {
              if (buffer.length <= audioBytesToSkip) {
                audioBytesToSkip -= buffer.length;
                buffer = Buffer.alloc(0);
                break;
              }
              buffer = buffer.subarray(audioBytesToSkip);
              audioBytesToSkip = 0;
              state = 'metalen';
            } else if (state === 'metalen') {
              if (buffer.length < 1) break;
              metaLenBytes = buffer[0] * 16;
              buffer = buffer.subarray(1);
              if (metaLenBytes === 0) {
                // Pas de métadonnée à ce cycle, on repart sur un bloc audio
                state = 'audio';
                audioBytesToSkip = metaint;
                continue;
              }
              state = 'meta';
            } else if (state === 'meta') {
              if (buffer.length < metaLenBytes) break;
              const metaBlock = buffer.subarray(0, metaLenBytes).toString('utf8');
              res.destroy();
              req.destroy();
              finish({ ok: true, raw: metaBlock });
              return;
            }
          }
        });

        res.on('error', (err) => finish({ ok: false, reason: `stream-error: ${err.message}` }));
      }
    );

    req.on('error', (err) => finish({ ok: false, reason: err.message }));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      finish({ ok: false, reason: 'timeout' });
    });
  });
}

function parseStreamTitle(raw) {
  const match = raw.match(/StreamTitle='([^']*)'/);
  if (!match) return null;
  const full = match[1].trim();
  if (!full) return null;

  // Convention habituelle : "Artiste - Titre"
  const parts = full.split(' - ');
  if (parts.length >= 2) {
    return { artiste: parts[0].trim(), titre: parts.slice(1).join(' - ').trim(), brut: full };
  }
  return { artiste: null, titre: full, brut: full };
}

async function main() {
  const stations = await loadStations();
  const now = new Date().toISOString();
  const results = [];

  for (const station of stations) {
    if (!station.streamUrl) {
      console.log(`[skip] ${station.name}: pas d'URL configurée dans stations.json`);
      continue;
    }

    const meta = await fetchIcyMetadata(station.streamUrl);
    if (!meta.ok) {
      console.log(`[warn] ${station.name}: ${meta.reason}`);
      continue;
    }

    const parsed = parseStreamTitle(meta.raw);
    if (!parsed) {
      console.log(`[warn] ${station.name}: métadonnée vide ou illisible (${meta.raw})`);
      continue;
    }

    results.push({
      station: station.name,
      artiste: parsed.artiste,
      titre: parsed.titre,
      brut: parsed.brut,
      horodatage: now,
    });
    console.log(`[ok] ${station.name}: ${parsed.brut}`);
  }

  if (results.length === 0) {
    console.log('Aucune donnée collectée sur ce passage.');
    return;
  }

  if (!WEBAPP_URL) {
    console.log('GAS_WEBAPP_URL non configuré — résultats affichés seulement :');
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  const resp = await fetch(WEBAPP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: SHARED_SECRET, entries: results }),
  });
  const text = await resp.text();
  console.log(`Réponse Apps Script (${resp.status}):`, text);
}

main().catch((err) => {
  console.error('Erreur fatale:', err);
  process.exit(1);
});
