# NDP Entry POC

A browser-based e-ticketing and gate-operations proof of concept for NDP 2027.

## Included

- Configurable event, zone and gate model
- CSV winner import with 1–6 admission e-ticket bundles
- Individual QR codes for physical tickets
- Citizen mobile ticket and Wallet integration points
- Camera-based browser scanner with partial admission
- Device-local offline pack and deferred scan synchronisation
- NRIC recovery, ticket regeneration and audited manual entry
- Command dashboard for capacity, throughput, queues and exceptions
- Super Admin, Admin, Gate Supervisor and Command Centre Viewer role simulation

## Local use

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open the URL printed by the development server. Use the demo tickets in the
scanner to exercise the flow without a second device.

## Validation

```bash
npm run lint
npm test
```

## POC boundaries

The local build uses Cloudflare D1 for durable application state and browser
storage for the scanner's device-local offline pack. Production deployment
still requires MINDEF-approved SSO, `.gov.sg` SMS connectivity, Wallet issuer
credentials, managed scanner devices, operational runbooks and a security
review. The POC ticket tokens are opaque and high entropy; production offline
validation should move to asymmetric signatures with managed signing keys.
