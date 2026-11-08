/**
 * Ein Monat als Ausschnitt -- gelesen aus der Adresszeile.
 *
 * ANLASS (08.11.2026)
 *
 * Stephan wollte die Diagramme anklickbar: "Monat anklicken fuehrt zur
 * Liste." Ein Klick auf den Novemberbalken im Cashflow soll die
 * Buchungen dieses Monats zeigen, und zwar die des gewaehlten Hauses.
 *
 * Dafuer steht der Monat in der Adresse (?monat=2026-11) und nicht in
 * einem Zustand im Browser: Es ist eine andere Abfrage, nicht eine
 * andere Ansicht derselben Zahlen -- und so laesst sich der Blick
 * weitergeben.
 */

/** Ein Monat in der Form JJJJ-MM. */
export type Monat = string;

/**
 * Liest einen Monat aus einem Suchparameter.
 *
 * null heisst "kein Monat gewaehlt" -- das ist der Normalfall und kein
 * Fehler. Alles, was nicht wie ein Monat aussieht, ergibt ebenfalls
 * null: Ein veralteter Verweis oder ein Tippfehler soll die gewohnte
 * Seite zeigen und keine leere Liste, die wie ein Befund aussieht.
 *
 * Geprueft wird die Form UND der Monat selbst: "2026-13" hat die
 * richtige Form und gibt es nicht.
 */
export function liesMonat(roh: string | string[] | undefined): Monat | null {
  const wert = Array.isArray(roh) ? roh[0] : roh;
  if (typeof wert !== "string") return null;
  const treffer = /^(\d{4})-(\d{2})$/.exec(wert.trim());
  if (!treffer) return null;
  const jahr = Number(treffer[1]);
  const monat = Number(treffer[2]);
  if (monat < 1 || monat > 12) return null;
  // Vor 2000 und weit in der Zukunft gibt es hier nichts zu sehen; eine
  // Jahreszahl wie 0202 ist ein Vertipper, kein Wunsch.
  if (jahr < 2000 || jahr > 2100) return null;
  return `${treffer[1]}-${treffer[2]}`;
}

const MONATSNAMEN = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

/** "2026-11" -> "November 2026". Fuer Ueberschriften. */
export function monatsName(monat: Monat): string {
  const [jahr, mm] = monat.split("-");
  return `${MONATSNAMEN[Number(mm) - 1] ?? mm} ${jahr}`;
}
