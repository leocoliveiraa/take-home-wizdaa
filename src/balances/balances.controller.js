const { Body, Controller, Get, Param, Post } = require("@nestjs/common");
const {
  applyClassDecorators,
  applyMethodDecorators,
  applyParamDecorators,
  defineParamTypes,
} = require("../common/nest-helpers");
const {
  requireArray,
  requireNonEmptyString,
  requirePositiveNumber,
} = require("../common/validation");
const { BalancesService } = require("./balances.service");

class BalancesController {
  constructor(balancesService) {
    this.balancesService = balancesService;
  }

  async getBalance(employeeId, locationId) {
    return this.balancesService.getBalance(
      requireNonEmptyString(employeeId, "employeeId"),
      requireNonEmptyString(locationId, "locationId"),
    );
  }

  async refreshBalance(employeeId, locationId) {
    return this.balancesService.refreshFromHcm(
      requireNonEmptyString(employeeId, "employeeId"),
      requireNonEmptyString(locationId, "locationId"),
    );
  }

  async batchSync(body) {
    const balances = requireArray(body.balances, "balances").map((entry) => ({
      employeeId: requireNonEmptyString(entry.employeeId, "employeeId"),
      locationId: requireNonEmptyString(entry.locationId, "locationId"),
      units: requirePositiveNumber(entry.units, "units"),
    }));

    return {
      updated: await this.balancesService.applyBatchSync(balances),
    };
  }
}

defineParamTypes(BalancesController, [BalancesService]);
applyClassDecorators(BalancesController, [Controller()]);
applyMethodDecorators(BalancesController, "getBalance", [Get("balances/:employeeId/:locationId")]);
applyParamDecorators(BalancesController, "getBalance", 0, [Param("employeeId")]);
applyParamDecorators(BalancesController, "getBalance", 1, [Param("locationId")]);
applyMethodDecorators(BalancesController, "refreshBalance", [
  Post("balances/:employeeId/:locationId/refresh"),
]);
applyParamDecorators(BalancesController, "refreshBalance", 0, [Param("employeeId")]);
applyParamDecorators(BalancesController, "refreshBalance", 1, [Param("locationId")]);
applyMethodDecorators(BalancesController, "batchSync", [Post("hcm-sync/balances")]);
applyParamDecorators(BalancesController, "batchSync", 0, [Body()]);

module.exports = {
  BalancesController,
};
