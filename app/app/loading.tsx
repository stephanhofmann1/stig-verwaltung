/**
 * Was zwischen Klick und Seite steht.
 *
 * Jede Datenseite steht auf `dynamic = "force-dynamic"`: Zwischen dem Klick
 * und der fertigen Seite liegt eine Abfrage. Ohne diese Datei bleibt in
 * dieser Zeit die alte Seite stehen -- ohne jedes Zeichen, dass etwas
 * passiert. Wer das zweimal erlebt, klickt ein zweites Mal, und beim
 * Mietenbuch über zwei Jahre sind das zwei Abfragen statt einer.
 *
 * Bewusst ohne Bewegung. Ein pulsender Platzhalter zieht den Blick auf die
 * Stelle, an der noch nichts steht; hier soll er dort liegen bleiben, wo
 * gleich die Zahl erscheint. Dazu käme, dass jede Animation eine neue Regel
 * in globals.css bräuchte -- samt Ausweg für prefers-reduced-motion.
 *
 * Die Form ist die häufigste im Haus: Titelzeile, eine Reihe Kennzahlen,
 * darunter eine Liste. Sie trifft nicht jede Seite genau. Sie hält aber die
 * Höhe und das Raster ruhig, damit der Inhalt nicht von unten
 * hereinspringt, wenn er eintrifft.
 */

/**
 * Ein grauer Balken an der Stelle eines Textes.
 *
 * Inline und nicht als Klasse: An der Gestaltung arbeitet jemand anderes,
 * und ein Platzhalter ist kein Bestandteil des Baukastens -- er soll keine
 * Klasse in globals.css belegen, die später etwas anderes bedeutet.
 */
function Balken({ breite, hoehe = "0.875rem" }: { breite: string; hoehe?: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "block",
        width: breite,
        height: hoehe,
        maxWidth: "100%",
        borderRadius: "var(--radius-s)",
        background: "var(--flaeche-tief)",
      }}
    />
  );
}

export default function Laedt() {
  return (
    /* aria-busy sagt der Vorlesesoftware, dass hier nichts fehlt, sondern
       etwas unterwegs ist. Der Satz darunter ist für sie die eigentliche
       Auskunft -- die Balken sind aria-hidden. */
    <div aria-busy="true" aria-live="polite">
      <div className="titelzeile">
        <h1>
          <Balken breite="11rem" hoehe="1.75rem" />
        </h1>
        <span className="zaehler">
          <Balken breite="7rem" />
        </span>
      </div>

      <p className="hinweis">Wird geladen …</p>

      <div className="karten">
        {[0, 1, 2, 3].map((i) => (
          <div className="karte kennzahl" key={i}>
            <span className="kennzahl-schild">
              <Balken breite="6rem" hoehe="0.75rem" />
            </span>
            <span className="kennzahl-wert">
              <Balken breite="8rem" hoehe="2rem" />
            </span>
            <span className="hinweis">
              <Balken breite="5rem" hoehe="0.75rem" />
            </span>
          </div>
        ))}
      </div>

      <div className="register">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div className="posten" key={i}>
            <span className="nummer">
              <Balken breite="2rem" hoehe="1rem" />
            </span>
            <span className="betreff">
              <Balken breite="18rem" hoehe="1rem" />
            </span>
            <span className="zeit">
              <Balken breite="4rem" hoehe="0.75rem" />
            </span>
            <span className="unterzeile">
              <Balken breite="24rem" hoehe="0.75rem" />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
