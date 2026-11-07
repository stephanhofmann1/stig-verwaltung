"use client";

import { useState } from "react";

/**
 * Einen Bankzugang anhalten -- oder wieder anstoßen.
 *
 * WOFÜR
 *
 * Der Abruf legt einen Zugang selbst still, wenn die Bank einen Fehler
 * an den Zugangsdaten meldet. Die Erkennung greift aber nur bei
 * Meldungen, die nach PIN, Legitimation oder Sperre klingen. Steht dort
 * etwas anderes -- am 07.11.2026 „Die Bank liefert kein Konto zu diesem
 * Zugang" --, läuft der Abruf weiter, zweimal täglich, und es gab keinen
 * Weg, ihn anzuhalten, ohne den Zugang samt PIN zu löschen.
 *
 * Wer nicht weiß, woran ein Abruf scheitert, muss ihn anhalten dürfen,
 * bevor er es herausfindet. Drei Fehlversuche sind bei den meisten
 * Banken alles, was man hat.
 *
 * WARUM OHNE RÜCKFRAGE
 *
 * Anhalten ist die vorsichtige Richtung und mit einem Klick zurückgenommen.
 * Eine Sicherheitsfrage davor würde den Knopf im Zweifel ungedrückt
 * lassen -- und genau im Zweifel soll er gedrückt werden.
 */
export function BankRuhen({
  id,
  bezeichnung,
  ruht,
}: {
  id: string;
  bezeichnung: string;
  ruht: boolean;
}) {
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState("");

  async function schalten() {
    setLaeuft(true);
    setFehler("");
    const koerper = new FormData();
    koerper.set("id", id);
    if (!ruht) koerper.set("ruhen", "1");
    try {
      const r = await fetch("/api/bank/stilllegen", {
        method: "POST",
        body: koerper,
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setFehler(d.fehler ?? "Das hat nicht geklappt.");
        setLaeuft(false);
        return;
      }
      window.location.reload();
    } catch {
      setFehler("Das hat nicht geklappt.");
      setLaeuft(false);
    }
  }

  return (
    <>
      <button
        data-art="still"
        disabled={laeuft}
        onClick={() => void schalten()}
      >
        {laeuft
          ? "…"
          : ruht
            ? `${bezeichnung} wieder abrufen lassen`
            : `${bezeichnung} anhalten`}
      </button>
      {fehler && (
        <div className="rueckmeldung" data-art="fehler">
          {fehler}
        </div>
      )}
    </>
  );
}
