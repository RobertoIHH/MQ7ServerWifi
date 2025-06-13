// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Crear directorio para almacenar los datos si no existe
const DATA_DIR = path.join(__dirname, 'sensor_data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Configuración del servidor
const app = express();
const port = process.env.PORT || 3000;

// Habilitar CORS para permitir conexiones desde cualquier origen
app.use(cors());

// Configurar middleware para servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Crear servidor HTTP
const server = http.createServer(app);

// Crear servidor WebSocket
const wss = new WebSocket.Server({ server });

// Almacenar los clientes conectados y los últimos datos
const connectedClients = new Set();
let lastData = {}; // Datos del sensor
let currentGasType = "CO"; // Tipo de gas actual por defecto
let sensorStatus = { connected: false }; // Estado del sensor

// Estructuras para almacenar min/max por tipo de gas
const gasMinMax = {
  'CO': { min: null, max: null },
  'H2': { min: null, max: null },
  'LPG': { min: null, max: null },
  'CH4': { min: null, max: null },
  'ALCOHOL': { min: null, max: null }
};

// Función para actualizar min/max
function updateMinMax(gasType, ppmValue) {
  if (!gasMinMax[gasType]) {
    gasMinMax[gasType] = { min: null, max: null };
  }
  
  const gasStats = gasMinMax[gasType];
  
  if (gasStats.min === null || ppmValue < gasStats.min) {
    gasStats.min = ppmValue;
  }
  
  if (gasStats.max === null || ppmValue > gasStats.max) {
    gasStats.max = ppmValue;
  }
  
  return gasStats;
}

// Función para limpiar y validar archivos JSON corruptos
function cleanJsonFile(fileName) {
  try {
    let fileContent = fs.readFileSync(fileName, 'utf8');
    
    // Eliminar comas finales antes del cierre del array
    fileContent = fileContent.replace(/,(\s*\])/, '$1');
    
    // Intentar parsear
    const data = JSON.parse(fileContent);
    
    // Si es exitoso, guardar el archivo limpio
    fs.writeFileSync(fileName, JSON.stringify(data, null, 2));
    
    return data;
  } catch (error) {
    console.error(`Error al limpiar archivo ${fileName}:`, error);
    return [];
  }
}

// Función para guardar datos del sensor
function saveSensorData(data) {
  if (!data) return;
  
  // Obtener la fecha actual en formato YYYY-MM-DD
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // Formato YYYY-MM-DD
  
  // Crear un nuevo objeto con los datos
  // Mantener el timestamp original del ESP32 y agregar uno del servidor
  const recordData = {
    timestamp: data.timestamp || Date.now(), // Timestamp del ESP32
    serverTimestamp: now.toISOString(), // Timestamp del servidor
    gasType: currentGasType,
    ADC: data.ADC,
    V: data.V,
    Rs: data.Rs,
    'Rs/R0': data['Rs/R0'],
    ppm: data.ppm,
    gas: data.gas,
    gas_index: data.gas_index
  };
  
  // Actualizar min/max para el gas actual
  if (data.ppm !== undefined && data.ppm !== null) {
    updateMinMax(currentGasType, data.ppm);
  }
  
  // Nombre del archivo para el día actual
  const fileName = path.join(DATA_DIR, `${dateStr}.json`);
  
  // Comprobar si el archivo ya existe
  let dailyData = [];
  
  try {
    if (fs.existsSync(fileName)) {
      // Si existe, intentar leer y limpiar el contenido
      dailyData = cleanJsonFile(fileName);
    }
  } catch (error) {
    console.error(`Error al leer el archivo ${fileName}:`, error);
    dailyData = [];
  }
  
  // Agregar el nuevo registro
  dailyData.push(recordData);
  
  // Guardar el archivo actualizado
  try {
    fs.writeFileSync(fileName, JSON.stringify(dailyData, null, 2));
    console.log(`Datos guardados en ${fileName} - Total registros: ${dailyData.length}`);
  } catch (error) {
    console.error(`Error al guardar en ${fileName}:`, error);
  }
}

