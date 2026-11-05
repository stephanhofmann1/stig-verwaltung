import { LEER, STAND } from "@/components/MietenbuchRaster";
import type { LeerGrund, ZellStatus } from "@/lib/mietenbuch";

/**
 * Was die Zeichen, die Flächen und die Spalten im Raster bedeuten.
 *
 * Die Legende ist nicht Beiwerk. Zwei der sechs Zustände sehen auf einen
 * Blick nach Rückstand aus und sind keiner: "nicht abgeglichen" heisst, dass
 * für diesen Monat keine Kontoumsätze vorliegen, und "nicht erfasst" heisst,
 * dass die Belegung der Einheit nicht gepflegt ist. Wer das verwechselt,
 * mahnt die Falschen.
 *
 * Dazu kommen die Flächen und die Spaltenköpfe. Die Fläche hinter einer
 * Zelle und das Kürzel über einer Spalte waren bisher nirgends erklärt --
 * die Schraffur für Leerstand und die blaue Kante am laufenden Monat musste
 * man erraten, und "Kalt / BK" stand nur als Abkürzung da.
 *
 * Die Gestaltung steht in app/raster.css (Klassen mb-legende*). Vorher
 * standen die Maße hier als Inline-Stile und waren damit für jede
 * Überarbeitung des Gestaltungssystems unsichtbar.
 */

const REIHENFOLGE: Array<Exclude<ZellStatus, "leer">> = [
  "bezahlt",
  "teilweise",
  "offen",
  "nicht_faellig",
  "nicht_abgeglichen",
];

const LEER_REIHENFOLGE: LeerGrund[] = [
  "frei",
  "eltern",
  "unbekannt",
  "nicht_vermietbar",
];

/** Die Flächen, die im Raster hinter einer Zelle liegen. */
const FLAECHEN: Array<{ flaeche: string; name: string; was: string }> = [
  {
    flaeche: "bezahlt",
    name: "grün",
    was: "der Monat ist vollständig bezahlt",
  },
  {
    flaeche: "teilweise",
    name: "gelb",
    was: "es ist etwas angekommen, aber nicht alles",
  },
  {
    flaeche: "offen",
    name: "rot",
    was: "fällig und offen — hier entsteht eine Mahnung",
  },
  {
    flaeche: "frei",
    name: "schraffiert",
    was: "Leerstand: kein Mietverhältnis in diesem Monat",
  },
  {
    flaeche: "jetzt",
    name: "blaue Kante",
    was: "der laufende Monat",
  },
];

/** Die drei Spalten rechts, die für den ganzen Zeitraum stehen. */
const SPALTEN: Array<{ kopf: string; was: string }> = [
  {
    kopf: "Soll / Ist / Abw.",
    was:
      "erwartet, zugeordnet und die Differenz aus beidem — jeweils über den " +
      "gewählten Zeitraum",
  },
  {
    kopf: "Kalt / BK",
    was:
      "Kaltmiete und Betriebskostenvorauszahlung, soweit der Vertrag sie " +
      "trennt; darunter der Rest ohne Aufteilung (o. A.)",
  },
  {
    kopf: "Kaution",
    was: "hinterlegte Kaution, nicht Teil der Miete und nicht im Soll",
  },
];

/**
 * Die Summenzeilen unter jedem Objekt -- die Rechnung, die sie bilden.
 *
 * Das ist der Teil der Legende, der die teuerste Verwechslung dieser Seite
 * verhindert: "Kalt" ist **nicht** das Soll minus Betriebskosten. Wo keine
 * getrennte Kaltmiete vereinbart ist, steht in der Kaltzeile eine Null und
 * der ganze Betrag unter o. A. Wer die Kaltzeile als Kaltmiete aller
 * Einheiten liest, begründet daraus eine Mieterhöhung oder eine
 * Betriebskostenabrechnung über Beträge, die niemand vereinbart hat.
 */
const SUMMENZEILEN: Array<{ kopf: string; was: string }> = [
  {
    kopf: "Kalt",
    was:
      "Kaltmiete des Monats — nur aus Verträgen, die Kalt und Betriebskosten " +
      "getrennt ausweisen. Eine Inklusivmiete („alles inklusive“) hat keine " +
      "Kaltmiete und steht hier mit null",
  },
  {
    kopf: "BK",
    was:
      "Betriebskostenvorauszahlung des Monats, soweit der Vertrag sie " +
      "getrennt ausweist",
  },
  {
    kopf: "o. A.",
    was:
      "ohne Aufteilung: Soll, das sich nicht in Kalt und BK trennen lässt — " +
      "Inklusivmieten, Möblierungszuschläge und anteilige Monate bei Ein- " +
      "und Auszug. In diesem Haus ist das die größte der drei Größen",
  },
  {
    kopf: "Warm",
    was:
      "die Gesamtmiete des Monats und damit genau das, was auf dieser Seite " +
      "sonst Soll heisst: Warm = Kalt + BK + o. A. Keine zusätzliche Größe, " +
      "sondern die Summe der drei Zeilen darüber",
  },
  {
    kopf: "Ist / Abweichung / Leerstand",
    was:
      "zugeordnete Zahlungen, die Differenz zum vergleichbaren Soll und der " +
      "Anteil echten Leerstands an den vermietbaren Einheitsmonaten",
  },
];

