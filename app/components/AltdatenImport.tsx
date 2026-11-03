"use client";

import { useState } from "react";

interface Antwort {
  ok?: boolean;
  echt?: boolean;
  bloecke?: string[];
  bericht?: string[];
  fehler?: string;
}

/**
 * Art der Zeile. Der Bericht ist lang -- das Auge muss ihn überfliegen
 * können, ohne jede Zeile zu lesen.
 *
 * Vorher gab die Funktion fünf feste Farbwerte zurück, die als Stil ins
 * Markup gingen. Eine Farbe im Markup kippt im Dunkelmodus nicht mit: das
 * Dunkelgrün der Erfolgszeilen war auf dunklem Grund nicht mehr lesbar.
 * Darum benennt die Funktion jetzt nur die Art, und .rueckmeldung[data-art]
 * färbt sie aus den Marken -- hell und dunkel.
 *
 * "info" (vormals das Registerblau des Akzents) hat in globals.css noch
 * keine Regel. Bis sie da ist, bleibt die Zeile im ruhigen Grau von
 * .rueckmeldung -- lesbar, nur ohne eigene Farbe. Das gilt auch für die
 * "vorhanden"-Zeilen: Grau ist bei .rueckmeldung schon der Normalfall, die
 * eigene Abfrage dafuer war überflüssig.
 */
function art(z: string): "gut" | "info" | "fehler" | undefined {
  if (z.startsWith("ANGELEGT") || z.startsWith("GESETZT")) return "gut";
  if (z.startsWith("WÜRDE")) return "info";
  if (
    z.includes("FEHLT") ||
    z.includes("EINHEIT FEHLT") ||
    z.startsWith("OFFEN") ||
    z.includes("ÜBERSPRUNGEN")
  ) {
    return "fehler";
  }
  return undefined;
}

/**
 * Altdaten übernehmen -- in zwei Schritten.
 *
 * Erst der Probelauf, der nichts schreibt und Zeile für Zeile sagt, was er
 * anlegen würde. Dann die Übernahme. Es geht um Mietverhältnisse echter
 * Menschen; der erste Lauf soll zeigen, nicht handeln.
 *
 * Mehrfach übernehmen ist gefahrlos: Jedes Mietverhältnis hängt am
 * natürlichen Schlüssel (Einheit + Kontakt + Beginn), ein zweiter Lauf
 * legt nichts doppelt an.
 */
export function AltdatenImport() {
  const [datei, setDatei] = useState<File | null>(null);
  const [stand, setStand] = useState<"bereit" | "probe" | "echt">("bereit");
  const [antwort, setAntwort] = useState<Antwort | null>(null);
  const [fehler, setFehler] = useState("");

  async function schicke(echt: boolean) {
    if (!datei) return;
    const koerper = new FormData();
    koerper.set("datei", datei);
    if (echt) koerper.set("echt", "1");

    setStand(echt ? "echt" : "probe");
    setFehler("");
    const r = await fetch("/api/altdaten/import", { method: "POST", body: koerper });
    const d = (await r.json().catch(() => null)) as Antwort | null;
    setStand("bereit");

    if (!r.ok || !d || d.fehler) {
      setFehler(d?.fehler ?? `Fehler ${r.status}`);
      if (d?.bericht) setAntwort(d);
      return;
    }
    setAntwort(d);
  }

  const probeGelaufen = antwort?.ok === true && antwort.echt === false;
  const uebernommen = antwort?.ok === true && antwort.echt === true;

  return (
    <div>
      <p className="hinweis">
        Die Datei <code>altdaten.json</code> enthält Objekte, Einheiten,
        Mietverhältnisse, Mieter, Mietanpassungen, Kündigungen und Fristen.
        Sie geht von hier direkt an diesen Server — sie liegt bewusst nicht
        im Repository, weil darin Namen, Geburtsdaten und Voranschriften
        echter Mieter stehen.
      </p>

      <label>
        Datei
        <input
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            setDatei(e.target.files?.[0] ?? null);
            setAntwort(null);
            setFehler("");
          }}
          className="feld"
        />
      </label>

      {fehler && (
        <p className="rueckmeldung" data-art="fehler">
          {fehler}
        </p>
      )}

      {!probeGelaufen && !uebernommen && (
        <button onClick={() => schicke(false)} disabled={!datei || stand !== "bereit"}>
          {stand === "probe" ? "prüft …" : "Probelauf — schreibt nichts"}
        </button>
      )}

      {antwort?.bericht && (
        <div className="abschnitt">
          <h3>{uebernommen ? "Übernommen" : "Probelauf"}</h3>
          {antwort.bloecke && (
            <p className="hinweis">
              Gefundene Blöcke: {antwort.bloecke.join(", ")}
            </p>
          )}
          {/* .protokoll bringt Rollhöhe, Fläche, Rand und Zeilenmaß des
              Protokollblocks mit -- vorher stand das alles im Markup, mit
              zwei festen Grauwerten für Fläche und Rand. */}
          <pre className="protokoll">
            {antwort.bericht.map((z, i) => (
              <div key={i} className="rueckmeldung" data-art={art(z)}>
                {z || " "}
              </div>
            ))}
          </pre>

          {probeGelaufen && (
            <p>
              <button onClick={() => schicke(true)} disabled={stand !== "bereit"}>
                {stand === "echt" ? "übernimmt …" : "Jetzt übernehmen"}
              </button>{" "}
              <button
                type="button"
                data-art="still"
                onClick={() => setAntwort(null)}
              >
                Verwerfen
              </button>
            </p>
          )}

          {uebernommen && (
            <p className="hinweis">
              Nochmals übernehmen ist gefahrlos — jedes Mietverhältnis hängt
              am natürlichen Schlüssel und wird nicht doppelt angelegt.
              Seite neu laden, um die Stammdaten oben zu sehen.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
