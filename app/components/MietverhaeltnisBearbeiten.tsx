"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Das Mietverhaeltnis aendern -- Mieterhoehung, Auszug, Vertragsdaten.
 *
 * Bis hierhin ging das nur per SQL. Die Aktion `mietverhaeltnis_aendern`
 * gab es schon, aufgerufen hat sie niemand: null Treffer in app/ und
 * components/. Das Anlegeformular sagte dem Nutzer woertlich, er solle
 * "ein Enddatum eintragen" -- ein Feld, das es nirgends gab.
 *
 * ZWEI AKTIONEN, EIN FORMULAR
 *
 * Die Schnittstelle trennt, was fachlich zusammengehoert:
 *
 *   mietverhaeltnis_aendern  ende, kaltmiete, nebenkosten
 *                            -- zieht danach die Sollstellungen nach
 *   vertragsdaten_aendern    voller_name, geburtsdatum, geburtsort,
 *                            anschrift_vorher, melde_zusatz,
 *                            vertrag_datum, moeblierungszuschlag, kaution
 *                            -- ohne Sollstellungslauf
 *
 * Hier stehen beide in einem Formular, weil ein Vermieter nicht in
 * Aktionen denkt, sondern in "was muss ich nachtragen". Gespeichert wird
 * dann nacheinander, und jeder Teil meldet sein eigenes Ergebnis: Dass
 * die Vertragsdaten liegen und die Mieterhoehung nicht, muss dastehen und
 * nicht hinter einer pauschalen Erfolgsmeldung verschwinden.
 *
 * REIHENFOLGE IST NICHT BELIEBIG
 *
 * Erst die Vertragsdaten, dann Geld und Laufzeit. Grund: Der
 * Moeblierungszuschlag geht in `sollGesamt()` ein (lib/sollstellung.ts).
 * Liefe `mietverhaeltnis_aendern` zuerst, stellte sein Sollstellungslauf
 * noch mit dem alten Zuschlag -- und die neue Zahl stuende in den
 * Stammdaten, waehrend die Forderung die alte waere.
 *
 * Aendert sich NUR der Zuschlag, laeuft gar kein Lauf (die Aktion macht
 * bewusst keinen). Dann schickt dieses Formular hinterher ein
 * `mietverhaeltnis_aendern`, das kein Feld mitgibt: Alle Werte sind null,
 * COALESCE laesst alles stehen, und nur der Sollstellungslauf passiert.
 * Sonst stuende ein Zuschlag in den Stammdaten, den keine Forderung kennt.
 *
 * EIGENART BEIDER AKTIONEN: COALESCE
 *
 * Beide schreiben `spalte = COALESCE($n, spalte)`. Ein leeres Feld heisst
 * also "unveraendert" und nicht "leeren". Ein gesetztes Enddatum laesst
 * sich darueber nicht mehr zuruecknehmen. Das steht als Hinweis in der
 * Oberflaeche, statt es den Nutzer herausfinden zu lassen.
 */

/** Der gespeicherte Stand, wie ihn die Seite aus der Datenbank liest. */
export interface MietverhaeltnisStand {
  ende: string | null;
  kaltmiete: string | null;
  nebenkosten: string | null;
  voller_name: string | null;
  geburtsdatum: string | null;
  geburtsort: string | null;
  anschrift_vorher: string | null;
  melde_zusatz: string | null;
  vertrag_datum: string | null;
  moeblierungszuschlag: string | null;
  kaution: string | null;
}

interface Props {
  id: string;
  /** Mietbeginn -- untere Grenze fuer das Enddatum. */
  beginn: string;
  stand: MietverhaeltnisStand;
  /** fehlendeFelder() vom Mietvertrag, im Wortlaut der Pruefung. */
  fehltVertrag: string[];
  /** fehlendeFelderWgb() von der Wohnungsgeberbestaetigung. */
  fehltWgb: string[];
}

type Schluessel = keyof MietverhaeltnisStand;
type Gruppe = "miete" | "vertrag";

/**
 * Ein Feld des Formulars.
 *
 * Als Beschreibung und nicht als elfmal abgeschriebenes JSX: Welche Felder
 * es gibt, in welche Aktion sie gehen und wie ihr Wert zu lesen ist, steht
 * dann an einer Stelle. Ein neues Feld in der Schnittstelle ist hier eine
 * Zeile -- und kann nicht versehentlich aus der Aenderungserkennung
 * herausfallen, weil dieselbe Liste beides speist.
 */
interface Feld {
  name: Schluessel;
  titel: string;
  art: "text" | "datum" | "zahl";
  gruppe: Gruppe;
  platzhalter?: string;
}

