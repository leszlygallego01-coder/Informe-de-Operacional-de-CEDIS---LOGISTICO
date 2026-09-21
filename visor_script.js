/* =================================================================================
 * MEDISFARMA | visor_script.js  —  v3.17.1
 * VISOR reestructurado: KPIs, tiempos de ciclo y graficas 100% derivados de
 * BD_CONSOLIDADO_DRIVE y respetando los filtros (fecha / zona / bodega).
 *   • Cumplidos = recepcion final confirmada en punto (FECHA RECIBIDO EN PUNTO)
 *   • En Transito/Pendientes = despachados/asignados sin recepcion
 *   • Novedades/Anulaciones = novedades + traslados anulados (Paso 3)
 *   • Tiempos: Alistamiento / Espera Despacho / Transito con formulas exactas
 * Toda la lectura se hace por NOMBRE DE CABECERA (nunca por indice de columna).
 * ================================================================================= */
'use strict';

const LS_KEY_VISOR = 'MF_CONFIG_VISOR';

const VISOR_API_URL = 'https://script.google.com/macros/s/AKfycbzozcuiuPLyF-u0HIhPYuROQVGHzT8RckuXL6QjYdQbBP7QllnXXgraraDFa86R5mbz/exec';

const VISOR_DEFAULTS = {
  apiUrl: VISOR_API_URL,
  /* modoLocal eliminado v3.10.0 — datos SIEMPRE desde Drive */
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
    backup:      '1HVTZyLasrbZArTN34kmc0lCKaQa2qQ_5',
    asignacion:  '15SX-1C48XJ7yMkiMlb88n8VlVhvP7eg_f2FGWp_B0Jk',
    entregaLogistica: '1xC5Nj2VMNgh6N5XIfMTN-aJ2i8nQExANAEhgthWRNpU',
    despachoAsignacion: '1InvQu8uiAZ8lGzleNDJ2Umm38cLw6J4a8aEA_aBm8Pc'
  },
  perfiles: {
    despachos:   { file: 'BD_PLANILLA_ENTREGA_DESPACHOS', sheet: 'DATOS' },
    trasladosConsulta: { multiFile: true, label: 'Traslados (carpeta multi-archivo)' },
    logistica:   { file: 'BD_LOGISTICA_DESPACHOS',         sheet: 'DATOS' },
    recepcion:   { file: 'BD_RECEPCION_TECNICA',           sheet: 'DATOS' },
    facturacion: { file: 'BD_FACTURA_TRANSPORTE',         sheet: 'DATOS' },
    inventario:  { file: 'BD_VERIFICACION_INVENTARIO',     sheet: 'DATOS' },
    seguridad:   { file: 'BD_SEGURIDAD_DESPACHOS',         sheet: 'DATOS' },
    rotacion:    { file: 'BD_ROTACION_DIARIA',             sheet: 'DATOS' },
    asignacion:  { sheetId: '15SX-1C48XJ7yMkiMlb88n8VlVhvP7eg_f2FGWp_B0Jk', gid: '182323503', label: 'BD_ASIGNACION_DE_TRASLADO' },
    entregaLogistica: { sheetId: '1xC5Nj2VMNgh6N5XIfMTN-aJ2i8nQExANAEhgthWRNpU', label: 'BD_ENTREGA_A_LOGISTICA' },
    despachoAsignacion: { sheetId: '1InvQu8uiAZ8lGzleNDJ2Umm38cLw6J4a8aEA_aBm8Pc', gid: '683036860', label: 'Despacho y asignacion de traslados' }
  }
};

function cargarConfigVisor() {
  try {
    const raw = localStorage.getItem(LS_KEY_VISOR);
    const cfg = raw ? Object.assign({}, VISOR_DEFAULTS, JSON.parse(raw)) : Object.assign({}, VISOR_DEFAULTS);
    if (!cfg.apiUrl || cfg.apiUrl.trim() === '') cfg.apiUrl = VISOR_API_URL;
    /* v3.8: Forzar actualizacion de URL si la guardada es diferente a la nueva por defecto */
    if (cfg.apiUrl && cfg.apiUrl.trim() !== '' && cfg.apiUrl.trim() !== VISOR_API_URL.trim()) {
      console.log('[VISOR] Actualizando URL del Web App a la nueva version v3.10.0');
      cfg.apiUrl = VISOR_API_URL;
    }
    /* v3.10.0: modoLocal eliminado — datos siempre desde Drive */
    if (cfg.modoLocal) delete cfg.modoLocal;
    /* Asegurar carpetas nuevas y actualizar IDs si cambiaron */
    Object.keys(VISOR_DEFAULTS.folders).forEach(k => {
      if (!cfg.folders[k] || cfg.folders[k] !== VISOR_DEFAULTS.folders[k]) {
        cfg.folders[k] = VISOR_DEFAULTS.folders[k];
      }
    });
    return cfg;
  } catch (e) { return Object.assign({}, VISOR_DEFAULTS); }
}

let CONFIG = cargarConfigVisor();

/** Datos crudos por fuente y datos derivados. */
let FUENTES = { general: [], despachos: [], logistica: [], recepcion: [], novedades: [], inventario: [], facturacion: [], seguridad: [], rotacion: [], trasladosConsulta: [], asignacion: [], entregaLogistica: [], despachoAsignacion: [], traslados_anulados: [] };
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
  log_jenny:           'Medis2024JennyL',
  jose_santiago:       'Medis2024JoseB09',
  yuliana:             'Medis2024YulianaB09',
  luisa_fernanda:      'Medis2024LuisaB09',
  nedi_yojana:         'Medis2024NediB09',
  beatriz_eugenia:     'Medis2024BeatrizB09',
  mery_yolanda:        'Medis2024MeryB09',
  yeimy_aldana:        'Medis2024YeimyA'
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
  log_jenny: 'Jenny (Logistica CENDIS)',
  jose_santiago: 'Jose Santiago (Auxiliar B09)',
  yuliana: 'Yuliana (Auxiliar B09)',
  luisa_fernanda: 'Luisa Fernanda (Auxiliar B09)',
  nedi_yojana: 'Nedi Yojana (Auxiliar B09)',
  beatriz_eugenia: 'Beatriz Eugenia (Auxiliar B09)',
  mery_yolanda: 'Mery Yolanda (Auxiliar B09)',
  yeimy_aldana: 'Yeimy Aldana (Auxiliar CEDIS)'
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
  destino:      ['DESTINO', 'BODEGA DESTINO DEL TRASLADO', 'Bodega Destino (CENDIS / B05)', 'Bodega Destino', 'Bodega Destino.'],
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
  revisado:     ['Revisado', 'REVISADO'],
  // Asignacion / planilla (fechas del ciclo)
  fAsignacion:  ['Fecha Asignacion de Traslado', 'FECHA ASIGNACION DE TRASLADO', 'Fecha Asignacion', 'Marca temporal'],
  fCreacionPlanilla: ['Fecha Creacion Planilla', 'Fecha Asignacion Planilla', 'FECHA PLANILLA ENVIO LOGISTICA', 'Fecha de Envio del Traslado']
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
  // v3.18: estado neutral "00h 00m" en lugar de "--" cuando no hay datos.
  if (horas === null || horas === undefined || isNaN(horas)) return '00h 00m';
  const total = Math.round(horas * 60);
  const d = Math.floor(total / 1440), h = Math.floor((total % 1440) / 60), m = total % 60;
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return (d ? d + 'd ' : '') + hh + 'h ' + mm + 'm';
}

