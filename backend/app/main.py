from fastapi import FastAPI, Depends, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, insert, desc
from .database import get_db, engine
from . import models, schemas, crud
import asyncio
import json
from datetime import datetime

app = FastAPI(title="АСКУЭ MONYA")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

active_connections = []

@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)

    async for db in get_db():
        # Создаём 3 прибора, если их нет
        for i in range(1, 4):
            result = await db.execute(select(models.Device).where(models.Device.id == i))
            if not result.scalar_one_or_none():
                await db.execute(insert(models.Device).values(
                    id=i,
                    name=f"MONYA-00{i}",
                    location=f"ЛЭТИ, лаборатория {i}",
                    status="online"
                ))
                await db.commit()
                print(f"✅ Создан прибор MONYA-00{i}")
        break
    print("✅ База данных готова")

# ================== API ==================
@app.get("/api/devices")
async def get_devices(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Device))
    return result.scalars().all()

@app.get("/api/measurements")
async def get_measurements(device_id: int = 1, limit: int = 50, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.Measurement)
        .where(models.Measurement.device_id == device_id)
        .order_by(desc(models.Measurement.timestamp))
        .limit(limit)
    )
    return result.scalars().all()

@app.post("/api/measurements")
async def add_measurement(data: schemas.MeasurementCreate, db: AsyncSession = Depends(get_db)):
    measurement_dict = data.model_dump()
    measurement_id = await crud.create_measurement(db, measurement_dict)

    measurement_dict["id"] = measurement_id
    measurement_dict["timestamp"] = datetime.utcnow().isoformat()

    # Отправляем по WebSocket
    message = json.dumps(measurement_dict)
    for conn in active_connections[:]:
        try:
            await conn.send_text(message)
        except:
            active_connections.remove(conn)

    return {"status": "ok"}

@app.get("/api/events")
async def get_events(device_id: int = 1, limit: int = 30, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.Event)
        .where(models.Event.device_id == device_id)
        .order_by(desc(models.Event.timestamp))
        .limit(limit)
    )
    return result.scalars().all()

@app.get("/api/anomalies")
async def get_anomalies(device_id: int = 1, limit: int = 20, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.Anomaly)
        .where(models.Anomaly.device_id == device_id)
        .order_by(desc(models.Anomaly.timestamp))
        .limit(limit)
    )
    return result.scalars().all()

# ================== WEBSOCKET ==================
@app.websocket("/ws/live")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    print(f"🔌 Новый клиент WebSocket подключился ({len(active_connections)} клиентов)")
    try:
        while True:
            await asyncio.sleep(60)
    except WebSocketDisconnect:
        active_connections.remove(websocket)

@app.get("/health")
async def health():
    return {
        "status": "running",
        "time": datetime.utcnow().isoformat(),
        "active_connections": len(active_connections)
    }