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
  monatsGeld,
  monatsErster,
  plusMonate,
  rueckstandsLage,
  serieGescheitert,
  spitze,
  tageBis,
  type EinheitLage,
  type LaufZeile,
  type MonatsPosten,
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
