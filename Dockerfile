# ---- Build stage ----
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.web.json vite.config.ts ./
COPY src ./src

RUN npm run build

# ---- Runtime stage ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=build /app/dist ./dist

# Ensure the config dir exists with the right owner so a fresh named
# volume is initialized with node ownership (docker copies dir ownership
# from the image into empty volumes).
RUN mkdir -p /home/node/.config/ai-usage-monitor && chown -R node:node /home/node/.config

EXPOSE 3000
USER node
CMD ["node", "dist/server/index.js"]
