# Islet media helper. Prints one JSON line per second describing what is playing.
# Sources, in this order of preference:
#   1. Windows media controls (SMTC): Spotify, Edge, Chrome, Brave, Firefox, the Media Player app, YouTube in a browser, ...
#   2. Players that do not report to Windows (VLC, PotPlayer, classic Windows Media Player, MPC, mpv, KMPlayer, GOM):
#      the title comes from the player window and "is it playing" comes from Windows' audio meter for that program.
# Commands on stdin: toggle | next | prev | shuffle | repeat | seek <seconds> | select <app id>
# Problems are written to %TEMP%\islet-media.log
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -AssemblyName System.Runtime.WindowsRuntime
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
[void][Windows.Media.MediaPlaybackAutoRepeatMode, Windows.Media, ContentType = WindowsRuntime]

function Log($t) { try { Add-Content -Path (Join-Path $env:TEMP 'islet-media.log') -Value ((Get-Date -Format 's') + ' ' + $t) } catch {} }

# media keys and WM_APPCOMMAND (a media command sent straight to one player's window, so it cannot land on another app)
Add-Type -Namespace Islet -Name Keys -MemberDefinition @'
[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
'@
function Press-Key([byte]$vk) { [Islet.Keys]::keybd_event($vk, 0, 0, [UIntPtr]::Zero); [Islet.Keys]::keybd_event($vk, 0, 2, [UIntPtr]::Zero) }
# APPCOMMAND_MEDIA_NEXTTRACK=11 PREVIOUSTRACK=12 PLAY_PAUSE=14 PLAY=46 PAUSE=47
function App-Command($hwnd, [int]$cmd) {
  if ($hwnd -and [int64]$hwnd -ne 0) { [void][Islet.Keys]::PostMessage([IntPtr]$hwnd, 0x0319, [IntPtr]$hwnd, [IntPtr]($cmd * 65536)); return $true }
  return $false
}

# Windows' audio meter per program: tells whether a player without media controls is really playing right now.
$script:audioOk = $false
try {
  Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
namespace IsletAudio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] public class MMDeviceEnumerator { }
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDeviceEnumerator { int EnumAudioEndpoints(int flow, int mask, out IntPtr devs); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice dev); }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDevice { int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioSessionManager2 { int GetAudioSessionControl(IntPtr g, int f, out IntPtr c); int GetSimpleAudioVolume(IntPtr g, int f, out IntPtr v); int GetSessionEnumerator(out IAudioSessionEnumerator e); }
  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioSessionEnumerator { int GetCount(out int n); int GetSession(int i, out IAudioSessionControl2 s); }
  [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioSessionControl2 {
    int GetState(out int s); int GetDisplayName(out IntPtr n); int SetDisplayName(IntPtr v, ref Guid c); int GetIconPath(out IntPtr p); int SetIconPath(IntPtr v, ref Guid c);
    int GetGroupingParam(out Guid g); int SetGroupingParam(ref Guid o, ref Guid c); int RegisterAudioSessionNotification(IntPtr n); int UnregisterAudioSessionNotification(IntPtr n);
    int GetSessionIdentifier(out IntPtr i); int GetSessionInstanceIdentifier(out IntPtr i); int GetProcessId(out uint pid); int IsSystemSoundsSession(); int SetDuckingPreference(bool b);
  }
  [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioMeterInformation { int GetPeakValue(out float peak); }
  public static class Peek {
    // "pid:state:peak;pid:state:peak;..."  (state 1 = a stream is running). "ERR ..." when Windows refuses.
    public static string Dump() {
      var sb = new StringBuilder();
      object mgrObj = null; IMMDevice dev = null; IMMDeviceEnumerator en = null; IAudioSessionEnumerator se = null;
      try {
        en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
        en.GetDefaultAudioEndpoint(0, 1, out dev);
        Guid iid = typeof(IAudioSessionManager2).GUID;
        dev.Activate(ref iid, 23, IntPtr.Zero, out mgrObj);
        var mgr = (IAudioSessionManager2)mgrObj;
        mgr.GetSessionEnumerator(out se);
        int n; se.GetCount(out n);
        for (int i = 0; i < n; i++) {
          IAudioSessionControl2 c = null;
          try {
            se.GetSession(i, out c);
            uint pid; c.GetProcessId(out pid);
            int st; c.GetState(out st);
            float pk = 0; try { float v; if (((IAudioMeterInformation)c).GetPeakValue(out v) == 0) pk = v; } catch { }
            sb.Append(pid).Append(':').Append(st).Append(':').Append(pk.ToString("0.0000", System.Globalization.CultureInfo.InvariantCulture)).Append(';');
          } catch { }
          finally { if (c != null) Marshal.ReleaseComObject(c); }
        }
      } catch (Exception e) { return "ERR " + e.Message; }
      finally {
        if (se != null) Marshal.ReleaseComObject(se);
        if (mgrObj != null) Marshal.ReleaseComObject(mgrObj);
        if (dev != null) Marshal.ReleaseComObject(dev);
        if (en != null) Marshal.ReleaseComObject(en);
      }
      return sb.ToString();
    }
  }
}
'@
  $script:audioOk = $true
} catch { Log ('audio meter unavailable: ' + $_.Exception.Message) }

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
# A session that never answers must not freeze everything: every wait has a time limit.
function Await($op, $type, [int]$ms = 2500) {
  $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $t.Wait($ms)) { throw 'timed out' }
  $t.Result
}
# AsStreamForRead cannot be called directly from PowerShell on a WinRT stream ("Cannot find an overload"), so call it by reflection.
$asStream = ([System.IO.WindowsRuntimeStreamExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsStreamForRead' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IInputStream' })[0]
function Say($t) { [Console]::Out.WriteLine($t); [Console]::Out.Flush() }