const FELDER: Feld[] = [
  // --- mietverhaeltnis_aendern ---
  { name: "ende", titel: "Ende (Auszug)", art: "datum", gruppe: "miete" },
  { name: "kaltmiete", titel: "Kaltmiete (EUR je Monat)", art: "zahl", gruppe: "miete", platzhalter: "z. B. 420" },
  { name: "nebenkosten", titel: "Nebenkosten (EUR je Monat)", art: "zahl", gruppe: "miete", platzhalter: "z. B. 80" },
  // --- vertragsdaten_aendern ---
  { name: "voller_name", titel: "Voller Name (wie im Pass)", art: "text", gruppe: "vertrag" },
  { name: "geburtsdatum", titel: "Geburtsdatum", art: "datum", gruppe: "vertrag" },
  { name: "geburtsort", titel: "Geburtsort", art: "text", gruppe: "vertrag", platzhalter: "z. B. Marburg" },
  { name: "anschrift_vorher", titel: "Anschrift vor Einzug", art: "text", gruppe: "vertrag", platzhalter: "Straße, PLZ Ort" },
  { name: "melde_zusatz", titel: "Meldezusatz (Lage im Haus)", art: "text", gruppe: "vertrag", platzhalter: "z. B. 4. OG links" },
  { name: "vertrag_datum", titel: "Vertrag vom", art: "datum", gruppe: "vertrag" },
  { name: "moeblierungszuschlag", titel: "Möblierungszuschlag (EUR je Monat)", art: "zahl", gruppe: "vertrag", platzhalter: "z. B. 50" },
  { name: "kaution", titel: "Kaution (EUR)", art: "zahl", gruppe: "vertrag", platzhalter: "z. B. 840" },
];

/**
 * Welcher Eintrag der Pruefliste wo zu erledigen ist.
 *
 * Erste Regel gewinnt, deshalb ist die Reihenfolge wichtig:
 * "Kautionsraten: 2 vereinbart ..." faengt mit "Kaution" an und muss
 * davor stehen, sonst behauptet die Liste, die Raten seien hier zu
 * aendern -- und das waere falsch, kaution_raten nimmt keine Aktion an.
 *
 * `feld === null` heisst: geht weiterhin nur per SQL. Der Grund steht
 * dabei, damit niemand ihn raten muss.
 */
const REGELN: Array<{ anfang: string; feld: string | null; grund?: string }> = [
  {
    anfang: "Kautionsraten",
    feld: null,
    grund: "kaution_raten nimmt keine der beiden Aktionen an",
  },
  { anfang: "Voller Name", feld: "Voller Name (wie im Pass)" },
  { anfang: "Anschrift vor Einzug", feld: "Anschrift vor Einzug" },
  { anfang: "Geburtsdatum", feld: "Geburtsdatum" },
  { anfang: "Geburtsort", feld: "Geburtsort" },
  { anfang: "Vertragsdatum", feld: "Vertrag vom" },
  { anfang: "Meldezusatz", feld: "Meldezusatz (Lage im Haus)" },
  { anfang: "Möblierungszuschlag", feld: "Möblierungszuschlag (EUR je Monat)" },
  { anfang: "Kaution", feld: "Kaution (EUR)" },
  { anfang: "Enddatum", feld: "Ende (Auszug)" },
  { anfang: "Nettokaltmiete", feld: "Kaltmiete (EUR je Monat)" },
  { anfang: "Betriebskostenpauschale", feld: "Nebenkosten (EUR je Monat)" },
  // Die Gesamtmiete ist keine eigene Spalte im Formular: lib/sollstellung.ts
  // rechnet sie aus Kalt + Nebenkosten + Zuschlag. Wer die drei eintraegt,
  // behebt sie mit.
  { anfang: "Gesamtmiete", feld: "Kaltmiete, Nebenkosten und Möblierungszuschlag" },
  {
    anfang: "E-Mail-Adresse",
    feld: null,
    grund: "hängt an kontakt_email, nicht am Mietverhältnis",
  },
  {
    anfang: "Zimmernummer",
    feld: null,
    grund: "wird aus einheit.bezeichnung abgeleitet (zimmernummer())",
  },
  {
    anfang: "Mietbeginn",
    feld: null,
    grund: "beginn nimmt keine der beiden Aktionen an",
  },
  {
    anfang: "Einzugsdatum",
    feld: null,
    grund: "ist der Mietbeginn, und den nimmt keine der beiden Aktionen an",
  },
];

