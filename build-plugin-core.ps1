$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Get-EnvValue {
  param(
    [Parameter(Mandatory = $true)]
    [string] $FilePath,

    [Parameter(Mandatory = $true)]
    [string] $Key
  )

  if (-not (Test-Path -LiteralPath $FilePath)) {
    throw "Missing env file: $FilePath"
  }

  foreach ($line in Get-Content -LiteralPath $FilePath -Encoding UTF8) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) {
      continue
    }

    $pair = $trimmed -split '=', 2
    if ($pair.Length -ne 2) {
      continue
    }

    if ($pair[0].Trim() -ne $Key) {
      continue
    }

    return $pair[1].Trim().Trim('"').Trim("'")
  }

  return $null
}

function Get-PluginBuildContext {
  param(
    [string] $ScriptDir = $PSScriptRoot
  )

  $envFile = Join-Path $ScriptDir '.env'
  $workspacePath = Get-EnvValue -FilePath $envFile -Key 'VITE_SIYUAN_WORKSPACE_PATH'
  if (-not $workspacePath) {
    throw 'Please set VITE_SIYUAN_WORKSPACE_PATH in .env first'
  }

  $workspacePath = [System.IO.Path]::GetFullPath($workspacePath)
  if (-not (Test-Path -LiteralPath $workspacePath)) {
    throw "SiYuan workspace not found: $workspacePath"
  }

  $workspaceDataPath = Join-Path $workspacePath 'data'
  if (-not (Test-Path -LiteralPath $workspaceDataPath)) {
    throw "SiYuan workspace is missing data directory: $workspaceDataPath"
  }

  $pluginInfo = Get-Content -LiteralPath (Join-Path $ScriptDir 'plugin.json') -Encoding UTF8 | ConvertFrom-Json
  $pluginName = $pluginInfo.name
  if (-not $pluginName) {
    throw 'Missing name field in plugin.json'
  }

  return [PSCustomObject]@{
    ScriptDir       = $ScriptDir
    EnvFile         = $envFile
    WorkspacePath   = $workspacePath
    WorkspaceData   = $workspaceDataPath
    PluginName      = $pluginName
    PluginDistPath  = Join-Path $workspaceDataPath "plugins\$pluginName"
    DistPath        = Join-Path $ScriptDir 'dist'
    NodeModulesPath = Join-Path $ScriptDir 'node_modules'
  }
}

function Invoke-PluginBuild {
  param(
    [string] $ScriptDir = $PSScriptRoot,
    [scriptblock] $WriteLine
  )

  if (-not $WriteLine) {
    $WriteLine = {
      param(
        [string] $Message,
        [string] $Level = 'info'
      )
    }
  }

  $log = {
    param(
      [string] $Message,
      [string] $Level = 'info'
    )

    & $WriteLine $Message $Level
  }

  Set-Location $ScriptDir

  & $log 'Check local environment' 'step'
  Get-Command node -ErrorAction Stop | Out-Null
  Get-Command npm -ErrorAction Stop | Out-Null

  $context = Get-PluginBuildContext -ScriptDir $ScriptDir

  & $log "Workspace: $($context.WorkspacePath)" 'info'
  & $log "Target plugin directory: $($context.PluginDistPath)" 'info'

  if (-not (Test-Path -LiteralPath $context.NodeModulesPath)) {
    & $log 'Install project dependencies' 'step'
    & npm install --legacy-peer-deps --no-package-lock 2>&1 | ForEach-Object {
      & $log $_.ToString() 'output'
    }

    if ($LASTEXITCODE -ne 0) {
      throw 'npm install failed'
    }
  } else {
    & $log 'Skip dependency install' 'step'
  }

  & $log 'Run build' 'step'
  & npm run build 2>&1 | ForEach-Object {
    & $log $_.ToString() 'output'
  }

  if ($LASTEXITCODE -ne 0) {
    throw 'npm run build failed'
  }

  if (-not (Test-Path -LiteralPath $context.DistPath)) {
    throw "Build output directory not found: $($context.DistPath)"
  }

  & $log "Sync plugin to SiYuan: $($context.PluginDistPath)" 'step'
  if (-not (Test-Path -LiteralPath $context.PluginDistPath)) {
    New-Item -ItemType Directory -Path $context.PluginDistPath | Out-Null
  }

  Get-ChildItem -LiteralPath $context.DistPath -Force | Copy-Item -Destination $context.PluginDistPath -Recurse -Force

  & $log 'Done' 'success'
  & $log "Plugin synced to: $($context.PluginDistPath)" 'success'
  & $log 'Return to SiYuan and reload or enable the Drawnix plugin.' 'success'

  return $context
}
