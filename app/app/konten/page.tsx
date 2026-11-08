import { query } from "@/lib/db";
import { KontoNeu } from "@/components/KontoNeu";
import { AuszugUpload } from "@/components/AuszugUpload";
import { KontodatenBeginn, type ObjektZeile } from "@/components/KontodatenBeginn";
import { fehlendeMonate, fasseZusammen } from "@/lib/luecken";
import { objektSicht } from "@/lib/objektsicht";

export const dynamic = "force-dynamic";

/**
 * Konten und Kontoauszüge.
 *
 * Diese Seite schließt die Lücke, durch die der ganze Zahlungsteil bis
 * hierhin unerreichbar war: Es gab keinen Weg, ein Konto anzulegen. Der
 * CSV-Import sucht sein Konto über die Bezeichnung und bricht ohne eines
 * ab; die FinTS-Einrichtung lässt nur unter einem bestehenden Konto
 * anlegen. Beide Wege hingen also an einer Tabelle, die leer blieb.
 *
 * Der Upload ist hier und nicht unter /zahlungen, weil er zum Konto
 * gehört. /zahlungen bleibt die Seite für das, was danach kommt — das
 * Zuordnen.
 */

interface ImportZeile {
  id: string;
  konto: string;
  dateiname: string | null;
  format: string;
  zeitraum_von: string | null;
  zeitraum_bis: string | null;
  gelesen: number;
  neu: number;
  bereits_bekannt: number;
  warnungen: string[];
  abgeschnitten: boolean;
  geraten: boolean;
  zeitpunkt: string;
}

interface KontoZeile {
  id: string;
  bezeichnung: string;
  art: string;
  iban_kurz: string | null;
  objekt: string | null;
  notizen: string | null;
  buchungen: string;
  erste: string | null;
  letzte: string | null;
  hat_bankzugang: boolean;
  /** Beginn der Kontodaten des Objekts, an dem dieses Konto hängt. */
  grenze: string | null;
  /** Monate mit mindestens einer Buchung, als "JJJJ-MM". */
  monate: string[];
}

const zeitpunkt = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));

const datum = (iso: string | null) =>
  iso === null
    ? "—"
    : new Intl.DateTimeFormat("de-DE", {
        day: "2-digit", month: "2-digit", year: "numeric",
      }).format(new Date(iso));

/**
 * Welche Monate auf diesem Konto gar keine Buchung haben.
 *
 * Gezaehlt wird ab dem Beginn der Kontodaten des Objekts, sonst ab der
 * ersten Buchung -- und nur bis zum Vormonat: Der laufende Monat ist
 * naturgemaess unvollstaendig.
 */
function luecken(k: KontoZeile) {
  if (Number(k.buchungen) === 0) {
    return <span className="hinweis">—</span>;
  }
  const fehlt = fehlendeMonate(
    k.grenze ?? k.erste,
    new Date().toISOString().slice(0, 10),
    k.monate,
  );
  if (fehlt.length === 0) {
    return (
      <span className="rueckmeldung" data-art="gut">
        keine
      </span>
    );
  }
  // Die Marke statt des Hex: eine Inline-Farbe bleibt im Dunkelmodus
  // stehen, wo sie nicht mehr lesbar ist.
  return (
    <span className="rueckmeldung" data-art="fehler">
      {fehlt.length} {fehlt.length === 1 ? "Monat" : "Monate"}
      <div className="rueckmeldung" data-art="fehler">
        {fasseZusammen(fehlt).join(" · ")}
      </div>
    </span>
  );
}

