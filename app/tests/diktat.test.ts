import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  SYSTEMPROMPT,
  baueNutzertext,
  fuehreZusammen,
  liesAntwort,
  werteDiktatAus,
  type DiktatBefund,
} from "../lib/diktat";

/**
 * Tests der Diktat-Auswertung.
 *
 * Der Punkt, um den es hier geht: Ein Sprachmodell erfindet Zahlen,
 * wenn es sie nicht findet, und es tut das in vollstaendigen Saetzen.
 * Ein erfundener Betrag in den Buechern ist schlimmer als ein
 * fehlender -- der fehlende faellt auf.
 *
 * Darum pruefen die Tests vor allem, dass das Regelwerk bei Betrag und
 * Datum Vorrang behaelt, dass ein Widerspruch festgehalten und nicht
 * verworfen wird, und dass eine Antwort, die sich nicht an die Form
 * haelt, ganz verworfen wird.
 *
 * In keinem Test wird eine echte API gerufen: `holen` ist eine Attrappe.
 */

const leer: DiktatBefund = {
  aussteller: null,
  zweck: null,
  belegdatum: null,
  betrag_brutto: null,
  art: null,
  kostenart: null,
  eigenbeleg_grund: null,
  gezahlt_mit: null,
  unklar: [],
};

function attrappe(antwort: string, ok = true, status = 200) {
  const gesehen: Array<{ url: string; body: string }> = [];
  const holen = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ) => {
    gesehen.push({ url, body: init.body });
    return {
      ok,
      status,
      json: async () => ({ content: [{ type: "text", text: antwort }] }),
    };
  };
  return { holen, gesehen };
}

describe("Der Auftrag an die KI", () => {
  test("er verbietet das Erfinden ausdrücklich", () => {
    assert.match(SYSTEMPROMPT, /ERFINDE NICHTS/);
    assert.match(SYSTEMPROMPT, /geratener Betrag.*schlimmer als ein fehlender/);
  });

  test("er verlangt null statt eines Platzhalters", () => {
    assert.match(SYSTEMPROMPT, /ist der Wert null und gehört in unklar/);
  });

  test("er nennt die erlaubten Belegarten", () => {
    for (const a of ["rechnung", "quittung", "eigenbeleg", "gutschrift"]) {
      assert.match(SYSTEMPROMPT, new RegExp(a));
    }
  });

  test("ein fehlender Dokumenttext wird als solcher benannt, nicht verschwiegen", () => {
    const t = baueNutzertext("", "zwanzig Euro Briefmarken");
    assert.match(t, /kein Text/);
    assert.match(t, /zwanzig Euro Briefmarken/);
  });

  test("ein sehr langer Dokumenttext wird gekürzt, nicht abgewiesen", () => {
    const t = baueNutzertext("x".repeat(50_000), "etwas");
    assert.ok(t.length < 14_000, `${t.length} Zeichen`);
  });
});

describe("Die Antwort einlesen", () => {
  test("eine saubere Antwort wird übernommen", () => {
    const b = liesAntwort(
      JSON.stringify({
        aussteller: "Beispiel GmbH",
        zweck: "Pizzaschneider",
        belegdatum: "2026-03-17",
        betrag_brutto: 4.99,
        art: "quittung",
        kostenart: "instandhaltung",
        eigenbeleg_grund: null,
        gezahlt_mit: "bar",
        unklar: [],
      }),
    );
    assert.equal(b?.aussteller, "Beispiel GmbH");
    assert.equal(b?.betrag_brutto, 4.99);
    assert.equal(b?.art, "quittung");
  });

  test("Vorwort und Codeblock um das JSON stören nicht", () => {
    const b = liesAntwort(
      'Gerne! ```json\n{"art":"rechnung","betrag_brutto":12.5}\n``` Fertig.',
    );
    assert.equal(b?.art, "rechnung");
    assert.equal(b?.betrag_brutto, 12.5);
  });

  test("eine erfundene Belegart wird verworfen, nicht gerettet", () => {
    assert.equal(liesAntwort('{"art":"zettel"}')?.art, null);
  });

  test("ein Datum in anderer Form wird verworfen", () => {
    assert.equal(liesAntwort('{"belegdatum":"17.03.2026"}')?.belegdatum, null);
    assert.equal(liesAntwort('{"belegdatum":"März 2026"}')?.belegdatum, null);
  });

  test('die Zeichenfolge "null" ist kein Wert', () => {
    assert.equal(liesAntwort('{"aussteller":"null"}')?.aussteller, null);
  });

  test("ein Betrag als deutscher Text wird gelesen", () => {
    assert.equal(liesAntwort('{"betrag_brutto":"1.234,56 EUR"}')?.betrag_brutto, 1234.56);
  });

  test("ein negativer Betrag wird als Betrag gelesen, nicht verworfen", () => {
    // Eine Gutschrift ueber 103,96 EUR ist ein Beleg ueber 103,96 EUR.
    assert.equal(liesAntwort('{"betrag_brutto":-103.96}')?.betrag_brutto, 103.96);
  });

  test("kein JSON ergibt nichts", () => {
    assert.equal(liesAntwort("Das kann ich nicht beantworten."), null);
    assert.equal(liesAntwort(""), null);
    assert.equal(liesAntwort("[1,2,3]"), null);
  });

  test("unklar wird als Liste von Wörtern gelesen", () => {
    assert.deepEqual(liesAntwort('{"unklar":["Betrag",null,7,"Datum"]}')?.unklar, [
      "Betrag",
      "Datum",
    ]);
  });
});

