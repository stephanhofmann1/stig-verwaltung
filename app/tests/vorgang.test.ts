import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BEGRUENDUNG_MINDESTLAENGE,
  OHNE_ANTWORT_MINDESTLAENGE,
  STATUS_WEGE,
  erlaubteStatus,
  hebtSperreAuf,
  istKategorie,
  istStatus,
  ohneAntwortGeschlossen,
  pruefeAenderung,
  statusKnopf,
  teileAkte,
  zaehltAlsOffen,
  type Ist,
} from "../lib/vorgangstatus";
import { darf } from "../proxy";

/**
 * Tests der Entscheidungen an einem Vorgang.
 *
 * Der Fehler, gegen den diese Datei schuetzt, ist nicht "der Status ist
 * falsch" -- das faellt auf. Es sind zwei stille:
 *
 *   1. Eine Aenderung geschieht und steht nicht im Protokoll. Dann ist
 *      spaeter nicht zu klaeren, wer die Sperre aufgehoben hat, an der die
 *      Automatik anhaelt -- und die Sperre ist der Grund, warum bei
 *      Mahnungen und Behoerdenpost kein Entwurf von allein entsteht.
 *   2. Eine Nichtaenderung erzeugt einen Eintrag. Nach einem Jahr ist das
 *      Protokoll dann eine Liste von Klicks und keine Akte mehr.
 *
 * Alles ohne Datenbank: geprueft wird nur, was rein rechnet.
 */

const WER = "pruefer";

function ist(teil: Partial<Ist> = {}): Ist {
  return {
    status: "offen",
    kategorie: "sonstige",
    heikel: false,
    ohne_antwort_grund: null,
    ...teil,
  };
}

/** Kurzform: das Ergebnis muss erlaubt sein, sonst sagt die Meldung warum. */
function erlaubt(e: ReturnType<typeof pruefeAenderung>) {
  assert.equal(e.ok, true, e.ok ? "" : e.fehler);
  return e as Extract<typeof e, { ok: true }>;
}

describe("Statuswechsel", () => {
  test("offen laesst sich auf wartet und auf erledigt setzen", () => {
    for (const ziel of ["wartet", "erledigt"] as const) {
      const e = erlaubt(pruefeAenderung(ist(), { status: ziel }, WER));
      assert.equal(e.soll.status, ziel);
    }
  });

  test("wartet laesst sich wieder oeffnen und erledigen", () => {
    for (const ziel of ["offen", "erledigt"] as const) {
      const e = erlaubt(
        pruefeAenderung(ist({ status: "wartet" }), { status: ziel }, WER),
      );
      assert.equal(e.soll.status, ziel);
    }
  });

  test("erledigt laesst sich wieder oeffnen -- die Zahl in der Uebersicht ist senkbar und umkehrbar", () => {
    const e = erlaubt(
      pruefeAenderung(ist({ status: "erledigt" }), { status: "offen" }, WER),
    );
    assert.equal(e.soll.status, "offen");
  });

  test("erledigt geht NICHT direkt auf wartet", () => {
    // "wartet" heisst, dass draussen jemand antworten soll. Bei einem
    // abgeschlossenen Vorgang wartet niemand -- der Status wuerde nichts
    // mehr aussagen.
    const e = pruefeAenderung(
      ist({ status: "erledigt" }),
      { status: "wartet" },
      WER,
    );
    assert.equal(e.ok, false);
    assert.equal(e.ok === false && e.code, 409);
  });

  test("ein unbekannter Status wird abgewiesen, nicht geschrieben", () => {
    for (const quatsch of ["geschlossen", "", "OFFEN", 1, null, {}]) {
      const e = pruefeAenderung(ist(), { status: quatsch }, WER);
      // null bedeutet "nicht mitgeschickt" und faellt deshalb auf
      // "nichts zu aendern" -- beides ist nicht ok, und darauf kommt es an.
      assert.equal(e.ok, false, `"${String(quatsch)}" darf nicht durchgehen`);
    }
  });

  test("jeder Status hat einen Weg zurueck -- keine Einbahnstrasse", () => {
    // Ein Vorgang, aus dem es keinen Ausweg gibt, waere derselbe Mangel
    // wie vorher, nur an anderer Stelle.
    for (const [von, ziele] of Object.entries(STATUS_WEGE)) {
      assert.ok(ziele.length > 0, `${von} ist eine Falle`);
    }
  });

  test("erlaubteStatus nennt den heutigen Status nicht", () => {
    for (const s of ["offen", "wartet", "erledigt"] as const) {
      assert.ok(!erlaubteStatus(s).includes(s), `${s} zeigt auf sich selbst`);
    }
  });

  test("der Knopf von erledigt heisst Wieder oeffnen, nicht Offen", () => {
    assert.equal(statusKnopf("erledigt", "offen"), "Wieder öffnen");
    assert.equal(statusKnopf("offen", "erledigt"), "Erledigt");
    assert.equal(statusKnopf("offen", "wartet"), "Wartet");
  });
});

