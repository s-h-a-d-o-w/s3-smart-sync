FROM node:lts-alpine

COPY . .

ENV NODE_ENV production
ENV PORT 80

EXPOSE 80
CMD [ "node", "--experimental-transform-types", "." ]
