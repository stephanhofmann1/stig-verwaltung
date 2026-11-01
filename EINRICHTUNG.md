# STIG Verwaltung — Einrichtung

Vorgangsakte, Mailein- und -ausgang, Lead-Nachfassen und Mietenabgleich
für Westanlage 9 (Gießen) und Welserstraße 10 (Ludwigshafen).

Alles läuft auf einem eigenen Server. Nichts davon hängt an Merz.

---

## Was du vorher brauchst

| Was | Wo | Kosten |
|---|---|---|
| Gewerbeanmeldung | Gewerbeamt Frankfurt, online | einmalig 20–40 € |
| Domain | IONOS (Konto vorhanden) | ca. 15 €/Jahr |
| Server | Hetzner, kleinster Tarif reicht | ca. 5 €/Monat |
| Mailversand | Resend, kostenloser Tarif | 0 € |
| Mailempfang | Cloudflare Email Routing | 0 € |

Alle Verträge auf das Gewerbe bzw. die STIG Immobilien eGbR, nicht privat
und nicht auf Merz.

---

## 1. Server anlegen (Hetzner)

Konto auf **STIG Immobilien eGbR**, nicht privat und nicht auf Merz.

| Feld | Wert |
|---|---|
| Standort | Nuernberg oder Falkenstein |
| Image | Ubuntu 24.04 |
| Typ | CX22 (shared vCPU, 2 Kerne, 4 GB, 40 GB) — ca. 4,50 €/Monat |
| Netzwerk | nur IPv4 + IPv6 |
| SSH-Key | eigenen Schluessel hinterlegen |
| Cloud config | Inhalt von `hetzner-cloud-init.yaml` einfuegen |
| Name | `stig-verwaltung` |
| Backups | einschalten (+20 %, rund 1 €/Monat) |

Die Cloud config installiert Docker, setzt die Firewall (nur 22, 80, 443)
und schaltet die Passwort-Anmeldung am Server ab.

## 2. DNS auf den Server zeigen lassen

Bei Cloudflare zwei Eintraege anlegen, mit der IP aus der Hetzner-Uebersicht:

| Typ | Name | Wert | Proxy |
|---|---|---|---|
| A | `@` | IP des Servers | **DNS only** |
| A | `www` | IP des Servers | **DNS only** |

**Erst einmal grau lassen.** Caddy holt das TLS-Zertifikat ueber Port 80
direkt beim Server; mit eingeschaltetem Cloudflare-Proxy kommt die
Pruefanfrage dort nie an. Wenn das Zertifikat steht, kann man den Proxy
einschalten — dann in Cloudflare unter SSL/TLS auf **Full (strict)**
stellen, sonst entsteht eine Endlosschleife.

## 3. Projekt einspielen

Vom eigenen Rechner aus, `stig-verwaltung.tgz` liegt im Download-Ordner:

```bash
scp ~/Downloads/stig-verwaltung.tgz root@<SERVER-IP>:/opt/stig/
ssh root@<SERVER-IP>
cd /opt/stig && tar xzf stig-verwaltung.tgz && rm stig-verwaltung.tgz
bash einrichten.sh
```

`einrichten.sh` erzeugt alle Zufallsgeheimnisse selbst, fragt nur nach den
Passwoertern fuer die Anmeldung, schreibt die `.env` und startet den Stapel.
Die Passwoerter werden nicht angezeigt und verlassen den Server nicht.

Danach laeuft die Oberflaeche unter `https://stig-immobilien.de`.

## 4. Maileingang und -versand nachtragen

Zwei Werte fehlen nach der Einrichtung noch in der `.env`:

- `IMAP_PASSWORT` — App-Passwort von GMX. Im GMX-Webmail unter
  Einstellungen IMAP freischalten und ein App-Passwort anlegen. **Nicht**
  das normale Kontopasswort eintragen.
- `RESEND_API_KEY` — ohne ihn bleibt der Versand im Trockenmodus:
  Entwuerfe lassen sich freigeben, es verlaesst aber nichts das System.

Nach dem Eintragen `./start.sh up -d` wiederholen.

### Resend einrichten

1. Konto bei resend.com, Domain `stig-immobilien.de` hinzufuegen.
2. Die angezeigten TXT-Eintraege bei Cloudflare anlegen.
3. **Achtung SPF:** Es darf nur *einen* SPF-Eintrag auf der Domain geben.
   Cloudflare Email Routing hat bereits
   `v=spf1 include:_spf.mx.cloudflare.net ~all` gesetzt. Resends Angabe
   wird dort hineingezogen, nicht als zweite Zeile danebengestellt.
