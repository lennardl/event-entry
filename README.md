# Event Entry

A browser-based e-ticketing and gate-operations application with ticket distribution,
QR scanning, partial group admission, offline operation and a live dashboard.
NDP 2027 is included as sample event data.

## Local setup

Requires Node.js 22.13 or newer and Postgres.

```bash
cp .env.example .env.local
npm install
npm run dev
```

Set `DATABASE_URL`, `AUTH_SESSION_SECRET`, `NRIC_HASH_SECRET` and `POSTMAN_EMAIL_API_KEY` in `.env.local`.
The schema and sample data are created safely on first use.

## Vercel

Import this repository, add a Neon Postgres integration, and configure the two
secret values above for Production and Preview. Set `NEXT_PUBLIC_APP_URL` to the
deployment URL, then redeploy. Use long independent random values for both secrets.

## Production security boundary

Government email one-time codes authenticate operators. Roles, disablement, session revocation and login history are stored in Postgres and enforced on protected APIs.

Before a public or multi-operator production launch:

- review the operator allowlist and roles before each event;
- retain edge/WAF limits in addition to the built-in Postgres-backed distributed limits;
- keep `APP_ACCESS_KEY`, `NRIC_HASH_SECRET`, and `DATABASE_URL` independent and rotate
  them through the hosting platform rather than source control;
- restrict database credentials to this application and enable provider audit logs;
- treat ticket URLs, scanner links, and downloaded offline packs as bearer credentials;
- verify CSP/security headers and run `npm audit` in the deployment pipeline.

## Checks

```bash
npm run lint
npm test
```

See `docs/DEVICE_QA.md` for the mandatory device and accessibility release matrix. Apple Wallet requires an Apple Developer Pass Type ID/certificate exposed through the configured private signer. Google Wallet is intentionally deferred.
