from fastapi import FastAPI, Depends, WebSocket, WebSocketDisconnect, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, insert, desc
from .database import get_db, engine
from . import models, schemas, crud
import asyncio
import json
from datetime import datetime, timedelta
import pandas as pd
from io import BytesIO
from sklearn.ensemble import IsolationForest
import numpy as np

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
        for i in [1, 2, 3]:
            if not (await db.execute(select(models.Device).where(models.Device.id == i))).scalar_one_or_none():
                await db.execute(insert(models.Device).values(
                    id=i, 
                    name=f"Виртуальный счётчик MONYA-00{i}", 
                    location=f"ЛЭТИ, лаборатория, прибор {i}", 
                    status="online"
                ))
        await db.commit()

        await db.execute(insert(models.Event).values(
            event_type="INFO", 
            description="Система АСКУЭ MONYA запущена с ML анти-фрод модулем", 
            severity="info"
        ))
        await db.commit()
        print("✅ ML анти-фрод модуль активирован")
        break

# ================== ML АНТИ-ФРОД (борьба с майнингом) ==================
# ================== ML АНТИ-ФРОД (борьба с майнингом) ==================
def detect_mining_anomaly(df: pd.DataFrame) -> list:
    if len(df) < 30:
        return []

    df = df.copy()

    # Вычисляем rolling-статистики
    df["rolling_mean"] = df["active_power"].rolling(window=8, min_periods=1).mean()
    df["rolling_std"] = df["active_power"].rolling(window=8, min_periods=1).std()

    # Заполняем NaN (очень важно!)
    df["rolling_mean"] = df["rolling_mean"].fillna(0)
    df["rolling_std"] = df["rolling_std"].fillna(0)

    # Коэффициент стабильности (чем меньше — тем ровнее график = подозрение на майнинг)
    df["stability"] = df["rolling_std"] / (df["rolling_mean"] + 0.1)

    # Признаки для модели
    features = df[["active_power", "rolling_std", "stability"]]

    # Isolation Forest
    model = IsolationForest(contamination=0.08, random_state=42)
    df["anomaly_score"] = model.fit_predict(features)

    # === Бизнес-правила против майнинга ===
    anomalies = []
    for _, row in df.iterrows():
        power = float(row["active_power"])
        stability = float(row["stability"])
        is_ml_anomaly = row["anomaly_score"] == -1

        if power > 5.0 and stability < 0.18 and is_ml_anomaly:
            anomalies.append({
                "timestamp": row["timestamp"].isoformat(),
                "anomaly_type": "mining_suspect",
                "value": round(power, 3),
                "description": f"🚨 ПОДОЗРЕНИЕ НА МАЙНИНГ: стабильное высокое потребление {power} кВт"
            })
        elif power > 8.0:
            anomalies.append({
                "timestamp": row["timestamp"].isoformat(),
                "anomaly_type": "high_load",
                "value": round(power, 3),
                "description": f"Критическая нагрузка {power} кВт — возможен майнинг или несанкционированное подключение"
            })

    return anomalies

@app.get("/api/anomalies")
async def get_anomalies(device_id: int = 1, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.Measurement)
        .where(models.Measurement.device_id == device_id)
        .order_by(models.Measurement.timestamp)
        .limit(300)
    )
    data = result.scalars().all()
    
    if len(data) < 30:
        return []

    df = pd.DataFrame([{
        "timestamp": m.timestamp,
        "active_power": m.active_power
    } for m in data])

    return detect_mining_anomaly(df)

# ================== Остальные эндпоинты (оставляем без изменений) ==================
@app.get("/api/devices")
async def get_devices(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Device))
    return result.scalars().all()

@app.get("/api/measurements")
async def get_measurements(device_id: int = 1, limit: int = 1000, start: str | None = None, end: str | None = None, db: AsyncSession = Depends(get_db)):
    query = select(models.Measurement).where(models.Measurement.device_id == device_id).order_by(desc(models.Measurement.timestamp))
    if start:
        query = query.where(models.Measurement.timestamp >= datetime.fromisoformat(start.replace("Z", "")))
    if end:
        query = query.where(models.Measurement.timestamp <= datetime.fromisoformat(end.replace("Z", "")))
    result = await db.execute(query.limit(limit))
    return result.scalars().all()

