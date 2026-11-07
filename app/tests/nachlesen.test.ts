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

describe("Was die Route tun darf", () => {
  test("ohne aendern=1 wird nichts geschrieben", () => {
    assert.match(route, /const aendern = String\(form\?\.get\("aendern"\) \?\? ""\) === "1"/);
    for (const stelle of [...route.matchAll(/await query\(\s*`UPDATE/g)]) {
      const davor = route.slice(0, stelle.index);
      assert.ok(
        /if \(aendern/.test(davor.slice(-400)),
        "ein UPDATE steht nicht hinter aendern",
      );
    }
  });

  test("ein Vermerk ohne zweiten Zeugen wird nicht aufgelöst", () => {
    // Ein Vermerk, den niemand bestaetigt, verschwindet sonst nur
    // deshalb, weil das Regelwerk heute etwas anderes sagt als
    // vorgestern -- und das ist kein Beweis, sondern eine zweite
    // Meinung.
    assert.match(route, /if \(!beifuegung\) \{/);
    assert.match(route, /ergebnis: "ohne_zweiten_zeugen"/);
    const zweig = route.slice(
      route.indexOf("if (!beifuegung) {"),
      route.indexOf("const frisch ="),
    );
    assert.ok(!/UPDATE/.test(zweig), "der Zweig schreibt");
  });

  test("aufgelöst wird nur, wenn die frische Gegenprobe schweigt", () => {
    assert.match(route, /const frisch = widerspruch\(neu, beifuegung\)/);
    assert.match(route, /if \(frisch === null\) \{/);
  });

  test("bei fortbestehendem Widerspruch wird der Vermerk frisch geschrieben", () => {
    // Er soll den heutigen Vergleich nennen, nicht den von vorgestern.
    assert.match(route, /SET abweichung = \$2 WHERE id = \$1/);
    assert.match(route, /frisch !== z\.abweichung/);
  });

  test("die neuen Werte wandern in die Zeile, nicht nur der Vermerk weg", () => {
    // Beim Einliefern wurde die Lesung des Regelwerks gespeichert, und
    // das war die falsche. Nur den Vermerk zu entfernen liesse den
    // falschen Betrag in den Buechern stehen.
    assert.match(route, /SET belegdatum = COALESCE\(\$2::date, belegdatum\)/);
    assert.match(route, /betrag_brutto = COALESCE\(\$3::numeric, betrag_brutto\)/);
    assert.match(route, /abweichung = NULL/);
  });

  test("was geschah, steht danach in den Notizen", () => {
    assert.match(route, /notizen = concat_ws/);
    assert.match(route, /mit den heutigen Regeln neu gelesen/);
    assert.match(route, /\$\{z\.abweichung\}/);
  });

  test("eine unlesbare Datei bricht den Lauf nicht ab", () => {
    // Sonst bliebe wegen eines kaputten Belegs der ganze Rest liegen.
    assert.match(route, /ergebnis: "unlesbar"/);
    assert.match(route, /\} catch \(e\) \{/);
  });

  test("Mieter kommen nicht herein, Leserecht darf nicht ändern", () => {
    assert.match(route, /sitzung\.rolle === "mieter"/);
    assert.match(route, /aendern && sitzung\.rolle === "lesen"/);
  });

  test("der Bericht nennt Zähler, nicht nur eine Liste", () => {
    // "19 angesehen, 19 aufgeloest" ist pruefbar; eine Liste muss man
    // zaehlen.
    for (const f of ["geprueft", "aufgeloest", "bleibt", "ohne_zweiten_zeugen", "unlesbar"]) {
      // Kurzschreibweise (`aufgeloest,`) zaehlt genauso wie `feld:`.
      assert.match(route, new RegExp(`\\b${f}(:|,)`));
    }
  });

  test("ohne Angabe werden genau die Belege mit Vermerk genommen", () => {
    assert.match(route, /WHERE abweichung IS NOT NULL/);
    assert.match(route, /AND ablage_pfad IS NOT NULL/);
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

  test('"übernehmen" erscheint erst nach dem Lesen', () => {
    assert.match(stueck, /bericht && !bericht\.geaendert && bericht\.aufgeloest > 0/);
  });

  test("der Knopf nennt die Zahl, die er übernehmen würde", () => {
    // "3 übernehmen" ist pruefbar, "Übernehmen" nicht.
    assert.match(stueck, /\$\{bericht\.aufgeloest\} übernehmen/);
  });

  test("der Bericht nennt den Nenner", () => {
    assert.match(stueck, /\{bericht\.geprueft\} angesehen/);
  });

  test("er sagt ausdrücklich, wenn nichts geändert wurde", () => {
    assert.match(stueck, /nichts geändert/);
  });

  test("je Beleg stehen alle drei Lesungen da", () => {
    // bisher / neu gelesen / Beifuegung -- sonst ist nicht
    // nachvollziehbar, warum sich etwas aufloest.
    assert.match(stueck, /bisher \{euro\(b\.alt\.betrag\)\}/);
    assert.match(stueck, /neu\s*\n?\s*gelesen \{euro\(b\.neu\.betrag\)\}/);
    assert.match(stueck, /Beifügung \$\{euro\(b\.beifuegung\.betrag\)\}/);
  });

  test("nach dem Übernehmen wird die Seite neu geladen", () => {
    // Die Liste darueber zeigt sonst Belege, die es dort nicht mehr gibt.
    assert.match(stueck, /d\.geaendert && d\.aufgeloest > 0/);
    assert.match(stueck, /window\.location\.reload\(\)/);
  });
});
