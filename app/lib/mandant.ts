import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Wer ist gerade dran?
 *
 * Jede Datenbankabfrage laeuft unter genau einem Mandanten. Die Datenbank
 * setzt das selbst durch (Row Level Security, siehe db/010) -- hier geht es
 * darum, den Mandanten ueberhaupt bis zur Abfrage zu tragen, ohne ihn durch
 * jede Funktionssignatur zu reichen.
 *
 * Zwei Wege hinein:
 *   1. Menschen: der Mandant steht im Sitzungscookie. db.ts liest ihn
 *      von dort, wenn hier nichts gesetzt ist -- deshalb muessen Seiten
 *      und Schnittstellen nichts umbauen.
 *   2. Maschinen (Maileingang, Aufgabenlaeufe, oeffentliche Schnittstelle):
 *      kein Cookie vorhanden. Die setzen den Mandanten ausdruecklich mit
 *      mitMandant(...).
 */

const speicher = new AsyncLocalStorage<string>();

/** Fuehrt fn unter diesem Mandanten aus. Verschachteln ist erlaubt. */
export function mitMandant<T>(mandantId: string, fn: () => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(mandantId)) {
    throw new Error(`Unplausible Mandanten-Kennung: ${mandantId}`);
  }
  return speicher.run(mandantId, fn);
}

/** Der aktuell gesetzte Mandant, oder null. */
export function gesetzterMandant(): string | null {
  return speicher.getStore() ?? null;
}

/**
 * Schlaegt den Mandanten zu einer Empfaengeradresse oder einem Hostnamen nach.
 *
 * Laeuft bewusst an der Mandantentrennung vorbei: An dieser Stelle gibt es
 * noch keinen Mandanten, den man einsetzen koennte. mandant_adresse ist
 * deshalb von RLS ausgenommen und enthaelt nur die Zuordnung selbst.
 */
export async function mandantFuerAdresse(
  adresse: string,
): Promise<string | null> {
  const { pool } = await import("./db");
  const r = await pool.query<{ mandant_id: string }>(
    `SELECT mandant_id FROM mandant_adresse WHERE adresse = lower($1)`,
    [adresse.trim()],
  );
  return r.rows[0]?.mandant_id ?? null;
}

/**
 * Wie mandantFuerAdresse, aber ueber alle Empfaenger einer Mail.
 * Die erste Adresse, die wir kennen, gewinnt.
 */
export async function mandantFuerEmpfaenger(
  empfaenger: string[],
): Promise<string | null> {
  for (const e of empfaenger) {
    const treffer = await mandantFuerAdresse(e);
    if (treffer) return treffer;
  }
  return null;
}

/**
 * Alle Mandanten -- nur fuer Aufgabenlaeufe, die ueber alle gehen.
 *
 * Gelesen wird aus mandant_adresse, nicht aus mandant: Die Mandantentabelle
 * ist durch RLS geschuetzt und liefert ohne gesetzten Mandanten nichts --
 * genau das ist hier das Problem. mandant_adresse ist von RLS ausgenommen,
 * und jeder Mandant im Betrieb hat mindestens eine Eingangsadresse,
 * sonst erreicht ihn ohnehin nichts.
 */
export async function alleMandanten(): Promise<string[]> {
  const { pool } = await import("./db");
  const r = await pool.query<{ mandant_id: string }>(
    `SELECT DISTINCT mandant_id FROM mandant_adresse`,
  );
  return r.rows.map((z) => z.mandant_id);
}
