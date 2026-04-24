# take-home-wizdaa

Time-Off Microservice built for the Wizdaa take-home assessment.

## Overview

This service manages the lifecycle of time-off requests while keeping balances aligned with an external HCM, which is treated as the system of record.

The implementation focuses on a small but defensible scope:

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

## Main Design Choices

### 1. REST instead of GraphQL

REST keeps the take-home smaller, easier to review, and straightforward to test within the time available.

### 2. Local reservation for pending requests

When a request is created, the service refreshes the balance from HCM and reserves units locally. This prevents obviously invalid parallel requests from being created against the same local balance snapshot.

### 3. HCM remains authoritative

Local state is only a cached operational view. On approval, the service calls HCM again and only finalizes the request after HCM accepts the balance consumption.

### 4. Defensive handling when HCM changed independently

If HCM rejects the approval because the balance changed elsewhere, the request is marked as `SYNC_FAILED`, the reservation is released, and the local balance is refreshed when possible.

### 5. Approval claim before HCM mutation

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
npm start
```

The service starts on `http://localhost:3000` by default.

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

The HCM is mocked inside the tests with a small in-memory API that preserves the same REST contract used by the service client.

## Coverage

Current coverage from `npm run test:cov`:

- Statements: `85.03%`
- Branches: `50.63%`
- Functions: `98.11%`
- Lines: `84.86%`

## Notes

- I chose `prisma db push` for setup simplicity in this take-home rather than a heavier migration workflow.
- The source is written in JavaScript to follow the requirement in the prompt.
- I kept NestJS in JavaScript mode because I still wanted the module/controller/service boundaries from the requested stack without adding a TypeScript build step.
