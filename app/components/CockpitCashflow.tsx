import { anteil, spitze, type CashflowBalken } from "@/lib/kennzahlen";
import {
  CockpitKarte,
  euro,
  euroGenau,
  monatKurz,
} from "@/components/CockpitKarte";

/**
 * Cashflow der letzten zwoelf Monate.
 *
 * Reines SVG, keine Diagrammbibliothek. Die Balken sind Daten und deshalb
 * der einzige Ort in diesen Karten, an dem Masse im Markup stehen; Farben
 * kommen ueber currentColor und die Marken aus globals.css, damit die
 * Gestaltung sie weiter in der Hand hat.
 *
 * Getrennt werden Mieteinnahmen und sonstige Einnahmen -- aber nur, soweit
 * es sich aus den Zuordnungen ergibt: Miete ist, was einer Sollstellung
 * zugeordnet ist. Ein Eingang, den noch niemand zugeordnet hat, erscheint
 * damit als "sonstige". Das ist keine Schaetzung, sondern der Stand des
 * Abgleichs, und der Hinweis unter dem Diagramm sagt das.
 *
 * Ausgaben sind Buchungen mit negativem Betrag, als positive Balken nach
 * unten. Eine Aufschluesselung nach Art gibt es nicht: dafuer muessten die
 * Belege kategorisiert sein, und das sind sie nicht.
 */

const HOCH = 62; // Hoehe einer Balkenhaelfte in Benutzereinheiten
const BREIT = 26; // Balkenbreite
const SPUR = 48; // Platz je Monat

export function CockpitCashflow({ reihe }: { reihe: CashflowBalken[] }) {
  const max = spitze(reihe);
  const breite = reihe.length * SPUR;
  const mitte = HOCH + 14;

  const summeEin = reihe.reduce((s, b) => s + b.ein, 0);
  const summeAus = reihe.reduce((s, b) => s + b.aus, 0);
  const summeMiete = reihe.reduce((s, b) => s + b.miete, 0);
  const leer = max === 0;

  return (
    <CockpitKarte
      titel="Cashflow, 12 Monate"
      zaehler={
        leer ? "keine Buchungen" : `${euro(summeEin)} ein, ${euro(summeAus)} aus`
      }
      hinweis={
        leer ? (
          "Für die letzten zwölf Monate liegen keine Buchungen vor."
        ) : (
          <>
            Aus <code>buchung</code>: Eingänge und Ausgaben je Monat. Als Miete
            gilt, was einer Sollstellung zugeordnet ist — ein noch nicht
            zugeordneter Eingang steht deshalb bei „sonstige“ und nicht bei der
            Miete.
          </>
        )
      }
    >
      {leer ? (
        <div className="leer">
          <strong>Nichts zu zeichnen</strong>
          Sobald Kontoumsätze eingelesen sind, stehen hier zwölf Monatsbalken.
        </div>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${breite} ${2 * HOCH + 30}`}
            width="100%"
            height="auto"
            role="img"
            aria-label={`Einnahmen und Ausgaben der letzten ${reihe.length} Monate. Insgesamt ${euro(summeEin)} ein, ${euro(summeAus)} aus.`}
            style={{ display: "block", maxHeight: "16rem" }}
          >
            {/* Nulllinie */}
            <line
              x1="0"
              y1={mitte}
              x2={breite}
              y2={mitte}
              stroke="currentColor"
              strokeOpacity="0.25"
            />
            {reihe.map((b, i) => {
              const x = i * SPUR + (SPUR - BREIT) / 2;
              const hMiete = anteil(b.miete, max) * HOCH;
              const hSonst = anteil(b.sonstige, max) * HOCH;
              const hAus = anteil(b.aus, max) * HOCH;
              return (
                <g key={b.monat}>
                  <title>
                    {`${monatKurz(b.monat)}: ${euroGenau(b.miete)} Miete, ${euroGenau(b.sonstige)} sonstige, ${euroGenau(b.aus)} Ausgaben`}
                  </title>
                  {/* Einnahmen nach oben, Miete unten im Stapel. */}
                  <rect
                    x={x}
                    y={mitte - hMiete}
                    width={BREIT}
                    height={hMiete}
                    fill="currentColor"
                    fillOpacity="0.85"
                  />
                  <rect
                    x={x}
                    y={mitte - hMiete - hSonst}
                    width={BREIT}
                    height={hSonst}
                    fill="currentColor"
                    fillOpacity="0.35"
                  />
                  {/* Ausgaben nach unten, schraffiert durch halbe Deckung. */}
                  <rect
                    x={x}
                    y={mitte}
                    width={BREIT}
                    height={hAus}
                    fill="none"
                    stroke="currentColor"
                    strokeOpacity="0.55"
                  />
                  <text
                    x={x + BREIT / 2}
                    y={2 * HOCH + 26}
                    textAnchor="middle"
                    fontSize="10"
                    fill="currentColor"
                    fillOpacity="0.6"
                  >
                    {monatKurz(b.monat).replace(" ", " ")}
                  </text>
                </g>
              );
            })}
          </svg>

          <p className="hinweis" style={{ marginTop: "0.75rem" }}>
            Oben Einnahmen (voll: Miete, blass: sonstige), unten Ausgaben als
            Umriss. Höchster Balken {euroGenau(max)}. In zwölf Monaten{" "}
            {euroGenau(summeMiete)} zugeordnete Miete und{" "}
            {euroGenau(summeEin - summeMiete)} sonstige Eingänge.
          </p>

          <details>
            <summary className="zaehler">Zahlen je Monat</summary>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <caption className="hinweis" style={{ captionSide: "bottom" }}>
                Beträge aus <code>buchung</code>, Miete aus{" "}
                <code>zuordnung</code>.
              </caption>
              <thead>
                <tr>
                  <th scope="col" style={{ textAlign: "left" }}>
                    Monat
                  </th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Miete
                  </th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    sonstige
                  </th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Ausgaben
                  </th>
                </tr>
              </thead>
              <tbody>
                {reihe.map((b) => (
                  <tr key={b.monat}>
                    <th scope="row" style={{ textAlign: "left", fontWeight: 400 }}>
                      {monatKurz(b.monat)}
                    </th>
                    <td className="ziffern" style={{ textAlign: "right" }}>
                      {euroGenau(b.miete)}
                    </td>
                    <td className="ziffern" style={{ textAlign: "right" }}>
                      {euroGenau(b.sonstige)}
                    </td>
                    <td className="ziffern" style={{ textAlign: "right" }}>
                      {euroGenau(b.aus)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </CockpitKarte>
  );
}
