/** Geometry and project validation for the independent Mapra 2D preview. */
const SCALE = 10; // Provisional editor units per cm, pending measurements from Mapra.
const MIN_WIDTH_CM = 0.5;
const MAX_ART_BYTES = 5 * 1024 * 1024;
const MAX_PROJECT_BYTES = 20 * 1024 * 1024;
const MAX_LAYERS = 20;
const EPSILON = 0.00001;
const PROVISIONAL_NOTE = 'Medidas e áreas de aplicação provisórias. A Mapra deve conferir a peça, a escala e os limites antes da produção.';
const MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const BACKGROUND_MODES = ['all', 'outer', 'keep']; // tirar fundo e miolos / só o de fora / manter como enviado
// Logo de uma cor só, só na prévia: chave -> [nome (no feminino, combina com "toda ..."), cor]. A Mapra confirma a cor da tinta.
export const TINT_COLORS = {
  white: ['Branca', '#ffffff'], black: ['Preta', '#111111'], amarelo: ['Amarela', '#ffd400'], dourado: ['Dourada', '#c9a227'],
  laranja: ['Laranja', '#f47a1f'], vermelho: ['Vermelha', '#d21f26'], verde: ['Verde', '#0a8f3c'], azul: ['Azul', '#1f4fc2'],
  marinho: ['Azul-marinho', '#1b2a4e'], cinza: ['Cinza', '#8a8d91'],
};
const TINTS = ['original', ...Object.keys(TINT_COLORS)]; // cores da logo, ou toda de uma cor
const TEXT_LIMITS = { id: 80, slug: 160, name: 180, fabric: 120, color: 80, customer: 160, technique: 100, notes: 2000, filename: 180, calibration: 500 };

function zone(id, label, view, x, y, width, height) {
  return Object.freeze({ id, label, view, x, y, width, height, cmWidth: width / SCALE, cmHeight: height / SCALE });
}

// Left/right refer to the wearer. On the front, the wearer's left is viewer-right.
export const ZONES = Object.freeze([
  zone('peito-esquerdo', 'Peito esquerdo', 'front', 565, 300, 140, 160),
  zone('peito-direito', 'Peito direito', 'front', 300, 300, 140, 160),
  zone('peito-centro', 'Peito central', 'front', 330, 295, 340, 370),
  // Mangas: 14 cm ao longo da barra por 12 cm do ombro à barra, no meio da manga (medido na foto-base; provisório até conferir na peça real).
  zone('manga-esquerda', 'Manga esquerda', 'front', 790, 280, 140, 120),
  zone('manga-direita', 'Manga direita', 'front', 70, 280, 140, 120),
  zone('barra-frente', 'Barra da frente', 'front', 260, 750, 480, 125),
  zone('costas-centro', 'Costas', 'back', 330, 245, 340, 480),
  zone('barra-costas', 'Barra das costas', 'back', 260, 675, 480, 200),
]);

const ZONE_BY_ID = new Map(ZONES.map(item => [item.id, item]));
export const chestMode = project => project.chestMode === undefined ? (project.layers?.some(layer => layer.zoneId === 'peito-centro') ? 'central' : 'sides') : project.chestMode;
export function zoneActive(id, mode = 'sides') {
  if (id === 'peito-centro') return mode === 'central';
  if (id === 'peito-esquerdo' || id === 'peito-direito') return mode === 'sides';
  return true;
}
// O projeto conserva ambos os modos; só as aplicações ativas seguem para a ficha.
export const activeLayers = project => project.layers.filter(layer => zoneActive(layer.zoneId, chestMode(project)));
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const safeNumber = (value, fallback) => finite(value) ? value : fallback;
const cleanText = value => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() : value;

function checkedZone(value) {
  const selected = typeof value === 'string' ? ZONE_BY_ID.get(value) : value;
  if (!selected || !finite(selected.cmWidth) || !finite(selected.cmHeight) || selected.cmWidth <= 0 || selected.cmHeight <= 0) {
    throw new TypeError('Área de personalização inválida.');
  }
  return selected;
}

/**
 * xCm/yCm identify the unrotated art's top-left corner relative to its zone.
 * Rotation is around the art's center; both the art and its rotated bounds fit.
 * A fresh object is returned so callers can retain their previous project state.
 */
