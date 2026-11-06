import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  entwirreMehrfachnutzung,
  imZeitfenster,
  zeitlicherWiderspruch,
  type BelegVorschlag,
} from "../lib/belegabgleich";

/**
 * Tests des Riegels gegen mehrfach genutzte Belege.
 *
 * Der Anlass ist echt: Am 06.11.2026 hing ein Zahlungsnachweis ueber
 * 16,99 EUR an vier Abbuchungen von je 16,99 EUR. Der Abgleich laedt
 * die offenen Belege einmal; innerhalb eines Laufs sank das Feld
 * `offen` nicht mit, und so war derselbe Beleg viermal "sicher".
 *
 * Alle Kennungen hier sind erfunden.
 */

function vor(
  buchung: string,
  beleg: string | null,
  sicherheit: "sicher" | "unsicher" = "sicher",
  weitere?: Array<{ beleg_id: string; betrag: number }>,
): BelegVorschlag {
  return {
    buchung_id: buchung,
    beleg_id: beleg,
    betrag: 16.99,
    sicherheit,
    begruendung: "Aussteller erkannt und Betrag stimmt auf den Cent.",
    ...(weitere ? { weitere } : {}),
  };
}

const tage = (p: Array<[string, string | null]>) => new Map(p);

describe("Ein Beleg, mehrere Abbuchungen", () => {
  test("die naechstliegende Abbuchung gewinnt, die anderen werden unsicher", () => {
    const v = entwirreMehrfachnutzung(
      [vor("b-fern", "beleg-1"), vor("b-nah", "beleg-1")],
      tage([
        ["b-fern", "2026-03-10"],
        ["b-nah", "2026-02-27"],
      ]),
      tage([["beleg-1", "2026-02-25"]]),
    );
    const nah = v.find((x) => x.buchung_id === "b-nah")!;
    const fern = v.find((x) => x.buchung_id === "b-fern")!;
    assert.equal(nah.sicherheit, "sicher");
    assert.equal(fern.sicherheit, "unsicher");
    assert.match(fern.begruendung, /anderen Abbuchung/);
  });

  test("der Beleg bleibt genau einmal sicher, auch bei vier Anspruechen", () => {
    const v = entwirreMehrfachnutzung(
      [
        vor("b1", "beleg-1"),
        vor("b2", "beleg-1"),
        vor("b3", "beleg-1"),
        vor("b4", "beleg-1"),
      ],
      tage([
        ["b1", "2026-03-10"],
        ["b2", "2026-03-10"],
        ["b3", "2026-03-10"],
        ["b4", "2026-02-27"],
      ]),
      tage([["beleg-1", "2026-02-25"]]),
    );
    assert.equal(v.filter((x) => x.sicherheit === "sicher").length, 1);
    assert.equal(v.find((x) => x.sicherheit === "sicher")!.buchung_id, "b4");
  });

  test("kein Vorschlag geht verloren", () => {
    const v = entwirreMehrfachnutzung(
      [vor("b1", "beleg-1"), vor("b2", "beleg-1"), vor("b3", "beleg-2")],
      tage([
        ["b1", "2026-03-10"],
        ["b2", "2026-02-27"],
        ["b3", "2026-02-27"],
      ]),
      tage([
        ["beleg-1", "2026-02-25"],
        ["beleg-2", "2026-02-26"],
      ]),
    );
    assert.equal(v.length, 3);
    assert.deepEqual(
      v.map((x) => x.buchung_id).sort(),
      ["b1", "b2", "b3"],
    );
  });

  test("verschiedene Belege bleiben unangetastet", () => {
    const v = entwirreMehrfachnutzung(
      [vor("b1", "beleg-1"), vor("b2", "beleg-2")],
      tage([
        ["b1", "2026-02-27"],
        ["b2", "2026-02-27"],
      ]),
      tage([
        ["beleg-1", "2026-02-25"],
        ["beleg-2", "2026-02-25"],
      ]),
    );
    assert.equal(v.filter((x) => x.sicherheit === "sicher").length, 2);
  });

  test("ein unsicherer Vorschlag beansprucht nichts", () => {
    // Unsichere Vorschlaege werden nicht festgeschrieben. Sie duerfen
    // einem sicheren Treffer den Beleg nicht wegnehmen.
    const v = entwirreMehrfachnutzung(
      [vor("b1", "beleg-1", "unsicher"), vor("b2", "beleg-1")],
      tage([
        ["b1", "2026-02-26"],
        ["b2", "2026-03-05"],
      ]),
      tage([["beleg-1", "2026-02-25"]]),
    );
    assert.equal(v.find((x) => x.buchung_id === "b2")!.sicherheit, "sicher");
  });

  test("ohne Datum entscheidet die Kennung, aber nur einer gewinnt", () => {
    const v = entwirreMehrfachnutzung(
      [vor("b-zweiter", "beleg-1"), vor("b-erster", "beleg-1")],
      tage([
        ["b-zweiter", null],
        ["b-erster", null],
      ]),
      tage([["beleg-1", null]]),
    );
    assert.equal(v.filter((x) => x.sicherheit === "sicher").length, 1);
    assert.equal(
      v.find((x) => x.sicherheit === "sicher")!.buchung_id,
      "b-erster",
    );
  });

  test("zwei Laeufe liefern dasselbe Ergebnis", () => {
    const eingabe: BelegVorschlag[] = [
      vor("b-y", "beleg-1"),
      vor("b-x", "beleg-1"),
    ];
    const karten = [
      tage([
        ["b-y", "2026-03-01"],
        ["b-x", "2026-03-01"],
      ]),
      tage([["beleg-1", "2026-02-25"]]),
    ] as const;
    const a = entwirreMehrfachnutzung(eingabe, karten[0], karten[1]);
    const b = entwirreMehrfachnutzung([...eingabe].reverse(), karten[0], karten[1]);
    assert.equal(
      a.find((x) => x.sicherheit === "sicher")!.buchung_id,
      b.find((x) => x.sicherheit === "sicher")!.buchung_id,
    );
  });

  test("eine doppelte Teillieferung faellt aus weitere heraus, der Haupttreffer bleibt", () => {
    const v = entwirreMehrfachnutzung(
      [
        vor("b1", "haupt-1", "sicher", [{ beleg_id: "teil-1", betrag: 5 }]),
        vor("b2", "teil-1"),
      ],
      tage([
        ["b1", "2026-03-20"],
        ["b2", "2026-02-27"],
      ]),
      tage([
        ["haupt-1", "2026-03-18"],
        ["teil-1", "2026-02-25"],
      ]),
    );
    const eins = v.find((x) => x.buchung_id === "b1")!;
    assert.equal(eins.sicherheit, "sicher");
    assert.equal(eins.beleg_id, "haupt-1");
    assert.deepEqual(eins.weitere, []);
    assert.equal(v.find((x) => x.buchung_id === "b2")!.sicherheit, "sicher");
  });

  test("die Eingabe wird nicht verändert", () => {
    const eingabe = [vor("b1", "beleg-1"), vor("b2", "beleg-1")];
    entwirreMehrfachnutzung(
      eingabe,
      tage([
        ["b1", "2026-03-10"],
        ["b2", "2026-02-27"],
      ]),
      tage([["beleg-1", "2026-02-25"]]),
    );
    assert.deepEqual(
      eingabe.map((x) => x.sicherheit),
      ["sicher", "sicher"],
    );
  });

  test("ein Beleg ohne Kennung stört nicht", () => {
    const v = entwirreMehrfachnutzung(
      [vor("b1", null), vor("b2", null)],
      tage([["b1", "2026-03-10"], ["b2", "2026-02-27"]]),
      tage([]),
    );
    assert.equal(v.length, 2);
    assert.equal(v.filter((x) => x.sicherheit === "sicher").length, 2);
  });
});

