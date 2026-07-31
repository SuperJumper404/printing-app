# Shared Printing Code

This package is the future home for code shared by desktop and Android targets:

- ticket payload validation
- ESC/POS formatting helpers
- SmartEat print job types
- platform-neutral printer configuration helpers

Keep this package free of Electron, Node-only printing APIs, and Android-native
APIs so both apps can consume it safely.
