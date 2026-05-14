$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptDir 'build-plugin-core.ps1')

function New-UiFont {
  param(
    [float] $Size,
    [System.Drawing.FontStyle] $Style = [System.Drawing.FontStyle]::Regular
  )

  return New-Object System.Drawing.Font('Microsoft YaHei UI', $Size, $Style)
}

$context = $null
$loadError = $null
try {
  $context = Get-PluginBuildContext -ScriptDir $scriptDir
} catch {
  $loadError = $_.Exception.Message
}

$powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$buildScriptPath = Join-Path $scriptDir 'build-plugin.ps1'
$currentProcess = $null

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Drawnix Plugin Builder'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(760, 560)
$form.MinimumSize = New-Object System.Drawing.Size(760, 560)
$form.BackColor = [System.Drawing.Color]::FromArgb(248, 250, 252)

$titleLabel = New-Object System.Windows.Forms.Label
$titleLabel.Text = 'Drawnix Plugin Builder'
$titleLabel.Font = New-UiFont -Size 16 -Style Bold
$titleLabel.ForeColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$titleLabel.Location = New-Object System.Drawing.Point(20, 18)
$titleLabel.AutoSize = $true

$summaryLabel = New-Object System.Windows.Forms.Label
$summaryLabel.Text = 'Install deps, build, and sync to your SiYuan plugin folder.'
$summaryLabel.Font = New-UiFont -Size 9.5
$summaryLabel.ForeColor = [System.Drawing.Color]::FromArgb(71, 85, 105)
$summaryLabel.Location = New-Object System.Drawing.Point(22, 48)
$summaryLabel.AutoSize = $true

$workspaceCaption = New-Object System.Windows.Forms.Label
$workspaceCaption.Text = 'SiYuan workspace'
$workspaceCaption.Font = New-UiFont -Size 9 -Style Bold
$workspaceCaption.ForeColor = [System.Drawing.Color]::FromArgb(51, 65, 85)
$workspaceCaption.Location = New-Object System.Drawing.Point(20, 86)
$workspaceCaption.AutoSize = $true

$workspaceValue = New-Object System.Windows.Forms.TextBox
$workspaceValue.Location = New-Object System.Drawing.Point(20, 108)
$workspaceValue.Size = New-Object System.Drawing.Size(700, 24)
$workspaceValue.ReadOnly = $true
$workspaceValue.BackColor = [System.Drawing.Color]::White
$workspaceValue.BorderStyle = 'FixedSingle'
$workspaceValue.Font = New-UiFont -Size 9

$targetCaption = New-Object System.Windows.Forms.Label
$targetCaption.Text = 'Plugin output folder'
$targetCaption.Font = New-UiFont -Size 9 -Style Bold
$targetCaption.ForeColor = [System.Drawing.Color]::FromArgb(51, 65, 85)
$targetCaption.Location = New-Object System.Drawing.Point(20, 146)
$targetCaption.AutoSize = $true

$targetValue = New-Object System.Windows.Forms.TextBox
$targetValue.Location = New-Object System.Drawing.Point(20, 168)
$targetValue.Size = New-Object System.Drawing.Size(700, 24)
$targetValue.ReadOnly = $true
$targetValue.BackColor = [System.Drawing.Color]::White
$targetValue.BorderStyle = 'FixedSingle'
$targetValue.Font = New-UiFont -Size 9

$runButton = New-Object System.Windows.Forms.Button
$runButton.Text = 'Build now'
$runButton.Location = New-Object System.Drawing.Point(20, 214)
$runButton.Size = New-Object System.Drawing.Size(120, 34)
$runButton.BackColor = [System.Drawing.Color]::FromArgb(14, 116, 144)
$runButton.ForeColor = [System.Drawing.Color]::White
$runButton.FlatStyle = 'Flat'
$runButton.Font = New-UiFont -Size 10 -Style Bold

$openPluginButton = New-Object System.Windows.Forms.Button
$openPluginButton.Text = 'Open plugin folder'
$openPluginButton.Location = New-Object System.Drawing.Point(150, 214)
$openPluginButton.Size = New-Object System.Drawing.Size(128, 34)
$openPluginButton.FlatStyle = 'Flat'
$openPluginButton.Font = New-UiFont -Size 9

$openProjectButton = New-Object System.Windows.Forms.Button
$openProjectButton.Text = 'Open project folder'
$openProjectButton.Location = New-Object System.Drawing.Point(288, 214)
$openProjectButton.Size = New-Object System.Drawing.Size(128, 34)
$openProjectButton.FlatStyle = 'Flat'
$openProjectButton.Font = New-UiFont -Size 9

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Text = 'Status: idle'
$statusLabel.Font = New-UiFont -Size 9
$statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(51, 65, 85)
$statusLabel.Location = New-Object System.Drawing.Point(20, 266)
$statusLabel.AutoSize = $true

$progressBar = New-Object System.Windows.Forms.ProgressBar
$progressBar.Location = New-Object System.Drawing.Point(20, 292)
$progressBar.Size = New-Object System.Drawing.Size(700, 14)
$progressBar.Style = 'Blocks'

