import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  alsTag,
  darfEntscheiden,
  darfEntwerfen,
  freigabeKnopf,
  istZurueckgestellt,
  letzteEntscheidungen,
  mahnschreiben,
  offenePunkte,
  ohneZurueckgestellte,
  plusTage,
  pruefeGrund,
  pruefeVerschiebung,
  teileAuf,
  ZAHLUNGSZIEL,
  type Entscheidung,
} from "../lib/mahnablauf";
import { stufeFuer, type Rueckstand } from "../lib/mahnstufen";

/**
 * Tests des Mahnablaufs.
 *
 * Geprueft wird hier nicht, ob eine Zahl richtig gerechnet ist -- das
 * erledigt tests/mahnstufen.test.ts. Geprueft wird, ob die Bremsen halten:
 *
 *   gesperrtes Mahnwesen        -> es entsteht nicht einmal ein Entwurf
 *   offene Bereitschaftsliste   -> der Freigabeknopf bleibt zu
 *   verschobener Fall           -> wird nicht erneut vorgeschlagen
 *   fehlende Monatsmiete        -> sichtbar, aber ohne Schreiben
 *   Rolle "lesen"               -> darf gar nichts entscheiden
 *
 * Alle Namen in diesen Tests sind erfunden. In der Datenbank stehen echte
 * Personen, und die haben in einer Testdatei nichts zu suchen.
 */

const HEUTE = new Date("2026-11-02T09:00:00Z");

/** Ein Rueckstand, wie lib/mahnstufen.ts ihn liefert. */
function rueckstand(teil: Partial<Rueckstand> = {}): Rueckstand {
  return {
    mietverhaeltnis_id: "mv-1",
    kontakt_name: "A. Beispiel",
    einheit: "Einheit 3",
    offen: 620,
    monatsmiete: 620,
    aeltester_monat: "2026-09-01",
    tage_ueberfaellig: 60,
    offen_ohne_daten: 0,
    monate_ohne_daten: [],
    stufe: "mahnung",
    begruendung: "620,00 € offen, 60 Tage über der Fälligkeit.",
    ...teil,
  };
}

function entscheidung(teil: Partial<Entscheidung> = {}): Entscheidung {
  return {
    mietverhaeltnis_id: "mv-1",
    art: "verschoben",
    bis: "2026-12-01",
    grund: "Ratenzahlung zugesagt",
    wer: "verwalter",
    zeitpunkt: "2026-11-01T10:00:00Z",
    vorgang_id: "vg-1",
    vorgang_nummer: 42,
    ...teil,
  };
}

const befunde = (offen: string[]) => [
  { punkt: "Kontoumsätze importiert", erfuellt: !offen.includes("umsaetze") },
  { punkt: "Abgleich aktuell", erfuellt: !offen.includes("abgleich") },
  {
    punkt: "Keine unzugeordneten Zahlungseingänge",
    erfuellt: !offen.includes("eingaenge"),
  },
];

describe("Ohne Freigabe entsteht kein Entwurf", () => {
  test("gesperrtes Mahnwesen sperrt auch den Entwurf", () => {
    const d = darfEntwerfen({
      freigegeben: false,
      rolle: "verwalter",
      stufe: "mahnung",
      zurueckgestellt: false,
    });
    assert.equal(d.erlaubt, false);
    assert.match(d.grund, /gesperrt/i);
    // Der Entwurf ist kein harmloser Zwischenschritt: Er liegt danach in
    // der Freigabe und ist einen Klick von der Post entfernt.
    assert.match(d.grund, /Entwurf/);
  });

  test("freigegeben und ueber der Schwelle: erlaubt", () => {
    const d = darfEntwerfen({
      freigegeben: true,
      rolle: "verwalter",
      stufe: "mahnung",
      zurueckgestellt: false,
    });
    assert.equal(d.erlaubt, true);
  });

  test("zurueckgestellt bleibt gesperrt, auch bei Freigabe", () => {
    const d = darfEntwerfen({
      freigegeben: true,
      rolle: "verwalter",
      stufe: "mahnung",
      zurueckgestellt: true,
    });
    assert.equal(d.erlaubt, false);
    assert.match(d.grund, /wieder vorlegen/i);
  });

  test("eine Stufe ohne Schreiben wird nicht entworfen", () => {
    for (const stufe of ["ok", "faellig"] as const) {
      const d = darfEntwerfen({
        freigegeben: true,
        rolle: "verwalter",
        stufe,
        zurueckgestellt: false,
      });
      assert.equal(d.erlaubt, false, `Stufe ${stufe} darf kein Schreiben tragen`);
    }
  });
});

