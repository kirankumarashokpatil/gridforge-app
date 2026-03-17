#!/usr/bin/env python3
"""
Quick setup script for FastAPI development environment
"""

import subprocess
import sys
import os

def run_command(cmd, description):
    """Run shell command with error handling"""
    print(f"\n🔄 {description}...")
    result = subprocess.run(cmd, shell=True)
    if result.returncode != 0:
        print(f"❌ Failed: {description}")
        sys.exit(1)
    print(f"✅ {description}")

def main():
    """Setup development environment"""
    print("🚀 GridForge FastAPI Setup")
    print("=" * 50)
    
    # Create virtual environment
    run_command("python -m venv venv", "Creating Python virtual environment")
    
    # Activate virtual environment
    activate_cmd = "venv\\Scripts\\activate" if sys.platform == "win32" else "source venv/bin/activate"
    
    # Install dependencies
    pip_cmd = "venv\\Scripts\\pip" if sys.platform == "win32" else "venv/bin/pip"
    run_command(f"{pip_cmd} install -r requirements.txt", "Installing Python dependencies")
    
    # Install Node dependencies for frontend
    run_command("npm install", "Installing Node.js dependencies")
    
    print("\n" + "=" * 50)
    print("✅ Setup complete!")
    print("\n📝 Next steps:")
    print("1. Start PostgreSQL (locally or via Docker)")
    print("2. Run the FastAPI server:")
    print(f"   {activate_cmd} && python server.py")
    print("3. In another terminal, start the frontend:")
    print("   npm run dev")
    print("\n🌐 Open http://localhost:5173 in your browser")

if __name__ == "__main__":
    main()
