import Link from "next/link";
import { notFound } from "next/navigation";
import { one } from "@/lib/db";
import { tag } from "@/lib/formate";
import { baujahrAusNotizen, dokumenteFuer, istBild } from "@/lib/dokumente";
import {
  eigeneMietverhaeltnisse,
  einheitenDesObjekts,
  mieteDerEinheit,
  objektKennzahlen,
} from "@/lib/objekte";
import { objektWirtschaft } from "@/lib/rendite";
import { ObjektWirtschaft } from "@/components/ObjektWirtschaft";
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
 * Abfrage und Zahlen stehen seit der Objektübersicht in lib/objekte.ts.
 * Diese Seite und /objekte lesen dieselbe Ableitung; vorher wäre für die
 * Übersicht eine zweite Rechnung derselben Zahlen entstanden, und genau so
 * sind Cockpit und Objektseite beim Wort "Leerstand" auseinandergelaufen.
 *
 * Zur Vorsicht bei "frei": Aus "kein Mietverhältnis erfasst" folgt nicht
 * "leer" -- siehe den Kopf von lib/objekte.ts.
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

  const einheiten = await einheitenDesObjekts(id);
  const zahlen = objektKennzahlen(einheiten);
  const mitVertrag = eigeneMietverhaeltnisse(einheiten);

  const dokumente = await dokumenteFuer({ objekt_id: id });
  // Kaufpreis, Finanzierung und die daraus gerechnete Lage. Gibt null
  // zurueck, wenn es das Objekt nicht gibt -- das ist oben schon
  // abgefangen, der Zweig bleibt trotzdem stehen.
  const wirtschaft = await objektWirtschaft(id);
  const bilder = dokumente.filter((d) => istBild(d.mime_typ));
  const akten = dokumente.filter((d) => !istBild(d.mime_typ));

  const baujahr = baujahrAusNotizen(kopf.notizen);

  return (
    <>
      <div className="akte-kopf">
        <span className="aktenzeichen ziffern">{zahlen.einzeln}</span>
        <div>
          {/* Die einzige h1 der Seite. Alles darunter ist ein Abschnitt
              dieses Dokuments und trägt h2 -- acht h1 hintereinander sind
              für einen Screenreader acht Dokumente. */}
          <h1>{kopf.name}</h1>
          <div className="akte-meta">
            <span>
              {kopf.strasse}, {kopf.plz} {kopf.ort}
            </span>
            {baujahr && <span>Baujahr {baujahr}</span>}
            <span>{zahlen.einzeln} Einheiten</span>
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

      {/* --- Summen ---
          Stand als Inline-Raster mit festen Abständen im Markup. Jetzt
          .karten/.karte/.kennzahl -- dieselben Kennzahlen wie im Cockpit
          sehen dann auch gleich aus. */}
      <div className="karten">
        <div className="karte">
          <div className="kennzahl">
            <span className="kennzahl-schild">Soll je Monat (warm)</span>
            <span className="kennzahl-wert ziffern">
              {euroGenau(zahlen.sollMonat)}
            </span>
            {/* Kalt und BK getrennt, und was sich NICHT aufteilen laesst
                als eigener Posten. Rund zwei Drittel der WG-Zimmer sind
                als Inklusivmiete vermietet und haben gar keine getrennte
                Kaltmiete; dazu kommen Moeblierungszuschlaege. Wer diesen
                Teil in die Kaltspalte schiebt, schreibt eine Kaltmiete
                hin, die niemand vereinbart hat -- und aus der spaeter
                eine Mieterhoehung begruendet wird. Dieselbe Trennung wie
                im Mietenbuch, aus derselben Ableitung in lib/objekte.ts. */}
            <span className="erklaerung ziffern">
              Kalt {euroGenau(zahlen.sollMonatKalt)} · BK{" "}
              {euroGenau(zahlen.sollMonatNebenkosten)}
              {zahlen.sollMonatOhneAufteilung !== 0 && (
                <>
                  {" "}
                  · ohne Aufteilung{" "}
                  {euroGenau(zahlen.sollMonatOhneAufteilung)}
                </>
              )}
            </span>
            <span className="erklaerung">
              {zahlen.belegt} von {zahlen.einzeln} Einheiten belegt
            </span>
          </div>
        </div>
        <div className="karte">
          <div className="kennzahl">
            {/* Nicht mehr "Leerstand": Dieselbe Zahl hieß auf dem Cockpit
                etwas anderes. Hier sind nur die vermarktbaren Einheiten
                gemeint, und das steht jetzt im Schild statt in keinem
                Text. */}
            <span className="kennzahl-schild">Frei und angeboten</span>
            <span
              className="kennzahl-wert ziffern"
              data-art={zahlen.angebotenFrei.length > 0 ? "warn" : "gut"}
            >
              {zahlen.angebotenFrei.length}
            </span>
            <span className="erklaerung">
              {zahlen.entgangeneAngebotsmiete > 0
                ? `${euro(zahlen.entgangeneAngebotsmiete)} Angebotsmiete je Monat`
                : "keine Angebotsmiete hinterlegt"}
              {zahlen.belegungOffen > 0 &&
                ` · ${zahlen.belegungOffen} × Belegung offen`}
            </span>
          </div>
        </div>
        <div className="karte">
          <div className="kennzahl">
            <span className="kennzahl-schild">Fläche</span>
            <span className="kennzahl-wert ziffern">
              {zahlen.flaeche > 0
                ? `${zahlen.flaeche.toLocaleString("de-DE", { maximumFractionDigits: 1 })} m²`
                : "—"}
            </span>
            <span className="erklaerung">
              {zahlen.ohneFlaeche > 0
                ? `${zahlen.ohneFlaeche} Einheiten ohne Flächenangabe`
                : "alle Einheiten erfasst"}
            </span>
          </div>
        </div>
      </div>

      <p className="erklaerung">
        <strong>Frei und angeboten</strong> zählt nur vermarktbare
        Einheiten: ohne Gemeinschaftsflächen, ohne die auf &bdquo;nicht
        anbieten&ldquo; gestellten Flächen und ohne Einheiten im Bau. Eine
        Einheit, deren Belegung nie gepflegt wurde, gilt als belegt und
        steht getrennt als &bdquo;Belegung offen&ldquo; — lieber ein freies
        Zimmer nicht anbieten als ein bewohntes. Das Cockpit zählt unter
        &bdquo;Leerstand&ldquo; dieselben freien Einheiten, nimmt aber
        zusätzlich auf, was in den nächsten drei Monaten frei wird.
      </p>

      {kopf.notizen && <p className="hinweis">{kopf.notizen}</p>}

      <div className="knopfreihe">
        {/* Die Rückwege der Seite. Als `rueckmeldung` waren sie graues
            13-Pixel-Kleingedrucktes neben den Knöpfen und wurden nicht als
            Weg gelesen -- wer hier landete, kam nur über den Zurück-Knopf
            des Browsers wieder heraus. */}
        <Link href="/objekte" className="verweis">
          Alle Objekte
        </Link>
        <Link href="/mietenbuch" className="verweis">
          Mietenbuch
        </Link>
        <Link href="/stammdaten" className="verweis">
          Einheiten &amp; Mietverhältnisse
        </Link>
      </div>

      {/* --- Einheiten --- */}
      <div className="titelzeile">
        <h2>Einheiten</h2>
        <span className="zaehler ziffern">{einheiten.length}</span>
      </div>

      <div className="register">
        {einheiten.map((e) => {
          const betrag = mieteDerEinheit(e);
          const ueberWg =
            !e.mv_id && e.eltern_id && mitVertrag.has(e.eltern_id);
          return (
            // Die Zeile trägt zwei Wege (Einheit, Mietverhältnis), und ein
            // Link darf keinen Link enthalten. Also bleibt sie ein div --
            // ohne das Aufleuchten, das eine Klickbarkeit verspricht, die
            // nur die beiden Wörter haben.
            <div className="posten" data-still="ja" key={e.id}>
              <span className="nummer">{e.etage ?? "—"}</span>
              <span className="betreff">
                <Link href={`/einheit/${e.id}`}>{e.bezeichnung}</Link>
                {e.art === "gewerbe" && (
                  <span className="hinweis"> · Gewerbe</span>
                )}
                {e.art === "gemeinschaft" && (
                  <span className="hinweis"> · Wohnung/WG</span>
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
                ) : !e.belegung_gepflegt ? (
                  <span className="marker">Belegung offen</span>
                ) : e.vermarktung === "anbieten" ? (
                  <span>frei und angeboten</span>
                ) : (
                  <span>frei, wird nicht angeboten</span>
                )}
                {e.flaeche_qm && <span>{Number(e.flaeche_qm)} m²</span>}
                {e.status === "gekuendigt" && (
                  <span className="marker" data-art="heikel">
                    gekündigt{e.ende ? ` zum ${tag(e.ende)}` : ""}
                  </span>
                )}
                {e.vermarktung === "im_bau" && (
                  <span className="marker">im Bau</span>
                )}
                {e.schluessel && <span className="ziffern">{e.schluessel}</span>}
              </span>
            </div>
          );
        })}
      </div>

      {/* --- Wirtschaft ---
          Was das Haus traegt. Steht bewusst NACH den Einheiten: Die
          Rendite ist das Ergebnis der Belegung darueber, nicht ihr
          Ausgangspunkt. Ohne erfassten Kaufpreis zeigt der Abschnitt
          keine geschaetzte Zahl, sondern Gedankenstriche und den Satz,
          was fehlt -- und das Formular, mit dem man es nachtraegt. */}
      {wirtschaft && (
        <div className="abschnitt">
          <div className="titelzeile">
            <h2>Wirtschaft</h2>
            <span className="zaehler">
              {wirtschaft.stamm.kaufpreis === null
                ? "Kaufpreis nicht erfasst"
                : "Stand der erfassten Werte"}
            </span>
          </div>
          <ObjektWirtschaft
            objektId={id}
            stamm={wirtschaft.stamm}
            lage={wirtschaft.lage}
          />
        </div>
      )}

      {/* --- Dokumente --- */}
      <div className="titelzeile">
        <h2>Dokumente zum Haus</h2>
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
      <div className="abschnitt">
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
