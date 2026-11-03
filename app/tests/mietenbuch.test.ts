import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  addiereSummen,
  baueRaster,
  baueZelle,
  etagenRang,
  filterGesetzt,
  filterRaster,
  giltImMonat,
  istVermietbar,
  kalenderjahr,
  leererFilter,
  lesefilter,
  letzteMonate,
  mietenbuchAdresse,
  monatPlus,
  monatsAnfang,
  monatsEnde,
  ohneFeld,
  ohneZahlungsdaten,
  sollLautVertrag,
  summiere,
  vergleicheEinheiten,
  zeilenZahl,
  zeitraumFuer,
  type AnpassungZeile,
  type EinheitZeile,
  type Mietenbuchfilter,
  type MietverhaeltnisZeile,
  type Raster,
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

// ---------------------------------------------------------------------------

/**
 * Ein Buch mit zwei Haeusern und allen Mietformen, die hier vorkommen.
 *
 * Alle Namen und Betraege sind erfunden. Gebaut ist es so, dass jede der
 * drei Groessen der Aufteilung einmal allein auftritt:
 *
 *   Zimmer 1.1   Kalt 400 + BK 100 + Moeblierung 80        -> Soll 580
 *   Zimmer 1.2   Inklusivmiete 500, keine Nebenkosten      -> Soll 500
 *   Zimmer 1.3   kein Vertrag                              -> Leerstand
 *   Zimmer 1.4   Einzug am 15.08., danach volle Monate     -> anteiliger Monat
 *   Laden EG     wird nicht angeboten                      -> kein Leerstand
 *   Wohnung 1    Kalt 600 + BK 150, im Oktober zu wenig    -> Abweichung
 */
const BUCH_MONATE = ["2026-08-01", "2026-09-01", "2026-10-01"];

const BUCH_EINHEITEN: EinheitZeile[] = [
  einheit({
    id: "e-wg",
    objekt_id: "o-a",
    objekt_name: "Objekt A",
    bezeichnung: "5er-WG 1. OG",
    etage: "1. OG",
    art: "gemeinschaft",
    hat_kinder: true,
    zahlungsdaten_ab: "2026-01-01",
  }),
  einheit({
    id: "e-a1",
    objekt_id: "o-a",
    objekt_name: "Objekt A",
    bezeichnung: "Zimmer 1.1",
    etage: "1. OG",
    eltern_id: "e-wg",
    eltern_bezeichnung: "5er-WG 1. OG",
    zahlungsdaten_ab: "2026-01-01",
  }),
  einheit({
    id: "e-a2",
    objekt_id: "o-a",
    objekt_name: "Objekt A",
    bezeichnung: "Zimmer 1.2",
    etage: "1. OG",
    eltern_id: "e-wg",
    eltern_bezeichnung: "5er-WG 1. OG",
    zahlungsdaten_ab: "2026-01-01",
  }),
  einheit({
    id: "e-a3",
    objekt_id: "o-a",
    objekt_name: "Objekt A",
    bezeichnung: "Zimmer 1.3",
    etage: "1. OG",
    eltern_id: "e-wg",
    eltern_bezeichnung: "5er-WG 1. OG",
    zahlungsdaten_ab: "2026-01-01",
  }),
  einheit({
    id: "e-a4",
    objekt_id: "o-a",
    objekt_name: "Objekt A",
    bezeichnung: "Zimmer 1.4",
    etage: "1. OG",
    eltern_id: "e-wg",
    eltern_bezeichnung: "5er-WG 1. OG",
    zahlungsdaten_ab: "2026-01-01",
  }),
  einheit({
    id: "e-g",
    objekt_id: "o-a",
    objekt_name: "Objekt A",
    bezeichnung: "Laden EG",
    etage: "EG",
    art: "gewerbe",
    vermarktung: "nicht_anbieten",
    zahlungsdaten_ab: "2026-01-01",
  }),
  einheit({
    id: "e-b1",
    objekt_id: "o-b",
    objekt_name: "Objekt B",
    bezeichnung: "Wohnung 1",
    etage: "EG",
    zahlungsdaten_ab: "2026-01-01",
  }),
];

