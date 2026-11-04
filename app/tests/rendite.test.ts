import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  betragAusText,
  bewirtschaftungskosten,
  bruttomietrendite,
  cashflowJahr,
  eigenkapital,
  faktor,
  flaechenGrundlage,
  gesamtinvest,
  inkassoquote,
  jahresLaufmiete,
  jahresreinertrag,
  laeuftAmErsten,
  laufmieteLage,
  laufmieteReihe,
  mieteJeQmMonat,
  mietausfallquote,
  nettomietrendite,
  nettomietrenditeLaufend,
  rohertragGestellt,
  rohertragLautVertrag,
  summeCent,
  wirtschaftLage,
  zinsdeckung,
  zwoelfMonatsFenster,
  type LaufmietePunkt,
  type LaufmieteZeile,
  type WirtschaftBasis,
  type WirtschaftStamm,
} from "../lib/rendite";
import {
  objektKennzahlen,
  sollAufteilung,
  type ObjektEinheit,
} from "../lib/objekte";

/**
 * Tests fuer die wirtschaftlichen Kennzahlen eines Objekts.
 *
 * Eine Rendite ist die Zahl, bei der niemand nachrechnet -- das ist ihr
 * Zweck. Sie steht am Ende einer Kette aus zehn gepflegten Feldern und vier
 * Abfragen, und wenn ein Glied fehlt, sieht das Ergebnis genauso aus wie
 * ein richtiges. "4,1 %" ist nicht zu unterscheiden von "4,1 %, aber ohne
 * Kosten gerechnet".
 *
 * Deshalb pruefen diese Tests vor allem die Faelle, in denen keine Zahl
 * behauptet werden darf -- und zusaetzlich jede Formel an einem von Hand
 * nachgerechneten Beispiel, dessen Rechnung im Kommentar steht.
 */

// ---------------------------------------------------------------------------
// Pruefstand: Werte, die absichtlich leicht nachzurechnen sind
// ---------------------------------------------------------------------------

const LEERER_STAMM: WirtschaftStamm = {
  kaufpreis: null,
  kaufnebenkosten: null,
  kaufdatum: null,
  verkehrswert: null,
  bewirtschaftung_jahr: null,
  instandhaltung_je_qm: null,
  mietausfallwagnis_satz: null,
  darlehen_restschuld: null,
  darlehen_zins_satz: null,
  darlehen_rate_monat: null,
};

const LEERE_BASIS: WirtschaftBasis = {
  fensterVon: "2025-12-01",
  fensterBis: "2026-12-01",
  sollMonat: 0,
  mietverhaeltnisse: 0,
  sollGestellt: 0,
  gestellteMonate: 0,
  belegkosten: 0,
  belege: 0,
  belegeFinanzierung: 0,
  flaeche: 0,
  belegteEinheiten: 0,
  belegteEinheitenMitFlaeche: 0,
  sollFaellig: 0,
  istZugeordnet: 0,
  monateMitKontodaten: 0,
};

const stamm = (teile: Partial<WirtschaftStamm>): WirtschaftStamm => ({
  ...LEERER_STAMM,
  ...teile,
});
const basis = (teile: Partial<WirtschaftBasis>): WirtschaftBasis => ({
  ...LEERE_BASIS,
  ...teile,
});

/** "Objekt A": 500.000 Kaufpreis, 60.000 Nebenkosten, 48.000 Rohertrag. */
const OBJEKT_A_STAMM = stamm({
  kaufpreis: 500_000,
  kaufnebenkosten: 60_000,
  kaufdatum: "2024-01-15",
});

const OBJEKT_A_BASIS = basis({
  sollMonat: 4_000,
  mietverhaeltnisse: 8,
  sollGestellt: 48_000,
  gestellteMonate: 12,
  belegkosten: 12_000,
  belege: 40,
  flaeche: 400,
  belegteEinheiten: 8,
  belegteEinheitenMitFlaeche: 8,
  sollFaellig: 44_000,
  istZugeordnet: 42_900,
  monateMitKontodaten: 11,
});

// ---------------------------------------------------------------------------
// Rundung
//
// Verhindert: Betraege wie 599.9999999 auf dem Schirm und -- schlimmer --
// in Vergleichen. Die Posten kommen als Text aus numeric(10,2); binaer
// addiert hinterlassen sie Reste. Zwei Zahlen, die gleich aussehen und
// nicht gleich sind, machen jede Abstimmung unmoeglich.
// ---------------------------------------------------------------------------

describe("Rundung auf Cent", () => {
  test("drei Posten aus numeric(10,2) ergeben keinen Fliesskommarest", () => {
    // Kalt 256,03 + Nebenkosten 128,04 + Moeblierung 215,92 = 599,99.
    // Naiv addiert liefert JavaScript hier 599.9899999999999.
    assert.equal(
      256.03 + 128.04 + 215.92 === 599.99,
      false,
      "Ohne Rest waere der Test sinnlos -- dann addiert JavaScript exakt.",
    );
    assert.equal(summeCent([256.03, 128.04, 215.92]), 599.99);
  });

  test("auch die klassischen Reste verschwinden", () => {
    // 0,1 + 0,2 = 0,30000000000000004 in Fliesskomma.
    assert.equal(summeCent([0.1, 0.2]), 0.3);
    // 12 x 36,55 = 438,60 -- nicht 438,59999999999997.
    assert.equal(summeCent(Array.from({ length: 12 }, () => 36.55)), 438.6);
  });

  test("betragAusText macht aus Leere keine Null", () => {
    // Number("") ist 0 und Number(null) ist 0. Genau diese stille Null
    // waere ein Kaufpreis von 0 Euro statt eines fehlenden Kaufpreises --
    // und damit eine Rendite statt eines Hinweises.
    assert.equal(betragAusText(null), null);
    assert.equal(betragAusText(""), null);
    assert.equal(betragAusText("  "), null);
    assert.equal(betragAusText("keine Zahl"), null);
    assert.equal(betragAusText("500000.00"), 500000);
    assert.equal(betragAusText(0), 0, "Eine erfasste 0 ist eine Aussage.");
  });
});

// ---------------------------------------------------------------------------
// Zwoelfmonatsfenster
//
// Verhindert: zwei verschieden lange Fenster fuer Zaehler und Nenner. Wenn
// die Sollstellungen zwoelf Monate und die Belege dreizehn umfassen, ist die
// Rendite falsch, und zwar um einen Monat Kosten -- das sieht niemand.
// ---------------------------------------------------------------------------

describe("Zwoelfmonatsfenster", () => {
  test("zwoelf Monatsscheiben bis einschliesslich heute", () => {
    // Heute 03.11.2026: von 01.12.2025 (einschliesslich) bis 01.12.2026
    // (ausschliesslich) -- das sind die Monate Dez 25 bis Nov 26, also 12.
    const f = zwoelfMonatsFenster(new Date("2026-11-03T12:00:00Z"));
    assert.equal(f.von, "2025-12-01");
    assert.equal(f.bis, "2026-12-01");
    assert.equal(f.faelligBis, "2026-11-01");
  });

  test("der Jahreswechsel laeuft nicht ueber", () => {
    const f = zwoelfMonatsFenster(new Date("2026-01-15T12:00:00Z"));
    assert.equal(f.von, "2025-02-01");
    assert.equal(f.bis, "2026-02-01");
    assert.equal(f.faelligBis, "2026-01-01");
  });

  test("die Uhrzeit des Aufrufs aendert das Fenster nicht", () => {
    const frueh = zwoelfMonatsFenster(new Date("2026-11-30T00:01:00Z"));
    const spaet = zwoelfMonatsFenster(new Date("2026-11-30T23:59:00Z"));
    assert.deepEqual(frueh, spaet);
  });
});

// ---------------------------------------------------------------------------
// Gesamtinvest
//
// Verhindert: eine Rendite ohne Kaufpreis. Das ist der teuerste Fehler
// dieser Datei, weil er gut aussieht: Ohne Nenner waere das Ergebnis
// entweder 0 % (sieht wie ein schlechtes Objekt aus), Infinity (sieht wie
// ein Anzeigefehler aus) oder NaN. Alle drei sind Aussagen, und keine
// davon ist wahr.
// ---------------------------------------------------------------------------

describe("Gesamtinvest", () => {
  test("Kaufpreis plus Nebenkosten", () => {
    // 500.000 + 60.000 = 560.000
    const g = gesamtinvest(OBJEKT_A_STAMM);
    assert.equal(g.wert, 560_000);
    assert.equal(g.grund, null);
    assert.match(g.grundlage, /500\.000,00/);
    assert.match(g.grundlage, /60\.000,00/);
  });

  test("ohne Kaufpreis gibt es keine Zahl, und der Grund nennt ihn", () => {
    const g = gesamtinvest(stamm({ kaufnebenkosten: 60_000 }));
    assert.equal(g.wert, null);
    assert.match(
      g.grund ?? "",
      /Kaufpreis/,
      "Der Grund muss den Kaufpreis nennen, sonst weiss der Eigentuemer " +
        "nicht, welches der zehn Felder er nachtragen soll.",
    );
  });

  test("Kaufpreis 0 ergibt null -- keine Division, kein Infinity", () => {
    const g = gesamtinvest(stamm({ kaufpreis: 0, kaufnebenkosten: 12_000 }));
    assert.equal(g.wert, null);
    assert.match(g.grund ?? "", /Kaufpreis/);
    // Ohne diese Pruefung waere der Gesamtinvest 12.000 EUR und die
    // Bruttomietrendite eines 48.000-EUR-Rohertrags 400 %.
    const r = bruttomietrendite(rohertragGestellt(OBJEKT_A_BASIS), g);
    assert.equal(r.wert, null);
    assert.equal(Number.isFinite(r.wert as unknown as number), false);
  });

  test("fehlende Nebenkosten werden als 0 gerechnet und gesagt", () => {
    const g = gesamtinvest(stamm({ kaufpreis: 500_000 }));
    assert.equal(g.wert, 500_000);
    assert.match(g.grundlage, /nicht erfasst/);
    assert.match(g.grundlage, /zu gut/);
  });
});

// ---------------------------------------------------------------------------
// Rohertrag -- zwei Sichten
//
// Verhindert: dass ein halb leeres Haus wie ein volles aussieht. Die
// Vertragssicht kennt keinen Leerstand (ein leeres Zimmer hat kein
// Mietverhaeltnis), die gestellte Sicht kennt ihn. Wer nur die erste
// zeigt, zeigt die Obergrenze als Ergebnis.
// ---------------------------------------------------------------------------

