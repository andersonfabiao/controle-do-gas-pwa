import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPrintableReportHtml,
  buildReminderIcs,
  buildReportCsv,
  computeAverageInterval,
  computeConsumptionStats,
  computeFinancialMetrics,
  computeGasForecast,
  computeSavingsComparison,
  computeVendorComparison,
  evaluateReminder,
  filterEntriesByPeriod,
  isValidIsoDate,
  sanitizeAndSortEntries,
} from "../lib/gas-metrics.ts";

test("validates calendar ISO dates and ignores invalid records safely", () => {
  assert.equal(isValidIsoDate("2026-07-15"), true);
  assert.equal(isValidIsoDate("2026-02-30"), false);
  assert.equal(isValidIsoDate("15/07/2026"), false);
  assert.equal(isValidIsoDate(""), false);

  const sanitized = sanitizeAndSortEntries([
    { id: 1, date: "2026-07-10", price: 110, mode: "Pix", vendor: "A" },
    { id: 2, date: "2026-02-30", price: 100, mode: "Pix", vendor: "Inválida" },
    { id: 3, date: "2026-07-12", price: 0, mode: "Pix", vendor: "Preço zero" },
    { id: 4, date: "2026-07-12", price: -50, mode: "Pix", vendor: "Negativo" },
    { id: 5, date: "2026-07-12", price: Number.NaN, mode: "Pix", vendor: "NaN" },
    { id: 6, date: "2026-06-01", price: 105, mode: "Pix", vendor: "B" },
  ]);

  assert.equal(sanitized.length, 2);
  assert.equal(sanitized[0].date, "2026-06-01");
  assert.equal(sanitized[1].date, "2026-07-10");
});

test("handles empty history and single purchase without misleading estimates", () => {
  const emptyForecast = computeGasForecast([], "2026-08-01");
  assert.equal(emptyForecast.hasData, false);
  assert.equal(emptyForecast.estimatedLevel, null);
  assert.equal(emptyForecast.nextEstimatedDate, null);

  const singleForecast = computeGasForecast(
    [{ id: 1, date: "2026-07-20", price: 110, mode: "Pix", vendor: "Revenda" }],
    "2026-08-01",
  );
  assert.equal(singleForecast.hasData, true);
  assert.equal(singleForecast.elapsedDays, 12);
  assert.equal(singleForecast.estimatedLevel, null);
  assert.equal(singleForecast.remainingDays, null);
  assert.equal(singleForecast.nextEstimatedDate, null);
  assert.equal(singleForecast.interval.confidence, "insufficient");
  assert.equal(singleForecast.tone, "neutral");
});

test("deduplicates same-day purchases when calculating average interval", () => {
  const sameDayOnly = computeAverageInterval([
    { id: 1, date: "2026-07-01", price: 110, mode: "Pix", vendor: "A" },
    { id: 2, date: "2026-07-01", price: 112, mode: "Pix", vendor: "A" },
  ]);
  assert.equal(sameDayOnly.averageDays, null);
  assert.equal(sameDayOnly.intervalCount, 0);
  assert.equal(sameDayOnly.confidence, "insufficient");

  const withSameDayDuplicate = computeAverageInterval([
    { id: 1, date: "2026-01-01", price: 100, mode: "Pix", vendor: "A" },
    { id: 2, date: "2026-01-01", price: 100, mode: "Pix", vendor: "A" },
    { id: 3, date: "2026-02-10", price: 105, mode: "Pix", vendor: "A" },
  ]);
  assert.equal(withSameDayDuplicate.averageDays, 40);
  assert.equal(withSameDayDuplicate.intervalCount, 1);
  assert.equal(withSameDayDuplicate.confidence, "initial");
});

