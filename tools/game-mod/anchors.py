# JR's buttons on the game's own screens. Each line below runs right after a
# screen hooks up its close button, so the screen exists and is on show.
# Which buttons appear, and where, comes from JR (src/game/surfaces.js).

def anchor(rel, line, call):
    edit(rel, [(line, line + '\n         ' + call)])

anchor('gui/AvatarEditor.as', 'xBtn.addEventListener("mouseDown",onClose,false,0,true);',
       'XtReplyDemuxer.jrAnchor("avatar",xBtn.parent,xBtn);')
anchor('shop/Shop.as', '_shop.frame.bx.addEventListener("mouseDown",onClose,false,0,true);',
       'XtReplyDemuxer.jrAnchor(this is ShopToSell ? (ShopToSell(this).isDenSaleShopOwner ? "myshop" : "shopview") : "shop",_shop.frame.bx.parent,_shop.frame.bx,{"shopId":_shopId});')
anchor('gui/RecycleItems.as', '_recyclePopup.bx.addEventListener("mouseDown",onClose,false,0,true);',
       'XtReplyDemuxer.jrAnchor("recycle",_recyclePopup.bx.parent,_recyclePopup.bx);')
anchor('gui/DenSwitcher.as', '_closeBtn.addEventListener("mouseDown",onClose,false,0,true);',
       'XtReplyDemuxer.jrAnchor("denswitch",_closeBtn.parent,_closeBtn);')
anchor('gui/AvatarSwitcher.as', '_closeBtn.addEventListener("mouseDown",onClose,false,0,true);',
       'XtReplyDemuxer.jrAnchor("animals",_closeBtn.parent,_closeBtn);')
anchor('gui/AdventureJoin.as', '_popup.bx.addEventListener("mouseDown",onCloseBtn,false,0,true);',
       'XtReplyDemuxer.jrAnchor("adventure",_popup.bx.parent,_popup.bx);')
anchor('gui/AchievementViewer.as', '_achievementPopupContent.bx.addEventListener("mouseDown",onClose,false,0,true);',
       'XtReplyDemuxer.jrAnchor("achievements",_achievementPopupContent.bx.parent,_achievementPopupContent.bx);')
anchor('gui/PetInventory.as', '_inventoryMC.bx.addEventListener("mouseDown",onClose,false,0,true);',
       'XtReplyDemuxer.jrAnchor("pets",_inventoryMC.bx.parent,_inventoryMC.bx);')
anchor('gui/MasterpiecePreview.as', '_closeBtn.addEventListener("mouseDown",onCloseBtn,false,0,true);',
       'XtReplyDemuxer.jrAnchor("masterpiece",_closeBtn.parent,_closeBtn);')
anchor('gui/TradeManager.as', '_requestTradePopup.bx.addEventListener("mouseDown",onClose,false,0,true);',
       'XtReplyDemuxer.jrAnchor("trade",_requestTradePopup.bx.parent,_requestTradePopup.bx,{"user":_requestTradePopupCurrUsernameToTradeTo});')
anchor('gui/DenEditor.as', '_denEditor.closeBtn.addEventListener("mouseDown",onClose,false,0,true);',
       'XtReplyDemuxer.jrAnchor("denedit",_denEditor.closeBtn.parent,_denEditor.closeBtn);')
anchor('game/miniGame_Memory/MiniGame_Memory.as', '_closeBtn = addBtn("CloseButton",850,5,showExitConfirmationDlg);',
       'XtReplyDemuxer.jrAnchor("pairs",this,_closeBtn);')
anchor('gui/GuiManager.as', 'chatHist = new ChatHistory(mainHud.chatHist,mainHud.chatBar,mainHud.chatHistUpDownBtn,mainHud.buddyListBtn,mainHud.chatTxt,mainHud.sendChatBtn,UserCommXtCommManager.onSendMessage,mainHud.predictTxtTag,mainHud.specialCharCont,mainHud.chatRepeatBtn,mainHud.chatRepeatWindow);',
       'XtReplyDemuxer.jrChatBar(mainHud.chatBar,mainHud.chatTxt);')

