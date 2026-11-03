"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Das Mietverhaeltnis aendern -- Mieterhoehung, Auszug, Nebenkosten.
 *
 * Bis hierhin ging das nur per SQL. Die Aktion dafuer gab es schon
 * (`mietverhaeltnis_aendern` in app/api/stammdaten/route.ts), aufgerufen
 * hat sie niemand: null Treffer in app/ und components/. Das Anlegeformular
 * sagte dem Nutzer woertlich, er solle "ein Enddatum eintragen" -- ein Feld,
 * das es nirgends gab.
 *
 * WAS DIESES FORMULAR SPEICHERN KANN, UND WAS NICHT
 *
 * Die Aktion kennt genau fuenf Spalten: ende, kaltmiete, nebenkosten,
 * zahlt_im_voraus und zahlungsnotiz. Sie kennt NICHT
 * moeblierungszuschlag, vertrag_datum, befristet, kaution, melde_zusatz,
 * anschrift_vorher und auch nichts an kontakt (Geburtsdatum, Geburtsort)
 * oder kontakt_email. Genau diese Felder stehen aber in der Pruefliste,
 * die Mietvertrag und Wohnungsgeberbestaetigung blockiert.
 *
 * Darum stehen sie hier als Text und nicht als Eingabefeld. Ein Feld, das
 * sich fuellen laesst und beim Speichern verschwindet, waere derselbe
 * stille Fehler, den diese Seite abstellen soll -- nur an einer neuen
 * Stelle. Die Liste unten sagt zu jeder fehlenden Angabe, ob sie hier zu
 * beheben ist.
 *
 * ZWEITE EIGENART DER AKTION: COALESCE
 *
 * Die Aktion schreibt `ende = COALESCE($2::date, ende)`. Ein leeres Feld
 * heisst also "unveraendert" und nicht "leeren". Ein gesetztes Enddatum
 * laesst sich darueber nicht mehr zuruecknehmen. Das steht als Hinweis in
 * der Oberflaeche, statt es den Nutzer herausfinden zu lassen.
 */

interface Props {
  id: string;
  /** Mietbeginn -- untere Grenze fuer das Enddatum. */
  beginn: string;
  ende: string | null;
  kaltmiete: string | null;
  nebenkosten: string | null;
  moeblierungszuschlag: string | null;
  /** fehlendeFelder() vom Mietvertrag, im Wortlaut der Pruefung. */
  fehltVertrag: string[];
  /** fehlendeFelderWgb() von der Wohnungsgeberbestaetigung. */
  fehltWgb: string[];
}

/**
 * Welche Eintraege der Pruefliste dieses Formular wirklich beheben kann.
 *
 * Verglichen wird ueber den Anfang des Textes, weil fehlendeFelder() bei
 * zwei Eintraegen eine Begruendung anhaengt ("Enddatum (Vertrag ist als
 * befristet erfasst)").
 */
const BEHEBBAR: Array<{ anfang: string; feld: string }> = [
  { anfang: "Enddatum", feld: "Ende des Mietverhältnisses" },
  { anfang: "Nettokaltmiete", feld: "Kaltmiete" },
  { anfang: "Betriebskostenpauschale", feld: "Nebenkosten" },
  // Die Gesamtmiete steht nicht als Spalte im Formular: lib/sollstellung.ts
  // rechnet sie aus Kalt + Nebenkosten + Zuschlag. Wer die beiden Betraege
  // hier eintraegt, behebt sie mit.
  { anfang: "Gesamtmiete", feld: "Kaltmiete und Nebenkosten" },
];

function behebbarDurch(eintrag: string): string | null {
  const t = BEHEBBAR.find((b) => eintrag.startsWith(b.anfang));
  return t ? t.feld : null;
}

/**
 * "1250,50" und "1250.50" werden beide zu 1250.5.
 *
 * Die Aktion erwartet eine Zahl (`$3::numeric` mit `b.kaltmiete ?? null`),
 * kein Text. Ein deutsches Komma, als Zeichenkette geschickt, landete
 * sonst als NaN im Koerper und damit als null -- und null heisst in der
 * Aktion "unveraendert". Die Eingabe waere stillschweigend verschwunden.
 */