function regelFuer(eintrag: string) {
  return (
    REGELN.find((r) => eintrag.startsWith(r.anfang)) ?? {
      anfang: "",
      feld: null,
      grund: "zu dieser Angabe gibt es hier kein Feld",
    }
  );
}

/**
 * "1250,50" und "1250.50" werden beide zu 1250.5.
 *
 * Beide Aktionen erwarten eine Zahl (`$n::numeric` mit `?? null`), keinen
 * Text. Ein deutsches Komma, als Zeichenkette geschickt, landete sonst als
 * NaN im Koerper und damit als null -- und null heisst "unveraendert". Die
 * Eingabe waere stillschweigend verschwunden.
 */
function alsZahl(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Numerischer Text aus der Datenbank, aufbereitet fuer ein Eingabefeld. */
const insFeld = (wert: string | null, art: Feld["art"]) => {
  if (wert === null || wert === undefined) return "";
  return art === "zahl" ? String(Number(wert)) : String(wert);
};

type Teilergebnis = { was: string; ok: boolean; text: string };

export function MietverhaeltnisBearbeiten(p: Props) {
  const router = useRouter();
  const [laeuft, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [offen, setOffen] = useState(false);
  const [ergebnis, setErgebnis] = useState<Teilergebnis[] | null>(null);

  function frisch(): Record<Schluessel, string> {
    const o = {} as Record<Schluessel, string>;
    for (const f of FELDER) o[f.name] = insFeld(p.stand[f.name], f.art);
    return o;
  }
  const [werte, setWerte] = useState<Record<Schluessel, string>>(frisch);

  const blockiert = busy || laeuft;
  const setzen = (name: Schluessel, wert: string) =>
    setWerte((w) => ({ ...w, [name]: wert }));

  // --- Was hat sich gegenueber dem gespeicherten Stand geaendert? --------
  //
  // Nur das wird geschickt. Beide Aktionen deuten einen nicht gesendeten
  // Wert als "unveraendert", und so bleibt eine Spalte, die hier niemand
  // angefasst hat, auch wirklich unberuehrt.
  const aenderungen: Record<Gruppe, Record<string, string | number>> = {
    miete: {},
    vertrag: {},
  };
  const fehlerhaft: string[] = [];

  for (const f of FELDER) {
    const roh = werte[f.name];
    const gespeichert = p.stand[f.name];

    if (f.art === "zahl") {
      const n = alsZahl(roh);
      if (roh.trim() !== "" && n === null) {
        fehlerhaft.push(`„${f.titel}“ ist keine Zahl.`);
        continue;
      }
      if (n === null) continue;
      if (n < 0) {
        fehlerhaft.push(`„${f.titel}“ kann nicht negativ sein.`);
        continue;
      }
      const alt = gespeichert === null ? null : Number(gespeichert);
      if (n !== alt) aenderungen[f.gruppe][f.name] = n;
      continue;
    }

    const neu = f.art === "datum" ? roh : roh.trim();
    if (neu === "") continue;
    if (neu !== (gespeichert ?? "")) aenderungen[f.gruppe][f.name] = neu;
  }

  if (werte.ende !== "" && werte.ende < p.beginn) {
    fehlerhaft.push("Das Enddatum liegt vor dem Mietbeginn.");
  }
  if (werte.geburtsdatum !== "" && werte.geburtsdatum >= p.beginn) {
    // Ein Geburtsdatum nach dem Einzug ist ein Tippfehler, und zwar einer,
    // der ungeprueft in den Mietvertrag wandert.
    fehlerhaft.push("Das Geburtsdatum liegt nach dem Mietbeginn.");
  }

  const anzahlMiete = Object.keys(aenderungen.miete).length;
  const anzahlVertrag = Object.keys(aenderungen.vertrag).length;
  const anzahl = anzahlMiete + anzahlVertrag;
  const bereit = anzahl > 0 && fehlerhaft.length === 0;

  // Der Zuschlag geht in die Sollstellung ein. Aendert sich sonst nichts
  // an Geld oder Laufzeit, laeuft von allein kein Lauf -- siehe Kopf.
  const brauchtNachlauf =
    "moeblierungszuschlag" in aenderungen.vertrag && anzahlMiete === 0;

  async function sende(koerper: Record<string, unknown>): Promise<string | null> {
    const r = await fetch("/api/stammdaten", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(koerper),
    });
    const d = (await r.json().catch(() => ({}))) as {
      ok?: boolean;
      fehler?: string;
    };
    if (!r.ok || !d.ok) return d.fehler ?? "Das hat nicht geklappt.";
    return null;
  }

  async function speichern() {
    setBusy(true);
    setErgebnis(null);
    const teile: Teilergebnis[] = [];
    try {
      // Erst die Vertragsdaten: Der Moeblierungszuschlag muss stehen,
      // bevor der Sollstellungslauf der anderen Aktion rechnet.
      if (anzahlVertrag > 0) {
        const fehler = await sende({
          aktion: "vertragsdaten_aendern",
          mietverhaeltnis_id: p.id,
          ...aenderungen.vertrag,
        });
        teile.push({
          was: "Vertragsdaten",
          ok: fehler === null,
          text:
            fehler ??
            `${anzahlVertrag} Feld${anzahlVertrag === 1 ? "" : "er"} gespeichert.`,
        });
      }

      if (anzahlMiete > 0) {
        const fehler = await sende({
          aktion: "mietverhaeltnis_aendern",
          mietverhaeltnis_id: p.id,
          ...aenderungen.miete,
        });
        teile.push({
          was: "Geld und Laufzeit",
          ok: fehler === null,
          text:
            fehler ??
            `${anzahlMiete} Feld${anzahlMiete === 1 ? "" : "er"} gespeichert, ` +
              "die Sollstellungen sind nachgezogen.",
        });
      } else if (brauchtNachlauf) {
        // Kein Feld im Koerper: alle Werte null, COALESCE laesst alles
        // stehen. Dieser Aufruf aendert nichts und loest nur den
        // Sollstellungslauf aus, damit der neue Zuschlag auch gefordert
        // wird und nicht bloss in den Stammdaten steht.
        const fehler = await sende({
          aktion: "mietverhaeltnis_aendern",
          mietverhaeltnis_id: p.id,
        });
        teile.push({
          was: "Sollstellungen",
          ok: fehler === null,
          text:
            fehler ??
            "Nachgezogen — der neue Möblierungszuschlag geht in die " +
              "Forderung ein.",
        });
      }

      setErgebnis(teile);
      if (teile.every((t) => t.ok)) setOffen(false);
      start(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  // Beide Prueflisten in einer Ansicht, ohne Doppelung: Steht "Voller
  // Name" in beiden, erscheint er einmal mit dem Vermerk, dass er beide
  // Dokumente blockiert.
  const prueflisten = new Map<string, string[]>();
  for (const e of p.fehltVertrag) prueflisten.set(e, ["Mietvertrag"]);
  for (const e of p.fehltWgb) {
    prueflisten.set(e, [...(prueflisten.get(e) ?? []), "Wohnungsgeberbestätigung"]);
  }
  const nurSql = [...prueflisten.keys()].filter((e) => regelFuer(e).feld === null);

  function gruppe(g: Gruppe) {
    return (
      <div className="feldraster">
        {FELDER.filter((f) => f.gruppe === g).map((f) => (
          <label className="feld" key={f.name}>
            {f.titel}
            <input
              type={f.art === "datum" ? "date" : "text"}
              inputMode={f.art === "zahl" ? "decimal" : undefined}
              value={werte[f.name]}
              min={f.name === "ende" ? p.beginn : undefined}
              placeholder={f.platzhalter}
              onChange={(e) => setzen(f.name, e.target.value)}
              disabled={blockiert}
            />
          </label>
        ))}
      </div>
    );
  }

  return (
    <section className="abschnitt">
      <div className="titelzeile">
        <h2>Ändern</h2>
        {prueflisten.size > 0 && (
          <span className="zaehler ziffern">
            {prueflisten.size} Angabe{prueflisten.size === 1 ? "" : "n"} fehlt
          </span>
        )}
      </div>

      {!offen ? (
        <div className="knopfreihe">
          <button onClick={() => setOffen(true)}>
            Mietverhältnis bearbeiten
          </button>
          <span className="rueckmeldung">
            Mieterhöhung, Nebenkosten, Auszug und die Vertragsangaben, an
            denen Mietvertrag und Wohnungsgeberbestätigung hängen.
          </span>
        </div>
      ) : (
        <>
          <div className="titelzeile" style={{ marginTop: "0.5rem" }}>
            <h2 style={{ fontSize: "1rem" }}>Geld und Laufzeit</h2>
          </div>
          {gruppe("miete")}

          <div className="titelzeile" style={{ marginTop: "1.5rem" }}>
            <h2 style={{ fontSize: "1rem" }}>Vertragsdaten</h2>
          </div>
          {gruppe("vertrag")}
          <p className="erklaerung">
            Geburtsdatum und Geburtsort stehen nur in diesem Formular und
            nicht im Datenblatt oben — sie gehören in den Mietvertrag und
            nicht auf eine Seite, die beim Draufschauen offen liegt. Der
            volle Name ist der Passname: Er steht an sechs Stellen im
            Vertrag und über der Unterschriftslinie.
          </p>

          <p className="erklaerung">
            Ein leeres Feld heißt <strong>unverändert</strong>, nicht
            &bdquo;leeren&ldquo;: Beide Aktionen schreiben{" "}
            <code>COALESCE</code> und lassen den alten Wert stehen. Ein
            gesetztes Enddatum lässt sich hier deshalb nicht mehr
            zurücknehmen — dafür braucht es weiterhin die Datenbank.
          </p>

          {fehlerhaft.length > 0 && (
            <div className="meldung" data-art="warnung">
              <strong>Noch nicht abschickbar</strong>
              {fehlerhaft.join(" ")}
            </div>
          )}

          <div className="knopfreihe">
            <button onClick={speichern} disabled={blockiert || !bereit}>
              {busy ? "speichert …" : "Änderung speichern"}
            </button>
            <button
              data-art="still"
              onClick={() => {
                setOffen(false);
                setWerte(frisch());
                setErgebnis(null);
              }}
              disabled={blockiert}
            >
              Abbrechen
            </button>
            {anzahl === 0 && fehlerhaft.length === 0 && (
              <span className="rueckmeldung">
                Noch nichts geändert gegenüber dem gespeicherten Stand.
              </span>
            )}
            {anzahl > 0 && fehlerhaft.length === 0 && (
              <span className="rueckmeldung" data-art="warn">
                {anzahlVertrag > 0 && anzahlMiete > 0
                  ? `${anzahlVertrag} Vertragsangabe(n) und ${anzahlMiete} Betrag/Datum — zwei Aufrufe, getrennt gemeldet.`
                  : `${anzahl} Feld${anzahl === 1 ? "" : "er"} wird überschrieben.`}
              </span>
            )}
          </div>
        </>
      )}

      {/* Jeder Teil meldet sein eigenes Ergebnis. Eine pauschale
          Erfolgsmeldung waere falsch, sobald einer der beiden Aufrufe
          scheitert -- und genau dann braucht der Nutzer die Wahrheit. */}
      {ergebnis && ergebnis.length > 0 && (
        <div
          className="meldung"
          data-art={
            ergebnis.every((t) => t.ok)
              ? "gut"
              : ergebnis.some((t) => t.ok)
                ? "warnung"
                : "fehler"
          }
        >
          <strong>
            {ergebnis.every((t) => t.ok)
              ? "Gespeichert"
              : ergebnis.some((t) => t.ok)
                ? "Teils gespeichert"
                : "Nicht gespeichert"}
          </strong>
          {ergebnis.map((t) => (
            <span key={t.was} style={{ display: "block" }}>
              {t.was}: {t.ok ? "" : "nicht gespeichert — "}
              {t.text}
            </span>
          ))}
        </div>
      )}

      {/* --- Prüfliste: was die Dokumente blockiert -------------------- */}
      {prueflisten.size > 0 && (
        <>
          <div className="titelzeile" style={{ marginTop: "1.75rem" }}>
            <h2 style={{ fontSize: "1rem" }}>Was die Dokumente blockiert</h2>
          </div>
          <div className="register">
            {[...prueflisten.entries()].map(([eintrag, dokumente]) => {
              const r = regelFuer(eintrag);
              return (
                <div className="posten" data-still="ja" key={eintrag}>
                  <span className="nummer">{r.feld ? "hier" : "SQL"}</span>
                  <span className="betreff">{eintrag}</span>
                  <span className="unterzeile">
                    <span>{dokumente.join(" · ")}</span>
                    {r.feld ? (
                      <span className="rueckmeldung" data-art="gut">
                        über das Feld „{r.feld}“ oben zu beheben
                      </span>
                    ) : (
                      <span className="rueckmeldung" data-art="warn">
                        nur per SQL — {r.grund}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="erklaerung">
            Die Liste ist der Wortlaut von <code>fehlendeFelder()</code> und{" "}
            <code>fehlendeFelderWgb()</code> — derselben Prüfung, die das
            Erzeugen verhindert.{" "}
            {nurSql.length === 0 ? (
              <>
                Alles davon ist hier zu beheben; ein Weg in die Datenbank ist
                für keine dieser Angaben mehr nötig.
              </>
            ) : (
              <>
                Die mit &bdquo;SQL&ldquo; gekennzeichneten Angaben nimmt
                keine der beiden Aktionen an. Dass sie hier stehen, ist
                Absicht: Der Mangel soll benannt bleiben, auch solange er
                hier nicht zu beheben ist.
              </>
            )}
          </p>
        </>
      )}
    </section>
  );
}
