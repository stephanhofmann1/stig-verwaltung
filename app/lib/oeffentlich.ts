import { query } from "./db";

/**
 * Was die Objektwebsite von der Plattform bekommt.
 *
 * Bisher stand die Verfuegbarkeit im Quelltext der Website und wurde von Hand
 * gepflegt. Die Plattform weiss es besser: Sie kennt die Mietverhaeltnisse und
 * kann ableiten, was frei ist. Zwei Stellen zu pflegen ist die Stelle, an der
 * so etwas immer auseinanderlaeuft.
 *
 * Grundregel fuer alles in dieser Datei: **Nie ein personenbezogenes Feld.**
 * Diese Antworten sind ohne Anmeldung abrufbar. Wer hier wohnt, geht
 * niemanden etwas an; dass ein Zimmer ab Dezember frei wird, schon.
 *
 * Zweite Grundregel: **Die Beweislast liegt beim Leerstand.** Aus fehlenden
 * Daten entsteht nie "frei". Der umgekehrte Vorgabewert hat im September 2026
 * vermietete Zimmer oeffentlich als frei angeboten; der Preis dafuer ist eine
 * Absage an einen Interessenten, dem schon zugesagt war. Lieber ein freies
 * Zimmer nicht bewerben als ein bewohntes anbieten.
 */

export type Verfuegbarkeit = "frei" | "bald" | "belegt";

export interface OeffentlicheEinheit {
  objekt: string;
  einheit: string;
  /**
   * Die Wohnung, zu der dieses Zimmer gehoert -- bei einer WG der Name der
   * Etage, sonst der eigene. Danach gruppiert die Website die Karten.
   */
  gruppe: string;
  etage: string | null;
  art: string;
  flaeche_qm: number | null;
  kaltmiete: number | null;
  nebenkosten: number | null;
  status: Verfuegbarkeit;
  /** Nur bei "bald" und nur wenn der Termin feststeht. Sonst null. */
  frei_ab: string | null;
  /**
   * Satz im Klartext, wenn der Termin unter Vorbehalt steht oder es keinen
   * gibt ("Einzug nach Absprache", "der Umbau laeuft noch"). Die
   * Lead-Automation uebernimmt ihn woertlich in Anschreiben, deshalb gehoert
   * er in diese Antwort und nicht in die Website.
   */
  hinweis: string | null;
}

export interface Zeile {
  objekt: string;
  einheit: string;
  gruppe: string;
  etage: string | null;
  art: string;
  flaeche_qm: string | null;
  angebot_kaltmiete: string | null;
  angebot_nebenkosten: string | null;
  vermarktung: string;
  verfuegbar_ab: string | null;
  vermarktungshinweis: string | null;
  belegung_gepflegt: boolean;
  /** Laeuft ein Mietverhaeltnis -- am Zimmer selbst oder an seiner Etage. */
  laeuft: boolean;
  /** Ende des laufenden Mietverhaeltnisses, falls gesetzt. */
  ende: string | null;
  /** Schon vergeben, Einzug steht noch aus. */
  vergeben: boolean;
  /** Es liegt eine wirksame Kuendigung vor (nicht zurueckgenommen). */
  gekuendigt: boolean;
  /** Termin aus der Kuendigung, falls vereinbart. */
  kuendigung_zum: string | null;
  /** Zimmer wird angeboten, ohne ein Einzugsdatum zuzusagen. */
  nachmieter_gesucht: boolean;
}

/**
 * Wie viele Tage im Voraus ein auslaufendes Mietverhaeltnis als "bald frei"
 * gilt. Drei Monate, weil das ungefaehr der Vorlauf ist, mit dem Leute suchen.
 */
const VORLAUF_TAGE = 92;

/** Der erste freie Tag ist der nach dem letzten Miettag. */
function tagDanach(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return new Date(d.getTime() + 86_400_000).toISOString().slice(0, 10);
}

/**
 * Die Belegungsableitung, bewusst als eigene Funktion und ohne Datenbank.
 *
 * Das ist die Stelle, an der im September 2026 vermietete Zimmer oeffentlich
 * als frei angeboten wurden. Sie steckte damals mitten in einer Abfrage und
 * war damit nicht pruefbar. Jetzt ist sie eine reine Funktion -- und jeder
 * Zweig hat einen Test in tests/belegung.test.ts.
 *
 * Reihenfolge von streng nach grosszuegig. Der erste Zweig, der zutrifft,
 * gewinnt -- also gewinnt im Zweifel immer "belegt".
 */
