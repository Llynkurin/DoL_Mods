// ==UserScript==
// @name          DoLlynk+ModLoader
// @namespace     https://github.com/Llynkurin
// @version       2.6.9
// @description   A universal zip handler and compatibility layer for DoLlynk Injector with Modloader.
// @author        Llynkurin with inspiration from the community
// @match         file:///*Degrees%20of%20Lewity*.html*
// @match         file:///*Degrees*of*Lewdity*.html*
// @match         file:///*DoL*.html*
// @match         https://*.dolmods.net/*
// @icon          https://www.google.com/s2/favicons?sz=64&domain=vrelnir.blogspot.com
// @grant         none
// @require       https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @require       https://cdn.jsdelivr.net/npm/json5@2.2.3/dist/index.min.js
// @run-at        document-start
// ==/UserScript==

(function() {
    'use strict';

    const U_WINDOW = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const LOG_TAG = '[🪡Suite]';

    /* ANCHOR: JSZip Patch */
    if (U_WINDOW.JSZip && !U_WINDOW.JSZip._suite_patched) {
        U_WINDOW.JSZip._suite_patched = true;
        const ensureOpts = (args) => { if (args.length === 1) args.push({}); if (!args[1]) args[1] = {}; return args; };
        const patch = (proto, method) => {
            if (!proto[method]) return;
            const orig = proto[method];
            proto[method] = function(...args) { return orig.apply(this, ensureOpts(args)); };
        };
        patch(U_WINDOW.JSZip.prototype, 'loadAsync');
        patch(U_WINDOW.JSZip, 'loadAsync');
    }

    /* ANCHOR: Suite Logic */
    const Suite = {
        Utils: {
            download(blob, filename) {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                Object.assign(a, { href: url, download: filename });
                document.body.appendChild(a);
                a.click();
                setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
            },
            getTypeAndName(filename) {
                return U_WINDOW.DoLlynk.ModActions._getTypeAndName(filename);
            },
            getModFileName(mod) {
                return U_WINDOW.DoLlynk.ModActions._getFileNameFromMod(mod);
            }
        },

        /* ANCHOR: ModLoader Compatibility */
        ModLoader: {
            async parseBoot(bootContent, groupName, zip) {
                const boot = JSON5.parse(bootContent);
                const modName = boot.name || groupName;
                const mods = [];

                // 1. Process Files
                const mappings = [
                    { type: 'css', lists: ['styleFileList'], early: true },
                    { type: 'js', lists: ['scriptFileList_inject_early', 'scriptFileList_earlyload'], early: true },
                    { type: 'js', lists: ['scriptFileList_preload', 'scriptFileList'], early: false },
                    { type: 'twee', lists: ['tweeFileList'], early: true },
                ];

                for (const { type, lists, early } of mappings) {
                    for (const list of lists) {
                        if (!Array.isArray(boot[list])) continue;
                        for (const path of boot[list]) {
                            const file = zip.file(new RegExp(`^${path.replace(/\\/g, '/')}$`, 'i'))[0];
                            if (!file) continue;
                            const code = await file.async('text');
                            const { name } = Suite.Utils.getTypeAndName(file.name.split('/').pop());
                            mods.push({ name, groupName: modName, type, code, earlyLoad: early, enabled: true });
                        }
                    }
                }

                // 2. Process Patches
                const patches = { passage: [], script: [] };
                if (Array.isArray(boot.addonPlugin)) {
                    boot.addonPlugin.forEach(addon => {
                        if (addon.addonName === 'TweeReplacerAddon' && Array.isArray(addon.params)) {
                            patches.passage.push(...addon.params.map(p => ({
                                role: 'passage', name: p.passage,
                                method: p.isRegex || p.findRegex ? 'regex' : 'string',
                                find: p.findRegex || p.findString, replace: p.replace
                            })));
                        }
                        if (addon.addonName === 'ReplacePatcherAddon' && addon.params) {
                            if (addon.params.twee) patches.passage.push(...addon.params.twee.map(p => ({
                                role: 'passage', name: p.passageName, method: 'string', find: p.from, replace: p.to
                            })));
                            if (addon.params.js) patches.script.push(...addon.params.js.map(p => ({
                                role: 'script', method: 'string', find: p.from, replace: p.to
                            })));
                        }
                    });
                }

                if (patches.passage.length || patches.script.length) {
                    mods.push({
                        name: `${modName}-patches`, groupName: modName, type: 'unified-patch',
                        code: JSON.stringify([...patches.passage, ...patches.script], null, 2),
                        earlyLoad: true, enabled: true
                    });
                }
                return mods;
            },

            generateBoot(mods, groupName) {
                const boot = {
                    name: groupName, version: "1.0.0",
                    styleFileList: [], scriptFileList: [], scriptFileList_earlyload: [], tweeFileList: [],
                    addonPlugin: [{ addonName: "TweeReplacerAddon", params: [] }, { addonName: "ReplacePatcherAddon", params: { js: [], twee: [] } }]
                };

                mods.forEach(mod => {
                    const relativePath = (mod.groupName.length > groupName.length ? mod.groupName.substring(groupName.length + 1) + '/' : '') + Suite.Utils.getModFileName(mod);

                    if (mod.type === 'css') boot.styleFileList.push(relativePath);
                    else if (mod.type === 'js') (mod.earlyLoad ? boot.scriptFileList_earlyload : boot.scriptFileList).push(relativePath);
                    else if (mod.type === 'twee') boot.tweeFileList.push(relativePath);
                    else if (mod.type === 'unified-patch') {
                        try {
                            const pData = JSON5.parse(mod.code);
                            pData.forEach(p => {
                                if (p.role === 'passage') {
                                    const param = { passage: p.name, replace: p.replace, isRegex: p.method === 'regex' };
                                    if (p.method === 'regex') param.findRegex = p.find; else param.findString = p.find;
                                    boot.addonPlugin[0].params.push(param);
                                } else if (p.role === 'script') {
                                    boot.addonPlugin[1].params.js.push({ fileName: "game-script", from: p.find, to: p.replace });
                                }
                            });
                        } catch (e) {}
                    }
                });

                boot.addonPlugin = boot.addonPlugin.filter(p => p.params.length > 0 || p.params.js?.length > 0);
                if (!boot.addonPlugin.length) delete boot.addonPlugin;
                return JSON.stringify(boot, null, 2);
            }
        },

        /* ANCHOR: Backup System */
        Backup: {
            async exportAll(mods) {
                const zip = new JSZip();
                const manifest = [];
                mods.forEach(mod => {
                    const fileName = Suite.Utils.getModFileName(mod);
                    const fullPath = mod.groupName ? `${mod.groupName}/${fileName}` : fileName;
                    zip.file(fullPath, mod.code);
                    manifest.push({
                        id: mod.id, name: mod.name, groupName: mod.groupName, type: mod.type,
                        earlyLoad: mod.earlyLoad, enabled: mod.enabled, order: mod.order, path: fullPath
                    });
                });
                zip.file('dollynk_manifest.json5', JSON5.stringify(manifest, null, 2));
                const blob = await zip.generateAsync({ type: 'blob' });
                Suite.Utils.download(blob, `dollynk_full_${new Date().toISOString().slice(0, 10)}.zip`);
            },
            async importAll(file, UI, Storage, state) {
                const zip = await JSZip.loadAsync(file);
                const manFile = zip.file('dollynk_manifest.json5');
                if (!manFile) throw new Error("Invalid Backup: No manifest found.");

                const manifest = JSON5.parse(await manFile.async('text'));
                const newMods = [];
                for (const meta of manifest) {
                    const entry = zip.file(meta.path);
                    if (entry) newMods.push({ ...meta, code: await entry.async('text') });
                }

                if (newMods.length) {
                    state.mods = newMods.sort((a, b) => a.order - b.order);
                    state.needsReload = true;
                    await Storage.saveMods();
                    UI.updateModList();
                    alert(`Restored ${newMods.length} mods. Reload required.`);
                }
            }
        },

        /* ANCHOR: Asset Handling */
        Assets: {
            async importFromZip(zip, groupId, AssetsDB) {
                const images = Object.values(zip.files).filter(f => !f.dir && /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(f.name));
                // Load blobs in parallel to speed up I/O
                const blobs = await Promise.all(images.map(f => f.async('blob').then(b => ({ name: f.name, blob: b }))));

                for (const { name, blob } of blobs) {
                    await AssetsDB.put(U_WINDOW.DoLlynk.Assets._normalizePath(name), blob, groupId);
                }

                if (images.length > 0) {
                    const groupData = await AssetsDB.getByGroupId(groupId);
                    U_WINDOW.DoLlynk.Assets.Groups.addOrUpdate({
                        id: groupId, fileCount: groupData.length,
                        size: groupData.reduce((acc, f) => acc + f.size, 0), type: 'mod-linked'
                    });
                }
                return images.length;
            },
            applyPatches(Assets) {
                if (Assets.FileInterceptor) {
                    const _resolve = Assets.FileInterceptor.resolveAssetPath;
                    Assets.FileInterceptor.resolveAssetPath = function(path, cb) {
                        if (typeof path !== 'string' || path.startsWith('data:') || path.startsWith('blob:')) return cb(path);
                        const hook = U_WINDOW.modSC2DataManager?.getHtmlImageLoaderHook?.();
                        if (hook?.map?.has(path)) return cb(path);
                        try { return _resolve.call(this, path, cb); }
                        catch (e) { console.warn(LOG_TAG, e); return cb(path); }
                    };
                }
                if (Assets.get) {
                    const _get = Assets.get.bind(Assets);
                    Assets.get = async function(path) {
                        return (typeof path === 'string' && (path.startsWith('blob:') || path.startsWith('data:')))
                            ? null : _get(path);
                    };
                }
            }
        },

        /* ANCHOR: UI Integration */
        UI: {
            injectGlobalButtons(UI) {
                const exportBtn = document.querySelector('[data-action="export-all"]');
                const importBtn = document.querySelector('[data-action="import-all"]');

                if (exportBtn && !document.querySelector('[data-action="export-all-zip"]')) {
                    const b = document.createElement('button');
                    Object.assign(b, { textContent: 'Export (ZIP)', title: 'Full Backup' });
                    b.dataset.action = 'export-all-zip';
                    exportBtn.after(b); exportBtn.after(document.createTextNode(' '));
                }
                if (importBtn && !document.querySelector('[data-action="import-all-zip"]')) {
                    const b = document.createElement('button');
                    Object.assign(b, { textContent: 'Import (ZIP)', title: 'Restore Backup' });
                    b.dataset.action = 'import-all-zip';
                    importBtn.after(b); importBtn.after(document.createTextNode(' '));
                }
            },
            injectGroupButtons(html) {
                return html.replace(
                    /(data-action="export-group" data-group="([^"]+)" title="Export Group">JSON5<\/button>)/g,
                    '$1 <button class="mod-btn" data-action="export-group-zip" data-group="$2" title="Export as Zip">ZIP</button>'
                );
            }
        }
    };

    /* ANCHOR: Initialization */
    function init() {
        if (!U_WINDOW.DoLlynk?.Assets) return setTimeout(init, 50);
        console.log(`${LOG_TAG} Initializing...`);
        const DL = U_WINDOW.DoLlynk;
        Suite.Assets.applyPatches(DL.Assets);

        // Hook UI
        if (DL.UI) {
            const _initHTML = DL.UI.initializeInjectedHTML;
            DL.UI.initializeInjectedHTML = function(c) { _initHTML.call(this, c); Suite.UI.injectGlobalButtons(DL.UI); };
            const _renderItem = DL.UI._renderItem;
            DL.UI._renderItem = function(item, depth, buf) {
                const tmp = [];
                _renderItem.call(this, item, depth, tmp);
                buf.push(Suite.UI.injectGroupButtons(tmp.join('')));
            };
            if (document.getElementById('mod-manager-wrapper')) Suite.UI.injectGlobalButtons(DL.UI);
        }
        if (DL.Events) {
            DL.Events._handlers['export-all-zip'] = () => {
                const btn = document.querySelector('[data-action="export-all-zip"]');
                if (btn) btn.textContent = '...';
                setTimeout(() => Suite.Backup.exportAll(DL.state.mods).finally(() => { if (btn) btn.textContent = 'Export (ZIP)'; }), 10);
            };

            DL.Events._handlers['import-all-zip'] = () => {
                const input = document.createElement('input');
                input.type = 'file'; input.accept = '.zip';
                input.onchange = e => {
                    if (e.target.files[0] && confirm('Replace ALL mods with backup?')) {
                        DL.UI.showLoader('Restoring...');
                        Suite.Backup.importAll(e.target.files[0], DL.UI, DL.Storage, DL.state)
                            .catch(err => alert(err.message))
                            .finally(() => DL.UI.hideLoader());
                    }
                };
                input.click();
            };

            DL.Events._handlers['export-group-zip'] = async (_, gid, e) => {
                const mods = DL.state.mods.filter(m => m.groupName === gid || m.groupName?.startsWith(gid + '/'));
                if (!mods.length) return alert('Empty group.');
                const useML = confirm(`Export "${gid}" as ModLoader?\n(Cancel = Standard)`);
                const btn = e.target; btn.textContent = '...'; btn.disabled = true;

                try {
                    const zip = new JSZip();
                    const gBase = gid.split('/').pop();
                    mods.forEach(m => {
                        const rel = m.groupName.length > gid.length ? m.groupName.substring(gid.length + 1) + '/' : '';
                        zip.file(rel + Suite.Utils.getModFileName(m), m.code);
                    });

                    if (useML) {
                        zip.file('boot.json', Suite.ModLoader.generateBoot(mods, gBase));
                        Suite.Utils.download(await zip.generateAsync({ type: 'blob' }), `${gBase}.modloader.zip`);
                    } else {
                        Suite.Utils.download(await zip.generateAsync({ type: 'blob' }), `${gBase}.standard.zip`);
                    }
                } catch (err) { console.error(err); alert('Zip Failed'); }
                finally { btn.textContent = 'ZIP'; btn.disabled = false; }
            };
        }

        // Hook FileHandler
        if (DL.FileHandler) {
            DL.FileHandler.browse = () => {
                const i = document.createElement('input');
                i.type = 'file'; i.multiple = true; i.accept = '.js,.css,.twee,.json,.json5,.zip,.txt';
                i.onchange = e => DL.FileHandler.stage(Array.from(e.target.files));
                i.click();
            };

            DL.FileHandler.installStaged = async () => {
                if (!DL.state.stagedFiles.length) return;
                DL.UI.showLoader('Installing (Suite)...');
                let updated = false;

                try {
                    for (const file of DL.state.stagedFiles) {
                        if (file.name.toLowerCase().endsWith('.zip')) {
                            const zip = await JSZip.loadAsync(file);

                            if (zip.file('dollynk_manifest.json5')) {
                                if (confirm(`Restore Full Backup "${file.name}"?`)) {
                                    await Suite.Backup.importAll(file, DL.UI, DL.Storage, DL.state);
                                    return;
                                }
                            }

                            // ModLoader or Standard
                            const bootFile = zip.file(/boot\.json5?$/i)[0];
                            const gName = bootFile ? (JSON5.parse(await bootFile.async('text')).name || file.name.replace(/\.zip$/i, ''))
                                                   : file.name.replace(/\.zip$/i, '');

                            const extracted = bootFile
                                ? await Suite.ModLoader.parseBoot(await bootFile.async('text'), gName, zip)
                                : await (async () => {
                                    const mods = [];
                                    for (const p in zip.files) {
                                        if (zip.files[p].dir || /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(p)) continue;
                                        const { type, name, earlyLoad } = Suite.Utils.getTypeAndName(p.split('/').pop());
                                        if (type) mods.push({
                                            name, type, code: await zip.files[p].async('text'),
                                            groupName: gName, earlyLoad: earlyLoad || ['twee','css','unified-patch'].includes(type)
                                        });
                                    }
                                    return mods;
                                })();

                            if (extracted.length) {
                                extracted.forEach(m => DL.state.mods.push({ ...m, id: crypto.randomUUID(), order: DL.state.mods.length, enabled: true }));
                                updated = true;
                            }
                            if (!DL.ENV.isFileProtocol && DL.state.settings.assetsEnabled) {
                                await Suite.Assets.importFromZip(zip, gName, DL.Assets.DB);
                            }
                        } else {
                            if (/\.json5?(\.txt)?$/i.test(file.name) && !file.name.includes('.modpatch.')) {
                                const content = await file.text();
                                const json = JSON5.parse(content);
                                if (Array.isArray(json) && json.every(i => i.type)) {
                                    json.filter(i => !DL.state.mods.some(m => m.id === i.id)).forEach(m => DL.state.mods.push({...m, order: DL.state.mods.length}));
                                    updated = true; continue;
                                } else if (Array.isArray(json)) {
                                     const { name } = Suite.Utils.getTypeAndName(file.name);
                                     DL.state.mods.push({ id: crypto.randomUUID(), name, type: 'unified-patch', code: content, earlyLoad: true, enabled: true, order: DL.state.mods.length });
                                     updated = true; continue;
                                }
                            }
                            // Standard Fallback
                            const { type, name, earlyLoad } = Suite.Utils.getTypeAndName(file.name);
                            if (type) {
                                DL.state.mods.push({
                                    id: crypto.randomUUID(), name, groupName: null, type,
                                    code: await file.text(), earlyLoad: earlyLoad || ['twee','css','unified-patch'].includes(type), enabled: true, order: DL.state.mods.length
                                });
                                updated = true;
                            }
                        }
                    }
                } catch (e) { console.error(LOG_TAG, e); alert('Install Error: ' + e.message); }

                DL.state.stagedFiles = [];
                if (updated) { DL.state.needsReload = true; await DL.Storage.saveMods(); DL.UI.resetForm(); DL.UI.updateModList(); }
                DL.UI.hideLoader();
            };
        }
    }

    init();
})();
