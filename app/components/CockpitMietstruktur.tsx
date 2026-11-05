import type { Mietstruktur } from "@/lib/kennzahlen";
import { Balken, Streifen } from "@/components/Diagramm";
import {
  CockpitKarte,
  Erklaerung,
  euro,
  euroGenau,
  monatsName,
} from "@/components/CockpitKarte";

/**
 * Woraus das gestellte Soll besteht.
 *
 * Ein waagerechter Streifen: Kaltmiete, Betriebskostenvorauszahlung, und der
 * Teil ohne Aufteilung. Dazu die Verteilung der Mietverhaeltnisse nach Hoehe.
 *
 * Der dritte Streifenteil ist der Grund fuer diese Karte. Eine Inklusivmiete
 * -- ein Betrag, alles inbegriffen -- hat **gar keine getrennte Kaltmiete**,
 * und in WG- oder moeblierten Bestaenden ist sie haeufig die Mehrheit.
 * Dieser Teil bleibt als eigenes Segment sichtbar und wird nie in die
 * Kaltmiete gerechnet: Sonst stuende hier eine Kaltmietensumme, die es nicht
 * gibt, und jede Rendite- oder Nebenkostenrechnung darauf waere falsch.
 * Genau diese Annahme hat im Mieterbereich ein Jahr lang Mieter mit
 * Inklusivmiete "Kaltmiete —" sehen lassen (lib/mieter.ts). Wie viele es
 * sind, kommt aus den Daten -- im Quelltext steht keine Zahl dazu.
 *
 * Dasselbe gilt fuer anteilige Monate: Wenn das gestellte Soll von der
 * Vertragssumme abweicht, weil jemand am 15. eingezogen ist, waere jede
 * Aufteilung erfunden. Die Regel steht in lib/kennzahlen.ts
 * (`mietstruktur()`) und entspricht der in lib/mietenbuch.ts, wo `kaltmiete`
 * nur bei einem vollen Monat durchgereicht wird.
 *
 * Die drei Segmente ergeben zusammen **genau** das Soll: Der Rest wird als
 * Differenz gerechnet und nicht aufsummiert. Rechnete man ihn als Summe der
 * Einzelposten, fehlte bei einem Rundungsfehler ein Betrag im Bild, und
 * niemand wuesste, welcher.
 */

