FROM node:16-alpine
WORKDIR /app
COPY package*.json /app
COPY index.ts /app
COPY tsconfig.json /app
#remove before production
COPY .env /app/.env
COPY OpenSans-Regular.ttf /app/OpenSans-Regular.ttf

RUN apk update
RUN apk add
RUN apk add ffmpeg

RUN npm install
RUN npm install -g typescript
RUN npm install -g ts-node
RUN chown -R root:root /app
RUN chmod -R 755 /app 

ENV PORT 3800
EXPOSE $PORT
CMD ts-node index.ts
