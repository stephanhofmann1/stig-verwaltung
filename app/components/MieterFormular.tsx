"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/*
 * Hier standen zwei Stilobjekte (`feld` und `beschriftung`). Sie sind
 * ersatzlos weg: Abschnitt 12 von globals.css gestaltet label, input und
 * select vollstaendig. Die Objekte arbeiteten ausserdem gegen das System --
 * sie setzten die Altmarke fuer den SEITENhintergrund als Feldfarbe und
 * ueberschrieben den kraeftigen Feldrand mit der Haarlinie. Ergebnis waren
 * graue Felder mit kaum sichtbarem Rand, obwohl das Stylesheet weisse mit
 * 3:1-Rand vorsieht. Breite ueber die ganze Spalte macht jetzt .feld.
 */

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
      <div className="knopfreihe">
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
        <strong>Mieter eintragen</strong>
      </div>

      {/* Die Einheit stand als gridColumn: "1 / -1" im Raster. Dafuer
          gibt es keine Klasse -- und sie braucht auch keine: ueber dem
          Raster nimmt das Feld von allein die ganze Breite. */}
      <label htmlFor="einheit">
        Einheit
        <select
          id="einheit"
          className="feld"
          value={w.einheit_id}
          onChange={(e) => setW({ ...w, einheit_id: e.target.value })}
          required
        >
          <option value="">— wählen —</option>
          {einheiten.map((e) => (
            <option key={e.id} value={e.id}>{e.label}</option>
          ))}
        </select>
      </label>

      <div className="feldraster">
        <label htmlFor="name">
          Name
          <input id="name" className="feld" value={w.name}
            onChange={(e) => setW({ ...w, name: e.target.value })} required />
        </label>
        <label htmlFor="email">
          E-Mail
          <input id="email" className="feld" type="email" value={w.email}
            onChange={(e) => setW({ ...w, email: e.target.value })} />
        </label>
        <label htmlFor="telefon">
          Telefon
          <input id="telefon" className="feld" value={w.telefon}
            onChange={(e) => setW({ ...w, telefon: e.target.value })} />
        </label>
        <label htmlFor="beginn">
          Mietbeginn
          <input id="beginn" className="feld" type="date" value={w.beginn}
            onChange={(e) => setW({ ...w, beginn: e.target.value })} required />
        </label>
        <label htmlFor="kalt">
          Kaltmiete
          <input id="kalt" className="feld" inputMode="decimal" value={w.kaltmiete}
            onChange={(e) => setW({ ...w, kaltmiete: e.target.value })} />
        </label>
        <label htmlFor="nk">
          Nebenkosten
          <input id="nk" className="feld" inputMode="decimal" value={w.nebenkosten}
            onChange={(e) => setW({ ...w, nebenkosten: e.target.value })} />
        </label>
        <label htmlFor="kaution">
          Kaution
          <input id="kaution" className="feld" inputMode="decimal" value={w.kaution}
            onChange={(e) => setW({ ...w, kaution: e.target.value })} />
        </label>
      </div>

      <label>
        <input
          type="checkbox"
          checked={w.zahlt_im_voraus}
          onChange={(e) => setW({ ...w, zahlt_im_voraus: e.target.checked })}
        />{" "}
        Zahlt am Monatsende für den Folgemonat.
        <span className="hinweis">
          {" "}Ohne dieses Häkchen wird eine Zahlung vom 31. dem laufenden
          Monat zugeordnet — und es entsteht eine Scheinlücke.
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
