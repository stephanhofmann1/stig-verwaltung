import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Register } from "@/components/SchaufensterFaltung";
import { Entwurf } from "@/components/SchaufensterEntwurf";
import { Assistent } from "@/components/SchaufensterAssistent";

/**
 * Das Schaufenster.
 *
 * Die einzige Seite dieser Anwendung, die ohne Anmeldung zu sehen ist --
 * und zugleich die Anlaufstelle fuer jeden: stig-immobilien.de fuehrt
 * hierher, ob angemeldet oder nicht. Ins Cockpit geht es von hier mit
 * einem Klick.
 *
 * Was diese Seite ist: eine Darstellung dessen, wie hier verwaltet wird.
 * Was sie nicht ist: ein Verkaufsprospekt. Die Plattform ist kein Produkt
 * zum Kaufen, und die Seite verspricht auch keines. Deshalb steht am Ende
 * eine Adresse und kein Formular.
 *
 * Zwei Dinge, die beim Ergänzen zu beachten sind:
 *
 * 1. KEINE DATEN. Diese Seite liest nichts aus der Datenbank — kein
 *    Objekt, keine Zahl, kein Name. Alles, was hier steht, steht fest im
 *    Quelltext. Das ist kein Versäumnis, sondern die Eigenschaft, die
 *    sie ohne Anmeldung zeigbar macht. Die nachgebaute Oberfläche weiter
 *    unten zeigt eine erfundene Meldung an einer Einheit ohne Nummer;
 *    ein Bildschirmabzug der echten Verwaltung stünde hier mit
 *    Mieternamen, Beträgen und Adressen im Netz.
 *
 * 2. Server-Komponente. Interaktiv sind nur drei Bauteile, und die sind
 *    ausgelagert: Register (Aufklappen), Entwurf (schreibt sich) und
 *    Assistent (fragt den Server). Alles andere steht beim ersten Bild
 *    fertig da, auch ohne JavaScript.
 */

export const metadata: Metadata = {
  title: "Verwaltung, die mitschreibt",
  description:
    "Wie die STIG Immobilien eGbR ihre Objekte verwaltet: Posteingang, Mieten und " +
    "Belege in einem System — Antworten werden vorgeschrieben, gesendet wird nach Freigabe.",
};

