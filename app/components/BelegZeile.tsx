"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Option {
  id: string;
  label: string;
  offen: string;
}

interface Props {
  buchungId: string;
  buchungstag: string;
  betrag: string;
  absender: string | null;
  verwendungszweck: string | null;
  begruendung: string;
  vorschlagBelegId: string | null;
  vorschlagBetrag: number;
  optionen: Option[];
}

const feld: React.CSSProperties = {
  font: "inherit",
  fontSize: "0.9375rem",
  padding: "0.5rem",
  border: "1px solid var(--linie)",
  background: "var(--papier)",
  color: "var(--tinte)",
};

export function BelegZeile(p: Props) {
  const router = useRouter();
  const [belegId, setBelegId] = useState(p.vorschlagBelegId ?? "");
  const [betrag, setBetrag] = useState(p.vorschlagBetrag.toFixed(2));
  const [vermerk, setVermerk] = useState("");
  const [vermerkOffen, setVermerkOffen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [, start] = useTransition();

  async function senden(nutzlast: Record<string, unknown>) {
    setBusy(true);
    setFehler(null);
    try {
      const r = await fetch("/api/belege", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buchung_id: p.buchungId, ...nutzlast }),
      });
      const d = await r.json();
      if (!r.ok) {
        setFehler(d.fehler ?? "Hat nicht geklappt.");
        return;
      }
      start(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="entwurf">
      <div className="entwurf-kopf">
        <strong className="ziffern" style={{ color: "var(--tinte)" }}>
          {p.betrag}
        </strong>
        <span className="ziffern">{p.buchungstag}</span>
        {p.absender && <span>an {p.absender}</span>}
      </div>

      {p.verwendungszweck && (
        <p className="eintrag-text" style={{ margin: "0 0 0.75rem" }}>
          {p.verwendungszweck}
        </p>
      )}
      <p className="entwurf-notiz">{p.begruendung}</p>

      {!vermerkOffen ? (
        <div className="knopfreihe">
          <select
            value={belegId}
            onChange={(e) => {
              setBelegId(e.target.value);
              const o = p.optionen.find((x) => x.id === e.target.value);
              if (o) setBetrag(Number(o.offen).toFixed(2));
            }}
            aria-label="Beleg"
            style={{ ...feld, maxWidth: "30rem", flex: "1 1 20rem" }}
          >
            <option value="">— Beleg wählen —</option>
            {p.optionen.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label} · offen {Number(o.offen).toFixed(2)} €
              </option>
            ))}
          </select>
          <input
            value={betrag}
            onChange={(e) => setBetrag(e.target.value)}
            inputMode="decimal"
            aria-label="Betrag"
            className="ziffern"
            style={{ ...feld, width: "7rem" }}
          />
          <button
            disabled={busy || !belegId}
            onClick={() =>
              senden({
                beleg_id: belegId,
                betrag: Number(betrag.replace(",", ".")),
              })
            }
          >
            {busy ? "Bucht…" : "Zuordnen"}
          </button>
          <button data-art="still" onClick={() => setVermerkOffen(true)}>
            Kein Beleg nötig
          </button>
          {fehler && (
            <span className="rueckmeldung" data-art="fehler">
              {fehler}
            </span>
          )}
        </div>
      ) : (
        <div className="knopfreihe">
          <input
            value={vermerk}
            onChange={(e) => setVermerk(e.target.value)}
            placeholder="Warum kein Beleg? z. B. Umbuchung aufs eigene Konto"
            aria-label="Vermerk"
            style={{ ...feld, flex: "1 1 20rem" }}
          />
          <button
            disabled={busy || !vermerk.trim()}
            onClick={() => senden({ kein_beleg_noetig: true, vermerk })}
          >
            Vermerken
          </button>
          <button data-art="still" onClick={() => setVermerkOffen(false)}>
            Zurück
          </button>
          {fehler && (
            <span className="rueckmeldung" data-art="fehler">
              {fehler}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
