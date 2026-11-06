import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Tests der Navigation.
 *
 * Gelesen wird der Quelltext, nicht die Komponente: Navi.tsx ist eine
 * Clientkomponente mit "use client", usePathname und useRouter -- sie in
 * einem Testlauf ohne Browser zu laden, hiesse halb React nachzubauen.
 * Was hier gesichert werden muss, steht ohnehin in zwei Listen, und die
 * Gefahr ist, dass sie auseinanderlaufen.
 *
 * Der Anlass (06.11.2026): Auf dem Telefon klappte das Menue alle zwoelf
 * Punkte samt vier Gruppenueberschriften untereinander auf -- gut 600
 * Pixel, der halbe Bildschirm. Fuenf davon standen gleichzeitig unten in
 * der Fussleiste.
 */

const navi = readFileSync(new URL("../components/Navi.tsx", import.meta.url), "utf8");
const boden = readFileSync(new URL("../components/NaviBoden.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

/** Alle href-Werte in der Reihenfolge des Quelltexts. */
function wege(quelle: string, von: string, bis: string): string[] {
  const a = quelle.indexOf(von);
  assert.ok(a >= 0, `Abschnitt "${von}" nicht gefunden`);
  const b = quelle.indexOf(bis, a);
  assert.ok(b > a, `Ende "${bis}" nicht gefunden`);
  return [...quelle.slice(a, b).matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
}

const inGruppen = wege(navi, "const GRUPPEN: Gruppe[] = [", "\n];");
const inUnten = [...navi.slice(navi.indexOf("export const UNTEN")).matchAll(/"([^"]+)"/g)]
  .map((m) => m[1])
  .slice(0, 5);
const inBoden = wege(boden, "const ZIELE: Punkt[] = [", "\n];");

describe("Eine Liste, zwei Navigationen", () => {
  test("die Fußleiste und UNTEN nennen dieselben Ziele in derselben Reihenfolge", () => {
    // Laufen sie auseinander, ist ein Ziel bei schmaler Breite nirgends
    // erreichbar: Das Menü lässt es weg, die Leiste zeigt es nicht.
    assert.deepEqual(inUnten, inBoden);
  });

  test("jedes Ziel der Fußleiste steht auch in der Kopfnavigation", () => {
    for (const w of inBoden) {
      assert.ok(inGruppen.includes(w), `${w} fehlt in den Gruppen`);
    }
  });

  test("kein Weg steht zweimal in der Kopfnavigation", () => {
    assert.equal(new Set(inGruppen).size, inGruppen.length);
  });
});

describe("Was auf dem Telefon übrig bleibt", () => {
  test("sieben Zeilen statt zwölf", () => {
    const sichtbar = inGruppen.filter((w) => !inUnten.includes(w));
    assert.equal(inGruppen.length, 12);
    assert.equal(sichtbar.length, 7);
  });

  test("die Regel versteckt genau die Ziele der Fußleiste", () => {
    assert.match(css, /\.navi a\[data-unten="ja"\]\s*\{\s*display:\s*none;?\s*\}/);
    assert.match(navi, /data-unten=\{UNTEN\.includes\(p\.href\)/);
  });

  test("die Gruppenüberschriften fallen auf dem Telefon weg", () => {
    assert.match(css, /\.navi \.navi-titel\s*\{\s*display:\s*none;?\s*\}/);
  });

  test("beide Regeln hängen am selben Haltepunkt wie die Fußleiste", () => {
    // Ein anderer Haltepunkt wäre ein Breitenbereich, in dem weder das
    // Menü noch die Leiste ein Ziel anbietet.
    const haltepunkt = "@media (max-width: 40rem)";
    const abschnitte = css.split(haltepunkt);
    const mitVersteck = abschnitte.findIndex((t) => /data-unten="ja"/.test(t));
    const mitLeiste = abschnitte.findIndex((t) =>
      /\.navi-boden\s*\{[^}]*display:\s*(grid|flex)/.test(t),
    );
    assert.ok(mitVersteck > 0, "die Versteck-Regel steht nicht unter 40rem");
    assert.ok(mitLeiste > 0, "die Fußleiste erscheint nicht unter 40rem");
  });

  test("der Deckel auf dem offenen Menü bleibt", () => {
    // Der Deckel stand schon da -- und mit 100dvh statt 100vh richtig:
    // dvh rechnet die Browserleisten des Telefons mit, vh nicht. Beim
    // Umbau am 06.11.2026 hatte ich ihn versehentlich ein zweites Mal
    // gesetzt, schlechter. Dieser Test haelt das Original fest, damit
    // es niemand (auch ich nicht) durch eine Dopplung ersetzt.
    const block = /\.navi\[data-offen="ja"\]\s*\{([^}]*)\}/g;
    const bloecke = [...css.matchAll(block)].map((m) => m[1]);
    const mitDeckel = bloecke.filter((b) => /max-height/.test(b));
    assert.equal(mitDeckel.length, 1, "der Deckel steht genau einmal");
    assert.match(mitDeckel[0], /max-height:\s*calc\(100dvh/);
    assert.match(mitDeckel[0], /overflow-y:\s*auto/);
  });
});

describe("Die Namen in der Gruppe Geld", () => {
  test('„Konten" heißt jetzt „Kontoauszüge"', () => {
    // "Zahlungen", "Konten" und "Bank" klangen nach demselben und waren
    // drei Seiten: Auszüge einlesen, Zahlungen zuordnen, FinTS einrichten.
    assert.match(navi, /\{ href: "\/konten", text: "Kontoauszüge" \}/);
  });

  test("die Bankanbindung steht unter System, nicht unter Geld", () => {
    const geld = navi.slice(navi.indexOf('titel: "Geld"'), navi.indexOf('titel: "System"'));
    const system = navi.slice(navi.indexOf('titel: "System"'));
    assert.ok(!geld.includes('"/bank"'), "/bank steht noch unter Geld");
    assert.ok(system.includes('"/bank"'), "/bank fehlt unter System");
  });

  test("die Gruppe Geld folgt dem Weg des Geldes", () => {
    const geld = wege(
      navi.slice(navi.indexOf('titel: "Geld"')),
      "punkte: [",
      "\n    ],",
    );
    assert.deepEqual(geld, ["/konten", "/zahlungen", "/belege", "/mahnwesen"]);
  });
});
