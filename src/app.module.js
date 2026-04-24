const { Module } = require("@nestjs/common");
const { BalancesController } = require("./balances/balances.controller");
const { BalancesService } = require("./balances/balances.service");
const { applyClassDecorators } = require("./common/nest-helpers");
const { HealthController } = require("./health/health.controller");
const { HcmClient } = require("./hcm/hcm.client");
const { PrismaService } = require("./prisma/prisma.service");
const { TimeOffRequestsController } = require("./time-off/time-off-requests.controller");
const { TimeOffRequestsService } = require("./time-off/time-off-requests.service");

class AppModule {}

applyClassDecorators(AppModule, [
  Module({
    controllers: [
      BalancesController,
      HealthController,
      TimeOffRequestsController,
    ],
    providers: [
      PrismaService,
      HcmClient,
      BalancesService,
      TimeOffRequestsService,
    ],
  }),
]);

module.exports = {
  AppModule,
};
