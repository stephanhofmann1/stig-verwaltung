import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  fehlendeFelder,
  fehlendeFelderWgb,
  zimmernummer,
  alsBetrag,
  ausZeile,
  alsAltform,
  type Vertragsdaten,
  type VertragsdatenZeile,
} from "../lib/vertragsdaten";

/**
 * Tests fuer die Pruefung vor der Dokumenterzeugung.
 *
 * Der Fehler, gegen den diese Datei schuetzt, ist nicht "das PDF ist
 * kaputt" -- das faellt auf. Er ist "das PDF sieht fertig aus und eine
 * Angabe fehlt": _vertrag.js laesst die Geburtsklausel ohne Geburtsdatum
 * einfach weg, und _wgb.js laesst leere Formularfelder weiss. Ein solches
 * Dokument geht raus, wird unterschrieben, und die Luecke faellt erst im
 * Streitfall auf. Deshalb pruefen diese Tests vor allem, dass jedes
 * einzelne Pflichtfeld wirklich zuschlaegt.
 *
 * Ohne Datenbank: geprueft wird nur, was rein rechnet.
 */

/** Ein vollstaendiges Mietverhaeltnis: unbefristet, moebliert, alles gepflegt. */
function vollstaendig(): Vertragsdaten {
  return {
    mietverhaeltnisId: "aaaaaaaa-0000-0000-0000-000000000001",
    email: "mieter@example.org",
    status: "aktiv",
    person: {
      vollerName: "Johanna Maria Vogt",
      anschriftVorher: "Beispielweg 3, 35390 Gießen",
      mobil: "+4915112345678",
      geburtsdatum: "1999-04-17",
      geburtsort: "Marburg",
    },
    einheit: {
      zimmer: "3",
      bezeichnung: "Zimmer 3",
      wohnung: "9er-WG",
      meldeZusatz: "EG rechts (9er-WG)",
      moebliert: true,
    },
    vertrag: {
      beginn: "2026-09-01",
      ende: null,
      datum: "2026-08-27",
      befristet: false,
      kuendigungsverzichtMonate: 12,
    },
    // 500 + 90 + 100 = 690: die Aufschluesselung nach § 556g geht auf.
    miete: { gesamt: 690, kalt: 500, nebenkosten: 90, moeblierung: 100 },
    kaution: { betrag: 1000, raten: 3 },
  };
}

/** Dasselbe mit einer gezielten Aenderung. */
function mit(aendere: (d: Vertragsdaten) => void): Vertragsdaten {
  const d = vollstaendig();
  aendere(d);
  return d;
}

describe("Vertrag: vollstaendige Angaben", () => {
  test("ein gepflegtes Mietverhaeltnis hat keine Luecken", () => {
    assert.deepEqual(fehlendeFelder(vollstaendig()), []);
  });

  test("die Mobilnummer ist kein Pflichtfeld", () => {
    // _vertrag.js setzt dafuer "-" ein. Ein gewollter Platzhalter darf die
    // Erzeugung nicht blockieren.
    assert.deepEqual(fehlendeFelder(mit((d) => { d.person.mobil = null; })), []);
  });

  test("ohne Kuendigungsverzicht gilt die gesetzliche Frist", () => {
    assert.deepEqual(
      fehlendeFelder(mit((d) => { d.vertrag.kuendigungsverzichtMonate = 0; })),
      [],
    );
  });

  test("eine Kaution in einer Summe ist vollstaendig", () => {
    assert.deepEqual(fehlendeFelder(mit((d) => { d.kaution.raten = 1; })), []);
  });

  test("drei Raten sind vollstaendig", () => {
    // Den Fall druckt § 4 woertlich richtig ("drei gleichen Monatsraten").
    assert.deepEqual(fehlendeFelder(mit((d) => { d.kaution.raten = 3; })), []);
  });

  test("zwei Raten blockieren den Vertrag", () => {
    // § 4 kennt nur "in einer Summe" oder "drei gleiche Monatsraten". Bei
    // zwei vereinbarten Raten druckt der Vertrag drei -- die Urkunde gaebe
    // die Abrede dann falsch wieder. Lieber kein Dokument.
    const fehlt = fehlendeFelder(mit((d) => { d.kaution.raten = 2; }));
    assert.equal(fehlt.length, 1);
    assert.match(fehlt[0], /Kautionsraten/);
    assert.match(fehlt[0], /nur 1 oder 3/);
  });
});

