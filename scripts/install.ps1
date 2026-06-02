# Chess Lens Installer (Windows)
# Usage: irm https://raw.githubusercontent.com/video-db/chess-lens/main/scripts/install.ps1 | iex

#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

$AppName  = "Chess Lens"
$Repo     = "https://github.com/video-db/chess-lens"
$Version  = "1.0.2"
$BaseUrl  = "$Repo/releases/download/v$Version"

# Colors via Write-Host
function Info    { Write-Host "==> " -ForegroundColor Blue -NoNewline; Write-Host "$args" -ForegroundColor White }
function Success { Write-Host "==> " -ForegroundColor Green -NoNewline; Write-Host "$args" -ForegroundColor White }
function Warn    { Write-Host "warning: $args" -ForegroundColor Yellow }
function Error   { Write-Host "error: $args" -ForegroundColor Red; exit 1 }

# --- Pre-flight checks ---

if ($env:OS -ne 'Windows_NT') {
    Error "This installer only supports Windows."
}

if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) {
    Error "curl.exe is required but not found. Install via https://curl.se/windows/ or use Windows 10 1803+."
}

# --- Detect architecture ---

$arch = (Get-CimInstance Win32_Processor | Select-Object -First 1).AddressWidth
if ($arch -eq 64) {
    $exeName = "$AppName Setup $Version-x64.exe"
} else {
    Error "Unsupported architecture: $arch-bit. Only x64 is supported."
}

$exeUrl = "$BaseUrl/$([System.Uri]::EscapeDataString($exeName))"
$tmpDir = Join-Path $env:TEMP "chess-lens-installer"
$tmpExe = Join-Path $tmpDir $exeName

Write-Host ""
Write-Host "  Chess Lens Installer" -ForegroundColor White
Write-Host "  ─────────────────────" -ForegroundColor White
Write-Host ""
Info "Detected architecture: x64"
Info "Downloading $exeName..."

# --- Download ---

if (Test-Path $tmpDir) { Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

try {
    curl.exe -fSL --progress-bar "$exeUrl" -o "$tmpExe"
} catch {
    Error "Failed to download $exeName from $exeUrl"
}

Success "Download complete."

# --- Run installer ---

Write-Host ""
Info "Launching installer..."
Start-Process -Wait -FilePath $tmpExe -ArgumentList "/S"

# --- Cleanup ---

Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue

# --- Done ---

Write-Host ""
Success "Chess Lens has been installed!"
Write-Host ""
Write-Host "  Next steps:"
Write-Host "    1. Launch Chess Lens from the Start Menu"
Write-Host "    2. Enter your VideoDB API key (get one at https://console.videodb.io)"
Write-Host ""
