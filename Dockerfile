FROM node:20-slim

WORKDIR /app

COPY server.mjs ./

ENV API_HOST=0.0.0.0
ENV API_PORT=8080

EXPOSE 8080

CMD ["node", "server.mjs"]
