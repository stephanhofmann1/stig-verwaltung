import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Aus: Diese Anwendung zeigt durchgehend Live-Daten aus der Datenbank.
  // Statisches Vorrendern waere hier nur eine Fehlerquelle.
  cacheComponents: false,
  // Erzeugt .next/standalone — ein eigenständiges Serverbündel,
  // das im Container ohne node_modules auskommt.
  output: "standalone",
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
