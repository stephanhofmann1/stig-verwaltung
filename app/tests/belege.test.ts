import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";

import {
  findeAussteller,
  findeBelegnummer,
  findeBetrag,
  findeDatum,
  findeKontobewegung,
  findeSummeMehrererRechnungen,
  leererBefund,
  leseZahl,
  pruefeModellfelder,
  type BewegungZeile,
  werteBelegAus,
  zaehleBelegstuecke,
} from "../lib/belege";
import { istBild, istPdf, lieseBeleg, seitenAuswahl } from "../lib/belegtext";
import { vergleichbar } from "../lib/zuordnung";

/**
 * Tests der Belegparser.
 *
 * Diese Funktionen entscheiden, welcher Betrag und welche Nummer in die
 * Bücher kommen. Ein falsch gelesener Betrag fällt später niemandem mehr
 * auf, weil ihn niemand nachrechnet -- er muss hier auffallen.
 *
 * ALLE Nummern, Namen und Beträge in dieser Datei sind erfunden. Keine
 * echte Bestellnummer, kein echter Mieter, keine echte IBAN. In der
 * Datenbank stehen echte Personen; Testdaten haben dort nichts zu suchen
 * und echte Daten hier nichts.
 */

// Erfundene Amazon-Bestellnummer im echten Format NNN-NNNNNNN-NNNNNNN.
const BESTELLNUMMER = "402-1234567-7654321";

describe("findeBelegnummer erkennt die Amazon-Bestellnummer", () => {
  test("auf der Rechnung", () => {
    const text = `Amazon.de
Rechnung
Bestellnummer ${BESTELLNUMMER}
Rechnungsdatum 14.10.2026`;
    assert.equal(findeBelegnummer(text), BESTELLNUMMER);
  });

  test("im Verwendungszweck der Abbuchung", () => {
    // Wortgleich wie im Kontoauszug: Absender, Bestellnummer, Marktplatz-
    // kennung. Die Nummer ist der einzige eindeutige Schlüssel zwischen
    // Rechnung und Kontobewegung.
    const zweck =
      `AMAZON PAYMENTS EUROPE S.C.A. ${BESTELLNUMMER} ` +
      "AMZN Mktp DE XX00XXXXXX00XX00";
    assert.equal(findeBelegnummer(zweck), BESTELLNUMMER);
  });

  test("beide Richtungen ergeben dieselbe Nummer", () => {
    const vonRechnung = findeBelegnummer(`Bestellnummer ${BESTELLNUMMER}`);
    const vomKonto = findeBelegnummer(
      `AMAZON PAYMENTS EUROPE S.C.A. ${BESTELLNUMMER} AMZN Mktp DE`,
    );
    assert.equal(vonRechnung, vomKonto);
  });

  test("die Nummer übersteht die Normalisierung des Abgleichs", () => {
    // Kriterium 1 in lib/belegabgleich.ts streicht Leerzeichen, Binde- und
    // Schrägstriche aus beiden Seiten und prüft dann auf Enthaltensein.
    // Dieser Test schreibt fest, dass genau das trägt -- sonst ist die
    // erkannte Nummer wertlos.
    const nummer = findeBelegnummer(`Bestellnummer ${BESTELLNUMMER}`)!;
    const zweck = `AMAZON PAYMENTS EUROPE S.C.A. ${BESTELLNUMMER} AMZN Mktp DE`;
    const ohne = (x: string) => x.toUpperCase().replace(/[\s\-\/]/g, "");
    assert.ok(ohne(zweck).includes(ohne(nummer)));
  });

  test("steht vor den schwächeren Mustern", () => {
    // Im selben Text steht zusätzlich eine Rechnungsnummer. Die
    // Bestellnummer gewinnt, weil nur sie im Verwendungszweck auftaucht.
    const text = `Rechnungsnummer DE-INV-0815
Bestellnummer ${BESTELLNUMMER}`;
    assert.equal(findeBelegnummer(text), BESTELLNUMMER);
  });

  test("eine zu kurze oder zu lange Zahlenfolge ist keine Bestellnummer", () => {
    assert.notEqual(findeBelegnummer("30-1234567-7654321"), "30-1234567-7654321");
    assert.equal(findeBelegnummer("4021234567765432100"), null);
  });

  test("die 30-stellige Zahl aus einer Temu-Abbuchung gilt nicht als Nummer", () => {
    // Erfundene Referenz in der Länge, in der solche Zahlen im
    // Verwendungszweck stehen. Ob sie der Bestellnummer auf dem Temu-Beleg
    // entspricht, ist nicht belegt -- also wird sie auch nicht als
    // Belegnummer ausgegeben. Eine geratene Nummer würde über Kriterium 1
    // zu einer "sicheren" Fehlzuordnung führen.
    assert.equal(findeBelegnummer("TEMU 100000000000000000000000000001"), null);
  });

  test("ein Datum wird nicht als Belegnummer ausgegeben", () => {
    // Das allgemeine Muster \\d{4,10}-\\d{2,6} trifft auch auf "2026-10" zu.
    // Als Belegnummer gespeichert würde "202610" in jeder längeren
    // Referenznummer gefunden -- und damit irgendeine fremde Buchung als
    // sicherer Treffer gelten.
    assert.equal(findeBelegnummer("Beleg vom 2026-10-31"), null);
    assert.equal(findeBelegnummer("Lieferung 2026/11"), null);
  });

  test("die bekannten Muster bleiben erhalten", () => {
    assert.equal(findeBelegnummer("Rechnungsnummer: RE-2026-0042"), "RE-2026-0042");
    assert.equal(findeBelegnummer("Angebot ANG 12345"), "ANG-12345");
  });
});