# The World Map's pull-out window gets JR tabs above the game's Adventures and
# Epic Dens tabs (Rooms on top, then JR's adventures); each opens JR's list
# inside that same window.
MAP_TABS = r"""
      private var _jrTabs:Object = {};

      private var _jrTabOpen:String;

      private static const JR_TABS:Array = [["adventures","Auto Adventures","adventure",1],["rooms","Rooms","rooms",2]];

      private function jrAddMapTabs() : void
      {
         var _loc1_:MovieClip = _worldMapFrame.advWindowTab;
         var _loc2_:Array = null;
         if(!_loc1_.downAdvTab || !_loc1_.downEpicDenTab)
         {
            return;
         }
         for each(_loc2_ in JR_TABS)
         {
            if(_jrTabs[_loc2_[0]] == null)
            {
               _jrTabs[_loc2_[0]] = XtReplyDemuxer.jrMapTab(_loc1_.downAdvTab,_loc1_.downEpicDenTab,_loc2_[0],_loc2_[2],_loc2_[3],onJrMapTab);
            }
         }
      }

      private function onJrMapTab(param1:MouseEvent) : void
      {
         var _loc2_:MovieClip = _worldMapFrame.advWindowTab;
         var _loc3_:String = String(param1.currentTarget.key);
         var _loc4_:Array = null;
         var _loc5_:String = _loc3_;
         for each(_loc4_ in JR_TABS)
         {
            if(_loc4_[0] == _loc3_)
            {
               _loc5_ = _loc4_[1];
            }
         }
         if(_jrTabOpen == _loc3_)
         {
            jrTabLeave(false);
            _loc2_.advTab.visible = false;
            _loc2_.epicDenTab.visible = false;
            _loc2_.gotoAndPlay("close");
            return;
         }
         if(_jrTabOpen != null)
         {
            XtReplyDemuxer.jrUnembed(_jrTabOpen);
         }
         if(_scrollBar)
         {
            _scrollBar.destroy();
            _scrollBar = null;
         }
         _densAndAdventureLoadingSpiral.visible = false;
         while(_loc2_.itemWindow_adv.numChildren > 2)
         {
            _loc2_.itemWindow_adv.removeChildAt(_loc2_.itemWindow_adv.numChildren - 1);
         }
         _loc2_.AJHQ_cont.visible = false;
         _loc2_.itemWindow_adv.visible = true;
         _loc2_.itemWindow_den.visible = false;
         _loc2_.advTab.visible = false;
         _loc2_.epicDenTab.visible = false;
         if(_loc2_.currentFrameLabel == "off")
         {
            _loc2_.gotoAndPlay("open");
         }
         _loc2_.titleBanner.windowTitleTxt.text = _loc5_;
         _jrTabOpen = _loc3_;
         XtReplyDemuxer.jrEmbed(_loc3_,_loc2_.itemWindow_adv,2,2,262,386);
      }

      // Leaving a JR tab for the game's own tabs: they switch over as if
      // coming from the other tab, instead of closing the window.
      private function jrTabLeave(param1:Boolean) : void
      {
         if(_jrTabOpen == null)
         {
            return;
         }
         XtReplyDemuxer.jrUnembed(_jrTabOpen);
         _jrTabOpen = null;
         if(_worldMapFrame)
         {
            _worldMapFrame.advWindowTab.advTab.visible = param1;
            _worldMapFrame.advWindowTab.epicDenTab.visible = !param1;
         }
      }

      private function onAdvTab(param1:MouseEvent) : void
"""
edit('gui/VolumeSelector.as', [
    ('   import flash.display.MovieClip;\n', '   import flash.display.MovieClip;\n   import flash.display.Sprite;\n'),
    ('            _worldMapFrame.advWindowTab.AJHQ_cont.AJHQ_btnCont.addEventListener("mouseDown",onAJHQBtn,false,0,true);\n',
     '            _worldMapFrame.advWindowTab.AJHQ_cont.AJHQ_btnCont.addEventListener("mouseDown",onAJHQBtn,false,0,true);\n            jrAddMapTabs();\n'),
    ('\n      private function onAdvTab(param1:MouseEvent) : void\n', MAP_TABS),
    ('      private function onAdvTab(param1:MouseEvent) : void\n      {\n         param1.stopPropagation();\n',
     '      private function onAdvTab(param1:MouseEvent) : void\n      {\n         param1.stopPropagation();\n         jrTabLeave(false);\n'),
    ('      private function onEpicDenTab(param1:MouseEvent) : void\n      {\n         var _loc2_:Object = null;\n         param1.stopPropagation();\n',
     '      private function onEpicDenTab(param1:MouseEvent) : void\n      {\n         var _loc2_:Object = null;\n         param1.stopPropagation();\n         jrTabLeave(true);\n'),
    ('      private function destroyDenAndAdventureWindows() : void\n      {\n',
     '      private function destroyDenAndAdventureWindows() : void\n      {\n         jrTabLeave(false);\n'),
])

