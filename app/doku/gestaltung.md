# Gestaltung

Alles Visuelle steckt in `app/globals.css`. Die Datei ist global geladen
(über `app/layout.tsx`) — neue Seiten müssen nichts importieren und sehen
von allein richtig aus, solange sie die Elemente und Klassen von hier
benutzen.

**Grundhaltung:** Vermieter-Cockpit. Ruhig, dicht, vertrauenswürdig.
Neutrale Flächen, Haarlinien, fluchtende Ziffern. Ein Akzent in
Registerblau, drei Statusfarben — sonst keine Farbe. Keine Verzierung,
keine Animation außer kurzen Überfahr-Übergängen.

**Zwei Regeln für alle:**

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

### Flächen (von hinten nach vorn)

| Marke | wofür |
|---|---|
| `--grund` | Seitenhintergrund. Steht ausdrücklich auf `body`. |
| `--flaeche` | Karte, Tabelle, Eingabefeld |
| `--flaeche-ruhig` | Zebrastreifen, Protokollblöcke, `.leer` |
| `--flaeche-tief` | Tabellenkopf, Überfahren, stille Knöpfe |

### Schrift und Linien

| Marke | wofür |
|---|---|
| `--fg` | Haupttext |
| `--fg-leise` | zweite Ebene: Beschriftungen, `.hinweis` |
| `--fg-still` | dritte Ebene: Platzhalter, Laufnummern |
| `--linie` | Haarlinie |
| `--linie-stark` | Trennung mit Gewicht, Feldrand |

### Akzent und Status

| Marke | hell | wofür |
|---|---|---|
| `--akzent` / `--akzent-flaeche` | `#1F4FA8` | aktive Navigation, Links, Entwürfe |
| `--gut` / `--gut-flaeche` | `#1b6b3a` | erledigt, vollständig, bezahlt |
| `--warn` / `--warn-flaeche` | `#8a6d00` | hinsehen, unvollständig, TAN fällig |
| `--fehl` / `--fehl-flaeche` | `#b3261e` | Fehler, Rückstand, Frist gerissen |

Die hellen Statuswerte sind **genau** die Hex-Werte, die bisher als
Inline-Farbe in den Seiten stehen. Alter Code bleibt dadurch farbgleich.

### Inline-Farben im Bestand

In den Seiten stehen Statusfarben noch als festes Hex im `style`-Attribut
(`#1b6b3a`, `#8a6d00`, `#8a5a00`, `#b3261e`, `#b00`, `#5b5b66`, …).
Abschnitt 3 von `globals.css` biegt genau diese Werte auf die Marken um.
Im Hellmodus ändert das nichts, im Dunkelmodus werden die sonst unlesbar
dunklen Farben aufgehellt.

**Neuer Code schreibt die Marke, nicht das Hex.** Also
`style={{ color: "var(--fehl)" }}` statt `"#b3261e"`.

### Maße

- Abstände: `--abstand-1` … `--abstand-7` (0,25 / 0,5 / 0,75 / 1 / 1,5 / 2 / 3 rem)
- Seitenabstand des Rahmens: `--mass` (1,5 rem; auf dem Telefon 1 rem = 16 px)
- Rahmenbreite: `--rahmen-breite` (72 rem), Kopfhöhe: `--kopf-hoehe`
- Radien: `--radius-s` / `-m` / `-l` / `-rund`
- Schattierungen: `--schatten-1` (Fläche hebt sich ab), `--schatten-2` (schwebt)
- Schriftgrößen: `--text-xs`, `-s`, `-m`, `-n`, `-b`, `-l`, `-xl`, `-2xl`
  (`--text-n` = 0,9375 rem ist das Normalmaß der Anwendung)
- Schrift: `--schrift` (Archivo Variable, Gewichtsachse 100–900)

---

## 2. Elemente, die von allein stimmen

Dafür braucht es keine Klasse:

`h1`–`h4` · `p` · `a` · `hr` · `code` · `pre` · `details`/`summary` ·
`table`/`thead`/`tbody`/`tfoot`/`th`/`td`/`caption` ·
`button` · `label` · `input` · `select` · `textarea`

`h1` ist in dieser Anwendung auch eine Abschnittszeile (mehrere pro
Seite) und hat darum eine ruhige Größe, nicht die des Browsers.

---

## 3. Klassen

### Gerüst (steht in `layout.tsx`, nicht anfassen)

`.kopf` · `.kopf-innen` · `.marke` · `.navi` · `.rahmen`

Die Navigation rollt auf dem Telefon waagerecht; die Seite bleibt fest.
Der aktive Punkt wird über `data-aktiv="ja"` markiert.

### Seitenkopf

- `.titelzeile` — Flex-Zeile mit `h1` links und `.zaehler` rechts
- `.zaehler` — Anzahl/Stand rechts im Titel, graue Ziffern
- `.hinweis` — der graue Nebensatz. Als `<p>` bekommt er Abstand und
  Lesebreite, als `span`/`div`/`dt` nicht.

