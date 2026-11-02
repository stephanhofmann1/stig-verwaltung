import Link from "next/link";
import { notFound } from "next/navigation";
import { one, query } from "@/lib/db";
import { tag } from "@/lib/formate";
import {
  baujahrAusNotizen,
  dokumenteFuer,
  istBild,
  mietzusammensetzung,
} from "@/lib/dokumente";
import { Bildergalerie } from "@/components/Bildergalerie";
import { DokumentListe } from "@/components/DokumentListe";
import { DokumentHochladen } from "@/components/DokumentHochladen";
import { angemeldeteSitzung } from "@/lib/anmeldung";

export const dynamic = "force-dynamic";

/**
 * Ein Objekt mit allem, was daran hängt.
 *
 * Vorher war die Stammdatenseite eine flache Liste aller Einheiten beider
 * Häuser, und das Haus selbst kam darin nicht vor. Hier steht es: Anschrift,
 * Einheiten mit Belegung und Miete, die drei Summen, die man beim
 * Draufsehen wissen will, und die Dokumente, die fürs ganze Haus gelten --
 * Energieausweis, Lageplan.
 *
 * Zur Vorsicht bei "frei": Aus "kein Mietverhältnis erfasst" folgt nicht
 * "leer". Die Spalte belegung_gepflegt (db/017) sagt, ob jemand die
 * Belegung dieser Einheit wirklich gepflegt hat; solange sie aus ist,
 * steht hier "Belegung offen" und nicht "frei". Der umgekehrte Vorgabewert
 * hat im September dazu geführt, dass vermietete Zimmer öffentlich
 * angeboten wurden.
 */

interface Kopf {
  id: string;
  name: string;
  strasse: string;
  plz: string;
  ort: string;
  notizen: string | null;
  zahlungsdaten_ab: string | null;
}

interface EinheitZeile {
  id: string;
  bezeichnung: string;
  etage: string | null;
  art: string;
  flaeche_qm: string | null;
  schluessel: string | null;
  eltern_id: string | null;
  eltern: string | null;
  vermarktung: string;
  verfuegbar_ab: string | null;
  belegung_gepflegt: boolean;
  angebot_kaltmiete: string | null;
  angebot_nebenkosten: string | null;
  mv_id: string | null;
  mieter: string | null;
  beginn: string | null;
  ende: string | null;
  status: string | null;
  m_kalt: string | null;
  m_nk: string | null;
  m_moebel: string | null;
  m_gesamt: string | null;
}

const euro = (betrag: number | null) =>
  betrag === null
    ? "—"
    : new Intl.NumberFormat("de-DE", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
      }).format(betrag);

const euroGenau = (betrag: number) =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(betrag);

