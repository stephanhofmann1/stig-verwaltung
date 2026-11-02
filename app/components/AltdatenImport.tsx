"use client";

import { useState } from "react";

interface Antwort {
  ok?: boolean;
  echt?: boolean;
  bloecke?: string[];
  bericht?: string[];
  fehler?: string;
}

/** Farbe nach Art der Zeile. Der Bericht ist lang -- das Auge muss ihn
 *  überfliegen können, ohne jede Zeile zu lesen. */
function farbe(z: string): string | undefined {
  if (z.startsWith("ANGELEGT") || z.startsWith("GESETZT")) return "#1b6b3a";
  if (z.startsWith("WÜRDE")) return "#1a4f8a";
  if (
    z.includes("FEHLT") ||
    z.includes("EINHEIT FEHLT") ||
    z.startsWith("OFFEN") ||
    z.includes("ÜBERSPRUNGEN")
  ) {
    return "#b3261e";
  }
  if (z.startsWith("vorhanden") || z.startsWith("Objekt vorhanden")) return "#6b6b6b";
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

      <label style={{ display: "block", marginBottom: "0.75rem" }}>
        Datei
        <input
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            setDatei(e.target.files?.[0] ?? null);
            setAntwort(null);
            setFehler("");
          }}
          style={{ display: "block", marginTop: "0.25rem" }}
        />
      </label>

      {fehler && <p style={{ color: "#b3261e" }}>{fehler}</p>}

      {!probeGelaufen && !uebernommen && (
        <button onClick={() => schicke(false)} disabled={!datei || stand !== "bereit"}>
          {stand === "probe" ? "prüft …" : "Probelauf — schreibt nichts"}
        </button>
      )}

      {antwort?.bericht && (
        <div style={{ marginTop: "1rem" }}>
          <h3 style={{ marginBottom: "0.25rem" }}>
            {uebernommen ? "Übernommen" : "Probelauf"}
          </h3>
          {antwort.bloecke && (
            <p className="hinweis" style={{ marginTop: 0 }}>
              Gefundene Blöcke: {antwort.bloecke.join(", ")}
            </p>
          )}
          <pre
            style={{
              maxHeight: "28rem",
              overflow: "auto",
              background: "#fafafa",
              border: "1px solid #e3e3e3",
              padding: "0.75rem",
              fontSize: "0.8rem",
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
            }}
          >
            {antwort.bericht.map((z, i) => (
              <div key={i} style={{ color: farbe(z) }}>{z || " "}</div>
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
