import { scryptSync } from "node:crypto";
import { cookies } from "next/headers";
import { pool } from "./db";
import {
  COOKIE,
  pruefePasswort,
  pruefeSitzung,
  type Rolle,
  type Sitzung,
} from "./sitzung";

/**
 * Anmeldung gegen die Benutzertabelle.
 *
 * Seit der Mandantentrennung stehen die Benutzer in der Datenbank, nicht mehr
 * in der Umgebungsvariable BENUTZER. Drei Gruende: Kunden legen eigene Leute
 * an, ohne dass jemand eine .env anfasst; die Rolle entscheidet mit, was
 * jemand sehen darf; und ein Mieter gehoert an sein Mietverhaeltnis geknuepft.
 *
 * Die Abfrage laeuft bewusst direkt ueber den Pool und nicht ueber query():
 * Beim Anmelden gibt es noch keinen Mandanten, der zu setzen waere. Die
 * Benutzertabelle ist zwar durch RLS geschuetzt, aber genau deshalb braucht
 * dieser eine Zugriff den Umweg — er ist die Stelle, an der der Mandant
 * ueberhaupt erst bestimmt wird.
 */

interface BenutzerZeile {
  name: string;
  mandant_id: string;
  rolle: Rolle;
  passwort_hash: string | null;
}

export async function anmelden(
  name: string,
  passwort: string,
  mandantId?: string,
): Promise<Sitzung | null> {
  // anmelde_daten ist eine SECURITY-DEFINER-Funktion (db/013): Sie sieht
  // als Einzige an der Mandantentrennung vorbei und gibt genau die Zeile zu
  // genau diesem Namen heraus. Eine gewoehnliche Abfrage auf benutzer liefert
  // hier nichts, weil noch kein Mandant gesetzt ist -- und genau das ist der
  // Grund, warum es diese Funktion gibt.
  const r = await pool.query<BenutzerZeile>(
    `SELECT name, mandant_id, rolle, passwort_hash FROM anmelde_daten($1)
      WHERE $2::uuid IS NULL OR mandant_id = $2::uuid`,
    [name.trim(), mandantId ?? null],
  );

  // Kein Treffer oder mehrdeutig: trotzdem rechnen, damit die Antwortzeit
  // nichts verraet.
  if (r.rows.length !== 1 || !r.rows[0].passwort_hash) {
    scryptSync(passwort, "platzhalter", 64);
    return null;
  }

  const z = r.rows[0];
  const hash = z.passwort_hash;
  if (!hash || !pruefePasswort(passwort, hash)) return null;

  await pool
    .query(`SELECT anmeldung_vermerken($1, $2)`, [z.name, z.mandant_id])
    .catch(() => {});

  // Beim Anmelden sind aktiver Mandant und Heimatmandant dasselbe. Der
  // Wert wird ausdruecklich gesetzt und nicht dem Rueckfall in
  // pruefeSitzung ueberlassen: Spaeter entscheidet er, von wo aus
  // geprueft wird, welche Mandanten offenstehen.
  return {
    name: z.name,
    mandant: z.mandant_id,
    rolle: z.rolle,
    heimat: z.mandant_id,
  };
}

/** Wer ist angemeldet? null, wenn niemand. */
export async function angemeldeteSitzung(): Promise<Sitzung | null> {
  const laden = await cookies();
  return pruefeSitzung(laden.get(COOKIE)?.value);
}

/** Nur der Name — fuer die Kopfzeile. */
export async function angemeldeterBenutzer(): Promise<string | null> {
  return (await angemeldeteSitzung())?.name ?? null;
}

/**
 * Der Mandant aus dem Sitzungscookie. db.ts ruft das auf, wenn kein
 * ausdruecklicher Kontext gesetzt ist.
 */
export async function mandantAusSitzung(): Promise<string | null> {
  return (await angemeldeteSitzung())?.mandant ?? null;
}

export { baueSitzung, hashe, pruefeSitzung, COOKIE_NAME, COOKIE_MAXALTER } from "./sitzung";
export type { Rolle, Sitzung } from "./sitzung";
