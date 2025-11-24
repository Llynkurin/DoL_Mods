// ==UserScript==
// @name          DoLlynk+ModLoader
// @namespace     https://github.com/Llynkurin
// @version       2.3
// @description   A universal zip handler and compatibility layer for DoLlynk Injector.
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

(function() {
	'use strict';

	/* ANCHOR: Initialization */
	function initializeCompatLayer() {
		if (!window.DoLlynk || !window.DoLlynk.UI) {
			console.error('[DoLlynk Compat] Core injector not found or not ready. This script will not run.');
			return;
		}
		console.log('[DoLlynk Compat] Core injector found, applying universal zip handler...');

		const {
			state,
			UI,
			ModActions,
			FileHandler,
			Storage,
			Assets,
			ENV
		} = window.DoLlynk;

		/* ANCHOR: Download Helper (Non-Sandboxed) */
		const _triggerDownload = (blob, filename) => {
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			setTimeout(() => {
				document.body.removeChild(a);
				URL.revokeObjectURL(url);
			}, 100);
		};

		const Compat = {
			/* ANCHOR: boot.json Import Logic */
			async _processBootData(bootContent, groupName, zip) {
				const createdMods = [];
				const bootData = JSON5.parse(bootContent);
				const modName = bootData.name || groupName;

				const fileLists = [{
						type: 'css',
						lists: ['styleFileList'],
						early: true
					},
					{
						type: 'js',
						lists: ['scriptFileList_inject_early', 'scriptFileList_earlyload'],
						early: true
					},
					{
						type: 'js',
						lists: ['scriptFileList_preload', 'scriptFileList'],
						early: false
					},
					{
						type: 'twee',
						lists: ['tweeFileList'],
						early: true
					},
				];

				for (const {
						type,
						lists,
						early
					}
					of fileLists) {
					for (const listName of lists) {
						if (Array.isArray(bootData[listName])) {
							for (const filePath of bootData[listName]) {
								const file = zip.file(new RegExp(`^${filePath.replace(/\\/g, '/')}$`, 'i'))[0];
								if (!file) {
									console.warn(`[DoLlynk Compat] File not found in zip for ${modName}: ${filePath}`);
									continue;
								}
								const code = await file.async('text');
								const {
									name
								} = ModActions._getTypeAndName(file.name.split('/').pop());
								createdMods.push({
									name,
									groupName: modName,
									type,
									code,
									earlyLoad: early,
									enabled: true
								});
							}
						}
					}
				}

				const passagePatches = [];
				const scriptPatches = [];
				if (Array.isArray(bootData.addonPlugin)) {
					for (const addon of bootData.addonPlugin) {
						if (addon.addonName === 'TweeReplacerAddon' && Array.isArray(addon.params)) {
							passagePatches.push(...addon.params.map(p => ({
								role: 'passage',
								name: p.passage,
								method: p.isRegex || !!p.findRegex ? 'regex' : 'string',
								find: p.findRegex || p.findString,
								replace: p.replace
							})));
						}
						if (addon.addonName === 'ReplacePatcherAddon' && addon.params) {
							if (Array.isArray(addon.params.twee)) {
								passagePatches.push(...addon.params.twee.map(p => ({
									role: 'passage',
									name: p.passageName,
									method: 'string',
									find: p.from,
									replace: p.to
								})));
							}
							if (Array.isArray(addon.params.js)) {
								scriptPatches.push(...addon.params.js.map(p => ({
									role: 'script',
									method: 'string',
									find: p.from,
									replace: p.to
								})));
							}
						}
					}
				}

				if (passagePatches.length > 0 || scriptPatches.length > 0) {
					createdMods.push({
						name: `${modName}-patches`,
						groupName: modName,
						type: 'unified-patch',
						code: JSON.stringify([...passagePatches, ...scriptPatches], null, 2),
						earlyLoad: true,
						enabled: true
					});
				}
				return createdMods;
			},

			/* ANCHOR: Standard Zip  */
			async _installStandardZip(file, zip) {
				const rootGroup = file.name.replace(/\.zip$/i, '');
				if (!ENV.isFileProtocol && state.settings.assetsEnabled) {
					const count = await this._importAssetsFromZip(zip, rootGroup);
					if (count > 0) console.log(`[✓ DoLlynk Compat] Imported ${count} assets from ${file.name}.`);
				}

				for (const path in zip.files) {
					const entry = zip.files[path];
					if (entry.dir || /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(entry.name)) continue;

					const pathParts = path.split('/').filter(p => p);
					const fileName = pathParts.pop();
					const groupName = [rootGroup, ...pathParts].join('/');
					const {
						type,
						name,
						earlyLoad
					} = ModActions._getTypeAndName(fileName);

					if (!type) continue;
					const code = await entry.async('text');
					const finalEarly = earlyLoad || ['twee', 'css', 'unified-patch'].includes(type);
					state.mods.push({
						name,
						groupName,
						type,
						code,
						earlyLoad: finalEarly,
						enabled: true,
						id: crypto.randomUUID(),
						order: state.mods.length
					});
				}
			},

			/* ANCHOR: Asset Import from Zip */
			async _importAssetsFromZip(zip, groupId) {
				const imageFiles = Object.values(zip.files).filter(f => !f.dir && /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(f.name));
				for (const file of imageFiles) {
					await Assets.DB.put(Assets._normalizePath(file.name), await file.async('blob'), groupId);
				}
				if (imageFiles.length > 0) {
					const groupData = await Assets.DB.getByGroupId(groupId);
					Assets.Groups.addOrUpdate({
						id: groupId,
						fileCount: groupData.length,
						size: groupData.reduce((acc, f) => acc + f.size, 0),
						type: 'mod-linked'
					});
				}
				return imageFiles.length;
			},

			/* ANCHOR: boot.json Export Logic */
			_generateBootJson(mods, groupName) {
				const boot = mods.reduce((acc, mod) => {
					const filePath = (mod.groupName.length > groupName.length ? mod.groupName.substring(groupName.length + 1) + '/' : '') + ModActions._getFileNameFromMod(mod);
					switch (mod.type) {
						case 'css':
							acc.styleFileList.push(filePath);
							break;
						case 'js':
							(mod.earlyLoad ? acc.scriptFileList_earlyload : acc.scriptFileList).push(filePath);
							break;
						case 'twee':
							acc.tweeFileList.push(filePath);
							break;
						case 'unified-patch':
							try {
								const patches = JSON5.parse(mod.code);
								for (const p of patches) {
									if (p.role === 'passage') {
										const replacerParam = {
											passage: p.name,
											replace: p.replace,
											isRegex: p.method === 'regex'
										};
										if (p.method === 'regex') replacerParam.findRegex = p.find;
										else replacerParam.findString = p.find;
										acc.addonPlugin[0].params.push(replacerParam);
									} else if (p.role === 'script') {
										acc.addonPlugin[1].params.js.push({
											fileName: "game-script",
											from: p.find,
											to: p.replace
										});
									}
								}
							} catch (e) {
								console.error(`[DoLlynk Compat] Error parsing patch file ${mod.name} for boot.json export.`, e);
							}
							break;
					}
					return acc;
				}, {
					name: groupName,
					version: "1.0.0",
					styleFileList: [],
					scriptFileList: [],
					scriptFileList_earlyload: [],
					tweeFileList: [],
					addonPlugin: [{
							addonName: "TweeReplacerAddon",
							params: []
						},
						{
							addonName: "ReplacePatcherAddon",
							params: {
								js: [],
								twee: []
							}
						}
					]
				});
				boot.addonPlugin = boot.addonPlugin.filter(p => p.params.length > 0 || (p.params.js && p.params.js.length > 0));
				if (boot.addonPlugin.length === 0) delete boot.addonPlugin;
				return JSON.stringify(boot, null, 2);
			}
		};

		/* ANCHOR: Hooks and Overrides */

		const originalRenderItem = UI._renderItem.bind(UI);
		UI._renderItem = function(item, depth, buffer) {
			const tempBuffer = [];
			originalRenderItem(item, depth, tempBuffer);
			let html = tempBuffer.join('').replace(/data-action="export-group" data-group="([^"]+)" title="Export Group">JSON5/g, 'data-action="export-group" data-group="$1" title="Export as Zip">ZIP');
			buffer.push(html);
		};

		FileHandler.installStaged = async function() {
			if (!state.stagedFiles.length) return;
			UI.showLoader('Installing mods (Zip Handler)...');

			const nonZipFiles = [];
			let modsAdded = false;

			for (const file of state.stagedFiles) {
				if (file.name.toLowerCase().endsWith('.zip')) {
					try {
						const zip = await JSZip.loadAsync(file);
						const bootFile = zip.file(/boot\.json5?$/i)[0];
						if (bootFile) {
							const bootContent = await bootFile.async('text');
							const bootData = JSON5.parse(bootContent);
							const groupName = bootData.name || file.name.replace(/\.zip$/i, '');

							console.log(`[DoLlynk Compat] Found boot.json in ${file.name}, using ModLoader import for group "${groupName}".`);

							const modsFromBoot = await Compat._processBootData(bootContent, groupName, zip);
							if (modsFromBoot.length > 0) {
								modsFromBoot.forEach(mod => state.mods.push({
									...mod,
									id: crypto.randomUUID(),
									order: state.mods.length
								}));
								modsAdded = true;
							}

							if (!ENV.isFileProtocol && state.settings.assetsEnabled) {
								const count = await Compat._importAssetsFromZip(zip, groupName);
								if (count > 0) console.log(`[✓ DoLlynk Compat] Imported ${count} assets from ${file.name}.`);
							}
						} else {
							console.log(`[DoLlynk Compat] No boot.json in ${file.name}, using standard zip import.`);
							await Compat._installStandardZip(file, zip);
							modsAdded = true;
						}
					} catch (e) {
						console.error(`[DoLlynk Compat] Failed to process zip ${file.name}`, e);
						alert(`Failed to process zip ${file.name}. See console for details.`);
					}
				} else {
					nonZipFiles.push(file);
				}
			}

			if (nonZipFiles.length > 0) {
				for (const file of nonZipFiles) {
					if (/\.(json5?)$/i.test(file.name)) {
						try {
							const imported = JSON5.parse(await file.text());
							if (Array.isArray(imported)) {
								const newMods = imported.filter(imp => !state.mods.some(ex => ex.id === imp.id));
								if (newMods.length > 0) {
									newMods.forEach(mod => state.mods.push({
										...mod,
										order: state.mods.length
									}));
									modsAdded = true;
								}
							}
						} catch (e) {
							alert(`Failed to import ${file.name}: ${e.message}`);
						}
					} else {
						const {
							type,
							name,
							earlyLoad
						} = ModActions._getTypeAndName(file.name);
						if (type) {
							const code = await file.text();
							const finalEarly = earlyLoad || ['twee', 'css', 'unified-patch'].includes(type);
							state.mods.push({
								name,
								groupName: null,
								type,
								code,
								earlyLoad: finalEarly,
								enabled: true,
								id: crypto.randomUUID(),
								order: state.mods.length
							});
							modsAdded = true;
						}
					}
				}
			}

			state.stagedFiles = [];
			if (modsAdded) {
				state.needsReload = true;
				await Storage.saveMods();
				UI.resetForm();
				UI.updateModList();
			}
			UI.hideLoader();
		};

		ModActions.exportGroup = async function(groupId, buttonElement) {
			const mods = state.mods.filter(m => m.groupName === groupId || m.groupName?.startsWith(groupId + '/'));
			if (!mods.length) return alert('No mods found in this group to export.');

			const exportAsModLoader = confirm(`Export group "${groupId}" as a ModLoader-compatible zip?\n\n(Click 'Cancel' to export as a standard zip without a boot.json file.)`);

			buttonElement.textContent = '...';
			buttonElement.disabled = true;

			try {
				const zip = new JSZip();
				const groupBaseName = groupId.split('/').pop();

				for (const mod of mods) {
					const relativePath = mod.groupName.length > groupId.length ? mod.groupName.substring(groupId.length + 1) + '/' : '';
					zip.file(relativePath + ModActions._getFileNameFromMod(mod), mod.code);
				}

				if (exportAsModLoader) {
					const bootJsonContent = Compat._generateBootJson(mods, groupBaseName);
					zip.file('boot.json', bootJsonContent);
					_triggerDownload(await zip.generateAsync({
						type: 'blob'
					}), `${groupBaseName}.modloader.zip`);
				} else {
					_triggerDownload(await zip.generateAsync({
						type: 'blob'
					}), `${groupBaseName}.standard.zip`);
				}
			} catch (err) {
				console.error(`[DoLlynk Compat] Failed to generate ZIP for ${groupId}`, err);
				alert(`Failed to generate ZIP for ${groupId}. See console for details.`);
			} finally {
				buttonElement.textContent = 'ZIP';
				buttonElement.disabled = false;
			}
		};

		FileHandler.browse = function() {
			const i = document.createElement('input');
			i.type = 'file';
			i.multiple = true;
			i.accept = '.js,.css,.twee,.json,.json5,.zip,.txt';
			i.onchange = e => FileHandler.stage(Array.from(e.target.files));
			i.click();
		};
	}

	function waitForDoLlynk() {
		if (window.DoLlynk && window.DoLlynk.UI && window.DoLlynk.FileHandler) {
			initializeCompatLayer();
		} else {
			setTimeout(waitForDoLlynk, 100);
		}
	}

	waitForDoLlynk();
})();
