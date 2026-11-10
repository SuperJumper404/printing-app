function createPowerShellRunner({ execFile }) {
  return function runPowerShell(script, env = {}, { timeoutMs = 30000, signal } = {}) {
    const prelude = "$ErrorActionPreference = 'Stop'\n[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)\n$OutputEncoding = [Console]::OutputEncoding\n";
    const encoded = Buffer.from(prelude + script, "utf16le").toString("base64");
    return new Promise((resolve, reject) => {
      let closed = false;
      let result;
      const finish = () => {
        if (!closed || !result) return;
        const { error, stdout, stderr } = result;
        if (error) {
          const failure = new Error(error.code === "ABORT_ERR" ? "Opération annulée" : error.killed ? "Délai Windows dépassé" : "Échec de l’envoi Windows");
          failure.code = error.code;
          failure.killed = Boolean(error.killed);
          // Transport adapters extract fixed diagnostic markers, never return the script.
          failure.stderr = String(stderr || "");
          reject(failure);
        } else resolve(String(stdout || "").trim());
      };
      let child;
      try {
        child = execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
          env: { ...process.env, ...env }, windowsHide: true, encoding: "utf8",
          timeout: Math.max(1000, Number(timeoutMs) || 30000), signal, maxBuffer: 1024 * 1024 * 5,
        }, (error, stdout, stderr) => { result = { error, stdout, stderr }; finish(); });
        child.once("close", () => { closed = true; finish(); });
      } catch (error) {
        result = { error, stderr: "" }; closed = true; finish();
      }
    });
  };
}

module.exports = { createPowerShellRunner };