export default async function Konten() {
  // Ein Konto gehoert zu einem Haus (konto.objekt_id). Die Wahl im Kopf
  // gilt deshalb hier unmittelbar -- anders als bei den Arbeitsvorraeten
  // Belege und Zahlungen, wo ein Filter Arbeit verstecken wuerde.
  const { gewaehlt } = await objektSicht();
  const objektId = gewaehlt?.id ?? null;

  const [konten, importe, objekte] = await Promise.all([
    query<KontoZeile>(
      `
      SELECT k.id, k.bezeichnung, k.art, k.iban_kurz, k.notizen,
             o.name AS objekt,
             count(b.id)::text        AS buchungen,
             min(b.buchungstag)::text AS erste,
             max(b.buchungstag)::text AS letzte,
             EXISTS (SELECT 1 FROM fints_zugang z WHERE z.konto_id = k.id)
               AS hat_bankzugang,
             o.zahlungsdaten_ab::text AS grenze,
             -- Nur die Monate, nicht die Tage: Fuer die Luecken genuegt,
             -- ob ein Monat ueberhaupt etwas enthaelt.
             COALESCE(
               array_agg(DISTINCT to_char(b.buchungstag, 'YYYY-MM'))
                 FILTER (WHERE b.buchungstag IS NOT NULL),
               '{}') AS monate
        FROM konto k
        LEFT JOIN objekt o  ON o.id = k.objekt_id
        LEFT JOIN buchung b ON b.konto_id = k.id
       WHERE ($1::uuid IS NULL OR k.objekt_id = $1)
       GROUP BY k.id, k.bezeichnung, k.art, k.iban_kurz, k.notizen, o.name,
                o.zahlungsdaten_ab
       ORDER BY k.bezeichnung
    `,
      [objektId],
    ),
    query<ImportZeile>(
      `
      SELECT i.id, k.bezeichnung AS konto, i.dateiname, i.format,
             i.zeitraum_von::text, i.zeitraum_bis::text,
             i.gelesen, i.neu, i.bereits_bekannt,
             i.warnungen, i.abgeschnitten, i.geraten,
             i.zeitpunkt::text
        FROM auszug_import i
        JOIN konto k ON k.id = i.konto_id
       WHERE ($1::uuid IS NULL OR k.objekt_id = $1)
       ORDER BY i.zeitpunkt DESC
       LIMIT 25
    `,
      [objektId],
    ),
    query<ObjektZeile & { id: string; name: string }>(
      `
      SELECT o.id, o.name, o.zahlungsdaten_ab::text,
             min(b.buchungstag)::text AS erste_buchung,
             count(b.id)::text        AS buchungen
        FROM objekt o
        LEFT JOIN konto k   ON k.objekt_id = o.id
        LEFT JOIN buchung b ON b.konto_id  = k.id
       WHERE ($1::uuid IS NULL OR o.id = $1)
       GROUP BY o.id, o.name, o.zahlungsdaten_ab
       ORDER BY o.name
    `,
      [objektId],
    ),
  ]);

  const namen = konten.map((k) => k.bezeichnung);

  return (
    <main>
      <h1>{gewaehlt ? `Konten — ${gewaehlt.name}` : "Konten"}</h1>

      {konten.length === 0 ? (
        <p className="hinweis">
          Noch kein Konto angelegt. Solange hier keines steht, kommen keine
          Zahlungen in die Verwaltung — weder aus einem CSV-Auszug noch über
          die Bankanbindung. Beide brauchen ein Konto, an dem die Buchungen
          hängen.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Konto</th>
              <th>Objekt</th>
              <th>Buchungen</th>
              <th>Zeitraum</th>
              <th>Fehlende Monate</th>
              <th>Bankzugang</th>
            </tr>
          </thead>
          <tbody>
            {konten.map((k) => (
              <tr key={k.id}>
                <td>
                  {k.bezeichnung}
                  {k.iban_kurz && (
                    <span className="hinweis"> ··{k.iban_kurz}</span>
                  )}
                  {k.art === "barkasse" && (
                    <span className="hinweis"> (Barkasse)</span>
                  )}
                  {k.notizen && <div className="hinweis">{k.notizen}</div>}
                </td>
                <td>{k.objekt ?? "—"}</td>
                <td className="betrag">{k.buchungen}</td>
                <td>
                  {Number(k.buchungen) === 0
                    ? "—"
                    : `${datum(k.erste)} – ${datum(k.letzte)}`}
                </td>
                <td>{luecken(k)}</td>
                <td>{k.hat_bankzugang ? "eingerichtet" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p>
        <KontoNeu objekte={objekte} />
      </p>

      {/* Ein h1 je Seite. Die Abschnitte darunter sind h2 -- acht h1
          hintereinander sind fuer einen Screenreader acht Dokumente. */}
      <h2 className="abschnitt">Beginn der Kontodaten</h2>
      <p className="hinweis">
        Ab diesem Tag gilt ein Monat als abgeglichen. Monate davor werden
        nie gemahnt — für sie liegen keine Kontodaten vor. Der Wert gehört
        auf die erste Buchung, die wirklich in der Datenbank liegt, nicht
        auf das Eröffnungsdatum des Kontos: Sonst sehen Monate ohne Daten
        wie Rückstände aus.
      </p>
      <KontodatenBeginn objekte={objekte} />

      <h2 className="abschnitt">Kontoauszug einlesen</h2>
      <p className="hinweis">
        Erst lesen, dann übernehmen. Bis du auf „Übernehmen“ klickst, wird
        nichts gespeichert. Dieselbe Datei mehrfach einzulesen ist gefahrlos
        — doppelte Buchungen fallen über ihren Fingerabdruck heraus.
      </p>
      <AuszugUpload konten={namen} />

      <h2 className="abschnitt">Eingelesene Auszüge</h2>
      {importe.length === 0 ? (
        <p className="hinweis">
          Noch nichts protokolliert. Ab jetzt steht hier jeder eingelesene
          Auszug mit seinem Zeitraum und allen Warnungen — damit später
          nachlesbar bleibt, ob eine Datei abgeschnitten war.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Wann</th>
              <th>Konto / Datei</th>
              <th>Zeitraum</th>
              <th>Gelesen</th>
              <th>Befund</th>
            </tr>
          </thead>
          <tbody>
            {importe.map((i) => (
              <tr key={i.id}>
                <td>{zeitpunkt(i.zeitpunkt)}</td>
                <td>
                  {i.konto}
                  {i.dateiname && (
                    <div className="hinweis">{i.dateiname}</div>
                  )}
                </td>
                <td>
                  {i.zeitraum_von
                    ? `${datum(i.zeitraum_von)} – ${datum(i.zeitraum_bis)}`
                    : "—"}
                </td>
                <td className="betrag">
                  {i.gelesen}
                  <div className="hinweis">
                    {i.neu} neu
                    {i.bereits_bekannt > 0 && `, ${i.bereits_bekannt} bekannt`}
                  </div>
                </td>
                <td>
                  {i.abgeschnitten && (
                    <div className="rueckmeldung" data-art="fehler">
                      <strong>Abgeschnitten.</strong> Der Zeitraum sieht
                      vollständig aus, ist es aber nicht — in Scheiben von
                      höchstens drei Monaten erneut exportieren.
                    </div>
                  )}
                  {i.geraten && (
                    <div className="rueckmeldung" data-art="fehler">
                      Format unbekannt, Spalten geraten.
                    </div>
                  )}
                  {!i.abgeschnitten && !i.geraten && i.warnungen.length === 0 && (
                    <span className="rueckmeldung" data-art="gut">
                      {i.format}, ohne Befund
                    </span>
                  )}
                  {i.warnungen.length > 0 && (
                    <details>
                      <summary className="hinweis">
                        {i.warnungen.length}{" "}
                        {i.warnungen.length === 1 ? "Warnung" : "Warnungen"}
                      </summary>
                      {i.warnungen.map((w, n) => (
                        <div key={n} className="hinweis">{w}</div>
                      ))}
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