function promedio(lista) {
  const v = lista.filter(x => x !== null && !isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function esSi(v) { return normalizarCabecera(v) === 'si'; }

/* Clasifica una bodega como INTERNA (CENDIS / B05 / B09) o EXTERNA (regional). */
function esBodegaInterna(nombreBodega) {
  const n = normalizarCabecera(nombreBodega);
  if (!n) return false;
  return n.indexOf('cendis') !== -1 || n.indexOf('cedis') !== -1 ||
         n.indexOf('b05') !== -1 || n.indexOf('b09') !== -1;
}

/* ---------------------------------------------------------------------------
 * MAPA BODEGA → ZONA
 * ------------------------------------------------------------------------- */
const BODEGA_ZONA_MAP = {"M111 B/G SAN MIGUEL":"ZONA CUNDINAMARCA","M111 B/G CHOACHI":"ZONA CUNDINAMARCA","M111 B/G CHIA":"ZONA CUNDINAMARCA","M111 B/G SOPO":"ZONA CUNDINAMARCA","M111 B/G CAJICA":"ZONA CUNDINAMARCA","M111 B/G COTA":"ZONA CUNDINAMARCA","M111 B/G FACATATIVA":"ZONA CUNDINAMARCA","M111 B/G MOSQUERA":"ZONA CUNDINAMARCA","M111 B/G MADRID":"ZONA CUNDINAMARCA","M111 B/G FUNZA":"ZONA CUNDINAMARCA","M111 B/G LA CALERA":"ZONA CUNDINAMARCA","M111 B/G SOACHA":"ZONA CUNDINAMARCA","M111 B/G ZIPAQUIRA":"ZONA CUNDINAMARCA","M111 B/G SIBATE":"ZONA CUNDINAMARCA","M111 B/G BOGOTA":"ZONA CUNDINAMARCA","M112 B/G IPIALES":"ZONA NARIÑO","M112 B/G TUMACO":"ZONA NARIÑO","M112 B/G TUQUERRES":"ZONA NARIÑO","M112 B/G PASTO":"ZONA NARIÑO","M112 B/G SAMANIEGO":"ZONA NARIÑO","M112 B/G LA UNION":"ZONA NARIÑO","M112 B/G ILLANO":"ZONA NARIÑO","M113 B/G SANTANDER DE QUILICHAO":"ZONA CAUCA NORTE","M113 B/G PUERTO TEJADA":"ZONA CAUCA NORTE","M113 B/G CALOTO":"ZONA CAUCA NORTE","M113 B/G PADILLA":"ZONA CAUCA NORTE","M113 B/G VILLARRICA":"ZONA CAUCA NORTE","M113 B/G SANTANDER DE QUILICHAO 2":"ZONA CAUCA NORTE","M114 B/G POPAYAN":"ZONA CAUCA SUR","M114 B/G PATIA":"ZONA CAUCA SUR","M114 B/G EL TAMBO":"ZONA CAUCA SUR","M114 B/G ARGELIA":"ZONA CAUCA SUR","M114 B/G TIMBIO":"ZONA CAUCA SUR","M114 B/G PIENDAMO":"ZONA CAUCA SUR","M115 B/G SOTARA":"ZONA CAUCA CENTRO","M115 B/G PAEZ":"ZONA CAUCA CENTRO","M115 B/G INZA":"ZONA CAUCA CENTRO","M115 B/G SILVIA":"ZONA CAUCA CENTRO","M115 B/G TORO":"ZONA CAUCA CENTRO","M116 B/G TUNJA":"ZONA BOYACA","M116 B/G DUITAMA":"ZONA BOYACA","M116 B/G SOGAMOSO":"ZONA BOYACA","M116 B/G CHIQUINQUIRA":"ZONA BOYACA","M116 B/G MONIQUIRA":"ZONA BOYACA","M116 B/G PAIPA":"ZONA BOYACA","M116 B/G PUERTO BOYACA":"ZONA BOYACA","M117 B/G FLORENCIA":"ZONA CAQUETA","M117 B/G SAN VICENTE":"ZONA CAQUETA","M117 B/G EL DONCELLO":"ZONA CAQUETA","M117 B/G MORELIA":"ZONA CAQUETA","M117 B/G PUERTO RICO":"ZONA CAQUETA","M118 B/G BUGA":"ZONA VALLE","M118 B/G TULUA":"ZONA VALLE","M118 B/G BUGALAGRANDE":"ZONA VALLE","M118 B/G PALMIRA":"ZONA VALLE","M118 B/G YUMBO":"ZONA VALLE","M118 B/G CARTAGO":"ZONA VALLE","M118 B/G LA UNION":"ZONA VALLE","M118 B/G SEVILLA":"ZONA VALLE","M118 B/G ROLDANILLO":"ZONA VALLE","M118 B/G CAICEDONIA":"ZONA VALLE","M119 B/G PEREIRA":"ZONA EJE CAFETERO","M119 B/G MANIZALES":"ZONA EJE CAFETERO","M119 B/G DOSQUEBRADAS":"ZONA EJE CAFETERO","M119 B/G SANTA ROSA DE CABAL":"ZONA EJE CAFETERO","M119 B/G CHINCHINA":"ZONA EJE CAFETERO","M119 B/G FILANDIA":"ZONA EJE CAFETERO","M119 B/G SALAMINA":"ZONA EJE CAFETERO","M120 B/G IBAGUE":"ZONA TOLIMA","M120 B/G ESPINAL":"ZONA TOLIMA","M120 B/G MELGAR":"ZONA TOLIMA","M120 B/G HONDA":"ZONA TOLIMA","M120 B/G LIBANO":"ZONA TOLIMA","M120 B/G MURILLO":"ZONA TOLIMA","M120 B/G LERIDA":"ZONA TOLIMA","M120 B/G AMBALEMA":"ZONA TOLIMA","M121 B/G SANTA MARTA":"ZONA COSTA NORTE","M121 B/G BARRANQUILLA":"ZONA COSTA NORTE","M121 B/G CARTAGENA":"ZONA COSTA NORTE","M121 B/G SOLEDAD":"ZONA COSTA NORTE","M121 B/G VALLEDUPAR":"ZONA COSTA NORTE","M121 B/G SINCELEJO":"ZONA COSTA NORTE","M121 B/G MONTERIA":"ZONA COSTA NORTE","M111 B/G USAQUEN":"ZONA CUNDINAMARCA","M111 B/G SUBA":"ZONA CUNDINAMARCA","M111 B/G ENGATIVA":"ZONA CUNDINAMARCA","M111 B/G BARRIOS UNIDOS":"ZONA CUNDINAMARCA","M111 B/G TEUSAQUILLO":"ZONA CUNDINAMARCA","M111 B/G LOS MARTIRES":"ZONA CUNDINAMARCA","M111 B/G PUENTE ARANDA":"ZONA CUNDINAMARCA","M111 B/G KENNEDY":"ZONA CUNDINAMARCA","M111 B/G FONTIBON":"ZONA CUNDINAMARCA","M111 B/G RAFAEL URIBE":"ZONA CUNDINAMARCA","M111 B/G SAN CRISTOBAL":"ZONA CUNDINAMARCA","M111 B/G BOSA":"ZONA CUNDINAMARCA","M111 B/G TUNJUELITO":"ZONA CUNDINAMARCA","M111 B/G ANTONIO NARIÑO":"ZONA CUNDINAMARCA","M111 B/G USME":"ZONA CUNDINAMARCA","M111 B/G RAFAEL URIBE URIBE":"ZONA CUNDINAMARCA","B/G PRINCIPAL":"ZONA BODEGA VIRTUAL","B/G BODEGA PRINCIPAL":"ZONA BODEGA VIRTUAL","B/G CEDI BOGOTA":"ZONA BODEGA VIRTUAL","B/G CEDI":"ZONA BODEGA VIRTUAL","B/G BODEGA VIRTUAL":"ZONA BODEGA VIRTUAL","B/G BODEGA VALLE":"ZONA BODEGA VALLE"};

const ZONAS_LISTA = [
  'ZONA CAUCA NORTE', 'ZONA CAUCA SUR', 'ZONA CAUCA CENTRO', 'ZONA VALLE',
  'ZONA TOLIMA', 'ZONA EJE CAFETERO', 'ZONA NARIÑO', 'ZONA CUNDINAMARCA',
  'ZONA CAQUETA', 'ZONA COSTA NORTE', 'ZONA BOYACA',
  'ZONA BODEGA VIRTUAL', 'ZONA BODEGA VALLE'
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
async function api(action, payload = {}, timeoutMs = 8000) {
  if (!CONFIG.apiUrl) throw new Error('No se ha configurado la URL de la Web App.');
  const fullPayload = Object.assign({ action }, payload);
  console.log('[api] Enviando:', action, fullPayload);

  // Helper: fetch con timeout configurable (default 8s para cache-only)
  // Usa AbortController si esta disponible, si no Promise.race como fallback
  function fetchWithTimeout(url, options, ms) {
    if (typeof AbortController !== 'undefined') {
      const controller = new AbortController();
      const mergedOpts = Object.assign({}, options, { signal: controller.signal });
      const timer = setTimeout(() => controller.abort(), ms);
      return fetch(url, mergedOpts)
        .then(r => { clearTimeout(timer); return r; })
        .catch(err => {
          clearTimeout(timer);
          if (err && err.name === 'AbortError') throw new Error('TIMEOUT');
          throw err;
        });
    }
    return Promise.race([
      fetch(url, options),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), ms))
    ]);
  }

  try {
    // INTENTO 1: POST con text/plain (evita preflight CORS)
    const res = await fetchWithTimeout(CONFIG.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      body: JSON.stringify(fullPayload)
    }, timeoutMs);
    const ct = res.headers.get('Content-Type') || '';
    console.log('[api] POST respuesta status:', res.status, 'Content-Type:', ct);
    if (ct.includes('text/html')) {
      throw new Error('AUTH_REQUIRED');
    }
    const text = await res.text();
    try {
      const data = JSON.parse(text);
      if (data.ok === false) throw new Error(data.error || 'Error del backend');
      console.log('[api] POST exitoso, fuentes:', Object.keys(data.fuentes || {}));
      return data;
    } catch (jsonErr) {
      console.error('[api] POST: respuesta no es JSON valido. Primeros 500 chars:', text.substring(0, 500));
      throw new Error('La respuesta del servidor no es JSON. Verifique que la Web App este desplegada correctamente.');
    }
  } catch (e) {
    console.warn('[api] POST error:', e.message);
    // Auth redirect — no reintentar
    if (e.message === 'AUTH_REQUIRED') {
      throw new Error('La Web App requiere autenticacion. Desplieguela con acceso "Cualquier usuario" (publico).');
    }
    // Timeout — no reintentar via GET, reportar directamente
    if (e.message === 'TIMEOUT') {
      throw new Error('TIMEOUT');
    }
    // Network/CORS error — reintentar con GET
    if (e.message && (e.message.includes('Failed to fetch') || e.message.includes('NetworkError'))) {
      console.log('[api] POST fallo, reintentando con GET...');
      try {
        return await apiGetFallback(fullPayload, timeoutMs);
      } catch (e2) {
        throw new Error('No se pudo conectar a la Web App (POST y GET fallaron). Verifique la URL y el despliegue.');
      }
    }
    throw e;
  }
}

