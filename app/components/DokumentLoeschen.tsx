"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Ein Dokument löschen -- in zwei Schritten.
 *
 * Kein Systemdialog, sondern ein zweiter Klick an derselben Stelle: Der
 * Dialog erscheint am oberen Bildschirmrand und wird weggeklickt, bevor man
 * ihn gelesen hat. Gelöscht wird nur die Zeile und, wenn keine andere mehr
 * auf dieselbe Datei zeigt, auch die Datei.
 */
/*
 * Die Eigenschaft `still` ist entfallen. Sie hat den Knopf per Inline-Stil
 * randlos und ohne Innenabstand gemacht, damit er in einer Zeile aus Links
 * nicht auffaellt -- und damit war das Tippziel auf dem Telefon nur so gross
 * wie das Wort "Loeschen". Jetzt ist es der stille Knopf des Systems
 * (data-art="still"): umrandet, ohne Gewicht, mit richtigem Tippziel. Wer
 * den randlosen Textknopf zurueck will, braucht dafuer eine Klasse im
 * Stylesheet (etwa button[data-art="leise"]) -- nicht einen Stil im Markup.
 */
export function DokumentLoeschen({
  id,
  was,
}: {
  id: string;
  /** Was gelöscht wird -- steht in der Rückfrage. */
  was: string;
}) {
  const router = useRouter();
  const [gefragt, setGefragt] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState("");

  async function loesche() {
    setLaeuft(true);
    setFehler("");
    const r = await fetch(`/api/dokumente/${id}`, { method: "DELETE" });
    setLaeuft(false);
    if (!r.ok) {
      const d = (await r.json().catch(() => null)) as { fehler?: string } | null;
      setFehler(d?.fehler ?? `Fehler ${r.status}`);
      setGefragt(false);
      return;
    }
    router.refresh();
  }

  if (fehler) {
    return (
      <span className="rueckmeldung" data-art="fehler">
        {fehler}
      </span>
    );
  }

  if (!gefragt) {
    return (
      <button type="button" data-art="still" onClick={() => setGefragt(true)}>
        Löschen
      </button>
    );
  }

  return (
    <span className="knopfreihe">
      <span className="hinweis">{was} wirklich löschen?</span>
      <button type="button" onClick={loesche} disabled={laeuft}>
        {laeuft ? "löscht …" : "Ja, löschen"}
      </button>
      <button type="button" data-art="still" onClick={() => setGefragt(false)}>
        Nein
      </button>
    </span>
  );
}
