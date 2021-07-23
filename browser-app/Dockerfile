FROM node:12

LABEL maintainer="Evolved Binary Ltd <tech@evolvedbinary.com>"

WORKDIR /usr/src/fusion-studio

COPY package.json ./

RUN yarn

RUN yarn theia build --mode production

EXPOSE 3000

CMD [ "yarn", "start", "--hostname", "0.0.0.0" ]