const BUCH_VERTRAEGE: MietverhaeltnisZeile[] = [
  // Getrennt ausgewiesen: 400 Kalt, 100 BK, 80 Moeblierung.
  vertrag({ id: "mv-a1", einheit_id: "e-a1", kontakt_name: "Mieter A" }),
  // Inklusivmiete: 500 all-in, keine getrennte Kaltmiete.
  vertrag({
    id: "mv-a2",
    einheit_id: "e-a2",
    kontakt_name: "Mieter B",
    kaltmiete: null,
    nebenkosten: null,
    moeblierungszuschlag: null,
    gesamtmiete: "500.00",
  }),
  // Einzug am 15.08.: der August ist anteilig gestellt.
  vertrag({
    id: "mv-a4",
    einheit_id: "e-a4",
    kontakt_name: "Mieter C",
    beginn: "2026-08-15",
    moeblierungszuschlag: null,
  }),
  vertrag({
    id: "mv-b1",
    einheit_id: "e-b1",
    kontakt_name: "Mieter D",
    kaltmiete: "600.00",
    nebenkosten: "150.00",
    moeblierungszuschlag: null,
  }),
];

const BUCH_SOLL: SollZeile[] = [
  sollZeile("mv-a1", "2026-08-01", "580.00", "580.00", "2026-08-03"),
  sollZeile("mv-a1", "2026-09-01", "580.00", "580.00", "2026-09-02"),
  sollZeile("mv-a1", "2026-10-01", "580.00", "580.00", "2026-10-02"),
  sollZeile("mv-a2", "2026-08-01", "500.00", "500.00", "2026-08-03"),
  sollZeile("mv-a2", "2026-09-01", "500.00", "500.00", "2026-09-02"),
  sollZeile("mv-a2", "2026-10-01", "500.00", "500.00", "2026-10-02"),
  // Anteiliger August: gestellt ist gestellt, 258,06 und nicht 500.
  sollZeile("mv-a4", "2026-08-01", "258.06", "258.06", "2026-08-17"),
  sollZeile("mv-a4", "2026-09-01", "500.00", "500.00", "2026-09-02"),
  sollZeile("mv-a4", "2026-10-01", "500.00", "500.00", "2026-10-02"),
  sollZeile("mv-b1", "2026-08-01", "750.00", "750.00", "2026-08-03"),
  sollZeile("mv-b1", "2026-09-01", "750.00", "750.00", "2026-09-02"),
  // Im Oktober fehlen 250 Euro -- die einzige Abweichung im Buch.
  sollZeile("mv-b1", "2026-10-01", "750.00", "500.00", "2026-10-02"),
];

function buch(): Raster {
  return baueRaster({
    einheiten: BUCH_EINHEITEN,
    mietverhaeltnisse: BUCH_VERTRAEGE,
    anpassungen: [],
    sollstellungen: BUCH_SOLL,
    buchungen_vorhanden: true,
    monate: BUCH_MONATE,
    heute: HEUTE,
  });
}

/** Alle sichtbaren Zeilen eines Rasters, Haus fuer Haus. */
function sichtbareZeilen(r: Raster) {
  return r.gruppen.flatMap((g) => g.zeilen);
}

const aufDenCent = (n: number) => Math.round(n * 100) / 100;

/**
 * Spalten- und Gesamtsummen zu Fuss nachgerechnet.
 *
 * Bewusst ohne `summiere` und ohne `addiereSummen`: Wer die Summen mit
 * derselben Funktion nachrechnet, die sie erzeugt hat, prueft nur, dass die
 * Funktion zweimal dasselbe tut. Hier wird ueber die Zellen gelaufen, die
 * man auf dem Schirm sehen wuerde.
 */
function spalteZuFuss(r: Raster, i: number, feld: "soll" | "gezahlt"): number {
  let n = 0;
  for (const z of sichtbareZeilen(r)) n += z.zellen[i][feld];
  return aufDenCent(n);
}

