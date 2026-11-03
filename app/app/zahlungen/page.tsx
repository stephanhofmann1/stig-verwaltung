import Link from "next/link";
import { query } from "@/lib/db";
import { schlageZuordnungenVor } from "@/lib/zuordnung";
import { tag } from "@/lib/formate";
import { PruefZeile } from "@/components/PruefZeile";

export const dynamic = "force-dynamic";

interface OffenerPosten {
  /** Das Ziel der Zeile -- die naechste Frage nach "wer schuldet was". */
  mietverhaeltnis_id: string;
  kontakt_name: string;
  einheit: string;
  objekt: string;
  monat: string;
  betrag: string;
  offen: string;
}

interface SollOption {
  id: string;
  label: string;
  offen: string;
}

const euro = (w: number | string) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    Number(w),
  );

export default async function Zahlungen() {
  const vorschlaege = await schlageZuordnungenVor();
  const zurPruefung = vorschlaege.filter((v) => v.sicherheit !== "sicher");

  const offeneBuchungenInfo = await query<{
    id: string;
    buchungstag: string;
    betrag: string;
    absender: string | null;
    verwendungszweck: string | null;
  }>(`
    SELECT b.id, b.buchungstag::text, b.betrag::text, b.absender, b.verwendungszweck
      FROM buchung b
     WHERE b.betrag > 0
       AND b.betrag > COALESCE(
             (SELECT sum(z.betrag) FROM zuordnung z WHERE z.buchung_id = b.id), 0)
  `);
  const buchungNach = new Map(offeneBuchungenInfo.map((b) => [b.id, b]));

  const sollOptionen = await query<SollOption>(`
    SELECT s.id,
           k.anzeigename || ' · ' || e.bezeichnung || ' · ' ||
             to_char(s.monat,'MM/YYYY') AS label,
           (s.betrag - COALESCE(
              (SELECT sum(z.betrag) FROM zuordnung z
                WHERE z.sollstellung_id = s.id), 0))::text AS offen
      FROM sollstellung s
      JOIN mietverhaeltnis mv ON mv.id = s.mietverhaeltnis_id
      JOIN kontakt k ON k.id = mv.kontakt_id
      JOIN einheit e ON e.id = mv.einheit_id
     WHERE s.betrag > COALESCE(
             (SELECT sum(z.betrag) FROM zuordnung z
               WHERE z.sollstellung_id = s.id), 0)
     ORDER BY s.monat DESC, k.anzeigename
     LIMIT 300
  `);

  const offenePosten = await query<OffenerPosten>(`
    SELECT mv.id AS mietverhaeltnis_id,
           k.anzeigename AS kontakt_name, e.bezeichnung AS einheit,
           o.name AS objekt, s.monat::text, s.betrag::text,
           (s.betrag - COALESCE(
              (SELECT sum(z.betrag) FROM zuordnung z
                WHERE z.sollstellung_id = s.id), 0))::text AS offen
      FROM sollstellung s
      JOIN mietverhaeltnis mv ON mv.id = s.mietverhaeltnis_id
      JOIN kontakt k ON k.id = mv.kontakt_id
      JOIN einheit e ON e.id = mv.einheit_id
      JOIN objekt  o ON o.id = e.objekt_id
     WHERE s.betrag > COALESCE(
             (SELECT sum(z.betrag) FROM zuordnung z
               WHERE z.sollstellung_id = s.id), 0)
       AND s.monat <= date_trunc('month', now())
     ORDER BY s.monat ASC, k.anzeigename
     LIMIT 100
  `);

  const summeOffen = offenePosten.reduce((s, p) => s + Number(p.offen), 0);

  return (
    <>
      <div className="titelzeile">
        <h1>Zahlungen</h1>
        <span className="zaehler ziffern">
          {zurPruefung.length} zu prüfen · {euro(summeOffen)} offen
        </span>
      </div>
      <p className="hinweis">
        Eindeutige Eingänge sind bereits verbucht. Hier stehen nur die Fälle,
        bei denen die Zuordnung nicht sicher ist — Zahlungen unter fremdem
        Namen, Auslandsüberweisungen, abweichende Beträge.
      </p>

      {zurPruefung.length === 0 ? (
        <div className="leer">
          <strong>Nichts zu prüfen</strong>
          Alle Eingänge sind zugeordnet. Barzahlungen erfasst du separat —
          sie stehen auf keinem Kontoauszug.
        </div>
      ) : (
        zurPruefung.map((v) => {
          const b = buchungNach.get(v.buchung_id);
          if (!b) return null;
          return (
            <PruefZeile
              key={v.buchung_id}
              buchungId={v.buchung_id}
              buchungstag={tag(b.buchungstag)}
              betrag={euro(b.betrag)}
              absender={b.absender}
              verwendungszweck={b.verwendungszweck}
              begruendung={v.begruendung}
              vorschlagSollId={v.soll_id}
              vorschlagBetrag={v.betrag}
              optionen={sollOptionen}
            />
          );
        })
      )}

      {/* Zweiter Abschnitt derselben Seite, darum h2: "Zahlungen" oben
          ist das einzige h1. */}
      <div className="titelzeile">
        <h2>Offene Posten</h2>
        <span className="zaehler ziffern">{euro(summeOffen)}</span>
      </div>
      {offenePosten.length === 0 ? (
        <div className="leer">
          <strong>Keine offenen Mieten</strong>
          Sobald Mietverhältnisse und Sollstellungen eingetragen sind,
          erscheint hier der Rückstand je Mieter und Monat.
        </div>
      ) : (
        <div className="register">
          {/* Wer einen offenen Posten liest, will als Naechstes den Vertrag
              sehen -- Miethoehe, Zahlungsverlauf, Mahnstand. Bisher war das
              eine Sackgasse: Die Zeile leuchtete beim Ueberfahren auf und
              fuehrte nirgendwohin. */}
          {offenePosten.map((p) => (
            <Link
              href={`/mietverhaeltnis/${p.mietverhaeltnis_id}`}
              className="posten"
              key={`${p.mietverhaeltnis_id}-${p.monat}`}
            >
              <span className="nummer ziffern">
                {p.monat.slice(5, 7)}/{p.monat.slice(2, 4)}
              </span>
              <span className="betreff">{p.kontakt_name}</span>
              <span className="zeit ziffern">{euro(p.offen)}</span>
              <span className="unterzeile">
                <span>{p.einheit}</span>
                <span>{p.objekt}</span>
                {Number(p.offen) < Number(p.betrag) && (
                  <span>Teilzahlung von {euro(p.betrag)}</span>
                )}
              </span>
            </Link>
          ))}
        </div>
      )}
      <p className="hinweis">
        Ein offener Posten ist noch kein Rückstand. Bar vereinnahmte Mieten
        tauchen in keinem Auszug auf — vor jeder Mahnung die Barkasse prüfen.
      </p>
    </>
  );
}
