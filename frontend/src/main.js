import { LitElement, css, html } from "lit";

const TOKEN_KEY = "tanpit_token";
const LABELS = { fill: "注液", tanning: "鞣制中", drained: "已放液" };

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.detail || "请求失败");
    err.status = res.status;
    throw err;
  }
  return data;
}

// 浮点抹零：均值只展示到两位小数，空值保持空白（空坑不得写字）。
function fmt(n) {
  if (n === null || n === undefined) return "";
  return String(Math.round(n * 100) / 100);
}

class TanYard extends LitElement {
  static properties = {
    ready: { type: Boolean },
    view: { type: String },
    board: { type: Object },
    pickedId: { type: Number },
    ph: { type: String },
    err: { type: String },
    busy: { type: Boolean },
    username: { type: String },
    password: { type: String },
  };

  static styles = css`
    :host { display: block; font-family: "KaiTi", serif; color: #2b2118; }
    .wrap { max-width: 880px; margin: 0 auto; padding: 12px 16px 50px; }
    .topbar { display: flex; align-items: center; gap: 10px; border-bottom: 2px solid #8a5a2b; padding: 8px 0 10px; margin-bottom: 14px; }
    .topbar h1 { font-size: 1.25em; margin: 0 12px 0 0; }
    .navbtn { background: #efe6d8; border: 1px solid #8a5a2b; border-radius: 6px; padding: 6px 14px; cursor: pointer; font: inherit; }
    .navbtn.on { background: #8a5a2b; color: #fff; }
    .topbar .spacer { flex: 1; }
    .logout { background: none; border: 0; color: #6b5a48; cursor: pointer; font: inherit; text-decoration: underline; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .pit { position: relative; min-height: 110px; border-radius: 8px; color: #fff; cursor: pointer; border: 0; text-align: left; padding: 12px 14px; font: inherit; }
    .pit .code { font-size: 1.15em; font-weight: bold; }
    .fill { background: #6d8f9e; }
    .tanning { background: #8a5a2b; }
    .drained { background: #5f6f4a; }
    .patch { position: absolute; right: 8px; bottom: 8px; background: rgba(255,255,255,0.92); color: #2b2118; border-radius: 6px; padding: 3px 8px; font-size: 0.9em; }
    .patch b { font-size: 1.15em; }
    table { border-collapse: collapse; width: 100%; background: #fff; }
    th, td { border: 1px solid #d8c9b4; padding: 8px 10px; text-align: left; }
    th { background: #efe6d8; }
    td.avg { font-size: 1.2em; font-weight: bold; }
    .err { color: #9b1c1c; }
    .hint { color: #6b5a48; font-size: 0.92em; }
    label { display: block; margin: 8px 0; }
    input, button { font: inherit; padding: 8px 10px; margin: 4px 6px 4px 0; }
    .mask { position: fixed; inset: 0; background: rgba(40,30,20,0.35); }
    .drawer { position: fixed; top: 0; right: 0; bottom: 0; width: 330px; max-width: 90vw; background: #f7f1e6; box-shadow: -4px 0 14px rgba(0,0,0,0.25); padding: 18px 18px 30px; overflow-y: auto; }
    .drawer h3 { margin-top: 4px; }
    .drawer .close { float: right; border: 0; background: none; font-size: 1.3em; cursor: pointer; }
  `;

