/**
 * Telefonnummern und E-Mail-Adressen, bevor sie in die Datenbank gehen.
 *
 * Reine Funktionen, ohne Datenbank. Der Grund ist derselbe wie bei den
 * Mahnstufen: An einer Telefonnummer hängt, ob eine Mahnung, eine
 * Kündigung oder eine Terminabsage den richtigen Menschen erreicht. Eine
 * Nummer, die zweimal in verschiedener Schreibweise in der Akte steht,
 * ist schlimmer als eine fehlende -- bei der weiß man wenigstens, dass
 * man anrufen muss.
 *
 * Woher das kommt: Dieselbe Mobilnummer stand im Bestand in drei
 * Schreibweisen nebeneinander -- "0151-23456789" in einer Kontaktliste,
 * "+4915123456789" im Telefonbuch, "0151 23456789" in einem Vertrag. Der
 * Abgleich hielt sie für drei Menschen. Erst nach der Vereinheitlichung
 * wurde sichtbar, dass zwei unabhängige Quellen dieselbe Nummer nennen --
 * und das ist die beste Bestätigung, die ohne Nachfragen zu haben ist.
 */

/** Die Vorwahl, die gilt, wenn eine Nummer mit einer 0 beginnt. */
const LANDESVORWAHL = "49";

export interface Nummer {
  /** '+4915123456789' -- die Form, in der gespeichert wird. */
  e164: string;
  /** Wie der Mensch sie geschrieben hat. Bleibt für die Anzeige erhalten. */
  roh: string;
}

/**
 * Bringt eine Telefonnummer auf die internationale Form.
 *
 * Gibt `null` zurück, wenn sich die Nummer nicht sicher deuten lässt --
 * und das ist der eigentliche Zweck. Eine geratene Vorwahl erzeugt eine
 * Nummer, die es gibt, nur nicht die des Mieters; der Anruf geht dann an
 * einen Fremden, und im Mahnlauf steht trotzdem "erreicht".
 *
 * Gedeutet wird:
 *   '+49 176 7284396'   -> schon international
 *   '0049 176 ...'      -> 00 ist die alte Schreibweise für +
 *   '0151-23456789'     -> führende 0 heißt Inland
 *   '(0176) 23456789'   -> Klammern, Striche, Schrägstriche, Leerzeichen
 *
 * Nicht gedeutet (ergibt null):
 *   '23456789'          -> ohne Vorwahl, es fehlt die halbe Nummer
 *   '151 23456789'      -> könnte Inland ohne 0 oder Ausland ohne + sein
 *   '0151-2345678x'     -> Buchstaben in einer Nummer sind ein Tippfehler
 */
export function alsE164(roh: string | null | undefined): string | null {
  if (!roh) return null;
  const text = String(roh).trim();
  if (!text) return null;

  // Alles, was Menschen zur Gliederung schreiben, trägt keine Bedeutung.
  // Ein Buchstabe dagegen schon: Er heißt, dass hier keine Nummer steht.
  const bereinigt = text.replace(/[\s()\/.\-–—]/g, "");
  if (/[^\d+]/.test(bereinigt)) return null;

  let ziffern: string;
  if (bereinigt.startsWith("+")) {
    ziffern = bereinigt.slice(1);
  } else if (bereinigt.startsWith("00")) {
    ziffern = bereinigt.slice(2);
  } else if (bereinigt.startsWith("0")) {
    ziffern = LANDESVORWAHL + bereinigt.slice(1);
  } else {
    // Weder + noch 00 noch führende 0: Die Nummer sagt nicht, wohin sie
    // gehört. Lieber nichts als die falsche Vorwahl.
    return null;
  }

  if (!/^\d+$/.test(ziffern)) return null;
  // E.164 erlaubt höchstens 15 Stellen; darunter ist nichts Anrufbares.
  // Die Untergrenze ist großzügig, weil es kurze Ländervorwahlen und
  // kurze Festnetznummern gibt.
  if (ziffern.length < 8 || ziffern.length > 15) return null;

  return "+" + ziffern;
}

/**
 * Zwei Nummern meinen denselben Anschluss.
 *
 * Vergleicht über die internationale Form. Lässt sich eine der beiden
 * nicht deuten, ist die Antwort `false` -- nicht "vielleicht". Wer hier
 * großzügig wäre, führte zwei Menschen zusammen, die nichts verbindet.
 */
export function gleicheNummer(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const x = alsE164(a);
  const y = alsE164(b);
  return x !== null && x === y;
}

/**
 * Prüft eine E-Mail-Adresse und bringt sie auf Kleinschreibung.
 *
 * Bewusst keine erschöpfende Prüfung nach RFC 5322 -- die ließe Adressen
 * durch, die kein Postfach der Welt annimmt, und wiese welche ab, die
 * es gibt. Geprüft wird, was einen Tippfehler verrät: fehlendes @, kein
 * Punkt in der Domain, Leerzeichen, zwei @.
 *
 * Kleinschreibung, weil der Domainteil ohnehin nicht zwischen Groß und
 * Klein unterscheidet und die Eindeutigkeit in der Datenbank sonst
 * "Mieter.A@example.org" und "mieter.a@example.org" für zwei Adressen
 * hielte. Genau so standen Adressen im Bestand -- aus Verträgen
 * abgeschrieben, mal so, mal so.
 */
export function pruefeEmail(roh: string | null | undefined): string | null {
  if (!roh) return null;
  const text = String(roh).trim().toLowerCase();
  if (!text) return null;
  if (/\s/.test(text)) return null;
  const teile = text.split("@");
  if (teile.length !== 2) return null;
  const [lokal, domain] = teile;
  if (!lokal || !domain) return null;
  if (!domain.includes(".")) return null;
  if (domain.startsWith(".") || domain.endsWith(".")) return null;
  if (domain.includes("..")) return null;
  // Die kürzeste denkbare Endung hat zwei Zeichen (.de, .io).
  const endung = domain.slice(domain.lastIndexOf(".") + 1);
  if (endung.length < 2) return null;
  return text;
}

/**
 * Eine Relayadresse ist keine Adresse des Menschen.
 *
 * WG-Gesucht und Kleinanzeigen stellen anonymisierte Adressen zu, die
 * nur innerhalb des Gesprächs dort funktionieren und nach einiger Zeit
 * abgeschaltet werden. Als Kontaktadresse eines Mieters eingetragen,
 * sieht sie aus wie eine und ist doch keine: Eine Mahnung darüber kommt
 * nie an, und niemand erfährt es.
 */
const RELAY_MUSTER =
  /@(?:[a-z0-9-]+\.)?(?:wg-gesucht\.de|kleinanzeigen\.de|ebay-kleinanzeigen\.de|immobilienscout24\.de)$/i;

export function istRelayAdresse(email: string | null | undefined): boolean {
  const a = pruefeEmail(email);
  return a !== null && RELAY_MUSTER.test(a);
}
