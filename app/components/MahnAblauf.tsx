/**
 * Der Ablauf in Worten: was von selbst geschieht, was wartet, was nie
 * geschieht.
 *
 * Diese Übersicht ist kein Zierrat. Die Mahnlogik ist vollständig gebaut
 * und sorgfältig abgesichert, aber solange nicht an einer Stelle steht, was
 * von alleine läuft und was auf eine Entscheidung wartet, bedient sie
 * niemand -- und das ist derselbe Zustand, als wäre sie nicht da.
 *
 * Die Angaben stammen aus dem Zeitplaner (aufgaben.sh: zwei Läufe täglich,
 * standardmäßig 7 und 18 Uhr, in genau dieser Reihenfolge) und aus
 * lib/typen.ts (HEIKLE_KATEGORIEN: Mahnwesen und Behörde bekommen nie einen
 * Entwurf vom Agenten).
 *
 * Keine Zustände, keine Datenbank: nur Text. Darum ist das eine
 * Serverkomponente.
 */

const VON_SELBST: [string, string][] = [
  [
    "Kontoabruf",
    "Holt die Umsätze bei der Bank (FinTS). Läuft zuerst — sonst sähe eine " +
      "Zahlung von heute Morgen aus wie ein Rückstand.",
  ],
  [
    "Zuordnung",
    "Ordnet jeden Eingang einer Sollstellung zu. Was nicht eindeutig ist, " +
      "landet in der Prüfung und wartet dort auf dich.",
  ],
  [
    "Sollstellungen",
    "Stellt die Mieten des laufenden Monats, anteilig bei Ein- und Auszug.",
  ],
  [
    "Mahnstufe",
    "Rechnet je Mietverhältnis die Stufe und schreibt die Begründung dazu. " +
      "Das Rechnen allein bewegt nichts: Es entsteht kein Schreiben und " +
      "kein Entwurf.",
  ],
  [
    "Lagebericht",
    "Fasst morgens zusammen, was die Läufe gefunden haben, und nennt die " +
      "Rückstände über der Schwelle.",
  ],
];

const WARTET: [string, string][] = [
  [
    "Mahnwesen freigeben",
    "Einmal je Objektbestand, hier auf dieser Seite. Vorher entsteht kein " +
      "einziges Schreiben.",
  ],
  [
    "Jede Mahnung einzeln",
    "Unten in der Liste: entwerfen, verschieben oder nicht mahnen. Nichts " +
      "davon geschieht in Serie, und nichts davon geschieht ohne Klick.",
  ],
  [
    "Jeden Entwurf freigeben",
    'Der Entwurf liegt danach in der Freigabe ("Freigabe" in der ' +
      "Kopfzeile), zum Lesen, Ändern und Senden.",
  ],
  [
    "Unklare Zuordnungen klären",
    "Ein Eingang, der keiner Sollstellung zugeordnet ist, ist Geld, das da " +
      "ist und nicht zählt. Solange welche offen sind, bleibt die Freigabe " +
      "unten gesperrt.",
  ],
];

const NIE: [string, string][] = [
  [
    "Mahnungen versenden",
    "Keine Schnittstelle dieser Anwendung verschickt eine Mahnung von " +
      "selbst. Auch der freigegebene Entwurf geht erst, wenn jemand sendet.",
  ],
  [
    "Kündigungen",
    "Weder Text noch Entwurf. Dass bei zwei Monatsmieten Rückstand " +
      "§ 543 Abs. 2 Nr. 3 BGB erfüllt wäre, steht in der Begründung — als " +
      "Hinweis für dich, nicht als Vorlage.",
  ],
  [
    "Behördenpost",
    "Mahnwesen und Behörde gelten als heikle Vorgänge. Dort schreibt der " +
      "Agent nicht einmal einen Entwurf vor.",
  ],
];

function Spalte({
  titel,
  zeilen,
  art,
}: {
  titel: string;
  zeilen: [string, string][];
  art: "gut" | "warn" | "fehl";
}) {
  return (
    <section className="karte">
      <h3 className="karte-titel">
        <span className="punkt" data-art={art} />
        {titel}
      </h3>
      <dl style={{ margin: 0 }}>
        {zeilen.map(([was, wie]) => (
          <div key={was} style={{ marginBottom: "var(--abstand-3)" }}>
            <dt style={{ fontWeight: 600 }}>{was}</dt>
            <dd className="hinweis" style={{ margin: 0 }}>
              {wie}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function MahnAblauf() {
  return (
    <>
      <p className="hinweis">
        Zweimal täglich (voreingestellt 7 und 18 Uhr) läuft die Buchhaltung
        von selbst: Kontoumsätze holen, Zahlungen zuordnen, Mieten stellen,
        Mahnstufen rechnen. Das Ergebnis dieser Läufe ist diese Seite — eine
        Vorschlagsliste. Angestoßen wird jede Mahnung einzeln von dir, und
        versendet wird sie erst, wenn du den Entwurf in der Freigabe gelesen
        und gesendet hast.
      </p>
      <p className="hinweis">
        Dass der Versand nicht von selbst läuft, ist eine Festlegung und
        keine fehlende Funktion. Die Fehler sind nicht gleich teuer: Ein zu
        spät beantworteter Interessent kostet einen Lead. Eine falsch
        verschickte Kündigung kostet ein Mietverhältnis und möglicherweise
        einen Prozess. Darum darf die Software beim Antworten vorarbeiten und
        bei Post an Mieter nur vorschlagen.
      </p>

      <div className="karten">
        <Spalte titel="Läuft nachts von selbst" zeilen={VON_SELBST} art="gut" />
        <Spalte titel="Wartet auf dich" zeilen={WARTET} art="warn" />
        <Spalte
          titel="Tut die Software nie von selbst"
          zeilen={NIE}
          art="fehl"
        />
      </div>
    </>
  );
}
