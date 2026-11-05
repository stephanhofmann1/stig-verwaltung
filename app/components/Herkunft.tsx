import { KATEGORIE_LABEL, type Kategorie } from "@/lib/typen";
// Nur der Typ: lib/weisungen.ts zieht ueber lib/db.ts den Postgres-Treiber
// mit, und diese Datei wird auch in einer Client-Komponente gerendert
// (EntwurfKarte). `import type` wird beim Uebersetzen restlos entfernt.
import type { Ebene } from "@/lib/weisungen";

/**
 * Worauf ein Vorgang und ein Entwurf beruhen.
 *
 * DIE FRAGE, DIE DIESE DATEI BEANTWORTET
 *
 * Der Eigentuemer hat sie woertlich gestellt: "die Antworten oder Faelle,
 * die sich erstellen, auf welcher Basis erstellen die sich?" Bis zum
 * 03.11.2026 stand das nirgends. Die Einordnung ist Mustererkennung ueber
 * Stichwortregexe, und vom Treffer wurde nur der Wahrheitswert genommen --
 * welches Wort entschieden hat, war hinterher nicht mehr feststellbar.
 *
 * Drei Angaben stehen hier, und die dritte ist die wichtigste:
 *
 *   1. Welche Kategorie, durch welches Stichwort, an welcher Fundstelle.
 *   2. Ob der Entwurf aus einem Textbaustein oder aus dem Sprachmodell
 *      kommt, und bei Letzterem aus welchem Modell.
 *   3. Wenn KEIN Entwurf entstand: warum nicht.
 *
 * Nummer 3 war der Schaden vom 03.11.2026. Eine Mail des
 * Messdienstleisters lag als Behoerdenpost in der Akte, weil sie "Geben
 * Sie mir Bescheid" enthielt; sie war dadurch heikel, der Agent durfte
 * dort nichts vorschreiben, und auf der Oberflaeche stand nichts. Die
 * Automatik hoerte still auf zu arbeiten.
 *
 * ZWEI ENTSCHEIDUNGEN ZUR DARSTELLUNG
 *
 *   - Der Grund, warum kein Entwurf entstand, steht NICHT im
 *     aufklappbaren Teil. Er ist eine Meldung und immer sichtbar. Eine
 *     Begruendung, die man erst aufklappen muss, ist dasselbe Schweigen
 *     mit einem Klick davor.
 *   - Alles uebrige steht in einem <details>. Die Herkunft wird gelesen,
 *     wenn etwas schiefging, nicht bei jeder Mail -- und eine Karte, auf
 *     der zehn Zeilen Technik ueber dem Mailtext stehen, liest niemand.
 */

export interface HerkunftDaten {
  kategorie: Kategorie | string;
  heikel: boolean;
  einordnung_quelle: string | null;
  einordnung_stichwort: string | null;
  einordnung_fundstelle: string | null;
  kein_entwurf_code: string | null;
  kein_entwurf_grund: string | null;
  entwurf_quelle: string | null;
  entwurf_modell: string | null;
  entwurf_fassung_nr: number | null;
  ohne_antwort_grund: string | null;
}

/** Eine Weisung, wie sie angezeigt wird. */
export interface WeisungAnzeige {
  id: string;
  ebene: Ebene;
  weisungstext: string;
  vorrang?: number;
}

export interface UebergangenAnzeige {
  id: string;
  ebene: Ebene;
  weisungstext: string;
  grund: string;
}

/**
 * Die Beschriftung der drei Ebenen.
 *
 * Bewusst mit `Record<Ebene, string>` annotiert und nicht aus
 * lib/weisungen.ts importiert -- siehe Kommentar am Import oben. Die
 * Annotation ist der Schutz gegen Auseinanderlaufen: Kommt in
 * lib/weisungen.ts eine vierte Ebene dazu, laesst TypeScript diese Datei
 * nicht mehr uebersetzen, bis sie hier auch steht.
 */
const EBENE_LABEL: Record<Ebene, string> = {
  allgemein: "Für alles",
  kategorie: "Je Kategorie",
  kontakt: "Je Kontakt",
};

/** Wie die Kategorie zustande kam, in einem Satz. */
export function einordnungSatz(d: HerkunftDaten): string {
  const kat =
    KATEGORIE_LABEL[d.kategorie as Kategorie] ?? String(d.kategorie);
  switch (d.einordnung_quelle) {
    case "regel":
      return d.einordnung_stichwort
        ? `„${kat}“, weil das Stichwort „${d.einordnung_stichwort}“ getroffen hat.`
        : `„${kat}“ durch ein Stichwortmuster.`;
    case "kontakt":
      return `„${kat}“, weil der Absender als Kontakt mit dieser Rolle bekannt ist. Kein Stichwort hat entschieden.`;
    case "mensch":
      return `„${kat}“ — von Hand berichtigt, nicht von der Automatik.`;
    case "keine":
      return `„${kat}“, weil kein Stichwort getroffen hat und der Absender unbekannt war.`;
    default:
      // Vorgaenge aus der Zeit vor db/031. Eine erfundene Herkunft waere
      // schlimmer als eine fehlende.
      return `„${kat}“ — zu diesem Vorgang ist keine Herkunft festgehalten (angelegt, bevor die Plattform sie mitschrieb).`;
  }
}

