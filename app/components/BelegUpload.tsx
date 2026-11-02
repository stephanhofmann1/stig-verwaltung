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
}

const euro = (w: string | number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    Number(w),
  );

const feld: React.CSSProperties = {
  font: "inherit",
  fontSize: "0.9375rem",
  padding: "0.4rem",
  border: "1px solid var(--linie)",
  background: "var(--papier)",
  color: "var(--tinte)",
  width: "100%",
};

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
  };
}

export function BelegUpload() {
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
          style={{ display: "block", marginBottom: "0.5rem" }}
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
        <div style={{ marginTop: "1rem" }}>
          <h3 style={{ marginBottom: "0.25rem" }}>Gelesen, noch nicht gespeichert</h3>
          <p className="hinweis" style={{ marginTop: 0 }}>
            {vorschau.modell_aktiv
              ? "Regelwerk, danach das Sprachmodell für die offen gebliebenen Felder."
              : "Regelwerk ohne Sprachmodell (kein ANTHROPIC_API_KEY hinterlegt)."}{" "}
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

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))",
                    gap: "0.75rem",
                    marginBottom: "0.75rem",
                  }}
                >
                  <label>
                    Aussteller
                    <input
                      value={e.aussteller}
                      onChange={(x) => aendere(i, "aussteller", x.target.value)}
                      placeholder="z. B. OBI"
                      style={feld}
                    />
                    {marke("aussteller")}
                  </label>
                  <label>
                    Belegnummer
                    <input
                      value={e.belegnummer}
                      onChange={(x) => aendere(i, "belegnummer", x.target.value)}
                      placeholder="z. B. Bestellnummer"
                      className="ziffern"
                      style={feld}
                    />
                    {marke("belegnummer")}
                  </label>
                  <label>
                    Belegdatum
                    <input
                      type="date"
                      value={e.belegdatum}
                      onChange={(x) => aendere(i, "belegdatum", x.target.value)}
                      className="ziffern"
                      style={feld}
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
                      className="ziffern"
                      style={feld}
                    />
                    {marke("betrag_brutto")}
                  </label>
                </div>

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
                  <p className="hinweis" style={{ overflowWrap: "anywhere" }}>
                    Gelesen: {d.textprobe}…
                  </p>
                )}
              </section>
            );
          })}

          <p style={{ marginTop: "1rem" }}>
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
        <div style={{ marginTop: "1rem" }}>
          <p>
            <strong>{ergebnis.gespeichert.length}</strong>{" "}
            {ergebnis.gespeichert.length === 1 ? "Beleg" : "Belege"} abgelegt.
            Der Abgleich hat {ergebnis.abgleich.uebernommen} sichere Zuordnungen
            festgeschrieben, {ergebnis.abgleich.offen} Bewegungen bleiben offen.
          </p>
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