$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$mgr = Await ($mgrType::RequestAsync()) $mgrType 8000

function Is-Playing($s) { try { [string]$s.GetPlaybackInfo().PlaybackStatus -eq 'Playing' } catch { $false } }
function Is-Closed($s) { try { [string]$s.GetPlaybackInfo().PlaybackStatus -eq 'Closed' } catch { $false } }

#region pure helpers (tested on their own)
# Players that do not report to Windows' media controls: process name -> label shown in the notch
$script:winPlayers = [ordered]@{
  'vlc' = 'VLC'; 'PotPlayerMini64' = 'PotPlayer'; 'PotPlayerMini' = 'PotPlayer'; 'PotPlayer64' = 'PotPlayer'; 'PotPlayer' = 'PotPlayer'
  'wmplayer' = 'Windows Media Player'; 'mpc-hc64' = 'MPC-HC'; 'mpc-hc' = 'MPC-HC'; 'mpc-be64' = 'MPC-BE'; 'mpc-be' = 'MPC-BE'
  'mpv' = 'mpv'; 'KMPlayer' = 'KMPlayer'; 'KMPlayer64X' = 'KMPlayer'; 'GOM' = 'GOM Player'; 'GomPlayer' = 'GOM Player'; 'Winamp' = 'Winamp'
}
$script:appTitle = '(VLC media player|PotPlayer(\s*\d[\d\.]*)?(\s*\(64-?bit\))?|mpv|MPC-HC.*|MPC-BE.*|Media Player Classic.*|Windows Media Player|KMPlayer.*|GOM ?Player.*|Winamp.*)'
# "Song name - VLC media player" -> "Song name". Returns '' when the window shows only the app name (nothing is open).
function Clean-Title([string]$t) {
  if (-not $t) { return '' }
  $t = $t.Trim()
  $t = [regex]::Replace($t, '\s+[-\u2013\u2014]\s+' + $script:appTitle + '\s*$', '', 'IgnoreCase').Trim()
  if ($t -match ('^' + $script:appTitle + '$')) { return '' }
  return $t
}
# "123:1:0.2500;456:0:0.0000;" -> @{ 123 = @{ state = 1; peak = 0.25 }; ... } (a program can have several streams: keep the busiest)
function Parse-Audio([string]$s) {
  $m = @{}
  if (-not $s -or $s.StartsWith('ERR')) { return $null }
  foreach ($part in $s.Split(';')) {
    $f = $part.Split(':')
    if ($f.Count -lt 3) { continue }
    $id = [int]$f[0]; $st = [int]$f[1]; $pk = [double]::Parse($f[2], [Globalization.CultureInfo]::InvariantCulture)
    if (-not $m.ContainsKey($id)) { $m[$id] = @{ state = $st; peak = $pk } }
    else { if ($st -gt $m[$id].state) { $m[$id].state = $st }; if ($pk -gt $m[$id].peak) { $m[$id].peak = $pk } }
  }
  return $m
}
#endregion

