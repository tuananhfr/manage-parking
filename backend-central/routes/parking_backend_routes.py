from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import json
import os

router = APIRouter(prefix="/api/parking/backends", tags=["parking-backends"])

PARKING_BACKENDS_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "parking.backends.json")

class ParkingBackend(BaseModel):
    id: str
    name: str
    host: str
    port: int
    description: Optional[str] = ""
    enabled: bool = True

class ParkingBackendUpdate(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    description: Optional[str] = None
    enabled: Optional[bool] = None


def load_parking_backends():
    """Load parking backends from JSON file"""
    if not os.path.exists(PARKING_BACKENDS_FILE):
        return []
    
    try:
        with open(PARKING_BACKENDS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return []


def save_parking_backends(backends):
    """Save parking backends to JSON file"""
    try:
        os.makedirs(os.path.dirname(PARKING_BACKENDS_FILE), exist_ok=True)
        with open(PARKING_BACKENDS_FILE, 'w', encoding='utf-8') as f:
            json.dump(backends, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error saving backends: {e}")


@router.get("/")
async def get_parking_backends():
    """Get all parking backends"""
    try:
        backends = load_parking_backends()
        return {"success": True, "data": backends}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/")
async def add_parking_backend(backend: ParkingBackend):
    """Add new parking backend"""
    backends = load_parking_backends()

    # Check for duplicate ID
    if any(b.get('id') == backend.id for b in backends):
        raise HTTPException(
            status_code=400,
            detail="Backend with this ID already exists"
        )

    new_backend = {
        "id": backend.id,
        "name": backend.name,
        "host": backend.host,
        "port": backend.port,
        "description": backend.description or "",
        "enabled": backend.enabled
    }

    backends.append(new_backend)
    save_parking_backends(backends)

    return {"success": True, "data": new_backend}


@router.delete("/{backend_id}")
async def delete_parking_backend(backend_id: str):
    """Remove parking backend"""
    backends = load_parking_backends()

    filtered = [b for b in backends if b.get('id') != backend_id]

    if len(filtered) == len(backends):
        raise HTTPException(status_code=404, detail="Backend not found")

    save_parking_backends(filtered)
    return {"success": True, "message": "Backend removed successfully"}


@router.put("/{backend_id}")
async def update_parking_backend(backend_id: str, update: ParkingBackendUpdate):
    """Update parking backend"""
    backends = load_parking_backends()

    backend_index = None
    for i, b in enumerate(backends):
        if b.get('id') == backend_id:
            backend_index = i
            break

    if backend_index is None:
        raise HTTPException(status_code=404, detail="Backend not found")

    # Update backend
    backend = backends[backend_index]
    if update.name is not None:
        backend['name'] = update.name
    if update.host is not None:
        backend['host'] = update.host
    if update.port is not None:
        backend['port'] = update.port
    if update.description is not None:
        backend['description'] = update.description
    if update.enabled is not None:
        backend['enabled'] = update.enabled

    backends[backend_index] = backend
    save_parking_backends(backends)

    return {"success": True, "data": backend}