describe("Kategorie berichtigen", () => {
  test("eine falsche Einordnung laesst sich korrigieren", () => {
    // Der Anlass: Am 03.11.2026 landete eine Mail des Messdienstleisters
    // als Behoerdenpost in der Akte, weil sie "Geben Sie mir dazu noch
    // Bescheid" enthielt. Das Muster ist berichtigt, die gespeicherte
    // Einordnung wird davon nicht neu gerechnet.
    const e = erlaubt(
      pruefeAenderung(
        ist({ kategorie: "behoerde", heikel: true }),
        { kategorie: "handwerker" },
        WER,
      ),
    );
    assert.equal(e.soll.kategorie, "handwerker");
  });

  test("das Berichtigen der Kategorie hebt die Sperre NICHT mit auf", () => {
    // Ein stiller Nebeneffekt waere hier das Gefaehrlichste: Wer eine
    // Kategorie korrigiert, laesst damit nicht die Automatik an eine
    // Mahnung heran.
    const e = erlaubt(
      pruefeAenderung(
        ist({ kategorie: "behoerde", heikel: true }),
        { kategorie: "handwerker" },
        WER,
      ),
    );
    assert.equal(e.soll.heikel, true);
    assert.deepEqual(
      e.eintraege.map((x) => x.ereignis),
      ["vorgang_kategorie_geaendert"],
    );
  });

  test("eine unbekannte Kategorie wird abgewiesen", () => {
    for (const quatsch of ["messdienst", "Behoerde", 7, true]) {
      const e = pruefeAenderung(ist(), { kategorie: quatsch }, WER);
      assert.equal(e.ok, false, `"${String(quatsch)}" darf nicht durchgehen`);
    }
  });

  test("die Wachen kennen genau die Werte aus lib/typen.ts", () => {
    assert.equal(istStatus("erledigt"), true);
    assert.equal(istStatus("fertig"), false);
    assert.equal(istKategorie("behoerde"), true);
    assert.equal(istKategorie("behörde"), false);
  });
});

describe("heikel ist eine Sicherheitsentscheidung", () => {
  test("setzen geht ohne Grund -- Vorsicht erhoehen darf jeder sofort", () => {
    const e = erlaubt(pruefeAenderung(ist(), { heikel: true }, WER));
    assert.equal(e.soll.heikel, true);
    assert.equal(e.eintraege[0].ereignis, "vorgang_heikel_geaendert");
  });

  test("aufheben ohne Begruendung wird abgewiesen", () => {
    const e = pruefeAenderung(ist({ heikel: true }), { heikel: false }, WER);
    assert.equal(e.ok, false);
    assert.match(e.ok === false ? e.fehler : "", /Begründung/);
  });

  test("aufheben mit zu kurzer Begruendung wird abgewiesen", () => {
    const kurz = "x".repeat(BEGRUENDUNG_MINDESTLAENGE - 1);
    const e = pruefeAenderung(
      ist({ heikel: true }),
      { heikel: false, begruendung: kurz },
      WER,
    );
    assert.equal(e.ok, false);
  });

  test("Leerzeichen zaehlen nicht als Begruendung", () => {
    // Sonst genuegt die Leertaste, und die Pflicht waere eine Zierde.
    const e = pruefeAenderung(
      ist({ heikel: true }),
      { heikel: false, begruendung: " ".repeat(40) },
      WER,
    );
    assert.equal(e.ok, false);
  });

  test("aufheben mit Begruendung geht und die Begruendung steht im Eintrag", () => {
    const grund = "Messdienstleister, nur Terminabstimmung";
    const e = erlaubt(
      pruefeAenderung(
        ist({ heikel: true, kategorie: "behoerde" }),
        { heikel: false, begruendung: grund },
        WER,
      ),
    );
    assert.equal(e.soll.heikel, false);
    const eintrag = e.eintraege.find(
      (x) => x.ereignis === "vorgang_heikel_geaendert",
    );
    assert.ok(eintrag, "die Aufhebung muss protokolliert werden");
    assert.equal(eintrag.details.begruendung, grund);
    assert.equal(eintrag.details.wer, WER);
  });

  test("der Eintrag haelt fest, ob die Kategorie als heikel gilt", () => {
    // Steht die Aufhebung spaeter zur Diskussion, ist das die erste Frage.
    const e = erlaubt(
      pruefeAenderung(
        ist({ heikel: true, kategorie: "mahnwesen" }),
        { heikel: false, begruendung: "Rückstand ist beglichen, Zahlung zugeordnet" },
        WER,
      ),
    );
    const d = e.eintraege[0].details;
    assert.equal(d.kategorie_gilt_als_heikel, true);
  });

  test("der Schluessel begruendung fehlt nie, auch beim Setzen nicht", () => {
    // Ein Protokoll, in dem ein Feld manchmal da ist und manchmal nicht,
    // laesst sich nicht durchsuchen.
    const e = erlaubt(pruefeAenderung(ist(), { heikel: true }, WER));
    assert.ok("begruendung" in e.eintraege[0].details);
    assert.equal(e.eintraege[0].details.begruendung, null);
  });

  test("heikel muss ein Wahrheitswert sein", () => {
    for (const quatsch of ["true", "ja", 1, 0]) {
      const e = pruefeAenderung(ist({ heikel: true }), { heikel: quatsch }, WER);
      assert.equal(e.ok, false, `"${String(quatsch)}" darf nicht durchgehen`);
    }
  });

  test("hebtSperreAuf trifft genau den einen Fall", () => {
    assert.equal(hebtSperreAuf(ist({ heikel: true }), { heikel: false }), true);
    assert.equal(hebtSperreAuf(ist({ heikel: false }), { heikel: false }), false);
    assert.equal(hebtSperreAuf(ist({ heikel: true }), { heikel: true }), false);
    assert.equal(hebtSperreAuf(ist({ heikel: true }), {}), false);
  });
});

