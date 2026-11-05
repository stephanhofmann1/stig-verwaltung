import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  entscheideVersandweg,
  baueThreadHeader,
  zitiere,
} from "../lib/versand";

/**
 * Versandweg und Trockenmodus.
 *
 * Der teuerste Fehler im Versand ist nicht eine Mail, die scheitert --
 * ein Fehler ist sichtbar. Der teuerste Fehler ist eine Mail, die als
 * "gesendet" im Portal steht und nie jemanden erreicht hat. Dann
 * verlaesst man sich auf eine Antwort, die niemand bekommen hat, und
 * merkt es erst, wenn die Frist abgelaufen ist.
 *
 * Genau das konnte die Plattform: ohne RESEND_API_KEY lief sie im
 * Trockenmodus und setzte die Nachricht trotzdem auf 'gesendet'.
 * Diese Tests halten fest, dass das im Betrieb nicht mehr passiert.
 */
describe("entscheideVersandweg", () => {
  test("mit Resend-Schluessel wird ueber Resend gesendet", () => {
    const e = entscheideVersandweg({
      resendKey: "re_xxx",
      produktion: true,
    });
    assert.equal(e.weg, "resend");
    assert.equal(e.darfSenden, true);
    assert.equal(e.grund, undefined);
  });

  test("ohne Resend, aber mit SMTP wird ueber SMTP gesendet", () => {
    const e = entscheideVersandweg({
      smtpHost: "smtp.example.org",
      produktion: true,
    });
    assert.equal(e.weg, "smtp");
    assert.equal(e.darfSenden, true);
  });

  test("Resend hat Vorrang vor SMTP", () => {
    const e = entscheideVersandweg({
      resendKey: "re_xxx",
      smtpHost: "smtp.example.org",
      produktion: true,
    });
    assert.equal(e.weg, "resend");
  });

  test("im Betrieb ohne jeden Versandweg wird abgewiesen", () => {
    const e = entscheideVersandweg({ produktion: true });
    assert.equal(e.weg, "trocken");
    assert.equal(
      e.darfSenden,
      false,
      "Im Betrieb darf ohne Versandweg nichts als gesendet gelten",
    );
  });

  test("die Begruendung sagt, dass nichts gesendet wurde", () => {
    const e = entscheideVersandweg({ produktion: true });
    assert.ok(e.grund, "Eine Abweisung ohne Begruendung ist unbrauchbar");
    // Wer das im Portal liest, muss zwei Dinge erfahren: dass nichts
    // rausging, und welche Variable fehlt.
    assert.match(e.grund!, /nichts gesendet/i);
    assert.match(e.grund!, /RESEND_API_KEY/);
    assert.match(e.grund!, /SMTP_HOST/);
  });

  test("lokal bleibt der Trockenmodus erlaubt", () => {
    const e = entscheideVersandweg({ produktion: false });
    assert.equal(e.weg, "trocken");
    assert.equal(
      e.darfSenden,
      true,
      "Ohne Zugangsdaten muss sich der Ablauf lokal durchspielen lassen",
    );
  });

  /**
   * Der leere String ist die Falle. `process.env.X` ist "" statt
   * undefined, sobald die Variable in der .env steht, aber ohne Wert --
   * eine abgeschnittene Zeile, ein vergessenes Einfuegen. Wer auf
   * `?? ` statt auf Wahrheitswert prueft, haelt "" fuer einen Schluessel
   * und sendet ins Nichts.
   */
  test("ein leer gesetzter Schluessel gilt als fehlend", () => {
    const e = entscheideVersandweg({
      resendKey: "",
      smtpHost: "",
      produktion: true,
    });
    assert.equal(e.weg, "trocken");
    assert.equal(e.darfSenden, false);
  });

  test("null gilt ebenso als fehlend", () => {
    const e = entscheideVersandweg({
      resendKey: null,
      smtpHost: null,
      produktion: true,
    });
    assert.equal(e.darfSenden, false);
  });
});

