/* =================================================================================
 * MEDISFARMA | visor_script.js
 * VISOR: consolidado de traslados, recepcion tecnica externa, novedades,
 * control de inventario, filtros, alertas de urgencias y medicion de tiempos.
 * Toda la lectura se hace por NOMBRE DE CABECERA (nunca por indice de columna).
 * ================================================================================= */
'use strict';

const LS_KEY_VISOR = 'MF_CONFIG_VISOR';
const LS_DATA_CARGUE = 'MF_DATOS_SESION';

let CONFIG = Object.assign({
  apiUrl: '',
  modoLocal: true,
  folders: {
    despachos:   '1u30YFhTsocLuUoFrVUnb6Fk9zwVsT_E_',
    logistica:   '1_e8ycbznm0jA4kOBwkJuXM4EVdcwXzYe',
    recepcion:   '1u5aQURkwKw4CqxejzOSxYgeF6dvcj-T0',
    novedades:   '1hpRjykdlFyU_nsdXb0ttqOJdHNoXcTG-',
    inventario:  '11Iml2ggmvAK8aHeUbDGeWbyhLxCtrPoY',
    facturacion: '1hpRjykdlFyU_nsdXb0ttqOJdHNoXcTG-',
    backup:      '1HVTZyLasrbZArTN34kmc0lCKaQa2qQ_5'
  },
  perfiles: {
    despachos:   { file: 'BD_PLANILLA_ENTREGA_DESPACHOS', sheet: 'DATOS' },
    logistica:   { file: 'BD_LOGISTICA_DESPACHOS',         sheet: 'DATOS' },
    recepcion:   { file: 'BD_RECEPCION_TECNICA',           sheet: 'DATOS' },
    facturacion: { file: 'BD_FACTURA_TRANSPORTE',         sheet: 'DATOS' },
    inventario:  { file: 'BD_VERIFICACION_INVENTARIO',     sheet: 'DATOS' }
  }
}, JSON.parse(localStorage.getItem(LS_KEY_VISOR) || '{}'));

/** Datos crudos por fuente y datos derivados. */
let FUENTES = { despachos: [], logistica: [], recepcion: [], novedades: [], inventario: [], facturacion: [] };
let TRASLADOS = [];    // consolidado calculado
let CHARTS = {};

/* ---------------------------------------------------------------------------
 * 0. CREDENCIALES DE USUARIO (LOGIN)
 * ------------------------------------------------------------------------- */
const CREDENCIALES_VISOR = {
  administrador:       'Medis2024Admin',
  lider:              'Medis2024Lider',
  auxiliar_entrega:   'Medis2024Aux',
  recibido_logistica: 'Medis2024Recib',
  planillar_logistica:'Medis2024Plan'
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
  lider: 'LIDER',
  auxiliar_entrega: 'AUXILIAR ENTREGA',
  recibido_logistica: 'RECIBIDO LOGISTICA',
  planillar_logistica: 'PLANILLAR LOGISTICA'
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

/**
 * Devuelve el valor de la fila buscando la columna por NOMBRE (o alias).
 * Funciona igual si las columnas cambian de orden, faltan o se agregan nuevas.
 */
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
  alista:       ['QUIEN ALISTA', 'Responsable de Empacar / Rotular'],
  destino:      ['DESTINO', 'BODEGA DESTINO DEL TRASLADO', 'Bodega Destino (CENDIS / B05)', 'Bodega Destino'],
  zona:         ['ZONA'],
  seguimiento:  ['SEGUIMIENTO'],
  respCendis:   ['RESPONSABLE DE ENTREGA CENDIS', 'Responsable de Entrega'],
  tipo:         ['TIPO'],
  fEntregaLog:  ['FECHA ENTREGA LOGISTICA', 'Fecha y Hora de Registro Logistico'],
  recibeLog:    ['QUIEN RECIBE LOGISTICA'],
  fPlanilla:    ['FECHA PLANILLA ENVIO LOGISTICA', 'Fecha de Envio del Traslado'],
  conductor:    ['CONDUCTOR', 'Responsable de Envio'],
  planilla:     ['PLANILLA'],
  fRecibidoPto: ['FECHA RECIBIDO EN PUNTO'],
  quienRecibe:  ['QUIN RECIBE', 'QUIEN RECIBE', 'Quien Recibe en Punto'],
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
  estadoInv:    ['Estado / Novedad', 'Estado Verificacion']
};

