import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  baueEigenbeleg,
  fehlendeAngaben,
  umbrich,
  type Eigenbeleg,
} from "../lib/eigenbeleg";
import { lieseBeleg } from "../lib/belegtext";
import { werteBelegAus } from "../lib/belege";

/**
 * Tests des Eigenbelegs.
 *
 * Ein Eigenbeleg wird nur anerkannt, wenn er vollstaendig ist -- und
 * der Punkt, an dem die meisten scheitern, ist der GRUND, warum kein
 * Fremdbeleg vorliegt. Darum pruefen die Tests vor allem, dass ein
 * halber Eigenbeleg NICHT entsteht: Er laege in der Ablage, saehe nach
 * Beleg aus und fiele erst in der Pruefung auf, wenn es zu spaet ist.
 *
 * Alle Namen hier sind erfunden.
 */

const vollstaendig: Eigenbeleg = {
  empfaenger: "Privatverkäufer über Kleinanzeigen",
  zweck: "Pizzaschneider für die Gemeinschaftsküche",
  datum: "2026-03-17",
  betrag: 4.99,
  grund: "Kauf von einer Privatperson; ein Verkäuferbeleg wird dort nicht erstellt.",
  erstellt_von: "Beispiel Verwalter",
  erstellt_am: "2026-11-06",
};

describe("Vollständigkeit", () => {
  test("ein vollständiger Eigenbeleg hat keine Lücken", () => {
    assert.deepEqual(fehlendeAngaben(vollstaendig), []);
  });

  test("ohne Grund ist es ein Zettel, kein Beleg", () => {
    const { grund: _, ...ohne } = vollstaendig;
    assert.deepEqual(fehlendeAngaben(ohne), [
      "Grund für das Fehlen eines Fremdbelegs",
    ]);
  });

  test('ein Grund wie "." zählt nicht', () => {
    assert.deepEqual(fehlendeAngaben({ ...vollstaendig, grund: "." }), [
      "Grund für das Fehlen eines Fremdbelegs",
    ]);
  });

  test("jedes geforderte Feld wird einzeln benannt", () => {
    const fehlt = fehlendeAngaben({});
    assert.deepEqual(fehlt, [
      "Zahlungsempfänger",
      "Art der Aufwendung",
      "Datum der Zahlung",
      "Betrag",
      "Grund für das Fehlen eines Fremdbelegs",
      "Ersteller",
      "Datum der Erstellung",
    ]);
  });

  test("ein Betrag von null oder darunter ist kein Betrag", () => {
    for (const b of [0, -4.99, Number.NaN]) {
      assert.ok(
        fehlendeAngaben({ ...vollstaendig, betrag: b }).includes("Betrag"),
        `${b} durchgelassen`,
      );
    }
  });

  test("ein Datum in anderer Form wird beanstandet", () => {
    assert.ok(
      fehlendeAngaben({ ...vollstaendig, datum: "17.03.2026" }).some((x) =>
        x.includes("Jahr-Monat-Tag"),
      ),
    );
  });

  test("Leerzeichen allein füllen kein Feld", () => {
    assert.ok(
      fehlendeAngaben({ ...vollstaendig, zweck: "   " }).includes(
        "Art der Aufwendung",
      ),
    );
  });
});

