# Get your local network IP address for Next.js development
# This helps you access your dev server from other devices on your network

Write-Host "`n=== Network IP Address Finder ===" -ForegroundColor Cyan
Write-Host ""

# Get IPv4 addresses
$ipAddresses = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
    $_.IPAddress -like '192.168.*' -or 
    $_.IPAddress -like '10.*' -or 
    $_.IPAddress -like '172.16.*' -or
    $_.IPAddress -like '172.17.*' -or
    $_.IPAddress -like '172.18.*' -or
    $_.IPAddress -like '172.19.*' -or
    $_.IPAddress -like '172.20.*' -or
    $_.IPAddress -like '172.21.*' -or
    $_.IPAddress -like '172.22.*' -or
    $_.IPAddress -like '172.23.*' -or
    $_.IPAddress -like '172.24.*' -or
    $_.IPAddress -like '172.25.*' -or
    $_.IPAddress -like '172.26.*' -or
    $_.IPAddress -like '172.27.*' -or
    $_.IPAddress -like '172.28.*' -or
    $_.IPAddress -like '172.29.*' -or
    $_.IPAddress -like '172.30.*' -or
    $_.IPAddress -like '172.31.*'
} | Where-Object { $_.IPAddress -ne '127.0.0.1' }

if ($ipAddresses) {
    $primaryIP = $ipAddresses[0].IPAddress
    Write-Host "✓ Found network IP: " -NoNewline -ForegroundColor Green
    Write-Host "$primaryIP" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To access from your iPad:" -ForegroundColor Cyan
    Write-Host "  http://$primaryIP`:3000" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Update your .env file with:" -ForegroundColor Cyan
    Write-Host "  NEXTAUTH_URL=`"http://$primaryIP`:3000`"" -ForegroundColor Yellow
    Write-Host ""
} else {
    Write-Host "✗ No network IP address found" -ForegroundColor Red
    Write-Host "Make sure you're connected to a network (WiFi or Ethernet)" -ForegroundColor Yellow
    Write-Host ""
}

Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
