import { query } from "@/lib/db";
import { KontoNeu } from "@/components/KontoNeu";
import { AuszugUpload } from "@/components/AuszugUpload";

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
}

const datum = (iso: string | null) =>
  iso === null
    ? "—"
    : new Intl.DateTimeFormat("de-DE", {
        day: "2-digit", month: "2-digit", year: "numeric",
      }).format(new Date(iso));

export default async function Konten() {
  const [konten, objekte] = await Promise.all([
    query<KontoZeile>(`
      SELECT k.id, k.bezeichnung, k.art, k.iban_kurz, k.notizen,
             o.name AS objekt,
             count(b.id)::text        AS buchungen,
             min(b.buchungstag)::text AS erste,
             max(b.buchungstag)::text AS letzte,
             EXISTS (SELECT 1 FROM fints_zugang z WHERE z.konto_id = k.id)
               AS hat_bankzugang
        FROM konto k
        LEFT JOIN objekt o  ON o.id = k.objekt_id
        LEFT JOIN buchung b ON b.konto_id = k.id
       GROUP BY k.id, k.bezeichnung, k.art, k.iban_kurz, k.notizen, o.name
       ORDER BY k.bezeichnung
    `),
    query<{ id: string; name: string }>(
      `SELECT id, name FROM objekt ORDER BY name`,
    ),
  ]);

  const namen = konten.map((k) => k.bezeichnung);

  return (
    <main>
      <h1>Konten</h1>

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
                <td style={{ textAlign: "right" }}>{k.buchungen}</td>
                <td>
                  {Number(k.buchungen) === 0
                    ? "—"
                    : `${datum(k.erste)} – ${datum(k.letzte)}`}
                </td>
                <td>{k.hat_bankzugang ? "eingerichtet" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ marginTop: "1rem" }}>
        <KontoNeu objekte={objekte} />
      </p>

      <h1 style={{ marginTop: "2.5rem" }}>Kontoauszug einlesen</h1>
      <p className="hinweis">
        Erst lesen, dann übernehmen. Bis du auf „Übernehmen" klickst, wird
        nichts gespeichert. Dieselbe Datei mehrfach einzulesen ist gefahrlos
        — doppelte Buchungen fallen über ihren Fingerabdruck heraus.
      </p>
      <AuszugUpload konten={namen} />
    </main>
  );
}
