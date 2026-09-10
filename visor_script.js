/* =================================================================================
 * MEDISFARMA | visor_script.js
 * VISOR: consolidado de traslados, recepcion tecnica externa, novedades,
 * control de inventario, filtros, alertas de urgencias, medicion de tiempos,
 * APERTURA DEL DIA (rotacion diaria) y SEGURIDAD.
 * Toda la lectura se hace por NOMBRE DE CABECERA (nunca por indice de columna).
 * ================================================================================= */
'use strict';

const LS_KEY_VISOR = 'MF_CONFIG_VISOR';
const LS_DATA_CARGUE = 'MF_DATOS_SESION';

const VISOR_API_URL = 'https://script.google.com/macros/s/AKfycbxFRZ9X19FDTDifXadndOvdHKuLQ9DBN4Nk4iuIojMeY5uwos161_8qmZ7s3h6bQVyw/exec';

const VISOR_DEFAULTS = {
  apiUrl: VISOR_API_URL,
  modoLocal: false,
  folders: {
    despachos:   '1tUXm2FVVFWBnyeBrzTlRpobYTKxk7OH8',
    trasladosConsulta: '1u30YFhTsocLuUoFrVUnb6Fk9zwVsT_E_',
    logistica:   '1_e8ycbznm0jA4kOBwkJuXM4EVdcwXzYe',
    recepcion:   '1u5aQURkwKw4CqxejzOSxYgeF6dvcj-T0',
    novedades:   '1hpRjykdlFyU_nsdXb0ttqOJdHNoXcTG-',
    inventario:  '11Iml2ggmvAK8aHeUbDGeWbyhLxCtrPoY',
    facturacion: '1hpRjykdlFyU_nsdXb0ttqOJdHNoXcTG-',
    seguridad:   '1I8XfW5vjt5qFkhnd5m6anaUA9ETVHf_N',
    rotacion:    '106BTSHLA8giLcW8qkvbJWiqA_7KiDpBi',
    backup:      '1HVTZyLasrbZArTN34kmc0lCKaQa2qQ_5'
  },
  perfiles: {
    despachos:   { file: 'BD_PLANILLA_ENTREGA_DESPACHOS', sheet: 'DATOS' },
    trasladosConsulta: { multiFile: true, label: 'Traslados (carpeta multi-archivo)' },
    logistica:   { file: 'BD_LOGISTICA_DESPACHOS',         sheet: 'DATOS' },
    recepcion:   { file: 'BD_RECEPCION_TECNICA',           sheet: 'DATOS' },
    facturacion: { file: 'BD_FACTURA_TRANSPORTE',         sheet: 'DATOS' },
    inventario:  { file: 'BD_VERIFICACION_INVENTARIO',     sheet: 'DATOS' },
    seguridad:   { file: 'BD_SEGURIDAD_DESPACHOS',         sheet: 'DATOS' },
    rotacion:    { file: 'BD_ROTACION_DIARIA',             sheet: 'DATOS' }
  }
};

function cargarConfigVisor() {
  try {
    const raw = localStorage.getItem(LS_KEY_VISOR);
    const cfg = raw ? Object.assign({}, VISOR_DEFAULTS, JSON.parse(raw)) : Object.assign({}, VISOR_DEFAULTS);
    if (!cfg.apiUrl || cfg.apiUrl.trim() === '') cfg.apiUrl = VISOR_API_URL;
    if (cfg.apiUrl && cfg.apiUrl.trim() !== '' && cfg.modoLocal) {
      cfg.modoLocal = false;
    }
    /* Asegurar carpetas nuevas */
    if (!cfg.folders.seguridad) cfg.folders.seguridad = VISOR_DEFAULTS.folders.seguridad;
    if (!cfg.folders.rotacion) cfg.folders.rotacion = VISOR_DEFAULTS.folders.rotacion;
    if (!cfg.folders.trasladosConsulta) cfg.folders.trasladosConsulta = VISOR_DEFAULTS.folders.trasladosConsulta;
    return cfg;
  } catch (e) { return Object.assign({}, VISOR_DEFAULTS); }
}

let CONFIG = cargarConfigVisor();

/** Datos crudos por fuente y datos derivados. */
let FUENTES = { despachos: [], logistica: [], recepcion: [], novedades: [], inventario: [], facturacion: [], seguridad: [], rotacion: [], trasladosConsulta: [] };
let TRASLADOS = [];    // consolidado calculado
let CHARTS = {};
// Los grupos son fijos — no se necesita ROTACION_DIA ni historial

/* ---------------------------------------------------------------------------
 * 0. CREDENCIALES DE USUARIO (LOGIN)
 * ------------------------------------------------------------------------- */
const CREDENCIALES_VISOR = {
  administrador:       'Medis2024Admin',
  log_diego:           'Medis2024DiegoL',
  log_angelica:        'Medis2024AngelicaL',
  log_lorena:          'Medis2024LorenaL',
  log_jenny:           'Medis2024JennyL'
};
const LS_LOGIN_VISOR = 'MF_LOGIN_OK';
const LS_PERFIL_VISOR = 'MF_PERFIL_ACTIVO';

function verificarLoginVisor() {
  const usuario = val('loginUsuarioVisor');
  const clave   = val('loginContrasenaVisor');
  const errDiv  = $('loginErrorVisor');

  if (!usuario) {
    errDiv.style.display = 'block';
    errDiv.textContent = 'Seleccione un perfil.'; return;
  }
  if (CREDENCIALES_VISOR[usuario] && CREDENCIALES_VISOR[usuario].toLowerCase() === clave.toLowerCase()) {
    localStorage.setItem(LS_LOGIN_VISOR, usuario);
    localStorage.setItem(LS_PERFIL_VISOR, usuario);
    $('pantallaLoginVisor').style.display = 'none';
    document.body.classList.remove('mf-login-activo');
    errDiv.style.display = 'none';
    toast('Sesion iniciada como <strong>' + (PERFILES_LABEL[usuario] || usuario) + '</strong>', 'success');
  } else {
    errDiv.style.display = 'block';
    errDiv.textContent = 'Usuario o contrasena incorrectos';
    $('loginContrasenaVisor').value = '';
    $('loginContrasenaVisor').focus();
  }
}

function cerrarSesionVisor() {
  localStorage.removeItem(LS_LOGIN_VISOR);
  localStorage.removeItem(LS_PERFIL_VISOR);
  $('pantallaLoginVisor').style.display = 'flex';
  document.body.classList.add('mf-login-activo');
  $('loginUsuarioVisor').value = '';
  $('loginContrasenaVisor').value = '';
  $('loginErrorVisor').style.display = 'none';
  toast('Sesion cerrada.', 'info');
}

const PERFILES_LABEL = {
  administrador: 'ADMINISTRADOR',
  log_diego: 'Diego (Logistica CENDIS)',
  log_angelica: 'Angelica (Logistica CENDIS)',
  log_lorena: 'Lorena (Logistica CENDIS)',
  log_jenny: 'Jenny (Logistica CENDIS)'
};

/* ---------------------------------------------------------------------------
 * 1. UTILIDADES BASE + LECTURA DINAMICA POR NOMBRE DE COLUMNA
 * ------------------------------------------------------------------------- */
const $ = id => document.getElementById(id);
const val = id => ($(id) ? String($(id).value || '').trim() : '');

