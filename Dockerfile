FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# Bake the knowledge base (embeddings + embedding model cache) at build time so
# the container starts fast on Render. This layer is only invalidated when the
# knowledge/ files or the seeding pipeline change, not on every code change.
# Seeding requires no API keys: it only runs the local embedding model.
COPY knowledge/ ./knowledge/
COPY utils/ ./utils/
COPY server/seed.js server/ingest.js server/
RUN node server/seed.js

COPY . .
RUN chmod +x docker-entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
