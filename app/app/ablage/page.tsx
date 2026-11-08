import { query } from "@/lib/db";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { redirect } from "next/navigation";
import { Ablage } from "@/components/Ablage";
import { MandantAnlegen } from "@/components/MandantAnlegen";
import { KOSTENARTEN } from "@/lib/kostenarten";
import { zugaengeFuer } from "@/lib/zugang";
import { objektSicht } from "@/lib/objektsicht";

export const dynamic = "force-dynamic";

const euro = (w: number | string | null) =>
  w === null
    ? "—"
    : new Intl.NumberFormat("de-DE", {
        style: "currency",
        currency: "EUR",
      }).format(Math.abs(Number(w)));

const tag = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("de-DE") : "ohne Datum";

const ARTEN: Record<string, string> = {
  rechnung: "Rechnung",
  quittung: "Quittung",
  gutschrift: "Gutschrift",
  eigenbeleg: "Eigenbeleg",
  vertrag: "Vertrag",
  bescheid: "Bescheid",
  sonstige: "sonstige",
};

/**
 * Die Ablage.
 *
 * WOFÜR
 *
 * Belege erfassen, ohne den Weg über den Kontoauszug -- gedacht für die
 * private Steuerablage. Hochladen, einen Satz dazu sagen, fertig; und
 * wenn es gar keinen Beleg gibt, entsteht ein Eigenbeleg.
 *
 * Diese Seite liegt bewusst neben /belege und nicht darin. Auf /belege
 * geht es um den Abgleich gegen den Kontoauszug: offene Bewegungen,
 * Zuordnungen, Rückstände. Hier geht es nur darum, dass ein Beleg
 * überhaupt erfasst und eingeordnet ist. Wer die Steuer vorbereitet,
 * will nicht an 360 offenen Bewegungen vorbei.
 *
 * Welcher Mandant das ist, entscheidet die Sitzung (lib/zugang.ts). Im
 * privaten Mandanten zeigt diese Seite die privaten Belege, im Mandanten
 * der eGbR deren eigene -- dieselbe Seite, getrennte Daten, RLS
 * dazwischen.
 */
export default async function AblageSeite() {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung) redirect("/anmelden");
  if (sitzung.rolle === "mieter") redirect("/mieter");

  const { gewaehlt } = await objektSicht();

  const belege = await query<{
    id: string;
    art: string;
    aussteller: string | null;
    zweck: string | null;
    belegdatum: string | null;
    betrag_brutto: string | null;
    dateiname: string | null;
    kostenart: string | null;
    abweichung: string | null;
    erstellt_von: string | null;
  }>(
    `
    SELECT id, art, aussteller, zweck, belegdatum::text, betrag_brutto::text,
           dateiname, kostenart, abweichung, erstellt_von
      FROM beleg
     -- Die Trennung macht der MANDANT, nicht eine Spalte: Im privaten
     -- Mandanten gehoeren alle Belege hierher, im Mandanten der eGbR
     -- sind es deren eigene, und die RLS laesst den einen nie die des
     -- anderen sehen (db/035, lib/zugang.ts).
     --
     -- Seit dem 08.11.2026 kommt die Objektwahl aus dem Kopf dazu
     -- (lib/objektsicht.ts). Sie ist etwas anderes als die Trennung:
     -- ein Ausschnitt, den jemand sehen WILL.
     --
     -- Belege OHNE Objekt bleiben dabei stehen. Das ist der Punkt, der
     -- schon vorher hier stand und weiter gilt: "ohne Objekt" heisst
     -- nicht "gehoert einem anderen Haus", sondern "noch nicht
     -- eingeordnet". Wuerden sie beim Umschalten verschwinden, waere
     -- die Ablage genau fuer die Belege blind, die noch Arbeit machen.
     WHERE richtung = 'eingang'
       AND ($1::uuid IS NULL OR objekt_id = $1 OR objekt_id IS NULL)
     ORDER BY belegdatum DESC NULLS LAST, angelegt_am DESC
     LIMIT 60
  `,
    [gewaehlt?.id ?? null],
  );

  const [{ anzahl, summe }] = await query<{ anzahl: string; summe: string | null }>(`
    SELECT count(*)::text AS anzahl, sum(abs(betrag_brutto))::text AS summe
      FROM beleg
     WHERE richtung = 'eingang'
  `);

  const [{ eigen }] = await query<{ eigen: string }>(`
    SELECT count(*)::text AS eigen FROM beleg WHERE art = 'eigenbeleg'
  `);

  const namen = new Map(KOSTENARTEN.map((k) => [k.schluessel, k.text]));
  // Gibt es nur einen Zugang, gibt es auch keinen getrennten privaten
  // Mandanten -- dann steht unten das Angebot, einen anzulegen.
  const zugaenge = await zugaengeFuer(sitzung);

  return (
    <main className="seite">
      <h1>{gewaehlt ? `Ablage — ${gewaehlt.name}` : "Ablage"}</h1>
      <p className="hinweis">
        Belege erfassen und einordnen — für die Steuer. Datei hochladen,
        einen Satz dazu sagen, und der Beleg liegt eingeordnet in der
        Ablage. Gibt es keinen Beleg, entsteht daraus ein Eigenbeleg.
      </p>

      <Ablage />

      <MandantAnlegen anzahlZugaenge={zugaenge.length} />

      <div className="titelzeile">
        <h2>In der Ablage</h2>
        <span className="zaehler ziffern">{anzahl}</span>
      </div>
      <p className="hinweis">
        {euro(summe)} zusammen · davon {eigen}{" "}
        {Number(eigen) === 1 ? "Eigenbeleg" : "Eigenbelege"}, die nur auf dem
        eigenen Wort stehen.
      </p>

      {belege.length === 0 ? (
        <p className="hinweis">
          Noch nichts abgelegt. Der erste Beleg geht oben hinein.
        </p>
      ) : (
        <div className="register">
          {belege.map((b) => (
            <div className="posten" key={b.id}>
              <div className="posten-kopf">
                <span className="ziffern">{euro(b.betrag_brutto)}</span>
                <span className="still">{tag(b.belegdatum)}</span>
                <span
                  className={b.art === "eigenbeleg" ? "marker" : "marker still"}
                >
                  {ARTEN[b.art] ?? b.art}
                </span>
              </div>
              <div>
                <a href={`/api/belege/${b.id}/datei`}>
                  {b.aussteller ?? b.dateiname ?? "ohne Aussteller"}
                </a>
                {b.zweck ? ` · ${b.zweck}` : ""}
              </div>
              {b.kostenart && (
                <div className="still">
                  {namen.get(b.kostenart) ?? b.kostenart}
                </div>
              )}
              {b.abweichung && <div className="hinweis">{b.abweichung}</div>}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
