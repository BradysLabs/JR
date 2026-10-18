# Asset Browser

Browse every clothing and den item in Animal Jam Classic, look inside the game's data files, and get the real address of any file on the game's content server.

## Clothing / Den Items

- Every item with its id, name, listed value and whether it's members-only.
- **Search** by name (`spiked`), by id (`1037`), or by value range (`200-500`).
- Filter by **Members / Free**, **Gems / Diamonds**, min and max value, and **Named only**.
- Click a column header to sort. `↑` `↓` move through the list, `Ctrl+F` jumps to search.
- Click an item to see:
  - its id and listed value, with copy buttons;
  - the address of the data file it comes from;
  - its **raw game data**, every field the game stores for it. Fields ending in `StrId` show the text they point to. Click any value to copy it.

## Defpacks

Defpacks are the game's data files (item lists, names, prices, settings). Enter any pack id to see its address, download it, see how many entries and which fields it has, filter it, and save it as `.json`. Item names are added as `_name` where the pack links to the text strings pack.

Known packs: `1000` clothing, `1003` animals, `1011` rooms, `1025` quest/adventure NPCs, `1027` item lists, `1029` image arrays, `1030` den items, `1036` emotes, `1038` generic lists, `1040` den rooms, `1042` achievements, `1046` pets, `1047` parties, `1049` name bar badges, `1050` battle cards, `1051` currency exchange, `1052` adventure scripts, `1053` movies/cutscenes, `1054` diamond shop, `1057` and `1058` (not yet identified), `1061` Adopt-a-Pet, `1062` and `1063` (not yet identified), `1064` world items, `1065` newspaper, and `10230` text strings. Use **Check known packs** to check this catalog against the current deploy and see which ones are available. To discover other packs, use **Discover defpacks** to scan a numeric ID range. Each scan is limited to 300 IDs and checks four IDs at a time; successful downloads are decoded before they are listed. Select **Open** on a result to inspect and save it.

## Address Builder

Shows how a file address is made, step by step:

1. The secret key and the file name are joined.
2. The result is scrambled.
3. The scrambled text is MD5-hashed. That hash is the file name on the server.

| Data | Address |
|---|---|
| Item data | `/{version}/defPacks/{hash(pack id)}` |
| Room data | `/{version}/roomDefs/{map}/{hash(file.xroom)}` |

The game version (`deploy_version`) comes from `animaljam.com/flashvars` and is filled in automatically.

## Staying up to date

The item lists are downloaded for the current game version and saved in JR's `cache/` folder. JR checks for a new game version every 30 minutes. Click **Check for update** to check right away. The version in use is shown in the top-right.

Addresses and hashing follow Animal Jam’s own asset scheme.
