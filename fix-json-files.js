// fix-json-files.js
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'sensor_data');

// Función para limpiar un archivo JSON
function fixJsonFile(fileName) {
  try {
    console.log(`Procesando archivo: ${fileName}`);
    
    // Leer el contenido del archivo
    let content = fs.readFileSync(fileName, 'utf8');
    
    // Eliminar comas finales antes del cierre del array
    content = content.replace(/,(\s*\])/, '$1');
    
    // Eliminar comas finales antes del cierre de objetos
    content = content.replace(/,(\s*\})/, '$1');
    
    // Intentar parsear el JSON
    let data;
    try {
      data = JSON.parse(content);
    } catch (parseError) {
      console.error(`Error al parsear ${fileName}:`, parseError.message);
      
      // Intentar una reparación más agresiva
      // Eliminar la última línea si es una coma sola
      const lines = content.split('\n');
      if (lines[lines.length - 2].trim() === ',') {
        lines.splice(lines.length - 2, 1);
        content = lines.join('\n');
      }
      
      // Intentar parsear de nuevo
      data = JSON.parse(content);
    }
    
    // Validar que cada registro tenga los campos necesarios
    if (Array.isArray(data)) {
      data = data.filter(record => {
        return record && 
               typeof record === 'object' && 
               record.timestamp !== undefined &&
               record.ppm !== undefined;
      });
    }
    
    // Guardar el archivo corregido
    fs.writeFileSync(fileName, JSON.stringify(data, null, 2));
    console.log(`✓ Archivo ${path.basename(fileName)} reparado exitosamente. Registros: ${data.length}`);
    
    return true;
  } catch (error) {
    console.error(`✗ Error al procesar ${fileName}:`, error.message);
    return false;
  }
}

// Procesar todos los archivos JSON en el directorio
function fixAllJsonFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    console.error(`El directorio ${DATA_DIR} no existe`);
    return;
  }
  
  const files = fs.readdirSync(DATA_DIR);
  const jsonFiles = files.filter(file => file.endsWith('.json'));
  
  if (jsonFiles.length === 0) {
    console.log('No se encontraron archivos JSON para procesar');
    return;
  }
  
  console.log(`Encontrados ${jsonFiles.length} archivos JSON para procesar...\n`);
  
  let successful = 0;
  let failed = 0;
  
  jsonFiles.forEach(file => {
    const filePath = path.join(DATA_DIR, file);
    if (fixJsonFile(filePath)) {
      successful++;
    } else {
      failed++;
    }
  });
  
  console.log(`\nResumen:`);
  console.log(`- Archivos reparados exitosamente: ${successful}`);
  console.log(`- Archivos con errores: ${failed}`);
}

// Ejecutar la reparación
console.log('=== Reparador de archivos JSON del sensor ===\n');
fixAllJsonFiles();