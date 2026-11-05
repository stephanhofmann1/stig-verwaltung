"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ARTEN } from "./DokumentArten";

/**
 * Eine Datei zu einer Einheit, einem Objekt oder einem Mietverhältnis
 * hinterlegen.
 *
 * Vier Angaben, nicht mehr: Datei, Art, Bezeichnung, Haken für den Mieter.
 * Die Art steuert die Darstellung -- ein Grundriss wird groß gezeigt, ein
 * Foto kommt in die Galerie.
 *
 * Der Haken ist standardmäßig aus. Das ist keine Vorsicht um ihrer selbst
 * willen: An einem Mietverhältnis hängen Übergabeprotokolle mit Mängeln
 * und Schriftverkehr, und was davon der Mieter sieht, soll jemand
 * entschieden haben.
 */

interface Bezug {
  objekt_id?: string;
  einheit_id?: string;
  mietverhaeltnis_id?: string;
}

export function DokumentHochladen({
  bezug,
  vorgabeArt = "foto",
  hinweisMieter,
}: {
  bezug: Bezug;
  vorgabeArt?: string;
  /** Ein Satz dazu, was der Haken in diesem Zusammenhang bedeutet. */
  hinweisMieter?: string;
}) {
  const router = useRouter();
  const dateifeld = useRef<HTMLInputElement>(null);
  const [art, setArt] = useState(vorgabeArt);
  const [bezeichnung, setBezeichnung] = useState("");
  const [sichtbar, setSichtbar] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState("");
  const [erfolg, setErfolg] = useState("");
  const [offen, setOffen] = useState(false);

  async function schicke(e: React.FormEvent) {
    e.preventDefault();
    const datei = dateifeld.current?.files?.[0];
    if (!datei) {
      setFehler("Bitte eine Datei auswählen.");
      return;
    }

    const koerper = new FormData();
    koerper.set("datei", datei);
    koerper.set("art", art);
    koerper.set("bezeichnung", bezeichnung);
    if (sichtbar) koerper.set("mieter_sichtbar", "1");
    for (const [feld, wert] of Object.entries(bezug)) {
      if (wert) koerper.set(feld, wert);
    }

    setLaeuft(true);
    setFehler("");
    setErfolg("");
    const r = await fetch("/api/dokumente", { method: "POST", body: koerper });
    const d = (await r.json().catch(() => null)) as
      | { ok?: boolean; id?: string; hinweis?: string; fehler?: string }
      | null;
    setLaeuft(false);

    if (!r.ok || !d?.ok) {
      setFehler(d?.fehler ?? `Fehler ${r.status}`);
      return;
    }

    setErfolg(d.hinweis ?? "Hinterlegt.");
    setBezeichnung("");
    setSichtbar(false);
    if (dateifeld.current) dateifeld.current.value = "";
    router.refresh();
  }

  if (!offen) {
    return (
      <div className="knopfreihe">
        <button type="button" data-art="still" onClick={() => setOffen(true)}>
          Datei hinterlegen
        </button>
        {erfolg && <span className="rueckmeldung">{erfolg}</span>}
      </div>
    );
  }

  // Das Stilobjekt `feld` ist weg: .feld aus Abschnitt 12 von globals.css
  // macht dasselbe, und das Raster macht .feldraster.
  return (
    <form onSubmit={schicke}>
      <div className="feldraster">
        <label>
          Datei
          <input
            ref={dateifeld}
            type="file"
            // Nur ein Vorschlag für den Dateidialog. Entschieden wird am
            // Inhalt, im Server -- diese Liste schützt nichts.
            accept=".pdf,.png,.jpg,.jpeg,.heic,.heif,application/pdf,image/png,image/jpeg,image/heic"
            className="feld"
          />
        </label>

        <label>
          Art
          <select
            value={art}
            onChange={(e) => setArt(e.target.value)}
            className="feld"
          >
            {ARTEN.map((a) => (
              <option key={a.wert} value={a.wert}>
                {a.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Bezeichnung
          <input
            type="text"
            value={bezeichnung}
            onChange={(e) => setBezeichnung(e.target.value)}
            placeholder="Grundriss 1. OG"
            className="feld"
          />
        </label>
      </div>

      <label>
        <input
          type="checkbox"
          checked={sichtbar}
          onChange={(e) => setSichtbar(e.target.checked)}
        />{" "}
        für den Mieter sichtbar
      </label>
      <p className="hinweis">
        {hinweisMieter ??
          "Ohne Haken sieht die Datei nur die Verwaltung. Mit Haken erscheint " +
            "sie im Mieterbereich — und zwar ausschließlich bei diesem " +
            "Mietverhältnis."}
      </p>
      <p className="hinweis">
        PDF, PNG, JPEG oder HEIC, bis 25 MB. Geprüft wird der Inhalt der
        Datei, nicht ihre Endung.
      </p>

      <div className="knopfreihe">
        <button type="submit" disabled={laeuft}>
          {laeuft ? "lädt …" : "Hinterlegen"}
        </button>
        <button
          type="button"
          data-art="still"
          onClick={() => {
            setOffen(false);
            setFehler("");
          }}
        >
          Abbrechen
        </button>
        {fehler && (
          <span className="rueckmeldung" data-art="fehler">
            {fehler}
          </span>
        )}
        {erfolg && <span className="rueckmeldung">{erfolg}</span>}
      </div>
    </form>
  );
}
