"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Herkunft, type HerkunftDaten, type WeisungAnzeige, type UebergangenAnzeige } from "@/components/Herkunft";
import {
  EntwurfAnweisung,
  type FassungAnzeige,
} from "@/components/EntwurfAnweisung";
import { Anhaenge } from "@/components/Anhaenge";

/**
 * Ein Entwurf in der Freigabe und in der Vorgangsakte.
 *
 * WAS AM 03.11.2026 DAZUKOMMT
 *
 * Die Karte zeigte den Text, eine Notiz und zwei Knoepfe. Woher der Text
 * stammt, stand nicht da, und steuern liess sich nichts. Jetzt stehen
 * hier drei Dinge mehr: die Herkunft (Herkunft.tsx), das Anweisungsfeld
 * samt Fassungshistorie (EntwurfAnweisung.tsx) und -- wenn Dauerweisungen
 * gewirkt haben -- welche das waren.
 *
 * WARUM DIE KARTE DIE HERKUNFT SELBST HOLT
 *
 * Dieselbe Karte steht an zwei Stellen: in der Freigabeliste
 * (components/FreigabeListe.tsx) und in der Vorgangsakte
 * (app/vorgang/[id]/page.tsx). Beide brauchen dieselbe Auskunft. Sie als
 * Prop durchzureichen hiesse, sie an zwei Orten zu laden und an zwei
 * Orten richtig zu halten -- und eine der beiden Darstellungen waere
 * irgendwann falsch. Deshalb ein Abruf von GET /api/entwurf/[id] beim
 * Erscheinen der Karte: ein Weg, eine Antwort.
 *
 * Alle neuen Eigenschaften sind freiwillig. Die Karte wird aus einer
 * Seite gerendert, die nicht zu dieser Aenderung gehoert; eine neue
 * Pflichteigenschaft haette sie zerbrochen.
 */

interface Props {
  id: string;
  betreff: string;
  koerper: string;
  empfaenger: string[];
  verfasstVon: "agent" | "mensch" | null;
  notiz: string | null;
  /** Zeigt zusätzlich den Vorgang an — für die Freigabe-Liste. */
  vorgang?: { nummer: number; betreff: string; id: string } | null;
  /**
   * Serverseitig geladene Herkunft. Wird sie mitgegeben, erscheint sie
   * sofort; ohne sie holt die Karte sie selbst.
   */
  herkunft?: HerkunftDaten | null;
}

interface Steuerung {
  herkunft: HerkunftDaten;
  fassungen: FassungAnzeige[];
  weisungen: WeisungAnzeige[];
  weisungen_uebergangen: UebergangenAnzeige[];
}