async function apiGetFallback(payload, timeoutMs = 8000) {
  const params = [];
  for (const key in payload) {
    if (payload.hasOwnProperty(key)) {
      params.push(encodeURIComponent(key) + '=' + encodeURIComponent(typeof payload[key] === 'object' ? JSON.stringify(payload[key]) : payload[key]));
    }
  }
  const getUrl = CONFIG.apiUrl + (CONFIG.apiUrl.includes('?') ? '&' : '?') + params.join('&') + '&_t=' + Date.now();
  console.log('[api] GET fallback URL:', getUrl.substring(0, 150) + '...');
  const res = await fetchWithTimeout(getUrl, { method: 'GET', redirect: 'follow' }, timeoutMs);
  const ct = res.headers.get('Content-Type') || '';
  console.log('[api] GET respuesta status:', res.status, 'Content-Type:', ct);
  if (ct.includes('text/html')) {
    throw new Error('AUTH_REQUIRED');
  }
  const text = await res.text();
  try {
    const data = JSON.parse(text);
    if (data.ok === false) throw new Error(data.error || 'Error del backend');
    console.log('[api] GET exitoso, fuentes:', Object.keys(data.fuentes || {}));
    return data;
  } catch (jsonErr) {
    console.error('[api] GET: respuesta no es JSON. Primeros 500 chars:', text.substring(0, 500));
    throw new Error('La respuesta GET del servidor no es JSON.');
  }
}

async function cargarDatos() {
  console.log('[cargarDatos] Iniciando carga de datos...');
  console.log('[cargarDatos] API URL:', CONFIG.apiUrl);
  $('estadoApi').className = 'badge bg-light text-dark';
  $('estadoApi').textContent = 'Cargando...';

  if (!CONFIG.apiUrl) {
    $('estadoApi').className = 'badge bg-warning text-dark';
    $('estadoApi').textContent = 'Sin URL de Web App';
    toast('Configure la URL de la Web App en Ajustes para leer datos de Drive.', 'warning');
    construirConsolidado(); poblarFiltros(); refrescarTodo();
    return;
  }

  // ── MODO API: LECTURA EXCLUSIVA del CONSOLIDADOR MAESTRO (v3.20.0) ──
  // El VISOR lee UNICAMENTE las 5 pestanas del maestro (CONSOLIDADOR_GENERAL,
  // RECEPCION_TECNICA, NOVEDADES_ANULACIONES, INVENTARIO_CENDIS_B05,
  // LOGISTICA_DESPACHOS). Carga TODO el dataset en memoria para KPIs exactos y
  // renderiza solo los primeros 100 registros por tabla.
  // FASE 1: lectura del maestro (timeout 20s). FASE 2: retry (timeout 40s).

  let exito = false;

  // ── FASE 1: Lectura del CONSOLIDADOR MAESTRO ──
  try {
    console.log('[cargarDatos] FASE 1: Leyendo CONSOLIDADO JSON (consolidado_operacion.json, timeout 15s)...');
    $('estadoApi').textContent = 'Leyendo JSON...';
    const r = await api('leerConsolidadoJSON', {}, 15000);

    if (r.ok && r.fuentes && Object.keys(r.fuentes).length > 0) {
      console.log('[cargarDatos] ✓ Consolidado disponible. Fuentes:', Object.keys(r.fuentes), 'origen:', r.origen, 'timestamp:', r.timestamp);
      _aplicarFuentes(r);
      $('estadoApi').className = 'badge bg-success';
      $('estadoApi').textContent = r.origen === 'json' ? 'JSON OK' : (r.origen === 'maestro' ? 'Maestro OK' : (r.origen === 'carpeta' ? 'Consolidado OK' : 'Datos OK'));
      exito = true;
    } else if (r.ok === false) {
      console.warn('[cargarDatos] Maestro sin datos (origen=' + r.origen + '), reintentando...');
    } else {
      console.warn('[cargarDatos] Respuesta inesperada en FASE 1:', r);
    }
  } catch (e1) {
    console.warn('[cargarDatos] FASE 1 error:', e1.message);
    if (e1.message === 'AUTH_REQUIRED') {
      $('estadoApi').className = 'badge bg-danger';
      $('estadoApi').textContent = 'Sin acceso (Auth)';
      toast('<strong>La Web App requiere autenticacion.</strong> Desplieguela con acceso "Cualquier usuario" (publico).', 'danger');
    }
  }

  // ── FASE 2: Si FASE 1 no entregó datos, retry con timeout mayor ──
  if (!exito) {
    try {
      console.log('[cargarDatos] FASE 2: Reintentando lectura del consolidado (timeout 40s)...');
      $('estadoApi').className = 'badge bg-warning text-dark';
      $('estadoApi').textContent = 'Reintentando...';
      toast('Reintentando la lectura del Consolidado...', 'info', 4000);

      const r2 = await api('leerConsolidadoJSON', {}, 40000);

      if (r2.ok && r2.fuentes && Object.keys(r2.fuentes).length > 0) {
        console.log('[cargarDatos] ✓ Maestro recibido en FASE 2. Fuentes:', Object.keys(r2.fuentes), 'origen:', r2.origen);
        _aplicarFuentes(r2);
        $('estadoApi').className = 'badge bg-success';
        $('estadoApi').textContent = r2.origen === 'maestro' ? 'Maestro OK' : 'Datos OK';
        exito = true;
        toast('✓ Datos cargados desde el Consolidador Maestro.', 'success', 3000);
      } else {
        console.error('[cargarDatos] FASE 2: respuesta sin datos:', r2);
        $('estadoApi').className = 'badge bg-warning text-dark';
        $('estadoApi').textContent = 'Sin datos';
        toast('Aún no hay datos en caché. Leyendo directamente desde las fuentes de Drive en segundo plano...', 'info', 6000);
      }
    } catch (e2) {
      console.error('[cargarDatos] FASE 2 error:', e2.message);
      if (e2.message === 'TIMEOUT') {
        $('estadoApi').className = 'badge bg-warning text-dark';
        $('estadoApi').textContent = 'Timeout';
        toast('Tiempo de espera agotado. Reintentando lectura directa en segundo plano...', 'info', 6000);
      } else if (e2.message !== 'AUTH_REQUIRED') {
        $('estadoApi').className = 'badge bg-danger';
        $('estadoApi').textContent = 'Error conexión';
        toast('Error al conectar: ' + e2.message, 'danger');
      }
    }
  }

  if (!exito) {
    console.log('[cargarDatos] Sin datos del servidor — no se usa localStorage');
    $('estadoApi').className = 'badge bg-warning text-dark';
    $('estadoApi').textContent = 'Leyendo Drive...';
    toast('Leyendo los datos directamente desde Drive...', 'info', 4000);
  }

  construirConsolidado();
  poblarFiltros();
  refrescarTodo();
  console.log('[cargarDatos] Carga inicial completada.');

  // v3.20.0 — La FASE 1/2 ya leen DIRECTO de las fuentes de Drive. Solo si
  // ambas fallaron disparamos un reintento en segundo plano para recuperar
  // los datos. El refresco periódico (interval) mantiene todo actualizado.
  if (!exito) _refrescoDirectoBackground(true);
}

/**
 * _refrescoDirectoBackground — v3.19.0
 * Servicio de actualizacion asincrona en segundo plano. Ejecuta la lectura
 * DIRECTA y consolidacion en tiempo real de las fuentes de Drive mediante
 * procesarYConsolidarDrive (que superpone BD_ENTREGA_A_LOGISTICA,
 * BD_ASIGNACION_DE_TRASLADO, BD_TRASLADOS_ANULADOS, BD_LOGISTICA_DESPACHOS,
 * "Despacho y asignacion" y BD_RECEPCION_TECNICA leidos por su ID, al 100%).
 * No bloquea la UI: al terminar, reconstruye el consolidado y re-renderiza.
 * @param {boolean} forzarVisible — si true, muestra el estado de sincronizacion.
 */
async function _refrescoDirectoBackground(forzarVisible) {
  if (!CONFIG.apiUrl) return;
  if (window.__mfRefrescoEnCurso) return;
  window.__mfRefrescoEnCurso = true;
  if (forzarVisible) {
    $('estadoApi').className = 'badge bg-info';
    $('estadoApi').textContent = 'Leyendo Drive...';
  }
  _setSyncInfo('', 'Actualizando en segundo plano...');
  try {
    // Relectura del CONSOLIDADOR MAESTRO (5 pestanas). El VISOR NO reconstruye:
    // el maestro lo alimenta el modulo de CARGUE. Aqui solo re-leemos (timeout 40s).
    const r = await api('consolidadoDesdeMaestro', {}, 40000);
    if (r && r.ok && r.fuentes && Object.keys(r.fuentes).length > 0) {
      _aplicarFuentes(r);
      const stamp = r.timestamp || new Date().toISOString();
      localStorage.setItem(LS_ULTIMA_SYNC, stamp);
      construirConsolidado();
      poblarFiltros();
      refrescarTodo();
      $('estadoApi').className = 'badge bg-success';
      $('estadoApi').textContent = '✓ Datos en vivo';
      _setSyncInfo('ok', 'Lectura directa: ' + _fmtFechaHora(stamp));
      console.log('[_refrescoDirectoBackground] OK — fuentes:', Object.keys(r.fuentes), 'kpisDirecto:', r.kpisDirecto || null);
    } else if (forzarVisible) {
      $('estadoApi').className = 'badge bg-warning text-dark';
      $('estadoApi').textContent = 'Sin datos';
      _setSyncInfo('err', 'Sin datos en las fuentes');
    }
  } catch (e) {
    console.warn('[_refrescoDirectoBackground] Aviso:', e.message);
    if (forzarVisible) {
      $('estadoApi').className = 'badge bg-warning text-dark';
      $('estadoApi').textContent = e.message === 'TIMEOUT' ? 'Reintentando...' : 'Error lectura';
      _setSyncInfo('err', 'Reintentando lectura directa...');
    }
  } finally {
    window.__mfRefrescoEnCurso = false;
  }
}