// Al iniciar, cargar los min/max desde los archivos existentes
function loadMinMaxFromFiles() {
  try {
    const files = fs.readdirSync(DATA_DIR);
    
    files.forEach(file => {
      if (file.endsWith('.json')) {
        const fileName = path.join(DATA_DIR, file);
        const data = cleanJsonFile(fileName);
        
        data.forEach(record => {
          if (record.gasType && record.ppm !== undefined) {
            updateMinMax(record.gasType, record.ppm);
          }
        });
      }
    });
    
    console.log('Min/Max cargados:', gasMinMax);
  } catch (error) {
    console.error('Error al cargar min/max:', error);
  }
}

// Cargar min/max al iniciar
loadMinMaxFromFiles();

// Ruta para la página principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Ruta para obtener los últimos datos en formato JSON (API REST)
app.get('/api/data', (req, res) => {
  res.json({
    lastData,
    currentGasType,
    sensorStatus,
    minMax: gasMinMax[currentGasType] || { min: null, max: null }
  });
});

// Ruta para cambiar el tipo de gas vía API REST
app.post('/api/change-gas', (req, res) => {
  const { gas } = req.body;
  
  if (!gas) {
    return res.status(400).json({ error: 'Se requiere especificar el tipo de gas' });
  }
  
  // Validar el tipo de gas
  const validGasTypes = ['CO', 'H2', 'LPG', 'CH4', 'ALCOHOL'];
  if (!validGasTypes.includes(gas)) {
    return res.status(400).json({ error: 'Tipo de gas no válido' });
  }
  
  // Enviar comando a todos los sensores (ESP32) conectados
  const command = {
    command: 'change_gas',
    gas: gas,
    timestamp: Date.now()
  };
  
  let sensorFound = false;
  
  connectedClients.forEach(client => {
    if (client.type === 'sensor' && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(command));
      sensorFound = true;
    }
  });
  
  if (!sensorFound) {
    return res.status(503).json({ error: 'No hay sensores conectados' });
  }
  
  // Actualizamos el tipo de gas en el servidor también
  currentGasType = gas;
  
  res.json({ 
    success: true, 
    message: `Comando para cambiar a gas ${gas} enviado`,
    gas: gas
  });
});

// Obtener lista de fechas disponibles
app.get('/api/history/dates', (req, res) => {
  try {
    const files = fs.readdirSync(DATA_DIR);
    const dates = files
      .filter(file => file.endsWith('.json'))
      .map(file => file.replace('.json', ''))
      .sort()
      .reverse(); // Ordenar de más reciente a más antiguo
    
    res.json({ dates });
  } catch (error) {
    console.error('Error al obtener lista de fechas:', error);
    res.status(500).json({ error: 'Error al obtener datos históricos' });
  }
});

// Obtener datos de una fecha específica
app.get('/api/history/:date', (req, res) => {
  const { date } = req.params;
  
  // Validar formato de fecha (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Formato de fecha inválido. Use YYYY-MM-DD' });
  }
  
  const fileName = path.join(DATA_DIR, `${date}.json`);
  
  try {
    if (!fs.existsSync(fileName)) {
      return res.status(404).json({ error: 'No hay datos para esta fecha' });
    }
    
    // Leer y limpiar el archivo
    const data = cleanJsonFile(fileName);
    
    res.json({ date, data, count: data.length });
  } catch (error) {
    console.error(`Error al leer datos para ${date}:`, error);
    res.status(500).json({ error: 'Error al leer datos históricos' });
  }
});

