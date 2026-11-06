import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Tests der Bestandspruefung.
 *
 * Der Anlass (06.11.2026): Zwei Regeln des Abgleichs griffen zu weit --
 * ein Beleg hing an vier Abbuchungen, eine Quittung vom 17. Maerz an
 * einer Abbuchung vom 14. Januar. Beide Regeln sind behoben. Aber eine
 * behobene Regel raeumt nicht auf, was sie vorher angerichtet hat.
 *
 * Was die Pruefung nicht tun darf, steht hier: aendern.
 */
const route = readFileSync(
  new URL("../app/api/belege/pruefung/route.ts", import.meta.url),
  "utf8",
);

describe("Bestandsprüfung", () => {
  test("sie ändert nichts", () => {
    // Eine Pruefung, die selbst aufraeumt, nimmt einem die
    // Moeglichkeit, ihr zu widersprechen.
    assert.ok(
      !/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i.test(
        route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""),
      ),
      "die Route schreibt",
    );
  });

  test("es gibt nur GET", () => {
    const funktionen = [...route.matchAll(/export async function (\w+)/g)].map(
      (m) => m[1],
    );
    assert.deepEqual(funktionen, ["GET"]);
  });

  test("Mieter sehen sie nicht", () => {
    assert.match(route, /sitzung\.rolle === "mieter"/);
    assert.match(route, /status: 403/);
  });

  test("Mehrfachnutzung wird nur gemeldet, wenn die Summe den Beleg übersteigt", () => {
    // Eine Rechnung kann in Raten bezahlt werden. Zwei Zuordnungen
    // allein sind kein Fehler.
    assert.match(
      route,
      /HAVING count\(\*\) > 1[\s\S]*?sum\(bb\.betrag\) > abs\(bg\.betrag_brutto\)/,
    );
  });

  test("ein Beleg ohne Betrag gilt bei mehreren Zuordnungen als verdächtig", () => {
    assert.match(route, /bg\.betrag_brutto IS NULL\s*\n\s*OR sum\(bb\.betrag\)/);
  });

  test("das Zeitfenster ist dasselbe wie im Abgleich", () => {
    const abgleich = readFileSync(
      new URL("../lib/belegabgleich.ts", import.meta.url),
      "utf8",
    );
    for (const name of ["VORLAUF_TAGE", "NACHLAUF_TAGE"]) {
      const hier = new RegExp(`const ${name} = (\\d+)`).exec(route);
      const dort = new RegExp(`const ${name} = (\\d+)`).exec(abgleich);
      assert.ok(hier && dort, `${name} fehlt`);
      assert.equal(hier![1], dort![1], `${name} läuft auseinander`);
    }
  });

  test("Kennungstreffer bleiben vom Zeitfenster ausgenommen", () => {
    // Regel 0 und 1 treffen ueber eine Nummer, die der
    // Zahlungsempfaenger vergeben hat und die auf dem Beleg UND in der
    // Abbuchung steht. Eine Jahresabrechnung, 90 Tage spaeter bezahlt,
    // ist dort kein Fehler.
    assert.match(route, /NOT LIKE '%steht im Verwendungszweck%'/);
  });

  test("Belege ohne Datum werden beim Zeitfenster nicht beanstandet", () => {
    assert.match(route, /bg\.belegdatum IS NOT NULL/);
  });

  test("die Antwort nennt, wie viel geprüft wurde", () => {
    // Ohne den Nenner sagt "0 Beanstandungen" nichts.
    assert.match(route, /geprueft: Number\(gesamt\)/);
    assert.match(route, /count\(\*\)::text AS gesamt FROM belegbuchung/);
  });

  test("sie sagt ausdrücklich, wenn alles stimmt", () => {
    assert.match(route, /sauber:/);
    assert.match(
      route,
      /mehrfach\.length === 0 &&\s*\n\s*ausserZeit\.length === 0 &&\s*\n\s*ueberzogen\.length === 0/,
    );
  });

  test("jede Beanstandung nennt die Kennung der Zuordnung", () => {
    // Ohne sie kann niemand sie lösen.
    assert.match(route, /'zuordnung_id', bb\.id/);
    assert.match(route, /bb\.id AS zuordnung_id/);
  });
});
