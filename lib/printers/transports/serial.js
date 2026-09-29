const SERIAL_PRINT_SCRIPT = `
$bytes = [Convert]::FromBase64String($env:SMARTEAT_PRINT_BASE64)
$parity = [System.Enum]::Parse([System.IO.Ports.Parity], $env:SMARTEAT_PARITY, $true)
$stopBits = [System.Enum]::Parse([System.IO.Ports.StopBits], $env:SMARTEAT_STOP_BITS, $true)
$port = New-Object System.IO.Ports.SerialPort $env:SMARTEAT_COM_PORT, ([int]$env:SMARTEAT_BAUD_RATE), $parity, ([int]$env:SMARTEAT_DATA_BITS), $stopBits
$port.WriteTimeout = 5000
$port.Open()
try {
  $port.Write($bytes, 0, $bytes.Length)
} finally {
  if ($port.IsOpen) { $port.Close() }
  $port.Dispose()
}
`;

function normalizePortName(value) {
  return String(value || "").replace(/:$/, "").toUpperCase();
}

function createSerialSender({ runPowerShell }) {
  return {
    async send({ transport, base64Data }) {
      const config = transport?.config || {};
      const portName = normalizePortName(config.portName);
      if (!portName) throw new Error("Port COM manquant");
      await runPowerShell(SERIAL_PRINT_SCRIPT, {
        SMARTEAT_COM_PORT: portName,
        SMARTEAT_PRINT_BASE64: base64Data,
        SMARTEAT_BAUD_RATE: String(Number(config.baudRate) || 9600),
        SMARTEAT_DATA_BITS: String(Number(config.dataBits) || 8),
        SMARTEAT_PARITY: config.parity || "None",
        SMARTEAT_STOP_BITS: String(Number(config.stopBits) || 1),
      });
    },
  };
}

module.exports = { createSerialSender };
