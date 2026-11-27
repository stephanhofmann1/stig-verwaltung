# Gestaltung

Alles Visuelle steckt in `app/globals.css`. Die Datei ist global geladen
(über `app/layout.tsx`) — neue Seiten müssen nichts importieren und sehen
von allein richtig aus, solange sie die Elemente und Klassen von hier
benutzen.

**Leitbild (seit 27.11.2026):** so ruhig und selbstverständlich wie eine
Anwendung von Apple — Mail, Notizen, die Einstellungen. Anlass war
Stephans Rückmeldung zur Papier-und-Bronze-Fassung: „wild, unübersichtlich,
wirkt kryptisch computerhaft“. Gewünscht: „pure intuitive Bedienung und
tolle Übersichtlichkeit“.

**Sieben Regeln, an denen sich jede Ergänzung misst:**

1. **Systemschrift.** Auf Mac, iPhone und iPad ist das SF Pro; Inter steht
   als Ersatz für alle anderen Geräte dahinter.
2. **Weißer Inhalt, hellgraue Seitenleiste.** Gegliedert wird mit Weißraum
   und Haarlinien, nicht mit Kästen. Keine Kachelraster.
3. **Ein Akzent: Apple-Blau.** Er zeigt, was man anklicken kann, und wo man
   steht. Statusfarben nur als Punkt, Pille oder Zahl.
4. **Große Titel, wenige Abschnitte.** Zahlen groß und in fluchtenden
   Ziffern.
5. **Erklärungen sind leise.** Eingeklappt, grau, klein — mit einer kurzen
   Frage als Überschrift („Wie gezählt wird“), nicht mit einem ganzen Satz.
6. **Bedienelemente wie auf dem Mac.** Pillenknöpfe, runde Felder,
   Segmentschalter, ein Datei-Knopf statt „Choose Files“.
7. **Telefon:** Tableiste unten mit Zeichen, großer Titel, alles
   Antippbare mindestens 44 px hoch.

**Und eine Regel für die Wörter:** Auf der Oberfläche steht, was ein
Vermieter sagen würde — keine Tabellen-, Spalten- oder Funktionsnamen
(`frist`, `sollstellung`, `objekt.zahlungsdaten_ab`, `bankabruf`). Kennungen
aus der Datenbank bekommen einen deutschen Namen, z. B. `laufName()` in
`lib/formate.ts` für die nächtlichen Läufe. Begründungen, warum etwas so
gebaut ist, gehören in den Quelltext, nicht auf die Seite.

**Zwei Regeln für den Code:**

1. Keine Klasse umbenennen oder entfernen — die Seiten hängen daran.
2. Farben, Abstände, Radien und Schriftgrößen nie als festen Wert
   schreiben, sondern als Marke (`var(--…)`). Nur dann stimmt der
   Dunkelmodus.

---

## 1. Marken

Alle auf `:root`. Dunkelmodus kommt automatisch über
`@media (prefers-color-scheme: dark)` und ist zusätzlich erreichbar über
`<html data-theme="dark">`; `data-theme="light"` erzwingt hell.
Die dunklen Werte stehen einmal als `--dk-*` und werden zweimal
zugewiesen — ändern also nur an den `--dk-*`-Zeilen.

### Flächen

| Marke | hell | wofür |
|---|---|---|
| `--grund` | `#FFFFFF` | Inhaltsfläche. Steht ausdrücklich auf `body`. |
| `--flaeche` | `#FFFFFF` | Eingabefeld, Entwurf |
| `--flaeche-ruhig` | `#F5F5F7` | Hinweis, leerer Zustand, Filterleiste, Protokoll, Überfahren |
| `--flaeche-tief` | `#E8E8ED` | Kopf im Mietenbuch-Raster, Bahn von Streifen und Ring |
| `--seitenleiste` | `#F5F5F7` | die Seitenleiste links |

`--grund` und `--dk-grund` stehen noch zweimal als Hex: im `themeColor` von
`app/layout.tsx` und in `app/manifest.ts`. `tests/webapp.test.ts` hält alle
drei Stellen gleich.

