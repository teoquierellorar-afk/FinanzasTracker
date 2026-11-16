import { runProjection, solveRequiredContribution, evaluateMarketViability, runMonteCarloProjection } from './finance.js';
import { drawDonutChart, drawMonthlyBarChart, drawGrowthChart, drawMonteCarloChart } from './charts.js';

const STORAGE_KEY = 'finanzasflow_v1';

const DEFAULT_CATEGORIES = [
  { id: 'cat_sal', name: 'Salario', type: 'ingreso', icon: '💼', color: '#10b981', builtin: true },
  { id: 'cat_fre', name: 'Freelance', type: 'ingreso', icon: '💻', color: '#38bdf8', builtin: true },
  { id: 'cat_ren', name: 'Rendimientos', type: 'ingreso', icon: '📈', color: '#a855f7', builtin: true },
  { id: 'cat_oin', name: 'Otros Ingresos', type: 'ingreso', icon: '✨', color: '#22c55e', builtin: true },

  { id: 'cat_ali', name: 'Alimentación', type: 'egreso', icon: '🛒', color: '#f59e0b', builtin: true },
  { id: 'cat_viv', name: 'Vivienda', type: 'egreso', icon: '🏠', color: '#6366f1', builtin: true },
  { id: 'cat_tra', name: 'Transporte', type: 'egreso', icon: '🚌', color: '#06b6d4', builtin: true },
  { id: 'cat_ser', name: 'Servicios', type: 'egreso', icon: '💡', color: '#ec4899', builtin: true },
  { id: 'cat_oci', name: 'Ocio', type: 'egreso', icon: '🎬', color: '#f43f5e', builtin: true },
  { id: 'cat_salu', name: 'Salud', type: 'egreso', icon: '🩺', color: '#14b8a6', builtin: true },
  { id: 'cat_edu', name: 'Educación', type: 'egreso', icon: '📚', color: '#8b5cf6', builtin: true },
  { id: 'cat_inv', name: 'Ahorro / Inversión', type: 'egreso', icon: '🪙', color: '#3b82f6', builtin: true },
  { id: 'cat_oec', name: 'Otros Egresos', type: 'egreso', icon: '📦', color: '#64748b', builtin: true },
];

const DEFAULT_ACCOUNTS = [
  { id: 'acc_efe', name: 'Efectivo', icon: '💵', color: '#2d6a4f', initial: 0, builtin: true },
  { id: 'acc_neq', name: 'Nequi', icon: '📱', color: '#7c3aed', initial: 0, builtin: false },
  { id: 'acc_dav', name: 'Daviplata', icon: '🔴', color: '#e11d48', initial: 0, builtin: false },
  { id: 'acc_ban', name: 'Cuenta Bancaria', icon: '🏦', color: '#0284c7', initial: 0, builtin: false },
];

const CURRENCY_LOCALES = {
  COP: { locale: 'es-CO', decimals: 0 },
  USD: { locale: 'en-US', decimals: 2 },
  MXN: { locale: 'es-MX', decimals: 2 },
  EUR: { locale: 'es-ES', decimals: 2 },
};

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        currency: parsed.currency || 'COP',
        categories: Array.isArray(parsed.categories) && parsed.categories.length ? parsed.categories : [...DEFAULT_CATEGORIES],
        accounts: Array.isArray(parsed.accounts) && parsed.accounts.length ? parsed.accounts : [...DEFAULT_ACCOUNTS],
        transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
        recurring: Array.isArray(parsed.recurring) ? parsed.recurring : [],
        scenarios: Array.isArray(parsed.scenarios) ? parsed.scenarios : [],
      };
    }
  } catch (e) {
    console.warn('Error leyendo localStorage:', e);
  }
  return {
    currency: 'COP',
    categories: [...DEFAULT_CATEGORIES],
    accounts: [...DEFAULT_ACCOUNTS],
    transactions: [],
    recurring: [],
    scenarios: [],
  };
}

let state = loadState();
let currentTxType = 'egreso';
let lastProjectionResult = null;

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignorar errores de cuota o modo privado en Safari
  }
}

function formatMoney(value) {
  const cfg = CURRENCY_LOCALES[state.currency] || CURRENCY_LOCALES.COP;
  return new Intl.NumberFormat(cfg.locale, {
    style: 'currency',
    currency: state.currency,
    minimumFractionDigits: cfg.decimals,
    maximumFractionDigits: cfg.decimals,
  }).format(Number(value) || 0);
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => el.classList.add('hidden'), 2800);
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ==================== NAVEGACIÓN TABS ==================== */
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach((b) => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-selected', String(b === btn));
    });
    document.querySelectorAll('.tab-panel').forEach((p) => {
      p.classList.toggle('active', p.id === `tab-${target}`);
    });
    if (target === 'proyector') computeAndRenderProjection();
    if (target === 'comparador') renderComparator();
    if (target === 'tracker') renderTracker();
    if (target === 'predictor') renderPredictor();
  });
});

/* ==================== MONEDA & RESPALDO ==================== */
const currencySelect = document.getElementById('currencySelect');
currencySelect.value = state.currency;
currencySelect.addEventListener('change', () => {
  state.currency = currencySelect.value;
  saveState();
  renderAccounts();
  renderTracker();
  computeAndRenderProjection();
  renderComparator();
  renderPredictor();
});

