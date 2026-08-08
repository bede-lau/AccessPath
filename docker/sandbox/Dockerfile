FROM mcr.microsoft.com/playwright:v1.62.0-noble@sha256:baed2032d533817f3dbe6425de795788430ba345e819a1201337009ba17c9d07

ENV CI=1
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/companion/package.json apps/companion/package.json
COPY apps/console/package.json apps/console/package.json
COPY apps/demo-aid-app/package.json apps/demo-aid-app/package.json
COPY packages/audit-engine/package.json packages/audit-engine/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/evidence/package.json packages/evidence/package.json
COPY packages/git-workspace/package.json packages/git-workspace/package.json
COPY packages/qoder-runner/package.json packages/qoder-runner/package.json

RUN npm install --global npm@11.6.1 \
    && npm ci
