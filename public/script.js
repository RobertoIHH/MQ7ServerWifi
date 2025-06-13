// Configuración
const MAX_DATA_POINTS = 60;
let isConnected = false;
let isChangingGas = false;
let currentGas = "CO";
let chart = null;
let webSocket = null;

// Registros para valores mínimos, máximos y últimos por tipo de gas
const gasRecords = {
    'CO': {
        min: { value: Number.MAX_VALUE, timestamp: null, formatted: "--/--/---- --:--:--" },
        max: { value: -Number.MAX_VALUE, timestamp: null, formatted: "--/--/---- --:--:--" },
        last: { value: 0, timestamp: null, formatted: "--/--/---- --:--:--" }
    },
    'H2': {
        min: { value: Number.MAX_VALUE, timestamp: null, formatted: "--/--/---- --:--:--" },
        max: { value: -Number.MAX_VALUE, timestamp: null, formatted: "--/--/---- --:--:--" },
        last: { value: 0, timestamp: null, formatted: "--/--/---- --:--:--" }
    },
    'LPG': {
        min: { value: Number.MAX_VALUE, timestamp: null, formatted: "--/--/---- --:--:--" },
        max: { value: -Number.MAX_VALUE, timestamp: null, formatted: "--/--/---- --:--:--" },
        last: { value: 0, timestamp: null, formatted: "--/--/---- --:--:--" }
    },
    'CH4': {
        min: { value: Number.MAX_VALUE, timestamp: null, formatted: "--/--/---- --:--:--" },
        max: { value: -Number.MAX_VALUE, timestamp: null, formatted: "--/--/---- --:--:--" },
        last: { value: 0, timestamp: null, formatted: "--/--/---- --:--:--" }
    },
    'ALCOHOL': {
        min: { value: Number.MAX_VALUE, timestamp: null, formatted: "--/--/---- --:--:--" },
        max: { value: -Number.MAX_VALUE, timestamp: null, formatted: "--/--/---- --:--:--" },
        last: { value: 0, timestamp: null, formatted: "--/--/---- --:--:--" }
    }
};

// Datos para el gráfico
const chartData = {
    labels: Array(MAX_DATA_POINTS).fill(''),
    ppmData: Array(MAX_DATA_POINTS).fill(null),
    adcData: Array(MAX_DATA_POINTS).fill(null)
};

// Colores para cada tipo de gas
const gasColors = {
    'CO': '#3366CC',
    'H2': '#DC3912',
    'LPG': '#FF9900',
    'CH4': '#109618',
    'ALCOHOL': '#990099'
};

// Inicializar elementos de la página
document.addEventListener('DOMContentLoaded', () => {
    // Intentar cargar registros previos del localStorage
    try {
        const savedRecords = localStorage.getItem('gasRecords');
        if (savedRecords) {
            const parsed = JSON.parse(savedRecords);
            // Verificar que tenga la estructura correcta
            if (parsed && typeof parsed === 'object') {
                // Mantener solo los gases válidos
                const validGases = ['CO', 'H2', 'LPG', 'CH4', 'ALCOHOL'];
                validGases.forEach(gas => {
                    if (parsed[gas]) {
                        gasRecords[gas] = parsed[gas];
                    }
                });
            }
        }
    } catch (e) {
        console.warn('Error al cargar registros previos:', e);
    }
    
    setupChart();
    connectWebSocket();
    setupGasButtons();
    
    // Mostrar registros del gas inicial
    displayCurrentGasRecords(currentGas);
});

