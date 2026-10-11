# Fetches the official KataGo Windows builds bundled with the app (OpenCL for GPUs, Eigen AVX2 for CPUs), checks
# their pinned size and sha256, and extracts each into src-tauri/resources/katago-win/<variant>/ (katago.exe next to
# the VC++ runtime, OpenSSL, zlib, bz2 and libzip DLLs it ships with). tauri.windows.conf.json bundles that folder.
# Usage (Windows, PowerShell 5.1 or 7): pwsh -File scripts/fetch-windows-engine.ps1
#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is very slow with its progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 # PowerShell 5.1 default is older
Add-Type -AssemblyName System.IO.Compression.FileSystem

$Tag = 'v1.18.1'
# Pinned 2026-10-11 from the GitHub release assets (sha256 = the release's digest field).
$Pins = [ordered]@{
  opencl    = @{ File = 'katago-v1.18.1-opencl-windows-x64.zip';    Size = 6004137; Sha256 = '1710db1903ab921aa6837a9599c8474f8a59f057650217c5d9bc125ee393a9ff' }
  eigenavx2 = @{ File = 'katago-v1.18.1-eigenavx2-windows-x64.zip'; Size = 5899607; Sha256 = '0d62ffa41ee04dd89dd1b80fe45e306c837231cb1e2dccb4f5780d0ca7c313db' }
}

$Root = Split-Path -Parent $PSScriptRoot
$Out = Join-Path $Root 'src-tauri\resources\katago-win'
$Dl = Join-Path ([IO.Path]::GetTempPath()) "baduk-katago-$Tag" # download cache, re-verified on every run
New-Item -ItemType Directory -Force -Path $Dl | Out-Null

function Test-Pin([string]$Path, $Pin) {
  (Test-Path -LiteralPath $Path) -and ((Get-Item -LiteralPath $Path).Length -eq $Pin.Size) -and
    ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -eq $Pin.Sha256)
}

# Extracts files only, refusing any entry that would land outside $Dest (zip slip: "..\", absolute paths).
function Expand-Safely([string]$Zip, [string]$Dest) {
  $destFull = [IO.Path]::GetFullPath($Dest).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
  $archive = [IO.Compression.ZipFile]::OpenRead($Zip)
  try {
    foreach ($entry in $archive.Entries) {
      if ($entry.FullName.EndsWith('/') -or $entry.FullName.EndsWith('\')) { continue } # directory entry
      $target = [IO.Path]::GetFullPath([IO.Path]::Combine($destFull, $entry.FullName))
      if (-not $target.StartsWith($destFull, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing zip entry outside the destination: $($entry.FullName)"
      }
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
    }
  } finally { $archive.Dispose() }
}

foreach ($variant in $Pins.Keys) {
  $pin = $Pins[$variant]
  $zip = Join-Path $Dl $pin.File
  if (-not (Test-Pin $zip $pin)) {
    $url = "https://github.com/lightvector/KataGo/releases/download/$Tag/$($pin.File)"
    Write-Host "Downloading $url"
    Invoke-WebRequest -Uri $url -OutFile "$zip.part" -UseBasicParsing
    Move-Item -Force -LiteralPath "$zip.part" -Destination $zip
    if (-not (Test-Pin $zip $pin)) {
      Remove-Item -Force -LiteralPath $zip
      throw "$($pin.File): size or sha256 mismatch (file deleted, rerun)"
    }
  }
  $dest = Join-Path $Out $variant
  if (Test-Path -LiteralPath $dest) { Remove-Item -Recurse -Force -LiteralPath $dest }
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  Expand-Safely $zip $dest
  if (-not (Test-Path -LiteralPath (Join-Path $dest 'katago.exe'))) { throw "$($pin.File): no katago.exe at the archive root" }
  Write-Host "$variant -> $dest"
}