describe("Rohertrag", () => {
  test("laut Vertrag: 12 x Monatssoll", () => {
    // 12 x 4.000 = 48.000
    const r = rohertragLautVertrag(OBJEKT_A_BASIS);
    assert.equal(r.wert, 48_000);
    assert.match(r.grundlage, /Ohne Leerstand/);
  });

  test("gestellt: Summe der Sollstellungen des Fensters", () => {
    // Zehn belegte Monate zu 4.000 und zwei zu 2.000 (ein Zimmer leer):
    // 10 x 4.000 + 2 x 2.000 = 44.000
    const r = rohertragGestellt(basis({ sollGestellt: 44_000, gestellteMonate: 12 }));
    assert.equal(r.wert, 44_000);
    assert.match(r.grundlage, /12 Monate/);
  });

  test("ohne laufendes Mietverhaeltnis keine Vertragssicht", () => {
    const r = rohertragLautVertrag(LEERE_BASIS);
    assert.equal(r.wert, null);
    assert.match(r.grund ?? "", /Mietverh/);
  });

  test("ohne Sollstellungen keine gestellte Sicht", () => {
    const r = rohertragGestellt(LEERE_BASIS);
    assert.equal(r.wert, null);
    assert.match(r.grund ?? "", /Sollstellungen/);
  });

  test("ein unvollstaendiges Fenster wird nicht hochgerechnet", () => {
    // Fuenf Monate zu 4.000 = 20.000. Hochgerechnet waeren es 48.000 --
    // das waere eine Zahl aus Daten, die es nicht gibt. Bei einem im
    // Sommer uebernommenen Haus kommt genau das vor.
    const r = rohertragGestellt(basis({ sollGestellt: 20_000, gestellteMonate: 5 }));
    assert.equal(r.wert, 20_000);
    assert.match(r.grundlage, /5 Monate/);
    assert.match(r.grundlage, /kein Jahresbetrag/);
  });

  test("laufende Mietverhaeltnisse ohne Betrag sind keine 0 EUR Miete", () => {
    const r = rohertragLautVertrag(basis({ mietverhaeltnisse: 3, sollMonat: 0 }));
    assert.equal(r.wert, null);
    assert.match(r.grund ?? "", /keine erfassten Mietbetr/);
  });
});

// ---------------------------------------------------------------------------
// Bewirtschaftungskosten
//
// Verhindert den einen Fehler, der bei dieser Kennzahl gut aussieht: eine
// Kostenseite von 0 EUR, weil noch kein Beleg erfasst ist. Dann ist der
// Reinertrag gleich dem Rohertrag, und die Netto-Mietrendite ist etwa
// doppelt so hoch wie die wirkliche -- bei Objekt A 8,6 % statt 4,3 %.
// Auf dieser Zahl kauft jemand ein Haus.
// ---------------------------------------------------------------------------

describe("Bewirtschaftungskosten", () => {
  test("Belegsumme plus Wagnis plus Instandhaltungsansatz", () => {
    // Belege 12.000
    // + Mietausfallwagnis 2 % von 48.000 = 960
    // + Instandhaltung 10 EUR/m2 x 400 m2 = 4.000
    // = 16.960
    const k = bewirtschaftungskosten(
      stamm({ mietausfallwagnis_satz: 2, instandhaltung_je_qm: 10 }),
      OBJEKT_A_BASIS,
      48_000,
    );
    assert.equal(k.wert, 16_960);
    assert.match(k.grundlage, /40 Belege/);
    assert.match(k.grundlage, /960,00/);
    assert.match(k.grundlage, /4\.000,00/);
  });

  test("keine Belege erfasst: unbekannt, nicht 0", () => {
    const k = bewirtschaftungskosten(LEERER_STAMM, basis({ belege: 0 }), 48_000);
    assert.equal(
      k.wert,
      null,
      "0 EUR Kosten bei null Belegen ist keine Sparsamkeit, sondern eine " +
        "Luecke -- und die Rendite daraus etwa doppelt so hoch.",
    );
    assert.match(k.grund ?? "", /kein Beleg/);
    assert.match(k.grund ?? "", /Jahresansatz/);
  });

  test("ein Objekt ohne Kosten ist nicht dasselbe wie eines ohne Kostendaten", () => {
    // Belege sind erfasst, summieren sich aber auf 0 (nur Gutschriften o. ae.).
    // Dann ist 0 eine Aussage und darf stehen.
    const k = bewirtschaftungskosten(
      LEERER_STAMM,
      basis({ belege: 3, belegkosten: 0 }),
      48_000,
    );
    assert.equal(k.wert, 0);
    assert.equal(k.grund, null);
    assert.match(k.grundlage, /3 Belege/);
  });

  test("bewirtschaftung_jahr hat Vorrang vor der Belegsumme", () => {
    // Belege sagen 12.000, der Jahresansatz sagt 20.000. Gerechnet wird mit
    // 20.000 -- in Mannheim laeuft fast alles ueber die WEG-Abrechnung und
    // taucht in den Belegen nur als eine Zeile im Jahr auf.
    const k = bewirtschaftungskosten(
      stamm({ bewirtschaftung_jahr: 20_000 }),
      OBJEKT_A_BASIS,
      48_000,
    );
    assert.equal(k.wert, 20_000);
    assert.match(k.grundlage, /Jahresansatz/);
    assert.match(k.grundlage, /statt der 40 Belege/);
  });

  test("der Jahresansatz ersetzt nur die Belege, nicht die Ansaetze", () => {
    // 20.000 Jahresansatz + 2 % von 48.000 (= 960) + 10 x 400 (= 4.000)
    // = 24.960
    const k = bewirtschaftungskosten(
      stamm({
        bewirtschaftung_jahr: 20_000,
        mietausfallwagnis_satz: 2,
        instandhaltung_je_qm: 10,
      }),
      OBJEKT_A_BASIS,
      48_000,
    );
    assert.equal(k.wert, 24_960);
  });

  test("ohne Wagnissatz wird kein Wagnis erfunden, und es steht dabei", () => {
    const k = bewirtschaftungskosten(LEERER_STAMM, OBJEKT_A_BASIS, 48_000);
    assert.equal(k.wert, 12_000);
    assert.match(k.grundlage, /ohne Mietausfallwagnis/);
  });

  test("Wagnissatz ohne Rohertrag ergibt keine Kostenseite", () => {
    const k = bewirtschaftungskosten(
      stamm({ mietausfallwagnis_satz: 2 }),
      OBJEKT_A_BASIS,
      null,
    );
    assert.equal(k.wert, null);
    assert.match(k.grund ?? "", /Rohertrag/);
  });

  test("Instandhaltungsansatz ohne Flaeche ergibt keine Kostenseite", () => {
    const k = bewirtschaftungskosten(
      stamm({ instandhaltung_je_qm: 10 }),
      basis({ belege: 40, belegkosten: 12_000, flaeche: 0 }),
      48_000,
    );
    assert.equal(k.wert, null);
    assert.match(k.grund ?? "", /Fl/);
  });

  test("Zinsbelege werden genannt, weil sie auch in der Annuitaet stecken", () => {
    const k = bewirtschaftungskosten(
      LEERER_STAMM,
      basis({ belege: 40, belegkosten: 12_000, belegeFinanzierung: 12 }),
      48_000,
    );
    assert.match(k.grundlage, /12 Belege der Kostenart/);
    assert.match(k.grundlage, /Darlehensrate/);
  });
});

// ---------------------------------------------------------------------------
// Reinertrag und Renditen
//
// Verhindert: eine geklemmte Null. Ein Objekt, dessen Kosten den Rohertrag
// uebersteigen, ist im Sanierungsjahr der Normalfall -- und die schlechteste
// Nachricht ist genau die, die nicht ankommen darf.
// ---------------------------------------------------------------------------

describe("Reinertrag, Brutto- und Nettomietrendite", () => {
  test("Reinertrag ist Rohertrag minus Bewirtschaftung", () => {
    // 48.000 - 16.960 = 31.040
    const roh = rohertragGestellt(OBJEKT_A_BASIS);
    const kosten = bewirtschaftungskosten(
      stamm({ mietausfallwagnis_satz: 2, instandhaltung_je_qm: 10 }),
      OBJEKT_A_BASIS,
      48_000,
    );
    const rein = jahresreinertrag(roh, kosten);
    assert.equal(rein.wert, 31_040);
  });

  test("Bruttomietrendite: Rohertrag durch Gesamtinvest", () => {
    // 48.000 / 560.000 = 0,0857142857... = 8,571 %
    const r = bruttomietrendite(
      rohertragGestellt(OBJEKT_A_BASIS),
      gesamtinvest(OBJEKT_A_STAMM),
    );
    assert.ok(r.wert !== null);
    assert.equal(Math.round((r.wert as number) * 1e6) / 1e6, 0.085714);
  });

  test("Nettomietrendite: Reinertrag durch Gesamtinvest", () => {
    // Reinertrag 31.040 / Gesamtinvest 560.000 = 0,0554285714... = 5,543 %
    const roh = rohertragGestellt(OBJEKT_A_BASIS);
    const kosten = bewirtschaftungskosten(
      stamm({ mietausfallwagnis_satz: 2, instandhaltung_je_qm: 10 }),
      OBJEKT_A_BASIS,
      48_000,
    );
    const r = nettomietrendite(jahresreinertrag(roh, kosten), gesamtinvest(OBJEKT_A_STAMM));
    assert.ok(r.wert !== null);
    assert.equal(Math.round((r.wert as number) * 1e6) / 1e6, 0.055429);
  });

  test("Quoten sind Bruchzahlen, nicht Prozentzahlen", () => {
    // 28.000 / 560.000 = 0,05. Stuende hier 5, wuerde die Oberflaeche
    // daraus 500 % machen -- sie multipliziert mit 100.
    const r = nettomietrendite(
      jahresreinertrag(
        rohertragGestellt(basis({ sollGestellt: 40_000, gestellteMonate: 12 })),
        bewirtschaftungskosten(LEERER_STAMM, basis({ belege: 1, belegkosten: 12_000 }), 40_000),
      ),
      gesamtinvest(OBJEKT_A_STAMM),
    );
    assert.equal(r.wert, 0.05);
    assert.equal(r.einheit, "prozent");
  });

  test("ohne Kaufpreis ist die Nettomietrendite null, nicht 0 %", () => {
    const l = wirtschaftLage(
      stamm({ bewirtschaftung_jahr: 12_000 }),
      OBJEKT_A_BASIS,
    );
    assert.equal(l.nettomietrendite.wert, null);
    assert.notEqual(l.nettomietrendite.wert, 0);
    assert.match(l.nettomietrendite.grund ?? "", /Kaufpreis/);
  });

  test("negativer Reinertrag ergibt eine negative Rendite, nicht 0", () => {
    // Rohertrag 48.000, Kosten 60.000 (Sanierungsjahr) => -12.000
    // -12.000 / 560.000 = -0,0214285714... = -2,143 %
    const rein = jahresreinertrag(
      rohertragGestellt(OBJEKT_A_BASIS),
      bewirtschaftungskosten(
        stamm({ bewirtschaftung_jahr: 60_000 }),
        OBJEKT_A_BASIS,
        48_000,
      ),
    );
    assert.equal(rein.wert, -12_000);
    const r = nettomietrendite(rein, gesamtinvest(OBJEKT_A_STAMM));
    assert.ok(r.wert !== null);
    assert.ok((r.wert as number) < 0, "Ein Verlustjahr muss negativ dastehen.");
    assert.equal(Math.round((r.wert as number) * 1e6) / 1e6, -0.021429);
  });

  test("die Vertragssicht steht neben der gestellten Sicht", () => {
    // Gestellt 44.000 (ein Zimmer stand leer), laut Vertrag 48.000, Kosten
    // je 12.000 => Reinertrag 32.000 bzw. 36.000.
    // 32.000 / 560.000 = 5,714 %   36.000 / 560.000 = 6,429 %
    const l = wirtschaftLage(
      { ...OBJEKT_A_STAMM, bewirtschaftung_jahr: 12_000 },
      basis({
        sollMonat: 4_000,
        mietverhaeltnisse: 8,
        sollGestellt: 44_000,
        gestellteMonate: 12,
      }),
    );
    assert.equal(l.jahresreinertrag.wert, 32_000);
    assert.equal(Math.round((l.nettomietrendite.wert as number) * 1e6) / 1e6, 0.057143);
    assert.equal(
      Math.round((l.nettomietrenditeLautVertrag.wert as number) * 1e6) / 1e6,
      0.064286,
    );
    assert.ok(
      (l.nettomietrenditeLautVertrag.wert as number) >
        (l.nettomietrendite.wert as number),
      "Die Vertragssicht ist die Obergrenze; der Abstand ist der Leerstand.",
    );
  });

  test("Rendite auf den Verkehrswert nur mit erfasstem Verkehrswert", () => {
    // Reinertrag 36.000 / Verkehrswert 720.000 = 5,0 %
    const l = wirtschaftLage(
      { ...OBJEKT_A_STAMM, bewirtschaftung_jahr: 12_000, verkehrswert: 720_000 },
      OBJEKT_A_BASIS,
    );
    assert.equal(l.jahresreinertrag.wert, 36_000);
    assert.equal(l.nettomietrenditeAufVerkehrswert.wert, 0.05);

    const ohne = wirtschaftLage(
      { ...OBJEKT_A_STAMM, bewirtschaftung_jahr: 12_000 },
      OBJEKT_A_BASIS,
    );
    assert.equal(ohne.nettomietrenditeAufVerkehrswert.wert, null);
    assert.match(ohne.nettomietrenditeAufVerkehrswert.grund ?? "", /Verkehrswert/);
  });
});

