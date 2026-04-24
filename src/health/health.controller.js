const { Controller, Get } = require("@nestjs/common");
const { applyClassDecorators, applyMethodDecorators } = require("../common/nest-helpers");

class HealthController {
  getHealth() {
    return {
      status: "ok",
      service: "time-off-microservice",
    };
  }
}

applyClassDecorators(HealthController, [Controller()]);
applyMethodDecorators(HealthController, "getHealth", [Get("health")]);

module.exports = {
  HealthController,
};