describe("Wer entscheiden darf", () => {
  test('Rolle "lesen" darf nicht freigeben und nicht entwerfen', () => {
    assert.equal(darfEntscheiden("lesen").erlaubt, false);
    assert.equal(
      darfEntwerfen({
        freigegeben: true,
        rolle: "lesen",
        stufe: "mahnung",
        zurueckgestellt: false,
      }).erlaubt,
      false,
    );
    const k = freigabeKnopf({
      befunde: befunde([]),
      schonFreigegeben: false,
      rolle: "lesen",
      notiz: "Abgleich geprüft",
    });
    assert.equal(k.erlaubt, false);
    assert.match(k.grund, /Verwalterzugang/);
  });

  test("ein Mieterzugang und ein fehlender Zugang duerfen nichts", () => {
    assert.equal(darfEntscheiden("mieter").erlaubt, false);
    assert.equal(darfEntscheiden(null).erlaubt, false);
  });

  test("der Verwalter darf", () => {
    assert.equal(darfEntscheiden("verwalter").erlaubt, true);
  });
});

describe("Der Freigabeknopf bleibt zu, solange etwas offen ist", () => {
  test("ein offener Punkt sperrt und wird benannt", () => {
    const k = freigabeKnopf({
      befunde: befunde(["eingaenge"]),
      schonFreigegeben: false,
      rolle: "verwalter",
      notiz: "Abgleich bis 10/2026 geprüft",
    });
    assert.equal(k.erlaubt, false);
    // Neben dem Knopf muss stehen, was fehlt -- nicht nur "gesperrt".
    assert.deepEqual(k.fehlt, ["Keine unzugeordneten Zahlungseingänge"]);
    assert.match(k.grund, /Keine unzugeordneten Zahlungseingänge/);
  });

  test("alles gruen und eine Notiz: erlaubt", () => {
    const k = freigabeKnopf({
      befunde: befunde([]),
      schonFreigegeben: false,
      rolle: "verwalter",
      notiz: "Abgleich bis 10/2026 geprüft, keine offenen Eingänge",
    });
    assert.equal(k.erlaubt, true);
    assert.deepEqual(k.fehlt, []);
  });

  test("ohne Notiz bleibt der Knopf zu", () => {
    const k = freigabeKnopf({
      befunde: befunde([]),
      schonFreigegeben: false,
      rolle: "verwalter",
      notiz: "   ",
    });
    assert.equal(k.erlaubt, false);
    assert.match(k.grund, /Notiz/);
  });

  test("eine leere Bereitschaftsliste gilt nicht als gruen", () => {
    // Konnte die Liste nicht erhoben werden, ist das kein Freibrief.
    const k = freigabeKnopf({
      befunde: [],
      schonFreigegeben: false,
      rolle: "verwalter",
      notiz: "trotzdem freigeben",
    });
    assert.equal(k.erlaubt, false);
  });

  test("zweimal freigeben geht nicht", () => {
    const k = freigabeKnopf({
      befunde: befunde([]),
      schonFreigegeben: true,
      rolle: "verwalter",
      notiz: "nochmal",
    });
    assert.equal(k.erlaubt, false);
    assert.match(k.grund, /bereits freigegeben/);
  });

  test("offenePunkte nennt genau die unerfuellten", () => {
    assert.deepEqual(offenePunkte(befunde(["umsaetze", "abgleich"])), [
      "Kontoumsätze importiert",
      "Abgleich aktuell",
    ]);
  });
});