describe("Was protokolliert wird", () => {
  test("jede tatsaechliche Aenderung erzeugt genau einen Eintrag mit Vorher und Nachher", () => {
    const e = erlaubt(
      pruefeAenderung(
        ist({ status: "offen", kategorie: "behoerde", heikel: false }),
        { status: "erledigt", kategorie: "rechnung", heikel: true },
        WER,
      ),
    );
    assert.equal(e.eintraege.length, 3);
    for (const x of e.eintraege) {
      assert.ok("vorher" in x.details, `${x.ereignis} ohne Vorher`);
      assert.ok("nachher" in x.details, `${x.ereignis} ohne Nachher`);
      assert.equal(x.details.wer, WER);
      assert.notEqual(
        x.details.vorher,
        x.details.nachher,
        `${x.ereignis} protokolliert eine Nichtaenderung`,
      );
    }
  });

  test("ein mitgeschickter Wert, der schon gilt, erzeugt keinen Eintrag", () => {
    const e = pruefeAenderung(
      ist({ status: "wartet", kategorie: "mieter", heikel: true }),
      { status: "wartet", kategorie: "mieter", heikel: true },
      WER,
    );
    assert.equal(e.ok, false);
    assert.match(e.ok === false ? e.fehler : "", /Nichts zu ändern/);
  });

  test("ein leerer Wunsch aendert nichts", () => {
    assert.equal(pruefeAenderung(ist(), {}, WER).ok, false);
  });

  test("nicht genannte Felder bleiben, wie sie sind", () => {
    const vorher = ist({ status: "offen", kategorie: "behoerde", heikel: true });
    const e = erlaubt(pruefeAenderung(vorher, { status: "wartet" }, WER));
    assert.equal(e.soll.kategorie, "behoerde");
    assert.equal(e.soll.heikel, true);
    assert.equal(e.eintraege.length, 1);
  });

  test("eine abgewiesene Aenderung gibt keine Eintraege heraus", () => {
    // Sonst schreibt der Aufrufer ein Protokoll fuer etwas, das nicht
    // geschehen ist.
    const e = pruefeAenderung(
      ist({ heikel: true }),
      { status: "erledigt", heikel: false },
      WER,
    );
    assert.equal(e.ok, false);
    assert.ok(!("eintraege" in e));
  });

  test("die Ereignisnamen sind die drei erwarteten", () => {
    // Die Vorgangsseite liest genau diese Namen aus protokoll. Ein
    // umbenanntes Ereignis verschwindet dort stillschweigend.
    const e = erlaubt(
      pruefeAenderung(
        ist(),
        { status: "wartet", kategorie: "rechnung", heikel: true },
        WER,
      ),
    );
    assert.deepEqual(new Set(e.eintraege.map((x) => x.ereignis)), new Set([
      "vorgang_status_geaendert",
      "vorgang_kategorie_geaendert",
      "vorgang_heikel_geaendert",
    ]));
  });
});

