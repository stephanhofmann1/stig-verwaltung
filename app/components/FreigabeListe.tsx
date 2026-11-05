import Link from "next/link";
import { query } from "@/lib/db";
import { EntwurfKarte } from "@/components/EntwurfKarte";
import { Erklaerung } from "@/components/CockpitKarte";
import { aktenzeichen, seit } from "@/lib/formate";
import type { HerkunftDaten } from "@/components/Herkunft";
import type { Kategorie } from "@/lib/typen";

/**
 * Die Freigabe-Warteschlange.
 *
 * Bis zum 02.11.2026 war das die ganze Startseite. Sie ist jetzt eine Karte
 * im Cockpit, inhaltlich unveraendert: dieselben zwei Abfragen, dieselben
 * Entwurfskarten, dieselbe Liste der Vorgaenge ohne Entwurf. Nichts
 * verschickt sich von selbst -- gesendet wird nur, was hier freigegeben
 * wird, und das bleibt so.
 *
 * Die Ueberschriften sind h2 statt h1: Die Seite hat jetzt eine eigene h1,
 * und zwei h1 nebeneinander waeren fuer einen Screenreader zwei Seiten.
 *
 * WAS AM 03.11.2026 DAZUKOMMT
 *
 * Die Liste "Ohne Entwurf" sagte, DASS der Agent nichts geschrieben hat,
 * und erklaerte es mit zwei Moeglichkeiten ("entweder heikel, oder er war
 * sich nicht sicher"). Welche von beiden es im Einzelfall war, stand
 * nicht da. Genau dieses Schweigen war der Schaden vom 03.11.2026: Eine
 * Mail des Messdienstleisters lag als Behoerdenpost in der Akte, war
 * dadurch heikel, und auf der Oberflaeche war nicht zu erkennen, dass die
 * Automatik aus diesem Grund angehalten hatte.
 *
 * Jetzt steht der Grund je Zeile (vorgang.kein_entwurf_grund, db/031),
 * und bei einer Einordnung aus einem Stichwort steht das Stichwort dabei.
 * Das ist die Zeile, aus der sich der Fehler erkennen laesst, ohne die
 * Akte zu oeffnen.
 *
 * Die Herkunft der Entwuerfe wird hier serverseitig mitgeladen und an die
 * Karte gegeben, damit sie sofort steht. Die Karte kann sie auch selbst
 * holen (GET /api/entwurf/[id]) -- in der Vorgangsakte tut sie das --,
 * aber eine Liste mit zwanzig Entwuerfen soll nicht zwanzig Abrufe
 * nachschicken.
 */

interface Entwurf {
  id: string;
  betreff: string;
  koerper_text: string;
  an_emails: string[];
  verfasst_von: "agent" | "mensch" | null;
  agent_notiz: string | null;
  vorgang_id: string;
  vorgang_nummer: number;
  vorgang_betreff: string;
  // --- Herkunft (db/031) ---
  kategorie: Kategorie;
  heikel: boolean;
  einordnung_quelle: string | null;
  einordnung_stichwort: string | null;
  einordnung_fundstelle: string | null;
  kein_entwurf_code: string | null;
  kein_entwurf_grund: string | null;
  ohne_antwort_grund: string | null;
  entwurf_quelle: "regel" | "modell" | "mensch" | null;
  entwurf_modell: string | null;
  entwurf_fassung_nr: number | null;
}

interface Wartend {
  id: string;
  nummer: number;
  betreff: string;
  kontakt_name: string | null;
  geaendert_am: string;
  heikel: boolean;
  /** Warum hier kein Entwurf entstand -- der Satz, der bisher fehlte. */
  kein_entwurf_grund: string | null;
  einordnung_stichwort: string | null;
}

