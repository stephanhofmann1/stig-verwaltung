import { createHash } from "node:crypto";
import { parseBetrag, parseDatum, type RohBuchung } from "./kontoimport";

/**
 * Leser für die vier Kontoauszugsformate, die es wirklich gibt.
 *
 * Der allgemeine CSV-Leser in kontoimport.ts erkennt Spalten über ihre
 * Überschriften. Das ist für einen unbekannten Export richtig, für diese
 * vier aber zu wenig: Jedes hat eine Eigenheit, die stillschweigend falsche
 * Zahlen erzeugt, wenn man sie nicht kennt. Bei einem Mieteingangsabgleich
 * heißt falsch, dass jemand eine Mahnung bekommt.
 *
 * Erhoben am 01.11.2026 an echten Dateien von Stephans Rechner:
 *
 *   Sparkasse Wetzlar (CSV)   cp1252, **zweistellige Jahre** (TT.MM.JJ),
 *                             Spalte `Info` trennt gebuchte von
 *                             **vorgemerkten** Umsätzen. Vorgemerkte sind
 *                             später als gebuchte noch einmal da -- wer sie
 *                             mitimportiert, zählt doppelt.
 *   ING (CSV)                 cp1252, 13 Kopfzeilen vor der Überschrift,
 *                             Datumsspalte heißt **"Buchung"** (nicht
 *                             Buchungstag), `Währung` kommt doppelt vor,
 *                             `Saldo` steht VOR `Betrag`, keine Gegen-IBAN.
 *   Volksbank Bühl (CSV)      UTF-8 mit BOM, CRLF, vollständigste Felder --
 *                             aber der Export ist **auf 200 Umsätze
 *                             gekürzt**, ohne Hinweis in der Datei.
 *   Volksbank Bühl (PDF)      Textebene, drei Zeilen je Buchung. Keine
 *                             Zeilengrenze, und der Kopf nennt den
 *                             tatsächlichen Filterzeitraum.
 */

export type FormatName =
  | "sparkasse_csv"
  | "ing_csv"
  | "volksbank_csv"
  | "volksbank_pdfexport";

export interface Lesung {
  format: FormatName;
  /** IBAN des eigenen Kontos, soweit die Datei sie nennt. */
  konto_iban: string | null;
  /** Der Zeitraum, den die Datei abdeckt. Aus dem Kopf, sonst aus den Daten. */
  zeitraum: { von: string; bis: string } | null;
  buchungen: RohBuchung[];
  /** Absichtlich nicht übernommen, mit Grund. */
  uebersprungen: Array<{ grund: string; anzahl: number }>;
  /**
   * Was ein Mensch wissen muss, bevor er diese Datei als vollständig
   * behandelt. Jede Warnung hier kann einen Mieter zum Säumigen machen.
   */
  warnungen: string[];
}

/**
 * Macht aus Bytes Text.
 *
 * Reihenfolge ist wichtig: Erst UTF-8 streng versuchen, dann cp1252. Die
 * Sparkassen- und ING-Dateien sind cp1252; liest man sie als UTF-8 mit
 * Ersetzung, wird aus "Müller" ein "M?ller" und der Name passt nicht mehr
 * zum Mieter. Umgekehrt ist jede cp1252-Datei auch als UTF-8 lesbar, nur
 * eben falsch -- deshalb muss UTF-8 streng sein und scheitern dürfen.
 */
export function dekodiere(bytes: Buffer): { text: string; kodierung: string } {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text: text.replace(/^﻿/, ""), kodierung: "utf-8" };
  } catch {
    return {
      text: new TextDecoder("windows-1252").decode(bytes).replace(/^﻿/, ""),
      kodierung: "cp1252",
    };
  }
}

/** Erkennt das Format an einer Zeile, die nur dort so aussieht. */
export function erkenneFormat(text: string): FormatName | null {
  const kopf = text.slice(0, 4000);
  if (/"Auftragskonto";"Buchungstag"/.test(kopf)) return "sparkasse_csv";
  if (/^Umsatzanzeige;/m.test(kopf)) return "ing_csv";
  if (/Bezeichnung Auftragskonto;IBAN Auftragskonto/.test(kopf))
    return "volksbank_csv";
  if (/^Filterparameter\s/m.test(kopf) && /^Umsätze\s*$/m.test(kopf))
    return "volksbank_pdfexport";
  return null;
}

