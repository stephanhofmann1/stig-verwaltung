/**
 * Konten der Verwaltung.
 *
 * Ein Konto ist der Behaelter, an dem Buchungen haengen -- egal ob sie aus
 * einem CSV-Auszug kommen oder spaeter per FinTS. Ohne mindestens ein Konto
 * gibt es keinen Weg, Zahlungen hereinzubekommen: Der CSV-Import sucht das
 * Konto ueber die Bezeichnung, und die FinTS-Einrichtung laesst nur unter
 * einem bestehenden Konto anlegen.
 */

/**
 * Kuerzt eine Kontoangabe auf die letzten vier Stellen.
 *
 * Die Spalte heisst `iban_kurz` und der Kommentar im Schema sagt "nur die
 * letzten Stellen, nie die volle IBAN". Das ist hier keine Pruefung, die man
 * umgehen koennte, sondern eine Kuerzung: Diese Funktion kann gar nicht mehr
 * als vier Zeichen zurueckgeben. Wer die ganze IBAN ins Feld einfuegt --
 * und das ist das Naheliegende -- bekommt sie gekuerzt gespeichert, nicht
 * eine Fehlermeldung.
 *
 * Eine IBAN ist eine Kontonummer. Sie gehoert nicht breiter in die
 * Datenbank als nötig, und zum Wiedererkennen eines Kontos in einer Liste
 * genuegen vier Stellen.
 */
export function kurzeIban(eingabe: string | null | undefined): string | null {
  if (!eingabe) return null;
  // Alles weg, was keine Ziffer und kein Buchstabe ist: Leerzeichen aus dem
  // Kopieren, Punkte, die Aufzaehlungszeichen aus einer Anzeige wie "••1234".
  const roh = eingabe.replace(/[^0-9a-zA-Z]/g, "").toUpperCase();
  if (roh === "") return null;
  return roh.slice(-4);
}

/**
 * Prueft eine Kontobezeichnung.
 *
 * Die Bezeichnung ist der Schluessel, ueber den der CSV-Import sein Konto
 * findet (`WHERE bezeichnung = $1`). Fuehrende oder folgende Leerzeichen
 * waeren deshalb kein Schoenheitsfehler, sondern ein Konto, das der Import
 * nicht mehr findet, obwohl es in der Liste richtig aussieht.
 */
export function pruefeBezeichnung(eingabe: string | null | undefined): {
  wert: string;
  fehler: string | null;
} {
  const wert = (eingabe ?? "").trim().replace(/\s+/g, " ");
  if (wert === "") {
    return { wert, fehler: "Die Bezeichnung fehlt." };
  }
  if (wert.length > 80) {
    return { wert, fehler: "Die Bezeichnung ist länger als 80 Zeichen." };
  }
  return { wert, fehler: null };
}

export const KONTO_ARTEN = ["bank", "barkasse"] as const;
export type KontoArt = (typeof KONTO_ARTEN)[number];

export function pruefeArt(eingabe: string | null | undefined): KontoArt | null {
  // Nicht `eingabe ?? "bank"`: Ein leeres Formularfeld kommt als "" an, nicht
  // als null oder undefined -- `??` greift dann nicht, und das Konto waere
  // mit einer Fehlermeldung abgelehnt worden, obwohl nichts falsch ist.
  const w = (eingabe ?? "").trim() || "bank";
  return (KONTO_ARTEN as readonly string[]).includes(w) ? (w as KontoArt) : null;
}