// ---------------------------------------------------------------------------
// Vervielfaeltiger
//
// Verhindert: einen negativen Faktor. "-18 Jahresmieten" liest sich wie
// eine kurze Amortisation und ist das Gegenteil davon.
// ---------------------------------------------------------------------------

describe("Rohertrags- und Reinertragsfaktor", () => {
  test("Gesamtinvest durch Ertrag", () => {
    // Rohertragsfaktor  560.000 / 48.000 = 11,667
    // Reinertragsfaktor 560.000 / 36.000 = 15,556
    const l = wirtschaftLage(
      { ...OBJEKT_A_STAMM, bewirtschaftung_jahr: 12_000 },
      OBJEKT_A_BASIS,
    );
    assert.equal(Math.round((l.rohertragsfaktor.wert as number) * 1000) / 1000, 11.667);
    assert.equal(Math.round((l.reinertragsfaktor.wert as number) * 1000) / 1000, 15.556);
  });

  test("bei negativem Reinertrag gibt es keinen Faktor", () => {
    const rein = jahresreinertrag(
      rohertragGestellt(OBJEKT_A_BASIS),
      bewirtschaftungskosten(
        stamm({ bewirtschaftung_jahr: 60_000 }),
        OBJEKT_A_BASIS,
        48_000,
      ),
    );
    const f = faktor(gesamtinvest(OBJEKT_A_STAMM), rein, "Reinertrag");
    assert.equal(f.wert, null);
    assert.match(f.grund ?? "", /nicht positiv/);
  });

  test("bei einem Ertrag von 0 wird nicht geteilt", () => {
    const rein = jahresreinertrag(
      rohertragGestellt(basis({ sollGestellt: 12_000, gestellteMonate: 12 })),
      bewirtschaftungskosten(stamm({ bewirtschaftung_jahr: 12_000 }), LEERE_BASIS, 12_000),
    );
    assert.equal(rein.wert, 0);
    const f = faktor(gesamtinvest(OBJEKT_A_STAMM), rein, "Reinertrag");
    assert.equal(f.wert, null);
    assert.equal(Number.isFinite(f.wert as unknown as number), false);
  });
});

// ---------------------------------------------------------------------------
// Finanzierung
//
// Verhindert: eine Eigenkapitalrendite, die eine Finanzierung unterstellt,
// die niemand erfasst hat. Ein leeres Darlehensfeld heisst "unbekannt" --
// schuldenfrei wird mit 0 eingetragen.
// ---------------------------------------------------------------------------

describe("Eigenkapital, Cashflow, Zinsdeckung", () => {
  const FINANZIERT = {
    ...OBJEKT_A_STAMM,
    bewirtschaftung_jahr: 12_000,
    darlehen_restschuld: 400_000,
    darlehen_zins_satz: 3.5,
    darlehen_rate_monat: 1_800,
  };

  test("Eigenkapital ist Gesamtinvest minus Restschuld", () => {
    // 560.000 - 400.000 = 160.000
    const e = eigenkapital(FINANZIERT, gesamtinvest(FINANZIERT));
    assert.equal(e.wert, 160_000);
    assert.match(e.grundlage, /herung/, "Die Naeherung muss dabeistehen.");
  });

  test("Cashflow ist Reinertrag minus Annuitaet", () => {
    // Reinertrag 36.000 - 12 x 1.800 (= 21.600) = 14.400
    const l = wirtschaftLage(FINANZIERT, OBJEKT_A_BASIS);
    assert.equal(l.cashflowJahr.wert, 14_400);
  });

  test("Eigenkapitalrendite ist Cashflow durch Eigenkapital", () => {
    // 14.400 / 160.000 = 0,09 = 9 %
    const l = wirtschaftLage(FINANZIERT, OBJEKT_A_BASIS);
    assert.equal(l.eigenkapitalrendite.wert, 0.09);
  });

  test("Zinsdeckung ist Reinertrag durch Jahreszins", () => {
    // Jahreszins 400.000 x 3,5 % = 14.000
    // 36.000 / 14.000 = 2,571
    const l = wirtschaftLage(FINANZIERT, OBJEKT_A_BASIS);
    assert.equal(Math.round((l.zinsdeckung.wert as number) * 1000) / 1000, 2.571);
    assert.equal(l.zinsdeckung.einheit, "faktor");
  });

  test("ohne erfasste Restschuld gibt es kein Eigenkapital", () => {
    const e = eigenkapital(OBJEKT_A_STAMM, gesamtinvest(OBJEKT_A_STAMM));
    assert.equal(e.wert, null);
    assert.match(e.grund ?? "", /0/, "Der Grund muss den Weg nennen: 0 eintragen.");
  });

  test("ohne erfasste Rate gibt es keinen Cashflow", () => {
    const c = cashflowJahr(
      jahresreinertrag(
        rohertragGestellt(OBJEKT_A_BASIS),
        bewirtschaftungskosten(stamm({ bewirtschaftung_jahr: 12_000 }), OBJEKT_A_BASIS, 48_000),
      ),
      OBJEKT_A_STAMM,
    );
    assert.equal(c.wert, null);
    assert.match(c.grund ?? "", /Darlehensrate/);
  });

  test("schuldenfrei mit 0 erfasst ergibt Zahlen, keine Luecken", () => {
    const schuldenfrei = {
      ...OBJEKT_A_STAMM,
      bewirtschaftung_jahr: 12_000,
      darlehen_restschuld: 0,
      darlehen_zins_satz: 0,
      darlehen_rate_monat: 0,
    };
    const l = wirtschaftLage(schuldenfrei, OBJEKT_A_BASIS);
    assert.equal(l.eigenkapital.wert, 560_000);
    assert.equal(l.cashflowJahr.wert, 36_000);
    // 36.000 / 560.000 = 0,0642857...
    assert.equal(Math.round((l.eigenkapitalrendite.wert as number) * 1e6) / 1e6, 0.064286);
    // Zinsdeckung gibt es nicht: Es gibt keinen Zins zu decken. Das ist
    // kein fehlender Wert, sondern eine Frage ohne Gegenstand.
    assert.equal(l.zinsdeckung.wert, null);
    assert.match(l.zinsdeckung.grund ?? "", /kein Zins/);
  });

  test("Eigenkapital 0 ergibt keine Division", () => {
    const voll = {
      ...OBJEKT_A_STAMM,
      bewirtschaftung_jahr: 12_000,
      darlehen_restschuld: 560_000,
      darlehen_rate_monat: 1_800,
    };
    const l = wirtschaftLage(voll, OBJEKT_A_BASIS);
    assert.equal(l.eigenkapital.wert, 0);
    assert.equal(l.eigenkapitalrendite.wert, null);
    assert.equal(Number.isFinite(l.eigenkapitalrendite.wert as unknown as number), false);
  });

  test("fehlt der Zinssatz, nennt der Grund den Zinssatz", () => {
    const z = zinsdeckung(
      jahresreinertrag(
        rohertragGestellt(OBJEKT_A_BASIS),
        bewirtschaftungskosten(stamm({ bewirtschaftung_jahr: 12_000 }), OBJEKT_A_BASIS, 48_000),
      ),
      { ...OBJEKT_A_STAMM, darlehen_restschuld: 400_000 },
    );
    assert.equal(z.wert, null);
    assert.match(z.grund ?? "", /Zinssatz/);
  });
});

// ---------------------------------------------------------------------------
// Miete je Quadratmeter
//
// Verhindert: die Miete aller Einheiten auf die Flaeche weniger Einheiten
// zu verteilen. Sind vier von neun Zimmern mit Flaeche erfasst, ist das
// Ergebnis gut doppelt so hoch -- und zwar in genau der Groessenordnung, in
// der eine Miete je m2 noch plausibel aussieht. Auf so einer Zahl beruht
// dann eine Mieterhoehung.
// ---------------------------------------------------------------------------