/** _cargarFuentesLocales ELIMINADO en v3.10.0 — datos SIEMPRE desde Drive/Sheets */

/** Aplica datos de respuesta API a FUENTES (sin localStorage backup — v3.10.0) */
function _aplicarFuentes(r) {
  Object.keys(FUENTES).forEach(m => {
    FUENTES[m] = (r.fuentes[m] && r.fuentes[m].rows) ? r.fuentes[m].rows : [];
  });
  const conteo = {};
  Object.keys(FUENTES).forEach(m => { conteo[m] = FUENTES[m].length; });
  console.log('[_aplicarFuentes] Filas por fuente:', conteo);
}

/** v3.18 — helpers de UI de sincronizacion (skeleton + indicador de ultima sync) */
const LS_ULTIMA_SYNC = 'MF_ULTIMA_SYNC_VISOR';

function _mostrarSkeleton(on) {
  const sk = $('rot_skeleton');
  const cont = $('rot_grupos_container');
  if (sk) sk.style.display = on ? 'grid' : 'none';
  if (cont) cont.style.display = on ? 'none' : '';
  const panel = document.querySelector('.mf-apertura-dia');
  if (panel) panel.classList.toggle('mf-loading', on);
}

function _setSyncInfo(estado, texto) {
  const box = $('syncInfo');
  const txt = $('syncInfoText');
  if (box) { box.classList.remove('ok', 'err'); if (estado) box.classList.add(estado); }
  if (txt) txt.textContent = texto;
}

function _fmtFechaHora(iso) {
  try {
    const d = iso ? new Date(iso) : new Date();
    const p = n => String(n).padStart(2, '0');
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  } catch (e) { return String(iso || ''); }
}

/** Restaura el indicador de ultima sincronizacion al cargar la pagina */
function restaurarUltimaSync() {
  const prev = localStorage.getItem(LS_ULTIMA_SYNC);
  if (prev) _setSyncInfo('ok', 'Ult. sync: ' + _fmtFechaHora(prev));
  else _setSyncInfo('', 'Sin sincronizar');
}

/** sincronizarDrive — v3.18: lee y CONSOLIDA en tiempo real todos los archivos
 *  (Hojas de calculo / CSV) de la carpeta de Drive mediante procesarYConsolidarDrive
 *  (recorre iterativamente la carpeta en el backend). Muestra skeleton loader y una
 *  confirmacion con la fecha/hora de la ultima sincronizacion exitosa.
 */
async function sincronizarDrive() {
  const btn = $('btnSincronizarDrive');
  if (btn) {
    btn.disabled = true;
    btn.classList.add('sincronizando');
    btn.innerHTML = '<span class="mf-spinner-inline"></span> Sincronizando...';
  }
  _mostrarSkeleton(true);
  _setSyncInfo('', 'Sincronizando...');
  $('estadoApi').className = 'badge bg-info';
  $('estadoApi').textContent = 'Sincronizando...';
  toast('<strong>Sincronizando con Drive...</strong> Leyendo y consolidando los archivos de la carpeta.', 'info', 5000);

  try {
    // procesarYConsolidarDrive: recorre iterativamente la carpeta, lee cada archivo
    // (Sheets/CSV) y reconstruye el consolidado en tiempo real. Timeout amplio (45s)
    // porque implica recorrer la carpeta completa.
    const r = await api('procesarYConsolidarDrive', {}, 45000);

    if (r.ok && r.fuentes && Object.keys(r.fuentes).length > 0) {
      _aplicarFuentes(r);
      const stamp = r.timestamp || new Date().toISOString();
      localStorage.setItem(LS_ULTIMA_SYNC, stamp);
      $('estadoApi').className = 'badge bg-success';
      $('estadoApi').textContent = '✓ Sincronizado';
      _setSyncInfo('ok', 'Ult. sync: ' + _fmtFechaHora(stamp));
      construirConsolidado();
      poblarFiltros();
      refrescarTodo();
      toast('✓ <strong>Sincronizaci\u00f3n exitosa</strong> — ' +
        (r.msg || (Object.keys(r.fuentes).length + ' fuentes consolidadas')) +
        '<br><span class="small text-muted">\u00daltima sincronizaci\u00f3n: ' + _fmtFechaHora(stamp) + '</span>', 'success', 7000);
      console.log('[sincronizarDrive] OK — origen:', r.origen, 'fuentes:', Object.keys(r.fuentes));
    } else {
      $('estadoApi').className = 'badge bg-warning text-dark';
      $('estadoApi').textContent = 'Sin datos';
      _setSyncInfo('err', 'Sin datos en la carpeta');
      toast('No se encontraron registros en los archivos de la carpeta. ' + (r.error || ''), 'warning', 9000);
      console.warn('[sincronizarDrive] Sin datos:', r);
    }
  } catch (e) {
    $('estadoApi').className = 'badge bg-danger';
    $('estadoApi').textContent = 'Error sync';
    _setSyncInfo('err', 'Error de sincronizaci\u00f3n');
    // Fallback: intentar leer el ultimo consolidado ya generado en Drive
    try {
      const rf = await api('consolidadoDesdeCarpeta', {}, 12000);
      if (rf.ok && rf.fuentes && Object.keys(rf.fuentes).length > 0) {
        _aplicarFuentes(rf);
        const st = rf.timestamp || new Date().toISOString();
        localStorage.setItem(LS_ULTIMA_SYNC, st);
        $('estadoApi').className = 'badge bg-warning text-dark';
        $('estadoApi').textContent = 'Consolidado previo';
        _setSyncInfo('ok', 'Ult. sync: ' + _fmtFechaHora(st));
        construirConsolidado(); poblarFiltros(); refrescarTodo();
        toast('La consolidaci\u00f3n en vivo no respondi\u00f3 a tiempo; se muestran los <strong>datos del \u00faltimo consolidado</strong> guardado en Drive.', 'warning', 8000);
        return;
      }
    } catch (e2) { /* ignore */ }
    if (e.message === 'TIMEOUT') {
      toast('La sincronizaci\u00f3n excedi\u00f3 el tiempo l\u00edmite. Intente de nuevo.', 'warning', 8000);
    } else {
      toast('Error al sincronizar: ' + e.message, 'danger', 8000);
    }
    console.error('[sincronizarDrive] Exception:', e.message);
  } finally {
    _mostrarSkeleton(false);
    if (btn) { btn.disabled = false; btn.classList.remove('sincronizando'); btn.innerHTML = '<span class="ico-sync">\u21bb</span> Sincronizar Drive'; }
  }
}

