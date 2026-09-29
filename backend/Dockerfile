# ==============================================================================
# KeyPoints Studio — Backend Dockerfile (Phase 18)
# Python 3.11 with FFmpeg for audio processing and Faster-Whisper CPU execution
# ==============================================================================

FROM python:3.11-slim

# Prevent Python from writing .pyc files and enable unbuffered logging
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install system dependencies: FFmpeg for audio processing and libpq for PostgreSQL
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source code and migrations
COPY . /app/

# Ensure storage directories exist with appropriate permissions
RUN mkdir -p /app/storage/uploads /app/storage/processed /app/tmp && \
    chmod +x /app/entrypoint.sh

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
