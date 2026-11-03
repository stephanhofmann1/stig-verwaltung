import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  anteil,
  automatikLage,
  cashflowReihe,
  fristDringlichkeit,
  fristenLage,
  lageberichtLage,
  laufLage,
  leerstandsLage,
  lueckenGrund,
  mietstruktur,
  monatsGeld,
  monatsErster,
  plusMonate,
  rueckstandsLage,
  serieGescheitert,
  sollIstLage,
  sollIstReihe,
  spitze,
  stufenVerteilung,
  tageBis,
  type EinheitLage,
  type LaufZeile,
  type MietstrukturZeile,
  type MonatsPosten,
  type SollIstZeile,
} from "../lib/kennzahlen";
import type { Rueckstand } from "../lib/mahnstufen";

/**
 * Tests fuer die Kennzahlen des Cockpits.
 *
 * Eine Zahl auf der Startseite wird geglaubt, ohne nachzurechnen -- das ist
 * der Sinn einer Startseite. Deshalb pruefen diese Tests vor allem die
 * Faelle, in denen eine Zahl NICHT behauptet werden darf:
 *
 *   - Monate ohne Kontodaten sind nicht offen, sondern unbekannt.
 *     Sie zu addieren macht aus einem puenktlichen Zahler einen Schuldner.
 *   - Ein Monat ohne Sollstellungen ist nicht "0 EUR offen", sondern
 *     "noch nichts gestellt".
 *   - Ein Lauf, der vor zwei Tagen "ok" gemeldet hat, ist nicht ok.
 */

const tag = (iso: string) => new Date(iso + "T12:00:00Z");

// ---------------------------------------------------------------------------
// Datumsrechnung
// ---------------------------------------------------------------------------

describe("Tage bis zu einem Datum", () => {
  test("die Uhrzeit des Aufrufs aendert das Ergebnis nicht", () => {
    // Sonst waere eine Frist morgens "in 30 Tagen" und abends "in 29" --
    // und die Faerbung des Cockpits haengt an genau dieser Schwelle.
    assert.equal(tageBis("2026-12-31", new Date("2026-11-02T00:01:00Z")), 59);
    assert.equal(tageBis("2026-12-31", new Date("2026-11-02T23:59:00Z")), 59);
  });

  test("heute ist null, Vergangenheit ist negativ", () => {
    assert.equal(tageBis("2026-11-02", tag("2026-11-02")), 0);
    assert.equal(tageBis("2026-10-31", tag("2026-11-02")), -2);
  });

  test("plusMonate laeuft nicht ueber den Monatswechsel hinaus", () => {
    assert.equal(monatsErster(plusMonate(tag("2026-11-02"), 3)), "2027-02-01");
    assert.equal(monatsErster(plusMonate(tag("2026-12-15"), -11)), "2026-01-01");
  });
});

// ---------------------------------------------------------------------------
// 1. Fristen
// ---------------------------------------------------------------------------

