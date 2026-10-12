import { ZONES, TINT_COLORS, fitLayer, moveLayer, quantityTotal, validateProject, importProject, activeLayers, chestMode } from './core.mjs';
import { removeSolidBackground, tintArt } from './fundo.mjs';
import { desenhaFicha, guardaFicha } from './ficha.mjs';
import { isSleeve, viewFor, displayZone, visibleZones, geometry as layerGeometry, dyeMatrix, fabricAngle, viewBoxFor } from './presentation.mjs';

const $ = (id) => document.getElementById(id);
const asset = (path) => new URL(path, import.meta.url).href; // arquivos do personalizador, onde quer que a página esteja
const NS = 'http://www.w3.org/2000/svg';
const STORAGE = 'mapra-personalizacao-2d-v1';
const MAX_ART = 5 * 1024 * 1024; // limite da arte já pronta no pedido
const MAX_PICK = 40 * 1024 * 1024; // limite do arquivo que a pessoa escolhe (fotos do celular são grandes; entram reduzidas)
const SOFT_BYTES = 2 * 1024 * 1024; // acima disso a arte é reduzida
const REDUCE_SIDE = 2400; // e nunca passa deste tamanho (pixels no lado maior)
const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
const calibrationNote = 'Medidas e áreas provisórias do teste, sem calibração na peça real. Conferir com a Mapra antes de produzir.';
const svg = $('garment');
const catalog = await fetch(asset('catalogo.json')).then((response) => {
  if (!response.ok) throw new Error('Não foi possível carregar os dados do catálogo.');
  return response.json();
});
let project = {
  schemaVersion: 1, id: 'MP-TESTE-' + Date.now().toString(36).toUpperCase(),
  createdAt: new Date().toISOString(),
  product: { slug: catalog.slug, name: catalog.nome, fabric: 'Malha PV (poliéster/viscose)' },
  color: { name: 'Azul Marinho', hex: '#1b2a4e' },
  customer: { name: '', company: '' }, technique: 'A confirmar', notes: '',
  quantities: {}, layers: [], chestMode: 'sides', calibration: { verified: false, note: calibrationNote },
};
let view = 'front';
let zoneId = 'peito-esquerdo';
let selectedId = null;
let sleeveSide = 'manga-esquerda';
let adjustingId = null;
let uploadZone = null;
const controls = $('layer-controls');
const analysis = new Map(); // arte -> { removable, transparent, reason }: o que dá para fazer com ela
const variants = new Map(); // arte|fundo|cor -> imagem pronta para a prévia
let modelagem = catalog.modelagens[0].nome;
let drag = null;
let autosaveTimer;
let storageWarning = false;
const baseData = {};
const activeLayer = () => project.layers.find((layer) => layer.id === selectedId);
const zoneById = (id) => ZONES.find((zone) => zone.id === id);

// Aviso flutuante: sempre à vista, na tela que a pessoa está olhando (no celular a página é longa; um aviso no fim da página passava despercebido).
let toastTimer;
function status(message, error = false) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 8000 : 3500);
}
// crypto.randomUUID só existe em páginas com cadeado (https); no teste pelo celular na rede o endereço é http.
const newId = () => (globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
function svgNode(name, attributes = {}) {
  const element = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}
function button(text, className = '') {
  const element = document.createElement('button');
  element.type = 'button'; element.textContent = text; element.className = className;
  return element;
}
function snapshot() { return structuredClone(project); }
function changed() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(project));
    } catch {
      if (!storageWarning) {
        storageWarning = true;
        status('O armazenamento do navegador está cheio. Use Salvar projeto para guardar as artes e continuar depois.', true);
      }
    }
  }, 350);
}
function round(value) { return Math.round(value * 10) / 10; }
// Regra da Mapra: cada peça que entra no pedido precisa ter pelo menos MIN_PIECES unidades (o número vem do site).
const MIN_PIECES = Number(document.querySelector('[data-minimo]')?.dataset.minimo) || 10;
const missingText = (total) => 'O mínimo é de ' + MIN_PIECES + ' peças desta camiseta. Você escolheu ' + total + ': ' + (MIN_PIECES - total === 1 ? 'falta 1.' : 'faltam ' + (MIN_PIECES - total) + '.');
function updateTotal() {
  const total = quantityTotal(project.quantities);
  $('quantity-total').textContent = total;
  const entries = Object.keys(project.quantities).filter((key) => project.quantities[key] > 0);
  const models = [...new Set(entries.map((key) => key.slice(0, key.lastIndexOf(' '))))];
  const below = total > 0 && total < MIN_PIECES;
  $('size-warning').classList.toggle('falta', below);
  document.querySelector('.quantity-summary').classList.toggle('abaixo', below);
  $('size-warning').textContent = total === 0
    ? 'Diga quantas peças de cada tamanho. O mínimo é de ' + MIN_PIECES + ' peças desta camiseta.'
    : below ? missingText(total)
    : (models.length > 1 ? 'Total reúne ' + models.join(', ') + '. ' : '')
      + 'As dimensões da arte são iguais em todos os tamanhos; confira o encaixe no menor tamanho com a Mapra.';
}

const measurementOverlay = svgNode('g', { id: 'measurement-overlay', 'pointer-events': 'none', 'aria-hidden': 'true' });
svg.append(measurementOverlay);

function cm(value) { return round(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 }); }
// No zoom da manga a janela é menor; tudo o que é desenhado "por cima" (rótulos, réguas, alças) encolhe na mesma proporção para ficar do mesmo tamanho na tela.
const uiScaleFor = (whichView, side) => viewBoxFor(whichView, side).w / 1000;
const pxUnit = () => 1 / (svg.getScreenCTM()?.a || 1); // unidades da foto em cada pixel da tela
const uiScale = () => uiScaleFor(view, sleeveSide);
// Desenha a medida de cada arte (e a régua da selecionada). `options` serve às imagens da conferência: vista própria e número de cada arte.
function paintMeasurements(container, layers, selected = null, options = {}) {
  container.replaceChildren();
  const v = options.view ?? view, side = options.side ?? sleeveSide, numbers = options.numbers;
  const s = options.scale ?? uiScaleFor(v, side), box = viewBoxFor(v, side);
  const placed = [];
  for (const layer of layers) {
    const { x, y, w, h, angle } = layerGeometry(layer, v, side);
    const radians = Math.abs(angle) * Math.PI / 180;
    const top = y + h / 2 - (w * Math.sin(radians) + h * Math.cos(radians)) / 2;
    const number = numbers?.get(layer.id);
    const caption = (number ? number + ' · ' : '') + cm(layer.widthCm) + (number ? '×' : ' × ') + cm(layer.heightCm) + ' cm';
    const badgeWidth = caption.length * 12 + 24;
    const bx = Math.max(box.x + 6 * s, Math.min(box.x + box.w - badgeWidth * s - 6 * s, x + w / 2 - badgeWidth * s / 2));
    let by = Math.max(box.y + 6 * s, top - 42 * s);
    // com várias artes juntas, o rótulo desce para não ficar por cima de outro
    for (let tries = 0; tries < 8 && placed.some((o) => bx < o.x + o.w && bx + badgeWidth * s > o.x && by < o.y + o.h && by + 32 * s > o.y); tries += 1) by += 36 * s;
    placed.push({ x: bx, y: by, w: badgeWidth * s, h: 32 * s });
    const badge = svgNode('g', { transform: 'translate(' + bx + ' ' + by + ') scale(' + s + ')' });
    badge.append(svgNode('rect', { width: badgeWidth, height: 32, rx: 5, fill: layer.id === selected ? '#ffe600' : '#ffffff', stroke: '#17181a', 'stroke-width': 1, 'fill-opacity': '.96' }));
    const text = svgNode('text', { x: badgeWidth / 2, y: 23, 'text-anchor': 'middle', 'font-size': 22, 'font-family': 'DM Mono,Consolas,monospace', fill: '#17181a' });
    text.textContent = caption; badge.append(text); container.append(badge);
  }
}
const artNumbers = (current) => new Map(activeLayers(current).map((layer, index) => [layer.id, index + 1]));

