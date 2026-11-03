import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Die Läufe, die nachts von selbst passieren.
 *
 * Diese Seite ist der Grund, warum es die Tabelle `lauf` gibt. Vorher gingen
 * die Ergebnisse der zeitgesteuerten Läufe nirgends hin: Der Zeitplaner warf
 * die Antwort weg, Fehler landeten im Containerlog. Ein Lauf, der seit drei
 * Wochen scheitert, verhielt sich damit genauso wie einer, der nichts zu tun
 * hatte — beide schweigen.
 *
 * Deshalb zeigt die Seite nicht nur Fehler, sondern **jeden** Lauf. Ein Lauf,
 * der ausgefallen ist, ist nur als Lücke erkennbar; eine Liste, die nur
 * Probleme enthält, sieht im Totalausfall am besten aus.
 */

interface LaufZeile {
  id: string;
  name: string;
  begonnen_am: string;
  dauer_ms: number | null;
  ok: boolean;
  fehler: string | null;
  hinweise: string[];
  ergebnis: unknown;
}

const LAEUFE = [
  "bankabruf",
  "mailabruf",
  "agent",
  "nachfassen",
  "sollstellungen",
  "lagebericht",
] as const;

/**
 * Der deutsche Name eines Laufs.
 *
 * Die Kennung links ist der Wert in der Datenbank und im Zeitplaner -- sie
 * bleibt, wie sie ist, sonst findet der Lauf seine Zeile nicht mehr. Nur
 * angezeigt wird der Name rechts: "sollstellungen" sagt dem Vermieter
 * nichts darueber, dass dort die Mieten gestellt und die Zahlungen
 * zugeordnet werden.
 */
const NAMEN: Record<string, string> = {
  bankabruf: "Kontoabruf",
  mailabruf: "E-Mail-Abruf",
  agent: "Antwortentwürfe",
  nachfassen: "Nachfassen",
  sollstellungen: "Mieten stellen und zuordnen",
  lagebericht: "Lagebericht",
};

/**
 * Eine unbekannte Kennung bleibt sichtbar, statt zu verschwinden: Kommt ein
 * neuer Lauf dazu, soll er in der Liste auftauchen -- und zwar auffaellig
 * genug, dass jemand ihm einen Namen gibt.
 */
const beschriftung = (name: string) => NAMEN[name] ?? name;

const zeit = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

