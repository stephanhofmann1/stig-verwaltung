"use client";

import { useState } from "react";

/**
 * Einen eingerichteten Bankzugang ändern oder entfernen.
 *
 * Bis hierher konnte die Oberfläche einen Zugang nur anlegen. Ein
 * Tippfehler im Anmeldenamen oder eine verwechselte PIN liess sich
 * danach nicht mehr korrigieren -- man sah den falschen Zugang in der
 * Liste stehen und kam nicht heran. Das ist der Fall, der beim
 * Einrichten am ehesten eintritt, und ausgerechnet der war nicht
 * vorgesehen.
 *
 * Die PIN bleibt leer, wenn sie nicht geändert werden soll. Sie wird
 * nicht vorbefüllt, auch nicht verdeckt: Was hier nicht steht, kann der
 * Browser nicht ausfüllen, nicht speichern und nicht weitergeben.
 */
export function BankZugangPflegen({
  id,
  bezeichnung,
  benutzer,
  url,
  kundenId,
  kontoIban,
  ruht,
}: {
  id: string;
  bezeichnung: string;
  benutzer: string;
  url: string;
  kundenId: string | null;
  kontoIban: string | null;
  /** Zugang wurde nach einem Fehler an den Zugangsdaten stillgelegt. */
  ruht: boolean;
}) {
  const [offen, setOffen] = useState(false);
  const [stand, setStand] = useState<"bereit" | "laeuft">("bereit");
  const [fehler, setFehler] = useState("");
  const [loeschFrage, setLoeschFrage] = useState(false);

  async function speichern(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setStand("laeuft");
    setFehler("");
    const koerper = new FormData(form);
    koerper.set("id", id);
    const r = await fetch("/api/bank", { method: "PATCH", body: koerper });
    const d = (await r.json().catch(() => ({}))) as
      { ok?: boolean; fehler?: string };
    setStand("bereit");
    if (d.ok) {
      // Die PIN aus dem Formular nehmen, bevor die Seite neu lädt.
      form.reset();
      window.location.reload();
    } else {
      setFehler(d.fehler ?? "Das hat nicht geklappt.");
    }
  }

  async function loeschen() {
    setStand("laeuft");
    setFehler("");
    const r = await fetch(
      `/api/bank?bezeichnung=${encodeURIComponent(bezeichnung)}`,
      { method: "DELETE" },
    );
    const d = (await r.json().catch(() => ({}))) as
      { ok?: boolean; fehler?: string };
    if (d.ok) {
      window.location.reload();
    } else {
      setStand("bereit");
      setFehler(d.fehler ?? "Das Löschen hat nicht geklappt.");
    }
  }

  if (!offen) {
    return (
      <>
        {ruht && (
          <div className="rueckmeldung" data-art="warn">
            <strong>Dieser Zugang ruht.</strong> Die Bank hat die
            Zugangsdaten abgelehnt, deshalb versucht es der nächtliche Lauf
            nicht erneut — drei Fehlversuche sperren den Bankzugang, auch
            den im Browser. Korrigieren Sie die Angaben; damit läuft er
            wieder an.
          </div>
        )}
        <button data-art="still" onClick={() => setOffen(true)}>
          {bezeichnung} bearbeiten
        </button>
      </>
    );
  }

  return (
    <form onSubmit={speichern} style={{ maxWidth: "32rem" }}>
      <label>Anmeldename im Onlinebanking
        <input
          name="benutzer"
          required
          defaultValue={benutzer}
          className="feld"
        />
        <span className="hinweis">
          Bei Sparkassen ist das häufig nicht der selbst gewählte
          Anmeldename, sondern die Legitimations-ID aus dem Schreiben mit
          den Erstzugangsdaten.
        </span>
      </label>
      <label>FinTS-Adresse der Bank
        <input name="url" type="url" defaultValue={url} className="feld" />
      </label>
      <label>Kundennummer, falls abweichend
        <input name="kunden_id" defaultValue={kundenId ?? ""} className="feld" />
      </label>
      <label>IBAN des Kontos, falls der Zugang mehrere sieht
        <input
          name="konto_iban"
          defaultValue={kontoIban ?? ""}
          placeholder="DE..."
          className="feld"
        />
      </label>
      <label>Neue PIN
        <input name="pin" type="password" autoComplete="off" className="feld" />
        <span className="hinweis">
          Leer lassen, wenn die hinterlegte PIN bleiben soll. Es ist die
          PIN, mit der Sie sich auch im Onlinebanking anmelden — keine
          eigene, die hier vergeben wird.
        </span>
      </label>

      {fehler && (
        <p className="rueckmeldung" data-art="fehler">
          {fehler}
        </p>
      )}

      <button type="submit" disabled={stand === "laeuft"}>
        {stand === "laeuft" ? "speichert …" : "Änderung speichern"}
      </button>{" "}
      <button type="button" data-art="still" onClick={() => setOffen(false)}>
        Abbrechen
      </button>

      {/* Das Löschen steht abgesetzt und hinter einer Rückfrage: Mit dem
          Zugang geht die hinterlegte PIN weg und der Stand des letzten
          Abrufs. Danach holt der nächste Abruf wieder 85 Tage und
          verlangt dafür eine TAN. */}
      <div className="abschnitt">
        {loeschFrage ? (
          <>
            <p className="rueckmeldung" data-art="warn">
              Zugang „{bezeichnung}" wirklich entfernen? Die hinterlegte PIN
              und der Stand des letzten Abrufs gehen dabei verloren. Die
              schon geholten Buchungen bleiben.
            </p>
            <button
              type="button"
              data-art="gefahr"
              disabled={stand === "laeuft"}
              onClick={loeschen}
            >
              Ja, entfernen
            </button>{" "}
            <button
              type="button"
              data-art="still"
              onClick={() => setLoeschFrage(false)}
            >
              Nein
            </button>
          </>
        ) : (
          <button
            type="button"
            data-art="still"
            onClick={() => setLoeschFrage(true)}
          >
            Zugang entfernen
          </button>
        )}
      </div>
    </form>
  );
}
