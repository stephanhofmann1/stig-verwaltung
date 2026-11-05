"use client";

import { useId, useState } from "react";

/**
 * Ein aufklappbarer Eintrag im Register des Schaufensters.
 *
 * Zwei Stellen benutzen ihn: die fünf Abläufe und die vier Fragen. Beide
 * haben dieselbe Form — eine Zeile, die man antippt, und darunter etwas,
 * das aufgeht.
 *
 * Warum Clientkomponente: Es ist genau ein Zustand, auf und zu. Alles
 * andere auf der Seite bleibt serverseitig gerendert und steht sofort da.
 *
 * Warum kein <details>: Der Zustand muss von außen steuerbar sein, damit
 * immer nur ein Eintrag offen ist (siehe Register unten). Mit <details>
 * ginge das nur über ein name-Attribut, das ältere Browser ignorieren —
 * dann stünden drei Einträge gleichzeitig offen, und das Register wäre
 * keine Übersicht mehr.
 *
 * Das Aufklappen läuft über grid-template-rows: 0fr → 1fr (siehe
 * schaufenster.css). Der verbreitete Weg über max-height verlangt eine
 * geschätzte Höhe; schätzt man zu klein, wird abgeschnitten, schätzt man
 * zu groß, hängt die Animation am Ende. Mit dem Raster misst der Browser
 * selbst.
 */
export function Faltung({
  nummer,
  name,
  stand,
  imAufbau,
  offen,
  aufKlick,
  children,
}: {
  nummer?: string;
  name: string;
  stand?: string;
  imAufbau?: boolean;
  offen: boolean;
  aufKlick: () => void;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="s-eintrag">
      <button
        type="button"
        className="s-knauf"
        aria-expanded={offen}
        aria-controls={id}
        onClick={aufKlick}
      >
        <span className="s-nr">{nummer ?? ""}</span>
        <span className="s-name">{name}</span>
        <span className="s-rechts">
          {stand && (
            <span className="s-stand" data-art={imAufbau ? "bau" : undefined}>
              {stand}
            </span>
          )}
          <span className="s-kreuz" aria-hidden="true" />
        </span>
      </button>
      <div className="s-faltung" data-offen={offen ? "ja" : "nein"} id={id}>
        <div>
          <div className="s-inhalt">{children}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Das Register: eine Liste von Faltungen, von denen höchstens eine offen ist.
 *
 * Der Zustand liegt hier und nicht in den einzelnen Einträgen — sonst
 * wüsste keiner vom anderen. Ein zweites Antippen desselben Eintrags
 * schließt ihn wieder; das ist die Erwartung bei allem, was sich
 * aufklappen lässt.
 *
 * `zuerst` öffnet einen Eintrag beim Laden. Die Seite soll nicht als
 * Reihe geschlossener Zeilen beginnen: Wer sie zum ersten Mal sieht,
 * soll an einem Beispiel erkennen, was sich hinter den anderen verbirgt.
 */
export function Register({
  eintraege,
  zuerst = 0,
}: {
  eintraege: Array<{
    nummer?: string;
    name: string;
    stand?: string;
    imAufbau?: boolean;
    inhalt: React.ReactNode;
  }>;
  zuerst?: number;
}) {
  const [offen, setOffen] = useState<number | null>(zuerst);
  return (
    <div className="s-register">
      {eintraege.map((e, i) => (
        <Faltung
          key={e.name}
          nummer={e.nummer}
          name={e.name}
          stand={e.stand}
          imAufbau={e.imAufbau}
          offen={offen === i}
          aufKlick={() => setOffen(offen === i ? null : i)}
        >
          {e.inhalt}
        </Faltung>
      ))}
    </div>
  );
}
