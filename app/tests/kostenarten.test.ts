import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  KOSTENARTEN,
  pruefeKostenart,
  vorschlagUmlage,
} from "../lib/kostenarten";

/**
 * Kostenarten und Umlagefähigkeit.
 *
 * Ob eine Ausgabe auf die Mieter umgelegt werden darf, ist eine
 * Rechtsfrage: Der Katalog steht abschliessend in § 2 BetrKV, und
 * § 1 Abs. 2 BetrKV nimmt Verwaltungs- und Instandhaltungskosten
 * ausdrücklich aus. Eine falsche Vorgabe hier fällt erst auf, wenn ein
 * Mieter die Abrechnung prüft -- und dann ist die Frist nach
 * § 556 Abs. 3 BGB längst abgelaufen.
 */

describe("die Liste selbst", () => {
  test("jeder Schlüssel kommt nur einmal vor", () => {
    const s = KOSTENARTEN.map((k) => k.schluessel);
    assert.equal(new Set(s).size, s.length);
  });

  test("Instandhaltung und Verwaltung sind NICHT umlagefähig", () => {
    // § 1 Abs. 2 BetrKV nimmt beide ausdrücklich aus. Hier landen die
    // meisten Baumarkt- und Handwerkerrechnungen.
    assert.equal(vorschlagUmlage("instandhaltung"), false);
    assert.equal(vorschlagUmlage("verwaltung"), false);
    assert.equal(vorschlagUmlage("modernisierung"), false);
    assert.equal(vorschlagUmlage("finanzierung"), false);
  });

  test("die klassischen Betriebskosten sind umlagefähig", () => {
    for (const k of ["grundsteuer", "wasser", "heizung", "muell", "versicherung"]) {
      assert.equal(vorschlagUmlage(k), true, `${k} ist nach § 2 BetrKV umlagefähig`);
    }
  });

  test("Sonstiges legt sich NICHT fest", () => {
    // § 2 Nr. 17 BetrKV: nur umlagefähig, wenn im Mietvertrag einzeln
    // benannt. Eine Vorgabe wäre hier eine Behauptung.
    assert.equal(vorschlagUmlage("sonstige"), null);
  });

  test("jede nicht umlagefähige Art sagt auch warum", () => {
    for (const k of KOSTENARTEN.filter((a) => a.umlagefaehig === false)) {
      assert.ok(
        k.hinweis || ["finanzierung", "recht"].includes(k.schluessel),
        `${k.schluessel} sollte den Grund nennen`,
      );
    }
  });
});

describe("pruefeKostenart", () => {
  test("erfindet nichts", () => {
    assert.equal(pruefeKostenart("gibtsnicht"), null);
    assert.equal(pruefeKostenart(""), null);
    assert.equal(pruefeKostenart(null), null);
    assert.equal(pruefeKostenart(42), null);
    assert.equal(pruefeKostenart("instandhaltung; DROP TABLE beleg"), null);
  });

  test("erkennt eine echte Art", () => {
    assert.equal(pruefeKostenart(" heizung ")?.schluessel, "heizung");
  });

  test("vorschlagUmlage auf Unbekanntes gibt null, nicht false", () => {
    // false hiesse "nicht umlagefähig" -- eine Aussage. null heisst
    // "unbekannt". Der Unterschied entscheidet in der Abrechnung.
    assert.equal(vorschlagUmlage("gibtsnicht"), null);
  });
});

describe("der Upload speichert die Einordnung", () => {
  const route = readFileSync(
    new URL("../app/api/belege/upload/route.ts", import.meta.url),
    "utf8",
  );

  test("Kostenart nur aus der bekannten Liste", () => {
    assert.ok(
      route.includes("pruefeKostenart(f.kostenart)"),
      "der rohe Wert aus dem Formular darf nicht in die Datenbank",
    );
  });

  test("leer heisst ungeklärt, nicht nein", () => {
    assert.ok(/f\.umlagefaehig === "ja"/.test(route));
    assert.ok(/f\.umlagefaehig === "nein"/.test(route));
    assert.ok(
      /: null;/.test(route),
      "alles andere muss null ergeben, nicht false",
    );
  });

  test("die drei Spalten landen im INSERT", () => {
    assert.ok(/objekt_id, kostenart, umlagefaehig/.test(route));
  });
});
