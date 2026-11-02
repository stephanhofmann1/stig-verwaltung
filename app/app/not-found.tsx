import Link from "next/link";

/**
 * Eine Adresse, hinter der nichts liegt.
 *
 * Das passiert hier seltener durch Vertippen als durch ein Lesezeichen auf
 * einen Vorgang oder ein Mietverhältnis, das es nicht mehr gibt. Deshalb
 * nennt der Text beide Fälle und führt in einem Klick zurück -- eine
 * Sackgasse mit einer Zahl darauf wäre keine Auskunft.
 */
export default function NichtGefunden() {
  return (
    <>
      <div className="titelzeile">
        <h1>Nichts gefunden</h1>
      </div>

      <div className="leer">
        <strong>Zu dieser Adresse gibt es keine Seite</strong>
        Entweder ist der Verweis veraltet, oder der Vorgang, der hier lag,
        wurde entfernt. Gelöscht wurde durch den Aufruf nichts.
        <div className="knopfreihe">
          <Link href="/" className="marker" data-art="info">
            Zurück zum Cockpit
          </Link>
          <Link href="/vorgaenge" className="marker" data-art="info">
            Vorgänge
          </Link>
        </div>
      </div>
    </>
  );
}