function dauer(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`.replace(".", ",");
}

/**
 * Macht aus dem gespeicherten Ergebnis einen Satz.
 *
 * Bewusst anspruchslos: Das Ergebnis ist jsonb und sieht je Lauf anders aus.
 * Eine Darstellung, die jede Form kennen muss, bricht beim nächsten neuen
 * Zähler. Was nicht erkannt wird, wird nicht angezeigt — der Lauf selbst
 * steht trotzdem in der Liste.
 */
function zusammenfassung(name: string, e: unknown): string | null {
  if (!e || typeof e !== "object") return null;
  const o = e as Record<string, unknown>;
  const zahl = (x: unknown) => (typeof x === "number" ? x : null);

  if (name === "sollstellungen") {
    const soll = o.soll as Record<string, unknown> | undefined;
    const zu = o.zuordnung as Record<string, unknown> | undefined;
    const teile: string[] = [];
    const erzeugt = zahl(soll?.erzeugt);
    if (erzeugt !== null) teile.push(`${erzeugt} Sollstellungen angelegt`);
    const uebernommen = zahl(zu?.uebernommen) ?? zahl(zu?.zugeordnet);
    if (uebernommen !== null) teile.push(`${uebernommen} Zahlungen zugeordnet`);
    return teile.length > 0 ? teile.join(", ") : "nichts zu tun";
  }

  if (name === "agent") {
    const entwuerfe = zahl(o.entwuerfe) ?? zahl(o.angelegt);
    if (entwuerfe !== null) return `${entwuerfe} Entwürfe geschrieben`;
  }

  if (name === "mailabruf") {
    const abruf = o.abruf as Record<string, unknown> | undefined;
    const v = zahl(abruf?.verarbeitet);
    if (v !== null) return `${v} Mails verarbeitet`;
  }

  if (name === "lagebericht") {
    const versendet = o.versendet === true;
    const dringend = o.dringend === true;
    return (
      (versendet ? "verschickt" : "NICHT verschickt") +
      (dringend ? ", etwas zu tun" : ", alles ruhig")
    );
  }

  if (name === "nachfassen") {
    const n = zahl(o.nachgefasst) ?? zahl(o.angelegt);
    if (n !== null) return `${n} Nachfass-Entwürfe`;
  }

  return null;
}

export default async function Laeufe() {
  const zeilen = await query<LaufZeile>(`
    SELECT id, name, begonnen_am::text, dauer_ms, ok, fehler, hinweise, ergebnis
      FROM lauf
     ORDER BY begonnen_am DESC
     LIMIT 120
  `);

  // Je Art der jüngste Lauf. Das ist die Frage, die man wirklich hat:
  // "Ist heute alles gelaufen?"
  const neueste = new Map<string, LaufZeile>();
  for (const z of zeilen) if (!neueste.has(z.name)) neueste.set(z.name, z);

  const jetzt = Date.now();
  const befunde = zeilen.filter((z) => !z.ok || z.hinweise.length > 0);

  return (
    <main>
      <div className="titelzeile">
        <h1>Läufe</h1>
        <span className="zaehler">
          {zeilen.length === 0 ? "noch keine" : `${zeilen.length} zuletzt`}
        </span>
      </div>

      {zeilen.length === 0 ? (
        <div className="leer">
          <strong>Noch kein Lauf protokolliert</strong>
          Die Automatik arbeitet zweimal am Tag, morgens um 7 und abends um
          18 Uhr. Steht hier morgen noch nichts, ist sie überhaupt nicht
          angelaufen. Dann stimmt nicht etwas an den Miet- oder Kontodaten,
          sondern die Anwendung selbst läuft nicht — das muss prüfen, wer
          sie technisch betreut.
        </div>
      ) : (
        <>
          {/* Zustand je Art. Entscheidend ist das Alter: Ein "ok" von
              vorletzter Woche ist kein ok. */}
          <div className="register">
            {LAEUFE.map((name) => {
              const z = neueste.get(name);
              const alterStunden = z
                ? (jetzt - new Date(z.begonnen_am).getTime()) / 3_600_000
                : null;
              // Zweimal täglich heißt: höchstens 13 Stunden Abstand. 26
              // Stunden sind ein ausgefallener Tag, nicht eine Verzögerung.
              const veraltet = alterStunden === null || alterStunden > 26;

              return (
                // Keine Seite je Lauf, also kein Ziel: data-still nimmt das
                // Aufleuchten beim Ueberfahren zurueck.
                <div className="posten" data-still="ja" key={name}>
                  <span className="nummer">
                    {!z || veraltet ? "!" : z.ok ? "ok" : "!"}
                  </span>
                  <span className="betreff">
                    {beschriftung(name)}
                    {z && (
                      <span className="hinweis">
                        {" "}
                        · {zusammenfassung(name, z.ergebnis) ?? "gelaufen"}
                      </span>
                    )}
                  </span>
                  <span className="zeit">
                    {z ? zeit(z.begonnen_am) : "nie"}
                  </span>
                  <span className="unterzeile">
                    {!z ? (
                      <span>Noch nie gelaufen.</span>
                    ) : veraltet ? (
                      <span>
                        Letzter Lauf vor über einem Tag — der Zeitplaner
                        steht.
                      </span>
                    ) : !z.ok ? (
                      <span>{z.fehler ?? "gescheitert"}</span>
                    ) : (
                      <span>in {dauer(z.dauer_ms)}</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          {befunde.length > 0 && (
            <>
              <div className="titelzeile">
                <h2>Was jemand ansehen muss</h2>
                <span className="zaehler">{befunde.length}</span>
              </div>
              <div className="register">
                {befunde.map((z) => (
                  <div className="posten" data-still="ja" key={z.id}>
                    <span className="nummer">!</span>
                    <span className="betreff">{beschriftung(z.name)}</span>
                    <span className="zeit">{zeit(z.begonnen_am)}</span>
                    <span className="unterzeile">
                      {z.fehler && <span>{z.fehler}</span>}
                      {z.hinweise.map((h, i) => (
                        <span key={i}>{h}</span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="titelzeile">
            <h2>Verlauf</h2>
          </div>
          <div className="register">
            {zeilen.map((z) => (
              <div className="posten" data-still="ja" key={z.id}>
                <span className="nummer">{z.ok ? "·" : "!"}</span>
                <span className="betreff">{beschriftung(z.name)}</span>
                <span className="zeit">{zeit(z.begonnen_am)}</span>
                <span className="unterzeile">
                  <span>{dauer(z.dauer_ms)}</span>
                  {z.ok ? (
                    <span>{zusammenfassung(z.name, z.ergebnis) ?? "ok"}</span>
                  ) : (
                    <span>{z.fehler ?? "gescheitert"}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