// Obtener resumen de datos para una fecha específica
app.get('/api/history/:date/summary', (req, res) => {
  const { date } = req.params;
  
  // Validar formato de fecha
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Formato de fecha inválido. Use YYYY-MM-DD' });
  }
  
  const fileName = path.join(DATA_DIR, `${date}.json`);
  
  try {
    if (!fs.existsSync(fileName)) {
      return res.status(404).json({ error: 'No hay datos para esta fecha' });
    }
    
    // Leer y limpiar el archivo
    const data = cleanJsonFile(fileName);
    
    // Crear resumen por tipo de gas
    const summary = {};
    
    data.forEach(record => {
      const gasType = record.gasType || record.gas || 'unknown';
      
      if (!summary[gasType]) {
        summary[gasType] = {
          count: 0,
          min: Number.MAX_VALUE,
          max: -Number.MAX_VALUE,
          sum: 0,
          avg: 0
        };
      }
      
      const ppm = parseFloat(record.ppm) || 0;
      
      summary[gasType].count++;
      summary[gasType].min = Math.min(summary[gasType].min, ppm);
      summary[gasType].max = Math.max(summary[gasType].max, ppm);
      summary[gasType].sum += ppm;
    });
    
    // Calcular promedios
    Object.keys(summary).forEach(gasType => {
      if (summary[gasType].count > 0) {
        summary[gasType].avg = summary[gasType].sum / summary[gasType].count;
      }
      
      // Redondear valores para facilitar la lectura
      summary[gasType].min = summary[gasType].min === Number.MAX_VALUE ? 0 : summary[gasType].min.toFixed(6);
      summary[gasType].max = summary[gasType].max === -Number.MAX_VALUE ? 0 : summary[gasType].max.toFixed(6);
      summary[gasType].avg = summary[gasType].avg.toFixed(6);
      
      // Eliminar la suma del resultado final
      delete summary[gasType].sum;
    });
    
    res.json({ date, summary, totalRecords: data.length });
  } catch (error) {
    console.error(`Error al leer resumen para ${date}:`, error);
    res.status(500).json({ error: 'Error al procesar datos históricos' });
  }
});

