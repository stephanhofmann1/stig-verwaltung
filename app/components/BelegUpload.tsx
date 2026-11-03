"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Belege hochladen -- in zwei Schritten.
 *
 * Erst lesen und zeigen, was erkannt wurde: Aussteller, Belegnummer,
 * Datum, Betrag und welche Kontobewegung dazu passen könnte. Jedes Feld
 * ist dabei änderbar. Erst der zweite Klick speichert.
 *
 * Was nicht erkannt wurde, bleibt leer und ist als leer gekennzeichnet.
 * Ein Foto einer Quittung hat keine Textebene -- dann steht ausdrücklich
 * "nicht auslesbar" an der Datei, und die vier Felder trägt ein Mensch
 * ein. Geraten wird nichts.
 */

type Feld = "aussteller" | "belegnummer" | "belegdatum" | "betrag_brutto";

interface Befund {
  aussteller: string | null;
  belegnummer: string | null;
  belegdatum: string | null;
  betrag_brutto: number | null;
  quelle: Record<Feld, "text" | "modell" | null>;
}

interface Vorschlag {
  buchung_id: string;
  buchungstag: string;
  betrag: string;
  sicherheit: "sicher" | "unsicher";
  begruendung: string;
}

interface VorschauDatei {
  dateiname: string;
  groesse_bytes: number;
  art?: "pdf" | "bild" | "unbekannt";
  seiten?: number;
  ohne_textebene?: boolean;
  lesefehler?: string | null;
  bereits_vorhanden?: boolean;
  erkannt?: Befund;
  textprobe?: string;
  vorschlag?: Vorschlag | null;
  abgelehnt: string | null;
}

interface Vorschau {
  vorschau: true;
  modell_aktiv: boolean;
  dateien: VorschauDatei[];
}

interface Ergebnis {
  gespeichert: Array<{ dateiname: string; aussteller: string | null; betrag_brutto: number | null }>;
  abgelehnt: Array<{ dateiname: string; grund: string }>;
  abgleich: { uebernommen: number; offen: number };
  zuordnungen: Array<{ begruendung: string; sicherheit: string; beleg_bezeichnung?: string }>;
}

/** Was im Formular steht — die Vorschau ist nur der Vorschlag dafür. */
interface Eingabe {
  dateiname: string;
  aussteller: string;
  belegnummer: string;
  belegdatum: string;
  betrag_brutto: string;
  /** Zu welchem Objekt der Beleg gehört -- ohne das keine Abrechnung. */
  objekt_id: string;
  kostenart: string;
  /** "ja" | "nein" | "" -- leer heisst ungeklärt, nicht "nein". */
  umlagefaehig: string;
}

const euro = (w: string | number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    Number(w),
  );

/*
 * Das Stilobjekt `feld` ist ersatzlos weg. Es setzte var(--papier) -- den
 * SEITENhintergrund -- als Feldfarbe und ueberschrieb den kraeftigen
 * Feldrand mit der Haarlinie: graue Felder mit kaum sichtbarem Rand.
 * Abschnitt 12 von globals.css gestaltet die Felder vollstaendig, .feld
 * gibt ihnen die ganze Spaltenbreite.
 */

const HERKUNFT: Record<"text" | "modell", string> = {
  text: "aus dem Beleg gelesen",
  modell: "vom Sprachmodell ergänzt — bitte nachsehen",
};

function aus(d: VorschauDatei): Eingabe {
  return {
    dateiname: d.dateiname,
    aussteller: d.erkannt?.aussteller ?? "",
    belegnummer: d.erkannt?.belegnummer ?? "",
    belegdatum: d.erkannt?.belegdatum ?? "",
    betrag_brutto:
      d.erkannt?.betrag_brutto !== null && d.erkannt?.betrag_brutto !== undefined
        ? d.erkannt.betrag_brutto.toFixed(2)
        : "",
    // Bewusst leer: Objekt und Kostenart lassen sich aus einer Rechnung
    // nicht ablesen. Ein Vorgabewert wäre hier geraten -- und eine zu
    // Unrecht umgelegte Position fällt erst auf, wenn ein Mieter die
    // Abrechnung prüft.
    objekt_id: "",
    kostenart: "",
    umlagefaehig: "",
  };
}