function gesamtZuFuss(r: Raster, feld: "soll" | "gezahlt"): number {
  let n = 0;
  for (const z of sichtbareZeilen(r)) for (const c of z.zellen) n += c[feld];
  return aufDenCent(n);
}

const filter = (ueber: Partial<Mietenbuchfilter> = {}): Mietenbuchfilter => ({
  ...leererFilter(),
  ...ueber,
});

// ---------------------------------------------------------------------------

/**
 * Teurer Fehler: Kaltmiete behaupten, wo keine vereinbart ist.
 *
 * Zwei Drittel der WG-Zimmer sind als Inklusivmiete vermietet ("500 all-in,
 * keine Nebenkosten") und haben gar keine getrennte Kaltmiete; dazu kommen
 * Moeblierungszuschlaege und anteilige Monate bei Ein- und Auszug. Wandert
 * dieser Rest in die Kaltspalte, steht dort eine Kaltmiete, die niemand
 * vereinbart hat -- und aus ihr wuerde spaeter eine Mieterhoehung oder eine
 * Betriebskostenabrechnung begruendet. Deshalb muss der Rest eine eigene
 * Groesse bleiben, und die drei Groessen muessen auf den Cent das Soll
 * ergeben: Fehlt ein Cent, fehlt er in einer Abrechnung.
 */
describe("Aufteilung je Monat: Kalt + BK + o. A. = Warm", () => {
  const r = buch();

  test("jede Monatsspalte traegt die Aufteilung, nicht nur der Zeitraum", () => {
    for (const g of r.gruppen) {
      assert.equal(g.spalten.length, BUCH_MONATE.length);
      for (const s of g.spalten) {
        assert.equal(typeof s.kaltmiete, "number");
        assert.equal(typeof s.nebenkosten, "number");
        assert.equal(typeof s.nicht_aufgeteilt, "number");
      }
    }
    // Objekt A im September: 400 + 400 Kalt, 100 + 100 BK, 80 Moeblierung
    // und 500 Inklusivmiete ohne Aufteilung.
    const a = r.gruppen[0];
    assert.equal(a.objekt_name, "Objekt A");
    assert.equal(a.spalten[1].kaltmiete, 800);
    assert.equal(a.spalten[1].nebenkosten, 200);
    assert.equal(a.spalten[1].nicht_aufgeteilt, 580);
    assert.equal(a.spalten[1].soll, 1580);
  });

  test("Kalt + BK + o. A. ergibt auf den Cent das Soll der Spalte", () => {
    for (const g of r.gruppen) {
      for (const [i, s] of g.spalten.entries()) {
        assert.equal(
          aufDenCent(s.kaltmiete + s.nebenkosten + s.nicht_aufgeteilt),
          s.soll,
          `${g.objekt_name}, Spalte ${BUCH_MONATE[i]}`,
        );
      }
    }
    for (const [i, s] of r.spalten.entries()) {
      assert.equal(
        aufDenCent(s.kaltmiete + s.nebenkosten + s.nicht_aufgeteilt),
        s.soll,
        `Gesamtspalte ${BUCH_MONATE[i]}`,
      );
    }
    assert.equal(
      aufDenCent(
        r.summe.kaltmiete + r.summe.nebenkosten + r.summe.nicht_aufgeteilt,
      ),
      r.summe.soll,
    );
  });

  test("eine Inklusivmiete steht vollstaendig unter o. A. und nie unter Kalt", () => {
    const z = sichtbareZeilen(r).find((x) => x.bezeichnung === "Zimmer 1.2")!;
    assert.equal(z.summe.soll, 1500);
    assert.equal(z.summe.kaltmiete, 0);
    assert.equal(z.summe.nebenkosten, 0);
    assert.equal(z.summe.nicht_aufgeteilt, 1500);
    // Auch je Monat, nicht nur in der Zeilensumme.
    for (const c of z.zellen) {
      for (const a of c.abschnitte) {
        assert.equal(a.kaltmiete, null);
        assert.equal(a.nebenkosten, null);
      }
    }
  });

  test("ein anteiliger Monat erhoeht o. A. und verfaelscht die Kaltspalte nicht", () => {
    const a = r.gruppen[0];
    // August: nur Zimmer 1.1 ist voll mit Aufteilung (400/100). Zimmer 1.4
    // ist mit 258,06 anteilig gestellt -- waere das aufgeteilt, stuenden
    // hier 800 Kalt fuer einen halben Monat.
    assert.equal(a.spalten[0].kaltmiete, 400);
    assert.equal(a.spalten[0].nebenkosten, 100);
    assert.equal(a.spalten[0].nicht_aufgeteilt, 838.06);
    assert.equal(a.spalten[0].soll, 1338.06);

    // Im September laeuft derselbe Vertrag voll -- jetzt ist er aufgeteilt.
    assert.equal(a.spalten[1].kaltmiete, 800);

    const z = sichtbareZeilen(r).find((x) => x.bezeichnung === "Zimmer 1.4")!;
    assert.equal(z.zellen[0].abschnitte[0].kaltmiete, null);
    assert.equal(z.zellen[1].abschnitte[0].kaltmiete, 400);
    // 258,06 + 500 + 500 = 1258,06; davon 800 Kalt, 200 BK, 258,06 o. A.
    assert.equal(z.summe.soll, 1258.06);
    assert.equal(z.summe.kaltmiete, 800);
    assert.equal(z.summe.nicht_aufgeteilt, 258.06);
  });

  test("Warm ist keine fuenfte Zahl, sondern das Soll", () => {
    // Die Warmzeile im Raster zeigt `soll`. Stuende dort eine eigene
    // Rechnung, koennte sie von der Soll-Zeile und von den
    // Kennzahlkarten abweichen.
    for (const g of r.gruppen) {
      for (const s of g.spalten) {
        assert.equal(s.soll, aufDenCent(s.kaltmiete + s.nebenkosten + s.nicht_aufgeteilt));
      }
    }
  });
});