export default async function Objektseite({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sitzung = await angemeldeteSitzung();
  const darfSchreiben = sitzung?.rolle === "verwalter";

  const kopf = await one<Kopf>(
    `SELECT id, name, strasse, plz, ort, notizen, zahlungsdaten_ab::text
       FROM objekt WHERE id = $1`,
    [id],
  );
  if (!kopf) notFound();

  const einheiten = await query<EinheitZeile>(
    `
    SELECT e.id, e.bezeichnung, e.etage, e.art,
           e.flaeche_qm::text, e.schluessel, e.eltern_id,
           eltern.bezeichnung AS eltern,
           e.vermarktung, e.verfuegbar_ab::text, e.belegung_gepflegt,
           e.angebot_kaltmiete::text, e.angebot_nebenkosten::text,
           mv.id AS mv_id, k.anzeigename AS mieter,
           mv.beginn::text, mv.ende::text, mv.status,
           -- Die Miete, die heute gilt: miete_am() aus db/022 nimmt die
           -- jüngste Anpassung und fällt sonst auf das Mietverhältnis
           -- zurück. Hier nicht nachgerechnet -- dieselbe Regel wie in
           -- der Sollstellung.
           m.kaltmiete::text            AS m_kalt,
           m.nebenkosten::text          AS m_nk,
           m.moeblierungszuschlag::text AS m_moebel,
           m.gesamtmiete::text          AS m_gesamt
      FROM einheit e
      LEFT JOIN einheit eltern ON eltern.id = e.eltern_id
      LEFT JOIN LATERAL (
            SELECT * FROM mietverhaeltnis x
             WHERE x.einheit_id = e.id
               AND x.status <> 'beendet'
               AND (x.ende IS NULL OR x.ende >= current_date)
             ORDER BY x.beginn DESC LIMIT 1) mv ON true
      LEFT JOIN kontakt k ON k.id = mv.kontakt_id
      LEFT JOIN LATERAL miete_am(mv.id, current_date) m ON true
     WHERE e.objekt_id = $1
     ORDER BY COALESCE(eltern.bezeichnung, e.bezeichnung),
              (e.eltern_id IS NOT NULL), e.bezeichnung
  `,
    [id],
  );

  const dokumente = await dokumenteFuer({ objekt_id: id });
  const bilder = dokumente.filter((d) => istBild(d.mime_typ));
  const akten = dokumente.filter((d) => !istBild(d.mime_typ));

  // --- Belegung ------------------------------------------------------------
  // Ein Zimmer unter einer WG gilt als belegt, wenn das Mietverhältnis an
  // der WG hängt. Im 2. OG läuft ein Altmietverhältnis über die ganze
  // Etage; ohne diese Zeile wären die fünf Zimmer darunter "frei".
  const belegt = new Set(
    einheiten.filter((e) => e.mv_id).map((e) => e.id),
  );
  const istBelegt = (e: EinheitZeile) =>
    !!e.mv_id || (e.eltern_id ? belegt.has(e.eltern_id) : false);

  const miete = (e: EinheitZeile) =>
    e.mv_id
      ? mietzusammensetzung({
          kaltmiete: e.m_kalt,
          nebenkosten: e.m_nk,
          moeblierung: e.m_moebel,
          gesamtmiete: e.m_gesamt,
        }).summe
      : null;

  const sollSumme = einheiten.reduce((s, e) => s + (miete(e) ?? 0), 0);

  // Leerstand nur dort, wo die Belegung gepflegt ist und die Einheit
  // überhaupt angeboten wird. Eine Gemeinschaftsfläche steht nie leer --
  // sie wird gar nicht einzeln vermietet.
  const frei = einheiten.filter(
    (e) =>
      !istBelegt(e) &&
      e.art !== "gemeinschaft" &&
      e.belegung_gepflegt &&
      e.vermarktung === "anbieten",
  );
  const offen = einheiten.filter(
    (e) => !istBelegt(e) && e.art !== "gemeinschaft" && !e.belegung_gepflegt,
  );
  const entgangen = frei.reduce(
    (s, e) =>
      s +
      mietzusammensetzung({
        kaltmiete: e.angebot_kaltmiete,
        nebenkosten: e.angebot_nebenkosten,
        moeblierung: null,
        gesamtmiete: null,
      }).summe,
    0,
  );

  // Flächen: nur summieren, was da ist, und sagen, wie viel fehlt. Eine
  // Summe aus halben Angaben sieht vollständig aus und ist es nicht.
  const mitFlaeche = einheiten.filter((e) => e.flaeche_qm !== null);
  const flaeche = mitFlaeche.reduce((s, e) => s + Number(e.flaeche_qm), 0);
  const ohneFlaeche = einheiten.length - mitFlaeche.length;

  const baujahr = baujahrAusNotizen(kopf.notizen);
  const einzeln = einheiten.filter((e) => e.art !== "gemeinschaft");

  return (
    <>
      <div className="akte-kopf">
        <span className="aktenzeichen ziffern">{einzeln.length}</span>
        <div>
          <h1>{kopf.name}</h1>
          <div className="akte-meta">
            <span>
              {kopf.strasse}, {kopf.plz} {kopf.ort}
            </span>
            {baujahr && <span>Baujahr {baujahr}</span>}
            <span>{einzeln.length} Einheiten</span>
            {kopf.zahlungsdaten_ab ? (
              <span>Kontodaten ab {tag(kopf.zahlungsdaten_ab)}</span>
            ) : (
              <span className="marker" data-art="heikel">
                keine Kontodaten — hier wird nicht gemahnt
              </span>
            )}
          </div>
        </div>
      </div>

      {/* --- Summen --- */}
      <div
        style={{
          display: "grid",
          gap: "0.75rem 2rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(11rem, 1fr))",
          borderTop: "1px solid var(--linie)",
          borderBottom: "1px solid var(--linie)",
          padding: "1rem 0",
          margin: "1.5rem 0",
        }}
      >
        <div>
          <div className="hinweis">Soll je Monat</div>
          <div className="ziffern" style={{ fontSize: "1.375rem", fontWeight: 600 }}>
            {euroGenau(sollSumme)}
          </div>
          <div className="hinweis">
            {einheiten.filter(istBelegt).filter((e) => e.art !== "gemeinschaft").length}{" "}
            von {einzeln.length} Einheiten belegt
          </div>
        </div>
        <div>
          <div className="hinweis">Leerstand</div>
          <div className="ziffern" style={{ fontSize: "1.375rem", fontWeight: 600 }}>
            {frei.length}
          </div>
          <div className="hinweis">
            {entgangen > 0
              ? `${euro(entgangen)} Angebotsmiete je Monat`
              : "keine Angebotsmiete hinterlegt"}
            {offen.length > 0 && ` · ${offen.length} × Belegung offen`}
          </div>
        </div>
        <div>
          <div className="hinweis">Fläche</div>
          <div className="ziffern" style={{ fontSize: "1.375rem", fontWeight: 600 }}>
            {flaeche > 0
              ? `${flaeche.toLocaleString("de-DE", { maximumFractionDigits: 1 })} m²`
              : "—"}
          </div>
          <div className="hinweis">
            {ohneFlaeche > 0
              ? `${ohneFlaeche} Einheiten ohne Flächenangabe`
              : "alle Einheiten erfasst"}
          </div>
        </div>
      </div>

      {kopf.notizen && <p className="hinweis">{kopf.notizen}</p>}

      <div className="knopfreihe">
        {/* Der einzige Rueckweg der Seite. Als `rueckmeldung` war er graues
            13-Pixel-Kleingedrucktes neben den Knoepfen und wurde nicht als
            Weg gelesen -- wer hier landete, kam nur ueber den Zurueck-Knopf
            des Browsers wieder heraus. */}
        <Link href="/mietenbuch" className="verweis">
          Mietenbuch
        </Link>
        <Link href="/stammdaten" className="verweis">
          Stammdaten
        </Link>
      </div>

      {/* --- Einheiten --- */}
      <div className="titelzeile" style={{ marginTop: "2rem" }}>
        <h1>Einheiten</h1>
        <span className="zaehler ziffern">{einheiten.length}</span>
      </div>

      <div className="register">
        {einheiten.map((e) => {
          const betrag = miete(e);
          const ueberWg = !e.mv_id && e.eltern_id && belegt.has(e.eltern_id);
          return (
            // Die Zeile traegt zwei Wege (Einheit, Mietverhaeltnis), und ein
            // Link darf keinen Link enthalten. Also bleibt sie ein div --
            // ohne das Aufleuchten, das eine Klickbarkeit verspricht, die
            // nur die beiden Woerter haben.
            <div className="posten" data-still="ja" key={e.id}>
              <span className="nummer">{e.etage ?? "—"}</span>
              <span className="betreff">
                <Link href={`/einheit/${e.id}`}>{e.bezeichnung}</Link>
                {e.art === "gewerbe" && (
                  <span style={{ fontWeight: 400, color: "var(--tinte-leise)" }}>
                    {" "}· Gewerbe
                  </span>
                )}
                {e.art === "gemeinschaft" && (
                  <span style={{ fontWeight: 400, color: "var(--tinte-leise)" }}>
                    {" "}· Wohnung/WG
                  </span>
                )}
              </span>
              <span className="zeit ziffern">
                {betrag !== null ? euroGenau(betrag) : ""}
              </span>
              <span className="unterzeile">
                {e.mieter ? (
                  <span>
                    <Link href={`/mietverhaeltnis/${e.mv_id}`}>{e.mieter}</Link>
                    {e.beginn ? ` seit ${tag(e.beginn)}` : ""}
                  </span>
                ) : ueberWg ? (
                  <span>belegt über {e.eltern}</span>
                ) : e.art === "gemeinschaft" ? (
                  <span>einzeln vermietet</span>
                ) : e.belegung_gepflegt ? (
                  <span>frei</span>
                ) : (
                  <span className="marker">Belegung offen</span>
                )}
                {e.flaeche_qm && <span>{Number(e.flaeche_qm)} m²</span>}
                {e.status === "gekuendigt" && (
                  <span className="marker" data-art="heikel">
                    gekündigt{e.ende ? ` zum ${tag(e.ende)}` : ""}
                  </span>
                )}
                {e.vermarktung === "im_bau" && <span className="marker">im Bau</span>}
                {e.schluessel && <span className="ziffern">{e.schluessel}</span>}
              </span>
            </div>
          );
        })}
      </div>

      {/* --- Dokumente --- */}
      <div className="titelzeile" style={{ marginTop: "2.5rem" }}>
        <h1>Dokumente zum Haus</h1>
        <span className="zaehler ziffern">{dokumente.length}</span>
      </div>
      <p className="hinweis">
        Was fürs ganze Haus gilt: Energieausweis, Lageplan, Hausordnung.
        Grundrisse und Fotos einzelner Wohnungen gehören an die Einheit.
      </p>

      <Bildergalerie
        bilder={bilder}
        loeschbar={darfSchreiben}
        leerText="Keine Bilder zum Haus hinterlegt."
      />
      <div style={{ marginTop: "1rem" }}>
        <DokumentListe dokumente={akten} loeschbar={darfSchreiben} />
      </div>

      {darfSchreiben && (
        <DokumentHochladen
          bezug={{ objekt_id: id }}
          vorgabeArt="energieausweis"
          hinweisMieter="Mit Haken sehen alle Mieter dieses Hauses die Datei in ihrem Bereich."
        />
      )}
    </>
  );
}
