import {
  filterGesetzt,
  filterRaster,
  ladeMietenbuch,
  leererFilter,
  lesefilter,
  mietenbuchAdresse,
  zeilenZahl,
  zeitraumFuer,
  type Raster,
  type Suchparameter,
} from "@/lib/mietenbuch";
import { MietenbuchRaster } from "@/components/MietenbuchRaster";
import { MietenbuchLegende } from "@/components/MietenbuchLegende";
import { MietenbuchZeitraum } from "@/components/MietenbuchZeitraum";
import { MietenbuchFilter } from "@/components/MietenbuchFilter";
import { objektSicht } from "@/lib/objektsicht";

export const dynamic = "force-dynamic";

/**
 * Das Mietenbuch.
 *
 * Die Darstellung, die Stephan am wichtigsten ist: "wann sind welche Zimmer
 * frei, belegt, zu welchen Preisen, Cashflow". Bisher führt er das in einer
 * Numbers-Datei, in der je Einheit Soll und reale Eingänge nebeneinander
 * stehen. Was dort fehlt, ist die Zeit: Die Datei zeigt einen Stand, nicht
 * den Verlauf, und deshalb sieht man nicht, ab welchem Monat jemand anfing,
 * zu wenig zu zahlen, und wie lange ein Zimmer leer stand.
 *
 * Zeilen sind Einheiten in Hausordnung, Spalten sind Monate. Jede Zelle
 * nennt den Mieter, den Sollbetrag und den Zustand -- und unterscheidet
 * Leerstand von Rückstand von "wir haben für diesen Monat keine
 * Kontoauszüge". Diese drei zu verwechseln ist der einzige Fehler, den
 * diese Seite wirklich teuer machen könnte.
 */

/**
 * Erstes Jahr, für das es überhaupt etwas zu sehen gibt. Abgerechnet wird
 * ab Januar 2024 (so von Stephan festgelegt, siehe db/021); frühere Jahre
 * wären leere Raster.
 */
const ERSTES_JAHR = 2024;

/** Nimmt nur ein Jahr an, das es geben kann. Alles andere: letzte 12 Monate. */
function gewaehltesJahr(wert: string | undefined, heute: Date): number | null {
  if (!wert || !/^\d{4}$/.test(wert)) return null;
  const j = Number(wert);
  if (j < ERSTES_JAHR || j > heute.getFullYear() + 1) return null;
  return j;
}

const EURO = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const TAG = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/**
 * Die Objekte, bei denen Soll in Monaten ohne Kontodaten steht -- benannt.
 *
 * Der Name und die Deckungsgrenze kommen aus dem Raster und damit aus der
 * Datenbank (objekt.name, objekt.zahlungsdaten_ab). Im Quelltext stand hier
 * früher ein Haus mit Datum; das war für jeden anderen Vermieter falsch und
 * las sich wie ein Fremdbestand. Die Aussage bleibt dieselbe: Es ist
 * wichtig, welches Haus gemeint ist, sonst sucht man am falschen Ort.
 */
function objekteOhneKontodaten(raster: Raster) {
  return raster.gruppen
    .filter((g) => g.summe.soll_ohne_daten >= 1)
    .map((g) =>
      g.zahlungsdaten_ab === null
        ? `${g.objekt_name} (kein eigenes Konto)`
        : `${g.objekt_name} (Kontodaten ab ` +
          `${TAG.format(new Date(g.zahlungsdaten_ab.slice(0, 10) + "T12:00:00Z"))})`,
    );
}