/**
 * Thread-Header.
 *
 * Reisst der Thread, erscheint die Antwort beim Empfaenger als neue Mail
 * ohne Zusammenhang -- bei einer Abrechnung mit Frist genau das, was man
 * nicht will.
 */
describe("baueThreadHeader", () => {
  test("In-Reply-To ist die Message-ID der Bezugsnachricht", () => {
    const h = baueThreadHeader({
      message_id: "<b@teha-wd.de>",
      referenzen: ["<a@me.com>"],
    });
    assert.equal(h.in_reply_to, "<b@teha-wd.de>");
    assert.deepEqual(h.referenzen, ["<a@me.com>", "<b@teha-wd.de>"]);
  });

  test("ohne Message-ID bleibt In-Reply-To leer", () => {
    const h = baueThreadHeader({ message_id: null, referenzen: ["<a@me.com>"] });
    assert.equal(h.in_reply_to, null);
    assert.deepEqual(h.referenzen, ["<a@me.com>"]);
  });

  test("Doppelte werden entfernt, die Reihenfolge bleibt", () => {
    const h = baueThreadHeader({
      message_id: "<b@x>",
      referenzen: ["<a@x>", "<b@x>"],
    });
    assert.deepEqual(h.referenzen, ["<a@x>", "<b@x>"]);
  });
});

/**
 * Zitat der Elternnachricht.
 *
 * Ohne Zitat erreicht den Empfaenger nur der neue Text. Die
 * Thread-Kopfzeilen sortieren die Mail zwar richtig ein, aber wer sie
 * einzeln oeffnet, weiterleitet oder ausdruckt -- und bei einer
 * Abrechnung mit Ausschlussfrist tut das irgendwann jemand -- sieht
 * eine Antwort ohne die Frage.
 */
