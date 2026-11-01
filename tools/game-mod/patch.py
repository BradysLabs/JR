import os, sys
B, O = sys.argv[1], sys.argv[2]  # decompiled scripts in, JR's changed scripts out
def edit(rel, pairs):
    # A screen changed twice builds on its first change.
    done = os.path.join(O, rel)
    s = open(done if os.path.exists(done) else os.path.join(B, rel), encoding='utf-8').read().replace('\r\n', '\n')
    for old, new in pairs:
        n = s.count(old)
        if n != 1: sys.exit(f'{rel}: expected 1 match, got {n}: {old[:60]!r}')
        s = s.replace(old, new)
    os.makedirs(os.path.dirname(os.path.join(O, rel)) or O, exist_ok=True)
    open(os.path.join(O, rel), 'w', encoding='utf-8').write(s)

# ---------------------------------------------------------------- bridge
JR_BRIDGE = r'''
      // ---------------------------------------------------------------- JR
      // JR talks to the game over the game's own connection. The game sends
      // "jr" messages (JR's proxy keeps them, Animal Jam never sees them) and
      // JR answers with "jr" replies, handled here before any game module.

      public static var jrRows:Array = [];

      private static var _jrWorth:Object = {};

      private static var _jrBubble:JRBubble;

      private static var _jrHoverKey:String;

      private static var _jrHoverTarget:DisplayObject;

      public static function jrSend(param1:Array) : void
      {
         try
         {
            gMainFrame.server.setXtObject_Str("jr",param1,true,false,false);
         }
         catch(e:Error)
         {
         }
      }

      private static function jrHandle(param1:Object) : void
      {
         var _loc2_:String = String(param1[2]);
         var _loc3_:Object = null;
         try
         {
            _loc3_ = JSON.parse(String(param1[3]));
         }
         catch(e:Error)
         {
            return;
         }
         if(_loc2_ == "s")
         {
            if(_loc3_ is Array)
            {
               jrRows = _loc3_ as Array;
            }
         }
         else if(_loc2_ == "w")
         {
            if(_loc3_ && _loc3_.k)
            {
               _jrWorth[String(_loc3_.k)] = _loc3_;
               if(String(_loc3_.k) == _jrHoverKey)
               {
                  jrShowBubble(_loc3_);
               }
            }
         }
         else if(_loc2_ == "c")
         {
            _jrWorth = {};
         }
         else if(_loc2_ == "a")
         {
            _jrAnchorDefs = _loc3_ ? _loc3_ : {};
            if(_loc3_ && _loc3_._font)
            {
               JRStyle.fontName = String(_loc3_._font);
            }
            jrApplyAnchors();
         }
         else if(_loc2_ == "v")
         {
            if(_loc3_ && _loc3_.id)
            {
               jrPanel(_loc3_);
            }
         }
         else if(_loc2_ == "x")
         {
            if(_loc3_ && _jrPanels[String(_loc3_.id)])
            {
               JRPanel(_jrPanels[String(_loc3_.id)]).close();
            }
         }
         else if(_loc2_ == "m")
         {
            jrToast(_loc3_);
         }
         else if(_loc2_ == "dp")
         {
            // Den Item Previewer (plugins/den-item-previewer/den.js).
            if(_loc3_)
            {
               JRDenPreview.apply(_loc3_);
            }
         }
         else if(_loc2_ == "i")
         {
            // JR asks for item pictures (src/game/pictures.js).
            if(_loc3_ && _loc3_.q is Array)
            {
               JRPictureMaker.ask(_loc3_.q as Array);
            }
         }
         else if(_loc2_ == "k")
         {
            if(_loc3_)
            {
               _jrWorthMap = _loc3_;
            }
         }
         else if(_loc2_ == "p")
         {
            _jrIds = [];
            if(_loc3_ && _loc3_.ids is Array)
            {
               for each(var _loc4_:Object in _loc3_.ids)
               {
                  _jrIds.push(String(_loc4_).toLowerCase());
               }
            }
            jrSavedName = _loc3_ && _loc3_.saved ? String(_loc3_.saved) : "";
            jrSetAlias(_loc3_ && _loc3_.show ? String(_loc3_.show) : "");
         }
      }


      // ------------------------------------------------------------ JR UI
      // JR's buttons on game screens, and JR windows (classes at the end
      // of this file). JR says which buttons each screen gets ("a"), what a
      // window shows ("v"), closes windows ("x") and shows messages ("m").

      private static var _jrAnchorDefs:Object = {};

      private static var _jrPending:Object = {};

      private static var _jrPanels:Object = {};

      private static var _jrStage:Stage;

      private static var _jrOpener:DisplayObject;

      private static function jrJson(param1:Object) : String
      {
         return JSON.stringify(param1).split("%").join("\\u0025");
      }

      private static var _jrReported:Object = {};

      // Tells JR where a screen's parts are, once per screen, so JR's
      // buttons can be placed by its numbers.
      private static function jrReport(param1:String, param2:DisplayObjectContainer, param3:DisplayObject) : void
      {
         var _loc4_:Array = [];
         var _loc5_:int = 0;
         var _loc6_:DisplayObject = null;
         var _loc7_:Rectangle = null;
         if(_jrReported[param1])
         {
            return;
         }
         _jrReported[param1] = true;
         try
         {
            while(_loc5_ < param2.numChildren && _loc4_.length < 80)
            {
               _loc6_ = param2.getChildAt(_loc5_);
               _loc7_ = _loc6_.getBounds(param2);
               _loc4_.push([_loc6_.name,Math.round(_loc7_.x),Math.round(_loc7_.y),Math.round(_loc7_.width),Math.round(_loc7_.height),_loc6_.visible ? 1 : 0]);
               _loc5_++;
            }
            _loc7_ = param3 != null ? param3.getBounds(param2) : null;
            jrSend(["d",jrJson({
               "what":"anchor",
               "id":param1,
               "near":_loc7_ != null ? [param3.name,Math.round(_loc7_.x),Math.round(_loc7_.y),Math.round(_loc7_.width),Math.round(_loc7_.height)] : null,
               "kids":_loc4_
            })]);
         }
         catch(e:Error)
         {
         }
      }

      public static function jrAnchor(param1:String, param2:Object, param3:Object, param4:Object = null) : void
      {
         var _loc5_:DisplayObjectContainer = null;
         var _loc6_:DisplayObject = null;
         var _loc7_:Object = null;
         var _loc8_:JRBar = null;
         var _loc9_:Rectangle = null;
         var _loc10_:String = null;
         var _loc11_:Number = NaN;
         var _loc12_:Number = NaN;
         try
         {
            _loc5_ = param2 as DisplayObjectContainer;
            _loc6_ = param3 as DisplayObject;
            if(_loc5_ == null)
            {
               return;
            }
            if(_loc5_.stage)
            {
               _jrStage = _loc5_.stage;
            }
            _loc6_ = _loc5_.getChildByName("jrBar_" + param1);
            if(_loc6_)
            {
               _loc5_.removeChild(_loc6_);
            }
            _loc6_ = param3 as DisplayObject;
            jrReport(param1,_loc5_,_loc6_);
            _loc7_ = _jrAnchorDefs[param1];
            _jrPending[param1] = {
               "c":_loc5_,
               "n":_loc6_,
               "x":param4
            };
            if(_loc7_ == null || !(_loc7_.b is Array) || (_loc7_.b as Array).length == 0)
            {
               return;
            }
            _loc8_ = new JRBar(param1,_loc7_.b as Array,param4,_loc7_.round ? (_loc6_ != null ? Math.round(_loc6_.getBounds(_loc5_).height * (Number(_loc7_.round) > 2 ? Number(_loc7_.round) / Math.max(1,_loc6_.getBounds(_loc5_).height) : Number(_loc7_.round))) : 44) : 0);
            _loc10_ = _loc7_.pos ? String(_loc7_.pos) : "left";
            _loc11_ = _loc7_.dx ? Number(_loc7_.dx) : 0;
            _loc12_ = _loc7_.dy ? Number(_loc7_.dy) : 0;
            if(_loc6_ != null)
            {
               _loc9_ = _loc6_.getBounds(_loc5_);
               if(_loc10_ == "right")
               {
                  _loc8_.x = _loc9_.right + 6;
                  _loc8_.y = _loc9_.top + (_loc9_.height - _loc8_.height) / 2;
               }
               else if(_loc10_ == "above")
               {
                  _loc8_.x = _loc9_.right - _loc8_.width;
                  _loc8_.y = _loc9_.top - _loc8_.height - 4;
               }
               else if(_loc10_ == "aboveLeft")
               {
                  _loc8_.x = _loc9_.left;
                  _loc8_.y = _loc9_.top - _loc8_.height - 4;
               }
               else if(_loc10_ == "below")
               {
                  _loc8_.x = _loc9_.right - _loc8_.width;
                  _loc8_.y = _loc9_.bottom + 4;
               }
               else if(_loc10_ == "belowCenter")
               {
                  _loc8_.x = _loc9_.left + (_loc9_.width - _loc8_.width) / 2;
                  _loc8_.y = _loc9_.bottom + 4;
               }
               else if(_loc10_ == "belowLeft")
               {
                  _loc8_.x = _loc9_.left;
                  _loc8_.y = _loc9_.bottom + 4;
               }
               else
               {
                  _loc8_.x = _loc9_.left - _loc8_.width - 6;
                  _loc8_.y = _loc9_.top + (_loc9_.height - _loc8_.height) / 2;
               }
            }
            else
            {
               _loc8_.x = 8;
               _loc8_.y = 8;
            }
            _loc8_.x = Math.round(_loc8_.x + _loc11_);
            _loc8_.y = Math.round(_loc8_.y + _loc12_);
            _loc5_.addChild(_loc8_);
         }
         catch(e:Error)
         {
         }
      }

      private static function jrApplyAnchors() : void
      {
         var _loc1_:String = null;
         var _loc2_:Object = null;
         var _loc3_:Object = _jrPending;
         _jrPending = {};
         for(_loc1_ in _loc3_)
         {
            _loc2_ = _loc3_[_loc1_];
            if(_loc2_ && _loc2_.c && DisplayObjectContainer(_loc2_.c).stage)
            {
               jrAnchor(_loc1_,_loc2_.c,_loc2_.n,_loc2_.x);
            }
         }
      }

      private static var _jrLocals:Object = {};

      public static function jrLocal(param1:String, param2:Function) : void
      {
         _jrLocals[param1] = param2;
      }

      public static function jrRunLocal(param1:String, param2:DisplayObject) : void
      {
         var _loc3_:Function = _jrLocals[param1] as Function;
         if(_loc3_ != null)
         {
            _loc3_(param2);
         }
      }

      public static function jrPicturePopup(param1:Object, param2:int, param3:int, param4:Function) : void
      {
         var _loc5_:Stage = param1 is Stage ? Stage(param1) : (param1 is DisplayObject ? DisplayObject(param1).stage : _jrStage);
         var _loc6_:JRPicturePopup = null;
         if(_loc5_ == null)
         {
            return;
         }
         _loc6_ = new JRPicturePopup(param2,param3,param4);
         _loc6_.x = Math.round((_loc5_.stageWidth - _loc6_.width) / 2);
         _loc6_.y = Math.max(24,Math.round((_loc5_.stageHeight - 420) / 2));
         _loc5_.addChild(_loc6_);
      }

      // ------------------------------------------------------------ sorting
      // More ways to sort the inventory and den items. Worth comes from JR
      // ("k": {"c<defId>_<color>": diamonds, "d<defId>": diamonds}).

      private static var _jrWorthMap:Object = {};

      private static var _jrSortMenu:JRSortMenu;

      public static function jrSortMenuClose() : void
      {
         if(_jrSortMenu)
         {
            _jrSortMenu.close();
            _jrSortMenu = null;
         }
      }

      // param4 "right": beside param0 (the game's own Sort By list), else below it.
      public static function jrSortMenu(param0:Object, param2:String, param3:Function, param4:String = "below") : void
      {
         var _loc4_:Rectangle = null;
         var param1:DisplayObject = param0 as DisplayObject;
         if(param1 == null || param1.stage == null)
         {
            return;
         }
         if(_jrSortMenu)
         {
            _jrSortMenu.close();
         }
         jrSend(["k"]);
         _jrSortMenu = new JRSortMenu(param2,param3);
         if(param4 == "right")
         {
            _jrSortMenu.follow = param1;
         }
         _loc4_ = param1.getBounds(param1.stage);
         _jrSortMenu.x = Math.round(Math.max(4,Math.min(param1.stage.stageWidth - _jrSortMenu.width - 4,param4 == "right" ? _loc4_.right + 6 : _loc4_.left)));
         _jrSortMenu.y = Math.round(Math.max(4,Math.min(param1.stage.stageHeight - _jrSortMenu.height - 4,param4 == "right" ? _loc4_.top : _loc4_.bottom + 6)));
         param1.stage.addChild(_jrSortMenu);
      }

      // Front, Back and Mirror on the Actions window's sit arrows: the sitting
      // poses the arrows can't reach (straight at you, straight away), and the
      // pose you're in turned the other way. The pose goes in the game's own
      // position update, so players who see you arrive see it too.
      private static var _jrPose:int = -1;
      private static var _jrPoseFlip:Boolean = false;
      private static var _jrPoseAt:String = "";

      // Smooth play: the game animates at most 8 animals a frame, so busy
      // rooms stutter. Let every animal on screen animate on time.
      public static function jrSmooth() : void
      {
         LayerAnim.throttle = 1000;
      }

      // True color: exact RGB colors on your own animal, on your screen only.
      // The game saves palette colors; for each part (main, secondary, eyes,
      // pattern) JR remembers the exact color you picked and the palette color
      // the game saved, and paints the exact one while they still match.
      private static var _jrMine:Dictionary = new Dictionary(true);
      private static var _jrTrue:Object = null;

      // Which drawings are your animal (AvatarView marks each one it draws).
      public static function jrMarkAvatar(param1:Object, param2:Object) : void
      {
         var _loc3_:String = null;
         if(param1 == null)
         {
            return;
         }
         try
         {
            _loc3_ = String(gMainFrame.userInfo.myUserName || "").toLowerCase();
            if(param2 != null && _loc3_ != "" && String(param2.userName || "").toLowerCase() == _loc3_)
            {
               _jrMine[param1] = param2;
               return;
            }
         }
         catch(e:Error)
         {
         }
         delete _jrMine[param1];
      }

      private static function jrTrueMap() : Object
      {
         var _loc1_:SharedObject = null;
         var _loc2_:String = null;
         if(_jrTrue == null)
         {
            _jrTrue = {};
            try
            {
               _loc1_ = SharedObject.getLocal("jrTrueColors","/");
               if(_loc1_.data.map)
               {
                  _jrTrue = _loc1_.data.map;
               }
            }
            catch(e:Error)
            {
            }
         }
         _loc2_ = String(gMainFrame.userInfo.myUserName || "").toLowerCase();
         if(_jrTrue[_loc2_] == null)
         {
            _jrTrue[_loc2_] = {};
         }
         return _jrTrue[_loc2_];
      }

      // The exact color for a part while the game has palette color param2 saved
      // for it, or -1. Parts: 0 main, 1 secondary, 2 eyes, 3 pattern.
      public static function jrTrueFor(param1:int, param2:int) : int
      {
         var _loc3_:Object = null;
         try
         {
            _loc3_ = jrTrueMap()[String(param1)];
         }
         catch(e:Error)
         {
            return -1;
         }
         return _loc3_ != null && int(_loc3_.i) == param2 ? int(_loc3_.c) : -1;
      }

      // Remembers (param3 >= 0) or forgets (param3 < 0) a part's exact color.
      public static function jrSetTrue(param1:int, param2:int, param3:int) : void
      {
         var _loc4_:Object = jrTrueMap();
         var _loc5_:SharedObject = null;
         var _loc6_:Object = null;
         if(param3 >= 0)
         {
            _loc4_[String(param1)] = {
               "i":param2,
               "c":param3 & 0xFFFFFF
            };
         }
         else
         {
            delete _loc4_[String(param1)];
         }
         try
         {
            _loc5_ = SharedObject.getLocal("jrTrueColors","/");
            _loc5_.data.map = _jrTrue;
            _loc5_.flush();
         }
         catch(e:Error)
         {
         }
         for(_loc6_ in _jrMine)
         {
            try
            {
               _loc6_.jrRefresh();
            }
            catch(e:Error)
            {
            }
         }
      }

      // LayerBitmap asks for the four base colors of a layer it paints.
      public static function jrTrueColors(param1:Object, param2:uint, param3:Array) : Array
      {
         var _loc4_:Object = _jrMine[param1];
         var _loc5_:Array = null;
         var _loc6_:int = 0;
         if(_loc4_ == null)
         {
            return param3;
         }
         try
         {
            _loc5_ = _loc4_.colors;
            if(_loc5_ == null)
            {
               return param3;
            }
            if(param2 == uint(_loc5_[0]))
            {
               _loc6_ = jrTrueFor(0,param2 >> 24 & 0xFF);
               if(_loc6_ >= 0)
               {
                  param3[0] = uint(_loc6_);
               }
               _loc6_ = jrTrueFor(1,param2 >> 16 & 0xFF);
               if(_loc6_ >= 0)
               {
                  param3[1] = uint(_loc6_);
               }
            }
            else if(param2 == uint(_loc5_[1]))
            {
               _loc6_ = jrTrueFor(3,param2 >> 24 & 0xFF);
               if(_loc6_ >= 0)
               {
                  param3[0] = uint(_loc6_);
               }
            }
            else if(param2 == uint(_loc5_[2]))
            {
               _loc6_ = jrTrueFor(2,param2 >> 24 & 0xFF);
               if(_loc6_ >= 0)
               {
                  param3[0] = uint(_loc6_);
               }
            }
         }
         catch(e:Error)
         {
         }
         return param3;
      }

      public static function jrPoseButtons(param1:Object) : void
      {
         var _loc2_:Sprite = param1 as Sprite;
         var _loc3_:Rectangle = null;
         var _loc4_:Sprite = null;
         var _loc5_:JRPill = null;
         var _loc6_:Array = null;
         var _loc7_:int = 0;
         if(_loc2_ == null || _loc2_.getChildByName("jrPoses") != null)
         {
            return;
         }
         _loc3_ = _loc2_.getBounds(_loc2_);
         _loc4_ = new Sprite();
         _loc4_.name = "jrPoses";
         _loc6_ = [["Front","front",0.36,0.3],["Back","back",0.64,0.3],["Mirror","mirror",0.5,0.72]];
         while(_loc7_ < _loc6_.length)
         {
            _loc5_ = new JRPill(_loc6_[_loc7_][0],_loc6_[_loc7_][1],jrOnPose,"primary",48,9);
            _loc5_.x = Math.round(_loc3_.x + _loc3_.width * _loc6_[_loc7_][2] - _loc5_.width / 2);
            _loc5_.y = Math.round(_loc3_.y + _loc3_.height * _loc6_[_loc7_][3] - _loc5_.height / 2);
            _loc4_.addChild(_loc5_);
            _loc7_++;
         }
         _loc2_.addChild(_loc4_);
      }

      private static function jrOnPose(param1:Object) : void
      {
         var _loc2_:Object = AvatarManager.playerAvatarWorldView;
         var _loc3_:String = String(param1.key);
         var _loc4_:int = 0;
         var _loc5_:Boolean = false;
         var _loc6_:Object = null;
         var _loc7_:String = null;
         if(_loc2_ == null || gMainFrame.clientInfo.invisMode || MinigameManager.inMinigame())
         {
            return;
         }
         _loc6_ = _loc2_.avatarPos;
         _loc7_ = int(_loc6_.x) + "," + int(_loc6_.y);
         if(_loc3_ == "front" || _loc3_ == "back")
         {
            _loc4_ = _loc3_ == "front" ? 5 : 1;
            _loc5_ = _jrPose == _loc4_ && _jrPoseAt == _loc7_ ? _jrPoseFlip : Boolean(_loc2_.lastIdleFlip);
         }
         else if(_jrPose >= 0 && _jrPoseAt == _loc7_)
         {
            _loc4_ = _jrPose;
            _loc5_ = !_jrPoseFlip;
         }
         else
         {
            _loc4_ = int(_loc2_.lastIdleAnim);
            _loc5_ = !_loc2_.lastIdleFlip;
         }
         _jrPose = _loc4_;
         _jrPoseFlip = _loc5_;
         _jrPoseAt = _loc7_;
         _loc2_.playAnim(_loc4_,_loc5_);
         gMainFrame.server.setXtObject_Str("au",["1",int(_loc6_.x),int(_loc6_.y),uint(_loc4_ | (_loc5_ ? 2147483648 : 0)),"1"]);
      }

      // Edit Animal's color tables show every color in the game, with a color
      // code box, a random color and an eyedropper under each (JRColorRow).
      public static function jrBigPalette(param1:Object, param2:Array) : void
      {
         var _loc3_:int = 0;
         var _loc4_:Array = [];
         var _loc5_:int = 0;
         var _loc6_:int = 0;
         var _loc7_:JRColorRow = null;
         if(param1 == null || param2 == null)
         {
            return;
         }
         _loc5_ = Math.min(256,param2.length);
         _loc5_ -= _loc5_ % 16;
         if(_loc5_ < 16)
         {
            return;
         }
         while(_loc3_ < _loc5_)
         {
            _loc4_.push(_loc3_);
            _loc3_++;
         }
         _loc6_ = Math.max(6,Math.floor(126 / (_loc5_ / 16)));
         try
         {
            param1.jrLayout(_loc4_,16,_loc5_ / 16,_loc6_ * (_loc5_ / 16));
            _loc7_ = new JRColorRow(param1,param2,_loc5_);
            _loc7_.y = _loc6_ * (_loc5_ / 16) + 4;
            param1.addChild(_loc7_);
            param1.jrOnPick = _loc7_.update;
            _loc7_.update();
         }
         catch(e:Error)
         {
         }
      }

      private static function jrProp(param1:Object, param2:String) : *
      {
         try
         {
            return param1[param2];
         }
         catch(e:Error)
         {
         }
         return null;
      }

      private static function jrWorthOf(param1:Object) : Number
      {
         var _loc2_:String = getQualifiedClassName(param1) == "den::DenItem" ? "d" + jrProp(param1,"defId") : "c" + jrProp(param1,"defId") + "_" + uint(jrProp(param1,"color"));
         var _loc3_:Number = Number(_jrWorthMap[_loc2_]);
         return isNaN(_loc3_) ? -1 : _loc3_;
      }

      /** The items in a new order. param1 is newest first, as the game keeps them. */
      public static function jrSortItems(param1:Array, param2:String) : Array
      {
         var _loc3_:Array = param1.concat();
         var _loc4_:Object = {};
         var _loc5_:Object = null;
         var _loc6_:Array = null;
         var _loc7_:int = 0;
         var _loc8_:Function = function(param1x:Object):String
         {
            return String(XtReplyDemuxer.jrProp(param1x,"name") || "").toLowerCase();
         };
         // keep the game's order among equals: sort by the old position last
         for each(_loc5_ in _loc3_)
         {
            _loc4_[String(jrProp(_loc5_,"defId"))] = int(_loc4_[String(jrProp(_loc5_,"defId"))]) + 1;
         }
         _loc6_ = [];
         _loc7_ = 0;
         while(_loc7_ < _loc3_.length)
         {
            _loc6_.push({
               "i":_loc7_,
               "o":_loc3_[_loc7_],
               "n":_loc8_(_loc3_[_loc7_]),
               "w":(param2 == "worth" || param2 == "worthlow" ? jrWorthOf(_loc3_[_loc7_]) : 0),
               "r":(jrProp(_loc3_[_loc7_],"isRare") ? 1 : 0),
               "d":(jrProp(_loc3_[_loc7_],"isDiamond") || jrProp(_loc3_[_loc7_],"isRareDiamond") ? 1 : 0),
               "m":(jrProp(_loc3_[_loc7_],"isMemberOnly") ? 1 : 0),
               "c":int(_loc4_[String(jrProp(_loc3_[_loc7_],"defId"))]),
               "k":uint(jrProp(_loc3_[_loc7_],"color")),
               "id":int(jrProp(_loc3_[_loc7_],"defId"))
            });
            _loc7_++;
         }
         _loc6_.sort(function(param1a:Object, param2a:Object):int
         {
            var _loc9_:Number = 0;
            if(param2 == "oldest")
            {
               _loc9_ = param2a.i - param1a.i;
            }
            else if(param2 == "az")
            {
               _loc9_ = param1a.n < param2a.n ? -1 : (param1a.n > param2a.n ? 1 : 0);
            }
            else if(param2 == "za")
            {
               _loc9_ = param1a.n > param2a.n ? -1 : (param1a.n < param2a.n ? 1 : 0);
            }
            else if(param2 == "worth")
            {
               _loc9_ = param2a.w - param1a.w;
            }
            else if(param2 == "worthlow")
            {
               _loc9_ = (param1a.w < 0 ? 1000000000 : param1a.w) - (param2a.w < 0 ? 1000000000 : param2a.w);
            }
            else if(param2 == "rare")
            {
               _loc9_ = param2a.r - param1a.r;
            }
            else if(param2 == "diamond")
            {
               _loc9_ = param2a.d - param1a.d;
            }
            else if(param2 == "members")
            {
               _loc9_ = param2a.m - param1a.m;
            }
            else if(param2 == "dupes")
            {
               _loc9_ = param2a.c - param1a.c || param1a.id - param2a.id;
            }
            else if(param2 == "color")
            {
               _loc9_ = param1a.k - param2a.k || param1a.id - param2a.id;
            }
            if(_loc9_ == 0 && param2 != "oldest")
            {
               _loc9_ = param1a.i - param2a.i;
            }
            return _loc9_ < 0 ? -1 : (_loc9_ > 0 ? 1 : 0);
         });
         _loc3_ = [];
         for each(_loc5_ in _loc6_)
         {
            _loc3_.push(_loc5_.o);
         }
         return _loc3_;
      }

      public static function jrOpen(param1:String, param2:String, param3:Object, param4:DisplayObject) : void
      {
         _jrOpener = param4;
         if(param4 && param4.stage)
         {
            _jrStage = param4.stage;
         }
         jrSend(["o",jrJson({
            "s":param1,
            "a":param2,
            "x":param3
         })]);
      }

      public static function jrPanelEvent(param1:String, param2:String, param3:String, param4:Object) : void
      {
         jrSend(["u",jrJson({
            "p":param1,
            "c":param2,
            "v":param3,
            "i":param4
         })]);
      }

      private static function jrPanel(param1:Object) : void
      {
         var _loc2_:String = String(param1.id);
         var _loc3_:JRPanel = _jrPanels[_loc2_] as JRPanel;
         if(_jrStage == null)
         {
            return;
         }
         if(_loc3_ == null)
         {
            if(!param1.open)
            {
               return;
            }
            _loc3_ = new JRPanel(_loc2_);
            _jrPanels[_loc2_] = _loc3_;
         }
         if(_loc3_.embedded)
         {
            _loc3_.render(param1);
         }
         else if(param1.open || _loc3_.parent != null)
         {
            _loc3_.show(_jrStage,param1,param1.open ? _jrOpener : null);
         }
      }


      // The chat bar gets JR's round buttons at its right end: the text box
      // is made shorter to make room, like the game's own buttons.
      public static function jrChatBar(param1:Object, param2:Object) : void
      {
         var _loc3_:DisplayObjectContainer = null;
         var _loc4_:TextField = null;
         var _loc5_:Number = NaN;
         var _loc6_:Number = NaN;
         var _loc7_:Number = NaN;
         var _loc8_:Rectangle = null;
         var _loc9_:Array = null;
         var _loc10_:int = 0;
         var _loc11_:DisplayObject = null;
         var _loc12_:Rectangle = null;
         var _loc13_:Sprite = null;
         var _loc14_:JRRound = null;
         var _loc15_:JRRound = null;
         try
         {
            _loc3_ = param1 as DisplayObjectContainer;
            _loc4_ = param2 as TextField;
            if(_loc3_ == null || _loc4_ == null || _loc3_.getChildByName("jrChat") != null)
            {
               return;
            }
            if(_loc3_.stage)
            {
               _jrStage = _loc3_.stage;
            }
            _loc5_ = Math.round(Math.max(30,Math.min(40,_loc4_.height + 14)));
            _loc6_ = 2 * (_loc5_ + 5);
            _loc7_ = _loc4_.x + _loc4_.width;
            _loc8_ = _loc3_.getBounds(_loc3_);
            _loc9_ = [];
            _loc10_ = 0;
            while(_loc10_ < _loc3_.numChildren)
            {
               _loc11_ = _loc3_.getChildAt(_loc10_);
               _loc12_ = _loc11_.getBounds(_loc3_);
               _loc9_.push(_loc11_.name + ":" + getQualifiedClassName(_loc11_) + "@" + Math.round(_loc12_.x) + "," + Math.round(_loc12_.y) + "," + Math.round(_loc12_.width) + "x" + Math.round(_loc12_.height));
               if(_loc11_ != _loc4_)
               {
                  if(_loc12_.left >= _loc7_ - 12)
                  {
                     _loc11_.x -= _loc6_;
                  }
                  else if(_loc12_.left <= _loc4_.x + 4 && _loc12_.right >= _loc7_ - 4 && _loc12_.height < _loc4_.height * 3 + 20)
                  {
                     _loc11_.width -= _loc6_;
                     _loc11_.x += _loc12_.left - _loc11_.getBounds(_loc3_).left;
                  }
               }
               _loc10_++;
            }
            jrSend(["d",jrJson({
               "what":"chat",
               "field":[Math.round(_loc4_.x),Math.round(_loc4_.y),Math.round(_loc4_.width),Math.round(_loc4_.height)],
               "bar":[Math.round(_loc8_.x),Math.round(_loc8_.y),Math.round(_loc8_.width),Math.round(_loc8_.height)],
               "kids":_loc9_,
               "fonts":JRStyle.fonts()
            })]);
            _loc4_.width -= _loc6_;
            _loc13_ = new Sprite();
            _loc13_.name = "jrChat";
            _loc14_ = new JRRound("advertise","ad","",_loc5_,jrChatPick);
            _loc15_ = new JRRound("menu","","JR",_loc5_,jrChatPick);
            _loc15_.x = _loc5_ + 5;
            _loc13_.addChild(_loc14_);
            _loc13_.addChild(_loc15_);
            _loc13_.x = Math.round(_loc8_.right - _loc6_ + 4);
            _loc13_.y = Math.round(_loc4_.y + _loc4_.height / 2 - _loc5_ / 2);
            _loc3_.addChild(_loc13_);
         }
         catch(e:Error)
         {
            jrSend(["d",jrJson({"what":"chat","error":e.message})]);
         }
      }

      private static function jrChatPick(param1:Object) : void
      {
         jrOpen(String(param1.key),"chat",{},param1 as DisplayObject);
      }

      // A JR tab on the World Map's pull-out window, above the game's own.
      public static function jrMapTab(param1:Object, param2:Object, param3:String, param4:String, param5:int, param6:Function) : Sprite
      {
         var _loc5_:DisplayObject = param1 as DisplayObject;
         var _loc6_:DisplayObject = param2 as DisplayObject;
         var _loc7_:JRMapTab = null;
         try
         {
            // param5: 1 = just above the game's top tab, 2 = above that.
            _loc7_ = new JRMapTab(param3,_loc6_,param4,param6);
            _loc7_.name = "jrTab_" + param3;
            _loc5_.parent.addChild(_loc7_);
            _loc7_.follow(_loc6_,-(param5 + 1) * (_loc6_.y - _loc5_.y));
            jrSend(["d",jrJson({
               "what":"map",
               "adv":[Math.round(_loc5_.x),Math.round(_loc5_.y),Math.round(_loc5_.width),Math.round(_loc5_.height)],
               "den":[Math.round(_loc6_.x),Math.round(_loc6_.y),Math.round(_loc6_.width),Math.round(_loc6_.height)],
               "tab":[Math.round(_loc7_.x),Math.round(_loc7_.y)]
            })]);
         }
         catch(e:Error)
         {
            jrSend(["d",jrJson({"what":"map","error":e.message})]);
         }
         return _loc7_;
      }

      // Puts a JR window inside one of the game's windows.
      public static function jrEmbed(param1:String, param2:Object, param3:Number, param4:Number, param5:Number, param6:Number) : void
      {
         var _loc7_:DisplayObjectContainer = param2 as DisplayObjectContainer;
         var _loc8_:JRPanel = null;
         if(_loc7_ == null)
         {
            return;
         }
         if(_loc7_.stage)
         {
            _jrStage = _loc7_.stage;
         }
         jrUnembed(param1,false);
         if(_jrPanels[param1] is JRPanel)
         {
            JRPanel(_jrPanels[param1]).close();
         }
         _loc8_ = new JRPanel(param1);
         _loc8_.embed(_loc7_,param3,param4,param5,param6);
         _jrPanels[param1] = _loc8_;
         _jrOpener = null;
         jrSend(["o",jrJson({
            "s":param1,
            "a":"map",
            "x":{}
         })]);
      }

      public static function jrUnembed(param1:String, param2:Boolean = true) : void
      {
         var _loc3_:JRPanel = _jrPanels[param1] as JRPanel;
         if(_loc3_ != null && _loc3_.embedded)
         {
            _loc3_.close();
            delete _jrPanels[param1];
            if(param2)
            {
               jrPanelEvent(param1,"_close","",{});
            }
         }
      }

      private static function jrToast(param1:Object) : void
      {
         var _loc2_:JRToast = null;
         if(_jrStage == null || !param1 || !param1.text)
         {
            return;
         }
         _loc2_ = new JRToast(String(param1.text),String(param1.c));
         _loc2_.x = Math.round((_jrStage.stageWidth - 384) / 2);
         _loc2_.y = 46;
         _jrStage.addChild(_loc2_);
      }

      // Display Name shown for you, on your screen only. Empty when unset.
      public static var jrAlias:String = "";

      // Your names as the game may know them: your username, and the
      // Display Name the game was given when you logged in. Lowercase.
      private static var _jrIds:Array = [];

      // The name saved in JR, shown in the edit box even while it isn't in use.
      public static var jrSavedName:String = "";

      private static var _jrNameDialog:JRNameDialog;

      private static function jrSetAlias(param1:String) : void
      {
         if(param1 == jrAlias)
         {
            return;
         }
         jrAlias = param1;
         try
         {
            NameBar.jrRefreshAll();
         }
         catch(e:Error)
         {
         }
      }

      // Your username becomes your Display Name; anyone else's stays.
      public static function jrNameFor(param1:String, param2:String) : String
      {
         try
         {
            if(jrAlias && param1 && _jrIds.indexOf(param1.toLowerCase()) != -1)
            {
               return jrAlias;
            }
         }
         catch(e:Error)
         {
         }
         return param2;
      }

      public static function jrEditName(param1:Stage) : void
      {
         if(param1 == null)
         {
            return;
         }
         if(_jrNameDialog == null)
         {
            _jrNameDialog = new JRNameDialog(jrSaveName);
         }
         _jrNameDialog.open(param1,jrSavedName);
      }

      private static function jrSaveName(param1:String) : void
      {
         param1 = param1.split("%").join("").replace(/^\s+|\s+$/g,"");
         jrSavedName = param1;
         jrSend(["n",param1 == "" ? "-" : param1]);
      }

      public static function jrAddSettingsRows(param1:Array) : void
      {
         var _loc2_:Object = null;
         for each(_loc2_ in jrRows)
         {
            if(_loc2_ && _loc2_.k)
            {
               param1.push({
                  "type":(_loc2_.y == "b" ? 3 : 0),
                  "frame":String(_loc2_.f),
                  "jrKey":String(_loc2_.k),
                  "jrLabel":String(_loc2_.l),
                  "jrBtn":String(_loc2_.b),
                  "jrValue":_loc2_.v == true
               });
            }
         }
         jrSend(["s"]);
      }

      public static function jrSetRow(param1:String, param2:Boolean) : void
      {
         var _loc3_:Object = null;
         for each(_loc3_ in jrRows)
         {
            if(_loc3_ && _loc3_.k == param1)
            {
               _loc3_.v = param2;
            }
         }
      }

      public static function jrItemOver(param1:Object, param2:DisplayObject) : void
      {
         var _loc3_:int = 0;
         var _loc4_:uint = 0;
         var _loc5_:String = "";
         var _loc6_:String = null;
         var _loc7_:Object = null;
         if(!(param1 is Iitem))
         {
            return;
         }
         try
         {
            _loc3_ = int(param1.defId);
            _loc5_ = String(param1.name);
         }
         catch(e:Error)
         {
            return;
         }
         try
         {
            _loc4_ = uint(param1.color);
         }
         catch(e2:Error)
         {
            _loc4_ = 0;
         }
         _loc6_ = getQualifiedClassName(param1) == "den::DenItem" ? "d" : "c";
         _jrHoverKey = _loc6_ + _loc3_ + "_" + _loc4_;
         _jrHoverTarget = param2;
         _loc7_ = _jrWorth[_jrHoverKey];
         if(_loc7_)
         {
            jrShowBubble(_loc7_);
         }
         else
         {
            jrSend(["w",_jrHoverKey,_loc6_,_loc3_,_loc4_,_loc5_.split("%").join("")]);
         }
      }

      public static function jrItemOut(param1:DisplayObject) : void
      {
         if(param1 == null || param1 == _jrHoverTarget)
         {
            _jrHoverKey = null;
            _jrHoverTarget = null;
            if(_jrBubble)
            {
               _jrBubble.hide();
            }
         }
      }

      private static function jrShowBubble(param1:Object) : void
      {
         if(_jrHoverTarget == null || _jrHoverTarget.stage == null || param1.off)
         {
            if(_jrBubble)
            {
               _jrBubble.hide();
            }
            return;
         }
         if(_jrBubble == null)
         {
            _jrBubble = new JRBubble();
         }
         _jrBubble.show(param1,_jrHoverTarget);
      }
'''

