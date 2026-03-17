# GridForge FastAPI Quick Start (Windows PowerShell)
# Usage: .\start-fastapi.ps1

param(
    [string]$Mode = "dev"  # "dev" or "docker"
)

Write-Host "🚀 GridForge FastAPI" -ForegroundColor Green
Write-Host "=" * 50

# Check if Python is installed
$pythonPath = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonPath) {
    Write-Host "❌ Python not found. Install Python 3.11+ from https://python.org" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Python found: $($pythonPath.Source)" -ForegroundColor Green

if ($Mode -eq "docker") {
    Write-Host "`n🐳 Starting Docker services..." -ForegroundColor Cyan
    docker-compose up --build
} else {
    Write-Host "`n📦 Setting up development environment..." -ForegroundColor Cyan
    
    # Create venv if not exists
    if (-not (Test-Path "venv")) {
        Write-Host "`n📁 Creating Python virtual environment..."
        python -m venv venv
        if ($LASTEXITCODE -ne 0) {
            Write-Host "❌ Failed to create virtual environment" -ForegroundColor Red
            exit 1
        }
    }
    
    # Activate venv and install dependencies
    Write-Host "`n📚 Installing dependencies..."
    & .\venv\Scripts\Activate.ps1
    pip install --upgrade pip
    pip install -r requirements.txt
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Failed to install Python dependencies" -ForegroundColor Red
        exit 1
    }
    
    # Check PostgreSQL
    $pgPort = Test-NetConnection -ComputerName localhost -Port 5432 -InformationLevel Quiet
    if (-not $pgPort) {
        Write-Host "`n🐘 PostgreSQL not running on localhost:5432" -ForegroundColor Yellow
        Write-Host "   Starting PostgreSQL in Docker..." -ForegroundColor Cyan
        docker run -d `
            --name gridforge-db `
            -e POSTGRES_DB=gridforge `
            -e POSTGRES_USER=gridforge `
            -e POSTGRES_PASSWORD=gridforge123 `
            -p 5432:5432 `
            postgres:15-alpine
        Start-Sleep -Seconds 3
    }
    
    # Start FastAPI server
    Write-Host "`n🚀 Starting FastAPI server..." -ForegroundColor Green
    Write-Host "📖 Swagger UI: http://localhost:8000/docs" -ForegroundColor Cyan
    Write-Host "📖 ReDoc: http://localhost:8000/redoc" -ForegroundColor Cyan
    python server.py
}