describe("findeAussteller gibt einen kurzen kanonischen Namen", () => {
  test("Amazon aus dem Verwendungszweck der Abbuchung", () => {
    assert.equal(
      findeAussteller("AMAZON PAYMENTS EUROPE S.C.A. AMZN Mktp DE"),
      "Amazon",
    );
  });

  test("Baumärkte und Temu", () => {
    assert.equal(findeAussteller("OBI Markt Musterstadt\nRechnung"), "OBI");
    assert.equal(findeAussteller("BAUHAUS GmbH & Co. KG"), "Bauhaus");
    assert.equal(findeAussteller("HORNBACH Baumarkt AG"), "Hornbach");
    assert.equal(findeAussteller("toom Baumarkt"), "toom");
    assert.equal(findeAussteller("Temu Order Confirmation"), "Temu");
  });

  test("der Name trägt durch Kriterium 2 des Abgleichs", () => {
    // Kriterium 2 zerlegt den Aussteller in Wortteile ab vier Zeichen und
    // sucht sie im normalisierten Buchungstext. Für "Amazon" muss das
    // aufgehen -- sonst nützt der erkannte Aussteller nichts.
    const name = findeAussteller("Amazon EU S.a r.l.")!;
    const teile = vergleichbar(name).split(" ").filter((t) => t.length >= 4);
    const buchung = vergleichbar("AMAZON PAYMENTS EUROPE S.C.A. AMZN Mktp DE");
    assert.ok(teile.length > 0, "der Name muss einen Teil ab vier Zeichen haben");
    assert.ok(teile.some((t) => buchung.includes(t)));
  });

  test("ein unbekannter Aussteller wird nicht geraten", () => {
    assert.equal(findeAussteller("Fliesenlegerei Musterweg GmbH\nRechnung"), null);
    assert.equal(findeAussteller("Stadtwerke Musterstadt"), null);
    assert.equal(findeAussteller(""), null);
  });

  test("zwei Marken auf einem Beleg ergeben nichts", () => {
    // Marktplatzrechnung: Plattform und Händler stehen beide drauf. Wer
    // die Rechnung stellt, ist damit nicht entschieden.
    assert.equal(
      findeAussteller("Amazon.de — verkauft von Conrad Electronic SE"),
      null,
    );
  });

  test("ein Zahlungsdienstleister zählt nur, wenn sonst nichts da ist", () => {
    assert.equal(findeAussteller("PayPal Zahlung an Baustoffhandel"), "PayPal");
    assert.equal(findeAussteller("OBI Markt, bezahlt mit PayPal"), "OBI");
  });

  test("eine Marke als Wortteil zählt nicht", () => {
    assert.equal(findeAussteller("Mobiliar und Zubehoer"), null);
  });
});

