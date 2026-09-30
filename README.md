# purchase-tracker

A local-first purchase tracker: a spreadsheet-style ledger, a receipt (PDF/image)
stored with each row, a free-text **detail** per purchase, running total computed
in SQL, search + date-range filters, a monthly overview, **lists** that group purchases
from any month (exportable to PDF/CSV), light/dark theme, and a one-file
**JSON export/import** (receipts and lists included). Everything lives in one
SQLite file on your machine — no server, no account.

**Stack:** Tauri v2 · React + Vite + TypeScript · AG Grid Community · SQLite (rusqlite).
The frontend never touches SQLite directly — it calls Rust `#[tauri::command]`s via
`invoke()`, so all SQL and the atomic "purchase + its receipts" write stay in Rust.

---

## Step 0 — Install the toolchain (once per machine)

You need three things: OS build libraries, Rust, and Node. Your end users won't
need any of this — only you, the developer.

**a. System dependencies** (pick your OS):

- **macOS** — Xcode Command Line Tools:
  ```bash
  xcode-select --install
  ```
- **Windows** — install the Microsoft C++ Build Tools (tick the
  "Desktop development with C++" workload). WebView2 is already on Windows 10
  (1803+) and Windows 11, so you can skip it there.
- **Linux (Debian/Ubuntu):**
  ```bash
  sudo apt update
  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
    libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```

**b. Rust** (via rustup), then restart your terminal:

```bash
# macOS / Linux
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh
# Windows: use the installer from https://www.rust-lang.org/tools/install
rustc --version   # verify
```

**c. Node.js LTS** from https://nodejs.org , then enable pnpm (ships with Node):

```bash
corepack enable
node -v && pnpm -v   # verify
```

---

## Step 1 — Scaffold the project

```bash
pnpm create tauri-app
```

Answer the prompts:

- Project name: **purchase-tracker**
- Package manager: **pnpm**
- UI template: **React**
- UI flavor: **TypeScript**

Then:

```bash
cd purchase-tracker
```

While you're here, open `src-tauri/tauri.conf.json` and set a proper
`identifier` (e.g. `com.yourname.gastos`). It decides the name of the per-OS
data folder where the database lives, so pick it before you ship.

---

## Step 2 — Add dependencies

Frontend:

```bash
pnpm add @tauri-apps/api ag-grid-react@^32 ag-grid-community@^32
```

> These files target AG Grid **v32**. If you install v33+, register
> `AllCommunityModule` instead of `ClientSideRowModelModule` in `App.tsx`, and
> remove the two `ag-grid-community/styles/*.css` imports (v33 uses the Theming API).

Rust — add to `src-tauri/Cargo.toml` under `[dependencies]`:

```toml
rusqlite = { version = "0.32", features = ["bundled"] }
base64 = "0.22"
serde = { version = "1", features = ["derive"] }   # usually already present
serde_json = "1"                                   # for export/import
```

`bundled` compiles SQLite in, so there's no system SQLite to install.

---

## Step 3 — Drop in the files

Copy each file from this folder to the matching path in your scaffold. Create the
`src/lib` and `src/components` directories if they don't exist.

