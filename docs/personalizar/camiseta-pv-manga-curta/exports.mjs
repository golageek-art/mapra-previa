import { ZONES, quantityTotal, validateProject, importProject, activeLayers } from './core.mjs';

export const MAX_PROJECT_BYTES = 20 * 1024 * 1024;
const PROVISIONAL_NOTICE = 'Prévia para conferência — medidas e áreas provisórias. Aguardar validação da Mapra antes de produzir';

function assertValidProject(project, requireQuantity) {
  const errors = validateProject(project, { requireQuantity });
  if (errors.length) throw new Error(`Não foi possível exportar: ${errors.join(' ')}`);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function safeFilename(value, fallback = 'pedido') {
  const name = String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '').slice(0, 90);
  return name || fallback;
}

function validImageDataUrl(value, expectedMime) {
  if (typeof value !== 'string') return false;
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || (expectedMime && match[1] !== expectedMime) || match[2].length % 4 !== 0) return false;
  try {
    const header = atob(match[2].slice(0, 24));
    if (match[1] === 'image/png') return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header.charCodeAt(index) === byte);
    if (match[1] === 'image/jpeg') return header.charCodeAt(0) === 255 && header.charCodeAt(1) === 216 && header.charCodeAt(2) === 255;
    return header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP';
  } catch {
    return false;
  }
}

function assertValidImages(project) {
  for (const layer of project.layers) {
    if (!validImageDataUrl(layer.art.dataUrl, layer.art.mime)) {
      throw new Error(`A arte “${layer.art.name}” precisa ser uma imagem PNG, JPEG ou WebP válida.`);
    }
  }
}

function download(content, mime, filename) {
  if (typeof document === 'undefined') throw new Error('Abra o configurador no navegador para baixar o arquivo.');
  const objectUrl = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
}

/** Salva o rascunho com todas as artes incorporadas, mesmo antes de preencher a grade. */
export function saveProject(project) {
  assertValidProject(project, false);
  assertValidImages(project);
  const json = JSON.stringify(project, null, 2);
  if (new TextEncoder().encode(json).byteLength > MAX_PROJECT_BYTES) {
    throw new Error('O projeto ultrapassou 20 MB. Reduza o tamanho dos arquivos de arte antes de salvar.');
  }
  download(json, 'application/json;charset=utf-8', `mapra-${safeFilename(project.id)}.mapra.json`);
}

/** Importação local; os dados passam pela validação e sanitização do núcleo. */
export async function readProject(file) {
  if (!file || typeof file.text !== 'function' || !Number.isFinite(file.size) || file.size < 0) {
    throw new Error('Escolha um arquivo de projeto .mapra.json.');
  }
  if (file.size > MAX_PROJECT_BYTES) throw new Error('O arquivo de projeto deve ter no máximo 20 MB.');
  const text = await file.text();
  if (new TextEncoder().encode(text).byteLength > MAX_PROJECT_BYTES) {
    throw new Error('O arquivo de projeto deve ter no máximo 20 MB.');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('O arquivo não contém um projeto JSON válido.');
  }
  const project = importProject(parsed);
  assertValidImages(project);
  return project;
}

function number(value) {
  return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return escapeHtml(date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }));
}

