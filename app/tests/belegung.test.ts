import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { leiteStatusAb, type Zeile } from "../lib/oeffentlich";

/**
 * Tests fuer die Belegungsableitung der oeffentlichen Verfuegbarkeit.
 *
 * Diese Logik hat im September 2026 vermietete Zimmer als frei angeboten.
 * Der teure Fehler ist dabei nur einer von zwei moeglichen, und sie sind
 * nicht gleich teuer:
 *
 *   belegt als frei  -> Zusage an zwei Leute, Absage an einen davon.
 *   frei als belegt  -> ein Zimmer steht einen Monat leer.
 *
 * Deshalb pruefen diese Tests nicht nur, dass die richtigen Faelle "frei"
 * ergeben, sondern vor allem, dass alle unklaren Faelle es NICHT tun.
 */

/** Eine Einheit ohne jede Besonderheit: belegt, weil nichts dafuer spricht. */
function zeile(ueber: Partial<Zeile> = {}): Zeile {
  return {
    objekt: "Westanlage 9",
    einheit: "Zimmer 3",
    gruppe: "5er-WG 1. OG",
    etage: "1. OG",
    art: "wohnen",
    flaeche_qm: "14.5",
    angebot_kaltmiete: "600.00",
    angebot_nebenkosten: "90.00",
    vermarktung: "anbieten",
    verfuegbar_ab: null,
    vermarktungshinweis: null,
    belegung_gepflegt: false,
    laeuft: false,
    ende: null,
    vergeben: false,
    gekuendigt: false,
    kuendigung_zum: null,
    nachmieter_gesucht: false,
    ...ueber,
  };
}

// Fester Bezugspunkt, damit die Tests nicht im Januar anders ausgehen als im
// Juli. 1.11.2026 plus 92 Tage Vorlauf.
const HEUTE = new Date(Date.UTC(2026, 10, 1));
const GRENZE = new Date(HEUTE.getTime() + 92 * 86_400_000);

describe("Belegung: im Zweifel belegt", () => {
  test("ohne jede Angabe gilt eine Einheit als belegt", () => {
    // Der wichtigste Test der Datei. Eine Einheit, zu der nichts erfasst
    // ist, darf nie beworben werden -- das waere der Septemberfehler.
    const r = leiteStatusAb(zeile(), GRENZE);
    assert.equal(r.status, "belegt");
    assert.equal(r.freiAb, null);
  });

  test("kein Mietverhaeltnis genuegt nicht fuer 'frei'", () => {
    // belegung_gepflegt=false heisst: Die Altmieter dieser Einheit sind
    // moeglicherweise nie erfasst worden.
    assert.equal(
      leiteStatusAb(zeile({ laeuft: false, belegung_gepflegt: false }), GRENZE)
        .status,
      "belegt",
    );
  });

  test("erst mit gepflegter Belegung wird daraus 'frei'", () => {
    const r = leiteStatusAb(
      zeile({ laeuft: false, belegung_gepflegt: true }),
      GRENZE,
    );
    assert.equal(r.status, "frei");
    assert.equal(r.freiAb, null);
  });
});

describe("Belegung: laufende Mietverhaeltnisse", () => {
  test("laufend ohne Ende ist belegt", () => {
    assert.equal(
      leiteStatusAb(zeile({ laeuft: true, ende: null }), GRENZE).status,
      "belegt",
    );
  });

  test("Ende weit in der Zukunft bleibt belegt", () => {
    assert.equal(
      leiteStatusAb(zeile({ laeuft: true, ende: "2028-06-30" }), GRENZE)
        .status,
      "belegt",
    );
  });

  test("Ende innerhalb des Vorlaufs wird 'bald', ab dem Tag danach", () => {
    const r = leiteStatusAb(
      zeile({ laeuft: true, ende: "2026-12-31" }),
      GRENZE,
    );
    assert.equal(r.status, "bald");
    assert.equal(r.freiAb, "2027-01-01");
  });

  test("ein laufendes Mietverhaeltnis schlaegt gepflegte Belegung", () => {
    // Sonst wuerde belegung_gepflegt=true ein bewohntes Zimmer freigeben.
    assert.equal(
      leiteStatusAb(
        zeile({ laeuft: true, ende: null, belegung_gepflegt: true }),
        GRENZE,
      ).status,
      "belegt",
    );
  });
});

describe("Belegung: schon vergeben", () => {
  test("vergeben schlaegt alles andere", () => {
    // Auch wenn das alte Mietverhaeltnis ausgelaufen ist und die Belegung
    // gepflegt ist: Es gibt eine Zusage.
    const r = leiteStatusAb(
      zeile({
        vergeben: true,
        laeuft: false,
        belegung_gepflegt: true,
        gekuendigt: true,
        nachmieter_gesucht: true,
      }),
      GRENZE,
    );
    assert.equal(r.status, "belegt");
    assert.equal(r.freiAb, null);
  });
});