# Edit Animal: a round Auto Recycle button beside the game's recycle button.
# Edit Animal: round JR buttons under the item count (below the inventory)
# and under the animal colors.
anchor('gui/AvatarEditor.as', 'avEditor.recycleClothesBtn.addEventListener("mouseDown",onRecycleClothesBtn,false,0,true);',
       'XtReplyDemuxer.jrAnchor("avatarinv",avEditor.itemCounter.parent,avEditor.itemCounter);\n         XtReplyDemuxer.jrAnchor("avatarcolors",avEditor.colorTableBlock.parent,avEditor.colorTableBlock);')

# Art Studio: a round Picture button after the game's storage button; it
# turns a picture into the painting, which the game can save as .ajart.
ART = r"""
      private function jrOnPicture(param1:Object) : void
      {
         if(!_exitConfirmationActive)
         {
            XtReplyDemuxer.jrPicturePopup(_guiLayer,_drawBitmapData.width,_drawBitmapData.height,jrApplyPicture);
         }
      }

      private function jrApplyPicture(param1:BitmapData, param2:Boolean) : void
      {
         _drawBitmapUndoSnapShot.copyPixels(_drawBitmapData,_drawBitmapDataRect,_drawPoint_0_0);
         _drawBitmapData.copyPixels(param1,param1.rect,new Point(0,0));
         _masterpieceSubmitBtn.guiBtn.setGrayState(false);
         if(_submitButton != null)
         {
            _submitButton.guiBtn.setGrayState(false);
         }
         _printBtn.guiBtn.setGrayState(false);
         _clearAllButton.guiBtn.setGrayState(false);
         _hasDrawn = true;
         _needsSave = true;
         _undoable = true;
         if(param2)
         {
            onSaveButton();
         }
      }

      private function onStorageButton() : void
"""
edit('game/artStudioPainting/ArtStudioPainting.as', [
    ('         _storageButton.guiBtn.setUsePressedState();\n',
     '         _storageButton.guiBtn.setUsePressedState();\n         XtReplyDemuxer.jrLocal("picture",jrOnPicture);\n         XtReplyDemuxer.jrAnchor("artstudio",_storageButton.parent,_storageButton);\n'),
    ('\n      private function onStorageButton() : void\n', ART),
])


