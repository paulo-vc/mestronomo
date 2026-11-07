# Mede CPU e memória do Mestrônomo (dev) com uma mesa típica tocando:
# 3 camadas de ambiente, 1 música local e 1 efeito em loop, monitor ligado.
# Roda isolado (porta e configuração próprias) para não mexer numa cópia que esteja aberta.
# Uso: powershell -File scripts/medir-app.ps1 [-Segundos 20]
param([int]$Segundos = 20, [int]$Porta = 7796)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path $PSScriptRoot -Parent
$tmp = Join-Path $env:TEMP "mestronomo-medicao"
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $tmp | Out-Null

# Arquivos de teste com prefixo zz- (apagados no fim).
$ff = (Get-Command ffmpeg).Source
$criados = @()
foreach ($n in 1..3) { $f = "$raiz\ambientes\zz-camada$n.wav"; & $ff -loglevel error -y -f lavfi -i "anoisesrc=d=10:c=pink:a=0.1" $f; $criados += $f }
New-Item -ItemType Directory "$raiz\musicas\zz-teste" -Force | Out-Null
& $ff -loglevel error -y -f lavfi -i "sine=frequency=330:duration=120" "$raiz\musicas\zz-teste\musica.ogg"
& $ff -loglevel error -y -f lavfi -i "sine=frequency=500:duration=3" "$raiz\sons\zz-loop.wav"; $criados += "$raiz\sons\zz-loop.wav"

# No PowerShell, DISCORD_TOKEN='' apaga a variável; quem garante que o .env (com o token real) não é lido é o MESTRONOMO_SEM_ENV.
$env:MESTRONOMO_USER_DATA = "$tmp\userdata"; $env:MESTRONOMO_PORT = "$Porta"; $env:DISCORD_TOKEN = ''; $env:MESTRONOMO_SEM_ENV = '1'
$app = Start-Process "$raiz\node_modules\electron\dist\electron.exe" -ArgumentList "`"$raiz`"" -PassThru
Start-Sleep 8
$api = "http://127.0.0.1:$Porta/api"
function Arvore { $todos = Get-CimInstance Win32_Process; $ids = @($app.Id); do { $novos = $todos | Where-Object { $ids -contains $_.ParentProcessId -and $ids -notcontains $_.ProcessId } | ForEach-Object ProcessId; $ids += $novos } while ($novos); $ids }
$bot = (Invoke-RestMethod "$api/estado").bot.state
if ($bot -ne 'desligado') {
  foreach ($id in (Arvore)) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  throw "O bot está '$bot' (deveria estar desligado); medição abortada."
}

# Carga: liga tudo e espera estabilizar.
Invoke-RestMethod "$api/sons" | Out-Null
foreach ($n in 1..3) { Invoke-RestMethod "$api/ambiente/zz-camada$n.wav" | Out-Null }
Invoke-RestMethod "$api/youtube/pasta/zz-teste" | Out-Null
Start-Sleep 3

# Nome com o tipo do processo do Electron (principal, renderer, gpu-process, utility...).
function Tipo($id) { $c = (Get-CimInstance Win32_Process -Filter "ProcessId=$id").CommandLine; if ($c -match '--type=([\w-]+)') { $t = $Matches[1]; if ($c -match '--utility-sub-type=([\w.]+)') { $t += ':' + ($Matches[1] -split '\.')[-1] }; $t } else { 'principal' } }
function Amostra { $ids = Arvore; Get-Process -Id $ids -ErrorAction SilentlyContinue | Select-Object Id, @{n='ProcessName';e={ if ($_.ProcessName -eq 'electron') { 'electron ' + (Tipo $_.Id) } else { $_.ProcessName } }}, @{n='cpu';e={$_.TotalProcessorTime.TotalMilliseconds}}, @{n='mem';e={$_.WorkingSet64}} }
$a = Amostra; $t0 = Get-Date
Start-Sleep $Segundos
$b = Amostra; $dt = ((Get-Date) - $t0).TotalMilliseconds
$nucleos = [Environment]::ProcessorCount

$linhas = foreach ($p in $b) {
  $antes = $a | Where-Object Id -eq $p.Id
  $cpu = if ($antes) { ($p.cpu - $antes.cpu) / $dt * 100 } else { 0 }
  [pscustomobject]@{ Processo = $p.ProcessName; CPU = [math]::Round($cpu, 1); MemMB = [math]::Round($p.mem / 1MB) }
}
$linhas | Group-Object Processo | ForEach-Object { [pscustomobject]@{ Processo = $_.Name; Qtd = $_.Count; 'CPU % (1 núcleo)' = ($_.Group | Measure-Object CPU -Sum).Sum; 'Memória MB' = ($_.Group | Measure-Object MemMB -Sum).Sum } } | Sort-Object 'CPU % (1 núcleo)' -Descending | Format-Table -AutoSize | Out-String
$totalCpu = ($linhas | Measure-Object CPU -Sum).Sum
"TOTAL: CPU {0:N1}% de um núcleo ({1:N1}% do PC com {2} núcleos) | memória {3} MB" -f $totalCpu, ($totalCpu / $nucleos), $nucleos, ($linhas | Measure-Object MemMB -Sum).Sum

# Limpeza: só os processos que este script abriu.
foreach ($id in (Arvore)) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
Start-Sleep 1
$criados | ForEach-Object { Remove-Item $_ -Force -ErrorAction SilentlyContinue }
Remove-Item "$raiz\musicas\zz-teste" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
