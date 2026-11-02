"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Was der Vermieter sieht, wenn eine Abfrage wirft.
 *
 * Vorher erschien hier die nackte Fehlerseite von Next: englisch, mit
 * Stapelabbild und Dateinamen. Das ist zweimal falsch -- es hilft dem
 * Vermieter nicht weiter, und es zeigt Fremden den Innenbau.
 *
 * Darum steht hier kein technischer Text. Die Einzelheiten gehen in die
 * Konsole des Browsers: Dort sucht sie, wer sie braucht, und dort liegt
 * auch die Kennung (digest), über die sich der Eintrag im Serverlog
 * wiederfinden lässt.
 *
 * Wichtig für die Einordnung: Diese Grenze umschliesst die Seiten, nicht
 * die Hülle. Wirft das Layout selbst -- etwa beim Lesen der Anmeldung --,
 * greift sie nicht; dafür bräuchte es global-error.tsx.
 */
export default function Fehler({
  error,
  reset,
  retry,
}: {
  /**
   * `unknown` und nicht `Error`: Aus einer Serverkomponente kommt ein
   * Error-Objekt, aus einer Clientkomponente aber genau das, was geworfen
   * wurde -- auch ein String.
   */
  error: unknown;
  reset: () => void;
  /**
   * Seit Next 16 getrennt: `reset` räumt nur die Grenze auf, `retry` holt
   * die Daten neu. Auf einer Seite, die bei jedem Aufruf frisch abfragt,
   * täte der Knopf mit `reset` allein nichts Sichtbares. `retry` ist
   * optional getippt, damit diese Datei auch ohne es übersetzt.
   */
  retry?: () => void;
}) {
  useEffect(() => {
    // Die einzige Stelle, an der die Einzelheiten auftauchen.
    console.error("Fehler beim Aufbau der Seite:", error);
  }, [error]);

  return (
    <>
      <div className="titelzeile">
        <h1>Das hat nicht geklappt</h1>
      </div>

      <div className="leer">
        <strong>Diese Seite konnte nicht aufgebaut werden</strong>
        Eine Abfrage ist unterwegs steckengeblieben. Angezeigt wird deshalb
        nichts -- lieber keine Zahl als eine halbe. An den Daten selbst hat
        sich nichts geändert: Es wurde nichts gespeichert, nichts versendet
        und nichts freigegeben.
        <div className="knopfreihe">
          <button onClick={() => (retry ?? reset)()}>Neu laden</button>
          <Link href="/" className="marker" data-art="info">
            Zurück zum Cockpit
          </Link>
        </div>
      </div>

      <p className="hinweis">
        Bleibt es dabei, hilft ein Blick in die Läufe: Steht der nächtliche
        Abgleich, fehlen den Seiten die Daten, auf denen sie rechnen.{" "}
        <Link href="/laeufe" className="marker" data-art="info">
          Läufe
        </Link>
      </p>
    </>
  );
}
