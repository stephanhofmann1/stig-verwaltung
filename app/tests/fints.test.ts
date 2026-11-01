import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";

import { zeitraum, alsBuchungen, type FintsUmsatz } from "../lib/fints/abruf";
import { liesKontoauszug } from "../lib/kontoformate";

/**
 * Tests der FinTS-Anbindung.
 *
 * Drei Dinge entscheiden hier, ob die Anbindung etwas taugt:
 *
 *   1. Der Zeitraum. Ohne Startdatum verlangt jede Bank bei JEDEM Lauf
 *      eine TAN -- dann ist die Anbindung taegliche Arbeit statt deren
 *      Abschaffung.
 *   2. Das Vorzeichen. Wird es verdreht, werden Abbuchungen als
 *      Mieteingaenge gebucht, und ein Mieter erscheint als Zahler.
 *   3. Der Fingerabdruck. Weicht er vom Dateiimport ab, steht jede
 *      Zahlung zweimal in der Datenbank.
 */

const heute = new Date("2026-11-01T12:00:00");
const tag = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-` +
  `${String(d.getDate()).padStart(2, "0")}`;

describe("Der abgefragte Zeitraum", () => {
  test("es wird immer ein Startdatum gesetzt", () => {
    // Der wichtigste Test der Datei. "Alles verfuegbare" abzufragen loest
    // bei jeder Bank eine TAN aus.
    const z = zeitraum(null, heute);
    assert.ok(z.von instanceof Date);
    assert.ok(z.von < z.bis);
  });

  test("der erste Abruf bleibt unter der 90-Tage-Grenze", () => {
    const z = zeitraum(null, heute);
    const tage = Math.round(
      (z.bis.getTime() - z.von.getTime()) / 86_400_000,
    );
    assert.ok(tage <= 90, `${tage} Tage waeren ueber der Grenze`);
    // Nicht genau 90: Die Banken rechnen die Grenze unterschiedlich.
    assert.ok(tage < 90, "ein Abstand zur Grenze gehoert dazu");
  });

  test("ab dem letzten Abruf wird mit Ueberlappung gefragt", () => {
    // Banken aendern Buchungen nachtraeglich, und eine am Abruftag noch
    // vorgemerkte Buchung erscheint erst danach als gebucht. Ohne
    // Ueberlappung fehlt sie dauerhaft.
    const z = zeitraum("2026-10-25", heute);
    assert.equal(tag(z.von), "2026-10-20");
    assert.equal(z.gekuerzt, false);
  });

  test("ein lange zurueckliegender Abruf wird gekuerzt UND gemeldet", () => {
    // Stillschweigend zu kuerzen waere der schlimmere Fehler: Dann fehlt
    // ein Stueck Historie, und die Zahlungen daraus sehen aus wie
    // Rueckstaende.
    const z = zeitraum("2026-01-01", heute);
    assert.equal(z.gekuerzt, true);
    const tage = Math.round((z.bis.getTime() - z.von.getTime()) / 86_400_000);
    assert.ok(tage <= 90);
  });

  test("ein Abruf von heute fragt nicht in die Zukunft", () => {
    const z = zeitraum("2026-11-01", heute);
    assert.ok(z.von <= z.bis);
  });
});

describe("Vorzeichen und Felder", () => {
  const umsatz = (u: Partial<FintsUmsatz> = {}): FintsUmsatz => ({
    entryDate: new Date(2026, 9, 2),
    valueDate: new Date(2026, 9, 2),
    amount: 630,
    remoteName: "Rita Beispiel",
    purpose: "Miete Oktober",
    ...u,
  });

  test("ein Eingang bleibt positiv", () => {
    const [b] = alsBuchungen([umsatz()]);
    assert.equal(b.betrag, 630);
  });

  test("eine Abbuchung bleibt negativ", () => {
    // lib-fints liefert bereits vorzeichenbehaftet (MT940 'D' und 'RC',
    // CAMT 'DBIT'). Es darf hier NICHT noch einmal gedreht werden.
    const [b] = alsBuchungen([umsatz({ amount: -551 })]);
    assert.equal(b.betrag, -551);
  });

  test("der Buchungstag wird nicht um einen Tag verschoben", () => {
    // lib-fints baut seine Daten mit new Date(jahr, monat-1, tag), also
    // lokal. toISOString() wuerde westlich von Greenwich einen Tag
    // zurueckrutschen -- und eine Miete vom 1. landete im Vormonat.
    const [b] = alsBuchungen([
      umsatz({ entryDate: new Date(2026, 10, 1), valueDate: new Date(2026, 10, 1) }),
    ]);
    assert.equal(b.buchungstag, "2026-11-01");
  });

  test("zwei gleiche Umsaetze am selben Tag bleiben zwei", () => {
    const bs = alsBuchungen([umsatz(), umsatz()]);
    assert.equal(bs.length, 2);
    assert.notEqual(bs[0].fingerabdruck, bs[1].fingerabdruck);
  });

  test("derselbe Abruf zweimal ergibt dieselben Fingerabdruecke", () => {
    // Sonst legt der naechste Lauf alles erneut an.
    const a = alsBuchungen([umsatz(), umsatz()]).map((b) => b.fingerabdruck);
    const c = alsBuchungen([umsatz(), umsatz()]).map((b) => b.fingerabdruck);
    assert.deepEqual(a, c);
  });
});

describe("Fingerabdruck gleich wie beim Dateiimport", () => {
  test("FinTS und Sparkassen-CSV erzeugen denselben Fingerabdruck", () => {
    // Das ist der Test, der eine doppelte Buchhaltung verhindert: Holt die
    // Anbindung eine Zahlung, die spaeter auch in einem Dateiexport
    // auftaucht, muss der Import sie als bekannt erkennen. Weichen die
    // Fingerabdruecke ab, steht jede Zahlung zweimal da -- und jeder
    // Mieter waere scheinbar im Guthaben.
    const KOPF =
      '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";' +
      '"Verwendungszweck";"Glaeubiger ID";"Mandatsreferenz";' +
      '"Kundenreferenz (End-to-End)";"Sammlerreferenz";' +
      '"Lastschrift Ursprungsbetrag";"Auslagenersatz Ruecklastschrift";' +
      '"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";' +
      '"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"';
    const zeile =
      '"DE00111100002222333344";"02.10.26";"02.10.26";"GUTSCHRIFT";' +
      '"Miete Oktober";"";"";"";"";"";"";"Rita Beispiel";' +
      '"DE00999900008888777766";"TESTDEFF";"630,00";"EUR";"Umsatz gebucht"';
    const ausDatei = liesKontoauszug(
      Buffer.from([KOPF, zeile].join("\n"), "utf8"),
    ).buchungen[0];

    const ausFints = alsBuchungen([
      {
        entryDate: new Date(2026, 9, 2),
        valueDate: new Date(2026, 9, 2),
        amount: 630,
        remoteName: "Rita Beispiel",
        purpose: "Miete Oktober",
      },
    ])[0];

    assert.equal(ausFints.buchungstag, ausDatei.buchungstag);
    assert.equal(ausFints.betrag, ausDatei.betrag);
    assert.equal(ausFints.absender, ausDatei.absender);
    assert.equal(ausFints.verwendungszweck, ausDatei.verwendungszweck);
    assert.equal(
      ausFints.fingerabdruck,
      ausDatei.fingerabdruck,
      "dieselbe Zahlung muss denselben Fingerabdruck haben",
    );
  });
});

describe("Die PIN", () => {
  const quelle = (p: string) =>
    readFileSync(new URL(p, import.meta.url), "utf8");

  test("ein zu kurzer Schluessel wird abgelehnt, nicht aufgefuellt", () => {
    // Ein aufgefuellter Schluessel sieht aus wie AES-256 und hat die
    // Staerke des eingegebenen Textes. Ein Tippfehler in der .env waere
    // dann eine stillschweigend schwache Verschluesselung.
    const s = quelle("../lib/fints/geheimnis.ts");
    assert.match(s, /\[0-9a-fA-F\]\{64\}/);
    assert.match(s, /muss genau 64 Hexzeichen/);
  });

  test("AES-256-GCM mit zufaelliger Nonce je Aufruf", () => {
    const s = quelle("../lib/fints/geheimnis.ts");
    assert.match(s, /aes-256-gcm/);
    assert.match(s, /randomBytes\(NONCE_LAENGE\)/);
  });

  test("die Grenzen der Verschluesselung sind benannt, nicht beschoenigt", () => {
    // Wichtiger als der Code: Wer das liest, soll nicht glauben, die PIN
    // sei gegen jemanden mit Root geschuetzt. Ist sie nicht, und das muss
    // dastehen.
    const s = quelle("../lib/fints/geheimnis.ts");
    // Der Satz ist umgebrochen, deshalb ueber den Zeilenwechsel hinweg.
    assert.match(s, /NICHT[\s*]+gegen jemanden mit Root auf dem Server/);
  });

  test("eine nicht entschluesselbare PIN wird nicht ausprobiert", () => {
    // Drei Fehlversuche sperren den Bankzugang.
    const s = quelle("../lib/fints/holen.ts");
    assert.match(s, /nicht entschlüsselbar/);
  });

  test("ohne Produktkennung wird nicht abgerufen", () => {
    const s = quelle("../lib/fints/holen.ts");
    assert.match(s, /FINTS_PRODUKT_ID fehlt/);
    assert.match(s, /nur zum Testen/);
  });
});

describe("Verhalten bei TAN und Fehlern", () => {
  const holen = readFileSync(
    new URL("../lib/fints/holen.ts", import.meta.url), "utf8");

  test("bei TAN-Anforderung ruht der Zugang statt zu wiederholen", () => {
    // Ein Lauf, der es alle vier Stunden erneut probiert, sperrt den
    // Zugang an einem Tag.
    assert.match(holen, /tan_faellig = true/);
    assert.match(holen, /Kein Wiederholen/);
  });

  test("letzter_abruf wird nur nach Erfolg fortgeschrieben", () => {
    // Wuerde es auch bei einem Fehler gesetzt, waere der uebersprungene
    // Zeitraum fuer immer verloren -- und die fehlenden Zahlungen saehen
    // aus wie Rueckstaende.
    assert.match(holen, /Erst jetzt fortschreiben/);
    // Im Fehlerzweig darf kein letzter_abruf gesetzt werden.
    const fehlerzweig = holen.slice(
      holen.indexOf('if (e.art === "fehler")'),
      holen.indexOf("let neu = 0;"),
    );
    assert.doesNotMatch(fehlerzweig, /letzter_abruf/);
    const tanzweig = holen.slice(
      holen.indexOf('if (e.art === "tan_faellig")'),
      holen.indexOf('if (e.art === "fehler")'),
    );
    assert.doesNotMatch(tanzweig, /letzter_abruf/);
  });

  test("nur aktive Zugaenge ohne offene TAN werden abgerufen", () => {
    assert.match(holen, /WHERE aktiv = true AND tan_faellig = false/);
  });
});

describe("Die Einrichtung", () => {
  const route = readFileSync(
    new URL("../app/api/bank/route.ts", import.meta.url), "utf8");

  test("nur Verwalter, kein Mieterzugang", () => {
    assert.match(route, /sitzung\.rolle === "mieter"/);
    assert.match(route, /status: 403/);
  });

  test("ohne TLS wird die Bankadresse abgelehnt", () => {
    // Ein FinTS-Endpunkt ohne TLS waere eine PIN im Klartext ueber das
    // Netz. Das wird nicht entgegengenommen, auch nicht auf Wunsch.
    assert.match(route, /\^https:\\\/\\\//);
    assert.match(route, /muss mit https:\/\/ beginnen/);
  });

  test("die PIN wird nirgends protokolliert oder zurueckgegeben", () => {
    // Die Antwort landet im Browser und womoeglich in einem Protokoll.
    assert.doesNotMatch(route, /console\.[a-z]+\([^)]*pin/i);
    // In der Antwort steht kein Echo der Eingaben.
    const antwort = route.slice(route.indexOf("return NextResponse.json({ ok: true"));
    assert.doesNotMatch(antwort, /pin/i);
  });

  test("die PIN wird sofort verschluesselt, nicht im Klartext gespeichert", () => {
    assert.match(route, /verschluessele\(pin\)/);
    assert.doesNotMatch(route, /VALUES[^)]*\bpin\b[^)]*\)/);
  });

  test("ohne FINTS_SCHLUESSEL wird keine PIN angenommen", () => {
    // Sonst liegt sie unverschluesselt in der Datenbank.
    assert.match(route, /schluesselVorhanden\(\)/);
    assert.match(route, /status: 503/);
  });

  test("eine neue PIN verwirft die alten Bankinformationen", () => {
    // Die gehoeren zu einer Anmeldung, die es so nicht mehr gibt.
    assert.match(route, /bank_information = NULL/);
  });
});

describe("Der naechtliche Lauf", () => {
  const lauf = readFileSync(
    new URL("../app/api/aufgaben/bankabruf/route.ts", import.meta.url), "utf8");

  test("ein gescheiterter Zugang haelt die anderen nicht auf", () => {
    // Nicht am Kommentar geprueft, sondern an der Bauform: hole() wirft
    // nicht, sondern gibt { art: "fehler" } zurueck. Damit KANN ein
    // abgelaufenes Passwort bei der Sparkasse die Schleife nicht
    // abbrechen und die Volksbank mitnehmen.
    const h = readFileSync(
      new URL("../lib/fints/holen.ts", import.meta.url), "utf8");
    assert.match(h, /catch \(e\) \{\s*return \{ art: "fehler"/);
    // Und der Lauf behandelt jeden Zugang einzeln.
    assert.match(lauf, /for \(const z of liste\)/);
  });

  test("der Bankabruf laeuft vor den Sollstellungen", () => {
    // Umgekehrt saehe eine Zahlung von heute morgen aus wie ein Rueckstand.
    const plan = readFileSync(
      new URL("../../aufgaben.sh", import.meta.url), "utf8");
    assert.ok(
      plan.indexOf("anstossen bankabruf") < plan.indexOf("anstossen sollstellungen"),
      "bankabruf muss vor sollstellungen stehen",
    );
  });

  test("eine offene TAN wird als Hinweis gemeldet", () => {
    assert.match(lauf, /TAN nötig/);
  });

  test("ein gekuerzter Zeitraum wird gemeldet", () => {
    assert.match(lauf, /Es fehlt Historie/);
  });

  test("kein eingerichteter Zugang wird gemeldet, nicht verschwiegen", () => {
    // Sonst sieht ein Lauf ohne Anbindung aus wie einer ohne neue Umsaetze.
    assert.match(lauf, /Kein FinTS-Zugang eingerichtet/);
  });

  test("die drei FinTS-Werte stehen ohne :? in der compose.yaml", () => {
    // Mit :? wuerde eine fehlende Bankanbindung den Start der ganzen
    // Anwendung verhindern -- und damit die Mieterverwaltung anhalten.
    const c = readFileSync(new URL("../../compose.yaml", import.meta.url), "utf8");
    for (const v of ["FINTS_SCHLUESSEL", "FINTS_PRODUKT_ID"])
      assert.match(c, new RegExp(`${v}: \\$\\{${v}:-\\}`), `${v} fehlt oder hat :?`);
  });
});