describe("findeBetrag nimmt die Endsumme, nicht die erste Zahl", () => {
  const rechnung = `OBI Markt Musterstadt
Pos 1  Wandfarbe weiss 10 l      29,99
Pos 2  Silikon                    7,49
Zwischensumme                   100,00 EUR
Versandkosten                     5,90 EUR
MwSt 19 %                        20,12 EUR
Gesamtsumme                     126,02 EUR`;

  test("Zwischensumme und Gesamtsumme im selben Beleg", () => {
    assert.equal(findeBetrag(rechnung), 126.02);
  });

  test("Zwischensumme allein ergibt nichts", () => {
    // "Zwischensumme" darf nie als Gesamtsumme gelten -- auch dann nicht,
    // wenn es das einzige summenartige Wort im Beleg ist.
    assert.equal(findeBetrag("Zwischensumme 100,00 EUR"), null);
    assert.equal(findeBetrag("ZWISCHENSUMME 100,00 EUR"), null);
    assert.equal(findeBetrag("Nettosumme 100,00 EUR"), null);
  });

  test("das späteste Vorkommen des stärksten Etiketts gewinnt", () => {
    const text = `Rechnungsbetrag Vorauszahlung 50,00 EUR
Rechnungsbetrag 126,02 EUR`;
    assert.equal(findeBetrag(text), 126.02);
  });

  test("ein Nettobetrag unter demselben Etikett zählt nicht", () => {
    const text = `Gesamtsumme netto 100,00 EUR
Gesamtsumme 119,00 EUR`;
    assert.equal(findeBetrag(text), 119);
  });

  test("ein starkes Etikett schlägt ein schwaches, auch wenn es später steht", () => {
    const text = `Gesamtbetrag 119,00 EUR
Summe der Positionen 100,00 EUR`;
    assert.equal(findeBetrag(text), 119);
  });

  test("die Spaltenüberschrift Gesamtpreis ist kein Etikett", () => {
    const text = "Menge Einzelpreis Gesamtpreis 29,99 Gesamtbetrag 59,98";
    assert.equal(findeBetrag(text), 59.98);
  });

  test("inkl. MwSt hinter dem Etikett ist in Ordnung", () => {
    assert.equal(findeBetrag("Gesamtbetrag inkl. 19 % MwSt: 119,00 EUR"), 119);
  });

  test("englisches Zahlenformat", () => {
    const text = `Subtotal            1,100.00
Shipping               34.56
Total amount        1,234.56 EUR`;
    assert.equal(findeBetrag(text), 1234.56);
  });

  test("deutsches Tausendertrennzeichen", () => {
    assert.equal(findeBetrag("Rechnungsbetrag 1.234,56 EUR"), 1234.56);
    assert.equal(findeBetrag("Rechnungsbetrag 2 480,00 EUR"), 2480);
  });

  test("ein Beleg ohne erkennbaren Betrag ergibt null", () => {
    // Der gefährliche Fall ist nicht der fehlende Betrag, sondern der
    // falsche. Lieber eine leere Spalte, die auffällt.
    assert.equal(findeBetrag("Vielen Dank für Ihren Einkauf! 42,00"), null);
    assert.equal(findeBetrag("Kassenbon 12345 Terminal 7"), null);
    assert.equal(findeBetrag(""), null);
  });

  test("eine Gutschrift wird nicht als Bruttobetrag gelesen", () => {
    assert.equal(findeBetrag("Gesamtbetrag -119,00 EUR"), null);
  });

  test("eine nicht eindeutige Zahl wird nicht zurückgegeben", () => {
    assert.equal(findeBetrag("Gesamtsumme 1.234 EUR"), null);
  });
});

describe("leseZahl verweigert zweideutige Schreibweisen", () => {
  test("deutsch und englisch", () => {
    assert.equal(leseZahl("1.234,56"), 1234.56);
    assert.equal(leseZahl("1,234.56"), 1234.56);
    assert.equal(leseZahl("126,02"), 126.02);
    assert.equal(leseZahl("126.02"), 126.02);
    assert.equal(leseZahl("1 234,56"), 1234.56);
    assert.equal(leseZahl("119"), 119);
  });

  test("ohne zwei klare Nachkommastellen: nichts", () => {
    // "1.234" ist entweder 1234 oder 1,234 -- in einer Buchhaltung ist der
    // Unterschied das Tausendfache.
    assert.equal(leseZahl("1.234"), null);
    assert.equal(leseZahl("1,234"), null);
    assert.equal(leseZahl("1.234,5"), null);
  });

  test("kaputte Gruppen und Doppeltrenner", () => {
    assert.equal(leseZahl("1.23.456,78"), null);
    assert.equal(leseZahl("1,23,45"), null);
    assert.equal(leseZahl("12.3456,78"), null);
    assert.equal(leseZahl("abc"), null);
    assert.equal(leseZahl("0,00"), null);
  });
});

describe("findeDatum", () => {
  test("ein benanntes Datum geht vor dem ersten im Text", () => {
    assert.equal(
      findeDatum("Lieferdatum 01.09.2026   Rechnungsdatum 05.11.2026"),
      "2026-11-05",
    );
  });

  test("ISO und deutsch", () => {
    assert.equal(findeDatum("Beleg 2026-10-31"), "2026-10-31");
    assert.equal(findeDatum("am 3.7.2026 geliefert"), "2026-07-03");
  });

  test("ein unmögliches Datum wird verworfen", () => {
    assert.equal(findeDatum("Rechnungsdatum 31.02.2026"), null);
    assert.equal(findeDatum("Datum 15.13.2026"), null);
  });
});