export function fitLayer(layer, selectedZone) {
  const region = checkedZone(selectedZone);
  if (!isObject(layer) || !isObject(layer.art) || !finite(layer.art.pixelWidth) || !finite(layer.art.pixelHeight) || layer.art.pixelWidth <= 0 || layer.art.pixelHeight <= 0) {
    throw new TypeError('As dimensões da imagem são inválidas.');
  }
  const ratio = layer.art.pixelWidth / layer.art.pixelHeight;
  const angle = clamp(safeNumber(layer.angle, 0), -30, 30);
  const radians = Math.abs(angle) * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const maxWidth = Math.min(
    region.cmWidth,
    region.cmHeight * ratio,
    region.cmWidth / (cosine + sine / ratio),
    region.cmHeight / (sine + cosine / ratio),
  );
  if (!Number.isFinite(maxWidth) || maxWidth + EPSILON < MIN_WIDTH_CM) {
    throw new RangeError('A proporção desta arte não cabe na região com a largura mínima de 0,5 cm. Escolha outra área ou outra imagem.');
  }
  const widthCm = clamp(safeNumber(layer.widthCm, MIN_WIDTH_CM), MIN_WIDTH_CM, maxWidth);
  const heightCm = widthCm / ratio;
  const boundsWidth = widthCm * cosine + heightCm * sine;
  const boundsHeight = widthCm * sine + heightCm * cosine;
  const minX = Math.max(0, (boundsWidth - widthCm) / 2);
  const maxX = Math.max(minX, Math.min(region.cmWidth - widthCm, region.cmWidth - (boundsWidth + widthCm) / 2));
  const minY = Math.max(0, (boundsHeight - heightCm) / 2);
  const maxY = Math.max(minY, Math.min(region.cmHeight - heightCm, region.cmHeight - (boundsHeight + heightCm) / 2));
  return {
    ...layer,
    zoneId: region.id,
    view: region.view,
    widthCm,
    heightCm,
    angle,
    xCm: clamp(safeNumber(layer.xCm, (region.cmWidth - widthCm) / 2), minX, maxX),
    yCm: clamp(safeNumber(layer.yCm, (region.cmHeight - heightCm) / 2), minY, maxY),
  };
}

export function moveLayer(layer, selectedZone, xCm, yCm) {
  return fitLayer({ ...layer, xCm, yCm }, selectedZone);
}

/** Invalid, negative and fractional entries never contribute to the total. */
export function quantityTotal(quantities) {
  if (!isObject(quantities)) return 0;
  return Object.values(quantities).reduce((sum, quantity) => Number.isSafeInteger(quantity) && quantity >= 0 ? sum + quantity : sum, 0);
}

function textError(errors, value, label, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    errors.push(`${label}: informe um texto${required ? ' não vazio' : ''} de até ${max} caracteres.`);
  }
}

function imageInfo(art) {
  if (!isObject(art) || !MIMES.has(art.mime) || typeof art.dataUrl !== 'string') return null;
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(art.dataUrl);
  if (!match || match[1] !== art.mime || match[2].length % 4 !== 0) return null;
  const encoded = match[2];
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const bytes = encoded.length / 4 * 3 - padding;
  let header;
  try { header = atob(encoded.slice(0, Math.min(24, encoded.length))); } catch { return null; }
  const signature = art.mime === 'image/png'
    ? header.startsWith('\x89PNG\r\n\x1a\n')
    : art.mime === 'image/jpeg'
      ? header.startsWith('\xff\xd8\xff')
      : header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP';
  return signature ? { bytes } : null;
}

function serializedSize(input) {
  try {
    const serialized = typeof input === 'string' ? input : JSON.stringify(input);
    return typeof serialized === 'string' ? new TextEncoder().encode(serialized).byteLength : Infinity;
  } catch { return Infinity; }
}