let shownHex = null;
let tweenFrame = 0;
let tweenGuard = 0;
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgbToHex = (channels) => '#' + channels.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
function paintDye(hex) { $('dye-matrix').setAttribute('values', dyeMatrix(hex)); shownHex = hex; }
// A cor da camiseta muda aos poucos (cerca de 0,26 s), como o tecido sendo tingido; sem movimento se o aparelho pedir.
function tweenDye(toHex) {
  if (shownHex === toHex) return;
  cancelAnimationFrame(tweenFrame); clearTimeout(tweenGuard);
  if (!shownHex || matchMedia('(prefers-reduced-motion: reduce)').matches) { paintDye(toHex); return; }
  const from = hexToRgb(shownHex), to = hexToRgb(toHex), start = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - start) / 260), eased = 1 - Math.pow(1 - k, 3);
    paintDye(k < 1 ? rgbToHex(from.map((v, i) => v + (to[i] - v) * eased)) : toHex);
    if (k < 1) tweenFrame = requestAnimationFrame(step);
  };
  tweenFrame = requestAnimationFrame(step);
  // garantia: se o navegador pausar a animação (aba escondida), a cor final entra mesmo assim
  clearTimeout(tweenGuard); tweenGuard = setTimeout(() => { cancelAnimationFrame(tweenFrame); paintDye(toHex); }, 420);
}
function renderColor() {
  tweenDye(project.color.hex);
  $('color-name').textContent = project.color.name;
  for (const item of $('color-swatches').children) {
    item.setAttribute('aria-pressed', String(item.dataset.hex.toLowerCase() === project.color.hex.toLowerCase()));
  }
}
function baseKey(whichView = view) { return whichView === 'sleeve' ? 'front' : whichView; }
function basePath(whichView = view) { return asset('img/' + ({ front: 'frente', back: 'costas', sleeve: 'frente' }[whichView]) + '.webp'); }
function applyBase(element, whichView, data = false, side = sleeveSide) {
  const source = data ? baseData[baseKey(whichView)] : basePath(whichView);
  element.querySelector('#shirt-base').setAttribute('href', source);
  element.querySelector('#fabric-light').setAttribute('href', source);
  // zoom da manga: a mesma foto, só uma janela menor (nada é recortado)
  const box = viewBoxFor(whichView, side);
  element.setAttribute('viewBox', [box.x, box.y, box.w, box.h].join(' '));
}
let shownView = null;
function renderView() {
  applyBase(svg, view);
  if (shownView !== null && shownView !== view) { svg.classList.remove('entra'); void svg.getBoundingClientRect(); svg.classList.add('entra'); }
  shownView = view;
  $('view-label').textContent = view === 'front' ? 'Frente' : view === 'back' ? 'Costas' : zoneById(sleeveSide).label;
  $('sleeve-side').hidden = view !== 'sleeve';
  $('subbar-hint').hidden = view !== 'back';
  $('sleeve-side').textContent = zoneById(sleeveSide).label + ' · trocar';
  for (const item of $('view-buttons').querySelectorAll('button')) item.setAttribute('aria-pressed', String(item.dataset.view === view));
  renderChest();
}
function renderChest() {
  $('chest-selector').hidden = view !== 'front';
  for (const item of $('chest-buttons').querySelectorAll('button')) item.setAttribute('aria-pressed', String(item.dataset.chest === chestMode(project)));
  const stored = project.layers.length - activeLayers(project).length;
  $('chest-note').textContent = stored
    ? 'As artes do outro modo ficam guardadas. Só a opção escolhida aparece na camiseta e na ficha.'
    : 'Escolha uma estampa central ou duas artes separadas.';
}
function chooseChest(mode) {
  if (!['central', 'sides'].includes(mode)) return;
  project.chestMode = mode; selectedId = null; adjustingId = null;
  view = 'front'; zoneId = mode === 'central' ? 'peito-centro' : 'peito-esquerdo';
  renderStage(); renderLayerList(); renderLayerFields(); changed();
}
function renderZones() {
  $('zone-overlay').replaceChildren();
  for (const zone of visibleZones(view, sleeveSide, chestMode(project))) {
    if (project.layers.some(layer => layer.zoneId === zone.id)) continue;
    const area = displayZone(zone, view, sleeveSide);
    const group = svgNode('g', { 'data-zone-id': area.id, class: 'print-zone', tabindex: 0, role: 'button', 'aria-label': 'Adicionar arte em ' + area.label });
    const cx = area.x + area.width / 2, cy = area.y + area.height / 2;
    group.append(svgNode('rect', { class: 'zone-box', x: area.x, y: area.y, width: area.width, height: area.height, rx: 10,
      transform: 'rotate(' + fabricAngle(area.id, view) + ' ' + cx + ' ' + cy + ')' }));
    const us = pxUnit() * 0.5;
    const marker = svgNode('g', { transform: 'translate(' + cx + ' ' + cy + ') scale(' + us + ')' });
    marker.append(
      svgNode('circle', { class: 'zone-hit', r: 56, fill: 'transparent' }),
      svgNode('circle', { class: 'zone-ring', r: 30, fill: 'none' }),
      svgNode('circle', { class: 'zone-disc', r: 30 }),
      svgNode('path', { class: 'zone-plus', d: 'M-11 0H11M0 -11V11' }),
    );
    const words = area.label.split(' '), lines = words.length > 1 ? [words[0], words.slice(1).join(' ')] : words;
    const size = 22 * us, half = Math.max(...lines.map((line) => line.length)) * size * 0.34 + 4 * us, box = viewBoxFor(view, sleeveSide);
    const lx = Math.min(box.x + box.w - half, Math.max(box.x + half, cx));
    const label = svgNode('text', { class: 'zone-label', x: lx, y: cy + 62 * us, 'text-anchor': 'middle' });
    label.style.fontSize = size + 'px'; label.style.strokeWidth = (6 * us) + 'px';
    lines.forEach((line, index) => { const part = svgNode('tspan', { x: lx, dy: index ? size * 1.08 : 0 }); part.textContent = line; label.append(part); });
    group.append(marker, label);
    group.addEventListener('click', () => { if (!justPanned) requestArt(area.id); });
    group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); requestArt(area.id); } });
    $('zone-overlay').append(group);
  }
}
let justPanned = false;
function requestArt(id) { uploadZone = id; zoneId = id; focusZone(id); $('art-file').click(); }
function geometry(layer) { return layerGeometry(layer, view, sleeveSide); }
function previewSource(layer) {
  return variants.get(variantKey(layer.art.dataUrl, modeOf(layer), tintOf(layer))) || layer.art.dataUrl;
}
function visibleLayers(current = project, whichView = view, side = sleeveSide) {
  const ids = new Set(visibleZones(whichView, side, chestMode(current)).map(z => z.id));
  return activeLayers(current).filter(layer => ids.has(layer.zoneId));
}
function appendArt(container, layer, whichView = view, side = sleeveSide, interactive = true) {
  const { x, y, w, h, angle } = layerGeometry(layer, whichView, side);
  const group = svgNode('g', { transform: 'translate(' + x + ' ' + y + ') rotate(' + angle + ' ' + w / 2 + ' ' + h / 2 + ')',
    'data-layer-id': layer.id, ...(interactive ? { tabindex: 0, role: 'button', class: 'art-layer', 'aria-label': layer.art.name + ', ' + zoneById(layer.zoneId).label } : {}) });
  group.append(svgNode('image', { href: previewSource(layer), width: w, height: h, preserveAspectRatio: 'xMidYMid meet', ...(layer.id === popId ? { class: 'art-nova' } : {}) }));
  container.append(group);
  return { x, y, w, h, angle };
}
function renderLayers() {
  $('art-layers').replaceChildren(); $('selection-overlay').replaceChildren();
  for (const layer of visibleLayers()) {
    const { x, y, w, h, angle } = appendArt($('art-layers'), layer);
    if (layer.id !== adjustingId) continue;
    const selection = svgNode('g', { transform: 'translate(' + x + ' ' + y + ') rotate(' + angle + ' ' + w / 2 + ' ' + h / 2 + ')', 'data-layer-id': layer.id });
    const px = pxUnit(), touch = matchMedia('(pointer: coarse)').matches;
    selection.append(svgNode('rect', { class: 'selection-box', width: w, height: h, fill: 'none', 'vector-effect': 'non-scaling-stroke' }));
    // quatro alças, uma em cada canto: arrastar para fora aumenta, para dentro diminui, sempre mantendo a proporção
    for (const [corner, hx, hy] of [['nw', 0, 0], ['ne', w, 0], ['sw', 0, h], ['se', w, h]]) {
      selection.append(svgNode('circle', { class: 'handle-hit', cx: hx, cy: hy, r: (touch ? 26 : 20) * px, fill: 'transparent', 'data-handle': corner }));
      selection.append(svgNode('circle', { class: 'handle', cx: hx, cy: hy, r: (touch ? 7 : 5.5) * px, 'stroke-width': (touch ? 2 : 1.5) * px, 'data-handle': corner }));
    }
    $('selection-overlay').append(selection);
  }
  paintMeasurements(measurementOverlay, visibleLayers().filter(layer => layer.id === adjustingId), selectedId, { scale: pxUnit() * 0.6 });
}
function removeLayer(id) {
  project.layers = project.layers.filter(layer => layer.id !== id);
  if (selectedId === id) selectedId = null;
  if (adjustingId === id) adjustingId = null;
  renderZones(); renderLayers(); renderLayerList(); renderLayerFields(); changed(); status('Aplicação removida.');
  renderChest();
  // O cartão da arte some e a página encolhe: sem isto a tela ia parar lá embaixo, nos tamanhos.
  // Volta a camiseta inteira e deixa a etapa 2 ("Ponha as suas artes") à vista, logo abaixo da foto.
  setZoom(1);
  const step = document.querySelector('[data-step="2"]'), top = step ? step.getBoundingClientRect().top : 0;
  if (step && (top < stickyBottom() - 1 || top > innerHeight * 0.6)) scrollToSection(2);
}
function renderLayerList() {
  const keepScroll = scrollY;
  renderLayerListNow();
  if (Math.abs(scrollY - keepScroll) > 1) scrollTo({ top: keepScroll, behavior: 'instant' });
}
function renderLayerListNow() {
  $('layer-list').replaceChildren();
  for (const layer of activeLayers(project)) {
    const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'art-chip'; chip.dataset.layer = layer.id;
    chip.setAttribute('aria-pressed', String(adjustingId === layer.id));
    const image = document.createElement('img'); image.src = previewSource(layer); image.alt = '';
    const name = document.createElement('span'); name.textContent = zoneById(layer.zoneId).label;
    chip.append(image, name);
    chip.addEventListener('click', () => selectLayer(layer.id));
    $('layer-list').append(chip);
  }
  renderArtMenu();
}