test("computes weighted interval, estimated level, remaining days, and overdue state", () => {
  // Intervalos: 30 dias (peso 1) e 60 dias (peso 2) => (30*1 + 60*2)/3 = 50 dias
  const entries = [
    { id: 1, date: "2026-01-01", price: 100, mode: "Pix", vendor: "A" },
    { id: 2, date: "2026-01-31", price: 105, mode: "Pix", vendor: "A" },
    { id: 3, date: "2026-04-01", price: 115, mode: "Pix", vendor: "B" },
  ];

  // 15 dias após 2026-04-01 => 35 dias restantes, nível estimado = 70%
  const active = computeGasForecast(entries, "2026-04-16");
  assert.equal(active.interval.averageDays, 50);
  assert.equal(active.interval.confidence, "reliable");
  assert.equal(active.elapsedDays, 15);
  assert.equal(active.remainingDays, 35);
  assert.equal(active.overdueDays, 0);
  assert.equal(active.estimatedLevel, 70);
  assert.equal(active.nextEstimatedDate, "2026-05-21");
  assert.equal(active.tone, "green");

  // 58 dias após 2026-04-01 => superado há 8 dias, nível clamped em 0%
  const overdue = computeGasForecast(entries, "2026-05-29");
  assert.equal(overdue.remainingDays, 0);
  assert.equal(overdue.overdueDays, 8);
  assert.equal(overdue.estimatedLevel, 0);
  assert.equal(overdue.tone, "red");
});

test("computes average price, total spent, and explicit price variation safely", () => {
  const emptyMetrics = computeFinancialMetrics([]);
  assert.equal(emptyMetrics.count, 0);
  assert.equal(emptyMetrics.averagePrice, null);
  assert.equal(emptyMetrics.priceVariation, null);

  const singleMetrics = computeFinancialMetrics([
    { id: 1, date: "2026-06-01", price: 120, mode: "Pix", vendor: "A" },
  ]);
  assert.equal(singleMetrics.count, 1);
  assert.equal(singleMetrics.totalSpent, 120);
  assert.equal(singleMetrics.averagePrice, 120);
  assert.equal(singleMetrics.priceVariation, null);

  const multiMetrics = computeFinancialMetrics([
    { id: 1, date: "2026-01-01", price: 100, mode: "Pix", vendor: "A" },
    { id: 2, date: "2026-03-01", price: 110, mode: "Pix", vendor: "B" },
    { id: 3, date: "2026-05-01", price: 120, mode: "Pix", vendor: "A" },
  ]);
  assert.equal(multiMetrics.count, 3);
  assert.equal(multiMetrics.totalSpent, 330);
  assert.equal(multiMetrics.averagePrice, 110);
  assert.ok(multiMetrics.priceVariation);
  assert.equal(multiMetrics.priceVariation.percent, 20);
  assert.equal(multiMetrics.priceVariation.absoluteDelta, 20);
  assert.equal(multiMetrics.priceVariation.baseDate, "2026-01-01");
  assert.equal(multiMetrics.priceVariation.basePrice, 100);
  assert.equal(multiMetrics.priceVariation.direction, "up");
});

test("filters periods accurately including empty period results", () => {
  const entries = [
    { id: 1, date: "2024-01-10", price: 95, mode: "Pix", vendor: "A" },
    { id: 2, date: "2026-01-15", price: 110, mode: "Pix", vendor: "A" },
    { id: 3, date: "2026-09-01", price: 115, mode: "Pix", vendor: "B" },
  ];

  const sixMonths = filterEntriesByPeriod(entries, "6 meses", "2026-10-01");
  assert.equal(sixMonths.length, 1);
  assert.equal(sixMonths[0].date, "2026-09-01");

  const oneYear = filterEntriesByPeriod(entries, "1 ano", "2026-10-01");
  assert.equal(oneYear.length, 2);

  const noneInPeriod = filterEntriesByPeriod(
    [{ id: 1, date: "2024-01-10", price: 95, mode: "Pix", vendor: "A" }],
    "6 meses",
    "2026-10-01",
  );
  assert.equal(noneInPeriod.length, 0);
});