// Configurar y crear el gráfico
function setupChart() {
    const ctx = document.getElementById('real-time-chart').getContext('2d');
    
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartData.labels,
            datasets: [
                {
                    label: 'PPM',
                    data: chartData.ppmData,
                    borderColor: gasColors[currentGas] || gasColors.CO,
                    backgroundColor: 'rgba(0, 0, 0, 0)',
                    borderWidth: 2,
                    tension: 0.4,
                    yAxisID: 'y'
                },
                {
                    label: 'ADC',
                    data: chartData.adcData,
                    borderColor: '#FF0000',
                    backgroundColor: 'rgba(0, 0, 0, 0)',
                    borderWidth: 1,
                    borderDash: [5, 5],
                    tension: 0.4,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 0
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    }
                },
                y: {
                    beginAtZero: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'PPM'
                    }
                },
                y1: {
                    beginAtZero: true,
                    position: 'right',
                    grid: {
                        drawOnChartArea: false
                    },
                    title: {
                        display: true,
                        text: 'ADC'
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                }
            }
        }
    });
}

// Configurar botones de selección de gas
function setupGasButtons() {
    const gasButtons = document.querySelectorAll('.gas-button');
    
    gasButtons.forEach(button => {
        button.addEventListener('click', () => {
            const gas = button.getAttribute('data-gas');
            changeGasType(gas);
        });
        
        // Deshabilitar botón si no hay conexión
        if (!isConnected) {
            button.disabled = true;
        }
    });
    
    // Actualizar estado de los botones según el gas actual
    updateGasButtonState();
}

// Actualizar estado de los botones de gas
function updateGasButtonState() {
    const gasButtons = document.querySelectorAll('.gas-button');
    
    gasButtons.forEach(button => {
        const gas = button.getAttribute('data-gas');
        
        // Habilitar/deshabilitar según conexión
        button.disabled = !isConnected || isChangingGas || gas === currentGas;
        
        // Resaltar el botón del gas actual
        if (gas === currentGas) {
            button.style.opacity = '1';
        } else {
            button.style.opacity = '0.7';
        }
    });
}

// Conectar al WebSocket
function connectWebSocket() {
    // Determinar la URL del WebSocket basada en la ubicación actual
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    // Crear conexión WebSocket
    webSocket = new WebSocket(wsUrl);
    
    // Manejar apertura de conexión
    webSocket.onopen = () => {
        addMessage('Conectado al servidor WebSocket');
        
        // Obtener estado del sensor
        webSocket.send(JSON.stringify({
            command: 'get_status'
        }));
    };
    
    // Manejar mensajes recibidos
    webSocket.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            console.log('Mensaje recibido:', message);
            
            // Procesar el mensaje según su tipo
            switch(message.type) {
                case 'data_update':
                    handleDataUpdate(message);
                    break;
                case 'sensor_status':
                    handleSensorStatus(message);
                    break;
                case 'gas_changed':
                    handleGasChanged(message);
                    break;
                case 'command_sent':
                    addMessage(`Comando enviado: ${message.command} (${message.gas})`);
                    // Ahora procesamos los min/max que envía el servidor al confirmar un comando
                    if (message.min !== undefined && message.max !== undefined) {
                        updateMinMaxFromServer(message.gas, message.min, message.max);
                    }
                    break;
                case 'error':
                    addMessage(`Error: ${message.message}`);
                    break;
            }
        } catch (error) {
            console.error('Error al procesar mensaje:', error);
        }
    };
    
    // Manejar cierre de conexión
    webSocket.onclose = () => {
        setConnectionStatus(false);
        addMessage('Desconectado del servidor WebSocket - Reconectando en 5 segundos...');
        
        // Guardar la última medición
        updateLastMeasurement();
        
        // Intentar reconectar después de 5 segundos
        setTimeout(connectWebSocket, 5000);
    };
    
    // Manejar errores
    webSocket.onerror = (error) => {
        console.error('Error en la conexión WebSocket:', error);
        addMessage('Error en la conexión WebSocket');
    };
}

