import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Tests der Ablage-Route.
 *
 * Hier ist ein Sprachmodell im Spiel, und ein Sprachmodell erfindet
 * Zahlen, wenn es sie nicht findet. Diese Route schreibt in die
 * Buchhaltung. Was dabei NICHT passieren darf, steht hier.
 *
 * Die Route selbst laesst sich ohne Datenbank nicht ausfuehren; diese
 * Tests lesen ihren Quelltext. Was der Quelltext nicht hergibt -- ob
 * jede Abfrage ueberhaupt plant --, prueft pruefe-sql.mts gegen eine
 * echte Postgres.
 */
const route = readFileSync(
  new URL("../app/api/ablage/route.ts", import.meta.url),
  "utf8",
);

describe("Zwei Schritte", () => {
  test("ohne uebernehmen=1 wird nichts gespeichert", () => {
    assert.match(route, /if \(!uebernehmen\) return NextResponse\.json\(\{ gespeichert: false/);
  });

  test("der Vorschlag kommt VOR dem Schreiben zurück", () => {
    const i = route.indexOf("if (!uebernehmen) return");
    const j = route.indexOf("INSERT INTO beleg");
    assert.ok(i > 0 && j > i, "der Vorschlag kommt nach dem INSERT");
  });

  test("Übernehmen ist der Vorgabe NICHT eingebaut", () => {
    // Ein Vorgabewert, der speichert, waere genau der Fall, den die
    // zwei Schritte verhindern sollen.
    assert.match(route, /String\(form\.get\("uebernehmen"\) \?\? ""\) === "1"/);
  });
});

describe("Berechtigung", () => {
  test("Mieter kommen nicht herein", () => {
    assert.match(route, /sitzung\.rolle === "mieter"/);
  });

  test("Leserecht darf ansehen, aber nicht ablegen", () => {
    assert.match(route, /uebernehmen && sitzung\.rolle === "lesen"/);
  });

  test("auch GET ist für Mieter zu", () => {
    const teil = route.slice(route.indexOf("export async function GET"));
    assert.match(teil, /sitzung\.rolle === "mieter"/);
  });
});

describe("Was das Regelwerk gelesen hat, gilt", () => {
  test("Betrag und Datum gehen durch fuehreZusammen, nicht direkt aus der KI", () => {
    assert.match(
      route,
      /fuehreZusammen\(\s*\{ belegdatum: regelwerk\.belegdatum, betrag_brutto: regelwerk\.betrag_brutto \}/,
    );
  });

  test("der Aussteller aus dem Dokument hat Vorrang vor dem Gesagten", () => {
    assert.match(route, /regelwerk\.aussteller \?\? vorschlag\.aussteller/);
  });

  test("die Belegnummer kommt nur aus dem Dokument", () => {
    // Eine von der KI gelesene Belegnummer waere eine erfundene
    // Nummer in den Buechern.
    assert.match(route, /belegnummer: regelwerk\.belegnummer \?\? null/);
    assert.ok(
      !/vorschlag\.belegnummer/.test(route),
      "die Belegnummer kommt aus der Auswertung",
    );
  });

  test("eine erfundene Kostenart fällt weg statt als Freitext zu landen", () => {
    assert.match(route, /pruefeKostenart\(vorschlag\.kostenart\)\?\.schluessel \?\? null/);
  });

  test("ein Widerspruch wandert in die Zeile", () => {
    assert.match(route, /vorschlag\.abweichung,/);
  });
});

describe("Eigenbeleg", () => {
  test("ohne Dokument gibt es nur den Eigenbeleg, nicht die Wahl der KI", () => {
    assert.match(route, /const art = !hatDatei\s*\n\s*\? "eigenbeleg"/);
  });

  test("er wird nur angelegt, wenn er vollständig ist", () => {
    assert.match(route, /if \(art === "eigenbeleg"\) \{[\s\S]*?fehlendeAngaben\(eigen\)/);
  });

  test("auch mit Dokument wird die Vollständigkeit geprüft", () => {
    // Die Datenbank fordert das ohnehin (db/036). Ohne die Pruefung
    // hier waere die Antwort ein Serverfehler statt einer Nachfrage.
    assert.match(route, /hatDatei\s*\n\s*\? "Das ist ein Eigenbeleg, und dem fehlen/);
  });

  test("was fehlt, wird einzeln benannt", () => {
    assert.match(route, /offen: fehlt/);
    assert.match(route, /\$\{fehlt\.join\(", "\)\}/);
  });

  test("der Ersteller kommt aus der Sitzung, nicht aus dem Formular", () => {
    assert.match(route, /erstellt_von: sitzung\.name/);
    assert.ok(
      !/form\.get\("erstellt_von"\)/.test(route),
      "der Ersteller ist aus dem Formular setzbar",
    );
  });
});

describe("Sorgfalt an den Rändern", () => {
  test("dieselbe Datei wird nicht zweimal abgelegt", () => {
    assert.match(route, /ablageMarke\(bytes\)/);
    assert.match(route, /status: 409/);
  });

  test("die Dublettenprüfung läuft VOR der Auswertung", () => {
    // Sonst wird ein Sprachmodell fuer eine Datei gerufen, die schon
    // liegt.
    const i = route.indexOf("ablageMarke(bytes)");
    const j = route.indexOf("await werteDiktatAus");
    assert.ok(i > 0 && j > i, "die Auswertung läuft vor der Dublettenprüfung");
  });

  test("ohne Datei und ohne Gesagtes wird abgewiesen", () => {
    assert.match(route, /!hatDatei && diktat\.trim\(\)\.length === 0/);
  });

  test("eine zu große Datei wird abgewiesen, nicht abgeschnitten", () => {
    assert.match(route, /datei\.size > MAX_BYTES/);
    assert.match(route, /status: 413/);
  });

  test("der Dateiname wird auf den reinen Namen gekürzt", () => {
    // Ein Name wie ../../etc/x waere ein Pfad.
    assert.match(route, /n\.split\(\/\[\\\\\/\]\/\)\.pop\(\)/);
  });

  test("das Diktat wird begrenzt", () => {
    assert.match(route, /\.slice\(0, 4000\)/);
  });

  test("fehlt der Schlüssel, wird das gesagt und nicht leer gespeichert", () => {
    assert.match(route, /ki\.code === "kein_schluessel"/);
    assert.match(route, /status: 503/);
  });

  test("in der Notiz steht, woher die Werte kommen", () => {
    assert.match(route, /vorschlag\.quelle\.join\("; "\)/);
    assert.match(route, /Gesagt: /);
  });

  test("das benutzte Modell wird vermerkt", () => {
    assert.match(route, /Ausgewertet mit \$\{ki\.modell\}/);
  });
});

describe("Die Seite und die Spracherkennung", () => {
  const seite = readFileSync(
    new URL("../app/ablage/page.tsx", import.meta.url),
    "utf8",
  );
  const stueck = readFileSync(
    new URL("../components/Ablage.tsx", import.meta.url),
    "utf8",
  );
  const navi = readFileSync(
    new URL("../components/Navi.tsx", import.meta.url),
    "utf8",
  );

  test("die Seite ist für Mieter zu", () => {
    assert.match(seite, /sitzung\.rolle === "mieter"\) redirect\("\/mieter"\)/);
  });

  test("ohne Anmeldung geht es zur Anmeldung", () => {
    assert.match(seite, /if \(!sitzung\) redirect\("\/anmelden"\)/);
  });

  test("die Trennung macht der Mandant, nicht ein Filter auf objekt_id", () => {
    // Im privaten Mandanten gehoeren alle Belege hierher; die RLS
    // laesst den einen nie die des anderen sehen. Das ist und bleibt
    // die Trennung -- eine Spalte ist sie nicht.
    assert.match(seite, /Die Trennung macht der MANDANT/);
  });

  test("die Objektwahl versteckt keine unsortierten Belege", () => {
    /*
      GEAENDERT AM 08.11.2026

      Vorher stand hier, die Seite duerfe ueberhaupt nicht auf objekt_id
      filtern. Seit es den Objektumschalter im Kopf gibt
      (lib/objektsicht.ts), ist das zu streng: Ein Ausschnitt, den
      jemand ausdruecklich waehlt, ist etwas anderes als eine Trennung,
      die ihm aufgezwungen wird.

      Der Kern der alten Pruefung gilt aber weiter und steht jetzt hier:
      Ein Beleg OHNE Objekt heisst nicht "gehoert einem anderen Haus",
      sondern "noch nicht eingeordnet". Faellt er beim Umschalten weg,
      ist die Ablage genau fuer die Belege blind, die noch Arbeit
      machen -- und niemand merkt es, weil die Seite ja voll aussieht.
    */
    assert.match(
      seite,
      /\$1::uuid IS NULL OR objekt_id = \$1 OR objekt_id IS NULL/,
      "Belege ohne Objekt muessen in jeder Objektsicht stehen bleiben.",
    );
  });

  test("die Seite sagt, wie viele Belege nur auf dem eigenen Wort stehen", () => {
    // Ein Eigenbeleg bezeugt nur der, der ihn geschrieben hat. Wie
    // viel davon in einem Jahr steckt, soll man sehen, ohne zu suchen.
    assert.match(seite, /art = 'eigenbeleg'/);
    assert.match(seite, /auf dem\s*\n?\s*eigenen Wort stehen/);
  });

  test("die Ablage steht in der Navigation", () => {
    assert.match(navi, /href: "\/ablage", text: "Ablage"/);
  });

  test("kein Ton verlässt das Gerät -- nur der erkannte Text", () => {
    // SpeechRecognition erkennt im Browser. Hochgeladen wird das
    // Textfeld, kein Mitschnitt.
    assert.match(stueck, /webkitSpeechRecognition/);
    assert.ok(
      !/MediaRecorder|getUserMedia|audio\/|Blob\(/.test(stueck),
      "das Stück nimmt Ton auf",
    );
    assert.match(stueck, /koerper\.set\("diktat", diktat\)/);
  });

  test("ohne Spracherkennung bleibt das Feld tippbar", () => {
    assert.match(stueck, /keine Spracherkennung/);
    assert.match(stueck, /onChange=\{\(e\) => setDiktat\(e\.target\.value\)\}/);
  });

  test("nur endgültige Erkennungsstücke werden angehängt", () => {
    // Zwischenergebnisse wuerden den Text waehrend des Sprechens
    // umschreiben.
    assert.match(stueck, /interimResults = false/);
    assert.match(stueck, /if \(t\.isFinal\)/);
  });

  test("Deutsch ist die Sprache der Erkennung", () => {
    assert.match(stueck, /lang = "de-DE"/);
  });

  test('"So ablegen" erscheint erst, wenn ein Vorschlag da ist', () => {
    assert.match(stueck, /\{v && !antwort\?\.gespeichert && \(/);
  });

  test("woher die Werte kommen, steht beim Vorschlag", () => {
    assert.match(stueck, /v\.quelle\.join\(" · "\)/);
  });

  test("ein Widerspruch wird dem Menschen gezeigt, nicht nur gespeichert", () => {
    assert.match(stueck, /Regelwerk und Auswertung sind sich nicht einig/);
  });

  test("eine Datei ohne Textebene wird als solche benannt", () => {
    // Dann stammen Betrag und Datum allein aus dem Gesagten -- das
    // muss dastehen.
    assert.match(stueck, /keine Textebene/);
    assert.match(stueck, /allein aus dem Gesagten/);
  });

  test("die Aufnahme hört auf, wenn die Seite verlassen wird", () => {
    assert.match(stueck, /return \(\) => hoerer\.current\?\.stop\(\)/);
  });
});

describe("Den privaten Mandanten anlegen", () => {
  const stueck = readFileSync(
    new URL("../components/MandantAnlegen.tsx", import.meta.url),
    "utf8",
  );
  const seite = readFileSync(
    new URL("../app/ablage/page.tsx", import.meta.url),
    "utf8",
  );

  test("das Angebot steht nur da, solange es einen Zugang gibt", () => {
    // Sobald es zwei sind, erscheint oben der Umschalter -- dann waere
    // das Feld eine zweite Antwort auf eine beantwortete Frage.
    assert.match(stueck, /if \(anzahlZugaenge > 1\) return null/);
    assert.match(seite, /anzahlZugaenge=\{zugaenge\.length\}/);
  });

  test("Name und Kürzel werden nicht vorgegeben", () => {
    // Das Kuerzel steht spaeter in Adressen und laesst sich nicht
    // aendern. Etwas, das bleibt, waehlt der, dem es gehoert.
    assert.match(stueck, /value=\{name\}/);
    assert.match(stueck, /value=\{kuerzel\}/);
    assert.ok(
      !/useState\("Privat/.test(stueck),
      "der Name ist vorbelegt",
    );
    assert.ok(
      !/useState\("privat/.test(stueck),
      "das Kürzel ist vorbelegt",
    );
  });

  test("es steht dabei, dass das Kürzel bleibt", () => {
    assert.match(stueck, /lässt sich nicht mehr ändern/);
  });

  test("es sagt, warum das überhaupt nötig ist", () => {
    // Ohne den Satz ist "einen Mandanten anlegen" eine Zumutung.
    assert.match(stueck, /auch für Mitgesellschafter sichtbar/);
  });

  test("der Knopf bleibt tot, solange die Felder zu kurz sind", () => {
    assert.match(
      stueck,
      /disabled=\{laeuft \|\| name\.trim\(\)\.length < 2 \|\| kuerzel\.trim\(\)\.length < 2\}/,
    );
  });

  test("nach dem Anlegen wird alles neu geladen", () => {
    // Die Route stellt das Sitzungscookie auf den neuen Mandanten um;
    // jede Seite im Speicher zeigt sonst Daten des alten.
    assert.match(stueck, /window\.location\.assign\("\/ablage"\)/);
  });
});