export function leiteStatusAb(
  z: Zeile,
  grenze: Date,
): { status: Verfuegbarkeit; freiAb: string | null; hinweis: string | null } {
  let status: Verfuegbarkeit = "belegt";
  let freiAb: string | null = null;
  let hinweis: string | null = null;

  if (z.vergeben) {
    // Zugesagt ist zugesagt, auch wenn der Einzug noch aussteht.
    status = "belegt";
  } else if (z.laeuft) {
    if (z.gekuendigt && z.kuendigung_zum) {
      // Termin steht fest.
      const zum = new Date(z.kuendigung_zum + "T00:00:00Z");
      if (zum <= grenze) {
        status = "bald";
        freiAb = tagDanach(z.kuendigung_zum);
      }
    } else if (z.gekuendigt && z.nachmieter_gesucht) {
      // Gekuendigt, Termin haengt am Nachmieter: Das Zimmer wird angeboten,
      // aber ohne Datum. freiAb bleibt bewusst null -- ein Datum hier waere
      // eine Zusage, die niemand gegeben hat.
      status = "frei";
      hinweis = "Einzug nach Absprache";
    } else if (z.gekuendigt) {
      // Gekuendigt, kein Termin, kein Nachmietersuchauftrag: sichtbar
      // machen, aber nicht als frei anbieten.
      status = "bald";
      hinweis = "Termin steht noch nicht fest";
    } else if (z.ende) {
      const ende = new Date(z.ende + "T00:00:00Z");
      if (ende <= grenze) {
        status = "bald";
        freiAb = tagDanach(z.ende);
      }
    }
  } else if (z.vermarktung === "im_bau") {
    // Kein Mietverhaeltnis, aber auch nicht beziehbar. Ohne diesen Zweig
    // meldet eine Einheit im Rohbau "frei -- ab sofort".
    status = "bald";
    freiAb = z.verfuegbar_ab;
    hinweis =
      z.vermarktungshinweis ??
      "Der Umbau laeuft noch, der Termin steht unter Vorbehalt.";
  } else if (z.belegung_gepflegt) {
    // Der einzige Weg zu "frei" ohne Kuendigung: Es gibt kein laufendes
    // Mietverhaeltnis UND fuer diese Einheit ist die Belegung nachweislich
    // gepflegt. Fehlt das Kennzeichen -- etwa bei Altmietern, die nie
    // erfasst wurden --, bleibt es bei "belegt".
    status = "frei";
  }

  // Ein ausdruecklich gesetzter Hinweis gilt immer, auch wenn oben schon
  // einer gesetzt wurde: Er ist von Hand eingetragen und damit die genauere
  // Auskunft.
  if (z.vermarktungshinweis) hinweis = z.vermarktungshinweis;

  return { status, freiAb, hinweis };
}

