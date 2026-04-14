import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Scatter } from 'recharts';
import axios from 'axios';

interface Device { id: number; name: string; location: string; status: string; }
interface Measurement { id: number; timestamp: string; voltage: number; current: number; active_power: number; reactive_power: number; energy_total: number; }
interface Event { id: number; timestamp: string; event_type: string; description: string; severity: string; }
interface Anomaly { timestamp: string; anomaly_type: string; value: number; description: string; }

const timePresets = [
  { label: 'Последние 5 минут', minutes: 5 },
  { label: 'Последние 10 минут', minutes: 10 },
  { label: 'Последние 20 минут', minutes: 20 },
  { label: 'Последний час', minutes: 60 },
  { label: 'Последние 6 часов', minutes: 360 },
  { label: 'Последние 24 часа', minutes: 1440 },
  { label: 'Последние 7 дней', minutes: 10080 },
  { label: 'Последние 30 дней', minutes: 43200 },
];

function App() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState(1);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [tab, setTab] = useState<'live' | 'events' | 'anomalies'>('live');

  const [selectedPreset, setSelectedPreset] = useState(60);
  const [isCustom, setIsCustom] = useState(false);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const moscowTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleString('ru-RU', { 
      timeZone: 'Europe/Moscow',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      day: '2-digit',
      month: '2-digit'
    });
  };

  const loadDevices = async () => {
    const res = await axios.get('http://localhost:8000/api/devices');
    setDevices(res.data);
  };

  const loadData = async () => {
    let params: any = { device_id: selectedDevice, limit: 500 };

    if (isCustom && customStart && customEnd) {
      params.start = customStart;
      params.end = customEnd;
    } else {
      const minutesAgo = selectedPreset;
      const startTime = new Date(Date.now() - minutesAgo * 60000).toISOString();
      params.start = startTime;
    }

    const [mRes, eRes, aRes] = await Promise.all([
      axios.get('http://localhost:8000/api/measurements', { params }),
      axios.get('http://localhost:8000/api/events', { params: { device_id: selectedDevice, limit: 50 } }),
      axios.get('http://localhost:8000/api/anomalies', { params: { device_id: selectedDevice } })
    ]);

    // Сортируем слева направо (по времени)
    const sorted = mRes.data.sort((a: Measurement, b: Measurement) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    setMeasurements(sorted);
    setEvents(eRes.data);
    setAnomalies(aRes.data);
  };

  useEffect(() => {
    loadDevices();
    loadData();

    const ws = new WebSocket('ws://localhost:8000/ws/live');
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.device_id === selectedDevice) {
        setMeasurements(prev => {
          const newData = [...prev, msg];
          return newData.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        });
      }
    };

    return () => ws.close();
  }, [selectedDevice, selectedPreset, isCustom, customStart, customEnd]);

  const latest = measurements[measurements.length - 1];

  // Данные для графика
  const chartData = measurements.map(m => ({
    ...m,
    anomaly: anomalies.some(a => a.timestamp === m.timestamp) ? m.active_power : null
  }));

  const hasCriticalAnomaly = anomalies.some(a => a.anomaly_type === 'mining_suspect' || a.anomaly_type === 'high_load');

  const handlePresetChange = (minutes: number) => {
    setSelectedPreset(minutes);
    setIsCustom(false);
    loadData();
  };

  const handleCustomApply = () => {
    setIsCustom(true);
    loadData();
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold text-center mb-1">АСКУЭ MONYA</h1>
        <p className="text-center text-emerald-400 mb-8">Система контроля и мониторинга электроэнергии</p>

        {/* Выбор устройств */}
        <div className="flex gap-2 mb-6 flex-wrap justify-center">
          {devices.map(dev => (
            <button
              key={dev.id}
              onClick={() => setSelectedDevice(dev.id)}
              className={`px-6 py-3 rounded-2xl font-medium transition-all ${selectedDevice === dev.id ? 'bg-emerald-500 text-white shadow-lg' : 'bg-gray-800 hover:bg-gray-700'}`}
            >
              {dev.name}
            </button>
          ))}
        </div>

        {/* Выбор периода */}
        <div className="bg-gray-800 rounded-3xl p-5 mb-8">
          <div className="flex items-center gap-4">
            <select
              value={isCustom ? "custom" : selectedPreset}
              onChange={(e) => {
                if (e.target.value === "custom") setIsCustom(true);
                else {
                  setIsCustom(false);
                  handlePresetChange(Number(e.target.value));
                }
              }}
              className="bg-gray-900 text-white px-5 py-3 rounded-2xl flex-1 max-w-xs"
            >
              {timePresets.map(p => <option key={p.minutes} value={p.minutes}>{p.label}</option>)}
              <option value="custom">Свой диапазон...</option>
            </select>

            {isCustom && (
              <>
                <input type="datetime-local" value={customStart} onChange={e => setCustomStart(e.target.value)} className="bg-gray-900 px-4 py-3 rounded-2xl" />
                <span className="text-gray-400">—</span>
                <input type="datetime-local" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="bg-gray-900 px-4 py-3 rounded-2xl" />
                <button onClick={handleCustomApply} className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 rounded-2xl font-medium">Применить</button>
              </>
            )}
          </div>
        </div>

        {hasCriticalAnomaly && (
          <div className="mb-6 bg-red-900/30 border border-red-500 text-red-400 px-6 py-4 rounded-3xl flex items-center gap-3">
            <span className="text-2xl">🚨</span>
            <div><strong>ВНИМАНИЕ!</strong> Обнаружено подозрение на майнинг или несанкционированное подключение</div>
          </div>
        )}

        <div className="flex border-b border-gray-700 mb-6">
          <button onClick={() => setTab('live')} className={`px-8 py-3 font-medium ${tab === 'live' ? 'border-b-4 border-emerald-500 text-emerald-400' : ''}`}>Live</button>
          <button onClick={() => setTab('events')} className={`px-8 py-3 font-medium ${tab === 'events' ? 'border-b-4 border-emerald-500 text-emerald-400' : ''}`}>События</button>
          <button onClick={() => setTab('anomalies')} className={`px-8 py-3 font-medium ${tab === 'anomalies' ? 'border-b-4 border-emerald-500 text-emerald-400' : ''}`}>Диагностика (ML)</button>
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

            {/* Таблица последних показаний */}
            <div className="mb-8">
              <h2 className="text-xl font-semibold mb-3">Последние показания</h2>
              <div className="bg-gray-800 rounded-3xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-700 text-gray-400 text-sm">
                      <th className="text-left py-4 px-6">Время (МСК)</th>
                      <th className="text-right py-4 px-6">Напряжение, В</th>
                      <th className="text-right py-4 px-6">Ток, А</th>
                      <th className="text-right py-4 px-6">Акт. мощн., кВт</th>
                      <th className="text-right py-4 px-6">Реакт. мощн., квар</th>
                      <th className="text-right py-4 px-6">Энергия, кВт·ч</th>
                    </tr>
                  </thead>
                  <tbody>
                    {measurements.slice(0, 12).map(m => (
                      <tr key={m.id} className="border-b border-gray-700 hover:bg-gray-700/50">
                        <td className="py-4 px-6 text-gray-400">{moscowTime(m.timestamp)}</td>
                        <td className="py-4 px-6 text-right">{m.voltage}</td>
                        <td className="py-4 px-6 text-right">{m.current}</td>
                        <td className="py-4 px-6 text-right font-medium text-emerald-400">{m.active_power}</td>
                        <td className="py-4 px-6 text-right">{m.reactive_power}</td>
                        <td className="py-4 px-6 text-right font-medium">{m.energy_total.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* СТРОГИЙ ГРАФИК С АНОМАЛИЯМИ */}
            <ResponsiveContainer width="100%" height={480}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#444" vertical={false} />
                <XAxis 
                  dataKey="timestamp" 
                  tickFormatter={t => new Date(t).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })}
                  stroke="#888"
                  tick={{ fontSize: 12 }}
                />
                <YAxis stroke="#888" tick={{ fontSize: 12 }} />
                <Tooltip 
                  labelFormatter={t => new Date(t).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}
                  contentStyle={{ backgroundColor: '#1f2937', borderColor: '#4b5563' }}
                />
                <Legend />
                <Line type="monotone" dataKey="active_power" stroke="#22c55e" strokeWidth={3} name="Активная мощность, кВт" dot={false} />
                <Line type="monotone" dataKey="reactive_power" stroke="#a78bfa" strokeWidth={2.5} name="Реактивная мощность, квар" dot={false} />
                {/* Красные точки аномалий */}
                <Scatter 
                  dataKey="anomaly" 
                  fill="#ef4444" 
                  stroke="#b91c1c"
                  strokeWidth={2}
                  name="Аномалия (майнинг)"
                />
              </LineChart>
            </ResponsiveContainer>
          </>
        )}

        {/* Остальные вкладки без изменений */}
        {tab === 'events' && (
          <div className="bg-gray-800 rounded-3xl p-6">
            <h2 className="text-xl mb-4">Журнал событий</h2>
            <div className="space-y-3 max-h-96 overflow-auto">
              {events.map(ev => (
                <div key={ev.id} className="flex justify-between bg-gray-900 p-4 rounded-2xl">
                  <div>
                    <span className="text-xs text-gray-400">{new Date(ev.timestamp).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</span>
                    <p className="mt-1">{ev.description}</p>
                  </div>
                  <span className={`px-4 py-1 rounded-full text-xs font-medium 
                    ${ev.severity === 'critical' ? 'bg-red-500' : ev.severity === 'warning' ? 'bg-yellow-500' : 'bg-emerald-500'}`}>
                    {ev.event_type}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'anomalies' && (
          <div className="bg-gray-800 rounded-3xl p-6">
            <h2 className="text-xl mb-4">🔍 Диагностика и аномалии (ML Anti-Fraud)</h2>
            {anomalies.length === 0 ? (
              <p className="text-emerald-400">Аномалий не обнаружено.</p>
            ) : (
              <div className="space-y-4">
                {anomalies.map((anomaly, index) => (
                  <div key={index} className="bg-gray-900 p-5 rounded-2xl border border-red-500/30">
                    <div className="flex justify-between">
                      <span className="text-red-400 font-medium">🚨 {anomaly.anomaly_type === 'mining_suspect' ? 'Подозрение на майнинг' : 'Критическая нагрузка'}</span>
                      <span className="text-xs text-gray-400">{new Date(anomaly.timestamp).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</span>
                    </div>
                    <p className="mt-2 text-lg">{anomaly.description}</p>
                    <p className="text-2xl font-bold text-red-400 mt-1">{anomaly.value} кВт</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;