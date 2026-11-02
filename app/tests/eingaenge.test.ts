import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { teileEingaenge } from "../lib/kennzahlen";

/**
 * Die Trennung der unzugeordneten Zahlungseingänge.
 *
 * Anlass war ein echter Fehler auf dem Cockpit: Es standen 356 Eingänge
 * mit zusammen 2.676.057,60 € da, darunter der Satz "jeder einzelne davon
 * kann eine Miete sein". Darin steckten die Darlehensauszahlung über
 * 2,15 Mio. und die Gesellschaftereinlagen. Für 95 Prozent des Betrags
 * war die Aussage falsch — und eine Karte, die so etwas behauptet, lehrt
 * einen, sie zu überlesen. Genau diese Karte darf man aber nicht
 * überlesen.
 */

const e = (...reste: number[]) => reste.map((rest) => ({ rest }));

describe("teileEingaenge", () => {
  test("trennt an der höchsten Monatsmiete", () => {
    // Grenze 2.920,80 € ist die Gewerbemiete -- die höchste im Bestand.
    const l = teileEingaenge(e(580, 2920.8, 50000, 2150000), 2920.8);
    assert.equal(l.anzahlMietgross, 2, "580 und 2920,80 sind mietgross");
    assert.equal(l.summeMietgross, 3500.8);
    assert.equal(l.anzahlGross, 2, "50.000 und 2,15 Mio. nicht");
    assert.equal(l.summeGross, 2200000);
  });

  test("die Grenze selbst zählt noch als Miete", () => {
    // Die höchste Monatsmiete IST eine Monatsmiete.
    const l = teileEingaenge(e(2920.8), 2920.8);
    assert.equal(l.anzahlMietgross, 1);
    assert.equal(l.anzahlGross, 0);
  });

  test("die Gesamtsumme bleibt die Gesamtsumme", () => {
    // Die Trennung darf nichts verschwinden lassen -- sie sortiert nur.
    const l = teileEingaenge(e(100, 200, 999999), 500);
    assert.equal(l.anzahl, 3);
    assert.equal(l.summe, 1000299);
    assert.equal(l.summeMietgross + l.summeGross, l.summe);
  });

  test("ohne Mietverhältnisse gilt alles als mietgross", () => {
    // Grenze 0 heisst: nichts bekannt. Dann ist eine Behauptung schlechter
    // als keine -- also wird nichts ausgesondert.
    const l = teileEingaenge(e(580, 2150000), 0);
    assert.equal(l.anzahlMietgross, 2);
    assert.equal(l.anzahlGross, 0);
  });

  test("keine Eingänge: alles null, nichts undefiniert", () => {
    const l = teileEingaenge([], 2920.8);
    assert.equal(l.anzahl, 0);
    assert.equal(l.summe, 0);
    assert.equal(l.anzahlMietgross, 0);
    assert.equal(l.anzahlGross, 0);
    assert.equal(l.grenze, 2920.8);
  });

  test("Centbeträge werden gerundet, nicht angehäuft", () => {
    // 0,1 + 0,2 ist in Gleitkomma nicht 0,3. Auf einer Geldkarte darf
    // nicht 0,30000000000000004 stehen.
    const l = teileEingaenge(e(0.1, 0.2), 500);
    assert.equal(l.summeMietgross, 0.3);
  });

  test("die Grenze wird mitgegeben, damit die Karte sie nennen kann", () => {
    // Eine Trennung, deren Grenze man nicht sieht, ist eine Behauptung.
    assert.equal(teileEingaenge(e(1), 1234.56).grenze, 1234.56);
  });
});