test("computes savings comparison only when previous valid purchase exists", () => {
  assert.equal(computeSavingsComparison([]), null);
  assert.equal(
    computeSavingsComparison([
      { id: 1, date: "2026-07-01", price: 113, mode: "Pix", vendor: "A" },
    ]),
    null,
  );

  // Exemplo da especificação: R$ 113 -> R$ 95 => redução de R$ 18 (15,9%)
  const saved = computeSavingsComparison([
    { id: 1, date: "2026-05-01", price: 113, mode: "Pix", vendor: "Revenda A" },
    { id: 2, date: "2026-07-01", price: 95, mode: "", vendor: "Revenda B" },
  ]);
  assert.ok(saved);
  assert.equal(saved.status, "saved");
  assert.equal(saved.difference, 18);
  assert.equal(Number(saved.percent.toFixed(1)), 15.9);

  const increased = computeSavingsComparison([
    { id: 1, date: "2026-05-01", price: 100, mode: "Pix", vendor: "A" },
    { id: 2, date: "2026-07-01", price: 112, mode: "Pix", vendor: "A" },
  ]);
  assert.ok(increased);
  assert.equal(increased.status, "increased");
  assert.equal(increased.difference, -12);
  assert.equal(increased.percent, 12);

  const unchanged = computeSavingsComparison([
    { id: 1, date: "2026-05-01", price: 105, mode: "Pix", vendor: "A" },
    { id: 2, date: "2026-07-01", price: 105, mode: "Pix", vendor: "A" },
  ]);
  assert.ok(unchanged);
  assert.equal(unchanged.status, "unchanged");
  assert.equal(unchanged.difference, 0);
});

test("compares vendor prices per period and identifies lowest registered price", () => {
  const vendors = [
    { id: 1, name: "Gás Azul", phone: "11999990000", contactType: "whatsapp" },
    { id: 2, name: "Disk Gás", phone: "1133334444", contactType: "phone" },
    { id: 3, name: "Sem Compras", phone: "", contactType: "app" },
  ];
  const entries = [
    { id: 1, date: "2025-01-10", price: 89, mode: "Pix", vendor: "Disk Gás" },
    { id: 2, date: "2026-05-10", price: 112, mode: "Pix", vendor: "Gás Azul" },
    { id: 3, date: "2026-07-15", price: 104, mode: "", vendor: "gás azul", notes: "Promoção" },
    { id: 4, date: "2026-08-20", price: 108, mode: "Dinheiro", vendor: "Disk Gás" },
  ];

  const allSummary = computeVendorComparison(entries, vendors, "Tudo", "2026-09-01");
  assert.equal(allSummary.lowestPrice, 89);
  assert.deepEqual(allSummary.lowestVendorNames, ["Disk Gás"]);
  assert.equal(allSummary.items[0].name, "Disk Gás");
  assert.equal(allSummary.items[0].isLowestRegistered, true);

  // Nos últimos 6 meses (a partir de 2026-03-01), a compra de R$ 89 em 2025 não entra
  const sixMonthsSummary = computeVendorComparison(
    entries,
    vendors,
    "6 meses",
    "2026-09-01",
  );
  assert.equal(sixMonthsSummary.lowestPrice, 104);
  assert.deepEqual(sixMonthsSummary.lowestVendorNames, ["Gás Azul"]);
  assert.equal(sixMonthsSummary.items[0].name, "Gás Azul");
  assert.equal(sixMonthsSummary.items[0].purchaseCount, 2);
  assert.equal(sixMonthsSummary.items[0].averagePrice, 108);
  assert.equal(sixMonthsSummary.items[0].history[0].notes, "Promoção");
});

