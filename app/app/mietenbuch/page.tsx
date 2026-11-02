import { ladeMietenbuch, zeitraumFuer } from "@/lib/mietenbuch";
import { MietenbuchRaster } from "@/components/MietenbuchRaster";
import { MietenbuchLegende } from "@/components/MietenbuchLegende";
import { MietenbuchZeitraum } from "@/components/MietenbuchZeitraum";

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
function objekteOhneKontodaten(raster: Awaited<ReturnType<typeof ladeMietenbuch>>) {
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
  searchParams: Promise<{ jahr?: string }>;
}) {
  const { jahr } = await searchParams;
  const heute = new Date();
  const gewaehlt = gewaehltesJahr(jahr, heute);
  const zeitraum = zeitraumFuer(gewaehlt, heute);
  const raster = await ladeMietenbuch(zeitraum, heute);

  const laufend = heute.toISOString().slice(0, 7) + "-01";
  const s = raster.summe;
  const einheiten = raster.gruppen.reduce((n, g) => n + g.zeilen.length, 0);

  const jahre: number[] = [];
  for (let j = heute.getFullYear(); j >= ERSTES_JAHR; j--) jahre.push(j);

  const ohneDaten = s.soll_ohne_daten >= 1;
  const betroffen = objekteOhneKontodaten(raster);

  return (
    <main>
      <div className="titelzeile">
        <h1>Mietenbuch</h1>
        <span className="zaehler">
          {einheiten} {einheiten === 1 ? "Einheit" : "Einheiten"} ·{" "}
          {zeitraum.monate.length} Monate · {zeitraum.titel}
        </span>
      </div>

      <div style={{ marginBottom: "var(--abstand-5)" }}>
        <MietenbuchZeitraum jahr={gewaehlt} jahre={jahre} />
      </div>

      {einheiten === 0 ? (
        <div className="leer">
          <strong>Für diesen Zeitraum steht nichts im Buch</strong>
          Es gibt keine Einheiten oder keine Mietverhältnisse, die diesen
          Ausschnitt berühren. Ein anderes Jahr wählen oder die Stammdaten
          prüfen.
        </div>
      ) : (
        <>
          <div className="karten">
            <div className="karte kennzahl">
              <span className="kennzahl-schild">Soll im Zeitraum</span>
              <span className="kennzahl-wert">{EURO.format(s.soll)}</span>
              <span className="hinweis" style={{ margin: 0, maxWidth: "none" }}>
                gestellt oder vertraglich erwartet
              </span>
            </div>
            <div className="karte kennzahl">
              <span className="kennzahl-schild">Ist im Zeitraum</span>
              <span className="kennzahl-wert">{EURO.format(s.ist)}</span>
              <span className="hinweis" style={{ margin: 0, maxWidth: "none" }}>
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
              <span className="hinweis" style={{ margin: 0, maxWidth: "none" }}>
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
              <span className="hinweis" style={{ margin: 0, maxWidth: "none" }}>
                {s.monate_leer} von {s.monate_vermietbar} Einheitsmonaten
              </span>
            </div>
          </div>

          {ohneDaten && (
            <p className="hinweis" style={{ maxWidth: "none" }}>
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
          <MietenbuchLegende />
        </>
      )}
    </main>
  );
}
