# Storyweave

A browser-based studio for writing branching interactive stories and exporting them as a single, dependency-free HTML file.

There is no build step, server, package manager, or external library. Open `index.html` in a modern browser and start writing.

## Quick start

1. Open `index.html` (double-click it, or serve the folder from any static file server).
2. The sample story, *The Lantern at Low Tide*, loads the first time.
3. Edit a scene, add choices or a direct link, then press **Playtest**.
4. Use **Export → Playable HTML** to download a self-contained story you can open or share anywhere.

Press **New** to start from a blank one-act project. New and Import both replace the project in the editor, so export a JSON backup first if you want to keep the current story.

## The editor

- **Story map** — the story is organized as **Acts → Chapters → Scenes**. Scenes are the playable units that hold text, choices, links, conditions, effects, and endings.
  - Use `+` beside an act to add a chapter, and `+` beside a chapter to add a scene. The `+` in the **Scenes** header adds a new act.
  - Act and chapter titles are editable inline in the story map. Use the arrow buttons to reorder acts, chapters, or the current scene, and `×` to delete one.
  - Deleting an act removes its chapters and scenes. Deleting a chapter removes its scenes. Choices and direct links that pointed to removed scenes are cleared, and an opening scene is chosen automatically if needed. A story keeps at least one act, each act keeps at least one chapter, and each chapter keeps at least one scene.
- **Scenes** — select a scene row to edit it. The editor header shows its act, chapter, and position. Use the header arrows to reorder it within its chapter.
- **Story begins at** — chooses the scene the reader sees first.
- **Write / Preview** — Write shows the markup source; Preview renders the scene using its initial variable values and current theme.
- **Flow** — each scene has one of three endings:
  - **Choices** — readers pick from one or more labeled choices.
  - **Direct link** — a single “continue” button leads to another scene.
  - **Ending** — the story stops here.
- **Categories** — the right-hand panel organizes story state into as many categories as you need. Add, rename, reorder, or delete them with the buttons in each category header.
  - **Stat sheet** categories show every variable and its current value. Variables can be a **number**, **text**, or **true / false** value.
  - **Inventory** categories show only variables whose count is above zero, with a `×` count.
  - Use categories for stats, inventory, field notes, clues, relationships, or anything else the reader should see.
- **Stat screen title** — names the in-story state panel. Call it *Story state*, *Stat sheet*, *Field notes*, *Inventory*, or anything else. The title is part of the project and is saved with it, but the exported story has no editor for changing it.
- **Story settings** — click the story title in the header to open **Story settings**. It contains the story title, cover subtitle, ending button label, and theme fonts and colors. Scene title and choice text start out matching the text color; change their swatches to give them a different color. All fonts are self-contained system stacks, so exported stories never load a web font. The ending screen always uses a fixed **The End** heading; write the final scene's own title and text to carry the ending.
- **Images** — the right-hand panel embeds images in the project. Uploaded images are compressed when needed and stored inside the project as data URLs.
- **Help** — the `?` button beside **New**, **Import**, and **Export** opens the markup cheat sheet at any time.
- **Playtest** — runs the story from the beginning with live categories, a restart guarded by typed confirmation, and an optional **Show locked choices** view. The state panel never shows a path or history.

Everything is saved automatically to this browser's `localStorage` under `storyweave.project.v1`. The save indicator in the header confirms it. Clearing browser site data removes the autosave, so use **Export → Project JSON** for backups.

Projects saved before the Act → Chapter → Scene update are migrated automatically when loaded. Their old chapters become scenes under **Act I / Chapter 1**, keeping their IDs, links, and opening scene.

## IDs, display names, and categories

Every variable has two names:

- **ID** — the bare identifier used inside commands, such as `courage` or `lantern`.
- **Display name** — the reader-facing label shown on the stat screen, such as *Courage* or *Brass Lantern*.

Variables live in categories, and each category chooses how it is displayed:

- **Stat sheet** — every variable in the category is listed with its value.
- **Inventory** — variables are treated as counted items. Items at zero are hidden, and the rest show as `×count`.

Commands still use two namespaces:

- `var:` for variables in stat-sheet categories
- `item:` for variables in inventory categories

For example, the sample project uses the stat ID `courage` and the item ID `lantern`:

```text
[var:courage]            shows the stat value in text
[item:lantern]           shows the item count in text
[if item:lantern]...[/if]   true while the reader carries at least one
item:lantern += 1        add one lantern to the inventory
item:lantern -= 1        remove one
```

Bare IDs such as `courage` and `lantern` also work in older projects and commands, but the `var:` and `item:` prefixes make the intended collection clear.

Stat-sheet variables support:

- **Number** — a value such as courage, gold, or score.
- **Text** — a name, title, or other string.
- **True / false** — a single flag.

Inventory variables are always counted. Categories are shown in the order you arrange them, and the playtest and exported player both use the project's stat screen title. The state panel shows current categories and values only; it does not show a path or history. Projects saved with the older fixed **Stats** and **Inventory** sections are migrated into equivalent categories automatically.