describe("Die Entscheidungslogik bleibt ohne Datenbank pruefbar", () => {
  const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

  test("vorgangstatus.ts kennt weder Datenbank noch next", () => {
    const s = ohneKommentare(quelle("../lib/vorgangstatus.ts"));
    assert.doesNotMatch(s, /from "\.\/db"/);
    assert.doesNotMatch(s, /from "next/);
    assert.doesNotMatch(s, /\bDate\b/, "keine Uhrzeit — sonst ist der Test vom Tag abhängig");
  });
});

/**
 * Quelltext ohne Kommentare.
 *
 * Die Pruefungen unten verlangen, dass bestimmte Dinge im Code NICHT
 * vorkommen -- mitMandant, pool. Beides steht in den Kommentaren der Route,
 * und zwar mit Absicht: Dort ist erklaert, warum die Nachbarroute
 * /entwurf es braucht und diese nicht. Ein Test, der die Erklaerung
 * verbietet, erzwingt kommentarlosen Code.
 */
function ohneKommentare(quelle: string): string {
  return quelle
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("Die neue Schnittstelle ist abgesichert", () => {
  const route = ohneKommentare(
    readFileSync(
      new URL("../app/api/vorgang/[id]/route.ts", import.meta.url),
      "utf8",
    ),
  );

  test("der Mandant kommt nie aus dem Koerper", () => {
    // Das waere der Weg, die Mandantentrennung von aussen zu behaupten.
    assert.doesNotMatch(route, /mitMandant/);
    assert.doesNotMatch(route, /mandant_fuer_vorgang/);
    assert.doesNotMatch(route, /mandantFuerAdresse/);
  });

  test("sie laeuft ueber lib/db und damit unter der Policy", () => {
    // pool.query() ginge an app.mandant vorbei -- genau dafuer gibt es
    // tx() aus lib/db.ts.
    assert.match(route, /from "@\/lib\/db"/);
    assert.doesNotMatch(route, /\bpool\b/);
  });

  test("sie prueft die Rolle selbst und verlaesst sich nicht auf den Proxy", () => {
    assert.match(route, /angemeldeteSitzung/);
    assert.match(route, /rolle !== "verwalter"/);
  });

  test("sie sperrt die Zeile, bevor sie entscheidet", () => {
    assert.match(route, /FOR UPDATE/);
  });

  test("sie schreibt jede Aenderung ins Protokoll", () => {
    assert.match(route, /INSERT INTO protokoll \(vorgang_id, nachricht_id, ereignis, details\)/);
  });

  test("sie entscheidet nicht selbst, sondern fragt die reine Funktion", () => {
    assert.match(route, /pruefeAenderung/);
    // Keine zweite Kopie der Statusregeln in der Route.
    assert.doesNotMatch(route, /erledigt'\s*,\s*'wartet/);
  });

  /**
   * GEAENDERT AM 03.11.2026 -- bitte gegenlesen.
   *
   * Dieser Test lautete vorher "es gibt nur PATCH -- kein GET, das die
   * Akte offenlegt" und verbot alle vier uebrigen Methoden. Seit dem
   * 03.11.2026 hat die Route ein GET, und zwar fuer die Schalter in der
   * Akte (components/VorgangSchalter.tsx): Sie brauchen die Herkunft der
   * Einordnung, den Grund eines ohne Antwort geschlossenen Vorgangs und
   * die Frage, ob ein Entwurf nachgezogen werden kann. Die Seite, die
   * den Schalter rendert, gehoert nicht zu dieser Aenderung und konnte
   * die Werte nicht als Eigenschaft durchgeben.
   *
   * Das Anliegen des alten Tests bleibt und wird hier scharf
   * aufgeschrieben, statt weggenommen: Das GET gibt KEINE Korrespondenz
   * heraus. Kein Betreff, kein Absender, kein Name, kein Mailtext --
   * nur den Steuerungsstand des Vorgangs, den die Akte ohnehin anzeigt.
   * Und schreibend bleibt es bei PATCH allein.
   */
  test("schreibend gibt es nur PATCH", () => {
    assert.match(route, /export async function PATCH/);
    for (const m of ["POST", "PUT", "DELETE"]) {
      assert.doesNotMatch(
        route,
        new RegExp(`export async function ${m}\\b`),
        `${m} ist nicht vorgesehen -- geaendert wird ueber PATCH`,
      );
    }
  });

  test("das GET gibt keine Korrespondenz heraus", () => {
    const ab = route.indexOf("export async function GET");
    if (ab < 0) return; // kein GET -- dann ist nichts zu pruefen
    const block = route.slice(ab);
    for (const spalte of [
      "koerper_text",
      "von_email",
      "von_name",
      "anzeigename",
      "an_emails",
      "v.betreff",
    ]) {
      assert.ok(
        !block.includes(spalte),
        `Das GET liest ${spalte}. Damit legte es die Akte offen -- genau ` +
          "das sollte diese Route nie tun. Der Steuerungsstand darf " +
          "heraus, der Schriftverkehr nicht.",
      );
    }
    assert.match(
      block,
      /angemeldeteSitzung/,
      "Auch das GET prueft die Anmeldung selbst und verlaesst sich nicht " +
        "auf den Proxy.",
    );
  });

  test("der Aufgabenschluessel oeffnet sie nicht", () => {
    // Die Ausnahme in proxy.ts gilt nur fuer .../entwurf. Der Agent darf
    // Entwuerfe ablegen, aber keinen Vorgang schliessen und keine Sperre
    // aufheben.
    const p = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
    const muster = /\/\^\\\/api\\\/vorgang\\\/\[\^\/\]\+\\\/entwurf\$\//;
    assert.match(p, muster, "die Ausnahme muss auf /entwurf enden");
  });
});

describe("Die Rollenweiche deckt die neue Schnittstelle", () => {
  const pfad = "/api/vorgang/aaaaaaaa-0000-0000-0000-000000000001";

  test("der Verwalter darf schreiben", () => {
    assert.equal(darf(pfad, "verwalter", "PATCH"), true);
  });

  test("ein Lesezugang darf nicht schreiben", () => {
    assert.equal(darf(pfad, "lesen", "PATCH"), false);
    assert.equal(darf(pfad, "lesen", "GET"), true);
  });

  test("ein Mieter kommt gar nicht heran", () => {
    for (const m of ["GET", "PATCH"]) {
      assert.equal(darf(pfad, "mieter", m), false, `Mieter darf nicht ${m}`);
    }
  });
});

/**
 * "Hier nicht antworten" -- und der Vorgang zaehlt nicht mehr als offen.
 *
 * Der Fehler, gegen den dieser Block schuetzt, ist eine Arbeitsliste, die
 * unbrauchbar wird. Bis zum 03.11.2026 gab es nur beantworten oder
 * liegenlassen. Liegenlassen sah aus wie Arbeit, die noch wartet: Die
 * Kennzahl "wartet auf Freigabe" (lib/kennzahlen.ts, ladeFreigabestand)
 * zaehlte jeden Vorgang mit, der auf "offen" stand und keine Antwort
 * hatte. Eine Mail, auf die bewusst nicht geantwortet wird -- ein
 * Rundschreiben, eine Kenntnisnahme, eine Fehlzustellung -- blieb damit
 * fuer immer in der Liste. Nach einem halben Jahr ist die Haelfte der
 * Liste nicht mehr gemeint, und dann wird keine Zeile mehr gelesen,
 * auch nicht die wichtige.
 *
 * Der zweite Fehler ist der stille: Ein Vorgang wird geschlossen und
 * niemand kann in einem Jahr sagen, warum nicht geantwortet wurde.
 * Deshalb ist der Grund Pflicht.
 */
describe("ohne Antwort schliessen", () => {
  test("ein offener Vorgang wird mit Grund auf erledigt gesetzt", () => {
    const e = erlaubt(
      pruefeAenderung(
        ist(),
        { ohne_antwort: "Nur zur Kenntnis, Rundschreiben des Versorgers" },
        WER,
      ),
    );
    assert.equal(e.soll.status, "erledigt");
    assert.equal(
      e.soll.ohne_antwort_grund,
      "Nur zur Kenntnis, Rundschreiben des Versorgers",
    );
  });

  test("der so geschlossene Vorgang zaehlt nicht mehr als offen", () => {
    // Das ist die eigentliche Zusage. Sie haelt ohne Zutun, weil "ohne
    // Antwort schliessen" den Status auf "erledigt" setzt und keinen
    // vierten Status einfuehrt -- jede bestehende Bedingung
    // `status = 'offen'` greift damit weiterhin richtig.
    const e = erlaubt(
      pruefeAenderung(ist(), { ohne_antwort: "Fehlzustellung, falscher Empfaenger" }, WER),
    );
    assert.equal(zaehltAlsOffen(ist()), true, "vorher zaehlte er mit");
    assert.equal(
      zaehltAlsOffen(e.soll),
      false,
      "Nach dem Schliessen darf er in keiner Zaehlung offener Faelle mehr " +
        "auftauchen -- sonst verlangt die Liste jeden Tag erneut eine " +
        "Entscheidung, die getroffen ist",
    );
    assert.equal(ohneAntwortGeschlossen(e.soll), true);
  });

  test("ein gewoehnlich erledigter Vorgang gilt nicht als ohne Antwort geschlossen", () => {
    // Die Unterscheidung muss in beide Richtungen tragen: Sonst saehe
    // jeder beantwortete Vorgang wie eine Kenntnisnahme aus.
    const e = erlaubt(pruefeAenderung(ist(), { status: "erledigt" }, WER));
    assert.equal(zaehltAlsOffen(e.soll), false);
    assert.equal(ohneAntwortGeschlossen(e.soll), false);
  });

  test("ohne Grund wird nicht geschlossen", () => {
    const e = pruefeAenderung(ist(), { ohne_antwort: "ok" }, WER);
    assert.equal(e.ok, false);
    if (!e.ok) {
      assert.match(e.fehler, new RegExp(String(OHNE_ANTWORT_MINDESTLAENGE)));
      assert.equal(e.code, 400);
    }
  });

  test("ein leerer Grund ist kein Grund", () => {
    const e = pruefeAenderung(ist(), { ohne_antwort: "          " }, WER);
    assert.equal(e.ok, false);
  });

  test("der Grund steht im Protokoll, mit Namen", () => {
    const e = erlaubt(
      pruefeAenderung(
        ist({ status: "wartet" }),
        { ohne_antwort: "Erledigt sich von selbst, Mieter hat angerufen" },
        WER,
      ),
    );
    const schluss = e.eintraege.find(
      (x) => x.ereignis === "vorgang_ohne_antwort_geschlossen",
    );
    assert.ok(schluss, "Es muss einen eigenen Eintrag geben");
    assert.equal(schluss!.details.wer, WER);
    assert.equal(
      schluss!.details.nachher,
      "Erledigt sich von selbst, Mieter hat angerufen",
    );
    // Und der Statuswechsel selbst steht auch da -- mit demselben Grund.
    const wechsel = e.eintraege.find(
      (x) => x.ereignis === "vorgang_status_geaendert",
    );
    assert.equal(wechsel!.details.vorher, "wartet");
    assert.equal(wechsel!.details.nachher, "erledigt");
    assert.equal(wechsel!.details.ohne_antwort, true);
  });

  test("ein bereits erledigter Vorgang bekommt nur den Grund nachgetragen", () => {
    const e = erlaubt(
      pruefeAenderung(
        ist({ status: "erledigt" }),
        { ohne_antwort: "War nur eine Kenntnisnahme" },
        WER,
      ),
    );
    assert.deepEqual(
      e.eintraege.map((x) => x.ereignis),
      ["vorgang_ohne_antwort_geschlossen"],
      "Kein Statuswechsel, der keiner ist -- ein Protokoll voller " +
        "Nichtaenderungen ist nach einem Jahr unlesbar",
    );
  });

  test("derselbe Grund zweimal ist keine Aenderung", () => {
    const e = pruefeAenderung(
      ist({ status: "erledigt", ohne_antwort_grund: "War nur eine Kenntnisnahme" }),
      { ohne_antwort: "War nur eine Kenntnisnahme" },
      WER,
    );
    assert.equal(e.ok, false);
  });

  test("ein widersprechender Status in derselben Anfrage wird abgewiesen", () => {
    // Lieber abweisen als eine der beiden Absichten stillschweigend
    // verwerfen. Welche von beiden gewonnen haette, waere im Protokoll
    // nicht mehr zu sehen.
    const e = pruefeAenderung(
      ist(),
      { ohne_antwort: "Nur zur Kenntnis genommen", status: "wartet" },
      WER,
    );
    assert.equal(e.ok, false);
    if (!e.ok) assert.equal(e.code, 409);
  });

  test("ein mitgeschicktes status=erledigt erzeugt keinen zweiten Eintrag", () => {
    const e = erlaubt(
      pruefeAenderung(
        ist(),
        { ohne_antwort: "Nur zur Kenntnis genommen", status: "erledigt" },
        WER,
      ),
    );
    assert.equal(
      e.eintraege.filter((x) => x.ereignis === "vorgang_status_geaendert").length,
      1,
    );
  });

  test("ein Grund, der kein Text ist, wird abgewiesen", () => {
    for (const falsch of [42, true, { grund: "x" }, ["x"]]) {
      const e = pruefeAenderung(ist(), { ohne_antwort: falsch }, WER);
      assert.equal(e.ok, false, `${JSON.stringify(falsch)} ist kein Grund`);
    }
  });
});

/**
 * Die Kennzahlen zaehlen den geschlossenen Vorgang nicht mit.
 *
 * Geprueft am Quelltext und bewusst nicht an einer Datenbank -- derselbe
 * Grund wie in tests/zurueckgestellt.test.ts: Es geht nicht um die
 * Rechnung, sondern darum, DASS die Bedingung auf `status = 'offen'`
 * steht. Genau daran haengt, dass "ohne Antwort schliessen" ohne
 * Aenderung an lib/kennzahlen.ts wirkt.
 *
 * Faellt dieser Test, ist entweder die Bedingung dort aufgeweicht worden
 * -- dann zaehlt ein geschlossener Vorgang wieder mit -- oder es wurde
 * doch ein vierter Status eingefuehrt, und dann muessen alle Zaehlungen
 * nachgezogen werden.
 */
describe("ladeFreigabestand zaehlt nur offene Vorgaenge", () => {
  const kennzahlen = readFileSync(
    new URL("../lib/kennzahlen.ts", import.meta.url),
    "utf8",
  );
  const stand = kennzahlen.slice(
    kennzahlen.indexOf("async function ladeFreigabestand"),
  );
  const block = stand.slice(0, stand.indexOf("export async function ladeCockpit"));

  test("die Zaehlung der unbeantworteten Faelle prueft status = 'offen'", () => {
    assert.ok(block.length > 100, "ladeFreigabestand nicht gefunden");
    assert.match(
      block,
      /v\.status = 'offen'/,
      "lib/kennzahlen.ts zaehlt die unbeantworteten Faelle nicht mehr " +
        "ueber status = 'offen'. Dann faellt ein ohne Antwort " +
        "geschlossener Vorgang nicht mehr von selbst aus der Zahl.",
    );
  });

  test("die Zaehlung der Entwuerfe haengt an nachricht.status", () => {
    // Bewusst festgehalten, weil es der verbleibende Haken ist: Diese
    // Zahl sieht den Vorgangsstatus nicht an. Deshalb verwirft
    // api/vorgang/[id] beim Schliessen ohne Antwort einen noch offenen
    // Entwurf -- ohne das stuende er weiter in der Zahl.
    //
    // Seit dem 08.11.2026 kommt eine Verbindung zum Vorgang dazu, damit
    // sich die Zahl nach Objekt filtern laesst (lib/objektsicht.ts).
    // Geprueft wird deshalb die Bedingung und nicht mehr der Wortlaut
    // der ganzen Zeile: Dass die Zahl an nachricht.status haengt, ist
    // die Aussage -- woher die Zeilen kommen, nicht.
    assert.match(block, /FROM nachricht n/);
    assert.match(block, /n\.status = 'entwurf'/);
    assert.doesNotMatch(
      block,
      /n\.status = 'entwurf'[\s\S]{0,80}v\.status/,
      "Die Entwurfszahl darf den Vorgangsstatus nicht mitpruefen -- " +
        "sonst verschwindet ein Entwurf aus der Freigabe, sobald " +
        "jemand den Vorgang schliesst, statt verworfen zu werden.",
    );
  });

  test("die Route verwirft offene Entwuerfe beim Schliessen ohne Antwort", () => {
    const route = readFileSync(
      new URL("../app/api/vorgang/[id]/route.ts", import.meta.url),
      "utf8",
    );
    assert.match(
      route,
      /UPDATE nachricht SET status = 'verworfen'/,
      "Ohne das bliebe ein Entwurf in der Freigabe stehen, bei einem " +
        "Vorgang, auf den bewusst nicht geantwortet wird",
    );
  });
});

/**
 * Der Entwurf steht im Blickfeld.
 *
 * ANLASS (07.11.2026)
 *
 * Stephan hat einen Fall geoeffnet, antworten wollen und das Antwortfeld
 * nicht gefunden. Er hat es erst durch Scrollen entdeckt. Zwei Gruende
 * lagen uebereinander:
 *
 *   1. Der Entwurf lief in der Zeitleiste mit, also hinter dem ganzen
 *      Verlauf. Bei einem Fall mit zehn Mails lag er ausserhalb des
 *      Bildes.
 *   2. Das Anweisungsfeld ("KI erzeugen") stand in der Karte unter dem
 *      Textfeld, den Anhaengen UND der Knopfreihe.
 *
 * Beides ist geaendert. Dieser Block haelt die Aenderung fest -- nicht
 * weil eine Anordnung an sich pruefwuerdig waere, sondern weil sie
 * beim naechsten Umbau still zurueckfallen kann und niemand es merkt,
 * bis wieder jemand sein Antwortfeld sucht.
 */
describe("Die Akte zeigt die Entscheidung vor dem Zusammenhang", () => {
  const quelle = (p: string) =>
    readFileSync(new URL(p, import.meta.url), "utf8");

  const n = (status: string, id: string) => ({ status, id });

  describe("teileAkte -- die Teilung selbst", () => {
    test("Entwuerfe kommen nach oben, alles andere in den Verlauf", () => {
      const { entwuerfe, verlauf } = teileAkte([
        n("empfangen", "a"),
        n("entwurf", "b"),
        n("gesendet", "c"),
      ]);
      assert.deepEqual(entwuerfe.map((x) => x.id), ["b"]);
      assert.deepEqual(verlauf.map((x) => x.id), ["a", "c"]);
    });

    test("keine Nachricht verschwindet und keine steht doppelt", () => {
      // Das ist die eigentliche Zusage. Ein Entwurf, der oben zur
      // Entscheidung steht und zusaetzlich unten im Verlauf, ergaebe
      // zwei Textfelder mit demselben Inhalt -- und es waere nicht zu
      // sehen, welches gesendet wird.
      const alle = [
        n("empfangen", "a"),
        n("entwurf", "b"),
        n("gesendet", "c"),
        n("entwurf", "d"),
        n("empfangen", "e"),
      ];
      const { entwuerfe, verlauf } = teileAkte(alle);
      const zusammen = [...entwuerfe, ...verlauf].map((x) => x.id).sort();
      assert.deepEqual(zusammen, ["a", "b", "c", "d", "e"]);
      assert.equal(
        new Set(zusammen).size,
        alle.length,
        "eine Nachricht steht in beiden Teilen",
      );
    });

    test("die Reihenfolge innerhalb beider Teile bleibt die der Eingabe", () => {
      // Die Akte sortiert nach angelegt_am. Wird hier umsortiert,
      // stimmt der Verlauf nicht mehr mit der Zeit.
      const { entwuerfe, verlauf } = teileAkte([
        n("entwurf", "e1"),
        n("empfangen", "v1"),
        n("entwurf", "e2"),
        n("gesendet", "v2"),
      ]);
      assert.deepEqual(entwuerfe.map((x) => x.id), ["e1", "e2"]);
      assert.deepEqual(verlauf.map((x) => x.id), ["v1", "v2"]);
    });

    test("eine leere Akte gibt zwei leere Listen", () => {
      const { entwuerfe, verlauf } = teileAkte([]);
      assert.deepEqual(entwuerfe, []);
      assert.deepEqual(verlauf, []);
    });

    test("die Eingabe wird nicht veraendert", () => {
      const alle = [n("entwurf", "b"), n("empfangen", "a")];
      teileAkte(alle);
      assert.deepEqual(alle.map((x) => x.id), ["b", "a"]);
    });
  });

  describe("die Seite benutzt die Teilung auch", () => {
    const seite = quelle("../app/vorgang/[id]/page.tsx");

    test("sie teilt ueber teileAkte und baut die Filter nicht nach", () => {
      assert.match(seite, /teileAkte\(eintraege\)/);
      assert.doesNotMatch(
        seite,
        /eintraege\.filter/,
        "Ein zweiter Filter in der Seite waere eine Kopie der Regel, " +
          "die dann nicht mehr mitgeprueft wird.",
      );
    });

    test("der Verlauf rendert verlauf und nicht eintraege", () => {
      // Das ist der Weg, auf dem der Entwurf wieder doppelt auf der
      // Seite landen wuerde.
      assert.match(seite, /verlauf\.map\(/);
      assert.doesNotMatch(
        seite,
        /eintraege\.map\(/,
        "Rendert der Verlauf wieder alle Eintraege, steht der Entwurf " +
          "oben UND unten.",
      );
    });

    test("Zu entscheiden steht vor dem Verlauf", () => {
      const oben = seite.indexOf("<h2>Zu entscheiden</h2>");
      const unten = seite.indexOf("<h2>Verlauf</h2>");
      assert.ok(oben > 0, "der Abschnitt Zu entscheiden fehlt");
      assert.ok(unten > 0, "der Abschnitt Verlauf fehlt");
      assert.ok(
        oben < unten,
        "Der Entwurf muss vor dem Verlauf stehen. Genau daran ist am " +
          "07.11.2026 das Antworten gescheitert: Wer die Akte oeffnet, " +
          "will antworten, nicht lesen.",
      );
    });

    test("die Entwurfskarte steht im Abschnitt Zu entscheiden", () => {
      const oben = seite.indexOf("<h2>Zu entscheiden</h2>");
      const unten = seite.indexOf("<h2>Verlauf</h2>");
      const karte = seite.indexOf("<EntwurfKarte");
      assert.ok(
        karte > oben && karte < unten,
        "Die Karte selbst muss oben stehen, nicht nur die Ueberschrift.",
      );
    });
  });

  describe("in der Karte steht die Anweisung direkt am Text", () => {
    const karte = quelle("../components/EntwurfKarte.tsx");

    test("das Anweisungsfeld kommt vor der Knopfreihe", () => {
      const anweisung = karte.indexOf("<EntwurfAnweisung");
      const knoepfe = karte.indexOf('<div className="knopfreihe">');
      assert.ok(anweisung > 0, "EntwurfAnweisung fehlt in der Karte");
      assert.ok(knoepfe > 0, "die Knopfreihe fehlt in der Karte");
      assert.ok(
        anweisung < knoepfe,
        'Das Anweisungsfeld ("KI erzeugen") stand bis zum 07.11.2026 ' +
          "unter dem Textfeld, den Anhaengen und den Knoepfen -- und war " +
          "damit die unsichtbarste Stelle der Karte. Wer es nicht kennt, " +
          "schreibt den Text von Hand um.",
      );
    });

    test("es steht unmittelbar unter dem Entwurfstext, vor den Anhaengen", () => {
      // Das ist die gestalterische Entscheidung: Textfeld und
      // Anweisungsfeld aendern beide, was gesendet wird -- von Hand und
      // auf Anweisung. Sie gehoeren nebeneinander. Die Anhaenge sind
      // nicht Teil des Schreibens, sondern die letzte Kontrolle, und
      // bleiben darum unmittelbar vor den Knoepfen.
      const text = karte.indexOf("<textarea");
      const anweisung = karte.indexOf("<EntwurfAnweisung");
      const anhaenge = karte.indexOf("<Anhaenge");
      const knoepfe = karte.indexOf('<div className="knopfreihe">');
      assert.ok(text > 0 && anhaenge > 0, "Textfeld oder Anhaenge fehlen");
      assert.ok(
        text < anweisung && anweisung < anhaenge && anhaenge < knoepfe,
        "Erwartet: Text -> Anweisung -> Anhaenge -> Knoepfe. Gefunden: " +
          JSON.stringify({ text, anweisung, anhaenge, knoepfe }),
      );
    });

    test("die Knoepfe bleiben das Letzte in der Karte", () => {
      // "Senden" ist der Abschluss. Steht danach noch ein Feld, ist
      // wieder unklar, ob man fertig ist.
      const knoepfe = karte.indexOf('<div className="knopfreihe">');
      const schluss = karte.lastIndexOf("</section>");
      const danach = karte.slice(knoepfe, schluss);
      assert.doesNotMatch(
        danach,
        /<(EntwurfAnweisung|Anhaenge|textarea)\b/,
        "Nach den Knoepfen darf kein Eingabefeld mehr kommen.",
      );
    });

    test("die Erklaerung im Anweisungsblock steht nicht als Prosawand im Weg", () => {
      // Seit das Feld zwischen Text und "Senden" liegt, zaehlt jede
      // Zeile dort. Vier Zeilen Erklaerung standen jedes Mal zwischen
      // dem Lesen und dem Freigeben.
      const a = quelle("../components/EntwurfAnweisung.tsx");
      const ab = a.indexOf('<p className="erklaerung">');
      assert.ok(ab > 0, "die Erklaerung fehlt");
      const absatz = a.slice(ab, a.indexOf("</p>", ab));
      const zeilen = absatz.split("\n").length;
      assert.ok(
        zeilen <= 4,
        `Der Absatz ist auf ${zeilen} Zeilen gewachsen. Was sich einmal ` +
          "erklaert, gehoert ins Aufklappbare -- stehen bleibt der Satz, " +
          "der jedes Mal zaehlt: dass hier nichts hinausgeht.",
      );
      assert.match(
        absatz,
        /gesendet wird nichts/,
        "Diese Zusage muss sichtbar bleiben, nicht aufklappbar: Sie ist " +
          "der Grund, warum man in dieses Feld ueberhaupt etwas schreibt.",
      );
    });

    test("kein <details> steckt in einem <p>", () => {
      // Der Browser bricht den Absatz an der Stelle auf, weil details
      // kein Satzinhalt ist. React rendert es anstandslos -- zu sehen
      // ist es erst im Browser.
      // ohneKommentare, weil die Begruendung dieser Regel selbst ein
      // <p> im Text nennt -- sonst prueft der Test den Kommentar.
      const a = ohneKommentare(quelle("../components/EntwurfAnweisung.tsx"));
      for (const m of a.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)) {
        assert.doesNotMatch(m[1], /<details\b/, "details im Absatz");
      }
    });

    test("der Kommentar begruendet den heutigen Stand, nicht den alten", () => {
      // Eine Anordnung stillschweigend umzudrehen und die alte
      // Begruendung stehen zu lassen, waere schlimmer als beide
      // Varianten: Der naechste Leser richtet sich nach dem Kommentar.
      assert.match(karte, /DAS ANWEISUNGSFELD STEHT DIREKT AM TEXT/);
      assert.doesNotMatch(
        karte,
        /Das Anweisungsfeld steht UNTER den Knoepfen und nicht darueber:/,
        "Die alte Begruendung steht noch da und widerspricht dem Code.",
      );
    });
  });
});
