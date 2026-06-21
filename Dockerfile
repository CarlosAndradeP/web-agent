FROM node:22-alpine AS builder-frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN chmod +x node_modules/.bin/* || true
RUN npx vite build

FROM node:22-alpine AS builder-backend
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

FROM node:22-alpine
WORKDIR /app
COPY --from=builder-backend /app/dist ./dist
COPY --from=builder-backend /app/node_modules ./node_modules
COPY --from=builder-backend /app/package*.json ./
COPY --from=builder-frontend /app/frontend/dist ./public
RUN mkdir -p /app/workspace /app/data
EXPOSE 89
ENV PORT=89
ENV NODE_ENV=production
CMD ["node", "dist/server.js"]
