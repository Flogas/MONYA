import asyncio
import random
import requests
import os
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()

BACKEND_URL = os.getenv("BACKEND_URL", "http://backend:8000")
energy_totals = {1: 1234.56, 2: 987.34, 3: 1567.89}  # отдельно для каждого прибора

async def simulate_meter():
    print("Виртуальный счётчик MONYA запущен (отправляет данные на ВСЕ 3 прибора)")
    
    device_cycle = [1, 2, 3]
    idx = 0

    while True:
        device_id = device_cycle[idx]
        idx = (idx + 1) % 3

        voltage = round(random.uniform(218, 242), 2)
        current = round(random.uniform(8, 48), 2)
        active_power = round(voltage * current * 0.85 / 1000, 3)
        reactive_power = round(active_power * 0.55, 3)
        
        energy_totals[device_id] = round(energy_totals[device_id] + active_power * (5/3600), 3)

        payload = {
            "device_id": device_id,
            "voltage": voltage,
            "current": current,
            "active_power": active_power,
            "reactive_power": reactive_power,
            "energy_total": energy_totals[device_id]
        }

        try:
            r = requests.post(f"{BACKEND_URL}/api/measurements", json=payload, timeout=5)
            if r.status_code == 200:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] Прибор {device_id} → {active_power} кВт")
            else:
                print(f"Ошибка {r.status_code} для прибора {device_id}")
        except Exception as e:
            print(f"Не удалось отправить (прибор {device_id}): {e}")

        await asyncio.sleep(5)   # каждые 5 секунд — данные на следующий прибор

if __name__ == "__main__":
    asyncio.run(simulate_meter())
