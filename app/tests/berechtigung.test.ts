import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { darf } from "../proxy";

/**
 * Die Rollenweiche der Middleware.
 *
 * Sie entscheidet vor jeder Seite und jeder Schnittstelle, wer durchkommt.
 * Bis hierhin gab es dafür keinen Test, obwohl sie die äußerste Grenze um
 * echte Mieterdaten ist.
 *
 * Anlass war der Dokumentenspeicher: Der Mieter soll seinen eigenen
 * Grundriss abrufen können, aber über dieselbe Route, über die der
 * Verwalter Dokumente ablegt. Die naheliegende Lösung -- den Weg in
 * FUER_MIETER aufzunehmen -- hätte die Verwalter davon ausgeschlossen.
 */

describe("Mieter", () => {
  test("darf seinen Bereich", () => {
    assert.equal(darf("/mieter", "mieter", "GET"), true);
    assert.equal(darf("/mieter/dokument/mietvertrag", "mieter", "GET"), true);
  });

  test("darf ein Dokument abrufen", () => {
    // Ohne diese Zeile kommt er nicht an seinen Grundriss -- die
    // Middleware weist ihn ab, bevor die Prüfung der Route überhaupt
    // läuft.
    assert.equal(darf("/api/dokumente/abc", "mieter", "GET"), true);
  });

  test("darf dort NICHT schreiben", () => {
    // Hochladen und Löschen bleiben bei der Verwaltung, auch wenn der Weg
    // derselbe ist.
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal(
        darf("/api/dokumente", "mieter", m),
        false,
        `Mieter darf nicht ${m} auf Dokumente`,
      );
      assert.equal(darf("/api/dokumente/abc", "mieter", m), false);
    }
  });

  test("kommt nicht in die Verwaltung", () => {
    for (const p of [
      "/", "/stammdaten", "/mietenbuch", "/mahnwesen", "/konten",
      "/objekt/abc", "/einheit/abc", "/mietverhaeltnis/abc",
      "/api/konten", "/api/altdaten/import", "/api/zahlungen/import",
    ]) {
      assert.equal(darf(p, "mieter", "GET"), false, `${p} muss zu sein`);
    }
  });

  test("ein ähnlich geschriebener Pfad öffnet nichts", () => {
    // Die Prüfung ist "gleich oder mit Schrägstrich dahinter", nicht
    // "beginnt mit". Sonst wäre /api/dokumenteheimlich offen.
    assert.equal(darf("/api/dokumenteheimlich", "mieter", "GET"), false);
    assert.equal(darf("/mieterdaten", "mieter", "GET"), false);
  });
});

describe("Verwalter", () => {
  test("darf die Verwaltung und die Dokumente, auch schreibend", () => {
    assert.equal(darf("/stammdaten", "verwalter", "GET"), true);
    assert.equal(darf("/api/dokumente/abc", "verwalter", "GET"), true);
    assert.equal(darf("/api/dokumente", "verwalter", "POST"), true);
    assert.equal(darf("/api/dokumente/abc", "verwalter", "DELETE"), true);
  });

  test("hat im Mieterbereich nichts verloren", () => {
    // Der zeigt die Sicht eines einzelnen Mietverhältnisses; ein Verwalter
    // dort wäre eine fremde Sitzung.
    assert.equal(darf("/mieter", "verwalter", "GET"), false);
    assert.equal(darf("/mieter/dokument/mietvertrag", "verwalter", "GET"), false);
  });
});

describe("Rolle lesen", () => {
  test("darf lesen, nicht schreiben", () => {
    assert.equal(darf("/stammdaten", "lesen", "GET"), true);
    assert.equal(darf("/api/dokumente/abc", "lesen", "GET"), true);
    assert.equal(darf("/api/dokumente", "lesen", "POST"), false);
    assert.equal(darf("/api/altdaten/import", "lesen", "POST"), false);
    assert.equal(darf("/api/mahnwesen", "lesen", "DELETE"), false);
  });
});
