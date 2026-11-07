import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { liesWiderspruch, widerspruch } from "../lib/gegenprobe";

/**
 * Tests des Nachlesens.
 *
 * ANLASS, 07.11.2026
 *
 * 19 Belege trugen einen Widerspruchsvermerk aus der Gegenprobe. Alle
 * 19 waren nach den heutigen Regeln widerspruchsfrei -- die Vermerke
 * waren eingefrorene Lesungen von vorgestern. Weil ein Beleg mit
 * Vermerk vom selbsttaetigen Abgleich bewusst nicht angenommen wird,
 * hingen daran 43 offene Amazon-Zahlungen.
 *
 * Was hier NICHT passieren darf: dass ein Vermerk verschwindet, nur
 * weil das Regelwerk heute etwas anderes sagt als vorgestern. Dafuer
 * braucht es den zweiten Zeugen zurueck.
 */
const route = readFileSync(
  new URL("../app/api/belege/nachlesen/route.ts", import.meta.url),
  "utf8",
);

describe("Den zweiten Zeugen zurücklesen", () => {
  test("Hin- und Rückweg stimmen überein", () => {
    // Das Format schreibt widerspruch() selbst. Wenn eines von beiden
    // sich aendert, muss dieser Test rot werden.
    const faelle: Array<[number | null, string | null]> = [
      [128.89, "2026-09-27"],
      [1234.56, "2025-12-31"],
      [0.01, "2026-01-01"],
      [2357.54, "2026-08-13"],
    ];
    for (const [betrag, datum] of faelle) {
      const text = widerspruch({ betrag: 1, datum: "1999-01-01" }, { betrag, datum });
      assert.ok(text, `kein Widerspruch für ${betrag}/${datum}`);
      assert.deepEqual(liesWiderspruch(text), { betrag, datum });
    }
  });

  test("ein Tausenderpunkt im Betrag wird richtig zurückgelesen", () => {
    // Direkt am Text geprueft, nicht ueber den Hin- und Rueckweg:
    // geld() setzt KEINEN Tausenderpunkt, also erreicht der Rueckweg
    // diesen Zweig ueber widerspruch() nie. Der Rueckweg behauptet
    // aber, die gruppierte Form zu lesen -- und wenn geld() das eines
    // Tages tut, soll nicht lautlos NaN herauskommen.
    assert.equal(
      liesWiderspruch("Betrag: Regelwerk 1,00 / Beifügung 2.357,54")!.betrag,
      2357.54,
    );
    assert.equal(
      liesWiderspruch("Betrag: Regelwerk 1,00 / Beifügung 1.234.567,89")!.betrag,
      1234567.89,
    );
    // Und zur Sicherheit: die Form, die geld() heute wirklich schreibt.
    const text = widerspruch({ betrag: 1, datum: null }, { betrag: 2357.54, datum: null });
    assert.equal(liesWiderspruch(text)!.betrag, 2357.54);
  });

  test('ein "ohne" beim Datum wird zu null, nicht zum Wort', () => {
    // Auch dieser Zweig ist ueber widerspruch() nicht erreichbar
    // (gleichDatum schweigt, wenn eine Seite fehlt). Steht das Wort
    // trotzdem im Text, darf daraus kein Datum "ohne" werden -- das
    // landete sonst als Belegdatum in der Zeile.
    assert.equal(
      liesWiderspruch("Datum: Regelwerk 2026-01-01 / Beifügung ohne")!.datum,
      null,
    );
  });

  test("nur der Betrag im Vermerk: das Datum bleibt leer", () => {
    const text = widerspruch(
      { betrag: 39.99, datum: "2026-09-26" },
      { betrag: 128.89, datum: "2026-09-26" },
    );
    assert.deepEqual(liesWiderspruch(text), { betrag: 128.89, datum: null });
  });

  test("nur das Datum im Vermerk: der Betrag bleibt leer", () => {
    const text = widerspruch(
      { betrag: 9.98, datum: "2026-09-13" },
      { betrag: 9.98, datum: "2026-09-14" },
    );
    assert.deepEqual(liesWiderspruch(text), { betrag: null, datum: "2026-09-14" });
  });

  test('"ohne" wird als unbekannt gelesen, nicht als Zahl', () => {
    const text = widerspruch({ betrag: 5, datum: "2026-01-01" }, { betrag: null, datum: null });
    // Fehlt eine Seite, gilt das nicht als Widerspruch -- also steht
    // dazu auch nichts im Text.
    assert.equal(text, null);
    assert.equal(liesWiderspruch("Betrag: Regelwerk 5,00 / Beifügung ohne")!.betrag, null);
  });

  test("ein Text ohne Vergleich ergibt nichts", () => {
    for (const t of [null, "", "Nachträglich von Hand gelöst.", "Betrag stimmt."]) {
      assert.equal(liesWiderspruch(t), null, `"${t}" durchgelassen`);
    }
  });

  test("ein echter Vermerk aus dem Betrieb wird gelesen", () => {
    // Wörtlich von /belege am 07.11.2026.
    const echt =
      "Betrag: Regelwerk 39,99 / Beifügung 128,89; " +
      "Datum: Regelwerk 2026-09-26 / Beifügung 2026-09-27";
    assert.deepEqual(liesWiderspruch(echt), {
      betrag: 128.89,
      datum: "2026-09-27",
    });
  });
});

