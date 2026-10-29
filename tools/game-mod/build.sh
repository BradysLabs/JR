#!/usr/bin/env bash
# Builds JR's in-game version of Animal Jam's game file (ajclient.swf).
#
#   tools/game-mod/build.sh <game file> <out file> [step]
#
# Needs Java and JPEXS FFDec in tools/ffdec (both stay off git, like the game
# files). Decompiles the classes JR changes, applies tools/game-mod/patch.py
# and compiles them back in. Put the result in game-mods/ as
# ajclient-<version>.swf (and ajclient-<version>-awake.swf built from the
# Anti-kick copy); JR serves it instead of patching the game file itself.
# Each build also records src/game/mod/edits.json: players' JR uses it to
# build the same thing from their own game file (commit it with your change).
#
# step: all (default), or export / import to run the two halves separately
# (each takes about a minute). Work files go in ~/.jr-game-mod.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
ffdec="$here/../ffdec/ffdec-cli.jar"
work="${JR_MOD_WORK:-$HOME/.jr-game-mod}/$(basename "$2")"
step="${3:-all}"
classes=XtReplyDemuxer,gui.MySettings,gui.itemWindows.ItemWindowToggle,gui.itemWindows.ItemWindowBase,avatar.NameBar,avatar.UserInfo,gui.AvatarEditor,shop.Shop,gui.RecycleItems,gui.DenSwitcher,gui.AvatarSwitcher,gui.AdventureJoin,gui.AchievementViewer,gui.PetInventory,gui.MasterpiecePreview,gui.TradeManager,gui.DenEditor,game.miniGame_Memory.MiniGame_Memory,gui.GuiManager,gui.VolumeSelector,game.artStudioPainting.ArtStudioPainting,gui.ColorTable,avatar.AvatarView,com.sbi.graphics.LayerBitmap
if [ "$step" = all ] || [ "$step" = export ]; then
  rm -rf "$work"
  java -Xmx2200m -jar "$ffdec" -onerror ignore -selectclass "$classes" -export script "$work/src" "$1"
fi
if [ "$step" = all ] || [ "$step" = import ]; then
  rm -rf "$work/mod"
  python3 "$here/patch.py" "$work/src/scripts" "$work/mod"
  # What players' JR replays to build the same thing (src/game/mod/build.js).
  python3 "$here/record.py" "$work/src/scripts" "$work/mod" "$here/../../src/game/mod/edits.json"
  java -Xmx2200m -jar "$ffdec" -importScript "$1" "$2.tmp" "$work/mod"
  mv -f "$2.tmp" "$2"
  rm -rf "$work"
  echo "Built $2"
fi
