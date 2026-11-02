import Link from "next/link";
import { notFound } from "next/navigation";
import { one, query } from "@/lib/db";
import { tag } from "@/lib/formate";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import {
  dokumenteFuer,
  istBild,
  mietZeitleiste,
  mietzusammensetzung,
  type Anpassung,
} from "@/lib/dokumente";
import {
  fehlendeFelder,
  fehlendeFelderWgb,
  vertragsdaten,
} from "@/lib/vertragsdaten";
import { Bildergalerie } from "@/components/Bildergalerie";
import { DokumentListe, type ErzeugtesDokument } from "@/components/DokumentListe";
import { DokumentHochladen } from "@/components/DokumentHochladen";

export const dynamic = "force-dynamic";

/**
 * Ein Mietverhältnis: wer, wie lange, zu welchem Preis, und was bezahlt ist.
 *
 * Die Mietzusammensetzung steht als Zeitleiste da und nicht als ein Betrag.
 * Der Grund steht in db/022: Ein einziger Betrag je Mietverhältnis hätte
 * jeden Monat seit 2024 mit dem heutigen gerechnet und Forderungen
 * erzeugt, die es nie gab.
 *
 * Mietvertrag und Wohnungsgeberbestätigung liegen nirgends -- sie werden
 * bei jedem Abruf erzeugt. Hier steht deshalb nicht nur der Verweis,
 * sondern auch, ob er funktioniert: Fehlt eine Angabe, nennt die Liste
 * sie, statt ein Dokument mit leeren Feldern zu drucken.
 *
 * Nicht auf dieser Seite: Ausweis- und Passnummern. Die werden nicht
 * gespeichert und nicht angezeigt. Geburtsdatum und Geburtsort stehen im
 * Mietvertrag und bleiben dort; fehlen sie, meldet es die Prüfliste beim
 * Mietvertrag -- dafür müssen sie hier nicht stehen.
 */

interface Kopf {
  id: string;
  status: string;
  beginn: string;
  ende: string | null;
  befristet: boolean;
  vertrag_datum: string | null;
  kuendigungsverzicht_monate: number;
  kaution: string | null;
  kaution_raten: number;
  moebliert: boolean;
  melde_zusatz: string | null;
  wgb_uebergeben_am: string | null;
  zahlt_im_voraus: boolean;
  notizen: string | null;
  kaltmiete: string | null;
  nebenkosten: string | null;
  moeblierung: string | null;
  gesamtmiete: string | null;
  kontakt_id: string;
  mieter: string;
  rufname: string | null;
  anschrift: string | null;
  telefon: string | null;
  einheit_id: string;
  einheit: string;
  etage: string | null;
  objekt_id: string;
  objekt: string;
  strasse: string;
  plz: string;
  ort: string;
  zahlungsdaten_ab: string | null;
}

interface SollZeile {
  id: string;
  monat: string;
  betrag: string;
  bezahlt: string;
  letzte_zahlung: string | null;
}

const euro = (betrag: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    betrag,
  );

const monatName = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(
    new Date(iso.slice(0, 10) + "T12:00:00Z"),
  );

const STATUS_TEXT: Record<string, string> = {
  vertrag_versendet: "Vertrag versendet",
  aktiv: "laufend",
  gekuendigt: "gekündigt",
  beendet: "beendet",
};