describe("zitiere", () => {
  const eltern = {
    von_name: "Dominik Heinrich",
    von_email: "d.heinrich@example.de",
    koerper_text: "Guten Tag,\n\nder Verbrauch wurde geschaetzt.",
    gesendet_am: "2026-10-13T13:15:10.000Z",
  };

  test("nennt Datum, Uhrzeit und Absender", () => {
    const z = zitiere(eltern);
    assert.match(z, /Am 13\.10\.2026 um 15:15 schrieb Dominik Heinrich <d\.heinrich@example\.de>:/);
  });

  /**
   * Der Server laeuft in UTC, gelesen wird die Mail in Deutschland.
   * 13:15 UTC im Oktober sind 15:15 deutscher Zeit (Sommerzeit).
   * Ohne feste Zeitzone stuende im Zitat eine Uhrzeit, die der
   * Empfaenger in seiner eigenen Mail nicht wiederfindet.
   */
  test("rechnet in deutsche Zeit um -- Sommerzeit", () => {
    assert.match(zitiere(eltern), /um 15:15 /);
  });

  /**
   * Dieser Test ist der eigentliche Schutz.
   *
   * Der vorige besteht auch dann, wenn die Zeitzone gar nicht im Code
   * steht -- naemlich auf jedem Rechner, der ohnehin auf deutscher Zeit
   * laeuft. Der Server laeuft in UTC. Ein Test, der nur zu Hause gruen
   * ist, schuetzt nichts; deshalb wird die Umgebung hier absichtlich
   * weggedreht.
   */
  test("die Zeitzone steht im Code, nicht in der Umgebung", () => {
    const vorher = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles";
      assert.match(
        zitiere(eltern),
        /Am 13\.10\.2026 um 15:15 /,
        "Ohne feste Zeitzone stuende hier die Zeit des Servers",
      );
      process.env.TZ = "UTC";
      assert.match(zitiere(eltern), /Am 13\.10\.2026 um 15:15 /);
    } finally {
      if (vorher === undefined) delete process.env.TZ;
      else process.env.TZ = vorher;
    }
  });

  test("rechnet in deutsche Zeit um -- Winterzeit ueber den Tageswechsel", () => {
    const z = zitiere({ ...eltern, gesendet_am: "2026-01-15T23:30:00.000Z" });
    // 23:30 UTC im Januar sind 00:30 des Folgetages in Deutschland.
    assert.match(z, /Am 16\.01\.2026 um 00:30 /);
  });

  test("jede Zeile wird zitiert", () => {
    const z = zitiere(eltern);
    assert.match(z, /\n> Guten Tag,\n/);
    assert.match(z, /\n> der Verbrauch wurde geschaetzt\./);
  });

  /**
   * Verschachtelung entsteht von selbst: Traegt die Elternnachricht
   * schon ein Zitat, wird deren ">" zu ">>". So bleibt der ganze
   * Verlauf erhalten, ohne dass ueber Ebenen gerechnet wird.
   */
  test("vorhandene Zitate ruecken eine Ebene nach innen", () => {
    const z = zitiere({ ...eltern, koerper_text: "Antwort\n\n> Frage\n>> Aeltere Frage" });
    assert.match(z, /\n> Antwort\n/);
    assert.match(z, /\n>> Frage\n/);
    assert.match(z, /\n>>> Aeltere Frage/);
  });

  test("leere Zeilen bleiben erhalten, aber zitiert", () => {
    assert.match(zitiere(eltern), /\n> \n/);
  });

  test("Windows-Zeilenenden werden sauber behandelt", () => {
    const z = zitiere({ ...eltern, koerper_text: "Eins\r\nZwei" });
    assert.match(z, /\n> Eins\n> Zwei/);
    assert.doesNotMatch(z, /\r/, "Kein Wagenruecklauf im Ergebnis");
  });

  test("ohne Text gibt es kein Zitat", () => {
    assert.equal(zitiere({ ...eltern, koerper_text: "" }), "");
    assert.equal(zitiere({ ...eltern, koerper_text: "   \n\n  " }), "");
    assert.equal(zitiere({ ...eltern, koerper_text: null }), "");
  });

  test("ohne Namen steht die Adresse allein", () => {
    const z = zitiere({ ...eltern, von_name: null });
    assert.match(z, /schrieb d\.heinrich@example\.de:/);
    assert.doesNotMatch(z, /<d\.heinrich@example\.de>/);
  });

  test("ohne brauchbares Datum entfaellt der Zeitpunkt, nicht das Zitat", () => {
    const z = zitiere({
      von_name: "Dominik Heinrich",
      von_email: "d.heinrich@example.de",
      koerper_text: "Guten Tag",
      gesendet_am: null,
      empfangen_am: null,
      angelegt_am: null,
    });
    assert.match(z, /^\n\nDominik Heinrich <d\.heinrich@example\.de> schrieb:\n\n> Guten Tag$/);
  });

  test("unbrauchbares Datum laesst das Zitat stehen", () => {
    const z = zitiere({ ...eltern, gesendet_am: "kein Datum" });
    // Ohne Zeitpunkt aendert sich die Wortstellung: "X schrieb:" statt
    // "Am ... schrieb X:". Der Text bleibt vollstaendig.
    assert.match(z, /Dominik Heinrich <d\.heinrich@example\.de> schrieb:/);
    assert.doesNotMatch(z, /^\n\nAm /);
    assert.match(z, /> Guten Tag,/);
    assert.doesNotMatch(z, /Invalid|NaN/);
  });

  test("faellt auf empfangen_am zurueck, wenn nicht gesendet wurde", () => {
    const z = zitiere({
      ...eltern,
      gesendet_am: null,
      empfangen_am: "2026-10-13T13:15:10.000Z",
    });
    assert.match(z, /Am 13\.10\.2026 um 15:15 /);
  });

  test("beginnt mit Leerraum, damit es nicht am Text klebt", () => {
    assert.ok(zitiere(eltern).startsWith("\n\n"));
  });
});
