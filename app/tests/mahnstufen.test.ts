import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  dritterWerktag,
  istWerktag,
  stufeFuer,
  rueckstaende,
  type OffenerPosten,
} from "../lib/mahnstufen";

/**
 * Tests fuer das Mahnwesen.
 *
 * Hier entscheidet sich, ob jemand Post bekommt, die ihn beunruhigt. Die
 * teuren Fehler sind beide einseitig:
 *   zu frueh mahnen  -> ein Schreiben an jemanden, der puenktlich zahlt
 *   zu spaet mahnen  -> Geld bleibt laenger aus
 * Das erste ist schlimmer und laesst sich nicht zuruecknehmen. Deshalb
 * pruefen diese Tests vor allem, dass NICHT gemahnt wird, wo es nicht
 * angebracht ist.
 */

const posten = (
  monat: string, soll: number, gezahlt = 0, id = "mv-1",
): OffenerPosten => ({
  mietverhaeltnis_id: id, kontakt_name: "Testmieter", einheit: "Zimmer 1",
  monat, soll, gezahlt,
});
const tag = (iso: string) => new Date(iso + "T12:00:00Z");

describe("Dritter Werktag", () => {
  test("November 2026: der 1. ist ein Sonntag", () => {
    // So 01., Mo 02., Di 03., Mi 04. -> dritter Werktag ist der 4.
    assert.equal(dritterWerktag(2026, 11).toISOString().slice(0, 10), "2026-11-04");
  });

  test("Januar: Neujahr zaehlt nicht mit", () => {
    // 2026: Do 01.01. (Feiertag), Fr 02., Sa/So, Mo 05., Di 06.
    assert.equal(dritterWerktag(2026, 1).toISOString().slice(0, 10), "2026-01-06");
  });

  test("ein Monat, der an einem Donnerstag beginnt", () => {
    // Oktober 2026: Do 01., Fr 02., Sa/So, Mo 05.
    assert.equal(dritterWerktag(2026, 10).toISOString().slice(0, 10), "2026-10-05");
  });

  test("Samstag ist kein Werktag fuer die Mietzahlung", () => {
    // BGH VIII ZR 129/09: Banken buchen samstags nicht gut.
    assert.equal(istWerktag(tag("2026-11-07")), false);
    assert.equal(istWerktag(tag("2026-11-08")), false);
    assert.equal(istWerktag(tag("2026-11-09")), true);
  });
});

describe("Keine Mahnung, wo keine hingehoert", () => {
  test("alles bezahlt ergibt gar keinen Eintrag", () => {
    assert.equal(stufeFuer([posten("2026-10-01", 580, 580)], 580, tag("2026-11-15")), null);
  });

  test("keine Posten ergibt gar keinen Eintrag", () => {
    assert.equal(stufeFuer([], 580, tag("2026-11-15")), null);
  });

  test("ein Rundungsrest unter einem Euro ist kein Rueckstand", () => {
    // Anteilige Monate erzeugen Cents. Ein Schreiben darueber beschaedigt
    // nur das Verhaeltnis.
    assert.equal(stufeFuer([posten("2026-10-01", 580, 579.97)], 580, tag("2026-11-15")), null);
  });

  test("vor der Faelligkeit ist nichts ueberfaellig", () => {
    // 2. November, faellig ist der 4.
    const r = stufeFuer([posten("2026-11-01", 580)], 580, tag("2026-11-02"));
    assert.equal(r?.stufe, "ok");
    assert.ok(r!.tage_ueberfaellig < 0);
  });

  test("am Faelligkeitstag selbst noch keine Erinnerung", () => {
    const r = stufeFuer([posten("2026-11-01", 580)], 580, tag("2026-11-04"));
    assert.equal(r?.stufe, "faellig");
    assert.equal(r?.tage_ueberfaellig, 0);
  });

  test("neun Tage Verzug: noch keine Erinnerung", () => {
    const r = stufeFuer([posten("2026-11-01", 580)], 580, tag("2026-11-13"));
    assert.equal(r?.stufe, "faellig");
    assert.equal(r?.tage_ueberfaellig, 9);
  });

  test("Teilzahlung unter einer Monatsmiete mahnt nicht, auch nach Monaten", () => {
    // Wer 480 statt 580 zahlt, bleibt sichtbar, bekommt aber kein Schreiben.
    const r = stufeFuer([posten("2026-08-01", 580, 480)], 580, tag("2026-11-30"));
    assert.equal(r?.stufe, "faellig");
    assert.equal(r?.offen, 100);
    assert.match(r!.begruendung, /unter einer Monatsmiete/);
  });
});

