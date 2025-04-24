FROM node:lts-alpine

COPY . .

ENV NODE_ENV production
ENV PORT 80
ENV IS_SERVER true

EXPOSE 80
CMD [ "node", "--experimental-transform-types", "server" ]
