"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const feld: React.CSSProperties = {
  font: "inherit",
  fontSize: "0.9375rem",
  padding: "0.5rem 0.625rem",
  width: "100%",
  border: "1px solid var(--linie)",
  background: "#fff",
  color: "var(--tinte)",
  marginBottom: "0.75rem",
};

export function AnmeldeFormular({ weiter }: { weiter: string }) {
  const router = useRouter();
  const [benutzer, setBenutzer] = useState("");
  const [passwort, setPasswort] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function absenden(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFehler(null);
    try {
      const r = await fetch("/api/anmelden", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ benutzer, passwort }),
      });
      const d = await r.json();
      if (!r.ok) {
        setFehler(d.fehler ?? "Anmeldung fehlgeschlagen.");
        return;
      }
      router.replace(weiter);
      router.refresh();
    } catch {
      setFehler("Der Server ist nicht erreichbar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={absenden}>
      <label htmlFor="benutzer" style={{ fontSize: "0.875rem" }}>
        Benutzer
      </label>
      <input
        id="benutzer"
        style={feld}
        value={benutzer}
        onChange={(e) => setBenutzer(e.target.value)}
        autoComplete="username"
        autoFocus
      />
      <label htmlFor="passwort" style={{ fontSize: "0.875rem" }}>
        Passwort
      </label>
      <input
        id="passwort"
        style={feld}
        type="password"
        value={passwort}
        onChange={(e) => setPasswort(e.target.value)}
        autoComplete="current-password"
      />
      <div className="knopfreihe">
        <button type="submit" disabled={busy}>
          {busy ? "Prüft…" : "Anmelden"}
        </button>
        {fehler && (
          <span className="rueckmeldung" data-art="fehler">
            {fehler}
          </span>
        )}
      </div>
    </form>
  );
}
