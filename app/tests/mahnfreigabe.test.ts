import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Tests der Mahnsperre.
 *
 * Diese pruefen nicht die Datenbank, sondern dass die Sperre im Code
 * ueberhaupt davorsteht. Der Fehler, gegen den sie schuetzen, ist nicht ein
 * falsches Ergebnis, sondern eine vergessene Pruefung: Irgendwann wird eine
 * Stelle gebaut, die Mahnungen erzeugt, und wenn sie verlangeFreigabe()
 * nicht aufruft, geht Post raus, die Stephan nicht freigegeben hat.
 *
 * Deshalb lesen diese Tests den Quelltext. Das ist ungewoehnlich, aber hier
 * richtig: Es ist die einzige Pruefung, die auch fuer eine Datei gilt, die
 * es heute noch nicht gibt.
 */

const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("Die Sperre steht davor", () => {
  test("freigabe() gibt bei fehlender Tabelle null zurueck, nicht einen Fehler", () => {
    // Die Richtung ist das Entscheidende: Ein Fehler beim Nachsehen darf
    // nicht als "freigegeben" durchgehen.
    const s = quelle("../lib/mahnfreigabe.ts");
    assert.match(s, /catch\s*\{\s*return null;\s*\}/);
  });

  test("verlangeFreigabe wirft, statt false zurueckzugeben", () => {
    // Ein Rueckgabewert laesst sich uebersehen, eine Ausnahme nicht.
    const s = quelle("../lib/mahnfreigabe.ts");
    assert.match(s, /throw new NichtFreigegeben\(\)/);
  });

  test("die Rueckstandsabfrage schreibt und versendet nichts", () => {
    const s = quelle("../lib/rueckstaende.ts");
    for (const verboten of [/\bINSERT\b/i, /\bUPDATE\b/i, /\bDELETE\b/i]) {
      assert.doesNotMatch(s, verboten,
        "rueckstaende.ts darf nur lesen");
    }
  });

  test("mahnstufen.ts kennt weder Datenbank noch Versand", () => {
    // Die Entscheidung, wer Post bekommt, muss ohne Seiteneffekte
    // testbar bleiben.
    const s = quelle("../lib/mahnstufen.ts");
    assert.doesNotMatch(s, /from "\.\/db"/);
    assert.doesNotMatch(s, /from "\.\/versand"/);
  });

  test("jede Stelle, die mahnt, ruft verlangeFreigabe auf", () => {
    // Waechst mit: Sobald jemand eine Datei mit "mahnung" im Namen anlegt,
    // muss sie die Sperre aufrufen -- sonst faellt dieser Test.
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const libVerz = new URL("../lib/", import.meta.url);
    const dateien = readdirSync(libVerz).filter(
      (d) => /mahn/i.test(d) && d.endsWith(".ts"),
    );
    const erzeugend = dateien.filter((d) => {
      const s = quelle("../lib/" + d);
      // Dateien, die ein Schreiben bauen oder verschicken.
      return /versand|sendeMail|erzeugeMahnung|pdf|dokument/i.test(s);
    });
    for (const d of erzeugend) {
      assert.match(quelle("../lib/" + d), /verlangeFreigabe/,
        `${d} erzeugt oder versendet etwas, prueft aber die Freigabe nicht`);
    }
  });
});
