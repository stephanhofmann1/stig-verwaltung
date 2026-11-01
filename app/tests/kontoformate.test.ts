import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

import {
  liesKontoauszug,
  erkenneFormat,
  dekodiere,
  UnbekanntesFormat,
} from "../lib/kontoformate";

/**
 * Tests der Kontoauszugsleser.
 *
 * Die Pruefdaten sind NACHGEBAUT, nicht echt: gleiche Struktur, gleiche
 * Eigenheiten -- erfundene Namen, IBANs und Betraege. Echte Auszuege
 * gehoeren nicht ins Programmverzeichnis; sie wuerden mit jedem Paket auf
 * den Server wandern und in jedes Backup.
 *
 * Geprueft wird vor allem, dass die vier Fallen zuschnappen. Jede von ihnen
 * laesst eine Zahlung verschwinden oder doppelt erscheinen, und beides
 * sieht am Ende aus wie ein Mietrueckstand.
 */

/** cp1252-Bytes, wie die Sparkasse und die ING sie liefern. */
const cp1252 = (s: string): Buffer => {
  const b = Buffer.alloc(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
};
const utf8 = (s: string): Buffer => Buffer.from(s, "utf8");

// --- Sparkasse ---------------------------------------------------------------

const SK_KOPF =
  '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";' +
  '"Verwendungszweck";"Glaeubiger ID";"Mandatsreferenz";' +
  '"Kundenreferenz (End-to-End)";"Sammlerreferenz";' +
  '"Lastschrift Ursprungsbetrag";"Auslagenersatz Ruecklastschrift";' +
  '"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";' +
  '"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"';

const skZeile = (
  tag: string, name: string, betrag: string, info: string, zweck = "Miete",
) =>
  `"DE00111100002222333344";"${tag}";"${tag}";"GUTSCHRIFT";"${zweck}";"";"";` +
  `"";"";"";"";"${name}";"DE00999900008888777766";"TESTDEFF";` +
  `"${betrag}";"EUR";"${info}"`;

describe("Sparkasse-CSV", () => {
  test("zweistellige Jahre werden nicht zu 0026", () => {
    // TT.MM.JJ. Liest man das Jahr woertlich, landet die Buchung im Jahr 26
    // und damit zweitausend Jahre neben jeder Sollstellung.
    const b = cp1252([SK_KOPF, skZeile("12.10.26", "Mueller", "630,00", "Umsatz gebucht")].join("\n"));
    const l = liesKontoauszug(b);
    assert.equal(l.buchungen[0].buchungstag, "2026-10-12");
  });

  test("cp1252 wird erkannt, Umlaute bleiben erhalten", () => {
    // Als UTF-8 mit Ersetzung gelesen wuerde aus "Gruener" mit Umlaut ein
    // Fragezeichen -- und der Name passt dann zu keinem Mieter mehr.
    const b = cp1252([SK_KOPF, skZeile("01.09.26", "Grün", "500,00", "Umsatz gebucht")].join("\n"));
    const l = liesKontoauszug(b);
    assert.equal(l.kodierung, "cp1252");
    assert.equal(l.buchungen[0].absender, "Grün");
  });

  test("vorgemerkte Umsaetze werden NICHT uebernommen", () => {
    // Die Bank liefert dieselbe Zahlung Tage spaeter als gebuchten Umsatz,
    // oft mit anderem Buchungstag. Beides zu importieren zaehlt das Geld
    // zweimal -- der Mieter waere dann im Guthaben, und eine echte
    // Zahlungsluecke faellt nicht auf.
    const b = cp1252([
      SK_KOPF,
      skZeile("12.10.26", "Mueller", "630,00", "Umsatz vorgemerkt"),
      skZeile("10.10.26", "Schmitt", "500,00", "Umsatz gebucht"),
    ].join("\n"));
    const l = liesKontoauszug(b);
    assert.equal(l.buchungen.length, 1);
    assert.equal(l.buchungen[0].absender, "Schmitt");
    assert.deepEqual(l.uebersprungen, [
      { grund: "noch nicht gebucht (Info: vorgemerkt)", anzahl: 1 },
    ]);
  });

  test("fehlt die Info-Spalte, wird gewarnt statt still weitergemacht", () => {
    const kopf = SK_KOPF.replace(';"Info"', "");
    const zeile = skZeile("12.10.26", "Mueller", "630,00", "x").replace(
      ';"x"', "",
    );
    const l = liesKontoauszug(cp1252([kopf, zeile].join("\n")));
    assert.equal(l.buchungen.length, 1);
    assert.ok(l.warnungen.some((w) => /vorgemerkte/.test(w)));
  });

  test("ein Verwendungszweck mit Zeilenumbruch zerreisst die Zeile nicht", () => {
    const b = cp1252([
      SK_KOPF,
      '"DE00111100002222333344";"12.10.26";"12.10.26";"GUTSCHRIFT";"Miete\nOktober";' +
        '"";"";"";"";"";"";"Mueller";"DE00999900008888777766";"TESTDEFF";' +
        '"630,00";"EUR";"Umsatz gebucht"',
    ].join("\n"));
    const l = liesKontoauszug(b);
    assert.equal(l.buchungen.length, 1);
    assert.equal(l.buchungen[0].betrag, 630);
    assert.match(String(l.buchungen[0].verwendungszweck), /Miete.*Oktober/);
  });
});

// --- ING ---------------------------------------------------------------------

const ING = [
  "Umsatzanzeige;Datei erstellt am: 20.09.2026 13:55",
  "",
  "IBAN;DE00 1111 0000 2222 3333 44",
  "Kontoname;Girokonto",
  "Bank;ING",
  "Kunde;Testperson",
  "Zeitraum;20.09.2025 - 20.09.2026",
  "Saldo;3.693,22;EUR",
  "",
  "Sortierung;Datum absteigend",
  "",
  "In der CSV-Datei finden Sie alle bereits gebuchten Umsätze.",
  "",
  "Buchung;Wertstellungsdatum;Auftraggeber/Empfänger;Buchungstext;" +
    "Verwendungszweck;Saldo;Währung;Betrag;Währung",
  "18.09.2026;18.09.2026;Testfirma;Lastschrift;Beitrag;3.693,22;EUR;-11,00;EUR",
  "15.09.2026;15.09.2026;Mueller;Gutschrift;Miete;3.704,22;EUR;1.234,56;EUR",
].join("\n");

describe("ING-CSV", () => {
  test("die Datumsspalte heisst 'Buchung' und wird gefunden", () => {
    // Der allgemeine Leser sucht nach buchungstag/datum/valutadatum und
    // findet bei der ING keine Datumsspalte -- dann faellt jede Zeile als
    // unlesbar heraus und das Konto sieht leer aus.
    const l = liesKontoauszug(cp1252(ING));
    assert.equal(l.buchungen.length, 2);
    assert.equal(l.buchungen[0].buchungstag, "2026-09-18");
  });

  test("der Betrag wird genommen, nicht der Saldo", () => {
    // Saldo steht VOR Betrag. Verwechselt man beides, bucht die Anwendung
    // den Kontostand als Zahlungseingang -- hier 3.693,22 statt -11,00.
    const l = liesKontoauszug(cp1252(ING));
    assert.equal(l.buchungen[0].betrag, -11);
    assert.equal(l.buchungen[1].betrag, 1234.56, "Tausenderpunkt");
  });

  test("der Zeitraum kommt aus dem Kopf, nicht aus den Daten", () => {
    // Wichtig fuer die Vollstaendigkeit: Der Kopf sagt, was die Datei
    // abdecken SOLL. Nur aus den Buchungen gelesen waere der Zeitraum
    // immer genau so lang wie die vorhandenen Daten -- eine Luecke am
    // Anfang bliebe unsichtbar.
    const l = liesKontoauszug(cp1252(ING));
    assert.deepEqual(l.zeitraum, { von: "2025-09-20", bis: "2026-09-20" });
  });

  test("die fehlende Gegen-IBAN wird gemeldet", () => {
    const l = liesKontoauszug(cp1252(ING));
    assert.ok(l.warnungen.some((w) => /IBAN des Zahlungsbeteiligten/.test(w)));
  });
});

// --- Volksbank CSV -----------------------------------------------------------

const VB_KOPF =
  "﻿Bezeichnung Auftragskonto;IBAN Auftragskonto;BIC Auftragskonto;" +
  "Bankname Auftragskonto;Buchungstag;Valutadatum;Name Zahlungsbeteiligter;" +
  "IBAN Zahlungsbeteiligter;BIC (SWIFT-Code) Zahlungsbeteiligter;" +
  "Buchungstext;Verwendungszweck;Betrag;Waehrung;Saldo nach Buchung;" +
  "Bemerkung;Gekennzeichneter Umsatz;Glaeubiger ID;Mandatsreferenz";

const vbZeile = (tag: string, name: string, betrag: string, saldo: string) =>
  `Testkonto;DE00111100002222333344;TESTDEFF;TESTBANK;${tag};${tag};` +
  `${name};DE00999900008888777766;TESTDEFF;SEPA-Überweisung;Miete;` +
  `${betrag};EUR;${saldo};;;;`;

describe("Volksbank-CSV", () => {
  test("BOM und CRLF stoeren nicht", () => {
    const text = [VB_KOPF, vbZeile("15.09.2026", "Mueller", "630,00", "1630,00")]
      .join("\r\n");
    const l = liesKontoauszug(utf8(text));
    assert.equal(l.format, "volksbank_csv");
    assert.equal(l.buchungen.length, 1);
    assert.equal(l.buchungen[0].betrag, 630);
  });

  test("eine stimmige Saldokette erzeugt keine Warnung", () => {
    // Absteigend sortiert, Saldo gilt nach der Buchung:
    //   1630,00 - 630,00 = 1000,00 ✓   1000,00 - 500,00 = 500,00 ✓
    const text = [
      VB_KOPF,
      vbZeile("15.09.2026", "Mueller", "630,00", "1630,00"),
      vbZeile("14.09.2026", "Schmitt", "500,00", "1000,00"),
      vbZeile("13.09.2026", "Weber", "200,00", "500,00"),
    ].join("\r\n");
    const l = liesKontoauszug(utf8(text));
    assert.deepEqual(l.warnungen, []);
  });

  test("eine fehlende Zeile reisst die Saldokette und wird gemeldet", () => {
    // Das ist die einzige echte Vollstaendigkeitspruefung, die eine dieser
    // Dateien zulaesst: Die Bank liefert die Rechnung selbst mit.
    const text = [
      VB_KOPF,
      vbZeile("15.09.2026", "Mueller", "630,00", "1630,00"),
      // hier fehlt eine Buchung
      vbZeile("13.09.2026", "Weber", "200,00", "500,00"),
    ].join("\r\n");
    const l = liesKontoauszug(utf8(text));
    assert.ok(
      l.warnungen.some((w) => /Saldokette/.test(w)),
      "eine Luecke in der Saldokette muss auffallen",
    );
  });

  test("200 Umsaetze loesen die Warnung vor der stillen Kuerzung aus", () => {
    // Die gefaehrlichste Falle: Der Export sieht vollstaendig aus, enthaelt
    // aber nur die juengsten 200 Buchungen -- egal welcher Zeitraum
    // eingestellt war. Fehlende Mieten sehen dann aus wie Rueckstaende.
    const zeilen = [VB_KOPF];
    let saldo = 100000;
    for (let n = 0; n < 200; n++) {
      zeilen.push(vbZeile("15.09.2026", `Zahler${n}`, "10,00", saldo.toFixed(2).replace(".", ",")));
      saldo -= 10;
    }
    const l = liesKontoauszug(utf8(zeilen.join("\r\n")));
    assert.equal(l.buchungen.length, 200);
    assert.ok(
      l.warnungen.some((w) => /gek(ue|ü)rzt|kuerzt|kürzt/.test(w)),
      "bei 200 Umsaetzen muss vor der Kuerzung gewarnt werden",
    );
  });

  test("199 Umsaetze loesen sie nicht aus", () => {
    const zeilen = [VB_KOPF];
    let saldo = 100000;
    for (let n = 0; n < 199; n++) {
      zeilen.push(vbZeile("15.09.2026", `Zahler${n}`, "10,00", saldo.toFixed(2).replace(".", ",")));
      saldo -= 10;
    }
    const l = liesKontoauszug(utf8(zeilen.join("\r\n")));
    assert.deepEqual(l.warnungen, []);
  });
});

// --- Volksbank PDF-Umsatzexport ---------------------------------------------

const VB_PDF = [
  "BIC                  TESTDEFF                      Datum        12.10.2026",
  "IBAN                 DE00111100002222333344        Uhrzeit      21:23:33",
  "Kontoinhaber         Testkonto                     Abgefragt    Testperson",
  "",
  "Umsätze",
  "Filterparameter       13.09.2026 - 12.10.2026 Buchungsdatum, absteigend",
  "",
  "Testkonto                                               (Endsaldo) +1.543,64 EUR",
  "",
  "Mueller                                                          +1.350,00 EUR",
  "DE00999900008888777766                                              12.10.2026",
  "EREF: MIETE OKTOBER",
  "",
  "Stadtwerke Test AG                                               -4.629,41 EUR",
  "DE00888800007777666655                                              07.10.2026",
  "Abschlag Strom",
  "Fortsetzung des Zwecks",
  "",
  "Entgeltabschluss                                                     -9,90 EUR",
  "                                                                    30.09.2026",
  "Kontofuehrung",
  "",
  "Seite 1 von 1",
].join("\n");

describe("Volksbank-PDF-Umsatzexport", () => {
  test("drei Zeilen je Buchung werden zusammengesetzt", () => {
    const l = liesKontoauszug(utf8(VB_PDF));
    assert.equal(l.format, "volksbank_pdfexport");
    assert.equal(l.buchungen.length, 3);
    assert.equal(l.buchungen[0].betrag, 1350);
    assert.equal(l.buchungen[0].buchungstag, "2026-10-12");
    assert.equal(l.buchungen[0].absender, "Mueller");
  });

  test("ein mehrzeiliger Verwendungszweck wird zusammengezogen", () => {
    const l = liesKontoauszug(utf8(VB_PDF));
    assert.match(String(l.buchungen[1].verwendungszweck), /Abschlag Strom.*Fortsetzung/);
  });

  test("ein Entgelt ohne Gegen-IBAN wird trotzdem gelesen", () => {
    // Bei Entgelten fehlt die IBAN; in Zeile 2 steht nur der Tag. Wer nur
    // Zeilen mit IBAN nimmt, verliert alle Bankentgelte -- und damit
    // stimmt die Saldokette nicht mehr.
    const l = liesKontoauszug(utf8(VB_PDF));
    assert.equal(l.buchungen[2].betrag, -9.9);
    assert.equal(l.buchungen[2].buchungstag, "2026-09-30");
  });

  test("der Seitenfuss wird nicht zur Buchung", () => {
    const l = liesKontoauszug(utf8(VB_PDF));
    assert.ok(!l.buchungen.some((b) => /Seite \d/.test(String(b.absender))));
  });

  test("der Filterzeitraum kommt aus dem Kopf", () => {
    const l = liesKontoauszug(utf8(VB_PDF));
    assert.deepEqual(l.zeitraum, { von: "2026-09-13", bis: "2026-10-12" });
  });

  test("fehlt der Anfang gegenueber dem Kopf, wird gewarnt", () => {
    // So faellt auf, wenn nur ein Teil des PDF in Text umgewandelt wurde.
    const kurz = VB_PDF.replace(
      "Filterparameter       13.09.2026 - 12.10.2026",
      "Filterparameter       13.10.2025 - 12.10.2026",
    );
    const l = liesKontoauszug(utf8(kurz));
    assert.ok(l.warnungen.some((w) => /fehlen rund \d+ Tage am Anfang/.test(w)));
  });
});

// --- Format und Fingerabdruck ------------------------------------------------

describe("Format und Fingerabdruck", () => {
  test("ein unbekanntes Format wird nicht geraten", () => {
    // Lieber keine Daten als falsch gelesene: Ein um ein Jahr verschobener
    // Buchungstag laesst eine Zahlung unzugeordnet, und das sieht aus wie
    // ein Rueckstand.
    assert.equal(erkenneFormat("Datum,Betrag\n01.01.2026,100"), null);
    assert.throws(
      () => liesKontoauszug(utf8("Datum,Betrag\n01.01.2026,100")),
      UnbekanntesFormat,
    );
  });

  test("UTF-8 wird nicht als cp1252 gelesen", () => {
    const { kodierung, text } = dekodiere(utf8("Grün"));
    assert.equal(kodierung, "utf-8");
    assert.equal(text, "Grün");
  });

  test("zwei gleiche Buchungen am selben Tag bleiben zwei", () => {
    // Wer zwei Monatsmieten am selben Tag als zwei Ueberweisungen mit
    // demselben Zweck schickt, erzeugt zwei in allen Feldern gleiche
    // Zeilen. Ueber Tag/Betrag/Name/Zweck allein waeren die Fingerabdruecke
    // gleich, und die zweite verschwaende beim Import -- der Mieter haette
    // einen Monat offen, obwohl er gezahlt hat.
    const b = cp1252([
      SK_KOPF,
      skZeile("12.10.26", "Mueller", "630,00", "Umsatz gebucht"),
      skZeile("12.10.26", "Mueller", "630,00", "Umsatz gebucht"),
    ].join("\n"));
    const l = liesKontoauszug(b);
    assert.equal(l.buchungen.length, 2);
    assert.notEqual(
      l.buchungen[0].fingerabdruck,
      l.buchungen[1].fingerabdruck,
      "zwei gleiche Zahlungen muessen zwei Fingerabdruecke haben",
    );
  });

  test("derselbe Export zweimal gelesen ergibt dieselben Fingerabdruecke", () => {
    // Sonst legt jeder erneute Import dieselben Buchungen noch einmal an.
    const b = cp1252([
      SK_KOPF,
      skZeile("12.10.26", "Mueller", "630,00", "Umsatz gebucht"),
      skZeile("12.10.26", "Mueller", "630,00", "Umsatz gebucht"),
      skZeile("11.10.26", "Schmitt", "500,00", "Umsatz gebucht"),
    ].join("\n"));
    const a = liesKontoauszug(b).buchungen.map((x) => x.fingerabdruck);
    const c = liesKontoauszug(b).buchungen.map((x) => x.fingerabdruck);
    assert.deepEqual(a, c);
  });
});
