import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Aus: Diese Anwendung zeigt durchgehend Live-Daten aus der Datenbank.
  // Statisches Vorrendern waere hier nur eine Fehlerquelle.
  cacheComponents: false,
  // Erzeugt .next/standalone — ein eigenständiges Serverbündel,
  // das im Container ohne node_modules auskommt.
  output: "standalone",
  // pdfjs NICHT mitbündeln.
  //
  // pdfjs lädt seinen Arbeiter zur Laufzeit über einen eigenen Pfad
  // nach. Gebündelt zeigt dieser Pfad ins Bündel, und dort liegt die
  // Datei nicht:
  //
  //   Setting up fake worker failed: Cannot find module
  //   '/app/.next/server/chunks/pdf.worker.mjs'
  //
  // Die Folge war kein Absturz, sondern ein stiller Ausfall: lieseBeleg
  // fängt den Fehler und meldet "keine Textebene". Jedes hochgeladene
  // PDF galt damit als Scan. Am 05.11.2026 sind so 229 Belege
  // eingeliefert worden, ohne dass das Portal eine einzige Zeile daraus
  // gelesen hätte -- und weil die Felder aus einer mitgelieferten
  // Beifügung kamen, sah das Ergebnis vollständig aus.
  //
  // Als externes Paket wird pdfjs zur Laufzeit aus node_modules geladen,
  // und der Arbeiter liegt daneben.
  serverExternalPackages: ["pdfjs-dist"],
  // Und den Arbeiter ausdrücklich mitnehmen.
  //
  // Die Ablaufverfolgung findet ihn nicht: pdfjs setzt seinen Pfad zur
  // Laufzeit zusammen, und was nicht als Zeichenkette im Quelltext
  // steht, kann sie nicht sehen. Ohne diese Zeile liegt nur pdf.mjs im
  // Bündel und der Arbeiter fehlt -- derselbe stille Ausfall wie vorher,
  // nur an einer anderen Stelle.
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
