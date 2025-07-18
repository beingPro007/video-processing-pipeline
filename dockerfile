FROM node:20-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY . .

RUN npm install

CMD ["node", "worker.js"]
