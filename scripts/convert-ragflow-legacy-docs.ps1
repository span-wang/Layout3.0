param(
    [string]$WorkRoot = (Join-Path $PSScriptRoot '..\.ragflow-work\english-shadow-v1')
)

$ErrorActionPreference = 'Stop'
$resolvedWorkRoot = [System.IO.Path]::GetFullPath($WorkRoot)
$sourceAuditPath = Join-Path $resolvedWorkRoot 'source-audit.json'
$convertedDirectory = Join-Path $resolvedWorkRoot 'converted-docx'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$reportDirectory = Join-Path $projectRoot 'evaluation\ragflow\data-cleaning'
$reportPath = Join-Path $reportDirectory 'english-doc-conversion.v1.json'

if (-not (Test-Path -LiteralPath $sourceAuditPath)) {
    throw "未找到源审计文件：$sourceAuditPath"
}

$audit = Get-Content -Raw -LiteralPath $sourceAuditPath | ConvertFrom-Json
$legacyEntries = @($audit.entries | Where-Object { $_.documentName -match '\.doc$' })
if ($legacyEntries.Count -ne 22) {
    throw "旧 DOC 数量异常：期望 22 份，实际 $($legacyEntries.Count) 份。"
}

New-Item -ItemType Directory -Force -Path $convertedDirectory, $reportDirectory | Out-Null
$word = $null
$results = [System.Collections.Generic.List[object]]::new()

try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    # 禁止源文档中的宏运行，清洗过程只读取内容并另存副本。
    $word.AutomationSecurity = 3

    for ($index = 0; $index -lt $legacyEntries.Count; $index++) {
        $entry = $legacyEntries[$index]
        $sourcePath = Join-Path $resolvedWorkRoot $entry.localFile
        $sourceBaseName = [System.IO.Path]::GetFileNameWithoutExtension($sourcePath)
        $targetPath = Join-Path $convertedDirectory "$sourceBaseName.docx"
        $document = $null
        $verificationDocument = $null
        try {
            if (-not (Test-Path -LiteralPath $sourcePath)) {
                throw "源文件不存在：$sourcePath"
            }

            $document = $word.Documents.Open($sourcePath, $false, $true, $false)
            $sourceTextLength = $document.Content.Text.Trim().Length
            if ($sourceTextLength -eq 0) {
                throw '源 DOC 正文为空。'
            }
            # wdFormatXMLDocument=12；另存到独立目录，不修改下载的原始 DOC。
            $document.SaveAs2($targetPath, 12)
            $document.Close($false)
            $document = $null

            $verificationDocument = $word.Documents.Open($targetPath, $false, $true, $false)
            $convertedTextLength = $verificationDocument.Content.Text.Trim().Length
            $verificationDocument.Close($false)
            $verificationDocument = $null
            if ($convertedTextLength -eq 0) {
                throw '转换后的 DOCX 正文为空。'
            }

            $targetFile = Get-Item -LiteralPath $targetPath
            $results.Add([ordered]@{
                documentId = $entry.documentId
                sourceName = $entry.documentName
                sourceSha256 = $entry.sha256
                outputFile = "converted-docx/$($targetFile.Name)"
                outputSize = $targetFile.Length
                outputSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $targetPath).Hash.ToLowerInvariant()
                sourceTextLength = $sourceTextLength
                convertedTextLength = $convertedTextLength
                status = 'converted'
                error = $null
            })
            Write-Host "[$($index + 1)/22] 已转换：$($entry.documentName)"
        }
        catch {
            if ($verificationDocument) { $verificationDocument.Close($false) }
            if ($document) { $document.Close($false) }
            $results.Add([ordered]@{
                documentId = $entry.documentId
                sourceName = $entry.documentName
                sourceSha256 = $entry.sha256
                outputFile = $null
                outputSize = 0
                outputSha256 = $null
                sourceTextLength = 0
                convertedTextLength = 0
                status = 'failed'
                error = $_.Exception.Message
            })
            Write-Warning "[$($index + 1)/22] 转换失败：$($entry.documentName)：$($_.Exception.Message)"
        }
    }
}
finally {
    if ($word) {
        $word.Quit()
        [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($word)
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

$failed = @($results | Where-Object status -eq 'failed')
$report = [ordered]@{
    schemaVersion = 1
    taskId = 'PH3-12-data-cleaning-shadow-kb-v1'
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    sourceCount = $legacyEntries.Count
    convertedCount = @($results | Where-Object status -eq 'converted').Count
    failedCount = $failed.Count
    originalFilesModified = $false
    entries = $results
}
$report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $reportPath -Encoding utf8

if ($failed.Count -gt 0) {
    throw "旧 DOC 转换未全部通过：失败 $($failed.Count) 份。详见 $reportPath"
}

Write-Host "旧 DOC 转换完成：22/22，原文件未修改。"
