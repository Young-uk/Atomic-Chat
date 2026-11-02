const SCREEN_TOOL_DESCRIPTORS = [
  {
    name: "os.screen.capture",
    summary: "Screenshot of the primary display (macOS); saves a JPEG in the temp folder and returns its path and the pixel-to-point scale. Look at it with vision.describe, then click with os.screen.click using that image's pixel x,y. May ask the user first.",
    argsSchema: "{ x?: number, y?: number, width?: number, height?: number /* a region in screen points, all four or none; omit for the whole primary display */ }",
    tier: "rare"
  },
  {
    name: "os.screen.click",
    summary: "Click at x,y given in the pixels of the last os.screen.capture image (the scale is remembered). Asks the user first, naming the app under the point; never clicks into a terminal, Atomic Agent, settings or a password manager.",
    argsSchema: '{ x: number, y: number, button?: "left"|"right", double?: boolean, scale?: number /* only to override the remembered capture */ }',
    tier: "rare"
  },
  {
    name: "os.screen.type",
    summary: "Type text into the focused field of the frontmost app, as keystrokes. Asks the user first, showing the whole text; never types into a terminal, Atomic Agent, settings or a password manager.",
    argsSchema: '{ text: string /* at most 2000 chars */, via?: "keys"|"paste" /* paste goes through the clipboard and restores it */ }',
    tier: "rare"
  },
  {
    name: "os.screen.key",
    summary: 'Press a key or shortcut in the frontmost app, e.g. "return", "escape", "down", "cmd+l", "cmd+shift+t". Asks the user first; app and space switchers (cmd+tab, ctrl+arrows, cmd+space) are refused.',
    argsSchema: "{ keys: string }",
    tier: "rare"
  }
];
export {
  SCREEN_TOOL_DESCRIPTORS
};
