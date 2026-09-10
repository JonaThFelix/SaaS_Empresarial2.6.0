$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtime = Join-Path $root "runtime"
$node = Join-Path $runtime "node.exe"
$url = "https://nodejs.org/dist/v24.19.0/win-x64/node.exe"
$expected = "3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237"
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
if (Test-Path $node) {
  $hash = (Get-FileHash -Algorithm SHA256 $node).Hash.ToLower()
  if ($hash -eq $expected) { Write-Host "Motor Node portatil ja esta pronto."; exit 0 }
  Remove-Item -Force $node
}
$tmp = "$node.download"
Write-Host "Baixando o motor Node.js portatil oficial..."
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $tmp
$hash = (Get-FileHash -Algorithm SHA256 $tmp).Hash.ToLower()
if ($hash -ne $expected) { Remove-Item -Force $tmp -ErrorAction SilentlyContinue; throw "Falha na verificacao de seguranca do Node.js. Hash diferente do oficial." }
Move-Item -Force $tmp $node
Write-Host "Motor Node.js verificado e salvo apenas dentro da pasta do sistema."
