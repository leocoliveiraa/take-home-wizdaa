const http = require("http");
const { createMockHcm } = require("../src/mock-hcm/create-mock-hcm");

const port = Number(process.env.MOCK_HCM_PORT || 4010);
const mockHcm = createMockHcm([
  { employeeId: "emp-100", locationId: "loc-1", units: 10 },
  { employeeId: "emp-200", locationId: "loc-1", units: 15 },
]);

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json",
  });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/balances") {
    const result = await mockHcm.getBalanceResponse(
      url.searchParams.get("employeeId"),
      url.searchParams.get("locationId"),
    );
    sendJson(res, result.status, result.body);
    return;
  }

  if (req.method === "POST" && url.pathname === "/balances/consume") {
    const body = await readJson(req);
    const result = await mockHcm.consumeBalance(body);
    sendJson(res, result.status, result.body);
    return;
  }

  sendJson(res, 404, {
    message: "Not found.",
  });
});

server.listen(port, () => {
  console.log(`Mock HCM listening on http://localhost:${port}`);
});
