FROM node:20-alpine AS base

ENV NODE_ENV production
ENV PORT 80

# Building presumably already happened
COPY . .

EXPOSE 80
CMD [ "node", "server.js" ]