JR_BUBBLE_CLASS = r'''

import flash.display.DisplayObject;
import flash.display.Sprite;
import flash.display.Stage;
import flash.events.Event;
import flash.filters.DropShadowFilter;
import flash.geom.Rectangle;
import flash.text.TextField;
import flash.text.TextFieldAutoSize;
import flash.text.TextFormat;

// JR's worth bubble: drawn by the game itself, next to the item you hover.
class JRBubble extends Sprite
{
   private var _title:TextField;
   private var _body:TextField;
   private var _target:DisplayObject;

   public function JRBubble()
   {
      super();
      mouseEnabled = false;
      mouseChildren = false;
      _title = makeField(new TextFormat("Verdana",13,0xFFFFFF,true));
      _body = makeField(new TextFormat("Verdana",11,0xE4E0F5,false,null,null,null,null,null,null,null,null,2));
      addChild(_title);
      addChild(_body);
      filters = [new DropShadowFilter(3,90,0,0.45,10,10,1,2)];
      visible = false;
   }

   private function makeField(param1:TextFormat) : TextField
   {
      var _loc2_:TextField = new TextField();
      _loc2_.defaultTextFormat = param1;
      _loc2_.selectable = false;
      _loc2_.mouseEnabled = false;
      _loc2_.multiline = true;
      _loc2_.wordWrap = true;
      _loc2_.autoSize = TextFieldAutoSize.LEFT;
      _loc2_.width = 236;
      return _loc2_;
   }

   public function show(param1:Object, param2:DisplayObject) : void
   {
      var _loc3_:Stage = param2.stage;
      var _loc4_:Array = param1.b is Array ? param1.b as Array : [];
      var _loc5_:Rectangle = null;
      var _loc6_:Number = NaN;
      var _loc7_:Number = NaN;
      var _loc8_:int = 0;
      var _loc9_:int = 0;
      _target = param2;
      _title.text = String(param1.t || "");
      _body.text = _loc4_.join("\n");
      _title.x = 10;
      _title.y = 7;
      _body.x = 10;
      _body.y = _title.y + _title.height + 2;
      _loc8_ = 256;
      _loc9_ = int(_body.y + _body.height + 8);
      graphics.clear();
      graphics.lineStyle(2,0x8B6CF0,1);
      graphics.beginFill(0x1B1630,0.96);
      graphics.drawRoundRect(0,0,_loc8_,_loc9_,14,14);
      graphics.endFill();
      graphics.lineStyle(0,0,0);
      graphics.beginFill(0x8B6CF0,1);
      graphics.drawRoundRect(0,0,6,_loc9_,6,6);
      graphics.endFill();
      _loc3_.addChild(this);
      _loc5_ = param2.getBounds(_loc3_);
      _loc6_ = _loc5_.right + 8;
      if(_loc6_ + _loc8_ > _loc3_.stageWidth - 4)
      {
         _loc6_ = _loc5_.left - _loc8_ - 8;
      }
      if(_loc6_ < 4)
      {
         _loc6_ = 4;
      }
      _loc7_ = _loc5_.top;
      if(_loc7_ + _loc9_ > _loc3_.stageHeight - 4)
      {
         _loc7_ = _loc3_.stageHeight - 4 - _loc9_;
      }
      if(_loc7_ < 4)
      {
         _loc7_ = 4;
      }
      x = Math.round(_loc6_);
      y = Math.round(_loc7_);
      visible = true;
      addEventListener(Event.ENTER_FRAME,onFrame);
   }

   private function onFrame(param1:Event) : void
   {
      if(_target == null || _target.stage == null || !_target.visible)
      {
         hide();
      }
   }

   public function hide() : void
   {
      removeEventListener(Event.ENTER_FRAME,onFrame);
      visible = false;
      _target = null;
      if(parent)
      {
         parent.removeChild(this);
      }
   }
}
'''

