"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Beleg ablegen: Datei, ein gesprochener Satz, Vorschlag ansehen,
 * übernehmen.
 *
 * WARUM SPRACHE
 *
 * Weil ein Formular mit acht Feldern dazu führt, dass Belege liegen
 * bleiben. Was auf einer Quittung nicht steht -- wofür die Ausgabe war,
 * warum es keine Rechnung gibt --, ist in einem Satz gesagt und in acht
 * Feldern eine Arbeit.
 *
 * Die Erkennung läuft im Browser (SpeechRecognition). Kein Tonmitschnitt
 * verlässt das Gerät; was hochgeladen wird, ist der erkannte TEXT. Wer
 * nicht sprechen will oder einen Browser ohne Erkennung hat, tippt in
 * dasselbe Feld -- es ist ein gewöhnliches Textfeld, der Knopf füllt es
 * nur.
 *
 * WARUM ERST ANSEHEN, DANN ÜBERNEHMEN
 *
 * Weil hier ein Sprachmodell einordnet, und ein Sprachmodell erfindet
 * Zahlen, wenn es keine findet. Der erste Druck zeigt nur, was
 * herauskommen würde; gespeichert wird erst auf den zweiten. Die Zeile
 * „woher die Werte kommen" steht dabei, damit sichtbar ist, was im
 * Dokument stand und was nur gesagt wurde.
 */

interface Vorschlag {
  aussteller: string | null;
  zweck: string | null;
  belegdatum: string | null;
  betrag_brutto: number | null;
  art: string;
  kostenart: string | null;
  eigenbeleg_grund: string | null;
  gezahlt_mit: string | null;
  quelle: string[];
  abweichung: string | null;
  offen: string[];
  belegnummer: string | null;
  dateiname: string | null;
  ohne_textebene: boolean;
}

interface Antwort {
  gespeichert: boolean;
  beleg_id?: string;
  vorschlag?: Vorschlag;
  auswertung?: { modell?: string; unklar?: string[]; fehler?: string };
  fehler?: string;
  offen?: string[];
}

const euro = (w: number | null) =>
  w === null
    ? "—"
    : new Intl.NumberFormat("de-DE", {
        style: "currency",
        currency: "EUR",
      }).format(w);

const tag = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("de-DE") : "—";

const ARTEN: Record<string, string> = {
  rechnung: "Rechnung",
  quittung: "Quittung",
  gutschrift: "Gutschrift",
  eigenbeleg: "Eigenbeleg",
  sonstige: "sonstiger Beleg",
};

/** Die Spracherkennung des Browsers, falls es eine gibt. */
function erkennung(): (new () => SpeechRecognitionAehnlich) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionAehnlich;
    webkitSpeechRecognition?: new () => SpeechRecognitionAehnlich;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface SpeechRecognitionAehnlich {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
}

