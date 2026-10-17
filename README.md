# JR

JR is a plugin toolkit for Animal Jam Classic, made by **BradysLabs**. It replaces Jam Reborn.

Version 0.0.0 is in progress.

## What's here so far

| Folder | What it is |
|---|---|
| `src/engine` | The game proxy. It reads and writes Animal Jam's messages (xt, JSON and XML), passes them through plugins, and limits how fast plugins send packets. |
| `src/plugins` | Finds plugins, asks the user before running new ones, and keeps each plugin's saved data inside the profile. |
| `src/profiles` | Profiles. Each profile is its own JR window with its own folder, so settings and plugin data never overlap. |
| `plugins` | Plugins that ship with JR (Membership, Packet Spammer). |
| `test` | Tests, including a fake Animal Jam server. Run them with `npm test`. |

## Profiles

Each profile has its own folder:

```
profiles.json                 the list of profiles
profiles/<id>/settings.json
profiles/<id>/plugins.json    plugins this profile approved
profiles/<id>/plugin-data/    each plugin's saved data
profiles/<id>/session/        the profile's browser data
```

A profile can only be open in one JR window at a time.

## Plugins

See [docs/plugins.md](docs/plugins.md). Plugins written for Jam Reborn keep working.

## License

Copyright (c) 2026 BradysLabs. All rights reserved. See [LICENSE](LICENSE).

JR is not affiliated with WildWorks. Animal Jam is a trademark of WildWorks, Inc.
