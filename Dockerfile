FROM node:20-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_ENV production
ENV PORT 80

RUN corepack enable
WORKDIR /app
# Building presumably already happened
COPY . .

RUN pnpm install --frozen-lockfile

EXPOSE 80
CMD [ "pnpm", "start" ]
