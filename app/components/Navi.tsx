"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Die Hauptnavigation.
 *
 * Clientkomponente, und das muss sie bleiben: Sie liest den Pfad
 * (usePathname), sie meldet ab (useRouter) und sie haelt seit dem Umbau
 * einen Zustand -- ob das Menue auf dem Telefon offen ist.
 *
 * Vorher standen hier zehn gleichwertige Textlinks in einer Reihe. Zehn
 * Woerter nebeneinander sind keine Ordnung, sondern eine Liste, die man
 * jedes Mal von vorne liest. Darum vier Gruppen: Sie beantworten die Frage
 * "wo suche ich das?" schon, bevor man die einzelnen Punkte liest.
 */

/**
 * Ein Punkt in der Navigation.
 *
 * Ausgefuehrt (export), weil die Fussnavigation in NaviBoden.tsx dieselbe
 * Form braucht. Zwei Navigationen mit zwei Begriffen davon, was ein Punkt
 * ist, laufen beim naechsten Zusatz auseinander.
 */
export interface Punkt {
  /** Wohin der Punkt fuehrt. */
  href: string;
  /** Was dort steht -- derselbe Name wie auf der Seite selbst. */
  text: string;
  /**
   * Weitere Pfadanfaenge, die diesen Punkt aktiv setzen.
   *
   * Der Grund: Die Detailseiten liegen auf eigenen Pfaden. Wer auf
   * /einheit/<id> steht, steht fachlich in der Vermietung -- laut
   * Navigation stand er bisher nirgends, weil kein Punkt /einheit hiess.
   * Eine Navigation, die auf jeder zweiten Seite leer markiert ist, hoert
   * auf, eine Standortangabe zu sein.
   */
  auch?: string[];
}

interface Gruppe {
  titel: string;
  punkte: Punkt[];
}

/**
 * Die Gruppen in der Reihenfolge, in der gearbeitet wird: erst der Blick
 * aufs Ganze, dann die Vermietung, dann das Geld, zuletzt die Technik.
 *
 * Zu den Namen: Angezeigt wird, was der Vermieter sagen wuerde, nicht wie
 * die Tabelle oder der Pfad heisst.
 *   - "Laeufe" hiess der Punkt nach der Tabelle lauf -- das versteht nur,
 *     wer sie angelegt hat. Angezeigt wird jetzt "Automatik": das ist, was
 *     dort nachgesehen wird (laeuft der naechtliche Abgleich?).
 *   - "Stammdaten" ist Verwaltungssprache fuer eine Seite, auf der
 *     Einheiten und laufende Mietverhaeltnisse stehen. Angezeigt wird, was
 *     dort steht.
 *   - /mahnwesen hiess im Navi "Rueckstaende" und auf der Seite
 *     "Mahnwesen". Ein Name, ueberall derselbe: "Rueckstaende". Das ist
 *     der Anlass, mit dem man die Seite aufsucht ("X hat nicht gezahlt"),
 *     und es passt zu den Nachbarn in der Gruppe, die auch Dinge
 *     benennen und keine Verfahren.
 */
const GRUPPEN: Gruppe[] = [
  {
    titel: "Übersicht",
    punkte: [
      { href: "/", text: "Cockpit" },
      { href: "/mietenbuch", text: "Mietenbuch" },
    ],
  },
  {
    titel: "Vermietung",
    punkte: [
      // Die Häuser standen bisher drei Klicks tief: Stammdaten -> eine
      // Einheit suchen -> öffnen -> Objektnamen anklicken. Dabei steht
      // dort, was ein Vermieter zuerst wissen will -- Soll, Belegung,
      // Leerstand, Fläche. Für jemanden mit drei Objekten war das die am
      // falschesten platzierte Seite der Anwendung.
      { href: "/objekte", text: "Objekte", auch: ["/objekt"] },
      {
        href: "/stammdaten",
        text: "Einheiten & Mieter",
        // Einheit und Mietverhältnis sind die Detailseiten dieser
        // Übersicht -- von ihr aus wird dorthin verzweigt.
        auch: ["/einheit", "/mietverhaeltnis"],
      },
      { href: "/vorgaenge", text: "Vorgänge", auch: ["/vorgang"] },
    ],
  },
  {
    // Die Reihenfolge ist der Weg, den das Geld nimmt: Es kommt auf dem
    // Auszug herein, wird einer Buchung zugeordnet, bekommt einen Beleg,
    // und was nicht kam, steht in den Rueckstaenden.
    //
    // Vorher standen hier "Zahlungen", "Konten" und "Bank"
    // nebeneinander. Drei Woerter, die nach demselben klingen, und drei
    // verschiedene Seiten: Kontoauszuege einlesen, Zahlungen zuordnen,
    // FinTS einrichten. Angezeigt wird jetzt, was man dort tut.
    titel: "Geld",
    punkte: [
      { href: "/konten", text: "Kontoauszüge" },
      { href: "/zahlungen", text: "Zahlungen" },
      { href: "/belege", text: "Belege" },
      { href: "/mahnwesen", text: "Rückstände" },
    ],
  },
  {
    titel: "System",
    punkte: [
      // Die Bankanbindung stand unter Geld, gehoert aber hierher: Sie
      // wird einmal eingerichtet und danach nie wieder aufgesucht. Unter
      // Geld stand sie neben vier Seiten, die man taeglich braucht.
      { href: "/bank", text: "Bankanbindung" },
      { href: "/laeufe", text: "Automatik" },
      // Die Dauerweisungen an die Entwurfserzeugung. Sie stehen unter
      // System und nicht unter Vermietung: Sie betreffen kein einzelnes
      // Mietverhaeltnis, sondern wie die Anwendung ueberhaupt
      // formuliert -- und sie wirken still auf jeden kuenftigen Entwurf.
      // Etwas, das unsichtbar mitschreibt, braucht einen sichtbaren Ort.
      { href: "/weisungen", text: "Weisungen" },
    ],
  },
];

