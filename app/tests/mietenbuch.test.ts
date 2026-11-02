import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  addiereSummen,
  baueRaster,
  baueZelle,
  etagenRang,
  giltImMonat,
  kalenderjahr,
  letzteMonate,
  monatPlus,
  monatsAnfang,
  monatsEnde,
  ohneZahlungsdaten,
  sollLautVertrag,
  summiere,
  vergleicheEinheiten,
  zeitraumFuer,
  type AnpassungZeile,
  type EinheitZeile,
  type MietverhaeltnisZeile,
  type SollZeile,
  type Zelle,
} from "../lib/mietenbuch";

/**
 * Tests fuer das Mietenbuch.
 *
 * Alle Namen und Betraege hier sind erfunden. Echte Mieternamen gehoeren
 * nicht in Testdaten -- diese Dateien werden gelesen, kopiert und
 * weitergegeben.
 *
 * Die teuren Fehler dieses Rasters sind nicht Rechenfehler, sondern
 * Verwechslungen. Drei Zustaende sehen gleich aus und bedeuten das
 * Gegenteil voneinander:
 *
 *   Leerstand          niemand wohnt da       -> kein Geld zu erwarten
 *   nicht abgeglichen  keine Kontoauszuege    -> unbekannt, kein Vorwurf
 *   offen              faellig und nicht da   -> Rueckstand
 *
 * Wer den zweiten als dritten anzeigt, stellt einem Mieter, der seit
 * achtzehn Jahren puenktlich zahlt, zwanzig Monatsmieten in Rechnung.
 * Deshalb pruefen diese Tests vor allem, dass "offen" NICHT entsteht, wo es
 * nicht hingehoert.
 */

const HEUTE = new Date("2026-11-02T12:00:00Z");

function einheit(ueber: Partial<EinheitZeile> = {}): EinheitZeile {
  return {
    id: "e-1",
    objekt_id: "o-1",
    objekt_name: "Teststraße 1",
    zahlungsdaten_ab: "2025-01-01",
    bezeichnung: "Zimmer 1",
    schluessel: "t1-z1",
    etage: "1. OG",
    art: "wohnen",
    eltern_id: null,
    eltern_bezeichnung: null,
    hat_kinder: false,
    vermarktung: "anbieten",
    belegung_gepflegt: true,
    ...ueber,
  };
}

function vertrag(ueber: Partial<MietverhaeltnisZeile> = {}): MietverhaeltnisZeile {
  return {
    id: "mv-1",
    einheit_id: "e-1",
    kontakt_name: "A. Beispiel",
    beginn: "2024-01-01",
    ende: null,
    kaltmiete: "400.00",
    nebenkosten: "100.00",
    moeblierungszuschlag: "80.00",
    gesamtmiete: null,
    kaution: "1200.00",
    ...ueber,
  };
}

function gestellt(zeilen: SollZeile[]): Map<string, SollZeile> {
  return new Map(zeilen.map((z) => [`${z.mietverhaeltnis_id}|${z.monat}`, z]));
}

function sollZeile(
  mietverhaeltnis_id: string,
  monat: string,
  betrag: string,
  gezahlt: string | null = null,
  gezahlt_am: string | null = null,
): SollZeile {
  return { mietverhaeltnis_id, monat, betrag, gezahlt, gezahlt_am };
}

/** Eine Zelle mit den ueblichen Vorgaben; nur das Abweichende wird genannt. */
function zelle(o: {
  monat: string;
  einheit?: EinheitZeile;
  vertraege?: MietverhaeltnisZeile[];
  anpassungen?: AnpassungZeile[];
  soll?: SollZeile[];
  eltern_belegt?: boolean;
  buchungen?: boolean;
  heute?: Date;
}): Zelle {
  const e = o.einheit ?? einheit();
  const alle = o.vertraege ?? [vertrag()];
  return baueZelle({
    monat: o.monat,
    einheit: e,
    mietverhaeltnisse: alle.filter((mv) => giltImMonat(mv, o.monat)),
    anpassungen: o.anpassungen ?? [],
    gestellt: gestellt(o.soll ?? []),
    eltern_belegt: o.eltern_belegt ?? false,
    buchungen_vorhanden: o.buchungen ?? true,
    heute: o.heute ?? HEUTE,
  });
}

// ---------------------------------------------------------------------------

