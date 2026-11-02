import { query } from "./db";

/**
 * Die Sperre vor dem Mahnwesen.
 *
 * Stephan hat am 01.11.2026 festgelegt: Das Mahnwesen geht erst auf sein Go
 * live, und vorher muss der Abgleich sauber sein. Diese Datei macht daraus
 * eine Sperre statt einer Absprache -- eine Absprache hilft nicht gegen
 * einen nächtlichen Lauf, der sie nicht kennt.
 *
 * Zwei Dinge stehen hier:
 *   verlangeFreigabe()   die Sperre selbst. Jede Stelle, die ein Schreiben
 *                        erzeugt oder versendet, muss sie aufrufen.
 *   mahnbereitschaft()   was noch fehlt, bis ein Go vertretbar ist.
 */

export interface Freigabe {
  freigegeben_am: string;
  freigegeben_von: string;
  notiz: string | null;
}

/**
 * Ist das Mahnwesen für den aktuellen Mandanten freigegeben?
 *
 * Fehlt die Tabelle -- weil Migration 024 noch nicht gelaufen ist --, gilt
 * das als **nicht freigegeben**. Die Richtung ist wichtig: Ein Fehler beim
 * Nachsehen darf nicht dazu führen, dass gemahnt wird. Lieber eine Woche
 * lang kein Schreiben als ein falsches.
 */
export async function freigabe(): Promise<Freigabe | null> {
  try {
    const z = await query<Freigabe>(`
      SELECT freigegeben_am::text, freigegeben_von, notiz
        FROM mahnwesen_freigabe
       LIMIT 1
    `);
    return z[0] ?? null;
  } catch {
    return null;
  }
}

/** Die Fehlermeldung, wenn ohne Freigabe gemahnt werden soll. */
export class NichtFreigegeben extends Error {
  constructor() {
    super(
      "Das Mahnwesen ist für diesen Mandanten nicht freigegeben. Es wird " +
        "kein Schreiben erzeugt. Die Freigabe erteilt der Eigent\u00fcmer, " +
        "wenn der " +
        "Zahlungsabgleich vollständig ist.",
    );
    this.name = "NichtFreigegeben";
  }
}

/**
 * Die Sperre. Wirft, wenn keine Freigabe vorliegt.
 *
 * Absichtlich eine Ausnahme und kein `false`: Ein Rückgabewert lässt sich
 * übersehen, eine Ausnahme nicht. Wer eine Mahnung erzeugt und das Prüfen
 * vergisst, bekommt keinen stillen Fehler, sondern einen lauten.
 */
export async function verlangeFreigabe(): Promise<Freigabe> {
  const f = await freigabe();
  if (f === null) throw new NichtFreigegeben();
  return f;
}

export interface Befund {
  /** Kurz, für die Liste. */
  punkt: string;
  /** true = in Ordnung. */
  erfuellt: boolean;
  /** Was dahintersteckt, ein Satz. */
  erklaerung: string;
}

export interface Bereitschaft {
  freigabe: Freigabe | null;
  befunde: Befund[];
  /** Alle Befunde erfüllt? Dann wäre ein Go vertretbar. */
  bereit: boolean;
}

/**
 * Was noch fehlt, bis das Mahnwesen freigegeben werden kann.
 *
 * Das ist keine Formalität. Jeder einzelne Punkt hier ist ein Weg, auf dem
 * ein pünktlicher Zahler als Säumiger erscheint:
 *
 *   keine Kontoumsätze       -> jede gestellte Miete sieht unbezahlt aus
 *   unzugeordnete Eingänge   -> das Geld ist da, zählt aber nicht
 *   Abgleich veraltet        -> die letzten Wochen fehlen
 *   Miete nicht belegt       -> keine Schwelle, siehe mahnstufen.ts
 *   Deckungsgrenze fehlt     -> es wird über Monate gemahnt, zu denen es
 *                               keine Auszüge gibt
 *
 * Deshalb steht die Liste auf derselben Seite wie die Rückstände: Wer
 * freigibt, soll beides zugleich sehen.
 */
