Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-CompanionUserSid {
    param([string]$Sid)
    return $Sid -match '^S-1-5-21-(\d+-){3}\d+$|^S-1-12-1-(\d+-){3}\d+$'
}

function Assert-ServiceDataPath {
    param([Parameter(Mandatory)][string]$DataDir)
    $root = [System.IO.Path]::GetFullPath($DataDir).TrimEnd('\')
    foreach ($candidate in @([System.IO.Path]::GetDirectoryName($root), $root)) {
        if ([System.IO.Directory]::Exists($candidate) -and ([System.IO.File]::GetAttributes($candidate) -band [System.IO.FileAttributes]::ReparsePoint)) { throw 'A service data path is a reparse point.' }
    }
}

function New-ServiceAcl {
    param([string]$ReaderSid = '', [switch]$Directory, [switch]$InheritRead)
    if ($ReaderSid -and -not (Test-CompanionUserSid $ReaderSid)) { throw 'A specific Windows user SID is required.' }
    $acl = if ($Directory) { New-Object System.Security.AccessControl.DirectorySecurity } else { New-Object System.Security.AccessControl.FileSecurity }
    $acl.SetAccessRuleProtection($true, $false)
    $administrators = New-Object System.Security.Principal.SecurityIdentifier 'S-1-5-32-544'
    $acl.SetOwner($administrators)
    $inheritance = if ($Directory) { [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [System.Security.AccessControl.InheritanceFlags]::None }
    foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
        $identity = New-Object System.Security.Principal.SecurityIdentifier $sid
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule $identity, 'FullControl', $inheritance, 'None', 'Allow'
        $acl.AddAccessRule($rule)
    }
    if ($ReaderSid) {
        $identity = New-Object System.Security.Principal.SecurityIdentifier $ReaderSid
        $readInheritance = if ($Directory -and $InheritRead) { $inheritance } else { [System.Security.AccessControl.InheritanceFlags]::None }
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule $identity, 'ReadAndExecute', $readInheritance, 'None', 'Allow'
        $acl.AddAccessRule($rule)
    }
    return $acl
}

function Import-LegacySettings {
    param([string]$SourcePath, [Parameter(Mandatory)][string]$DestinationPath)
    if (-not $SourcePath -or -not [System.IO.File]::Exists($SourcePath) -or [System.IO.File]::Exists($DestinationPath)) { return $false }
    try { [System.IO.File]::Copy($SourcePath, $DestinationPath, $false); return $true }
    catch [System.IO.IOException] { if ([System.IO.File]::Exists($DestinationPath)) { return $false }; throw }
}

function Get-LegacyCompanionRunEntries {
    param([hashtable]$Entries, [string[]]$ExecutablePaths)
    $allowed = @($ExecutablePaths | Where-Object { $_ } | ForEach-Object { [System.IO.Path]::GetFullPath($_) })
    foreach ($name in $Entries.Keys) {
        if ($name -notin @('SmartEat Printer Agent', 'printing-app', 'SmartEatPrinterAgentCompanion')) { continue }
        $command = [string]$Entries[$name]
        if ($command -notmatch '^(?:"(?<exe>[^"]+\.exe)"|(?<exe>.+?\.exe))(?:\s+--hidden)?\s*$') { continue }
        try { $executable = [System.IO.Path]::GetFullPath($Matches.exe) } catch { continue }
        if ($allowed -contains $executable) { $name }
    }
}

function Resolve-CompanionUserSid {
    param([string]$DataDir, [string]$CompanionUserSid = '')
    $persisted = Join-Path $DataDir 'authorized-companion.sid'
    if ($CompanionUserSid) { $sid = $CompanionUserSid }
    elseif (Test-Path -LiteralPath $persisted -PathType Leaf) { $sid = [System.IO.File]::ReadAllText($persisted).Trim() }
    else {
        $sessionId = (Get-Process -Id $PID).SessionId
        $candidates = @(Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" | Where-Object { $_.SessionId -eq $sessionId } | ForEach-Object {
            $owner = Invoke-CimMethod -InputObject $_ -MethodName GetOwnerSid
            if ($owner.ReturnValue -eq 0) { $owner.Sid }
        } | Sort-Object -Unique)
        if ($candidates.Count -eq 1) { $sid = $candidates[0] }
        else { $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value }
    }
    if (-not (Test-CompanionUserSid $sid)) { throw 'Unable to identify the companion user. Supply -CompanionUserSid explicitly.' }
    return $sid
}

