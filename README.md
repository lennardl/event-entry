# Event Entry

A browser-based e-ticketing and gate-operations proof of concept. It includes
configurable events and zones, ticket distribution, QR scanning, partial group
admission, offline verification, manual recovery and a live operations dashboard.
NDP 2027 is included as sample event data.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

## Check the project

```bash
npm run lint
npm test
```

## Deployment note

Durable state currently uses Cloudflare D1. Deploying on Vercel requires replacing
the D1 adapter with a supported database before production use.
