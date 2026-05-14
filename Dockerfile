FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.mjs ./
COPY public ./public

ENV API_HOST=0.0.0.0
ENV API_PORT=8080

EXPOSE 8080

CMD ["node", "server.mjs"]