describe("Miete je Quadratmeter", () => {
  test("Monatssoll durch erfasste Flaeche", () => {
    // 4.000 / 400 = 10,00 EUR/m2
    const m = mieteJeQmMonat(OBJEKT_A_BASIS);
    assert.equal(m.wert, 10);
    assert.equal(m.einheit, "euro_je_qm");
    assert.match(m.grundlage, /8 von 8/);
  });

  test("Flaeche nur teilweise erfasst: null, und der Grund nennt die Zahl", () => {
    // Vier von neun Einheiten mit Flaeche. Gerechnet waeren es
    // 4.000 / 160 = 25,00 EUR/m2 statt der wirklichen ca. 11.
    const m = mieteJeQmMonat(
      basis({
        sollMonat: 4_000,
        flaeche: 160,
        belegteEinheiten: 9,
        belegteEinheitenMitFlaeche: 4,
      }),
    );
    assert.equal(m.wert, null);
    assert.match(m.grund ?? "", /9 vermieteten Einheiten/);
    assert.match(m.grund ?? "", /5/, "Der Grund muss die Zahl ohne Flaeche nennen.");
  });

  test("genau die Haelfte erfasst reicht noch, und die Grundlage sagt es", () => {
    // 4.000 / 200 = 20,00 -- die Zahl steht, aber mit Ansage: vier von acht
    // Einheiten. Die Schwelle liegt bei der Haelfte, nicht darunter.
    const m = mieteJeQmMonat(
      basis({
        sollMonat: 4_000,
        flaeche: 200,
        belegteEinheiten: 8,
        belegteEinheitenMitFlaeche: 4,
      }),
    );
    assert.equal(m.wert, 20);
    assert.match(m.grundlage, /4 ohne Angabe/);
  });

  test("ohne vermietete Einheit gibt es keine Miete je m2", () => {
    const m = mieteJeQmMonat(LEERE_BASIS);
    assert.equal(m.wert, null);
    assert.match(m.grund ?? "", /keine vermietete Einheit/);
  });

  test("Flaeche 0 bei gepflegten Einheiten ergibt keine Division", () => {
    const m = mieteJeQmMonat(
      basis({
        sollMonat: 4_000,
        flaeche: 0,
        belegteEinheiten: 2,
        belegteEinheitenMitFlaeche: 2,
      }),
    );
    assert.equal(m.wert, null);
    assert.equal(Number.isFinite(m.wert as unknown as number), false);
  });
});

// ---------------------------------------------------------------------------
// Flaechengrundlage
//
// Verhindert: die Flaeche einer WG-Etage als 0 zu lesen. Im 2. OG laeuft
// ein Altmietverhaeltnis ueber die ganze Etage; die Etage selbst hat keine
// Flaechenangabe, ihre fuenf Zimmer schon.
// ---------------------------------------------------------------------------

describe("Flaechengrundlage", () => {
  test("nur Einheiten mit eigenem Vertrag zaehlen", () => {
    const g = flaechenGrundlage([
      { id: "a", eltern_id: null, flaeche_qm: "30.00", hatVertrag: true },
      { id: "b", eltern_id: null, flaeche_qm: "25.50", hatVertrag: true },
      { id: "c", eltern_id: null, flaeche_qm: "40.00", hatVertrag: false },
    ]);
    assert.equal(g.flaeche, 55.5);
    assert.equal(g.belegteEinheiten, 2);
    assert.equal(g.belegteEinheitenMitFlaeche, 2);
  });

  test("eine WG-Etage ohne eigene Flaeche zaehlt ihre Zimmer", () => {
    // Etage ohne Angabe, Zimmer 18,50 + 21,30 + 15,20 = 55,00
    const g = flaechenGrundlage([
      { id: "etage", eltern_id: null, flaeche_qm: null, hatVertrag: true },
      { id: "z1", eltern_id: "etage", flaeche_qm: "18.50", hatVertrag: false },
      { id: "z2", eltern_id: "etage", flaeche_qm: "21.30", hatVertrag: false },
      { id: "z3", eltern_id: "etage", flaeche_qm: "15.20", hatVertrag: false },
    ]);
    assert.equal(g.flaeche, 55);
    assert.equal(g.belegteEinheiten, 1);
    assert.equal(g.belegteEinheitenMitFlaeche, 1);
  });

  test("ohne jede Angabe bleibt die Einheit als Luecke gezaehlt", () => {
    const g = flaechenGrundlage([
      { id: "a", eltern_id: null, flaeche_qm: "30.00", hatVertrag: true },
      { id: "b", eltern_id: null, flaeche_qm: null, hatVertrag: true },
    ]);
    assert.equal(g.flaeche, 30);
    assert.equal(g.belegteEinheiten, 2);
    assert.equal(
      g.belegteEinheitenMitFlaeche,
      1,
      "Die Einheit ohne Flaeche muss in der Differenz sichtbar bleiben.",
    );
  });
});

// ---------------------------------------------------------------------------
// Zahlungstreue
//
// Verhindert den teuersten Fehler der ganzen Anwendung: einen Monat ohne
// Kontoauszug als unbezahlt zu zaehlen. In Ludwigshafen sind das elf Monate
// aus 2024, deren Mieten dem Voreigentuemer zuflossen -- als Ausfallquote
// gerechnet waeren es ueber zwanzig Monatsmieten Rueckstand, die es nie
// gab (db/023).
// ---------------------------------------------------------------------------

describe("Mietausfall- und Inkassoquote", () => {
  test("Ausfallquote ist Rueckstand durch faelliges Soll", () => {
    // Soll 44.000, Ist 42.900 => Rueckstand 1.100
    // 1.100 / 44.000 = 0,025 = 2,5 %
    const q = mietausfallquote(OBJEKT_A_BASIS);
    assert.equal(q.wert, 0.025);
    assert.match(q.grundlage, /11 abgeschlossene Monate/);
  });

  test("Inkassoquote ist zugeordnetes Ist durch faelliges Soll", () => {
    // 42.900 / 44.000 = 0,975 = 97,5 %
    const q = inkassoquote(OBJEKT_A_BASIS);
    assert.equal(q.wert, 0.975);
  });

  test("ohne Kontodaten keine Quote -- auch keine von 100 %", () => {
    const b = basis({ sollGestellt: 48_000, gestellteMonate: 12, monateMitKontodaten: 0 });
    assert.equal(mietausfallquote(b).wert, null);
    assert.equal(
      inkassoquote(b).wert,
      null,
      "Eine Inkassoquote von 100 % waere hier eine Behauptung ueber Daten, " +
        "die es nicht gibt.",
    );
    assert.match(mietausfallquote(b).grund ?? "", /Kontodaten/);
  });

  test("faelliges Soll 0 ergibt keine Division", () => {
    const b = basis({ monateMitKontodaten: 3, sollFaellig: 0, istZugeordnet: 0 });
    assert.equal(mietausfallquote(b).wert, null);
    assert.equal(Number.isFinite(inkassoquote(b).wert as unknown as number), false);
  });
});

// ---------------------------------------------------------------------------
// Schema gegen Code
//
// Verhindert genau den Fehler, den tests/schema.test.ts fuer db/017
// festhaelt: einen Spaltennamen, der nirgends existiert. Die Stammdaten
// werden ueber SELECT mit Spaltennamen gelesen; ein Tippfehler im
// TypeScript-Schluessel wirft keinen Fehler, sondern liefert undefined --
// und daraus wird null, also "kein Kaufpreis erfasst", obwohl einer
// erfasst ist. Die Anwendung wuerde dann behaupten, der Eigentuemer habe
// nichts gepflegt.
// ---------------------------------------------------------------------------

const APP = join(import.meta.dirname, "..");
const MIGRATION = join(APP, "..", "db", "030_wirtschaft.sql");
const RENDITE = join(APP, "lib", "rendite.ts");

/** Die Spalten, die db/030 anlegt. */
function spaltenDerMigration(): string[] {
  const sql = readFileSync(MIGRATION, "utf8");
  return [
    ...sql.matchAll(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+([a-z_][a-z0-9_]*)/gi),
  ].map((t) => t[1].toLowerCase());
}

/** Die Schluessel, die WirtschaftStamm in lib/rendite.ts fuehrt. */
function schluesselDesStamms(): string[] {
  const quelle = readFileSync(RENDITE, "utf8");
  const block = quelle.match(
    /export interface WirtschaftStamm \{([\s\S]*?)\n\}/,
  );
  assert.ok(block, "WirtschaftStamm nicht gefunden -- wurde es umbenannt?");
  return [...block[1].matchAll(/^\s{2}([a-z_][a-z0-9_]*)\s*:/gm)].map((t) =>
    t[1].toLowerCase(),
  );
}

