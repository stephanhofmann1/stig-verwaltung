import { mahnstand } from "@/lib/rueckstaende";
import { mahnbereitschaft } from "@/lib/mahnfreigabe";
import type { Stufe } from "@/lib/mahnstufen";

export const dynamic = "force-dynamic";

/**
 * Der Stand der Rückstände.
 *
 * Diese Seite verschickt nichts. Sie zeigt, wer wie weit im Rückstand ist,
 * und begründet jede Stufe in einem Satz — die Begründung ist die
 * Entscheidungsgrundlage für die Freigabe. Stephan hat am 01.11.2026
 * festgelegt: nie automatisch, alles über Freigabe.
 *
 * Die wichtigste Spalte ist die rechte: Beträge aus Monaten, für die es
 * keine Kontoauszüge gibt. Die zählen absichtlich nicht als Rückstand.
 * Für Ludwigshafen wird ab Januar 2024 abgerechnet, das Konto gibt es aber
 * erst ab Dezember 2024 — würde man beides addieren, hätte jeder
 * langjährige Mieter dort elf Monatsmieten Rückstand und damit einen
 * Kündigungsgrund nach § 543 Abs. 2 Nr. 3 BGB. Für die Augartenstraße gibt
 * es gar kein Konto, dort wird deshalb überhaupt nicht gemahnt.
 */

