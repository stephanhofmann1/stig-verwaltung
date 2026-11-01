import { createHash } from "node:crypto";

/**
 * CSV-Import für Kontoauszüge.
 *
 * Unterstützt den Sparkassen-Export (CSV-CAMT) sowie allgemeine Exporte
 * mit Semikolon oder Komma als Trennzeichen. Erkennt die Spalten über
 * ihre Überschriften, weil jede Bank sie anders nennt und sortiert.
 */

export interface RohBuchung {
  buchungstag: string;        // ISO
  valuta: string | null;
  betrag: number;             // positiv = Eingang
  waehrung: string;
  absender: string | null;
  verwendungszweck: string | null;
  fingerabdruck: string;
}

const SPALTEN = {
  buchungstag: ["buchungstag", "buchungsdatum", "datum", "valutadatum"],
  valuta: ["valutadatum", "wertstellung", "valuta"],
  betrag: ["betrag", "umsatz", "amount"],
  waehrung: ["waehrung", "währung", "currency"],
  absender: [
    "beguenstigter/zahlungspflichtiger",
    "begünstigter/zahlungspflichtiger",
    "auftraggeber/empfaenger",
    "auftraggeber/empfänger",
    "name zahlungsbeteiligter",
    "zahlungspflichtiger",
    "beguenstigter",
    "empfaenger",
    "name",
  ],
  zweck: [
    "verwendungszweck",
    "vwz",
    "buchungstext verwendungszweck",
    "verwendungszwecke",
  ],
};

function normalisiere(s: string): string {
  return s
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .replace(/"/g, "");
}

/** Zerlegt eine CSV-Zeile unter Beachtung von Anführungszeichen. */
function zerlege(zeile: string, trenner: string): string[] {
  const felder: string[] = [];
  let aktuell = "";
  let inAnfuehrung = false;
  for (let i = 0; i < zeile.length; i++) {
    const c = zeile[i];
    if (c === '"') {
      if (inAnfuehrung && zeile[i + 1] === '"') {
        aktuell += '"';
        i++;
      } else {
        inAnfuehrung = !inAnfuehrung;
      }
    } else if (c === trenner && !inAnfuehrung) {
      felder.push(aktuell);
      aktuell = "";
    } else {
      aktuell += c;
    }
  }
  felder.push(aktuell);
  return felder.map((f) => f.trim());
}

function erkenneTrenner(kopfzeile: string): string {
  const semikolon = (kopfzeile.match(/;/g) ?? []).length;
  const komma = (kopfzeile.match(/,/g) ?? []).length;
  const tab = (kopfzeile.match(/\t/g) ?? []).length;
  if (tab > semikolon && tab > komma) return "\t";
  return semikolon >= komma ? ";" : ",";
}

function findeIndex(kopf: string[], kandidaten: string[]): number {
  for (const k of kandidaten) {
    const i = kopf.findIndex((h) => h === k);
    if (i >= 0) return i;
  }
  // Teiltreffer als Rückfallebene
  for (const k of kandidaten) {
    const i = kopf.findIndex((h) => h.includes(k));
    if (i >= 0) return i;
  }
  return -1;
}

/** "1.234,56" und "1234.56" und "-50,00" werden alle zu einer Zahl. */
export function parseBetrag(roh: string): number | null {
  const s = roh.replace(/\s|"|€|EUR/gi, "").trim();
  if (!s) return null;
  let norm = s;
  const hatKomma = s.includes(",");
  const hatPunkt = s.includes(".");
  if (hatKomma && hatPunkt) {
    // Das hintere Zeichen ist das Dezimaltrennzeichen.
    norm =
      s.lastIndexOf(",") > s.lastIndexOf(".")
        ? s.replace(/\./g, "").replace(",", ".")
        : s.replace(/,/g, "");
  } else if (hatKomma) {
    norm = s.replace(/\./g, "").replace(",", ".");
  }
  const z = Number(norm);
  return Number.isFinite(z) ? z : null;
}

/** "31.10.2026", "2026-10-31", "31.10.26" → ISO-Datum. */
export function parseDatum(roh: string): string | null {
  const s = roh.trim().replace(/"/g, "");
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) {
    const jahr = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${jahr}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

export interface ImportErgebnis {
  zeilen: number;
  gelesen: RohBuchung[];
  uebersprungen: Array<{ zeile: number; grund: string }>;
  erkannteSpalten: Record<string, string | null>;
}

export function leseCsv(inhalt: string): ImportErgebnis {
  const zeilen = inhalt
    .split(/\r?\n/)
    .filter((z) => z.trim().length > 0);

  if (zeilen.length < 2) {
    return {
      zeilen: 0,
      gelesen: [],
      uebersprungen: [{ zeile: 0, grund: "Datei enthält keine Datenzeilen." }],
      erkannteSpalten: {},
    };
  }

  const trenner = erkenneTrenner(zeilen[0]);
  const kopf = zerlege(zeilen[0], trenner).map(normalisiere);

  const iTag = findeIndex(kopf, SPALTEN.buchungstag);
  const iValuta = findeIndex(kopf, SPALTEN.valuta);
  const iBetrag = findeIndex(kopf, SPALTEN.betrag);
  const iWaehrung = findeIndex(kopf, SPALTEN.waehrung);
  const iAbsender = findeIndex(kopf, SPALTEN.absender);
  const iZweck = findeIndex(kopf, SPALTEN.zweck);

  const erkannteSpalten = {
    buchungstag: iTag >= 0 ? kopf[iTag] : null,
    betrag: iBetrag >= 0 ? kopf[iBetrag] : null,
    absender: iAbsender >= 0 ? kopf[iAbsender] : null,
    verwendungszweck: iZweck >= 0 ? kopf[iZweck] : null,
  };

  const gelesen: RohBuchung[] = [];
  const uebersprungen: Array<{ zeile: number; grund: string }> = [];

  if (iTag < 0 || iBetrag < 0) {
    return {
      zeilen: zeilen.length - 1,
      gelesen: [],
      uebersprungen: [
        {
          zeile: 0,
          grund:
            "Spalten für Buchungstag oder Betrag nicht gefunden. Gefundene Überschriften: " +
            kopf.join(", "),
        },
      ],
      erkannteSpalten,
    };
  }

  for (let i = 1; i < zeilen.length; i++) {
    const f = zerlege(zeilen[i], trenner);
    const tag = parseDatum(f[iTag] ?? "");
    const betrag = parseBetrag(f[iBetrag] ?? "");
    if (!tag || betrag === null) {
      uebersprungen.push({
        zeile: i + 1,
        grund: !tag ? "Buchungstag nicht lesbar" : "Betrag nicht lesbar",
      });
      continue;
    }
    const absender = iAbsender >= 0 ? (f[iAbsender] ?? "").trim() || null : null;
    const zweck = iZweck >= 0 ? (f[iZweck] ?? "").trim() || null : null;
    const valuta = iValuta >= 0 ? parseDatum(f[iValuta] ?? "") : null;
    const waehrung =
      iWaehrung >= 0 ? (f[iWaehrung] ?? "EUR").trim() || "EUR" : "EUR";

    gelesen.push({
      buchungstag: tag,
      valuta,
      betrag,
      waehrung,
      absender,
      verwendungszweck: zweck,
      fingerabdruck: createHash("sha256")
        .update([tag, betrag.toFixed(2), absender ?? "", zweck ?? ""].join("|"))
        .digest("hex")
        .slice(0, 32),
    });
  }

  return { zeilen: zeilen.length - 1, gelesen, uebersprungen, erkannteSpalten };
}