4. API-Key erzeugen und in die `.env` eintragen.

Ohne SPF und DKIM landen Mahnungen im Spam — das ist der Schritt, den man
nicht ueberspringen darf.

### Spaeter: direkter Weg ueber Cloudflare

Heute laeuft der Eingang so: Cloudflare Email Routing leitet
`verwaltung@stig-immobilien.de` an STIGIMMO@gmx.de weiter, die Plattform
holt die Mails von dort per IMAP ab. Das funktioniert sofort.

Direkter geht es mit einem Worker: Inhalt aus `cloudflare-email-worker.js`,
Variablen setzen —

- `ZIEL` = `https://stig-immobilien.de/api/mail/eingang`
- `SCHLUESSEL` = derselbe Wert wie `EINGANG_SCHLUESSEL` aus der `.env`
- `AUSWEICHADRESSE` = `STIGIMMO@gmx.de`

— und den Worker als Ziel der Regel eintragen. Die Ausweichadresse sorgt
dafuer, dass bei einem Ausfall der Plattform nichts verlorengeht.

---

## Wie es im Betrieb aussieht

**Mail kommt rein** → Cloudflare reicht sie an die Plattform → sie wird einem
Vorgang zugeordnet (über die echten Mail-Header, sonst über Betreff und
Absender) → eingeordnet nach Kategorie.

**Der Agent** läuft morgens um 7 und abends um 18 Uhr, schreibt Antworten
vor und legt sie in die Freigabe. **Er versendet nie.**

**Du** meldest dich an, öffnest die Freigabe, liest, änderst wenn nötig,
drückst senden.

**Sollstellungen** werden im selben Lauf gebildet: für jedes Mietverhältnis
die Monatsmiete, bei Ein- und Auszug mitten im Monat taggenau anteilig.

**Leads**, die nicht auf WhatsApp gewechselt sind, werden nach drei und
nach fünf Tagen angeschrieben — höchstens zweimal. Schreibt der Interessent
auf WhatsApp, stoppt das sofort.

---

## Was der Agent nie anfasst

Fest im Code verankert, nicht über Einstellungen abschaltbar:

- **Mahnwesen** — Mahnungen, Zahlungsverzug, Kündigungen, Räumung
- **Behörden** — Finanzamt, Bauamt, Gericht, Bescheide, Ladungen

Diese Vorgänge werden erkannt, als heikel markiert und ausschließlich zur
eigenen Bearbeitung vorgelegt. Hier entstehen rechtlich wirksame Erklärungen
mit Fristen; ein falscher Satz kostet mehr, als die Automatisierung einspart.

Ebenso gilt: Zu Preisen, Terminen und Verfügbarkeiten sagt der Agent nichts
zu, auch nicht bei harmlosen Kategorien.

---

## Zahlungen

Kontoauszug als CSV hochladen:

```bash
curl -X POST https://<domain>/api/zahlungen/import \
  -F "konto=Sparkasse Gießen" -F "datei=@auszug.csv"
```

Die Zuordnung folgt den Regeln aus dem Abgleich vom 12.10.2026:

- Zahlungen ab dem 25. gelten bei Vorauszahlern für den Folgemonat
- der Verwendungszweck schlägt den Absendernamen
- Auslandszahlungen ohne Zweck werden nur über den Betrag zugeordnet und
  gelten grundsätzlich als unsicher
- Barzahlungen stehen auf keinem Auszug, eine Lücke ist deshalb nie für
  sich genommen ein Rückstand

Eindeutiges wird verbucht, alles andere landet in der Prüfliste. Zahlt
jemand dauerhaft unter fremdem Namen, trägt man das einmal in
`zahlerkennung` ein und es wird künftig erkannt.

---

## Später

- **WhatsApp** über Twilio. Das Datenmodell ist vorbereitet: Kanal am
  Nachrichtensatz, Telefonnummern mit dokumentierter Einwilligung, und das
  Referenz-Kürzel (`V-0042`), das über den wa.me-Link mitläuft und die
  eingehende Nachricht der richtigen Akte zuordnet.
- **FinTS** statt CSV-Upload, sobald die Zuordnungsregeln sich bewährt haben.
- **Zusammenlegen mit westanlage9.de**, damit Anfrageformular und
  Reparaturmeldungen direkt Vorgänge erzeugen und die Belegungsangaben auf
  der Website aus der Datenbank kommen statt von Hand gepflegt zu werden.
