// dsh-skills-manager — Client half (hand-written web plugin bundle).
//
// The module table format mirrors a tsdown client bundle: a factory registered
// via window.__ModuleLoader__.load; the factory returns the plugin exports
// surface (apply). The only module dependency is react, a platform seed word.
// It registers a "Skills 管理" tab in the Web Plugins settings section and
// calls the host half's same-origin JSON API under /skills-manager/*.
window.__ModuleLoader__.load({
	id: "dsh-skills-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");

		function el(type, props, ...children) {
			return React.createElement(type, props, ...children);
		}

		function errText(e) {
			if (e == null) return "unknown error";
			if (typeof e === "object" && e.message != null) return String(e.message);
			return String(e);
		}

		// Same-origin JSON API to this package's host half.
		async function api(path, body) {
			const res = await fetch("/skills-manager" + path, body === undefined
				? { method: "GET" }
				: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
			const text = await res.text();
			let data = null;
			try { data = text ? JSON.parse(text) : null; } catch { data = null; }
			if (!res.ok) {
				throw new Error((data && data.error) || "HTTP " + res.status);
			}
			return data;
		}

		// ---- inline style constants (theme CSS variables where sensible) ------

		const S = {
			root: { display: "flex", flexDirection: "column", gap: 14 },
			head: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
			title: { fontSize: 14, fontWeight: 600, marginRight: "auto" },
			meta: { fontSize: 12, color: "var(--color-text-secondary, #888)", wordBreak: "break-all" },
			card: { border: "1px solid var(--color-border, #e5e5e5)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 },
			cardTitle: { fontSize: 13, fontWeight: 600 },
			row: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" },
			label: { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--color-text-secondary, #888)", minWidth: 160, flex: "1 1 160px" },
			input: { padding: "6px 8px", border: "1px solid var(--color-border, #ccc)", borderRadius: 6, fontSize: 13, background: "var(--color-bg, transparent)", color: "var(--color-text, inherit)" },
			select: { padding: "6px 8px", border: "1px solid var(--color-border, #ccc)", borderRadius: 6, fontSize: 13, background: "var(--color-bg, transparent)", color: "var(--color-text, inherit)", maxWidth: 360 },
			btn: { padding: "5px 10px", border: "1px solid var(--color-border, #ccc)", borderRadius: 6, background: "transparent", fontSize: 12, cursor: "pointer", color: "var(--color-text, inherit)" },
			btnPrimary: { padding: "5px 10px", border: "1px solid #2563eb", borderRadius: 6, background: "#2563eb", fontSize: 12, cursor: "pointer", color: "#fff" },
			btnDanger: { padding: "5px 10px", border: "1px solid #dc2626", borderRadius: 6, background: "transparent", fontSize: 12, cursor: "pointer", color: "#dc2626" },
			item: { border: "1px solid var(--color-border, #e5e5e5)", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 6 },
			itemHead: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
			idText: { fontWeight: 600, fontSize: 13 },
			itemActions: { marginLeft: "auto", display: "flex", gap: 6 },
			badge: { fontSize: 11, padding: "2px 6px", borderRadius: 10, border: "1px solid #ccc" },
			badgeSrc: { color: "#7c3aed", borderColor: "#7c3aed" },
			badgeRuntime: { color: "#0d9488", borderColor: "#0d9488" },
			badgeOff: { color: "#9ca3af", borderColor: "#9ca3af" },
			badgeBroken: { color: "#dc2626", borderColor: "#dc2626" },
			path: { fontSize: 11, color: "var(--color-text-secondary, #888)", wordBreak: "break-all", fontFamily: "monospace" },
			textArea: { width: "100%", minHeight: 220, fontFamily: "monospace", fontSize: 12, padding: 8, border: "1px solid var(--color-border, #ccc)", borderRadius: 6, boxSizing: "border-box", background: "var(--color-bg-subtle, rgba(0,0,0,.03))", color: "var(--color-text, inherit)" },
			error: { color: "#dc2626", fontSize: 12 },
			warn: { color: "#b45309", fontSize: 12 },
			note: { fontSize: 12, color: "var(--color-text-secondary, #888)" },
			notice: { fontSize: 12, padding: "8px 10px", borderRadius: 6, border: "1px solid #d97706", color: "#b45309", background: "rgba(217,119,6,.08)" },
			noticeOk: { fontSize: 12, padding: "8px 10px", borderRadius: 6, border: "1px solid #16a34a", color: "#15803d", background: "rgba(22,163,74,.08)" },
			sectionBar: { display: "flex", gap: 6, flexWrap: "wrap" },
			sectionBtn: { padding: "6px 12px", border: "1px solid var(--color-border, #ccc)", borderRadius: 6, background: "transparent", fontSize: 13, cursor: "pointer", color: "var(--color-text, inherit)" },
			sectionBtnActive: { padding: "6px 12px", border: "1px solid #2563eb", borderRadius: 6, background: "#2563eb", fontSize: 13, cursor: "pointer", color: "#fff" },
			exclusive: { color: "#7c3aed", fontWeight: 600, fontSize: 11, padding: "1px 6px", borderRadius: 8, border: "1px solid #7c3aed" },
			disabledBtn: { opacity: 0.45, cursor: "not-allowed" },
		};

		const SOURCE_LABEL = {
			"user-dsh": "DSH 用户根（global）",
			"user-agents": "Agents 共享根（global）",
			"bundled": "随附内置（global）",
			"custom": "preset 层",
			"runtime": "运行时注册",
			"project-dsh": "项目 .dsh/skills",
			"project-agents": "项目 .agents/skills",
		};

		function sourceLabel(src) {
			return SOURCE_LABEL[src] || String(src || "未知来源");
		}

		function skillTemplate(name) {
			return "---\n" +
				"name: " + name + "\n" +
				"description: 一句话描述这个技能做什么\n" +
				"whenToUse: 什么时候该用这个技能（可选）\n" +
				"---\n\n" +
				"# " + name + "\n\n" +
				"写具体指令……\n";
		}

		function ManagerView() {
			const [meta, setMeta] = React.useState(null);
			const [levels, setLevels] = React.useState(null);
			const [error, setError] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [section, setSection] = React.useState("global");
			const [presetId, setPresetId] = React.useState("");
			const [agentId, setAgentId] = React.useState("");
			const [registry, setRegistry] = React.useState(null);
			const [regBusy, setRegBusy] = React.useState(false);
			// editor state: null closed; otherwise { root, rootKey, presetId, name, editing, writable }
			const [editor, setEditor] = React.useState(null);
			const [edName, setEdName] = React.useState("");
			const [edText, setEdText] = React.useState("");
			const [edMsg, setEdMsg] = React.useState(null);
			const [edValidation, setEdValidation] = React.useState(null);
			const [saving, setSaving] = React.useState(false);
			const [confirmDel, setConfirmDel] = React.useState(null);
			const [viewing, setViewing] = React.useState(null); // { name, text, path }
			// import state: importer = { root, rootKey, presetId, label } | null
			const [importer, setImporter] = React.useState(null);
			const [impMode, setImpMode] = React.useState("zip");
			const [impOverwrite, setImpOverwrite] = React.useState(false);
			const [impZipData, setImpZipData] = React.useState(null); // { name, size, base64 }
			const [impFolder, setImpFolder] = React.useState(null); // { name, entries, notes }
			const [impBusy, setImpBusy] = React.useState(false);
			const [impMsg, setImpMsg] = React.useState(null);
			const [impResult, setImpResult] = React.useState(null);

			async function refresh() {
				setBusy(true);
				setError(null);
				try {
					const [m, lv] = await Promise.all([api("/meta"), api("/levels")]);
					setMeta(m.meta);
					setLevels(lv);
					if (!lv.ok && lv.error) setError(lv.error);
				} catch (e) {
					setError(errText(e));
				} finally {
					setBusy(false);
				}
			}

			React.useEffect(() => { refresh(); }, []);

			// Pre-select the default preset and the first live agent after load.
			React.useEffect(() => {
				if (!levels) return;
				if (presetId === "" && levels.presets && levels.presets.length > 0) {
					const hit = (levels.meta && levels.meta.defaultId)
						? levels.presets.find((p) => p.id === levels.meta.defaultId)
						: null;
					setPresetId((hit || levels.presets[0]).id);
				}
				if (agentId === "" && levels.agents && levels.agents.length > 0) {
					setAgentId(levels.agents[0].id);
				}
			}, [levels]);

			function selectedPreset() {
				if (!levels || !levels.presets) return null;
				return levels.presets.find((p) => p.id === presetId) || levels.presets[0] || null;
			}

			async function loadRegistry(scope) {
				setRegBusy(true);
				setRegistry(null);
				try {
					const r = await api("/registry?scope=" + encodeURIComponent(scope));
					setRegistry({ owner: scope, ...r });
				} catch (e) {
					setError(errText(e));
				} finally {
					setRegBusy(false);
				}
			}

			// ---- editor --------------------------------------------------------

			function openAdd(target) {
				setEditor(target);
				setEdName("");
				setEdText(skillTemplate(""));
				setEdMsg(null);
				setEdValidation(null);
			}

			async function openEdit(target) {
				setEditor(target);
				setEdName(target.name);
				setEdMsg(null);
				setEdValidation(null);
				try {
					const r = await api("/skill?root=" + encodeURIComponent(target.root) +
						(target.rootKey ? "&rootKey=" + encodeURIComponent(target.rootKey) : "") +
						(target.presetId ? "&presetId=" + encodeURIComponent(target.presetId) : "") +
						"&name=" + encodeURIComponent(target.name));
					if (!r.ok) { setEdText(""); setEdMsg(r.error || "读取失败"); return; }
					setEdText(r.text);
					setEdValidation(r.validation);
					setEdMsg(target.writable ? null : "该技能只读（随附 preset），可查看不可保存");
				} catch (e) {
					setEdMsg(errText(e));
					setEdText("");
				}
			}

			async function openView(target) {
				try {
					const r = await api("/skill?root=" + encodeURIComponent(target.root) +
						(target.rootKey ? "&rootKey=" + encodeURIComponent(target.rootKey) : "") +
						(target.presetId ? "&presetId=" + encodeURIComponent(target.presetId) : "") +
						"&name=" + encodeURIComponent(target.name));
					setViewing(r.ok ? { name: r.name, path: r.path, text: r.text, validation: r.validation } : { name: target.name, path: "", text: r.error || "读取失败", validation: null });
				} catch (e) {
					setViewing({ name: target.name, path: "", text: errText(e), validation: null });
				}
			}

			async function doValidate() {
				setEdValidation(null);
				try {
					setEdValidation(await api("/validate", { name: edName, text: edText }));
				} catch (e) {
					setEdMsg(errText(e));
				}
			}

			async function doSave() {
				setEdMsg(null);
				const name = String(edName || "").trim();
				if (!name) { setEdMsg("请填写技能名（kebab-case）"); return; }
				setSaving(true);
				try {
					const r = await api("/skill", {
						root: editor.root,
						rootKey: editor.rootKey || null,
						presetId: editor.presetId || null,
						name,
						text: edText,
					});
					if (!r.ok) {
						setEdMsg(r.error || "保存失败");
						if (r.validation) setEdValidation(r.validation);
						return;
					}
					setEdValidation(r.validation);
					setEditor(null);
					setEdName("");
					setEdText("");
					await refresh();
				} catch (e) {
					setEdMsg(errText(e));
				} finally {
					setSaving(false);
				}
			}

			async function doDelete(target) {
				const key = target.root + ":" + (target.rootKey || target.presetId || "") + ":" + target.name;
				if (confirmDel !== key) { setConfirmDel(key); return; }
				setConfirmDel(null);
				try {
					const r = await api("/skill/delete", {
						root: target.root,
						rootKey: target.rootKey || null,
						presetId: target.presetId || null,
						name: target.name,
					});
					if (!r.ok) { setError(r.error || "删除失败"); return; }
					if (editor && editor.name === target.name && editor.root === target.root) setEditor(null);
					await refresh();
				} catch (e) {
					setError(errText(e));
				}
			}

			function editorCard() {
				if (editor === null) return null;
				return el("div", { style: S.card },
					el("div", { style: S.cardTitle }, editor.editing ? "编辑技能：" + editor.name : "新增技能（" + (editor.root === "global" ? "global · " + editor.rootKey : "preset · " + editor.presetId) + "）"),
					el("div", { style: S.row },
						el("label", { style: S.label }, "技能名（官方 kebab-case，如 my-skill）",
							el("input", { style: S.input, value: edName, disabled: editor.editing || !editor.writable, placeholder: "my-skill", onChange: (e) => setEdName(e.target.value) }),
						),
					),
					el("textarea", { style: S.textArea, value: edText, readOnly: !editor.writable, onChange: (e) => setEdText(e.target.value) }),
					edValidation && edValidation.errors && edValidation.errors.length > 0
						? el("div", { style: S.error }, edValidation.errors.map((x) => el("div", { key: x }, "✗ " + x)))
						: null,
					edValidation && edValidation.warnings && edValidation.warnings.length > 0
						? el("div", { style: S.warn }, edValidation.warnings.map((x) => el("div", { key: x }, "⚠ " + x)))
						: null,
					edMsg ? el("div", { style: S.error }, edMsg) : null,
					el("div", { style: S.row },
						editor.writable ? el("button", { style: { ...S.btnPrimary, ...(saving ? S.disabledBtn : {}) }, onClick: doSave, disabled: saving }, saving ? "保存中…" : "保存") : null,
						el("button", { style: S.btn, onClick: doValidate }, "校验"),
						el("button", { style: S.btn, onClick: () => { setEditor(null); setEdMsg(null); } }, "关闭"),
					),
				);
			}

			function viewerCard() {
				if (viewing === null) return null;
				return el("div", { style: S.card },
					el("div", { style: S.head },
						el("span", { style: S.cardTitle }, "查看：" + viewing.name),
						el("button", { style: S.btn, onClick: () => setViewing(null) }, "关闭"),
					),
					viewing.path ? el("div", { style: S.path }, viewing.path) : null,
					viewing.validation && viewing.validation.errors && viewing.validation.errors.length > 0
						? el("div", { style: S.error }, viewing.validation.errors.map((x) => el("div", { key: x }, "✗ " + x)))
						: null,
					el("textarea", { style: S.textArea, readOnly: true, value: viewing.text }),
				);
			}

			// ---- import (zip / folder) -------------------------------------------------

			function openImport(target) {
				setImporter(target);
				setImpMode("zip");
				setImpOverwrite(false);
				setImpZipData(null);
				setImpFolder(null);
				setImpMsg(null);
				setImpResult(null);
			}

			function fileToBase64(file) {
				return new Promise((resolve, reject) => {
					const fr = new FileReader();
					fr.onload = () => resolve(String(fr.result || "").split(",")[1] || "");
					fr.onerror = () => reject(new Error("读取文件失败"));
					fr.readAsDataURL(file);
				});
			}

			async function onZipPicked(e) {
				const file = e.target.files && e.target.files[0];
				setImpZipData(null);
				setImpMsg(null);
				setImpResult(null);
				if (!file) return;
				if (file.size > 48 * 1024 * 1024) { setImpMsg("zip 文件过大（上限 48 MB）"); return; }
				try {
					setImpZipData({ name: file.name, size: file.size, base64: await fileToBase64(file) });
				} catch (err) {
					setImpMsg(errText(err));
				}
			}

			async function onFolderPicked(e) {
				setImpFolder(null);
				setImpMsg(null);
				setImpResult(null);
				const files = e.target.files ? Array.from(e.target.files) : [];
				if (files.length === 0) return;
				if (files.length > 2048) { setImpMsg("文件夹内文件数超过上限 2048"); return; }
				const entries = [];
				const notes = [];
				for (const f of files) {
					const rel = String(f.webkitRelativePath || f.name).split("/").slice(1).join("/");
					if (!rel) continue;
					if (f.size > 8 * 1024 * 1024) { notes.push("跳过超大文件（> 8 MB）: " + rel); continue; }
					entries.push({ path: rel, text: await f.text() });
				}
				const folderName = (files[0].webkitRelativePath || files[0].name).split("/")[0] || "";
				setImpFolder({ name: folderName, entries, notes });
			}

			async function doImport() {
				setImpMsg(null);
				setImpResult(null);
				if (impMode === "zip" && !impZipData) { setImpMsg("请先选择一个 zip 压缩包"); return; }
				if (impMode === "folder" && !impFolder) { setImpMsg("请先选择一个文件夹"); return; }
				setImpBusy(true);
				try {
					const payload = {
						root: importer.root,
						rootKey: importer.rootKey || null,
						presetId: importer.presetId || null,
						overwrite: impOverwrite,
						mode: impMode,
					};
					if (impMode === "zip") payload.zipBase64 = impZipData.base64;
					else payload.entries = impFolder.entries;
					const r = await api("/skill/import", payload);
					if (!r.ok) { setImpMsg(r.error || "导入失败"); return; }
					setImpResult(r);
					setImpZipData(null);
					setImpFolder(null);
					await refresh();
				} catch (e) {
					setImpMsg(errText(e));
				} finally {
					setImpBusy(false);
				}
			}

			function importerCard() {
				if (importer === null) return null;
				return el("div", { style: S.card },
					el("div", { style: S.head },
						el("span", { style: S.cardTitle }, "批量导入技能 → " + importer.label),
						el("button", { style: S.btn, onClick: () => setImporter(null) }, "关闭"),
					),
					el("div", { style: S.note }, "支持 zip 压缩包或整个文件夹。识别规则：任意深度的 <name>/SKILL.md（bundle）与根级 <name>.md（flat，单一外层目录自动下探）；技能身份以 frontmatter name 为准；导入前全部按官方格式校验。"),
					el("div", { style: S.row },
						el("button", { style: impMode === "zip" ? S.btnPrimary : S.btn, onClick: () => { setImpMode("zip"); setImpMsg(null); } }, "zip 压缩包"),
						el("button", { style: impMode === "folder" ? S.btnPrimary : S.btn, onClick: () => { setImpMode("folder"); setImpMsg(null); } }, "文件夹"),
						el("label", { style: { ...S.checkRow, paddingTop: 6 } },
							el("input", { type: "checkbox", checked: impOverwrite, onChange: (e) => setImpOverwrite(e.target.checked) }),
							"覆盖已存在的同名技能（自动留 .bak 备份）",
						),
					),
					impMode === "zip"
						? el("div", { style: S.row },
								el("label", { style: S.label }, "选择 .zip 文件",
									el("input", { type: "file", accept: ".zip,application/zip", onChange: onZipPicked }),
								),
								impZipData ? el("span", { style: S.meta }, impZipData.name + " · " + (impZipData.size / 1024 / 1024).toFixed(2) + " MB") : null,
							)
						: el("div", { style: S.row },
								el("label", { style: S.label }, "选择整个文件夹",
									el("input", { type: "file", webkitdirectory: "true", directory: "true", multiple: true, onChange: onFolderPicked }),
								),
								impFolder ? el("span", { style: S.meta }, impFolder.name + " · " + impFolder.entries.length + " 个文件") : null,
							),
					impFolder && impFolder.notes.length > 0
						? el("div", { style: S.warn }, impFolder.notes.map((n) => el("div", { key: n }, "⚠ " + n)))
						: null,
					impMsg ? el("div", { style: S.error }, impMsg) : null,
					impResult
						? el("div", { style: S.root },
								el("div", { style: S.noticeOk }, "导入完成：成功 " + impResult.imported.length + "，跳过 " + impResult.skipped.length + "。"),
								impResult.imported.length > 0
									? el("div", { style: S.root }, impResult.imported.map((s) => el("div", { key: s.name, style: S.note }, "✓ 导入 " + s.name)))
									: null,
								impResult.skipped.length > 0
									? el("div", { style: S.root }, impResult.skipped.map((s) => el("div", { key: s.name + s.reason, style: S.warn }, "✗ 跳过 " + s.name + "：" + s.reason)))
									: null,
								impResult.notes && impResult.notes.length > 0
									? el("div", { style: S.root }, impResult.notes.map((n) => el("div", { key: n, style: S.note }, "· " + n)))
									: null,
							)
						: null,
					el("div", { style: S.row },
						el("button", { style: { ...S.btnPrimary, ...(impBusy ? S.disabledBtn : {}) }, onClick: doImport, disabled: impBusy }, impBusy ? "导入中…" : "开始导入"),
					),
				);
			}

			// ---- skill list rows ---------------------------------------------------

			function skillRow(target, skill, canEdit) {
				const delKey = target.root + ":" + (target.rootKey || target.presetId || "") + ":" + skill.name;
				return el("div", { key: skill.name, style: S.item },
					el("div", { style: S.itemHead },
						el("span", { style: S.idText }, skill.name),
						skill.kind === "flat" ? el("span", { style: S.badge }, "flat .md") : el("span", { style: { ...S.badge, ...S.badgeSrc } }, "SKILL.md"),
						skill.frontmatterPresent === false ? el("span", { style: { ...S.badge, ...S.badgeBroken } }, "无 frontmatter") : null,
						skill.disableModelInvocation ? el("span", { style: { ...S.badge, ...S.badgeOff } }, "禁用模型调用") : null,
						!skill.userInvocable ? el("span", { style: { ...S.badge, ...S.badgeOff } }, "禁用用户调用") : null,
						el("span", { style: S.itemActions },
							el("button", { style: S.btn, onClick: () => openView(target) }, "查看"),
							el("button", { style: S.btn, onClick: () => openEdit(target) }, canEdit ? "编辑" : "只读"),
							canEdit ? el("button", { style: S.btnDanger, onClick: () => doDelete(target) }, confirmDel === delKey ? "确认删除？" : "删除") : null,
						),
					),
					skill.description ? el("div", { style: S.note }, skill.description) : null,
					el("div", { style: S.path }, skill.file),
				);
			}

			// ---- registry rows ------------------------------------------------------

			function registryRows(view, exclusive) {
				if (!view) return null;
				if (!view.available) return el("div", { style: S.notice }, view.error || "skill 注册表服务不可用（host 组合没有挂载 @deepseek-ai/dsh-skill）");
				if (view.skills.length === 0) return el("div", { style: S.note }, "该层当前没有可见技能。");
				const exSet = new Set(exclusive || []);
				return view.skills.map((s) => el("div", { key: s.name, style: S.item },
					el("div", { style: S.itemHead },
						el("span", { style: S.idText }, s.name),
						el("span", { style: S.badge }, sourceLabel(s.source)),
						el("span", { style: { ...S.badge, ...S.badgeRuntime } }, "provider: " + s.provider),
						s.modelInvocable ? el("span", { style: S.badge }, "模型可调用") : el("span", { style: { ...S.badge, ...S.badgeOff } }, "模型不可调用"),
						s.userInvocable ? null : el("span", { style: { ...S.badge, ...S.badgeOff } }, "用户不可调用"),
						exSet.has(s.name) ? el("span", { style: S.exclusive }, "本层独有") : null,
					),
					s.description ? el("div", { style: S.note }, s.description) : null,
					s.resourceBasePath ? el("div", { style: S.path }, s.resourceBasePath) : null,
				));
			}

			// ---- sections ------------------------------------------------------------

			function globalSection() {
				if (!levels) return null;
				const roots = levels.global.roots || [];
				const reg = levels.global.registry;
				return el("div", { style: S.root },
					el("div", { style: S.card },
						el("div", { style: S.head },
							el("span", { style: S.cardTitle }, "官方层级：global（host 层）"),
							el("button", { style: S.btn, onClick: () => openAdd({ root: "global", rootKey: "user-dsh", name: "", editing: false, writable: true }) }, "新增到 DSH 用户根"),
							el("button", { style: S.btn, onClick: () => openImport({ root: "global", rootKey: "user-dsh", presetId: null, label: "global · user-dsh" }) }, "导入"),
						),
						el("div", { style: S.note }, "官方定义：host 行与仓库插件注册进 global 层；可写文件根是 <dshHome>/skills 与 <agentsHome>/skills（dsh-skill-filesystem 的 user-dsh / user-agents 根）。"),
						el("div", { style: S.path }, meta ? "dshHome: " + meta.dshHome + "  ·  agentsHome: " + meta.agentsHome : ""),
						meta && meta.bundledDir ? el("div", { style: S.path }, "bundled 随附根: " + meta.bundledDir) : null,
					),
					roots.map((root) => el("div", { key: root.key, style: S.card },
						el("div", { style: S.head },
							el("span", { style: S.cardTitle }, (root.key === "user-dsh" ? "DSH 用户根（rank 400）" : "Agents 共享根（rank 500）") + " · " + (root.skills.length) + " 个技能"),
							el("button", { style: S.btn, onClick: () => openAdd({ root: "global", rootKey: root.key, name: "", editing: false, writable: true }) }, "新增"),
							el("button", { style: S.btn, onClick: () => openImport({ root: "global", rootKey: root.key, presetId: null, label: "global · " + root.key }) }, "导入"),
						),
						el("div", { style: S.path }, root.path + (root.exists ? "" : "（不存在，新增时自动创建）")),
						root.skills.length === 0
							? el("div", { style: S.note }, "还没有技能文件。技能以 <name>/SKILL.md 或 <name>.md 的形式放在该目录下。")
							: root.skills.map((s) => skillRow({ root: "global", rootKey: root.key, name: s.name, editing: true, writable: true, presetId: null }, s, true)),
					)),
					el("div", { style: S.card },
						el("div", { style: S.head },
							el("span", { style: S.cardTitle }, "global 层注册视图（host 层实际贡献）"),
							el("span", { style: S.meta }, reg && reg.complete === false ? "发现不完整" : ""),
						),
						registryRows(reg, []),
						el("div", { style: S.note }, "项目层（project-dsh / project-agents，来自工作区 .dsh/skills）只随 cwd 进入各 agent 的合并视图，不在本面板管理。"),
					),
				);
			}

			function presetSection() {
				if (!levels) return null;
				const presets = levels.presets || [];
				const p = selectedPreset();
				const reg = registry && registry.owner === "preset:" + (p ? p.id : "") ? registry : null;
				if (p === null) return el("div", { style: S.note }, "没有可用的 agent preset。");
				const canEdit = p.trust === "user";
				return el("div", { style: S.root },
					el("div", { style: S.card },
						el("div", { style: S.cardTitle }, "官方层级：preset（agent preset 的 standing 层）"),
						el("div", { style: S.note }, "官方定义：preset 的 standing mount 注册进该 preset 层；skills 文件放在 <preset>/skills/，由该 preset 的 dsh-skill-filesystem 行的 customSkillDirs 接入发现。"),
						el("div", { style: S.row },
							el("label", { style: S.label }, "选择 preset",
								el("select", { style: S.select, value: p.id, onChange: (e) => { setPresetId(e.target.value); setRegistry(null); } },
									presets.map((x) => el("option", { key: x.id, value: x.id }, x.id + (x.trust === "system" ? "（随附，只读）" : "") + (x.broken ? "（损坏）" : ""))),
								),
							),
						),
						el("div", { style: S.path }, p.path),
						p.broken ? el("div", { style: S.error }, "该 preset 损坏: " + p.broken) : null,
						el("div", { style: S.meta }, "skills 目录: " + p.skillsDir),
						el("div", { style: S.notice }, "wiring: " + (p.wiring ? p.wiring.note : "") + (p.wiring && p.wiring.dirs && p.wiring.dirs.length ? " — " + p.wiring.dirs.map((d) => "customSkillDirs: " + d).join("；") : "")),
						!canEdit ? el("div", { style: S.notice }, "随附 preset 只读（升级会被覆盖）。如需自定义，请先在「插件管理」里复制为 user preset。") : null,
					),
					el("div", { style: S.card },
						el("div", { style: S.head },
							el("span", { style: S.cardTitle }, "技能文件（" + (p.skills ? p.skills.length : 0) + "）"),
							canEdit ? el("button", { style: S.btn, onClick: () => openAdd({ root: "preset", presetId: p.id, name: "", editing: false, writable: true }) }, "新增") : null,
							canEdit ? el("button", { style: S.btn, onClick: () => openImport({ root: "preset", presetId: p.id, rootKey: null, label: "preset · " + p.id }) }, "导入") : null,
						),
						p.skills && p.skills.length === 0
							? el("div", { style: S.note }, "该 preset 的 skills/ 目录还没有技能文件。" + (p.wiring && !p.wiring.wired ? "注意：wiring 未指向该目录，文件可能不会被发现。" : ""))
							: (p.skills || []).map((s) => skillRow({ root: "preset", presetId: p.id, name: s.name, editing: true, writable: canEdit }, s, canEdit)),
					),
					el("div", { style: S.card },
						el("div", { style: S.head },
							el("span", { style: S.cardTitle }, "preset 层注册视图（合并 global 层）"),
							el("button", { style: S.btn, onClick: () => loadRegistry("preset:" + p.id), disabled: regBusy }, regBusy ? "加载中…" : "加载视图"),
						),
						el("div", { style: S.note }, "「本层独有」= preset 层里盖过 global 的注册（本 preset 的 skill-filesystem customSkillDirs 与运行时注册）。加载会确保该 preset 的 standing mount 已组合。"),
						registryRows(reg, reg ? reg.exclusive : []),
					),
				);
			}

			function agentSection() {
				if (!levels) return null;
				const agents = levels.agents || [];
				const reg = registry && registry.owner === "agent:" + agentId ? registry : null;
				return el("div", { style: S.root },
					el("div", { style: S.card },
						el("div", { style: S.cardTitle }, "官方层级：agent（每个 live agent 自己的 scope 层）"),
						el("div", { style: S.note }, "官方定义：agent loop 为每个 live agent 建一个 scope，动态插件（如本会话的动态 Cordis 插件）通过 ctx.skills.register 注册进该 agent 层。运行时注册是进程内的，本面板只读展示。"),
						agents.length === 0 ? el("div", { style: S.note }, "当前进程没有 live agent。") : el("div", { style: S.row },
							el("label", { style: S.label }, "选择 live agent（会话）",
								el("select", { style: S.select, value: agentId, onChange: (e) => { setAgentId(e.target.value); setRegistry(null); } },
									agents.map((a) => el("option", { key: a.id, value: a.id }, a.id + (a.preset ? "（preset: " + a.preset + "）" : "") + " · " + a.status)),
								),
							),
						),
					),
					el("div", { style: S.card },
						el("div", { style: S.head },
							el("span", { style: S.cardTitle }, "agent 合并视图（global + preset + agent 层）"),
							el("button", { style: S.btn, onClick: () => loadRegistry("agent:" + agentId), disabled: regBusy || !agentId }, regBusy ? "加载中…" : "加载视图"),
						),
						el("div", { style: S.note }, "「本层独有」= agent 层盖过 preset 层的注册，通常是该会话动态插件提供的运行时技能。"),
						reg ? el("div", { style: S.path }, "preset: " + (reg.preset || "无") + "  ·  cwd: " + (reg.cwd || "无")) : null,
						registryRows(reg, reg ? reg.exclusive : []),
					),
				);
			}

			return el("div", { style: S.root },
				el("div", { style: S.head },
					el("span", { style: S.title }, "Skills 管理"),
					el("button", { style: S.btn, onClick: refresh, disabled: busy }, busy ? "刷新中…" : "刷新"),
				),
				el("div", { style: S.note }, "按官方层级管理 agent skills：global（host 层）→ preset（standing 层）→ agent（live agent 层）。文件格式遵循官方 skill-filesystem：<name>/SKILL.md 或 <name>.md。"),
				error ? el("div", { style: S.error }, error) : null,
				el("div", { style: S.sectionBar },
					el("button", { style: section === "global" ? S.sectionBtnActive : S.sectionBtn, onClick: () => setSection("global") }, "global 全局"),
					el("button", { style: section === "preset" ? S.sectionBtnActive : S.sectionBtn, onClick: () => setSection("preset") }, "preset 预设"),
					el("button", { style: section === "agent" ? S.sectionBtnActive : S.sectionBtn, onClick: () => setSection("agent") }, "agent 会话"),
				),
				editorCard(),
				viewerCard(),
				importerCard(),
				section === "global" ? globalSection() : null,
				section === "preset" ? presetSection() : null,
				section === "agent" ? agentSection() : null,
			);
		}

		function apply(ctx) {
			const slots = ctx.get("slots");
			if (slots === undefined) return;
			slots.inject("settings.plugins.tab", () => slots.register(
				{ name: "settings.plugins.tab", id: "skills", order: 120, label: "Skills 管理" },
				() => el(ManagerView),
			));
		}

		exports.apply = apply;
		return module.exports;
	}
});
