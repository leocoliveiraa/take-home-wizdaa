# take-home-wizdaa

This is my submission for the Wizdaa take-home assessment.

## Overview

The main thing I optimized for here was balance integrity, not breadth of features.

The service manages the lifecycle of time-off requests while keeping balances aligned with an external HCM, which I treat as the source of truth.

I intentionally kept the scope small and spent most of the effort on the parts that looked riskiest in the prompt:

- local balance snapshots per `employeeId + locationId`
- defensive validation before creating requests
- local reservation of balance while requests are pending
- HCM consumption on approval
- inbound batch sync from HCM
- test coverage around the critical consistency flows

## Stack

- JavaScript
- NestJS
- Prisma
- SQLite
- Jest

## Assumptions

- time-off is handled as generic units rather than full calendar logic
- approval is a single manager action
- balances are scoped only by `employeeId + locationId`, because that is what the prompt asked for
- authentication/authorization are outside the scope of this submission

## A Few Decisions I Made Early

### REST instead of GraphQL

I picked REST because the workflow is mostly about a few state transitions, and I wanted something easy to read and easy to test in a take-home setting.

### Local reservation for pending requests

I went back and forth a bit on this one. In the end I decided that when a request is created, the service should refresh the balance from HCM and reserve units locally right away. The main reason was to avoid the obvious case where two requests hit the same balance snapshot and both look valid until approval time. I preferred making one of them lose earlier instead of carrying both forward.

### HCM remains authoritative

The local balance is just an operational snapshot. On approval, the service calls HCM again and only finalizes the request after HCM accepts the balance consumption.

### Defensive handling when HCM changed independently

If HCM rejects the approval because the balance changed elsewhere, the request is marked as `SYNC_FAILED`, the reservation is released, and the local balance is refreshed when possible.

### Approval claim before HCM mutation

Before calling HCM on approval, the service first moves the request from `PENDING` to `APPROVING`. This avoids a race where two concurrent approval attempts could otherwise consume the same HCM balance twice.

## Project Structure

```text
prisma/
  schema.prisma
scripts/
  prisma-db-push.js
src/
  balances/
  common/
  config/
  hcm/
  health/
  prisma/
  time-off/
test/
  app.e2e.spec.js
  support/
```

## Environment

Example variables are in `.env.example`.

- `PORT`
- `DATABASE_URL`
- `HCM_BASE_URL`

If `DATABASE_URL` is not provided, the app defaults to a SQLite file in `prisma/dev.db`.

## Setup

```bash
npm install
npm run prisma:generate
npm run prisma:push
```

In one terminal:

```bash
npm run mock:hcm
```

In another terminal:

```bash
npm start
```

The mock HCM starts on `http://localhost:4010` by default.  
The main service starts on `http://localhost:3000` by default.

## API Summary

### Balances

- `GET /balances/:employeeId/:locationId`
- `POST /balances/:employeeId/:locationId/refresh`
- `POST /hcm-sync/balances`

### Time-Off Requests

- `POST /time-off-requests`
- `GET /time-off-requests/:requestId`
- `POST /time-off-requests/:requestId/approve`
- `POST /time-off-requests/:requestId/reject`
- `POST /time-off-requests/:requestId/cancel`

## Example Payloads

Create request:

```json
{
  "employeeId": "emp-100",
  "locationId": "loc-1",
  "units": 2,
  "requestedBy": "employee-portal",
  "reason": "family trip",
  "idempotencyKey": "req-100"
}
```

Approve request:

```json
{
  "approvedBy": "manager-42"
}
```

Batch sync:

```json
{
  "balances": [
    {
      "employeeId": "emp-100",
      "locationId": "loc-1",
      "units": 12
    }
  ]
}
```

## Test Strategy

The test suite focuses on the highest-risk flows:

- refreshing balances from HCM
- reserving balance on request creation
- idempotent request creation
- successful approval and HCM consumption
- protection against double approval
- approval failure after external HCM changes
- manager rejection and employee cancellation
- batch sync without losing local reservations
- invalid dimension handling

For the automated tests I mocked the HCM with the same REST behavior used by the client so the tests stay deterministic and focused on the business rules.

There is also a runnable mock HCM server at [scripts/mock-hcm-server.js](/Users/leonardo/github/wizdaa/scripts/mock-hcm-server.js) so the integration can be exercised manually outside the test suite.

## Coverage

Current coverage from `npm run test:cov`:

- Statements: `85.03%`
- Branches: `50.63%`
- Functions: `98.11%`
- Lines: `84.86%`

## Notes

- I used `prisma db push` here to keep setup friction low for whoever reviews the project. In a longer-lived service I would switch to versioned migrations.
- I wrote the project in JavaScript because the prompt explicitly asked for it, even though I would normally lean toward TypeScript for NestJS code.
- I kept NestJS in JavaScript mode because I still wanted the module/controller/service boundaries from the requested stack without adding a TypeScript build step to the submission.
