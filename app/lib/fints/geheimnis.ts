import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Verschlüsselung der Banking-PIN.
 *
 * Was das leistet und was nicht -- ausdrücklich, damit sich niemand darauf
 * verlässt, was es nicht kann:
 *
 *   Es schützt gegen einen Datenbank-Abzug, ein Backup auf fremdem
 *   Datenträger, einen versehentlich geteilten Dump. Es schützt NICHT
 *   gegen jemanden mit Root auf dem Server -- der liest die
 *   Umgebungsvariable und entschlüsselt.
 *
 * Das ist keine Nachlässigkeit, sondern folgt aus der Aufgabe: Ein
 * nächtlicher Lauf, der sich ohne Menschen bei der Bank anmeldet, muss die
 * PIN auf dieser Maschine wiederherstellen können. Läge der Schlüssel
 * woanders, müsste bei jedem Neustart jemand ihn eingeben -- dann ist der
 * Lauf nicht unbeaufsichtigt. Ich hatte das am 01.11.2026 zunächst anders
 * dargestellt ("Schlüssel liegt nicht auf derselben Maschine"); das war
 * für einen unbeaufsichtigten Lauf nicht haltbar.
 *
 * Daraus folgt die Voraussetzung, die vor dem ersten Hinterlegen einer PIN
 * erfüllt sein muss: Passwort-Anmeldung am Server abgeschaltet,
 * Root-Passwort zurückgesetzt.
 *
 * AES-256-GCM, weil es nicht nur verschlüsselt, sondern erkennt, wenn
 * jemand am Geheimtext gedreht hat. Ohne diese Prüfsumme könnte ein
 * veränderter Datensatz eine falsche PIN liefern -- und drei falsche
 * Anmeldungen sperren den Bankzugang.
 */

const NONCE_LAENGE = 12;
const PRUEF_LAENGE = 16;

export class SchluesselFehlt extends Error {
  constructor() {
    super(
      "FINTS_SCHLUESSEL ist nicht gesetzt. Ohne ihn kann keine PIN " +
        "hinterlegt oder gelesen werden. Erzeugen mit: openssl rand -hex 32",
    );
    this.name = "SchluesselFehlt";
  }
}

/**
 * Holt den Schlüssel aus der Umgebung.
 *
 * Verlangt genau 32 Byte (64 Hexzeichen). Kürzere Werte werden
 * **abgelehnt** statt aufgefüllt: Ein aufgefüllter Schlüssel sieht aus wie
 * AES-256 und hat die Stärke des eingegebenen Textes. Ein Tippfehler in
 * der .env wäre dann eine stillschweigend schwache Verschlüsselung.
 */
function schluessel(): Buffer {
  const roh = process.env.FINTS_SCHLUESSEL;
  if (!roh) throw new SchluesselFehlt();
  if (!/^[0-9a-fA-F]{64}$/.test(roh.trim())) {
    throw new Error(
      "FINTS_SCHLUESSEL muss genau 64 Hexzeichen lang sein (32 Byte). " +
        "Erzeugen mit: openssl rand -hex 32",
    );
  }
  return Buffer.from(roh.trim(), "hex");
}

/** Ist ein brauchbarer Schlüssel eingerichtet? Ohne Ausnahme, zum Prüfen. */
export function schluesselVorhanden(): boolean {
  try {
    schluessel();
    return true;
  } catch {
    return false;
  }
}

/**
 * Verschlüsselt eine PIN. Ergebnis: Nonce ++ Geheimtext ++ Prüfsumme.
 *
 * Die Nonce ist bei jedem Aufruf neu und zufällig. Eine feste Nonce würde
 * bei GCM nicht nur Wiederholungen sichtbar machen, sondern den
 * Schlüsselstrom wiederverwenden -- damit wäre die Verschlüsselung gebrochen.
 */
export function verschluessele(pin: string): Buffer {
  if (pin === "") throw new Error("Leere PIN wird nicht gespeichert.");
  const nonce = randomBytes(NONCE_LAENGE);
  const c = createCipheriv("aes-256-gcm", schluessel(), nonce);
  const text = Buffer.concat([c.update(pin, "utf8"), c.final()]);
  return Buffer.concat([nonce, text, c.getAuthTag()]);
}

/**
 * Entschlüsselt eine PIN.
 *
 * Wirft, wenn die Prüfsumme nicht stimmt -- also auch dann, wenn der
 * Schlüssel gewechselt wurde. Das ist die gewollte Richtung: Lieber ein
 * Lauf, der mit "PIN nicht lesbar" scheitert, als einer, der sich mit
 * Datenmüll bei der Bank anmeldet und nach drei Versuchen den Zugang sperrt.
 */
export function entschluessele(gespeichert: Buffer): string {
  if (gespeichert.length <= NONCE_LAENGE + PRUEF_LAENGE) {
    throw new Error("Gespeicherte PIN ist zu kurz, um gültig zu sein.");
  }
  const nonce = gespeichert.subarray(0, NONCE_LAENGE);
  const pruef = gespeichert.subarray(gespeichert.length - PRUEF_LAENGE);
  const text = gespeichert.subarray(
    NONCE_LAENGE,
    gespeichert.length - PRUEF_LAENGE,
  );
  const d = createDecipheriv("aes-256-gcm", schluessel(), nonce);
  d.setAuthTag(pruef);
  return Buffer.concat([d.update(text), d.final()]).toString("utf8");
}
