<#
.SYNOPSIS
  Joins the authored world fragments in src/ into the single self-contained
  index.html the scene actually runs on.

.DESCRIPTION
  Why this exists: index.html is a build artifact, not a source file. Writing a
  scene of ~46k blocks and ~2k lines of JavaScript in one pass is how renders go
  wrong invisibly, so the aerie is authored in numbered fragments, one per piece
  of the build, and joined here.

  The fragments are not standalone modules. Fragment 01 opens the HTML document
  and the module script tag; the fragments after it are consecutive bodies of
  that one script. That is why the closing tags are appended here instead of
  living in the last fragment, and why the order matters: a fragment that calls
  a function must come after the fragment that defines it. The numeric prefixes
  are the order, so keep them in step.

  The suffix is deliberately not .js. None of these fragments can be parsed on
  their own, and a .js extension invites an editor or a bundler to disagree with
  us about that.

.PARAMETER Check
  Also extract the module body and run `node --check` on it. Cheap syntax gate,
  worth running before committing - a stray brace otherwise shows up as a blank
  page with a console error nobody bothers to open.

.EXAMPLE
  .\build.ps1
  .\build.ps1 -Check
#>

[CmdletBinding()]
param(
  [switch]$Check
)

$ErrorActionPreference = 'Stop'

$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$srcDir  = Join-Path $here 'src'
$outFile = Join-Path $here 'index.html'

$fragments = Get-ChildItem -LiteralPath $srcDir -Filter '*.txt' | Sort-Object Name
if (-not $fragments) {
  throw "No fragments found in $srcDir - nothing to build."
}

# UTF-8 without a BOM: a BOM in front of <script> breaks module parsing.
$noBom = [System.Text.UTF8Encoding]::new($false)

$parts = foreach ($f in $fragments) {
  [System.IO.File]::ReadAllText($f.FullName).TrimEnd("`r", "`n")
}

# LF join, so the built file is byte-identical on every platform. The
# .gitattributes rule for *.html pins the checked-out copy to LF as well.
$text = ($parts -join "`n") + "`n</script>`n</body>`n</html>`n"

[System.IO.File]::WriteAllText($outFile, $text, $noBom)

"Built {0}  {1} bytes  from {2} fragments." -f (Split-Path -Leaf $outFile), `
  (Get-Item -LiteralPath $outFile).Length, $fragments.Count

if ($Check) {
  $match = [regex]::Match($text, '(?s)<script type="module">(.*?)</script>')
  if (-not $match.Success) {
    throw 'Could not find the module script body in the built document.'
  }
  $module = $match.Groups[1].Value

  $probe = Join-Path ([System.IO.Path]::GetTempPath()) 'dragon-rider-aerie-syntax.mjs'
  [System.IO.File]::WriteAllText($probe, $module, $noBom)

  & node --check $probe
  if ($LASTEXITCODE -ne 0) {
    throw "node --check rejected the module body: $probe"
  }
  "Syntax gate passed on the module body ($([int]$module.Length) chars)."
}