describe("Zeitachse", () => {
  test("Monatsende trifft auch den Februar im Schaltjahr", () => {
    assert.equal(monatsEnde("2024-02-01"), "2024-02-29");
    assert.equal(monatsEnde("2025-02-01"), "2025-02-28");
    assert.equal(monatsEnde("2026-11-01"), "2026-11-30");
    // Auch aus einem Tag mitten im Monat.
    assert.equal(monatsEnde("2026-12-17"), "2026-12-31");
  });

  test("Monatsanfang schneidet den Tag weg", () => {
    assert.equal(monatsAnfang("2026-11-30"), "2026-11-01");
    assert.equal(monatsAnfang("2025-07-31"), "2025-07-01");
  });

  test("Monatssprung ueber den Jahreswechsel", () => {
    assert.equal(monatPlus("2026-01-01", -1), "2025-12-01");
    assert.equal(monatPlus("2026-12-01", 2), "2027-02-01");
  });

  test("die letzten zwoelf Monate enden im laufenden Monat", () => {
    const m = letzteMonate(HEUTE, 12);
    assert.equal(m.length, 12);
    assert.equal(m[0], "2025-12-01");
    assert.equal(m[11], "2026-11-01");
    // Aufsteigend: ein Hausbuch liest sich von links nach rechts.
    assert.deepEqual([...m].sort(), m);
  });

  test("ein Kalenderjahr hat zwoelf Monatserste", () => {
    const m = kalenderjahr(2025);
    assert.equal(m.length, 12);
    assert.equal(m[0], "2025-01-01");
    assert.equal(m[11], "2025-12-01");
  });

  test("ohne Jahr zeigt die Seite die letzten zwoelf Monate", () => {
    assert.equal(zeitraumFuer(null, HEUTE).monate.length, 12);
    assert.equal(zeitraumFuer(null, HEUTE).monate[11], "2026-11-01");
    assert.equal(zeitraumFuer(2024, HEUTE).monate[0], "2024-01-01");
  });
});

describe("Gilt ein Mietverhaeltnis in diesem Monat?", () => {
  test("laufendes Mietverhaeltnis ohne Ende", () => {
    assert.equal(giltImMonat({ beginn: "2024-01-01", ende: null }, "2026-11-01"), true);
  });

  test("Einzug mitten im Monat gilt im ganzen Monat", () => {
    // Der 20. ist im Juni; der Monat gehoert zur Belegung, auch wenn nur
    // elf Tage davon bezahlt werden.
    assert.equal(giltImMonat({ beginn: "2026-06-20", ende: null }, "2026-06-01"), true);
    assert.equal(giltImMonat({ beginn: "2026-06-20", ende: null }, "2026-05-01"), false);
  });

  test("Auszug mitten im Monat gilt im ganzen Monat", () => {
    assert.equal(giltImMonat({ beginn: "2024-01-01", ende: "2026-06-14" }, "2026-06-01"), true);
    assert.equal(giltImMonat({ beginn: "2024-01-01", ende: "2026-06-14" }, "2026-07-01"), false);
  });

  test("Ende am Monatsersten zaehlt noch", () => {
    assert.equal(giltImMonat({ beginn: "2024-01-01", ende: "2026-06-01" }, "2026-06-01"), true);
  });

  test("Beginn am Monatsletzten zaehlt schon", () => {
    assert.equal(giltImMonat({ beginn: "2026-06-30", ende: null }, "2026-06-01"), true);
  });
});