function esc(t) {
  return String(t === undefined || t === null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function toast(msg, type) {
  var tw = document.getElementById('toastWrap');
  if (!tw) return;
  var d = document.createElement('div');
  var bg = type==='success'?'alert-success':type==='danger'?'alert-danger':type==='warning'?'alert-warning':'alert-info';
  d.className = 'alert ' + bg + ' shadow-sm py-2 px-3 small';
  d.innerHTML = msg;
  tw.appendChild(d);
  setTimeout(function(){ if(d.parentNode) d.remove(); }, 5000);
}

function normalizarCabecera(texto) {
  if (texto === null || texto === undefined) return '';
  return String(texto)
    .replace(/\u00A0/g, ' ')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function obtenerValorPorNombreColumna(fila, nombreColumna) {
  const alias = Array.isArray(nombreColumna) ? nombreColumna : [nombreColumna];
  if (!fila) return '';
  if (!fila.__idx) {
    const idx = {};
    Object.keys(fila).forEach(k => { idx[normalizarCabecera(k)] = fila[k]; });
    Object.defineProperty(fila, '__idx', { value: idx, enumerable: false });
  }
  for (const a of alias) {
    const v = fila.__idx[normalizarCabecera(a)];
    if (v !== undefined && v !== '') return v;
  }
  return '';
}

/** Alias tolerantes para cada campo del sistema. */
const A = {
  marca:        ['Marca temporal', 'Fecha Inicial', 'Timestamp'],
  correo:       ['Direccion de correo electronico', 'Correo'],
  origen:       ['Bodega Origen', 'BODEGA ORIGEN DEL TRASLADO', 'Bodega Origen Extrema', 'Bodega Origen Emisora'],
  traslado:     ['Documento TRASLADO', 'TRASLADO', 'Documento Traslado', 'Numero Traslado'],
  alista:       ['QUIEN ALISTA', 'Responsable de Empacar / Rotular', 'Quien Alista'],
  destino:      ['DESTINO', 'BODEGA DESTINO DEL TRASLADO', 'Bodega Destino (CENDIS / B05)', 'Bodega Destino'],
  zona:         ['ZONA'],
  seguimiento:  ['SEGUIMIENTO'],
  respCendis:   ['RESPONSABLE DE ENTREGA CENDIS', 'Responsable de Entrega', 'Responsable Entrega CENDIS'],
  tipo:         ['TIPO'],
  fEntregaLog:  ['FECHA ENTREGA LOGISTICA', 'Fecha y Hora de Registro Logistico'],
  recibeLog:    ['QUIEN RECIBE LOGISTICA'],
  fPlanilla:    ['FECHA PLANILLA ENVIO LOGISTICA', 'Fecha de Envio del Traslado'],
  conductor:    ['CONDUCTOR', 'Responsable de Envio'],
  planilla:     ['PLANILLA'],
  fRecibidoPto: ['FECHA RECIBIDO EN PUNTO'],
  quienRecibe:  ['QUIN RECIBE', 'QUIEN RECIBE', 'Quien Recibe en Punto', 'Quien Recibio'],
  mes:          ['mes', 'MES'],
  urgente:      ['Urgente', 'URGENTE'],
  cantidad:     ['Cantidad', 'CANTIDAD'],
  // Recepcion tecnica
  fRecepcion:   ['Fecha Recepcion Tecnica', 'Fecha Recepcion'],
  codigo:       ['Codigo Producto / Molecula', 'Codigo Producto', 'Molecula / Medicamento'],
  descripcion:  ['Descripcion'],
  lote:         ['Lote'],
  vencimiento:  ['Fecha Vencimiento'],
  cantEnviada:  ['Cantidad Enviada'],
  cantRecibida: ['Cantidad Recibida', 'Cantidad Unidades Recibidas'],
  estadoRec:    ['Estado Recepcion Tecnica', 'Estado'],
  respRec:      ['Responsable de Recepcion', 'Nombre Recepcionista'],
  observaciones:['Observaciones', 'OBSERVACION', 'Observacion'],
  tipoRecepcion:['Tipo de Recepcion'],
  // Novedades
  causa:        ['CAUSA DE ANULACION O MODIFICACION', 'CAUSA DE ANULACION Ó MODIFICACIÓN', 'Causa'],
  solicita:     ['NOMBRE DE QUIEN SOLICITA LA CORRECION', 'Nombre de quien solicita la correccion'],
  telefono:     ['NUMERO DE TELEFONO DE CONTACTO', 'Telefono'],
  solucionado:  ['SOLUCIONADO'],
  // Inventario
  bodegaInv:    ['Bodega (CENDIS / B05)', 'Bodega a Verificar', 'Bodega'],
  respInv:      ['Responsable Asignado'],
  molecula:     ['Molecula / Medicamento', 'Molecula'],
  teorica:      ['Cantidad Teorica'],
  fisica:       ['Cantidad Fisica'],
  diferencia:   ['Diferencia', 'Diferencia / Novedad'],
  estadoInv:    ['Estado / Novedad', 'Estado Verificacion'],
  // Seguridad (nueva tarjeta)
  guia:         ['Guia', 'Guia de Remision'],
  facturaSeg:   ['Factura', 'Numero Factura'],
  proveedor:    ['Proveedor', 'Proveedor Despachos'],
  unidadesSeg:  ['Unidades', 'Cantidad Unidades Seguridad'],
  quienRecibeSeg:['Quien Recibe', 'Recibe Seguridad'],
  // Rotacion
  quienAlisto:  ['Quien Alisto', 'Quien Alista', 'QUIEN ALISTO'],
  quienPito:   ['Quien Pito', 'Quien Pita', 'QUIEN PITO'],
  quienEmpaco: ['Quien Empaco', 'Quien Empaca', 'QUIEN EMPACO'],
  tipoCarga:    ['Tipo Carga', 'TIPO CARGA'],
  concepto:     ['Concepto', 'CONCEPTO'],
  // Logistica - Revisado
  revisado:     ['Revisado', 'REVISADO']
};

/** Convierte texto de fecha (varios formatos) a Date o null. */
function aFecha(texto) {
  if (!texto) return null;
  if (texto instanceof Date) return texto;
  let s = String(texto).trim().replace('T', ' ');
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function horasEntre(desde, hasta) {
  const a = aFecha(desde), b = aFecha(hasta);
  if (!a || !b) return null;
  const h = (b - a) / 3600000;
  return h < 0 ? null : h;
}

function formatoDuracion(horas) {
  if (horas === null || horas === undefined || isNaN(horas)) return '--';
  const total = Math.round(horas * 60);
  const d = Math.floor(total / 1440), h = Math.floor((total % 1440) / 60), m = total % 60;
  return (d ? d + 'd ' : '') + (h ? h + 'h ' : '') + m + 'm';
}

function promedio(lista) {
  const v = lista.filter(x => x !== null && !isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function esSi(v) { return normalizarCabecera(v) === 'si'; }

/* ---------------------------------------------------------------------------
 * MAPA BODEGA → ZONA
 * ------------------------------------------------------------------------- */
const BODEGA_ZONA_MAP = {"M111 B/G SAN MIGUEL":"ZONA CUNDINAMARCA","M111 B/G CHOACHI":"ZONA CUNDINAMARCA","M111 B/G CHIA":"ZONA CUNDINAMARCA","M111 B/G SOPO":"ZONA CUNDINAMARCA","M111 B/G CAJICA":"ZONA CUNDINAMARCA","M111 B/G COTA":"ZONA CUNDINAMARCA","M111 B/G FACATATIVA":"ZONA CUNDINAMARCA","M111 B/G MOSQUERA":"ZONA CUNDINAMARCA","M111 B/G MADRID":"ZONA CUNDINAMARCA","M111 B/G FUNZA":"ZONA CUNDINAMARCA","M111 B/G LA CALERA":"ZONA CUNDINAMARCA","M111 B/G SOACHA":"ZONA CUNDINAMARCA","M111 B/G ZIPAQUIRA":"ZONA CUNDINAMARCA","M111 B/G SIBATE":"ZONA CUNDINAMARCA","M111 B/G BOGOTA":"ZONA CUNDINAMARCA","M112 B/G IPIALES":"ZONA NARIÑO","M112 B/G TUMACO":"ZONA NARIÑO","M112 B/G TUQUERRES":"ZONA NARIÑO","M112 B/G PASTO":"ZONA NARIÑO","M112 B/G SAMANIEGO":"ZONA NARIÑO","M112 B/G LA UNION":"ZONA NARIÑO","M112 B/G ILLANO":"ZONA NARIÑO","M113 B/G SANTANDER DE QUILICHAO":"ZONA CAUCA NORTE","M113 B/G PUERTO TEJADA":"ZONA CAUCA NORTE","M113 B/G CALOTO":"ZONA CAUCA NORTE","M113 B/G PADILLA":"ZONA CAUCA NORTE","M113 B/G VILLARRICA":"ZONA CAUCA NORTE","M113 B/G SANTANDER DE QUILICHAO 2":"ZONA CAUCA NORTE","M114 B/G POPAYAN":"ZONA CAUCA SUR","M114 B/G PATIA":"ZONA CAUCA SUR","M114 B/G EL TAMBO":"ZONA CAUCA SUR","M114 B/G ARGELIA":"ZONA CAUCA SUR","M114 B/G TIMBIO":"ZONA CAUCA SUR","M114 B/G PIENDAMO":"ZONA CAUCA SUR","M115 B/G SOTARA":"ZONA CAUCA CENTRO","M115 B/G PAEZ":"ZONA CAUCA CENTRO","M115 B/G INZA":"ZONA CAUCA CENTRO","M115 B/G SILVIA":"ZONA CAUCA CENTRO","M115 B/G TORO":"ZONA CAUCA CENTRO","M116 B/G TUNJA":"ZONA BOYACA","M116 B/G DUITAMA":"ZONA BOYACA","M116 B/G SOGAMOSO":"ZONA BOYACA","M116 B/G CHIQUINQUIRA":"ZONA BOYACA","M116 B/G MONIQUIRA":"ZONA BOYACA","M116 B/G PAIPA":"ZONA BOYACA","M116 B/G PUERTO BOYACA":"ZONA BOYACA","M117 B/G FLORENCIA":"ZONA CAQUETA","M117 B/G SAN VICENTE":"ZONA CAQUETA","M117 B/G EL DONCELLO":"ZONA CAQUETA","M117 B/G MORELIA":"ZONA CAQUETA","M117 B/G PUERTO RICO":"ZONA CAQUETA","M118 B/G BUGA":"ZONA VALLE","M118 B/G TULUA":"ZONA VALLE","M118 B/G BUGALAGRANDE":"ZONA VALLE","M118 B/G PALMIRA":"ZONA VALLE","M118 B/G YUMBO":"ZONA VALLE","M118 B/G CARTAGO":"ZONA VALLE","M118 B/G LA UNION":"ZONA VALLE","M118 B/G SEVILLA":"ZONA VALLE","M118 B/G ROLDANILLO":"ZONA VALLE","M118 B/G CAICEDONIA":"ZONA VALLE","M119 B/G PEREIRA":"ZONA EJE CAFETERO","M119 B/G MANIZALES":"ZONA EJE CAFETERO","M119 B/G DOSQUEBRADAS":"ZONA EJE CAFETERO","M119 B/G SANTA ROSA DE CABAL":"ZONA EJE CAFETERO","M119 B/G CHINCHINA":"ZONA EJE CAFETERO","M119 B/G FILANDIA":"ZONA EJE CAFETERO","M119 B/G SALAMINA":"ZONA EJE CAFETERO","M120 B/G IBAGUE":"ZONA TOLIMA","M120 B/G ESPINAL":"ZONA TOLIMA","M120 B/G MELGAR":"ZONA TOLIMA","M120 B/G HONDA":"ZONA TOLIMA","M120 B/G LIBANO":"ZONA TOLIMA","M120 B/G MURILLO":"ZONA TOLIMA","M120 B/G LERIDA":"ZONA TOLIMA","M120 B/G AMBALEMA":"ZONA TOLIMA","M121 B/G SANTA MARTA":"ZONA COSTA NORTE","M121 B/G BARRANQUILLA":"ZONA COSTA NORTE","M121 B/G CARTAGENA":"ZONA COSTA NORTE","M121 B/G SOLEDAD":"ZONA COSTA NORTE","M121 B/G VALLEDUPAR":"ZONA COSTA NORTE","M121 B/G SINCELEJO":"ZONA COSTA NORTE","M121 B/G MONTERIA":"ZONA COSTA NORTE","M111 B/G USAQUEN":"ZONA CUNDINAMARCA","M111 B/G SUBA":"ZONA CUNDINAMARCA","M111 B/G ENGATIVA":"ZONA CUNDINAMARCA","M111 B/G BARRIOS UNIDOS":"ZONA CUNDINAMARCA","M111 B/G TEUSAQUILLO":"ZONA CUNDINAMARCA","M111 B/G LOS MARTIRES":"ZONA CUNDINAMARCA","M111 B/G PUENTE ARANDA":"ZONA CUNDINAMARCA","M111 B/G KENNEDY":"ZONA CUNDINAMARCA","M111 B/G FONTIBON":"ZONA CUNDINAMARCA","M111 B/G RAFAEL URIBE":"ZONA CUNDINAMARCA","M111 B/G SAN CRISTOBAL":"ZONA CUNDINAMARCA","M111 B/G BOSA":"ZONA CUNDINAMARCA","M111 B/G TUNJUELITO":"ZONA CUNDINAMARCA","M111 B/G ANTONIO NARIÑO":"ZONA CUNDINAMARCA","M111 B/G USME":"ZONA CUNDINAMARCA","M111 B/G RAFAEL URIBE URIBE":"ZONA CUNDINAMARCA","B/G PRINCIPAL":"BODEGA","B/G BODEGA PRINCIPAL":"BODEGA","B/G CEDI BOGOTA":"BODEGA","B/G CEDI":"BODEGA","B/G BODEGA VIRTUAL":"BODEGA VIRTUAL","B/G BODEGA VALLE":"BODEGA VALLE","B/G CERRADA":"CERRADA","B/G LOCAL":"LOCAL Y ACTIVOS","B/G ACTIVOS":"LOCAL Y ACTIVOS"};

const ZONAS_LISTA = [
  'ZONA CUNDINAMARCA', 'ZONA NARIÑO', 'ZONA CAUCA NORTE', 'ZONA CAUCA SUR',
  'ZONA CAUCA CENTRO', 'ZONA BOYACA', 'ZONA CAQUETA', 'ZONA VALLE',
  'ZONA EJE CAFETERO', 'ZONA TOLIMA', 'ZONA COSTA NORTE', 'BODEGA',
  'BODEGA VALLE', 'BODEGA VIRTUAL', 'CERRADA', 'LOCAL Y ACTIVOS'
];

function zonaDeBodega(nombreBodega) {
  if (!nombreBodega) return '';
  const nb = String(nombreBodega).trim();
  if (BODEGA_ZONA_MAP[nb]) return BODEGA_ZONA_MAP[nb];
  const nbNorm = normalizarCabecera(nb);
  for (const [bodega, zona] of Object.entries(BODEGA_ZONA_MAP)) {
    if (normalizarCabecera(bodega) === nbNorm) return zona;
  }
  for (const [bodega, zona] of Object.entries(BODEGA_ZONA_MAP)) {
    if (bodega.toUpperCase().startsWith(nb.substring(0, 4).toUpperCase())) return zona;
  }
  return '';
}

/* ---------------------------------------------------------------------------
 * 2. CARGA DE DATOS (Drive via Web App, o datos locales del modulo de Cargue)
 * ------------------------------------------------------------------------- */
async function api(action, payload = {}) {
  if (!CONFIG.apiUrl) throw new Error('No se ha configurado la URL de la Web App.');
  const fullPayload = Object.assign({ action }, payload);
  try {
    // INTENTO 1: POST con text/plain (evita preflight CORS)
    const res = await fetch(CONFIG.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      body: JSON.stringify(fullPayload)
    });
    const ct = res.headers.get('Content-Type') || '';
    if (ct.includes('text/html')) {
      throw new Error('AUTH_REQUIRED');
    }
    const data = await res.json();
    if (data.ok === false) throw new Error(data.error || 'Error del backend');
    return data;
  } catch (e) {
    // Auth redirect — no reintentar
    if (e.message === 'AUTH_REQUIRED') {
      throw new Error('La Web App requiere autenticacion. Desplieguela con acceso "Cualquier usuario" (publico).');
    }
    // Network error — reintentar con GET
    if (e.message && (e.message.includes('Failed to fetch') || e.message.includes('NetworkError'))) {
      console.log('[api] POST fallo, reintentando con GET...');
      try {
        return await apiGetFallback(fullPayload);
      } catch (e2) {
        throw new Error('No se pudo conectar a la Web App (POST y GET fallaron). Verifique: 1) La URL es correcta, 2) La Web App esta desplegada como "Cualquier usuario" (acceso publico), 3) No hay redireccion a login de Google.');
      }
    }
    throw e;
  }
}

async function apiGetFallback(payload) {
  const params = [];
  for (const key in payload) {
    if (payload.hasOwnProperty(key)) {
      params.push(encodeURIComponent(key) + '=' + encodeURIComponent(typeof payload[key] === 'object' ? JSON.stringify(payload[key]) : payload[key]));
    }
  }
  const getUrl = CONFIG.apiUrl + (CONFIG.apiUrl.includes('?') ? '&' : '?') + params.join('&') + '&_t=' + Date.now();
  const res = await fetch(getUrl, { method: 'GET', redirect: 'follow' });
  const ct = res.headers.get('Content-Type') || '';
  if (ct.includes('text/html')) {
    throw new Error('AUTH_REQUIRED');
  }
  const data = await res.json();
  if (data.ok === false) throw new Error(data.error || 'Error del backend');
  return data;
}

async function cargarDatos() {
  $('estadoApi').className = 'badge bg-light text-dark';
  $('estadoApi').textContent = 'Cargando...';

  if (!CONFIG.apiUrl) {
    const local = JSON.parse(localStorage.getItem(LS_DATA_CARGUE) || '{}');
    FUENTES = {
      despachos: local.despachos || [], logistica: local.logistica || [],
      recepcion: local.recepcion || [], novedades: local.novedades || [],
      inventario: local.inventario || [], facturacion: local.facturacion || [],
      seguridad: local.seguridad || [], rotacion: local.rotacion || [],
      trasladosConsulta: local.trasladosConsulta || []
    };
    $('estadoApi').className = 'badge bg-warning text-dark';
    $('estadoApi').textContent = 'Sin URL de Web App';
    toast('Configure la URL de la Web App en Ajustes para leer datos de Drive.', 'warning');
  } else if (CONFIG.modoLocal) {
    const local = JSON.parse(localStorage.getItem(LS_DATA_CARGUE) || '{}');
    FUENTES = {
      despachos: local.despachos || [], logistica: local.logistica || [],
      recepcion: local.recepcion || [], novedades: local.novedades || [],
      inventario: local.inventario || [], facturacion: local.facturacion || [],
      seguridad: local.seguridad || [], rotacion: local.rotacion || [],
      trasladosConsulta: local.trasladosConsulta || []
    };
    $('estadoApi').className = 'badge bg-secondary';
    $('estadoApi').textContent = 'Modo local';
  } else {
    try {
      const r = await api('consolidadoVisor', { folderIds: CONFIG.folders });
      Object.keys(FUENTES).forEach(m => {
        FUENTES[m] = (r.fuentes[m] && r.fuentes[m].rows) ? r.fuentes[m].rows : [];
      });
      $('estadoApi').className = 'badge bg-success';
      $('estadoApi').textContent = 'Conectado a Drive';
    } catch (e) {
      $('estadoApi').className = 'badge bg-danger';
      $('estadoApi').textContent = 'Error de conexion';
      toast('Error al conectar con Drive: ' + e.message + '. Usando datos locales.', 'danger');
      const local = JSON.parse(localStorage.getItem(LS_DATA_CARGUE) || '{}');
      FUENTES = {
        despachos: local.despachos || [], logistica: local.logistica || [],
        recepcion: local.recepcion || [], novedades: local.novedades || [],
        inventario: local.inventario || [], facturacion: local.facturacion || [],
        seguridad: local.seguridad || [], rotacion: local.rotacion || [],
        trasladosConsulta: local.trasladosConsulta || []
      };
      console.warn(e);
    }
  }

  construirConsolidado();
  poblarFiltros();
  refrescarTodo();
}

async function probarConexion() {
  const btn = $('btnProbarApi');
  const badge = $('estadoApi');
  if (btn) { btn.disabled = true; btn.innerHTML = '&#8987; Probando...'; }
  badge.className = 'badge bg-warning text-dark';
  badge.textContent = 'Probando conexion...';

  // Primero probar con GET directo (mas confiable para CORS con Apps Script)
  try {
    const pingUrl = CONFIG.apiUrl + '?action=ping&_t=' + Date.now();
    const res = await fetch(pingUrl, { method: 'GET', redirect: 'follow' });
    const ct = res.headers.get('Content-Type') || '';
    if (ct.includes('text/html')) {
      badge.className = 'badge bg-danger';
      badge.textContent = 'Sin acceso';
      toast('<strong>Error de autenticacion:</strong> La Web App esta desplegada con acceso restringido.<br>' +
        '<em>Solucion:</em> En Apps Script vaya a <strong>Implementar > Nueva implementacion > Web app</strong><br>' +
        'y cambie <strong>"Quien tiene acceso"</strong> a <strong>"Cualquier usuario"</strong> (publico).', 'danger');
      if (btn) { btn.disabled = false; btn.innerHTML = '&#127760; Probar Conexion'; }
      return;
    }
    const data = await res.json();
    if (data && data.ok) {
      badge.className = 'badge bg-success';
      badge.textContent = 'Conectado a Drive';
      toast('Conexion exitosa con Google Drive', 'success');
      if (btn) { btn.disabled = false; btn.innerHTML = '&#127760; Probar Conexion'; }
      return;
    }
  } catch (getErr) {
    console.log('[probarConexion] GET fallo, probando POST...', getErr);
  }

  // Fallback: probar con POST via api()
  try {
    await api('ping');
    badge.className = 'badge bg-success';
    badge.textContent = 'Conectado a Drive';
    toast('Conexion exitosa via POST.', 'success');
  } catch (e) {
    badge.className = 'badge bg-danger';
    badge.textContent = 'Sin conexion';
    let msg = e.message || 'Error desconocido';
    if (msg.includes('Failed to fetch') || msg.includes('No se pudo conectar')) {
      msg = '<strong>No se pudo conectar.</strong> Posibles causas:<br>' +
        '1. <strong>Acceso restringido:</strong> Despliegue la Web App con "Quien tiene acceso: Cualquier usuario"<br>' +
        '2. <strong>URL incorrecta:</strong> Verifique que la URL sea del despliegue actual<br>' +
        '3. <strong>CORS:</strong> Abra la URL directamente en el navegador para verificarla<br>' +
        '4. <strong>Bloqueador:</strong> Desactive extensiones como AdBlocker';
    }
    toast('Error: ' + msg, 'danger');
    console.error('Prueba de conexion fallida:', e);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '&#127760; Probar Conexion'; }
  }
}

/* ---------------------------------------------------------------------------
 * 3. CONSOLIDADO DE TRASLADOS (despachos + logistica + novedades + rotacion)
 * ------------------------------------------------------------------------- */

/**
 * Une los registros por numero de traslado. Incorpora datos de rotacion
 * (Quien Alisto, Quien Pito, Quien Empaco, Tipo Carga, Concepto) desde
 * la fuente de despachos donde se guardaron en el Cargue T3.
 */
function construirConsolidado() {
  const mapa = new Map();

  const agregar = fila => {
    const clave = normalizarCabecera(obtenerValorPorNombreColumna(fila, A.traslado));
    if (!clave) return;
    if (!mapa.has(clave)) mapa.set(clave, {});
    const acc = mapa.get(clave);
    Object.keys(fila).forEach(k => {
      if (k.indexOf('__') === 0) return;
      const v = fila[k];
      if (v !== '' && v !== null && v !== undefined) acc[k] = v;
    });
  };

  FUENTES.despachos.forEach(agregar);
  FUENTES.logistica.forEach(agregar);

  const novedadesPorTraslado = new Map();
  FUENTES.novedades.forEach(n => {
    const clave = normalizarCabecera(obtenerValorPorNombreColumna(n, A.traslado));
    if (clave) novedadesPorTraslado.set(clave, n);
  });

  TRASLADOS = Array.from(mapa.entries()).map(([clave, r]) => {
    const nov = novedadesPorTraslado.get(clave) || null;
    const marca = obtenerValorPorNombreColumna(r, A.marca);
    const fEntregaLog = obtenerValorPorNombreColumna(r, A.fEntregaLog);
    const fPlanilla = obtenerValorPorNombreColumna(r, A.fPlanilla);
    const fRecibido = obtenerValorPorNombreColumna(r, A.fRecibidoPto);

    let estado;
    if (fRecibido) estado = 'CUMPLIDO';
    else if (nov) estado = 'CUMPLIDO';
    else if (fPlanilla) estado = 'EN TRANSITO';
    else estado = 'PENDIENTE';

    const urgente = obtenerValorPorNombreColumna(r, A.urgente);

    /* Campos de rotacion enriquecidos (vienen del Cargue T3 → BD_PLANILLA_ENTREGA_DESPACHOS) */
    const quienAlisto  = obtenerValorPorNombreColumna(r, A.quienAlisto);
    const quienPito    = obtenerValorPorNombreColumna(r, A.quienPito);
    const quienEmpaco  = obtenerValorPorNombreColumna(r, A.quienEmpaco);
    const tipoCarga    = obtenerValorPorNombreColumna(r, A.tipoCarga);
    const concepto     = obtenerValorPorNombreColumna(r, A.concepto);

    return {
      crudo: r,
      novedad: nov,
      traslado: obtenerValorPorNombreColumna(r, A.traslado),
      marca, fEntregaLog, fPlanilla, fRecibido,
      fechaInicial: marca,
      origen: obtenerValorPorNombreColumna(r, A.origen),
      destino: obtenerValorPorNombreColumna(r, A.destino),
      zona: obtenerValorPorNombreColumna(r, A.zona) || zonaDeBodega(obtenerValorPorNombreColumna(r, A.destino)) || zonaDeBodega(obtenerValorPorNombreColumna(r, A.origen)),
      urgente: urgente || 'NO',
      estado,
      tieneNovedad: !!nov,
      novedadResuelta: nov ? normalizarCabecera(obtenerValorPorNombreColumna(nov, A.solucionado)) : '',
      tAlistamiento: horasEntre(marca, fEntregaLog),
      tEsperaDespacho: horasEntre(fEntregaLog, fPlanilla),
      tTransito: horasEntre(fPlanilla, fRecibido),
      /* Campos enriquecidos */
      quienAlisto,
      quienPito,
      quienEmpaco,
      tipoCarga,
      concepto
    };
  });
}

/* ---------------------------------------------------------------------------
 * 4. FILTROS
 * ------------------------------------------------------------------------- */
function poblarFiltros() {
  const llenar = (id, valores) => {
    const sel = $(id);
    const actual = sel.value;
    sel.innerHTML = '<option value="">Todos</option>' +
      Array.from(new Set(valores.filter(Boolean))).sort()
        .map(v => `<option>${esc(v)}</option>`).join('');
    sel.value = actual;
  };
  llenar('f_origen', TRASLADOS.map(t => t.origen));
  llenar('f_destino', TRASLADOS.map(t => t.destino));
  llenar('f_zona', TRASLADOS.map(t => t.zona).concat(ZONAS_LISTA));
}

function dentroDeRango(fechaTexto) {
  const d = aFecha(fechaTexto);
  const desde = val('f_desde') ? aFecha(val('f_desde')) : null;
  const hasta = val('f_hasta') ? aFecha(val('f_hasta')) : null;
  if (!d) return !desde && !hasta;
  if (desde && d < desde) return false;
  if (hasta) { const fin = new Date(hasta); fin.setHours(23, 59, 59); if (d > fin) return false; }
  return true;
}

function trasladosFiltrados() {
  const fo = val('f_origen'), fd = val('f_destino'), fz = val('f_zona');
  const fe = val('f_estado'), fu = val('f_urgente');
  const q = normalizarCabecera(val('buscar_s1'));
  const ult5 = val('buscar_traslado_5').trim();
  return TRASLADOS.filter(t => {
    if (!dentroDeRango(t.fechaInicial)) return false;
    if (fo && t.origen !== fo) return false;
    if (fd && t.destino !== fd) return false;
    if (fz && t.zona !== fz) return false;
    if (fu && normalizarCabecera(t.urgente) !== normalizarCabecera(fu)) return false;
    if (fe === 'NOVEDAD' && !t.tieneNovedad) return false;
    if (fe && fe !== 'NOVEDAD' && t.estado !== fe) return false;
    if (q && !normalizarCabecera(JSON.stringify(t.crudo)).includes(q)) return false;
    if (ult5) {
      const numTraslado = String(obtenerValorPorNombreColumna(t.crudo, A.traslado) || '').trim();
      if (numTraslado.slice(-5) !== ult5) return false;
    }
    return true;
  });
}

function urgenteEnRiesgo(t) {
  return esSi(t.urgente) && t.estado !== 'CUMPLIDO';
}

/* ---------------------------------------------------------------------------
 * 5. INDICADORES (KPIs) Y TIEMPOS POR PROCESO
 * ------------------------------------------------------------------------- */
function pintarKpis(lista) {
  const cumplidos = lista.filter(t => t.estado === 'CUMPLIDO').length;
  const pendientes = lista.filter(t => t.estado !== 'CUMPLIDO').length;
  const urgentes = lista.filter(urgenteEnRiesgo).length;

  const novedades = FUENTES.novedades.filter(n => dentroDeRango(obtenerValorPorNombreColumna(n, A.marca)));
  const abiertas = novedades.filter(n => normalizarCabecera(obtenerValorPorNombreColumna(n, A.solucionado)) !== 'si').length;

  const inv = inventarioFiltrado();
  const difInv = inv.filter(i => Number(obtenerValorPorNombreColumna(i, A.diferencia) || 0) !== 0).length;

  $('kpi_total').textContent = lista.length;
  $('kpi_cumplidos').textContent = cumplidos;
  $('kpi_cumplimiento').textContent = (lista.length ? Math.round(cumplidos * 100 / lista.length) : 0) + '% de cumplimiento';
  $('kpi_pendientes').textContent = pendientes;
  $('kpi_urgentes').textContent = urgentes;
  $('kpi_novedades').textContent = novedades.length;
  $('kpi_novedades_abiertas').textContent = abiertas + ' sin solucionar';
  $('kpi_dif_inv').textContent = difInv;

  const pAlist = promedio(lista.map(t => t.tAlistamiento));
  const pEspera = promedio(lista.map(t => t.tEsperaDespacho));
  const pTransito = promedio(lista.map(t => t.tTransito));
  $('kpi_t_alist').textContent = formatoDuracion(pAlist);
  $('kpi_t_espera').textContent = formatoDuracion(pEspera);
  $('kpi_t_transito').textContent = formatoDuracion(pTransito);

  pintarGraficas(lista, pAlist, pEspera, pTransito);
}

function pintarGraficas(lista, pAlist, pEspera, pTransito) {
  const conteo = { CUMPLIDO: 0, 'EN TRANSITO': 0, PENDIENTE: 0 };
  lista.forEach(t => { conteo[t.estado] = (conteo[t.estado] || 0) + 1; });

  const porZona = {};
  lista.forEach(t => { const z = t.zona || 'SIN ZONA'; porZona[z] = (porZona[z] || 0) + 1; });

  dibujar('chartEstados', 'doughnut', Object.keys(conteo), [{
    data: Object.values(conteo),
    backgroundColor: ['#2fb457', '#0d6efd', '#ffc107']
  }], { plugins: { legend: { position: 'bottom' } } });

  dibujar('chartZonas', 'bar', Object.keys(porZona), [{
    label: 'Traslados', data: Object.values(porZona), backgroundColor: '#0d6efd'
  }], { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } });

  dibujar('chartTiempos', 'bar',
    ['Alistamiento', 'Espera despacho', 'Transito'],
    [{
      label: 'Horas promedio',
      data: [pAlist || 0, pEspera || 0, pTransito || 0].map(v => Math.round(v * 10) / 10),
      backgroundColor: ['#2fb457', '#0d6efd', '#8e44ad']
    }],
    { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } });
}

function dibujar(canvasId, tipo, labels, datasets, opciones) {
  if (CHARTS[canvasId]) CHARTS[canvasId].destroy();
  CHARTS[canvasId] = new Chart($(canvasId), {
    type: tipo,
    data: { labels, datasets },
    options: Object.assign({ responsive: true, maintainAspectRatio: false }, opciones || {})
  });
}

/* ---------------------------------------------------------------------------
 * 6. RENDERIZADO DE TABLAS
 * ------------------------------------------------------------------------- */

function pintarTabla(headId, bodyId, columnas, filas, claseFila) {
  const head = $(headId), body = $(bodyId);
  head.innerHTML = columnas.map(c => `<th>${esc(c.titulo)}</th>`).join('');
  body.innerHTML = '';
  filas.forEach(f => {
    const tr = document.createElement('tr');
    const cls = claseFila ? claseFila(f) : '';
    if (cls) tr.className = cls;
    columnas.forEach(c => {
      const td = document.createElement('td');
      const v = c.fn ? c.fn(f) : obtenerValorPorNombreColumna(f.crudo || f, c.alias);
      if (c.html) td.innerHTML = v;
      else td.textContent = v;
      if (c.clase) td.className = c.clase(f);
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
}

function badgeEstado(estado) {
  const m = { 'CUMPLIDO': 'est-cumplido', 'EN TRANSITO': 'est-transito', 'PENDIENTE': 'est-pendiente', 'NOVEDAD': 'est-novedad' };
  return `<span class="badge-est ${m[estado] || 'est-pendiente'}">${esc(estado)}</span>`;
}

/* ---------- SECCION 1: consolidado de traslados (con campos enriquecidos) ---------- */
function pintarSeccion1(lista) {
  const columnas = [
    { titulo: 'Marca temporal', alias: A.marca },
    { titulo: 'Correo electronico', alias: A.correo },
    { titulo: 'Bodega Origen', alias: A.origen },
    { titulo: 'Documento TRASLADO', alias: A.traslado },
    { titulo: 'QUIEN ALISTA', alias: A.alista },
    { titulo: 'DESTINO', alias: A.destino },
    { titulo: 'ZONA', alias: A.zona },
    { titulo: 'Urgente', fn: t => t.urgente, html: false },
    { titulo: 'SEGUIMIENTO', fn: t => badgeEstado(t.estado), html: true },
    { titulo: 'RESPONSABLE ENTREGA CENDIS', alias: A.respCendis },
    { titulo: 'TIPO', alias: A.tipo },
    { titulo: 'FECHA ENTREGA LOGISTICA', alias: A.fEntregaLog },
    { titulo: 'QUIEN RECIBE LOGISTICA', alias: A.recibeLog },
    { titulo: 'FECHA PLANILLA ENVIO LOGISTICA', alias: A.fPlanilla },
    { titulo: 'CONDUCTOR', alias: A.conductor },
    { titulo: 'PLANILLA', alias: A.planilla },
    { titulo: 'FECHA RECIBIDO EN PUNTO', alias: A.fRecibidoPto },
    { titulo: 'QUIN RECIBE', alias: A.quienRecibe },
    { titulo: 'mes', alias: A.mes },
    /* --- Campos enriquecidos de rotacion --- */
    { titulo: 'Quien Alisto', fn: t => t.quienAlisto },
    { titulo: 'Quien Pito', fn: t => t.quienPito },
    { titulo: 'Quien Empaco', fn: t => t.quienEmpaco },
    { titulo: 'Tipo Carga', fn: t => t.tipoCarga },
    { titulo: 'Concepto', fn: t => t.concepto },
    /* --- Tiempos --- */
    { titulo: 'T. Alistamiento', fn: t => formatoDuracion(t.tAlistamiento) },
    { titulo: 'T. Espera Despacho', fn: t => formatoDuracion(t.tEsperaDespacho) },
    { titulo: 'T. Transito', fn: t => formatoDuracion(t.tTransito) },
    { titulo: 'Novedad', fn: t => (t.tieneNovedad ? 'SI' : 'NO') }
  ];
  pintarTabla('head_s1', 'body_s1', columnas, lista, t =>
    urgenteEnRiesgo(t) ? 'fila-urgente-pendiente' : (t.estado === 'CUMPLIDO' ? 'fila-cumplido' : ''));
  $('info_s1').textContent = `${lista.length} traslados · ${lista.filter(urgenteEnRiesgo).length} urgentes en riesgo`;
}

/* ---------- SECCION 2: recepcion tecnica ---------- */
function recepcionFiltrada() {
  const q = normalizarCabecera(val('buscar_s2'));
  return FUENTES.recepcion.filter(r => {
    const tipo = normalizarCabecera(obtenerValorPorNombreColumna(r, A.tipoRecepcion));
    if (tipo && tipo.indexOf('traslado') === -1) return false;
    if (!dentroDeRango(obtenerValorPorNombreColumna(r, A.fRecepcion) || obtenerValorPorNombreColumna(r, A.marca))) return false;
    if (q && !normalizarCabecera(JSON.stringify(r)).includes(q)) return false;
    return true;
  });
}

function pintarSeccion2() {
  const filas = recepcionFiltrada();
  const columnas = [
    { titulo: 'Fecha Recepcion Tecnica', alias: A.fRecepcion },
    { titulo: 'Documento Traslado', alias: A.traslado },
    { titulo: 'Bodega Origen Externa', alias: A.origen },
    { titulo: 'Bodega Destino (CENDIS / B05)', alias: A.destino },
    { titulo: 'Codigo Producto / Molecula', alias: A.codigo },
    { titulo: 'Descripcion', alias: A.descripcion },
    { titulo: 'Lote', alias: A.lote },
    { titulo: 'Fecha Vencimiento', alias: A.vencimiento },
    { titulo: 'Cantidad Enviada', alias: A.cantEnviada },
    { titulo: 'Cantidad Recibida', alias: A.cantRecibida },
    { titulo: 'Diferencia', fn: r => Number(obtenerValorPorNombreColumna(r, A.cantRecibida) || 0) - Number(obtenerValorPorNombreColumna(r, A.cantEnviada) || 0) },
    { titulo: 'Estado Recepcion Tecnica', alias: A.estadoRec },
    { titulo: 'Responsable de Recepcion', alias: A.respRec },
    { titulo: 'Observaciones', alias: A.observaciones }
  ];
  pintarTabla('head_s2', 'body_s2', columnas, filas, r => {
    const dif = Number(obtenerValorPorNombreColumna(r, A.cantRecibida) || 0) - Number(obtenerValorPorNombreColumna(r, A.cantEnviada) || 0);
    const estado = normalizarCabecera(obtenerValorPorNombreColumna(r, A.estadoRec));
    return (dif !== 0 || estado === 'novedad') ? 'fila-diferencia' : '';
  });
  $('info_s2').textContent = `${filas.length} items recibidos`;
}

/* ---------- SECCION 3: novedades ---------- */
function pintarSeccion3() {
  const q = normalizarCabecera(val('buscar_s3'));
  const filas = FUENTES.novedades.filter(n =>
    dentroDeRango(obtenerValorPorNombreColumna(n, A.marca)) &&
    (!q || normalizarCabecera(JSON.stringify(n)).includes(q)));
  const columnas = [
    { titulo: 'Marca temporal', alias: A.marca },
    { titulo: 'Correo electronico', alias: A.correo },
    { titulo: 'Bodega Origen del Traslado', alias: A.origen },
    { titulo: 'Bodega Destino del Traslado', alias: A.destino },
    { titulo: 'TRASLADO', alias: A.traslado },
    { titulo: 'Causa de anulacion / modificacion', alias: A.causa },
    { titulo: 'Solicita la correccion', alias: A.solicita },
    { titulo: 'Telefono de contacto', alias: A.telefono },
    { titulo: 'SEGUIMIENTO', alias: A.seguimiento },
    { titulo: 'SOLUCIONADO', alias: A.solucionado },
    { titulo: 'Efecto en seguimiento', fn: () => 'CUMPLIDO (conserva fecha inicial)' }
  ];
  pintarTabla('head_s3', 'body_s3', columnas, filas, n =>
    normalizarCabecera(obtenerValorPorNombreColumna(n, A.solucionado)) === 'si' ? 'fila-cumplido' : 'fila-diferencia');
  $('info_s3').textContent = `${filas.length} novedades registradas`;
}

/* ---------- SECCION 4: inventario ---------- */
function inventarioFiltrado() {
  const bod = val('f_bodega_inv'), soloDif = val('f_solo_dif'), q = normalizarCabecera(val('buscar_s4'));
  return FUENTES.inventario.filter(i => {
    const fecha = obtenerValorPorNombreColumna(i, ['Fecha Verificacion']) || obtenerValorPorNombreColumna(i, A.marca);
    if (!dentroDeRango(fecha)) return false;
    if (bod && normalizarCabecera(obtenerValorPorNombreColumna(i, A.bodegaInv)).indexOf(normalizarCabecera(bod)) === -1) return false;
    if (soloDif && Number(obtenerValorPorNombreColumna(i, A.diferencia) || 0) === 0) return false;
    if (q && !normalizarCabecera(JSON.stringify(i)).includes(q)) return false;
    return true;
  });
}

function pintarSeccion4() {
  const filas = inventarioFiltrado();
  const columnas = [
    { titulo: 'Fecha Verificacion', fn: i => obtenerValorPorNombreColumna(i, ['Fecha Verificacion']) || obtenerValorPorNombreColumna(i, A.marca) },
    { titulo: 'Bodega (CENDIS / B05)', alias: A.bodegaInv },
    { titulo: 'Responsable Asignado', alias: A.respInv },
    { titulo: 'Molecula / Medicamento', alias: A.molecula },
    { titulo: 'Codigo Producto', alias: ['Codigo Producto', 'Codigo Producto / Molecula'] },
    { titulo: 'Lote', alias: A.lote },
    { titulo: 'Fecha Vencimiento', alias: A.vencimiento },
    { titulo: 'Cantidad Teorica', alias: A.teorica },
    { titulo: 'Cantidad Fisica', alias: A.fisica },
    { titulo: 'Diferencia', alias: A.diferencia },
    { titulo: 'Estado / Novedad', alias: A.estadoInv },
    { titulo: 'Observaciones', alias: A.observaciones }
  ];
  pintarTabla('head_s4', 'body_s4', columnas, filas, i =>
    Number(obtenerValorPorNombreColumna(i, A.diferencia) || 0) !== 0 ? 'fila-diferencia' : '');
  const conDif = filas.filter(i => Number(obtenerValorPorNombreColumna(i, A.diferencia) || 0) !== 0).length;
  $('info_s4').textContent = `${filas.length} items verificados · ${conDif} con diferencia`;
}

/* ---------------------------------------------------------------------------
 * 7. APERTURA DEL DIA — 8 GRUPOS FIJOS
 *    8 grupos fijos con miembros definidos. Sin rotacion ciclica.
 *    Cada grupo muestra: nombre del color + lista de miembros.
 *    Grupo Gris = especial (5 miembros, asignado a B05 ALTO COSTO).
 *    Los otros 7 trios = asignados a CENDIS PRINCIPAL TULUA PARQUE INDUSTRIAL.
 * ------------------------------------------------------------------------- */

const GRUPOS_FIJOS = [
  { nombre: 'Rojo',    numero: 1, color: '#FFB3B3', hex: '#dc3545', miembros: ['Nicoll Trivi\u00f1o', 'Estefania Parra', 'Luisa Mar\u00eda Osorio'], lider: 'Luisa Mar\u00eda Osorio' },
  { nombre: 'Naranja', numero: 2, color: '#FFDAB9', hex: '#FF8C00', miembros: ['Daniela Nore\u00f1a', 'Juan David Moreno', 'Kelly Beltran'] },
  { nombre: 'Azul',    numero: 3, color: '#B0E0E6', hex: '#0d6efd', miembros: ['Karina Riascos', 'Ana Lorena Ortiz', 'Vaneza Escobar'] },
  { nombre: 'Verde',   numero: 4, color: '#C8F7C5', hex: '#2fb457', miembros: ['Leidy Valencia', 'Bivian Lorena Rivera', 'Brayan Camilo Izquierdo'] },
  { nombre: 'Morado',  numero: 5, color: '#D8BFD8', hex: '#6f42c1', miembros: ['Jhony Saenz', 'Natalia Galvez', 'Valentina Cano'] },
  { nombre: 'Amarillo',numero: 6, color: '#FFFACD', hex: '#ffc107', miembros: ['Liz Karime Valencia', 'Angela Vanessa Aguirre', 'Derly Yulieth Mosquera'] },
  { nombre: 'Fucsia',  numero: 7, color: '#FFD0EC', hex: '#FF00FF', miembros: ['Manuel David Salazar', 'Luz Nelly Chaves', 'Luis Felipe Marin'], lider: 'Luz Nelly Chaves' },
  { nombre: 'Gris',    numero: 8, color: '#E0E0E0', hex: '#6c757d', miembros: ['Claudia Echeverry', 'Camila Posada', 'Angela Vera', 'Mayra Alejandra Franco', 'Andrea Vanegas'], lider: 'Andrea Vanegas' }
];

/** Genera la lista de grupos del dia (fija, sin rotacion). */
function generarGruposDelDia() {
  return GRUPOS_FIJOS.map(g => ({
    nombre: g.nombre,
    miembros: g.miembros.slice()
  }));
}

/** Pinta los 8 grupos fijos en el panel de Apertura del Dia */
function pintarAperturaDia() {
  const cont = $('rot_grupos_container');
  const info = $('info_rotacion');

  if (cont) {
    cont.innerHTML = '';
    let idxCol = 0;
    const cols = ['col-md-3', 'col-md-3', 'col-md-3', 'col-md-3'];

    GRUPOS_FIJOS.forEach(grupo => {
      const col = document.createElement('div');
      col.className = cols[idxCol % 4];

      const card = document.createElement('div');
      card.className = 'rot-grupo-card';
      card.style.borderLeftColor = grupo.hex;
      card.style.background = grupo.color;

      const header = document.createElement('div');
      header.className = 'rot-grupo-card-header';
      header.style.background = grupo.hex;
      const lightColors = ['#FFD0EC', '#FFDAB9', '#C8F7C5', '#FFB3B3', '#D8BFD8', '#FFFACD', '#B0E0E6', '#E0E0E0'];
      header.style.color = lightColors.includes(grupo.color) ? (grupo.hex === '#ffc107' ? '#000' : '#fff') : '#fff';
      // Mejor contraste: si el hex es claro, usar texto oscuro
      const isLightHex = ['#ffc107', '#FF8C00'].some(c => grupo.hex === c);
      header.style.color = isLightHex ? '#000' : '#fff';
      header.innerHTML = '&#11044; Grupo ' + esc(grupo.nombre) + ' (' + grupo.numero + ')';
      if (grupo.lider) header.innerHTML += ' &mdash; L&iacute;der: ' + esc(grupo.lider);
      card.appendChild(header);

      const body = document.createElement('div');
      body.className = 'rot-grupo-card-body';

      grupo.miembros.forEach(nombre => {
        const row = document.createElement('div');
        row.className = 'rot-grupo-miembro';
        row.textContent = nombre;
        body.appendChild(row);
      });

      card.appendChild(body);
      col.appendChild(card);
      cont.appendChild(col);
      idxCol++;
    });
  }

  /* Info banner */
  if (info) {
    const total = GRUPOS_FIJOS.reduce((s, g) => s + g.miembros.length, 0);
    info.innerHTML = '<span class="badge bg-success">8 grupos fijos &mdash; ' + total + ' personas</span>';
  }
}

/** Los grupos son fijos — no se necesita generar rotacion */

/** Guarda los grupos fijos del dia en Drive via API */
async function accionGuardarRotacion() {
  const fecha = val('rot_fecha');
  if (!fecha) {
    toast('Seleccione la fecha de la Apertura.', 'warning');
    return;
  }

  const estadoEl = $('rot_estado');
  if (estadoEl) estadoEl.innerHTML = '<span class="badge bg-warning text-dark">Guardando en Drive...</span>';

  // Construir asignaciones a partir de los grupos fijos
  const asignaciones = [];
  GRUPOS_FIJOS.forEach(g => {
    g.miembros.forEach(nombre => {
      asignaciones.push({ nombre: nombre, grupo: g.nombre });
    });
  });

  try {
    const r = await api('guardarRotacion', {
      folderId: CONFIG.folders.rotacion,
      fecha: fecha,
      asignaciones: asignaciones
    });
    if (r && r.ok) {
      if (estadoEl) estadoEl.innerHTML = '<span class="badge bg-success">Guardada en Drive</span>';
      toast('Grupos guardados en Drive para <strong>' + fecha + '</strong> (' + asignaciones.length + ' personas).', 'success');
    } else {
      if (estadoEl) estadoEl.innerHTML = '<span class="badge bg-danger">Error al guardar</span>';
      toast('Error al guardar grupos: ' + (r.error || 'desconocido'), 'danger');
    }
  } catch (e) {
    if (estadoEl) estadoEl.innerHTML = '<span class="badge bg-danger">Error de conexion</span>';
    toast('Error de conexion al guardar grupos: ' + e.message, 'danger');
  }
}

/** Los grupos son fijos — al cambiar fecha solo actualiza la visualizacion */
async function accionCargarRotacionFecha() {
  const fecha = val('rot_fecha');
  if (!fecha) { pintarAperturaDia(); return; }
  const estadoEl = $('rot_estado');
  if (estadoEl) estadoEl.innerHTML = '<span class="badge bg-info">Grupos fijos del dia</span>';
  pintarAperturaDia();
}

/* ---------- SECCION 5: LOGISTICA Y DESPACHO ---------- */
function logisticaFiltrada() {
  const zona = val('f_zona_log'), revisado = val('f_revisado_log'), q = normalizarCabecera(val('buscar_s5'));
  return FUENTES.logistica.filter(r => {
    const marca = obtenerValorPorNombreColumna(r, A.marca);
    if (!dentroDeRango(marca)) return false;
    if (zona && normalizarCabecera(obtenerValorPorNombreColumna(r, A.zona)).indexOf(normalizarCabecera(zona)) === -1) return false;
    if (revisado === 'SI' && normalizarCabecera(obtenerValorPorNombreColumna(r, A.revisado)) !== 'si') return false;
    if (revisado === 'NO' && normalizarCabecera(obtenerValorPorNombreColumna(r, A.revisado)) === 'si') return false;
    if (q && !normalizarCabecera(JSON.stringify(r)).includes(q)) return false;
    return true;
  });
}

function pintarSeccion5() {
  const filas = logisticaFiltrada();
  const columnas = [
    { titulo: 'Documento TRASLADO', alias: A.traslado },
    { titulo: 'Bodega Origen', alias: A.origen },
    { titulo: 'Destino', alias: A.destino },
    { titulo: 'Zona', alias: A.zona },
    { titulo: 'Cantidad', alias: A.cantidad },
    { titulo: 'Urgente', alias: A.urgente },
    { titulo: 'Responsable Entrega CENDIS', alias: A.respCendis },
    { titulo: 'Quien Alista', alias: A.alista },
    { titulo: 'Marca Temporal / Fecha Inicial', alias: A.marca },
    { titulo: 'Revisado', fn: r => badgeRevisado(r), html: true },
    { titulo: 'Accion', fn: r => btnMarcarRevisado(r), html: true },
    { titulo: 'Quien Recibio', fn: r => obtenerValorPorNombreColumna(r, A.quienRecibe) || '' },
    { titulo: 'Observaciones', alias: A.observaciones }
  ];
  pintarTabla('head_s5', 'body_s5', columnas, filas, r => {
    const rev = normalizarCabecera(obtenerValorPorNombreColumna(r, A.revisado));
    const urg = normalizarCabecera(obtenerValorPorNombreColumna(r, A.urgente));
    return (rev !== 'si' && urg === 'si') ? 'fila-urgente-pendiente' : (rev === 'si' ? 'fila-cumplido' : '');
  });
  const revisados = filas.filter(r => normalizarCabecera(obtenerValorPorNombreColumna(r, A.revisado)) === 'si').length;
  $('info_s5').textContent = `${filas.length} registros · ${revisados} revisados · ${filas.length - revisados} sin revisar`;
}

function badgeRevisado(r) {
  const v = normalizarCabecera(obtenerValorPorNombreColumna(r, A.revisado));
  if (v === 'si') return '<span class="badge-est mf-revisado-si">&#9989; SI</span>';
  return '<span class="badge-est mf-revisado-no">&#10060; NO</span>';
}

function btnMarcarRevisado(r) {
  const v = normalizarCabecera(obtenerValorPorNombreColumna(r, A.revisado));
  if (v === 'si') return '<span class="text-muted small">&mdash;</span>';
  const traslado = obtenerValorPorNombreColumna(r, A.traslado) || '';
  if (!traslado) return '';
  const safeId = String(traslado).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `<button class="btn btn-sm btn-mf-revisado" onclick="marcarRevisadoLogistica('${safeId}')">&#9989; Marcar Revisado</button>`;
}

function marcarRevisadoLogistica(traslado) {
  if (!traslado) return;
  const folderId = CONFIG.folders.logistica;
  apiPost({ action: 'actualizarRegistro', folderId: folderId, modulo: 'logistica',
    claveCol: ['traslado', 'documento traslado'], claveVal: traslado,
    cambios: { 'Revisado': 'SI' }
  })
  .then(r => {
    if (r && r.ok) {
      toast('&#9989; Traslado <strong>' + traslado + '</strong> marcado como Revisado.', 'success');
      refrescarTodo();
    } else {
      toast('Error al marcar Revisado: ' + (r.error || ''), 'danger');
    }
  })
  .catch(err => toast('Error de conexion: ' + err.message, 'danger'));
}

function exportarLogistica() {
  const filas = logisticaFiltrada();
  const wb = XLSX.utils.book_new();
  const cabeceras = ['Documento TRASLADO','Bodega Origen','Destino','Zona','Cantidad','Urgente',
    'Responsable Entrega CENDIS','Quien Alista','Marca Temporal','Revisado','Quien Recibio','Observaciones'];
  const matriz = [cabeceras];
  filas.forEach(r => {
    matriz.push(cabeceras.map(c => {
      if (c === 'Documento TRASLADO') return obtenerValorPorNombreColumna(r, A.traslado) || '';
      if (c === 'Bodega Origen') return obtenerValorPorNombreColumna(r, A.origen) || '';
      if (c === 'Destino') return obtenerValorPorNombreColumna(r, A.destino) || '';
      if (c === 'Zona') return obtenerValorPorNombreColumna(r, A.zona) || '';
      if (c === 'Cantidad') return obtenerValorPorNombreColumna(r, A.cantidad) || '';
      if (c === 'Urgente') return obtenerValorPorNombreColumna(r, A.urgente) || '';
      if (c === 'Responsable Entrega CENDIS') return obtenerValorPorNombreColumna(r, A.respCendis) || '';
      if (c === 'Quien Alista') return obtenerValorPorNombreColumna(r, A.alista) || '';
      if (c === 'Marca Temporal') return obtenerValorPorNombreColumna(r, A.marca) || '';
      if (c === 'Revisado') return obtenerValorPorNombreColumna(r, A.revisado) || 'NO';
      if (c === 'Quien Recibio') return obtenerValorPorNombreColumna(r, A.quienRecibe) || '';
      if (c === 'Observaciones') return obtenerValorPorNombreColumna(r, A.observaciones) || '';
      return '';
    }));
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matriz), 'LOGISTICA');
  const d = new Date(), p = n => String(n).padStart(2, '0');
  XLSX.writeFile(wb, `Logistica_Despacho_${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.xlsx`);
}

/* ---------------------------------------------------------------------------
 * 8. REFRESCO GENERAL Y EXPORTACION
 * ------------------------------------------------------------------------- */
function refrescarTodo() {
  const lista = trasladosFiltrados();
  pintarKpis(lista);
  pintarSeccion1(lista);
  pintarSeccion2();
  pintarSeccion3();
  pintarSeccion4();
  pintarSeccion5();
  pintarAperturaDia();
}

function exportarConsolidado() {
  const wb = XLSX.utils.book_new();
  const hoja = (nombre, filas) => {
    const cabeceras = [];
    filas.forEach(f => Object.keys(f).forEach(k => { if (k.indexOf('__') !== 0 && !cabeceras.includes(k)) cabeceras.push(k); }));
    const matriz = [cabeceras.length ? cabeceras : ['Sin registros']];
    filas.forEach(f => matriz.push(cabeceras.map(c => (f[c] !== undefined ? f[c] : ''))));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matriz), nombre);
  };
  const lista = trasladosFiltrados();
  hoja('TRASLADOS', lista.map(t => Object.assign({}, t.crudo, {
    'Estado Calculado': t.estado,
    'Tiempo Alistamiento (h)': t.tAlistamiento === null ? '' : Math.round(t.tAlistamiento * 100) / 100,
    'Tiempo Espera Despacho (h)': t.tEsperaDespacho === null ? '' : Math.round(t.tEsperaDespacho * 100) / 100,
    'Tiempo Transito (h)': t.tTransito === null ? '' : Math.round(t.tTransito * 100) / 100,
    'Tiene Novedad': t.tieneNovedad ? 'SI' : 'NO',
    'Quien Alisto': t.quienAlisto,
    'Quien Pito': t.quienPito,
    'Quien Empaco': t.quienEmpaco,
    'Tipo Carga': t.tipoCarga,
    'Concepto': t.concepto
  })));
  hoja('RECEPCION TECNICA', recepcionFiltrada());
  hoja('NOVEDADES', FUENTES.novedades);
  hoja('INVENTARIO', inventarioFiltrado());
  hoja('SEGURIDAD', FUENTES.seguridad);
  const d = new Date(), p = n => String(n).padStart(2, '0');
  XLSX.writeFile(wb, `Consolidado_Visor_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.xlsx`);
}

/* ---------------------------------------------------------------------------
 * 8.b PLANILLA DE DESPACHOS (descarga XLSX / impresion)
 *     Columnas enriquecidas con datos de rotacion.
 * ------------------------------------------------------------------------- */
const COLS_PLANILLA = ['Fecha', 'Bodega Origen', 'Bodega Destino', 'Traslado', 'Cantidad',
  'Tipo', 'Ruta', 'Fecha de Envio de Traslado', 'Responsable de Envio', 'Placa',
  'Observacion', 'Estado', 'Quien Alisto', 'Quien Pito', 'Quien Empaco',
  'Tipo Carga', 'Concepto'];

function clasificarTipo(valor) {
  const v = normalizarCabecera(valor);
  if (!v) return '';
  if (v.includes('caja')) return 'CAJA';
  if (v.includes('panal')) return 'PAÑALES';
  if (v.includes('nevera') || v.includes('cadena de frio') || v.includes('refriger')) return 'NEVERA';
  if (v.includes('paquete')) return 'PAQUETE';
  return String(valor).toUpperCase();
}

function soloFecha(texto) {
  const d = aFecha(texto);
  if (!d) return String(texto || '');
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function filasPlanillaDespachos() {
  return trasladosFiltrados().map(t => ({
    'Fecha': soloFecha(t.fechaInicial),
    'Bodega Origen': t.origen,
    'Bodega Destino': t.destino,
    'Traslado': t.traslado,
    'Cantidad': obtenerValorPorNombreColumna(t.crudo, A.cantidad),
    'Tipo': clasificarTipo(obtenerValorPorNombreColumna(t.crudo, A.tipo)),
    'Ruta': t.zona,
    'Fecha de Envio de Traslado': t.fPlanilla || '',
    'Responsable de Envio': obtenerValorPorNombreColumna(t.crudo, A.conductor),
    'Placa': obtenerValorPorNombreColumna(t.crudo, ['PLACA', 'Placa']),
    'Observacion': obtenerValorPorNombreColumna(t.crudo, A.observaciones),
    'Estado': t.estado + (esSi(t.urgente) ? ' / URGENTE' : ''),
    'Quien Alisto': t.quienAlisto,
    'Quien Pito': t.quienPito,
    'Quien Empaco': t.quienEmpaco,
    'Tipo Carga': t.tipoCarga,
    'Concepto': t.concepto
  }));
}

function descargarPlanillaDespachos() {
  const filas = filasPlanillaDespachos();
  if (!filas.length) { alert('No hay traslados en el filtro actual para generar la planilla.'); return; }

  const matriz = [
    ['OPERACION CENDIS - LOGISTICA — PLANILLA DE DESPACHOS'],
    ['Generado: ' + new Date().toLocaleString('es-CO'), '', 'Registros: ' + filas.length],
    [],
    COLS_PLANILLA
  ];
  filas.forEach(f => matriz.push(COLS_PLANILLA.map(c => f[c])));

  const ws = XLSX.utils.aoa_to_sheet(matriz);
  ws['!cols'] = [{ wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 14 }, { wch: 10 }, { wch: 12 },
                 { wch: 14 }, { wch: 20 }, { wch: 22 }, { wch: 10 }, { wch: 34 }, { wch: 18 },
                 { wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 12 }, { wch: 20 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'PLANILLA DESPACHOS');

  const d = new Date(), p = n => String(n).padStart(2, '0');
  XLSX.writeFile(wb, `Planilla_Despachos_CENDIS_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.xlsx`);
}

function imprimirPlanillaDespachos() {
  const filas = filasPlanillaDespachos();
  if (!filas.length) { alert('No hay traslados en el filtro actual para imprimir.'); return; }

  const encabezado = `
    <div style="text-align:center;margin-bottom:10px">
      <img src="assets/logo.jpeg" style="height:52px" alt="Medisfarma">
      <h3 style="margin:6px 0 0">OPERACION CENDIS - LOGISTICA</h3>
      <div style="font-size:12px">Planilla de Despachos · ${new Date().toLocaleString('es-CO')} · ${filas.length} traslados</div>
    </div>`;

  const thead = '<thead><tr>' + COLS_PLANILLA.map(c => `<th>${esc(c)}</th>`).join('') + '</tr></thead>';
  const tbody = '<tbody>' + filas.map(f =>
    '<tr>' + COLS_PLANILLA.map(c => `<td>${esc(f[c])}</td>`).join('') + '</tr>').join('') + '</tbody>';

  $('areaPlanillaImpresion').innerHTML = encabezado + '<table>' + thead + tbody + '</table>' +
    '<p style="margin-top:18px;font-size:11px">Entrega CENDIS: ____________________ &nbsp;&nbsp; Recibe Logistica: ____________________ &nbsp;&nbsp; Conductor: ____________________</p>';

  window.print();
}

/* ---------------------------------------------------------------------------
 * 9. INICIALIZACION
 * ------------------------------------------------------------------------- */
function pintarConfig() {
  $('v_api_url').value = CONFIG.apiUrl || '';
  ['despachos', 'logistica', 'recepcion', 'novedades', 'inventario', 'facturacion', 'seguridad', 'rotacion']
    .forEach(m => { $('v_folder_' + m).value = CONFIG.folders[m] || ''; });
  $('v_modo_local').checked = !!CONFIG.modoLocal;
  pintarPerfilesVisor();
}

function pintarPerfilesVisor() {
  const perfiles = CONFIG.perfiles || {};
  const LABELS = {
    despachos: 'Despachos (BD_PLANILLA_ENTREGA_DESPACHOS)',
    logistica: 'Logistica (BD_LOGISTICA_DESPACHOS)',
    recepcion: 'Recepcion Tecnica (BD_RECEPCION_TECNICA)',
    facturacion: 'Factura Transporte (BD_FACTURA_TRANSPORTE)',
    inventario: 'Inventario (BD_VERIFICACION_INVENTARIO)',
    seguridad: 'Seguridad (BD_SEGURIDAD_DESPACHOS)',
    rotacion: 'Rotacion Diaria (BD_ROTACION_DIARIA)'
  };
  const cont = $('perfilesInfoVisor');
  if (!cont) return;
  cont.innerHTML = Object.keys(LABELS).map(k => {
    const p = perfiles[k] || {};
    return '<div class="row g-1 mb-1">' +
      '<div class="col-md-5"><strong>' + esc(LABELS[k]) + '</strong></div>' +
      '<div class="col-md-4"><span class="text-muted">Archivo:</span> ' + esc(p.file || '(sin asignar)') + '</div>' +
      '<div class="col-md-3"><span class="text-muted">Hoja:</span> ' + esc(p.sheet || '(sin asignar)') + '</div>' +
      '</div>';
  }).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  // ----- SISTEMA DE LOGIN -----
  const loginPrevio = localStorage.getItem(LS_LOGIN_VISOR);
  if (loginPrevio && CREDENCIALES_VISOR[loginPrevio]) {
    $('pantallaLoginVisor').style.display = 'none';
    document.body.classList.remove('mf-login-activo');
  } else {
    $('pantallaLoginVisor').style.display = 'flex';
    document.body.classList.add('mf-login-activo');
  }

  $('btnLoginVisor').addEventListener('click', verificarLoginVisor);
  $('loginContrasenaVisor').addEventListener('keydown', e => { if (e.key === 'Enter') verificarLoginVisor(); });
  $('btnCerrarSesionVisor').addEventListener('click', cerrarSesionVisor);

  // Hereda la configuracion del modulo de Cargue si existe.
  try {
    const cfgCargue = JSON.parse(localStorage.getItem('MF_CONFIG_CARGUE') || '{}');
    if (cfgCargue.apiUrl && !CONFIG.apiUrl) { CONFIG.apiUrl = cfgCargue.apiUrl; }
    if (cfgCargue.folders) {
      Object.keys(cfgCargue.folders).forEach(k => {
        if (CONFIG.folders[k] !== undefined && !CONFIG.folders[k]) CONFIG.folders[k] = cfgCargue.folders[k];
      });
    }
    if (cfgCargue.apiUrl) localStorage.setItem(LS_KEY_VISOR, JSON.stringify(CONFIG));
  } catch (e) {}

  pintarConfig();

  // Alerta si no hay URL de Web App
  if (!CONFIG.apiUrl) {
    const alerta = document.createElement('div');
    alerta.id = 'alertaNoApiVisor';
    alerta.className = 'alert alert-warning alert-dismissible fade show position-fixed';
    alerta.style.cssText = 'top:10px;left:50%;transform:translateX(-50%);z-index:99999;max-width:90vw;font-size:14px;';
    alerta.innerHTML = '⚠ <strong>Sin conexion a Drive</strong> — Configure la URL de la Web App en <em>Ajustes</em> o carguela primero en el modulo CARGUE. <a href="#" onclick="document.getElementById(\'t6\')&&document.getElementById(\'t6\').click();this.closest(\'.alert\').remove();return false;">Ir a Ajustes</a> <button type="button" class="btn-close" data-bs-dismiss="alert"></button>';
    document.body.appendChild(alerta);
    setTimeout(() => { if (alerta.parentNode) alerta.remove(); }, 15000);
  }

  $('v_guardar').addEventListener('click', () => {
    CONFIG.apiUrl = val('v_api_url');
    ['despachos', 'logistica', 'recepcion', 'novedades', 'inventario', 'facturacion', 'seguridad', 'rotacion']
      .forEach(m => { CONFIG.folders[m] = val('v_folder_' + m); });
    CONFIG.modoLocal = $('v_modo_local').checked;
    localStorage.setItem(LS_KEY_VISOR, JSON.stringify(CONFIG));
    cargarDatos();
  });

  $('btnRefrescar').addEventListener('click', cargarDatos);
  $('btnExportar').addEventListener('click', exportarConsolidado);
  if ($('btnProbarApi')) $('btnProbarApi').addEventListener('click', probarConexion);
  $('btnPlanillaDespachos').addEventListener('click', descargarPlanillaDespachos);
  $('btnPlanillaImprimir').addEventListener('click', imprimirPlanillaDespachos);
  $('btnAplicar').addEventListener('click', refrescarTodo);
  if ($('btnExportarLogistica')) $('btnExportarLogistica').addEventListener('click', exportarLogistica);

  // Botones de Apertura del Dia
  if ($('btnGuardarRotacion')) $('btnGuardarRotacion').addEventListener('click', accionGuardarRotacion);
  if ($('rot_fecha')) {
    $('rot_fecha').addEventListener('change', accionCargarRotacionFecha);
    /* Default: fecha de hoy */
    const hoyISO = new Date().toISOString().split('T')[0];
    $('rot_fecha').value = hoyISO;
  }

  $('btnLimpiarFiltros').addEventListener('click', () => {
    ['f_desde', 'f_hasta', 'f_origen', 'f_destino', 'f_zona', 'f_estado', 'f_urgente',
     'f_bodega_inv', 'f_solo_dif', 'f_zona_log', 'f_revisado_log',
     'buscar_s1', 'buscar_s2', 'buscar_s3', 'buscar_s4', 'buscar_s5', 'buscar_traslado_5']
      .forEach(id => { if ($(id)) $(id).value = ''; });
    refrescarTodo();
  });

  ['buscar_s1', 'buscar_s2', 'buscar_s3', 'buscar_s4', 'buscar_s5', 'buscar_traslado_5', 'f_bodega_inv', 'f_solo_dif']
    .forEach(id => { if ($(id)) $(id).addEventListener('input', refrescarTodo); });
  ['f_desde', 'f_hasta', 'f_origen', 'f_destino', 'f_zona', 'f_estado', 'f_urgente', 'f_zona_log', 'f_revisado_log']
    .forEach(id => { if ($(id)) $(id).addEventListener('change', refrescarTodo); });

  cargarDatos();

  // Actualizacion automatica cada 5 minutos cuando hay conexion a Drive.
  setInterval(() => { if (!CONFIG.modoLocal && CONFIG.apiUrl) cargarDatos(); }, 300000);
});
