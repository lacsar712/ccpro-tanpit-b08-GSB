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

// 均值显示保留两位小数并去尾零；空坑无记录时留空
const fmtMean = (x) => String(Number(x.toFixed(2)));
const viewFromHash = () => (location.hash === "#/mean" ? "mean" : "map");

class TanYard extends LitElement {
  static properties = {
    ready: { type: Boolean },
    board: { type: Object },
    means: { type: Object },
    picked: { type: Object },
    ph: { type: String },
    err: { type: String },
    view: { type: String },
    username: { type: String },
    password: { type: String },
    whoami: { type: String },
  };

  static styles = css`
    :host { display: block; font-family: "KaiTi", serif; color: #2b2118; }
    .topbar { display: flex; align-items: center; gap: 16px; background: #3a2c1e; color: #f3e7d3; padding: 10px 20px; }
    .topbar .brand { font-size: 1.15em; font-weight: bold; }
    .topbar nav a { color: #d9c6a5; text-decoration: none; padding: 5px 12px; border-radius: 6px; margin-right: 6px; }
    .topbar nav a.on { background: #8a5a2b; color: #fff; }
    .topbar .who { margin-left: auto; font-size: 0.92em; color: #d9c6a5; }
    .topbar button { font: inherit; padding: 4px 12px; margin-left: 10px; cursor: pointer; }
    .wrap { max-width: 880px; margin: 0 auto; padding: 28px 16px 50px; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .pit { position: relative; min-height: 110px; border-radius: 8px; color: #fff; cursor: pointer; border: 0; font: inherit; }
    .fill { background: #6d8f9e; }
    .tanning { background: #8a5a2b; }
    .drained { background: #5f6f4a; }
    .badge { position: absolute; top: 8px; right: 8px; background: rgba(255, 252, 245, 0.92); color: #2b2118; border-radius: 999px; padding: 2px 10px; font-size: 0.82em; }
    .drawer { margin-top: 18px; border: 1px solid #d9c6a5; border-radius: 8px; background: #fffdf6; padding: 14px 18px; }
    table.mean { border-collapse: collapse; width: 100%; background: #fffdf6; }
    table.mean th, table.mean td { border: 1px solid #d9c6a5; padding: 8px 14px; text-align: left; }
    table.mean th { background: #efe3cc; }
    table.mean td.num { text-align: right; }
    .err { color: #9b1c1c; }
    .hint { color: #6b5a48; font-size: 0.92em; }
    label { display: block; margin: 8px 0; }
    input, button { font: inherit; padding: 8px 10px; margin: 4px 6px 4px 0; }
  `;

  constructor() {
    super();
    this.ready = Boolean(localStorage.getItem(TOKEN_KEY));
    this.board = null;
    this.means = null;
    this.picked = null;
    this.ph = "4.2";
    this.err = "";
    this.view = viewFromHash();
    this.username = "admin";
    this.password = "123456";
    this.whoami = "";
  }

  connectedCallback() {
    super.connectedCallback();
    this._onHash = () => {
      this.view = viewFromHash();
      if (this.ready) this.refresh();
    };
    window.addEventListener("hashchange", this._onHash);
    if (this.ready) this.refresh();
  }

  disconnectedCallback() {
    window.removeEventListener("hashchange", this._onHash);
    super.disconnectedCallback();
  }

  // 场地图贴片与均值专页共用一次刷新，两侧永远同一批库记录
  async refresh() {
    try {
      const [board, means, me] = await Promise.all([
        api("/api/board"),
        api("/api/ph-means"),
        api("/api/auth/me"),
      ]);
      this.board = board;
      this.means = means;
      this.whoami = me.username;
      if (this.picked) {
        this.picked = this.board.pits.find((p) => p.id === this.picked.id) || this.board.pits[0];
      }
    } catch (e) {
      if (e.status === 401) return this.logout();
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
      this.whoami = data.user.username;
      this.ready = true;
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    this.ready = false;
    this.board = null;
    this.means = null;
    this.picked = null;
    this.whoami = "";
  }

  async writePh() {
    this.err = "";
    try {
      this.picked = await api(`/api/pits/${this.picked.id}/samples`, {
        method: "POST",
        body: JSON.stringify({ ph: Number(this.ph) }),
      });
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  async setStatus(status) {
    this.err = "";
    try {
      this.picked = await api(`/api/pits/${this.picked.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
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
    if (!this.board || !this.means) return html`<div class="wrap">${this.err || "装载坑位…"}</div>`;
    return html`<header class="topbar">
        <span class="brand">${this.board.yard}</span>
        <nav>
          <a href="#/map" class=${this.view === "map" ? "on" : ""}>坑位场地图</a>
          <a href="#/mean" class=${this.view === "mean" ? "on" : ""}>酸碱均值</a>
        </nav>
        <span class="who">${this.whoami}</span>
        <button @click=${this.logout}>退出</button>
      </header>
      <div class="wrap">
        ${this.view === "mean" ? this.renderMeans() : this.renderMap()}
        ${this.err ? html`<p class="err">${this.err}</p>` : ""}
      </div>`;
  }

  renderMap() {
    return html`<p class="hint">${this.board.village} · 点坑登记浸液酸碱度；放液须最近读数 3.5～5.0</p>
      <div class="grid">
        ${this.board.pits.map(
          (p) => html`<button class="pit ${p.status}" @click=${() => (this.picked = p)}>
            <span class="badge">pH ${p.latestPh ?? "无"}</span>
            <strong>${p.code}</strong><br />${LABELS[p.status]}
          </button>`
        )}
      </div>
      ${this.picked
        ? html`<section class="drawer">
            <h3>${this.picked.code} · ${LABELS[this.picked.status]}</h3>
            <p>最近酸碱度：${this.picked.latestPh ?? "无"} · ${this.picked.sampleCount} 次</p>
            <input .value=${this.ph} @input=${(e) => (this.ph = e.target.value)} />
            <button @click=${this.writePh}>登记酸碱度</button>
            <div>
              <button @click=${() => this.setStatus("fill")}>注液</button>
              <button @click=${() => this.setStatus("tanning")}>鞣制中</button>
              <button @click=${() => this.setStatus("drained")}>已放液</button>
            </div>
          </section>`
        : ""}`;
  }

  renderMeans() {
    const pits = (this.means && this.means.pits) || [];
    return html`<h2>酸碱均值</h2>
      <p class="hint">按坑列出该坑全部未作废浸液酸碱的算术平均；无记录的坑留空。</p>
      <table class="mean">
        <thead>
          <tr><th>坑位</th><th>状态</th><th>酸碱均值</th><th>记录次数</th></tr>
        </thead>
        <tbody>
          ${pits.map(
            (p) => html`<tr>
              <td>${p.code}</td>
              <td>${LABELS[p.status]}</td>
              <td class="num">${p.meanPh == null ? "" : fmtMean(p.meanPh)}</td>
              <td class="num">${p.sampleCount}</td>
            </tr>`
          )}
        </tbody>
      </table>`;
  }
}

customElements.define("tan-yard", TanYard);
