# Technical Requirements Document

## 1. Problem Statement

ReadyOn is the main employee-facing interface for time-off requests, but the HCM remains the source of truth for balances and dimension validity.

That creates a consistency problem:

- employees want immediate feedback
- managers want approval decisions based on valid data
- HCM balances can change outside this service
- HCM validation exists, but the service should still behave defensively

The main risk is allowing local state to drift too far from HCM or approving requests that look valid locally but are no longer valid in the source system.

## 2. Goals

- Manage the lifecycle of a time-off request
- Keep balance integrity per `employeeId + locationId`
- Support both real-time HCM calls and inbound batch sync
- Fail safely when HCM data changes independently
- Provide a test suite that protects the most important consistency paths

## 3. Non-Goals

- Authentication and authorization
- A UI
- Multi-step approval chains
- Partial-day calendars, holidays, or accrual policies
- Event buses or async workers

These can exist in a production system, but they are intentionally out of scope here to keep the take-home focused on balance integrity and sync behavior.

## 4. Functional Requirements

The service must:

- expose REST endpoints for balances and time-off requests
- store balances per employee and location
- refresh a balance from HCM in real time
- accept batch balance updates from HCM
- create a pending time-off request
- approve, reject, or cancel a pending request
- validate balance availability defensively before creating a request
- consume balance in HCM when a request is approved
- handle invalid dimensions and insufficient balance gracefully

## 5. Main Challenges

### 5.1 External balance changes

ReadyOn is not the only writer. HCM balances may change because of:

- year rollover
- work anniversary grants
- external admin actions
- other integrated systems

### 5.2 Local race conditions

Two requests can be created close together against the same balance snapshot.

### 5.3 HCM cannot be trusted as the only guardrail

Even though HCM may reject invalid or insufficient requests, the service should not create obviously invalid requests if it can detect the issue locally.

### 5.4 Batch sync vs in-flight requests

Inbound batch updates should refresh authoritative balance values without losing local knowledge about pending reservations.

## 6. Proposed Solution

### 6.1 Domain Model

#### Balance

- `employeeId`
- `locationId`
- `authoritativeUnits`
- `reservedUnits`
- `version`
- `lastSyncedAt`

`authoritativeUnits` is the latest balance known from HCM.  
`reservedUnits` tracks local pending requests that have not yet been consumed in HCM.

Available balance is derived as:

`availableUnits = authoritativeUnits - reservedUnits`

#### TimeOffRequest

- `employeeId`
- `locationId`
- `units`
- `status`
- `requestedBy`
- `approvedBy`
- `reason`
- `failureReason`
- `idempotencyKey`
- timestamps

Statuses:

- `PENDING`
- `APPROVING`
- `APPROVED`
- `REJECTED`
- `CANCELED`
- `SYNC_FAILED`

### 6.2 Request Lifecycle

#### Create request

1. Refresh balance from HCM
2. Check local availability
3. Reserve units locally
4. Persist request as `PENDING`

Why reserve on create:

- gives immediate feedback
- reduces obvious oversubscription from parallel local requests
- lets managers see pending demand reflected locally

#### Approve request

1. Atomically claim the request by moving it from `PENDING` to `APPROVING`
2. Call HCM to consume units
3. If HCM accepts:
   - mark request `APPROVED`
   - clear reserved units
   - update authoritative balance from HCM response
4. If HCM rejects because data changed:
   - mark request `SYNC_FAILED`
   - release local reservation
   - refresh local authoritative balance when possible

Using the intermediate `APPROVING` state avoids a race where two managers approve the same request at nearly the same time and both end up consuming balance in HCM.

#### Reject request

- release reservation
- mark request `REJECTED`

#### Cancel request

- release reservation
- mark request `CANCELED`

### 6.3 Sync Strategy

#### Real-time sync

Used in two places:

- before request creation
- when approval fails and the service wants to recover local state

#### Batch sync

`POST /hcm-sync/balances`

The batch updates only the authoritative balance snapshot. It does not delete or overwrite `reservedUnits`, because pending local requests are still relevant operationally.

This means a batch update can reveal a conflict by reducing the available balance below zero. That is intentional and useful.

## 7. Consistency Strategy

### 7.1 Defensive local validation

The service checks:

- that the dimension exists in HCM
- that balance is sufficient locally after refresh

### 7.2 Optimistic concurrency for reservation

`Balance.version` is used to avoid silent lost updates while reserving balance.

The service retries reservation a small number of times and fails if the balance changed too often during the operation.

### 7.3 Approval claiming

The request itself is also protected from duplicate approvals by requiring a transition from `PENDING` to `APPROVING` before the HCM mutation happens.

### 7.4 Idempotent request creation

An optional `idempotencyKey` allows safe retries from the client without double-reserving balance.

## 8. API Design

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

I chose REST over GraphQL because the resources and transitions are simple and explicit, and this keeps the take-home easier to review.

## 9. Security Considerations

Within the scope of this exercise, the main security and safety concerns are:

- validate all incoming input
- avoid trusting HCM blindly
- fail closed on invalid dimensions
- avoid duplicate request creation through idempotency
- avoid over-reserving through optimistic concurrency

Full authn/authz is intentionally out of scope, but in production I would put all mutating endpoints behind authenticated service or user identity and role checks.

## 10. Alternatives Considered

### Alternative A: Consume HCM immediately on request creation

Rejected for this take-home.

Pros:

- fewer local states
- stronger immediate consistency

Cons:

- approval workflow becomes awkward
- a manager can no longer reject without compensating actions
- creates tighter coupling between employee draft action and final system-of-record mutation

### Alternative B: Keep no local reservation at all

Rejected.

Pros:

- simpler local model

Cons:

- allows multiple pending requests to pile up against the same apparent availability
- weakens employee and manager feedback

### Alternative C: Event-driven/outbox architecture

Interesting, but out of scope here.

Pros:

- better for scale and auditability
- fits microservice environments well

Cons:

- too much complexity for this challenge
- more infrastructure than the exercise asks for

## 11. Test Strategy

I prioritized integration-style tests across controller + service + Prisma + mocked HCM behavior.

Covered scenarios:

- health check
- refresh from HCM
- create request and reserve balance
- idempotent request creation
- successful approval
- double approval protection
- approval failure after external HCM change
- manager rejection
- request cancellation
- invalid dimension handling
- batch sync while reservations exist

The HCM is mocked with the same request/response contract the client uses, which keeps tests focused on business behavior rather than implementation internals.

I also included a small runnable mock HCM server so the REST integration can be exercised manually, not only through the automated tests.

Coverage from the current run:

- Statements: `85.03%`
- Branches: `50.63%`
- Functions: `98.11%`
- Lines: `84.86%`

## 12. Limitations and Next Steps

If I were extending this beyond the take-home, the next items would be:

- stronger audit history for every balance transition
- authenticated identities and role checks
- richer approval metadata
- pagination/filtering for request lists
- stronger reconciliation/reporting for negative available balances after external changes
- background re-sync jobs and retry policy for transient HCM outages

## 13. Final Rationale

The solution intentionally stays small, but the core consistency decisions are deliberate:

- validate against HCM before local reservation
- reserve locally while pending
- only finalize on successful HCM consumption
- preserve reservations during batch sync
- recover explicitly when HCM changed outside the service

That gives employees fast feedback, gives managers a safer approval path, and keeps the implementation understandable for a take-home submission.