export async function FreigabeListe() {
  const entwuerfe = await query<Entwurf>(`
    SELECT n.id, n.betreff, n.koerper_text, n.an_emails,
           n.verfasst_von, n.agent_notiz,
           n.entwurf_quelle, n.entwurf_modell, n.entwurf_fassung_nr,
           v.id AS vorgang_id, v.nummer AS vorgang_nummer,
           v.betreff AS vorgang_betreff,
           v.kategorie, v.heikel,
           v.einordnung_quelle, v.einordnung_stichwort,
           v.einordnung_fundstelle,
           v.kein_entwurf_code, v.kein_entwurf_grund, v.ohne_antwort_grund
      FROM nachricht n
      JOIN vorgang v ON v.id = n.vorgang_id
     WHERE n.status = 'entwurf'
     ORDER BY n.angelegt_am ASC
  `);

  // Vorgänge, die offen sind und auf die noch niemand geantwortet hat.
  const unbeantwortet = await query<Wartend>(`
    SELECT v.id, v.nummer, v.betreff, v.heikel, v.geaendert_am,
           v.kein_entwurf_grund, v.einordnung_stichwort,
           k.anzeigename AS kontakt_name
      FROM vorgang v
      LEFT JOIN kontakt k ON k.id = v.kontakt_id
     WHERE v.status = 'offen'
       AND NOT EXISTS (
         SELECT 1 FROM nachricht n
          WHERE n.vorgang_id = v.id AND n.status IN ('entwurf','gesendet'))
     ORDER BY v.geaendert_am ASC
     LIMIT 50
  `);

  return (
    <section aria-labelledby="freigabe-titel">
      <div className="titelzeile">
        <h2 id="freigabe-titel" style={{ margin: 0 }}>
          Freigabe
        </h2>
        <span className="zaehler ziffern">
          {entwuerfe.length} {entwuerfe.length === 1 ? "Entwurf" : "Entwürfe"}
        </span>
      </div>
      {/* Der kurze Satz bleibt stehen: Er ist die Zusage, auf der die ganze
          Automatik ruht, und steht ueber der ersten Handlung der Seite. */}
      <p className="hinweis">
        Nichts verlässt das Haus, ohne dass du hier geklickt hast.
      </p>

      {entwuerfe.length === 0 ? (
        <div className="leer">
          <strong>Nichts zum Freigeben</strong>
          Sobald eine Mail ankommt, die sich beantworten lässt, liegt der
          Entwurf hier.
        </div>
      ) : (
        entwuerfe.map((e) => (
          <EntwurfKarte
            key={e.id}
            id={e.id}
            betreff={e.betreff}
            koerper={e.koerper_text}
            empfaenger={e.an_emails}
            verfasstVon={e.verfasst_von}
            notiz={e.agent_notiz}
            vorgang={{
              id: e.vorgang_id,
              nummer: e.vorgang_nummer,
              betreff: e.vorgang_betreff,
            }}
            herkunft={
              {
                kategorie: e.kategorie,
                heikel: e.heikel,
                einordnung_quelle: e.einordnung_quelle,
                einordnung_stichwort: e.einordnung_stichwort,
                einordnung_fundstelle: e.einordnung_fundstelle,
                kein_entwurf_code: e.kein_entwurf_code,
                kein_entwurf_grund: e.kein_entwurf_grund,
                entwurf_quelle: e.entwurf_quelle,
                entwurf_modell: e.entwurf_modell,
                entwurf_fassung_nr: e.entwurf_fassung_nr,
                ohne_antwort_grund: e.ohne_antwort_grund,
              } satisfies HerkunftDaten
            }
          />
        ))
      )}

      {unbeantwortet.length > 0 && (
        <>
          <div className="titelzeile">
            <h2 style={{ margin: 0 }}>Ohne Entwurf</h2>
            <span className="zaehler ziffern">{unbeantwortet.length}</span>
          </div>
          <Erklaerung satz="Diese Vorgänge hat der Agent nicht beantwortet — hier gibt es nichts freizugeben, sondern zu schreiben">
            <p className="hinweis">
              Der Grund steht je Zeile. Er stand bis zum 03.11.2026 nirgends,
              und genau daran war der teuerste Fehler dieser Automatik nicht
              zu erkennen: Eine falsch als Behördenpost eingeordnete Mail war
              dadurch heikel, der Agent hielt an, und niemand erfuhr warum.
              Steht als Grund ein Stichwort, das nicht passt, ist die
              Kategorie in der Akte zu berichtigen — danach lässt sich der
              Entwurf dort nachziehen.
            </p>
          </Erklaerung>
          <div className="register">
            {unbeantwortet.map((v) => (
              <Link
                key={v.id}
                href={`/vorgang/${v.id}`}
                className="posten"
                data-heikel={v.heikel ? "ja" : "nein"}
              >
                <span className="nummer ziffern">{aktenzeichen(v.nummer)}</span>
                <span className="betreff">{v.betreff}</span>
                <span className="zeit">{seit(v.geaendert_am)}</span>
                <span className="unterzeile">
                  <span>{v.kontakt_name ?? "Unbekannt"}</span>
                  {v.heikel && (
                    <span className="marker" data-art="heikel">
                      heikel
                    </span>
                  )}
                  {/* Der Satz, der bisher fehlte. */}
                  {v.kein_entwurf_grund && <span>{v.kein_entwurf_grund}</span>}
                  {v.einordnung_stichwort && (
                    <span>
                      eingeordnet über „{v.einordnung_stichwort}“
                    </span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
