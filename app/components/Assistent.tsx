"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSpracheingabe } from "./Spracheingabe";
import {
  ZeichenFunkeln,
  ZeichenMikro,
  ZeichenSchliessen,
  ZeichenSenden,
} from "./Zeichen";

/**
 * Der Assistent: ein Fenster, das von rechts hereinkommt -- ueberall in der
 * Verwaltung, ueber den Knopf in der Seitenleiste oder mit ⌘K.
 *
 * Was er kann, steht in lib/assistent.ts. Hier steht nur das Gespraech:
 * Fragen rechts in Blau wie in Nachrichten, Antworten links als Text mit
 * Verweisen in die Verwaltung. Schlaegt er einen Vorgang vor, erscheint
 * darunter eine Karte; ein Klick oeffnet das Fenster "Neuer Vorgang"
 * (components/NeuerVorgang.tsx) mit allem schon ausgefuellt.
 *
 * Das Gespraech bleibt fuer die Dauer der Sitzung im Browser
 * (sessionStorage), damit ein Seitenwechsel es nicht loescht. Auf dem
 * Server wird nichts davon gespeichert.
 */

export const OEFFNEN = "assistent-oeffnen";
const SPEICHER = "stig-assistent";

/** So sieht ein Vorschlag aus, wie er vom Server kommt (VorgangEntwurf). */
export interface Vorschlag {
  betreff: string;
  kategorie: string;
  objekt_id: string | null;
  einheit_id: string | null;
  kontakt_id: string | null;
  kontakt_name: string;
  kontakt_email: string;
  frist: string | null;
  nachricht_betreff: string;
  nachricht_text: string;
  hinweis: string;
}

interface Eintrag {
  rolle: "nutzer" | "assistent";
  text: string;
  vorschlaege?: Vorschlag[];
  fehler?: boolean;
}

const ANREGUNGEN = [
  "Was ist heute zu tun?",
  "Wer ist im Rückstand?",
  "Welche Zimmer werden bald frei?",
  "Fasse die offenen Vorgänge zusammen",
];

/** Oeffnet das Fenster "Neuer Vorgang" -- leer oder mit einem Vorschlag. */
export function oeffneNeuenVorgang(vorschlag?: Vorschlag) {
  window.dispatchEvent(new CustomEvent("neuer-vorgang", { detail: vorschlag ?? null }));
}