function Set-ServiceDataPermissions {
    param([Parameter(Mandatory)][string]$DataDir, [Parameter(Mandatory)][string]$ReaderSid)
    $root = [System.IO.Path]::GetFullPath($DataDir).TrimEnd('\')
    Assert-ServiceDataPath -DataDir $root
    $logs = Join-Path $root 'logs'
    Set-Acl -LiteralPath $root -AclObject (New-ServiceAcl -Directory -ReaderSid $ReaderSid)
    foreach ($entry in @(Get-ChildItem -LiteralPath $root -Force -Recurse)) {
        if ($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'A service data path is a reparse point.' }
        $isLog = $entry.FullName -eq $logs -or $entry.FullName.StartsWith($logs + '\', [System.StringComparison]::OrdinalIgnoreCase)
        $isCredential = -not $entry.PSIsContainer -and $entry.DirectoryName -eq $root -and $entry.Name -in @('connection.json', 'control-token')
        $reader = if ($isLog -or $isCredential) { $ReaderSid } else { '' }
        Set-Acl -LiteralPath $entry.FullName -AclObject (New-ServiceAcl -Directory:$entry.PSIsContainer -ReaderSid $reader -InheritRead:$isLog)
    }
}

function Initialize-ServiceData {
    param([Parameter(Mandatory)][string]$DataDir, [string]$CompanionUserSid = '', [string]$LegacySettingsPath = '')
    Assert-ServiceDataPath -DataDir $DataDir
    [System.IO.Directory]::CreateDirectory($DataDir) | Out-Null
    $reader = Resolve-CompanionUserSid -DataDir $DataDir -CompanionUserSid $CompanionUserSid
    # Protect the parent too: a writable parent could otherwise rename the protected data folder.
    Set-Acl -LiteralPath ([System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($DataDir).TrimEnd('\'))) -AclObject (New-ServiceAcl -Directory -ReaderSid $reader)
    Set-ServiceDataPermissions -DataDir $DataDir -ReaderSid $reader
    [System.IO.Directory]::CreateDirectory((Join-Path $DataDir 'logs')) | Out-Null
    $encoding = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText((Join-Path $DataDir 'authorized-companion.sid'), $reader, $encoding)
    Import-LegacySettings -SourcePath $LegacySettingsPath -DestinationPath (Join-Path $DataDir 'settings.json') | Out-Null
    $legacyExeFile = Join-Path $DataDir 'legacy-companion-executable.txt'
    if ($LegacySettingsPath -and -not [System.IO.File]::Exists($legacyExeFile)) {
        foreach ($name in @('SmartEat Printer Agent.exe', 'printing-app.exe')) {
            $candidate = Join-Path ([System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($LegacySettingsPath))) $name
            if ([System.IO.File]::Exists($candidate)) { [System.IO.File]::WriteAllText($legacyExeFile, $candidate, $encoding); break }
        }
    }
    $tokenPath = Join-Path $DataDir 'control-token'
    if (-not [System.IO.File]::Exists($tokenPath)) {
        $bytes = New-Object byte[] 32
        $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        try { $random.GetBytes($bytes) } finally { $random.Dispose() }
        $token = [System.BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
        $stream = [System.IO.File]::Open($tokenPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        try { $encoded = $encoding.GetBytes($token); $stream.Write($encoded, 0, $encoded.Length) } finally { $stream.Dispose() }
    }
    $token = [System.IO.File]::ReadAllText($tokenPath).Trim()
    if ($token -notmatch '^[a-fA-F0-9]{64}$') { throw 'Existing service credential is invalid; it was preserved.' }
    $connectionPath = Join-Path $DataDir 'connection.json'
    if (-not [System.IO.File]::Exists($connectionPath)) {
        $connection = @{ controlPort = 8990; token = $token } | ConvertTo-Json -Compress
        [System.IO.File]::WriteAllText($connectionPath, $connection, $encoding)
    }
    Set-ServiceDataPermissions -DataDir $DataDir -ReaderSid $reader
    return $reader
}

Export-ModuleMember -Function Assert-ServiceDataPath, New-ServiceAcl, Import-LegacySettings, Get-LegacyCompanionRunEntries, Resolve-CompanionUserSid, Set-ServiceDataPermissions, Initialize-ServiceData