/** Der Pfeil an Textverweisen. Einmal beschrieben, dreimal benutzt. */
function Pfeil() {
  return (
    <svg width="15" height="10" viewBox="0 0 16 11" fill="none" aria-hidden="true">
      <path d="M0 5.5h14M10 1l4.5 4.5L10 10" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

/** Die fünf Abläufe. Jeder zeigt, was die Plattform trägt und was nicht. */
const ABLAEUFE = [
  {
    nummer: "01",
    name: "Vermietung",
    stand: "läuft",
    plattform: [
      "Anfragen von der Website, aus Portalen und per Mail laufen an einer Stelle zusammen",
      "Einordnung und Antwortentwurf innerhalb von Minuten",
      "Freie Einheiten werden aus den Mietverhältnissen berechnet, nicht aus einer Liste gepflegt",
      "Erinnerung nach drei Tagen, höchstens zweimal",
      "Mietvertrag und Wohnungsgeberbestätigung werden erzeugt",
    ],
    mensch: [
      "Jede Antwort geht über die Freigabe",
      "Zusagen und Preisgespräche",
      "Die Unterschrift unter dem Vertrag",
    ],
    text:
      "Von der Anfrage bis zum Einzug. Was frei ist, ergibt sich aus den laufenden " +
      "Mietverhältnissen — eine gepflegte Liste gibt es nicht, und damit auch keine, die " +
      "jemand vergessen könnte.",
  },
  {
    nummer: "02",
    name: "Zahlungen",
    stand: "läuft",
    plattform: [
      "Monatliche Sollstellung je Mietverhältnis",
      "Umsätze kommen über die Bankschnittstelle direkt vom Konto",
      "Zuordnung auch bei verschobenem Monat, Teilzahlung oder Zahlung aus dem Ausland",
      "Abweichungen werden erkannt und vorgelegt",
      "Die Mahnstufe wird berechnet und begründet",
    ],
    mensch: [
      "Jede Mahnung lösen Sie aus",
      "Überweisungen — Konten werden gelesen, nie bedient",
    ],
    text:
      "Soll, Eingang, Differenz. Solange der Kontoauszug von Hand käme, stünde der ganze " +
      "Ablauf still, bis sich jemand erinnert. Der Abruf läuft nachts von selbst.",
  },
  {
    nummer: "03",
    name: "Posteingang",
    stand: "läuft",
    plattform: [
      "Jede Mail wird ein Vorgang mit vollständiger Vorgeschichte",
      "Meldungen aus dem Mieterbereich landen im selben Vorgang",
      "Die Antwort wird vorgeschrieben, samt Angabe, worauf sie beruht",
      "Nachsteuern in eigenen Worten statt Umschreiben von Hand",
      "Dauerhafte Weisungen gelten für jeden weiteren Entwurf",
    ],
    mensch: [
      "Freigeben, ändern oder verwerfen",
      "Alles mit Betrag, Zusage oder Termin",
      "Heikle Fälle — dort entsteht gar kein Entwurf",
    ],
    text:
      "Der Ablauf, der heute vollständig rundläuft. Mail herein, Vorgang auf, Entwurf " +
      "fertig, freigegeben — und die Rückmeldung kommt in denselben Vorgang zurück statt " +
      "in ein zweites Postfach.",
  },
  {
    nummer: "04",
    name: "Nebenkosten",
    stand: "im Aufbau",
    imAufbau: true,
    plattform: [
      "Belege ablegen und den Buchungen zuordnen",
      "Kosten je Objekt und Jahr auswerten",
    ],
    mensch: [
      "Zählerstände erfassen — in Arbeit",
      "Verteilerschlüssel und Abrechnungslauf — in Arbeit",
      "Versand und Fristen",
    ],
    text:
      "Einmal im Jahr, dafür aufwendig und fristgebunden. Belegablage und Zuordnung " +
      "stehen, der Rest wird gerade gebaut. Das steht hier, weil es ehrlicher ist, als " +
      "es zu verschweigen.",
  },
  {
    nummer: "05",
    name: "Selbstkontrolle",
    stand: "läuft",
    plattform: [
      "Jeder nächtliche Lauf wird mit Ergebnis und Dauer protokolliert",
      "Ein eigener Abschnitt sammelt, was jemand ansehen muss",
      "Ein Lagebericht fasst zusammen, was ansteht",
    ],
    mensch: ["Entscheiden, was aus einem Hinweis folgt"],
    text:
      "Automatisierung, die stillschweigend ausfällt, ist schlimmer als keine. Deshalb " +
      "meldet die Plattform selbst, wo sie unsicher steht — und es fällt auf, wenn der " +
      "Bericht ausbleibt.",
  },
];

/** Die Staffel: was ohne Freigabe geht, was nicht, und was gesperrt ist. */
const STAFFEL = [
  {
    nummer: "01",
    titel: "Eingangsbestätigung an Mieter",
    text: "Sagt nichts zu, verspricht nichts, bindet niemanden.",
    marke: "läuft allein",
  },
  {
    nummer: "02",
    titel: "Terminbestätigung an Handwerker",
    text: "Bestätigt nur, was ohnehin schon vereinbart wurde.",
    marke: "läuft allein",
  },
  {
    nummer: "03",
    titel: "Standardantwort an Interessenten",
    text: "Erst, wenn über längere Zeit kein Entwurf mehr korrigiert werden musste.",
    marke: "verdient sich frei",
  },
  {
    nummer: "04",
    titel: "Alles mit Betrag, Zusage oder Termin",
    text: "Bindet rechtlich. Das entscheidet ein Mensch, ausnahmslos.",
    marke: "Freigabe",
  },
  {
    nummer: "05",
    titel: "Mahnung, Kündigung, Behördenpost",
    text: "Hier entsteht nicht einmal ein Entwurf. Der Vorgang wird als heikel markiert und bleibt liegen.",
    marke: "gesperrt",
    art: "gesperrt",
  },
];

/** Was die Plattform grundsätzlich nicht tut. */
const GRENZEN = [
  ["Mahnungen und Fristen", "Der Rückstand wird erkannt, berechnet und vorgelegt. Das Schreiben verantwortet ein Mensch."],
  ["Kündigungen", "Kein Entwurf, kein Versand. Diese Art von Fall ist im Code gesperrt."],
  ["Behördenpost", "Wird zugeordnet und abgelegt, aber nie beantwortet."],
  ["Zahlungen auslösen", "Konten werden gelesen, nie bedient. Überweisungen gibt es in dieser Software nicht."],
  ["Unterschriften", "Der Vertrag wird erzeugt. Unterschrieben wird von Menschen."],
  ["Preiszusagen", "Alles, was den Preis bewegt, geht an die Freigabe."],
];

/** Wie die Daten getrennt sind. */
const DATEN = [
  [
    "Jeder Mandant in seinem eigenen Bereich",
    "Die Trennung sitzt in der Datenbank selbst, nicht in der Software darüber. Fragt ein " +
      "Programm versehentlich fremde Daten ab, gibt die Datenbank sie nicht heraus — " +
      "unabhängig davon, was die Software will.",
  ],
  [
    "Nummern beginnen bei eins",
    "Der erste Vorgang eines Mandanten ist sein erster, nicht der 137. So lässt sich aus " +
      "einer Nummer nicht ablesen, wie viel Betrieb andere haben.",
  ],
  [
    "Betrieb in Deutschland",
    "Eigene Infrastruktur, verschlüsselt, mit dokumentierten Schutzmaßnahmen. Zugangsdaten " +
      "und Schlüssel liegen nicht im Quellcode.",
  ],
  [
    "Mails kommen vom Absender selbst",
    "Der Versand läuft über die verifizierte eigene Adresse. Im Postfach des Mieters steht " +
      "der Vermieter, nicht die Software.",
  ],
  [
    "Mieterbereich mit Einmallink",
    "Der Link geht an die im Mietvertrag hinterlegte Adresse, gilt eine Stunde und lässt " +
      "sich einmal einlösen. Mieter sehen ihre eigene Wohnung — in die Verwaltung kommen sie nicht.",
  ],
  [
    "Mieterdaten reisen als Paket",
    "Sie werden nicht über das Code-Repository bewegt. Was dort liegt, ist Programm, keine Person.",
  ],
];

/** Die Fragen, die im Gespräch regelmäßig kommen. */
const FRAGEN = [
  {
    frage: "Warum nicht eine fertige Software?",
    text:
      "Es gibt gute. Sie sind entweder auf Bestände ausgelegt, die ein Vielfaches größer " +
      "sind, oder sie bilden die Arbeit ab, statt sie abzunehmen: Man trägt ein, was man " +
      "vorher schon wusste. Hier war die Frage umgekehrt — was kann wegfallen, ohne dass " +
      "die Verantwortung wandert.",
    punkte: [
      "Gewachsen aus dem täglichen Betrieb, nicht aus einem Lastenheft",
      "Jede Funktion ist entstanden, weil sie an einem konkreten Fall gefehlt hat",
      "Was sich nicht bewährt, fliegt wieder raus",
    ],
  },
  {
    frage: "Wer haftet, wenn die KI danebenliegt?",
    text:
      "Die Verantwortung bleibt beim Menschen, und die Software ist so gebaut, dass sie " +
      "gar nicht erst woanders landen kann. Verbindliche Aussagen gehen nie ohne Freigabe " +
      "hinaus, und für die heiklen Fälle entsteht nicht einmal ein Entwurf.",
    punkte: [
      "Jeder Entwurf ist nachvollziehbar: worauf er beruht, wer ihn geändert hat",
      "Mahnung, Kündigung und Behördenpost sind gesperrt",
      "Ein Schalter stoppt jeden selbsttätigen Versand sofort",
      "Was von allein hinausging, steht abends im Lagebericht",
    ],
  },
  {
    frage: "Was ist mit den Mieterdaten?",
    text:
      "Sie liegen auf eigener Infrastruktur in Deutschland, getrennt nach Mandant, und sie " +
      "verlassen das System nicht über Umwege. Für den Teil, den ein Sprachmodell zu sehen " +
      "bekommt, gilt: Es sieht den Vorgang, an dem es arbeitet, und nicht den Bestand.",
    punkte: [
      "Trennung erzwingt die Datenbank, nicht die Anwendung",
      "Zugangsdaten und Türcodes liegen nicht im Quellcode",
      "Die öffentliche Seite hier liest überhaupt keine Daten",
    ],
  },
  {
    frage: "Kann man das auch bekommen?",
    text:
      "Heute nicht. Die Plattform ist für mehrere Mandanten gebaut und läuft stabil, aber " +
      "sie wird für den eigenen Bestand entwickelt und ist kein Produkt mit Support und " +
      "Vertrag. Ob daraus einmal ein Angebot wird, ist offen — Interesse darf man trotzdem " +
      "anmelden.",
    punkte: [
      "Kein Preis, keine Testversion, keine Zusage",
      "Gespräche über die Arbeitsweise gern",
      "kontakt@stig-immobilien.de",
    ],
  },
];

export default async function Willkommen() {
  /*
    Wer angemeldet ist, bekommt den direkten Weg ins Cockpit statt einer
    Einladung zur Anmeldung.

    Die Auskunft kommt als Anfragekopf aus dem Proxy, nicht aus der
    Datenbank. Diese Seite sagt an zwei Stellen zu, keine Daten zu
    lesen, und dieses Versprechen soll nicht an einer Beschriftung
    zerbrechen. Der Kopf wird ausschliesslich im Proxy gesetzt und für
    jeden anderen Pfad entfernt -- von aussen mitgeschickt bewirkt er
    nichts.
  */
  const angemeldet = (await headers()).get("x-angemeldet") === "ja";
  const portalZiel = angemeldet ? "/cockpit" : "/anmelden";

  return (
    <div className="schaufenster">
      {/* --- Der Kopf ------------------------------------------------- */}
      <section className="s-band">
        <div className="s-innen s-buehne">
          <p className="s-marke">STIG Immobilien eGbR</p>
          <h1>
            <span className="s-zeile">
              <span>Die Antwort</span>
            </span>
            <span className="s-zeile">
              <span>ist geschrieben.</span>
            </span>
            <span className="s-zeile">
              <span>
                Wir <em className="s-betont">entscheiden</em>.
              </span>
            </span>
          </h1>

          <div className="s-unten">
            <div>
              <p className="s-lauf">
                Posteingang, Mieten, Interessenten und Belege laufen in einem Vorgang
                zusammen. Die Plattform formuliert die Antwort und legt offen, worauf sie
                beruht. Abgeschickt wird sie, wenn ein Mensch es sagt.
              </p>
              <div className="s-wege">
                <Link className="s-knopf" href={portalZiel}>
                  Zur Verwaltung
                </Link>
                <a className="s-verweis" href="#oberflaeche">
                  Wie das aussieht <Pfeil />
                </a>
              </div>
            </div>
            <ul className="s-tatsachen">
              <li>Selbst entwickelt, im täglichen Einsatz</li>
              <li>Betrieb auf eigener Infrastruktur in Deutschland</li>
              <li>Nichts verlässt das Haus ohne Freigabe</li>
            </ul>
          </div>
        </div>
      </section>

      {/* --- Zahlen --------------------------------------------------- */}
      <div className="s-innen">
        <div className="s-zahlen">
          <div className="s-zahl">
            <b>5</b>
            <span>Abläufe einer Verwaltung in einem System</span>
          </div>
          <div className="s-zahl">
            <b>0</b>
            <span>Mails, die ohne Freigabe hinausgehen</span>
          </div>
          <div className="s-zahl">
            <b>6</b>
            <span>Dinge, die die Software grundsätzlich nicht tut</span>
          </div>
          <div className="s-zahl">
            <b>DE</b>
            <span>Serverstandort, Mandanten strikt getrennt</span>
          </div>
        </div>
      </div>

      {/* --- Die Oberfläche ------------------------------------------- */}
      <section className="s-band" id="oberflaeche">
        <div className="s-innen s-abschnitt">
          <div className="s-kopf">
            <p className="s-marke">Die Oberfläche</p>
            <div>
              <h2>
                Ein Posteingang,
                <br />
                der mitschreibt.
              </h2>
              <p className="s-lauf">
                Jede Mail wird ein Vorgang mit Vorgeschichte. Die Antwort steht schon da,
                samt Angabe, woher sie ihre Fakten hat. Gelesen, bei Bedarf nachgesteuert,
                gesendet.
              </p>
            </div>
          </div>

          <div className="s-schirm">
            <div className="s-leiste">
              <b>STIG Verwaltung</b>
              <span>Posteingang</span>
              <span>Nachbau — die Daten sind erfunden</span>
            </div>
            <div className="s-flaechen">
              <nav className="s-schiene" aria-hidden="true">
                <p>Übersicht</p>
                <span data-hier="ja">Cockpit</span>
                <span>Mietenbuch</span>
                <p>Vermietung</p>
                <span>Objekte</span>
                <span>Einheiten &amp; Mieter</span>
                <span>Vorgänge</span>
                <p>Geld</p>
                <span>Zahlungen</span>
                <span>Rückstände</span>
                <span>Belege</span>
                <span>Konten</span>
                <span>Bank</span>
                <p>System</p>
                <span>Automatik</span>
                <span>Weisungen</span>
              </nav>

              <div className="s-tafel">
                <p>Instandhaltung</p>
                <h4>Heizung im Bad bleibt kalt</h4>

                <div className="s-nachricht">
                  <div className="s-wer">
                    <b>Mieterin</b>
                    <span>heute, 18:07</span>
                  </div>
                  <p>
                    Guten Abend, die Heizung im Bad wird seit gestern nicht mehr warm. Die
                    anderen Räume sind in Ordnung. Können Sie da jemanden schicken?
                  </p>
                </div>

                <Entwurf />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* --- Die fünf Abläufe ----------------------------------------- */}
      <section className="s-band">
        <div className="s-innen s-abschnitt">
          <div className="s-kopf">
            <p className="s-marke">Der Aufbau</p>
            <div>
              <h2>
                Fünf Abläufe.
                <br />
                Mehr ist eine
                <br />
                Verwaltung nicht.
              </h2>
              <p className="s-lauf">
                Jeder kostet Aufmerksamkeit, weil jemand daran denken muss. Hier läuft
                jeder für sich — und es steht dabei, wo er trotzdem anklopft.
              </p>
            </div>
          </div>

          <Register
            eintraege={ABLAEUFE.map((a) => {
              const anteil = Math.round(
                (a.plattform.length / (a.plattform.length + a.mensch.length)) * 100,
              );
              return {
                nummer: a.nummer,
                name: a.name,
                stand: a.stand,
                imAufbau: a.imAufbau,
                inhalt: (
                  <>
                    <p>{a.text}</p>
                    <div className="s-anteil">
                      <b>{anteil}%</b>
                      <span>der Schritte laufen ohne Zutun</span>
                    </div>
                    <div
                      className="s-spur"
                      style={{ ["--anteil" as string]: `${anteil}%` }}
                    >
                      <i />
                    </div>
                    <div className="s-paar">
                      <div>
                        <h4>Übernimmt die Plattform</h4>
                        <ul>
                          {a.plattform.map((p) => (
                            <li key={p}>{p}</li>
                          ))}
                        </ul>
                      </div>
                      <div data-seite="mensch">
                        <h4>Bleibt beim Menschen</h4>
                        <ul>
                          {a.mensch.map((m) => (
                            <li key={m}>{m}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </>
                ),
              };
            })}
          />
        </div>
      </section>

      {/* --- Die Staffel ---------------------------------------------- */}
      <section className="s-band">
        <div className="s-innen s-abschnitt">
          <div className="s-kopf">
            <p className="s-marke">Vertrauen</p>
            <div>
              <h2>
                Erst verdienen,
                <br />
                dann automatisieren.
              </h2>
              <p className="s-lauf">
                Kein Schalter, der alles auf einmal freigibt, sondern eine Staffel. Die
                Plattform schreibt, ein Mensch sendet. Was allein laufen darf, hat es sich
                vorher über längere Zeit verdient — und jede Änderung an einem Entwurf
                wird vermerkt. Das ist die Messlatte.
              </p>
            </div>
          </div>

          <div className="s-staffel">
            {STAFFEL.map((s) => (
              <div className="s-stufe" key={s.nummer} data-art={s.art}>
                <span className="s-nr">{s.nummer}</span>
                <div>
                  <b>{s.titel}</b>
                  <i>{s.text}</i>
                </div>
                <span className="s-stand">{s.marke}</span>
              </div>
            ))}
          </div>

          <div className="s-duo">
            <div>
              <p className="s-marke">Notaus</p>
              <h3>Ein Schalter, sofort.</h3>
              <p>
                Stoppt jeden selbsttätigen Versand auf der Stelle — ohne Entwickler, ohne
                Neustart, ohne Wartezeit.
              </p>
            </div>
            <div>
              <p className="s-marke">Lagebericht</p>
              <h3>Eine Mail am Tag.</h3>
              <p>
                Was von allein hinausging, kommt gesammelt. Nicht zum Prüfen, sondern damit
                es auffällt, wenn etwas kippt.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* --- Die Grenzen ---------------------------------------------- */}
      <section className="s-band">
        <div className="s-innen s-abschnitt">
          <div className="s-kopf">
            <p className="s-marke">Die Grenzen</p>
            <div>
              <h2>
                Sechs Dinge, die
                <br />
                sie nicht anfasst.
              </h2>
              <p className="s-lauf">
                Nicht aus Vorsicht. Der Schaden ist ungleich verteilt: Ein zu spät
                beantworteter Interessent kostet einen Lead. Eine falsch verschickte
                Kündigung kostet ein Mietverhältnis und möglicherweise einen Prozess.
              </p>
            </div>
          </div>
          <div className="s-zeilen">
            {GRENZEN.map(([titel, text]) => (
              <div key={titel}>
                <b>{titel}</b>
                <i>{text}</i>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* --- Zahlungen ------------------------------------------------ */}
      <section className="s-band">
        <div className="s-innen s-abschnitt">
          <div className="s-kopf">
            <p className="s-marke">Der größte Hebel</p>
            <div>
              <h2>
                Soll, Eingang,
                <br />
                Differenz.
              </h2>
              <p className="s-lauf">
                Die Umsätze kommen über die Bankschnittstelle direkt vom Konto. Die
                Zuordnung versteht auch den, der einen Monat zu früh zahlt, nur die Hälfte
                überweist oder aus dem Ausland kommt.
              </p>
            </div>
          </div>

          <div className="s-rolle">
            <table>
              <caption className="s-nur-vorlesen">
                Beispielhafter Zahlungsabgleich eines Monats. Die Zahlen sind erfunden.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Einheit</th>
                  <th scope="col" data-art="zahl">
                    Soll
                  </th>
                  <th scope="col" data-art="zahl">
                    Eingegangen
                  </th>
                  <th scope="col">Zuordnung</th>
                  <th scope="col">Ergebnis</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Erste</td>
                  <td data-art="zahl">640,00</td>
                  <td data-art="zahl">640,00</td>
                  <td data-art="still">03.11. · Dauerauftrag</td>
                  <td data-art="still">vollständig</td>
                </tr>
                <tr>
                  <td>Zweite</td>
                  <td data-art="zahl">585,00</td>
                  <td data-art="zahl">585,00</td>
                  <td data-art="still">02.11. · Dauerauftrag</td>
                  <td data-art="still">vollständig</td>
                </tr>
                <tr>
                  <td>Dritte</td>
                  <td data-art="zahl">610,00</td>
                  <td data-art="zahl">490,00</td>
                  <td data-art="still">04.11. · Teilzahlung</td>
                  <td data-art="offen">120,00 offen</td>
                </tr>
                <tr>
                  <td>Vierte</td>
                  <td data-art="zahl">610,00</td>
                  <td data-art="zahl">610,00</td>
                  <td data-art="still">31.10. · einen Monat früher</td>
                  <td data-art="still">vollständig</td>
                </tr>
                <tr>
                  <td>Fünfte</td>
                  <td data-art="zahl">520,00</td>
                  <td data-art="zahl">520,00</td>
                  <td data-art="still">03.11. · aus dem Ausland</td>
                  <td data-art="still">vollständig</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Ein Fall bleibt liegen. Die Mahnung schreibt die Plattform nicht — sie rechnet
            die Stufe aus, begründet sie und legt den Fall vor.
          </p>
        </div>
      </section>

      {/* --- Daten ---------------------------------------------------- */}
      <section className="s-band">
        <div className="s-innen s-abschnitt">
          <div className="s-kopf">
            <p className="s-marke">Daten</p>
            <div>
              <h2>
                Mieterdaten sind
                <br />
                <em className="s-betont">kein Nebenthema</em>.
              </h2>
              <p className="s-lauf">
                Wer hier verwaltet, hat die Korrespondenz fremder Menschen in der Hand.
                Deshalb steht die Trennung nicht in einer Einstellung, die man vergessen
                kann, sondern eine Ebene tiefer.
              </p>
            </div>
          </div>
          <div className="s-zeilen">
            {DATEN.map(([titel, text]) => (
              <div key={titel}>
                <b>{titel}</b>
                <i>{text}</i>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* --- Fragen und Assistent ------------------------------------- */}
      <section className="s-band">
        <div className="s-innen s-abschnitt">
          <div className="s-kopf">
            <p className="s-marke">Fragen</p>
            <div>
              <h2>Was man dazu wissen will.</h2>
            </div>
          </div>

          <Register
            zuerst={-1}
            eintraege={FRAGEN.map((f) => ({
              name: f.frage,
              inhalt: (
                <>
                  <p>{f.text}</p>
                  <div className="s-paar">
                    <div data-seite="mensch">
                      <h4>Kurz gesagt</h4>
                      <ul>
                        {f.punkte.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </>
              ),
            }))}
          />

          <div className="s-kopf" data-abstand="oben">
            <p className="s-marke">Assistent</p>
            <div>
              <h2>Oder fragen Sie einfach.</h2>
              <p className="s-lauf">
                Zum Ablauf, zur Freigabe, zum Datenschutz. Er kennt nur, was auf dieser
                Seite steht.
              </p>
            </div>
          </div>

          <Assistent />
        </div>
      </section>

      {/* --- Schluss -------------------------------------------------- */}
      <section className="s-band">
        <div className="s-innen s-abschnitt s-schluss">
          <p className="s-marke">STIG Immobilien eGbR</p>
          <h2>
            Verwaltung,
            <br />
            die mitdenkt.
          </h2>
          <div className="s-schluss-unten">
            <p className="s-lauf">
              Diese Plattform verwaltet unseren eigenen Bestand. Sie ist entstanden, weil
              keine vorhandene Lösung so arbeiten wollte, wie wir es für richtig halten:
              vorbereiten ja, entscheiden nein. Sie wird weitergebaut, solange sie
              gebraucht wird.
            </p>
            <div>
              <p className="s-marke">Fragen dazu</p>
              <div className="s-post">
                <b>kontakt@stig-immobilien.de</b>
              </div>
              <div className="s-wege">
                <Link className="s-verweis" href={portalZiel}>
                  {angemeldet ? "Zur Verwaltung" : "Zur Verwaltung anmelden"} <Pfeil />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="s-innen">
        <div className="s-fuss">
          <span>© {new Date().getFullYear()} STIG Immobilien eGbR</span>
          <span>Frankfurt am Main</span>
        </div>
      </div>
    </div>
  );
}