export async function mahnbereitschaft(): Promise<Bereitschaft> {
  const f = await freigabe();
  const befunde: Befund[] = [];

  const eine = async <T>(sql: string, standard: T): Promise<T> => {
    try {
      const z = await query<Record<string, unknown>>(sql);
      const v = z[0] ? Object.values(z[0])[0] : null;
      return (v ?? standard) as T;
    } catch {
      return standard;
    }
  };

  // 1. Gibt es überhaupt Kontoumsätze?
  const buchungen = Number(await eine("SELECT count(*) FROM buchung", 0));
  befunde.push({
    punkt: "Kontoumsätze importiert",
    erfuellt: buchungen > 0,
    erklaerung:
      buchungen > 0
        ? `${buchungen} Buchungen in der Datenbank.`
        : "Noch keine. Ohne Kontoumsätze sieht jede gestellte Miete " +
          "unbezahlt aus — hier darf auf keinen Fall gemahnt werden.",
  });

  // 2. Wie aktuell ist der Bestand?
  const neuester = await eine<string | null>(
    "SELECT max(buchungstag)::text FROM buchung",
    null,
  );
  const tageAlt =
    neuester === null
      ? null
      : Math.floor(
          (Date.now() - new Date(neuester + "T12:00:00Z").getTime()) /
            86_400_000,
        );
  befunde.push({
    punkt: "Abgleich aktuell",
    erfuellt: tageAlt !== null && tageAlt <= 14,
    erklaerung:
      tageAlt === null
        ? "Kein Buchungstag vorhanden."
        : `Jüngste Buchung ${neuester}, also ${tageAlt} Tage alt.` +
          (tageAlt > 14
            ? " Fehlen die letzten Wochen, erscheinen die Zahlungen daraus" +
              " als Rückstand."
            : ""),
  });

  // 3. Eingänge, die keiner Sollstellung zugeordnet sind.
  //
  // Der wichtigste Punkt der Liste. Ein unzugeordneter Eingang ist genau
  // der Fall, in dem das Geld da ist und das Mahnwesen es nicht sieht.
  const offeneEingaenge = Number(
    await eine(
      `SELECT count(*) FROM buchung b
        WHERE b.betrag > 0
          AND NOT EXISTS (SELECT 1 FROM zuordnung z WHERE z.buchung_id = b.id)`,
      0,
    ),
  );
  befunde.push({
    punkt: "Keine unzugeordneten Zahlungseingänge",
    erfuellt: buchungen > 0 && offeneEingaenge === 0,
    erklaerung:
      offeneEingaenge === 0
        ? buchungen > 0
          ? "Jeder Eingang ist einer Sollstellung zugeordnet."
          : "Nichts zu prüfen, solange keine Umsätze da sind."
        : `${offeneEingaenge} Eingänge ohne Zuordnung. Jeder einzelne kann ` +
          "eine Miete sein, die dann als Rückstand gilt.",
  });

  // 3b. Konten ohne Objektzuordnung.
  //
  // Am 01.11.2026 im Durchstich aufgefallen: Ist `konto.objekt_id` leer,
  // vergleicht der Abgleich jede Zahlung mit den offenen Sollstellungen
  // ALLER Objekte. Trifft dann mehr als ein Mietverhältnis, landet die
  // Zahlung in der Prüfung statt in der Zuordnung -- und bleibt dort, bis
  // jemand sie von Hand bestätigt. Bei zwei Jahren Kontohistorie ist das
  // der Unterschied zwischen einem Abend Arbeit und einem Monat.
  const kontenOhneObjekt = await eine<string | null>(
    `SELECT string_agg(bezeichnung, ', ' ORDER BY bezeichnung)
       FROM konto WHERE objekt_id IS NULL AND art = 'bank'`,
    null,
  );
  befunde.push({
    punkt: "Jedes Konto gehört einem Objekt",
    erfuellt: kontenOhneObjekt === null,
    erklaerung:
      kontenOhneObjekt === null
        ? "Alle Bankkonten sind einem Objekt zugeordnet."
        : `Ohne Objekt: ${kontenOhneObjekt}. Zahlungen von diesen Konten ` +
          "werden mit den Sollstellungen aller Objekte verglichen und " +
          "landen deshalb meist in der Prüfung.",
  });

  // 4. Mietverhältnisse, bei denen die Monatsmiete nicht belegt ist.
  const ohneMiete = Number(
    await eine(
      `SELECT count(*) FROM mietverhaeltnis mv
        WHERE COALESCE(to_jsonb(mv) ->> 'status', 'aktiv') IN ('aktiv','gekuendigt')
          AND COALESCE(
                (to_jsonb(mv) ->> 'gesamtmiete')::numeric,
                NULLIF(COALESCE(mv.kaltmiete,0) + COALESCE(mv.nebenkosten,0), 0)
              ) IS NULL`,
      0,
    ),
  );
  befunde.push({
    punkt: "Monatsmiete überall belegt",
    erfuellt: ohneMiete === 0,
    erklaerung:
      ohneMiete === 0
        ? "Für jedes laufende Mietverhältnis ist ein Betrag hinterlegt."
        : `${ohneMiete} Mietverhältnisse ohne hinterlegte Miete. Dort gibt ` +
          "es keine Schwelle; sie werden deshalb bewusst nicht gemahnt.",
  });

  // 5. Deckungsgrenze je Objekt.
  const ohneGrenze = await eine<string | null>(
    `SELECT string_agg(name, ', ' ORDER BY name) FROM objekt
      WHERE zahlungsdaten_ab IS NULL
        AND EXISTS (
          SELECT 1 FROM einheit e
            JOIN mietverhaeltnis mv ON mv.einheit_id = e.id
           WHERE e.objekt_id = objekt.id)`,
    null,
  );
  befunde.push({
    punkt: "Für jedes Objekt ist der Beginn der Kontodaten gepflegt",
    erfuellt: ohneGrenze === null,
    erklaerung:
      ohneGrenze === null
        ? "Überall gesetzt."
        : `Fehlt bei: ${ohneGrenze}. Dort wird nicht gemahnt — richtig, ` +
          "solange es kein Konto gibt, aber es bleibt zu klären.",
  });

  return { freigabe: f, befunde, bereit: befunde.every((b) => b.erfuellt) };
}
