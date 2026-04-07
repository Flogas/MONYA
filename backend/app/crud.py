from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import insert, select
from . import models

async def create_measurement(db: AsyncSession, measurement: dict):
    stmt = insert(models.Measurement).values(**measurement).returning(models.Measurement.id)
    result = await db.execute(stmt)
    await db.commit()
    return result.scalar_one()