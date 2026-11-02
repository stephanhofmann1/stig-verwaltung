"use client";

import { useState } from "react";

export interface ObjektZeile {
  id: string;
  name: string;
  zahlungsdaten_ab: string | null;
  erste_buchung: string | null;
  buchungen: string;
}

const tag = (iso: string | null) =>
  iso === null
    ? "—"
    : new Intl.DateTimeFormat("de-DE", {
        day: "2-digit", month: "2-digit", year: "numeric",
      }).format(new Date(iso));

/**
 * Beginn der Kontodaten je Objekt.
 *
 * Das ist die Abdeckungsgrenze des Mahnwesens, und sie ist der
 * unscheinbarste gefährliche Wert im ganzen System: Steht sie zu früh,
 * sehen Monate ohne Kontodaten wie Rückstände aus. Bei einem übernommenen
 * Haus mit acht Mietverhältnissen und acht Monaten vor dem Kontobeginn sind
 * das rund 32.000 Euro Rückstand, die es nie gab.
 *
 * Darum gehört sie auf den ersten Buchungstag, der wirklich in der
 * Datenbank liegt, und nicht auf das Eröffnungsdatum des Kontos. Genau
 * das macht der Knopf.
 */
export function KontodatenBeginn({ objekte }: { objekte: ObjektZeile[] }) {
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [fehler, setFehler] = useState<Record<string, string>>({});

  async function setze(objektId: string, body: Record<string, string>) {
    const koerper = new FormData();
    koerper.set("objekt_id", objektId);
    for (const [k, v] of Object.entries(body)) koerper.set(k, v);

    setLaeuft(objektId);
    setFehler((f) => ({ ...f, [objektId]: "" }));
    const r = await fetch("/api/konten/zahlungsdaten", {
      method: "POST",
      body: koerper,
    });
    const d = (await r.json().catch(() => ({}))) as
      { ok?: boolean; fehler?: string };
    setLaeuft(null);
    if (d.ok) {
      window.location.reload();
    } else {
      setFehler((f) => ({ ...f, [objektId]: d.fehler ?? "Das hat nicht geklappt." }));
    }
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Objekt</th>
          <th>Kontodaten ab</th>
          <th>Erste Buchung</th>
          <th>Setzen</th>
        </tr>
      </thead>
      <tbody>
        {objekte.map((o) => {
          const passt =
            o.zahlungsdaten_ab !== null &&
            o.erste_buchung !== null &&
            o.zahlungsdaten_ab === o.erste_buchung;
          const zuFrueh =
            o.zahlungsdaten_ab !== null &&
            o.erste_buchung !== null &&
            o.zahlungsdaten_ab < o.erste_buchung;

          return (
            <tr key={o.id}>
              <td>{o.name}</td>
              <td>
                {tag(o.zahlungsdaten_ab)}
                {o.zahlungsdaten_ab === null && (
                  <div className="hinweis">
                    Leer — hier wird nie gemahnt.
                  </div>
                )}
                {zuFrueh && (
                  <div style={{ color: "#b3261e" }}>
                    Zu früh: Für die Zeit bis zur ersten Buchung gibt es keine
                    Kontodaten. Diese Monate erscheinen als Rückstand, obwohl
                    sie nur nicht abgeglichen sind.
                  </div>
                )}
                {passt && (
                  <div style={{ color: "#1b6b3a" }}>Passt zur ersten Buchung.</div>
                )}
              </td>
              <td>
                {tag(o.erste_buchung)}
                <div className="hinweis">
                  {Number(o.buchungen) === 0
                    ? "keine Buchungen"
                    : `${o.buchungen} Buchungen`}
                </div>
              </td>
              <td>
                {o.erste_buchung && (
                  <>
                    <button
                      onClick={() => setze(o.id, { aus_buchungen: "1" })}
                      disabled={laeuft !== null || passt}
                    >
                      {laeuft === o.id ? "setzt …" : "Aus Buchungen setzen"}
                    </button>{" "}
                  </>
                )}
                <button
                  data-art="still"
                  onClick={() => setze(o.id, { datum: "" })}
                  disabled={laeuft !== null || o.zahlungsdaten_ab === null}
                  title="Leeren heißt: hier wird nie gemahnt."
                >
                  Leeren
                </button>
                {fehler[o.id] && (
                  <div style={{ color: "#b3261e" }}>{fehler[o.id]}</div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
