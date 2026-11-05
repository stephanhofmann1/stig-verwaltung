import { Fragment } from "react";
import { redirect } from "next/navigation";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import {
  uebersicht,
  vorgaenge,
  mietAnzeige,
  zahlungsstand,
  type ZahlStatus,
} from "@/lib/mieter";
import { MieterMeldung } from "@/components/MieterMeldung";
import { dokumenteFuer, mieterBezug } from "@/lib/dokumente";

/** Beschriftung der Dokumentarten in der Sprache des Mieters. */
const ARTEN_TEXT: Record<string, string> = {
  grundriss: "Grundriss",
  foto: "Foto",
  mietvertrag: "Mietvertrag",
  uebergabeprotokoll: "Übergabeprotokoll",
  energieausweis: "Energieausweis",
  sonstige: "Dokument",
};

export const dynamic = "force-dynamic";
export const metadata = { title: "Mieterbereich" };

function euro(wert: string | null): string {
  if (!wert) return "—";
  return `${Number(wert).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

/**
 * Die Beschriftungen. Bewusst zurueckhaltend formuliert: Diese Zeilen liest
 * der Mieter, nicht die Verwaltung. "Offen" ist die einzige, die eine
 * Aufforderung enthaelt -- und sie erscheint nur, wenn der Monat faellig
 * ist UND Kontodaten vorliegen.
 */
const TEXT: Record<ZahlStatus, string> = {
  bezahlt: "eingegangen",
  teilweise: "teilweise eingegangen",
  offen: "noch nicht eingegangen",
  nicht_faellig: "noch nicht fällig",
  nicht_abgeglichen: "noch nicht abgeglichen",
};

const monatName = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(
    new Date(iso.slice(0, 10) + "T12:00:00Z"),
  );

/**
 * Die Dokumente, die der Mieter sehen darf.
 *
 * Geladen werden die seines Mietverhältnisses, seiner Einheit und seines
 * Objekts -- aber nur die mit gesetztem Haken. Was freigegeben ist,
 * entscheidet die Verwaltung beim Hochladen; hier wird es nur befolgt.
 */
async function freigegebeneDokumente(mietverhaeltnisId: string) {
  const bezug = await mieterBezug(mietverhaeltnisId);
  if (!bezug) return [];
  const alle = await dokumenteFuer({
    mietverhaeltnis_id: bezug.mietverhaeltnis,
    einheit_id: bezug.einheit,
    objekt_id: bezug.objekt,
  });
  return alle.filter((d) => d.mieter_sichtbar);
}

export default async function Mieterbereich() {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle !== "mieter" || !sitzung.mietverhaeltnis) {
    redirect("/mieter/anmelden");
  }

  const [daten, faelle, stand, dokumente] = await Promise.all([
    uebersicht(sitzung.mietverhaeltnis),
    vorgaenge(sitzung.mietverhaeltnis),
    zahlungsstand(sitzung.mietverhaeltnis),
    // Nur die ausdrücklich freigegebenen. Der Bezug kommt aus der
    // Datenbank, nicht aus der Anfrage -- und `mieter_sichtbar` ist bei
    // jedem Dokument von Haus aus aus. Ein Übergabeprotokoll des
    // Vormieters an derselben Wohnung fällt damit heraus.
    freigegebeneDokumente(sitzung.mietverhaeltnis),
  ]);

  if (!daten) redirect("/mieter/anmelden");

  // Inklusivmiete oder aufgeteilt? Die Entscheidung steckt in
  // lib/mieter.ts, damit sie ohne Datenbank prueffaehig ist.
  const miete = mietAnzeige(daten);

  return (
    // Schmale Spalte innerhalb des Rahmens. Fuer genau diesen Fall fehlt im
    // Stylesheet eine Klasse (etwa .schmal) -- bis es sie gibt, bleibt die
    // Breite als einziger Inline-Stil dieser Seite stehen.
    <div style={{ maxWidth: "40rem", margin: "2rem auto 0" }}>
      <h1>Hallo {daten.anzeigename}</h1>
      <p className="hinweis">
        {daten.objekt} · {daten.einheit}
        {daten.etage ? ` · ${daten.etage}` : ""}
      </p>

      <section className="abschnitt">
        <h2>Ihr Mietverhältnis</h2>
        <dl className="datenblatt">
          <dt className="hinweis">Anschrift</dt>
          <dd>
            {daten.strasse}, {daten.plz} {daten.ort}
          </dd>
          <dt className="hinweis">Seit</dt>
          <dd>{new Date(daten.beginn).toLocaleDateString("de-DE")}</dd>
          {miete.inklusiv ? (
            <>
              <dt className="hinweis">Miete</dt>
              <dd>
                {euro(String(miete.summe))}
                <span className="hinweis"> · alles inklusive</span>
              </dd>
            </>
          ) : (
            <>
              {miete.posten.map((p) => (
                <Fragment key={p.bezeichnung}>
                  <dt className="hinweis">{p.bezeichnung}</dt>
                  <dd>{euro(String(p.betrag))}</dd>
                </Fragment>
              ))}
              {miete.posten.length > 1 && (
                <>
                  <dt className="hinweis">Zusammen</dt>
                  <dd>
                    <strong>
                      {euro(miete.summe === null ? null : String(miete.summe))}
                    </strong>
                  </dd>
                </>
              )}
            </>
          )}
        </dl>
        <p className="hinweis">
          Fällig bis zum dritten Werktag des Monats.
        </p>
      </section>

      {stand.length > 0 && (
        <section className="abschnitt">
          <h2>Ihre Mietzahlungen</h2>
          {/* Monat und Stand sind zwei Spalten derselben Zeile. Als Tabelle
              bringt das Stylesheet Haarlinien, Zebrastreifen und fluchtende
              Ziffern mit -- vorher stand beides als Inline-Stil im Markup.
              Der Stand bleibt linksbündig: .betrag wäre richtig für eine
              Zahl, setzt aber white-space: nowrap, und "teilweise
              eingegangen (120,00 € von 580,00 €)" passt dann auf kein
              Telefon. */}
          <table>
            <tbody>
              {stand.map((m) => (
                <tr key={m.monat}>
                  <td>{monatName(m.monat)}</td>
                  <td className={m.status === "offen" ? undefined : "hinweis"}>
                    {TEXT[m.status]}
                    {m.status === "bezahlt" && m.gezahlt_am
                      ? ` am ${new Date(m.gezahlt_am).toLocaleDateString("de-DE")}`
                      : ""}
                    {m.status === "teilweise"
                      ? ` (${euro(String(m.gezahlt))} von ${euro(String(m.soll))})`
                      : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hinweis">
            „Noch nicht abgeglichen" heißt, dass uns für diesen Monat noch
            keine Kontoauszüge vorliegen — nicht, dass etwas offen ist.
          </p>
        </section>
      )}

      <section className="abschnitt">
        <h2>Ihre Unterlagen</h2>
        <ul>
          <li>
            <a href="/mieter/dokument/mietvertrag">Mietvertrag (PDF)</a>
          </li>
          <li>
            <a href="/mieter/dokument/wohnungsgeberbestaetigung">
              Wohnungsgeberbestätigung (PDF)
            </a>
          </li>
        </ul>
        <p className="hinweis">
          Die Wohnungsgeberbestätigung brauchen Sie für die Anmeldung beim
          Einwohnermeldeamt. Lässt sich ein Dokument nicht öffnen, fehlt in
          Ihren Daten noch eine Angabe — melden Sie sich dann bei uns.
        </p>
      </section>

      {dokumente.length > 0 && (
        <section className="abschnitt">
          <h2>Zu Ihrer Wohnung</h2>
          <table>
            <tbody>
              {dokumente.map((d) => (
                <tr key={d.id}>
                  <td>
                    <a href={`/api/dokumente/${d.id}`} target="_blank" rel="noreferrer">
                      {d.bezeichnung ?? d.dateiname}
                    </a>
                  </td>
                  <td className="hinweis">{ARTEN_TEXT[d.art] ?? d.art}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="abschnitt">
        <h2>Etwas melden</h2>
        <MieterMeldung />
      </section>

      <section className="abschnitt">
        <h2>Ihre Meldungen</h2>
        {faelle.length === 0 ? (
          <p className="hinweis">Noch nichts offen.</p>
        ) : (
          <table>
            <tbody>
              {faelle.map((f) => (
                <tr key={f.referenz}>
                  <td>{f.betreff}</td>
                  <td className="zeit">
                    {f.status === "erledigt"
                      ? "erledigt"
                      : f.status === "wartet"
                        ? "Antwort unterwegs"
                        : "offen"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