describe("Der Sollbetrag kommt aus der Zeitachse, nicht aus heute", () => {
  const anpassung = (
    gilt_ab: string,
    ueber: Partial<AnpassungZeile> = {},
  ): AnpassungZeile => ({
    mietverhaeltnis_id: "mv-1",
    gilt_ab,
    kaltmiete: null,
    nebenkosten: null,
    moeblierungszuschlag: null,
    gesamtmiete: "630.00",
    ...ueber,
  });

  test("ohne Anpassung gelten die Werte am Mietverhaeltnis", () => {
    const r = sollLautVertrag(vertrag(), [], "2026-06-01");
    // 400 + 100 + 80 -- der Moeblierungszuschlag zaehlt mit.
    assert.equal(r.betrag, 580);
    assert.equal(r.quelle, "mietverhaeltnis");
  });

  test("die zugesagte Gesamtmiete schlaegt die Summe der Posten", () => {
    const r = sollLautVertrag(vertrag({ gesamtmiete: "600.00" }), [], "2026-06-01");
    assert.equal(r.betrag, 600);
  });

  test("eine Anpassung mitten im Zeitraum greift ab ihrem Monat", () => {
    const a = [anpassung("2026-07-01")];
    // Das ist der Fehler aus db/022: Ohne Zeitachse bekaeme auch der Juni
    // schon 630 -- und rueckwirkend jeder Monat seit 2024.
    assert.equal(sollLautVertrag(vertrag(), a, "2026-06-01").betrag, 580);
    assert.equal(sollLautVertrag(vertrag(), a, "2026-07-01").betrag, 630);
    assert.equal(sollLautVertrag(vertrag(), a, "2026-08-01").quelle, "anpassung");
  });

  test("von zwei Anpassungen gewinnt die juengste, die schon gilt", () => {
    const a = [anpassung("2024-01-01", { gesamtmiete: "500.00" }), anpassung("2026-07-01")];
    assert.equal(sollLautVertrag(vertrag(), a, "2026-06-01").betrag, 500);
    assert.equal(sollLautVertrag(vertrag(), a, "2026-07-01").betrag, 630);
  });

  test("eine Anpassung mitten im Monat gilt erst im Folgemonat", () => {
    // Verglichen wird gegen den Monatsersten -- dieselbe Regel wie in
    // lib/rueckstaende.ts (date_trunc('month', CURRENT_DATE)).
    const a = [anpassung("2026-07-15")];
    assert.equal(sollLautVertrag(vertrag(), a, "2026-07-01").betrag, 580);
    assert.equal(sollLautVertrag(vertrag(), a, "2026-08-01").betrag, 630);
  });

  test("Anpassung aus Einzelposten wird addiert", () => {
    const a = [
      anpassung("2026-07-01", {
        gesamtmiete: null,
        kaltmiete: "450.00",
        nebenkosten: "110.00",
        moeblierungszuschlag: "90.00",
      }),
    ];
    assert.equal(sollLautVertrag(vertrag(), a, "2026-07-01").betrag, 650);
  });

  test("Anpassungen anderer Mietverhaeltnisse wirken nicht", () => {
    const a = [anpassung("2024-01-01", { mietverhaeltnis_id: "mv-fremd", gesamtmiete: "9999.00" })];
    assert.equal(sollLautVertrag(vertrag(), a, "2026-06-01").betrag, 580);
  });
});

describe("Kontodaten: was unbekannt ist, ist nicht unbezahlt", () => {
  test("ohne Datum am Objekt ist jeder Monat unabgeglichen", () => {
    // Augartenstraße 91 hat kein eigenes Konto. Dort darf nie gemahnt werden.
    assert.equal(ohneZahlungsdaten("2026-10-01", null, true), true);
  });

  test("ohne eingelesene Buchungen ist jeder Monat unabgeglichen", () => {
    assert.equal(ohneZahlungsdaten("2026-10-01", "2024-01-01", false), true);
  });

  test("Monate vor dem Kontobeginn sind unabgeglichen", () => {
    // Welserstraße 10: Kontodaten ab 31.07.2025, abgerechnet ab 01.01.2024.
    assert.equal(ohneZahlungsdaten("2025-06-01", "2025-07-31", true), true);
    assert.equal(ohneZahlungsdaten("2024-01-01", "2025-07-31", true), true);
  });

  test("der Monat des Kontobeginns zaehlt als abgeglichen", () => {
    // Dieselbe Grenze wie in lib/mieter.ts: date_trunc auf den Monat.
    assert.equal(ohneZahlungsdaten("2025-07-01", "2025-07-31", true), false);
    assert.equal(ohneZahlungsdaten("2026-10-01", "2025-07-31", true), false);
  });
});

describe("Hausordnung", () => {
  test("Etagen von unten nach oben, Unbekanntes zuletzt", () => {
    const r = ["3. OG", "EG", "DG", "1. OG", "EG/UG", null, "2. OG"].map(etagenRang);
    assert.deepEqual(
      ["3. OG", "EG", "DG", "1. OG", "EG/UG", null, "2. OG"]
        .map((e, i) => ({ e, r: r[i] }))
        .sort((a, b) => a.r - b.r)
        .map((x) => x.e),
      ["EG/UG", "EG", "1. OG", "2. OG", "3. OG", "DG", null],
    );
  });

  test("Zimmer 2 steht vor Zimmer 10", () => {
    const liste = [
      einheit({ id: "a", bezeichnung: "Zimmer 10" }),
      einheit({ id: "b", bezeichnung: "Zimmer 2" }),
      einheit({ id: "c", bezeichnung: "5er-WG 1. OG", art: "gemeinschaft" }),
    ];
    assert.deepEqual(
      liste.slice().sort(vergleicheEinheiten).map((e) => e.bezeichnung),
      ["5er-WG 1. OG", "Zimmer 2", "Zimmer 10"],
    );
  });

  test("die Etage schlaegt die Bezeichnung", () => {
    const a = einheit({ id: "a", bezeichnung: "Zimmer 9", etage: "EG" });
    const b = einheit({ id: "b", bezeichnung: "Zimmer 1", etage: "3. OG" });
    assert.ok(vergleicheEinheiten(a, b) < 0);
  });
});