/* ---------- menu da arte: abre sobre a foto ao tocar na estampa ---------- */
const artMenu = $('art-menu');
let measuresOpen = false;
const menuLayer = () => project.layers.find((entry) => entry.id === adjustingId && visibleLayers().includes(entry));
function lookGroup(title, entries, current, enabled, onPick, hint) {
  const group = document.createElement('div'); group.className = 'look-group' + (enabled ? '' : ' desligado');
  const label = document.createElement('p'); label.className = 'look-title'; label.textContent = title; if (hint) label.title = hint;
  const row = document.createElement('div'); row.className = 'look-row'; row.setAttribute('role', 'group'); row.setAttribute('aria-label', title);
  for (const [value, text, thumb] of entries) {
    const option = document.createElement('button'); option.type = 'button'; option.className = 'look'; option.disabled = !enabled;
    option.setAttribute('aria-pressed', String(enabled && value === current)); option.title = text;
    const frame = document.createElement('span'); frame.className = 'look-img ' + (thumb.fundo || ''); const image = document.createElement('img'); image.alt = ''; image.src = thumb.src; frame.append(image);
    const name = document.createElement('span'); name.className = 'look-name'; name.textContent = text;
    option.append(frame, name);
    if (enabled) option.addEventListener('click', () => { if (value !== current) onPick(value); });
    row.append(option);
  }
  group.append(label, row);
  return group;
}
// O cartão da arte fica dentro da etapa 2 (logo abaixo da camiseta fixa, no celular). Se a pessoa toca numa logo da camiseta estando
// em outra etapa, a página rola até o cartão; se ele já está à vista, não mexe em nada.
function revealArtMenu() {
  if (artMenu.hidden) return;
  const box = artMenu.getBoundingClientRect(), top = stickyBottom() + 8;
  if (box.top >= top && box.top < innerHeight * 0.6) return;
  scrollTo({ top: Math.max(0, scrollY + box.top - top), behavior: calmScroll() });
}
function renderArtMenu() {
  const layer = menuLayer();
  artMenu.hidden = !layer;
  if (!layer) return;
  const url = layer.art.dataUrl, look = analysis.get(url) || {}, mode = modeOf(layer), tint = tintOf(layer);
  $('art-menu-title').textContent = zoneById(layer.zoneId).label;
  $('art-menu-size').textContent = cm(layer.widthCm) + ' × ' + cm(layer.heightCm) + ' cm';
  $('art-menu-file').textContent = layer.art.name;
  $('art-menu-thumb').src = previewSource(layer);
  $('art-menu-panel').hidden = !measuresOpen; $('art-menu-measures').setAttribute('aria-expanded', String(measuresOpen));
  const colorMode = mode === 'keep' ? 'all' : mode;
  const src = (m, t) => variants.get(variantKey(url, m, t)) || url;
  const wanted = look.removable ? [['all', 'original'], ['outer', 'original'], ['keep', 'original']] : [];
  const missing = wanted.filter(([m, t]) => !variants.has(variantKey(url, m, t)));
  if (missing.length) { Promise.all(missing.map(([m, t]) => preparePreview(url, null, m, t))).then(() => { if (menuLayer()?.id === layer.id) renderArtMenu(); }).catch(() => {}); }
  $('art-menu-looks').replaceChildren();
  if (look.removable) {
    $('art-menu-looks').append(lookGroup('Fundo', [
      ['all', 'Sem fundo', { src: src('all', 'original'), fundo: 'xadrez' }],
      ['outer', 'Só de fora', { src: src('outer', 'original'), fundo: 'xadrez' }],
      ['keep', 'Como enviei', { src: src('keep', 'original') }],
    ], mode, true, (value) => chooseArtLook(layer, { backgroundMode: value, ...(value === 'keep' ? { tint: 'original' } : {}) }), 'Tira o fundo da logo só para ver. O arquivo original vai junto no pedido.'));
  }
  if (look.removable || look.transparent) {
    const enabled = (look.removable && mode !== 'keep') || look.transparent;
    $('art-menu-looks').append(tintGroup(layer, tint, enabled));
  }
  const note = $('art-menu-note');
  note.hidden = look.removable || look.transparent;
  if (!note.hidden) note.textContent = 'O fundo não é liso. Para ficar certo, mande PNG sem fundo.';
}
// Cor da logo: as cores dela mesma ou toda de uma cor só (só na prévia; a Mapra confirma a cor da tinta).
function tintGroup(layer, current, enabled) {
  const group = document.createElement('div'); group.className = 'look-group' + (enabled ? '' : ' desligado');
  const label = document.createElement('p'); label.className = 'look-title';
  label.textContent = 'Cor da logo' + (current === 'original' ? '' : ': toda ' + TINT_COLORS[current][0].toLowerCase());
  label.title = enabled ? 'Pinta a logo de uma cor só, para ver como fica.' : 'Tire o fundo para usar uma cor só.';
  const row = document.createElement('div'); row.className = 'tint-row'; row.setAttribute('role', 'group'); row.setAttribute('aria-label', 'Cor da logo');
  const add = (value, name, hex) => {
    const option = document.createElement('button'); option.type = 'button'; option.className = 'tint' + (hex ? '' : ' original'); option.disabled = !enabled;
    option.setAttribute('aria-pressed', String(enabled && value === current));
    option.title = hex ? 'Toda ' + name.toLowerCase() : 'As cores da própria logo';
    option.setAttribute('aria-label', option.title);
    if (hex) { const dot = document.createElement('i'); dot.style.setProperty('--c', hex); option.append(dot); } else option.textContent = name;
    if (enabled) option.addEventListener('click', () => { if (value !== current) chooseArtLook(layer, { tint: value }); });
    row.append(option);
  };
  add('original', 'Original');
  for (const [key, [name, hex]] of Object.entries(TINT_COLORS)) add(key, name, hex);
  group.append(label, row);
  return group;
}
function closeArtMenu() {
  selectedId = null; adjustingId = null; measuresOpen = false;
  setZoom(1);
  renderLayers(); renderLayerList(); renderLayerFields();
}
$('art-menu-close').addEventListener('click', closeArtMenu);
// Um toque em − ou + muda o tamanho da arte (10% por vez, em volta do centro dela); segurando, repete. Funciona sem precisar mirar nas alças.
function resizeActive(factor) {
  const layer = activeLayer(); if (!layer) return;
  const area = zoneById(layer.zoneId);
  try {
    const resized = fitLayer({ ...layer, widthCm: Math.max(1, layer.widthCm * factor) }, area);
    const next = moveLayer(resized, area, layer.xCm + (layer.widthCm - resized.widthCm) / 2, layer.yCm + (layer.heightCm - resized.heightCm) / 2);
    project.layers = project.layers.map((entry) => entry.id === layer.id ? next : entry);
    renderLayers(); renderLayerFields(); changed();
  } catch (error) { status(error.message, true); }
}
function holdToRepeat(button, action) {
  let wait = 0, repeat = 0;
  const stop = () => { clearTimeout(wait); clearInterval(repeat); };
  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault(); action(); stop();
    wait = setTimeout(() => { repeat = setInterval(action, 90); }, 380);
  });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) button.addEventListener(type, stop);
  button.addEventListener('click', (event) => { if (event.detail === 0) action(); }); // teclado (Enter ou espaço)
}
holdToRepeat($('art-smaller'), () => resizeActive(1 / 1.1));
holdToRepeat($('art-bigger'), () => resizeActive(1.1));
$('art-menu-swap').addEventListener('click', () => { const layer = menuLayer(); if (layer) requestArt(layer.zoneId); });
$('art-menu-remove').addEventListener('click', () => { const layer = menuLayer(); if (layer) removeLayer(layer.id); });
$('art-menu-measures').addEventListener('click', () => { measuresOpen = !measuresOpen; renderArtMenu(); renderLayerFields(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !artMenu.hidden && !$('review').open) closeArtMenu(); });
function renderLayerFields(preserveField = '') {
  const layer = activeLayer();
  controls.hidden = !layer || adjustingId !== layer.id;
  if (!layer || adjustingId !== layer.id) return;
  $('art-menu-size').textContent = cm(layer.widthCm) + ' × ' + cm(layer.heightCm) + ' cm';
  if (preserveField !== 'art-width') $('art-width').value = round(layer.widthCm);
  $('art-height').textContent = round(layer.heightCm);
  if (preserveField !== 'art-angle') $('art-angle').value = round(layer.angle);
  controls.querySelector('label[for="art-angle"]').firstChild.textContent = isSleeve(layer.zoneId) ? 'Giro extra ' : 'Rotação ';
  if (preserveField !== 'art-x') $('art-x').value = round(layer.xCm);
  if (preserveField !== 'art-y') $('art-y').value = round(layer.yCm);
  $('art-width').max = zoneById(layer.zoneId).cmWidth;
}
function renderStage() { renderView(); renderColor(); renderZones(); renderLayers(); }
function selectLayer(id) {
  const layer = project.layers.find((entry) => entry.id === id);
  if (!layer) return;
  selectedId = id; adjustingId = id; zoneId = layer.zoneId; if (isSleeve(zoneId)) sleeveSide = zoneId;
  // só troca de aba se a arte não está à vista (as mangas já aparecem na frente: ali a pessoa fica onde estava)
  if (!visibleZones(view, sleeveSide, chestMode(project)).some((zone) => zone.id === layer.zoneId)) view = viewFor(layer.zoneId);
  renderStage(); renderLayerList(); renderLayerFields();
  if (!focusArt(layer)) centerZoom();
  revealArtMenu();
}
function chooseView(nextView) {
  view = nextView; selectedId = null; adjustingId = null;
  zoneId = nextView === 'front' ? (chestMode(project) === 'central' ? 'peito-centro' : 'peito-esquerdo') : nextView === 'back' ? 'costas-centro' : sleeveSide;
  renderStage(); renderLayerList(); renderLayerFields(); centerZoom();
}