$logBox = New-Object System.Windows.Forms.TextBox
$logBox.Location = New-Object System.Drawing.Point(20, 324)
$logBox.Size = New-Object System.Drawing.Size(700, 190)
$logBox.Multiline = $true
$logBox.ReadOnly = $true
$logBox.ScrollBars = 'Vertical'
$logBox.BorderStyle = 'FixedSingle'
$logBox.BackColor = [System.Drawing.Color]::White
$logBox.Font = New-Object System.Drawing.Font('Consolas', 9)

$appendLog = {
  param(
    [string] $Message
  )

  if ($form.IsDisposed) {
    return
  }

  $action = [System.Action[string]] {
    param($Text)
    $logBox.AppendText($Text + [Environment]::NewLine)
    $logBox.SelectionStart = $logBox.TextLength
    $logBox.ScrollToCaret()
  }
  $null = $form.BeginInvoke($action, @($Message))
}

$onProcessExit = {
  param(
    [System.Diagnostics.Process] $Process
  )

  $action = [System.Action] {
    $exitCode = $currentProcess.ExitCode
    if ($exitCode -eq 0) {
      $statusLabel.Text = 'Status: build completed'
      $progressBar.Style = 'Blocks'
      $runButton.Enabled = $true
      $openPluginButton.Enabled = $true
      $openProjectButton.Enabled = $true
      $logBox.AppendText([Environment]::NewLine + 'Build succeeded. Reload the plugin in SiYuan.' + [Environment]::NewLine)
    } else {
      $statusLabel.Text = "Status: build failed (exit code $exitCode)"
      $progressBar.Style = 'Blocks'
      $runButton.Enabled = $true
      $openPluginButton.Enabled = $true
      $openProjectButton.Enabled = $true
      $logBox.AppendText([Environment]::NewLine + 'Build failed. Check the log above.' + [Environment]::NewLine)
    }
    $currentProcess = $null
  }.GetNewClosure()

  if (-not $form.IsDisposed) {
    $null = $form.BeginInvoke($action)
  }
}

if ($null -ne $context) {
  $workspaceValue.Text = $context.WorkspacePath
  $targetValue.Text = $context.PluginDistPath
} else {
  $workspaceValue.Text = 'Unable to read workspace config'
  $targetValue.Text = 'Fix .env or plugin.json first'
  $logBox.Text = $loadError
  $runButton.Enabled = $false
  $openPluginButton.Enabled = $false
}

$openProjectButton.Add_Click({
  Start-Process explorer.exe $scriptDir
})

$openPluginButton.Add_Click({
  if ($null -eq $context) {
    return
  }
  if (-not (Test-Path -LiteralPath $context.PluginDistPath)) {
    [System.Windows.Forms.MessageBox]::Show(
      'Plugin folder does not exist yet. Run a build first.',
      'Drawnix Plugin Builder',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
    return
  }
  Start-Process explorer.exe $context.PluginDistPath
})

$runButton.Add_Click({
  if ($null -eq $context) {
    return
  }

  if ($null -ne $currentProcess -and -not $currentProcess.HasExited) {
    return
  }

  $logBox.Clear()
  $statusLabel.Text = 'Status: building'
  $progressBar.Style = 'Marquee'
  $runButton.Enabled = $false
  $openPluginButton.Enabled = $false
  $openProjectButton.Enabled = $false
  $logBox.AppendText("Preparing build..." + [Environment]::NewLine)

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = New-Object System.Diagnostics.ProcessStartInfo
  $process.StartInfo.FileName = $powershellPath
  $process.StartInfo.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$buildScriptPath`""
  $process.StartInfo.WorkingDirectory = $scriptDir
  $process.StartInfo.UseShellExecute = $false
  $process.StartInfo.CreateNoWindow = $true
  $process.StartInfo.RedirectStandardOutput = $true
  $process.StartInfo.RedirectStandardError = $true
  $process.EnableRaisingEvents = $true

  $process.add_OutputDataReceived({
    param($sender, $eventArgs)
    if (-not [string]::IsNullOrWhiteSpace($eventArgs.Data)) {
      & $appendLog $eventArgs.Data
    }
  })

  $process.add_ErrorDataReceived({
    param($sender, $eventArgs)
    if (-not [string]::IsNullOrWhiteSpace($eventArgs.Data)) {
      & $appendLog $eventArgs.Data
    }
  })

  $process.add_Exited({
    param($sender, $eventArgs)
    & $onProcessExit $sender
  })

  $currentProcess = $process
  try {
    $process.Start() | Out-Null
    $process.BeginOutputReadLine()
    $process.BeginErrorReadLine()
  } catch {
    $currentProcess = $null
    $statusLabel.Text = 'Status: failed to start build'
    $progressBar.Style = 'Blocks'
    $runButton.Enabled = $true
    $openPluginButton.Enabled = $true
    $openProjectButton.Enabled = $true
    $logBox.AppendText('Unable to start the build process.' + [Environment]::NewLine)
    $logBox.AppendText($_.Exception.Message + [Environment]::NewLine)
  }
})

$form.Add_FormClosing({
  if ($null -ne $currentProcess -and -not $currentProcess.HasExited) {
    try {
      $currentProcess.Kill()
    } catch {
    }
  }
})

$form.Controls.AddRange(@(
    $titleLabel,
    $summaryLabel,
    $workspaceCaption,
    $workspaceValue,
    $targetCaption,
    $targetValue,
    $runButton,
    $openPluginButton,
    $openProjectButton,
    $statusLabel,
    $progressBar,
    $logBox
  ))

[void] $form.ShowDialog()