// ---------------------------------------------------------------------------

/**
 * Teurer Fehler: eine Summe ueber Zeilen, die man nicht sieht.
 *
 * Ein Filter, der nur Zeilen ausblendet und die alten Spaltenfuesse stehen
 * laesst, zeigt die Miete des ganzen Hauses ueber vier Zimmern. Aus genau
 * dieser Zahl entsteht ein Mahnschreiben oder eine Abrechnung. Deshalb muss
 * `filterRaster` die Fuesse und die Gesamtsummen neu rechnen, und der Test
 * rechnet sie unabhaengig nach -- ueber die Zellen, die sichtbar bleiben.
 */
describe("filterRaster rechnet die Summen neu", () => {
  const alles = buch();

  test("ohne Filter bleibt das Raster, wie es ist", () => {
    assert.equal(filterGesetzt(leererFilter()), false);
    assert.equal(filterRaster(alles, leererFilter()), alles);
  });

  test("auf ein Haus gefiltert: Fuesse und Gesamtsumme werden kleiner", () => {
    const nurA = filterRaster(alles, filter({ objekt: "o-a" }));

    assert.equal(nurA.gruppen.length, 1);
    assert.equal(nurA.gruppen[0].objekt_name, "Objekt A");
    assert.equal(zeilenZahl(nurA), 5);
    assert.equal(zeilenZahl(alles), 6);

    // Kleiner als ungefiltert -- Objekt B faellt mit 750 je Monat weg.
    for (const [i, s] of nurA.spalten.entries()) {
      assert.ok(
        s.soll < alles.spalten[i].soll,
        `Spalte ${BUCH_MONATE[i]}: ${s.soll} muss unter ${alles.spalten[i].soll} liegen`,
      );
    }
    assert.ok(nurA.summe.soll < alles.summe.soll);

    // Und unabhaengig nachgerechnet gleich.
    for (const [i, s] of nurA.spalten.entries()) {
      assert.equal(s.soll, spalteZuFuss(nurA, i, "soll"));
      assert.equal(s.ist, spalteZuFuss(nurA, i, "gezahlt"));
    }
    assert.equal(nurA.summe.soll, gesamtZuFuss(nurA, "soll"));
    assert.equal(nurA.summe.ist, gesamtZuFuss(nurA, "gezahlt"));

    // 258,06 + 500 + 580 im August, dann zweimal 1.580.
    assert.equal(nurA.spalten[0].soll, 1338.06);
    assert.equal(nurA.spalten[1].soll, 1580);
    assert.equal(nurA.spalten[2].soll, 1580);
    assert.equal(nurA.summe.soll, 4498.06);
  });

  test("innerhalb eines Hauses gefiltert: der Spaltenfuss wird kleiner", () => {
    // Der gefaehrliche Fall. Beim Filtern auf ein ganzes Haus fallen
    // fremde Haeuser weg, und die Fuesse des eigenen stimmen zufaellig
    // weiter. Hier bleibt vom Haus eine von fuenf Zeilen -- stehen die
    // alten Fuesse, steht unter einem Zimmer die Miete von vier anderen.
    const r = filterRaster(alles, filter({ suche: "Zimmer 1.1" }));
    assert.equal(r.gruppen.length, 1);
    assert.equal(zeilenZahl(r), 1);
    assert.equal(alles.gruppen[0].zeilen.length, 5);

    const vorher = alles.gruppen[0];
    const nachher = r.gruppen[0];
    for (const [i, s] of nachher.spalten.entries()) {
      assert.ok(
        s.soll < vorher.spalten[i].soll,
        `Spalte ${BUCH_MONATE[i]}: ${s.soll} muss unter ${vorher.spalten[i].soll} liegen`,
      );
      // Unabhaengig nachgerechnet, ueber die Zelle, die sichtbar bleibt.
      assert.equal(s.soll, spalteZuFuss(r, i, "soll"));
      assert.equal(s.soll, 580);
    }
    assert.ok(nachher.summe.soll < vorher.summe.soll);
    assert.equal(r.summe.soll, 1740);
    assert.equal(r.summe.ist, 1740);
    // Die Aufteilung gilt auch im Ausschnitt: 3 x (400 + 100 + 80).
    assert.equal(r.summe.kaltmiete, 1200);
    assert.equal(r.summe.nebenkosten, 300);
    assert.equal(r.summe.nicht_aufgeteilt, 240);
    assert.equal(
      aufDenCent(
        r.summe.kaltmiete + r.summe.nebenkosten + r.summe.nicht_aufgeteilt,
      ),
      r.summe.soll,
    );
  });

  test("die Gesamtsumme ist die Summe der Spalten und der Zeilen", () => {
    for (const f of [
      leererFilter(),
      filter({ objekt: "o-a" }),
      filter({ art: "wohnen" }),
      filter({ suche: "zimmer" }),
      filter({ nur: "abweichung" }),
      filter({ nur: "leerstand" }),
    ]) {
      const r = filterRaster(alles, f);
      assert.equal(
        r.summe.soll,
        aufDenCent(r.spalten.reduce((n, s) => n + s.soll, 0)),
      );
      assert.equal(r.summe.soll, gesamtZuFuss(r, "soll"));
      assert.equal(
        r.summe.soll,
        aufDenCent(sichtbareZeilen(r).reduce((n, z) => n + z.summe.soll, 0)),
      );
      // Auch die Aufteilung muss im Ausschnitt aufgehen.
      assert.equal(
        aufDenCent(
          r.summe.kaltmiete + r.summe.nebenkosten + r.summe.nicht_aufgeteilt,
        ),
        r.summe.soll,
      );
    }
  });

  test("die Abweichung wird neu gerechnet, nicht uebernommen", () => {
    // Im ganzen Buch fehlen 250 Euro, und sie stehen in Objekt B.
    assert.equal(alles.summe.abweichung, -250);
    assert.equal(filterRaster(alles, filter({ objekt: "o-b" })).summe.abweichung, -250);
    // Objekt A allein hat keine Abweichung. Stuende die alte Summe, waere
    // hier ein Rueckstand von 250 Euro gegen Mieter, die alles gezahlt haben.
    assert.equal(filterRaster(alles, filter({ objekt: "o-a" })).summe.abweichung, 0);
    assert.equal(filterRaster(alles, filter({ objekt: "o-a" })).spalten[2].abweichung, 0);
  });

  test("die Leerstandsquote wird neu gerechnet", () => {
    // Objekt A: vier vermietbare Zimmer ueber drei Monate, eines leer.
    const a = filterRaster(alles, filter({ objekt: "o-a" }));
    assert.equal(a.summe.monate_vermietbar, 12);
    assert.equal(a.summe.monate_leer, 3);
    assert.equal(a.summe.leerstandsquote, 0.25);

    // Nur die leere Zeile: drei von drei Monatszellen leer.
    const leer = filterRaster(alles, filter({ nur: "leerstand" }));
    assert.equal(zeilenZahl(leer), 1);
    assert.equal(sichtbareZeilen(leer)[0].bezeichnung, "Zimmer 1.3");
    assert.equal(leer.summe.monate_vermietbar, 3);
    assert.equal(leer.summe.monate_leer, 3);
    assert.equal(leer.summe.leerstandsquote, 1);
    // Die Gewerbeflaeche hat keinen Vertrag, ist aber kein Leerstand.
    assert.equal(istVermietbar(BUCH_EINHEITEN[5]), false);
  });

  test("nur mit Abweichung trifft die Grenze von einem Euro", () => {
    const r = filterRaster(alles, filter({ nur: "abweichung" }));
    assert.equal(zeilenZahl(r), 1);
    assert.equal(sichtbareZeilen(r)[0].bezeichnung, "Wohnung 1");
    assert.equal(r.summe.abweichung, -250);
    // Die Spaltenfuesse zeigen jetzt nur noch diese Zeile.
    assert.equal(r.spalten[2].soll, 750);
    assert.equal(r.spalten[2].ist, 500);
  });

  test("Haeuser ohne sichtbare Zeile fallen ganz weg", () => {
    const r = filterRaster(alles, filter({ art: "gewerbe" }));
    assert.equal(r.gruppen.length, 1);
    assert.equal(r.gruppen[0].objekt_name, "Objekt A");
    assert.equal(zeilenZahl(r), 1);
    // Eine Gewerbeflaeche ohne Vertrag: ein Treffer, aber kein Betrag.
    assert.equal(r.summe.soll, 0);
    assert.equal(r.summe.leerstandsquote, null);
  });
});