export default async function Mietverhaeltnisseite({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sitzung = await angemeldeteSitzung();
  const darfSchreiben = sitzung?.rolle === "verwalter";

  const kopf = await one<Kopf>(
    `SELECT mv.id, mv.status, mv.beginn::text, mv.ende::text, mv.befristet,
            mv.vertrag_datum::text, mv.kuendigungsverzicht_monate,
            mv.kaution::text, mv.kaution_raten, mv.moebliert,
            mv.melde_zusatz, mv.wgb_uebergeben_am::text,
            mv.zahlt_im_voraus, mv.notizen,
            mv.kaltmiete::text, mv.nebenkosten::text,
            mv.moeblierungszuschlag::text AS moeblierung,
            mv.gesamtmiete::text,
            k.id AS kontakt_id, k.anzeigename AS mieter, k.rufname,
            k.anschrift, k.telefon,
            e.id AS einheit_id, e.bezeichnung AS einheit, e.etage,
            o.id AS objekt_id, o.name AS objekt, o.strasse, o.plz, o.ort,
            o.zahlungsdaten_ab::text
       FROM mietverhaeltnis mv
       JOIN kontakt k ON k.id = mv.kontakt_id
       JOIN einheit e ON e.id = mv.einheit_id
       JOIN objekt o  ON o.id = e.objekt_id
      WHERE mv.id = $1`,
    [id],
  );
  if (!kopf) notFound();

  const [emails, nummern, anpassungen, kuendigung, soll, kautionseingaenge] =
    await Promise.all([
      query<{ email: string; ist_primaer: boolean }>(
        `SELECT email, ist_primaer FROM kontakt_email WHERE kontakt_id = $1
          ORDER BY ist_primaer DESC, email`,
        [kopf.kontakt_id],
      ),
      query<{ nummer_e164: string; whatsapp_ok: boolean }>(
        `SELECT nummer_e164, whatsapp_ok FROM kontakt_telefon
          WHERE kontakt_id = $1 ORDER BY whatsapp_ok DESC, nummer_e164`,
        [kopf.kontakt_id],
      ),
      query<Anpassung>(
        `SELECT gilt_ab::text, kaltmiete::text, nebenkosten::text,
                moeblierungszuschlag::text AS moeblierung,
                gesamtmiete::text, grund, beleg
           FROM mietanpassung WHERE mietverhaeltnis_id = $1 ORDER BY gilt_ab`,
        [id],
      ),
      one<{
        eingegangen_am: string;
        durch: string;
        zum_datum: string | null;
        nachmieter_gesucht: boolean;
        notizen: string | null;
      }>(
        `SELECT eingegangen_am::text, durch, zum_datum::text,
                nachmieter_gesucht, notizen
           FROM kuendigung
          WHERE mietverhaeltnis_id = $1 AND zurueckgenommen_am IS NULL`,
        [id],
      ),
      query<SollZeile>(
        `SELECT s.id, s.monat::text, s.betrag::text,
                COALESCE((SELECT sum(z.betrag) FROM zuordnung z
                           WHERE z.sollstellung_id = s.id), 0)::text AS bezahlt,
                (SELECT max(b.buchungstag)::text
                   FROM zuordnung z JOIN buchung b ON b.id = z.buchung_id
                  WHERE z.sollstellung_id = s.id) AS letzte_zahlung
           FROM sollstellung s
          WHERE s.mietverhaeltnis_id = $1
          ORDER BY s.monat DESC
          LIMIT 36`,
        [id],
      ),
      // Ob die Kaution eingegangen ist, führt diese Datenbank nicht als
      // Feld. Was es gibt, sind Buchungen. Gesucht wird nach "Kaution" im
      // Verwendungszweck zusammen mit einem Namensbestandteil des Mieters
      // -- das ist ein Hinweis und keine Feststellung, und so steht es
      // auch auf der Seite. Eine erfundene Gewissheit wäre schlimmer als
      // keine.
      query<{
        buchungstag: string;
        betrag: string;
        absender: string | null;
        verwendungszweck: string | null;
      }>(
        `SELECT b.buchungstag::text, b.betrag::text, b.absender,
                b.verwendungszweck
           FROM buchung b
          WHERE b.verwendungszweck ILIKE '%kaution%'
            AND EXISTS (
                  SELECT 1 FROM regexp_split_to_table($1, '\\s+') AS wort
                   WHERE length(wort) >= 4
                     AND (b.absender ILIKE '%' || wort || '%'
                       OR b.verwendungszweck ILIKE '%' || wort || '%'))
          ORDER BY b.buchungstag
          LIMIT 5`,
        [kopf.mieter],
      ),
    ]);

  const heute = new Date().toISOString().slice(0, 10);
  const vertragswerte = {
    kaltmiete: kopf.kaltmiete,
    nebenkosten: kopf.nebenkosten,
    moeblierung: kopf.moeblierung,
    gesamtmiete: kopf.gesamtmiete,
  };
  const zeitleiste = mietZeitleiste(
    kopf.beginn,
    kopf.ende,
    anpassungen,
    vertragswerte,
  );
  const jetzt = zeitleiste.filter((z) => z.giltAb <= heute).pop() ?? zeitleiste[0];

  // Die beiden erzeugten Dokumente -- mit Prüfliste statt leerer Felder.
  const erzeugte: ErzeugtesDokument[] = [];
  try {
    const d = await vertragsdaten(id);
    erzeugte.push(
      { id: `vertrag-${id}`, titel: "Mietvertrag", fehlt: fehlendeFelder(d) },
      {
        id: `wgb-${id}`,
        titel: "Wohnungsgeberbestätigung (§ 19 BMG)",
        fehlt: fehlendeFelderWgb(d),
      },
    );
  } catch {
    // vertragsdaten() wirft nur, wenn das Mietverhältnis nicht sichtbar
    // ist -- das kann hier nicht sein, der Kopf steht oben. Falls doch,
    // bleibt die Liste leer statt die Seite zu verlieren.
  }

  const dokumente = await dokumenteFuer({ mietverhaeltnis_id: id });
  const bilder = dokumente.filter((d) => istBild(d.mime_typ));
  const akten = dokumente.filter((d) => !istBild(d.mime_typ));

  const kaution = Number(kopf.kaution ?? 0);
  // Festhalten, bevor es in die Hilfsfunktion geht: In einer
  // Funktionsdeklaration weiss TypeScript nichts mehr von dem notFound()
  // weiter oben.
  const zahlungsdatenAb = kopf.zahlungsdaten_ab;
  const offeneMonate = soll.filter((s) => {
    if (!zahlungsdatenAb || s.monat < zahlungsdatenAb) return false;
    return Number(s.bezahlt) + 0.005 < Number(s.betrag) && s.monat <= heute;
  });

  function standVon(s: SollZeile): { text: string; heikel: boolean } {
    const sollBetrag = Number(s.betrag);
    const bezahlt = Number(s.bezahlt);
    if (!zahlungsdatenAb || s.monat < zahlungsdatenAb) {
      // Für Ludwigshafen gibt es vor Dezember 2024 keine Kontodaten --
      // dort einen Rückstand zu behaupten wäre eine falsche Beschuldigung
      // gegen ausgerechnet die langjährigen Mieter (db/023).
      return { text: "noch nicht abgeglichen", heikel: false };
    }
    if (bezahlt + 0.005 >= sollBetrag) return { text: "bezahlt", heikel: false };
    if (bezahlt > 0) return { text: "teilweise", heikel: true };
    if (s.monat > heute) return { text: "noch nicht fällig", heikel: false };
    return { text: "offen", heikel: true };
  }

  return (
    <>
      <div className="akte-kopf">
        <span className="aktenzeichen ziffern">{kopf.beginn.slice(0, 4)}</span>
        <div>
          <h1>{kopf.mieter}</h1>
          <div className="akte-meta">
            <span>
              <Link href={`/einheit/${kopf.einheit_id}`}>{kopf.einheit}</Link>
              {kopf.etage ? ` · ${kopf.etage}` : ""}
            </span>
            <span>
              <Link href={`/objekt/${kopf.objekt_id}`}>{kopf.objekt}</Link>
            </span>
            <span>{STATUS_TEXT[kopf.status] ?? kopf.status}</span>
            <span className="ziffern">{euro(jetzt.miete.summe)} je Monat</span>
            {offeneMonate.length > 0 && (
              <span className="marker" data-art="heikel">
                {offeneMonate.length} Monat
                {offeneMonate.length === 1 ? "" : "e"} offen
              </span>
            )}
          </div>
        </div>
      </div>

      {/* --- Mieter --- */}
      <div className="titelzeile" style={{ marginTop: "1.5rem" }}>
        <h1>Mieter</h1>
      </div>
      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "0.4rem 1.5rem",
          margin: 0,
        }}
      >
        <dt className="hinweis">Name</dt>
        <dd style={{ margin: 0 }}>
          {kopf.mieter}
          {kopf.rufname && (
            <span className="hinweis"> · angesprochen als {kopf.rufname}</span>
          )}
        </dd>

        <dt className="hinweis">E-Mail</dt>
        <dd style={{ margin: 0 }}>
          {emails.length === 0 ? (
            <span className="hinweis">keine hinterlegt</span>
          ) : (
            emails.map((e) => (
              <span key={e.email} style={{ marginRight: "0.75rem" }}>
                <a href={`mailto:${e.email}`}>{e.email}</a>
                {e.ist_primaer && <span className="hinweis"> (primär)</span>}
              </span>
            ))
          )}
        </dd>

        <dt className="hinweis">Telefon</dt>
        <dd style={{ margin: 0 }} className="ziffern">
          {nummern.length === 0 && !kopf.telefon ? (
            <span className="hinweis">keines hinterlegt</span>
          ) : (
            <>
              {nummern.map((n) => (
                <span key={n.nummer_e164} style={{ marginRight: "0.75rem" }}>
                  {n.nummer_e164}
                  {n.whatsapp_ok && <span className="marker">WhatsApp</span>}
                </span>
              ))}
              {nummern.length === 0 && kopf.telefon}
            </>
          )}
        </dd>

        <dt className="hinweis">Anschrift</dt>
        <dd style={{ margin: 0 }}>
          {kopf.anschrift ?? (
            <span className="hinweis">
              keine erfasst — für eine Mahnung wäre sie nötig
            </span>
          )}
        </dd>

        <dt className="hinweis">Meldezusatz</dt>
        <dd style={{ margin: 0 }}>
          {kopf.melde_zusatz ?? (
            <span className="hinweis">
              fehlt — ohne ihn keine Wohnungsgeberbestätigung
            </span>
          )}
        </dd>
      </dl>

      {/* --- Laufzeit --- */}
      <div className="titelzeile" style={{ marginTop: "2rem" }}>
        <h1>Laufzeit</h1>
      </div>
      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "0.4rem 1.5rem",
          margin: 0,
        }}
      >
        <dt className="hinweis">Beginn</dt>
        <dd style={{ margin: 0 }}>{tag(kopf.beginn)}</dd>

        <dt className="hinweis">Ende</dt>
        <dd style={{ margin: 0 }}>
          {kopf.ende ? tag(kopf.ende) : "unbefristet, kein Termin"}
          {kopf.befristet && " · befristet (§ 549 Abs. 2 Nr. 1 BGB)"}
        </dd>

        <dt className="hinweis">Vertrag vom</dt>
        <dd style={{ margin: 0 }}>
          {kopf.vertrag_datum ? tag(kopf.vertrag_datum) : "nicht erfasst"}
        </dd>

        <dt className="hinweis">Kündigungsverzicht</dt>
        <dd style={{ margin: 0 }}>
          {kopf.kuendigungsverzicht_monate > 0
            ? `${kopf.kuendigungsverzicht_monate} Monate`
            : "keiner, gesetzliche Frist"}
        </dd>

        <dt className="hinweis">Möbliert</dt>
        <dd style={{ margin: 0 }}>{kopf.moebliert ? "ja" : "nein"}</dd>

        <dt className="hinweis">Wohnungsgeberbestätigung</dt>
        <dd style={{ margin: 0 }}>
          {kopf.wgb_uebergeben_am ? (
            `übergeben am ${tag(kopf.wgb_uebergeben_am)}`
          ) : (
            <span className="marker" data-art="heikel">
              noch nicht übergeben (§ 19 BMG, Anmeldefrist zwei Wochen)
            </span>
          )}
        </dd>

        {kopf.zahlt_im_voraus && (
          <>
            <dt className="hinweis">Zahlweise</dt>
            <dd style={{ margin: 0 }}>
              zahlt im Voraus — Eingänge ab dem 25. gelten für den Folgemonat
            </dd>
          </>
        )}

        {kopf.notizen && (
          <>
            <dt className="hinweis">Notizen</dt>
            <dd style={{ margin: 0 }}>{kopf.notizen}</dd>
          </>
        )}
      </dl>

      {/* --- Kündigung --- */}
      {kuendigung && (
        <>
          <div className="titelzeile" style={{ marginTop: "2rem" }}>
            <h1>Kündigung</h1>
          </div>
          <p>
            Eingegangen am <strong>{tag(kuendigung.eingegangen_am)}</strong>,
            ausgesprochen{" "}
            {kuendigung.durch === "mieter" ? "vom Mieter" : "von uns"}.{" "}
            {kuendigung.zum_datum
              ? `Zum ${tag(kuendigung.zum_datum)}.`
              : "Ein Termin steht noch nicht fest."}
            {kuendigung.nachmieter_gesucht &&
              " Das Zimmer wird angeboten, ohne ein Einzugsdatum zuzusagen."}
          </p>
          {kuendigung.notizen && <p className="hinweis">{kuendigung.notizen}</p>}
        </>
      )}

      {/* --- Miete --- */}
      <div className="titelzeile" style={{ marginTop: "2rem" }}>
        <h1>Miete</h1>
        <span className="zaehler ziffern">{euro(jetzt.miete.summe)}</span>
      </div>
      {jetzt.miete.inklusiv ? (
        <p className="hinweis">
          Als Inklusivmiete vereinbart — ein Betrag, nicht aufgeteilt.
        </p>
      ) : (
        <p className="ziffern">
          {jetzt.miete.posten
            .map((p) => `${p.bezeichnung} ${euro(p.betrag)}`)
            .join("  ·  ")}
          {jetzt.miete.posten.length > 0 && `  =  ${euro(jetzt.miete.summe)}`}
        </p>
      )}
      {jetzt.miete.abweichung !== null && (
        <p className="hinweis">
          Die zugesagte Gesamtmiete liegt {euro(jetzt.miete.abweichung)} über der
          Summe der Posten. Meist steckt darin ein Möblierungszuschlag, der
          nicht eingetragen ist — in der Sollstellung fehlt er dann jeden
          Monat.
        </p>
      )}

      <div className="titelzeile" style={{ marginTop: "1.25rem" }}>
        <h1 style={{ fontSize: "1rem" }}>Verlauf</h1>
        <span className="zaehler ziffern">{zeitleiste.length}</span>
      </div>
      <div className="register">
        {[...zeitleiste].reverse().map((z) => (
          <div className="posten" key={`${z.giltAb}-${z.quelle}`}>
            <span className="nummer ziffern">{z.giltAb.slice(2, 7)}</span>
            <span className="betreff">{z.quelle}</span>
            <span className="zeit ziffern">{euro(z.miete.summe)}</span>
            <span className="unterzeile">
              <span>
                {tag(z.giltAb)} – {z.bis ? tag(z.bis) : "läuft"}
              </span>
              {z.grund && <span>{z.grund}</span>}
              {z.beleg && <span>{z.beleg}</span>}
              {z.miete.posten.length > 0 && (
                <span className="ziffern">
                  {z.miete.posten.map((p) => euro(p.betrag)).join(" + ")}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>

      {/* --- Kaution --- */}
      <div className="titelzeile" style={{ marginTop: "2rem" }}>
        <h1>Kaution</h1>
        <span className="zaehler ziffern">
          {kaution > 0 ? euro(kaution) : "keine"}
        </span>
      </div>
      {kaution > 0 && (
        <p className="hinweis">
          Vereinbart{" "}
          {kopf.kaution_raten > 1
            ? `in ${kopf.kaution_raten} Raten (§ 551 Abs. 2 BGB)`
            : "in einer Summe"}
          .
        </p>
      )}
      {kautionseingaenge.length > 0 ? (
        <div className="register">
          {kautionseingaenge.map((b, i) => (
            <div className="posten" key={i}>
              <span className="nummer ziffern">{b.buchungstag.slice(2, 7)}</span>
              <span className="betreff">{b.absender ?? "ohne Absender"}</span>
              <span className="zeit ziffern">{euro(Number(b.betrag))}</span>
              <span className="unterzeile">
                <span>{tag(b.buchungstag)}</span>
                <span>{b.verwendungszweck}</span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="hinweis">
          Kein Eingang gefunden, der nach Kaution aussieht.
        </p>
      )}
      <p className="hinweis">
        Ob die Kaution eingegangen ist, führt diese Verwaltung nicht als
        eigenes Feld. Gezeigt werden Buchungen, in deren Verwendungszweck
        &bdquo;Kaution&ldquo; steht und die den Namen des Mieters nennen —
        ein Hinweis, keine Feststellung. Barzahlungen und Zahlungen Dritter
        unter fremdem Namen tauchen hier nicht auf.
      </p>

      {/* --- Zahlungsverlauf --- */}
      <div className="titelzeile" style={{ marginTop: "2rem" }}>
        <h1>Zahlungsverlauf</h1>
        <span className="zaehler ziffern">{soll.length} Monate</span>
      </div>
      {soll.length === 0 ? (
        <p className="hinweis">
          Für dieses Mietverhältnis ist noch keine Miete fällig gestellt.
        </p>
      ) : (
        <div className="register">
          {soll.map((s) => {
            const stand = standVon(s);
            const bezahlt = Number(s.bezahlt);
            return (
              <div
                className="posten"
                key={s.id}
                data-heikel={stand.heikel ? "ja" : undefined}
              >
                <span className="nummer ziffern">{s.monat.slice(2, 7)}</span>
                <span className="betreff">{monatName(s.monat)}</span>
                <span className="zeit ziffern">{euro(Number(s.betrag))}</span>
                <span className="unterzeile">
                  <span
                    className={stand.heikel ? "marker" : undefined}
                    data-art={stand.heikel ? "heikel" : undefined}
                  >
                    {stand.text}
                  </span>
                  {bezahlt > 0 && (
                    <span className="ziffern">{euro(bezahlt)} eingegangen</span>
                  )}
                  {s.letzte_zahlung && (
                    <span>letzte Zahlung {tag(s.letzte_zahlung)}</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {soll.length === 36 && (
        <p className="hinweis">
          Gezeigt werden die letzten 36 Monate. Alles weitere steht im{" "}
          <Link href="/mietenbuch">Mietenbuch</Link>.
        </p>
      )}

      {/* --- Dokumente --- */}
      <div className="titelzeile" style={{ marginTop: "2.5rem" }}>
        <h1>Dokumente</h1>
        <span className="zaehler ziffern">{dokumente.length}</span>
      </div>
      <DokumentListe
        dokumente={akten}
        loeschbar={darfSchreiben}
        erzeugte={erzeugte}
      />
      {bilder.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <Bildergalerie bilder={bilder} loeschbar={darfSchreiben} />
        </div>
      )}
      {darfSchreiben && (
        <DokumentHochladen
          bezug={{ mietverhaeltnis_id: id }}
          vorgabeArt="uebergabeprotokoll"
          hinweisMieter="Mit Haken sieht genau dieser Mieter die Datei in seinem Bereich — kein anderer."
        />
      )}

      <div className="knopfreihe" style={{ marginTop: "2rem" }}>
        <Link href={`/einheit/${kopf.einheit_id}`} className="rueckmeldung">
          Zur Einheit
        </Link>
        <Link href="/mietenbuch" className="rueckmeldung">
          Mietenbuch
        </Link>
      </div>
    </>
  );
}
