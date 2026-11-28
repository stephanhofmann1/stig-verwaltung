"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Vorschlag } from "./Assistent";
import { useSpracheingabe } from "./Spracheingabe";
import { ZeichenFunkeln, ZeichenMikro, ZeichenSchliessen } from "./Zeichen";

/**
 * Das Fenster "Neuer Vorgang".
 *
 * Zwei Schritte, wie beim Verfassen in Mail mit einer Hilfe davor:
 *
 *   1. Beschreiben -- in eigenen Worten oder diktiert: "Fensterbauer
 *      ML Hauselemente anfragen, Scheibe in Zimmer 3 der Westanlage tauschen,
 *      Angebot bis Ende naechster Woche". Ein Klick auf "Mit KI ausfuellen".
 *   2. Pruefen -- Betreff, Kategorie, Haus, Einheit, Kontakt, Frist und die
 *      erste Nachricht stehen da und lassen sich aendern. "Vorgang anlegen"
 *      legt ihn an und oeffnet die Akte; die Nachricht liegt dort als
 *      Entwurf und geht erst nach der Freigabe raus.
 *
 * Wer keine KI will, nimmt "Selbst ausfuellen" und springt gleich zu 2.
 * Der Assistent oeffnet dasselbe Fenster mit seinem Vorschlag und landet
 * damit direkt bei 2.
 *
 * Geoeffnet wird ueber ein Ereignis ("neuer-vorgang") -- vom Knopf auf der
 * Vorgangsseite, aus dem Assistenten, von ueberall. Das Fenster selbst
 * haengt einmal im layout.
 */

interface Auswahl {
  objekte: Array<{ id: string; name: string }>;
  einheiten: Array<{ id: string; bezeichnung: string; objekt_id: string; objekt: string }>;
  kategorien: Array<{ wert: string; name: string }>;
  ki: boolean;
}

const LEER: Vorschlag = {
  betreff: "",
  kategorie: "sonstige",
  objekt_id: null,
  einheit_id: null,
  kontakt_id: null,
  kontakt_name: "",
  kontakt_email: "",
  frist: null,
  nachricht_betreff: "",
  nachricht_text: "",
  hinweis: "",
};

