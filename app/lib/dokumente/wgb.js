// Erzeugt die Wohnungsgeberbestätigung (§ 19 BMG) zur Laufzeit aus der Blanko-Vorlage.
//
// Für einen neuen Mieter muss NICHTS an dieser Datei geändert werden – es genügt der
// Eintrag in TENANTS (api/mieter.js) mit vollerName, einzug und zusatz.
//
// Die Feldpositionen stammen aus den Formularfeldern des Originals der Stadt Gießen.
// PDF-Koordinaten: Ursprung unten links, Angaben in Punkten.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { WGB_VORLAGE } from './wgb_vorlage.js';

// ===== HIER PFLEGEN: Angaben zum Wohnungsgeber (gelten für alle Bescheinigungen) =====
export const WOHNUNGSGEBER = {
  name:      'Stephan Hofmann',
  anschrift: '60599, Frankfurt am Main, Am Henninger Turm 10',
  kontakt:   'Stephan Hofmann, Tel. +49 151 50722648',
  ort:       'Frankfurt am Main'
};

// Objektanschrift – die Vorlage hat "3539_" vorgedruckt, es fehlt nur die letzte Ziffer.
const OBJEKT = { plzRest: '0', ort: 'Gießen', strasse: 'Westanlage', hausnr: '9' };

// Feldpositionen: [seite, x0, y0, x1, y1]
const F = {
  nameOben:     [0,  72.2, 552.1, 530.8, 578.0],
  datumOben:    [0,  72.4, 504.8, 293.3, 535.2],
  einzug:       [1, 163.4, 721.1, 326.2, 743.8],
  plz:          [1, 103.3, 665.4, 114.5, 681.3],
  strasse:      [1, 246.8, 662.7, 451.4, 678.7],
  hausnr:       [1, 457.0, 662.3, 518.1, 678.3],
  zusatz:       [1,  70.2, 636.2, 458.9, 652.2],
  person1:      [1,  86.5, 576.8, 517.6, 599.5],
  wgName:       [1,  70.2, 438.0, 517.6, 460.7],
  wgAnschrift:  [1,  70.2, 402.8, 517.6, 425.5],
  wgKontakt:    [1,  70.2, 367.8, 517.6, 390.5],
  hakenEigent:  [1,  77.5, 305.2,  86.4, 313.9],
  unterschrift: [1,  70.9,  63.2, 339.9,  85.6]
};

function dateDE(d){
  // Das 'T12:00:00' ist nicht Zierde. "2026-09-01" allein liest JavaScript
  // als UTC-Mitternacht; getDate() liest danach in der Zeitzone des
  // Rechners. Westlich von Greenwich landet man damit einen Tag davor --
  // nachgeprüft: unter TZ=America/New_York wird aus dem 01.09. der 31.08.
  // Auf einem Behördenformular steht dann ein falsches Einzugsdatum, und
  // die Anmeldefrist nach § 19 BMG rechnet von diesem Datum.
  //
  // _vertrag.js schützt sich an derselben Stelle genauso (dort: tag()).
  // Mittags statt mitternachts, weil zwölf Stunden Abstand in beide
  // Richtungen reichen -- keine Zeitzone liegt weiter als 14 Stunden daneben
  // und zugleich auf der falschen Seite.
  const x = d instanceof Date
    ? d
    : new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? d + 'T12:00:00' : d);
  if (isNaN(x)) return String(d || '');
  return String(x.getDate()).padStart(2,'0') + '.' + String(x.getMonth()+1).padStart(2,'0') + '.' + x.getFullYear();
}

/**
 * @param {object} m           Mieterdaten
 * @param {string} m.vollerName   Name wie im Pass, z. B. "Vorname Nachname"
 * @param {string} m.einzug       Einzugsdatum, ISO ("2026-09-01") oder bereits "01.09.2026"
 * @param {string} m.zusatz       Stockwerks-/Wohnungsangabe, z. B. "4. OG links (Studio-Apartment)"
 * @param {Date}   [ausstellung]  Ausstellungsdatum, Standard: heute
 * @returns {Promise<Uint8Array>} fertiges PDF
 */
export async function wohnungsgeberbestaetigung(m, ausstellung){
  const pdf  = await PDFDocument.load(Buffer.from(WGB_VORLAGE, 'base64'));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const seiten = pdf.getPages();
  const tinte = rgb(0.05, 0.05, 0.15);
  const heute = dateDE(ausstellung || new Date());
  const ortDatum = WOHNUNGSGEBER.ort + ', ' + heute;

  function schreib(feld, text, schrift){
    if (!text) return;
    const [si, x0, y0, x1, y1] = F[feld];
    const seite = seiten[si];
    const f = schrift || font;
    let size = 11;
    while (size > 7 && f.widthOfTextAtSize(String(text), size) > (x1 - x0 - 6)) size -= 0.5;
    seite.drawText(String(text), {
      x: x0 + 3,
      y: y0 + (y1 - y0) / 2 - size * 0.35,
      size, font: f, color: tinte
    });
  }

  schreib('nameOben',     WOHNUNGSGEBER.name);
  schreib('datumOben',    ortDatum);
  schreib('einzug',       dateDE(m.einzug));
  schreib('plz',          OBJEKT.plzRest);
  schreib('strasse',      OBJEKT.strasse);
  schreib('hausnr',       OBJEKT.hausnr);
  schreib('zusatz',       m.zusatz);
  schreib('person1',      m.vollerName);
  schreib('wgName',       WOHNUNGSGEBER.name);
  schreib('wgAnschrift',  WOHNUNGSGEBER.anschrift);
  schreib('wgKontakt',    WOHNUNGSGEBER.kontakt);
  schreib('unterschrift', ortDatum);

  // Kreuz bei "Der Wohnungsgeber ist gleichzeitig Eigentümer der Wohnung"
  const [hs, hx, hy] = F.hakenEigent;
  seiten[hs].drawText('X', { x: hx + 1.2, y: hy + 1.5, size: 10, font: bold, color: tinte });

  return pdf.save();
}

export function dateiname(m){
  const slug = String(m.vollerName || 'Mieter').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return 'Wohnungsgeberbestaetigung_' + slug + '.pdf';
}
