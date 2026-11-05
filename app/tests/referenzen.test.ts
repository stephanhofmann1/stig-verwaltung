import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { findeReferenzen, normiere, stehtDrin } from "../lib/referenzen";

/**
 * Tests der Referenzerkennung.
 *
 * Diese Funktion entscheidet, welcher Beleg zu welcher Abbuchung gehoert.
 * Ein falscher Treffer wird als Zuordnung festgeschrieben und sieht
 * danach aus wie erledigte Arbeit -- er ist schlimmer als gar keiner.
 * Deshalb pruefen die Tests hier beides: dass die richtigen Nummern
 * gefunden werden UND dass die falschen es nicht werden.
 *
 * Alle Nummern in dieser Datei sind erfunden.
 */

describe("Normieren", () => {
  test("Grossbuchstaben, ohne Trennzeichen", () => {
    assert.equal(normiere("304-2954807-8841912"), "30429548078841912");
    assert.equal(normiere("de65 xw8/69.aeud"), "DE65XW869AEUD");
  });

  test("dieselbe Nummer in zwei Schreibweisen wird gleich", () => {
    assert.equal(normiere("304-2954807-8841912"), normiere("304 2954807 8841912"));
  });
});

describe("Amazon", () => {
  const rechnung = `
    Rechnung
    Zahlungsreferenznummer 5DQYR9T7SEATUOBJ
    Verkauft von Amazon EU S.à r.l., Niederlassung Deutschland
    USt-IDNr. LU20260743
    Rechnungsdatum /Lieferdatum 10 März 2026
    Rechnungsnummer DE6199WOAEUI
    Zahlbetrag 45,44 €
    Bestellinformationen
    Bestelldatum 09 März 2026
    Bestellnummer 303-9211199-0875554
  `;

  test("die Bestellnummer wird gefunden", () => {
    const r = findeReferenzen(rechnung);
    const b = r.find((x) => x.art === "bestellnummer");
    assert.ok(b, "keine Bestellnummer gefunden");
    assert.equal(b!.wert, "303-9211199-0875554");
    assert.equal(b!.normiert, "30392111990875554");
  });

  test("die Zahlungsreferenz wird gefunden", () => {
    const r = findeReferenzen(rechnung);
    assert.equal(
      r.find((x) => x.art === "zahlungsreferenz")?.wert,
      "5DQYR9T7SEATUOBJ",
    );
  });

  test("die Rechnungsnummer wird gefunden", () => {
    const r = findeReferenzen(rechnung);
    assert.equal(
      r.find((x) => x.art === "rechnungsnummer")?.wert,
      "DE6199WOAEUI",
    );
  });

  test("die Umsatzsteuer-Nummer des Ausstellers wird NICHT zur Referenz", () => {
    // Sie steht auf jeder Rechnung desselben Ausstellers. Als Referenz
    // genommen, passte jede Amazon-Rechnung zu jeder Amazon-Abbuchung.
    const r = findeReferenzen(rechnung);
    assert.ok(!r.some((x) => x.normiert === "LU20260743"));
  });

  test("der Verwendungszweck der Abbuchung enthält die Bestellnummer", () => {
    const zweck = "304-2954807-8841912 Amazon.de 3UQ5C3CMI8RC7RAF";
    assert.equal(stehtDrin(normiere("304-2954807-8841912"), zweck), true);
    assert.equal(stehtDrin(normiere("3UQ5C3CMI8RC7RAF"), zweck), true);
    // Eine andere Bestellung darf nicht passen.
    assert.equal(stehtDrin(normiere("303-9211199-0875554"), zweck), false);
  });

  test("auch ohne Schlüsselwort wird die Bestellnummernform erkannt", () => {
    const r = findeReferenzen("Zahlung für 301-1234567-7654321 vom 02.03.2026");
    assert.equal(r[0]?.art, "bestellnummer");
    assert.equal(r[0]?.wert, "301-1234567-7654321");
  });
});

describe("Andere Aussteller", () => {
  test("Kundennummer und Vertragskonto", () => {
    const r = findeReferenzen("Kundennummer: 4711-998877\nVertragskonto 220044556");
    assert.equal(r.find((x) => x.art === "kundennummer")?.wert, "4711-998877");
  });

  test("Kassenzeichen der Stadtkasse", () => {
    const r = findeReferenzen("Kassenzeichen 148095.200.1");
    assert.equal(r.find((x) => x.art === "kassenzeichen")?.wert, "148095.200.1");
  });

  test("Versicherungsschein", () => {
    const r = findeReferenzen("Firmen-Police FKA 11-0760033-01\nVersicherungsschein 11-0760033-01");
    assert.ok(r.some((x) => x.art === "vertragsnummer"));
  });
});

describe("Was NICHT erkannt wird", () => {
  test("zu kurze Nummern", () => {
    assert.deepEqual(findeReferenzen("Kundennummer: 123"), []);
  });

  test("eine beliebige Ziffernfolge ohne Schlüsselwort", () => {
    // Sonst waere jede Artikelnummer und jede Telefonnummer eine Referenz.
    assert.deepEqual(findeReferenzen("Artikel 8851234567 Stück 2"), []);
  });

  test("eine IBAN im Fließtext", () => {
    const r = findeReferenzen("Überweisung auf DE02120300000000202051");
    assert.deepEqual(r, []);
  });

  test("leerer Text", () => {
    assert.deepEqual(findeReferenzen(""), []);
  });

  test("stehtDrin lehnt zu kurze Vergleichswerte ab", () => {
    assert.equal(stehtDrin("1234", "Zahlung 1234"), false);
  });
});

describe("Mehrfachfunde", () => {
  test("dieselbe Nummer wird nur einmal zurückgegeben", () => {
    const r = findeReferenzen(
      "Bestellnummer 303-9211199-0875554 ... siehe Bestellung 303-9211199-0875554",
    );
    assert.equal(r.filter((x) => x.art === "bestellnummer").length, 1);
  });

  test("mehrere verschiedene Bestellnummern kommen alle mit", () => {
    const r = findeReferenzen(
      "Bestellnummer 303-1111111-1111111\nBestellnummer 304-2222222-2222222",
    );
    assert.equal(r.filter((x) => x.art === "bestellnummer").length, 2);
  });
});
