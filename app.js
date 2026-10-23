(function () {
  'use strict';

  var ENGINE = window.StoryEngine;
  var STORAGE_KEY = 'storyweave.project.v1';
  var SAVE_DELAY = 450;
  var esc = ENGINE.escapeHTML;

  var els = {};
  var story = null;
  var currentId = null;
  var editorView = 'write';
  var saveTimer = null;
  var previewTimer = null;
  var toastTimer = null;
  var dirty = false;
  var playState = null;
  var lastFocusedElement = null;
  var imageInsertAtCursor = false;
  var restartConfirmCallback = null;
  var restartConfirmReturnFocus = null;

  /* ----------------------------------------------------------------------- */
  /* Small helpers                                                           */
  /* ----------------------------------------------------------------------- */

  function uid(prefix) {
    var random;
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      random = window.crypto.randomUUID().replace(/-/g, '').slice(0, 10);
    } else {
      random = Math.random().toString(36).slice(2, 12);
    }
    return (prefix || 'id') + '_' + random;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function projectScenes(project) {
    var scenes = [];
    if (!project || !Array.isArray(project.acts)) return scenes;
    project.acts.forEach(function (act) {
      if (!isObject(act) || !Array.isArray(act.chapters)) return;
      act.chapters.forEach(function (chapter) {
        if (!isObject(chapter) || !Array.isArray(chapter.scenes)) return;
        chapter.scenes.forEach(function (scene) {
          if (isObject(scene)) scenes.push(scene);
        });
      });
    });
    return scenes;
  }

  function allScenes() {
    return projectScenes(story);
  }

  function firstScene() {
    return allScenes()[0] || null;
  }

  function sceneContext(id) {
    if (!story || !Array.isArray(story.acts)) return null;
    for (var a = 0; a < story.acts.length; a++) {
      var act = story.acts[a];
      for (var c = 0; c < act.chapters.length; c++) {
        var chapter = act.chapters[c];
        for (var s = 0; s < chapter.scenes.length; s++) {
          if (chapter.scenes[s].id === id) {
            return {
              scene: chapter.scenes[s],
              act: act,
              chapter: chapter,
              actIndex: a,
              chapterIndex: c,
              sceneIndex: s
            };
          }
        }
      }
    }
    return null;
  }

  function sceneById(id) {
    var context = sceneContext(id);
    return context ? context.scene : null;
  }

  function sceneTitle(id) {
    var scene = sceneById(id);
    return scene && scene.title ? scene.title : 'Untitled scene';
  }

  function actById(id) {
    if (!story || !Array.isArray(story.acts)) return null;
    for (var i = 0; i < story.acts.length; i++) {
      if (story.acts[i].id === id) return story.acts[i];
    }
    return null;
  }

  function chapterById(id) {
    if (!story || !Array.isArray(story.acts)) return null;
    for (var a = 0; a < story.acts.length; a++) {
      var chapters = story.acts[a].chapters;
      for (var c = 0; c < chapters.length; c++) {
        if (chapters[c].id === id) return chapters[c];
      }
    }
    return null;
  }

  function chapterLocation(id) {
    if (!story || !Array.isArray(story.acts)) return null;
    for (var a = 0; a < story.acts.length; a++) {
      var act = story.acts[a];
      for (var c = 0; c < act.chapters.length; c++) {
        if (act.chapters[c].id === id) {
          return { act: act, chapter: act.chapters[c], actIndex: a, chapterIndex: c };
        }
      }
    }
    return null;
  }

  function actIndex(id) {
    if (!story || !Array.isArray(story.acts)) return -1;
    for (var i = 0; i < story.acts.length; i++) {
      if (story.acts[i].id === id) return i;
    }
    return -1;
  }

  function sceneModeLabel(mode) {
    if (mode === 'choices') return 'Choices';
    if (mode === 'link') return 'Direct link';
    return 'Ending';
  }

  function choiceById(id) {
    var scene = currentScene();
    if (!scene) return null;
    for (var i = 0; i < scene.choices.length; i++) {
      if (scene.choices[i].id === id) return scene.choices[i];
    }
    return null;
  }

  function allCategories() {
    return story && Array.isArray(story.categories) ? story.categories : [];
  }

  function categoryById(id) {
    var categories = allCategories();
    for (var i = 0; i < categories.length; i++) {
      if (categories[i].id === id) return categories[i];
    }
    return null;
  }

  function categoryForVariable(variable) {
    if (!variable) return null;
    var categories = allCategories();
    for (var c = 0; c < categories.length; c++) {
      var variables = Array.isArray(categories[c].variables) ? categories[c].variables : [];
      if (variables.indexOf(variable) !== -1) return categories[c];
    }
    return null;
  }

  function allVariables() {
    var variables = [];
    allCategories().forEach(function (category) {
      (Array.isArray(category.variables) ? category.variables : []).forEach(function (variable) {
        variables.push(variable);
      });
    });
    return variables;
  }

  function allVariableDefinitions() {
    return allVariables().map(function (variable) {
      return {
        name: variable.name,
        type: isItemVariable(variable) ? 'item' : (variable.type || 'number'),
        initial: variable.initial
      };
    });
  }

  function variableById(id) {
    var variables = allVariables();
    for (var i = 0; i < variables.length; i++) {
      if (variables[i].id === id) return variables[i];
    }
    return null;
  }

  function isItemVariable(variable) {
    if (!variable) return false;
    var category = categoryForVariable(variable);
    return variable.type === 'item' || !!(category && category.kind === 'inventory');
  }

  function currentScene() {
    return sceneById(currentId);
  }

  function currentContext() {
    return sceneContext(currentId);
  }

  function ensureCurrentScene() {
    if (!sceneById(currentId)) {
      var first = firstScene();
      currentId = first ? first.id : '';
    }
  }

  function slugify(value) {
    return String(value || 'story')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'story';
  }

  function pad(number) {
    return String(number).padStart(2, '0');
  }

  function initialVariables() {
    return ENGINE.createVariables(allVariableDefinitions());
  }

  function safeRender(markup, vars) {
    try {
      return ENGINE.renderMarkup(markup || '', vars, story && story.images);
    } catch (error) {
      return '<span class="render-error">This text could not be rendered.</span>';
    }
  }

  function variableNameIsValid(name) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
  }

  function formatStateValue(value) {
    return ENGINE.formatValue(value);
  }

  function valuesDiffer(left, right) {
    return formatStateValue(left) !== formatStateValue(right)
      || typeof left !== typeof right;
  }

  function humanizeVariableName(name) {
    var text = String(name == null ? '' : name)
      .replace(/^has(?=[A-Z])/, '')
      .replace(/[_-]+/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return 'Variable';
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function variableDisplayName(variable) {
    if (!variable) return 'Variable';
    var label = String(variable.label == null ? '' : variable.label).trim();
    return label || humanizeVariableName(variable.name);
  }

  function statePanelTitle() {
    var title = story && story.statePanel && story.statePanel.title;
    return String(title == null ? '' : title).trim() || 'Story state';
  }

  var DEFAULT_STORY_COPY = {
    coverSubtitle: 'Every choice leaves a mark. Some doors only open once.',
    endingTitle: 'The End',
    endingMessage: 'You can begin again and see where a different choice leads.',
    endingButton: 'Read again'
  };

  function normalizeStoryCopy(raw) {
    var source = isObject(raw) ? raw : {};

    function text(value, fallback, maxLength) {
      if (typeof value !== 'string') return fallback;
      var cleaned = value
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      return cleaned.slice(0, maxLength);
    }

    return {
      coverSubtitle: text(source.coverSubtitle, DEFAULT_STORY_COPY.coverSubtitle, 240),
      endingTitle: text(source.endingTitle, DEFAULT_STORY_COPY.endingTitle, 80) || DEFAULT_STORY_COPY.endingTitle,
      endingMessage: text(source.endingMessage, DEFAULT_STORY_COPY.endingMessage, 300),
      endingButton: text(source.endingButton, DEFAULT_STORY_COPY.endingButton, 40) || DEFAULT_STORY_COPY.endingButton
    };
  }

  function escMultiline(value) {
    return esc(String(value == null ? '' : value)).replace(/\n/g, '<br>');
  }

  function isNumericVariableType(type) {
    return type === 'number';
  }

  /* ----------------------------------------------------------------------- */
  /* Theme helpers                                                           */
  /* ----------------------------------------------------------------------- */

  var FONT_CHOICES = [
    { id: 'literary', label: 'Literary serif' },
    { id: 'classic', label: 'Classic serif' },
    { id: 'modern', label: 'Modern sans' },
    { id: 'humanist', label: 'Humanist sans' },
    { id: 'typewriter', label: 'Typewriter' }
  ];

  var DEFAULT_THEME = {
    bodyFont: 'literary',
    headingFont: 'literary',
    accent: '#b75435',
    paper: '#f7f2e8',
    ink: '#29241f',
    titleColor: '#29241f',
    choiceColor: '#29241f'
  };

  function fontStack(id) {
    switch (id) {
      case 'classic':
        return 'Georgia, "Times New Roman", Times, serif';
      case 'modern':
        return 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
      case 'humanist':
        return '"Segoe UI", "Trebuchet MS", Verdana, Arial, sans-serif';
      case 'typewriter':
        return 'ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace';
      default:
        return '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif';
    }
  }

  function normalizeHexColor(value, fallback) {
    var text = String(value == null ? '' : value).trim();
    if (/^#[0-9a-f]{3}$/i.test(text)) {
      return ('#' + text.charAt(1) + text.charAt(1) + text.charAt(2) + text.charAt(2) + text.charAt(3) + text.charAt(3)).toLowerCase();
    }
    if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
    return fallback;
  }

  function hexToRgb(value) {
    var hex = normalizeHexColor(value, '#000000').slice(1);
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16)
    };
  }

  function rgbToHex(r, g, b) {
    function channel(value) {
      var number = Math.max(0, Math.min(255, Math.round(value)));
      return (number < 16 ? '0' : '') + number.toString(16);
    }
    return '#' + channel(r) + channel(g) + channel(b);
  }

  function mixHex(from, to, amount) {
    var a = hexToRgb(from);
    var b = hexToRgb(to);
    var ratio = Math.max(0, Math.min(1, Number(amount) || 0));
    return rgbToHex(
      a.r + (b.r - a.r) * ratio,
      a.g + (b.g - a.g) * ratio,
      a.b + (b.b - a.b) * ratio
    );
  }

  function colorLuminance(value) {
    var rgb = hexToRgb(value);
    var channels = [rgb.r, rgb.g, rgb.b].map(function (channel) {
      var number = channel / 255;
      return number <= 0.03928 ? number / 12.92 : Math.pow((number + 0.055) / 1.055, 2.4);
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  }

  function normalizeTheme(raw) {
    var source = isObject(raw) ? raw : {};
    var bodyFont = FONT_CHOICES.some(function (choice) { return choice.id === source.bodyFont; })
      ? source.bodyFont
      : DEFAULT_THEME.bodyFont;
    var headingFont = FONT_CHOICES.some(function (choice) { return choice.id === source.headingFont; })
      ? source.headingFont
      : DEFAULT_THEME.headingFont;
    var ink = normalizeHexColor(source.ink, DEFAULT_THEME.ink);
    return {
      bodyFont: bodyFont,
      headingFont: headingFont,
      accent: normalizeHexColor(source.accent, DEFAULT_THEME.accent),
      paper: normalizeHexColor(source.paper, DEFAULT_THEME.paper),
      ink: ink,
      titleColor: normalizeHexColor(source.titleColor, ink),
      choiceColor: normalizeHexColor(source.choiceColor, ink)
    };
  }

  function themeVariables(theme) {
    var value = normalizeTheme(theme);
    var light = colorLuminance(value.paper) > 0.48;
    var paperDeep = light ? mixHex(value.paper, '#000000', 0.055) : mixHex(value.paper, '#000000', 0.20);
    var surface = light ? mixHex(value.paper, '#ffffff', 0.58) : mixHex(value.paper, '#ffffff', 0.09);
    var muted = mixHex(value.ink, value.paper, light ? 0.48 : 0.42);
    var faint = mixHex(value.ink, value.paper, light ? 0.68 : 0.60);
    var line = mixHex(value.paper, value.ink, light ? 0.14 : 0.24);
    var accentDark = light ? mixHex(value.accent, '#000000', 0.16) : mixHex(value.accent, '#ffffff', 0.24);
    var accentSoft = mixHex(value.accent, value.paper, light ? 0.84 : 0.72);
    var accentRgb = hexToRgb(value.accent);
    var paperRgb = hexToRgb(value.paper);
    var surfaceRgb = hexToRgb(surface);
    var inkRgb = hexToRgb(value.ink);
    return {
      '--body-font': fontStack(value.bodyFont),
      '--heading-font': fontStack(value.headingFont),
      '--body-ink': value.ink,
      '--accent': value.accent,
      '--accent-dark': accentDark,
      '--accent-soft': accentSoft,
      '--accent-rgb': accentRgb.r + ', ' + accentRgb.g + ', ' + accentRgb.b,
      '--paper': value.paper,
      '--paper-deep': paperDeep,
      '--paper-rgb': paperRgb.r + ', ' + paperRgb.g + ', ' + paperRgb.b,
      '--surface': surface,
      '--surface-rgb': surfaceRgb.r + ', ' + surfaceRgb.g + ', ' + surfaceRgb.b,
      '--ink': value.ink,
      '--ink-rgb': inkRgb.r + ', ' + inkRgb.g + ', ' + inkRgb.b,
      '--title-ink': value.titleColor,
      '--choice-ink': value.choiceColor,
      '--muted': muted,
      '--faint': faint,
      '--line': line
    };
  }

  function themeCSS(theme) {
    var variables = themeVariables(theme);
    return ':root {\n' + Object.keys(variables).map(function (name) {
      return '  ' + name + ': ' + variables[name] + ';';
    }).join('\n') + '\n}';
  }

  /* ----------------------------------------------------------------------- */
  /* Sample project and blank project                                        */
  /* ----------------------------------------------------------------------- */

  function createSampleStory() {
    return {
      version: 3,
      title: 'The Lantern at Low Tide',
      startId: 'scene_opening',
      statePanel: { title: 'Satchel & Stats' },
      copy: clone(DEFAULT_STORY_COPY),
      theme: clone(DEFAULT_THEME),
      images: {},
      categories: [
        {
          id: 'category_stats',
          title: 'Stats',
          kind: 'sheet',
          variables: [
            { id: 'stat_courage', name: 'courage', label: 'Courage', type: 'number', initial: '0' }
          ]
        },
        {
          id: 'category_inventory',
          title: 'Inventory',
          kind: 'inventory',
          variables: [
            { id: 'item_lantern', name: 'lantern', label: 'Brass Lantern', type: 'item', initial: '0' }
          ]
        }
      ],
      acts: [
        {
          id: 'act_shore',
          title: 'The Shore',
          chapters: [
            {
              id: 'chapter_low_tide',
              title: 'Low Tide',
              scenes: [
                {
                  id: 'scene_opening',
                  title: 'The Lantern at Low Tide',
                  body: 'The tide has drawn back, leaving the beach bright as hammered pewter.\n\nHalf-buried in the sand is a [b]brass lantern[/b]. Its glass is cloudy, but a little light still moves inside it.\n\nBeyond the dunes, the old lighthouse stands dark against the evening sky.\n\n[small]Somewhere out at sea, a bell rings once.[/small]',
                  mode: 'choices',
                  nextId: '',
                  nextLabel: 'Continue',
                  enterEffects: '',
                  choices: [
                    {
                      id: 'choice_take',
                      label: 'Pick up the lantern',
                      targetId: 'scene_lantern',
                      condition: '',
                      effects: 'item:lantern += 1\nvar:courage += 1'
                    },
                    {
                      id: 'choice_cliff',
                      label: 'Leave it and climb the cliff path',
                      targetId: 'scene_lighthouse',
                      condition: '',
                      effects: ''
                    },
                    {
                      id: 'choice_bell',
                      label: 'Follow the bell into the dark water',
                      targetId: 'scene_keeper',
                      condition: 'var:courage >= 2',
                      effects: 'var:courage += 1'
                    }
                  ]
                },
                {
                  id: 'scene_lantern',
                  title: 'A Light in the Glass',
                  body: 'The lantern is heavier than it looks. As your fingers close around the handle, the flame inside turns [accent]the color of a summer afternoon[/accent].\n\n[if item:lantern]The light leans toward the lighthouse, as if it knows the way.[/if]',
                  mode: 'link',
                  nextId: 'scene_lighthouse',
                  nextLabel: 'Carry the lantern up the cliff path',
                  enterEffects: '',
                  choices: []
                }
              ]
            }
          ]
        },
        {
          id: 'act_lighthouse',
          title: 'The Lighthouse',
          chapters: [
            {
              id: 'chapter_keeper_door',
              title: "The Keeper's Door",
              scenes: [
                {
                  id: 'scene_lighthouse',
                  title: "The Keeper's Door",
                  body: 'The lighthouse door is painted a green so dark it looks black. Salt has eaten the hinges. [if item:lantern]The lantern throws your shadow tall against the stone.[/if]\n\nA brass key hangs from a nail beside the door, just out of reach.',
                  mode: 'choices',
                  nextId: '',
                  nextLabel: 'Continue',
                  enterEffects: 'var:courage += 1',
                  choices: [
                    {
                      id: 'choice_key',
                      label: 'Reach for the key',
                      targetId: 'scene_keeper',
                      condition: '',
                      effects: 'var:courage += 1'
                    },
                    {
                      id: 'choice_hold',
                      label: 'Hold the lantern up to the lock',
                      targetId: 'scene_keeper',
                      condition: 'item:lantern',
                      effects: 'var:courage += 1'
                    },
                    {
                      id: 'choice_back',
                      label: 'Turn back to the beach',
                      targetId: 'scene_opening',
                      condition: '',
                      effects: ''
                    }
                  ]
                },
                {
                  id: 'scene_keeper',
                  title: "The Keeper's Room",
                  body: 'Inside, the lighthouse is all spiral stairs and warm dust. At the top, a great lens waits in the dark.\n\nYou set the lantern down. Its small flame bends, brightens, and [b]the whole room catches light[/b].\n\n[color=#b75435][big]Out at sea, the bell rings again — and this time, something rings back.[/big][/color]\n\n[if var:courage >= 3]You are not afraid. You are exactly where you are meant to be.[else]You steady yourself against the rail and decide to stay.[/if]\n\n[small]The end.[/small]',
                  mode: 'end',
                  nextId: '',
                  nextLabel: 'Continue',
                  enterEffects: '',
                  choices: []
                }
              ]
            }
          ]
        }
      ]
    };
  }

  function createBlankStory() {
    return {
      version: 3,
      title: 'Untitled Story',
      startId: 'scene_opening',
      statePanel: { title: 'Story state' },
      copy: clone(DEFAULT_STORY_COPY),
      theme: clone(DEFAULT_THEME),
      images: {},
      categories: [
        { id: 'category_stats', title: 'Stats', kind: 'sheet', variables: [] }
      ],
      acts: [
        {
          id: 'act_opening',
          title: 'Act I',
          chapters: [
            {
              id: 'chapter_opening',
              title: 'Chapter 1',
              scenes: [
                {
                  id: 'scene_opening',
                  title: 'Opening scene',
                  body: '',
                  mode: 'end',
                  nextId: '',
                  nextLabel: 'Continue',
                  enterEffects: '',
                  choices: []
                }
              ]
            }
          ]
        }
      ]
    };
  }

  function uniqueIdIn(candidate, prefix, used) {
    var id = typeof candidate === 'string' && candidate.trim() ? candidate.trim() : uid(prefix);
    while (used[id]) id = uid(prefix);
    used[id] = true;
    return id;
  }

  function normalizeVariableKey(value) {
    var name = String(value == null ? '' : value)
      .trim()
      .replace(/^(?:var|item):/i, '')
      .replace(/\s+/g, '_')
      .replace(/[^A-Za-z0-9_]/g, '_');
    if (!name) name = 'variable';
    if (!/^[A-Za-z_]/.test(name)) name = 'v_' + name;
    return name;
  }

  function uniqueVariableKey(key, used) {
    var name = key;
    var suffix = 2;
    while (used[name]) {
      name = key + suffix;
      suffix++;
    }
    used[name] = true;
    return name;
  }

  function isSafeImageDataURL(value) {
    var text = String(value == null ? '' : value);
    if (!text || text.length > 4 * 1024 * 1024) return false;
    return /^data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(text);
  }

  function normalizeImages(raw) {
    var images = {};
    if (!isObject(raw)) return images;
    var used = {};
    Object.keys(raw).forEach(function (key) {
      var entry = raw[key];
      var src = typeof entry === 'string' ? entry : entry && entry.src;
      if (!isSafeImageDataURL(src)) return;
      var id = /^[A-Za-z0-9_-]+$/.test(key) ? key : '';
      if (!id || used[id]) id = uniqueIdIn('', 'img', used);
      else used[id] = true;
      images[id] = {
        src: src,
        name: entry && typeof entry.name === 'string' && entry.name.trim()
          ? entry.name.trim().slice(0, 120)
          : 'Image'
      };
    });
    return images;
  }

  function normalizeSceneRecord(item, sceneIds) {
    if (!isObject(item)) return null;
    var id = uniqueIdIn(item.id, 'scene', sceneIds);
    var mode = item.mode === 'link' || item.mode === 'direct' ? 'link'
      : item.mode === 'end' ? 'end' : 'choices';
    var choices = [];
    var choiceIds = {};
    (Array.isArray(item.choices) ? item.choices : []).forEach(function (choice) {
      if (!isObject(choice)) return;
      var choiceId = typeof choice.id === 'string' && choice.id ? choice.id : uid('choice');
      while (choiceIds[choiceId]) choiceId = uid('choice');
      choiceIds[choiceId] = true;
      choices.push({
        id: choiceId,
        label: typeof choice.label === 'string' ? choice.label : 'New choice',
        targetId: typeof choice.targetId === 'string' ? choice.targetId : '',
        condition: typeof choice.condition === 'string' ? choice.condition : '',
        effects: typeof choice.effects === 'string' ? choice.effects : ''
      });
    });

    return {
      id: id,
      title: typeof item.title === 'string' && item.title ? item.title : 'Untitled scene',
      body: typeof item.body === 'string' ? item.body : '',
      mode: mode,
      nextId: typeof item.nextId === 'string' ? item.nextId : '',
      nextLabel: typeof item.nextLabel === 'string' && item.nextLabel ? item.nextLabel : 'Continue',
      enterEffects: typeof item.enterEffects === 'string' ? item.enterEffects : '',
      choices: choices
    };
  }

  function normalizeProject(raw) {
    if (!isObject(raw)) throw new Error('This does not look like a Storyweave project.');

    var panelTitle = isObject(raw.statePanel) && typeof raw.statePanel.title === 'string'
      ? raw.statePanel.title.trim().slice(0, 60)
      : '';
    var project = {
      version: 3,
      title: typeof raw.title === 'string' ? raw.title : 'Untitled Story',
      startId: typeof raw.startId === 'string' ? raw.startId : '',
      statePanel: { title: panelTitle || 'Story state' },
      copy: normalizeStoryCopy(raw.copy),
      theme: normalizeTheme(raw.theme),
      images: normalizeImages(raw.images),
      categories: [],
      acts: []
    };

    var actIds = {};
    var chapterIds = {};
    var sceneIds = {};
    var rawActs = Array.isArray(raw.acts) ? raw.acts : null;

    if (rawActs) {
      rawActs.forEach(function (actItem) {
        if (!isObject(actItem)) return;
        var act = {
          id: uniqueIdIn(actItem.id, 'act', actIds),
          title: typeof actItem.title === 'string' && actItem.title ? actItem.title : 'Untitled act',
          chapters: []
        };
        (Array.isArray(actItem.chapters) ? actItem.chapters : []).forEach(function (chapterItem) {
          if (!isObject(chapterItem)) return;
          var chapter = {
            id: uniqueIdIn(chapterItem.id, 'chapter', chapterIds),
            title: typeof chapterItem.title === 'string' && chapterItem.title
              ? chapterItem.title
              : 'Untitled chapter',
            scenes: []
          };
          (Array.isArray(chapterItem.scenes) ? chapterItem.scenes : []).forEach(function (sceneItem) {
            var scene = normalizeSceneRecord(sceneItem, sceneIds);
            if (scene) chapter.scenes.push(scene);
          });
          act.chapters.push(chapter);
        });
        project.acts.push(act);
      });
    } else if (Array.isArray(raw.chapters) && raw.chapters.length) {
      var legacyScenes = [];
      raw.chapters.forEach(function (sceneItem) {
        var scene = normalizeSceneRecord(sceneItem, sceneIds);
        if (scene) legacyScenes.push(scene);
      });
      project.acts = [{
        id: 'act_legacy',
        title: 'Act I',
        chapters: [{
          id: 'chapter_legacy',
          title: 'Chapter 1',
          scenes: legacyScenes
        }]
      }];
    }

    if (!projectScenes(project).length) {
      var blank = createBlankStory();
      project.acts = blank.acts;
      project.startId = blank.startId;
    }

    var first = projectScenes(project)[0];
    if (!project.startId || !projectScenes(project).some(function (scene) {
      return scene.id === project.startId;
    })) {
      project.startId = first.id;
    }

    var variableIds = {};
    var variableKeys = {};
    var categoryIds = {};

    function normalizeVariable(item, categoryKind) {
      if (!isObject(item)) return null;
      var key = uniqueVariableKey(
        normalizeVariableKey(item.name == null ? item.key : item.name),
        variableKeys
      );
      var label = typeof item.label === 'string' && item.label.trim()
        ? item.label.trim().slice(0, 60)
        : humanizeVariableName(key);
      var id = uniqueIdIn(item.id, categoryKind === 'inventory' ? 'item' : 'stat', variableIds);

      if (categoryKind === 'inventory') {
        var count = Number(item.initial);
        if (!isFinite(count) || count < 0) count = 0;
        return {
          id: id,
          name: key,
          label: label,
          type: 'item',
          initial: String(count)
        };
      }

      var type = item.type === 'boolean' ? 'boolean'
        : item.type === 'text' ? 'text'
          : 'number';
      var initial = item.initial == null ? '' : String(item.initial);
      if (type === 'boolean') initial = initial.toLowerCase() === 'true' ? 'true' : 'false';
      return {
        id: id,
        name: key,
        label: label,
        type: type,
        initial: initial
      };
    }

    function normalizeCategory(rawCategory, fallbackKind) {
      if (!isObject(rawCategory)) return null;
      var kind = rawCategory.kind === 'inventory' ? 'inventory' : (fallbackKind || 'sheet');
      var title = typeof rawCategory.title === 'string' && rawCategory.title.trim()
        ? rawCategory.title.trim().slice(0, 60)
        : (kind === 'inventory' ? 'Inventory' : 'Stats');
      var category = {
        id: uniqueIdIn(rawCategory.id, 'category', categoryIds),
        title: title,
        kind: kind,
        variables: []
      };
      (Array.isArray(rawCategory.variables) ? rawCategory.variables : []).forEach(function (item) {
        var variable = normalizeVariable(item, kind);
        if (variable) category.variables.push(variable);
      });
      return category;
    }

    var rawCategories = Array.isArray(raw.categories) ? raw.categories : null;
    if (rawCategories && rawCategories.length) {
      rawCategories.forEach(function (rawCategory) {
        var category = normalizeCategory(rawCategory, 'sheet');
        if (category) project.categories.push(category);
      });
    } else {
      var stats = [];
      var items = [];
      if (Array.isArray(raw.stats) || Array.isArray(raw.items)) {
        (Array.isArray(raw.stats) ? raw.stats : []).forEach(function (item) {
          (item && item.type === 'item' ? items : stats).push(item);
        });
        (Array.isArray(raw.items) ? raw.items : []).forEach(function (item) {
          items.push(item);
        });
      } else if (Array.isArray(raw.variables)) {
        raw.variables.forEach(function (item) {
          (item && item.type === 'item' ? items : stats).push(item);
        });
      }

      var statsCategory = normalizeCategory({
        id: 'category_stats',
        title: 'Stats',
        kind: 'sheet',
        variables: stats
      }, 'sheet');
      var inventoryCategory = normalizeCategory({
        id: 'category_inventory',
        title: 'Inventory',
        kind: 'inventory',
        variables: items
      }, 'inventory');

      if (statsCategory && (statsCategory.variables.length || !inventoryCategory || !inventoryCategory.variables.length)) {
        project.categories.push(statsCategory);
      }
      if (inventoryCategory && inventoryCategory.variables.length) {
        project.categories.push(inventoryCategory);
      }
    }

    if (!project.categories.length) {
      project.categories.push({
        id: uniqueIdIn('category_stats', 'category', categoryIds),
        title: 'Stats',
        kind: 'sheet',
        variables: []
      });
    }

    return project;
  }

  function loadProject() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return normalizeProject(JSON.parse(raw));
    } catch (error) {
      return null;
    }
  }

  /* ----------------------------------------------------------------------- */
  /* Saving, status, toast                                                   */
  /* ----------------------------------------------------------------------- */

  function setSaveState(text, mode) {
    if (!els.saveState) return;
    els.saveState.innerHTML = '<span class="save-dot"></span>' + esc(text);
    els.saveState.className = 'save-state' + (mode ? ' is-' + mode : '');
  }

  function persistProject(showState) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(story));
      dirty = false;
      if (showState !== false) setSaveState('Saved locally', 'saved');
      return true;
    } catch (error) {
      setSaveState('Autosave unavailable', 'error');
      return false;
    }
  }

  function markDirty() {
    dirty = true;
    setSaveState('Saving…', 'saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      persistProject(true);
    }, SAVE_DELAY);
  }

  function saveImmediately(showToast) {
    clearTimeout(saveTimer);
    var saved = persistProject(true);
    if (showToast) {
      showToast(saved ? 'Project saved in this browser.' : 'Could not save to browser storage.', saved ? 'success' : 'error');
    }
  }

  function showToast(message, tone) {
    if (!els.toast) return;
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.className = 'toast is-visible' + (tone ? ' is-' + tone : '');
    toastTimer = setTimeout(function () {
      els.toast.className = 'toast';
    }, 2800);
  }

  /* ----------------------------------------------------------------------- */
  /* Boot                                                                    */
  /* ----------------------------------------------------------------------- */

  function init() {
    els.storyTitle = document.getElementById('storyTitle');
    els.saveState = document.getElementById('saveState');
    els.sceneCount = document.getElementById('sceneCount');
    els.storyTree = document.getElementById('storyTree');
    els.startSceneSelect = document.getElementById('startSceneSelect');
    els.editorPane = document.getElementById('editorPane');
    els.categoryList = document.getElementById('categoryList');
    els.statePanelTitle = document.getElementById('statePanelTitle');
    els.coverSubtitle = document.getElementById('coverSubtitle');
    els.endingTitle = document.getElementById('endingTitle');
    els.endingMessage = document.getElementById('endingMessage');
    els.endingButton = document.getElementById('endingButton');
    els.themeBodyFont = document.getElementById('themeBodyFont');
    els.themeHeadingFont = document.getElementById('themeHeadingFont');
    els.themeAccent = document.getElementById('themeAccent');
    els.themePaper = document.getElementById('themePaper');
    els.themeInk = document.getElementById('themeInk');
    els.themeTitleColor = document.getElementById('themeTitleColor');
    els.themeChoiceColor = document.getElementById('themeChoiceColor');
    els.imageList = document.getElementById('imageList');
    els.imageInput = document.getElementById('imageInput');
    els.playOverlay = document.getElementById('playOverlay');
    els.playContent = document.getElementById('playContent');
    els.playCloseBtn = document.getElementById('playCloseBtn');
    els.playRestartBtn = document.getElementById('playRestartBtn');
    els.restartOverlay = document.getElementById('restartOverlay');
    els.restartConfirmInput = document.getElementById('restartConfirmInput');
    els.restartConfirmBtn = document.getElementById('restartConfirmBtn');
    els.restartConfirmHint = document.getElementById('restartConfirmHint');
    els.restartCloseBtn = document.getElementById('restartCloseBtn');
    els.restartCancelBtn = document.getElementById('restartCancelBtn');
    els.exportBtn = document.getElementById('exportBtn');
    els.exportMenu = document.getElementById('exportMenu');
    els.fileInput = document.getElementById('fileInput');
    els.toast = document.getElementById('toast');

    var loaded = loadProject();
    if (loaded) {
      story = loaded;
      setSaveState('Saved locally', 'saved');
    } else {
      story = createSampleStory();
      persistProject(false);
      setSaveState('Saved locally', 'saved');
    }

    currentId = story.startId;
    ensureCurrentScene();

    syncHeader(false);
    bindStaticEvents();
    renderAll();

    if (!loaded) {
      setTimeout(function () {
        showToast('Sample story loaded. Press New for a blank project.', 'info');
      }, 500);
    }
  }

  function syncHeader(touchTitle) {
    if (els.storyTitle) els.storyTitle.value = story.title || '';
    document.title = (story.title || 'Untitled Story') + ' · Storyweave';
    if (touchTitle !== false) {
      // Kept for call-site clarity: values are already written above.
    }
  }

  function bindStaticEvents() {
    els.storyTitle.addEventListener('input', function () {
      story.title = els.storyTitle.value;
      document.title = (story.title || 'Untitled Story') + ' · Storyweave';
      markDirty();
    });

    document.getElementById('newBtn').addEventListener('click', newProject);
    document.getElementById('importBtn').addEventListener('click', function () {
      els.fileInput.click();
    });
    document.getElementById('addActBtn').addEventListener('click', addAct);
    document.getElementById('playBtn').addEventListener('click', openPlaytest);
    document.getElementById('addCategoryBtn').addEventListener('click', addCategory);
    document.getElementById('uploadImageBtn').addEventListener('click', function () {
      imageInsertAtCursor = false;
      els.imageInput.click();
    });
    document.getElementById('resetThemeBtn').addEventListener('click', resetTheme);
    els.imageInput.addEventListener('change', handleImageInputChange);

    els.exportBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      toggleExportMenu();
    });
    els.exportMenu.addEventListener('click', function (event) {
      var button = event.target.closest('[data-export]');
      if (!button) return;
      closeExportMenu();
      if (button.dataset.export === 'html') exportStoryHTML();
      else exportProjectJSON();
    });

    els.fileInput.addEventListener('change', importProjectFile);

    els.startSceneSelect.addEventListener('change', function () {
      if (!sceneById(els.startSceneSelect.value)) return;
      story.startId = els.startSceneSelect.value;
      markDirty();
      renderSidebar();
      renderEditor();
      showToast('The story will begin at “' + sceneTitle(story.startId) + '”.');
    });

    els.playCloseBtn.addEventListener('click', closePlaytest);
    els.playRestartBtn.addEventListener('click', function () {
      openRestartConfirm(restartPlaytest);
    });
    els.playOverlay.addEventListener('click', function (event) {
      if (event.target === els.playOverlay) closePlaytest();
    });

    els.restartConfirmInput.addEventListener('input', updateRestartConfirmState);
    els.restartConfirmInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !els.restartConfirmBtn.disabled) {
        event.preventDefault();
        closeRestartConfirm(true);
      }
    });
    els.restartConfirmBtn.addEventListener('click', function () {
      closeRestartConfirm(true);
    });
    els.restartCloseBtn.addEventListener('click', function () {
      closeRestartConfirm(false);
    });
    els.restartCancelBtn.addEventListener('click', function () {
      closeRestartConfirm(false);
    });
    els.restartOverlay.addEventListener('click', function (event) {
      if (event.target === els.restartOverlay) closeRestartConfirm(false);
    });

    document.addEventListener('click', handleDelegatedClick);
    document.addEventListener('input', handleInput);
    document.addEventListener('change', handleChange);

    document.addEventListener('keydown', handleKeydown);
    window.addEventListener('beforeunload', function () {
      if (dirty) persistProject(false);
    });
    window.addEventListener('pagehide', function () {
      if (dirty) persistProject(false);
    });
  }

  function handleKeydown(event) {
    if (els.restartOverlay && !els.restartOverlay.hidden) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRestartConfirm(false);
      }
      return;
    }

    var key = event.key.toLowerCase();
    var command = event.ctrlKey || event.metaKey;

    if (event.key === 'Escape') {
      if (!els.playOverlay.hidden) {
        closePlaytest();
        return;
      }
      closeExportMenu();
      return;
    }

    if (command && key === 's') {
      event.preventDefault();
      saveImmediately(true);
      return;
    }

    if (command && (key === 'b' || key === 'i' || key === 'u')) {
      var textarea = document.getElementById('sceneBody');
      if (document.activeElement === textarea) {
        event.preventDefault();
        if (key === 'b') wrapSelection('[b]', '[/b]', 'bold text');
        if (key === 'i') wrapSelection('[i]', '[/i]', 'italic text');
        if (key === 'u') wrapSelection('[u]', '[/u]', 'underlined text');
      }
    }
  }

  /* ----------------------------------------------------------------------- */
  /* Rendering: sidebar                                                      */
  /* ----------------------------------------------------------------------- */

  function renderAll() {
    renderSidebar();
    renderEditor();
    renderVariables();
  }

  function renderStartOptions() {
    if (!els.startSceneSelect) return;
    els.startSceneSelect.innerHTML = story.acts.map(function (act) {
      var options = act.chapters.map(function (chapter) {
        return chapter.scenes.map(function (scene) {
          return '<option value="' + esc(scene.id) + '"' + (scene.id === story.startId ? ' selected' : '') + '>'
            + esc(chapter.title || 'Chapter') + ' · ' + esc(scene.title || 'Untitled scene') + '</option>';
        }).join('');
      }).join('');
      return options ? '<optgroup label="' + esc(act.title || 'Act') + '">' + options + '</optgroup>' : '';
    }).join('');
  }

  function renderSidebar() {
    if (!els.storyTree) return;
    ensureCurrentScene();
    els.sceneCount.textContent = String(allScenes().length);

    els.storyTree.innerHTML = story.acts.map(function (act, actPosition) {
      var chaptersHTML = act.chapters.length
        ? act.chapters.map(function (chapter, chapterPosition) {
          var scenesHTML = chapter.scenes.length
            ? chapter.scenes.map(function (scene, scenePosition) {
              var active = scene.id === currentId;
              var isStart = scene.id === story.startId;
              var warnings = sceneWarnings(scene);
              var meta;
              if (scene.mode === 'choices') {
                meta = scene.choices.length
                  ? scene.choices.length + (scene.choices.length === 1 ? ' choice' : ' choices')
                  : 'No choices yet';
              } else if (scene.mode === 'link') {
                meta = scene.nextId && sceneById(scene.nextId)
                  ? '→ ' + sceneTitle(scene.nextId)
                  : 'No destination';
              } else {
                meta = 'Ending';
              }

              return '<button type="button" class="scene-item' + (active ? ' is-active' : '') + '" data-action="select-scene" data-id="' + esc(scene.id) + '">'
                + '<span class="scene-index">' + pad(scenePosition + 1) + '</span>'
                + '<span class="scene-item-main">'
                + '<span class="scene-item-title">' + esc(scene.title || 'Untitled scene') + '</span>'
                + '<span class="scene-item-meta">' + esc(meta) + '</span>'
                + '</span>'
                + '<span class="scene-item-side">'
                + (isStart ? '<span class="start-pill">Start</span>' : '')
                + (warnings.length ? '<span class="warn-dot" title="' + esc(warnings.join(' ')) + '">!</span>' : '')
                + '</span>'
                + '</button>';
            }).join('')
            : '<div class="tree-empty"><p>No scenes yet.</p><button type="button" class="tree-add" data-action="add-scene" data-chapter-id="' + esc(chapter.id) + '">+ Add scene</button></div>';

          return '<section class="chapter-node">'
            + '<div class="tree-row chapter-row">'
            + '<span class="tree-mark" aria-hidden="true">§</span>'
            + '<input class="tree-title" type="text" value="' + esc(chapter.title) + '" data-chapter-field="title" data-chapter-id="' + esc(chapter.id) + '" aria-label="Chapter title" placeholder="Chapter title" spellcheck="false">'
            + '<div class="tree-actions">'
            + '<button type="button" class="tree-btn" data-action="move-chapter" data-direction="-1" data-chapter-id="' + esc(chapter.id) + '" title="Move chapter up" aria-label="Move chapter up"' + (chapterPosition === 0 ? ' disabled' : '') + '>↑</button>'
            + '<button type="button" class="tree-btn" data-action="move-chapter" data-direction="1" data-chapter-id="' + esc(chapter.id) + '" title="Move chapter down" aria-label="Move chapter down"' + (chapterPosition === act.chapters.length - 1 ? ' disabled' : '') + '>↓</button>'
            + '<button type="button" class="tree-btn tree-btn-add" data-action="add-scene" data-chapter-id="' + esc(chapter.id) + '" title="Add scene" aria-label="Add scene to ' + esc(chapter.title || 'chapter') + '">+</button>'
            + '<button type="button" class="tree-btn danger" data-action="delete-chapter" data-chapter-id="' + esc(chapter.id) + '"' + (act.chapters.length <= 1 ? ' disabled title="An act needs at least one chapter"' : ' title="Delete chapter"') + ' aria-label="Delete chapter ' + esc(chapter.title || '') + '">×</button>'
            + '</div>'
            + '</div>'
            + '<div class="scene-list">' + scenesHTML + '</div>'
            + '</section>';
        }).join('')
        : '<div class="tree-empty"><p>No chapters yet.</p><button type="button" class="tree-add" data-action="add-chapter" data-act-id="' + esc(act.id) + '">+ Add chapter</button></div>';

      return '<section class="act-node">'
        + '<div class="tree-row act-row">'
        + '<span class="tree-mark act-mark" aria-hidden="true">A</span>'
        + '<input class="tree-title act-title" type="text" value="' + esc(act.title) + '" data-act-field="title" data-act-id="' + esc(act.id) + '" aria-label="Act title" placeholder="Act title" spellcheck="false">'
        + '<div class="tree-actions">'
        + '<button type="button" class="tree-btn" data-action="move-act" data-direction="-1" data-act-id="' + esc(act.id) + '" title="Move act up" aria-label="Move act up"' + (actPosition === 0 ? ' disabled' : '') + '>↑</button>'
        + '<button type="button" class="tree-btn" data-action="move-act" data-direction="1" data-act-id="' + esc(act.id) + '" title="Move act down" aria-label="Move act down"' + (actPosition === story.acts.length - 1 ? ' disabled' : '') + '>↓</button>'
        + '<button type="button" class="tree-btn tree-btn-add" data-action="add-chapter" data-act-id="' + esc(act.id) + '" title="Add chapter" aria-label="Add chapter to ' + esc(act.title || 'act') + '">+</button>'
        + '<button type="button" class="tree-btn danger" data-action="delete-act" data-act-id="' + esc(act.id) + '"' + (story.acts.length <= 1 ? ' disabled title="A story needs at least one act"' : ' title="Delete act"') + ' aria-label="Delete act ' + esc(act.title || '') + '">×</button>'
        + '</div>'
        + '</div>'
        + '<div class="chapter-list-tree">' + chaptersHTML + '</div>'
        + '</section>';
    }).join('');

    renderStartOptions();

    var activeScene = els.storyTree.querySelector('.scene-item.is-active');
    if (activeScene && typeof activeScene.scrollIntoView === 'function') {
      activeScene.scrollIntoView({ block: 'nearest' });
    }
  }

  function sceneWarnings(scene) {
    var warnings = [];
    if (scene.mode === 'choices' && !scene.choices.length) {
      warnings.push('This scene has no choices.');
    }
    if (scene.mode === 'link') {
      if (!scene.nextId) warnings.push('This scene has no destination.');
      else if (!sceneById(scene.nextId)) warnings.push('The destination scene is missing.');
    }
    if (scene.mode === 'choices') {
      scene.choices.forEach(function (choice) {
        if (choice.targetId && !sceneById(choice.targetId)) {
          warnings.push('A choice points to a missing scene.');
        }
      });
    }
    return warnings;
  }

  /* ----------------------------------------------------------------------- */
  /* Rendering: variables                                                    */
  /* ----------------------------------------------------------------------- */

  function variableHintHTML(variable, kind) {
    var id = variable.name.trim() || 'name';
    if (kind === 'item') {
      return 'Use <code>[item:' + esc(id) + ']</code> in text and <code>item:' + esc(id) + '</code> in conditions or effects.';
    }
    return 'Use <code>[var:' + esc(id) + ']</code> in text and <code>var:' + esc(id) + '</code> in conditions or effects.';
  }

  function renderStatCard(stat) {
    var display = variableDisplayName(stat);
    var initialField;
    if (stat.type === 'number') {
      initialField = '<input class="input var-initial" type="number" step="any" value="' + esc(stat.initial) + '" data-var-field="initial" data-var-id="' + esc(stat.id) + '" aria-label="Starting value for ' + esc(display) + '">';
    } else if (stat.type === 'boolean') {
      var isTrue = stat.initial === 'true';
      initialField = '<select class="select var-initial" data-var-field="initial" data-var-id="' + esc(stat.id) + '" aria-label="Starting value for ' + esc(display) + '">'
        + '<option value="false"' + (!isTrue ? ' selected' : '') + '>false</option>'
        + '<option value="true"' + (isTrue ? ' selected' : '') + '>true</option>'
        + '</select>';
    } else {
      initialField = '<input class="input var-initial" type="text" value="' + esc(stat.initial) + '" data-var-field="initial" data-var-id="' + esc(stat.id) + '" aria-label="Starting value for ' + esc(display) + '">';
    }

    return '<div class="variable-card" data-var-id="' + esc(stat.id) + '" data-var-kind="stat">'
      + '<div class="variable-head">'
      + '<input class="input var-label" type="text" value="' + esc(display) + '" data-var-field="label" data-var-id="' + esc(stat.id) + '" aria-label="Stat display name" placeholder="Display name" spellcheck="false">'
      + '<button type="button" class="icon-btn tiny danger" data-action="delete-variable" data-id="' + esc(stat.id) + '" title="Delete stat" aria-label="Delete ' + esc(display) + '">×</button>'
      + '</div>'
      + '<div class="var-id-row">'
      + '<span class="var-id-prefix" aria-hidden="true">var:</span>'
      + '<input class="input var-name" type="text" value="' + esc(stat.name) + '" data-var-field="name" data-var-id="' + esc(stat.id) + '" aria-label="Stat ID" placeholder="id" spellcheck="false">'
      + '</div>'
      + '<div class="variable-row">'
      + '<select class="select var-type" data-var-field="type" data-var-id="' + esc(stat.id) + '" aria-label="Type for ' + esc(display) + '">'
      + '<option value="number"' + (stat.type === 'number' ? ' selected' : '') + '>Number</option>'
      + '<option value="text"' + (stat.type === 'text' ? ' selected' : '') + '>Text</option>'
      + '<option value="boolean"' + (stat.type === 'boolean' ? ' selected' : '') + '>True / false</option>'
      + '</select>'
      + '<span class="var-equals" aria-hidden="true">=</span>'
      + initialField
      + '</div>'
      + '<p class="var-hint">' + variableHintHTML(stat, 'stat') + '</p>'
      + '</div>';
  }

  function renderItemCard(item) {
    var display = variableDisplayName(item);
    return '<div class="variable-card is-item" data-var-id="' + esc(item.id) + '" data-var-kind="item">'
      + '<div class="variable-head">'
      + '<input class="input var-label" type="text" value="' + esc(display) + '" data-var-field="label" data-var-id="' + esc(item.id) + '" aria-label="Item display name" placeholder="Display name" spellcheck="false">'
      + '<button type="button" class="icon-btn tiny danger" data-action="delete-variable" data-id="' + esc(item.id) + '" title="Delete item" aria-label="Delete ' + esc(display) + '">×</button>'
      + '</div>'
      + '<div class="var-id-row">'
      + '<span class="var-id-prefix item-prefix" aria-hidden="true">item:</span>'
      + '<input class="input var-name" type="text" value="' + esc(item.name) + '" data-var-field="name" data-var-id="' + esc(item.id) + '" aria-label="Item ID" placeholder="id" spellcheck="false">'
      + '</div>'
      + '<div class="variable-row">'
      + '<span class="var-kind-label">Starts with</span>'
      + '<span class="var-equals" aria-hidden="true">=</span>'
      + '<input class="input var-initial" type="number" step="1" min="0" value="' + esc(item.initial) + '" data-var-field="initial" data-var-id="' + esc(item.id) + '" aria-label="Starting count for ' + esc(display) + '">'
      + '</div>'
      + '<p class="var-hint">' + variableHintHTML(item, 'item') + '</p>'
      + '</div>';
  }

  function renderCategoryCard(category, index) {
    var categories = allCategories();
    var isInventory = category.kind === 'inventory';
    var variables = Array.isArray(category.variables) ? category.variables : [];
    var variablesHTML = variables.length
      ? variables.map(function (variable) {
        return isInventory ? renderItemCard(variable) : renderStatCard(variable);
      }).join('')
      : '<div class="variable-empty"><p>No variables in this category yet.</p><button type="button" class="btn btn-small btn-soft" data-action="add-variable" data-category-id="' + esc(category.id) + '">Add a variable</button></div>';

    return '<section class="category-card' + (isInventory ? ' is-inventory' : '') + '" data-category-id="' + esc(category.id) + '">'
      + '<div class="category-head">'
      + '<input class="input category-title" type="text" value="' + esc(category.title) + '" data-category-field="title" data-category-id="' + esc(category.id) + '" aria-label="Category name" placeholder="Category name" spellcheck="false">'
      + '<div class="category-actions">'
      + '<button type="button" class="icon-btn tiny" data-action="move-category" data-direction="-1" data-category-id="' + esc(category.id) + '" title="Move category up" aria-label="Move category up"' + (index === 0 ? ' disabled' : '') + '>↑</button>'
      + '<button type="button" class="icon-btn tiny" data-action="move-category" data-direction="1" data-category-id="' + esc(category.id) + '" title="Move category down" aria-label="Move category down"' + (index === categories.length - 1 ? ' disabled' : '') + '>↓</button>'
      + '<button type="button" class="icon-btn tiny danger" data-action="delete-category" data-category-id="' + esc(category.id) + '" title="Delete category" aria-label="Delete category ' + esc(category.title || '') + '">×</button>'
      + '</div>'
      + '</div>'
      + '<div class="category-subhead">'
      + '<select class="select category-kind" data-category-field="kind" data-category-id="' + esc(category.id) + '" aria-label="Display style for ' + esc(category.title || 'category') + '">'
      + '<option value="sheet"' + (!isInventory ? ' selected' : '') + '>Stat sheet</option>'
      + '<option value="inventory"' + (isInventory ? ' selected' : '') + '>Inventory</option>'
      + '</select>'
      + '<button type="button" class="btn btn-small btn-soft" data-action="add-variable" data-category-id="' + esc(category.id) + '">+ Variable</button>'
      + '</div>'
      + '<div class="category-vars">' + variablesHTML + '</div>'
      + '</section>';
  }

  function formatImageSize(length) {
    var bytes = Math.max(0, Math.round(Number(length || 0) * 3 / 4));
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (Math.round(bytes / (1024 * 1024) * 10) / 10) + ' MB';
  }

  function renderImageList() {
    if (!els.imageList) return;
    var images = story.images || {};
    var ids = Object.keys(images);
    els.imageList.innerHTML = ids.length
      ? ids.map(function (id) {
        var image = images[id] || {};
        return '<div class="image-item">'
          + '<img class="image-thumb" src="' + esc(image.src || '') + '" alt="">'
          + '<div class="image-meta">'
          + '<span class="image-name">' + esc(image.name || 'Image') + '</span>'
          + '<span class="image-size">' + esc(formatImageSize((image.src || '').length)) + ' embedded</span>'
          + '</div>'
          + '<div class="image-actions">'
          + '<button type="button" class="btn btn-small btn-soft" data-action="insert-image-ref" data-image-id="' + esc(id) + '">Insert</button>'
          + '<button type="button" class="icon-btn tiny danger" data-action="delete-image" data-image-id="' + esc(id) + '" title="Delete image" aria-label="Delete image ' + esc(image.name || '') + '">×</button>'
          + '</div>'
          + '</div>';
      }).join('')
      : '<div class="variable-empty"><p>No images yet. Upload one to embed it in the story file.</p><button type="button" class="btn btn-small btn-soft" data-action="upload-image">Upload image</button></div>';
  }

  function renderThemeControls() {
    var theme = normalizeTheme(story.theme);
    if (els.themeBodyFont) els.themeBodyFont.value = theme.bodyFont;
    if (els.themeHeadingFont) els.themeHeadingFont.value = theme.headingFont;
    if (els.themeAccent) els.themeAccent.value = theme.accent;
    if (els.themePaper) els.themePaper.value = theme.paper;
    if (els.themeInk) els.themeInk.value = theme.ink;
    if (els.themeTitleColor) els.themeTitleColor.value = theme.titleColor;
    if (els.themeChoiceColor) els.themeChoiceColor.value = theme.choiceColor;
  }

  function renderStoryCopyControls() {
    var copy = normalizeStoryCopy(story.copy);
    if (els.coverSubtitle && document.activeElement !== els.coverSubtitle) els.coverSubtitle.value = copy.coverSubtitle;
    if (els.endingTitle && document.activeElement !== els.endingTitle) els.endingTitle.value = copy.endingTitle;
    if (els.endingMessage && document.activeElement !== els.endingMessage) els.endingMessage.value = copy.endingMessage;
    if (els.endingButton && document.activeElement !== els.endingButton) els.endingButton.value = copy.endingButton;
  }

  function renderVariables() {
    if (els.statePanelTitle && document.activeElement !== els.statePanelTitle) {
      els.statePanelTitle.value = statePanelTitle();
    }

    if (els.categoryList) {
      var categories = allCategories();
      els.categoryList.innerHTML = categories.length
        ? categories.map(renderCategoryCard).join('')
        : '<div class="variable-empty"><p>No categories yet. Add one for stats, inventory, notes, or hints.</p><button type="button" class="btn btn-small btn-soft" data-action="add-category">Add a category</button></div>';
    }

    renderStoryCopyControls();
    renderThemeControls();
    renderImageList();
  }

  function applyThemeToPreview() {
    var container = document.getElementById('scenePreview');
    if (!container) return;
    var variables = themeVariables(story.theme);
    Object.keys(variables).forEach(function (name) {
      container.style.setProperty(name, variables[name]);
    });
  }

  /* ----------------------------------------------------------------------- */
  /* Rendering: editor                                                       */
  /* ----------------------------------------------------------------------- */

  function renderEditor() {
    var context = currentContext();
    if (!context) {
      els.editorPane.innerHTML = '<div class="editor-inner"><div class="empty-editor"><span aria-hidden="true">✦</span><h2>No scene selected</h2><p>Add a scene from the story map to begin writing.</p></div></div>';
      return;
    }

    var scene = context.scene;
    var isStart = scene.id === story.startId;
    var previewActive = editorView === 'preview';

    els.editorPane.innerHTML = '<div class="editor-inner">'
      + '<div class="chapter-heading">'
      + '<div class="chapter-heading-main">'
      + '<p class="eyebrow scene-crumbs">'
      + '<span>Act ' + (context.actIndex + 1) + '</span>'
      + '<span class="eyebrow-sep">›</span>'
      + '<span data-crumb="act-title">' + esc(context.act.title || 'Untitled act') + '</span>'
      + '<span class="eyebrow-sep">›</span>'
      + '<span>Chapter ' + (context.chapterIndex + 1) + '</span>'
      + '<span class="eyebrow-sep">›</span>'
      + '<span data-crumb="chapter-title">' + esc(context.chapter.title || 'Untitled chapter') + '</span>'
      + '<span class="eyebrow-sep">·</span>'
      + '<span>' + esc(sceneModeLabel(scene.mode)) + '</span>'
      + '</p>'
      + '<input id="sceneTitle" class="chapter-title-input" type="text" value="' + esc(scene.title) + '" placeholder="Scene title" aria-label="Scene title" spellcheck="false">'
      + '</div>'
      + '<div class="chapter-actions">'
      + '<div class="move-group" aria-label="Reorder scene">'
      + '<button type="button" class="icon-btn" data-action="move-scene" data-direction="-1" title="Move scene up" aria-label="Move scene up"' + (context.sceneIndex === 0 ? ' disabled' : '') + '>↑</button>'
      + '<button type="button" class="icon-btn" data-action="move-scene" data-direction="1" title="Move scene down" aria-label="Move scene down"' + (context.sceneIndex === context.chapter.scenes.length - 1 ? ' disabled' : '') + '>↓</button>'
      + '</div>'
      + '<button type="button" class="btn btn-small ' + (isStart ? 'btn-start is-current' : 'btn-soft') + '" data-action="set-start"' + (isStart ? ' disabled' : '') + '>'
      + (isStart ? '★ Opening scene' : 'Make opening')
      + '</button>'
      + '<button type="button" class="btn btn-small btn-danger-ghost" data-action="delete-scene"' + (context.chapter.scenes.length <= 1 ? ' disabled title="A chapter needs at least one scene"' : '') + '>Delete</button>'
      + '</div>'
      + '</div>'

      + '<section class="card body-card' + (previewActive ? ' preview-mode' : '') + '" id="bodyCard">'
      + '<div class="card-head body-card-head">'
      + '<div class="segmented mini" role="tablist" aria-label="Scene view">'
      + '<button type="button" role="tab" class="segment-btn' + (!previewActive ? ' is-active' : '') + '" aria-selected="' + (!previewActive) + '" data-action="view-write">Write</button>'
      + '<button type="button" role="tab" class="segment-btn' + (previewActive ? ' is-active' : '') + '" aria-selected="' + previewActive + '" data-action="view-preview">Preview</button>'
      + '</div>'
      + '<div class="format-toolbar" role="toolbar" aria-label="Text formatting">'
      + '<div class="tool-group">'
      + '<button type="button" class="tool-btn tool-bold" data-action="wrap" data-before="[b]" data-after="[/b]" data-placeholder="bold text" title="Bold">B</button>'
      + '<button type="button" class="tool-btn tool-italic" data-action="wrap" data-before="[i]" data-after="[/i]" data-placeholder="italic text" title="Italic">I</button>'
      + '<button type="button" class="tool-btn tool-underline" data-action="wrap" data-before="[u]" data-after="[/u]" data-placeholder="underlined text" title="Underline">U</button>'
      + '<button type="button" class="tool-btn tool-strike" data-action="wrap" data-before="[s]" data-after="[/s]" data-placeholder="struck text" title="Strikethrough">S</button>'
      + '</div>'
      + '<div class="tool-group">'
      + '<button type="button" class="tool-btn" data-action="wrap" data-before="[big]" data-after="[/big]" data-placeholder="big text" title="Big text">A<span class="tool-super">↑</span></button>'
      + '<button type="button" class="tool-btn" data-action="wrap" data-before="[small]" data-after="[/small]" data-placeholder="small text" title="Small text">A<span class="tool-sub">↓</span></button>'
      + '<button type="button" class="tool-btn tool-color" data-action="wrap" data-before="[color=#b75435]" data-after="[/color]" data-placeholder="warm text" title="Colored text">A</button>'
      + '<button type="button" class="tool-btn" data-action="wrap" data-before="[mark]" data-after="[/mark]" data-placeholder="highlighted text" title="Highlight">▮</button>'
      + '<button type="button" class="tool-btn" data-action="wrap" data-before="[center]" data-after="[/center]" data-placeholder="centered text" title="Centered block">↔</button>'
      + '</div>'
      + '<div class="tool-group">'
      + '<button type="button" class="tool-btn tool-text" data-action="snippet" data-snippet="var" title="Insert stat value">var</button>'
      + '<button type="button" class="tool-btn tool-text" data-action="snippet" data-snippet="if" title="Insert condition">if</button>'
      + '<button type="button" class="tool-btn tool-text" data-action="insert-image" title="Insert embedded image">img</button>'
      + '</div>'
      + '</div>'
      + '</div>'

      + '<div class="write-pane" id="writePane"' + (previewActive ? ' hidden' : '') + '>'
      + '<textarea id="sceneBody" class="chapter-body" placeholder="Write the scene here. Use the toolbar or type special commands directly…" spellcheck="true">' + esc(scene.body) + '</textarea>'
      + '</div>'
      + '<div class="preview-pane" id="previewPane"' + (!previewActive ? ' hidden' : '') + '>'
      + '<div id="scenePreview" class="story-content" aria-live="polite"></div>'
      + '</div>'

      + '<div class="body-foot">'
      + '<span id="bodyMeta" class="body-meta">' + esc(bodyMetaText(scene.body)) + '</span>'
      + '<span class="body-hint">Preview uses the initial stat and inventory values.</span>'
      + '</div>'
      + '</section>'

      + flowCardHTML(scene)
      + '</div>';

    if (previewActive) renderPreview();
  }

  function bodyMetaText(body) {
    var plain = String(body || '').replace(/\[[^\]]*\]/g, ' ');
    var trimmed = plain.trim();
    var words = trimmed ? trimmed.split(/\s+/).length : 0;
    var characters = trimmed ? trimmed.length : 0;
    return words + (words === 1 ? ' word' : ' words') + ' · ' + characters + (characters === 1 ? ' character' : ' characters');
  }

  function flowCardHTML(scene) {
    var modeButtons = [
      { id: 'choices', label: 'Choices' },
      { id: 'link', label: 'Direct link' },
      { id: 'end', label: 'Ending' }
    ].map(function (mode) {
      return '<button type="button" class="segment-btn' + (scene.mode === mode.id ? ' is-active' : '') + '" data-action="set-mode" data-mode="' + mode.id + '" aria-pressed="' + (scene.mode === mode.id) + '">' + mode.label + '</button>';
    }).join('');

    var body = '';
    if (scene.mode === 'choices') {
      if (scene.choices.length) {
        body = '<div class="choice-list-editor">'
          + scene.choices.map(function (choice, index) {
            return choiceCardHTML(scene, choice, index);
          }).join('')
          + '</div>'
          + '<button type="button" class="add-row-btn" data-action="add-choice"><span aria-hidden="true">+</span> Add a choice</button>';
      } else {
        body = '<div class="flow-empty">'
          + '<span class="flow-empty-mark" aria-hidden="true">⑂</span>'
          + '<div><strong>No choices yet.</strong><p>Add branching paths for your reader.</p></div>'
          + '<button type="button" class="btn btn-small btn-soft" data-action="add-choice">Add the first choice</button>'
          + '</div>';
      }
    } else if (scene.mode === 'link') {
      var target = sceneById(scene.nextId);
      body = '<div class="link-grid">'
        + '<label class="field"><span class="field-label">Next scene</span>'
        + '<select id="sceneNext" class="select">' + sceneTargetOptions(scene.nextId, true) + '</select>'
        + '<span class="field-hint">Readers press a button to continue.</span></label>'
        + '<label class="field"><span class="field-label">Button label</span>'
        + '<input id="sceneNextLabel" class="input" type="text" value="' + esc(scene.nextLabel || 'Continue') + '" placeholder="Continue">'
        + '<span class="field-hint">Leave blank to use “Continue”.</span></label>'
        + '</div>'
        + (target
          ? '<div class="flow-target"><span class="flow-target-dot"></span><span>Leads to</span><strong>' + esc(target.title || 'Untitled scene') + '</strong></div>'
          : '<div class="flow-warning"><span aria-hidden="true">!</span> Choose a destination, or switch this scene to an ending.</div>');
    } else {
      body = '<div class="ending-panel">'
        + '<span class="ending-mark" aria-hidden="true">✦</span>'
        + '<div><strong>This scene ends the story.</strong><p>Readers will see an ending screen and can start again.</p></div>'
        + '</div>';
    }

    return '<section class="card flow-card" id="flowCard">'
      + '<div class="card-head flow-head">'
      + '<div><p class="eyebrow">Flow</p><h2>Where does this scene go?</h2></div>'
      + '<div class="segmented" role="group" aria-label="Scene flow type">' + modeButtons + '</div>'
      + '</div>'
      + '<div class="flow-body">' + body + '</div>'
      + '<details class="enter-effects"' + (scene.enterEffects ? ' open' : '') + '>'
      + '<summary><span>On enter · set stats &amp; items</span><span class="summary-note">' + (scene.enterEffects ? 'Logic on' : 'Optional') + '</span></summary>'
      + '<div class="enter-body">'
      + '<label class="field"><span class="field-label">Effects</span>'
      + '<textarea id="sceneEnter" class="textarea code-textarea" rows="3" placeholder="var:courage += 1; item:lantern += 1">' + esc(scene.enterEffects) + '</textarea>'
      + '<span class="field-hint">Runs whenever this scene opens, before its text.</span></label>'
      + '</div>'
      + '</details>'
      + '</section>';
  }

  function choiceCardHTML(scene, choice, index) {
    var hasLogic = !!(choice.condition || choice.effects);
    var targetMissing = choice.targetId && !sceneById(choice.targetId);
    return '<div class="choice-card" data-choice-id="' + esc(choice.id) + '">'
      + '<div class="choice-head">'
      + '<span class="choice-number">' + (index + 1) + '</span>'
      + '<input class="input choice-label-input" type="text" value="' + esc(choice.label) + '" data-choice-field="label" data-choice-id="' + esc(choice.id) + '" placeholder="What does the reader choose?" aria-label="Choice ' + (index + 1) + ' label">'
      + '<div class="choice-actions">'
      + '<button type="button" class="icon-btn tiny" data-action="move-choice" data-direction="-1" data-choice-id="' + esc(choice.id) + '" title="Move choice up" aria-label="Move choice up"' + (index === 0 ? ' disabled' : '') + '>↑</button>'
      + '<button type="button" class="icon-btn tiny" data-action="move-choice" data-direction="1" data-choice-id="' + esc(choice.id) + '" title="Move choice down" aria-label="Move choice down"' + (index === scene.choices.length - 1 ? ' disabled' : '') + '>↓</button>'
      + '<button type="button" class="icon-btn tiny danger" data-action="delete-choice" data-choice-id="' + esc(choice.id) + '" title="Delete choice" aria-label="Delete choice">×</button>'
      + '</div>'
      + '</div>'
      + '<div class="choice-target-row">'
      + '<label class="inline-field"><span>Goes to</span><select class="select choice-target-select" data-choice-field="targetId" data-choice-id="' + esc(choice.id) + '">' + sceneTargetOptions(choice.targetId, true) + '</select></label>'
      + (hasLogic ? '<span class="logic-pill" title="This choice has a condition or effects">Logic on</span>' : '')
      + (targetMissing ? '<span class="logic-pill is-warning">Missing scene</span>' : '')
      + '</div>'
      + '<details class="choice-advanced"' + (hasLogic ? ' open' : '') + '>'
      + '<summary>Condition &amp; effects</summary>'
      + '<div class="advanced-grid">'
      + '<label class="field"><span class="field-label">Show only if</span>'
      + '<input class="input" type="text" value="' + esc(choice.condition) + '" data-choice-field="condition" data-choice-id="' + esc(choice.id) + '" placeholder="e.g. var:courage >= 2 or item:lantern" spellcheck="false">'
      + '<span class="field-hint">Blank means always visible.</span></label>'
      + '<label class="field"><span class="field-label">Set stats &amp; items</span>'
      + '<textarea class="textarea code-textarea" rows="3" data-choice-field="effects" data-choice-id="' + esc(choice.id) + '" placeholder="var:courage += 1; item:lantern += 1">' + esc(choice.effects) + '</textarea>'
      + '<span class="field-hint">Separate effects with a new line or semicolon.</span></label>'
      + '</div>'
      + '</details>'
      + '</div>';
  }

  function sceneTargetOptions(selectedId, includeEnd) {
    var selectedExists = !selectedId || !!sceneById(selectedId);
    var html = includeEnd ? '<option value=""' + (!selectedId ? ' selected' : '') + '>End story</option>' : '';
    if (!selectedExists) {
      html += '<option value="' + esc(selectedId) + '" selected>⚠ Missing scene</option>';
    }
    html += story.acts.map(function (act) {
      var options = act.chapters.map(function (chapter) {
        return chapter.scenes.map(function (scene) {
          return '<option value="' + esc(scene.id) + '"' + (scene.id === selectedId ? ' selected' : '') + '>'
            + esc(chapter.title || 'Chapter') + ' · ' + esc(scene.title || 'Untitled scene') + '</option>';
        }).join('');
      }).join('');
      return options ? '<optgroup label="' + esc(act.title || 'Act') + '">' + options + '</optgroup>' : '';
    }).join('');
    return html;
  }

  function refreshFlow() {
    var scene = currentScene();
    var existing = document.getElementById('flowCard');
    if (!scene || !existing) return;
    existing.outerHTML = flowCardHTML(scene);
  }

  function switchEditorView(view) {
    editorView = view === 'preview' ? 'preview' : 'write';
    var bodyCard = document.getElementById('bodyCard');
    var writePane = document.getElementById('writePane');
    var previewPane = document.getElementById('previewPane');
    if (!bodyCard || !writePane || !previewPane) return;

    var isPreview = editorView === 'preview';
    bodyCard.classList.toggle('preview-mode', isPreview);
    writePane.hidden = isPreview;
    previewPane.hidden = !isPreview;

    var writeButton = document.querySelector('[data-action="view-write"]');
    var previewButton = document.querySelector('[data-action="view-preview"]');
    if (writeButton) {
      writeButton.classList.toggle('is-active', !isPreview);
      writeButton.setAttribute('aria-selected', String(!isPreview));
    }
    if (previewButton) {
      previewButton.classList.toggle('is-active', isPreview);
      previewButton.setAttribute('aria-selected', String(isPreview));
    }

    if (isPreview) renderPreview();
    else {
      var textarea = document.getElementById('sceneBody');
      if (textarea) textarea.focus();
    }
  }

  /* ----------------------------------------------------------------------- */
  /* Rendering: live preview                                                 */
  /* ----------------------------------------------------------------------- */

  function renderPreview() {
    var container = document.getElementById('scenePreview');
    var scene = currentScene();
    if (!container || !scene) return;

    var vars = initialVariables();
    ENGINE.applyEffects(scene.enterEffects || '', vars);

    var bodyHTML;
    if (String(scene.body || '').trim()) {
      bodyHTML = safeRender(scene.body, vars);
    } else {
      bodyHTML = '<p class="preview-empty">Your scene text will appear here.</p>';
    }

    var titleHTML = '<h2 class="preview-scene-title">' + esc(scene.title || 'Untitled scene') + '</h2>';
    container.innerHTML = titleHTML + bodyHTML + previewFlowHTML(scene, vars);
    applyThemeToPreview();
  }

  function previewFlowHTML(scene, vars) {
    var copy = normalizeStoryCopy(story.copy);
    var html = '<div class="preview-flow"><p class="preview-flow-label">What happens next</p>';

    if (scene.mode === 'choices') {
      var available = [];
      var locked = 0;
      scene.choices.forEach(function (choice) {
        if (ENGINE.evalCondition(choice.condition, vars)) available.push(choice);
        else locked++;
      });

      if (available.length) {
        html += available.map(function (choice) {
          var label = safeRender(choice.label || 'Continue', Object.assign({}, vars));
          return '<div class="preview-choice"><span>' + label + '</span><span class="preview-arrow">→</span></div>';
        }).join('');
      } else {
        html += '<p class="preview-muted">No choices are available with these initial values.</p>';
      }
      if (locked) {
        html += '<p class="preview-muted">' + locked + (locked === 1 ? ' choice is' : ' choices are') + ' hidden by conditions.</p>';
      }
    } else if (scene.mode === 'link') {
      if (scene.nextId && sceneById(scene.nextId)) {
        html += '<div class="preview-choice is-continue"><span>' + esc(scene.nextLabel || 'Continue') + '</span><span class="preview-arrow">→ ' + esc(sceneTitle(scene.nextId)) + '</span></div>';
      } else {
        html += '<p class="preview-muted">No destination scene is set.</p>';
      }
    } else {
      html += '<div class="preview-ending"><span aria-hidden="true">✦</span> ' + esc(copy.endingTitle) + '</div>';
      if (copy.endingMessage) {
        html += '<p class="preview-ending-message">' + escMultiline(copy.endingMessage) + '</p>';
      }
    }

    html += '</div>';
    return html;
  }

  /* ----------------------------------------------------------------------- */
  /* Editing events and actions                                              */
  /* ----------------------------------------------------------------------- */

  function handleDelegatedClick(event) {
    if (!event.target.closest('.menu-wrap')) closeExportMenu();

    var trigger = event.target.closest('[data-action]');
    if (!trigger || trigger.disabled) return;

    var action = trigger.dataset.action;
    switch (action) {
      case 'select-scene':
        selectScene(trigger.dataset.id);
        break;
      case 'add-category':
        addCategory();
        break;
      case 'move-category':
        moveCategory(trigger.dataset.categoryId, Number(trigger.dataset.direction));
        break;
      case 'delete-category':
        deleteCategory(trigger.dataset.categoryId);
        break;
      case 'add-variable':
        addVariable(trigger.dataset.categoryId);
        break;
      case 'insert-image':
        imageInsertAtCursor = true;
        els.imageInput.click();
        break;
      case 'upload-image':
        imageInsertAtCursor = false;
        els.imageInput.click();
        break;
      case 'insert-image-ref':
        insertImageReference(trigger.dataset.imageId);
        break;
      case 'delete-image':
        deleteImage(trigger.dataset.imageId);
        break;
      case 'add-act':
        addAct();
        break;
      case 'add-chapter':
        addChapter(trigger.dataset.actId);
        break;
      case 'add-scene':
        addScene(trigger.dataset.chapterId);
        break;
      case 'delete-act':
        deleteAct(trigger.dataset.actId);
        break;
      case 'delete-chapter':
        deleteChapter(trigger.dataset.chapterId);
        break;
      case 'delete-scene':
        deleteScene();
        break;
      case 'move-act':
        moveAct(trigger.dataset.actId, Number(trigger.dataset.direction));
        break;
      case 'move-chapter':
        moveChapter(trigger.dataset.chapterId, Number(trigger.dataset.direction));
        break;
      case 'move-scene':
        moveScene(Number(trigger.dataset.direction));
        break;
      case 'set-mode':
        setSceneMode(trigger.dataset.mode);
        break;
      case 'add-choice':
        addChoice();
        break;
      case 'delete-choice':
        deleteChoice(trigger.dataset.choiceId);
        break;
      case 'move-choice':
        moveChoice(trigger.dataset.choiceId, Number(trigger.dataset.direction));
        break;
      case 'set-start':
        setOpeningScene();
        break;
      case 'delete-variable':
        deleteVariable(trigger.dataset.id);
        break;
      case 'wrap':
        wrapSelection(trigger.dataset.before, trigger.dataset.after, trigger.dataset.placeholder);
        break;
      case 'snippet':
        insertSnippet(trigger.dataset.snippet);
        break;
      case 'view-write':
        switchEditorView('write');
        break;
      case 'view-preview':
        switchEditorView('preview');
        break;
      case 'play-choice':
        choosePlayChoice(trigger.dataset.id);
        break;
      case 'play-continue':
        continuePlaytest();
        break;
      case 'play-restart':
        openRestartConfirm(restartPlaytest);
        break;
      default:
        break;
    }
  }

  function syncSceneCrumbs() {
    var context = currentContext();
    if (!context) return;
    var actLabel = document.querySelector('[data-crumb="act-title"]');
    var chapterLabel = document.querySelector('[data-crumb="chapter-title"]');
    if (actLabel) actLabel.textContent = context.act.title || 'Untitled act';
    if (chapterLabel) chapterLabel.textContent = context.chapter.title || 'Untitled chapter';
  }

  function handleInput(event) {
    var target = event.target;

    if (target.id === 'statePanelTitle') {
      story.statePanel = story.statePanel || { title: 'Story state' };
      story.statePanel.title = target.value;
      markDirty();
      return;
    }

    if (target.dataset.copyField) {
      updateStoryCopyField(target.dataset.copyField, target.value, false);
      return;
    }

    if (target.dataset.categoryField === 'title') {
      var titledCategory = categoryById(target.dataset.categoryId);
      if (!titledCategory) return;
      titledCategory.title = target.value;
      markDirty();
      schedulePreview();
      return;
    }

    if (target.dataset.themeField) {
      updateThemeField(target.dataset.themeField, target.value);
      return;
    }

    if (target.dataset.actField === 'title') {
      var titledAct = actById(target.dataset.actId);
      if (!titledAct) return;
      titledAct.title = target.value;
      markDirty();
      syncSceneCrumbs();
      return;
    }

    if (target.dataset.chapterField === 'title') {
      var titledChapter = chapterById(target.dataset.chapterId);
      if (!titledChapter) return;
      titledChapter.title = target.value;
      markDirty();
      syncSceneCrumbs();
      return;
    }

    if (target.id === 'sceneTitle') {
      var titleScene = currentScene();
      if (!titleScene) return;
      titleScene.title = target.value;
      markDirty();
      renderSidebar();
      return;
    }

    if (target.id === 'sceneBody') {
      var bodyScene = currentScene();
      if (!bodyScene) return;
      bodyScene.body = target.value;
      markDirty();
      updateBodyMeta();
      schedulePreview();
      return;
    }

    if (target.id === 'sceneNextLabel') {
      var linkScene = currentScene();
      if (!linkScene) return;
      linkScene.nextLabel = target.value;
      markDirty();
      schedulePreview();
      return;
    }

    if (target.id === 'sceneEnter') {
      var enterScene = currentScene();
      if (!enterScene) return;
      enterScene.enterEffects = target.value;
      markDirty();
      updateEnterSummary();
      schedulePreview();
      return;
    }

    if (target.dataset.choiceField) {
      var field = target.dataset.choiceField;
      if (field === 'targetId') return;
      var choice = choiceById(target.dataset.choiceId);
      if (!choice) return;
      choice[field] = target.value;
      markDirty();
      schedulePreview();
      updateChoiceLogicPill(target.dataset.choiceId);
      return;
    }

    if (target.dataset.varField === 'label') {
      var labeledVariable = variableById(target.dataset.varId);
      if (!labeledVariable) return;
      labeledVariable.label = target.value;
      markDirty();
      return;
    }

    if (target.dataset.varField === 'name') {
      var variable = variableById(target.dataset.varId);
      if (!variable) return;
      variable.name = target.value;
      updateVariableHint(variable);
      markDirty();
      schedulePreview();
      return;
    }

    if (target.dataset.varField === 'initial' && target.tagName !== 'SELECT') {
      var initialVariable = variableById(target.dataset.varId);
      if (!initialVariable) return;
      initialVariable.initial = target.value;
      if (isItemVariable(initialVariable) && Number(target.value) < 0) {
        initialVariable.initial = '0';
        target.value = '0';
      }
      markDirty();
      schedulePreview();
    }
  }

  function handleChange(event) {
    var target = event.target;

    if (target.id === 'statePanelTitle') {
      story.statePanel = story.statePanel || { title: 'Story state' };
      story.statePanel.title = target.value.trim() || 'Story state';
      target.value = statePanelTitle();
      markDirty();
      return;
    }

    if (target.dataset.copyField) {
      updateStoryCopyField(target.dataset.copyField, target.value, true);
      var normalizedCopy = normalizeStoryCopy(story.copy);
      target.value = normalizedCopy[target.dataset.copyField];
      return;
    }

    if (target.dataset.categoryField === 'title') {
      var changedCategory = categoryById(target.dataset.categoryId);
      if (!changedCategory) return;
      changedCategory.title = target.value.trim() || 'Untitled category';
      target.value = changedCategory.title;
      markDirty();
      schedulePreview();
      return;
    }

    if (target.dataset.categoryField === 'kind') {
      var styledCategory = categoryById(target.dataset.categoryId);
      if (!styledCategory) return;
      setCategoryKind(styledCategory, target.value);
      return;
    }

    if (target.dataset.themeField) {
      updateThemeField(target.dataset.themeField, target.value, true);
      return;
    }

    if (target.dataset.actField === 'title') {
      var changedAct = actById(target.dataset.actId);
      if (!changedAct) return;
      changedAct.title = target.value.trim() || 'Untitled act';
      target.value = changedAct.title;
      markDirty();
      syncSceneCrumbs();
      renderStartOptions();
      refreshFlow();
      return;
    }

    if (target.dataset.chapterField === 'title') {
      var changedChapter = chapterById(target.dataset.chapterId);
      if (!changedChapter) return;
      changedChapter.title = target.value.trim() || 'Untitled chapter';
      target.value = changedChapter.title;
      markDirty();
      syncSceneCrumbs();
      renderStartOptions();
      refreshFlow();
      return;
    }

    if (target.dataset.varField === 'label') {
      var labelVariable = variableById(target.dataset.varId);
      if (!labelVariable) return;
      labelVariable.label = target.value.trim();
      target.value = variableDisplayName(labelVariable);
      markDirty();
      return;
    }

    if (target.id === 'sceneNext') {
      var linkedScene = currentScene();
      if (!linkedScene) return;
      linkedScene.nextId = target.value;
      markDirty();
      renderSidebar();
      schedulePreview();
      return;
    }

    if (target.dataset.choiceField === 'targetId') {
      var choice = choiceById(target.dataset.choiceId);
      if (!choice) return;
      choice.targetId = target.value;
      markDirty();
      renderSidebar();
      schedulePreview();
      refreshFlow();
      return;
    }

    if (target.dataset.varField === 'type') {
      var variable = variableById(target.dataset.varId);
      if (!variable || isItemVariable(variable)) return;
      variable.type = ['number', 'text', 'boolean'].indexOf(target.value) !== -1
        ? target.value
        : 'text';
      coerceVariableInitial(variable);
      markDirty();
      renderVariables();
      schedulePreview();
      return;
    }

    if (target.dataset.varField === 'initial' && target.tagName === 'SELECT') {
      var booleanVariable = variableById(target.dataset.varId);
      if (!booleanVariable) return;
      booleanVariable.initial = target.value === 'true' ? 'true' : 'false';
      markDirty();
      schedulePreview();
      return;
    }

    if (target.dataset.varField === 'name') {
      var namedVariable = variableById(target.dataset.varId);
      if (!namedVariable) return;
      namedVariable.name = target.value;
      normalizeVariableName(namedVariable);
      markDirty();
      renderVariables();
      schedulePreview();
      return;
    }

    if (target.id === 'playShowLocked' && playState) {
      playState.showLocked = target.checked;
      renderPlaytest();
    }
  }

  function updateBodyMeta() {
    var meta = document.getElementById('bodyMeta');
    var scene = currentScene();
    if (meta && scene) meta.textContent = bodyMetaText(scene.body);
  }

  function updateEnterSummary() {
    var details = document.querySelector('#flowCard .enter-effects');
    if (!details) return;
    var note = details.querySelector('.summary-note');
    var scene = currentScene();
    if (note && scene) note.textContent = scene.enterEffects ? 'Logic on' : 'Optional';
  }

  function updateChoiceLogicPill(choiceId) {
    var card = document.querySelector('.choice-card[data-choice-id="' + cssEscape(choiceId) + '"]');
    if (!card) return;
    var choice = choiceById(choiceId);
    if (!choice) return;
    var row = card.querySelector('.choice-target-row');
    var existing = row.querySelector('.logic-pill:not(.is-warning)');
    if (choice.condition || choice.effects) {
      if (!existing) {
        var pill = document.createElement('span');
        pill.className = 'logic-pill';
        pill.title = 'This choice has a condition or effects';
        pill.textContent = 'Logic on';
        row.appendChild(pill);
      }
    } else if (existing) {
      existing.remove();
    }
  }

  function updateVariableHint(variable) {
    var card = document.querySelector('.variable-card[data-var-id="' + cssEscape(variable.id) + '"]');
    if (!card) return;
    var hint = card.querySelector('.var-hint');
    if (hint) hint.innerHTML = variableHintHTML(variable, isItemVariable(variable) ? 'item' : 'stat');
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value));
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function createSceneRecord(title) {
    return {
      id: uid('scene'),
      title: title || 'New Scene',
      body: '',
      mode: 'choices',
      nextId: '',
      nextLabel: 'Continue',
      enterEffects: '',
      choices: []
    };
  }

  function createChapterRecord(title) {
    return {
      id: uid('chapter'),
      title: title || 'New Chapter',
      scenes: [createSceneRecord('New Scene')]
    };
  }

  function createActRecord(title) {
    return {
      id: uid('act'),
      title: title || 'New Act',
      chapters: [createChapterRecord('New Chapter')]
    };
  }

  function focusAfterRender(selector) {
    setTimeout(function () {
      var input = document.querySelector(selector);
      if (!input) return;
      input.focus();
      if (typeof input.select === 'function') input.select();
    }, 40);
  }

  function selectScene(id) {
    if (!sceneById(id) || id === currentId) return;
    currentId = id;
    renderSidebar();
    renderEditor();
    if (els.editorPane.scrollTo) {
      els.editorPane.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      els.editorPane.scrollTop = 0;
    }
  }

  function setSceneMode(mode) {
    var scene = currentScene();
    if (!scene || (mode !== 'choices' && mode !== 'link' && mode !== 'end')) return;
    scene.mode = mode;

    if (mode === 'link' && !scene.nextId) {
      var scenes = allScenes();
      var index = scenes.indexOf(scene);
      var nearby = scenes[index + 1] || scenes[index - 1];
      if (nearby) scene.nextId = nearby.id;
    }

    markDirty();
    refreshFlow();
    renderSidebar();
    schedulePreview();
  }

  function addAct() {
    var context = currentContext();
    var act = createActRecord('New Act');
    if (context) story.acts.splice(context.actIndex + 1, 0, act);
    else story.acts.push(act);
    var scene = act.chapters[0].scenes[0];
    if (!story.startId || !sceneById(story.startId)) story.startId = scene.id;
    currentId = scene.id;
    editorView = 'write';
    markDirty();
    renderAll();
    schedulePreview();
    if (els.editorPane.scrollTo) els.editorPane.scrollTo({ top: 0 });
    focusAfterRender('.tree-title[data-act-id="' + cssEscape(act.id) + '"]');
    showToast('Act added.');
  }

  function addChapter(actId) {
    var act = actById(actId);
    if (!act) return;
    var chapter = createChapterRecord('New Chapter');
    var context = currentContext();
    if (context && context.act.id === act.id) {
      act.chapters.splice(context.chapterIndex + 1, 0, chapter);
    } else {
      act.chapters.push(chapter);
    }
    var scene = chapter.scenes[0];
    if (!story.startId || !sceneById(story.startId)) story.startId = scene.id;
    currentId = scene.id;
    editorView = 'write';
    markDirty();
    renderAll();
    schedulePreview();
    if (els.editorPane.scrollTo) els.editorPane.scrollTo({ top: 0 });
    focusAfterRender('.tree-title[data-chapter-id="' + cssEscape(chapter.id) + '"]');
    showToast('Chapter added.');
  }

  function addScene(chapterId) {
    var chapter = chapterById(chapterId);
    if (!chapter) return;
    var scene = createSceneRecord('New Scene');
    var context = currentContext();
    if (context && context.chapter.id === chapter.id) {
      chapter.scenes.splice(context.sceneIndex + 1, 0, scene);
    } else {
      chapter.scenes.push(scene);
    }
    if (!story.startId || !sceneById(story.startId)) story.startId = scene.id;
    currentId = scene.id;
    editorView = 'write';
    markDirty();
    renderAll();
    schedulePreview();
    if (els.editorPane.scrollTo) els.editorPane.scrollTo({ top: 0 });
    focusAfterRender('#sceneTitle');
    showToast('Scene added.');
  }

  function removeSceneReferences(removedIds) {
    allScenes().forEach(function (scene) {
      if (scene.nextId && removedIds[scene.nextId]) scene.nextId = '';
      scene.choices.forEach(function (choice) {
        if (choice.targetId && removedIds[choice.targetId]) choice.targetId = '';
      });
    });
    if (removedIds[story.startId] || !sceneById(story.startId)) {
      var first = firstScene();
      story.startId = first ? first.id : '';
    }
  }

  function deleteAct(actId) {
    var act = actById(actId);
    if (!act) return;
    if (story.acts.length <= 1) {
      showToast('A story needs at least one act.', 'error');
      return;
    }
    var label = act.title || 'Untitled act';
    if (!window.confirm('Delete “' + label + '” and every chapter and scene inside it? This cannot be undone.')) return;

    var removedIds = {};
    act.chapters.forEach(function (chapter) {
      chapter.scenes.forEach(function (scene) { removedIds[scene.id] = true; });
    });
    var index = actIndex(actId);
    story.acts.splice(index, 1);
    removeSceneReferences(removedIds);
    ensureCurrentScene();
    markDirty();
    renderAll();
    schedulePreview();
    showToast('Act deleted.');
  }

  function deleteChapter(chapterId) {
    var location = chapterLocation(chapterId);
    if (!location) return;
    if (location.act.chapters.length <= 1) {
      showToast('An act needs at least one chapter. Delete the act instead.', 'error');
      return;
    }
    var chapter = location.chapter;
    var label = chapter.title || 'Untitled chapter';
    if (!window.confirm('Delete “' + label + '” and every scene inside it? This cannot be undone.')) return;

    var removedIds = {};
    chapter.scenes.forEach(function (scene) { removedIds[scene.id] = true; });
    var wasCurrent = !!removedIds[currentId];
    location.act.chapters.splice(location.chapterIndex, 1);
    removeSceneReferences(removedIds);
    if (wasCurrent) {
      var neighbor = location.act.chapters[Math.min(location.chapterIndex, location.act.chapters.length - 1)];
      currentId = neighbor && neighbor.scenes[0] ? neighbor.scenes[0].id : '';
    }
    ensureCurrentScene();
    markDirty();
    renderAll();
    schedulePreview();
    showToast('Chapter deleted.');
  }

  function deleteScene() {
    var context = currentContext();
    if (!context) return;
    if (context.chapter.scenes.length <= 1) {
      showToast('A chapter needs at least one scene. Delete the chapter instead.', 'error');
      return;
    }
    var scene = context.scene;
    var label = scene.title || 'Untitled scene';
    if (!window.confirm('Delete “' + label + '”? This cannot be undone.')) return;

    var removedIds = {};
    removedIds[scene.id] = true;
    context.chapter.scenes.splice(context.sceneIndex, 1);
    removeSceneReferences(removedIds);
    var neighbor = context.chapter.scenes[Math.min(context.sceneIndex, context.chapter.scenes.length - 1)];
    currentId = neighbor ? neighbor.id : '';
    ensureCurrentScene();
    markDirty();
    renderAll();
    schedulePreview();
    showToast('Scene deleted.');
  }

  function moveAct(actId, direction) {
    var index = actIndex(actId);
    if (index === -1) return;
    var destination = index + direction;
    if (destination < 0 || destination >= story.acts.length) return;
    var moved = story.acts.splice(index, 1)[0];
    story.acts.splice(destination, 0, moved);
    markDirty();
    renderSidebar();
    renderEditor();
    schedulePreview();
  }

  function moveChapter(chapterId, direction) {
    var location = chapterLocation(chapterId);
    if (!location) return;
    var destination = location.chapterIndex + direction;
    if (destination < 0 || destination >= location.act.chapters.length) return;
    var moved = location.act.chapters.splice(location.chapterIndex, 1)[0];
    location.act.chapters.splice(destination, 0, moved);
    markDirty();
    renderSidebar();
    renderEditor();
    schedulePreview();
  }

  function moveScene(direction) {
    var context = currentContext();
    if (!context) return;
    var destination = context.sceneIndex + direction;
    if (destination < 0 || destination >= context.chapter.scenes.length) return;
    var moved = context.chapter.scenes.splice(context.sceneIndex, 1)[0];
    context.chapter.scenes.splice(destination, 0, moved);
    markDirty();
    renderSidebar();
    renderEditor();
    schedulePreview();
  }

  function setOpeningScene() {
    var scene = currentScene();
    if (!scene) return;
    story.startId = scene.id;
    markDirty();
    renderSidebar();
    renderEditor();
    showToast('“' + (scene.title || 'Untitled scene') + '” is now the opening scene.');
  }

  function addChoice() {
    var scene = currentScene();
    if (!scene) return;
    if (scene.mode !== 'choices') scene.mode = 'choices';

    scene.choices.push({
      id: uid('choice'),
      label: 'New choice',
      targetId: '',
      condition: '',
      effects: ''
    });

    markDirty();
    refreshFlow();
    renderSidebar();
    schedulePreview();

    setTimeout(function () {
      var labels = document.querySelectorAll('[data-choice-field="label"]');
      var last = labels[labels.length - 1];
      if (last) {
        last.focus();
        last.select();
      }
    }, 30);
  }

  function deleteChoice(choiceId) {
    var scene = currentScene();
    if (!scene) return;
    var index = -1;
    for (var i = 0; i < scene.choices.length; i++) {
      if (scene.choices[i].id === choiceId) {
        index = i;
        break;
      }
    }
    if (index === -1) return;
    scene.choices.splice(index, 1);
    markDirty();
    refreshFlow();
    renderSidebar();
    schedulePreview();
  }

  function moveChoice(choiceId, direction) {
    var scene = currentScene();
    if (!scene) return;
    var index = -1;
    for (var i = 0; i < scene.choices.length; i++) {
      if (scene.choices[i].id === choiceId) {
        index = i;
        break;
      }
    }
    if (index === -1) return;
    var destination = index + direction;
    if (destination < 0 || destination >= scene.choices.length) return;
    var moved = scene.choices.splice(index, 1)[0];
    scene.choices.splice(destination, 0, moved);
    markDirty();
    refreshFlow();
    renderSidebar();
    schedulePreview();
  }

  function uniqueVariableName(base) {
    var name = base;
    var suffix = 2;
    while (allVariables().some(function (variable) { return variable.name === name; })) {
      name = base + suffix;
      suffix++;
    }
    return name;
  }

  function uniqueCategoryTitle(base) {
    var title = base;
    var suffix = 2;
    while (allCategories().some(function (category) { return category.title === title; })) {
      title = base + ' ' + suffix;
      suffix++;
    }
    return title;
  }

  function addCategory() {
    story.categories = Array.isArray(story.categories) ? story.categories : [];
    var category = {
      id: uid('category'),
      title: uniqueCategoryTitle('New category'),
      kind: 'sheet',
      variables: []
    };
    story.categories.push(category);
    markDirty();
    renderVariables();
    schedulePreview();

    setTimeout(function () {
      var input = document.querySelector('.category-card[data-category-id="' + cssEscape(category.id) + '"] [data-category-field="title"]');
      if (input) {
        input.focus();
        input.select();
      }
    }, 30);
  }

  function moveCategory(id, direction) {
    var index = story.categories.findIndex(function (category) { return category.id === id; });
    if (index === -1) return;
    var destination = index + direction;
    if (destination < 0 || destination >= story.categories.length) return;
    var moved = story.categories.splice(index, 1)[0];
    story.categories.splice(destination, 0, moved);
    markDirty();
    renderVariables();
    schedulePreview();
  }

  function deleteCategory(id) {
    var category = categoryById(id);
    if (!category) return;
    var count = Array.isArray(category.variables) ? category.variables.length : 0;
    var message = 'Delete the category “' + (category.title || 'Untitled category') + '”'
      + (count ? ' and its ' + count + (count === 1 ? ' variable' : ' variables') : '') + '?';
    if (!window.confirm(message)) return;
    story.categories = story.categories.filter(function (item) { return item.id !== id; });
    markDirty();
    renderVariables();
    schedulePreview();
    showToast('Category deleted.');
  }

  function setCategoryKind(category, kind) {
    var next = kind === 'inventory' ? 'inventory' : 'sheet';
    if (category.kind === next) return;
    category.kind = next;
    (Array.isArray(category.variables) ? category.variables : []).forEach(function (variable) {
      if (next === 'inventory') {
        variable.type = 'item';
        var count = Number(variable.initial);
        variable.initial = isFinite(count) && count >= 0 ? String(count) : '0';
      } else {
        variable.type = variable.type === 'item' || !variable.type ? 'number' : variable.type;
        coerceVariableInitial(variable);
      }
    });
    markDirty();
    renderVariables();
    schedulePreview();
    showToast(next === 'inventory' ? 'Category is now an inventory.' : 'Category is now a stat sheet.', 'info');
  }

  function addVariable(categoryId) {
    var category = categoryById(categoryId) || allCategories()[0];
    if (!category) {
      addCategory();
      category = allCategories()[allCategories().length - 1];
      if (!category) return;
    }
    category.variables = Array.isArray(category.variables) ? category.variables : [];
    var isItem = category.kind === 'inventory';
    var baseNames = isItem
      ? ['lantern', 'dagger', 'key', 'token', 'item']
      : ['courage', 'gold', 'score', 'flag', 'visit'];
    var name = '';
    for (var i = 0; i < baseNames.length; i++) {
      if (!allVariables().some(function (variable) { return variable.name === baseNames[i]; })) {
        name = baseNames[i];
        break;
      }
    }
    if (!name) name = uniqueVariableName(isItem ? 'item' : 'stat');

    var variable = {
      id: uid(isItem ? 'item' : 'stat'),
      name: name,
      label: humanizeVariableName(name),
      initial: '0'
    };
    if (isItem) variable.type = 'item';
    else variable.type = 'number';

    category.variables.push(variable);
    markDirty();
    renderVariables();
    schedulePreview();

    setTimeout(function () {
      var card = document.querySelector('.category-card[data-category-id="' + cssEscape(category.id) + '"]');
      var names = card ? card.querySelectorAll('[data-var-field="name"]') : [];
      var last = names[names.length - 1];
      if (last) {
        last.focus();
        last.select();
      }
    }, 30);
  }

  function deleteVariable(id) {
    var variable = variableById(id);
    if (!variable) return;
    var kind = isItemVariable(variable) ? 'item' : 'stat';
    if (!window.confirm('Delete the ' + kind + ' “' + variableDisplayName(variable) + '” (ID: ' + (variable.name || kind) + ')? Conditions that use it will no longer match.')) return;
    allCategories().forEach(function (category) {
      category.variables = category.variables.filter(function (item) { return item.id !== id; });
    });
    markDirty();
    renderVariables();
    schedulePreview();
    showToast(kind === 'item' ? 'Item deleted.' : 'Stat deleted.');
  }

  function updateStoryCopyField(field, value, finalize) {
    if (field !== 'coverSubtitle' && field !== 'endingTitle' && field !== 'endingMessage' && field !== 'endingButton') return;
    story.copy = normalizeStoryCopy(story.copy);
    story.copy[field] = String(value == null ? '' : value);
    if (finalize) {
      story.copy = normalizeStoryCopy(story.copy);
      renderStoryCopyControls();
    }
    markDirty();
    schedulePreview();
  }

  function updateThemeField(field, value, finalize) {
    var theme = story.theme = normalizeTheme(story.theme);
    if (field === 'bodyFont' || field === 'headingFont') {
      if (!FONT_CHOICES.some(function (choice) { return choice.id === value; })) return;
      theme[field] = value;
    } else if (field === 'accent' || field === 'paper' || field === 'ink' || field === 'titleColor' || field === 'choiceColor') {
      if (field === 'ink') {
        var previousInk = theme.ink;
        var nextInk = normalizeHexColor(value, theme.ink);
        if (theme.titleColor === previousInk) theme.titleColor = nextInk;
        if (theme.choiceColor === previousInk) theme.choiceColor = nextInk;
        theme.ink = nextInk;
      } else {
        theme[field] = normalizeHexColor(value, theme[field]);
      }
    } else {
      return;
    }
    story.theme = theme;
    markDirty();
    applyThemeToPreview();
    if (playState) applyPlaytestTheme();
    if (finalize) renderThemeControls();
  }

  function resetTheme() {
    story.theme = clone(DEFAULT_THEME);
    markDirty();
    renderVariables();
    applyThemeToPreview();
    if (playState) applyPlaytestTheme();
    showToast('Theme reset to the Storyweave defaults.', 'info');
  }

  function applyPlaytestTheme() {
    var shell = els.playOverlay && els.playOverlay.querySelector('.play-shell');
    if (!shell) return;
    var variables = themeVariables(story.theme);
    Object.keys(variables).forEach(function (name) {
      shell.style.setProperty(name, variables[name]);
    });
  }

  function insertImageReference(id) {
    if (!id) return;
    var textarea = ensureWriteView();
    if (!textarea) return;
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var insertion = '[img:' + id + ']';
    textarea.setRangeText(insertion, start, end, 'end');
    textarea.focus();
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function readFileAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('The image could not be read.')); };
      reader.readAsDataURL(file);
    });
  }

  function compressImage(dataUrl) {
    return new Promise(function (resolve) {
      var image = new Image();
      image.onload = function () {
        try {
          var maxSide = 1600;
          var scale = Math.min(1, maxSide / Math.max(image.width || 1, image.height || 1));
          var width = Math.max(1, Math.round((image.width || 1) * scale));
          var height = Math.max(1, Math.round((image.height || 1) * scale));
          var canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          var context = canvas.getContext('2d');
          if (!context) {
            resolve(dataUrl);
            return;
          }
          context.drawImage(image, 0, 0, width, height);
          var compressed = canvas.toDataURL('image/webp', 0.82);
          if (!/^data:image\/webp/i.test(compressed)) compressed = canvas.toDataURL('image/jpeg', 0.86);
          resolve(compressed || dataUrl);
        } catch (error) {
          resolve(dataUrl);
        }
      };
      image.onerror = function () { resolve(dataUrl); };
      image.src = dataUrl;
    });
  }

  function addImageFromFile(file, insertAtCursor) {
    if (!file || !/^image\/(?:png|jpe?g|gif|webp)$/i.test(file.type)) {
      showToast('Choose a PNG, JPEG, GIF, or WebP image.', 'error');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      showToast('That image is too large. Choose one under 15 MB.', 'error');
      return;
    }

    readFileAsDataURL(file).then(function (dataUrl) {
      var prepared = file.type === 'image/gif' || dataUrl.length <= 900000
        ? Promise.resolve(dataUrl)
        : compressImage(dataUrl);
      return prepared.then(function (finalUrl) {
        if (!isSafeImageDataURL(finalUrl)) {
          showToast('That image could not be embedded. Try a smaller PNG, JPEG, or WebP.', 'error');
          return;
        }
        story.images = story.images || {};
        var id = uid('img');
        story.images[id] = {
          src: finalUrl,
          name: file.name || 'Image'
        };
        markDirty();
        renderVariables();
        if (insertAtCursor) insertImageReference(id);
        showToast('Image embedded. It will travel inside the exported HTML.', 'success');
      });
    }).catch(function () {
      showToast('That image could not be read.', 'error');
    });
  }

  function handleImageInputChange(event) {
    var file = event.target.files && event.target.files[0];
    var insertAtCursor = imageInsertAtCursor;
    imageInsertAtCursor = false;
    event.target.value = '';
    if (!file) return;
    addImageFromFile(file, insertAtCursor);
  }

  function deleteImage(id) {
    var images = story.images || {};
    var image = images[id];
    if (!image) return;
    if (!window.confirm('Delete the embedded image “' + (image.name || 'Image') + '”? Any text that uses it will show a missing-image note.')) return;
    delete images[id];
    markDirty();
    renderVariables();
    showToast('Image removed.');
  }

  function coerceVariableInitial(variable) {
    if (isItemVariable(variable)) {
      var count = Number(variable.initial);
      variable.initial = isFinite(count) && count >= 0 ? String(count) : '0';
    } else if (isNumericVariableType(variable.type)) {
      var number = Number(variable.initial);
      variable.initial = isFinite(number) ? String(number) : '0';
    } else if (variable.type === 'boolean') {
      variable.initial = String(variable.initial).toLowerCase() === 'true' ? 'true' : 'false';
    }
  }

  function normalizeVariableName(variable) {
    var raw = String(variable.name || '').trim();
    var name = raw.replace(/^(?:var|item):/i, '').replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '_');
    if (!name) name = 'variable';
    if (!/^[A-Za-z_]/.test(name)) name = 'v_' + name;

    var unique = name;
    var suffix = 2;
    while (allVariables().some(function (item) {
      return item.id !== variable.id && item.name === unique;
    })) {
      unique = name + suffix;
      suffix++;
    }

    if (unique !== variable.name) {
      variable.name = unique;
      showToast('Variable renamed to “' + unique + '”.', 'info');
    }
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function () {
      if (editorView === 'preview') renderPreview();
    }, 90);
  }

  function ensureWriteView() {
    if (editorView !== 'write') switchEditorView('write');
    return document.getElementById('sceneBody');
  }

  function wrapSelection(before, after, placeholder) {
    var textarea = ensureWriteView();
    if (!textarea) return;
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var selected = textarea.value.slice(start, end) || placeholder || '';
    var insertion = before + selected + after;
    textarea.setRangeText(insertion, start, end, 'end');
    textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
    textarea.focus();
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function insertSnippet(kind) {
    var textarea = ensureWriteView();
    if (!textarea) return;
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var selected = textarea.value.slice(start, end);
    var insertion = '';
    var selectOffset = 0;
    var selectLength = 0;

    if (kind === 'var') {
      var name = /^[A-Za-z_][A-Za-z0-9_]*$/.test(selected.trim()) ? selected.trim() : 'courage';
      insertion = '[var:' + name + ']';
      selectOffset = 5;
      selectLength = name.length;
    } else if (kind === 'set') {
      insertion = '[set var:gold = 0]';
      selectOffset = 9;
      selectLength = 4;
    } else {
      var condition = 'var:courage >= 1';
      insertion = '[if ' + condition + ']\n' + (selected || '') + '\n[else]\n\n[/if]';
      selectOffset = 4;
      selectLength = condition.length;
    }

    textarea.setRangeText(insertion, start, end, 'end');
    textarea.setSelectionRange(start + selectOffset, start + selectOffset + selectLength);
    textarea.focus();
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* ----------------------------------------------------------------------- */
  /* New / import / JSON export                                              */
  /* ----------------------------------------------------------------------- */

  function newProject() {
    if (!window.confirm('Start a new project?\n\nThis replaces “' + (story.title || 'Untitled Story') + '” in the editor and overwrites the autosaved copy in this browser. Export the current story first if you want to keep it.')) return;
    story = createBlankStory();
    currentId = story.startId;
    editorView = 'write';
    syncHeader();
    renderAll();
    persistProject(false);
    setSaveState('Saved locally', 'saved');
    if (els.editorPane.scrollTo) els.editorPane.scrollTo({ top: 0 });
    showToast('New project created.');
    setTimeout(function () {
      var input = document.getElementById('sceneTitle');
      if (input) {
        input.focus();
        input.select();
      }
    }, 40);
  }

  function importProjectFile(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = normalizeProject(JSON.parse(String(reader.result)));
        if (!window.confirm('Import “' + (parsed.title || 'Untitled Story') + '”? This replaces the project currently in the editor.')) {
          els.fileInput.value = '';
          return;
        }
        story = parsed;
        currentId = story.startId;
        editorView = 'write';
        syncHeader();
        renderAll();
        persistProject(false);
        setSaveState('Saved locally', 'saved');
        showToast('Project imported.', 'success');
        if (els.editorPane.scrollTo) els.editorPane.scrollTo({ top: 0 });
      } catch (error) {
        showToast('Could not import that file. Choose a Storyweave project JSON.', 'error');
      } finally {
        els.fileInput.value = '';
      }
    };
    reader.onerror = function () {
      showToast('The file could not be read.', 'error');
      els.fileInput.value = '';
    };
    reader.readAsText(file);
  }

  function exportProjectJSON() {
    var content = JSON.stringify(story, null, 2);
    downloadFile(slugify(story.title) + '.storyweave.json', content, 'application/json');
    showToast('Project JSON exported.', 'success');
  }

  function downloadFile(filename, content, mimeType) {
    var blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function toggleExportMenu() {
    var isHidden = els.exportMenu.hidden;
    els.exportMenu.hidden = !isHidden;
    els.exportBtn.setAttribute('aria-expanded', String(isHidden));
  }

  function closeExportMenu() {
    if (!els.exportMenu || els.exportMenu.hidden) return;
    els.exportMenu.hidden = true;
    els.exportBtn.setAttribute('aria-expanded', 'false');
  }

  /* ----------------------------------------------------------------------- */
  /* Playtest                                                                */
  /* ----------------------------------------------------------------------- */

  function openPlaytest() {
    var start = sceneById(story.startId) || firstScene();
    if (!start) {
      showToast('Add a scene before playtesting.', 'error');
      return;
    }

    lastFocusedElement = document.activeElement;
    playState = {
      vars: initialVariables(),
      baseline: clone(initialVariables()),
      sceneId: null,
      ended: false,
      showLocked: false,
      history: [],
      renderedBody: '',
      renderedSceneId: ''
    };

    els.playOverlay.hidden = false;
    document.body.classList.add('modal-open');
    enterPlayScene(start.id, true);
    els.playCloseBtn.focus();
  }

  function closePlaytest() {
    if (els.restartOverlay && !els.restartOverlay.hidden) closeRestartConfirm(false);
    els.playOverlay.hidden = true;
    document.body.classList.remove('modal-open');
    playState = null;
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      lastFocusedElement.focus();
    }
  }

  function openRestartConfirm(callback) {
    if (!els.restartOverlay) {
      if (typeof callback === 'function') callback();
      return;
    }

    restartConfirmCallback = typeof callback === 'function' ? callback : null;
    if (els.restartOverlay.hidden) restartConfirmReturnFocus = document.activeElement;
    els.restartConfirmInput.value = '';
    els.restartConfirmBtn.disabled = true;
    els.restartConfirmHint.textContent = 'Type “restart” to unlock the confirm button.';
    els.restartConfirmHint.classList.remove('is-ready');
    els.restartOverlay.hidden = false;
    setTimeout(function () {
      els.restartConfirmInput.focus();
    }, 0);
  }

  function closeRestartConfirm(confirmed) {
    if (!els.restartOverlay || els.restartOverlay.hidden) return;
    els.restartOverlay.hidden = true;

    var callback = restartConfirmCallback;
    restartConfirmCallback = null;

    var target = restartConfirmReturnFocus;
    restartConfirmReturnFocus = null;
    if (!confirmed && target && target.focus && document.contains(target)) {
      try { target.focus(); } catch (error) { /* Ignore focus failures. */ }
    }

    if (confirmed && callback) callback();
  }

  function updateRestartConfirmState() {
    var ready = String(els.restartConfirmInput.value || '').trim().toLowerCase() === 'restart';
    els.restartConfirmBtn.disabled = !ready;
    els.restartConfirmHint.textContent = ready
      ? 'Ready to restart.'
      : 'Type “restart” to unlock the confirm button.';
    els.restartConfirmHint.classList.toggle('is-ready', ready);
  }

  function restartPlaytest() {
    if (!playState) return;
    var showLocked = playState.showLocked;
    playState = {
      vars: initialVariables(),
      baseline: clone(initialVariables()),
      sceneId: null,
      ended: false,
      showLocked: showLocked,
      history: [],
      renderedBody: '',
      renderedSceneId: ''
    };

    var start = sceneById(story.startId) || firstScene();
    if (start) enterPlayScene(start.id, true);
    else renderPlaytest(false);
  }

  function enterPlayScene(id, focus) {
    if (!playState) return;
    var scene = sceneById(id);
    if (!scene) {
      playState.sceneId = null;
      playState.ended = true;
      playState.renderedBody = '';
      playState.renderedSceneId = '';
      renderPlaytest(focus);
      return;
    }

    playState.sceneId = scene.id;
    playState.ended = false;
    ENGINE.applyEffects(scene.enterEffects || '', playState.vars);
    playState.renderedBody = safeRender(scene.body || '', playState.vars);
    playState.renderedSceneId = scene.id;
    playState.history.push(scene.id);
    renderPlaytest(focus !== false);
  }

  function choosePlayChoice(choiceId) {
    if (!playState) return;
    var scene = sceneById(playState.sceneId);
    if (!scene) return;
    var choice = null;
    for (var i = 0; i < scene.choices.length; i++) {
      if (scene.choices[i].id === choiceId) {
        choice = scene.choices[i];
        break;
      }
    }
    if (!choice) return;
    if (!ENGINE.evalCondition(choice.condition || '', playState.vars)) return;

    ENGINE.applyEffects(choice.effects || '', playState.vars);
    if (choice.targetId && sceneById(choice.targetId)) {
      enterPlayScene(choice.targetId, true);
    } else {
      playState.ended = true;
      renderPlaytest(true);
    }
  }

  function continuePlaytest() {
    if (!playState) return;
    var scene = sceneById(playState.sceneId);
    if (!scene) return;
    if (scene.nextId && sceneById(scene.nextId)) {
      enterPlayScene(scene.nextId, true);
    } else {
      playState.ended = true;
      renderPlaytest(true);
    }
  }

  function renderPlaytest(focus) {
    if (!playState || !els.playContent) return;
    applyPlaytestTheme();
    var scene = sceneById(playState.sceneId);
    var context = sceneContext(playState.sceneId);

    if (!scene) {
      els.playContent.innerHTML = '<div class="play-missing"><h2>This scene is missing.</h2><p>Check the opening scene in the editor.</p><button type="button" class="btn btn-primary" data-action="play-restart">Restart</button></div>';
      return;
    }

    var available = [];
    var locked = [];
    if (scene.mode === 'choices') {
      scene.choices.forEach(function (choice) {
        if (ENGINE.evalCondition(choice.condition, playState.vars)) available.push(choice);
        else locked.push(choice);
      });
    }

    var flowHTML = '';
    var hiddenNote = '';

    if (!playState.ended) {
      if (scene.mode === 'choices') {
        if (available.length) {
          flowHTML = '<div class="play-flow"><p class="play-flow-label">What do you do?</p><div class="play-choice-list">'
            + available.map(function (choice, choiceIndex) {
              return playChoiceHTML(choice, choiceIndex, playState.vars, false);
            }).join('')
            + '</div></div>';
        } else {
          flowHTML = '<div class="play-warning"><strong>No choices are available.</strong><p>Turn on “Show locked choices” below to inspect the conditions.</p></div>';
        }

        if (playState.showLocked && locked.length) {
          flowHTML += '<div class="play-locked-list"><p class="play-flow-label">Locked choices</p>'
            + locked.map(function (choice, choiceIndex) {
              return playChoiceHTML(choice, available.length + choiceIndex, playState.vars, true);
            }).join('')
            + '</div>';
        } else if (locked.length) {
          hiddenNote = '<p class="play-hidden-note">' + locked.length + (locked.length === 1 ? ' choice is' : ' choices are') + ' hidden by conditions.</p>';
        }
      } else if (scene.mode === 'link') {
        var destination = sceneById(scene.nextId);
        if (destination) {
          flowHTML = '<div class="play-flow"><button type="button" class="play-continue" data-action="play-continue">'
            + '<span>' + esc(scene.nextLabel || 'Continue') + '</span>'
            + '<span class="play-choice-side">→</span>'
            + '</button><p class="play-target-note">Next: ' + esc(destination.title || 'Untitled scene') + '</p></div>';
        } else {
          flowHTML = '<div class="play-warning"><strong>No next scene is set.</strong><p>Choose a destination in the Direct link panel, or make this an ending.</p></div>';
        }
      }
    }

    var copy = normalizeStoryCopy(story.copy);
    var endsNow = playState.ended || scene.mode === 'end';
    var endingHTML = endsNow
      ? '<div class="play-ending"><span class="play-ending-mark" aria-hidden="true">✦</span>'
        + '<h2>' + esc(copy.endingTitle) + '</h2>'
        + (copy.endingMessage ? '<p>' + escMultiline(copy.endingMessage) + '</p>' : '')
        + '<button type="button" class="btn btn-primary" data-action="play-restart">' + esc(copy.endingButton) + '</button>'
        + '</div>'
      : '';

    var kicker = 'Playtest';
    if (context) {
      kicker += ' · ' + (context.act.title || 'Act')
        + ' · ' + (context.chapter.title || 'Chapter')
        + ' · Scene ' + (context.sceneIndex + 1);
    }

    els.playContent.innerHTML = '<div class="play-layout">'
      + '<div class="play-main">'
      + '<div class="play-chapter">'
      + '<p class="eyebrow">' + esc(kicker) + '</p>'
      + '<h1 class="play-chapter-title" tabindex="-1">' + esc(scene.title || 'Untitled scene') + '</h1>'
      + '<div class="story-content play-story-text">' + playState.renderedBody + '</div>'
      + flowHTML
      + hiddenNote
      + endingHTML
      + '</div>'
      + '</div>'
      + playSidebarHTML()
      + '</div>';

    var main = els.playContent.querySelector('.play-main');
    if (main) main.scrollTop = 0;

    if (focus) {
      var heading = els.playContent.querySelector('.play-chapter-title');
      if (heading) {
        try { heading.focus({ preventScroll: true }); }
        catch (error) { heading.focus(); }
      }
    }
  }

  function playChoiceHTML(choice, index, vars, locked) {
    var label = safeRender(choice.label || 'Continue', Object.assign({}, vars));
    return '<button type="button" class="play-choice' + (locked ? ' is-locked' : '') + '" data-action="play-choice" data-id="' + esc(choice.id) + '"' + (locked ? ' disabled' : '') + '>'
      + '<span class="play-choice-number">' + (index + 1) + '</span>'
      + '<span class="play-choice-label">' + label + '</span>'
      + '<span class="play-choice-side">' + (locked ? '<span class="play-condition">' + esc(choice.condition || 'Unavailable') + '</span>' : '→') + '</span>'
      + '</button>';
  }

  function playSidebarHTML() {
    var definitions = {};
    allVariables().forEach(function (variable) {
      if (variable.name) definitions[variable.name] = variable;
    });

    function valueRow(entry) {
      var changed = !Object.prototype.hasOwnProperty.call(playState.baseline, entry.name)
        || valuesDiffer(entry.initial, entry.current);
      return '<div class="state-row' + (changed ? ' is-changed' : '') + '">'
        + '<span class="state-name">' + esc(entry.label) + '</span>'
        + '<span class="state-value">' + esc(formatStateValue(entry.current)) + '</span>'
        + (changed && Object.prototype.hasOwnProperty.call(playState.baseline, entry.name)
          ? '<span class="state-was">was ' + esc(formatStateValue(entry.initial)) + '</span>'
          : '')
        + '</div>';
    }

    function itemRow(entry) {
      return '<div class="state-row is-item">'
        + '<span class="state-name">' + esc(entry.label) + '</span>'
        + '<span class="state-value">×' + esc(formatStateValue(Number(entry.current))) + '</span>'
        + '</div>';
    }

    var assigned = {};
    var groups = [];
    allCategories().forEach(function (category) {
      var entries = [];
      (Array.isArray(category.variables) ? category.variables : []).forEach(function (variable) {
        if (!variable.name) return;
        assigned[variable.name] = true;
        entries.push({
          name: variable.name,
          label: variableDisplayName(variable),
          current: playState.vars[variable.name],
          initial: playState.baseline[variable.name]
        });
      });
      if (entries.length) {
        groups.push({
          title: category.title || (category.kind === 'inventory' ? 'Inventory' : 'Stats'),
          kind: category.kind,
          entries: entries
        });
      }
    });

    var extraEntries = Object.keys(playState.vars).filter(function (name) {
      return !assigned[name];
    }).map(function (name) {
      var definition = definitions[name];
      return {
        name: name,
        label: definition ? variableDisplayName(definition) : humanizeVariableName(name),
        current: playState.vars[name],
        initial: playState.baseline[name]
      };
    });
    if (extraEntries.length) {
      groups.push({ title: 'Other', kind: 'sheet', entries: extraEntries });
    }

    var stateHTML = '';
    groups.forEach(function (group) {
      var isInventory = group.kind === 'inventory';
      var entries = isInventory ? group.entries.filter(function (entry) {
        return Number(entry.current) > 0;
      }) : group.entries;
      stateHTML += '<p class="state-section-label">' + esc(group.title) + '</p>';
      if (isInventory) {
        stateHTML += entries.length
          ? entries.map(itemRow).join('')
          : '<p class="state-empty-line">Nothing carried yet.</p>';
      } else {
        stateHTML += entries.map(valueRow).join('');
      }
    });

    if (!groups.length) {
      stateHTML = '<p class="state-empty">No stats or items yet.</p>';
    }

    return '<aside class="play-side" aria-label="' + esc(statePanelTitle()) + '">'
      + '<div class="play-side-head"><h2>' + esc(statePanelTitle()) + '</h2><span class="temp-pill">Playtest</span></div>'
      + '<div class="state-list">' + stateHTML + '</div>'
      + '<label class="switch-row"><input id="playShowLocked" type="checkbox"' + (playState.showLocked ? ' checked' : '') + '><span class="switch-ui" aria-hidden="true"></span><span>Show locked choices</span></label>'
      + '</aside>';
  }

  /* ----------------------------------------------------------------------- */
  /* Standalone story export                                                 */
  /* ----------------------------------------------------------------------- */

  var PLAYER_CSS = `
    :root {
      --paper: #f7f2e8;
      --paper-deep: #efe7d8;
      --surface: #fdfaf4;
      --ink: #29241f;
      --muted: #756d61;
      --faint: #a59b8c;
      --line: #ded4c3;
      --accent: #b75435;
      --accent-dark: #96422a;
      --accent-soft: #f0ddd2;
      --green: #3f6b53;
      --shadow: 0 24px 60px rgba(59, 43, 28, 0.10), 0 3px 10px rgba(59, 43, 28, 0.05);
      --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif;
      --sans: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      --body-font: var(--serif);
      --heading-font: var(--serif);
      --body-ink: #302a23;
      --accent-rgb: 183, 84, 53;
      --paper-rgb: 247, 242, 232;
      --surface-rgb: 253, 250, 244;
      --ink-rgb: 41, 36, 31;
    }

    * { box-sizing: border-box; }
    html { background: var(--paper-deep); }
    body {
      margin: 0;
      min-height: 100vh;
      min-height: 100dvh;
      color: var(--ink);
      font-family: var(--sans);
      background:
        radial-gradient(circle at 10% -10%, rgba(var(--accent-rgb), 0.10), transparent 34rem),
        radial-gradient(circle at 100% 0%, rgba(63, 107, 83, 0.07), transparent 30rem),
        var(--paper);
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }
    button { font: inherit; color: inherit; }
    button:focus-visible, a:focus-visible, [tabindex]:focus-visible {
      outline: 3px solid rgba(var(--accent-rgb), 0.42);
      outline-offset: 3px;
    }
    ::selection { background: var(--accent-soft); color: var(--ink); }

    .cover-shell {
      position: relative;
      min-height: 100vh;
      min-height: 100dvh;
      display: grid;
      place-items: center;
      padding: 40px 24px;
      overflow: hidden;
    }
    .cover-shell::before,
    .cover-shell::after {
      content: "";
      position: absolute;
      border-radius: 999px;
      pointer-events: none;
      filter: blur(2px);
    }
    .cover-shell::before {
      width: 52vmax;
      height: 52vmax;
      right: -24vmax;
      top: -26vmax;
      background: radial-gradient(circle, rgba(var(--accent-rgb), 0.13), transparent 68%);
    }
    .cover-shell::after {
      width: 46vmax;
      height: 46vmax;
      left: -28vmax;
      bottom: -24vmax;
      background: radial-gradient(circle, rgba(63, 107, 83, 0.11), transparent 68%);
    }
    .cover {
      position: relative;
      z-index: 1;
      width: min(760px, 100%);
      text-align: center;
      animation: rise 700ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }
    .cover-mark {
      display: inline-grid;
      place-items: center;
      width: 46px;
      height: 46px;
      margin-bottom: 30px;
      border: 1px solid rgba(var(--accent-rgb), 0.35);
      border-radius: 50%;
      color: var(--accent);
      font-family: var(--heading-font, var(--serif));
      font-size: 24px;
      background: rgba(var(--surface-rgb), 0.65);
    }
    .kicker {
      margin: 0 0 12px;
      color: var(--accent);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }
    .cover-title {
      margin: 0 auto;
      max-width: 700px;
      font-family: var(--heading-font, var(--serif));
      font-size: clamp(48px, 8vw, 92px);
      font-weight: 500;
      line-height: 0.98;
      letter-spacing: -0.045em;
      text-wrap: balance;
    }
    .cover-rule {
      width: 58px;
      height: 1px;
      margin: 32px auto;
      background: linear-gradient(90deg, transparent, var(--accent), transparent);
    }
    .cover-sub {
      max-width: 430px;
      margin: 0 auto 38px;
      color: var(--muted);
      font-family: var(--body-font, var(--serif));
      font-size: 18px;
      line-height: 1.65;
    }
    .begin-btn {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      padding: 14px 26px;
      border: 1px solid var(--accent-dark);
      border-radius: 999px;
      background: var(--accent);
      color: #fffaf3;
      font-weight: 650;
      letter-spacing: 0.01em;
      box-shadow: 0 12px 28px rgba(var(--accent-rgb), 0.22);
      cursor: pointer;
      transition: transform 160ms ease, background 160ms ease, box-shadow 160ms ease;
    }
    .begin-btn:hover {
      background: var(--accent-dark);
      transform: translateY(-2px);
      box-shadow: 0 16px 34px rgba(var(--accent-rgb), 0.26);
    }
    .cover-load {
      display: inline-block;
      margin-top: 18px;
      padding: 6px 10px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      text-decoration: underline;
      text-decoration-color: rgba(117, 109, 97, 0.42);
      text-underline-offset: 3px;
      cursor: pointer;
      transition: color 150ms ease, background 150ms ease;
    }
    .cover-load:hover { background: rgba(var(--accent-rgb), 0.07); color: var(--accent-dark); }
    .cover-hint {
      margin: 12px 0 0;
      color: var(--faint);
      font-size: 12px;
    }

    .site-bar {
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      min-height: 62px;
      padding: 0 28px;
      border-bottom: 1px solid rgba(222, 212, 195, 0.86);
      background: rgba(var(--paper-rgb), 0.86);
      backdrop-filter: blur(14px);
    }
    .site-brand {
      min-width: 0;
      overflow: hidden;
      color: var(--muted);
      font-family: var(--heading-font, var(--serif));
      font-size: 16px;
      letter-spacing: 0.01em;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .site-actions { display: flex; align-items: center; gap: 4px; flex: none; }
    .site-actions [data-state-toggle] {
      max-width: min(240px, 42vw);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ghost-btn {
      padding: 7px 11px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 150ms ease, color 150ms ease;
    }
    .ghost-btn:hover { background: rgba(var(--accent-rgb), 0.08); color: var(--accent-dark); }

    .story-page {
      width: 100%;
      max-width: 1100px;
      margin: 0 auto;
      padding: 58px 30px 110px;
      display: grid;
      grid-template-columns: minmax(0, 710px);
      gap: 46px;
      justify-content: center;
      align-items: start;
    }
    .story-page.has-state {
      grid-template-columns: minmax(0, 660px) 278px;
    }
    .chapter { min-width: 0; animation: rise 480ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
    .chapter-kicker {
      margin: 0 0 14px;
      color: var(--accent);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }
    .chapter-title {
      margin: 0 0 34px;
      color: var(--title-ink, var(--ink));
      font-family: var(--heading-font, var(--serif));
      font-size: clamp(36px, 5vw, 54px);
      font-weight: 500;
      line-height: 1.06;
      letter-spacing: -0.035em;
      text-wrap: balance;
    }
    .story-text {
      color: var(--body-ink, #302a23);
      font-family: var(--body-font, var(--serif));
      font-size: 19px;
      line-height: 1.82;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .story-text .sw-big { font-size: 1.3em; line-height: 1.45; }
    .story-text .sw-small { color: var(--muted); font-size: 0.82em; }
    .story-text .sw-accent { color: var(--accent); }
    .story-text .sw-muted { color: var(--muted); }
    .story-text .sw-heading {
      display: block;
      margin: 0.7em 0 0.2em;
      font-size: 1.45em;
      font-weight: 600;
      line-height: 1.25;
      letter-spacing: -0.02em;
    }
    .story-text .sw-center { display: block; text-align: center; }
    .story-text .sw-quote {
      display: block;
      margin: 0.9em 0;
      padding-left: 1em;
      border-left: 3px solid rgba(var(--accent-rgb), 0.45);
      color: #5d5449;
      font-style: italic;
    }
    .story-text mark {
      padding: 0.02em 0.18em;
      background: rgba(218, 170, 74, 0.30);
      border-radius: 3px;
      color: inherit;
    }
    .story-text code {
      padding: 0.12em 0.35em;
      border: 1px solid var(--line);
      border-radius: 5px;
      background: rgba(255, 255, 255, 0.5);
      font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
      font-size: 0.84em;
    }
    .story-text .sw-divider {
      margin: 1.8em auto;
      border: 0;
      border-top: 1px solid var(--line);
      width: 42%;
    }
    .story-text strong { font-weight: 700; }

    .choice-list {
      display: grid;
      gap: 11px;
      margin-top: 48px;
      animation: rise 600ms 100ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }
    .choice {
      display: grid;
      grid-template-columns: 32px minmax(0, 1fr) auto;
      align-items: center;
      gap: 13px;
      width: 100%;
      padding: 15px 17px;
      border: 1px solid var(--line);
      border-radius: 13px;
      background: rgba(253, 250, 244, 0.72);
      color: var(--choice-ink, var(--ink));
      text-align: left;
      cursor: pointer;
      transition: transform 150ms ease, border-color 150ms ease, background 150ms ease, box-shadow 150ms ease;
    }
    .choice:hover {
      border-color: rgba(var(--accent-rgb), 0.5);
      background: var(--surface);
      transform: translateX(3px);
      box-shadow: 0 8px 22px rgba(59, 43, 28, 0.06);
    }
    .choice-number {
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border: 1px solid rgba(var(--accent-rgb), 0.32);
      border-radius: 50%;
      color: var(--accent);
      font-size: 11px;
      font-weight: 700;
    }
    .choice-label { color: var(--choice-ink, var(--ink)); font-family: var(--body-font, var(--serif)); font-size: 17px; line-height: 1.45; }
    .choice-label .sw-big { font-size: 1.1em; }
    .choice-arrow { color: var(--faint); font-size: 18px; transition: color 150ms ease, transform 150ms ease; }
    .choice:hover .choice-arrow { color: var(--accent); transform: translateX(2px); }

    .continue-wrap { margin-top: 48px; animation: rise 600ms 100ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
    .continue-btn {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      width: 100%;
      padding: 16px 18px;
      border: 1px solid var(--accent-dark);
      border-radius: 13px;
      background: var(--accent);
      color: #fffaf3;
      font-family: var(--body-font, var(--serif));
      font-size: 17px;
      text-align: left;
      box-shadow: 0 10px 24px rgba(var(--accent-rgb), 0.18);
      cursor: pointer;
      transition: background 150ms ease, transform 150ms ease;
    }
    .continue-btn:hover { background: var(--accent-dark); transform: translateY(-1px); }
    .continue-btn .choice-arrow { color: rgba(255, 250, 243, 0.7); }
    .target-note { margin: 10px 0 0; color: var(--faint); font-size: 11px; text-align: right; }

    .end-card {
      margin-top: 52px;
      padding: 38px 28px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: rgba(var(--surface-rgb), 0.62);
      text-align: center;
      animation: rise 540ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }
    .end-mark { color: var(--accent); font-size: 24px; }
    .end-card h2 {
      margin: 12px 0 8px;
      font-family: var(--heading-font, var(--serif));
      font-size: 33px;
      font-weight: 500;
      letter-spacing: -0.03em;
    }
    .end-card p { margin: 0 auto 22px; max-width: 360px; color: var(--muted); font-size: 13px; line-height: 1.6; }
    .read-again {
      padding: 10px 18px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: transparent;
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: border-color 150ms ease, color 150ms ease, background 150ms ease;
    }
    .read-again:hover { border-color: var(--accent); background: var(--surface); color: var(--accent-dark); }

    .state-panel {
      position: sticky;
      top: 92px;
      padding: 20px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: rgba(var(--surface-rgb), 0.64);
      box-shadow: 0 12px 40px rgba(59, 43, 28, 0.04);
      animation: rise 480ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }
    .state-panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 16px; }
    .state-panel-head > div { min-width: 0; }
    .state-panel h2 { margin: 0; overflow-wrap: anywhere; font-family: var(--heading-font, var(--serif)); font-size: 20px; font-weight: 500; letter-spacing: -0.02em; }
    .state-panel .kicker { margin-bottom: 5px; font-size: 9px; }
    .close-state { border: 0; background: transparent; color: var(--faint); font-size: 20px; line-height: 1; cursor: pointer; padding: 2px 4px; }
    .close-state:hover { color: var(--accent); }
    .state-list { display: grid; gap: 1px; border-top: 1px solid var(--line); }
    .state-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 2px 12px;
      padding: 10px 0;
      border-bottom: 1px solid rgba(222, 212, 195, 0.65);
    }
    .state-section-label {
      grid-column: 1 / -1;
      margin: 12px 0 0;
      color: var(--faint);
      font-size: 8px;
      font-weight: 750;
      letter-spacing: 0.13em;
      text-transform: uppercase;
    }
    .state-section-label:first-child { margin-top: 10px; }
    .state-row.is-changed .state-value { color: var(--accent-dark); }
    .state-row.is-changed .state-name { color: var(--ink); }
    .state-name { overflow-wrap: anywhere; color: var(--muted); font-size: 12px; font-weight: 600; }
    .state-value { color: var(--ink); font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; font-size: 12px; font-weight: 600; text-align: right; overflow-wrap: anywhere; }
    .state-row.is-item .state-name { color: var(--ink); font-family: var(--body-font, var(--serif)); font-size: 13px; }
    .state-row.is-item .state-value { color: var(--accent-dark); }
    .state-was { grid-column: 1 / -1; color: var(--faint); font-size: 10px; }
    .state-empty { margin: 0; color: var(--faint); font-size: 12px; line-height: 1.55; }
    .state-empty-line { grid-column: 1 / -1; margin: 0; padding: 8px 0; color: var(--faint); font-size: 11px; font-style: italic; }

    .sw-big { font-size: 1.3em; }
    .sw-small { font-size: 0.82em; }
    .sw-accent { color: var(--accent); }
    .sw-muted { color: var(--muted); }
    .sw-heading { display: block; font-size: 1.45em; font-weight: 600; }
    .sw-center { display: block; text-align: center; }
    .sw-quote { display: block; padding-left: 1em; border-left: 3px solid rgba(var(--accent-rgb), 0.45); font-style: italic; }
    .sw-divider { border: 0; border-top: 1px solid var(--line); width: 42%; margin: 1.6em auto; }
    .sw-image {
      display: block;
      max-width: 100%;
      height: auto;
      margin: 1.4em auto;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: rgba(var(--surface-rgb), 0.5);
    }
    .sw-image-missing {
      display: inline-block;
      padding: 0.18em 0.5em;
      border: 1px dashed var(--line);
      border-radius: 5px;
      color: var(--faint);
      font-size: 0.82em;
    }

    body.save-open { overflow: hidden; }

    .save-overlay {
      position: fixed;
      inset: 0;
      z-index: 80;
      display: grid;
      place-items: center;
      padding: 22px;
      background: rgba(41, 36, 31, 0.46);
      backdrop-filter: blur(5px);
      animation: fadeIn 160ms ease both;
    }
    .save-overlay[hidden] { display: none; }
    .save-dialog {
      width: min(560px, 100%);
      max-height: min(88vh, 720px);
      overflow: auto;
      padding: 26px;
      border: 1px solid var(--line);
      border-radius: 18px;
      background: var(--surface);
      box-shadow: var(--shadow);
      animation: rise 220ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }
    .save-dialog-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
    .save-dialog-head .kicker { margin-bottom: 5px; }
    .save-dialog h2 {
      margin: 0;
      font-family: var(--heading-font, var(--serif));
      font-size: 30px;
      font-weight: 500;
      line-height: 1.05;
      letter-spacing: -0.035em;
    }
    .save-close {
      flex: none;
      padding: 2px 4px;
      border: 0;
      background: transparent;
      color: var(--faint);
      font-size: 24px;
      line-height: 1;
      cursor: pointer;
    }
    .save-close:hover { color: var(--accent); }
    .save-dialog-body { min-width: 0; }
    .save-note { margin: 0 0 14px; color: var(--muted); font-size: 13px; line-height: 1.65; }
    .save-position { margin: -6px 0 14px; color: var(--accent-dark); font-size: 11px; font-weight: 650; letter-spacing: 0.02em; }
    .save-key {
      display: block;
      width: 100%;
      min-height: 112px;
      resize: vertical;
      padding: 13px 14px;
      border: 1px solid var(--line);
      border-radius: 11px;
      background: var(--paper);
      color: var(--ink);
      font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
      font-size: 12px;
      line-height: 1.55;
      overflow-wrap: anywhere;
      word-break: break-all;
    }
    .save-key:focus { outline: 3px solid rgba(var(--accent-rgb), 0.24); outline-offset: 2px; }
    .save-key-input { min-height: 96px; }
    .save-file-row { display: flex; align-items: center; gap: 10px; margin-top: 11px; }
    .save-file-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 8px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: transparent;
      color: var(--muted);
      font-size: 11px;
      font-weight: 650;
      cursor: pointer;
      transition: border-color 150ms ease, color 150ms ease, background 150ms ease;
    }
    .save-file-btn:hover { border-color: var(--accent); background: rgba(var(--accent-rgb), 0.06); color: var(--accent-dark); }
    .save-file-btn:focus-within { outline: 3px solid rgba(var(--accent-rgb), 0.24); outline-offset: 2px; }
    .save-file-btn input {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .save-message { min-height: 18px; margin: 10px 0 0; color: var(--accent-dark); font-size: 11px; line-height: 1.5; }
    .save-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 8px; }
    .save-btn {
      padding: 9px 15px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: transparent;
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
      cursor: pointer;
      transition: border-color 150ms ease, background 150ms ease, color 150ms ease, transform 150ms ease;
    }
    .save-btn:hover { border-color: var(--accent); background: rgba(var(--accent-rgb), 0.06); color: var(--accent-dark); }
    .save-btn.primary { border-color: var(--accent-dark); background: var(--accent); color: #fffaf3; }
    .save-btn.primary:hover { background: var(--accent-dark); color: #fffaf3; transform: translateY(-1px); }
    .save-btn.quiet { border-color: transparent; }
    .save-btn.quiet:hover { border-color: var(--line); background: transparent; color: var(--ink); }
    .save-btn:disabled { opacity: 0.45; cursor: default; transform: none; }
    .save-btn:disabled:hover { border-color: var(--line); background: transparent; color: var(--muted); }
    .save-btn.primary:disabled:hover { background: var(--accent); color: #fffaf3; }

    .restart-overlay { z-index: 90; }
    .restart-label {
      display: block;
      margin: 0 0 6px;
      color: var(--muted);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .restart-input {
      display: block;
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 9px;
      background: var(--paper);
      color: var(--ink);
      font-family: var(--body-font, var(--serif));
      font-size: 16px;
    }
    .restart-input:focus { outline: 3px solid rgba(var(--accent-rgb), 0.24); outline-offset: 2px; }
    .restart-hint { min-height: 18px; margin: 8px 0 0; color: var(--faint); font-size: 11px; line-height: 1.5; }
    .restart-hint.is-ready { color: var(--accent-dark); font-weight: 650; }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .error-screen { max-width: 620px; margin: 12vh auto; padding: 28px; border: 1px solid var(--line); border-radius: 16px; background: var(--surface); text-align: center; }
    .error-screen h1 { font-family: var(--heading-font, var(--serif)); font-weight: 500; }

    @keyframes rise {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @media (max-width: 900px) {
      .story-page, .story-page.has-state { grid-template-columns: minmax(0, 1fr); gap: 34px; }
      .state-panel { position: static; }
    }
    @media (max-width: 600px) {
      .site-bar {
        flex-wrap: wrap;
        align-items: center;
        min-height: 0;
        padding: 9px 12px;
        gap: 5px 10px;
      }
      .site-brand {
        flex: 1 1 100%;
        max-width: 100%;
        overflow: visible;
        font-size: 14px;
        line-height: 1.25;
        text-overflow: clip;
        white-space: normal;
      }
      .site-actions { width: 100%; justify-content: flex-end; gap: 0; }
      .site-actions [data-state-toggle] {
        max-width: none;
        overflow: visible;
        text-overflow: clip;
        white-space: nowrap;
      }
      .ghost-btn { padding: 7px 7px; font-size: 11px; white-space: nowrap; }
      .story-page { padding: 40px 20px 80px; }
      .chapter-title { margin-bottom: 26px; }
      .story-text { font-size: 18px; line-height: 1.75; }
      .choice-list, .continue-wrap { margin-top: 38px; }
      .choice { grid-template-columns: 28px minmax(0, 1fr) auto; padding: 14px; }
      .cover-title { font-size: clamp(42px, 13vw, 64px); }
      .save-overlay { padding: 12px; }
      .save-dialog { padding: 20px 17px; border-radius: 15px; max-height: 92vh; }
      .save-dialog h2 { font-size: 26px; }
      .save-key { min-height: 96px; font-size: 11px; }
      .save-actions { justify-content: stretch; }
      .save-btn { flex: 1 1 auto; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        scroll-behavior: auto !important;
        transition-duration: 0.01ms !important;
      }
    }
  `;

  function playerMain(ENGINE, STORY) {
    var root = document.getElementById('story-root');
    var acts = Array.isArray(STORY.acts) ? STORY.acts : [];
    var categories = Array.isArray(STORY.categories) ? STORY.categories : [];
    var stats = Array.isArray(STORY.stats) ? STORY.stats : [];
    var items = Array.isArray(STORY.items) ? STORY.items : [];
    var images = STORY.images && typeof STORY.images === 'object' ? STORY.images : {};
    var copy = STORY.copy && typeof STORY.copy === 'object' ? STORY.copy : {};
    var state = null;
    var baseline = null;
    var currentId = null;
    var started = false;
    var ended = false;
    var showState = /(?:^|[?&])debug=1(?:&|$)/.test(window.location.search);
    var focusMain = false;
    var path = [];
    var renderedBody = '';
    var renderedSceneId = '';
    var sceneEntryState = null;
    var endedChoiceId = '';
    var currentFingerprint = 0;
    var sceneOrder = [];
    var sceneIndexById = Object.create(null);
    var saveOverlay = null;
    var saveReturnFocus = null;
    var restartOverlay = null;
    var restartReturnFocus = null;

    function esc(value) {
      return ENGINE.escapeHTML(value);
    }

    function copyValue(key, fallback) {
      var value = copy[key];
      return typeof value === 'string' ? value.trim() : fallback;
    }

    function copyRequired(key, fallback) {
      var value = copyValue(key, fallback);
      return value || fallback;
    }

    function copyHTML(value) {
      return esc(value).replace(/\n/g, '<br>');
    }

    function locateScene(id) {
      for (var a = 0; a < acts.length; a++) {
        var act = acts[a];
        var chapters = Array.isArray(act.chapters) ? act.chapters : [];
        for (var c = 0; c < chapters.length; c++) {
          var chapter = chapters[c];
          var scenes = Array.isArray(chapter.scenes) ? chapter.scenes : [];
          for (var s = 0; s < scenes.length; s++) {
            if (scenes[s].id === id) {
              return {
                scene: scenes[s],
                act: act,
                chapter: chapter,
                actIndex: a,
                chapterIndex: c,
                sceneIndex: s
              };
            }
          }
        }
      }
      return null;
    }

    function findScene(id) {
      var location = locateScene(id);
      return location ? location.scene : null;
    }

    function firstScene() {
      for (var a = 0; a < acts.length; a++) {
        var chapters = Array.isArray(acts[a].chapters) ? acts[a].chapters : [];
        for (var c = 0; c < chapters.length; c++) {
          var scenes = Array.isArray(chapters[c].scenes) ? chapters[c].scenes : [];
          if (scenes.length) return scenes[0];
        }
      }
      return null;
    }

    function hasOwnKey(object, key) {
      return Object.prototype.hasOwnProperty.call(object, key);
    }

    function copyState(source) {
      var copy = {};
      if (!source) return copy;
      Object.keys(source).forEach(function (name) {
        copy[name] = source[name];
      });
      return copy;
    }

    function sameStateValue(left, right) {
      return typeof left === typeof right && left === right;
    }

    function titleSlug() {
      var slug = String(STORY.title || 'STORY')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      if (!slug) slug = 'STORY';
      if (slug.length > 28) slug = slug.slice(0, 28).replace(/-+$/g, '');
      return slug || 'STORY';
    }

    function utf8Bytes(value) {
      var text = String(value == null ? '' : value);
      if (typeof TextEncoder !== 'undefined') {
        return Array.prototype.slice.call(new TextEncoder().encode(text));
      }
      var encoded = unescape(encodeURIComponent(text));
      var bytes = [];
      for (var i = 0; i < encoded.length; i++) bytes.push(encoded.charCodeAt(i));
      return bytes;
    }

    function utf8Text(bytes) {
      if (typeof TextDecoder !== 'undefined') {
        return new TextDecoder().decode(new Uint8Array(bytes));
      }
      var encoded = '';
      for (var i = 0; i < bytes.length; i++) encoded += String.fromCharCode(bytes[i]);
      try {
        return decodeURIComponent(escape(encoded));
      } catch (error) {
        return encoded;
      }
    }

    function fingerprintBytes(bytes) {
      var hash = 2166136261;
      for (var i = 0; i < bytes.length; i++) {
        hash ^= bytes[i];
        if (Math.imul) hash = Math.imul(hash, 16777619);
        else hash = (hash * 16777619) >>> 0;
      }
      return hash >>> 0;
    }

    function storyFingerprint() {
      return fingerprintBytes(utf8Bytes(JSON.stringify(STORY)));
    }

    var BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

    function bytesToBase62(bytes) {
      var digits = [];
      var input = bytes.slice();
      while (input.length) {
        var remainder = 0;
        var quotient = [];
        for (var i = 0; i < input.length; i++) {
          var accumulator = remainder * 256 + input[i];
          var digit = Math.floor(accumulator / 62);
          remainder = accumulator % 62;
          if (digit || quotient.length) quotient.push(digit);
        }
        digits.push(remainder);
        input = quotient;
      }
      if (!digits.length) digits.push(0);
      var output = '';
      for (var d = digits.length - 1; d >= 0; d--) output += BASE62.charAt(digits[d]);
      return output;
    }

    function base62ToBytes(text) {
      var bytes = [];
      for (var i = 0; i < text.length; i++) {
        var carry = BASE62.indexOf(text.charAt(i));
        if (carry < 0) throw new Error('Invalid save data');
        for (var b = 0; b < bytes.length; b++) {
          var value = bytes[b] * 62 + carry;
          bytes[b] = value & 255;
          carry = value >> 8;
        }
        while (carry > 0) {
          bytes.push(carry & 255);
          carry = carry >> 8;
        }
      }
      bytes.reverse();
      if (!bytes.length) bytes.push(0);
      return bytes;
    }

    function ByteWriter() {
      this.bytes = [];
    }
    ByteWriter.prototype.writeByte = function (value) {
      this.bytes.push(value & 255);
    };
    ByteWriter.prototype.writeUint32 = function (value) {
      value = value >>> 0;
      this.bytes.push((value >>> 24) & 255);
      this.bytes.push((value >>> 16) & 255);
      this.bytes.push((value >>> 8) & 255);
      this.bytes.push(value & 255);
    };
    ByteWriter.prototype.writeVarint = function (value) {
      value = value >>> 0;
      while (value >= 128) {
        this.bytes.push((value & 127) | 128);
        value = value >>> 7;
      }
      this.bytes.push(value);
    };
    ByteWriter.prototype.writeString = function (value) {
      var bytes = utf8Bytes(value);
      this.writeVarint(bytes.length);
      for (var i = 0; i < bytes.length; i++) this.bytes.push(bytes[i]);
    };
    ByteWriter.prototype.finish = function () {
      this.writeUint32(fingerprintBytes(this.bytes));
      return this.bytes;
    };

    function ByteReader(bytes) {
      this.bytes = bytes;
      this.offset = 0;
    }
    ByteReader.prototype.remaining = function () {
      return this.bytes.length - this.offset;
    };
    ByteReader.prototype.readByte = function () {
      if (this.offset >= this.bytes.length) throw new Error('Invalid save data');
      return this.bytes[this.offset++];
    };
    ByteReader.prototype.readUint32 = function () {
      return ((this.readByte() << 24) | (this.readByte() << 16) | (this.readByte() << 8) | this.readByte()) >>> 0;
    };
    ByteReader.prototype.readVarint = function () {
      var result = 0;
      var shift = 0;
      while (true) {
        var byte = this.readByte();
        result |= (byte & 127) << shift;
        if (!(byte & 128)) break;
        shift += 7;
        if (shift > 35) throw new Error('Invalid save data');
      }
      return result >>> 0;
    };
    ByteReader.prototype.readString = function () {
      var length = this.readVarint();
      if (length > this.remaining()) throw new Error('Invalid save data');
      var slice = this.bytes.slice(this.offset, this.offset + length);
      this.offset += length;
      return utf8Text(slice);
    };

    function readUint32At(bytes, offset) {
      return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
    }

    function buildSceneOrder() {
      sceneOrder = [];
      sceneIndexById = Object.create(null);
      acts.forEach(function (act) {
        var chapters = Array.isArray(act.chapters) ? act.chapters : [];
        chapters.forEach(function (chapter) {
          var scenes = Array.isArray(chapter.scenes) ? chapter.scenes : [];
          scenes.forEach(function (scene) {
            if (!scene || !scene.id || hasOwnKey(sceneIndexById, scene.id)) return;
            sceneIndexById[scene.id] = sceneOrder.length;
            sceneOrder.push(scene);
          });
        });
      });
    }

    function safeRender(markup, vars) {
      try {
        return ENGINE.renderMarkup(markup || '', vars, images);
      } catch (error) {
        return '<span class="sw-muted">This text could not be rendered.</span>';
      }
    }

    function humanizeName(name) {
      var text = String(name == null ? '' : name)
        .replace(/^has(?=[A-Z])/, '')
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();
      if (!text) return 'Variable';
      return text.charAt(0).toUpperCase() + text.slice(1);
    }

    function displayName(variable) {
      if (!variable) return 'Variable';
      var label = String(variable.label == null ? '' : variable.label).trim();
      return label || humanizeName(variable.name);
    }

    function panelTitle() {
      var title = STORY.statePanel && STORY.statePanel.title;
      return String(title == null ? '' : title).trim() || 'Story state';
    }

    function variableDefinitions() {
      var definitions = [];
      categories.forEach(function (category) {
        var variables = Array.isArray(category.variables) ? category.variables : [];
        variables.forEach(function (variable) {
          definitions.push({
            name: variable.name,
            type: category.kind === 'inventory' ? 'item' : (variable.type || 'number'),
            initial: variable.initial
          });
        });
      });
      if (!definitions.length) {
        stats.forEach(function (stat) {
          definitions.push({ name: stat.name, type: stat.type, initial: stat.initial });
        });
        items.forEach(function (item) {
          definitions.push({ name: item.name, type: 'item', initial: item.initial });
        });
      }
      return definitions;
    }

    function initialValues() {
      return ENGINE.createVariables(variableDefinitions());
    }

    function buildSaveData() {
      if (!sceneEntryState || !currentId || !findScene(currentId)) return null;
      var initial = initialValues();
      var changes = [];
      Object.keys(sceneEntryState).forEach(function (name) {
        var value = sceneEntryState[name];
        if (!hasOwnKey(initial, name) || !sameStateValue(initial[name], value)) {
          changes.push({ name: name, value: value });
        }
      });
      var pathIndexes = [];
      path.forEach(function (id) {
        if (hasOwnKey(sceneIndexById, id)) pathIndexes.push(sceneIndexById[id]);
      });
      return {
        fingerprint: currentFingerprint,
        sceneId: currentId,
        ended: !!ended,
        endedChoiceId: ended ? endedChoiceId : '',
        changes: changes,
        pathIndexes: pathIndexes
      };
    }

    function encodeSaveKey() {
      var data = buildSaveData();
      if (!data) return '';
      var writer = new ByteWriter();
      writer.writeByte(1);
      writer.writeUint32(data.fingerprint);
      writer.writeString(data.sceneId);
      var flags = (data.ended ? 1 : 0) | (data.endedChoiceId ? 2 : 0);
      writer.writeByte(flags);
      if (data.endedChoiceId) writer.writeString(data.endedChoiceId);
      writer.writeVarint(data.changes.length);
      data.changes.forEach(function (change) {
        writer.writeString(change.name);
        var value = change.value;
        if (value === null || typeof value === 'undefined') {
          writer.writeByte(0);
        } else if (typeof value === 'number') {
          writer.writeByte(1);
          writer.writeString(String(value));
        } else if (typeof value === 'boolean') {
          writer.writeByte(3);
          writer.writeByte(value ? 1 : 0);
        } else {
          writer.writeByte(2);
          writer.writeString(String(value));
        }
      });
      writer.writeVarint(data.pathIndexes.length);
      data.pathIndexes.forEach(function (index) {
        writer.writeVarint(index);
      });
      var bytes = writer.finish();
      var payload = bytesToBase62(bytes);
      var location = locateScene(data.sceneId);
      var actNumber = location ? location.actIndex + 1 : 0;
      var chapterNumber = location ? location.chapterIndex + 1 : 0;
      return 'SW-' + titleSlug() + '-A' + actNumber + '-C' + chapterNumber + '-' + payload;
    }

    function parseSaveKey(raw) {
      var text = String(raw == null ? '' : raw);
      var marker = text.toUpperCase().indexOf('SW-');
      if (marker >= 0) text = text.slice(marker);
      text = text.replace(/\s+/g, '');
      if (text.length > 200000) throw new Error('Invalid save key');
      var parts = text.split('-');
      if (parts.length < 5 || parts[0].toUpperCase() !== 'SW') throw new Error('Invalid save key');
      var payload = parts[parts.length - 1];
      var chapterToken = parts[parts.length - 2];
      var actToken = parts[parts.length - 3];
      if (!/^A\d+$/i.test(actToken) || !/^C\d+$/i.test(chapterToken)) throw new Error('Invalid save key');
      if (!/^[0-9A-Za-z]+$/.test(payload)) throw new Error('Invalid save key');
      return {
        title: parts.slice(1, parts.length - 3).join('-') || 'STORY',
        act: parseInt(actToken.slice(1), 10),
        chapter: parseInt(chapterToken.slice(1), 10),
        payload: payload
      };
    }

    function decodeSaveKey(raw) {
      var parsed = parseSaveKey(raw);
      var bytes = base62ToBytes(parsed.payload);
      if (bytes.length < 5) throw new Error('Invalid save data');
      var payloadLength = bytes.length - 4;
      var expected = readUint32At(bytes, payloadLength);
      var actual = fingerprintBytes(bytes.slice(0, payloadLength));
      if (expected !== actual) throw new Error('Invalid save data');
      var reader = new ByteReader(bytes.slice(0, payloadLength));
      var version = reader.readByte();
      if (version !== 1) throw new Error('Unsupported save version');
      var data = {
        fingerprint: reader.readUint32(),
        sceneId: reader.readString(),
        ended: false,
        endedChoiceId: '',
        changes: [],
        pathIndexes: []
      };
      var flags = reader.readByte();
      data.ended = !!(flags & 1);
      if (flags & 2) data.endedChoiceId = reader.readString();
      var changeCount = reader.readVarint();
      if (changeCount > 10000) throw new Error('Invalid save data');
      for (var i = 0; i < changeCount; i++) {
        var name = reader.readString();
        var type = reader.readByte();
        var value = null;
        if (type === 1) value = Number(reader.readString());
        else if (type === 2) value = reader.readString();
        else if (type === 3) value = reader.readByte() !== 0;
        else if (type !== 0) throw new Error('Invalid save data');
        data.changes.push({ name: name, value: value });
      }
      var pathCount = reader.readVarint();
      if (pathCount > 10000) throw new Error('Invalid save data');
      for (var p = 0; p < pathCount; p++) data.pathIndexes.push(reader.readVarint());
      if (reader.remaining() !== 0) throw new Error('Invalid save data');
      return data;
    }

    function applySaveKey(raw, onMessage) {
      function message(text) {
        if (typeof onMessage === 'function') onMessage(text);
      }

      var data;
      try {
        data = decodeSaveKey(raw);
      } catch (error) {
        if (error && error.message === 'Unsupported save version') {
          message('This save key uses an unsupported format.');
        } else {
          message('That save key is incomplete or mistyped.');
        }
        return false;
      }

      var targetScene = findScene(data.sceneId);
      var initial = initialValues();
      var missingVariables = data.changes.filter(function (change) {
        return !hasOwnKey(initial, change.name);
      });
      var warnings = [];
      if (data.fingerprint !== currentFingerprint) {
        warnings.push('Version mismatch, accuracy not guaranteed!');
      }
      if (!targetScene) {
        warnings.push('The saved scene is missing from this version. The story will resume at its beginning.');
      }
      if (missingVariables.length) {
        warnings.push('Some saved stats or items no longer exist and will be skipped.');
      }
      if (warnings.length) {
        var proceed = window.confirm(warnings.join('\n\n') + '\n\nLoad this save anyway?');
        if (!proceed) {
          message('Load cancelled.');
          return false;
        }
      }

      if (!targetScene) {
        targetScene = findScene(STORY.startId) || firstScene();
        if (!targetScene) {
          message('This story has no scenes to load into.');
          return false;
        }
      }

      var loadedState = initialValues();
      data.changes.forEach(function (change) {
        if (hasOwnKey(loadedState, change.name)) loadedState[change.name] = change.value;
      });

      state = loadedState;
      baseline = initialValues();
      sceneEntryState = copyState(loadedState);
      currentId = targetScene.id;
      started = true;
      ended = false;
      endedChoiceId = '';
      ENGINE.applyEffects(targetScene.enterEffects || '', state);
      renderedBody = safeRender(targetScene.body || '', state);
      renderedSceneId = targetScene.id;

      if (data.ended) {
        ended = true;
        if (data.endedChoiceId) {
          var choices = Array.isArray(targetScene.choices) ? targetScene.choices : [];
          for (var i = 0; i < choices.length; i++) {
            if (choices[i].id === data.endedChoiceId) {
              ENGINE.applyEffects(choices[i].effects || '', state);
              endedChoiceId = choices[i].id;
              break;
            }
          }
        }
      }

      var restoredPath = [];
      if (data.fingerprint === currentFingerprint && targetScene.id === data.sceneId) {
        data.pathIndexes.forEach(function (index) {
          var pathScene = sceneOrder[index];
          if (pathScene) restoredPath.push(pathScene.id);
        });
      }
      if (!restoredPath.length) restoredPath.push(targetScene.id);
      if (restoredPath[restoredPath.length - 1] !== targetScene.id) restoredPath.push(targetScene.id);
      path = restoredPath;

      focusMain = true;
      render();
      return true;
    }

    function startStory() {
      state = initialValues();
      baseline = Object.assign({}, state);
      started = true;
      currentId = null;
      ended = false;
      endedChoiceId = '';
      sceneEntryState = null;
      path = [];
      var start = findScene(STORY.startId) || firstScene();
      if (start) enterScene(start.id);
      else {
        ended = true;
        focusMain = true;
        render();
      }
    }

    function enterScene(id) {
      var scene = findScene(id);
      if (!scene) {
        currentId = null;
        sceneEntryState = null;
        endedChoiceId = '';
        ended = true;
        focusMain = true;
        render();
        return;
      }
      sceneEntryState = copyState(state);
      endedChoiceId = '';
      currentId = id;
      ended = false;
      ENGINE.applyEffects(scene.enterEffects || '', state);
      renderedBody = safeRender(scene.body || '', state);
      renderedSceneId = id;
      path.push(id);
      focusMain = true;
      render();
    }

    function choose(choice) {
      if (!choice) return;
      if (!ENGINE.evalCondition(choice.condition || '', state)) return;
      ENGINE.applyEffects(choice.effects || '', state);
      if (choice.targetId && findScene(choice.targetId)) enterScene(choice.targetId);
      else {
        ended = true;
        endedChoiceId = choice.id || '';
        focusMain = true;
        render();
      }
    }

    function continueStory() {
      var scene = findScene(currentId);
      if (!scene) return;
      if (scene.nextId && findScene(scene.nextId)) enterScene(scene.nextId);
      else {
        ended = true;
        endedChoiceId = '';
        focusMain = true;
        render();
      }
    }

    function restart() {
      openRestartConfirm();
    }

    function toggleState() {
      showState = !showState;
      render();
    }

    function saveDialogHTML(mode) {
      var isSave = mode === 'save';
      var location = isSave ? locateScene(currentId) : null;
      var position = location
        ? '<p class="save-position">' + esc(location.act.title || 'Act')
          + ' · ' + esc(location.chapter.title || 'Chapter')
          + ' · ' + esc(location.scene.title || 'Untitled scene') + '</p>'
        : '';
      var body = isSave
        ? '<p class="save-note">Keep this key or download it as a file. It restores this scene, your stats, inventory, and ending state.</p>'
          + position
          + '<textarea class="save-key" id="saveKeyText" readonly spellcheck="false" aria-label="Save key"></textarea>'
          + '<p class="save-message" id="saveMessage" role="status"></p>'
          + '<div class="save-actions">'
          + '<button type="button" class="save-btn primary" data-save-action="copy">Copy key</button>'
          + '<button type="button" class="save-btn" data-save-action="download">Download file</button>'
          + '<button type="button" class="save-btn quiet" data-save-action="close">Close</button>'
          + '</div>'
        : '<p class="save-note">Paste a save key or upload a save file to continue where you left off.</p>'
          + '<textarea class="save-key save-key-input" id="loadKeyText" placeholder="SW-..." spellcheck="false" autocomplete="off" aria-label="Save key"></textarea>'
          + '<div class="save-file-row">'
          + '<label class="save-file-btn"><span>Upload save file</span><input type="file" id="saveFileInput" accept=".txt,.storysave,.key,text/plain"></label>'
          + '</div>'
          + '<p class="save-message" id="saveMessage" role="status"></p>'
          + '<div class="save-actions">'
          + '<button type="button" class="save-btn primary" data-save-action="load-key">Load key</button>'
          + '<button type="button" class="save-btn quiet" data-save-action="close">Close</button>'
          + '</div>';
      return '<div class="save-dialog" role="dialog" aria-modal="true" aria-labelledby="saveDialogTitle">'
        + '<div class="save-dialog-head">'
        + '<div><p class="kicker">Progress</p><h2 id="saveDialogTitle">' + (isSave ? 'Save game' : 'Load game') + '</h2></div>'
        + '<button type="button" class="save-close" data-save-action="close" aria-label="Close">×</button>'
        + '</div>'
        + '<div class="save-dialog-body">' + body + '</div>'
        + '</div>';
    }

    function restartDialogHTML() {
      return '<div class="save-dialog" role="dialog" aria-modal="true" aria-labelledby="restartDialogTitle">'
        + '<div class="save-dialog-head">'
        + '<div><p class="kicker">Before you restart</p><h2 id="restartDialogTitle">Restart the story?</h2></div>'
        + '<button type="button" class="save-close" data-restart-cancel aria-label="Cancel restart">×</button>'
        + '</div>'
        + '<div class="save-dialog-body">'
        + '<p class="save-note">This resets your current progress. Manually saved game keys and files are not deleted.</p>'
        + '<label class="restart-label" for="restartConfirmInput">Type restart to confirm</label>'
        + '<input class="restart-input" id="restartConfirmInput" type="text" autocomplete="off" spellcheck="false" placeholder="restart" aria-describedby="restartConfirmHint">'
        + '<p class="restart-hint" id="restartConfirmHint" data-restart-hint>Type “restart” to unlock the confirm button.</p>'
        + '<div class="save-actions">'
        + '<button type="button" class="save-btn" data-restart-cancel>Cancel</button>'
        + '<button type="button" class="save-btn primary" data-restart-confirm disabled>Restart story</button>'
        + '</div>'
        + '</div>'
        + '</div>';
    }

    function ensureRestartOverlay() {
      if (restartOverlay) return restartOverlay;
      restartOverlay = document.createElement('div');
      restartOverlay.className = 'save-overlay restart-overlay';
      restartOverlay.hidden = true;
      restartOverlay.addEventListener('click', function (event) {
        if (event.target === restartOverlay) closeRestartConfirm(false);
      });
      document.body.appendChild(restartOverlay);
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && restartOverlay && !restartOverlay.hidden) {
          event.preventDefault();
          closeRestartConfirm(false);
        }
      });
      return restartOverlay;
    }

    function closeRestartConfirm(confirmed) {
      if (!restartOverlay || restartOverlay.hidden) return;
      restartOverlay.hidden = true;
      restartOverlay.innerHTML = '';
      document.body.classList.remove('save-open');

      var target = restartReturnFocus;
      restartReturnFocus = null;
      if (!confirmed && target && target.focus && document.contains(target)) {
        try { target.focus(); } catch (error) { /* Ignore focus failures. */ }
      }

      if (confirmed) startStory();
    }

    function openRestartConfirm() {
      if (restartOverlay && !restartOverlay.hidden) return;
      if (saveOverlay && !saveOverlay.hidden) closeSaveDialog();
      ensureRestartOverlay();
      restartReturnFocus = document.activeElement;
      restartOverlay.innerHTML = restartDialogHTML();
      restartOverlay.hidden = false;
      document.body.classList.add('save-open');

      var input = restartOverlay.querySelector('#restartConfirmInput');
      var confirm = restartOverlay.querySelector('[data-restart-confirm]');
      var hint = restartOverlay.querySelector('[data-restart-hint]');

      function update() {
        var ready = String(input.value || '').trim().toLowerCase() === 'restart';
        confirm.disabled = !ready;
        hint.textContent = ready
          ? 'Ready to restart.'
          : 'Type “restart” to unlock the confirm button.';
        hint.classList.toggle('is-ready', ready);
      }

      input.addEventListener('input', update);
      input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && !confirm.disabled) {
          event.preventDefault();
          closeRestartConfirm(true);
        }
      });

      Array.prototype.forEach.call(restartOverlay.querySelectorAll('[data-restart-cancel]'), function (button) {
        button.addEventListener('click', function () {
          closeRestartConfirm(false);
        });
      });

      confirm.addEventListener('click', function () {
        closeRestartConfirm(true);
      });

      update();
      setTimeout(function () {
        input.focus();
      }, 0);
    }

    function ensureSaveOverlay() {
      if (saveOverlay) return saveOverlay;
      saveOverlay = document.createElement('div');
      saveOverlay.className = 'save-overlay';
      saveOverlay.hidden = true;
      saveOverlay.addEventListener('click', function (event) {
        if (event.target === saveOverlay) closeSaveDialog();
      });
      document.body.appendChild(saveOverlay);
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && saveOverlay && !saveOverlay.hidden) closeSaveDialog();
      });
      return saveOverlay;
    }

    function closeSaveDialog() {
      if (!saveOverlay) return;
      saveOverlay.hidden = true;
      saveOverlay.innerHTML = '';
      document.body.classList.remove('save-open');
      var target = saveReturnFocus;
      saveReturnFocus = null;
      if (target && target.focus && document.contains(target)) {
        try { target.focus(); } catch (error) { /* Ignore focus failures. */ }
      }
    }

    function copyTextToClipboard(text, textarea, done) {
      function fallback() {
        var copied = false;
        if (textarea) {
          try {
            textarea.focus();
            textarea.select();
            copied = !!(document.execCommand && document.execCommand('copy'));
          } catch (error) {
            copied = false;
          }
        }
        done(copied);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          navigator.clipboard.writeText(text).then(function () {
            done(true);
          }, fallback);
          return;
        } catch (error) {
          /* Fall through to the selection-based copy. */
        }
      }
      fallback();
    }

    function downloadSaveFile(key) {
      var location = locateScene(currentId);
      var suffix = location ? '-a' + (location.actIndex + 1) + '-c' + (location.chapterIndex + 1) : '';
      var filename = titleSlug().toLowerCase() + suffix + '-save.txt';
      if (typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
        window.prompt('Copy your save key:', key);
        return;
      }
      var blob = new Blob([key + '\n'], { type: 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    function openSaveDialog(mode) {
      ensureSaveOverlay();
      var key = '';
      if (mode === 'save') {
        key = encodeSaveKey();
        if (!key) {
          window.alert('There is no current scene to save.');
          return;
        }
      }
      if (saveOverlay.hidden) saveReturnFocus = document.activeElement;
      saveOverlay.innerHTML = saveDialogHTML(mode);
      saveOverlay.hidden = false;
      document.body.classList.add('save-open');

      var keyText = saveOverlay.querySelector('#saveKeyText');
      var loadText = saveOverlay.querySelector('#loadKeyText');
      var message = saveOverlay.querySelector('#saveMessage');
      function setMessage(text) {
        if (message) message.textContent = text || '';
      }

      if (keyText) {
        keyText.value = key;
        keyText.addEventListener('focus', function () { this.select(); });
      }

      var actionButtons = saveOverlay.querySelectorAll('[data-save-action]');
      Array.prototype.forEach.call(actionButtons, function (button) {
        button.addEventListener('click', function () {
          var action = button.getAttribute('data-save-action');
          if (action === 'close') {
            closeSaveDialog();
            return;
          }
          if (action === 'copy') {
            copyTextToClipboard(key, keyText, function (copied) {
              setMessage(copied ? 'Save key copied.' : 'Select the key and press Ctrl/Cmd+C to copy.');
            });
            return;
          }
          if (action === 'download') {
            downloadSaveFile(key);
            setMessage('Save file downloaded.');
            return;
          }
          if (action === 'load-key') {
            var raw = loadText ? loadText.value : '';
            if (!raw.trim()) {
              setMessage('Paste a save key or upload a save file first.');
              return;
            }
            if (applySaveKey(raw, setMessage)) closeSaveDialog();
          }
        });
      });

      var fileInput = saveOverlay.querySelector('#saveFileInput');
      if (fileInput) {
        fileInput.addEventListener('change', function () {
          var file = fileInput.files && fileInput.files[0];
          if (!file) return;
          if (file.size > 2 * 1024 * 1024) {
            setMessage('That file is too large to be a save key.');
            fileInput.value = '';
            return;
          }
          var reader = new FileReader();
          reader.onload = function () {
            if (saveOverlay.hidden) return;
            var text = String(reader.result || '');
            if (loadText) loadText.value = text.trim();
            if (applySaveKey(text, setMessage)) closeSaveDialog();
            fileInput.value = '';
          };
          reader.onerror = function () {
            setMessage('That file could not be read.');
            fileInput.value = '';
          };
          reader.readAsText(file);
        });
      }

      if (keyText) {
        keyText.focus();
        keyText.select();
      } else if (loadText) {
        loadText.focus();
      }
    }

    function coverHTML() {
      var subtitle = copyValue('coverSubtitle', 'Every choice leaves a mark. Some doors only open once.');
      return '<div class="cover-shell">'
        + '<main class="cover">'
        + '<span class="cover-mark" aria-hidden="true">✦</span>'
        + '<p class="kicker">An interactive story</p>'
        + '<h1 class="cover-title">' + esc(STORY.title || 'Untitled Story') + '</h1>'
        + '<div class="cover-rule" aria-hidden="true"></div>'
        + (subtitle ? '<p class="cover-sub">' + copyHTML(subtitle) + '</p>' : '')
        + '<button type="button" class="begin-btn" data-begin="1"><span>Begin the story</span><span aria-hidden="true">→</span></button>'
        + '<button type="button" class="cover-load" data-load-save="1">Load a saved game</button>'
        + '<p class="cover-hint">Save your progress at any time with a key or file.</p>'
        + '</main>'
        + '</div>';
    }

    function flowHTML(scene, available) {
      if (ended) return endHTML();
      if (scene.mode === 'end') return endHTML();

      if (scene.mode === 'choices') {
        if (!available.length) return endHTML();
        return '<div class="choice-list">'
          + available.map(function (choice, index) {
            var label = safeRender(choice.label || 'Continue', Object.assign({}, state));
            return '<button type="button" class="choice" data-choice="' + esc(choice.id) + '">'
              + '<span class="choice-number">' + (index + 1) + '</span>'
              + '<span class="choice-label">' + label + '</span>'
              + '<span class="choice-arrow" aria-hidden="true">→</span>'
              + '</button>';
          }).join('')
          + '</div>';
      }

      var destination = findScene(scene.nextId);
      if (!destination) return endHTML();
      return '<div class="continue-wrap">'
        + '<button type="button" class="continue-btn" data-continue="1">'
        + '<span>' + esc(scene.nextLabel || 'Continue') + '</span>'
        + '<span class="choice-arrow" aria-hidden="true">→</span>'
        + '</button>'
        + '<p class="target-note">Next: ' + esc(destination.title || 'Untitled scene') + '</p>'
        + '</div>';
    }

    function endHTML() {
      var title = copyRequired('endingTitle', 'The End');
      var message = copyValue('endingMessage', 'You can begin again and see where a different choice leads.');
      var button = copyRequired('endingButton', 'Read again');
      return '<div class="end-card">'
        + '<span class="end-mark" aria-hidden="true">✦</span>'
        + '<h2>' + esc(title) + '</h2>'
        + (message ? '<p>' + copyHTML(message) + '</p>' : '')
        + '<button type="button" class="read-again" data-restart="1">' + esc(button) + '</button>'
        + '</div>';
    }

    function statePanelHTML() {
      var definitions = {};
      var assigned = {};
      var groups = [];

      function makeEntry(name, variable) {
        return {
          name: name,
          label: variable ? displayName(variable) : humanizeName(name),
          current: state[name],
          initial: baseline[name]
        };
      }

      if (categories.length) {
        categories.forEach(function (category) {
          var entries = [];
          (Array.isArray(category.variables) ? category.variables : []).forEach(function (variable) {
            if (!variable.name) return;
            definitions[variable.name] = variable;
            assigned[variable.name] = true;
            entries.push(makeEntry(variable.name, variable));
          });
          if (entries.length) {
            groups.push({
              title: category.title || (category.kind === 'inventory' ? 'Inventory' : 'Stats'),
              kind: category.kind,
              entries: entries
            });
          }
        });
      } else {
        var statEntries = [];
        var itemEntries = [];
        stats.forEach(function (stat) {
          if (!stat.name) return;
          definitions[stat.name] = stat;
          assigned[stat.name] = true;
          statEntries.push(makeEntry(stat.name, stat));
        });
        items.forEach(function (item) {
          if (!item.name) return;
          definitions[item.name] = item;
          assigned[item.name] = true;
          itemEntries.push(makeEntry(item.name, item));
        });
        if (statEntries.length) groups.push({ title: 'Stats', kind: 'sheet', entries: statEntries });
        if (itemEntries.length) groups.push({ title: 'Inventory', kind: 'inventory', entries: itemEntries });
      }

      var extraEntries = Object.keys(state).filter(function (name) {
        return !assigned[name];
      }).map(function (name) {
        return makeEntry(name, definitions[name]);
      });
      if (extraEntries.length) {
        groups.push({ title: 'Other', kind: 'sheet', entries: extraEntries });
      }

      function valueRow(entry) {
        var changed = !Object.prototype.hasOwnProperty.call(baseline, entry.name)
          || String(entry.current) !== String(entry.initial);
        return '<div class="state-row' + (changed ? ' is-changed' : '') + '">'
          + '<span class="state-name">' + esc(entry.label) + '</span>'
          + '<span class="state-value">' + esc(ENGINE.formatValue(entry.current)) + '</span>'
          + (changed && Object.prototype.hasOwnProperty.call(baseline, entry.name)
            ? '<span class="state-was">was ' + esc(ENGINE.formatValue(entry.initial)) + '</span>'
            : '')
          + '</div>';
      }

      function itemRow(entry) {
        return '<div class="state-row is-item">'
          + '<span class="state-name">' + esc(entry.label) + '</span>'
          + '<span class="state-value">×' + esc(ENGINE.formatValue(Number(entry.current))) + '</span>'
          + '</div>';
      }

      var stateHTML = '';
      groups.forEach(function (group) {
        var isInventory = group.kind === 'inventory';
        var entries = isInventory ? group.entries.filter(function (entry) {
          return Number(entry.current) > 0;
        }) : group.entries;
        stateHTML += '<p class="state-section-label">' + esc(group.title) + '</p>';
        if (isInventory) {
          stateHTML += entries.length
            ? entries.map(itemRow).join('')
            : '<p class="state-empty-line">Nothing carried yet.</p>';
        } else {
          stateHTML += entries.map(valueRow).join('');
        }
      });

      if (!groups.length) {
        stateHTML = '<p class="state-empty">No stats or items yet.</p>';
      }

      return '<aside class="state-panel" aria-label="' + esc(panelTitle()) + '">'
        + '<div class="state-panel-head"><div><h2>' + esc(panelTitle()) + '</h2></div><button type="button" class="close-state" data-state-toggle="1" aria-label="Hide ' + esc(panelTitle()) + '">×</button></div>'
        + '<div class="state-list">' + stateHTML + '</div>'
        + '</aside>';
    }

    function render() {
      if (!started) {
        root.innerHTML = coverHTML();
        var beginButton = root.querySelector('[data-begin]');
        if (beginButton) beginButton.addEventListener('click', startStory);
        var coverLoadButton = root.querySelector('[data-load-save]');
        if (coverLoadButton) coverLoadButton.addEventListener('click', function () { openSaveDialog('load'); });
        return;
      }

      var scene = findScene(currentId);
      var location = locateScene(currentId);
      if (!scene) {
        root.innerHTML = '<div class="error-screen"><h1>The scene is missing.</h1><p>This story could not continue.</p><button type="button" class="read-again" data-restart="1">Start again</button></div>';
        bindRestart();
        return;
      }

      var available = [];
      if (scene.mode === 'choices') {
        scene.choices.forEach(function (choice) {
          if (ENGINE.evalCondition(choice.condition, state)) available.push(choice);
        });
      }

      var body = renderedSceneId === currentId
        ? renderedBody
        : safeRender(scene.body || '', state);
      var flow = flowHTML(scene, available);
      var kicker = location
        ? (location.act.title || 'Act') + ' · ' + (location.chapter.title || 'Chapter')
        : 'Story';

      root.innerHTML = '<div class="story-shell">'
        + '<header class="site-bar">'
        + '<span class="site-brand">' + esc(STORY.title || 'Untitled Story') + '</span>'
        + '<div class="site-actions">'
        + '<button type="button" class="ghost-btn" data-state-toggle="1">' + (showState ? 'Hide ' + esc(panelTitle()) : esc(panelTitle())) + '</button>'
        + '<button type="button" class="ghost-btn" data-save-open="1">Save</button>'
        + '<button type="button" class="ghost-btn" data-load-open="1">Load</button>'
        + '<button type="button" class="ghost-btn" data-restart="1">Restart</button>'
        + '</div>'
        + '</header>'
        + '<div class="story-page' + (showState ? ' has-state' : '') + '">'
        + '<article class="chapter">'
        + '<p class="chapter-kicker">' + esc(kicker) + '</p>'
        + '<h1 class="chapter-title" tabindex="-1">' + esc(scene.title || 'Untitled scene') + '</h1>'
        + '<div class="story-text">' + body + '</div>'
        + flow
        + '</article>'
        + (showState ? statePanelHTML() : '')
        + '</div>'
        + '</div>';

      var choiceButtons = root.querySelectorAll('[data-choice]');
      Array.prototype.forEach.call(choiceButtons, function (button) {
        button.addEventListener('click', function () {
          var sceneNow = findScene(currentId);
          if (!sceneNow) return;
          var id = button.getAttribute('data-choice');
          for (var i = 0; i < sceneNow.choices.length; i++) {
            if (sceneNow.choices[i].id === id) {
              choose(sceneNow.choices[i]);
              return;
            }
          }
        });
      });

      var continueButton = root.querySelector('[data-continue]');
      if (continueButton) continueButton.addEventListener('click', continueStory);

      bindRestart();
      var stateButtons = root.querySelectorAll('[data-state-toggle]');
      Array.prototype.forEach.call(stateButtons, function (button) {
        button.addEventListener('click', toggleState);
      });

      var saveButton = root.querySelector('[data-save-open]');
      if (saveButton) saveButton.addEventListener('click', function () { openSaveDialog('save'); });
      var loadButton = root.querySelector('[data-load-open]');
      if (loadButton) loadButton.addEventListener('click', function () { openSaveDialog('load'); });

      if (focusMain) {
        var heading = root.querySelector('.chapter-title');
        if (heading) {
          try { heading.focus({ preventScroll: true }); }
          catch (error) { heading.focus(); }
        }
        window.scrollTo(0, 0);
        focusMain = false;
      }
    }

    function bindRestart() {
      var restartButtons = root.querySelectorAll('[data-restart]');
      Array.prototype.forEach.call(restartButtons, function (button) {
        button.addEventListener('click', restart);
      });
    }

    buildSceneOrder();
    currentFingerprint = storyFingerprint();
    document.title = (STORY.title || 'Untitled Story') + ' · Interactive Story';
    render();
  }

  function exportStoryHTML() {
    var start = sceneById(story.startId) || firstScene();
    if (!start) {
      showToast('Add a scene before exporting.', 'error');
      return;
    }
    var html = buildExportHTML();
    downloadFile(slugify(story.title) + '.html', html, 'text/html');
    showToast('Playable HTML exported.', 'success');
  }

  function buildExportHTML() {
    var exportStory = {
      version: 3,
      title: story.title || 'Untitled Story',
      startId: sceneById(story.startId) ? story.startId : firstScene().id,
      statePanel: {
        title: statePanelTitle()
      },
      copy: clone(normalizeStoryCopy(story.copy)),
      theme: clone(normalizeTheme(story.theme)),
      images: clone(story.images || {}),
      categories: clone(story.categories || []),
      acts: clone(story.acts)
    };

    var storyJSON = JSON.stringify(exportStory)
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');

    var title = esc(exportStory.title);

    return [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<meta name="color-scheme" content="light">',
      '<meta name="description" content="' + title + ' — an interactive story.">',
      '<title>' + title + '</title>',
      '<style>',
      PLAYER_CSS,
      themeCSS(story.theme),
      '</style>',
      '</head>',
      '<body>',
      '<div id="story-root"></div>',
      '<noscript><div class="error-screen"><h1>JavaScript is required.</h1><p>Enable JavaScript to read this interactive story.</p></div></noscript>',
      '<script>',
      '(function () {',
      'var STORY = ' + storyJSON + ';',
      'var ENGINE = (function () {',
      ENGINE.source,
      'return {',
      'escapeHTML: escapeHTML,',
      'formatValue: formatValue,',
      'renderMarkup: renderMarkup,',
      'evalCondition: evalCondition,',
      'applyEffects: applyEffects,',
      'createVariables: createVariables',
      '};',
      '})();',
      '(' + playerMain.toString() + ')(ENGINE, STORY);',
      '})();',
      '</script>',
      '</body>',
      '</html>'
    ].join('\n');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