### Register (Liste aus Posten)

`.register` ist der gerahmte Behälter, `.posten` die Zeile — ein Raster
aus `.nummer` / `.betreff` / `.zeit` mit `.unterzeile` darunter.
`data-heikel="ja"` setzt den roten Balken links.

### Tabellen

`.liste` ist der historische Klassenname und sieht genauso aus wie eine
Tabelle ohne Klasse — beides ist richtig.

- `.betrag` auf `th`/`td`: rechtsbündig, einzeilig, Tabellenziffern.
  **Jede Zahlenspalte bekommt das.**
- `.tabelle-rolle`: Behälter für breite Tabellen (siehe Rezept unten)

### Karten und Kennzahlen

- `.karte` — gerahmte Fläche mit Radius und feiner Schattierung
- `.karte-titel` — kleine graue Überschrift darin
- `.karten` — Raster, das Karten von allein umbricht
- `.kennzahl` mit `.kennzahl-schild` und `.kennzahl-wert` — eine Zahl
  fürs Cockpit. `.kennzahl-wert` nimmt `data-art="gut|warn|fehl"`.
- `.entwurf` mit `.entwurf-kopf` und `.entwurf-notiz` — die Entwurfskarte
  der Freigabe (blauer Balken links)

### Status

- `.marker` / `.schild` — Pille mit Rand.
  `data-art="heikel|agent|whatsapp"` (Bestand) und
  `data-art="gut|warn|fehl|info"` (neu). Ohne `data-art`: neutral grau.
- `.punkt` — der Statuspunkt. `data-art="gut|warn|fehl|info|still"`.

### Knöpfe

`button` ist von allein die Hauptaktion (dunkel gefüllt).

- `data-art="still"` — gleiche Größe, kein Gewicht (umrandet)
- `data-art="gefahr"` — rot, für Unwiederbringliches
- `.knopfreihe` — Flex-Zeile für mehrere Knöpfe

### Formulare

- `.feld` — Feld über die ganze Breite
- `.feldreihe` — Raster, das Felder von allein umbricht
- `label` umschließt oder benennt das Feld und ist von allein grau und fett

### Meldungen

- `.rueckmeldung` — kurze Rückmeldung neben den Knöpfen;
  `data-art="fehler"` macht sie rot
- `.meldung` — Kasten mit farbigem Balken links;
  `data-art="fehler|warnung|gut|info"`
- `.leer` — leerer Zustand **und** Merkkasten. Linksbündig, `strong`
  darin wird zur Überschrift.

### Akte

`.akte-kopf` · `.aktenzeichen` · `.akte-meta` · `.verlauf` · `.eintrag`
(mit `data-richtung="aus"`) · `.eintrag-kopf` · `.absender` ·
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

Zebrastreifen, Haarlinien, runde Ecken und der klebende Kopf kommen von
allein. Der Kopf bleibt beim Rollen unter der Kopfzeile der Seite stehen.

### Breite Tabelle (mehr als fünf Spalten)

```tsx
<div className="tabelle-rolle">
  <table>…</table>
</div>
```

Der Behälter rollt waagerecht und nimmt die Seite nicht mit; die Tabelle
darin gibt ihren eigenen Rahmen ab, der Behälter trägt ihn. Der klebende
Kopf entfällt dabei — in einem Rollbehälter kann er nicht kleben.

Auf dem Telefon (≤ 40 rem) rollt **jede** Tabelle in sich selbst, auch
ohne diese Klasse. Das ist ein Fangnetz, kein Ersatz: auf dem Mac
schiebt eine breite Tabelle ohne `.tabelle-rolle` die Seite zur Seite.

### Karte

```tsx
<div className="karte">
  <p className="karte-titel">Nächster Lauf</p>
  <p>Heute Nacht um 03:00.</p>
</div>
```

### Kennzahlenreihe fürs Cockpit

```tsx
<div className="karten">
  <div className="karte kennzahl">
    <span className="kennzahl-schild">Offene Rückstände</span>
    <span className="kennzahl-wert" data-art="fehl">{euro(summe)}</span>
    <span className="hinweis">über 4 Mietverhältnisse</span>
  </div>
  <div className="karte kennzahl">
    <span className="kennzahl-schild">Vermietet</span>
    <span className="kennzahl-wert">34 / 37</span>
  </div>
</div>
```

### Statuspunkt

```tsx
<span>
  <span className="punkt" data-art={offen > 0 ? "fehl" : "gut"} />
  {offen > 0 ? "Rückstand" : "ausgeglichen"}
</span>
```

Für ein Wort mit Rand statt eines Punktes:
`<span className="schild" data-art="warn">TAN fällig</span>`

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
- die Navigation rollt waagerecht, unter 24 rem weicht das Wort
  „Verwaltung" in der Wortmarke

Wenn etwas Neues breiter werden kann als der Schirm — eine Tabelle, ein
langer Kontoname, eine IBAN —, muss es entweder umbrechen oder in einem
eigenen Rollbehälter stehen. Nie die Seite.
