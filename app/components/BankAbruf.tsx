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
  | { art: "tan"; token: string; hinweis: string; medium: string | null }
  | { art: "fehler"; meldung: string };

export function BankAbruf({ zugang, name }: { zugang: string; name: string }) {
  const [stand, setStand] = useState<"bereit" | "laeuft" | "tan" | "fertig">("bereit");
  const [tanToken, setTanToken] = useState("");
  const [hinweis, setHinweis] = useState("");
  const [medium, setMedium] = useState<string | null>(null);
  const [tan, setTan] = useState("");
  const [ergebnis, setErgebnis] = useState<Schritt | null>(null);

  function verarbeite(d: Schritt) {
    setErgebnis(d);
    if (d.art === "tan") {
      setTanToken(d.token);
      setHinweis(d.hinweis);
      setMedium(d.medium);
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
            <strong>Die Bank verlangt eine TAN.</strong>
            <br />
            <span className="hinweis">{hinweis}</span>
            {medium ? (
              <>
                <br />
                <span className="hinweis">Verfahren: {medium}</span>
              </>
            ) : null}
          </p>
          {/* Feld und Knopf in der Knopfreihe: den Abstand dazwischen
              traegt deren gap, vorher stand er als marginRight im Feld. */}
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
          <p className="hinweis">
            Bei einem entkoppelten Verfahren (Push-TAN-App) genügt die
            Bestätigung in der App; dann hier eine beliebige Ziffer eintragen
            und senden.
          </p>
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
