window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-web-search-local",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		const NS = "web-search-local";
		const LOCAL_LOCALE = "web-search-local";
		const en = {
			title: "Web search",
			description: "Search the web (built-in local metasearch: DuckDuckGo + Bing + Wikipedia) + optional local corpus.",
			engine: "Web search backend",
			engineHint: "auto / searxng = built-in local metasearch (SearXNG port, in-process, no instance); duckduckgo = DuckDuckGo only. No API key.",
			corpus: "Local corpus directories (one per line)",
			corpusHint: "Absolute or ~ paths. Only used by the `local` search provider.",
			maxResults: "Max results",
			snippet: "Snippet length",
			indexDir: "Index directory",
			indexDirHint: "Leave empty to use the DSH home.",
			autoReindex: "Re-scan the corpus on each search",
			save: "Save",
			saving: "Saving…",
			discard: "Discard",
			unsaved: "Unsaved",
			saveFailed: "The deployment did not accept these values.",
			readOnly: "This deployment stores settings read-only.",
		};
		const zh = {
			title: "网络搜索",
			description: "搜索互联网（内置本地元搜索：DuckDuckGo + Bing + Wikipedia）+ 可选本地语料。",
			engine: "网络搜索后端",
			engineHint: "auto / searxng = 内置本地元搜索（SearXNG 移植，进程内，无需实例）；duckduckgo = 仅 DuckDuckGo。无需 API key。",
			corpus: "本地语料目录（每行一个）",
			corpusHint: "绝对路径或 ~ 路径。仅 `local` 搜索 provider 使用。",
			maxResults: "最大结果数",
			snippet: "摘要长度",
			indexDir: "索引目录",
			indexDirHint: "留空以使用 DSH 主目录。",
			autoReindex: "每次搜索时重新扫描语料",
			save: "保存",
			saving: "保存中…",
			discard: "放弃修改",
			unsaved: "未保存",
			saveFailed: "本部署未接受这些值。",
			readOnly: "本部署的设置为只读。",
		};

		class Store {
			constructor(initial) {
				this._s = initial;
				this._subs = new Set();
			}
			set(s) {
				this._s = s;
				for (const l of [...this._subs]) l();
			}
			getSnapshot() {
				return this._s;
			}
			subscribe(l) {
				this._subs.add(l);
				return () => this._subs.delete(l);
			}
		}

		class LocalSearchCardController {
			constructor(scope) {
				this.scope = scope;
				this.staged = null;
				this.failed = false;
				this.saving = false;
				this.store = new Store(this._proj());
				this._unsub = scope.subscribe(() => {
					if (!this.saving) this.staged = null;
					this._publish();
				});
				this._publish();
			}
			_proj() {
				const s = this.scope.getSnapshot();
				const v = (s && s.value) || {};
				const st = this.staged || {};
				const engine = "engine" in st ? st.engine : v.engine || "auto";
				const corpus =
					"corpusDirs" in st
						? st.corpusDirs
						: Array.isArray(v.corpusDirs)
							? v.corpusDirs.join("\n")
							: "";
				const maxResults =
					"maxResults" in st ? st.maxResults : v.maxResults != null ? String(v.maxResults) : "";
				const snippet =
					"snippetLength" in st ? st.snippetLength : v.snippetLength != null ? String(v.snippetLength) : "";
				const indexDir = "indexDir" in st ? st.indexDir : v.indexDir || "";
				const autoReindex =
					"autoReindex" in st ? st.autoReindex : v.autoReindex != null ? v.autoReindex : true;
				return {
					available: s ? s.status === "ready" : false,
					writable: s ? !!s.writable : false,
					dirty: !!(st && Object.keys(st).length > 0),
					failed: this.failed,
					saving: this.saving,
					engine,
					corpusDirs: corpus,
					maxResults,
					snippetLength: snippet,
					indexDir,
					autoReindex,
				};
			}
			_publish() {
				this.store.set(this._proj());
			}
			edit(field, value) {
				this.staged = { ...(this.staged || {}), [field]: value };
				this._publish();
			}
			resetField(field) {
				this.staged = { ...(this.staged || {}) };
				delete this.staged[field];
				this._publish();
			}
			discard() {
				this.staged = null;
				this.failed = false;
				this._publish();
			}
			async save() {
				this.saving = true;
				this.failed = false;
				this._publish();
				try {
					const st = this.staged || {};
					if ("engine" in st) {
						const s = String(st.engine);
						if (s === "auto" || s === "duckduckgo" || s === "searxng") await this.scope.set("engine", s);
						else await this.scope.unset("engine");
					}
					if ("corpusDirs" in st) {
						const lines = String(st.corpusDirs)
							.split(/\r?\n/)
							.map((x) => x.trim())
							.filter(Boolean);
						if (lines.length) await this.scope.set("corpusDirs", lines);
						else await this.scope.unset("corpusDirs");
					}
					if ("maxResults" in st) {
						const n = parseInt(st.maxResults, 10);
						if (Number.isFinite(n) && n > 0) await this.scope.set("maxResults", n);
						else await this.scope.unset("maxResults");
					}
					if ("snippetLength" in st) {
						const n = parseInt(st.snippetLength, 10);
						if (Number.isFinite(n) && n >= 20) await this.scope.set("snippetLength", n);
						else await this.scope.unset("snippetLength");
					}
					if ("indexDir" in st) {
						const s = String(st.indexDir).trim();
						if (s) await this.scope.set("indexDir", s);
						else await this.scope.unset("indexDir");
					}
					if ("autoReindex" in st) await this.scope.set("autoReindex", !!st.autoReindex);
					this.staged = null;
				} catch {
					this.failed = true;
				} finally {
					this.saving = false;
					this._publish();
				}
			}
			inject() {
				return {
					hooks: { localSearchCard: this.store },
					save: () => this.save(),
					discard: () => this.discard(),
					edit: (field, value) => this.edit(field, value),
				};
			}
			dispose() {
				if (this._unsub) this._unsub();
				this._unsub = undefined;
			}
		}

		const styleCard = { listStyle: "none", borderTop: "0.5px solid var(--dsw-alias-border-l2, #333)" };
		const styleHeader = {
			width: "100%",
			display: "flex",
			alignItems: "center",
			gap: 8,
			background: "transparent",
			border: "none",
			cursor: "pointer",
			padding: "12px 0",
			textAlign: "left",
			color: "inherit",
		};
		const styleName = { fontWeight: 500, fontSize: 13 };
		const styleDesc = { color: "var(--dsw-alias-label-tertiary, #888)", fontSize: 12, flex: 1 };
		const stylePending = { color: "var(--dsw-alias-label-secondary, #aaa)", fontSize: 11 };
		const styleBody = { display: "flex", flexDirection: "column", gap: 12, padding: "0 0 12px 0" };
		const styleLabel = { display: "flex", flexDirection: "column", gap: 4, fontSize: 13 };
		const styleInput = {
			height: 34,
			padding: "0 12px",
			borderRadius: 8,
			border: "0.5px solid var(--dsw-alias-border-l4, #444)",
			background: "var(--dsw-alias-bg-layer-3, #111)",
			color: "inherit",
			font: "inherit",
		};
		const styleArea = {
			minHeight: 84,
			padding: "8px 12px",
			borderRadius: 8,
			border: "0.5px solid var(--dsw-alias-border-l4, #444)",
			background: "var(--dsw-alias-bg-layer-3, #111)",
			color: "inherit",
			font: "inherit",
			resize: "vertical",
		};
		const styleFooter = { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 };
		const styleHint = { color: "var(--dsw-alias-label-tertiary, #888)", fontSize: 12, margin: 0 };

		function LocalSearchCard(props) {
			const snap = props.useLocalSearchCard((s) => s);
			const [open, setOpen] = react.useState(false);
			if (!snap || !snap.available) return null;
			const t = typeof props.t === "function" ? props.t : (k) => en[k] ?? k;
			const e = react.createElement;
			const edit = props.edit;
			const disabled = !snap.writable;
			return e(
				"li",
				{ style: styleCard },
				e(
					"button",
					{ type: "button", style: styleHeader, onClick: () => setOpen(!open), "aria-expanded": open },
					e("span", { style: styleName }, t("title")),
					e("span", { style: styleDesc }, t("description")),
					snap.dirty ? e("span", { style: stylePending }, t("unsaved")) : null,
				),
				open
					? e(
							"div",
							{ style: styleBody },
							!snap.writable ? e("p", { role: "status", style: styleHint }, t("readOnly")) : null,
							e(
								"label",
								{ style: styleLabel },
								t("engine"),
								e(
									"select",
									{
										id: "wsl-engine",
										style: styleInput,
										value: snap.engine,
										disabled,
										onChange: (ev) => edit("engine", ev.target.value),
									},
									e("option", { value: "auto" }, "auto"),
									e("option", { value: "duckduckgo" }, "duckduckgo"),
									e("option", { value: "searxng" }, "searxng"),
								),
								e("span", { style: styleHint }, t("engineHint")),
							),
							e(
								"label",
								{ style: styleLabel },
								t("corpus"),
								e("textarea", {
									id: "wsl-corpus",
									style: styleArea,
									value: snap.corpusDirs,
									disabled,
									onChange: (ev) => edit("corpusDirs", ev.target.value),
								}),
								e("span", { style: styleHint }, t("corpusHint")),
							),
							e(
								"label",
								{ style: styleLabel },
								t("maxResults"),
								e("input", {
									id: "wsl-max",
									style: styleInput,
									type: "number",
									value: snap.maxResults,
									disabled,
									onChange: (ev) => edit("maxResults", ev.target.value),
								}),
							),
							e(
								"label",
								{ style: styleLabel },
								t("snippet"),
								e("input", {
									id: "wsl-snip",
									style: styleInput,
									type: "number",
									value: snap.snippetLength,
									disabled,
									onChange: (ev) => edit("snippetLength", ev.target.value),
								}),
							),
							e(
								"label",
								{ style: styleLabel },
								t("indexDir"),
								e("input", {
									id: "wsl-idx",
									style: styleInput,
									value: snap.indexDir,
									placeholder: "~/.dsh/web-search-local",
									disabled,
									onChange: (ev) => edit("indexDir", ev.target.value),
								}),
								e("span", { style: styleHint }, t("indexDirHint")),
							),
							e(
								"label",
								{ style: { display: "flex", alignItems: "center", gap: 8, fontSize: 13 } },
								e("input", {
									id: "wsl-auto",
									type: "checkbox",
									checked: snap.autoReindex,
									disabled,
									onChange: (ev) => edit("autoReindex", ev.target.checked),
								}),
								t("autoReindex"),
							),
							snap.failed ? e("p", { role: "status", style: styleHint }, t("saveFailed")) : null,
							e(
								"div",
								{ style: styleFooter },
								e(
									"button",
									{
										type: "button",
										disabled: !snap.dirty || snap.saving,
										onClick: props.discard,
									},
									t("discard"),
								),
								e(
									"button",
									{
										type: "button",
										disabled: !snap.dirty || snap.saving,
										onClick: props.save,
									},
									snap.saving ? t("saving") : t("save"),
								),
							),
						)
					: null,
			);
		}

		const inject = ["slots", "locale", "settingsScope"];
		function apply(ctx) {
			try {
				if (ctx.locale && typeof ctx.locale.register === "function") {
					ctx.locale.register(LOCAL_LOCALE, { en, zh });
				}
			} catch {
			}
			const scope = ctx.settingsScope.bind({ namespace: NS });
			const controller = new LocalSearchCardController(scope);
			try {
				if (typeof ctx.effect === "function") {
					ctx.effect(() => controller.dispose, "web-search-local: card controller");
				}
			} catch {
			}
			ctx.slots.inject("settings.plugin.item", function* () {
				yield ctx.slots.register(
					{
						name: "settings.plugin.item",
						key: NS,
						locale: LOCAL_LOCALE,
						inject: () => controller.inject(),
					},
					LocalSearchCard,
				);
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