function alsZahl(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Numerischer Text aus der Datenbank, aufbereitet fuer ein Eingabefeld. */
const insFeld = (wert: string | null) =>
  wert === null || wert === undefined ? "" : String(Number(wert));

const euro = (betrag: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    betrag,
  );

export function MietverhaeltnisBearbeiten(p: Props) {
  const router = useRouter();
  const [laeuft, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [offen, setOffen] = useState(false);
  const [meldung, setMeldung] = useState<
    { art: "gut" | "fehler"; text: string } | null
  >(null);

  const [ende, setEnde] = useState(p.ende ?? "");
  const [kaltmiete, setKaltmiete] = useState(insFeld(p.kaltmiete));
  const [nebenkosten, setNebenkosten] = useState(insFeld(p.nebenkosten));

  const blockiert = busy || laeuft;

  const zahlen = {
    kaltmiete: alsZahl(kaltmiete),
    nebenkosten: alsZahl(nebenkosten),
  };

  // Was sich gegenueber dem Stand in der Datenbank geaendert hat. Nur das
  // wird geschickt: Die Aktion deutet jeden nicht gesendeten Wert als
  // "unveraendert", und so bleibt eine Spalte, die hier nicht angefasst
  // wurde, auch wirklich unberuehrt.
  const aenderungen: Record<string, string | number> = {};
  if (ende !== "" && ende !== (p.ende ?? "")) aenderungen.ende = ende;
  if (
    zahlen.kaltmiete !== null &&
    zahlen.kaltmiete !== (p.kaltmiete === null ? null : Number(p.kaltmiete))
  ) {
    aenderungen.kaltmiete = zahlen.kaltmiete;
  }
  if (
    zahlen.nebenkosten !== null &&
    zahlen.nebenkosten !== (p.nebenkosten === null ? null : Number(p.nebenkosten))
  ) {
    aenderungen.nebenkosten = zahlen.nebenkosten;
  }

  const fehlerhaft: string[] = [];
  if (kaltmiete.trim() !== "" && zahlen.kaltmiete === null) {
    fehlerhaft.push("Die Kaltmiete ist keine Zahl.");
  }
  if (nebenkosten.trim() !== "" && zahlen.nebenkosten === null) {
    fehlerhaft.push("Die Nebenkosten sind keine Zahl.");
  }
  if (zahlen.kaltmiete !== null && zahlen.kaltmiete < 0) {
    fehlerhaft.push("Eine negative Kaltmiete gibt es nicht.");
  }
  if (zahlen.nebenkosten !== null && zahlen.nebenkosten < 0) {
    fehlerhaft.push("Negative Nebenkosten gibt es nicht.");
  }
  if (ende !== "" && ende < p.beginn) {
    fehlerhaft.push("Das Enddatum liegt vor dem Mietbeginn.");
  }

  const anzahl = Object.keys(aenderungen).length;
  const bereit = anzahl > 0 && fehlerhaft.length === 0;

  async function speichern() {
    setBusy(true);
    setMeldung(null);
    try {
      const r = await fetch("/api/stammdaten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aktion: "mietverhaeltnis_aendern",
          mietverhaeltnis_id: p.id,
          ...aenderungen,
        }),
      });
      const d = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        fehler?: string;
        soll?: unknown;
      };
      if (!r.ok || !d.ok) {
        setMeldung({ art: "fehler", text: d.fehler ?? "Das hat nicht geklappt." });
        return;
      }
      setMeldung({
        art: "gut",
        text:
          "Gespeichert. Die Sollstellungen sind nachgezogen — ab dem " +
          "nächsten Monat rechnet der Kontoabgleich mit den neuen Beträgen.",
      });
      setOffen(false);
      start(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  const zuschlag =
    p.moeblierungszuschlag === null ? null : Number(p.moeblierungszuschlag);

  // Beide Prueflisten in einer Ansicht, ohne Doppelung: Steht "Voller
  // Name" in beiden, soll er einmal mit dem Vermerk erscheinen, dass er
  // beide Dokumente blockiert.
  const prueflisten = new Map<string, string[]>();
  for (const e of p.fehltVertrag) prueflisten.set(e, ["Mietvertrag"]);
  for (const e of p.fehltWgb) {
    prueflisten.set(e, [...(prueflisten.get(e) ?? []), "Wohnungsgeberbestätigung"]);
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
            Mieterhöhung, Nebenkosten und Auszug — Enddatum eintragen beendet
            das Mietverhältnis.
          </span>
        </div>
      ) : (
        <>
          <div className="feldraster">
            <label className="feld">
              Ende (Auszug)
              <input
                type="date"
                value={ende}
                min={p.beginn}
                onChange={(e) => setEnde(e.target.value)}
                disabled={blockiert}
              />
            </label>
            <label className="feld">
              Kaltmiete (EUR je Monat)
              <input
                type="text"
                inputMode="decimal"
                value={kaltmiete}
                onChange={(e) => setKaltmiete(e.target.value)}
                placeholder="z. B. 420"
                disabled={blockiert}
              />
            </label>
            <label className="feld">
              Nebenkosten (EUR je Monat)
              <input
                type="text"
                inputMode="decimal"
                value={nebenkosten}
                onChange={(e) => setNebenkosten(e.target.value)}
                placeholder="z. B. 80"
                disabled={blockiert}
              />
            </label>
          </div>

          <p className="erklaerung">
            Ein leeres Feld heißt <strong>unverändert</strong>, nicht
            &bdquo;leeren&ldquo;: Die Schnittstelle schreibt{" "}
            <code>COALESCE</code> und lässt den alten Wert stehen. Ein
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
                setEnde(p.ende ?? "");
                setKaltmiete(insFeld(p.kaltmiete));
                setNebenkosten(insFeld(p.nebenkosten));
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
                {anzahl} Feld{anzahl === 1 ? "" : "er"} wird überschrieben.
              </span>
            )}
          </div>
        </>
      )}

      {meldung && (
        <div
          className="meldung"
          data-art={meldung.art === "gut" ? "gut" : "fehler"}
        >
          <strong>
            {meldung.art === "gut" ? "Gespeichert" : "Nicht gespeichert"}
          </strong>
          {meldung.text}
        </div>
      )}

      {/* --- Möblierungszuschlag: sichtbar, aber hier nicht änderbar --- */}
      <dl className="datenblatt" style={{ marginTop: "1.25rem" }}>
        <dt className="hinweis">Möblierungszuschlag</dt>
        <dd>
          {zuschlag === null ? (
            <span className="hinweis">nicht eingetragen</span>
          ) : (
            <span className="ziffern">{euro(zuschlag)}</span>
          )}
        </dd>
      </dl>
      <p className="erklaerung">
        Der Möblierungszuschlag steht hier nur zum Lesen. Die Aktion{" "}
        <code>mietverhaeltnis_aendern</code> nimmt das Feld nicht an — ein
        Eingabefeld dafür würde sich füllen lassen und beim Speichern
        verschwinden, und das ist genau der stille Fehler, den diese Seite
        abstellen soll. Zum Ändern fehlt der Schnittstelle eine Zeile.
      </p>

      {/* --- Prüfliste: was die Dokumente blockiert -------------------- */}
      {prueflisten.size > 0 && (
        <>
          <div className="titelzeile" style={{ marginTop: "1.75rem" }}>
            <h2 style={{ fontSize: "1rem" }}>Was die Dokumente blockiert</h2>
          </div>
          <div className="register">
            {[...prueflisten.entries()].map(([eintrag, dokumente]) => {
              const feld = behebbarDurch(eintrag);
              return (
                <div className="posten" data-still="ja" key={eintrag}>
                  <span className="nummer">
                    {feld ? "hier" : "SQL"}
                  </span>
                  <span className="betreff">{eintrag}</span>
                  <span className="unterzeile">
                    <span>{dokumente.join(" · ")}</span>
                    {feld ? (
                      <span className="rueckmeldung" data-art="gut">
                        über das Feld „{feld}“ oben zu beheben
                      </span>
                    ) : (
                      <span className="rueckmeldung" data-art="warn">
                        noch nicht über dieses Formular
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
            Erzeugen verhindert. Die mit &bdquo;SQL&ldquo; gekennzeichneten
            Angaben liegen an Spalten, die <code>mietverhaeltnis_aendern</code>{" "}
            nicht annimmt (Vertragsdatum, Kaution, Meldezusatz, Anschrift vor
            Einzug) oder gar nicht am Mietverhältnis hängen (Geburtsdatum,
            Geburtsort, E-Mail, Zimmernummer). Dass sie hier stehen, ist
            Absicht: Der Mangel soll benannt bleiben, auch solange er hier
            nicht zu beheben ist.
          </p>
        </>
      )}
    </section>
  );
}
