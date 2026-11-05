import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  alsE164,
  gleicheNummer,
  pruefeEmail,
  istRelayAdresse,
} from "../lib/kontaktdaten";

/**
 * Telefonnummern.
 *
 * Der teuerste Fehler ist nicht eine abgewiesene Nummer -- die sieht man.
 * Der teuerste Fehler ist eine Nummer, die angenommen und falsch gedeutet
 * wird: Aus "151 23456789" ohne Vorwahl könnte man "+4915123456789"
 * machen, und in neun von zehn Fällen stimmte das sogar. Im zehnten geht
 * die Mahnung per SMS an einen Fremden, und in der Akte steht "erreicht".
 *
 * Der zweite teure Fehler ist die Dublette: Dieselbe Nummer in drei
 * Schreibweisen führt dazu, dass der Abgleich drei Menschen sieht. Genau
 * das lag im Bestand vor -- "0151-23456789" in der Kontaktliste,
 * "+4915123456789" im Telefonbuch, "0151 23456789" im Vertrag.
 */
describe("alsE164", () => {
  test("internationale Schreibweise bleibt", () => {
    assert.equal(alsE164("+4915123456789"), "+4915123456789");
  });

  test("Gliederungszeichen tragen keine Bedeutung", () => {
    for (const roh of [
      "+49 151 23456789",
      "+49 (151) 23456789",
      "+49-151-23456789",
      "+49/151/23456789",
      "  +4915123456789  ",
    ]) {
      assert.equal(alsE164(roh), "+4915123456789", roh);
    }
  });

  test("00 ist die alte Schreibweise für +", () => {
    assert.equal(alsE164("004915123456789"), "+4915123456789");
  });

  test("führende 0 heißt Inland", () => {
    assert.equal(alsE164("0151-23456789"), "+4915123456789");
    assert.equal(alsE164("0151 23456789"), "+4915123456789");
  });

  /**
   * Die drei Schreibweisen aus dem Bestand ergeben EINE Nummer. Ohne
   * diese Zusicherung stünde dieselbe Mieterin dreimal in der Akte.
   */
  test("die drei Schreibweisen aus dem Bestand fallen zusammen", () => {
    const formen = ["0151-23456789", "+4915123456789", "0151 23456789"];
    const normiert = new Set(formen.map(alsE164));
    assert.equal(normiert.size, 1);
    assert.deepEqual([...normiert], ["+4915123456789"]);
  });

  test("ausländische Nummern gehen genauso", () => {
    assert.equal(alsE164("+33 6 12 34 56 78"), "+33612345678");
    assert.equal(alsE164("+8613800138000"), "+8613800138000");
    assert.equal(alsE164("+447700900123"), "+447700900123");
    assert.equal(alsE164("+233200000000"), "+233200000000");
  });

  /**
   * Hier entscheidet sich, ob die Funktion taugt. Jede dieser Eingaben
   * liesse sich "irgendwie" deuten -- und genau das darf sie nicht.
   */
  test("ohne erkennbare Vorwahl wird nichts geraten", () => {
    assert.equal(alsE164("151 23456789"), null, "Inland ohne 0? Ausland ohne +?");
    assert.equal(alsE164("23456789"), null, "halbe Nummer");
    assert.equal(alsE164("4915123456789"), null, "ohne + ist es eine Vermutung");
  });

  test("Buchstaben sind ein Tippfehler, keine Nummer", () => {
    assert.equal(alsE164("0151-2345678x"), null);
    assert.equal(alsE164("Handy: 0151 23456789"), null);
    assert.equal(alsE164("keine"), null);
  });

  test("zu kurz und zu lang werden abgewiesen", () => {
    assert.equal(alsE164("+49151"), null);
    assert.equal(alsE164("+4915123456789123456"), null);
  });

  test("leer bleibt leer, ohne zu werfen", () => {
    assert.equal(alsE164(null), null);
    assert.equal(alsE164(undefined), null);
    assert.equal(alsE164(""), null);
    assert.equal(alsE164("   "), null);
  });

  test("das Ergebnis ist stabil -- zweimal normiert ist einmal normiert", () => {
    const einmal = alsE164("0151-23456789")!;
    assert.equal(alsE164(einmal), einmal);
  });
});