describe("db/030 und lib/rendite.ts beschreiben dieselben Spalten", () => {
  test("die Migration legt genau zehn Spalten an", () => {
    assert.equal(spaltenDerMigration().length, 10);
  });

  test("Spaltennamen und TypeScript-Schluessel stimmen woertlich ueberein", () => {
    const spalten = [...spaltenDerMigration()].sort();
    const schluessel = [...schluesselDesStamms()].sort();
    assert.deepEqual(
      schluessel,
      spalten,
      "Ein Schluessel, der keine Spalte trifft, wird still null -- und die " +
        "Kennzahl sagt dann, der Wert sei nicht erfasst.",
    );
  });

  test("jede Spalte wird auch wirklich abgefragt", () => {
    const quelle = readFileSync(RENDITE, "utf8");
    const abfrage = quelle.match(/const STAMM_SQL = `([\s\S]*?)`/);
    assert.ok(abfrage, "STAMM_SQL nicht gefunden.");
    const fehlend = spaltenDerMigration().filter(
      (s) => !abfrage[1].includes(s),
    );
    assert.deepEqual(fehlend, [], `Nicht abgefragte Spalten: ${fehlend}`);
  });

  test("jede Spalte hat einen COMMENT ON COLUMN", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const fehlend = spaltenDerMigration().filter(
      (s) => !new RegExp(`COMMENT ON COLUMN objekt\\.${s}\\b`, "i").test(sql),
    );
    assert.deepEqual(
      fehlend,
      [],
      "Ohne Kommentar in der Datenbank weiss in zwei Jahren niemand mehr, " +
        `was in der Spalte stehen soll: ${fehlend}`,
    );
  });

  /**
   * Mandantentrennung -- die Pruefung, die bei einem Mehrmandantenprodukt
   * ueber allem steht.
   *
   * db/030 haengt die zehn Spalten an `objekt`. Diese Tabelle traegt seit
   * db/010_mandant.sql mandant_id, eine Policy mit USING und WITH CHECK
   * sowie ENABLE und FORCE ROW LEVEL SECURITY; neue Spalten erben das.
   *
   * Eine EIGENE Tabelle wuerde das nicht erben, und genau daran ist es in
   * dieser Anwendung schon viermal gescheitert -- db/019_mandantengrenzen.sql
   * ist ein ganzer Nachtrag dafuer. Der Test laesst deshalb keine neue
   * Tabelle ohne das volle Muster durch: Ohne Policy wuerde eine
   * Renditeabfrage die Kaufpreise und Darlehen eines fremden Unternehmens
   * mitrechnen -- und das Ergebnis saehe aus wie eine richtige Zahl.
   */
  test("db/030 legt keine Tabelle an; falls doch, mit Mandantenschutz", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const tabellen = [
      ...sql.matchAll(
        /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi,
      ),
    ].map((t) => t[1].toLowerCase());

    if (tabellen.length === 0) {
      // Der erwartete Zustand: nur ALTER TABLE objekt.
      assert.match(sql, /ALTER TABLE objekt/);
      return;
    }

    for (const t of tabellen) {
      assert.match(sql, new RegExp(`mandant_id[\\s\\S]*aktueller_mandant\\(\\)`),
        `${t} braucht mandant_id mit DEFAULT aktueller_mandant().`);
      assert.match(sql, new RegExp(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`, "i"),
        `${t} braucht ENABLE ROW LEVEL SECURITY.`);
      assert.match(sql, new RegExp(`ALTER TABLE ${t} FORCE\\s+ROW LEVEL SECURITY`, "i"),
        `${t} braucht FORCE ROW LEVEL SECURITY -- ohne das umgeht der ` +
          "Eigentuemer der Tabelle die Policy.");
      assert.match(sql, /CREATE POLICY mandant_trennung/i, `${t} braucht eine Policy.`);
      assert.match(sql, /WITH CHECK \(mandant_id = aktueller_mandant\(\)\)/i,
        `${t} braucht WITH CHECK, sonst sind fremde INSERTs moeglich.`);
      // UNIQUE ohne mandant_id als erste Spalte: der Fehler aus db/019.
      for (const u of sql.matchAll(/UNIQUE\s*\(([^)]*)\)/gi)) {
        assert.match(u[1].trim(), /^mandant_id/i,
          `UNIQUE (${u[1].trim()}) fuehrt mandant_id nicht als erste Spalte.`);
      }
    }
  });

  test("die Ladefunktionen fragen nur ueber tx() ab", () => {
    // tx() setzt app.mandant per SET LOCAL und wirft ohne Mandanten; eine
    // Abfrage daran vorbei wuerde fremde Kaufpreise mitrechnen. Dass die
    // Datei query() nicht einmal einbindet, ist die billigste Pruefung
    // dafuer -- und faellt auf, sobald es jemand hinzufuegt.
    //
    // Geprueft wird die Einbindung und nicht der Fliesstext: In den
    // Kommentaren stehen "query()" und "mitMandant()" als Erklaerung, warum
    // sie hier nicht benutzt werden. Ein Test, der auf das Wort anspringt,
    // waere also beim ersten Kommentar rot und danach geloescht.
    const quelle = readFileSync(RENDITE, "utf8");
    const ausDb = [...quelle.matchAll(/import\s*\{([^}]*)\}\s*from\s*"\.\/db"/g)];
    assert.equal(ausDb.length, 1, "Genau eine Einbindung aus lib/db.ts erwartet.");
    assert.deepEqual(
      ausDb[0][1].split(",").map((n) => n.trim()).filter(Boolean),
      ["tx"],
      "lib/rendite.ts soll allein ueber tx() abfragen -- eine Transaktion, " +
        "ein Mandant, ein Stand.",
    );
    assert.equal(
      /from\s*"\.\/mandant"/.test(quelle),
      false,
      "mitMandant() aus lib/mandant.ts wuerde den Mandanten von aussen " +
        "setzen; er kommt aus der Sitzung.",
    );
  });

  test("die Migration ist idempotent und laeuft in einer Transaktion", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    assert.match(sql, /^BEGIN;/m);
    assert.match(sql, /^COMMIT;/m);
    assert.equal(
      /ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)/i.test(sql),
      false,
      "Ein ADD COLUMN ohne IF NOT EXISTS laesst migrieren.sh beim zweiten " +
        "Lauf abbrechen.",
    );
  });
});

// ---------------------------------------------------------------------------
// Aufteilung des Monatssolls in Kalt und Nebenkosten
//
// Verhindert: eine Kaltmiete, die niemand vereinbart hat. Rund zwei Drittel
// der WG-Zimmer sind als Inklusivmiete vermietet ("500 EUR all-in, keine
// Nebenkosten") und haben gar keine getrennte Kaltmiete. Faellt die
// Pruefung weg, verteilt die Objektseite den ganzen Inklusivbetrag auf die
// Spalte "Kalt" -- und aus dieser Spalte wird ein Quadratmeterpreis und
// eine Mieterhoehung abgeleitet. Dasselbe gilt fuer den
// Moeblierungszuschlag: rechtlich Teil der Grundmiete, aber kein Betrag,
// aus dem sich eine Mieterhoehung begruenden laesst.
// ---------------------------------------------------------------------------

/** Eine Einheit mit laufendem Vertrag, nur mit den Feldern, die hier zaehlen. */
function einheit(
  bezeichnung: string,
  miete: {
    kalt?: string | null;
    nk?: string | null;
    moebel?: string | null;
    gesamt?: string | null;
  },
): ObjektEinheit {
  return {
    id: `e-${bezeichnung}`,
    objekt_id: "objekt-a",
    bezeichnung,
    etage: null,
    art: "wohnen",
    flaeche_qm: null,
    schluessel: null,
    eltern_id: null,
    eltern: null,
    vermarktung: "nicht_anbieten",
    verfuegbar_ab: null,
    belegung_gepflegt: true,
    angebot_kaltmiete: null,
    angebot_nebenkosten: null,
    mv_id: `mv-${bezeichnung}`,
    mieter: "Mieter A",
    beginn: "2025-01-01",
    ende: null,
    status: "aktiv",
    m_kalt: miete.kalt ?? null,
    m_nk: miete.nk ?? null,
    m_moebel: miete.moebel ?? null,
    m_gesamt: miete.gesamt ?? null,
  };
}

describe("Soll je Monat, aufgeteilt in Kalt und Nebenkosten", () => {
  test("eine Inklusivmiete erhoeht die Kaltmiete um null", () => {
    // "500 EUR all-in": nur eine Gesamtmiete, keine Posten. Ohne diese
    // Pruefung stuenden auf der Objektseite 500 EUR Kaltmiete, die in
    // keinem Mietvertrag stehen -- und zwar fuer zwei Drittel der Zimmer.
    const a = sollAufteilung({
      kaltmiete: null,
      nebenkosten: null,
      moeblierung: null,
      gesamtmiete: "500.00",
    });
    assert.equal(a.summe, 500);
    assert.equal(a.kalt, 0);
    assert.equal(a.nebenkosten, 0);
    assert.equal(a.ohneAufteilung, 500);
  });

  test("der Moeblierungszuschlag landet nicht in der Kaltmiete", () => {
    // Kalt 380, NK 70, Moeblierung 50, keine Gesamtmiete => Soll 500.
    const a = sollAufteilung({
      kaltmiete: "380.00",
      nebenkosten: "70.00",
      moeblierung: "50.00",
      gesamtmiete: null,
    });
    assert.equal(a.summe, 500);
    assert.equal(a.kalt, 380);
    assert.equal(a.nebenkosten, 70);
    assert.equal(a.ohneAufteilung, 50);
  });

  test("bei zugesagter Gesamtmiete gilt die Zusage, der Rest ist nicht Kalt", () => {
    // Posten 380 + 70 = 450, zugesagt sind 520 => 70 Rest. Geschuldet ist
    // die Zusage (sollGesamt in lib/sollstellung.ts); der Rest ist
    // Moeblierung oder ein Pflegefehler, aber keine Kaltmiete.
    const a = sollAufteilung({
      kaltmiete: "380.00",
      nebenkosten: "70.00",
      moeblierung: null,
      gesamtmiete: "520.00",
    });
    assert.equal(a.summe, 520);
    assert.equal(a.kalt, 380);
    assert.equal(a.nebenkosten, 70);
    assert.equal(a.ohneAufteilung, 70);
  });

  test("liegt die Zusage unter den Posten, bleibt die Summe trotzdem stimmig", () => {
    // Posten 380 + 70 = 450, zugesagt 420 => -30. Ein Tippfehler in den
    // Stammdaten. Er bleibt sichtbar, statt die Summe zu zerstoeren --
    // sonst zeigte die Objektseite eine andere Zahl als das Mietenbuch.
    const a = sollAufteilung({
      kaltmiete: "380.00",
      nebenkosten: "70.00",
      moeblierung: null,
      gesamtmiete: "420.00",
    });
    assert.equal(a.summe, 420);
    assert.equal(a.kalt + a.nebenkosten + a.ohneAufteilung, 420);
    assert.equal(a.ohneAufteilung, -30);
  });

  test("Kalt plus NK plus ohne Aufteilung ergibt genau das Monatssoll", () => {
    // Gemischte Belegung, von Hand gerechnet:
    //   Zimmer 1  Inklusiv            500,00  ->  ohne Aufteilung 500,00
    //   Zimmer 2  380,00 + 70,00      450,00  ->  Kalt 380,00  NK  70,00
    //   Zimmer 3  310,50 + 64,50 + 50 425,00  ->  Kalt 310,50  NK  64,50
    //                                               ohne Aufteilung 50,00
    //   Zimmer 4  Zusage 520, Posten 380+70   ->  Kalt 380,00  NK  70,00
    //                                               ohne Aufteilung 70,00
    //   Zimmer 5  ohne Vertrag                ->  nichts
    //   Summe Soll            500 + 450 + 425 + 520 = 1.895,00
    //   Kalt                  380 + 310,50 + 380    = 1.070,50
    //   Nebenkosten            70 +  64,50 +  70    =   204,50
    //   ohne Aufteilung       500 +      50 +  70    =   620,00
    //   Probe                1.070,50 + 204,50 + 620 = 1.895,00
    const ohneVertrag: ObjektEinheit = {
      ...einheit("5", {}),
      mv_id: null,
      mieter: null,
      beginn: null,
      status: null,
    };
    const z = objektKennzahlen([
      einheit("1", { gesamt: "500.00" }),
      einheit("2", { kalt: "380.00", nk: "70.00" }),
      einheit("3", { kalt: "310.50", nk: "64.50", moebel: "50.00" }),
      einheit("4", { kalt: "380.00", nk: "70.00", gesamt: "520.00" }),
      ohneVertrag,
    ]);

    assert.equal(z.sollMonat, 1_895);
    assert.equal(z.sollMonatKalt, 1_070.5);
    assert.equal(z.sollMonatNebenkosten, 204.5);
    assert.equal(z.sollMonatOhneAufteilung, 620);
    assert.equal(
      z.sollMonatKalt + z.sollMonatNebenkosten + z.sollMonatOhneAufteilung,
      z.sollMonat,
      "Die drei Teile muessen auf den Cent genau das Soll ergeben, sonst " +
        "widerspricht die Objektseite dem Mietenbuch.",
    );
  });

  test("ein Objekt ohne Vertraege hat drei Nullen, nicht NaN", () => {
    const z = objektKennzahlen([]);
    assert.equal(z.sollMonat, 0);
    assert.equal(z.sollMonatKalt, 0);
    assert.equal(z.sollMonatNebenkosten, 0);
    assert.equal(z.sollMonatOhneAufteilung, 0);
  });
});

// ---------------------------------------------------------------------------
// Die ganze Lage
//
// Verhindert: ein halb gefuelltes Objekt, das trotzdem Zahlen zeigt. Bei
// einem Objekt ohne jedes gepflegte Feld muss JEDE Kennzahl null sein und
// einen lesbaren Grund haben -- keine einzige 0, keine NaN, kein Infinity.
// ---------------------------------------------------------------------------

describe("Gesamtbild", () => {
  test("ein ungepflegtes Objekt zeigt keine einzige Zahl", () => {
    const l = wirtschaftLage(LEERER_STAMM, LEERE_BASIS);
    for (const [name, k] of Object.entries(l)) {
      assert.equal(k.wert, null, `${name} behauptet eine Zahl: ${k.wert}`);
      assert.ok(
        k.grund && k.grund.length > 10,
        `${name} hat keinen lesbaren Grund.`,
      );
      assert.ok(k.grundlage.length > 0, `${name} hat keine Grundlage.`);
    }
  });

  test("jede Kennzahl nennt eine Grundlage, auch die berechneten", () => {
    const l = wirtschaftLage(
      {
        ...OBJEKT_A_STAMM,
        bewirtschaftung_jahr: 12_000,
        verkehrswert: 720_000,
        darlehen_restschuld: 400_000,
        darlehen_zins_satz: 3.5,
        darlehen_rate_monat: 1_800,
      },
      OBJEKT_A_BASIS,
    );
    for (const [name, k] of Object.entries(l)) {
      assert.equal(k.grund, null, `${name} sollte berechenbar sein: ${k.grund}`);
      assert.ok(k.wert !== null, `${name} hat keinen Wert.`);
      assert.equal(Number.isFinite(k.wert as number), true, `${name} ist nicht endlich.`);
      assert.ok(k.grundlage.length > 10, `${name} hat keine pruefbare Grundlage.`);
    }
  });

  test("Geldbetraege sind auf Cent gerundet", () => {
    const l = wirtschaftLage(
      { ...OBJEKT_A_STAMM, kaufpreis: 333_333.33, bewirtschaftung_jahr: 11_111.11 },
      basis({ sollMonat: 1_111.11, mietverhaeltnisse: 3, sollGestellt: 13_333.32, gestellteMonate: 12 }),
    );
    for (const [name, k] of Object.entries(l)) {
      if (k.einheit !== "euro" || k.wert === null) continue;
      assert.equal(
        k.wert,
        Math.round(k.wert * 100) / 100,
        `${name} hat mehr als zwei Nachkommastellen: ${k.wert}`,
      );
    }
  });
});

// ===========================================================================
// Die Laufmiete: Momentaufnahme und Zeitverlauf
// ===========================================================================
//
// Pruefstand fuer die Reihe. Die Zeilen sehen aus wie das, was die Abfrage in
// ladeLaufmiete() liefert: je Monat des Rasters und je Mietverhaeltnis eine
// Zeile mit den Posten, die an diesem Monatsersten galten (miete_am(), db/022).
//
// KEINE ECHTEN DATEN. Keine Mieternamen, keine Adressen, keine
// Telefonnummern -- "Mieter A", "Objekt A", example.org. In einer frueheren
// Fassung dieser Tests standen echte Mietverhaeltnisse mit echten Betraegen;
// Tests werden herumgeschickt, in Fehlerberichte kopiert und liegen in jedem
// Klon des Repos.

/** Ein Vertrag im Pruefstand: Laufzeit und die Posten je Stichtag. */
interface Pruefvertrag {
  id: string;
  beginn: string;
  ende?: string | null;
  /** Was miete_am() am jeweiligen Monatsersten liefert. */
  posten: (monatsErster: string) => {
    kaltmiete?: string | null;
    nebenkosten?: string | null;
    moeblierung?: string | null;
    gesamtmiete?: string | null;
  };
}

/** Erster des Monats, den `verschiebung` Monate von `heute` entfernt liegt. */
function monatsErster(heute: Date, verschiebung: number): string {
  const d = new Date(
    Date.UTC(heute.getUTCFullYear(), heute.getUTCMonth() + verschiebung, 1),
  );
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** Das Monatsraster des Fensters, wie die Abfrage es aufspannt. */
function rasterMonate(heute: Date, zurueck = 12, vorwaerts = 12): string[] {
  const monate: string[] = [];
  for (let i = -zurueck; i <= vorwaerts; i++) monate.push(monatsErster(heute, i));
  return monate;
}

/**
 * Die Zeilen, die die Abfrage liefern wuerde.
 *
 * Absichtlich OHNE Stichtagsfilter: Die Abfrage grenzt nur das Fenster ein,
 * und ob ein Vertrag in einem Monat zaehlt, entscheidet laufmieteReihe().
 * Genau das soll hier geprueft werden -- waere der Filter schon im
 * Pruefstand, pruefte der Test den Pruefstand.
 */
function pruefZeilen(
  heute: Date,
  vertraege: Pruefvertrag[],
  zurueck = 12,
  vorwaerts = 12,
): LaufmieteZeile[] {
  const zeilen: LaufmieteZeile[] = [];
  for (const monat of rasterMonate(heute, zurueck, vorwaerts)) {
    for (const v of vertraege) {
      zeilen.push({
        monat,
        mietverhaeltnis_id: v.id,
        beginn: v.beginn,
        ende: v.ende ?? null,
        kaltmiete: null,
        nebenkosten: null,
        moeblierung: null,
        gesamtmiete: null,
        ...v.posten(monat),
      });
    }
  }
  return zeilen;
}

/** Ein feststehender Zeitpunkt -- kein new Date() ohne Uebergabe. */
const HEUTE = new Date("2026-11-04T10:00:00Z");

/** Immer derselbe Betrag, egal welcher Stichtag. */
const fest =
  (posten: ReturnType<Pruefvertrag["posten"]>) => () => posten;

/** Den Punkt zu einem Monat holen -- liest sich im Test besser als ein Index. */
function punkt(reihe: LaufmietePunkt[], monat: string): LaufmietePunkt {
  const p = reihe.find((x) => x.monat === monat);
  assert.ok(p, `Die Reihe hat keinen Punkt fuer ${monat}.`);
  return p;
}

// ---------------------------------------------------------------------------
// Der Stichtag je Monat
//
// Verhindert: eine Delle im Diagramm, die keine Bestandsaenderung ist.
//
// Wer einen Einzug zum 15. anteilig rechnet, bekommt im Einzugsmonat eine
// halbe Miete und im Folgemonat eine ganze. Im Diagramm sind das ZWEI
// Ereignisse -- ein Einbruch und ein Anstieg --, und keines hat
// stattgefunden: Der Bestand hat sich genau einmal geaendert. Ein
// Eigentuemer, der diese Stufe fuer einen Mieterwechsel haelt, sucht nach
// einem Vorgang, den es nicht gibt. Eine Laufmiete ist eine RATE und keine
// Kassenzahl; anteilig rechnet lib/sollstellung.ts, und das ist dort auch
// richtig.
// ---------------------------------------------------------------------------

describe("Laufmiete: der Stichtag ist der Monatserste", () => {
  test("die Jahresmiete eines Monats ist 12 x das Soll dieses Monats", () => {
    // Von Hand:
    //   Zimmer A  Inklusivmiete                    500,00
    //   Zimmer B  310,50 + 64,50 + 50,00 Moebel    425,00
    //   Soll des Monats                            925,00
    //   Jahresmiete  12 x 925,00                11.100,00
    //   Probe: 900 x 12 = 10.800, dazu 25 x 12 = 300  ->  11.100,00
    const reihe = laufmieteReihe(
      pruefZeilen(HEUTE, [
        {
          id: "mv-a",
          beginn: "2024-01-01",
          posten: fest({ gesamtmiete: "500.00" }),
        },
        {
          id: "mv-b",
          beginn: "2024-01-01",
          posten: fest({
            kaltmiete: "310.50",
            nebenkosten: "64.50",
            moeblierung: "50.00",
          }),
        },
      ]),
      HEUTE,
    );

    const jetzt = punkt(reihe, "2026-11-01");
    assert.equal(jetzt.jahresmiete, 11_100);
    assert.equal(jetzt.vertraege, 2);
  });

  test("ein Vertrag ab dem 15. zaehlt im Startmonat nicht und danach voll", () => {
    // Beginn 15.12.2026, 600,00 EUR. Dezember: laeuft am 01.12. noch nicht
    // -> 0,00. Januar: voll -> 12 x 600 = 7.200,00. Keine halbe Miete
    // dazwischen, kein Zwischenschritt.
    const reihe = laufmieteReihe(
      pruefZeilen(HEUTE, [
        {
          id: "mv-neu",
          beginn: "2026-12-15",
          posten: fest({ gesamtmiete: "600.00" }),
        },
      ]),
      HEUTE,
    );

    const dezember = punkt(reihe, "2026-12-01");
    assert.equal(dezember.vertraege, 0);
    assert.equal(dezember.jahresmiete, 0);

    const januar = punkt(reihe, "2027-01-01");
    assert.equal(januar.vertraege, 1);
    assert.equal(januar.jahresmiete, 7_200);
    assert.equal(januar.zugaenge, 1);
    assert.equal(januar.abgaenge, 0);

    // Und genau EINE Stufe: Zwischen Dezember und Januar bewegt sich etwas,
    // zwischen Januar und Februar nicht mehr.
    assert.equal(punkt(reihe, "2027-02-01").jahresmiete, 7_200);
    assert.equal(punkt(reihe, "2027-02-01").zugaenge, 0);
  });

  test("ein Ende zum 21.12. zaehlt im Dezember voll und ab Januar nicht mehr", () => {
    // 450,00 EUR, Ende 21.12.2026. Dezember: laeuft am 01.12. -> 12 x 450 =
    // 5.400,00, voller Betrag. Januar: ende < 01.01. -> 0,00, ein Abgang.
    const reihe = laufmieteReihe(
      pruefZeilen(HEUTE, [
        {
          id: "mv-weg",
          beginn: "2023-05-01",
          ende: "2026-12-21",
          posten: fest({ gesamtmiete: "450.00" }),
        },
      ]),
      HEUTE,
    );

    const dezember = punkt(reihe, "2026-12-01");
    assert.equal(dezember.vertraege, 1);
    assert.equal(dezember.jahresmiete, 5_400);
    assert.equal(dezember.abgaenge, 0);

    const januar = punkt(reihe, "2027-01-01");
    assert.equal(januar.vertraege, 0);
    assert.equal(januar.jahresmiete, 0);
    assert.equal(januar.abgaenge, 1);
    assert.equal(januar.zugaenge, 0);
  });

  test("laeuftAmErsten vergleicht Datumen als Text, ohne Zeitzone", () => {
    // Ein new Date("2026-12-01") in einer Umgebung mit negativem Versatz
    // wird zum 30.11. -- bei einem Monatsersten ist das ein ganzer Monat
    // Unterschied und damit eine Miete.
    assert.equal(laeuftAmErsten({ beginn: "2026-12-01", ende: null }, "2026-12-01"), true);
    assert.equal(laeuftAmErsten({ beginn: "2026-12-02", ende: null }, "2026-12-01"), false);
    assert.equal(laeuftAmErsten({ beginn: "2020-01-01", ende: "2026-12-01" }, "2026-12-01"), true);
    assert.equal(laeuftAmErsten({ beginn: "2020-01-01", ende: "2026-11-30" }, "2026-12-01"), false);
  });
});

// ---------------------------------------------------------------------------
// Vergangenheit, Gegenwart, Vorausschau
//
// Verhindert: dass eine Untergrenze als Prognose gelesen wird.
//
// Rechts von heute steht nicht, was passieren wird, sondern was
// unterschrieben ist. Ein Absturz der Linie im Januar heisst "hierfuer liegt
// kein Vertrag vor" und nicht "das Zimmer bleibt leer". Ohne das Kennzeichen
// `vorausschau` kann die Oberflaeche den Unterschied nicht zeichnen -- und am
// Ende dieser Kette steht eine Entscheidung ueber ein Haus, getroffen auf
// eine Zahl, die niemand so gemeint hat.
// ---------------------------------------------------------------------------

describe("Laufmiete: Zukunft ist gekennzeichnet", () => {
  const reihe = laufmieteReihe(
    pruefZeilen(HEUTE, [
      { id: "mv-a", beginn: "2024-01-01", posten: fest({ gesamtmiete: "500.00" }) },
    ]),
    HEUTE,
  );

  test("das Fenster reicht zwoelf Monate zurueck und zwoelf vorwaerts", () => {
    assert.equal(reihe.length, 25);
    assert.equal(reihe[0].monat, "2025-11-01");
    assert.equal(reihe[24].monat, "2027-11-01");
  });

  test("der Monat mit dem heutigen Datum gehoert zur Gegenwart", () => {
    // 04.11.2026 liegt im November 2026. Dieser Monat ist NICHT Vorausschau:
    // Seine Miete ist geschuldet und gestellt, nicht angenommen.
    assert.equal(punkt(reihe, "2026-11-01").vorausschau, false);
    assert.equal(punkt(reihe, "2026-12-01").vorausschau, true);
  });

  test("Vergangenheit traegt vorausschau false, Zukunft true", () => {
    for (const p of reihe) {
      assert.equal(
        p.vorausschau,
        p.monat > "2026-11-01",
        `${p.monat} ist falsch einsortiert.`,
      );
    }
    assert.equal(reihe.filter((p) => p.vorausschau).length, 12);
  });

  test("laufmieteLage nennt Gegenwart und das Ende des Fensters", () => {
    const lage = laufmieteLage(reihe);
    assert.ok(lage);
    assert.equal(lage.gegenwart, "2026-11-01");
    assert.equal(lage.jetzt, 6_000);
    assert.equal(lage.vertraegeJetzt, 1);
    assert.equal(lage.letzterMonat, "2027-11-01");
    assert.equal(lage.vorausschauMonate, 12);
    // Nichts bekannt, was sich aendert -> kein Satz, der eine Aenderung
    // behauptet.
    assert.equal(lage.groessteAenderung, null);
  });

  test("die groesste bekannte Aenderung ist die aus der Vorausschau", () => {
    // Zwei Abgaenge zum Jahresende, 600 + 550 = 1.150 EUR Monatsmiete.
    // Januar verliert damit 12 x 1.150 = 13.800,00 EUR Jahresmiete.
    const mitAbgang = laufmieteReihe(
      pruefZeilen(HEUTE, [
        { id: "mv-a", beginn: "2024-01-01", posten: fest({ gesamtmiete: "500.00" }) },
        {
          id: "mv-b",
          beginn: "2024-01-01",
          ende: "2026-12-21",
          posten: fest({ gesamtmiete: "600.00" }),
        },
        {
          id: "mv-c",
          beginn: "2024-01-01",
          ende: "2026-12-31",
          posten: fest({ gesamtmiete: "550.00" }),
        },
      ]),
      HEUTE,
    );
    const lage = laufmieteLage(mitAbgang);
    assert.ok(lage?.groessteAenderung);
    assert.equal(lage.groessteAenderung.monat, "2027-01-01");
    assert.equal(lage.groessteAenderung.differenz, -13_800);
    assert.equal(lage.groessteAenderung.abgaenge, 2);
    assert.equal(lage.groessteAenderung.zugaenge, 0);
  });
});

// ---------------------------------------------------------------------------
// Zu- und Abgaenge
//
// Verhindert: eine Stufe im Diagramm ohne Erklaerung.
//
// Die Zahlen werden hier UNABHAENGIG nachgerechnet -- aus den Laufzeiten des
// Pruefstands, nicht mit laufmieteReihe() selbst. Ein Test, der dieselbe
// Funktion zweimal aufruft, prueft nur, dass sie sich treu bleibt.
// ---------------------------------------------------------------------------

describe("Laufmiete: Zu- und Abgaenge erklaeren jede Stufe", () => {
  const vertraege: Pruefvertrag[] = [
    { id: "mv-a", beginn: "2024-01-01", posten: fest({ gesamtmiete: "500.00" }) },
    {
      id: "mv-b",
      beginn: "2024-01-01",
      ende: "2026-12-21",
      posten: fest({ gesamtmiete: "600.00" }),
    },
    { id: "mv-c", beginn: "2026-12-15", posten: fest({ gesamtmiete: "480.00" }) },
    { id: "mv-d", beginn: "2027-03-01", posten: fest({ gesamtmiete: "520.00" }) },
    {
      id: "mv-e",
      beginn: "2025-01-01",
      ende: "2026-06-30",
      posten: fest({ gesamtmiete: "400.00" }),
    },
  ];
  const reihe = laufmieteReihe(pruefZeilen(HEUTE, vertraege), HEUTE);

  /** Dieselbe Frage, aber von Hand: laeuft dieser Vertrag am Ersten? */
  function laeuft(v: Pruefvertrag, monat: string): boolean {
    if (v.beginn > monat) return false;
    if (v.ende && v.ende < monat) return false;
    return true;
  }

  test("Zugaenge und Abgaenge stimmen mit den Laufzeiten ueberein", () => {
    const monate = rasterMonate(HEUTE);
    for (let i = 1; i < monate.length; i++) {
      const jetzt = new Set(
        vertraege.filter((v) => laeuft(v, monate[i])).map((v) => v.id),
      );
      const vor = new Set(
        vertraege.filter((v) => laeuft(v, monate[i - 1])).map((v) => v.id),
      );
      const erwartetZu = [...jetzt].filter((id) => !vor.has(id)).length;
      const erwartetAb = [...vor].filter((id) => !jetzt.has(id)).length;

      const p = punkt(reihe, monate[i]);
      assert.equal(p.vertraege, jetzt.size, `Vertragszahl ${monate[i]}`);
      assert.equal(p.zugaenge, erwartetZu, `Zugaenge ${monate[i]}`);
      assert.equal(p.abgaenge, erwartetAb, `Abgaenge ${monate[i]}`);
    }
  });

  test("die Vertragszahl aendert sich genau um Zugaenge minus Abgaenge", () => {
    for (let i = 1; i < reihe.length; i++) {
      assert.equal(
        reihe[i].vertraege - reihe[i - 1].vertraege,
        reihe[i].zugaenge - reihe[i].abgaenge,
        `Bei ${reihe[i].monat} passt die Bewegung nicht zur Vertragszahl.`,
      );
    }
  });

  test("der erste Monat behauptet keine Bewegung", () => {
    // Sein Vormonat liegt ausserhalb des Fensters und ist nicht abgefragt.
    // "Drei Zugaenge im ersten Monat" waere eine Aussage ueber Daten, die
    // nicht geladen wurden.
    assert.equal(reihe[0].zugaenge, 0);
    assert.equal(reihe[0].abgaenge, 0);
    assert.ok(reihe[0].vertraege > 0, "Der erste Monat hat trotzdem Vertraege.");
  });
});

// ---------------------------------------------------------------------------
// Welcher Betrag gilt
//
// Verhindert: dass eine Inklusivmiete mit der Summe ihrer leeren Posten
// eingeht, also mit 0,00 EUR.
//
// Rund zwei Drittel der WG-Zimmer sind als Inklusivmiete vermietet ("500 EUR
// all-in"). Wird dort die Summe der Posten gerechnet statt der zugesagten
// Gesamtmiete, verschwindet zwei Drittel der Jahresmiete -- und die Linie
// zeigt ein Haus, das fast leer steht. Die Regel entscheidet sollGesamt() in
// lib/sollstellung.ts; sie wird hier nicht nachgebaut, sondern benutzt.
// ---------------------------------------------------------------------------

describe("Laufmiete: es gilt die Vertragszusage, nicht die Postensumme", () => {
  test("eine Inklusivmiete geht mit ihrem vollen Betrag ein", () => {
    // Nur gesamtmiete gesetzt, keine Posten: 12 x 500 = 6.000,00.
    const reihe = laufmieteReihe(
      pruefZeilen(HEUTE, [
        {
          id: "mv-inklusiv",
          beginn: "2024-01-01",
          posten: fest({ gesamtmiete: "500.00" }),
        },
      ]),
      HEUTE,
    );
    assert.equal(punkt(reihe, "2026-11-01").jahresmiete, 6_000);
  });

  test("die zugesagte Gesamtmiete schlaegt die Summe der Posten", () => {
    // Posten 380 + 70 = 450, zugesagt 520. Geschuldet sind 520 ->
    // 12 x 520 = 6.240,00. Mit der Postensumme waeren es 5.400,00 -- eine
    // Abweichung von 840 EUR im Jahr, die wie ein guenstiger Mietvertrag
    // aussieht.
    const reihe = laufmieteReihe(
      pruefZeilen(HEUTE, [
        {
          id: "mv-zusage",
          beginn: "2024-01-01",
          posten: fest({
            kaltmiete: "380.00",
            nebenkosten: "70.00",
            gesamtmiete: "520.00",
          }),
        },
      ]),
      HEUTE,
    );
    assert.equal(punkt(reihe, "2026-11-01").jahresmiete, 6_240);
  });

  test("eine vereinbarte Mietanpassung erscheint im richtigen Monat", () => {
    // Staffelmiete: 500,00 bis Ende 2026, ab 01.01.2027 540,00. So liefert
    // miete_am() die Posten -- fortgeschrieben wird hier nichts.
    //   Dezember 2026: 12 x 500 = 6.000,00
    //   Januar   2027: 12 x 540 = 6.480,00
    const reihe = laufmieteReihe(
      pruefZeilen(HEUTE, [
        {
          id: "mv-staffel",
          beginn: "2024-01-01",
          posten: (monat) => ({
            gesamtmiete: monat >= "2027-01-01" ? "540.00" : "500.00",
          }),
        },
      ]),
      HEUTE,
    );

    assert.equal(punkt(reihe, "2026-12-01").jahresmiete, 6_000);
    assert.equal(punkt(reihe, "2027-01-01").jahresmiete, 6_480);
    // Kein Vertragswechsel: Die Stufe kommt vom Betrag, nicht vom Bestand.
    assert.equal(punkt(reihe, "2027-01-01").zugaenge, 0);
    assert.equal(punkt(reihe, "2027-01-01").abgaenge, 0);
    assert.equal(punkt(reihe, "2027-01-01").vertraege, 1);
  });

  test("nach der Anpassung wird nichts weiter fortgeschrieben", () => {
    // Was vereinbart ist, steht in der Reihe. Was nicht vereinbart ist,
    // bleibt gleich -- keine Indexierung, keine Inflation, kein Mietspiegel.
    const reihe = laufmieteReihe(
      pruefZeilen(HEUTE, [
        {
          id: "mv-staffel",
          beginn: "2024-01-01",
          posten: (monat) => ({
            gesamtmiete: monat >= "2027-01-01" ? "540.00" : "500.00",
          }),
        },
      ]),
      HEUTE,
    );
    for (const p of reihe.filter((x) => x.monat >= "2027-01-01")) {
      assert.equal(p.jahresmiete, 6_480, `${p.monat} wurde fortgeschrieben.`);
    }
  });

  test("dieselbe Miete zaehlt nur einmal, auch bei doppelten Zeilen", () => {
    // Eine Abfrage, die ueber mehrere Einheiten oder Anpassungen doppelt
    // verbindet, liefert zwei Zeilen fuer ein Mietverhaeltnis. Zweimal
    // gezaehlt sieht das aus wie ein zusaetzlicher Mieter.
    const einfach = pruefZeilen(HEUTE, [
      { id: "mv-a", beginn: "2024-01-01", posten: fest({ gesamtmiete: "500.00" }) },
    ]);
    const reihe = laufmieteReihe([...einfach, ...einfach], HEUTE);
    assert.equal(punkt(reihe, "2026-11-01").vertraege, 1);
    assert.equal(punkt(reihe, "2026-11-01").jahresmiete, 6_000);
  });
});

// ---------------------------------------------------------------------------
// Leerer Bestand
//
// Verhindert: eine durchgezogene Linie ueber einen Leerstand hinweg.
//
// Eine Reihe, die nur die belegten Monate enthaelt, hat im Diagramm keine
// Luecke -- sie verbindet den Monat davor mit dem danach und behauptet damit
// fuer die Zeit dazwischen eine Miete. Ein leeres Haus muss als Null
// dastehen, nicht als fehlende Zeile und nicht als null.
// ---------------------------------------------------------------------------

describe("Laufmiete: leerer Bestand ist eine Null und keine Luecke", () => {
  test("ohne jeden Vertrag steht eine vollstaendige Reihe aus Nullen", () => {
    const reihe = laufmieteReihe([], HEUTE);
    assert.equal(reihe.length, 25);
    for (const p of reihe) {
      assert.equal(p.jahresmiete, 0, `${p.monat} ist nicht 0.`);
      assert.equal(p.vertraege, 0, `${p.monat} hat Vertraege.`);
      assert.equal(p.zugaenge, 0);
      assert.equal(p.abgaenge, 0);
      assert.equal(typeof p.jahresmiete, "number");
    }
    // Und die Lage dazu gibt es trotzdem -- mit Nullen, nicht mit null.
    const lage = laufmieteLage(reihe);
    assert.ok(lage);
    assert.equal(lage.jetzt, 0);
    assert.equal(lage.vertraegeJetzt, 0);
    assert.equal(lage.groessteAenderung, null);
  });

  test("ein Vertrag ohne erfassten Betrag zaehlt als Vertrag mit 0 EUR", () => {
    // Nicht weglassen: Das waere die stille Korrektur eines Pflegefehlers.
    // So steht er in der Tabelle und faellt auf.
    const reihe = laufmieteReihe(
      pruefZeilen(HEUTE, [{ id: "mv-leer", beginn: "2024-01-01", posten: fest({}) }]),
      HEUTE,
    );
    assert.equal(punkt(reihe, "2026-11-01").vertraege, 1);
    assert.equal(punkt(reihe, "2026-11-01").jahresmiete, 0);
  });

  test("laufmieteLage einer leeren Reihe ist null und nicht erfunden", () => {
    assert.equal(laufmieteLage([]), null);
  });
});

// ---------------------------------------------------------------------------
// Die laufende Netto-Mietrendite
//
// Verhindert zwei Dinge:
//
//   1. Eine Rendite ohne Kaufpreis. Dieselbe Strenge wie bei der
//      Rueckblick-Rendite: keine 0 %, kein "n/a", sondern null mit einem
//      Satz, der sagt, welches Feld fehlt.
//   2. Eine Zahl, die wie eine saubere Vorausschau aussieht. Im Zaehler
//      stehen zwoelf heutige Monatsmieten, im Nenner Kosten aus dem
//      Rueckblick -- Belege lassen sich nicht hochrechnen. Diese Mischung
//      MUSS in der Grundlage stehen, sonst liest sie jemand als Prognose.
// ---------------------------------------------------------------------------

describe("Laufende Netto-Mietrendite", () => {
  test("jahresLaufmiete und rohertragLautVertrag sind dieselbe Zahl", () => {
    // Der alte Name bleibt als Alias, damit kein Aufrufer bricht. Eine
    // Umbenennung, die an einer Stelle vergessen wird, waere hier keine
    // Fehlermeldung, sondern eine fehlende Kennzahl.
    assert.equal(rohertragLautVertrag, jahresLaufmiete);
    assert.equal(
      jahresLaufmiete(OBJEKT_A_BASIS).wert,
      rohertragLautVertrag(OBJEKT_A_BASIS).wert,
    );
    // 12 x 4.000,00 = 48.000,00.
    assert.equal(jahresLaufmiete(OBJEKT_A_BASIS).wert, 48_000);
  });

  test("ohne Kaufpreis gibt es keine Zahl, sondern eine Begruendung", () => {
    const laufmiete = jahresLaufmiete(OBJEKT_A_BASIS);
    const kosten = bewirtschaftungskosten(
      stamm({ bewirtschaftung_jahr: 12_000 }),
      OBJEKT_A_BASIS,
      48_000,
    );
    const r = nettomietrenditeLaufend(
      laufmiete,
      kosten,
      gesamtinvest(LEERER_STAMM),
      OBJEKT_A_BASIS,
    );

    assert.equal(r.wert, null);
    assert.equal(r.einheit, "prozent");
    assert.ok(
      r.grund && r.grund.includes("Kaufpreis"),
      `Der Grund nennt den Kaufpreis nicht: ${r.grund}`,
    );
  });

  test("die Grundlage nennt, dass die Kosten aus dem Rueckblick stammen", () => {
    // Von Hand: Laufmiete 12 x 4.000 = 48.000,00, Kosten 12.000,00 ->
    // Reinertrag 36.000,00. Gesamtinvest 500.000 + 60.000 = 560.000,00.
    //   36.000 / 560.000 = 0,0642857...  -> 6,43 %
    const laufmiete = jahresLaufmiete(OBJEKT_A_BASIS);
    const kosten = bewirtschaftungskosten(
      stamm({ bewirtschaftung_jahr: 12_000 }),
      OBJEKT_A_BASIS,
      48_000,
    );
    const r = nettomietrenditeLaufend(
      laufmiete,
      kosten,
      gesamtinvest(OBJEKT_A_STAMM),
      OBJEKT_A_BASIS,
    );

    assert.equal(Math.round((r.wert as number) * 1e6) / 1e6, 0.064286);
    assert.ok(
      r.grundlage.includes("Rückblick"),
      `Die Grundlage nennt den Rueckblick nicht: ${r.grundlage}`,
    );
    assert.ok(
      r.grundlage.includes(OBJEKT_A_BASIS.fensterVon) &&
        r.grundlage.includes(OBJEKT_A_BASIS.fensterBis),
      "Die Grundlage nennt das Kostenfenster nicht mit Datum.",
    );
    assert.ok(
      r.grundlage.includes("hochrechnen"),
      "Die Grundlage sagt nicht, dass Kosten sich nicht hochrechnen lassen.",
    );
  });

  test("beide Renditen stehen in der Lage und sagen, wie sie sich unterscheiden", () => {
    const l = wirtschaftLage(
      { ...OBJEKT_A_STAMM, bewirtschaftung_jahr: 12_000 },
      // Rueckblick mit Leerstand: gestellt 42.000 statt 48.000 laut Vertrag.
      basis({ ...OBJEKT_A_BASIS, sollGestellt: 42_000 }),
    );

    assert.ok(l.nettomietrendite.wert !== null);
    assert.ok(l.nettomietrenditeLaufend.wert !== null);
    // Die laufende Rendite ist hier hoeher -- der Leerstand des letzten
    // Jahres steckt nur im Rueckblick.
    assert.ok(
      (l.nettomietrenditeLaufend.wert as number) >
        (l.nettomietrendite.wert as number),
      "Bei Leerstand im Rueckblick muss die laufende Rendite hoeher sein.",
    );
    // Jede der beiden sagt in einem Satz, worin sie sich unterscheidet.
    assert.ok(
      l.nettomietrendite.grundlage.includes("Rückblick"),
      "Die Rueckblick-Rendite erklaert sich nicht.",
    );
    assert.ok(
      l.nettomietrenditeLaufend.grundlage.includes("heutigen Vertragsbestand"),
      "Die laufende Rendite erklaert sich nicht.",
    );
    // Der alte Feldname zeigt weiter auf dieselbe Zahl.
    assert.equal(
      l.nettomietrenditeLautVertrag.wert,
      l.nettomietrenditeLaufend.wert,
    );
    assert.equal(l.rohertragLautVertrag.wert, l.jahresLaufmiete.wert);
  });
});