/**
 * Jedes Pflichtfeld einzeln. Die Liste ist absichtlich ausgeschrieben und
 * nicht aus der Funktion abgeleitet: Faellt ein Feld aus der Pruefung,
 * soll genau hier ein Test rot werden.
 */
const PFLICHT: [string, string, (d: Vertragsdaten) => void][] = [
  ["Voller Name", "Voller Name (wie im Pass)", (d) => { d.person.vollerName = null; }],
  ["Voranschrift", "Anschrift vor Einzug", (d) => { d.person.anschriftVorher = null; }],
  ["Geburtsdatum", "Geburtsdatum", (d) => { d.person.geburtsdatum = null; }],
  ["Geburtsort", "Geburtsort", (d) => { d.person.geburtsort = null; }],
  ["E-Mail", "E-Mail-Adresse", (d) => { d.email = null; }],
  ["Zimmernummer", "Zimmernummer", (d) => { d.einheit.zimmer = null; }],
  ["Mietbeginn", "Mietbeginn", (d) => { d.vertrag.beginn = null; }],
  ["Vertragsdatum", "Vertragsdatum", (d) => { d.vertrag.datum = null; }],
  ["Gesamtmiete", "Gesamtmiete", (d) => { d.miete.gesamt = null; }],
  ["Nettokaltmiete", "Nettokaltmiete", (d) => { d.miete.kalt = null; }],
  ["Nebenkosten", "Betriebskostenpauschale", (d) => { d.miete.nebenkosten = null; }],
  ["Kaution", "Kaution", (d) => { d.kaution.betrag = null; }],
];

describe("Vertrag: jedes Pflichtfeld schlaegt einzeln zu", () => {
  for (const [name, label, weg] of PFLICHT) {
    test(`${name} fehlt -> wird genannt`, () => {
      assert.deepEqual(fehlendeFelder(mit(weg)), [label]);
    });
  }
});

describe("Vertrag: leer ist nicht gepflegt", () => {
  test("Leerstring zaehlt als fehlend", () => {
    assert.deepEqual(
      fehlendeFelder(mit((d) => { d.person.geburtsdatum = ""; })),
      ["Geburtsdatum"],
    );
  });

  test("nur Leerzeichen zaehlt als fehlend", () => {
    // Sonst genuegt ein versehentliches Leerzeichen im Formular, um die
    // Pruefung zu bestehen -- und gedruckt wird derselbe leere Vertrag.
    assert.deepEqual(
      fehlendeFelder(mit((d) => { d.person.geburtsort = "   "; })),
      ["Geburtsort"],
    );
  });

  test("Leerzeichen in jedem Textfeld zaehlen als fehlend", () => {
    const d = mit((x) => {
      x.person.vollerName = " ";
      x.person.anschriftVorher = "\t";
      x.email = "  ";
      x.einheit.zimmer = " ";
      x.vertrag.beginn = " ";
      x.vertrag.datum = "\n";
    });
    assert.deepEqual(fehlendeFelder(d), [
      "Voller Name (wie im Pass)",
      "Anschrift vor Einzug",
      "E-Mail-Adresse",
      "Zimmernummer",
      "Mietbeginn",
      "Vertragsdatum",
    ]);
  });

  test("eine Gesamtmiete von null ist keine Gesamtmiete", () => {
    const f = fehlendeFelder(mit((d) => { d.miete.gesamt = 0; }));
    assert.ok(f.includes("Gesamtmiete"));
  });

  test("eine Betriebskostenpauschale von 0,00 EUR ist zulaessig", () => {
    // Keine Pauschale vereinbart ist eine Vereinbarung; leer ist keine.
    const d = mit((x) => {
      x.miete.nebenkosten = 0;
      x.miete.gesamt = 600;
      x.miete.moeblierung = 100;
    });
    assert.deepEqual(fehlendeFelder(d), []);
  });
});

