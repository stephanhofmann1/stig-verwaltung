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

  return (
    <div>
      {!einzelnGross && (
        <div
          style={{
            display: "grid",
            gap: "0.5rem",
            gridTemplateColumns: gross
              ? "repeat(auto-fill, minmax(14rem, 1fr))"
              : "repeat(auto-fill, minmax(8rem, 1fr))",
            marginBottom: grossesBild ? "1rem" : 0,
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
                  offen === b.id ? "var(--stempel)" : "var(--linie)",
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
              background: "var(--papier-tief)",
            }}
          />
          <figcaption
            className="unterzeile"
            style={{ marginTop: "0.5rem", display: "flex", flexWrap: "wrap", gap: "0.75rem" }}
          >
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
              <DokumentLoeschen id={grossesBild.id} was={titel(grossesBild)} still />
            )}
          </figcaption>
        </figure>
      )}
    </div>
  );
}
