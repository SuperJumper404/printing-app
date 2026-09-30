const crypto = require("crypto");

const STATUS_BY_CODE = Object.freeze({
  authentication_required: 401,
  invalid_payment_request: 400,
  invalid_configuration: 400,
  terminal_not_found: 404,
  transaction_not_found: 404,
  transaction_conflict: 409,
  terminal_busy: 409,
  cancellation_not_available: 409,
  cancellation_not_supported: 409,
});

const MESSAGE_BY_CODE = Object.freeze({
  authentication_required: "Authentification requise",
  transaction_not_found: "Transaction inconnue",
});

function tokensMatch(actual, expected) {
  if (!actual || !expected) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function bearerToken(header) {
  const match = /^Bearer ([^\s]+)$/i.exec(String(header || ""));
  return match?.[1] || null;
}

function sendError(res, error) {
  const suppliedCode = error?.code || "internal_error";
  const known = Object.hasOwn(STATUS_BY_CODE, suppliedCode);
  const code = known ? suppliedCode : "internal_error";
  const message = MESSAGE_BY_CODE[code]
    || (known && error?.message)
    || "Erreur interne du module TPE";
  const body = { error: { code, message } };
  if (known && error?.details !== undefined) body.error.details = error.details;
  res.status(STATUS_BY_CODE[code] || 500).json(body);
}

function publicTerminal(terminal) {
  const fields = [
    "id",
    "name",
    "manufacturer",
    "model",
    "enabled",
    "protocol",
    "transport",
  ];
  return Object.fromEntries(
    fields
      .filter((field) => terminal[field] !== undefined)
      .map((field) => [field, terminal[field]]),
  );
}

function registerTerminalRoutes({ app, service, getSessionToken }) {
  function authenticate(req, res, next) {
    const supplied = bearerToken(req.headers.authorization);
    const expected = getSessionToken();
    if (!tokensMatch(supplied, expected)) {
      sendError(res, { code: "authentication_required" });
      return;
    }
    next();
  }

  app.get("/terminals", authenticate, (_req, res) => {
    try {
      res.json(service.listTerminals().map(publicTerminal));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/terminals/:id/test", authenticate, async (req, res) => {
    try {
      res.json(await service.testConnection(req.params.id));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/terminal-payments", authenticate, async (req, res) => {
    try {
      const body = req.body || {};
      const forbidden = ["host", "port", "serial", "tcp", "transport", "protocol"];
      if (forbidden.some((field) => Object.hasOwn(body, field))) {
        const error = new Error("Les parametres de transport ne sont pas acceptes");
        error.code = "invalid_payment_request";
        throw error;
      }
      const existed = Boolean(
        body.transactionId && service.getPayment(body.transactionId),
      );
      const transaction = await service.startPayment(body);
      res.status(existed ? 200 : 202).json(transaction);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/terminal-payments/:transactionId", authenticate, (req, res) => {
    try {
      const transaction = service.getPayment(req.params.transactionId);
      if (!transaction) {
        const error = new Error("Transaction inconnue");
        error.code = "transaction_not_found";
        throw error;
      }
      res.json(transaction);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/terminal-payments/:transactionId/cancel", authenticate, async (req, res) => {
    try {
      res.json(await service.cancelPayment(req.params.transactionId));
    } catch (error) {
      sendError(res, error);
    }
  });
}

module.exports = { registerTerminalRoutes };
