import Link from "next/link";
import { notFound } from "next/navigation";
import { one, query } from "@/lib/db";
import { tag } from "@/lib/formate";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import {
  dokumenteFuer,
  gueltigeMiete,
  istBild,
  mietzusammensetzung,
  type Anpassung,
} from "@/lib/dokumente";
import { Bildergalerie } from "@/components/Bildergalerie";
import { DokumentListe } from "@/components/DokumentListe";
import { DokumentHochladen } from "@/components/DokumentHochladen";

export const dynamic = "force-dynamic";

/**
 * Eine Einheit: Stammdaten, wer wann darin gewohnt hat, Bilder, Grundriss.
 *
 * Die Geschichte der Mietverhältnisse ist der Teil, den es vorher nirgends
 * gab. Die Stammdatenseite zeigt nur das laufende; beendete waren nicht
 * auffindbar, obwohl genau sie die Fragen beantworten: Wie lange stand das
 * Zimmer leer? Was hat es vorher gekostet? Wer war der Vormieter, dessen
 * Kaution noch nicht abgerechnet ist?
 *
 * Der aktuelle Mietpreis steht mit seiner Herkunft da -- Vertrag oder
 * Mietanpassung. Ohne diese Angabe ist ein Betrag nicht nachvollziehbar,
 * und bei den übernommenen Altmietverhältnissen weicht der Betrag am
 * Mietverhältnis regelmäßig von dem ab, der heute gilt.
 */

interface Kopf {
  id: string;
  bezeichnung: string;
  etage: string | null;
  art: string;
  flaeche_qm: string | null;
  schluessel: string | null;
  notizen: string | null;
  vermarktung: string;
  verfuegbar_ab: string | null;
  vermarktungshinweis: string | null;
  belegung_gepflegt: boolean;
  angebot_kaltmiete: string | null;
  angebot_nebenkosten: string | null;
  objekt_id: string;
  objekt: string;
  strasse: string;
  plz: string;
  ort: string;
  eltern_id: string | null;
  eltern: string | null;
}

interface MvZeile {
  id: string;
  mieter: string;
  beginn: string;
  ende: string | null;
  status: string;
  moebliert: boolean;
  gekuendigt_am: string | null;
  kuendigung_durch: string | null;
  nachmieter_gesucht: boolean | null;
  anfang_kalt: string | null;
  anfang_nk: string | null;
  anfang_moebel: string | null;
  anfang_gesamt: string | null;
  zuletzt_kalt: string | null;
  zuletzt_nk: string | null;
  zuletzt_moebel: string | null;
  zuletzt_gesamt: string | null;
}

const euro = (betrag: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    betrag,
  );

const ART_TEXT: Record<string, string> = {
  wohnen: "Wohnen",
  gewerbe: "Gewerbe",
  gemeinschaft: "Wohnung/WG (wird einzeln vermietet)",
};

const VERMARKTUNG_TEXT: Record<string, string> = {
  anbieten: "wird angeboten",
  nicht_anbieten: "wird nicht angeboten",
  im_bau: "im Bau",
};

