# Ảnh Cloud Run. Không đặt Dockerfile ở gốc repo để Vercel không nhầm sang build Docker.
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY api ./api
COPY services ./services
COPY config ./config
COPY cloudrun/server.js ./cloudrun/server.js
COPY public/data/gba/apartments.json ./public/data/gba/apartments.json
COPY public/data/gba/pop-nha.json ./public/data/gba/pop-nha.json
COPY public/data/gba/qh-hientrang.json ./public/data/gba/qh-hientrang.json
COPY scripts/data/parcel-infra/rows.json ./scripts/data/parcel-infra/rows.json

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080
CMD ["node", "cloudrun/server.js"]