test("computes consumption statistics separating realized spend from monthly estimate", () => {
  const entries = [
    { id: 1, date: "2025-02-01", price: 90, mode: "Pix", vendor: "A" },
    { id: 2, date: "2026-04-01", price: 100, mode: "Pix", vendor: "A" },
    { id: 3, date: "2026-06-01", price: 120, mode: "Pix", vendor: "B" },
  ];

  // Nos últimos 6 meses (a partir de 2026-03-01): 2 compras, média R$ 110, intervalo 61 dias
  // Estimativa mensal: (110 / 61) * 30 ≈ 54.10
  const stats = computeConsumptionStats(entries, "6 meses", "2026-09-01");
  assert.equal(stats.purchaseCount, 2);
  assert.equal(stats.totalSpentRealized, 220);
  assert.equal(stats.averagePrice, 110);
  assert.equal(stats.interval.averageDays, 61);
  assert.equal(stats.minIntervalDays, 61);
  assert.equal(stats.maxIntervalDays, 61);
  assert.ok(stats.estimatedMonthlySpend !== null);
  assert.equal(Number(stats.estimatedMonthlySpend.toFixed(2)), 54.1);
  assert.deepEqual(stats.countsByPeriod, { sixMonths: 2, oneYear: 2, all: 3 });

  const singleStats = computeConsumptionStats([entries[2]], "Tudo", "2026-09-01");
  assert.equal(singleStats.estimatedMonthlySpend, null);
});

test("evaluates reminders accurately and generates valid ICS calendar event", () => {
  const entries = [
    { id: 1, date: "2026-01-01", price: 100, mode: "Pix", vendor: "A" },
    { id: 2, date: "2026-03-02", price: 110, mode: "Pix", vendor: "A" },
  ]; // intervalo: 60 dias -> próxima estimada: 2026-05-01

  const farForecast = computeGasForecast(entries, "2026-04-10");
  assert.equal(
    evaluateReminder(farForecast, { enabled: true, leadDays: 7 }).active,
    false,
  );

  const soonForecast = computeGasForecast(entries, "2026-04-26");
  const soonEval = evaluateReminder(soonForecast, { enabled: true, leadDays: 7 });
  assert.equal(soonEval.active, true);
  assert.equal(soonEval.level, "soon");
  assert.equal(soonEval.reminderDate, "2026-04-24");

  assert.equal(
    evaluateReminder(soonForecast, { enabled: false, leadDays: 7 }).active,
    false,
  );

  const overdueForecast = computeGasForecast(entries, "2026-05-05");
  const overdueEval = evaluateReminder(overdueForecast, { enabled: true, leadDays: 7 });
  assert.equal(overdueEval.active, true);
  assert.equal(overdueEval.level, "overdue");

  const ics = buildReminderIcs(soonForecast, 7);
  assert.ok(ics);
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /DTSTART;VALUE=DATE:20260424/);
  assert.match(ics, /END:VCALENDAR/);
});

test("builds filtered CSV and printable PDF HTML reports safely", () => {
  const vendors = [
    { id: 1, name: "Revenda Central", phone: "11999990000", contactType: "whatsapp" },
  ];
  const entries = [
    { id: 1, date: "2025-01-01", price: 90, mode: "Pix", vendor: "Antiga" },
    { id: 2, date: "2026-06-01", price: 110, mode: "Pix", vendor: "Revenda Central", notes: "Entrega rápida" },
    { id: 3, date: "2026-08-01", price: 105, mode: "", vendor: "Revenda Central" },
  ];

  const csv = buildReportCsv(entries, vendors, "6 meses", "2026-09-01");
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /Período;6 meses/);
  assert.match(csv, /Revenda Central/);
  assert.doesNotMatch(csv, /Antiga/);

  const html = buildPrintableReportHtml(entries, vendors, "6 meses", "2026-09-01");
  assert.match(html, /Relatório — Controle do Gás/);
  assert.match(html, /<svg viewBox=/);
  assert.match(html, /Revenda Central/);
  assert.doesNotMatch(html, /Antiga/);
});
