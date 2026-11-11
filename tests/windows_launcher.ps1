# Exercise the actual .cmd fallback without starting a server or altering installed tools.
$ErrorActionPreference = "Stop"
$python = (Get-Command python.exe).Source
$root = Split-Path $PSScriptRoot -Parent
$temp = Join-Path ([System.IO.Path]::GetTempPath()) ("sharepass-launcher-" + [guid]::NewGuid())
$oldPath = $env:PATH
try {
    New-Item -ItemType Directory $temp | Out-Null
    Copy-Item (Join-Path $root "Start-SharePass.cmd") $temp
    Set-Content (Join-Path $temp "app.py") 'import sys; print("SHAREPASS_FALLBACK_OK", *sys.argv[1:])'
    # Copy only the trusted Windows locator; exclude any py launcher on runner PATH.
    Copy-Item "$env:SystemRoot\System32\where.exe" $temp
    $env:PATH = "$temp;$(Split-Path $python -Parent)"
    & "$env:SystemRoot\System32\where.exe" py 2>$null
    if ($LASTEXITCODE -eq 0) { throw "Test isolation failed: py is still visible" }
    $output = & "$env:SystemRoot\System32\cmd.exe" /d /c (Join-Path $temp "Start-SharePass.cmd") 2>&1
    if (($output -join "\n") -notmatch "SHAREPASS_FALLBACK_OK --android-emulator") {
        throw "Python-only fallback failed: $output"
    }
    Write-Output "PASS: Python-only PATH executes the fallback with emulator flag"
} finally {
    $env:PATH = $oldPath
    Remove-Item -Recurse -Force $temp
}
