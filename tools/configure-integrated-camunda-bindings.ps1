$ErrorActionPreference = 'Stop'
$path = Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) 'models') '00-integrated-hospital-patient-administration.bpmn'
$gatewayDefaults = @{
  R_DocumentsComplete = 'F_Docs_No'; R_Decision = 'F_Referral_Reject'; R_Availability = 'F_Slot_No';
  T_Authorised = 'F_Treatment_Invalid'; T_PaymentNeeded = 'F_Payment_Required'; T_PaymentOutcome = 'F_Payment_Investigate';
  Q_Type = 'F_Enquiry_Clinical'; R_PhoneNeeded = 'F_Phone_Yes'
}
[xml]$document = Get-Content -LiteralPath $path -Raw
$ns = [System.Xml.XmlNamespaceManager]::new($document.NameTable); $ns.AddNamespace('bpmn','http://www.omg.org/spec/BPMN/20100524/MODEL'); $ns.AddNamespace('zeebe','http://camunda.org/schema/zeebe/1.0')
foreach($form in $document.SelectNodes('//bpmn:userTask/bpmn:extensionElements/zeebe:formDefinition',$ns)) { $form.SetAttribute('bindingType','latest') }
foreach($pair in $gatewayDefaults.GetEnumerator()) { $gateway = $document.SelectSingleNode("//bpmn:exclusiveGateway[@id='$($pair.Key)']",$ns); if(-not $gateway){throw "Gateway $($pair.Key) was not found"}; $gateway.SetAttribute('default',$pair.Value) }
$settings = [System.Xml.XmlWriterSettings]::new(); $settings.Indent=$true; $settings.Encoding=[System.Text.UTF8Encoding]::new($false); $writer=[System.Xml.XmlWriter]::Create($path,$settings); $document.Save($writer); $writer.Close(); Write-Output 'Set 22 form bindings to latest and configured 8 safe gateway defaults.'
