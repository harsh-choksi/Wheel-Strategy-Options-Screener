$ErrorActionPreference = "Stop"

$node = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$bundledModules = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules"
$bundledPnpmModules = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules"

if (-not (Test-Path $node)) {
  $node = "node"
}

$modulePaths = @()
if (Test-Path $bundledModules) {
  $modulePaths += $bundledModules
}
if (Test-Path $bundledPnpmModules) {
  $modulePaths += $bundledPnpmModules
}
if ($modulePaths.Count -gt 0) {
  $env:NODE_PATH = [string]::Join([System.IO.Path]::PathSeparator, $modulePaths)
}

& $node (Join-Path $PSScriptRoot "..\src\server.js")