/** Returns Portuguese diagnostics. Drafts may omit quantities when requested. */
export function validateProject(project, options = { requireQuantity: true }) {
  const errors = [];
  if (!isObject(project)) return ['O projeto deve ser um objeto válido.'];
  if (serializedSize(project) > MAX_PROJECT_BYTES) errors.push('O projeto ultrapassa o limite de 20 MB ou possui uma estrutura inválida.');
  if (project.schemaVersion !== 1) errors.push('Versão do projeto inválida. Use um projeto do configurador Mapra 2D.');
  if (project.chestMode !== undefined && !['sides', 'central'].includes(project.chestMode)) errors.push('Escolha Peito central ou Esquerdo e direito.');
  textError(errors, project.id, 'Identificação do projeto', TEXT_LIMITS.id, true);
  if (typeof project.createdAt !== 'string' || project.createdAt.length > 40 || !Number.isFinite(Date.parse(project.createdAt))) errors.push('Data de criação do projeto inválida.');
  if (!isObject(project.product)) errors.push('Produto inválido.');
  else {
    textError(errors, project.product.slug, 'Código do produto', TEXT_LIMITS.slug, true);
    textError(errors, project.product.name, 'Nome do produto', TEXT_LIMITS.name, true);
    textError(errors, project.product.fabric, 'Tecido', TEXT_LIMITS.fabric, true);
  }
  if (!isObject(project.color)) errors.push('Cor inválida.');
  else {
    textError(errors, project.color.name, 'Nome da cor', TEXT_LIMITS.color, true);
    if (typeof project.color.hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(project.color.hex)) errors.push('A cor deve usar o formato hexadecimal #RRGGBB.');
  }
  if (!isObject(project.customer)) errors.push('Dados do cliente inválidos.');
  else {
    textError(errors, project.customer.name, 'Nome do cliente', TEXT_LIMITS.customer);
    textError(errors, project.customer.company, 'Empresa', TEXT_LIMITS.customer);
  }
  textError(errors, project.technique, 'Técnica', TEXT_LIMITS.technique);
  textError(errors, project.notes, 'Observações', TEXT_LIMITS.notes);
  if (!isObject(project.quantities)) errors.push('A grade de tamanhos deve ser um objeto.');
  else {
    const entries = Object.entries(project.quantities);
    if (entries.length > 100) errors.push('A grade ultrapassa 100 combinações de tamanho e modelagem.');
    for (const [label, value] of entries) {
      if (!label.trim() || label.length > 80 || ['__proto__', 'constructor', 'prototype'].includes(label)) errors.push('A grade possui uma identificação de tamanho inválida.');
      if (!Number.isSafeInteger(value) || value < 0 || value > 100000) errors.push(`Quantidade inválida para ${label.slice(0, 80)}. Use um número inteiro de 0 a 100.000.`);
    }
  }
  if (options?.requireQuantity !== false && quantityTotal(project.quantities) < 1) errors.push('Informe pelo menos uma peça na grade de tamanhos.');
  if (!isObject(project.calibration) || project.calibration.verified !== false || typeof project.calibration.note !== 'string' || !project.calibration.note.trim() || project.calibration.note.length > TEXT_LIMITS.calibration) {
    errors.push('Inclua a indicação de calibração provisória, pendente de conferência pela Mapra.');
  }
  if (!Array.isArray(project.layers)) errors.push('As aplicações devem ser uma lista.');
  else {
    if (project.layers.length > MAX_LAYERS) errors.push('O projeto aceita no máximo 20 aplicações.');
    const ids = new Set();
    const occupied = new Set();
    project.layers.forEach((layer, index) => {
      const label = `Aplicação ${index + 1}`;
      if (!isObject(layer)) { errors.push(`${label}: estrutura inválida.`); return; }
      textError(errors, layer.id, `${label}, identificação`, TEXT_LIMITS.id, true);
      if (ids.has(layer.id)) errors.push(`${label}: identificação duplicada.`);
      ids.add(layer.id);
      if (occupied.has(layer.zoneId)) errors.push(`${label}: lugar já ocupado. Use uma arte por lugar.`);
      occupied.add(layer.zoneId);
      const region = ZONE_BY_ID.get(layer.zoneId);
      if (!region) errors.push(`${label}: área desconhecida.`);
      if (!region || layer.view !== region.view) errors.push(`${label}: vista incompatível com a área.`);
      if (!isObject(layer.art)) { errors.push(`${label}: arquivo da arte inválido.`); return; }
      textError(errors, layer.art.name, `${label}, arquivo`, TEXT_LIMITS.filename, true);
      const info = imageInfo(layer.art);
      if (!info) errors.push(`${label}: use um arquivo PNG, JPEG ou WebP válido, incorporado como imagem base64.`);
      else if (info.bytes > MAX_ART_BYTES) errors.push(`${label}: a arte ultrapassa o limite de 5 MB.`);
      if (![layer.art.pixelWidth, layer.art.pixelHeight].every(value => Number.isInteger(value) && value > 0 && value <= 30000)) errors.push(`${label}: dimensões em pixels inválidas.`);
      if (!['xCm', 'yCm', 'widthCm', 'heightCm', 'angle'].every(key => finite(layer[key]))) errors.push(`${label}: posição, medidas ou giro inválidos.`);
      if (region) {
        try {
          const fitted = fitLayer(layer, region);
          if (['xCm', 'yCm', 'widthCm', 'heightCm', 'angle'].some(key => !finite(layer[key]) || Math.abs(layer[key] - fitted[key]) > EPSILON)) {
            errors.push(`${label}: a arte deve preservar sua proporção e permanecer dentro da área, com giro de -30° a 30° e largura mínima de 0,5 cm.`);
          }
        } catch (error) { errors.push(`${label}: ${error.message}`); }
      }
    });
  }
  return errors;
}

