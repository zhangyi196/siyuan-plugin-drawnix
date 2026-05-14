$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptDir 'build-plugin-core.ps1')

function Write-Step {
  param(
    [string] $Message
  )

  Write-Host ''
  Write-Host "==> $Message" -ForegroundColor Cyan
}

try {
  Invoke-PluginBuild -ScriptDir $scriptDir -WriteLine {
    param(
      [string] $Message,
      [string] $Level = 'info'
    )

    switch ($Level) {
      'step' {
        Write-Step -Message $Message
      }
      'success' {
        Write-Host $Message -ForegroundColor Green
      }
      'error' {
        Write-Host $Message -ForegroundColor Red
      }
      default {
        Write-Host $Message
      }
    }
  } | Out-Null
} catch {
  Write-Host ''
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}