# More ways to sort: a round Sort button next to the game's own Sort By
# (Edit Animal) and next to the den item search (den editor).
AV_SORT = r"""
      private var _jrSortKey:String = "newest";

      private function jrOnSort(param1:Object) : void
      {
         if(avEditor.sortBtn.visible)
         {
            XtReplyDemuxer.jrSortMenu(param1,_jrSortKey,jrApplySort);
         }
      }

      private function jrApplySort(param1:String) : void
      {
         if(!avEditor || !avEditor.sortBtn.visible || _allNewestClothes == null)
         {
            return;
         }
         _jrSortKey = param1;
         _currClothesArray = new AccItemCollection(XtReplyDemuxer.jrSortItems(_allNewestClothes.getCoreArray(),param1));
         if(_itemClothingWindows)
         {
            _itemClothingWindows.destroy();
            _itemClothingWindows = null;
         }
         _mainScrollYPosition = 0;
         avEditor.sortPopup.visible = false;
         createItemWindows(_currClothesArray,avEditor.itemBlock);
      }

      private function sortByHandler(param1:MouseEvent) : void
"""
edit('gui/AvatarEditor.as', [
    ('\n      private function sortByHandler(param1:MouseEvent) : void\n', AV_SORT),
    ('         avEditor.sortBtn.addEventListener("mouseDown",sortByHandler,false,0,true);\n',
     '         avEditor.sortBtn.addEventListener("mouseDown",sortByHandler,false,0,true);\n'),
    # The game's Sort By list opens with JR's More Sorts beside it.
    ('         avEditor.sortPopup.visible = !avEditor.sortPopup.visible;\n         if(avEditor.sortPopup.visible)\n         {\n            btnOutHandler(param1);\n         }\n',
     '         avEditor.sortPopup.visible = !avEditor.sortPopup.visible;\n         if(avEditor.sortPopup.visible)\n         {\n            btnOutHandler(param1);\n            XtReplyDemuxer.jrSortMenu(avEditor.sortPopup,_jrSortKey,jrApplySort,"right");\n         }\n         else\n         {\n            XtReplyDemuxer.jrSortMenuClose();\n         }\n'),
    # Picking one of the game's own sorts closes More Sorts.
    ('         avEditor.sortBtn.gotoAndStop(param1.currentTarget.name + _loc4_);\n',
     '         XtReplyDemuxer.jrSortMenuClose();\n         _jrSortKey = "";\n         avEditor.sortBtn.gotoAndStop(param1.currentTarget.name + _loc4_);\n'),
])
DEN_SORT = r"""
      private var _jrSortKey:String = "newest";

      private var _jrBase:DenItemCollection;

      private var _jrSorted:DenItemCollection;

      private function jrOnSort(param1:Object) : void
      {
         if(_currItems != null && _currItems != _audioItems)
         {
            XtReplyDemuxer.jrSortMenu(param1,_jrSortKey,jrApplySort);
         }
      }

      private function jrApplySort(param1:String) : void
      {
         if(_currItems == null || _currItems == _audioItems)
         {
            return;
         }
         // Sorting starts from the tab's own list each time.
         if(_currItems != _jrSorted)
         {
            _jrBase = _currItems;
         }
         _jrSortKey = param1;
         _jrSorted = new DenItemCollection(XtReplyDemuxer.jrSortItems(_jrBase.getCoreArray(),param1));
         _currItems = _jrSorted;
         drawItemWindows();
      }

      private function drawItemWindows() : void
"""
edit('gui/DenEditor.as', [
    ('\n      private function drawItemWindows() : void\n', DEN_SORT),
    ('         _denEditor.searchBar.addEventListener("change",onSearchTextInput,false,0,true);\n',
     '         _denEditor.searchBar.addEventListener("change",onSearchTextInput,false,0,true);\n         XtReplyDemuxer.jrLocal("densort",jrOnSort);\n         XtReplyDemuxer.jrAnchor("densort",_denEditor.searchBar.parent,_denEditor.searchBar);\n'),
])


