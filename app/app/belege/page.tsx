import { query } from "@/lib/db";
import { schlageBelegeVor, offeneBelege } from "@/lib/belegabgleich";
import { tag } from "@/lib/formate";
import { BelegZeile } from "@/components/BelegZeile";

export const dynamic = "force-dynamic";

const euro = (w: number | string) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    Number(w),
  );

export default async function Belege() {
  const vorschlaege = await schlageBelegeVor();
  const belege = await offeneBelege();

  const buchungen = await query<{
    id: string;
    buchungstag: string;
    betrag: string;
    absender: string | null;
    verwendungszweck: string | null;
  }>(`
    SELECT id, buchungstag::text, betrag::text, absender, verwendungszweck
      FROM buchung
  `);
  const nach = new Map(buchungen.map((b) => [b.id, b]));

  const stand = await query<{
    gesamt: number;
    belegt: number;
    befreit: number;
  }>(`
    SELECT count(*)::int AS gesamt,
           count(*) FILTER (
             WHERE abs(betrag) <= COALESCE(
               (SELECT sum(bb.betrag) FROM belegbuchung bb
                 WHERE bb.buchung_id = buchung.id), 0))::int AS belegt,
           count(*) FILTER (WHERE beleg_nicht_noetig)::int AS befreit
      FROM buchung
  `);
  const s = stand[0] ?? { gesamt: 0, belegt: 0, befreit: 0 };
  const luecken = vorschlaege.length;

  const belegOptionen = belege
    .filter((b) => Number(b.offen) > 0.005)
    .map((b) => ({
      id: b.id,
      label: `${b.aussteller ?? b.kontakt_name ?? "Unbekannt"} · ${
        b.belegnummer ?? b.dateiname ?? "ohne Nummer"
      }${b.belegdatum ? ` · ${tag(b.belegdatum)}` : ""}`,
      offen: b.offen,
    }));

  return (
    <>
      <div className="titelzeile">
        <h1>Belege</h1>
        <span className="zaehler ziffern">
          {s.belegt + s.befreit} von {s.gesamt} Bewegungen geklärt
        </span>
      </div>
      <p className="hinweis">
        Für die Steuer muss zu jeder Bankbewegung ein Beleg liegen. Rechnungen
        aus Mailanhängen werden automatisch erfasst und, wo die Belegnummer im
        Verwendungszweck steht, direkt zugeordnet. Hier steht nur der Rest.
      </p>

      {luecken === 0 ? (
        <div className="leer">
          <strong>Keine Lücken</strong>
          Jede Bewegung hat einen Beleg oder einen Vermerk, warum keiner
          nötig ist.
        </div>
      ) : (
        vorschlaege.map((v) => {
          const b = nach.get(v.buchung_id);
          if (!b) return null;
          return (
            <BelegZeile
              key={v.buchung_id}
              buchungId={v.buchung_id}
              buchungstag={tag(b.buchungstag)}
              betrag={euro(b.betrag)}
              absender={b.absender}
              verwendungszweck={b.verwendungszweck}
              begruendung={v.begruendung}
              vorschlagBelegId={v.beleg_id}
              vorschlagBetrag={v.betrag}
              optionen={belegOptionen}
            />
          );
        })
      )}

      <div className="titelzeile">
        <h1>Eingegangene Belege</h1>
        <span className="zaehler ziffern">{belege.length}</span>
      </div>
      {belege.length === 0 ? (
        <div className="leer">
          <strong>Noch keine Belege</strong>
          Rechnungen, die als Mailanhang ankommen, landen hier automatisch.
        </div>
      ) : (
        <div className="register">
          {belege.map((b) => {
            const offen = Number(b.offen);
            return (
              <div className="posten" key={b.id} data-heikel={offen > 0.005 ? "ja" : "nein"}>
                <span className="nummer ziffern">
                  {b.belegdatum ? b.belegdatum.slice(5, 7) + "/" + b.belegdatum.slice(2, 4) : "—"}
                </span>
                <span className="betreff">
                  {b.aussteller ?? b.kontakt_name ?? "Unbekannter Aussteller"}
                </span>
                <span className="zeit ziffern">
                  {b.betrag_brutto ? euro(b.betrag_brutto) : "Betrag unklar"}
                </span>
                <span className="unterzeile">
                  <span>{b.belegnummer ?? b.dateiname ?? "ohne Nummer"}</span>
                  {b.vorgang_referenz && <span>{b.vorgang_referenz}</span>}
                  {offen > 0.005 ? (
                    <span className="marker" data-art="heikel">
                      offen {euro(offen)}
                    </span>
                  ) : (
                    <span className="marker">bezahlt</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