describe("Vertrag: alle fehlenden Felder auf einmal", () => {
  test("mehrere Luecken werden alle genannt, nicht nur die erste", () => {
    // Der Fall der uebernommenen Altmieter: Geburtsdatum, Geburtsort und
    // Voranschrift stehen nur auf Papier. Die Liste muss als Arbeitsliste
    // taugen -- eine Angabe pro Durchgang waere drei Durchgaenge.
    const d = mit((x) => {
      x.person.geburtsdatum = null;
      x.person.geburtsort = null;
      x.person.anschriftVorher = null;
    });
    assert.deepEqual(fehlendeFelder(d), [
      "Anschrift vor Einzug",
      "Geburtsdatum",
      "Geburtsort",
    ]);
  });

  test("ein voellig leeres Mietverhaeltnis nennt jedes Pflichtfeld", () => {
    const leer: Vertragsdaten = {
      mietverhaeltnisId: "x",
      email: null,
      status: "vertrag_versendet",
      person: {
        vollerName: null,
        anschriftVorher: null,
        mobil: null,
        geburtsdatum: null,
        geburtsort: null,
      },
      einheit: {
        zimmer: null,
        bezeichnung: "Zimmer 7",
        wohnung: null,
        meldeZusatz: null,
        moebliert: false,
      },
      vertrag: {
        beginn: null,
        ende: null,
        datum: null,
        befristet: false,
        kuendigungsverzichtMonate: 0,
      },
      miete: { gesamt: null, kalt: null, nebenkosten: null, moeblierung: null },
      kaution: { betrag: null, raten: 1 },
    };
    const f = fehlendeFelder(leer);
    for (const [, label] of PFLICHT) assert.ok(f.includes(label), `fehlt: ${label}`);
    assert.equal(f.length, PFLICHT.length);
  });
});

describe("Vertrag: Befristung", () => {
  test("unbefristet ohne Enddatum ist vollstaendig", () => {
    // Der Normalfall. ende bleibt leer, § 2 druckt "laeuft auf
    // unbestimmte Zeit".
    const d = mit((x) => { x.vertrag.befristet = false; x.vertrag.ende = null; });
    assert.deepEqual(fehlendeFelder(d), []);
  });

  test("befristet ohne Enddatum ist unvollstaendig", () => {
    // Sonst druckt die Ueberschrift "befristet bis " ohne Datum.
    const d = mit((x) => { x.vertrag.befristet = true; x.vertrag.ende = null; });
    assert.deepEqual(fehlendeFelder(d), [
      "Enddatum (Vertrag ist als befristet erfasst)",
    ]);
  });

  test("befristet mit Enddatum ist vollstaendig", () => {
    const d = mit((x) => { x.vertrag.befristet = true; x.vertrag.ende = "2027-08-31"; });
    assert.deepEqual(fehlendeFelder(d), []);
  });

  test("ein Kuendigungstermin allein macht keine Befristung", () => {
    // ende traegt in dieser Datenbank auch den Auszugstermin eines
    // gekuendigten Mietverhaeltnisses (db/017). Das ist keine Luecke.
    const d = mit((x) => {
      x.status = "gekuendigt";
      x.vertrag.befristet = false;
      x.vertrag.ende = "2027-03-31";
    });
    assert.deepEqual(fehlendeFelder(d), []);
  });
});

