"use client";

import { useState } from "react";

/**
 * Einen zweiten Mandanten anlegen -- für die private Ablage.
 *
 * WARUM HIER UND NICHT UNTER SYSTEM
 *
 * Weil die Frage hier entsteht. Wer auf dieser Seite steht und einen
 * privaten Beleg ablegen will, merkt in dem Moment, dass er damit im
 * Mandanten der eGbR landet -- in den ein Mitgesellschafter sieht. Eine
 * Einstellungsseite, auf der man vorher gewesen sein müsste, hilft
 * dabei nicht.
 *
 * Darum steht dieses Stück nur so lange da, wie es genau einen Zugang
 * gibt. Sobald es zwei sind, erscheint oben der Umschalter und dieses
 * Feld verschwindet.
 *
 * WARUM DER NAME NICHT VORGEGEBEN IST
 *
 * Das Kürzel steht später in Adressen, und es gibt keinen Weg, es zu
 * ändern. Etwas, das bleibt, soll der wählen, dem es gehört -- nicht
 * die Maschine, die es gut gemeint hat.
 */
export function MandantAnlegen({ anzahlZugaenge }: { anzahlZugaenge: number }) {
  const [offen, setOffen] = useState(false);
  const [name, setName] = useState("");
  const [kuerzel, setKuerzel] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  if (anzahlZugaenge > 1) return null;

  async function anlegen() {
    setLaeuft(true);
    setFehler(null);
    try {
      const r = await fetch("/api/mandant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, kuerzel }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setFehler(d.fehler ?? "Das Anlegen hat nicht geklappt.");
        setLaeuft(false);
        return;
      }
      // Die Route stellt das Sitzungscookie gleich auf den neuen
      // Mandanten um. Alles neu laden: Jede Seite zeigt sonst Daten des
      // alten.
      window.location.assign("/ablage");
    } catch {
      setFehler("Das Anlegen hat nicht geklappt.");
      setLaeuft(false);
    }
  }

  if (!offen) {
    return (
      <p className="hinweis">
        Diese Ablage liegt im Mandanten, in dem du gerade arbeitest — also
        auch für Mitgesellschafter sichtbar. Für eine getrennte private
        Ablage{" "}
        <button type="button" className="knopf" onClick={() => setOffen(true)}>
          einen eigenen Mandanten anlegen
        </button>
      </p>
    );
  }

  return (
    <div className="einlieferung">
      <p className="hinweis">
        Ein eigener Mandant trennt die Daten in der Datenbank — dieselbe
        Trennung, die zwischen zwei Kunden der Plattform liegt. Danach
        steht oben ein Umschalter, und du bleibst angemeldet.
      </p>
      <div className="feldreihe">
        <label className="feld" htmlFor="m-name">
          Name
          <input
            id="m-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Privat"
            maxLength={80}
          />
        </label>
        <label className="feld" htmlFor="m-kuerzel">
          Kürzel
          <input
            id="m-kuerzel"
            value={kuerzel}
            onChange={(e) => setKuerzel(e.target.value.toLowerCase())}
            placeholder="privat"
            maxLength={24}
          />
        </label>
      </div>
      <p className="hinweis">
        Kleinbuchstaben, Ziffern und Bindestriche, 2 bis 24 Zeichen. Das
        Kürzel steht später in Adressen und lässt sich nicht mehr ändern.
      </p>
      {fehler && <p className="hinweis">{fehler}</p>}
      <div className="knopfreihe">
        <button
          type="button"
          className="knopf"
          disabled={laeuft || name.trim().length < 2 || kuerzel.trim().length < 2}
          onClick={() => void anlegen()}
        >
          {laeuft ? "legt an …" : "Anlegen und hineinwechseln"}
        </button>
        <button
          type="button"
          className="knopf"
          disabled={laeuft}
          onClick={() => setOffen(false)}
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}
