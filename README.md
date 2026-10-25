# JR

JR is a plugin toolkit for Animal Jam Classic, made by **BradysLabs**. It replaces Jam Reborn.

JR is for members of the [JR Discord](https://discord.gg/ENu6SpVrwn). You sign in with Discord the first time you open it.

## Install

Download `JR-Setup-<version>.exe` from [Releases](https://github.com/BradysLabs/JR/releases) and run it. JR updates itself when a new version comes out.

## What JR does

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

## Before you use it

JR is unofficial and not affiliated with WildWorks. Using it may go against Animal Jam's Terms of Service and can result in a suspension or ban. Use JR at your own risk. BradysLabs and the JR team are not responsible for account suspensions, bans or lost items that result from using JR.

JR never stores your Animal Jam password.

## For developers

```
npm install
npm start        run JR
npm test         run the tests
npm run build    build the Windows installer into dist/
```

Discord Rich Presence uses the `discord-presence` art asset. Upload `assets/discord-presence.png` in the Discord Developer Portal under **Rich Presence → Art Assets** with the asset key `discord-presence` (the filename without its extension). The app icon on **General Information** is separate from Rich Presence art.

## License

JR is open source under the [MIT License](LICENSE). Copyright (c) 2026 BradysLabs.

Animal Jam is a trademark of WildWorks, Inc. Item values come from the Animal Jam Item Worth Wiki (aj-item-worth.fandom.com), CC BY-SA.
