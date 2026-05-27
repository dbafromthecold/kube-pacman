FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY public ./public

EXPOSE 8080
USER node
CMD ["node", "server.js"]