describe("Vertrag: Moeblierungszuschlag", () => {
  test("klafft die Aufschluesselung, wird der Zuschlag verlangt", () => {
    // 690 zugesagt, 500 + 90 aufgeschluesselt: im gedruckten
    // § 556g-Nachweis fehlen 100 EUR. Genau an dieser Stelle ist der
    // Zuschlag in der Sollstellung schon einmal verloren gegangen.
    const d = mit((x) => { x.miete.moeblierung = null; });
    assert.deepEqual(fehlendeFelder(d), [
      "Möblierungszuschlag (Gesamtmiete liegt über Kalt + Nebenkosten)",
    ]);
  });

  test("ein Zuschlag von 0 zaehlt wie keiner", () => {
    const d = mit((x) => { x.miete.moeblierung = 0; });
    assert.equal(fehlendeFelder(d).length, 1);
  });

  test("geht die Rechnung ohne Zuschlag auf, wird keiner verlangt", () => {
    // Ein moebliertes Zimmer kann ohne gesonderten Zuschlag vermietet
    // sein. Dann steht in § 3 nur Kalt plus Pauschale, und das stimmt.
    const d = mit((x) => {
      x.miete.moeblierung = null;
      x.miete.gesamt = 590;
    });
    assert.deepEqual(fehlendeFelder(d), []);
  });

  test("eine Gesamtmiete unter der Summe der Posten verlangt keinen Zuschlag", () => {
    // Diese Abweichung meldet lib/sollstellung.ts als Mietabweichung; ein
    // fehlendes Feld ist sie nicht.
    const d = mit((x) => {
      x.miete.moeblierung = null;
      x.miete.gesamt = 560;
    });
    assert.deepEqual(fehlendeFelder(d), []);
  });

  test("ein Cent Luecke genuegt noch nicht, ein Euro schon", () => {
    const knapp = mit((x) => { x.miete.moeblierung = null; x.miete.gesamt = 590.001; });
    assert.deepEqual(fehlendeFelder(knapp), []);
    const klar = mit((x) => { x.miete.moeblierung = null; x.miete.gesamt = 591; });
    assert.equal(fehlendeFelder(klar).length, 1);
  });
});

describe("Wohnungsgeberbestaetigung: eigene Pflichtliste", () => {
  test("vollstaendige Angaben ergeben keine Luecke", () => {
    assert.deepEqual(fehlendeFelderWgb(vollstaendig()), []);
  });

  test("§ 19 BMG braucht Name, Einzug und Meldezusatz", () => {
    const d = mit((x) => {
      x.person.vollerName = null;
      x.vertrag.beginn = null;
      x.einheit.meldeZusatz = null;
    });
    assert.deepEqual(fehlendeFelderWgb(d), [
      "Voller Name (wie im Pass)",
      "Einzugsdatum (Mietbeginn)",
      "Meldezusatz (Lage der Wohnung im Haus)",
    ]);
  });

  test("ein leerer Meldezusatz bleibt im Formular weiss und zaehlt als fehlend", () => {
    assert.deepEqual(
      fehlendeFelderWgb(mit((x) => { x.einheit.meldeZusatz = "  "; })),
      ["Meldezusatz (Lage der Wohnung im Haus)"],
    );
  });

  test("Geburtsangaben, Voranschrift, Miete und Kaution sind hier nicht noetig", () => {
    // Der entscheidende Unterschied zur Vertragsliste: Die uebernommenen
    // Altmieter haben keine Geburtsangaben erfasst. Wuerde hier die
    // Vertragsliste gelten, bekaeme keiner von ihnen seine
    // Meldebestaetigung -- und die Anmeldung hat eine Zweiwochenfrist.
    const altmieter = mit((x) => {
      x.person.geburtsdatum = null;
      x.person.geburtsort = null;
      x.person.anschriftVorher = null;
      x.email = null;
      x.einheit.zimmer = null;
      x.vertrag.datum = null;
      x.miete = { gesamt: null, kalt: null, nebenkosten: null, moeblierung: null };
      x.kaution = { betrag: null, raten: 1 };
    });
    assert.deepEqual(fehlendeFelderWgb(altmieter), []);
    // Derselbe Datensatz taugt aber nicht fuer einen Vertrag.
    assert.ok(fehlendeFelder(altmieter).length > 0);
  });
});

