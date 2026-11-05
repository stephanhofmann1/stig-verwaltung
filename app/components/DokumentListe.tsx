"use client";

import {
  ART_KURZ,
  ART_TEXT,
  dokumentUrl,
  groesse,
  titel,
  type DokAnzeige,
} from "./DokumentArten";
import { DokumentLoeschen } from "./DokumentLoeschen";

/**
 * Die hinterlegten Dokumente, die keine Bilder sind -- und die beiden, die
 * es nicht als Datei gibt.
 *
 * Mietvertrag und Wohnungsgeberbestätigung werden bei jedem Abruf erzeugt
 * (lib/vertragsdaten.ts). Sie stehen hier trotzdem in derselben Liste, weil
 * die Frage "wo ist der Mietvertrag" nicht danach unterscheidet, ob eine
 * Datei auf einer Platte liegt. Fehlen Angaben, lässt sich das Dokument
 * nicht erzeugen -- dann steht statt des Verweises, was fehlt.
 */

export interface ErzeugtesDokument {
  id: string;
  titel: string;
  /** Leer, wenn es erzeugt werden kann; sonst die fehlenden Angaben. */
  fehlt: string[];
}

export function DokumentListe({
  dokumente,
  loeschbar,
  erzeugte = [],
  leerText,
}: {
  dokumente: DokAnzeige[];
  loeschbar: boolean;
  erzeugte?: ErzeugtesDokument[];
  leerText?: string;
}) {
  if (dokumente.length === 0 && erzeugte.length === 0) {
    return <p className="hinweis">{leerText ?? "Noch keine Dokumente hinterlegt."}</p>;
  }

  return (
    <div className="register">
      {/* Kein Ziel fuer die ganze Zeile: das erzeugte PDF haengt am
          Verweis "ansehen", und bei fehlenden Angaben gibt es ueberhaupt
          keines. data-still nimmt deshalb das Aufleuchten zurueck -- eine
          Zeile, die sich wie ein Knopf anfuehlt und keiner ist, lehrt den
          Nutzer, Knoepfe zu uebersehen. */}
      {erzeugte.map((e) => (
        <div className="posten" data-still="ja" key={e.id}>
          <span className="nummer">PDF</span>
          <span className="betreff">{e.titel}</span>
          <span className="zeit">
            {e.fehlt.length === 0 ? (
              <a href={dokumentUrl(e.id)} target="_blank" rel="noreferrer">
                ansehen
              </a>
            ) : (
              "nicht erzeugbar"
            )}
          </span>
          <span className="unterzeile">
            <span>wird bei Abruf erzeugt, nicht gespeichert</span>
            {e.fehlt.length > 0 && (
              <span className="marker" data-art="heikel">
                es fehlt: {e.fehlt.join(", ")}
              </span>
            )}
          </span>
        </div>
      ))}

      {/* Auch hier kein Zeilenziel: in der Zeile stehen schon drei eigene
          Wege (ansehen, herunterladen, loeschen). Ein Link um alles herum
          waere ein Link, der Knoepfe enthaelt. */}
      {dokumente.map((d) => (
        <div className="posten" data-still="ja" key={d.id}>
          <span className="nummer">{ART_KURZ[d.art] ?? "Dok"}</span>
          <span className="betreff">{titel(d)}</span>
          <span className="zeit">
            <a href={dokumentUrl(d.id)} target="_blank" rel="noreferrer">
              ansehen
            </a>
          </span>
          <span className="unterzeile">
            <span>{ART_TEXT[d.art] ?? d.art}</span>
            <span>{groesse(d.groesse_bytes)}</span>
            <span>{d.dateiname}</span>
            {d.mieter_sichtbar && (
              <span className="marker">für den Mieter sichtbar</span>
            )}
            <a href={dokumentUrl(d.id, true)}>herunterladen</a>
            {loeschbar && <DokumentLoeschen id={d.id} was={titel(d)} />}
          </span>
        </div>
      ))}
    </div>
  );
}