describe("werteBelegAus kennzeichnet, was es nicht gefunden hat", () => {
  test("vollständige Rechnung", () => {
    const b = werteBelegAus(
      `Amazon.de Rechnung
Bestellnummer ${BESTELLNUMMER}
Rechnungsdatum 14.10.2026
Gesamtsumme 126,02 EUR`,
      "rechnung.pdf",
    );
    assert.equal(b.aussteller, "Amazon");
    assert.equal(b.belegnummer, BESTELLNUMMER);
    assert.equal(b.belegdatum, "2026-10-14");
    assert.equal(b.betrag_brutto, 126.02);
    assert.deepEqual(b.quelle, {
      aussteller: "text",
      belegnummer: "text",
      belegdatum: "text",
      betrag_brutto: "text",
    });
  });

  test("ein Foto ohne Text lässt alles leer und sagt das auch", () => {
    const b = werteBelegAus("", "IMG_0042.jpeg");
    assert.deepEqual(
      [b.aussteller, b.belegnummer, b.belegdatum, b.betrag_brutto],
      [null, null, null, null],
    );
    assert.deepEqual(Object.values(b.quelle), [null, null, null, null]);
  });
});

describe("pruefeModellfelder lässt nur Geprüftes durch", () => {
  test("saubere Antwort", () => {
    const f = pruefeModellfelder({
      aussteller: "Hornbach",
      belegnummer: "RE-2026-0042",
      belegdatum: "2026-10-14",
      betrag_brutto: 126.02,
    });
    assert.deepEqual(f, {
      aussteller: "Hornbach",
      belegnummer: "RE-2026-0042",
      belegdatum: "2026-10-14",
      betrag_brutto: 126.02,
    });
  });

  test("Füllwörter, falsche Formate und Unsinn fallen heraus", () => {
    const f = pruefeModellfelder({
      aussteller: "unbekannt",
      belegnummer: "keine",
      belegdatum: "14.10.2026",
      betrag_brutto: "etwa 126 Euro",
    });
    assert.deepEqual(f, {});
  });

  test("ein Betrag als Text wird streng gelesen", () => {
    assert.equal(pruefeModellfelder({ betrag_brutto: "1.234,56" }).betrag_brutto, 1234.56);
    assert.equal(pruefeModellfelder({ betrag_brutto: "1.234" }).betrag_brutto, undefined);
    assert.equal(pruefeModellfelder({ betrag_brutto: -5 }).betrag_brutto, undefined);
  });

  test("ein unmögliches Datum wird abgelehnt", () => {
    assert.equal(pruefeModellfelder({ belegdatum: "2026-02-31" }).belegdatum, undefined);
  });

  test("gar keine Antwort ist auch eine", () => {
    assert.deepEqual(pruefeModellfelder(null), {});
    assert.deepEqual(pruefeModellfelder("{}"), {});
  });
});

describe("findeKontobewegung spiegelt die Reihenfolge des Abgleichs", () => {
  // Erfundene Buchungen. Beträge negativ, weil es Ausgaben sind.
  const bewegungen: BewegungZeile[] = [
    {
      id: "b1",
      buchungstag: "2026-10-15",
      betrag: "-126.02",
      absender: "AMAZON PAYMENTS EUROPE S.C.A.",
      verwendungszweck: `AMAZON PAYMENTS EUROPE S.C.A. ${BESTELLNUMMER} AMZN Mktp DE`,
    },
    {
      id: "b2",
      buchungstag: "2026-10-16",
      betrag: "-59.98",
      absender: "OBI MARKT MUSTERSTADT",
      verwendungszweck: "OBI MARKT MUSTERSTADT//Kartenzahlung",
    },
    {
      id: "b3",
      buchungstag: "2026-10-17",
      betrag: "-13.37",
      absender: "SONST GMBH",
      verwendungszweck: "Rechnung",
    },
  ];

  test("Belegnummer im Verwendungszweck ist sicher", () => {
    const t = findeKontobewegung(
      { ...leererBefund(), belegnummer: BESTELLNUMMER, betrag_brutto: 999 },
      bewegungen,
    );
    assert.equal(t?.buchung_id, "b1");
    assert.equal(t?.sicherheit, "sicher");
  });

  test("Aussteller und Betrag auf den Cent sind sicher", () => {
    const t = findeKontobewegung(
      { ...leererBefund(), aussteller: "Hornbach", betrag_brutto: 59.98 },
      [
        bewegungen[0],
        { ...bewegungen[1], absender: "HORNBACH BAUMARKT AG",
          verwendungszweck: "HORNBACH BAUMARKT AG//Kartenzahlung" },
        bewegungen[2],
      ],
    );
    assert.equal(t?.buchung_id, "b2");
    assert.equal(t?.sicherheit, "sicher");
  });

  test("ein Aussteller mit drei Buchstaben erreicht Kriterium 2 nicht", () => {
    // Befund, nicht Absicht: Kriterium 2 in lib/belegabgleich.ts benutzt nur
    // Wortteile ab vier Zeichen. "OBI" hat drei -- für OBI kann dieses
    // Kriterium also nie greifen, auch wenn Name und Betrag perfekt passen.
    // Der Beleg landet dann über Kriterium 3 als "unsicher" zur Bestätigung,
    // statt sich selbst zu buchen. Das ist die harmlose Richtung des
    // Fehlers, soll aber bekannt sein.
    const t = findeKontobewegung(
      { ...leererBefund(), aussteller: "OBI", betrag_brutto: 59.98 },
      bewegungen,
    );
    assert.equal(t?.buchung_id, "b2");
    assert.equal(t?.sicherheit, "unsicher");
  });

  test("nur der Betrag ist unsicher", () => {
    const t = findeKontobewegung(
      { ...leererBefund(), betrag_brutto: 13.37 },
      bewegungen,
    );
    assert.equal(t?.buchung_id, "b3");
    assert.equal(t?.sicherheit, "unsicher");
  });

  test("ohne Betrag und ohne Nummer gibt es keinen Vorschlag", () => {
    assert.equal(findeKontobewegung(leererBefund(), bewegungen), null);
    assert.equal(
      findeKontobewegung({ ...leererBefund(), aussteller: "OBI" }, bewegungen),
      null,
    );
  });

  test("zwei Buchungen mit demselben Betrag ergeben keinen Vorschlag", () => {
    const doppelt: BewegungZeile[] = [
      { ...bewegungen[2], id: "x1" },
      { ...bewegungen[2], id: "x2" },
    ];
    assert.equal(
      findeKontobewegung({ ...leererBefund(), betrag_brutto: 13.37 }, doppelt),
      null,
    );
  });
});