# ---------- SMTC sessions ----------
$script:pin = ''                                  # the source the person chose in the notch; it wins until something else starts playing
$script:pinGrace = [DateTime]::UtcNow

# Find the program file behind a media session so the notch can show its icon.
$exeCache = @{}; $exeMiss = @{}
$alias = @{ 'chrome' = 'chrome'; 'msedge' = 'msedge'; 'edge' = 'msedge'; 'firefox' = 'firefox'; 'brave' = 'brave'; 'opera' = 'opera'; 'vivaldi' = 'vivaldi'; 'spotify' = 'spotify'; 'vlc' = 'vlc'
  'zunemusic' = 'Microsoft.Media.Player'; 'microsoft.zunemusic' = 'Microsoft.Media.Player'; 'mediaplayer' = 'Microsoft.Media.Player'; 'zunevideo' = 'Video.UI'; 'potplayermini64' = 'PotPlayerMini64'; 'potplayermini' = 'PotPlayerMini'; 'wmplayer' = 'wmplayer' }
function Resolve-Exe($aumid) {
  if (-not $aumid) { return '' }
  if ($exeCache[$aumid]) { return $exeCache[$aumid] }
  if ($exeMiss[$aumid] -and ([DateTime]::UtcNow - $exeMiss[$aumid]).TotalSeconds -lt 15) { return '' }
  $name = [string]$aumid
  if ($name.Contains('!')) { $name = $name.Split('!')[-1] }
  $name = $name -replace '\.exe$', ''
  $cands = @($name, $name.ToLower(), ($name.Split('.')[-1]), ($name.Split('_')[0]))
  $pre = @()
  foreach ($k in @($name.ToLower(), $name.Split('.')[-1].ToLower(), $name.Split('_')[0].ToLower())) { if ($alias.ContainsKey($k)) { $pre += $alias[$k] } }
  $cands = $pre + $cands
  foreach ($c in ($cands | Where-Object { $_ } | Select-Object -Unique)) {
    try {
      $p = Get-Process -Name $c -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object -First 1
      if ($p) { $exeCache[$aumid] = $p.Path; return $p.Path }
    } catch {}
  }
  $exeMiss[$aumid] = [DateTime]::UtcNow
  return ''
}

