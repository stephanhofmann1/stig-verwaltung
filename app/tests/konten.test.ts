import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  kurzeIban,
  pruefeBezeichnung,
  pruefeArt,
  pruefeDatum,
} from "../lib/konten";

/**
 * Tests der Kontoverwaltung.
 *
 * Zwei Dinge werden hier festgehalten, und beide sind keine Kosmetik:
 *
 *   1. In `iban_kurz` kann strukturell keine ganze IBAN landen. Das Schema
 *      sagt "nur die letzten Stellen, nie die volle IBAN" -- ein Kommentar
 *      allein setzt das nicht durch.
 *   2. Die Vorschau des Kontoauszug-Imports schreibt nicht. Aus diesen
 *      Buchungen entsteht spaeter eine Mahnung; "erst ansehen, dann
 *      uebernehmen" darf nicht durch eine spaetere Umstellung wegfallen.
 */

describe("kurzeIban kann keine ganze IBAN speichern", () => {
  test("eine vollstaendige IBAN wird auf vier Stellen gekuerzt", () => {
    // Erfundene IBAN, keine echte.
    assert.equal(kurzeIban("DE89 3704 0044 0532 0130 00"), "3000");
  });

  test("egal was hereinkommt, nie mehr als vier Zeichen", () => {
    const proben = [
      "DE89370400440532013000",
      "DE89 3704 0044 0532 0130 00",
      "de8937040044053201300012345678901234567890",
      "AT611904300234573201",
      "·· 1234",
      "x".repeat(500),
    ];
    for (const p of proben) {
      const k = kurzeIban(p);
      assert.ok(k !== null, `${p} sollte etwas liefern`);
      assert.ok(
        k.length <= 4,
        `"${p}" ergab "${k}" mit ${k.length} Zeichen -- die Funktion darf ` +
          "nie mehr als vier zurueckgeben, sonst steht die ganze " +
          "Kontonummer in der Datenbank",
      );
    }
  });

  test("Leeres und Unsinniges ergibt null, nicht einen leeren Text", () => {
    assert.equal(kurzeIban(""), null);
    assert.equal(kurzeIban(null), null);
    assert.equal(kurzeIban(undefined), null);
    assert.equal(kurzeIban("   "), null);
    // Nur Trennzeichen: nach dem Saeubern bleibt nichts uebrig.
    assert.equal(kurzeIban("-- // .."), null);
  });

  test("Grossschreibung, damit dieselbe IBAN nicht zweimal aussieht", () => {
    assert.equal(kurzeIban("de8937040044053201300a"), "300A");
  });
});

describe("pruefeBezeichnung", () => {
  test("Leerzeichen am Rand werden entfernt", () => {
    // Sonst findet der Import sein Konto nicht: Er sucht mit
    // "WHERE bezeichnung = $1" und vergleicht Zeichen fuer Zeichen.
    assert.equal(pruefeBezeichnung("  Sparkasse Gießen ").wert, "Sparkasse Gießen");
  });

  test("Mehrfache Leerzeichen werden zusammengezogen", () => {
    assert.equal(pruefeBezeichnung("Sparkasse    Gießen").wert, "Sparkasse Gießen");
  });

  test("Leer ist ein Fehler", () => {
    assert.ok(pruefeBezeichnung("   ").fehler);
    assert.ok(pruefeBezeichnung("").fehler);
  });

  test("Gueltiges hat keinen Fehler", () => {
    assert.equal(pruefeBezeichnung("Girokonto").fehler, null);
  });
});

describe("pruefeArt", () => {
  test("bank und barkasse gehen durch", () => {
    assert.equal(pruefeArt("bank"), "bank");
    assert.equal(pruefeArt("barkasse"), "barkasse");
  });

  test("Vorgabe ist bank", () => {
    assert.equal(pruefeArt(undefined), "bank");
    assert.equal(pruefeArt(""), "bank");
  });

  test("Alles andere wird abgelehnt -- die Datenbank hat ein CHECK darauf", () => {
    assert.equal(pruefeArt("sparbuch"), null);
    assert.equal(pruefeArt("bank; DROP TABLE konto"), null);
  });
});

describe("die Vorschau des Imports schreibt nicht", () => {
  const quelle = readFileSync(
    new URL("../app/api/zahlungen/import/route.ts", import.meta.url),
    "utf8",
  );

  test("der Ausstieg steht vor dem Schreiben", () => {
    const vorschau = quelle.indexOf("if (nurPruefen)");
    const schreiben = quelle.indexOf("await tx(");
    assert.ok(vorschau > 0, "der Vorschau-Ausstieg fehlt in der Route");
    assert.ok(schreiben > 0, "der Schreibvorgang fehlt in der Route");
    assert.ok(
      vorschau < schreiben,
      "Die Vorschau muss VOR dem INSERT zurueckkehren. Steht sie danach, " +
        "schreibt ein Klick auf 'Datei lesen' die Buchungen schon in die " +
        "Datenbank -- und die Zuordnung laeuft mit.",
    );
  });

  test("zwischen Ausstieg und Schreiben wird nichts veraendert", () => {
    const vorschau = quelle.indexOf("if (nurPruefen)");
    const schreiben = quelle.indexOf("await tx(");
    const dazwischen = quelle.slice(vorschau, schreiben);
    for (const verboten of ["INSERT", "UPDATE", "DELETE", "uebernehmeSichere"]) {
      assert.ok(
        !dazwischen.includes(verboten),
        `Zwischen Vorschau-Ausstieg und tx() steht "${verboten}" -- dann ` +
          "ist die Vorschau keine Vorschau mehr.",
      );
    }
  });

  test("die Antwort der Vorschau ist als solche gekennzeichnet", () => {
    // Die Oberflaeche unterscheidet daran, ob sie den Uebernehmen-Knopf
    // zeigt. Faellt das Feld weg, sieht ein Schreibvorgang wie eine
    // Vorschau aus.
    assert.ok(quelle.includes("vorschau: true"));
  });
});