### Schrift und Linien

| Marke | wofür |
|---|---|
| `--fg` | Haupttext (`#1D1D1F`) |
| `--fg-leise` | zweite Ebene: Beschriftungen, `.hinweis` (`#6E6E73`) |
| `--fg-still` | dritte Ebene: Laufnummern, Platzhalter, Zeitangaben (`#86868B`) |
| `--linie` | Haarlinie zwischen Zeilen |
| `--linie-stark` | Linie unter dem Tabellenkopf, über der Summe |
| `--feldrand` | Rand der Eingabefelder |

### Akzent und Status

| Marke | hell | wofür |
|---|---|---|
| `--akzent` / `--akzent-flaeche` | `#0071E3` | Links, Zeichen der Seitenleiste, Entwürfe, Info |
| `--knopf` / `--knopf-ueber` | `#0071E3` | Füllung des Hauptknopfs |
| `--knopf-still` | 5,5 % Schwarz | stiller Knopf, Objektwahl, Datei-Knopf |
| `--gut` / `--gut-flaeche` | `#248A3D` | erledigt, bezahlt |
| `--warn` / `--warn-flaeche` | `#B25000` | hinsehen, unvollständig |
| `--fehl` / `--fehl-flaeche` | `#D70015` | Fehler, Rückstand, heikel |

Die Statusfarben sind Apples Fassungen mit erhöhtem Kontrast; im
Dunkelmodus die hellen Systemfarben (`#30D158`, `#FF9F0A`, `#FF453A`).

### Maße

- Abstände: `--abstand-1` … `--abstand-7` (0,25 / 0,5 / 0,75 / 1 / 1,5 / 2 / 3 rem)
- Seitenabstand: `--mass` (2 rem; mit Seitenleiste 2,5 rem; Telefon 1 rem)
- Lesebreite: `--rahmen-breite` (70 rem), Kopfhöhe: `--kopf-hoehe`
- Radien: `--radius-s` 6 px, `--radius-m` 12 px, `--radius-l` 18 px, `--radius-rund`
- Schatten: `--schatten-2` — nur der Entwurf schwebt
- Schriftstufen: `--t-mikro` 11 · `--t-klein` 13 · `--t-grund` 15 ·
  `--t-lese` 17 · `--t-abschnitt` 22 · `--t-seite` 34 · `--t-zahl` 28 px
  (Telefon: Seite 28, Abschnitt 20, Zahl 24 px). Die Altnamen `--text-*`
  zeigen darauf.
- Schrift: `--schrift` (Systemschrift), `--schrift-mono` für Code

### Zeichen

Kleine Symbole im Stil von SF Symbols stehen als Masken auf `:root`
(`--zeichen-pfeil`, `-info`, `-achtung`, `-fehler`, `-gut`, `-auswahl`).
Die Farbe kommt aus `background`/`currentColor` und folgt dem Dunkelmodus.
Die Zeichen der Navigation sind Komponenten: `components/Zeichen.tsx`
(Seitenleiste) und `components/NaviBoden.tsx` (Tableiste) — fünf davon
stehen bewusst in beiden Dateien, siehe Kopf von `Zeichen.tsx`.

---

## 2. Elemente, die von allein stimmen

`h1`–`h4` · `p` · `a` · `hr` · `code` · `pre` · `details`/`summary` ·
`table`/`thead`/`tbody`/`tfoot`/`th`/`td`/`caption` ·
`button` · `label` · `input` · `select` · `textarea`

`h1` ist der Seitentitel — einer je Seite. `summary` bekommt einen kleinen
Winkel, der sich beim Aufklappen dreht. `select` bekommt den Doppelwinkel
von macOS, `input[type=file]` einen stillen Pillenknopf.

---

## 3. Klassen

### Gerüst (steht in `layout.tsx` und `Navi.tsx`)

`.kopf` · `.kopf-innen` · `.marke` · `.navi` · `.navi-gruppe` ·
`.navi-titel` · `.navi-punkte` · `.navi-zeichen` · `.navi-schalter` ·
`.abmelden` · `.rahmen`

