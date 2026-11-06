import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  nameStecktDrin,
  waehleNachDatum,
  type BelegKandidat,
} from "../lib/belegabgleich";

/**
 * Tests der Namenspruefung und der Datumsregel.
 *
 * Beide entscheiden, welcher Beleg zu welcher Abbuchung gehoert. Eine
 * falsche Zuordnung wird festgeschrieben und sieht danach aus wie
 * erledigte Arbeit -- sie ist schlimmer als keine. Darum pruefen die
 * Tests vor allem, wo die Regeln schweigen muessen.
 *
 * Alle Namen und Nummern hier sind erfunden; die Zahlen 41,53 EUR und
 * der 12. des Monats stammen aus dem echten Fall vom 06.11.2026 (neun
 * WG-Gesucht-Rechnungen neben neun gleich hohen Abbuchungen).
 */

function beleg(id: string, datum: string | null, offen = "41.53"): BelegKandidat {
  return {
    id,
    belegnummer: null,
    betrag_brutto: offen,
    belegdatum: datum,
    dateiname: null,
    aussteller: "Beispiel GmbH & Co. KG",
    kontakt_name: null,
    vorgang_referenz: null,
    offen,
  };
}

describe("Namensprüfung", () => {
  test('"GmbH" allein ist keine Kennung', () => {
    // Vorher reichte jedes Wort ab vier Zeichen. "GmbH" hat vier --
    // damit passte jede GmbH zu jeder GmbH, und mit passendem Betrag
    // galt das als "Aussteller erkannt".
    assert.equal(
      nameStecktDrin("Irgendwas GmbH", "Zahlung an Ganz Andere GmbH, Ihr Einkauf"),
      false,
    );
  });

  test("ein kennzeichnendes Wort ab vier Zeichen zählt", () => {
    assert.equal(
      nameStecktDrin("Briefomat GmbH", "PP.6001.PP . Briefomat GmbH, Ihr Einkauf bei"),
      true,
    );
  });

  test("zwei Wörter in Reihe zählen, auch wenn beide kurz sind", () => {
    // "SMP GmbH & Co. KG" hat kein kennzeichnendes Wort ab vier Zeichen:
    // "smp" sind drei, "gmbh"/"co"/"kg" sagen nichts. Die Folge "smp
    // gmbh" dagegen ist eindeutig.
    assert.equal(
      nameStecktDrin("SMP GmbH & Co. KG", "PP.6001.PP . SMP GmbH & Co. KG, Ihr Einkauf"),
      true,
    );
  });

  test("zwei bedeutungslose Wörter in Reihe zählen nicht", () => {
    // "gmbh co" stünde sonst in jeder zweiten Abbuchung.
    assert.equal(
      nameStecktDrin("Alpha GmbH & Co. KG", "Zahlung an Beta GmbH & Co. KG"),
      false,
    );
  });

  test("Rechtsformen und Allerweltszusätze zählen nicht allein", () => {
    for (const n of [
      "Etwas Deutschland GmbH",
      "Etwas Europe BV",
      "Etwas Holding AG",
      "Etwas Payments GmbH",
    ]) {
      assert.equal(
        nameStecktDrin(n, "Zahlung an Fremde Deutschland Europe Holding Payments"),
        false,
        `${n} hat getroffen`,
      );
    }
  });

  test("Umlaute und Schreibweisen stören nicht", () => {
    assert.equal(nameStecktDrin("Müller Sanitär", "ueberweisung mueller sanitaer"), true);
  });

  test("leere Angaben treffen nie", () => {
    assert.equal(nameStecktDrin("", "irgendwas"), false);
    assert.equal(nameStecktDrin("Briefomat GmbH", ""), false);
  });
});

describe("Datumsregel", () => {
  test("der zeitlich nächste gewinnt, wenn der zweite weit weg ist", () => {
    const k = [
      beleg("sep", "2026-09-12"),
      beleg("aug", "2026-08-12"),
      beleg("okt", "2026-10-12"),
    ];
    const g = waehleNachDatum(k, "2026-09-15");
    assert.ok(g);
    assert.equal(g!.beleg.id, "sep");
    assert.equal(g!.tage, 3);
  });

  test("liegen zwei dicht beieinander, entscheidet sie nichts", () => {
    // Zwei gleich teure Zahlungen in derselben Woche: Hier wäre "der
    // nächste gewinnt" ein Münzwurf.
    const k = [beleg("a", "2026-09-12"), beleg("b", "2026-09-14")];
    assert.equal(waehleNachDatum(k, "2026-09-15"), null);
  });

  test("ein einziger Kandidat im Fenster genügt", () => {
    assert.equal(waehleNachDatum([beleg("a", "2026-09-12")], "2026-09-15")!.beleg.id, "a");
  });

  test("ein Beleg nach der Abbuchung zählt nur zwei Tage weit", () => {
    // Bezahlt wird nach dem Rechnungsdatum. Zwei Tage Vorlauf sind
    // erlaubt -- ein Abonnement bucht am Ersten und datiert auf den
    // Zweiten --, mehr nicht.
    assert.ok(waehleNachDatum([beleg("a", "2026-09-17")], "2026-09-15"));
    assert.equal(waehleNachDatum([beleg("a", "2026-09-20")], "2026-09-15"), null);
  });

  test("nach 45 Tagen ist der Beleg zu alt", () => {
    assert.ok(waehleNachDatum([beleg("a", "2026-08-01")], "2026-09-14"));
    assert.equal(waehleNachDatum([beleg("a", "2026-07-01")], "2026-09-15"), null);
  });

  test("ohne Datum entscheidet sie nicht", () => {
    assert.equal(waehleNachDatum([beleg("a", null)], "2026-09-15"), null);
    assert.equal(waehleNachDatum([beleg("a", "2026-09-12")], null), null);
  });

  test("Belege ohne Datum werden übersprungen, nicht als Treffer gewertet", () => {
    const g = waehleNachDatum([beleg("ohne", null), beleg("mit", "2026-09-12")], "2026-09-15");
    assert.equal(g!.beleg.id, "mit");
  });

  test("der echte Fall: neun Monatsrechnungen, jede eindeutig", () => {
    // Je 41,53 EUR, jeweils am 12., Abbuchung ein paar Tage später. Der
    // Nachbar liegt 30 Tage weg -- also weit über dem Mindestabstand.
    const monate = ["01","02","03","04","05","06","07","08","09"];
    const k = monate.map((m) => beleg(m, `2026-${m}-12`));
    for (const m of monate) {
      const g = waehleNachDatum(k, `2026-${m}-16`);
      assert.ok(g, `Monat ${m} blieb unentschieden`);
      assert.equal(g!.beleg.id, m, `Monat ${m} griff den falschen Beleg`);
    }
  });
});
