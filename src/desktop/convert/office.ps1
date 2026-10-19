# Drives Word / Excel / PowerPoint through COM to convert one file.
# Called by office.js with -File, so paths arrive as plain arguments (never parsed as code).
param(
  [Parameter(Mandatory)][ValidateSet('word', 'excel', 'powerpoint')][string]$App,
  [Parameter(Mandatory)][string]$In,
  [Parameter(Mandatory)][string]$Out,
  [Parameter(Mandatory)][string]$To,
  [string]$From = ''
)
$ErrorActionPreference = 'Stop'
$missing = [Type]::Missing
# A dummy password makes protected files fail fast instead of opening a hidden prompt.
$noPassword = 'easy-convert-no-password'

# Report the PID of an Office process we start ourselves, so the caller can kill it if it hangs.
function Start-Office([string]$progId, [string]$exe) {
  $before = @(Get-Process $exe -ErrorAction SilentlyContinue | ForEach-Object Id)
  $app = New-Object -ComObject $progId
  $mine = @(Get-Process $exe -ErrorAction SilentlyContinue | Where-Object { $before -notcontains $_.Id } | ForEach-Object Id)
  if ($mine.Count -eq 1) { [Console]::Out.WriteLine("PID:$($mine[0])"); [Console]::Out.Flush() }
  return $app
}

function Release($o) {
  if ($null -ne $o) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($o) } catch {} }
}

