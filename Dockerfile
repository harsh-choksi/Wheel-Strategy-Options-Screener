FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src
COPY extension ./extension

EXPOSE 5173

CMD ["node", "src/server.js"]