/** Accepts saved JSON or a plain project, dropping unknown fields on import. */
export function importProject(input) {
  if (serializedSize(input) > MAX_PROJECT_BYTES) throw new Error('O arquivo do projeto ultrapassa 20 MB ou tem uma estrutura inválida.');
  let project;
  try { project = typeof input === 'string' ? JSON.parse(input) : input; } catch { throw new Error('O arquivo não contém um projeto JSON válido.'); }
  if (!isObject(project) || !isObject(project.product) || !isObject(project.color) || !isObject(project.customer) || !isObject(project.quantities) || !Array.isArray(project.layers) || !isObject(project.calibration)) {
    throw new Error('A estrutura do projeto é inválida. Escolha um arquivo salvo pelo configurador Mapra.');
  }
  const quantityEntries = Object.entries(project.quantities).map(([key, value]) => [cleanText(key), value]);
  if (new Set(quantityEntries.map(([key]) => key)).size !== quantityEntries.length) throw new Error('A grade possui identificações de tamanho duplicadas.');
  const imported = {
    schemaVersion: project.schemaVersion,
    id: cleanText(project.id),
    createdAt: cleanText(project.createdAt),
    product: { slug: cleanText(project.product.slug), name: cleanText(project.product.name), fabric: cleanText(project.product.fabric) },
    color: { name: cleanText(project.color.name), hex: cleanText(project.color.hex) },
    customer: { name: cleanText(project.customer.name), company: cleanText(project.customer.company) },
    technique: cleanText(project.technique),
    notes: cleanText(project.notes),
    quantities: Object.fromEntries(quantityEntries),
    chestMode: chestMode(project),
    layers: project.layers.map(layer => {
      if (!isObject(layer) || !isObject(layer.art)) throw new Error('Uma aplicação tem estrutura inválida.');
      // projetos antigos só tinham "removeBackground": falso vira "manter como enviei"
      const backgroundMode = BACKGROUND_MODES.includes(layer.backgroundMode) ? layer.backgroundMode : (layer.removeBackground === false ? 'keep' : 'all');
      return {
        id: cleanText(layer.id), zoneId: cleanText(layer.zoneId), view: cleanText(layer.view),
        xCm: layer.xCm, yCm: layer.yCm, widthCm: layer.widthCm, heightCm: layer.heightCm, angle: layer.angle,
        removeBackground: backgroundMode !== 'keep', backgroundMode,
        tint: TINTS.includes(layer.tint) ? layer.tint : 'original',
        art: { name: cleanText(layer.art.name), mime: layer.art.mime, dataUrl: layer.art.dataUrl, pixelWidth: layer.art.pixelWidth, pixelHeight: layer.art.pixelHeight },
      };
    }),
    calibration: { verified: false, note: PROVISIONAL_NOTE },
  };
  const errors = validateProject(imported, { requireQuantity: false });
  if (errors.length) throw new Error(errors.join('\n'));
  return imported;
}
