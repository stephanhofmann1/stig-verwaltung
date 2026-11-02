import { query } from "@/lib/db";
import { MieterFormular } from "@/components/MieterFormular";
import { tag } from "@/lib/formate";
// Dieselbe Funktion, die die Sollstellung verwendet. Die Miete hier noch
// einmal auszurechnen hiesse, zwei Regeln zu pflegen -- und genau daran ist
// der Moeblierungszuschlag schon einmal verloren gegangen.
import { sollGesamt } from "@/lib/sollstellung";
import { AltdatenImport } from "@/components/AltdatenImport";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface EinheitZeile {
  id: string;
  bezeichnung: string;
  etage: string | null;
  objekt: string;
  art: string;
  mieter: string | null;
  mietverhaeltnis_id: string | null;
  beginn: string | null;
  ende: string | null;
  kaltmiete: string | null;
  nebenkosten: string | null;
  moeblierung: string | null;
  gesamtmiete: string | null;
  zahlt_im_voraus: boolean | null;
}

const euro = (w: string | null) =>
  w === null
    ? "—"
    : new Intl.NumberFormat("de-DE", {
        style: "currency",
        currency: "EUR",
      }).format(Number(w));

export default async function Stammdaten() {
  const einheiten = await query<EinheitZeile>(`
    SELECT e.id, e.bezeichnung, e.etage, e.art, o.name AS objekt,
           k.anzeigename AS mieter, mv.id AS mietverhaeltnis_id,
           mv.beginn::text, mv.ende::text,
           mv.kaltmiete::text, mv.nebenkosten::text,
           -- Defensiv gelesen, solange Migration 017 nicht ueberall durch
           -- ist: ->> auf ein JSON-Objekt liefert bei fehlendem Schluessel
           -- NULL, ein Spaltenzugriff waere ein Parse-Fehler und die Seite
           -- bliebe leer. Die Schluesselnamen prueft tests/schema.test.ts.
           (to_jsonb(mv) ->> 'moeblierungszuschlag') AS moeblierung,
           (to_jsonb(mv) ->> 'gesamtmiete')          AS gesamtmiete,
           mv.zahlt_im_voraus
      FROM einheit e
      JOIN objekt o ON o.id = e.objekt_id
      LEFT JOIN LATERAL (
            SELECT * FROM mietverhaeltnis m
             WHERE m.einheit_id = e.id
               AND (m.ende IS NULL OR m.ende >= current_date)
             ORDER BY m.beginn DESC LIMIT 1) mv ON true
      LEFT JOIN kontakt k ON k.id = mv.kontakt_id
     WHERE e.art <> 'gemeinschaft'
     ORDER BY o.name, e.bezeichnung
  `);

  const frei = einheiten.filter((e) => !e.mieter);
  const vermietet = einheiten.filter((e) => e.mieter);

  return (
    <>
      <div className="titelzeile">
        <h1>Stammdaten</h1>
        <span className="zaehler ziffern">
          {vermietet.length} vermietet · {frei.length} frei
        </span>
      </div>
      <p className="hinweis">
        Hier stehen Einheiten und laufende Mietverhältnisse. Was hier
        eingetragen ist, bestimmt, welche Miete monatlich fällig gestellt
        wird und wogegen der Kontoabgleich prüft.
      </p>

      <MieterFormular
        einheiten={frei.map((e) => ({
          id: e.id,
          label: `${e.objekt} · ${e.bezeichnung}${e.etage ? ` (${e.etage})` : ""}`,
        }))}
      />

      <div className="titelzeile">
        <h1>Vermietet</h1>
        <span className="zaehler ziffern">{vermietet.length}</span>
      </div>
      {vermietet.length === 0 ? (
        <div className="leer">
          <strong>Noch keine Mietverhältnisse</strong>
          Trage den ersten Mieter oben ein.
        </div>
      ) : (
        <div className="register">
          {/* Kein Link um die ganze Zeile: Sie traegt schon zwei Wege
              (Mieter, Einheit), und ein Link darf keinen Link enthalten.
              data-still nimmt ihr nur das Aufleuchten -- geklickt wird auf
              die Woerter. */}
          {vermietet.map((e) => (
            <div className="posten" data-still="ja" key={e.id}>
              <span className="nummer">{e.etage ?? "—"}</span>
              <span className="betreff">
                {/* Der Mietername führt ins Mietverhältnis, die
                    Bezeichnung in die Einheit -- zwei verschiedene
                    Fragen, zwei verschiedene Seiten. */}
                {e.mietverhaeltnis_id ? (
                  <Link href={`/mietverhaeltnis/${e.mietverhaeltnis_id}`}>
                    {e.mieter}
                  </Link>
                ) : (
                  e.mieter
                )}
                <span style={{ fontWeight: 400, color: "var(--tinte-leise)" }}>
                  {" "}·{" "}
                  <Link href={`/einheit/${e.id}`}>{e.bezeichnung}</Link>
                </span>
              </span>
              <span className="zeit ziffern">
                {euro(
                  e.kaltmiete === null && e.nebenkosten === null
                    ? null
                    : String(sollGesamt(e)),
                )}
              </span>
              <span className="unterzeile">
                <span>{e.objekt}</span>
                <span>seit {tag(e.beginn)}</span>
                {e.ende && <span>bis {tag(e.ende)}</span>}
                {e.zahlt_im_voraus && (
                  <span className="marker">zahlt im Voraus</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="titelzeile">
        <h1>Frei</h1>
        <span className="zaehler ziffern">{frei.length}</span>
      </div>
      <div className="register">
        {/* Ein freies Zimmer hat genau ein Ziel, also traegt die ganze Zeile
            den Weg -- auf dem Telefon ist das eine Flaeche statt eines
            Wortes. Die Bezeichnung ist deshalb kein eigener Link mehr: Ein
            Link im Link ist kein gueltiges HTML. */}
        {frei.map((e) => (
          <Link href={`/einheit/${e.id}`} className="posten" key={e.id}>
            <span className="nummer">{e.etage ?? "—"}</span>
            <span className="betreff">{e.bezeichnung}</span>
            <span className="zeit">{e.art === "gewerbe" ? "Gewerbe" : ""}</span>
            <span className="unterzeile">
              <span>{e.objekt}</span>
            </span>
          </Link>
        ))}
      </div>

      <h1 style={{ marginTop: "2.5rem" }}>Altdaten übernehmen</h1>
      <AltdatenImport />
    </>
  );
}