/** Convierte texto de fecha (varios formatos) a Date o null. */
function aFecha(texto) {
  if (!texto) return null;
  if (texto instanceof Date) return texto;
  let s = String(texto).trim().replace('T', ' ');
  // dd/mm/yyyy [hh:mm[:ss]]
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  // yyyy-mm-dd [hh:mm[:ss]]
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Diferencia en horas entre dos fechas (null si falta alguna). */
function horasEntre(desde, hasta) {
  const a = aFecha(desde), b = aFecha(hasta);
  if (!a || !b) return null;
  const h = (b - a) / 3600000;
  return h < 0 ? null : h;
}

/** Formatea horas a "Xd Yh Zm". */
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
 * 2. CARGA DE DATOS (Drive via Web App, o datos locales del modulo de Cargue)
 * ------------------------------------------------------------------------- */
async function api(action, payload = {}) {
  const res = await fetch(CONFIG.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action }, payload))
  });
  const data = await res.json();
  if (data.ok === false) throw new Error(data.error || 'Error del backend');
  return data;
}

async function cargarDatos() {
  $('estadoApi').className = 'badge bg-light text-dark';
  $('estadoApi').textContent = 'Cargando...';

  if (CONFIG.modoLocal || !CONFIG.apiUrl) {
    const local = JSON.parse(localStorage.getItem(LS_DATA_CARGUE) || '{}');
    FUENTES = {
      despachos: local.despachos || [], logistica: local.logistica || [],
      recepcion: local.recepcion || [], novedades: local.novedades || [],
      inventario: local.inventario || [], facturacion: local.facturacion || []
    };
    $('estadoApi').className = 'badge bg-secondary';
    $('estadoApi').textContent = 'Datos locales';
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
      $('estadoApi').textContent = 'Sin conexión';
      console.warn(e);
    }
  }

  construirConsolidado();
  poblarFiltros();
  refrescarTodo();
}

/* ---------------------------------------------------------------------------
 * 3. CONSOLIDADO DE TRASLADOS (despachos + logistica + novedades)
 * ------------------------------------------------------------------------- */

/**
 * Une los registros por numero de traslado. La informacion mas reciente
 * completa (no sobreescribe con vacios) la del registro anterior.
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

  // Novedades: indicador aparte; en el seguimiento el traslado se toma CUMPLIDO
  // conservando la Marca temporal inicial para no alterar los tiempos.
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
    else if (nov) estado = 'CUMPLIDO';              // modificacion/anulacion = cumplido
    else if (fPlanilla) estado = 'EN TRANSITO';
    else estado = 'PENDIENTE';

    const urgente = obtenerValorPorNombreColumna(r, A.urgente);

    return {
      crudo: r,
      novedad: nov,
      traslado: obtenerValorPorNombreColumna(r, A.traslado),
      marca, fEntregaLog, fPlanilla, fRecibido,
      fechaInicial: marca,                           // se conserva siempre la inicial
      origen: obtenerValorPorNombreColumna(r, A.origen),
      destino: obtenerValorPorNombreColumna(r, A.destino),
      zona: obtenerValorPorNombreColumna(r, A.zona),
      urgente: urgente || 'NO',
      estado,
      tieneNovedad: !!nov,
      novedadResuelta: nov ? normalizarCabecera(obtenerValorPorNombreColumna(nov, A.solucionado)) : '',
      tAlistamiento: horasEntre(marca, fEntregaLog),
      tEsperaDespacho: horasEntre(fEntregaLog, fPlanilla),
      tTransito: horasEntre(fPlanilla, fRecibido)
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
  llenar('f_zona', TRASLADOS.map(t => t.zona));
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
    // Filtro por ultimos 5 digitos del traslado
    if (ult5) {
      const numTraslado = String(obtenerValorPorNombreColumna(t.crudo, A.traslado) || '').trim();
      if (numTraslado.slice(-5) !== ult5) return false;
    }
    return true;
  });
}

/** Urgente en riesgo: marcado urgente y aun no enviado o no entregado en punto. */
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
    ['Alistamiento', 'Espera despacho', 'Tránsito'],
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

