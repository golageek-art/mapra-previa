// Tira o fundo liso de uma logo e, se pedido, pinta a logo de uma cor só. Só para a prévia do configurador:
// o arquivo original nunca é alterado nem descartado (ele vai junto no pedido).
// Funções puras sobre pixels RGBA: não mexem na tela. Quem chama lê os pixels de um canvas e devolve o resultado ao canvas.
//
//   const r = removeSolidBackground(imageData.data, imageData.width, imageData.height, { enclosed: true });
//   if (r.removed) imageData.data.set(r.data);
//
// Só age quando a logo tem um fundo de uma cor só (como branco). Foto, degradê ou logo que já é transparente ficam como estão.

const BORDER_SHARE = 0.85; // quanto da borda precisa ter a mesma cor para valer como "fundo liso"

function distance(data, i, r, g, b) {
  const dr = data[i] - r;
  const dg = data[i + 1] - g;
  const db = data[i + 2] - b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function median(values) {
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * @param {Uint8ClampedArray|Uint8Array} data RGBA, 4 bytes por pixel
 * @param {number} width
 * @param {number} height
 * @param {{tolerance?: number, enclosed?: boolean}} [options]
 *   tolerance: distância de cor (0 a 441) aceita como "mesma cor do fundo".
 *   enclosed: também tira o fundo "de dentro" (o miolo das letras e dos desenhos), não só o que encosta na borda.
 * @returns {{removed: boolean, reason?: string, data: Uint8ClampedArray, background?: number[], removedPixels?: number}}
 */
export function removeSolidBackground(data, width, height, { tolerance = 40, enclosed = false } = {}) {
  const copy = new Uint8ClampedArray(data);
  const total = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || data.length !== total * 4) {
    return { removed: false, reason: 'imagem-invalida', data: copy };
  }

  // já tem transparência de verdade (mais de 2% dos pixels vazados): deixa como está
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) transparent += 1;
  if (transparent / total > 0.02) return { removed: false, reason: 'ja-transparente', data: copy };

  // cor do fundo = cor mais comum da borda; precisa ser quase toda igual
  const border = [];
  for (let x = 0; x < width; x += 1) { border.push(x, (height - 1) * width + x); }
  for (let y = 1; y < height - 1; y += 1) { border.push(y * width, y * width + width - 1); }
  const r = median(border.map(p => data[p * 4]));
  const g = median(border.map(p => data[p * 4 + 1]));
  const b = median(border.map(p => data[p * 4 + 2]));
  const same = border.filter(p => distance(data, p * 4, r, g, b) <= tolerance).length;
  if (same / border.length < BORDER_SHARE) return { removed: false, reason: 'fundo-nao-liso', data: copy };

  // 1) o que está ligado à borda e tem a cor do fundo
  const isBackground = new Uint8Array(total);
  const stack = new Int32Array(total);
  let top = 0;
  const push = p => {
    if (!isBackground[p] && distance(data, p * 4, r, g, b) <= tolerance) { isBackground[p] = 1; stack[top] = p; top += 1; }
  };
  for (const p of border) push(p);
  while (top > 0) {
    top -= 1;
    const p = stack[top];
    const x = p % width;
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (p >= width) push(p - width);
    if (p < total - width) push(p + width);
  }
  // 2) o miolo: pixels da cor do fundo que ficaram presos dentro do desenho (o buraco do "O", do "A", do "P"...)
  if (enclosed) {
    for (let p = 0; p < total; p += 1) {
      if (!isBackground[p] && distance(data, p * 4, r, g, b) <= tolerance) isBackground[p] = 1;
    }
  }

  const touchesBackground = (p, x, y) => {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (isBackground[ny * width + nx]) return true;
      }
    }
    return false;
  };
  const edge = new Uint8Array(total);
  let removedPixels = 0;
  for (let p = 0; p < total; p += 1) {
    if (isBackground[p]) { removedPixels += 1; continue; }
    if (touchesBackground(p, p % width, Math.floor(p / width))) edge[p] = 1;
  }
  if (removedPixels === 0) return { removed: false, reason: 'nada-a-tirar', data: copy };

  // 3) contorno sem halo: o pixel de borda é uma mistura de fundo e logo. Estima a cor da logo pelos vizinhos que não são borda
  //    e descobre quanto do pixel é logo (opacidade) pela distância à cor do fundo. Sem vizinho firme (linha fina), usa uma rampa.
  for (let p = 0; p < total; p += 1) {
    const i = p * 4;
    if (isBackground[p]) { copy[i + 3] = 0; continue; }
    if (!edge[p]) continue;
    const x = p % width, y = Math.floor(p / width);
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const q = ny * width + nx;
        if (isBackground[q] || edge[q]) continue;
        sr += data[q * 4]; sg += data[q * 4 + 1]; sb += data[q * 4 + 2]; n += 1;
      }
    }
    if (n > 0) {
      const fr = sr / n, fg = sg / n, fb = sb / n;
      const vr = fr - r, vg = fg - g, vb = fb - b;
      const span = vr * vr + vg * vg + vb * vb;
      if (span > 100) {
        const t = ((data[i] - r) * vr + (data[i + 1] - g) * vg + (data[i + 2] - b) * vb) / span;
        const alpha = Math.min(1, Math.max(0, t));
        copy[i] = Math.round(fr); copy[i + 1] = Math.round(fg); copy[i + 2] = Math.round(fb);
        copy[i + 3] = Math.round(255 * alpha);
        continue;
      }
    }
    const d = distance(data, i, r, g, b);
    const ramp = Math.min(1, Math.max(0, (d - tolerance) / (tolerance * 1.5)));
    copy[i + 3] = Math.round(copy[i + 3] * (0.35 + 0.65 * ramp));
  }
  return { removed: true, data: copy, background: [r, g, b], removedPixels };
}

/**
 * Pinta a logo de uma cor só, mantendo o desenho (a opacidade de cada pixel). Serve para "toda branca" e "toda preta".
 * @param {Uint8ClampedArray|Uint8Array} data RGBA
 * @param {'original'|'white'|'black'} tint
 */
export function tintArt(data, tint) {
  const copy = new Uint8ClampedArray(data);
  if (tint !== 'white' && tint !== 'black') return copy;
  const value = tint === 'white' ? 255 : 17;
  for (let i = 0; i < copy.length; i += 4) {
    if (copy[i + 3] === 0) continue;
    copy[i] = value; copy[i + 1] = value; copy[i + 2] = value;
  }
  return copy;
}