export default async function Mietenbuch({
  searchParams,
}: {
  searchParams: Promise<Suchparameter>;
}) {
  const params = await searchParams;
  const heute = new Date();
  const { gewaehlt: gewaehltesHaus } = await objektSicht();
  const gewaehlt = gewaehltesJahr(
    typeof params.jahr === "string" ? params.jahr : undefined,
    heute,
  );
  const zeitraum = zeitraumFuer(gewaehlt, heute);

  // Geladen wird das ganze Buch, gefiltert wird danach. Zwei Gründe: Der
  // Filter soll keine Abfrage je Tastendruck auslösen -- es bleiben fünf
  // Abfragen je Seitenaufruf, unabhängig von der Größe des Rasters --, und
  // die Angabe "X von Y Einheiten" braucht das Y.
  const alles = await ladeMietenbuch(zeitraum, heute);

  /*
    Das Haus kommt aus dem Kopf, nicht aus der Adresse (08.11.2026).

    Bis dahin hatte das Mietenbuch einen eigenen Objektfilter in seiner
    Leiste. Seit es den Umschalter im Kopf gibt, waeren das zwei Stellen
    fuer dieselbe Entscheidung gewesen -- und beim Lesen einer Zahl
    nicht mehr zu sagen, welche gerade gilt.

    Ein altes ?objekt=... in der Adresse wird deshalb bewusst ignoriert:
    lesefilter() bekommt eine leere Liste bekannter Objekte und liefert
    dafuer null. Ein veralteter Verweis zeigt dann das, was im Kopf
    steht -- und nicht stillschweigend etwas anderes als der Umschalter
    daneben behauptet.
  */
  const filter = {
    ...lesefilter(params, []),
    objekt: gewaehltesHaus?.id ?? null,
  };
  const gefiltert = filterGesetzt(filter);
  const raster = filterRaster(alles, filter);

  const laufend = heute.toISOString().slice(0, 7) + "-01";
  const s = raster.summe;
  const einheiten = zeilenZahl(raster);
  const einheitenGesamt = zeilenZahl(alles);
  const zurueck = mietenbuchAdresse(leererFilter(), gewaehlt);

  const jahre: number[] = [];
  for (let j = heute.getFullYear(); j >= ERSTES_JAHR; j--) jahre.push(j);

  const ohneDaten = s.soll_ohne_daten >= 1;
  const betroffen = objekteOhneKontodaten(raster);

  return (
    <main>
      <div className="titelzeile">
        <h1>
          {gewaehltesHaus ? `Mietenbuch — ${gewaehltesHaus.name}` : "Mietenbuch"}
        </h1>
        <span className="zaehler">
          {gefiltert
            ? `${einheiten} von ${einheitenGesamt} Einheiten`
            : `${einheiten} ${einheiten === 1 ? "Einheit" : "Einheiten"}`}
          {" · "}
          {zeitraum.monate.length} Monate · {zeitraum.titel}
        </span>
      </div>

      <MietenbuchZeitraum jahr={gewaehlt} jahre={jahre} filter={filter} />

      {/* Keine Filterleiste über einem Buch, in dem nichts steht -- dort
          gibt es nichts einzugrenzen, und vier leere Felder sähen wie der
          Grund für die leere Seite aus. */}
      {einheitenGesamt > 0 && (
        <MietenbuchFilter
          filter={filter}
          jahr={gewaehlt}
          zeilen={einheiten}
          gesamt={einheitenGesamt}
        />
      )}

      {einheiten === 0 ? (
        /* Zwei verschiedene Nullen, und sie dürfen nicht gleich aussehen:
           Ein Filter ohne Treffer ist kein leeres Buch. Stünde hier
           derselbe Satz, suchte man den Fehler in den Stammdaten statt im
           Filterfeld. */
        gefiltert ? (
          <div className="leer">
            <strong>Kein Treffer in diesem Ausschnitt</strong>
            Keine Einheit passt zu diesem Filter. Das Buch selbst ist nicht
            leer: Ohne Filter stehen {einheitenGesamt}{" "}
            {einheitenGesamt === 1 ? "Einheit" : "Einheiten"} in diesem
            Zeitraum.{" "}
            <a className="verweis" href={zurueck}>
              Alle Einheiten zeigen
            </a>
          </div>
        ) : (
          <div className="leer">
            <strong>Für diesen Zeitraum steht nichts im Buch</strong>
            Es gibt keine Einheiten oder keine Mietverhältnisse, die diesen
            Ausschnitt berühren. Ein anderes Jahr wählen oder die Stammdaten
            prüfen.
          </div>
        )
      ) : (
        <>
          {/* Die vier Kennzahlkarten rechnen über das, was zu sehen ist --
              sonst stünde über einem Ausschnitt von vier Zimmern die
              Abweichung des ganzen Hauses, und man schriebe die Summe von
              fünfzig Einheiten vier Mietern zu. Dass sie das tun, muss
              dabeistehen: Eine Zahl, die kleiner geworden ist, ohne dass
              jemand gezahlt hat, ist ohne diesen Satz nicht erklärbar. */}
          {gefiltert && (
            <p className="meldung" data-art="info">
              <strong>
                Alle Zahlen auf dieser Seite gelten für den Ausschnitt:{" "}
                {einheiten} von {einheitenGesamt}{" "}
                {einheitenGesamt === 1 ? "Einheit" : "Einheiten"}.
              </strong>{" "}
              Kennzahlen, Spaltenfüße und Summenzeilen sind über die
              sichtbaren Zeilen neu gerechnet, nicht über das ganze Buch.{" "}
              <a className="verweis" href={zurueck}>
                Alle Einheiten zeigen
              </a>
            </p>
          )}

          <div className="karten">
            <div className="karte kennzahl">
              <span className="kennzahl-schild">Soll im Zeitraum</span>
              <span className="kennzahl-wert">{EURO.format(s.soll)}</span>
              <span className="hinweis mb-fuss">
                gestellt oder vertraglich erwartet
              </span>
            </div>
            <div className="karte kennzahl">
              <span className="kennzahl-schild">Ist im Zeitraum</span>
              <span className="kennzahl-wert">{EURO.format(s.ist)}</span>
              <span className="hinweis mb-fuss">
                zugeordnete Zahlungen
              </span>
            </div>
            <div className="karte kennzahl">
              <span className="kennzahl-schild">Abweichung</span>
              <span
                className="kennzahl-wert"
                data-art={
                  s.abweichung <= -1 ? "fehl" : s.abweichung >= 1 ? "warn" : "gut"
                }
              >
                {s.abweichung > 0 ? "+" : ""}
                {EURO.format(s.abweichung)}
              </span>
              <span className="hinweis mb-fuss">
                nur fällige Monate mit Kontodaten
              </span>
            </div>
            <div className="karte kennzahl">
              <span className="kennzahl-schild">Leerstand</span>
              <span className="kennzahl-wert">
                {s.leerstandsquote === null
                  ? "—"
                  : `${(s.leerstandsquote * 100).toLocaleString("de-DE", {
                      maximumFractionDigits: 0,
                    })} %`}
              </span>
              <span className="hinweis mb-fuss">
                {s.monate_leer} von {s.monate_vermietbar} Einheitsmonaten
              </span>
            </div>
          </div>

          {ohneDaten && (
            <p className="hinweis mb-voll">
              <strong>
                {EURO.format(s.soll_ohne_daten)} stehen in Monaten ohne
                Kontodaten.
              </strong>{" "}
              Diese Monate sind nicht unbezahlt, sondern unbekannt: Abgerechnet
              wird ab einem Monat, für den noch keine Kontoumsätze vorliegen,
              und die Mieten davor flossen dem Voreigentümer zu.
              {betroffen.length > 0 && <> Betroffen: {betroffen.join(", ")}.</>}{" "}
              Sie zählen deshalb nicht in die Abweichung und lösen keine
              Mahnung aus — zu klären sind sie über die Mietaufstellungen des
              Voreigentümers, nicht über ein Schreiben an den Mieter.
            </p>
          )}

          <MietenbuchRaster raster={raster} laufend={laufend} />
          <MietenbuchLegende
            ausschnitt={
              gefiltert
                ? { zeilen: einheiten, gesamt: einheitenGesamt, zurueck }
                : null
            }
          />
        </>
      )}
    </main>
  );
}
