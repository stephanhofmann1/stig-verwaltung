import { query } from "@/lib/db";
import { schlageBelegeVor, offeneBelege } from "@/lib/belegabgleich";
import { tag } from "@/lib/formate";
import { BelegZeile } from "@/components/BelegZeile";
import { BelegUpload } from "@/components/BelegUpload";
import { Einlieferung } from "@/components/Einlieferung";
import { Zuordnungen, type Zuordnung } from "@/components/Zuordnungen";
import { KOSTENARTEN } from "@/lib/kostenarten";

export const dynamic = "force-dynamic";

const euro = (w: number | string) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    Number(w),
  );

export default async function Belege() {
  const vorschlaege = await schlageBelegeVor();
  // Die letzten Festschreibungen, neueste zuerst. Begrenzt, weil die
  // Seite sonst mit der Zeit zur Chronik wird.
  const zuordnungen = await query<Zuordnung>(
    `SELECT bb.id, bb.betrag::text, bb.sicherheit, bb.begruendung,
            bu.buchungstag::text, bu.absender, bu.verwendungszweck,
            bg.id AS beleg_id, bg.dateiname, bg.aussteller, bg.belegnummer,
            bg.belegdatum::text
       FROM belegbuchung bb
       JOIN buchung bu ON bu.id = bb.buchung_id
       JOIN beleg   bg ON bg.id = bb.beleg_id
      ORDER BY bb.angelegt_am DESC
      LIMIT 40`,
  );
  const belege = await offeneBelege();
  // Für die Zuordnung beim Hochladen: Gießen, Ludwigshafen und Mannheim
  // werden getrennt abgerechnet.
  const objekte = await query<{ id: string; name: string }>(
    `SELECT id, name FROM objekt ORDER BY name`,
  );

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
  const lieferungen = await query<{
    id: string;
    dateiname: string;
    enthalten: number;
    uebernommen: number;
    abgelehnt: number;
    auffaellig: number;
    angelegt_am: string;
  }>(`
    SELECT id, dateiname, enthalten, uebernommen, abgelehnt, auffaellig,
           angelegt_am::text
      FROM beleg_lieferung
     ORDER BY angelegt_am DESC
     LIMIT 10
  `);

  // Belege, bei denen die beiden Auswertungen sich nicht einig waren.
  // Diese Liste ist der Preis dafür, auf eine Sichtung von 300 Belegen zu
  // verzichten -- und sie ist kurz genug, um sie wirklich durchzusehen.
  const abweichend = await query<{
    id: string;
    dateiname: string | null;
    aussteller: string | null;
    belegdatum: string | null;
    betrag_brutto: string | null;
    abweichung: string;
  }>(`
    SELECT id, dateiname, aussteller, belegdatum::text, betrag_brutto::text,
           abweichung
      FROM beleg
     WHERE abweichung IS NOT NULL
     ORDER BY belegdatum DESC NULLS LAST
  `);

  // Welche Jahre überhaupt Bewegungen haben -- nur dafür lohnt ein Export.
  const jahre = await query<{ jahr: number }>(`
    SELECT DISTINCT date_part('year', buchungstag)::int AS jahr
      FROM buchung ORDER BY jahr DESC
  `);

  const s = stand[0] ?? { gesamt: 0, belegt: 0, befreit: 0 };
  const luecken = vorschlaege.length;

  // Nach Höhe sortiert, nicht nach Datum: Das ist die Liste, die am
  // Jahresende leer sein muss, und oben stehen die Posten, an denen am
  // meisten hängt. Ein fehlender Beleg über 2.400 Euro wiegt anders als
  // einer über 4,99 Euro.
  const nachHoehe = [...vorschlaege].sort((a, b) => b.betrag - a.betrag);
  const summeLuecke = vorschlaege.reduce((x, v) => x + v.betrag, 0);

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

      {/* Ein h1 je Seite ("Belege" oben). Die weiteren Abschnitte sind
          h2 -- vier h1 hintereinander sind fuer einen Screenreader vier
          Dokumente, und der Abstand kommt aus .abschnitt. */}
      <h2 className="abschnitt">Belege hochladen</h2>
      <p className="hinweis">
        Erst lesen, dann übernehmen. Bis du auf „Übernehmen“ klickst, wird
        nichts gespeichert, und jedes erkannte Feld lässt sich vorher ändern.
        Bei Amazon steht die Bestellnummer auch im Verwendungszweck der
        Abbuchung — solche Belege ordnen sich danach von selbst zu.
      </p>
      <BelegUpload objekte={objekte} kostenarten={KOSTENARTEN} />

      <h2 className="abschnitt">Viele Belege auf einmal</h2>
      <p className="hinweis">
        Für einen Altbestand: ein Archiv (tar.gz) mit bis zu 500 Belegen.
        Statt einer Sichtung am Bildschirm wird jeder Beleg zweimal
        unabhängig gelesen — vom Regelwerk hier und von einer Beifügung
        <code> einordnung.json</code> im Archiv. Wo Betrag oder Datum
        voneinander abweichen, wird der Beleg angelegt und markiert, und der
        selbsttätige Abgleich lässt ihn liegen.
      </p>
      <Einlieferung />

      {lieferungen.length > 0 && (
        <div className="register">
          {lieferungen.map((l) => (
            <div className="posten" data-still="ja" key={l.id}>
              <span className="nummer ziffern">{l.uebernommen}</span>
              <span className="betreff">{l.dateiname}</span>
              <span className="zeit ziffern">{tag(l.angelegt_am)}</span>
              <span className="unterzeile">
                <span>{l.enthalten} Dateien im Archiv</span>
                {l.abgelehnt > 0 && <span>{l.abgelehnt} abgelehnt</span>}
                {l.auffaellig > 0 && (
                  <span className="marker" data-art="heikel">
                    {l.auffaellig} mit Abweichung
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {/*
        Was die Maschine getan hat, steht vor dem, was noch zu tun ist.
        Der Abgleich schreibt selbsttaetig ins Hauptbuch -- wer das
        nachsehen will, soll nicht suchen muessen.
      */}
      <div className="titelzeile">
        <h2>Zuletzt automatisch zugeordnet</h2>
        <span className="zaehler ziffern">{zuordnungen.length}</span>
      </div>
      <p className="hinweis">
        Jede Zeile nennt den Grund, aus dem der Abgleich sie festgeschrieben
        hat. „Lösen" nimmt die Zuordnung zurück; Bewegung und Beleg stehen
        danach wieder offen, und der Beleg bekommt einen Vermerk, damit der
        nächste Lauf ihn nicht gleich wieder anfasst.
      </p>
      <Zuordnungen anfang={zuordnungen} />

      {abweichend.length > 0 && (
        <>
          <div className="titelzeile">
            <h2>Belege mit Abweichung</h2>
            <span className="zaehler ziffern">{abweichend.length}</span>
          </div>
          <p className="hinweis">
            Hier haben zwei Auswertungen desselben Belegs verschiedene Beträge
            oder Daten ergeben. Diese Belege sind nicht automatisch zugeordnet
            worden. Ein Klick öffnet die Datei — danach ist in Sekunden klar,
            welcher Wert stimmt.
          </p>
          <div className="register">
            {abweichend.map((b) => (
              <a
                className="posten"
                href={`/api/belege/${b.id}/datei`}
                target="_blank"
                rel="noreferrer"
                key={b.id}
                data-heikel="ja"
              >
                <span className="nummer ziffern">
                  {b.belegdatum ? tag(b.belegdatum) : "—"}
                </span>
                <span className="betreff">
                  {b.aussteller ?? b.dateiname ?? "ohne Aussteller"}
                </span>
                <span className="zeit ziffern">
                  {b.betrag_brutto ? euro(b.betrag_brutto) : "Betrag unklar"}
                </span>
                <span className="unterzeile">
                  <span>{b.abweichung}</span>
                </span>
              </a>
            ))}
          </div>
        </>
      )}

      {jahre.length > 0 && (
        <>
          <h2 className="abschnitt">Für den Steuerberater</h2>
          <p className="hinweis">
            Ein Archiv je Jahr: das Journal aller Bewegungen, lückenlos
            durchnummeriert, Einnahmen und Ausgaben getrennt, Summen je Objekt
            und Kostenart, die Ausgaben ohne Beleg als eigene Liste — und jeder
            Einzelbeleg als Datei, benannt nach seiner Nummer im Journal.
            Kostenart und Umlagefähigkeit stehen darin als Vorschlag, nicht als
            Festlegung; die Begleitdatei sagt das auch.
          </p>
          <div className="knopfreihe">
            {jahre.map((j) => (
              <a
                className="knopf"
                href={`/api/steuer/paket?jahr=${j.jahr}`}
                key={j.jahr}
              >
                Paket {j.jahr}
              </a>
            ))}
          </div>
        </>
      )}

      <div className="titelzeile">
        <h2>Ausgaben ohne Beleg</h2>
        <span className="zaehler ziffern">
          {luecken} · {euro(summeLuecke)}
        </span>
      </div>
      <p className="hinweis">
        Nach Höhe sortiert. Diese Liste muss am Jahresende leer sein: zu jeder
        Zeile gehört entweder ein Beleg oder ein Vermerk, warum keiner nötig
        ist (Umbuchung, Privatentnahme). Der Vermerk ist Pflicht — sonst weiß
        später niemand, warum die Zeile fehlt.
      </p>

      {luecken === 0 ? (
        <div className="leer">
          <strong>Keine Lücken</strong>
          Jede Bewegung hat einen Beleg oder einen Vermerk, warum keiner
          nötig ist.
        </div>
      ) : (
        nachHoehe.map((v) => {
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
        <h2>Eingegangene Belege</h2>
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
              // Der Weg zur Datei geht über /api/belege/<id>/datei (seit
              // dem 05.11.2026). Vorher gab es ihn nicht, und ohne ihn ließ
              // sich keine Zuordnung prüfen: Die Zeile sagt "Amazon,
              // 45,44 €" -- ob das im Beleg steht, weiß man erst, wenn man
              // ihn sieht.
              <a
                className="posten"
                href={`/api/belege/${b.id}/datei`}
                target="_blank"
                rel="noreferrer"
                key={b.id}
                data-heikel={offen > 0.005 ? "ja" : "nein"}
              >
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
              </a>
            );
          })}
        </div>
      )}
    </>
  );
}
