# Islet (desktop)

A notch at the top of your screen. Hover it to open it. The pin button turns Always on top on or off (remembered between runs; the tray menu has the same switch). Hide it with the eye button; Ctrl + Alt + N or the tray icon brings it back. Quit from the tray icon (right-click, Quit Islet).

## Run it on Windows
1. Install Node.js (LTS) from https://nodejs.org
2. Open a terminal in this folder and run: npm install
3. Run: npm start   (the first start downloads Electron)

## Closed notch
Time on the left, battery on the right. A small wave shows while media plays. Orange, green and blue dots fade in when another app uses the microphone, camera or location.

## Tabs
- **Media**: the banner on the left shows the cover or video thumbnail with the playing app's icon in its corner (if an app gives no cover, the app's own icon is shown large instead). If the cover never appears, details are written to %TEMP%\islet-media.log. On the right: title, a progress bar (click or drag it to jump to a point), and play/pause, previous and next centred underneath. Play/pause reacts at once. If an app refuses a normal request, the matching media key is pressed instead. If two things play, the one actually playing wins.
- **Clipboard**: recent copies. Click one to copy it again. Each item has a pin (keeps it at the top, and it is remembered after a restart) and a delete button. Clear all removes everything except pinned items, like the Windows clipboard history. Only pinned items are ever saved to disk.
- **Widgets**: time and date, battery, PC uptime.
- **Files**: drop files onto the closed notch or into the tab, or use Add files. Drag a file from the shelf onto the desktop, a folder or another app; Windows receives a copy of the real file. Click a name to open it.
- **Controls**: volume, brightness (laptop screens), Wi-Fi, Bluetooth, Dark Style, Night Light, Airplane and Microphone. The arrow on Wi-Fi opens a network list inside the tab (connect, disconnect, enter a password); the arrow on Bluetooth lists paired devices and whether they are connected. Nothing opens the Windows Settings app. Night Light is Islet's own warm screen tint; it turns off when you quit.
- **Apps**: the + tile opens a list of installed apps (from your Start Menu). Click one to add it; search by name; Browse... picks any .exe or shortcut on the PC. Click a tile to launch it; hover a tile and click x to remove it.

## Notifications and reminders
- **Charger connected**: a small pill drops out of the notch for a few seconds (charger icon and battery percentage), then the notch goes back to what it was doing.
- **Battery full**: when the battery reaches 100% while charging, the same pill says "Fully charged".
- **Calendar & reminders**: open the Calendar tab. Pick a day in the month (a dot marks days that have reminders), see that day's reminders, then click the name field and type a message, set the time with the − / + buttons (hold to repeat, or use the mouse wheel; click hour, minutes or AM/PM to choose what changes) or the +5m / +15m / +1h buttons, and press Add reminder. Past days and past times cannot be chosen. When one is due the notch drops down a reminder pop-up with Done and Snooze 5m buttons. Reminders are saved and survive a restart; a reminder is only removed once the pop-up has actually shown it, and several that are due together show one after another ("1 more").
- When a reminder is due the notch grows into a full notification screen with the message and its scheduled time. It stays long enough to read (longer for longer messages; hovering it pauses the countdown). **Dismiss** closes it, **Snooze 5 min** brings it back later. If the notch was hidden it comes back for the reminder and hides again afterwards.
- Several notifications wait in line, so they never overlap. A battery pill waits while the notch is open.
- To see them without waiting: tray icon, right-click, Test notifications.

## Size
The whole notch is drawn a little smaller than the original design (Medium). Tray icon, right-click, Size lets you pick Small, Medium or Normal.

## Notes
- The window is only as big as the notch while it is closed (so files can be dropped on it) and grows while open.
- While the pin is on it stays above other windows, including full-screen windows (not exclusive full-screen games). With the pin off it behaves like a normal window. It uses your main display.
- Store (UWP) apps that have no Start Menu shortcut do not appear in the app list yet; add them with Browse if they have an .exe.
- The search box in the Apps picker lets the notch take keyboard focus while it is open.
- Helpers: system.ps1 (volume, brightness, radios, theme, Night Light), media.ps1 (now playing), net.ps1 (Wi-Fi and Bluetooth lists). A helper that stops by accident is started again. If something is not available on your PC the notch says so instead of crashing.


## Media

The Media tab follows whatever is playing:

- Apps that use the Windows media controls (Spotify, Edge, Chrome, Brave, Firefox, the Media Player app, YouTube and other sites in a browser) show the title, cover, progress and full controls.
- Players that do not report to Windows (VLC, PotPlayer, classic Windows Media Player, MPC-HC/BE, mpv, KMPlayer, GOM) are found by their window title; play/pause comes from Windows' audio meter for that program. They have play/pause and next/previous, but no progress bar.
- When two or more sources are open, the switch button in the Media panel lets you choose one; the chosen one plays and the others are paused.
- Something not showing up? Look at `%TEMP%\islet-media.log`: it lists every source the helper sees and which one is shown.

## Battery pop-ups

A small pill drops from the notch for: charger connected (with time to full when Windows knows it), fully charged, charger removed (with time left), and battery warnings at 20% (low), 10% (very low) and 5% (critical). Each warning appears once per discharge and is skipped if you plug in meanwhile. The pill has a level bar, and its colour follows the state (green, grey-blue, amber, orange, red). On the closed notch the small battery turns amber at 20% and red and blinking at 10%. Preview them all from the tray icon: Test notifications.

## Widgets and colours

The Widgets tab shows eight live PC widgets: time (with a minute bar), CPU, memory, storage (system drive), battery, network speed (with a graph), uptime and today's date (click it to open the Calendar). CPU, memory, network and storage are only measured while that tab is on screen, and a ring turns red when its load is high (CPU 85%, memory 88%, storage 92%).

Tabs keep their own accent colours: Widgets cyan and Calendar purple; the Media panel follows the album art and Controls is black and white (see below). Reminders and the Calendar are purple; every battery pop-up has its own colour pair (charging teal, full green, on battery blue, low amber, very low orange, critical red).

## Album-art colours and the black-and-white Controls

While something with a cover picture plays, the Media panel takes its main colour from the picture: the play button, progress bar, switch dots, glow behind the panel and the small wave on the closed notch all follow it and glide to the new colour when the track changes. Black-and-white covers give a soft white; no cover gives the default pink.

The Controls panel is black, white and grey (white tiles with black text when on, white slider fills), and the Always-on-top button is white with a black icon when it is on, on every panel.