describe("Ein verschobener Fall wird nicht erneut vorgeschlagen", () => {
  const stand = [rueckstand()];

  test("ohne Entscheidung steht der Fall zur Entscheidung", () => {
    const a = teileAuf(stand, new Map(), HEUTE);
    assert.equal(a.vorschlaege.length, 1);
    assert.equal(a.zurueckgestellt.length, 0);
  });

  test("verschoben in die Zukunft: kein Vorschlag", () => {
    const m = letzteEntscheidungen([entscheidung({ bis: "2026-12-01" })]);
    const a = teileAuf(stand, m, HEUTE);
    assert.equal(a.vorschlaege.length, 0);
    assert.equal(a.zurueckgestellt.length, 1);
    assert.equal(a.zurueckgestellt[0].entscheidung.grund, "Ratenzahlung zugesagt");
    // Dasselbe gilt fuer jede Stelle, die von selbst laeuft.
    assert.deepEqual(ohneZurueckgestellte(stand, m, HEUTE), []);
  });

  test("am Tag der Wiedervorlage ist der Fall wieder da", () => {
    const m = letzteEntscheidungen([entscheidung({ bis: alsTag(HEUTE) })]);
    assert.equal(ohneZurueckgestellte(stand, m, HEUTE).length, 1);
  });

  test('"nicht mahnen" gilt ohne Enddatum', () => {
    const m = letzteEntscheidungen([
      entscheidung({ art: "ausgesetzt", bis: null, grund: "vor Übergang" }),
    ]);
    assert.equal(ohneZurueckgestellte(stand, m, HEUTE).length, 0);
  });

  test("wieder vorlegen hebt die Verschiebung auf", () => {
    // Das Protokoll wird nur angefuegt. Die juengste Entscheidung gilt.
    const m = letzteEntscheidungen([
      entscheidung({ bis: "2026-12-01", zeitpunkt: "2026-11-01T10:00:00Z" }),
      entscheidung({
        art: "wieder_vorgelegt",
        bis: null,
        grund: "Rate nicht gekommen",
        zeitpunkt: "2026-11-02T08:00:00Z",
      }),
    ]);
    assert.equal(m.get("mv-1")!.art, "wieder_vorgelegt");
    assert.equal(ohneZurueckgestellte(stand, m, HEUTE).length, 1);
  });

  test("ein angelegter Entwurf stellt den Fall nicht zurueck", () => {
    // Er wartet dann in der Freigabe -- das ist kein Grund, ihn hier
    // verschwinden zu lassen, solange das Geld nicht da ist.
    const e = entscheidung({ art: "entworfen", bis: null });
    assert.equal(istZurueckgestellt(e, HEUTE), false);
  });

  test("eine Verschiebung ohne Datum gilt, bis jemand sie aufhebt", () => {
    assert.equal(
      istZurueckgestellt(entscheidung({ bis: null }), HEUTE),
      true,
    );
  });

  test("die juengste Entscheidung gewinnt, egal in welcher Reihenfolge", () => {
    const m = letzteEntscheidungen([
      entscheidung({ art: "wieder_vorgelegt", zeitpunkt: "2026-10-01T10:00:00Z" }),
      entscheidung({ art: "ausgesetzt", zeitpunkt: "2026-10-30T10:00:00Z" }),
      entscheidung({ art: "entworfen", zeitpunkt: "2026-10-02T10:00:00Z" }),
    ]);
    assert.equal(m.get("mv-1")!.art, "ausgesetzt");
  });
});

describe("Eine Zeile ohne Monatsmiete", () => {
  // Der Fall aus lib/mahnstufen.ts: Ist die Miete nicht hinterlegt, gibt es
  // keine Schwelle. Dann wird sichtbar gemacht, aber nie gemahnt.
  const r = stufeFuer(
    [
      {
        mietverhaeltnis_id: "mv-ohne-miete",
        kontakt_name: "B. Beispiel",
        einheit: "Einheit 7",
        monat: "2026-08-01",
        soll: 500,
        gezahlt: 0,
        ohne_zahlungsdaten: false,
      },
    ],
    0,
    HEUTE,
  );

  test("die Stufe traegt kein Schreiben", () => {
    assert.ok(r);
    assert.equal(r!.stufe, "faellig");
    assert.match(r!.begruendung, /Monatsmiete ist nicht hinterlegt/);
  });

  test("sie steht nicht unter den Vorschlaegen, aber sie verschwindet nicht", () => {
    const a = teileAuf([r!], new Map(), HEUTE);
    assert.deepEqual(a.vorschlaege, []);
    assert.equal(a.nurBeobachten.length, 1);
  });

  test("und sie laesst sich auch mit Freigabe nicht entwerfen", () => {
    const d = darfEntwerfen({
      freigegeben: true,
      rolle: "verwalter",
      stufe: r!.stufe,
      zurueckgestellt: false,
    });
    assert.equal(d.erlaubt, false);
  });
});