describe("keine Seite faellt aus dem Repository", () => {
  /**
   * Beim Anlegen von /konten hat `.gitignore` zugeschlagen: Die Zeile
   * `konten/` war fuer den Ordner mit heruntergeladenen Kontoauszuegen
   * gedacht, trifft ohne fuehrenden Schraegstrich aber jeden Ordner dieses
   * Namens -- auch app/app/konten/.
   *
   * Das ist die unangenehmste Art Fehler: Typpruefung gruen, Tests gruen,
   * Auslieferung gruen, und in Produktion ein Menuepunkt, der 404 liefert.
   * Nichts im Programm selbst kann das bemerken, weil lokal alle Dateien
   * da sind. Darum fragt dieser Test git.
   */
  test("jede Seite und jede Schnittstelle liegt im Repository", () => {
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    const wurzel = new URL("..", import.meta.url).pathname;

    let dateien: string[];
    try {
      // Alles, was Next als Seite oder Schnittstelle einsammelt.
      dateien = execFileSync(
        "find",
        ["app", "-name", "page.tsx", "-o", "-name", "route.ts", "-o", "-name", "layout.tsx"],
        { cwd: wurzel, encoding: "utf8" },
      ).trim().split("\n").filter(Boolean);
    } catch {
      return; // Ohne find kein Test -- aber auch kein falscher Alarm.
    }

    assert.ok(dateien.length > 10, "zu wenige Seiten gefunden, der Test greift nicht");

    let ignoriert: string[] = [];
    try {
      // check-ignore liefert Code 1, wenn NICHTS ignoriert ist -- das ist
      // der gute Fall, deshalb faengt der catch ihn ab und laesst die
      // Liste leer.
      ignoriert = execFileSync("git", ["check-ignore", "--", ...dateien], {
        cwd: wurzel, encoding: "utf8",
      }).trim().split("\n").filter(Boolean);
    } catch (e) {
      const f = e as { status?: number };
      if (f.status !== 1) return; // kein git vorhanden: nicht pruefbar
    }

    assert.deepEqual(
      ignoriert,
      [],
      "Diese Seiten werden von .gitignore ausgeschlossen und landen nicht " +
        "auf dem Server. In Produktion liefern sie 404, obwohl hier alles " +
        "gruen ist. Muster in .gitignore mit / am Anfang verankern.",
    );
  });
});

describe("pruefeDatum fuer den Beginn der Kontodaten", () => {
  test("ein gueltiges Datum geht durch", () => {
    assert.deepEqual(pruefeDatum("2025-07-31"), { wert: "2025-07-31", fehler: null });
  });

  test("leer heisst null -- also: hier wird nie gemahnt", () => {
    // Das ist kein Fehler, sondern die sichere Vorgabe. Augartenstrasse 91
    // hat kein Konto und soll deshalb leer bleiben.
    assert.deepEqual(pruefeDatum(""), { wert: null, fehler: null });
    assert.deepEqual(pruefeDatum("   "), { wert: null, fehler: null });
    assert.deepEqual(pruefeDatum(null), { wert: null, fehler: null });
  });

  test("ein Tag, den es nicht gibt, wird abgelehnt", () => {
    // 2026-02-31 passt auf das Muster und ist trotzdem kein Tag. Ohne diese
    // Pruefung kaeme der Fehler erst aus Postgres, in einer Sprache, die
    // niemandem hilft.
    assert.ok(pruefeDatum("2026-02-31").fehler);
    assert.ok(pruefeDatum("2026-13-01").fehler);
    assert.ok(pruefeDatum("2025-00-10").fehler);
  });

  test("der 29. Februar im Schaltjahr ist gueltig", () => {
    assert.equal(pruefeDatum("2024-02-29").fehler, null);
    assert.ok(pruefeDatum("2025-02-29").fehler);
  });

  test("falsche Schreibweisen werden abgelehnt", () => {
    for (const p of ["31.07.2025", "2025/07/31", "2025-7-1", "gestern", "0"]) {
      assert.ok(pruefeDatum(p).fehler, `"${p}" haette abgelehnt werden muessen`);
    }
  });

  test("unplausible Jahre werden abgelehnt", () => {
    assert.ok(pruefeDatum("0025-07-31").fehler);
    assert.ok(pruefeDatum("9999-07-31").fehler);
  });
});

describe("die Route fuer den Beginn der Kontodaten", () => {
  const route = readFileSync(
    new URL("../app/api/konten/zahlungsdaten/route.ts", import.meta.url),
    "utf8",
  );

  test("nur Verwalter -- nicht Mieter, nicht Lesezugang", () => {
    assert.ok(route.includes('sitzung.rolle === "mieter"'));
    assert.ok(
      route.includes('sitzung.rolle === "lesen"'),
      "ein Lesezugang darf die Abdeckungsgrenze des Mahnwesens nicht verschieben",
    );
  });

  test("aus_buchungen nimmt das Minimum der echten Buchungstage", () => {
    assert.ok(
      /min\(b\.buchungstag\)/.test(route),
      "der Wert muss aus den Buchungen kommen, nicht aus dem Konto",
    );
    assert.ok(
      /JOIN konto k ON k\.id = b\.konto_id/.test(route),
      "gezaehlt wird ueber die Konten des Objekts",
    );
  });

  test("ohne Buchungen wird nichts gesetzt", () => {
    // Sonst stuende dort NULL und saehe aus wie eine Entscheidung.
    assert.ok(route.includes("keine Buchungen vor"));
    assert.ok(route.includes("status: 409"));
  });
});