export async function verfuegbarkeit(): Promise<{
  stand: string;
  einheiten: OeffentlicheEinheit[];
}> {
  const zeilen = await query<Zeile>(
    `SELECT o.name                                   AS objekt,
            e.bezeichnung                            AS einheit,
            COALESCE(eltern.bezeichnung, e.bezeichnung) AS gruppe,
            e.etage,
            e.art,
            e.flaeche_qm::text,
            e.angebot_kaltmiete::text,
            e.angebot_nebenkosten::text,
            e.vermarktung,
            e.verfuegbar_ab::text,
            e.vermarktungshinweis,
            e.belegung_gepflegt,
            (mv.id IS NOT NULL)                      AS laeuft,
            mv.ende::text,
            (kuenftig.id IS NOT NULL)                AS vergeben,
            (kue.id IS NOT NULL)                     AS gekuendigt,
            kue.zum_datum::text                      AS kuendigung_zum,
            COALESCE(kue.nachmieter_gesucht, false)  AS nachmieter_gesucht
       FROM einheit e
       JOIN objekt o ON o.id = e.objekt_id
       LEFT JOIN einheit eltern ON eltern.id = e.eltern_id

       -- Das laufende Mietverhaeltnis -- am Zimmer selbst ODER an seiner
       -- Etage. Im 2. OG laeuft ein Altmietverhaeltnis ueber die ganze
       -- Etage; die fuenf Zimmer darunter haben keinen eigenen Vertrag.
       -- Ohne diesen zweiten Zweig gelten sie als unbelegt, und die Website
       -- bietet fuenf bewohnte Zimmer an. Genau das ist im September
       -- passiert.
       LEFT JOIN LATERAL (
            SELECT m.id, m.ende
              FROM mietverhaeltnis m
             WHERE (m.einheit_id = e.id OR m.einheit_id = e.eltern_id)
               AND m.beginn <= current_date
               AND (m.ende IS NULL OR m.ende >= current_date)
               AND m.status IN ('aktiv','gekuendigt')
             -- Der eigene Vertrag schlaegt den der Etage: Ist ein Zimmer
             -- einzeln vermietet, gilt dessen Ende, nicht das der WG.
             ORDER BY (m.einheit_id = e.id) DESC, m.beginn DESC
             LIMIT 1) mv ON true

       -- Schon vergeben, Einzug steht noch aus. Ohne diesen Zweig wuerde ein
       -- ab dem 15. vergebenes Zimmer am Ersten noch als frei angeboten.
       -- 'vertrag_versendet' zaehlt mit: Ein verschickter Vertrag ist eine
       -- Zusage, und das Zimmer darf nicht zweimal vergeben werden.
       LEFT JOIN LATERAL (
            SELECT m.id, m.beginn
              FROM mietverhaeltnis m
             WHERE (m.einheit_id = e.id OR m.einheit_id = e.eltern_id)
               AND m.beginn > current_date
               AND m.status IN ('vertrag_versendet','aktiv')
             ORDER BY m.beginn ASC
             LIMIT 1) kuenftig ON true

       -- Die wirksame Kuendigung zum laufenden Mietverhaeltnis. Eine
       -- zurueckgenommene bleibt als Beleg stehen, zaehlt hier aber nicht.
       LEFT JOIN LATERAL (
            SELECT x.id, x.zum_datum, x.nachmieter_gesucht
              FROM kuendigung x
             WHERE x.mietverhaeltnis_id = mv.id
               AND x.zurueckgenommen_am IS NULL
             LIMIT 1) kue ON true

      WHERE e.art <> 'gemeinschaft'
        -- Nicht angeboten heisst: gehoert nicht auf die Website. Die
        -- Gewerbeflaeche steht so.
        AND e.vermarktung <> 'nicht_anbieten'
        -- Eine Einheit, die andere unter sich hat, ist die Etage selbst.
        -- Vermietet werden die Zimmer; die Etage zusaetzlich auszugeben
        -- wuerde dasselbe Angebot doppelt zaehlen. Sie wirkt ueber
        -- eltern_id weiter, nur eben nicht als eigene Karte.
        AND NOT EXISTS (SELECT 1 FROM einheit kind WHERE kind.eltern_id = e.id)
      ORDER BY o.name, e.etage NULLS FIRST, e.bezeichnung`,
  );

  const heute = new Date();
  const grenze = new Date(heute.getTime() + VORLAUF_TAGE * 86_400_000);

  const einheiten = zeilen.map((z): OeffentlicheEinheit => {
    const { status, freiAb, hinweis } = leiteStatusAb(z, grenze);

    // Preise kommen aus den Angebotsfeldern der Einheit, nie aus einem
    // Mietverhaeltnis. Was ein belegtes Zimmer kostet, ist die Miete eines
    // Mieters und gehoert niemandem sonst.
    const zeigePreis = status !== "belegt";

    return {
      objekt: z.objekt,
      einheit: z.einheit,
      gruppe: z.gruppe,
      etage: z.etage,
      art: z.art,
      flaeche_qm: z.flaeche_qm === null ? null : Number(z.flaeche_qm),
      kaltmiete:
        !zeigePreis || z.angebot_kaltmiete === null
          ? null
          : Number(z.angebot_kaltmiete),
      nebenkosten:
        !zeigePreis || z.angebot_nebenkosten === null
          ? null
          : Number(z.angebot_nebenkosten),
      status,
      frei_ab: freiAb,
      hinweis,
    };
  });

  return { stand: heute.toISOString().slice(0, 10), einheiten };
}
