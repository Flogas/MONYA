import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import axios from 'axios';

interface Device { id: number; name: string; location: string; status: string; }
interface Measurement { id: number; timestamp: string; voltage: number; current: number; active_power: number; reactive_power: number; energy_total: number; }
interface Event { id: number; timestamp: string; event_type: string; description: string; severity: string; }
interface Anomaly { id: number; timestamp: string; anomaly_type: string; value: number; description: string; }

function App() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState(1);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [tab, setTab] = useState<'live' | 'events' | 'anomalies'>('live');

  // Загрузка устройств
  const loadDevices = async () => {
    const res = await axios.get('http://localhost:8000/api/devices');
    setDevices(res.data);
  };

  // Загрузка данных выбранного прибора
  const loadData = async () => {
    const [mRes, eRes, aRes] = await Promise.all([
      axios.get(`http://localhost:8000/api/measurements?device_id=${selectedDevice}&limit=50`),
      axios.get(`http://localhost:8000/api/events?device_id=${selectedDevice}&limit=30`),
      axios.get(`http://localhost:8000/api/anomalies?device_id=${selectedDevice}&limit=20`)
    ]);
    setMeasurements(mRes.data);
    setEvents(eRes.data);
    setAnomalies(aRes.data);
  };

  // WebSocket
  useEffect(() => {
    loadDevices();
    loadData();

    const ws = new WebSocket('ws://localhost:8000/ws/live');
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.device_id === selectedDevice) {
        setMeasurements(prev => [...prev.slice(-49), msg]);
      }
    };

    return () => ws.close();
  }, [selectedDevice]);

  const latest = measurements[measurements.length - 1];

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold text-center mb-1">АСКУЭ MONYA</h1>
        <p className="text-center text-emerald-400 mb-6">Система контроля и мониторинга электроэнергии</p>

        {/* Выбор прибора */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {devices.map(dev => (
            <button
              key={dev.id}
              onClick={() => setSelectedDevice(dev.id)}
              className={`px-5 py-2 rounded-xl font-medium transition-all ${selectedDevice === dev.id ? 'bg-emerald-500 text-white shadow-lg' : 'bg-gray-800 hover:bg-gray-700'}`}
            >
              {dev.name} — {dev.location}
            </button>
          ))}
        </div>

        {/* Вкладки */}
        <div className="flex border-b border-gray-700 mb-6">
          <button onClick={() => setTab('live')} className={`px-6 py-3 font-medium ${tab === 'live' ? 'border-b-4 border-emerald-500' : ''}`}>Live</button>
          <button onClick={() => setTab('events')} className={`px-6 py-3 font-medium ${tab === 'events' ? 'border-b-4 border-emerald-500' : ''}`}>События</button>
          <button onClick={() => setTab('anomalies')} className={`px-6 py-3 font-medium ${tab === 'anomalies' ? 'border-b-4 border-emerald-500' : ''}`}>Диагностика</button>
        </div>

        {tab === 'live' && (
          <>
            {latest && (
              <div className="grid grid-cols-4 gap-4 mb-8">
                <div className="bg-gray-800 rounded-2xl p-6 text-center">
                  <p className="text-gray-400">Напряжение</p>
                  <p className="text-5xl font-bold text-yellow-400">{latest.voltage} <span className="text-2xl">В</span></p>
                </div>
                <div className="bg-gray-800 rounded-2xl p-6 text-center">
                  <p className="text-gray-400">Ток</p>
                  <p className="text-5xl font-bold text-blue-400">{latest.current} <span className="text-2xl">А</span></p>
                </div>
                <div className="bg-gray-800 rounded-2xl p-6 text-center">
                  <p className="text-gray-400">Активная мощность</p>
                  <p className="text-5xl font-bold text-emerald-400">{latest.active_power} <span className="text-2xl">кВт</span></p>
                </div>
                <div className="bg-gray-800 rounded-2xl p-6 text-center">
                  <p className="text-gray-400">Энергия всего</p>
                  <p className="text-5xl font-bold text-purple-400">{latest.energy_total.toFixed(2)} <span className="text-2xl">кВт·ч</span></p>
                </div>
              </div>
            )}

            <ResponsiveContainer width="100%" height={450}>
              <LineChart data={measurements}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="timestamp" tickFormatter={t => new Date(t).toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'})} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="active_power" stroke="#10b981" strokeWidth={3} name="Активная (кВт)" dot={false} />
                <Line type="monotone" dataKey="reactive_power" stroke="#8b5cf6" strokeWidth={3} name="Реактивная (квар)" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </>
        )}

        {tab === 'events' && (
          <div className="bg-gray-800 rounded-3xl p-6">
            <h2 className="text-xl mb-4">Журнал событий</h2>
            <div className="space-y-3 max-h-96 overflow-auto">
              {events.map(ev => (
                <div key={ev.id} className="flex justify-between bg-gray-900 p-4 rounded-2xl">
                  <div>
                    <span className="text-xs text-gray-400">{new Date(ev.timestamp).toLocaleString('ru-RU')}</span>
                    <p>{ev.description}</p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs ${ev.severity === 'critical' ? 'bg-red-500' : ev.severity === 'warning' ? 'bg-yellow-500' : 'bg-gray-600'}`}>
                    {ev.event_type}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'anomalies' && (
          <div className="bg-gray-800 rounded-3xl p-6">
            <h2 className="text-xl mb-4">Диагностика и аномалии</h2>
            {/* Здесь можно позже добавить красивые карточки */}
            <pre className="text-xs bg-black p-4 rounded-2xl overflow-auto">{JSON.stringify(anomalies, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;