/** Woraus der Entwurfstext stammt, in einem Satz. */
export function entwurfSatz(d: HerkunftDaten): string | null {
  const fassung =
    d.entwurf_fassung_nr && d.entwurf_fassung_nr > 1
      ? ` Fassung ${d.entwurf_fassung_nr}.`
      : "";
  switch (d.entwurf_quelle) {
    case "regel":
      return `Aus einem festen Textbaustein — kein Sprachmodell beteiligt.${fassung}`;
    case "modell":
      return `Vom Sprachmodell formuliert${
        d.entwurf_modell ? ` (${d.entwurf_modell})` : ""
      }.${fassung}`;
    case "mensch":
      return `Von Hand geschrieben oder überarbeitet.${fassung}`;
    default:
      return null;
  }
}

export function Herkunft({
  daten,
  weisungen = [],
  uebergangen = [],
  titel = "Worauf das beruht",
}: {
  daten: HerkunftDaten;
  /** Die Dauerweisungen, die bei diesem Entwurf gewirkt haben. */
  weisungen?: WeisungAnzeige[];
  /** Vorhandene, hier nicht wirksame Weisungen — mit Grund. */
  uebergangen?: UebergangenAnzeige[];
  titel?: string;
}) {
  const entwurf = entwurfSatz(daten);

  return (
    <>
      {/* Immer sichtbar: das Schweigen vom 03.11. bekommt eine Stimme. */}
      {daten.kein_entwurf_grund && (
        <div className="meldung" data-art="warnung">
          <strong>Kein Entwurf — und das ist der Grund</strong>
          {daten.kein_entwurf_grund}
        </div>
      )}
      {daten.ohne_antwort_grund && (
        <div className="meldung" data-art="info">
          <strong>Ohne Antwort geschlossen</strong>
          {daten.ohne_antwort_grund}
        </div>
      )}

      <details className="erklaerung">
        <summary>{titel}</summary>
        <dl className="datenblatt">
          <dt>Einordnung</dt>
          <dd>{einordnungSatz(daten)}</dd>

          {daten.einordnung_fundstelle && (
            <>
              <dt>Fundstelle</dt>
              {/* Der Ausschnitt, in dem das Stichwort stand. Ohne ihn
                  heisst "Bescheid hat getroffen" nichts; mit ihm ist der
                  Fehler vom 03.11. in einer Zeile zu sehen. */}
              <dd className="protokoll">{daten.einordnung_fundstelle}</dd>
            </>
          )}

          <dt>Sperre</dt>
          <dd>
            {daten.heikel
              ? "Als heikel markiert — der Agent schreibt hier nichts vor."
              : "Nicht gesperrt."}
          </dd>

          {entwurf && (
            <>
              <dt>Entwurf</dt>
              <dd>{entwurf}</dd>
            </>
          )}

          <dt>Dauerweisungen</dt>
          <dd>
            {weisungen.length === 0 ? (
              "Keine — dieser Text ist von keiner stehenden Weisung geprägt."
            ) : (
              // Aufsteigend nach Vorrang, wie sie im Prompt standen. Wer
              // wissen will, warum eine Mail so klingt, liest sie in
              // derselben Reihenfolge, in der sie gewirkt haben.
              <ul>
                {weisungen.map((w) => (
                  <li key={w.id}>
                    <span className="marker" data-art="info">
                      {EBENE_LABEL[w.ebene]}
                    </span>{" "}
                    {w.weisungstext}
                  </li>
                ))}
              </ul>
            )}
          </dd>

          {uebergangen.length > 0 && (
            <>
              <dt>Nicht gewirkt</dt>
              <dd>
                {/* Auch das gehoert hierher: Wer auf der Weisungsseite
                    etwas eintraegt und es im Entwurf nicht wiederfindet,
                    muss sehen, warum. Sonst sucht er den Fehler im Text. */}
                <ul>
                  {uebergangen.map((w) => (
                    <li key={w.id}>
                      <span className="marker">{EBENE_LABEL[w.ebene]}</span>{" "}
                      {w.weisungstext} — {w.grund}
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}
        </dl>
        <p className="hinweis">
          Diese Angaben stehen am Vorgang und an der Nachricht in der
          Datenbank, nicht nur im Protokoll. Sie sind der Grund, aus dem
          sich eine falsche Einordnung berichtigen lässt, statt sie nur zu
          bemerken.
        </p>
      </details>
    </>
  );
}