describe("Was der Lauf nie anfasst", () => {
  test("einen Beleg, der schon einer Buchung zugeordnet ist", () => {
    // Dessen Betrag zu aendern wuerde eine festgeschriebene Zuordnung
    // von hinten verbiegen -- die Zuordnung stimmte fuer den alten
    // Betrag. Diese Regel stand schon in der Route; getestet war sie
    // nicht.
    assert.match(route, /if \(Number\(b\.zugeordnet\) > 0\) \{/);
    assert.match(route, /gesperrt\.push/);
    const zweig = route.slice(
      route.indexOf("if (Number(b.zugeordnet) > 0) {"),
      route.indexOf("aenderungen.push"),
    );
    assert.ok(!/UPDATE/.test(zweig), "der Zweig schreibt");
  });

  test("einen Betrag, der nicht bestimmbar ist", () => {
    // Mehrere Belegstuecke in einer Datei und keine Summenregel, die
    // es aufloest: findeBetrag nimmt dann den letzten im Text, und das
    // kann die Quittung einer fremden Bestellung sein.
    assert.match(route, /const betragUneindeutig = stuecke > 1 && !summeKlar/);
    assert.match(route, /!betragUneindeutig &&/);
  });

  test("Kostenart, Objekt und Umlagefähigkeit", () => {
    // Die koennen von Hand gesetzt worden sein; ein maschineller Lauf
    // ueberschreibt keine menschliche Entscheidung.
    const update = route.slice(route.indexOf("`UPDATE beleg"));
    for (const feld of ["kostenart", "objekt_id", "umlagefaehig"]) {
      assert.ok(!update.includes(feld), `der Lauf ändert ${feld}`);
    }
  });

  test("ohne uebernehmen wird nichts geschrieben", () => {
    assert.match(route, /const uebernehmen = wunsch\.uebernehmen === true/);
    assert.match(route, /if \(!uebernehmen\) continue;/);
    const stelle = route.indexOf("`UPDATE beleg");
    assert.ok(
      route.lastIndexOf("if (!uebernehmen) continue;") < stelle,
      "das UPDATE steht vor der Schranke",
    );
  });

  test("Mieter und Leserecht kommen nicht herein", () => {
    assert.match(
      route,
      /sitzung\.rolle === "mieter" \|\| sitzung\.rolle === "lesen"/,
    );
  });
});

describe("Der Widerspruchsvermerk", () => {
  test("er löst sich nur mit zweitem Zeugen auf", () => {
    // Ein Vermerk, den niemand bestaetigt, verschwindet sonst nur
    // deshalb, weil das Regelwerk heute etwas anderes sagt als
    // vorgestern -- und das ist kein Beweis, sondern eine zweite
    // Meinung.
    assert.match(
      route,
      /b\.abweichung !== null && beifuegung !== null && frisch === null/,
    );
  });

  test("der zweite Zeuge kommt aus dem Vermerk selbst", () => {
    assert.match(route, /liesWiderspruch\(b\.abweichung\)/);
  });

  test("die frische Gegenprobe vergleicht die NEUE Lesung", () => {
    assert.match(
      route,
      /widerspruch\(\s*\{ betrag: neu\.betrag_brutto, datum: neu\.belegdatum \},\s*beifuegung,/,
    );
  });

  test("bleibt er strittig, wird er frisch geschrieben", () => {
    assert.match(route, /frisch !== null && frisch !== b\.abweichung/);
    assert.match(route, /WHEN \$6::text IS NOT NULL THEN \$6::text/);
  });

  test("ein Beleg mit gleichen Zahlen, aber lösbarem Vermerk, wird nicht übersprungen", () => {
    // Sonst bliebe er fuer den Abgleich gesperrt, obwohl der Grund weg
    // ist.
    assert.match(
      route,
      /!betragAnders && !datumAnders && !vermerkFaelltWeg && !vermerkNeuSchreiben/,
    );
  });

  test("was geschah, steht danach in den Notizen", () => {
    assert.match(route, /mit den heutigen Regeln aufgelöst/);
    assert.match(route, /notizen = COALESCE\(notizen \|\| ' ', ''\) \|\| \$4/);
  });

  test("der Bericht zählt beide Fälle", () => {
    assert.match(route, /vermerk_loest_sich: vermerkLoest/);
    assert.match(route, /vermerk_bleibt: vermerkBleibt/);
  });
});

describe("Die Oberfläche", () => {
  const stueck = readFileSync(
    new URL("../components/Nachlesen.tsx", import.meta.url),
    "utf8",
  );
  const seite = readFileSync(
    new URL("../app/belege/page.tsx", import.meta.url),
    "utf8",
  );

  test("der Knopf steht bei den Belegen mit Abweichung", () => {
    const i = seite.indexOf("Belege mit Abweichung");
    const j = seite.indexOf("<Nachlesen />");
    assert.ok(i > 0 && j > i, "der Knopf steht nicht im Abschnitt");
  });

  test("sie ruft die Route mit ihrem eigenen Vertrag", () => {
    // JSON mit `uebernehmen`, nicht ein erfundenes Formularfeld.
    assert.match(stueck, /JSON\.stringify\(\{ uebernehmen \}\)/);
    assert.match(stueck, /"content-type": "application\/json"/);
  });

  test('"übernehmen" erscheint erst nach dem Probelauf', () => {
    assert.match(
      stueck,
      /bericht && bericht\.probelauf && bericht\.wuerde_sich_aendern > 0/,
    );
  });

  test("der Knopf nennt die Zahl, die er übernehmen würde", () => {
    assert.match(stueck, /\$\{bericht\.wuerde_sich_aendern\} übernehmen/);
  });

  test("der Bericht nennt den Nenner", () => {
    assert.match(stueck, /\{bericht\.gelesen\} von \{bericht\.belege\}/);
  });

  test("er sagt ausdrücklich, dass der Probelauf nichts geschrieben hat", () => {
    assert.match(stueck, /nichts geschrieben/);
  });

  test("die unangetasteten Belege werden benannt, nicht nur gezählt", () => {
    // Nicht nur das Feld erwaehnen: die Namen muessen gerendert werden.
    assert.match(
      stueck,
      /bericht\.beispiele_gesperrt\.length > 0 && \(/,
    );
    assert.match(stueck, /\.map\(\(g\) => g\.datei \?\? "ohne Namen"\)/);
    assert.match(stueck, /gilt für den alten Betrag/);
  });

  test("je Beleg stehen alter und neuer Wert da", () => {
    assert.match(stueck, /\{euro\(a\.betrag_alt\)\} → \{euro\(a\.betrag_neu\)\}/);
  });

  test("nach dem Übernehmen wird die Seite neu geladen", () => {
    assert.match(stueck, /!d\.probelauf && d\.geschrieben > 0/);
    assert.match(stueck, /window\.location\.reload\(\)/);
  });
});
