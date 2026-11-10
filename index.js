// The Windows service owns printing; Electron is only its configuration and device companion.
require("./lib/desktop/main").startDesktop();
