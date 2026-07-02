# Reports which required .env.local variables are still placeholders.
# Run from repo root: powershell -File scripts/check-env.ps1

$envFile = Join-Path $PSScriptRoot "..\.env.local"
$fallbackEnvFile = Join-Path $PSScriptRoot "..\.env"
if (-not (Test-Path $envFile)) {
    if (Test-Path $fallbackEnvFile) {
        Write-Host "No .env.local found - checking .env instead." -ForegroundColor Yellow
        $envFile = $fallbackEnvFile
    } else {
        Write-Host "Missing .env.local and .env - copy ENV_EXAMPLE.txt to .env.local first." -ForegroundColor Red
        exit 1
    }
}

$lines = Get-Content $envFile | Where-Object { $_ -notmatch '^\s*#' -and $_ -match '=' }
$vars = @{}
foreach ($line in $lines) {
    $idx = $line.IndexOf('=')
    if ($idx -lt 1) { continue }
    $key = $line.Substring(0, $idx).Trim()
    $val = $line.Substring($idx + 1).Trim().Trim('"').Trim("'")
    $vars[$key] = $val
}

function Test-Placeholder([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return $true }
    $placeholders = @(
        'your-', 'change-this', 'generate-with', 'sk-your', 'admin@yourdomain',
        'ChangeThisPassword', 'TODO', 'your-project', 'your-n8n'
    )
    foreach ($p in $placeholders) {
        if ($Value -like "*$p*") { return $true }
    }
    return $false
}

$required = @(
    'GOOGLE_SERVICE_ACCOUNT_JSON',
    'DATABASE_URL',
    'NEXTAUTH_URL',
    'NEXTAUTH_SECRET',
    'ADMIN_EMAIL',
    'ADMIN_PASSWORD',
    'ADMIN_NAME'
)

$recommended = @(
    'PUBLIC_APP_URL',
    'OPENAI_API_KEY',
    'GOOGLE_DOCUMENT_AI_PROJECT_ID',
    'GOOGLE_DOCUMENT_AI_PROCESSOR_ID',
    'JOB_NOTIFICATION_WEBHOOK_URL',
    'JOB_ACCESS_ADDED_WEBHOOK_URL',
    'PURCHASE_ORDER_EMAIL_WEBHOOK_URL',
    'CLOUDFLARE_R2_ACCOUNT_ID',
    'CLOUDFLARE_R2_ACCESS_KEY_ID',
    'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
    'CLOUDFLARE_R2_BUCKET_NAME'
)

Write-Host "`n=== Required (app won't work without these) ===" -ForegroundColor Cyan
$missingRequired = 0
foreach ($key in $required) {
    $val = $vars[$key]
    $ok = -not (Test-Placeholder $val)
    $status = if ($ok) { 'OK' } else { 'MISSING' }
    if (-not $ok) { $missingRequired++ }
    $color = if ($ok) { 'Green' } else { 'Yellow' }
    Write-Host ("  [{0}] {1}" -f $status, $key) -ForegroundColor $color
}

Write-Host "`n=== Recommended (features disabled if missing) ===" -ForegroundColor Cyan
foreach ($key in $recommended) {
    $val = $vars[$key]
    $ok = -not (Test-Placeholder $val)
    $status = if ($ok) { 'OK' } else { 'optional' }
    $color = if ($ok) { 'Green' } else { 'DarkGray' }
    Write-Host ("  [{0}] {1}" -f $status, $key) -ForegroundColor $color
}

Write-Host ""
Write-Host "Tip: Copy production values from Vercel > Project > Settings > Environment Variables"
Write-Host "     https://vercel.com  (projects: totalfireprotection, totalfireprotection-xrjt)"
Write-Host ""

if ($missingRequired -gt 0) { exit 1 }
exit 0
