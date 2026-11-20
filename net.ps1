# Islet network helper: Wi-Fi networks and Bluetooth devices for the Controls tab.
# Commands on stdin: wifiscan | wifidisc | wificonn <base64 json: ssid, pass, auth> | btscan
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
function Say($t) { [Console]::Out.WriteLine($t); [Console]::Out.Flush() }
function Msg($t) { Say ('netmsg ' + (ConvertTo-Json -InputObject ([string]$t) -Compress)) }

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, $type) {
  $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  [void]$t.Wait(-1)
  $t.Result
}

# ---------- Wi-Fi (uses netsh, English Windows) ----------
function Get-Profiles {
  $names = @()
  foreach ($l in @(netsh wlan show profiles)) { if ($l -match '(All User Profile|User Profile)\s*:\s*(.+?)\s*$') { $names += $Matches[2] } }
  return $names
}
function Get-WifiList {
  $cur = ''
  $ifc = (netsh wlan show interfaces | Out-String)
  if ($ifc -match '(?m)^\s*State\s*:\s*connected') { if ($ifc -match '(?m)^\s*SSID\s*:\s*(.+?)\s*$') { $cur = $Matches[1] } }
  $saved = Get-Profiles
  $txt = (netsh wlan show networks mode=bssid | Out-String)
  $nets = @{}
  $ssid = $null
  foreach ($l in ($txt -split "`r?`n")) {
    if ($l -match '^SSID\s+\d+\s*:\s*(.*)$') {
      $ssid = $Matches[1].Trim()
      if ($ssid -and -not $nets.ContainsKey($ssid)) { $nets[$ssid] = @{ ssid = $ssid; signal = 0; secured = $true; auth = '' } }
      if (-not $ssid) { $ssid = $null }
    }
    elseif ($ssid -and $l -match '^\s*Authentication\s*:\s*(.+)$') { $a = $Matches[1].Trim(); $nets[$ssid].auth = $a; $nets[$ssid].secured = ($a -ne 'Open') }
    elseif ($ssid -and $l -match '^\s*Signal\s*:\s*(\d+)%') { $v = [int]$Matches[1]; if ($v -gt $nets[$ssid].signal) { $nets[$ssid].signal = $v } }
  }
  if ($cur -and -not $nets.ContainsKey($cur)) { $nets[$cur] = @{ ssid = $cur; signal = 0; secured = $true; auth = '' } }
  $list = @()
  foreach ($k in $nets.Keys) {
    $n = $nets[$k]
    $list += [ordered]@{ ssid = $n.ssid; signal = $n.signal; secured = [bool]$n.secured; auth = $n.auth; saved = [bool]($saved -contains $n.ssid); connected = [bool]($n.ssid -eq $cur) }
  }
  $list = @($list | Sort-Object @{ Expression = { -[int]$_.connected } }, @{ Expression = { -[int]$_.signal } })
  Say ('wifilist ' + (ConvertTo-Json -InputObject $list -Compress))
}
function Connect-Wifi($ssid, $pass, $auth) {
  if (-not ((Get-Profiles) -contains $ssid)) {
    $e = [Security.SecurityElement]::Escape($ssid)
    if ($pass) {
      $am = if ($auth -match 'WPA3' -and $auth -notmatch 'WPA2') { 'WPA3SAE' } else { 'WPA2PSK' }
      $k = [Security.SecurityElement]::Escape($pass)
      $xml = "<?xml version=`"1.0`"?><WLANProfile xmlns=`"http://www.microsoft.com/networking/WLAN/profile/v1`"><name>$e</name><SSIDConfig><SSID><name>$e</name></SSID></SSIDConfig><connectionType>ESS</connectionType><connectionMode>auto</connectionMode><MSM><security><authEncryption><authentication>$am</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption><sharedKey><keyType>passphrase</keyType><protected>false</protected><keyMaterial>$k</keyMaterial></sharedKey></security></MSM></WLANProfile>"
    } else {
      $xml = "<?xml version=`"1.0`"?><WLANProfile xmlns=`"http://www.microsoft.com/networking/WLAN/profile/v1`"><name>$e</name><SSIDConfig><SSID><name>$e</name></SSID></SSIDConfig><connectionType>ESS</connectionType><connectionMode>auto</connectionMode><MSM><security><authEncryption><authentication>open</authentication><encryption>none</encryption><useOneX>false</useOneX></authEncryption></security></MSM></WLANProfile>"
    }
    $f = Join-Path $env:TEMP ('islet-wifi-' + [guid]::NewGuid().ToString('N') + '.xml')
    [IO.File]::WriteAllText($f, $xml, (New-Object Text.UTF8Encoding($false)))
    try { [void](netsh wlan add profile filename="$f") } finally { Remove-Item $f -Force -ErrorAction SilentlyContinue }
  }
  [void](netsh wlan connect name="$ssid")
}

# ---------- Bluetooth (paired devices and whether they are connected) ----------
function Get-BtList {
  [void][Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType = WindowsRuntime]
  [void][Windows.Devices.Enumeration.DeviceInformationCollection, Windows.Devices.Enumeration, ContentType = WindowsRuntime]
  [void][Windows.Devices.Bluetooth.BluetoothDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime]
  $sel = [Windows.Devices.Bluetooth.BluetoothDevice]::GetDeviceSelectorFromPairingState($true)
  $infos = Await ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($sel)) ([Windows.Devices.Enumeration.DeviceInformationCollection])
  $list = @()
  foreach ($i in $infos) {
    $c = $false
    try { $d = Await ([Windows.Devices.Bluetooth.BluetoothDevice]::FromIdAsync($i.Id)) ([Windows.Devices.Bluetooth.BluetoothDevice]); $c = ([string]$d.ConnectionStatus -eq 'Connected') } catch {}
    $list += [ordered]@{ name = [string]$i.Name; connected = [bool]$c }
  }
  $list = @($list | Sort-Object @{ Expression = { -[int]$_.connected } }, name)
  Say ('btlist ' + (ConvertTo-Json -InputObject $list -Compress))
}

while (($line = [Console]::In.ReadLine()) -ne $null) {
  $p = $line.Trim().Split(' ')
  try {
    switch ($p[0]) {
      'wifiscan' { try { Get-WifiList } catch { Say 'wifilist []'; Msg 'Wi-Fi is off or not available on this PC' } }
      'wifidisc' { [void](netsh wlan disconnect); Start-Sleep -Milliseconds 800; Get-WifiList }
      'wificonn' {
        $j = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p[1])))
        Msg ('Connecting to ' + $j.ssid + '...')
        Connect-Wifi $j.ssid $j.pass $j.auth
        Start-Sleep -Seconds 4
        Get-WifiList
        Msg ''
      }
      'btscan' { try { Get-BtList } catch { Say 'btlist []'; Msg 'Bluetooth is off or not available on this PC' } }
    }
  } catch { Msg ('Something went wrong: ' + $_.Exception.Message) }
}
