const {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} = require("@nestjs/common");
const { Prisma } = require("@prisma/client");
const {
  applyClassDecorators,
  defineParamTypes,
} = require("../common/nest-helpers");
const { HcmClient } = require("../hcm/hcm.client");
const { PrismaService } = require("../prisma/prisma.service");

class BalancesService {
  constructor(prisma, hcmClient) {
    this.prisma = prisma;
    this.hcmClient = hcmClient;
  }

  async getBalance(employeeId, locationId) {
    const balance = await this.prisma.balance.findUnique({
      where: {
        employeeId_locationId: {
          employeeId,
          locationId,
        },
      },
    });

    if (!balance) {
      throw new NotFoundException("Balance was not found locally. Refresh it from HCM first.");
    }

    return this.serialize(balance);
  }

  async refreshFromHcm(employeeId, locationId) {
    const remoteBalance = await this.hcmClient.getBalance(employeeId, locationId);

    const balance = await this.prisma.balance.upsert({
      where: {
        employeeId_locationId: {
          employeeId,
          locationId,
        },
      },
      create: {
        employeeId,
        locationId,
        authoritativeUnits: remoteBalance.units,
        lastSyncedAt: new Date(),
      },
      update: {
        authoritativeUnits: remoteBalance.units,
        lastSyncedAt: new Date(),
      },
    });

    return this.serialize(balance);
  }

  async applyBatchSync(entries) {
    const updatedBalances = [];

    await this.prisma.$transaction(async (tx) => {
      for (const entry of entries) {
        const balance = await tx.balance.upsert({
          where: {
            employeeId_locationId: {
              employeeId: entry.employeeId,
              locationId: entry.locationId,
            },
          },
          create: {
            employeeId: entry.employeeId,
            locationId: entry.locationId,
            authoritativeUnits: entry.units,
            lastSyncedAt: new Date(),
          },
          update: {
            authoritativeUnits: entry.units,
            lastSyncedAt: new Date(),
          },
        });

        updatedBalances.push(this.serialize(balance));
      }
    });

    return updatedBalances;
  }

  async reserveUnits(employeeId, locationId, units) {
    await this.refreshFromHcm(employeeId, locationId);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const balance = await this.prisma.balance.findUnique({
        where: {
          employeeId_locationId: {
            employeeId,
            locationId,
          },
        },
      });

      if (!balance) {
        throw new UnprocessableEntityException("Balance could not be initialized.");
      }

      const availableUnits = balance.authoritativeUnits - balance.reservedUnits;

      if (availableUnits < units) {
        throw new ConflictException("Insufficient balance.");
      }

      const result = await this.prisma.balance.updateMany({
        where: {
          id: balance.id,
          version: balance.version,
        },
        data: {
          reservedUnits: {
            increment: units,
          },
          version: {
            increment: 1,
          },
        },
      });

      if (result.count === 1) {
        return this.prisma.balance.findUnique({
          where: {
            id: balance.id,
          },
        });
      }
    }

    throw new ConflictException("Balance changed while reserving units. Please retry.");
  }

  async releaseUnits(balanceId, units, prismaOverride) {
    const prisma = prismaOverride || this.prisma;

    return this.updateReservedUnits(balanceId, units * -1, prisma);
  }

  async finalizeApprovedRequest(balanceId, units, authoritativeUnits, prismaOverride) {
    const prisma = prismaOverride || this.prisma;

    return prisma.balance.update({
      where: {
        id: balanceId,
      },
      data: {
        authoritativeUnits,
        reservedUnits: {
          decrement: units,
        },
        version: {
          increment: 1,
        },
        lastSyncedAt: new Date(),
      },
    });
  }

  async updateReservedUnits(balanceId, delta, prisma) {
    try {
      return await prisma.balance.update({
        where: {
          id: balanceId,
        },
        data: {
          reservedUnits: delta > 0 ? { increment: delta } : { decrement: Math.abs(delta) },
          version: {
            increment: 1,
          },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw new NotFoundException("Balance not found.");
      }

      throw error;
    }
  }

  serialize(balance) {
    const availableUnits = balance.authoritativeUnits - balance.reservedUnits;

    return {
      id: balance.id,
      employeeId: balance.employeeId,
      locationId: balance.locationId,
      authoritativeUnits: balance.authoritativeUnits,
      reservedUnits: balance.reservedUnits,
      availableUnits,
      hasConflict: availableUnits < 0,
      lastSyncedAt: balance.lastSyncedAt,
      createdAt: balance.createdAt,
      updatedAt: balance.updatedAt,
    };
  }
}

defineParamTypes(BalancesService, [PrismaService, HcmClient]);
applyClassDecorators(BalancesService, [Injectable()]);

module.exports = {
  BalancesService,
};