/** Zerlegt eine CSV-Zeile unter Beachtung von Anführungszeichen. */
function felder(zeile: string): string[] {
  const aus: string[] = [];
  let a = "";
  let inAnf = false;
  for (let i = 0; i < zeile.length; i++) {
    const c = zeile[i];
    if (c === '"') {
      if (inAnf && zeile[i + 1] === '"') {
        a += '"';
        i++;
      } else inAnf = !inAnf;
    } else if (c === ";" && !inAnf) {
      aus.push(a);
      a = "";
    } else a += c;
  }
  aus.push(a);
  return aus.map((f) => f.trim());
}

/**
 * Der Fingerabdruck, über den ein zweiter Import dieselbe Buchung erkennt.
 *
 * Tag, Betrag, Absender und Zweck allein genügen nicht: Überweist jemand
 * zwei Monatsmieten am selben Tag als zwei getrennte Buchungen mit
 * demselben Verwendungszweck, sind beide in allen vier Feldern gleich. Die
 * zweite würde beim Import stillschweigend verschwinden -- und der Mieter
 * hätte einen Monat offen, obwohl er gezahlt hat.
 *
 * Deshalb zählt `lfd` gleiche Buchungen innerhalb einer Datei durch. Das
 * bleibt über Exporte hinweg stabil, solange die Bank die Reihenfolge
 * innerhalb eines Tages beibehält, und das tut sie: Die Reihenfolge kommt
 * aus der Buchung selbst, nicht aus dem Export.
 */
function fingerabdruck(
  tag: string,
  betrag: number,
  absender: string,
  zweck: string,
  lfd: number,
): string {
  return createHash("sha256")
    .update([tag, betrag.toFixed(2), absender, zweck, String(lfd)].join("|"))
    .digest("hex")
    .slice(0, 32);
}

/** Zählt gleiche Buchungen durch und setzt die Fingerabdrücke. */
function nummeriere(
  rohe: Array<Omit<RohBuchung, "fingerabdruck">>,
): RohBuchung[] {
  const gesehen = new Map<string, number>();
  return rohe.map((b) => {
    const schluessel = [
      b.buchungstag,
      b.betrag.toFixed(2),
      b.absender ?? "",
      b.verwendungszweck ?? "",
    ].join("|");
    const lfd = (gesehen.get(schluessel) ?? 0) + 1;
    gesehen.set(schluessel, lfd);
    return {
      ...b,
      fingerabdruck: fingerabdruck(
        b.buchungstag,
        b.betrag,
        b.absender ?? "",
        b.verwendungszweck ?? "",
        lfd,
      ),
    };
  });
}

function zeitraumAus(
  buchungen: Array<{ buchungstag: string }>,
): { von: string; bis: string } | null {
  if (buchungen.length === 0) return null;
  const tage = buchungen.map((b) => b.buchungstag).sort();
  return { von: tage[0], bis: tage[tage.length - 1] };
}

// --- Sparkasse Wetzlar, CSV --------------------------------------------------