/**
 * Teurer Fehler: "kein Treffer" sieht aus wie "alles".
 *
 * Gaebe `filterRaster` bei einem Filter ohne Treffer das ungefilterte
 * Raster zurueck, laese man die Summen des ganzen Hauses als Summen seiner
 * Suche. Das ist die gefaehrlichere Variante von leer.
 */
describe("Ein Filter ohne Treffer ergibt ein leeres Raster", () => {
  const alles = buch();
  const r = filterRaster(alles, filter({ suche: "Mieter Z" }));

  test("keine Gruppen, aber die Monate bleiben stehen", () => {
    assert.equal(r.gruppen.length, 0);
    assert.equal(zeilenZahl(r), 0);
    assert.deepEqual(r.monate, BUCH_MONATE);
    assert.equal(r.spalten.length, BUCH_MONATE.length);
  });

  test("alle Summen sind null -- nicht die des ganzen Buchs", () => {
    assert.equal(r.summe.soll, 0);
    assert.equal(r.summe.ist, 0);
    assert.equal(r.summe.abweichung, 0);
    assert.equal(r.summe.kaltmiete, 0);
    assert.equal(r.summe.nebenkosten, 0);
    assert.equal(r.summe.nicht_aufgeteilt, 0);
    assert.equal(r.summe.monate_leer, 0);
    assert.equal(r.summe.leerstandsquote, null);
    for (const s of r.spalten) {
      assert.equal(s.soll, 0);
      assert.equal(s.ist, 0);
    }
    // Und nachweislich nicht das ungefilterte Raster.
    assert.notEqual(r.summe.soll, alles.summe.soll);
    assert.ok(alles.summe.soll > 0);
  });
});

