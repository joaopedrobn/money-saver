param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-z]{20}$')]
  [string]$TestProjectRef
)
$ErrorActionPreference = 'Stop'
if ($TestProjectRef -eq 'iwzmsbkbuerleocismhj') { throw 'Production target is forbidden.' }
if (-not $env:MONEY_SAVER_TEST_DATABASE_URL) { throw 'Set MONEY_SAVER_TEST_DATABASE_URL for a disposable Supabase database outside the repository.' }
$testConnection = $null
if (-not [uri]::TryCreate($env:MONEY_SAVER_TEST_DATABASE_URL, [UriKind]::Absolute, [ref]$testConnection)) { throw 'Invalid disposable database connection URL.' }
if ($testConnection.Scheme -notin @('postgres', 'postgresql')) { throw 'Expected a PostgreSQL connection URL.' }
$testUserInfo = $testConnection.UserInfo.Split(':', 2)
$testUser = [uri]::UnescapeDataString($testUserInfo[0])
$directTarget = $testConnection.Host -eq "db.$TestProjectRef.supabase.co"
$poolerTarget = $testConnection.Host -match '\.pooler\.supabase\.com$' -and $testUser -eq "postgres.$TestProjectRef"
if (-not ($directTarget -or $poolerTarget)) { throw 'Connection endpoint does not match the explicitly selected disposable project.' }
if ($testConnection.Query -or $testConnection.Fragment) { throw 'Use a URL without query or fragment; TLS is enforced by the runner.' }
if ($testUserInfo.Count -ne 2 -or -not $testUserInfo[1]) { throw 'Database credentials must be provided securely in the environment.' }
$testPsql = Get-Command psql -CommandType Application -ErrorAction SilentlyContinue
if (-not $testPsql) { throw 'psql is required for the disposable test environment; it will not be installed automatically.' }
$testSqlPath = Join-Path $PSScriptRoot '..\supabase\tests\isolation.sql'
$testNames = @('PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE','PGCONNECT_TIMEOUT','PGOPTIONS','PGSERVICE','PGSERVICEFILE','PGPASSFILE')
$testPrevious = @{}
foreach ($testName in $testNames) { $testPrevious[$testName] = [Environment]::GetEnvironmentVariable($testName, 'Process') }
try {
  foreach ($testName in $testNames) { [Environment]::SetEnvironmentVariable($testName, $null, 'Process') }
  $env:PGHOST = $testConnection.Host
  $env:PGPORT = if ($testConnection.Port -gt 0) { [string]$testConnection.Port } else { '5432' }
  $env:PGUSER = $testUser
  $env:PGPASSWORD = [uri]::UnescapeDataString($testUserInfo[1])
  $env:PGDATABASE = [uri]::UnescapeDataString($testConnection.AbsolutePath.TrimStart('/'))
  if (-not $env:PGDATABASE) { $env:PGDATABASE = 'postgres' }
  $env:PGSSLMODE = 'verify-full'
  $env:PGCONNECT_TIMEOUT = '15'
  # Credentials are inherited by psql, never printed or passed as command-line arguments.
  & $testPsql.Source --no-psqlrc --no-password -v ON_ERROR_STOP=1 -v "money_saver_disposable_project_ref=$TestProjectRef" -f $testSqlPath
  $testExitCode = $LASTEXITCODE
} finally {
  foreach ($testName in $testNames) { [Environment]::SetEnvironmentVariable($testName, $testPrevious[$testName], 'Process') }
}
exit $testExitCode
