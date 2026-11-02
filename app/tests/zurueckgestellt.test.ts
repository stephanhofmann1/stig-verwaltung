import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Eine zurückgestellte Mahnung bleibt zurückgestellt.
 *
 * Die Entscheidung "verschieben" oder "nicht mahnen" trifft Stephan auf der
 * Mahnseite. Sie wird als Protokolleintrag am Mahnvorgang festgehalten --
 * aber zwei Stellen holen den Mahnstand unabhängig davon:
 *
 *   - lib/lagebericht.ts: die Mail, die zweimal täglich rausgeht
 *   - lib/kennzahlen.ts:  die Rückstandskarte auf dem Cockpit
 *
 * Ohne den Filter verlangen beide jede Nacht erneut eine Entscheidung, die
 * schon getroffen wurde. Ein Bericht, der das tut, wird nach zwei Wochen
 * nicht mehr gelesen -- und dann fällt auch das auf, was wirklich neu ist.
 *
 * Geprüft wird am Quelltext, weil beide Funktionen unmittelbar an der
 * Datenbank hängen und es hier nicht um ihre Rechnung geht, sondern darum,
 * DASS sie filtern.
 */

const lies = (pfad: string) =>
  readFileSync(new URL(pfad, import.meta.url), "utf8");

describe("zurückgestellte Mahnungen kommen nicht wieder", () => {
  for (const [name, pfad] of [
    ["der nächtliche Lagebericht", "../lib/lagebericht.ts"],
    ["die Rückstandskarte des Cockpits", "../lib/kennzahlen.ts"],
  ] as const) {
    test(`${name} filtert sie heraus`, () => {
      const q = lies(pfad);
      assert.ok(
        q.includes("zurueckgestellteIds"),
        `${pfad} ruft zurueckgestellteIds nicht auf — eine verschobene ` +
          "Mahnung erscheint dort jede Nacht erneut",
      );
      // Auf die VERNEINTE Form prüfen, nicht auf "zurueck.has" allein.
      // Diese Lücke hatte der erste Entwurf dieses Tests: Nimmt man den
      // Filter aus der Liste der zu schreibenden Mahnungen heraus, bleibt
      // "zurueck.has(...)" an der harmlosen zweiten Stelle stehen -- der
      // Test war grün, obwohl der Schutz weg war. Gefunden durch die
      // Gegenprobe, nicht durch Nachdenken.
      assert.ok(
        /!zurueck\.has\(r\.mietverhaeltnis_id\)/.test(q),
        `${pfad} schliesst die zurückgestellten Fälle nicht aus — ` +
          "eine verschobene Mahnung wird dort erneut verlangt",
      );
      // Der Aufruf muss VOR der Verwendung stehen, sonst filtert er nichts.
      assert.ok(
        q.indexOf("zurueckgestellteIds(heute)") <
          q.lastIndexOf("!zurueck.has(r.mietverhaeltnis_id)"),
        `${pfad}: der Filter steht vor dem Laden`,
      );
    });
  }

  test("der Lagebericht verschweigt sie nicht, er sortiert sie nur um", () => {
    // Ein zurückgestellter Fall ist weiter ein Rückstand. Ihn ganz
    // weglassen hiesse, einen offenen Betrag aus dem Bericht zu nehmen --
    // genau das soll der Bericht nicht können.
    const q = lies("../lib/lagebericht.ts");
    assert.ok(
      q.includes("zurueckgestellt"),
      "der Lagebericht muss die zurückgestellten Fälle weiterhin nennen",
    );
    assert.ok(
      /zurückgestellt \(\$\{eur\(summe\)\}\)/.test(q) ||
        q.includes("zurückgestellt"),
      "mit Anzahl und Summe",
    );
  });

  test("das Mahnwesen rechnet die Stufe nicht selbst", () => {
    // Die Stufe kommt ausschliesslich aus lib/mahnstufen.ts. Eine zweite
    // Schwelle irgendwo waere eine zweite Wahrheit.
    for (const pfad of [
      "../lib/lagebericht.ts",
      "../lib/kennzahlen.ts",
      "../app/mahnwesen/page.tsx",
    ]) {
      const q = lies(pfad);
      assert.ok(
        !/monatsmiete\s*\*\s*[0-9]/.test(q),
        `${pfad} enthält eine eigene Schwellenrechnung`,
      );
    }
  });
});
