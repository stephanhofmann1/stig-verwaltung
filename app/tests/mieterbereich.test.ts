import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { mietAnzeige } from "../lib/mieter";

/**
 * Tests des Mieterbereichs.
 *
 * Zwei Dinge stehen hier auf dem Spiel. Erstens: Jeder Mieter muss SEINE
 * Miete sehen, auch der mit Inklusivmiete -- das sind 22 von 37. Zweitens:
 * Niemand darf die Unterlagen eines anderen sehen; im Mietvertrag stehen
 * Geburtsdatum, Geburtsort, Voranschrift und Kaution.
 */

describe("Die Miete wird richtig angezeigt", () => {
  test("Inklusivmiete ohne Kaltmiete wird als Miete gezeigt", () => {
    // Der Fehler, den es bis zum 01.11.2026 gab: Diese Mieter sahen
    // "Kaltmiete —" und "Nebenkosten —" und damit ihre Miete nirgends.
    const m = mietAnzeige({
      kaltmiete: null, nebenkosten: null, moeblierung: null,
      gesamtmiete: "630.00",
    });
    assert.equal(m.inklusiv, true);
    assert.equal(m.summe, 630);
    assert.deepEqual(m.posten, []);
  });

  test("aufgeteilte Miete wird aufgeschluesselt und summiert", () => {
    const m = mietAnzeige({
      kaltmiete: "500.00", nebenkosten: "130.00", moeblierung: null,
      gesamtmiete: null,
    });
    assert.equal(m.inklusiv, false);
    assert.equal(m.summe, 630);
    assert.equal(m.posten.length, 2);
  });

  test("ein Moeblierungszuschlag erscheint nur, wenn es ihn gibt", () => {
    // Eine Zeile "Moeblierungszuschlag 0,00 EUR" laesst einen
    // unmoeblierten Mieter glauben, er zahle dafuer.
    const ohne = mietAnzeige({
      kaltmiete: "500.00", nebenkosten: "130.00", moeblierung: "0",
      gesamtmiete: null,
    });
    assert.ok(!ohne.posten.some((p) => /Möblierung/.test(p.bezeichnung)));

    const mit = mietAnzeige({
      kaltmiete: "500.00", nebenkosten: "130.00", moeblierung: "60.00",
      gesamtmiete: null,
    });
    assert.ok(mit.posten.some((p) => /Möblierung/.test(p.bezeichnung)));
    assert.equal(mit.summe, 690);
  });

  test("die Gesamtmiete hat Vorrang vor der Summe der Posten", () => {
    // Im Vertrag steht ein Betrag. Weicht die Summe der Einzelposten davon
    // ab, ist der Vertragsbetrag maßgeblich -- sonst zeigt die Seite dem
    // Mieter eine andere Miete als sein Vertrag.
    const m = mietAnzeige({
      kaltmiete: "500.00", nebenkosten: "130.00", moeblierung: null,
      gesamtmiete: "750.00",
    });
    assert.equal(m.summe, 750);
  });

  test("ohne jede Angabe steht kein erfundener Betrag da", () => {
    // Lieber ein Strich als eine 0,00 EUR, die wie eine mietfreie Wohnung
    // aussieht.
    const m = mietAnzeige({
      kaltmiete: null, nebenkosten: null, moeblierung: null, gesamtmiete: null,
    });
    assert.equal(m.summe, null);
    assert.deepEqual(m.posten, []);
  });

  test("eine Gesamtmiete von 0 macht den Fall nicht inklusiv", () => {
    const m = mietAnzeige({
      kaltmiete: null, nebenkosten: null, moeblierung: null, gesamtmiete: "0",
    });
    assert.equal(m.inklusiv, false);
    assert.equal(m.summe, null);
  });

  test("die Abfrage holt alle vier Mietfelder", () => {
    // Der eigentliche Fehler war nicht die Darstellung, sondern die
    // Abfrage: mieter_uebersicht liefert moeblierung und gesamtmiete seit
    // Migration 019, gelesen wurden sie nicht.
    const s = readFileSync(new URL("../lib/mieter.ts", import.meta.url), "utf8");
    for (const feld of ["kaltmiete", "nebenkosten", "moeblierung", "gesamtmiete"])
      assert.match(s, new RegExp(`${feld}::text`), `${feld} fehlt in der Abfrage`);
  });
});

