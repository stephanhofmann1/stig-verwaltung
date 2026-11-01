"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Props {
  id: string;
  betreff: string;
  koerper: string;
  empfaenger: string[];
  verfasstVon: "agent" | "mensch" | null;
  notiz: string | null;
  /** Zeigt zusätzlich den Vorgang an — für die Freigabe-Liste. */
  vorgang?: { nummer: number; betreff: string; id: string } | null;
}

export function EntwurfKarte(p: Props) {
  const router = useRouter();
  const [text, setText] = useState(p.koerper);
  const [meldung, setMeldung] = useState<{ art: "ok" | "fehler"; text: string } | null>(null);
  const [laeuft, start] = useTransition();
  const [busy, setBusy] = useState(false);

  const geaendert = text !== p.koerper;

  async function speichern() {
    const r = await fetch(`/api/entwurf/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ koerper: text }),
    });
    return r.ok;
  }

  async function senden() {
    setBusy(true);
    setMeldung(null);
    try {
      if (geaendert) {
        const ok = await speichern();
        if (!ok) {
          setMeldung({ art: "fehler", text: "Änderung konnte nicht gespeichert werden." });
          return;
        }
      }
      const r = await fetch(`/api/entwurf/${p.id}`, { method: "POST" });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        setMeldung({ art: "fehler", text: d.fehler ?? "Versand fehlgeschlagen." });
        return;
      }
      setMeldung({ art: "ok", text: "Gesendet." });
      start(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  async function verwerfen() {
    setBusy(true);
    try {
      await fetch(`/api/entwurf/${p.id}`, { method: "DELETE" });
      start(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="entwurf">
      <div className="entwurf-kopf">
        {p.vorgang && (
          <a href={`/vorgang/${p.vorgang.id}`}>
            <strong className="ziffern">
              {String(p.vorgang.nummer).padStart(4, "0")}
            </strong>{" "}
            {p.vorgang.betreff}
          </a>
        )}
        <span>An: {p.empfaenger.join(", ")}</span>
        <span>{p.betreff}</span>
        {p.verfasstVon === "agent" && (
          <span className="marker" data-art="agent">
            vorgeschrieben
          </span>
        )}
      </div>

      {p.notiz && <p className="entwurf-notiz">{p.notiz}</p>}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck
        aria-label="Entwurfstext"
      />

      <div className="knopfreihe">
        <button onClick={senden} disabled={busy || laeuft}>
          {busy ? "Sendet…" : "Senden"}
        </button>
        <button data-art="still" onClick={verwerfen} disabled={busy || laeuft}>
          Verwerfen
        </button>
        {geaendert && !meldung && (
          <span className="rueckmeldung">Geändert — wird beim Senden übernommen.</span>
        )}
        {meldung && (
          <span className="rueckmeldung" data-art={meldung.art === "fehler" ? "fehler" : undefined}>
            {meldung.text}
          </span>
        )}
      </div>
    </section>
  );
}