describe("Zimmernummer aus dem Anzeigenamen", () => {
  test("WG-Zimmer im Erdgeschoss", () => {
    assert.equal(zimmernummer("Zimmer 3"), "3");
    assert.equal(zimmernummer("Zimmer 10"), "10");
  });

  test("WG-Zimmer in den Obergeschossen", () => {
    assert.equal(zimmernummer("Zimmer 1.5"), "1.5");
    assert.equal(zimmernummer("Zimmer 2.1"), "2.1");
  });

  test("Randzeichen stoeren nicht", () => {
    assert.equal(zimmernummer("  Zimmer 7  "), "7");
  });

  test("Wohnungen und Apartments haben keine Zimmernummer", () => {
    // Die Vertragsvorlage ist fuer WG-Zimmer geschrieben ("Vermietet wird
    // Zimmer Nummer ... in der Wohngemeinschaft"). Eine aus dem Namen
    // geratene Nummer stuende anschliessend im Vertrag.
    assert.equal(zimmernummer("Single-Apartment 3. OG"), null);
    assert.equal(zimmernummer("3-Zimmer-Wohnung DG"), null);
    assert.equal(zimmernummer("1-Zimmer-Apartment DG"), null);
    assert.equal(zimmernummer("Wohnung 2"), null);
    assert.equal(zimmernummer("Gewerbeflaeche EG"), null);
    assert.equal(zimmernummer("9er-WG"), null);
    assert.equal(zimmernummer(null), null);
    assert.equal(zimmernummer(""), null);
  });
});

describe("Betraege aus numeric-Text", () => {
  test("numeric kommt als Text aus der Datenbank", () => {
    assert.equal(alsBetrag("690.00"), 690);
    assert.equal(alsBetrag("0.00"), 0);
  });

  test("leer bleibt leer und wird nicht null Euro", () => {
    // Aus einem fehlenden Betrag darf keine 0 werden: sonst druckt § 3
    // "0,00 EUR" statt die Pruefung zu alarmieren.
    assert.equal(alsBetrag(null), null);
    assert.equal(alsBetrag(""), null);
    assert.equal(alsBetrag("   "), null);
    assert.equal(alsBetrag(undefined), null);
    assert.equal(alsBetrag("keine Zahl"), null);
  });
});

/** Eine Datenbankzeile, wie die Abfrage sie liefert: alles als Text. */
function zeile(ueber: Partial<VertragsdatenZeile> = {}): VertragsdatenZeile {
  return {
    id: "aaaaaaaa-0000-0000-0000-000000000001",
    status: "aktiv",
    email: "mieter@example.org",
    anzeigename: "Johanna Maria Vogt",
    geburtsdatum: "1999-04-17",
    geburtsort: "Marburg",
    anschrift_vorher: "Beispielweg 3, 35390 Gießen",
    mobil: "+4915112345678",
    bezeichnung: "Zimmer 3",
    wohnung: "9er-WG",
    melde_zusatz: "EG rechts (9er-WG)",
    moebliert: true,
    beginn: "2026-09-01",
    ende: null,
    vertrag_datum: "2026-08-27",
    befristet: false,
    kuendigungsverzicht_monate: 12,
    kaltmiete: "500.00",
    nebenkosten: "90.00",
    moeblierungszuschlag: "100.00",
    gesamtmiete: "690.00",
    kaution: "1000.00",
    kaution_raten: 3,
    ...ueber,
  };
}

