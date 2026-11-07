import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Tests des Anhaltens eines Bankzugangs.
 *
 * ANLASS, 07.11.2026
 *
 * lib/fints/abruf.ts legt einen Zugang selbst still, wenn die Bank einen
 * Fehler an den Zugangsdaten meldet, und begruendet das so: "Lieber
 * einmal zu viel stilllegen: Das kostet einen Klick, das Gegenteil
 * kostet den Gang in die Filiale."
 *
 * Diesen Klick gab es nicht. An beiden Zugaengen stand "Die Bank liefert
 * kein Konto zu diesem Zugang" -- was `wegenZugangsdaten` nicht als
 * Zugangsdatenfehler erkennt. Der Abruf lief zweimal taeglich weiter,
 * und anhalten liess er sich nur durch Loeschen des Zugangs samt PIN.
 */
const route = readFileSync(
  new URL("../app/api/bank/stilllegen/route.ts", import.meta.url),
  "utf8",
);
const knopf = readFileSync(
  new URL("../components/BankRuhen.tsx", import.meta.url),
  "utf8",
);
const seite = readFileSync(
  new URL("../app/bank/page.tsx", import.meta.url),
  "utf8",
);
const pflegen = readFileSync(
  new URL("../components/BankZugangPflegen.tsx", import.meta.url),
  "utf8",
);

describe("Anhalten", () => {
  test("Anhalten setzt nur den Schalter", () => {
    // PIN, Adresse, Anmeldename und Abrufstand bleiben stehen: Ein
    // angehaltener Zugang soll sich mit einem Klick wieder aufwecken
    // lassen, nicht neu eingerichtet werden muessen.
    assert.match(
      route,
      /SET aktiv = false WHERE id = \$1/,
    );
    const anhalten = route.slice(
      route.indexOf("if (ruhen) {"),
      route.indexOf("} else {"),
    );
    for (const feld of ["pin_verschluesselt", "letzter_abruf", "benutzer"]) {
      assert.ok(
        !anhalten.includes(feld),
        `Anhalten greift ${feld} an`,
      );
    }
  });

  test("der Knopf steht auf der Seite, ohne Umweg über das Bearbeiten", () => {
    assert.match(seite, /<BankRuhen/);
    assert.match(seite, /ruht=\{!z\.aktiv\}/);
  });

  test("er ist auch dann da, wenn der Zugang schon ruht", () => {
    // Sonst kaeme man nicht mehr heran, um ihn wieder anzustossen.
    assert.ok(
      !/z\.aktiv && \(\s*<BankRuhen/.test(seite),
      "der Knopf hängt an aktiv",
    );
    assert.match(knopf, /ruht\s*\n?\s*\?\s*`\$\{bezeichnung\} wieder abrufen lassen`/);
  });

  test("Anhalten fragt nicht nach", () => {
    // Anhalten ist die vorsichtige Richtung und mit einem Klick
    // zurueckgenommen. Eine Sicherheitsfrage davor liesse den Knopf im
    // Zweifel ungedrueckt -- und genau im Zweifel soll er gedrueckt
    // werden.
    // Nur der Code, nicht die Kommentare -- dort steht das Wort
    // "Sicherheitsfrage" als Begruendung, warum es keine gibt.
    const code = knopf
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    assert.ok(!/window\.confirm|confirm\(/.test(code), "der Knopf fragt nach");
    assert.match(code, /onClick=\{\(\) => void schalten\(\)\}/);
  });
});

describe("Wieder anstoßen", () => {
  test("es verwirft die gespeicherten Bankinformationen", () => {
    // Sonst bleibt die Meldung, die zum Anhalten gefuehrt hat:
    // lib/fints/holen.ts prueft die Anmeldung nur, solange keine
    // Bankinformationen gespeichert sind.
    const wecken = route.slice(route.indexOf("} else {"));
    assert.match(wecken, /bank_information = NULL/);
    assert.match(wecken, /aktiv = true/);
  });

  test("der Grund dafür steht im Quelltext", () => {
    assert.match(route, /BEVOR geprüft ist, ob die Bank überhaupt ein Konto/);
  });

  test("eine fällige TAN und der letzte Fehler werden zurückgesetzt", () => {
    const wecken = route.slice(route.indexOf("} else {"));
    assert.match(wecken, /tan_faellig = false/);
    assert.match(wecken, /letzter_fehler = NULL/);
  });
});

describe("Berechtigung", () => {
  test("Mieter und Leserecht dürfen nicht schalten", () => {
    assert.match(
      route,
      /sitzung\.rolle === "mieter" \|\| sitzung\.rolle === "lesen"/,
    );
    assert.match(route, /status: 403/);
  });

  test("ein unbekannter Zugang wird abgewiesen, nicht stillschweigend übergangen", () => {
    assert.match(route, /status: 404/);
  });
});

describe("Was die Oberfläche sagt", () => {
  test("die Ruht-Meldung behauptet nicht mehr, die Bank habe abgelehnt", () => {
    // Von Hand angehalten ist kein Zugangsdatenfehler. Die alte Fassung
    // nannte nur den einen Grund und war damit bei jedem anderen falsch.
    assert.match(pflegen, /oder er wurde von Hand angehalten/);
  });

  test("sie nennt weiter die drei Fehlversuche", () => {
    // Das ist der Grund, warum es diesen Schalter gibt.
    assert.match(pflegen, /Drei Fehlversuche sperren den Bankzugang/);
  });
});
