param(
    [string]$JavaExecutable = 'C:\Program Files\Java\jdk-22\bin\java.exe',
    [string]$BaseUrl = 'http://localhost:8080/v2'
)

$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot 'java'
$jar = Join-Path $project 'target\hospital-patient-enquiries-worker-0.0.1-SNAPSHOT.jar'
if (-not (Test-Path -LiteralPath $jar -PathType Leaf)) { throw "Build the Java project first: $jar" }
if (-not (Test-Path -LiteralPath $JavaExecutable -PathType Leaf)) { throw "Java executable not found: $JavaExecutable" }
$pidFile = Join-Path $PSScriptRoot 'worker.pid'
if (Test-Path -LiteralPath $pidFile) {
    $existingPid = [int](Get-Content -LiteralPath $pidFile -Raw).Trim()
    if (Get-Process -Id $existingPid -ErrorAction SilentlyContinue) {
        Write-Host "Standalone enquiry worker is already running (PID $existingPid)."
        return
    }
}
$null = Invoke-RestMethod -Uri ($BaseUrl.TrimEnd('/') + '/topology') -TimeoutSec 10
$logs = Join-Path $PSScriptRoot 'logs'
$null = New-Item -ItemType Directory -Path $logs -Force
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $logs "worker-$stamp.out.log"
$err = Join-Path $logs "worker-$stamp.err.log"
$process = Start-Process -FilePath $JavaExecutable -ArgumentList '-jar', ('"' + $jar + '"') `
    -WorkingDirectory $project -WindowStyle Hidden `
    -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
$process.Id | Set-Content -LiteralPath $pidFile
[pscustomobject]@{ ProcessId=$process.Id; Jar=$jar; Stdout=$out; Stderr=$err }