// ---------------------------------------------------------------------------

describe("Eine Zelle: bezahlt, teilweise, offen", () => {
  test("gedeckter Monat ist bezahlt", () => {
    const z = zelle({
      monat: "2026-09-01",
      soll: [sollZeile("mv-1", "2026-09-01", "580.00", "580.00", "2026-09-02")],
    });
    assert.equal(z.status, "bezahlt");
    assert.equal(z.soll, 580);
    assert.equal(z.gezahlt, 580);
    assert.equal(z.abschnitte[0].quelle, "sollstellung");
  });

  test("Teilzahlung mit Kontodaten ist teilweise", () => {
    const z = zelle({
      monat: "2026-09-01",
      soll: [sollZeile("mv-1", "2026-09-01", "580.00", "400.00", "2026-09-02")],
    });
    assert.equal(z.status, "teilweise");
    assert.equal(z.gezahlt, 400);
  });

  test("faelliger Monat ohne Zahlung ist offen", () => {
    const z = zelle({
      monat: "2026-09-01",
      soll: [sollZeile("mv-1", "2026-09-01", "580.00")],
    });
    assert.equal(z.status, "offen");
  });

  test("Centreste sind kein Rueckstand", () => {
    const z = zelle({
      monat: "2026-09-01",
      soll: [sollZeile("mv-1", "2026-09-01", "580.00", "579.97", "2026-09-02")],
    });
    assert.equal(z.status, "bezahlt");
  });
});

describe("Monate vor dem Kontobeginn sind nie offen", () => {
  const w = einheit({ zahlungsdaten_ab: "2025-07-31" });

  test("ohne Zahlung: nicht abgeglichen statt offen", () => {
    const z = zelle({
      monat: "2025-03-01",
      einheit: w,
      soll: [sollZeile("mv-1", "2025-03-01", "630.00")],
    });
    assert.equal(z.status, "nicht_abgeglichen");
    assert.notEqual(z.status, "offen");
  });

  test("mit Teilzahlung: nicht abgeglichen statt teilweise", () => {
    // Der Fall, den ein Test ohne Teilzahlung nicht findet: Dort kommt
    // zufaellig dasselbe heraus. "400 von 630" wuerde hier behaupten, es
    // fehlten 230 Euro -- und niemand weiss das, weil der Auszug fehlt.
    const z = zelle({
      monat: "2025-03-01",
      einheit: w,
      soll: [sollZeile("mv-1", "2025-03-01", "630.00", "400.00", "2025-03-04")],
    });
    assert.equal(z.status, "nicht_abgeglichen");
  });

  test("eine gedeckte Zahlung bleibt bezahlt, auch ohne Kontodaten", () => {
    // Eine zugeordnete Zahlung ist eine Tatsache. Sie hinter "nicht
    // abgeglichen" zu verstecken, verschweigt einen Beleg.
    const z = zelle({
      monat: "2025-03-01",
      einheit: w,
      soll: [sollZeile("mv-1", "2025-03-01", "630.00", "630.00", "2025-03-04")],
    });
    assert.equal(z.status, "bezahlt");
  });

  test("ohne jede eingelesene Buchung ist auch der Vormonat unabgeglichen", () => {
    const z = zelle({
      monat: "2026-10-01",
      buchungen: false,
      soll: [sollZeile("mv-1", "2026-10-01", "580.00")],
    });
    assert.equal(z.status, "nicht_abgeglichen");
  });
});

