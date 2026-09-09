window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-web-search-local",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		/**
		 * Card chrome and field styles. The rules mirror the platform plugin cards
		 * (the stock Shell / Agent loop / Subagent / Web search cards): the same card,
		 * header, chevron, body, footer, and field metrics on the same design tokens,
		 * so this card sits in the Plugins section alongside the stock ones. The class
		 * names are namespaced to this plugin; the sheet is injected once per document,
		 * the same way the platform ships its own.
		 */
		const css = `.wslc_card{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:16px;list-style:none;transition:border-color .16s,background .16s}
.wslc_card:hover{border-color:var(--dsw-alias-label-dimmed)}
.wslc_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.wslc_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
.wslc_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.wslc_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}
.wslc_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
.wslc_description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
.wslc_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}
.wslc_chevronOpen{transform:rotate(180deg)}
.wslc_body{border-top:.5px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
.wslc_readOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}
.wslc_pending{corner-shape:round;white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
.wslc_footer{border-top:.5px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}
.wslc_failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}
.wslc_discard,.wslc_save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}
.wslc_discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}
.wslc_discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.wslc_save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.wslc_discard:disabled,.wslc_save:disabled{opacity:.4;cursor:default}
.wslc_discard:focus-visible,.wslc_save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.wslc_field{flex-direction:column;gap:6px;padding:12px 0;display:flex}
.wslc_field+.wslc_field{border-top:.5px solid var(--dsw-alias-border-l2)}
.wslc_head{align-items:center;gap:8px;display:flex}
.wslc_label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}
.wslc_badges{align-items:center;gap:8px;display:inline-flex}
.wslc_badge{corner-shape:round;white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
.wslc_reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}
.wslc_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.wslc_reset:disabled{cursor:default}
.wslc_input{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}
.wslc_input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.wslc_input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.wslc_inputInvalid{border-color:var(--dsw-alias-label-error)}
.wslc_invalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}
.wslc_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}
.wslc_select{appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14'%3E%3Cpath fill='%23888' d='M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;padding-right:32px}
.wslc_inputArea{min-height:84px;height:auto;padding:8px 12px;resize:vertical}
.wslc_checkRow{align-items:center;gap:12px;display:flex}
.wslc_checkLabel{align-items:center;gap:8px;flex:1;min-width:0;cursor:pointer;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);display:flex}
.wslc_check{width:14px;height:14px;flex:none;accent-color:var(--dsw-alias-brand-primary)}
.wslc_check:disabled{cursor:default;opacity:.5}`;
		const tagId = "@deepseek-ai/dsh-web-search-local/card.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-web-search-local";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		const cls = {
			card: "wslc_card",
			cardOpen: "wslc_cardOpen",
			header: "wslc_header",
			headText: "wslc_headText",
			name: "wslc_name",
			description: "wslc_description",
			chevron: "wslc_chevron",
			chevronOpen: "wslc_chevronOpen",
			body: "wslc_body",
			readOnly: "wslc_readOnly",
			pending: "wslc_pending",
			footer: "wslc_footer",
			failed: "wslc_failed",
			discard: "wslc_discard",
			save: "wslc_save",
			field: "wslc_field",
			head: "wslc_head",
			label: "wslc_label",
			badges: "wslc_badges",
			badge: "wslc_badge",
			reset: "wslc_reset",
			input: "wslc_input",
			inputInvalid: "wslc_inputInvalid",
			inputArea: "wslc_inputArea",
			select: "wslc_select",
			invalid: "wslc_invalid",
			hint: "wslc_hint",
			checkRow: "wslc_checkRow",
			checkLabel: "wslc_checkLabel",
			check: "wslc_check",
		};
		const join = (...parts) => parts.filter(Boolean).join(" ");

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
			maxResultsHint: "How many results one search returns.",
			snippet: "Snippet length",
			snippetHint: "How long each result's snippet is, in characters.",
			indexDir: "Index directory",
			indexDirHint: "Leave empty to use the DSH home.",
			autoReindex: "Re-scan the corpus on each search",
			save: "Save",
			saving: "Saving…",
			discard: "Discard",
			unsaved: "Unsaved",
			saveFailed: "The deployment did not accept these values; they were left for you to correct.",
			readOnly: "This deployment stores settings read-only.",
			expand: "Show settings",
			collapse: "Hide settings",
			overridden: "Overridden",
			reset: "Reset to default",
			invalidNumber: "Enter a number, or leave blank to use the default.",
		};
		const zh = {
			title: "网络搜索",
			description: "搜索互联网（内置本地元搜索：DuckDuckGo + Bing + Wikipedia）+ 可选本地语料。",
			engine: "网络搜索后端",
			engineHint: "auto / searxng = 内置本地元搜索（SearXNG 移植，进程内，无需实例）；duckduckgo = 仅 DuckDuckGo。无需 API key。",
			corpus: "本地语料目录（每行一个）",
			corpusHint: "绝对路径或 ~ 路径。仅 `local` 搜索 provider 使用。",
			maxResults: "最大结果数",
			maxResultsHint: "每次搜索返回的结果条数。",
			snippet: "摘要长度",
			snippetHint: "每条结果摘要的字符数。",
			indexDir: "索引目录",
			indexDirHint: "留空以使用 DSH 主目录。",
			autoReindex: "每次搜索时重新扫描语料",
			save: "保存",
			saving: "保存中…",
			discard: "放弃修改",
			unsaved: "未保存",
			saveFailed: "本部署没有接受这些值，已保留供你修改。",
			readOnly: "本部署的设置为只读。",
			expand: "展开设置",
			collapse: "收起设置",
			overridden: "已覆盖",
			reset: "恢复默认",
			invalidNumber: "请填数字；留空表示使用默认值。",
		};

		const ENGINE_OPTIONS = ["auto", "duckduckgo", "searxng"];
		/** The 14px outline chevron the platform cards use (IconChevronDownOutline14). */
		const CHEVRON_PATH =
			"M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z";

		/**
		 * Conversion specs for the section fields. `format` renders a stored value as
		 * the control's draft text; `parse` turns a draft into a write ({kind:
		 * "set"|"clear"}), or undefined when the draft is one the field does not
		 * accept — which blocks the save rather than silently dropping the edit.
		 */
		const FIELDS = {
			engine: {
				kind: "enum",
				defaultValue: "auto",
				format: (v) => (typeof v === "string" && ENGINE_OPTIONS.indexOf(v) !== -1 ? v : "auto"),
				parse: (t) => (ENGINE_OPTIONS.indexOf(t) !== -1 ? { kind: "set", value: t } : undefined),
			},
			corpusDirs: {
				kind: "lines",
				defaultValue: "",
				format: (v) => (Array.isArray(v) ? v.join("\n") : ""),
				parse: (t) => {
					const lines = String(t)
						.split(/\r?\n/)
						.map((x) => x.trim())
						.filter(Boolean);
					return lines.length > 0 ? { kind: "set", value: lines } : { kind: "clear" };
				},
			},
			maxResults: {
				kind: "number",
				defaultValue: "",
				format: (v) => (typeof v === "number" ? String(v) : ""),
				parse: (t) => {
					const s = String(t).trim();
					if (s === "") return { kind: "clear" };
					const n = Number(s);
					return Number.isFinite(n) ? { kind: "set", value: n } : undefined;
				},
			},
			snippetLength: {
				kind: "number",
				defaultValue: "",
				format: (v) => (typeof v === "number" ? String(v) : ""),
				parse: (t) => {
					const s = String(t).trim();
					if (s === "") return { kind: "clear" };
					const n = Number(s);
					return Number.isFinite(n) ? { kind: "set", value: n } : undefined;
				},
			},
			indexDir: {
				kind: "text",
				defaultValue: "",
				format: (v) => (typeof v === "string" ? v : ""),
				parse: (t) => {
					const s = String(t).trim();
					return s === "" ? { kind: "clear" } : { kind: "set", value: s };
				},
			},
			autoReindex: {
				kind: "boolean",
				defaultValue: true,
				format: (v) => (typeof v === "boolean" ? v : true),
				parse: (b) => ({ kind: "set", value: b === true }),
			},
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

		/**
		 * Stages this card's edits over the `web-search-local` settings namespace and
		 * writes them only on save. A field shows its effective value and whether the
		 * user layer carries it — that presence, not a value comparison, marks a field
		 * overridden, and a reset stages a clear back to the composition layer. The
		 * Host is the only authority on whether a value was accepted: each write is
		 * read back from the namespace after it settles.
		 */
		class LocalSearchCardController {
			constructor(scope) {
				this.scope = scope;
				this.staged = new Map();
				this.saving = false;
				this.failed = false;
				this.store = new Store(this.projection());
				this._unsub = scope.subscribe(() => {
					this.publish();
				});
				this.publish();
			}
			snapshot() {
				return this.scope.getSnapshot();
			}
			value() {
				const v = this.snapshot().value;
				return v !== null && typeof v === "object" && !Array.isArray(v) ? v : {};
			}
			base() {
				const b = this.snapshot().base;
				return b !== null && typeof b === "object" && !Array.isArray(b) ? b : {};
			}
			userLayer() {
				return this.snapshot().user;
			}
			stored(field) {
				const user = this.userLayer();
				return user !== void 0 && Object.prototype.hasOwnProperty.call(user, field);
			}
			/** The card-level state: what the Host serves, and what a save would do. */
			shell() {
				const snap = this.snapshot();
				const plan = this.plan();
				return {
					available: snap.status === "ready",
					writable: !!snap.writable,
					dirty: plan.length > 0,
					invalid: plan.some((item) => item.run === void 0),
					saving: this.saving,
					failed: this.failed,
				};
			}
			/** One control's state: the staged text, the override, and validity. */
			field(field) {
				const meta = FIELDS[field];
				const staged = this.staged.get(field);
				const v = this.value();
				if (meta.kind === "boolean") {
					const current = v[field] !== undefined ? v[field] : meta.defaultValue;
					const checked = staged !== undefined ? staged.bool : current === true;
					return { checked, overridden: staged !== undefined || this.stored(field), invalid: false };
				}
				if (staged === undefined)
					return {
						text: meta.format(v[field]),
						overridden: this.stored(field),
						invalid: false,
					};
				const write = staged.clear ? { kind: "clear" } : meta.parse(staged.text);
				return {
					text: staged.text,
					overridden: write !== void 0 && write.kind === "set",
					invalid: write === void 0,
				};
			}
			projection() {
				return {
					...this.shell(),
					engine: this.field("engine"),
					corpusDirs: this.field("corpusDirs"),
					maxResults: this.field("maxResults"),
					snippetLength: this.field("snippetLength"),
					indexDir: this.field("indexDir"),
					autoReindex: this.field("autoReindex"),
				};
			}
			publish() {
				this.store.set(this.projection());
			}
			edit(field, value) {
				if (FIELDS[field].kind === "boolean") this.staged.set(field, { bool: value === true });
				else this.staged.set(field, { text: String(value), clear: false });
				this.failed = false;
				this.publish();
			}
			/** Stage a reset: drop the user override so the field re-inherits. */
			resetField(field) {
				const meta = FIELDS[field];
				const base = this.base();
				const hasBase = Object.prototype.hasOwnProperty.call(base, field);
				if (meta.kind === "boolean") this.staged.set(field, { bool: hasBase ? base[field] === true : meta.defaultValue });
				else if (meta.kind === "enum") this.staged.set(field, { text: meta.format(hasBase ? base[field] : meta.defaultValue), clear: true });
				else this.staged.set(field, { text: meta.format(hasBase ? base[field] : void 0), clear: true });
				this.failed = false;
				this.publish();
			}
			/** Every staged edit a save would write, in staging order. */
			plan() {
				const v = this.value();
				const plan = [];
				for (const [field, staged] of this.staged) {
					const meta = FIELDS[field];
					if (meta.kind === "boolean") {
						const current = v[field] !== undefined ? v[field] : meta.defaultValue;
						if (staged.bool === current) continue;
						plan.push({ field, run: () => this.writeField(field, staged.bool) });
						continue;
					}
					if (staged.clear) {
						if (this.stored(field)) plan.push({ field, run: () => this.clear(field) });
						continue;
					}
					if (staged.text === meta.format(v[field])) continue;
					const write = meta.parse(staged.text);
					if (write === void 0) plan.push({ field, run: void 0 });
					else if (write.kind === "clear") plan.push({ field, run: () => this.clear(field) });
					else plan.push({ field, run: () => this.writeField(field, write.value) });
				}
				return plan;
			}
			async writeField(field, value) {
				await this.scope.set(field, value);
				return this.readBack(field, value);
			}
			async clear(field) {
				await this.scope.unset(field);
				return this.readBackClear(field);
			}
			/**
			 * Read a write back from the namespace. A missing user layer (a
			 * deployment that does not expose one) cannot refute the write, so it
			 * counts as landed; a present layer must agree.
			 */
			readBack(field, value) {
				const user = this.userLayer();
				if (user === void 0) return true;
				if (FIELDS[field].kind === "lines") {
					const candidate = user[field];
					return Array.isArray(candidate) && candidate.length === value.length && candidate.every((x, i) => x === value[i]);
				}
				return user[field] === value;
			}
			readBackClear(field) {
				const user = this.userLayer();
				if (user === void 0) return true;
				return !Object.prototype.hasOwnProperty.call(user, field);
			}
			/** Write every staged edit, then re-seed from what the Host accepted. */
			async save() {
				const plan = this.plan();
				const writes = plan.flatMap((item) => (item.run === void 0 ? [] : [item.run]));
				if (plan.length === 0 || this.saving || writes.length !== plan.length) return;
				this.saving = true;
				this.failed = false;
				this.publish();
				let landed = true;
				for (const write of writes) landed = (await write()) && landed;
				if (landed) this.staged = new Map();
				this.saving = false;
				this.failed = !landed;
				this.publish();
			}
			discard() {
				if (this.staged.size === 0 && !this.failed) return;
				this.staged = new Map();
				this.failed = false;
				this.publish();
			}
			/** The face the card's slot registration injects. */
			inject() {
				return {
					hooks: { localSearchCard: this.store },
					save: () => this.save(),
					discard: () => this.discard(),
					edit: (field, value) => this.edit(field, value),
					resetField: (field) => this.resetField(field),
				};
			}
			dispose() {
				if (this._unsub) this._unsub();
				this._unsub = void 0;
			}
		}

		function ChevronIcon(className) {
			return react.createElement(
				"svg",
				{ width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", xmlns: "http://www.w3.org/2000/svg", className },
				react.createElement("path", { d: CHEVRON_PATH, fill: "currentColor" }),
			);
		}

		/** One labelled control: head row (label + override badge/reset), control, hint. */
		function WslField(e, p) {
			return e(
				"div",
				{ className: cls.field },
				e("div", { className: cls.head }, [
					e("label", { className: cls.label, htmlFor: p.id }, p.label),
					p.field.overridden
						? e("span", { className: cls.badges }, [
								e("span", { className: cls.badge }, p.overriddenLabel),
								e("button", {
									type: "button",
									className: cls.reset,
									disabled: p.disabled,
									onClick: p.onReset,
								}, p.resetLabel),
						  ])
						: null,
				]),
				p.control,
				e("p", { className: p.field.invalid ? cls.invalid : cls.hint }, p.field.invalid ? p.invalidLabel : p.hint),
			);
		}

		/** One checkbox field: the toggle row plus the override badge/reset. */
		function WslCheckField(e, p) {
			return e(
				"div",
				{ className: cls.field },
				e("div", { className: cls.checkRow }, [
					e("label", { className: cls.checkLabel, htmlFor: p.id }, [
						e("input", {
							id: p.id,
							className: cls.check,
							type: "checkbox",
							checked: p.field.checked,
							disabled: p.disabled,
							onChange: (ev) => p.onChange(ev.target.checked),
						}),
						e("span", null, p.label),
					]),
					p.field.overridden
						? e("span", { className: cls.badges }, [
								e("span", { className: cls.badge }, p.overriddenLabel),
								e("button", {
									type: "button",
									className: cls.reset,
									disabled: p.disabled,
									onClick: p.onReset,
								}, p.resetLabel),
						  ])
						: null,
				]),
			);
		}

		/**
		 * One plugin's card: a header naming the plugin and what its settings govern,
		 * disclosing the controls in place, with the save that writes them. Mirrors the
		 * platform PluginCard: card-local disclosure state, an "Unsaved" mark on the
		 * header while drafts are staged, and a collapse after a save that lands.
		 */
		function LocalSearchCard(props) {
			const snap = props.useLocalSearchCard((s) => s);
			const [open, setOpen] = react.useState(false);
			const saveStarted = react.useRef(false);
			react.useEffect(() => {
				if (snap && snap.saving) {
					saveStarted.current = true;
					return;
				}
				if (!saveStarted.current) return;
				saveStarted.current = false;
				if (snap && !snap.dirty && !snap.failed) setOpen(false);
			});
			if (!snap || !snap.available) return null;
			const t = typeof props.t === "function" ? props.t : (k) => (en[k] !== void 0 ? en[k] : k);
			const e = react.createElement;
			const disabled = !snap.writable;
			const title = t("title");
			const blocked = !snap.dirty || snap.invalid || snap.saving;
			return e(
				"li",
				{ className: join(cls.card, open && cls.cardOpen) },
				[
					e(
						"button",
						{
							type: "button",
							className: cls.header,
							"aria-expanded": open,
							"aria-label": (open ? t("collapse") : t("expand")) + ": " + title,
							onClick: () => setOpen(!open),
						},
						[
							e("span", { className: cls.headText }, [
								e("span", { className: cls.name }, title),
								e("span", { className: cls.description }, t("description")),
							]),
							snap.dirty ? e("span", { className: cls.pending }, t("unsaved")) : null,
							ChevronIcon(join(cls.chevron, open && cls.chevronOpen)),
						],
					),
					open
						? e("div", { className: cls.body }, [
								!snap.writable
									? e("p", { className: cls.readOnly, role: "status" }, t("readOnly"))
									: null,
								WslField(e, {
									id: "wsl-engine",
									label: t("engine"),
									hint: t("engineHint"),
									invalidLabel: t("invalidNumber"),
									overriddenLabel: t("overridden"),
									resetLabel: t("reset"),
									disabled,
									field: snap.engine,
									control: e(
										"select",
										{
											id: "wsl-engine",
											className: join(cls.input, cls.select),
											value: snap.engine.text,
											disabled,
											onChange: (ev) => props.edit("engine", ev.target.value),
										},
										ENGINE_OPTIONS.map((o) => e("option", { key: o, value: o }, o)),
									),
									onReset: () => props.resetField("engine"),
								}),
								WslField(e, {
									id: "wsl-corpus",
									label: t("corpus"),
									hint: t("corpusHint"),
									invalidLabel: t("invalidNumber"),
									overriddenLabel: t("overridden"),
									resetLabel: t("reset"),
									disabled,
									field: snap.corpusDirs,
									control: e("textarea", {
										id: "wsl-corpus",
										className: join(cls.input, cls.inputArea),
										value: snap.corpusDirs.text,
										disabled,
										onChange: (ev) => props.edit("corpusDirs", ev.target.value),
									}),
									onReset: () => props.resetField("corpusDirs"),
								}),
								WslField(e, {
									id: "wsl-max",
									label: t("maxResults"),
									hint: t("maxResultsHint"),
									invalidLabel: t("invalidNumber"),
									overriddenLabel: t("overridden"),
									resetLabel: t("reset"),
									disabled,
									field: snap.maxResults,
									control: e("input", {
										id: "wsl-max",
										className: join(cls.input, snap.maxResults.invalid && cls.inputInvalid),
										type: "text",
										inputMode: "numeric",
										...(snap.maxResults.invalid ? { "aria-invalid": true } : {}),
										value: snap.maxResults.text,
										disabled,
										onChange: (ev) => props.edit("maxResults", ev.target.value),
									}),
									onReset: () => props.resetField("maxResults"),
								}),
								WslField(e, {
									id: "wsl-snip",
									label: t("snippet"),
									hint: t("snippetHint"),
									invalidLabel: t("invalidNumber"),
									overriddenLabel: t("overridden"),
									resetLabel: t("reset"),
									disabled,
									field: snap.snippetLength,
									control: e("input", {
										id: "wsl-snip",
										className: join(cls.input, snap.snippetLength.invalid && cls.inputInvalid),
										type: "text",
										inputMode: "numeric",
										...(snap.snippetLength.invalid ? { "aria-invalid": true } : {}),
										value: snap.snippetLength.text,
										disabled,
										onChange: (ev) => props.edit("snippetLength", ev.target.value),
									}),
									onReset: () => props.resetField("snippetLength"),
								}),
								WslField(e, {
									id: "wsl-idx",
									label: t("indexDir"),
									hint: t("indexDirHint"),
									invalidLabel: t("invalidNumber"),
									overriddenLabel: t("overridden"),
									resetLabel: t("reset"),
									disabled,
									field: snap.indexDir,
									control: e("input", {
										id: "wsl-idx",
										className: join(cls.input, snap.indexDir.invalid && cls.inputInvalid),
										type: "text",
										placeholder: "~/.dsh/web-search-local",
										value: snap.indexDir.text,
										disabled,
										onChange: (ev) => props.edit("indexDir", ev.target.value),
									}),
									onReset: () => props.resetField("indexDir"),
								}),
								WslCheckField(e, {
									id: "wsl-auto",
									label: t("autoReindex"),
									overriddenLabel: t("overridden"),
									resetLabel: t("reset"),
									disabled,
									field: snap.autoReindex,
									onChange: (checked) => props.edit("autoReindex", checked),
									onReset: () => props.resetField("autoReindex"),
								}),
								e("div", { className: cls.footer }, [
									snap.failed
										? e("p", { className: cls.failed, role: "status" }, t("saveFailed"))
										: null,
									e(
										"button",
										{
											type: "button",
											className: cls.discard,
											disabled: !snap.dirty || snap.saving,
											onClick: props.discard,
										},
										t("discard"),
									),
									e(
										"button",
										{
											type: "button",
											className: cls.save,
											disabled: blocked,
											onClick: props.save,
										},
										snap.saving ? t("saving") : t("save"),
									),
								]),
						  ])
						: null,
				],
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
