const fs = require("node:fs");
const path = require("node:path");
const tls = require("node:tls");
const { X509Certificate } = require("node:crypto");
const { createPowerShellRunner } = require("../printers/powershell");
const { execFile } = require("node:child_process");

const CERTIFICATE_SCRIPT = `
$filename = $env:SMARTEAT_CONTROL_PFX
$certificate = $null
$rsa = $null
$pending = $null
$backup = $null
try {
  if ([System.IO.File]::Exists($filename)) {
    try { $certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($filename, '', [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet) } catch { $certificate = $null }
  }
  if ($null -ne $certificate) {
    $constraints = $certificate.Extensions['2.5.29.19']
    if ($certificate.NotAfter.ToUniversalTime() -le [DateTime]::UtcNow.AddDays(30) -or $null -eq $constraints -or -not $constraints.CertificateAuthority) { $certificate.Dispose(); $certificate = $null }
  }
  if ($null -eq $certificate) {
    $rsa = [System.Security.Cryptography.RSA]::Create(2048)
    $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=localhost', $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $san = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $san.AddDnsName('localhost')
    $san.AddIpAddress([System.Net.IPAddress]::Parse('127.0.0.1'))
    $request.CertificateExtensions.Add($san.Build())
    $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true, $false, 0, $true))
    $usage = [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment -bor [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign
    $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new($usage, $true))
    $oids = [System.Security.Cryptography.OidCollection]::new()
    [void]$oids.Add([System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1'))
    $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($oids, $false))
    $certificate = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddDays(-1), [DateTimeOffset]::UtcNow.AddYears(10))
    $bytes = $certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, '')
    $pending = $filename + '.' + [Guid]::NewGuid().ToString('N') + '.pending'
    $stream = [System.IO.File]::Open($pending, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    if ([System.IO.File]::Exists($filename)) {
      $backup = $filename + '.' + [Guid]::NewGuid().ToString('N') + '.backup'
      [System.IO.File]::Replace($pending, $filename, $backup)
    } else { [System.IO.File]::Move($pending, $filename) }
    $pending = $null
  }
  $public = [Convert]::ToBase64String($certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))
  [Console]::WriteLine($public)
} finally {
  if ($null -ne $pending -and [System.IO.File]::Exists($pending)) { [System.IO.File]::Delete($pending) }
  if ($null -ne $backup -and [System.IO.File]::Exists($backup)) { [System.IO.File]::Delete($backup) }
  if ($null -ne $certificate) { $certificate.Dispose() }
  if ($null -ne $rsa) { $rsa.Dispose() }
}
`;

async function ensureControlTls(dataDir, { runPowerShell = createPowerShellRunner({ execFile }) } = {}) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const filename = path.join(dataDir, "control-tls.pfx");
  let publicDer;
  try { publicDer = await runPowerShell(CERTIFICATE_SCRIPT, { SMARTEAT_CONTROL_PFX: filename }, { timeoutMs: 15000 }); }
  catch { throw new Error("Impossible de préparer le certificat privé du service Windows."); }
  const certificate = `-----BEGIN CERTIFICATE-----\n${publicDer.match(/.{1,64}/g)?.join("\n")}\n-----END CERTIFICATE-----\n`;
  try {
    const parsed = new X509Certificate(certificate);
    if (!parsed.checkIP("127.0.0.1")) throw new Error("Invalid control certificate");
    const serverOptions = { pfx: fs.readFileSync(filename), passphrase: "", minVersion: "TLSv1.2" };
    tls.createSecureContext(serverOptions);
    return { serverOptions, certificate };
  } catch { throw new Error("Le certificat de contrôle du service est invalide."); }
}

module.exports = { ensureControlTls };
