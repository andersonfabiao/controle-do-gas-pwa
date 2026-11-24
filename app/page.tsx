"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Entry = {
  id?: number;
  date: string;
  price: number;
  mode: string;
  vendor: string;
};

type Vendor = {
  id?: number;
  name: string;
  phone: string;
  contactType: "whatsapp" | "phone" | "app";
};

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
    settings?: { theme?: Theme },
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

const today = () => new Date().toLocaleDateString("en-CA");

const civil = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

const daysBetween = (a: string, b: string) =>
  Math.round((civil(b).getTime() - civil(a).getTime()) / 86400000);

const weightedDays = (items: Entry[]) => {
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) return 0;

  let sum = 0;
  let weights = 0;
  for (let i = 1; i < sorted.length; i++) {
    sum += daysBetween(sorted[i - 1].date, sorted[i].date) * i;
    weights += i;
  }
  return Math.round(sum / weights);
};

const download = (name: string, text: string, type: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
};

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
        const s = await db.all<{ key: string; value: Theme }>("settings");
        setTheme(s.find((x) => x.key === "theme")?.value || "auto");
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
    window.setTimeout(() => setMessage(""), 1600);
  };

  const saveTheme = async (t: Theme) => {
    setTheme(t);
    await db.put("settings", { key: "theme", value: t });
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
          settings: { theme },
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
        `Restaurar ${data.entries.length} compras e ${data.vendors.length} vendedores? Os dados atuais serão substituídos.`,
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
  const navLabels: Record<Tab, string> = {
    dashboard: "Dashboard",
    add: "Adicionar",
    history: "Histórico",
    vendors: "Vendedores",
    settings: "Configurações",
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
        {tab === "dashboard" && <Dashboard entries={entries} />}
        {tab === "add" && <Add {...props} />}
        {tab === "history" && <History {...props} />}
        {tab === "vendors" && <Vendors {...props} />}
        {tab === "settings" && (
          <Settings
            entries={entries}
            vendors={vendors}
            theme={theme}
            setTheme={saveTheme}
            exportJson={exportJson}
            importRef={importRef}
            notify={notify}
            refresh={refresh}
          />
        )}
      </main>

      <nav>
        {(["dashboard", "add", "history", "vendors", "settings"] as Tab[]).map(
          (t) => (
            <button
              key={t}
              type="button"
              className={tab === t ? "selected" : ""}
              onClick={() => setTab(t)}
            >
              <Icon name={t} />
              <span>{navLabels[t]}</span>
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

function Dashboard({ entries }: { entries: Entry[] }) {
  const [period, setPeriod] = useState("Tudo");

  const filtered = useMemo(() => {
    const limit = period === "6 meses" ? 6 : period === "1 ano" ? 12 : 0;
    if (!limit) {
      return [...entries].sort((a, b) => a.date.localeCompare(b.date));
    }
    const d = new Date();
    d.setMonth(d.getMonth() - limit);
    return entries
      .filter((e) => civil(e.date) > d)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [entries, period]);

  if (!entries.length) {
    return (
      <Empty
        icon="◆"
        title="Nenhuma compra registrada ainda."
        text="Adicione sua primeira compra para acompanhar o consumo."
      />
    );
  }

  const avg = weightedDays(filtered);
  const last = filtered.at(-1);
  const elapsed = last ? daysBetween(last.date, today()) : 0;
  const level = avg
    ? Math.max(0, Math.min(100, 100 - (elapsed / avg) * 100))
    : 100;
  const left = avg ? Math.max(0, Math.round(avg - elapsed)) : 0;
  const total = filtered.reduce((s, e) => s + e.price, 0);
  const variation =
    filtered.length > 1
      ? ((filtered.at(-1)!.price - filtered[0].price) / filtered[0].price) * 100
      : 0;

  return (
    <section>
      <div className="title-row">
        <div>
          <h1>Dashboard</h1>
          <p>Visão geral do seu botijão</p>
        </div>
        <Chips
          values={["Tudo", "6 meses", "1 ano"]}
          value={period}
          onChange={setPeriod}
        />
      </div>

      <article className="gas-card">
        <div className="gas-head">
          <div>
            <span className="eyebrow">◆ NÍVEL ESTIMADO</span>
            <strong
              style={{
                color:
                  level > 50
                    ? "var(--green)"
                    : level > 25
                      ? "var(--amber)"
                      : "var(--red)",
              }}
            >
              {Math.round(level)}%
            </strong>
            <p>
              {avg
                ? `Aproximadamente ${left} dias restantes`
                : "Registre mais uma compra para calcular"}
            </p>
          </div>
          <div className="tank">
            <i style={{ height: `${level}%` }} />
          </div>
        </div>
        <div className="progress">
          <i style={{ width: `${level}%` }} />
        </div>
        <small>Estimativa baseada no intervalo ponderado entre compras</small>
      </article>

      <div className="metrics">
        <Metric label="Último preço" value={last ? brl(last.price) : "—"} />
        <Metric
          label="Total gasto"
          value={brl(total)}
          sub={`${filtered.length} compras`}
        />
        <Metric
          label="Variação"
          value={`${variation.toFixed(1).replace(".", ",")}%`}
          tone={variation > 0 ? "red" : "green"}
        />
        <Metric
          label="Frequência"
          value={avg ? `${avg} dias` : "—"}
          sub={avg ? "média ponderada" : "dados insuficientes"}
        />
      </div>

      {filtered.length > 1 && <PriceChart entries={filtered} />}
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

function PriceChart({ entries }: { entries: Entry[] }) {
  const min = Math.min(...entries.map((e) => e.price));
  const max = Math.max(...entries.map((e) => e.price));
  const range = max - min || 1;
  const points = entries
    .map(
      (e, i) =>
        `${(i / (entries.length - 1)) * 100},${90 - ((e.price - min) / range) * 70}`,
    )
    .join(" ");

  return (
    <article className="chart-card">
      <div>
        <h2>Evolução de preço</h2>
        <span>
          {brl(min)} — {brl(max)}
        </span>
      </div>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        aria-label="Gráfico de evolução de preço"
      >
        <polyline points={points} />
      </svg>
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

  const save = async () => {
    const p = Number(price.replace(",", "."));
    if (!date || date > today() || !p || p <= 0 || !mode || !vendor.trim()) {
      return notify("Preencha todos os campos com valores válidos.", true);
    }

    await db.put("entries", { date, price: p, mode, vendor: vendor.trim() });
    if (
      !vendors.some(
        (v) => v.name.toLowerCase() === vendor.trim().toLowerCase(),
      )
    ) {
      await db.put("vendors", {
        name: vendor.trim(),
        phone: "",
        contactType: "whatsapp",
      });
    }

    await refresh();
    setPrice("");
    setMode("");
    setVendor("");
    notify("Compra registrada com sucesso.");
  };

  return (
    <section className="form-page">
      <h1>Nova compra</h1>
      <p>Registre a troca do seu botijão</p>

      <article className="panel form">
        <label>
          Data
          <input
            type="date"
            max={today()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>

        <label>
          Preço (R$)
          <input
            inputMode="decimal"
            placeholder="0,00"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^0-9,.]/g, ""))}
          />
        </label>

        <fieldset>
          <legend>Pagamento</legend>
          <Chips values={MODES} value={mode} onChange={setMode} />
        </fieldset>

        <label>
          Vendedor
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

        <button type="button" className="primary" onClick={save}>
          Salvar compra
        </button>
      </article>
    </section>
  );
}

function History({
  entries,
  refresh,
  notify,
}: {
  entries: Entry[];
  vendors: Vendor[];
  refresh: () => Promise<void>;
  notify: (s: string, e?: boolean) => void;
}) {
  const [period, setPeriod] = useState("Tudo");
  const [sort, setSort] = useState("Data ↓");
  const [edit, setEdit] = useState<Entry | null>(null);

  const list = useMemo(() => {
    let a = [...entries];
    if (period !== "Tudo") {
      const d = new Date();
      d.setMonth(d.getMonth() - (period === "6 meses" ? 6 : 12));
      a = a.filter((e) => civil(e.date) > d);
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
          <p>{list.length} compras encontradas</p>
        </div>
        <div className="filters">
          <Chips
            values={["Tudo", "6 meses", "1 ano"]}
            value={period}
            onChange={setPeriod}
          />
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {["Data ↓", "Data ↑", "Preço ↓", "Preço ↑"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </div>
      </div>

      {!list.length ? (
        <Empty icon="≡" title="Nenhuma compra encontrada." />
      ) : (
        <div className="list">
          {list.map((e) => (
            <article className="entry" key={e.id}>
              <div>
                <small>{brDate(e.date)}</small>
                <strong>{e.vendor}</strong>
                <span>{e.mode}</span>
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
  close,
  done,
}: {
  entry: Entry;
  close: () => void;
  done: () => void;
}) {
  const [date, setDate] = useState(entry.date);
  const [price, setPrice] = useState(String(entry.price).replace(".", ","));
  const [mode, setMode] = useState(entry.mode);
  const [vendor, setVendor] = useState(entry.vendor);

  return (
    <div className="modal">
      <article>
        <h2>Editar compra</h2>
        <label>
          Data
          <input
            type="date"
            max={today()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label>
          Preço
          <input value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <Chips values={MODES} value={mode} onChange={setMode} />
        <label>
          Vendedor
          <input value={vendor} onChange={(e) => setVendor(e.target.value)} />
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
              if (!date || date > today() || !p || !mode || !vendor.trim()) {
                return;
              }
              await db.put("entries", {
                ...entry,
                date,
                price: p,
                mode,
                vendor: vendor.trim(),
              });
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
  vendors,
  refresh,
  notify,
}: {
  entries: Entry[];
  vendors: Vendor[];
  refresh: () => Promise<void>;
  notify: (s: string, e?: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [type, setType] = useState<Vendor["contactType"]>("whatsapp");
  const [edit, setEdit] = useState<Vendor | null>(null);

  const save = async () => {
    if (!name.trim()) {
      return notify("Informe o nome do vendedor.", true);
    }
    if (
      vendors.some((v) => v.name.toLowerCase() === name.trim().toLowerCase())
    ) {
      return notify("Este vendedor já está cadastrado.", true);
    }

    await db.put("vendors", {
      name: name.trim(),
      phone,
      contactType: type,
    });
    setName("");
    setPhone("");
    await refresh();
    notify("Vendedor adicionado.");
  };

  return (
    <section>
      <h1>Vendedores</h1>
      <p>Cadastre seus contatos de gás</p>

      <article className="panel vendor-form">
        <input
          placeholder="Nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="tel"
          placeholder="Telefone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <Chips
          values={["whatsapp", "phone", "app"]}
          value={type}
          onChange={(v) => setType(v as Vendor["contactType"])}
        />
        <button type="button" className="primary" onClick={save}>
          Adicionar
        </button>
      </article>

      <div className="list">
        {vendors.map((v) => (
          <article className="vendor" key={v.id}>
            <div>
              <strong>{v.name}</strong>
              <span>{v.phone || "Sem telefone"}</span>
            </div>
            {v.phone && v.contactType !== "app" && (
              <a
                href={
                  v.contactType === "whatsapp"
                    ? `https://wa.me/55${v.phone.replace(/\D/g, "")}`
                    : `tel:${v.phone.replace(/\D/g, "")}`
                }
                aria-label="Entrar em contato"
              >
                {v.contactType === "whatsapp" ? "Mensagem" : "Ligar"}
              </a>
            )}
            <button type="button" onClick={() => setEdit(v)}>
              ✎
            </button>
          </article>
        ))}
      </div>

      {edit && (
        <EditVendor
          vendor={edit}
          close={() => setEdit(null)}
          done={async () => {
            await refresh();
            setEdit(null);
            notify("Vendedor atualizado.");
          }}
        />
      )}
    </section>
  );
}

function EditVendor({
  vendor,
  close,
  done,
}: {
  vendor: Vendor;
  close: () => void;
  done: () => void;
}) {
  const [name, setName] = useState(vendor.name);
  const [phone, setPhone] = useState(vendor.phone);
  const [type, setType] = useState<Vendor["contactType"]>(vendor.contactType);

  return (
    <div className="modal">
      <article>
        <h2>Editar vendedor</h2>
        <label>
          Nome
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Telefone
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <Chips
          values={["whatsapp", "phone", "app"]}
          value={type}
          onChange={(v) => setType(v as Vendor["contactType"])}
        />
        <div className="actions">
          <button
            type="button"
            className="danger"
            onClick={async () => {
              if (await iosConfirm("Excluir este vendedor?", true)) {
                await db.delete("vendors", vendor.id!);
                done();
              }
            }}
          >
            Excluir
          </button>
          <button type="button" onClick={close}>
            Cancelar
          </button>
          <button
            type="button"
            className="primary"
            onClick={async () => {
              if (!name.trim()) return;
              await db.put("vendors", {
                ...vendor,
                name: name.trim(),
                phone,
                contactType: type,
              });
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

function Settings({
  entries,
  vendors,
  theme,
  setTheme,
  exportJson,
  importRef,
  notify,
  refresh,
}: {
  entries: Entry[];
  vendors: Vendor[];
  theme: Theme;
  setTheme: (t: Theme) => void;
  exportJson: () => void;
  importRef: React.RefObject<HTMLInputElement | null>;
  notify: (s: string, e?: boolean) => void;
  refresh: () => Promise<void>;
}) {
  const clear = async () => {
    const confirmed = await iosConfirm(
      "Apagar permanentemente todas as compras e vendedores deste aparelho?",
      true,
    );
    if (!confirmed) return;

    await db.replace([], []);
    await refresh();
    notify("Todos os dados foram removidos.");
  };

  return (
    <section>
      <h1>Configurações</h1>
      <p>Preferências, backup e seus dados</p>

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

      <h2 className="section-title">BACKUP COMPLETO</h2>
      <div className="settings-grid">
        <button type="button" className="setting-button" onClick={exportJson}>
          <b>↓</b>
          <div>
            <strong>Salvar backup JSON</strong>
            <span>
              {entries.length} compras e {vendors.length} vendedores
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