/** Pinta una tabla generica: columnas = [{titulo, alias|fn}] */
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
      if (c.html) td.innerHTML = v;         // solo contenido generado internamente
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

/* ---------- SECCION 1: consolidado de traslados ---------- */
function pintarSeccion1(lista) {
  const columnas = [
    { titulo: 'Marca temporal', alias: A.marca },
    { titulo: 'Correo electrónico', alias: A.correo },
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
    { titulo: 'T. Alistamiento', fn: t => formatoDuracion(t.tAlistamiento) },
    { titulo: 'T. Espera Despacho', fn: t => formatoDuracion(t.tEsperaDespacho) },
    { titulo: 'T. Tránsito', fn: t => formatoDuracion(t.tTransito) },
    { titulo: 'Novedad', fn: t => (t.tieneNovedad ? 'SI' : 'NO') }
  ];
  pintarTabla('head_s1', 'body_s1', columnas, lista, t =>
    urgenteEnRiesgo(t) ? 'fila-urgente-pendiente' : (t.estado === 'CUMPLIDO' ? 'fila-cumplido' : ''));
  $('info_s1').textContent = `${lista.length} traslados · ${lista.filter(urgenteEnRiesgo).length} urgentes en riesgo`;
}

/* ---------- SECCION 2: recepcion tecnica de traslados externos ---------- */
function recepcionFiltrada() {
  const q = normalizarCabecera(val('buscar_s2'));
  return FUENTES.recepcion.filter(r => {
    const tipo = normalizarCabecera(obtenerValorPorNombreColumna(r, A.tipoRecepcion));
    // La seccion monitorea traslados externos; si no hay tipo declarado se incluye.
    if (tipo && tipo.indexOf('traslado') === -1) return false;
    if (!dentroDeRango(obtenerValorPorNombreColumna(r, A.fRecepcion) || obtenerValorPorNombreColumna(r, A.marca))) return false;
    if (q && !normalizarCabecera(JSON.stringify(r)).includes(q)) return false;
    return true;
  });
}

function pintarSeccion2() {
  const filas = recepcionFiltrada();
  const columnas = [
    { titulo: 'Fecha Recepción Técnica', alias: A.fRecepcion },
    { titulo: 'Documento Traslado', alias: A.traslado },
    { titulo: 'Bodega Origen Externa', alias: A.origen },
    { titulo: 'Bodega Destino (CENDIS / B05)', alias: A.destino },
    { titulo: 'Código Producto / Molécula', alias: A.codigo },
    { titulo: 'Descripción', alias: A.descripcion },
    { titulo: 'Lote', alias: A.lote },
    { titulo: 'Fecha Vencimiento', alias: A.vencimiento },
    { titulo: 'Cantidad Enviada', alias: A.cantEnviada },
    { titulo: 'Cantidad Recibida', alias: A.cantRecibida },
    { titulo: 'Diferencia', fn: r => Number(obtenerValorPorNombreColumna(r, A.cantRecibida) || 0) - Number(obtenerValorPorNombreColumna(r, A.cantEnviada) || 0) },
    { titulo: 'Estado Recepción Técnica', alias: A.estadoRec },
    { titulo: 'Responsable de Recepción', alias: A.respRec },
    { titulo: 'Observaciones', alias: A.observaciones }
  ];
  pintarTabla('head_s2', 'body_s2', columnas, filas, r => {
    const dif = Number(obtenerValorPorNombreColumna(r, A.cantRecibida) || 0) - Number(obtenerValorPorNombreColumna(r, A.cantEnviada) || 0);
    const estado = normalizarCabecera(obtenerValorPorNombreColumna(r, A.estadoRec));
    return (dif !== 0 || estado === 'novedad') ? 'fila-diferencia' : '';
  });
  $('info_s2').textContent = `${filas.length} ítems recibidos`;
}