describe("Die Stufen", () => {
  test("zehn Tage Verzug: Zahlungserinnerung", () => {
    const r = stufeFuer([posten("2026-11-01", 580)], 580, tag("2026-11-14"));
    assert.equal(r?.stufe, "erinnerung");
    assert.equal(r?.tage_ueberfaellig, 10);
  });

  test("29 Tage: noch Erinnerung", () => {
    const r = stufeFuer([posten("2026-11-01", 580)], 580, tag("2026-12-03"));
    assert.equal(r?.stufe, "erinnerung");
  });

  test("30 Tage: Mahnung", () => {
    const r = stufeFuer([posten("2026-11-01", 580)], 580, tag("2026-12-04"));
    assert.equal(r?.stufe, "mahnung");
  });

  test("zwei Monatsmieten nennen § 543 BGB", () => {
    const r = stufeFuer(
      [posten("2026-09-01", 580), posten("2026-10-01", 580)],
      580, tag("2026-12-04"));
    assert.equal(r?.stufe, "mahnung");
    assert.equal(r?.offen, 1160);
    assert.match(r!.begruendung, /543/);
  });

  test("eine Monatsmiete nennt § 543 NICHT", () => {
    const r = stufeFuer([posten("2026-09-01", 580)], 580, tag("2026-12-04"));
    assert.equal(r?.stufe, "mahnung");
    assert.doesNotMatch(r!.begruendung, /543/);
  });

  test("der aelteste offene Monat bestimmt die Frist", () => {
    // Nicht der juengste: Sonst waere ein alter Rueckstand durch eine neue
    // Sollstellung immer wieder "frisch".
    const r = stufeFuer(
      [posten("2026-08-01", 580), posten("2026-11-01", 580)],
      580, tag("2026-11-15"));
    assert.equal(r?.aeltester_monat, "2026-08-01");
    assert.equal(r?.stufe, "mahnung");
  });

  test("bezahlte Monate zaehlen nicht zum aeltesten", () => {
    const r = stufeFuer(
      [posten("2026-08-01", 580, 580), posten("2026-11-01", 580)],
      580, tag("2026-11-14"));
    assert.equal(r?.aeltester_monat, "2026-11-01");
    assert.equal(r?.stufe, "erinnerung");
  });
});

describe("Sortierung nach Dringlichkeit", () => {
  test("Mahnung vor Erinnerung vor faellig", () => {
    const p: OffenerPosten[] = [
      { ...posten("2026-11-01", 580), mietverhaeltnis_id: "a", kontakt_name: "Anna" },
      { ...posten("2026-08-01", 580), mietverhaeltnis_id: "b", kontakt_name: "Bert" },
      { ...posten("2026-11-01", 100), mietverhaeltnis_id: "c", kontakt_name: "Cem" },
    ];
    const m = new Map([["a", 580], ["b", 580], ["c", 580]]);
    const r = rueckstaende(p, m, tag("2026-11-14"));
    assert.deepEqual(r.map((x) => x.stufe), ["mahnung", "erinnerung", "faellig"]);
    assert.deepEqual(r.map((x) => x.kontakt_name), ["Bert", "Anna", "Cem"]);
  });

  test("ohne hinterlegte Monatsmiete wird NIE gemahnt", () => {
    // Fehlt die Miete, ist die Schwelle 0 -- ohne Notbremse waere jeder
    // offene Cent sofort Mahngrund, und zwar ausgerechnet bei den
    // Mietverhaeltnissen, deren Betrag nicht belegt ist.
    const r = rueckstaende(
      [{ ...posten("2026-08-01", 580), mietverhaeltnis_id: "x" }],
      new Map(), tag("2026-11-14"));
    assert.equal(r.length, 1);
    assert.equal(r[0].monatsmiete, 0);
    assert.equal(r[0].stufe, "faellig");
    assert.match(r[0].begruendung, /nicht hinterlegt/);
  });

  test("auch nach einem Jahr ohne Miete keine Mahnung", () => {
    const r = rueckstaende(
      [{ ...posten("2025-08-01", 5000), mietverhaeltnis_id: "x" }],
      new Map(), tag("2026-11-14"));
    assert.equal(r[0].stufe, "faellig");
  });
});

/**
 * Monate ohne Kontodaten.
 *
 * Der Fall ist nicht theoretisch. Fuer Ludwigshafen wird ab Januar 2024
 * abgerechnet, das Volksbank-Konto gibt es aber erst ab 01.12.2024 -- die
 * Mieten davor flossen dem Voreigentuemer zu. Elf Monate stehen damit in
 * der Datenbank als offen, obwohl niemand etwas schuldet.
 *
 * Wuerde das Mahnwesen sie mitzaehlen, haette jeder langjaehrige Mieter
 * ueber zwanzig Monatsmieten Rueckstand und damit einen Kuendigungsgrund
 * nach § 543 Abs. 2 Nr. 3 BGB. Das waere der schlimmste Fehler, den dieses
 * Modul machen kann, und er traefe die Puenktlichen.
 */
