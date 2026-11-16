/**
 * Motor de cálculo financiero para Cajitas, CDTs y Fondos de Inversión.
 * Simula día a día para manejar con precisión aportes diarios, semanales o mensuales.
 */

export function horizonToDays(value, unit) {
  const v = Math.max(1, Number(value) || 1);
  if (unit === 'dias') return Math.round(v);
  if (unit === 'anios') return Math.round(v * 365);
  // meses -> 365 / 12 para que 12 meses = 365 días exactos
  return Math.max(1, Math.round((v * 365) / 12));
}

function buildMonthlyContributionDays(totalDays) {
  const days = new Set();
  const maxMonths = Math.ceil((totalDays * 12) / 365) + 1;
  for (let m = 1; m <= maxMonths; m++) {
    const d = Math.round((m * 365) / 12);
    if (d >= 1 && d <= totalDays) days.add(d);
  }
  return days;
}

/**
 * Ejecuta la simulación financiera según la configuración dada.
 * @param {Object} cfg
 * @returns {Object} resumen, serie para gráfico y filas para tabla
 */
export function runProjection(cfg) {
  const instrument = cfg.instrument || 'cajita';
  const initial = Math.max(0, Number(cfg.initial) || 0);
  const rateEA = Math.max(0, Number(cfg.rate) || 0) / 100;
  const baseContrib = cfg.frequency === 'ninguno' ? 0 : Math.max(0, Number(cfg.contribution) || 0);
  const frequency = cfg.frequency || 'mensual';
  const totalDays = horizonToDays(cfg.horizonVal, cfg.horizonUnit);
  const inflationEA = Math.max(0, Number(cfg.inflation) || 0) / 100;
  const contribGrowthEA = Math.max(0, Number(cfg.contribGrowth) || 0) / 100;

  // Tasas específicas por instrumento
  const feeEA = instrument === 'fondo' ? Math.max(0, Number(cfg.feeRate) || 0) / 100 : 0;
  const taxRate =
    instrument === 'cdt'
      ? Math.max(0, Number(cfg.taxRate) || 0) / 100
      : instrument === 'fondo'
      ? Math.max(0, Number(cfg.fondoTax) || 0) / 100
      : 0;

  const cdtTermDays = instrument === 'cdt' ? Math.max(30, Math.round(Number(cfg.cdtTermDays) || 180)) : 0;
  const cdtReinvest = instrument === 'cdt' ? Boolean(cfg.cdtReinvest) : true;

  // Tasa neta anual efectiva después de comisión de administración (para fondos)
  const effectiveAnnualRate = instrument === 'fondo' ? Math.max(-0.99, (1 + rateEA) / (1 + feeEA) - 1) : rateEA;
  const dailyRate = Math.pow(1 + effectiveAnnualRate, 1 / 365) - 1;
  const grossDailyRate = Math.pow(1 + rateEA, 1 / 365) - 1;

  const monthlyContribDays = frequency === 'mensual' ? buildMonthlyContributionDays(totalDays) : null;

  let totalContributions = 0;
  let totalTaxesPaid = 0;
  let totalFeesPaid = 0;

  // Estado para Cajita / Fondo
  let balance = initial;
  let grossBalanceNoFee = initial;

  // Estado para CDT
  let cdtPrincipal = initial;
  let cdtAccruedGross = 0;
  let cdtWaitingPool = 0; // aportes acumulados mientras vence el CDT
  let cdtDaysInTerm = 0;

  const series = [
    {
      day: 0,
      label: 'Inicio',
      initial,
      contributions: 0,
      interest: 0,
      total: initial,
    },
  ];

  // Agregadores mensuales para tabla y serie
  const monthlyRows = [];
  const totalMonths = Math.max(1, Math.ceil((totalDays * 12) / 365));
  let monthStartBalance = initial;
  let monthContrib = 0;
  let monthInterest = 0;
  let nextMonthDay = Math.min(totalDays, Math.round(365 / 12));
  let monthIndex = 1;

  const annualRows = [];
  let yearStartBalance = initial;
  let yearContrib = 0;
  let yearInterest = 0;
  let yearIndex = 1;

  // Para decidir cada cuántos días guardar punto en el gráfico (~60 puntos máx)
  const sampleStep = Math.max(1, Math.floor(totalDays / 60));

  for (let day = 1; day <= totalDays; day++) {
    const yearIdx = Math.floor((day - 1) / 365);
    const currentContribAmount = baseContrib * Math.pow(1 + contribGrowthEA, yearIdx);

    let todayContrib = 0;
    if (baseContrib > 0) {
      if (frequency === 'diario') {
        todayContrib = currentContribAmount;
      } else if (frequency === 'semanal' && day % 7 === 0) {
        todayContrib = currentContribAmount;
      } else if (frequency === 'mensual' && monthlyContribDays.has(day)) {
        todayContrib = currentContribAmount;
      }
    }

    let todayNetInterest = 0;

    if (instrument === 'cdt') {
      // El capital en CDT devenga interés diario compuesto sobre el tramo actual
      const dailyGross = (cdtPrincipal + cdtAccruedGross) * grossDailyRate;
      cdtAccruedGross += dailyGross;
      cdtDaysInTerm += 1;

      if (todayContrib > 0) {
        cdtWaitingPool += todayContrib;
        totalContributions += todayContrib;
      }

      if (cdtDaysInTerm >= cdtTermDays) {
        const tax = cdtAccruedGross * taxRate;
        const netTermInterest = cdtAccruedGross - tax;
        totalTaxesPaid += tax;

        if (cdtReinvest) {
          cdtPrincipal += netTermInterest + cdtWaitingPool;
        } else {
          // Sin reinversión automática: los rendimientos y aportes quedan en caja líquida sin capitalizar
          cdtWaitingPool += netTermInterest;
        }
        cdtAccruedGross = 0;
        cdtDaysInTerm = 0;
      }

      const currentTotal = cdtPrincipal + cdtAccruedGross * (1 - taxRate) + cdtWaitingPool;
      const prevTotal =
        currentTotal - todayContrib - (dailyGross * (1 - taxRate));
      todayNetInterest = dailyGross * (1 - taxRate);
      balance = currentTotal;
      void prevTotal;
    } else {
      // Cajita o Fondo
      if (todayContrib > 0) {
        balance += todayContrib;
        grossBalanceNoFee += todayContrib;
        totalContributions += todayContrib;
      }

      const grossGain = grossBalanceNoFee * grossDailyRate;
      const netGain = balance * dailyRate;
      grossBalanceNoFee += grossGain;
      balance += netGain;

      if (instrument === 'fondo' && feeEA > 0) {
        totalFeesPaid += Math.max(0, grossGain - netGain);
      }

      todayNetInterest = netGain;
    }

    monthContrib += todayContrib;
    monthInterest += todayNetInterest;
    yearContrib += todayContrib;
    yearInterest += todayNetInterest;

    if (day % sampleStep === 0 || day === totalDays) {
      const investedSoFar = initial + totalContributions;
      const netInterestSoFar = Math.max(0, balance - investedSoFar);
      series.push({
        day,
        label: totalDays > 730 ? `Año ${(day / 365).toFixed(1)}` : `Mes ${Math.max(1, Math.round((day * 12) / 365))}`,
        initial,
        contributions: totalContributions,
        interest: netInterestSoFar,
        total: balance,
      });
    }

    if (day === nextMonthDay || day === totalDays) {
      monthlyRows.push({
        period: `Mes ${monthIndex}`,
        startBalance: monthStartBalance,
        contributions: monthContrib,
        interest: monthInterest,
        endBalance: balance,
      });
      monthIndex += 1;
      monthStartBalance = balance;
      monthContrib = 0;
      monthInterest = 0;
      nextMonthDay = Math.min(totalDays, Math.round((monthIndex * 365) / 12));
    }

    if (day % 365 === 0 || day === totalDays) {
      annualRows.push({
        period: `Año ${yearIndex}`,
        startBalance: yearStartBalance,
        contributions: yearContrib,
        interest: yearInterest,
        endBalance: balance,
      });
      yearIndex += 1;
      yearStartBalance = balance;
      yearContrib = 0;
      yearInterest = 0;
    }
  }

  // Impuesto al final para Fondos si el usuario configuró retención
  if (instrument === 'fondo' && taxRate > 0) {
    const grossProfit = Math.max(0, balance - (initial + totalContributions));
    const finalTax = grossProfit * taxRate;
    totalTaxesPaid += finalTax;
    balance -= finalTax;
    if (series.length > 0) {
      const last = series[series.length - 1];
      last.total = balance;
      last.interest = Math.max(0, balance - (initial + totalContributions));
    }
    if (monthlyRows.length > 0) {
      monthlyRows[monthlyRows.length - 1].endBalance = balance;
    }
    if (annualRows.length > 0) {
      annualRows[annualRows.length - 1].endBalance = balance;
    }
  }

  const totalInvested = initial + totalContributions;
  const netInterest = balance - totalInvested;
  const years = totalDays / 365;
  const realValue = inflationEA > 0 ? balance / Math.pow(1 + inflationEA, years) : balance;
  const monthsEquivalent = Math.max(1, totalDays / (365 / 12));
  const avgMonthlyPassive = netInterest / monthsEquivalent;
  const multiplier = totalInvested > 0 ? balance / totalInvested : 1;

  return {
    totalDays,
    totalMonths,
    initial,
    totalContributions,
    totalInvested,
    finalBalance: balance,
    realValue,
    netInterest,
    avgMonthlyPassive,
    multiplier,
    totalTaxesAndFees: totalTaxesPaid + totalFeesPaid,
    series,
    monthlyRows,
    annualRows,
  };
}

