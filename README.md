# KCM Toolbar Extension

A lightweight Keeper Connection Manager (KCM) / Guacamole extension that adds a fixed top toolbar with:
- Home button (dashboard)
- Menu button (opens the KCM/Guacamole menu shortcut)
- Search field with connection results

The toolbar is hidden on mobile devices and does not overlap the client viewport; it reduces the available height by a fixed 48px.

## Features
- Fast local search over the connection tree
- Navigates to the correct client URL using the Guacamole `ClientIdentifier`
- Blocks keystrokes from being sent to the remote session while the search field is focused
- No sensitive data stored in the extension