export function Ablage() {
  const [diktat, setDiktat] = useState("");
  const [hoert, setHoert] = useState(false);
  const [kannSprache, setKannSprache] = useState(false);
  const [laeuft, setLaeuft] = useState<"nein" | "ansehen" | "ablegen">("nein");
  const [antwort, setAntwort] = useState<Antwort | null>(null);
  const feld = useRef<HTMLInputElement>(null);
  const hoerer = useRef<SpeechRecognitionAehnlich | null>(null);

  useEffect(() => {
    setKannSprache(erkennung() !== null);
    return () => hoerer.current?.stop();
  }, []);

  function sprichUmschalten() {
    if (hoert) {
      hoerer.current?.stop();
      return;
    }
    const Klasse = erkennung();
    if (!Klasse) return;
    const h = new Klasse();
    h.lang = "de-DE";
    h.continuous = true;
    h.interimResults = false;
    h.onresult = (e: unknown) => {
      // Nur die endgueltigen Stuecke anhaengen. Zwischenergebnisse
      // wuerden den Text waehrend des Sprechens umschreiben.
      const r = e as {
        resultIndex: number;
        results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
      };
      let neu = "";
      for (let i = r.resultIndex; i < r.results.length; i += 1) {
        const t = r.results[i];
        if (t.isFinal) neu += t[0].transcript;
      }
      if (neu.trim()) {
        setDiktat((alt) => (alt ? `${alt.trim()} ${neu.trim()}` : neu.trim()));
      }
    };
    h.onerror = () => setHoert(false);
    h.onend = () => setHoert(false);
    hoerer.current = h;
    try {
      h.start();
      setHoert(true);
    } catch {
      setHoert(false);
    }
  }

  async function schicke(uebernehmen: boolean) {
    hoerer.current?.stop();
    setLaeuft(uebernehmen ? "ablegen" : "ansehen");
    const koerper = new FormData();
    const f = feld.current?.files?.[0];
    if (f) koerper.set("datei", f);
    koerper.set("diktat", diktat);
    if (uebernehmen) koerper.set("uebernehmen", "1");
    try {
      const r = await fetch("/api/ablage", { method: "POST", body: koerper });
      const d = (await r.json()) as Antwort;
      setAntwort(d);
      if (d.gespeichert) {
        setDiktat("");
        if (feld.current) feld.current.value = "";
      }
    } catch {
      setAntwort({ gespeichert: false, fehler: "Das hat nicht geklappt." });
    } finally {
      setLaeuft("nein");
    }
  }

  const v = antwort?.vorschlag;

  return (
    <div className="einlieferung">
      <div className="knopfreihe">
        <input
          ref={feld}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,image/*,application/pdf"
          aria-label="Beleg als Datei"
        />
      </div>

      <label className="feld" htmlFor="diktat">
        Was war das? Einfach sagen oder tippen.
        <textarea
          id="diktat"
          rows={3}
          value={diktat}
          onChange={(e) => setDiktat(e.target.value)}
          placeholder="Zum Beispiel: Pizzaschneider für die Gemeinschaftsküche, bar bei einem Privatverkäufer gekauft, deshalb keine Rechnung."
        />
      </label>

      <div className="knopfreihe">
        {kannSprache && (
          <button
            type="button"
            className="knopf"
            onClick={sprichUmschalten}
            aria-pressed={hoert}
          >
            {hoert ? "Aufnahme beenden" : "Sprechen"}
          </button>
        )}
        <button
          type="button"
          className="knopf"
          disabled={laeuft !== "nein"}
          onClick={() => void schicke(false)}
        >
          {laeuft === "ansehen" ? "liest …" : "Ansehen"}
        </button>
        {v && !antwort?.gespeichert && (
          <button
            type="button"
            className="knopf"
            disabled={laeuft !== "nein"}
            onClick={() => void schicke(true)}
          >
            {laeuft === "ablegen" ? "legt ab …" : "So ablegen"}
          </button>
        )}
        {hoert && <span className="still">hört zu …</span>}
      </div>

      {!kannSprache && (
        <p className="hinweis">
          Dieser Browser hat keine Spracherkennung. Das Feld lässt sich
          tippen; am Ergebnis ändert das nichts.
        </p>
      )}

      {antwort?.fehler && <p className="hinweis">{antwort.fehler}</p>}

      {antwort?.gespeichert && (
        <p className="hinweis">
          Abgelegt. {v?.art === "eigenbeleg" ? "Als Eigenbeleg — " : ""}
          <a href={`/api/belege/${antwort.beleg_id}/datei`}>Beleg ansehen</a>
        </p>
      )}

      {v && (
        <div className="register">
          <div className="posten">
            <div className="posten-kopf">
              <span className="ziffern">{euro(v.betrag_brutto)}</span>
              <span className="still">{tag(v.belegdatum)}</span>
              <span className="marker">{ARTEN[v.art] ?? v.art}</span>
            </div>
            <div>
              <strong>{v.aussteller ?? "Empfänger unbekannt"}</strong>
              {v.zweck ? ` · ${v.zweck}` : ""}
            </div>
            {v.kostenart && <div className="still">Kostenart: {v.kostenart}</div>}
            {v.gezahlt_mit && <div className="still">Bezahlt mit: {v.gezahlt_mit}</div>}
            {v.eigenbeleg_grund && (
              <div className="still">Kein Fremdbeleg, weil: {v.eigenbeleg_grund}</div>
            )}

            {/* Woher die Werte kommen. Ohne diese Zeile waere nicht
                unterscheidbar, was im Dokument stand und was nur
                gesagt wurde. */}
            {v.quelle.length > 0 && (
              <div className="hinweis">{v.quelle.join(" · ")}</div>
            )}

            {v.abweichung && (
              <div className="hinweis">
                Regelwerk und Auswertung sind sich nicht einig —{" "}
                {v.abweichung}. Der Beleg wird abgelegt und markiert; der
                selbsttätige Abgleich lässt ihn dann liegen.
              </div>
            )}

            {v.ohne_textebene && (
              <div className="hinweis">
                Die Datei hat keine Textebene (Foto oder Scan). Betrag und
                Datum stammen dann allein aus dem Gesagten.
              </div>
            )}

            {v.offen.length > 0 && (
              <div className="hinweis">
                Noch offen: {v.offen.join(", ")}.
                {v.art === "eigenbeleg"
                  ? " Ein Eigenbeleg wird ohne diese Angaben nicht abgelegt."
                  : " Das lässt sich später am Beleg nachtragen."}
              </div>
            )}

            {antwort?.auswertung?.unklar && antwort.auswertung.unklar.length > 0 && (
              <div className="hinweis">
                Die Auswertung war sich unsicher bei:{" "}
                {antwort.auswertung.unklar.join(", ")}.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