Drei Breiten:

- **ab 64 rem** — Seitenleiste links wie in Mail: Mandant, Objektwahl,
  vier Gruppen mit blauen Zeichen, unten Abmelden. Der Inhalt steht in
  seiner Spalte zentriert.
- **darunter** — Kopfleiste oben (durchscheinend), das Menü klappt über
  den Knopf „Menü“ auf.
- **bis 40 rem** — dazu die Tableiste unten (`.navi-boden`), Abmelden als
  runder Knopf mit Zeichen.

Seiten ohne Navigation (Anmeldung, Mieterbereich) bekommen auf jeder
Breite die schlichte Kopfleiste. Das Schaufenster regelt sein Gerüst in
`app/schaufenster.css` selbst.

### Seitenkopf

- `.titelzeile` — Flex-Zeile mit `h1`/`h2` links und `.zaehler` rechts
- `.zaehler` — Anzahl/Stand rechts im Titel, grau, 13 px
- `.hinweis` — der graue Nebensatz, 13 px. Als `<p>` bekommt er Abstand
  und Lesebreite.

### Register (Liste aus Posten)

`.register` ist die Liste, `.posten` die Zeile — ein Raster aus
`.nummer` / `.betreff` / `.zeit` mit `.unterzeile` darunter. Haarlinie
zwischen den Zeilen, beim Überfahren eine weiche graue Fläche wie in Mail.
`data-heikel="ja"` und `data-urteil="fehl|warn|gut"` färben die Nummer —
keine Balken an der Seite.

### Tabellen

Frei auf Weiß, ohne Rahmen und ohne Zebrastreifen; Kopf klein und grau.

- `.betrag` auf `th`/`td`: rechtsbündig, einzeilig, Tabellenziffern.
  **Jede Zahlenspalte bekommt das.**
- `.tabelle-rolle`: Behälter für breite Tabellen (siehe Rezept unten)

### Kennzahlen und Flächen

- `.karten` mit `.karte.kennzahl` — die Kennzahlenreihe: große Zahlen frei
  auf Weiß, darüber das Wort, darunter der Nebensatz. Kein Kasten je Zahl.
- `.kennzahl-schild`, `.kennzahl-wert` (`data-art="gut|warn|fehl"`,
  `data-leer="ja"` für einen Wert, den es nicht gibt — leiser Strich)
- `.karte` allein — eine weiche, graue Fläche für etwas, das zusammengehört
- `.entwurf` mit `.entwurf-kopf` und `.entwurf-notiz` — der Antwortentwurf,
  die einzige Fläche mit Schatten (wie ein Fenster zum Verfassen)
- `.entwurf-falte` — im Cockpit: der Entwurf als aufklappbare Zeile mit
  `.vorschau` des Textes

### Status

- `.marker` / `.schild` — kleine Pille in der Farbe des Zustands, normale
  Schreibung (der erste Buchstabe wird groß gesetzt).
  `data-art="heikel|agent|whatsapp"` (Bestand) und
  `data-art="gut|warn|fehl|info"`. Ohne `data-art`: neutral grau.
- `.punkt` — der Statuspunkt. `data-art="gut|warn|fehl|info|still"`.

### Knöpfe

`button` ist von allein die Hauptaktion: blaue Pille.

- `data-art="still"` — graue Pille, dunkle Schrift
- `data-art="gefahr"` — rote Pille, für Unwiederbringliches
- `.knopf` — ein Link, der aussieht wie der Hauptknopf
- `.verweis` — ein Weg auf eine andere Seite: blauer Text mit Winkel,
  wie „Weitere Infos ›“
- `.knopfreihe` — Flex-Zeile für mehrere Knöpfe

### Formulare

- `.feld` — Feld über die ganze Breite
- `.feldreihe`, `.feldraster` — Raster, das Felder von allein umbricht
- `label` umschließt oder benennt das Feld und ist von allein grau
- `.filterleiste` mit `.filterleiste-feld`, `.filter-marke`, `.filter-zurueck`
- `.zeitraumwahl` — Segmentschalter (12 / 24 / 36 Monate)