function detail(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || 'Não informado')}</dd></div>`;
}

function gradeRows(quantities) {
  return Object.entries(quantities).filter(([, quantity]) => quantity > 0).map(([key, quantity]) => {
    const lastSpace = key.lastIndexOf(' ');
    const model = lastSpace > 0 ? key.slice(0, lastSpace) : key;
    const size = lastSpace > 0 ? key.slice(lastSpace + 1) : '—';
    return `<tr><td>${escapeHtml(model)}</td><td>${escapeHtml(size)}</td><td class="numeric">${number(quantity)}</td></tr>`;
  }).join('');
}

const BACKGROUND_TEXT = { all: 'Fundo e miolos tirados', outer: 'Só o fundo de fora tirado', keep: 'Fundo mantido como enviado' };
const TINT_TEXT = { original: 'cores da logo', white: 'toda branca', black: 'toda preta' };
function artTreatment(layer) {
  const mode = layer.backgroundMode || (layer.removeBackground === false ? 'keep' : 'all');
  return (BACKGROUND_TEXT[mode] || BACKGROUND_TEXT.all) + ' · ' + (TINT_TEXT[layer.tint] || TINT_TEXT.original);
}
function applicationRows(layers) {
  if (!layers.length) return '<tr><td colspan="7">Sem aplicações de arte neste pedido.</td></tr>';
  return layers.map((layer, index) => {
    const zone = ZONES.find((entry) => entry.id === layer.zoneId);
    return `<tr><td>${index + 1}</td><td>${escapeHtml(layer.art.name)}</td><td>${layer.view === 'front' ? 'Frente' : 'Costas'}<br>${escapeHtml(zone.label)}</td><td>${number(layer.widthCm)} × ${number(layer.heightCm)} cm</td><td>X: ${number(layer.xCm)} cm<br>Y: ${number(layer.yCm)} cm</td><td>${number(layer.angle)}°</td><td>${layer.art.pixelWidth} × ${layer.art.pixelHeight} px</td><td>${escapeHtml(artTreatment(layer))}</td></tr>`;
  }).join('');
}

function originalArtCards(layers) {
  if (!layers.length) return '<p>Nenhum arquivo de arte anexado.</p>';
  return layers.map((layer, index) => {
    const zone = ZONES.find((entry) => entry.id === layer.zoneId);
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[layer.art.mime];
    const baseName = safeFilename(layer.art.name.replace(/\.[^.]+$/, ''), `arte-${index + 1}`);
    return `<article class="art-card"><div class="art-thumbnail"><img src="${escapeHtml(layer.art.dataUrl)}" alt="Miniatura da arte ${index + 1}" /></div><div><strong>${index + 1}. ${escapeHtml(layer.art.name)}</strong><p>${escapeHtml(zone.label)} · ${layer.view === 'front' ? 'Frente' : 'Costas'}</p><a href="${escapeHtml(layer.art.dataUrl)}" download="${escapeHtml(`${index + 1}-${baseName}.${extension}`)}">Baixar arquivo original</a></div></article>`;
  }).join('');
}

/** Gera uma ficha autossuficiente, sem scripts ou recursos externos. */
export function buildSheet(project, previews) {
  assertValidProject(project, true);
  assertValidImages(project);
  project = { ...project, layers: activeLayers(project) };
  if (!validImageDataUrl(previews?.front, 'image/png') || !validImageDataUrl(previews?.back, 'image/png')) {
    throw new Error('Gere as prévias PNG da frente e das costas antes de baixar a ficha.');
  }
  const sleeves = ['sleeveLeft', 'sleeveRight'].map((key, index) => {
    if (previews[key] === undefined) return '';
    if (!validImageDataUrl(previews[key], 'image/png')) throw new Error('Gere as prévias PNG das mangas antes de baixar a ficha.');
    const label = index === 0 ? 'Manga esquerda' : 'Manga direita';
    return `<figure><img src="${escapeHtml(previews[key])}" alt="${label} com as aplicações" /><figcaption>${label}</figcaption></figure>`;
  }).join('');
  const total = quantityTotal(project.quantities);
  const minimumNotice = total < 10
    ? '<p class="minimum">Pedido abaixo do mínimo de 10 peças informado no site. Quantidade e condições precisam ser conferidas pela Mapra.</p>'
    : '';
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" />
<title>Ficha de conferência Mapra — ${escapeHtml(project.id)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#eeefed;color:#20211f;font:14px/1.5 Arial,sans-serif}.sheet{max-width:1000px;margin:28px auto;padding:36px;background:#fff}h1{margin:0;font-size:26px}h2{margin:26px 0 12px;font-size:18px}p{margin:6px 0}.eyebrow{margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase}.header{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;border-bottom:3px solid #20211f;padding-bottom:18px}.meta{text-align:right;font-size:12px}.notice{padding:14px 16px;margin:20px 0;background:#fff3c5;border:1px solid #e0bd37;font-weight:700}.minimum{padding:10px 14px;border:1px solid #e0bd37;background:#fff9e5}.details{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:15px;margin:20px 0}.details div{min-width:0}dt{font-size:11px;color:#64665e;text-transform:uppercase;letter-spacing:.6px}dd{margin:3px 0 0;font-weight:600;overflow-wrap:anywhere}.swatch{display:inline-block;width:14px;height:14px;border:1px solid #ccc;vertical-align:middle;margin-right:6px}.previews{display:grid;grid-template-columns:1fr 1fr;gap:18px}.previews figure{margin:0;border:1px solid #ddd;border-radius:8px;overflow:hidden}.previews img{display:block;width:100%;height:auto}.previews figcaption{padding:8px 12px;border-top:1px solid #ddd;font-weight:700}.caption{font-size:12px;color:#666;margin-top:8px}table{width:100%;border-collapse:collapse;table-layout:auto}th,td{padding:9px 10px;text-align:left;border-bottom:1px solid #ddd;vertical-align:top;overflow-wrap:anywhere}th{background:#f2f3ef;font-size:12px}td{font-size:12px}.numeric{text-align:right}.grade{max-width:520px}.total{font-weight:700}.applications th:nth-child(1){width:30px}.applications th:nth-child(2){width:22%}.originals{display:grid;grid-template-columns:1fr 1fr;gap:12px}.art-card{display:flex;gap:12px;padding:12px;border:1px solid #ddd;min-width:0;break-inside:avoid}.art-thumbnail{width:75px;height:75px;flex-shrink:0;background:repeating-conic-gradient(#eee 0% 25%,#fff 0% 50%) 0/12px 12px}.art-thumbnail img{width:100%;height:100%;object-fit:contain}.art-card strong,.art-card a{overflow-wrap:anywhere}.art-card p{font-size:12px;color:#666}a{color:#20211f;text-decoration:underline}.notes{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #ddd;padding:14px}.footer{border-top:1px solid #ddd;margin-top:24px;padding-top:14px;font-size:11px;color:#666}.print-help{font-size:12px;color:#666;margin-bottom:18px}@media(max-width:640px){.sheet{margin:0;padding:20px}.header{display:block}.meta{text-align:left;margin-top:12px}.details{grid-template-columns:1fr 1fr}.previews,.originals{grid-template-columns:1fr}.applications{font-size:11px}th,td{padding:6px}}@page{size:A4;margin:12mm}@media print{body{background:#fff}.sheet{margin:0;padding:0;max-width:none}.print-help{display:none}.notice,.minimum,th{-webkit-print-color-adjust:exact;print-color-adjust:exact}.previews figure,.art-card,.details,.notice{break-inside:avoid}thead{display:table-header-group}tr{break-inside:avoid}.art-card a{font-size:11px}.footer{margin-top:16px}}
</style></head><body><main class="sheet">
<p class="print-help">Ficha local com as artes incorporadas. Para imprimir ou salvar em PDF, use a opção Imprimir do navegador (Ctrl+P).</p>
<header class="header"><div><p class="eyebrow">Mapra Uniformes · Configurador 2D</p><h1>Ficha de conferência</h1></div><div class="meta"><strong>Projeto ${escapeHtml(project.id)}</strong><p>Criado em ${formatDate(project.createdAt)}</p><p>Rascunho · produção pendente de validação</p></div></header>
<p class="notice">${PROVISIONAL_NOTICE}</p>${minimumNotice}
<dl class="details">${detail('Cliente', project.customer?.name)}${detail('Empresa', project.customer?.company)}${detail('Produto', project.product.name)}${detail('Tecido', project.product.fabric)}<div><dt>Cor escolhida</dt><dd><span class="swatch" style="background:${escapeHtml(project.color.hex)}"></span>${escapeHtml(project.color.name)} · ${escapeHtml(project.color.hex)}</dd></div>${detail('Técnica solicitada', project.technique || 'A confirmar pela Mapra')}</dl>
<p class="caption">A técnica de aplicação e a fidelidade da cor devem ser confirmadas pela Mapra. A visualização na tela é uma simulação.</p>
<h2>Visualização das aplicações</h2><section class="previews"><figure><img src="${escapeHtml(previews.front)}" alt="Frente da camiseta com as aplicações" /><figcaption>Frente</figcaption></figure><figure><img src="${escapeHtml(previews.back)}" alt="Costas da camiseta com as aplicações" /><figcaption>Costas</figcaption></figure>${sleeves}</section>
<p class="caption">${escapeHtml(project.calibration?.note || 'Medidas e áreas provisórias, ainda sem calibração física da peça.')}</p>
<h2>Grade de tamanhos</h2><table class="grade"><thead><tr><th>Modelagem</th><th>Tamanho</th><th class="numeric">Quantidade</th></tr></thead><tbody>${gradeRows(project.quantities)}<tr class="total"><td colspan="2">Total de peças</td><td class="numeric">${number(total)}</td></tr></tbody></table>
<h2>Aplicações e medidas provisórias</h2><table class="applications"><thead><tr><th>#</th><th>Arquivo</th><th>Vista / região</th><th>Largura × altura</th><th>Posição na região</th><th>Giro</th><th>Imagem original</th><th>Fundo e cor (só na prévia)</th></tr></thead><tbody>${applicationRows(project.layers)}</tbody></table>
<p class="caption">X e Y indicam o deslocamento do canto superior esquerdo da arte a partir do canto superior esquerdo da região selecionada, antes do giro. O giro ocorre no centro da arte. A localização física, os limites e todas as medidas precisam ser validados na peça real.</p>
<h2>Arquivos originais de arte</h2><section class="originals">${originalArtCards(project.layers)}</section>
<h2>Observações</h2><div class="notes">${escapeHtml(project.notes || 'Sem observações.')}</div>
<footer class="footer">${PROVISIONAL_NOTICE}. Esta ficha não constitui aprovação de produção. Confira arte original, técnica, cor, grade e posicionamento com a Mapra.</footer>
</main></body></html>`;
}

export function exportSheet(project, previews) {
  const html = buildSheet(project, previews);
  download(html, 'text/html;charset=utf-8', `mapra-ficha-${safeFilename(project.id)}.html`);
}