/**
 * Die fuenf Ziele der Fussleiste (NaviBoden.tsx).
 *
 * Sie stehen hier und nicht dort, weil die Kopfnavigation sie kennen
 * muss: Auf dem Telefon klappte das Menue bisher alle elf Punkte samt
 * vier Gruppenueberschriften untereinander auf -- gut 600 Pixel, also
 * der halbe Bildschirm, und fuenf davon standen gleichzeitig unten in
 * der Leiste. Ein Menue, das die Leiste wiederholt, ist eine Liste zum
 * Zweitenmal-Lesen.
 *
 * Darum blendet globals.css unter 40rem genau diese fuenf im Menue aus.
 * 40rem ist derselbe Haltepunkt, an dem die Leiste erscheint -- sonst
 * waere ein Ziel bei irgendeiner Breite nirgends erreichbar.
 */
export const UNTEN: string[] = [
  "/",
  "/mietenbuch",
  "/vorgaenge",
  "/mahnwesen",
  "/belege",
];

/** Kennung fuer aria-controls -- es gibt genau eine Navigation je Seite. */
const NAVI_ID = "hauptnavigation";

/**
 * Steht der Benutzer auf diesem Punkt?
 *
 * Zwei Dinge gegenueber dem alten startsWith:
 * Erstens zaehlt "/" nur bei genauer Uebereinstimmung -- es ist der Anfang
 * jedes Pfades, sonst waere das Cockpit immer aktiv.
 * Zweitens muss hinter dem Praefix ein "/" oder das Ende stehen. Sonst
 * markiert /konten auch eine spaetere Seite /kontenrahmen -- ein Fehler,
 * der erst auffaellt, wenn es diese Seite gibt.
 *
 * Ausgefuehrt, damit die Fussnavigation (NaviBoden.tsx) dieselbe Antwort
 * gibt wie diese hier. Eine zweite, nachgebaute Fassung waere genau die
 * Art Dopplung, die still auseinanderlaeuft: Die Markierung steht dann
 * oben auf einem anderen Punkt als unten, und niemand sieht beides
 * gleichzeitig -- auf breiten Geraeten ist die Leiste weg, auf schmalen
 * die Kopfnavigation eingeklappt.
 */
export function istAktiv(p: Punkt, pfad: string): boolean {
  if (p.href === "/") return pfad === "/";
  return [p.href, ...(p.auch ?? [])].some(
    (anfang) => pfad === anfang || pfad.startsWith(anfang + "/"),
  );
}

