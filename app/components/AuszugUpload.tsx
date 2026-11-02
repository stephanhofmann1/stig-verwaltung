"use client";

import { useState } from "react";

interface Probe {
  buchungstag: string;
  betrag: string;
  absender: string | null;
  verwendungszweck: string;
}

interface Vorschau {
  vorschau: true;
  format: string;
  kodierung: string;
  zeitraum: { von: string; bis: string } | null;
  gelesen: number;
  uebersprungen: unknown;
  warnungen: string[];
  proben: Probe[];
  summe: string;
}

interface Ergebnis {
  format: string;
  gelesen: number;
  neu: number;
  bereits_bekannt: number;
  warnungen: string[];
  zuordnung?: unknown;
}

const euro = (w: string | number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    Number(w),
  );

/**
 * Kontoauszug hochladen -- in zwei Schritten.
 *
 * Erst lesen und zeigen, dann uebernehmen. Der Grund steht in der
 * Import-Route: Aus diesen Buchungen entsteht spaeter die Entscheidung,
 * wer eine Mahnung bekommt. Ein falsch gelesener Betrag macht aus einem
 * puenktlichen Zahler einen Saeumigen. Der zweite Klick kostet wenig und
 * sorgt dafuer, dass niemand eine Datei hereinschiebt, ohne gesehen zu
 * haben, was darin erkannt wurde.
 *
 * Mehrfach dieselbe Datei hochladen ist gefahrlos: Die Buchungen haben
 * einen Fingerabdruck, Dubletten fallen in der Datenbank heraus.
 */
export function AuszugUpload({ konten }: { konten: string[] }) {
  const [konto, setKonto] = useState(konten[0] ?? "");
  const [datei, setDatei] = useState<File | null>(null);
  const [stand, setStand] = useState<"bereit" | "liest" | "schreibt">("bereit");
  const [vorschau, setVorschau] = useState<Vorschau | null>(null);
  const [ergebnis, setErgebnis] = useState<Ergebnis | null>(null);
  const [fehler, setFehler] = useState("");

  async function schicke(pruefen: boolean) {
    if (!datei || !konto) return;
    const koerper = new FormData();
    koerper.set("datei", datei);
    koerper.set("konto", konto);
    if (pruefen) koerper.set("pruefen", "1");

    setStand(pruefen ? "liest" : "schreibt");
    setFehler("");
    const r = await fetch("/api/zahlungen/import", { method: "POST", body: koerper });
    const d = await r.json().catch(() => null);
    setStand("bereit");

    if (!r.ok || !d) {
      setFehler((d && d.fehler) || `Fehler ${r.status}`);
      return;
    }
    if (pruefen) {
      setVorschau(d as Vorschau);
      setErgebnis(null);
    } else {
      setErgebnis(d as Ergebnis);
      setVorschau(null);
      setDatei(null);
    }
  }

  const erraten = vorschau && vorschau.format === "unbekannt";
  const feld = { display: "block", marginBottom: "0.75rem" };

  if (konten.length === 0) {
    return (
      <p className="hinweis">
        Erst ein Konto anlegen — der Import braucht eines, an dem die
        Buchungen hängen.
      </p>
    );
  }

  return (
    <div>
      <label>Konto
        <select
          value={konto}
          onChange={(e) => setKonto(e.target.value)}
          style={feld}
        >
          {konten.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </label>

      <label>Datei
        <input
          type="file"
          accept=".csv,.txt,.CSV,.TXT,text/csv,text/plain"
          onChange={(e) => {
            setDatei(e.target.files?.[0] ?? null);
            setVorschau(null);
            setErgebnis(null);
            setFehler("");
          }}
          style={feld}
        />
        <span className="hinweis">
          Der Umsatz-Export aus dem Onlinebanking als CSV. Sparkasse, ING,
          Volksbank und das MT940-Format werden genau erkannt; alles andere
          wird anhand der Spaltenüberschriften gelesen und ausdrücklich als
          geraten gekennzeichnet.
        </span>
      </label>

      {fehler && <p style={{ color: "#b3261e" }}>{fehler}</p>}

      {!vorschau && (
        <button
          onClick={() => schicke(true)}
          disabled={!datei || stand !== "bereit"}
        >
          {stand === "liest" ? "liest …" : "Datei lesen"}
        </button>
      )}

      {vorschau && (
        <div style={{ marginTop: "1rem" }}>
          <h3 style={{ marginBottom: "0.25rem" }}>
            Gelesen, noch nicht gespeichert
          </h3>
          <p className="hinweis" style={{ marginTop: 0 }}>
            Format <strong>{vorschau.format}</strong>, Zeichensatz{" "}
            {vorschau.kodierung}
            {vorschau.zeitraum &&
              ` · Zeitraum ${vorschau.zeitraum.von} bis ${vorschau.zeitraum.bis}`}
            {" · "}
            {vorschau.gelesen} Buchungen, Summe {euro(vorschau.summe)}
          </p>

          {erraten && (
            <p style={{ color: "#b3261e" }}>
              Dieses Format ist keines der vier bekannten. Die Spalten wurden
              geraten. Bitte an den Zeilen unten Beträge und Buchungstage
              nachsehen, bevor du übernimmst.
            </p>
          )}

          {vorschau.warnungen.map((w, i) => (
            <p key={i} style={{ color: "#8a6d00" }}>{w}</p>
          ))}

          {vorschau.proben.length > 0 && (
            <table>
              <thead>
                <tr><th>Tag</th><th>Betrag</th><th>Absender</th><th>Zweck</th></tr>
              </thead>
              <tbody>
                {vorschau.proben.map((p, i) => (
                  <tr key={i}>
                    <td>{p.buchungstag}</td>
                    <td style={{ textAlign: "right" }}>{euro(p.betrag)}</td>
                    <td>{p.absender ?? "—"}</td>
                    <td>{p.verwendungszweck}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {vorschau.gelesen > vorschau.proben.length && (
            <p className="hinweis">
              … und {vorschau.gelesen - vorschau.proben.length} weitere.
            </p>
          )}

          <p style={{ marginTop: "1rem" }}>
            <button onClick={() => schicke(false)} disabled={stand !== "bereit"}>
              {stand === "schreibt" ? "übernimmt …" : "Übernehmen"}
            </button>{" "}
            <button
              type="button"
              data-art="still"
              onClick={() => setVorschau(null)}
            >
              Verwerfen
            </button>
          </p>
        </div>
      )}

      {ergebnis && (
        <div style={{ marginTop: "1rem" }}>
          <p style={{ color: "#1b6b3a" }}>
            Übernommen: {ergebnis.neu} neue Buchungen
            {ergebnis.bereits_bekannt > 0 &&
              `, ${ergebnis.bereits_bekannt} waren schon da`}
            .
          </p>
          {ergebnis.warnungen.map((w, i) => (
            <p key={i} style={{ color: "#8a6d00" }}>{w}</p>
          ))}
          <p className="hinweis">
            Die eindeutigen Zahlungen sind bereits zugeordnet. Der Rest liegt
            unter <a href="/zahlungen">Zahlungen</a> zur Prüfung.
          </p>
        </div>
      )}
    </div>
  );
}
