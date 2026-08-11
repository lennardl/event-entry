# Event Entry

A browser-based e-ticketing and gate-operations POC with ticket distribution,
QR scanning, partial group admission, offline operation and a live dashboard.
NDP 2027 is included as sample event data.

## Local setup

Requires Node.js 22.13 or newer and Postgres.

```bash
cp .env.example .env.local
npm install
npm run dev
```

Set `DATABASE_URL`, `APP_ACCESS_KEY` and `NRIC_HASH_SECRET` in `.env.local`.
The schema and sample data are created safely on first use.

## Vercel

Import this repository, add a Neon Postgres integration, and configure the two
secret values above for Production and Preview. Set `NEXT_PUBLIC_APP_URL` to the
deployment URL, then redeploy. Use long independent random values for both secrets.

## Checks

```bash
npm run lint
npm test
```
