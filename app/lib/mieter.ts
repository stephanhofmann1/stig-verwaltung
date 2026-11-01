import { createHash, randomBytes } from "node:crypto";
import { pool } from "./db";

/**
 * Mieterbereich.
 *
 * Mieter melden sich mit einem Einmallink an, der an die im Mietvertrag
 * hinterlegte Adresse geht. Kein Passwort: Niemand verwaltet Passwoerter
 * fuer Zugaenge, die dreimal im Jahr benutzt werden -- was dabei herauskommt,
 * sind Zettel am Kuehlschrank.
 *
 * Alles hier laeuft ueber die Funktionen aus db/015. Der Grund steht dort
 * ausfuehrlich; kurz: Row Level Security trennt Vermieter voneinander, nicht
 * Mieter untereinander. Die Funktionen nehmen jeweils ein Mietverhaeltnis
 * und geben nichts anderes heraus -- an ihnen vorbei gibt es keinen Weg,
 * den der Anwendungscode versehentlich nehmen koennte.
 */

/** Gueltigkeit eines Links. Kurz genug, dass eine vergessene Mail nichts wert ist. */
const MINUTEN = 60;

export interface MieterSitzungsdaten {
  mandant_id: string;
  mietverhaeltnis_id: string;
  anzeigename: string;
}

/** Im Link steht der Token, in der Datenbank nur sein Hash. */
function hashe(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Fordert einen Zugang an.
 *
 * Gibt den Link-Token zurueck, wenn es zu der Adresse ein laufendes
 * Mietverhaeltnis gibt, sonst null. Die aufrufende Schicht antwortet in
 * beiden Faellen gleich -- sonst liesse sich ueber dieses Formular
 * herausfinden, wer wo wohnt.
 */
export async function fordereZugangAn(
  email: string,
): Promise<{ token: string; daten: MieterSitzungsdaten } | null> {
  const token = randomBytes(32).toString("base64url");

  const r = await pool.query<MieterSitzungsdaten>(
    `SELECT mandant_id, mietverhaeltnis_id, anzeigename
       FROM mieter_zugang_anfordern($1, $2, $3)`,
    [email, hashe(token), MINUTEN],
  );

  if (r.rows.length === 0) return null;
  return { token, daten: r.rows[0] };
}

/** Loest einen Link ein. Genau einmal; danach ist er verbraucht. */
export async function loeseZugangEin(
  token: string,
): Promise<MieterSitzungsdaten | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const r = await pool.query<MieterSitzungsdaten>(
    `SELECT mandant_id, mietverhaeltnis_id, anzeigename
       FROM mieter_zugang_einloesen($1)`,
    [hashe(token)],
  );
  return r.rows[0] ?? null;
}

export interface Uebersicht {
  anzeigename: string;
  objekt: string;
  strasse: string;
  plz: string;
  ort: string;
  einheit: string;
  etage: string | null;
  beginn: string;
  kaltmiete: string | null;
  nebenkosten: string | null;
  /**
   * Moeblierungszuschlag und Gesamtmiete.
   *
   * Die Funktion mieter_uebersicht liefert beides seit Migration 019; hier
   * wurden sie bis zum 01.11.2026 nicht gelesen. Folge: Bei den 22 von 37
   * Mietverhaeltnissen mit Inklusivmiete ist kaltmiete NULL, und der Mieter
   * sah in seinem Bereich "Kaltmiete —" und "Nebenkosten —" statt seiner
   * Miete. Wer seine eigene Miete nicht sehen kann, haelt den Bereich fuer
   * kaputt -- zu Recht.
   */
  moeblierung: string | null;
  gesamtmiete: string | null;
}

export async function uebersicht(mv: string): Promise<Uebersicht | null> {
  const r = await pool.query<Uebersicht>(
    `SELECT anzeigename, objekt, strasse, plz, ort, einheit, etage,
            beginn::text, kaltmiete::text, nebenkosten::text,
            moeblierung::text, gesamtmiete::text
       FROM mieter_uebersicht($1)`,
    [mv],
  );
  return r.rows[0] ?? null;
}

export interface MieterVorgang {
  referenz: string;
  betreff: string;
  status: string;
  geaendert_am: string;
}

export async function vorgaenge(mv: string): Promise<MieterVorgang[]> {
  const r = await pool.query<MieterVorgang>(
    `SELECT referenz, betreff, status, geaendert_am::text
       FROM mieter_vorgaenge($1)`,
    [mv],
  );
  return r.rows;
}

/** Die E-Mail-Adresse zu einem Mietverhaeltnis — fuer den Absender der Meldung. */
export async function emailZuMietverhaeltnis(
  mv: string,
): Promise<{ email: string; anzeigename: string } | null> {
  const r = await pool.query<{ email: string; anzeigename: string }>(
    `SELECT email, anzeigename FROM mieter_email($1)`,
    [mv],
  );
  return r.rows[0] ?? null;
}

