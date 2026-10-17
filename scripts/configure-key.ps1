$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$projectRoot=Split-Path -Parent $PSScriptRoot
$form=New-Object Windows.Forms.Form
$form.Text='邻安养老系统 - 配置 DeepSeek API 密钥'
$form.Size=New-Object Drawing.Size(570,290)
$form.StartPosition='CenterScreen'
$form.FormBorderStyle='FixedDialog'
$form.MaximizeBox=$false
$form.MinimizeBox=$false
$form.Font=New-Object Drawing.Font('Microsoft YaHei UI',10)
$label=New-Object Windows.Forms.Label
$label.Location=New-Object Drawing.Point(24,20)
$label.Size=New-Object Drawing.Size(510,65)
$label.Text="请粘贴你在 DeepSeek 创建的 API Key。`r`n支持 Ctrl+V 或右键粘贴，成功输入后会显示圆点。`r`n密钥只保存在本机项目的 .env 中；保存时不会调用模型。"
$box=New-Object Windows.Forms.TextBox
$box.Location=New-Object Drawing.Point(26,95)
$box.Size=New-Object Drawing.Size(500,32)
$box.UseSystemPasswordChar=$true
$box.ShortcutsEnabled=$true
$box.MaxLength=500
$menu=New-Object Windows.Forms.ContextMenuStrip
$paste=$menu.Items.Add('粘贴')
$paste.Add_Click({$box.Paste()})
$box.ContextMenuStrip=$menu
$hint=New-Object Windows.Forms.Label
$hint.Location=New-Object Drawing.Point(26,133)
$hint.Size=New-Object Drawing.Size(500,25)
$hint.ForeColor=[Drawing.Color]::FromArgb(70,100,90)
$hint.Text='尚未输入'
$box.Add_TextChanged({$hint.Text=if($box.TextLength -gt 0){'已输入 '+$box.TextLength+' 个字符，点击“保存密钥”。'}else{'尚未输入'}})
$save=New-Object Windows.Forms.Button
$save.Location=New-Object Drawing.Point(320,177)
$save.Size=New-Object Drawing.Size(100,36)
$save.Text='保存密钥'
$cancel=New-Object Windows.Forms.Button
$cancel.Location=New-Object Drawing.Point(430,177)
$cancel.Size=New-Object Drawing.Size(95,36)
$cancel.Text='取消'
$cancel.Add_Click({$form.Close()})
$save.Add_Click({
  $keyValue=$box.Text.Trim()
  if($keyValue.Length -lt 12 -or $keyValue -match '\s'){
    [Windows.Forms.MessageBox]::Show('密钥为空或格式不正确，请重新粘贴完整密钥。','尚未保存') | Out-Null
    return
  }
  $child=$null
  try {
    $nodeExecutable=(Get-Command node -ErrorAction Stop).Source
    $startInfo=New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName=$nodeExecutable
    $startInfo.Arguments='"'+(Join-Path $PSScriptRoot 'configure-key.js')+'"'
    $startInfo.WorkingDirectory=$projectRoot
    $startInfo.UseShellExecute=$false
    $startInfo.CreateNoWindow=$true
    $startInfo.RedirectStandardInput=$true
    $startInfo.RedirectStandardOutput=$true
    $startInfo.RedirectStandardError=$true
    $startInfo.StandardOutputEncoding=[Text.Encoding]::UTF8
    $startInfo.StandardErrorEncoding=[Text.Encoding]::UTF8
    $child=New-Object Diagnostics.Process
    $child.StartInfo=$startInfo
    [void]$child.Start()
    $child.StandardInput.WriteLine($keyValue)
    $child.StandardInput.Close()
    if(-not $child.WaitForExit(10000)){ $child.Kill(); throw '保存超时，请重试。' }
    if($child.ExitCode -ne 0){throw '保存失败，请先运行启动系统.bat，确认本地 .env 已创建。'}
    $box.Clear()
    [Windows.Forms.MessageBox]::Show('密钥已保存到本地配置。请重新启动系统使配置生效。','保存成功') | Out-Null
    $form.Close()
  } catch {
    [Windows.Forms.MessageBox]::Show($_.Exception.Message,'未保存成功') | Out-Null
  } finally { $keyValue=$null; if($child){$child.Dispose()} }
})
$form.Controls.AddRange(@($label,$box,$hint,$save,$cancel))
$form.AcceptButton=$save
$form.CancelButton=$cancel
$form.Add_Shown({$box.Focus()})
[void]$form.ShowDialog()
$form.Dispose()