/* ---------- SECCION 3: novedades, modificaciones y anulaciones ---------- */
function pintarSeccion3() {
  const q = normalizarCabecera(val('buscar_s3'));
  const filas = FUENTES.novedades.filter(n =>
    dentroDeRango(obtenerValorPorNombreColumna(n, A.marca)) &&
    (!q || normalizarCabecera(JSON.stringify(n)).includes(q)));
  const columnas = [
    { titulo: 'Marca temporal', alias: A.marca },
    { titulo: 'Correo electrónico', alias: A.correo },
    { titulo: 'Bodega Origen del Traslado', alias: A.origen },
    { titulo: 'Bodega Destino del Traslado', alias: A.destino },
    { titulo: 'TRASLADO', alias: A.traslado },
    { titulo: 'Causa de anulación / modificación', alias: A.causa },
    { titulo: 'Solicita la corrección', alias: A.solicita },
    { titulo: 'Teléfono de contacto', alias: A.telefono },
    { titulo: 'SEGUIMIENTO', alias: A.seguimiento },
    { titulo: 'SOLUCIONADO', alias: A.solucionado },
    { titulo: 'Efecto en seguimiento', fn: () => 'CUMPLIDO (conserva fecha inicial)' }
  ];
  pintarTabla('head_s3', 'body_s3', columnas, filas, n =>
    normalizarCabecera(obtenerValorPorNombreColumna(n, A.solucionado)) === 'si' ? 'fila-cumplido' : 'fila-diferencia');
  $('info_s3').textContent = `${filas.length} novedades registradas`;
}

/* ---------- SECCION 4: control y verificacion de inventario ---------- */
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
    { titulo: 'Fecha Verificación', fn: i => obtenerValorPorNombreColumna(i, ['Fecha Verificacion']) || obtenerValorPorNombreColumna(i, A.marca) },
    { titulo: 'Bodega (CENDIS / B05)', alias: A.bodegaInv },
    { titulo: 'Responsable Asignado', alias: A.respInv },
    { titulo: 'Molécula / Medicamento', alias: A.molecula },
    { titulo: 'Código Producto', alias: ['Codigo Producto', 'Codigo Producto / Molecula'] },
    { titulo: 'Lote', alias: A.lote },
    { titulo: 'Fecha Vencimiento', alias: A.vencimiento },
    { titulo: 'Cantidad Teórica', alias: A.teorica },
    { titulo: 'Cantidad Física', alias: A.fisica },
    { titulo: 'Diferencia', alias: A.diferencia },
    { titulo: 'Estado / Novedad', alias: A.estadoInv },
    { titulo: 'Observaciones', alias: A.observaciones }
  ];
  pintarTabla('head_s4', 'body_s4', columnas, filas, i =>
    Number(obtenerValorPorNombreColumna(i, A.diferencia) || 0) !== 0 ? 'fila-diferencia' : '');
  const conDif = filas.filter(i => Number(obtenerValorPorNombreColumna(i, A.diferencia) || 0) !== 0).length;
  $('info_s4').textContent = `${filas.length} ítems verificados · ${conDif} con diferencia`;
}

/* ---------------------------------------------------------------------------
 * 7. REFRESCO GENERAL Y EXPORTACION
 * ------------------------------------------------------------------------- */
function refrescarTodo() {
  const lista = trasladosFiltrados();
  pintarKpis(lista);
  pintarSeccion1(lista);
  pintarSeccion2();
  pintarSeccion3();
  pintarSeccion4();
}

/** Exporta el consolidado visible a XLSX (una hoja por sección). */
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
    'Tiene Novedad': t.tieneNovedad ? 'SI' : 'NO'
  })));
  hoja('RECEPCION TECNICA', recepcionFiltrada());
  hoja('NOVEDADES', FUENTES.novedades);
  hoja('INVENTARIO', inventarioFiltrado());
  const d = new Date(), p = n => String(n).padStart(2, '0');
  XLSX.writeFile(wb, `Consolidado_Visor_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.xlsx`);
}

/* ---------------------------------------------------------------------------
 * 7.b PLANILLA DE DESPACHOS (descarga XLSX / impresión)
 *     Columnas fijas solicitadas por operación CENDIS - LOGISTICA.
 * ------------------------------------------------------------------------- */
