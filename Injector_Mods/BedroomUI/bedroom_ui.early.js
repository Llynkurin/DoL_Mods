(function () {
    'use strict';

    // ANCHOR: Process bedroom passage for UI enhancements
    function processBedroomPassage(passageNode) {
        const $passage = $(passageNode);
        const sceneContainer = document.getElementById('bedroom-scene-container');
        if (!sceneContainer || $passage.hasClass('bedroom-ui-processed')) return;
        $passage.addClass('bedroom-ui-processed');

        // ANCHOR: Robustly set wallpaper from rendered game icon
        const wallpaperImg = $passage.find('img[src*="wallpaper_"]').first().get(0);
        if (wallpaperImg) {
            sceneContainer.style.setProperty('--wallpaper-bg', `url("${wallpaperImg.src}")`);
        }

        // ANCHOR: Clone dynamic skybox into the UI's window frame
        const originalSkybox = document.querySelector('#canvasSkybox canvas');
        const visualWindow = document.getElementById('visual-window');
        if (originalSkybox && visualWindow) {
            const newCanvas = document.createElement('canvas');
            newCanvas.width = originalSkybox.width;
            newCanvas.height = originalSkybox.height;
            newCanvas.getContext('2d').drawImage(originalSkybox, 0, 0);
            visualWindow.innerHTML = ''; // Clear previous canvas
            visualWindow.appendChild(newCanvas);
        }

        // ANCHOR: Add a single, stable event listener for all interactive furniture
        sceneContainer.addEventListener('click', function (event) {
            const target = event.target.closest('.interactive[data-passage]');
            if (target && target.dataset.passage) {
                try {
                    // INFO: Use the official SugarCube API to navigate
                    SugarCube.Engine.play(target.dataset.passage);
                } catch (e) {
                    console.error("BedroomUI Error: Could not navigate.", e);
                }
            }
        });
    }

    // ANCHOR: Observe for passage changes and process
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                const passage = node.id === 'passage-bedroom' ? node : node.querySelector('#passage-bedroom');
                if (passage) {
                    processBedroomPassage(passage);
                    return;
                }
            }
        }
    });

    const targetNode = document.getElementById('passages') || document.body;
    observer.observe(targetNode, { childList: true, subtree: true });

    $(document).one(':passageinit', () => {
        const initialPassage = document.getElementById('passage-bedroom');
        if (initialPassage) {
            processBedroomPassage(initialPassage);
        }
    });
})();