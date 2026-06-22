FROM php:8.3-apache-bookworm AS builder-frontend
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN chmod +x node_modules/.bin/* || true
RUN npx vite build

FROM php:8.3-apache-bookworm AS builder-backend
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

FROM php:8.3-apache-bookworm
RUN apt-get update && apt-get install -y \
    curl \
    sqlite3 \
    python3 \
    python3-pip \
    python3-venv \
    unzip \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer

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

RUN mkdir -p /app/workspace /app/data
RUN chown -R www-data:www-data /app/workspace

EXPOSE 89
ENV PORT=89
ENV NODE_ENV=production
ENV DOCKER_CONTAINER=1
ENV WORKSPACE_BASE_DIR=/app/workspace
ENV JWT_SECRET=change-me-in-production
ENV ADMIN_PASSWORD=admin123

CMD ["/app/docker-start.sh"]