/**
 * Wie die Miete im Mieterbereich dargestellt wird.
 *
 * Reine Funktion, weil hier der Fehler sass: 22 der 37 Mietverhaeltnisse
 * haben keine getrennte Kaltmiete, sondern nur eine Gesamtmiete. Die Seite
 * las bis zum 01.11.2026 nur kaltmiete und nebenkosten -- diese Mieter
 * sahen "Kaltmiete —" und "Nebenkosten —" statt ihrer Miete.
 *
 * Die Unterscheidung gehoert nicht in die Seite: Dort liesse sie sich nur
 * mit laufender Datenbank pruefen, und genau deshalb ist sie ein Jahr lang
 * niemandem aufgefallen.
 */
export interface MietAnzeige {
  /** true = ein Betrag, alles inklusive. */
  inklusiv: boolean;
  /** Was unter "Zusammen" bzw. "Miete" steht. null = nichts hinterlegt. */
  summe: number | null;
  posten: Array<{ bezeichnung: string; betrag: number }>;
}

export function mietAnzeige(d: {
  kaltmiete: string | null;
  nebenkosten: string | null;
  moeblierung: string | null;
  gesamtmiete: string | null;
}): MietAnzeige {
  const z = (w: string | null) => {
    const n = Number(w);
    return w !== null && w !== "" && Number.isFinite(n) ? n : null;
  };
  const kalt = z(d.kaltmiete);
  const nk = z(d.nebenkosten);
  const moebl = z(d.moeblierung);
  const gesamt = z(d.gesamtmiete);

  // Inklusiv heisst: Es gibt eine Gesamtmiete, aber keine Kaltmiete, aus
  // der man die Posten aufschluesseln koennte.
  if (kalt === null && gesamt !== null && gesamt > 0) {
    return { inklusiv: true, summe: gesamt, posten: [] };
  }

  const posten: Array<{ bezeichnung: string; betrag: number }> = [];
  if (kalt !== null) posten.push({ bezeichnung: "Kaltmiete", betrag: kalt });
  if (nk !== null) posten.push({ bezeichnung: "Nebenkosten", betrag: nk });
  // Nur wenn es ihn wirklich gibt: Eine Zeile "Moeblierungszuschlag 0,00 EUR"
  // laesst einen unmoeblierten Mieter glauben, er zahle dafuer.
  if (moebl !== null && moebl > 0)
    posten.push({ bezeichnung: "Möblierungszuschlag", betrag: moebl });

  // Die Gesamtmiete hat Vorrang, wenn sie da ist: Sie ist der Betrag, der
  // im Vertrag steht, und die Summe der Posten kann davon abweichen.
  const summe =
    gesamt !== null && gesamt > 0
      ? gesamt
      : posten.length > 0
        ? Math.round(posten.reduce((s, p) => s + p.betrag, 0) * 100) / 100
        : null;

  return { inklusiv: false, summe, posten };
}

// ---------------------------------------------------------------------------
// "Ist meine Miete angekommen?"
// ---------------------------------------------------------------------------

/**
 * Der Zahlungsstand der letzten Monate, wie der Mieter ihn sehen soll.
 *
 * Die wichtigste Regel steht hier und nicht in der Seite: Ein Monat, fuer
 * den es keine Kontodaten gibt, wird **nie** als offen gezeigt. Er heisst
 * "noch nicht abgeglichen".
 *
 * Der Unterschied ist nicht sprachlich. Fuer die Welserstrasse wird ab
 * Januar 2024 abgerechnet, das Konto gibt es erst ab Dezember 2024 -- elf
 * Monate stehen ohne Zahlung in der Datenbank, obwohl niemand etwas
 * schuldet. Wuerde der Mieterbereich das als "offen" zeigen, bekaeme ein
 * Mieter seit 2007 die Nachricht, er haette elf Monatsmieten Schulden. Das
 * ist keine Information, das ist eine Beschuldigung, und sie waere falsch.
 *
 * Dasselbe gilt, solange der Abgleich nicht laeuft: Ohne eingelesene
 * Kontoumsaetze ist JEDER Monat unabgeglichen, nicht offen.
 */
export type ZahlStatus =
  | "bezahlt"
  | "teilweise"
  | "offen"
  | "nicht_faellig"
  | "nicht_abgeglichen";

export interface MonatsStand {
  /** Erster des Monats, ISO. */
  monat: string;
  soll: number;
  gezahlt: number;
  status: ZahlStatus;
  /** Tag der letzten zugeordneten Zahlung, falls es eine gibt. */
  gezahlt_am: string | null;
}

