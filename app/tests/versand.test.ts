import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { entscheideVersandweg, baueThreadHeader } from "../lib/versand";

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
