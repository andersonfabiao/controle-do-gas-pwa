"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildPrintableReportHtml,
  buildReminderIcs,
  buildReportCsv,
  computeConsumptionStats,
  computeFinancialMetrics,
  computeGasForecast,
  computeSavingsComparison,
  computeVendorComparison,
  evaluateReminder,
  filterEntriesByPeriod,
  getTodayIso,
  isValidIsoDate,
  normalizeVendorName,
  parseCivilDate,
  type GasEntry,
  type GasVendor,
  type PeriodOption,
  type ReminderSettings,
} from "@/lib/gas-metrics";

type Entry = GasEntry;
type Vendor = GasVendor;

type Tab = "dashboard" | "add" | "history" | "vendors" | "settings";
type Theme = "auto" | "light" | "dark";

const MODES = ["Pix", "Dinheiro", "Cartão de crédito", "Cartão de débito"];
const BASE_PATH = "/controle-do-gas-pwa";

const db = {
  open: () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("gastracker", 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("entries")) {
          database.createObjectStore("entries", {
            keyPath: "id",
            autoIncrement: true,
          });
        }
        if (!database.objectStoreNames.contains("vendors")) {
          database.createObjectStore("vendors", {
            keyPath: "id",
            autoIncrement: true,
          });
        }
        if (!database.objectStoreNames.contains("settings")) {
          database.createObjectStore("settings", { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }),

  all: async <T,>(store: string) => {
    const database = await db.open();
    return new Promise<T[]>((resolve, reject) => {
      const request = database.transaction(store).objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  put: async (store: string, value: object) => {
    const database = await db.open();
    return new Promise<void>((resolve, reject) => {
      const request = database
        .transaction(store, "readwrite")
        .objectStore(store)
        .put(value);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  delete: async (store: string, id: IDBValidKey) => {
    const database = await db.open();
    return new Promise<void>((resolve, reject) => {
      const request = database
        .transaction(store, "readwrite")
        .objectStore(store)
        .delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  replace: async (
    entries: Entry[],
    vendors: Vendor[],
    settings?: { theme?: Theme; reminder?: ReminderSettings },
  ) => {
    const database = await db.open();
    return new Promise<void>((resolve, reject) => {
      const tx = database.transaction(
        ["entries", "vendors", "settings"],
        "readwrite",
      );
      const es = tx.objectStore("entries");
      const vs = tx.objectStore("vendors");
      const ss = tx.objectStore("settings");

      es.clear();
      vs.clear();
      entries.forEach((e) => es.put(e));
      vendors.forEach((v) => vs.put(v));
      if (settings?.theme) {
        ss.put({ key: "theme", value: settings.theme });
      }
      if (settings?.reminder) {
        ss.put({ key: "reminder", value: settings.reminder });
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};

const brl = (n: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(n);

const brDate = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");

const shortBrDate = (iso: string) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
};

const today = () => getTodayIso();

const civil = (s: string) => parseCivilDate(s);

const download = (name: string, text: string, type: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
};

const printHtmlReport = (html: string) => {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.srcdoc = html;
  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      window.setTimeout(() => iframe.remove(), 1500);
    }
  };
  document.body.appendChild(iframe);
};

const DEFAULT_REMINDER: ReminderSettings = { enabled: true, leadDays: 7 };
const REMINDER_LEAD_OPTIONS = ["3", "5", "7", "10", "15"];

const iosConfirm = (message: string, destructive = false) =>
  new Promise<boolean>((resolve) => {
    const sheet = document.createElement("div");
    sheet.className = "modal confirm-sheet";

    const card = document.createElement("article");
    const title = document.createElement("h2");
    const actions = document.createElement("div");

    title.textContent = message;
    actions.className = "actions";

    const cancel = document.createElement("button");
    const confirmButton = document.createElement("button");
    cancel.textContent = "Cancelar";
    confirmButton.textContent = "Confirmar";
    if (destructive) confirmButton.className = "danger";

    const finish = (result: boolean) => {
      sheet.remove();
      resolve(result);
    };

    cancel.onclick = () => finish(false);
    confirmButton.onclick = () => finish(true);
    sheet.onclick = (e) => {
      if (e.target === sheet) finish(false);
    };

    actions.append(cancel, confirmButton);
    card.append(title, actions);
    sheet.append(card);
    document.body.append(sheet);
    confirmButton.focus();
  });

function Icon({ name }: { name: string }) {
  const icons: Record<string, string> = {
    dashboard: "⌂",
    add: "＋",
    history: "≡",
    vendors: "▣",
    settings: "⚙",
  };
  return (
    <span className="icon" aria-hidden>
      {icons[name] || name}
    </span>
  );
}

function Message({ text, error = false }: { text: string; error?: boolean }) {
  return text ? (
    <div className={`message ${error ? "error" : ""}`} role="status">
      {text}
    </div>
  ) : null;
}

function Chips({
  values,
  value,
  onChange,
  labels,
}: {
  values: string[];
  value: string;
  onChange: (v: string) => void;
  labels?: Record<string, string>;
}) {
  return (
    <div className="chips">
      {values.map((v) => (
        <button
          key={v}
          type="button"
          className={value === v ? "chip active" : "chip"}
          onClick={() => onChange(v)}
        >
          {labels?.[v] ?? v}
        </button>
      ))}
    </div>
  );
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [theme, setTheme] = useState<Theme>("auto");
  const [reminder, setReminder] = useState<ReminderSettings>(DEFAULT_REMINDER);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    setEntries(await db.all<Entry>("entries"));
    setVendors(await db.all<Vendor>("vendors"));
  };

  useEffect(() => {
    (async () => {
      try {
        await refresh();
        const s = await db.all<{ key: string; value: unknown }>("settings");
        const savedTheme = s.find((x) => x.key === "theme")?.value;
        if (
          savedTheme === "auto" ||
          savedTheme === "light" ||
          savedTheme === "dark"
        ) {
          setTheme(savedTheme);
        }
        const savedReminder = s.find((x) => x.key === "reminder")
          ?.value as Partial<ReminderSettings> | undefined;
        if (savedReminder && typeof savedReminder.enabled === "boolean") {
          setReminder({
            enabled: savedReminder.enabled,
            leadDays:
              typeof savedReminder.leadDays === "number" &&
              savedReminder.leadDays >= 1
                ? savedReminder.leadDays
                : DEFAULT_REMINDER.leadDays,
          });
        }
      } catch {
        setMessage("Não foi possível abrir o armazenamento local.");
        setError(true);
      } finally {
        setReady(true);
      }
    })();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register(`${BASE_PATH}/sw.js`, {
        scope: `${BASE_PATH}/`,
      });
    }
  }, []);

  useEffect(() => {
    if (!ready || !reminder.enabled) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    const forecast = computeGasForecast(entries, today());
    const evaluated = evaluateReminder(forecast, reminder);
    if (!evaluated.active || !forecast.nextEstimatedDate) return;

    const dedupKey = `gas_notif_${today()}_${forecast.nextEstimatedDate}`;
    if (sessionStorage.getItem(dedupKey)) return;
    sessionStorage.setItem(dedupKey, "1");

    try {
      new Notification(evaluated.title, {
        body: evaluated.detail,
        icon: `${BASE_PATH}/icons/icon-192.png`,
      });
    } catch {
      // Alguns ambientes PWA bloqueiam new Notification() fora de SW; o aviso no app continua ativo.
    }
  }, [ready, entries, reminder]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const syncThemeColor = () => {
      const isLight = theme === "light" || (theme === "auto" && media.matches);
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) {
        meta.setAttribute("content", isLight ? "#eef4f1" : "#0a0f0d");
      }
    };
    syncThemeColor();
    media.addEventListener("change", syncThemeColor);
    return () => media.removeEventListener("change", syncThemeColor);
  }, [theme]);

  const notify = (text: string, isError = false) => {
    setMessage(text);
    setError(isError);
    if (!isError) navigator.vibrate?.(10);
    window.setTimeout(() => setMessage(""), 1800);
  };

  const saveTheme = async (t: Theme) => {
    setTheme(t);
    await db.put("settings", { key: "theme", value: t });
  };

  const saveReminder = async (next: ReminderSettings) => {
    setReminder(next);
    await db.put("settings", { key: "reminder", value: next });
  };

  const exportReportCsv = (period: PeriodOption) => {
    const csv = buildReportCsv(entries, vendors, period, today());
    const slug = period.toLowerCase().replace(/\s+/g, "-");
    download(
      `relatorio_controle_gas_${slug}_${today()}.csv`,
      csv,
      "text/csv;charset=utf-8",
    );
    notify("Planilha Excel (.csv) exportada.");
  };

  const exportReportPdf = (period: PeriodOption) => {
    const html = buildPrintableReportHtml(entries, vendors, period, today());
    printHtmlReport(html);
    notify("Abrindo relatório para salvar em PDF.");
  };

  const downloadCalendarReminder = () => {
    const forecast = computeGasForecast(entries, today());
    const ics = buildReminderIcs(forecast, reminder.leadDays);
    if (!ics) {
      return notify(
        "Registre compras em pelo menos 2 datas para gerar um lembrete.",
        true,
      );
    }
    download(
      `lembrete_gas_${forecast.nextEstimatedDate}.ics`,
      ics,
      "text/calendar;charset=utf-8",
    );
    notify("Lembrete (.ics) pronto para adicionar ao calendário.");
  };

  const exportJson = () =>
    download(
      `gastracker_backup_${today()}.json`,
      JSON.stringify(
        {
          format: "gastracker-backup",
          version: 1,
          exportedAt: new Date().toISOString(),
          entries,
          vendors,
          settings: { theme, reminder },
        },
        null,
        2,
      ),
      "application/json",
    );

  const importJson = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      if (
        data.format !== "gastracker-backup" ||
        data.version !== 1 ||
        !Array.isArray(data.entries) ||
        !Array.isArray(data.vendors)
      ) {
        throw new Error();
      }

      const confirmed = await iosConfirm(
        `Restaurar ${data.entries.length} compras e ${data.vendors.length} fornecedores? Os dados atuais serão substituídos.`,
        true,
      );
      if (!confirmed) return;

      await db.replace(data.entries, data.vendors, data.settings);
      if (
        data.settings?.theme === "auto" ||
        data.settings?.theme === "light" ||
        data.settings?.theme === "dark"
      ) {
        setTheme(data.settings.theme);
      }
      if (
        data.settings?.reminder &&
        typeof data.settings.reminder.enabled === "boolean"
      ) {
        setReminder({
          enabled: data.settings.reminder.enabled,
          leadDays:
            typeof data.settings.reminder.leadDays === "number"
              ? data.settings.reminder.leadDays
              : DEFAULT_REMINDER.leadDays,
        });
      }
      await refresh();
      notify("Backup restaurado com sucesso.");
    } catch {
      notify("Arquivo de backup inválido ou incompatível.", true);
    }
  };

  if (!ready) {
    return <main className="loading">Abrindo Controle do Gás…</main>;
  }

  const props = { entries, vendors, refresh, notify };
  const navLabels: Record<Tab, { full: string; short: string }> = {
    dashboard: { full: "Início", short: "Início" },
    add: { full: "Registrar compra", short: "Registrar" },
    history: { full: "Histórico", short: "Histórico" },
    vendors: { full: "Fornecedores", short: "Fornecedores" },
    settings: { full: "Ajustes", short: "Ajustes" },
  };

  return (
    <div className="app-shell">
      <header>
        <div className="brand">
          <span className="flame">◆</span>
          <div>
            <strong>Controle do Gás</strong>
            <small>Seu consumo, sem surpresas</small>
          </div>
        </div>
        <span className="local-pill">● Dados neste aparelho</span>
      </header>

      <main className="content">
        <Message text={message} error={error} />
        {tab === "dashboard" && (
          <Dashboard
            entries={entries}
            reminder={reminder}
            onNavigate={setTab}
            onDownloadCalendar={downloadCalendarReminder}
          />
        )}
        {tab === "add" && <Add {...props} />}
        {tab === "history" && (
          <History
            {...props}
            onExportCsv={exportReportCsv}
            onExportPdf={exportReportPdf}
          />
        )}
        {tab === "vendors" && <Vendors {...props} />}
        {tab === "settings" && (
          <Settings
            entries={entries}
            vendors={vendors}
            theme={theme}
            setTheme={saveTheme}
            reminder={reminder}
            setReminder={saveReminder}
            onDownloadCalendar={downloadCalendarReminder}
            onExportCsv={exportReportCsv}
            onExportPdf={exportReportPdf}
            exportJson={exportJson}
            importRef={importRef}
            notify={notify}
            refresh={refresh}
          />
        )}
      </main>

      <nav aria-label="Navegação principal">
        {(["dashboard", "add", "history", "vendors", "settings"] as Tab[]).map(
          (t) => (
            <button
              key={t}
              type="button"
              aria-label={navLabels[t].full}
              className={[
                tab === t ? "selected" : "",
                t === "add" ? "nav-primary" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => setTab(t)}
            >
              <Icon name={t} />
              <span className="nav-label-full">{navLabels[t].full}</span>
              <span className="nav-label-short" aria-hidden>
                {navLabels[t].short}
              </span>
            </button>
          ),
        )}
      </nav>

      <input
        ref={importRef}
        hidden
        type="file"
        accept="application/json,.json"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importJson(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function Dashboard({
  entries,
  reminder,
  onNavigate,
  onDownloadCalendar,
}: {
  entries: Entry[];
  reminder: ReminderSettings;
  onNavigate: (tab: Tab) => void;
  onDownloadCalendar: () => void;
}) {
  const [period, setPeriod] = useState<PeriodOption>("Tudo");

  const referenceDate = today();

  const forecast = useMemo(
    () => computeGasForecast(entries, referenceDate),
    [entries, referenceDate],
  );

  const filtered = useMemo(
    () => filterEntriesByPeriod(entries, period, referenceDate),
    [entries, period, referenceDate],
  );

  const metrics = useMemo(
    () => computeFinancialMetrics(filtered),
    [filtered],
  );

  const stats = useMemo(
    () => computeConsumptionStats(entries, period, referenceDate),
    [entries, period, referenceDate],
  );

  const reminderEval = useMemo(
    () => evaluateReminder(forecast, reminder),
    [forecast, reminder],
  );

  const savings = useMemo(() => computeSavingsComparison(entries), [entries]);

  if (!forecast.hasData || !forecast.lastPurchase) {
    return (
      <Empty
        icon="◆"
        title="Nenhuma compra registrada ainda."
        text="Adicione sua primeira compra para acompanhar o consumo."
      />
    );
  }

  const levelColor =
    forecast.tone === "green"
      ? "var(--green)"
      : forecast.tone === "amber"
        ? "var(--amber)"
        : forecast.tone === "red"
          ? "var(--red)"
          : "var(--muted)";

  const confidenceBadge =
    forecast.interval.confidence === "reliable"
      ? `Média de ${forecast.interval.intervalCount} intervalos`
      : forecast.interval.confidence === "initial"
        ? "Estimativa inicial · 1 intervalo"
        : "Histórico insuficiente";

  const statusText =
    forecast.interval.averageDays === null
      ? "Registre compras em pelo menos 2 datas diferentes para gerar uma previsão."
      : forecast.overdueDays > 0
        ? `Prazo médio estimado superado há ${forecast.overdueDays} ${forecast.overdueDays === 1 ? "dia" : "dias"}`
        : forecast.remainingDays === 0
          ? "Previsão estimada de reposição para hoje"
          : `Aproximadamente ${forecast.remainingDays} ${forecast.remainingDays === 1 ? "dia restante" : "dias restantes"}`;

  const elapsedLabel =
    forecast.elapsedDays === 0
      ? "hoje"
      : forecast.elapsedDays === 1
        ? "há 1 dia"
        : `há ${forecast.elapsedDays} dias`;

  const periodSubtitle =
    period === "6 meses"
      ? "Últimos 6 meses"
      : period === "1 ano"
        ? "Último ano"
        : "Todo o histórico";

  const variation = metrics.priceVariation;
  const variationValue = variation
    ? `${variation.percent > 0 ? "+" : ""}${variation.percent.toFixed(1).replace(".", ",")}%`
    : "—";
  const variationTone = !variation
    ? undefined
    : variation.direction === "up"
      ? "red"
      : variation.direction === "down"
        ? "green"
        : undefined;
  const variationSub = !variation
    ? metrics.count === 0
      ? "sem compras no período"
      : "mín. 2 compras no período"
    : variation.direction === "flat"
      ? `estável desde ${shortBrDate(variation.baseDate)}`
      : `vs. ${brl(variation.basePrice)} em ${shortBrDate(variation.baseDate)}`;

  const intervalSub =
    metrics.interval.averageDays === null
      ? metrics.count === 0
        ? "sem compras no período"
        : "mín. 2 datas diferentes"
      : metrics.interval.intervalCount === 1
        ? "baseado em 1 intervalo"
        : `ponderado em ${metrics.interval.intervalCount} intervalos`;

  return (
    <section className="dashboard">
      <div className="title-row">
        <div>
          <h1>Início</h1>
          <p>Visão geral do seu botijão</p>
        </div>
        <Chips
          values={["6 meses", "1 ano", "Tudo"]}
          value={period}
          onChange={(v) => setPeriod(v as PeriodOption)}
        />
      </div>

      {reminderEval.active && (
        <article
          className={`reminder-banner reminder-${reminderEval.level}`}
          role="status"
          aria-label="Lembrete de reposição"
        >
          <div>
            <strong>{reminderEval.title}</strong>
            <p>{reminderEval.detail}</p>
          </div>
          <div className="reminder-actions">
            <button
              type="button"
              className="reminder-cta"
              onClick={() => onNavigate("add")}
            >
              Registrar compra
            </button>
            <button
              type="button"
              onClick={() => onNavigate("vendors")}
            >
              Fornecedores
            </button>
            <button type="button" onClick={onDownloadCalendar}>
              Calendário (.ics)
            </button>
          </div>
        </article>
      )}

      <article className="gas-card" aria-label="Situação estimada do botijão atual">
        <div className="gas-head">
          <div className="gas-status">
            <div className="gas-eyebrow-row">
              <span className="eyebrow">◆ SEU BOTIJÃO ATUAL</span>
              <span className={`confidence-pill confidence-${forecast.interval.confidence}`}>
                {confidenceBadge}
              </span>
            </div>
            <span className="gas-sublabel">Nível estimado</span>
            <strong style={{ color: levelColor }}>
              {forecast.estimatedLevel !== null
                ? `${forecast.estimatedLevel}%`
                : "—"}
            </strong>
            <p>{statusText}</p>
          </div>
          <div className="tank" aria-hidden>
            <i
              className={`tone-${forecast.tone}`}
              style={{
                height: `${forecast.estimatedLevel !== null ? Math.max(6, forecast.estimatedLevel) : 0}%`,
              }}
            />
          </div>
        </div>

        <div className="progress" aria-hidden>
          <i
            className={`tone-${forecast.tone}`}
            style={{ width: `${forecast.estimatedLevel ?? 0}%` }}
          />
        </div>

        <div className="gas-meta">
          <div>
            <span>Última reposição</span>
            <b>
              {brDate(forecast.lastPurchase.date)}{" "}
              <small>({elapsedLabel})</small>
            </b>
          </div>
          <div>
            <span>Próxima reposição estimada</span>
            <b>
              {forecast.nextEstimatedDate
                ? brDate(forecast.nextEstimatedDate)
                : "Aguardando histórico"}
            </b>
          </div>
        </div>

        <small>
          Previsão calculada com base no histórico de reposições (não representa medição física do gás).
        </small>
      </article>

      <div className="metrics" aria-label="Indicadores financeiros">
        <Metric
          label="Última compra"
          value={metrics.lastPurchase ? brl(metrics.lastPurchase.price) : "—"}
          sub={
            metrics.lastPurchase
              ? `em ${brDate(metrics.lastPurchase.date)}`
              : "sem compras no período"
          }
        />
        <Metric
          label="Total gasto"
          value={metrics.count > 0 ? brl(metrics.totalSpent) : "—"}
          sub={
            metrics.count > 0
              ? `${metrics.count} ${metrics.count === 1 ? "compra registrada" : "compras registradas"}`
              : "sem compras no período"
          }
        />
        <Metric
          label="Preço médio"
          value={metrics.averagePrice !== null ? brl(metrics.averagePrice) : "—"}
          sub={
            metrics.averagePrice !== null
              ? `média em ${metrics.count} ${metrics.count === 1 ? "compra" : "compras"}`
              : "sem compras no período"
          }
        />
        <Metric
          label="Intervalo médio"
          value={
            metrics.interval.averageDays !== null
              ? `${metrics.interval.averageDays} dias`
              : "—"
          }
          sub={intervalSub}
        />
        <Metric
          label="Variação de preço"
          value={variationValue}
          tone={variationTone}
          sub={variationSub}
        />
      </div>

      {savings && (
        <article
          className={`savings-card savings-${savings.status}`}
          aria-label="Comparativo da última compra"
        >
          <div className="savings-head">
            <div>
              <span className="eyebrow">
                {savings.status === "saved"
                  ? "◆ ECONOMIA NA ÚLTIMA COMPRA"
                  : "◆ COMPARATIVO DA ÚLTIMA COMPRA"}
              </span>
              <strong>
                {savings.status === "saved"
                  ? `Redução de ${brl(savings.difference)} (${savings.percent.toFixed(1).replace(".", ",")}%)`
                  : savings.status === "increased"
                    ? `Aumento de ${brl(Math.abs(savings.difference))} (+${savings.percent.toFixed(1).replace(".", ",")}%)`
                    : "Mesmo preço da compra anterior (0,0%)"}
              </strong>
            </div>
            <span className={`savings-badge savings-badge-${savings.status}`}>
              {savings.status === "saved"
                ? `-${savings.percent.toFixed(1).replace(".", ",")}%`
                : savings.status === "increased"
                  ? `+${savings.percent.toFixed(1).replace(".", ",")}%`
                  : "0,0%"}
            </span>
          </div>

          <div className="savings-compare">
            <div>
              <span>Compra anterior ({brDate(savings.previous.date)})</span>
              <b>{brl(savings.previous.price)}</b>
              <small>{savings.previous.vendor}</small>
            </div>
            <div>
              <span>Compra atual ({brDate(savings.current.date)})</span>
              <b>{brl(savings.current.price)}</b>
              <small>{savings.current.vendor}</small>
            </div>
          </div>

          <small>
            Comparação direta entre a sua compra mais recente e a compra imediatamente anterior.
          </small>
        </article>
      )}

      <PriceChart entries={filtered} periodLabel={periodSubtitle} />

      <article className="stats-card" aria-label="Estatísticas de consumo">
        <div className="stats-head">
          <div>
            <h2>Estatísticas de consumo</h2>
            <span className="chart-period">{periodSubtitle}</span>
          </div>
        </div>

        <div className="stats-grid">
          <div className="stat-box">
            <span>Gasto mensal estimado</span>
            <strong>
              {stats.estimatedMonthlySpend !== null
                ? brl(stats.estimatedMonthlySpend)
                : "—"}
            </strong>
            <small>
              {stats.estimatedMonthlySpend !== null
                ? "projeção para 30 dias"
                : "mín. 2 datas no período"}
            </small>
          </div>

          <div className="stat-box">
            <span>Gasto realizado ({period})</span>
            <strong>
              {stats.purchaseCount > 0 ? brl(stats.totalSpentRealized) : "—"}
            </strong>
            <small>valor efetivamente pago</small>
          </div>

          <div className="stat-box">
            <span>Duração média estimada</span>
            <strong>
              {stats.interval.averageDays !== null
                ? `${stats.interval.averageDays} dias`
                : "—"}
            </strong>
            <small>
              {stats.minIntervalDays !== null && stats.maxIntervalDays !== null
                ? stats.minIntervalDays === stats.maxIntervalDays
                  ? `ciclo único de ${stats.minIntervalDays} dias`
                  : `entre ${stats.minIntervalDays} e ${stats.maxIntervalDays} dias`
                : "mín. 2 datas no período"}
            </small>
          </div>

          <div className="stat-box">
            <span>Compras por período</span>
            <strong>
              {stats.countsByPeriod.sixMonths} / {stats.countsByPeriod.oneYear} /{" "}
              {stats.countsByPeriod.all}
            </strong>
            <small>6 meses · 1 ano · total</small>
          </div>
        </div>

        <small className="stats-note">
          Premissa do gasto mensal estimado: (preço médio ÷ intervalo médio em dias) × 30 dias. Projeções não representam gasto efetivamente pago.
        </small>
      </article>
    </section>
  );
}

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
      {sub && <small>{sub}</small>}
    </article>
  );
}

function PriceChart({
  entries,
  periodLabel,
}: {
  entries: Entry[];
  periodLabel: string;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  if (entries.length < 2) {
    return (
      <article className="chart-card chart-empty">
        <div className="chart-header">
          <div>
            <h2>Evolução de preços</h2>
            <span className="chart-period">{periodLabel}</span>
          </div>
        </div>
        <p className="chart-empty-note">
          {entries.length === 0
            ? "Nenhuma compra registrada neste período."
            : "Registre pelo menos 2 compras neste período para visualizar a evolução de preços."}
        </p>
      </article>
    );
  }

  const prices = entries.map((e) => e.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avgPrice = prices.reduce((s, p) => s + p, 0) / prices.length;
  const range = max - min || 1;

  const width = 600;
  const height = 210;
  const padX = 24;
  const padTop = 22;
  const padBottom = 34;
  const plotW = width - padX * 2;
  const plotH = height - padTop - padBottom;

  const getY = (price: number) =>
    max === min
      ? padTop + plotH / 2
      : padTop + (1 - (price - min) / range) * plotH;

  const coords = entries.map((entry, i) => ({
    entry,
    key: `${entry.id ?? i}-${entry.date}-${entry.price}`,
    x: padX + (i / (entries.length - 1)) * plotW,
    y: getY(entry.price),
  }));

  const avgY = getY(avgPrice);
  const linePoints = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const areaPoints = `${padX},${padTop + plotH} ${linePoints} ${padX + plotW},${padTop + plotH}`;

  const matchedIndex = selectedKey
    ? coords.findIndex((c) => c.key === selectedKey)
    : -1;
  const activeIndex = matchedIndex >= 0 ? matchedIndex : coords.length - 1;
  const active = coords[activeIndex];
  const midIndex = coords.length > 2 ? Math.floor((coords.length - 1) / 2) : -1;

  return (
    <article className="chart-card" aria-label="Evolução de preços">
      <div className="chart-header">
        <div>
          <h2>Evolução de preços</h2>
          <span className="chart-period">{periodLabel}</span>
        </div>
        <div className="chart-selected" aria-live="polite">
          <strong>{brl(active.entry.price)}</strong>
          <span>
            {brDate(active.entry.date)} · {active.entry.vendor}
          </span>
        </div>
      </div>

      <div className="chart-stats">
        <div>
          <span>Menor</span>
          <b>{brl(min)}</b>
        </div>
        <div>
          <span>Média</span>
          <b>{brl(avgPrice)}</b>
        </div>
        <div>
          <span>Maior</span>
          <b>{brl(max)}</b>
        </div>
      </div>

      <div className="chart-canvas">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Gráfico de evolução de preços com ${entries.length} compras`}
        >
          <defs>
            <linearGradient id="priceAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>

          <line
            className="chart-avg-line"
            x1={padX}
            y1={avgY}
            x2={width - padX}
            y2={avgY}
          />
          <text
            className="chart-avg-label"
            x={width - padX}
            y={Math.max(14, avgY - 6)}
            textAnchor="end"
          >
            Média {brl(avgPrice)}
          </text>

          <polygon points={areaPoints} fill="url(#priceAreaGrad)" />
          <polyline className="chart-line" points={linePoints} />

          {coords.map((point, i) => {
            const isActive = i === activeIndex;
            return (
              <g key={point.key} className="chart-point-group">
                {isActive && (
                  <circle
                    className="chart-point-halo"
                    cx={point.x}
                    cy={point.y}
                    r={11}
                  />
                )}
                <circle
                  className={isActive ? "chart-point active" : "chart-point"}
                  cx={point.x}
                  cy={point.y}
                  r={isActive ? 5.5 : 4}
                />
                <circle
                  className="chart-hit"
                  cx={point.x}
                  cy={point.y}
                  r={20}
                  tabIndex={0}
                  role="button"
                  aria-label={`${brDate(point.entry.date)}: ${brl(point.entry.price)} (${point.entry.vendor})`}
                  aria-pressed={isActive}
                  onClick={() => setSelectedKey(point.key)}
                  onMouseEnter={() => setSelectedKey(point.key)}
                  onFocus={() => setSelectedKey(point.key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedKey(point.key);
                    }
                  }}
                />
              </g>
            );
          })}

          <text
            className="chart-axis-label"
            x={padX}
            y={height - 8}
            textAnchor="start"
          >
            {shortBrDate(coords[0].entry.date)}
          </text>
          {midIndex > 0 && (
            <text
              className="chart-axis-label"
              x={coords[midIndex].x}
              y={height - 8}
              textAnchor="middle"
            >
              {shortBrDate(coords[midIndex].entry.date)}
            </text>
          )}
          <text
            className="chart-axis-label"
            x={width - padX}
            y={height - 8}
            textAnchor="end"
          >
            {shortBrDate(coords[coords.length - 1].entry.date)}
          </text>
        </svg>
      </div>

      <small className="chart-hint">
        Toque ou passe sobre um ponto para ver data, valor e fornecedor.
      </small>
    </article>
  );
}

function Add({
  vendors,
  refresh,
  notify,
}: {
  entries: Entry[];
  vendors: Vendor[];
  refresh: () => Promise<void>;
  notify: (s: string, e?: boolean) => void;
}) {
  const [date, setDate] = useState(today());
  const [price, setPrice] = useState("");
  const [mode, setMode] = useState("");
  const [vendor, setVendor] = useState("");
  const [notes, setNotes] = useState("");

  const save = async () => {
    const p = Number(price.replace(",", "."));
    const vendorName = vendor.trim();
    if (
      !isValidIsoDate(date) ||
      date > today() ||
      !Number.isFinite(p) ||
      p <= 0 ||
      !vendorName
    ) {
      return notify("Informe valor pago, data válida e fornecedor.", true);
    }

    const cleanNotes = notes.trim();
    const record: Entry = {
      date,
      price: p,
      mode,
      vendor: vendorName,
      ...(cleanNotes ? { notes: cleanNotes } : {}),
    };

    await db.put("entries", record);
    if (
      !vendors.some(
        (v) => normalizeVendorName(v.name) === normalizeVendorName(vendorName),
      )
    ) {
      await db.put("vendors", {
        name: vendorName,
        phone: "",
        contactType: "whatsapp",
      });
    }

    await refresh();
    setPrice("");
    setMode("");
    setVendor("");
    setNotes("");
    notify("Compra registrada com sucesso.");
  };

  return (
    <section className="form-page">
      <h1>Registrar compra</h1>
      <p>Registre a troca do seu botijão de forma rápida</p>

      <article className="panel form">
        <label>
          Valor pago (R$)
          <input
            inputMode="decimal"
            placeholder="0,00"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^0-9,.]/g, ""))}
          />
        </label>

        <label>
          Data da compra
          <input
            type="date"
            max={today()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>

        <label>
          Fornecedor
          <input
            list="vendors-list"
            placeholder="Digite ou selecione"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
          />
          <datalist id="vendors-list">
            {vendors.map((v) => (
              <option key={v.id} value={v.name} />
            ))}
          </datalist>
        </label>

        {vendors.length > 0 && (
          <div className="quick-vendors" aria-label="Fornecedores salvos">
            <span>Fornecedores salvos:</span>
            <div className="quick-vendor-chips">
              {vendors.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={
                    normalizeVendorName(vendor) === normalizeVendorName(v.name)
                      ? "quick-chip active"
                      : "quick-chip"
                  }
                  onClick={() => setVendor(v.name)}
                >
                  {v.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <fieldset>
          <legend>
            Forma de pagamento <span className="optional-tag">(opcional)</span>
          </legend>
          <Chips
            values={MODES}
            value={mode}
            onChange={(v) => setMode(mode === v ? "" : v)}
          />
        </fieldset>

        <label className="form-textarea-row">
          <span>
            Observações <small className="optional-tag">(opcional)</small>
          </span>
          <textarea
            rows={2}
            maxLength={240}
            placeholder="Ex.: Entrega rápida, promoção, lacre conferido..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

        <button type="button" className="primary" onClick={save}>
          Salvar compra
        </button>
      </article>
    </section>
  );
}

function History({
  entries,
  vendors,
  refresh,
  notify,
  onExportCsv,
  onExportPdf,
}: {
  entries: Entry[];
  vendors: Vendor[];
  refresh: () => Promise<void>;
  notify: (s: string, e?: boolean) => void;
  onExportCsv: (period: PeriodOption) => void;
  onExportPdf: (period: PeriodOption) => void;
}) {
  const [period, setPeriod] = useState<PeriodOption>("Tudo");
  const [sort, setSort] = useState("Data ↓");
  const [edit, setEdit] = useState<Entry | null>(null);

  const list = useMemo(() => {
    let a = [...entries];
    if (period !== "Tudo") {
      const d = new Date();
      d.setMonth(d.getMonth() - (period === "6 meses" ? 6 : 12));
      a = a.filter((e) => isValidIsoDate(e.date) && civil(e.date) >= d);
    }
    return a.sort((x, y) =>
      sort === "Data ↓"
        ? y.date.localeCompare(x.date)
        : sort === "Data ↑"
          ? x.date.localeCompare(y.date)
          : sort === "Preço ↓"
            ? y.price - x.price
            : x.price - y.price,
    );
  }, [entries, period, sort]);

  const remove = async (e: Entry) => {
    if (await iosConfirm("Excluir esta compra?", true)) {
      await db.delete("entries", e.id!);
      await refresh();
      notify("Compra excluída.");
    }
  };

  return (
    <section>
      <div className="title-row">
        <div>
          <h1>Histórico</h1>
          <p>
            {list.length}{" "}
            {list.length === 1 ? "compra encontrada" : "compras encontradas"}
          </p>
        </div>
        <div className="filters">
          <Chips
            values={["6 meses", "1 ano", "Tudo"]}
            value={period}
            onChange={(v) => setPeriod(v as PeriodOption)}
          />
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {["Data ↓", "Data ↑", "Preço ↓", "Preço ↑"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </div>
      </div>

      {list.length > 0 && (
        <div className="report-bar" aria-label="Exportar relatório do período">
          <span>Exportar ({period}):</span>
          <div className="report-bar-actions">
            <button type="button" onClick={() => onExportPdf(period)}>
              Relatório PDF
            </button>
            <button type="button" onClick={() => onExportCsv(period)}>
              Planilha Excel (.csv)
            </button>
          </div>
        </div>
      )}

      {!list.length ? (
        <Empty icon="≡" title="Nenhuma compra encontrada." />
      ) : (
        <div className="list">
          {list.map((e) => (
            <article className="entry" key={e.id}>
              <div>
                <small>{brDate(e.date)}</small>
                <strong>{e.vendor}</strong>
                {e.mode && <span>{e.mode}</span>}
                {e.notes && <span className="entry-notes">{e.notes}</span>}
              </div>
              <b>{brl(e.price)}</b>
              <button
                type="button"
                aria-label="Editar"
                onClick={() => setEdit(e)}
              >
                ✎
              </button>
              <button
                type="button"
                aria-label="Excluir"
                onClick={() => remove(e)}
              >
                ×
              </button>
            </article>
          ))}
        </div>
      )}

      {edit && (
        <EditEntry
          entry={edit}
          vendors={vendors}
          notify={notify}
          close={() => setEdit(null)}
          done={async () => {
            await refresh();
            setEdit(null);
            notify("Compra atualizada.");
          }}
        />
      )}
    </section>
  );
}

function EditEntry({
  entry,
  vendors,
  notify,
  close,
  done,
}: {
  entry: Entry;
  vendors: Vendor[];
  notify: (s: string, e?: boolean) => void;
  close: () => void;
  done: () => void;
}) {
  const [date, setDate] = useState(entry.date);
  const [price, setPrice] = useState(String(entry.price).replace(".", ","));
  const [mode, setMode] = useState(entry.mode || "");
  const [vendor, setVendor] = useState(entry.vendor);
  const [notes, setNotes] = useState(entry.notes || "");

  return (
    <div className="modal">
      <article>
        <h2>Editar compra</h2>
        <label>
          Valor pago (R$)
          <input
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^0-9,.]/g, ""))}
          />
        </label>
        <label>
          Data da compra
          <input
            type="date"
            max={today()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label>
          Fornecedor
          <input
            list="edit-vendors-list"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
          />
          <datalist id="edit-vendors-list">
            {vendors.map((v) => (
              <option key={v.id} value={v.name} />
            ))}
          </datalist>
        </label>
        <fieldset>
          <legend>
            Forma de pagamento <span className="optional-tag">(opcional)</span>
          </legend>
          <Chips
            values={MODES}
            value={mode}
            onChange={(v) => setMode(mode === v ? "" : v)}
          />
        </fieldset>
        <label>
          <span>
            Observações <small className="optional-tag">(opcional)</small>
          </span>
          <textarea
            rows={2}
            maxLength={240}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <div className="actions">
          <button type="button" onClick={close}>
            Cancelar
          </button>
          <button
            type="button"
            className="primary"
            onClick={async () => {
              const p = Number(price.replace(",", "."));
              const vendorName = vendor.trim();
              if (
                !isValidIsoDate(date) ||
                date > today() ||
                !Number.isFinite(p) ||
                p <= 0 ||
                !vendorName
              ) {
                return notify(
                  "Informe valor pago, data válida e fornecedor.",
                  true,
                );
              }
              const cleanNotes = notes.trim();
              const updated: Entry = {
                ...entry,
                date,
                price: p,
                mode,
                vendor: vendorName,
              };
              if (cleanNotes) {
                updated.notes = cleanNotes;
              } else {
                delete updated.notes;
              }
              await db.put("entries", updated);
              if (
                !vendors.some(
                  (v) =>
                    normalizeVendorName(v.name) ===
                    normalizeVendorName(vendorName),
                )
              ) {
                await db.put("vendors", {
                  name: vendorName,
                  phone: "",
                  contactType: "whatsapp",
                });
              }
              done();
            }}
          >
            Salvar
          </button>
        </div>
      </article>
    </div>
  );
}

function Vendors({
  entries,
  vendors,
  refresh,
  notify,
}: {
  entries: Entry[];
  vendors: Vendor[];
  refresh: () => Promise<void>;
  notify: (s: string, e?: boolean) => void;
}) {
  const [period, setPeriod] = useState<PeriodOption>("Tudo");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [type, setType] = useState<Vendor["contactType"]>("whatsapp");
  const [edit, setEdit] = useState<Vendor | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const referenceDate = today();
  const comparison = useMemo(
    () => computeVendorComparison(entries, vendors, period, referenceDate),
    [entries, vendors, period, referenceDate],
  );

  const periodSubtitle =
    period === "6 meses"
      ? "últimos 6 meses"
      : period === "1 ano"
        ? "último ano"
        : "todo o histórico";

  const save = async () => {
    const cleanName = name.trim();
    if (!cleanName) {
      return notify("Informe o nome do fornecedor.", true);
    }
    if (
      vendors.some(
        (v) => normalizeVendorName(v.name) === normalizeVendorName(cleanName),
      )
    ) {
      return notify("Este fornecedor já está cadastrado.", true);
    }

    await db.put("vendors", {
      name: cleanName,
      phone: phone.trim(),
      contactType: type,
    });
    setName("");
    setPhone("");
    await refresh();
    notify("Fornecedor adicionado.");
  };

  return (
    <section>
      <div className="title-row">
        <div>
          <h1>Fornecedores</h1>
          <p>Cadastre contatos e compare seus preços registrados</p>
        </div>
        <Chips
          values={["6 meses", "1 ano", "Tudo"]}
          value={period}
          onChange={(v) => setPeriod(v as PeriodOption)}
        />
      </div>

      {comparison.lowestPrice !== null && (
        <article
          className="best-vendor-card"
          aria-label="Menor preço registrado no período"
        >
          <div>
            <span className="eyebrow">◆ MENOR PREÇO NOS SEUS REGISTROS</span>
            <strong>{brl(comparison.lowestPrice)}</strong>
            <p>
              {comparison.lowestVendorNames.join(", ")} · {periodSubtitle}
            </p>
          </div>
          <small>
            Comparação baseada exclusivamente nas compras registradas por você neste período.
          </small>
        </article>
      )}

      <article className="panel vendor-form">
        <input
          placeholder="Nome do fornecedor"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="tel"
          placeholder="Telefone (opcional)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <Chips
          values={["whatsapp", "phone", "app"]}
          value={type}
          onChange={(v) => setType(v as Vendor["contactType"])}
          labels={{ whatsapp: "WhatsApp", phone: "Telefone", app: "App" }}
        />
        <button type="button" className="primary" onClick={save}>
          Adicionar
        </button>
      </article>

      {!comparison.items.length ? (
        <Empty
          icon="▣"
          title="Nenhum fornecedor cadastrado."
          text="Adicione um fornecedor acima ou registre uma compra para começar a comparar preços."
        />
      ) : (
        <div className="list">
          {comparison.items.map((item) => {
            const v = item.vendor;
            const isExpanded = expandedKey === item.normalizedName;
            const contactHref =
              v?.phone && v.contactType !== "app"
                ? v.contactType === "whatsapp"
                  ? `https://wa.me/55${v.phone.replace(/\D/g, "")}`
                  : `tel:${v.phone.replace(/\D/g, "")}`
                : null;

            return (
              <article className="vendor-card" key={item.normalizedName}>
                <div className="vendor-top">
                  <div className="vendor-info">
                    <div className="vendor-name-row">
                      <strong>{item.name}</strong>
                      {item.isLowestRegistered && (
                        <span className="vendor-best-pill">
                          Menor preço registrado
                        </span>
                      )}
                    </div>
                    <span>
                      {v?.phone || "Sem telefone cadastrado"}
                      {item.purchaseCount > 0
                        ? ` · ${item.purchaseCount} ${item.purchaseCount === 1 ? "compra" : "compras"}`
                        : " · Sem compras no período"}
                    </span>
                  </div>

                  <div className="vendor-actions">
                    {contactHref && v && (
                      <a href={contactHref} aria-label={`Contatar ${item.name}`}>
                        {v.contactType === "whatsapp" ? "WhatsApp" : "Ligar"}
                      </a>
                    )}
                    <button
                      type="button"
                      aria-label={`Editar ${item.name}`}
                      onClick={() =>
                        setEdit(
                          v ?? {
                            name: item.name,
                            phone: "",
                            contactType: "whatsapp",
                          },
                        )
                      }
                    >
                      ✎
                    </button>
                  </div>
                </div>

                {item.purchaseCount > 0 &&
                  item.minPrice !== null &&
                  item.averagePrice !== null &&
                  item.lastPrice !== null && (
                    <>
                      <div className="vendor-prices">
                        <div>
                          <span>Menor</span>
                          <b>{brl(item.minPrice)}</b>
                        </div>
                        <div>
                          <span>Médio</span>
                          <b>{brl(item.averagePrice)}</b>
                        </div>
                        <div>
                          <span>Último</span>
                          <b>{brl(item.lastPrice)}</b>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="vendor-history-toggle"
                        aria-expanded={isExpanded}
                        onClick={() =>
                          setExpandedKey(
                            isExpanded ? null : item.normalizedName,
                          )
                        }
                      >
                        {isExpanded
                          ? "Ocultar histórico de preços"
                          : `Ver histórico de preços (${item.purchaseCount})`}
                      </button>

                      {isExpanded && (
                        <div className="vendor-history">
                          {item.history.map((h, idx) => (
                            <div
                              className="vendor-history-row"
                              key={h.id ?? `${h.date}-${idx}`}
                            >
                              <div>
                                <span>{brDate(h.date)}</span>
                                {h.mode && <small>{h.mode}</small>}
                                {h.notes && <small>{h.notes}</small>}
                              </div>
                              <b>{brl(h.price)}</b>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
              </article>
            );
          })}
        </div>
      )}

      {edit && (
        <EditVendor
          vendor={edit}
          entries={entries}
          notify={notify}
          close={() => setEdit(null)}
          done={async (msg) => {
            await refresh();
            setEdit(null);
            notify(msg);
          }}
        />
      )}
    </section>
  );
}

function EditVendor({
  vendor,
  entries,
  notify,
  close,
  done,
}: {
  vendor: Vendor;
  entries: Entry[];
  notify: (s: string, e?: boolean) => void;
  close: () => void;
  done: (message: string) => void;
}) {
  const [name, setName] = useState(vendor.name);
  const [phone, setPhone] = useState(vendor.phone);
  const [type, setType] = useState<Vendor["contactType"]>(vendor.contactType);

  return (
    <div className="modal">
      <article>
        <h2>{vendor.id ? "Editar fornecedor" : "Salvar contato do fornecedor"}</h2>
        <label>
          Nome
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Telefone (opcional)
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        <Chips
          values={["whatsapp", "phone", "app"]}
          value={type}
          onChange={(v) => setType(v as Vendor["contactType"])}
          labels={{ whatsapp: "WhatsApp", phone: "Telefone", app: "App" }}
        />
        <div className="actions">
          {vendor.id && (
            <button
              type="button"
              className="danger"
              onClick={async () => {
                if (await iosConfirm("Excluir este fornecedor?", true)) {
                  await db.delete("vendors", vendor.id!);
                  done("Fornecedor excluído.");
                }
              }}
            >
              Excluir
            </button>
          )}
          <button type="button" onClick={close}>
            Cancelar
          </button>
          <button
            type="button"
            className="primary"
            onClick={async () => {
              const cleanName = name.trim();
              if (!cleanName) {
                return notify("Informe o nome do fornecedor.", true);
              }
              const oldKey = normalizeVendorName(vendor.name);
              const payload: Vendor = {
                ...(vendor.id ? { id: vendor.id } : {}),
                name: cleanName,
                phone: phone.trim(),
                contactType: type,
              };
              await db.put("vendors", payload);

              // Se renomear o fornecedor, atualiza o vínculo nas compras registradas.
              if (oldKey !== normalizeVendorName(cleanName)) {
                const matching = entries.filter(
                  (e) => normalizeVendorName(e.vendor) === oldKey,
                );
                for (const item of matching) {
                  await db.put("entries", { ...item, vendor: cleanName });
                }
              }
              done("Fornecedor atualizado.");
            }}
          >
            Salvar
          </button>
        </div>
      </article>
    </div>
  );
}

function Settings({
  entries,
  vendors,
  theme,
  setTheme,
  reminder,
  setReminder,
  onDownloadCalendar,
  onExportCsv,
  onExportPdf,
  exportJson,
  importRef,
  notify,
  refresh,
}: {
  entries: Entry[];
  vendors: Vendor[];
  theme: Theme;
  setTheme: (t: Theme) => void;
  reminder: ReminderSettings;
  setReminder: (r: ReminderSettings) => Promise<void>;
  onDownloadCalendar: () => void;
  onExportCsv: (period: PeriodOption) => void;
  onExportPdf: (period: PeriodOption) => void;
  exportJson: () => void;
  importRef: React.RefObject<HTMLInputElement | null>;
  notify: (s: string, e?: boolean) => void;
  refresh: () => Promise<void>;
}) {
  const [reportPeriod, setReportPeriod] = useState<PeriodOption>("Tudo");
  const [notifPerm, setNotifPerm] = useState<string>(() =>
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported",
  );

  const forecast = useMemo(() => computeGasForecast(entries, today()), [entries]);
  const reminderEval = useMemo(
    () => evaluateReminder(forecast, reminder),
    [forecast, reminder],
  );

  const requestNotifications = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return notify(
        "Este navegador não suporta notificações. Use o lembrete de calendário (.ics).",
        true,
      );
    }
    const result = await Notification.requestPermission();
    setNotifPerm(result);
    if (result === "granted") {
      notify("Notificações ativadas para quando o aplicativo for aberto.");
    } else {
      notify("Permissão de notificação não concedida.", true);
    }
  };

  const clear = async () => {
    const confirmed = await iosConfirm(
      "Apagar permanentemente todas as compras e fornecedores deste aparelho?",
      true,
    );
    if (!confirmed) return;

    await db.replace([], []);
    await refresh();
    notify("Todos os dados foram removidos.");
  };

  return (
    <section>
      <h1>Ajustes</h1>
      <p>Preferências, lembretes, relatórios e seus dados</p>

      <h2 className="section-title">APARÊNCIA</h2>
      <article className="panel setting">
        <div>
          <strong>Tema</strong>
          <span>Aparência do aplicativo</span>
        </div>
        <Chips
          values={["auto", "light", "dark"]}
          value={theme}
          onChange={(v) => setTheme(v as Theme)}
          labels={{ auto: "Automático", light: "Claro", dark: "Escuro" }}
        />
      </article>

      <h2 className="section-title">LEMBRETES DE REPOSIÇÃO</h2>
      <article className="panel reminder-settings">
        <div className="setting">
          <div>
            <strong>Lembrete antes da previsão</strong>
            <span>Avisa no aplicativo quando o botijão estiver perto do fim</span>
          </div>
          <Chips
            values={["on", "off"]}
            value={reminder.enabled ? "on" : "off"}
            onChange={(v) =>
              setReminder({ ...reminder, enabled: v === "on" })
            }
            labels={{ on: "Ativado", off: "Desativado" }}
          />
        </div>

        {reminder.enabled && (
          <>
            <div className="setting">
              <div>
                <strong>Antecedência do aviso</strong>
                <span>Quantos dias antes da data estimada</span>
              </div>
              <Chips
                values={REMINDER_LEAD_OPTIONS}
                value={String(reminder.leadDays)}
                onChange={(v) =>
                  setReminder({ ...reminder, leadDays: Number(v) })
                }
                labels={{
                  "3": "3d",
                  "5": "5d",
                  "7": "7d",
                  "10": "10d",
                  "15": "15d",
                }}
              />
            </div>

            <div className="reminder-platform-box">
              <div className="reminder-platform-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  disabled={!forecast.nextEstimatedDate}
                  onClick={onDownloadCalendar}
                >
                  Adicionar ao calendário (.ics)
                </button>
                {notifPerm !== "unsupported" && notifPerm !== "granted" && (
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={requestNotifications}
                  >
                    Autorizar notificação do navegador
                  </button>
                )}
              </div>
              <small>
                {forecast.nextEstimatedDate && reminderEval.reminderDate
                  ? `Próximo lembrete previsto: ${brDate(reminderEval.reminderDate)} (previsão de reposição em ${brDate(forecast.nextEstimatedDate)}). `
                  : "Registre compras em pelo menos 2 datas para calcular o próximo lembrete. "}
                Em PWAs locais sem servidor, alertas com o app fechado funcionam adicionando o evento (.ics) ao calendário do celular.
                {notifPerm === "granted" &&
                  " Notificações do navegador estão autorizadas ao abrir o app."}
              </small>
            </div>
          </>
        )}
      </article>

      <h2 className="section-title">RELATÓRIOS</h2>
      <article className="panel report-settings">
        <div className="setting">
          <div>
            <strong>Período do relatório</strong>
            <span>Filtra compras, fornecedores e estatísticas</span>
          </div>
          <Chips
            values={["6 meses", "1 ano", "Tudo"]}
            value={reportPeriod}
            onChange={(v) => setReportPeriod(v as PeriodOption)}
          />
        </div>
        <div className="settings-grid">
          <button
            type="button"
            className="setting-button"
            onClick={() => onExportPdf(reportPeriod)}
          >
            <b>📄</b>
            <div>
              <strong>Exportar relatório PDF</strong>
              <span>Pronto para imprimir ou salvar em PDF</span>
            </div>
          </button>

          <button
            type="button"
            className="setting-button"
            onClick={() => onExportCsv(reportPeriod)}
          >
            <b>⊞</b>
            <div>
              <strong>Exportar planilha Excel (.csv)</strong>
              <span>Compatível com Excel e planilhas</span>
            </div>
          </button>
        </div>
      </article>

      <h2 className="section-title">BACKUP COMPLETO</h2>
      <div className="settings-grid">
        <button type="button" className="setting-button" onClick={exportJson}>
          <b>↓</b>
          <div>
            <strong>Salvar backup JSON</strong>
            <span>
              {entries.length} compras e {vendors.length} fornecedores
            </span>
          </div>
        </button>

        <button
          type="button"
          className="setting-button"
          onClick={() => importRef.current?.click()}
        >
          <b>↑</b>
          <div>
            <strong>Restaurar backup JSON</strong>
            <span>Substitui os dados deste aparelho</span>
          </div>
        </button>
      </div>

      <h2 className="section-title">SOBRE</h2>
      <article className="panel about">
        <span className="flame">◆</span>
        <div>
          <strong>Controle do Gás</strong>
          <span>PWA local e offline · Versão 1.0.0</span>
        </div>
      </article>

      <button type="button" className="clear" onClick={clear}>
        Limpar todos os dados
      </button>
    </section>
  );
}

function Empty({
  icon,
  title,
  text,
}: {
  icon: string;
  title: string;
  text?: string;
}) {
  return (
    <div className="empty">
      <span>{icon}</span>
      <strong>{title}</strong>
      {text && <p>{text}</p>}
    </div>
  );
}