JR_BUBBLE_CLASS += '\nimport flash.events.KeyboardEvent;\nimport flash.events.MouseEvent;\nimport flash.text.TextFieldType;\n\n// Display Name editor, drawn by the game. Enter saves, Esc closes.\nclass JRNameDialog extends Sprite\n{\n   private var _input:TextField;\n   private var _save:Function;\n   private var _veil:Sprite;\n\n   public function JRNameDialog(param1:Function)\n   {\n      super();\n      _save = param1;\n      _veil = new Sprite();\n      _veil.addEventListener(MouseEvent.MOUSE_DOWN,swallow);\n      addChild(_veil);\n      var _loc2_:Sprite = new Sprite();\n      _loc2_.graphics.lineStyle(2,0x8B6CF0,1);\n      _loc2_.graphics.beginFill(0x1B1630,0.98);\n      _loc2_.graphics.drawRoundRect(0,0,320,168,16,16);\n      _loc2_.graphics.endFill();\n      _loc2_.filters = [new DropShadowFilter(4,90,0,0.5,14,14,1,2)];\n      _loc2_.name = "box";\n      addChild(_loc2_);\n      _loc2_.addChild(label("Display Name",14,0xFFFFFF,true,18,14,284));\n      _loc2_.addChild(label("Shown instead of your username everywhere in the game while Incognito is on. Only you see it.",11,0xC9C2E8,false,18,36,284));\n      var _loc3_:Sprite = new Sprite();\n      _loc3_.graphics.lineStyle(1,0x8B6CF0,1);\n      _loc3_.graphics.beginFill(0xFFFFFF,1);\n      _loc3_.graphics.drawRoundRect(0,0,284,30,8,8);\n      _loc3_.graphics.endFill();\n      _loc3_.x = 18;\n      _loc3_.y = 78;\n      _loc2_.addChild(_loc3_);\n      _input = new TextField();\n      _input.defaultTextFormat = new TextFormat("Verdana",14,0x1B1630);\n      _input.type = TextFieldType.INPUT;\n      _input.maxChars = 20;\n      _input.restrict = "A-Za-z0-9 _.";\n      _input.x = 26;\n      _input.y = 83;\n      _input.width = 268;\n      _input.height = 22;\n      _input.addEventListener(KeyboardEvent.KEY_DOWN,onKey);\n      _input.addEventListener(KeyboardEvent.KEY_UP,swallow);\n      _loc2_.addChild(_input);\n      _loc2_.addChild(button("Save",206,124,96,0x8B6CF0,onSave));\n      _loc2_.addChild(button("Cancel",100,124,96,0x3A3355,onCancel));\n      _loc2_.addChild(button("Clear",18,124,72,0x3A3355,onClear));\n   }\n\n   private function label(param1:String, param2:int, param3:uint, param4:Boolean, param5:int, param6:int, param7:int) : TextField\n   {\n      var _loc8_:TextField = new TextField();\n      _loc8_.defaultTextFormat = new TextFormat("Verdana",param2,param3,param4);\n      _loc8_.selectable = false;\n      _loc8_.mouseEnabled = false;\n      _loc8_.multiline = true;\n      _loc8_.wordWrap = true;\n      _loc8_.autoSize = TextFieldAutoSize.LEFT;\n      _loc8_.width = param7;\n      _loc8_.x = param5;\n      _loc8_.y = param6;\n      _loc8_.text = param1;\n      return _loc8_;\n   }\n\n   private function button(param1:String, param2:int, param3:int, param4:int, param5:uint, param6:Function) : Sprite\n   {\n      var _loc7_:JRButton = new JRButton(param6);\n      _loc7_.graphics.beginFill(param5,1);\n      _loc7_.graphics.drawRoundRect(0,0,param4,30,10,10);\n      _loc7_.graphics.endFill();\n      var _loc8_:TextField = new TextField();\n      _loc8_.defaultTextFormat = new TextFormat("Verdana",13,0xFFFFFF,true,null,null,null,null,"center");\n      _loc8_.selectable = false;\n      _loc8_.mouseEnabled = false;\n      _loc8_.width = param4;\n      _loc8_.height = 22;\n      _loc8_.y = 6;\n      _loc8_.text = param1;\n      _loc7_.addChild(_loc8_);\n      _loc7_.x = param2;\n      _loc7_.y = param3;\n      return _loc7_;\n   }\n\n   public function open(param1:Stage, param2:String) : void\n   {\n      _veil.graphics.clear();\n      _veil.graphics.beginFill(0,0.35);\n      _veil.graphics.drawRect(0,0,param1.stageWidth,param1.stageHeight);\n      _veil.graphics.endFill();\n      var _loc3_:DisplayObject = getChildByName("box");\n      _loc3_.x = Math.round((param1.stageWidth - 320) / 2);\n      _loc3_.y = Math.round((param1.stageHeight - 168) / 2);\n      _input.text = param2;\n      param1.addChild(this);\n      param1.focus = _input;\n      _input.setSelection(0,_input.text.length);\n   }\n\n   private function close() : void\n   {\n      if(stage)\n      {\n         stage.focus = null;\n      }\n      if(parent)\n      {\n         parent.removeChild(this);\n      }\n   }\n\n   private function swallow(param1:Event) : void\n   {\n      param1.stopPropagation();\n   }\n\n   private function onKey(param1:KeyboardEvent) : void\n   {\n      param1.stopPropagation();\n      if(param1.keyCode == 13)\n      {\n         onSave();\n      }\n      else if(param1.keyCode == 27)\n      {\n         onCancel();\n      }\n   }\n\n   private function onSave() : void\n   {\n      _save(_input.text);\n      close();\n   }\n\n   private function onClear() : void\n   {\n      _save("");\n      close();\n   }\n\n   private function onCancel() : void\n   {\n      close();\n   }\n}\n\nclass JRButton extends Sprite\n{\n   private var _action:Function;\n\n   public function JRButton(param1:Function)\n   {\n      super();\n      _action = param1;\n      buttonMode = true;\n      useHandCursor = true;\n      mouseChildren = false;\n      addEventListener(MouseEvent.MOUSE_DOWN,onDown);\n   }\n\n   private function onDown(param1:MouseEvent) : void\n   {\n      param1.stopPropagation();\n      _action();\n   }\n}\n'

