import Link from "next/link";
import { ZEITRAEUME, ladeCockpit, liesMonate, spitze } from "@/lib/kennzahlen";
import { objektSicht } from "@/lib/objektsicht";
import { CockpitFristen } from "@/components/CockpitFristen";
import { CockpitMonat } from "@/components/CockpitMonat";
import { CockpitRueckstaende } from "@/components/CockpitRueckstaende";
import { CockpitLeerstand } from "@/components/CockpitLeerstand";
import { CockpitCashflow } from "@/components/CockpitCashflow";
import { CockpitVerlauf } from "@/components/CockpitVerlauf";
import { CockpitMietstruktur } from "@/components/CockpitMietstruktur";
import { CockpitAutomatik } from "@/components/CockpitAutomatik";
import { CockpitZahlungen } from "@/components/CockpitZahlungen";
import { FreigabeListe } from "@/components/FreigabeListe";
import {
  KennzahlenZeile,
  Verweis,
  datum,
  euroGenau,
} from "@/components/CockpitKarte";

export const dynamic = "force-dynamic";

/**
 * Das Vermieter-Cockpit -- die Startseite.
 *
 * Eine Frage, in zwei Sekunden zu beantworten: Bleibt heute etwas liegen?
 *
 * Darum steht oben eine Kennzahlenzeile und kein Absatz. Bis zum 03.11.2026
 * begann die Seite mit dem Gesetzestext zu § 556 BGB, und die erste Zahl kam
 * nach dem zweiten Absatz. Das war ein Protokoll: richtig, vollstaendig,
 * nachlesbar -- und zum Ueberfliegen unbrauchbar. Die Begruendungen stehen
 * wortgleich weiter auf der Seite, nur zugeklappt in `details.erklaerung`,
 * deren summary jeweils fuer sich steht.
 *
 * Die Reihenfolge ist nach Dringlichkeit und nicht nach Themengebiet. Oben,
 * was eine Handlung verlangt; darunter, was eine Lage beschreibt:
 *
 *   1. Freigabe           ohne einen Klick geht nichts raus -- die einzige
 *                         Stelle der Seite, an der etwas das Haus verlaesst
 *   2. Fristen            verstreichen sie, ist Geld oder ein Recht weg
 *   3. Rueckstaende       wo Geld fehlt; das Mahnwesen ist gesperrt
 *   4. Zahlungseingaenge  Geld, das da ist und nicht gezaehlt wird -- es
 *                         macht aus einem puenktlichen Mieter einen saeumigen
 *   5. Leerstand          frei und bald frei; bald frei heisst: suchen
 *   ---------------------------------------------------------------------
 *   6. Laufender Monat    Soll, bezahlt, offen
 *   7. Automatik          laeuft nachts noch, was nachts laufen soll
 *   8. Cashflow           zwoelf Monate Ein und Aus
 *
 * Die Automatik steht unter dem Strich, obwohl ein stehender Lauf alle
 * anderen Zahlen entwertet. Grund: Sie verlangt keine Handlung an einem
 * Mietverhaeltnis, sondern einen Blick auf den Betrieb -- und sie meldet sich
 * laut, wenn etwas dauerhaft scheitert.
 *
 * Gerechnet wird hier nichts. Jede Zahl kommt aus lib/kennzahlen.ts, wo die
 * Rechnerei als reine Funktion steht und Tests hat. Der Grund ist derselbe
 * wie bei den Mahnstufen: Eine Zahl auf der Startseite wird geglaubt, ohne
 * dass jemand nachrechnet.
 */
