$ConfigPath = "$env:APPDATA\Claude\claude_desktop_config.json"
$ConfigDir = Split-Path $ConfigPath
$ProjectDir = (Get-Location).Path

# Ensure directory exists
if (-not (Test-Path $ConfigDir)) {
    New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
}

# Load existing config or create new
if (Test-Path $ConfigPath) {
    $Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
} else {
    $Config = @{ mcpServers = @{} }
}

if (-not $Config.mcpServers) {
    $Config | Add-Member -NotePropertyName mcpServers -NotePropertyValue @{}
}

# Add consflow-planner server
$ServerConfig = @{
    command = "npx.cmd"
    args = @("tsx", "$ProjectDir\src\mcp\server.ts")
    env = @{
        # Ensure it can pick up node and npm from PATH
        PATH = $env:PATH
    }
}

# The tsx runner will load .env from $ProjectDir if we set CWD, but Claude doesn't have a generic CWD setting.
# So we pass --cwd to npm/npx or pass absolute path to dotenv/config.
# Better: Just run it with absolute paths. The tsx command inside will run in the user's home dir by default.
# To ensure dotenv loads from the correct dir, we can set the env variable or just execute from the directory.

# We'll use a small trick: run a powershell command that cds and then runs it.
$ServerConfig.command = "powershell.exe"
$ServerConfig.args = @("-Command", "cd '$ProjectDir'; npx.cmd tsx src/mcp/server.ts")

$Config.mcpServers."consflow-planner" = $ServerConfig

$Config | ConvertTo-Json -Depth 10 | Set-Content $ConfigPath

Write-Host "✅ Successfully installed consflow-planner MCP server to Claude Desktop!"
Write-Host "Restart Claude Desktop to apply changes."
