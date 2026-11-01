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
  vorschlagSollId: string | null;
  vorschlagBetrag: number;
  optionen: Option[];
}

export function PruefZeile(p: Props) {
  const router = useRouter();
  const [sollId, setSollId] = useState(p.vorschlagSollId ?? "");
  const [betrag, setBetrag] = useState(p.vorschlagBetrag.toFixed(2));
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [, start] = useTransition();

  async function bestaetigen() {
    if (!sollId) {
      setFehler("Bitte zuerst eine Sollstellung auswählen.");
      return;
    }
    setBusy(true);
    setFehler(null);
    try {
      const r = await fetch("/api/zahlungen/zuordnen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buchung_id: p.buchungId,
          soll_id: sollId,
          betrag: Number(betrag.replace(",", ".")),
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setFehler(d.fehler ?? "Zuordnung fehlgeschlagen.");
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
        <strong className="ziffern">{p.betrag}</strong>
        <span className="ziffern">{p.buchungstag}</span>
        {p.absender && <span>von {p.absender}</span>}
      </div>

      {p.verwendungszweck && (
        <p className="eintrag-text" style={{ margin: "0 0 0.75rem" }}>
          {p.verwendungszweck}
        </p>
      )}
      <p className="entwurf-notiz">{p.begruendung}</p>

      <div className="knopfreihe">
        <select
          value={sollId}
          onChange={(e) => {
            setSollId(e.target.value);
            const o = p.optionen.find((x) => x.id === e.target.value);
            if (o) setBetrag(Number(o.offen).toFixed(2));
            setFehler(null);
          }}
          aria-label="Sollstellung"
          style={{
            font: "inherit",
            fontSize: "0.9375rem",
            padding: "0.5rem",
            border: "1px solid var(--linie)",
            background: "var(--papier)",
            color: "var(--tinte)",
            maxWidth: "26rem",
            flex: "1 1 18rem",
          }}
        >
          <option value="">— Mieter und Monat wählen —</option>
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
          aria-label="Zuzuordnender Betrag"
          className="ziffern"
          style={{
            font: "inherit",
            fontSize: "0.9375rem",
            padding: "0.5rem",
            width: "7rem",
            border: "1px solid var(--linie)",
            background: "var(--papier)",
            color: "var(--tinte)",
          }}
        />

        <button onClick={bestaetigen} disabled={busy}>
          {busy ? "Bucht…" : "Zuordnen"}
        </button>
        {fehler && (
          <span className="rueckmeldung" data-art="fehler">
            {fehler}
          </span>
        )}
      </div>
    </section>
  );
}
