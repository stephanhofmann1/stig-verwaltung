import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  betragDe,
  feld,
  csv,
  belegName,
  journalCsv,
  einnahmenCsv,
  ausgabenCsv,
  ohneBelegCsv,
  anlagegueterCsv,
  summenCsv,
  zahlen,
  liesmich,
  type JournalZeile,
  type Paket,
} from "../lib/steuerpaket";

/**
 * Tests des Steuerberater-Pakets.
 *
 * Dieses Paket wird aus dem Haus gegeben. Was hier falsch steht, merkt
 * niemand mehr -- der Steuerberater rechnet die Spalten nicht nach, er
 * verlässt sich darauf, dass sie bedeuten, was die Überschrift sagt.
 *
 * Besonders geprüft wird deshalb:
 *   - dass eine Bewegung ohne Beleg NICHT verschwindet,
 *   - dass Vorschläge als Vorschläge gekennzeichnet bleiben,
 *   - dass ein Semikolon im Verwendungszweck die Spalten nicht verschiebt.
 *
 * Alle Namen, Nummern und Beträge in dieser Datei sind erfunden.
 */

function zeile(teil: Partial<JournalZeile> & { nr: number }): JournalZeile {
  return {
    buchungstag: "2026-03-09",
    konto: "Geschäftskonto",
    betrag: "-45.44",
    partner: "Lieferant A",
    verwendungszweck: "Bestellung 000-0000000-0000000",
    beleg_nr: null,
    beleg_datei: null,
    aussteller: null,
    belegnummer: null,
    belegdatum: null,
    belegbetrag: null,
    kostenart: null,
    umlagefaehig: null,
    anlagegut: null,
    objekt: null,
    abweichung: null,
    belegfrei_vermerk: null,
    ...teil,
  };
}

const paket: Paket = {
  jahr: 2026,
  zeilen: [
    zeile({
      nr: 1,
      betrag: "1200.00",
      partner: "Mieter A",
      verwendungszweck: "Miete März",
    }),
    zeile({
      nr: 2,
      betrag: "-45.44",
      beleg_nr: 1,
      beleg_datei: "0001_rechnung.pdf",
      aussteller: "Lieferant A",
      belegnummer: "LU0000000000",
      belegdatum: "2026-03-10",
      belegbetrag: "45.44",
      kostenart: "instandhaltung",
      umlagefaehig: false,
      anlagegut: false,
      objekt: "Beispielweg 1",
    }),
    zeile({
      nr: 3,
      betrag: "-478.43",
      beleg_nr: 2,
      beleg_datei: "0002_geraet.pdf",
      belegbetrag: "478.43",
      kostenart: "modernisierung",
      umlagefaehig: false,
      anlagegut: true,
      objekt: "Beispielweg 1",
      belegdatum: "2026-04-02",
      aussteller: "Lieferant B",
    }),
    zeile({
      nr: 4,
      betrag: "-99.99",
      verwendungszweck: 'Zahlung; Rechnung "Nr 7"\nzweite Zeile',
    }),
    zeile({
      nr: 5,
      betrag: "-2000.00",
      belegfrei_vermerk: "Privatentnahme",
    }),
    zeile({
      nr: 6,
      betrag: "-123.45",
      beleg_nr: 3,
      beleg_datei: "0003_abweichend.pdf",
      belegbetrag: "123.45",
      abweichung: "Betrag: Regelwerk 123,45 / Beifügung 132,45",
      kostenart: "instandhaltung",
      umlagefaehig: false,
      objekt: "Beispielweg 1",
    }),
  ],
  belege: [
    {
      nr: 1,
      beleg_id: "a",
      ablage_pfad: "/daten/belege/2026-03/aaa.pdf",
      dateiname: "rechnung.pdf",
      aussteller: "Lieferant A",
      belegdatum: "2026-03-10",
    },
  ],
};

describe("Felder und Beträge", () => {
  test("Beträge mit Komma, zwei Stellen, kein Tausenderpunkt", () => {
    assert.equal(betragDe("-45.44"), "-45,44");
    assert.equal(betragDe(1234.5), "1234,50");
    assert.equal(betragDe(null), "");
    assert.equal(betragDe("keine Zahl"), "");
  });

  test("ein Semikolon im Feld wird eingerahmt", () => {
    assert.equal(feld("a;b"), '"a;b"');
  });

  test("Anführungszeichen werden verdoppelt", () => {
    assert.equal(feld('Rechnung "Nr 7"'), '"Rechnung ""Nr 7"""');
  });

  test("ein Zeilenumbruch im Feld wird eingerahmt", () => {
    assert.equal(feld("a\nb"), '"a\nb"');
  });

  test("CSV beginnt mit der Bytemarke und trennt mit Semikolon", () => {
    const t = csv(["a", "b"], [[1, 2]]);
    assert.ok(t.startsWith("﻿"), "Bytemarke für Excel");
    assert.ok(t.includes("a;b\r\n1;2"));
  });
});

describe("Belegnamen in der Anlage", () => {
  test("laufende Nummer vorn, vierstellig", () => {
    assert.equal(belegName(7, "rechnung.pdf"), "0007_rechnung.pdf");
  });

  test("Schrägstriche und Steuerzeichen fallen heraus", () => {
    assert.equal(belegName(1, "a/b/../c.pdf"), "0001_c.pdf");
    assert.equal(belegName(2, "a\u0000b.pdf"), "0002_a-b.pdf");
  });

  test("Umlaute bleiben -- sie sind in einem Dateinamen harmlos", () => {
    assert.match(belegName(3, "Gießen_Rechnung.pdf"), /Gießen/);
  });

  test("ohne Dateinamen bleibt die Nummer aussagekräftig", () => {
    assert.equal(belegName(4, null), "0004_beleg");
  });
});

