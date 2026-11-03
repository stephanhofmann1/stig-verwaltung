import Link from "next/link";
import { query } from "@/lib/db";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { ladeWeisungen } from "@/lib/weisungen";
import {
  Weisungen,
  type KontaktZeile,
  type WeisungZeile,
} from "@/components/Weisungen";

export const dynamic = "force-dynamic";

/**
 * Die Weisungsseite.
 *
 * Hier steht, was dauerhaft gilt -- und was hier steht, geht bei JEDEM
 * Entwurf in den Auftrag an das Sprachmodell. Deshalb ist diese Seite
 * nicht nur ein Formular, sondern auch die Lesestelle: Wer eine Mail in
 * der Freigabe nicht wiedererkennt, muss hier nachsehen koennen, was auf
 * sie gewirkt hat. Umgekehrt steht an jedem Entwurf, welche Weisungen
 * gewirkt haben (components/Herkunft.tsx) -- eine unsichtbare
 * Dauerweisung ist schlimmer als keine.
 *
 * Geladen wird ueber lib/weisungen.ts und damit ueber tx(): Der Mandant
 * kommt aus dem Sitzungscookie, die Policy aus db/031 haelt die Grenze.
 * Dieselbe Begruendung wie dort im Kopf -- eine ueber die Mandantengrenze
 * gelesene Weisung veraendert die Korrespondenz eines fremden
 * Unternehmens.
 *
 * Die Kontaktliste bleibt bewusst kurz: Nur Kontakte, die ueberhaupt
 * schon einmal einen Vorgang hatten, und nur die aktiven. Eine Auswahl
 * mit allen je angelegten Adressen ist nach einem Jahr Automatik
 * unbenutzbar.
 */
export default async function Weisungsseite() {
  const sitzung = await angemeldeteSitzung();
  const darfSchreiben = sitzung?.rolle === "verwalter";

  const [weisungen, kontakte] = await Promise.all([
    ladeWeisungen() as Promise<WeisungZeile[]>,
    query<KontaktZeile>(
      `SELECT k.id, k.anzeigename, k.rolle
         FROM kontakt k
        WHERE k.aktiv
          AND (EXISTS (SELECT 1 FROM vorgang v WHERE v.kontakt_id = k.id)
               OR EXISTS (SELECT 1 FROM weisung w WHERE w.kontakt_id = k.id))
        ORDER BY k.anzeigename ASC
        LIMIT 300`,
    ),
  ]);

  return (
    <>
      <div className="titelzeile">
        <h1>Weisungen</h1>
        <span className="zaehler">
          {weisungen.length === 0
            ? "noch keine"
            : `${weisungen.filter((w) => w.aktiv).length} von ${weisungen.length} aktiv`}
        </span>
      </div>

      <p className="hinweis">
        Was hier steht, gilt dauerhaft und geht bei jedem Entwurf mit. Für
        den Einzelfall gibt es das Anweisungsfeld am Entwurf selbst.
      </p>

      {darfSchreiben ? (
        <Weisungen weisungen={weisungen} kontakte={kontakte} />
      ) : (
        <>
          {/* Lesende Zugaenge sehen den Bestand, aendern ihn aber nicht.
              Die Schnittstelle weist sie ohnehin ab (403) -- ein Formular
              anzuzeigen, dessen Knoepfe alle scheitern, waere schlechter
              als keines. */}
          <p className="hinweis">
            Dieser Zugang darf die Weisungen lesen. Geändert werden sie von
            der Verwaltung.
          </p>
          {weisungen.length === 0 ? (
            <div className="leer">
              <strong>Noch keine Weisung hinterlegt</strong>
              Entwürfe entstehen derzeit allein aus den Textbausteinen und
              dem Sprachmodell.
            </div>
          ) : (
            <div className="register">
              {weisungen.map((w) => (
                <div className="posten" data-still="ja" key={w.id}>
                  <span className="nummer">
                    {w.aktiv ? (
                      <span className="marker" data-art="gut">
                        aktiv
                      </span>
                    ) : (
                      <span className="marker">aus</span>
                    )}
                  </span>
                  <span className="betreff">{w.weisungstext}</span>
                  <span className="zeit">{w.ebene}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="knopfreihe abschnitt">
        <Link href="/" className="verweis">
          Zurück zur Übersicht
        </Link>
      </div>
    </>
  );
}
