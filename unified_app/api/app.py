"""
FastAPI application setup and middleware configuration
"""
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

# Create FastAPI app
app = FastAPI(title="Unified Camera App", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SocketIOIgnoreMiddleware(BaseHTTPMiddleware):
    """Middleware to ignore Socket.IO requests (return 404 instead of 403)"""
    async def dispatch(self, request: Request, call_next):
        if request.url.path.startswith("/socket.io/"):
            return Response(status_code=404, content="Socket.IO not supported")
        return await call_next(request)


app.add_middleware(SocketIOIgnoreMiddleware)


# Import and register all routers
from .routes import (
    camera_router,
    recording_router,
    video_router,
    timelapse_router,
    cleanup_router,
    config_router
)

app.include_router(camera_router)
app.include_router(recording_router)
app.include_router(video_router)
app.include_router(timelapse_router)
app.include_router(cleanup_router)
app.include_router(config_router)


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "unified-camera-app",
        "version": "1.0.0"
    }
