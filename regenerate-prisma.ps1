# Prisma Client Regeneration Script
# Run this script after making schema changes

Write-Host "🔄 Regenerating Prisma Client..." -ForegroundColor Cyan

# Stop any running Node processes that might lock files
Write-Host "Checking for running Node processes..." -ForegroundColor Yellow
$nodeProcesses = Get-Process node -ErrorAction SilentlyContinue
if ($nodeProcesses) {
    Write-Host "Found $($nodeProcesses.Count) Node process(es). Please stop your dev server first!" -ForegroundColor Red
    Write-Host "Press any key after stopping the dev server to continue..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}

# Try to remove the .prisma directory if it exists
if (Test-Path "node_modules\.prisma") {
    Write-Host "Cleaning up old Prisma Client..." -ForegroundColor Yellow
    try {
        Remove-Item -Path "node_modules\.prisma" -Recurse -Force -ErrorAction Stop
        Write-Host "✓ Cleaned up old Prisma Client" -ForegroundColor Green
    } catch {
        Write-Host "⚠ Could not remove .prisma directory (files may be locked)" -ForegroundColor Yellow
        Write-Host "Please close all terminals, IDEs, and Node processes, then run: npx prisma generate" -ForegroundColor Yellow
        exit 1
    }
}

# Generate Prisma Client
Write-Host "Generating Prisma Client..." -ForegroundColor Yellow
try {
    npx prisma generate
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Prisma Client regenerated successfully!" -ForegroundColor Green
        Write-Host "You can now start your dev server." -ForegroundColor Cyan
    } else {
        Write-Host "❌ Failed to generate Prisma Client" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
    Write-Host "Please try:" -ForegroundColor Yellow
    Write-Host "1. Close all terminals and your IDE" -ForegroundColor Yellow
    Write-Host "2. Open a fresh terminal" -ForegroundColor Yellow
    Write-Host "3. Run: npx prisma generate" -ForegroundColor Yellow
    exit 1
}