describe("Das Blatt", () => {
  test("ein unvollständiger Eigenbeleg wird nicht gedruckt", async () => {
    // Ein halber Eigenbeleg ist schlimmer als keiner.
    const { grund: _, ...ohne } = vollstaendig;
    await assert.rejects(
      () => baueEigenbeleg(ohne as Eigenbeleg),
      /fehlen Angaben[\s\S]*Grund/,
    );
  });

  test("das Blatt trägt alle geforderten Angaben, vom Portal selbst gelesen", async () => {
    const pdf = await baueEigenbeleg(vollstaendig);
    const gelesen = await lieseBeleg(pdf);
    const text = (gelesen.text ?? "").replace(/\s+/g, " ");

    assert.match(text, /Eigenbeleg/);
    assert.match(text, /Privatverkäufer über Kleinanzeigen/);
    assert.match(text, /Pizzaschneider für die Gemeinschaftsküche/);
    assert.match(text, /17\.03\.2026/);
    assert.match(text, /Zahlbetrag 4,99 EUR/);
    assert.match(text, /Verkäuferbeleg wird dort nicht erstellt/);
    assert.match(text, /Beispiel Verwalter/);
    assert.match(text, /Unterschrift des Erstellers/);
  });

  test("das Regelwerk des Portals liest Datum und Betrag richtig heraus", async () => {
    // Derselbe Fehler wie bei den PayPal-Blaettern soll sich nicht
    // wiederholen: Was das Portal nicht lesen kann, ist fuer es nicht da.
    const pdf = await baueEigenbeleg(vollstaendig);
    const gelesen = await lieseBeleg(pdf);
    const befund = werteBelegAus(gelesen.text ?? "", "eigenbeleg.pdf");
    assert.equal(befund.belegdatum, "2026-03-17");
    assert.equal(befund.betrag_brutto, 4.99);
  });

  test("es sagt nicht, der Zeitstempel ersetze die Unterschrift", async () => {
    const pdf = await baueEigenbeleg(vollstaendig);
    const text = ((await lieseBeleg(pdf)).text ?? "").replace(/\s+/g, " ");
    assert.match(text, /neben die Unterschrift, nicht an ihre Stelle/);
  });

  test("es nennt, dass kein Fremdbeleg vorliegt", async () => {
    const pdf = await baueEigenbeleg(vollstaendig);
    const text = ((await lieseBeleg(pdf)).text ?? "").replace(/\s+/g, " ");
    assert.match(text, /kein Beleg eines Dritten/);
  });

  test("ein langer Grund wird umgebrochen und nicht abgeschnitten", async () => {
    const lang =
      "Die Quittung des Verkäufers ist beim Transport im Regen unlesbar " +
      "geworden; der Verkäufer ist über die Plattform nicht mehr " +
      "erreichbar, weil das Angebot nach dem Verkauf gelöscht wurde, und " +
      "eine erneute Ausstellung war deshalb nicht zu erreichen.";
    const pdf = await baueEigenbeleg({ ...vollstaendig, grund: lang });
    const text = ((await lieseBeleg(pdf)).text ?? "").replace(/\s+/g, " ");
    assert.match(text, /nicht zu erreichen/);
  });

  test('der Betrag heißt "Zahlbetrag", damit das Regelwerk ihn sieht', async () => {
    // "Betrag" allein ist fuer lib/belege.ts kein Etikett. Ein Blatt mit
    // dieser Aufschrift waere fuer die eigene Auswertung ein Blatt ohne
    // Betrag -- derselbe Fehler wie bei den 61 PayPal-Blaettern.
    const text = ((await lieseBeleg(await baueEigenbeleg(vollstaendig))).text ?? "")
      .replace(/\s+/g, " ");
    assert.match(text, /Zahlbetrag/);
  });

  test("ein vierstelliger Betrag bekommt den Tausenderpunkt", async () => {
    const pdf = await baueEigenbeleg({ ...vollstaendig, betrag: 2357.54 });
    const text = ((await lieseBeleg(pdf)).text ?? "").replace(/\s+/g, " ");
    assert.match(text, /2\.357,54 EUR/);
  });

  test("der Buchungstag erscheint nur, wenn er bekannt ist", async () => {
    const ohne = ((await lieseBeleg(await baueEigenbeleg(vollstaendig))).text ?? "");
    assert.ok(!/Abbuchung auf dem Konto/.test(ohne));
    const mit = ((await lieseBeleg(
      await baueEigenbeleg({ ...vollstaendig, buchungstag: "2026-03-20" }),
    )).text ?? "").replace(/\s+/g, " ");
    assert.match(mit, /Abbuchung auf dem Konto 20\.03\.2026/);
  });
});

describe("Umbruch", () => {
  const schrift = { widthOfTextAtSize: (t: string, g: number) => t.length * g * 0.5 };

  test("ein kurzer Text bleibt eine Zeile", () => {
    assert.deepEqual(umbrich("kurz", schrift, 10, 500), ["kurz"]);
  });

  test("leerer Text ergibt eine leere Zeile, nicht nichts", () => {
    assert.deepEqual(umbrich("   ", schrift, 10, 500), [""]);
  });

  test("kein Wort geht verloren", () => {
    const text = "eins zwei drei vier fünf sechs sieben acht neun zehn";
    const zeilen = umbrich(text, schrift, 10, 60);
    assert.equal(zeilen.join(" ").split(/\s+/).length, 10);
  });

  test("ein Wort, das allein zu lang ist, bekommt seine eigene Zeile", () => {
    const zeilen = umbrich("kurz Donaudampfschifffahrtsgesellschaft kurz", schrift, 10, 60);
    assert.ok(zeilen.some((z) => z === "Donaudampfschifffahrtsgesellschaft"));
  });
});
