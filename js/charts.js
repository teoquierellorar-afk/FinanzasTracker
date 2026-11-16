/**
 * Gráficos ligeros en HTML5 Canvas sin dependencias externas (soporta HiDPI).
 */

function setupCanvas(canvas, logicalW, logicalH) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = logicalW * dpr;
  canvas.height = logicalH * dpr;
  canvas.style.width = `${logicalW}px`;
  canvas.style.height = `${logicalH}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, logicalW, logicalH);
  return { ctx, w: logicalW, h: logicalH };
}

function compactNumber(val) {
  const abs = Math.abs(val);
  if (abs >= 1e9) return `${(val / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(val / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(val / 1e3).toFixed(0)}k`;
  return `${Math.round(val)}`;
}

export function drawDonutChart(canvas, items, formatMoney) {
  const { ctx, w, h } = setupCanvas(canvas, 300, 220);
  const total = items.reduce((acc, it) => acc + it.value, 0);
  const cx = w / 2;
  const cy = h / 2;
  const outerR = 84;
  const innerR = 52;

  if (total <= 0 || items.length === 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2, true);
    ctx.fillStyle = '#1e293b';
    ctx.fill();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Sin datos', cx, cy);
    return;
  }

  let startAngle = -Math.PI / 2;
  items.forEach((item) => {
    const slice = (item.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, startAngle, startAngle + slice);
    ctx.arc(cx, cy, innerR, startAngle + slice, startAngle, true);
    ctx.closePath();
    ctx.fillStyle = item.color || '#6366f1';
    ctx.fill();
    startAngle += slice;
  });

  // Centro
  ctx.fillStyle = '#94a3b8';
  ctx.font = '500 11px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Total', cx, cy - 10);

  ctx.fillStyle = '#eef2ff';
  ctx.font = '700 13px Inter, sans-serif';
  ctx.fillText(formatMoney(total), cx, cy + 9);
}

export function drawMonthlyBarChart(canvas, monthsData) {
  const { ctx, w, h } = setupCanvas(canvas, 400, 220);
  const padL = 46;
  const padR = 12;
  const padT = 16;
  const padB = 34;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  if (!monthsData || monthsData.length === 0) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Sin historial mensual aún', w / 2, h / 2);
    return;
  }

  const maxVal = Math.max(
    1,
    ...monthsData.flatMap((m) => [m.ingresos, m.egresos])
  );

  // Líneas guía horizontales
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
  ctx.fillStyle = '#94a3b8';
  ctx.font = '500 10px Inter, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  for (let i = 0; i <= 4; i++) {
    const y = padT + (chartH * i) / 4;
    const val = maxVal * (1 - i / 4);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.fillText(compactNumber(val), padL - 6, y);
  }

  const groupW = chartW / monthsData.length;
  const barW = Math.min(18, groupW * 0.28);

  monthsData.forEach((m, idx) => {
    const cx = padL + groupW * idx + groupW / 2;

    // Barra Ingresos
    const hIng = (m.ingresos / maxVal) * chartH;
    ctx.fillStyle = '#10b981';
    ctx.fillRect(cx - barW - 2, padT + chartH - hIng, barW, hIng);

    // Barra Egresos
    const hEgr = (m.egresos / maxVal) * chartH;
    ctx.fillStyle = '#f43f5e';
    ctx.fillRect(cx + 2, padT + chartH - hEgr, barW, hEgr);

    // Etiqueta mes
    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 10.5px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(m.label, cx, padT + chartH + 8);
  });
}

export function drawGrowthChart(canvas, series) {
  const { ctx, w, h } = setupCanvas(canvas, 760, 290);
  const padL = 62;
  const padR = 18;
  const padT = 18;
  const padB = 34;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  if (!series || series.length < 2) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Calcula una proyección para ver la curva', w / 2, h / 2);
    return;
  }

  const maxTotal = Math.max(1, ...series.map((s) => s.total));
  const n = series.length;

  // Grid Y
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
  ctx.fillStyle = '#94a3b8';
  ctx.font = '500 11px Inter, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  for (let i = 0; i <= 4; i++) {
    const y = padT + (chartH * i) / 4;
    const val = maxTotal * (1 - i / 4);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.fillText(compactNumber(val), padL - 8, y);
  }

  const xAt = (idx) => padL + (idx / (n - 1)) * chartW;
  const yAt = (val) => padT + chartH - (val / maxTotal) * chartH;

  // Área 3 (Total = Inicial + Aportes + Rendimientos) -> Verde
  ctx.beginPath();
  ctx.moveTo(xAt(0), yAt(0));
  series.forEach((s, i) => ctx.lineTo(xAt(i), yAt(s.total)));
  ctx.lineTo(xAt(n - 1), yAt(0));
  ctx.closePath();
  ctx.fillStyle = 'rgba(16, 185, 129, 0.35)';
  ctx.fill();

  // Área 2 (Inicial + Aportes) -> Azul cielo
  ctx.beginPath();
  ctx.moveTo(xAt(0), yAt(0));
  series.forEach((s, i) => ctx.lineTo(xAt(i), yAt(s.initial + s.contributions)));
  ctx.lineTo(xAt(n - 1), yAt(0));
  ctx.closePath();
  ctx.fillStyle = 'rgba(56, 189, 248, 0.38)';
  ctx.fill();

  // Área 1 (Capital Inicial) -> Índigo
  ctx.beginPath();
  ctx.moveTo(xAt(0), yAt(0));
  series.forEach((s, i) => ctx.lineTo(xAt(i), yAt(s.initial)));
  ctx.lineTo(xAt(n - 1), yAt(0));
  ctx.closePath();
  ctx.fillStyle = 'rgba(99, 102, 241, 0.45)';
  ctx.fill();

  // Línea superior (Saldo total)
  ctx.beginPath();
  series.forEach((s, i) => {
    if (i === 0) ctx.moveTo(xAt(i), yAt(s.total));
    else ctx.lineTo(xAt(i), yAt(s.total));
  });
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Etiquetas X (máximo 6 marcas)
  const ticks = Math.min(6, n);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '500 10.5px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let t = 0; t < ticks; t++) {
    const idx = Math.round((t * (n - 1)) / (ticks - 1));
    ctx.fillText(series[idx].label, xAt(idx), padT + chartH + 8);
  }
}

export function drawMonteCarloChart(canvas, series, mostProbableFinal = null) {
  const { ctx, w, h } = setupCanvas(canvas, 760, 290);
  const padL = 62;
  const padR = 26;
  const padT = 18;
  const padB = 34;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  if (!series || series.length < 2) return;

  const maxVal = Math.max(1, ...series.map((s) => Math.max(s.p90, s.rf)), mostProbableFinal || 0);
  const n = series.length;

  // Grid Y
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
  ctx.fillStyle = '#94a3b8';
  ctx.font = '500 11px Inter, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  for (let i = 0; i <= 4; i++) {
    const y = padT + (chartH * i) / 4;
    const val = maxVal * (1 - i / 4);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.fillText(compactNumber(val), padL - 8, y);
  }

  const xAt = (idx) => padL + (idx / (n - 1)) * chartW;
  const yAt = (val) => padT + chartH - (val / maxVal) * chartH;

  // Banda P10 - P90
  ctx.beginPath();
  series.forEach((s, i) => {
    if (i === 0) ctx.moveTo(xAt(i), yAt(s.p90));
    else ctx.lineTo(xAt(i), yAt(s.p90));
  });
  for (let i = n - 1; i >= 0; i--) {
    ctx.lineTo(xAt(i), yAt(series[i].p10));
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
  ctx.fill();

  // Línea Renta Fija Benchmark (punteada ámbar)
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  series.forEach((s, i) => {
    if (i === 0) ctx.moveTo(xAt(i), yAt(s.rf));
    else ctx.lineTo(xAt(i), yAt(s.rf));
  });
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // Línea P50 Mediana (verde sólida)
  ctx.beginPath();
  series.forEach((s, i) => {
    if (i === 0) ctx.moveTo(xAt(i), yAt(s.p50));
    else ctx.lineTo(xAt(i), yAt(s.p50));
  });
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Marcador de Resultado Más Probable (Moda)
  if (mostProbableFinal !== null && Number.isFinite(mostProbableFinal)) {
    const mx = xAt(n - 1);
    const my = yAt(mostProbableFinal);
    ctx.beginPath();
    ctx.arc(mx, my, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = '#a855f7';
    ctx.fill();
    ctx.strokeStyle = '#eef2ff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Etiquetas X
  const ticks = Math.min(6, n);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '500 10.5px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let t = 0; t < ticks; t++) {
    const idx = Math.round((t * (n - 1)) / (ticks - 1));
    ctx.fillText(series[idx].label, xAt(idx), padT + chartH + 8);
  }
}
