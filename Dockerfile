FROM node:22-bookworm-slim AS node-runtime

FROM node:22-bookworm-slim AS builder-frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN chmod +x node_modules/.bin/* || true
RUN npx vite build

FROM node:22-bookworm-slim AS builder-backend
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

FROM php:8.3-apache-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    sqlite3 \
    python3 \
    python3-venv \
    unzip \
    && rm -rf /var/lib/apt/lists/* \
    && curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer

# Reuse the official Node runtime instead of configuring and downloading the
# NodeSource APT repository in every build stage. Both images are Debian
# Bookworm, so native backend dependencies remain ABI-compatible.
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# Complete Word-document toolchain used by the dedicated agent workspace.
RUN python3 -m venv /opt/word-tools \
    && PIP_DISABLE_PIP_VERSION_CHECK=1 /opt/word-tools/bin/pip install --no-cache-dir \
      python-docx docxtpl lxml Pillow
ENV PATH="/opt/word-tools/bin:${PATH}"

RUN a2enmod rewrite proxy proxy_http headers

COPY apache/ports.conf /etc/apache2/ports.conf
COPY apache/projects.conf /etc/apache2/sites-available/projects.conf
RUN a2ensite projects

WORKDIR /app
COPY --from=builder-backend /app/dist ./dist
COPY --from=builder-backend /app/node_modules ./node_modules
COPY --from=builder-backend /app/package*.json ./
COPY --from=builder-frontend /app/frontend/dist ./public
COPY docker-start.sh /app/docker-start.sh
RUN chmod +x /app/docker-start.sh

RUN mkdir -p /app/workspace /app/data /app/project-links
RUN chown -R www-data:www-data /app/workspace /app/project-links
ENV AGENT_COMMAND_UID=33
ENV AGENT_COMMAND_GID=33

EXPOSE 89
ENV PORT=89
ENV NODE_ENV=production
ENV DOCKER_CONTAINER=1
ENV WORKSPACE_BASE_DIR=/app/workspace

CMD ["/app/docker-start.sh"]
