// Host system-info probe for the Settings "This device" panel. Runs on the local
// helper server (or the Vite dev middleware) — NOT in the browser, because web
// APIs deliberately hide the real CPU model, physical-core count, total/free RAM,
// and VRAM. Everything here reads the user's OWN machine and is served only to
// the local app; nothing is uploaded anywhere.
//
// Numbers are best-effort and platform-dependent. RAM comes from Node's `os`
// module (accurate). On Windows the CPU physical-core count and per-GPU VRAM are
// gathered with a single PowerShell call (CIM + the driver registry for accurate
// total VRAM, since Win32_VideoController.AdapterRAM is a uint32 that caps at
// 4 GB; GPU perf counters for used VRAM). On other platforms GPU details are
// omitted rather than guessed.

import os from 'os';
import { execFile } from 'child_process';

// Static facts (CPU model, core counts, VRAM totals) don't change within a
// session; only free RAM / free VRAM do. Cache the whole probe briefly so the
// Settings panel re-opening doesn't respawn PowerShell each time.
let cache = null;
let cacheAt = 0;
const TTL_MS = 3000;

function cpuInfo() {
  const cpus = os.cpus() || [];
  return {
    model: (cpus[0]?.model || 'Unknown CPU').replace(/\s+/g, ' ').trim(),
    logicalCores: cpus.length || null,
    physicalCores: null, // filled by the platform probe when available
  };
}

// One PowerShell round-trip that emits a compact JSON blob with the physical
// core count and per-GPU VRAM (total from the driver registry, used from GPU
// perf counters). Any sub-probe that fails just yields null — never throws.
const PS_SCRIPT = `
$ErrorActionPreference='SilentlyContinue'
$cores = (Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfCores -Sum).Sum
$vc = Get-CimInstance Win32_VideoController | Where-Object { $_.Name } | Select-Object Name, AdapterRAM
$reg = Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\*' |
  Where-Object { $_.'HardwareInformation.qwMemorySize' -ne $null } |
  Select-Object DriverDesc, @{N='qw';E={[int64]$_.'HardwareInformation.qwMemorySize'}}
$gpus = @()
foreach ($g in $vc) {
  $total = [int64]($g.AdapterRAM)
  $m = $reg | Where-Object { $_.DriverDesc -eq $g.Name } | Select-Object -First 1
  if ($m -and $m.qw -gt 0) { $total = [int64]$m.qw }
  $gpus += [pscustomobject]@{ name = [string]$g.Name; vramTotal = $total }
}
$used = $null
try {
  $ctr = Get-Counter '\\GPU Adapter Memory(*)\\Dedicated Usage' -ErrorAction Stop
  $used = [int64](($ctr.CounterSamples | Measure-Object -Property CookedValue -Sum).Sum)
} catch {}
[pscustomobject]@{ physicalCores = $cores; gpus = $gpus; vramUsed = $used } | ConvertTo-Json -Depth 4 -Compress
`;

function probeWindows() {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_SCRIPT],
      { timeout: 8000, windowsHide: true, maxBuffer: 1 << 20 },
      (err, stdout) => {
        if (err || !stdout) return resolve(null);
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve(null);
        }
      }
    );
  });
}

export async function getSysInfo() {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache;

  const cpu = cpuInfo();
  const memory = { total: os.totalmem(), free: os.freemem() };
  let gpus = [];

  if (process.platform === 'win32') {
    const win = await probeWindows();
    if (win) {
      if (win.physicalCores) cpu.physicalCores = Number(win.physicalCores) || null;
      // ConvertTo-Json collapses a single-element array to an object — normalize.
      const list = Array.isArray(win.gpus) ? win.gpus : win.gpus ? [win.gpus] : [];
      const totalUsed = win.vramUsed != null ? Number(win.vramUsed) : null;
      // The primary (highest-VRAM) GPU is the one that drives compute; attribute
      // the system-wide used-VRAM figure to it so a single free/total reads true
      // on the common one-discrete-GPU machine.
      const primaryIdx = list.reduce(
        (best, g, i, arr) => ((Number(g.vramTotal) || 0) > (Number(arr[best]?.vramTotal) || 0) ? i : best),
        0
      );
      gpus = list.map((g, i) => {
        const vramTotal = Number(g.vramTotal) > 0 ? Number(g.vramTotal) : null;
        const vramFree =
          i === primaryIdx && vramTotal != null && totalUsed != null
            ? Math.max(0, vramTotal - totalUsed)
            : null;
        return { name: g.name || 'GPU', vramTotal, vramFree, primary: i === primaryIdx };
      });
    }
  }

  cache = { platform: process.platform, cpu, memory, gpus };
  cacheAt = Date.now();
  return cache;
}
