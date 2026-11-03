import { query } from "@/lib/db";
import { mahnstand } from "@/lib/rueckstaende";
import { mahnbereitschaft } from "@/lib/mahnfreigabe";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import type { Rueckstand, Stufe } from "@/lib/mahnstufen";
import {
  alsTag,
  darfEntscheiden,
  darfEntwerfen,
  entscheidungen as leseEntscheidungen,
  entscheidungsVerlauf,
  letzteEntscheidungen,
  offenePunkte,
  plusTage,
  teileAuf,
  type Entscheidung,
} from "@/lib/mahnablauf";
import { MahnAblauf } from "@/components/MahnAblauf";
import { MahnFreigabeSchalter } from "@/components/MahnFreigabeSchalter";
import { MahnZeile, type ZeileDaten } from "@/components/MahnZeile";

export const dynamic = "force-dynamic";

/**
 * Das Mahnwesen: der Ablauf, die Freigabe, die Entscheidungen.
 *
 * Diese Seite verschickt nichts. Sie zeigt, was die nächtlichen Läufe
 * gefunden haben, begründet jede Stufe im Wortlaut aus lib/mahnstufen.ts --
 * die Begründung ist die Entscheidungsgrundlage -- und stellt je Rückstand
 * die Wahl: entwerfen, verschieben, nicht mahnen. Entwerfen legt einen
 * Entwurf in die Freigabe; versendet wird dort, von einem Menschen.
 *
 * Die wichtigste Zahl steht nicht in der Forderung: Beträge aus Monaten,
 * für die es keine Kontoauszüge gibt. Die zählen absichtlich nicht als
 * Rückstand. Ein übernommenes Haus wird oft ab einem Monat abgerechnet, für
 * den es noch kein eigenes Konto gab -- würde man beides addieren, hätte
 * jeder langjährige Mieter dort rund ein Jahr Rückstand und damit einen
 * Kündigungsgrund nach § 543 Abs. 2 Nr. 3 BGB. Wo es überhaupt kein Konto
 * gibt, wird deshalb überhaupt nicht gemahnt.
 *
 * Welches Objekt das jeweils ist und ab wann seine Kontodaten reichen, sagt
 * `objekt.zahlungsdaten_ab`. Der Name steht nicht im Quelltext: Die Seite
 * soll auch dem nächsten Vermieter seinen eigenen Bestand zeigen.
 */

const euro = (w: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(w);

const monatDe = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" })
    .format(new Date(iso + "T12:00:00Z"));

const tagDe = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));

const datumDe = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
  }).format(new Date(iso.slice(0, 10) + "T12:00:00Z"));

/** Ein Objekt und die Reichweite seiner Kontodaten. */
interface Deckung {
  name: string;
  zahlungsdaten_ab: string | null;
}

/**
 * Ab wann die Kontodaten je Objekt reichen -- in Worten.
 *
 * Die Grenze entscheidet darüber, welche Monate überhaupt gemahnt werden
 * dürfen. Sie hier zu nennen ist der Unterschied zwischen "irgendwo fehlen
 * Auszüge" und "in diesem Haus fehlen sie bis zu diesem Tag" -- nur das
 * zweite sagt, wo nachzusehen ist.
 */
const deckungssatz = (d: Deckung) =>
  d.zahlungsdaten_ab === null
    ? `${d.name}: kein eigenes Konto, hier wird nicht gemahnt`
    : `${d.name}: Kontodaten ab ${datumDe(d.zahlungsdaten_ab)}`;

const BESCHRIFTUNG: Record<Stufe, string> = {
  mahnung: "Mahnung fällig",
  erinnerung: "Erinnerung fällig",
  faellig: "beobachten",
  ok: "noch nicht fällig",
};

const ENTSCHEIDUNG_TEXT: Record<Entscheidung["art"], string> = {
  verschoben: "verschoben",
  ausgesetzt: "nicht mahnen",
  entworfen: "Entwurf angelegt",
  wieder_vorgelegt: "wieder vorgelegt",
};

/** Die Daten, die eine Zeile für die Anzeige braucht. */
function alsZeile(r: Rueckstand): ZeileDaten {
  return {
    mietverhaeltnis_id: r.mietverhaeltnis_id,
    kontakt_name: r.kontakt_name,
    einheit: r.einheit,
    offen: r.offen,
    monat: r.aeltester_monat,
    tage_ueberfaellig: r.tage_ueberfaellig,
    stufe: r.stufe,
    stufe_text: BESCHRIFTUNG[r.stufe],
    begruendung: r.begruendung,
    offen_ohne_daten: r.offen_ohne_daten,
    monate_ohne_daten: r.monate_ohne_daten.length,
  };
}