async function probarConexion() {
  const btn = $('btnProbarApi');
  const badge = $('estadoApi');
  if (btn) { btn.disabled = true; btn.innerHTML = '&#8987; Probando...'; }
  badge.className = 'badge bg-warning text-dark';
  badge.textContent = 'Probando conexion...';

  // Helper: fetch con timeout (10s para ping) — usa AbortController si disponible
  function fetchTimeout(url, options, ms) {
    if (typeof AbortController !== 'undefined') {
      const controller = new AbortController();
      const mergedOpts = Object.assign({}, options, { signal: controller.signal });
      const timer = setTimeout(() => controller.abort(), ms);
      return fetch(url, mergedOpts)
        .then(r => { clearTimeout(timer); return r; })
        .catch(err => {
          clearTimeout(timer);
          if (err && err.name === 'AbortError') throw new Error('TIMEOUT');
          throw err;
        });
    }
    return Promise.race([
      fetch(url, options),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), ms))
    ]);
  }

  // Primero probar con GET directo (mas confiable para CORS con Apps Script)
  try {
    const pingUrl = CONFIG.apiUrl + '?action=ping&_t=' + Date.now();
    console.log('[probarConexion] GET ping:', pingUrl);
    const res = await fetchTimeout(pingUrl, { method: 'GET', redirect: 'follow' }, 10000);
    const ct = res.headers.get('Content-Type') || '';
    console.log('[probarConexion] GET status:', res.status, 'Content-Type:', ct);
    if (ct.includes('text/html')) {
      badge.className = 'badge bg-danger';
      badge.textContent = 'Sin acceso';
      toast('<strong>Error de autenticacion:</strong> La Web App esta desplegada con acceso restringido.<br>' +
        '<em>Solucion:</em> En Apps Script vaya a <strong>Implementar > Nueva implementacion > Web app</strong><br>' +
        'y cambie <strong>"Quien tiene acceso"</strong> a <strong>"Cualquier usuario"</strong> (publico).', 'danger');
      if (btn) { btn.disabled = false; btn.innerHTML = '&#127760; Probar Conexion'; }
      return;
    }
    const text = await res.text();
    try {
      const data = JSON.parse(text);
      if (data && data.ok) {
        badge.className = 'badge bg-success';
        badge.textContent = 'Conectado a Drive';
        toast('Conexion exitosa con Google Drive', 'success');
        if (btn) { btn.disabled = false; btn.innerHTML = '&#127760; Probar Conexion'; }
        return;
      }
    } catch (jsonErr) {
      console.error('[probarConexion] GET: respuesta no es JSON:', text.substring(0, 200));
    }
  } catch (getErr) {
    console.log('[probarConexion] GET fallo:', getErr.message);
    if (getErr.message === 'TIMEOUT') {
      badge.className = 'badge bg-danger';
      badge.textContent = 'Sin respuesta';
      toast('La Web App no respondio en 10 segundos. Puede que el backend este saturado o no desplegado.', 'danger');
      if (btn) { btn.disabled = false; btn.innerHTML = '&#127760; Probar Conexion'; }
      return;
    }
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
 * 2b. CALCULO DE TIEMPOS CRUZANDO FUENTES POR DOCUMENTO TRASLADO
 *     v3.16.0 — Todas las lecturas provienen de BD_CONSOLIDADO_DRIVE.
 *     Formulas EXACTAS del requerimiento:
 *       Alistamiento     = Fecha Entrega a Logistica  − Fecha Asignacion de Traslado
 *       Espera Despacho  = Fecha Creacion/Envio Planilla − Fecha Entrega a Logistica
 *       Transito         = Fecha Recibido en Punto     − Fecha Creacion/Envio Planilla
 * ------------------------------------------------------------------------- */
/** Alistamiento = ts(Entrega a Logistica) − ts(Asignacion de Traslado). */
function calcularAlistamiento(claveTraslado, filaMerge) {
  if (filaMerge) {
    const _a = obtenerValorPorNombreColumna(filaMerge, ['MF_TS_ASIGNACION']);
    const _e = obtenerValorPorNombreColumna(filaMerge, ['MF_TS_ENTREGA']);
    if (_a && _e) return horasEntre(_a, _e);
  }
  const filaAsignacion = FUENTES.asignacion.find(f =>
    normalizarCabecera(obtenerValorPorNombreColumna(f, A.traslado)) === claveTraslado
  );
  const filaEntrega = FUENTES.entregaLogistica.find(f =>
    normalizarCabecera(obtenerValorPorNombreColumna(f, A.traslado)) === claveTraslado
  );
  if (!filaAsignacion || !filaEntrega) return null;
  const tsAsignacion = obtenerValorPorNombreColumna(filaAsignacion, A.marca);
  const tsEntrega = obtenerValorPorNombreColumna(filaEntrega, A.marca);
  // Entrega − Asignacion (Entrega ocurre despues de la asignacion)
  return horasEntre(tsAsignacion, tsEntrega);
}

/** Espera Despacho = ts(Creacion/Envio Planilla) − ts(Entrega a Logistica). */
function calcularEsperaDespacho(claveTraslado, filaMerge) {
  if (filaMerge) {
    const _e = obtenerValorPorNombreColumna(filaMerge, ['MF_TS_ENTREGA']);
    const _d = obtenerValorPorNombreColumna(filaMerge, ['MF_TS_DESPACHO']);
    if (_e && _d) return horasEntre(_e, _d);
  }
  const filaEntrega = FUENTES.entregaLogistica.find(f =>
    normalizarCabecera(obtenerValorPorNombreColumna(f, A.traslado)) === claveTraslado
  );
  const filaDespacho = FUENTES.despachoAsignacion.find(f =>
    normalizarCabecera(obtenerValorPorNombreColumna(f, A.traslado)) === claveTraslado
  );
  if (!filaEntrega || !filaDespacho) return null;
  const tsEntrega = obtenerValorPorNombreColumna(filaEntrega, A.marca);
  const tsDespacho = obtenerValorPorNombreColumna(filaDespacho, A.marca);
  // Planilla − Entrega (la planilla se crea despues de la entrega a logistica)
  return horasEntre(tsEntrega, tsDespacho);
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

  /* v3.16.0: se parte de la ASIGNACION (todo traslado asignado existe en el ciclo),
     luego DESPACHOS y LOGISTICA sobre-escriben con los datos del avance real
     (entrega a logistica, planilla y recepcion en punto). Asi los traslados
     asignados pero aun no despachados aparecen como PENDIENTE. */
  /* v3.20.0: si el CONSOLIDADOR MAESTRO trae la pestana CONSOLIDADOR_GENERAL
     (fuente 'general', ya cruzada asignacion+despachos+logistica en el backend con
     las marcas de cada evento incrustadas), se parte de ella. En su defecto se usa
     el cruce clasico en cliente (asignacion → despachos → logistica). */
  if (FUENTES.general && FUENTES.general.length) {
    FUENTES.general.forEach(agregar);
  } else {
    FUENTES.asignacion.forEach(agregar);
    FUENTES.despachos.forEach(agregar);
    FUENTES.logistica.forEach(agregar);
  }

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
    /* v3.16.0: CUMPLIDO = recepcion final confirmada en punto (FECHA RECIBIDO EN PUNTO).
       EN TRANSITO = despachado (planilla) sin recepcion. PENDIENTE = aun sin despachar.
       Las novedades se marcan aparte (tieneNovedad) y NO fuerzan el estado a CUMPLIDO,
       para que "Cumplidos (Recibidos)" refleje unicamente recepciones reales. */
    if (fRecibido && aFecha(fRecibido)) estado = 'CUMPLIDO';
    else if (fPlanilla && aFecha(fPlanilla)) estado = 'EN TRANSITO';
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
      tAlistamiento: calcularAlistamiento(clave, r),
      tEsperaDespacho: calcularEsperaDespacho(clave, r),
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
  /* Si solo hay Fecha de Apertura (rot_fecha), filtrar por ese dia */
  const rotFecha = val('rot_fecha');
  const desde = val('f_desde') ? aFecha(val('f_desde')) : (rotFecha ? aFecha(rotFecha) : null);
  const hasta = val('f_hasta') ? aFecha(val('f_hasta')) : (rotFecha ? aFecha(rotFecha) : null);
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
  if (t.estado === 'CUMPLIDO') return false;
  if (esSi(t.urgente)) return true;
  // Also flag as risk when Concepto matches urgent categories
  const concepto = (t.concepto || '').toString().trim();
  const conceptoNorm = normalizarCabecera(concepto);
  const conceptosUrgentes = ['pqrs', 'tutela', 'tutelas', 'desacato', 'orden de arresto', 'jornada'];
  return conceptosUrgentes.some(c => conceptoNorm === c);
}

/* ---------------------------------------------------------------------------
 * 5. INDICADORES (KPIs) Y TIEMPOS POR PROCESO
 * ------------------------------------------------------------------------- */
function pintarKpis(lista) {
  /* v3.16.0 — KPIs 100% derivados del CONSOLIDADO y respetando los filtros
     (fecha / zona / bodega / estado / urgente). `lista` = trasladosFiltrados(). */

  // 1. CANTIDAD DE TRASLADOS: Documento Traslado unicos procesados en el rango filtrado.
  const totalTraslados = lista.length;

  // 2. TRASLADOS CUMPLIDOS (RECIBIDOS): con recepcion final confirmada en punto de destino.
  const cumplidos = lista.filter(t => t.fRecibido && aFecha(t.fRecibido)).length;

  // 3. EN TRANSITO / PENDIENTES: despachados o asignados que aun no registran recepcion.
  const pendientes = lista.filter(t => !(t.fRecibido && aFecha(t.fRecibido))).length;

  // 4. TRASLADOS URGENTES: URGENTE = SI en riesgo o pendientes.
  const urgentes = lista.filter(urgenteEnRiesgo).length;

  // 5. NOVEDADES Y ANULACIONES: novedades reportadas + traslados anulados (Paso 3).
  const novedades = FUENTES.novedades.filter(n => dentroDeRango(obtenerValorPorNombreColumna(n, A.marca)));
  const anulados = (FUENTES.traslados_anulados || []).filter(a => dentroDeRango(obtenerValorPorNombreColumna(a, A.marca)));
  const abiertas = novedades.filter(n => !esSi(obtenerValorPorNombreColumna(n, A.solucionado))).length;
  const totalNovAnul = novedades.length + anulados.length;

  // 6. ITEMS CON DIFERENCIAS DE INVENTARIO.
  const inv = inventarioFiltrado();
  const difInv = inv.filter(i => Number(obtenerValorPorNombreColumna(i, A.diferencia) || 0) !== 0).length;

  $('kpi_total').textContent = totalTraslados;
  $('kpi_cumplidos').textContent = cumplidos;
  $('kpi_cumplimiento').textContent = (totalTraslados ? Math.round(cumplidos * 100 / totalTraslados) : 0) + '% de cumplimiento';
  $('kpi_pendientes').textContent = pendientes;
  $('kpi_urgentes').textContent = urgentes;
  $('kpi_novedades').textContent = totalNovAnul;
  $('kpi_novedades_abiertas').textContent = anulados.length + ' anulados · ' + abiertas + ' sin solucionar';
  $('kpi_dif_inv').textContent = difInv;

  // Tiempos promedio del ciclo logistico (Alistamiento, Espera Despacho, Transito)
  /* v3.16.0: promedio() ignora nulos; lista vacia -> null -> "--" */
  const pAlist = lista.length ? promedio(lista.map(t => t.tAlistamiento)) : null;
  const pEspera = lista.length ? promedio(lista.map(t => t.tEsperaDespacho)) : null;
  const pTransito = lista.length ? promedio(lista.map(t => t.tTransito)) : null;
  $('kpi_t_alist').textContent = formatoDuracion(pAlist);
  $('kpi_t_espera').textContent = formatoDuracion(pEspera);
  $('kpi_t_transito').textContent = formatoDuracion(pTransito);

  pintarGraficas(lista, pAlist, pEspera, pTransito);
}

function pintarGraficas(lista, pAlist, pEspera, pTransito) {
  /* ── Gráfica 1: Estado del seguimiento (Dona) ── */
  const conteo = { CUMPLIDO: 0, 'EN TRANSITO': 0, PENDIENTE: 0, NOVEDAD: 0 };
  lista.forEach(t => {
    const est = t.tieneNovedad && t.estado !== 'CUMPLIDO' ? 'NOVEDAD' : t.estado;
    conteo[est] = (conteo[est] || 0) + 1;
  });
  // Filtrar solo estados con datos > 0
  const estadosActivos = Object.keys(conteo).filter(k => conteo[k] > 0);
  const datosEstados = estadosActivos.map(k => conteo[k]);
  const totalEstados = datosEstados.reduce((a, b) => a + b, 0);
  const coloresEstados = {
    CUMPLIDO: '#2fb457',
    'EN TRANSITO': '#0d6efd',
    PENDIENTE: '#ffc107',
    NOVEDAD: '#dc3545'
  };
  const bgEstados = estadosActivos.map(k => coloresEstados[k] || '#6c757d');

  dibujarDona('chartEstados', estadosActivos, datosEstados, bgEstados, totalEstados);

  /* ── Gráfica 2: Traslados por zona (Barras) — 13 zonas definidas ── */
  const ZONAS_13 = [
    'ZONA CAUCA NORTE', 'ZONA CAUCA SUR', 'ZONA CAUCA CENTRO', 'ZONA VALLE',
    'ZONA TOLIMA', 'ZONA EJE CAFETERO', 'ZONA NARIÑO', 'ZONA CUNDINAMARCA',
    'ZONA CAQUETA', 'ZONA COSTA NORTE', 'ZONA BOYACA',
    'ZONA BODEGA VIRTUAL', 'ZONA BODEGA VALLE'
  ];
  const porZona = {};
  ZONAS_13.forEach(z => { porZona[z] = 0; });
  lista.forEach(t => { const z = t.zona || 'SIN ZONA'; porZona[z] = (porZona[z] || 0) + 1; });
  // Ordenar: primero las 13 zonas definidas (por conteo descendente), luego zonas fuera de lista
  const zonasDefinidas = ZONAS_13.filter(z => porZona[z] > 0).sort((a, b) => porZona[b] - porZona[a]);
  const zonasExtra = Object.keys(porZona).filter(z => !ZONAS_13.includes(z) && porZona[z] > 0).sort((a, b) => porZona[b] - porZona[a]);
  const labelsZona = [...zonasDefinidas, ...zonasExtra];
  const datosZona = labelsZona.map(z => porZona[z]);
  // Colores distintos por zona
  const coloresZona = [
    '#0d6efd', '#198754', '#6f42c1', '#d63384', '#fd7e14',
    '#20c997', '#0dcaf0', '#ffc107', '#dc3545', '#6c757d',
    '#491078', '#0b5ed7', '#479f40'
  ];
  const bgZona = labelsZona.map((_, i) => coloresZona[i % coloresZona.length]);

  dibujarBarrasZona('chartZonas', labelsZona, datosZona, bgZona);

  /* ── Gráfica 3: Tiempos promedio por proceso (Columnas con datalabels) ── */
  const labelsTiempo = ['Alistamiento', 'Espera despacho', 'Tránsito'];
  const datosTiempo = [
    pAlist !== null ? Math.round(pAlist * 10) / 10 : 0,
    pEspera !== null ? Math.round(pEspera * 10) / 10 : 0,
    pTransito !== null ? Math.round(pTransito * 10) / 10 : 0
  ];
  const bgTiempo = ['#2fb457', '#0d6efd', '#8e44ad'];
  const tieneDatosTiempo = datosTiempo.some(v => v > 0);

  dibujarBarrasTiempo('chartTiempos', labelsTiempo, datosTiempo, bgTiempo, tieneDatosTiempo);
}

/** Dibuja gráfica de dona (Estado del seguimiento) con etiquetas de cantidad y porcentaje. */
function dibujarDona(canvasId, labels, data, bgColors, total) {
  if (CHARTS[canvasId]) CHARTS[canvasId].destroy();
  if (!labels.length || total === 0) {
    // Estado vacío limpio: mostrar dona gris con "Sin datos"
    CHARTS[canvasId] = new Chart($(canvasId), {
      type: 'doughnut',
      data: {
        labels: ['Sin datos'],
        datasets: [{ data: [1], backgroundColor: ['#e9ecef'], borderWidth: 0 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#6c757d' } },
          tooltip: { enabled: false }
        },
        cutout: '65%'
      },
      plugins: [{
        id: 'centroVacio',
        afterDraw(chart) {
          const { ctx, chartArea: { left, right, top, bottom } } = chart;
          const cx = (left + right) / 2, cy = (top + bottom) / 2;
          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = '600 16px system-ui';
          ctx.fillStyle = '#6c757d';
          ctx.fillText('Sin datos', cx, cy);
          ctx.restore();
        }
      }]
    });
    return;
  }
  CHARTS[canvasId] = new Chart($(canvasId), {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: bgColors,
        borderWidth: 2,
        borderColor: '#fff',
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 14,
            usePointStyle: true,
            pointStyleWidth: 10,
            font: { size: 11, weight: '500' },
            generateLabels(chart) {
              const ds = chart.data.datasets[0];
              return chart.data.labels.map((label, i) => ({
                text: label + ' (' + ds.data[i] + ' — ' + Math.round(ds.data[i] * 100 / total) + '%)',
                fillStyle: ds.backgroundColor[i],
                strokeStyle: ds.backgroundColor[i],
                lineWidth: 0,
                pointStyle: 'circle',
                index: i
              }));
            }
          }
        },
        tooltip: {
          callbacks: {
            label(ctx) {
              const v = ctx.parsed;
              const pct = Math.round(v * 100 / total);
              return ' ' + ctx.label + ': ' + v + ' (' + pct + '%)';
            }
          }
        }
      }
    },
    plugins: [{
      id: 'centroDona',
      afterDraw(chart) {
        const { ctx, chartArea: { left, right, top, bottom } } = chart;
        const cx = (left + right) / 2, cy = (top + bottom) / 2;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '700 22px system-ui';
        ctx.fillStyle = '#212529';
        ctx.fillText(total, cx, cy - 8);
        ctx.font = '400 11px system-ui';
        ctx.fillStyle = '#6c757d';
        ctx.fillText('traslados', cx, cy + 10);
        ctx.restore();
      }
    }]
  });
}

