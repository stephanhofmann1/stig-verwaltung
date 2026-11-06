import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Tests der Zuordnungsliste.
 *
 * Geprueft wird am Quelltext: Die Route braucht eine Datenbank, die
 * Komponente einen Browser. Was hier gesichert werden muss, sind
 * Eigenschaften, die man beim Umbauen leicht verliert -- und deren
 * Verlust man erst merkt, wenn eine falsche Zuordnung in den Buechern
 * steht und niemand sie findet.
 *
 * Der Anlass (06.11.2026): Eine neue Regel ordnete 28 Bewegungen auf
 * einen Schlag zu. Die Begruendung stand in der Datenbank, angezeigt
 * wurde sie nirgends, und zuruecknehmen liess sich nichts.
 */

const route = readFileSync(
  new URL("../app/api/belege/zuordnungen/route.ts", import.meta.url),
  "utf8",
);
const komponente = readFileSync(
  new URL("../components/Zuordnungen.tsx", import.meta.url),
  "utf8",
);
const seite = readFileSync(new URL("../app/belege/page.tsx", import.meta.url), "utf8");

describe("Die Spur ist einsehbar", () => {
  test("die Liste zeigt die Begründung", () => {
    assert.match(route, /bb\.begruendung/);
    assert.match(komponente, /z\.begruendung/);
  });

  test("sie steht auf der Belegseite, vor den offenen Posten", () => {
    assert.match(seite, /<Zuordnungen anfang=\{zuordnungen\} \/>/);
    const wo = seite.indexOf("<Zuordnungen");
    const offen = seite.indexOf("Ausgaben ohne Beleg");
    assert.ok(wo > 0 && wo < offen, "die Liste steht nicht vor den offenen Ausgaben");
  });

  test("neueste zuerst, und begrenzt", () => {
    // Ohne Grenze wird die Seite mit der Zeit zur Chronik.
    assert.match(seite, /ORDER BY bb\.angelegt_am DESC\s*\n\s*LIMIT 40/);
    assert.match(route, /ORDER BY bb\.angelegt_am DESC/);
    assert.match(route, /Math\.min\(Math\.max\(roh, 1\), 300\)/);
  });

  test("der Beleg ist von der Zeile aus zu öffnen", () => {
    // Ohne den Blick in die Datei ist die Begründung nicht überprüfbar.
    assert.match(komponente, /\/api\/belege\/\$\{z\.beleg_id\}\/datei/);
  });
});

describe("Der Rückweg", () => {
  test("Lösen entfernt nur die Verbindung, nicht den Beleg", () => {
    assert.match(route, /DELETE FROM belegbuchung WHERE id = \$1 RETURNING beleg_id/);
    assert.ok(
      !/DELETE FROM beleg\b/.test(route),
      "die Route löscht den Beleg selbst",
    );
  });

  test("ein gelöster Beleg wird vermerkt, damit der Automat ihn liegen lässt", () => {
    // Sonst stellt der nächste Abgleich dieselbe Zuordnung wieder her,
    // und das Lösen von Hand wäre wirkungslos.
    assert.match(route, /UPDATE beleg SET abweichung =/);
    assert.match(route, /von Hand gelöst/);
  });

  test("der Vermerk nennt, wer gelöst hat", () => {
    assert.match(route, /\$\{sitzung\.name\}/);
  });

  test("nur eine gültige Kennung wird angenommen", () => {
    assert.match(route, /\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}/);
    assert.match(route, /Keine gültige Kennung/);
  });

  test("wer nur lesen darf, löst nicht", () => {
    const d = route.slice(route.indexOf("export async function DELETE"));
    assert.match(d, /sitzung\.rolle === "lesen"/);
    assert.match(d, /sitzung\.rolle === "mieter"/);
  });

  test("Lesen darf auch die Leserolle", () => {
    // Nachsehen ist kein Eingriff -- nur das Lösen ist einer.
    const g = route.slice(
      route.indexOf("export async function GET"),
      route.indexOf("export async function DELETE"),
    );
    assert.ok(!/rolle === "lesen"/.test(g), "die Leserolle kommt nicht an die Liste");
  });

  test("eine Zuordnung, die es nicht gibt, ergibt 404 und keinen Erfolg", () => {
    assert.match(route, /Diese Zuordnung gibt es nicht\./);
    assert.match(route, /status: 404/);
  });
});
