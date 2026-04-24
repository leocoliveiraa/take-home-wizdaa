const { createMockHcmApi } = require("./support/mock-hcm-api");
const {
  cleanupDatabase,
  createDatabaseUrl,
  createTestApp,
  pushSchema,
} = require("./support/test-app");

describe("Time-Off Microservice", () => {
  let context;
  let hcmApi;
  let hcmBaseUrl;
  let currentDatabase;
  const originalFetch = global.fetch;

  async function bootApp(testName) {
    currentDatabase = createDatabaseUrl(testName);
    pushSchema(currentDatabase.databaseUrl);
    context = await createTestApp({
      databaseUrl: currentDatabase.databaseUrl,
      hcmBaseUrl,
    });

    return context;
  }

  beforeAll(() => {
    hcmApi = createMockHcmApi();
    hcmBaseUrl = hcmApi.baseUrl;
    global.fetch = hcmApi.fetchHandler;
  });

  afterEach(async () => {
    if (context) {
      await context.app.close();
      context = null;
    }

    if (currentDatabase) {
      cleanupDatabase(currentDatabase.databasePath);
      currentDatabase = null;
    }
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("refreshes a local balance from HCM", async () => {
    hcmApi.reset([
      { employeeId: "emp-1", locationId: "loc-1", units: 10 },
    ]);

    const { balancesController } = await bootApp("refresh-balance");
    const response = await balancesController.refreshBalance("emp-1", "loc-1");

    expect(response.authoritativeUnits).toBe(10);
    expect(response.reservedUnits).toBe(0);
    expect(response.availableUnits).toBe(10);
  });

  it("exposes a basic health check", async () => {
    const { healthController } = await bootApp("health-check");
    const response = healthController.getHealth();

    expect(response).toEqual({
      status: "ok",
      service: "time-off-microservice",
    });
  });

  it("creates a pending request and reserves local balance", async () => {
    hcmApi.reset([
      { employeeId: "emp-2", locationId: "loc-1", units: 10 },
    ]);

    const { balancesController, timeOffRequestsController } = await bootApp("create-request");
    const createResponse = await timeOffRequestsController.createRequest({
      employeeId: "emp-2",
      locationId: "loc-1",
      units: 3,
      requestedBy: "employee-portal",
      reason: "family trip",
    });

    expect(createResponse.status).toBe("PENDING");

    const balanceResponse = await balancesController.getBalance("emp-2", "loc-1");

    expect(balanceResponse.authoritativeUnits).toBe(10);
    expect(balanceResponse.reservedUnits).toBe(3);
    expect(balanceResponse.availableUnits).toBe(7);
  });

  it("honors idempotency keys without double-reserving balance", async () => {
    hcmApi.reset([
      { employeeId: "emp-3", locationId: "loc-1", units: 8 },
    ]);

    const { balancesController, timeOffRequestsController } = await bootApp("idempotency");

    const payload = {
      employeeId: "emp-3",
      locationId: "loc-1",
      units: 2,
      requestedBy: "employee-portal",
      idempotencyKey: "same-key",
    };

    const firstResponse = await timeOffRequestsController.createRequest(payload);
    const secondResponse = await timeOffRequestsController.createRequest(payload);
    const balanceResponse = await balancesController.getBalance("emp-3", "loc-1");

    expect(secondResponse.id).toBe(firstResponse.id);
    expect(balanceResponse.reservedUnits).toBe(2);
    expect(balanceResponse.availableUnits).toBe(6);
  });

  it("approves a request and syncs the authoritative balance with HCM", async () => {
    hcmApi.reset([
      { employeeId: "emp-4", locationId: "loc-1", units: 10 },
    ]);

    const { balancesController, timeOffRequestsController } = await bootApp("approve-request");

    const createResponse = await timeOffRequestsController.createRequest({
      employeeId: "emp-4",
      locationId: "loc-1",
      units: 4,
      requestedBy: "employee-portal",
    });

    const approveResponse = await timeOffRequestsController.approveRequest(createResponse.id, {
      approvedBy: "manager-1",
    });
    const balanceResponse = await balancesController.getBalance("emp-4", "loc-1");

    expect(approveResponse.status).toBe("APPROVED");
    expect(approveResponse.approvedBy).toBe("manager-1");
    expect(balanceResponse.authoritativeUnits).toBe(6);
    expect(balanceResponse.reservedUnits).toBe(0);
    expect(hcmApi.getBalance("emp-4", "loc-1").units).toBe(6);
  });

  it("marks a request as sync failed if HCM changed independently before approval", async () => {
    hcmApi.reset([
      { employeeId: "emp-5", locationId: "loc-1", units: 3 },
    ]);

    const { balancesController, timeOffRequestsController } = await bootApp("sync-failed");

    const createResponse = await timeOffRequestsController.createRequest({
      employeeId: "emp-5",
      locationId: "loc-1",
      units: 2,
      requestedBy: "employee-portal",
    });

    hcmApi.setBalance({
      employeeId: "emp-5",
      locationId: "loc-1",
      units: 1,
    });

    const approveResponse = await timeOffRequestsController.approveRequest(createResponse.id, {
      approvedBy: "manager-2",
    });
    const balanceResponse = await balancesController.getBalance("emp-5", "loc-1");

    expect(approveResponse.status).toBe("SYNC_FAILED");
    expect(approveResponse.failureReason).toContain("Insufficient");
    expect(balanceResponse.authoritativeUnits).toBe(1);
    expect(balanceResponse.reservedUnits).toBe(0);
    expect(balanceResponse.availableUnits).toBe(1);
  });

  it("rejects a pending request and releases the reservation", async () => {
    hcmApi.reset([
      { employeeId: "emp-7", locationId: "loc-1", units: 9 },
    ]);

    const { balancesController, timeOffRequestsController } = await bootApp("reject-request");

    const createResponse = await timeOffRequestsController.createRequest({
      employeeId: "emp-7",
      locationId: "loc-1",
      units: 4,
      requestedBy: "employee-portal",
    });

    const rejectResponse = await timeOffRequestsController.rejectRequest(createResponse.id, {
      reason: "Blackout period",
    });
    const balanceResponse = await balancesController.getBalance("emp-7", "loc-1");

    expect(rejectResponse.status).toBe("REJECTED");
    expect(rejectResponse.failureReason).toBe("Blackout period");
    expect(balanceResponse.reservedUnits).toBe(0);
    expect(balanceResponse.availableUnits).toBe(9);
  });

  it("cancels a pending request and releases the reservation", async () => {
    hcmApi.reset([
      { employeeId: "emp-8", locationId: "loc-1", units: 5 },
    ]);

    const { balancesController, timeOffRequestsController } = await bootApp("cancel-request");

    const createResponse = await timeOffRequestsController.createRequest({
      employeeId: "emp-8",
      locationId: "loc-1",
      units: 2,
      requestedBy: "employee-portal",
    });

    const cancelResponse = await timeOffRequestsController.cancelRequest(createResponse.id);
    const requestResponse = await timeOffRequestsController.getRequest(createResponse.id);
    const balanceResponse = await balancesController.getBalance("emp-8", "loc-1");

    expect(cancelResponse.status).toBe("CANCELED");
    expect(requestResponse.status).toBe("CANCELED");
    expect(balanceResponse.reservedUnits).toBe(0);
    expect(balanceResponse.availableUnits).toBe(5);
  });

  it("fails fast when HCM rejects an invalid employee/location combination", async () => {
    hcmApi.reset([]);

    const { timeOffRequestsController } = await bootApp("invalid-dimension");

    await expect(
      timeOffRequestsController.createRequest({
        employeeId: "missing-employee",
        locationId: "missing-location",
        units: 2,
        requestedBy: "employee-portal",
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("Invalid employeeId/locationId combination"),
    });
  });

  it("applies HCM batch sync without dropping local reservations", async () => {
    hcmApi.reset([
      { employeeId: "emp-6", locationId: "loc-1", units: 8 },
    ]);

    const { balancesController, timeOffRequestsController } = await bootApp("batch-sync");

    await timeOffRequestsController.createRequest({
      employeeId: "emp-6",
      locationId: "loc-1",
      units: 3,
      requestedBy: "employee-portal",
    });

    const batchResponse = await balancesController.batchSync({
      balances: [
        { employeeId: "emp-6", locationId: "loc-1", units: 12 },
      ],
    });
    const balanceResponse = await balancesController.getBalance("emp-6", "loc-1");

    expect(batchResponse.updated).toHaveLength(1);
    expect(balanceResponse.authoritativeUnits).toBe(12);
    expect(balanceResponse.reservedUnits).toBe(3);
    expect(balanceResponse.availableUnits).toBe(9);
  });
});