  constructor() {
    super();
    this.ready = Boolean(localStorage.getItem(TOKEN_KEY));
    this.view = "board";
    this.board = null;
    this.pickedId = null;
    this.ph = "";
    this.err = "";
    this.busy = false;
    this.username = "admin";
    this.password = "123456";
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.ready) this.loadAll();
  }

  get picked() {
    return this.board ? this.board.pits.find((p) => p.id === this.pickedId) || null : null;
  }

  async loadAll() {
    // 场地图贴片与均值专页共用同一份 /api/board：写入后只重拉这一批新库记录，
    // 贴片与均值永远来自同一集合，不可能只刷新一侧。
    try {
      this.board = await api("/api/board");
    } catch (e) {
      if (e.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        this.ready = false;
        return;
      }
      this.err = e.message;
    }
  }

  async login(e) {
    e.preventDefault();
    this.err = "";
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: this.username, password: this.password }),
      });
      localStorage.setItem(TOKEN_KEY, data.access_token);
      this.ready = true;
      await this.loadAll();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    this.ready = false;
    this.board = null;
    this.pickedId = null;
  }

  openDrawer(pit) {
    this.err = "";
    this.pickedId = pit.id;
    this.ph = pit.latestPh === null || pit.latestPh === undefined ? "" : String(fmt(pit.latestPh));
  }

  async writePh() {
    const pit = this.picked;
    if (!pit || this.busy) return;
    const value = Number(this.ph);
    if (this.ph.trim() === "" || !Number.isFinite(value)) {
      this.err = "请填写有效酸碱度数字";
      return;
    }
    this.busy = true;
    this.err = "";
    try {
      await api(`/api/pits/${pit.id}/samples`, {
        method: "POST",
        body: JSON.stringify({ ph: value }),
      });
    } catch (ex) {
      // 两人抢登同一坑：败者 409，只许一条入库；刷新让贴片/均值跟着胜者那条走。
      this.err = ex.status === 409 ? `未入库：${ex.message}` : ex.message;
    } finally {
      // 无论成功还是被并发顶掉，都重拉两侧：新近次贴片与均值按库内同一批新集合走。
      await this.loadAll();
      this.busy = false;
    }
  }

  async setStatus(status) {
    const pit = this.picked;
    if (!pit || this.busy) return;
    this.busy = true;
    this.err = "";
    try {
      await api(`/api/pits/${pit.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      await this.loadAll();
    } catch (ex) {
      this.err = ex.message;
    } finally {
      this.busy = false;
    }
  }

  renderPatch(p) {
    const text = fmt(p.latestPh);
    return html`<span class="patch">最近酸碱 <b>${text === "" ? "—" : text}</b></span>`;
  }

  renderBoard() {
    if (!this.board) return html`<div class="wrap">${this.err || "装载坑位…"}</div>`;
    return html`
      <p>${this.board.village} · 点坑拉开抽屉登记浸液酸碱度；放液须最近读数 3.5～5.0</p>
      <div class="grid">
        ${this.board.pits.map(
          (p) => html`<button class="pit ${p.status}" @click=${() => this.openDrawer(p)}>
            <span class="code">${p.code}</span><br />${LABELS[p.status]}
            ${this.renderPatch(p)}
          </button>`
        )}
      </div>`;
  }

  renderMeans() {
    if (!this.board) return html`<p>${this.err || "装载均值…"}</p>`;
    return html`
      <p class="hint">各坑算术平均只统计未作废酸碱；空坑无记录，均值留空。贴片与均值同源。</p>
      <table>
        <thead><tr><th>坑号</th><th>状态</th><th>最近酸碱（贴片）</th><th>酸碱均值</th><th>条次</th><th>参与平均的值</th></tr></thead>
        <tbody>
          ${this.board.pits.map(
            (p) => html`<tr>
              <td>${p.code}</td>
              <td>${LABELS[p.status]}</td>
              <td>${fmt(p.latestPh)}</td>
              <td class="avg">${fmt(p.avgPh)}</td>
              <td>${p.sampleCount}</td>
              <td>${p.values.length ? p.values.map(fmt).join("、") : ""}</td>
            </tr>`
          )}
        </tbody>
      </table>`;
  }

  renderDrawer() {
    const pit = this.picked;
    if (!pit) return "";
    return html`
      <div class="mask" @click=${() => (this.pickedId = null)}></div>
      <aside class="drawer">
        <button class="close" @click=${() => (this.pickedId = null)}>×</button>
        <h3>${pit.code} · ${LABELS[pit.status]}</h3>
        <p>最近酸碱贴片：<b>${fmt(pit.latestPh)}</b>（${pit.sampleCount} 条未作废）</p>
        <label>本次酸碱度
          <input .value=${this.ph} @input=${(e) => (this.ph = e.target.value)} ?disabled=${this.busy} />
        </label>
        <button ?disabled=${this.busy} @click=${this.writePh}>登记酸碱度</button>
        <hr />
        <p class="hint">改坑态不看贴片规矩：</p>
        <div>
          <button ?disabled=${this.busy} @click=${() => this.setStatus("fill")}>注液</button>
          <button ?disabled=${this.busy} @click=${() => this.setStatus("tanning")}>鞣制中</button>
          <button ?disabled=${this.busy} @click=${() => this.setStatus("drained")}>已放液</button>
        </div>
      </aside>`;
  }

  render() {
    if (!this.ready) {
      return html`<div class="wrap">
        <h1>南冈鞣场</h1>
        <form @submit=${this.login} autocomplete="off">
          <label>用户名
            <input name="username" autocomplete="off" .value=${this.username} @input=${(e) => (this.username = e.target.value)} />
          </label>
          <label>密码
            <input name="password" type="password" autocomplete="off" .value=${this.password} @input=${(e) => (this.password = e.target.value)} />
          </label>
          <p class="hint">已预填 admin / 123456，另有 worker / 123456</p>
          <button>登录</button>
        </form>
        ${this.err ? html`<p class="err">${this.err}</p>` : ""}
      </div>`;
    }
    return html`<div class="wrap">
      <nav class="topbar">
        <h1>南冈鞣场</h1>
        <button class="navbtn ${this.view === "board" ? "on" : ""}" @click=${() => (this.view = "board")}>坑位场地图</button>
        <button class="navbtn ${this.view === "means" ? "on" : ""}" @click=${() => (this.view = "means")}>酸碱均值</button>
        <span class="spacer"></span>
        <button class="logout" @click=${this.logout}>退出</button>
      </nav>
      ${this.view === "board" ? this.renderBoard() : this.renderMeans()}
      ${this.err ? html`<p class="err">${this.err}</p>` : ""}
    </div>
    ${this.renderDrawer()}`;
  }
}

customElements.define("tan-yard", TanYard);