export function Assistent() {
  const pfad = usePathname();
  const [offen, setOffen] = useState(false);
  const [verlauf, setVerlauf] = useState<Eintrag[]>([]);
  const [eingabe, setEingabe] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const liste = useRef<HTMLDivElement>(null);
  const feld = useRef<HTMLTextAreaElement>(null);

  const anhaengen = useCallback(
    (t: string) => setEingabe((alt) => (alt.trim() ? `${alt.trim()} ${t}` : t)),
    [],
  );
  const sprache = useSpracheingabe(anhaengen);

  // Das Gespraech der Sitzung wieder aufnehmen.
  useEffect(() => {
    try {
      const roh = sessionStorage.getItem(SPEICHER);
      if (roh) setVerlauf(JSON.parse(roh) as Eintrag[]);
    } catch {
      /* ohne Speicher eben ohne Gedaechtnis */
    }
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(SPEICHER, JSON.stringify(verlauf.slice(-40)));
    } catch {
      /* siehe oben */
    }
  }, [verlauf]);

  // Oeffnen ueber den Knopf in der Navigation, ⌘K / Strg+K, Escape schliesst.
  useEffect(() => {
    const auf = () => setOffen(true);
    const taste = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOffen((v) => !v);
      } else if (e.key === "Escape") {
        setOffen(false);
      }
    };
    window.addEventListener(OEFFNEN, auf);
    document.addEventListener("keydown", taste);
    return () => {
      window.removeEventListener(OEFFNEN, auf);
      document.removeEventListener("keydown", taste);
    };
  }, []);

  useEffect(() => {
    if (offen) setTimeout(() => feld.current?.focus(), 60);
    else sprache.stopp();
    // sprache ist je Render ein neues Objekt; gemeint ist nur das Schliessen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offen]);

  // Neue Nachrichten unten sichtbar halten.
  useEffect(() => {
    liste.current?.scrollTo({ top: liste.current.scrollHeight, behavior: "smooth" });
  }, [verlauf, laeuft]);

  // Wo es keine Verwaltung gibt, gibt es auch keinen Assistenten.
  if (
    pfad === "/anmelden" ||
    pfad === "/willkommen" ||
    pfad === "/mieter" ||
    pfad.startsWith("/mieter/")
  ) {
    return null;
  }

  async function frage(text: string) {
    const frageText = text.trim();
    if (!frageText || laeuft) return;
    sprache.stopp();
    const neu: Eintrag[] = [...verlauf, { rolle: "nutzer", text: frageText }];
    setVerlauf(neu);
    setEingabe("");
    setLaeuft(true);
    try {
      const r = await fetch("/api/assistent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          verlauf: neu
            .filter((e) => !e.fehler)
            .map((e) => ({ rolle: e.rolle, text: e.text })),
        }),
      });
      const d = (await r.json().catch(() => null)) as
        | { ok: true; text: string; vorschlaege: Vorschlag[] }
        | { ok: false; fehler: string }
        | null;
      if (d && d.ok) {
        setVerlauf((v) => [...v, { rolle: "assistent", text: d.text, vorschlaege: d.vorschlaege }]);
      } else {
        setVerlauf((v) => [
          ...v,
          {
            rolle: "assistent",
            text: d && !d.ok ? d.fehler : "Der Assistent hat nicht geantwortet.",
            fehler: true,
          },
        ]);
      }
    } catch {
      setVerlauf((v) => [
        ...v,
        { rolle: "assistent", text: "Keine Verbindung zum Server.", fehler: true },
      ]);
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <>
      {offen && (
        <div className="assistent-schleier" onClick={() => setOffen(false)} aria-hidden="true" />
      )}
      <aside
        className="assistent"
        data-offen={offen ? "ja" : "nein"}
        aria-label="Assistent"
        aria-hidden={!offen}
        inert={!offen}
      >
        <header className="assistent-kopf">
          <span className="assistent-titel">
            <ZeichenFunkeln />
            Assistent
          </span>
          <span className="assistent-kopf-knoepfe">
            {verlauf.length > 0 && (
              <button
                type="button"
                data-art="still"
                className="assistent-neu"
                onClick={() => setVerlauf([])}
                disabled={laeuft}
              >
                Neues Gespräch
              </button>
            )}
            <button
              type="button"
              data-art="still"
              className="assistent-zu"
              aria-label="Assistent schließen"
              onClick={() => setOffen(false)}
            >
              <ZeichenSchliessen />
            </button>
          </span>
        </header>

        <div className="assistent-verlauf" ref={liste} aria-live="polite">
          {verlauf.length === 0 ? (
            <div className="assistent-start">
              <span className="assistent-start-zeichen" aria-hidden="true">
                <ZeichenFunkeln />
              </span>
              <p className="assistent-start-titel">Wobei kann ich helfen?</p>
              <p className="hinweis">
                Frag nach Mietern, Zahlungen, Fristen oder Vorgängen — oder
                beschreib, was angestoßen werden soll. Ich ändere nichts und
                schicke nichts ab.
              </p>
              <div className="assistent-anregungen">
                {ANREGUNGEN.map((a) => (
                  <button key={a} type="button" data-art="still" onClick={() => void frage(a)}>
                    {a}
                  </button>
                ))}
                <button
                  type="button"
                  data-art="still"
                  onClick={() => {
                    setOffen(false);
                    oeffneNeuenVorgang();
                  }}
                >
                  Neuen Vorgang anlegen
                </button>
              </div>
            </div>
          ) : (
            verlauf.map((e, i) =>
              e.rolle === "nutzer" ? (
                <p key={i} className="assistent-nutzer">
                  {e.text}
                </p>
              ) : (
                <div
                  key={i}
                  className="assistent-antwort"
                  data-fehler={e.fehler ? "ja" : undefined}
                >
                  <KiText text={e.text} beimKlick={() => setOffen(false)} />
                  {e.vorschlaege?.map((v, j) => (
                    <VorschlagKarte
                      key={j}
                      vorschlag={v}
                      oeffnen={() => {
                        setOffen(false);
                        oeffneNeuenVorgang(v);
                      }}
                    />
                  ))}
                </div>
              ),
            )
          )}
          {laeuft && (
            <div className="assistent-denkt" aria-label="Der Assistent denkt nach">
              <span />
              <span />
              <span />
            </div>
          )}
        </div>

        <form
          className="assistent-eingabe"
          onSubmit={(e) => {
            e.preventDefault();
            void frage(eingabe);
          }}
        >
          <textarea
            ref={feld}
            value={eingabe}
            rows={1}
            placeholder="Frag etwas oder beschreib einen Vorgang …"
            aria-label="Frage an den Assistenten"
            onChange={(e) => setEingabe(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void frage(eingabe);
              }
            }}
          />
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
          <button
            type="submit"
            className="assistent-rund"
            aria-label="Frage senden"
            disabled={laeuft || !eingabe.trim()}
          >
            <ZeichenSenden />
          </button>
        </form>
      </aside>
    </>
  );
}