// ---------------------------------------------------------------------------
// Dateityp und Textebene
// ---------------------------------------------------------------------------

async function pdfMitText(zeilen: string[]): Promise<Buffer> {
  const d = await PDFDocument.create();
  const seite = d.addPage([595, 842]);
  const schrift = await d.embedFont(StandardFonts.Helvetica);
  let y = 760;
  for (const z of zeilen) {
    seite.drawText(z, { x: 50, y, size: 11, font: schrift });
    y -= 18;
  }
  return Buffer.from(await d.save());
}

async function pdfOhneText(): Promise<Buffer> {
  const d = await PDFDocument.create();
  d.addPage([595, 842]);
  return Buffer.from(await d.save());
}

describe("Dateityp wird am Inhalt erkannt, nicht an der Endung", () => {
  test("PDF an den Magic Bytes", async () => {
    assert.ok(istPdf(await pdfOhneText()));
    assert.equal(istPdf(Buffer.from("%PDF", "latin1")), false);
    assert.equal(istPdf(Buffer.from("das ist kein pdf", "utf8")), false);
  });

  test("PNG, JPEG, TIFF, WebP und HEIC", () => {
    const png = Buffer.concat([
      Buffer.from([0x89]), Buffer.from("PNG\r\n\x1a\n", "latin1"), Buffer.alloc(4),
    ]);
    assert.ok(istBild(png));
    assert.ok(istBild(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(8)])));
    assert.ok(istBild(Buffer.concat([Buffer.from("II*\u0000", "latin1"), Buffer.alloc(8)])));
    assert.ok(
      istBild(
        Buffer.concat([
          Buffer.from("RIFF", "latin1"), Buffer.alloc(4), Buffer.from("WEBP", "latin1"),
        ]),
      ),
    );
    assert.ok(
      istBild(
        Buffer.concat([
          Buffer.alloc(4), Buffer.from("ftyp", "latin1"), Buffer.from("heic", "latin1"),
        ]),
      ),
    );
  });

  test("eine Textdatei mit der Endung .pdf ist kein Beleg", async () => {
    const r = await lieseBeleg(Buffer.from("Gesamtsumme 126,02 EUR", "utf8"));
    assert.equal(r.art, "unbekannt");
    assert.ok(r.fehler);
    assert.equal(r.text, "");
  });
});

