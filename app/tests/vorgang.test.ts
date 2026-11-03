import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BEGRUENDUNG_MINDESTLAENGE,
  STATUS_WEGE,
  erlaubteStatus,
  hebtSperreAuf,
  istKategorie,
  istStatus,
  pruefeAenderung,
  statusKnopf,
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
  return { status: "offen", kategorie: "sonstige", heikel: false, ...teil };
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

  test("es gibt nur PATCH -- kein GET, das die Akte offenlegt", () => {
    assert.match(route, /export async function PATCH/);
    for (const m of ["GET", "POST", "PUT", "DELETE"]) {
      assert.doesNotMatch(
        route,
        new RegExp(`export async function ${m}\\b`),
        `${m} ist nicht vorgesehen`,
      );
    }
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
