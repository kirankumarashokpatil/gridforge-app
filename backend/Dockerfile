# GridForge Backend — FastAPI + Python engine
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies (separate layer for better caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code and engine module
COPY server.py db.py ws.py bus.py room_worker.py room_process.py process_manager.py ./
COPY engine/ ./engine/
COPY routes/ ./routes/

# Expose FastAPI port
EXPOSE 8000

# Run FastAPI with Uvicorn
CMD ["python", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