describe("Regelwerk und KI zusammenführen", () => {
  test("wo das Regelwerk gelesen hat, behält es Vorrang", () => {
    const z = fuehreZusammen(
      { belegdatum: "2026-03-17", betrag_brutto: 4.99 },
      { ...leer, belegdatum: "2026-03-20", betrag_brutto: 49.9 },
    );
    assert.equal(z.betrag_brutto, 4.99);
    assert.equal(z.belegdatum, "2026-03-17");
  });

  test("ein Widerspruch wird festgehalten, nicht verworfen", () => {
    // Wenn zwei Lesungen auseinandergehen, kann auch das Muster falsch
    // liegen. Dann soll ein Mensch hinsehen.
    const z = fuehreZusammen(
      { belegdatum: "2026-03-17", betrag_brutto: 4.99 },
      { ...leer, belegdatum: "2026-03-20", betrag_brutto: 49.9 },
    );
    assert.match(z.abweichung!, /Betrag: Regelwerk 4,99 EUR \/ Auswertung 49,90 EUR/);
    assert.match(z.abweichung!, /Datum: Regelwerk 2026-03-17 \/ Auswertung 2026-03-20/);
  });

  test("sind beide einig, gibt es keine Abweichung", () => {
    const z = fuehreZusammen(
      { belegdatum: "2026-03-17", betrag_brutto: 4.99 },
      { ...leer, belegdatum: "2026-03-17", betrag_brutto: 4.99 },
    );
    assert.equal(z.abweichung, null);
  });

  test("wo das Regelwerk schweigt, zählt das Gesagte -- und es wird vermerkt", () => {
    const z = fuehreZusammen(
      { belegdatum: null, betrag_brutto: null },
      { ...leer, belegdatum: "2026-03-17", betrag_brutto: 4.99 },
    );
    assert.equal(z.betrag_brutto, 4.99);
    assert.ok(z.quelle.includes("Betrag aus dem Gesagten übernommen"));
    assert.ok(z.quelle.includes("Datum aus dem Gesagten übernommen"));
  });

  test("woher ein Wert kommt, steht immer dabei", () => {
    const z = fuehreZusammen(
      { belegdatum: "2026-03-17", betrag_brutto: 4.99 },
      leer,
    );
    assert.ok(z.quelle.includes("Betrag aus dem Dokument gelesen"));
    assert.ok(z.quelle.includes("Datum aus dem Dokument gelesen"));
  });

  test("weiß keiner den Betrag, bleibt er offen und wird nicht geraten", () => {
    const z = fuehreZusammen({ belegdatum: null, betrag_brutto: null }, leer);
    assert.equal(z.betrag_brutto, null);
    assert.ok(z.offen.includes("Betrag"));
    assert.ok(z.offen.includes("Belegdatum"));
  });

  test("ein Eigenbeleg ohne Grund bleibt offen", () => {
    const z = fuehreZusammen(
      { belegdatum: "2026-03-17", betrag_brutto: 4.99 },
      { ...leer, art: "eigenbeleg", zweck: "Pizzaschneider", aussteller: "Privatperson" },
    );
    assert.ok(z.offen.includes("Grund für das Fehlen eines Fremdbelegs"));
  });

  test("ohne KI-Befund bleibt die Art 'sonstige' und nicht leer", () => {
    const z = fuehreZusammen({ belegdatum: null, betrag_brutto: null }, null);
    assert.equal(z.art, "sonstige");
  });

  test("Zweck und Empfänger fehlen sichtbar, wenn die KI sie nicht nennt", () => {
    const z = fuehreZusammen({ belegdatum: "2026-03-17", betrag_brutto: 4.99 }, leer);
    assert.ok(z.offen.includes("Art der Aufwendung"));
    assert.ok(z.offen.includes("Zahlungsempfänger"));
  });
});

describe("Die Anfrage selbst", () => {
  test("ohne Schlüssel wird nichts versucht und das gesagt", async () => {
    const { holen, gesehen } = attrappe("{}");
    const r = await werteDiktatAus("text", "satz", { schluessel: null, holen });
    assert.equal(r.ok, false);
    assert.equal(gesehen.length, 0, "es wurde trotzdem gerufen");
    if (!r.ok) {
      assert.equal(r.code, "kein_schluessel");
      assert.match(r.fehler, /von Hand eingetragen/);
    }
  });

  test("Dokumenttext und Diktat gehen beide mit", async () => {
    const { holen, gesehen } = attrappe('{"art":"rechnung"}');
    await werteDiktatAus("RECHNUNG Nr. 4711", "das war die Küche", {
      schluessel: "pruef",
      holen,
    });
    assert.equal(gesehen.length, 1);
    assert.match(gesehen[0].body, /RECHNUNG Nr\. 4711/);
    assert.match(gesehen[0].body, /das war die Küche/);
  });

  test("ein Fehlerstatus wird gemeldet, nicht als leerer Befund ausgegeben", async () => {
    const { holen } = attrappe("{}", false, 529);
    const r = await werteDiktatAus("t", "s", { schluessel: "pruef", holen });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.fehler, /529/);
  });

  test("eine unlesbare Antwort ist ein Fehler, kein leerer Beleg", async () => {
    const { holen } = attrappe("Tut mir leid, das kann ich nicht.");
    const r = await werteDiktatAus("t", "s", { schluessel: "pruef", holen });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.fehler, /nicht lesbar/);
  });

  test("der Schlüssel landet nicht in der Fehlermeldung", async () => {
    const { holen } = attrappe("{}", false, 401);
    const r = await werteDiktatAus("t", "s", { schluessel: "geheim-xyz", holen });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(!r.fehler.includes("geheim-xyz"));
  });
});
