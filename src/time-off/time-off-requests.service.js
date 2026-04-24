const {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} = require("@nestjs/common");
const { Prisma, TimeOffRequestStatus } = require("@prisma/client");
const {
  applyClassDecorators,
  defineParamTypes,
} = require("../common/nest-helpers");
const { BalancesService } = require("../balances/balances.service");
const { HcmClient } = require("../hcm/hcm.client");
const { PrismaService } = require("../prisma/prisma.service");

class TimeOffRequestsService {
  constructor(prisma, balancesService, hcmClient) {
    this.prisma = prisma;
    this.balancesService = balancesService;
    this.hcmClient = hcmClient;
  }

  async createRequest(payload) {
    if (payload.idempotencyKey) {
      const existing = await this.prisma.timeOffRequest.findUnique({
        where: {
          idempotencyKey: payload.idempotencyKey,
        },
      });

      if (existing) {
        return this.serialize(existing);
      }
    }

    const balance = await this.balancesService.reserveUnits(
      payload.employeeId,
      payload.locationId,
      payload.units,
    );

    try {
      const request = await this.prisma.timeOffRequest.create({
        data: {
          employeeId: payload.employeeId,
          locationId: payload.locationId,
          balanceId: balance.id,
          units: payload.units,
          reason: payload.reason,
          requestedBy: payload.requestedBy,
          idempotencyKey: payload.idempotencyKey,
        },
      });

      return this.serialize(request);
    } catch (error) {
      await this.balancesService.releaseUnits(balance.id, payload.units);

      if (
        payload.idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await this.prisma.timeOffRequest.findUnique({
          where: {
            idempotencyKey: payload.idempotencyKey,
          },
        });

        if (existing) {
          return this.serialize(existing);
        }
      }

      throw error;
    }
  }

  async getRequest(requestId) {
    const request = await this.prisma.timeOffRequest.findUnique({
      where: {
        id: requestId,
      },
    });

    if (!request) {
      throw new NotFoundException("Time-off request not found.");
    }

    return this.serialize(request);
  }

  async approveRequest(requestId, approvedBy) {
    const request = await this.loadPendingRequest(requestId);

    try {
      const hcmResult = await this.hcmClient.consumeBalance({
        employeeId: request.employeeId,
        locationId: request.locationId,
        units: request.units,
        requestId: request.id,
      });

      const updatedRequest = await this.prisma.$transaction(async (tx) => {
        await this.balancesService.finalizeApprovedRequest(
          request.balanceId,
          request.units,
          hcmResult.remainingUnits,
          tx,
        );

        return tx.timeOffRequest.update({
          where: {
            id: request.id,
          },
          data: {
            status: TimeOffRequestStatus.APPROVED,
            approvedBy,
            approvedAt: new Date(),
            hcmReference: hcmResult.reference || null,
            failureReason: null,
          },
        });
      });

      return this.serialize(updatedRequest);
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof NotFoundException ||
        error instanceof UnprocessableEntityException
      ) {
        let remoteBalance = null;

        try {
          remoteBalance = await this.hcmClient.getBalance(request.employeeId, request.locationId);
        } catch (refreshError) {
          remoteBalance = null;
        }

        const updatedRequest = await this.prisma.$transaction(async (tx) => {
          if (remoteBalance) {
            await tx.balance.update({
              where: {
                id: request.balanceId,
              },
              data: {
                authoritativeUnits: remoteBalance.units,
                lastSyncedAt: new Date(),
              },
            });
          }

          await this.balancesService.releaseUnits(request.balanceId, request.units, tx);

          return tx.timeOffRequest.update({
            where: {
              id: request.id,
            },
            data: {
              status: TimeOffRequestStatus.SYNC_FAILED,
              failureReason: error.message,
            },
          });
        });

        return this.serialize(updatedRequest);
      }

      throw error;
    }
  }

  async rejectRequest(requestId, reason) {
    const request = await this.loadPendingRequest(requestId);

    const updatedRequest = await this.prisma.$transaction(async (tx) => {
      await this.balancesService.releaseUnits(request.balanceId, request.units, tx);

      return tx.timeOffRequest.update({
        where: {
          id: request.id,
        },
        data: {
          status: TimeOffRequestStatus.REJECTED,
          failureReason: reason || "Rejected by manager.",
          rejectedAt: new Date(),
        },
      });
    });

    return this.serialize(updatedRequest);
  }

  async cancelRequest(requestId) {
    const request = await this.loadPendingRequest(requestId);

    const updatedRequest = await this.prisma.$transaction(async (tx) => {
      await this.balancesService.releaseUnits(request.balanceId, request.units, tx);

      return tx.timeOffRequest.update({
        where: {
          id: request.id,
        },
        data: {
          status: TimeOffRequestStatus.CANCELED,
          canceledAt: new Date(),
        },
      });
    });

    return this.serialize(updatedRequest);
  }

  async loadPendingRequest(requestId) {
    const request = await this.prisma.timeOffRequest.findUnique({
      where: {
        id: requestId,
      },
    });

    if (!request) {
      throw new NotFoundException("Time-off request not found.");
    }

    if (request.status !== TimeOffRequestStatus.PENDING) {
      throw new ConflictException("Only pending requests can be changed.");
    }

    return request;
  }

  serialize(request) {
    return {
      id: request.id,
      employeeId: request.employeeId,
      locationId: request.locationId,
      units: request.units,
      reason: request.reason,
      requestedBy: request.requestedBy,
      approvedBy: request.approvedBy,
      failureReason: request.failureReason,
      hcmReference: request.hcmReference,
      status: request.status,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      approvedAt: request.approvedAt,
      rejectedAt: request.rejectedAt,
      canceledAt: request.canceledAt,
    };
  }
}

defineParamTypes(TimeOffRequestsService, [PrismaService, BalancesService, HcmClient]);
applyClassDecorators(TimeOffRequestsService, [Injectable()]);

module.exports = {
  TimeOffRequestsService,
};
