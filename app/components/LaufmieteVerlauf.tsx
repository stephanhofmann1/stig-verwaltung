import { laufmieteLage, type LaufmietePunkt } from "@/lib/rendite";
import { Verlauf } from "@/components/Diagramm";
import {
  euro,
  euroGenau,
  monatKurz,
  monatsName,
} from "@/components/CockpitKarte";

/**
 * Die Laufmiete im Zeitverlauf: zwölf Monate zurück, zwölf Monate vorwärts.
 *
 * Die Frage dahinter, wörtlich: "Mich interessiert eine hochgerechnete
 * Jahresnettomiete und Mietrendite bei der jetzigen Belegung. Aber auch im
 * Zeitverlauf für Abgänge oder Zugänge, die wir bereits kennen."
 *
 * Je Monat steht hier: Was wäre die Jahresmiete, wenn die in diesem Monat
 * laufenden Verträge ein Jahr lang so weiterliefen. Rückwärts ist das die
 * Entwicklung des Bestands, vorwärts das, was bereits feststeht.
 *
 * DIE GEFÄHRLICHE HÄLFTE IST DIE RECHTE
 *
 * Fällt die Linie im Januar ab, heißt das NICHT "das Zimmer bleibt leer".
 * Es heißt "für diesen Monat ist nichts unterschrieben". Eine
 * Wiedervermietung wird nicht eingerechnet -- keine Quote, kein
 * Durchschnitt, keine Mietsteigerung (die Begründung steht ausführlich in
 * lib/rendite.ts über `laufmieteReihe`). Jede Zahl rechts von heute ist
 * deshalb eine UNTERGRENZE.
 *
 * Darum drei Dinge zusammen, und keines davon ist Zierde:
 *   - die Vorausschau als eigene, gestrichelte Linie,
 *   - der Satz darunter, der sie als Untergrenze benennt,
 *   - die Tabelle, in der jeder Zukunftsmonat als solcher markiert ist.
 *
 * Ein Absturz im Diagramm, den jemand für eine Prognose hält, führt zu einer
 * Entscheidung über ein Haus.
 *
 * Gerechnet wird hier nichts: `laufmieteReihe()` und `laufmieteLage()`
 * stehen in lib/rendite.ts und haben Tests. Gestaltet wird auch nichts --
 * die Klassen kommen aus globals.css.
 */

/** "+13.800,00 €" oder "−13.800,00 €" -- das Vorzeichen trägt die Aussage. */
function mitVorzeichen(betrag: number): string {
  if (betrag === 0) return euroGenau(0);
  return `${betrag > 0 ? "+" : "−"}${euroGenau(Math.abs(betrag))}`;
}

/** "1 Vertrag" / "3 Verträge". */
function vertragsZahl(n: number): string {
  return n === 1 ? "1 Vertrag" : `${n} Verträge`;
}

/** Was sich in einem Monat am Bestand geändert hat, in Worten. */
function bewegung(zugaenge: number, abgaenge: number): string {
  const teile: string[] = [];
  if (zugaenge > 0) teile.push(`${vertragsZahl(zugaenge)} kommen hinzu`);
  if (abgaenge > 0) teile.push(`${vertragsZahl(abgaenge)} fallen weg`);
  return teile.join(", ");
}

