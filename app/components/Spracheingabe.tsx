"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Diktieren im Browser -- fuer den Assistenten und das Fenster "Neuer
 * Vorgang".
 *
 * Dieselbe Technik wie in der Ablage (components/Ablage.tsx): Die
 * Spracherkennung des Browsers (Safari und Chrome), kein Tonmitschnitt,
 * nichts geht an einen eigenen Dienst. Gibt es keine Erkennung -- etwa in
 * Firefox --, ist `kann` falsch und der Knopf wird gar nicht gezeigt.
 *
 * Erkannter Text wird ueber `dazu` angehaengt, Satz fuer Satz, sobald der
 * Browser ihn als endgueltig meldet.
 */

interface Erkennung {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
}

function erkennung(): (new () => Erkennung) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => Erkennung;
    webkitSpeechRecognition?: new () => Erkennung;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpracheingabe(dazu: (text: string) => void) {
  const [kann, setKann] = useState(false);
  const [hoert, setHoert] = useState(false);
  const hoerer = useRef<Erkennung | null>(null);
  const ziel = useRef(dazu);

  useEffect(() => {
    ziel.current = dazu;
  }, [dazu]);

  useEffect(() => {
    setKann(erkennung() !== null);
    return () => hoerer.current?.stop();
  }, []);

  function umschalten() {
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
      const r = e as {
        resultIndex: number;
        results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
      };
      let neu = "";
      for (let i = r.resultIndex; i < r.results.length; i += 1) {
        const t = r.results[i];
        if (t.isFinal) neu += t[0].transcript;
      }
      if (neu.trim()) ziel.current(neu.trim());
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

  function stopp() {
    hoerer.current?.stop();
  }

  return { kann, hoert, umschalten, stopp };
}