export function EntwurfKarte(p: Props) {
  const router = useRouter();
  const [text, setText] = useState(p.koerper);
  /**
   * Der Text, gegen den "geaendert" gemessen wird.
   *
   * Nicht p.koerper: Nach einer Nacherzeugung steht ein neuer Text im
   * Feld, der schon gespeichert ist. Gegen p.koerper gemessen waere er
   * "geaendert", und die Karte wuerde ihn beim Senden erneut speichern
   * und als Handfassung in die Historie schreiben -- eine Fassung, die
   * niemand geschrieben hat.
   */
  const [gespeichert, setGespeichert] = useState(p.koerper);
  const [meldung, setMeldung] = useState<{ art: "ok" | "fehler"; text: string } | null>(null);
  const [laeuft, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [steuerung, setSteuerung] = useState<Steuerung | null>(null);

  const geaendert = text !== gespeichert;

  /**
   * Holt die Herkunft -- und setzt nichts.
   *
   * Das Trennen von Holen und Setzen ist kein Selbstzweck: Der Aufruf
   * steht einmal in einem Effekt und einmal in einem Klick, und ein
   * setState unmittelbar im Effektkoerper loest Folgedarstellungen aus
   * (react-hooks/set-state-in-effect). Gesetzt wird deshalb im
   * Rueckruf, nicht im Effekt.
   *
   * Ohne Herkunft ist die Karte weniger wert, aber nicht kaputt:
   * Freigeben und Verwerfen muessen auch dann gehen, wenn diese Auskunft
   * nicht kommt. Deshalb null statt eines Fehlers.
   */
  const lade = useCallback(async (): Promise<Steuerung | null> => {
    try {
      const r = await fetch(`/api/entwurf/${p.id}`);
      if (!r.ok) return null;
      const d = (await r.json()) as Steuerung & { ok?: boolean };
      if (!d.ok) return null;
      return {
        herkunft: d.herkunft,
        fassungen: d.fassungen ?? [],
        weisungen: d.weisungen ?? [],
        weisungen_uebergangen: d.weisungen_uebergangen ?? [],
      };
    } catch {
      return null;
    }
  }, [p.id]);

  useEffect(() => {
    // `aktuell` fangt den Fall ab, dass die Karte schon weg ist, wenn die
    // Antwort kommt -- nach einem Versand raeumt router.refresh() die
    // Liste neu auf, und die Abfrage laeuft noch.
    let aktuell = true;
    void lade().then((d) => {
      if (aktuell && d) setSteuerung(d);
    });
    return () => {
      aktuell = false;
    };
  }, [lade]);

  async function speichern() {
    const r = await fetch(`/api/entwurf/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ koerper: text }),
    });
    return r.ok;
  }

  async function senden() {
    setBusy(true);
    setMeldung(null);
    try {
      if (geaendert) {
        const ok = await speichern();
        if (!ok) {
          setMeldung({ art: "fehler", text: "Änderung konnte nicht gespeichert werden." });
          return;
        }
        setGespeichert(text);
      }
      const r = await fetch(`/api/entwurf/${p.id}`, { method: "POST" });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        setMeldung({ art: "fehler", text: d.fehler ?? "Versand fehlgeschlagen." });
        return;
      }
      setMeldung({ art: "ok", text: "Gesendet." });
      start(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  async function verwerfen() {
    setBusy(true);
    try {
      await fetch(`/api/entwurf/${p.id}`, { method: "DELETE" });
      start(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  const daten = steuerung?.herkunft ?? p.herkunft ?? null;

  return (
    <section className="entwurf">
      <div className="entwurf-kopf">
        {p.vorgang && (
          <a href={`/vorgang/${p.vorgang.id}`}>
            <strong className="ziffern">
              {String(p.vorgang.nummer).padStart(4, "0")}
            </strong>{" "}
            {p.vorgang.betreff}
          </a>
        )}
        <span>An: {p.empfaenger.join(", ")}</span>
        <span>{p.betreff}</span>
        {p.verfasstVon === "agent" && (
          <span className="marker" data-art="agent">
            vorgeschrieben
          </span>
        )}
        {/* Die Quelle gehoert in den Kopf und nicht nur ins Aufklappbare:
            "vorgeschrieben" sagte bisher nicht, ob ein Textbaustein oder
            ein Sprachmodell geschrieben hat -- und das ist der
            Unterschied, der beim Gegenlesen zaehlt. */}
        {daten?.entwurf_quelle === "modell" && (
          <span className="marker" data-art="info">
            Sprachmodell
          </span>
        )}
        {daten?.entwurf_quelle === "regel" && (
          <span className="marker">Textbaustein</span>
        )}
        {steuerung && steuerung.fassungen.length > 1 && (
          <span className="marker ziffern">
            Fassung {daten?.entwurf_fassung_nr ?? steuerung.fassungen.length}
          </span>
        )}
      </div>

      {p.notiz && <p className="entwurf-notiz">{p.notiz}</p>}

      {daten && (
        <Herkunft
          daten={daten}
          weisungen={steuerung?.weisungen ?? []}
          uebergangen={steuerung?.weisungen_uebergangen ?? []}
        />
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck
        aria-label="Entwurfstext"
      />

      {/* Die Anhaenge stehen zwischen Text und Knoepfen: Wer gegenliest,
          soll sie sehen, bevor er auf "Senden" klickt -- und nicht
          darunter, wo sie beim Ueberfliegen wegfallen. */}
      <Anhaenge nachrichtId={p.id} aenderbar blockiert={busy || laeuft} />

      <div className="knopfreihe">
        <button onClick={senden} disabled={busy || laeuft}>
          {busy ? "Sendet…" : "Senden"}
        </button>
        <button data-art="still" onClick={verwerfen} disabled={busy || laeuft}>
          Verwerfen
        </button>
        {geaendert && !meldung && (
          <span className="rueckmeldung">Geändert — wird beim Senden übernommen.</span>
        )}
        {meldung && (
          <span className="rueckmeldung" data-art={meldung.art === "fehler" ? "fehler" : undefined}>
            {meldung.text}
          </span>
        )}
      </div>

      {/* Das Anweisungsfeld steht UNTER den Knoepfen und nicht darueber:
          Der haeufigste Fall bleibt Gegenlesen und Freigeben. Wer etwas
          aendern will, liest ohnehin weiter. */}
      {steuerung && (
        <EntwurfAnweisung
          id={p.id}
          fassungen={steuerung.fassungen}
          weisungen={steuerung.weisungen}
          blockiert={busy || laeuft}
          uebernehmen={(neuerText, fassungen) => {
            setText(neuerText);
            // Der neue Text ist serverseitig schon gespeichert. Ohne diese
            // Zeile hielte die Karte ihn fuer eine ungespeicherte
            // Aenderung.
            setGespeichert(neuerText);
            setSteuerung((s) => (s ? { ...s, fassungen } : s));
            // Die Herkunft hat sich mitgeaendert (Quelle, Modell,
            // Fassungsnummer). Nachladen statt im Browser nachzurechnen.
            void lade().then((d) => d && setSteuerung(d));
          }}
        />
      )}
    </section>
  );
}
