import { sollIstLage, type SollIstPunkt } from "@/lib/kennzahlen";
import { Verlauf } from "@/components/Diagramm";
import {
  CockpitKarte,
  Erklaerung,
  euro,
  euroGenau,
  monatKurz,
  monatsName,
} from "@/components/CockpitKarte";

/**
 * Soll gegen Ist, zwoelf Monate.
 *
 * Die Frage, die das Cockpit bisher nicht beantworten konnte: **Ab welchem
 * Monat blieben die Zahlungen hinter dem Soll zurueck?** Der laufende Monat
 * stand da, und der Cashflow aus Kontobuchungen -- aber ein Rueckstand, der
 * im Maerz begann, sah im November genauso aus wie einer von gestern.
 *
 * Die Falle, auf die hier alles ankommt: **Ein Monat ohne Kontodaten ist
 * nicht ein Monat ohne Zahlung.** `objekt.zahlungsdaten_ab` (db/023) sagt je
 * Objekt, ab wann Kontoumsaetze vorliegen; ist die Spalte leer, liegen fuer
 * dieses Objekt gar keine vor. Vorher kann die Miete einem Voreigentuemer
 * zugeflossen sein oder ueber ein Konto gelaufen sein, das die Verwaltung
 * nicht sieht. Wann das war, ist je Mandant und je Objekt verschieden --
 * nichts davon steht hier im Quelltext.
 *
 * Solche Monate erscheinen als **Luecke** -- ein blasses Band, keine Linie,
 * und die Beschriftung bleibt blass. Sie fallen nicht auf Null. Eine Linie,
 * die auf Null faellt, weil Daten fehlen, ist in dieser Anwendung der
 * teuerste moegliche Fehler: Aus ihr entsteht ein Mahnschreiben an jemanden,
 * der bezahlt hat.
 *
 * Verglichen wird darum nicht das ganze gestellte Soll, sondern nur sein
 * **abgleichbarer Teil**. Liegen in einem Monat zwei Objekte mit
 * verschiedenem Beginn der Kontodaten, zeigt die Linie nur den Teil mit
 * Daten, und der Hinweis nennt den Rest. Das ganze gestellte Soll steht in
 * der Tabelle -- dort kann es niemand als Rueckstand missverstehen.
 *
 * Gerechnet wird nichts hier: `sollIstReihe()` und `sollIstLage()` stehen in
 * lib/kennzahlen.ts und haben Tests.
 */