### Meldungen

- `.rueckmeldung` — kurze Rückmeldung neben den Knöpfen;
  `data-art="fehler|gut|warn|info"`
- `.meldung` — getönte Fläche mit Zeichen links;
  `data-art="fehler|warnung|gut|info"`. Die Überschrift (`strong`) steht
  in Textfarbe, die Farbe trägt das Zeichen.
- `.leer` — leerer Zustand **und** Merkkasten. `strong` darin wird zur
  Überschrift.
- `.erklaerung` — aufklappbare Begründung, leise und grau

### Akte

`.akte-kopf` · `.aktenzeichen` (kleine Zeile über dem Titel, z. B.
„Vorgang 0006“) · `.akte-meta` · `.verlauf` · `.eintrag` (mit
`data-richtung="aus"` als graue Fläche) · `.eintrag-kopf` · `.absender` ·
`.eintrag-text`

### Ziffern

`.ziffern` erzwingt Tabellenziffern. In Tabellen, bei `.betrag`,
`.zaehler`, `.nummer`, `.zeit`, `code`, `pre` und Zahlenfeldern passiert
das bereits von allein — `.ziffern` ist für Zahlen im Fließtext.

---

## 4. Rezepte

### Tabelle

```tsx
<table>
  <thead>
    <tr>
      <th>Mieter</th>
      <th>Einheit</th>
      <th className="betrag">offen</th>
    </tr>
  </thead>
  <tbody>
    {zeilen.map((z) => (
      <tr key={z.id}>
        <td>
          <strong>{z.name}</strong>
          <div className="hinweis">{z.begruendung}</div>
        </td>
        <td>{z.einheit}</td>
        <td className="betrag">{euro(z.offen)}</td>
      </tr>
    ))}
  </tbody>
</table>
```

### Breite Tabelle (mehr als fünf Spalten)

```tsx
<div className="tabelle-rolle">
  <table>…</table>
</div>
```

Auf dem Telefon (≤ 40 rem) rollt **jede** Tabelle in sich selbst, auch
ohne diese Klasse. Das ist ein Fangnetz, kein Ersatz.

### Kennzahlenreihe

```tsx
<div className="karten">
  <div className="karte kennzahl">
    <span className="kennzahl-schild">Rückstände</span>
    <span className="kennzahl-wert" data-art="fehl">{euro(summe)}</span>
    <span className="hinweis">4 Mietverhältnisse</span>
  </div>
</div>
```

Oder fertig: `KennzahlenZeile` bzw. `Kennzahlen` aus
`components/CockpitKarte.tsx` — dort wird `null` von allein zum leisen
Strich.

### Erklärung

```tsx
<Erklaerung satz="Wie gezählt wird">
  <p className="hinweis">…</p>
</Erklaerung>
```

Der Satz ist eine kurze Frage oder Überschrift. Die eigentliche Aussage
steht darunter.

### Statuspunkt und Schild

```tsx
<span className="punkt" data-art="fehl" /> Rückstand
<span className="schild" data-art="warn">TAN fällig</span>
```

### Meldung

```tsx
<div className="meldung" data-art="warnung">
  <strong>TAN nötig</strong>
  Der nächtliche Abruf ruht, bis die TAN eingegeben ist.
</div>
```

---

## 5. Telefon

Prüfmaß ist 390 px Breite (iPhone). Dort gilt:

- 16 px Seitenabstand (`--mass` wird zu 1 rem)
- kein waagerechtes Rollen der **Seite** — nur Tabellen rollen in sich
- angetippte Elemente (Knöpfe, Felder, Auswahllisten) sind mindestens
  44 px hoch
- Tableiste unten mit fünf Zielen; was dort steht, steht nicht noch einmal
  im Menü

Wenn etwas Neues breiter werden kann als der Schirm — eine Tabelle, ein
langer Kontoname, eine IBAN —, muss es entweder umbrechen oder in einem
eigenen Rollbehälter stehen. Nie die Seite.