export default async function Cockpit({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
    Das Cockpit zeigt ein Haus, wenn eines gewaehlt ist.

    Stephan am 08.11.2026: "Die Gesamtschau interessiert in den wenigsten
    Faellen. Ich behandle die Objekte gerne separat und interessiere mich
    auch fuer jedes Objekt einzeln fuer die KPI, das Cockpit, Dashboard,
    Cashflow." Drei Haeuser in einem Mandanten, und bis dahin ein
    einziges Cockpit, das sie zusammenrechnete.

    Gewaehlt wird im Kopf (components/ObjektWahl.tsx), gemerkt in einem
    Cookie, geprueft in lib/objektsicht.ts. Hier wird nur gelesen.
  */
  const { gewaehlt } = await objektSicht();

  /*
    Der Zeitraum der Verlaufsdiagramme steht in der Adresszeile und
    nicht in einem Zustand im Browser. Drei Gruende: Die Daten kommen
    ohnehin vom Server -- 24 Monate sind eine andere Abfrage, nicht eine
    andere Ansicht derselben Zahlen; der Blick laesst sich so
    weitergeben; und der Zurueck-Knopf tut, was er soll.
  */
  const monate = liesMonate((await searchParams).monate);
  const d = await ladeCockpit(new Date(), gewaehlt?.id ?? null, monate);

  /**
   * Hat eine Abfrage geworfen?
   *
   * ladeCockpit() faengt jeden Einzelfehler ab und liefert einen Leerwert --
   * lauter Nullen. Wer diese Nullen anzeigt, meldet Ruhe ueber Daten, die
   * niemand gelesen hat. Die Namen sind dieselben wie in `behutsam()`.
   */
  const geworfen = (was: string) => d.fehler.some((f) => f.startsWith(was + ":"));

  // Keine Rechnerei, nur Auswahl: `dringlichkeit` kommt fertig aus
  // lib/kennzahlen.ts. Gezaehlt wird hier, weil ladeCockpit() keine
  // Summenzeile liefert -- siehe Bericht.
  const dringend = d.fristen.filter(
    (f) => f.dringlichkeit === "verstrichen" || f.dringlichkeit === "kritisch",
  ).length;

  // Liegen ueberhaupt Kontoumsaetze vor? spitze() ist der hoechste Balken der
  // Cashflow-Reihe; ist er 0, gibt es in zwoelf Monaten keine Buchung. Dann
  // ist "0 unzugeordnet" keine Leistung, sondern eine fehlende Grundlage.
  const umsaetze = !geworfen("Cashflow") && spitze(d.cashflow) > 0;

  return (
    <>
      <div className="titelzeile">
        {/* Der Name des Hauses steht in der Ueberschrift und nicht nur im
            Umschalter oben: Wer einen Ausdruck oder ein Bildschirmfoto
            weitergibt, muss darauf sehen koennen, wovon die Zahlen
            handeln. Eine Zahl ohne Bezugsgroesse ist keine Auskunft. */}
        <h1>{gewaehlt ? `Cockpit — ${gewaehlt.name}` : "Cockpit"}</h1>
        <span className="zaehler">Stand {datum(d.heute)}</span>
      </div>

      {/* Was sich NICHT nach Objekt trennen laesst, steht hier einmal und
          nicht an jeder einzelnen Karte.

          Die Laeufe der Automatik gelten fuer den Mandanten: Einen
          "Bankabruf des Hauses Westanlage" gibt es nicht. Dasselbe gilt
          fuer die Freigabe des Mahnwesens -- ein Schalter fuer alles.

          Das zu verschweigen waere der eigentliche Fehler: Unter der
          Ueberschrift eines Hauses eine Zahl zu zeigen, die ein anderes
          mitmeint, ist eine falsche Auskunft, auch wenn die Zahl
          stimmt. */}
      {/* Ein Satz sichtbar, der Rest aufklappbar.

          Die Ausnahmen muessen dastehen -- unter der Ueberschrift eines
          Hauses eine Zahl zu zeigen, die ein anderes mitmeint, ist eine
          falsche Auskunft, auch wenn die Zahl stimmt. Aber vier Zeilen
          Prosa ueber den Zahlen liest beim dritten Mal niemand mehr,
          und dann steht dort eine Wand statt eines Hinweises.

          Sichtbar bleibt der Satz, der jedes Mal gilt: Die Teile
          summieren sich nicht ueberall zum Ganzen. Warum, erklaert sich
          einmal. */}
      {gewaehlt && (
        <details className="erklaerung">
          <summary>
            Nicht alles lässt sich einem Haus zuordnen — die Objekte
            summieren sich nicht überall zur Gesamtschau
          </summary>
          <p>
            <strong>Automatik</strong> und die Freigabe des Mahnwesens
            gelten für alle Objekte zusammen: Einen Bankabruf eines
            einzelnen Hauses gibt es nicht.
          </p>
          <p>
            Vorgänge und Fristen, die noch keinem Haus zugeordnet sind,
            stehen in <em>jeder</em> Objektsicht. Sie gehören nicht einem
            anderen Haus, sondern keinem — und blieben sonst unsichtbar.
          </p>
          <p>
            Beim Cashflow zählen die Buchungen der Konten dieses Hauses.
            Umsätze auf einem Konto ohne Objekt erscheinen hier nicht:
            Sie einem Haus zuzuschlagen wäre geraten.
          </p>
        </details>
      )}

      {/* Fehlgeschlagene Abfragen werden genannt, nicht verschwiegen: Eine
          Karte, die still eine Null zeigt, weil ihre Abfrage geworfen hat,
          ist schlimmer als eine fehlende Karte. Steht hier etwas, zeigen die
          betroffenen Kennzahlen unten "—". */}
      {d.fehler.length > 0 && (
        <div className="meldung" data-art="fehler">
          <strong>Diese Kennzahlen konnten nicht gelesen werden</strong>
          Sie stehen deshalb auf „—“ und sind nicht zu glauben:{" "}
          {d.fehler.join(" · ")}
        </div>
      )}

      {/* Die Kennzahlenzeile: fuenf Zahlen, die die Frage "wie steht es"
          beantworten, bevor man zu scrollen anfaengt. Jede davon hat unten
          ihre Karte; keine ist hier neu berechnet.

          Jeder Wert kann null sein, und null heisst "—". Das ist der ganze
          Sinn der Zeile: Eine Null, die "unbekannt" meint, ist die
          gefaehrlichste Anzeige dieser Anwendung -- an ihr haengt, ob jemand
          ein Mahnschreiben abschickt. */}
      <KennzahlenZeile
        posten={[
          {
            // Die handlungsnaechste Zahl der Seite steht vorn: Ein Entwurf,
            // der liegen bleibt, ist eine Antwort, die niemand bekommt.
            begriff: "Wartet auf Freigabe",
            wert: geworfen("Freigaben")
              ? null
              : String(d.freigaben.entwuerfe + d.freigaben.unbeantwortet),
            dazu: geworfen("Freigaben")
              ? "nicht gelesen"
              : d.freigaben.entwuerfe + d.freigaben.unbeantwortet === 0
                ? "nichts offen"
                : `${d.freigaben.entwuerfe} Entwurf${
                    d.freigaben.entwuerfe === 1 ? "" : "e"
                  }, ${d.freigaben.unbeantwortet} ohne Antwort`,
            // "warn", nicht "fehl": Etwas wartet, aber noch ist nichts
            // versaeumt. Rot ist in dieser Anwendung ein Urteil ueber
            // Geld oder eine Frist, kein Hinweis auf Arbeit.
            art: geworfen("Freigaben")
              ? undefined
              : d.freigaben.entwuerfe + d.freigaben.unbeantwortet > 0
                ? "warn"
                : "gut",
          },
          {
            begriff: "Fristen dringend",
            // Keine eingetragene Frist ist nicht dasselbe wie keine offene
            // Frist: Die Tabelle `frist` kann auch nur leer sein.
            wert:
              geworfen("Fristen") || d.fristen.length === 0
                ? null
                : String(dringend),
            dazu: geworfen("Fristen")
              ? "nicht gelesen"
              : d.fristen.length === 0
                ? "keine Frist eingetragen"
                : `${d.fristen.length} offen, nächste ${datum(
                    d.fristen[0].faellig_am,
                  )}`,
            // Ein Gedankenstrich ist weder gut noch schlecht: Keine Farbe
            // an eine Zahl haengen, die es nicht gibt.
            art:
              geworfen("Fristen") || d.fristen.length === 0
                ? undefined
                : dringend > 0
                  ? "fehl"
                  : "gut",
          },
          {
            begriff: "Rückstand zu schreiben",
            wert: geworfen("Rückstände")
              ? null
              : euroGenau(d.rueckstaende.summe),
            dazu: geworfen("Rückstände")
              ? "nicht gelesen"
              : d.mahnwesenFreigegeben
                ? `${d.rueckstaende.zuSchreiben} Mietverhältnisse`
                : `${d.rueckstaende.zuSchreiben} Mietverhältnisse · gesperrt`,
            art: geworfen("Rückstände")
              ? undefined
              : d.rueckstaende.zuSchreiben > 0
                ? "fehl"
                : "gut",
          },
          {
            begriff: "offen im Monat",
            // Derselbe Zweig wie auf der Karte: ohne Kontodaten keine Zahl.
            wert: d.monat.geld.belastbar ? euroGenau(d.monat.geld.offen) : null,
            dazu: d.monat.geld.belastbar
              ? `${d.monat.geld.offenBetroffen} Mietverhältnisse betroffen`
              : d.monat.geld.anzahl === 0
                ? "noch keine Sollstellungen"
                : "Monat nicht abgeglichen",
            art: !d.monat.geld.belastbar
              ? undefined
              : d.monat.geld.offen > 0
                ? "warn"
                : "gut",
          },
          {
            begriff: "Eingänge zuzuordnen",
            wert:
              geworfen("Zahlungseingänge") || !umsaetze
                ? null
                : String(d.unzugeordnet.anzahlMietgross),
            dazu: geworfen("Zahlungseingänge")
              ? "nicht gelesen"
              : !umsaetze
                ? "keine Kontoumsätze eingelesen"
                : `bis ${euroGenau(d.unzugeordnet.grenze)} — könnten Mieten sein`,
            art:
              geworfen("Zahlungseingänge") || !umsaetze
                ? undefined
                : d.unzugeordnet.anzahlMietgross > 0
                  ? "warn"
                  : "gut",
          },
          {
            begriff: "frei",
            // gesamt === 0 heisst: keine Einheit gelesen. "0 frei" waere dann
            // die Behauptung, alles sei vermietet.
            wert:
              d.leerstand.gesamt === 0 ? null : String(d.leerstand.frei.length),
            dazu:
              d.leerstand.gesamt === 0
                ? "keine Einheiten gelesen"
                : `${d.leerstand.bald.length} bald frei · ${d.leerstand.gesamt} vermarktbar`,
            art:
              d.leerstand.gesamt === 0
                ? undefined
                : d.leerstand.frei.length > 0
                  ? "warn"
                  : "gut",
          },
        ]}
      />

      {/* ---- Handlung ---------------------------------------------------- */}

      <FreigabeListe />

      <CockpitFristen fristen={d.fristen} />

      <CockpitRueckstaende
        lage={d.rueckstaende}
        freigegeben={d.mahnwesenFreigegeben}
        gelesen={!geworfen("Rückstände")}
      />

      <CockpitZahlungen lage={d.unzugeordnet} umsaetze={umsaetze} />

      <CockpitLeerstand lage={d.leerstand} />

      {/* ---- Lage -------------------------------------------------------- */}

      <CockpitMonat monat={d.monat.monat} geld={d.monat.geld} />

      <CockpitAutomatik posten={d.automatik} lagebericht={d.lagebericht} />

      {/* Der Zeitraum gilt fuer beide Verlaufsdiagramme und steht
          deshalb einmal davor, nicht zweimal daneben. Verweise und keine
          Knoepfe: Es ist eine andere Adresse, keine Handlung. */}
      <div className="titelzeile zeitraumwahl">
        <span className="zaehler">Zeitraum</span>
        <nav aria-label="Zeitraum der Verlaufsdiagramme">
          {ZEITRAEUME.map((m) => (
            <Link
              key={m}
              href={m === 12 ? "/cockpit" : `/cockpit?monate=${m}`}
              data-aktiv={m === monate ? "ja" : "nein"}
              aria-current={m === monate ? "page" : undefined}
            >
              {m} Monate
            </Link>
          ))}
        </nav>
      </div>

      {/* Der Verlauf steht VOR dem Cashflow und nicht dahinter.

          Der Cashflow zeigt, was auf dem Konto war -- eine Kassenlage.
          Der Soll-/Ist-Verlauf zeigt, ab welchem Monat die Zahlungen
          hinter der Forderung zurueckblieben, und das ist die Frage, die
          den Vermieter zuerst angeht. Bis hierhin war sie aus dieser
          Anwendung ueberhaupt nicht zu beantworten: Es gab den laufenden
          Monat und zwoelf Monatsbalken aus Buchungen, aber keine
          Zeitachse, auf der Forderung und Eingang nebeneinanderlaufen.

          Monate ohne Kontodaten erscheinen darin als Luecke und nicht als
          Einbruch auf Null. Eine Linie, die faellt, weil Auszuege fehlen,
          wuerde als Rueckstand gelesen -- und daraus entstuende eine
          Mahnung an jemanden, der bezahlt hat. */}
      <CockpitVerlauf reihe={d.sollIst} />

      <CockpitMietstruktur struktur={d.mietstruktur} />

      <CockpitCashflow reihe={d.cashflow} />

      <p className="hinweis">
        Weiter ins Detail: <Verweis nach="/mietenbuch">Mietenbuch</Verweis>{" "}
        <Verweis nach="/mahnwesen">Rückstände</Verweis>{" "}
        <Verweis nach="/belege">Belege</Verweis>{" "}
        <Verweis nach="/stammdaten">Stammdaten</Verweis>
      </p>
    </>
  );
}
