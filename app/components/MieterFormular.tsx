"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const feld: React.CSSProperties = {
  font: "inherit",
  fontSize: "0.9375rem",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--linie)",
  background: "var(--papier)",
  color: "var(--tinte)",
  width: "100%",
};

const beschriftung: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--tinte-leise)",
  display: "block",
  marginBottom: "0.1875rem",
};

export function MieterFormular({
  einheiten,
}: {
  einheiten: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [offen, setOffen] = useState(false);
  const [w, setW] = useState({
    name: "",
    email: "",
    telefon: "",
    einheit_id: "",
    beginn: "",
    kaltmiete: "",
    nebenkosten: "",
    kaution: "",
    zahlt_im_voraus: false,
    zahlungsnotiz: "",
  });
  const [meldung, setMeldung] = useState<{ art: "ok" | "fehler"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [, start] = useTransition();

  if (einheiten.length === 0 && !offen) {
    return (
      <div className="leer">
        <strong>Keine freie Einheit</strong>
        Alle Einheiten sind belegt. Um ein Mietverhältnis zu beenden, trage
        ein Enddatum ein.
      </div>
    );
  }

  if (!offen) {
    return (
      <div className="knopfreihe" style={{ marginBottom: "1.5rem" }}>
        <button onClick={() => setOffen(true)}>Mieter eintragen</button>
      </div>
    );
  }

  async function speichern(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMeldung(null);
    try {
      const r = await fetch("/api/stammdaten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aktion: "mieter_anlegen",
          name: w.name,
          email: w.email || undefined,
          telefon: w.telefon || undefined,
          einheit_id: w.einheit_id,
          beginn: w.beginn,
          kaltmiete: w.kaltmiete ? Number(w.kaltmiete.replace(",", ".")) : undefined,
          nebenkosten: w.nebenkosten ? Number(w.nebenkosten.replace(",", ".")) : undefined,
          kaution: w.kaution ? Number(w.kaution.replace(",", ".")) : undefined,
          zahlt_im_voraus: w.zahlt_im_voraus,
          zahlungsnotiz: w.zahlungsnotiz || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMeldung({ art: "fehler", text: d.fehler ?? "Speichern fehlgeschlagen." });
        return;
      }
      setMeldung({
        art: "ok",
        text: `Eingetragen. ${d.soll?.erzeugt ?? 0} Sollstellungen erzeugt.`,
      });
      setW({ ...w, name: "", email: "", telefon: "", einheit_id: "", zahlungsnotiz: "" });
      start(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="entwurf" onSubmit={speichern}>
      <div className="entwurf-kopf">
        <strong style={{ color: "var(--tinte)" }}>Mieter eintragen</strong>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(11rem, 1fr))",
          gap: "0.75rem",
          marginBottom: "0.75rem",
        }}
      >
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={beschriftung} htmlFor="einheit">Einheit</label>
          <select
            id="einheit"
            style={feld}
            value={w.einheit_id}
            onChange={(e) => setW({ ...w, einheit_id: e.target.value })}
            required
          >
            <option value="">— wählen —</option>
            {einheiten.map((e) => (
              <option key={e.id} value={e.id}>{e.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={beschriftung} htmlFor="name">Name</label>
          <input id="name" style={feld} value={w.name}
            onChange={(e) => setW({ ...w, name: e.target.value })} required />
        </div>
        <div>
          <label style={beschriftung} htmlFor="email">E-Mail</label>
          <input id="email" style={feld} type="email" value={w.email}
            onChange={(e) => setW({ ...w, email: e.target.value })} />
        </div>
        <div>
          <label style={beschriftung} htmlFor="telefon">Telefon</label>
          <input id="telefon" style={feld} value={w.telefon}
            onChange={(e) => setW({ ...w, telefon: e.target.value })} />
        </div>
        <div>
          <label style={beschriftung} htmlFor="beginn">Mietbeginn</label>
          <input id="beginn" style={feld} type="date" value={w.beginn}
            onChange={(e) => setW({ ...w, beginn: e.target.value })} required />
        </div>
        <div>
          <label style={beschriftung} htmlFor="kalt">Kaltmiete</label>
          <input id="kalt" style={feld} inputMode="decimal" value={w.kaltmiete}
            onChange={(e) => setW({ ...w, kaltmiete: e.target.value })} />
        </div>
        <div>
          <label style={beschriftung} htmlFor="nk">Nebenkosten</label>
          <input id="nk" style={feld} inputMode="decimal" value={w.nebenkosten}
            onChange={(e) => setW({ ...w, nebenkosten: e.target.value })} />
        </div>
        <div>
          <label style={beschriftung} htmlFor="kaution">Kaution</label>
          <input id="kaution" style={feld} inputMode="decimal" value={w.kaution}
            onChange={(e) => setW({ ...w, kaution: e.target.value })} />
        </div>
      </div>

      <label style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", fontSize: "0.875rem" }}>
        <input
          type="checkbox"
          checked={w.zahlt_im_voraus}
          onChange={(e) => setW({ ...w, zahlt_im_voraus: e.target.checked })}
          style={{ marginTop: "0.25rem" }}
        />
        <span>
          Zahlt am Monatsende für den Folgemonat.
          <span style={{ color: "var(--tinte-leise)" }}>
            {" "}Ohne dieses Häkchen wird eine Zahlung vom 31. dem laufenden
            Monat zugeordnet — und es entsteht eine Scheinlücke.
          </span>
        </span>
      </label>

      <div className="knopfreihe">
        <button type="submit" disabled={busy}>
          {busy ? "Speichert…" : "Eintragen"}
        </button>
        <button type="button" data-art="still" onClick={() => setOffen(false)}>
          Schließen
        </button>
        {meldung && (
          <span className="rueckmeldung" data-art={meldung.art === "fehler" ? "fehler" : undefined}>
            {meldung.text}
          </span>
        )}
      </div>
    </form>
  );
}