export function CockpitMietstruktur({ struktur }: { struktur: Mietstruktur }) {
  if (struktur.monat === null || struktur.soll <= 0) {
    return (
      <CockpitKarte titel="Mietstruktur" zaehler="keine Sollstellungen">
        <div className="leer">
          <strong>Es konnte kein gestelltes Soll gelesen werden</strong>
          Diese Karte zeigt, woraus das Soll eines Monats besteht. Sie füllt
          sich, sobald der Nachtlauf <code>sollstellungen</code> für einen
          Monat Beträge erzeugt hat. Eine Null stünde hier für „keine Miete
          vereinbart“ — tatsächlich ist nichts gestellt.
        </div>
      </CockpitKarte>
    );
  }

  const ohneAnzahl =
    struktur.anzahlInklusiv +
    struktur.anzahlAnteilig +
    struktur.anzahlWidersprechend;

  const teile = [
    {
      name: "Kaltmiete",
      wert: struktur.kalt,
      art: "akzent" as const,
      titel: `Kaltmiete: ${euroGenau(struktur.kalt)} aus ${struktur.anzahlAufgeteilt} Mietverhältnissen mit getrennter Kaltmiete`,
    },
    {
      name: "Betriebskosten",
      wert: struktur.nebenkosten,
      art: "gut" as const,
      titel: `Betriebskostenvorauszahlung: ${euroGenau(struktur.nebenkosten)}`,
    },
    {
      name: "ohne Aufteilung",
      wert: struktur.ohneAufteilung,
      art: "leise" as const,
      titel: `Ohne Aufteilung: ${euroGenau(struktur.ohneAufteilung)} aus ${ohneAnzahl} Mietverhältnissen — Inklusivmieten, Möblierungszuschläge und anteilige Monate`,
    },
  ];

  const anteilOhne =
    struktur.soll > 0
      ? Math.round((struktur.ohneAufteilung / struktur.soll) * 100)
      : 0;

  return (
    <CockpitKarte
      titel="Mietstruktur"
      zaehler={`${euro(struktur.soll)} Soll`}
      hinweis={
        <>
          Gestelltes Soll für {monatsName(struktur.monat)} aus{" "}
          <code>sollstellung</code>, aufgeteilt nach den Vertragsposten von{" "}
          {struktur.anzahl} Mietverhältnissen.
        </>
      }
      erklaerung={
        <Erklaerung satz="Eine Inklusivmiete hat keine Kaltmiete — sie steht vollständig unter „ohne Aufteilung“ und wird nie hineingerechnet">
          <p className="hinweis">
            Aufgeteilt wird nur, wenn im Vertrag eine getrennte Kaltmiete steht
            <em>und</em> das gestellte Soll der Vertragssumme auf den Cent
            entspricht. Bei einem anteiligen Monat — Ein- oder Auszug mitten im
            Monat — wäre jede Aufteilung erfunden: aus einem halben Monat würde
            eine ganze Kaltmiete.
          </p>
          <p className="hinweis">
            Unter „ohne Aufteilung“ stehen damit drei verschiedene Dinge:{" "}
            {struktur.anzahlInklusiv} Inklusivmieten (keine getrennte Kaltmiete
            hinterlegt), {struktur.anzahlAnteilig} anteilige Monate, und die
            Möblierungszuschläge, die weder Kaltmiete noch Betriebskosten sind.
            {struktur.anzahlWidersprechend > 0 && (
              <>
                {" "}
                Dazu {struktur.anzahlWidersprechend} Mietverhältnisse, bei denen
                Kaltmiete und Betriebskosten zusammen höher wären als das
                gestellte Soll — ein Widerspruch in den Stammdaten, der hier
                nicht geglättet wird.
              </>
            )}
          </p>
          <p className="hinweis">
            Die drei Segmente ergeben zusammen genau das Soll: Der Rest ist die
            Differenz und keine zweite Summe.
          </p>
        </Erklaerung>
      }
    >
      <Streifen
        teile={teile}
        bezug={struktur.soll}
        aussage={`Das gestellte Soll von ${euro(struktur.soll)} besteht aus ${euro(struktur.kalt)} Kaltmiete, ${euro(struktur.nebenkosten)} Betriebskostenvorauszahlung und ${euro(struktur.ohneAufteilung)} ohne Aufteilung — das sind ${anteilOhne} Prozent, vor allem Inklusivmieten. Die Beträge stehen in der Tabelle darunter.`}
        hinweis={
          <>
            {struktur.anzahlAufgeteilt} von {struktur.anzahl}{" "}
            Mietverhältnissen lassen sich in Kalt und Betriebskosten aufteilen.
            Die übrigen {ohneAnzahl} nicht — bei ihnen gibt es keine getrennte
            Kaltmiete, die man ausweisen könnte.
          </>
        }
        tabelleTitel="Beträge der Mietstruktur"
        tabelle={
          <table>
            <caption>
              Soll aus <code>sollstellung</code>, Posten aus{" "}
              <code>mietverhaeltnis</code> bzw. der jüngsten{" "}
              <code>mietanpassung</code>.
            </caption>
            <thead>
              <tr>
                <th scope="col">Posten</th>
                <th scope="col" className="betrag">
                  Betrag
                </th>
                <th scope="col" className="ziffern">
                  Mietverhältnisse
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Kaltmiete</th>
                <td className="betrag">{euroGenau(struktur.kalt)}</td>
                <td className="ziffern">{struktur.anzahlAufgeteilt}</td>
              </tr>
              <tr>
                <th scope="row">Betriebskostenvorauszahlung</th>
                <td className="betrag">{euroGenau(struktur.nebenkosten)}</td>
                <td className="ziffern">{struktur.anzahlAufgeteilt}</td>
              </tr>
              <tr>
                <th scope="row">ohne Aufteilung</th>
                <td className="betrag">{euroGenau(struktur.ohneAufteilung)}</td>
                <td className="ziffern">{ohneAnzahl}</td>
              </tr>
              <tr>
                <th scope="row">davon Inklusivmieten</th>
                <td className="betrag">—</td>
                <td className="ziffern">{struktur.anzahlInklusiv}</td>
              </tr>
              <tr>
                <th scope="row">davon anteilige Monate</th>
                <td className="betrag">—</td>
                <td className="ziffern">{struktur.anzahlAnteilig}</td>
              </tr>
              {struktur.anzahlWidersprechend > 0 && (
                <tr>
                  <th scope="row">davon widersprüchliche Stammdaten</th>
                  <td className="betrag">—</td>
                  <td className="ziffern">{struktur.anzahlWidersprechend}</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">zusammen</th>
                <td className="betrag">{euroGenau(struktur.soll)}</td>
                <td className="ziffern">{struktur.anzahl}</td>
              </tr>
            </tfoot>
          </table>
        }
      />

      {struktur.stufen.length > 0 && (
        <Balken
          posten={struktur.stufen.map((st) => ({
            name: st.bis === null ? `ab ${st.von}` : `${st.bis}`,
            wert: st.anzahl,
            titel: `${st.bezeichnung}: ${st.anzahl} Mietverhältnisse, zusammen ${euroGenau(st.summe)}`,
            art: "akzent" as const,
          }))}
          hoehe={80}
          spur={44}
          achsen={2}
          achsenbreite={28}
          beschriftung={(w) => String(Math.round(w))}
          aussage={`Verteilung der ${struktur.anzahl} Mietverhältnisse nach Höhe des gestellten Solls, in Stufen bis ${struktur.stufen[struktur.stufen.length - 1]?.bis ?? 0} Euro. Die Zahlen je Stufe stehen in der Tabelle darunter.`}
          hinweis="Anzahl der Mietverhältnisse je Mietstufe, nach dem gestellten Soll. Die Beschriftung nennt die obere Grenze der Stufe in Euro."
          tabelleTitel="Verteilung nach Höhe"
          tabelle={
            <table>
              <caption>
                Je Stufe die Anzahl der Mietverhältnisse und ihr Soll zusammen.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Stufe</th>
                  <th scope="col" className="ziffern">
                    Anzahl
                  </th>
                  <th scope="col" className="betrag">
                    Soll zusammen
                  </th>
                </tr>
              </thead>
              <tbody>
                {struktur.stufen.map((st) => (
                  <tr key={st.von}>
                    <th scope="row">{st.bezeichnung}</th>
                    <td className="ziffern">{st.anzahl}</td>
                    <td className="betrag">{euroGenau(st.summe)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">zusammen</th>
                  <td className="ziffern">{struktur.anzahl}</td>
                  <td className="betrag">{euroGenau(struktur.soll)}</td>
                </tr>
              </tfoot>
            </table>
          }
        />
      )}
    </CockpitKarte>
  );
}
