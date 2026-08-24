'use strict';

const crypto = require('crypto');

/**
 * Die Bild-URLs einer Commons-Datei — ableitbar, ohne die API zu fragen.
 *
 * Commons legt jede Datei unter einem Pfad ab, der sich aus dem **MD5 des Dateinamens** ergibt:
 *
 *     name = "Betula pendula 'Youngii'.jpg"  →  Leerzeichen zu Unterstrich
 *     h    = md5(name) = "78…"
 *     Original :  …/commons/7/78/<name>
 *     Vorschau :  …/commons/thumb/7/78/<name>/250px-<name>
 *
 * Gespeichert wird deshalb nur der **Dateiname** — dieselbe Entscheidung wie bei Pl@ntNets
 * `imageId`. Ein spaeterer eigener Proxy aendert dann nur `plantImageUrl()` in der App.
 *
 * ## 🔴 Nur vier Breiten funktionieren
 *
 * An zwei Dateien gegengeprueft (24.08.2026):
 *
 *     120 px  ✅  7–9 KB      150 px  ❌ HTTP 400
 *     250 px  ✅  24–39 KB    320 px  ❌ HTTP 400
 *     500 px  ✅  77–150 KB   640/800/1024 px  ❌ HTTP 400
 *    1280 px  ✅  374–672 KB  2048 px  ❌ HTTP 400
 *
 * Wer eine ungueltige Breite anfragt, bekommt **kein kleineres Bild, sondern einen Fehler**. Die
 * Groessenleiter muss hart auf diesen vier Stufen liegen.
 *
 * ⚠️ Das Original wird NIE ausgeliefert: Ein einzelnes Foto der Stichprobe war 5,7 MB.
 */

const BASIS = 'https://upload.wikimedia.org/wikipedia/commons';

/** Die vier Breiten, die Commons wirklich bedient. */
const COMMONS_BREITEN = Object.freeze({ vorschau: 120, klein: 250, kachel: 500, vollbild: 1280 });

const pfadTeile = (dateiname) => {
  const u = String(dateiname).replace(/ /g, '_');
  const h = crypto.createHash('md5').update(u, 'utf8').digest('hex');
  return { u, h };
};

/** Das Original in voller Groesse. Fuer die Datenbank — die App leitet die Stufen daraus ab. */
function commonsOriginalUrl(dateiname) {
  const { u, h } = pfadTeile(dateiname);
  return `${BASIS}/${h[0]}/${h.slice(0, 2)}/${encodeURIComponent(u)}`;
}

/** Eine der vier gueltigen Breiten. Jede andere waere HTTP 400. */
function commonsThumbUrl(dateiname, breite) {
  if (!Object.values(COMMONS_BREITEN).includes(breite)) {
    throw new Error(`Breite ${breite} bedient Commons nicht — erlaubt: ${Object.values(COMMONS_BREITEN).join(', ')}`);
  }
  const { u, h } = pfadTeile(dateiname);
  const e = encodeURIComponent(u);
  return `${BASIS}/thumb/${h[0]}/${h.slice(0, 2)}/${e}/${breite}px-${e}`;
}

module.exports = { commonsOriginalUrl, commonsThumbUrl, COMMONS_BREITEN };