export function BelegUpload({
  objekte,
  kostenarten,
}: {
  objekte: { id: string; name: string }[];
  kostenarten: {
    schluessel: string;
    text: string;
    umlagefaehig: boolean | null;
    hinweis?: string;
  }[];
}) {
  const router = useRouter();
  const [dateien, setDateien] = useState<File[]>([]);
  const [stand, setStand] = useState<"bereit" | "liest" | "schreibt">("bereit");
  const [vorschau, setVorschau] = useState<Vorschau | null>(null);
  const [eingaben, setEingaben] = useState<Eingabe[]>([]);
  const [ergebnis, setErgebnis] = useState<Ergebnis | null>(null);
  const [fehler, setFehler] = useState("");

  function zuruecksetzen(neu: File[]) {
    setDateien(neu);
    setVorschau(null);
    setEingaben([]);
    setErgebnis(null);
    setFehler("");
  }

  async function schicke(pruefen: boolean) {
    if (dateien.length === 0) return;
    const koerper = new FormData();
    for (const d of dateien) koerper.append("dateien", d);
    if (pruefen) koerper.set("pruefen", "1");
    else koerper.set("felder", JSON.stringify(eingaben));

    setStand(pruefen ? "liest" : "schreibt");
    setFehler("");
    const r = await fetch("/api/belege/upload", { method: "POST", body: koerper });
    const d = await r.json().catch(() => null);
    setStand("bereit");

    if (!r.ok || !d) {
      setFehler((d && d.fehler) || `Fehler ${r.status}`);
      return;
    }
    if (pruefen) {
      const v = d as Vorschau;
      setVorschau(v);
      setEingaben(v.dateien.map(aus));
      setErgebnis(null);
    } else {
      setErgebnis(d as Ergebnis);
      setVorschau(null);
      setEingaben([]);
      setDateien([]);
      router.refresh();
    }
  }

  function aendere(i: number, f: keyof Eingabe, wert: string) {
    setEingaben((alt) => alt.map((e, j) => (j === i ? { ...e, [f]: wert } : e)));
  }

  return (
    <div>
      <label>
        Belege
        <input
          type="file"
          multiple
          accept="application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.heic,.tif,.tiff,.webp"
          onChange={(e) => zuruecksetzen(Array.from(e.target.files ?? []))}
          className="feld"
        />
        <span className="hinweis">
          Rechnungen als PDF oder Quittungen als Foto, mehrere auf einmal, je
          bis 25 MB. Der Dateityp wird am Inhalt geprüft, nicht an der
          Endung. Ein PDF mit Textebene wird ausgelesen; bei einem Foto
          bleiben die Felder leer und werden hier eingetragen.
        </span>
      </label>

      {fehler && (
        <p className="rueckmeldung" data-art="fehler">
          {fehler}
        </p>
      )}

      {!vorschau && dateien.length > 0 && (
        <p>
          <button onClick={() => schicke(true)} disabled={stand !== "bereit"}>
            {stand === "liest"
              ? "liest …"
              : `${dateien.length} ${dateien.length === 1 ? "Datei" : "Dateien"} lesen`}
          </button>
        </p>
      )}

      {vorschau && (
        <div className="abschnitt">
          <h3>Gelesen, noch nicht gespeichert</h3>
          {/* Hier stand der Name der Umgebungsvariablen ANTHROPIC_API_KEY.
              Das ist eine Betriebsangabe und keine Auskunft fuer den
              Vermieter -- die Aussage ("das Sprachmodell ist nicht
              angeschlossen, es gilt nur das Regelwerk") bleibt. */}
          <p className="hinweis">
            {vorschau.modell_aktiv
              ? "Regelwerk, danach das Sprachmodell für die offen gebliebenen Felder."
              : "Nur das Regelwerk — das Sprachmodell ist nicht angeschlossen."}{" "}
            Bitte jedes Feld ansehen, bevor du übernimmst — anschließend steht
            es in der Buchhaltung.
          </p>

          {vorschau.dateien.map((d, i) => {
            const e = eingaben[i];
            if (d.abgelehnt || !e) {
              return (
                <section className="entwurf" key={`${d.dateiname}-${i}`}>
                  <div className="entwurf-kopf">
                    <strong>{d.dateiname}</strong>
                    <span className="marker" data-art="heikel">
                      nicht übernommen
                    </span>
                  </div>
                  <p className="entwurf-notiz">{d.abgelehnt}</p>
                </section>
              );
            }
            const q = d.erkannt?.quelle;
            const marke = (f: Feld) =>
              q && q[f] ? (
                <span className="hinweis">{HERKUNFT[q[f]!]}</span>
              ) : (
                <span className="marker" data-art="heikel">
                  nicht erkannt — bitte eintragen
                </span>
              );

            return (
              <section className="entwurf" key={`${d.dateiname}-${i}`}>
                <div className="entwurf-kopf">
                  <strong>{d.dateiname}</strong>
                  <span className="ziffern">
                    {(d.groesse_bytes / 1024).toFixed(0)} kB
                  </span>
                  {d.art === "pdf" && <span>PDF, {d.seiten} Seiten</span>}
                  {d.ohne_textebene && (
                    <span className="marker" data-art="heikel">
                      nicht auslesbar — keine Textebene
                    </span>
                  )}
                  {d.bereits_vorhanden && (
                    <span className="marker" data-art="heikel">
                      liegt schon in der Ablage
                    </span>
                  )}
                </div>

                {d.lesefehler && <p className="entwurf-notiz">{d.lesefehler}</p>}
                {d.ohne_textebene && (
                  <p className="entwurf-notiz">
                    Das ist ein Foto oder ein Scan ohne Textebene. Es wird
                    abgelegt, ausgelesen wird nichts — keine Zeichenerkennung,
                    weil eine falsch erkannte Ziffer hier ein falscher Betrag
                    in den Büchern wäre. Die vier Felder bitte von Hand
                    ausfüllen.
                  </p>
                )}

                <div className="feldraster">
                  <label>
                    Aussteller
                    <input
                      value={e.aussteller}
                      onChange={(x) => aendere(i, "aussteller", x.target.value)}
                      placeholder="z. B. OBI"
                      className="feld"
                    />
                    {marke("aussteller")}
                  </label>
                  <label>
                    Belegnummer
                    <input
                      value={e.belegnummer}
                      onChange={(x) => aendere(i, "belegnummer", x.target.value)}
                      placeholder="z. B. Bestellnummer"
                      className="ziffern feld"
                    />
                    {marke("belegnummer")}
                  </label>
                  <label>
                    Belegdatum
                    <input
                      type="date"
                      value={e.belegdatum}
                      onChange={(x) => aendere(i, "belegdatum", x.target.value)}
                      className="ziffern feld"
                    />
                    {marke("belegdatum")}
                  </label>
                  <label>
                    Betrag brutto
                    <input
                      value={e.betrag_brutto}
                      onChange={(x) => aendere(i, "betrag_brutto", x.target.value)}
                      inputMode="decimal"
                      placeholder="0,00"
                      className="ziffern feld"
                    />
                    {marke("betrag_brutto")}
                  </label>
                  <label>
                    Objekt
                    <select
                      value={e.objekt_id}
                      onChange={(x) => aendere(i, "objekt_id", x.target.value)}
                      className="feld"
                    >
                      <option value="">— noch offen —</option>
                      {objekte.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Kostenart
                    <select
                      value={e.kostenart}
                      onChange={(x) => {
                        const k = x.target.value;
                        aendere(i, "kostenart", k);
                        // Vorschlag für die Umlage mitführen. Der Mensch
                        // kann ihn ändern -- und wo das Gesetz keine
                        // pauschale Antwort gibt, bleibt das Feld leer.
                        const v = kostenarten.find((a) => a.schluessel === k);
                        aendere(
                          i,
                          "umlagefaehig",
                          v?.umlagefaehig === true ? "ja"
                          : v?.umlagefaehig === false ? "nein"
                          : "",
                        );
                      }}
                      className="feld"
                    >
                      <option value="">— noch offen —</option>
                      {kostenarten.map((k) => (
                        <option key={k.schluessel} value={k.schluessel}>
                          {k.text}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Umlagefähig
                    <select
                      value={e.umlagefaehig}
                      onChange={(x) => aendere(i, "umlagefaehig", x.target.value)}
                      className="feld"
                    >
                      <option value="">— ungeklärt —</option>
                      <option value="ja">ja</option>
                      <option value="nein">nein</option>
                    </select>
                  </label>
                </div>

                {(() => {
                  const k = kostenarten.find((a) => a.schluessel === e.kostenart);
                  return k?.hinweis ? (
                    <p className="hinweis">{k.hinweis}</p>
                  ) : null;
                })()}
                {e.kostenart !== "" && e.umlagefaehig === "" && (
                  <p className="hinweis">
                    Umlagefähigkeit ungeklärt — der Beleg wird gespeichert und
                    taucht später in der Nebenkostenabrechnung weder auf der
                    einen noch auf der anderen Seite auf, bis das entschieden
                    ist. Umgelegt werden darf ohnehin nur, was der Mietvertrag
                    vereinbart (§ 556 Abs. 1 BGB).
                  </p>
                )}

                {d.vorschlag ? (
                  <p className="entwurf-notiz">
                    Passt vermutlich zu der Abbuchung vom {d.vorschlag.buchungstag}{" "}
                    über {euro(d.vorschlag.betrag)} —{" "}
                    <strong>{d.vorschlag.sicherheit}</strong>.{" "}
                    {d.vorschlag.begruendung}
                  </p>
                ) : (
                  <p className="entwurf-notiz">
                    Keine Kontobewegung erkennbar, die dazu passt. Der Beleg
                    wird abgelegt und erscheint in der Liste der offenen
                    Belege.
                  </p>
                )}

                {d.textprobe && (
                  <p className="hinweis">
                    Gelesen: {d.textprobe}…
                  </p>
                )}
              </section>
            );
          })}

          <p className="knopfreihe">
            <button onClick={() => schicke(false)} disabled={stand !== "bereit"}>
              {stand === "schreibt" ? "übernimmt …" : "Übernehmen"}
            </button>{" "}
            <button type="button" data-art="still" onClick={() => setVorschau(null)}>
              Verwerfen
            </button>
          </p>
        </div>
      )}

      {ergebnis && (
        <div className="abschnitt">
          {ergebnis.gespeichert.length === 0 ? (
            <p>Nichts gespeichert — siehe die Hinweise unten.</p>
          ) : (
            <p>
              <strong>{ergebnis.gespeichert.length}</strong>{" "}
              {ergebnis.gespeichert.length === 1 ? "Beleg" : "Belege"} abgelegt.
              Der Abgleich hat {ergebnis.abgleich.uebernommen} sichere
              Zuordnungen festgeschrieben, {ergebnis.abgleich.offen} Bewegungen
              bleiben offen.
            </p>
          )}
          {ergebnis.zuordnungen.length > 0 && (
            <ul>
              {ergebnis.zuordnungen.map((z, i) => (
                <li key={i}>
                  {z.beleg_bezeichnung ?? "Beleg"} — {z.sicherheit}: {z.begruendung}
                </li>
              ))}
            </ul>
          )}
          {ergebnis.abgelehnt.map((a, i) => (
            <p key={i} className="rueckmeldung" data-art="fehler">
              {a.dateiname}: {a.grund}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
