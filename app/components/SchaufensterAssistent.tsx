"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Der Assistent auf der öffentlichen Seite.
 *
 * Er schickt die Frage an /api/oeffentlich/chat und zeigt die Antwort.
 * Mehr tut er nicht — und das ist der Punkt: Wissensbasis, Filter und
 * Modellanweisung liegen auf dem Server (lib/schaufenster.ts). Im
 * Browser steht nichts, was jemand lesen oder abschalten könnte.
 *
 * Der Verlauf wird mitgeschickt, damit eine Rückfrage wie „und wie lange
 * dauert das?" Sinn ergibt. Er lebt nur in dieser Seite: Beim Neuladen
 * ist er weg, gespeichert wird er nirgends.
 */

const BEGRUESSUNG =
  "Guten Tag. Ich beantworte Fragen zu dieser Plattform — wie der Posteingang arbeitet, " +
  "was ohne Freigabe läuft und was nicht, wie die Daten getrennt sind. Ich kenne nur, " +
  "was auf dieser Seite steht.";

const VORSCHLAEGE = [
  "Was macht die Plattform konkret?",
  "Geht wirklich nichts ohne Freigabe raus?",
  "Was passiert mit einer Mahnung?",
  "Wie sind die Daten getrennt?",
  "Woran wird gerade gebaut?",
];

interface Zug {
  frage: string;
  antwort: string;
}

export function Assistent() {
  const [verlauf, setVerlauf] = useState<Zug[]>([]);
  const [laeuft, setLaeuft] = useState(false);
  const [eingabe, setEingabe] = useState("");
  const lauf = useRef<HTMLDivElement>(null);

  // Nach jeder neuen Zeile ans Ende rollen. Ohne das steht die Antwort
  // unter dem sichtbaren Rand, und es sieht aus, als sei nichts passiert.
  useEffect(() => {
    const el = lauf.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [verlauf, laeuft]);

  async function fragen(frage: string) {
    const sauber = frage.trim();
    if (!sauber || laeuft) return;
    setEingabe("");
    setLaeuft(true);
    const bisher = verlauf;
    setVerlauf([...bisher, { frage: sauber, antwort: "" }]);

    let antwort: string;
    try {
      const res = await fetch("/api/oeffentlich/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ frage: sauber, verlauf: bisher.slice(-3) }),
      });
      const daten = (await res.json()) as { antwort?: string };
      antwort =
        daten.antwort ??
        "Das hat gerade nicht geklappt. Schreiben Sie an kontakt@stig-immobilien.de.";
    } catch {
      antwort =
        "Die Verbindung kam nicht zustande. Schreiben Sie an kontakt@stig-immobilien.de.";
    }

    setVerlauf([...bisher, { frage: sauber, antwort }]);
    setLaeuft(false);
  }

  return (
    <>
      <div className="s-chat">
        <div className="s-chat-kopf">
          <span className="s-punkt" aria-hidden="true" />
          <span>Assistent</span>
          <span>{laeuft ? "überlegt" : "bereit"}</span>
        </div>

        <div className="s-lauf" ref={lauf} aria-live="polite">
          <p className="s-sagt">{BEGRUESSUNG}</p>
          {verlauf.map((z, i) => (
            <div key={i}>
              <p className="s-sagt" data-wer="ich">
                {z.frage}
              </p>
              {z.antwort ? (
                <p className="s-sagt">{z.antwort}</p>
              ) : (
                <p className="s-sagt">…</p>
              )}
            </div>
          ))}
        </div>

        <div className="s-vorschlaege">
          {VORSCHLAEGE.map((v) => (
            <button
              key={v}
              type="button"
              className="s-vorschlag"
              onClick={() => fragen(v)}
              disabled={laeuft}
            >
              {v}
            </button>
          ))}
        </div>

        <form
          className="s-eingabe"
          onSubmit={(e) => {
            e.preventDefault();
            fragen(eingabe);
          }}
        >
          <input
            id="assistent-frage"
            name="frage"
            type="text"
            autoComplete="off"
            maxLength={500}
            placeholder="Ihre Frage zur Plattform"
            aria-label="Ihre Frage zur Plattform"
            value={eingabe}
            onChange={(e) => setEingabe(e.target.value)}
          />
          <button type="submit" disabled={laeuft || !eingabe.trim()}>
            Senden
          </button>
        </form>
      </div>

      <div className="s-siegel">
        <b>Keine internen Daten.</b>
        <p>
          Der Assistent arbeitet ausschließlich mit den öffentlichen Angaben dieser
          Seite. Er hat keine Verbindung zur Verwaltung, zu Konten oder zu Postfächern —
          auch keine, die sich einschalten ließe. Fragen nach internen Daten werden
          abgewiesen, bevor sie ein Sprachmodell erreichen, und an einen Menschen
          verwiesen.
        </p>
      </div>
    </>
  );
}