describe("Die Unterlagen gehoeren nur dem angemeldeten Mieter", () => {
  const route = readFileSync(
    new URL("../app/mieter/dokument/[art]/route.ts", import.meta.url),
    "utf8",
  );

  test("das Mietverhaeltnis kommt aus der Sitzung", () => {
    assert.match(route, /sitzung\.mietverhaeltnis/);
    assert.match(route, /angemeldeteSitzung/);
  });

  test("der Pfadparameter bestimmt NUR die Art des Dokuments", () => {
    // Stuende die Kennung im Pfad, koennte jeder angemeldete Mieter sie
    // austauschen und den Vertrag eines anderen herunterladen -- mit
    // Geburtsdatum, Geburtsort, Voranschrift und Kaution darin.
    //
    // Geprueft wird, dass params nur fuer `art` benutzt wird. Taucht dort
    // je ein zweiter Wert auf, faellt dieser Test.
    const ausParams = [...route.matchAll(/params\s*}\s*:\s*{\s*params:\s*Promise<\{([^}]*)\}>/g)]
      .map((m) => m[1]);
    assert.equal(ausParams.length, 1, "genau eine params-Signatur erwartet");
    const felder = ausParams[0]
      .split(";")
      .map((f) => f.split(":")[0].trim())
      .filter((f) => f.length > 0);
    assert.deepEqual(felder, ["art"], "params darf nur `art` enthalten");
  });

  test("ein nicht angemeldeter Abruf bekommt 401", () => {
    assert.match(route, /status: 401/);
    assert.match(route, /rolle !== "mieter"/);
  });

  test("ein Mieterzugang ohne Mietverhaeltnis wird abgewiesen", () => {
    assert.match(route, /!sitzung\.mietverhaeltnis/);
  });

  test("nur die zwei vorgesehenen Dokumentarten sind erreichbar", () => {
    // Eine Tabelle statt einer Verzweigung: Was nicht darin steht, ist
    // nicht erreichbar, auch nicht ueber einen Pfad wie "../../etwas".
    assert.match(route, /const ARTEN = \{/);
    assert.match(route, /unbekanntes Dokument/);
  });

  test("das PDF wird nicht zwischengespeichert", () => {
    // Hinter einem geteilten Netz wuerde ein Proxy es sonst fuer den
    // naechsten Abruf aufbewahren.
    assert.match(route, /no-store/);
  });

  test("dem Mieter wird keine Feldliste gezeigt", () => {
    // Fehlende Angaben sind bei uebernommenen Altmietern der Normalfall.
    // Die Liste gehoert ins Log, nicht an den Mieter.
    assert.match(route, /melden Sie sich bei der Verwaltung/);
    assert.match(route, /console\.warn/);
  });
});

describe("Was der Mieterbereich nicht zeigt", () => {
  test("kein Mahnwesen im Mieterbereich", () => {
    // So mit Stephan festgelegt: Rueckstaende sind kein Selbstbedienungs-
    // thema. Ein Mieter, der dort seinen Rueckstand sieht, liest eine Zahl
    // ohne den Zusammenhang -- und bei den Monaten ohne Kontodaten waere
    // sie sogar falsch.
    const s = readFileSync(
      new URL("../app/mieter/page.tsx", import.meta.url), "utf8");
    for (const wort of ["mahnstand", "rueckstaende", "Mahnung", "Rückstand"])
      assert.doesNotMatch(s, new RegExp(wort), `${wort} gehoert nicht hierher`);
  });
});

import { monatsStatus, type StandZeile } from "../lib/mieter";

/**
 * Der Zahlungsstand, den der Mieter selbst sieht.
 *
 * Hier ist der teuerste Fehler nicht eine falsche Zahl, sondern eine
 * falsche Beschuldigung: Ein Monat ohne Kontodaten darf dem Mieter NIE als
 * offen gezeigt werden. Fuer die Welserstrasse stehen elf Monate aus 2024
 * ohne Zahlung in der Datenbank, obwohl niemand etwas schuldet -- ein
 * Mieter seit 2007 bekaeme sonst die Nachricht, er haette elf Monatsmieten
 * Schulden.
 */
const zeile = (
  u: Partial<StandZeile> = {},
): StandZeile => ({
  monat: "2026-09-01",
  soll: "630.00",
  gezahlt: null,
  gezahlt_am: null,
  ohne_zahlungsdaten: false,
  ...u,
});
const faellig = new Date("2026-09-03T12:00:00Z");