const ohneDaten = (
  monat: string, soll: number, gezahlt = 0, id = "mv-1",
): OffenerPosten => ({ ...posten(monat, soll, gezahlt, id), ohne_zahlungsdaten: true });

describe("Monate ohne Kontodaten", () => {
  const elfMonate2024 = [
    "2024-01-01", "2024-02-01", "2024-03-01", "2024-04-01", "2024-05-01",
    "2024-06-01", "2024-07-01", "2024-08-01", "2024-09-01", "2024-10-01",
    "2024-11-01",
  ].map((m) => ohneDaten(m, 630));

  test("der Ludwigshafen-Fall mahnt nicht", () => {
    const r = stufeFuer(elfMonate2024, 630, tag("2026-11-15"));
    assert.equal(r?.stufe, "faellig");
    assert.equal(r?.offen, 0, "ungedeckte Monate duerfen nicht als Rueckstand zaehlen");
    assert.equal(r?.offen_ohne_daten, 6930);
    assert.equal(r?.monate_ohne_daten.length, 11);
    assert.match(r!.begruendung, /keine Auszüge/);
  });

  test("§ 543 wird dabei nicht ausgeloest", () => {
    // 6.930 EUR sind elf Monatsmieten. Ohne die Trennung waere das der
    // Kuendigungsgrund -- genau das darf hier nicht herauskommen.
    const r = stufeFuer(elfMonate2024, 630, tag("2026-11-15"));
    assert.notEqual(r?.stufe, "mahnung");
    assert.doesNotMatch(r!.begruendung, /543/);
  });

  test("ein echter Rueckstand von heute wird trotzdem gemahnt", () => {
    // Die Notbremse darf keine Generalamnestie sein: Wer 2024 ungeklaert
    // hat UND September 2026 nicht gezahlt hat, bekommt die Mahnung fuer
    // September -- aber nur ueber dessen Betrag.
    const r = stufeFuer(
      [...elfMonate2024, posten("2026-09-01", 630)], 630, tag("2026-11-15"),
    );
    assert.equal(r?.stufe, "mahnung");
    assert.equal(r?.offen, 630);
    assert.equal(r?.aeltester_monat, "2026-09-01");
    assert.equal(r?.offen_ohne_daten, 6930);
  });

  test("die ungeklaerten Monate stehen in der Begruendung der Mahnung", () => {
    // Wer freigibt, soll nicht ueber 630 EUR schreiben, ohne zu wissen,
    // dass daneben 6.930 EUR ungeklaert sind.
    const r = stufeFuer(
      [...elfMonate2024, posten("2026-09-01", 630)], 630, tag("2026-11-15"),
    );
    assert.match(r!.begruendung, /ohne Kontodaten/);
    assert.match(r!.begruendung, /nicht Teil dieser Forderung/);
  });

  test("§ 543 greift nur ueber den gedeckten Betrag", () => {
    // Zwei echte Monatsmieten offen -> der Hinweis gehoert hin.
    const r = stufeFuer(
      [...elfMonate2024, posten("2026-08-01", 630), posten("2026-09-01", 630)],
      630, tag("2026-11-15"),
    );
    assert.equal(r?.stufe, "mahnung");
    assert.equal(r?.offen, 1260);
    assert.match(r!.begruendung, /543/);
  });

  test("gedeckt nur Cents, ungedeckt viel: keine Mahnung", () => {
    const r = stufeFuer(
      [...elfMonate2024, posten("2026-09-01", 630, 629.98)], 630, tag("2026-11-15"),
    );
    assert.equal(r?.stufe, "faellig");
    assert.match(r!.begruendung, /keine Mahnung/);
  });

  test("ohne offene Posten ueberhaupt bleibt es null", () => {
    assert.equal(
      stufeFuer([ohneDaten("2024-05-01", 630, 630)], 630, tag("2026-11-15")),
      null,
    );
  });

  test("Mannheim: kein Konto, also nie eine Mahnung", () => {
    // objekt.zahlungsdaten_ab ist dort NULL, die Abfrage setzt das Flag
    // damit auf jedem Monat. Auch 2026 wird nicht gemahnt.
    const alle = ["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"]
      .map((m) => ohneDaten(m, 630));
    const r = stufeFuer(alle, 630, tag("2026-11-15"));
    assert.equal(r?.stufe, "faellig");
    assert.equal(r?.offen, 0);
    assert.notEqual(r?.stufe, "mahnung");
  });
});