# Every color in the game in Edit Animal: the color tables get the whole game
# palette (16 across), and under each one a color code box, a random color
# button and an eyedropper (JRColorRow). Colors stay game palette colors.
import re as _re
_ct = open(os.path.join(B, 'gui/ColorTable.as'), encoding='utf-8').read().replace('\r\n', '\n')
_ct, _n = _re.subn(r'with\(_currColorSwatch\.graphics\)\s*\{.*?\n\s*\}\n', 'jrDrawSwatch(_currColorSwatch.graphics,x,y);\n', _ct, flags=_re.S)
if _n != 1: sys.exit('gui/ColorTable.as: swatch drawing not found')
os.makedirs(os.path.join(O, 'gui'), exist_ok=True)
open(os.path.join(O, 'gui/ColorTable.as'), 'w', encoding='utf-8').write(_ct)
CT_JR = r"""
      public var jrOnPick:Function;

      public function jrLayout(param1:Array, param2:int, param3:int, param4:int) : void
      {
         if(_bm)
         {
            this.removeChild(_bm);
            _bm = null;
         }
         _colorIndexes = param1;
         _numCols = param2;
         _numRows = param3;
         _height = param4;
         _cellWidth = _width / _numCols;
         _cellHeight = _height / _numRows;
         _secretColorIdx = -1;
         _bmd = new BitmapData(_width,_height,false,0);
         fillColorTable();
         setCurrentColorSwatch(_currColor);
      }

      public function jrSelect(param1:int) : void
      {
         if(_currColor != param1)
         {
            _currColor = param1;
            setCurrentColorSwatch(param1);
            if(_colorChangeCallback != null)
            {
               _colorChangeCallback(_id,param1);
            }
         }
      }

      public function get jrColor() : int
      {
         return _currColor;
      }

      // The ring round the chosen color: the game's 5px one, thinner on small cells.
      private function jrDrawSwatch(param1:Graphics, param2:int, param3:int) : void
      {
         var _loc4_:int = Math.min(_cellWidth,_cellHeight) >= 20 ? 5 : 2;
         param1.beginFill(0);
         param1.drawRect(param2,param3,_cellWidth,_loc4_);
         param1.drawRect(param2,param3 + _cellHeight - _loc4_,_cellWidth,_loc4_);
         param1.drawRect(param2,param3 + _loc4_,_loc4_,_cellHeight - _loc4_ * 2);
         param1.drawRect(param2 + _cellWidth - _loc4_,param3 + _loc4_,_loc4_,_cellHeight - _loc4_ * 2);
         param1.endFill();
         if(_loc4_ < 5)
         {
            param1.beginFill(0xFFFFFF);
            param1.drawRect(param2 + _loc4_,param3 + _loc4_,_cellWidth - _loc4_ * 2,1);
            param1.drawRect(param2 + _loc4_,param3 + _cellHeight - _loc4_ - 1,_cellWidth - _loc4_ * 2,1);
            param1.drawRect(param2 + _loc4_,param3 + _loc4_ + 1,1,_cellHeight - _loc4_ * 2 - 2);
            param1.drawRect(param2 + _cellWidth - _loc4_ - 1,param3 + _loc4_ + 1,1,_cellHeight - _loc4_ * 2 - 2);
            param1.endFill();
         }
      }

      public function ColorTable()
"""
edit('gui/ColorTable.as', [
    ('   import flash.display.BitmapData;\n', '   import flash.display.BitmapData;\n   import flash.display.Graphics;\n'),
    ('\n      public function ColorTable()\n', CT_JR),
    ('            _loc3_ = int(_colorIndexes[_loc4_]);\n',
     '            if(_loc4_ < 0 || _loc4_ >= _colorIndexes.length || _loc2_.y >= _height)\n            {\n               return;\n            }\n            _loc3_ = int(_colorIndexes[_loc4_]);\n'),
    ('               _colorChangeCallback(_id,_loc3_);\n            }\n',
     '               _colorChangeCallback(_id,_loc3_);\n            }\n            if(jrOnPick != null)\n            {\n               jrOnPick();\n            }\n'),
])
edit('gui/AvatarEditor.as', [
    ('         _colorTableEyes.init(2,240,150,10,5,_gamePalette,_avatarPalette1,_loc5_,onColorChanged,102);\n',
     '         _colorTableEyes.init(2,240,150,10,5,_gamePalette,_avatarPalette1,_loc5_,onColorChanged,102);\n'
     '         XtReplyDemuxer.jrBigPalette(_colorTableColor1,_gamePalette);\n'
     '         XtReplyDemuxer.jrBigPalette(_colorTableColor2,_gamePalette);\n'
     '         XtReplyDemuxer.jrBigPalette(_colorTablePatterns,_gamePalette);\n'
     '         XtReplyDemuxer.jrBigPalette(_colorTableEyes,_gamePalette);\n'),
])


