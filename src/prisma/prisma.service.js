const { Injectable } = require("@nestjs/common");
const { PrismaClient } = require("@prisma/client");
const { applyClassDecorators } = require("../common/nest-helpers");
const { ensureDatabaseUrl } = require("../config/runtime-env");

ensureDatabaseUrl();

class PrismaService extends PrismaClient {
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

applyClassDecorators(PrismaService, [Injectable()]);

module.exports = {
  PrismaService,
};