describe("Abbildung einer Datenbankzeile", () => {
  test("eine gepflegte Zeile ergibt vollstaendige Vertragsdaten", () => {
    const d = ausZeile(zeile());
    assert.deepEqual(fehlendeFelder(d), []);
    assert.equal(d.person.vollerName, "Johanna Maria Vogt");
    assert.equal(d.einheit.zimmer, "3");
    assert.equal(d.miete.gesamt, 690);
    assert.equal(d.kaution.betrag, 1000);
    assert.equal(d.kaution.raten, 3);
    assert.equal(d.vertrag.kuendigungsverzichtMonate, 12);
  });

  test("der Vertrag bekommt die Anschrift von damals", () => {
    // kontakt.anschrift ist die heutige -- nach dem Einzug die Westanlage
    // 9 selbst. Ein Nachdruck wuerde sonst die Mietsache als
    // Mieteradresse zeigen.
    const d = ausZeile(zeile({ anschrift_vorher: "Alte Gasse 1, 60311 Frankfurt" }));
    assert.equal(d.person.anschriftVorher, "Alte Gasse 1, 60311 Frankfurt");
  });

  test("der Moeblierungszuschlag geht nicht verloren", () => {
    // Ohne gesetzte Gesamtmiete gilt Kalt + Neben + Moeblierung. Faellt
    // der Zuschlag heraus, stuenden 590 statt 690 EUR im Vertrag.
    const d = ausZeile(zeile({ gesamtmiete: null }));
    assert.equal(d.miete.gesamt, 690);
    assert.equal(d.miete.moeblierung, 100);
  });

  test("die zugesagte Gesamtmiete schlaegt die Summe der Posten", () => {
    // Geschuldet ist, was im Vertrag steht -- dieselbe Regel wie in
    // lib/sollstellung.ts, und sie wird von dort geholt.
    const d = ausZeile(zeile({ gesamtmiete: "700.00" }));
    assert.equal(d.miete.gesamt, 700);
  });

  test("ohne jeden Betrag bleibt die Gesamtmiete leer statt null Euro", () => {
    const d = ausZeile(
      zeile({ kaltmiete: null, nebenkosten: null, moeblierungszuschlag: null, gesamtmiete: null }),
    );
    assert.equal(d.miete.gesamt, null);
    assert.ok(fehlendeFelder(d).includes("Gesamtmiete"));
  });

  test("eine Wohnung ohne Zimmernummer faellt in die Pruefung", () => {
    const d = ausZeile(zeile({ bezeichnung: "Single-Apartment 3. OG", wohnung: null }));
    assert.equal(d.einheit.zimmer, null);
    assert.deepEqual(fehlendeFelder(d), ["Zimmernummer"]);
  });

  test("Vorgabewerte greifen, wenn die Spalte null liefert", () => {
    const d = ausZeile(zeile({ kuendigungsverzicht_monate: null, kaution_raten: null }));
    assert.equal(d.vertrag.kuendigungsverzichtMonate, 0);
    assert.equal(d.kaution.raten, 1);
  });
});

describe("Altform fuer die Dokumentvorlage", () => {
  test("die Vorlage sieht genau die Felder des Altsystems", () => {
    const mv = alsAltform(vollstaendig());
    assert.deepEqual(Object.keys(mv).sort(), [
      "einheit",
      "email",
      "kaution",
      "miete",
      "person",
      "vertrag",
    ]);
    assert.deepEqual(Object.keys(mv.person).sort(), [
      "anschriftVorher",
      "geburtsdatum",
      "geburtsort",
      "mobil",
      "vollerName",
    ]);
    assert.deepEqual(Object.keys(mv.miete).sort(), [
      "gesamt",
      "kalt",
      "moeblierung",
      "nebenkosten",
    ]);
  });

  test("ein Kuendigungstermin wird nicht als Befristung durchgereicht", () => {
    // _vertrag.js macht aus jedem gesetzten ende eine Befristung nach
    // § 549 Abs. 2 Nr. 1 BGB. In dieser Datenbank traegt ende aber auch
    // den Auszugstermin -- durchgereicht wuerde daraus ein
    // Zeitmietvertrag, den niemand geschlossen hat.
    const mv = alsAltform(
      mit((x) => { x.vertrag.befristet = false; x.vertrag.ende = "2027-03-31"; }),
    );
    assert.equal(mv.vertrag.ende, null);
  });

  test("bei echter Befristung geht das Enddatum mit", () => {
    const mv = alsAltform(
      mit((x) => { x.vertrag.befristet = true; x.vertrag.ende = "2027-08-31"; }),
    );
    assert.equal(mv.vertrag.ende, "2027-08-31");
  });
});
