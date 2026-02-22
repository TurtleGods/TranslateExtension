param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("firefox", "chrome")]
    [string]$Browser
)

$source = "manifest.$Browser.json"
$target = "manifest.json"

if (-not (Test-Path $source)) {
    Write-Error "Source manifest not found: $source"
    exit 1
}

Copy-Item -Path $source -Destination $target -Force
Write-Host "Switched active manifest to $source -> $target"
