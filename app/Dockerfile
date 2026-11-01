# Mehrstufiger Build: Abhängigkeiten, Build, schlankes Laufzeit-Image.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-slim AS laufzeit
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN groupadd --system --gid 1001 stig \
 && useradd  --system --uid 1001 --gid stig stig

COPY --from=build /app/public ./public
COPY --from=build --chown=stig:stig /app/.next/standalone ./
COPY --from=build --chown=stig:stig /app/.next/static ./.next/static

# Wird für das Anlegen der Zugangsdaten gebraucht:
#   docker compose run --rm app node hilfsmittel/passwort.mjs stephan
COPY --from=build /app/hilfsmittel ./hilfsmittel

# Ablage für Belege. Als eigenes Volume eingehängt, damit sie einen
# Neubau des Abbilds überleben.
RUN mkdir -p /daten/belege && chown -R stig:stig /daten

USER stig
EXPOSE 3000
CMD ["node", "server.js"]
