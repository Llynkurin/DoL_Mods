// ==UserScript==
// @name          DoLlynk Injector
// @namespace     https://github.com/Llynkurin
// @version       2.0
// @description   A mod injector and manager for Degrees of Lewdity.
// @author        Llynkurin
// @match         file:///*Degrees%20of%20Lewity*.html*
// @match         file:///*Degrees*of*Lewdity*.html*
// @match         file:///*DoL*.html*
// @match         https://*.dolmods.net/*
// @icon          https://www.google.com/s2/favicons?sz=64&domain=vrelnir.blogspot.com
// @grant         GM_getValue
// @grant         GM_setValue
// @grant         unsafeWindow
// @require       https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @require       https://cdn.jsdelivr.net/npm/json5@2.2.3/dist/index.min.js
// @run-at        document-start
// ==/UserScript==

(async function () {
    'use strict';

    /* ANCHOR: Compatibility & Environment */
    const U_WINDOW = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const U_DOCUMENT = U_WINDOW.document;
    U_WINDOW.JSON5 = JSON5;

    const ENV = {
        isFirefox: U_WINDOW.navigator.userAgent.includes("Firefox"),
        isChromium: !!U_WINDOW.chrome && !U_WINDOW.navigator.userAgent.includes("Firefox"),
        isFileProtocol: U_WINDOW.location.protocol === 'file:',
        get browser() {
            if (this.isFirefox) return { name: 'Firefox', emoji: '🦊' };
            if (this.isChromium) return { name: 'Chromium', emoji: '🍊' };
            return { name: 'Unknown', emoji: '🌐' };
        },
        get mode() {
            return this.isFileProtocol ? { name: 'Local', emoji: '💻' } : { name: 'Web', emoji: '🌐' };
        }
    };
    console.log(`[🦚 DoLlynk] Waking up... | Browser: ${ENV.browser.name} ${ENV.browser.emoji} | Mode: ${ENV.mode.name} ${ENV.mode.emoji}`);

    /* ANCHOR: State & Global Utilities */
    const state = {
        mods: [],
        stagedFiles: [],
        editingId: null,
        needsReload: false,
        openGroups: new Set(),
        settings: {}
    };

    const _triggerDownload = (blob, filename) => {
        const url = URL.createObjectURL(blob);
        const a = U_DOCUMENT.createElement('a');
        a.href = url;
        a.download = filename;
        U_DOCUMENT.body.appendChild(a);
        a.click();
        setTimeout(() => {
            U_DOCUMENT.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    };

    /* ANCHOR: Built-in UI Tab */
    const systemMod = [
        { name: 'DoLlynkUITab', type: 'twee', code: `:: DoLlynkModTab [widget]\n<<widget "DoLlynkModTab">><div id="mod-manager-wrapper-placeholder"></div><<script>>$(()=>{if(window.DoLlynk&&window.DoLlynk.UI&&typeof window.DoLlynk.UI.initializeInjectedHTML==='function'){const c=document.getElementById('mod-manager-wrapper-placeholder');if(c)window.DoLlynk.UI.initializeInjectedHTML(c)}})<</script>><</widget>>` },
        { name: 'DoLlynkUITabPatch', type: 'unified-patch', code: JSON.stringify([{ "role": "passage", "name": "overlayReplace", "method": "string", "find": '<<button "Information">>', "replace": '<<button "Mods">><<toggleTab>><<replace #customOverlayContent>><<DoLlynkModTab>><</replace>><</button>><<button "Information">>' }]) }
    ];

    /* ANCHOR: Storage */
    const Storage = {
        async loadMods() {
            let mods = await GM_getValue('dollynk_mods', null);
            if (mods === null) {
                try {
                    const legacyMods = JSON.parse(localStorage.getItem('dol_modloader_mods_v4'));
                    if (Array.isArray(legacyMods) && legacyMods.length > 0) {
                        mods = legacyMods;
                        await GM_setValue('dollynk_mods', mods);
                        console.log(`[✓ DoLlynk] Migrated ${mods.length} mods from legacy localStorage.`);
                        localStorage.setItem('dol_modloader_mods_v4_bak', JSON.stringify(mods));
                        localStorage.removeItem('dol_modloader_mods_v4');
                    }
                } catch (e) { }
            }
            mods = mods || [];
            mods.forEach((mod, index) => { if (typeof mod.order !== 'number') mod.order = index; });
            mods.sort((a, b) => a.order - b.order);
            state.mods = mods;
        },
        async saveMods() { await GM_setValue('dollynk_mods', state.mods); },
        async loadOpenGroups() { state.openGroups = new Set(await GM_getValue('dollynk_openGroups', [])); },
        async saveOpenGroups() { await GM_setValue('dollynk_openGroups', [...state.openGroups]); },
        async loadSettings() {
            const defaultSettings = { assetsEnabled: false, assetOverlaySystemEnabled: false };
            const storedSettings = await GM_getValue('dollynk_settings_v2', defaultSettings);
            state.settings = { ...defaultSettings, ...storedSettings };
        },
        async saveSettings() { await GM_setValue('dollynk_settings_v2', state.settings); },
        exportAll() {
            if (!state.mods.length) return U_WINDOW.alert('No mods to export');
            const blob = new Blob([JSON5.stringify(state.mods, null, 2)], { type: 'application/json5' });
            _triggerDownload(blob, `dollynk_backup_${new Date().toISOString().slice(0, 10)}.json5`);
        },
        importAll(file) {
            const reader = new FileReader();
            reader.onload = async e => {
                try {
                    const imported = JSON5.parse(e.target.result);
                    if (!Array.isArray(imported)) throw new Error('Invalid format');
                    if (U_WINDOW.confirm(`Replace all ${state.mods.length} mods with ${imported.length} from "${file.name}"?`)) {
                        state.mods = imported;
                        state.needsReload = true;
                        await this.saveMods();
                        UI.updateModList();
                        U_WINDOW.alert('Import complete - reload required');
                    }
                } catch (err) { U_WINDOW.alert(`Import failed: ${err.message}`); }
            };
            reader.readAsText(file);
        }
    };

    /* ANCHOR: Asset Management */
    const Assets = {
        DB: {
            dbName: 'DoLlynk_Assets_v2', storeName: 'images', db: null,
            async init() {
                if (this.db) return;
                return new Promise((resolve, reject) => {
                    const request = indexedDB.open(this.dbName, 2);
                    request.onerror = () => reject(request.error);
                    request.onsuccess = () => { this.db = request.result; resolve(); };
                    request.onupgradeneeded = (e) => {
                        const store = e.target.result.createObjectStore(this.storeName, { keyPath: 'path' });
                        store.createIndex('groupId', 'groupId', { unique: false });
                    };
                });
            },
            async get(path) { await this.init(); return new Promise(r => this.db.transaction([this.storeName]).objectStore(this.storeName).get(path).onsuccess = e => r(e.target.result)); },
            async getByGroupId(groupId) { await this.init(); return new Promise(r => this.db.transaction([this.storeName]).objectStore(this.storeName).index('groupId').getAll(groupId).onsuccess = e => r(e.target.result)); },
            async put(path, blob, groupId) { await this.init(); return this.db.transaction([this.storeName], 'readwrite').objectStore(this.storeName).put({ path, groupId, data: blob, size: blob.size }); },
            async deleteByGroupId(groupId) {
                const assets = await this.getByGroupId(groupId);
                if (!assets.length) return 0;
                const tx = this.db.transaction([this.storeName], 'readwrite');
                assets.forEach(asset => tx.objectStore(this.storeName).delete(asset.path));
                return new Promise(r => { tx.oncomplete = () => r(assets.length); });
            },
        },
        Groups: {
            _key: 'dollynk_asset_groups_v2', _groups: new Map(),
            async load() { this._groups = new Map((await GM_getValue(this._key, [])).map(g => [g.id, g])); },
            async save() { await GM_setValue(this._key, Array.from(this._groups.values())); },
            get(id) { return this._groups.get(id); },
            getAll() { return Array.from(this._groups.values()); },
            addOrUpdate(groupData) { this._groups.set(groupData.id, { ...(this.get(groupData.id) || { enabled: true }), ...groupData }); this.save(); },
            remove(id) { this._groups.delete(id); this.save(); },
            toggle(id) { const g = this.get(id); if (g) { g.enabled = !g.enabled; this.save(); } },
            isEnabled(id) { return this.get(id)?.enabled ?? false; },
        },
        Overlays: {
            _key: 'dollynk_asset_overlays_v1', _overlays: [],
            async load() {
                if (typeof state.settings.assetOverlayEnabled !== 'undefined') {
                    if (state.settings.assetOverlayEnabled) this._overlays.push({ id: 'default_mod_img', name: 'Default (mod_img)', source: 'mod_img/', target: 'img/', enabled: true, priority: 0 });
                    delete state.settings.assetOverlayEnabled;
                    state.settings.assetOverlaySystemEnabled = true;
                    await Storage.saveSettings();
                    console.log('[✓ DoLlynk Assets] Migrated old asset overlay setting.');
                } else { this._overlays = await GM_getValue(this._key, []); }
                this._overlays.forEach((o, i) => o.priority = i); await this.save();
            },
            async save() { await GM_setValue(this._key, this._overlays); },
            getAll() { return this._overlays; },
            getEnabled() { return this._overlays.filter(o => o.enabled).sort((a, b) => a.priority - b.priority); },
            add(name, source, target) {
                const newOverlay = { id: source.replace(/[^a-zA-Z0-9]/g, '_') + Date.now(), name, source: source.endsWith('/') ? source : source + '/', target: target.endsWith('/') ? target : target + '/', enabled: true, priority: this._overlays.length };
                this._overlays.push(newOverlay); this.save();
            },
            update(id, data) {
                const idx = this._overlays.findIndex(o => o.id === id);
                if (idx > -1) {
                    const updated = { ...this._overlays[idx], ...data };
                    if (!updated.source.endsWith('/')) updated.source += '/';
                    if (!updated.target.endsWith('/')) updated.target += '/';
                    this._overlays[idx] = updated;
                    this.save();
                }
            },
            remove(id) { this._overlays = this._overlays.filter(o => o.id !== id); this._overlays.forEach((o, i) => o.priority = i); this.save(); },
            toggle(id) { const o = this._overlays.find(ov => ov.id === id); if (o) { o.enabled = !o.enabled; this.save(); } },
        },
        WebInterceptor: {
            setup() {
                if (U_WINDOW._dollynk_image_intercepted) return;
                U_WINDOW._dollynk_image_intercepted = true;
                const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
                const handler = (el, path) => {
                    if (typeof path !== 'string' || /^(data:|blob:)/.test(path)) return desc.set.call(el, path);
                    Assets.get(path).then(uri => desc.set.call(el, uri || path));
                };
                Object.defineProperty(HTMLImageElement.prototype, 'src', { set(v) { handler(this, v); }, get: desc.get });
                const OrigImg = U_WINDOW.Image;
                U_WINDOW.Image = function () { const i = new OrigImg(); Object.defineProperty(i, 'src', { set(v) { handler(i, v); }, get: desc.get }); return i; };
                console.log(`[✓ DoLlynk Assets] Web protocol image interceptor active.`);
            }
        },
        FileInterceptor: {
            pathCache: new Map(), pendingImages: new Map(), OriginalImage: null,
            setup() {
                this.OriginalImage = U_WINDOW.Image;
                const self = this;
                U_WINDOW.Image = function () {
                    const img = new self.OriginalImage();
                    const originalSrc = Object.getOwnPropertyDescriptor(self.OriginalImage.prototype, 'src');
                    Object.defineProperty(img, 'src', {
                        get: () => img._currentSrc || '',
                        set(value) {
                            if (value && typeof value === 'string' && value.includes('img/')) {
                                self.resolveAssetPath(value, resolvedPath => originalSrc.set.call(img, (img._currentSrc = resolvedPath)));
                            } else {
                                originalSrc.set.call(img, (img._currentSrc = value));
                            }
                        }
                    });
                    return img;
                };
                U_WINDOW.Image.prototype = this.OriginalImage.prototype;
                console.log('[✓ DoLlynk Assets] File overlay system active.');
            },
resolveAssetPath(originalPath, callback) {
                const normalizedPath = originalPath.replace(/\\/g, '/');

                if (this.pathCache.has(normalizedPath)) return callback(this.pathCache.get(normalizedPath));
                if (this.pendingImages.has(normalizedPath)) return this.pendingImages.get(normalizedPath).push(callback);

                this.pendingImages.set(normalizedPath, [callback]);
                const activeOverlays = Assets.Overlays.getEnabled();
                let i = 0;

                const testNextOverlay = () => {
                    if (i >= activeOverlays.length) {
                        return this.finalizePath(normalizedPath, normalizedPath);
                    }
                    const overlay = activeOverlays[i++];
                    const normalizedTarget = overlay.target.replace(/\\/g, '/');

                    if (normalizedPath.includes(normalizedTarget)) {
                        const relative = normalizedPath.substring(normalizedPath.indexOf(normalizedTarget) + normalizedTarget.length);
                        const modPath = (overlay.source + relative).replace(/\\/g, '/');

                        const testImg = new this.OriginalImage();
                        let resolved = false;

                        // INFO: Add a timeout fallback for Brave
                        const timeoutId = setTimeout(() => {
                            if (!resolved) {
                                resolved = true;
                                testNextOverlay();
                            }
                        }, 100);

                        testImg.onload = () => {
                            if (resolved) return;
                            resolved = true;
                            clearTimeout(timeoutId);
                            this.finalizePath(normalizedPath, modPath);
                        };
                        testImg.onerror = () => {
                            if (resolved) return;
                            resolved = true;
                            clearTimeout(timeoutId);
                            testNextOverlay();
                        };
                        testImg.src = modPath;
                    } else {
                        testNextOverlay();
                    }
                };
                testNextOverlay();
            },
            finalizePath(originalPath, resolvedPath) {
                this.pathCache.set(originalPath, resolvedPath);
                const callbacks = this.pendingImages.get(originalPath) || [];
                this.pendingImages.delete(originalPath);
                callbacks.forEach(cb => cb(resolvedPath));
            },
        },
        cache: new Map(),
        _normalizePath(relativePath) { let p = relativePath.replace(/^[/\\]+/g, ''); const i = p.indexOf('img/'); return i > -1 ? p.substring(i) : `img/${p}`; },
        async get(path) { // Web
            const normalized = this._normalizePath(path);
            if (this.cache.has(normalized)) return this.cache.get(normalized);
            const asset = await this.DB.get(normalized);
            if (asset && this.Groups.isEnabled(asset.groupId)) {
                return new Promise(r => {
                    const reader = new FileReader();
                    reader.onload = () => { this.cache.set(normalized, reader.result); r(reader.result); };
                    reader.readAsDataURL(asset.data);
                });
            }
            return null;
        },
        async importFromZip(zip, groupId) { // Web
            const imageFiles = Object.values(zip.files).filter(f => !f.dir && /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(f.name));
            for (const file of imageFiles) {
                await this.DB.put(this._normalizePath(file.name), await file.async('blob'), groupId);
            }
            if (imageFiles.length > 0) {
                const groupData = await this.DB.getByGroupId(groupId);
                this.Groups.addOrUpdate({ id: groupId, fileCount: groupData.length, size: groupData.reduce((acc, f) => acc + f.size, 0), type: 'mod-linked' });
            }
            return imageFiles.length;
        },
        UI: {
            expandedGroups: new Set(),
            strategy: {},
            initialize() {
                this.strategy = ENV.isFileProtocol ? this.fileStrategy : this.webStrategy;
                Object.assign(Events._handlers, this.strategy.events);
                const originalInit = UI.initializeInjectedHTML;
                UI.initializeInjectedHTML = (container) => {
                    originalInit.call(UI, container);
                    this.setup(container);
                };
            },
            setup(container) {
                const el = container.querySelector('#dollynk-assets-control-container');
                if (el) el.innerHTML = `<div class="dollynk-composite-button" id="${this.strategy.controlId}"><div class="dollynk-composite-toggle" data-action="${this.strategy.toggleSystemEvent}"></div><button class="dollynk-composite-main" data-action="${this.strategy.showManagerEvent}">${this.strategy.managerButtonText}</button></div>`;
                if (!U_DOCUMENT.getElementById(this.strategy.formId)) {
                    container.querySelector('#dollynk-main-screen').insertAdjacentHTML('afterend', `<div id="${this.strategy.formId}" class="mod-form hidden"><div class="settingsHeader options">${this.strategy.title}</div><div id="${this.strategy.listId}" class="dollynk-list-container"></div><div class="settingsGrid" style="grid-template-columns: 1fr 1fr;"><button data-action="${this.strategy.addEvent}">${this.strategy.addButtonText}</button><button data-action="reset-form">Back to Mods</button></div></div>`);
                }
                this.updateControl();
            },
            updateControl() { U_DOCUMENT.getElementById(this.strategy.controlId)?.classList.toggle('enabled', state.settings[this.strategy.settingsKey]); },
            async updateList() {
                const container = U_DOCUMENT.getElementById(this.strategy.listId);
                const items = await this.strategy.dataManager.getAll();
                if (!items.length) { container.innerHTML = `<div class="settingsToggleItem">${this.strategy.emptyText}</div>`; return; }
                container.innerHTML = (await Promise.all(items.map(item => this.renderItem(item)))).join('');
            },
            async renderItem(item) {
                if (ENV.isFileProtocol) { // File Overlay
                    return `<div class="settingsToggleItem dollynk-mod-item" data-state="${item.enabled ? 'enabled' : 'disabled'}">
                        <div class="mod-info"><strong>${item.name}</strong><span class="mod-type asset-path">${item.source} → ${item.target}</span></div>
                        <div class="mod-actions">
                            <button data-action="toggle-local-overlay" data-group="${item.id}">${item.enabled ? 'Disable' : 'Enable'}</button>
                            <button class="mod-btn" data-action="edit-local-overlay" data-group="${item.id}" title="Edit">✎</button>
                            <button class="mod-btn" data-action="delete-local-overlay" data-group="${item.id}" title="Delete">✕</button>
                        </div></div>`;
                } else { // Web Asset
                    const sizeMB = (item.size / 1024 / 1024).toFixed(2);
                    const isExpanded = this.expandedGroups.has(item.id);
                    return `<div class="settingsToggleItem dollynk-mod-item ${isExpanded ? 'expanded' : ''}" data-state="${item.enabled ? 'enabled' : 'disabled'}">
                        <div class="mod-info">
                            <span class="expand-toggle" data-action="expand-asset-group" data-group="${item.id}">${isExpanded ? '▼' : '▶'}</span>${item.id}
                            <span class="mod-type">${item.fileCount} files, ${sizeMB} MB</span>
                            ${item.type === 'mod-linked' ? '<span class="mod-badge">MOD</span>' : ''}
                        </div>
                        <div class="mod-actions">
                            <button data-action="toggle-asset-group" data-group="${item.id}">${item.enabled ? 'Disable' : 'Enable'}</button>
                            ${item.type !== 'mod-linked' ? `<button class="mod-btn" data-action="delete-asset-group" data-group="${item.id}">✕</button>` : ''}
                        </div>
                        ${isExpanded ? `<div class="asset-folder-list"><div class="folder-tree">${await this.renderFolderTree(item.id)}</div></div>` : ''}
                    </div>`;
                }
            },
            async renderFolderTree(groupId) {
                const assets = await Assets.DB.getByGroupId(groupId);
                const tree = {}; assets.forEach(a => a.path.split('/').reduce((o, p, i, arr) => o[p] = o[p] || (i === arr.length - 1 ? null : {}), tree));
                const render = (node, level) => Object.keys(node).sort().map(key => `<div style="padding-left:${level * 20}px">${node[key] === null ? `📄 ${key}` : `📁 ${key}/`}</div>${node[key] ? render(node[key], level + 1) : ''}`).join('');
                return `<strong>${assets.length} files</strong>${render(tree, 0)}`;
            },
            fileStrategy: {
                title: 'Local Asset Overlay Manager', formId: 'local-asset-manager-form', listId: 'local-overlay-list', controlId: 'dollynk-local-assets-control', managerButtonText: 'Manage Local Overlays', addButtonText: 'Add Overlay Folder', emptyText: 'No overlay folders configured.',
                settingsKey: 'assetOverlaySystemEnabled', dataManager: null, showManagerEvent: 'show-local-asset-manager', addEvent: 'add-local-overlay', deleteEvent: 'delete-local-overlay', toggleEvent: 'toggle-local-overlay', toggleSystemEvent: 'toggle-local-assets-system',
                events: {
                    'show-local-asset-manager': () => { UI.showForm('local-asset-manager-form'); Assets.UI.updateList(); },
                    'add-local-overlay': () => {
                        const name = prompt("Enter a unique Asset Group Name (e.g. 'Modded image Pack').", "New Pack"); if (!name) return;
                        const source = prompt("Enter the Relative Path (folder next to HTML, e.g. 'mod_img/hair/' to target the hair folder).", "mod_img/"); if (!source) return;
                        const target = prompt("Enter the Replacement Target (game folder, e.g. 'img/hair/' to target the hair folder).", "img/"); if (!target) return;
                        Assets.Overlays.add(name.trim(), source.trim(), target.trim()); Assets.UI.updateList(); state.needsReload = true; UI.updateModList();
                    },
                    'edit-local-overlay': (_, id) => {
                        const overlay = Assets.Overlays.getAll().find(o => o.id === id); if (!overlay) return;
                        const name = prompt("Asset Group Name:", overlay.name); if (!name) return;
                        const source = prompt("Relative Path (folder next to HTML):", overlay.source); if (!source) return;
                        const target = prompt("Replacement Target (game folder):", overlay.target); if (!target) return;
                        Assets.Overlays.update(id, { name: name.trim(), source: source.trim(), target: target.trim() });
                        Assets.UI.updateList(); state.needsReload = true; UI.updateModList();
                    },
                    'delete-local-overlay': (_, id) => { const o = Assets.Overlays.getAll().find(ov => ov.id === id); if (o && confirm(`Remove "${o.name}" overlay?`)) { Assets.Overlays.remove(id); Assets.UI.updateList(); state.needsReload = true; UI.updateModList(); } },
                    'toggle-local-overlay': (_, id) => { Assets.Overlays.toggle(id); Assets.UI.updateList(); state.needsReload = true; UI.updateModList(); },
                    'toggle-local-assets-system': async () => { state.settings.assetOverlaySystemEnabled = !state.settings.assetOverlaySystemEnabled; await Storage.saveSettings(); state.needsReload = true; UI.updateModList(); Assets.UI.updateControl(); },
                }
            },
            webStrategy: {
                title: 'Asset Manager', formId: 'mod-asset-manager-form', listId: 'asset-group-list', controlId: 'dollynk-assets-control', managerButtonText: 'Manage Assets', addButtonText: 'Import Folder', emptyText: 'No asset groups installed.',
                settingsKey: 'assetsEnabled', dataManager: null, showManagerEvent: 'show-asset-manager', addEvent: 'import-assets', deleteEvent: 'delete-asset-group', toggleEvent: 'toggle-asset-group', toggleSystemEvent: 'toggle-assets-system',
                events: {
                    'show-asset-manager': () => { UI.showForm('mod-asset-manager-form'); Assets.UI.updateList(); },
                    'import-assets': () => {
                        const input = Object.assign(U_DOCUMENT.createElement('input'), { type: 'file', webkitdirectory: true });
                        input.onchange = async e => {
                            const files = Array.from(e.target.files).filter(f => !f.name.startsWith('.')); if (!files.length) return;
                            const groupId = prompt(`Enter name for this asset group:`, files[0]?.webkitRelativePath.split('/')[0] || 'CustomAssets'); if (!groupId) return;
                            UI.showLoader('Importing assets...');
                            for (const file of files) { await Assets.DB.put(Assets._normalizePath(file.webkitRelativePath), file, groupId); }
                            const groupData = await Assets.DB.getByGroupId(groupId);
                            Assets.Groups.addOrUpdate({ id: groupId, fileCount: groupData.length, size: groupData.reduce((acc, f) => acc + f.size, 0), type: 'standalone' });
                            UI.hideLoader(); U_WINDOW.alert(`Imported ${groupData.length} assets into "${groupId}".`); Assets.UI.updateList();
                        };
                        input.click();
                    },
                    'delete-asset-group': async (_, id) => { const g = Assets.Groups.get(id); if (!g || !confirm(`Delete asset group "${g.id}"? This permanently removes ${g.fileCount} files.`)) return; UI.showLoader('Deleting...'); await Assets.DB.deleteByGroupId(g.id); Assets.Groups.remove(g.id); UI.hideLoader(); Assets.UI.updateList(); },
                    'toggle-asset-group': (_, id) => { Assets.Groups.toggle(id); Assets.UI.updateList(); },
                    'expand-asset-group': (_, id) => { Assets.UI.expandedGroups.has(id) ? Assets.UI.expandedGroups.delete(id) : Assets.UI.expandedGroups.add(id); Assets.UI.updateList(); },
                    'toggle-assets-system': async () => { state.settings.assetsEnabled = !state.settings.assetsEnabled; await Storage.saveSettings(); state.needsReload = true; UI.updateModList(); Assets.UI.updateControl(); },
                }
            }
        },
        async initialize() {
            if (ENV.isFileProtocol) {
                this.UI.fileStrategy.dataManager = this.Overlays;
                await this.Overlays.load();
                if (state.settings.assetOverlaySystemEnabled) this.FileInterceptor.setup();
            } else {
                this.UI.webStrategy.dataManager = this.Groups;
                await this.Groups.load();
                if (state.settings.assetsEnabled) this.WebInterceptor.setup();
            }
            this.UI.initialize();
        }
    };

    /* ANCHOR: File Handling */
    const FileHandler = {
        browse() { const i = U_DOCUMENT.createElement('input'); i.type = 'file'; i.multiple = true; i.accept = '.js,.css,.twee,.json,.json5,.zip,.txt'; i.onchange = e => this.stage(Array.from(e.target.files)); i.click(); },
        stage(files) { const valid = files.filter(f => /\.(js|css|twee|json5?|zip|txt)$/i.test(f.name)); state.stagedFiles.push(...valid.filter(f => !state.stagedFiles.some(s => s.name === f.name))); this._updateStageView(); },
        unstage(index) { state.stagedFiles.splice(index, 1); this._updateStageView(); },
        _updateStageView() { if (UI.dom.stagedFiles) UI.dom.stagedFiles.innerHTML = state.stagedFiles.map((f, i) => `<div class="settingsToggleItem"><span>${f.name}</span><button data-action="unstage-file" data-index="${i}">Remove</button></div>`).join(''); },
        async installStaged() {
            if (!state.stagedFiles.length) return; UI.showLoader('Installing...');
            for (const file of state.stagedFiles) {
                if (/\.zip$/i.test(file.name)) await this._installZip(file); else if (/\.(json5?)$/i.test(file.name)) await this._installJson(file); else await this._installFile(file, null);
            }
            state.stagedFiles = []; state.needsReload = true; await Storage.saveMods(); UI.resetForm(); UI.updateModList(); UI.hideLoader();
        },
        async _installFile(file, groupName) {
            const { type, name, earlyLoad } = ModActions._getTypeAndName(file.name); if (!type) return;
            const code = await file.text(); const finalEarly = earlyLoad || ['twee', 'css', 'unified-patch'].includes(type);
            state.mods.push({ name, groupName, type, code, earlyLoad: finalEarly, enabled: true, id: crypto.randomUUID(), order: state.mods.length });
        },
        async _installJson(file) {
            try {
                const imported = JSON5.parse(await file.text()); if (!Array.isArray(imported)) return;
                const newMods = imported.filter(imp => !state.mods.some(ex => ex.id === imp.id));
                if (newMods.length > 0) newMods.forEach(mod => state.mods.push({ ...mod, order: state.mods.length }));
            } catch (err) { U_WINDOW.alert(`Failed to import ${file.name}: ${err.message}`); }
        },
        async _installZip(file) {
            try {
                const zip = await JSZip.loadAsync(file); const rootGroup = file.name.replace(/\.zip$/i, '');
                if (!ENV.isFileProtocol && state.settings.assetsEnabled) { const count = await Assets.importFromZip(zip, rootGroup); if (count > 0) console.log(`[✓ DoLlynk Assets] Imported ${count} assets from ${file.name}.`); }
                for (const path in zip.files) {
                    const entry = zip.files[path]; if (entry.dir || /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(entry.name)) continue;
                    const pathParts = path.split('/').filter(p => p); const fileName = pathParts.pop();
                    const groupName = [rootGroup, ...pathParts].join('/');
                    await this._installFile(new File([await entry.async('blob')], fileName), groupName);
                }
            } catch (err) { U_WINDOW.alert(`Failed to install ${file.name}: ${err.message}`); }
        }
    };

    /* ANCHOR: Mod Actions */
    const ModActions = {
        async _updateAndSave(callback) { callback(); state.needsReload = true; await Storage.saveMods(); UI.updateModList(); },
        toggle(id) { this._updateAndSave(() => { const mod = state.mods.find(m => m.id === id); if (mod) mod.enabled = !mod.enabled; }); },
        toggleGroup(id) { this._updateAndSave(() => { const mods = state.mods.filter(m => m.groupName === id || m.groupName?.startsWith(id + '/')); const newState = !mods.every(m => m.enabled); mods.forEach(m => m.enabled = newState); }); },
        setAllEnabled(enabled) { if (U_WINDOW.confirm(`This will ${enabled ? 'enable' : 'disable'} all ${state.mods.length} mods. Continue?`)) { this._updateAndSave(() => state.mods.forEach(m => m.enabled = enabled)); } },
        delete(id) { if (U_WINDOW.confirm('Delete this mod?')) { this._updateAndSave(() => { state.mods = state.mods.filter(m => m.id !== id); if (state.editingId === id) UI.resetForm(); }); } },
        async deleteGroup(groupId) {
            let assetInfo = ''; let assetGroup = null; if (!ENV.isFileProtocol) { assetGroup = Assets.Groups.get(groupId); if (assetGroup) assetInfo = ` and its ${assetGroup.fileCount} linked assets`; }
            if (U_WINDOW.confirm(`Delete all mods in group "${groupId}"${assetInfo}? This is permanent.`)) {
                if (assetGroup) { await Assets.DB.deleteByGroupId(groupId); Assets.Groups.remove(groupId); }
                this._updateAndSave(() => { state.mods = state.mods.filter(m => !(m.groupName === groupId || m.groupName?.startsWith(groupId + '/'))); });
            }
        },
        async renameGroup(oldName) {
            const newName = U_WINDOW.prompt('Enter new full path for this group:', oldName)?.trim().replace(/\/$/, '');
            if (!newName || newName === oldName || state.mods.some(m => m.groupName === newName || m.groupName?.startsWith(newName + '/'))) return;
            this._updateAndSave(() => {
                state.mods.forEach(mod => { if (mod.groupName === oldName) mod.groupName = newName; else if (mod.groupName?.startsWith(oldName + '/')) mod.groupName = newName + mod.groupName.substring(oldName.length); });
                [...state.openGroups].filter(g => g === oldName || g.startsWith(oldName + '/')).forEach(g => { state.openGroups.delete(g); state.openGroups.add(newName + g.substring(oldName.length)); });
                Storage.saveOpenGroups();
            });
        },
        edit(id) {
            const mod = state.mods.find(m => m.id === id); if (!mod) return; UI.showForm('mod-manual-form'); state.editingId = id;
            UI.dom.nameInput.value = (mod.groupName ? `${mod.groupName}/` : '') + this._getFileNameFromMod(mod); UI.dom.codeInput.value = mod.code;
            UI.dom.earlyLoadCheck.checked = !!mod.earlyLoad; UI.dom.formHeader.textContent = 'Edit Mod';
        },
        addToGroup(id) { UI.showForm('mod-manual-form'); UI.dom.nameInput.value = `${id}/`; UI.dom.formHeader.textContent = `Add to ${id}`; },
        saveManual() {
            const fullName = UI.dom.nameInput.value.trim(); const code = UI.dom.codeInput.value; if (!fullName || !code) return;
            const { type, name, earlyLoad } = this._getTypeAndName(fullName.split('/').pop()); if (!type) return U_WINDOW.alert('Invalid file extension.');
            const groupName = fullName.includes('/') ? fullName.substring(0, fullName.lastIndexOf('/')) : null; const finalEarlyLoad = UI.dom.earlyLoadCheck.checked || earlyLoad;
            this._updateAndSave(() => {
                if (state.editingId) { const mod = state.mods.find(m => m.id === state.editingId); if (mod) Object.assign(mod, { name, groupName, type, code, earlyLoad: finalEarlyLoad }); }
                else { state.mods.push({ id: crypto.randomUUID(), name, groupName, type, code, earlyLoad: finalEarlyLoad, enabled: true, order: state.mods.length }); }
            }); UI.resetForm();
        },
        reorder(dragged, target) {
            this._updateAndSave(() => {
                const [dragType, dragId] = dragged.split(':'); const [targetType, targetId] = target.split(':');
                const getTargetIndex = () => targetType === 'mod' ? state.mods.findIndex(m => m.id === targetId) : state.mods.findIndex(m => m.groupName === targetId || m.groupName?.startsWith(targetId + '/'));
                let itemsToMove;
                if (dragType === 'mod') { const i = state.mods.findIndex(m => m.id === dragId); if (i > -1) itemsToMove = state.mods.splice(i, 1); }
                else { itemsToMove = state.mods.filter(m => m.groupName === dragId || m.groupName?.startsWith(dragId + '/')); state.mods = state.mods.filter(m => !itemsToMove.includes(m)); }
                if (!itemsToMove?.length) return; let finalIndex = getTargetIndex();
                state.mods.splice(finalIndex > -1 ? finalIndex : state.mods.length, 0, ...itemsToMove); state.mods.forEach((mod, index) => mod.order = index);
            });
        },
        exportMod(id) { const mod = state.mods.find(m => m.id === id); if (mod) _triggerDownload(new Blob([mod.code], { type: 'text/plain;charset=utf-8' }), this._getFileNameFromMod(mod)); },
        async exportGroup(id, button) {
            const mods = state.mods.filter(m => m.groupName === id || m.groupName?.startsWith(id + '/')); if (!mods.length) return;
            const originalText = button.textContent; button.textContent = '...'; button.disabled = true;
            try { _triggerDownload(new Blob([JSON5.stringify(mods, null, 2)], { type: 'application/json5' }), `${id.split('/').pop()}.dollynk-group.json5`); }
            catch (err) { console.error(`[❌ DoLlynk] Failed to generate JSON5 for group ${id}:`, err); }
            finally { button.textContent = originalText; button.disabled = false; }
        },
        _getFileNameFromMod(mod) { const extMap = { 'unified-patch': '.modpatch.json5', 'twee': '.twee', 'js': '.js', 'css': '.css', 'txt-content': '.txt' }; return `${mod.name}${mod.earlyLoad && mod.type === 'js' ? '.early.js' : extMap[mod.type] || `.${mod.type}`}`; },
        _getTypeAndName(fileName) {
            const rules = [{ r: /\.early\.js$/i, t: 'js', e: true }, { r: /\.modpatch\.json5?$/i, t: 'unified-patch' }, { r: /\.twee(\.txt)?$/i, t: 'twee' }, { r: /\.js$/i, t: 'js' }, { r: /\.css$/i, t: 'css' }, { r: /\.txt$/i, t: 'txt-content' }, { r: /\.json5?$/i, t: 'unified-patch' }];
            for (const { r, t, e } of rules) { if (r.test(fileName)) return { type: t, name: fileName.replace(r, ''), earlyLoad: !!e }; } return { type: null, name: fileName, earlyLoad: false };
        }
    };

    /* ANCHOR: UI */
    const UI = {
        dom: {},
        initializeInjectedHTML(container) {
            if (!container || U_DOCUMENT.getElementById('mod-manager-wrapper')) return;
            container.id = 'mod-manager-wrapper'; container.innerHTML = this._getManagerTemplate();
            this.dom = { list: container.querySelector('#mod-list-section'), reloadNotice: container.querySelector('#mod-reload-actions'), stagedFiles: container.querySelector('#mod-staged-files'), mainScreen: container.querySelector('#dollynk-main-screen'), manualForm: container.querySelector('#mod-manual-form'), formHeader: container.querySelector('#form-header'), nameInput: container.querySelector('#mod-name-input'), codeInput: container.querySelector('#mod-code-input'), earlyLoadCheck: container.querySelector('#mod-earlyload-check'), dropzone: container.querySelector('.mod-dropzone') };
            Events.bind(container); this.updateModList();
        },
        forceInjectManager() {
            let overlay = U_DOCUMENT.getElementById('customOverlay'); if (!overlay) { overlay = U_DOCUMENT.createElement('div'); overlay.id = 'customOverlay'; overlay.className = 'overlay'; U_DOCUMENT.body.appendChild(overlay); }
            let content = U_DOCUMENT.getElementById('customOverlayContent'); if (!content) { content = U_DOCUMENT.createElement('div'); content.id = 'customOverlayContent'; overlay.appendChild(content); }
            if (!U_DOCUMENT.getElementById('mod-manager-wrapper')) { content.innerHTML = '<div class="settingsHeader options">Mod Manager (Failsafe)</div><div id="mod-manager-wrapper-placeholder"></div>'; this.initializeInjectedHTML(U_DOCUMENT.getElementById('mod-manager-wrapper-placeholder')); }
            overlay.style.display = 'block';
        },
        updateModList() {
            if (!this.dom.list) return; this.dom.reloadNotice.style.display = state.needsReload ? 'block' : 'none';
            const standalone = state.mods.filter(m => !m.groupName); const topLevelGroups = [...new Set(state.mods.filter(m => m.groupName).map(m => m.groupName.split('/')[0]))];
            const buffer = []; standalone.forEach(mod => this._renderItem(mod, 0, buffer)); topLevelGroups.forEach(groupName => this._renderItem({ isGroup: true, name: groupName }, 0, buffer));
            this.dom.list.innerHTML = buffer.join('') || '<div class="settingsToggleItem">No mods installed. Drag files here to begin.</div>';
        },
        _getGroupState(groupName) {
            const mods = state.mods.filter(m => m.groupName === groupName || m.groupName?.startsWith(groupName + '/'));
            if (mods.length === 0) return 'empty'; if (mods.every(m => m.enabled)) return 'enabled'; if (mods.every(m => !m.enabled)) return 'disabled'; return 'mixed';
        },
        _renderItem(item, depth, buffer) {
            const indent = depth > 0 ? `style="margin-left: ${depth * 10}px"` : '';
            if (item.isGroup) {
                const groupName = item.name; const groupState = this._getGroupState(groupName); if (groupState === 'empty') return;
                const isOpen = state.openGroups.has(groupName); const displayName = groupName.split('/').pop();
                buffer.push(`<details class="mod-group" ${isOpen ? 'open' : ''} draggable="true" data-group-name="${groupName}" ${indent}><summary class="settingsToggleItem dollynk-mod-item" data-group="${groupName}" data-state="${groupState}"><strong>${displayName}</strong><span class="mod-actions"><button data-action="toggle-group" data-group="${groupName}">${groupState === 'enabled' ? 'Disable' : 'Enable'}</button><button class="mod-btn" data-action="export-group" data-group="${groupName}" title="Export Group">JSON5</button><button class="mod-btn" data-action="rename-group" data-group="${groupName}" title="Rename">✎</button><button class="mod-btn" data-action="add-to-group" data-group="${groupName}" title="Add">+</button><button class="mod-btn" data-action="delete-group" data-group="${groupName}" title="Delete">✕</button></span></summary><div class="mod-group-content">`);
                const directMods = state.mods.filter(m => m.groupName === groupName);
                const directSubgroups = [...new Set(state.mods.filter(m => m.groupName?.startsWith(groupName + '/')).map(m => m.groupName.substring(groupName.length + 1).split('/')[0]))].map(sub => `${groupName}/${sub}`);
                directSubgroups.forEach(sg => this._renderItem({ isGroup: true, name: sg }, depth + 1, buffer)); directMods.forEach(m => this._renderItem(m, depth + 1, buffer)); buffer.push(`</div></details>`);
            } else {
                const types = { 'unified-patch': 'Patches', js: 'JS', css: 'CSS', twee: 'Twee', 'txt-content': 'Data' }; const typeLabel = types[item.type] || item.type?.toUpperCase() || 'INVALID';
                buffer.push(`<div class="settingsToggleItem dollynk-mod-item ${item.earlyLoad ? 'mod-item-early' : ''}" data-mod-id="${item.id}" data-state="${item.enabled ? 'enabled' : 'disabled'}" draggable="true" ${indent}><div class="mod-info">${item.name}<span class="mod-type">${typeLabel}</span>${typeLabel === 'INVALID' ? '<span class="mod-badge disabled">CORRUPT</span>' : ''}</div><div class="mod-actions"><button data-action="toggle-mod">${item.enabled ? 'Disable' : 'Enable'}</button><button class="mod-btn" data-action="export-mod" title="Export File">⇲</button><button class="mod-btn" data-action="edit-mod" title="Edit">✎</button><button class="mod-btn" data-action="delete-mod" title="Delete">✕</button></div></div>`);
            }
        },
        showLoader(text) {
            let loader = U_DOCUMENT.getElementById('dollynk-loader');
            if (!loader) { loader = U_DOCUMENT.createElement('div'); loader.id = 'dollynk-loader'; loader.innerHTML = `<div class="loader-content"><div class="loader-title">DoLlynk</div><div class="loader-status"></div></div>`; U_DOCUMENT.documentElement.appendChild(loader); }
            loader.querySelector('.loader-status').textContent = text;
        },
        hideLoader: () => U_DOCUMENT.getElementById('dollynk-loader')?.remove(),
        showForm(formId) { this.dom.mainScreen?.classList.add('hidden'); U_DOCUMENT.querySelectorAll('.mod-form').forEach(f => f.classList.add('hidden')); const formToShow = U_DOCUMENT.getElementById(formId); if (formToShow) formToShow.classList.remove('hidden'); },
        resetForm() {
            U_DOCUMENT.querySelectorAll('.mod-form').forEach(f => f.classList.add('hidden')); this.dom.mainScreen?.classList.remove('hidden'); state.editingId = null;
            this.dom.nameInput.value = ''; this.dom.codeInput.value = ''; this.dom.earlyLoadCheck.checked = false; this.dom.formHeader.textContent = 'Add Mod Manually';
        },
        _getManagerTemplate() { return `<style>#dollynk-loader{position:fixed;inset:0;background:var(--900);z-index:99999;display:flex;align-items:center;justify-content:center;color:var(--000);font-family:monospace}.loader-content{text-align:center}.loader-title{font-size:24px;margin-bottom:10px}.dollynk-manager-container{display:flex;flex-direction:column;gap:10px}.dollynk-grid-header{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start}.header-col-left,.header-col-right{display:flex;flex-direction:column;gap:8px}.header-col-right{display:grid;grid-template-columns:1fr 1fr}#dollynk-assets-control-container{grid-column:1/-1}.dollynk-list-container{display:flex;flex-direction:column;gap:8px}.dollynk-mod-item{display:flex;justify-content:space-between;align-items:center;padding:8px 12px!important;background:var(--850);border-radius:8px}.dollynk-mod-item[data-state=disabled]{opacity:.6}.dollynk-mod-item[data-state=mixed]{opacity:.8;border-left:4px solid var(--blue);padding-left:8px!important}.dollynk-mod-item[data-state=disabled]{border-left:4px solid var(--red);padding-left:8px!important}.dollynk-mod-item.mod-item-early{border-left:4px solid var(--orange);padding-left:8px!important}.dollynk-mod-item[data-state=mixed],.dollynk-mod-item[data-state=disabled],.dollynk-mod-item.mod-item-early{border-top-left-radius:0;border-bottom-left-radius:0}.mod-info{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;overflow:hidden}.mod-info strong{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mod-type{font-size:.8em;color:var(--400)}.mod-badge{font-size:.7em;padding:2px 6px;border-radius:3px;font-weight:700}.mod-badge.disabled{background:rgba(236,53,53,.2);color:var(--red)}.mod-actions{display:flex;gap:6px;flex-shrink:0}.mod-btn{font-weight:700;background:var(--750);border:1px solid var(--700)}.mod-group summary::-webkit-details-marker{display:none}.mod-group[open]>summary{border-bottom-left-radius:0;border-bottom-right-radius:0}.mod-group-content{background-color:rgba(0,0,0,0.2);padding:8px;border-bottom-left-radius:7px;border-bottom-right-radius:7px;display:flex;flex-direction:column;gap:4px}.mod-dropzone{border:2px dashed var(--500);padding:20px;text-align:center;border-radius:4px;cursor:pointer;transition:all .2s;background:var(--850)}.mod-dropzone.dragover,.mod-dropzone:hover{border-color:var(--blue)}.mod-form{display:flex;flex-direction:column;gap:10px}.mod-form input[type=text],.mod-form textarea{width:100%;box-sizing:border-box}.dollynk-label{display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px}.mod-notice{display:flex;justify-content:space-between;align-items:center;padding:10px;background:rgba(242,133,0,.1);border:1px solid var(--orange);border-radius:4px;color:var(--orange);font-weight:700}.hidden{display:none}#mod-staged-files .settingsToggleItem{justify-content:space-between;display:flex}.link-blue{color:var(--link);text-decoration:underline;cursor:pointer}#mod-list-section .drag-over{border-top:2px solid var(--blue)!important}.dollynk-composite-button{display:flex;border:1px solid var(--700);border-radius:4px}.dollynk-composite-toggle{width:30px;cursor:pointer;background-color:var(--red);border-radius:3px 0 0 3px}.dollynk-composite-button.enabled .dollynk-composite-toggle{background-color:var(--green)}.dollynk-composite-main{flex-grow:1;border:none;background:var(--750);color:var(--000);cursor:pointer;border-left:1px solid var(--700)}.asset-path{font-family:monospace;margin-left:1em}.mod-badge{background:rgba(242,133,0,.2);color:var(--orange)}.expand-toggle{cursor:pointer;padding:0 5px}.asset-folder-list{margin-top:10px;padding:10px;background:var(--800);border-radius:4px;max-height:300px;overflow-y:auto}.folder-tree{font-family:monospace;font-size:.9em}</style><div class="dollynk-manager-container"><div id="mod-reload-actions" class="mod-notice" style="display:none;"><span>⚠ Changes require a reload to take effect.</span><button data-action="reload-page">Apply & Reload</button></div><div id="dollynk-main-screen"><div class="settingsHeader options">Settings</div><div class="dollynk-grid-header"><div class="header-col-left"><div class="mod-dropzone" data-action="browse">Drop files here, or <a href="#" class="link-blue">Browse</a></div><div id="mod-staged-files"></div><div class="settingsGrid" style="grid-template-columns:1fr 1fr"><button data-action="install-staged">Install Staged</button><button data-action="show-form" data-form="mod-manual-form">New</button></div></div><div class="header-col-right"><button data-action="enable-all">Enable All</button><button data-action="disable-all">Disable All</button><button data-action="export-all">Export Backup</button><button data-action="import-all">Import Backup</button><div id="dollynk-assets-control-container"></div></div></div><hr style="width:100%;border-color:var(--700);"><div class="settingsHeader options">Mods</div><div id="mod-list-section" class="dollynk-list-container"></div></div><div id="mod-manual-form" class="mod-form hidden"><div class="settingsHeader options" id="form-header">Add Mod Manually</div><input id="mod-name-input" type="text" placeholder="GroupName/FileName.ext"><label class="dollynk-label"><input type="checkbox" id="mod-earlyload-check">Load before game starts</label><textarea id="mod-code-input" rows="20" placeholder="Paste mod code here"></textarea><div class="settingsGrid"><button data-action="save-manual">Save Mod</button><button data-action="reset-form">Cancel</button></div></div></div>`; }
    };

    /* ANCHOR: Event Handling */
    const Events = {
        bind(container) {
            container.addEventListener('toggle', e => { const g = e.target.dataset.groupName; if (g) { if (e.target.open) state.openGroups.add(g); else state.openGroups.delete(g); Storage.saveOpenGroups(); } }, true);
            container.addEventListener('click', e => { const action = e.target.dataset.action || e.target.closest('[data-action]')?.dataset.action; if (!action) return; const modId = e.target.closest('[data-mod-id]')?.dataset.modId; const groupId = e.target.closest('[data-group]')?.dataset.group; this._handlers[action]?.(modId, groupId, e); });
            UI.dom.dropzone.addEventListener('dragover', e => { e.preventDefault(); UI.dom.dropzone.classList.add('dragover'); });
            UI.dom.dropzone.addEventListener('dragleave', () => UI.dom.dropzone.classList.remove('dragover'));
            UI.dom.dropzone.addEventListener('drop', e => { e.preventDefault(); UI.dom.dropzone.classList.remove('dragover'); FileHandler.stage(Array.from(e.dataTransfer.files)); }); this.bindDragDrop(UI.dom.list);
        },
        bindDragDrop(container) {
            let dragTarget = null; const cleanup = () => { dragTarget?.classList.remove('drag-over'); dragTarget = null; };
            container.addEventListener('dragstart', e => { const t = e.target.closest('[draggable=true]'); if (!t) { e.preventDefault(); return; } e.dataTransfer.setData('text/plain', t.dataset.modId ? `mod:${t.dataset.modId}` : `group:${t.dataset.groupName}`); });
            container.addEventListener('dragover', e => { e.preventDefault(); const t = e.target.closest('[draggable=true]'); if (t && t !== dragTarget) { cleanup(); t.classList.add('drag-over'); dragTarget = t; } });
            container.addEventListener('dragleave', e => { if (!e.currentTarget.contains(e.relatedTarget)) cleanup(); });
            container.addEventListener('drop', e => { e.preventDefault(); const dragged = e.dataTransfer.getData('text/plain'); const targetEl = e.target.closest('[draggable=true]'); cleanup(); if (!targetEl || !dragged) return; const target = targetEl.dataset.modId ? `mod:${targetEl.dataset.modId}` : `group:${targetEl.dataset.groupName}`; if (dragged !== target) ModActions.reorder(dragged, target); });
        },
        _handlers: {
            'show-form': (_, __, e) => UI.showForm(e.target.dataset.form), 'reset-form': () => UI.resetForm(), 'browse': (_, __, e) => { e.preventDefault(); FileHandler.browse(); }, 'toggle-mod': (id) => ModActions.toggle(id), 'edit-mod': (id) => ModActions.edit(id), 'delete-mod': (id) => ModActions.delete(id), 'export-mod': (id) => ModActions.exportMod(id), 'toggle-group': (_, id) => ModActions.toggleGroup(id), 'delete-group': (_, id) => ModActions.deleteGroup(id), 'rename-group': (_, id) => ModActions.renameGroup(id), 'export-group': (_, id, e) => ModActions.exportGroup(id, e.target), 'add-to-group': (_, id) => ModActions.addToGroup(id), 'save-manual': () => ModActions.saveManual(), 'install-staged': () => FileHandler.installStaged(), 'export-all': () => Storage.exportAll(),
            'import-all': () => { const i = U_DOCUMENT.createElement('input'); i.type = 'file'; i.accept = '.json,.json5'; i.onchange = e => e.target.files[0] && Storage.importAll(e.target.files[0]); i.click(); },
            'unstage-file': (_, __, e) => FileHandler.unstage(e.target.dataset.index), 'enable-all': () => ModActions.setAllEnabled(true), 'disable-all': () => ModActions.setAllEnabled(false), 'reload-page': () => U_WINDOW.location.reload(),
        }
    };

    /* ANCHOR: Core Mod Logic */
    const TweeProcessor = {
        inject(content, storyData, source) {
            const fragment = U_DOCUMENT.createDocumentFragment(); const trimmedContent = '\n' + content.trim(); let count = 0; const passages = trimmedContent.split(/\n::/m);
            for (let i = 1; i < passages.length; i++) {
                const text = passages[i]; if (!text.trim()) continue; const passageData = this._parsePassage(text, source);
                if (passageData) { this._injectPassage(passageData, storyData, fragment); count++; }
            }
            if (fragment.childNodes.length > 0) storyData.appendChild(fragment); return count;
        },
        _parsePassage(text, source) {
            const lineEnd = text.indexOf('\n'); const header = (lineEnd > -1 ? text.slice(0, lineEnd) : text).trim(); let content = lineEnd > -1 ? text.slice(lineEnd + 1).trim() : '';
            const match = header.match(/^(.*?)(?:\s*\[(.*?)\])?(?:\s*\{.*?\})?$/);
            if (!match?.[1]) { console.warn(`[⚠️ DoLlynk] Invalid Twee Header in ${source}: ${header}`); return null; }
            if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1); return { name: match[1].trim(), tags: match[2]?.trim() || '', content };
        },
        _injectPassage({ name, tags, content }, storyData, fragment) {
            const existing = storyData.querySelector(`tw-passagedata[name="${name}"]`);
            if (existing) {
                existing.textContent = content; if (tags) existing.setAttribute('tags', tags); else existing.removeAttribute('tags'); existing.setAttribute('pid', `mod_${crypto.randomUUID()}`);
            } else {
                const el = U_DOCUMENT.createElement('tw-passagedata'); el.setAttribute('name', name); el.setAttribute('pid', `mod_${crypto.randomUUID()}`);
                if (tags) el.setAttribute('tags', tags); el.textContent = content; fragment.appendChild(el);
            }
        }
    };
    const PassagePatcher = {
        apply(patch, passageMap) {
            const results = { success: 0, failed: 0 }; const targets = [];
            if (patch.method === 'regex') { const nameRegex = new RegExp(patch.name); for (const name of passageMap.keys()) { if (nameRegex.test(name)) targets.push(passageMap.get(name)); } }
            else { const el = passageMap.get(patch.name); if (el) targets.push(el); }
            if (!targets.length) { results.failed = 1; return results; }
            for (const el of targets) {
                const content = el.textContent;
                if (patch.method === 'replace') { el.textContent = patch.replace; results.success++; continue; }
                const isRegex = patch.isRegex || patch.method === 'regex'; const findExpr = isRegex ? new RegExp(patch.find, 'g') : patch.find;
                const hasMatch = isRegex ? findExpr.test(content) : content.includes(findExpr);
                if (hasMatch) { el.textContent = content.replaceAll(findExpr, patch.replace); results.success++; } else { results.failed++; }
            } return results;
        }
    };
    const ModProcessor = {
        async applyAll(storyData) {
            if (U_WINDOW.DoLlynk.preprocessors?.length > 0) {
                console.log(`[🦚 DoLlynk] Running ${U_WINDOW.DoLlynk.preprocessors.length} API pre-processors...`);
                for (const processor of U_WINDOW.DoLlynk.preprocessors) { try { processor(state); } catch (e) { console.error('[❌ DoLlynk] Pre-processor failed:', e); } }
            }
            const allMods = [...systemMod, ...state.mods.filter(m => m.enabled)]; if (!allMods.length) return;
            const passageMap = new Map(Array.from(storyData.querySelectorAll('tw-passagedata')).map(p => [p.getAttribute('name'), p]));
            UI.showLoader('Phase 1: Twee Injection'); let injectedPassageCount = 0; const fragment = U_DOCUMENT.createDocumentFragment();
            for (const mod of allMods) { if (mod.type === 'twee') { injectedPassageCount += TweeProcessor.inject(mod.code, fragment, `${mod.groupName || ''}/${mod.name}`); } }
            if (injectedPassageCount > 0) {
                storyData.appendChild(fragment); for (const p of fragment.querySelectorAll('tw-passagedata')) { passageMap.set(p.getAttribute('name'), p); }
                console.log(`[✓ DoLlynk Twee] Injected ${injectedPassageCount} passages.`);
            }
            UI.showLoader('Phase 2: Patching');
            for (const mod of allMods) { if (mod.type === 'unified-patch') this._applyUnifiedPatches(mod, passageMap); }
            UI.showLoader('Phase 3: Scripts & Styles');
            for (const mod of allMods) { if (mod.type === 'js' && mod.earlyLoad) this._injectScript(mod, 'early'); if (mod.type === 'css') this._injectStyle(mod); }
        },
        _applyUnifiedPatches(mod, passageMap) {
            let stats = { pass: 0, fail: 0, style: 0, failed: [] };
            try {
                const patches = JSON5.parse(mod.code);
                for (const patch of patches) {
                    if (patch.findFile) { const f = state.mods.find(m => m.groupName === mod.groupName && ModActions._getFileNameFromMod(m) === patch.findFile); if (f) patch.find = f.code; }
                    if (patch.replaceFile) { const f = state.mods.find(m => m.groupName === mod.groupName && ModActions._getFileNameFromMod(m) === patch.replaceFile); if (f) patch.replace = f.code; }
                    switch (patch.role) {
                        case 'passage': { const r = PassagePatcher.apply(patch, passageMap); stats.pass += r.success; stats.fail += r.failed; if (r.failed > 0) stats.failed.push(patch.name || `find: "${String(patch.find).substring(0, 30)}..."`); break; }
                        case 'style': this._injectStyle({ ...mod, code: patch.replace, id: `${mod.id}-${patch.name}` }); stats.style++; break;
                    }
                }
                if (stats.pass + stats.style > 0 && stats.fail === 0) console.log(`[✓ DoLlynk Patch] ${mod.name}: Applied ${stats.pass + stats.style} item(s)`);
                if (stats.fail > 0) { console.warn(`[⚠️ DoLlynk Patch] ${mod.name}: Failed to apply ${stats.fail} patch(es).`); stats.failed.forEach(n => console.warn(`  └─ Patch: "${n}"`)); }
            } catch (e) { console.error(`[❌ DoLlynk] Error parsing patch file "${mod.name}":`, e); }
        },
        injectRuntime() {
            const runtimeMods = state.mods.filter(m => m.enabled && !m.earlyLoad && m.type === 'js');
            for (const mod of runtimeMods) { this._injectScript(mod, 'runtime'); }
            if (runtimeMods.length) console.log(`[✓ DoLlynk] All mods processed. Injecting ${runtimeMods.length} runtime scripts.`);
        },
        _injectScript(mod, phase) { const s = U_DOCUMENT.createElement('script'); s.id = `dol-mod-js-${phase}-${mod.id}`; s.textContent = `try{${mod.code}}catch(e){console.error('[❌ DoLlynk] Script Error in ${mod.name} (${phase}):',e)}`; U_DOCUMENT.head.appendChild(s); },
        _injectStyle(mod) { const s = U_DOCUMENT.createElement('style'); s.id = `dol-mod-css-${mod.id}`; s.textContent = mod.code; U_DOCUMENT.head.appendChild(s); }
    };

// ANCHOR: Platform-Specific
    const PlatformPatcher = {
        applyTwineScriptPatches(twineScript) {
            if (U_WINDOW._dollynk_script_patched) return;
            U_WINDOW._dollynk_script_patched = true;

            const patches = state.mods.filter(m => m.enabled && m.type === 'unified-patch');
            if (!patches.length) return;

            let content = twineScript.textContent, patchedTotal = 0, log = [];
            for (const mod of patches) {
                let modPatched = 0;
                try {
                    const scriptPatches = JSON5.parse(mod.code).filter(p => p.role === 'script');
                    for (const patch of scriptPatches) {
                        const isRegex = patch.method === 'regex';
                        let occurrences = 0;
                        try {
                            occurrences = isRegex ? (content.match(new RegExp(patch.find, 'g')) || []).length : content.split(patch.find).length - 1;
                        } catch (e) {
                            console.error(`[❌ DoLlynk] Invalid Regex in "${mod.name}": `, patch.find);
                            continue;
                        }

                        if (occurrences > 5) {
                            console.warn(`[🛡️ DoLlynk] Skipped generic script patch in "${mod.name}" (over 5 matches for: ${patch.find})`);
                            continue;
                        }
                        if (occurrences > 0) {
                            content = isRegex ? content.replace(new RegExp(patch.find, 'g'), patch.replace) : content.replaceAll(patch.find, patch.replace);
                            modPatched++;
                            patchedTotal++;
                        }
                    }
                    if (modPatched > 0) log.push(`${mod.name}: ${modPatched}`);
                } catch (e) {
                    console.error(`[❌ DoLlynk] Error parsing script patches in ${mod.name}:`, e);
                }
            }

            if (patchedTotal > 0) {
                try {
                    new Function(content);
                    twineScript.textContent = content;
                    console.log(`[✓ DoLlynk Scripting] Applied ${patchedTotal} early-load patches from [${log.join(', ')}]`);
                } catch (err) {
                    console.error(`[❌ DoLlynk] FATAL SCRIPT ERROR post-patching. Game may not load.`, err);
                }
            }
        }
    };

/* ANCHOR: Initialization & Execution */
    await Storage.loadSettings();
    await Assets.initialize();
    await Storage.loadMods();

    async function initializeModSystem(sugarcubeScript, parent) {
        const storyData = U_DOCUMENT.querySelector('tw-storydata');
        if (!storyData) return;

        UI.showLoader('Initializing mod system...');
        try {
            await Storage.loadOpenGroups();
            await ModProcessor.applyAll(storyData);
            const twineScript = U_DOCUMENT.getElementById('twine-user-script');
            if (twineScript) {
                PlatformPatcher.applyTwineScriptPatches(twineScript);
            } else {
                console.warn('[⚠️ DoLlynk] Could not find #twine-user-script to patch.');
            }

            parent.appendChild(sugarcubeScript);
            UI.hideLoader();
            (U_WINDOW.jQuery || U_WINDOW.$)(U_DOCUMENT).one(':storyready', () => ModProcessor.injectRuntime());
        } catch (err) {
            console.error('[❌ DoLlynk] Fatal initialization error:', err);
            UI.showLoader('Critical error - check console');
        }
    }

    const observer = new MutationObserver((mutations, obs) => {
        for (const { addedNodes } of mutations) {
            for (const node of addedNodes) {
                if (node.nodeName === 'SCRIPT' && node.id === 'script-sugarcube') {
                    obs.disconnect();
                    const parent = node.parentNode;
                    node.remove();
                    initializeModSystem(node, parent);
                    return;
                }
            }
        }
    });

    observer.observe(U_DOCUMENT.documentElement, { childList: true, subtree: true });

    U_DOCUMENT.addEventListener('keydown', (e) => { if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'm') { e.preventDefault(); e.stopPropagation(); try { UI.forceInjectManager(); } catch (err) { console.error('[❌ DoLlynk] Failsafe UI Error:', err); } } }, true);

    U_WINDOW.DoLlynk = { state, UI, ModActions, FileHandler, Storage, Events, Assets, preprocessors: [] };
})();