edit('XtReplyDemuxer.as', [
    ('   import com.sbi.client.SFEvent;\n',
     '   import com.sbi.client.SFEvent;\n   import avatar.NameBar;\n   import avatar.AvatarManager;\n   import game.MinigameManager;\n   import com.sbi.graphics.LayerAnim;\n   import flash.net.SharedObject;\n   import flash.utils.Dictionary;\n   import flash.display.Sprite;\n   import flash.display.DisplayObject;\n   import flash.display.DisplayObjectContainer;\n   import flash.display.Stage;\n   import flash.geom.Rectangle;\n   import flash.utils.getQualifiedClassName;\n   import inventory.Iitem;\n'),
    ('      public static function xtReplyHandler(param1:SFEvent) : void\n      {\n',
     JR_BRIDGE + '\n      public static function xtReplyHandler(param1:SFEvent) : void\n      {\n'
     '         if(param1.obj && param1.obj[0] == "jr")\n         {\n            jrHandle(param1.obj);\n            return;\n         }\n'),
])
# the helper class goes after the package block
s = open(os.path.join(O, 'XtReplyDemuxer.as'), encoding='utf-8').read().rstrip()
assert s.endswith('}')
JR_BUBBLE_CLASS += open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'as', 'JRUI.as'), encoding='utf-8').read()
open(os.path.join(O, 'XtReplyDemuxer.as'), 'w', encoding='utf-8').write(s + '\n' + JR_BUBBLE_CLASS)

