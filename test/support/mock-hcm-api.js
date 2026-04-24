const { createMockHcm } = require("../../src/mock-hcm/create-mock-hcm");

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

async function parseJsonBody(options) {
  if (!options || !options.body) {
    return {};
  }

  return JSON.parse(options.body);
}

function createMockHcmApi(seedBalances = []) {
  const mockHcm = createMockHcm(seedBalances);
  const baseUrl = "http://mock-hcm.local";

  async function fetchHandler(input, options = {}) {
    const url = new URL(typeof input === "string" ? input : input.toString());

    if (!url.href.startsWith(baseUrl)) {
      throw new Error(`Unexpected fetch target: ${url.href}`);
    }

    if (options.method === "GET" && url.pathname === "/balances") {
      const result = await mockHcm.getBalanceResponse(
        url.searchParams.get("employeeId"),
        url.searchParams.get("locationId"),
      );
      return jsonResponse(result.status, result.body);
    }

    if (options.method === "POST" && url.pathname === "/balances/consume") {
      const body = await parseJsonBody(options);
      const result = await mockHcm.consumeBalance(body);
      return jsonResponse(result.status, result.body);
    }

    return jsonResponse(404, {
      message: "Not found.",
    });
  }

  return {
    baseUrl,
    fetchHandler,
    getBalance: mockHcm.getBalance,
    reset: mockHcm.reset,
    setBalance: mockHcm.setBalance,
  };
}

module.exports = {
  createMockHcmApi,
};