/** Dibuja gráfica de barras por zona con datalabels de conteo. */
function dibujarBarrasZona(canvasId, labels, data, bgColors) {
  if (CHARTS[canvasId]) CHARTS[canvasId].destroy();
  if (!labels.length || data.every(v => v === 0)) {
    CHARTS[canvasId] = new Chart($(canvasId), {
      type: 'bar',
      data: { labels: ['Sin datos'], datasets: [{ data: [0], backgroundColor: ['#e9ecef'] }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { beginAtZero: true, display: false } }
      }
    });
    return;
  }
  CHARTS[canvasId] = new Chart($(canvasId), {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Traslados',
        data: data,
        backgroundColor: bgColors,
        borderRadius: 4,
        maxBarThickness: 36
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: labels.length > 8 ? 'y' : 'x',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(ctx) {
              const val = ctx.chart.options.indexAxis === 'y' ? ctx.parsed.x : ctx.parsed.y;
              return ' ' + val + ' traslados';
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, font: { size: 10 } },
          grid: { color: '#f0f0f0' }
        },
        x: {
          ticks: {
            font: { size: 9 },
            maxRotation: 45,
            callback(val) {
              const lbl = this.getLabelForValue(val);
              return lbl.length > 14 ? lbl.substring(0, 12) + '…' : lbl;
            }
          },
          grid: { display: false }
        }
      }
    },
    plugins: [{
      id: 'datalabelsZona',
      afterDatasetDraw(chart) {
        const { ctx } = chart;
        const meta = chart.getDatasetMeta(0);
        const horiz = chart.options.indexAxis === 'y';
        meta.data.forEach((bar, i) => {
          const v = chart.data.datasets[0].data[i];
          if (!v) return;
          ctx.save();
          ctx.font = '600 11px system-ui';
          ctx.fillStyle = '#212529';
          if (horiz) {
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(v, bar.x + 5, bar.y);
          } else {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(v, bar.x, bar.y - 4);
          }
          ctx.restore();
        });
      }
    }]
  });
}

/** Dibuja gráfica de columnas de tiempos con datalabels (1 decimal + ' hrs'). */
function dibujarBarrasTiempo(canvasId, labels, data, bgColors, tieneDatos) {
  if (CHARTS[canvasId]) CHARTS[canvasId].destroy();
  if (!tieneDatos) {
    CHARTS[canvasId] = new Chart($(canvasId), {
      type: 'bar',
      data: { labels: labels, datasets: [{ data: [0, 0, 0], backgroundColor: ['#dee2e6','#dee2e6','#dee2e6'] }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { y: { beginAtZero: true, display: true, title: { display: true, text: 'Horas', font: { size: 10 } } }, x: { grid: { display: false } } }
      },
      plugins: [{
        id: 'sinDatosTiempo',
        afterDatasetDraw(chart) {
          const { ctx } = chart;
          const meta = chart.getDatasetMeta(0);
          meta.data.forEach((bar) => {
            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.font = '500 11px system-ui';
            ctx.fillStyle = '#adb5bd';
            ctx.fillText('--', bar.x, bar.y - 4);
            ctx.restore();
          });
        }
      }]
    });
    return;
  }
  CHARTS[canvasId] = new Chart($(canvasId), {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Horas promedio',
        data: data,
        backgroundColor: bgColors,
        borderRadius: 6,
        maxBarThickness: 52
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(ctx) { return ' ' + ctx.parsed.y.toFixed(1) + ' horas'; }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Horas', font: { size: 11 } },
          ticks: { font: { size: 10 } },
          grid: { color: '#f0f0f0' }
        },
        x: {
          grid: { display: false },
          ticks: { font: { size: 11, weight: '500' } }
        }
      }
    },
    plugins: [{
      id: 'datalabelsTiempo',
      afterDatasetDraw(chart) {
        const { ctx } = chart;
        const meta = chart.getDatasetMeta(0);
        meta.data.forEach((bar, i) => {
          const v = chart.data.datasets[0].data[i];
          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.font = '700 13px system-ui';
          ctx.fillStyle = '#212529';
          ctx.fillText(v.toFixed(1) + ' hrs', bar.x, bar.y - 6);
          ctx.restore();
        });
      }
    }]
  });
}