export function LaufmieteVerlauf({
  reihe,
  fehler = null,
}: {
  reihe: LaufmietePunkt[];
  /** Warum die Reihe leer ist, falls sie leer ist. */
  fehler?: string | null;
}) {
  const lage = laufmieteLage(reihe);

  if (reihe.length === 0 || lage === null) {
    return (
      <section className="abschnitt">
        <h2>Laufmiete im Zeitverlauf</h2>
        <p className="leer">
          <strong>Hier ist noch kein Verlauf zu zeichnen</strong>
          {fehler
            ? "Die Reihe konnte nicht gelesen werden. Der Grund steht unten " +
              "— eine leere Grafik ohne Grund sähe aus wie ein Haus ohne " +
              "Verträge."
            : "Ein Verlauf entsteht, sobald für dieses Objekt " +
              "Mietverhältnisse mit Beginn und Betrag erfasst sind."}
        </p>
        {fehler ? (
          <div className="meldung" data-art="warnung">
            {fehler}
          </div>
        ) : null}
      </section>
    );
  }

  // Zwei Linien für einen Verlauf: Eine Linie kann nur ganz durchgezogen
  // oder ganz gestrichelt sein. Der Gegenwartsmonat steht in BEIDEN, sonst
  // klaffte zwischen Rückblick und Vorausschau eine Lücke, die wie ein
  // fehlender Monat aussieht.
  const bisHeute = reihe.map((p) => (p.vorausschau ? null : p.jahresmiete));
  const abHeute = reihe.map((p) =>
    p.vorausschau || p.monat === lage.gegenwart ? p.jahresmiete : null,
  );

  const spalten = reihe.map((p) => ({
    name: monatKurz(p.monat),
    titel:
      `${monatsName(p.monat)}: ${euroGenau(p.jahresmiete)} Jahresmiete aus ` +
      `${vertragsZahl(p.vertraege)}` +
      (bewegung(p.zugaenge, p.abgaenge)
        ? ` (${bewegung(p.zugaenge, p.abgaenge)})`
        : "") +
      (p.vorausschau
        ? ". Vorausschau: Untergrenze aus unterschriebenen Verträgen, keine Prognose."
        : ""),
  }));

  const aenderung = lage.groessteAenderung;

  return (
    <section className="abschnitt">
      <h2>Laufmiete im Zeitverlauf</h2>
      <p className="hinweis">
        Je Monat zwölf Mal das Soll der Verträge, die am Monatsersten laufen.
        Anteilige Monate werden nicht gerechnet: Eine Laufmiete ist eine Rate
        und keine Kassenzahl — ein Einzug zum 15. ergäbe sonst eine Delle, die
        keine Bestandsänderung ist, und im Folgemonat eine Stufe, die wie ein
        neuer Mieter aussieht.
      </p>

      <Verlauf
        spalten={spalten}
        linien={[
          {
            name: "Laufmiete bis heute",
            art: "akzent",
            werte: bisHeute,
            flaeche: true,
          },
          {
            name: "Vorausschau (nur Unterschriebenes)",
            art: "leise",
            werte: abHeute,
            gestrichelt: true,
          },
        ]}
        beschriftung={euro}
        aussage={
          `Hochgerechnete Jahresmiete je Monat, ${reihe.length} Monate. ` +
          `Heute: ${euroGenau(lage.jetzt)} aus ${vertragsZahl(lage.vertraegeJetzt)}. ` +
          (aenderung === null
            ? `In den nächsten ${lage.vorausschauMonate} Monaten ist keine Veränderung des Vertragsbestands bekannt.`
            : `Größte bekannte Veränderung: ab ${monatsName(aenderung.monat)} ` +
              `${bewegung(aenderung.zugaenge, aenderung.abgaenge)}, ` +
              `${mitVorzeichen(aenderung.differenz)} Jahresmiete.`) +
          ` Am Ende des Fensters (${monatsName(lage.letzterMonat)}) stehen ` +
          `${euroGenau(lage.amEnde)} aus ${vertragsZahl(lage.vertraegeAmEnde)}. ` +
          "Die Zahlen je Monat stehen in der Tabelle darunter."
        }
        hinweis={
          <>
            {aenderung === null ? (
              <>
                In den nächsten {lage.vorausschauMonate} Monaten ist keine
                Veränderung des Vertragsbestands bekannt.{" "}
              </>
            ) : (
              <>
                Größte bekannte Veränderung: ab{" "}
                <strong>{monatsName(aenderung.monat)}</strong>{" "}
                {bewegung(aenderung.zugaenge, aenderung.abgaenge)},{" "}
                <span className="betrag ziffern">
                  {mitVorzeichen(aenderung.differenz)}
                </span>{" "}
                Jahresmiete.{" "}
              </>
            )}
            Die gestrichelte Linie ist <strong>keine Prognose</strong>, sondern
            eine Untergrenze: Sie zeigt nur, was unterschrieben ist. Fällt sie
            ab, heißt das „hierfür liegt kein Vertrag vor“ und nicht „das
            Zimmer bleibt leer“. Eine Wiedervermietung ist nicht eingerechnet,
            und eine Mieterhöhung erscheint nur, wenn sie vereinbart ist.
          </>
        }
        leerTitel="Hier ist noch kein Verlauf zu zeichnen"
        leerSatz="Ein Verlauf entsteht, sobald Mietverhältnisse mit Beginn und Betrag erfasst sind."
        tabelleTitel="Laufmiete je Monat"
        tabelle={
          <table>
            <caption>
              Je Monat zwölf Mal das am Monatsersten geschuldete Soll
              (<code>miete_am()</code>, db/022). Zu- und Abgänge sind der
              Vergleich mit dem Vormonat; im ersten Monat stehen sie auf 0,
              weil sein Vormonat außerhalb des Fensters liegt. Monate mit
              „Vorausschau“ sind Untergrenzen.
            </caption>
            <thead>
              <tr>
                <th scope="col">Monat</th>
                <th scope="col" className="betrag">
                  Jahresmiete
                </th>
                <th scope="col" className="betrag">
                  Verträge
                </th>
                <th scope="col" className="betrag">
                  Zugänge
                </th>
                <th scope="col" className="betrag">
                  Abgänge
                </th>
                <th scope="col">Stand</th>
              </tr>
            </thead>
            <tbody>
              {reihe.map((p) => (
                <tr key={p.monat}>
                  <th scope="row">{monatKurz(p.monat)}</th>
                  <td className="betrag">{euroGenau(p.jahresmiete)}</td>
                  <td className="betrag ziffern">{p.vertraege}</td>
                  {/* Gedankenstrich statt 0: "keine Bewegung" liest sich
                      besser als eine Spalte voller Nullen, in der die eine
                      echte Zahl untergeht. */}
                  <td className="betrag ziffern">
                    {p.zugaenge > 0 ? p.zugaenge : "—"}
                  </td>
                  <td className="betrag ziffern">
                    {p.abgaenge > 0 ? p.abgaenge : "—"}
                  </td>
                  <td>
                    {p.monat === lage.gegenwart ? (
                      <span className="marker">heute</span>
                    ) : p.vorausschau ? (
                      <span className="marker" data-art="heikel">
                        Vorausschau
                      </span>
                    ) : (
                      "gelaufen"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      />

      {fehler ? (
        <div className="meldung" data-art="warnung">
          {fehler}
        </div>
      ) : null}
    </section>
  );
}