// Manejar conexiones WebSocket
wss.on('connection', (ws, req) => {
  let clientType = 'app'; // Por defecto, asumimos que es una app
  
  console.log(`Cliente conectado desde ${req.socket.remoteAddress}`);
  
  // Agregar cliente a la lista
  connectedClients.add(ws);
  
  // Enviar los últimos datos disponibles al nuevo cliente
  if (Object.keys(lastData).length > 0) {
    ws.send(JSON.stringify({
      type: 'data_update',
      data: lastData,
      currentGasType: currentGasType,
      timestamp: Date.now(),
      min: gasMinMax[currentGasType]?.min,
      max: gasMinMax[currentGasType]?.max
    }));
  }
  
  // Manejar mensajes entrantes
  ws.on('message', (message) => {
    try {
      const parsedMessage = JSON.parse(message);
      console.log('Mensaje recibido:', parsedMessage);
      
      // Determinar si el cliente es un sensor (ESP32) basado en los mensajes
      if (parsedMessage.source === 'esp32') {
        clientType = 'sensor';
        ws.type = 'sensor'; // Agregar propiedad al objeto WebSocket
        
        // Actualizar estado del sensor
        sensorStatus.connected = true;
        sensorStatus.lastUpdate = Date.now();
        
        // Actualizar los últimos datos recibidos del sensor
        lastData = parsedMessage.data;
        
        // Si el mensaje incluye información sobre el gas actual, actualizarlo
        if (lastData && lastData.gas) {
          currentGasType = lastData.gas;
        }
        
        // Guardar los datos del sensor en archivo
        saveSensorData(lastData);
        
        // Obtener min/max actuales
        const currentMinMax = gasMinMax[currentGasType] || { min: null, max: null };
        
        // Difundir el mensaje a todos los clientes de tipo app
        connectedClients.forEach(client => {
          if (client !== ws && client.type !== 'sensor' && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'data_update',
              data: lastData,
              currentGasType: currentGasType,
              timestamp: Date.now(),
              min: currentMinMax.min,
              max: currentMinMax.max
            }));
          }
        });
      }
      // Procesar comandos de cambio de gas desde la app
      else if (parsedMessage.command === 'change_gas') {
        const { gas } = parsedMessage;
        
        // Validar el tipo de gas
        const validGasTypes = ['CO', 'H2', 'LPG', 'CH4', 'ALCOHOL'];
        if (!validGasTypes.includes(gas)) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Tipo de gas no válido',
            timestamp: Date.now()
          }));
          return;
        }
        
        // Actualizar el tipo de gas actual
        currentGasType = gas;
        
        // Enviar comando a todos los sensores conectados
        connectedClients.forEach(client => {
          if (client.type === 'sensor' && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(parsedMessage));
          }
        });
        
        // Obtener min/max para el nuevo gas
        const newMinMax = gasMinMax[gas] || { min: null, max: null };
        
        // Confirmar al cliente app que envió el comando
        ws.send(JSON.stringify({
          type: 'command_sent',
          command: 'change_gas',
          gas: gas,
          timestamp: Date.now(),
          min: newMinMax.min,
          max: newMinMax.max
        }));
      }
      // Si recibimos confirmación de cambio de gas desde el sensor
      else if (parsedMessage.command === 'gas_changed') {
        // Actualizar el tipo de gas actual en el servidor
        if (parsedMessage.success && parsedMessage.to) {
          currentGasType = parsedMessage.to;
          
          // Obtener min/max para el nuevo gas
          const currentMinMax = gasMinMax[currentGasType] || { min: null, max: null };
          
          // Notificar a todos los clientes app sobre el cambio
          connectedClients.forEach(client => {
            if (client.type !== 'sensor' && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({
                type: 'gas_changed',
                gas: currentGasType,
                timestamp: Date.now(),
                min: currentMinMax.min,
                max: currentMinMax.max
              }));
            }
          });
        }
      }
      // Si recibimos un estado del sensor
      else if (parsedMessage.status === 'ok') {
        // Actualizar estado del sensor
        sensorStatus = {
          connected: true,
          lastUpdate: Date.now(),
          ...parsedMessage
        };
        
        // Si el mensaje incluye información sobre el gas actual, actualizarlo
        if (parsedMessage.current_gas) {
          currentGasType = parsedMessage.current_gas;
        }
        
        // Notificar a todos los clientes app
        connectedClients.forEach(client => {
          if (client.type !== 'sensor' && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'sensor_status',
              status: sensorStatus,
              timestamp: Date.now()
            }));
          }
        });
      }
      // Comandos de la aplicación cliente (que no son de cambio de gas)
      else if (parsedMessage.command === 'get_status') {
        // Obtener min/max actuales
        const currentMinMax = gasMinMax[currentGasType] || { min: null, max: null };
        
        // Enviar el estado actual al cliente
        ws.send(JSON.stringify({
          type: 'sensor_status',
          status: sensorStatus,
          currentGasType: currentGasType,
          timestamp: Date.now(),
          min: currentMinMax.min,
          max: currentMinMax.max
        }));
      }
      
    } catch (error) {
      console.error('Error al procesar el mensaje:', error);
    }
  });
  
  // Manejar desconexiones
  ws.on('close', () => {
    console.log('Cliente desconectado');
    connectedClients.delete(ws);
    
    // Si era un sensor, actualizar el estado
    if (ws.type === 'sensor') {
      sensorStatus.connected = false;
      sensorStatus.lastUpdate = Date.now();
      
      // Notificar a todos los clientes app
      connectedClients.forEach(client => {
        if (client.type !== 'sensor' && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'sensor_status',
            status: sensorStatus,
            timestamp: Date.now()
          }));
        }
      });
    }
  });
});

// Verificar periódicamente la conexión del sensor
setInterval(() => {
  const now = Date.now();
  // Si no hemos recibido datos del sensor en los últimos 10 segundos, marcarlo como desconectado
  if (sensorStatus.connected && sensorStatus.lastUpdate && (now - sensorStatus.lastUpdate) > 10000) {
    sensorStatus.connected = false;
    
    // Notificar a todos los clientes app
    connectedClients.forEach(client => {
      if (client.type !== 'sensor' && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'sensor_status',
          status: sensorStatus,
          timestamp: now
        }));
      }
    });
  }
}, 5000);

// Iniciar el servidor
server.listen(port, () => {
  console.log(`Servidor Gas Sensor WebSocket escuchando en el puerto ${port}`);
  console.log(`Para acceder desde la red local: http://localhost:${port}`);
  console.log(`Datos almacenados en: ${DATA_DIR}`);
});