describe("Zukunft und laufender Monat", () => {
  test("der laufende Monat ist vor dem dritten Werktag nicht faellig", () => {
    // 01.11.2026 ist ein Sonntag, dritter Werktag also der 4. -- am 2. ist
    // niemand in Verzug.
    const z = zelle({
      monat: "2026-11-01",
      soll: [sollZeile("mv-1", "2026-11-01", "580.00")],
    });
    assert.equal(z.status, "nicht_faellig");
  });

  test("ein kuenftiger Monat ohne Sollstellung ist nicht faellig", () => {
    const z = zelle({ monat: "2026-12-01" });
    assert.equal(z.status, "nicht_faellig");
    assert.equal(z.soll, 580);
    assert.equal(z.abschnitte[0].quelle, "mietverhaeltnis");
  });

  test("ein kuenftiger Monat nimmt die Anpassung, die dann gilt", () => {
    const z = zelle({
      monat: "2026-12-01",
      anpassungen: [
        {
          mietverhaeltnis_id: "mv-1",
          gilt_ab: "2026-12-01",
          kaltmiete: null,
          nebenkosten: null,
          moeblierungszuschlag: null,
          gesamtmiete: "650.00",
        },
      ],
    });
    assert.equal(z.soll, 650);
    assert.equal(z.abschnitte[0].quelle, "anpassung");
  });

  test("ein vergangener Monat ohne Sollstellung ist nicht offen", () => {
    // Altmietverhaeltnisse vor `abrechnung_ab`: Es wurde nichts gestellt,
    // also ist nichts gefordert. "offen" waere hier eine Erfindung.
    const z = zelle({ monat: "2026-09-01" });
    assert.equal(z.status, "nicht_abgeglichen");
    assert.notEqual(z.status, "offen");
  });

  test("ohne hinterlegte Miete wird nichts behauptet", () => {
    // Weder "bezahlt" (ein Soll von 0 ist immer gedeckt) noch "offen".
    const z = zelle({
      monat: "2026-09-01",
      vertraege: [
        vertrag({ kaltmiete: null, nebenkosten: null, moeblierungszuschlag: null }),
      ],
    });
    assert.equal(z.status, "nicht_abgeglichen");
    assert.equal(z.soll, 0);
    assert.equal(z.abschnitte[0].miete_unbekannt, true);
  });
});

describe("Mieterwechsel mitten im Monat", () => {
  const alt = vertrag({ id: "mv-alt", kontakt_name: "A. Beispiel", ende: "2026-06-14" });
  const neu = vertrag({
    id: "mv-neu",
    kontakt_name: "B. Muster",
    beginn: "2026-06-15",
    gesamtmiete: "660.00",
    kaltmiete: null,
    nebenkosten: null,
    moeblierungszuschlag: null,
  });

  test("beide Mietverhaeltnisse stehen in der Zelle, in ihrer Reihenfolge", () => {
    const z = zelle({
      monat: "2026-06-01",
      vertraege: [neu, alt],
      soll: [
        sollZeile("mv-alt", "2026-06-01", "270.67", "270.67", "2026-06-02"),
        sollZeile("mv-neu", "2026-06-01", "352.00"),
      ],
    });
    assert.equal(z.abschnitte.length, 2);
    assert.deepEqual(
      z.abschnitte.map((a) => a.mietverhaeltnis_id),
      ["mv-alt", "mv-neu"],
    );
    assert.equal(z.abschnitte[0].bis, "2026-06-14");
    assert.equal(z.abschnitte[1].ab, "2026-06-15");
    assert.equal(z.soll, 622.67);
    assert.equal(z.gezahlt, 270.67);
  });

  test("das Offene gewinnt die Farbe der Zelle", () => {
    // Sonst verschwindet der Rueckstand des Nachmieters hinter der
    // bezahlten Haelfte des Vormieters.
    const z = zelle({
      monat: "2026-06-01",
      vertraege: [alt, neu],
      soll: [
        sollZeile("mv-alt", "2026-06-01", "270.67", "270.67", "2026-06-02"),
        sollZeile("mv-neu", "2026-06-01", "352.00"),
      ],
    });
    assert.equal(z.status, "offen");
    assert.equal(z.abschnitte[0].status, "bezahlt");
    assert.equal(z.abschnitte[1].status, "offen");
  });

  test("anteilige Monate werden nicht aufgeteilt", () => {
    // Gestellt sind 270,67 Euro; die Kaltmiete von 400 Euro daneben zu
    // schreiben, waere eine Zahl, die es nie gab.
    const z = zelle({
      monat: "2026-06-01",
      vertraege: [alt],
      soll: [sollZeile("mv-alt", "2026-06-01", "270.67", "270.67", "2026-06-02")],
    });
    assert.equal(z.abschnitte[0].kaltmiete, null);
    assert.equal(z.abschnitte[0].nebenkosten, null);
  });

  test("ein voller Monat behaelt seine Aufteilung", () => {
    const z = zelle({
      monat: "2026-09-01",
      soll: [sollZeile("mv-1", "2026-09-01", "580.00", "580.00", "2026-09-02")],
    });
    assert.equal(z.abschnitte[0].kaltmiete, 400);
    assert.equal(z.abschnitte[0].nebenkosten, 100);
  });
});

