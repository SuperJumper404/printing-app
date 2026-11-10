const { createPrintError, wrapTransportError } = require("../errors");

const SERIAL_PRINT_SCRIPT = `
$ErrorActionPreference = 'Stop'
$port = $null
$writing = $false
try {
  $bytes = [Convert]::FromBase64String($env:SMARTEAT_PRINT_BASE64)
  $parity = [System.Enum]::Parse([System.IO.Ports.Parity], $env:SMARTEAT_PARITY, $true)
  $stopBits = [System.Enum]::Parse([System.IO.Ports.StopBits], $env:SMARTEAT_STOP_BITS, $true)
  $port = New-Object System.IO.Ports.SerialPort $env:SMARTEAT_COM_PORT, ([int]$env:SMARTEAT_BAUD_RATE), $parity, ([int]$env:SMARTEAT_DATA_BITS), $stopBits
  $port.WriteTimeout = 5000
  $port.Open()
  $writing = $true
  $port.Write($bytes, 0, $bytes.Length)
  $drainDeadline = [DateTime]::UtcNow.AddMilliseconds(5000)
  while ($port.BytesToWrite -gt 0) {
    if ([DateTime]::UtcNow -ge $drainDeadline) { throw [System.TimeoutException]::new('Serial drain timeout') }
    Start-Sleep -Milliseconds 10
  }
} catch {
  $failure = $_.Exception.GetBaseException()
  $state = if ($writing) { 'UNKNOWN' } else { 'NOT_SENT' }
  $code = if ($failure -is [System.TimeoutException]) { 'TIMEOUT' } elseif ($writing) { 'WRITE_FAILED' } elseif ($failure -is [System.UnauthorizedAccessException] -or $failure -is [System.ArgumentException]) { 'CONFIGURATION' } else { 'CONNECTION_FAILED' }
  throw ('SMARTEAT_' + $state + ':' + $code + ' ' + $failure.Message)
} finally {
  if ($null -ne $port) {
    try { if ($port.IsOpen) { $port.Close() } } finally { $port.Dispose() }
  }
}
`;

function createSerialSender({ runPowerShell }) {
  return {
    async send({ transport, base64Data, signal }) {
      if (signal?.aborted) throw createPrintError("ABORTED");
      const config = transport?.config || {};
      const portName = String(config.portName || "").trim().replace(/:$/, "").toUpperCase();
      const baudRate = Number(config.baudRate ?? 9600);
      const dataBits = Number(config.dataBits ?? 8);
      const parity = String(config.parity || "None");
      const stopBits = String(config.stopBits ?? 1);
      if (!/^COM\d+$/.test(portName) || !Number.isInteger(baudRate) || baudRate <= 0 || ![5, 6, 7, 8].includes(dataBits) || !/^(none|odd|even|mark|space)$/i.test(parity) || !/^(1|1\.5|2|One|OnePointFive|Two)$/i.test(stopBits)) {
        throw createPrintError("CONFIGURATION");
      }
      const configuredTimeout = Number(config.timeoutMs);
      const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 15000;
      try {
        await runPowerShell(SERIAL_PRINT_SCRIPT, {
          SMARTEAT_COM_PORT: portName,
          SMARTEAT_PRINT_BASE64: base64Data,
          SMARTEAT_BAUD_RATE: String(baudRate),
          SMARTEAT_DATA_BITS: String(dataBits),
          SMARTEAT_PARITY: parity,
          SMARTEAT_STOP_BITS: stopBits === "1.5" ? "OnePointFive" : stopBits,
        }, { timeoutMs, signal });
      } catch (error) { throw wrapTransportError(error); }
    },
  };
}

module.exports = { createSerialSender };
