// ==UserScript==
// @name          DoLlynk+ModLoader
// @namespace     https://github.com/Llynkurin
// @version       2.0
// @description   A compatibility layer for DoLlynk Injector to support ModLoader's boot.json format.
// @author        Llynkurin
// @match         file:///*Degrees%20of%20Lewity*.html*
// @match         file:///*Degrees*of*Lewdity*.html*
// @match         file:///*DoL*.html*
// @match         https://*.dolmods.net/*
// @icon          https://www.google.com/s2/favicons?sz=64&domain=vrelnir.blogspot.com
// @grant         none
// @require       https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @require       https://cdn.jsdelivr.net/npm/json5@2.2.3/dist/index.min.js
// @run-at        document-end
// ==/UserScript==

(function () {
    'use strict';

    if (!window.DoLlynk) {
        console.error('[DoLlynk Compat] Core injector not found. This script will not run.');
        return;
    }
    console.log('[DoLlynk Compat] Core injector found, applying compatibility layer...');

    const { state, UI, ModActions, FileHandler, Storage } = window.DoLlynk;

    /* ANCHOR: Download Helper (Non-Sandboxed) */
    const _triggerDownload = (blob, filename) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    };

    const Compat = {
        /* ANCHOR: boot.json Import Logic */
        async _processBootData(bootContent, groupName, zip) {
            const createdMods = [];
            try {
                const bootData = JSON5.parse(bootContent);
                const modName = bootData.name || groupName;

                const fileLists = [
                    { type: 'css', lists: ['styleFileList'], early: true },
                    { type: 'js', lists: ['scriptFileList_inject_early', 'scriptFileList_earlyload'], early: true },
                    { type: 'js', lists: ['scriptFileList_preload', 'scriptFileList'], early: false },
                    { type: 'twee', lists: ['tweeFileList'], early: true },
                ];

                for (const { type, lists, early } of fileLists) {
                    for (const listName of lists) {
                        if (Array.isArray(bootData[listName])) {
                            for (const filePath of bootData[listName]) {
                                const file = zip.file(new RegExp(`^${filePath.replace(/\\/g, '/')}$`, 'i'))[0];
                                if (!file) {
                                    console.warn(`[DoLlynk Compat] File not found in zip for ${modName}: ${filePath}`);
                                    continue;
                                }
                                const code = await file.async('text');
                                const { name } = ModActions._getTypeAndName(file.name.split('/').pop());
                                createdMods.push({ name, groupName: modName, type, code, earlyLoad: early, enabled: true });
                            }
                        }
                    }
                }

                const patches = (bootData.addonPlugin || []).flatMap(addon => {
                    if (addon.addonName === 'TweeReplacerAddon' && Array.isArray(addon.params)) {
                        return addon.params.map(p => ({ role: 'passage', name: p.passage, method: p.isRegex ? 'regex' : 'string', find: p.findRegex || p.findString, replace: p.replace }));
                    }
                    if (addon.addonName === 'ReplacePatcherAddon' && addon.params) {
                        const jsPatches = (addon.params.js || []).map(p => ({ role: 'script', name: `JS patch for ${p.fileName}`, method: 'string', find: p.from, replace: p.to }));
                        const tweePatches = (addon.params.twee || []).map(p => ({ role: 'passage', name: p.passageName, method: 'string', find: p.from, replace: p.to }));
                        return [...jsPatches, ...tweePatches];
                    }
                    return [];
                });

                if (patches.length > 0) {
                    createdMods.push({ name: `${modName}-patches`, groupName: modName, type: 'unified-patch', code: JSON.stringify(patches, null, 2), earlyLoad: true, enabled: true });
                }
                return createdMods;
            } catch (e) {
                console.error(`[DoLlynk Compat] Failed to process boot.json for ${groupName}`, e);
                alert(`Failed to process boot.json for ${groupName}: ${e.message}`);
                return [];
            }
        },

        /* ANCHOR: boot.json Export Logic */
        _generateBootJson(mods, groupName) {
            const boot = mods.reduce((acc, mod) => {
                const filePath = (mod.groupName.length > groupName.length ? mod.groupName.substring(groupName.length + 1) + '/' : '') + ModActions._getFileNameFromMod(mod);
                switch (mod.type) {
                    case 'css': acc.styleFileList.push(filePath); break;
                    case 'js': acc.scriptFileList.push(filePath); break;
                    case 'twee': acc.tweeFileList.push(filePath); break;
                    case 'unified-patch':
                        try {
                            const patches = JSON5.parse(mod.code);
                            for (const p of patches) {
                                if (p.role === 'passage') {
                                    acc.addonPlugin[0].params.push({ passage: p.name, [p.method === 'regex' ? 'findRegex' : 'findString']: p.find, replace: p.replace, isRegex: p.method === 'regex' });
                                } else if (p.role === 'script') {
                                    acc.addonPlugin[1].params.js.push({ fileName: "game-script", from: p.find, to: p.replace });
                                }
                            }
                        } catch(e) { console.error(`[DoLlynk Compat] Error parsing patch file ${mod.name} for export.`, e); }
                        break;
                }
                return acc;
            }, {
                name: groupName, version: "1.0.0",
                styleFileList: [], scriptFileList: [], tweeFileList: [],
                addonPlugin: [
                    { addonName: "TweeReplacerAddon", params: [] },
                    { addonName: "ReplacePatcherAddon", params: { js: [], twee: [] } }
                ]
            });

            boot.addonPlugin = boot.addonPlugin.filter(p => p.params.length > 0 || (p.params.js && p.params.js.length > 0));
            return JSON.stringify(boot, null, 2);
        }
    };

    /* ANCHOR: Hooks and Overrides */
    const originalInstallStaged = FileHandler.installStaged.bind(FileHandler);
    FileHandler.installStaged = async function () {
        if (!state.stagedFiles.length) return;
        UI.showLoader('Installing mods (Compat)...');

        const unhandledFiles = [];
        let modsAdded = false;

        for (const file of state.stagedFiles) {
            if (file.name.endsWith('.zip')) {
                try {
                    const zip = await JSZip.loadAsync(file);
                    const bootFile = zip.file(/boot\.json5?$/i)[0];
                    if (bootFile) {
                        console.log(`[DoLlynk Compat] Found boot.json in ${file.name}, using ModLoader import logic.`);
                        const groupName = file.name.replace(/\.zip$/i, '');
                        const modsFromBoot = await Compat._processBootData(await bootFile.async('text'), groupName, zip);
                        if (modsFromBoot.length > 0) {
                            modsFromBoot.forEach(mod => state.mods.push({ ...mod, id: crypto.randomUUID(), order: state.mods.length }));
                            modsAdded = true;
                        }
                    } else { unhandledFiles.push(file); }
                } catch(e) {
                    console.error(`[DoLlynk Compat] Failed to process zip ${file.name}`, e);
                    unhandledFiles.push(file); // Treat as a normal zip on error
                }
            } else { unhandledFiles.push(file); }
        }

        state.stagedFiles = unhandledFiles;
        if (unhandledFiles.length > 0) {
            await originalInstallStaged();
        } else if (modsAdded) {
            state.stagedFiles = [];
            state.needsReload = true;
            await Storage.saveMods();
            UI.resetForm();
            UI.updateModList();
            UI.hideLoader();
        } else {
            UI.hideLoader();
        }
    };

    const originalExportGroup = ModActions.exportGroup.bind(ModActions);
    ModActions.exportGroup = async function (groupId, buttonElement) {
        const mods = state.mods.filter(m => m.groupName === groupId || m.groupName?.startsWith(groupId + '/'));
        if (!mods.length) return alert('No mods found in this group to export.');

        if (!confirm(`Export group "${groupId}" with a ModLoader-compatible boot.json?\n\n(Cancel to export as a simple .json5 group backup)`)) {
            return originalExportGroup(groupId, buttonElement);
        }

        buttonElement.textContent = '...'; buttonElement.disabled = true;
        try {
            const bootJsonContent = Compat._generateBootJson(mods, groupId.split('/').pop());
            const zip = new JSZip();
            zip.file('boot.json', bootJsonContent);

            for (const mod of mods) {
                const relativePath = (mod.groupName.length > groupId.length) ? mod.groupName.substring(groupId.length + 1) + '/' : '';
                zip.file(relativePath + ModActions._getFileNameFromMod(mod), mod.code);
            }
            _triggerDownload(await zip.generateAsync({ type: 'blob' }), `${groupId.split('/').pop()}.modloader.zip`);
        } catch(err) {
            console.error(`[DoLlynk Compat] Failed to generate ModLoader ZIP for ${groupId}`, err);
            alert(`Failed to generate ZIP for ${groupId}. See console for details.`);
        } finally {
            buttonElement.textContent = 'JSON5'; buttonElement.disabled = false;
        }
    };
})();