# --------------------------------------------------------------- settings
edit('gui/MySettings.as', [
    ('         _toggleWindows = new WindowGenerator();\n',
     '         try\n         {\n            XtReplyDemuxer.jrAddSettingsRows(_loc4_);\n         }\n         catch(e:Error)\n         {\n         }\n'
     '         _toggleWindows = new WindowGenerator();\n'),
])

TOGGLE_FUNCS = r'''
      private function jrSetup() : void
      {
         var _loc1_:Boolean = _currItem.jrValue == true;
         jrLabel(String(_currItem.jrLabel));
         if(_currItem.type == MySettings.TOGGLE_TYPE_JOIN)
         {
            _window.goNowBtn.down.txt.text = String(_currItem.jrBtn);
            _window.goNowBtn.mouse.mouse.txt.text = String(_currItem.jrBtn);
            _window.goNowBtn.mouse.up.txt.text = String(_currItem.jrBtn);
            return;
         }
         _window.toggleBtn.toggleBtn.gotoAndStop(_loc1_ ? "startingOn" : "startingOff");
         try
         {
            _window.icon["" + _window.icon.currentFrameLabel].gotoAndStop(_loc1_ ? "startingOn" : "startingOff");
         }
         catch(e:Error)
         {
         }
         LocalizationManager.translateId(_window.toggleBtn.toggleBtn.valueTxt.onTxt,6324);
         LocalizationManager.translateId(_window.toggleBtn.toggleBtn.valueTxt.offTxt,6322);
      }

      // JR rows have no icon: the name gets the icon's space and shrinks
      // until it fits.
      private function jrLabel(param1:String) : void
      {
         var _loc2_:Object = _window.labelTxtCont.labelTxt;
         var _loc3_:Object = null;
         var _loc4_:Object = null;
         var _loc5_:int = 0;
         _window.icon.visible = false;
         try
         {
            _loc4_ = _window.icon.getBounds(_window.labelTxtCont);
            if(_loc4_.right > _loc2_.x + _loc2_.width)
            {
               _loc2_.width = _loc4_.right - _loc2_.x;
            }
         }
         catch(e:Error)
         {
         }
         _loc2_.text = param1;
         try
         {
            _loc3_ = _loc2_.getTextFormat();
            _loc5_ = int(_loc3_.size);
            while(_loc5_ > 8 && (_loc2_.textWidth > _loc2_.width - 4 || _loc2_.textHeight > _loc2_.height - 2))
            {
               _loc5_--;
               _loc3_.size = _loc5_;
               _loc2_.setTextFormat(_loc3_);
            }
         }
         catch(e2:Error)
         {
         }
      }

      private function jrClick(param1:MouseEvent) : void
      {
         var _loc2_:Boolean = false;
         var _loc3_:String = String(_currItem.jrKey);
         if(_currItem.type == MySettings.TOGGLE_TYPE_JOIN)
         {
            if(_loc3_ == "streamingName")
            {
               XtReplyDemuxer.jrEditName(stage);
            }
            else
            {
               XtReplyDemuxer.jrSend(["a",_loc3_]);
            }
            if(_mySettingsCloseFunction != null)
            {
               _mySettingsCloseFunction(null);
            }
            return;
         }
         _loc2_ = !(_currItem.jrValue == true);
         _currItem.jrValue = _loc2_;
         param1.currentTarget.toggleBtn.gotoAndPlay(_loc2_ ? "on" : "off");
         try
         {
            if(_window.icon["" + _window.icon.currentFrameLabel].currentLabel)
            {
               _window.icon["" + _window.icon.currentFrameLabel].gotoAndPlay(_loc2_ ? "on" : "off");
            }
         }
         catch(e:Error)
         {
         }
         XtReplyDemuxer.jrSetRow(_loc3_,_loc2_);
         XtReplyDemuxer.jrSend(["t",_loc3_,_loc2_ ? "1" : "0"]);
      }

      private function handleMouseDown(param1:MouseEvent) : void
'''
edit('gui/itemWindows/ItemWindowToggle.as', [
    ('         switch(_currItem.frame)\n         {\n            case "lock":\n               if(gMainFrame',
     '         if(_currItem.jrKey)\n         {\n            jrSetup();\n            return;\n         }\n'
     '         switch(_currItem.frame)\n         {\n            case "lock":\n               if(gMainFrame'),
    ('\n      private function handleMouseDown(param1:MouseEvent) : void\n', TOGGLE_FUNCS),
    ('         var _loc6_:int = 0;\n         param1.stopPropagation();\n         if(_currItem.type == MySettings.TOGGLE_TYPE_TOGGLE_BTN)\n',
     '         var _loc6_:int = 0;\n         param1.stopPropagation();\n         if(_currItem.jrKey)\n         {\n            jrClick(param1);\n            return;\n         }\n'
     '         if(_currItem.type == MySettings.TOGGLE_TYPE_TOGGLE_BTN)\n'),
])