export default async function Mahnwesen() {
  const heute = new Date();
  const sitzung = await angemeldeteSitzung();
  const rolle = sitzung?.rolle ?? null;

  const [stand, bereitschaft, alleEntscheidungen, verlauf, deckung] =
    await Promise.all([
      mahnstand(heute),
      mahnbereitschaft(),
      leseEntscheidungen(),
      entscheidungsVerlauf(25),
      // Nur für den erläuternden Satz weiter unten. Scheitert die Abfrage,
      // fehlt eine Aufzählung -- die Rückstände selbst stehen trotzdem da,
      // und die sind der Grund, warum jemand diese Seite aufmacht.
      query<Deckung>(
        `SELECT name, zahlungsdaten_ab::text
           FROM objekt
          ORDER BY name`,
      ).catch(() => [] as Deckung[]),
    ]);

  const letzte = letzteEntscheidungen(alleEntscheidungen);
  const aufteilung = teileAuf(stand, letzte, heute);
  const gesperrt = bereitschaft.freigabe === null;
  const entscheiden = darfEntscheiden(rolle);

  // Welche Punkte den Freigabeknopf sperren. Die Notiz entsteht erst im
  // Browser; geprüft wird sie dort und noch einmal in der Route.
  const fehlt = offenePunkte(bereitschaft.befunde);

  const summe = aufteilung.vorschlaege.reduce((s, r) => s + r.offen, 0);
  const ungeklaert = stand.filter((r) => r.offen_ohne_daten >= 1);
  const vorschlagBis = plusTage(heute, 14);

  return (
    <main>
      <div className="titelzeile">
        <h1>Mahnwesen</h1>
        <span className="zaehler">
          {stand.length === 0
            ? "keine Rückstände"
            : `${aufteilung.vorschlaege.length} zu entscheiden, ` +
              `${stand.length} Rückstände insgesamt`}
        </span>
      </div>

      <MahnAblauf />

      <MahnFreigabeSchalter
        freigabe={bereitschaft.freigabe}
        fehlt={fehlt}
        darfEntscheiden={entscheiden.erlaubt}
        grundWennNicht={entscheiden.grund}
      />

      <h2>Bereit für die Freigabe?</h2>
      <p className="hinweis">
        Jeder Punkt hier ist ein Weg, auf dem ein pünktlicher Zahler als
        Säumiger erscheint. Solange einer offen ist, bleibt der Knopf oben
        gesperrt.
      </p>
      <table>
        <tbody>
          {bereitschaft.befunde.map((b) => (
            <tr key={b.punkt}>
              <td>
                <span className="punkt" data-art={b.erfuellt ? "gut" : "warn"} />
                <strong>{b.punkt}</strong>
                <div className="hinweis">{b.erklaerung}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Was auf dich wartet</h2>
      {aufteilung.vorschlaege.length === 0 ? (
        <div className="leer">
          <strong>Nichts zu entscheiden</strong>
          Entweder ist nichts über der Schwelle, oder alles Offene ist
          verschoben beziehungsweise bewusst ausgesetzt. Die Schwelle ist eine
          Monatsmiete; eine Zahlungserinnerung geht ab dem zehnten Tag, eine
          Mahnung ab dem dreißigsten.
        </div>
      ) : (
        <>
          <p className="hinweis">
            {aufteilung.vorschlaege.length} Schreiben wären fällig, zusammen{" "}
            <strong>{euro(summe)}</strong>.{" "}
            {gesperrt
              ? "Solange das Mahnwesen gesperrt ist, entsteht keines davon — " +
                "auch kein Entwurf."
              : "Jedes einzeln: entwerfen, verschieben oder nicht mahnen. " +
                "Der Entwurf geht danach in die Freigabe, versendet wird er " +
                "erst dort."}
          </p>
          {aufteilung.vorschlaege.map((r) => {
            const darf = darfEntwerfen({
              freigegeben: !gesperrt,
              rolle,
              stufe: r.stufe,
              zurueckgestellt: false,
            });
            return (
              <MahnZeile
                key={r.mietverhaeltnis_id}
                zeile={alsZeile(r)}
                entscheidung={letzte.get(r.mietverhaeltnis_id) ?? null}
                entwerfenErlaubt={darf.erlaubt}
                entwerfenGrund={darf.grund}
                darfEntscheiden={entscheiden.erlaubt}
                vorschlagBis={vorschlagBis}
                zurueckgestellt={false}
              />
            );
          })}
        </>
      )}

      {aufteilung.zurueckgestellt.length > 0 && (
        <>
          <h2>Zurückgestellt</h2>
          <p className="hinweis">
            Diese Fälle sind über der Schwelle, werden aber nicht
            vorgeschlagen — weil jemand das so entschieden hat. Sie
            verschwinden nicht, sie warten. Wieder vorlegen hebt die
            Entscheidung auf und hält auch das fest.
          </p>
          {aufteilung.zurueckgestellt.map(({ rueckstand, entscheidung }) => (
            <MahnZeile
              key={rueckstand.mietverhaeltnis_id}
              zeile={alsZeile(rueckstand)}
              entscheidung={entscheidung}
              entwerfenErlaubt={false}
              entwerfenGrund="Zurückgestellt — erst wieder vorlegen."
              darfEntscheiden={entscheiden.erlaubt}
              vorschlagBis={vorschlagBis}
              zurueckgestellt
            />
          ))}
        </>
      )}

      {aufteilung.nurBeobachten.length > 0 && (
        <>
          <h2>Sichtbar, aber ohne Schreiben</h2>
          <p className="hinweis">
            Hier ist etwas offen, aber nichts zu entscheiden: unter der
            Schwelle, noch nicht fällig, keine Monatsmiete hinterlegt oder
            keine Kontodaten für den Zeitraum. Die Begründung sagt, was
            jeweils gilt.
          </p>
          <div className="tabelle-rolle">
            <table>
              <thead>
                <tr>
                  <th>Mieter</th>
                  <th>Einheit</th>
                  <th>offen</th>
                  <th>seit</th>
                  <th>Stufe</th>
                  <th>ohne Kontodaten</th>
                </tr>
              </thead>
              <tbody>
                {aufteilung.nurBeobachten.map((r) => (
                  <tr key={r.mietverhaeltnis_id}>
                    <td>
                      <strong>{r.kontakt_name}</strong>
                      <div className="hinweis">{r.begruendung}</div>
                    </td>
                    <td>{r.einheit}</td>
                    <td className="betrag">
                      {r.offen > 0 ? euro(r.offen) : "—"}
                    </td>
                    <td>{r.offen > 0 ? monatDe(r.aeltester_monat) : "—"}</td>
                    <td>
                      <span className="schild">{BESCHRIFTUNG[r.stufe]}</span>
                    </td>
                    <td className="betrag">
                      {r.offen_ohne_daten >= 1
                        ? `${euro(r.offen_ohne_daten)} (${r.monate_ohne_daten.length} Mon.)`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {ungeklaert.length > 0 && (
        <div className="leer">
          <strong>Wofür es keine Kontoauszüge gibt, wird nicht gemahnt</strong>
          Bei {ungeklaert.length} Mietverhältnissen stehen Beträge aus Monaten
          offen, für die keine Kontoumsätze vorliegen — zusammen{" "}
          {euro(ungeklaert.reduce((s, r) => s + r.offen_ohne_daten, 0))}. Diese
          Monate sind nicht unbezahlt, sondern unbekannt. Sie zählen deshalb
          nicht in die Forderung und lösen keine Mahnung aus. Zu klären ist das
          über die Mietaufstellungen des Voreigentümers, nicht über ein
          Schreiben an den Mieter.
          {deckung.length > 0 && (
            // .erklaerung traegt den Abstand zum Absatz darueber; .hinweis
            // bleibt daneben stehen, damit der Satz grau bleibt, falls die
            // Klasse im Stylesheet noch nicht angekommen ist.
            <div className="hinweis erklaerung">
              So weit reichen die Kontodaten:{" "}
              {deckung.map(deckungssatz).join(" · ")}
            </div>
          )}
        </div>
      )}

      {verlauf.length > 0 && (
        <>
          <h2>Was entschieden wurde</h2>
          <p className="hinweis">
            Jede Entscheidung steht als Eintrag am Vorgang (Ereignis und
            Einzelheiten im Protokoll) und ist dort dauerhaft lesbar — mit dem
            Stand, über den damals entschieden wurde.
          </p>
          <div className="tabelle-rolle">
            <table>
              <thead>
                <tr>
                  <th>Wann</th>
                  <th>Was</th>
                  <th>Grund</th>
                  <th>Wer</th>
                  <th>Vorgang</th>
                </tr>
              </thead>
              <tbody>
                {verlauf.map((e, i) => (
                  <tr key={`${e.zeitpunkt}-${i}`}>
                    <td>{tagDe(e.zeitpunkt)}</td>
                    <td>
                      {ENTSCHEIDUNG_TEXT[e.art]}
                      {e.art === "verschoben" && e.bis
                        ? ` bis ${e.bis}`
                        : ""}
                    </td>
                    <td>{e.grund}</td>
                    <td>{e.wer}</td>
                    <td>
                      {e.vorgang_id ? (
                        <a href={`/vorgang/${e.vorgang_id}`} className="ziffern">
                          {String(e.vorgang_nummer ?? "").padStart(4, "0")}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Nur zur Einordnung: Der Stand ist auf diesen Tag gerechnet. */}
      <p className="hinweis">Stand: {alsTag(heute)}.</p>
    </main>
  );
}