describe("lieseBeleg holt die Textebene oder sagt, dass es keine gibt", () => {
  test("PDF mit Textebene wird ausgelesen und ausgewertet", async () => {
    const bytes = await pdfMitText([
      "Hornbach Baumarkt",
      `Rechnungsnummer RE-2026-0042`,
      "Rechnungsdatum 14.10.2026",
      "Zwischensumme 100,00 EUR",
      "Gesamtsumme 126,02 EUR",
    ]);
    const r = await lieseBeleg(bytes);
    assert.equal(r.art, "pdf");
    assert.equal(r.ohne_textebene, false);
    assert.equal(r.fehler, null);

    const b = werteBelegAus(r.text, "rechnung.pdf");
    assert.equal(b.aussteller, "Hornbach");
    assert.equal(b.belegnummer, "RE-2026-0042");
    assert.equal(b.belegdatum, "2026-10-14");
    assert.equal(b.betrag_brutto, 126.02);
  });

  test("ein PDF ohne Textebene wird als nicht auslesbar gemeldet", async () => {
    // Das Foto einer Baumarktquittung. Hier wird nichts erraten: Die Datei
    // wird abgelegt, die Felder trägt ein Mensch ein.
    const r = await lieseBeleg(await pdfOhneText());
    assert.equal(r.art, "pdf");
    assert.equal(r.ohne_textebene, true, "ohne Textebene muss gemeldet werden");
    assert.equal(r.text.replace(/\s/g, ""), "");

    const b = werteBelegAus(r.text, "quittung.pdf");
    assert.deepEqual(Object.values(b.quelle), [null, null, null, null]);
  });

  test("ein Foto hat nie eine Textebene", async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
    const r = await lieseBeleg(jpeg);
    assert.equal(r.art, "bild");
    assert.equal(r.ohne_textebene, true);
    assert.equal(r.fehler, null);
  });

  test("ein kaputtes PDF verhindert das Ablegen nicht", async () => {
    const r = await lieseBeleg(Buffer.from("%PDF-1.7\nkaputt", "latin1"));
    assert.equal(r.art, "pdf");
    assert.equal(r.ohne_textebene, true);
    assert.ok(r.fehler, "der Fehler soll gemeldet, nicht verschluckt werden");
  });
});

describe("seitenAuswahl", () => {
  test("kurze Belege werden ganz gelesen", () => {
    assert.deepEqual(seitenAuswahl(3), [1, 2, 3]);
    assert.deepEqual(seitenAuswahl(0), []);
  });

  test("bei langen Belegen Anfang und Ende -- dort stehen Kopf und Summe", () => {
    const s = seitenAuswahl(100, 4);
    assert.deepEqual(s, [1, 2, 99, 100]);
  });
});

/**
 * Liest das Portal wirklich Text aus einem PDF?
 *
 * ANLASS, 05.11.2026
 *
 * Es konnte es nicht -- und zwar nie. pdfjs lädt seinen Arbeiter zur
 * Laufzeit nach, und im gebündelten Serverbetrieb lag er nicht dort, wo
 * pdfjs ihn suchte:
 *
 *   Setting up fake worker failed: Cannot find module
 *   '/app/.next/server/chunks/pdf.worker.mjs'
 *
 * lieseBeleg fängt diesen Fehler und meldet "keine Textebene". Damit sah
 * jedes PDF wie ein Scan aus. 229 Belege sind so eingeliefert worden,
 * ohne dass eine einzige Zeile daraus gelesen wurde -- und weil die
 * Felder aus einer mitgelieferten Beifügung kamen, wirkte das Ergebnis
 * vollständig. Gemeldet wurden "0 Abweichungen zwischen zwei Lesungen".
 * Es gab nie zwei Lesungen; die zweite schwieg.
 *
 * Diese Tests prüfen das Gegenteil: dass aus einem PDF mit Textebene
 * auch Text herauskommt. Ein Test, der nur prüft, dass lieseBeleg nicht
 * wirft, hätte den Ausfall mitgetragen.
 */
describe("Textebene wirklich lesen", () => {
  async function pdfMitText(zeilen: string[]): Promise<Buffer> {
    const dok = await PDFDocument.create();
    const schrift = await dok.embedFont(StandardFonts.Helvetica);
    const seite = dok.addPage([595, 842]);
    zeilen.forEach((z, i) =>
      seite.drawText(z, { x: 50, y: 780 - i * 20, size: 11, font: schrift }),
    );
    return Buffer.from(await dok.save());
  }

  test("aus einem PDF mit Textebene kommt der Text heraus", async () => {
    const bytes = await pdfMitText([
      "Rechnung",
      "Bestellnummer 303-9211199-0875554",
      "Zahlbetrag 45,44 EUR",
    ]);
    const d = await lieseBeleg(bytes);
    assert.equal(d.art, "pdf");
    assert.equal(d.fehler, null, `Lesefehler: ${d.fehler}`);
    assert.equal(d.ohne_textebene, false, "PDF wurde fälschlich für einen Scan gehalten");
    assert.match(d.text, /Bestellnummer/);
    assert.match(d.text, /303-9211199-0875554/);
  });

  test("der Betragsleser findet den Betrag darin", async () => {
    const bytes = await pdfMitText(["Rechnung", "Zahlbetrag 1.234,56 EUR"]);
    const d = await lieseBeleg(bytes);
    assert.equal(findeBetrag(d.text), 1234.56);
  });

  test("ein leeres PDF gilt als ohne Textebene -- und nicht als Fehler", async () => {
    const dok = await PDFDocument.create();
    dok.addPage([595, 842]);
    const d = await lieseBeleg(Buffer.from(await dok.save()));
    assert.equal(d.fehler, null);
    assert.equal(d.ohne_textebene, true);
  });
});

