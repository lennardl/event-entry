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

## Production security boundary

The bundled access-key login is suitable for a controlled pilot, where every signed-in
operator is trusted as an administrator. The role switcher previews UI permissions; it
is not a server-side identity or RBAC system.

Before a public or multi-operator production launch:

- replace the shared key with an identity provider and enforce roles on every mutation;
- put distributed login and API rate limiting at the edge (the built-in limiter is only
  a single-instance backstop in serverless deployments);
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