describe("gleicheNummer", () => {
  test("verschiedene Schreibweisen desselben Anschlusses", () => {
    assert.equal(gleicheNummer("0151-23456789", "+4915123456789"), true);
  });

  test("verschiedene Anschlüsse", () => {
    assert.equal(gleicheNummer("+4915171692836", "+4915168829804"), false);
  });

  /**
   * Zwei nicht deutbare Eingaben sind nicht "beide gleich unbekannt".
   * Wäre das true, führte die Zusammenführung zwei Menschen zusammen,
   * die nichts verbindet -- und beide bekämen die Post des anderen.
   */
  test("unklar ist nicht gleich", () => {
    assert.equal(gleicheNummer("keine", "keine"), false);
    assert.equal(gleicheNummer(null, null), false);
    assert.equal(gleicheNummer("", ""), false);
  });
});

/**
 * E-Mail-Adressen.
 *
 * Geprüft wird nicht, ob die Adresse existiert -- das kann niemand ohne
 * zu senden. Geprüft wird, was einen Tippfehler verrät. Und die
 * Kleinschreibung: Ohne sie hielte die Datenbank "Mieter.A@example.org"
 * und "mieter.a@example.org" für zwei Adressen, und beide stünden am
 * selben Menschen.
 */
describe("pruefeEmail", () => {
  test("gültige Adressen kommen klein zurück", () => {
    assert.equal(pruefeEmail("Mieter.A@Example.ORG"), "mieter.a@example.org");
    assert.equal(pruefeEmail("  mieter-a@example.org  "), "mieter-a@example.org");
  });

  test("dieselbe Adresse in zwei Schreibungen fällt zusammen", () => {
    assert.equal(
      pruefeEmail("Mieter.A@Example.ORG"),
      pruefeEmail("mieter.a@example.org"),
    );
  });

  test("Tippfehler werden abgewiesen", () => {
    assert.equal(pruefeEmail("mieter-a.example.org"), null, "kein @");
    assert.equal(pruefeEmail("mieter-a@@example.org"), null, "zwei @");
    assert.equal(pruefeEmail("mieter a@example.org"), null, "Leerzeichen");
    assert.equal(pruefeEmail("mieter-a@example"), null, "Domain ohne Punkt");
    assert.equal(pruefeEmail("@example.org"), null, "kein Postfach");
    assert.equal(pruefeEmail("mieter-a@"), null, "keine Domain");
    assert.equal(pruefeEmail("mieter-a@.org"), null);
    assert.equal(pruefeEmail("mieter-a@example..org"), null);
    assert.equal(pruefeEmail("mieter-a@example.o"), null, "Endung zu kurz");
  });

  test("leer bleibt leer, ohne zu werfen", () => {
    assert.equal(pruefeEmail(null), null);
    assert.equal(pruefeEmail(""), null);
  });
});

/**
 * Relayadressen.
 *
 * Eine anonymisierte Adresse von WG-Gesucht sieht aus wie eine Adresse
 * und ist doch keine: Sie funktioniert nur innerhalb des Gesprächs dort
 * und wird abgeschaltet. Als Kontaktadresse eines Mieters eingetragen,
 * geht jede Mahnung ins Leere -- und niemand erfährt es, weil kein
 * Fehler zurückkommt.
 *
 * Im Bestand betrifft das zwei Mietverhältnisse, bei denen ÜBERHAUPT
 * keine andere Adresse bekannt ist. Dort ist "keine E-Mail" die richtige
 * Angabe, nicht die Relayadresse.
 */
describe("istRelayAdresse", () => {
  test("WG-Gesucht und Kleinanzeigen werden erkannt", () => {
    assert.equal(istRelayAdresse("abc123@wg-gesucht.de"), true);
    assert.equal(istRelayAdresse("abc123@mail.wg-gesucht.de"), true);
    assert.equal(istRelayAdresse("xy@kleinanzeigen.de"), true);
    assert.equal(istRelayAdresse("xy@ebay-kleinanzeigen.de"), true);
  });

  test("echte Adressen sind keine Relays", () => {
    assert.equal(istRelayAdresse("mieter-a@example.net"), false);
    assert.equal(istRelayAdresse("mieter-a@example.org"), false);
  });

  /**
   * Eine Adresse, die das Wort nur im Postfachteil trägt, ist keine
   * Relayadresse -- geprüft wird die Domain, nicht der Text.
   */
  test("das Wort im Postfachteil macht noch kein Relay", () => {
    assert.equal(istRelayAdresse("wg-gesucht@example.org"), false);
  });

  test("unbrauchbare Eingabe ist kein Relay", () => {
    assert.equal(istRelayAdresse(null), false);
    assert.equal(istRelayAdresse("kein-at-zeichen"), false);
  });
});
