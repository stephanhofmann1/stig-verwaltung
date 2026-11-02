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
      {erzeugte.map((e) => (
        <div className="posten" key={e.id}>
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

      {dokumente.map((d) => (
        <div className="posten" key={d.id}>
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
            {loeschbar && <DokumentLoeschen id={d.id} was={titel(d)} still />}
          </span>
        </div>
      ))}
    </div>
  );
}
