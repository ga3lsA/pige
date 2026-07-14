// ==================== CONFIG_RADIOTRACKER ====================
// Nom de l'onglet où sont stockées les diffusions
const SHEET_NAME_RADIOTRACKER = 'RadioLog';

// Change impérativement cette valeur, puis mets la même dans le secret
// GitHub "RADIO_POLL_SECRET". Sert à empêcher n'importe qui d'écrire
// dans ta Sheet en connaissant juste l'URL du Web App.
const SHARED_SECRET_RADIOTRACKER = 'CHANGE_MOI_AVEC_UN_SECRET_ALEATOIRE';
// ===============================================================

/**
 * Point d'entrée POST : reçoit un lot d'entrées depuis le poller Node.js
 * et les ajoute à la feuille RadioLog.
 * Payload attendu :
 * { "secret": "...", "entries": [ { horodatage, station, artiste, titre, brut }, ... ] }
 */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (body.secret !== SHARED_SECRET_RADIOTRACKER) {
      return jsonOutput_RadioTracker_({ ok: false, error: 'unauthorized' });
    }

    const sheet = getOrCreateSheet_RadioTracker_();
    const entries = Array.isArray(body.entries) ? body.entries : [];

    const rows = entries.map((entry) => [
      entry.horodatage || new Date().toISOString(),
      entry.station || '',
      entry.artiste || '',
      entry.titre || '',
      entry.brut || '',
    ]);

    if (rows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
    }

    return jsonOutput_RadioTracker_({ ok: true, inserted: rows.length });
  } catch (err) {
    return jsonOutput_RadioTracker_({ ok: false, error: err.message });
  }
}

/**
 * Point d'entrée GET : deux usages selon le paramètre "action".
 *  - (par défaut) recherche dans l'historique par station / plage de dates
 *      ?station=RTL2&from=2026-07-01T00:00:00&to=2026-07-07T23:59:59
 *  - action=cover : proxy Deezer pour récupérer une pochette côté serveur
 *    (évite les soucis de CORS si un jour on appelle Deezer direct du navigateur)
 *      ?action=cover&artiste=...&titre=...
 */
function doGet(e) {
  const action = e.parameter.action;
  if (action === 'cover') {
    return handleCoverRequest_RadioTracker_(e);
  }
  return handleLogQuery_RadioTracker_(e);
}

function handleLogQuery_RadioTracker_(e) {
  const sheet = getOrCreateSheet_RadioTracker_();
  const data = sheet.getDataRange().getValues();
  const header = data.shift() || [];

  const station = e.parameter.station || null;
  const dateFrom = e.parameter.from ? new Date(e.parameter.from) : null;
  const dateTo = e.parameter.to ? new Date(e.parameter.to) : null;

  const filtered = data.filter((row) => {
    const [horodatage, st] = row;
    if (station && st !== station) return false;
    const d = new Date(horodatage);
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  });

  return jsonOutput_RadioTracker_({ ok: true, header, rows: filtered });
}

function handleCoverRequest_RadioTracker_(e) {
  const artiste = e.parameter.artiste || '';
  const titre = e.parameter.titre || '';
  const q = encodeURIComponent(`${artiste} ${titre}`.trim());

  try {
    const resp = UrlFetchApp.fetch(`https://api.deezer.com/search?q=${q}&limit=1`, {
      muteHttpExceptions: true,
    });
    const json = JSON.parse(resp.getContentText());
    const track = json.data && json.data[0];

    return jsonOutput_RadioTracker_({
      ok: true,
      cover: track ? track.album.cover_medium : null,
      deezerUrl: track ? track.link : null,
    });
  } catch (err) {
    return jsonOutput_RadioTracker_({ ok: false, error: err.message });
  }
}

function getOrCreateSheet_RadioTracker_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME_RADIOTRACKER);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME_RADIOTRACKER);
    sheet.getRange(1, 1, 1, 5).setValues([['Horodatage', 'Station', 'Artiste', 'Titre', 'Brut']]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function jsonOutput_RadioTracker_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