switch ($App) {
  'word' {
    $word = Start-Office 'Word.Application' 'WINWORD'
    # If the user already has Word open we share their instance: never quit it.
    $shared = $word.Documents.Count -gt 0
    $doc = $null
    try {
      $word.Visible = $false
      $word.DisplayAlerts = 0
      $word.ScreenUpdating = $false
      # FileName, ConfirmConversions, ReadOnly, AddToRecentFiles, PasswordDocument
      $doc = $word.Documents.Open($In, $false, $true, $false, $noPassword)

      if ($From -eq 'html') {
        # Make tables fit the page and embed linked pictures so the file stands alone.
        foreach ($t in $doc.Tables) { try { $t.AutoFitBehavior(2) } catch {} }
        foreach ($s in $doc.InlineShapes) {
          try { if ($s.LinkFormat) { $s.LinkFormat.SavePictureWithDocument = $true; $s.LinkFormat.BreakLink() } } catch {}
        }
        try { $doc.ActiveWindow.View.Type = 3 } catch {}
      }

      switch ($To) {
        'pdf' {
          # OutputFileName, ExportFormat=PDF, OpenAfterExport, OptimizeFor=Print, Range=All, From, To,
          # Item=Content, IncludeDocProps, KeepIRM, CreateBookmarks=Headings, DocStructureTags, BitmapMissingFonts, PDF/A
          $doc.ExportAsFixedFormat($Out, 17, $false, 0, 0, 1, 1, 0, $true, $true, 1, $true, $true, $false)
        }
        'xps' { $doc.ExportAsFixedFormat($Out, 18) }
        'txt' {
          # wdFormatText with UTF-8 encoding (12th SaveAs2 argument).
          $doc.SaveAs2($Out, 2, $missing, $missing, $false, $missing, $missing, $missing, $missing, $missing, $missing, 65001)
        }
        default {
          $fmt = @{ docx = 16; doc = 0; rtf = 6; odt = 23; html = 10 }[$To]
          if ($null -eq $fmt) { throw "Word can't save as $To" }
          $doc.SaveAs2($Out, $fmt, $missing, $missing, $false)
        }
      }
    } finally {
      if ($doc) { try { $doc.Close(0) } catch {} ; Release $doc }
      if (-not $shared) { try { $word.Quit(0) } catch {} }
      Release $word
    }
  }

  'excel' {
    $xl = Start-Office 'Excel.Application' 'EXCEL'
    $shared = $xl.Workbooks.Count -gt 0
    $wb = $null
    try {
      $xl.Visible = $false
      $xl.DisplayAlerts = $false
      $xl.ScreenUpdating = $false
      $xl.AskToUpdateLinks = $false
      $xl.EnableEvents = $false
      # FileName, UpdateLinks=never, ReadOnly, Format, Password
      $wb = $xl.Workbooks.Open($In, 0, $true, $missing, $noPassword)

      switch ($To) {
        { $_ -in 'pdf', 'xps' } {
          # Fit every sheet to one page wide so columns aren't split across pages.
          try { $xl.PrintCommunication = $false } catch {}
          foreach ($ws in $wb.Worksheets) {
            try {
              $ps = $ws.PageSetup
              $ps.Zoom = $false
              $ps.FitToPagesWide = 1
              $ps.FitToPagesTall = $false
              if ($ws.UsedRange.Columns.Count -gt 7) { $ps.Orientation = 2 }
            } catch {}
          }
          try { $xl.PrintCommunication = $true } catch {}
          $type = if ($To -eq 'pdf') { 0 } else { 1 }
          # Type, Filename, Quality=Standard, IncludeDocProperties, IgnorePrintAreas
          $wb.ExportAsFixedFormat($type, $Out, 0, $true, $false)
        }
        'html' {
          # Publish every non-empty sheet into one static HTML file, keeping cell formatting.
          $first = $true
          foreach ($ws in $wb.Worksheets) {
            if ($xl.WorksheetFunction.CountA($ws.UsedRange) -eq 0) { continue }
            # SourceType=Sheet, Filename, Sheet, Source, HtmlType=Static, DivID, Title
            $po = $wb.PublishObjects.Add(1, $Out, $ws.Name, '', 0, '', $ws.Name)
            $po.Publish($first)
            $first = $false
            Release $po
          }
          if ($first) { throw 'The workbook is empty' }
        }
        default {
          $fmt = @{ xlsx = 51; xls = 56; ods = 60 }[$To]
          if ($null -eq $fmt) { throw "Excel can't save as $To" }
          $wb.SaveAs($Out, $fmt)
        }
      }
    } finally {
      if ($wb) { try { $wb.Close($false) } catch {} ; Release $wb }
      if (-not $shared) { try { $xl.Quit() } catch {} }
      Release $xl
    }
  }

  'powerpoint' {
    $pp = Start-Office 'PowerPoint.Application' 'POWERPNT'
    $shared = $pp.Presentations.Count -gt 0
    $pres = $null
    try {
      # FileName, ReadOnly=msoTrue, Untitled=msoFalse, WithWindow=msoFalse
      $pres = $pp.Presentations.Open($In, -1, 0, 0)
      switch ($To) {
        { $_ -in 'png', 'jpg' } {
          # $Out is a folder; one image per slide at 1920px wide.
          New-Item -ItemType Directory -Force -Path $Out | Out-Null
          $w = 1920
          $h = [int]([double]$pres.PageSetup.SlideHeight / [double]$pres.PageSetup.SlideWidth * $w)
          $filter = if ($To -eq 'png') { 'PNG' } else { 'JPG' }
          $i = 1
          foreach ($slide in $pres.Slides) {
            $slide.Export((Join-Path $Out ('slide-{0:D3}.{1}' -f $i, $To)), $filter, $w, $h)
            Release $slide
            $i++
          }
        }
        'mp4' {
          # FileName, UseTimingsAndNarrations, DefaultSlideDuration, VertResolution, FramesPerSecond, Quality
          $pres.CreateVideo($Out, $true, 4, 1080, 30, 85)
          while ($pres.CreateVideoStatus -in 1, 2) { Start-Sleep -Milliseconds 500 }
          if ($pres.CreateVideoStatus -ne 3) { throw 'PowerPoint could not export the video' }
        }
        default {
          $fmt = @{ pdf = 32; pptx = 24; ppt = 1; odp = 35; xps = 33 }[$To]
          if ($null -eq $fmt) { throw "PowerPoint can't save as $To" }
          $pres.SaveAs($Out, $fmt)
        }
      }
    } finally {
      if ($pres) { try { $pres.Close() } catch {} ; Release $pres }
      if (-not $shared) { try { $pp.Quit() } catch {} }
      Release $pp
    }
  }
}

[GC]::Collect()
[GC]::WaitForPendingFinalizers()
Write-Output 'OK'
