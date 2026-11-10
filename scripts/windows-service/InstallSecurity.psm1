Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Reuse the data module: reloading it here removes its exports from the caller.
Import-Module (Join-Path $PSScriptRoot 'ServiceData.psm1')

function Test-PrivilegedInstallIdentity {
    param([string]$Sid)
    return $Sid -in @('S-1-5-18', 'S-1-5-32-544', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
}

function Test-InstallAclSafety {
    param([Parameter(Mandatory)][System.Security.AccessControl.FileSystemSecurity]$Acl, [switch]$AllowSiblingCreation)
    if (-not (Test-PrivilegedInstallIdentity $Acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value)) { return $false }
    $rules = @($Acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
    if (-not $rules.Count) { return $false }
    # GenericAll/GenericWrite, delete, change ACL/owner, write data/EA/attributes.
    $mutation = 0x500d0156L
    # Higher ancestors may allow siblings to be created, but not an existing protected child to be replaced.
    # The immediate parent must forbid creation too, including during uninstall/reinstall gaps.
    if ($AllowSiblingCreation) { $mutation = $mutation -band (-bnot 6L) }
    foreach ($rule in $rules) {
        if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { continue }
        if ($rule.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) { continue }
        if (Test-PrivilegedInstallIdentity $rule.IdentityReference.Value) { continue }
        $rights = [int64]$rule.FileSystemRights -band 0xffffffffL
        if ($rights -band $mutation) { return $false }
    }
    return $true
}

function Get-InstallRootPath {
    param([Parameter(Mandatory)][string]$InstallRoot)
    $root = [System.IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
    if ($root -notmatch '^[a-zA-Z]:\\' -or $root -eq [System.IO.Path]::GetPathRoot($root).TrimEnd('\')) { throw 'UNSAFE_INSTALL_PATH: use a dedicated local installation directory.' }
    foreach ($base in @($env:SystemRoot, $env:ProgramData)) {
        if ($base -and ($root -eq $base.TrimEnd('\') -or $root.StartsWith($base.TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase))) { throw 'UNSAFE_INSTALL_PATH: system and data directories cannot contain the application.' }
    }
    foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, ([System.IO.Path]::GetDirectoryName($env:USERPROFILE)))) {
        if ($base -and $root -eq $base.TrimEnd('\')) { throw 'UNSAFE_INSTALL_PATH: select an application subdirectory.' }
    }
    return $root
}

function Assert-InstallPathHasNoReparse {
    param([Parameter(Mandatory)][string]$InstallRoot)
    $current = [System.IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $entry = Get-Item -LiteralPath $current -Force
            if (-not $entry.PSIsContainer -or ($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) { throw 'UNSAFE_INSTALL_REPARSE: redirected installation directories are not supported.' }
        }
        $parent = [System.IO.Path]::GetDirectoryName($current)
        if ($parent -eq $current) { break }
        $current = $parent
    }
}

function Assert-SafeInstallPath {
    param([Parameter(Mandatory)][string]$InstallRoot)
    $root = Get-InstallRootPath -InstallRoot $InstallRoot
    Assert-InstallPathHasNoReparse -InstallRoot $root
    $drive = New-Object System.IO.DriveInfo ([System.IO.Path]::GetPathRoot($root))
    if ($drive.DriveType -ne [System.IO.DriveType]::Fixed -or $drive.DriveFormat -notin @('NTFS', 'ReFS')) { throw 'UNSAFE_INSTALL_PATH: a local ACL-capable fixed disk is required.' }
    $parent = [System.IO.Path]::GetDirectoryName($root)
    if (-not [System.IO.Directory]::Exists($parent)) { throw 'UNSAFE_INSTALL_PATH: create a protected administrator-owned parent directory first.' }
    $immediate = $true
    while ($parent) {
        if (-not (Test-InstallAclSafety -Acl (Get-Acl -LiteralPath $parent) -AllowSiblingCreation:(-not $immediate))) { throw 'UNSAFE_INSTALL_PATH: an installation ancestor is modifiable by a nonprivileged account.' }
        $next = [System.IO.Path]::GetDirectoryName($parent.TrimEnd('\'))
        if ($next -eq $parent) { break }
        $parent = $next; $immediate = $false
    }
    if ([System.IO.Directory]::Exists($root)) {
        foreach ($entry in @((Get-Item -LiteralPath $root -Force)) + @(Get-ChildItem -LiteralPath $root -Force -Recurse)) {
            if ($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'UNSAFE_INSTALL_REPARSE: redirected application files are not supported.' }
            if (-not (Test-InstallAclSafety -Acl (Get-Acl -LiteralPath $entry.FullName))) { throw 'UNSAFE_INSTALL_PATH: existing application files are modifiable by a nonprivileged account.' }
        }
    }
    return $root
}

function New-InstallRootAcl {
    param([Parameter(Mandatory)][string]$ReaderSid, [switch]$Directory)
    return New-ServiceAcl -ReaderSid $ReaderSid -Directory:$Directory -InheritRead:$Directory
}

function Protect-AppInstallRoot {
    param([Parameter(Mandatory)][string]$InstallRoot, [Parameter(Mandatory)][string]$ReaderSid)
    $root = Assert-SafeInstallPath -InstallRoot $InstallRoot
    # No ancestor ACL is modified. A custom parent must already be secure before this operation.
    [System.IO.Directory]::CreateDirectory($root) | Out-Null
    Set-Acl -LiteralPath $root -AclObject (New-InstallRootAcl -ReaderSid $ReaderSid -Directory)
    foreach ($entry in @(Get-ChildItem -LiteralPath $root -Force -Recurse)) {
        if ($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'UNSAFE_INSTALL_REPARSE: redirected application files are not supported.' }
        Set-Acl -LiteralPath $entry.FullName -AclObject (New-InstallRootAcl -ReaderSid $ReaderSid -Directory:$entry.PSIsContainer)
    }
}

Export-ModuleMember -Function Test-InstallAclSafety, New-InstallRootAcl, Assert-InstallPathHasNoReparse, Assert-SafeInstallPath, Protect-AppInstallRoot