describe("Zeitfenster als Riegel vor Regel 2", () => {
  test("eine Abbuchung vor dem Belegdatum ist kein sicherer Treffer", () => {
    // Der echte Fall: Quittung vom 17.03.2026, Abbuchungen vom
    // 14.01. und 27.01.2026. Was im Maerz ausgestellt wurde, kann im
    // Januar nicht bezahlt worden sein.
    assert.equal(imZeitfenster("2026-03-17", "2026-01-14"), false);
    assert.equal(imZeitfenster("2026-03-17", "2026-01-27"), false);
    assert.match(
      zeitlicherWiderspruch("2026-03-17", "2026-01-14")!,
      /62 Tage vor dem Belegdatum/,
    );
  });

  test("zwei Tage Vorlauf bleiben erlaubt", () => {
    // Ein Abonnement bucht am Monatsersten und datiert die Rechnung
    // auf den Zweiten.
    assert.equal(imZeitfenster("2026-03-02", "2026-03-01"), true);
    assert.equal(imZeitfenster("2026-03-03", "2026-03-01"), true);
    assert.equal(imZeitfenster("2026-03-04", "2026-03-01"), false);
  });

  test("45 Tage Nachlauf bleiben erlaubt, 46 nicht", () => {
    assert.equal(imZeitfenster("2026-01-01", "2026-02-15"), true);
    assert.equal(imZeitfenster("2026-01-01", "2026-02-16"), false);
  });

  test("ohne Datum wird nichts ausgeschlossen", () => {
    assert.equal(imZeitfenster(null, "2026-03-01"), true);
    assert.equal(imZeitfenster("2026-03-01", null), true);
    assert.equal(zeitlicherWiderspruch(null, "2026-03-01"), null);
  });

  test("im Fenster gibt es keinen Widerspruch zu nennen", () => {
    assert.equal(zeitlicherWiderspruch("2026-03-01", "2026-03-05"), null);
  });
});