/**
 * Teurer Fehler: eine Adresse mit Unsinn filtert "nichts".
 *
 * Ein veralteter Verweis oder ein Tippfehler in der Adresse darf keine
 * leere Seite ergeben, auf der man die Luecke der Belegung zuschreibt. Was
 * nicht verstanden wird, wird verworfen -- dann steht das ganze Buch da,
 * und das ist nie falsch, nur weit.
 */
describe("lesefilter verwirft, was es nicht versteht", () => {
  test("ohne Parameter ist kein Filter gesetzt", () => {
    const f = lesefilter({}, ["o-a", "o-b"]);
    assert.deepEqual(f, leererFilter());
    assert.equal(filterGesetzt(f), false);
  });

  test("eine Kennung, die kein Objekt ist, wird ignoriert", () => {
    // Eine formal einwandfreie UUID, die zu keinem Haus gehoert.
    const fremd = "11111111-1111-4111-8111-111111111111";
    assert.equal(lesefilter({ objekt: fremd }, ["o-a", "o-b"]).objekt, null);
    assert.equal(lesefilter({ objekt: "o-c" }, ["o-a", "o-b"]).objekt, null);
    assert.equal(lesefilter({ objekt: "" }, ["o-a"]).objekt, null);
    // Ein bekanntes Haus greift.
    assert.equal(lesefilter({ objekt: "o-a" }, ["o-a", "o-b"]).objekt, "o-a");
  });

  test("eine unbekannte Art wird ignoriert", () => {
    assert.equal(lesefilter({ art: "garage" }, []).art, null);
    assert.equal(lesefilter({ art: "WOHNEN" }, []).art, null);
    assert.equal(lesefilter({ art: "gemeinschaft" }, []).art, null);
    assert.equal(lesefilter({ art: "wohnen" }, []).art, "wohnen");
    assert.equal(lesefilter({ art: "gewerbe" }, []).art, "gewerbe");
  });

  test("nur=irgendwas wird ignoriert", () => {
    assert.equal(lesefilter({ nur: "irgendwas" }, []).nur, null);
    assert.equal(lesefilter({ nur: "1" }, []).nur, null);
    assert.equal(lesefilter({ nur: "abweichung" }, []).nur, "abweichung");
    assert.equal(lesefilter({ nur: "leerstand" }, []).nur, "leerstand");
  });

  test("die Suche wird beschnitten, nicht geprueft", () => {
    assert.equal(lesefilter({ suche: "  Zimmer 1.2  " }, []).suche, "Zimmer 1.2");
    assert.equal(lesefilter({ suche: "   " }, []).suche, "");
    // Ein einzelnes Zeichen bleibt zulaessig: "2" sucht Zimmer 2.
    assert.equal(lesefilter({ suche: "2" }, []).suche, "2");
  });

  test("ein doppelt gesetzter Parameter nimmt den ersten Wert", () => {
    // ?suche=a&suche=b kommt als Liste an. Beide zu verbinden waere eine
    // Suche, die niemand getippt hat.
    assert.equal(lesefilter({ suche: ["Zimmer", "Laden"] }, []).suche, "Zimmer");
    assert.equal(lesefilter({ objekt: ["o-a", "o-b"] }, ["o-a"]).objekt, "o-a");
    assert.equal(lesefilter({ art: [] }, []).art, null);
  });

  test("Adresse und Marken: ein Filter laesst sich weitergeben und abraeumen", () => {
    const f = filter({ objekt: "o-a", suche: "Zimmer 1.2", nur: "leerstand" });
    assert.equal(
      mietenbuchAdresse(f, 2025),
      "/mietenbuch?jahr=2025&objekt=o-a&suche=Zimmer+1.2&nur=leerstand",
    );
    // Ohne Filter und ohne Jahr bleibt die blanke Adresse.
    assert.equal(mietenbuchAdresse(leererFilter(), null), "/mietenbuch");
    // Eine Marke entfernen laesst die anderen stehen.
    assert.deepEqual(ohneFeld(f, "suche"), { ...f, suche: "" });
    assert.deepEqual(ohneFeld(f, "objekt"), { ...f, objekt: null });
    assert.deepEqual(ohneFeld(f, "nur"), { ...f, nur: null });
    assert.equal(filterGesetzt(ohneFeld(ohneFeld(ohneFeld(f, "nur"), "objekt"), "suche")), false);
  });
});

