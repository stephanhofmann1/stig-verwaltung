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
export function DokumentLoeschen({
  id,
  was,
  still = false,
}: {
  id: string;
  /** Was gelöscht wird -- steht in der Rückfrage. */
  was: string;
  still?: boolean;
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
      <button
        type="button"
        data-art="still"
        onClick={() => setGefragt(true)}
        style={still ? { border: "none", padding: 0 } : undefined}
      >
        Löschen
      </button>
    );
  }

  return (
    <span style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center" }}>
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
