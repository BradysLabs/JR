# JR

JR is a plugin toolkit for Animal Jam Classic, made by **BradysLabs**. It replaces Jam Reborn.

JR is for members of the [JR Discord](https://discord.gg/ENu6SpVrwn). You sign in with Discord the first time you open it.

## Install

You need [AJ Classic](https://www.animaljam.com) installed first.

**Windows:** download `JR-Setup-<version>.exe` from [Releases](https://github.com/BradysLabs/JR/releases) and run it. JR updates itself when a new version comes out.

**Mac:** download `JR-<version>-mac-arm64.dmg` for Apple Silicon (M1 and newer) or `JR-<version>-mac-x64.dmg` for Intel Macs. Open it and drag JR into Applications. JR isn't signed by Apple, so the first time you open it, right-click JR in Applications and choose **Open**, then **Open** again. If macOS says JR is damaged, run this in Terminal once, then open it again:

```
xattr -cr /Applications/JR.app
```

On Mac, JR tells you when a new version is out, and you download it the same way.

## What JR does

- **Built into the game:** JR's tools appear on Animal Jam's own screens. Worth in your inventory, den and trades, More Sorts, Pick a Color (with True color), Front/Back/Mirror sit poses, Rooms and Auto Adventures tabs on the World Map, Art Studio pictures, Save Outfit, Try On, Glow, Streaming mode and F2 screenshots.
- **Profiles:** each profile opens in its own window with its own settings and login, so you can play two accounts at once.
- **Plugins:** packet tools, adventures (Phantoms, Bitter Sweets, Tiki Trouble), room browser, item previews, glow picker and more. Plugins written for Jam Reborn keep working. See [docs/plugins.md](docs/plugins.md).
- **Trading:** shows what the other player offers, values from the Item Worth Wiki in Diamonds, and a favor scale.
- **My Shop:** save your shop as a template and refill it in one click or automatically, with wiki prices and a log of every sale.
- **Shop Explorer:** see everything for sale in every My Shop in a den, with wiki values, so deals stand out.
- **Recycle Tool:** recycle the items you don't want in one click, or automatically while you farm.
- **Outfits, Bulk Buy, Recent Rooms and Auto Advertise:** save and swap outfits, buy many of one item, jump back to rooms you visited, and advertise your shop on a timer.
- **Themes:** customize the home screen and pick a color theme.
- **Anti-kick:** optional, keeps you from being logged out for being idle.
- **Discord status:** shows JR on your Discord profile, with a link to the JR server.

## In-game features: first launch

JR adds its tools by changing the game's own code. WildWorks' game file can't be shared, so JR makes the change on your computer, from the game file Animal Jam gives you:

- The first time you play, JR downloads [JPEXS FFDec](https://github.com/jindrapetrik/jpexs-decompiler) and a [Java runtime](https://adoptium.net) for it (about 70 MB, once), then builds JR's version of the game in the background. That takes a minute or two.
- When JR says the in-game features are ready, close the game and open it again.
- JR builds again on its own when Animal Jam updates or JR's in-game features change. Until a build is ready, the game works as normal without them.

## Before you use it

JR is unofficial and not affiliated with WildWorks. Using it may go against Animal Jam's Terms of Service and can result in a suspension or ban. Use JR at your own risk. BradysLabs and the JR team are not responsible for account suspensions, bans or lost items that result from using JR.

JR never stores your Animal Jam password.

## For developers

```
npm install
npm start        run JR
npm test         run the tests
npm run build    build the Windows installer into dist/
npm run build:mac  build the Mac app (on a Mac); GitHub builds it for releases
```

JR's changes to the game live in `tools/game-mod` (`patch.py`, `anchors.py`, `as/JRUI.as`). `tools/game-mod/build.sh` builds the game file with them and records `src/game/mod/edits.json`, which players' JR replays to build the same thing. Commit `edits.json` with any change to the game edits.

Discord Rich Presence uses the `discord-presence` art asset. Upload `assets/discord-presence.png` in the Discord Developer Portal under **Rich Presence → Art Assets** with the asset key `discord-presence` (the filename without its extension). The app icon on **General Information** is separate from Rich Presence art.

## License

JR is open source under the [MIT License](LICENSE). Copyright (c) 2026 BradysLabs.

Animal Jam is a trademark of WildWorks, Inc. JR downloads JPEXS FFDec (GNU GPL v3 / LGPL v3) and Eclipse Temurin (GPL v2 with Classpath Exception) from their official releases; they aren't part of JR. Item values come from the Animal Jam Item Worth Wiki (aj-item-worth.fandom.com), CC BY-SA.
