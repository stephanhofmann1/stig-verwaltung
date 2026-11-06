import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Tests der Ruecknahme einer Lieferung.
 *
 * Der Anlass (06.11.2026): 61 Zahlungsnachweise gingen mit einem falsch
 * gelesenen Datum in die Ablage. Die Dateien waren selbst erzeugt, der
 * Fehler steckte im Dokument -- und es gab keinen Weg zurueck. Neu
 * einliefern haette Dubletten ergeben.
 *
 * Wer stapelweise einliefern kann, muss stapelweise zuruecknehmen
 * koennen. Was dabei NICHT passieren darf, steht hier.
 */
const route = readFileSync(
  new URL("../app/api/belege/einlieferung/route.ts", import.meta.url),
  "utf8",
);
const teil = route.slice(route.indexOf("export async function DELETE"));

describe("Zurücknehmen", () => {
  test("zugeordnete Belege bleiben stehen", () => {
    // Eine Zuordnung ist eine Entscheidung. Ein Loeschbefehl auf die
    // Lieferung darf sie nicht stillschweigend mitnehmen.
    assert.match(
      teil,
      /DELETE FROM beleg bg[\s\S]*?AND NOT EXISTS \(SELECT 1 FROM belegbuchung bb WHERE bb\.beleg_id = bg\.id\)/,
    );
  });

  test("sie werden gezählt und benannt, nicht verschwiegen", () => {
    assert.match(teil, /behalten_weil_zugeordnet/);
    assert.match(teil, /Erst die Zuordnung lösen/);
  });

  test("die Lieferung verschwindet nur, wenn nichts mehr an ihr hängt", () => {
    // Sonst bliebe ein Beleg ohne Herkunft zurueck.
    assert.match(teil, /if \(Number\(zugeordnet\) === 0\) \{[\s\S]*?DELETE FROM beleg_lieferung/);
  });

  test("die abgelegte Datei wird nicht gelöscht", () => {
    // Sie ist der einzige Originalbeleg. Ein Loeschbefehl, der
    // Originale vernichtet, ist eine andere Entscheidung als diese.
    assert.ok(!/unlink|rm\(|rmSync|ablage_pfad/.test(teil), "die Route fasst die Datei an");
    assert.match(teil, /Dateien bleiben auf der Platte/);
  });

  test("nur eine gültige Kennung wird angenommen", () => {
    assert.match(teil, /\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}/);
    assert.match(teil, /Keine gültige Kennung der Lieferung/);
  });

  test("eine Lieferung, die es nicht gibt, ergibt 404", () => {
    assert.match(teil, /Diese Lieferung gibt es nicht\./);
    assert.match(teil, /status: 404/);
  });

  test("wer nur lesen darf, nimmt nichts zurück", () => {
    assert.match(teil, /sitzung\.rolle === "lesen"/);
    assert.match(teil, /sitzung\.rolle === "mieter"/);
  });

  test("gezählt wird vor dem Löschen", () => {
    // Danach waere die Zahl immer null.
    const zaehlen = teil.indexOf("AS zugeordnet");
    const loeschen = teil.indexOf("DELETE FROM beleg bg");
    assert.ok(zaehlen > 0 && zaehlen < loeschen, "gezählt wird erst nach dem Löschen");
  });
});
