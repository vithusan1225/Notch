# Islet app helper. Prints one JSON line: the Store (UWP) apps in the Start menu, such as WhatsApp, Calculator, Photos.
# For each: name, id (used to launch it with shell:AppsFolder) and the path of its logo picture.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$loc = @{}
foreach ($p in @(Get-AppxPackage)) { if ($p.PackageFamilyName -and $p.InstallLocation) { $loc[[string]$p.PackageFamilyName] = [string]$p.InstallLocation } }

function Find-Logo($dir, $rel) {
  try {
    $full = Join-Path $dir $rel
    $d = Split-Path $full; $base = [IO.Path]::GetFileNameWithoutExtension($full); $ext = [IO.Path]::GetExtension($full)
    $c = @(Get-ChildItem -LiteralPath $d -Filter ($base + '*' + $ext) -File)
    if (-not $c.Count) { return '' }
    $best = $c | Sort-Object -Descending -Property @{ Expression = {
      if ($_.Name -match 'targetsize-(\d+)') { $n = [int]$Matches[1]; if ($n -gt 256) { 0 } else { $n } }
      elseif ($_.Name -match 'scale-(\d+)') { [int]$Matches[1] * 0.44 }
      else { 1 } } } | Select-Object -First 1
    return [string]$best.FullName
  } catch { return '' }
}

$out = @()
foreach ($a in @(Get-StartApps)) {
  $id = [string]$a.AppID
  if (-not $id.Contains('!')) { continue }
  $fam = $id.Split('!')[0]; $aid = $id.Split('!')[1]
  $logo = ''
  $dir = $loc[$fam]
  if ($dir) {
    try {
      $mf = [xml](Get-Content -LiteralPath (Join-Path $dir 'AppxManifest.xml') -Raw)
      $node = @($mf.Package.Applications.Application) | Where-Object { $_.Id -eq $aid } | Select-Object -First 1
      $rel = [string]$node.VisualElements.Square44x44Logo
      if (-not $rel) { $rel = [string]$node.VisualElements.Square150x150Logo }
      if ($rel) { $logo = Find-Logo $dir $rel }
    } catch {}
  }
  $out += [pscustomobject]@{ name = [string]$a.Name; id = $id; logo = $logo }
}
[Console]::Out.WriteLine((ConvertTo-Json -InputObject @($out) -Compress))