describe("Rangfolge der Datumsetiketten", () => {
  /**
   * Der Lesetext einer Amazon-Rechnung stellt beide Daten flach
   * hintereinander, und das Bestelldatum steht zuerst. Eine Alternation
   * aus allen Etiketten greift deshalb das falsche. Am 05.11.2026 lagen
   * 30 von 100 Amazon-Belegen mit dem Bestelldatum in den Buechern.
   * Alle Nummern hier sind erfunden.
   */
  const amazon =
    "Rechnung Seite 1 von 1 USt. 19% 29,40 € 5,59 € Gesamtpreis 34,99 € " +
    "Rechnungsdetails Bestelldatum 28.08.2026 Bestellnummer 302-1111111-2222222 " +
    "USt-IDNr. LU20260743 Verkauft von Beispiel GmbH " +
    "Rechnungsdatum /Lieferdatum 29.08.2026 Rechnungsnummer DE6871MONAEUD " +
    "Zahlbetrag 34,99 €";

  test("das Rechnungsdatum gewinnt, auch wenn das Bestelldatum vorher steht", () => {
    assert.equal(findeDatum(amazon), "2026-08-29");
  });

  test('die Füllung "/Lieferdatum" steht nicht im Weg', () => {
    assert.equal(findeDatum("Rechnungsdatum /Lieferdatum 27.09.2026"), "2026-09-27");
  });

  test("ein deutscher Monatsname wird gelesen", () => {
    assert.equal(
      findeDatum("Bestelldatum 26 September 2026 Rechnungsdatum /Lieferdatum 27 September 2026"),
      "2026-09-27",
    );
    assert.equal(findeDatum("Belegdatum 07. März 2026"), "2026-03-07");
  });

  test("ohne Rechnungsdatum gilt das Bestelldatum", () => {
    assert.equal(findeDatum("Bestelldatum 28.08.2026"), "2026-08-28");
  });

  test("ohne jedes Etikett das erste Datum im Text", () => {
    assert.equal(findeDatum("Lieferung am 14.03.2026 an die Baustelle"), "2026-03-14");
  });

  test("ein unmögliches Datum wird nicht genommen", () => {
    assert.equal(findeDatum("Rechnungsdatum 31.02.2026"), null);
  });
});

describe("Mehrere Rechnungen in einer Datei", () => {
  /**
   * Amazon legt die Rechnungen mehrerer Sendungen einer Bestellung in
   * ein PDF. Die Abbuchung ist eine -- ueber die Summe. Die Zahlen hier
   * sind der am 05.11.2026 an der Bank bestaetigte Fall: 68,91 + 19,99 +
   * 39,99 = 128,89 EUR, und genau 128,89 EUR wurden abgebucht.
   */
  const drei =
    "Rechnungsnummer DE11AAAAAAEUD Zahlbetrag 68,91 € " +
    "Rechnungsnummer DE22BBBBBBEUD Zahlbetrag 19,99 € " +
    "Rechnungsnummer DE33CCCCCCEUD Zahlbetrag 39,99 €";

  test("die Summe, nicht ein Teil", () => {
    const m = findeSummeMehrererRechnungen(drei);
    assert.ok(m);
    assert.equal(m!.rechnungen, 3);
    assert.equal(m!.summe, 128.89);
  });

  test("werteBelegAus nimmt die Summe", () => {
    assert.equal(werteBelegAus(drei).betrag_brutto, 128.89);
  });

  test("dieselbe Rechnung auf zwei Seiten wird nicht verdoppelt", () => {
    // Amazon wiederholt Nummer und Betrag im Seitenkopf. 47,02 EUR auf
    // zwei Seiten sind 47,02 EUR.
    const zweiSeiten =
      "Rechnungsnummer DE66DIQPEAEUD Zahlbetrag 47,02 € Seite 1 von 2 " +
      "Rechnungsnummer DE66DIQPEAEUD Zahlbetrag 47,02 € Seite 2 von 2";
    assert.equal(findeSummeMehrererRechnungen(zweiSeiten), null);
  });

  test("eine einzige Rechnung ergibt null -- das Regelwerk entscheidet", () => {
    assert.equal(
      findeSummeMehrererRechnungen("Rechnungsnummer DE11AAAAAAEUD Zahlbetrag 34,99 €"),
      null,
    );
  });

  test("ohne Rechnungsnummern greift die Regel nicht", () => {
    // Eine polnische Haendlerrechnung schreibt netto/USt/brutto in eine
    // Zeile. Sie hat kein "Zahlbetrag" und keine Amazon-Nummern -- hier
    // darf nichts summiert werden.
    assert.equal(
      findeSummeMehrererRechnungen("Gesamtsumme: in EUR 9,82 1,87 11,69"),
      null,
    );
  });

  test("eine unglaubwürdige Summe wird verworfen", () => {
    const viel =
      "Rechnungsnummer DE11AAAAAAEUD Zahlbetrag 999.999,00 € " +
      "Rechnungsnummer DE22BBBBBBEUD Zahlbetrag 999.999,00 €";
    assert.equal(findeSummeMehrererRechnungen(viel), null);
  });
});