const euro = (w: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(w);

const monat = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" })
    .format(new Date(iso + "T12:00:00Z"));

const BESCHRIFTUNG: Record<Stufe, string> = {
  mahnung: "Mahnung fällig",
  erinnerung: "Erinnerung fällig",
  faellig: "beobachten",
  ok: "noch nicht fällig",
};

const FARBE: Record<Stufe, string> = {
  mahnung: "#b3261e",
  erinnerung: "#8a5a00",
  faellig: "#5b5b66",
  ok: "#5b5b66",
};

export default async function Mahnwesen() {
  const [stand, bereitschaft] = await Promise.all([
    mahnstand(),
    mahnbereitschaft(),
  ]);
  const gesperrt = bereitschaft.freigabe === null;

  const zuSchreiben = stand.filter(
    (r) => r.stufe === "mahnung" || r.stufe === "erinnerung",
  );
  const ungeklaert = stand.filter((r) => r.offen_ohne_daten >= 1);
  const summe = zuSchreiben.reduce((s, r) => s + r.offen, 0);

  return (
    <main>
      <div className="titelzeile">
        <h1>Rückstände</h1>
        <span className="zaehler">
          {stand.length === 0
            ? "keine"
            : `${zuSchreiben.length} zu schreiben, ${stand.length} insgesamt`}
        </span>
      </div>

      {gesperrt ? (
        <div
          className="leer"
          style={{
            borderColor: "#8a5a00",
            background: "#fdf8ef",
            marginBottom: "1.5rem",
          }}
        >
          <strong>Mahnwesen gesperrt — es geht nichts raus</strong>
          Diese Seite zeigt den Stand, erzeugt aber kein Schreiben. Die Sperre
          liegt in der Datenbank, nicht nur in der Absprache: Ohne Freigabe
          weist auch der nächtliche Lauf jede Mahnung ab. Freigeben, wenn der
          Abgleich steht:{" "}
          <code>
            INSERT INTO mahnwesen_freigabe (freigegeben_von, notiz) VALUES
            (&apos;Stephan&apos;, &apos;…&apos;);
          </code>
        </div>
      ) : (
        <div className="leer" style={{ marginBottom: "1.5rem" }}>
          <strong>Mahnwesen freigegeben</strong>
          Erteilt von {bereitschaft.freigabe!.freigegeben_von} am{" "}
          {new Intl.DateTimeFormat("de-DE", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          }).format(new Date(bereitschaft.freigabe!.freigegeben_am))}
          {bereitschaft.freigabe!.notiz
            ? ` — ${bereitschaft.freigabe!.notiz}`
            : ""}
          . Versendet wird trotzdem nichts von allein: jedes Schreiben geht
          einzeln über die Freigabe.
        </div>
      )}

      <h2 style={{ fontSize: "1.0625rem", margin: "0 0 0.75rem" }}>
        Bereit für die Freigabe?
      </h2>
      <table className="liste" style={{ marginBottom: "2rem" }}>
        <tbody>
          {bereitschaft.befunde.map((b) => (
            <tr key={b.punkt}>
              <td style={{ width: "1.5rem", verticalAlign: "top" }}>
                <span
                  style={{
                    color: b.erfuellt ? "#1b6b3a" : "#8a5a00",
                    fontWeight: 600,
                  }}
                >
                  {b.erfuellt ? "\u2713" : "\u2022"}
                </span>
              </td>
              <td>
                <strong>{b.punkt}</strong>
                <div style={{ color: "#5b5b66", fontSize: "0.875rem" }}>
                  {b.erklaerung}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {stand.length === 0 ? (
        <div className="leer">
          <strong>Nichts offen</strong>
          Entweder ist alles bezahlt, oder es sind noch keine Zahlungen
          zugeordnet. Nach dem ersten Kontoimport steht hier mehr.
        </div>
      ) : (
        <>
          {zuSchreiben.length > 0 && (
            <p style={{ color: "#5b5b66", margin: "0 0 1.25rem" }}>
              {zuSchreiben.length} Schreiben wären fällig, zusammen{" "}
              <strong>{euro(summe)}</strong>.{" "}
              {gesperrt
                ? "Solange das Mahnwesen gesperrt ist, wird keines davon erzeugt."
                : "Erzeugt und versendet wird nichts von allein — jedes Schreiben geht einzeln über die Freigabe."}
            </p>
          )}

          <table className="liste">
            <thead>
              <tr>
                <th>Mieter</th>
                <th>Einheit</th>
                <th style={{ textAlign: "right" }}>offen</th>
                <th>seit</th>
                <th>Stufe</th>
                <th style={{ textAlign: "right" }}>ohne Kontodaten</th>
              </tr>
            </thead>
            <tbody>
              {stand.map((r) => (
                <tr key={r.mietverhaeltnis_id}>
                  <td>
                    <strong>{r.kontakt_name}</strong>
                    <div style={{ color: "#5b5b66", fontSize: "0.875rem" }}>
                      {r.begruendung}
                    </div>
                  </td>
                  <td>{r.einheit}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {r.offen > 0 ? euro(r.offen) : "—"}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {r.offen > 0 ? monat(r.aeltester_monat) : "—"}
                  </td>
                  <td style={{ color: FARBE[r.stufe], whiteSpace: "nowrap" }}>
                    {BESCHRIFTUNG[r.stufe]}
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      whiteSpace: "nowrap",
                      color: "#5b5b66",
                    }}
                  >
                    {r.offen_ohne_daten >= 1
                      ? `${euro(r.offen_ohne_daten)} (${r.monate_ohne_daten.length} Mon.)`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {ungeklaert.length > 0 && (
            <div className="leer" style={{ marginTop: "1.5rem" }}>
              <strong>
                Wofür es keine Kontoauszüge gibt, wird nicht gemahnt
              </strong>
              Bei {ungeklaert.length} Mietverhältnissen stehen Beträge aus
              Monaten offen, für die keine Kontoumsätze vorliegen —
              zusammen{" "}
              {euro(ungeklaert.reduce((s, r) => s + r.offen_ohne_daten, 0))}.
              Diese Monate sind nicht unbezahlt, sondern unbekannt: Für die
              Welserstraße beginnt das Konto am 01.12.2024, für die
              Augartenstraße gibt es keins. Sie zählen deshalb nicht in die
              Forderung und lösen keine Mahnung aus. Zu klären ist das über
              die Mietaufstellungen des Voreigentümers, nicht über ein
              Schreiben an den Mieter.
            </div>
          )}
        </>
      )}
    </main>
  );
}
