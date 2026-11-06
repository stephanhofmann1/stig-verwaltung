import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";

import { zeitraum, alsBuchungen, bankMeldung, wegenZugangsdaten,
         sollStilllegen, type FintsUmsatz } from "../lib/fints/abruf";
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