const COLS_PLANILLA = ['Fecha', 'Bodega Origen', 'Bodega Destino', 'Traslado', 'Cantidad',
  'Tipo', 'Ruta', 'Fecha de Envío de Traslado', 'Responsable de Envío', 'Placa',
  'Observación', 'Estado'];

/** Normaliza el tipo de empaque a las categorías oficiales. */
function clasificarTipo(valor) {
  const v = normalizarCabecera(valor);
  if (!v) return '';
  if (v.includes('caja')) return 'CAJA';
  if (v.includes('panal')) return 'PAÑALES';
  if (v.includes('nevera') || v.includes('cadena de frio') || v.includes('refriger')) return 'NEVERA';
  if (v.includes('paquete')) return 'PAQUETE';
  return String(valor).toUpperCase();
}

/** Solo la fecha (sin hora) de un texto de fecha. */
function soloFecha(texto) {
  const d = aFecha(texto);
  if (!d) return String(texto || '');
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Arma las filas de la planilla a partir de los traslados filtrados. */
function filasPlanillaDespachos() {
  return trasladosFiltrados().map(t => ({
    'Fecha': soloFecha(t.fechaInicial),
    'Bodega Origen': t.origen,
    'Bodega Destino': t.destino,
    'Traslado': t.traslado,
    'Cantidad': obtenerValorPorNombreColumna(t.crudo, A.cantidad),
    'Tipo': clasificarTipo(obtenerValorPorNombreColumna(t.crudo, A.tipo)),
    'Ruta': t.zona,
    'Fecha de Envío de Traslado': t.fPlanilla || '',
    'Responsable de Envío': obtenerValorPorNombreColumna(t.crudo, A.conductor),
    'Placa': obtenerValorPorNombreColumna(t.crudo, ['PLACA', 'Placa']),
    'Observación': obtenerValorPorNombreColumna(t.crudo, A.observaciones),
    'Estado': t.estado + (esSi(t.urgente) ? ' / URGENTE' : '')
  }));
}

/** Descarga la planilla de despachos en XLSX. */
function descargarPlanillaDespachos() {
  const filas = filasPlanillaDespachos();
  if (!filas.length) { alert('No hay traslados en el filtro actual para generar la planilla.'); return; }

  const matriz = [
    ['OPERACIÓN CENDIS - LOGÍSTICA — PLANILLA DE DESPACHOS'],
    ['Generado: ' + new Date().toLocaleString('es-CO'), '', 'Registros: ' + filas.length],
    [],
    COLS_PLANILLA
  ];
  filas.forEach(f => matriz.push(COLS_PLANILLA.map(c => f[c])));

  const ws = XLSX.utils.aoa_to_sheet(matriz);
  ws['!cols'] = [{ wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 14 }, { wch: 10 }, { wch: 12 },
                 { wch: 14 }, { wch: 20 }, { wch: 22 }, { wch: 10 }, { wch: 34 }, { wch: 18 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'PLANILLA DESPACHOS');

  const d = new Date(), p = n => String(n).padStart(2, '0');
  XLSX.writeFile(wb, `Planilla_Despachos_CENDIS_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.xlsx`);
}

/** Genera la vista de impresión de la planilla de despachos. */
function imprimirPlanillaDespachos() {
  const filas = filasPlanillaDespachos();
  if (!filas.length) { alert('No hay traslados en el filtro actual para imprimir.'); return; }

  const encabezado = `
    <div style="text-align:center;margin-bottom:10px">
      <img src="assets/logo.jpeg" style="height:52px" alt="Medisfarma">
      <h3 style="margin:6px 0 0">OPERACIÓN CENDIS - LOGÍSTICA</h3>
      <div style="font-size:12px">Planilla de Despachos &middot; ${new Date().toLocaleString('es-CO')} &middot; ${filas.length} traslados</div>
    </div>`;

  const thead = '<thead><tr>' + COLS_PLANILLA.map(c => `<th>${esc(c)}</th>`).join('') + '</tr></thead>';
  const tbody = '<tbody>' + filas.map(f =>
    '<tr>' + COLS_PLANILLA.map(c => `<td>${esc(f[c])}</td>`).join('') + '</tr>').join('') + '</tbody>';

  $('areaPlanillaImpresion').innerHTML = encabezado + '<table>' + thead + tbody + '</table>' +
    '<p style="margin-top:18px;font-size:11px">Entrega CENDIS: ____________________ &nbsp;&nbsp; Recibe Logística: ____________________ &nbsp;&nbsp; Conductor: ____________________</p>';

  window.print();
}

/* ---------------------------------------------------------------------------
 * 8. INICIALIZACION
 * ------------------------------------------------------------------------- */
function pintarConfig() {
  $('v_api_url').value = CONFIG.apiUrl || '';
  ['despachos', 'logistica', 'recepcion', 'novedades', 'inventario', 'facturacion']
    .forEach(m => { $('v_folder_' + m).value = CONFIG.folders[m] || ''; });
  $('v_modo_local').checked = !!CONFIG.modoLocal;
  pintarPerfilesVisor();
}

/** Muestra los perfiles de archivos configurados en el modal del Visor. */
function pintarPerfilesVisor() {
  const perfiles = CONFIG.perfiles || {};
  const LABELS = {
    despachos: 'Despachos (BD_PLANILLA_ENTREGA_DESPACHOS)',
    logistica: 'Logística (BD_LOGISTICA_DESPACHOS)',
    recepcion: 'Recepción Técnica (BD_RECEPCION_TECNICA)',
    facturacion: 'Factura Transporte (BD_FACTURA_TRANSPORTE)',
    inventario: 'Inventario (BD_VERIFICACION_INVENTARIO)'
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
    if (cfgCargue.apiUrl && !CONFIG.apiUrl) CONFIG.apiUrl = cfgCargue.apiUrl;
    if (cfgCargue.folders) {
      Object.keys(cfgCargue.folders).forEach(k => {
        if (CONFIG.folders[k] !== undefined && !CONFIG.folders[k]) CONFIG.folders[k] = cfgCargue.folders[k];
      });
    }
  } catch (e) {}

  pintarConfig();

  $('v_guardar').addEventListener('click', () => {
    CONFIG.apiUrl = val('v_api_url');
    ['despachos', 'logistica', 'recepcion', 'novedades', 'inventario', 'facturacion']
      .forEach(m => { CONFIG.folders[m] = val('v_folder_' + m); });
    CONFIG.modoLocal = $('v_modo_local').checked;
    localStorage.setItem(LS_KEY_VISOR, JSON.stringify(CONFIG));
    cargarDatos();
  });

  $('btnRefrescar').addEventListener('click', cargarDatos);
  $('btnExportar').addEventListener('click', exportarConsolidado);
  $('btnPlanillaDespachos').addEventListener('click', descargarPlanillaDespachos);
  $('btnPlanillaImprimir').addEventListener('click', imprimirPlanillaDespachos);
  $('btnAplicar').addEventListener('click', refrescarTodo);
  $('btnLimpiarFiltros').addEventListener('click', () => {
    ['f_desde', 'f_hasta', 'f_origen', 'f_destino', 'f_zona', 'f_estado', 'f_urgente',
     'f_bodega_inv', 'f_solo_dif', 'buscar_s1', 'buscar_s2', 'buscar_s3', 'buscar_s4', 'buscar_traslado_5']
      .forEach(id => { if ($(id)) $(id).value = ''; });
    refrescarTodo();
  });

  ['buscar_s1', 'buscar_s2', 'buscar_s3', 'buscar_s4', 'buscar_traslado_5', 'f_bodega_inv', 'f_solo_dif']
    .forEach(id => $(id).addEventListener('input', refrescarTodo));
  ['f_desde', 'f_hasta', 'f_origen', 'f_destino', 'f_zona', 'f_estado', 'f_urgente']
    .forEach(id => $(id).addEventListener('change', refrescarTodo));

  cargarDatos();

  // Actualizacion automatica cada 5 minutos cuando hay conexion a Drive.
  setInterval(() => { if (!CONFIG.modoLocal && CONFIG.apiUrl) cargarDatos(); }, 300000);
});

