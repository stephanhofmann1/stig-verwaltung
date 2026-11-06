"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Der Entwurf im nachgebauten Posteingang — er schreibt sich selbst.
 *
 * Das ist die eine Stelle der Seite, an der etwas vorgeführt statt
 * behauptet wird: Der Besucher sieht eine Antwort entstehen, sieht
 * darunter, worauf sie beruht, und kann sie freigeben. Danach steht da,
 * was danach passiert wäre.
 *
 * Wichtig und bewusst: Hier passiert nichts Echtes. Es wird keine Mail
 * gesendet, kein Vorgang angelegt, nichts an einen Server geschickt. Der
 * Text steht fest im Quelltext.
 *
 * Das Tippen beginnt erst, wenn der Abschnitt im Bild ist. Sonst wäre es
 * vorbei, bevor jemand hinsieht — und auf einem langsamen Gerät liefe es
 * schon während des Ladens mit.
 */

const ENTWURF =
  "Guten Abend, danke für die Meldung. Ich habe den Heizungsbetrieb informiert und " +
  "melde mich bei Ihnen, sobald ein Termin steht. Falls es im Bad bis dahin zu kalt " +
  "wird, sagen Sie mir bitte kurz Bescheid.";

const ANDERS =
  "Guten Abend, danke für Ihre Nachricht. Ich kümmere mich gleich morgen früh darum " +
  "und gebe Ihnen Bescheid, sobald ich einen Termin habe.";

/** Zeichen je Schritt. Zwei liest sich flüssig, eins wirkt zäh. */
const SCHRITT = 2;
const TAKT = 16;

export function Entwurf() {
  const [text, setText] = useState("");
  const [fertig, setFertig] = useState(false);
  const [gesendet, setGesendet] = useState(false);
  const [tippt, setTippt] = useState(false);
  const kasten = useRef<HTMLDivElement>(null);

  // Wer weniger Bewegung eingestellt hat, bekommt den Text sofort.
  // matchMedia steht erst im Browser zur Verfügung, deshalb im Effekt.
  useEffect(() => {
    const ruhig = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (ruhig) {
      setText(ENTWURF);
      setFertig(true);
      return;
    }
    const el = kasten.current;
    if (!el) return;
    const beobachter = new IntersectionObserver(
      (eintraege) => {
        if (eintraege[0]?.isIntersecting) {
          setTippt(true);
          beobachter.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    beobachter.observe(el);
    return () => beobachter.disconnect();
  }, []);

  useEffect(() => {
    if (!tippt || fertig) return;
    let stelle = 0;
    const uhr = setInterval(() => {
      stelle += SCHRITT;
      if (stelle >= ENTWURF.length) {
        setText(ENTWURF);
        setFertig(true);
        clearInterval(uhr);
      } else {
        setText(ENTWURF.slice(0, stelle));
      }
    }, TAKT);
    return () => clearInterval(uhr);
  }, [tippt, fertig]);

  return (
    <div className="s-nachricht s-entwurf" ref={kasten}>
      <div className="s-wer">
        <b>Vorgeschrieben</b>
        <span>{gesendet ? "18:09 · gesendet" : "18:08 · noch nicht gesendet"}</span>
      </div>
      <p>
        {text}
        {!fertig && <span className="s-balken" aria-hidden="true" />}
      </p>

      <div className="s-grundlage">
        <b>Worauf das beruht</b>
        <u>Frühere Meldung zur selben Heizung</u> · <u>Mietverhältnis der Einheit</u> ·{" "}
        <u>Rahmenvertrag Heizungsbetrieb</u>
        <br />
        Keine Zusage, kein Betrag, keine Frist — deshalb ein Entwurf und keine Rückfrage.
      </div>

      <div className="s-steuer">
        <b>Was soll anders werden?</b>
        <em>kürzer · frag nach dem Zählerstand · freundlicher · auf Englisch</em>
        <span>
          Die Anweisung geht zusammen mit dem bisherigen Entwurf, dem Mailverlauf und den
          dauerhaften Weisungen an das Sprachmodell. Es entsteht dabei immer nur ein
          Entwurf — gesendet wird nichts, auch nicht, wenn es in der Anweisung steht.
        </span>
      </div>

      <div className="s-tasten">
        {gesendet ? (
          <span data-art="fertig">
            Gesendet — die Rückmeldung landet in diesem Vorgang
          </span>
        ) : (
          <>
            <button type="button" className="s-taste" onClick={() => setGesendet(true)}>
              Senden
            </button>
            <button
              type="button"
              className="s-taste"
              data-art="still"
              onClick={() => {
                setText(ANDERS);
                setFertig(true);
              }}
            >
              Neu erzeugen
            </button>
            <span>Ohne Ihr Zutun bleibt der Entwurf liegen</span>
          </>
        )}
      </div>
    </div>
  );
}
