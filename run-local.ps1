$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

Write-Host '🚀 Starting AI Prompt Optimizer locally...' -ForegroundColor Cyan

$venvPython = Join-Path $projectRoot '.venv/Scripts/python.exe'
$venv2Python = Join-Path $projectRoot 'venv/Scripts/python.exe'

if (Test-Path $venvPython) {
  $pythonExe = $venvPython
  $pythonArgs = @()
} elseif (Test-Path $venv2Python) {
  $pythonExe = $venv2Python
  $pythonArgs = @()
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
  $pythonExe = 'py'
  $pythonArgs = @('-3')
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  $pythonExe = 'python'
  $pythonArgs = @()
} else {
  throw 'Python executable not found. Install Python or create a virtual environment first.'
}

# Check if required backend packages are installed
$checkScript = "import fastapi, uvicorn"
$process = Start-Process -FilePath $pythonExe -ArgumentList ($pythonArgs + @('-c', $checkScript)) -NoNewWindow -PassThru -Wait
if ($process.ExitCode -ne 0) {
  Write-Host '📦 Installing backend dependencies...' -ForegroundColor Yellow
  Start-Process -FilePath $pythonExe -ArgumentList ($pythonArgs + @('-m', 'pip', 'install', '-r', 'requirements.txt')) -NoNewWindow -Wait
}

Write-Host '🚀 Starting dev services...' -ForegroundColor Cyan
node start-dev.js
