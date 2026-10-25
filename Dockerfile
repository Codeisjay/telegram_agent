FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    AGENTFLOW_HOST=0.0.0.0 \
    AGENTFLOW_DATA_DIR=/data

WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server.mjs daily-scheduler.mjs job-extraction.mjs job-intelligence.mjs response-format.mjs backup.mjs ./
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3001
VOLUME ["/data"]

CMD ["node", "server.mjs"]