edit('gui/itemWindows/ItemWindowBase.as', [
    ('         _useToolTip = param10;\n',
     '         _useToolTip = param10;\n         addEventListener("rollOver",jrRollOver,false,0,true);\n         addEventListener("rollOut",jrRollOut,false,0,true);\n'),
    ('      public function destroy() : void\n      {\n',
     '      private function jrRollOver(param1:MouseEvent) : void\n      {\n         if(_currItem)\n         {\n            XtReplyDemuxer.jrItemOver(_currItem,this);\n         }\n      }\n\n'
     '      private function jrRollOut(param1:MouseEvent) : void\n      {\n         XtReplyDemuxer.jrItemOut(this);\n      }\n\n'
     '      public function destroy() : void\n      {\n         XtReplyDemuxer.jrItemOut(this);\n'),
])
NAMEBAR = r"""
      // Name bars showing your username show your Display Name instead,
      // and update when it changes.
      private static var _jrBars:Dictionary = new Dictionary(true);

      private var _jrReal:String;

      private var _jrSized:Boolean = true;

      private var _jrWidth:Number = -1;

      public static function jrRefreshAll() : void
      {
         var _loc1_:Object = null;
         var _loc2_:NameBar = null;
         for(_loc1_ in _jrBars)
         {
            _loc2_ = _loc1_ as NameBar;
            if(_loc2_ && _loc2_._jrReal && _loc2_._avNameTxt)
            {
               _loc2_._avNameTxt.text = XtReplyDemuxer.jrNameFor(_loc2_._jrReal,_loc2_._jrReal);
               _loc2_.resize(_loc2_._jrSized,_loc2_._jrWidth);
            }
         }
      }

      public function setAvName(param1:Object, param2:Boolean = false, param3:Object = null, param4:Boolean = true, param5:Number = -1) : void
"""
edit('avatar/NameBar.as', [
    ('   import flash.text.TextField;\n', '   import flash.text.TextField;\n   import flash.utils.Dictionary;\n'),
    ('\n      public function setAvName(param1:Object, param2:Boolean = false, param3:Object = null, param4:Boolean = true, param5:Number = -1) : void\n', NAMEBAR),
    ('            _avNameTxt.text = param1.avName;\n         }\n         resize(param4,param5);\n',
     '            _avNameTxt.text = param1.avName;\n         }\n'
     '         _jrReal = param3 != null && param3.hasOwnProperty("userName") ? String(param3.userName) : _avNameTxt.text;\n'
     '         _jrSized = param4;\n         _jrWidth = param5;\n         _jrBars[this] = true;\n'
     '         _avNameTxt.text = XtReplyDemuxer.jrNameFor(_jrReal,_avNameTxt.text);\n'
     '         resize(param4,param5);\n'),
])

edit('avatar/UserInfo.as', [
    ("      public function getModeratedUserName() : String\n      {\n         if(userNameModeratedFlag > 0)\n         {\n            return userName;\n         }\n         return LocalizationManager.translateIdOnly(11098);\n      }",
     "      public function getModeratedUserName() : String\n      {\n         if(userNameModeratedFlag > 0)\n         {\n            return XtReplyDemuxer.jrNameFor(userName,userName);\n         }\n         return XtReplyDemuxer.jrNameFor(userName,LocalizationManager.translateIdOnly(11098));\n      }"),
])
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'anchors.py'), encoding='utf-8').read())
print('ok')

