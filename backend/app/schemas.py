from pydantic import BaseModel
from datetime import datetime

class MeasurementCreate(BaseModel):
    device_id: int
    voltage: float
    current: float
    active_power: float
    reactive_power: float
    energy_total: float

class MeasurementResponse(MeasurementCreate):
    id: int
    timestamp: datetime

    class Config:
        from_attributes = True