document.getElementById('btnExportJson').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `finanzasflow-respaldo-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Respaldo JSON exportado');
});

document.getElementById('inputImportJson').addEventListener('change', (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      if (!Array.isArray(data.transactions) || !Array.isArray(data.categories)) {
        throw new Error('Formato inválido');
      }
      state = {
        currency: data.currency || 'COP',
        categories: data.categories,
        accounts: Array.isArray(data.accounts) && data.accounts.length ? data.accounts : [...DEFAULT_ACCOUNTS],
        transactions: data.transactions,
        recurring: Array.isArray(data.recurring) ? data.recurring : [],
        scenarios: Array.isArray(data.scenarios) ? data.scenarios : [],
      };
      currencySelect.value = state.currency;
      saveState();
      renderAll();
      showToast('Datos importados correctamente');
    } catch {
      showToast('No se pudo importar el archivo JSON');
    }
  };
  reader.readAsText(file);
  ev.target.value = '';
});

document.getElementById('btnLoadDemo').addEventListener('click', () => {
  const now = new Date();
  const ym = (offsetMonths) => {
    const d = new Date(now.getFullYear(), now.getMonth() - offsetMonths, 15);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  state.transactions = [
    { id: uid('tx'), type: 'ingreso', amount: 4800000, date: `${ym(0)}-01`, categoryId: 'cat_sal', accountId: 'acc_ban', note: 'Salario mensual' },
    { id: uid('tx'), type: 'ingreso', amount: 850000, date: `${ym(0)}-10`, categoryId: 'cat_fre', accountId: 'acc_neq', note: 'Proyecto freelance web' },
    { id: uid('tx'), type: 'egreso', amount: 1350000, date: `${ym(0)}-02`, categoryId: 'cat_viv', accountId: 'acc_ban', note: 'Arriendo apartamento' },
    { id: uid('tx'), type: 'egreso', amount: 620000, date: `${ym(0)}-05`, categoryId: 'cat_ali', accountId: 'acc_neq', note: 'Mercado quincenal' },
    { id: uid('tx'), type: 'egreso', amount: 240000, date: `${ym(0)}-06`, categoryId: 'cat_ser', accountId: 'acc_dav', note: 'Energía, agua e internet' },
    { id: uid('tx'), type: 'egreso', amount: 180000, date: `${ym(0)}-08`, categoryId: 'cat_tra', accountId: 'acc_efe', note: 'Transporte y gasolina' },
    { id: uid('tx'), type: 'egreso', amount: 290000, date: `${ym(0)}-12`, categoryId: 'cat_oci', accountId: 'acc_neq', note: 'Salidas y streaming' },
    { id: uid('tx'), type: 'egreso', amount: 1000000, date: `${ym(0)}-14`, categoryId: 'cat_inv', accountId: 'acc_ban', note: 'Aporte a Cajita Nu' },

    { id: uid('tx'), type: 'ingreso', amount: 4800000, date: `${ym(1)}-01`, categoryId: 'cat_sal', accountId: 'acc_ban', note: 'Salario mensual' },
    { id: uid('tx'), type: 'egreso', amount: 1350000, date: `${ym(1)}-02`, categoryId: 'cat_viv', accountId: 'acc_ban', note: 'Arriendo' },
    { id: uid('tx'), type: 'egreso', amount: 710000, date: `${ym(1)}-07`, categoryId: 'cat_ali', accountId: 'acc_dav', note: 'Supermercado' },
    { id: uid('tx'), type: 'egreso', amount: 230000, date: `${ym(1)}-09`, categoryId: 'cat_ser', accountId: 'acc_neq', note: 'Servicios públicos' },
    { id: uid('tx'), type: 'egreso', amount: 900000, date: `${ym(1)}-15`, categoryId: 'cat_inv', accountId: 'acc_ban', note: 'Ahorro CDT' },

    { id: uid('tx'), type: 'ingreso', amount: 4800000, date: `${ym(2)}-01`, categoryId: 'cat_sal', accountId: 'acc_ban', note: 'Salario mensual' },
    { id: uid('tx'), type: 'egreso', amount: 1350000, date: `${ym(2)}-02`, categoryId: 'cat_viv', accountId: 'acc_ban', note: 'Arriendo' },
    { id: uid('tx'), type: 'egreso', amount: 650000, date: `${ym(2)}-11`, categoryId: 'cat_ali', accountId: 'acc_efe', note: 'Mercado' },
    { id: uid('tx'), type: 'egreso', amount: 310000, date: `${ym(2)}-18`, categoryId: 'cat_salu', accountId: 'acc_dav', note: 'Odontología' },
    { id: uid('tx'), type: 'transferencia', amount: 650000, date: `${ym(0)}-03`, accountId: 'acc_ban', toAccountId: 'acc_neq', note: 'Recarga Nequi mes' },
  ];

  // Presupuestos demo en categorías
  state.categories.forEach((c) => {
    if (c.id === 'cat_ali') c.budget = 800000;
    if (c.id === 'cat_oci') c.budget = 350000;
    if (c.id === 'cat_ser') c.budget = 300000;
  });

  state.recurring = [
    { id: uid('rec'), type: 'ingreso', amount: 4800000, categoryId: 'cat_sal', accountId: 'acc_ban', note: 'Salario mensual', lastAppliedMonth: ym(0) },
    { id: uid('rec'), type: 'egreso', amount: 1350000, categoryId: 'cat_viv', accountId: 'acc_ban', note: 'Arriendo apartamento', lastAppliedMonth: ym(0) },
    { id: uid('rec'), type: 'egreso', amount: 55000, categoryId: 'cat_oci', accountId: 'acc_neq', note: 'Suscripciones streaming', lastAppliedMonth: ym(1) },
  ];

  saveState();
  renderAccounts();
  renderTracker();
  showToast('Datos de ejemplo cargados');
});

/* ==================== TRACKER DE INGRESOS Y EGRESOS ==================== */
const txForm = document.getElementById('txForm');
const txDateInput = document.getElementById('txDate');
txDateInput.value = todayISO();

function setTxTypeUI(type) {
  currentTxType = type;
  document.querySelectorAll('#txForm .type-btn').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
  const isTransfer = type === 'transferencia';
  document.getElementById('txCatRow').classList.toggle('hidden', isTransfer);
  document.getElementById('txCategory').required = !isTransfer;
  document.getElementById('txToAccountRow').classList.toggle('hidden', !isTransfer);
  document.getElementById('txAccountLabel').textContent = isTransfer ? 'Cuenta origen' : 'Cuenta';
  document.getElementById('txRecurringRow').classList.toggle('hidden', isTransfer);
  if (!isTransfer) populateTxCategorySelect();
}

document.querySelectorAll('#txForm .type-btn').forEach((btn) => {
  btn.addEventListener('click', () => setTxTypeUI(btn.dataset.type));
});

function populateTxCategorySelect(selectedId = null) {
  const select = document.getElementById('txCategory');
  const cats = state.categories.filter((c) => c.type === currentTxType);
  select.innerHTML = cats
    .map((c) => `<option value="${c.id}">${c.icon} ${c.name}</option>`)
    .join('');
  if (selectedId && cats.some((c) => c.id === selectedId)) {
    select.value = selectedId;
  }

  const filterCat = document.getElementById('filterTxCategory');
  const prevFilter = filterCat.value;
  filterCat.innerHTML =
    `<option value="all">Todas las categorías</option>` +
    state.categories.map((c) => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('');
  if ([...filterCat.options].some((o) => o.value === prevFilter)) {
    filterCat.value = prevFilter;
  }

  const budgetCat = document.getElementById('budgetCatSelect');
  if (budgetCat) {
    const prevBud = budgetCat.value;
    budgetCat.innerHTML = state.categories
      .filter((c) => c.type === 'egreso')
      .map((c) => `<option value="${c.id}">${c.icon} ${c.name}</option>`)
      .join('');
    if ([...budgetCat.options].some((o) => o.value === prevBud)) {
      budgetCat.value = prevBud;
    }
  }
}

txForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const editId = document.getElementById('txId').value;
  const amount = Number(document.getElementById('txAmount').value);
  const date = document.getElementById('txDate').value;
  const categoryId = document.getElementById('txCategory').value;
  const accountId = document.getElementById('txAccount').value;
  const toAccountId = document.getElementById('txToAccount').value;
  const note = document.getElementById('txNote').value.trim();
  const isRecurring = document.getElementById('txRecurring').checked;

  if (!(amount > 0) || !date || !accountId) return;
  if (currentTxType === 'transferencia') {
    if (!toAccountId || toAccountId === accountId) {
      showToast('Elige una cuenta destino distinta a la cuenta origen');
      return;
    }
  } else if (!categoryId) {
    return;
  }

  const payload =
    currentTxType === 'transferencia'
      ? { type: 'transferencia', amount, date, accountId, toAccountId, note }
      : { type: currentTxType, amount, date, categoryId, accountId, note };

  if (editId) {
    const idx = state.transactions.findIndex((t) => t.id === editId);
    if (idx !== -1) {
      state.transactions[idx] = { id: editId, ...payload };
    }
    resetTxForm();
    showToast('Movimiento actualizado');
  } else {
    state.transactions.push({ id: uid('tx'), ...payload });
    if (isRecurring && currentTxType !== 'transferencia') {
      state.recurring.push({
        id: uid('rec'),
        type: currentTxType,
        amount,
        categoryId,
        accountId,
        note: note || getCategoryById(categoryId).name,
        lastAppliedMonth: date.slice(0, 7),
      });
    }
    document.getElementById('txAmount').value = '';
    document.getElementById('txNote').value = '';
    document.getElementById('txRecurring').checked = false;
    showToast(isRecurring ? 'Movimiento registrado y guardado como fijo' : 'Movimiento registrado');
  }

  saveState();
  renderAccounts();
  renderRecurring();
  renderTracker();
  closeTxSheet();
});

function resetTxForm() {
  document.getElementById('txId').value = '';
  document.getElementById('txAmount').value = '';
  document.getElementById('txNote').value = '';
  document.getElementById('txDate').value = todayISO();
  document.getElementById('txRecurring').checked = false;
  document.getElementById('formTxTitle').textContent = 'Registrar Movimiento';
  document.getElementById('btnSaveTx').textContent = 'Guardar Movimiento';
  document.getElementById('btnCancelEditTx').classList.add('hidden');
  setTxTypeUI('egreso');
}

document.getElementById('btnCancelEditTx').addEventListener('click', resetTxForm);

// Categorías CRUD
document.getElementById('btnToggleCatForm').addEventListener('click', () => {
  document.getElementById('catForm').classList.toggle('hidden');
});

document.getElementById('catForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('catName').value.trim();
  const type = document.getElementById('catType').value;
  const budget = Math.max(0, Number(document.getElementById('catBudget').value) || 0);
  const icon = document.getElementById('catIcon').value.trim() || '🏷️';
  const color = document.getElementById('catColor').value || '#1b4332';
  if (!name) return;

  state.categories.push({ id: uid('cat'), name, type, budget, icon, color, builtin: false });
  saveState();
  document.getElementById('catName').value = '';
  document.getElementById('catBudget').value = '';
  document.getElementById('catForm').classList.add('hidden');
  renderCategories();
  populateTxCategorySelect();
  renderTracker();
  showToast(`Categoría "${name}" creada`);
});

function renderCategories() {
  const wrap = document.getElementById('categoryChips');
  wrap.innerHTML = state.categories
    .map(
      (c) => `
      <span class="cat-chip">
        <span class="cat-dot" style="background:${c.color}"></span>
        <span>${c.icon} ${c.name}</span>
        <span class="cat-type-tag ${c.type}">${c.type === 'ingreso' ? 'ING' : 'EGR'}</span>
        ${
          c.builtin
            ? ''
            : `<button type="button" class="chip-del" data-del-cat="${c.id}" title="Eliminar categoría">×</button>`
        }
      </span>
    `
    )
    .join('');

  wrap.querySelectorAll('[data-del-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.delCat;
      const inUse = state.transactions.some((t) => t.categoryId === id);
      if (inUse) {
        showToast('No puedes eliminar una categoría con movimientos asociados');
        return;
      }
      state.categories = state.categories.filter((c) => c.id !== id);
      saveState();
      renderCategories();
      populateTxCategorySelect();
    });
  });
}

// Cuentas / Billeteras CRUD
document.getElementById('btnToggleAccForm').addEventListener('click', () => {
  document.getElementById('accForm').classList.toggle('hidden');
});

document.getElementById('accForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('accName').value.trim();
  const initial = Number(document.getElementById('accInitial').value) || 0;
  const icon = document.getElementById('accIcon').value.trim() || '💳';
  const color = document.getElementById('accColor').value || '#1b4332';
  if (!name) return;

  state.accounts.push({ id: uid('acc'), name, initial, icon, color, builtin: false });
  saveState();
  document.getElementById('accName').value = '';
  document.getElementById('accInitial').value = '0';
  document.getElementById('accForm').classList.add('hidden');
  populateAccountSelects();
  renderAccounts();
  showToast(`Cuenta "${name}" agregada`);
});

function populateAccountSelects(selectedId = null, selectedToId = null) {
  const txAcc = document.getElementById('txAccount');
  const prevTx = selectedId || txAcc.value;
  txAcc.innerHTML = state.accounts
    .map((a) => `<option value="${a.id}">${a.icon} ${a.name}</option>`)
    .join('');
  if (prevTx && state.accounts.some((a) => a.id === prevTx)) {
    txAcc.value = prevTx;
  }

  const txToAcc = document.getElementById('txToAccount');
  if (txToAcc) {
    const prevTo = selectedToId || txToAcc.value;
    txToAcc.innerHTML = state.accounts
      .map((a) => `<option value="${a.id}">${a.icon} ${a.name}</option>`)
      .join('');
    if (prevTo && state.accounts.some((a) => a.id === prevTo)) {
      txToAcc.value = prevTo;
    } else if (state.accounts.length > 1) {
      txToAcc.value = state.accounts[1].id;
    }
  }

  const filterAcc = document.getElementById('filterTxAccount');
  const prevFilter = filterAcc.value;
  filterAcc.innerHTML =
    `<option value="all">Todas las cuentas</option>` +
    state.accounts.map((a) => `<option value="${a.id}">${a.icon} ${a.name}</option>`).join('');
  if ([...filterAcc.options].some((o) => o.value === prevFilter)) {
    filterAcc.value = prevFilter;
  }
}

function getAccountById(id) {
  return (
    state.accounts.find((a) => a.id === id) ||
    state.accounts[0] || { id: 'acc_efe', name: 'Efectivo', icon: '💵', color: '#2d6a4f', initial: 0 }
  );
}

function computeAccountBalance(acc) {
  let bal = Number(acc.initial) || 0;
  const fallbackId = state.accounts[0]?.id;
  state.transactions.forEach((t) => {
    const tAccId = t.accountId || fallbackId;
    if (t.type === 'transferencia') {
      if (tAccId === acc.id) bal -= t.amount;
      if (t.toAccountId === acc.id) bal += t.amount;
    } else if (tAccId === acc.id) {
      bal += t.type === 'ingreso' ? t.amount : -t.amount;
    }
  });
  return bal;
}

function renderAccounts() {
  const wrap = document.getElementById('accountCards');
  const activeFilter = document.getElementById('filterTxAccount').value;

  wrap.innerHTML = state.accounts
    .map((acc) => {
      const bal = computeAccountBalance(acc);
      const isActive = activeFilter === acc.id;
      return `
        <div class="account-pill-card ${isActive ? 'active' : ''}" data-select-acc="${acc.id}" role="button" tabindex="0">
          <div class="account-avatar" style="background:${acc.color}22; color:${acc.color}">${acc.icon}</div>
          <div class="account-info">
            <span class="account-name">${escapeHtml(acc.name)}</span>
            <strong class="account-balance">${formatMoney(bal)}</strong>
          </div>
          ${
            acc.builtin
              ? ''
              : `<button type="button" class="account-del" data-del-acc="${acc.id}" title="Eliminar cuenta" aria-label="Eliminar cuenta">×</button>`
          }
        </div>
      `;
    })
    .join('');

  wrap.querySelectorAll('[data-select-acc]').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-del-acc]')) return;
      const id = card.dataset.selectAcc;
      const filterEl = document.getElementById('filterTxAccount');
      filterEl.value = filterEl.value === id ? 'all' : id;
      renderAccounts();
      renderTracker();
    });
  });

  wrap.querySelectorAll('[data-del-acc]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.delAcc;
      const inUse = state.transactions.some((t) => t.accountId === id);
      if (inUse) {
        showToast('No puedes eliminar una cuenta con movimientos asociados');
        return;
      }
      state.accounts = state.accounts.filter((a) => a.id !== id);
      if (document.getElementById('filterTxAccount').value === id) {
        document.getElementById('filterTxAccount').value = 'all';
      }
      saveState();
      populateAccountSelects();
      renderAccounts();
      renderTracker();
    });
  });

  renderEmergencyFund();
}

function renderEmergencyFund() {
  const totalLiquid = state.accounts.reduce((sum, acc) => sum + Math.max(0, computeAccountBalance(acc)), 0);

  // Promedio mensual de egresos (excluyendo transferencias)
  const monthExpenseMap = new Map();
  state.transactions
    .filter((t) => t.type === 'egreso')
    .forEach((t) => {
      const ym = t.date.slice(0, 7);
      monthExpenseMap.set(ym, (monthExpenseMap.get(ym) || 0) + t.amount);
    });

  const avgMonthlyExpense =
    monthExpenseMap.size > 0
      ? [...monthExpenseMap.values()].reduce((a, b) => a + b, 0) / monthExpenseMap.size
      : 0;

  const badge = document.getElementById('emergencyBadge');
  const bar = document.getElementById('emergencyProgress');
  const hint = document.getElementById('emergencyHint');

  if (avgMonthlyExpense <= 0) {
    badge.textContent = `Liquidez: ${formatMoney(totalLiquid)}`;
    badge.className = 'badge';
    bar.style.width = '0%';
    bar.className = 'progress-fill';
    hint.textContent = 'Registra egresos para calcular cuántos meses cubre tu liquidez actual.';
    return;
  }

  const monthsCovered = totalLiquid / avgMonthlyExpense;
  const pct = Math.min(100, (monthsCovered / 6) * 100);
  bar.style.width = `${pct.toFixed(1)}%`;

  if (monthsCovered >= 3) {
    badge.className = 'badge badge-alto';
    bar.className = 'progress-fill';
  } else if (monthsCovered >= 1) {
    badge.className = 'badge badge-moderado';
    bar.className = 'progress-fill warn';
  } else {
    badge.className = 'badge badge-bajo';
    bar.className = 'progress-fill danger';
  }

  badge.textContent = `${monthsCovered.toFixed(1)} meses de cobertura`;
  hint.textContent = `Liquidez total: ${formatMoney(totalLiquid)} · Gasto mensual prom.: ${formatMoney(avgMonthlyExpense)} (meta: 3–6 meses).`;
}

// Presupuestos mensuales por categoría
document.getElementById('btnToggleBudgetForm').addEventListener('click', () => {
  document.getElementById('budgetForm').classList.toggle('hidden');
});

document.getElementById('budgetForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const catId = document.getElementById('budgetCatSelect').value;
  const limit = Math.max(0, Number(document.getElementById('budgetLimitInput').value) || 0);
  const cat = state.categories.find((c) => c.id === catId);
  if (!cat) return;
  cat.budget = limit;
  saveState();
  document.getElementById('budgetLimitInput').value = '';
  document.getElementById('budgetForm').classList.add('hidden');
  renderBudgets();
  showToast(limit > 0 ? `Presupuesto de ${cat.name} guardado` : `Presupuesto de ${cat.name} eliminado`);
});

function renderBudgets() {
  const wrap = document.getElementById('budgetList');
  const budgeted = state.categories.filter((c) => c.type === 'egreso' && Number(c.budget) > 0);

  if (budgeted.length === 0) {
    wrap.innerHTML = '<p class="hint">Sin topes definidos. Pulsa "⚙️ Configurar" para fijar límites mensuales.</p>';
    return;
  }

  const periodTxs = getPeriodTransactions().filter((t) => t.type === 'egreso');
  const spentByCat = new Map();
  periodTxs.forEach((t) => {
    spentByCat.set(t.categoryId, (spentByCat.get(t.categoryId) || 0) + t.amount);
  });

  wrap.innerHTML = budgeted
    .map((cat) => {
      const spent = spentByCat.get(cat.id) || 0;
      const limit = Number(cat.budget);
      const pct = (spent / limit) * 100;
      const fillCls = pct >= 100 ? 'danger' : pct >= 80 ? 'warn' : '';
      return `
        <div class="budget-item">
          <div class="budget-item-top">
            <span>${cat.icon} <strong>${escapeHtml(cat.name)}</strong></span>
            <span class="budget-nums">${formatMoney(spent)} / ${formatMoney(limit)} (${pct.toFixed(0)}%)</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill ${fillCls}" style="width:${Math.min(100, pct).toFixed(1)}%;"></div>
          </div>
        </div>
      `;
    })
    .join('');
}

// Movimientos recurrentes / fijos
function applyRecurringItem(rec) {
  const today = todayISO();
  const currentYM = today.slice(0, 7);
  state.transactions.push({
    id: uid('tx'),
    type: rec.type,
    amount: rec.amount,
    date: today,
    categoryId: rec.categoryId,
    accountId: rec.accountId,
    note: rec.note,
  });
  rec.lastAppliedMonth = currentYM;
}

document.getElementById('btnApplyAllRecurring').addEventListener('click', () => {
  const currentYM = todayISO().slice(0, 7);
  const pending = state.recurring.filter((r) => r.lastAppliedMonth !== currentYM);
  if (pending.length === 0) {
    showToast('Todos los movimientos fijos ya están aplicados este mes');
    return;
  }
  pending.forEach(applyRecurringItem);
  saveState();
  renderAccounts();
  renderRecurring();
  renderTracker();
  showToast(`${pending.length} movimiento(s) fijo(s) aplicado(s)`);
});

function renderRecurring() {
  const wrap = document.getElementById('recurringList');
  if (state.recurring.length === 0) {
    wrap.innerHTML = '<p class="hint">Marca "Guardar como fijo mensual" al registrar un movimiento para verlo aquí.</p>';
    return;
  }

  const currentYM = todayISO().slice(0, 7);
  wrap.innerHTML = state.recurring
    .map((r) => {
      const cat = getCategoryById(r.categoryId);
      const acc = getAccountById(r.accountId);
      const applied = r.lastAppliedMonth === currentYM;
      const sign = r.type === 'ingreso' ? '+' : '-';
      const cls = r.type === 'ingreso' ? 'amount-pos' : 'amount-neg';
      return `
        <div class="recurring-item">
          <div class="recurring-info">
            <span class="recurring-title">${cat.icon} ${escapeHtml(r.note || cat.name)}</span>
            <span class="recurring-sub">${acc.icon} ${escapeHtml(acc.name)} · <span class="${cls}">${sign}${formatMoney(r.amount)}</span></span>
          </div>
          <div class="recurring-actions">
            <button type="button" class="btn ${applied ? 'btn-ghost' : 'btn-secondary'} btn-xs" data-apply-rec="${r.id}">
              ${applied ? '✓ Mes listo' : '⚡ Aplicar'}
            </button>
            <button type="button" class="icon-btn del" data-del-rec="${r.id}" title="Eliminar fijo">🗑️</button>
          </div>
        </div>
      `;
    })
    .join('');

  wrap.querySelectorAll('[data-apply-rec]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const rec = state.recurring.find((x) => x.id === btn.dataset.applyRec);
      if (!rec) return;
      applyRecurringItem(rec);
      saveState();
      renderAccounts();
      renderRecurring();
      renderTracker();
      showToast(`"${rec.note || 'Fijo'}" registrado hoy`);
    });
  });

  wrap.querySelectorAll('[data-del-rec]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.recurring = state.recurring.filter((x) => x.id !== btn.dataset.delRec);
      saveState();
      renderRecurring();
      showToast('Movimiento fijo eliminado');
    });
  });
}

// Filtros del Tracker
['filterMonth', 'chartTypeFilter', 'filterTxType', 'filterTxCategory', 'filterTxAccount', 'searchTx'].forEach((id) => {
  document.getElementById(id).addEventListener('input', () => {
    if (id === 'filterTxAccount') renderAccounts();
    renderTracker();
  });
});

function populateMonthFilter() {
  const select = document.getElementById('filterMonth');
  const prev = select.value;
  const months = [...new Set(state.transactions.map((t) => t.date.slice(0, 7)))].sort().reverse();

  const currentYM = todayISO().slice(0, 7);
  if (!months.includes(currentYM)) months.unshift(currentYM);

  select.innerHTML =
    `<option value="all">Todo el historial</option>` +
    months.map((ym) => `<option value="${ym}">${ym}</option>`).join('');

  if (prev && [...select.options].some((o) => o.value === prev)) {
    select.value = prev;
  } else {
    select.value = currentYM;
  }
}

function getCategoryById(id) {
  return (
    state.categories.find((c) => c.id === id) || {
      name: 'Sin categoría',
      icon: '🏷️',
      color: '#64748b',
    }
  );
}

function getPeriodTransactions() {
  const period = document.getElementById('filterMonth').value;
  return period === 'all'
    ? state.transactions
    : state.transactions.filter((t) => t.date.startsWith(period));
}

let lastFilteredTransactions = [];

function renderTracker() {
  populateMonthFilter();
  renderBudgets();
  const periodTxs = getPeriodTransactions();

  let totalIng = 0;
  let countIng = 0;
  let totalEgr = 0;
  let countEgr = 0;

  periodTxs.forEach((t) => {
    if (t.type === 'ingreso') {
      totalIng += t.amount;
      countIng += 1;
    } else if (t.type === 'egreso') {
      totalEgr += t.amount;
      countEgr += 1;
    }
  });

  const balance = totalIng - totalEgr;
  const savingsRate = totalIng > 0 ? (balance / totalIng) * 100 : 0;

  document.getElementById('kpiIngresos').textContent = formatMoney(totalIng);
  document.getElementById('kpiIngresosCount').textContent = `${countIng} movimientos`;
  document.getElementById('kpiEgresos').textContent = formatMoney(totalEgr);
  document.getElementById('kpiEgresosCount').textContent = `${countEgr} movimientos`;

  const balEl = document.getElementById('kpiBalance');
  balEl.textContent = formatMoney(balance);
  balEl.className = `kpi-value ${balance >= 0 ? 'positive' : 'negative'}`;

  document.getElementById('kpiTasaAhorro').textContent = `${savingsRate.toFixed(1)}%`;

  // Gráfico Dona por Categoría
  const chartKind = document.getElementById('chartTypeFilter').value;
  const byCat = new Map();
  periodTxs
    .filter((t) => t.type === chartKind)
    .forEach((t) => {
      byCat.set(t.categoryId, (byCat.get(t.categoryId) || 0) + t.amount);
    });

  const donutItems = [...byCat.entries()]
    .map(([catId, value]) => {
      const cat = getCategoryById(catId);
      return { label: `${cat.icon} ${cat.name}`, value, color: cat.color };
    })
    .sort((a, b) => b.value - a.value);

  drawDonutChart(document.getElementById('donutChart'), donutItems, formatMoney);

  const legend = document.getElementById('donutLegend');
  const donutTotal = donutItems.reduce((s, i) => s + i.value, 0);
  legend.innerHTML = donutItems.length
    ? donutItems
        .map((i) => {
          const pct = donutTotal > 0 ? ((i.value / donutTotal) * 100).toFixed(1) : '0';
          return `<span class="legend-item"><i class="legend-swatch" style="background:${i.color}"></i>${i.label} (${pct}%)</span>`;
        })
        .join('')
    : '<span class="hint">Sin movimientos en este período</span>';

  // Gráfico de barras últimos 6 meses (excluyendo transferencias)
  const monthMap = new Map();
  state.transactions.forEach((t) => {
    if (t.type === 'transferencia') return;
    const ym = t.date.slice(0, 7);
    if (!monthMap.has(ym)) monthMap.set(ym, { ym, ingresos: 0, egresos: 0 });
    const entry = monthMap.get(ym);
    if (t.type === 'ingreso') entry.ingresos += t.amount;
    else if (t.type === 'egreso') entry.egresos += t.amount;
  });
  const monthsData = [...monthMap.values()]
    .sort((a, b) => a.ym.localeCompare(b.ym))
    .slice(-6)
    .map((m) => ({ ...m, label: m.ym.slice(2) }));

  drawMonthlyBarChart(document.getElementById('monthlyBarChart'), monthsData);

  // Tabla filtrada
  const typeFilter = document.getElementById('filterTxType').value;
  const catFilter = document.getElementById('filterTxCategory').value;
  const accFilter = document.getElementById('filterTxAccount').value;
  const search = document.getElementById('searchTx').value.trim().toLowerCase();
  const fallbackAccId = state.accounts[0]?.id;

  const filtered = periodTxs
    .filter((t) => (typeFilter === 'all' ? true : t.type === typeFilter))
    .filter((t) => (catFilter === 'all' ? true : t.categoryId === catFilter))
    .filter((t) =>
      accFilter === 'all'
        ? true
        : (t.accountId || fallbackAccId) === accFilter || (t.type === 'transferencia' && t.toAccountId === accFilter)
    )
    .filter((t) => (!search ? true : (t.note || '').toLowerCase().includes(search)))
    .sort((a, b) => b.date.localeCompare(a.date));

  lastFilteredTransactions = filtered;

  const tbody = document.getElementById('txTableBody');
  const mobileList = document.getElementById('txMobileList');
  const emptyEl = document.getElementById('txEmptyState');

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    if (mobileList) mobileList.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  tbody.innerHTML = filtered
    .map((t) => {
      const acc = getAccountById(t.accountId);
      if (t.type === 'transferencia') {
        const toAcc = getAccountById(t.toAccountId);
        return `
          <tr>
            <td>${t.date}</td>
            <td><span class="badge badge-moderado">🔄 Transferencia</span></td>
            <td><span class="badge">${acc.icon} ${escapeHtml(acc.name)} → ${toAcc.icon} ${escapeHtml(toAcc.name)}</span></td>
            <td>${escapeHtml(t.note || '—')}</td>
            <td class="num amount-transfer">${formatMoney(t.amount)}</td>
            <td class="actions-col">
              <button type="button" class="icon-btn" data-edit-tx="${t.id}" title="Editar">✏️</button>
              <button type="button" class="icon-btn del" data-del-tx="${t.id}" title="Eliminar">🗑️</button>
            </td>
          </tr>
        `;
      }
      const cat = getCategoryById(t.categoryId);
      const cls = t.type === 'ingreso' ? 'amount-pos' : 'amount-neg';
      const sign = t.type === 'ingreso' ? '+' : '-';
      return `
        <tr>
          <td>${t.date}</td>
          <td><span class="badge"><span class="cat-dot" style="background:${cat.color}"></span>${cat.icon} ${cat.name}</span></td>
          <td><span class="badge">${acc.icon} ${escapeHtml(acc.name)}</span></td>
          <td>${escapeHtml(t.note || '—')}</td>
          <td class="num ${cls}">${sign}${formatMoney(t.amount)}</td>
          <td class="actions-col">
            <button type="button" class="icon-btn" data-edit-tx="${t.id}" title="Editar">✏️</button>
            <button type="button" class="icon-btn del" data-del-tx="${t.id}" title="Eliminar">🗑️</button>
          </td>
        </tr>
      `;
    })
    .join('');

  if (mobileList) {
    mobileList.innerHTML = filtered
      .map((t) => {
        const acc = getAccountById(t.accountId);
        if (t.type === 'transferencia') {
          const toAcc = getAccountById(t.toAccountId);
          return `
            <div class="wallet-item">
              <div class="wallet-avatar" style="background:rgba(27,67,50,0.12); color:#1b4332">🔄</div>
              <div class="wallet-main">
                <div class="wallet-title">${escapeHtml(t.note || 'Transferencia')}</div>
                <div class="wallet-sub">${acc.icon} ${escapeHtml(acc.name)} → ${toAcc.icon} ${escapeHtml(toAcc.name)} · ${t.date}</div>
              </div>
              <div class="wallet-right">
                <div class="wallet-amount amount-transfer">${formatMoney(t.amount)}</div>
                <div class="wallet-actions">
                  <button type="button" data-edit-tx="${t.id}" aria-label="Editar">Editar</button>
                  <button type="button" data-del-tx="${t.id}" aria-label="Eliminar">Eliminar</button>
                </div>
              </div>
            </div>
          `;
        }
        const cat = getCategoryById(t.categoryId);
        const cls = t.type === 'ingreso' ? 'amount-pos' : 'amount-neg';
        const sign = t.type === 'ingreso' ? '+' : '-';
        const title = t.note ? escapeHtml(t.note) : cat.name;
        return `
          <div class="wallet-item">
            <div class="wallet-avatar" style="background:${cat.color}22; color:${cat.color}">${cat.icon}</div>
            <div class="wallet-main">
              <div class="wallet-title">${title}</div>
              <div class="wallet-sub">${cat.name} · ${acc.icon} ${escapeHtml(acc.name)} · ${t.date}</div>
            </div>
            <div class="wallet-right">
              <div class="wallet-amount ${cls}">${sign}${formatMoney(t.amount)}</div>
              <div class="wallet-actions">
                <button type="button" data-edit-tx="${t.id}" aria-label="Editar">Editar</button>
                <button type="button" data-del-tx="${t.id}" aria-label="Eliminar">Eliminar</button>
              </div>
            </div>
          </div>
        `;
      })
      .join('');
  }

  document.querySelectorAll('[data-edit-tx]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tx = state.transactions.find((x) => x.id === btn.dataset.editTx);
      if (!tx) return;
      setTxTypeUI(tx.type);
      if (tx.type !== 'transferencia') populateTxCategorySelect(tx.categoryId);
      populateAccountSelects(tx.accountId || fallbackAccId, tx.toAccountId || null);
      document.getElementById('txId').value = tx.id;
      document.getElementById('txAmount').value = tx.amount;
      document.getElementById('txDate').value = tx.date;
      document.getElementById('txNote').value = tx.note || '';
      document.getElementById('formTxTitle').textContent = 'Editar Movimiento';
      document.getElementById('btnSaveTx').textContent = 'Actualizar Movimiento';
      document.getElementById('btnCancelEditTx').classList.remove('hidden');
      openTxSheetIfMobile();
    });
  });

  document.querySelectorAll('[data-del-tx]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.transactions = state.transactions.filter((x) => x.id !== btn.dataset.delTx);
      saveState();
      renderAccounts();
      renderTracker();
      showToast('Movimiento eliminado');
    });
  });
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/* ==================== PROYECTOR DE CRECIMIENTO ==================== */
const projInstrumentSelect = document.getElementById('projInstrument');

function updateInstrumentPanels() {
  const inst = projInstrumentSelect.value;
  document.getElementById('cdtOptions').classList.toggle('hidden', inst !== 'cdt');
  document.getElementById('fondoOptions').classList.toggle('hidden', inst !== 'fondo');
}

projInstrumentSelect.addEventListener('change', () => {
  updateInstrumentPanels();
  computeAndRenderProjection();
});

function readProjConfig() {
  return {
    name: document.getElementById('projName').value.trim() || 'Escenario sin nombre',
    instrument: document.getElementById('projInstrument').value,
    initial: Number(document.getElementById('projInitial').value) || 0,
    rate: Number(document.getElementById('projRate').value) || 0,
    contribution: Number(document.getElementById('projContribution').value) || 0,
    frequency: document.getElementById('projFrequency').value,
    horizonVal: Number(document.getElementById('projHorizonVal').value) || 12,
    horizonUnit: document.getElementById('projHorizonUnit').value,
    cdtTermDays: Number(document.getElementById('projCdtTermDays').value) || 180,
    taxRate: Number(document.getElementById('projTaxRate').value) || 0,
    cdtReinvest: document.getElementById('projCdtReinvest').checked,
    feeRate: Number(document.getElementById('projFeeRate').value) || 0,
    fondoTax: Number(document.getElementById('projFondoTax').value) || 0,
    inflation: Number(document.getElementById('projInflation').value) || 0,
    contribGrowth: Number(document.getElementById('projContribGrowth').value) || 0,
  };
}

function writeProjConfig(cfg) {
  document.getElementById('projName').value = cfg.name;
  document.getElementById('projInstrument').value = cfg.instrument;
  document.getElementById('projInitial').value = cfg.initial;
  document.getElementById('projRate').value = cfg.rate;
  document.getElementById('projContribution').value = cfg.contribution;
  document.getElementById('projFrequency').value = cfg.frequency;
  document.getElementById('projHorizonVal').value = cfg.horizonVal;
  document.getElementById('projHorizonUnit').value = cfg.horizonUnit;
  document.getElementById('projCdtTermDays').value = cfg.cdtTermDays ?? 180;
  document.getElementById('projTaxRate').value = cfg.taxRate ?? 4;
  document.getElementById('projCdtReinvest').checked = cfg.cdtReinvest ?? true;
  document.getElementById('projFeeRate').value = cfg.feeRate ?? 1.2;
  document.getElementById('projFondoTax').value = cfg.fondoTax ?? 0;
  document.getElementById('projInflation').value = cfg.inflation ?? 5;
  document.getElementById('projContribGrowth').value = cfg.contribGrowth ?? 0;
  updateInstrumentPanels();
}

let currentProjMode = 'forward';

document.querySelectorAll('#projModeToggle [data-proj-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    currentProjMode = btn.dataset.projMode;
    document.querySelectorAll('#projModeToggle [data-proj-mode]').forEach((b) => {
      b.classList.toggle('active', b === btn);
    });
    const isGoal = currentProjMode === 'goal';
    document.getElementById('projGoalRow').classList.toggle('hidden', !isGoal);
    document.getElementById('projContribRow').classList.toggle('hidden', isGoal);
    document.getElementById('projGoalResultBox').classList.toggle('hidden', !isGoal);
    if (isGoal && document.getElementById('projFrequency').value === 'ninguno') {
      document.getElementById('projFrequency').value = 'mensual';
    }
    computeAndRenderProjection();
  });
});

function computeAndRenderProjection() {
  const cfg = readProjConfig();
  let res;

  if (currentProjMode === 'goal') {
    const targetGoal = Number(document.getElementById('projTargetGoal').value) || 0;
    const solved = solveRequiredContribution(cfg, targetGoal);
    cfg.contribution = solved.requiredContribution;
    cfg.frequency = solved.frequency;
    res = solved.projection;

    const freqUnit =
      solved.frequency === 'diario' ? 'día' : solved.frequency === 'semanal' ? 'semana' : 'mes';
    document.getElementById('projRequiredAmount').textContent = `${formatMoney(solved.requiredContribution)} / ${freqUnit}`;

    const monthlyEq =
      solved.frequency === 'diario'
        ? (solved.requiredContribution * 365) / 12
        : solved.frequency === 'semanal'
        ? (solved.requiredContribution * 52) / 12
        : solved.requiredContribution;
    const weeklyEq = (monthlyEq * 12) / 52;
    const dailyEq = (monthlyEq * 12) / 365;

    document.getElementById('projGoalEquivalents').innerHTML = `
      <span class="badge">📅 Diario: ${formatMoney(dailyEq)}</span>
      <span class="badge">📆 Semanal: ${formatMoney(weeklyEq)}</span>
      <span class="badge">🗓️ Mensual: ${formatMoney(monthlyEq)}</span>
    `;

    const periodTxs = getPeriodTransactions();
    let ing = 0;
    let egr = 0;
    periodTxs.forEach((t) => (t.type === 'ingreso' ? (ing += t.amount) : (egr += t.amount)));
    const trackerSavings = Math.max(0, ing - egr);

    const statusBadge = document.getElementById('projGoalStatusBadge');
    const hintEl = document.getElementById('projGoalTrackerHint');
    if (solved.requiredContribution === 0) {
      statusBadge.textContent = '¡Ya cubierto!';
      statusBadge.className = 'badge badge-alto';
      hintEl.textContent = 'Tu capital inicial + rendimientos ya superan la meta en ese horizonte.';
    } else if (trackerSavings >= monthlyEq) {
      statusBadge.textContent = 'Meta alcanzable';
      statusBadge.className = 'badge badge-alto';
      hintEl.textContent = `✅ Tu ahorro actual del Tracker (${formatMoney(trackerSavings)}/mes) cubre este aporte requerido.`;
    } else if (trackerSavings > 0) {
      const gap = monthlyEq - trackerSavings;
      statusBadge.textContent = 'Requiere ajuste';
      statusBadge.className = 'badge badge-moderado';
      hintEl.textContent = `💡 Te faltan ${formatMoney(gap)}/mes frente a tu balance actual del Tracker (${formatMoney(trackerSavings)}/mes).`;
    } else {
      statusBadge.textContent = 'Planifica tu ahorro';
      statusBadge.className = 'badge badge-moderado';
      hintEl.textContent = 'Registra tus ingresos y egresos en el Tracker para comparar tu capacidad real de ahorro.';
    }
  } else {
    res = runProjection(cfg);
  }

  lastProjectionResult = { cfg, res };

  document.getElementById('projFinalValue').textContent = formatMoney(res.finalBalance);
  document.getElementById('projRealValue').textContent = `Valor real (ajustado por inflación): ${formatMoney(res.realValue)}`;
  document.getElementById('projTotalInvested').textContent = formatMoney(res.totalInvested);
  document.getElementById('projInitialVsContrib').textContent = `Inicial: ${formatMoney(res.initial)} · Aportes: ${formatMoney(res.totalContributions)}`;
  document.getElementById('projNetInterest').textContent = formatMoney(res.netInterest);
  document.getElementById('projMultiplier').textContent = `Multiplicador: ${res.multiplier.toFixed(2)}x`;
  document.getElementById('projMonthlyPassive').textContent = formatMoney(res.avgMonthlyPassive);
  document.getElementById('projTaxPaid').textContent = `Impuestos/comisiones: ${formatMoney(res.totalTaxesAndFees)}`;

  drawGrowthChart(document.getElementById('growthChart'), res.series);
  renderProjectionTable();

  if (cfg.instrument === 'fondo') {
    updateFondoViabilityBox(cfg, res);
  }
}

function updateFondoViabilityBox(cfg, res) {
  const params = readMarketParams();
  const evalRes = evaluateMarketViability(params);
  lastMarketEvaluation = evalRes;

  const horizonYears = Math.max(1, Math.round(res.totalDays / 365));
  const netExpectedRate = Math.max(0, evalRes.expectedReturnEA - (cfg.feeRate || 0));
  const mc = runMonteCarloProjection({
    initial: cfg.initial,
    contribution: cfg.contribution,
    frequency: cfg.frequency,
    horizonYears,
    expectedReturnEA: netExpectedRate,
    annualVolatility: evalRes.annualVolatility,
    riskFreeEA: params.riskFree,
  });

  const badge = document.getElementById('fondoViabilityBadge');
  badge.textContent = `${evalRes.score}/100 · ${evalRes.regime}`;
  badge.className = `badge badge-${evalRes.regimeLevel}`;

  document.getElementById('fondoViabilityAdvice').textContent = evalRes.diagnosis;
  document.getElementById('fondoModeVal').textContent = `${formatMoney(mc.mostProbableFinal)} (P10–P90: ${formatMoney(mc.p10Final)} – ${formatMoney(mc.p90Final)})`;
  document.getElementById('fondoSuggestedRate').textContent = `${evalRes.expectedReturnEA.toFixed(2)}% E.A. (Asignación sugerida: ${evalRes.allocation.fondoPct}%)`;
}

document.getElementById('btnApplySuggestedRate').addEventListener('click', () => {
  const evalRes = evaluateMarketViability(readMarketParams());
  document.getElementById('projRate').value = evalRes.expectedReturnEA.toFixed(2);
  computeAndRenderProjection();
  showToast(`Tasa sugerida (${evalRes.expectedReturnEA.toFixed(2)}% E.A.) aplicada al Fondo`);
});

document.getElementById('btnOpenPredictor').addEventListener('click', () => {
  document.querySelector('.tab-btn[data-tab="predictor"]').click();
});

function renderProjectionTable() {
  if (!lastProjectionResult) return;
  const { res } = lastProjectionResult;
  const gran = document.getElementById('projTableGranularity').value;
  const rows = gran === 'anual' ? res.annualRows : res.monthlyRows;

  document.getElementById('projTableBody').innerHTML = rows
    .map(
      (r) => `
      <tr>
        <td>${r.period}</td>
        <td class="num">${formatMoney(r.startBalance)}</td>
        <td class="num">${formatMoney(r.contributions)}</td>
        <td class="num amount-pos">+${formatMoney(r.interest)}</td>
        <td class="num"><strong>${formatMoney(r.endBalance)}</strong></td>
      </tr>
    `
    )
    .join('');
}

document.getElementById('projForm').addEventListener('submit', (e) => {
  e.preventDefault();
  computeAndRenderProjection();
});

document.getElementById('projForm').addEventListener('input', () => {
  computeAndRenderProjection();
});

document.getElementById('projTableGranularity').addEventListener('change', renderProjectionTable);

document.getElementById('btnUseTrackerSavings').addEventListener('click', () => {
  const periodTxs = getPeriodTransactions();
  let ing = 0;
  let egr = 0;
  periodTxs.forEach((t) => {
    if (t.type === 'ingreso') ing += t.amount;
    else egr += t.amount;
  });
  const avail = Math.max(0, ing - egr);
  if (avail <= 0) {
    showToast('Tu balance en el período actual del Tracker es 0 o negativo');
    return;
  }
  document.getElementById('projContribution').value = Math.round(avail);
  document.getElementById('projFrequency').value = 'mensual';
  computeAndRenderProjection();
  showToast(`Aporte mensual actualizado con tu balance (${formatMoney(avail)})`);
});

document.getElementById('btnSaveScenario').addEventListener('click', () => {
  const cfg = lastProjectionResult?.cfg ? { ...lastProjectionResult.cfg } : readProjConfig();
  state.scenarios.push({ id: uid('sc'), ...cfg });
  saveState();
  renderComparator();
  showToast(`"${cfg.name}" guardado en Portafolio`);
});

/* ==================== COMPARADOR / PORTAFOLIO ==================== */
const INSTRUMENT_LABELS = {
  cajita: '🪙 Cajita',
  cdt: '📜 CDT',
  fondo: '📊 Fondo Inv.',
};

function renderComparator() {
  const tbody = document.getElementById('compTableBody');
  const empty = document.getElementById('compEmptyState');
  const marketEval = evaluateMarketViability(readMarketParams());

  let sumInvested = 0;
  let sumFinal = 0;
  let sumInterest = 0;

  const rowsHtml = state.scenarios
    .map((sc) => {
      const res = runProjection(sc);
      sumInvested += res.totalInvested;
      sumFinal += res.finalBalance;
      sumInterest += res.netInterest;

      const freqText =
        sc.frequency === 'ninguno'
          ? 'Sin aportes'
          : `${formatMoney(sc.contribution)} / ${sc.frequency}`;

      const viabilityTag =
        sc.instrument === 'fondo'
          ? ` <span class="badge badge-${marketEval.regimeLevel}" title="${escapeHtml(marketEval.diagnosis)}">🔮 ${marketEval.score}/100</span>`
          : '';

      return `
        <tr>
          <td><strong>${escapeHtml(sc.name)}</strong></td>
          <td><span class="badge">${INSTRUMENT_LABELS[sc.instrument] || sc.instrument}</span>${viabilityTag}</td>
          <td class="num">${Number(sc.rate).toFixed(2)}% E.A.</td>
          <td>${freqText}</td>
          <td>${sc.horizonVal} ${sc.horizonUnit}</td>
          <td class="num">${formatMoney(res.totalInvested)}</td>
          <td class="num amount-pos">+${formatMoney(res.netInterest)}</td>
          <td class="num"><strong>${formatMoney(res.finalBalance)}</strong></td>
          <td class="actions-col">
            <button type="button" class="icon-btn" data-load-sc="${sc.id}" title="Abrir en Proyector">📂</button>
            <button type="button" class="icon-btn del" data-del-sc="${sc.id}" title="Eliminar">🗑️</button>
          </td>
        </tr>
      `;
    })
    .join('');

  document.getElementById('compCount').textContent = String(state.scenarios.length);
  document.getElementById('compTotalInvested').textContent = formatMoney(sumInvested);
  document.getElementById('compTotalFinal').textContent = formatMoney(sumFinal);
  document.getElementById('compTotalInterest').textContent = formatMoney(sumInterest);

  if (state.scenarios.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  tbody.innerHTML = rowsHtml;

  tbody.querySelectorAll('[data-load-sc]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sc = state.scenarios.find((s) => s.id === btn.dataset.loadSc);
      if (!sc) return;
      writeProjConfig(sc);
      document.querySelector('.tab-btn[data-tab="proyector"]').click();
      showToast(`Escenario "${sc.name}" cargado`);
    });
  });

  tbody.querySelectorAll('[data-del-sc]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.scenarios = state.scenarios.filter((s) => s.id !== btn.dataset.delSc);
      saveState();
      renderComparator();
      showToast('Escenario eliminado');
    });
  });
}

document.getElementById('btnAddDefaultComparison').addEventListener('click', () => {
  state.scenarios.push(
    {
      id: uid('sc'),
      name: 'Cajita Nu / Lulo (Aporte diario)',
      instrument: 'cajita',
      initial: 1000000,
      rate: 11.0,
      contribution: 20000,
      frequency: 'diario',
      horizonVal: 24,
      horizonUnit: 'meses',
      inflation: 5,
      contribGrowth: 0,
    },
    {
      id: uid('sc'),
      name: 'CDT 180 días (Renovación auto)',
      instrument: 'cdt',
      initial: 5000000,
      rate: 10.5,
      contribution: 300000,
      frequency: 'mensual',
      horizonVal: 24,
      horizonUnit: 'meses',
      cdtTermDays: 180,
      taxRate: 4.0,
      cdtReinvest: true,
      inflation: 5,
      contribGrowth: 0,
    },
    {
      id: uid('sc'),
      name: 'Fondo Inversión Renta Variable',
      instrument: 'fondo',
      initial: 2000000,
      rate: 14.0,
      contribution: 150000,
      frequency: 'semanal',
      horizonVal: 24,
      horizonUnit: 'meses',
      feeRate: 1.2,
      fondoTax: 0,
      inflation: 5,
      contribGrowth: 0,
    }
  );
  saveState();
  renderComparator();
  showToast('Comparativa de 3 instrumentos cargada');
});

/* ==================== PREDICTOR BURSÁTIL ==================== */
const MKT_PRESETS = {
  bull: { trend: 'alcista', volatility: 'baja', valuation: 'justo', liquidity: 'expansiva', riskFree: 8.5 },
  neutral: { trend: 'lateral', volatility: 'moderada', valuation: 'justo', liquidity: 'neutral', riskFree: 10.5 },
  bear: { trend: 'bajista', volatility: 'alta', valuation: 'caro', liquidity: 'restrictiva', riskFree: 12.0 },
  crisis: { trend: 'bajista', volatility: 'alta', valuation: 'barato', liquidity: 'restrictiva', riskFree: 11.5 },
};

let lastMarketEvaluation = null;

document.getElementById('mktPreset').addEventListener('change', (e) => {
  const preset = MKT_PRESETS[e.target.value];
  if (!preset) return;
  document.getElementById('mktTrend').value = preset.trend;
  document.getElementById('mktVolatility').value = preset.volatility;
  document.getElementById('mktValuation').value = preset.valuation;
  document.getElementById('mktLiquidity').value = preset.liquidity;
  document.getElementById('mktRiskFree').value = preset.riskFree;
  renderPredictor();
});

['mktTrend', 'mktVolatility', 'mktValuation', 'mktLiquidity', 'mktRiskFree', 'mktRiskProfile'].forEach((id) => {
  document.getElementById(id).addEventListener('change', () => {
    if (id !== 'mktRiskProfile' && id !== 'mktRiskFree') {
      document.getElementById('mktPreset').value = 'custom';
    }
    renderPredictor();
  });
});

document.getElementById('mktForm').addEventListener('submit', (e) => {
  e.preventDefault();
  renderPredictor();
});

document.getElementById('mktForm').addEventListener('input', () => {
  renderPredictor();
});

function readMarketParams() {
  return {
    trend: document.getElementById('mktTrend').value,
    volatility: document.getElementById('mktVolatility').value,
    valuation: document.getElementById('mktValuation').value,
    liquidity: document.getElementById('mktLiquidity').value,
    riskFree: Number(document.getElementById('mktRiskFree').value) || 0,
    riskProfile: document.getElementById('mktRiskProfile').value,
  };
}

function renderPredictor() {
  const params = readMarketParams();

  const evalRes = evaluateMarketViability(params);
  lastMarketEvaluation = evalRes;

  const initial = Number(document.getElementById('mktInitial').value) || 0;
  const contribution = Number(document.getElementById('mktContribution').value) || 0;
  const frequency = document.getElementById('mktFrequency').value;
  const horizonYears = Number(document.getElementById('mktHorizonYears').value) || 5;

  const mc = runMonteCarloProjection({
    initial,
    contribution,
    frequency,
    horizonYears,
    expectedReturnEA: evalRes.expectedReturnEA,
    annualVolatility: evalRes.annualVolatility,
    riskFreeEA: params.riskFree,
  });

  const scoreEl = document.getElementById('mktScoreVal');
  scoreEl.textContent = `${evalRes.score} / 100`;
  scoreEl.className = `kpi-value ${
    evalRes.regimeLevel === 'alto' ? 'positive' : evalRes.regimeLevel === 'bajo' ? 'negative' : 'accent'
  }`;

  document.getElementById('mktRegimeBadge').textContent = `Régimen: ${evalRes.regime}`;
  document.getElementById('mktReturnVol').textContent = `${evalRes.expectedReturnEA.toFixed(1)}% / ±${evalRes.annualVolatility}%`;
  document.getElementById('mktSharpeMeta').textContent = `Prima vs Renta Fija: ${evalRes.equityPremium >= 0 ? '+' : ''}${evalRes.equityPremium.toFixed(1)}%`;

  document.getElementById('mktModeVal').textContent = formatMoney(mc.mostProbableFinal);
  document.getElementById('mktMedianSub').textContent = `Mediana P50: ${formatMoney(mc.p50Final)} · Pico: ${mc.modeBandPct.toFixed(0)}% trayectorias`;
  document.getElementById('mktRangeMeta').textContent = `P10: ${formatMoney(mc.p10Final)} · P90: ${formatMoney(mc.p90Final)}`;

  const probEl = document.getElementById('mktBeatProb');
  probEl.textContent = `${mc.beatRiskFreeProb.toFixed(0)}%`;
  probEl.className = `kpi-value ${mc.beatRiskFreeProb >= 60 ? 'positive' : mc.beatRiskFreeProb < 40 ? 'negative' : 'accent'}`;
  document.getElementById('mktDrawdownMeta').textContent = `Drawdown máx. mediano: ${mc.medianMaxDrawdown.toFixed(1)}%`;

  drawMonteCarloChart(document.getElementById('monteCarloChart'), mc.series, mc.mostProbableFinal);

  // Asignación sugerida
  const { cajitaPct, cdtPct, fondoPct } = evalRes.allocation;
  document.getElementById('mktStrategyTag').textContent = evalRes.strategyTag;
  document.getElementById('mktAllocBar').innerHTML = `
    <div class="alloc-seg" style="width:${cajitaPct}%; background:#6366f1;" title="Cajita ${cajitaPct}%"></div>
    <div class="alloc-seg" style="width:${cdtPct}%; background:#f59e0b;" title="CDT ${cdtPct}%"></div>
    <div class="alloc-seg" style="width:${fondoPct}%; background:#10b981;" title="Fondo Bursátil ${fondoPct}%"></div>
  `;
  document.getElementById('mktAllocLegend').innerHTML = `
    <span class="alloc-item"><i class="dot" style="background:#6366f1;"></i> <strong>${cajitaPct}%</strong> Cajita (Liquidez)</span>
    <span class="alloc-item"><i class="dot" style="background:#f59e0b;"></i> <strong>${cdtPct}%</strong> CDT (Renta Fija)</span>
    <span class="alloc-item"><i class="dot" style="background:#10b981;"></i> <strong>${fondoPct}%</strong> Fondo Bursátil (Crecimiento)</span>
  `;
  document.getElementById('mktDiagnosisText').textContent = evalRes.diagnosis;
}

function getSelectedAssetSymbol() {
  const sel = document.getElementById('mktAssetSelect').value;
  if (sel === '__custom__') {
    return (document.getElementById('mktCustomTicker').value || 'ICOLCAP.CL').trim().toUpperCase();
  }
  return sel;
}

function getSelectedAssetLabel() {
  const selEl = document.getElementById('mktAssetSelect');
  if (selEl.value === '__custom__') {
    return getSelectedAssetSymbol();
  }
  return selEl.options[selEl.selectedIndex]?.textContent || selEl.value;
}

document.getElementById('mktAssetSelect').addEventListener('change', (e) => {
  const isCustom = e.target.value === '__custom__';
  document.getElementById('mktCustomTickerWrap').classList.toggle('hidden', !isCustom);
});

document.getElementById('btnApplyToProjector').addEventListener('click', () => {
  if (!lastMarketEvaluation) return;
  const assetLabel = getSelectedAssetLabel().replace(/^[^\w]+/, '').trim();
  writeProjConfig({
    name: `${assetLabel} (${lastMarketEvaluation.regime})`,
    instrument: 'fondo',
    initial: Number(document.getElementById('mktInitial').value) || 0,
    rate: lastMarketEvaluation.expectedReturnEA,
    contribution: Number(document.getElementById('mktContribution').value) || 0,
    frequency: document.getElementById('mktFrequency').value,
    horizonVal: Number(document.getElementById('mktHorizonYears').value) || 5,
    horizonUnit: 'anios',
    feeRate: 1.0,
    fondoTax: 0,
    inflation: 5,
    contribGrowth: 0,
  });
  document.querySelector('.tab-btn[data-tab="proyector"]').click();
  showToast(`Escenario "${assetLabel}" (${lastMarketEvaluation.expectedReturnEA}% E.A.) enviado al Proyector`);
});

document.getElementById('btnSyncBvc').addEventListener('click', async () => {
  const btn = document.getElementById('btnSyncBvc');
  const statusEl = document.getElementById('bvcSyncStatus');
  const symbol = getSelectedAssetSymbol();
  btn.disabled = true;
  btn.textContent = '⏳ Sincronizando...';

  try {
    const resp = await fetch(`/api/bvc-status?symbol=${encodeURIComponent(symbol)}`);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();

    if (data.status === 'live' && data.market?.ok) {
      const s = data.suggestedInputs;
      document.getElementById('mktPreset').value = 'custom';
      document.getElementById('mktTrend').value = s.trend;
      document.getElementById('mktVolatility').value = s.volatility;
      document.getElementById('mktValuation').value = s.valuation;
      document.getElementById('mktLiquidity').value = s.liquidity;
      document.getElementById('mktRiskFree').value = s.riskFree;

      const m = data.market;
      const trmTxt = data.trm?.ok ? ` · TRM: $${data.trm.trm}` : '';
      const retTxt = Number.isFinite(m.return1yPct) ? ` · Ret 1A: ${m.return1yPct >= 0 ? '+' : ''}${m.return1yPct}%` : '';
      statusEl.textContent = `✅ ${m.label}: ${m.price} ${m.currency} (SMA200: ${m.sma200} · Vol 30d: ${m.realizedVolPct}%${retTxt}${trmTxt}) — ${data.updatedAt}`;
      statusEl.classList.remove('hidden');

      renderPredictor();
      computeAndRenderProjection();
      renderComparator();
      showToast(`Activo sincronizado: ${m.symbol}`);
    } else {
      statusEl.textContent = `⚠️ No se pudo consultar "${symbol}" (${data.market?.error || 'offline'}). Puedes usar los presets manuales.`;
      statusEl.classList.remove('hidden');
      showToast(`No se encontraron datos en línea para ${symbol}`);
    }
  } catch {
    statusEl.textContent = 'ℹ️ Para sincronizar BVC en vivo, inicia la app con: python3 server.py';
    statusEl.classList.remove('hidden');
    showToast('Inicia con "python3 server.py" para activar la sincronización BVC');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 Sincronizar Activo';
  }
});

/* ==================== CONTROLES MÓVILES iOS ==================== */
function openTxSheetIfMobile() {
  if (window.innerWidth >= 768) return;
  document.getElementById('txCard').classList.add('sheet-open');
  document.getElementById('txSheetBackdrop').classList.remove('hidden');
}

function closeTxSheet() {
  document.getElementById('txCard').classList.remove('sheet-open');
  document.getElementById('txSheetBackdrop').classList.add('hidden');
}

document.getElementById('btnOpenTxSheet').addEventListener('click', () => {
  resetTxForm();
  document.getElementById('txCard').classList.add('sheet-open');
  document.getElementById('txSheetBackdrop').classList.remove('hidden');
});

document.getElementById('btnCloseTxSheet').addEventListener('click', closeTxSheet);
document.getElementById('txSheetBackdrop').addEventListener('click', closeTxSheet);

// Action Sheet (•••) en móvil
const mobileActionSheet = document.getElementById('mobileActionSheet');
const mobileMenuBackdrop = document.getElementById('mobileMenuBackdrop');
const mobileCurrencySelect = document.getElementById('mobileCurrencySelect');
mobileCurrencySelect.value = state.currency;

function closeMobileMenu() {
  mobileActionSheet.classList.add('hidden');
  mobileMenuBackdrop.classList.add('hidden');
}

document.querySelectorAll('[data-open-menu]').forEach((btn) => {
  btn.addEventListener('click', () => {
    mobileCurrencySelect.value = state.currency;
    mobileActionSheet.classList.remove('hidden');
    mobileMenuBackdrop.classList.remove('hidden');
  });
});

document.getElementById('btnCloseMobileSheet').addEventListener('click', closeMobileMenu);
mobileMenuBackdrop.addEventListener('click', closeMobileMenu);

mobileCurrencySelect.addEventListener('change', () => {
  currencySelect.value = mobileCurrencySelect.value;
  currencySelect.dispatchEvent(new Event('change'));
  closeMobileMenu();
});

document.getElementById('btnMobileDemo').addEventListener('click', () => {
  document.getElementById('btnLoadDemo').click();
  closeMobileMenu();
});

document.getElementById('btnMobileExport').addEventListener('click', () => {
  document.getElementById('btnExportJson').click();
  closeMobileMenu();
});

document.getElementById('btnMobileImport').addEventListener('click', () => {
  document.getElementById('inputImportJson').click();
  closeMobileMenu();
});

// Expandir / compactar carrusel de categorías en móvil
document.getElementById('btnToggleAllCats').addEventListener('click', (e) => {
  const chips = document.getElementById('categoryChips');
  const expanded = chips.classList.toggle('expanded');
  e.target.textContent = expanded ? 'Compactar' : 'Ver todas';
});

// Tema Claro / Oscuro iOS
const THEME_KEY = 'finanzasflow_theme';

function getPreferredTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // Ignorar en modo privado
  }
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.documentElement.dataset.theme = theme;
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', isDark ? '#000000' : '#F2F2F7');

  const btnDesk = document.getElementById('btnThemeToggle');
  const btnMob = document.getElementById('btnMobileTheme');
  if (btnDesk) btnDesk.textContent = isDark ? '☀️ Modo claro' : '🌙 Modo oscuro';
  if (btnMob) btnMob.textContent = isDark ? '☀️ Cambiar a Modo Claro' : '🌙 Cambiar a Modo Oscuro';
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Ignorar en modo privado
  }
  applyTheme(next);
  renderTracker();
  computeAndRenderProjection();
  renderPredictor();
}

document.getElementById('btnThemeToggle').addEventListener('click', toggleTheme);
document.getElementById('btnMobileTheme').addEventListener('click', () => {
  toggleTheme();
  closeMobileMenu();
});

applyTheme(getPreferredTheme());

// Exportar movimientos filtrados a CSV (UTF-8 BOM para Excel)
document.getElementById('btnExportCsv').addEventListener('click', () => {
  if (!lastFilteredTransactions.length) {
    showToast('No hay movimientos filtrados para exportar');
    return;
  }
  const csvEscape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const headers = ['Fecha', 'Tipo', 'Categoria', 'Cuenta', 'Cuenta Destino', 'Descripcion', 'Monto'];
  const rows = lastFilteredTransactions.map((t) => {
    const acc = getAccountById(t.accountId);
    const cat = t.type === 'transferencia' ? { name: 'Transferencia' } : getCategoryById(t.categoryId);
    const toAcc = t.type === 'transferencia' ? getAccountById(t.toAccountId).name : '';
    return [t.date, t.type, cat.name, acc.name, toAcc, t.note || '', t.amount].map(csvEscape).join(',');
  });
  const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `finanzasflow-movimientos-${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`CSV exportado (${lastFilteredTransactions.length} movimientos)`);
});

function renderAll() {
  renderCategories();
  populateTxCategorySelect();
  populateAccountSelects();
  renderAccounts();
  renderRecurring();
  renderTracker();
  updateInstrumentPanels();
  computeAndRenderProjection();
  renderComparator();
  renderPredictor();
}

renderAll();
