/**
 * Cloudflare Email Worker — nimmt eingehende Mails an und reicht sie
 * als rohe MIME-Nachricht an die Plattform weiter.
 *
 * Einrichtung:
 *  1. Domain bei Cloudflare aufnehmen (Nameserver umstellen).
 *  2. Email Routing aktivieren. Cloudflare setzt die MX-Einträge selbst.
 *  3. Diesen Worker anlegen und als Catch-all-Ziel eintragen.
 *  4. Unter Settings > Variables setzen:
 *       ZIEL       = https://stig-immobilien.de/api/mail/eingang
 *       SCHLUESSEL = derselbe Wert wie EINGANG_SCHLUESSEL in .env
 *
 * Kommt die Plattform nicht ans Netz, wird die Mail an die
 * Ausweichadresse weitergeleitet statt verworfen. Nichts geht verloren.
 */

export default {
  async email(nachricht, env) {
    const roh = await new Response(nachricht.raw).arrayBuffer();

    try {
      const antwort = await fetch(env.ZIEL, {
        method: "POST",
        headers: {
          "content-type": "message/rfc822",
          "x-eingang-schluessel": env.SCHLUESSEL,
        },
        body: roh,
      });

      if (!antwort.ok) {
        throw new Error(`Plattform antwortete mit ${antwort.status}`);
      }
    } catch (fehler) {
      console.error("Weiterreichen fehlgeschlagen:", fehler);
      if (env.AUSWEICHADRESSE) {
        await nachricht.forward(env.AUSWEICHADRESSE);
      } else {
        // Ohne Ausweichadresse lieber ablehnen als stillschweigend schlucken —
        // dann bekommt der Absender eine Unzustellbarkeitsmeldung.
        nachricht.setReject("Zustellung derzeit nicht möglich");
      }
    }
  },
};
