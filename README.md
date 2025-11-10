### DoLlynk Injector

so this is my inline mod injector. It's based on the way Lyoko-Jeremie's sugarcube-2-ModLoader injects things via startup.

The main idea is to have a simple, file-based system for mods where you can just drag and drop stuff without needing to package it all up when making edits or small mods.

#### How to Use

1.  You need a userscript manager like Tampermonkey or Violentmonkey.
2.  Install the `DoLlynk Injector.user.js` file into the manager.
3.  Load the game.

The Mod Manager UI hooks into the game's **Advanced Settings** screen. You should see it pop up there.

Also, if a JS patch breaks the game and you can't get to the menu, I added a failsafe hotkey: `CTRL + Shift + M` will force the manager to open. I keep making this mistake so it was kinda necessary.

#### The Mod Manager UI

It's pretty straightforward. You can drag and drop files to install them, or add them manually. You can also reorder mods and groups by dragging them around in the list. Changes require a reload to apply, it'll warn you.

***

###  Making "Native" Mods 

The whole point of this was to make modding easier for me, so the native format is just... files. The injector figures out what to do based on the file extension and name.

You can drop these files in individually or group them in a folder. If you have `Meepmeep/mod.twee`, it will create a group called `Meepmeep`.

#### File Naming Conventions

*   `ModName.twee`: A Twee passage file. It'll get parsed and injected into the game's story data. Good for adding new passages or whole widgets.
*   `ModName.css`: A CSS style file. This is injected directly into the document head to apply styles.
*   `ModName.js`: A standard JavaScript file. This code runs at `runtime`, which means after the story is ready (`:storyready` event).
*   `ModName.early.js`: An **early-load** JavaScript file. This is important. It runs *before* the game's own scripts are compiled. Use this for things that need to exist before the game starts, like dependencies or pre-compilation patches (though the `.modpatch` file is better for that).
*   `ModName.modpatch.json5`: The unified patcher file. This is for making changes to existing game passages, widgets, or scripts without replacing the whole thing. It's the most powerful part.

***

### ANCHOR: The Unified Patcher (.modpatch.json5) 

I wanted a way to do lots of little changes without needing a ton of separate files. The `.modpatch.json5` file is an array of patch objects. It uses JSON5 so you can have comments and trailing commas.

Each object in the array needs a `role` to tell the injector what it's patching.

#### `role: "passage"`

This patches the content of a game passage.

*   `name`: The exact name of the passage to patch (e.g., `"Bedroom"`).
*   `method`: Can be `"string"` for simple text replacement or `"regex"` for regular expressions.
*   `find`: The string or regex to search for.
*   `replace`: What to replace it with.

**Example (from the Bedroom UI mod):**

```json5
{
  "role": "passage",
  "name": "Bedroom",
  "method": "string",
  "find": "You are in your bedroom.",
  "replace": "You are in your bedroom.\n\n<<BedroomUI>>"
}
```
 `<<BedroomUI>>` being a custom widget

#### `role: "widget"`

This wraps an existing widget to add code before or after it. It doesn't replace the widget, it renames the original and creates a new one with your additions.

*   `name`: The name of the widget (e.g., `"passout"`).
*   `method`: `"prefix"` or `"prepend"` to add before, `"postfix"` or `"append"` to add after.
*   `replace`: The code to inject. Usually a call to another widget.

**Example:**

```json5
{
  "role": "widget",
  "name": "passout",
  "method": "prefix",
  "replace": "<<CustomPassoutWidget>>"
}
```

#### `role: "script"`

This patches the main `twine-user-script` file before it gets compiled by the browser. It's powerful but also dangerous so always do this on a copy.

*   `find`: The string or regex to find in the game's JavaScript code.
*   `replace`: The code to replace it with.

To prevent you from accidentally breaking everything, I added a "generality threshold." If your `find` string matches more than 5 times in the game's code, the patch will be skipped and you'll get a warning in the console. Trust me, it helps prevent replacing something like `var ` everywhere.

**Example:**

```json5
{
  "role": "script",
  "name": "JS patch to redirect hair filter call", //name here does not call to a specific file or function currently but maybe later it can
  "method": "string",
  "find": "options.filters.hair = createHairColourGradient(",
  "replace": "options.filters.hair = window.HGP_createHairColourGradient("
}
```

***

### boot.json & Compatibility

I know a lot of mods use the `boot.json` format, so I added support for it. You can drag-and-drop a `.zip` file containing a `boot.json` and the injector will try to parse it.

It's mostly for compatibility with externally made mods. The injector translates the `boot.json` instructions into its own "native" mod formats in the background when you import it. For new projects with this injector, it's easier to just use the file naming conventions directly.

anyway that's about it. I haven't tested every single edge case since I'm selfishly making this. ( ´ ▽ ` )ﾉ