describe("Fristen", () => {
  test("eine verstrichene Frist ist verstrichen, nicht knapp", () => {
    assert.equal(fristDringlichkeit(-1, null), "verstrichen");
  });

  test("ohne Abhaengigkeit wird es ab 30 Tagen kritisch", () => {
    assert.equal(fristDringlichkeit(31, null), "knapp");
    assert.equal(fristDringlichkeit(30, null), "kritisch");
  });

  test("haengt die Frist an einem Dritten, wird es schon ab 60 Tagen kritisch", () => {
    // Ein Versorger, der Zahlen nachliefern muss, braucht Wochen. Wer bei
    // so etwas 30 Tage vorher anfaengt, kommt zu spaet.
    assert.equal(fristDringlichkeit(45, null), "knapp");
    assert.equal(fristDringlichkeit(45, "TEHA liefert die Heizkosten nach"), "kritisch");
  });

  test("ab 91 Tagen ist eine Frist ruhig", () => {
    assert.equal(fristDringlichkeit(91, null), "ruhig");
    assert.equal(fristDringlichkeit(90, null), "knapp");
  });

  test("die naechste Frist steht oben, mit Resttagen", () => {
    const lage = fristenLage(
      [
        {
          bezeichnung: "NKA 2025 Westanlage",
          faellig_am: "2026-12-31",
          grundlage: "§ 556 Abs. 3 Satz 2 BGB",
          betrag: "2759.62",
          haengt_an: null,
        },
        {
          bezeichnung: "Heizungswartung",
          faellig_am: "2026-11-15",
          grundlage: null,
          betrag: null,
          haengt_an: null,
        },
      ],
      tag("2026-11-02"),
    );
    assert.deepEqual(
      lage.map((f) => [f.bezeichnung, f.resttage, f.dringlichkeit]),
      [
        ["Heizungswartung", 13, "kritisch"],
        ["NKA 2025 Westanlage", 59, "knapp"],
      ],
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Geld im laufenden Monat
// ---------------------------------------------------------------------------

const posten = (
  status: MonatsPosten["status"],
  soll: number,
  gezahlt = 0,
  id = "mv-" + status,
): MonatsPosten => ({ mietverhaeltnis_id: id, soll, gezahlt, status });

describe("Geld im laufenden Monat", () => {
  test("ohne Sollstellungen wird keine Zahl behauptet", () => {
    // Der Nachtlauf erzeugt die Sollstellungen. Laeuft er noch nicht, ist
    // "0 EUR offen" die Aussage "alles bezahlt" -- und die ist frei
    // erfunden.
    const g = monatsGeld([]);
    assert.equal(g.anzahl, 0);
    assert.equal(g.belastbar, false);
  });

  test("Soll, bezahlt und offen im Normalfall", () => {
    const g = monatsGeld([
      posten("bezahlt", 580, 580, "mv-1"),
      posten("teilweise", 630, 400, "mv-2"),
      posten("offen", 450, 0, "mv-3"),
    ]);
    assert.equal(g.soll, 1660);
    assert.equal(g.bezahlt, 980);
    assert.equal(g.offen, 680);
    assert.equal(g.offenBetroffen, 2);
    assert.equal(g.belastbar, true);
  });

  test("ein Monat ohne Kontodaten zaehlt NICHT als offen", () => {
    // Der teuerste Fehler dieser Datei. Welserstrasse: abgerechnet ab
    // Januar 2024, Konto erst ab Dezember 2024. Wuerde das hier
    // mitaddiert, zeigte das Cockpit elf Monatsmieten Rueckstand fuer
    // Mieter, die seit 2007 puenktlich zahlen.
    const g = monatsGeld([
      posten("offen", 450, 0, "mv-1"),
      posten("nicht_abgeglichen", 630, 0, "mv-2"),
    ]);
    assert.equal(g.offen, 450);
    assert.equal(g.offenBetroffen, 1);
    assert.equal(g.unabgeglichen, 630);
    assert.equal(g.unabgeglichenAnzahl, 1);
  });

  test("eine Teilzahlung ohne Kontodaten bleibt unabgeglichen", () => {
    // Der Fall, der einen zu schwachen Test ueberlebt: Ohne Kontodaten
    // kaeme bei einem Posten ohne jede Zahlung zufaellig dasselbe heraus.
    // Erst die Teilzahlung zeigt, ob der Status wirklich vorgeht.
    const g = monatsGeld([posten("nicht_abgeglichen", 630, 400)]);
    assert.equal(g.offen, 0);
    assert.equal(g.unabgeglichen, 230);
    assert.equal(g.bezahlt, 400);
    assert.equal(g.belastbar, false);
  });

  test("ist alles unabgeglichen, ist die Aussage nicht belastbar", () => {
    const g = monatsGeld([
      posten("nicht_abgeglichen", 630, 0, "mv-1"),
      posten("nicht_abgeglichen", 450, 0, "mv-2"),
    ]);
    assert.equal(g.belastbar, false);
    assert.equal(g.offen, 0);
  });

  test("noch nicht faellig ist kein Rueckstand", () => {
    const g = monatsGeld([posten("nicht_faellig", 580, 0)]);
    assert.equal(g.offen, 0);
    assert.equal(g.nochNichtFaellig, 580);
    assert.equal(g.belastbar, true);
  });

  test("bezahlt wird nicht hoeher als das Soll gezeigt", () => {
    const g = monatsGeld([posten("bezahlt", 580, 620)]);
    assert.equal(g.bezahlt, 580);
  });

  test("zwei offene Monate desselben Mieters sind ein Betroffener", () => {
    const g = monatsGeld([
      posten("offen", 580, 0, "mv-1"),
      posten("teilweise", 580, 100, "mv-1"),
    ]);
    assert.equal(g.offenBetroffen, 1);
    assert.equal(g.offen, 1060);
  });
});

// ---------------------------------------------------------------------------
// 4. Rueckstaende
// ---------------------------------------------------------------------------

const rueckstand = (
  stufe: Rueckstand["stufe"],
  offen: number,
  ohneDaten = 0,
): Rueckstand => ({
  mietverhaeltnis_id: "mv-" + stufe + offen,
  kontakt_name: "Testmieter",
  einheit: "Zimmer 1",
  offen,
  monatsmiete: 580,
  aeltester_monat: "2026-09-01",
  tage_ueberfaellig: 40,
  offen_ohne_daten: ohneDaten,
  monate_ohne_daten: ohneDaten > 0 ? ["2024-02-01"] : [],
  stufe,
  begruendung: "Testfall",
});

describe("Rueckstaende", () => {
  test("gezaehlt und summiert wird nach Stufe", () => {
    const l = rueckstandsLage([
      rueckstand("mahnung", 1200),
      rueckstand("erinnerung", 580),
      rueckstand("faellig", 100),
      rueckstand("ok", 580),
    ]);
    assert.equal(l.zuSchreiben, 2);
    assert.equal(l.summe, 1780);
    assert.equal(l.beobachten, 1);
    assert.equal(l.summeBeobachten, 100);
  });

  test("ungeklaerte Betraege stehen getrennt und fliessen nicht in die Summe", () => {
    const l = rueckstandsLage([rueckstand("mahnung", 1200, 7000)]);
    assert.equal(l.summe, 1200);
    assert.equal(l.ungeklaert, 1);
    assert.equal(l.summeUngeklaert, 7000);
  });

  test("ohne Rueckstaende ist alles null", () => {
    const l = rueckstandsLage([]);
    assert.equal(l.zuSchreiben, 0);
    assert.equal(l.summe, 0);
    assert.equal(l.ungeklaert, 0);
  });
});

// ---------------------------------------------------------------------------
// 5. Leerstand
// ---------------------------------------------------------------------------

const einheit = (
  einheitName: string,
  status: EinheitLage["status"],
  frei_ab: string | null = null,
): EinheitLage => ({
  objekt: "Testobjekt",
  einheit: einheitName,
  status,
  frei_ab,
  hinweis: null,
});

describe("Leerstand", () => {
  test("frei, bald frei und belegt werden getrennt", () => {
    const l = leerstandsLage(
      [
        einheit("Zimmer 1", "frei"),
        einheit("Zimmer 2", "bald", "2026-12-01"),
        einheit("Zimmer 3", "belegt"),
        einheit("Zimmer 4", "belegt"),
      ],
      tag("2026-11-02"),
    );
    assert.equal(l.frei.length, 1);
    assert.equal(l.bald.length, 1);
    assert.equal(l.belegt, 2);
    assert.equal(l.gesamt, 4);
  });

  test("was erst nach dem Fenster frei wird, zaehlt nicht mit", () => {
    const l = leerstandsLage(
      [
        einheit("Zimmer 1", "bald", "2027-01-15"),
        einheit("Zimmer 2", "bald", "2027-06-01"),
      ],
      tag("2026-11-02"),
      3,
    );
    assert.deepEqual(l.bald.map((e) => e.einheit), ["Zimmer 1"]);
  });

  test("ohne Termin steht das Zimmer oben -- das ist die Aufgabe", () => {
    // Gekuendigt, Auszug haengt am Nachmieter: kein Datum, aber der Fall,
    // um den sich jemand kuemmern muss.
    const l = leerstandsLage(
      [
        einheit("Zimmer 2", "bald", "2026-11-30"),
        einheit("Zimmer 1", "bald", null),
      ],
      tag("2026-11-02"),
    );
    assert.deepEqual(l.bald.map((e) => e.einheit), ["Zimmer 1", "Zimmer 2"]);
  });
});

// ---------------------------------------------------------------------------
// 6. Cashflow
// ---------------------------------------------------------------------------

describe("Cashflow", () => {
  test("Monate ohne Buchung bleiben als Luecke stehen", () => {
    // Wuerde die Reihe die fehlenden Monate weglassen, ruecken die Balken
    // zusammen und der Ausfallmonat -- der interessante -- verschwindet.
    const r = cashflowReihe(
      [{ monat: "2026-11", ein: 1000, aus: 200, miete: 900 }],
      tag("2026-11-02"),
      3,
    );
    assert.deepEqual(r.map((b) => b.monat), ["2026-09", "2026-10", "2026-11"]);
    assert.equal(r[0].ein, 0);
    assert.equal(r[2].ein, 1000);
  });

  test("zwoelf Monate endend im laufenden Monat", () => {
    const r = cashflowReihe([], tag("2026-11-02"));
    assert.equal(r.length, 12);
    assert.equal(r[0].monat, "2025-12");
    assert.equal(r[11].monat, "2026-11");
  });

  test("sonstige Einnahmen sind der nicht zugeordnete Rest", () => {
    const r = cashflowReihe(
      [{ monat: "2026-11", ein: 1000, aus: 0, miete: 820 }],
      tag("2026-11-02"),
      1,
    );
    assert.equal(r[0].miete, 820);
    assert.equal(r[0].sonstige, 180);
  });

  test("eine Zuordnung ueber den Eingaengen ergibt keine negative Einnahme", () => {
    const r = cashflowReihe(
      [{ monat: "2026-11", ein: 500, aus: 0, miete: 900 }],
      tag("2026-11-02"),
      1,
    );
    assert.equal(r[0].miete, 500);
    assert.equal(r[0].sonstige, 0);
  });

  test("die Spitze ist der groesste Balken aus Ein und Aus", () => {
    const r = cashflowReihe(
      [
        { monat: "2026-10", ein: 1000, aus: 2500, miete: 0 },
        { monat: "2026-11", ein: 1800, aus: 100, miete: 0 },
      ],
      tag("2026-11-02"),
      2,
    );
    assert.equal(spitze(r), 2500);
  });

  test("ohne Buchungen gibt es keine Division durch null", () => {
    assert.equal(spitze(cashflowReihe([], tag("2026-11-02"))), 0);
    assert.equal(anteil(0, 0), 0);
    assert.equal(anteil(100, 0), 0);
  });

  test("Anteile liegen zwischen 0 und 1", () => {
    assert.equal(anteil(500, 1000), 0.5);
    assert.equal(anteil(2000, 1000), 1);
    assert.equal(anteil(-50, 1000), 0);
  });
});

// ---------------------------------------------------------------------------
// 7. Zustand der Automatik
// ---------------------------------------------------------------------------

const lauf = (
  name: string,
  begonnen_am: string,
  ok = true,
  hinweise: string[] = [],
  ergebnis?: unknown,
): LaufZeile => ({ name, begonnen_am, ok, hinweise, ergebnis });

describe("Zustand der Automatik", () => {
  test("nie gelaufen ist der schlimmste Zustand", () => {
    assert.equal(laufLage(undefined, tag("2026-11-02")), "nie");
  });

  test("ein ok von vorgestern ist kein ok", () => {
    // Der stille Ausfall: Der letzte Lauf meldet Erfolg, aber der
    // Zeitplaner erreicht die Anwendung seit zwei Tagen nicht. Alle
    // anderen Zahlen dieser Seite sind dann ebenfalls zwei Tage alt.
    assert.equal(
      laufLage(
        { begonnen_am: "2026-10-31T18:00:00Z", ok: true, hinweise: [] },
        new Date("2026-11-02T07:00:00Z"),
      ),
      "steht",
    );
  });

  test("ein alter Fehllauf steht, er ist nicht nur gescheitert", () => {
    // Die Reihenfolge der Pruefungen ist selbst eine Aussage: Stillstand
    // schlaegt Fehler. Ein Lauf, dessen letzte Spur ein Fehler von
    // vorgestern ist, scheitert nicht mehr -- er findet gar nicht mehr
    // statt. "gescheitert" liest sich wie ein Vorfall von heute und
    // verdeckt, dass der Zeitplaner die Anwendung nicht erreicht.
    assert.equal(
      laufLage(
        { begonnen_am: "2026-10-31T18:00:00Z", ok: false, hinweise: [] },
        new Date("2026-11-02T07:00:00Z"),
      ),
      "steht",
    );
  });

  test("26 Stunden sind noch kein Stillstand, 27 schon", () => {
    const heute = new Date("2026-11-02T12:00:00Z");
    assert.equal(
      laufLage({ begonnen_am: "2026-11-01T11:00:00Z", ok: true, hinweise: [] }, heute),
      "ok",
    );
    assert.equal(
      laufLage({ begonnen_am: "2026-11-01T08:00:00Z", ok: true, hinweise: [] }, heute),
      "steht",
    );
  });

  test("frischer Fehler und frische Hinweise", () => {
    const heute = new Date("2026-11-02T12:00:00Z");
    assert.equal(
      laufLage({ begonnen_am: "2026-11-02T07:00:00Z", ok: false, hinweise: [] }, heute),
      "gescheitert",
    );
    assert.equal(
      laufLage(
        { begonnen_am: "2026-11-02T07:00:00Z", ok: true, hinweise: ["Mietabweichung"] },
        heute,
      ),
      "hinweise",
    );
  });

  test("eine Serie von Fehllaeufen wird gezaehlt", () => {
    // Drei Wochen an einem abgelaufenen Token zu scheitern sieht in einer
    // Momentaufnahme aus wie ein einmaliger Umfaller.
    assert.equal(
      serieGescheitert([{ ok: false }, { ok: false }, { ok: false }, { ok: true }]),
      3,
    );
    assert.equal(serieGescheitert([{ ok: true }, { ok: false }]), 0);
    assert.equal(serieGescheitert([]), 0);
  });

  test("Auffaelliges steht oben, der jüngste Lauf entscheidet", () => {
    const heute = new Date("2026-11-02T12:00:00Z");
    const lage = automatikLage(
      [
        lauf("agent", "2026-11-02T07:00:00Z"),
        lauf("bankabruf", "2026-11-02T07:00:00Z", false),
        lauf("bankabruf", "2026-11-01T18:00:00Z", false),
        lauf("mailabruf", "2026-10-20T07:00:00Z"),
      ],
      ["agent", "bankabruf", "mailabruf", "nachfassen"],
      heute,
    );
    assert.deepEqual(
      lage.map((p) => [p.name, p.lage]),
      [
        ["nachfassen", "nie"],
        ["mailabruf", "steht"],
        ["bankabruf", "gescheitert"],
        ["agent", "ok"],
      ],
    );
    assert.equal(lage.find((p) => p.name === "bankabruf")?.serie, 2);
  });

  test("die Reihenfolge der Zeilen aus der Datenbank ist egal", () => {
    const heute = new Date("2026-11-02T12:00:00Z");
    const lage = automatikLage(
      [
        lauf("agent", "2026-11-01T18:00:00Z", false),
        lauf("agent", "2026-11-02T07:00:00Z", true),
      ],
      ["agent"],
      heute,
    );
    assert.equal(lage[0].lage, "ok");
    assert.equal(lage[0].serie, 0);
  });
});

describe("Lagebericht", () => {
  test("heute nicht gelaufen", () => {
    const l = lageberichtLage(
      [lauf("lagebericht", "2026-11-01T18:00:00Z", true, [], { versendet: true })],
      new Date("2026-11-02T12:00:00Z"),
    );
    assert.equal(l.gelaufen, false);
    assert.equal(l.versendet, false);
  });

  test("gelaufen, aber nichts verschickt -- der stille Fall", () => {
    // Der Zeitplaner meldet gruen, auf dem Telefon kommt nichts an.
    const l = lageberichtLage(
      [lauf("lagebericht", "2026-11-02T07:00:00Z", true, [], { versendet: false })],
      new Date("2026-11-02T12:00:00Z"),
    );
    assert.equal(l.gelaufen, true);
    assert.equal(l.versendet, false);
  });

  test("gelaufen und verschickt", () => {
    const l = lageberichtLage(
      [lauf("lagebericht", "2026-11-02T07:00:00Z", true, [], { versendet: true })],
      new Date("2026-11-02T12:00:00Z"),
    );
    assert.equal(l.gelaufen, true);
    assert.equal(l.versendet, true);
  });

  test("ein gescheiterter Lauf hat nichts verschickt, auch wenn es im Ergebnis steht", () => {
    const l = lageberichtLage(
      [lauf("lagebericht", "2026-11-02T07:00:00Z", false, [], { versendet: true })],
      new Date("2026-11-02T12:00:00Z"),
    );
    assert.equal(l.versendet, false);
  });

  test("ohne Ergebnisfeld wird nichts behauptet", () => {
    const l = lageberichtLage(
      [lauf("lagebericht", "2026-11-02T07:00:00Z")],
      new Date("2026-11-02T12:00:00Z"),
    );
    assert.equal(l.gelaufen, true);
    assert.equal(l.versendet, false);
  });
});

// ---------------------------------------------------------------------------
// 8. Soll gegen Ist, zwoelf Monate
// ---------------------------------------------------------------------------

describe("Luecke oder Rueckstand", () => {
  // DIES IST DIE WICHTIGSTE PRUEFUNG DIESER KARTE.
  //
  // `lueckenGrund` ist die einzige Stelle, an der aus fehlenden Kontodaten
  // ein Rueckstand werden koennte. Fehlt diese Pruefung, passiert Folgendes:
  // Fuer die Monate vor dem Beginn der Kontoauszuege (Welserstrasse
  // 01.12.2024, Westanlage 13.06.2025, Augartenstrasse gar kein Konto --
  // db/023) liegt ein gestelltes Soll vor, aber kein zugeordnetes Ist. Die
  // Ist-Linie faellt dort auf Null, der Verlauf zeigt einen
  // Zahlungseinbruch ueber anderthalb Jahre, der nie stattgefunden hat --
  // und am Ende dieser Kette steht ein Mahnschreiben an jemanden, der
  // bezahlt hat. Genau diesen Fehler verhindern die naechsten Zeilen.
  test("ohne Kontodaten gibt es keine Aussage, auch wenn ein Soll gestellt ist", () => {
    assert.equal(lueckenGrund(9000, 9000), "ohne_kontodaten");
  });

  test("ohne Sollstellung ist der Grund ein anderer — und der Satz auch", () => {
    // "nichts gestellt" ist nicht "nicht abgeglichen". Im ersten Fall war
    // nichts zu zahlen, im zweiten weiss man es nicht.
    assert.equal(lueckenGrund(0, 0), "nichts_gestellt");
  });

  test("ein Teil mit Kontodaten genuegt fuer eine Aussage", () => {
    assert.equal(lueckenGrund(9000, 2000), null);
  });

  test("Unzahlen fuehren zur Luecke und nicht zu einer Behauptung", () => {
    assert.equal(lueckenGrund(9000, NaN), "ohne_kontodaten");
    assert.equal(lueckenGrund(NaN, 0), "nichts_gestellt");
    assert.equal(lueckenGrund(Infinity, 0), "nichts_gestellt");
  });
});

describe("Soll-/Ist-Reihe", () => {
  // Verhindert denselben Fehler eine Ebene hoeher: dass die Luecke in der
  // Reihe doch als Ist = 0 landet und damit gezeichnet wird.
  const bis = tag("2026-11-03");

  test("ein Monat ohne Kontodaten ist eine Luecke und NICHT Ist = 0", () => {
    const zeilen: SollIstZeile[] = [
      { monat: "2026-09", soll: 9000, soll_ohne_daten: 9000, ist: 0 },
      { monat: "2026-10", soll: 9000, soll_ohne_daten: 0, ist: 8000 },
      { monat: "2026-11", soll: 9000, soll_ohne_daten: 0, ist: 9000 },
    ];
    const reihe = sollIstReihe(zeilen, bis, 3);

    assert.deepEqual(
      reihe.map((p) => p.monat),
      ["2026-09", "2026-10", "2026-11"],
    );

    // Der September: gestellt, aber ohne Auszug.
    assert.equal(reihe[0].luecke, true);
    assert.equal(reihe[0].grund, "ohne_kontodaten");
    assert.equal(reihe[0].ist, null, "null heisst unbekannt — 0 hiesse unbezahlt");
    assert.notEqual(reihe[0].ist, 0);
    assert.equal(reihe[0].sollVergleichbar, null);
    assert.equal(reihe[0].rest, null, "ohne Ist gibt es keinen Rest");
    // Das gestellte Soll bleibt sichtbar -- aber in der Tabelle, nicht als
    // Linie, aus der ein Rueckstand abgelesen wird.
    assert.equal(reihe[0].soll, 9000);
    assert.equal(reihe[0].sollOhneDaten, 9000);

    // Der Oktober: echte Aussage.
    assert.equal(reihe[1].luecke, false);
    assert.equal(reihe[1].ist, 8000);
    assert.equal(reihe[1].rest, 1000);
  });

  test("ein teils abgleichbarer Monat wird nur in seinem abgleichbaren Teil verglichen", () => {
    // Zwei Objekte mit verschiedenem Beginn der Kontodaten. Verglich man
    // das Ist gegen das GANZE Soll, stuende hier ein Rueckstand von 2.500
    // statt 500 -- also 2.000 EUR Forderung aus einem Datenstand.
    const reihe = sollIstReihe(
      [{ monat: "2026-11", soll: 9000, soll_ohne_daten: 2000, ist: 6500 }],
      bis,
      1,
    );
    assert.equal(reihe[0].sollVergleichbar, 7000);
    assert.equal(reihe[0].ist, 6500);
    assert.equal(reihe[0].rest, 500);
    assert.equal(reihe[0].teilweiseOhneDaten, true);
    assert.equal(reihe[0].soll, 9000);
  });

  test("ein Monat ohne Sollstellung wird aufgefuellt, aber nicht mit Nullen behauptet", () => {
    // Die Reihe muss lueckenlos sein, sonst ruecken die Balken zusammen und
    // der interessante Monat verschwindet. Aufgefuellt wird aber mit einer
    // Luecke und nicht mit einem Nullwert.
    const reihe = sollIstReihe(
      [{ monat: "2026-11", soll: 9000, soll_ohne_daten: 0, ist: 9000 }],
      bis,
      3,
    );
    assert.equal(reihe.length, 3);
    assert.deepEqual(
      reihe.map((p) => p.monat),
      ["2026-09", "2026-10", "2026-11"],
    );
    assert.equal(reihe[0].grund, "nichts_gestellt");
    assert.equal(reihe[0].ist, null);
    assert.equal(reihe[0].soll, 0);
  });

  test("ein Ist ueber dem Soll wird nicht weggeklemmt", () => {
    // Eine doppelt zugeordnete Buchung soll auffallen, nicht verschwinden.
    const reihe = sollIstReihe(
      [{ monat: "2026-11", soll: 1000, soll_ohne_daten: 0, ist: 1200 }],
      bis,
      1,
    );
    assert.equal(reihe[0].ist, 1200);
    assert.equal(reihe[0].rest, -200);
  });

  test("Unzahlen in den Zeilen erzeugen keine NaN-Werte in der Reihe", () => {
    const reihe = sollIstReihe(
      [
        {
          monat: "2026-11",
          soll: Number.NaN,
          soll_ohne_daten: Number.POSITIVE_INFINITY,
          ist: Number.NaN,
        },
      ],
      bis,
      1,
    );
    assert.equal(reihe[0].luecke, true);
    for (const w of [reihe[0].soll, reihe[0].sollOhneDaten]) {
      assert.ok(Number.isFinite(w), `NaN im Ergebnis: ${w}`);
    }
    assert.equal(reihe[0].ist, null);
  });

  test("leere Eingabe ergibt zwoelf Luecken und keine Nulllinie", () => {
    const reihe = sollIstReihe([], bis);
    assert.equal(reihe.length, 12);
    assert.ok(reihe.every((p) => p.luecke && p.ist === null));
  });
});

describe("Soll-/Ist-Lage", () => {
  const bis = tag("2026-11-03");

  test("der erste Monat mit Rueckstand ist die Antwort auf 'ab wann'", () => {
    const reihe = sollIstReihe(
      [
        { monat: "2026-09", soll: 1000, soll_ohne_daten: 0, ist: 1000 },
        { monat: "2026-10", soll: 1000, soll_ohne_daten: 0, ist: 400 },
        { monat: "2026-11", soll: 1000, soll_ohne_daten: 0, ist: 300 },
      ],
      bis,
      3,
    );
    const lage = sollIstLage(reihe);
    assert.equal(lage.abMonat, "2026-10");
    assert.equal(lage.monateMitRest, 2);
    assert.equal(lage.summeRest, 1300); // 600 + 700
    assert.equal(lage.summeVergleichbar, 3000);
    assert.equal(lage.summeIst, 1700);
    assert.equal(lage.belastbar, 3);
    assert.equal(lage.luecken, 0);
  });

  test("Luecken zaehlen nicht in die Summen und nicht in den Rueckstand", () => {
    // Die beiden Zahlen stehen auf der Karte nebeneinander und werden nie
    // addiert -- aus demselben Grund, aus dem mahnstufen.ts sie trennt.
    const reihe = sollIstReihe(
      [
        { monat: "2026-10", soll: 1000, soll_ohne_daten: 1000, ist: 0 },
        { monat: "2026-11", soll: 1000, soll_ohne_daten: 0, ist: 1000 },
      ],
      bis,
      2,
    );
    const lage = sollIstLage(reihe);
    assert.equal(lage.belastbar, 1);
    assert.equal(lage.luecken, 1);
    assert.equal(lage.summeRest, 0, "aus einer Luecke entsteht kein Rueckstand");
    assert.equal(lage.abMonat, null);
    assert.equal(lage.summeOhneDaten, 1000);
    assert.equal(lage.summeVergleichbar, 1000);
  });

  test("ein Rest unter einem Euro ist Rundung und kein Rueckstand", () => {
    // Dieselbe Schwelle wie in monatsStatus(): anteilige Monate ergeben
    // Cent-Reste, und aus einem Cent wird keine Mahnung.
    const reihe = sollIstReihe(
      [{ monat: "2026-11", soll: 1000, soll_ohne_daten: 0, ist: 999.5 }],
      bis,
      1,
    );
    const lage = sollIstLage(reihe);
    assert.equal(lage.abMonat, null);
    assert.equal(lage.monateMitRest, 0);
  });

  test("ohne jede Aussage wird keine Null behauptet", () => {
    const lage = sollIstLage(sollIstReihe([], bis));
    assert.equal(lage.belastbar, 0);
    assert.equal(lage.luecken, 12);
    assert.equal(lage.abMonat, null);
    assert.equal(lage.summeVergleichbar, 0);
  });
});

// ---------------------------------------------------------------------------
// 9. Mietstruktur
// ---------------------------------------------------------------------------

describe("Mietstruktur", () => {
  // Verhindert den Fehler, der im Mieterbereich ein Jahr lang unentdeckt
  // blieb (siehe lib/mieter.ts): dass eine Inklusivmiete behandelt wird wie
  // eine Miete mit getrennter Kaltmiete. Hier waere die Folge eine
  // Kaltmietensumme auf der Startseite, die es nicht gibt -- und jede
  // Rendite- und Nebenkostenrechnung darauf ist falsch.
  const zeile = (
    t: Partial<MietstrukturZeile> & { soll: number },
  ): MietstrukturZeile => ({
    mietverhaeltnis_id: t.mietverhaeltnis_id ?? "mv-1",
    monat: t.monat ?? "2026-11",
    soll: t.soll,
    kaltmiete: t.kaltmiete ?? null,
    nebenkosten: t.nebenkosten ?? null,
    vertragssumme: t.vertragssumme ?? null,
  });

  test("eine Inklusivmiete landet VOLLSTAENDIG unter 'ohne Aufteilung'", () => {
    const s = mietstruktur([
      zeile({ mietverhaeltnis_id: "mv-A", soll: 630, vertragssumme: 630 }),
    ]);
    assert.equal(s.kalt, 0, "keine erfundene Kaltmiete");
    assert.equal(s.nebenkosten, 0);
    assert.equal(s.ohneAufteilung, 630);
    assert.equal(s.anzahlInklusiv, 1);
    assert.equal(s.anzahlAufgeteilt, 0);
  });

  test("die Segmente ergeben zusammen genau das Soll — auf den Cent", () => {
    // Gerechnet als Rest und nicht als zweite Summe: Sonst fehlte bei einem
    // Rundungsfehler ein Betrag im Bild, und niemand wuesste, welcher.
    //   Objekt A, Zimmer 1: 410,55 kalt + 89,45 BK  = 500,00 -> aufgeteilt
    //   Objekt A, Zimmer 2: Inklusivmiete 633,33          -> ohne Aufteilung
    //   Objekt A, Wohnung:  300,01 kalt + 99,99 BK + 80,00 Moebl = 480,00
    //                       -> aufgeteilt, 80,00 bleiben ohne Aufteilung
    // Soll  = 500,00 + 633,33 + 480,00 = 1.613,33
    // Kalt  = 410,55 + 300,01          =   710,56
    // BK    =  89,45 +  99,99          =   189,44
    // Rest  = 1.613,33 - 710,56 - 189,44 = 713,33
    const s = mietstruktur([
      zeile({
        mietverhaeltnis_id: "mv-A",
        soll: 500,
        kaltmiete: 410.55,
        nebenkosten: 89.45,
        vertragssumme: 500,
      }),
      zeile({ mietverhaeltnis_id: "mv-B", soll: 633.33, vertragssumme: 633.33 }),
      zeile({
        mietverhaeltnis_id: "mv-C",
        soll: 480,
        kaltmiete: 300.01,
        nebenkosten: 99.99,
        vertragssumme: 480,
      }),
    ]);
    assert.equal(s.soll, 1613.33);
    assert.equal(s.kalt, 710.56);
    assert.equal(s.nebenkosten, 189.44);
    assert.equal(s.ohneAufteilung, 713.33);
    assert.equal(s.kalt + s.nebenkosten + s.ohneAufteilung, 1613.33);
    assert.equal(s.anzahlAufgeteilt, 2);
    assert.equal(s.anzahlInklusiv, 1);
    assert.equal(s.anzahl, 3);
    assert.equal(s.monat, "2026-11");
  });

  test("ein anteiliger Monat wird nicht aufgeteilt", () => {
    // Einzug am 15.: Aus einem halben Monat wuerde sonst eine ganze
    // Kaltmiete. Dieselbe Regel wie in lib/mietenbuch.ts.
    const s = mietstruktur([
      zeile({
        mietverhaeltnis_id: "mv-A",
        soll: 250,
        kaltmiete: 400,
        nebenkosten: 100,
        vertragssumme: 500,
      }),
    ]);
    assert.equal(s.kalt, 0);
    assert.equal(s.ohneAufteilung, 250);
    assert.equal(s.anzahlAnteilig, 1);
    assert.equal(s.anzahlAufgeteilt, 0);
  });

  test("widerspruechliche Stammdaten werden gemeldet und nicht geglaettet", () => {
    // Kalt + BK waeren hoeher als das gestellte Soll. Geklemmt saehe die
    // Karte richtig aus, und der Fehler in den Stammdaten bliebe.
    const s = mietstruktur([
      zeile({
        mietverhaeltnis_id: "mv-A",
        soll: 600,
        kaltmiete: 400,
        nebenkosten: 300,
        vertragssumme: 600,
      }),
    ]);
    assert.equal(s.anzahlWidersprechend, 1);
    assert.equal(s.kalt, 0);
    assert.equal(s.ohneAufteilung, 600);
    assert.ok(s.ohneAufteilung >= 0, "kein negatives Segment");
  });

  test("Unzahlen und Nullbetraege kippen die Struktur nicht", () => {
    const s = mietstruktur([
      zeile({ mietverhaeltnis_id: "mv-A", soll: 0, vertragssumme: 0 }),
      zeile({ mietverhaeltnis_id: "mv-B", soll: Number.NaN }),
      zeile({
        mietverhaeltnis_id: "mv-C",
        soll: 500,
        kaltmiete: Number.NaN,
        nebenkosten: 100,
        vertragssumme: 500,
      }),
    ]);
    for (const w of [s.soll, s.kalt, s.nebenkosten, s.ohneAufteilung]) {
      assert.ok(Number.isFinite(w), `NaN im Ergebnis: ${w}`);
    }
    // Eine Kaltmiete von NaN ist keine Kaltmiete: Die Zeile gilt als
    // Inklusivmiete und wird nicht aufgeteilt.
    assert.equal(s.soll, 500);
    assert.equal(s.kalt, 0);
    assert.equal(s.ohneAufteilung, 500);
    assert.equal(s.anzahlInklusiv, 1);
  });

  test("keine Zeilen: kein Monat, keine Nullen als Aussage", () => {
    const s = mietstruktur([]);
    assert.equal(s.monat, null, "ohne Daten gibt es keinen Monat zu nennen");
    assert.equal(s.soll, 0);
    assert.deepEqual(s.stufen, []);
  });
});

describe("Verteilung nach Mietstufen", () => {
  // Verhindert eine Verteilung, die aus ihrer Stufenbreite entsteht und
  // nicht aus den Daten: Bei WG-Zimmern um 400 EUR waeren 500er-Stufen eine
  // einzige Saeule -- also ein Bild ohne Inhalt.
  test("Stufenbreite und Einordnung — nachgerechnet", () => {
    // max = 630 > 600 -> Breite 200 -> ceil(630/200) = 4 Stufen
    //   350 -> floor(350/200) = 1 ; 420 -> 2 ; 630 -> 3
    const stufen = stufenVerteilung([350, 420, 630]);
    assert.equal(stufen.length, 4);
    assert.deepEqual(
      stufen.map((s) => [s.von, s.bis, s.anzahl]),
      [
        [0, 200, 0],
        [200, 400, 1],
        [400, 600, 1],
        [600, 800, 1],
      ],
    );
    assert.equal(stufen[1].summe, 350);
  });

  test("ein Wert genau auf der Stufengrenze faellt nicht aus der Verteilung", () => {
    // 600 / 100 = 6 -- das waere die siebte von sechs Stufen.
    const stufen = stufenVerteilung([600]);
    assert.equal(stufen.length, 6);
    assert.equal(stufen[5].anzahl, 1);
    assert.equal(
      stufen.reduce((s, st) => s + st.anzahl, 0),
      1,
      "kein Mietverhaeltnis darf verloren gehen",
    );
  });

  test("Unzahlen und Nullbetraege werden nicht gezaehlt", () => {
    const stufen = stufenVerteilung([Number.NaN, -5, 0, 300]);
    assert.equal(
      stufen.reduce((s, st) => s + st.anzahl, 0),
      1,
    );
  });

  test("keine Betraege: keine erfundenen Stufen", () => {
    assert.deepEqual(stufenVerteilung([]), []);
    assert.deepEqual(stufenVerteilung([Number.NaN]), []);
  });
});

describe("Mietstufen über Bestandsgrößen hinweg", () => {
  // Dieselbe Begruendung wie in tests/diagramm.test.ts: Die Anwendung wird
  // mehreren Verwaltern angeboten. Eine feste Stufenleiter im Quelltext
  // ("bis 600 EUR -> 100er-Stufen") ist auf einen Bestand geeicht und faellt
  // erst beim zweiten Kunden auf -- dort als Verteilung mit achtzig Saeulen
  // oder mit einer. Beide Faelle laufen hier durch dieselbe Funktion.
  test("Einzelzimmer um 400 € ergeben rund fünf Stufen", () => {
    // max = 420 ; 420/6 = 70 -> lesbareStufe(70) = 100 -> ceil(420/100) = 5
    const stufen = stufenVerteilung([380, 400, 420]);
    assert.equal(stufen.length, 5);
    assert.deepEqual(
      stufen.map((s) => s.anzahl),
      [0, 0, 0, 1, 2],
    );
  });

  test("ein Gewerbeobjekt von 80.000 € ergibt ebenso wenige Stufen", () => {
    // max = 80.000 ; 80.000/6 = 13.333 -> lesbareStufe = 20.000
    // -> ceil(80.000/20.000) = 4 Stufen
    const stufen = stufenVerteilung([12000, 74000, 80000]);
    assert.equal(stufen.length, 4);
    assert.equal(stufen[0].von, 0);
    assert.equal(stufen[0].bis, 20000);
    assert.deepEqual(
      stufen.map((s) => s.anzahl),
      [1, 0, 0, 2],
    );
  });

  test("keine Bestandsgröße führt zu einer einzigen oder zu dreißig Säulen", () => {
    for (const spitze of [1, 50, 420, 1200, 3000, 80000, 2_150_000]) {
      const stufen = stufenVerteilung([spitze / 3, spitze / 2, spitze]);
      assert.ok(
        stufen.length >= 2 && stufen.length <= 10,
        `Spitze ${spitze}: ${stufen.length} Stufen`,
      );
      assert.equal(
        stufen.reduce((s, st) => s + st.anzahl, 0),
        3,
        `Spitze ${spitze}: kein Mietverhältnis darf verloren gehen`,
      );
    }
  });
});