/**
 * Evalúa la viabilidad del mercado bursátil (0–100) y calcula retorno/volatilidad
 * esperados y asignación sugerida entre Cajita, CDT y Fondo Bursátil.
 */
export function evaluateMarketViability({
  trend = 'lateral',
  volatility = 'moderada',
  valuation = 'justo',
  liquidity = 'neutral',
  riskFree = 10.5,
  riskProfile = 'moderado',
}) {
  let score = 50;

  if (trend === 'alcista') score += 18;
  else if (trend === 'bajista') score -= 18;

  if (volatility === 'baja') score += 12;
  else if (volatility === 'alta') score -= 16;

  if (valuation === 'barato') score += 14;
  else if (valuation === 'caro') score -= 12;

  if (liquidity === 'expansiva') score += 12;
  else if (liquidity === 'restrictiva') score -= 12;

  // Ajuste por tasa libre de riesgo (si renta fija paga muy alto, reduce atractivo relativo bursátil)
  const rf = Math.max(0, Number(riskFree) || 0);
  if (rf >= 12) score -= 8;
  else if (rf <= 5) score += 6;

  score = Math.max(5, Math.min(98, Math.round(score)));

  // Retorno esperado anualizado (% E.A.) y volatilidad anual (%)
  const baseEquityReturn = rf + 3.5; // prima base histórica
  const scoreAdjust = ((score - 50) / 50) * 6.5; // -6.5% a +6.5%
  const expectedReturnEA = Math.max(2, Number((baseEquityReturn + scoreAdjust).toFixed(2)));

  let annualVolatility = 16;
  if (volatility === 'baja') annualVolatility = 11;
  else if (volatility === 'alta') annualVolatility = 26;
  if (trend === 'bajista') annualVolatility += 3;

  // Régimen
  let regime = 'Viabilidad Moderada';
  let regimeLevel = 'moderado';
  let strategyTag = 'Estrategia Balanceada (DCA + Renta Fija)';
  if (score >= 70) {
    regime = 'Alta Viabilidad';
    regimeLevel = 'alto';
    strategyTag = 'Crecimiento Activo (Sobreponderar Renta Variable)';
  } else if (score < 40) {
    regime = 'Viabilidad Baja / Defensiva';
    regimeLevel = 'bajo';
    strategyTag = 'Preservación de Capital (Priorizar Cajita / CDT)';
  }

  // Asignación sugerida según viabilidad + perfil de riesgo
  const profileBias = riskProfile === 'agresivo' ? 18 : riskProfile === 'conservador' ? -18 : 0;
  const rawEquity = Math.round(Math.max(10, Math.min(85, score * 0.78 + profileBias)));
  const remaining = 100 - rawEquity;
  const cajitaPct = score < 40 ? Math.round(remaining * 0.45) : Math.round(remaining * 0.35);
  const cdtPct = Math.max(0, remaining - cajitaPct);

  const allocation = {
    cajitaPct,
    cdtPct,
    fondoPct: rawEquity,
  };

  let diagnosis = '';
  if (score >= 70) {
    diagnosis = `El mercado presenta condiciones favorables (${score}/100). La tendencia y liquidez respaldan aumentar exposición a fondos bursátiles (${rawEquity}%), manteniendo ${cajitaPct + cdtPct}% en Cajita/CDT como colchón.`;
  } else if (score >= 40) {
    diagnosis = `Entorno mixto (${score}/100). Conviene aplicar aportes periódicos constantes (DCA) para promediar precios en bolsa (${rawEquity}%) mientras aseguras rendimiento estable en CDT/Cajita (${cajitaPct + cdtPct}%).`;
  } else {
    diagnosis = `Señales defensivas (${score}/100) por volatilidad o tendencia débil. Prioriza liquidez en Cajita (${cajitaPct}%) y tasas fijas en CDT (${cdtPct}%), limitando renta variable a ${rawEquity}% para compras escalonadas.`;
  }

  return {
    score,
    regime,
    regimeLevel,
    strategyTag,
    expectedReturnEA,
    annualVolatility,
    equityPremium: Number((expectedReturnEA - rf).toFixed(2)),
    allocation,
    diagnosis,
  };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sortedArr, p) {
  if (!sortedArr.length) return 0;
  const idx = (sortedArr.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
}

/**
 * Simulación Monte Carlo mensual (300 trayectorias) con aportes periódicos
 * comparada contra el benchmark de Renta Fija (Cajita/CDT).
 */
export function runMonteCarloProjection({
  initial = 2000000,
  contribution = 300000,
  frequency = 'mensual',
  horizonYears = 5,
  expectedReturnEA = 12.5,
  annualVolatility = 16,
  riskFreeEA = 10.5,
  runs = 300,
}) {
  const init = Math.max(0, Number(initial) || 0);
  const contrib = frequency === 'ninguno' ? 0 : Math.max(0, Number(contribution) || 0);
  const years = Math.max(1, Math.min(40, Math.round(Number(horizonYears) || 5)));
  const months = years * 12;

  // Equivalente mensual del aporte según frecuencia
  let monthlyContrib = contrib;
  if (frequency === 'diario') monthlyContrib = (contrib * 365) / 12;
  else if (frequency === 'semanal') monthlyContrib = (contrib * 52) / 12;
  else if (frequency === 'ninguno') monthlyContrib = 0;

  const mu = (Number(expectedReturnEA) || 0) / 100;
  const sigma = Math.max(0.01, (Number(annualVolatility) || 15) / 100);
  const rfMonthly = Math.pow(1 + Math.max(0, (Number(riskFreeEA) || 0) / 100), 1 / 12) - 1;

  // Drift log-normal mensual para movimiento browniano geométrico
  const dt = 1 / 12;
  const drift = (Math.log(1 + mu) - 0.5 * sigma * sigma) * dt;
  const volStep = sigma * Math.sqrt(dt);

  const rand = mulberry32(42197 + months * 13 + Math.round(mu * 1000));

  // Matriz de valores por mes [month][run]
  const byMonth = Array.from({ length: months + 1 }, () => []);
  const maxDrawdowns = [];

  // Serie determinística de Renta Fija
  const rfSeries = [init];
  let rfBal = init;
  for (let m = 1; m <= months; m++) {
    rfBal = (rfBal + monthlyContrib) * (1 + rfMonthly);
    rfSeries.push(rfBal);
  }
  const rfFinal = rfSeries[months];

  for (let r = 0; r < runs; r++) {
    let bal = init;
    let peak = init;
    let worstDD = 0;
    byMonth[0].push(bal);

    for (let m = 1; m <= months; m++) {
      // Box-Muller
      const u1 = Math.max(1e-9, rand());
      const u2 = rand();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const growthFactor = Math.exp(drift + volStep * z);

      bal = (bal + monthlyContrib) * growthFactor;
      if (bal > peak) peak = bal;
      if (peak > 0) {
        const dd = (bal - peak) / peak;
        if (dd < worstDD) worstDD = dd;
      }
      byMonth[m].push(bal);
    }
    maxDrawdowns.push(worstDD);
  }

  const series = [];
  for (let m = 0; m <= months; m++) {
    const sorted = [...byMonth[m]].sort((a, b) => a - b);
    series.push({
      month: m,
      label: m === 0 ? 'Inicio' : m % 12 === 0 ? `Año ${m / 12}` : `M${m}`,
      p10: percentile(sorted, 0.1),
      p50: percentile(sorted, 0.5),
      p90: percentile(sorted, 0.9),
      rf: rfSeries[m],
    });
  }

  const finalVals = [...byMonth[months]].sort((a, b) => a - b);
  const beatCount = finalVals.filter((v) => v > rfFinal).length;
  const beatRiskFreeProb = (beatCount / runs) * 100;

  // Cálculo del resultado más probable (Moda por densidad en rango P05–P95)
  const lowBound = percentile(finalVals, 0.05);
  const highBound = percentile(finalVals, 0.95);
  let mostProbableFinal = series[series.length - 1].p50;
  let modeBandPct = 0;

  if (highBound > lowBound) {
    const numBins = 14;
    const binWidth = (highBound - lowBound) / numBins;
    const bins = Array.from({ length: numBins }, () => []);
    finalVals.forEach((v) => {
      if (v >= lowBound && v <= highBound) {
        const idx = Math.min(numBins - 1, Math.floor((v - lowBound) / binWidth));
        bins[idx].push(v);
      }
    });
    let bestBin = bins[0];
    bins.forEach((b) => {
      if (b.length > bestBin.length) bestBin = b;
    });
    if (bestBin.length > 0) {
      mostProbableFinal = bestBin.reduce((s, x) => s + x, 0) / bestBin.length;
      modeBandPct = (bestBin.length / runs) * 100;
    }
  }

  maxDrawdowns.sort((a, b) => a - b);
  const medianMaxDrawdown = percentile(maxDrawdowns, 0.5) * 100;

  const last = series[series.length - 1];
  return {
    months,
    p10Final: last.p10,
    p50Final: last.p50,
    p90Final: last.p90,
    mostProbableFinal,
    modeBandPct,
    rfFinal,
    beatRiskFreeProb,
    medianMaxDrawdown,
    series,
  };
}

/**
 * Calcula el aporte periódico exacto necesario para alcanzar `targetGoal`
 * bajo cualquier instrumento (Cajita, CDT o Fondo) y frecuencia (diario, semanal, mensual).
 */
export function solveRequiredContribution(cfg, targetGoal) {
  const goal = Math.max(0, Number(targetGoal) || 0);
  const freq = cfg.frequency === 'ninguno' ? 'mensual' : cfg.frequency || 'mensual';
  const baseCfg = { ...cfg, frequency: freq };

  const resZero = runProjection({ ...baseCfg, contribution: 0 });
  if (goal <= resZero.finalBalance) {
    return {
      requiredContribution: 0,
      frequency: freq,
      baseFinalWithoutContrib: resZero.finalBalance,
      projection: resZero,
    };
  }

  const probe = 10000;
  const resProbe = runProjection({ ...baseCfg, contribution: probe });
  const deltaPerUnit = (resProbe.finalBalance - resZero.finalBalance) / probe;
  const requiredContribution = deltaPerUnit > 0 ? Math.max(0, (goal - resZero.finalBalance) / deltaPerUnit) : 0;

  const projection = runProjection({ ...baseCfg, contribution: requiredContribution });
  return {
    requiredContribution,
    frequency: freq,
    baseFinalWithoutContrib: resZero.finalBalance,
    projection,
  };
}