@app.get("/api/events")
async def get_events(device_id: int | None = None, limit: int = 50, db: AsyncSession = Depends(get_db)):
    query = select(models.Event).order_by(desc(models.Event.timestamp)).limit(limit)
    if device_id:
        query = query.where(models.Event.device_id == device_id)
    result = await db.execute(query)
    return result.scalars().all()

@app.get("/api/forecast")
async def get_forecast(device_id: int = 1, db: AsyncSession = Depends(get_db)):
    # Простой прогноз (оставляем как было)
    result = await db.execute(select(models.Measurement).where(models.Measurement.device_id == device_id).order_by(models.Measurement.timestamp).limit(100))
    data = result.scalars().all()
    if len(data) < 30:
        return {"forecast": []}
    df = pd.DataFrame([{"ds": m.timestamp, "y": m.active_power} for m in data])
    X = np.arange(len(df)).reshape(-1, 1)
    y = df["y"].values
    coef = np.polyfit(X.flatten(), y, 1)
    future = np.arange(len(df), len(df) + 24).reshape(-1, 1)
    forecast = np.polyval(coef, future.flatten())
    return {
        "forecast": [
            {"timestamp": (datetime.utcnow() + timedelta(hours=i)).isoformat(), "predicted_power": round(float(val), 3)}
            for i, val in enumerate(forecast)
        ]
    }

# Экспорт (оставляем как было)
@app.get("/api/export/measurements")
async def export_measurements(device_id: int = 1, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Measurement).where(models.Measurement.device_id == device_id).order_by(desc(models.Measurement.timestamp)))
    df = pd.DataFrame([r._mapping for r in result])
    output = BytesIO()
    df.to_excel(output, index=False, engine='openpyxl')
    output.seek(0)
    return Response(content=output.read(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f"attachment; filename=measurements_device_{device_id}.xlsx"})

@app.get("/api/export/events")
async def export_events(device_id: int | None = None, db: AsyncSession = Depends(get_db)):
    query = select(models.Event).order_by(desc(models.Event.timestamp))
    if device_id: query = query.where(models.Event.device_id == device_id)
    result = await db.execute(query)
    df = pd.DataFrame([r._mapping for r in result])
    output = BytesIO()
    df.to_excel(output, index=False, engine='openpyxl')
    output.seek(0)
    return Response(content=output.read(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f"attachment; filename=events.xlsx"})

# POST + WebSocket (улучшенная версия с ML)
@app.post("/api/measurements")
async def add_measurement(data: schemas.MeasurementCreate, db: AsyncSession = Depends(get_db)):
    measurement_dict = data.model_dump()
    measurement_id = await crud.create_measurement(db, measurement_dict)

    # === ML анти-фрод ===
    severity = "info"
    description = f"Данные от прибора {measurement_dict['device_id']}: {measurement_dict['active_power']} кВт"

    if measurement_dict["active_power"] > 8.0:
        severity = "critical"
        description = f"🚨 КРИТИЧЕСКАЯ НАГРУЗКА {measurement_dict['active_power']} кВт — возможен майнинг!"
    elif measurement_dict["active_power"] > 5.0:
        severity = "warning"
        description = f"⚠️ Подозрение на майнинг или несанкционированное подключение: {measurement_dict['active_power']} кВт"

    await db.execute(insert(models.Event).values(
        event_type=severity.upper(),
        description=description,
        severity=severity,
        device_id=measurement_dict['device_id']
    ))
    await db.commit()

    # WebSocket
    measurement_dict["id"] = measurement_id
    measurement_dict["timestamp"] = datetime.utcnow().isoformat()
    message = json.dumps(measurement_dict)
    for conn in active_connections[:]:
        try:
            await conn.send_text(message)
        except:
            active_connections.remove(conn)
    return {"status": "ok"}

@app.websocket("/ws/live")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    try:
        while True:
            await asyncio.sleep(60)
    except WebSocketDisconnect:
        active_connections.remove(websocket)

@app.get("/health")
async def health():
    return {"status": "running"}