describe("Belegung: Kuendigungen", () => {
  test("gekuendigt mit Termin wird 'bald' mit Datum", () => {
    const r = leiteStatusAb(
      zeile({ laeuft: true, gekuendigt: true, kuendigung_zum: "2026-11-30" }),
      GRENZE,
    );
    assert.equal(r.status, "bald");
    assert.equal(r.freiAb, "2026-12-01");
  });

  test("gekuendigt mit Nachmietersuche wird 'frei', aber ohne Datum", () => {
    // Der haeufigste Fall in WGs -- und der, den beginn/ende nicht
    // ausdruecken kann. Ein Datum hier waere eine Zusage, die niemand
    // gegeben hat.
    const r = leiteStatusAb(
      zeile({
        laeuft: true,
        gekuendigt: true,
        kuendigung_zum: null,
        nachmieter_gesucht: true,
      }),
      GRENZE,
    );
    assert.equal(r.status, "frei");
    assert.equal(r.freiAb, null);
    assert.equal(r.hinweis, "Einzug nach Absprache");
  });

  test("gekuendigt ohne Termin und ohne Nachmietersuche bleibt 'bald'", () => {
    const r = leiteStatusAb(
      zeile({ laeuft: true, gekuendigt: true, kuendigung_zum: null }),
      GRENZE,
    );
    assert.equal(r.status, "bald");
    assert.equal(r.freiAb, null);
    assert.equal(r.hinweis, "Termin steht noch nicht fest");
  });

  test("Kuendigungstermin jenseits des Vorlaufs bleibt belegt", () => {
    const r = leiteStatusAb(
      zeile({ laeuft: true, gekuendigt: true, kuendigung_zum: "2027-09-30" }),
      GRENZE,
    );
    assert.equal(r.status, "belegt");
    assert.equal(r.freiAb, null);
  });

  test("ein fester Termin schlaegt die Nachmietersuche", () => {
    // Steht der Termin fest, ist das die genauere Auskunft -- und die
    // Datenbank verbietet diese Kombination ohnehin.
    const r = leiteStatusAb(
      zeile({
        laeuft: true,
        gekuendigt: true,
        kuendigung_zum: "2026-11-30",
        nachmieter_gesucht: true,
      }),
      GRENZE,
    );
    assert.equal(r.status, "bald");
    assert.equal(r.freiAb, "2026-12-01");
  });
});

describe("Belegung: Einheiten im Umbau", () => {
  test("im Bau wird nie 'frei', auch ohne Mietverhaeltnis", () => {
    // Ohne diesen Zweig meldet ein Rohbau "frei -- ab sofort".
    const r = leiteStatusAb(
      zeile({
        laeuft: false,
        belegung_gepflegt: true,
        vermarktung: "im_bau",
      }),
      GRENZE,
    );
    assert.equal(r.status, "bald");
    assert.ok(r.hinweis, "ein Umbau braucht einen Hinweis");
  });

  test("im Bau mit Termin nennt den Termin unter Vorbehalt", () => {
    const r = leiteStatusAb(
      zeile({
        laeuft: false,
        vermarktung: "im_bau",
        verfuegbar_ab: "2027-03-01",
        vermarktungshinweis: "Der Billardraum wird noch umgebaut.",
      }),
      GRENZE,
    );
    assert.equal(r.status, "bald");
    assert.equal(r.freiAb, "2027-03-01");
    assert.equal(r.hinweis, "Der Billardraum wird noch umgebaut.");
  });

  test("im Bau ohne Termin nennt kein Datum", () => {
    const r = leiteStatusAb(
      zeile({ laeuft: false, vermarktung: "im_bau", verfuegbar_ab: null }),
      GRENZE,
    );
    assert.equal(r.status, "bald");
    assert.equal(r.freiAb, null);
  });
});

describe("Belegung: Hinweistext", () => {
  test("ein eingetragener Hinweis gilt vor dem abgeleiteten", () => {
    const r = leiteStatusAb(
      zeile({
        laeuft: true,
        gekuendigt: true,
        nachmieter_gesucht: true,
        vermarktungshinweis: "Zimmer ist ab Mitte Dezember zu besichtigen.",
      }),
      GRENZE,
    );
    assert.equal(r.status, "frei");
    assert.equal(r.hinweis, "Zimmer ist ab Mitte Dezember zu besichtigen.");
  });

  test("ohne Anlass gibt es keinen Hinweis", () => {
    assert.equal(leiteStatusAb(zeile(), GRENZE).hinweis, null);
  });
});

describe("Belegung: kein Zweig erzeugt 'frei' aus Unwissen", () => {
  test("alle Kombinationen ohne positiven Belegungsnachweis", () => {
    // Erschoepfend ueber die Flaggen, die "frei" ueberhaupt erzeugen
    // koennen. Erwartung: frei nur bei (kein Mietverhaeltnis UND gepflegt)
    // oder (laufend UND gekuendigt UND Nachmieter gesucht).
    for (const laeuft of [true, false]) {
      for (const gepflegt of [true, false]) {
        for (const gekuendigt of [true, false]) {
          for (const nachmieter of [true, false]) {
            const r = leiteStatusAb(
              zeile({
                laeuft,
                belegung_gepflegt: gepflegt,
                gekuendigt: laeuft && gekuendigt,
                nachmieter_gesucht: laeuft && gekuendigt && nachmieter,
              }),
              GRENZE,
            );
            const darfFreiSein =
              (!laeuft && gepflegt) ||
              (laeuft && gekuendigt && nachmieter);
            if (r.status === "frei") {
              assert.ok(
                darfFreiSein,
                `frei trotz laeuft=${laeuft} gepflegt=${gepflegt} ` +
                  `gekuendigt=${gekuendigt} nachmieter=${nachmieter}`,
              );
            }
          }
        }
      }
    }
  });
});
