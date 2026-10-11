import { ZONES, zoneActive } from './core.mjs';

export const isSleeve = id => id === 'manga-esquerda' || id === 'manga-direita';
export const viewFor = id => isSleeve(id) ? 'sleeve' : ZONES.find(z => z.id === id)?.view;

// Inclinação das artes de manga: acompanham a barra da manga. Na foto-base a barra corre a cerca de 31° da vertical,
// então a arte gira 59° (a base da arte fica paralela à barra e o topo aponta para o ombro, como com o braço caído).
// Direita/esquerda são sempre de quem veste a peça. A rotação salva na arte é o ajuste adicional sobre este sentido.
export const SLEEVE_ANGLE = 59;
export function fabricAngle(id) {
  if (!isSleeve(id)) return 0;
  return (id === 'manga-esquerda' ? -1 : 1) * SLEEVE_ANGLE;
}

// A aba Manga é só um zoom na mesma foto da frente (nada é recortado): as zonas e as artes usam as mesmas coordenadas.
export function displayZone(zone) { return zone; }
// Janela (viewBox) de cada vista, em unidades da foto de 1000 × 1000.
export function viewBoxFor(view = 'front', side = 'manga-esquerda') {
  if (view !== 'sleeve') return { x: 0, y: 0, w: 1000, h: 1000 };
  return { x: side === 'manga-direita' ? 0 : 660, y: 150, w: 340, h: 340 };
}
export function visibleZones(view, side = 'manga-esquerda', mode = 'sides') {
  return ZONES.filter(z => zoneActive(z.id, mode) && (view === 'sleeve' ? z.id === side : z.view === view));
}
export function geometry(layer, view = layer.view, side = layer.zoneId) {
  const zone = displayZone(ZONES.find(z => z.id === layer.zoneId), view, side);
  const sx = zone.width / zone.cmWidth, sy = zone.height / zone.cmHeight;
  const w = layer.widthCm * sx, h = layer.heightCm * sy;
  const inclination = fabricAngle(layer.zoneId, view);
  const radians = inclination * Math.PI / 180;
  const dx = layer.xCm * sx + w / 2 - zone.width / 2;
  const dy = layer.yCm * sy + h / 2 - zone.height / 2;
  return {
    x: zone.x + zone.width / 2 + dx * Math.cos(radians) - dy * Math.sin(radians) - w / 2,
    y: zone.y + zone.height / 2 + dx * Math.sin(radians) + dy * Math.cos(radians) - h / 2,
    w, h, angle: inclination + layer.angle,
  };
}
export function dyeMatrix(hex) {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const dark = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 < .22;
  // O clareado acompanha a luz da foto, mantendo dobras também no preto.
  const rows = channels.map(c => {
    const factor = dark ? c * .94 + .06 : c;
    return [factor * .2126, factor * .7152, factor * .0722, 0, 0].join(' ');
  });
  return rows.join(' ') + ' 0 0 0 1 0';
}