export function MietenbuchLegende({
  ausschnitt = null,
}: {
  /**
   * Zeigt die Seite nur einen Ausschnitt? Dann muss es hier stehen.
   *
   * Nicht Beiwerk, sondern der Grund, warum die Legende diese Angabe
   * überhaupt trägt: Wer einen gefilterten Blick ausdruckt, hält ein Blatt
   * in der Hand, auf dem Summen stehen. Ohne diesen Satz sind das die
   * Summen des ganzen Hauses -- und aus ihnen entsteht eine Abrechnung oder
   * ein Mahnschreiben über Beträge, die nur für einen Teil der Einheiten
   * gelten.
   */
  ausschnitt?: { zeilen: number; gesamt: number; zurueck: string } | null;
}) {
  return (
    <div className="karte">
      <p className="karte-titel">Zeichen, Flächen und Spalten im Raster</p>

      {ausschnitt !== null && (
        <p className="meldung" data-art="warnung">
          <strong>
            Dieses Raster zeigt einen Ausschnitt: {ausschnitt.zeilen} von{" "}
            {ausschnitt.gesamt}{" "}
            {ausschnitt.gesamt === 1 ? "Einheit" : "Einheiten"}.
          </strong>{" "}
          Alle Summenzeilen, Spaltenfüße und Kennzahlen auf dieser Seite sind
          über diesen Ausschnitt gerechnet und nicht über das ganze Haus. Für
          eine Abrechnung oder ein Schreiben an einen Mieter ist das die
          falsche Grundlage, solange der Ausschnitt nicht genau die Einheiten
          enthält, um die es geht.{" "}
          <a className="verweis" href={ausschnitt.zurueck}>
            Alle Einheiten zeigen
          </a>
        </p>
      )}

      {/* Ein Raster aus vielen kleinen Begriffslisten statt einer großen:
          In einem <dl> dürfen nur dt, dd und div stehen -- die
          Zwischentitel sind Absätze und gehören deshalb daneben, nicht
          hinein. */}
      <div className="mb-legende">
        <p className="mb-legende-titel">Zustand eines Monats</p>
        {REIHENFOLGE.map((s) => {
          const k = STAND[s];
          return (
            <dl key={s}>
              <dt>
                <span className="punkt" data-art={k.art} />
                <strong>
                  <span aria-hidden="true">{k.zeichen}</span> {k.kurz}
                </strong>
              </dt>{" "}
              <dd>— {k.lang}</dd>
            </dl>
          );
        })}

        <p className="mb-legende-titel">Keine Miete in diesem Monat</p>
        {LEER_REIHENFOLGE.map((g) => {
          const k = LEER[g];
          return (
            <dl key={g}>
              <dt>
                <span className="punkt" data-art={k.art} />
                <strong>
                  <span aria-hidden="true">{k.zeichen}</span> {k.kurz}
                </strong>
              </dt>{" "}
              <dd>— {k.lang}</dd>
            </dl>
          );
        })}

        <p className="mb-legende-titel">Fläche hinter einer Zelle</p>
        {FLAECHEN.map((f) => (
          <dl key={f.flaeche}>
            <dt>
              <span
                className="mb-muster"
                data-flaeche={f.flaeche}
                aria-hidden="true"
              />
              <strong>{f.name}</strong>
            </dt>{" "}
            <dd>— {f.was}</dd>
          </dl>
        ))}

        <p className="mb-legende-titel">
          Die Summenzeilen unter jedem Haus
        </p>
        {SUMMENZEILEN.map((s) => (
          <dl key={s.kopf}>
            <dt>
              <strong>{s.kopf}</strong>
            </dt>{" "}
            <dd>— {s.was}</dd>
          </dl>
        ))}

        <p className="mb-legende-titel">Die drei Spalten rechts</p>
        {SPALTEN.map((s) => (
          <dl key={s.kopf}>
            <dt>
              <strong>{s.kopf}</strong>
            </dt>{" "}
            <dd>— {s.was}</dd>
          </dl>
        ))}
      </div>

      <p className="hinweis mb-legende-fuss">
        Beträge in Euro. Die <strong>Abweichung</strong> vergleicht nur Monate,
        die fällig sind <em>und</em> für die Kontoumsätze vorliegen; was
        bewusst draussen bleibt, steht in der{" "}
        <a href="#mb-fn-stern">Fußnote zum Sternchen</a> unter dem Raster. Die{" "}
        <strong>Leerstandsquote</strong> zählt nur Einheiten, die einzeln
        vermietet werden und deren Belegung gepflegt ist; ein Zimmer, das über
        den Vertrag seiner Etage belegt ist, ist kein Leerstand.
      </p>
    </div>
  );
}