function fileData(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}
function decodedImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('A imagem não pôde ser aberta. Escolha um PNG, JPG ou WebP válido.'));
    image.src = src;
  });
}
const typeByExtension = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const bytesOf = (dataUrl) => Math.round(dataUrl.length * 0.75);
// Fotos do celular chegam enormes (vários MB e milhares de pixels). Aqui viram uma cópia leve, mais que suficiente para a prévia e para o pedido.
function reduceImage(image, mime) {
  const scale = Math.min(1, REDUCE_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(2, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('O aparelho não conseguiu abrir esta imagem. Escolha uma menor.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  if (mime === 'image/jpeg') return { dataUrl: canvas.toDataURL('image/jpeg', 0.88), mime };
  // PNG e outros formatos viram PNG, que guarda a transparência; se ficar pesado, tenta WebP
  let dataUrl = canvas.toDataURL('image/png');
  if (bytesOf(dataUrl) > MAX_ART * 0.8) { const webp = canvas.toDataURL('image/webp', 0.92); if (webp.startsWith('data:image/webp')) return { dataUrl: webp, mime: 'image/webp' }; }
  return { dataUrl, mime: 'image/png' };
}
async function loadArt(file, name = file.name) {
  if (file.size === 0) throw new Error('O arquivo está vazio.');
  if (file.size > MAX_PICK) throw new Error('Esta imagem tem mais de 40 MB. Escolha outra, menor.');
  let mime = file.type || typeByExtension[String(file.name || '').split('.').pop().toLowerCase()] || '';
  if (!mime.startsWith('image/')) throw new Error('Escolha uma imagem PNG, JPG ou WebP.');
  let dataUrl = await fileData(file); let image = await decodedImage(dataUrl);
  if (!allowedTypes.includes(mime) || file.size > SOFT_BYTES || Math.max(image.naturalWidth, image.naturalHeight) > REDUCE_SIDE) {
    const light = reduceImage(image, mime);
    dataUrl = light.dataUrl; mime = light.mime; image = await decodedImage(dataUrl);
  }
  if (bytesOf(dataUrl) > MAX_ART) throw new Error('Esta imagem continua pesada demais. Escolha uma menor.');
  await preparePreview(dataUrl, image);
  return { name: String(name || 'arte').slice(0, 160), mime, dataUrl, pixelWidth: image.naturalWidth, pixelHeight: image.naturalHeight };
}
const modeOf = (layer) => layer.backgroundMode || (layer.removeBackground === false ? 'keep' : 'all');
const tintOf = (layer) => layer.tint || 'original';
const variantKey = (dataUrl, mode, tint) => dataUrl + '|' + mode + '|' + tint;
// Prepara a imagem que aparece na camiseta: sem fundo (tudo ou só o de fora) e/ou de uma cor só. O arquivo original nunca muda.
async function preparePreview(dataUrl, image = null, mode = 'all', tint = 'original') {
  const key = variantKey(dataUrl, mode, tint);
  if (variants.has(key) && analysis.has(dataUrl)) return;
  image ||= await decodedImage(dataUrl);
  const canvas = document.createElement('canvas');
  // Limita memória do processamento; original e dimensões para medidas ficam intactos.
  const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.max(2, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(2, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const probe = removeSolidBackground(pixels.data, pixels.width, pixels.height, { enclosed: true });
  if (!analysis.has(dataUrl)) analysis.set(dataUrl, { removable: probe.removed, transparent: probe.reason === 'ja-transparente', reason: probe.reason });
  const info = analysis.get(dataUrl);
  let data = pixels.data, edited = false;
  if (mode !== 'keep' && info.removable) {
    data = mode === 'all' ? probe.data : removeSolidBackground(pixels.data, pixels.width, pixels.height, { enclosed: false }).data;
    edited = true;
  }
  if (tint !== 'original' && ((info.removable && mode !== 'keep') || info.transparent)) { data = tintArt(data, TINT_COLORS[tint]?.[1] || tint); edited = true; }
  if (!edited) { variants.set(key, dataUrl); return; }
  pixels.data.set(data); context.putImageData(pixels, 0, 0);
  variants.set(key, canvas.toDataURL('image/png'));
}
// O cliente muda o fundo ou a cor da arte; só a prévia muda, o arquivo original continua o mesmo.
async function chooseArtLook(layer, fields) {
  Object.assign(layer, fields);
  layer.removeBackground = modeOf(layer) !== 'keep';
  try { await preparePreview(layer.art.dataUrl, null, modeOf(layer), tintOf(layer)); } catch (error) { status(error.message, true); }
  renderLayers(); renderLayerList(); changed();
}
function choiceGroup(title, options, current, onPick) {
  const box = document.createElement('div'); box.className = 'choice-group';
  const label = document.createElement('p'); label.className = 'choice-title'; label.textContent = title;
  const row = document.createElement('div'); row.className = 'choice-row'; row.setAttribute('role', 'group'); row.setAttribute('aria-label', title);
  for (const [value, text, hint] of options) {
    const pick = button(text, 'choice'); pick.title = hint; pick.setAttribute('aria-pressed', String(value === current));
    pick.addEventListener('click', () => { if (value !== current) onPick(value); });
    row.append(pick);
  }
  box.append(label, row);
  return box;
}
// Largura inicial da arte: peito 9 cm (central 22 cm), manga cabe com folga, costas 70% da área, barras 40%.
function defaultWidth(area) {
  if (area.id === 'peito-centro') return 22;
  if (area.id === 'peito-esquerdo' || area.id === 'peito-direito') return 9;
  if (isSleeve(area.id)) return Math.min(area.cmWidth * .65, 10);
  return area.cmWidth * (area.id.startsWith('barra') ? .4 : .7);
}
let popId = null;
function addArt(art, targetZoneId = zoneId) {
  const area = zoneById(targetZoneId);
  const existing = project.layers.find(layer => layer.zoneId === targetZoneId);
  let layer = fitLayer({ id: existing?.id || 'arte-' + newId(), zoneId: area.id, view: area.view,
    widthCm: defaultWidth(area), angle: 0, art, removeBackground: analysis.get(art.dataUrl)?.removable || false, backgroundMode: analysis.get(art.dataUrl)?.removable ? 'all' : 'keep', tint: 'original' }, area);
  layer = moveLayer(layer, area, (area.cmWidth - layer.widthCm) / 2, (area.cmHeight - layer.heightCm) / 2);
  const mode = area.id === 'peito-centro' ? 'central' : ['peito-esquerdo', 'peito-direito'].includes(area.id) ? 'sides' : chestMode(project);
  const next = { ...project, chestMode: mode, layers: [...project.layers.filter(entry => entry.zoneId !== area.id), layer] };
  const errors = validateProject(next, { requireQuantity: false });
  if (errors.length) throw new Error(errors.join(' '));
  project = next; adjustingId = null; popId = layer.id; setTimeout(() => { if (popId === layer.id) popId = null; }, 800); selectLayer(layer.id); changed();
  status('Arte ' + (existing ? 'trocada' : 'adicionada') + ' em ' + area.label + '.');
}
function setLayer(fields, preserveField = '') {
  const layer = activeLayer(); if (!layer) return;
  const next = fitLayer({ ...layer, ...fields }, zoneById(fields.zoneId || layer.zoneId));
  project.layers = project.layers.map((entry) => entry.id === layer.id ? next : entry);
  renderLayers(); renderLayerFields(preserveField); changed();
}

function renderSizes() {
  $('size-grid').replaceChildren();
  const pattern = catalog.modelagens.find((entry) => entry.nome === modelagem);
  for (const size of pattern.tamanhos) {
    const key = pattern.nome + ' ' + size;
    const label = document.createElement('label'); label.className = 'size-field';
    const name = document.createElement('span'); name.textContent = size;
    const input = document.createElement('input'); input.type = 'number'; input.className = 'size-input';
    input.min = '0'; input.max = '9999'; input.step = '1'; input.inputMode = 'numeric';
    input.placeholder = '0'; input.value = project.quantities[key] || '';
    input.setAttribute('aria-label', 'Quantidade ' + key);
    input.addEventListener('input', () => {
      const value = input.value === '' ? 0 : Number(input.value);
      const valid = Number.isInteger(value) && value >= 0 && value <= 9999;
      input.setCustomValidity(valid ? '' : 'Use uma quantidade inteira entre 0 e 9999.');
      input.setAttribute('aria-invalid', String(!valid));
      if (!valid) { status('A quantidade de ' + key + ' deve ser um número inteiro entre 0 e 9999.', true); return; }
      if (value > 0) project.quantities[key] = value; else delete project.quantities[key];
      updateTotal(); changed();
    });
    label.append(name, input); $('size-grid').append(label);
  }
  updateTotal();
}
function syncInputs() {
  $('notes').value = project.notes;
}
function renderAll() {
  if (view === 'front') zoneId = chestMode(project) === 'central' ? 'peito-centro' : 'peito-esquerdo';
  renderStage(); renderLayerList(); renderLayerFields(); renderSizes(); syncInputs();
}
function validateCatalogProject(next) {
  if (next.product.slug !== catalog.slug) throw new Error('Este configurador abre somente projetos desta camiseta PV.');
  for (const [key] of Object.entries(next.quantities)) {
    if (!catalog.modelagens.some((pattern) => pattern.tamanhos.some((size) => pattern.nome + ' ' + size === key))) {
      throw new Error('A grade contém uma modelagem ou tamanho que não pertence a este produto.');
    }
  }
  next.product = { slug: catalog.slug, name: catalog.nome, fabric: 'Malha PV (poliéster/viscose)' };
  return next;
}
function checkInputs() {
  const fields = document.querySelectorAll('input[type="number"]');
  for (const field of fields) if (!field.checkValidity()) { field.reportValidity(); throw new Error('Confira os campos numéricos destacados antes de continuar.'); }
}

for (const [name, hex] of catalog.paleta) {
  const item = button('', 'color-swatch retalho');
  const tecido = document.createElement('i'); tecido.style.setProperty('--c', hex); item.append(tecido);
  item.dataset.hex = hex; item.title = name; item.setAttribute('aria-label', name); item.setAttribute('aria-pressed', 'false');
  item.addEventListener('click', () => { project.color = { name, hex }; renderColor(); changed(); });
  $('color-swatches').append(item);
}
for (const pattern of catalog.modelagens) {
  const option = document.createElement('option'); option.value = pattern.nome; option.textContent = pattern.nome; $('modelagem').append(option);
}
$('modelagem').addEventListener('change', () => {
  const invalid = [...$('size-grid').querySelectorAll('input')].find((field) => !field.checkValidity());
  if (invalid) { $('modelagem').value = modelagem; invalid.reportValidity(); status('Corrija a quantidade antes de trocar a modelagem.', true); return; }
  modelagem = $('modelagem').value; renderSizes();
});
$('view-buttons').addEventListener('click', (event) => { const item = event.target.closest('[data-view]'); if (item) chooseView(item.dataset.view); });
$('chest-buttons').addEventListener('click', (event) => { const item = event.target.closest('[data-chest]'); if (item) chooseChest(item.dataset.chest); });
$('sleeve-side').addEventListener('click', () => {
  sleeveSide = sleeveSide === 'manga-esquerda' ? 'manga-direita' : 'manga-esquerda';
  chooseView('sleeve');
});
$('art-file').addEventListener('change', async () => {
  const file = $('art-file').files[0]; if (!file) return;
  const targetZone = uploadZone || zoneId;
  try { addArt(await loadArt(file), targetZone); } catch (error) { status(error.message, true); }
  finally { $('art-file').value = ''; uploadZone = null; }
});
for (const [id, property] of [['art-width', 'widthCm'], ['art-angle', 'angle'], ['art-x', 'xCm'], ['art-y', 'yCm']]) {
  $(id).addEventListener('input', () => {
    const value = Number($(id).value);
    if (!Number.isFinite(value) || $(id).value === '' || !$(id).checkValidity()) return;
    try { setLayer({ [property]: value }, id); } catch (error) { status(error.message, true); }
  });
  $(id).addEventListener('change', () => {
    const value = Number($(id).value);
    if (!Number.isFinite(value) || $(id).value === '') { renderLayerFields(); return; }
    try {
      setLayer({ [property]: value });
      status('Medida ajustada. A arte é limitada à área escolhida, preservando sua proporção.');
    } catch (error) { status(error.message, true); renderLayerFields(); }
  });
}
$('center-art').addEventListener('click', () => {
  const layer = activeLayer(); if (!layer) return;
  const area = zoneById(layer.zoneId);
  setLayer({ xCm: (area.cmWidth - layer.widthCm) / 2, yCm: (area.cmHeight - layer.heightCm) / 2 });
});
$('remove-art').addEventListener('click', () => removeLayer(selectedId));
$('notes').addEventListener('input', () => { project.notes = $('notes').value; changed(); });

function point(event) {
  const matrix = svg.getScreenCTM();
  return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
}
svg.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  const group = event.target.closest('[data-layer-id]'); if (!group) return;
  event.preventDefault();
  const handle = event.target.closest('[data-handle]')?.dataset.handle;
  const layer = project.layers.find((item) => item.id === group.dataset.layerId);
  drag = { initial: structuredClone(layer), start: point(event), mode: handle ? 'resize' : 'move', handle, geo: layerGeometry(layer, view, sleeveSide), pointerId: event.pointerId, moved: false, from: { x: event.clientX, y: event.clientY } };
  selectedId = layer.id; zoneId = layer.zoneId; adjustingId = layer.id;
  svg.setPointerCapture(event.pointerId);
  renderZones(); renderLayers(); renderLayerList(); renderLayerFields();
});
svg.addEventListener('pointermove', (event) => {
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (!drag.moved && Math.hypot(event.clientX - drag.from.x, event.clientY - drag.from.y) > 5) drag.moved = true;
  const cursor = point(event); const layer = drag.initial; const area = displayZone(zoneById(layer.zoneId), view, sleeveSide);
  const screenDx = cursor.x - drag.start.x, screenDy = cursor.y - drag.start.y;
  const inclination = fabricAngle(layer.zoneId, view) * Math.PI / 180;
  const dx = (screenDx * Math.cos(inclination) + screenDy * Math.sin(inclination)) * area.cmWidth / area.width;
  const dy = (-screenDx * Math.sin(inclination) + screenDy * Math.cos(inclination)) * area.cmHeight / area.height;
  try {
    let next;
    if (drag.mode === 'move') next = moveLayer(layer, area, layer.xCm + dx, layer.yCm + dy);
    else {
      // a alça segue o dedo/mouse ao longo da diagonal da arte; a arte cresce ou encolhe em volta do próprio centro
      const g = drag.geo, turn = g.angle * Math.PI / 180;
      const vx = cursor.x - (g.x + g.w / 2), vy = cursor.y - (g.y + g.h / 2);
      const lx = vx * Math.cos(turn) + vy * Math.sin(turn), ly = -vx * Math.sin(turn) + vy * Math.cos(turn);
      const cornerX = (drag.handle.endsWith('e') ? 1 : -1) * g.w / 2, cornerY = (drag.handle.startsWith('s') ? 1 : -1) * g.h / 2;
      const scale = Math.max(0.05, (lx * cornerX + ly * cornerY) / (cornerX * cornerX + cornerY * cornerY));
      const resized = fitLayer({ ...layer, widthCm: layer.widthCm * scale }, area);
      next = moveLayer(resized, area, layer.xCm + (layer.widthCm - resized.widthCm) / 2, layer.yCm + (layer.heightCm - resized.heightCm) / 2);
    }
    project.layers = project.layers.map((entry) => entry.id === layer.id ? next : entry);
    renderLayers(); renderLayerFields();
  } catch { /* Mantém a última medida válida durante o gesto. */ }
});
function endDrag(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  const tapped = !drag.moved;
  drag = null; renderLayerList(); changed();
  if (tapped) { focusArt(activeLayer()); revealArtMenu(); }
}
svg.addEventListener('click', (event) => {
  if (justPanned || !adjustingId || event.target.closest('[data-layer-id], [data-handle], .print-zone')) return;
  selectedId = null; adjustingId = null;
  renderLayers(); renderLayerList(); renderLayerFields();
});
svg.addEventListener('pointerup', endDrag);
svg.addEventListener('pointercancel', endDrag);
svg.addEventListener('keydown', (event) => {
  const group = event.target.closest('[data-layer-id]'); if (!group) return;
  const layer = project.layers.find((entry) => entry.id === group.dataset.layerId);
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectLayer(layer.id); return; }
  const fields = {
    ArrowLeft: { xCm: layer.xCm - .2 }, ArrowRight: { xCm: layer.xCm + .2 },
    ArrowUp: { yCm: layer.yCm - .2 }, ArrowDown: { yCm: layer.yCm + .2 },
    '+': { widthCm: layer.widthCm + .2 }, '-': { widthCm: layer.widthCm - .2 },
  }[event.key];
  if (!fields) return;
  event.preventDefault(); selectedId = layer.id;
  setLayer(fields); svg.querySelector('[data-layer-id="' + layer.id + '"]')?.focus();
});

async function previewImage(whichView, current, side = sleeveSide) {
  const element = svg.cloneNode(true);
  for (const id of ['zone-overlay', 'art-layers', 'selection-overlay', 'measurement-overlay']) element.querySelector('#' + id).replaceChildren();
  applyBase(element, whichView, true, side);
  element.setAttribute('width', '1000'); element.setAttribute('height', '1000');
  for (const layer of visibleLayers(current, whichView, side)) appendArt(element.querySelector('#art-layers'), layer, whichView, side, false);
  paintMeasurements(element.querySelector('#measurement-overlay'), visibleLayers(current, whichView, side), null, { view: whichView, side, numbers: artNumbers(current), scale: uiScaleFor(whichView, side) * 1.9 });
  element.querySelector('#dye-matrix').setAttribute('values', dyeMatrix(current.color.hex));
  const content = new XMLSerializer().serializeToString(element);
  const objectUrl = URL.createObjectURL(new Blob([content], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = await decodedImage(objectUrl);
    const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 1000;
    const context = canvas.getContext('2d'); context.fillStyle = '#f2f3f0'; context.fillRect(0, 0, 1000, 1000); context.drawImage(image, 0, 0);
    return canvas.toDataURL('image/png');
  } finally { URL.revokeObjectURL(objectUrl); }
}
const basesReady = Promise.all([['front', 'frente'], ['back', 'costas']].map(async ([key, name]) => {
  const response = await fetch(asset('img/' + name + '.webp'));
  if (!response.ok) throw new Error('Não foi possível carregar a foto de ' + name + '. Recarregue a página.');
  baseData[key] = await fileData(new Blob([await response.arrayBuffer()], { type: 'image/png' }));
})).catch((error) => { status(error.message, true); throw error; });

async function checkArtImages(next) {
  await Promise.all(next.layers.map(async (layer) => {
    const image = await decodedImage(layer.art.dataUrl);
    await preparePreview(layer.art.dataUrl, image, modeOf(layer), tintOf(layer));
    if (image.naturalWidth !== layer.art.pixelWidth || image.naturalHeight !== layer.art.pixelHeight
        || image.naturalWidth > 12000 || image.naturalHeight > 12000) {
      throw new Error('As dimensões da imagem ' + layer.art.name + ' não correspondem ao projeto. Reenvie a arte original.');
    }
  }));
}


/* ---------- etapas 1 a 4: todas na página, uma embaixo da outra; só rolar e escolher ---------- */
const phoneQuery = matchMedia('(max-width: 760px)');
const calmScroll = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
// no celular a foto fica fixa no alto: o que se mostra começa logo abaixo dela
const stickyBottom = () => (phoneQuery.matches ? document.querySelector('.preview-panel').getBoundingClientRect().bottom : 0);
function scrollToSection(n) {
  const section = document.querySelector('[data-step="' + n + '"]');
  if (section) scrollTo({ top: Math.max(0, scrollY + section.getBoundingClientRect().top - stickyBottom() - 12), behavior: calmScroll() });
}
// enquanto a pessoa digita, a foto deixa de ficar fixa no celular (o teclado já ocupa metade da tela)
document.addEventListener('focusin', (event) => { if (event.target.matches('#notes')) document.body.classList.add('digitando'); });
// quanto a foto fixa ocupa no alto (celular): os campos usam isso para nunca ficar escondidos atrás dela
new ResizeObserver(() => document.documentElement.style.setProperty('--foto-h', document.querySelector('.preview-panel').offsetHeight + 'px')).observe(document.querySelector('.preview-panel'));
document.addEventListener('focusout', () => document.body.classList.remove('digitando'));

/* ---------- zoom da foto ---------- */
const zoomLevels = [1, 1.7, 2.6, 4];
const MAX_ZOOM = zoomLevels[zoomLevels.length - 1];
let zoom = 1;
let pinching = false;
// A foto cresce aos poucos (transição de largura). Posicionar uma vez só deixava a janela presa no canto de cima, à esquerda:
// por isso o ponto escolhido é recolocado a cada quadro até a foto parar de crescer. Um toque ou arrasto da pessoa cancela.
let placing = 0;
function keepPlacing(place) {
  const mine = ++placing, until = performance.now() + 340;
  const step = () => { if (mine !== placing || pinching) return; place(); if (performance.now() < until) requestAnimationFrame(step); };
  step();
}
function centerZoom() {
  const box = $('zoom-box');
  keepPlacing(() => { box.scrollLeft = (box.scrollWidth - box.clientWidth) / 2; box.scrollTop = (box.scrollHeight - box.clientHeight) / 2; });
}
// Aplica um zoom qualquer (de 1 a MAX_ZOOM). Os botões + e − pulam entre os níveis; o gesto de pinça e a rodinha do mouse usam valores contínuos.
function applyZoom(value) {
  zoom = Math.min(MAX_ZOOM, Math.max(1, value));
  $('zoom-box').style.setProperty('--zoom', zoom);
  $('zoom-box').classList.toggle('ampliado', zoom > 1.01);
  $('zoom-out').disabled = zoom <= 1.01; $('zoom-in').disabled = zoom >= MAX_ZOOM - 0.01;
}
function setZoom(value) { applyZoom(value); centerZoom(); }
// Põe um ponto da foto (em unidades da foto) no meio da janela; aproxima até `wanted` se a foto estiver mais longe que isso.
function focusPoint(cx, cy, wanted) {
  const frame = viewBoxFor(view, sleeveSide), box = $('zoom-box');
  if (wanted > zoom + 0.05) applyZoom(wanted); // se a pessoa já aproximou mais, o zoom dela fica
  const ax = (cx - frame.x) / frame.w, ay = (cy - frame.y) / frame.h;
  keepPlacing(() => { box.scrollLeft = ax * box.scrollWidth - box.clientWidth / 2; box.scrollTop = ay * box.scrollHeight - box.clientHeight / 2; });
}
// Aproxima a foto até a arte ocupar cerca de um terço da largura e a põe no meio da janela.
function focusArt(layer) {
  if (!layer || !visibleLayers().includes(layer)) return false;
  const g = layerGeometry(layer, view, sleeveSide), frame = viewBoxFor(view, sleeveSide);
  focusPoint(g.x + g.w / 2, g.y + g.h / 2, Math.min(3.2, Math.max(1, (frame.w * 0.34) / Math.max(g.w, g.h * 0.8))));
  return true;
}
// Ao tocar no "+" de um lugar, a foto já vai para ele (antes mesmo de a pessoa escolher a logo).
function focusZone(id) {
  const zone = visibleZones(view, sleeveSide, chestMode(project)).find((entry) => entry.id === id);
  if (!zone) return;
  const area = displayZone(zone, view, sleeveSide), frame = viewBoxFor(view, sleeveSide);
  focusPoint(area.x + area.width / 2, area.y + area.height / 2, Math.min(2.6, Math.max(1, (frame.w * 0.42) / Math.max(area.width, area.height))));
}
const nextZoom = () => zoomLevels.find((level) => level > zoom + 0.02) ?? MAX_ZOOM;
const previousZoom = () => [...zoomLevels].reverse().find((level) => level < zoom - 0.02) ?? 1;

// Arrastar a foto ampliada com o mouse: segura em qualquer lugar (até em cima do quadrado do "+") e arrasta.
// Só vira arrasto depois de mexer uns pixels; um clique parado continua abrindo o "+" normalmente. A arte em si continua arrastável (mexe só a arte).
{
  const box = $('zoom-box');
  let pan = null;
  box.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.pointerType === 'touch' || zoom <= 1.01) return;
    if (event.target.closest('[data-layer-id], [data-handle]')) return;
    pan = { id: event.pointerId, x: event.clientX, y: event.clientY, left: box.scrollLeft, top: box.scrollTop, moving: false };
    placing += 1;
  });
  box.addEventListener('touchmove', () => { placing += 1; }, { passive: true });
  box.addEventListener('pointermove', (event) => {
    if (!pan || event.pointerId !== pan.id) return;
    const dx = event.clientX - pan.x, dy = event.clientY - pan.y;
    if (!pan.moving && Math.hypot(dx, dy) < 5) return;
    if (!pan.moving) { pan.moving = true; box.setPointerCapture(pan.id); box.classList.add('arrastando'); }
    box.scrollLeft = pan.left - dx; box.scrollTop = pan.top - dy;
  });
  const stopPan = (event) => {
    if (!pan || event.pointerId !== pan.id) return;
    if (pan.moving) {
      justPanned = true; setTimeout(() => { justPanned = false; }, 0);
      if (box.hasPointerCapture(pan.id)) box.releasePointerCapture(pan.id);
      box.classList.remove('arrastando');
    }
    pan = null;
  };
  box.addEventListener('pointerup', stopPan);
  box.addEventListener('pointercancel', stopPan);
}
{
  let frame = 0;
  new ResizeObserver(() => { if (pinching) return; cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { renderZones(); renderLayers(); }); }).observe(svg);
}
$('zoom-in').addEventListener('click', () => setZoom(nextZoom()));
$('zoom-out').addEventListener('click', () => setZoom(previousZoom()));