// Actualizar min/max desde el servidor
function updateMinMaxFromServer(gas, minValue, maxValue) {
    if (!gas || minValue === undefined || maxValue === undefined) return;
    
    const now = new Date();
    const formattedTimestamp = formatDateTime(now);
    
    // Solo actualizar si el servidor tiene valores válidos
    if (minValue !== null) {
        // Actualizar min solo si es menor que el actual o si no tenemos un valor
        if (gasRecords[gas].min.value === Number.MAX_VALUE || minValue < gasRecords[gas].min.value) {
            gasRecords[gas].min.value = minValue;
            gasRecords[gas].min.timestamp = now;
            gasRecords[gas].min.formatted = formattedTimestamp + " (servidor)";
            
            // Actualizar UI si es el gas actual
            if (gas === currentGas) {
                document.getElementById('min-timestamp').textContent = gasRecords[gas].min.formatted;
                document.getElementById('min-value-data').textContent = `${minValue.toFixed(6)} ppm`;
            }
        }
    }
    
    if (maxValue !== null) {
        // Actualizar max solo si es mayor que el actual o si no tenemos un valor
        if (gasRecords[gas].max.value === -Number.MAX_VALUE || maxValue > gasRecords[gas].max.value) {
            gasRecords[gas].max.value = maxValue;
            gasRecords[gas].max.timestamp = now;
            gasRecords[gas].max.formatted = formattedTimestamp + " (servidor)";
            
            // Actualizar UI si es el gas actual
            if (gas === currentGas) {
                document.getElementById('max-timestamp').textContent = gasRecords[gas].max.formatted;
                document.getElementById('max-value-data').textContent = `${maxValue.toFixed(6)} ppm`;
            }
        }
    }
    
    // Guardar en localStorage
    try {
        localStorage.setItem('gasRecords', JSON.stringify(gasRecords));
    } catch (e) {
        console.warn('No se pudo guardar en localStorage:', e);
    }
}

// Manejar actualización de datos del sensor
function handleDataUpdate(message) {
    if (!message.data) return;
    
    const data = message.data;
    const now = new Date();
    
    // Actualizar valores en la interfaz
    document.getElementById('adc-value').textContent = data.ADC || 0;
    document.getElementById('voltage-value').textContent = `${(data.V || 0).toFixed(6)} V`;
    document.getElementById('rs-value').textContent = `${(data.Rs || 0).toFixed(2)} KΩ`;
    document.getElementById('rs-ro-value').textContent = (data['Rs/R0'] || 0).toFixed(3);
    document.getElementById('ppm-value').textContent = `${(data.ppm || 0).toFixed(6)} ppm`;
    
    // Verificar si el servidor envió valores min/max
    if (message.min !== undefined && message.max !== undefined) {
        updateMinMaxFromServer(currentGas, message.min, message.max);
    }
    
    // Actualizar gas actual si está presente en los datos
    if (data.gas && data.gas !== currentGas) {
        updateCurrentGas(data.gas);
    }
    
    // Actualizar registros de min/max/última medición
    updateMeasurementRecords(data.ppm, now);
    
    // Actualizar gráfico
    updateChart(data);
    
    // Actualizar estado de conexión
    setConnectionStatus(true);
}

// Actualizar registros de mediciones
function updateMeasurementRecords(ppmValue, timestamp) {
    if (!ppmValue || isNaN(ppmValue)) return;
    
    const formattedTimestamp = formatDateTime(timestamp);
    const currentGasRecords = gasRecords[currentGas];
    
    if (!currentGasRecords) return;
    
    // Actualizar valor mínimo para el gas actual
    if (ppmValue < currentGasRecords.min.value) {
        currentGasRecords.min.value = ppmValue;
        currentGasRecords.min.timestamp = timestamp;
        currentGasRecords.min.formatted = formattedTimestamp;
        
        // Actualizar UI
        document.getElementById('min-timestamp').textContent = formattedTimestamp;
        document.getElementById('min-value-data').textContent = `${ppmValue.toFixed(6)} ppm`;
    }
    
    // Actualizar valor máximo para el gas actual
    if (ppmValue > currentGasRecords.max.value) {
        currentGasRecords.max.value = ppmValue;
        currentGasRecords.max.timestamp = timestamp;
        currentGasRecords.max.formatted = formattedTimestamp;
        
        // Actualizar UI
        document.getElementById('max-timestamp').textContent = formattedTimestamp;
        document.getElementById('max-value-data').textContent = `${ppmValue.toFixed(6)} ppm`;
    }
    
    // Actualizar última medición para el gas actual
    currentGasRecords.last.value = ppmValue;
    currentGasRecords.last.timestamp = timestamp;
    currentGasRecords.last.formatted = formattedTimestamp;
    
    // Actualizar UI
    document.getElementById('last-timestamp').textContent = formattedTimestamp;
    document.getElementById('last-value-data').textContent = `${ppmValue.toFixed(6)} ppm`;
    
    // Intentar guardar los registros en localStorage para persistencia
    try {
        localStorage.setItem('gasRecords', JSON.stringify(gasRecords));
    } catch (e) {
        console.warn('No se pudo guardar en localStorage:', e);
    }
}

