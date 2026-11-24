export type GasEntry = {
  id?: number;
  date: string;
  price: number;
  mode: string;
  vendor: string;
  notes?: string;
};

export type GasVendor = {
  id?: number;
  name: string;
  phone: string;
  contactType: "whatsapp" | "phone" | "app";
};

export type PeriodOption = "6 meses" | "1 ano" | "Tudo";
export type ForecastConfidence = "insufficient" | "initial" | "reliable";
export type LevelTone = "green" | "amber" | "red" | "neutral";

export type IntervalSummary = {
  averageDays: number | null;
  intervalCount: number;
  intervals: number[];
  confidence: ForecastConfidence;
};

export type GasForecast = {
  hasData: boolean;
  lastPurchase: GasEntry | null;
  elapsedDays: number;
  interval: IntervalSummary;
  estimatedLevel: number | null;
  remainingDays: number | null;
  overdueDays: number;
  nextEstimatedDate: string | null;
  tone: LevelTone;
};

export type PriceVariation = {
  percent: number;
  absoluteDelta: number;
  basePrice: number;
  baseDate: string;
  direction: "up" | "down" | "flat";
};

export type FinancialMetrics = {
  count: number;
  lastPurchase: GasEntry | null;
  totalSpent: number;
  averagePrice: number | null;
  interval: IntervalSummary;
  priceVariation: PriceVariation | null;
};

export type SavingsComparison = {
  previous: GasEntry;
  current: GasEntry;
  /** Diferença absoluta: previous.price - current.price (> 0 indica redução de preço). */
  difference: number;
  percent: number;
  status: "saved" | "increased" | "unchanged";
};

export type VendorStats = {
  name: string;
  normalizedName: string;
  vendor: GasVendor | null;
  purchaseCount: number;
  minPrice: number | null;
  maxPrice: number | null;
  averagePrice: number | null;
  lastPrice: number | null;
  lastDate: string | null;
  isLowestRegistered: boolean;
  history: GasEntry[];
};

export type VendorComparisonSummary = {
  items: VendorStats[];
  lowestPrice: number | null;
  lowestVendorNames: string[];
  totalPurchasesInPeriod: number;
};

export type ConsumptionStats = {
  period: PeriodOption;
  purchaseCount: number;
  totalSpentRealized: number;
  averagePrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  interval: IntervalSummary;
  minIntervalDays: number | null;
  maxIntervalDays: number | null;
  /** Estimativa mensal: (preço médio / intervalo médio em dias) * 30. */
  estimatedMonthlySpend: number | null;
  countsByPeriod: {
    sixMonths: number;
    oneYear: number;
    all: number;
  };
};

export type ReminderSettings = {
  enabled: boolean;
  leadDays: number;
};

export type ReminderEvaluation = {
  active: boolean;
  level: "none" | "soon" | "due" | "overdue";
  reminderDate: string | null;
  title: string;
  detail: string;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Valida se uma string representa uma data civil real no formato YYYY-MM-DD.
 */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return (
    date.getFullYear() === y &&
    date.getMonth() === m - 1 &&
    date.getDate() === d
  );
}

export function parseCivilDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function formatIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(iso: string, days: number): string {
  const date = parseCivilDate(iso);
  date.setDate(date.getDate() + days);
  return formatIsoDate(date);
}

