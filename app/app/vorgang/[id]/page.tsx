import Link from "next/link";
import { notFound } from "next/navigation";
import { one, query } from "@/lib/db";
import { KATEGORIE_LABEL, STATUS_LABEL } from "@/lib/typen";
import type { Kategorie, VorgangStatus } from "@/lib/typen";
import { aktenzeichen, tag, zeitpunkt } from "@/lib/formate";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { teileAkte } from "@/lib/vorgangstatus";
import { EntwurfKarte } from "@/components/EntwurfKarte";
import { VorgangSchalter } from "@/components/VorgangSchalter";
import { Anhaenge } from "@/components/Anhaenge";

export const dynamic = "force-dynamic";

/**
 * Eine Vorgangsakte -- und seit dieser Fassung auch die Stelle, an der sie
 * geschlossen werden kann.
 *
 * Vorher lud die Seite v.frist, zeigte sie nicht an, und bot unten eine
 * einzige Handlung: zurueck zur Uebersicht. Erledigt, wartet, eine falsche
 * Kategorie oder eine falsche Heikel-Markierung waren nur ueber die
 * Datenbank zu aendern. Drei Dinge kommen deshalb hinzu:
 *
 *   - Die Frist steht im Aktenkopf. Sie war schon da, sie war nur nicht zu
 *     sehen -- und eine Frist, die niemand sieht, ist keine.
 *   - Der leere Verlauf bekommt einen Leerzustand. Ein leeres <div> sah
 *     nach einem Ladefehler aus.
 *   - Unter der Akte stehen die Schalter und darunter das Protokoll der
 *     Entscheidungen. Das Protokoll gehoert hierher und nicht in eine
 *     Verwaltungsansicht: Wer die Sperre aufgehoben hat und warum, ist eine
 *     Frage an die Akte.
 */

interface Kopf {
  id: string;
  nummer: number;
  betreff: string;
  kategorie: Kategorie;
  status: VorgangStatus;
  heikel: boolean;
  frist: string | null;
  kontakt_name: string | null;
}

interface Eintrag {
  id: string;
  richtung: "ein" | "aus";
  status: string;
  kanal: string;
  von_email: string;
  von_name: string | null;
  an_emails: string[];
  betreff: string;
  koerper_text: string;
  verfasst_von: "agent" | "mensch" | null;
  agent_notiz: string | null;
  empfangen_am: string | null;
  gesendet_am: string | null;
  angelegt_am: string;
}

/** Eine Zeile des Entscheidungsprotokolls. */
interface ProtokollZeile {
  ereignis: string;
  details: {
    vorher?: unknown;
    nachher?: unknown;
    wer?: string;
    begruendung?: string | null;
  } | null;
  zeitpunkt: string;
}

/** Nur die drei Ereignisse, die von dieser Seite aus entstehen. */
/*
  Welche Protokollereignisse in der Akte erscheinen.

  Die Liste ist eine Auswahl und keine Vollstaendigkeit -- geschrieben
  wird mehr, als hier steht. Sie hat aber eine Tuecke: Ein neues Ereignis
  erscheint NICHT von selbst. Es wird geschrieben, ist im Protokoll
  vorhanden, und in der Akte fehlt es trotzdem. Wer eine Zeile vermisst,
  sucht dann an der falschen Stelle -- naemlich beim Schreiben.

  Deshalb stehen hier auch die beiden Ereignisse aus db/031: Dass jemand
  einen Vorgang ohne Antwort geschlossen hat, und dass ein Entwurf auf
  Anweisung neu erzeugt wurde. Beides sind Entscheidungen eines Menschen
  ueber eine Korrespondenz, und beide will man im Streitfall nachlesen.
*/
const PROTOKOLL_EREIGNISSE = [
  "vorgang_status_geaendert",
  "vorgang_kategorie_geaendert",
  "vorgang_heikel_geaendert",
  "vorgang_ohne_antwort_geschlossen",
  "entwurf_neu_erzeugt",
];

const EREIGNIS_TEXT: Record<string, string> = {
  vorgang_status_geaendert: "Status geändert",
  vorgang_kategorie_geaendert: "Kategorie geändert",
  vorgang_heikel_geaendert: "Sperre für die Automatik geändert",
  vorgang_ohne_antwort_geschlossen: "Ohne Antwort geschlossen",
  entwurf_neu_erzeugt: "Entwurf auf Anweisung neu erzeugt",
};

/**
 * Wie ein Vorher/Nachher-Wert im Protokoll lesbar wird.
 *
 * Die Datenbank speichert "behoerde" und true/false. Auf der Seite soll
 * "Behörde" und "heikel"/"nicht heikel" stehen -- die Protokollzeile wird
 * im Streitfall gelesen, nicht ausgewertet.
 */
