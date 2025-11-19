$(document).on(':storyready', function() {
    
    const CONFIG = {
        id: 'extendedSkyboxCanvas',
        containerId: 'extended-skybox-layer',
        targetW: 256,
        targetH: 256, 
        baseW: 64,
        baseH: 192
    };

    function scaleOrbits(settings, scaleX, scaleY) {
        if (!settings.orbits) return;
        for (const group of Object.values(settings.orbits)) {
            const variations = group.summer ? Object.values(group) : [group];
            for (const orbit of variations) {
                if (orbit.path) {
                    orbit.path.startX *= scaleX;
                    orbit.path.endX *= scaleX;
                    orbit.path.peakY *= scaleY;
                    orbit.path.horizon *= scaleY;
                }
            }
        }
    }

    setup.initExtendedSkybox = function() {
        if (typeof Weather === 'undefined' || typeof setup.SkySettings === 'undefined') return;
        if (setup.extendedSkyRenderer && setup.extendedSkyRenderer.mainLayer && setup.extendedSkyRenderer.mainLayer.element) {
            return;
        }

        try {
            const oldEl = document.getElementById(CONFIG.id);
            if (oldEl) oldEl.remove();
            const settings = JSON.parse(JSON.stringify(setup.SkySettings.canvas.sidebar));

            const scaleX = CONFIG.targetW / CONFIG.baseW;
            const scaleY = CONFIG.targetH / CONFIG.baseH;
            settings.size = [CONFIG.targetW, CONFIG.targetH];
            settings.scale = 1; // 1:1 pixel scale for sharpness

            scaleOrbits(settings, scaleX, scaleY);
            setup.extendedSkyRenderer = new Weather.Renderer.Sky({
                id: CONFIG.id,
                setup: settings,
                layers: [
                    "sky", "starField", "sun", "moon", "sunGlow", "bloodGlow",
                    "cirrusClouds", "overcastClouds", "clouds", "horizonGlow",
                    "precipitation", "fog"
                ],
                resizable: false 
            });
            setup.extendedSkyRenderer.initialize();
            const stretchLayers = ["cirrusClouds", "overcastClouds", "clouds", "horizonGlow", "fog", "precipitation"];
            
            if (setup.extendedSkyRenderer.layers) {
                stretchLayers.forEach(key => {
                    const layer = setup.extendedSkyRenderer.layers.get(key);
                    if (layer) {
                        // Update logic width
                        layer.width = CONFIG.targetW;
                        if (layer.settings) layer.settings.width = CONFIG.targetW;
                        if (layer.canvas) {
                            if (typeof layer.canvas.resize === 'function') {
                                layer.canvas.resize(CONFIG.targetW, CONFIG.targetH);
                            } else if (layer.canvas.element) {
                                layer.canvas.element.width = CONFIG.targetW;
                                layer.canvas.element.height = CONFIG.targetH;
                            }
                        }
                    }
                });
            }

            console.log("[Skybox] Renderer initialized and layers patched.");

        } catch (e) {
            console.error("[Skybox] Critical Init Error:", e);
        }
    };

    setup.injectSkyboxDOM = function() {
        if (!setup.extendedSkyRenderer || !setup.extendedSkyRenderer.mainLayer) return;

        const imgContainer = document.getElementById('img');
        if (!imgContainer) return;
        let layer = document.getElementById(CONFIG.containerId);
        if (!layer) {
            layer = document.createElement('div');
            layer.id = CONFIG.containerId;
            Object.assign(layer.style, {
                position: 'absolute',
                top: '0',
                left: '0',
                width: CONFIG.targetW + 'px',
                height: CONFIG.targetH + 'px',
                zIndex: '0', // Background
                pointerEvents: 'none', 
                overflow: 'hidden'
            });

            if (window.getComputedStyle(imgContainer).position === 'static') {
                imgContainer.style.position = 'relative';
            }
            imgContainer.prepend(layer);
        }
        const canvas = setup.extendedSkyRenderer.mainLayer.element;
        if (canvas && canvas.parentNode !== layer) {
            layer.appendChild(canvas);
        }
        try {
            setup.extendedSkyRenderer.drawLayers();
        } catch(e) {
            console.warn("[Skybox] Draw error (harmless if switching passages):", e);
        }
    };
});

$(document).on(':passagedisplay', function() {
    setTimeout(() => {
        if (setup.initExtendedSkybox) setup.initExtendedSkybox();
        if (setup.injectSkyboxDOM) setup.injectSkyboxDOM();
    }, 20);
});

$(document).on(':update-sidebar', function() {
    if (setup.extendedSkyRenderer) {
        try {
            setup.extendedSkyRenderer.drawLayers();
        } catch(e) {}
    }
});