export function daysBetween(startIso: string, endIso: string): number {
  const start = parseCivilDate(startIso);
  const end = parseCivilDate(endIso);
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

export function getTodayIso(now: Date = new Date()): string {
  return formatIsoDate(now);
}

/**
 * Filtra registros com data civil válida e preço positivo finito,
 * ordenando em ordem cronológica crescente (com desempate determinístico por id).
 * Não modifica nem apaga registros armazenados no IndexedDB.
 */
export function sanitizeAndSortEntries(entries: GasEntry[]): GasEntry[] {
  return entries
    .filter(
      (entry) =>
        typeof entry?.date === "string" &&
        isValidIsoDate(entry.date) &&
        typeof entry?.price === "number" &&
        Number.isFinite(entry.price) &&
        entry.price > 0,
    )
    .sort((a, b) => {
      const dateDiff = a.date.localeCompare(b.date);
      if (dateDiff !== 0) return dateDiff;
      return (a.id ?? 0) - (b.id ?? 0);
    });
}

/**
 * Filtra compras válidas de acordo com o período selecionado em relação à data de referência.
 */
export function filterEntriesByPeriod(
  entries: GasEntry[],
  period: PeriodOption,
  referenceDate: string = getTodayIso(),
): GasEntry[] {
  const sorted = sanitizeAndSortEntries(entries);
  if (period === "Tudo") return sorted;

  const months = period === "6 meses" ? 6 : 12;
  const cutoff = parseCivilDate(referenceDate);
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffIso = formatIsoDate(cutoff);

  return sorted.filter((entry) => entry.date >= cutoffIso);
}

/**
 * Calcula o intervalo médio entre reposições usando média ponderada crescente:
 * - Agrupa compras na mesma data para evitar intervalos artificiais de 0 dia.
 * - Ignora intervalos não positivos.
 * - Aplica peso linear (1..N), dando maior peso aos ciclos mais recentes.
 * - Retorna averageDays = null quando não há ao menos 2 datas distintas.
 */
export function computeAverageInterval(entries: GasEntry[]): IntervalSummary {
  const sorted = sanitizeAndSortEntries(entries);
  const uniqueDates: string[] = [];

  for (const entry of sorted) {
    if (uniqueDates[uniqueDates.length - 1] !== entry.date) {
      uniqueDates.push(entry.date);
    }
  }

  const intervals: number[] = [];
  for (let i = 1; i < uniqueDates.length; i++) {
    const diff = daysBetween(uniqueDates[i - 1], uniqueDates[i]);
    if (diff > 0) {
      intervals.push(diff);
    }
  }

  if (intervals.length === 0) {
    return {
      averageDays: null,
      intervalCount: 0,
      intervals: [],
      confidence: "insufficient",
    };
  }

  let weightedSum = 0;
  let totalWeight = 0;
  for (let i = 0; i < intervals.length; i++) {
    const weight = i + 1;
    weightedSum += intervals[i] * weight;
    totalWeight += weight;
  }

  const averageDays = Math.max(1, Math.round(weightedSum / totalWeight));
  const confidence: ForecastConfidence =
    intervals.length === 1 ? "initial" : "reliable";

  return {
    averageDays,
    intervalCount: intervals.length,
    intervals,
    confidence,
  };
}

/**
 * Calcula a estimativa do botijão em uso com base em todo o histórico válido:
 * - Nível estimado linear: clamp(0..100, (1 - diasDecorridos / intervaloMedio) * 100).
 * - Dias restantes: max(0, intervaloMedio - diasDecorridos).
 * - Dias além da previsão: max(0, diasDecorridos - intervaloMedio).
 * - Próxima reposição estimada: data da última compra + intervaloMedio.
 */
export function computeGasForecast(
  entries: GasEntry[],
  referenceDate: string = getTodayIso(),
): GasForecast {
  const sorted = sanitizeAndSortEntries(entries);
  if (sorted.length === 0) {
    return {
      hasData: false,
      lastPurchase: null,
      elapsedDays: 0,
      interval: {
        averageDays: null,
        intervalCount: 0,
        intervals: [],
        confidence: "insufficient",
      },
      estimatedLevel: null,
      remainingDays: null,
      overdueDays: 0,
      nextEstimatedDate: null,
      tone: "neutral",
    };
  }

  const lastPurchase = sorted[sorted.length - 1];
  const elapsedDays = Math.max(0, daysBetween(lastPurchase.date, referenceDate));
  const interval = computeAverageInterval(sorted);

  if (interval.averageDays === null) {
    return {
      hasData: true,
      lastPurchase,
      elapsedDays,
      interval,
      estimatedLevel: null,
      remainingDays: null,
      overdueDays: 0,
      nextEstimatedDate: null,
      tone: "neutral",
    };
  }

  const daysDelta = interval.averageDays - elapsedDays;
  const remainingDays = Math.max(0, daysDelta);
  const overdueDays = Math.max(0, -daysDelta);
  const rawLevel = (1 - elapsedDays / interval.averageDays) * 100;
  const estimatedLevel = Math.round(Math.max(0, Math.min(100, rawLevel)));
  const nextEstimatedDate = addDays(lastPurchase.date, interval.averageDays);

  const tone: LevelTone =
    estimatedLevel > 50 ? "green" : estimatedLevel > 25 ? "amber" : "red";

  return {
    hasData: true,
    lastPurchase,
    elapsedDays,
    interval,
    estimatedLevel,
    remainingDays,
    overdueDays,
    nextEstimatedDate,
    tone,
  };
}

/**
 * Calcula os indicadores financeiros reais do período selecionado:
 * - Última compra, total gasto e preço médio por botijão.
 * - Intervalo médio ponderado no período.
 * - Variação de preço entre a primeira e a última compra válida do período,
 *   retornando null quando não houver ao menos 2 compras válidas.
 */
export function computeFinancialMetrics(
  filteredEntries: GasEntry[],
): FinancialMetrics {
  const sorted = sanitizeAndSortEntries(filteredEntries);
  const count = sorted.length;

  if (count === 0) {
    return {
      count: 0,
      lastPurchase: null,
      totalSpent: 0,
      averagePrice: null,
      interval: {
        averageDays: null,
        intervalCount: 0,
        intervals: [],
        confidence: "insufficient",
      },
      priceVariation: null,
    };
  }

  const first = sorted[0];
  const lastPurchase = sorted[count - 1];
  const totalSpent = sorted.reduce((sum, entry) => sum + entry.price, 0);
  const averagePrice = totalSpent / count;
  const interval = computeAverageInterval(sorted);

  let priceVariation: PriceVariation | null = null;
  if (count >= 2 && first.price > 0) {
    const absoluteDelta = lastPurchase.price - first.price;
    const percent = (absoluteDelta / first.price) * 100;
    const direction =
      absoluteDelta > 0 ? "up" : absoluteDelta < 0 ? "down" : "flat";
    priceVariation = {
      percent,
      absoluteDelta,
      basePrice: first.price,
      baseDate: first.date,
      direction,
    };
  }

  return {
    count,
    lastPurchase,
    totalSpent,
    averagePrice,
    interval,
    priceVariation,
  };
}

/**
 * Compara a compra válida mais recente com a compra imediatamente anterior.
 * Retorna null quando não houver ao menos 2 compras válidas ou referência válida.
 */
export function computeSavingsComparison(
  entries: GasEntry[],
): SavingsComparison | null {
  const sorted = sanitizeAndSortEntries(entries);
  if (sorted.length < 2) return null;

  const previous = sorted[sorted.length - 2];
  const current = sorted[sorted.length - 1];
  if (previous.price <= 0) return null;

  const difference = previous.price - current.price;
  const percent = (Math.abs(difference) / previous.price) * 100;
  const status =
    difference > 0 ? "saved" : difference < 0 ? "increased" : "unchanged";

  return {
    previous,
    current,
    difference,
    percent,
    status,
  };
}

export function normalizeVendorName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Agrupa histórico e estatísticas de preços por fornecedor dentro do período selecionado.
 * Identifica o menor preço registrado exclusivamente com base nos dados do próprio usuário.
 */
export function computeVendorComparison(
  entries: GasEntry[],
  vendors: GasVendor[],
  period: PeriodOption,
  referenceDate: string = getTodayIso(),
): VendorComparisonSummary {
  const filtered = filterEntriesByPeriod(entries, period, referenceDate);
  const vendorByKey = new Map<string, GasVendor>();

  for (const v of vendors) {
    const key = normalizeVendorName(v.name);
    if (key && !vendorByKey.has(key)) {
      vendorByKey.set(key, v);
    }
  }

  const entriesByKey = new Map<string, GasEntry[]>();
  for (const entry of filtered) {
    const key = normalizeVendorName(entry.vendor || "");
    if (!key) continue;
    const list = entriesByKey.get(key) ?? [];
    list.push(entry);
    entriesByKey.set(key, list);
  }

  const allKeys = new Set<string>([
    ...vendorByKey.keys(),
    ...entriesByKey.keys(),
  ]);

  let lowestPrice: number | null = null;
  const draftItems: VendorStats[] = [];

  for (const key of allKeys) {
    const vendor = vendorByKey.get(key) ?? null;
    const vendorEntries = entriesByKey.get(key) ?? [];
    const displayName =
      vendor?.name.trim() || vendorEntries[vendorEntries.length - 1]?.vendor.trim() || "";
    if (!displayName) continue;

    if (vendorEntries.length === 0) {
      draftItems.push({
        name: displayName,
        normalizedName: key,
        vendor,
        purchaseCount: 0,
        minPrice: null,
        maxPrice: null,
        averagePrice: null,
        lastPrice: null,
        lastDate: null,
        isLowestRegistered: false,
        history: [],
      });
      continue;
    }

    const prices = vendorEntries.map((e) => e.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const averagePrice = prices.reduce((s, p) => s + p, 0) / prices.length;
    const last = vendorEntries[vendorEntries.length - 1];

    if (lowestPrice === null || minPrice < lowestPrice) {
      lowestPrice = minPrice;
    }

    draftItems.push({
      name: displayName,
      normalizedName: key,
      vendor,
      purchaseCount: vendorEntries.length,
      minPrice,
      maxPrice,
      averagePrice,
      lastPrice: last.price,
      lastDate: last.date,
      isLowestRegistered: false,
      history: [...vendorEntries].reverse(),
    });
  }

  const lowestVendorNames: string[] = [];
  const items = draftItems
    .map((item) => {
      const isLowestRegistered =
        lowestPrice !== null &&
        item.minPrice !== null &&
        item.minPrice === lowestPrice;
      if (isLowestRegistered) {
        lowestVendorNames.push(item.name);
      }
      return { ...item, isLowestRegistered };
    })
    .sort((a, b) => {
      if (a.minPrice !== null && b.minPrice !== null) {
        if (a.minPrice !== b.minPrice) return a.minPrice - b.minPrice;
        return b.purchaseCount - a.purchaseCount;
      }
      if (a.minPrice !== null) return -1;
      if (b.minPrice !== null) return 1;
      return a.name.localeCompare(b.name, "pt-BR");
    });

  return {
    items,
    lowestPrice,
    lowestVendorNames,
    totalPurchasesInPeriod: filtered.length,
  };
}

/**
 * Calcula estatísticas de consumo para o período selecionado,
 * separando gasto efetivamente realizado de gasto médio mensal estimado.
 * Premissa do gasto mensal estimado: (preço médio ÷ intervalo médio em dias) × 30 dias.
 */
export function computeConsumptionStats(
  entries: GasEntry[],
  period: PeriodOption,
  referenceDate: string = getTodayIso(),
): ConsumptionStats {
  const allValid = sanitizeAndSortEntries(entries);
  const filtered = filterEntriesByPeriod(allValid, period, referenceDate);
  const sixMonths = filterEntriesByPeriod(allValid, "6 meses", referenceDate);
  const oneYear = filterEntriesByPeriod(allValid, "1 ano", referenceDate);

  const metrics = computeFinancialMetrics(filtered);
  const prices = filtered.map((e) => e.price);
  const minPrice = prices.length ? Math.min(...prices) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;

  const intervals = metrics.interval.intervals;
  const minIntervalDays = intervals.length ? Math.min(...intervals) : null;
  const maxIntervalDays = intervals.length ? Math.max(...intervals) : null;

  const estimatedMonthlySpend =
    metrics.averagePrice !== null &&
    metrics.interval.averageDays !== null &&
    metrics.interval.averageDays > 0
      ? (metrics.averagePrice / metrics.interval.averageDays) * 30
      : null;

  return {
    period,
    purchaseCount: metrics.count,
    totalSpentRealized: metrics.totalSpent,
    averagePrice: metrics.averagePrice,
    minPrice,
    maxPrice,
    interval: metrics.interval,
    minIntervalDays,
    maxIntervalDays,
    estimatedMonthlySpend,
    countsByPeriod: {
      sixMonths: sixMonths.length,
      oneYear: oneYear.length,
      all: allValid.length,
    },
  };
}

/**
 * Avalia se o lembrete de reposição deve ser exibido com base na previsão
 * e no prazo de antecedência configurado pelo usuário.
 */
export function evaluateReminder(
  forecast: GasForecast,
  settings: ReminderSettings,
): ReminderEvaluation {
  if (
    !settings.enabled ||
    !forecast.hasData ||
    forecast.nextEstimatedDate === null ||
    forecast.remainingDays === null
  ) {
    return {
      active: false,
      level: "none",
      reminderDate: null,
      title: "",
      detail: "",
    };
  }

  const safeLeadDays = Math.max(1, Math.min(60, Math.round(settings.leadDays)));
  const reminderDate = addDays(forecast.nextEstimatedDate, -safeLeadDays);

  if (forecast.overdueDays > 0) {
    return {
      active: true,
      level: "overdue",
      reminderDate,
      title: "Previsão de reposição superada",
      detail: `O prazo médio estimado foi atingido há ${forecast.overdueDays} ${forecast.overdueDays === 1 ? "dia" : "dias"} (previsão era ${formatBrDate(forecast.nextEstimatedDate)}).`,
    };
  }

  if (forecast.remainingDays === 0) {
    return {
      active: true,
      level: "due",
      reminderDate,
      title: "Reposição estimada para hoje",
      detail: `Pelo seu histórico, hoje (${formatBrDate(forecast.nextEstimatedDate)}) é a data prevista para a próxima compra.`,
    };
  }

  if (forecast.remainingDays <= safeLeadDays) {
    return {
      active: true,
      level: "soon",
      reminderDate,
      title: `Reposição prevista em ~${forecast.remainingDays} ${forecast.remainingDays === 1 ? "dia" : "dias"}`,
      detail: `Data estimada: ${formatBrDate(forecast.nextEstimatedDate)} (lembrete configurado para ${safeLeadDays} dias antes).`,
    };
  }

  return {
    active: false,
    level: "none",
    reminderDate,
    title: "",
    detail: "",
  };
}

function formatBrDate(iso: string): string {
  return iso ? iso.split("-").reverse().join("/") : "";
}

function formatBrl(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function escapeCsvCell(value: string): string {
  const clean = value.replace(/\r?\n/g, " ");
  const formulaSafe = /^[=+\-@]/.test(clean) ? `'${clean}` : clean;
  if (/[;"]/.test(formulaSafe)) {
    return `"${formulaSafe.replace(/"/g, '""')}"`;
  }
  return formulaSafe;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Gera um arquivo de calendário (.ics) para o lembrete da próxima reposição estimada.
 * Permite receber alertas nativos no celular mesmo com o PWA fechado.
 */
export function buildReminderIcs(
  forecast: GasForecast,
  leadDays: number,
): string | null {
  if (!forecast.hasData || !forecast.nextEstimatedDate) return null;

  const safeLead = Math.max(1, Math.min(60, Math.round(leadDays)));
  const reminderDate = addDays(forecast.nextEstimatedDate, -safeLead);
  const startStamp = reminderDate.replace(/-/g, "");
  const endStamp = addDays(reminderDate, 1).replace(/-/g, "");
  const dtStamp =
    new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Controle do Gas PWA//Lembrete//PT-BR",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:controle-gas-${forecast.nextEstimatedDate}@local`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART;VALUE=DATE:${startStamp}`,
    `DTEND;VALUE=DATE:${endStamp}`,
    "SUMMARY:Verificar botijão de gás (previsão de reposição)",
    `DESCRIPTION:Previsão estimada de término do botijão em ${formatBrDate(forecast.nextEstimatedDate)} com base no seu histórico de compras.`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Verificar nível do botijão de gás",
    "TRIGGER:-PT0M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

/**
 * Gera planilha CSV compatível com Excel (UTF-8 com BOM e separador ;)
 * respeitando o período selecionado.
 */
export function buildReportCsv(
  entries: GasEntry[],
  vendors: GasVendor[],
  period: PeriodOption,
  referenceDate: string = getTodayIso(),
): string {
  const filtered = filterEntriesByPeriod(entries, period, referenceDate);
  const stats = computeConsumptionStats(entries, period, referenceDate);
  const vendorSummary = computeVendorComparison(
    entries,
    vendors,
    period,
    referenceDate,
  );
  const lines: string[] = [];

  lines.push("Relatório Controle do Gás");
  lines.push(`Período;${escapeCsvCell(period)}`);
  lines.push(`Gerado em;${formatBrDate(referenceDate)}`);
  lines.push("");

  lines.push("RESUMO E ESTATÍSTICAS DE CONSUMO");
  lines.push("Indicador;Valor");
  lines.push(`Compras no período;${stats.purchaseCount}`);
  lines.push(
    `Total gasto (realizado);${stats.purchaseCount > 0 ? stats.totalSpentRealized.toFixed(2).replace(".", ",") : "-"}`,
  );
  lines.push(
    `Preço médio por botijão;${stats.averagePrice !== null ? stats.averagePrice.toFixed(2).replace(".", ",") : "-"}`,
  );
  lines.push(
    `Menor preço no período;${stats.minPrice !== null ? stats.minPrice.toFixed(2).replace(".", ",") : "-"}`,
  );
  lines.push(
    `Maior preço no período;${stats.maxPrice !== null ? stats.maxPrice.toFixed(2).replace(".", ",") : "-"}`,
  );
  lines.push(
    `Intervalo médio (dias);${stats.interval.averageDays !== null ? stats.interval.averageDays : "-"}`,
  );
  lines.push(
    `Gasto médio mensal estimado (30 dias);${stats.estimatedMonthlySpend !== null ? stats.estimatedMonthlySpend.toFixed(2).replace(".", ",") : "-"}`,
  );
  lines.push("");

  lines.push("COMPARATIVO POR FORNECEDOR NO PERÍODO");
  lines.push("Fornecedor;Compras;Menor preço;Preço médio;Último preço");
  for (const item of vendorSummary.items.filter((v) => v.purchaseCount > 0)) {
    lines.push(
      [
        escapeCsvCell(item.name),
        String(item.purchaseCount),
        item.minPrice!.toFixed(2).replace(".", ","),
        item.averagePrice!.toFixed(2).replace(".", ","),
        item.lastPrice!.toFixed(2).replace(".", ","),
      ].join(";"),
    );
  }
  lines.push("");

  lines.push("HISTÓRICO DE COMPRAS NO PERÍODO");
  lines.push("Data;Fornecedor;Valor (R$);Forma de pagamento;Observações");
  for (const entry of [...filtered].reverse()) {
    lines.push(
      [
        formatBrDate(entry.date),
        escapeCsvCell(entry.vendor),
        entry.price.toFixed(2).replace(".", ","),
        escapeCsvCell(entry.mode || ""),
        escapeCsvCell(entry.notes || ""),
      ].join(";"),
    );
  }

  return `\uFEFF${lines.join("\r\n")}`;
}

/**
 * Gera documento HTML otimizado para impressão e exportação em PDF,
 * incluindo estatísticas, gráfico SVG de evolução de preços, fornecedores e histórico.
 */
export function buildPrintableReportHtml(
  entries: GasEntry[],
  vendors: GasVendor[],
  period: PeriodOption,
  referenceDate: string = getTodayIso(),
): string {
  const filtered = filterEntriesByPeriod(entries, period, referenceDate);
  const forecast = computeGasForecast(entries, referenceDate);
  const stats = computeConsumptionStats(entries, period, referenceDate);
  const vendorSummary = computeVendorComparison(
    entries,
    vendors,
    period,
    referenceDate,
  );

  let chartMarkup = "<p class=\"muted\">Registre pelo menos 2 compras neste período para exibir a evolução de preços.</p>";
  if (filtered.length >= 2) {
    const prices = filtered.map((e) => e.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
    const range = max - min || 1;
    const w = 640;
    const h = 170;
    const padX = 24;
    const padY = 20;
    const plotW = w - padX * 2;
    const plotH = h - padY * 2;
    const getY = (p: number) =>
      max === min ? padY + plotH / 2 : padY + (1 - (p - min) / range) * plotH;
    const pts = filtered
      .map(
        (e, i) =>
          `${(padX + (i / (filtered.length - 1)) * plotW).toFixed(1)},${getY(e.price).toFixed(1)}`,
      )
      .join(" ");
    const avgY = getY(avg).toFixed(1);
    const dots = filtered
      .map((e, i) => {
        const cx = (padX + (i / (filtered.length - 1)) * plotW).toFixed(1);
        const cy = getY(e.price).toFixed(1);
        return `<circle cx="${cx}" cy="${cy}" r="3.5" fill="#129969" />`;
      })
      .join("");

    chartMarkup = `
      <svg viewBox="0 0 ${w} ${h}" width="100%" height="170" xmlns="http://www.w3.org/2000/svg">
        <line x1="${padX}" y1="${avgY}" x2="${w - padX}" y2="${avgY}" stroke="#94a3b8" stroke-dasharray="4 4" stroke-width="1" />
        <polyline fill="none" stroke="#129969" stroke-width="2.5" points="${pts}" />
        ${dots}
      </svg>
      <p class="muted">De ${formatBrDate(filtered[0].date)} a ${formatBrDate(filtered[filtered.length - 1].date)} · Menor: ${formatBrl(min)} · Média: ${formatBrl(avg)} · Maior: ${formatBrl(max)}</p>
    `;
  }

  const vendorRows = vendorSummary.items
    .filter((v) => v.purchaseCount > 0)
    .map(
      (v) => `
      <tr>
        <td>${escapeHtml(v.name)}${v.isLowestRegistered ? " <strong>(Menor registrado)</strong>" : ""}</td>
        <td>${v.purchaseCount}</td>
        <td>${formatBrl(v.minPrice!)}</td>
        <td>${formatBrl(v.averagePrice!)}</td>
        <td>${formatBrl(v.lastPrice!)}</td>
      </tr>`,
    )
    .join("");

  const historyRows = [...filtered]
    .reverse()
    .map(
      (e) => `
      <tr>
        <td>${formatBrDate(e.date)}</td>
        <td>${escapeHtml(e.vendor)}</td>
        <td>${escapeHtml(e.mode || "—")}</td>
        <td>${escapeHtml(e.notes || "—")}</td>
        <td class="num">${formatBrl(e.price)}</td>
      </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Relatório Controle do Gás — ${escapeHtml(period)}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #10201a; margin: 0; padding: 16px; line-height: 1.45; }
    h1 { margin: 0 0 4px; font-size: 22px; color: #0f6e56; }
    h2 { margin: 22px 0 8px; font-size: 15px; border-bottom: 1px solid #d5e2dc; padding-bottom: 4px; color: #10201a; }
    .muted { color: #52665e; font-size: 12px; margin: 4px 0 0; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 12px; }
    .card { border: 1px solid #d5e2dc; border-radius: 10px; padding: 10px 12px; background: #f8fbf9; }
    .card span { display: block; font-size: 11px; text-transform: uppercase; color: #52665e; }
    .card strong { display: block; font-size: 16px; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
    th, td { border-bottom: 1px solid #e3ece8; padding: 7px 6px; text-align: left; }
    th { background: #eef4f1; font-weight: 600; }
    .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  </style>
</head>
<body>
  <h1>Relatório — Controle do Gás</h1>
  <p class="muted">Período: ${escapeHtml(period)} · Emitido em ${formatBrDate(referenceDate)}</p>

  <h2>Situação estimada do botijão atual</h2>
  <div class="grid">
    <div class="card"><span>Nível estimado</span><strong>${forecast.estimatedLevel !== null ? `${forecast.estimatedLevel}%` : "—"}</strong></div>
    <div class="card"><span>Última reposição</span><strong>${forecast.lastPurchase ? formatBrDate(forecast.lastPurchase.date) : "—"}</strong></div>
    <div class="card"><span>Próxima estimada</span><strong>${forecast.nextEstimatedDate ? formatBrDate(forecast.nextEstimatedDate) : "Aguardando histórico"}</strong></div>
    <div class="card"><span>Intervalo médio geral</span><strong>${forecast.interval.averageDays !== null ? `${forecast.interval.averageDays} dias` : "—"}</strong></div>
  </div>

  <h2>Resumo financeiro e estatísticas (${escapeHtml(period)})</h2>
  <div class="grid">
    <div class="card"><span>Total gasto (realizado)</span><strong>${stats.purchaseCount > 0 ? formatBrl(stats.totalSpentRealized) : "—"}</strong></div>
    <div class="card"><span>Preço médio</span><strong>${stats.averagePrice !== null ? formatBrl(stats.averagePrice) : "—"}</strong></div>
    <div class="card"><span>Intervalo médio</span><strong>${stats.interval.averageDays !== null ? `${stats.interval.averageDays} dias` : "—"}</strong></div>
    <div class="card"><span>Gasto mensal estimado</span><strong>${stats.estimatedMonthlySpend !== null ? formatBrl(stats.estimatedMonthlySpend) : "—"}</strong></div>
  </div>
  <p class="muted">Premissa do gasto mensal estimado: (preço médio ÷ intervalo médio em dias) × 30 dias. Compras registradas: ${stats.purchaseCount} no período (${stats.countsByPeriod.all} no total).</p>

  <h2>Evolução de preços</h2>
  ${chartMarkup}

  <h2>Comparativo de fornecedores</h2>
  ${
    vendorRows
      ? `<table><thead><tr><th>Fornecedor</th><th>Compras</th><th>Menor</th><th>Médio</th><th>Último</th></tr></thead><tbody>${vendorRows}</tbody></table>`
      : "<p class=\"muted\">Nenhuma compra associada a fornecedores neste período.</p>"
  }

  <h2>Histórico de compras</h2>
  ${
    historyRows
      ? `<table><thead><tr><th>Data</th><th>Fornecedor</th><th>Pagamento</th><th>Observações</th><th class="num">Valor</th></tr></thead><tbody>${historyRows}</tbody></table>`
      : "<p class=\"muted\">Nenhuma compra registrada neste período.</p>"
  }
</body>
</html>`;
}
