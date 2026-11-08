import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { liesMonat, monatsName } from "../lib/monatssicht";
import { ohneKommentare } from "./quelltext";

/**
 * Der Monat als Ausschnitt.
 *
 * ANLASS (08.11.2026)
 *
 * Stephan wollte die Diagramme anklickbar: "Monat anklicken fuehrt zur
 * Liste." Entschieden hat er zwei Ziele -- Cashflow in die
 * Kontoauszuege dieses Monats, Soll/Ist ins Mietenbuch.
 *
 * Der Monat steht dafuer in der Adresse und nicht in einem Zustand im
 * Browser: Es ist eine andere Abfrage, nicht eine andere Ansicht
 * derselben Zahlen -- und so laesst sich der Blick weitergeben.
 */
describe("Einen Monat aus der Adresse lesen", () => {
  test("ein richtiger Monat kommt durch", () => {
    assert.equal(liesMonat("2026-11"), "2026-11");
    assert.equal(liesMonat("2000-01"), "2000-01");
    assert.equal(liesMonat("2100-12"), "2100-12");
  });

  test("Leerzeichen drumherum stoeren nicht", () => {
    assert.equal(liesMonat(" 2026-11 "), "2026-11");
  });

  test("kein Monat ist der Normalfall, kein Fehler", () => {
    assert.equal(liesMonat(undefined), null);
    assert.equal(liesMonat(""), null);
    assert.equal(liesMonat([]), null);
  });

  test("die Form allein genuegt nicht -- der Monat muss es geben", () => {
    // "2026-13" sieht richtig aus und gibt es nicht. Ohne diese Pruefung
    // zeigte die Seite eine leere Liste, die wie ein Befund aussieht.
    assert.equal(liesMonat("2026-13"), null);
    assert.equal(liesMonat("2026-00"), null);
  });

  test("Unsinn ergibt keinen Monat", () => {
    for (const roh of [
      "2026", "26-11", "2026-1", "2026/11", "abc", "0202-11",
      "9999-11", "1999-12", "2026-11-03", "'; DROP TABLE buchung; --",
    ]) {
      assert.equal(liesMonat(roh), null, roh);
    }
  });

  test("ein doppelter Parameter nimmt den ersten", () => {
    assert.equal(liesMonat(["2026-11", "2025-01"]), "2026-11");
  });

  test("der Name ist deutsch und ausgeschrieben", () => {
    // In einer Ueberschrift steht "November 2026", nicht "2026-11".
    assert.equal(monatsName("2026-11"), "November 2026");
    assert.equal(monatsName("2026-03"), "März 2026");
    assert.equal(monatsName("2026-01"), "Januar 2026");
  });
});

/**
 * Vom Balken in die Liste.
 *
 * Geprueft wird die Kette, nicht das Aussehen: Dass der Verweis am
 * Posten haengt, dass er auf die richtige Seite zeigt, und dass die
 * Zielseite den Monat wirklich liest. Reisst eines davon, fuehrt ein
 * Klick ins Leere -- und das merkt man erst beim Klicken.
 */
describe("Der Klick auf einen Monat fuehrt irgendwohin", () => {
  const quelle = (p: string) =>
    readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

  test("die Cashflow-Saeulen verweisen auf die Kontoauszuege", () => {
    assert.match(
      quelle("components/CockpitCashflow.tsx"),
      /href: `\/konten\?monat=\$\{b\.monat\.slice\(0, 7\)\}`/,
    );
  });

  test("die Soll-Ist-Spalten verweisen ins Mietenbuch", () => {
    assert.match(
      quelle("components/CockpitVerlauf.tsx"),
      /href: `\/mietenbuch\?jahr=\$\{p\.monat\.slice\(0, 4\)\}&monat=/,
    );
  });

  test("das Haus reist nicht in der Adresse mit", () => {
    /*
      Die Zielseiten lesen dieselbe Objektwahl aus dem Kopf. Stuende das
      Haus zusaetzlich in der Adresse, gaebe es zwei Quellen fuer eine
      Entscheidung -- und ein weitergegebener Verweis koennte etwas
      anderes zeigen als der Umschalter daneben behauptet.
    */
    for (const datei of [
      "components/CockpitCashflow.tsx",
      "components/CockpitVerlauf.tsx",
    ]) {
      const hrefs = quelle(datei).match(/href: `[^`]+`/g) ?? [];
      for (const h of hrefs) {
        assert.ok(!h.includes("objekt="), `${datei}: ${h}`);
      }
    }
  });

  test("die Kontenseite liest den Monat und filtert damit", () => {
    const seite = quelle("app/konten/page.tsx");
    assert.match(seite, /liesMonat\(\(await searchParams\)\.monat\)/);
    assert.match(seite, /to_char\(b\.buchungstag, 'YYYY-MM'\) = \$1/);
    // Und das Haus zugleich -- sonst zeigte der Klick aus einer
    // Objektsicht die Buchungen aller Haeuser.
    assert.match(seite, /\$2::uuid IS NULL OR k\.objekt_id = \$2/);
  });

  test("ohne Monat fragt die Kontenseite keine Buchungen ab", () => {
    // Sonst waere es die Liste aller Buchungen ueberhaupt -- Zehntausende
    // Zeilen, die niemand bestellt hat.
    assert.match(quelle("app/konten/page.tsx"), /const buchungen = monat\n\s*\? await query/);
  });

  test("die Liste sagt es, wenn sie abgeschnitten ist", () => {
    // Eine stillschweigend gekuerzte Liste ist eine falsche Auskunft.
    const seite = quelle("app/konten/page.tsx");
    assert.match(seite, /LIMIT 500/);
    assert.match(seite, /buchungen\.length === 500/);
  });

  test("das Mietenbuch markiert den Monat und filtert ihn nicht weg", () => {
    const seite = quelle("app/mietenbuch/page.tsx");
    assert.match(seite, /const hervor = liesMonat\(params\.monat\)/);
    assert.match(seite, /hervor=\{hervor\}/);
    // Der Monat darf nicht in den Filter geraten: Ein Mietenbuch mit
    // genau einer Monatsspalte waere keines mehr.
    const ohne = ohneKommentare(seite);
    assert.ok(
      !/filter[\s\S]{0,120}monat/.test(ohne),
      "Der Monat ist in den Filter geraten.",
    );
  });

  test("eine Saeule ohne Ziel bleibt eine Gruppe", () => {
    /*
      Ein <a> ohne href ist fuer die Vorlesesoftware ein Versprechen,
      das niemand einloest, und mit der Tastatur eine Station, an der
      nichts passiert.
    */
    const baukasten = quelle("components/Diagramm.tsx");
    assert.match(baukasten, /if \(href\) \{\n\s*return \(\n\s*<a href=\{href\}/);
    assert.match(baukasten, /<g className="diagramm-saeule" tabIndex=\{0\}>/);
  });

  test("die Greifflaeche ist wirklich greifbar", () => {
    /*
      Eine Flaeche mit Deckung 0 gilt als unsichtbar und faengt je nach
      Browser gar nichts -- dann waere die Spalte zwar ein Verweis, aber
      nicht zu treffen.

      ohneKommentare, weil die Begruendung dieser Regel das gesuchte
      Wort selbst nennt. Zum vierten Mal derselbe Fehler; siehe
      tests/quelltext.ts.
    */
    const baukasten = ohneKommentare(quelle("components/Diagramm.tsx"));
    assert.match(baukasten, /fill="transparent"/);
    assert.doesNotMatch(
      baukasten,
      /fillOpacity=\{0\}/,
      "Eine Greifflaeche mit Deckung 0 faengt keine Klicks.",
    );
  });
});
