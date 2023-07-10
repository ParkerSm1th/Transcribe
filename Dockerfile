FROM node:16-alpine
WORKDIR /app
COPY package*.json /app/
COPY index.ts /app/
COPY types.ts /app/
COPY tsconfig.json /app/
COPY utils/ /app/utils/

COPY OpenSans-Regular.ttf /app/OpenSans-Regular.ttf

RUN apk update
RUN apk add
RUN apk add ffmpeg

RUN npm install
RUN npm install -g typescript
RUN npm install -g ts-node
RUN chown -R root:root /app
RUN chmod -R 755 /app 

COPY ./OpenSans-Regular.ttf ./

RUN mkdir -p /usr/share/fonts/truetype/
RUN install -m644 OpenSans-Regular.ttf /usr/share/fonts/truetype/
RUN rm ./OpenSans-Regular.ttf
RUN npm run postinstall

ENV PORT 3200
EXPOSE $PORT
EXPOSE 80
CMD node build/index.js