// Actualizar última medición al desconectar
function updateLastMeasurement() {
    const now = new Date();
    const formattedTimestamp = formatDateTime(now);
    
    // Actualizar la hora de la última medición para el gas actual
    const currentGasRecords = gasRecords[currentGas];
    if (currentGasRecords && currentGasRecords.last.timestamp) {
        document.getElementById('last-timestamp').textContent = 
            `${currentGasRecords.last.formatted} (desconexión: ${formattedTimestamp})`;
            
        // Actualizar también en el registro
        currentGasRecords.last.formatted = 
            `${currentGasRecords.last.formatted} (desconexión: ${formattedTimestamp})`;
    }
}

// Formatear fecha y hora
function formatDateTime(date) {
    if (!date) return "--/--/---- --:--:--";
    
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Los meses comienzan en 0
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
}

// Manejar estado del sensor
function handleSensorStatus(message) {
    if (!message.status) return;
    
    const status = message.status;
    
    // Actualizar estado de conexión
    setConnectionStatus(status.connected);
    
    // Actualizar gas actual si está presente
    if (status.current_gas && status.current_gas !== currentGas) {
        updateCurrentGas(status.current_gas);
    }
    
    // Verificar si el servidor envió valores min/max
    if (message.min !== undefined && message.max !== undefined) {
        updateMinMaxFromServer(currentGas, message.min, message.max);
    }
    
    // Mostrar mensaje de estado
    if (status.connected) {
        addMessage('Sensor conectado');
    } else {
        updateLastMeasurement();
        addMessage('Sensor desconectado');
    }
}

// Manejar cambio de gas confirmado
function handleGasChanged(message) {
    if (!message.gas) return;
    
    // Verificar si el servidor envió valores min/max
    if (message.min !== undefined && message.max !== undefined) {
        updateMinMaxFromServer(message.gas, message.min, message.max);
    }
    
    // Actualizar gas actual
    updateCurrentGas(message.gas);
    
    // Indicar que ya no estamos cambiando de gas
    isChangingGas = false;
    document.getElementById('changing-indicator').style.display = 'none';
    
    // Actualizar estado de los botones
    updateGasButtonState();
    
    // Mostrar mensaje
    addMessage(`Gas cambiado a: ${message.gas}`);
}

// Mostrar los registros guardados para el gas actual
function displayCurrentGasRecords(gas) {
    const records = gasRecords[gas];
    if (!records) return;
    
    // Mostrar valor mínimo
    if (records.min.timestamp) {
        document.getElementById('min-timestamp').textContent = records.min.formatted;
        document.getElementById('min-value-data').textContent = `${records.min.value.toFixed(6)} ppm`;
    } else {
        document.getElementById('min-timestamp').textContent = "--/--/---- --:--:--";
        document.getElementById('min-value-data').textContent = "0.00 ppm";
    }
    
    // Mostrar valor máximo
    if (records.max.timestamp) {
        document.getElementById('max-timestamp').textContent = records.max.formatted;
        document.getElementById('max-value-data').textContent = `${records.max.value.toFixed(6)} ppm`;
    } else {
        document.getElementById('max-timestamp').textContent = "--/--/---- --:--:--";
        document.getElementById('max-value-data').textContent = "0.00 ppm";
    }
    
    // Mostrar última medición
    if (records.last.timestamp) {
        document.getElementById('last-timestamp').textContent = records.last.formatted;
        document.getElementById('last-value-data').textContent = `${records.last.value.toFixed(6)} ppm`;
    } else {
        document.getElementById('last-timestamp').textContent = "--/--/---- --:--:--";
        document.getElementById('last-value-data').textContent = "0.00 ppm";
    }
}