export function Navi({ benutzer }: { benutzer: string | null }) {
  const pfad = usePathname();
  const router = useRouter();
  const [offen, setOffen] = useState(false);

  /**
   * Nach jedem Seitenwechsel zu.
   *
   * Ohne das bleibt auf dem Telefon das Menue ueber der gerade geladenen
   * Seite stehen -- die Navigation verdeckt dann genau das, wohin sie
   * gefuehrt hat. Die Links setzen den Zustand beim Klick schon selbst
   * zurueck; das hier faengt den Weg ohne Klick ab, also vor allem die
   * Zurueck-Taste des Browsers.
   *
   * Zurueckgesetzt wird beim Rendern und nicht in einem Effekt: Ein
   * Effekt, der setState aufruft, rendert ein zweites Mal -- hier
   * sichtbar, weil das offene Menue einen Augenblick ueber der neuen
   * Seite stehen bliebe. Das ist das von React vorgesehene Muster, um
   * Zustand beim Wechsel eines Eingangswerts zu verwerfen.
   */
  const [letzterPfad, setLetzterPfad] = useState(pfad);
  if (pfad !== letzterPfad) {
    setLetzterPfad(pfad);
    setOffen(false);
  }

  // Escape schliesst. Ein Menue, das die halbe Seite verdeckt, braucht
  // einen Ausweg, der nicht erst gefunden werden muss.
  useEffect(() => {
    if (!offen) return;
    function aufTaste(e: KeyboardEvent) {
      if (e.key === "Escape") setOffen(false);
    }
    document.addEventListener("keydown", aufTaste);
    return () => document.removeEventListener("keydown", aufTaste);
  }, [offen]);

  async function abmelden() {
    await fetch("/api/anmelden", { method: "DELETE" });
    router.replace("/anmelden");
    router.refresh();
  }

  // Auf der Anmeldeseite ist noch niemand da, der navigieren koennte.
  if (pfad === "/anmelden") return null;

  /**
   * Der Mieterbereich ist nicht die Verwaltung.
   *
   * Wer mit der Rolle "mieter" angemeldet ist, sieht unter /mieter seine
   * eigene Wohnung -- und sah bisher darueber die vollstaendige
   * Verwaltungsnavigation: Zahlungen, Rueckstaende, Bankanbindung des
   * Vermieters. Die Seiten selbst sperrt proxy.ts, aber eine Navigation,
   * die zehn verbotene Wege anbietet, ist auch ohne Datenabfluss falsch.
   * Abmelden bleibt -- gerade dort ist es der einzige Weg hinaus.
   */
  const imMieterbereich = pfad === "/mieter" || pfad.startsWith("/mieter/");

  return (
    <>
      {/* Schalter und Gruppen gehoeren zusammen: Beide entfallen im
          Mieterbereich, beide beschreiben denselben Bereich. */}
      {!imMieterbereich && (
        <>
          {/* Der Schalter steht ausserhalb von .navi: Er muss sichtbar
              bleiben, wenn die Navigation zugeklappt ist. Auf breiten
              Schirmen blendet ihn globals.css aus -- dort stehen die
              Gruppen ohnehin offen. */}
          <button
            type="button"
            className="navi-schalter"
            data-art="still"
            aria-expanded={offen}
            aria-controls={NAVI_ID}
            onClick={() => setOffen((v) => !v)}
          >
            Menü
          </button>

          <nav
            className="navi"
            id={NAVI_ID}
            aria-label="Hauptnavigation"
            /* Der Zustand steht als Datenmerkmal am Element, nicht als
               Stil: Ob "zu" ein eingeklapptes Feld, ein Vorhang oder auf
               breiten Schirmen gar nichts bedeutet, entscheidet
               globals.css. */
            data-offen={offen ? "ja" : "nein"}
          >
            {GRUPPEN.map((g) => (
              <div className="navi-gruppe" key={g.titel}>
                {/* Die Gruppenueberschrift ist Beschriftung, kein Weg --
                    darum span und kein Link. Sie ist auch keine
                    Dokumentgliederung: als h2 waere die Kopfzeile fuer die
                    Vorlesesoftware ein Kapitel vor jedem Kapitel. */}
                <span className="navi-titel">{g.titel}</span>
                <div className="navi-punkte">
                  {g.punkte.map((p) => {
                    const aktiv = istAktiv(p, pfad);
                    return (
                      <Link
                        key={p.href}
                        href={p.href}
                        data-aktiv={aktiv ? "ja" : "nein"}
                        /* Steht dieses Ziel auch unten in der Leiste?
                           Dann blendet globals.css es unter 40rem hier
                           aus -- siehe UNTEN oben. */
                        data-unten={UNTEN.includes(p.href) ? "ja" : "nein"}
                        /* aria-current sagt dasselbe wie die Markierung,
                           nur hoerbar. */
                        aria-current={aktiv ? "page" : undefined}
                        /* Klick auf den Punkt der Seite, auf der man
                           schon steht, aendert den Pfad nicht -- dann
                           greift der Abgleich oben nicht und das Menue
                           blieb offen. */
                        onClick={() => setOffen(false)}
                      >
                        {p.text}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </>
      )}

      {/* Abmelden steht als eigenes Geschwister in der Kopfzeile, nicht
          mehr in .navi.
          Vorher trug es marginLeft:auto in einem Flex-Container, der
          waagerecht ueberlief: Bei 390 px lag es hinter dem rechten Rand
          und war ohne Rollen nicht erreichbar -- bei einem Knopf, der
          eine Sitzung beendet, ist das der schlechteste Platz. Ausserhalb
          des rollenden bzw. einklappbaren Bereichs ist es auf jeder
          Breite da. */}
      {benutzer && (
        <button
          type="button"
          className="abmelden"
          data-art="still"
          onClick={abmelden}
        >
          Abmelden
        </button>
      )}
    </>
  );
}
