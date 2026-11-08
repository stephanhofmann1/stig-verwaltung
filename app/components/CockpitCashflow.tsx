import { spitze, type CashflowBalken } from "@/lib/kennzahlen";
import { Stapelbalken } from "@/components/Diagramm";
import {
  CockpitKarte,
  Erklaerung,
  euro,
  euroGenau,
  monatKurz,
} from "@/components/CockpitKarte";

/**
 * Cashflow der letzten Monate -- wie viele, sagt die Reihe.
 *
 * Die Zahl stand bis zum 08.11.2026 als "12" im Titel. Seit der
 * Zeitraum waehlbar ist (app/cockpit/page.tsx), waere das eine falsche
 * Auskunft: Das Diagramm zeigte 24 Balken und die Ueberschrift sagte
 * zwoelf. Sie kommt jetzt aus reihe.length.
 *
 * Die Karte zeichnet nicht mehr selbst: Skala, Stapel und Beschriftung
 * kommen aus dem Baukasten (components/Diagramm.tsx) und aus lib/diagramm.ts.
 * Der Grund ist derselbe, aus dem die Rechnerei in lib/kennzahlen.ts von den
 * Abfragen getrennt ist -- eine Skala in einer Komponente laesst sich nur im
 * Browser pruefen, und die Spitze war hier bis zuletzt der groesste Balken
 * und keine lesbare Stufe: Die Achse endete bei 4.731 EUR.
 *
 * Inhaltlich unveraendert, und die zwei Einschraenkungen bleiben wortgleich
 * stehen:
 *
 *   - Mieteinnahmen und sonstige Einnahmen sind getrennt, aber nur soweit es
 *     sich aus den Zuordnungen ergibt: Miete ist, was einer Sollstellung
 *     zugeordnet ist. Ein Eingang, den noch niemand zugeordnet hat, erscheint
 *     damit als "sonstige" -- das ist keine Schaetzung, sondern der Stand des
 *     Abgleichs, und der Hinweis sagt es.
 *   - Eine Aufschluesselung der Ausgaben nach Art gibt es nicht: dafuer
 *     muessten die Belege kategorisiert sein, und das sind sie nicht.
 */

export function CockpitCashflow({ reihe }: { reihe: CashflowBalken[] }) {
  const max = spitze(reihe);
  const summeEin = reihe.reduce((s, b) => s + b.ein, 0);
  const summeAus = reihe.reduce((s, b) => s + b.aus, 0);
  const summeMiete = reihe.reduce((s, b) => s + b.miete, 0);
  const leer = max === 0;

  return (
    <CockpitKarte
      titel={`Cashflow, ${reihe.length} Monate`}
      zaehler={
        leer ? "keine Buchungen" : `${euro(summeEin)} ein, ${euro(summeAus)} aus`
      }
      hinweis={
        leer ? (
          `Für die letzten ${reihe.length} Monate liegen keine Buchungen vor.`
        ) : (
          <>
            Aus <code>buchung</code>: Eingänge und Ausgaben je Monat.
          </>
        )
      }
      erklaerung={
        leer ? undefined : (
          <Erklaerung satz="Als Miete gilt nur, was einer Sollstellung zugeordnet ist — ein unzugeordneter Eingang steht bei „sonstige“">
            <p className="hinweis">
              Das ist keine Schätzung, sondern der Stand des Abgleichs: Solange
              ein Eingang niemandem zugeordnet ist, kann diese Karte ihn nicht
              als Miete ausweisen. Die Zahl der unzugeordneten Eingänge steht
              auf der Karte darüber.
            </p>
            <p className="hinweis">
              Eine Aufschlüsselung der Ausgaben nach Art gibt es nicht — dafür
              müssten die Belege kategorisiert sein, und das sind sie nicht.
            </p>
          </Erklaerung>
        )
      }
    >
      {leer ? (
        <div className="leer">
          <strong>Nichts zu zeichnen</strong>
          Sobald Kontoumsätze eingelesen sind, stehen hier {reihe.length} Monatsbalken.
        </div>
      ) : (
        <Stapelbalken
          posten={reihe.map((b) => ({
            name: monatKurz(b.monat),
            titel: `${monatKurz(b.monat)}: ${euroGenau(b.miete)} Miete, ${euroGenau(b.sonstige)} sonstige, ${euroGenau(b.aus)} Ausgaben`,
            teile: [
              { name: "zugeordnete Miete", wert: b.miete, art: "akzent" as const },
              { name: "sonstige Eingänge", wert: b.sonstige, art: "leise" as const },
            ],
          }))}
          gegen={{
            name: "Ausgaben",
            werte: reihe.map((b) => b.aus),
            art: "leise",
          }}
          legende={[
            { name: "zugeordnete Miete", art: "akzent" },
            { name: "sonstige Eingänge", art: "leise" },
            { name: "Ausgaben (Umriss, unter der Linie)", art: "leise" },
          ]}
          beschriftung={euro}
          aussage={`Einnahmen und Ausgaben der letzten ${reihe.length} Monate: insgesamt ${euro(summeEin)} ein, ${euro(summeAus)} aus. Davon ${euro(summeMiete)} zugeordnete Miete. Die Zahlen je Monat stehen in der Tabelle darunter.`}
          hinweis={
            <>
              Oben Einnahmen (voll: zugeordnete Miete, blass: sonstige), unten
              Ausgaben als Umriss. Höchster Balken {euroGenau(max)}. In{" "}
              {reihe.length} Monaten {euroGenau(summeMiete)} zugeordnete Miete und{" "}
              {euroGenau(summeEin - summeMiete)} sonstige Eingänge.
            </>
          }
          tabelleTitel="Zahlen je Monat"
          tabelle={
            /* Dieselbe Tabelle wie bisher: ein Dutzend Zeilen sind kein Lagebild,
               aber ohne sie ist die Zahl nach dem Zeichnen verloren. */
            <table>
              <caption>
                Beträge aus <code>buchung</code>, Miete aus{" "}
                <code>zuordnung</code>.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Monat</th>
                  <th scope="col" className="betrag">
                    Miete
                  </th>
                  <th scope="col" className="betrag">
                    sonstige
                  </th>
                  <th scope="col" className="betrag">
                    Ausgaben
                  </th>
                </tr>
              </thead>
              <tbody>
                {reihe.map((b) => (
                  <tr key={b.monat}>
                    <th scope="row">{monatKurz(b.monat)}</th>
                    <td className="betrag">{euroGenau(b.miete)}</td>
                    <td className="betrag">{euroGenau(b.sonstige)}</td>
                    <td className="betrag">{euroGenau(b.aus)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">zusammen</th>
                  <td className="betrag">{euroGenau(summeMiete)}</td>
                  <td className="betrag">{euroGenau(summeEin - summeMiete)}</td>
                  <td className="betrag">{euroGenau(summeAus)}</td>
                </tr>
              </tfoot>
            </table>
          }
        />
      )}
    </CockpitKarte>
  );
}
