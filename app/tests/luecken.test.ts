import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { fehlendeMonate, fasseZusammen, monatsName } from "../lib/luecken";

/**
 * Tests der Lückenerkennung in den Kontodaten.
 *
 * Der Fall, der das nötig macht, ist echt: Der Volksbank-CSV-Export
 * schneidet stillschweigend bei 200 Umsätzen ab. Die Datei sieht danach
 * aus wie ein vollständiger Auszug über einen kürzeren Zeitraum, und für
 * Welserstraße 10 fehlten dadurch acht Monate, ohne dass irgendwo etwas
 * davon stand.
 */

describe("fehlendeMonate", () => {
  test("ohne Beginn der Kontodaten gibt es nichts zu melden", () => {
    // Augartenstrasse 91: kein Konto, kein Beginn, keine Mahnung. Eine
    // Luecken-Warnung waere dort nur Laerm.
    assert.deepEqual(fehlendeMonate(null, "2026-11-02", []), []);
    assert.deepEqual(fehlendeMonate(undefined, "2026-11-02", []), []);
    assert.deepEqual(fehlendeMonate("", "2026-11-02", []), []);
  });

  test("ein durchgehend belegter Zeitraum hat keine Lücken", () => {
    const tage = ["2026-08-05", "2026-09-03", "2026-10-02"];
    assert.deepEqual(fehlendeMonate("2026-08-01", "2026-11-02", tage), []);
  });

  test("ein fehlender Monat in der Mitte wird gefunden", () => {
    const tage = ["2026-08-05", "2026-10-02"];
    assert.deepEqual(
      fehlendeMonate("2026-08-01", "2026-11-02", tage),
      ["2026-09"],
    );
  });

  test("der laufende Monat wird nie gemeldet", () => {
    // Am Monatsersten liegt noch keine Miete vor. Eine Warnung, die
    // regelmaessig erscheint und von selbst verschwindet, lernt man zu
    // ignorieren -- und ignoriert dann auch die echten.
    assert.deepEqual(fehlendeMonate("2026-11-01", "2026-11-02", []), []);
    assert.deepEqual(
      fehlendeMonate("2026-10-01", "2026-11-02", []),
      ["2026-10"],
    );
  });

  test("der echte Fall Welserstraße 10: acht Monate fehlen", () => {
    // Konto ab 01.12.2024, erste eingelesene Buchung 31.07.2025.
    const fehlt = fehlendeMonate("2024-12-01", "2026-11-02", ["2025-07-31"]);
    assert.deepEqual(fehlt.slice(0, 8), [
      "2024-12", "2025-01", "2025-02", "2025-03",
      "2025-04", "2025-05", "2025-06",
      // Juli ist belegt, also kommt als achter August.
      "2025-08",
    ]);
    assert.ok(!fehlt.includes("2025-07"), "Juli 2025 hat eine Buchung");
  });

  test("Jahreswechsel wird richtig gezählt", () => {
    assert.deepEqual(
      fehlendeMonate("2025-11-01", "2026-02-10", []),
      ["2025-11", "2025-12", "2026-01"],
    );
  });

  test("ein Beginn in der Zukunft ergibt keine Lücken", () => {
    assert.deepEqual(fehlendeMonate("2027-01-01", "2026-11-02", []), []);
  });

  test("der Beginn mitten im Monat zählt den ganzen Monat", () => {
    // Ein Konto, das am 31.07. eroeffnet wird, kann fuer Juli nur einen
    // Tag haben. Liegt eine Buchung darin, ist der Monat belegt.
    assert.deepEqual(
      fehlendeMonate("2025-07-31", "2025-09-02", ["2025-07-31"]),
      ["2025-08"],
    );
  });
});

describe("fasseZusammen", () => {
  test("eine durchgehende Reihe wird eine Spanne", () => {
    assert.deepEqual(
      fasseZusammen(["2024-12", "2025-01", "2025-02"]),
      ["Dezember 2024 – Februar 2025"],
    );
  });

  test("ein einzelner Monat bleibt einzeln", () => {
    assert.deepEqual(fasseZusammen(["2025-09"]), ["September 2025"]);
  });

  test("zwei getrennte Reihen bleiben getrennt", () => {
    assert.deepEqual(
      fasseZusammen(["2025-01", "2025-02", "2025-05"]),
      ["Januar 2025 – Februar 2025", "Mai 2025"],
    );
  });

  test("unsortierte Eingabe wird sortiert", () => {
    assert.deepEqual(
      fasseZusammen(["2025-02", "2024-12", "2025-01"]),
      ["Dezember 2024 – Februar 2025"],
    );
  });

  test("leer bleibt leer", () => {
    assert.deepEqual(fasseZusammen([]), []);
  });
});

describe("monatsName", () => {
  test("deutsche Monatsnamen", () => {
    assert.equal(monatsName("2025-07"), "Juli 2025");
    assert.equal(monatsName("2024-12"), "Dezember 2024");
    // Zeitzonen: Ohne timeZone UTC wird aus dem 1. Januar in Berlin der
    // 31. Dezember des Vorjahres.
    assert.equal(monatsName("2026-01"), "Januar 2026");
  });
});