# Front, Back and Mirror sitting poses on the Actions window (jrPoseButtons),
# added again whenever the game rebuilds its HUD.
_gm = os.path.join(O, 'gui/GuiManager.as')
_g = open(_gm if os.path.exists(_gm) else os.path.join(B, 'gui/GuiManager.as'), encoding='utf-8').read().replace('\r\n', '\n')
_g, _n = _re.subn(r'(\n([ \t]*)actionMgr(?: = new ActionManager|\.reload)\([^\n]*\);\n)',
                  lambda m: m.group(1) + m.group(2) + 'XtReplyDemuxer.jrPoseButtons(actionMgr.actionWindow.sitBtns);\n' + m.group(2) + 'XtReplyDemuxer.jrSmooth();\n', _g)
if _n < 2: sys.exit(f'gui/GuiManager.as: Actions window set-up not found ({_n})')
os.makedirs(os.path.join(O, 'gui'), exist_ok=True)
open(_gm, 'w', encoding='utf-8').write(_g)


# True color (JRColorPicker): your own animal painted with exact RGB colors,
# on your screen only. AvatarView marks which drawings are yours; LayerBitmap
# asks JR for the base colors of each layer it paints.
edit('avatar/AvatarView.as', [
    ('         this.addChild(_layerAnim.bitmap);\n',
     '         this.addChild(_layerAnim.bitmap);\n         XtReplyDemuxer.jrMarkAvatar(_layerAnim.bitmap,_avatar);\n'),
    ('         _avatar = param1;\n         _avatar.addEventListener("OnAvatarChanged",avatarChanged,false,0,true);\n         if(_layerAnim)\n         {\n',
     '         _avatar = param1;\n         _avatar.addEventListener("OnAvatarChanged",avatarChanged,false,0,true);\n         if(_layerAnim)\n         {\n            XtReplyDemuxer.jrMarkAvatar(_layerAnim.bitmap,_avatar);\n'),
])
LB_REFRESH = """      public function invalidate() : void
      {
         _lastFrame = -1;
      }

      // JR: paint every layer's colors again (true color changed).
      public function jrRefresh() : void
      {
         var _loc1_:Object = null;
         var _loc2_:Object = null;
         for each(_loc1_ in _cachedLayerGroups)
         {
            for each(_loc2_ in _loc1_.layers)
            {
               if(_loc2_ != null)
               {
                  _loc2_.lastColor = -1;
               }
            }
            _loc1_.checkColors = true;
         }
         for each(_loc2_ in _activeLayerGroup.layers)
         {
            if(_loc2_ != null)
            {
               _loc2_.lastColor = -1;
            }
         }
         _activeLayerGroup.checkColors = true;
         invalidate();
      }
"""
edit('com/sbi/graphics/LayerBitmap.as', [
    ('      public function invalidate() : void\n      {\n         _lastFrame = -1;\n      }\n', LB_REFRESH),
    ('               PaletteHelper.BuildAnimalPalette(_loc9_.pal,_loc6_[_loc8_],_loc6_[_loc10_],_loc6_[_loc2_],_loc6_[_loc3_]);',
     '               _loc6_ = XtReplyDemuxer.jrTrueColors(this,_loc5_,[_loc6_[_loc8_],_loc6_[_loc10_],_loc6_[_loc2_],_loc6_[_loc3_]]);\n               PaletteHelper.BuildAnimalPalette(_loc9_.pal,_loc6_[0],_loc6_[1],_loc6_[2],_loc6_[3]);'),
])
edit('gui/ColorTable.as', [
    ('      public function get jrColor() : int\n',
     '      public function get jrId() : int\n      {\n         return _id;\n      }\n\n      public function get jrColor() : int\n'),
])
