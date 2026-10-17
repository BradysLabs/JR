# Packet Inspector

A live view of every packet going to and from Animal Jam, with plain-English explanations, category filters, packet comparison and a built-in packet guide.

## Live view

Click **Packet Inspector** in the plugins sidebar and play the game.

- **↓ green** = incoming (server to you), **↑ amber** = outgoing (you to server)
- The colored bar on each row is its category.
- Click a packet to see what it does, every field's meaning, item names and values, and your current room.
- Glow and emote packets are decoded (with a color swatch for glow). JSON packets are pretty-printed.
- Click any field value to copy it.
- Drag the bar above the detail panel to resize it.

## Compare

Select a packet, then **Ctrl+click** another one. Both are shown side by side and the fields that differ are highlighted red. This is the fastest way to figure out what a field means. **Esc** stops comparing.

## Filters

- **Category chips**: click to show or hide, double-click to show only that category.
- **★ Pinned**: show only pinned packets.
- **Muted types**: right-click a packet and choose **Mute** to hide noisy types like `ka`. Click the muted chip to bring it back.
- **All / In / Out**: filter by direction.
- **Reset filters** clears everything.

Search supports:

| Search | Matches |
|---|---|
| `spiked` | packets containing "spiked" (type, name, item name or raw) |
| `type:ib,db` | only these packet types |
| `-ka` or `-type:ka,au` | exclude a word or types |
| `room:8729701` | packets for this room id |
| `/%8\]/` | a regular expression on the raw packet |

Combine them, e.g. `type:pubMsg -emote`.

## Right-click menu

Pin, copy, compare with selected, show only this type, mute this type, hide its category, add or edit notes.

## Export

- Copy visible or pinned packets as text (`↑ raw (name)`, ready to paste in Discord)
- Save visible packets as `.txt` or `.json`
- Export your notes

**Clear** keeps pinned packets.

## Keyboard

| Key | Action |
|---|---|
| `↑` `↓` | Move selection |
| `Space` | Pause / resume |
| `P` | Pin selected |
| `C` | Copy selected |
| `Ctrl+F` | Search |
| `Esc` | Stop comparing / deselect |

## Guide

Switch to **Guide** for a reference of every documented packet, grouped by category, with fields, an example from this session and how many times it was seen. The top shows how many packets are documented, confirmed, seen, and seen but undocumented. **Show in Live** jumps to that packet type.

Confidence labels:

- **confirmed**: tested in JR
- **known**: documented by the community, not re-tested
- **guess**: needs more captures

## Notes

Click **Add notes** or **Edit notes** on any packet to write its name, category, confidence, description and field labels (one per line, `?` for unknown). Notes are saved to `notes.json` in this folder and override the built-in descriptions. Commit `notes.json` to share them.

Built-in descriptions live in `packets.js`.
