# Runs only on a disposable GitHub-hosted Windows runner. Does not touch an existing user's installation.
# Python uses the WebDriver wire protocol directly, so no Selenium/npm test dependency is needed.
[CmdletBinding()]
param([string]$Evidence = 'windows-evidence')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'This test requires Windows.' }
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    python scripts/windows/reliability.py --evidence $Evidence
    if ($LASTEXITCODE -ne 0) { throw "Windows reliability tests failed ($LASTEXITCODE). See $Evidence." }
} finally { Pop-Location }