// Pinça com dois dedos (celular) e Ctrl + rodinha / pinça do touchpad (computador): o zoom é contínuo e o ponto entre os dedos fica parado.
{
  const box = $('zoom-box');
  let pinch = null;
  const centerOf = (touches) => {
    const rect = box.getBoundingClientRect();
    return { x: (touches[0].clientX + touches[1].clientX) / 2 - rect.left, y: (touches[0].clientY + touches[1].clientY) / 2 - rect.top };
  };
  const fingers = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
  // zoom em volta de um ponto da janela (x, y em pixels dentro dela); `anchor` é onde esse ponto está na foto (0 a 1)
  function zoomAround(value, x, y, anchor) {
    applyZoom(value);
    box.scrollLeft = anchor.x * box.scrollWidth - x;
    box.scrollTop = anchor.y * box.scrollHeight - y;
  }
  function endPinch() {
    if (!pinch) return;
    pinch = null; pinching = false; box.classList.remove('pinching');
    justPanned = true; setTimeout(() => { justPanned = false; }, 150);
    if (zoom < 1.05) setZoom(1);
    renderZones(); renderLayers();
  }
  box.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 2) return;
    if (drag) { // o primeiro dedo estava mexendo numa arte: desfaz esse movimento, a pinça é só do zoom
      project.layers = project.layers.map((entry) => entry.id === drag.initial.id ? drag.initial : entry);
      if (svg.hasPointerCapture(drag.pointerId)) svg.releasePointerCapture(drag.pointerId);
      drag = null; renderLayers(); renderLayerFields();
    }
    const c = centerOf(event.touches);
    pinch = { start: fingers(event.touches), zoom, anchor: { x: (box.scrollLeft + c.x) / box.scrollWidth, y: (box.scrollTop + c.y) / box.scrollHeight } };
    pinching = true; box.classList.add('pinching');
  }, { passive: false });
  box.addEventListener('touchmove', (event) => {
    if (!pinch || event.touches.length !== 2) return;
    if (event.cancelable) event.preventDefault();
    const c = centerOf(event.touches);
    zoomAround(pinch.zoom * fingers(event.touches) / Math.max(1, pinch.start), c.x, c.y, pinch.anchor);
  }, { passive: false });
  box.addEventListener('touchend', (event) => { if (event.touches.length < 2) endPinch(); });
  box.addEventListener('touchcancel', endPinch);
  box.addEventListener('gesturestart', (event) => event.preventDefault()); // Safari do iPhone: não deixa a pinça ampliar a página inteira
  box.addEventListener('wheel', (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const rect = box.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const anchor = { x: (box.scrollLeft + x) / box.scrollWidth, y: (box.scrollTop + y) / box.scrollHeight };
    box.classList.add('pinching');
    zoomAround(zoom * Math.exp(-event.deltaY * 0.01), x, y, anchor);
    clearTimeout(box.pinchTimer);
    box.pinchTimer = setTimeout(() => { box.classList.remove('pinching'); if (zoom < 1.05) setZoom(1); renderZones(); renderLayers(); }, 180);
  }, { passive: false });
}