## Special text markup

Formatting tags can be nested. The same reference is available in the editor from the `?` button.

| Markup | Result |
| --- | --- |
| `[b]bold[/b]` | **bold** |
| `[i]italic[/i]` | *italic* |
| `[u]underline[/u]` | underline |
| `[s]struck[/s]` | strikethrough |
| `[big]larger[/big]` | larger text |
| `[small]smaller[/small]` | smaller text |
| `[color=#b75435]warm[/color]` | colored text (hex, named color, `rgb()`, or `hsl()`) |
| `[mark]highlighted[/mark]` | highlighted text |
| `[center]centered[/center]` | centered block |
| `[heading]Heading[/heading]` | section heading |
| `[quote]Quoted line[/quote]` | indented quotation |
| `[code]literal[/code]` | inline code |
| `[accent]accent[/accent]` | accent-colored text |
| `[muted]muted[/muted]` | muted text |
| `[hr]` | horizontal divider |
| `[br]` | line break |
| `[img:image_id]` | an embedded image from the **Images** panel |
| `\[` | a literal `[` |

Aliases: `[strong]`, `[em]`, `[strike]`, `[del]`, and `[highlight]`.

### Variables, images, and conditions inside text

```text
[var:courage]                         Show a stat's current value.
[item:lantern]                        Show an item's current count.
[img:image_id]                        Show an embedded image.
[set var:gold = 2]                    Set a stat while the text renders.
[set item:lantern += 1]               Also supports -=, *=, /=, ++, and --.

[if var:courage >= 2]The door opens.[/if]

[if item:lantern]You carry a light.[else]It is dark.[/if]
```

Conditions support:

- Comparisons: `=`, `==`, `!=`, `>`, `>=`, `<`, `<=`, `is`, `is not`
- Text: `contains`
- Boolean logic: `and`, `or`, `not`, with parentheses
- Arithmetic inside expressions: `+`, `-`, `*`, `/`, `%`
- Values: numbers, `true`, `false`, `null`, quoted strings, and variable names

Examples:

```text
var:courage >= 2 and item:lantern
var:name is "Mira"
var:gold >= 1
not (var:courage < 1)
```

### Conditional choices and effects

Each choice has optional **Condition** and **Effects** fields under *Condition & effects*.

- **Show only if** hides the choice when the condition is false. Blank means always visible.
- **Set stats & items** runs when the choice is selected. Separate multiple effects with a new line or `;`.

```text
var:courage += 1
item:lantern += 1
item:oil -= 1
var:name = "Mira"
```

Direct links can also run effects when the reader continues. A scene's **On enter** effects run before its text every time it opens.

## Exports

### Playable HTML

Downloads one `.html` file containing the story, engine, styles, player, cover text, ending button, theme, and any embedded images. It has no external dependencies and works offline. Readers open the state panel with the button in the top bar; its title, categories, and contents are fixed by the exported project.

### Saving progress in an exported story

Exported stories include manual save and load controls. They do not write saves to the browser, so a reader can keep progress without leaving anything behind on a shared device.

- **Save** in the top bar opens a save key. Copy the key as text or download it as a small `.txt` file. The key contains the current scene, variables, inventory, and ending state. It also keeps a small internal path record for compatibility, but the player never displays a path or history.
- **Load** in the top bar — or **Load a saved game** on the cover — accepts a pasted key or an uploaded save file.
- Save keys look like `SW-THE-LANTERN-AT-LOW-TIDE-A2-C1-<base62 payload>`. The title and act/chapter labels are readable; the payload is a compact, case-sensitive Base62 encoding. Treat the whole key as one value and do not edit it.
- Keys are tied to the story and its version. If the story has changed since the save was made, the player shows **Version mismatch, accuracy not guaranteed!** and offers a best-effort load. When the version matches, the saved scene and state are restored. After a mismatch, the player resumes at the saved scene with a best-effort state. Missing scenes fall back to the story's beginning, and variables that no longer exist are skipped.
- A save file is plain text containing the same key. It can be renamed, copied, or stored anywhere.
- **Restart** — the top-bar button, an ending's **Read again** button, and the missing-scene recovery button all open a confirmation screen. Type `restart` to unlock **Restart story**. Restarting resets only the current progress; save keys and save files are not deleted.

Playtest uses the editor's live preview and does not create save keys. Export **Playable HTML** to test saving and loading exactly as a reader will use it.

### Project JSON

Downloads an editable backup. Use **Import** to restore it later.

## Files

- `index.html` — editor shell
- `styles.css` — editor and playtest styling
- `engine.js` — markup, conditions, effects, and variable engine
- `app.js` — editor state, sample story, playtest, import/export, and the standalone player template

`engine.js` is also embedded verbatim into exported stories, so the editor and exported player evaluate text and conditions the same way.
