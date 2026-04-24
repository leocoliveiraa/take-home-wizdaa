const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function createDatabaseUrl(testName) {
  const safeName = testName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const databasePath = path.join(os.tmpdir(), `${safeName}-${Date.now()}.db`);

  return {
    databasePath,
    databaseUrl: `file:${databasePath}`,
  };
}

function pushSchema(databaseUrl) {
  const result = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["prisma", "db", "push", "--skip-generate"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        RUST_LOG: "info",
      },
      encoding: "utf8",
    },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Failed to push Prisma schema.");
  }
}

async function createTestApp(options) {
  process.env.DATABASE_URL = options.databaseUrl;
  process.env.HCM_BASE_URL = options.hcmBaseUrl;

  jest.resetModules();

  const { Test } = require("@nestjs/testing");
  const { AppModule } = require("../../src/app.module");
  const { BalancesController } = require("../../src/balances/balances.controller");
  const { HealthController } = require("../../src/health/health.controller");
  const { TimeOffRequestsController } = require("../../src/time-off/time-off-requests.controller");

  const testingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = testingModule.createNestApplication();
  await app.init();

  return {
    app,
    balancesController: testingModule.get(BalancesController),
    healthController: testingModule.get(HealthController),
    timeOffRequestsController: testingModule.get(TimeOffRequestsController),
  };
}

function cleanupDatabase(databasePath) {
  if (fs.existsSync(databasePath)) {
    fs.rmSync(databasePath, { force: true });
  }
}

module.exports = {
  cleanupDatabase,
  createDatabaseUrl,
  createTestApp,
  pushSchema,
};