/* ---------- conferência dentro da página; a peça pronta entra no "Meu pedido" do site ---------- */
const review = $('review');
const BACKGROUND_SHORT = { all: 'fundo tirado', outer: 'só o fundo de fora tirado', keep: 'fundo mantido' };
const tintShort = (tint) => (tint === 'original' || !TINT_COLORS[tint] ? 'cores da logo' : 'toda ' + TINT_COLORS[tint][0].toLowerCase());
function artLook(layer) {
  const mode = modeOf(layer), tint = tintOf(layer);
  const parts = [];
  if (analysis.get(layer.art.dataUrl)?.removable) parts.push(BACKGROUND_SHORT[mode]);
  parts.push(tintShort(tint));
  return parts.join(', ');
}
function groupedSizes(quantities) {
  const groups = [];
  for (const [key, amount] of Object.entries(quantities)) {
    if (!(amount > 0)) continue;
    const cut = key.lastIndexOf(' ');
    const name = key.slice(0, cut), size = key.slice(cut + 1);
    let group = groups.find((entry) => entry.name === name);
    if (!group) { group = { name, items: [] }; groups.push(group); }
    group.items.push(size + ' ' + amount);
  }
  return groups.map((group) => group.name + ' ' + group.items.join(', ')).join('; ');
}
// os tamanhos agrupados por modelagem, para a ficha: [{ nome: 'Tradicional', itens: [['P', 4], ['M', 12]] }]
function sizeGroups(quantities) {
  const groups = [];
  for (const [key, amount] of Object.entries(quantities)) {
    if (!(amount > 0)) continue;
    const cut = key.lastIndexOf(' ');
    const nome = key.slice(0, cut), size = key.slice(cut + 1);
    let group = groups.find((entry) => entry.nome === nome);
    if (!group) { group = { nome, itens: [] }; groups.push(group); }
    group.itens.push([size, amount]);
  }
  return groups;
}
// A peça pronta vira um item do "Meu pedido" do site (mesmo formato de src/novo/pedido.js, mais as artes com medida).
// As imagens das logos não vão para lá: são pesadas e o cliente as manda na conversa do WhatsApp.
const ORDER_KEY = 'mapra-pedido';
function orderItem(current) {
  return {
    slug: current.product.slug, nome: current.product.name, cor: current.color.name,
    qtd: quantityTotal(current.quantities), marca: [],
    tam: Object.fromEntries(Object.entries(current.quantities).filter(([, amount]) => amount > 0)),
    artes: activeLayers(current).map((layer) => ({ lugar: zoneById(layer.zoneId).label, medida: cm(layer.widthCm) + ' × ' + cm(layer.heightCm) + ' cm', arquivo: layer.art.name, aspecto: artLook(layer) })),
    tecnica: current.technique && current.technique !== 'A confirmar' ? current.technique : '',
    obs: current.notes || '',
  };
}
function addToOrder(current, id, ficha) {
  let items = [];
  try { const saved = JSON.parse(localStorage.getItem(ORDER_KEY)); if (Array.isArray(saved)) items = saved; } catch { /* pedido guardado ilegível: começa outro */ }
  items.push({ ...orderItem(current), id, ficha });
  localStorage.setItem(ORDER_KEY, JSON.stringify(items));
}
// As vistas que entram na conferência e na ficha: a frente sempre; costas e mangas só se tiverem arte.
function viewsFor(arts) {
  const wanted = [['front', 'Frente', 'manga-esquerda']];
  if (arts.some((layer) => layer.view === 'back')) wanted.push(['back', 'Costas', 'manga-esquerda']);
  if (arts.some((layer) => layer.zoneId === 'manga-esquerda')) wanted.push(['sleeve', 'Manga esquerda', 'manga-esquerda']);
  if (arts.some((layer) => layer.zoneId === 'manga-direita')) wanted.push(['sleeve', 'Manga direita', 'manga-direita']);
  return wanted;
}
// A ficha da peça (imagem com as vistas, as medidas e os tamanhos) e as logos originais ficam guardadas no aparelho,
// para o cliente mandar na conversa junto com o pedido. É um extra: se não der para fazer, o pedido em texto segue igual.
async function prepareFicha(id, current) {
  const arts = activeLayers(current);
  if (!arts.length) return false; // camiseta lisa: o texto já diz tudo
  try {
    status('Preparando a ficha da peça…');
    await basesReady;
    const vistas = [];
    for (const [whichView, label, side] of viewsFor(arts)) vistas.push({ rotulo: label, src: await previewImage(whichView, current, side) });
    let cliente = '';
    try { const saved = JSON.parse(localStorage.getItem('mapra-cliente')) || {}; cliente = [saved.empresa, saved.nome].filter(Boolean).join(' · '); } catch { /* sem dados ainda */ }
    const ficha = await desenhaFicha({
      peca: current.product.name, cor: { nome: current.color.name, hex: current.color.hex },
      total: quantityTotal(current.quantities), grade: sizeGroups(current.quantities), aviso: current.notes, cliente, vistas,
      artes: arts.map((layer, index) => ({ n: index + 1, lugar: zoneById(layer.zoneId).label, medida: cm(layer.widthCm) + ' × ' + cm(layer.heightCm) + ' cm', arquivo: layer.art.name, aspecto: artLook(layer) })),
    });
    const logos = arts.map((layer, index) => ({ nome: (index + 1) + '-' + layer.art.name, blob: dataUrlToFile(layer.art.dataUrl, layer.art.name, layer.art.mime) }));
    await guardaFicha({ id, nome: current.product.name, ficha, logos });
    return true;
  } catch { return false; }
}
// Depois de entrar no pedido, o configurador fica limpo para a próxima peça (a cor continua).
function startNewPiece() {
  project = { ...project, id: 'MP-TESTE-' + Date.now().toString(36).toUpperCase(), createdAt: new Date().toISOString(), layers: [], quantities: {}, notes: '', chestMode: 'sides' };
  selectedId = null; adjustingId = null; view = 'front'; zoneId = 'peito-esquerdo';
  clearTimeout(autosaveTimer);
  try { localStorage.setItem(STORAGE, JSON.stringify(project)); } catch { /* sem armazenamento */ }
  renderAll();
}
function validForOrder(checkMinimum = true) {
  try { checkInputs(); } catch (error) { status(error.message, true); return null; }
  const current = snapshot();
  const errors = validateProject(current);
  if (errors.length) {
    if (review.open) review.close();
    status(errors.join(' '), true);
    scrollToSection(/quantidade|tamanho|peça|grade/i.test(errors.join(' ')) ? 3 : /arte|aplica/i.test(errors.join(' ')) ? 2 : 3);
    return null;
  }
  const total = quantityTotal(current.quantities);
  if (checkMinimum && total < MIN_PIECES) {
    if (review.open) review.close();
    status(missingText(total), true);
    scrollToSection(3);
    return null;
  }
  return current;
}
let addingToOrder = false;
for (const link of document.querySelectorAll('[data-add-order]')) {
  link.addEventListener('click', async (event) => {
    event.preventDefault();
    if (addingToOrder) return; // um toque só: a ficha leva um instante para ficar pronta
    const current = validForOrder(); if (!current) return;
    addingToOrder = true;
    const id = 'peca-' + newId();
    const ficha = await prepareFicha(id, current);
    try { addToOrder(current, id, ficha); }
    catch { addingToOrder = false; status('Não foi possível guardar o pedido neste aparelho. Saia do modo anônimo ou libere espaço e tente de novo.', true); return; }
    if (review.open) review.close();
    startNewPiece();
    location.href = link.href;
  });
}
function summaryRow(term, value) {
  const dt = document.createElement('dt'); dt.textContent = term;
  const dd = document.createElement('dd');
  if (Array.isArray(value)) { const ul = document.createElement('ul'); for (const line of value) { const li = document.createElement('li'); li.textContent = line; ul.append(li); } dd.append(ul); } else dd.textContent = value;
  $('review-summary').append(dt, dd);
}
function dataUrlToFile(dataUrl, name, type) {
  const [, base64] = dataUrl.split(',');
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new File([bytes], name, { type });
}
let reviewFiles = [];
async function openReview() {
  const current = validForOrder(false); if (!current) return; // dá para ver como ficou antes de fechar a quantidade
  $('toast').hidden = true;
  $('review-loading').hidden = false; $('review-previews').replaceChildren(); $('review-summary').replaceChildren();
  $('review-share').hidden = true;
  const total = quantityTotal(current.quantities), arts = activeLayers(current);
  summaryRow('Camiseta', current.product.name);
  summaryRow('Cor', current.color.name);
  summaryRow('Artes', arts.length ? arts.map((layer, index) => (index + 1) + ' · ' + zoneById(layer.zoneId).label + ': ' + layer.art.name + ' · ' + cm(layer.widthCm) + ' × ' + cm(layer.heightCm) + ' cm · ' + artLook(layer)) : ['Sem arte (camiseta lisa)']);
  summaryRow('Tamanhos', groupedSizes(current.quantities) + ' · total de ' + total + (total === 1 ? ' peça' : ' peças'));
  if (current.technique && current.technique !== 'A confirmar') summaryRow('Aplicação', current.technique);
  if (current.customer.name || current.customer.company) summaryRow('Pedido de', [current.customer.name, current.customer.company].filter(Boolean).join(' · '));
  if (current.notes) summaryRow('Aviso', current.notes);
  if (!review.open) { if (review.showModal) review.showModal(); else review.setAttribute('open', ''); }
  review.querySelector('.review-body').scrollTop = 0;
  try {
    await basesReady;
    const shots = [];
    for (const [whichView, label, side] of viewsFor(arts)) {
      const src = await previewImage(whichView, current, side);
      shots.push({ label, src });
      const figure = document.createElement('figure');
      const image = document.createElement('img'); image.src = src; image.alt = label + ' da camiseta com as suas artes';
      const caption = document.createElement('figcaption'); caption.textContent = label;
      figure.append(image, caption); $('review-previews').append(figure);
    }
    reviewFiles = [
      ...shots.map((shot) => dataUrlToFile(shot.src, 'previa-' + shot.label.toLowerCase().replace(/\s+/g, '-') + '.png', 'image/png')),
      ...arts.map((layer, index) => dataUrlToFile(layer.art.dataUrl, (index + 1) + '-' + layer.art.name, layer.art.mime)),
    ];
    if (navigator.canShare?.({ files: reviewFiles })) $('review-share').hidden = false;
  } catch (error) {
    $('review-previews').replaceChildren();
    status('Não foi possível montar as imagens da conferência. O pedido em texto continua valendo.', true);
  } finally { $('review-loading').hidden = true; }
}
$('open-review').addEventListener('click', openReview);
$('review-close').addEventListener('click', () => review.close());
$('review-back').addEventListener('click', () => review.close());
review.addEventListener('click', (event) => { if (event.target === review) review.close(); });
$('review-share').addEventListener('click', async () => {
  try { await navigator.share({ files: reviewFiles, title: 'Pedido de camisetas · Mapra', text: 'Prévia e logos do meu pedido.' }); }
  catch (error) { if (error?.name !== 'AbortError') status('Não foi possível abrir o compartilhamento neste aparelho. Envie as logos pelo WhatsApp, na conversa.', true); }
});

