const { Body, Controller, Get, HttpCode, Param, Post } = require("@nestjs/common");
const {
  applyClassDecorators,
  applyMethodDecorators,
  applyParamDecorators,
  defineParamTypes,
} = require("../common/nest-helpers");
const {
  optionalNonEmptyString,
  requireNonEmptyString,
  requirePositiveNumber,
} = require("../common/validation");
const { TimeOffRequestsService } = require("./time-off-requests.service");

class TimeOffRequestsController {
  constructor(timeOffRequestsService) {
    this.timeOffRequestsService = timeOffRequestsService;
  }

  async createRequest(body) {
    return this.timeOffRequestsService.createRequest({
      employeeId: requireNonEmptyString(body.employeeId, "employeeId"),
      locationId: requireNonEmptyString(body.locationId, "locationId"),
      units: requirePositiveNumber(body.units, "units"),
      requestedBy: requireNonEmptyString(body.requestedBy, "requestedBy"),
      reason: optionalNonEmptyString(body.reason, "reason"),
      idempotencyKey: optionalNonEmptyString(body.idempotencyKey, "idempotencyKey"),
    });
  }

  async getRequest(requestId) {
    return this.timeOffRequestsService.getRequest(requireNonEmptyString(requestId, "requestId"));
  }

  async approveRequest(requestId, body) {
    return this.timeOffRequestsService.approveRequest(
      requireNonEmptyString(requestId, "requestId"),
      requireNonEmptyString(body.approvedBy, "approvedBy"),
    );
  }

  async rejectRequest(requestId, body) {
    return this.timeOffRequestsService.rejectRequest(
      requireNonEmptyString(requestId, "requestId"),
      optionalNonEmptyString(body.reason, "reason"),
    );
  }

  async cancelRequest(requestId) {
    return this.timeOffRequestsService.cancelRequest(requireNonEmptyString(requestId, "requestId"));
  }
}

defineParamTypes(TimeOffRequestsController, [TimeOffRequestsService]);
applyClassDecorators(TimeOffRequestsController, [Controller("time-off-requests")]);
applyMethodDecorators(TimeOffRequestsController, "createRequest", [Post()]);
applyParamDecorators(TimeOffRequestsController, "createRequest", 0, [Body()]);
applyMethodDecorators(TimeOffRequestsController, "getRequest", [Get(":requestId")]);
applyParamDecorators(TimeOffRequestsController, "getRequest", 0, [Param("requestId")]);
applyMethodDecorators(TimeOffRequestsController, "approveRequest", [
  Post(":requestId/approve"),
  HttpCode(200),
]);
applyParamDecorators(TimeOffRequestsController, "approveRequest", 0, [Param("requestId")]);
applyParamDecorators(TimeOffRequestsController, "approveRequest", 1, [Body()]);
applyMethodDecorators(TimeOffRequestsController, "rejectRequest", [
  Post(":requestId/reject"),
  HttpCode(200),
]);
applyParamDecorators(TimeOffRequestsController, "rejectRequest", 0, [Param("requestId")]);
applyParamDecorators(TimeOffRequestsController, "rejectRequest", 1, [Body()]);
applyMethodDecorators(TimeOffRequestsController, "cancelRequest", [
  Post(":requestId/cancel"),
  HttpCode(200),
]);
applyParamDecorators(TimeOffRequestsController, "cancelRequest", 0, [Param("requestId")]);

module.exports = {
  TimeOffRequestsController,
};
