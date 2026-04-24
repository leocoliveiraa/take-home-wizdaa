function createKey(employeeId, locationId) {
  return `${employeeId}::${locationId}`;
}

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
  const balances = new Map();
  const baseUrl = "http://mock-hcm.local";

  function reset(nextBalances = []) {
    balances.clear();
    nextBalances.forEach((entry) => {
      balances.set(createKey(entry.employeeId, entry.locationId), { ...entry });
    });
  }

  function setBalance(entry) {
    balances.set(createKey(entry.employeeId, entry.locationId), { ...entry });
  }

  function getBalance(employeeId, locationId) {
    return balances.get(createKey(employeeId, locationId)) || null;
  }

  async function fetchHandler(input, options = {}) {
    const url = new URL(typeof input === "string" ? input : input.toString());

    if (!url.href.startsWith(baseUrl)) {
      throw new Error(`Unexpected fetch target: ${url.href}`);
    }

    if (options.method === "GET" && url.pathname === "/balances") {
      const employeeId = url.searchParams.get("employeeId");
      const locationId = url.searchParams.get("locationId");
      const balance = getBalance(employeeId, locationId);

      if (!balance) {
        return jsonResponse(422, {
          message: "Invalid employeeId/locationId combination.",
        });
      }

      return jsonResponse(200, balance);
    }

    if (options.method === "POST" && url.pathname === "/balances/consume") {
      const body = await parseJsonBody(options);
      const balance = getBalance(body.employeeId, body.locationId);

      if (!balance) {
        return jsonResponse(422, {
          message: "Invalid employeeId/locationId combination.",
        });
      }

      if (balance.units < body.units) {
        return jsonResponse(409, {
          message: "Insufficient balance in HCM.",
        });
      }

      balance.units -= body.units;

      return jsonResponse(200, {
        employeeId: balance.employeeId,
        locationId: balance.locationId,
        consumedUnits: body.units,
        remainingUnits: balance.units,
        reference: `hcm-${body.requestId}`,
      });
    }

    return jsonResponse(404, {
      message: "Not found.",
    });
  }

  reset(seedBalances);

  return {
    baseUrl,
    fetchHandler,
    getBalance,
    reset,
    setBalance,
  };
}

module.exports = {
  createMockHcmApi,
};
