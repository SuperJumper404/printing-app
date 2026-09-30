const { createProtocol } = require("./common");

function createNeptingProtocol() {
  return createProtocol({
    id: "nepting",
    defaultVersion: "0320",
    includeTransactionId: true,
  });
}

module.exports = { createNeptingProtocol };
