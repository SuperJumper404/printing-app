const { createProtocol } = require("./common");

function createCaisseApProtocol() {
  return createProtocol({
    id: "caisse-ap",
    defaultVersion: "0300",
    includeTransactionId: false,
  });
}

module.exports = { createCaisseApProtocol };