/**
 * Teurer Fehler: die Suche findet die Zeile nicht, die man meint.
 *
 * Gesucht wird nach dem, was im Kopf des Vermieters steht -- der
 * Zimmernummer, der Etage, dem Namen der WG oder dem Mieter. Findet die
 * Suche nur die Bezeichnung, haelt man eine vorhandene Zeile fuer nicht
 * vorhanden und legt sie neu an.
 */
describe("Die Suche trifft Bezeichnung, Etage, WG und Mieternamen", () => {
  const alles = buch();
  const treffer = (suche: string) =>
    sichtbareZeilen(filterRaster(alles, filter({ suche }))).map(
      (z) => z.bezeichnung,
    );

  test("Einheitsbezeichnung, auch als Teiltreffer", () => {
    assert.deepEqual(treffer("Zimmer 1.2"), ["Zimmer 1.2"]);
    assert.deepEqual(treffer("1.4"), ["Zimmer 1.4"]);
    assert.deepEqual(treffer("Laden"), ["Laden EG"]);
  });

  test("Etage", () => {
    assert.deepEqual(treffer("1. OG"), [
      "Zimmer 1.1",
      "Zimmer 1.2",
      "Zimmer 1.3",
      "Zimmer 1.4",
    ]);
    // Die Etage "EG" trifft die Gewerbeflaeche und die Wohnung im anderen
    // Haus -- die Suche laeuft ueber alle Haeuser.
    assert.deepEqual(treffer("EG"), ["Laden EG", "Wohnung 1"]);
  });

  test("Name der uebergeordneten Einheit (WG)", () => {
    assert.deepEqual(treffer("5er-WG"), [
      "Zimmer 1.1",
      "Zimmer 1.2",
      "Zimmer 1.3",
      "Zimmer 1.4",
    ]);
  });

  test("Mietername, auch der eines Vormieters im Zeitraum", () => {
    assert.deepEqual(treffer("Mieter B"), ["Zimmer 1.2"]);
    assert.deepEqual(treffer("Mieter D"), ["Wohnung 1"]);
    // Der Mietername steht nicht in den Stammdaten der Zeile, sondern je
    // Monat in den Abschnitten -- gesucht wird ueber den ganzen Zeitraum.
    const z = sichtbareZeilen(alles).find((x) => x.bezeichnung === "Zimmer 1.4")!;
    assert.equal(z.zellen[0].abschnitte[0].kontakt_name, "Mieter C");
    assert.deepEqual(treffer("Mieter C"), ["Zimmer 1.4"]);
  });

  test("Gross- und Kleinschreibung ist gleichgueltig", () => {
    assert.deepEqual(treffer("zimmer 1.2"), treffer("ZIMMER 1.2"));
    assert.deepEqual(treffer("zimmer 1.2"), ["Zimmer 1.2"]);
    assert.deepEqual(treffer("5ER-wg"), treffer("5er-WG"));
    assert.deepEqual(treffer("mieter d"), ["Wohnung 1"]);
    assert.deepEqual(treffer("1. og"), treffer("1. OG"));
  });

  test("Suche und andere Filter wirken zusammen, nicht gegeneinander", () => {
    // "1. OG" trifft vier Zimmer; mit nur=leerstand bleibt das leere.
    const r = filterRaster(
      alles,
      filter({ suche: "1. OG", nur: "leerstand", art: "wohnen", objekt: "o-a" }),
    );
    assert.deepEqual(sichtbareZeilen(r).map((z) => z.bezeichnung), ["Zimmer 1.3"]);
    assert.equal(r.summe.soll, 0);
    assert.equal(r.summe.monate_leer, 3);
  });
});
