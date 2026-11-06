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

/**
 * Tests des SQL-Waechters.
 *
 * ANLASS, 06.11.2026
 *
 * Die Route oben antwortete im Betrieb mit 500. In ihrer Abfrage stand
 * `< -$1` -- ein unary Minus auf einem Parameter ohne Typangabe, den
 * Postgres mit "operator is not unique: - unknown" abweist. 1404 Tests
 * waren gruen, tsc sauber, das Einspielen gruen. Kein Test konnte das
 * sehen, weil keiner die Abfrage ausgefuehrt hat.
 *
 * pruefe-sql.mts schliesst die Luecke dort, wo im Pruefauf schon eine
 * echte Datenbank steht. Diese Tests halten fest, was es nicht tun darf.
 */
describe("SQL-Wächter", () => {
  const pruefer = readFileSync(
    new URL("../pruefe-sql.mts", import.meta.url),
    "utf8",
  );
  const ablauf = readFileSync(
    new URL("../../.github/workflows/einspielen.yml", import.meta.url),
    "utf8",
  );

  test("er läuft im Prüflauf, nach den Migrationen", () => {
    const i = ablauf.indexOf("Migrationen durchgelaufen");
    const j = ablauf.indexOf("npx tsx pruefe-sql.mts");
    assert.ok(i > 0 && j > i, "der Wächter läuft nicht nach den Migrationen");
  });

  test("die Probe-Datenbank hat einen Hafen, sonst kommt er nicht hin", () => {
    assert.match(ablauf, /-p 127\.0\.0\.1:55432:5432 postgres:16/);
    assert.match(ablauf, /PGPORT=55432/);
  });

  test("er plant die Abfragen und führt sie nicht aus", () => {
    // PREPARE prueft Spalten, Typen und Parameter, ohne eine Zeile
    // anzufassen. Ein Waechter, der die Abfragen ausfuehrt, wuerde in
    // der Pruefdatenbank schreiben -- und bei einem DELETE ohne WHERE
    // waere das in einer Entwicklungsumgebung einmal zu viel.
    assert.match(pruefer, /PREPARE \$\{name\} AS/);
    assert.ok(
      !/client\.query\(b\.text\)/.test(pruefer),
      "der Wächter führt SQL aus",
    );
  });

  test("er räumt jede geplante Abfrage wieder ab", () => {
    assert.match(pruefer, /DEALLOCATE \$\{name\}/);
  });

  test("er zählt und nennt, was er NICHT prüfen konnte", () => {
    // Zusammengesetzte Abfragen sind hier nicht erreichbar. Ein
    // Waechter, der das verschweigt, laesst "alle planen" groesser
    // aussehen, als es ist.
    assert.match(pruefer, /zusammengesetzt \+= 1/);
    assert.match(pruefer, /bleiben hier ungeprueft/);
  });

  test("er fällt durch, wenn eine Abfrage nicht plant", () => {
    assert.match(pruefer, /process\.exit\(1\)/);
  });

  test("er sieht sich selbst und die Tests nicht an", () => {
    assert.match(pruefer, /n !== "pruefe-sql\.mts"/);
    assert.match(pruefer, /n === "tests"/);
  });

  test("der gefundene Fehler ist in der Route behoben und benannt", () => {
    assert.match(route, /\$1::int/);
    assert.match(route, /operator is not unique/);
  });
});