export function CockpitVerlauf({ reihe }: { reihe: SollIstPunkt[] }) {
  const lage = sollIstLage(reihe);

  if (reihe.length === 0 || lage.belastbar === 0) {
    const nurLuecken = reihe.length > 0;
    return (
      <CockpitKarte
        titel="Soll gegen Ist, 12 Monate"
        zaehler="keine Aussage möglich"
        hinweis={
          nurLuecken
            ? "Für keinen der zwölf Monate liegen Soll und Kontodaten zusammen vor."
            : "Es konnten keine Sollstellungen gelesen werden."
        }
      >
        <div className="leer">
          <strong>Hier ist noch nichts zu vergleichen</strong>
          {nurLuecken ? (
            <>
              Ein Verlauf entsteht, sobald für einen Monat beides vorliegt: eine
              gestellte Sollstellung und Kontoumsätze ab diesem Monat
              (<code>objekt.zahlungsdaten_ab</code>). Eine Null-Linie stünde
              hier für „nichts bezahlt“ — tatsächlich ist über die Zahlungen
              nichts bekannt.
            </>
          ) : (
            <>
              Sobald der Nachtlauf Sollstellungen erzeugt hat, stehen hier zwölf
              Monate Soll gegen Ist.
            </>
          )}
        </div>
      </CockpitKarte>
    );
  }

  const spalten = reihe.map((p) => ({
    name: monatKurz(p.monat),
    luecke: p.luecke,
    titel: p.luecke
      ? p.grund === "nichts_gestellt"
        ? `${monatsName(p.monat)}: keine Sollstellung — es war nichts zu zahlen`
        : `${monatsName(p.monat)}: keine Kontodaten — über Zahlungen ist nichts bekannt. Gestellt waren ${euroGenau(p.soll)}.`
      : `${monatsName(p.monat)}: Soll ${euroGenau(p.sollVergleichbar ?? 0)}, Ist ${euroGenau(p.ist ?? 0)}` +
        ((p.rest ?? 0) >= 1 ? `, offen ${euroGenau(p.rest ?? 0)}` : " — gedeckt") +
        (p.teilweiseOhneDaten
          ? `. Zusätzlich ${euroGenau(p.sollOhneDaten)} ohne Kontodaten, dazu keine Aussage.`
          : ""),
  }));

  const quote =
    lage.summeVergleichbar > 0
      ? Math.round((lage.summeIst / lage.summeVergleichbar) * 100)
      : null;

  return (
    <CockpitKarte
      titel="Soll gegen Ist, 12 Monate"
      zaehler={
        lage.abMonat === null
          ? "ohne Rückstand"
          : `offen ab ${monatKurz(lage.abMonat)}`
      }
      hinweis={
        <>
          Gestelltes Soll gegen zugeordnete Zahlungen, je Monat. Verglichen wird
          nur der Teil, für den Kontodaten vorliegen —{" "}
          {lage.belastbar} von {lage.monate} Monaten.
        </>
      }
      erklaerung={
        <Erklaerung satz="Ein Monat ohne Kontodaten ist eine Lücke und kein Ist von Null — sonst entstünde aus fehlenden Auszügen ein Rückstand">
          <p className="hinweis">
            Die Kontoauszüge beginnen je Objekt zu einem eigenen Zeitpunkt
            (<code>objekt.zahlungsdaten_ab</code>, db/023) — und für ein Objekt
            ohne hinterlegtes Konto gibt es sie gar nicht. Für Monate davor ist
            unbekannt, ob gezahlt wurde; unbekannt ist kein Rückstand.
          </p>
          <p className="hinweis">
            Deshalb zeigt die Ist-Linie nur Monate mit Kontodaten, und die
            Soll-Linie nur den abgleichbaren Teil des Solls. Das vollständige
            gestellte Soll steht in der Tabelle, Spalte „gestellt“, zusammen
            mit dem Teil, über den sich nichts sagen lässt
            {lage.summeOhneDaten > 0 ? (
              <> — in diesen zwölf Monaten {euroGenau(lage.summeOhneDaten)}</>
            ) : null}
            .
          </p>
          <p className="hinweis">
            Als offen zählt ein Rest ab einem Euro. Darunter ist es Rundung aus
            anteiligen Monaten — dieselbe Schwelle wie in{" "}
            <code>monatsStatus()</code>.
          </p>
        </Erklaerung>
      }
    >
      <Verlauf
        spalten={spalten}
        linien={[
          {
            name: "Ist (zugeordnet)",
            art: "akzent",
            werte: reihe.map((p) => p.ist),
            flaeche: true,
          },
          {
            name: "Soll (abgleichbar)",
            art: "leise",
            werte: reihe.map((p) => p.sollVergleichbar),
            gestrichelt: true,
          },
        ]}
        beschriftung={euro}
        aussage={
          `Zugeordnete Zahlungen gegen das abgleichbare Soll, ${lage.monate} Monate. ` +
          (lage.abMonat === null
            ? `In allen ${lage.belastbar} belastbaren Monaten war das Soll gedeckt.`
            : `Ab ${monatsName(lage.abMonat)} blieb das Ist hinter dem Soll zurück, in ${lage.monateMitRest} von ${lage.belastbar} belastbaren Monaten, zusammen ${euro(lage.summeRest)}.`) +
          (lage.luecken > 0
            ? ` ${lage.luecken} Monate sind Lücken ohne Kontodaten — dort ist über Zahlungen nichts bekannt.`
            : "") +
          " Die Zahlen je Monat stehen in der Tabelle darunter."
        }
        hinweis={
          <>
            {lage.abMonat === null ? (
              <>Kein Monat mit Rückstand über einem Euro. </>
            ) : (
              <>
                Erster Monat mit Rückstand: {monatsName(lage.abMonat)}. In{" "}
                {lage.monateMitRest} von {lage.belastbar} belastbaren Monaten
                zusammen {euroGenau(lage.summeRest)} offen.{" "}
              </>
            )}
            {quote !== null && <>Deckungsquote {quote} %. </>}
            {lage.luecken > 0 && (
              <>
                {lage.luecken} blasse Spalten sind Lücken: dort fehlen
                Kontodaten, und über Zahlungen ist nichts bekannt.
              </>
            )}
          </>
        }
        leerTitel="Hier ist noch nichts zu vergleichen"
        leerSatz="Ein Verlauf entsteht, sobald für einen Monat Sollstellung und Kontoumsätze zusammen vorliegen."
        tabelleTitel="Soll und Ist je Monat"
        tabelle={
          <table>
            <caption>
              Soll aus <code>sollstellung</code>, Ist aus <code>zuordnung</code>.
              „ohne Daten“ ist der Teil des Solls ohne Kontoumsätze — er wird
              nie zum Rückstand addiert.
            </caption>
            <thead>
              <tr>
                <th scope="col">Monat</th>
                <th scope="col" className="betrag">
                  gestellt
                </th>
                <th scope="col" className="betrag">
                  ohne Daten
                </th>
                <th scope="col" className="betrag">
                  Soll vergleichbar
                </th>
                <th scope="col" className="betrag">
                  Ist
                </th>
                <th scope="col" className="betrag">
                  offen
                </th>
              </tr>
            </thead>
            <tbody>
              {reihe.map((p) => (
                <tr key={p.monat}>
                  <th scope="row">{monatKurz(p.monat)}</th>
                  <td className="betrag">{euroGenau(p.soll)}</td>
                  <td className="betrag">
                    {p.sollOhneDaten > 0 ? euroGenau(p.sollOhneDaten) : "—"}
                  </td>
                  {/* Gedankenstrich und nicht 0,00 EUR: Eine Null hiesse
                      "nichts gefordert" bzw. "nichts gezahlt". Hier ist es
                      "nicht bekannt", und das ist ein anderer Satz. */}
                  <td className="betrag">
                    {p.sollVergleichbar === null
                      ? "—"
                      : euroGenau(p.sollVergleichbar)}
                  </td>
                  <td className="betrag">
                    {p.ist === null ? "—" : euroGenau(p.ist)}
                  </td>
                  <td className="betrag">
                    {p.rest === null
                      ? "—"
                      : p.rest >= 1
                        ? euroGenau(p.rest)
                        : "gedeckt"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">zusammen (nur mit Daten)</th>
                <td className="betrag">—</td>
                <td className="betrag">{euroGenau(lage.summeOhneDaten)}</td>
                <td className="betrag">{euroGenau(lage.summeVergleichbar)}</td>
                <td className="betrag">{euroGenau(lage.summeIst)}</td>
                <td className="betrag">{euroGenau(lage.summeRest)}</td>
              </tr>
            </tfoot>
          </table>
        }
      />
    </CockpitKarte>
  );
}