function lesbar(wert: unknown): string {
  if (wert === true) return "heikel";
  if (wert === false) return "nicht heikel";
  if (typeof wert === "string") {
    return (
      STATUS_LABEL[wert as VorgangStatus] ??
      KATEGORIE_LABEL[wert as Kategorie] ??
      wert
    );
  }
  return String(wert ?? "—");
}

/** Wie dringend ist die Frist? Entscheidet nur über die Auszeichnung. */
function fristLage(frist: string, heute: string): { text: string; heikel: boolean } {
  const tage = Math.round(
    (new Date(frist + "T12:00:00Z").getTime() -
      new Date(heute + "T12:00:00Z").getTime()) /
      86_400_000,
  );
  if (tage < 0) return { text: `Frist ${tag(frist)} — überschritten`, heikel: true };
  if (tage === 0) return { text: `Frist ${tag(frist)} — heute`, heikel: true };
  if (tage <= 14) return { text: `Frist ${tag(frist)} — in ${tage} Tagen`, heikel: true };
  return { text: `Frist ${tag(frist)}`, heikel: false };
}

export default async function Vorgangsakte({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sitzung = await angemeldeteSitzung();
  const darfSchreiben = sitzung?.rolle === "verwalter";

  const kopf = await one<Kopf>(
    `SELECT v.id, v.nummer, v.betreff, v.kategorie, v.status, v.heikel,
            v.frist::text, k.anzeigename AS kontakt_name
       FROM vorgang v
       LEFT JOIN kontakt k ON k.id = v.kontakt_id
      WHERE v.id = $1`,
    [id],
  );
  if (!kopf) notFound();

  const [eintraege, protokoll] = await Promise.all([
    query<Eintrag>(
      `SELECT id, richtung, status, kanal, von_email, von_name, an_emails,
              betreff, koerper_text, verfasst_von, agent_notiz,
              empfangen_am, gesendet_am, angelegt_am
         FROM nachricht
        WHERE vorgang_id = $1 AND status <> 'verworfen'
        ORDER BY angelegt_am ASC`,
      [id],
    ),
    query<ProtokollZeile>(
      `SELECT ereignis, details, zeitpunkt::text
         FROM protokoll
        WHERE vorgang_id = $1 AND ereignis = ANY($2::text[])
        ORDER BY zeitpunkt DESC
        LIMIT 50`,
      [id, PROTOKOLL_EREIGNISSE],
    ),
  ]);

  // Entwuerfe und Verlauf getrennt: siehe die Begruendung unten am
  // Abschnitt "Zu entscheiden". Die Teilung selbst steht in
  // lib/vorgangstatus.ts, weil sie dort pruefbar ist -- sie muss
  // halten, dass keine Nachricht verschwindet und keine doppelt steht.
  const { entwuerfe, verlauf } = teileAkte(eintraege);

  const heute = new Date().toISOString().slice(0, 10);
  const frist = kopf.frist ? fristLage(kopf.frist, heute) : null;

  return (
    <>
      <div className="akte-kopf">
        <span className="aktenzeichen ziffern">{aktenzeichen(kopf.nummer)}</span>
        <div>
          <h1>{kopf.betreff}</h1>
          <div className="akte-meta">
            <span>{kopf.kontakt_name ?? "Unbekannter Absender"}</span>
            <span>{KATEGORIE_LABEL[kopf.kategorie]}</span>
            <span>{STATUS_LABEL[kopf.status]}</span>
            {/* Die Frist stand bisher nur in der Abfrage. */}
            {frist &&
              (frist.heikel ? (
                <span className="marker" data-art="heikel">
                  {frist.text}
                </span>
              ) : (
                <span className="ziffern">{frist.text}</span>
              ))}
            {kopf.heikel && (
              <span className="marker" data-art="heikel">
                heikel — nicht automatisch beantworten
              </span>
            )}
          </div>
        </div>
      </div>

      {/*
        DER ENTWURF STEHT OBEN (07.11.2026)

        Vorher lief er in der Zeitleiste mit, also hinter dem ganzen
        Verlauf. Chronologisch ist das richtig -- ein Entwurf ist das
        jüngste Stück der Akte -- und in der Benutzung falsch: Wer die
        Akte öffnet, will antworten, und musste erst an allen alten
        Nachrichten vorbeiscrollen, um das Feld überhaupt zu finden.

        Der Verlauf ist Zusammenhang, der Entwurf ist die Entscheidung.
        Die Entscheidung kommt zuerst; die Chronologie des Verlaufs
        bleibt darunter unangetastet.
      */}
      {entwuerfe.length > 0 && (
        <section className="abschnitt">
          <div className="titelzeile">
            <h2>Zu entscheiden</h2>
            <span className="zaehler ziffern">{entwuerfe.length}</span>
          </div>
          {entwuerfe.map((e) => (
            <EntwurfKarte
              key={e.id}
              id={e.id}
              betreff={e.betreff}
              koerper={e.koerper_text}
              empfaenger={e.an_emails}
              verfasstVon={e.verfasst_von}
              notiz={e.agent_notiz}
            />
          ))}
        </section>
      )}

      {eintraege.length === 0 ? (
        // Vorher stand hier ein leeres <div className="verlauf"> -- ein
        // weisser Fleck, der wie ein Ladefehler aussieht. Einen Vorgang
        // ohne Nachricht gibt es wirklich: von Hand angelegt, oder die
        // einzige Nachricht wurde verworfen.
        <div className="leer">
          <strong>Noch keine Nachricht in dieser Akte</strong>
          Der Vorgang steht, es ist nur nichts ein- oder ausgegangen —
          entweder von Hand angelegt, oder der einzige Entwurf wurde
          verworfen. Antworten entstehen über die Freigabe, nicht hier.
        </div>
      ) : (
        <div className="verlauf">
          {verlauf.length > 0 && entwuerfe.length > 0 && (
            <div className="titelzeile">
              <h2>Verlauf</h2>
              <span className="zaehler ziffern">{verlauf.length}</span>
            </div>
          )}
          {verlauf.map((e) => (
            <article key={e.id} className="eintrag" data-richtung={e.richtung}>
                <div className="eintrag-kopf">
                  <span className="absender">
                    {e.richtung === "ein"
                      ? (e.von_name ?? e.von_email)
                      : "STIG Verwaltung"}
                  </span>
                  <span className="zeit">
                    {zeitpunkt(e.gesendet_am ?? e.empfangen_am ?? e.angelegt_am)}
                  </span>
                  {e.kanal === "whatsapp" && (
                    <span className="marker" data-art="whatsapp">
                      WhatsApp
                    </span>
                  )}
                  {e.richtung === "aus" && e.verfasst_von === "agent" && (
                    <span className="marker" data-art="agent">
                      vorgeschrieben
                    </span>
                  )}
                </div>
                <p className="eintrag-text">{e.koerper_text}</p>
                {/* Nur lesen: Was empfangen oder gesendet wurde, bleibt in
                    der Akte so stehen. Die Route weist das Entfernen auch
                    ab -- hier steht erst gar kein Knopf. */}
              <Anhaenge nachrichtId={e.id} aenderbar={false} />
            </article>
          ))}
        </div>
      )}

      {darfSchreiben ? (
        <VorgangSchalter
          id={kopf.id}
          status={kopf.status}
          kategorie={kopf.kategorie}
          heikel={kopf.heikel}
        />
      ) : (
        <p className="hinweis" style={{ marginTop: "2rem" }}>
          Dieser Zugang darf die Akte lesen. Status, Kategorie und die Sperre
          für die Automatik ändert die Verwaltung.
        </p>
      )}

      {/* --- Entscheidungen ------------------------------------------- */}
      {protokoll.length > 0 && (
        <section className="abschnitt">
          <div className="titelzeile">
            <h2 style={{ fontSize: "1rem" }}>Entscheidungen zu dieser Akte</h2>
            <span className="zaehler ziffern">{protokoll.length}</span>
          </div>
          <div className="register">
            {protokoll.map((z, i) => (
              // Ein Protokolleintrag hat keine eigene Seite -- stumm statt
              // scheinbar klickbar, wie die Mietzeitleiste.
              <div className="posten" data-still="ja" key={i}>
                <span className="nummer ziffern">
                  {z.zeitpunkt.slice(2, 10)}
                </span>
                <span className="betreff">
                  {EREIGNIS_TEXT[z.ereignis] ?? z.ereignis}
                </span>
                <span className="zeit">{zeitpunkt(z.zeitpunkt)}</span>
                <span className="unterzeile">
                  <span>
                    {lesbar(z.details?.vorher)} → {lesbar(z.details?.nachher)}
                  </span>
                  <span>{z.details?.wer ?? "unbekannt"}</span>
                  {z.details?.begruendung && (
                    <span>{z.details.begruendung}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
          <p className="erklaerung">
            Jede Änderung an Status, Kategorie und „heikel“ steht hier mit
            Vorher, Nachher und Namen. Was der Agent und der Versand
            vermerken, steht im Protokoll derselben Tabelle und ist hier
            bewusst nicht gemischt — diese Liste beantwortet eine Frage: Wer
            hat an dieser Akte etwas entschieden.
          </p>
        </section>
      )}

      <div className="knopfreihe" style={{ marginTop: "2rem" }}>
        <Link href="/vorgaenge" className="verweis">
          Zurück zur Übersicht
        </Link>
      </div>
    </>
  );
}
