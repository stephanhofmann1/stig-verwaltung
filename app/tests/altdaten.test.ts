import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { pruefeAltdaten, ALTDATEN_BLOECKE } from "../lib/altdaten";

/**
 * Tests der Altdaten-Übernahme.
 *
 * Die Übernahme legt Mietverhältnisse echter Menschen an. Zwei Dinge
 * müssen deshalb festgeschrieben sein: Sie läuft nicht versehentlich über
 * die falsche Datei, und sie schreibt nicht beim ersten Klick.
 */

describe("pruefeAltdaten erkennt die falsche Datei", () => {
  test("eine Datei mit Mietverhältnissen geht durch", () => {
    const p = pruefeAltdaten({ mietverhaeltnisse: [], _hinweis: "x" });
    assert.equal(p.fehler, null);
    assert.deepEqual(p.bloecke, ["mietverhaeltnisse"]);
  });

  test("alle Blöcke werden gemeldet, nicht nur der erste", () => {
    const p = pruefeAltdaten({
      objekte: [], mietverhaeltnisse: [], fristen: [], mietanpassungen: [],
    });
    assert.equal(p.fehler, null);
    assert.deepEqual(p.bloecke, [...ALTDATEN_BLOECKE]);
  });

  test("eine fremde JSON-Datei wird abgelehnt", () => {
    // Der gefaehrliche Fall: Der Import laeuft durch, meldet "0 angelegt"
    // und sieht aus wie ein geglueckter Lauf -- man glaubt, die Plattform
    // sei gefuellt.
    const p = pruefeAltdaten({ name: "paket", version: "1.0.0", scripts: {} });
    assert.ok(p.fehler, "eine package.json darf nicht als Altdaten gelten");
    assert.ok(
      p.fehler!.includes("name") || p.fehler!.includes("version"),
      "die Meldung soll nennen, was stattdessen gefunden wurde",
    );
  });

  test("ein Block, der kein Array ist, zählt nicht", () => {
    // "objekte": {} statt []: Die Schleife im Import wuerde darueber
    // nichts finden und stillschweigend nichts tun.
    const p = pruefeAltdaten({ objekte: { name: "Westanlage 9" } });
    assert.ok(p.fehler);
  });

  test("Array, null und Text sind keine Altdaten", () => {
    assert.ok(pruefeAltdaten([]).fehler);
    assert.ok(pruefeAltdaten(null).fehler);
    assert.ok(pruefeAltdaten("objekte").fehler);
    assert.ok(pruefeAltdaten(42).fehler);
  });

  test("ein leeres Objekt nennt 'nichts' statt einer leeren Liste", () => {
    const p = pruefeAltdaten({});
    assert.ok(p.fehler!.includes("nichts"));
  });
});

describe("die Übernahme schreibt nicht beim ersten Klick", () => {
  const route = readFileSync(
    new URL("../app/api/altdaten/import/route.ts", import.meta.url),
    "utf8",
  );

  test("geschrieben wird nur bei ausdrücklichem echt=1", () => {
    assert.ok(
      /const echt = String\(form\.get\("echt"\) \?\? ""\) === "1"/.test(route),
      "echt muss ausdruecklich '1' sein. Ein wahrheitsfaehiger Wert wie " +
        "'false' oder '0' wuerde sonst schreiben.",
    );
  });

  test("der Probelauf ist die Vorgabe", () => {
    // Faellt das Feld weg, ist echt === false -- also Probelauf.
    assert.ok(route.includes('form.get("echt")'));
    assert.ok(route.includes("importiere(daten, echt)"));
  });

  test("ein Mieterzugang kommt nicht herein", () => {
    assert.ok(route.includes('sitzung.rolle === "mieter"'));
    assert.ok(route.includes("status: 403"));
  });

  test("die Rolle 'lesen' darf pruefen, aber nicht uebernehmen", () => {
    assert.ok(
      route.includes('echt && sitzung.rolle === "lesen"'),
      "ohne diese Pruefung koennte ein Lesezugang Stammdaten schreiben",
    );
  });
});

describe("das Skript bleibt benutzbar", () => {
  test("import/importieren.mts ruft die herausgezogene Funktion auf", () => {
    // Die Logik wurde aus dem Skript in lib/altdaten.ts verschoben. Wenn
    // das Skript dabei stehen bleibt, faellt es erst auf dem Server auf.
    const skript = readFileSync(
      new URL("../../import/importieren.mts", import.meta.url),
      "utf8",
    );
    assert.ok(skript.includes('from "../app/lib/altdaten.ts"'));
    assert.ok(skript.includes("importiere(daten, echt)"));
    assert.ok(
      skript.includes("mitMandant"),
      "das Skript hat kein Sitzungscookie und muss den Mandanten selbst setzen",
    );
  });

  test("die Bibliothek setzt den Mandanten NICHT selbst", () => {
    const lib = readFileSync(
      new URL("../lib/altdaten.ts", import.meta.url),
      "utf8",
    );
    // Auf Verwendung pruefen, nicht auf das Wort: Im Kopfkommentar der
    // Datei steht "mitMandant" als Erklaerung, und ein Test, der an einem
    // Kommentar scheitert, lehrt einen nur, Kommentare zu meiden.
    assert.ok(
      !/\bmitMandant\s*\(/.test(lib),
      "Setzt die Bibliothek den Mandanten selbst, schreibt die Route in " +
        "den falschen Mandanten -- sie bekommt ihn aus dem Sitzungscookie.",
    );
    assert.ok(
      !/from\s+"\.\/mandant"/.test(lib),
      "die Bibliothek soll mandant.ts nicht einbinden",
    );
  });
});
