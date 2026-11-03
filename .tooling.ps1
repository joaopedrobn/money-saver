$ErrorActionPreference = 'Stop'
$nodeCandidates = @()
$onPath = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
if ($onPath) { $nodeCandidates += $onPath.Source }
if ($env:NVM_HOME -and (Test-Path -LiteralPath $env:NVM_HOME)) {
  $installed = Get-ChildItem -LiteralPath $env:NVM_HOME -Directory |
    Where-Object { $_.Name -match '^v25\.\d+\.\d+$' } |
    Sort-Object { [version]($_.Name.Substring(1)) } -Descending
  foreach ($installation in $installed) {
    $nodeCandidates += Join-Path $installation.FullName 'node.exe'
  }
}
$nodeExecutable = $null
foreach ($candidate in ($nodeCandidates | Select-Object -Unique)) {
  if (Test-Path -LiteralPath $candidate -PathType Leaf) {
    $detectedVersion = & $candidate -p 'process.versions.node'
    if ($LASTEXITCODE -eq 0 -and $detectedVersion -match '^25\.') {
      $nodeExecutable = $candidate
      break
    }
  }
}
if (-not $nodeExecutable) {
  throw 'Money Saver requer Node.js 25.x no PATH ou instalado no NVM_HOME. Ative a versao 25 existente; este helper nao instala nem seleciona outras versoes globalmente.'
}
$nodeDirectory = Split-Path -Parent $nodeExecutable
$npmCli = Join-Path $nodeDirectory 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path -LiteralPath $npmCli -PathType Leaf)) {
  throw 'npm nao encontrado junto ao Node 25 selecionado. Verifique a instalacao do Node/npm.'
}
# Keep npm and every child script on this same installation, without changing the global PATH.
$env:Path = $nodeDirectory + ';' + $env:Path
Push-Location -LiteralPath $PSScriptRoot
try {
  & $nodeExecutable $npmCli @args
  $commandExitCode = $LASTEXITCODE
} finally {
  Pop-Location
}
exit $commandExitCode
