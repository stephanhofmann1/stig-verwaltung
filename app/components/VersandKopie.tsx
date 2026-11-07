"use client";

import { useState } from "react";

/**
 * Die stille Kopie jeder ausgehenden Mail einstellen.
 *
 * WARUM AUF DER WEISUNGSSEITE
 *
 * Weil hier steht, wie das Portal nach außen schreibt. Die Weisungen
 * bestimmen den Inhalt, diese Adresse bestimmt, wer eine Kopie davon
 * bekommt -- beides gehört in denselben Blick. Eine eigene
 * Einstellungsseite hätte das Menü verlängert, über das sich schon
 * einmal jemand beschwert hat.
 *
 * WARUM DER UNTERSCHIED ZWISCHEN LEER UND NICHT GESETZT SICHTBAR IST
 *
 * "Nicht gesetzt" heißt: Es greift die Einstellung der Installation.
 * "Leer" heißt: ausdrücklich keine Kopie. Wer den Unterschied nicht
 * sieht, trägt eine Adresse ein, die schon wirkt, oder löscht eine und
 * wundert sich, dass weiter Kopien kommen.
 */
export function VersandKopie({
  anfang,
  darfSchreiben,
}: {
  /** Was am Mandanten steht. null heißt "nicht gesetzt". */
  anfang: string | null;
  darfSchreiben: boolean;
}) {
  const [adresse, setAdresse] = useState(anfang ?? "");
  const [gesetzt, setGesetzt] = useState(anfang !== null);
  const [stand, setStand] = useState<"bereit" | "laeuft" | "gespeichert">(
    "bereit",
  );
  const [fehler, setFehler] = useState("");

  async function speichern() {
    setStand("laeuft");
    setFehler("");
    const koerper = new FormData();
    koerper.set("adresse", adresse);
    try {
      const r = await fetch("/api/mandant/kopie", {
        method: "POST",
        body: koerper,
      });
      const d = (await r.json()) as { fehler?: string; adresse?: string | null };
      if (!r.ok) {
        setFehler(d.fehler ?? "Das Speichern hat nicht geklappt.");
        setStand("bereit");
        return;
      }
      setGesetzt(true);
      setStand("gespeichert");
    } catch {
      setFehler("Das Speichern hat nicht geklappt.");
      setStand("bereit");
    }
  }

  return (
    <div className="abschnitt">
      <h2>Kopie jeder ausgehenden Mail</h2>
      <p className="hinweis">
        Jede Mail, die dieses Portal verschickt, geht zusätzlich verdeckt
        (BCC) an diese Adresse. Nur so lässt sich im eigenen Postfach
        nachvollziehen, dass sie wirklich hinausgegangen ist. Der Empfänger
        sieht die Kopie nicht.
      </p>
      <p className="hinweis">
        Die Adresse darf nicht dieselbe sein, über die Mails in das Portal
        hereinkommen — sonst käme jede ausgehende Mail als neue eingehende
        wieder herein.
      </p>

      {!darfSchreiben ? (
        <p className="hinweis">
          Eingetragen ist{" "}
          {gesetzt
            ? adresse
              ? <strong>{adresse}</strong>
              : "ausdrücklich keine Kopie"
            : "nichts — es gilt die Einstellung der Installation"}
          . Geändert wird das von der Verwaltung.
        </p>
      ) : (
        <>
          <label className="feld" htmlFor="kopie-adresse">
            E-Mail-Adresse für die Kopie
            <input
              id="kopie-adresse"
              type="email"
              value={adresse}
              placeholder="leer lassen schaltet die Kopie ab"
              onChange={(e) => {
                setAdresse(e.target.value);
                setStand("bereit");
              }}
            />
          </label>
          {!gesetzt && (
            <p className="hinweis">
              Derzeit steht hier nichts: Es gilt die Einstellung der
              Installation. Mit dem Speichern entscheidet dieser Mandant es
              selbst — auch wenn das Feld leer bleibt.
            </p>
          )}
          {fehler && (
            <div className="rueckmeldung" data-art="fehler">
              {fehler}
            </div>
          )}
          {stand === "gespeichert" && (
            <div className="rueckmeldung" data-art="gut">
              {adresse
                ? `Gespeichert. Die nächste Mail geht zusätzlich an ${adresse}.`
                : "Gespeichert. Es geht keine Kopie mehr hinaus."}
            </div>
          )}
          <div className="knopfreihe">
            <button
              type="button"
              className="knopf"
              disabled={stand === "laeuft"}
              onClick={() => void speichern()}
            >
              {stand === "laeuft" ? "speichert …" : "Speichern"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