# The cover picture or video thumbnail, as a data: URL ('' when the app does not provide one).
function Get-Thumb($p) {
  try {
    if (-not $p.Thumbnail) { return '' }
    [void][Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
    $st = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $mime = if ($st.ContentType) { [string]$st.ContentType } else { 'image/jpeg' }
    if (-not $asStream) { Log 'AsStreamForRead helper not found'; return '' }
    $net = $asStream.Invoke($null, @($st))
    $ms = New-Object System.IO.MemoryStream
    $net.CopyTo($ms)
    $bytes = $ms.ToArray()
    $ms.Dispose(); $net.Dispose()   # closing $net also closes the WinRT stream underneath (calling Dispose on the stream itself fails in PowerShell)
    if ($bytes.Length -le 0 -or $bytes.Length -gt 3000000) { return '' }
    return 'data:' + $mime + ';base64,' + [Convert]::ToBase64String($bytes)
  } catch { Log ('thumbnail failed: ' + $_.Exception.Message); return '' }
}
$script:artKey = ''
$script:artTries = 0

# Titles of the other open sessions are only needed for the switch list: refresh them every 2 seconds, not on every poll.
$script:sessCache = @(); $script:sessAt = [DateTime]::MinValue; $script:sessSig = ''
function Get-SmtcInfo {
  $list = @()
  foreach ($x in @($mgr.GetSessions())) {
    try { if (Is-Closed $x) { continue } } catch {}
    $id = ''; try { $id = [string]$x.SourceAppUserModelId } catch { continue }
    $list += @{ id = $id; s = $x; playing = (Is-Playing $x) }
  }
  return $list
}
function Get-SessionList($smtc) {
  $sig = ($smtc | ForEach-Object { $_.id + '=' + $_.playing }) -join ','
  if ($sig -eq $script:sessSig -and ([DateTime]::UtcNow - $script:sessAt).TotalSeconds -lt 2) { return $script:sessCache }
  $out = @()
  foreach ($x in $smtc) {
    $title = ''; $artist = ''
    try { $pp = Await ($x.s.TryGetMediaPropertiesAsync()) $propsType 1500; $title = [string]$pp.Title; $artist = [string]$pp.Artist } catch {}
    $out += [pscustomobject]@{ id = $x.id; exe = (Resolve-Exe $x.id); title = $title; artist = $artist; playing = $x.playing }
  }
  $script:sessCache = $out; $script:sessAt = [DateTime]::UtcNow; $script:sessSig = $sig
  return $out
}

# ---------- players without Windows media controls ----------
$script:audio = $null; $script:audioAt = [DateTime]::MinValue
$script:loud = @{}; $script:activeSince = @{}
$script:winTrack = @{}                           # when the audio meter is unavailable: playing state tracked from the clicks
function Refresh-Audio {
  if (-not $script:audioOk) { return }
  if (([DateTime]::UtcNow - $script:audioAt).TotalMilliseconds -lt 350) { return }
  $script:audioAt = [DateTime]::UtcNow
  try {
    $a = Parse-Audio ([IsletAudio.Peek]::Dump())
    if ($null -eq $a) { $script:audio = $null; return }
    $script:audio = $a
    $now = [DateTime]::UtcNow
    foreach ($k in @($a.Keys)) {
      if ($a[$k].peak -gt 0.0003) { $script:loud[$k] = $now }
      if ($a[$k].state -eq 1) { if (-not $script:activeSince.ContainsKey($k)) { $script:activeSince[$k] = $now } } else { $script:activeSince.Remove($k) }
    }
  } catch { Log ('audio read failed: ' + $_.Exception.Message); $script:audio = $null }
}
function Pid-Playing([int]$procId) {
  if ($null -eq $script:audio -or -not $script:audio.ContainsKey($procId)) { return $false }
  if ($script:audio[$procId].state -ne 1) { return $false }
  $now = [DateTime]::UtcNow
  if ($script:loud.ContainsKey($procId) -and ($now - $script:loud[$procId]).TotalSeconds -lt 6) { return $true }
  return ($script:activeSince.ContainsKey($procId) -and ($now - $script:activeSince[$procId]).TotalSeconds -lt 3)
}
function Get-WinSources($smtcExes) {
  $out = @()
  $names = @($script:winPlayers.Keys)
  $procs = @()
  try { $procs = @(Get-Process -Name $names -ErrorAction SilentlyContinue) } catch {}
  if (-not $procs.Count) { return $out }
  Refresh-Audio
  foreach ($grp in ($procs | Group-Object { $_.ProcessName.ToLower() })) {
    $pname = $grp.Name
    $label = ''; foreach ($k in $names) { if ($k.ToLower() -eq $pname) { $label = $script:winPlayers[$k]; break } }
    if (-not $label) { continue }
    if ($smtcExes -contains $pname) { continue }                          # this player already reports to Windows: use that
    $win = $grp.Group | Where-Object { $_.MainWindowTitle } | Select-Object -First 1
    $any = $grp.Group | Select-Object -First 1
    $playing = $false
    if ($null -ne $script:audio) { foreach ($q in $grp.Group) { if (Pid-Playing $q.Id) { $playing = $true; break } } }
    $id = 'win:' + $pname
    $title = ''
    if ($win) { $title = Clean-Title ([string]$win.MainWindowTitle) }
    if (-not $title) { if ($playing) { $title = $label } else { continue } }  # only the app name in the window and silent: nothing is open
    if ($null -eq $script:audio) {                                        # no audio meter: assume playing when a new title appears, then follow the clicks
      $tk = 'k|' + $title
      if (-not $script:winTrack.ContainsKey($id) -or $script:winTrack[$id].key -ne $tk) { $script:winTrack[$id] = @{ key = $tk; playing = $true } }
      $playing = [bool]$script:winTrack[$id].playing
    }
    $hwnd = 0; if ($win) { try { $hwnd = [int64]$win.MainWindowHandle } catch {} }
    $exe = ''; try { $exe = [string]$any.Path } catch {}
    $out += @{ id = $id; kind = 'win'; proc = $pname; label = $label; title = $title; exe = $exe; hwnd = $hwnd; playing = $playing }
  }
  return $out
}

# ---------- choosing what the notch shows ----------
function Pick-Source($smtc, $wins) {
  $all = @($smtc) + @($wins)
  if ($script:pin) {
    $pinned = $null
    foreach ($x in $all) { if ($x.id -eq $script:pin) { $pinned = $x; break } }
    if ($pinned) {
      if ([DateTime]::UtcNow -lt $script:pinGrace) { return $pinned }      # just chosen: the others are still being paused
      if ($pinned.playing) { return $pinned }
      foreach ($x in $all) { if ($x.playing) { $script:pin = ''; return $x } }   # something else started: follow it
      return $pinned
    } else { $script:pin = '' }
  }
  $cur = $null; try { $cur = $mgr.GetCurrentSession() } catch {}
  if ($cur) { foreach ($x in $smtc) { if ($x.id -eq [string]$cur.SourceAppUserModelId -and $x.playing) { return $x } } }
  foreach ($x in $smtc) { if ($x.playing) { return $x } }
  foreach ($x in $wins) { if ($x.playing) { return $x } }
  if ($cur) { foreach ($x in $smtc) { if ($x.id -eq [string]$cur.SourceAppUserModelId) { return $x } } }
  if (@($smtc).Count) { return @($smtc)[0] }
  if (@($wins).Count) { return @($wins)[0] }
  return $null
}
function Get-Sources {
  $smtc = @(Get-SmtcInfo)
  $exes = @()
  foreach ($x in $smtc) {
    $e = ''; try { $e = Resolve-Exe $x.id } catch {}
    if ($e) { $exes += [IO.Path]::GetFileNameWithoutExtension($e).ToLower() }
    $exes += ([string]$x.id).ToLower()
  }
  $skip = @(); foreach ($k in $script:winPlayers.Keys) { $kl = $k.ToLower(); foreach ($e in $exes) { if ($e -eq $kl -or $e.Contains($kl)) { $skip += $kl; break } } }
  $wins = @(Get-WinSources $skip)
  return @{ smtc = $smtc; wins = $wins }
}

$script:lastGood = ''; $script:lastGoodAt = [DateTime]::MinValue; $script:lastSig = ''
function Poll {
  $src = Get-Sources
  $s = Pick-Source $src.smtc $src.wins
  $sig = (@($src.smtc) + @($src.wins) | ForEach-Object { $_.id + '=' + $_.playing }) -join ','
  if ($sig -ne $script:lastSig) { $script:lastSig = $sig; Log ('sources: ' + $sig + ' | shown: ' + $(if ($s) { $s.id } else { 'none' })) }
  if ($null -eq $s) { return '{"none":true}' }
  $sess = @()
  foreach ($x in @(Get-SessionList $src.smtc)) { $sess += $x }
  foreach ($w in $src.wins) { $sess += [pscustomobject]@{ id = $w.id; exe = $w.exe; title = $w.title; artist = $w.label; playing = $w.playing } }

  if ($s.kind -eq 'win') {
    $o = [ordered]@{ none = $false; key = 'win|' + $s.proc + '|' + $s.title; app = $s.proc + '.exe'; exe = $s.exe; title = $s.title; artist = $s.label; playing = $s.playing
      pos = 0; dur = 0; canSeek = $false; shuffle = $null; canShuffle = $false; repeat = ''; canRepeat = $false; canNext = $true; canPrev = $true }
    if ($sess.Count -ge 2) { $o['sessions'] = $sess }
    $o['sid'] = $s.id
    return ($o | ConvertTo-Json -Compress -Depth 4)
  }

  $x = $s.s
  $p = $null; try { $p = Await ($x.TryGetMediaPropertiesAsync()) $propsType 2000 } catch { Log ('props: ' + $_.Exception.Message) }
  $info = $null; try { $info = $x.GetPlaybackInfo() } catch {}
  $playing = $s.playing
  $pos = 0.0; $dur = 0.0
  try {
    $tl = $x.GetTimelineProperties()
    $start = $tl.StartTime.TotalSeconds
    $dur = [math]::Max(0, $tl.EndTime.TotalSeconds - $start)
    $pos = $tl.Position.TotalSeconds - $start
    if ($playing) {                       # the position is a snapshot, so add the time since it was taken
      $age = ([DateTimeOffset]::UtcNow - $tl.LastUpdatedTime).TotalSeconds
      if ($age -gt 0 -and $age -lt 86400) { $pos += $age }
    }
    if ($dur -gt 0) { $pos = [math]::Min($pos, $dur) }
    $pos = [math]::Max(0, $pos)
  } catch { $pos = 0.0; $dur = 0.0 }
  $title = ''; $artist = ''
  if ($p) { $title = [string]$p.Title; $artist = [string]$p.Artist }
  if (-not $title) { foreach ($e in $sess) { if ($e.id -eq $s.id -and $e.title) { $title = $e.title; if (-not $artist) { $artist = $e.artist }; break } } }
  $key = $s.id + '|' + $title + '|' + $artist
  $shuf = $null; $rep = ''; $canSeek = $false; $canShuf = $false; $canRep = $false; $canNext = $true; $canPrev = $true
  if ($info) {
    try { if ($null -ne $info.IsShuffleActive) { $shuf = [bool]$info.IsShuffleActive } } catch {}
    try { if ($null -ne $info.AutoRepeatMode) { $rep = [string]$info.AutoRepeatMode } } catch {}   # None | Track | List
    try { $canSeek = [bool]$info.Controls.IsPlaybackPositionEnabled } catch {}
    try { $canShuf = [bool]$info.Controls.IsShuffleEnabled } catch {}
    try { $canRep = [bool]$info.Controls.IsRepeatEnabled } catch {}
    try { $canNext = [bool]$info.Controls.IsNextEnabled } catch {}
    try { $canPrev = [bool]$info.Controls.IsPreviousEnabled } catch {}
  }
  $o = [ordered]@{
    none = $false; key = $key; app = $s.id; exe = (Resolve-Exe $s.id); title = $title; artist = $artist; playing = $playing
    pos = [math]::Round($pos, 1); dur = [math]::Round($dur, 1); canSeek = $canSeek
    shuffle = $shuf; canShuffle = $canShuf; repeat = $rep; canRepeat = $canRep; canNext = $canNext; canPrev = $canPrev
  }
  if ($sess.Count -ge 2) { $o['sessions'] = $sess }
  $o['sid'] = $s.id
  # send the cover once per track (retry a few times, some apps load it a moment after the title)
  if ($p) {
    if ($key -ne $script:artKey) { $script:artKey = $key; $script:artTries = 0; $o['art'] = (Get-Thumb $p); if (-not $o['art']) { $script:artTries = 1 } }
    elseif ($script:artTries -gt 0 -and $script:artTries -lt 15) {
      $script:artTries++
      $a = Get-Thumb $p
      if ($a) { $o['art'] = $a; $script:artTries = 0 }
    }
  }
  $o | ConvertTo-Json -Compress -Depth 4
}

function Handle($line) {
  $parts = $line.Split(' ')
  $c = $parts[0]
  $src = Get-Sources
  if ($c -eq 'select') {                # switch source: the chosen app plays, every other one is paused
    $want = $line.Substring(6).Trim()
    $script:pin = $want; $script:pinGrace = [DateTime]::UtcNow.AddSeconds(3)
    foreach ($x in $src.smtc) { if ($x.id -ne $want -and $x.playing) { try { [void](Await ($x.s.TryPauseAsync()) ([bool])) } catch {} } }
    foreach ($w in $src.wins) { if ($w.id -ne $want -and $w.playing) { if (-not (App-Command $w.hwnd 47)) { Press-Key 0xB3 }; $script:winTrack[$w.id] = @{ key = 'k|' + $w.title; playing = $false } } }
    foreach ($x in $src.smtc) { if ($x.id -eq $want -and -not $x.playing) { try { [void](Await ($x.s.TryPlayAsync()) ([bool])) } catch {} } }
    foreach ($w in $src.wins) { if ($w.id -eq $want -and -not $w.playing) { if (-not (App-Command $w.hwnd 46)) { Press-Key 0xB3 }; $script:winTrack[$w.id] = @{ key = 'k|' + $w.title; playing = $true } } }
    return
  }
  $s = Pick-Source $src.smtc $src.wins
  if ($null -eq $s) { return }
  if ($s.kind -eq 'win') {              # a player without Windows media controls: the command goes to that player's own window
    switch ($c) {
      'toggle' { if (-not (App-Command $s.hwnd 14)) { Press-Key 0xB3 }; $script:winTrack[$s.id] = @{ key = 'k|' + $s.title; playing = -not $s.playing } }
      'next' { if (-not (App-Command $s.hwnd 11)) { Press-Key 0xB0 } }
      'prev' { if (-not (App-Command $s.hwnd 12)) { Press-Key 0xB1 } }
    }
    return
  }
  $x = $s.s
  # a media key goes to whichever app Windows treats as current: use it only when that really is this one
  $isCur = $false; try { $cur = $mgr.GetCurrentSession(); if ($cur -and [string]$cur.SourceAppUserModelId -eq $s.id) { $isCur = $true } } catch {}
  $ok = $false
  switch ($c) {
    'toggle' {
      try { if ($s.playing) { $ok = Await ($x.TryPauseAsync()) ([bool]) } else { $ok = Await ($x.TryPlayAsync()) ([bool]) } } catch {}
      if (-not $ok) { try { $ok = Await ($x.TryTogglePlayPauseAsync()) ([bool]) } catch {} }
      if (-not $ok -and $isCur) { Press-Key 0xB3 }
    }
    'next' { try { $ok = Await ($x.TrySkipNextAsync()) ([bool]) } catch {}; if (-not $ok -and $isCur) { Press-Key 0xB0 } }
    'prev' { try { $ok = Await ($x.TrySkipPreviousAsync()) ([bool]) } catch {}; if (-not $ok -and $isCur) { Press-Key 0xB1 } }
    'shuffle' {
      $cur = $false; try { if ($null -ne $x.GetPlaybackInfo().IsShuffleActive) { $cur = [bool]$x.GetPlaybackInfo().IsShuffleActive } } catch {}
      try { [void](Await ($x.TryChangeShuffleActiveAsync(-not $cur)) ([bool])) } catch {}
    }
    'repeat' {                          # off -> repeat all -> repeat one -> off
      try {
        $m = [string]$x.GetPlaybackInfo().AutoRepeatMode
        $next = switch ($m) { 'None' { 'List' } 'List' { 'Track' } default { 'None' } }
        $mode = [Enum]::Parse([Windows.Media.MediaPlaybackAutoRepeatMode], $next)
        [void](Await ($x.TryChangeAutoRepeatModeAsync($mode)) ([bool]))
      } catch {}
    }
    'seek' {
      try {
        $sec = [double]$parts[1]
        $start = $x.GetTimelineProperties().StartTime.TotalSeconds
        [void](Await ($x.TryChangePlaybackPositionAsync([long](($start + $sec) * 10000000))) ([bool]))
      } catch {}
    }
  }
}

# read commands without blocking the polling loop
$stdin = [Console]::OpenStandardInput()
$buf = New-Object byte[] 256
$read = $stdin.BeginRead($buf, 0, 256, $null, $null)
$pending = ''
$clock = [Diagnostics.Stopwatch]::StartNew()
$force = $true
$fast = 0                               # after a command, check a few times quickly so the screen follows right away

while ($true) {
  if ($read.IsCompleted) {
    $n = $stdin.EndRead($read)
    if ($n -le 0) { break }
    $pending += [Text.Encoding]::UTF8.GetString($buf, 0, $n)
    $read = $stdin.BeginRead($buf, 0, 256, $null, $null)
    while (($i = $pending.IndexOf("`n")) -ge 0) {
      $cmd = $pending.Substring(0, $i).Trim(); $pending = $pending.Substring($i + 1)
      try { Handle $cmd } catch { Log ('command "' + $cmd + '" failed: ' + $_.Exception.Message) }
      $force = $true; $fast = 5
    }
  }
  $every = if ($fast -gt 0) { 300 } else { 1000 }
  if ($force -or $clock.ElapsedMilliseconds -ge $every) {
    $force = $false; $clock.Restart()
    if ($fast -gt 0) { $fast-- }
    try {
      $line = Poll
      $script:lastGood = $line; $script:lastGoodAt = [DateTime]::UtcNow
      Say $line
    } catch {
      Log ('poll failed: ' + $_.Exception.Message)
      # a single hiccup must not blank the notch: repeat the last good state for a few seconds
      if ($script:lastGood -and ([DateTime]::UtcNow - $script:lastGoodAt).TotalSeconds -lt 6) { Say $script:lastGood } else { Say '{"none":true}' }
    }
  }
  Start-Sleep -Milliseconds 100
}
