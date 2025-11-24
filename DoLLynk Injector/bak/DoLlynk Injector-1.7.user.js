// ==UserScript==
// @name          DoLlynk Injector
// @namespace     https://github.com/Llynkurin
// @version       1.7
// @description   Inline mod injector based on Lyoko-Jeremie/sugarcube-2-ModLoader's method of injecting viia startup
// @author        Llynkurin
// @match         file:///*Degrees%20of%20Lewity*.html*
// @match         file:///*degrees-of-lewdity*.html*
// @match         file:///*Degrees*of*Lewdity*.html*
// @match         https://*.dolmods.net/*
// @match         file:///*DoL*.html*
// @icon          https://www.google.com/s2/favicons?sz=64&domain=vrelnir.blogspot.com
// @grant         none
// @require       https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @require       https://cdn.jsdelivr.net/npm/json5@2.2.3/dist/index.min.js
// @run-at        document-start
// ==/UserScript==

(function () {
    'use strict';

    /* ANCHOR: State & Utilities */
    const state = {
        mods: [],
        stagedFiles: [],
        editingId: null,
        needsReload: false,
        openGroups: new Set()
    };

    const JSPatcher = {
        _queue: [],
        queue(patch) { this._queue.push(patch); }
    };

    const Storage = {
        load: () => {
            const mods = JSON.parse(localStorage.getItem('dol_modloader_mods_v4')) || [];
            mods.forEach((mod, index) => { if (typeof mod.order !== 'number') mod.order = index; });
            mods.sort((a, b) => a.order - b.order);
            return mods;
        },
        save: () => localStorage.setItem('dol_modloader_mods_v4', JSON.stringify(state.mods)),
        exportAll() {
            if (!state.mods.length) return alert('No mods to export');
            const blob = new Blob([JSON.stringify(state.mods, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `dollynk_backup_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        },
        importAll(file) {
            const reader = new FileReader();
            reader.onload = e => {
                try {
                    const imported = JSON5.parse(e.target.result);
                    if (!Array.isArray(imported)) throw new Error('Invalid format');
                    if (confirm(`Replace all ${state.mods.length} mods with ${imported.length} from "${file.name}"?`)) {
                        state.mods = imported;
                        state.needsReload = true;
                        Storage.save();
                        UI.updateModList();
                        alert('Import complete - reload required');
                    }
                } catch (err) { alert(`Import failed: ${err.message}`); }
            };
            reader.readAsText(file);
        }
    };

    /* ANCHOR: Twee Injection */
    const TweeProcessor = {
        inject(content, storyData, source) {
            const passages = ('\n' + content.trim()).split(/\n::/m).filter(p => p.trim());
            if (!passages.length) {
                console.warn(`[DoLlynk] No passages found in ${source}`);
                return;
            }
            let count = 0;
            for (const text of passages) {
                const passage = this._parsePassage(text, source);
                if (passage) {
                    this._injectPassage(passage, storyData);
                    count++;
                }
            }
            if (count) console.log(`[DoLlynk] Injected ${count} passage(s) from ${source}`);
        },
        _parsePassage(text, source) {
            const lineEnd = text.indexOf('\n');
            const header = (lineEnd > -1 ? text.slice(0, lineEnd) : text).trim();
            let content = lineEnd > -1 ? text.slice(lineEnd + 1).trim() : '';
            const match = header.match(/^(.*?)(?:\s*\[(.*?)\])?(?:\s*\{.*?\})?$/);
            if (!match?.[1]) {
                console.warn(`[DoLlynk] Invalid passage header in ${source}: ${header}`);
                return null;
            }
            if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
            return { name: match[1].trim(), tags: match[2]?.trim() || '', content };
        },
        _injectPassage({ name, tags, content }, storyData) {
            storyData.querySelector(`tw-passagedata[name="${name}"]`)?.remove();
            const el = document.createElement('tw-passagedata');
            el.setAttribute('name', name);
            el.setAttribute('pid', `mod_${crypto.randomUUID()}`);
            if (tags) el.setAttribute('tags', tags);
            el.textContent = content;
            storyData.appendChild(el);
        }
    };

    /* ANCHOR: Passage Patches */
    const PassagePatcher = {
        apply(patch, passages) {
            const targetPassages = patch.method === 'regex'
                ? passages.filter(p => new RegExp(patch.name).test(p.getAttribute('name')))
                : passages.filter(p => p.getAttribute('name') === patch.name);

            if (!targetPassages.length) {
                if (patch.method !== 'regex') console.warn(`[DoLlynk] Passage not found for patching: "${patch.name}"`);
                return;
            }

            for (const el of targetPassages) {
                let content = el.textContent;
                const passageName = el.getAttribute('name');

                if (patch.method === 'replace') {
                    el.textContent = patch.replace;
                    console.log(`[DoLlynk] ✓ Passage replaced: ${passageName}`);
                    continue;
                }

                const findRegex = (patch.method === 'regex' || patch.isRegex) ? new RegExp(patch.find, 'g') : null;
                let applied = false;

                if (findRegex) {
                    if (findRegex.test(content)) {
                        el.textContent = content.replace(findRegex, patch.replace);
                        applied = true;
                    } else {
                        console.warn(`[DoLlynk] Regex patch target not found in "${passageName}"`, patch.find);
                    }
                } else {
                    if (content.includes(patch.find)) {
                        el.textContent = content.replaceAll(patch.find, patch.replace);
                        applied = true;
                    } else {
                        console.warn(`[DoLlynk] String patch target not found in "${passageName}"`, patch.find);
                    }
                }
                if (applied) console.log(`[DoLlynk] ✓ Passage patch applied to: ${passageName}`);
            }
        }
    };

    /* ANCHOR: Widget Patching */
    const WidgetSystem = {
        apply(patch, storyData) {
            const { name: widgetName, method, replace } = patch;
            const original = `${widgetName}_dollynk_original_${Date.now()}`;
            if (!this._renameWidget(storyData, widgetName, original)) {
                console.warn(`[DoLlynk] Widget not found for override: ${widgetName}`);
                return;
            }

            const parts = [`<<widget "${widgetName}">>`];
            if (method === 'prefix' || method === 'prepend') {
                parts.push(replace);
            }
            parts.push(`<<${original}>>`);
            if (method === 'postfix' || method === 'append') {
                parts.push(replace);
            }
            parts.push(`<</widget>>`);
            const code = parts.join('');

            const passage = document.createElement('tw-passagedata');
            passage.setAttribute('name', `widget_override_${widgetName}_${Date.now()}`);
            passage.setAttribute('tags', 'widget');
            passage.textContent = code;
            storyData.appendChild(passage);
            console.log(`[DoLlynk] ✓ Widget '${method}' applied to: ${widgetName}`);
        },
        _renameWidget(storyData, oldName, newName) {
            const passages = storyData.querySelectorAll('tw-passagedata[tags~="widget"]');
            const regex = new RegExp(`<<widget\\s+["']${oldName}["']?\\s*>>`, 'i');
            for (const passage of passages) {
                if (regex.test(passage.textContent)) {
                    passage.textContent = passage.textContent.replace(regex, `<<widget "${newName}">>`);
                    return true;
                }
            }
            return false;
        }
    };

    /* ANCHOR: UI */
    const UI = {
        initInGame() {
            const observer = new MutationObserver(mutations => {
                for (const mutation of mutations) {
                    if (mutation.addedNodes.length > 0) {
                        const overlay = document.getElementById('customOverlayContent');
                        if (overlay && !document.getElementById('mod-manager-wrapper')) {
                            const header = overlay.querySelector('.settingsHeader');
                            if (header?.textContent.includes('Advanced Settings')) {
                                this.injectManager(overlay);
                                break;
                            }
                        }
                    }
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        },
        injectManager(container) {
            this._hookCloseOverlay();
            const wrapper = document.createElement('div');
            wrapper.id = 'mod-manager-wrapper';
            wrapper.innerHTML = this._getManagerHTML();
            container.appendChild(wrapper);
            Events.bind();
            this.updateModList();
        },
        forceInjectManager() {
            let overlay = document.getElementById('customOverlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'customOverlay';
                overlay.className = 'overlay';
                document.body.appendChild(overlay);
            }

            let content = document.getElementById('customOverlayContent');
            if (!content) {
                content = document.createElement('div');
                content.id = 'customOverlayContent';
                overlay.appendChild(content);
            }

            if (!document.getElementById('mod-manager-wrapper')) {
                content.innerHTML = '<div class="settingsGrid"><div class="settingsHeader options">Mod Manager (Failsafe)</div></div><hr>';
                this.injectManager(content);
            }

            overlay.style.display = 'block';
            if (typeof window.closeOverlay !== 'function' || !window.closeOverlay.toString().includes('dollynk')) {
                this._hookCloseOverlay();
            }
        },
        _hookCloseOverlay() {
            if (window._dollynk_closeHooked) return;
            window._dollynk_closeHooked = true;
            const original = window.closeOverlay;
            window.closeOverlay = function () {
                if (state.needsReload) {
                    if (confirm('Mod changes require reload. Reload now?')) {
                        location.reload();
                    } else {
                        state.needsReload = false;
                        if (document.getElementById('mod-manager-wrapper')) UI.updateModList();
                    }
                }
                original?.();
            };
        },
        updateModList() {
            const container = document.getElementById('mod-list-section');
            if (!container) return;
            const { standalone, groups } = this._categorize();
            const html = [
                ...standalone.map(m => this._renderMod(m)),
                ...Array.from(groups.entries()).map(([name, mods]) => this._renderGroup(name, mods))
            ].join('');
            container.innerHTML = html || '<span>No mods installed. Drag files onto the page to begin.</span>';
            const notice = document.getElementById('mod-reload-notice');
            if (notice) notice.style.display = state.needsReload ? 'block' : 'none';
        },
        _categorize() {
            const standalone = [], groups = new Map();
            for (const mod of state.mods) {
                if (mod.groupName) {
                    if (!groups.has(mod.groupName)) groups.set(mod.groupName, []);
                    groups.get(mod.groupName).push(mod);
                } else { standalone.push(mod); }
            }
            return { standalone, groups };
        },
        _renderMod(mod) {
            const typeLabels = { 'unified-patch': 'Patches', js: 'JS', css: 'CSS', twee: 'Twee' };
            const typeLabel = typeLabels[mod.type] || (mod.type ? mod.type.toUpperCase() : 'INVALID');
            return `
                <div class="mod-item ${mod.earlyLoad ? 'mod-item-early' : ''}" data-mod-id="${mod.id}" data-state="${mod.enabled ? 'enabled' : 'disabled'}" draggable="true">
                    <span class="mod-info">
                        ${mod.name}
                        <span class="mod-type">${typeLabel}</span>
                        ${mod.enabled ? '' : '<span class="mod-badge disabled">OFF</span>'}
                        ${typeLabel === 'INVALID' ? '<span class="mod-badge disabled">CORRUPT</span>' : ''}
                    </span>
                    <span class="mod-actions">
                        <button data-action="toggle-mod">${mod.enabled ? 'Disable' : 'Enable'}</button>
                        <span class="mod-btn" data-action="edit-mod" title="Edit">⨺</span>
                        <span class="mod-btn" data-action="delete-mod" title="Delete">✕</span>
                    </span>
                </div>`;
        },
        _renderGroup(name, mods) {
            const allEnabled = mods.every(m => m.enabled);
            const isOpen = state.openGroups.has(name);
            return `
                <details class="mod-group" data-state="${allEnabled ? 'enabled' : 'mixed'}" ${isOpen ? 'open' : ''} draggable="true">
                    <summary data-group="${name}">
                        <strong>${name}</strong>
                        ${allEnabled ? '' : '<span class="mod-badge disabled">MIX</span>'}
                        <span class="mod-actions">
                            <button data-action="toggle-group" data-group="${name}">${allEnabled ? 'Disable All' : 'Enable All'}</button>
                            <span class="mod-btn" data-action="export-group" data-group="${name}" title="Export Group as ZIP">ZIP</span>
                            <span class="mod-btn" data-action="rename-group" data-group="${name}" title="Rename Group">✎</span>
                            <span class="mod-btn" data-action="add-to-group" data-group="${name}" title="Add to Group">+</span>
                            <span class="mod-btn" data-action="delete-group" data-group="${name}" title="Delete Group">✕</span>
                        </span>
                    </summary>
                    <div class="mod-group-content">${mods.map(m => this._renderMod(m)).join('')}</div>
                </details>`;
        },
        showLoader(text) {
            let loader = document.getElementById('dollynk-loader');
            if (!loader) {
                loader = document.createElement('div');
                loader.id = 'dollynk-loader';
                loader.innerHTML = `<div class="loader-content"><div class="loader-title">DoLlynk</div><div class="loader-status"></div></div>`;
                document.documentElement.appendChild(loader);
            }
            loader.querySelector('.loader-status').textContent = text;
        },
        hideLoader: () => document.getElementById('dollynk-loader')?.remove(),
        showForm(formId) {
            document.getElementById('mod-main-actions').classList.add('hidden');
            document.querySelectorAll('.mod-form').forEach(f => f.classList.add('hidden'));
            document.getElementById(formId).classList.remove('hidden');
        },
        resetForm() {
            document.getElementById('mod-main-actions').classList.remove('hidden');
            document.querySelectorAll('.mod-form').forEach(f => f.classList.add('hidden'));
            state.editingId = null;
            document.getElementById('mod-name-input').value = '';
            document.getElementById('mod-code-input').value = '';
            document.getElementById('mod-earlyload-check').checked = false;
            document.querySelector('#form-header').textContent = 'Add Mod Manually';
        },
        _getManagerHTML() { return `${this._getStyles()}<hr><div class="mod-manager"><div class="mod-left"><div class="settings-header">Mod List</div><div id="mod-list-section"></div><div id="mod-reload-notice" class="mod-notice" style="display:none">⚠ Page reload required to apply changes</div></div><div class="mod-right"><div id="mod-main-actions"><div class="settings-header">Mod Settings</div><div class="mod-action-grid"><button data-action="show-form" data-form="mod-file-form">From File</button><button data-action="show-form" data-form="mod-manual-form">Manually</button><button data-action="enable-all">Enable ALL</button><button data-action="disable-all">Disable ALL</button><button data-action="export-all">Export Backup</button><button data-action="import-all">Import Backup</button></div></div><div id="mod-file-form" class="mod-form hidden"><div class="settings-header">Add Mod from File</div><div class="mod-dropzone">Drop files here, or <a href="#" class="link-blue" data-action="browse">Browse</a></div><div id="mod-staged-files"></div><div class="mod-action-grid"><button data-action="install-staged">Install Staged</button><button data-action="reset-form">Cancel</button></div></div><div id="mod-manual-form" class="mod-form hidden"><div class="settings-header" id="form-header">Add Mod Manually</div><input id="mod-name-input" type="text" placeholder="GroupName/FileName.ext"><label><input type="checkbox" id="mod-earlyload-check">Load before game starts (widgets & dependencies)</label><textarea id="mod-code-input" rows="8" placeholder="Paste mod code here"></textarea><div class="mod-action-grid"><button data-action="save-manual">Save Mod</button><button data-action="reset-form">Cancel</button></div></div></div></div>`; },
        _getStyles() { return `<style>#dollynk-loader{position:fixed;inset:0;background:#1a1a1a;z-index:99999;display:flex;align-items:center;justify-content:center;color:#fff;font-family:monospace}.loader-content{text-align:center}.loader-title{font-size:24px;margin-bottom:10px}.mod-manager{display:flex;gap:20px;margin-top:15px}.mod-left{flex:3;min-width:0}.mod-right{flex:2;min-width:0}.mod-item,.mod-group summary{display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;background:rgba(0,0,0,.2);padding:8px;border-radius:4px;transition:background .2s}.mod-item:hover,.mod-group summary:hover{background:rgba(0,0,0,.3)}.mod-item[draggable=true],.mod-group[draggable=true]>summary{cursor:move}.mod-item.mod-item-early{border-left:2px solid #f28500;padding-left:6px}.mod-item[data-state=disabled],.mod-group[data-state=mixed]{opacity:.5}.mod-info{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.mod-type{font-size:.75em;color:#aaa}.mod-badge{font-size:.7em;padding:2px 6px;border-radius:3px;font-weight:700}.mod-badge.disabled{background:rgba(236,53,53,.2);color:#ec3535}.mod-actions{display:flex;gap:6px;align-items:center}.mod-actions button{padding:4px 12px;cursor:pointer}.mod-btn{cursor:pointer;padding:4px 8px;background:rgba(255,255,255,.1);border-radius:3px;font-weight:700;transition:background .2s}.mod-btn:hover{background:rgba(255,255,255,.2)}.mod-group{margin-bottom:8px}.mod-group summary{list-style:none}.mod-group summary::-webkit-details-marker{display:none}.mod-group-content{padding-left:20px;border-left:2px solid #555;margin-top:5px}.mod-dropzone{border:2px dashed #888;padding:20px;text-align:center;border-radius:4px;margin-bottom:10px;cursor:pointer;transition:all .2s}.mod-dropzone.dragover,.mod-dropzone:hover{border-color:#4372ff}.mod-dropzone.dragover{background:rgba(67,114,255,.1)}.mod-action-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.mod-action-grid button{padding:8px;cursor:pointer}.mod-form{display:flex;flex-direction:column;gap:10px}.mod-form input[type=text],.mod-form textarea{width:100%;box-sizing:border-box;padding:8px;background:#222;border:1px solid #666;color:#eee;border-radius:4px}.mod-form label{display:flex;align-items:center;gap:8px;cursor:pointer}.mod-notice{margin-top:10px;padding:10px;background:rgba(242,133,0,.1);border:1px solid #f28500;border-radius:4px;color:#f28500;text-align:center;font-weight:700}.hidden{display:none}.settings-header{font-weight:700;margin-bottom:10px;font-size:1.1em}.link-blue{color:#5888dd;text-decoration:underline;cursor:pointer}.link-blue:hover{color:#8af}#mod-list-section .drag-over{border-top:2px solid #4372ff;background:rgba(67,114,255,.1)}</style>`; }
    };

    /* ANCHOR: Event Handling */
    const Events = {
        bind() {
            const container = document.getElementById('mod-manager-wrapper');
            if (!container) return;
            container.addEventListener('toggle', e => {
                const details = e.target;
                if (!details.classList.contains('mod-group')) return;
                const groupName = details.querySelector('summary')?.dataset.group;
                if (groupName) {
                    if (details.open) state.openGroups.add(groupName);
                    else state.openGroups.delete(groupName);
                }
            }, true);
            container.addEventListener('click', e => {
                const action = e.target.dataset.action;
                if (!action) return;
                const modId = e.target.closest('.mod-item')?.dataset.modId;
                const groupId = e.target.dataset.group || e.target.closest('.mod-group')?.querySelector('summary')?.dataset.group;
                this._handlers[action]?.(modId, groupId, e);
            });
            const dropzone = container.querySelector('.mod-dropzone');
            if (dropzone) {
                dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
                dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
                dropzone.addEventListener('drop', e => {
                    e.preventDefault();
                    dropzone.classList.remove('dragover');
                    const files = Array.from(e.dataTransfer.files).filter(f => /\.(js|css|twee|json5?|zip|txt)$/i.test(f.name));
                    FileHandler.stage(files);
                });
            }
            const listSection = container.querySelector('#mod-list-section');
            if (listSection) {
                let dragTarget = null;
                listSection.addEventListener('dragstart', e => {
                    const modItem = e.target.closest('.mod-item');
                    const modGroup = e.target.closest('.mod-group');
                    if (modItem) e.dataTransfer.setData('text/plain', `mod:${modItem.dataset.modId}`);
                    else if (modGroup) e.dataTransfer.setData('text/plain', `group:${modGroup.querySelector('summary').dataset.group}`);
                    else e.preventDefault();
                });
                listSection.addEventListener('dragover', e => {
                    e.preventDefault();
                    const target = e.target.closest('.mod-item, .mod-group');
                    if (target && target !== dragTarget) {
                        dragTarget?.classList.remove('drag-over');
                        target.classList.add('drag-over');
                        dragTarget = target;
                    }
                });
                listSection.addEventListener('dragleave', e => {
                    if (!e.currentTarget.contains(e.relatedTarget)) {
                        dragTarget?.classList.remove('drag-over');
                        dragTarget = null;
                    }
                });
                listSection.addEventListener('drop', e => {
                    e.preventDefault();
                    dragTarget?.classList.remove('drag-over');
                    dragTarget = null;
                    const draggedData = e.dataTransfer.getData('text/plain');
                    const targetEl = e.target.closest('.mod-item, .mod-group');
                    if (!targetEl || !draggedData) return;
                    const targetData = targetEl.classList.contains('mod-item')
                        ? `mod:${targetEl.dataset.modId}`
                        : `group:${targetEl.querySelector('summary').dataset.group}`;
                    if (draggedData !== targetData) ModActions.reorder(draggedData, targetData);
                });
            }
        },
        _handlers: {
            'show-form': (_, __, e) => UI.showForm(e.target.dataset.form),
            'reset-form': () => UI.resetForm(),
            'browse': (_, __, e) => { e.preventDefault(); FileHandler.browse(); },
            'toggle-mod': (modId) => ModActions.toggle(modId),
            'edit-mod': (modId) => ModActions.edit(modId),
            'delete-mod': (modId) => ModActions.delete(modId),
            'toggle-group': (_, groupId) => ModActions.toggleGroup(groupId),
            'delete-group': (_, groupId) => ModActions.deleteGroup(groupId),
            'rename-group': (_, groupId) => ModActions.renameGroup(groupId),
            'export-group': (_, groupId) => ModActions.exportGroup(groupId),
            'add-to-group': (_, groupId) => ModActions.addToGroup(groupId),
            'save-manual': () => ModActions.saveManual(),
            'install-staged': () => FileHandler.installStaged(),
            'export-all': () => Storage.exportAll(),
            'import-all': () => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json';
                input.onchange = e => e.target.files[0] && Storage.importAll(e.target.files[0]);
                input.click();
            },
            'unstage-file': (_, __, e) => FileHandler.unstage(e.target.dataset.index),
            'enable-all': () => ModActions.setAllEnabled(true),
            'disable-all': () => ModActions.setAllEnabled(false),
        }
    };

    /* ANCHOR: Mod Actions */
    const ModActions = {
        toggle(modId) {
            const mod = state.mods.find(m => m.id === modId);
            if (mod) {
                mod.enabled = !mod.enabled;
                state.needsReload = true;
                Storage.save();
                UI.updateModList();
            }
        },
        toggleGroup(groupId) {
            const mods = state.mods.filter(m => m.groupName === groupId);
            if (!mods.length) return;
            const newState = !mods.every(m => m.enabled);
            mods.forEach(m => m.enabled = newState);
            state.needsReload = true;
            Storage.save();
            UI.updateModList();
        },
        setAllEnabled(enabled) {
            if (!confirm(`This will ${enabled ? 'enable' : 'disable'} all ${state.mods.length} mods. Continue?`)) return;
            state.mods.forEach(m => m.enabled = enabled);
            state.needsReload = true;
            Storage.save();
            UI.updateModList();
        },
        delete(modId) {
            if (!confirm('Delete this mod?')) return;
            state.mods = state.mods.filter(m => m.id !== modId);
            state.needsReload = true;
            Storage.save();
            if (state.editingId === modId) UI.resetForm();
            UI.updateModList();
        },
        deleteGroup(groupId) {
            if (!confirm(`Delete all mods in group "${groupId}"?`)) return;
            const before = state.mods.length;
            state.mods = state.mods.filter(m => m.groupName !== groupId);
            if (state.mods.length < before) {
                state.needsReload = true;
                Storage.save();
                UI.updateModList();
            }
        },
        renameGroup(oldName) {
            if (!oldName) return;
            const newName = prompt('Enter the new name for this group:', oldName);

            if (!newName || !newName.trim()) return;
            const trimmedNewName = newName.trim();
            if (trimmedNewName === oldName) return;

            if (state.mods.some(m => m.groupName === trimmedNewName)) {
                return alert(`A group named "${trimmedNewName}" already exists.`);
            }

            state.mods.forEach(mod => {
                if (mod.groupName === oldName) {
                    mod.groupName = trimmedNewName;
                }
            });

            if (state.openGroups.has(oldName)) {
                state.openGroups.delete(oldName);
                state.openGroups.add(trimmedNewName);
            }

            state.needsReload = true;
            Storage.save();
            UI.updateModList();
        },
        edit(modId) {
            const mod = state.mods.find(m => m.id === modId);
            if (!mod) return;
            UI.showForm('mod-manual-form');
            state.editingId = modId;
            const fullName = (mod.groupName ? `${mod.groupName}/` : '') + this._getFileNameFromMod(mod);
            document.getElementById('mod-name-input').value = fullName;
            document.getElementById('mod-code-input').value = mod.code;
            document.getElementById('mod-earlyload-check').checked = !!mod.earlyLoad;
            document.querySelector('#form-header').textContent = 'Edit Mod';
        },
        addToGroup(groupId) {
            UI.showForm('mod-manual-form');
            document.getElementById('mod-name-input').value = `${groupId}/`;
            document.querySelector('#form-header').textContent = `Add to ${groupId}`;
        },
        async saveManual() {
            const fullName = document.getElementById('mod-name-input').value.trim();
            const code = document.getElementById('mod-code-input').value;
            const earlyLoad = document.getElementById('mod-earlyload-check').checked;
            if (!fullName || !code) return alert('Name and code required');

            const isBoot = /boot\.json5?$/i.test(fullName);
            const groupName = fullName.includes('/') ? fullName.substring(0, fullName.lastIndexOf('/')) : null;

            if (state.editingId) {
                const modToUpdate = state.mods.find(m => m.id === state.editingId);
                if (!modToUpdate) { UI.resetForm(); return; }

                if (isBoot) {
                    console.log(`[DoLlynk] Re-compiling from edited boot.json...`);
                    const compiledMods = await FileHandler._processBootData(code, groupName || fullName.replace(/boot\.json5?$/i, ''));
                    state.mods = state.mods.filter(m => m.id !== state.editingId);

                    if (compiledMods.length > 0) {
                        compiledMods.forEach(mod => {
                            state.mods.push({ id: crypto.randomUUID(), ...mod, enabled: true, order: state.mods.length });
                        });
                    } else {
                        alert('boot.json did not produce any patch files. The original file was deleted.');
                    }
                } else {
                    const { type, name } = this._getTypeAndName(fullName.split('/').pop());
                    Object.assign(modToUpdate, { name, groupName, type, code, earlyLoad });
                }
            } else {
                if (isBoot) {
                    const compiledMods = await FileHandler._processBootData(code, groupName);
                    if (compiledMods.length > 0) {
                        compiledMods.forEach(mod => {
                            state.mods.push({ id: crypto.randomUUID(), ...mod, enabled: true, order: state.mods.length });
                        });
                    }
                } else {
                    const { type, name } = this._getTypeAndName(fullName.split('/').pop());
                    if (!type) return alert('Invalid file extension.');
                    state.mods.push({ id: crypto.randomUUID(), name, groupName, type, code, earlyLoad, enabled: true, order: state.mods.length });
                }
            }

            state.needsReload = true;
            Storage.save();
            UI.resetForm();
            UI.updateModList();
        },
        reorder(draggedData, targetData) {
            const [draggedType, draggedId] = draggedData.split(':');
            const [targetType, targetId] = targetData.split(':');

            const targetIndex = (targetType === 'mod')
                ? state.mods.findIndex(m => m.id === targetId)
                : state.mods.findIndex(m => m.groupName === targetId);
            if (targetIndex === -1) return;

            let itemsToMove;
            if (draggedType === 'mod') {
                const modIndex = state.mods.findIndex(m => m.id === draggedId);
                if (modIndex > -1) itemsToMove = state.mods.splice(modIndex, 1);
            } else {
                itemsToMove = state.mods.filter(m => m.groupName === draggedId);
                state.mods = state.mods.filter(m => m.groupName !== draggedId);
            }

            if (!itemsToMove || !itemsToMove.length) return;

            const newTargetIndex = (targetType === 'mod')
                ? state.mods.findIndex(m => m.id === targetId)
                : state.mods.findIndex(m => m.groupName === targetId);

            state.mods.splice(newTargetIndex, 0, ...itemsToMove);
            state.mods.forEach((mod, index) => mod.order = index);

            state.needsReload = true;
            Storage.save();
            UI.updateModList();
        },
        async exportGroup(groupId) {
            const mods = state.mods.filter(m => m.groupName === groupId);
            if (!mods.length) return;

            const zip = new JSZip();
            for (const mod of mods) {
                zip.file(this._getFileNameFromMod(mod), mod.code);
            }

            const blob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${groupId}.zip`;
            a.click();
            URL.revokeObjectURL(url);
        },
        _getFileNameFromMod(mod) {
            const extMap = { 'unified-patch': '.modpatch.json5', 'twee': '.twee', 'js': '.js', 'css': '.css' };
            const ext = extMap[mod.type] || `.${mod.type}`;
            return `${mod.name}${ext}`;
        },
        _getTypeAndName(fileName) {
            let type, name = fileName;
            if (/\.modpatch\.json5?$/i.test(fileName)) {
                type = 'unified-patch';
                name = fileName.replace(/\.modpatch\.json5?$/i, '');
            } else if (/\.twee(\.txt)?$/i.test(fileName)) {
                type = 'twee';
                name = fileName.replace(/\.twee(\.txt)?$/i, '');
            } else if (/\.js$/i.test(fileName)) {
                type = 'js';
                name = fileName.replace(/\.js$/i, '');
            } else if (/\.css$/i.test(fileName)) {
                type = 'css';
                name = fileName.replace(/\.css$/i, '');
            } else if (/\.json5?$/i.test(fileName)) {
                type = 'unified-patch';
                name = fileName.replace(/\.json5?$/i, '');
            }
            return { type, name };
        }
    };

    /* ANCHOR: File Handling */
    const FileHandler = {
        browse() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.js,.css,.twee,.json,.json5,.zip,.txt';
            input.multiple = true;
            input.onchange = e => this.stage(Array.from(e.target.files));
            input.click();
        },
        stage: files => {
            state.stagedFiles.push(...files.filter(f => !state.stagedFiles.some(s => s.name === f.name)));
            FileHandler._updateStageView();
        },
        unstage: index => {
            state.stagedFiles.splice(index, 1);
            FileHandler._updateStageView();
        },
        _updateStageView() {
            const container = document.getElementById('mod-staged-files');
            if (!container) return;
            container.innerHTML = state.stagedFiles.map((f, i) => `<div class="mod-item"><span>${f.name}</span><button data-action="unstage-file" data-index="${i}">Remove</button></div>`).join('');
        },
        async installStaged() {
            if (!state.stagedFiles.length) return;
            UI.showLoader('Installing mods...');
            for (const file of state.stagedFiles) {
                await (file.name.endsWith('.zip') ? this._installZip(file) : this._installFile(file));
            }
            state.stagedFiles = [];
            state.needsReload = true;
            Storage.save();
            UI.resetForm();
            UI.updateModList();
            UI.hideLoader();
        },
        async _installFile(file, group = null) {
            const code = await file.text();
            const isBoot = /boot\.json5?$/i.test(file.name);
            if (isBoot) {
                const groupName = group || file.name.replace(/boot\.json5?$/i, '');
                const mods = await this._processBootData(code, groupName, null);
                mods.forEach(mod => state.mods.push({ ...mod, id: crypto.randomUUID(), order: state.mods.length }));
            } else {
                const { type, name } = ModActions._getTypeAndName(file.name);
                if (!type) return;
                const mod = { name, groupName: group, type, code, earlyLoad: type !== 'js', enabled: true };
                state.mods.push({ ...mod, id: crypto.randomUUID(), order: state.mods.length });
            }
        },
        async _installZip(file) {
            try {
                const zip = await JSZip.loadAsync(file);
                const groupName = file.name.replace(/\.zip$/i, '');
                const bootFile = zip.file(/boot\.json5?$/i)[0];

                if (bootFile) {
                    const bootContent = await bootFile.async('text');
                    const modsFromBoot = await this._processBootData(bootContent, groupName, zip);
                    if (modsFromBoot.length) {
                        modsFromBoot.forEach(mod => {
                            state.mods.push({ ...mod, id: crypto.randomUUID(), order: state.mods.length });
                        });
                    }
                } else {
                    for (const path in zip.files) {
                        const entry = zip.files[path];
                        if (entry.dir) continue;

                        const fileName = entry.name.split('/').pop();
                        const { type, name } = ModActions._getTypeAndName(fileName);
                        if (!type) continue;
                        const code = await entry.async('text');
                        state.mods.push({
                            id: crypto.randomUUID(), name, groupName, type, code,
                            earlyLoad: type !== 'js', enabled: true, order: state.mods.length
                        });
                    }
                }
            } catch (err) {
                console.error('[DoLlynk] Zip install failed:', err);
                alert(`Failed to install ${file.name}: ${err.message}`);
            }
        },
        async _processBootData(bootContent, groupName, zip = null) {
            const createdMods = [];
            try {
                const bootData = JSON5.parse(bootContent);
                const modName = bootData.name || groupName;

                const processFileList = async (fileList, type) => {
                    if (!zip || !Array.isArray(fileList)) return;
                    for (const filePath of fileList) {
                        const file = zip.file(new RegExp(filePath.replace(/\\/g, '/')))[0];
                        if (!file) {
                            console.warn(`[DoLlynk] File not found in zip for ${modName}: ${filePath}`);
                            continue;
                        }
                        const code = await file.async('text');
                        const { name } = ModActions._getTypeAndName(file.name.split('/').pop());
                        createdMods.push({
                            name,
                            groupName: modName,
                            type,
                            code,
                            earlyLoad: type !== 'js',
                            enabled: true
                        });
                    }
                };

                await processFileList(bootData.styleFileList, 'css');
                await processFileList(bootData.scriptFileList, 'js');
                await processFileList(bootData.tweeFileList, 'twee');

                const patches = [];
                if (Array.isArray(bootData.addonPlugin)) {
                    for (const addon of bootData.addonPlugin) {
                        const addonName = addon.addonName;

                        if (addonName === 'TweeReplacerAddon') {
                            let collectedParams = Array.isArray(addon.params) ? [...addon.params] : [];
                            if (zip && Array.isArray(addon.paramsFiles)) {
                                for (const filePath of addon.paramsFiles) {
                                    const file = zip.file(new RegExp(filePath.replace(/\\/g, '/')))[0];
                                    if (file) {
                                        try {
                                            const external = JSON5.parse(await file.async('text'));
                                            if (Array.isArray(external)) collectedParams.push(...external);
                                        } catch (e) { console.error(`[DoLlynk] Failed parsing TweeReplacer paramsFile "${filePath}"`, e); }
                                    } else { console.warn(`[DoLlynk] TweeReplacer paramsFile not found: ${filePath}`); }
                                }
                            }

                            for (const p of collectedParams) {
                                let replaceContent = p.replace;
                                if (zip && p.replaceFile) {
                                    const file = zip.file(new RegExp(p.replaceFile.replace(/\\/g, '/')))[0];
                                    if (file) replaceContent = await file.async('text');
                                    else console.warn(`[DoLlynk] TweeReplacer replaceFile not found: ${p.replaceFile}`);
                                }
                                patches.push({
                                    role: 'passage',
                                    name: p.passage,
                                    method: p.isRegex ? 'regex' : 'string',
                                    find: p.findRegex || p.findString,
                                    replace: replaceContent
                                });
                            }

                        } else if (addonName === 'TweePrefixPostfixAddon' && addon.params && Array.isArray(addon.params.widget)) {
                            patches.push(...addon.params.widget.map(p => ({
                                role: 'widget',
                                name: p.widgetName,
                                method: p.pos === 'front' ? 'prefix' : 'postfix',
                                replace: `<<${p.widgetNamePrefix || p.widgetNamePostfix}>>`
                            })));

                        } else if (addonName === 'ReplacePatcherAddon' && typeof addon.params === 'object' && addon.params !== null) {
                            if (Array.isArray(addon.params.js)) {
                                patches.push(...addon.params.js.map(p => ({
                                    role: 'script',
                                    name: `JS patch for ${p.fileName}`,
                                    method: 'string',
                                    find: p.from,
                                    replace: p.to
                                })));
                            }
                            if (Array.isArray(addon.params.twee)) {
                                patches.push(...addon.params.twee.map(p => ({
                                    role: 'passage',
                                    name: p.passageName,
                                    method: 'string',
                                    find: p.from,
                                    replace: p.to
                                })));
                            }
                        }
                    }
                }

                if (patches.length > 0) {
                    createdMods.push({
                        name: `${modName}-patches`,
                        groupName: modName,
                        type: 'unified-patch',
                        code: JSON.stringify(patches, null, 2),
                        earlyLoad: true,
                        enabled: true
                    });
                }

                return createdMods;
            } catch (e) {
                console.error(`[DoLlynk] Failed to process boot.json for ${groupName}`, e);
                alert(`Failed to process boot.json for ${groupName}: ${e.message}`);
                return [];
            }
        }
    };

    /* ANCHOR: Mod Processor */
    const ModProcessor = {
        async applyAll(storyData) {
            const enabled = state.mods.filter(m => m.enabled);
            const passages = Array.from(storyData.querySelectorAll('tw-passagedata'));

            UI.showLoader('Phase 1: Injecting Twee...');
            enabled.filter(m => m.type === 'twee')
                .forEach(m => TweeProcessor.inject(m.code, storyData, `${m.groupName || 'standalone'}/${m.name}.twee`));

            UI.showLoader('Phase 2: Applying Patches...');
            const unifiedPatches = enabled.filter(m => m.type === 'unified-patch');
            if (unifiedPatches.length) {
                console.log(`[DoLlynk] Applying ${unifiedPatches.length} unified patch files.`);
                for (const mod of unifiedPatches) {
                    try {
                        const patches = JSON5.parse(mod.code);
                        for (const patch of patches) {
                            if (!patch.role) {
                                if (patch.passage && patch.findString !== undefined) {
                                    patch.role = 'passage';
                                    patch.name = patch.passage;
                                    patch.find = patch.findString;
                                    patch.method = patch.isRegex ? 'regex' : 'string';
                                } else if (patch.passageName && patch.from !== undefined) {
                                    patch.role = 'passage';
                                    patch.name = patch.passageName;
                                    patch.find = patch.from;
                                    patch.replace = patch.to;
                                    patch.method = 'string';
                                } else if (patch.from && patch.to) {
                                    patch.role = 'script';
                                    patch.name = 'legacy-script-patch';
                                    patch.find = patch.from;
                                    patch.replace = patch.to;
                                    patch.method = 'string';
                                }
                            }

                            switch (patch.role) {
                                case 'passage':
                                    PassagePatcher.apply(patch, passages);
                                    break;
                                case 'widget':
                                    WidgetSystem.apply(patch, storyData);
                                    break;
                                case 'script':
                                    break;
                                case 'style':
                                    this._injectStyle({ ...mod, code: patch.replace, id: `${mod.id}-${patch.name}` });
                                    break;
                                default:
                                    console.warn(`[DoLlynk] Unknown patch role in ${mod.name}:`, patch);
                            }
                        }
                    } catch (e) {
                        console.error(`Error parsing unified patch file ${mod.name}`, e);
                    }
                }
            }

            UI.showLoader('Phase 3: Injecting early scripts & styles...');
            enabled.filter(m => m.earlyLoad && m.type === 'js').forEach(m => this._injectScript(m, 'early'));
            enabled.filter(m => m.type === 'css').forEach(m => this._injectStyle(m));
        },

        injectRuntime() {
            const runtime = state.mods.filter(m => m.enabled && !m.earlyLoad && m.type === 'js');
            runtime.forEach(m => this._injectScript(m, 'runtime'));
        },

        _injectScript(mod, phase) {
            const script = document.createElement('script');
            script.id = `dol-mod-js-${phase}-${mod.id}`;
            script.textContent = phase === 'runtime'
                ? `(function(){'use strict';try{${mod.code}}catch(e){console.error('[DoLlynk] Error in ${mod.name}:',e)}})()`
                : `try{${mod.code}}catch(e){console.error('[DoLlynk] Error in ${mod.name}:',e)}`;
            document.head.appendChild(script);
        },

        _injectStyle(mod) {
            const style = document.createElement('style');
            style.id = `dol-mod-css-${mod.id}`;
            style.textContent = mod.code;
            document.head.appendChild(style);
        }
    };

    /* ANCHOR: Initialization & Execution */
    function applyPrecompPatches(twineScript) {
        if (window._dollynk_script_patched) return;
        window._dollynk_script_patched = true;
        console.log('[DoLlynk] Intercepted twine-user-script, applying pre-compilation patches...');

        state.mods = Storage.load();
        const unifiedPatches = state.mods.filter(m => m.enabled && m.type === 'unified-patch');
        for (const mod of unifiedPatches) {
            try {
                const patches = JSON5.parse(mod.code);
                patches.filter(p => p.role === 'script' || (p.from && p.to && !p.passageName)).forEach(p => {
                    JSPatcher.queue({ patch: p, modName: mod.name })
                });
            } catch (e) {
                console.error(`Error parsing ${mod.name}:`, e);
            }
        }

        if (JSPatcher._queue.length > 0) {
            console.log(`[DoLlynk] Found ${JSPatcher._queue.length} script patch(es) to apply.`);
            let content = twineScript.textContent;
            let lastAppliedPatchName = 'N/A';
            const GENERALITY_THRESHOLD = 5;

            for (const { patch, modName } of JSPatcher._queue) {
                lastAppliedPatchName = patch.name || 'unnamed patch';
                const find = patch.find || patch.from;
                const replace = patch.replace || patch.to;
                const isRegex = patch.method === 'regex' || patch.isRegex;

                let occurrences = 0;
                try {
                    occurrences = isRegex ? (content.match(new RegExp(find, 'g')) || []).length : content.split(find).length - 1;
                } catch (e) {
                    console.error(`[DoLlynk] Invalid Regex in patch "${lastAppliedPatchName}" from mod "${modName}":`, find);
                    continue;
                }

                if (occurrences > GENERALITY_THRESHOLD) {
                    console.warn(`[DoLlynk] 🛡️ SKIPPING SCRIPT PATCH from "${modName}". Reason: Too general. Found ${occurrences} matches (threshold is ${GENERALITY_THRESHOLD}). Patch name: "${lastAppliedPatchName}".`);
                    continue;
                }

                if (occurrences === 0) {
                    console.warn(`[DoLlynk] ⚠️ Script patch not found for "${lastAppliedPatchName}" from mod "${modName}".`);
                    continue;
                }

                if (isRegex) {
                    content = content.replace(new RegExp(find, 'g'), replace);
                } else {
                    content = content.replaceAll(find, replace);
                }
                console.log(`[DoLlynk] ✓ Applied script patch "${lastAppliedPatchName}" from "${modName}" (${occurrences}x)`);
            }

            try {
                new Function(content);
                twineScript.textContent = content;
                console.log(`[DoLlynk] Script patching complete. Syntax validation passed.`);
            } catch (err) {
                console.error(`[DoLlynk] 🔴 FATAL SCRIPT ERROR 🔴`);
                console.error(`A script patch (likely "${lastAppliedPatchName}") created a JavaScript syntax error. The game will not load correctly.`);
                console.error(`REASON:`, err);
                console.warn(`The original game script will be used instead. Please disable the faulty mod and report the error.`);
                alert(`DoLlynk Injector: A mod's script patch broke the game's code. Check the developer console (F12) for details. The faulty patch is likely named "${lastAppliedPatchName}".`);
            }

            JSPatcher._queue = [];
        }
    }

    function scheduleRuntimeInjection() {
        $(document).one(':storyready', () => {
            console.log('[DoLlynk Runtime Functions 🦚]');
            ModProcessor.injectRuntime();
            UI.initInGame();
        });
    }

    async function initializeModSystem(sugarcubeScript, scriptParent) {
        const storyData = document.querySelector('tw-storydata');
        if (!storyData) {
            console.error('[DoLlynk] Critical: <tw-storydata> not found');
            return;
        }

        UI.showLoader('Initializing mod system...');
        if (!state.mods.length) state.mods = Storage.load();

        try {
            await ModProcessor.applyAll(storyData);
            scriptParent.appendChild(sugarcubeScript);
            UI.hideLoader();
            scheduleRuntimeInjection();
        } catch (err) {
            console.error('[DoLlynk] Fatal error during mod initialization:', err);
            UI.showLoader('Critical error - check console');
        }
    }

    const observer = new MutationObserver((mutations, obs) => {
        for (const { addedNodes } of mutations) {
            const twineScript = Array.from(addedNodes).find(n => n.nodeName === 'SCRIPT' && n.id === 'twine-user-script');
            if (twineScript) {
                applyPrecompPatches(twineScript);
            }

            const sugarcubeScript = Array.from(addedNodes).find(n => n.nodeName === 'SCRIPT' && n.id === 'script-sugarcube');
            if (sugarcubeScript) {
                obs.disconnect();
                const parent = sugarcubeScript.parentNode;
                sugarcubeScript.remove();
                initializeModSystem(sugarcubeScript, parent);
                return;
            }
        }
    });

    console.log('[DoLlynk is waking up 🦚]');
    const existingTwineScript = document.getElementById('twine-user-script');
    if (existingTwineScript) {
        applyPrecompPatches(existingTwineScript);
    }
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // INFO: CTRL + Shift + m to force mod manager
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'm') {
            e.preventDefault();
            e.stopPropagation();
            console.log('[DoLlynk] Failsafe hotkey triggered. Forcing mod manager UI.');
            try {
                UI.forceInjectManager();
            } catch (err) {
                console.error('[DoLlynk] Failsafe UI injection failed:', err);
                alert('DoLlynk Failsafe Error: Could not inject UI. See console for details.');
            }
        }
    }, true);

})();
