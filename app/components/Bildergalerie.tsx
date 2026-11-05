"use client";

import { useState } from "react";
import {
  dokumentUrl,
  groesse,
  titel,
  type DokAnzeige,
} from "./DokumentArten";
import { DokumentLoeschen } from "./DokumentLoeschen";

/**
 * Bilder und Grundrisse zu einer Einheit.
 *
 * Erst als Streifen kleiner Vorschauen, ein Klick zeigt das Bild groß. Bei
 * einem Grundriss ist das große Bild der eigentliche Zweck -- auf einer
 * Vorschau von 9 Zentimetern ist kein Zuschnitt zu erkennen; deshalb lässt
 * sich jedes Bild zusätzlich in Originalgröße öffnen.
 *
 * Die Adressen zeigen auf /api/dokumente/<id>. Dort wird bei jedem Abruf
 * die Berechtigung geprüft. Ein Pfad auf der Platte steht hier nicht --
 * er dürfte es auch nicht.
 */
export function Bildergalerie({
  bilder,
  loeschbar,
  gross = false,
  leerText,
}: {
  bilder: DokAnzeige[];
  loeschbar: boolean;
  /** Grundrisse werden von Anfang an groß gezeigt. */
  gross?: boolean;
  leerText?: string;
}) {
  const [offen, setOffen] = useState<string | null>(null);

  if (bilder.length === 0) {
    return (
      <p className="hinweis">
        {leerText ?? "Noch keine Bilder hinterlegt."}
      </p>
    );
  }

  const gezeigt = offen ? bilder.find((b) => b.id === offen) : null;

  // Ein einzelner Grundriss braucht keine Auswahl -- der wird gezeigt.
  const einzelnGross = gross && bilder.length === 1;
  const grossesBild = gezeigt ?? (einzelnGross ? bilder[0] : null);

  /*
   * Was hier noch an Stil im Markup steht und warum:
   *
   * Fuer eine Bildergalerie gibt es in globals.css keine Klasse, und die
   * zugesagten passen nicht. .karten waere das naechste Raster, legt aber
   * jede Spalte auf mindestens 13 rem fest -- damit faellt der Unterschied
   * zwischen dem Streifen kleiner Vorschauen (8 rem) und der grossen
   * Ansicht eines Grundrisses (14 rem) weg, und genau der ist hier der
   * Zweck. Der Vorschauknopf braucht ausserdem padding: 0 (sonst sitzt das
   * Bild in einem Knopfrahmen) und eine Randfarbe, die das ausgewaehlte
   * Bild zeigt -- data-art kennt nur "still" und "gefahr".
   *
   * Es fehlen also drei Klassen: ein Bilderstreifen mit zwei Groessen, ein
   * Bildknopf mit Auswahlzustand und das grosse Bild samt figure. Solange
   * die nicht da sind, bleibt der Stil hier stehen -- aber mit den
   * aktuellen Marken statt der Altnamen (--stempel/--papier-tief), damit
   * der Dunkelmodus stimmt.
   */
  return (
    <div>
      {!einzelnGross && (
        <div
          style={{
            display: "grid",
            gap: "var(--abstand-2)",
            gridTemplateColumns: gross
              ? "repeat(auto-fill, minmax(14rem, 1fr))"
              : "repeat(auto-fill, minmax(8rem, 1fr))",
            marginBottom: grossesBild ? "var(--abstand-4)" : 0,
          }}
        >
          {bilder.map((b) => (
            <button
              key={b.id}
              type="button"
              data-art="still"
              onClick={() => setOffen(offen === b.id ? null : b.id)}
              title={titel(b)}
              style={{
                padding: 0,
                overflow: "hidden",
                lineHeight: 0,
                borderColor:
                  offen === b.id ? "var(--akzent)" : "var(--linie)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={dokumentUrl(b.id)}
                alt={titel(b)}
                loading="lazy"
                style={{
                  display: "block",
                  width: "100%",
                  aspectRatio: "4 / 3",
                  objectFit: "cover",
                }}
              />
            </button>
          ))}
        </div>
      )}

      {grossesBild && (
        <figure style={{ margin: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={dokumentUrl(grossesBild.id)}
            alt={titel(grossesBild)}
            style={{
              display: "block",
              width: "100%",
              height: "auto",
              border: "1px solid var(--linie)",
              background: "var(--flaeche-tief)",
            }}
          />
          {/* .unterzeile ist schon Flex mit Umbruch, Abstand und
              Oberrand -- der Inline-Stil hat das Wort fuer Wort wiederholt. */}
          <figcaption className="unterzeile">
            <span>{titel(grossesBild)}</span>
            <span>{groesse(grossesBild.groesse_bytes)}</span>
            {grossesBild.mieter_sichtbar && (
              <span className="marker">für den Mieter sichtbar</span>
            )}
            <a href={dokumentUrl(grossesBild.id)} target="_blank" rel="noreferrer">
              in Originalgröße öffnen
            </a>
            <a href={dokumentUrl(grossesBild.id, true)}>herunterladen</a>
            {loeschbar && (
              <DokumentLoeschen id={grossesBild.id} was={titel(grossesBild)} />
            )}
          </figcaption>
        </figure>
      )}
    </div>
  );
}