try {
  const saved = localStorage.getItem(STORAGE);
  if (saved) {
    const next = validateCatalogProject(importProject(saved));
    await checkArtImages(next); project = next;
  }
} catch { status('O rascunho anterior não pôde ser recuperado. Você pode abrir um projeto salvo.'); }
// quem vem da capa com uma cor escolhida (…?cor=Vermelho) começa nela
const wantedColor = new URLSearchParams(location.search).get('cor');
const linkedColor = wantedColor && catalog.paleta.find(([name]) => name.toLowerCase() === wantedColor.trim().toLowerCase());
if (linkedColor) project.color = { name: linkedColor[0], hex: linkedColor[1] };
renderAll();
// Quem vem de um cartão do catálogo já viu a foto, o nome e o tecido da peça: cai direto em "Personalize".
// A peça continua logo acima (é só rolar) e quem chega pelo Google vê a página do começo.
if (location.hash === '#personalizar') {
  const target = document.getElementById('personalizar');
  let touched = false;
  for (const type of ['touchstart', 'wheel', 'keydown']) addEventListener(type, () => { touched = true; }, { once: true, passive: true });
  const land = () => {
    if (!target || touched) return;
    const fixed = phoneQuery.matches ? document.querySelector('.preview-panel').offsetHeight : 0;
    scrollTo({ top: Math.max(0, scrollY + target.getBoundingClientRect().top - fixed - 14), behavior: 'instant' });
  };
  land(); addEventListener('load', land, { once: true }); setTimeout(land, 400);
}
try {
  const saved = JSON.parse(localStorage.getItem(ORDER_KEY));
  const pieces = Array.isArray(saved) ? saved.reduce((sum, item) => sum + (parseInt(item?.qtd, 10) || 0), 0) : 0;
  $('order-count').textContent = pieces; $('order-link').hidden = pieces === 0;
} catch { /* sem pedido guardado */ }
window.MapraEditor = { getProject: snapshot };
await basesReady;
