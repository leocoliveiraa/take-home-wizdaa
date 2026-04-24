const {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} = require("@nestjs/common");
const { applyClassDecorators } = require("../common/nest-helpers");

class HcmClient {
  constructor() {
    this.baseUrl = process.env.HCM_BASE_URL || "http://localhost:4010";
  }

  async getBalance(employeeId, locationId) {
    const url = new URL("/balances", this.baseUrl);
    url.searchParams.set("employeeId", employeeId);
    url.searchParams.set("locationId", locationId);

    const response = await this.request(url, {
      method: "GET",
    });

    return {
      employeeId: response.employeeId,
      locationId: response.locationId,
      units: response.units,
    };
  }

  async consumeBalance(payload) {
    const url = new URL("/balances/consume", this.baseUrl);

    return this.request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  }

  async request(url, options) {
    let response;

    try {
      response = await fetch(url, options);
    } catch (error) {
      throw new ServiceUnavailableException(`HCM is unavailable: ${error.message}`);
    }

    const body = await this.parseJson(response);

    if (response.ok) {
      return body;
    }

    const message = body.message || "HCM request failed.";

    if (response.status === 404 || response.status === 422) {
      throw new UnprocessableEntityException(message);
    }

    if (response.status === 409) {
      throw new ConflictException(message);
    }

    if (response.status >= 400 && response.status < 500) {
      throw new BadRequestException(message);
    }

    throw new ServiceUnavailableException(message);
  }

  async parseJson(response) {
    const text = await response.text();

    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      throw new ServiceUnavailableException("HCM returned an invalid JSON payload.");
    }
  }
}

applyClassDecorators(HcmClient, [Injectable()]);

module.exports = {
  HcmClient,
};
