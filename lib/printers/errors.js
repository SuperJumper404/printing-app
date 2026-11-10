const MESSAGES = {
  CONFIGURATION: "Configuration de l’imprimante à vérifier.",
  TIMEOUT: "Délai d’impression dépassé.",
  ABORTED: "Impression annulée.",
  CONNECTION_FAILED: "Connexion à l’imprimante impossible.",
  CONNECTION_CLOSED: "Connexion à l’imprimante interrompue.",
  WRITE_FAILED: "Envoi du ticket interrompu.",
  INVALID_RESPONSE: "Réponse de l’imprimante invalide.",
  PRINTER_REJECTED: "L’imprimante a refusé le ticket.",
  PRINT_FAILED: "Impossible d’envoyer le ticket.",
  AMBIGUOUS_DEVICE: "Plusieurs appareils correspondent à cette imprimante.",
  PERMISSION_DENIED: "L’autorisation d’accéder à l’imprimante est requise.",
  PARTIAL_WRITE: "Envoi partiel du ticket.",
  DEVICE_BUSY: "L’imprimante est occupée.",
  CLEANUP_FAILED: "La connexion à l’imprimante n’a pas pu être libérée.",
  UNSUPPORTED: "Cet appareil n’est pas compatible avec ce protocole.",
  COMPANION_OFFLINE: "Le compagnon matériel est indisponible. Ouvrez une session Windows et laissez SmartEat fonctionner en arrière-plan.",
  COMPANION_UNAVAILABLE: "Le compagnon matériel est indisponible. Ouvrez une session Windows et laissez SmartEat fonctionner en arrière-plan.",
  COMPANION_BUSY: "Un autre compagnon contrôle les périphériques de cette machine.",
  COMPANION_OWNER_MISMATCH: "La connexion au compagnon matériel doit être rétablie.",
};
const TRANSIENT_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "EAI_AGAIN", "ETIMEDOUT", "ECONNABORTED"]);

function createPrintError(code, { cause, retryable = false, deliveryState = "not-sent", action } = {}) {
  const error = new Error(MESSAGES[code] || MESSAGES.PRINT_FAILED, cause ? { cause } : undefined);
  error.code = code;
  error.deliveryState = deliveryState === "not-sent" ? "not-sent" : "unknown";
  error.retryable = Boolean(retryable) && error.deliveryState === "not-sent" && code !== "ABORTED";
  error.action = action || (error.deliveryState === "unknown"
    ? "Vérifiez le ticket sur l’imprimante avant de réessayer."
    : code === "AMBIGUOUS_DEVICE" ? "Sélectionnez à nouveau l’imprimante souhaitée."
      : code === "PERMISSION_DENIED" ? "Autorisez l’accès à l’imprimante."
        : code === "UNSUPPORTED" ? "Choisissez un protocole compatible."
          : code === "DEVICE_BUSY" || code === "CLEANUP_FAILED" ? "Reconnectez l’imprimante avant de réessayer."
    : code === "CONFIGURATION" ? "Vérifiez les paramètres de connexion."
      : "Vérifiez la connexion et l’état de l’imprimante.");
  return error;
}

function wrapTransportError(error, { deliveryState = "unknown", fallbackCode = "PRINT_FAILED" } = {}) {
  if (error?.deliveryState && typeof error.retryable === "boolean") return error;
  // Only stderr may carry the marker: execFile's message also contains the whole script.
  const marker = /SMARTEAT_(NOT_SENT|UNKNOWN):([A-Z_]+)/.exec(String(error?.stderr || ""));
  let code = fallbackCode;
  if (marker) {
    deliveryState = marker[1] === "NOT_SENT" ? "not-sent" : "unknown";
    code = Object.hasOwn(MESSAGES, marker[2]) ? marker[2] : fallbackCode;
  } else if (error?.name === "AbortError" || error?.code === "ABORT_ERR" || error?.code === "ABORTED") code = "ABORTED";
  else if (error?.code === "ETIMEDOUT" || error?.code === "TIMEOUT" || error?.killed) code = "TIMEOUT";
  else if (TRANSIENT_CODES.has(error?.code)) code = "CONNECTION_FAILED";
  return createPrintError(code, {
    cause: error,
    deliveryState,
    retryable: deliveryState === "not-sent" && (code === "TIMEOUT" || code === "CONNECTION_FAILED" || code === "CONNECTION_CLOSED"),
  });
}

function formatPrintError(error) {
  const message = MESSAGES[error?.code] || MESSAGES.PRINT_FAILED;
  return error?.deliveryState === "unknown"
    ? `${message} Vérifiez le ticket avant de réessayer.`
    : message;
}

module.exports = { createPrintError, wrapTransportError, formatPrintError };
