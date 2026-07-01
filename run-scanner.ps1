$scannerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logFile = Join-Path $scannerDir "scanner.log"

while ($true) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    try {
        $env:GH_TOKEN = $env:GHTOKEN
        $output = & "node" (Join-Path $scannerDir "scanner.js") 2>&1
        $output | Out-File -FilePath $logFile -Append
        Add-Content -Path $logFile -Value "[$timestamp] Scan complete"
    }
    catch {
        Add-Content -Path $logFile -Value "[$timestamp] Error: $_"
    }
    Start-Sleep -Seconds 300
}