function liesSparkasse(text: string): Lesung {
  const zeilen = text.split(/\r?\n/);
  const kopf = felder(zeilen[0]).map((f) => f.toLowerCase());
  const i = (name: string) => kopf.indexOf(name.toLowerCase());

  const iTag = i("Buchungstag");
  const iVal = i("Valutadatum");
  const iBetrag = i("Betrag");
  const iWaehrung = i("Waehrung");
  const iName = i("Beguenstigter/Zahlungspflichtiger");
  const iZweck = i("Verwendungszweck");
  const iInfo = i("Info");

  const warnungen: string[] = [];
  if (iTag < 0 || iBetrag < 0) {
    warnungen.push(
      "Die Spalten Buchungstag oder Betrag fehlen — die Datei sieht nicht " +
        "aus wie ein Sparkassen-Export.",
    );
    return {
      format: "sparkasse_csv",
      konto_iban: null,
      zeitraum: null,
      buchungen: [],
      uebersprungen: [],
      warnungen,
    };
  }
  if (iInfo < 0) {
    // Ohne diese Spalte lässt sich gebucht nicht von vorgemerkt trennen.
    // Das ist kein Grund abzubrechen, aber einer zu warnen: Vorgemerkte
    // Umsätze kommen später als gebuchte noch einmal.
    warnungen.push(
      "Die Spalte `Info` fehlt. Damit lassen sich vorgemerkte Umsätze nicht " +
        "erkennen; sie werden später als gebuchte erneut auftauchen und " +
        "dann doppelt zählen.",
    );
  }

  // Mehrzeilige Felder: Ein Verwendungszweck kann ein Zeilenende enthalten,
  // dann gehört die Folgezeile noch dazu. Erkennbar an einer ungeraden
  // Zahl von Anführungszeichen.
  const daten: string[] = [];
  let puffer = "";
  for (const z of zeilen.slice(1)) {
    puffer = puffer === "" ? z : puffer + " " + z;
    const anf = (puffer.match(/"/g) ?? []).length;
    if (anf % 2 === 0) {
      if (puffer.trim() !== "") daten.push(puffer);
      puffer = "";
    }
  }
  if (puffer.trim() !== "") daten.push(puffer);

  const rohe: Array<Omit<RohBuchung, "fingerabdruck">> = [];
  let vorgemerkt = 0;
  let unlesbar = 0;
  let iban: string | null = null;
  const iKonto = i("Auftragskonto");

  for (const z of daten) {
    const f = felder(z);
    if (iKonto >= 0 && iban === null && /^DE\d{20}$/.test(f[iKonto] ?? "")) {
      iban = f[iKonto];
    }
    // Vorgemerkt heißt: noch nicht gebucht. Die Bank liefert dieselbe
    // Zahlung Tage später als gebuchten Umsatz -- oft mit anderem
    // Buchungstag, also auch mit anderem Fingerabdruck. Beides zu
    // importieren zählt das Geld zweimal.
    if (iInfo >= 0 && /vorgemerkt/i.test(f[iInfo] ?? "")) {
      vorgemerkt++;
      continue;
    }
    const tag = parseDatum(f[iTag] ?? "");
    const betrag = parseBetrag(f[iBetrag] ?? "");
    if (tag === null || betrag === null) {
      unlesbar++;
      continue;
    }
    rohe.push({
      buchungstag: tag,
      valuta: iVal >= 0 ? parseDatum(f[iVal] ?? "") : null,
      betrag,
      waehrung: (iWaehrung >= 0 ? f[iWaehrung] : "") || "EUR",
      absender: (iName >= 0 ? f[iName] : "") || null,
      verwendungszweck: (iZweck >= 0 ? f[iZweck] : "") || null,
    });
  }

  const uebersprungen: Lesung["uebersprungen"] = [];
  if (vorgemerkt > 0)
    uebersprungen.push({
      grund: "noch nicht gebucht (Info: vorgemerkt)",
      anzahl: vorgemerkt,
    });
  if (unlesbar > 0)
    uebersprungen.push({ grund: "Datum oder Betrag unlesbar", anzahl: unlesbar });

  return {
    format: "sparkasse_csv",
    konto_iban: iban,
    zeitraum: zeitraumAus(rohe),
    buchungen: nummeriere(rohe),
    uebersprungen,
    warnungen,
  };
}

// --- ING, CSV ----------------------------------------------------------------

function liesIng(text: string): Lesung {
  const zeilen = text.split(/\r?\n/);
  const warnungen: string[] = [];

  let iban: string | null = null;
  let zeitraum: { von: string; bis: string } | null = null;
  let kopfZeile = -1;

  for (let n = 0; n < Math.min(zeilen.length, 40); n++) {
    const z = zeilen[n];
    const m = z.match(/^IBAN;([A-Z]{2}[\d ]+)/);
    if (m) iban = m[1].replace(/\s/g, "");
    const zr = z.match(
      /^Zeitraum;(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/,
    );
    if (zr) {
      const von = parseDatum(zr[1]);
      const bis = parseDatum(zr[2]);
      if (von && bis) zeitraum = { von, bis };
    }
    // Die Überschriftenzeile. Sie beginnt mit "Buchung;" -- NICHT
    // "Buchungstag". Der allgemeine Leser sucht nach Buchungstag, Datum
    // oder Valutadatum und findet bei der ING keine Datumsspalte.
    if (/^Buchung;/.test(z)) {
      kopfZeile = n;
      break;
    }
  }

  if (kopfZeile < 0) {
    warnungen.push(
      "Keine Überschriftenzeile gefunden (erwartet eine Zeile, die mit " +
        "`Buchung;` beginnt).",
    );
    return {
      format: "ing_csv",
      konto_iban: iban,
      zeitraum,
      buchungen: [],
      uebersprungen: [],
      warnungen,
    };
  }

  const kopf = felder(zeilen[kopfZeile]).map((f) => f.toLowerCase());
  const iTag = kopf.indexOf("buchung");
  const iVal = kopf.indexOf("wertstellungsdatum");
  const iName = kopf.findIndex((f) => /^auftraggeber\/empf/.test(f));
  const iZweck = kopf.indexOf("verwendungszweck");
  // `Betrag` steht NACH `Saldo`, und `Währung` kommt zweimal vor -- einmal
  // zum Saldo, einmal zum Betrag. lastIndexOf, damit die Währung zum
  // Betrag gehört und nicht zum Saldo.
  const iBetrag = kopf.lastIndexOf("betrag");
  const iWaehrung = kopf.lastIndexOf("währung");

  const rohe: Array<Omit<RohBuchung, "fingerabdruck">> = [];
  let unlesbar = 0;
  for (const z of zeilen.slice(kopfZeile + 1)) {
    if (z.trim() === "") continue;
    const f = felder(z);
    const tag = parseDatum(f[iTag] ?? "");
    const betrag = parseBetrag(f[iBetrag] ?? "");
    if (tag === null || betrag === null) {
      unlesbar++;
      continue;
    }
    rohe.push({
      buchungstag: tag,
      valuta: iVal >= 0 ? parseDatum(f[iVal] ?? "") : null,
      betrag,
      waehrung: (iWaehrung >= 0 ? f[iWaehrung] : "") || "EUR",
      absender: (iName >= 0 ? f[iName] : "") || null,
      verwendungszweck: (iZweck >= 0 ? f[iZweck] : "") || null,
    });
  }

  // Die ING nennt keine Gegen-IBAN. Die Zuordnung einer Miete kann sich
  // hier nur auf den Namen stützen, und Namen sind nicht eindeutig.
  warnungen.push(
    "Die ING-CSV enthält keine IBAN des Zahlungsbeteiligten. Zuordnungen " +
      "aus dieser Datei stützen sich allein auf den Namen und sollten " +
      "nachgesehen werden.",
  );

  const uebersprungen: Lesung["uebersprungen"] = [];
  if (unlesbar > 0)
    uebersprungen.push({ grund: "Datum oder Betrag unlesbar", anzahl: unlesbar });

  return {
    format: "ing_csv",
    konto_iban: iban,
    zeitraum: zeitraum ?? zeitraumAus(rohe),
    buchungen: nummeriere(rohe),
    uebersprungen,
    warnungen,
  };
}

// --- Volksbank Bühl, CSV -----------------------------------------------------

/** Verdächtige Zeilenzahlen: Die Volksbank kürzt bei 200 Umsätzen. */
const VOLKSBANK_GRENZE = 200;

function liesVolksbankCsv(text: string): Lesung {
  const zeilen = text.split(/\r?\n/).filter((z) => z.trim() !== "");
  const kopf = felder(zeilen[0]).map((f) => f.toLowerCase());
  const i = (n: string) => kopf.indexOf(n.toLowerCase());

  const iTag = i("Buchungstag");
  const iVal = i("Valutadatum");
  const iBetrag = i("Betrag");
  const iWaehrung = i("Waehrung");
  const iName = i("Name Zahlungsbeteiligter");
  const iZweck = i("Verwendungszweck");
  const iSaldo = i("Saldo nach Buchung");
  const iKonto = i("IBAN Auftragskonto");

  const warnungen: string[] = [];
  const rohe: Array<Omit<RohBuchung, "fingerabdruck">> = [];
  const salden: Array<{ saldo: number; betrag: number }> = [];
  let unlesbar = 0;
  let iban: string | null = null;

  for (const z of zeilen.slice(1)) {
    const f = felder(z);
    if (iKonto >= 0 && iban === null && /^DE\d{20}$/.test(f[iKonto] ?? ""))
      iban = f[iKonto];
    const tag = parseDatum(f[iTag] ?? "");
    const betrag = parseBetrag(f[iBetrag] ?? "");
    if (tag === null || betrag === null) {
      unlesbar++;
      continue;
    }
    if (iSaldo >= 0) {
      const s = parseBetrag(f[iSaldo] ?? "");
      if (s !== null) salden.push({ saldo: s, betrag });
    }
    rohe.push({
      buchungstag: tag,
      valuta: iVal >= 0 ? parseDatum(f[iVal] ?? "") : null,
      betrag,
      waehrung: (iWaehrung >= 0 ? f[iWaehrung] : "") || "EUR",
      absender: (iName >= 0 ? f[iName] : "") || null,
      verwendungszweck: (iZweck >= 0 ? f[iZweck] : "") || null,
    });
  }

  // Die Saldokette. Die Datei ist nach Buchungstag absteigend sortiert, der
  // Saldo gilt NACH der jeweiligen Buchung. Also muss gelten:
  //
  //   Saldo(n) - Betrag(n) = Saldo(n+1)
  //
  // Das ist kein Schätzwert, sondern eine Rechnung, die die Bank selbst
  // mitliefert. Stimmt sie durchgehend, fehlt innerhalb der Datei keine
  // Zeile. Das ist die einzige Vollständigkeitsprüfung, die eine dieser
  // Dateien überhaupt zulässt.
  let risse = 0;
  for (let n = 0; n + 1 < salden.length; n++) {
    const erwartet = salden[n].saldo - salden[n].betrag;
    if (Math.abs(erwartet - salden[n + 1].saldo) > 0.005) risse++;
  }
  if (risse > 0) {
    warnungen.push(
      `Die Saldokette stimmt an ${risse} Stellen nicht. Zwischen den Zeilen ` +
        "fehlen Buchungen oder die Reihenfolge ist verändert — diese Datei " +
        "darf nicht als vollständig gelten.",
    );
  }

  // Die 200er-Grenze. Sie steht nirgends in der Datei; die einzige Spur ist
  // die Zeilenzahl. Genau 200 (oder 205, je nach Zählung der Kopfzeilen) ist
  // deshalb immer verdächtig -- auch wenn es Zufall sein kann.
  if (rohe.length >= VOLKSBANK_GRENZE) {
    warnungen.push(
      `${rohe.length} Umsätze — die Volksbank kürzt CSV-Exporte ` +
        `stillschweigend bei ${VOLKSBANK_GRENZE} Umsätzen, unabhängig vom ` +
        "gewählten Zeitraum. Diese Datei enthält sehr wahrscheinlich nur " +
        "die jüngsten Buchungen. Erneut in Scheiben von höchstens drei " +
        "Monaten exportieren oder den PDF-Umsatzexport nehmen.",
    );
  }

  const uebersprungen: Lesung["uebersprungen"] = [];
  if (unlesbar > 0)
    uebersprungen.push({ grund: "Datum oder Betrag unlesbar", anzahl: unlesbar });

  return {
    format: "volksbank_csv",
    konto_iban: iban,
    zeitraum: zeitraumAus(rohe),
    buchungen: nummeriere(rohe),
    uebersprungen,
    warnungen,
  };
}

// --- Volksbank Bühl, PDF-Umsatzexport ----------------------------------------

/**
 * Der PDF-Umsatzexport, gelesen aus der Textebene (`pdftotext -layout`).
 *
 * Aufbau je Buchung:
 *   Zeile 1   Name des Zahlungsbeteiligten ....... +/-Betrag EUR
 *   Zeile 2   IBAN ............................... Buchungstag
 *   Zeile 3+  Verwendungszweck, mehrzeilig
 *   Leerzeile trennt die Buchungen
 *
 * Bei Entgelten fehlt die IBAN, dann steht in Zeile 2 nur der Tag. Dieses
 * Format hat die Zeilengrenze der CSV nicht und nennt im Kopf den
 * tatsächlichen Filterzeitraum -- deshalb ist es für die Volksbank die
 * bessere Quelle, obwohl es ein PDF ist.
 */
function liesVolksbankPdf(text: string): Lesung {
  const zeilen = text.split(/\r?\n/);
  const warnungen: string[] = [];
  let iban: string | null = null;
  let zeitraum: { von: string; bis: string } | null = null;

  for (const z of zeilen.slice(0, 40)) {
    const m = z.match(/^IBAN\s+(DE\d{20})/);
    if (m) iban = m[1];
    const zr = z.match(
      /^Filterparameter\s+(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/,
    );
    if (zr) {
      const von = parseDatum(zr[1]);
      const bis = parseDatum(zr[2]);
      if (von && bis) zeitraum = { von, bis };
    }
  }
  if (zeitraum === null) {
    warnungen.push(
      "Im Kopf steht kein Filterzeitraum. Ohne ihn ist nicht festzustellen, " +
        "welchen Zeitraum die Datei abdecken soll.",
    );
  }

  // Zeilen, die nicht zu den Buchungen gehören.
  const muell =
    /^(Seite \d+ von \d+|BIC\s|IBAN\s|Kontoinhaber\s|Umsätze\s*$|Filterparameter\s|#|.*\(Endsaldo\))/;

  const rohe: Array<Omit<RohBuchung, "fingerabdruck">> = [];
  let n = 0;
  let unvollstaendig = 0;

  while (n < zeilen.length) {
    const z = zeilen[n];
    // Kopfzeile einer Buchung: endet mit einem Betrag und "EUR".
    const kopf = z.match(/^(.+?)\s{2,}([+-][\d.,]+)\s*EUR\s*$/);
    if (!kopf || muell.test(z)) {
      n++;
      continue;
    }
    const absender = kopf[1].trim();
    const betrag = parseBetrag(kopf[2]);
    // Zeile 2: IBAN und/oder Buchungstag.
    const zwei = zeilen[n + 1] ?? "";
    const tagTreffer = zwei.match(/(\d{2}\.\d{2}\.\d{4})\s*$/);
    const tag = tagTreffer ? parseDatum(tagTreffer[1]) : null;
    if (betrag === null || tag === null) {
      unvollstaendig++;
      n++;
      continue;
    }
    // Zeile 3 bis Leerzeile: Verwendungszweck.
    const zweckZeilen: string[] = [];
    let m = n + 2;
    while (m < zeilen.length && zeilen[m].trim() !== "") {
      if (!muell.test(zeilen[m])) zweckZeilen.push(zeilen[m].trim());
      m++;
    }
    rohe.push({
      buchungstag: tag,
      valuta: null,
      betrag,
      waehrung: "EUR",
      absender: absender || null,
      verwendungszweck: zweckZeilen.join(" ").trim() || null,
    });
    n = m;
  }

  const uebersprungen: Lesung["uebersprungen"] = [];
  if (unvollstaendig > 0)
    uebersprungen.push({
      grund: "Buchungskopf ohne lesbaren Tag oder Betrag",
      anzahl: unvollstaendig,
    });

  // Gegenprobe gegen den Kopf: Deckt das, was gelesen wurde, den
  // angegebenen Zeitraum ab? Wenn die Buchungen deutlich später beginnen
  // als der Filter, fehlt der Anfang -- etwa weil nur ein Teil des PDF
  // in Text umgewandelt wurde.
  const gelesen = zeitraumAus(rohe);
  if (zeitraum && gelesen) {
    const fehltVorn =
      (new Date(gelesen.von).getTime() - new Date(zeitraum.von).getTime()) /
      86_400_000;
    if (fehltVorn > 31) {
      warnungen.push(
        `Der Kopf nennt ${zeitraum.von} als Beginn, die erste gelesene ` +
          `Buchung ist vom ${gelesen.von}. Es fehlen rund ` +
          `${Math.round(fehltVorn)} Tage am Anfang.`,
      );
    }
  }

  return {
    format: "volksbank_pdfexport",
    konto_iban: iban,
    zeitraum: zeitraum ?? gelesen,
    buchungen: nummeriere(rohe),
    uebersprungen,
    warnungen,
  };
}

// --- Einstieg ----------------------------------------------------------------

export class UnbekanntesFormat extends Error {
  constructor() {
    super(
      "Das Format dieser Datei ist nicht erkannt worden. Erkannt werden: " +
        "Sparkasse-CSV, ING-CSV, Volksbank-CSV und der Volksbank-" +
        "PDF-Umsatzexport (als Text). Ein unbekanntes Format wird nicht " +
        "geraten — falsch gelesene Beträge wären schlimmer als keine.",
    );
    this.name = "UnbekanntesFormat";
  }
}

/**
 * Liest eine Kontoauszugsdatei. Wirft bei unbekanntem Format.
 *
 * Absichtlich kein Rateversuch als Rückfallebene: Ein falsch gelesener
 * Betrag oder ein um ein Jahr verschobener Buchungstag führt dazu, dass
 * eine Zahlung nicht zugeordnet wird -- und das sieht aus wie ein
 * Rückstand.
 */
export function liesKontoauszug(bytes: Buffer): Lesung & { kodierung: string } {
  const { text, kodierung } = dekodiere(bytes);
  const format = erkenneFormat(text);
  if (format === null) throw new UnbekanntesFormat();
  const lesung =
    format === "sparkasse_csv"
      ? liesSparkasse(text)
      : format === "ing_csv"
        ? liesIng(text)
        : format === "volksbank_csv"
          ? liesVolksbankCsv(text)
          : liesVolksbankPdf(text);
  return { ...lesung, kodierung };
}
