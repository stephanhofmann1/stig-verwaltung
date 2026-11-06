import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Bestandspruefung der festgeschriebenen Zuordnungen.
 *
 * WOFÜR
 *
 * Der selbsttätige Abgleich schreibt fest, was er für sicher hält. Wenn
 * eine seiner Regeln zu weit greift, liegt das Ergebnis danach in den
 * Büchern und sieht aus wie erledigte Arbeit. Genau das ist am
 * 06.11.2026 zweimal passiert: Ein Beleg hing an vier Abbuchungen, und
 * eine Quittung vom 17. März war einer Abbuchung vom 14. Januar
 * zugeschlagen.
 *
 * Beide Fehler sind in den Regeln behoben (lib/belegabgleich.ts). Aber
 * eine behobene Regel räumt nicht auf, was sie vorher angerichtet hat.
 * Diese Prüfung sieht den ganzen Bestand an und nennt jede Zuordnung,
 * die den heutigen Regeln widerspricht -- nach einer Regeländerung,
 * nach einer Einlieferung, oder einfach, weil jemand wissen will, ob
 * die Bücher stimmen.
 *
 * SIE ÄNDERT NICHTS
 *
 * Nur lesen. Was zu tun ist, entscheidet ein Mensch über "Lösen" in der
 * Zuordnungsliste. Eine Prüfung, die selbst aufräumt, nimmt einem die
 * Möglichkeit, ihr zu widersprechen.
 */

const VORLAUF_TAGE = 2;
const NACHLAUF_TAGE = 45;

export async function GET() {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }

  // 1. Ein Beleg an mehreren Buchungen.
  //
  // Eine Rechnung kann in Raten bezahlt werden -- dann ist das richtig.
  // Gemeldet wird deshalb nur der Fall, dass die Summe der Zuordnungen
  // den Bruttobetrag übersteigt, oder dass der Betrag unbekannt ist und
  // damit nichts dagegen spricht, dass hier doppelt gebucht wurde.
  const mehrfach = await query(`
    SELECT bg.id, bg.dateiname, bg.aussteller, bg.belegdatum::text,
           bg.betrag_brutto::text,
           count(*)::text AS zuordnungen,
           sum(bb.betrag)::text AS zugeordnet,
           json_agg(json_build_object(
             'zuordnung_id', bb.id,
             'buchungstag', b.buchungstag::text,
             'betrag', bb.betrag::text,
             'sicherheit', bb.sicherheit
           ) ORDER BY b.buchungstag) AS buchungen
      FROM belegbuchung bb
      JOIN beleg bg ON bg.id = bb.beleg_id
      JOIN buchung b ON b.id = bb.buchung_id
     GROUP BY bg.id, bg.dateiname, bg.aussteller, bg.belegdatum, bg.betrag_brutto
    HAVING count(*) > 1
       AND (bg.betrag_brutto IS NULL
            OR sum(bb.betrag) > abs(bg.betrag_brutto) + 0.005)
     ORDER BY count(*) DESC, bg.belegdatum DESC NULLS LAST
  `);

  // 2. Zuordnungen ausserhalb des Zeitfensters.
  //
  // Die Regeln 0 und 1 treffen über eine Kennung, die in der Abbuchung
  // steht; dort ist das Datum gleichgültig. Erkennbar sind sie an der
  // Begründung, die die Nummer nennt.
  const ausserZeit = await query(
    `
    SELECT bb.id AS zuordnung_id, bg.id AS beleg_id, bg.dateiname,
           bg.aussteller, bg.belegdatum::text, b.buchungstag::text,
           bb.betrag::text, bb.sicherheit, bb.begruendung,
           (b.buchungstag - bg.belegdatum)::text AS tage
      FROM belegbuchung bb
      JOIN beleg bg ON bg.id = bb.beleg_id
      JOIN buchung b ON b.id = bb.buchung_id
     WHERE bg.belegdatum IS NOT NULL
       AND (b.buchungstag - bg.belegdatum < -$1
            OR b.buchungstag - bg.belegdatum > $2)
       AND bb.begruendung NOT LIKE '%steht im Verwendungszweck%'
     ORDER BY abs(b.buchungstag - bg.belegdatum) DESC
  `,
    [VORLAUF_TAGE, NACHLAUF_TAGE],
  );

  // 3. Mehr zugeordnet als der Beleg hergibt.
  const ueberzogen = await query(`
    SELECT bg.id, bg.dateiname, bg.aussteller, bg.betrag_brutto::text,
           sum(bb.betrag)::text AS zugeordnet
      FROM belegbuchung bb
      JOIN beleg bg ON bg.id = bb.beleg_id
     WHERE bg.betrag_brutto IS NOT NULL
     GROUP BY bg.id, bg.dateiname, bg.aussteller, bg.betrag_brutto
    HAVING sum(bb.betrag) > abs(bg.betrag_brutto) + 0.005
     ORDER BY sum(bb.betrag) - abs(bg.betrag_brutto) DESC
  `);

  const [{ gesamt }] = await query<{ gesamt: string }>(
    `SELECT count(*)::text AS gesamt FROM belegbuchung`,
  );

  return NextResponse.json({
    geprueft: Number(gesamt),
    fenster: { vorlauf_tage: VORLAUF_TAGE, nachlauf_tage: NACHLAUF_TAGE },
    mehrfach_genutzt: mehrfach,
    ausserhalb_zeitfenster: ausserZeit,
    ueberzogen,
    sauber:
      mehrfach.length === 0 &&
      ausserZeit.length === 0 &&
      ueberzogen.length === 0,
  });
}
