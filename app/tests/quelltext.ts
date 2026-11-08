/**
 * Hilfen fuer Tests, die Quelltext lesen.
 *
 * WARUM ES DIESE DATEI GIBT (08.11.2026)
 *
 * Mehrere Tests hier pruefen nicht ein Ergebnis, sondern den Quelltext
 * selbst: dass eine Komponente serverseitig bleibt, dass eine Route den
 * Mandanten nicht aus dem Koerper nimmt, dass kein <details> in einem
 * <p> steckt. Das ist manchmal die einzige Stelle, an der eine Zusage
 * ueberhaupt festzuhalten ist.
 *
 * Dabei ist dreimal derselbe Fehler passiert: Der Test fand das
 * verbotene Wort -- im Kommentar, der erklaert, warum es verboten ist.
 * Die Pruefung war gruen, solange niemand die Begruendung aufschrieb,
 * und wurde rot, sobald jemand sie aufschrieb. Das ist die
 * Verkehrtherum-Variante eines Tests.
 *
 * Darum steht das Entfernen der Kommentare hier, einmal, und nicht in
 * jeder Testdatei neu.
 */

/**
 * Entfernt Block- und Zeilenkommentare.
 *
 * Bewusst einfach gehalten: Es geht um unseren eigenen Quelltext, nicht
 * um beliebiges JavaScript. Ein "//" in einer Zeichenkette (etwa in
 * "https://...") bleibt deshalb stehen -- das Entfernen beschraenkt sich
 * auf Zeilen, die mit dem Kommentarzeichen beginnen.
 */
export function ohneKommentare(quelle: string): string {
  return quelle
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Nur die Importzeilen -- fuer Pruefungen, was eine Datei hereinzieht. */
export function nurImporte(quelle: string): string {
  return quelle
    .split("\n")
    .filter((z) => /^\s*import\b/.test(z))
    .join("\n");
}