describe("Verschieben und Grund werden geprueft", () => {
  test("ein Datum in der Vergangenheit wird abgelehnt", () => {
    const p = pruefeVerschiebung({
      bis: "2026-10-01",
      grund: "Ratenzahlung zugesagt",
      heute: HEUTE,
    });
    assert.equal(p.ok, false);
    assert.match(p.fehler!, /Zukunft/);
  });

  test("heute ist kein Verschieben", () => {
    const p = pruefeVerschiebung({
      bis: alsTag(HEUTE),
      grund: "Ratenzahlung zugesagt",
      heute: HEUTE,
    });
    assert.equal(p.ok, false);
  });

  test("mehr als ein Jahr ist keine Verschiebung", () => {
    const p = pruefeVerschiebung({
      bis: plusTage(HEUTE, 400),
      grund: "Ratenzahlung zugesagt",
      heute: HEUTE,
    });
    assert.equal(p.ok, false);
    assert.match(p.fehler!, /nicht mahnen/);
  });

  test("ohne Grund geht nichts", () => {
    const p = pruefeVerschiebung({
      bis: "2026-12-01",
      grund: "ok",
      heute: HEUTE,
    });
    assert.equal(p.ok, false);
    assert.match(p.fehler!, /Grund/);
  });

  test("mit Datum und Grund geht es", () => {
    const p = pruefeVerschiebung({
      bis: "2026-12-01",
      grund: "  Ratenzahlung   zugesagt ",
      heute: HEUTE,
    });
    assert.equal(p.ok, true);
    assert.equal(p.bis, "2026-12-01");
    // Mehrfache Leerzeichen zusammenziehen, damit der Grund in einer
    // Tabellenzeile lesbar bleibt.
    assert.equal(p.grund, "Ratenzahlung zugesagt");
  });

  test("ein Grund wird gekuerzt, nicht abgelehnt", () => {
    const g = pruefeGrund("x".repeat(900));
    assert.equal(g.ok, true);
    assert.equal(g.grund.length, 500);
  });
});

describe("Das Schreiben fordert nur, was gedeckt ist", () => {
  const r = rueckstand({
    offen: 620,
    offen_ohne_daten: 7000,
    monate_ohne_daten: ["2024-01-01", "2024-02-01"],
  });
  const s = mahnschreiben({
    stufe: "mahnung",
    name: r.kontakt_name,
    einheit: r.einheit,
    offen: r.offen,
    aeltesterMonat: r.aeltester_monat,
    tageUeberfaellig: r.tage_ueberfaellig,
    heute: HEUTE,
  });

  test("der offene Betrag steht drin", () => {
    assert.match(s.koerper, /620,00/);
  });

  test("die Monate ohne Kontodaten stehen NICHT drin", () => {
    // Sie sind nicht unbezahlt, sondern unbekannt. Eine Forderung darueber
    // waere eine falsche Beschuldigung -- und 7.000 € statt 620 €.
    assert.doesNotMatch(s.koerper, /7\.000/);
    assert.doesNotMatch(s.koerper, /ohne Kontodaten/);
  });

  test("keine Kuendigungsdrohung im Schreiben", () => {
    assert.doesNotMatch(s.koerper, /543/);
    assert.doesNotMatch(s.koerper, /ündigung/);
  });

  test("die Faelligkeit wird mit Fundstelle benannt", () => {
    assert.match(s.koerper, /§ 556b Abs\. 1 BGB/);
  });

  test("das Zahlungsziel liegt in der Zukunft und passt zur Stufe", () => {
    assert.equal(s.zahlbarBis, plusTage(HEUTE, ZAHLUNGSZIEL.mahnung));
    assert.ok(s.zahlbarBis > alsTag(HEUTE));
  });

  test("die Zahlungserinnerung droht nicht, sondern erinnert", () => {
    const e = mahnschreiben({
      stufe: "erinnerung",
      name: r.kontakt_name,
      einheit: r.einheit,
      offen: 620,
      aeltesterMonat: r.aeltester_monat,
      tageUeberfaellig: 12,
      heute: HEUTE,
    });
    assert.match(e.betreff, /Zahlungserinnerung/);
    assert.match(e.koerper, /untergegangen/);
    assert.ok(e.zahlbarBis > s.zahlbarBis, "Erinnerung gibt mehr Zeit als Mahnung");
  });
});

describe("Von hier aus geht keine Post", () => {
  const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

  test("der Mahnablauf versendet nichts", () => {
    const s = quelle("../lib/mahnablauf.ts");
    assert.doesNotMatch(s, /sendeEntwurf|sendeSystemmail|nodemailer/);
    // Die Sperre steht vor dem Entwurf, nicht erst vor dem Versand.
    assert.match(s, /verlangeFreigabe\(\)/);
  });

  test("die Route versendet nichts und prueft die Anmeldung", () => {
    const s = quelle("../app/api/mahnwesen/route.ts");
    assert.doesNotMatch(s, /sendeEntwurf|sendeSystemmail|nodemailer/);
    assert.match(s, /angemeldeteSitzung\(\)/);
    assert.match(s, /darfEntscheiden/);
  });

  test("die Stufe wird nicht selbst gerechnet", () => {
    // Weder die Seite noch die Route darf eine eigene Schwelle kennen.
    for (const d of ["../app/mahnwesen/page.tsx", "../app/api/mahnwesen/route.ts"]) {
      const s = quelle(d);
      assert.doesNotMatch(s, /tage_ueberfaellig\s*[<>]=?\s*\d/);
      assert.doesNotMatch(s, /offen\s*[<>]=?\s*monatsmiete/);
    }
  });
});
