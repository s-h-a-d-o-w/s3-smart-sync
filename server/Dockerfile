FROM node:lts-alpine

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
COPY . /app
WORKDIR /app

RUN pnpm install --prod --frozen-lockfile

ENV NODE_ENV production
ENV PORT 80

EXPOSE 80
CMD [ "node", "--experimental-transform-types", "server.ts" ]
