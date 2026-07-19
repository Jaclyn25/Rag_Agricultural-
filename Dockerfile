FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

RUN npm run seed

EXPOSE 3000

CMD ["node", "server/index.js"]
