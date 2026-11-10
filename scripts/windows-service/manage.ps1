[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory)][ValidateSet('ValidateInstall', 'PrepareInstall', 'PrepareData', 'Install', 'Update', 'Stop', 'Uninstall', 'Status')][string]$Action,
    [string]$ServiceDir = '',
    [string]$AppExe = '',
    [string]$LegacySettingsPath = '',
    [string]$CompanionUserSid = '',
    [string]$InstallRoot = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 binds parameter defaults before PSScriptRoot is populated.
if (-not $ServiceDir) { $ServiceDir = Join-Path $PSScriptRoot '..\service' }
foreach ($nativeModule in @('Microsoft.PowerShell.Security', 'Microsoft.PowerShell.Utility', 'Microsoft.PowerShell.Management', 'CimCmdlets')) {
    Import-Module (Join-Path $PSHOME ('Modules/' + $nativeModule + '/' + $nativeModule + '.psd1')) -Force
}
Import-Module (Join-Path $PSScriptRoot 'ServiceData.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'InstallSecurity.psm1') -Force
$serviceName = 'SmartEatPrinterAgent'
$dataDir = Join-Path $env:ProgramData 'SmartEat\PrinterAgent'
$wrapper = Join-Path ([System.IO.Path]::GetFullPath($ServiceDir)) 'SmartEatPrinterAgent.exe'
$runValue = 'SmartEatPrinterAgentCompanion'

function Write-InstallLog {
    param([string]$Message)
    $logs = Join-Path $dataDir 'logs'
    if ([System.IO.Directory]::Exists($logs)) {
        [System.IO.File]::AppendAllText((Join-Path $logs 'installer.log'), ([DateTime]::UtcNow.ToString('o') + ' ' + $Message + [Environment]::NewLine))
    }
}

function Assert-Administrator {
    $principal = New-Object System.Security.Principal.WindowsPrincipal ([System.Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this operation as an administrator.' }
}

function Invoke-Wrapper {
    param([ValidateSet('install', 'uninstall', 'start', 'stop')][string]$Verb)
    $child = Start-Process -FilePath $wrapper -ArgumentList @($Verb) -PassThru -WindowStyle Hidden
    try {
        if (-not $child.WaitForExit(90000)) { $child.Kill(); throw 'The service wrapper did not finish in time.' }
        if ($child.ExitCode -ne 0) { throw ('The service wrapper failed during ' + $Verb + ' (exit ' + $child.ExitCode + ').') }
    } finally { $child.Dispose() }
}

function Stop-SmartEatService {
    $existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($null -eq $existing) { return }
    try {
        if ($existing.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
            $existing.Stop()
            $existing.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(45))
        }
    } finally { $existing.Dispose() }
}

function Test-ServicePayload {
    $root = [System.IO.Path]::GetFullPath($ServiceDir).TrimEnd('\') + '\'
    $manifest = Get-Content -LiteralPath (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json
    if ($manifest.formatVersion -ne 1 -or $manifest.winsw.version -ne '2.12.0') { throw 'Unsupported service package manifest.' }
    foreach ($property in $manifest.files.PSObject.Properties) {
        if ([System.IO.Path]::IsPathRooted($property.Name)) { throw 'An invalid package path was found.' }
        $file = [System.IO.Path]::GetFullPath((Join-Path $root $property.Name))
        if (-not $file.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'A package path escapes the service directory.' }
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $property.Value) { throw 'A service package checksum does not match.' }
    }
    foreach ($required in @('agent.cjs', 'supervisor.cjs', 'node.exe', 'SmartEatPrinterAgent.exe', 'SmartEatPrinterAgent.xml')) {
        if ($manifest.files.PSObject.Properties.Name -notcontains $required) { throw 'The service package is incomplete.' }
    }
}

function Set-CompanionStartup {
    param([switch]$Remove)
    $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64)
    $run = $baseKey.CreateSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion\Run')
    try {
        if ($Remove) { $run.DeleteValue($runValue, $false) }
        else {
            if (-not [System.IO.File]::Exists($AppExe)) { throw 'The companion executable does not exist.' }
            $command = '"' + [System.IO.Path]::GetFullPath($AppExe) + '" --hidden'
            $run.SetValue($runValue, $command, [Microsoft.Win32.RegistryValueKind]::String)
        }
    } finally { $run.Dispose(); $baseKey.Dispose() }
}

function Remove-AuthorizedLegacyStartup {
    $sid = [System.IO.File]::ReadAllText((Join-Path $dataDir 'authorized-companion.sid')).Trim()
    $allowed = @([System.IO.Path]::GetFullPath($AppExe))
    $legacy = Join-Path $dataDir 'legacy-companion-executable.txt'
    if ([System.IO.File]::Exists($legacy)) { $allowed += [System.IO.File]::ReadAllText($legacy).Trim() }
    $users = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::Users, [Microsoft.Win32.RegistryView]::Registry64)
    $run = $users.OpenSubKey(($sid + '\Software\Microsoft\Windows\CurrentVersion\Run'), $true)
    try {
        if ($null -eq $run) { return }
        $entries = @{}
        foreach ($name in $run.GetValueNames()) { $entries[$name] = $run.GetValue($name) }
        foreach ($name in @(Get-LegacyCompanionRunEntries -Entries $entries -ExecutablePaths $allowed)) { $run.DeleteValue($name, $false) }
    } finally { if ($null -ne $run) { $run.Dispose() }; $users.Dispose() }
}

try {
    if ($Action -eq 'ValidateInstall') {
        Assert-SafeInstallPath -InstallRoot $InstallRoot | Out-Null
        exit 0
    }
    if ($Action -eq 'Status') {
        $existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
        if ($null -eq $existing) { @{name=$serviceName; state='NotInstalled'; dataDir=$dataDir} | ConvertTo-Json -Compress }
        else { try { @{name=$serviceName; state=$existing.Status.ToString(); dataDir=$dataDir} | ConvertTo-Json -Compress } finally { $existing.Dispose() } }
        exit 0
    }
    Assert-Administrator
    if (-not $PSCmdlet.ShouldProcess($serviceName, $Action)) { exit 0 }
    if ($Action -in @('PrepareData', 'Install', 'Update')) {
        Initialize-ServiceData -DataDir $dataDir -CompanionUserSid $CompanionUserSid -LegacySettingsPath $LegacySettingsPath | Out-Null
    }
    switch ($Action) {
        'PrepareInstall' {
            Assert-SafeInstallPath -InstallRoot $InstallRoot | Out-Null
            # This is called by the NSIS section before extraction, including silent updates.
            # SCM uses the constant service name; no old application script is executed here.
            Stop-SmartEatService
            $reader = Resolve-CompanionUserSid -DataDir $dataDir -CompanionUserSid $CompanionUserSid
            Protect-AppInstallRoot -InstallRoot $InstallRoot -ReaderSid $reader
        }
        'PrepareData' { Write-InstallLog 'Machine data prepared; any existing settings were preserved.' }
        { $_ -in @('Install', 'Update') } {
            $servicePath = [System.IO.Path]::GetFullPath($ServiceDir).TrimEnd('\')
            $resourcesPath = [System.IO.Path]::GetDirectoryName($servicePath)
            if ([System.IO.Path]::GetFileName($servicePath) -ne 'service' -or [System.IO.Path]::GetFileName($resourcesPath) -ne 'resources') { throw 'UNSAFE_INSTALL_PATH: service files must be inside the application resources/service directory.' }
            $applicationRoot = [System.IO.Path]::GetDirectoryName($resourcesPath)
            $reader = Resolve-CompanionUserSid -DataDir $dataDir -CompanionUserSid $CompanionUserSid
            Protect-AppInstallRoot -InstallRoot $applicationRoot -ReaderSid $reader
            Test-ServicePayload
            Stop-SmartEatService
            $existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
            if ($null -ne $existing) { $existing.Dispose(); Invoke-Wrapper 'uninstall' }
            Invoke-Wrapper 'install'
            Remove-AuthorizedLegacyStartup
            Set-CompanionStartup
            Invoke-Wrapper 'start'
            Write-InstallLog 'Service installed or updated; companion login entry registered.'
        }
        'Stop' { Stop-SmartEatService; Write-InstallLog 'Service stopped.' }
        'Uninstall' {
            Stop-SmartEatService
            $existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
            if ($null -ne $existing) { $existing.Dispose(); Invoke-Wrapper 'uninstall' }
            Set-CompanionStartup -Remove
            Write-InstallLog 'Service removed. Machine settings, credentials, jobs, and logs preserved.'
        }
    }
} catch {
    Write-InstallLog ('Operation failed: ' + $_.Exception.Message)
    Write-Error 'SmartEat service operation failed. Machine data was preserved; inspect the installer log.'
    exit 1
}