describe("Leerstand ist kein Rueckstand", () => {
  test("ohne Mietverhaeltnis ist die Zelle leer, nicht offen", () => {
    const z = zelle({ monat: "2026-09-01", vertraege: [] });
    assert.equal(z.status, "leer");
    assert.equal(z.leer_grund, "frei");
    assert.equal(z.soll, 0);
    assert.equal(z.abschnitte.length, 0);
  });

  test("belegt ueber den Vertrag der Etage ist kein Leerstand", () => {
    // Im 2. OG laeuft ein Altmietverhaeltnis ueber fuenf Zimmer. Ohne
    // diesen Fall stuenden sie fuenfmal als Leerstand im Buch.
    const z = zelle({ monat: "2026-09-01", vertraege: [], eltern_belegt: true });
    assert.equal(z.status, "leer");
    assert.equal(z.leer_grund, "eltern");
  });

  test("ungepflegte Belegung heisst nicht erfasst, nicht frei", () => {
    const z = zelle({
      monat: "2026-09-01",
      vertraege: [],
      einheit: einheit({ belegung_gepflegt: false }),
    });
    assert.equal(z.leer_grund, "unbekannt");
  });

  test("was nicht angeboten wird, steht nicht leer", () => {
    const z = zelle({
      monat: "2026-09-01",
      vertraege: [],
      einheit: einheit({ art: "gewerbe", vermarktung: "nicht_anbieten" }),
    });
    assert.equal(z.leer_grund, "nicht_vermietbar");
  });
});

// ---------------------------------------------------------------------------

describe("Summen", () => {
  const immerVermietbar = () => true;

  test("die Abweichung rechnet nur vergleichbare Monate gegen", () => {
    const zellen = [
      // faellig und abgeglichen: 580 gestellt, 400 angekommen -> -180
      zelle({
        monat: "2026-09-01",
        soll: [sollZeile("mv-1", "2026-09-01", "580.00", "400.00", "2026-09-02")],
      }),
      // ohne Kontodaten: 630 unbekannt -- darf die Abweichung nicht beruehren
      zelle({
        monat: "2025-03-01",
        einheit: einheit({ zahlungsdaten_ab: "2025-07-31" }),
        soll: [sollZeile("mv-1", "2025-03-01", "630.00")],
      }),
      // noch nicht faellig: 580 erwartet, aber kein Vorwurf
      zelle({
        monat: "2026-11-01",
        soll: [sollZeile("mv-1", "2026-11-01", "580.00")],
      }),
    ];
    const s = summiere(zellen, immerVermietbar);

    assert.equal(s.soll, 1790);
    assert.equal(s.ist, 400);
    assert.equal(s.soll_vergleich, 580);
    assert.equal(s.abweichung, -180);
    assert.equal(s.soll_ohne_daten, 630);
    assert.equal(s.soll_nicht_faellig, 580);
  });

  test("ein voll bezahlter Zeitraum hat keine Abweichung", () => {
    const s = summiere(
      [
        zelle({
          monat: "2026-09-01",
          soll: [sollZeile("mv-1", "2026-09-01", "580.00", "580.00", "2026-09-02")],
        }),
      ],
      immerVermietbar,
    );
    assert.equal(s.abweichung, 0);
  });

  test("Leerstandsquote zaehlt nur echten Leerstand", () => {
    const zellen = [
      zelle({ monat: "2026-07-01", vertraege: [] }),
      zelle({ monat: "2026-08-01", vertraege: [], eltern_belegt: true }),
      zelle({
        monat: "2026-09-01",
        soll: [sollZeile("mv-1", "2026-09-01", "580.00", "580.00", "2026-09-02")],
      }),
      zelle({
        monat: "2026-10-01",
        soll: [sollZeile("mv-1", "2026-10-01", "580.00", "580.00", "2026-10-02")],
      }),
    ];
    const s = summiere(zellen, immerVermietbar);
    assert.equal(s.monate_leer, 1);
    assert.equal(s.monate_belegt, 2);
    assert.equal(s.monate_vermietbar, 4);
    assert.equal(s.leerstandsquote, 0.25);
  });

  test("nicht vermietbare Einheiten treiben die Quote nicht hoch", () => {
    const s = summiere([zelle({ monat: "2026-09-01", vertraege: [] })], () => false);
    assert.equal(s.monate_vermietbar, 0);
    assert.equal(s.leerstandsquote, null);
  });

  test("Aufteilung in Kalt und Betriebskosten, Rest getrennt", () => {
    const s = summiere(
      [
        zelle({
          monat: "2026-09-01",
          soll: [sollZeile("mv-1", "2026-09-01", "580.00", "580.00", "2026-09-02")],
        }),
      ],
      immerVermietbar,
    );
    assert.equal(s.kaltmiete, 400);
    assert.equal(s.nebenkosten, 100);
    // Der Moeblierungszuschlag ist Teil des Solls, aber weder Kalt noch BK.
    assert.equal(s.nicht_aufgeteilt, 80);
  });

  test("Inklusivmiete ohne Aufteilung landet vollstaendig im Rest", () => {
    const s = summiere(
      [
        zelle({
          monat: "2026-09-01",
          vertraege: [
            vertrag({
              kaltmiete: null,
              nebenkosten: null,
              moeblierungszuschlag: null,
              gesamtmiete: "660.00",
            }),
          ],
          soll: [sollZeile("mv-1", "2026-09-01", "660.00", "660.00", "2026-09-02")],
        }),
      ],
      immerVermietbar,
    );
    assert.equal(s.kaltmiete, 0);
    assert.equal(s.nicht_aufgeteilt, 660);
  });

  test("addierte Summen rechnen die Abweichung neu, nicht zusammen", () => {
    const a = summiere(
      [
        zelle({
          monat: "2026-09-01",
          soll: [sollZeile("mv-1", "2026-09-01", "580.00", "400.00", "2026-09-02")],
        }),
      ],
      immerVermietbar,
    );
    const b = summiere(
      [
        zelle({
          monat: "2026-10-01",
          soll: [sollZeile("mv-1", "2026-10-01", "580.00", "580.00", "2026-10-02")],
        }),
      ],
      immerVermietbar,
    );
    const g = addiereSummen([a, b]);
    assert.equal(g.soll, 1160);
    assert.equal(g.ist, 980);
    assert.equal(g.abweichung, -180);
    assert.equal(g.leerstandsquote, 0);
  });
});

