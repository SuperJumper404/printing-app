const STATUS = Object.freeze({
  queued: { label: "En attente", tone: "neutral", terminal: false },
  connecting: { label: "Connexion au TPE", tone: "progress", terminal: false },
  waiting_for_terminal: { label: "Demarrage sur le TPE", tone: "progress", terminal: false },
  waiting_for_card: { label: "Carte attendue", tone: "progress", terminal: false },
  authorizing: { label: "Autorisation en cours", tone: "progress", terminal: false },
  cancellation_requested: { label: "Annulation demandee", tone: "progress", terminal: false },
  approved: { label: "Paiement accepte", tone: "success", terminal: true },
  declined: { label: "Paiement refuse", tone: "danger", terminal: true },
  cancelled: { label: "Paiement annule", tone: "neutral", terminal: true },
  failed: { label: "Paiement non effectue", tone: "danger", terminal: true },
  unknown: { label: "Resultat a verifier", tone: "warning", terminal: true },
});

export function newTerminalDraft() {
  return {
    id: "",
    name: "PAX Q25",
    manufacturer: "PAX",
    model: "Q25",
    enabled: true,
    protocol: "nepting",
    protocolVersion: "0320",
    transport: "tcp",
    cashRegisterId: "000000000001",
    cashRegisterNumber: "01",
    tcp: { host: "", port: 8888 },
    serial: {
      path: "",
      baudRate: 115200,
      dataBits: 8,
      parity: "none",
      stopBits: 1,
      flowControl: "none",
    },
    nepting: { merchantId: "" },
  };
}

export function visibleTerminalFields(config = {}) {
  const transport = config.transport === "serial" ? "serial" : "tcp";
  return {
    transport,
    showTcp: transport === "tcp",
    showSerial: transport === "serial",
    showNepting: config.protocol === "nepting",
  };
}

export function terminalStatusPresentation(state) {
  return STATUS[state] || {
    label: "Connexion non verifiee",
    tone: "neutral",
    terminal: false,
  };
}
