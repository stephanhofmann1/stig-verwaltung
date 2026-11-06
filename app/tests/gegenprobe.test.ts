import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  datumFeld,
  gleichBetrag,
  gleichDatum,
  liesZulieferungen,
  nurName,
  widerspruch,
  zahl,
} from "../lib/gegenprobe";

/**
 * Tests der zweiten Meinung.
 *
 * Diese Datei entstand aus einem Fehlschlag: Am 05.11.2026 gingen 100
 * Amazon-Rechnungen mit einer Beifuegung ein, die das Portal nicht
 * zuordnen konnte -- Umschlag "belege", Feldnamen "betrag_brutto" statt
 * "brutto". Gemeldet wurden "0 Auffaellige". Das war kein Einvernehmen,
 * das war Schweigen. Die Tests hier halten beide Lehren fest: beim
 * Lesen grosszuegig, beim Nichttreffen laut.
 */

describe("Zulieferung lesen", () => {
  test("Zuordnung auf oberster Ebene", () => {
    const z = liesZulieferungen({ "a.pdf": { brutto: 45.44, datum: "2026-03-10" } });
    assert.ok(!("fehler" in z));
    if ("fehler" in z) return;
    assert.equal(z.anzahl, 1);
    assert.equal(z.umschlag, false);
    assert.equal(z.je["a.pdf"].brutto, 45.44);
  });

  test('der Umschlag "belege" wird mitgenommen', () => {
    // Der Fehler vom 05.11.2026.
    const z = liesZulieferungen({ belege: { "a.pdf": { brutto: 45.44 } } });
    assert.ok(!("fehler" in z));
    if ("fehler" in z) return;
    assert.equal(z.anzahl, 1);
    assert.equal(z.umschlag, true);
    assert.equal(z.je["a.pdf"].brutto, 45.44);
  });

  test("gleichbedeutende Feldnamen landen im selben Feld", () => {
    const z = liesZulieferungen({
      "a.pdf": { betrag_brutto: 45.44, belegdatum: "2026-03-10" },
      "b.pdf": { betrag: 1.5, rechnungsdatum: "2026-03-11", rechnungsnummer: "RE-1" },
    });
    assert.ok(!("fehler" in z));
    if ("fehler" in z) return;
    assert.equal(z.je["a.pdf"].brutto, 45.44);
    assert.equal(z.je["a.pdf"].datum, "2026-03-10");
    assert.equal(z.je["b.pdf"].brutto, 1.5);
    assert.equal(z.je["b.pdf"].belegnummer, "RE-1");
  });

  test("unbekannte Feldnamen werden nicht geraten", () => {
    const z = liesZulieferungen({ "a.pdf": { summe_irgendwas: 45.44 } });
    assert.ok(!("fehler" in z));
    if ("fehler" in z) return;
    assert.deepEqual(z.je["a.pdf"], {});
  });

  test("der Pfad fällt vom Schlüssel ab", () => {
    const z = liesZulieferungen({ "./Amazon/a.pdf": { brutto: 1 } });
    assert.ok(!("fehler" in z));
    if ("fehler" in z) return;
    assert.ok("a.pdf" in z.je);
  });

  test("kein Objekt ist ein Fehler, keine leere Antwort", () => {
    assert.ok("fehler" in liesZulieferungen(null));
    assert.ok("fehler" in liesZulieferungen([1, 2]));
    assert.ok("fehler" in liesZulieferungen("text"));
  });

  test("Einträge, die keine Objekte sind, werden übersprungen", () => {
    const z = liesZulieferungen({ "a.pdf": "unsinn", "b.pdf": { brutto: 2 } });
    assert.ok(!("fehler" in z));
    if ("fehler" in z) return;
    assert.equal(z.anzahl, 1);
  });
});

describe("Felder prüfen", () => {
  test("Beträge: Null bleibt Null, das Vorzeichen fällt weg", () => {
    // Eine Gutschrift ueber 103,96 EUR ist ein Beleg ueber 103,96 EUR.
    // Die Richtung steht am Beleg, nicht im Vorzeichen.
    assert.equal(zahl(45.44), 45.44);
    assert.equal(zahl(-103.96), 103.96);
    assert.equal(zahl(0), null);
    assert.equal(zahl("45,44"), null);
    assert.equal(zahl(null), null);
    assert.equal(zahl(1 / 0), null);
  });

  test("Datum nur in der strengen Form", () => {
    assert.equal(datumFeld("2026-03-10"), "2026-03-10");
    assert.equal(datumFeld("10.03.2026"), null);
    assert.equal(datumFeld(20260310), null);
  });

  test("nurName nimmt den letzten Teil", () => {
    assert.equal(nurName("a/b/c.pdf"), "c.pdf");
    assert.equal(nurName("c.pdf"), "c.pdf");
  });
});

describe("Vergleichen", () => {
  test("eine fehlende Quelle ist kein Widerspruch", () => {
    assert.equal(gleichBetrag(45.44, null), true);
    assert.equal(gleichBetrag(null, 45.44), true);
    assert.equal(gleichDatum("2026-03-10", null), true);
    assert.equal(widerspruch({ betrag: 45.44, datum: null }, { betrag: null, datum: null }), null);
  });

  test("Rundung auf Cent", () => {
    assert.equal(gleichBetrag(45.44, 45.44), true);
    assert.equal(gleichBetrag(45.444, 45.4401), true);
    assert.equal(gleichBetrag(45.44, 45.45), false);
  });

  test("der Widerspruch nennt beide Herkünfte", () => {
    const w = widerspruch(
      { betrag: 2026.02, datum: "2026-02-01" },
      { betrag: 100.0, datum: "2026-02-01" },
    );
    assert.ok(w);
    assert.match(w!, /Regelwerk 2026,02/);
    assert.match(w!, /Beifügung 100,00/);
    assert.ok(!/Datum/.test(w!), "das Datum stimmt und soll nicht erwähnt werden");
  });

  test("Betrag und Datum zugleich", () => {
    const w = widerspruch(
      { betrag: 1, datum: "2026-01-01" },
      { betrag: 2, datum: "2026-02-02" },
    );
    assert.match(w!, /Betrag:.*; Datum:/);
  });

  test("Einigkeit ergibt null, nicht einen leeren Text", () => {
    assert.equal(
      widerspruch({ betrag: 1, datum: "2026-01-01" }, { betrag: 1, datum: "2026-01-01" }),
      null,
    );
  });
});