export interface StandZeile {
  monat: string;
  soll: string;
  gezahlt: string | null;
  gezahlt_am: string | null;
  ohne_zahlungsdaten: boolean;
}

/**
 * Leitet den Status eines Monats ab. Reine Funktion.
 *
 * Reihenfolge der Pruefungen ist die Logik:
 *   1. gedeckt           -> bezahlt
 *   2. keine Kontodaten  -> nicht_abgeglichen
 *   3. noch nicht faellig -> nicht_faellig
 *   4. teilweise         -> teilweise
 *   5. sonst             -> offen
 *
 * Schritt 1 steht vor Schritt 2, weil eine zugeordnete Zahlung eine
 * Tatsache ist: Ist der Monat gedeckt, hilft "noch nicht abgeglichen"
 * niemandem -- es verschweigt eine Zahlung, die belegt ist.
 *
 * Schritt 2 steht vor 3, 4 und 5, und das ist der Teil, auf den es
 * ankommt. Fehlen Kontodaten, sagt das Ausbleiben einer Zahlung NICHTS:
 *   als "offen"     waere es eine falsche Beschuldigung,
 *   als "teilweise" eine falsche Zahl ("400 von 630" heisst, 230 fehlen),
 *   als "nicht faellig" eine Beruhigung, die nicht traegt.
 * Ein Test, der nur den Fall ohne jede Zahlung prueft, faellt darauf nicht
 * herein -- dort kommt zufaellig dasselbe heraus. Erst ein Monat mit
 * Teilzahlung und ohne Kontodaten zeigt den Unterschied; genau diese Luecke
 * hat ein Mutationstest am 01.11.2026 aufgedeckt.
 */
export function monatsStatus(
  z: StandZeile,
  faelligAm: Date,
  heute: Date,
): MonatsStand {
  const soll = Number(z.soll);
  const gezahlt = Number(z.gezahlt ?? 0);
  const rest = Math.round((soll - gezahlt) * 100) / 100;

  const stand = {
    monat: z.monat,
    soll,
    gezahlt,
    gezahlt_am: z.gezahlt_am,
  };

  // Unter einem Euro ist Rundung aus anteiligen Monaten, nicht Rueckstand.
  // Steht vor der Deckungspruefung: eine zugeordnete Zahlung ist eine
  // Tatsache und wird nicht hinter "noch nicht abgeglichen" versteckt.
  if (rest < 1) return { ...stand, status: "bezahlt" };
  if (z.ohne_zahlungsdaten) {
    return { ...stand, status: "nicht_abgeglichen" };
  }
  if (heute < faelligAm) return { ...stand, status: "nicht_faellig" };
  if (gezahlt > 0) return { ...stand, status: "teilweise" };
  return { ...stand, status: "offen" };
}

/**
 * Die letzten Monate eines Mietverhaeltnisses mit Zahlungsstand.
 *
 * Nur das eigene Mietverhaeltnis -- die Kennung kommt vom Aufrufer aus der
 * Sitzung, niemals aus einer Adresse.
 */
export async function zahlungsstand(
  mv: string,
  monate = 6,
  heute = new Date(),
): Promise<MonatsStand[]> {
  const { query } = await import("./db");
  const { dritterWerktag } = await import("./mahnstufen");

  const zeilen = await query<StandZeile>(
    `SELECT s.monat::text,
            s.betrag::text                      AS soll,
            z.gezahlt::text                     AS gezahlt,
            z.letzte::text                      AS gezahlt_am,
            (o.zahlungsdaten_ab IS NULL
             OR s.monat < date_trunc('month', o.zahlungsdaten_ab)::date
             OR NOT EXISTS (SELECT 1 FROM buchung)) AS ohne_zahlungsdaten
       FROM sollstellung s
       JOIN mietverhaeltnis mv ON mv.id = s.mietverhaeltnis_id
       JOIN einheit e ON e.id = mv.einheit_id
       JOIN objekt  o ON o.id = e.objekt_id
       LEFT JOIN (
             SELECT zz.sollstellung_id,
                    SUM(zz.betrag)   AS gezahlt,
                    MAX(b.buchungstag) AS letzte
               FROM zuordnung zz
               JOIN buchung b ON b.id = zz.buchung_id
              GROUP BY zz.sollstellung_id
       ) z ON z.sollstellung_id = s.id
      WHERE s.mietverhaeltnis_id = $1
      ORDER BY s.monat DESC
      LIMIT $2`,
    [mv, monate],
  );

  return zeilen.map((z) => {
    const [j, m] = z.monat.split("-").map(Number);
    return monatsStatus(z, dritterWerktag(j, m), heute);
  });
}
