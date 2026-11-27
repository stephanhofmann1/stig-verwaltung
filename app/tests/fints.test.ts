import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";

import { zeitraum, alsBuchungen, bankMeldung, wegenZugangsdaten,
         sollStilllegen, zweiSchrittVerfahren, waehleTanVerfahren,
         EINSCHRITT, setzeTanMedium, waehleTanMedium,
         wegenGeraetebezeichnung, hinweisGeraet,
         type FintsUmsatz } from "../lib/fints/abruf";
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

/**
 * Schneidet jeden NextResponse.json(...)-Aufruf vollstaendig heraus.
 *
 * Ueber die Klammerbilanz statt per Regex: Die Aufrufe gehen ueber eine
 * bis acht Zeilen und enthalten verschachtelte Objekte. Jedes
 * Zeilenmuster erwischt nur einen Teil, und ein Test, der nur zwei
 * Drittel prueft, meldet Erfolg fuer die ungeprueften.
 */
function jsonAufrufe(quelle: string): string[] {
  const treffer: string[] = [];
  const marke = "NextResponse.json(";
  let i = quelle.indexOf(marke);
  while (i !== -1) {
    let tiefe = 0;
    let j = i + marke.length - 1;
    for (; j < quelle.length; j++) {
      if (quelle[j] === "(") tiefe++;
      else if (quelle[j] === ")") {
        tiefe--;
        if (tiefe === 0) break;
      }
    }
    treffer.push(quelle.slice(i + marke.length, j));
    i = quelle.indexOf(marke, j);
  }
  return treffer;
}

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

    /*
      Geprueft wird jede einzelne Antwort der Datei, nicht der Text ab
      der ersten Erfolgsmeldung. Die aeltere Fassung schnitt dort ab und
      verbot im Rest jedes Vorkommen von "pin" -- das hielt, solange
      POST die letzte Funktion war, und schlug fehl, sobald PATCH
      dahinterkam, obwohl der die PIN voellig regulaer verarbeitet.

      Verboten ist der WERT: pin als Bezeichner in einem Objektliteral
      oder in einer Zeichenkette. Das Wort PIN im Klartext einer
      Fehlermeldung ("Ohne ihn wird keine PIN gespeichert") ist in
      Ordnung und soll es bleiben.
    */
    const antworten = jsonAufrufe(route);
    // Gegenprobe auf den Test selbst: Ein Muster, das nur einen Teil der
    // Aufrufe findet, gibt Sicherheit vor, die es nicht gibt. Ein erster
    // Versuch mit einem Zeilenmuster erfasste 6 von 15.
    assert.equal(
      antworten.length,
      (route.match(/NextResponse\.json\(/g) ?? []).length,
      "Der Test erfasst nicht jede Antwort der Datei",
    );
    for (const a of antworten) {
      assert.doesNotMatch(
        a,
        /[:{,]\s*pin\b|\$\{\s*pin\b/,
        `Eine Antwort gibt die PIN zurueck:\n${a}`,
      );
    }
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

describe("Abruf von Hand und TAN-Eingabe", () => {
  const lies = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const interaktiv = lies("../lib/fints/interaktiv.ts");
  const tanRoute = lies("../app/api/bank/tan/route.ts");
  const sitzungen = lies("../lib/fints/sitzungen.ts");

  test("die TAN wird nicht protokolliert und nicht gespeichert", () => {
    // Sie ist Minuten gueltig und gehoert in keine Datenbank und in kein
    // Log. Ein versehentliches console.log waere eine TAN in der
    // Containerausgabe.
    for (const [name, q] of [["interaktiv", interaktiv], ["route", tanRoute]] as const) {
      assert.doesNotMatch(q, /console\.[a-z]+\([^)]*\btan\b/i, `${name}: TAN im Log`);
      assert.doesNotMatch(q, /INSERT[^;]*\btan\b[^;]*VALUES/i, `${name}: TAN gespeichert`);
    }
  });

  test("ein Dialog wird nach einem Versuch verworfen", () => {
    // Ein zweiter Versuch auf demselben Dialog zaehlt bei der Bank als
    // weiterer Fehlversuch -- drei davon sperren den Zugang. Deshalb
    // vergessen, BEVOR die TAN ueberhaupt geprueft wird.
    const ab = interaktiv.indexOf("export async function loeseTanEin");
    const vergessen = interaktiv.indexOf("vergiss(token)", ab);
    assert.ok(vergessen > ab, "vergiss(token) fehlt in loeseTanEin");

    // Vor JEDEM Einloesen, nicht nur vor dem ersten.
    for (const ruf of ["synchronizeWithTan", "getAccountStatementsWithTan"]) {
      const stelle = interaktiv.indexOf(ruf, ab);
      assert.ok(stelle > 0, `${ruf} nicht gefunden`);
      assert.ok(
        vergessen < stelle,
        `der Dialog muss vor ${ruf} verworfen werden -- sonst bleibt er ` +
        "nach einer falschen TAN offen, und ein zweiter Versuch darauf " +
        "zaehlt bei der Bank als weiterer Fehlversuch",
      );
    }
  });

  test("eine abgelaufene TAN-Anfrage erklaert, dass kein Fehlversuch entstand", () => {
    // Sonst traut sich niemand, es noch einmal zu versuchen.
    assert.match(interaktiv, /nicht als Fehlversuch/);
  });

  test("auch der Abruf von Hand haelt sich an den Zeitraum", () => {
    // Sonst loest der erste Abruf ueber die Oberflaeche eine TAN aus und
    // setzt letzter_abruf so, dass der naechtliche Lauf wieder eine
    // braucht.
    assert.match(interaktiv, /zeitraum\(z\.letzter_abruf, heute\)/);
    assert.doesNotMatch(interaktiv, /getAccountStatements\(konto\)/);
  });

  test("nach geglueckter Erstanmeldung werden die Bankinformationen gesichert", () => {
    // Ohne sie verlangt JEDER weitere Abruf wieder eine Synchronisation --
    // und damit wieder eine TAN.
    assert.match(interaktiv, /UPDATE fints_zugang SET bank_information/);
  });

  test("offene Dialoge laufen von selbst ab", () => {
    assert.match(sitzungen, /LEBENSDAUER_MS/);
    assert.match(sitzungen, /function aufraeumen/);
  });

  test("Mieterzugaenge kommen an die Bankseite nicht heran", () => {
    for (const p of ["../app/api/bank/route.ts", "../app/api/bank/abruf/route.ts",
                     "../app/api/bank/tan/route.ts"]) {
      const q = lies(p);
      assert.match(q, /rolle === "mieter"/, `${p}: keine Rollenpruefung`);
      assert.match(q, /status: 403/, `${p}: kein 403`);
    }
  });

  test("das PIN-Feld ist ein Passwortfeld ohne Autovervollstaendigung", () => {
    const form = lies("../components/BankNeu.tsx");
    assert.match(form, /name="pin"[^>]*type="password"/);
    assert.match(form, /autoComplete="off"/);
    // Und nach dem Speichern wird das Formular geleert, damit die PIN
    // nicht im Browser stehen bleibt.
    assert.match(form, /form\.reset\(\)/);
  });
});

/* ------------------------------------------------------------------ *
 * Was die Bank meldet, und was daraus folgt
 *
 * Nachgetragen am 06.11.2026, nach einem Einrichtungsversuch, bei dem
 * die Oberflaeche "Stimmt der Anmeldename?" zeigte, waehrend die Bank
 * etwas voellig anderes gesagt hatte. Die Meldung war geraten: Der Code
 * pruefte nach der Erstanmeldung nicht, ob sie ueberhaupt geklappt hat,
 * sah eine leere Kontenliste und schloss auf den Anmeldenamen.
 *
 * Der Schaden daran ist nicht die falsche Meldung, sondern wohin sie
 * fuehrt: Man dreht am Anmeldenamen und probiert erneut, waehrend die
 * Bank Fehlversuche zaehlt. Nach drei Versuchen ist der Zugang gesperrt,
 * auch der im Browser.
 * ------------------------------------------------------------------ */

describe("Die Meldung der Bank", () => {
  test("Fehlercodes stehen mit Nummer im Text", () => {
    // Die Nummer bleibt drin, weil sie die Suche traegt: "9931" findet
    // die Erklaerung, "Anmeldung fehlgeschlagen" nicht.
    const m = bankMeldung([
      { code: 3920, text: "Zugelassene Zwei-Schritt-Verfahren" },
      { code: 9931, text: "PIN gesperrt" },
    ]);
    assert.match(m, /9931/);
    assert.match(m, /PIN gesperrt/);
  });

  test("ohne Fehlercode wird trotzdem die Bank genannt, nicht wir", () => {
    const m = bankMeldung([{ code: 3060, text: "Teilweise ausgefuehrt" }]);
    assert.match(m, /Bank/);
    assert.match(m, /3060/);
  });

  test("ganz ohne Rueckmeldung bleibt eine ehrliche Aussage", () => {
    assert.match(bankMeldung([]), /ohne einen Grund/);
    assert.match(bankMeldung(undefined), /ohne einen Grund/);
  });
});

describe("Stilllegen oder weiterlaufen lassen", () => {
  test("Zugangsdaten abgelehnt: der Zugang muss ruhen", () => {
    for (const m of [
      "9931 PIN gesperrt",
      "9942 PIN falsch",
      "9210 Ungueltige Daten",
      "9340 Signatur falsch",
      "Die Benutzerkennung ist nicht zugelassen",
      "Legitimation fehlgeschlagen",
    ]) {
      assert.ok(wegenZugangsdaten(m), `haette stilllegen muessen: ${m}`);
    }
  });

  test("Stoerungen duerfen NICHT stilllegen", () => {
    /*
      Die wichtigere Haelfte. Ein stillgelegter Zugang, den niemand
      bemerkt, holt keine Zahlungen mehr -- und dann erscheinen
      puenktliche Mieter im Mahnwesen als saeumig. Ein Netzfehler ist
      beim naechsten Lauf vorbei und darf das nicht ausloesen.
    */
    for (const m of [
      "fetch failed",
      "ETIMEDOUT",
      "socket hang up",
      "Die Bank hat den Abruf abgelehnt, ohne einen Grund zu nennen.",
      "9050 Nachricht teilweise fehlerhaft",
    ]) {
      assert.ok(!wegenZugangsdaten(m), `haette laufen lassen muessen: ${m}`);
    }
  });
});

describe("Der Code prueft die Erstanmeldung", () => {
  const HOLEN = readFileSync(
    new URL("../lib/fints/holen.ts", import.meta.url), "utf8");
  const INTERAKTIV = readFileSync(
    new URL("../lib/fints/interaktiv.ts", import.meta.url), "utf8");

  test("nach synchronize() wird success geprueft, vor der Kontenliste", () => {
    /*
      Genau das fehlte. Geprueft wird die Reihenfolge, nicht nur das
      Vorkommen: Steht die Pruefung hinter dem Griff in die Kontenliste,
      meldet der Code wieder "Stimmt der Anmeldename?", bevor er die
      Bank zu Wort kommen laesst.
    */
    for (const [name, quelle] of [["holen.ts", HOLEN], ["interaktiv.ts", INTERAKTIV]] as const) {
      const sync = quelle.indexOf("client.synchronize()");
      const pruefung = quelle.indexOf("if (!s.success)", sync);
      const konten = quelle.indexOf("bankAccounts", sync);
      assert.ok(sync > 0, `${name}: synchronize nicht gefunden`);
      assert.ok(pruefung > sync, `${name}: success wird nach synchronize nicht geprueft`);
      assert.ok(
        pruefung < konten,
        `${name}: success wird erst nach der Kontenliste geprueft`,
      );
    }
  });

  test("ein Fehler an den Zugangsdaten legt den Zugang still", () => {
    assert.match(HOLEN, /sollStilllegen\(e\)/);
    assert.match(HOLEN, /aktiv = CASE WHEN/);
  });
});

describe("Zugaenge lassen sich pflegen", () => {
  const ROUTE = readFileSync(
    new URL("../app/api/bank/route.ts", import.meta.url), "utf8");
  const PFLEGEN = readFileSync(
    new URL("../components/BankZugangPflegen.tsx", import.meta.url), "utf8");
  const SEITE = readFileSync(
    new URL("../app/bank/page.tsx", import.meta.url), "utf8");

  test("es gibt einen Weg zum Aendern ohne Neuanlage", () => {
    assert.match(ROUTE, /export async function PATCH/);
  });

  test("eine leere PIN laesst die gespeicherte in Ruhe", () => {
    /*
      Sonst muesste man bei jeder Korrektur am Anmeldenamen die PIN neu
      eintippen -- und jeder Vertipper dort kostet einen der drei
      Versuche bis zur Sperrung.
    */
    assert.match(ROUTE, /pin \? verschluessele\(pin\) : null/);
    assert.match(ROUTE, /pin_verschluesselt = COALESCE\(\$6, pin_verschluesselt\)/);
  });

  test("eine Aenderung weckt den stillgelegten Zugang wieder", () => {
    const patch = ROUTE.slice(ROUTE.indexOf("export async function PATCH"));
    assert.match(patch, /aktiv = true/);
    // Die alte Synchronisation gehoert zu Zugangsdaten, die es nicht
    // mehr gibt.
    assert.match(patch, /bank_information = NULL/);
  });

  test("die Oberflaeche kann aendern und entfernen", () => {
    assert.match(PFLEGEN, /method: "PATCH"/);
    assert.match(PFLEGEN, /method: "DELETE"/);
    assert.match(SEITE, /BankZugangPflegen/);
  });

  test("das Entfernen fragt nach", () => {
    // Mit dem Zugang gehen PIN und Abrufstand weg; danach holt der
    // naechste Abruf 85 Tage und verlangt eine TAN.
    assert.match(PFLEGEN, /loeschFrage/);
    assert.match(PFLEGEN, /wirklich entfernen/);
  });

  test("die PIN wird nicht ins Formular zurueckgeschrieben", () => {
    // defaultValue an der PIN waere die gespeicherte PIN im HTML der
    // Seite -- lesbar fuer jeden, der den Quelltext oeffnet.
    const pinFeld = PFLEGEN.slice(PFLEGEN.indexOf('name="pin"'));
    const bisEnde = pinFeld.slice(0, pinFeld.indexOf("/>"));
    assert.ok(
      !bisEnde.includes("defaultValue"),
      "Das PIN-Feld traegt einen Vorgabewert",
    );
  });
});

describe("Nur die Bank kann einen Zugang stilllegen", () => {
  /*
    Nachgetragen am 06.11.2026. Beim Einbau der Stilllegung wurde allein
    am Wortlaut entschieden, ob ein Fehler an den Zugangsdaten liegt.
    Das ging schief: "Für diesen Zugang ist keine PIN hinterlegt" ist
    unser eigener Fehler -- die Bank wurde nie gefragt --, enthaelt aber
    das Wort PIN und haette den Zugang stillgelegt. Danach holt der
    naechtliche Lauf keine Zahlungen mehr, und puenktliche Mieter
    erscheinen im Mahnwesen als saeumig. Seitdem entscheidet ein eigenes
    Merkmal am Ergebnis, nicht der Text.
  */
  const HOLEN = readFileSync(
    new URL("../lib/fints/holen.ts", import.meta.url), "utf8");
  const ABRUF = readFileSync(
    new URL("../app/api/bank/abruf/route.ts", import.meta.url), "utf8");

  test("unsere eigenen Fehler duerfen nicht stilllegen", () => {
    /*
      Diese Saetze entstehen, bevor eine Verbindung zustande kommt --
      zwei davon enthalten das Wort PIN. Ohne vonDerBank haette der
      Textfilter sie fuer eine Bankablehnung gehalten.
    */
    for (const meldung of [
      "Für diesen Zugang ist keine PIN hinterlegt.",
      "FINTS_SCHLUESSEL ist nicht gesetzt. Ohne ihn kann die hinterlegte PIN nicht gelesen werden.",
      "Zugang nicht gefunden.",
    ]) {
      assert.equal(
        sollStilllegen({ meldung }),
        false,
        `haette stillgelegt, obwohl die Bank nie gefragt wurde: ${meldung}`,
      );
      // Zur Probe, dass der Fall ueberhaupt scharf ist: Mit Herkunft
      // von der Bank wuerden dieselben Worte sehr wohl stilllegen.
      if (meldung.includes("PIN")) {
        assert.equal(sollStilllegen({ meldung, vonDerBank: true }), true);
      }
    }
  });

  test("eine Stoerung von der Bank legt auch nicht still", () => {
    // vonDerBank allein reicht nicht -- es muss um die Zugangsdaten gehen.
    assert.equal(
      sollStilllegen({ meldung: "9050 Nachricht teilweise fehlerhaft", vonDerBank: true }),
      false,
    );
  });

  test("beide Wege pruefen die Herkunft, nicht nur den Text", () => {
    // holen.ts ist der naechtliche Lauf, abruf/route.ts der Klick von
    // Hand. Beide schreiben in dieselbe Spalte; faellt einer aus der
    // Regel, merkt man es erst an einem stummen Zugang.
    for (const [name, quelle] of [["holen.ts", HOLEN], ["abruf/route.ts", ABRUF]] as const) {
      assert.match(
        quelle,
        /sollStilllegen\(/,
        `${name}: trifft die Entscheidung selbst statt ueber sollStilllegen`,
      );
    }
  });

  test("der Abruf von Hand merkt sich den Fehler", () => {
    /*
      Vorher ging die Meldung nur an den Browser und war beim naechsten
      Laden weg -- samt Rueckmeldecode der Bank, dem einzigen Hinweis,
      der beim Einrichten weiterhilft.
    */
    assert.match(ABRUF, /letzter_fehler = \$2/);
    // Und raeumt ihn wieder weg, wenn es klappt.
    assert.match(ABRUF, /letzter_fehler = NULL/);
  });

  test("eine Bankablehnung legt weiterhin stumm", () => {
    // Die Gegenrichtung: Wenn die Bank wirklich ablehnt, muss der Zugang
    // ruhen, sonst verbraucht der Lauf um 18:00 den naechsten Versuch.
    assert.ok(wegenZugangsdaten("9931 PIN gesperrt"));
    assert.match(HOLEN, /bankMeldung\(s\.bankAnswers\), vonDerBank: true/);
  });
});

describe("Kein Konto trotz geglueckter Anmeldung", () => {
  /*
    Am 06.11.2026 stand bei richtigem VR-NetKey und richtiger PIN immer
    noch "Stimmt der Anmeldename?" -- und schickte damit in die falsche
    Richtung. An dieser Stelle im Ablauf ist die Anmeldung naemlich
    schon durch: Waere sie es nicht, haette die Pruefung auf success
    vorher abgebrochen. Wer die Meldung liest, hat den Anmeldenamen
    also richtig und sucht trotzdem dort weiter.
  */
  const INTERAKTIV = readFileSync(
    new URL("../lib/fints/interaktiv.ts", import.meta.url), "utf8");

  test("die Meldung behauptet nicht mehr, der Anmeldename sei schuld", () => {
    assert.ok(
      !INTERAKTIV.includes("Stimmt der Anmeldename?"),
      "Die alte, irrefuehrende Meldung steht noch im Code",
    );
  });

  test("sie sagt, dass die Anmeldung geklappt hat", () => {
    // Das ist die eine Information, die der Leser an dieser Stelle
    // wirklich braucht: Es liegt nicht an den Zugangsdaten.
    const stelle = INTERAKTIV.slice(INTERAKTIV.indexOf("if (!konto)"));
    assert.match(stelle, /Anmeldung bei der Bank hat geklappt/);
    assert.match(stelle, /freigeschaltet/);
  });

  test("sie nennt die gesuchte IBAN, wenn eine hinterlegt ist", () => {
    /*
      Die zweite moegliche Ursache ist eine Einschraenkung bei uns: Eine
      im Zugang hinterlegte IBAN, die zu keinem gemeldeten Konto passt.
      Dann liegt es nicht an der Bank, und das muss unterscheidbar sein.
    */
    const stelle = INTERAKTIV.slice(INTERAKTIV.indexOf("if (!konto)"));
    assert.match(stelle, /z\.konto_iban/);
    assert.match(stelle, /konten\.length/);
  });
});

describe("Das TAN-Verfahren wird gewaehlt", () => {
  /*
    Der Fehler, den diese Tests festhalten:

    Vom 06. bis zum 23.11.2026 kam der Zugang bei der Volksbank Buehl
    nicht zustande. Die Anmeldung wurde angenommen, aber die Bank
    lieferte kein Konto. Wir haben am Anmeldenamen gesucht, an der
    Kundennummer, an der Freischaltung des Kontos -- und die Bank hat
    dann geschrieben, woran es lag: Unsere Software meldete gar kein
    TAN-Verfahren zurueck, sondern das Einschrittverfahren 999.

    lib-fints setzt die 999 ein, wenn ihr keine Kennung mitgegeben wird
    (`secFunc: tanMethodId ?? 999`). Genau unser Fall bei der
    Erstanmeldung. Ohne Zwei-Schritt-Verfahren laesst die Bank den
    Login zu, ruecht aber die Konten nicht heraus.
  */

  const client = (
    methoden: { id: number; name: string; activeTanMedia?: string[] }[],
  ) => ({ config: { availableTanMethods: methoden } });

  test("das Einschrittverfahren 999 zaehlt nicht als Verfahren", () => {
    const v = zweiSchrittVerfahren(
      client([
        { id: EINSCHRITT, name: "Einschritt-Verfahren" },
        { id: 921, name: "SecureGo plus", activeTanMedia: ["Handy"] },
      ]),
    );
    assert.deepEqual(v.map((x) => x.id), [921]);
    assert.deepEqual(v[0].medien, ["Handy"]);
  });

  test("bietet die Bank nur eines an, wird es ohne Rueckfrage genommen", () => {
    const wahl = waehleTanVerfahren(
      [{ id: 921, name: "SecureGo plus", medien: ["Handy"] }], null,
    );
    assert.equal(wahl.art, "gewaehlt");
    assert.equal(wahl.art === "gewaehlt" && wahl.verfahren.id, 921);
  });

  test("bei mehreren wird gefragt, und die Meldung nennt alle Kennungen", () => {
    const wahl = waehleTanVerfahren(
      [
        { id: 921, name: "SecureGo plus", medien: [] },
        { id: 942, name: "Sm@rt-TAN plus", medien: [] },
      ],
      null,
    );
    assert.equal(wahl.art, "auswahl_noetig");
    if (wahl.art !== "auswahl_noetig") return;
    /*
      Die Kennungen muessen in der Meldung stehen. Sonst steht Stephan
      vor einem Feld, in das eine Zahl gehoert, die er nirgends ablesen
      kann -- und muss im Onlinebanking raten.
    */
    assert.match(wahl.meldung, /921/);
    assert.match(wahl.meldung, /942/);
    assert.match(wahl.meldung, /SecureGo plus/);
  });

  test("ein hinterlegtes Verfahren wird verwendet, nicht neu geraten", () => {
    const wahl = waehleTanVerfahren(
      [
        { id: 921, name: "SecureGo plus", medien: [] },
        { id: 942, name: "Sm@rt-TAN plus", medien: [] },
      ],
      942,
    );
    assert.equal(wahl.art, "gewaehlt");
    assert.equal(wahl.art === "gewaehlt" && wahl.verfahren.id, 942);
  });

  test("faellt das hinterlegte Verfahren weg, wird gefragt statt getauscht", () => {
    /*
      Nicht stillschweigend ein anderes nehmen: Wenn die Bank das
      gewohnte Verfahren abschaltet, soll das auffallen und nicht in
      einer Anmeldung enden, die auf eine TAN wartet, die niemand
      erwartet.
    */
    const wahl = waehleTanVerfahren(
      [{ id: 921, name: "SecureGo plus", medien: [] }], 942,
    );
    assert.equal(wahl.art, "auswahl_noetig");
    assert.match(
      wahl.art === "auswahl_noetig" ? wahl.meldung : "", /942/,
    );
  });

  test("eine hinterlegte 999 gilt als nicht gesetzt", () => {
    const wahl = waehleTanVerfahren(
      [{ id: 921, name: "SecureGo plus", medien: [] }], EINSCHRITT,
    );
    assert.equal(wahl.art, "gewaehlt");
    assert.equal(wahl.art === "gewaehlt" && wahl.verfahren.id, 921);
  });

  test("nennt die Bank keines, bleibt es dabei statt abzubrechen", () => {
    assert.equal(waehleTanVerfahren([], null).art, "keines");
  });
});

describe("Die Wahl steht an der richtigen Stelle im Ablauf", () => {
  const HOLEN = readFileSync(
    new URL("../lib/fints/holen.ts", import.meta.url), "utf8");
  const INTERAKTIV = readFileSync(
    new URL("../lib/fints/interaktiv.ts", import.meta.url), "utf8");
  const BEIDE = [["holen.ts", HOLEN], ["interaktiv.ts", INTERAKTIV]] as const;

  test("gewaehlt wird nach der Anmeldepruefung und vor der Kontenliste", () => {
    /*
      Die Reihenfolge ist der ganze Punkt. Zu frueh gewaehlt, gibt es
      noch keine Liste der Verfahren -- die schickt die Bank erst in der
      Antwort auf die Synchronisierung. Zu spaet gewaehlt, ist die
      Kontenliste schon gelesen, und sie ist leer.
    */
    for (const [name, quelle] of BEIDE) {
      const pruefung = quelle.indexOf("if (!s.success)");
      const wahl = quelle.indexOf("waehleTanVerfahren(", pruefung);
      const konten = quelle.indexOf("bankAccounts", pruefung);
      assert.ok(wahl > pruefung, `${name}: Wahl fehlt oder steht zu frueh`);
      assert.ok(konten > 0, `${name}: Kontenliste nicht gefunden`);
      assert.ok(wahl < konten, `${name}: erst Konten lesen, dann waehlen`);
    }
  });

  test("nach der Wahl wird erneut synchronisiert", () => {
    /*
      Ohne den zweiten Durchgang bleibt die Kontenliste leer: Die
      Userparameterdaten kommen nur in einem Dialog, der mit dem
      gewaehlten Verfahren unterschrieben ist.
    */
    for (const [name, quelle] of BEIDE) {
      const wahl = quelle.indexOf("selectTanMethod(");
      assert.ok(wahl > 0, `${name}: selectTanMethod fehlt`);
      const konten = quelle.indexOf("bankAccounts", wahl);
      const zweite = quelle.indexOf("client.synchronize()", wahl);
      assert.ok(
        zweite > wahl && (konten < 0 || zweite < konten),
        `${name}: nach selectTanMethod wird nicht erneut synchronisiert`,
      );
    }
  });

  test("das gewaehlte Verfahren wird gespeichert", () => {
    /*
      Sonst waehlt der naechste Lauf von vorn -- und bleibt bei mehreren
      angebotenen Verfahren jedes Mal mit derselben Rueckfrage stehen.
    */
    assert.match(HOLEN, /tan_verfahren = COALESCE/);
    assert.match(INTERAKTIV, /merkeVerfahren\(/);
    assert.match(INTERAKTIV, /SET tan_verfahren = \$2/);
  });
});

describe("Die Geraetebezeichnung", () => {
  /*
    Sparkasse Wetzlar, 27.11.2026:
    "9050 Die Nachricht enthaelt Fehler.; 9800 Dialog abgebrochen;
     9955 Auftrag nicht ausgefuehrt - Die Geraetebezeichnung ist unbekannt."

    Anmeldung und Verfahrenswahl hatten funktioniert. Es fehlte die
    Angabe, welches Geraet die TAN bekommen soll.
  */

  const client = (aktive: string[]) => {
    const verfahren = { activeTanMedia: aktive };
    const gesetzt: string[] = [];
    return {
      config: { selectedTanMethod: verfahren },
      selectTanMedia(name: string) {
        /* Die Pruefung der Bibliothek, nachgebaut. */
        if (!verfahren.activeTanMedia.includes(name)) {
          throw new Error(`TAN media '${name}' not found`);
        }
        gesetzt.push(name);
      },
      gesetzt,
      verfahren,
    };
  };

  test("ein Name wird auch gesetzt, wenn die Liste der Bank leer ist", () => {
    /*
      Der Kern. Bei der Erstanmeldung ist activeTanMedia IMMER leer --
      die Liste holt lib-fints erst in einem Dialog, in dem schon ein
      Verfahren gewaehlt ist, und genau der scheitert ohne Geraet.
      Ohne diesen Schritt wirft die Bibliothek, bevor die Bank ueberhaupt
      gefragt wird.
    */
    const c = client([]);
    setzeTanMedium(c, "iPhone von Stephan");
    assert.deepEqual(c.gesetzt, ["iPhone von Stephan"]);
  });

  test("ein Name aus der Liste wird unveraendert durchgereicht", () => {
    const c = client(["Handy", "Zweitgeraet"]);
    setzeTanMedium(c, "Zweitgeraet");
    assert.deepEqual(c.gesetzt, ["Zweitgeraet"]);
    assert.deepEqual(c.verfahren.activeTanMedia, ["Handy", "Zweitgeraet"]);
  });

  test("das hinterlegte Geraet hat Vorrang vor dem der Bank", () => {
    /*
      Sonst spricht ein Lauf stillschweigend ein anderes Geraet an, und
      die TAN landet auf einem Handy, das vielleicht nicht mehr benutzt
      wird.
    */
    assert.equal(waehleTanMedium("Mein Handy", ["Anderes Handy"]), "Mein Handy");
  });

  test("nennt die Bank genau eines und ist keines hinterlegt, gilt ihres", () => {
    assert.equal(waehleTanMedium(null, ["Handy"]), "Handy");
  });

  test("bei mehreren ohne Hinterlegung wird keines geraten", () => {
    assert.equal(waehleTanMedium(null, ["Handy", "Tablet"]), null);
  });

  test("die Rueckmeldung der Bank wird erkannt", () => {
    const echt =
      "9050 Die Nachricht enthält Fehler.; 9800 Dialog abgebrochen; " +
      "9955 Auftrag nicht ausgeführt - Die Gerätebezeichnung ist unbekannt.";
    assert.equal(wegenGeraetebezeichnung(echt), true);
    assert.equal(wegenGeraetebezeichnung("9910 PIN gesperrt"), false);
  });

  test("aus dem Zahlencode wird eine Handlungsanweisung", () => {
    const HOLEN = readFileSync(
      new URL("../lib/fints/holen.ts", import.meta.url), "utf8");
    const INTERAKTIV = readFileSync(
      new URL("../lib/fints/interaktiv.ts", import.meta.url), "utf8");
    /*
      Ohne diesen Zusatz steht Stephan vor drei Zahlencodes und weiss
      nicht, dass ihm ein Feld fehlt. Genau das ist am 27.11. passiert.
    */
    for (const [name, quelle] of
         [["holen.ts", HOLEN], ["interaktiv.ts", INTERAKTIV]] as const) {
      assert.match(quelle, /wegenGeraetebezeichnung\(roh\)/,
        `${name}: Hinweis fehlt`);
      assert.match(quelle, /hinweisGeraet\(\s*wahl\.verfahren,\s*medium,/,
        `${name}: Hinweis nennt Verfahren und Name nicht`);
    }
  });
});

describe("Der Hinweis sagt, was versucht wurde", () => {
  /*
    Am 27.11.2026 kam dieselbe Meldung zweimal: einmal ohne
    Gerätebezeichnung, einmal mit "16e". Aus der Meldung liess sich
    nicht erkennen, ob der Name falsch geschrieben war oder ob das
    falsche Verfahren gewaehlt wurde -- bei chipTAN ist die
    Gerätebezeichnung die Karte, nicht das Handy. Jede Fehlermeldung,
    die ihr eigenes Tun verschweigt, kostet eine Runde Raten.
  */

  test("das gewaehlte Verfahren steht mit Nummer und Namen drin", () => {
    const t = hinweisGeraet(
      { id: 921, name: "pushTAN 2.0", medien: [] }, "16e",
    );
    assert.match(t, /921/);
    assert.match(t, /pushTAN 2\.0/);
    assert.match(t, /16e/);
  });

  test("wurde kein Name geschickt, steht genau das da", () => {
    const t = hinweisGeraet({ id: 911, name: "chipTAN", medien: [] }, null);
    assert.match(t, /keine Bezeichnung/i);
    assert.doesNotMatch(t, /„“/);
  });

  test("nennt die Bank Medien, werden sie aufgezaehlt", () => {
    const t = hinweisGeraet(
      { id: 921, name: "pushTAN", medien: [] }, "16e",
      ["iPhone Stephan", "Tablet"],
    );
    assert.match(t, /iPhone Stephan/);
  });

  test("unser eigener Name wird nicht als Angabe der Bank ausgegeben", () => {
    /*
      Am 27.11.2026 stand in der Meldung "Die Bank nennt dazu: 16e" --
      obwohl die Bank gar nichts genannt hatte. setzeTanMedium traegt
      den Namen in activeTanMedia ein, damit die Bibliothek ihn
      durchlaesst, und der Hinweis las danach genau diese Liste aus.
      Eine Fehlermeldung, die den eigenen Eingabewert als Auskunft der
      Bank ausgibt, ist schlimmer als gar keine: Sie bestaetigt einen
      Wert, den niemand bestaetigt hat.
    */
    const t = hinweisGeraet(
      /* so sieht das Verfahren NACH setzeTanMedium aus: */
      { id: 923, name: "pushTAN 2.0", medien: ["16e"] },
      "16e",
      /* die Bank selbst hat nichts genannt: */
      [],
    );
    assert.doesNotMatch(t, /Bank nennt dazu/);
    assert.match(t, /keine Bezeichnung genannt/);
  });

  test("ohne Verfahren bleibt der Hinweis verstaendlich", () => {
    const t = hinweisGeraet(null, null);
    assert.match(t, /kein Verfahren/i);
  });
});
