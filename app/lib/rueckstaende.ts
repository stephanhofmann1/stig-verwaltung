import { query } from "./db";
import { rueckstaende, type OffenerPosten, type Rueckstand } from "./mahnstufen";

/**
 * Holt die offenen Posten aus der Datenbank und bildet daraus die
 * Mahnstufen.
 *
 * Die Rechnerei steckt absichtlich nicht hier, sondern in mahnstufen.ts:
 * Diese Datei darf nur lesen und zusammenstellen. Was dazu führt, dass
 * jemand Post bekommt, gehört in eine Funktion ohne Datenbank, weil nur die
 * sich in jeder Verzweigung testen lässt.
 */

/** Was die laufende Monatsmiete ist -- der Maßstab für die Schwelle. */
async function monatsmieten(): Promise<Map<string, number>> {
  const zeilen = await query<{ mietverhaeltnis_id: string; betrag: string }>(`
    SELECT mv.id AS mietverhaeltnis_id,
           COALESCE(
             -- Erst die jüngste Anpassung, die heute schon gilt ...
             (SELECT COALESCE(a.gesamtmiete,
                              COALESCE(a.kaltmiete, 0)
                            + COALESCE(a.nebenkosten, 0)
                            + COALESCE(a.moeblierungszuschlag, 0))
                FROM mietanpassung a
               WHERE a.mietverhaeltnis_id = mv.id
                 AND a.gilt_ab <= date_trunc('month', CURRENT_DATE)::date
               ORDER BY a.gilt_ab DESC
               LIMIT 1),
             -- ... dann die Werte am Mietverhältnis selbst.
             (to_jsonb(mv) ->> 'gesamtmiete')::numeric,
             COALESCE(mv.kaltmiete, 0)
           + COALESCE(mv.nebenkosten, 0)
           + COALESCE((to_jsonb(mv) ->> 'moeblierungszuschlag')::numeric, 0)
           )::text AS betrag
      FROM mietverhaeltnis mv
  `);
  const m = new Map<string, number>();
  for (const z of zeilen) {
    const n = Number(z.betrag);
    // Nur echte Beträge. Eine 0 würde in mahnstufen.ts die Notbremse
    // ziehen, und genau das ist gewollt, wenn die Miete nicht belegt ist.
    if (Number.isFinite(n) && n > 0) m.set(z.mietverhaeltnis_id, n);
  }
  return m;
}

/**
 * Alle offenen Posten, je Monat, mit dem Deckungsflag.
 *
 * `ohne_zahlungsdaten` ist der wichtige Teil: Die Spalte
 * `objekt.zahlungsdaten_ab` (db/023) sagt, ab wann Kontoumsätze überhaupt
 * vorliegen. Ist sie NULL -- Augartenstraße 91, dort gibt es kein
 * STIG-Konto --, dann gilt das Flag für jeden Monat, und es wird für dieses
 * Objekt nicht gemahnt.
 *
 * `IS NOT TRUE` statt `= false`, weil der Vergleich mit NULL NULL ergibt
 * und die Zeile dann aus dem Ergebnis fiele -- es wäre also genau der
 * ungedeckte Fall, der verschwindet.
 */
async function offenePosten(): Promise<OffenerPosten[]> {
  return query<OffenerPosten>(`
    SELECT s.mietverhaeltnis_id,
           k.anzeigename                AS kontakt_name,
           COALESCE(e.schluessel, e.bezeichnung) AS einheit,
           s.monat::text                AS monat,
           s.betrag::float8             AS soll,
           COALESCE(z.gezahlt, 0)::float8 AS gezahlt,
           (o.zahlungsdaten_ab IS NULL
            OR s.monat < date_trunc('month', o.zahlungsdaten_ab)::date)
                                        AS ohne_zahlungsdaten
      FROM sollstellung s
      JOIN mietverhaeltnis mv ON mv.id = s.mietverhaeltnis_id
      JOIN einheit e          ON e.id  = mv.einheit_id
      JOIN objekt o           ON o.id  = e.objekt_id
      JOIN kontakt k          ON k.id  = mv.kontakt_id
      LEFT JOIN (
            SELECT sollstellung_id, SUM(betrag) AS gezahlt
              FROM zuordnung
             GROUP BY sollstellung_id
      ) z ON z.sollstellung_id = s.id
     WHERE s.betrag > 0
     ORDER BY k.anzeigename, s.monat
  `);
}

/**
 * Der Stand des Mahnwesens. Reine Lesefunktion -- sie verschickt nichts und
 * schreibt nichts. Versendet wird nur über die Freigabe.
 */
/**
 * Die höchste Monatsmiete im Bestand.
 *
 * Dient als Grenze, oberhalb derer ein Zahlungseingang keine einzelne
 * Monatsmiete sein KANN -- bei STIG sind das die Darlehensauszahlung und
 * die Gesellschaftereinlagen. Die Grenze ist damit nicht geraten, sondern
 * aus den Verträgen abgeleitet, und sie wächst mit ihnen.
 *
 * Bewusst hier und nicht im Cockpit: Sie benutzt dieselbe Mietformel wie
 * alles andere (monatsmieten), und die soll es nur einmal geben.
 */
export async function hoechsteMonatsmiete(): Promise<number> {
  const mieten = await monatsmieten();
  let hoch = 0;
  for (const m of mieten.values()) if (m > hoch) hoch = m;
  return hoch;
}

export async function mahnstand(heute = new Date()): Promise<Rueckstand[]> {
  const [posten, mieten] = await Promise.all([offenePosten(), monatsmieten()]);
  return rueckstaende(posten, mieten, heute);
}