describe("Zahlungsstand im Mieterbereich", () => {
  test("ohne Kontodaten heisst es NICHT offen", () => {
    const m = monatsStatus(
      zeile({ ohne_zahlungsdaten: true }),
      faellig,
      new Date("2026-11-15T12:00:00Z"),
    );
    assert.equal(m.status, "nicht_abgeglichen");
    assert.notEqual(m.status, "offen");
  });

  test("ohne Kontodaten gilt das auch bei laengst faelligem Monat", () => {
    // Die Pruefung muss VOR der Faelligkeit kommen, sonst verschluckt sie
    // der Zweig fuer "offen".
    const m = monatsStatus(
      zeile({ monat: "2024-01-01", ohne_zahlungsdaten: true }),
      new Date("2024-01-03T12:00:00Z"),
      new Date("2026-11-15T12:00:00Z"),
    );
    assert.equal(m.status, "nicht_abgeglichen");
  });

  test("vollstaendig gezahlt ist eingegangen, mit Datum", () => {
    const m = monatsStatus(
      zeile({ gezahlt: "630.00", gezahlt_am: "2026-09-02" }),
      faellig,
      new Date("2026-11-15T12:00:00Z"),
    );
    assert.equal(m.status, "bezahlt");
    assert.equal(m.gezahlt_am, "2026-09-02");
  });

  test("ein Rundungsrest unter einem Euro gilt als bezahlt", () => {
    // Anteilige Monate erzeugen Cents. Dem Mieter "noch nicht eingegangen"
    // wegen drei Cent zu zeigen ist falsch.
    const m = monatsStatus(
      zeile({ gezahlt: "629.98" }),
      faellig,
      new Date("2026-11-15T12:00:00Z"),
    );
    assert.equal(m.status, "bezahlt");
  });

  test("Teilzahlung wird als solche benannt", () => {
    const m = monatsStatus(
      zeile({ gezahlt: "400.00" }),
      faellig,
      new Date("2026-11-15T12:00:00Z"),
    );
    assert.equal(m.status, "teilweise");
  });

  test("vor dem dritten Werktag steht nichts offen", () => {
    // Wer am Monatsersten nachsieht, soll nicht "noch nicht eingegangen"
    // lesen -- er hat noch zwei Werktage Zeit.
    const m = monatsStatus(zeile(), faellig, new Date("2026-09-01T12:00:00Z"));
    assert.equal(m.status, "nicht_faellig");
  });

  test("faellig und nichts gezahlt ist offen", () => {
    const m = monatsStatus(zeile(), faellig, new Date("2026-09-20T12:00:00Z"));
    assert.equal(m.status, "offen");
  });

  test("ohne eingelesene Kontoumsaetze ist jeder Monat unabgeglichen", () => {
    // Beim Start gibt es noch keine Buchungen. Dann darf kein Mieter
    // "noch nicht eingegangen" sehen -- es ist nur nichts eingelesen.
    const s = readFileSync(new URL("../lib/mieter.ts", import.meta.url), "utf8");
    assert.match(s, /NOT EXISTS \(SELECT 1 FROM buchung\)/);
  });

  test("die Abfrage holt nur das eigene Mietverhaeltnis", () => {
    const s = readFileSync(new URL("../lib/mieter.ts", import.meta.url), "utf8");
    assert.match(s, /WHERE s\.mietverhaeltnis_id = \$1/);
  });

  test("der Mieter sieht kein Wort von Mahnung oder Rueckstand", () => {
    const s = readFileSync(new URL("../lib/mieter.ts", import.meta.url), "utf8");
    const texte = s.match(/"(bezahlt|teilweise|offen|nicht_faellig|nicht_abgeglichen)"/g);
    assert.ok(texte && texte.length > 0);
    const seite = readFileSync(
      new URL("../app/mieter/page.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(seite, /Mahnung|Rückstand|Verzug|säumig/i);
  });
});

describe("Die Reihenfolge der Pruefungen", () => {
  // Diese drei Faelle hat ein Mutationstest erzwungen. Ohne sie bestand
  // die Umstellung der Reihenfolge alle Tests -- obwohl sie dem Mieter
  // eine falsche Zahl gezeigt haette.

  test("Teilzahlung OHNE Kontodaten ist nicht 'teilweise'", () => {
    // "400 von 630 eingegangen" heisst fuer den Mieter: 230 fehlen. Ohne
    // Kontodaten ist das eine Behauptung ueber Geld, das wir nicht
    // ueberpruefen koennen.
    const m = monatsStatus(
      zeile({ gezahlt: "400.00", ohne_zahlungsdaten: true }),
      faellig,
      new Date("2026-11-15T12:00:00Z"),
    );
    assert.equal(m.status, "nicht_abgeglichen");
  });

  test("ein Monat vor Faelligkeit OHNE Kontodaten ist nicht 'nicht faellig'", () => {
    // Das waere eine Beruhigung, die nicht traegt: Der Monat kann laengst
    // bezahlt oder laengst offen sein, wir wissen es nicht.
    const m = monatsStatus(
      zeile({ ohne_zahlungsdaten: true }),
      faellig,
      new Date("2026-09-01T12:00:00Z"),
    );
    assert.equal(m.status, "nicht_abgeglichen");
  });

  test("eine zugeordnete Zahlung wird nicht hinter 'nicht abgeglichen' versteckt", () => {
    // Umgekehrte Richtung: Ist der Monat belegt gedeckt, ist "eingegangen"
    // die richtige Auskunft -- auch wenn das Objekt sonst keine
    // Kontodaten fuer diesen Zeitraum hat.
    const m = monatsStatus(
      zeile({ gezahlt: "630.00", gezahlt_am: "2024-11-28", ohne_zahlungsdaten: true }),
      faellig,
      new Date("2026-11-15T12:00:00Z"),
    );
    assert.equal(m.status, "bezahlt");
  });
});