/* ---------------------------------------------------------------------------
 * 6. RENDERIZADO DE TABLAS
 * ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * RENDIMIENTO: LIMITE DE RENDERIZADO (Top 100) — v3.20.0
 * Los KPIs y los filtros SIEMPRE operan sobre el dataset COMPLETO en memoria.
 * En el DOM de cada tabla se pintan solo los primeros 100 registros mas
 * recientes (orden por fecha descendente) para lograr carga instantanea.
 * Al filtrar/buscar, se recalcula el subconjunto completo y se vuelven a
 * mostrar los 100 coincidentes de mayor prioridad (mas recientes).
 * ------------------------------------------------------------------------- */
const TOP_VISIBLE = 100;

/** Ordena una copia de `filas` por fecha descendente (mas reciente primero). */
function _ordenarPorFechaDesc(filas, obtenerFecha) {
  return filas.slice().sort((a, b) => {
    const fa = aFecha(obtenerFecha(a)), fb = aFecha(obtenerFecha(b));
    const ta = fa ? fa.getTime() : 0, tb = fb ? fb.getTime() : 0;
    return tb - ta;
  });
}

/** Toma los primeros TOP_VISIBLE registros para renderizar en el DOM. */
function _top(filas) { return filas.slice(0, TOP_VISIBLE); }

/** Sufijo informativo: indica cuando se estan mostrando solo los primeros 100. */
function _sufijoTop(total, visibles) {
  return total > visibles ? ` · mostrando ${visibles} de ${total}` : '';
}

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
  pintarTabla('head_s1', 'body_s1', columnas,
    _top(_ordenarPorFechaDesc(lista, t => t.marca)), t =>
    urgenteEnRiesgo(t) ? 'fila-urgente-pendiente' : (t.estado === 'CUMPLIDO' ? 'fila-cumplido' : ''));
  $('info_s1').textContent = `${lista.length} traslados · ${lista.filter(urgenteEnRiesgo).length} urgentes en riesgo` + _sufijoTop(lista.length, TOP_VISIBLE);
}

