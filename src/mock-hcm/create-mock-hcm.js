function createKey(employeeId, locationId) {
  return `${employeeId}::${locationId}`;
}

function createMockHcm(seedBalances = []) {
  const balances = new Map();

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

  async function getBalanceResponse(employeeId, locationId) {
    const balance = getBalance(employeeId, locationId);

    if (!balance) {
      return {
        status: 422,
        body: {
          message: "Invalid employeeId/locationId combination.",
        },
      };
    }

    return {
      status: 200,
      body: balance,
    };
  }

  async function consumeBalance(body) {
    const balance = getBalance(body.employeeId, body.locationId);

    if (!balance) {
      return {
        status: 422,
        body: {
          message: "Invalid employeeId/locationId combination.",
        },
      };
    }

    if (balance.units < body.units) {
      return {
        status: 409,
        body: {
          message: "Insufficient balance in HCM.",
        },
      };
    }

    balance.units -= body.units;

    return {
      status: 200,
      body: {
        employeeId: balance.employeeId,
        locationId: balance.locationId,
        consumedUnits: body.units,
        remainingUnits: balance.units,
        reference: `hcm-${body.requestId}`,
      },
    };
  }

  reset(seedBalances);

  return {
    consumeBalance,
    getBalance,
    getBalanceResponse,
    reset,
    setBalance,
  };
}

module.exports = {
  createMockHcm,
};
