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
        {/* .verweis und nicht .marker: .marker ist die Pille fuer ein
            Urteil ("kritisch", "heikel"). Ein Rueckweg ist keines. */}
        <div className="knopfreihe">
          <Link href="/cockpit" className="verweis">
            Zurück zum Cockpit
          </Link>
          {/* Die beiden Wege, die der Text nennt -- unter denselben Namen,
              unter denen sie in der Kopfzeile stehen. Ein Lesezeichen auf
              ein Mietverhältnis landet hier; "Stammdaten" haette diesem
              Leser nichts gesagt. */}
          <Link href="/vorgaenge" className="verweis">
            Vorgänge
          </Link>
          <Link href="/stammdaten" className="verweis">
            Einheiten &amp; Mieter
          </Link>
        </div>
      </div>
    </>
  );
}
