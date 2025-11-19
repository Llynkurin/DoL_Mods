Latest Install links:
[DoLlynk Injector](https://github.com/Llynkurin/DoL_Mods/raw/refs/heads/main/DoLLynk%20Injector/DoLlynk%20Injector-2.0.user.js) |
[SC2Modloader Compatability](https://github.com/Llynkurin/DoL_Mods/raw/refs/heads/main/DoLLynk%20Injector/DoLlynk+ModLoader-2.0.user.js)
  
  
  * [01. Installation](#01-installation)
  * [02. Loading Mods](#02-loading-mods)
  * [03. Patch Creation](#03-patch-creation)
  * [04. Best Practices](#04-best-practices)
  ---

# DoLlynk Injector

It is a userscript injection system for *Degrees of Lewdity*. It exists because manually editing a 15MB HTML file is inefficient, chaotic, and frankly, terrifying. DoLlynk sits between your browser and the game, injecting code, styles, and assets into memory *before* the engine initializes. It is much cleaner.

Here is the documentation. I have tried to optimize it for maximum information density, if you see a typo or mistake please forgive me, I recently found out I have been living in a room with mold for ten years.

---

## 01. Installation

1.  **Get a Manager:** **Tampermonkey** or **Violentmonkey** or anything you use to inject userscripts normally.
2.  **Install the Script:**
3.  **Verify Targets:**
    *   The script is configured to match standard filenames (`Degrees of Lewdity.html`, `DoL.html`) and local files (`file:///`).
    *   **Critical:** If you rename your game file to something specific like `Bail3y_0wn2_me_h3h3.html`, you *must* add that filename to the `@match` headers in the script settings, or the script will simply sleepy.

*Note: If you are on Android using JoiPlay, this will likely fail. JoiPlay is not a browser; it is an interpreter. Use a browser like Kiwi if you need mobile support.* I have also no ability currently to test how this runs on mobile. I have no phone. My phone committed self die on my pillow.

---

## 02. Loading Mods

Once installed, a "Mods" button will appear in the game’s UI overlay `Options > Mods`. This opens the **DoLlynk Manager**.

### Installation
You can drag and drop files into the dropzone. DoLlynk parses filenames to decide how to treat them.

*   **Acceptable formats:** `.txt, .twee, .js, .css, .json5, .zip`

### The Asset System (Images)
If a mod adds images, DoLlynk intercepts the browser's request for that image and serves a replacement file.

*   **Web Mode:** You must import the `.zip` via the UI. The images live in your browser's IndexedDB storage.
*   **Local Mode:** If you are playing a local HTML file, you can just point DoLlynk to a folder on your hard drive relative to the HTML file.

After "staging" files, click **Install Staged**, and then **Apply & Reload**. The game *must* reload for script injections to take hold.

---

## 03. Patch Creation

This is the technical part.

DoLlynk uses (`.modpatch.json5`) to modify the game code in small specified pieces without breaking compatibility with other mods or needing to ship full .html changes.

You define an array of objects. Each object has a `role`.

### A. `role: "passage"`
Use this to modify SugarCube passages (text, links, logic).

*   **`name`**: The exact passage title (e.g., `"Bedroom"`).
*   **`method`**: `"string"` (exact match) or `"regex"` (regular expression).
*   **`find`**: What to look for (Text).
*   **`replace`**: What to put there (Text).
*   **`findFile` / `replaceFile`**: Alternatively, filenames to read the content from.

**Example 1:** *Injecting a UI widget into the Bedroom.*
```json5
{
  "role": "passage",
  "name": "Bedroom",
  "method": "string",
  "find": "You are in your bedroom.",
  "replace": "You are in your bedroom.\n\n<<BedroomUI>>"
}
```

**Example 2:** *Using external files for complex replaces.*
Use `.txt` files in your mod folder to handle large blocks of code without worrying about JSON escaping.
```json5
{
    "role": "passage",
    "name": "Hairdressers Widgets",
    "method": "string",
    "findFile": "find_hairdresser.txt",
    "replaceFile": "hairoptions.txt"
}
```
**`find_hairdresser.txt`** (Must match game code *exactly*, including indentation):
```
						<<option "Low Ombré" "low-ombre">>
						<<option "High Ombré" "high-ombre">>
						<<option "Split" "split">>
						<<option "Face-framing highlights" "face-frame">>
```
**`hairoptions.txt`** (Your replacement code):
```
<<option "Low Ombré" "low-ombre">>
<<option "High Ombré" "high-ombre">>
<<option "Split" "split">>
<<option "Face-framing highlights" "face-frame">>
<<option "Scene" "scene-fade">>
<<option "Checker" "checker-fade">>
<<option "Wink" "wink-color">>
```

### B. `role: "script"`
⚠ **Warning:** This patches the main `twine-user-script` (the core Javascript) *before* compilation. This means you may experience game breaking. Test on a copy of the game and backup your save/mods before editing these.

*   **`find`**: The string/regex to locate in the raw JS source.
*   **`replace`**: The new code.
*   **`name`**:
    *   **Compatibility Note:** If you want your mod to work with **ModLoader** as well, you *must* set this to the filename from the source repo (e.g., `renderer.js`).

**Safety Mechanism:** DoLlynk has a "Generality Threshold." If your `find` string matches more than **5 times**, the patch is skipped. This prevents you from accidentally replacing something common (like `var i = 0`) and getting nothing but red error boxes or solid grey.

**Example:** *Redirecting a function call.*
```json5
{
  "role": "script",
  "name": "renderer.js", // Just a label for the console logs
  "method": "string",
  "find": "options.filters.hair = createHairColourGradient(",
  "replace": "options.filters.hair = window.HGP_createHairColourGradient("
}
```

---

## 04. Best Practices

1.  **File Extensions Matter:**
    *   `modFile.js` runs *after* the story loads (Runtime).
    *   `modFile.early.js` runs *before* the story initializes. Use `.early.js` if you are defining variables that the game needs on startup (like `setup.clothes`).
    *   To get a solid idea of where these points are you can open the console (F12) and filter for "DoLlynk".
2.  **Asset Paths:**
    *   In your code, use standard paths: `<img src="img/my_mod/icon.png">`.
    *   DoLlynk will catch `img/` and route it to your zip/folder transparently.

If the system behaves erratically, open the console (F12) and type `DoLlynk.state`. It will tell you if it is confused. `Ctrl+Shift+M` can load in the tab forcefull if it goes missing.
