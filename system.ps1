# Islet system helper: reads one command per line from stdin, answers on stdout.
#   get            -> prints "vol N", "mic 0/1", "bri N" (or "err vol" etc.)
#   vol N / bri N  -> set volume or brightness (0-100)
#   mic 0/1        -> 1 = muted
#   wifi 0/1, bt 0/1, air 0/1 -> radios on/off (air 1 = turn every radio off)
#   night 0/1      -> warm, dimmed-blue screen tint (Night Light) on or off
#   dark 0/1       -> 1 = dark mode for apps and Windows
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)   # titles with non-English letters

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int _0(); int _1(); int _2(); int _3();
  int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
  int _5();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int _7(); int _8(); int _9(); int _10();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int _0(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }

public class Native {
  [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);
}

public class Gamma {
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hWnd);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
  [DllImport("gdi32.dll")] static extern bool SetDeviceGammaRamp(IntPtr hDC, ushort[] ramp);
  public static bool Tint(double r, double g, double b) {
    ushort[] ramp = new ushort[768];
    for (int i = 0; i < 256; i++) {
      double v = i / 255.0;
      ramp[i] = (ushort)(Math.Min(1.0, v * r) * 65535);
      ramp[256 + i] = (ushort)(Math.Min(1.0, v * g) * 65535);
      ramp[512 + i] = (ushort)(Math.Min(1.0, v * b) * 65535);
    }
    IntPtr dc = GetDC(IntPtr.Zero);
    bool ok = SetDeviceGammaRamp(dc, ramp);
    ReleaseDC(IntPtr.Zero, dc);
    return ok;
  }
}

public class Audio {
  static IAudioEndpointVolume Vol(int flow) {
    IMMDeviceEnumerator e = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice d; e.GetDefaultAudioEndpoint(flow, 1, out d);
    Guid g = typeof(IAudioEndpointVolume).GUID; IAudioEndpointVolume v;
    d.Activate(ref g, 23, 0, out v); return v;
  }
  public static float GetVolume() { float f; Vol(0).GetMasterVolumeLevelScalar(out f); return f; }
  public static void SetVolume(float f) { Vol(0).SetMasterVolumeLevelScalar(f, Guid.Empty); }
  public static bool GetMicMuted() { bool m; Vol(1).GetMute(out m); return m; }
  public static void SetMicMuted(bool m) { Vol(1).SetMute(m, Guid.Empty); }
}
"@

# --- radios (Wi-Fi, Bluetooth) through the Windows Radio API; needs Windows PowerShell 5.1 ---
$script:radioReady = $false
$script:asTask = $null
function Init-Async {
  if ($script:asTask) { return }
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $script:asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
}
function Init-Radio {
  if ($script:radioReady) { return }
  Init-Async
  [void][Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime]
  [void][Windows.Devices.Radios.RadioState, Windows.System.Devices, ContentType = WindowsRuntime]
  [void](Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus]))
  $script:radioReady = $true
}
function Await($op, $type) {
  $t = $script:asTask.MakeGenericMethod($type).Invoke($null, @($op))
  [void]$t.Wait(-1)
  $t.Result
}
function Get-Radios {
  Init-Radio
  Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
}
function Set-Radio($kind, [bool]$on) {
  $state = if ($on) { 'On' } else { 'Off' }
  foreach ($r in (Get-Radios)) {
    if ($kind -eq 'All' -or [string]$r.Kind -eq $kind) {
      [void](Await ($r.SetStateAsync($state)) ([Windows.Devices.Radios.RadioAccessStatus]))
    }
  }
}
function Say-Radios {
  try {
    $rs = @(Get-Radios)
    $w = @($rs | Where-Object { [string]$_.Kind -eq 'WiFi' })
    $b = @($rs | Where-Object { [string]$_.Kind -eq 'Bluetooth' })
    if ($w.Count) { Say ("wifi " + [int]([string]$w[0].State -eq 'On')) } else { Say "err wifi" }
    if ($b.Count) { Say ("bt " + [int]([string]$b[0].State -eq 'On')) } else { Say "err bt" }
    if ($rs.Count) { Say ("air " + [int](-not ($rs | Where-Object { [string]$_.State -eq 'On' }))) } else { Say "err air" }
  } catch { Say "err wifi"; Say "err bt"; Say "err air" }
}

# --- dark style ---
$themeKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
function Say-Dark {
  try { Say ("dark " + [int]((Get-ItemProperty -Path $themeKey -Name AppsUseLightTheme).AppsUseLightTheme -eq 0)) } catch { Say "err dark" }
}
function Set-Dark([bool]$on) {
  $v = if ($on) { 0 } else { 1 }
  Set-ItemProperty -Path $themeKey -Name AppsUseLightTheme -Value $v -Type DWord
  Set-ItemProperty -Path $themeKey -Name SystemUsesLightTheme -Value $v -Type DWord
  $r = [UIntPtr]::Zero
  [void][Native]::SendMessageTimeout([IntPtr]0xFFFF, 0x1A, [UIntPtr]::Zero, 'ImmersiveColorSet', 2, 200, [ref]$r)
}

# --- night light: Islet's own warm tint (Windows has no public on/off switch for its Night Light) ---
$script:night = $false
function Set-Night([bool]$on) {
  $ok = if ($on) { [Gamma]::Tint(1.0, 0.86, 0.62) } else { [Gamma]::Tint(1.0, 1.0, 1.0) }
  if (-not $ok) { throw "gamma" }
  $script:night = $on
}
function Say-Night { Say ("night " + [int]$script:night) }

function Say($t) { [Console]::Out.WriteLine($t); [Console]::Out.Flush() }

function Get-All {
  try { Say ("vol " + [int][math]::Round([Audio]::GetVolume() * 100)) } catch { Say "err vol" }
  try { if ([Audio]::GetMicMuted()) { Say "mic 1" } else { Say "mic 0" } } catch { Say "err mic" }
  try {
    $b = (Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1).CurrentBrightness
    if ($null -eq $b) { throw "none" }
    Say ("bri " + $b)
  } catch { Say "err bri" }
  Say-Radios
  Say-Dark
  Say-Night
}

try { [void][Gamma]::Tint(1.0, 1.0, 1.0) } catch {}   # clear any tint left behind by an earlier run

while (($line = [Console]::In.ReadLine()) -ne $null) {
  $p = $line.Trim().Split(' ')
  try {
    switch ($p[0]) {
      'get' { Get-All }
      'vol' { [Audio]::SetVolume([float]([int]$p[1]) / 100) }
      'mic' { [Audio]::SetMicMuted(([int]$p[1]) -eq 1) }
      'night' { Set-Night ([int]$p[1] -eq 1); Say-Night }
      'wifi' { Set-Radio 'WiFi' ([int]$p[1] -eq 1); Say-Radios }
      'bt'   { Set-Radio 'Bluetooth' ([int]$p[1] -eq 1); Say-Radios }
      'air'  { Set-Radio 'All' ([int]$p[1] -eq 0); Say-Radios }
      'dark' { Set-Dark ([int]$p[1] -eq 1); Say-Dark }
      'bri' {
        $m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1
        Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]1; Brightness = [byte][int]$p[1] } | Out-Null
      }
    }
  } catch { Say ("err " + $p[0]) }
}

try { [void][Gamma]::Tint(1.0, 1.0, 1.0) } catch {}   # the app closed: put the screen colours back