export default async function Einheitenseite({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sitzung = await angemeldeteSitzung();
  const darfSchreiben = sitzung?.rolle === "verwalter";

  const kopf = await one<Kopf>(
    `SELECT e.id, e.bezeichnung, e.etage, e.art, e.flaeche_qm::text,
            e.schluessel, e.notizen, e.vermarktung, e.verfuegbar_ab::text,
            e.vermarktungshinweis, e.belegung_gepflegt,
            e.angebot_kaltmiete::text, e.angebot_nebenkosten::text,
            o.id AS objekt_id, o.name AS objekt, o.strasse, o.plz, o.ort,
            e.eltern_id, eltern.bezeichnung AS eltern
       FROM einheit e
       JOIN objekt o ON o.id = e.objekt_id
       LEFT JOIN einheit eltern ON eltern.id = e.eltern_id
      WHERE e.id = $1`,
    [id],
  );
  if (!kopf) notFound();

  // Die ganze Geschichte, auch beendete Mietverhältnisse. Zwei Mietstände
  // je Zeile: der zum Einzug und der zuletzt gültige -- daran liest man
  // die Mietentwicklung des Zimmers ab, ohne jede Anpassung zu laden.
  const verlauf = await query<MvZeile>(
    `
    SELECT mv.id, k.anzeigename AS mieter, mv.beginn::text, mv.ende::text,
           mv.status, mv.moebliert,
           ku.eingegangen_am::text AS gekuendigt_am,
           ku.durch                AS kuendigung_durch,
           ku.nachmieter_gesucht,
           a.kaltmiete::text            AS anfang_kalt,
           a.nebenkosten::text          AS anfang_nk,
           a.moeblierungszuschlag::text AS anfang_moebel,
           a.gesamtmiete::text          AS anfang_gesamt,
           z.kaltmiete::text            AS zuletzt_kalt,
           z.nebenkosten::text          AS zuletzt_nk,
           z.moeblierungszuschlag::text AS zuletzt_moebel,
           z.gesamtmiete::text          AS zuletzt_gesamt
      FROM mietverhaeltnis mv
      JOIN kontakt k ON k.id = mv.kontakt_id
      LEFT JOIN kuendigung ku
             ON ku.mietverhaeltnis_id = mv.id
            AND ku.zurueckgenommen_am IS NULL
      LEFT JOIN LATERAL miete_am(mv.id, mv.beginn) a ON true
      LEFT JOIN LATERAL miete_am(
            mv.id, LEAST(current_date, COALESCE(mv.ende, current_date))) z ON true
     WHERE mv.einheit_id = $1
     ORDER BY mv.beginn DESC
  `,
    [id],
  );

  const heute = new Date().toISOString().slice(0, 10);
  const laufend = verlauf.find(
    (m) => m.status !== "beendet" && (m.ende === null || m.ende >= heute),
  );

  // Die Herkunft des heutigen Preises. Nur für das laufende
  // Mietverhältnis -- bei beendeten ist die Frage beantwortet.
  const anpassungen = laufend
    ? await query<Anpassung>(
        `SELECT gilt_ab::text, kaltmiete::text, nebenkosten::text,
                moeblierungszuschlag::text AS moeblierung,
                gesamtmiete::text, grund, beleg
           FROM mietanpassung
          WHERE mietverhaeltnis_id = $1
          ORDER BY gilt_ab`,
        [laufend.id],
      )
    : [];

  const vertragswerte = laufend
    ? await one<{
        kaltmiete: string | null;
        nebenkosten: string | null;
        moeblierung: string | null;
        gesamtmiete: string | null;
      }>(
        `SELECT kaltmiete::text, nebenkosten::text,
                moeblierungszuschlag::text AS moeblierung, gesamtmiete::text
           FROM mietverhaeltnis WHERE id = $1`,
        [laufend.id],
      )
    : null;

  const jetzt =
    laufend && vertragswerte
      ? gueltigeMiete(anpassungen, vertragswerte, heute)
      : null;

  // Zimmer unter dieser WG.
  const kinder =
    kopf.art === "gemeinschaft"
      ? await query<{ id: string; bezeichnung: string; mieter: string | null }>(
          `SELECT e.id, e.bezeichnung, k.anzeigename AS mieter
             FROM einheit e
             LEFT JOIN LATERAL (
                   SELECT * FROM mietverhaeltnis x
                    WHERE x.einheit_id = e.id
                      AND x.status <> 'beendet'
                      AND (x.ende IS NULL OR x.ende >= current_date)
                    ORDER BY x.beginn DESC LIMIT 1) mv ON true
             LEFT JOIN kontakt k ON k.id = mv.kontakt_id
            WHERE e.eltern_id = $1
            ORDER BY e.bezeichnung`,
          [id],
        )
      : [];

  const dokumente = await dokumenteFuer({ einheit_id: id });
  const grundrisse = dokumente.filter((d) => d.art === "grundriss");
  const fotos = dokumente.filter(
    (d) => d.art !== "grundriss" && istBild(d.mime_typ),
  );
  const akten = dokumente.filter(
    (d) => d.art !== "grundriss" && !istBild(d.mime_typ),
  );

  const angebot = mietzusammensetzung({
    kaltmiete: kopf.angebot_kaltmiete,
    nebenkosten: kopf.angebot_nebenkosten,
    moeblierung: null,
    gesamtmiete: null,
  });

  return (
    <>
      <div className="akte-kopf">
        <span className="aktenzeichen ziffern">{kopf.etage ?? "—"}</span>
        <div>
          {/* Die einzige h1 der Seite. Die Abschnitte darunter tragen h2 --
              sieben h1 hintereinander sind fuer einen Screenreader sieben
              Dokumente statt einer Einheit mit sieben Abschnitten. */}
          <h1>{kopf.bezeichnung}</h1>
          <div className="akte-meta">
            <span>
              <Link href={`/objekt/${kopf.objekt_id}`}>{kopf.objekt}</Link>
            </span>
            {kopf.eltern_id && (
              <span>
                Teil von{" "}
                <Link href={`/einheit/${kopf.eltern_id}`}>{kopf.eltern}</Link>
              </span>
            )}
            <span>{ART_TEXT[kopf.art] ?? kopf.art}</span>
            {laufend ? (
              <span>
                vermietet an{" "}
                <Link href={`/mietverhaeltnis/${laufend.id}`}>
                  {laufend.mieter}
                </Link>
              </span>
            ) : kopf.belegung_gepflegt ? (
              // "frei" allein hiess hier etwas anderes als auf dem
              // Cockpit. Ob die Einheit auch angeboten wird, steht in der
              // Vermarktung -- und damit jetzt auch im Wort.
              <span className="marker">
                {kopf.vermarktung === "anbieten"
                  ? "frei und angeboten"
                  : "frei, wird nicht angeboten"}
              </span>
            ) : (
              <span className="marker" data-art="heikel">
                Belegung nicht gepflegt
              </span>
            )}
          </div>
        </div>
      </div>

      {/* --- Stammdaten --- */}
      <div className="titelzeile">
        <h2>Stammdaten</h2>
      </div>
      {/* Stand als Inline-Raster mit eigenen Abstaenden; .datenblatt ist
          dasselbe Raster, nur einmal definiert. */}
      <dl className="datenblatt">
        <dt className="hinweis">Anschrift</dt>
        <dd>
          {kopf.strasse}, {kopf.plz} {kopf.ort}
        </dd>

        <dt className="hinweis">Etage</dt>
        <dd>{kopf.etage ?? "—"}</dd>

        <dt className="hinweis">Art</dt>
        <dd>{ART_TEXT[kopf.art] ?? kopf.art}</dd>

        <dt className="hinweis">Fläche</dt>
        <dd className="ziffern">
          {kopf.flaeche_qm ? `${Number(kopf.flaeche_qm)} m²` : "nicht erfasst"}
        </dd>

        <dt className="hinweis">Schlüssel</dt>
        <dd className="ziffern">
          {kopf.schluessel ?? "keiner vergeben"}
        </dd>

        <dt className="hinweis">Angebotsmiete</dt>
        <dd>
          {angebot.summe > 0 ? (
            <span className="ziffern">
              {euro(angebot.summe)}
              <span className="hinweis">
                {" "}
                ({angebot.posten.map((p) => `${p.bezeichnung} ${euro(p.betrag)}`).join(" + ")})
              </span>
            </span>
          ) : (
            "keine hinterlegt"
          )}
        </dd>

        <dt className="hinweis">Vermarktung</dt>
        <dd>
          {VERMARKTUNG_TEXT[kopf.vermarktung] ?? kopf.vermarktung}
          {kopf.verfuegbar_ab && ` · frei ab ${tag(kopf.verfuegbar_ab)}`}
          {kopf.vermarktungshinweis && (
            <span className="hinweis"> · {kopf.vermarktungshinweis}</span>
          )}
        </dd>

        {kopf.notizen && (
          <>
            <dt className="hinweis">Notizen</dt>
            <dd>{kopf.notizen}</dd>
          </>
        )}
      </dl>

      {/* --- Aktueller Mietpreis --- */}
      {jetzt && (
        <>
          <div className="titelzeile">
            <h2>Mietpreis heute</h2>
            <span className="zaehler ziffern">{euro(jetzt.miete.summe)}</span>
          </div>
          <p className="hinweis">
            Herkunft: {jetzt.quelle}
            {jetzt.giltAb ? ` — gilt ab ${tag(jetzt.giltAb)}` : ""}
            {jetzt.miete.inklusiv && " · als Inklusivmiete vereinbart"}
          </p>
          {jetzt.miete.posten.length > 0 && (
            <p className="ziffern">
              {jetzt.miete.posten
                .map((p) => `${p.bezeichnung} ${euro(p.betrag)}`)
                .join("  ·  ")}
            </p>
          )}
          {jetzt.miete.abweichung !== null && (
            <p className="hinweis">
              Die zugesagte Gesamtmiete liegt {euro(jetzt.miete.abweichung)} über
              der Summe der Posten. In dieser Differenz steckt meist ein
              Möblierungszuschlag, der nicht eingetragen ist.
            </p>
          )}
          <div className="knopfreihe">
            {/* Ein Weg, also .verweis. Als .rueckmeldung war das graues
                Kleingedrucktes und wurde nicht als Link gelesen. */}
            <Link href={`/mietverhaeltnis/${laufend!.id}`} className="verweis">
              Mietverhältnis ansehen
            </Link>
          </div>
        </>
      )}

      {/* --- Geschichte --- */}
      <div className="titelzeile">
        <h2>Mietverhältnisse</h2>
        <span className="zaehler ziffern">{verlauf.length}</span>
      </div>
      {verlauf.length === 0 ? (
        <div className="leer">
          <strong>Noch kein Mietverhältnis erfasst</strong>
          {kopf.art === "gemeinschaft"
            ? "Diese Wohnung wird zimmerweise vermietet — die Mietverhältnisse hängen an den Zimmern."
            : "Unter Stammdaten lässt sich eines eintragen."}
        </div>
      ) : (
        <div className="register">
          {verlauf.map((m) => {
            const anfang = mietzusammensetzung({
              kaltmiete: m.anfang_kalt,
              nebenkosten: m.anfang_nk,
              moeblierung: m.anfang_moebel,
              gesamtmiete: m.anfang_gesamt,
            });
            const zuletzt = mietzusammensetzung({
              kaltmiete: m.zuletzt_kalt,
              nebenkosten: m.zuletzt_nk,
              moeblierung: m.zuletzt_moebel,
              gesamtmiete: m.zuletzt_gesamt,
            });
            const aktiv = m.id === laufend?.id;
            return (
              // Genau ein Ziel, also traegt die ganze Zeile den Weg --
              // auf dem Telefon ist das eine Flaeche statt eines Wortes.
              // Vorher leuchtete sie beim Ueberfahren auf, ohne ein Ziel
              // zu haben; geklickt werden konnte nur der Name.
              <Link
                href={`/mietverhaeltnis/${m.id}`}
                className="posten"
                key={m.id}
                data-heikel={m.gekuendigt_am ? "ja" : undefined}
              >
                <span className="nummer">{m.beginn.slice(0, 4)}</span>
                <span className="betreff">{m.mieter}</span>
                <span className="zeit ziffern">
                  {zuletzt.summe > 0 ? euro(zuletzt.summe) : "—"}
                </span>
                <span className="unterzeile">
                  <span>
                    {tag(m.beginn)} – {m.ende ? tag(m.ende) : "unbefristet"}
                  </span>
                  {aktiv ? (
                    <span className="marker">laufend</span>
                  ) : (
                    <span>beendet</span>
                  )}
                  {anfang.summe > 0 && anfang.summe !== zuletzt.summe && (
                    <span className="ziffern">
                      zu Beginn {euro(anfang.summe)}
                    </span>
                  )}
                  {m.moebliert && <span>möbliert</span>}
                  {m.gekuendigt_am && (
                    <span className="marker" data-art="heikel">
                      gekündigt am {tag(m.gekuendigt_am)}
                      {m.kuendigung_durch === "vermieter" ? " (durch uns)" : ""}
                      {m.nachmieter_gesucht ? " · Nachmieter gesucht" : ""}
                    </span>
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {/* --- Zimmer dieser WG --- */}
      {kinder.length > 0 && (
        <>
          <div className="titelzeile">
            <h2>Zimmer</h2>
            <span className="zaehler ziffern">{kinder.length}</span>
          </div>
          <div className="register">
            {/* Ein Zimmer hat genau ein Ziel -- die ganze Zeile ist der
                Link. Ein Link im Link ist kein gueltiges HTML, die
                Bezeichnung ist deshalb kein eigener Link mehr. */}
            {kinder.map((z) => (
              <Link href={`/einheit/${z.id}`} className="posten" key={z.id}>
                <span className="nummer">·</span>
                <span className="betreff">{z.bezeichnung}</span>
                <span className="zeit" />
                <span className="unterzeile">
                  <span>{z.mieter ?? "kein eigenes Mietverhältnis"}</span>
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      {/* --- Grundriss --- */}
      <div className="titelzeile">
        <h2>Grundriss</h2>
        <span className="zaehler ziffern">{grundrisse.length}</span>
      </div>
      <Bildergalerie
        bilder={grundrisse.filter((d) => istBild(d.mime_typ))}
        loeschbar={darfSchreiben}
        gross
        leerText="Kein Grundriss als Bild hinterlegt."
      />
      {grundrisse.some((d) => !istBild(d.mime_typ)) && (
        <div className="abschnitt">
          <DokumentListe
            dokumente={grundrisse.filter((d) => !istBild(d.mime_typ))}
            loeschbar={darfSchreiben}
          />
          <p className="hinweis">
            Ein Grundriss als PDF lässt sich hier nicht groß anzeigen — er
            öffnet sich über &bdquo;ansehen&ldquo; in einem eigenen Reiter.
          </p>
        </div>
      )}

      {/* --- Bilder --- */}
      <div className="titelzeile">
        <h2>Bilder</h2>
        <span className="zaehler ziffern">{fotos.length}</span>
      </div>
      <Bildergalerie bilder={fotos} loeschbar={darfSchreiben} />

      {/* --- Weitere Dokumente --- */}
      <div className="titelzeile">
        <h2>Weitere Dokumente</h2>
        <span className="zaehler ziffern">{akten.length}</span>
      </div>
      <DokumentListe dokumente={akten} loeschbar={darfSchreiben} />

      {darfSchreiben && (
        <DokumentHochladen
          bezug={{ einheit_id: id }}
          vorgabeArt="foto"
          hinweisMieter="Mit Haken sieht der Mieter dieser Einheit die Datei in seinem Bereich — niemand sonst."
        />
      )}

      <div className="knopfreihe abschnitt">
        <Link href={`/objekt/${kopf.objekt_id}`} className="verweis">
          Zurück zu {kopf.objekt}
        </Link>
        <Link href="/objekte" className="verweis">
          Alle Objekte
        </Link>
      </div>
    </>
  );
}