// Actualizar el gas actual en la interfaz
function updateCurrentGas(gas) {
    currentGas = gas;
    
    // Actualizar texto y color
    document.getElementById('current-gas').textContent = gas;
    document.getElementById('gas-badge').textContent = gas;
    document.getElementById('gas-badge').style.backgroundColor = gasColors[gas] || '#666';
    
    // Actualizar color de la línea del gráfico
    if (chart && chart.data.datasets[0]) {
        chart.data.datasets[0].borderColor = gasColors[gas] || gasColors.CO;
        chart.update();
    }
    
    // Actualizar estado de los botones
    updateGasButtonState();
    
    // Mostrar los registros guardados para este gas
    displayCurrentGasRecords(gas);
}

// Enviar comando para cambiar tipo de gas
function changeGasType(gas) {
    if (!isConnected || isChangingGas) return;
    
    // Evitar cambiar al mismo gas
    if (gas === currentGas) {
        addMessage(`Ya estamos midiendo ${gas}`);
        return;
    }
    
    // Indicar que estamos cambiando de gas
    isChangingGas = true;
    document.getElementById('changing-indicator').style.display = 'inline-block';
    
    // Actualizar estado de los botones
    updateGasButtonState();
    
    // Enviar comando al servidor
    webSocket.send(JSON.stringify({
        command: 'change_gas',
        gas: gas,
        timestamp: Date.now()
    }));
    
    addMessage(`Solicitando cambio a gas: ${gas}...`);
    
    // Establecer timeout para cancelar el estado de cambio después de 5 segundos
    setTimeout(() => {
        if (isChangingGas) {
            isChangingGas = false;
            document.getElementById('changing-indicator').style.display = 'none';
            updateGasButtonState();
            addMessage(`Timeout al cambiar a gas: ${gas}`);
        }
    }, 5000);
}

// Actualizar el gráfico con nuevos datos
function updateChart(data) {
    if (!chart) return;
    
    // Añadir timestamp como etiqueta (formato HH:MM:SS)
    const now = new Date();
    const timeString = now.toTimeString().substring(0, 8);
    
    // Desplazar datos y añadir nuevos valores
    chartData.labels.shift();
    chartData.labels.push(timeString);
    
    chartData.ppmData.shift();
    chartData.ppmData.push(data.ppm || 0);
    
    chartData.adcData.shift();
    chartData.adcData.push(data.ADC || 0);
    
    // Actualizar datasets del gráfico
    chart.data.labels = chartData.labels;
    chart.data.datasets[0].data = chartData.ppmData;
    chart.data.datasets[1].data = chartData.adcData;
    
    // Actualizar gráfico
    chart.update();
}

// Actualizar estado de conexión
function setConnectionStatus(connected) {
    isConnected = connected;
    
    const statusIndicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');
    
    if (connected) {
        statusIndicator.classList.remove('disconnected');
        statusIndicator.classList.add('connected');
        statusText.textContent = 'Conectado';
    } else {
        statusIndicator.classList.remove('connected');
        statusIndicator.classList.add('disconnected');
        statusText.textContent = 'Desconectado';
        
        // Resetear indicador de cambio de gas
        isChangingGas = false;
        document.getElementById('changing-indicator').style.display = 'none';
    }
    
    // Actualizar estado de los botones
    updateGasButtonState();
}

// Añadir mensaje a la sección de mensajes
function addMessage(text) {
    const messages = document.getElementById('messages');
    const date = new Date();
    const timestamp = date.toLocaleTimeString();
    messages.innerHTML = `[${timestamp}] ${text}`;
}