export function NeuerVorgang() {
  const router = useRouter();
  const blatt = useRef<HTMLDialogElement>(null);
  const [schritt, setSchritt] = useState<"beschreiben" | "pruefen">("beschreiben");
  const [beschreibung, setBeschreibung] = useState("");
  const [f, setF] = useState<Vorschlag>(LEER);
  const [mitKi, setMitKi] = useState(false);
  const [modell, setModell] = useState<string | null>(null);
  const [auswahl, setAuswahl] = useState<Auswahl | null>(null);
  const [laeuft, setLaeuft] = useState<"nein" | "ki" | "anlegen">("nein");
  const [fehler, setFehler] = useState<string | null>(null);

  const anhaengen = useCallback(
    (t: string) => setBeschreibung((alt) => (alt.trim() ? `${alt.trim()} ${t}` : t)),
    [],
  );
  const sprache = useSpracheingabe(anhaengen);

  const ladeAuswahl = useCallback(async () => {
    if (auswahl) return;
    try {
      const r = await fetch("/api/vorgang");
      const d = await r.json();
      if (d.ok) setAuswahl(d as Auswahl);
    } catch {
      /* das Formular geht auch ohne Listen -- nur ohne Haus und Einheit */
    }
  }, [auswahl]);

  useEffect(() => {
    function auf(e: Event) {
      const vorschlag = (e as CustomEvent<Vorschlag | null>).detail;
      setFehler(null);
      setLaeuft("nein");
      if (vorschlag) {
        setF({ ...LEER, ...vorschlag });
        setMitKi(true);
        setSchritt("pruefen");
      } else {
        setF(LEER);
        setMitKi(false);
        setModell(null);
        setBeschreibung("");
        setSchritt("beschreiben");
      }
      void ladeAuswahl();
      if (!blatt.current?.open) blatt.current?.showModal();
    }
    window.addEventListener("neuer-vorgang", auf);
    return () => window.removeEventListener("neuer-vorgang", auf);
  }, [ladeAuswahl]);

  function schliessen() {
    sprache.stopp();
    blatt.current?.close();
  }

  async function ausfuellen() {
    sprache.stopp();
    setLaeuft("ki");
    setFehler(null);
    try {
      const r = await fetch("/api/vorgang/vorschlag", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: beschreibung }),
      });
      const d = await r.json();
      if (d.ok) {
        setF({ ...LEER, ...d.entwurf });
        setMitKi(true);
        setModell(d.modell ?? null);
        setSchritt("pruefen");
      } else {
        setFehler(d.fehler ?? "Die KI hat nicht geantwortet.");
      }
    } catch {
      setFehler("Keine Verbindung zum Server.");
    } finally {
      setLaeuft("nein");
    }
  }

  async function anlegen() {
    setLaeuft("anlegen");
    setFehler(null);
    try {
      const r = await fetch("/api/vorgang", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entwurf: f, mitKi, modell }),
      });
      const d = await r.json();
      if (d.ok) {
        blatt.current?.close();
        router.push(`/vorgang/${d.id}`);
        router.refresh();
      } else {
        setFehler(d.fehler ?? "Der Vorgang konnte nicht angelegt werden.");
      }
    } catch {
      setFehler("Keine Verbindung zum Server.");
    } finally {
      setLaeuft("nein");
    }
  }

  const setze = <K extends keyof Vorschlag>(k: K, w: Vorschlag[K]) =>
    setF((alt) => ({ ...alt, [k]: w }));

  const einheiten = (auswahl?.einheiten ?? []).filter(
    (e) => !f.objekt_id || e.objekt_id === f.objekt_id,
  );
  const ohneKi = auswahl !== null && !auswahl.ki;

  return (
    <dialog
      ref={blatt}
      className="blatt"
      aria-labelledby="neuer-vorgang-titel"
      onClose={() => sprache.stopp()}
    >
      <div className="blatt-kopf">
        <h2 id="neuer-vorgang-titel">Neuer Vorgang</h2>
        <button
          type="button"
          data-art="still"
          className="assistent-zu"
          aria-label="Schließen"
          onClick={schliessen}
        >
          <ZeichenSchliessen />
        </button>
      </div>

      {schritt === "beschreiben" ? (
        <>
          <div className="blatt-inhalt">
            <label htmlFor="nv-beschreibung" className="feld">
              Worum geht es?
              <textarea
                id="nv-beschreibung"
                className="blatt-gross"
                value={beschreibung}
                onChange={(e) => setBeschreibung(e.target.value)}
                placeholder="Zum Beispiel: Fensterbauer ML Hauselemente anfragen — die Scheibe in Zimmer 3 der Westanlage 9 ist gesprungen. Angebot bis Ende nächster Woche."
                autoFocus
              />
            </label>
            <p className="hinweis">
              Die KI füllt Betreff, Kategorie, Haus, Kontakt und Frist aus und
              schreibt die erste Nachricht vor. Du prüfst alles, bevor etwas
              angelegt wird — und gesendet wird erst nach deiner Freigabe.
            </p>
            {ohneKi && (
              <div className="meldung" data-art="warnung">
                <strong>KI ist auf dem Server nicht eingerichtet</strong>
                Es fehlt der Schlüssel für das Sprachmodell. Selbst ausfüllen
                geht trotzdem.
              </div>
            )}
            {fehler && (
              <div className="meldung" data-art="fehler">
                <strong>Das hat nicht geklappt</strong>
                {fehler}
              </div>
            )}
          </div>
          <div className="blatt-fuss">
            {sprache.kann && (
              <button
                type="button"
                data-art="still"
                className="assistent-rund"
                data-hoert={sprache.hoert ? "ja" : "nein"}
                aria-label={sprache.hoert ? "Diktat beenden" : "Diktieren"}
                onClick={sprache.umschalten}
              >
                <ZeichenMikro />
              </button>
            )}
            <span className="blatt-luecke" />
            <button
              type="button"
              data-art="still"
              onClick={() => {
                setF({ ...LEER, betreff: beschreibung.split("\n")[0].slice(0, 80) });
                setMitKi(false);
                setSchritt("pruefen");
              }}
            >
              Selbst ausfüllen
            </button>
            <button
              type="button"
              onClick={() => void ausfuellen()}
              disabled={laeuft !== "nein" || !beschreibung.trim() || ohneKi}
            >
              <ZeichenFunkeln />
              {laeuft === "ki" ? "Füllt aus …" : "Mit KI ausfüllen"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="blatt-inhalt">
            {mitKi && f.hinweis && (
              <div className="meldung" data-art="info">
                <strong>Hinweis der KI</strong>
                {f.hinweis}
              </div>
            )}
            <label htmlFor="nv-betreff" className="feld">
              Betreff
              <input
                id="nv-betreff"
                className="feld"
                value={f.betreff}
                onChange={(e) => setze("betreff", e.target.value)}
                autoFocus
              />
            </label>
            <div className="feldreihe">
              <label htmlFor="nv-kategorie">
                Kategorie
                <select
                  id="nv-kategorie"
                  className="feld"
                  value={f.kategorie}
                  onChange={(e) => setze("kategorie", e.target.value)}
                >
                  {(auswahl?.kategorien ?? [{ wert: "sonstige", name: "Sonstige" }]).map((k) => (
                    <option key={k.wert} value={k.wert}>
                      {k.name}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor="nv-frist">
                Frist
                <input
                  id="nv-frist"
                  className="feld"
                  type="date"
                  value={f.frist ?? ""}
                  onChange={(e) => setze("frist", e.target.value || null)}
                />
              </label>
            </div>
            <div className="feldreihe">
              <label htmlFor="nv-objekt">
                Objekt
                <select
                  id="nv-objekt"
                  className="feld"
                  value={f.objekt_id ?? ""}
                  onChange={(e) =>
                    setF((alt) => ({
                      ...alt,
                      objekt_id: e.target.value || null,
                      einheit_id: null,
                    }))
                  }
                >
                  <option value="">—</option>
                  {(auswahl?.objekte ?? []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor="nv-einheit">
                Einheit
                <select
                  id="nv-einheit"
                  className="feld"
                  value={f.einheit_id ?? ""}
                  onChange={(e) => {
                    const id = e.target.value || null;
                    const einheit = auswahl?.einheiten.find((x) => x.id === id);
                    setF((alt) => ({
                      ...alt,
                      einheit_id: id,
                      objekt_id: einheit ? einheit.objekt_id : alt.objekt_id,
                    }));
                  }}
                >
                  <option value="">—</option>
                  {einheiten.map((e) => (
                    <option key={e.id} value={e.id}>
                      {f.objekt_id ? e.bezeichnung : `${e.bezeichnung} · ${e.objekt}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="feldreihe">
              <label htmlFor="nv-kontakt">
                Kontakt
                <input
                  id="nv-kontakt"
                  className="feld"
                  value={f.kontakt_name}
                  placeholder="Name oder Firma"
                  onChange={(e) =>
                    setF((alt) => ({ ...alt, kontakt_name: e.target.value, kontakt_id: null }))
                  }
                />
              </label>
              <label htmlFor="nv-email">
                E-Mail
                <input
                  id="nv-email"
                  className="feld"
                  type="email"
                  value={f.kontakt_email}
                  placeholder="für die erste Nachricht"
                  onChange={(e) => setze("kontakt_email", e.target.value)}
                />
              </label>
            </div>
            {f.kontakt_id && (
              <p className="hinweis blatt-kontakt">Kontakt aus dem Bestand übernommen.</p>
            )}
            {!f.kontakt_email.trim() && f.nachricht_text.trim() !== "" && (
              <p className="rueckmeldung blatt-kontakt" data-art="warn">
                Ohne E-Mail-Adresse lässt sich die Nachricht nicht per Mail senden
                — nur als Brief verwenden.
              </p>
            )}

            <h3 className="blatt-abschnitt">Erste Nachricht</h3>
            <p className="hinweis">
              Wird als Entwurf in der Akte angelegt. Gesendet wird erst nach
              deiner Freigabe. Leer lassen, wenn keine Nachricht nötig ist.
            </p>
            <label htmlFor="nv-nbetreff" className="feld">
              Betreff der Nachricht
              <input
                id="nv-nbetreff"
                className="feld"
                value={f.nachricht_betreff}
                placeholder={f.betreff || "wie der Vorgang"}
                onChange={(e) => setze("nachricht_betreff", e.target.value)}
              />
            </label>
            <label htmlFor="nv-ntext" className="feld">
              Text
              <textarea
                id="nv-ntext"
                className="blatt-gross"
                value={f.nachricht_text}
                onChange={(e) => setze("nachricht_text", e.target.value)}
              />
            </label>
            {fehler && (
              <div className="meldung" data-art="fehler">
                <strong>Das hat nicht geklappt</strong>
                {fehler}
              </div>
            )}
          </div>
          <div className="blatt-fuss">
            <button type="button" data-art="still" onClick={() => setSchritt("beschreiben")}>
              Zurück
            </button>
            <span className="blatt-luecke" />
            <button
              type="button"
              data-art="still"
              className="blatt-abbrechen"
              onClick={schliessen}
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={() => void anlegen()}
              disabled={laeuft !== "nein" || !f.betreff.trim()}
            >
              {laeuft === "anlegen" ? "Legt an …" : "Vorgang anlegen"}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}

/** Der Knopf "Neuer Vorgang" -- auf der Vorgangsseite und wo er sonst gebraucht wird. */
export function NeuerVorgangKnopf({ text = "Neuer Vorgang" }: { text?: string }) {
  return (
    <button
      type="button"
      className="neuer-vorgang-knopf"
      onClick={() => window.dispatchEvent(new CustomEvent("neuer-vorgang", { detail: null }))}
    >
      {text}
    </button>
  );
}
