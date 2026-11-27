"use client";

import { useState } from "react";

/**
 * Abruf eines FinTS-Zugangs von Hand, mit TAN-Eingabe.
 *
 * Der Ablauf hat zwei Schritte, weil die Bank dazwischen eine TAN
 * verlangen kann: erst anstoßen, dann -- falls gefragt -- die TAN
 * nachreichen. Der Dialog zur Bank bleibt in der Zwischenzeit offen.
 *
 * Die TAN wird nicht gespeichert und nicht protokolliert. Sie ist Minuten
 * gültig und gehört in keine Datenbank.
 */

type Schritt =
  | { art: "fertig"; neu: number; bekannt: number; von: string; bis: string;
      gekuerzt: boolean }
  /*
    Muss zu Schritt in lib/fints/interaktiv.ts passen. Bewusst
    nachgebaut statt importiert: Das Modul dort spricht mit Datenbank
    und Bank und hat im Browser-Buendel nichts zu suchen. Ein Test
    haelt beide Stellen zusammen.
  */
  | { art: "tan"; token: string; hinweis: string; medium: string | null;
      freigabe: boolean }
  | { art: "fehler"; meldung: string };

export function BankAbruf({ zugang, name }: { zugang: string; name: string }) {
  const [stand, setStand] = useState<"bereit" | "laeuft" | "tan" | "fertig">("bereit");
  const [tanToken, setTanToken] = useState("");
  const [hinweis, setHinweis] = useState("");
  const [medium, setMedium] = useState<string | null>(null);
  /** Verfahren ohne TAN: freigegeben wird in der App, nicht hier. */
  const [freigabe, setFreigabe] = useState(false);
  const [tan, setTan] = useState("");
  const [ergebnis, setErgebnis] = useState<Schritt | null>(null);

  function verarbeite(d: Schritt) {
    setErgebnis(d);
    if (d.art === "tan") {
      setTanToken(d.token);
      setHinweis(d.hinweis);
      setMedium(d.medium);
      setFreigabe(d.freigabe);
      setStand("tan");
    } else {
      setStand(d.art === "fertig" ? "fertig" : "bereit");
    }
  }

  async function abrufen() {
    setStand("laeuft");
    setErgebnis(null);
    const f = new FormData();
    f.set("zugang", zugang);
    const r = await fetch("/api/bank/abruf", { method: "POST", body: f });
    verarbeite((await r.json()) as Schritt);
  }

  async function tanSenden(e: React.FormEvent) {
    e.preventDefault();
    setStand("laeuft");
    const f = new FormData();
    f.set("token", tanToken);
    f.set("tan", tan);
    const r = await fetch("/api/bank/tan", { method: "POST", body: f });
    setTan("");
    verarbeite((await r.json()) as Schritt);
  }

  return (
    // .knopfreihe statt marginTop: Abstand nach oben, und die kurze
    // Rueckmeldung stellt sich von allein neben den Knopf.
    <div className="knopfreihe">
      {stand !== "tan" && (
        <button onClick={abrufen} disabled={stand === "laeuft"} data-art="still">
          {stand === "laeuft" ? "läuft …" : `${name} jetzt abrufen`}
        </button>
      )}

      {stand === "tan" && (
        <form onSubmit={tanSenden}>
          <p>
            <strong>
              {freigabe
                ? "Die Bank wartet auf Ihre Freigabe."
                : "Die Bank verlangt eine TAN."}
            </strong>
            <br />
            <span className="hinweis">{hinweis}</span>
            {medium ? (
              <>
                <br />
                <span className="hinweis">Verfahren: {medium}</span>
              </>
            ) : null}
          </p>
          {/*
            Kein Eingabefeld bei Freigabeverfahren.

            Hier stand frueher ein TAN-Feld mit dem Rat, "eine beliebige
            Ziffer" einzutragen. Der Rat ist falsch: Die Bank erwartet
            bei diesen Verfahren eine Statusabfrage, und eine Nachricht
            mit Ziffer darin ist fehlerhaft. Die Sparkasse Wetzlar
            antwortete am 27.11.2026 mit "9050 Die Nachricht enthaelt
            Fehler" -- obwohl die Freigabe auf dem Handy erteilt war.
          */}
          {freigabe ? (
            <div className="knopfreihe">
              <button type="submit" disabled={stand !== "tan"}>
                Freigabe erteilt — weiter
              </button>
            </div>
          ) : (
            <div className="knopfreihe">
              <input
                value={tan}
                onChange={(e) => setTan(e.target.value)}
                placeholder="TAN"
                autoComplete="one-time-code"
                inputMode="numeric"
                autoFocus
              />
              <button type="submit" disabled={tan.trim() === ""}>
                TAN senden
              </button>
            </div>
          )}
        </form>
      )}

      {ergebnis?.art === "fertig" && (
        <p>
          <strong>{ergebnis.neu} neue Buchungen</strong>
          {ergebnis.bekannt > 0 ? `, ${ergebnis.bekannt} schon bekannt` : ""} —
          Zeitraum {ergebnis.von} bis {ergebnis.bis}.
          {ergebnis.gekuerzt && (
            <>
              <br />
              <span className="rueckmeldung" data-art="warn">
                Der Zeitraum war länger, als ohne TAN möglich ist, und wurde
                gekürzt. Es fehlt Historie — die muss über einen Dateiexport
                nachgeholt werden.
              </span>
            </>
          )}
        </p>
      )}

      {ergebnis?.art === "fehler" && (
        <p className="rueckmeldung" data-art="fehler">
          {ergebnis.meldung}
        </p>
      )}
    </div>
  );
}