describe("Mehrere Belegstücke in einer Datei", () => {
  /**
   * Der Fall vom 05.11.2026: eine Datei mit einer Rechnung über 41,39 €
   * und einer Quittung über 13,20 € zu einer anderen Bestellung.
   * findeBetrag nimmt den letzten gleichrangigen Treffer -- hier also
   * 13,20 €. Gezählt wird, damit das auffällt.
   */
  const gemischt =
    "Seite 1 von 2 Rechnung Rechnungsnummer DE6UDGSPAEUI Zahlbetrag 41,39 € " +
    "Bestelldatum 07 März 2026 Bestellnummer 303-1111111-2222222 " +
    "Seite 2 von 2 Quittung Quittungsnummer XX6009PPY2RVVT Zahlbetrag 13,20 € " +
    "Bestelldatum 07 März 2026 Bestellnummer 303-4444444-5555555";

  test("zwei Stücke werden als zwei gezählt", () => {
    assert.equal(zaehleBelegstuecke(gemischt), 2);
  });

  test("die Summenregel greift hier nicht -- die Nummern sind verschiedener Art", () => {
    // Nur eine Rechnungsnummer: Summieren waere geraten.
    assert.equal(findeSummeMehrererRechnungen(gemischt), null);
  });

  test("ein Stück auf mehreren Seiten bleibt eins", () => {
    assert.equal(
      zaehleBelegstuecke(
        "Seite 1 von 2 Rechnungsnummer DE66DIQPEAEUD Zahlbetrag 47,02 € " +
          "Seite 2 von 2 Rechnungsnummer DE66DIQPEAEUD Zahlbetrag 47,02 €",
      ),
      1,
    );
  });

  test("ohne Belegnummer null Stücke", () => {
    assert.equal(zaehleBelegstuecke("Gesamtsumme: in EUR 9,82 1,87 11,69"), 0);
  });
});

describe("Belegnummern mit Bindestrichen", () => {
  /**
   * Amazon vergibt neben "DE6UDGSPAEUI" auch
   * "DS-AEU-INV-DE-2025-191950229". Ein Muster aus nur Buchstaben und
   * Ziffern sah davon zwei Zeichen und zaehlte die Datei als ein Stueck.
   * Am 05.11.2026 blieb so eine Datei mit drei Rechnungen unerkannt und
   * der Leser nahm die letzte: 13,75 EUR statt 37,73 EUR.
   * Die Nummern hier sind erfunden.
   */
  const drei =
    "Rechnungsnummer DS-AEU-INV-DE-2025-100000001 Zahlbetrag 3,99 € Seite 1 von 2 " +
    "Rechnungsnummer DS-AEU-INV-DE-2025-100000001 Seite 2 von 2 " +
    "Rechnungsnummer DS-AEU-INV-DE-2025-100000002 Zahlbetrag 19,99 € Seite 1 von 1 " +
    "Rechnungsnummer DS-AEU-INV-DE-2025-100000003 Zahlbetrag 13,75 € Seite 1 von 1";

  test("drei Stücke werden als drei gezählt", () => {
    assert.equal(zaehleBelegstuecke(drei), 3);
  });

  test("die Summe ist 37,73 und nicht die letzte Zahl", () => {
    const m = findeSummeMehrererRechnungen(drei);
    assert.ok(m);
    assert.equal(m!.rechnungen, 3);
    assert.equal(m!.summe, 37.73);
    assert.equal(werteBelegAus(drei).betrag_brutto, 37.73);
  });

  test("die kurze Form zählt weiterhin", () => {
    assert.equal(zaehleBelegstuecke("Rechnungsnummer DE6UDGSPAEUI Zahlbetrag 41,39 €"), 1);
  });
});
