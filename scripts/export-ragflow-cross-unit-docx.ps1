param(
    [string]$WorkRoot = (Join-Path $PSScriptRoot '..\.ragflow-work\english-shadow-v1')
)

$ErrorActionPreference = 'Stop'
$resolvedWorkRoot = [System.IO.Path]::GetFullPath($WorkRoot)
$audit = Get-Content -Raw -LiteralPath (Join-Path $resolvedWorkRoot 'source-audit.json') | ConvertFrom-Json
$outputDirectory = Join-Path $resolvedWorkRoot 'analysis-pdf'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$candidateIds = @(
    '43cff4027b8c11f1b1eacb449d41f0c3',
    '444550f87b8c11f1b1eacb449d41f0c3',
    '5877b70a7b8c11f1b1eacb449d41f0c3',
    '58dd3cce7b8c11f1b1eacb449d41f0c3'
)
$entries = @($audit.entries | Where-Object { $candidateIds -contains $_.documentId })
if ($entries.Count -ne $candidateIds.Count) {
    throw "跨单元 DOCX 数量异常：期望 $($candidateIds.Count)，实际 $($entries.Count)。"
}

$word = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $word.AutomationSecurity = 3
    foreach ($entry in $entries) {
        $sourcePath = Join-Path $resolvedWorkRoot $entry.localFile
        $targetPath = Join-Path $outputDirectory "$($entry.documentId).pdf"
        $document = $null
        try {
            $document = $word.Documents.Open($sourcePath, $false, $true, $false)
            # wdExportFormatPDF=17；这里只生成分页分析副本，不改变源 DOCX。
            $document.ExportAsFixedFormat($targetPath, 17)
            Write-Host "已导出分析 PDF：$($entry.documentName)"
        }
        finally {
            if ($document) { $document.Close($false) }
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

Write-Host "跨单元 DOCX 分页分析副本已生成：$($entries.Count) 份。"