describe("Das Journal lässt nichts verschwinden", () => {
  test("jede Bewegung des Jahres steht im Journal", () => {
    const t = journalCsv(paket);
    const zeilen = t.trimEnd().split("\r\n");
    assert.equal(zeilen.length, 1 + paket.zeilen.length, "Kopf plus jede Zeile");
  });

  test("eine Bewegung ohne Beleg wird als solche benannt", () => {
    const t = journalCsv(paket);
    assert.match(t, /kein Beleg zugeordnet/);
  });

  test("die Abweichung steht im Klartext in der Zeile", () => {
    assert.match(journalCsv(paket), /Abweichung beim Auslesen: Betrag/);
  });

  test("der Vermerk für belegfreie Bewegungen steht drin", () => {
    assert.match(journalCsv(paket), /Privatentnahme/);
  });

  test("ein Semikolon im Verwendungszweck verschiebt keine Spalte", () => {
    const t = journalCsv(paket);
    const zeilen = t.trimEnd().split("\r\n");
    const kopfSpalten = zeilen[0].split(";").length;
    // Zeile 4 enthält Semikolon, Anführungszeichen und Umbruch; sie
    // besteht deshalb aus zwei Textzeilen, die zusammengehören.
    const zusammen = t.trimEnd().replace(/"[^"]*"/g, "X").split("\r\n");
    for (const z of zusammen) {
      assert.equal(z.split(";").length, kopfSpalten, `Spaltenzahl in: ${z}`);
    }
  });

  test("Vorschlagsspalten heissen auch so", () => {
    const kopf = journalCsv(paket).split("\r\n")[0];
    assert.match(kopf, /Kostenart \(Vorschlag\)/);
    assert.match(kopf, /umlagefähig \(Vorschlag\)/);
    assert.match(kopf, /Anlagegut \(Kennzeichen\)/);
  });
});

describe("Die Teillisten", () => {
  test("Einnahmen enthalten nur Zugänge", () => {
    const zeilen = einnahmenCsv(paket).trimEnd().split("\r\n").slice(1);
    assert.equal(zeilen.length, 1);
    assert.match(zeilen[0], /1200,00/);
  });

  test("Ausgaben enthalten nur Abgänge", () => {
    const zeilen = ausgabenCsv(paket).trimEnd().split("\r\n");
    // Zeile 4 hat einen Umbruch im Feld, daher über die Nummern zählen.
    assert.equal((ausgabenCsv(paket).match(/^\d+;2026/gm) ?? []).length, 5);
    assert.ok(!zeilen.join("\n").includes("1200,00"));
  });

  test("ohne-Beleg listet nur echte Lücken -- nicht die mit Vermerk", () => {
    const t = ohneBelegCsv(paket);
    assert.match(t, /99,99/);
    assert.ok(!t.includes("Privatentnahme"), "belegfrei ist keine Lücke");
    assert.ok(!t.includes("45,44"), "mit Beleg ist keine Lücke");
  });

  test("Anlagegüter enthalten nur die gekennzeichneten", () => {
    const t = anlagegueterCsv(paket);
    assert.match(t, /478,43/);
    assert.ok(!t.includes("45,44"));
  });

  test("Summen fassen je Objekt und Kostenart zusammen", () => {
    const t = summenCsv(paket);
    // instandhaltung: 45,44 + 123,45 = 168,89
    assert.match(t, /168,89/);
    assert.match(t, /478,43/);
    // Die Ausgaben ohne Kostenart dürfen nicht verschwinden.
    assert.match(t, /ohne Kostenart/);
    assert.match(t, /ohne Objektzuordnung/);
  });

  test("Einnahmen fliessen nicht in die Summen der Kostenarten", () => {
    assert.ok(!summenCsv(paket).includes("1200,00"));
  });
});

describe("Die Zahlen und die Begleitdatei", () => {
  test("gezählt wird, was gezählt werden soll", () => {
    const z = zahlen(paket);
    assert.equal(z.bewegungen, 6);
    assert.equal(z.einnahmen, 1200);
    assert.equal(z.mit_beleg, 3);
    assert.equal(z.ohne_beleg, 1);
    assert.equal(z.belegfrei, 1);
    assert.equal(z.mit_abweichung, 1);
  });

  test("die Begleitdatei nennt die Lücken und die Vorschläge", () => {
    const t = liesmich(paket, new Date("2026-11-05T21:00:00Z"));
    assert.match(t, /WAS SIE PRÜFEN MÜSSEN/);
    assert.match(t, /1 Ausgabenbewegungen haben keinen Beleg|^1 Ausgabenbewegungen/m);
    assert.match(t, /§ 2 BetrKV/);
    assert.match(t, /§ 556 Abs\. 1 BGB/);
    assert.match(t, /Vorschläge, keine Festlegungen/);
  });

  test("die Begleitdatei nennt das Jahr und das Erstelldatum", () => {
    const t = liesmich(paket, new Date("2026-11-05T21:00:00Z"));
    assert.match(t, /2026/);
    assert.match(t, /2026-11-05 21:00/);
  });
});
