param(
  [string]$Title = 'DSH',
  [string]$Body = ''
)
$ErrorActionPreference = 'Stop'
$log = Join-Path $env:USERPROFILE '.dsh\reply-notify.log'
try {
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
  $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
  $texts = $xml.GetElementsByTagName('text')
  $texts.Item(0).AppendChild($xml.CreateTextNode($Title)) | Out-Null
  $texts.Item(1).AppendChild($xml.CreateTextNode($Body)) | Out-Null
  $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('electron.app.DeepSeek Harness').Show($toast)
  Add-Content -Path $log -Value "$(Get-Date -Format o) ps: shown"
} catch {
  Add-Content -Path $log -Value "$(Get-Date -Format o) ps: failed $($_.Exception.Message)"
  exit 1
}