/* ---------- SECCION 2: recepcion tecnica ---------- */
function recepcionFiltrada() {
  const q = normalizarCabecera(val('buscar_s2'));
  const tipoTraslado = val('f_tipo_s2'); // '' = externos (default), 'interno', 'todos'
  return FUENTES.recepcion.filter(r => {
    const tipo = normalizarCabecera(obtenerValorPorNombreColumna(r, A.tipoRecepcion));
    if (tipo && tipo.indexOf('traslado') === -1) return false;
    // Toggle EXTERNOS / INTERNOS segun la bodega de origen del traslado
    const interno = esBodegaInterna(obtenerValorPorNombreColumna(r, A.origen));
    if (tipoTraslado === 'interno' && !interno) return false;
    if (tipoTraslado === 'todos') { /* sin filtro por tipo */ }
    else if (tipoTraslado !== 'interno' && interno) return false; // default: solo EXTERNOS
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
    { titulo: 'Bodega Origen del Traslado', alias: A.origen },
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
  pintarTabla('head_s2', 'body_s2', columnas,
    _top(_ordenarPorFechaDesc(filas, r => obtenerValorPorNombreColumna(r, A.fRecepcion) || obtenerValorPorNombreColumna(r, A.marca))), r => {
    const dif = Number(obtenerValorPorNombreColumna(r, A.cantRecibida) || 0) - Number(obtenerValorPorNombreColumna(r, A.cantEnviada) || 0);
    const estado = normalizarCabecera(obtenerValorPorNombreColumna(r, A.estadoRec));
    return (dif !== 0 || estado === 'novedad') ? 'fila-diferencia' : '';
  });
  const tipoLbl = val('f_tipo_s2') === 'interno' ? 'internos' : (val('f_tipo_s2') === 'todos' ? '(todos)' : 'externos');
  $('info_s2').textContent = `${filas.length} items recibidos · ${tipoLbl}` + _sufijoTop(filas.length, TOP_VISIBLE);
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
  pintarTabla('head_s3', 'body_s3', columnas,
    _top(_ordenarPorFechaDesc(filas, n => obtenerValorPorNombreColumna(n, A.marca))), n =>
    normalizarCabecera(obtenerValorPorNombreColumna(n, A.solucionado)) === 'si' ? 'fila-cumplido' : 'fila-diferencia');
  $('info_s3').textContent = `${filas.length} novedades registradas` + _sufijoTop(filas.length, TOP_VISIBLE);
}

/* ---------- SECCION 4: inventario ---------- */
function inventarioFiltrado() {
  const bod = val('f_bodega_inv'), soloDif = val('f_solo_dif'), q = normalizarCabecera(val('buscar_s4'));
  return FUENTES.inventario.filter(i => {
    const fecha = obtenerValorPorNombreColumna(i, ['Fecha Verificacion']) || obtenerValorPorNombreColumna(i, A.marca);
    if (!dentroDeRango(fecha)) return false;
    if (bod) {
      const bodRow = normalizarCabecera(obtenerValorPorNombreColumna(i, A.bodegaInv));
      // B09 se resuelve por prefijo 'b09' (la fila puede traer solo 'B09' o el nombre largo)
      const bodKey = normalizarCabecera(bod).indexOf('b09') === 0 ? 'b09' : normalizarCabecera(bod);
      if (bodRow.indexOf(bodKey) === -1) return false;
    }
    if (soloDif && Number(obtenerValorPorNombreColumna(i, A.diferencia) || 0) === 0) return false;
    if (q && !normalizarCabecera(JSON.stringify(i)).includes(q)) return false;
    return true;
  });
}

function pintarSeccion4() {
  const filas = inventarioFiltrado();
  const columnas = [
    { titulo: 'Fecha Verificacion', fn: i => obtenerValorPorNombreColumna(i, ['Fecha Verificacion']) || obtenerValorPorNombreColumna(i, A.marca) },
    { titulo: 'Bodega (CENDIS / B05 / B09)', alias: A.bodegaInv },
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
  pintarTabla('head_s4', 'body_s4', columnas,
    _top(_ordenarPorFechaDesc(filas, i => obtenerValorPorNombreColumna(i, ['Fecha Verificacion']) || obtenerValorPorNombreColumna(i, A.marca))), i =>
    Number(obtenerValorPorNombreColumna(i, A.diferencia) || 0) !== 0 ? 'fila-diferencia' : '');
  const conDif = filas.filter(i => Number(obtenerValorPorNombreColumna(i, A.diferencia) || 0) !== 0).length;
  $('info_s4').textContent = `${filas.length} items verificados · ${conDif} con diferencia` + _sufijoTop(filas.length, TOP_VISIBLE);
}

/* ---------------------------------------------------------------------------
 * 7. APERTURA DEL DIA — 15 GRUPOS FIJOS (9 CEDIS + 6 B09)
 *    15 grupos fijos con miembros definidos (9 CEDIS + 6 B09). Sin rotacion ciclica.
 *    Cada grupo muestra: nombre numerico + lista de miembros.
 *    Grupo 9 = especial (asignado a B05 ALTO COSTO).
 *    Grupos 1-8 = asignados a CENDIS PRINCIPAL TULUA PARQUE INDUSTRIAL.
 *    Grupos B09-1 a B09-6 = auxiliares B09 individuales.
 ------------------------------------------------------------------------- */

const GRUPOS_FIJOS = [
  { nombre: 'Grupo 1', numero: 1, tipo: 'cendis', hex: '#2563eb', miembros: ['Angie Mar\u00eda Tascon', 'Estefania Parra', 'Nicoll Trivi\u00f1o'], lider: 'LUISA' },
  { nombre: 'Grupo 2', numero: 2, tipo: 'cendis', hex: '#0891b2', miembros: ['Juan David Donato Moreno', 'Natalia Galvez', 'Daniela Nore\u00f1a'], lider: 'ADMINISTRATIVO' },
  { nombre: 'Grupo 3', numero: 3, tipo: 'cendis', hex: '#16a34a', miembros: ['Ana Lorena Ortiz', 'Karina Riascos', 'Vanesa Escobar'], lider: 'LUISA' },
  { nombre: 'Grupo 4', numero: 4, tipo: 'cendis', hex: '#65a30d', miembros: ['Leidy Valencia', 'Bivian Lorena Rivera', 'Brayan Camilo Izquierdo'], lider: 'LUZ' },
  { nombre: 'Grupo 5', numero: 5, tipo: 'cendis', hex: '#7c3aed', miembros: ['Claudia Echeverry', 'Kelly Jhojana Beltran Benjumea', 'Luz Lopez'], lider: 'LUZ' },
  { nombre: 'Grupo 6', numero: 6, tipo: 'cendis', hex: '#d97706', miembros: ['Derly Yulieth Mosquera', 'Liz Karime Valencia', 'Angela Vanessa Aguirre'], lider: 'LUZ' },
  { nombre: 'Grupo 7', numero: 7, tipo: 'cendis', hex: '#db2777', miembros: ['Luis Felipe Marin', 'Manuel David Salazar'], lider: 'ADMINISTRATIVO' },
  { nombre: 'Grupo 8', numero: 8, tipo: 'cendis', hex: '#0d9488', miembros: ['Mayra Alejandra Franco Muñoz', 'Camila Posada', 'Julieth Cardenas'], lider: 'ANDREA' },
  { nombre: 'Grupo 9', numero: 9, tipo: 'cendis', hex: '#64748b', miembros: ['Jhony Saenz Sanchez', 'Valentina Cano Peña', 'Yeimy Aldana'], lider: 'LUISA' },
  { nombre: 'B09-1', numero: 10, tipo: 'b09', hex: '#0891b2', miembros: ['Jose Santiago Ramirez Obando'], lider: 'Jose Santiago Ramirez Obando' },
  { nombre: 'B09-2', numero: 11, tipo: 'b09', hex: '#db2777', miembros: ['Yuliana Andrea Quira Manquillo'], lider: 'Yuliana Andrea Quira Manquillo' },
  { nombre: 'B09-3', numero: 12, tipo: 'b09', hex: '#16a34a', miembros: ['Luisa Fernanda Garcia Orozco'], lider: 'Luisa Fernanda Garcia Orozco' },
  { nombre: 'B09-4', numero: 13, tipo: 'b09', hex: '#d97706', miembros: ['Nedi Yojana Zamora Yandi'], lider: 'Nedi Yojana Zamora Yandi' },
  { nombre: 'B09-5', numero: 14, tipo: 'b09', hex: '#7c3aed', miembros: ['Beatriz Eugenia Urbano Botina'], lider: 'Beatriz Eugenia Urbano Botina' },
  { nombre: 'B09-6', numero: 15, tipo: 'b09', hex: '#334155', miembros: ['Mery Yolanda Cadavid Bermudez'], lider: 'Mery Yolanda Cadavid Bermudez' }
];

/** Genera la lista de grupos del dia (fija, sin rotacion). */
function generarGruposDelDia() {
  return GRUPOS_FIJOS.map(g => ({
    nombre: g.nombre,
    miembros: g.miembros.slice()
  }));
}

/** Pinta los grupos fijos en el panel de Apertura del Dia (Clean UI corporativo) */
function pintarAperturaDia() {
  const cont = $('rot_grupos_container');
  const info = $('info_rotacion');

  // Filtro por vista: fijos (todos) / cendis / b09
  const vista = (val('rot_vista') || 'fijos');
  const grupos = GRUPOS_FIJOS.filter(g => {
    if (vista === 'cendis') return g.tipo === 'cendis';
    if (vista === 'b09') return g.tipo === 'b09';
    return true;
  });

  if (cont) {
    cont.innerHTML = '';

    grupos.forEach(grupo => {
      // Responsive Grid: 4 columnas en alta resolucion, 2 en tablet, 1 en movil
      const col = document.createElement('div');
      col.className = 'col-xl-3 col-lg-4 col-md-6 col-12';

      const card = document.createElement('div');
      card.className = 'rot-grupo-card';
      card.style.borderLeftColor = grupo.hex;

      // Encabezado: titulo (sin redundancia) + lider
      const header = document.createElement('div');
      header.className = 'rot-grupo-card-header';

      const titulo = document.createElement('div');
      titulo.className = 'rot-grupo-titulo';
      titulo.innerHTML =
        '<span class="rot-grupo-dot" style="background:' + grupo.hex + '"></span>' +
        '<span>' + esc(grupo.nombre) + '</span>' +
        '<span class="rot-grupo-conteo ms-auto">' + grupo.miembros.length + ' ' +
        (grupo.miembros.length === 1 ? 'integrante' : 'integrantes') + '</span>';
      header.appendChild(titulo);

      if (grupo.lider) {
        const lider = document.createElement('div');
        lider.className = 'rot-grupo-lider';
        lider.innerHTML = '<span class="lbl">L\u00edder:</span> ' + esc(grupo.lider);
        header.appendChild(lider);
      }
      card.appendChild(header);

      // Cuerpo: integrantes tabulados y numerados
      const body = document.createElement('div');
      body.className = 'rot-grupo-card-body';
      grupo.miembros.forEach((nombre, i) => {
        const row = document.createElement('div');
        row.className = 'rot-grupo-miembro';
        const num = document.createElement('span');
        num.className = 'num';
        num.textContent = (i + 1);
        const txt = document.createElement('span');
        txt.textContent = nombre;
        row.appendChild(num);
        row.appendChild(txt);
        body.appendChild(row);
      });
      card.appendChild(body);

      col.appendChild(card);
      cont.appendChild(col);
    });
  }

  /* Info banner */
  if (info) {
    const total = grupos.reduce((s, g) => s + g.miembros.length, 0);
    info.innerHTML = '<span class="badge bg-secondary">' + grupos.length + ' grupos &middot; ' + total + ' personas</span>';
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
  pintarTabla('head_s5', 'body_s5', columnas,
    _top(_ordenarPorFechaDesc(filas, r => obtenerValorPorNombreColumna(r, A.marca))), r => {
    const rev = normalizarCabecera(obtenerValorPorNombreColumna(r, A.revisado));
    const urg = normalizarCabecera(obtenerValorPorNombreColumna(r, A.urgente));
    return (rev !== 'si' && urg === 'si') ? 'fila-urgente-pendiente' : (rev === 'si' ? 'fila-cumplido' : '');
  });
  const revisados = filas.filter(r => normalizarCabecera(obtenerValorPorNombreColumna(r, A.revisado)) === 'si').length;
  $('info_s5').textContent = `${filas.length} registros · ${revisados} revisados · ${filas.length - revisados} sin revisar` + _sufijoTop(filas.length, TOP_VISIBLE);
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
  /* modoLocal eliminado v3.10.0 */
  pintarPerfilesVisor();
}

function pintarPerfilesVisor() {
  const perfiles = CONFIG.perfiles || {};
  const LABELS = {
    despachos: 'Despachos (BD_PLANILLA_ENTREGA_DESPACHOS)',
    asignacion: 'Asignacion de Traslados (BD_ASIGNACION_DE_TRASLADO)',
    entregaLogistica: 'Entrega a Logistica (BD_ENTREGA_A_LOGISTICA)',
    despachoAsignacion: 'Despacho y Asignacion de Traslados',
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
    /* modoLocal eliminado v3.10.0 */
    localStorage.setItem(LS_KEY_VISOR, JSON.stringify(CONFIG));
    cargarDatos();
  });

  $('btnRefrescar').addEventListener('click', cargarDatos);
  if ($('btnSincronizarDrive')) $('btnSincronizarDrive').addEventListener('click', sincronizarDrive);
  $('btnExportar').addEventListener('click', exportarConsolidado);
  if ($('btnProbarApi')) $('btnProbarApi').addEventListener('click', probarConexion);
  $('btnPlanillaDespachos').addEventListener('click', descargarPlanillaDespachos);
  $('btnPlanillaImprimir').addEventListener('click', imprimirPlanillaDespachos);
  $('btnAplicar').addEventListener('click', refrescarTodo);
  if ($('btnExportarLogistica')) $('btnExportarLogistica').addEventListener('click', exportarLogistica);

  // Botones de Apertura del Dia
  if ($('btnGuardarRotacion')) $('btnGuardarRotacion').addEventListener('click', accionGuardarRotacion);
  if ($('rot_vista')) $('rot_vista').addEventListener('change', pintarAperturaDia);
  if ($('rot_fecha')) {
    $('rot_fecha').addEventListener('change', function() { accionCargarRotacionFecha(); refrescarTodo(); });
    /* Default: fecha de hoy */
    const hoyISO = new Date().toISOString().split('T')[0];
    $('rot_fecha').value = hoyISO;
  }

  $('btnLimpiarFiltros').addEventListener('click', () => {
    ['f_desde', 'f_hasta', 'f_origen', 'f_destino', 'f_zona', 'f_estado', 'f_urgente',
     'f_bodega_inv', 'f_solo_dif', 'f_zona_log', 'f_revisado_log', 'f_tipo_s2',
     'buscar_s1', 'buscar_s2', 'buscar_s3', 'buscar_s4', 'buscar_s5', 'buscar_traslado_5']
      .forEach(id => { if ($(id)) $(id).value = ''; });
    refrescarTodo();
  });

  ['buscar_s1', 'buscar_s2', 'buscar_s3', 'buscar_s4', 'buscar_s5', 'buscar_traslado_5', 'f_bodega_inv', 'f_solo_dif']
    .forEach(id => { if ($(id)) $(id).addEventListener('input', refrescarTodo); });
  ['f_desde', 'f_hasta', 'f_origen', 'f_destino', 'f_zona', 'f_estado', 'f_urgente', 'f_zona_log', 'f_revisado_log', 'f_tipo_s2']
    .forEach(id => { if ($(id)) $(id).addEventListener('change', refrescarTodo); });

  restaurarUltimaSync();
  cargarDatos();

  // v3.19.0 — AUTO-FETCH en segundo plano: relee las fuentes de Drive cada 3 min
  // sin intervencion del usuario (servicio de actualizacion automatica).
  setInterval(() => { if (CONFIG.apiUrl) _refrescoDirectoBackground(false); }, 180000);
});