/** Die Karte unter einer Antwort, wenn der Assistent einen Vorgang vorschlaegt. */
function VorschlagKarte({ vorschlag, oeffnen }: { vorschlag: Vorschlag; oeffnen: () => void }) {
  return (
    <div className="assistent-vorschlag">
      <span className="assistent-vorschlag-art">Vorschlag für einen neuen Vorgang</span>
      <strong>{vorschlag.betreff}</strong>
      <span className="hinweis">
        {[
          vorschlag.kontakt_name || null,
          vorschlag.frist ? `Frist ${vorschlag.frist.split("-").reverse().join(".")}` : null,
          vorschlag.nachricht_text ? "mit Entwurf der ersten Nachricht" : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
      <button type="button" onClick={oeffnen}>
        Prüfen und anlegen
      </button>
    </div>
  );
}

/**
 * Die Antwort als Text: Absaetze, Listen mit "- ", **fett** und Verweise
 * [Wort](/pfad). Mehr nicht -- und ohne HTML aus der Antwort: Was das
 * Modell schreibt, wird nie als Markup eingesetzt. Verweise nur innerhalb
 * der Verwaltung (beginnend mit "/") oder auf https.
 */
export function KiText({ text, beimKlick }: { text: string; beimKlick?: () => void }) {
  const bloecke = text.replace(/\r/g, "").split(/\n{2,}/);
  return (
    <>
      {bloecke.map((b, i) => {
        const zeilen = b.split("\n").filter((z) => z.trim() !== "");
        const liste = zeilen.length > 0 && zeilen.every((z) => /^\s*([-•*]|\d+\.)\s+/.test(z));
        if (liste) {
          const nummeriert = /^\s*\d+\./.test(zeilen[0]);
          const punkte = zeilen.map((z, j) => (
            <li key={j}>{zeile(z.replace(/^\s*([-•*]|\d+\.)\s+/, ""), beimKlick)}</li>
          ));
          return nummeriert ? <ol key={i}>{punkte}</ol> : <ul key={i}>{punkte}</ul>;
        }
        return (
          <p key={i}>
            {zeilen.map((z, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {zeile(z.replace(/^#+\s+/, ""), beimKlick)}
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}

function zeile(z: string, beimKlick?: () => void): React.ReactNode[] {
  const teile: React.ReactNode[] = [];
  const muster = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let rest = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = muster.exec(z)) !== null) {
    if (m.index > rest) teile.push(z.slice(rest, m.index));
    if (m[1] !== undefined) {
      teile.push(<strong key={n++}>{m[1]}</strong>);
    } else {
      const ziel = m[3];
      if (ziel.startsWith("/") && !ziel.startsWith("//")) {
        teile.push(
          <Link key={n++} href={ziel} onClick={beimKlick}>
            {m[2]}
          </Link>,
        );
      } else if (ziel.startsWith("https://")) {
        teile.push(
          <a key={n++} href={ziel} target="_blank" rel="noopener noreferrer">
            {m[2]}
          </a>,
        );
      } else {
        teile.push(m[2]);
      }
    }
    rest = m.index + m[0].length;
  }
  if (rest < z.length) teile.push(z.slice(rest));
  return teile;
}