| File                                  | Action                                    |
|---------------------------------------|-------------------------------------------|
| `src/App.tsx`                         | replace the generated one                 |
| `src/styles.css`                      | new                                       |
| `src/lib/api.ts`                      | new                                       |
| `src/lib/report.ts`                   | new (PDF/CSV export of a list)            |
| `src/components/*.tsx`                | new — all 19 components                   |
| `src-tauri/src/commands.rs`           | new                                       |
| `src-tauri/src/schema.sql`            | new                                       |
| `src-tauri/src/lib.rs`                | replace the generated one (it's complete) |
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` | replace (includes jspdf) |
| `.github/workflows/release.yml`       | new — optional, only for CI builds        |

`src-tauri/src/main.rs` stays exactly as generated — it just calls `run()`.

The generated `src/main.tsx` already imports and renders `App`, and `App.tsx`
imports `./styles.css`, so there's nothing else to wire up.

---

## Step 4 — Run it

```bash
pnpm tauri dev
```

The **first** run is slow (a few minutes) — it compiles SQLite and every Rust
crate once, then caches them. After that, dev is fast: editing `.tsx`/`.css`
hot-reloads instantly; editing Rust triggers a quick recompile + relaunch.

The database is created automatically on first launch in your OS app-data dir:

- **Linux:** `~/.local/share/<identifier>/purchases.db`
- **macOS:** `~/Library/Application Support/<identifier>/purchases.db`
- **Windows:** `%APPDATA%\<identifier>\purchases.db`

The schema also self-migrates: on startup it adds any missing column (e.g. the
`detail` field) or table (e.g. `lists`) without losing data.

**Smoke test** — click through these to confirm everything's wired:

1. Add a purchase (date, concept, price). As you type a concept, a **detail**
   box opens below it; drag a receipt (PDF/image) into the dropzone.
2. **Click the row** — a detail view opens with the concept, the detail text and
   the receipts, plus **Editar** / **Eliminar**. (Each row also has quick
   pencil/trash icons and a "Ver" link for receipts.)
3. Edit the price — the **Acumulado** column recomputes.
4. Search by concept and set a **Desde/Hasta** range; switch to the **Meses**
   tab to see per-month totals, click a month to drill in.
5. **Exportar** — writes `gastos-<fecha>.json` (with receipts) to Downloads;
   **Importar** merges it back.
6. Toggle the **sun/moon** button for dark mode.
7. **Listas** tab: create a list, click **Añadir compras**, tick a few purchases
   from different months. The list shows its total; export it to PDF or CSV.
8. Back in **Detalle**, tick rows with the checkboxes and use **Añadir a lista**.
   When adding a purchase, the **Listas** button next to the price puts it in one
   or more lists (you can create a new list right there).
9. Delete a row — it and its receipts disappear (and it leaves its lists).

---

## Step 5 — Distribute

`pnpm tauri build` builds an installer **for the OS you run it on** and drops it
in `src-tauri/target/release/bundle/`:

- **Linux:** `.AppImage`, `.deb`, `.rpm`
- **macOS:** `.dmg` (+ `.app`)
- **Windows:** `.msi` (WiX) and `-setup.exe` (NSIS)

### Getting a Windows build

`.msi` can only be built **on** Windows; cross-compiling from Linux/macOS is
experimental and not recommended. Two good options:

1. **GitHub Actions (no Windows machine needed).** Push the repo to GitHub and
   use the included `.github/workflows/release.yml`. It builds Windows, macOS and
   Linux installers at once and attaches them to a draft release. Trigger it with
   a version tag:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
   (or run it by hand from the **Actions** tab).

2. **Build on Windows directly.** With Rust + the MSVC C++ Build Tools + Node/pnpm
   installed, run `pnpm install` then `pnpm tauri build`. WebView2 is preinstalled
   on Windows 10/11, so the app just runs.

The data is stored per-OS automatically (see paths above), and the JSON
export/import is platform-independent — you can export on Linux and import on
Windows, receipts and all.

---

## What's deliberately left for later

- **Backup/durability** — timestamped copies or Litestream (export is done; this
  is about automatic, continuous safety)
- **Per-month CSV / xlsx export** — `list_month` is already the right query for it
- A category column, if you want to group spending

## Design notes

- Money is **integer cents** end to end; only formatted to euros for display. No
  float ever touches a price.
- The running total is **computed** (`SUM(...) OVER (ORDER BY date, id)`), never
  stored — it can't drift out of sync when you edit or delete a row.
- There's **one** purchases table; months are derived from the date, not separate
  tables — so totals and cross-month queries stay trivial.
- Lists are a many-to-many join (`list_items`): a purchase can be in several
  lists, deleting a list never deletes purchases, and the JSON export stores list
  membership by position so it imports cleanly into another database.
- Receipts are stored as **BLOBs inside the same SQLite file**, so a single file
  (or a single JSON export) is a complete backup.
- Theming is driven by CSS variables with a `[data-theme="dark"]` override; the
  choice persists in `localStorage` and defaults to the system preference.