// ---------------------------------------------------------------------------

describe("Das ganze Raster", () => {
  const monate = ["2026-08-01", "2026-09-01", "2026-10-01"];

  const einheiten: EinheitZeile[] = [
    // Die WG-Etage: Huelle fuer ihre Zimmer, selbst nicht vermietet.
    einheit({
      id: "e-wg",
      bezeichnung: "5er-WG 2. OG",
      etage: "2. OG",
      art: "gemeinschaft",
      hat_kinder: true,
    }),
    einheit({ id: "e-z1", bezeichnung: "Zimmer 2.1", etage: "2. OG", eltern_id: "e-wg", eltern_bezeichnung: "5er-WG 2. OG" }),
    einheit({ id: "e-z2", bezeichnung: "Zimmer 2.2", etage: "2. OG", eltern_id: "e-wg", eltern_bezeichnung: "5er-WG 2. OG" }),
    einheit({ id: "e-eg", bezeichnung: "Gewerbefläche EG", etage: "EG", art: "gewerbe", vermarktung: "nicht_anbieten" }),
    // Zweites Objekt, ohne jedes Konto.
    einheit({
      id: "e-f1",
      objekt_id: "o-2",
      objekt_name: "Andere Allee 2",
      zahlungsdaten_ab: null,
      bezeichnung: "Wohnung 1",
      etage: null,
    }),
  ];

  const vertraege: MietverhaeltnisZeile[] = [
    vertrag({ id: "mv-z1", einheit_id: "e-z1", kontakt_name: "A. Beispiel" }),
    vertrag({
      id: "mv-f1",
      einheit_id: "e-f1",
      kontakt_name: "C. Probst",
      gesamtmiete: "700.00",
      kaltmiete: null,
      nebenkosten: null,
      moeblierungszuschlag: null,
    }),
  ];

  const sollstellungen: SollZeile[] = [
    sollZeile("mv-z1", "2026-08-01", "580.00", "580.00", "2026-08-03"),
    sollZeile("mv-z1", "2026-09-01", "580.00", "580.00", "2026-09-02"),
    sollZeile("mv-z1", "2026-10-01", "580.00", "300.00", "2026-10-02"),
    sollZeile("mv-f1", "2026-08-01", "700.00"),
    sollZeile("mv-f1", "2026-09-01", "700.00"),
    sollZeile("mv-f1", "2026-10-01", "700.00"),
  ];

  const raster = baueRaster({
    einheiten,
    mietverhaeltnisse: vertraege,
    anpassungen: [],
    sollstellungen,
    buchungen_vorhanden: true,
    monate,
    heute: HEUTE,
  });

  test("gruppiert nach Objekt, Zeilen in Hausordnung", () => {
    assert.deepEqual(
      raster.gruppen.map((g) => g.objekt_name),
      ["Andere Allee 2", "Teststraße 1"],
    );
    const t = raster.gruppen[1];
    // Die WG-Etage hat kein eigenes Mietverhaeltnis und bekommt keine Zeile.
    assert.deepEqual(
      t.zeilen.map((z) => z.bezeichnung),
      ["Gewerbefläche EG", "Zimmer 2.1", "Zimmer 2.2"],
    );
  });

  test("jede Zeile hat genau eine Zelle je Monat", () => {
    for (const g of raster.gruppen) {
      for (const z of g.zeilen) {
        assert.equal(z.zellen.length, monate.length);
        assert.deepEqual(z.zellen.map((c) => c.monat), monate);
      }
    }
  });

  test("die Zeilensumme laeuft ueber den ganzen Zeitraum", () => {
    const z1 = raster.gruppen[1].zeilen.find((z) => z.bezeichnung === "Zimmer 2.1")!;
    assert.equal(z1.summe.soll, 1740);
    assert.equal(z1.summe.ist, 1460);
    assert.equal(z1.summe.abweichung, -280);
    assert.equal(z1.kaution, 1200);
  });

  test("Spaltensummen stehen je Monat", () => {
    const t = raster.gruppen[1];
    assert.equal(t.spalten.length, 3);
    assert.equal(t.spalten[0].soll, 580);
    assert.equal(t.spalten[2].soll, 580);
    assert.equal(t.spalten[2].abweichung, -280);
  });

  test("ein Objekt ohne Konto erzeugt keine Abweichung", () => {
    // Dreimal 700 Euro ohne Zahlung -- aber ohne Kontodaten ist das
    // unbekannt und nicht offen. Hier entstuende sonst ein Rueckstand von
    // 2.100 Euro gegen jemanden, der moeglicherweise alles bezahlt hat.
    const andere = raster.gruppen[0];
    assert.equal(andere.summe.soll, 2100);
    assert.equal(andere.summe.abweichung, 0);
    assert.equal(andere.summe.soll_ohne_daten, 2100);
    for (const c of andere.zeilen[0].zellen) {
      assert.equal(c.status, "nicht_abgeglichen");
    }
  });

  test("Zimmer ohne eigenen Vertrag stehen als Leerstand, die Gewerbeflaeche nicht", () => {
    const t = raster.gruppen[1];
    const z2 = t.zeilen.find((z) => z.bezeichnung === "Zimmer 2.2")!;
    assert.equal(z2.summe.monate_leer, 3);
    assert.equal(z2.kaution, null);

    const gewerbe = t.zeilen.find((z) => z.bezeichnung === "Gewerbefläche EG")!;
    assert.equal(gewerbe.summe.monate_leer, 0);
    assert.equal(gewerbe.summe.monate_vermietbar, 0);

    // Zwei vermietbare Zimmer, drei Monate, eines durchgehend leer.
    assert.equal(t.summe.monate_vermietbar, 6);
    assert.equal(t.summe.monate_leer, 3);
    assert.equal(t.summe.leerstandsquote, 0.5);
  });

  test("die Gesamtsumme ist die Summe der Objekte", () => {
    assert.equal(
      raster.summe.soll,
      raster.gruppen.reduce((n, g) => n + g.summe.soll, 0),
    );
    assert.equal(raster.spalten.length, monate.length);
    assert.equal(raster.summe.abweichung, -280);
  });

  test("eine Etage mit eigenem Vertrag bekommt eine Zeile, ihre Zimmer nicht Leerstand", () => {
    const mitEtage = baueRaster({
      einheiten,
      mietverhaeltnisse: [
        ...vertraege.filter((v) => v.id !== "mv-z1"),
        vertrag({ id: "mv-wg", einheit_id: "e-wg", kontakt_name: "D. Testmann" }),
      ],
      anpassungen: [],
      sollstellungen: [],
      buchungen_vorhanden: true,
      monate,
      heute: HEUTE,
    });
    const t = mitEtage.gruppen.find((g) => g.objekt_name === "Teststraße 1")!;
    assert.ok(t.zeilen.some((z) => z.bezeichnung === "5er-WG 2. OG"));

    const z1 = t.zeilen.find((z) => z.bezeichnung === "Zimmer 2.1")!;
    for (const c of z1.zellen) {
      assert.equal(c.status, "leer");
      assert.equal(c.leer_grund, "eltern");
    }
    assert.equal(z1.summe.monate_leer, 0);
  });
});
