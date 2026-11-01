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

export default async function Mieterbereich() {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle !== "mieter" || !sitzung.mietverhaeltnis) {
    redirect("/mieter/anmelden");
  }

  const [daten, faelle, stand] = await Promise.all([
    uebersicht(sitzung.mietverhaeltnis),
    vorgaenge(sitzung.mietverhaeltnis),
    zahlungsstand(sitzung.mietverhaeltnis),
  ]);

  if (!daten) redirect("/mieter/anmelden");

  // Inklusivmiete oder aufgeteilt? Die Entscheidung steckt in
  // lib/mieter.ts, damit sie ohne Datenbank prueffaehig ist.
  const miete = mietAnzeige(daten);

  return (
    <div style={{ maxWidth: "40rem", margin: "2rem auto 0" }}>
      <h1
        style={{
          fontSize: "1.5rem",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          margin: "0 0 0.25rem",
        }}
      >
        Hallo {daten.anzeigename}
      </h1>
      <p className="hinweis" style={{ marginBottom: "2rem" }}>
        {daten.objekt} · {daten.einheit}
        {daten.etage ? ` · ${daten.etage}` : ""}
      </p>

      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 0.75rem" }}>
          Ihr Mietverhältnis
        </h2>
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "0.4rem 1.5rem",
            margin: 0,
          }}
        >
          <dt className="hinweis">Anschrift</dt>
          <dd style={{ margin: 0 }}>
            {daten.strasse}, {daten.plz} {daten.ort}
          </dd>
          <dt className="hinweis">Seit</dt>
          <dd style={{ margin: 0 }}>
            {new Date(daten.beginn).toLocaleDateString("de-DE")}
          </dd>
          {miete.inklusiv ? (
            <>
              <dt className="hinweis">Miete</dt>
              <dd style={{ margin: 0 }}>
                {euro(String(miete.summe))}
                <span className="hinweis"> · alles inklusive</span>
              </dd>
            </>
          ) : (
            <>
              {miete.posten.map((p) => (
                <Fragment key={p.bezeichnung}>
                  <dt className="hinweis">{p.bezeichnung}</dt>
                  <dd style={{ margin: 0 }}>{euro(String(p.betrag))}</dd>
                </Fragment>
              ))}
              {miete.posten.length > 1 && (
                <>
                  <dt className="hinweis">Zusammen</dt>
                  <dd style={{ margin: 0, fontWeight: 600 }}>
                    {euro(miete.summe === null ? null : String(miete.summe))}
                  </dd>
                </>
              )}
            </>
          )}
        </dl>
        <p className="hinweis" style={{ marginTop: "0.9rem" }}>
          Fällig bis zum dritten Werktag des Monats.
        </p>
      </section>

      {stand.length > 0 && (
        <section style={{ marginBottom: "2.5rem" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 0.75rem" }}>
            Ihre Mietzahlungen
          </h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {stand.map((m) => (
              <li
                key={m.monat}
                style={{
                  padding: "0.55rem 0",
                  borderTop: "1px solid var(--linie, #e5e5e5)",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "1rem",
                }}
              >
                <span>{monatName(m.monat)}</span>
                <span
                  className={m.status === "offen" ? undefined : "hinweis"}
                  style={{ textAlign: "right" }}
                >
                  {TEXT[m.status]}
                  {m.status === "bezahlt" && m.gezahlt_am
                    ? ` am ${new Date(m.gezahlt_am).toLocaleDateString("de-DE")}`
                    : ""}
                  {m.status === "teilweise"
                    ? ` (${euro(String(m.gezahlt))} von ${euro(String(m.soll))})`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
          <p className="hinweis" style={{ marginTop: "0.6rem" }}>
            „Noch nicht abgeglichen" heißt, dass uns für diesen Monat noch
            keine Kontoauszüge vorliegen — nicht, dass etwas offen ist.
          </p>
        </section>
      )}

      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 0.75rem" }}>
          Ihre Unterlagen
        </h2>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          <li style={{ padding: "0.35rem 0" }}>
            <a href="/mieter/dokument/mietvertrag">Mietvertrag (PDF)</a>
          </li>
          <li style={{ padding: "0.35rem 0" }}>
            <a href="/mieter/dokument/wohnungsgeberbestaetigung">
              Wohnungsgeberbestätigung (PDF)
            </a>
          </li>
        </ul>
        <p className="hinweis" style={{ marginTop: "0.6rem" }}>
          Die Wohnungsgeberbestätigung brauchen Sie für die Anmeldung beim
          Einwohnermeldeamt. Lässt sich ein Dokument nicht öffnen, fehlt in
          Ihren Daten noch eine Angabe — melden Sie sich dann bei uns.
        </p>
      </section>

      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 0.75rem" }}>
          Etwas melden
        </h2>
        <MieterMeldung />
      </section>

      <section>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 0.75rem" }}>
          Ihre Meldungen
        </h2>
        {faelle.length === 0 ? (
          <p className="hinweis">Noch nichts offen.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {faelle.map((f) => (
              <li
                key={f.referenz}
                style={{
                  padding: "0.6rem 0",
                  borderTop: "1px solid var(--linie, #e5e5e5)",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "1rem",
                }}
              >
                <span>{f.betreff}</span>
                <span className="hinweis" style={{ whiteSpace: "nowrap" }}>
                  {f.status === "erledigt"
                    ? "erledigt"
                    : f.status === "wartet"
                      ? "Antwort unterwegs"
                      : "offen"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
